#!/usr/bin/env node
/* ============================================================================
   HEADLESS LIFECYCLE TESTS — nbRunSheetGeneration (artroom.jsx), the plain
   async engine behind useImageGen. Runs against the MINIFIED dist build with
   the nb* generation/storage layer stubbed and a recording ui adapter, so the
   whole claim → gate → spend → persist → teardown state machine is exercised
   deterministically (Stop/Clear mid-save, epoch moves, save failures, the
   fail-closed pre-generate gate, and the cloud-mode privacy rule for personal
   reference photos). Deterministic asserts only — any mismatch exits 1.
   Run AFTER `npm run build`:

     node scripts/test-artroom-genrun.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: "node-test" },
  location: { href: "", search: "", hash: "", origin: "" },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  AbortController,
  document: {
    createElement: () => ({ getContext: () => null, style: {}, setAttribute: noop, appendChild: noop }),
    getElementById: () => null,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
    body: { appendChild: noop, removeChild: noop },
  },
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  addEventListener: noop, removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("dist/app/artroom.js", "utf8"), sandbox, { filename: "dist/app/artroom.js" });

const run = sandbox.window.nbRunSheetGeneration;
if (typeof run !== "function") { console.log("FAIL window.nbRunSheetGeneration missing from dist build"); process.exit(1); }
if (typeof sandbox.window.nbCancelGen !== "function") { console.log("FAIL window.nbCancelGen missing"); process.exit(1); }

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++;
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};

/* ---- instrumented stubs + a recording ui adapter (reset per scenario) ---- */
let genCalls, commits, events, ui, uiCalls, epoch, backend, commitImpl, genImpl;
let qualityValue, qualityChecks;
const rec = (fn) => (...args) => { uiCalls.push({ fn, args }); };
const reset = () => {
  genCalls = []; commits = []; events = []; uiCalls = []; epoch = 1; backend = "cloud";
  qualityValue = "medium"; qualityChecks = [];
  commitImpl = async (c) => ({ tier: "cloud", url: "signed:" + c.url });
  genImpl = async () => "data:image/png;base64,RENDER";
  sandbox.window.__nbGenInflight = {};
  sandbox.window.__nbGenCancel = {};
  sandbox.window.__nbGenAbort = {};
  sandbox.window.__nbGenRunSeq = 0;
  sandbox.nbDiscardSheetSave("char-1");
  sandbox.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail }); };
  sandbox.nbHasKeyForCurrent = () => true;
  sandbox.nbEpoch = () => epoch;
  sandbox.nbBackend = () => backend;
  sandbox.nbGetModel = () => "nano";
  sandbox.nbSetModel = noop;
  sandbox.isGptImageModel = () => false;
  sandbox.nbGetAspect = () => "16:9";
  sandbox.nbGetRes = () => "2K";
  sandbox.nbGetOaiQuality = () => qualityValue;
  sandbox.nbRequireImageQuality = async (model, quality) => {
    qualityChecks.push({ model, quality });
    return true;
  };
  sandbox.nbGetGroundSearch = () => false;
  sandbox.nbGetCameo = () => null;
  sandbox.nbLoadCameo = async () => null;
  sandbox.nbGetCameoAngles = () => null;
  sandbox.nbLoadCameoAngles = async () => null;
  sandbox.nbGetSlotImage = () => null;
  sandbox.nbImageDimensions = async () => ({ w: 1024, h: 576 });
  sandbox.nbGetHistory = async () => [];
  sandbox.nbGetMeta = () => null;
  sandbox.slotAssetKind = () => "character";
  sandbox.nbWithAssetProvenance = () => ({});
  sandbox.nbGenerate = async (prompt, opts) => { genCalls.push({ prompt, opts }); return genImpl(prompt, opts); };
  sandbox.nbCommit = async (id, url, meta, refs, kind, ep, cxl) => {
    // cxlDuring: the predicate's answer WHILE the save runs (post-run it reads
    // "not owned" by design — the registries were torn down)
    const c = { id, url, meta, refs, kind, ep, cxl, cxlDuring: typeof cxl === "function" ? cxl() : undefined };
    commits.push(c);
    return commitImpl(c);
  };
  ui = {
    setGenErr: rec("setGenErr"), setGening: rec("setGening"), setRetrying: rec("setRetrying"),
    setGenUrl: rec("setGenUrl"), setGenTier: rec("setGenTier"), setGenMeta: rec("setGenMeta"),
    closeEdit: rec("closeEdit"),
  };
};
const calls = (fn) => uiCalls.filter(c => c.fn === fn);
const lastArg = (fn) => { const c = calls(fn); return c.length ? c[c.length - 1].args[0] : undefined; };
const evts = (t) => events.filter(e => e.type === t);
const env = (over) => ({
  id: "char-1", slotId: "charref-char-1",
  opts: { buildFinal: () => "FINAL PROMPT" },
  allModels: [{ id: "nano", label: "Nano Banana" }],
  genUrl: "", genMeta: null, slotHasRef: false, ui,
  ...(over || {}),
});

/* 1 — happy path: one spend, one epoch+predicate-scoped commit, adopt + done */
reset();
{
  await run(env(), {});
  ok("happy: one generate call", genCalls.length === 1, "n=" + genCalls.length);
  ok("happy: one commit with the run epoch", commits.length === 1 && commits[0].ep === 1, JSON.stringify(commits.map(c => c.ep)));
  ok("happy: live cancel predicate rode into the commit", typeof commits[0].cxl === "function" && commits[0].cxlDuring === false);
  ok("happy: adopted the COMMITTED url", lastArg("setGenUrl") === "signed:data:image/png;base64,RENDER", lastArg("setGenUrl"));
  ok("happy: tier adopted", lastArg("setGenTier") === "cloud");
  ok("happy: start then done with committed url",
    evts("nb-gen-start").length === 1 && evts("nb-gen-done").length === 1 && evts("nb-gen-done")[0].detail.url === "signed:data:image/png;base64,RENDER",
    JSON.stringify(events.map(e => e.type)));
  ok("happy: no error shown", !calls("setGenErr").some(c => c.args[0]), JSON.stringify(calls("setGenErr")));
  ok("happy: registries clean", !(("char-1") in sandbox.window.__nbGenInflight) && !(("char-1") in sandbox.window.__nbGenCancel) && !(("char-1") in sandbox.window.__nbGenAbort));
  ok("happy: spinner off at end", lastArg("setGening") === false);
}

/* 1b — quality is a per-run snapshot: changing the picker while the provider
   is in flight cannot rewrite provider opts or committed Details metadata. */
reset();
{
  const gptModels = [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" }];
  sandbox.nbGetModel = () => "gpt-image-2.5-flare";
  sandbox.isGptImageModel = model => /^gpt-image/.test(model || "");
  qualityValue = "default";
  genImpl = async () => {
    qualityValue = "auto";
    return "data:image/png;base64,QUALITY";
  };
  await run(env({ allModels: gptModels }), {});
  ok("quality-snapshot: preflight saw the requested model and quality",
    qualityChecks.length === 1 && qualityChecks[0].model === "gpt-image-2.5-flare"
      && qualityChecks[0].quality === "default", JSON.stringify(qualityChecks));
  ok("quality-snapshot: provider received the captured quality",
    genCalls.length === 1 && genCalls[0].opts.quality === "default", JSON.stringify(genCalls[0] && genCalls[0].opts));
  ok("quality-snapshot: Details kept the original quality after a mid-run change",
    commits.length === 1 && commits[0].meta.quality === "default", commits[0] && commits[0].meta.quality);
}

/* 1c — unsupported quality fails before a paid pre-generate helper or provider
   fallback can run. */
reset();
{
  let gateCalled = false;
  sandbox.nbGetModel = () => "gpt-image-2.5-flare";
  sandbox.isGptImageModel = model => /^gpt-image/.test(model || "");
  qualityValue = "max";
  sandbox.nbRequireImageQuality = async () => { throw new Error("quality not verified"); };
  await run(env({
    allModels: [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" }],
    opts: { buildFinal: () => "P", beforeGenerate: async () => { gateCalled = true; return true; } },
  }), {});
  ok("quality-reject: nothing spent before capability approval",
    genCalls.length === 0 && commits.length === 0 && !gateCalled);
  ok("quality-reject: explicit capability error surfaced",
    /quality not verified/.test(lastArg("setGenErr") || ""), lastArg("setGenErr"));
}

/* 1d — the async capability check must not open a paid pre-generate/provider
   window after a film switch or Stop lands while its OPTIONS request awaits. */
reset();
{
  let releaseQuality, gateCalled = false;
  sandbox.nbGetModel = () => "gpt-image-2.5-flare";
  sandbox.isGptImageModel = model => /^gpt-image/.test(model || "");
  qualityValue = "default";
  sandbox.nbRequireImageQuality = async () => new Promise(resolve => { releaseQuality = resolve; });
  const pending = run(env({
    allModels: [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" }],
    opts: { buildFinal: () => "P", beforeGenerate: async () => { gateCalled = true; return true; } },
  }), {});
  await new Promise(resolve => setTimeout(resolve, 0));
  epoch = 2; releaseQuality(true); await pending;
  ok("quality-await-epoch: no paid work after film switch",
    !gateCalled && genCalls.length === 0 && commits.length === 0);
}
reset();
{
  let releaseQuality, gateCalled = false;
  sandbox.nbGetModel = () => "gpt-image-2.5-flare";
  sandbox.isGptImageModel = model => /^gpt-image/.test(model || "");
  qualityValue = "default";
  sandbox.nbRequireImageQuality = async () => new Promise(resolve => { releaseQuality = resolve; });
  const pending = run(env({
    allModels: [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" }],
    opts: { buildFinal: () => "P", beforeGenerate: async () => { gateCalled = true; return true; } },
  }), {});
  await new Promise(resolve => setTimeout(resolve, 0));
  sandbox.window.nbCancelGen("char-1"); releaseQuality(true); await pending;
  ok("quality-await-cancel: no paid work after Stop",
    !gateCalled && genCalls.length === 0 && commits.length === 0);
}

/* 2 — persistence FAILED (tier:"error"): failure surfaced, nothing adopted */
reset();
{
  commitImpl = async () => ({ tier: "error" });
  await run(env(), {});
  ok("save-fail: error names the save", /saving it to your project failed/.test(lastArg("setGenErr") || ""), lastArg("setGenErr"));
  ok("save-fail: image NOT adopted", calls("setGenUrl").length === 0 && calls("setGenMeta").length === 0);
  ok("save-fail: done fired with EMPTY url (no adoptable result)", evts("nb-gen-done").length === 1 && evts("nb-gen-done")[0].detail.url === "", JSON.stringify(evts("nb-gen-done")));
}

/* 3 — persistence returned nothing (null): same failure contract */
reset();
{
  commitImpl = async () => null;
  await run(env(), {});
  ok("save-null: error surfaced", /saving it to your project failed/.test(lastArg("setGenErr") || ""));
  ok("save-null: image NOT adopted", calls("setGenUrl").length === 0);
}

/* 4 — Stop lands DURING the save: predicate halts the write, never adopt */
reset();
{
  commitImpl = async (c) => {
    sandbox.window.nbCancelGen("char-1");                    // the real Stop, mid-persistence
    return c.cxl() ? { tier: "cancelled" } : { tier: "cloud", url: "signed:" + c.url };
  };
  await run(env(), {});
  ok("stop-mid-save: predicate saw the cancel inside the save", commits.length === 1 && commits[0].cxl() === true);
  ok("stop-mid-save: nothing adopted, no error", calls("setGenUrl").length === 0 && !calls("setGenErr").some(c => c.args[0]));
  ok("stop-mid-save: no done event", evts("nb-gen-done").length === 0, JSON.stringify(events.map(e => e.type)));
  ok("stop-mid-save: exactly one cancel announcement", evts("nb-gen-cancel").length === 1, "n=" + evts("nb-gen-cancel").length);
}

/* 5 — Clear/Stop DURING the render: late result discarded BEFORE any commit */
reset();
{
  genImpl = async () => { sandbox.window.nbCancelGen("char-1"); return "data:image/png;base64,LATE"; };
  await run(env(), {});
  ok("stop-mid-render: commit never attempted", commits.length === 0, "commits=" + commits.length);
  ok("stop-mid-render: nothing adopted, no done", calls("setGenUrl").length === 0 && evts("nb-gen-done").length === 0);
}

/* 6 — film switched while rendering (epoch stale): quiet discard, no false done */
reset();
{
  commitImpl = async () => ({ tier: "stale" });
  await run(env(), {});
  ok("stale: quiet — no error, no adopt", !calls("setGenErr").some(c => c.args[0]) && calls("setGenUrl").length === 0);
  ok("stale: no done; cancel announced so seeded spinners unwedge",
    evts("nb-gen-done").length === 0 && evts("nb-gen-cancel").length === 1, JSON.stringify(events.map(e => e.type)));
}

/* 7 — pre-generate gate THROWS: fail closed — no spend, error surfaced, rollback */
reset();
{
  await run(env({ opts: { buildFinal: () => "P", beforeGenerate: async () => { throw new Error("boom"); } } }), {});
  ok("gate-throw: nothing spent", genCalls.length === 0 && commits.length === 0);
  ok("gate-throw: fail-closed error surfaced", /pre-generation check couldn't complete/.test(lastArg("setGenErr") || ""), lastArg("setGenErr"));
  ok("gate-throw: registries rolled back", !(("char-1") in sandbox.window.__nbGenInflight) && !(("char-1") in sandbox.window.__nbGenCancel));
  ok("gate-throw: cancel announced, no done", evts("nb-gen-cancel").length === 1 && evts("nb-gen-done").length === 0);
}

/* 8 — gate says no (director cancelled): silent rollback, no spend, no error */
reset();
{
  await run(env({ opts: { buildFinal: () => "P", beforeGenerate: async () => false } }), {});
  ok("gate-no: nothing spent", genCalls.length === 0 && commits.length === 0);
  ok("gate-no: no error", !calls("setGenErr").some(c => c.args[0]));
  ok("gate-no: rolled back + cancel announced", !(("char-1") in sandbox.window.__nbGenInflight) && evts("nb-gen-cancel").length === 1);
}

/* 9 — gate is SKIPPED for batch runs (no modal per card) */
reset();
{
  await run(env({ opts: { buildFinal: () => "P", beforeGenerate: async () => { throw new Error("must not run"); } } }), { batch: true });
  ok("gate-skip-batch: generated despite throwing gate", genCalls.length === 1 && evts("nb-gen-done").length === 1);
}

/* 10 — a second run for the SAME id while one is in flight: refused outright */
reset();
{
  sandbox.window.__nbGenInflight["char-1"] = 999;
  await run(env(), {});
  ok("dupe: no spend, no events, no ui", genCalls.length === 0 && events.length === 0 && uiCalls.length === 0);
}

/* 11 — PRIVACY (cloud): a dropped reference photo guides the render but is NOT persisted */
reset();
{
  sandbox.nbGetSlotImage = () => "data:image/png;base64,PERSONALPHOTO";
  await run(env({ slotHasRef: true, opts: { buildFinal: () => "P", buildFromPhoto: () => "FROM PHOTO" } }), {});
  const c = commits[0];
  ok("privacy-cloud: rendered from the photo", c && c.meta.mode === "photo", c && c.meta.mode);
  ok("privacy-cloud: photo NOT in persisted refs", c && !c.refs.some(r => r.kind === "photo"), c && JSON.stringify(c.refs));
  ok("privacy-cloud: disclosed as a private ref", c && c.meta.privateRefs === 1 && c.meta.refCount === 0, c && JSON.stringify({ p: c.meta.privateRefs, r: c.meta.refCount }));
  const note = sandbox.window.nbPrivateRefsNote;
  ok("privacy-cloud: Details disclosure text exists for a private-only render",
    typeof note === "function" && /1 private reference image .*not saved to the project/.test(note(c.meta)), note && note(c.meta));
  ok("privacy-cloud: no disclosure when nothing private was used", note && note({ refCount: 3 }) === "" && note(null) === "");
  ok("privacy-cloud: plural disclosure", note && /^2 private reference images /.test(note({ privateRefs: 2 })));
}

/* 12 — PRIVACY (local): everything stays on-device anyway — photo kept for Details */
reset();
{
  backend = "local";
  commitImpl = async (c) => ({ tier: "local", url: c.url });
  sandbox.nbGetSlotImage = () => "data:image/png;base64,PERSONALPHOTO";
  await run(env({ slotHasRef: true, opts: { buildFinal: () => "P", buildFromPhoto: () => "FROM PHOTO" } }), {});
  const c = commits[0];
  ok("privacy-local: photo kept in refs for Details", c && c.refs.some(r => r.kind === "photo"), c && JSON.stringify(c.refs));
  ok("privacy-local: no private-ref disclosure needed", c && c.meta.privateRefs === undefined);
}

/* 13 — PRIVACY (cloud, edit): device upload excluded; generated prop sheet kept */
reset();
{
  await run(env({
    genUrl: "data:image/png;base64,BASESHEET",
    opts: { buildFinal: () => "P", buildEdit: (i) => "EDIT: " + i },
  }), {
    editInstruction: "make the coat red",
    editRefMeta: [
      { url: "data:image/png;base64,DEVICEUPLOAD", note: "my photo" },       // no refId → device upload
      { url: "signed:prop-sheet", note: "the coat", refId: "prop-9" },        // generated project asset
    ],
  });
  const c = commits[0];
  ok("privacy-edit: commit happened in edit mode", c && c.meta.mode === "edit", c && c.meta.mode);
  ok("privacy-edit: device upload NOT persisted", c && !c.refs.some(r => (r.url || "").includes("DEVICEUPLOAD")), c && JSON.stringify(c.refs));
  ok("privacy-edit: prop sheet ref KEPT", c && c.refs.some(r => r.refId === "prop-9"));
  ok("privacy-edit: base sheet ref kept (project asset)", c && c.refs.some(r => r.kind === "edit"));
  ok("privacy-edit: one private ref disclosed", c && c.meta.privateRefs === 1, c && String(c.meta.privateRefs));
  ok("privacy-edit: edit panel closed on success", calls("closeEdit").length === 1);
}

/* 14 — a generated parent sheet carries its stable project id into Details */
reset();
{
  sandbox.nbGetMeta = id => id === "char-parent" ? { version: 4, iso: "2026-09-05T10:00:00.000Z" } : null;
  await run(env({
    opts: {
      buildFinal: () => "STATE",
      buildFromBase: () => "FROM BASE",
      referenceFallback: async () => "https://project.test/base-sheet.jpg",
      referenceFallbackId: "char-parent",
    },
  }), {});
  const c = commits[0];
  const base = c && c.refs.find(r => r.kind === "base");
  ok("project base reference records its source entity id",
    base && base.refId === "char-parent" && base.url === "https://project.test/base-sheet.jpg",
    base && JSON.stringify(base));
  ok("project base reference records the exact source version",
    base && base.refVersion === 4 && base.refGenerated === "2026-09-05T10:00:00.000Z",
    base && JSON.stringify(base));
}

/* Saving is retried independently of paid image generation. */
reset();
{
  commitImpl=async()=>({tier:"error"});
  await run(env());
  ok("failed save preserves recoverable bytes",!!sandbox.nbPendingSheetSave("char-1"));
  commitImpl=async c=>({tier:"cloud",url:"signed:"+c.url});
  const saved=await sandbox.nbRetrySheetSave("char-1");
  ok("retry save succeeds without another provider call",saved&&genCalls.length===1&&commits.length===2);
  ok("retry clears pending result",!sandbox.nbPendingSheetSave("char-1"));
}
reset();
{
  commitImpl=async()=>({tier:"error"});
  await run(env());
  sandbox.nbGetMeta=()=>({iso:"newer-version"});
  const saved=await sandbox.nbRetrySheetSave("char-1");
  ok("retry refuses to overwrite newer image",!saved&&commits.length===1&&genCalls.length===1);
}
reset();
{
  commitImpl=async()=>({tier:"error"});
  await run(env());
  epoch++;
  ok("unsaved result is film-scoped",!sandbox.nbPendingSheetSave("char-1"));
  ok("retry after film switch makes no write",!(await sandbox.nbRetrySheetSave("char-1"))&&commits.length===1);
}
reset();
{
  await run(env({opts:{buildFinal:()=>"FINAL",referenceFallback:async()=>{throw new Error("reference lookup failed");}}}));
  ok("reference assembly error releases registry",!sandbox.__nbGenInflight["char-1"]&&genCalls.length===0);
  ok("reference assembly failure is explicit",/reference lookup failed/.test(lastArg("setGenErr")||""));
}
reset();
{
  commitImpl=async()=>({tier:"error",persisted:"unknown"});
  await run(env());
  const pending=sandbox.nbPendingSheetSave("char-1");
  sandbox.nbLoadDetailsAsset=async()=>({meta:pending.meta,url:"signed:already-saved"});
  const saved=await sandbox.nbRetrySheetSave("char-1");
  ok("ambiguous save recovers verified result without second write",saved&&commits.length===1&&genCalls.length===1);
  ok("verified recovery announces generation metadata",evts("nb-gen-done").some(e=>e.detail.meta&&e.detail.meta.iso===pending.meta.iso));
  delete sandbox.nbLoadDetailsAsset;
}
reset();
{
  const notices=[];sandbox.appToast=message=>notices.push(message);
  commitImpl=async()=>{sandbox.nbCancelGen("char-1");return {tier:"cancellation-error",persisted:true,error:"rollback unavailable"};};
  await run(env());
  ok("failed cancellation is disclosed",notices.some(x=>/Cancellation could not be confirmed/.test(x)));
  ok("failed cancellation never announces success",evts("nb-gen-done").length===0&&calls("setGenUrl").length===0);
  delete sandbox.appToast;
}
vm.runInContext(readFileSync("dist/app/props.js","utf8"),sandbox);
reset();
{
  sandbox.propOwnerSheetUrl=async()=>"https://project.test/owner.png";
  sandbox.combinedPropPrompt=()=>"PROP";
  sandbox.propOwnerNote=()=>"Match owner";
  sandbox.nbGetMeta=id=>id==="owner"?{version:4,iso:"owner-v4"}:null;
  const success=await sandbox.generatePropSheet({id:"prop-test",name:"Watch",ownerId:"owner"}, {});
  ok("background prop uses shared successful lifecycle",success&&commits.length===1);
  ok("background prop saves exact owner provenance",commits[0].refs.some(r=>r.refId==="owner"&&r.refVersion===4&&r.refGenerated==="owner-v4"));
}
reset();
{
  genImpl=async()=>{sandbox.nbCancelGen("prop-test");return "data:image/png;base64,RENDER";};
  const success=await sandbox.generatePropSheet({id:"prop-test",name:"Watch",ownerId:"owner"}, {});
  ok("background prop Stop prevents commit and success",!success&&commits.length===0&&evts("nb-gen-done").length===0);
}

/* Explicit location choices cannot be swallowed or dropped by simplified retry. */
for(const gopts of [{},{simple:true},{editInstruction:"Move closer"}]){
  reset();
  await run(env({genUrl:gopts.editInstruction?"existing-frame":"",
    opts:{buildFinal:()=>"FRAME",buildSimple:()=>"SIMPLE",buildEdit:()=>"EDIT",
      attachmentsRequired:true,attachmentsInSimple:true,
      attachments:async()=>{throw new Error("Selected Kitchen state is unavailable");}}}),gopts);
  ok("required location load failure prevents provider spend in "+JSON.stringify(gopts),genCalls.length===0);
  ok("required location load failure keeps existing image",commits.length===0&&calls("setGenUrl").length===0);
  ok("required location error is surfaced",/Selected Kitchen state/.test(lastArg("setGenErr")||""));
}
reset();
{
  await run(env({opts:{buildFinal:()=>"FRAME",attachments:async()=>{
    const error=new Error("Selected room no longer exists");error.requiredReference=true;throw error;
  }}}),{});
  ok("typed required reference failure never becomes text-only fallback",genCalls.length===0&&/no longer exists/.test(lastArg("setGenErr")||""));
}
reset();
{
  await run(env({opts:{buildFinal:()=>"FRAME",attachmentsRequired:true,attachments:async()=>[]}}),{});
  ok("empty required attachment package fails before spend",genCalls.length===0&&/reference images are unavailable/.test(lastArg("setGenErr")||""));
}
reset();
{
  await run(env({opts:{buildFinal:()=>"FRAME",buildSimple:()=>"SIMPLE",
    attachmentsRequired:true,attachmentsInSimple:true,
    attachments:async()=>[{url:"saved-kitchen-state",refId:"room-state",note:"Kitchen · after damage"}],
    attachmentsText:()=>"",
    rebuildPromptAfterAttachments:refs=>"Use "+refs.map(r=>r.refId).join(", ")}}),{simple:true});
  ok("simplified render keeps explicitly selected location bytes",genCalls.length===1&&genCalls[0].opts.extraImages[0]==="saved-kitchen-state");
  ok("simplified render keeps explicit reference prompt",genCalls[0]?.prompt==="Use room-state");
}

/* THE PROMPT BUDGET (2026-10-14, owner — "go ahead with all of it"): a refusal for the prompt's LENGTH takes the same
   simplified retry as "no image", and a retry that re-sends images keeps their reference list (or rebuilds the
   caller's attachment-aware prompt) — it used to send them with no list at all */
for(const [label, err] of [["a server prompt_too_long", Object.assign(new Error("This prompt was longer than GPT Image 2.5 Flare takes, so nothing was sent and nothing was charged."),{promptTooLong:true,code:"prompt_too_long"})],
  ["a provider's own length refusal", new Error("Image model GPT Image 2.5 Flare said: prompt: String should have at most 32000 characters (prompt_too_long)")],
  ["no image", new Error("The model returned no image")]]){
  reset();
  sandbox.window.nbIsPromptLengthError = (e)=>!!(e && (e.promptTooLong || /prompt_too_long|at most [\d,]+ characters/.test(e.message||"")));
  let n = 0;
  genImpl = async () => { if(n++===0) throw err; return "data:image/png;base64,RETRY"; };
  await run(env({opts:{buildFinal:()=>"FULL SPEC",buildSimple:()=>"SIMPLE SPEC",
    attachments:async()=>[{url:"plate",refId:"plate",note:"the parent plate"}],
    attachmentsText:(refs)=>"REFERENCE IMAGES are attached: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+"."}}),{});
  ok(label+": one simplified retry", genCalls.length===2 && /^SIMPLE SPEC/.test(genCalls[1].prompt||""), JSON.stringify(genCalls.map(c=>c.prompt)));
  ok(label+": the retry keeps the images' reference list", (genCalls[1]?.prompt||"").endsWith(" REFERENCE IMAGES are attached: Image 1 = the parent plate.")
    && genCalls[1].opts.extraImages[0]==="plate", genCalls[1]?.prompt);
  ok(label+": the kept image records the simplified prompt", commits.length===1 && commits[0].meta.simplifiedRetry===true && /^SIMPLE SPEC/.test(commits[0].meta.prompt));
}
reset();
{
  sandbox.window.nbIsPromptLengthError = (e)=>!!(e && e.promptTooLong);
  let n = 0;
  genImpl = async () => { if(n++===0) throw Object.assign(new Error("too long"),{promptTooLong:true}); return "data:image/png;base64,RETRY"; };
  await run(env({opts:{buildFinal:()=>"FRAME",buildSimple:()=>"SIMPLE",attachments:async()=>[{url:"sheet",refId:"marcus",note:"Marcus"}],
    attachmentsText:()=>"", rebuildPromptAfterAttachments:(refs,mode)=>mode==="simple" ? "SIMPLE MAP "+refs.map(r=>r.refId).join(",") : "FULL MAP"}}),{});
  ok("a caller's attachment-aware prompt is rebuilt for the retry", genCalls.length===2 && genCalls[1].prompt==="SIMPLE MAP marcus", JSON.stringify(genCalls.map(c=>c.prompt)));
}
reset();
{
  sandbox.window.nbIsPromptLengthError = (e)=>!!(e && e.promptTooLong);
  genImpl = async () => { throw new Error("content moderation hiccup"); };
  await run(env({opts:{buildFinal:()=>"FRAME",buildSimple:()=>"SIMPLE"}}),{});
  ok("any other refusal is not retried", genCalls.length===1);
}
delete sandbox.window.nbIsPromptLengthError;
/* what proxyGenerate trimmed to fit the engine is recorded with the image (review 2026-10-14) — and a retry's
   record is its own, never the refused first try's */
reset();
{
  genImpl = async (prompt, o) => { if(o && o.metaOut) o.metaOut.promptFit = { limit:31500, before:33577, after:31500, steps:["middle cut"] }; return "data:image/png;base64,FIT"; };
  await run(env({opts:{buildFinal:()=>"FRAME"}}),{});
  ok("the image records what had to go", commits.length===1 && JSON.stringify(commits[0].meta.promptFit)===JSON.stringify({limit:31500,before:33577,after:31500,steps:["middle cut"]}), JSON.stringify(commits[0]&&commits[0].meta.promptFit));
}
reset();
{
  sandbox.window.nbIsPromptLengthError = (e)=>!!(e && e.promptTooLong);
  let n = 0;
  genImpl = async (prompt, o) => { if(n++===0){ o.metaOut.promptFit = { steps:["middle cut"] }; throw Object.assign(new Error("too long"),{promptTooLong:true}); } return "data:image/png;base64,RETRY"; };
  await run(env({opts:{buildFinal:()=>"FULL",buildSimple:()=>"SIMPLE"}}),{});
  ok("a retry that fit as it was records nothing trimmed", commits.length===1 && commits[0].meta.promptFit===undefined, JSON.stringify(commits[0]&&commits[0].meta.promptFit));
  delete sandbox.window.nbIsPromptLengthError;
}

console.log(passes + failures === 0 ? "no checks ran" : (failures ? "FAILURES: " + failures + " (of " + (passes + failures) + ")" : "PASS: all " + passes + " checks"));
process.exit(failures ? 1 : 0);

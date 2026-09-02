#!/usr/bin/env node
/* ============================================================================
   HEADLESS RACE TESTS — the sheet-compose coordinator (sbComposeSheet in
   storyboard.jsx). Runs against the MINIFIED dist build with the nb* storage
   layer stubbed, and an injected draw function (the coordinator's documented
   test seam) so frame mutations can be staged deterministically mid-draw and
   mid-commit. Deterministic asserts only — any mismatch exits 1. Run AFTER
   `npm run build`:

     node scripts/test-storyboard-compose.mjs

   Contract under test: ONE writer per sheet id; a compose NEVER commits pixels
   drawn from superseded frames (invalidation during ANY pass, including while
   a commit is saving, forces a redraw against the newest frames); epoch-stale
   and save-error outcomes are quiet/failed respectively — no done event, no
   Clear-hold removal; concurrent requests coalesce onto one promise.
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: "node-test" },
  location: { href: "", search: "", hash: "", origin: "" },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  document: {
    createElement: () => ({ getContext: () => null, style: {}, setAttribute: noop, appendChild: noop }),
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
vm.runInContext(readFileSync("dist/app/storyboard.js", "utf8"), sandbox, { filename: "dist/app/storyboard.js" });

const compose = sandbox.window.sbComposeSheet;
if (typeof compose !== "function") { console.log("FAIL window.sbComposeSheet missing from dist build"); process.exit(1); }

/* ---- instrumented storage stubs (reset per scenario) ---- */
let metaVersion, commits, dispatches, holdClears, epoch, commitHook;
const reset = () => {
  metaVersion = {}; commits = []; dispatches = []; holdClears = 0; epoch = 1; commitHook = null;
  sandbox.nbGetImage = (id) => "img:" + id;                       // frames always warm
  sandbox.nbGetMeta = (id) => ({ iso: "t", version: metaVersion[id] || 1 });
  sandbox.nbLoadImage = async (id) => "img:" + id;
  sandbox.nbEpoch = () => epoch;
  sandbox.nbCommit = async (id, url, meta, refs, kind, ep) => {
    if (commitHook) { const h = commitHook; commitHook = null; await h(); }
    if (ep != null && ep !== epoch) return { tier: "stale", url };
    commits.push({ id, url });
    return { tier: "cloud", url };
  };
  sandbox.dispatchEvent = (e) => { dispatches.push(e && e.type); };
  sandbox.sessionStorage = { getItem: () => null, setItem: noop, removeItem: () => { holdClears++; } };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const page = { id: "pg1", shots: [{ id: "s0" }, { id: "s1" }] };
const scene = {}, ctx = {};

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++;
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};

/* draw fn factory: bumps a shot's meta version during the first `mutations` draws,
   so the post-draw snapshot check sees "frames changed under the draw" */
const drawWithMutations = (mutations) => {
  let n = 0;
  const fn = async () => {
    n++;
    if (n <= mutations) metaVersion.s0 = (metaVersion.s0 || 1) + 1;
    await tick();
    return "canvas-" + n;
  };
  fn.count = () => n;
  return fn;
};

/* 1 — clean compose: one draw, one commit, done event + hold cleared */
reset();
{
  const draw = drawWithMutations(0);
  const res = await compose(scene, page, ctx, null, null, draw);
  ok("clean: composed", res.status === "composed", res.status);
  ok("clean: one draw", draw.count() === 1, "draws=" + draw.count());
  ok("clean: one commit of that canvas", commits.length === 1 && commits[0].url === "canvas-1", JSON.stringify(commits));
  ok("clean: done event fired + hold cleared", dispatches.join() === "nb-gen-done" && holdClears === 1, dispatches.join() + "/" + holdClears);
}

/* 2 — frames mutate during pass 0 AND pass 1: never commit a stale canvas */
reset();
{
  const draw = drawWithMutations(2);   // draws 1 and 2 are invalidated mid-draw
  const res = await compose(scene, page, ctx, null, null, draw);
  ok("mutate p0+p1: composed", res.status === "composed", res.status);
  ok("mutate p0+p1: redrew until stable (3 draws)", draw.count() === 3, "draws=" + draw.count());
  ok("mutate p0+p1: ONLY the stable canvas committed", commits.length === 1 && commits[0].url === "canvas-3", JSON.stringify(commits));
}

/* 3 — coalescing: a second request mid-draw shares the promise; one final commit */
reset();
{
  const draw = drawWithMutations(0);
  const p1 = compose(scene, page, ctx, null, null, draw);
  const p2 = compose(scene, page, ctx, null, null, draw);   // arrives while draw 1 runs
  ok("coalesce: same promise returned", p1 === p2);
  const res = await p1;
  ok("coalesce: composed", res.status === "composed", res.status);
  ok("coalesce: redraw forced, single commit of the fresh canvas",
    draw.count() === 2 && commits.length === 1 && commits[0].url === "canvas-2",
    "draws=" + draw.count() + " " + JSON.stringify(commits));
}

/* 4 — late invalidation DURING the commit save: goes around again, ends newest */
reset();
{
  const draw = drawWithMutations(0);
  let late = null;
  commitHook = async () => { late = compose(scene, page, ctx, null, null, draw); };   // coalesces mid-save
  const res = await compose(scene, page, ctx, null, null, draw);
  ok("late-during-commit: composed", res.status === "composed", res.status);
  ok("late-during-commit: second pass ran after the save", draw.count() === 2, "draws=" + draw.count());
  ok("late-during-commit: final stored sheet is the newest canvas",
    commits.length === 2 && commits[1].url === "canvas-2", JSON.stringify(commits));
  ok("late-during-commit: coalesced caller shared the run", late !== null && (await late).status === "composed");
}

/* 5 — film switch mid-run (epoch): quiet stale — no commit, no event, no hold clear */
reset();
{
  let n = 0;
  const draw = async () => { n++; epoch = 2; await tick(); return "canvas-" + n; };   // switch films mid-draw
  const res = await compose(scene, page, ctx, null, null, draw);
  ok("epoch: stale status", res.status === "stale", res.status);
  ok("epoch: nothing committed, no event, hold kept", commits.length === 0 && dispatches.length === 0 && holdClears === 0,
    JSON.stringify({ commits, dispatches, holdClears }));
}

/* 6 — save failure: failed status — no done event, hold kept */
reset();
{
  sandbox.nbCommit = async () => ({ tier: "error" });
  const res = await compose(scene, page, ctx, null, null, drawWithMutations(0));
  ok("save-error: failed status with message", res.status === "failed" && !!res.error, res.status);
  ok("save-error: no done event, hold kept", dispatches.length === 0 && holdClears === 0);
}

/* 7 — nothing to draw: skipped, silent */
reset();
{
  const res = await compose(scene, page, ctx, null, null, async () => null);
  ok("skip: skipped status", res.status === "skipped", res.status);
  ok("skip: no commit, no event", commits.length === 0 && dispatches.length === 0);
}

/* 8 — sequential runs don't share state: registry entry is released */
reset();
{
  const r1 = await compose(scene, page, ctx, null, null, drawWithMutations(0));
  const r2 = await compose(scene, page, ctx, null, null, drawWithMutations(0));
  ok("sequential: both composed independently", r1.status === "composed" && r2.status === "composed" && commits.length === 2);
}

console.log(failures ? ("FAILED: " + failures + " of " + (passes + failures) + " checks") : ("PASS: all " + passes + " checks"));
process.exit(failures ? 1 : 0);

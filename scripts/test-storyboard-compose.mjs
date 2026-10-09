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
   (2026-10-09, owner — Storyboards review) the sheet ids answer as COMPOSED sheets
   (an uploaded / uncomposed one is kept — upload protection); automatic runs leave
   an up-to-date or restored sheet alone, an explicit Recompose draws, joins a running
   automatic run and makes it draw; a Clear mid-run ends it without a commit; the
   draw's own missing count is recorded and blocks the automatic halves.
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
let metaVersion, commits, dispatches, holdClears, epoch, commitHook, sheetMeta, store;
const reset = () => {
  metaVersion = {}; commits = []; dispatches = []; holdClears = 0; epoch = 1; commitHook = null;
  sheetMeta = { composed: true }; store = {};
  sandbox.nbGetImage = (id) => "img:" + id;                       // frames always warm
  // a sheet id answers as a COMPOSED sheet (no shot ids recorded → never "up to date")
  sandbox.nbGetMeta = (id) => (/^sbsheet-/.test(id) ? sheetMeta : { iso: "t", version: metaVersion[id] || 1 });
  sandbox.nbLoadImage = async (id) => "img:" + id;
  sandbox.nbEpoch = () => epoch;
  sandbox.nbCommit = async (id, url, meta, refs, kind, ep) => {
    if (commitHook) { const h = commitHook; commitHook = null; await h(); }
    if (ep != null && ep !== epoch) return { tier: "stale", url };
    commits.push({ id, url });
    return { tier: "cloud", url };
  };
  sandbox.dispatchEvent = (e) => { dispatches.push(e && e.type); };
  sandbox.sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { if (/^turn_sb_hold_/.test(k)) holdClears++; delete store[k]; } };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const page = { id: "pg1", shots: [{ id: "s0" }, { id: "s1" }] };
const SID = "sbsheet-pg1";
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

/* 3 — coalescing: a second request mid-draw shares the promise; one final commit.
   The run registers after one microtask (await Promise.resolve() — so a run that
   finishes at once can't stay registered), so p2 is issued from INSIDE the first draw */
reset();
{
  let p1, p2 = null, n = 0;
  const draw = async () => {
    n++;
    if (n === 1) p2 = compose(scene, page, ctx, null, null, draw);   // arrives while draw 1 runs
    await tick();
    return "canvas-" + n;
  };
  draw.count = () => n;
  p1 = compose(scene, page, ctx, null, null, draw);
  const res = await p1;
  ok("coalesce: same promise returned", p2 === p1);
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

/* 9 — an UPLOADED sheet is kept by automatic runs; an explicit Recompose draws over it */
reset();
{
  sheetMeta = { uploaded: true, mode: "upload" };
  const draw = drawWithMutations(0);
  const r1 = await compose(scene, page, ctx, null, null, draw);
  ok("upload: automatic run keeps it", r1.status === "kept" && draw.count() === 0 && commits.length === 0, r1.status);
  const r2 = await compose(scene, page, ctx, null, { explicit: true }, draw);
  ok("upload: explicit Recompose draws", r2.status === "composed" && draw.count() === 1 && commits.length === 1, r2.status);
}

/* 10 — G4: an explicit Recompose that meets a running AUTOMATIC run over an upload is never dropped */
reset();
{
  sheetMeta = { uploaded: true, mode: "upload" };
  let release, n = 0;
  sandbox.nbLoadImage = async (id) => { if (/^sbsheet-/.test(id)) await new Promise((r) => { release = r; }); return "img:" + id; };
  sandbox.nbGetImage = (id) => (/^sbsheet-/.test(id) ? "" : "img:" + id);   // the sheet loads slowly
  const draw = async () => { n++; await tick(); return "canvas-" + n; };
  const auto = compose(scene, page, ctx, null, null, draw);
  await tick();                                                          // the automatic run is loading the sheet
  const explicit = compose(scene, page, ctx, null, { explicit: true }, draw);
  release("img:sheet");
  const [ra, re] = await Promise.all([auto, explicit]);
  ok("join: the explicit request drew", re.status === "composed" && n >= 1 && commits.length >= 1, JSON.stringify({ ra, re, n }));
}

/* 11 — an UP-TO-DATE sheet (same shots, same frames, nothing missing) isn't redrawn by an automatic run */
reset();
{
  sheetMeta = { composed: true, shotIds: ["s0", "s1"], frameVersions: ["s0@t#1", "s1@t#1"], missing: 0 };
  const draw = drawWithMutations(0);
  const r1 = await compose(scene, page, ctx, null, null, draw);
  ok("current: automatic run skips it", r1.status === "current" && draw.count() === 0, r1.status);
  const r2 = await compose(scene, page, ctx, null, { explicit: true }, draw);
  ok("current: Recompose still draws", r2.status === "composed" && draw.count() === 1, r2.status);
  metaVersion.s1 = 2;   // a frame re-rendered → out of date → the automatic run draws
  const r3 = await compose(scene, page, ctx, null, null, draw);
  ok("current: a changed frame redraws", r3.status === "composed" && draw.count() === 2, r3.status);
}

/* 12 — a RESTORED version is held until a frame changes after the restore */
reset();
{
  sheetMeta = { composed: true, shotIds: ["s0", "sX"], frameVersions: ["s0@t#1", "sX@t#1"], missing: 0 };   // out of date
  sandbox.sbMarkRestored("p1", SID, page);
  const draw = drawWithMutations(0);
  const pctx = { project: { id: "p1" } };
  const r1 = await compose(scene, page, pctx, null, null, draw);
  ok("restored: held off the automatic redraw", r1.status === "held" && draw.count() === 0, r1.status);
  metaVersion.s0 = 5;   // a frame changes AFTER the restore
  const r2 = await compose(scene, page, pctx, null, null, draw);
  ok("restored: a later frame change redraws, and the hold ends", r2.status === "composed" && !("turn_sb_restored_p1:" + SID in store), r2.status);
}

/* 13 — Clear pressed while a run draws: no commit */
reset();
{
  let n = 0;
  const draw = async () => { n++; store["turn_sb_hold_" + SID] = "1"; await tick(); return "canvas-" + n; };
  const res = await compose(scene, page, ctx, null, null, draw);
  ok("clear mid-run: nothing committed", res.status === "cleared" && commits.length === 0, res.status);
}

/* 14 — the draw's REAL missing count (a frame that wouldn't load) is recorded; no automatic halves */
reset();
{
  let metaSeen = null;
  sandbox.nbCommit = async (id, url, meta) => { if (id === SID) metaSeen = meta; commits.push({ id, url }); return { tier: "cloud", url }; };
  const res = await compose(scene, page, ctx, null, null, async () => ({ dataUrl: "canvas-x", missing: 1, refreshed: ["s1"] }));
  await tick(); await tick();
  ok("missing: composed with missing:1 recorded", res.status === "composed" && metaSeen && metaSeen.missing === 1, JSON.stringify(metaSeen));
  ok("missing: no halves saved", commits.every((c) => !/:half-/.test(c.id)), JSON.stringify(commits));
}

console.log(failures ? ("FAILED: " + failures + " of " + (passes + failures) + " checks") : ("PASS: all " + passes + " checks"));
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/* ============================================================================
   HEADLESS CONTRACT TESTS — storyboard pagination geometry + the Stage
   clip→sheet bridge. Runs against the MINIFIED dist build (the code that
   actually ships), loaded in a node vm with a stubbed window. Deterministic
   asserts only — any mismatch fails the run (exit 1). Run AFTER `npm run build`:

     node scripts/test-storyboard-geometry.mjs

   Why these two: sbPaginateBeats/sbPageRanges (storyboard.jsx) are the single
   source of truth for which 2×2 sheet and which top/bottom half every shot
   lands on, and storyboardClipIds (stage.jsx) consumes that geometry to hand
   the Stage a clip's storyboard halves. A silent edit to either can send the
   Stage the WRONG half of the wrong sheet, or change the meaning of already
   saved "sbsheet-sbpage-…-<index>" assets. The page-id scheme is FROZEN.
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const storage = () => ({ getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 });
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  // React is only touched at load time as React.createElement — a null renderer is fine
  React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
  localStorage: storage(), sessionStorage: storage(),
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
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  fetch: () => Promise.reject(new Error("no network in tests")),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["dist/app/storyboard.js", "dist/app/stage.js"]) {
  vm.runInContext(readFileSync(f, "utf8"), sandbox, { filename: f });
}

let failures = 0, passes = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passes++; }
  else { failures++; console.log("FAIL " + name + "\n  got:  " + g + "\n  want: " + w); }
};

const ranges = sandbox.window.sbPageRanges;
const clipIds = sandbox.window.storyboardClipIds;
if (typeof ranges !== "function") { console.log("FAIL window.sbPageRanges missing from dist build"); process.exit(1); }
if (typeof clipIds !== "function") { console.log("FAIL window.storyboardClipIds missing from dist build"); process.exit(1); }

/* build a scene's ordered shots from a beatN sequence: [1,1,2] → three shots */
const shotsOf = (beatNs) => beatNs.map((n, i) => ({ id: "s" + i, beatN: n }));

/* ---- pagination: pages break on beat boundaries, 4 panels per page ---- */
eq("empty scene → no pages", ranges([]), []);
eq("one shot → one page of 1", ranges(shotsOf([1])), [{ start: 0, count: 1 }]);
eq("exactly four (one beat) → one full page", ranges(shotsOf([1, 1, 1, 1])), [{ start: 0, count: 4 }]);
eq("whole beats pack: 2+2 → one page", ranges(shotsOf([1, 1, 2, 2])), [{ start: 0, count: 4 }]);
eq("whole beats pack: 3+1 → one page", ranges(shotsOf([1, 1, 1, 2])), [{ start: 0, count: 4 }]);
eq("3+2: a beat that would fit a page starts fresh (never splits)", ranges(shotsOf([1, 1, 1, 2, 2])), [{ start: 0, count: 3 }, { start: 3, count: 2 }]);
eq("oversized beat (6) alone splits 4+2, order kept", ranges(shotsOf([1, 1, 1, 1, 1, 1])), [{ start: 0, count: 4 }, { start: 4, count: 2 }]);
eq("2 then oversized 6: fills the open page, then splits", ranges(shotsOf([1, 1, 2, 2, 2, 2, 2, 2])), [{ start: 0, count: 4 }, { start: 4, count: 4 }]);
eq("repeated beat id later = a NEW group (positional grouping)", ranges(shotsOf([5, 5, 2, 2, 5])), [{ start: 0, count: 4 }, { start: 4, count: 1 }]);
eq("five single-shot beats → 4 then 1", ranges(shotsOf([1, 2, 3, 4, 5])), [{ start: 0, count: 4 }, { start: 4, count: 1 }]);
eq("non-contiguous beat ids as supplied", ranges(shotsOf([9, 9, 9, 3, 3, 7])), [{ start: 0, count: 3 }, { start: 3, count: 3 }]);

/* every shot covered exactly once, ranges contiguous from 0 */
const cover = (name, beatNs) => {
  const r = ranges(shotsOf(beatNs));
  let acc = 0, ok = true;
  for (const p of r) { if (p.start !== acc || !(p.count >= 1 && p.count <= 4)) { ok = false; break; } acc += p.count; }
  if (ok && acc === beatNs.length) { passes++; }
  else { failures++; console.log("FAIL coverage " + name + " → " + JSON.stringify(r)); }
};
cover("mixed beats", [1, 1, 1, 2, 2, 2, 2, 2, 3, 4, 4]);
cover("long run", [1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 4]);
cover("all singles", [1, 2, 3, 4, 5, 6, 7, 8, 9]);

/* ---- Stage bridge: clip shot offsets → frozen page ids + top/bottom half ----
   scene of beats 3+2 → irregular pages [3],[2]: geometry the fixed-4 math gets wrong */
const sceneShots = shotsOf([1, 1, 1, 2, 2]).map((s, i) => ({ ...s, sceneId: "scA", order: i }));
sandbox.window.__sbShots = sceneShots;
const clip = (start, count) => ({ scene: { id: "scA" }, g: { index: 0, start, shots: sceneShots.slice(start, start + count) } });
const pid = (n) => "sbsheet-sbpage-scA-2x2-" + n;

let r = clipIds(clip(0, 3));
eq("clip over page0 → one page id", r.pages, [pid(0)]);
eq("cells 0/1 top, cell 2 bottom", r.halves, [pid(0) + ":half-top", pid(0) + ":half-bottom"]);
r = clipIds(clip(2, 2));   // offsets 2,3 → page0 cell2 (bottom), page1 cell0 (top)
eq("clip spanning pages → both page ids in order", r.pages, [pid(0), pid(1)]);
eq("spanning clip halves: bottom of p0 then top of p1", r.halves, [pid(0) + ":half-bottom", pid(1) + ":half-top"]);
r = clipIds(clip(3, 2));   // offsets 3,4 → page1 cells 0,1 → top only
eq("page1 cells 0/1 → single top half", r.halves, [pid(1) + ":half-top"]);

/* every shot offset individually across the irregular ranges */
[[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]].forEach(([pg, cell], n) => {
  const rr = clipIds(clip(n, 1));
  eq("offset " + n + " → page " + pg, rr.pages, [pid(pg)]);
  eq("offset " + n + " → " + (cell < 2 ? "top" : "bottom") + " half", rr.halves, [pid(pg) + ":half-" + (cell < 2 ? "top" : "bottom")]);
});

/* documented fallback ONLY when geometry is unavailable: fixed floor(offset/4) */
const saved = sandbox.window.sbPageRanges;
delete sandbox.window.sbPageRanges;
r = clipIds(clip(4, 1));   // offset 4 → legacy page1 cell0
eq("fallback (no geometry): fixed-4 page", r.pages, [pid(1)]);
eq("fallback (no geometry): fixed-4 half", r.halves, [pid(1) + ":half-top"]);
sandbox.window.sbPageRanges = saved;

console.log(failures ? ("FAILED: " + failures + " of " + (passes + failures) + " checks") : ("PASS: all " + passes + " checks"));
process.exit(failures ? 1 : 0);

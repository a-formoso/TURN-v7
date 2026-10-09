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

/* ---- Stage bridge: a clip → its BEATS' panels → frozen page ids + top/bottom half ----
   (2026-10-09, owner decision — Storyboards geometry review) the board draws ONE keyframe per beat
   (sbBoardShots; without shots.jsx's shotPrimaryOf the beat's first shot), so a clip maps to the board BY
   BEAT: the panel of each beat its shots belong to; an unnumbered shot maps to its own panel. Fixture:
   s0/s1 = beat 1 (s1 an alternative, off the board), s2 = beat 2, s3 = beat 3, s4/s5 unnumbered →
   board [s0,s2,s3,s4,s5]; the two unnumbered shots group together and don't fit the space left, so the
   board pages irregularly as [3],[2] — geometry the fixed-4 math gets wrong. */
const sceneShots = [
  { id: "s0", beatN: 1 }, { id: "s1", beatN: 1 }, { id: "s2", beatN: 2 }, { id: "s3", beatN: 3 },
  { id: "s4" }, { id: "s5" },
].map((s, i) => ({ ...s, sceneId: "scA", order: i }));
sandbox.window.__sbShots = sceneShots;
const byId = (id) => sceneShots.find((s) => s.id === id);
const clipOf = (...ids) => ({ scene: { id: "scA" }, g: { index: 0, start: 0, shots: ids.map(byId) } });
const pid = (n) => "sbsheet-sbpage-scA-2x2-" + n;

eq("board = one keyframe per beat + unnumbered shots", sandbox.window.sbBoardShots(sceneShots).map((s) => s.id), ["s0", "s2", "s3", "s4", "s5"]);
eq("board pages irregularly [3],[2]", ranges(sandbox.window.sbBoardShots(sceneShots)), [{ start: 0, count: 3 }, { start: 3, count: 2 }]);

let r = clipIds(clipOf("s0", "s1"));
eq("a one-beat clip (keyframe + alternative) → its beat's panel", r.clipPanelIds, ["s0"]);
eq("one-beat clip → page 0, top half", [r.pages, r.halves, r.offBoard], [[pid(0)], [pid(0) + ":half-top"], false]);
r = clipIds(clipOf("s1"));
eq("an ALTERNATIVE alone maps to its beat's panel (never off the board)", [r.clipPanelIds, r.halves, r.offBoard], [["s0"], [pid(0) + ":half-top"], false]);
r = clipIds(clipOf("s2", "s3"));
eq("cells 1/2 → top then bottom of page 0", r.halves, [pid(0) + ":half-top", pid(0) + ":half-bottom"]);
r = clipIds(clipOf("s3", "s4"));
eq("clip spanning pages → both page ids in order", r.pages, [pid(0), pid(1)]);
eq("spanning clip halves: bottom of p0 then top of p1", r.halves, [pid(0) + ":half-bottom", pid(1) + ":half-top"]);
r = clipIds(clipOf("s4", "s5"));
eq("page1 cells 0/1 → single top half", r.halves, [pid(1) + ":half-top"]);
r = clipIds(clipOf("s1", "s2"));
eq("alternative + next beat → beat 1 and beat 2 panels (cells 0/1 → top)", [r.clipPanelIds, r.halves], [["s0", "s2"], [pid(0) + ":half-top"]]);
r = clipIds({ scene: { id: "scA" }, g: { index: 0, start: 0, shots: [{ id: "gone" }] } });
eq("a clip none of whose beats has a panel is off the board", [r.offBoard, r.pages, r.halves, r.sheet], [true, [], [], ""]);

/* every board panel individually across the irregular ranges */
[["s0", 0, 0], ["s2", 0, 1], ["s3", 0, 2], ["s4", 1, 0], ["s5", 1, 1]].forEach(([id, pg, cell]) => {
  const rr = clipIds(clipOf(id));
  eq(id + " → page " + pg, rr.pages, [pid(pg)]);
  eq(id + " → " + (cell < 2 ? "top" : "bottom") + " half", rr.halves, [pid(pg) + ":half-" + (cell < 2 ? "top" : "bottom")]);
});

/* G7: a shot's sheet position in the Stage's prompt is its BEAT's panel; none when its beat has no panel */
const panelMeta = sandbox.stageSheetPanelMeta;
if (typeof panelMeta === "function") {
  const m = panelMeta({ start: 1, shots: [byId("s1")] }, 0, { id: "scA" });
  eq("alternative s1 → beat 1's panel (sheet 1, panel 1, top)", [m.page, m.panel, m.half], [1, 1, "top"]);
  const m2 = panelMeta({ start: 4, shots: [byId("s4")] }, 0, { id: "scA" });
  eq("s4 → sheet 2, panel 1", [m2.page, m2.panel, m2.half], [2, 1, "top"]);
  const m3 = panelMeta({ start: 0, shots: [{ id: "gone" }] }, 0, { id: "scA" });
  eq("a shot with no panel → no sheet position", [m3.page, m3.panel, m3.half], [null, null, null]);
} else { failures++; console.log("FAIL stageSheetPanelMeta missing from dist build"); }

/* documented fallback ONLY when geometry is unavailable: fixed floor(board index/4) */
const saved = sandbox.window.sbPageRanges;
delete sandbox.window.sbPageRanges;
r = clipIds(clipOf("s5"));   // board index 4 → legacy page1 cell0
eq("fallback (no geometry): fixed-4 page", r.pages, [pid(1)]);
eq("fallback (no geometry): fixed-4 half", r.halves, [pid(1) + ":half-top"]);
sandbox.window.sbPageRanges = saved;

console.log(failures ? ("FAILED: " + failures + " of " + (passes + failures) + " checks") : ("PASS: all " + passes + " checks"));
process.exit(failures ? 1 : 0);

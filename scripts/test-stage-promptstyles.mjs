#!/usr/bin/env node
/* ============================================================================
   HEADLESS PROMPT-STYLE TESTS — seedanceRecipePrompt / stageSmartRecipe
   (stage.jsx). Runs against the MINIFIED dist build in a stubbed vm sandbox
   and asserts the exact prompt structures each user-facing style produces:
   Auto (micro-beat director brief / 2.5 whole-scene brief), Narrative
   paragraph, Timeline windows (including single-shot micro-beat stamping),
   Shot list (panels), Structured fields and Dialogue/lip-sync — plus the
   standing AUDIO & OVERLAYS trailer on every one. Deterministic asserts
   only — any mismatch exits 1. Run AFTER `npm run build`:

     node scripts/test-stage-promptstyles.mjs
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
vm.runInContext(readFileSync("dist/app/stage.js", "utf8"), sandbox, { filename: "dist/app/stage.js" });

const recipePrompt = sandbox.window.seedanceRecipePrompt;
const smartRecipe = sandbox.window.stageSmartRecipe;
const RECIPES = sandbox.window.SEEDANCE_RECIPES;
if (typeof recipePrompt !== "function") { console.log("FAIL window.seedanceRecipePrompt missing from dist build"); process.exit(1); }
if (typeof smartRecipe !== "function") { console.log("FAIL window.stageSmartRecipe missing from dist build"); process.exit(1); }
if (!Array.isArray(RECIPES)) { console.log("FAIL window.SEEDANCE_RECIPES missing from dist build"); process.exit(1); }

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++;
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};

/* ---- fixture: one beat, two shots, one spoken line, a 3-item micro plan ---- */
const sh1 = { id: "a", beatN: 1, action: "Mara grips the rail.", dur: 4 };
const sh2 = { id: "b", beatN: 1, action: "Jonas turns to her.", dialogue: "Go now", dur: 6,
  lineAudio: { speaker: "Jonas", text: "Go now", durationMs: 1200 } };
const p1 = { shotId: "a", beatN: 1, text: "Mara grips the rail", script: "Mara grips the rail.",
  micro: ["Mara grips the rail", "Her knuckles whiten", "She lets go"] };
const p2 = { shotId: "b", beatN: 1, text: "Jonas turns", script: "Jonas turns.",
  dialogue: "Go now", speaker: { name: "Jonas" } };
const mkClip = (over) => ({ id: "c1", label: "Clip 1", scene: { id: "s1", title: "Rooftop Deal", loc: "Rooftop" },
  data: { shots: [sh1, sh2], panelLines: [p1, p2], cast: [{ name: "Mara" }, { name: "Jonas" }],
    setting: "Rain-slick rooftop", lighting: "sodium light", camera: "slow push in",
    preset: { name: "Neo Noir", grade: "teal shadows" }, dur: 10, first: sh1,
    lineShots: [sh2], lead: "Mara", ...(over || {}) } });
const EX = { explicitStyle: true };
const trailerRe = /AUDIO & OVERLAYS: .*NO background music/;

/* ---- registry ---- */
ok("recipes registry ids", ["narrative", "panels", "timeline", "structured", "lipsync"]
  .every(id => RECIPES.some(r => r[0] === id)), JSON.stringify(RECIPES.map(r => r[0])));

/* ---- explicit TIMELINE, two shots (dialogue window + placement) ---- */
{
  const out = recipePrompt("timeline", mkClip(), [sh1, sh2], sh1, true, ["b"], null, EX);
  ok("timeline: continuous head", out.indexOf("One continuous 10s clip") >= 0, out.slice(0, 120));
  ok("timeline: window lines", (out.match(/^\d+(\.\d+)?–\d+(\.\d+)?s: /gm) || []).length === 2, out);
  ok("timeline: spoken line quoted", out.indexOf('Jonas says "Go now"') >= 0, out);
  ok("timeline: lip-sync token", out.indexOf("@Audio1") >= 0, out);
  ok("timeline: trailer", trailerRe.test(out));
  ok("timeline: no director brief", out.indexOf("Micro-beat action plan") < 0, out);
}

/* ---- explicit TIMELINE, single silent shot → micro-beats get the stamps ---- */
{
  const out = recipePrompt("timeline", mkClip(), [sh1], sh1, true, [], null, EX);
  const wins = out.match(/^\d+(\.\d+)?–\d+(\.\d+)?s: /gm) || [];
  ok("timeline micro: three windows", wins.length === 3, JSON.stringify(wins));
  ok("timeline micro: first stamp", out.indexOf("0–3.3s: Mara grips the rail.") >= 0, out);
  ok("timeline micro: last stamp", out.indexOf("6.7–10s: She lets go.") >= 0, out);
  ok("timeline micro: trailer", trailerRe.test(out));
}

/* ---- explicit STRUCTURED ---- */
{
  const out = recipePrompt("structured", mkClip(), [sh1, sh2], sh1, true, [], null, EX);
  ok("structured: subject field", /^Subject: .*Mara/m.test(out), out);
  ok("structured: camera field", out.indexOf("Camera: slow push in.") >= 0, out);
  ok("structured: style field", out.indexOf("Style: Neo Noir — teal shadows.") >= 0, out);
  ok("structured: dialogue quoted", out.indexOf('"Go now"') >= 0, out);
  ok("structured: trailer", trailerRe.test(out));
}

/* ---- explicit NARRATIVE — one flowing paragraph, no labelled brief ---- */
{
  const out = recipePrompt("narrative", mkClip(), [sh1], sh1, true, [], null, EX);
  const body = out.split("\nAUDIO & OVERLAYS")[0];
  ok("narrative: single paragraph", body.indexOf("\n") < 0, JSON.stringify(body));
  ok("narrative: micro-beats as prose", body.indexOf(", then ") >= 0, body);
  ok("narrative: camera clause separated", body.indexOf("Camera: ") >= 0 && body.indexOf("separate") >= 0, body);
  ok("narrative: not the labelled brief", !/^Subject: /m.test(body), body);
  ok("narrative: trailer", trailerRe.test(out));
}

/* ---- explicit SHOT LIST (panels) ---- */
{
  const out = recipePrompt("panels", mkClip(), [sh1, sh2], sh1, true, [], null, EX);
  ok("panels: shot units", out.indexOf("SHOT 1") >= 0 && out.indexOf("SHOT 2") >= 0, out.slice(0, 200));
  ok("panels: continuity rules", out.indexOf("Continuity rules:") >= 0);
  ok("panels: trailer", trailerRe.test(out));
}

/* ---- explicit DIALOGUE / LIP-SYNC ---- */
{
  const out = recipePrompt("lipsync", mkClip(), [sh1, sh2], sh2, true, ["b"], null, EX);
  ok("lipsync: audio pairing", out.indexOf("@Audio1") >= 0, out);
  ok("lipsync: delivers the line", out.indexOf('"Go now"') >= 0, out);
  ok("lipsync: trailer", trailerRe.test(out));
}

/* ---- AUTO (no explicitStyle) keeps the researched director brief ---- */
{
  const out = recipePrompt("timeline", mkClip(), [sh1, sh2], sh1, true, [], null);
  ok("auto: micro-beat director brief", out.indexOf("micro-beats in exact order") >= 0, out.slice(0, 300));
  ok("auto: performance rule", out.indexOf("Performance: grounded") >= 0, out);
  ok("auto: not time-coded", !/^\d+(\.\d+)?–\d+(\.\d+)?s: /m.test(out), out);
}

/* ---- AUTO whole-scene (Seedance 2.5) ---- */
{
  const out = recipePrompt(null, mkClip(), [sh1, sh2], sh1, true, [], null, { wholeScene: true });
  ok("whole-scene: one-take header", out.indexOf("ONE CONTINUOUS SCENE") >= 0, out.slice(0, 120));
  ok("whole-scene: beat section", /^BEAT 1$/m.test(out), out);
  ok("whole-scene: trailer", trailerRe.test(out));
}

/* ---- explicit style WINS over whole-scene opts (2.5 + a named style) ---- */
{
  const out = recipePrompt("timeline", mkClip(), [sh1, sh2], sh1, true, [], null, { wholeScene: true, explicitStyle: true });
  ok("2.5 explicit: time-coded, not one-take", out.indexOf("One continuous 10s clip") >= 0 && out.indexOf("ONE CONTINUOUS SCENE") < 0, out.slice(0, 160));
}

/* ---- smart default mapping (what "Auto" resolves to) ---- */
{
  const one = { data: { shots: [sh2], lineShots: [sh2] } };
  ok("smart: dialogue single shot → lipsync", smartRecipe(one, "frame", "seedance-2.0") === "lipsync");
  ok("smart: storyboard source → panels", smartRecipe({ data: { shots: [sh1, sh2] } }, "sheet", "seedance-2.0") === "panels");
  ok("smart: multi-shot → timeline", smartRecipe({ data: { shots: [sh1, sh2] } }, "frames", "seedance-2.0") === "timeline");
  ok("smart: single silent shot → narrative", smartRecipe({ data: { shots: [sh1] } }, "frame", "seedance-2.0") === "narrative");
}

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);

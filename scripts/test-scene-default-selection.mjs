#!/usr/bin/env node
/* Source-level regression contract for the Writers' Room's initial scene/panel handoff. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const app = readFileSync("app/app.jsx", "utf8");
const ai = readFileSync("app/ai.jsx", "utf8");
const html = readFileSync("TURN.html", "utf8");

assert.match(app, /function turnFirstStoryScene\(scenes\)[\s\S]{0,220}?scenesInStoryOrder\(scenes\)/,
  "the default must follow canonical screenplay order");
assert.match(app, /const inspOpenRef = React\.useRef\(inspOpen\); inspOpenRef\.current = inspOpen;/,
  "async hydration must read the current Inspector state");
assert.match(app, /if\(inspOpenRef\.current && _firstScene\)\{[\s\S]{0,180}?setSelId\(_firstScene\.id\);[\s\S]{0,120}?setRailOpen\(false\);/,
  "loading a film into an open Inspector must select Scene 1 and close the Story rail");
assert.match(app, /const hadScenesRef = React\.useRef\(scenes\.length>0\);[\s\S]{0,280}?const justGainedFirstScene = !hadScenes;[\s\S]{0,180}?setSelId\(first\.id\);[\s\S]{0,100}?setRailOpen\(false\);/,
  "new asynchronously built stories must receive the same handoff without overriding a valid selection");
assert.match(ai, /When a story loads after sign-in with the right Inspector open,[\s\S]{0,320}?newly created story first gains scenes/,
  "MUSE capability knowledge must describe the behavior");
assert.match(html, /app\/app\.jsx\?v=20260911-series\d+/);
assert.match(html, /app\/ai\.jsx\?v=20260911-series\d+/);

console.log("PASS first-scene defaults and mutually focused Writers' Room panels (7 assertions)");

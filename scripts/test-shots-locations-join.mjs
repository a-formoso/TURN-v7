#!/usr/bin/env node
/* Shots and Locations point at each other (owner 2026-11-25, after a walk through both tabs): the scene header's place
   is a link with its hour, a frame's Uses says which hour's image it takes, a shot's Previs opens the place's set, the
   location card's scenes carry their hours, its facts count no cameras, and a stale image says so on its step. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n    ")); } };
const shots = read("app/shots-ui.jsx"), locs = read("app/locations-ui.jsx"), app = read("app/app.jsx"), card = read("app/location-set-card.js"), css = read("app/styles.css"), ai = read("app/ai.jsx"), html = read("TURN.html");
const fn = (src, name) => { const i = src.indexOf("function " + name + "("); assert.ok(i >= 0, name); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); } } throw new Error("unclosed " + name); };

test("1 the hour of a reference and of a scene, in sentence case", () => {
  const c = vm.createContext({}); c.window = c;
  c.parseSlugline = raw => { const m = /-\s*([A-Z -]+)$/.exec(String(raw)); return m ? { time: m[1].trim() } : null; };
  vm.runInContext([fn(shots, "shotSceneHour"), fn(shots, "shotHourWords"), fn(shots, "shotRefHour")].join("\n"), c);
  assert.equal(c.shotHourWords("DAWN"), "Dawn"); assert.equal(c.shotHourWords("pre-dawn"), "Pre-Dawn"); assert.equal(c.shotHourWords(""), "");
  assert.equal(c.shotSceneHour({ loc: "INT. KITCHEN - DAWN" }), "Dawn"); assert.equal(c.shotSceneHour({ loc: "" }), ""); assert.equal(c.shotSceneHour(null), "");
  assert.equal(c.shotRefHour("Kitchen — Slugline Unit INT plate at Dawn", "Kitchen"), "Dawn");
  assert.equal(c.shotRefHour("Kitchen · INT · Night", "Kitchen"), "Night");
  assert.equal(c.shotRefHour("Kitchen · INT · late-night · storm", "Kitchen"), "Late-night");
  assert.equal(c.shotRefHour("Kitchen", "Kitchen"), "", "the location image itself has no hour");
  assert.equal(c.shotRefHour("Night Market — Required Space Plate", "Night Market"), "", "an hour in the place's own name is not its hour");
});

test("2 Shots: the header's place is a link with its hour; Uses names the hour; Previs opens the place's set", () => {
  assert.ok(shots.includes('"data-testid":"scene-location-link",title:"Open "+loc.name+" in Locations"') && shots.includes("onClick:()=>window.turnOpenLocationCard(loc.id)}, text)"));
  assert.ok(shots.includes('const hour = shotSceneHour(scene), text = loc ? loc.name+(hour ? " · "+hour : "") : "—";'));
  assert.ok(shots.includes('r.kind==="location" ? nm+" image"+(hour ? " · "+hour : "")'));
  assert.ok(shots.includes('"data-testid":"shot-face-open-set"') && shots.includes('onClick:()=>window.turnOpenLocationCard(drawColour.loc.id)},"Open this place’s set")'));
  assert.ok(css.includes(".ssx-loc-link{") && css.includes(".loc-step-stale{"));
});

test("3 Locations: scenes with their hours, facts without a camera count, a stale image said on its step", () => {
  assert.ok(locs.includes('label:String(s.no).padStart(2,"0")+(sceneTimeOf[String(s.no)] ? " \\u00b7 "+(typeof window.shotHourWords==="function"'));
  assert.ok(locs.includes("onClick:()=>onChipClick&&onChipClick(s.id)"), "a scene chip still shows that scene's places");
  assert.ok(!/cams\+\(cams===1\?" camera":" cameras"\)/.test(card));
  assert.ok(locs.includes('done:!!gen.genUrl&&!imageStale,stale:!!gen.genUrl&&imageStale,') && locs.includes('st.stale&&E("span",{className:"loc-step-stale","data-testid":"location-step-stale"},"out of date")'));
  // the steps as the tracker lists them: stale only while the image is there and not done
  const c = vm.createContext({}); vm.runInContext(fn(locs, "locationGuideSteps"), c);
  const steps = c.locationGuideSteps([{ n: 1, done: true }, { n: 2, done: true }, { n: 3, done: true }, { n: 4, done: true }, { n: 5, done: false, stale: true, todo: "Make the image again" }]);
  assert.equal(steps[3].stale, true); assert.equal(steps[3].next, true);
  assert.equal(c.locationGuideSteps([{ n: 5, done: true, stale: false }])[3].stale, false);
  assert.equal(c.locationGuideSteps([{ n: 5, done: false }])[3].stale, false, "no image yet is not a stale image");
});

test("4 a scene's shots can be opened from anywhere in the Art Room; fresh keys; Frances knows", () => {
  assert.ok(app.includes("window.turnOpenSceneShots = (sceneId)=>{") && app.includes('window.turnFocusArtScene("shots", sceneId);'));
  for (const f of ["app/app.jsx", "app/shots-ui.jsx", "app/location-set-card.js", "app/locations-ui.jsx", "app/styles.css", "app/ai.jsx", "app/script.jsx"])
    assert.ok(["20261125-join1", "20261125-join2"].some(k => html.includes(f + "?v=" + k + '"')), f + " has this change's key");
  assert.ok(/SHOTS AND LOCATIONS POINT AT EACH OTHER \(2026-11-25\)/.test(ai) && /marked 'out of date' on the step itself/.test(ai));
  assert.ok(!/Hussain|Liaqat|Pike\b/.test(ai), "no film's own names in what Frances is told");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

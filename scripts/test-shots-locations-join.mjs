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
  assert.ok(css.includes(".location-scenes .prop-scene-chip{white-space:nowrap}"), "a chip stays on one line");
});

test("3 Locations: scenes with their hours, facts without a camera count, a stale image said on its step", () => {
  // (owner 2026-11-26: "instead of showing (01) night, just show the number") the chip is the scene's number, as on a
  // character's or a prop's card; its hour is in its tooltip
  assert.ok(locs.includes('items: locScenes.map(s=>({ key:s.id, label:String(s.no).padStart(2,"0"), className:"prop-scene-chip",'));
  assert.ok(locs.includes('title:(s.title||("Scene "+s.no))+(sceneTimeOf[String(s.no)]?" \\u00b7 "+sceneTimeOf[String(s.no)].join(", "):"")'), "the hour is in the tooltip");
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
  // (2026-11-25) a scene hand-off lands at the top of the scene: the Art Room's page keeps its scroll from tab to tab
  assert.ok(shots.includes('const top = ()=>{ const page = document.querySelector(".artroom"); if(page && page.scrollTop) page.scrollTop = 0; };') && shots.includes("top(); setTimeout(top, 120);"));
  assert.ok(shots.indexOf("top(); setTimeout(top, 120);") > shots.indexOf('if(String(f.action||"").indexOf("shot:")===0){'), "only when the hand-off names no shot");
  for (const f of ["app/app.jsx", "app/shots-ui.jsx", "app/location-set-card.js", "app/locations-ui.jsx", "app/styles.css", "app/ai.jsx", "app/script.jsx"])
    assert.ok(["20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1"].some(k => html.includes(f + "?v=" + k + '"')), f + " has this change's key");
  assert.ok(/SHOTS AND LOCATIONS POINT AT EACH OTHER \(2026-11-25\)/.test(ai) && /marked 'out of date' on the step itself/.test(ai));
  assert.ok(!/Hussain|Liaqat|Pike\b/.test(ai), "no film's own names in what Frances is told");
});

test("5 the scenes shot here: each planned scene of a place with its marks and its shots' cameras; the plan draws them", () => {
  const c = vm.createContext({ console }); c.window = c; vm.runInContext(card, c);
  const K = c.KinolotSetCard, plain = v => JSON.parse(JSON.stringify(v));
  const scenes = [{ id: "s1", no: 2, title: "one payment left" }, { id: "s2", no: 5, title: "shoes on" }, { id: "s3", no: 8, title: "elsewhere" }];
  const project = { scenePlans: {
    s2: { sets: [{ id: "set1", locationId: "flat" }, { id: "set2", locationId: "street" }],
      marks: [{ id: "m1", set: "set1", xy: [0, 0.1], name: "on the threshold" }, { id: "m2", set: "set1", xy: [0.1, 0.6], name: "by the shelf" }, { id: "m3", set: "set2", xy: [5, -3], name: "at the kerb" }],
      cameras: { "1.1": { at: [0.4, 1.2], lens: 24 }, "2.1": { at: [1, 1.2], lens: 21 }, "5.3": { at: [1.5, -0.7], lens: 35 }, "9.9": { at: ["x", 1] } } },
    s1: { sets: [{ id: "set1", locationId: "flat" }], marks: [{ id: "a", set: "set1", xy: [1, 1], name: "at the table" }], cameras: {} },
    s3: { sets: [{ id: "set1", locationId: "park" }], marks: [{ id: "p", set: "set1", xy: [2, 2] }], cameras: { "1.1": { at: [2, 2] } } } } };
  const shotsOf = [{ sceneId: "s2", planSet: "set1", k: "2.1" }, { sceneId: "s2", planSet: "set1", k: "1.1" }, { sceneId: "s2", planSet: "set2", k: "5.3" },
    { sceneId: "s2", planSet: "set1", k: "9.9" }, { sceneId: "s2", planSet: "set1", k: "2.1" }, { sceneId: "s3", planSet: "set1", k: "1.1" }];
  const here = plain(K.shotScenes(project, ["flat"], scenes, shotsOf, sh => sh.k));
  assert.deepEqual(here.map(x => [x.sceneId, x.sceneNo, x.title, x.marks]), [["s1", 2, "One payment left", 1], ["s2", 5, "Shoes on", 2]], "in story order; a scene set elsewhere is not listed");
  assert.deepEqual(here[1].cameras, [{ key: "1.1", at: [0.4, 1.2], lens: 24 }, { key: "2.1", at: [1, 1.2], lens: 21 }], "only the cameras of shots in this set, once each, in order; one with no numbers is left out");
  assert.deepEqual(plain(K.shotScenes(project, ["street"], scenes, shotsOf, sh => sh.k)).map(x => x.cameras.map(c => c.key)), [["5.3"]]);
  assert.deepEqual(plain(K.shotScenes(project, ["flat"], scenes, null, null)).map(x => x.cameras.length), [0, 0], "with no shots to read, the scenes are still listed by their marks");
  // the marks of the chosen scene alone
  assert.equal(K.marks(project, ["flat"], scenes).sceneId, "s1"); assert.equal(K.marks(project, ["flat"], scenes, "s2").sceneId, "s2");
  assert.deepEqual(plain(K.marks(project, ["flat"], scenes, "s2").marks.map(m => m.letter + " " + m.name)), ["A On the threshold", "B By the shelf"]);
  assert.equal(K.marks(project, ["flat"], scenes, "s3"), null);
  // on the plan: a dot for each camera that is in the picture
  const plan = { spaces: [{ id: "flat", name: "Flat", footprint: [[-0.5, 0], [3.7, 0], [3.7, 3.6], [-0.5, 3.6]] }], openings: [], cameras: [] };
  const m = K.planModel(plan, { id: "flat" }, "", null, 440, here[1].cameras.concat([{ key: "7.7", at: [400, 400] }]));
  assert.deepEqual(plain(m.shots.map(x => x.key)), ["1.1", "2.1"], "a camera far outside the picture is not drawn");
  assert.ok(m.shots.every(x => x.at[0] >= 0 && x.at[0] <= m.W && x.at[1] >= 0 && x.at[1] <= m.H));
  // cameras that stand on top of each other: the first has its number, the next only its dot
  const crowd = K.planModel(plan, { id: "flat" }, "", null, 440, [{ key: "1.1", at: [1, 1] }, { key: "1.2", at: [1.02, 1.01] }, { key: "1.3", at: [3, 3] }]);
  assert.deepEqual(plain(crowd.shots.map(x => [x.key, x.label])), [["1.1", true], ["1.2", false], ["1.3", true]]);
  assert.deepEqual(plain(K.planModel(plan, { id: "flat" }, "", null, 440).shots), [], "none chosen: none drawn");
  // the card: the picker, the dots, the way to the scene's shots
  const face = read("app/location-set-card-ui.jsx");
  assert.ok(face.includes("const shotHere = K.shotScenes(project, [space.id], scenes, filmShots, keyOf);") && face.includes('const found = K.marks(project, [space.id], scenes, sceneNow ? sceneNow.sceneId : "");'));
  assert.ok(face.includes('"data-testid":"set-card-scene"') && face.includes('onClick:()=>window.turnOpenSceneShots(sceneNow.sceneId) },"Open this scene\\u2019s shots")') && face.includes('className:"lsc-shotcam"'));
  assert.ok(css.includes(".lsc-shotcam circle{") && css.includes(".lsc-scene-row{"));
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

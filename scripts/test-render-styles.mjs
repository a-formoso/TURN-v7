#!/usr/bin/env node
/* The render styles (owner 2026-11-17: "look at render styles … geared towards filmmakers and people looking to produce
   TV series … also projects for children … appeal to all the different markets possible with AI video. I approve the
   change. Trust your judgment and taste.").

   A  Twenty looks are added after the first forty-one: live action (film stocks and genres), television animation,
      children's work, and four illustration and craft looks. The first forty-one keep their keys and their order, so
      a card that already has a style, and the menu's default, are as they were.
   B  Every style is complete: a prompt block with its rules, a menu label, a description and one group.
   C  A prompt names no studio, franchise, person or product (the rule the crime-game style already followed); the
      menu's own labels are untouched.
   D  Live action is recognised as photography everywhere: its keys start "photoreal" (shots, locations) and sit in
      the "Photoreal" group (likeness); Cinematic horror sits with them.
   E  The new looks have their own wording for locations and props, and the live-action ones for shots.

     node scripts/test-render-styles.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };

const art = read("app/artroom.jsx"), locs = read("app/locations.jsx"), props = read("app/props.jsx"), shots = read("app/shots.jsx"), ai = read("app/ai.jsx");
const box = { console, Object, String, JSON, Array };
box.window = box; vm.createContext(box);
vm.runInContext(between(art, "const CHAR_SHEET_BACKGROUND = ", "function _renderStyleGroupFor(k)").replace(/^const /gm, "var "), box);
vm.runInContext(between(art, "function _renderStyleGroupFor(k){", "function _styleScaleClassKey(e){").replace(/^const /gm, "var "), box);
vm.runInContext(between(art, "const SURPRISE_STYLE_OFFERED = false;", "window.CHAR_RENDER_STYLE_OPTIONS = CHAR_RENDER_STYLE_OPTIONS;").replace(/^const /gm, "var ") + "; window.CHAR_RENDER_STYLE_OPTIONS = CHAR_RENDER_STYLE_OPTIONS;", box);
vm.runInContext(between(locs, "const LOC_RENDER_TEXT = {", "function locVisualsDrafted(").replace(/^const /gm, "var "), box);
vm.runInContext(between(props, "const PROP_RENDER_TEXT = {", "window.PROP_RENDER_TEXT = PROP_RENDER_TEXT;").replace(/^const /gm, "var ") + "; window.PROP_RENDER_TEXT = PROP_RENDER_TEXT;", box);
vm.runInContext(between(shots, "const SHOT_RENDER_TEXT = {", "function shotRenderStyleKey(").replace(/^const /gm, "var "), box);
vm.runInContext(shots.split("\n").find((l) => l.startsWith("function shotStyleIsPhotoreal(")), box);
const J = (v) => JSON.parse(JSON.stringify(v));
const STYLES = J(box.CHAR_RENDER_STYLES), LABELS = J(box.RENDER_STYLE_LABELS), DESCS = J(box.RENDER_STYLE_DESCRIPTIONS), GROUPS = J(box.RENDER_STYLE_GROUPS);
const LOC = J(box.LOC_RENDER_TEXT), PROP = J(box.PROP_RENDER_TEXT), SHOT = J(box.SHOT_RENDER_TEXT), NAMES = J(box.RENDER_STYLE_PROMPT_NAMES);
const KEYS = Object.keys(STYLES);

const FIRST = ["photoreal", "photorealNatural", "photorealCreature", "photorealOrnamental", "render3d", "anime", "flat", "horror", "ghibli", "animated3d", "pixar",
  "paintedconcept", "storyboardconcept", "texturedcomic", "gtaLoadingScreen", "whimsicalwatercolor", "stopmotion", "adv1960s", "claymation", "gaganime", "pixelart",
  "modernAnime", "digitalAnime", "roughSketchAnime", "painterlyAnime", "cartoon3d", "textured3dCartoon", "stylizedCartoon", "grittyDigital", "softPainterly",
  "realisticDigitalDrawing", "flatDesign", "minimalistLine", "vintageChildrensBook", "tactileMixedMedia", "texturedPaperSculpture", "texturedPaperIllustration",
  "tropicalArtNouveau", "graphicNovelNoir", "ukiyoe", "paperCutout"];
const NEW = ["photorealFilm35", "photorealMono", "photorealDoc", "photorealBright", "photorealEpic", "photorealNeon", "retroAnime80s", "painted3dHybrid", "saturdayCartoon",
  "adultAnimation", "rubberHose", "lowPoly", "preschoolCartoon", "pictureBookGouache", "crayonDrawing", "toyBrick", "comicBook", "rotoscope", "oilPainting", "shadowPuppet"];

test("A twenty looks after the first forty-one: every old key is still there, in its place; the default is still the first", () => {
  assert.equal(FIRST.length, 41); assert.equal(NEW.length, 20);
  assert.deepEqual(KEYS, FIRST.concat(NEW), "a card's saved style key is never renamed, removed or moved");
  assert.equal(KEYS[0], "photoreal", "the menu's default is its first style");
  assert.ok(KEYS.length <= 100, "inside the shared cap of 100");
});

test("B every style is complete: a prompt block with its rules, a label, a description and exactly one group", () => {
  for (const k of KEYS) {
    const s = STYLES[k];
    assert.ok(typeof s.rendering === "string" && s.rendering.length > 60, k + ": rendering");
    assert.ok(typeof s.background === "string" && s.background.length > 20, k + ": background");
    assert.ok(Array.isArray(s.rules) && s.rules.length >= 4, k + ": rules");
    assert.ok(s.rules.some((r) => /^no text\b/.test(r)), k + ": no text on the image");
    assert.ok(s.rules.some((r) => /panel layout|concept-sheet layout/.test(r)), k + ": the sheet's layout");
    assert.ok(LABELS[k], k + ": label"); assert.ok(DESCS[k] && /^For /.test(DESCS[k]), k + ": description");
    assert.equal(GROUPS.filter((g) => g.keys.includes(k)).length, 1, k + ": one group");
  }
  const grouped = GROUPS.flatMap((g) => g.keys);
  assert.deepEqual(grouped.slice().sort(), KEYS.slice().sort(), "the groups hold every style and nothing else");
  assert.equal(new Set(Object.values(LABELS)).size, Object.values(LABELS).length, "no two styles share a label");
  // a new look takes its colours from the character, never from a fixed cast
  for (const k of NEW) assert.ok(/THIS character's own/.test(JSON.stringify(STYLES[k])), k + " defers to the character's own colours and materials");
});

test("C a prompt names no studio, franchise, person or product; the menu's labels are as they were", () => {
  const NAMED = /pixar|ghibli|miyazaki|disney|dreamworks|\blaika\b|del toro|\bgta\b|grand theft|\blego\b|renderman|\barnold\b|\boctane\b|\bredshift\b|spider-verse|\barcane\b|peppa|\bbluey\b|simpsons|family guy|cuphead|playstation|nintendo|\bkodak\b|\bmarvel\b|\bdc comics\b|pokemon|minecraft|netflix|\bhbo\b/i;
  // (what is SENT: the values; a style's key is never sent)
  const vals = (o) => JSON.stringify(Object.values(o));
  const prompts = { blocks: vals(STYLES), locations: vals(LOC), props: vals(PROP), shots: vals(SHOT), names: vals(NAMES) };
  for (const [where, text] of Object.entries(prompts)) { const m = NAMED.exec(text); assert.ok(!m, where + " names “" + (m && m[0]) + "”: …" + (m ? text.slice(Math.max(0, m.index - 50), m.index + 40) : "")); }
  // the style's name inside a prompt: the look, where the menu's label names a studio or a franchise
  assert.deepEqual(NAMES, { gtaLoadingScreen: "open-world crime-game loading-screen art", ghibli: "hand-painted pastoral 2D anime", pixar: "family animated-feature 3D" });
  // (owner 2026-11-17: "rename the three styles") the menu names no studio or game either; a sheet saved under an old
  // name is read as today's where it is shown (stored data is never migrated)
  assert.equal(LABELS.ghibli, "Hand-painted pastoral anime"); assert.equal(LABELS.pixar, "Family feature 3D"); assert.equal(LABELS.gtaLoadingScreen, "Crime-game poster art");
  assert.ok(!/pixar|ghibli|\bgta\b/i.test(JSON.stringify(Object.values(LABELS)) + JSON.stringify(Object.values(DESCS))), "no studio or game in a label or a description");
  assert.equal(box.renderStyleLabelToday("Pixar-style 3D"), "Family feature 3D"); assert.equal(box.renderStyleLabelToday("🌐 Studio Ghibli Anime"), "Hand-painted pastoral anime");
  assert.equal(box.renderStyleLabelToday("GTA Loading-Screen Art"), "Crime-game poster art");
  // the marker of a saved style is taken off whole (the "u" flag: without it half of the emoji was left behind)
  assert.equal(box.renderStyleLabelToday("🔒 Night market"), "Night market");
  for (const f of ["app/artroom.jsx", "app/agents.jsx", "app/app.jsx", "app/ai.jsx"]) assert.ok(!/\[🔒🌐\]\\s\*\/[^u]/.test(read(f)), f + ": every marker strip has the u flag"); assert.equal(box.renderStyleLabelToday("My own style"), "My own style");
  assert.ok(art.includes("const clean = (lab)=> renderStyleLabelToday(lab);\n  if(meta.renderStyleLabel) return clean(meta.renderStyleLabel);"), "a saved sheet's label is shown through it");
  // a sheet made with the earlier wording still shows its menu label
  assert.ok(art.includes('(/^high-end Pixar-style animated-feature 3D character render/.test(rendering) ? "pixar" : "")')
    && art.includes('(/in the lineage of Laika and Guillermo del Toro production paintings/.test(rendering) ? "paintedconcept" : "")'));
});

test("D live action is photography everywhere: 'photoreal…' keys in the Photoreal group, Cinematic horror with them", () => {
  const photo = GROUPS.find((g) => g.id === "Photoreal");
  assert.ok(photo, "the group keeps its id (likeness reads it)");
  assert.deepEqual(photo.keys, ["photoreal", "photorealFilm35", "photorealMono", "photorealDoc", "photorealBright", "photorealEpic", "photorealNeon", "horror", "photorealNatural", "photorealCreature", "photorealOrnamental"]);
  for (const k of photo.keys) assert.equal(box.shotStyleIsPhotoreal(k), true, k + " is photography to the shots");
  for (const k of KEYS.filter((x) => !photo.keys.includes(x))) assert.equal(box.shotStyleIsPhotoreal(k), false, k + " is not");
  assert.ok(art.includes('photoreal = RENDER_STYLE_GROUP_BY_KEY[key]==="Photoreal" || key==="horror";'));
  // film grain is not added on top of a clean digital look, nor twice on a film stock
  assert.ok(shots.includes('!/^photoreal(Bright|Neon|Doc|Film35|Mono)$/.test(String(_styleKey||""))'));
});

test("E the new looks have their own words for locations and props; the live-action ones for shots; children's work has a group", () => {
  for (const k of NEW) { assert.ok(LOC[k] && LOC[k].length > 40, "location text: " + k); assert.ok(PROP[k] && PROP[k].length > 40, "prop text: " + k); }
  for (const k of NEW.filter((x) => /^photoreal/.test(x))) assert.ok(/live-action|Live-action/.test(SHOT[k]), "shot text: " + k);
  assert.deepEqual(GROUPS.map((g) => g.id), ["Photoreal", "Anime / Animation", "Cartoon / 3D", "Kids & Family", "Illustration / Concept Art", "Graphic / Minimal", "Handmade / Tactile", "Decorative / Design-led"]);
  assert.deepEqual(GROUPS.find((g) => g.id === "Kids & Family").keys, ["preschoolCartoon", "pictureBookGouache", "crayonDrawing", "toyBrick", "whimsicalwatercolor", "vintageChildrensBook"]);
  // nothing frightening is asked of the look made for the youngest
  assert.ok(STYLES.preschoolCartoon.rules.some((r) => /nothing frightening/.test(r)));
  // a toy look carries no maker's mark
  assert.ok(STYLES.toyBrick.rules.some((r) => /no brand names or logos/.test(r)));
});

test("F Frances knows the new count, the new group, the new names and the two hidden looks", () => {
  assert.ok(/now offers 59 looks/.test(ai) && /61 built-in/.test(ai) && ai.includes("Kids & Family"));
  assert.ok(ai.includes("'Pixar-style 3D' is now 'Family feature 3D'") && ai.includes("'GTA Loading-Screen Art' is now 'Crime-game poster art'"));
});

test("G the two near-duplicates are hidden from the menu by default; the admin can bring one back; a card that has one keeps its name", () => {
  assert.ok(art.includes('const DEFAULT_HIDDEN_STYLE_KEYS = ["flatDesign","animated3d"];'));
  assert.ok(KEYS.includes("flatDesign") && KEYS.includes("animated3d"), "their definitions stay: a card that uses one keeps its look");
  assert.ok(art.includes("let _hiddenGlobalKeys = new Set(DEFAULT_HIDDEN_STYLE_KEYS);") && art.includes("_hiddenGlobalKeys = new Set(DEFAULT_HIDDEN_STYLE_KEYS);       // signed-out mode"));
  assert.ok(art.includes(".concat(DEFAULT_HIDDEN_STYLE_KEYS.filter(k=>!(_baseGlobalMeta[k] && _baseGlobalMeta[k].shown))));"), "hidden unless the admin's row says shown");
  assert.ok(art.includes("{ __preset:true, __hidden:false, __shown:true, __order:order>=0?order:null }"), "bringing one back is remembered");
  assert.ok(art.includes("...(((_baseGlobalMeta[item.key]||{}).shown) ? { __shown:true } : {})"), "…and survives a reorder");
  assert.ok(art.includes("((value && value!==\"surprise\" && BASE_RENDER_STYLE_KEYS.includes(value)) ? _styleOptionForKey(value) : null)"), "the picker shows a hidden look's own name on a card that has it");
});

test("H 'Surprise me' is no longer offered (owner 2026-11-17: 'if you find the Custom styles feature not good or consistent, remove it'); what it made earlier still works", () => {
  assert.ok(art.includes("const SURPRISE_STYLE_OFFERED = false;"));
  // not in the menu: neither the list built at load nor the one rebuilt when styles change
  assert.ok(!J(box.CHAR_RENDER_STYLE_OPTIONS).some((o) => o.key === "surprise"), "no Surprise me among the options");
  assert.equal(art.split("...(SURPRISE_STYLE_OFFERED ? [{ key:\"surprise\"").length - 1, 2, "both option lists are behind the switch");
  // a card that already has such a look keeps it: the picker names it, the card shows its name without the re-roll, and it can still be kept
  assert.ok(art.includes('(value==="surprise" ? { key:"surprise", label:"Custom look (made earlier)"'));
  for (const [f, who] of [["app/artroom.jsx", "c"], ["app/props.jsx", "p"], ["app/locations-ui.jsx", "l"]]) {
    const src = read(f);
    assert.ok(src.includes('React.createElement("span",{className:"char-style-name kept",title:"A one-off look made earlier for this card. Pick any style from the menu to replace it."},'), f + ": the kept look's name, no re-roll");
    assert.ok(src.includes(who + ".surpriseRender.label)),"), f);
  }
  assert.ok(art.includes('if(key==="surprise" && c && c.surpriseRender && c.surpriseRender.render) return c.surpriseRender.render;'), "its sheet is still made in that look");
  assert.ok(art.includes('"🔒 Lock this style"'), "…and it can still be kept as a personal style");
  assert.ok(ai.includes("'SURPRISE ME' IS GONE (2026-11-17)") && ai.includes("'Surprise me' is no longer offered in the Render style menu"), "Frances knows, in every entry that spoke of it");
  assert.ok(!read("app/locations-ui.jsx").includes("and Surprise me, spend writing credits"), "no About text still offers it");
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

#!/usr/bin/env node
/* THREE PANELS, ONE FACE (owner 2026-10-27: "Let's go back to this structure for character sheets"): the character
   sheet is face portrait | full-body FRONT with no head | full-body BACK, in three equal panels — the July layout
   (d79a9ce / 0282391). The front view stops at the collar at the back view's scale, so the portrait is the sheet's only
   face. Both the master prompt (buildCharRefPrompt) and the from-a-photo prompt (buildRefFromPhotoPrompt) say so.
   Run: node scripts/test-character-sheet-three-panels.mjs (no browser, no network) */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const art = readFileSync("app/artroom.jsx", "utf8"), img = readFileSync("app/imagegen.jsx", "utf8"), ai = readFileSync("app/ai.jsx", "utf8");
const html = readFileSync("TURN.html", "utf8");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("PASS " + name); };
const spec = art.slice(art.indexOf("    layout: {\n      format: \"a 3-panel"), art.indexOf("    continuity: {\n      identity_rule"));
t("the master sheet's layout is three equal panels: face, front without a head, back", () => {
  assert.ok(spec.includes('"a 3-panel casting reference sheet in 16:9 landscape: three EQUAL-width tall vertical panels'));
  assert.equal((spec.match(/"PANEL \d/g) || []).length, 3);
  assert.ok(spec.includes("PANEL 1 \\u2014 close-up hero FACE PORTRAIT") && spec.includes("PANEL 3 \\u2014 full-body BACK view"));
  // (owner 2026-10-27) no chin, mouth or neck under a cropped face: an invisible person wearing the clothes
  assert.ok(spec.includes("but NO head and NO neck are rendered: an invisible person wearing the clothes"));
  assert.ok(spec.includes("no chin, jaw, mouth, lips, neck or throat skin anywhere above the collar (the face is not cropped, cut off or half-shown"));
  assert.ok(!spec.includes("the figure begins at the neckline"));
  assert.ok(spec.includes('one_face_rule: "EXACTLY ONE face appears on this sheet') && spec.includes("the missing head must NOT enlarge the front figure"));
  assert.ok(!/THREE-QUARTER FRONT view|PANEL 4|four tall|across all four panels/.test(spec));
  assert.ok(spec.includes("do not add side, profile or three-quarter views"));
});
t("the from-a-photo sheet asks for the same three panels", () => {
  const photo = art.slice(art.indexOf("function buildRefFromPhotoPrompt"), art.indexOf("window.buildRefFromPhotoPrompt"));
  assert.ok(photo.includes("LAYOUT: a clean 3-panel casting reference sheet in 16:9 landscape with three equal-width tall vertical panels"));
  assert.ok(photo.includes("but with NO head and NO neck rendered") && photo.includes("EXACTLY ONE face on the sheet") && !/4-panel|THREE-QUARTER FRONT/.test(photo));
});
t("the sheet's one-line descriptions and Frances say three panels", () => {
  assert.ok(art.includes('"3-panel casting reference sheet: close-up face portrait, full-body front view without the head, full-body back view"'));
  assert.ok(img.includes('"3-panel casting reference sheet: close-up face portrait, full-body front view without the head, full-body back view"'));
  assert.ok(!/4-panel casting reference sheet|4-panel character sheet|4-panel design/.test(art + img));
  assert.ok(ai.includes("a 16:9 casting-reference layout with three equal vertical panels (owner 2026-10-27)"));
  assert.ok(ai.includes('.replaceAll("4-panel character sheet", "3-panel character sheet")'));
  assert.ok(["20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k => html.includes('app/artroom.jsx?v=' + k + '"')));
});
console.log(n + " passed, 0 failed");

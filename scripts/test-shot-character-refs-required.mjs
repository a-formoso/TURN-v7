#!/usr/bin/env node
/* test-shot-character-refs-required.mjs — A FRAME NEVER INVENTS A CHARACTER (owner 2026-10-20: "some keyframes are
   being generated without the proper character references … the AI randomly generating the character").

     A  shotResolveRenderRefs (app/shots.jsx): a character in the frame whose sheet has no image stops the render with a
        plain message (make the sheet, or untick the character) marked requiredReference — so the Art Room never turns
        it into a reference-less paid render; an appearance state keeps its own message; an unticked character (not in
        the plan) renders; a location view with no image is skipped, never fatal; the found sheets attach in order
     B  the card and the paths around it: Generate treats a frame with a character as needing its sheets
        (attachmentsRequired), "Try simplified prompt" keeps the frame's sheets (attachmentsInSimple) and its numbered
        image map; the card names what's missing under the reference strip; Frances knows

   node scripts/test-shot-character-refs-required.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const shots = read("app/shots.jsx"), ui = read("app/shots-ui.jsx");
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext([
  slice(shots, "function shotLocationReferenceError(", "window.shotLocationReferenceError"),
  slice(shots, "async function shotLoadLocationSpecImage(", "window.shotLoadLocationSpecImage"),
  slice(shots, "async function shotResolveLocationSpecImages(", "window.shotResolveLocationSpecImages"),
  slice(shots, "function shotCharacterReferenceError(", "window.shotCharacterReferenceError"),
  slice(shots, "async function shotResolveRenderRefs(", "window.shotResolveRenderRefs"),
  "this.resolve = shotResolveRenderRefs;",
].join("\n"), box);

const IMAGES = { temi:"data:temi", "loc-a":"data:loc" };
const grab = async (id) => IMAGES[id] || "";
const temi = { id:"temi", baseId:"temi", entityId:"temi", referenceKind:"character", label:"Temi", note:"Temi character sheet", version:1, required:false };
const folake = { id:"folake", baseId:"folake", entityId:"folake", referenceKind:"character", label:"Folake", note:"Folake character sheet", version:1, required:false };
const locA = { id:"loc-a", note:"Kiosk plate" }, locB = { id:"loc-b", note:"Kiosk night view" };
const plan = (orderedSpecs, activeLocSpec) => ({ orderedSpecs, activeLocSpec:activeLocSpec || [], castSpec:orderedSpecs.filter(s => s.referenceKind === "character") });

await test("A  a character in the frame with no sheet stops the render — never a frame that invents them", async () => {
  let err = null;
  try { await box.resolve(plan([temi, folake]), grab); } catch (e) { err = e; }
  assert.ok(err, "it throws");
  assert.equal(err.code, "SHOT_CHARACTER_REFERENCE_UNAVAILABLE");
  assert.equal(err.requiredReference, true, "so the Art Room never turns it into a reference-less render");
  assert.match(err.message, /^Folake has no character sheet yet, so this frame would invent their look\. Make Folake's sheet in Art Room → Characters, or untick Folake under this shot's Reference images to render without it\. Nothing was charged\.$/);
});

await test("A  an appearance state keeps its own message; an unticked character renders without it", async () => {
  let err = null;
  try { await box.resolve(plan([{ ...folake, id:"folake:s1", stateId:"s1", label:"Folake · Wounded · v2", required:true }]), grab); } catch (e) { err = e; }
  assert.match(err.message, /Required character appearance reference "Folake · Wounded · v2" has no available image/);
  const refs = await box.resolve(plan([temi]), grab);   // Folake unticked: not in the plan's specs
  assert.deepEqual([...refs.map(r => r.refId)], ["temi"]);
  assert.equal(refs[0].referenceKind, "character");
});

await test("A  a ticked location view with no image stops the render too (owner 2026-10-20); unticked, the rest attach in order", async () => {
  let err = null;
  try { await box.resolve(plan([locB, locA, temi], [locB, locA]), grab); } catch (e) { err = e; }
  assert.ok(err, "it throws");
  assert.equal(err.code, "SHOT_LOCATION_REFERENCE_UNAVAILABLE");
  assert.equal(err.requiredReference, true);
  assert.match(err.message, /^The location view “Kiosk night view” isn’t made yet, so this frame would invent the set\. Make it in Art Room → Locations, or untick it under this shot's Reference images \(or choose another location reference\) to render without it\. Nothing was charged\.$/);
  const refs = await box.resolve(plan([locA, temi], [locA]), grab);   // the missing view unticked
  assert.deepEqual([...refs.map(r => r.refId)], ["loc-a", "temi"]);
  // a CHOSEN view keeps its own message
  let err2 = null;
  try { await box.resolve(plan([{ ...locB, required:true }], [{ ...locB, required:true }]), grab); } catch (e) { err2 = e; }
  assert.match(err2.message, /^Required location reference "loc-b" has no available image\./);
});

await test("B  Generate needs a frame's character sheets; the simplified retry keeps them and its image map", () => {
  assert.match(ui, /attachmentsRequired:requiredCanonicalAttachments \|\| !!\(renderPlan&&Array\.isArray\(renderPlan\.orderedSpecs\)\n\s+&&renderPlan\.orderedSpecs\.length\),/);
  assert.match(shots, /shotResolveLocationSpecImages\(plan\.activeLocSpec, grab, \{ requireAll:true \}\)/);
  assert.match(ui, /" made yet, so this frame won\\u2019t render: make "/);
  assert.match(ui, /attachmentsInSimple:!!\(renderPlan&&Array\.isArray\(renderPlan\.orderedSpecs\)&&renderPlan\.orderedSpecs\.length\) \|\| requiredCanonicalAttachments,/);
  assert.match(shots, /const _retainRequiredSimpleMap = !!\(ctx\.simpleMode && Array\.isArray\(ctx\.resolvedRefs\)\n\s+&& ctx\.resolvedRefs\.some\(r=>r && r\.assetRole!=="screenplay_context"\)\);/);
  // the Art Room: a requiredReference error is thrown, never swallowed into a text-only render
  assert.match(read("app/artroom.jsx"), /if\(opts\.attachmentsRequired \|\| \(e&&e\.requiredReference\)\) throw e;/);
});

await test("B  the card names what's missing under the reference strip; Frances knows", () => {
  assert.match(ui, /const _missCast = refsLoaded \? refImgs\.filter\(r=>r && r\.kind==="character" && r\.missing && _offIds\.indexOf\(r\.refId\)<0\) : \[\];/);
  assert.match(ui, /" no usable sheet yet, so this frame won\\u2019t render: make "/);
  assert.match(ui, /off \? "\+" : "✓"\)\); \}\)\),\n\s+refWarn\);/);
  assert.match(read("app/styles.css"), /\.shot-refs-warn\{/);
  // the missing view is named, and one click opens its location in the Art Room (2026-10-20)
  assert.match(ui, /"Make "\+\(_missLoc\.length>1\?"the first one":"it"\)\+" in Locations \\u2192"/);
  assert.match(ui, /window\.turnOpenLocationCard\(\(_missLoc\[0\]&&_missLoc\[0\]\.locationId\)\|\|loc\.id, _missLoc\[0\]&&_missLoc\[0\]\.refId\)/);
  const lui = read("app/locations-ui.jsx");
  assert.match(lui, /"data-location-unit-image":imgId\}/);
  assert.match(lui, /CardFold,\{label:"Rooms & times",foldId:"loc-units-"\+l\.id,/);
  assert.match(lui, /window\.addEventListener\("turn-location-select",h\)/);
  const app = read("app/app.jsx");
  assert.match(app, /window\.turnOpenLocationCard = \(locationId, imageId\)=>\{\n\s+setRoom\("art"\); setArtView\("locations"\);/);
  assert.match(app, /new CustomEvent\("nb-open-fold",\{ detail:"loc-units-"\+sel \}\)/);
  assert.match(app, /document\.querySelector\('\[data-location-unit-image="'\+img\+'"\]'\)/);
  assert.match(read("app/ai.jsx"), /A FRAME NEVER INVENTS A CHARACTER \(2026-10-20\)/);
  const html = read("TURN.html");
  for (const f of ["shots.jsx", "shots-ui.jsx"]) assert.ok(["20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(v => html.includes(f + "?v=" + v + '"')), f);
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* The image cards' record keeping (owner 2026-11-21: "ensure image versioning is working properly, even after images
   are deleted or new ones are created; also ensuring current image displayed on the card its details are updated …
   as per user selection of what details they want to see … Remove the toolkit"; then: "Do the same for Props and
   Locations").

   1 A deleted version's number is not given out again: the highest number is kept on the current record when a
     version is deleted, on this device's store and on the film's.
   2 The line under an image is about the image the card shows: after a save the card takes the record as stored; an
     image whose record never arrived asks for its own.
   3 The details people ticked are what the line shows, for whatever image is current.
   4 It is one frame for characters, props and locations, so all three have it; the cast row's tooltip is gone.

     node scripts/test-image-card-record.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const img = read("app/imagegen.jsx"), cloud = read("app/cloud.jsx"), art = read("app/artroom.jsx"), props = read("app/props.jsx"), loc = read("app/locations-ui.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");

await test("1 a deleted version's number is not given out again", async () => {
  // this device's store, run for real: v14 is current over v13 and v12
  const store = { meta: { version: 14, iso: "c" }, hist: [{ url: "u13", meta: { version: 13 } }, { url: "u12", meta: { version: 12 } }], img: "u14" };
  const sb = { console, Number, Math, isFinite, Promise, CustomEvent: function(){}, Map };
  sb.window = sb; sb.dispatchEvent = () => {}; sb._nbBackend = "local"; sb._nbSerial = (id, f) => f();
  sb.localGetMeta = () => store.meta; sb.localSetMeta = (id, m) => { store.meta = m; }; sb.localGetHistory = async () => store.hist.slice(); sb.localSetHistory = async (id, h) => { store.hist = h; };
  sb.localGetImage = () => store.img; sb.localSetImage = async (id, u) => { store.img = u; }; sb.localSetRefs = async () => {}; sb.localGetRefs = async () => [];
  vm.runInNewContext(between(img, "function nbVersionTopOf(curMeta, history){", "window.nbVersionTopOf = nbVersionTopOf;")
    + "\n" + between(img, "async function nbNextVersion(id){", "window.nbVersionAfter = nbVersionAfter;")
    + "\n" + between(img, "async function _nbDeleteCurrentAndPromoteAssetInner(id){", "async function nbLoadDetailsAsset(id, currentUrl){")
    + "\n" + between(img, "async function _nbDeleteHistoryEntryInner(id, index){", "window.nbDeleteHistoryEntry = nbDeleteHistoryEntry;")
    + "\nthis.next=nbNextVersion; this.delCur=_nbDeleteCurrentAndPromoteAssetInner; this.delHist=_nbDeleteHistoryEntryInner; this.top=nbVersionTopOf;", sb);
  assert.equal(await sb.next("x"), 15);
  await sb.delCur("x");                                   // the current one (v14) is deleted: v13 is shown again
  assert.deepEqual(plain(store.meta), { version: 13, versionTop: 14 }); assert.equal(store.img, "u13");
  assert.equal(await sb.next("x"), 15, "not a second v14");
  // a restored older version is current (v3) while v9 is kept; v9 is deleted: the next is still v10
  store.meta = { version: 3, iso: "c" }; store.hist = [{ url: "u9", meta: { version: 9 } }, { url: "u2", meta: { version: 2 } }];
  assert.equal(await sb.delHist("x", 0), true);
  assert.deepEqual(plain(store.meta), { version: 3, iso: "c", versionTop: 9 }); assert.equal(await sb.next("x"), 10);
  await sb.delHist("x", 0); assert.equal(await sb.next("x"), 10, "deleting an old one changes nothing");
  assert.equal(sb.top({ version: "x", versionTop: "7" }, [{ meta: { version: 4 } }, {}]), 7);
  // the film's own store does the same, and never writes to the row it read (the write is checked against it)
  const d1 = between(cloud, "async function cloudDeleteCurrentAndPromote(projectId, uid, entityId){", "window.cloudDeleteCurrentAndPromote = cloudDeleteCurrentAndPromote;");
  assert.ok(d1.includes("const promoted = history.shift(), topBefore = _cloudVersionTop(row);") && d1.includes("const chosen = topBefore>0 ? { ...promoted, meta:{ ...(promoted.meta||{}), versionTop:topBefore } } : promoted;"));
  assert.ok(!/promoted\.meta\s*=|row\.meta\s*=/.test(d1) && d1.includes("return { url, meta: chosen.meta || null,"));
  const d2 = between(cloud, "async function cloudDeleteHistoryEntry(projectId, uid, entityId, index){", "window.cloudDeleteHistoryEntry = cloudDeleteHistoryEntry;");
  assert.ok(d2.includes("meta:(row.storage_path && topBefore>0) ? {...(row.meta||{}),versionTop:topBefore} : (row.meta||{})"));
  const C = { Number, isFinite }; vm.runInNewContext(between(cloud, "function _cloudVersionTop(row){", "async function cloudDeleteCurrentAndPromote(") + "\nthis.t=_cloudVersionTop;", C);
  assert.equal(C.t({ meta: { version: 3, versionTop: 14 }, history: [{ meta: { version: 13 } }] }), 14); assert.equal(C.t(null), 0);
  // clearing an image altogether removes its versions and its record: the next image is v1
  assert.ok(between(cloud, "async function cloudClear(projectId, entityId){", "/* ── exact current-image purge").includes("refs:[],history:[]"));
});

await test("2 the line under an image is about the image the card shows", () => {
  const sb = { console }; sb.window = sb; let stored = null; sb.nbGetMeta = () => stored;
  vm.runInNewContext(between(art, "function nbStoredMeta(id, meta){", "window.nbStoredMeta = nbStoredMeta;") + "\nthis.f=nbStoredMeta;", sb);
  const mine = { iso: "a", version: 13 };
  stored = { iso: "a", version: 14, pixelW: 4096 }; assert.deepEqual(plain(sb.f("x", mine)), { iso: "a", version: 14, pixelW: 4096 }, "the record as stored (its number was raised)");
  stored = { iso: "older", version: 9 }; assert.deepEqual(plain(sb.f("x", mine)), mine, "a save that did not reach the store: the card's own");
  stored = null; assert.deepEqual(plain(sb.f("x", mine)), mine);
  // the three saves a card makes all take it: a new image or an edit, an upload, a change made in code
  assert.equal(art.split("setGenMeta(nbStoredMeta(id, meta))").length - 1, 3);
  // restoring and deleting a version already hand the card the record of the image now shown
  assert.equal(art.split("if(r){ setGenUrl(r.url); setGenMeta(r.meta||null);").length - 1, 2);
  // an image whose record never arrived asks for its own, once, and shows the film's image with it
  const late = between(art, "    const lateRecord = setTimeout(()=>{", "    }, 6000);");
  assert.ok(late.includes('if(!alive || !genUrlRef.current || genMetaRef.current || typeof nbLoadDetailsAsset!=="function") return;') && late.includes("if(d.url) setGenUrl(d.url);") && late.includes("setGenMeta(d.meta);"));
  assert.ok(art.includes("return ()=>{ alive=false; clearTimeout(lateRecord);"));
});

await test("3 the details people ticked are what the line shows, for whatever image is current", () => {
  const sb = { console, String, Number, Date, JSON }; sb.window = sb; sb.nbModelLabel = (id) => ({ "gpt-image-2.6": "GPT Image 2.6 Sunburst" }[id] || ""); sb.renderStyleLabelFromMeta = (m) => m.renderStyleLabel || "";
  sb.editPlannerLabel = () => "Planner X"; sb.EDIT_PLANNER_MODEL_ID = "planner-x";
  vm.runInNewContext(between(art, "const SHEET_CAP_FIELDS = [", "window.sheetCapRead = sheetCapRead;").replace(/^const /gm, "var ") + "\nthis.v=sheetCapValue; this.F=SHEET_CAP_FIELDS;", sb);
  assert.deepEqual(plain(sb.F.map((f) => f[1])), ["Engine", "Shape (aspect ratio)", "Size", "Size in pixels", "Quality", "Date made", "Render style"]);
  const made = { modelId: "gpt-image-2.6", aspect: "16:9", size: "2K", pixelW: 2048, pixelH: 1152, quality: "high", date: "Nov 20, 2026", renderStyleLabel: "Photoreal" };
  const line = (m, res) => sb.F.map((f) => sb.v(f[0], m, res));
  assert.deepEqual(plain(line(made, "2K")), ["GPT Image 2.6 Sunburst", "16:9", "2K", "2048×1152", "High quality", "Nov 20, 2026", "Photoreal"]);
  // the same image resized to 4K: its engine, size, pixels and date are the resized image's own
  const resized = { ...made, size: "4K", pixelW: 4096, pixelH: 2304, date: "Nov 21, 2026", codeEdit: { kind: "upscale", by: "Planner X", byId: "planner-x", drew: false } };
  assert.deepEqual(plain(line(resized, "4K")), ["Planner X", "16:9", "4K", "4096×2304", "High quality", "Nov 21, 2026", "Photoreal"]);
  assert.deepEqual(plain(line({ uploaded: true, modelId: "uploaded", modelLabel: "Uploaded", pixelW: 1200, pixelH: 800 }, "1K · 1200×800")).slice(0, 5), ["Uploaded", "", "1K", "1200×800", ""], "an upload has no quality: the line shows a dash for it");
  const cap = between(art, 'React.createElement("span",{className:"sheet-frame-meta"},', "// THE CHOOSER, on every card that has an image");
  assert.ok(cap.includes("capFields.map(k=>{") && cap.includes("const v = sheetCapValue(k, genMeta, resLabel);") && cap.includes('": not saved with this image"'));
  assert.ok(art.includes('const resLabel = (genMeta && genMeta.size) || measRes || "—";') || art.includes('const resLabel = (genMeta && genMeta.size) || measRes || "\\u2014";') || /const resLabel = \(genMeta && genMeta\.size\) \|\| measRes/.test(art));
});

await test("4 one frame for characters, props and locations; the cast row's tooltip is gone; Frances knows", () => {
  assert.ok(props.includes("useImageGen({") && /React\.createElement\((window\.)?SheetFrame,/.test(props), "prop cards use the same frame");
  assert.ok(loc.split("useImageGen({").length - 1 >= 4 && loc.split("React.createElement(SheetFrame,{").length - 1 >= 4, "location cards and their variants too");
  const row = between(art, "function CastOverview(", "window.CastOverview = CastOverview;");
  assert.ok(!row.includes("InfoTip") && !row.includes("Every character in one row."), "no tooltip after the row");
  assert.ok(row.includes('". Click to go to the card."'), "each face still says what that character has, on hover");
  // (2026-11-21) its own entry only: the entries added after it are not this test's to read
  const f = between(ai, 'APP_FEATURES.push({ name:"Version numbers, the line under an image, and the model a resize names (Characters, Props, Locations, Art Room)"', "\nAPP_FEATURES.push(");
  for (const w of ["character sheets, prop images, location images and their variants", "VERSION NUMBERS NEVER REPEAT", "delete v14, make a new image, and it is v15", "starts again at v1", "THE LINE UNDER AN IMAGE is always about the image the card shows now",
    "'Show under images'", "A RESIZE NAMES THE APP'S OWN WRITING ENGINE AS ITS MODEL", "the engine picked in the top bar plays no part", "no longer ends with an ⓘ"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic|Fable|Gemini|GPT/.test(f) && !/credit|price|paid/i.test(f), "no word that reads as billing: such a sentence is kept from the assistant");
  assert.ok(!ai.includes("Its Details read 'In code' as the Model."));
  for (const file of ["artroom.jsx", "imagegen.jsx", "cloud.jsx", "ai.jsx"]) assert.ok(["20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1"].some(k => html.includes(file + "?v=" + k + '"')), file + " has a current key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

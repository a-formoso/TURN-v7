#!/usr/bin/env node
/* The versions limit is never reached in silence (owner 2026-11-20: "if there is a limit, can we make sure to warn the
   user whenever this is reached"). An image keeps 12 earlier versions; one more removed the oldest without a word.

   1 A card asks before it makes a version that would remove the oldest: which one goes, with its date; "Not now"
     changes nothing. Fewer than 12: no question.
   2 A run over many cards asks once; "Leave those as they are" skips the full ones and the run moves on.
   3 The three ways a card makes a version (a new image or an edit, a change made in code, an upload) all ask.
   4 Any other save that let a version go says so afterwards, unless the person had just agreed.
   5 The versions list says "Full"; Frances knows the limit; the page loads the new files.

     node scripts/test-versions-limit.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const art = read("app/artroom.jsx"), props = read("app/props.jsx"), img = read("app/imagegen.jsx"), cloud = read("app/cloud.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), html = read("TURN.html");

function lab(histories){
  const asked = [], agreed = [], sb = { console, String, Date, Promise, isNaN };
  sb.window = sb; sb.NB_VERSIONS_KEPT = 12; sb.answers = [];
  sb.nbGetHistory = async (id) => histories[id] || [];
  sb.appConfirm = async (o) => { asked.push(o); return sb.answers.length ? sb.answers.shift() : true; };
  sb.nbVersionsAgreed = (id) => agreed.push(id);
  vm.runInNewContext(between(art, "let _versionsRunAsk = null, _versionsRunAnswer = null;", "window.turnVersionsFullAsk = turnVersionsFullAsk;") + "\nthis.ask=turnVersionsFullAsk; this.day=turnVersionDay;", sb);
  return { sb, asked, agreed };
}
const full = (n, oldestIso) => Array.from({ length: n }, (_, i) => ({ meta: { version: n - i, iso: i === n - 1 ? oldestIso : "2026-11-20T10:00:00.000Z" } }));

await test("1 a card asks before the version that removes the oldest; fewer than 12 asks nothing", async () => {
  const L = lab({ liaqat: full(12, "2026-11-15T07:54:00.000Z"), kieran: full(5, "2026-11-15T07:54:00.000Z"), odd: full(12, "") });
  assert.equal(await L.sb.ask("kieran", "KIERAN ELLIS", "sheet"), true); assert.equal(L.asked.length, 0, "room left: no question");
  L.sb.answers.push(true);
  assert.equal(await L.sb.ask("liaqat", "LIAQAT HUSSAIN", "sheet"), true);
  assert.equal(L.asked[0].title, "LIAQAT HUSSAIN’s sheet already keeps 12 earlier versions");
  assert.equal(L.asked[0].body, "That is the most an image can keep. Making a new one removes the oldest version (from 15 November 2026) for good; the other 11 and the current image stay. To keep that oldest one, open the image full size and download it first.");
  assert.deepEqual([L.asked[0].confirmLabel, L.asked[0].cancelLabel], ["Go on", "Not now"]);
  assert.deepEqual(L.agreed, ["liaqat"], "the save that follows knows the person agreed");
  L.sb.answers.push(false);
  assert.equal(await L.sb.ask("liaqat", "", "image"), false, "Not now: nothing is made");
  assert.equal(L.asked[1].title, "This image already keeps 12 earlier versions"); assert.equal(L.agreed.length, 1);
  L.sb.answers.push(true); await L.sb.ask("odd", "X", "image");
  assert.ok(L.asked[2].body.includes("removes the oldest version for good;"), "no date known: none is made up");
  assert.equal(L.sb.day("2026-11-05T23:30:00.000Z").replace(/^\d+ /, ""), "November 2026");
  // no way to ask, or the versions cannot be read: the card is not blocked
  const N = lab({ a: full(12, "") }); N.sb.appConfirm = undefined; assert.equal(await N.sb.ask("a", "", "image"), true);
  const E = lab({}); E.sb.nbGetHistory = async () => { throw new Error("offline"); }; assert.equal(await E.sb.ask("a", "", "image"), true);
});

await test("2 a run over many cards asks once; 'Leave those as they are' skips the full ones", async () => {
  const L = lab({ a: full(12, "2026-11-01T00:00:00.000Z"), b: full(12, "2026-11-02T00:00:00.000Z"), c: full(3, "") });
  L.sb.answers.push(false);
  const r = await Promise.all([L.sb.ask("a", "A", "sheet", { batch: true }), L.sb.ask("b", "B", "sheet", { batch: true }), L.sb.ask("c", "C", "sheet", { batch: true })]);
  assert.deepEqual(r, [false, false, true], "the full ones are left, the rest are made");
  assert.equal(L.asked.length, 1, "one question for the run, though two cards were full at the same moment");
  assert.equal(L.asked[0].title, "Some of these images already keep 12 earlier versions");
  assert.deepEqual([L.asked[0].confirmLabel, L.asked[0].cancelLabel], ["Make them all", "Leave those as they are"]);
  assert.equal(await L.sb.ask("a", "A", "sheet", { batch: true }), false); assert.equal(L.asked.length, 1, "the answer holds for the run");
  assert.deepEqual(L.agreed, []);
  const Y = lab({ a: full(12, ""), b: full(12, "") }); Y.sb.answers.push(true);
  assert.deepEqual(await Promise.all([Y.sb.ask("a", "A", "sheet", { batch: true }), Y.sb.ask("b", "B", "sheet", { batch: true })]), [true, true]);
  assert.deepEqual(Y.agreed.sort(), ["a", "b"]); assert.equal(Y.asked.length, 1);
  // the batch does not wait for a card that said no before it started
  assert.ok(art.includes("if(r===false && batchStarted.current && !(window.__nbGenInflight && window.__nbGenInflight[_cgen])){ batchStarted.current=false; onBatchDone && onBatchDone(c.id); }"));
  assert.ok(props.includes("if(r===false && batchStarted.current && !_pInflight()){ batchStarted.current=false; onBatchDone && onBatchDone(p.id); }"));
});

await test("3 a new image or an edit, a change made in code and an upload all ask, after the lock and before anything is spent", () => {
  const g = between(art, "  const generate = async (gopts)=>{", "    return await nbRunSheetGeneration({");
  assert.ok(g.includes('if(genUrl && !(await turnVersionsFullAsk(id, lockName(), opts.noun||"image", { batch:!!(gopts && gopts.batch) }))) return false;'));
  assert.ok(g.indexOf("turnLockedAsk(") < g.indexOf("turnVersionsFullAsk("), "the lock is asked first");
  const ce = between(art, "  const codeEdit = async (make, o)=>{", "nbCommit(id, r.url, meta, [], assetKind, _editEpoch)");
  assert.ok(ce.includes('if(!(await turnVersionsFullAsk(id, lockName(), opts.noun||"image"))) return false;'));
  const up = between(art, "  const importSheet = async (file)=>{", "nbCommit(id, dataUrl, meta, [], assetKind, _importEpoch)");
  assert.ok(up.includes('if(genUrl && !(await turnVersionsFullAsk(id, lockName(), opts.noun||"image"))) return;'));
});

await test("4 any other save that let a version go says so, unless the person had just agreed", () => {
  const toasts = [], sb = { console, String, Date, Map }; sb.window = sb; sb.appToast = (m, k) => toasts.push([m, k]);
  vm.runInNewContext(between(img, "const NB_VERSIONS_KEPT = 12;", "window.NB_VERSIONS_KEPT = NB_VERSIONS_KEPT;") + "\nthis.note=nbVersionsTrimNotice; this.agree=nbVersionsAgreed; this.KEPT=NB_VERSIONS_KEPT;", sb);
  assert.equal(sb.KEPT, 12);
  sb.note("loc1", 0); sb.note("loc1", undefined); assert.equal(toasts.length, 0, "nothing was removed: nothing is said");
  sb.note("loc1", 1);
  assert.deepEqual(toasts[0], ["This image already kept 12 earlier versions, the most it can. Its oldest version was removed to make room for the new one.", "info"]);
  sb.agree("liaqat"); sb.note("liaqat", 1); assert.equal(toasts.length, 1, "asked on the card, said yes: not told twice");
  sb.note("liaqat", 1); assert.equal(toasts.length, 2, "the yes covers one save only");
  // both stores report it: the film's own, and this browser's
  assert.ok(cloud.includes("...(dropped.length?{trimmed:dropped.length}:{}),") && img.includes("nbVersionsTrimNotice(id, r.trimmed);") && img.includes("nbVersionsTrimNotice(id, hist.length-12);"));
  assert.ok(cloud.includes("if(history.length > 12){ dropped=history.slice(12); history = history.slice(0,12); }") && img.includes("await localSetHistory(id, hist.slice(0,12));"), "the limit itself is unchanged");
});

await test("5 the versions list says Full; Frances knows the limit; the page loads the new files", () => {
  const det = between(art, 'React.createElement(Icon.history,{s:12}),"Earlier versions ("+history.length+")",', "React.createElement(\"div\",{className:\"dt-hist\"},");
  assert.ok(det.includes('(history.length >= (window.NB_VERSIONS_KEPT||12)) && React.createElement("span",{className:"dt-hist-full","data-role":"versions-full"},"Full")'));
  assert.ok(det.includes("The next new one removes the oldest for good. To keep a version, download it first, or delete one you do not need."));
  assert.ok(css.includes(".dt-hist-full{"));
  const f = between(ai, 'APP_FEATURES.push({ name:"Versions of an image: how many are kept, and the warning when they are full (Art Room)"', "/* a billing entry:");
  for (const w of ["AN IMAGE KEEPS 12 EARLIER VERSIONS", "removes the OLDEST one for good", "THE APP NOW WARNS BEFORE THAT HAPPENS", "'Go on' makes the new version, 'Not now' changes nothing and spends nothing", "'Make them all', or 'Leave those as they are'", "shows 'Full'", "TO KEEP A VERSION THAT WOULD BE REMOVED", "Restoring an earlier version does not remove any"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic|Gemini|GPT/.test(f));
  for (const file of ["artroom.jsx", "imagegen.jsx", "cloud.jsx", "props.jsx", "ai.jsx", "styles.css"]) assert.ok(["20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3"].some(k => html.includes(file + "?v=" + k + '"')), file + " has a current key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

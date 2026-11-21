#!/usr/bin/env node
/* A version number is never used twice on one image (owner 2026-11-20: "fix the version numbering so it doesn't
   repeat"). It was "how many are kept, plus one": with 12 kept, every new version was "v13"; after a restore the count
   repeated a number; an upload was always "v1".

   1 The next number is one more than the highest this image has had, and never lower than the count.
   2 The save raises a number that would repeat, whichever way the image was made; an image with no number keeps none.
   3 The cards work the number out before they save: a new image or an edit, a change made in code, an upload.

     node scripts/test-version-numbers.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const img = read("app/imagegen.jsx"), art = read("app/artroom.jsx"), html = read("TURN.html");

function lab(rows, backend = "cloud"){
  const sb = { console, Number, Math, isFinite, Promise };
  sb.window = sb; sb._nbBackend = backend; sb._scopeFor = () => "film";
  sb.cloudGetGen = async (scope, id) => rows[id] || null;
  sb.localGetMeta = (id) => (rows[id] && rows[id].meta) || null; sb.localGetHistory = async (id) => (rows[id] && rows[id].history) || []; sb.localGetImage = (id) => (rows[id] && rows[id].storage_path) || "";
  vm.runInNewContext(between(img, "function nbVersionTopOf(curMeta, history){", "window.nbVersionAfter = nbVersionAfter;") + "\nthis.after=nbVersionAfter; this.next=nbNextVersion;", sb);
  return sb;
}
const hist = (...vs) => vs.map((v) => ({ meta: v == null ? {} : { version: v } }));

await test("1 the next number is one more than the highest this image has had, never lower than the count", async () => {
  const L = lab({});
  assert.equal(L.after(null, [], false), 1, "a first image");
  assert.equal(L.after({ version: 1 }, [], true), 2);
  // Liaqat on 2026-11-20: 12 kept, the current one numbered 13: the next was "13" again
  assert.equal(L.after({ version: 13 }, hist(12, 11, 6, 10, 9, 8, 7, 4, 5, 2, 4, 1), true), 14);
  assert.equal(L.after({ version: 14 }, hist(13, 13, 12, 11, 6, 10, 9, 8, 7, 4, 5, 2), true), 15, "and on from there: the limit of 12 does not cap the number");
  // an earlier version was restored (v3 is current, v7 is kept): the next is 8, not 4
  assert.equal(L.after({ version: 3 }, hist(7, 6, 5, 4, 2, 1), true), 8);
  // an upload used to say "v1" over an image with a history
  assert.equal(L.after({ version: 1 }, hist(5, 4, 3, 2, 1), true), 7, "never lower than the count either (5 kept + the current)");
  // images saved before numbers were kept: the count is the number
  assert.equal(L.after({}, hist(null, null, null), true), 5); assert.equal(L.after(null, hist(null, null), false), 3);
  assert.equal(L.after({ version: "x" }, hist("7", 2), true), 8, "numbers stored as text are read; junk is ignored");
});

await test("2 the read is the image's own row; the save raises a number that would repeat", async () => {
  const rows = { liaqat: { storage_path: "p/v13.png", meta: { version: 13 }, history: hist(12, 11, 6, 10, 9, 8, 7, 4, 5, 2, 4, 1) }, fresh: null };
  assert.equal(await lab(rows).next("liaqat"), 14); assert.equal(await lab(rows).next("fresh"), 1);
  assert.equal(await lab(rows, "local").next("liaqat"), 14, "this browser's own store counts the same way");
  const nx = between(img, "async function nbNextVersion(id){", "window.nbVersionAfter = nbVersionAfter;");
  assert.ok(nx.indexOf("window.cloudGetGen(_scopeFor(id), id)") < nx.indexOf("window.cloudLoadDetails("), "one small read: no picture is signed for a number");
  const c = between(img, "async function _nbCommitInner(id, dataUrl, meta, refs, kind, epoch, cancelled, expected){", "// Approval belongs to one exact generation");
  assert.ok(c.includes("if(meta.version != null){") && c.includes("const next = await nbNextVersion(id); if(Number(meta.version) < next) meta.version = next;"), "raised, never lowered; no number, none given");
  assert.ok(c.indexOf("meta = { ...(meta||{}) };") < c.indexOf("nbNextVersion(id)"), "the caller's own record is not written to");
  assert.ok(c.includes('if(_stale()) return { tier:"stale", url:dataUrl };') && c.lastIndexOf("_stale()") > c.indexOf("nbNextVersion(id)"), "a film switch during the read is still caught");
});

await test("3 the cards work the number out before they save: a new image or an edit, a change in code, an upload", () => {
  const run = between(art, "      /* version number from existing history (nbCommit rolls history internally) */", "      const mEntry = allModels.find");
  assert.ok(run.includes('const nextVer = (typeof window.nbNextVersion==="function") ? await window.nbNextVersion(id) : 0;') && run.includes("priorCount = nextVer ? nextVer-1 : (genUrl ? histLen+1 : histLen);"));
  const ce = between(art, "  const codeEdit = async (make, o)=>{", "nbCommit(id, r.url, meta, [], assetKind, _editEpoch)");
  assert.ok(ce.includes('priorCount = (typeof window.nbNextVersion==="function") ? (await window.nbNextVersion(id))-1') && ce.includes("version: priorCount + 1,"));
  const up = between(art, "  const importSheet = async (file)=>{", "nbCommit(id, dataUrl, meta, [], assetKind, _importEpoch)");
  assert.ok(up.includes('version: (genUrl && typeof window.nbNextVersion==="function") ? await window.nbNextVersion(id).catch(()=>1) : 1,'));
  assert.ok(!/Math\.min\(histLen\+1, 12\)/.test(art), "the cap that made every later version v13 is gone");
  for (const file of ["artroom.jsx", "imagegen.jsx"]) assert.ok(["20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1"].some(k => html.includes(file + "?v=" + k + '"')), file + " has a current key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

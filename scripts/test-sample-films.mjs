/* The three approved sample films (docs/Sample Films (draft).md, docs/samples/*.md) build into valid
   film documents: the pipeline's free checks pass (scene counts, every scene turns or may settle,
   beats per format, screenplay on its slugline and mapped to beats, no 60-word monologue), the
   structural kinds and the re-charted Glass Hours scene 8 are right, the screenplay parses into
   dialogue as well as action, and nothing internal or vendor-named reaches the document. */
import assert from "node:assert/strict";
import { buildAll, validate } from "./build-sample-films.mjs";

let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};
const films = Object.fromEntries(buildAll().map((f) => [f.slug, f]));

await test("A every film passes the pipeline's free checks", () => {
  for (const [slug, f] of Object.entries(films)) assert.deepEqual(validate(slug, f.doc), [], slug);
  assert.deepEqual(Object.values(films).map((f) => f.doc.scenes.length), [16, 4, 8]);
});
await test("B the shape, format and framework of each", () => {
  const g = films["glass-hours"].doc, k = films.kelpfold.doc, t = films["third-mainland"].doc;
  assert.deepEqual([g.project.format, g.project.framework], ["film", "threeact"]);
  assert.deepEqual([k.project.format, k.project.framework], ["commercial", "kishotenketsu"]);
  assert.deepEqual([t.project.format, t.project.framework], ["musicvideo", "herosjourney"]);
  assert.deepEqual(g.project.synopsis.paras.map((p) => p.key), ["setup", "confrontation", "resolution"]);
  assert.deepEqual(k.project.synopsis.paras.map((p) => p.key), ["ki", "sho", "ten", "ketsu"]);
  assert.deepEqual(t.project.synopsis.paras.map((p) => p.key), ["departure", "initiation", "return"]);
  for (const f of Object.values(films)) assert.ok(f.doc.project.sampleFilm && f.doc.project.research && f.doc.project.sourceBrief);
});
await test("C structural kinds, and Glass Hours' peaks alternate (scene 8 re-charted −2 → +2)", () => {
  const g = films["glass-hours"].doc.scenes;
  assert.deepEqual([4, 8, 12, 15, 16].map((n) => g[n - 1].kind), ["incite", "midpoint", "act-climax", "story-climax", "resolution"]);
  assert.deepEqual([g[7].openCharge, g[7].closeCharge], [-2, 2]);
  assert.deepEqual([4, 8, 12, 15].map((n) => Math.sign(g[n - 1].closeCharge)), [-1, 1, -1, 1]);
  assert.deepEqual(films.kelpfold.doc.scenes.map((s) => s.kind), ["plant", "deepen", "ten", "ketsu"]);
  assert.deepEqual(films["third-mainland"].doc.scenes.map((s) => s.kind),
    ["ordinary-world", "call", "mentor", "threshold", "tests", "ordeal", "road-back", "elixir"]);
});
await test("D the screenplay parses into dialogue, not just action; the fixed lines are word for word", () => {
  const blocks = (f) => Object.values(f.doc.drafts).flatMap((d) => d.blocks);
  for (const f of Object.values(films)) {
    const types = new Set(blocks(f).map((b) => b.type));
    assert.ok(types.has("scene") && types.has("action") && types.has("char") && types.has("dia"), f.slug + ": " + [...types]);
  }
  assert.ok(blocks(films["third-mainland"]).some((b) => b.type === "dia" && b.text === "Bring it, or don't come."));
  assert.ok(blocks(films.kelpfold).some((b) => b.type === "action" && b.text === "SUPER: Kelpfold. Made from what the sea gave back."));
  assert.ok(blocks(films.kelpfold).some((b) => b.text.includes('"This shell was 2.4 kg of lost net."')));
});
await test("E every beat has a side written; tactic names stay short", () => {
  for (const f of Object.values(films)) for (const s of f.doc.scenes) {
    const b = f.doc.beatsMap[s.id];
    assert.ok(b.turnAt >= 1 && b.turnAt <= b.rows.length && b.turnBeatId === "beat-" + s.id + "-" + b.turnAt);
    for (const r of b.rows) {
      assert.ok(r.drive.d || r.react.d, f.slug + " " + s.no + "/" + r.n);
      for (const side of [r.drive, r.react]) assert.ok(side.a.split(/\s+/).length <= 5, side.a);
    }
  }
});
await test("F nothing internal or vendor-named reaches a sample document", () => {
  const all = JSON.stringify(Object.values(films).map((f) => f.doc));
  for (const w of ["TURN", "MUSE", "McKee", "Claude", "Anthropic", "Cinema Machine"]) assert.ok(!new RegExp("\\b" + w + "\\b").test(all), w);
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/* Art Room fix 10 (owner 2026-10-02): every image call names its film and item, and the proxy
   records them — reduced to a safe shape — on the usage row with the credit hold's ref, so a
   hold can be traced to a film and an asset. Browser-supplied: attribution only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestContext } from "../supabase/functions/image-proxy/request-context.mjs";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

await test("A1 the context keeps real-looking film and item ids and a purpose word", () => {
  assert.deepEqual(requestContext({ projectId: "3f2b9c1e-0a4d-4e8b-9f00-1234567890ab", assetId: "sbsheet-sbpage-s1-2x2-0:half-top", purpose: "poster" }),
    { projectId: "3f2b9c1e-0a4d-4e8b-9f00-1234567890ab", assetId: "sbsheet-sbpage-s1-2x2-0:half-top", purpose: "poster" });
  assert.deepEqual(requestContext({ projectId: "local", assetId: "c1:st-abc" }), { projectId: "local", assetId: "c1:st-abc" });
});
await test("A2 anything else is dropped", () => {
  assert.deepEqual(requestContext(null), {});
  assert.deepEqual(requestContext(["x"]), {});
  assert.deepEqual(requestContext({ projectId: "a b", assetId: "<script>", purpose: "Poster!" }), {});
  assert.deepEqual(requestContext({ projectId: 42, assetId: { id: 1 } }), {});
  assert.deepEqual(requestContext({ assetId: "x".repeat(161) }), {}, "too long");
  assert.deepEqual(requestContext({ assetId: "-leading-dash" }), {});
});

const proxy = read("supabase/functions/image-proxy/index.ts");
await test("B1 the image usage row carries the context and the hold's ref; the hold's reason is unchanged", () => {
  assert.ok(proxy.includes('import { requestContext } from "./request-context.mjs";'));
  assert.ok(proxy.includes("metadata: { aspect, quality, imageSize, referenceImages: images.length, ...requestContext(body.context),\n        ...(imageHold && imageHold.ref ? { holdRef: imageHold.ref } : {}) },"));
  assert.ok(proxy.includes("await takeHold(imageUsage.credits, \"image\", `image:${model}:${imageSize}`);"), "the ledger's reason text stays as users see it");
});

const ig = read("app/imagegen.jsx");
await test("C1 every image request names the open film (or the one the caller names) and the item when known", () => {
  assert.ok(ig.includes("const _pid = opts.projectId || window.__turnCurrentProjectId;"));
  assert.ok(ig.includes("if(opts.assetId) reqContext.assetId = String(opts.assetId);"));
  assert.ok(ig.includes("...(Object.keys(reqContext).length ? { context:reqContext } : {}),"));
});
await test("C2 the callers name their items", () => {
  assert.ok(read("app/artroom.jsx").includes("genOpts.assetId = slotId || id;"), "the shared sheet generator (characters, props, shots…)");
  const lb = read("app/lookbook.jsx"); assert.equal((lb.match(/\{ assetId:c\.id \}/g) || []).length, 2, "Lookbook frames");
  const loc = read("app/locations.jsx");
  assert.equal((loc.match(/nbGenerate\(prompt, \{ \.\.\.gopts, assetId:l\.id \}\)/g) || []).length, 2, "location plates");
  // variants (2) + the room & time plate made from a focused scene (generateSluglineUnitPlate, 2026-10-03)
  assert.equal((loc.match(/nbGenerate\(prompt, \{ \.\.\.gopts, assetId:id \}\)/g) || []).length, 4, "location variants + room & time plates (each with its simplified retry)");
  assert.ok(read("app/storyboard.jsx").includes("...(extra.length?{extraImages:extra}:{}), assetId:sh.id,"), "a storyboard panel edit");
  const app = read("app/app.jsx");
  assert.ok(app.includes('{ ...genOpts, projectId:proj.id, assetId:"cover", assetPurpose:"poster" }'), "a Home poster names ITS film");
  assert.equal((app.match(/\{ \.\.\.gopts, assetId:c\.id \}/g) || []).length, 2, "the wardrobe re-bake");
  // (2026-10-09, Art Room third pass) the sheets also carry a last-moment Stop check
  assert.equal((app.match(/\{ \.\.\.gopts, assetId:slotId, beforeSubmit \}/g) || []).length, 2, "the Casting Director's sheets");
  // (2026-10-10, Likeness review) the pose sketches are static line drawings: the capture window makes no image
  const cameo = read("app/cameo.jsx");
  assert.ok(!/nbGenerate\s*\(|assetPurpose\s*:\s*"cameo-guide"|cameoGuidePrompt/.test(cameo), "no paid pose-guide generation left");
  assert.ok(cameo.includes("function CameoPoseSketch"), "the static pose sketches");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

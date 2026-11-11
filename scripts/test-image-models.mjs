import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [client, artroom, proxy, pricing, pricingWatch, muse] = await Promise.all([
  read("app/imagegen.jsx"),
  read("app/artroom.jsx"),
  read("supabase/functions/image-proxy/index.ts"),
  read("app/pricing.jsx"),
  read("supabase/functions/pricing-watch/index.ts"),
  read("app/ai.jsx"),
]);

/* The fal image engines beside Nano Banana 2.1 (2026-11-12, owner): GPT Image 2.6 Flare / Sunburst — which replaced
   2.5 — and Seedream 5.5 beside Seedream 5 Pro. `watched` is the price row the drift watcher proposes for the engine
   (Seedream 5.5 has none: fal lists no price for it yet, so its page is only watched for one appearing). */
const models = [
  {
    id: "gpt-image-2.6-flare",
    label: "GPT Image 2.6 Flare",
    generate: "openai/gpt-image-2.6/flare/text-to-image",
    edit: "openai/gpt-image-2.6/flare/edit",
    watched: "image.providerUsd.gpt-image-2.6-flare.high",
  },
  {
    id: "gpt-image-2.6-sunburst",
    label: "GPT Image 2.6 Sunburst",
    generate: "openai/gpt-image-2.6/sunburst/text-to-image",
    edit: "openai/gpt-image-2.6/sunburst/edit",
    watched: "image.providerUsd.gpt-image-2.6-sunburst.high",
  },
  {
    id: "seedream-5.5",
    label: "Seedream 5.5",
    generate: "bytedance/seedream/v5.5/text-to-image",
    edit: "bytedance/seedream/v5.5/edit",
    watched: 'slug: "bytedance/seedream/v5.5/text-to-image",',
  },
  {
    id: "seedream-5-pro",
    label: "Seedream 5 Pro",
    generate: "bytedance/seedream/v5/pro/text-to-image",
    edit: "bytedance/seedream/v5/pro/edit",
    watched: "image.providerUsd.seedream-5-pro.standard",
  },
];

// Keep these checks source-level because this project intentionally ships JSX as
// classic scripts rather than importable modules.
for (const model of models) {
  assert.match(client, new RegExp('id:"' + model.id.replaceAll(".", "\\.") + '"'), `${model.id} is selectable`);
  assert.ok(client.includes(`label:"${model.label}"`), `${model.id} has a user-facing label`);
  assert.ok(client.includes(`falModel:"${model.generate}"`), `${model.id} has its generation route`);
  assert.ok(client.includes(`falEditModel:"${model.edit}"`), `${model.id} has its edit route`);
  assert.ok(proxy.includes(`"${model.id}":`), `${model.id} is proxy-allowlisted`);
  assert.ok(proxy.includes(`base: "${model.generate}"`), `${model.id} generation route reaches fal`);
  assert.ok(proxy.includes(`edit: "${model.edit}"`), `${model.id} edit route reaches fal`);
  assert.ok(pricing.includes(`"${model.id}":`), `${model.id} has client pricing`);
  assert.ok(pricingWatch.includes(model.watched), `${model.id} pricing is watched`);
  assert.ok(muse.includes(model.label), `${model.id} is present in MUSE product knowledge`);
}

// GPT Image 2.5 Flare / Sunburst were removed (2026-11-12, owner): not selectable, no fal route in the app or the
// proxy, no client price, no watcher. Their ids live on only as "served on 2.6" (the two maps) and as the label an
// image made on them keeps.
for (const v of ["flare", "sunburst"]) {
  const id = `gpt-image-2.5-${v}`, label = `GPT Image 2.5 ${v[0].toUpperCase()}${v.slice(1)}`;
  assert.ok(!client.includes(`id:"${id}"`), `${id} is not selectable`);
  for (const [name, src] of [["the app", client], ["the proxy", proxy], ["the price watcher", pricingWatch]])
    assert.ok(!src.includes(`openai/gpt-image-2.5/${v}/`), `${id}: no fal route in ${name}`);
  assert.ok(!proxy.includes(`"${id}"`), `${id} is not proxy-allowlisted`);
  assert.ok(!pricing.includes(`"${id}"`), `${id} has no client pricing`);
  assert.ok(!pricingWatch.includes(id), `${id} pricing is not watched`);
  assert.ok(client.includes(`"${id}":"gpt-image-2.6-${v}",`), `${id} renders on its 2.6 version`);
  assert.ok(client.includes(`"${id}":"${label}",`), `an image made on ${id} keeps its label`);
}
assert.doesNotMatch(client, /id:"gpt-image-2"|falModel:"openai\/gpt-image-2\//, "GPT Image 2 stays removed");

// GPT Image 2.6 (like 2.5 before it) has no moderation field: since GPT Image 2 went (2026-10-11) none is sent at all
assert.doesNotMatch(proxy, /input\.moderation\s*=/, "unsupported moderation is not forwarded to GPT Image 2.6");
assert.doesNotMatch(client, /moderation:\s*opts\.moderation/, "the app sends no moderation field");
assert.match(client, /const j = ctx && await ctx\.json\(\);/,
  "non-2xx proxy responses preserve the Edge Function's explanation");
assert.match(client, /The image server rejected this request/,
  "actionable proxy rejection copy reaches the image card");
assert.match(artroom, /window\.turnIsContentBlock\(emsg\)/,
  "sheet generation uses the shared content-policy classifier");
assert.doesNotMatch(artroom, /flagged\|not allowed\|rejected by/,
  "model availability errors are not mistaken for content-policy refusals");
assert.match(client, /s\.indexOf\(b\+":"\)===0/,
  "shared character appearance-state sheets inherit their show-bible asset scope");

console.log("Image model integration checks passed.");

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

const models = [
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    generate: "openai/gpt-image-2.5/flare/text-to-image",
    edit: "openai/gpt-image-2.5/flare/edit",
  },
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    generate: "openai/gpt-image-2.5/sunburst/text-to-image",
    edit: "openai/gpt-image-2.5/sunburst/edit",
  },
];

// Keep these checks source-level because this project intentionally ships JSX as
// classic scripts rather than importable modules.
for (const model of models) {
  assert.match(client, new RegExp(model.id.replaceAll(".", "\\.")), `${model.id} is selectable`);
  assert.ok(client.includes(model.label), `${model.id} has a user-facing label`);
  assert.ok(client.includes(model.generate), `${model.id} has its generation route`);
  assert.ok(client.includes(model.edit), `${model.id} has its edit route`);
  assert.ok(proxy.includes(`"${model.id}"`), `${model.id} is proxy-allowlisted`);
  assert.ok(proxy.includes(model.generate), `${model.id} generation route reaches fal`);
  assert.ok(proxy.includes(model.edit), `${model.id} edit route reaches fal`);
  assert.ok(pricing.includes(`"${model.id}"`), `${model.id} has client pricing`);
  assert.ok(pricingWatch.includes(`image.providerUsd.${model.id}.high`), `${model.id} pricing is watched`);
  assert.ok(muse.includes(model.label), `${model.id} is present in MUSE product knowledge`);
}

assert.match(proxy, /if \(moderation && cfg\.moderation\) input\.moderation = moderation;/,
  "unsupported moderation is not forwarded to GPT Image 2.5");
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

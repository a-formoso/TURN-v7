import assert from "node:assert/strict";
import {
  IMAGE_QUALITY_CAPABILITIES,
  imagePricingQuality,
  imageQualityOptions,
  mergeImagePricingOverrides,
  providerQualityPayload,
  validateImageQuality,
} from "../supabase/functions/image-proxy/image-quality.mjs";

for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
  assert.deepEqual(IMAGE_QUALITY_CAPABILITIES[model],
    ["default", "auto", "low", "medium", "high", "xhigh", "max"]);

  for (const quality of IMAGE_QUALITY_CAPABILITIES[model]) {
    const checked = validateImageQuality(model, quality);
    assert.equal(checked.ok, true, `${model}/${quality} should validate`);
    const fields = providerQualityPayload(checked);
    const generation = { model, prompt: "test", ...fields };
    const requestEnvelope = { provider: "fal", model, prompt: "test", quality };
    const providerInput = { prompt: requestEnvelope.prompt, ...fields };
    const edit = new FormData();
    edit.append("model", model);
    edit.append("prompt", "test");
    if (fields.quality !== undefined) edit.append("quality", fields.quality);
    if (quality === "default") {
      assert.equal(requestEnvelope.quality, "default", "the client envelope retains default intent");
      assert.deepEqual(fields, {});
      assert.equal(Object.prototype.hasOwnProperty.call(generation, "quality"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(providerInput, "quality"), false);
      assert.equal(edit.has("quality"), false);
    } else {
      assert.deepEqual(fields, { quality });
      assert.equal(generation.quality, quality);
      assert.equal(edit.get("quality"), quality);
    }
  }

  const omitted = validateImageQuality(model, undefined);
  assert.equal(omitted.ok, true);
  assert.equal(omitted.quality, "default");
  assert.deepEqual(providerQualityPayload(omitted), {});
  assert.equal(imagePricingQuality(model, omitted.quality), "high");

  const auto = validateImageQuality(model, "auto");
  assert.equal(imagePricingQuality(model, auto.quality), "max");
  assert.equal(imagePricingQuality(model, "default"), "high");
}

// GPT Image 2 was removed (2026-10-11): the proxy maps its id to GPT Image 2.5 Sunburst BEFORE validating, so an
// older app's low / medium / high (or an omitted quality) validates — and is priced — on Sunburst
const { canonicalImageModel } = await import("../supabase/functions/image-proxy/billing-pricing.mjs");
assert.equal(Object.prototype.hasOwnProperty.call(IMAGE_QUALITY_CAPABILITIES, "gpt-image-2"), false);
for (const quality of ["low", "medium", "high"]) {
  const checked = validateImageQuality(canonicalImageModel("gpt-image-2"), quality);
  assert.equal(checked.ok, true);
  assert.deepEqual(providerQualityPayload(checked), { quality });
  assert.equal(checked.pricingQuality, quality);
}
const legacyDefault = validateImageQuality(canonicalImageModel("gpt-image-2"), undefined);
assert.equal(legacyDefault.ok, true);
assert.equal(legacyDefault.quality, "default");
assert.equal(legacyDefault.pricingQuality, "high");
assert.deepEqual(providerQualityPayload(legacyDefault), {});
assert.equal(validateImageQuality("gpt-image-2", "high").ok, false, "the raw retired id is not a schema model");

assert.equal(validateImageQuality("gpt-image-2.6", "high").ok, false);
assert.equal(validateImageQuality("gpt-image-2.6", undefined).ok, false);
assert.equal(validateImageQuality("gemini-nano-banana-2.1", "xhigh").ok, true);
assert.equal(validateImageQuality("seedream-5-pro", "high").ok, true, "Seedream has no quality: the field is ignored");
assert.equal(validateImageQuality("seedream-5-pro", "high").providerQuality, undefined);

assert.deepEqual(imageQualityOptions(), {
  imageQualitySchema: 1,
  imageQualities: {
    "gpt-image-2.5-flare": ["default", "auto", "low", "medium", "high", "xhigh", "max"],
    "gpt-image-2.5-sunburst": ["default", "auto", "low", "medium", "high", "xhigh", "max"],
  },
});

const baselinePricing = {
  "gpt-image-2.5-flare": {
    default: 0.045, auto: 0.21072, low: 0.005, medium: 0.012,
    high: 0.045, xhigh: 0.09366, max: 0.21072,
  },
  "gpt-image-2.5-sunburst": {
    default: 0.045, auto: 0.21072, low: 0.005, medium: 0.012,
    high: 0.045, xhigh: 0.09366, max: 0.21072,
  },
  "gpt-image-2": { low: 0.009, medium: 0.080, high: 0.317 },
};
const trustedMerged = mergeImagePricingOverrides(baselinePricing, {
  version: "reviewed",
  image: {
    "gpt-image-2.5-flare": { xhigh: 0.11, max: 0.24 },
    "gpt-image-2.5-sunburst": { xhigh: 0.12, max: 0.25 },
    "gpt-image-2": { high: 0.5 },
    "not-a-known-model": { xhigh: 999 },
  },
});
assert.equal(trustedMerged["gpt-image-2.5-flare"].xhigh, 0.11);
assert.equal(trustedMerged["gpt-image-2.5-flare"].max, 0.24);
assert.equal(trustedMerged["gpt-image-2.5-flare"].default, 0.045,
  "default inherits the merged high tier");
assert.equal(trustedMerged["gpt-image-2.5-flare"].auto, 0.24,
  "auto inherits the merged max tier");
assert.equal(trustedMerged["gpt-image-2.5-sunburst"].xhigh, 0.12);
assert.equal(trustedMerged["gpt-image-2.5-sunburst"].max, 0.25);
assert.equal(trustedMerged["gpt-image-2.5-sunburst"].default, 0.045);
assert.equal(trustedMerged["gpt-image-2.5-sunburst"].auto, 0.25);
assert.equal(trustedMerged["gpt-image-2"].high, 0.5);
assert.equal(trustedMerged["gpt-image-2"].medium, 0.080,
  "legacy GPT Image 2 tiers remain independently priced");
assert.equal(baselinePricing["gpt-image-2.5-flare"].max, 0.21072,
  "baseline pricing is not mutated");

const invalidMerged = mergeImagePricingOverrides(baselinePricing, {
  image: {
    "gpt-image-2.5-flare": {
      xhigh: 0, max: -1, high: NaN, medium: Infinity,
      unknown: 8, default: 0.001,
    },
    "gpt-image-2": { high: "not-a-price", medium: null },
  },
});
assert.equal(invalidMerged["gpt-image-2.5-flare"].xhigh, 0.09366);
assert.equal(invalidMerged["gpt-image-2.5-flare"].max, 0.21072);
assert.equal(invalidMerged["gpt-image-2.5-flare"].high, 0.045);
assert.equal(invalidMerged["gpt-image-2"].high, 0.317);
assert.equal(invalidMerged["gpt-image-2"].medium, 0.080);

const proxySource = await (await import("node:fs/promises")).readFile(
  new URL("../supabase/functions/image-proxy/index.ts", import.meta.url), "utf8");
assert.match(proxySource, /from\("turn_app_config"\)/,
  "server loads the trusted stored pricing config");
assert.match(proxySource, /mergeImagePricingOverrides\(IMAGE_PROVIDER_USD, data\?\.value\)/,
  "server merges stored overrides into a request-local table");
assert.match(proxySource, /PRICING_CONFIG_UNAVAILABLE/,
  "pricing-config read errors fail before provider access");
assert.ok(proxySource.indexOf("imagePricingTable = await loadTrustedImagePricing") <
  proxySource.indexOf("const imageBlock = ensureCanSpend"),
  "trusted pricing is loaded before the image spend gate");
const imagePathSource = proxySource.slice(proxySource.indexOf("const imageBlock = ensureCanSpend"));
assert.ok(imagePathSource.indexOf("const imageBlock = ensureCanSpend") <
  imagePathSource.indexOf('const falKey = providerKey("fal", "FAL_KEY")'),
  "image spend is captured before fal provider access");
assert.match(proxySource, /const imageUsage = imageUsageEstimate\([\s\S]*imagePricingTable\)/,
  "the captured usage estimate feeds settlement");

console.log("image-quality tests passed");

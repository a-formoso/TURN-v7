/*
 * Pure GPT Image quality policy shared by the image proxy and Node-side tests.
 *
 * `default` means "do not send a provider quality field": fal/OpenAI then use
 * their documented default (high). `auto` is a real provider value, not an
 * alias for default. Its estimate deliberately uses the conservative max
 * estimate because the provider can choose a higher output-token tier.
 */

const GPT_IMAGE_25_QUALITIES = ["default", "auto", "low", "medium", "high", "xhigh", "max"];

/* GPT Image 2 was removed (2026-10-11, owner — image engines): index.ts maps its id to GPT Image 2.5 Sunburst
   (billing-pricing.mjs canonicalImageModel) BEFORE this validation, so its low / medium / high still validate. */
export const IMAGE_QUALITY_CAPABILITIES = Object.freeze({
  "gpt-image-2.5-flare": Object.freeze([...GPT_IMAGE_25_QUALITIES]),
  "gpt-image-2.5-sunburst": Object.freeze([...GPT_IMAGE_25_QUALITIES]),
});

/*
 * This is intentionally a separate object from the provider capability list:
 * aliases are accounting policy, while the list above is request validation.
 * The 2.5 table is populated with both alias keys so callers can either use
 * this normalized key or look up the explicit provider quality directly.
 */
export const IMAGE_QUALITY_PRICING_ALIASES = Object.freeze({
  default: "high",
  auto: "max",
});

function isGptImageModel(model) {
  return /^gpt-image/i.test(String(model || ""));
}

function invalid(model, quality, message) {
  return {
    ok: false,
    model: String(model || ""),
    suppliedQuality: quality,
    error: message,
  };
}

/*
 * Resolve the request's quality exactly once at the image boundary.
 *
 * For GPT Image 2.5, omission and explicit "default" are represented by the
 * internal sentinel "default", but providerQuality is undefined in both cases;
 * both are priced as high (the provider's default).
 */
export function validateImageQuality(model, rawQuality) {
  const modelId = String(model || "");
  const qualities = IMAGE_QUALITY_CAPABILITIES[modelId];

  if (!qualities) {
    if (isGptImageModel(modelId)) {
      return invalid(modelId, rawQuality,
        `Image model "${modelId}" is not supported by the image-quality schema.`);
    }
    /*
     * Nano Banana, Seedream and non-image tasks do not consume this field. Keep their
     * existing behavior instead of expanding unrelated model schemas.
     */
    return {
      ok: true,
      model: modelId,
      suppliedQuality: rawQuality,
      quality: undefined,
      providerQuality: undefined,
      pricingQuality: undefined,
      omitted: rawQuality === undefined,
    };
  }

  if (rawQuality === undefined) {
    const quality = "default";
    return {
      ok: true,
      model: modelId,
      suppliedQuality: undefined,
      quality,
      providerQuality: undefined,
      pricingQuality: "high",
      omitted: true,
    };
  }

  const quality = typeof rawQuality === "string" ? rawQuality.trim().toLowerCase() : "";
  if (!qualities.includes(quality)) {
    return invalid(modelId, rawQuality,
      `Quality "${String(rawQuality)}" is not supported for ${modelId}. Supported values: ${qualities.join(", ")}.`);
  }

  return {
    ok: true,
    model: modelId,
    suppliedQuality: rawQuality,
    quality,
    /* `default` must never be sent as a provider literal. */
    providerQuality: quality === "default" ? undefined : quality,
    pricingQuality: IMAGE_QUALITY_PRICING_ALIASES[quality] || quality,
    omitted: false,
  };
}

/*
 * Build the provider fields from a validated result. The returned object is
 * safe to spread into both JSON generation and multipart edit requests.
 */
export function providerQualityPayload(validation) {
  if (!validation || validation.ok !== true) {
    throw new Error("providerQualityPayload requires a successful image-quality validation");
  }
  return validation.providerQuality === undefined
    ? {}
    : { quality: validation.providerQuality };
}

export function imagePricingQuality(model, validatedQuality) {
  const checked = validateImageQuality(model, validatedQuality);
  if (!checked.ok) throw new Error(checked.error);
  return checked.pricingQuality;
}

/*
 * Apply the same reviewed `turn_app_config` shape used by app/pricing.jsx to a
 * request-local copy of the server baseline.  Never mutate either input: the
 * Edge Function may serve concurrent requests from one isolate, and a browser
 * supplied price is not a trusted source of settlement policy.
 *
 * The client stores all image tiers in `value.image[model][tier]`.  Only tiers
 * already present in the baseline are writable, matching turnApplyPricingOverrides
 * in app/pricing.jsx.  The 2.5 aliases are deliberately canonicalized after the
 * merge so default always follows high and auto always follows max.
 */
export function mergeImagePricingOverrides(baseTable, config) {
  const merged = {};
  for (const [model, tiers] of Object.entries(baseTable || {})) {
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) continue;
    merged[model] = { ...tiers };
  }

  const image = config && typeof config === "object" && !Array.isArray(config)
    ? config.image
    : null;
  if (image && typeof image === "object" && !Array.isArray(image)) {
    for (const [model, overrides] of Object.entries(image)) {
      const target = merged[model];
      if (!target || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) continue;
      for (const [tier, raw] of Object.entries(overrides)) {
        if (!Object.prototype.hasOwnProperty.call(target, tier)) continue;
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0.0002 && value < 100) {
          target[tier] = value;
        }
      }
    }
  }

  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    const target = merged[model];
    if (!target) continue;
    if (Number.isFinite(Number(target.high))) target.default = Number(target.high);
    if (Number.isFinite(Number(target.max))) target.auto = Number(target.max);
  }
  return merged;
}

/*
 * OPTIONS is intentionally the only image capability handshake. It is safe to
 * call against an old deployment: old proxies return non-JSON "ok", which
 * clients treat as "capabilities unavailable" rather than POSTing an op that an
 * old proxy could misroute into generation.
 */
export function imageQualityOptions() {
  return {
    imageQualitySchema: 1,
    imageQualities: {
      "gpt-image-2.5-flare": [...IMAGE_QUALITY_CAPABILITIES["gpt-image-2.5-flare"]],
      "gpt-image-2.5-sunburst": [...IMAGE_QUALITY_CAPABILITIES["gpt-image-2.5-sunburst"]],
    },
  };
}

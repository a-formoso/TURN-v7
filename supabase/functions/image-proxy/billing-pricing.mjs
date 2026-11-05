/* billing-pricing.mjs — what a server-side generation COSTS, in provider USD and in credits
   (billing fixes, owner decisions 2026-09-30). Pure and testable in Node
   (scripts/test-server-charging.mjs): no Deno or Supabase imports.

   THE ANCHOR (Option A): 1 credit = $0.01 of provider cost (it was $0.03). Every cost rounds UP
   to whole credits with a minimum of 1, so no action can cost us more than $0.01 per credit while
   these tables are current. The same anchor lives in app/pricing.jsx (what a button quotes) and in
   supabase/functions/blender-bridge/studio-service.mjs: change them together.
   THE SWITCH DAY: balances stay in the old unit ($0.03) until supabase/billing-switch.sql
   multiplies them by 3, so every cost function takes the LIVE unit (`unit`, USD per credit) that
   index.ts reads from turn_credit_regime() — $0.03 before the switch, $0.01 after. The proxy can
   therefore ship right after billing-v2.sql (the holds and plan gates) and flips to the new unit
   by itself, at the moment the switch SQL commits.

   WHAT IS PRICED HERE
     text   per-million-token list prices (input / output / cache read), with dated price changes
            (Gemini 3.8 Flash doubles on 2027-01-01), the writing engines that were removed mapped to
            a successor (LEGACY_WRITING_MODELS) and OpenAI's prompt-cache writes (GPT-6 family, 1.25x
            input). An unknown model has NO price: the proxy refuses it rather than billing it at a
            guessed rate.
     images fal's own prices (the app buys every image engine through fal), a separate table for the
            direct Google route, GPT Image priced by output size and Seedream 5 Pro by output area.
     video  per output second, per model / tier / resolution; Seedance with video references is
            billed on input + output seconds at 0.6x (fal's formula).
     voice  text-to-speech by characters, speech-to-text by duration, voice design and cloning
            at a flat charge.

   Sources (checked 2026-09-29 unless noted): platform.claude.com/docs/en/about-claude/pricing,
   developers.openai.com/api/docs/pricing, ai.google.dev/gemini-api/docs/pricing,
   fal.ai/models/* (Seedance 2.0 / 2.5, Kling v3),
   elevenlabs.io/pricing/api; Nano Banana 2.1 (fal.ai/models/google/nano-banana-2.1 and Google's Gemini API
   pricing) checked 2026-10-10; GPT Image 2.5 and Seedream 5 Pro (fal.ai/models/openai/gpt-image-2.5/*,
   fal.ai/models/bytedance/seedream/v5/pro/*) and GPT-6.1 Sol (developers.openai.com/api/docs/models/gpt-6.1-sol,
   …/guides/prompt-caching) checked 2026-10-11. */

export const PROVIDER_USD_PER_CREDIT = 0.01;
/* The unit BEFORE the switch day (1 credit = $0.03). Balances are in this unit until
   supabase/billing-switch.sql multiplies them by 3, so the proxy must not charge in the new unit
   before then: it follows the database's own answer, turn_credit_regime().usd_per_credit
   (creditUnitFromRegime below), and is safe to deploy any time after billing-v2.sql. */
export const LEGACY_USD_PER_CREDIT = 0.03;

/** A usable USD-per-credit value (anything odd falls back to the $0.01 anchor). */
export function creditUnit(unit) {
  const u = Number(unit);
  return Number.isFinite(u) && u >= 0.001 && u <= 1 ? u : PROVIDER_USD_PER_CREDIT;
}

/**
 * The live credit unit from turn_credit_regime() (billing-v2.sql): { unit, switched } or null
 * when the row is missing or unreadable. Before the switch the function answers 0.03, after it
 * 0.01; any other value is refused (null) rather than trusted.
 */
export function creditUnitFromRegime(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const u = Number(row.usd_per_credit ?? row.usdPerCredit);
  if (!Number.isFinite(u)) return null;
  const known = [PROVIDER_USD_PER_CREDIT, LEGACY_USD_PER_CREDIT].find((k) => Math.abs(k - u) < 1e-9);
  if (!known) return null;
  return { unit: known, switched: row.switched === true || known === PROVIDER_USD_PER_CREDIT };
}

/** Whole credits for a provider cost: rounded UP, at least 1. `unit` = USD per credit. */
export function creditsFromUsd(usd, unit = PROVIDER_USD_PER_CREDIT) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return 1;
  // a hair of tolerance so 0.3 / 0.01 (= 29.999999999999996) is 30, not 31
  return Math.max(1, Math.ceil(n / creditUnit(unit) - 1e-9));
}

/* ───────────────────────────── TEXT ───────────────────────────── */

/* List prices per 1M tokens. Keep one `{ input, output }` object per model (other scripts read
   these literals); cache-read prices and dated changes live in their own tables below. */
export const TEXT_PROVIDER_USD_PER_1M = Object.freeze({
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5": { input: 10, output: 50 },
  // Google introductory Gemini 3.8 Flash pricing through 2026-12-31 (see TEXT_PRICE_CHANGES).
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  // Gemini 4 Argon (owner 2026-10-18): Google's introductory price through 2026-11-30 (see TEXT_PRICE_CHANGES)
  "gemini-4-argon": { input: 2, output: 10 },
  // up to 272K input tokens; above that TEXT_LONG_CONTEXT applies (both GPT-6 engines)
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6.1-sol": { input: 2, output: 10 },
});

/* Cached-input (cache READ) prices per 1M tokens. Writing to Anthropic's 5-minute cache costs
   1.25x the input price (TEXT_CACHE_WRITE_MULTIPLIER), and so does OpenAI's automatic cache on the
   GPT-6 family (textCachesByDefault). */
export const TEXT_CACHE_READ_USD_PER_1M = Object.freeze({
  "claude-opus-5": 0.5,
  "claude-opus-5-5": 0.2,
  "claude-fable-5": 1,
  "gpt-6-astra": 1,
  "gpt-6.1-sol": 0.1,
  // Gemini caches long prompts (4,096+ tokens) by itself; a cached token is read at this price
  "gemini-4-argon": 0.1,
});
export const TEXT_CACHE_WRITE_MULTIPLIER = 1.25;

/* Dated list-price changes: from `from` on, the model costs these rates (and `cacheRead`, when given). */
export const TEXT_PRICE_CHANGES = Object.freeze([
  Object.freeze({ model: "gemini-3.8-flash", from: "2027-01-01T00:00:00Z", input: 1.5, output: 7.5 }),
  // Google: $4 / $20 (cached input $0.20) from 1 December 2026 — from midnight UTC, never after Google's own switch
  Object.freeze({ model: "gemini-4-argon", from: "2026-12-01T00:00:00Z", input: 4, output: 20, cacheRead: 0.2 }),
]);

/* Long-context tiers: above `aboveInputTokens` input tokens the whole call costs these rates. */
export const TEXT_LONG_CONTEXT = Object.freeze({
  "gpt-6-astra": Object.freeze({ aboveInputTokens: 272000, input: 20, output: 75, cacheRead: 2 }),
  "gpt-6.1-sol": Object.freeze({ aboveInputTokens: 272000, input: 4, output: 15, cacheRead: 0.2 }),
});

/* Model ids the app sends that are dated snapshots of a priced model. */
export const TEXT_MODEL_ALIASES = Object.freeze({});

/* THE WRITING ENGINES (2026-10-11, owner — "keep the three main ones"): Claude, Gemini and GPT only. Kimi K3 and
   K2.7 (the Moonshot route), Fable 5.1, Gemini 3.5 Flash and GPT-5.5 were removed; a request from an older app that
   names one is served on its successor — the same provider's nearest engine, or a default engine for Kimi — before
   the plan gate, the price and the route (index.ts). */
export const LEGACY_WRITING_MODELS = Object.freeze({
  "claude-fable-5-1": Object.freeze({ provider: "anthropic", model: "claude-fable-5" }),
  "gemini-3.5-flash": Object.freeze({ provider: "google", model: "gemini-3.8-flash" }),
  "gpt-5.5": Object.freeze({ provider: "openai", model: "gpt-6.1-sol" }),
  "gpt-5.5-2026-04-23": Object.freeze({ provider: "openai", model: "gpt-6.1-sol" }),
  "kimi-k3": Object.freeze({ provider: "anthropic", model: "claude-opus-5-5" }),
  "kimi-k2.7-code": Object.freeze({ provider: "google", model: "gemini-3.8-flash" }),
});
/** A writing request's { provider, model } with a removed engine replaced by its successor (null = unchanged). */
export function legacyWritingModel(model) {
  const id = String(model || "").trim();
  return Object.prototype.hasOwnProperty.call(LEGACY_WRITING_MODELS, id) ? LEGACY_WRITING_MODELS[id] : null;
}

/* OpenAI caches every prompt of 1,024 tokens or more by itself, and on the GPT-6 family a cache WRITE costs 1.25x the
   input price (reads are cheaper). The hold therefore prices every input token as a write, like a Claude call with
   `promptCache`, and the settle bills what the usage reports (normaliseTextUsage). */
export const OPENAI_CACHE_MIN_TOKENS = 1024;
export function textCachesByDefault(model) {
  return /^gpt-6(?:$|[.-])/.test(String(textPriceKey(model) || model || ""));
}

/* Vision calls (usageKind "vision") keep the proxy's 1.5x policy. */
export const VISION_MULTIPLIER = 1.5;
/* A generous token count for one attached image: the high-resolution ceiling of the current
   writing models (2,576 px on the long edge ≈ 4,784 tokens; it was 1,600, the older ~1.15 MP
   ceiling, which a large image could exceed). The hold must be an upper bound: settlement never
   charges above it (repair F5, 2026-09-30). */
export const IMAGE_INPUT_TOKENS = 4800;

/* WHAT AN ATTACHED IMAGE MAY BE (round 4, S1). Every entry of a writing request's `images` is held
   as ONE image (IMAGE_INPUT_TOKENS), so it must really be one: a base64 data URL of PNG, JPEG,
   WebP, GIF, HEIC or HEIF whose bytes start like one of those files, at most
   VISION_IMAGE_MAX_BYTES decoded. Anything else — a document, a PDF, audio, video, plain text, a
   remote URL — is refused (400) before any hold or provider call, for every provider: an engine
   that reads a 900k-token document or an hour of audio sent as "inline data" bills it all, while
   the hold (and so the charge) covered 4,800 tokens. The same rule guards the direct Google image
   route. The app only ever sends data URLs here (app/ai.jsx aiVisionComplete downscales every
   image to a JPEG data URL; app/imagegen.jsx sends data-URL references). */
export const VISION_IMAGE_MIME = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"]);
/* The largest image the app handles anywhere (the Stage's image uploads and staging limit,
   app/videogen.jsx images.maxBytesEach = image-proxy STAGE_LIMITS.maxBytes.image). */
export const VISION_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1", "mif2"]);

/** The kind of image the first bytes are ("png" | "jpeg" | "gif" | "webp" | "heif"), or "". */
export function sniffImageKind(bytes) {
  const b = bytes || [];
  const at = (i) => Number(b[i]);
  const str = (i, n) => String.fromCharCode(...Array.from({ length: n }, (_, k) => at(i + k)));
  if (b.length >= 8 && at(0) === 0x89 && str(1, 3) === "PNG" && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (b.length >= 6 && (str(0, 6) === "GIF87a" || str(0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return "webp";
  if (b.length >= 12 && str(4, 4) === "ftyp" && HEIF_BRANDS.has(str(8, 4))) return "heif";
  return "";
}

/* the first `n` bytes of a base64 string (n ≤ 48), or null when they don't decode */
function base64Head(b64, n) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(b64 || "").slice(0, Math.ceil(n / 3) * 4).replace(/=+$/, "");
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Why a writing request's `images` can't be sent, or null when every entry is an image data URL
 * of an accepted kind within the size cap. → null | { index, error } (index is 0-based; error is
 * the plain sentence for the user — no provider names).
 */
export function visionImagesProblem(images) {
  if (images == null) return null;
  if (!Array.isArray(images)) return { index: -1, error: "Attached images must be a list of PNG, JPEG, WebP, GIF or HEIC images." };
  for (let i = 0; i < images.length; i++) {
    const src = images[i];
    const which = images.length > 1 ? ` (image ${i + 1})` : "";
    const bad = { index: i, error: `Only PNG, JPEG, WebP, GIF or HEIC images can be attached${which}. Documents, audio, video and links can't.` };
    if (typeof src !== "string") return bad;
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(src.slice(0, 80));
    if (!m || !VISION_IMAGE_MIME.includes(m[1].toLowerCase())) return bad;
    const data = src.slice(m[0].length);
    if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return bad;
    if (base64Bytes(data) > VISION_IMAGE_MAX_BYTES) return { index: i, error: `An attached image is larger than ${Math.round(VISION_IMAGE_MAX_BYTES / 1024 / 1024)}MB${which}.` };
    if (!sniffImageKind(base64Head(data, 16))) return bad;   // the bytes must be an image too, whatever the label says
  }
  return null;
}

/** The priced model id for a request's model, or "" when the model has no price. */
export function textPriceKey(model) {
  const id = String(model || "").trim();
  if (Object.prototype.hasOwnProperty.call(TEXT_PROVIDER_USD_PER_1M, id)) return id;
  const alias = TEXT_MODEL_ALIASES[id];
  if (alias) return alias;
  // a dated snapshot of a priced model: "<model>-YYYY-MM-DD" or "<model>-YYYYMMDD"
  const base = id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");
  if (base !== id && Object.prototype.hasOwnProperty.call(TEXT_PROVIDER_USD_PER_1M, base)) return base;
  return "";
}

/** The rates a model costs at `nowMs` for a call of `inputTokens`, or null when it has no price. */
export function textRates(model, { nowMs = Date.now(), inputTokens = 0 } = {}) {
  const key = textPriceKey(model);
  if (!key) return null;
  let { input, output } = TEXT_PROVIDER_USD_PER_1M[key];
  let changedCacheRead = null;
  for (const c of TEXT_PRICE_CHANGES) {
    if (c.model === key && Number(nowMs) >= Date.parse(c.from)) {
      ({ input, output } = c);
      if (c.cacheRead != null) changedCacheRead = c.cacheRead;
    }
  }
  const long = TEXT_LONG_CONTEXT[key];
  const isLong = !!long && Number(inputTokens) > long.aboveInputTokens;
  if (isLong) ({ input, output } = long);
  const cacheRead = (isLong && long.cacheRead != null) ? long.cacheRead
    : (changedCacheRead != null ? changedCacheRead : (TEXT_CACHE_READ_USD_PER_1M[key] ?? input));
  return { key, input, output, cacheRead, cacheWrite: input * TEXT_CACHE_WRITE_MULTIPLIER };
}

/** UTF-8 byte length. */
export function utf8Bytes(s) {
  const str = String(s ?? "");
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/* A token bound per character class (repair F5; round 2, S5; round 4, S2):
     ASCII LETTERS                   1 token per 2.5 bytes (words: English prose, identifiers) — but
                                      every maximal RUN of letters costs at least 1 token, and a
                                      lower-to-upper case change starts a new run. A tokenizer
                                      pre-splits text into pieces (a letter never joins a following
                                      line break; "QzQz" is "Qz" + "Qz") and every piece is at least
                                      one token, so 'a\n' repeated is 2 tokens per 2 characters and
                                      'Qz' repeated 1 per 2 — 2.5x and 1.25x the round-2 bound.
     SPACES                          1 token per 2.5 bytes; a run of 2 or more costs at least 1 (the
                                      pre-split keeps all but the last space of a run apart: 'a  '
                                      repeated is 2 pieces per 3 characters), and 1 more when its
                                      last space can't join what follows it (a digit, a tab, the end:
                                      '1 ' repeated is 1 piece per character)
     \t \n \v \f \r and every OTHER  1 token each — digits, punctuation and symbols can each be a
       ASCII character                token of their own (a prompt of random digits or punctuation
                                      tokenises about one token per character), and so can each
                                      control / line-break character
     anything non-ASCII              1 token per UTF-8 BYTE — a rare character a tokenizer can only
                                      split into bytes costs up to one token per byte, so a 4-byte
                                      character is 4 tokens.
   The hold must stay an upper bound: settlement never charges above it — and the long-context
   rate (TEXT_LONG_CONTEXT) is chosen from this same bound. */
function textTokenBound(s) {
  const str = String(s ?? "");
  // counted in FIFTHS of a token (1 / 2.5 = 2 / 5), so a long text adds up exactly
  let fifths = 0, run = 0, spaces = 0, prevLower = false;
  const endRun = () => { if (run) fifths += Math.max(5, run * 2); run = 0; prevLower = false; };
  // a run of spaces: 2 / 5 each, but at least one piece for all but its last space when it has 2+,
  // and one more when that last space can't join what follows (a digit, a tab / vertical tab /
  // form feed, or the end of the text) — `next` is the character after the run (-1 = the end)
  const endSpaces = (next) => {
    if (!spaces) return;
    const alone = next < 0 || (next >= 48 && next <= 57) || next === 9 || next === 11 || next === 12;
    fifths += Math.max(((spaces >= 2 ? 1 : 0) + (alone ? 1 : 0)) * 5, spaces * 2);
    spaces = 0;
  };
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const upper = c >= 65 && c <= 90, lower = c >= 97 && c <= 122;
    if (upper || lower) {
      endSpaces(c);
      if (upper && prevLower) endRun();   // "aB": a new piece starts at the capital
      run++; prevLower = lower;
      continue;
    }
    endRun();
    if (c === 32) { spaces++; continue; }
    endSpaces(c);
    if (c < 0x80) fifths += 5;
    else if (c < 0x800) fifths += 10;
    else if (c >= 0xd800 && c <= 0xdbff) { fifths += 20; i++; }
    else fifths += 15;
  }
  endRun(); endSpaces(-1);
  return fifths / 5;
}

/**
 * THE TEXT OF ONE CHAT MESSAGE, EXACTLY AS EVERY PROVIDER CALL SENDS IT (round 3, S1). Every
 * writing-provider branch in index.ts sends this string (Google's text part, OpenAI's `content`, Anthropic's turns and system prompt), and the hold's estimate below counts this same
 * string — one normaliser, so the two can't drift apart. Content that isn't a string is sent as
 * String(content): an array of strings arrives joined, whole (the round-2 verification's case: it
 * used to be estimated at ~0 tokens while the provider read — and billed — all of it). Images are
 * never taken from message content; they come from the request's `images` (counted apart).
 */
export function messageText(m) {
  return String((m && typeof m === "object" && m.content) || "");
}

/** A generous upper estimate of a request's input tokens (text + attached images). */
export function estimateInputTokens(messages, imageCount = 0) {
  let tokens = 0, count = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    count++;
    tokens += textTokenBound(messageText(m));
  }
  return Math.ceil(tokens) + count * 8 + 16 + Math.max(0, Number(imageCount) || 0) * IMAGE_INPUT_TOKENS;
}

/* WEB SEARCH ON A WRITING CALL (2026-10-02): New Story's research grounds its Fact pillar with the
   writing engine's own web search — Claude Opus 5 / 5.5 and Sonnet 5 / 5.5, whose current search
   tool is web_search_20260209. Each search is $0.01 ($10 per 1,000), and the pages it reads come
   back as input tokens, so the HOLD allows TEXT_WEB_SEARCH_INPUT_TOKENS per search on top of the
   messages and the settle bills the searches the provider reports (usage.server_tool_use). */
export const TEXT_WEB_SEARCH_USD = 0.01;
export const TEXT_WEB_SEARCH_MAX_USES = 5;
export const TEXT_WEB_SEARCH_INPUT_TOKENS = 15000;
/** The search tool type a writing model runs, or "" when it has no web search here. */
export function textWebSearchTool(model) {
  return /^claude-(opus-5|sonnet-5)(?:$|-)/.test(String(model || "")) ? "web_search_20260209" : "";
}

/** Provider USD for a text call from its token counts. */
export function textCostUsd(rates, { inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0 } = {}, { vision = false } = {}) {
  if (!rates) return 0;
  const n = (x) => Math.max(0, Number(x) || 0);
  const usd = (n(inputTokens) * rates.input + n(cacheWriteTokens) * rates.cacheWrite
    + n(cacheReadTokens) * rates.cacheRead + n(outputTokens) * rates.output) / 1e6;
  return usd * (vision ? VISION_MULTIPLIER : 1);
}

/**
 * The HOLD for a text call: the most it can cost with `outputCap` output tokens.
 *   { inputTokens, outputCap, providerCostUsd, credits }
 * `promptCache` prices every input token as a cache write (the worst case).
 */
export function textHoldEstimate({ model, messages, imageCount = 0, outputCap, vision = false, promptCache = false, webSearches = 0, nowMs = Date.now(), unit = PROVIDER_USD_PER_CREDIT }) {
  const inputTokens = estimateInputTokens(messages, imageCount);
  const rates = textRates(model, { nowMs, inputTokens });
  if (!rates) return null;
  promptCache = !!promptCache || textCachesByDefault(model);
  const cap = Math.max(0, Math.floor(Number(outputCap) || 0));
  const providerCostUsd = textCostUsd(rates, promptCache
    ? { cacheWriteTokens: inputTokens, outputTokens: cap }
    : { inputTokens, outputTokens: cap }, { vision }) + webSearchHoldUsd(rates, webSearches);
  return { inputTokens, outputCap: cap, providerCostUsd, credits: creditsFromUsd(providerCostUsd, unit) };
}
/* the most `webSearches` searches can add: their fee and the pages they read, as input */
function webSearchHoldUsd(rates, webSearches) {
  const n = Math.max(0, Math.floor(Number(webSearches) || 0));
  return n ? n * TEXT_WEB_SEARCH_USD + (n * TEXT_WEB_SEARCH_INPUT_TOKENS * rates.input) / 1e6 : 0;
}

/* The smallest output cap a writing call runs with (index.ts minCap): a Claude call keeps its 16k
   thinking room (a smaller cap cuts its JSON off mid-reply), every other engine 1,024 tokens. */
export function textMinOutputCap(model) {
  return /^claude-/.test(String(model || "")) ? 16000 : 1024;
}

/**
 * The smallest hold ONE answer to this request needs on the cheapest of `models` (each at its own
 * minimum output cap) — below it, no engine in the list can run (round 3, S5: an empty or nearly
 * empty balance is told to add credits, not to choose a lighter engine that can't run either).
 * null when none of the models is priced.
 */
export function cheapestTextHold({ models, messages, imageCount = 0, vision = false, promptCache = false, nowMs = Date.now(), unit = PROVIDER_USD_PER_CREDIT }) {
  let best = null;
  for (const model of Array.isArray(models) ? models : []) {
    const h = textHoldEstimate({ model, messages, imageCount, outputCap: textMinOutputCap(model), vision,
      promptCache: (!!promptCache && /^claude-/.test(String(model))) || textCachesByDefault(model), nowMs, unit });
    if (h && (best == null || h.credits < best)) best = h.credits;
  }
  return best;
}

/**
 * The largest output cap (≤ wantedCap) whose hold fits `availableCredits`, or 0 when not even
 * `minCap` fits. Used so an account with a small balance still gets a (shorter) answer instead of
 * a refusal, and never more output than it can pay for.
 */
export function affordableOutputCap({ model, messages, imageCount = 0, wantedCap, minCap = 1024, availableCredits, vision = false, promptCache = false, webSearches = 0, nowMs = Date.now(), unit = PROVIDER_USD_PER_CREDIT }) {
  const want = Math.max(0, Math.floor(Number(wantedCap) || 0));
  const full = textHoldEstimate({ model, messages, imageCount, outputCap: want, vision, promptCache, webSearches, nowMs, unit });
  if (!full) return 0;
  const avail = Math.max(0, Math.floor(Number(availableCredits) || 0));
  if (full.credits <= avail) return want;
  const floor = Math.min(Math.max(0, Math.floor(Number(minCap) || 0)), want);
  const rates = textRates(model, { nowMs, inputTokens: full.inputTokens });
  const mult = vision ? VISION_MULTIPLIER : 1;
  const inputUsd = (full.inputTokens * ((promptCache || textCachesByDefault(model)) ? rates.cacheWrite : rates.input)) / 1e6;
  const budgetUsd = (avail * creditUnit(unit) - webSearchHoldUsd(rates, webSearches)) / mult - inputUsd;
  let cap = Math.min(want, Math.floor((budgetUsd * 1e6) / rates.output));
  // step down past any rounding edge until the hold really fits
  while (cap >= floor && cap > 0 && textHoldEstimate({ model, messages, imageCount, outputCap: cap, vision, promptCache, webSearches, nowMs, unit }).credits > avail) cap -= 16;
  return cap >= floor && cap > 0 ? cap : 0;
}

/** Token usage from a provider's response, including cache and thinking tokens. `model` tells an OpenAI call that
 *  writes the prompt cache (textCachesByDefault) apart from one that doesn't. */
export function normaliseTextUsage(provider, data, model = "") {
  const u = (data && (data.usage || data.usageMetadata || data.usage_metadata)) || {};
  const num = (x) => Math.max(0, Number(x) || 0);
  if (provider === "anthropic") {
    return {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheWriteTokens: num(u.cache_creation_input_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      webSearches: num(u.server_tool_use && u.server_tool_use.web_search_requests),
    };
  }
  if (provider === "google") {
    // Gemini bills thinking tokens as output; they are reported apart from the candidates. Its own prompt cache
    // (implicit, no write charge) is counted inside promptTokenCount: that part is billed as a cache read
    const prompt = num(u.promptTokenCount ?? u.prompt_token_count);
    const cached = Math.min(prompt, num(u.cachedContentTokenCount ?? u.cached_content_token_count));
    return {
      inputTokens: prompt - cached,
      outputTokens: num(u.candidatesTokenCount ?? u.candidates_token_count) + num(u.thoughtsTokenCount ?? u.thoughts_token_count),
      cacheWriteTokens: 0, cacheReadTokens: cached,
    };
  }
  if (provider === "openai" && textCachesByDefault(model)) {
    // GPT-6 family: prompt_tokens counts every input token; the cached part is billed as a read and a reported write
    // part as a write. With no write count reported, every uncached token of a cacheable prompt (1,024+) is billed as
    // a write — at most what OpenAI charges, and never above the hold, which prices all input as a write.
    const d = u.prompt_tokens_details || u.input_tokens_details || {};
    const prompt = num(u.prompt_tokens ?? u.input_tokens);
    const read = Math.min(prompt, num(d.cached_tokens));
    const reported = d.cache_write_tokens ?? d.cache_creation_tokens ?? u.cache_write_tokens;
    const write = reported != null ? Math.min(prompt - read, num(reported))
      : (prompt >= OPENAI_CACHE_MIN_TOKENS ? prompt - read : 0);
    return { inputTokens: prompt - read - write, outputTokens: num(u.completion_tokens ?? u.output_tokens),
      cacheWriteTokens: write, cacheReadTokens: read };
  }
  return { inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens), cacheWriteTokens: 0, cacheReadTokens: 0 };
}

/** The ACTUAL cost of a finished text call. Free help-chat calls cost 0 credits but keep their real USD. */
export function textActualCost(model, tokens, { vision = false, free = false, nowMs = Date.now(), unit = PROVIDER_USD_PER_CREDIT } = {}) {
  const inputTokens = (Number(tokens?.inputTokens) || 0) + (Number(tokens?.cacheWriteTokens) || 0) + (Number(tokens?.cacheReadTokens) || 0);
  const rates = textRates(model, { nowMs, inputTokens });
  const searchUsd = Math.max(0, Number(tokens?.webSearches) || 0) * TEXT_WEB_SEARCH_USD;
  const providerCostUsd = (rates ? textCostUsd(rates, tokens, { vision }) : 0) + searchUsd;
  return { providerCostUsd, credits: free ? 0 : creditsFromUsd(providerCostUsd, unit) };
}

/* ───────────────────────────── IMAGES ───────────────────────────── */

export const IMAGE_SIZES = Object.freeze(["1K", "2K", "4K"]);

/* fal's prices per image — the route the app uses (fal.ai/models). THE ENGINES (2026-10-11, owner — image
   engines): exactly Nano Banana 2.1, GPT Image 2.5 Flare, GPT Image 2.5 Sunburst and Seedream 5 Pro. Nano Banana 2,
   Nano Banana Pro and GPT Image 2 were removed (a locked likeness rendered the wrong face on them); their ids are
   mapped to a successor below (LEGACY_IMAGE_MODEL_IDS) and are never priced or served.
     Nano Banana 2.1 (2026-10-10, owner — it replaced Nano Banana 2 Lite): fal bills it per token with no per-image
       fee and no surcharge for resolution, web search or thinking (representative $0.040 / $0.059 / $0.134 at
       1K / 2K / 4K for a short prompt at medium thinking); the app charges $0.05 / $0.07 / $0.15 — that plus an
       allowance for long prompts and references (no extra per reference image).
     GPT Image 2.5 Flare / Sunburst: the price at the MODEL'S BASELINE SIZE (GPT_IMAGE_BASELINE_MP, fal's canonical
       1024x1024 row: low $0.00588, medium $0.01317, high $0.05268, xhigh $0.09366, max $0.21072 — 2026-10-11, the
       low / medium / high rows were below fal's and are now fal's own), scaled with output size
       (gptImageSizeFactor); "default" is high, "auto" is estimated at max.
     GPT Image 2.6 Flare / Sunburst (2026-11-05, owner — added beside 2.5): the same token rates ($30 / 1M image
       output) but more output tokens at low (x4.2) and medium (x3.3) — OpenAI's own token calculator (the image
       generation guide): 1024x1024 low $0.02469, medium $0.04347; high / xhigh / max as 2.5. Its reasoning effort
       ("complexity") has no separate fee.
     Seedream 5 Pro (2026-10-11, owner): fal's tentative per-image price by the OUTPUT'S PIXEL AREA — $0.0675 up to
       1536x1536 ("standard"), $0.135 above it up to 2048x2048 ("large") — plus, on the edit route (references),
       $0.0045 for each input image after the first ("extraRef"). The tier comes from the exact width x height the
       proxy sends (seedreamImageDimensions), never from the tier label.
   Keys match app/pricing.jsx TURN_PRICING.image.providerUsd so the admin's reviewed "pricing-overrides" apply to
   both. */
export const IMAGE_PROVIDER_USD = Object.freeze({
  "gemini-nano-banana-2.1": { "1K": 0.05, "2K": 0.07, "4K": 0.15 },
  "gpt-image-2.6-flare": { default: 0.05268, auto: 0.21072, low: 0.02469, medium: 0.04347, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  "gpt-image-2.6-sunburst": { default: 0.05268, auto: 0.21072, low: 0.02469, medium: 0.04347, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  "gpt-image-2.5-flare": { default: 0.05268, auto: 0.21072, low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  "gpt-image-2.5-sunburst": { default: 0.05268, auto: 0.21072, low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  "seedream-5-pro": { standard: 0.0675, large: 0.135, extraRef: 0.0045 },
});

/* The DIRECT Google route (provider "google"): Google's own, lower prices. Only these models
   may be sent there — any other name is refused (it used to cost 1 credit and ride into the URL).
   Nano Banana 2.1 (gemini-nano-banana-2.1): Google's standard price, $0.0336 / $0.0504 / $0.113. */
export const GOOGLE_IMAGE_USD = Object.freeze({
  "gemini-nano-banana-2.1": { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 },
});
/* The DIRECT OpenAI image route is RETIRED (2026-10-11, owner — image engines): it served GPT Image 2 only, which
   was removed. An older app's image request naming provider "openai" is served on fal (index.ts imageProvider),
   where GPT Image 2.5 runs; this list stays empty so imageCost never prices the direct route. */
export const OPENAI_DIRECT_IMAGE_MODELS = Object.freeze([]);

/* RETIRED IMAGE ENGINES: an older app (a saved pick, a batch option) may still send a retired engine's id — the
   proxy renders and prices it as its successor before the plan gate, the price and the route (index.ts). The
   retired engines themselves are never served. Mirrors app/imagegen.jsx NB_LEGACY_MODEL_IDS.
     2026-10-10 (owner): Nano Banana 2 Lite → Nano Banana 2.1.
     2026-10-11 (owner — image engines): Nano Banana 2 and Nano Banana Pro → Nano Banana 2.1; GPT Image 2 →
       GPT Image 2.5 Sunburst (its low / medium / high quality is one of Sunburst's, so it is kept). */
export const LEGACY_IMAGE_MODEL_IDS = Object.freeze({
  "gemini-3.1-flash-lite-image": "gemini-nano-banana-2.1",
  "gemini-3.1-flash-image": "gemini-nano-banana-2.1",
  "gemini-3-pro-image": "gemini-nano-banana-2.1",
  "gpt-image-2": "gpt-image-2.5-sunburst",
});
/** The image model id to serve: a retired engine's id → its successor; anything else unchanged. */
export function canonicalImageModel(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(LEGACY_IMAGE_MODEL_IDS, id) ? LEGACY_IMAGE_MODEL_IDS[id] : id;
}

/* web search on a fal Nano Banana 2.1 render (the only engine that grounds — 2026-10-11): fal adds no fee for it,
   but the search results count as input tokens — this is that allowance */
export const IMAGE_WEB_SEARCH_USD = 0.015;          // fal Nano Banana web search
export const GOOGLE_GROUNDING_USD = 0.035;          // direct Google search grounding, per request (conservative)
export const GPT_IMAGE_REFERENCE_USD = 0.012;       // per reference image (~1,500 image input tokens at $8 / 1M)
export const GPT_IMAGE_BASELINE_MP = Object.freeze({
  "gpt-image-2.6-flare": 1024 * 1024 / 1e6,
  "gpt-image-2.6-sunburst": 1024 * 1024 / 1e6,
  "gpt-image-2.5-flare": 1024 * 1024 / 1e6,          // canonical 1024-square
  "gpt-image-2.5-sunburst": 1024 * 1024 / 1e6,
});
/* fal's two GPT Image 2 points ($0.158 at 2.07 MP, $0.401 at 8.29 MP) fit cost ∝ MP^0.672 — kept for 2.5 and 2.6
   (2.6 multiplies 2.5's tokens by a constant per quality, so it scales with size the same way). */
export const GPT_IMAGE_SIZE_EXPONENT = 0.672;

/** GPT Image output pixels for TURN's aspect + resolution tier (the proxy's sizeForAspect). */
export function gptImageDimensions(aspect, imageSize) {
  const tier = IMAGE_SIZES.includes(imageSize) ? imageSize : "2K";
  const sizes = {
    "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
    "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
    "21:9": { "1K": "1344x576", "2K": "2688x1152", "4K": "3808x1632" },
    "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "3840x3840" },
    "3:4": { "1K": "768x1024", "2K": "1536x2048", "4K": "2880x3840" },
    "4:3": { "1K": "1024x768", "2K": "2048x1536", "4K": "3840x2880" },
  };
  return (sizes[aspect] || sizes["16:9"])[tier];
}

/** How much a GPT Image render costs relative to its model's baseline size. */
export function gptImageSizeFactor(model, aspect, imageSize) {
  const base = GPT_IMAGE_BASELINE_MP[model] || GPT_IMAGE_BASELINE_MP["gpt-image-2.5-sunburst"];
  const [w, h] = gptImageDimensions(aspect, imageSize).split("x").map(Number);
  return Math.pow((w * h / 1e6) / base, GPT_IMAGE_SIZE_EXPONENT);
}

/* SEEDREAM 5 PRO (2026-10-11, owner — image engines). fal's image_size takes {width, height} with a total pixel
   area between 1024x1024 and 2048x2048 and an aspect between 1/16 and 16 — no 4K. TURN offers 1K and 2K: 1K is the
   smallest area at or above 1024x1024 for the aspect (≈1.05 MP → the $0.0675 tier), 2K the largest at or below
   2048x2048 (≈4.1-4.19 MP → the $0.135 tier); a 4K request renders at 2K (seedreamImageSize). Both sides are
   multiples of 16. Mirrored by app/pricing.jsx turnSeedreamImageDimensions. */
export const SEEDREAM_MODEL = "seedream-5-pro";
export const SEEDREAM_MIN_PIXELS = 1024 * 1024;
export const SEEDREAM_MAX_PIXELS = 2048 * 2048;
export const SEEDREAM_STANDARD_MAX_PIXELS = 1536 * 1536;   // fal's price step
export const SEEDREAM_MAX_REFERENCES = 10;                  // fal's edit route uses at most 10 input images
const SEEDREAM_ASPECTS = { "16:9": 16 / 9, "9:16": 9 / 16, "21:9": 21 / 9, "1:1": 1, "3:4": 3 / 4, "4:3": 4 / 3 };
/** The resolution tier Seedream really renders: 1K stays 1K, anything else (2K, 4K) is 2K. */
export function seedreamImageSize(imageSize) {
  return imageSize === "1K" ? "1K" : "2K";
}
/** Seedream's exact output { width, height } for TURN's aspect + resolution tier (4K → 2K). */
export function seedreamImageDimensions(aspect, imageSize) {
  const r = SEEDREAM_ASPECTS[aspect] || SEEDREAM_ASPECTS["16:9"];
  const big = seedreamImageSize(imageSize) === "2K";
  const area = big ? SEEDREAM_MAX_PIXELS : SEEDREAM_MIN_PIXELS;
  const snap = (v) => (big ? Math.floor(v / 16) : Math.ceil(v / 16)) * 16;
  return { width: snap(Math.sqrt(area * r)), height: snap(Math.sqrt(area / r)) };
}
/** Seedream's provider USD for one render: the area tier of what is sent, plus each reference after the first. */
export function seedreamCostUsd({ aspect = "16:9", imageSize = "2K", referenceImages = 0, table = IMAGE_PROVIDER_USD } = {}) {
  const row = (table && table[SEEDREAM_MODEL]) || null;
  if (!row) return null;
  const { width, height } = seedreamImageDimensions(aspect, imageSize);
  const tier = Number(width * height <= SEEDREAM_STANDARD_MAX_PIXELS ? row.standard : row.large);
  if (!(tier > 0)) return null;
  const refs = Math.min(SEEDREAM_MAX_REFERENCES, Math.max(0, Math.floor(Number(referenceImages) || 0)));
  return tier + Math.max(0, refs - 1) * Math.max(0, Number(row.extraRef) || 0);
}

/* THE LONGEST IMAGE PROMPT (round 5, S4). An image is priced flat per render, but the direct Google
   route also bills the prompt's input tokens (and thinking) — a very long prompt was partly free.
   Every image route refuses (400, before any hold) a prompt longer than this, whatever the engine. A
   prompt at the limit adds at most ~10k input tokens (~$0.02 at the dearest listed Gemini image input
   price) to a flat-priced render. (2026-10-14) The app's prompts are NOT all well under it: a location
   plate with a large shared layout reached 33,577 characters — the per-engine limits below are what
   each engine is actually sent. */
export const IMAGE_PROMPT_MAX_CHARS = 40000;

/* PROMPT LIMITS PER IMAGE ENGINE (2026-10-14, owner — "go ahead with all of it"). A GPT Image 2.5 plate of
   33,577 characters came back from fal as a raw refusal: fal's schema for GPT Image 2.5 Flare and Sunburst stops
   at 32,000 characters (OpenAI's own limit for its image models). Each engine has its own ceiling here, a margin
   under what its provider takes:
     GPT Image 2.5 and 2.6 Flare / Sunburst — fal maxLength 32,000 → 31,500;
     Nano Banana 2.1 — fal maxLength 50,000 → held at IMAGE_PROMPT_MAX_CHARS (40,000);
     Seedream 5 Pro — fal publishes no maxLength and BytePlus advises short prompts (long ones "may scatter
       information") → 30,000.
   The image route refuses a longer prompt with prompt_too_long BEFORE any hold (index.ts). The app never gets
   there: the SAME table lives in app/pricing.jsx (TURN_IMAGE_PROMPT_LIMITS); its prompt builders fit themselves
   under it and proxyGenerate trims what is left in a fixed order (imagegen.jsx nbFitImagePrompt) — nobody is
   ever asked to shorten a prompt. An engine missing here gets IMAGE_PROMPT_MAX_CHARS. */
export const IMAGE_PROMPT_LIMITS = Object.freeze({
  "gpt-image-2.6-flare": 31500,
  "gpt-image-2.6-sunburst": 31500,
  "gpt-image-2.5-flare": 31500,
  "gpt-image-2.5-sunburst": 31500,
  "gemini-nano-banana-2.1": IMAGE_PROMPT_MAX_CHARS,
  "seedream-5-pro": 30000,
});
/** the longest prompt an image engine (a retired id maps to its successor) is sent */
export function imagePromptMaxChars(model) {
  const id = canonicalImageModel(String(model || ""));
  const n = Object.prototype.hasOwnProperty.call(IMAGE_PROMPT_LIMITS, id) ? Number(IMAGE_PROMPT_LIMITS[id]) : IMAGE_PROMPT_MAX_CHARS;
  return Math.min(IMAGE_PROMPT_MAX_CHARS, n > 0 ? n : IMAGE_PROMPT_MAX_CHARS);
}

/**
 * The cost of one image render, or null when the route does not serve the model.
 *   route         "fal" | "google" ("openai", the retired direct route, prices nothing)
 *   pricingKey    the validated quality's pricing key for GPT models (imagePricingQuality)
 *   table         the fal table with the admin's reviewed overrides merged in
 */
export function imageCost({ route = "fal", model, imageSize = "2K", aspect = "16:9", pricingKey, referenceImages = 0, webSearch = false, table = IMAGE_PROVIDER_USD, unit = PROVIDER_USD_PER_CREDIT }) {
  const id = String(model || "");
  const size = IMAGE_SIZES.includes(imageSize) ? imageSize : null;
  if (!size) return null;
  const isGpt = /^gpt-image/i.test(id);
  let usd;
  if (route === "google") {
    const row = GOOGLE_IMAGE_USD[id];
    if (!row) return null;
    usd = Number(row[size]) + (webSearch ? GOOGLE_GROUNDING_USD : 0);
  } else if (route === "openai" && !OPENAI_DIRECT_IMAGE_MODELS.includes(id)) {
    return null;
  } else {
    const row = (table && table[id]) || null;
    if (!row) return null;
    if (id === SEEDREAM_MODEL) {
      usd = seedreamCostUsd({ aspect, imageSize: size, referenceImages, table });
      if (!(usd > 0)) return null;
    } else if (isGpt) {
      const base = Number(row[pricingKey || "high"] ?? row.high);
      if (!(base > 0)) return null;
      usd = base * gptImageSizeFactor(id, aspect, size) + Math.max(0, Number(referenceImages) || 0) * GPT_IMAGE_REFERENCE_USD;
    } else {
      usd = Number(row[size]);
      if (!(usd > 0)) return null;
      if (webSearch) usd += IMAGE_WEB_SEARCH_USD;
    }
  }
  if (!(usd > 0)) return null;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit) };
}

/* ───────────────────────────── VIDEO ───────────────────────────── */

/* Provider USD per output second (fal.ai/models, 2026-09-29), keyed like app/pricing.jsx
   TURN_PRICING.video.providerUsdPerSecond so the reviewed overrides apply here too. Kling rates
   are audio-on (the proxy asks for audio unless told otherwise). Sora 2 was shut down on fal on
   2026-09-24 and is no longer allowed. */
export const VIDEO_PROVIDER_USD_PER_SECOND = Object.freeze({
  "seedance-2.0": {
    standard: { "480p": 0.1512, "720p": 0.3034, "1080p": 0.682, "4K": 1.55 },
    fast: { "480p": 0.121, "720p": 0.2419 },
  },
  "seedance-2.5": { standard: { "480p": 0.2205, "720p": 0.473, "1080p": 1.164 } },
  "kling-3.0": { standard: { "480p": 0.126, "720p": 0.126, "1080p": 0.126 }, pro: { "480p": 0.168, "720p": 0.168, "1080p": 0.168 } },
  "kling-3.0-motion-control": { standard: { "720p": 0.126 }, pro: { "1080p": 0.168 } },
});
/* Seedance with video references: fal multiplies the price by 0.6 and bills the input video's
   seconds as well as the output's. */
export const SEEDANCE_VIDEO_INPUT_MULTIPLIER = 0.6;

/** { family, tier } for a fal video endpoint, or null. */
export function videoFamily(endpoint) {
  const m = String(endpoint || "");
  if (/^bytedance\/seedance-2\.0\/fast\//.test(m)) return { family: "seedance-2.0", tier: "fast" };
  if (/^bytedance\/seedance-2\.0\//.test(m)) return { family: "seedance-2.0", tier: "standard" };
  if (/^bytedance\/seedance-2\.5\//.test(m)) return { family: "seedance-2.5", tier: "standard" };
  if (/^fal-ai\/kling-video\/v3\/(standard|pro)\/motion-control$/.test(m)) return { family: "kling-3.0-motion-control", tier: /\/pro\//.test(m) ? "pro" : "standard" };
  if (/^fal-ai\/kling-video\/v3\/(standard|pro)\/image-to-video$/.test(m)) return { family: "kling-3.0", tier: /\/pro\//.test(m) ? "pro" : "standard" };
  return null;
}

/** The app's Stage model id for an endpoint (what app/plans.jsx TIER_GATES names). */
export function videoAppModel(endpoint) {
  const f = videoFamily(endpoint);
  if (!f) return "";
  return f.family === "kling-3.0-motion-control" ? "kling-3.0-motion-control" : f.family;
}

/** A per-second rate from the (override-merged) table, or null. */
export function videoRate(table, family, tier, resolution) {
  const r = Number((((table || {})[family] || {})[tier] || {})[resolution]);
  return r > 0 ? r : null;
}

/**
 * The cost of one video render.
 *   { providerCostUsd, credits, billedSeconds, outputSeconds, inputSeconds, rate }  or null
 * `outputSeconds` must already follow the provider's own rules (clamps, auto → the maximum).
 */
export function videoCost({ endpoint, resolution, outputSeconds, inputVideoSeconds = 0, table = VIDEO_PROVIDER_USD_PER_SECOND, unit = PROVIDER_USD_PER_CREDIT }) {
  const f = videoFamily(endpoint);
  if (!f) return null;
  const res = String(resolution || "");
  const rate = videoRate(table, f.family, f.tier, res === "4k" ? "4K" : res);
  if (!rate) return null;
  const out = Math.max(0, Number(outputSeconds) || 0);
  if (!(out > 0)) return null;
  const input = /^seedance/.test(f.family) ? Math.max(0, Number(inputVideoSeconds) || 0) : 0;
  const usd = input > 0 ? rate * SEEDANCE_VIDEO_INPUT_MULTIPLIER * (out + input) : rate * out;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit), billedSeconds: out + input, outputSeconds: out, inputSeconds: input, rate };
}

/* RENDERS fal BILLS BY THE LENGTH OF A VIDEO IT WAS GIVEN (repair F2, 2026-09-30; round 2, S4).
     motion   Kling Motion Control: billed per output second, and the output IS the motion video
     editing  Seedance 2.5 "editing": the output follows @Video1; input + output seconds x 0.6
     refs     Seedance with video references: input + output seconds x 0.6
   The client's declared lengths are never trusted for money. MOTION CONTROL and EDITING are
   SETTLED FROM THE FINISHED RENDER ONLY (fal's own output, read on the fal.media host), never
   above the hold. THEIR HOLD (owner decision, round 4 — it was always the validators' maximum):
   when the proxy read the source video's length itself (media-length.mjs: the largest of every
   duration the file declares, edit lists included, fragmented files unreadable) from a place the
   file can't change after the read, the render is held for that length x 1.1 + 1 s, in tenths
   rounded up (lengthHoldSeconds), capped at the maximum — the motion video for Motion Control,
   the source video (@Video1) for editing, as both its output and its input seconds (plus the
   other reference videos as read). A source it couldn't read, or read from somewhere else, is
   held at the maximum as before. An output longer than its hold covered is charged the hold and
   reported for the owner (video-reconcile.mjs finishedVideoCharge: "[billing] length_mismatch").
   REFERENCE videos, whose length the output can't reveal, are billed by the length the proxy
   reads from each file and, for any it can't read, the combined maximum. The "expected" cost (the
   read input length, else the maximum) is what the Stage's quote is compared with. */
const lengthSeconds = (x) => Math.max(1, Math.ceil(Number(x) - 0.05));   // whole seconds, a hair of tolerance
const tenthsUp = (x) => Math.ceil(Number(x) * 10 - 1e-9) / 10;
/* The margin of a length-sized hold (round 4): read length x 1.1 + 1 s. app/stage.jsx
   STAGE_LENGTH_HOLD mirrors it (test-billing-app "K" compares the two). */
export const LENGTH_HOLD_FACTOR = 1.1;
export const LENGTH_HOLD_PAD_SECONDS = 1;
/** The seconds a length-sized hold covers for a video read at `readSeconds`: x 1.1 + 1 s, in
    tenths rounded up (5 s → 6.5 s). The caller caps it at the validators' maximum. */
export function lengthHoldSeconds(readSeconds) {
  return tenthsUp(Number(readSeconds) * LENGTH_HOLD_FACTOR + LENGTH_HOLD_PAD_SECONDS);
}
/* The settle-facts version this code writes and accepts (older facts: the hold is the charge). */
export const LENGTH_FACTS_VERSION = 2;

/**
 * The hold of a length-billed render, and the facts its settlement needs.
 *   kind              "motion" | "editing" | "refs"
 *   outputSeconds     "refs": the requested output (the model's maximum for auto)
 *   fixedOutput       "refs": true when the length was asked for (then it is billed as asked)
 *   maxOutputSeconds  the longest output this model / task / orientation allows
 *   maxInputSeconds   the longest combined reference video the validators allow (Seedance)
 *   inputs            the server-read length of each reference video, in order (null = unread)
 *   sizable           whether each read length may SIZE THE HOLD and be BILLED (round 4 for Motion
 *                     Control / editing; round 5, S3 for every kind: the file was read from a copy
 *                     no account can change — image-proxy's snapshot — or from fal's CDN), in
 *                     order; left out, every read length may. A read length that may not sets
 *                     only the expected cost (the quote check): the hold and the settle facts
 *                     (reference input seconds `vin`, editing's other references `vx`) treat it
 *                     as unread — the longest length allowed.
 * → { cost (videoCost of the HOLD), expected (videoCost at the read lengths — the quote check),
 *     facts, inputsRead, lengthSized } or null when the model has no price.
 */
export function lengthBilledVideoHold({ endpoint, resolution, kind, outputSeconds = 0, fixedOutput = false, maxOutputSeconds, maxInputSeconds = 0, inputs = [], sizable = null, table = VIDEO_PROVIDER_USD_PER_SECOND, unit = PROVIDER_USD_PER_CREDIT }) {
  const list = (Array.isArray(inputs) ? inputs : []).map((x) => (Number(x) > 0 ? Number(x) : null));
  const allRead = list.length > 0 && list.every((x) => x != null);
  // round 5 (S3): only a length read from a file no account can change after the read may be held
  // and billed — any other read counts as unread there (it still sets the expected cost)
  const billable = list.map((x, i) => (x != null && (!Array.isArray(sizable) || sizable[i] === true) ? x : null));
  const allBillable = billable.length > 0 && billable.every((x) => x != null);
  const maxOut = Math.max(1, Number(maxOutputSeconds) || 1);
  const maxIn = Math.max(0, Number(maxInputSeconds) || 0);
  const first = list[0];
  const sumIn = (arr) => Math.min(maxIn, tenthsUp(arr.reduce((t, n) => t + n, 0)));
  // the length-sized hold (round 4): the source's read length x 1.1 + 1 s — only for a length read
  // from a file that can't change after the read; otherwise (null) the maximum
  const firstSizable = first != null && (!Array.isArray(sizable) || sizable[0] === true);
  const held = firstSizable ? lengthHoldSeconds(first) : null;
  let out, input = 0, expOut, expIn = 0, vx = null;
  if (kind === "motion") {
    out = held != null ? Math.min(maxOut, held) : maxOut;
    expOut = first != null ? Math.min(maxOut, lengthSeconds(first)) : maxOut;
  } else if (kind === "editing") {
    expOut = first != null ? Math.min(maxOut, lengthSeconds(first)) : maxOut;
    expIn = allRead ? sumIn(list) : maxIn;
    const others = billable.slice(1);
    vx = others.every((x) => x != null) ? (others.length ? tenthsUp(others.reduce((t, n) => t + n, 0)) : 0) : null;
    // the output follows @Video1, and @Video1 is also input (the settle counts the output's length
    // as its input seconds): both held at its margin length, each capped at its own maximum; the
    // other reference videos add their read lengths to the input (any unread: the input maximum)
    out = held != null ? Math.min(maxOut, held) : maxOut;
    input = held != null && vx != null ? Math.min(maxIn, vx ? tenthsUp(held + vx) : held) : maxIn;
  } else {
    out = Math.max(1, Number(outputSeconds) || maxOut);
    input = allBillable ? sumIn(billable) : maxIn;
    expOut = out; expIn = allRead ? sumIn(list) : maxIn;
  }
  const cost = videoCost({ endpoint, resolution, outputSeconds: out, inputVideoSeconds: input, table, unit });
  if (!cost) return null;
  const expected = videoCost({ endpoint, resolution, outputSeconds: expOut, inputVideoSeconds: expIn, table, unit }) || cost;
  const k = kind === "motion" || kind === "editing" ? kind : "refs";
  // `mo` is the longest output the settle may count: the requested output for references, the
  // validators' maximum for Motion Control and editing — so an output longer than a length-sized
  // hold covered is priced in full, then capped at the hold and reported (finishedVideoCharge)
  const facts = { v: LENGTH_FACTS_VERSION, k, rate: cost.rate, mo: k === "refs" ? out : maxOut,
    fx: k === "refs" && fixedOutput ? 1 : 0, vin: k === "refs" && allBillable ? input : null, vx: k === "editing" ? vx : null,
    n: list.length, mi: maxIn };
  return { cost, expected, facts, inputsRead: allRead, lengthSized: k !== "refs" && held != null };
}

/** Facts from the hold's reason or a signed token, checked (anything odd, or an older version → null:
    the hold is then the charge). */
export function lengthBilledFacts(f) {
  if (!f || typeof f !== "object" || Number(f.v) !== LENGTH_FACTS_VERSION) return null;
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : NaN);
  const k = f.k === "motion" || f.k === "editing" || f.k === "refs" ? f.k : "";
  const rate = num(f.rate), mo = num(f.mo), mi = num(f.mi ?? 0), n = num(f.n ?? 0);
  if (!k || !(rate > 0) || !(mo > 0) || !(mi >= 0) || !(n >= 0)) return null;
  const opt = (x) => (x == null ? null : num(x));
  const vin = opt(f.vin), vx = opt(f.vx);
  if ((vin != null && !(vin >= 0)) || (vx != null && !(vx >= 0))) return null;
  return { v: LENGTH_FACTS_VERSION, k, rate, mo, fx: f.fx ? 1 : 0, vin: k === "refs" ? vin : null, vx: k === "editing" ? vx : null, n, mi };
}

/**
 * What a length-billed render really cost, from its finished length (seconds read from fal's
 * output MP4). → { providerCostUsd, credits, outputSeconds, inputSeconds } or null (unreadable:
 * the caller then charges the hold). The caller caps `credits` at the hold.
 *   motion   the output's own length
 *   editing  the output's length, and as input @Video1 (= the output's length) plus the other
 *            reference videos read at submit (the combined maximum when any was unread)
 *   refs     the asked-for (or the output's) length, plus the references read at submit
 */
export function lengthBilledVideoSettle(factsIn, realOutputSeconds, unit = PROVIDER_USD_PER_CREDIT) {
  const f = lengthBilledFacts(factsIn);
  const real = Number(realOutputSeconds);
  if (!f || !(real > 0) || !Number.isFinite(real)) return null;
  const realOut = Math.min(f.mo, lengthSeconds(real));
  const out = f.k === "refs" && f.fx ? f.mo : realOut;
  let input = 0;
  if (f.k === "editing") input = f.vx != null ? Math.min(f.mi, tenthsUp(realOut + f.vx)) : f.mi;
  else if (f.k === "refs") input = f.vin != null ? f.vin : f.mi;
  const usd = f.k === "motion" ? f.rate * out : f.rate * SEEDANCE_VIDEO_INPUT_MULTIPLIER * (out + input);
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit), outputSeconds: out, inputSeconds: input };
}

/**
 * Apply the admin-reviewed turn_app_config "pricing-overrides" `video` section to a copy of the
 * server table (same rules as the image merge in image-quality.mjs: only keys the table already
 * has, only sane provider-USD values, never mutating the inputs).
 */
export function mergeVideoPricingOverrides(baseTable, config) {
  const merged = {};
  for (const [family, tiers] of Object.entries(baseTable || {})) {
    merged[family] = {};
    for (const [tier, rates] of Object.entries(tiers || {})) merged[family][tier] = { ...rates };
  }
  const video = config && typeof config === "object" && !Array.isArray(config) ? config.video : null;
  if (video && typeof video === "object" && !Array.isArray(video)) {
    for (const [family, tiers] of Object.entries(video)) {
      if (!merged[family] || !tiers || typeof tiers !== "object") continue;
      for (const [tier, rates] of Object.entries(tiers)) {
        const target = merged[family][tier];
        if (!target || !rates || typeof rates !== "object") continue;
        for (const [res, raw] of Object.entries(rates)) {
          if (!Object.prototype.hasOwnProperty.call(target, res)) continue;
          const v = Number(raw);
          if (Number.isFinite(v) && v > 0.0002 && v < 100) target[res] = v;
        }
      }
    }
  }
  return merged;
}

/* ───────────────────────────── VOICE ───────────────────────────── */

/* ElevenLabs (elevenlabs.io/pricing/api; the fal mirror at fal.ai/models): v3 and Multilingual
   v2 $0.08 per 1K characters direct, $0.10 through fal; Turbo / Flash $0.04 direct, $0.05 fal —
   a line is charged at least the fal price of its class, and at the price of the fal endpoint
   that really rendered it when the backup serves it (TTS_MODELS below). Speech-to-text: fal's
   Scribe v2 $0.008 per audio minute (direct Scribe v2 is $0.22 an hour). Voice design and
   instant cloning: flat charges — their provider cost is NOT verified; adjust here. */
export const VOICE_USD = Object.freeze({
  ttsPer1kChars: 0.10,
  ttsPer1kCharsFast: 0.05,
  sttPerMinute: 0.008,
  design: 0.10,
  clone: 0.10,
});
/* SPEECH-TO-TEXT BY THE RECORDING'S REAL LENGTH (round 5, S1; owner decision (2)). The providers
   bill the whole recording by its audio length, so a transcription is HELD and SETTLED on the
   duration image-proxy reads from the recording's own container before the hold (audio-length.mjs:
   WebM / Ogg / MP4 / WAV) — never on its size (round 4 held 6 kbps, which a DTX file beat) and
   never on the transcript's word timestamps (round 4 settled at the last word: trailing silence
   was free). A provider-reported audio length counts only when it is LARGER (the settle is still
   never above the hold). A container it can't read, or a recording longer than STT_MAX_SECONDS, is
   refused (400) before any hold: the longest recording the app makes is New Story's spoken answer,
   which stops by itself after app/newstory.jsx NS_MAX_ANSWER_SECONDS (300 s); a minute more covers
   a recorder that stops late (test-server-charging A17 and test-billing-app Q keep the two in step;
   the owner's ceiling is 10 minutes). Only the transcription models the app uses are accepted (it
   names none: the default). */
export const STT_MAX_SECONDS = 360;
export const STT_MODELS = Object.freeze(["scribe_v1", "scribe_v2"]);
export const STT_DEFAULT_MODEL = "scribe_v1";
/** The accepted transcription model for `modelId` (none given → the default), or null (refused). */
export function sttModel(modelId) {
  if (modelId == null || modelId === "") return STT_DEFAULT_MODEL;
  return typeof modelId === "string" && STT_MODELS.includes(modelId) ? modelId : null;
}

/* TEXT-TO-SPEECH BY THE ROUTE THAT SERVES IT (repair F4, 2026-09-30). Only these ElevenLabs
   models are accepted (an unknown id is refused before any provider call — it used to be priced
   by a name match, rejected by ElevenLabs and then rendered by the fal backup at a higher price).
   `direct` is the rate charged when ElevenLabs serves the line; `falEndpoint` is the fal mirror
   the backup uses for that model, priced in FAL_TTS_USD_PER_1K. The HOLD covers the dearer of
   the two routes; the settle charges the route that actually served the line. */
export const FAL_TTS_USD_PER_1K = Object.freeze({
  // Eleven v4 (2026-10-11, owner): fal.ai/models/elevenlabs/tts/eleven-v4, $0.08 per 1,000 characters (its own namespace)
  "elevenlabs/tts/eleven-v4": 0.08,
  "fal-ai/elevenlabs/tts/eleven-v3": 0.10,
  "fal-ai/elevenlabs/tts/multilingual-v2": 0.10,
  "fal-ai/elevenlabs/tts/turbo-v2.5": 0.05,
});
export const TTS_MODELS = Object.freeze({
  // ELEVEN V4 (2026-10-11, owner — "bring in V4"): the provider's flagship, the app's default for new voices; $0.08 per
  // 1,000 characters direct (elevenlabs.io/pricing/api; held at the $0.10 rate like v3). Multilingual v2 is no longer
  // offered for new voices, but a voice already locked on it keeps rendering on it (a lock's model never changes).
  eleven_v4: Object.freeze({ direct: VOICE_USD.ttsPer1kChars, falEndpoint: "elevenlabs/tts/eleven-v4" }),
  eleven_v3: Object.freeze({ direct: VOICE_USD.ttsPer1kChars, falEndpoint: "fal-ai/elevenlabs/tts/eleven-v3" }),
  eleven_multilingual_v2: Object.freeze({ direct: VOICE_USD.ttsPer1kChars, falEndpoint: "fal-ai/elevenlabs/tts/multilingual-v2" }),
  eleven_turbo_v2_5: Object.freeze({ direct: VOICE_USD.ttsPer1kCharsFast, falEndpoint: "fal-ai/elevenlabs/tts/turbo-v2.5" }),
  // fal has no Flash mirror: the backup renders Eleven v3, at v3's price
  eleven_flash_v2_5: Object.freeze({ direct: VOICE_USD.ttsPer1kCharsFast, falEndpoint: "fal-ai/elevenlabs/tts/eleven-v3" }),
});

/** The accepted TTS model entry for `modelId`, or null (refused). */
export function ttsModel(modelId) {
  const id = String(modelId ?? "");
  return Object.prototype.hasOwnProperty.call(TTS_MODELS, id) ? TTS_MODELS[id] : null;
}

/**
 * The cost of one text-to-speech line, or null for a model that isn't accepted.
 *   route  "direct" (ElevenLabs served it), "fal" (the backup served it) or "hold" (the dearer
 *          of the two — what is held before either is called)
 */
export function ttsCost(text, modelId = "eleven_v3", unit = PROVIDER_USD_PER_CREDIT, { route = "hold" } = {}) {
  const m = ttsModel(modelId);
  if (!m) return null;
  const chars = String(text ?? "").length;
  const falRate = FAL_TTS_USD_PER_1K[m.falEndpoint];
  const per1k = route === "direct" ? m.direct : route === "fal" ? falRate : Math.max(m.direct, falRate);
  const usd = (chars / 1000) * per1k;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit), characters: chars, falEndpoint: m.falEndpoint, route };
}

/** The HOLD of a transcription (round 5, S1): the recording's container duration, in whole seconds
    rounded up (at least 1). → { providerCostUsd, credits, seconds } */
export function sttHoldCost(containerSeconds, unit = PROVIDER_USD_PER_CREDIT) {
  const n = Number(containerSeconds);
  const seconds = Math.max(1, Math.ceil((Number.isFinite(n) && n > 0 ? n : 0) - 1e-9));
  const usd = (seconds / 60) * VOICE_USD.sttPerMinute;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit), seconds };
}

/**
 * The audio length a transcription's provider REPORTED, in seconds, or null — a duration field of
 * its answer only. Word timestamps are never a length (round 5, S1: the last word's end is a lower
 * bound on the audio, and the providers bill all of it).
 */
export function sttReportedSeconds(data) {
  if (!data || typeof data !== "object") return null;
  const ok = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 && n < 24 * 3600 ? n : null; };
  return ok(data.audio_duration_secs) ?? ok(data.audio_duration) ?? ok(data.duration_seconds) ?? ok(data.duration);
}

/**
 * What a finished transcription costs (round 5, S1): the LARGER of the container duration and the
 * provider's reported length (whole seconds, at least 1), never more than the hold — which is the
 * container duration, so the charge is the recording's real length. A completed transcription
 * with empty text is charged the same (the provider billed the audio).
 * → { providerCostUsd, credits, seconds, heldSeconds, containerSeconds, reportedSeconds, reported, reportedLonger }
 */
export function sttSettleCost(reportedSeconds, containerSeconds, unit = PROVIDER_USD_PER_CREDIT) {
  const held = sttHoldCost(containerSeconds, unit).seconds;
  const r = Number(reportedSeconds);
  const reported = reportedSeconds != null && Number.isFinite(r) && r > 0;
  const reportedWhole = reported ? Math.max(1, Math.ceil(r - 1e-9)) : 0;
  const seconds = Math.min(held, Math.max(held, reportedWhole));
  const usd = (seconds / 60) * VOICE_USD.sttPerMinute;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit), seconds, heldSeconds: held,
    containerSeconds: Number(containerSeconds) || 0, reportedSeconds: reported ? r : null, reported, reportedLonger: reportedWhole > held };
}

export function flatVoiceCost(op, unit = PROVIDER_USD_PER_CREDIT) {
  const usd = op === "clone" ? VOICE_USD.clone : VOICE_USD.design;
  return { providerCostUsd: usd, credits: creditsFromUsd(usd, unit) };
}

/** Decoded byte length of a base64 string (without decoding it). */
export function base64Bytes(b64) {
  const s = String(b64 || "").replace(/\s/g, "");
  const pad = (s.match(/=*$/) || [""])[0].length;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

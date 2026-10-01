/* public-errors.mjs — what a provider or infrastructure failure may SAY to a user (billing
   fixes, 2026-09-30). Pure and testable in Node (scripts/test-server-charging.mjs).

   Users must never see the company's internals: provider account balances or invoices, API keys
   and server secrets, database / RPC errors, internal hosts, or which company runs a model. A
   provider's refusal of the CONTENT (safety, likeness, moderation, validation of the request) is
   useful and passes through — the Stage and the Art Room classify those words to offer the right
   recovery — with company names replaced by "the provider". Admins get the raw detail; the proxy
   logs it server-side either way. */

/* The whole message is replaced when it looks like any of these. */
const INTERNAL = [
  /credit balance|insufficient (?:balance|funds|quota)|exhausted balance|out of (?:credits|quota)|quota|billing|invoice|payment (?:required|method|failed)|subscription|user is locked|account (?:is )?(?:suspended|locked|disabled)|top[ -]?up|prepaid/i,
  /api[ _-]?key|x-api-key|x-goog-api-key|authorization|bearer|secret|credential|unauthori[sz]ed|permission denied|invalid (?:key|token)/i,
  /supabase|postgres|postgrest|pgrst|\bsql\b|sqlstate|\brpc\b|relation .* does not exist|function .* does not exist|row-level security|service[_ ]role|schema cache|storage (?:upload|list) failed/i,
  /https?:\/\/|\b(?:queue|rest)\.[a-z.]+\b|localhost|\b\d{1,3}(?:\.\d{1,3}){3}\b/i,
  /\bat [\w$.<>]+ \(|TypeError|ReferenceError|SyntaxError|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|error sending request/i,
];
/* Company names in a message that otherwise passes. */
const COMPANIES = /\b(?:Anthropic|OpenAI|Open AI|Google(?: AI)?|Gemini API|fal\.ai|fal|ElevenLabs|Eleven Labs|Moonshot(?: AI)?|ByteDance|Meshy)\b/gi;

export const GENERIC_PROVIDER_ERROR = "The generation service couldn't complete this request. Please try again in a moment.";

/**
 * A user-safe version of `detail`.
 *   fallback  what to say when the detail is internal (defaults to GENERIC_PROVIDER_ERROR)
 *   isAdmin   admins see the detail unchanged
 */
export function publicError(detail, { fallback = GENERIC_PROVIDER_ERROR, isAdmin = false } = {}) {
  const raw = String(detail == null ? "" : detail).trim();
  if (isAdmin) return raw || fallback;
  if (!raw) return fallback;
  if (INTERNAL.some((re) => re.test(raw))) return fallback;
  const scrubbed = raw.replace(COMPANIES, "the provider").replace(/\bthe provider(?:\s+the provider)+/gi, "the provider");
  return scrubbed.slice(0, 400);
}

/** True when `detail` would be replaced (for tests and logging). */
export function isInternalError(detail) {
  const raw = String(detail == null ? "" : detail);
  return INTERNAL.some((re) => re.test(raw));
}

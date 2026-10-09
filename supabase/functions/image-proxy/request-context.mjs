/* WHICH FILM AND WHICH ITEM A PAID CALL WAS FOR (2026-10-02, Art Room fix 10).
   The app names the film and the item (a character sheet, a prop, a location plate, a shot
   frame, a poster) an image request is for; the proxy records them on the call's usage row
   with the credit hold's ref, so every hold can be traced to a film and an asset.
   The names come from the browser, so they are reduced to a safe, short shape and anything else
   is dropped. assetId and purpose are for attribution and reports only. projectId ALSO names the
   film whose owner may pay (Team, 2026-10-03; Team review, 2026-10-09): film-payer.mjs hands it to
   the database (turn_film_payer), which decides — by the caller's own membership, never by
   anything else the browser says — whether the owner pays, the caller pays or the call is
   refused. A projectId alone never moves a charge to anyone.
   (Stage editor review, 2026-10-09) clipId names the Stage clip a video render is for (attribution,
   like assetId), and requestTake() reads the take a render the film's OWNER pays must land in:
   { clipId, meta } written on the hold row at submit (film-payer.mjs writeHoldTake). `take` is never
   part of requestContext() — it is no usage-row attribution and can be up to 4,000 characters. */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,159}$/;
const PURPOSE_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const CLIP_ID_RE = /^clip-[A-Za-z0-9_-]{1,100}$/;
export const TAKE_META_MAX_CHARS = 4000;

/** { projectId?, assetId?, purpose?, clipId? } from a request body's `context`, safe to store. */
export function requestContext(raw) {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const id = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return ID_RE.test(s) ? s : "";
  };
  const out = {};
  const projectId = id(c.projectId), assetId = id(c.assetId);
  const purpose = typeof c.purpose === "string" && PURPOSE_RE.test(c.purpose.trim()) ? c.purpose.trim() : "";
  if (projectId) out.projectId = projectId;
  if (assetId) out.assetId = assetId;
  if (purpose) out.purpose = purpose;
  const clipId = clipIdOf(c.clipId);
  if (clipId) out.clipId = clipId;
  return out;
}

const clipIdOf = (v) => (typeof v === "string" && CLIP_ID_RE.test(v) ? v : "");

/**
 * The take a video render lands in, from a request body's `context` (Stage editor review,
 * 2026-10-09): { clipId, meta? } or null.
 *   clipId  context.clipId — exactly "clip-" + 1-100 of A-Z a-z 0-9 _ - ; anything else: no take
 *   meta    context.take — a plain JSON object whose JSON is at most 4,000 characters (and has no
 *           NUL, which jsonb can't store); anything else is left out (the take keeps its clipId)
 */
export function requestTake(raw) {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const clipId = clipIdOf(c.clipId);
  if (!clipId) return null;
  const out = { clipId };
  const m = c.take;
  if (m && typeof m === "object" && !Array.isArray(m) && Object.getPrototypeOf(m) === Object.prototype) {
    let text = "";
    try { text = JSON.stringify(m); } catch (_e) { text = ""; }
    if (text && text.length <= TAKE_META_MAX_CHARS && !/\\u0000/.test(text)) out.meta = JSON.parse(text);
  }
  return out;
}

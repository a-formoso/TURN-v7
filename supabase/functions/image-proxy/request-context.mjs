/* WHICH FILM AND WHICH ITEM A PAID CALL WAS FOR (2026-10-02, Art Room fix 10).
   The app names the film and the item (a character sheet, a prop, a location plate, a shot
   frame, a poster) an image request is for; the proxy records them on the call's usage row
   with the credit hold's ref, so every hold can be traced to a film and an asset.
   The names come from the browser, so they are reduced to a safe, short shape and anything else
   is dropped. assetId and purpose are for attribution and reports only. projectId ALSO names the
   film whose owner may pay (Team, 2026-10-03; Team review, 2026-10-09): film-payer.mjs hands it to
   the database (turn_film_payer), which decides — by the caller's own membership, never by
   anything else the browser says — whether the owner pays, the caller pays or the call is
   refused. A projectId alone never moves a charge to anyone. */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,159}$/;
const PURPOSE_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** { projectId?, assetId?, purpose? } from a request body's `context`, safe to store. */
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
  return out;
}

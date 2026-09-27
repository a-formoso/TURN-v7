/* storage-keys.js — THE one parser for TURN Storage object keys (bucket turn-assets).
   Data only, no dependencies, no I/O. Sets globalThis.TurnStorageKeys (frozen).

   Owner decision 2026-09-27: new keys get READABLE top folders, name first (the
   Supabase dashboard cuts off the end) and the full id last:
     admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/…
   Old keys ({uid}/{projectId}/…) stay valid forever: read, delete, reference.

   Folder grammar (identical to public.turn_storage_segment_id in the SQL files):
     UUID     [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}   lowercase only
     LABEL    [a-z0-9]+(-[a-z0-9]+)*, 1-64 chars, and NO 8 hex digits in a row anywhere
     SEGMENT  UUID (legacy, no label)  |  LABEL "--" UUID (readable, at most 102 chars)
   A legacy folder's first 8 characters are always hex digits; a readable folder's never
   are, and no label can hold a uuid, a uuid without hyphens or any 8-digit group of one
   (so 'b2444e18a-5133-…--{own id}' or 'b2444e1851334155…--{own id}' are refused).
   The UUID is the ONLY thing any access check reads; a label is display text, and a
   client may put any valid label on its OWN id, so a label never proves who owns a
   file (the admin views read owners from the ids).
   The labels themselves are derived on the server only (turn_storage_folders RPC):
   the account handle from the email's local part, the project name from its first
   real title. Clients never invent them.

   Area layouts (folder positions below the first two never changed):
     asset             {acct}/{proj}/{folder}/{entity}[/…]/{file}      folder ∈ ASSET_FOLDERS
     show-import-copy  {acct}/{proj}/series-migration/{entity}/{hash}.{ext}
     stage-temp        {acct}/stage-tmp/{13-digit ms}-{kind}-…          (image-proxy)
     studio-preview    {acct}/studio-previews/{proj}/{loc}/{preview}.png (blender-bridge)
     relay PNG         {acct}/{proj}/shot/{job}/blender-preview-{job}.png (an asset key)
   '_internal/…' and 'blender-studio-internal/…' never parse as an account.

   Copies: scripts/build-dist.mjs copies this file byte-for-byte to
   supabase/functions/{image-proxy,blender-bridge,admin-storage}/storage-keys.js
   (Deno: `import "./storage-keys.js"`, then globalThis.TurnStorageKeys);
   scripts/test-storage-keys.mjs fails if a copy drifts. */
(function (root) {
  "use strict";
  var UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  var UUID_RE = new RegExp("^" + UUID_SRC + "$");
  var UUID_LOOSE_RE = new RegExp("^" + UUID_SRC + "$", "i");
  var READABLE_RE = new RegExp("^[a-z0-9]+(?:-[a-z0-9]+)*--" + UUID_SRC + "$");
  var HEX_RUN_RE = /[0-9a-f]{8}/;  // a label never holds 8 hex digits in a row
  var MAX_SEGMENT = 102;           // 64-char label + "--" + 36-char uuid
  var SERVICE_SEGMENTS = Object.freeze(["stage-tmp", "studio-previews"]);
  var INTERNAL_ROOTS = Object.freeze(["_internal", "blender-studio-internal"]);
  var ASSET_FOLDERS = Object.freeze(["character", "prop", "location", "shot", "asset", "locunit",
    "cameo", "storyboard", "lookbook", "other"]);

  function segment(seg) {
    if (typeof seg !== "string") return null;
    if (UUID_RE.test(seg)) return { id: seg, label: null, legacy: true };
    if (seg.length <= MAX_SEGMENT && READABLE_RE.test(seg) && !HEX_RUN_RE.test(seg.slice(0, -38)))
      return { id: seg.slice(-36), label: seg.slice(0, -38), legacy: false };
    return null;
  }
  function segmentId(seg) {
    var s = segment(seg);
    return s ? s.id : null;
  }
  /* Admin tools only: also a legacy UUID in any case (their pre-2026-09-27
     behaviour), lowercased. Readable segments stay strict. */
  function segmentIdLoose(seg) {
    var id = segmentId(seg);
    if (id) return id;
    return typeof seg === "string" && UUID_LOOSE_RE.test(seg) ? seg.toLowerCase() : null;
  }
  /* label null/"" → the legacy folder (the id itself). Throws unless the result
     parses back to exactly `id`. */
  function folder(label, id) {
    var out = (label === null || label === undefined || label === "") ? id : String(label) + "--" + id;
    if (typeof id !== "string" || segmentId(out) !== id)
      throw new Error("TurnStorageKeys.folder: not a valid storage folder for this id");
    return out;
  }
  /* true when `value` is a folder (legacy or readable) naming exactly `id`. */
  function isFolderFor(value, id) {
    return typeof id === "string" && id !== "" && segmentId(value) === id;
  }
  function parts(path) {
    return typeof path === "string" ? path.split("/") : [];
  }
  /* uploader id: needs 2+ segments (the SQL turn_storage_uid rule). */
  function uid(path) {
    var seg = parts(path);
    return seg.length >= 2 ? segmentId(seg[0]) : null;
  }
  /* project id of folder 2: strict; needs 3+ segments (turn_storage_project_id
     without its legacy-only permissive cast, which the app never wrote). */
  function projectId(path) {
    var seg = parts(path);
    return seg.length >= 3 ? segmentId(seg[1]) : null;
  }
  function parse(path) {
    var seg = parts(path), n = seg.length;
    var account = n >= 2 ? segment(seg[0]) : null;
    var out = { uid: account ? account.id : null, account: account, projectId: null, project: null,
      area: "unknown", relayPng: false };
    if (!account) return out;
    if (seg[1] === "stage-tmp") {
      if (n >= 3) out.area = "stage-temp";
      return out;
    }
    if (seg[1] === "studio-previews") {
      var prev = n >= 4 ? segment(seg[2]) : null;
      if (prev) { out.project = prev; out.projectId = prev.id; out.area = "studio-preview"; }
      return out;
    }
    var proj = n >= 3 ? segment(seg[1]) : null;
    if (!proj) return out;
    out.project = proj; out.projectId = proj.id;
    if (n >= 5 && seg[2] === "series-migration") out.area = "show-import-copy";
    else if (n >= 5 && ASSET_FOLDERS.indexOf(seg[2]) >= 0) {
      out.area = "asset";
      out.relayPng = n === 5 && seg[2] === "shot" && seg[4] === "blender-preview-" + seg[3] + ".png";
    }
    return out;
  }

  var api = Object.freeze({
    version: 1,
    UUID_SRC: UUID_SRC,
    MAX_SEGMENT: MAX_SEGMENT,
    SERVICE_SEGMENTS: SERVICE_SEGMENTS,
    INTERNAL_ROOTS: INTERNAL_ROOTS,
    ASSET_FOLDERS: ASSET_FOLDERS,
    segment: segment,
    segmentId: segmentId,
    segmentIdLoose: segmentIdLoose,
    folder: folder,
    isFolderFor: isFolderFor,
    uid: uid,
    projectId: projectId,
    parse: parse,
  });
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
  root.TurnStorageKeys = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

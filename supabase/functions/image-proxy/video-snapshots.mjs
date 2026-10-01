/* video-snapshots.mjs — server-only COPIES of the videos a render is sized and billed by (billing
   fixes, round 5, S3; owner decision (1), 2026-09-30). Pure and testable in Node
   (scripts/test-server-charging.mjs): the Storage client is handed in.

   WHY: some renders are held and billed by the length of a video the proxy READ at submit (Motion
   Control and editing size their hold by it; Seedance reference videos, and editing's other
   references, are billed by it). A file the account could still change after that read — one in
   the project's storage, a `stage:` upload in the account's own folder, or a data URL's staged copy
   there (depending on which storage rules are installed) — could be swapped for a longer one before
   fal fetched it, and the render would run longer than it was billed.

   WHAT: at submit, image-proxy COPIES such a video, with the service role, into a path no user
   storage rule lets an authenticated account write, update or delete:
       _internal/video-snapshots/<13-digit ms>-<the hold's uuid>-<index>.<mp4|mov|m4v|webm>
   (folder 1 `_internal` is no account id and folder 2 `video-snapshots` no project id, so neither
   storage.sql's owner rules nor the collaboration rules — insert / update need the caller's own id
   in folder 1, delete needs a project in folder 2 — ever match it; reads don't either. `_internal`
   is already the service files' root: blender-bridge's relay markers live there.) The proxy reads
   the COPY's length (for a data URL, the very bytes it uploaded) and hands fal a 24-hour signed URL
   of the COPY — so what fal renders from is exactly what was billed. A project-storage file is
   copied only when the caller's own signed URL opens it (that proves the account may read it; the
   copy then runs on the path that URL names).

   CLEANUP: the copies of a job are deleted when its hold settles or is released — by the poll
   (index.ts) or the housekeeping reconciliation (video-reconcile.mjs) — and a submit that never
   reached fal deletes its copies on the way out. The reconciliation also removes, best effort and
   bounded (SNAPSHOT_SWEEP_MAX a run), any copy older than two days (an admin's job, which takes no
   hold, or a delete that failed).

   A copy that fails is never replaced by a read of the original: that video counts as UNREAD — the
   render is held (and its references billed) at the longest length allowed. */

export const SNAPSHOT_DIR = "_internal/video-snapshots";
export const SNAPSHOT_URL_SECONDS = 24 * 60 * 60;
export const SNAPSHOT_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const SNAPSHOT_SWEEP_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTS = new Set(["mp4", "mov", "m4v", "webm"]);
const NAME_RE = /^(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{1,3})\.(mp4|mov|m4v|webm)$/;

/** The hold uuid of a video hold's ref ("video:<uuid>"), or "". */
export function snapshotHoldId(ref) {
  const m = /^video:(.+)$/.exec(String(ref || ""));
  return m && UUID_RE.test(m[1]) ? m[1] : "";
}
/** A snapshot's file extension from a MIME type or a path (anything else → mp4). */
export function snapshotExt(mimeOrPath) {
  const s = String(mimeOrPath || "").toLowerCase();
  if (/quicktime|\.mov$/.test(s)) return "mov";
  if (/webm/.test(s)) return "webm";
  if (/\.m4v$|x-m4v/.test(s)) return "m4v";
  const m = /\.([a-z0-9]+)$/.exec(s);
  return m && EXTS.has(m[1]) ? m[1] : "mp4";
}
/** The object key of a job's `index`-th snapshot. */
export function snapshotPath(holdId, index, ext = "mp4", now = Date.now()) {
  if (!UUID_RE.test(String(holdId || ""))) throw new Error("A snapshot needs its hold's id.");
  const stamp = String(Math.max(0, Math.floor(Number(now) || 0))).padStart(13, "0").slice(-13);
  return `${SNAPSHOT_DIR}/${stamp}-${holdId}-${Math.max(0, Math.floor(Number(index) || 0))}.${EXTS.has(ext) ? ext : "mp4"}`;
}
/** true for a key snapshotPath could have made. */
export function isSnapshotPath(path) {
  const s = String(path || "");
  return s.startsWith(SNAPSHOT_DIR + "/") && NAME_RE.test(s.slice(SNAPSHOT_DIR.length + 1));
}

/**
 * The object a signed URL of this project's storage names: { bucket, path } — only the
 * `/storage/v1/object/sign/<bucket>/<path>?token=…` form (a token is what proves the caller may
 * read it), on `projectHost`, in `bucket`, with a plain path that isn't a service file. Else null.
 */
export function projectStorageObject(url, { projectHost, bucket }) {
  let u;
  try { u = new URL(String(url || "")); } catch (_e) { return null; }
  if (u.protocol !== "https:" || !projectHost || u.host !== projectHost) return null;
  if (!u.searchParams.get("token")) return null;
  const m = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
  if (!m) return null;
  let b, segs;
  try { b = decodeURIComponent(m[1]); segs = m[2].split("/").map((x) => decodeURIComponent(x)); } catch (_e) { return null; }
  if (b !== bucket) return null;
  if (!segs.length || segs.some((x) => !x || x === "." || x === ".." || x.includes("/") || x.includes("\\") || x.includes("\0"))) return null;
  const path = segs.join("/");
  if (path.length > 1024 || segs[0] === "_internal") return null;
  return { bucket: b, path };
}

/** The snapshot keys to remove from a listing of SNAPSHOT_DIR: older than `maxAgeMs`, at most `max`. */
export function planSnapshotSweep(rows, now, maxAgeMs = SNAPSHOT_MAX_AGE_MS, max = SNAPSHOT_SWEEP_MAX) {
  const out = [];
  for (const o of Array.isArray(rows) ? rows : []) {
    const m = NAME_RE.exec(String((o && o.name) || ""));
    if (!m) continue;
    if (now - Number(m[1]) > maxAgeMs) out.push(`${SNAPSHOT_DIR}/${o.name}`);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The snapshot store over one bucket.
 *   storage()   → the service-role Storage API of the bucket (supabase-js storage.from(bucket))
 *   log(m)      server-side log (never shown to users)
 *   now()       the clock
 */
export function createVideoSnapshots({ storage, log = () => {}, now = () => Date.now() } = {}) {
  const say = (m) => { try { log(m); } catch (_e) { /* logging never breaks a render */ } };
  const api = () => storage();
  const signed = async (path) => {
    const r = await api().createSignedUrl(path, SNAPSHOT_URL_SECONDS);
    const url = r && !r.error && r.data ? String(r.data.signedUrl || "") : "";
    return url || null;
  };
  const removePaths = async (paths) => {
    const list = (Array.isArray(paths) ? paths : []).filter(isSnapshotPath);
    if (!list.length) return 0;
    try {
      const r = await api().remove(list);
      if (r && r.error) { say(`[billing] snapshot cleanup failed (${String(r.error.message || r.error).slice(0, 160)}); the sweep removes them after two days.`); return 0; }
      return list.length;
    } catch (e) {
      say(`[billing] snapshot cleanup failed (${String((e && e.message) || e).slice(0, 160)}); the sweep removes them after two days.`);
      return 0;
    }
  };
  // a copy that was made but can't be signed is removed again (it would only sit there)
  const finish = async (path) => {
    let url = null;
    try { url = await signed(path); } catch (_e) { url = null; }
    if (url) return { path, url };
    await removePaths([path]);
    return null;
  };
  return {
    /** Upload bytes the proxy holds (a data URL's) as the job's `index`-th snapshot. → { path, url } | null */
    async fromBlob(holdId, index, blob, ext = "mp4") {
      try {
        const path = snapshotPath(holdId, index, ext, now());
        const up = await api().upload(path, blob, { contentType: (blob && blob.type) || "video/mp4", upsert: false });
        if (up && up.error) { say(`[billing] snapshot upload failed (${String(up.error.message || up.error).slice(0, 160)}); the video counts as unread.`); return null; }
        return await finish(path);
      } catch (e) {
        say(`[billing] snapshot upload failed (${String((e && e.message) || e).slice(0, 160)}); the video counts as unread.`);
        return null;
      }
    },
    /** Copy an object of the bucket (service role) as the job's `index`-th snapshot. → { path, url } | null */
    async copy(holdId, index, fromPath, ext = "mp4") {
      try {
        const path = snapshotPath(holdId, index, ext, now());
        const r = await api().copy(fromPath, path);
        if (r && r.error) { say(`[billing] snapshot copy failed (${String(r.error.message || r.error).slice(0, 160)}); the video counts as unread.`); return null; }
        return await finish(path);
      } catch (e) {
        say(`[billing] snapshot copy failed (${String((e && e.message) || e).slice(0, 160)}); the video counts as unread.`);
        return null;
      }
    },
    removePaths,
    /** Delete every snapshot of the job whose hold is `ref` (best effort). → how many were removed */
    async drop(ref) {
      const id = snapshotHoldId(ref);
      if (!id) return 0;
      try {
        // `search` is a substring match: the exact names are picked from what it returns
        const r = await api().list(SNAPSHOT_DIR, { limit: 100, search: id });
        if (r && r.error) { say(`[billing] snapshot lookup for ${ref} failed (${String(r.error.message || r.error).slice(0, 160)}); the sweep removes them after two days.`); return 0; }
        const names = ((r && r.data) || []).map((o) => String((o && o.name) || "")).filter((n) => { const m = NAME_RE.exec(n); return !!m && m[2] === id; });
        return await removePaths(names.map((n) => `${SNAPSHOT_DIR}/${n}`));
      } catch (e) {
        say(`[billing] snapshot lookup for ${ref} failed (${String((e && e.message) || e).slice(0, 160)}); the sweep removes them after two days.`);
        return 0;
      }
    },
    /** Remove snapshots older than two days (bounded, best effort). → how many were removed */
    async sweep() {
      try {
        const r = await api().list(SNAPSHOT_DIR, { limit: 1000, sortBy: { column: "name", order: "asc" } });
        if (r && r.error) return 0;
        return await removePaths(planSnapshotSweep((r && r.data) || [], now()));
      } catch (_e) {
        return 0;
      }
    },
  };
}

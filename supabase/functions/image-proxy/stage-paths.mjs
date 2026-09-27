/* stage-paths.mjs — image-proxy's staging keys (bucket turn-assets), pure and
   testable in Node (scripts/test-storage-service-paths.mjs). No Deno or Supabase
   imports: index.ts passes the RPC call in.

   Device media and data-URL inputs are staged under the CALLER's own folder:
     legacy    {uid}/stage-tmp/{13-digit ms}-{kind}-…            (every key before 2026-09-27)
     readable  {handle}--{uid}/stage-tmp/{13-digit ms}-{kind}-…  (owner decision 2026-09-27)
   The account folder comes from the service-role RPC turn_storage_folders_for
   (supabase/storage-readable-folders.sql) and is used only when it parses back to
   exactly the caller's id; any other outcome (function missing, execute revoked,
   error, timeout, mismatch) stages under the bare uid, as before.
   A `stage:` reference is accepted in either form, for the caller only: exactly
   three segments, folder 2 exactly "stage-tmp", folder 1 naming the caller's id
   (the label is never trusted or compared), and a plain file name. */
import "./storage-keys.js";

const K = globalThis.TurnStorageKeys;
export const STAGE_SEGMENT = "stage-tmp";
const FILE_RE = /^[A-Za-z0-9_.-]+$/;

/** true when `path` is a staging object of `userId` (either folder form). */
export function isCallerStagePath(path, userId) {
  if (typeof path !== "string" || typeof userId !== "string" || !userId) return false;
  if (path.length > 1024 || path.includes("..")) return false;
  const seg = path.split("/");
  if (seg.length !== 3 || seg[1] !== STAGE_SEGMENT) return false;
  if (!K || K.segmentId(seg[0]) !== userId) return false;
  return FILE_RE.test(seg[2]);
}

/** "stage:<path>" → the path; null when `ref` is not a stage reference at all;
    throws when it is one but lies outside the caller's staging folders. */
export function stagedRefPath(ref, userId) {
  const m = /^stage:(.+)$/i.exec(String(ref || ""));
  if (!m) return null;
  if (!isCallerStagePath(m[1], userId)) throw new Error("Staged media reference is outside your upload namespace.");
  return m[1];
}

/** The RPC answer {v:1, account} → the readable account folder, or the bare uid. */
export function accountFolderFromRpc(result, userId) {
  const data = result && !result.error ? result.data : null;
  const account = data && data.v === 1 ? data.account : null;
  return typeof account === "string" && K && K.isFolderFor(account, userId) && account !== userId
    ? account : userId;
}

/** Calls `callRpc()` (the service-role turn_storage_folders_for) with a timeout;
    never throws, falls back to the bare uid. */
export async function resolveAccountFolder(callRpc, userId, timeoutMs = 5000) {
  let timer = null;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const result = await Promise.race([Promise.resolve().then(callRpc), timeout]);
    return accountFolderFromRpc(result, userId);
  } catch (_e) {
    return userId;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Object key for a new staging file under `accountFolder`. */
export function stagePath(accountFolder, fileName) {
  return `${accountFolder}/${STAGE_SEGMENT}/${fileName}`;
}

/** The staging folders to sweep for this caller: the legacy one always (files
    staged before readable folders, or by the previous deployment), the readable
    one too when it differs. */
export function stageDirs(userId, accountFolder) {
  const dirs = [`${userId}/${STAGE_SEGMENT}`];
  if (typeof accountFolder === "string" && accountFolder !== userId && K && K.isFolderFor(accountFolder, userId)) {
    dirs.push(`${accountFolder}/${STAGE_SEGMENT}`);
  }
  return dirs;
}

/** Sweep plan over the listings of stageDirs(): expired object keys (stamp older
    than ttlMs) and the number of live DEVICE slots across all folders. */
export function planStageSweep(listings, now, ttlMs) {
  const stampOf = (n) => Number((/^(\d{13})-/.exec(n) || [])[1]);
  const expired = [];
  let live = 0;
  for (const listing of listings || []) {
    const rows = ((listing && listing.rows) || []).filter((o) => o && o.name && !String(o.name).endsWith("/"));
    for (const o of rows) {
      const name = String(o.name), t = stampOf(name);
      if (Number.isFinite(t) && now - t > ttlMs) expired.push(`${listing.dir}/${name}`);
      else if (/-device-/.test(name)) live++;
    }
  }
  return { expired, live };
}

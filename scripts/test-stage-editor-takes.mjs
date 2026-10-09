#!/usr/bin/env node
/* ============================================================================
   STAGE EDITOR — TAKES AND VOICED LINES ON A SHARED FILM (Stage editor review, 2026-10-09)
   Behaviour in node vm sandboxes with a recording Supabase adapter — no network.

   T1  cloudCommitVideo is a compare-and-set MERGE (union by url, the local current
       stays unless the remote current is unknown, 20-take rollover with approved
       takes kept, updated_at fence, insert-if-absent with a re-read on a lost race,
       3 tries) and the device keeps the merged entry
   T2  every new take carries `by`; vidTakeDeletable; vidDeleteTake / vidClear refuse
       another person's take on a shared film
   T3  a permission refusal says so plainly, once, and is never retried
   T4  a submit names its clip + take (context merged with the film's); the owner
       collects pending takes (recovered new takes, duplicates skipped, marked collected)
   T5  voiced lines are film assets, one row per voicing in the voicer's own folder:
       cloudCommitAudio / cloudAudioLoadAll / cloudAudioDownload (size + SHA-256) /
       cloudDeleteAudio; voicegen loads the film's rows once per film, fetches the
       voicing matching the line's hash, and clears only the person's own voicings
   T6  cleanup only ever removes keys inside THIS film's folders; clip rows are skipped
   T7  a take plays only from a provider host / this project's Storage / data / own blob

     node scripts/test-stage-editor-takes.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { transformSync } from "@babel/core";

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const tick = ms => new Promise(r => setTimeout(r, ms));
const noop = () => {};
const compile = file => transformSync(readFileSync(file, "utf8"), { presets: ["@babel/preset-react"], filename: file }).code;
const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const baseSandbox = () => {
  const sb = {
    console, Date, Math, JSON, Promise, Map, Set, Blob, Uint8Array, ArrayBuffer, atob, btoa,
    crypto: webcrypto, Number, String, Array, Object, RegExp, Error,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms >= 1000 && t && t.unref) t.unref(); return t; },
    clearTimeout, setInterval: () => 0, clearInterval: noop,
    React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: "node-test", onLine: true },
    location: { href: "", search: "", hash: "", origin: "https://app.test" },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    document: { createElement: () => ({ style: {} }), addEventListener: noop, removeEventListener: noop },
    addEventListener: noop, removeEventListener: noop,
  };
  sb.__events = []; sb.__toasts = [];
  sb.dispatchEvent = ev => { sb.__events.push(ev); return true; };
  sb.appToast = (m, k) => sb.__toasts.push({ m, k });
  sb.window = sb; sb.globalThis = sb;
  return sb;
};

/* ── a recording Supabase adapter (turn_generations + Storage + rpc) ── */
function makeSupabase() {
  const S = { rows: [], files: new Map(), removed: [], uploads: [], rpcCalls: [], mutations: [], beforeMutation: null, stamp: 0, rpc: {} };
  const matches = (row, filters) => filters.every(([k, op, v]) => {
    const val = row[k];
    if (op === "eq") return String(val ?? "") === String(v ?? "");
    if (op === "is") return v === null ? val == null : val === v;
    if (op === "like") { const pre = String(v).replace(/%$/, ""); return String(val || "").startsWith(pre); }
    return true;
  });
  const touch = row => { row.updated_at = "t" + (++S.stamp); };
  function query(table) {
    const filters = []; let mutation = null;
    const run = async single => {
      if (mutation && S.beforeMutation) { const hook = S.beforeMutation; await hook(mutation, filters); }
      if (mutation) S.mutations.push({ kind: mutation.kind, fields: clone(mutation.value), filters: filters.slice() });
      if (mutation && mutation.kind === "insert") {
        const v = clone(mutation.value);
        if (S.rows.some(r => r.project_id === v.project_id && r.entity_id === v.entity_id))
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        touch(v); S.rows.push(v);
        return { data: single ? clone(v) : [clone(v)], error: null };
      }
      let hit = S.rows.filter(r => matches(r, filters));
      if (mutation && mutation.kind === "update") hit.forEach(r => { Object.assign(r, clone(mutation.value)); touch(r); });
      if (mutation && mutation.kind === "delete") S.rows = S.rows.filter(r => !matches(r, filters));
      return { data: single ? (hit[0] ? clone(hit[0]) : null) : clone(hit), error: null };
    };
    const q = {
      select() { return q; },
      eq(k, v) { filters.push([k, "eq", v]); return q; },
      is(k, v) { filters.push([k, "is", v]); return q; },
      like(k, v) { filters.push([k, "like", v]); return q; },
      in() { return q; }, order() { return q; }, range() { return q; },
      insert(v) { mutation = { kind: "insert", value: v }; return q; },
      update(v) { mutation = { kind: "update", value: v }; return q; },
      delete() { mutation = { kind: "delete" }; return q; },
      maybeSingle() { return run(true); }, single() { return run(true); },
      then(res, rej) { return run(false).then(res, rej); },
    };
    return q;
  }
  const storage = {
    upload: async (path, blob) => { S.uploads.push(path); S.files.set(path, blob); return { data: { path }, error: null }; },
    remove: async paths => { paths.forEach(p => { S.removed.push(p); S.files.delete(p); }); return { error: null }; },
    createSignedUrl: async path => ({ data: { signedUrl: "https://sb.test/storage/v1/object/sign/turn-assets/" + path + "?token=x" }, error: null }),
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: "https://sb.test/sign/" + path })), error: null }),
  };
  S.client = {
    from: t => query(t),
    storage: { from: () => storage },
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (name, args) => { S.rpcCalls.push([name, clone(args)]); const h = S.rpc[name]; return h ? h(args) : { data: null, error: { code: "PGRST202", message: "Could not find the function" } }; },
  };
  return S;
}
const cloudSandbox = () => {
  const S = makeSupabase();
  const C = baseSandbox();
  C._sbClient = S.client;
  C.TURN_SUPABASE = { url: "https://sb.test", bucket: "turn-assets" };
  // the signed URL fetch reads the stored file back
  C.fetch = async url => {
    const m = /\/sign\/turn-assets\/([^?]+)/.exec(String(url));
    const blob = m && S.files.get(m[1]);
    return blob ? { ok: true, blob: async () => blob } : { ok: false, blob: async () => null };
  };
  vm.createContext(C);
  vm.runInContext(readFileSync("app/storage-keys.js", "utf8"), C, { filename: "app/storage-keys.js" });
  vm.runInContext(compile("app/cloud.jsx"), C, { filename: "app/cloud.jsx" });
  return { C, S };
};

await (async () => {
  /* ════════ T1 — the compare-and-set merge ════════ */
  {
    const { C, S } = cloudSandbox();
    const take = (url, extra) => ({ url, meta: { createdAt: extra && extra.t || 1, ...(extra && extra.m || {}) }, savedAt: extra && extra.t || 1 });
    // pure merge
    const local = { url: "A", meta: { createdAt: 50, takes: [take("B", { t: 40 })] } };
    const remote = { url: "C", meta: { createdAt: 45, takes: [take("B", { t: 40 }), take("D", { t: 30 }), take("X", { t: 20 })] } };
    const m = C.cloudMergeVideoEntry(local, remote, ["X"]);
    const urls = m.meta.takes.map(t => t.url);
    ok("T1 merge: the local current stays", m.url === "A");
    ok("T1 merge: the unknown remote current joins the takes, remote takes join by url, newest first", JSON.stringify(urls) === JSON.stringify(["C", "B", "D"]), JSON.stringify(urls));
    ok("T1 merge: a url this write removes never comes back", !urls.includes("X"));
    ok("T1 merge: the remote current that is already a local take adds nothing", C.cloudMergeVideoEntry({ url: "A", meta: { takes: [take("C")] } }, { url: "C", meta: {} }).meta.takes.length === 1);
    // rollover: 20 non-approved + approved kept
    const many = Array.from({ length: 20 }, (_, i) => take("L" + i, { t: 100 - i }));
    many.push(take("AP", { t: 1, m: { status: "approved" } }));
    const rolled = C.cloudMergeVideoEntry({ url: "CUR", meta: { takes: many } }, { url: "CUR", meta: { takes: [take("NEW", { t: 200 })] } });
    const rt = rolled.meta.takes;
    ok("T1 merge: 20-take rollover — the newest remote take joins, the oldest non-approved rolls off",
      rt[0].url === "NEW" && !rt.some(t => t.url === "L19") && rt.filter(t => !(t.meta && t.meta.status === "approved")).length === 20);
    ok("T1 merge: approved takes never roll over", rt.some(t => t.url === "AP"));
    const twoStars = C.cloudMergeVideoEntry({ url: "A", meta: { status: "approved", takes: [] } }, { url: "R", meta: { status: "approved" } });
    ok("T1 merge: one approved take per clip — this device's choice stands", twoStars.meta.takes[0].meta.status === undefined);

    // CAS write: a concurrent take lands between read and update → retried, merged
    S.rows.push({ project_id: "p1", owner: "owner", entity_id: "clip-s1", storage_path: null, refs: [], history: [], updated_at: "t0",
      meta: { kind: "video", updatedAt: 1, video: { url: "R1", meta: { createdAt: 10, takes: [] } } } });
    let raced = false;
    S.beforeMutation = async (mut) => {
      if (mut.kind === "update" && !raced) {
        raced = true;
        const r = S.rows.find(x => x.entity_id === "clip-s1");
        r.meta = { kind: "video", updatedAt: 2, video: { url: "R2", meta: { createdAt: 20, takes: [take("R1", { t: 10 })] } } };
        r.updated_at = "t-concurrent";
      }
    };
    const res = await C.cloudCommitVideo("p1", "collab", "clip-s1", { url: "L1", meta: { createdAt: 30, takes: [take("R1", { t: 10 })] } });
    S.beforeMutation = null;
    const row = S.rows.find(x => x.entity_id === "clip-s1");
    const all = [row.meta.video.url].concat(row.meta.video.meta.takes.map(t => t.url));
    ok("T1 CAS: two people rendering the same clip keep both takes", all.includes("L1") && all.includes("R1") && all.includes("R2"), JSON.stringify(all));
    ok("T1 CAS: the update is fenced on updated_at and retried after the concurrent write",
      S.mutations.filter(x => x.kind === "update").length === 2
      && S.mutations.filter(x => x.kind === "update").every(x => x.filters.some(f => f[0] === "updated_at")));
    ok("T1 CAS: the row keeps only kind/updatedAt/video, no file, no refs/history",
      JSON.stringify(Object.keys(row.meta).sort()) === JSON.stringify(["kind", "updatedAt", "video"]) && row.storage_path === null
      && Array.isArray(row.refs) && !row.refs.length && Array.isArray(row.history) && !row.history.length);
    ok("T1 CAS: the owner column is not rewritten by a collaborator's update", row.owner === "owner");
    ok("T1 CAS: returns the merged entry for the device", res.ok && res.entry && res.entry.url === "L1" && res.entry.meta.takes.some(t => t.url === "R2"));

    // insert when absent; a lost insert race re-reads and merges
    S.mutations.length = 0;
    S.beforeMutation = async (mut) => {
      if (mut.kind === "insert" && !S.rows.some(r => r.entity_id === "clip-new")) {
        S.rows.push({ project_id: "p1", owner: "other", entity_id: "clip-new", storage_path: null, refs: [], history: [], updated_at: "t-other",
          meta: { kind: "video", updatedAt: 3, video: { url: "O1", meta: { createdAt: 5 } } } });
      }
    };
    await C.cloudCommitVideo("p1", "collab", "clip-new", { url: "N1", meta: { createdAt: 9 } });
    S.beforeMutation = null;
    const nrow = S.rows.find(x => x.entity_id === "clip-new");
    ok("T1 insert race: a unique conflict re-reads and merges instead of failing",
      nrow.meta.video.url === "N1" && nrow.meta.video.meta.takes.some(t => t.url === "O1")
      && S.mutations.map(x => x.kind).join(",") === "insert,update");
    await C.cloudCommitVideo("p1", "collab", "clip-fresh", { url: "F1", meta: {} });
    const frow = S.rows.find(x => x.entity_id === "clip-fresh");
    ok("T1 insert: an absent clip row is inserted with no file", frow && frow.storage_path === null && frow.owner === "collab");

    // gives up after 3 tries
    S.beforeMutation = async (mut) => { if (mut.kind === "update") { const r = S.rows.find(x => x.entity_id === "clip-s1"); r.updated_at = "t-busy-" + Math.random(); } };
    let threw = null;
    try { await C.cloudCommitVideo("p1", "collab", "clip-s1", { url: "L1", meta: {} }); } catch (e) { threw = e; }
    S.beforeMutation = null;
    ok("T1 CAS: a clip that keeps changing gives up after 3 tries (the dirty ledger retries later)", !!threw && /conflict/.test(threw.message));
  }

  /* ════════ videogen sandbox (T1 device side, T2, T3, T4, T7) ════════ */
  const V = baseSandbox();
  let scope = { projectId: "p1", uid: "u-collab", epoch: 1 };
  let shared = true;
  V.nbCloudScope = () => scope;
  V.nbEpoch = () => 1;
  V.turnFilmPaidByOwner = () => shared;
  V.__turnCurrentProjectId = "p1";
  V.turnFilmContext = () => ({ projectId: String(V.__turnCurrentProjectId) });
  V.TURN_SUPABASE = { url: "https://sb.test", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy", bucket: "turn-assets" };
  const commits = []; let commitImpl = null; const deletes = [];
  V.cloudCommitVideo = async (pid, uid, cid, entry, opts) => { commits.push({ pid, uid, cid, entry: clone(entry), opts: clone(opts) }); return commitImpl ? commitImpl(pid, uid, cid, entry, opts) : { ok: true }; };
  V.cloudVideoDelete = async (pid, cid) => { deletes.push(cid); return { ok: true }; };
  let loadRows = {};
  V.cloudVideoLoadAll = async () => clone(loadRows);
  const invokes = [];
  V.sbClient = () => ({
    functions: {
      invoke: async (fn, { body }) => {
        invokes.push(clone(body));
        if (body.op === "submit") return { data: { requestId: "rq-1", statusUrl: "s", responseUrl: "r", status: "IN_QUEUE" } };
        if (body.op === "poll") return { data: { status: "COMPLETED", videoUrl: "https://v3.fal.media/files/out.mp4", seed: 1 } };
        return { data: {} };
      },
    },
  });
  vm.createContext(V);
  vm.runInContext(compile("app/videogen.jsx"), V, { filename: "app/videogen.jsx" });

  /* T2 — who made it, who may delete it */
  await V.vidCommit("clip-a", "https://v3.fal.media/files/a1.mp4", { hash: "h" }, undefined, { newTake: true });
  ok("T2 a new take carries the signed-in user's id", (V.vidGetMeta("clip-a") || {}).by === "u-collab");
  await V.vidCommit("clip-a", "https://v3.fal.media/files/a0.mp4", { hash: "h0", createdAt: 1 });
  ok("T2 a commit that isn't a new take (a restore) adds no `by`", (V.vidGetMeta("clip-a") || {}).by === undefined);
  ok("T2 vidTakeDeletable: own take on a shared film", V.vidTakeDeletable({ meta: { by: "u-collab" } }) === true);
  ok("T2 vidTakeDeletable: someone else's take on a shared film", V.vidTakeDeletable({ meta: { by: "u-owner" } }) === false);
  ok("T2 vidTakeDeletable: a take without `by` is the owner's", V.vidTakeDeletable({ meta: {} }) === false && V.vidTakeDeletable(null) === false);
  shared = false;
  ok("T2 vidTakeDeletable: the film's owner may delete any take", V.vidTakeDeletable({ meta: { by: "u-someone" } }) === true);
  shared = true;
  const before = JSON.stringify(V.vidGetTakes("clip-a").map(t => t.url));
  const commitsBefore = commits.length;
  const refused = await V.vidDeleteTake("clip-a", "https://v3.fal.media/files/a0.mp4");
  ok("T2 vidDeleteTake refuses another person's take with the plain sentence",
    refused && refused.refused === true && V.__toasts.some(t => t.m === "Only the person who made this take, or the film's owner, can delete it."));
  ok("T2 a refused delete changes nothing, locally or in the cloud", JSON.stringify(V.vidGetTakes("clip-a").map(t => t.url)) === before && commits.length === commitsBefore);
  const own = await V.vidDeleteTake("clip-a", "https://v3.fal.media/files/a1.mp4");
  ok("T2 deleting your own take works and tells the merge not to bring it back",
    own && !V.vidGetTakes("clip-a").some(t => t.url === "https://v3.fal.media/files/a1.mp4")
    && commits[commits.length - 1].opts && commits[commits.length - 1].opts.removed.includes("https://v3.fal.media/files/a1.mp4"));
  const cleared = await V.vidClear("clip-a");
  ok("T2 vidClear refuses a clip holding another person's take", cleared && cleared.refused === true && !deletes.includes("clip-a"));

  /* T1 device side — the device keeps the merged entry */
  commitImpl = async (pid, uid, cid, entry) => ({ ok: true, entry: { url: entry.url, meta: { ...(entry.meta || {}), takes: (entry.meta.takes || []).concat([{ url: "https://v3.fal.media/files/remote.mp4", meta: { by: "u-owner" }, savedAt: 1 }]) } } });
  await V.vidCommit("clip-m", "https://v3.fal.media/files/m1.mp4", {}, undefined, { newTake: true });
  commitImpl = null;
  ok("T1 the device keeps what the cloud now holds (a take someone else added)", V.vidGetTakes("clip-m").some(t => t.url === "https://v3.fal.media/files/remote.mp4"));

  /* T3 — a permission refusal */
  V.__toasts.length = 0;
  commitImpl = async () => { const e = new Error("new row violates row-level security policy for table \"turn_generations\""); e.code = "42501"; throw e; };
  await V.vidCommit("clip-r", "https://v3.fal.media/files/r1.mp4", {}, undefined, { newTake: true });
  const dirty = JSON.parse(V.localStorage.getItem("turn_vid_dirty") || "{}");
  ok("T3 a refused save says so plainly", V.__toasts.some(t => t.m === "This take couldn't be saved to the film — your access to it changed. The film's owner will still find it in the film."));
  ok("T3 …never promises a re-sync", !V.__toasts.some(t => /re-sync/.test(t.m)));
  ok("T3 …is not retried (no dirty mark) and the local copy stays", !(dirty.p1 || {})["clip-r"] && V.vidGetVideo("clip-r") === "https://v3.fal.media/files/r1.mp4");
  const n0 = commits.length;
  await V.vidCloudFlushDirty();
  ok("T3 a later flush doesn't push the refused clip again", commits.length === n0);
  commitImpl = async () => { throw new Error("TURN_TEAM: stage_editor role required"); };
  V.__toasts.length = 0;
  await V.vidCommit("clip-r2", "https://v3.fal.media/files/r2.mp4", {}, undefined, { newTake: true });
  ok("T3 a Team rule code counts as a refusal (not retried)", !((JSON.parse(V.localStorage.getItem("turn_vid_dirty") || "{}").p1) || {})["clip-r2"]);
  commitImpl = async () => { throw new Error("net down"); };
  V.__toasts.length = 0;
  await V.vidCommit("clip-n", "https://v3.fal.media/files/n1.mp4", {}, undefined, { newTake: true });
  ok("T3 an ordinary failure still marks dirty and retries", ((JSON.parse(V.localStorage.getItem("turn_vid_dirty") || "{}").p1) || {})["clip-n"] === "put");
  commitImpl = null;

  /* T4a — the submit names its clip + take */
  const ctx = V.vidTakeContext("clip-sc1-s1x", { model: "m", durationMs: 5000, prompt: "x".repeat(2000), by: "u-collab", createdAt: 7, screenplayReference: { big: "y".repeat(5000) }, vno: 3, note: "z".repeat(5000) });
  ok("T4 take context: clip id + small plain facts, prompt summarised, heavy fields left out",
    ctx.clipId === "clip-sc1-s1x" && ctx.take.by === "u-collab" && ctx.take.model === "m" && ctx.take.prompt.length === 300
    && !("screenplayReference" in ctx.take) && !("vno" in ctx.take) && !("note" in ctx.take) && JSON.stringify(ctx.take).length <= 4000);
  ok("T4 take context: a clip id of another shape sends nothing", V.vidTakeContext("clip-bad id!", {}) === null && V.vidTakeContext("beat-1", {}) === null);
  invokes.length = 0;
  await V.seedanceGenerate("clip-sub1", { frameUrl: "data:image/png;base64,QQ==", prompt: "go", pollMs: 5, maxPolls: 50 });
  const submit = invokes.find(b => b.op === "submit");
  ok("T4 the submit carries context.clipId and context.take beside the film",
    submit && submit.context && submit.context.projectId === "p1" && submit.context.clipId === "clip-sub1"
    && submit.context.take && submit.context.take.by === "u-collab" && JSON.stringify(submit.context.take).length <= 4000,
    JSON.stringify(submit && submit.context));
  const poll = invokes.find(b => b.op === "poll");
  ok("T4 other calls keep the plain film context", poll && JSON.stringify(poll.context) === JSON.stringify({ projectId: "p1" }));

  /* T4b — the owner collects renders that finished while away */
  const rpcCalls = [];
  let pendingRows = null;
  V.cloudFilmPendingTakes = async pid => { rpcCalls.push(["pending", pid]); return clone(pendingRows); };
  V.cloudMarkTakesCollected = async (pid, refs) => { rpcCalls.push(["collected", pid, refs]); return true; };
  pendingRows = [{ ref: "r1", clip_id: "clip-own", url: "https://v3.fal.media/files/p1.mp4", take_meta: { model: "m", by: "u-collab" }, settled_at: "x", actor: "u-collab" }];
  ok("T4 a collaborator never collects", (await V.vidCollectPendingTakes("p1")) === 0 && !rpcCalls.length);
  shared = false; scope = { projectId: "p1", uid: "u-owner", epoch: 1 };
  // the owner's clip: an approved current take
  await V.vidCommit("clip-own", "https://v3.fal.media/files/approved.mp4", { status: "approved" });
  loadRows = { "clip-own": { url: "https://v3.fal.media/files/approved.mp4", meta: { status: "approved", takes: [{ url: "https://v3.fal.media/files/already.mp4", meta: {} }] } } };
  pendingRows = [
    { ref: "r1", clip_id: "clip-own", url: "https://v3.fal.media/files/p1.mp4", take_meta: { model: "m", by: "u-collab", vno: 9 }, settled_at: "2026-10-09", actor: "u-collab" },
    { ref: "r2", clip_id: "clip-own", url: "https://v3.fal.media/files/already.mp4", take_meta: {}, actor: "u-collab" },
    { ref: "r3", clip_id: "clip-own", url: "https://evil.example/x.mp4", take_meta: {}, actor: "u-collab" },
    { ref: "r4", clip_id: "../etc", url: "https://v3.fal.media/files/p4.mp4", take_meta: {}, actor: "u-collab" },
    { ref: "r5", clip_id: "clip-unloaded", url: "https://v3.fal.media/files/p5.mp4", take_meta: { model: "m" }, actor: "u-collab" },
  ];
  loadRows["clip-unloaded"] = { url: "https://v3.fal.media/files/u-approved.mp4", meta: { status: "approved" } };
  const added = await V.vidCollectPendingTakes("p1");
  ok("T4 collect: the count of takes added", added === 2, String(added));
  ok("T4 collect: a collected take never replaces the approved current take",
    V.vidGetVideo("clip-own") === "https://v3.fal.media/files/approved.mp4" && V.vidGetTakes("clip-own").some(t => t.url === "https://v3.fal.media/files/p1.mp4"));
  const p1meta = (V.vidGetTakes("clip-own").find(t => t.url === "https://v3.fal.media/files/p1.mp4") || {}).meta || {};
  ok("T4 collect: the maker's `by` is kept and the number is given here", p1meta.by === "u-collab" && p1meta.recovered === true && p1meta.vno !== 9);
  ok("T4 collect: a clip this device hadn't loaded keeps its cloud current",
    V.vidGetVideo("clip-unloaded") === "https://v3.fal.media/files/u-approved.mp4" && V.vidGetTakes("clip-unloaded").some(t => t.url === "https://v3.fal.media/files/p5.mp4"));
  const marked = rpcCalls.find(c => c[0] === "collected");
  ok("T4 collect: added and already-present takes are marked collected; untrusted / malformed ones aren't",
    marked && JSON.stringify(marked[2].slice().sort()) === JSON.stringify(["r1", "r2", "r5"]), JSON.stringify(marked));
  V.cloudFilmPendingTakes = async () => null;
  ok("T4 collect: a missing RPC is a no-op", (await V.vidCollectPendingTakes("p1")) === 0);
  ok("T4 collect: another film is a no-op", (await V.vidCollectPendingTakes("p2")) === 0);

  /* T7 — only provider urls play */
  const T = V.vidTakeUrlTrusted;
  ok("T7 fal.media and its subdomains (https) are trusted", T("https://fal.media/files/x.mp4") && T("https://v3.fal.media/files/x.mp4"));
  ok("T7 this project's Storage is trusted (https, /storage/v1/object/)", T("https://sb.test/storage/v1/object/sign/turn-assets/u/p/x.mp4?token=1"));
  ok("T7 data: and this page's blob: are trusted", T("data:video/mp4;base64,AA==") && T("blob:https://app.test/123"));
  ok("T7 everything else is not",
    !T("http://v3.fal.media/x.mp4") && !T("https://fal.media.evil.example/x.mp4") && !T("https://evil.example/fal.media/x.mp4")
    && !T("https://fal.media@evil.example/x.mp4") && !T("https://sb.test/rest/v1/x") && !T("blob:https://evil.example/1") && !T("javascript:alert(1)") && !T(""));
  loadRows = { "clip-good": { url: "https://v3.fal.media/files/g.mp4", meta: null }, "clip-plant": { url: "https://evil.example/track.mp4", meta: { takes: [{ url: "https://v3.fal.media/files/good.mp4", meta: {} }, { url: "https://evil.example/2.mp4", meta: {} }] } } };
  await V.vidCloudHydrate();
  const planted = V.vidGetTakes("clip-plant");
  ok("T7 a planted current url never plays", V.vidGetVideo("clip-plant") === "" && (await V.vidLoadVideo("clip-plant")) === "");
  ok("T7 planted takes are listed as unavailable (url empty, rawUrl kept for the owner's delete)",
    planted.length === 3 && planted[0].unavailable === true && planted[0].url === "" && planted[0].rawUrl === "https://evil.example/track.mp4"
    && planted[2].unavailable === true && planted[1].url === "https://v3.fal.media/files/good.mp4" && !planted[1].unavailable);
  ok("T7 a provider url from the film still plays", V.vidGetVideo("clip-good") === "https://v3.fal.media/files/g.mp4");
  await V.vidCommit("clip-local", "http://cdn/x.mp4", {});
  ok("T7 …even on a host outside the list (it came from this device's render)", V.vidGetVideo("clip-local") === "http://cdn/x.mp4");

  /* ════════ T5 — voiced lines (cloud.jsx): one row per voicing, each in its voicer's own folder ════════ */
  {
    const { C, S } = cloudSandbox();
    const mp3 = "data:audio/mpeg;base64," + Buffer.from("ID3-line-audio-bytes").toString("base64");
    const meta = { durationMs: 1200, voiceId: "v1", text: "Hello", hash: "h1", projectId: "p1", renderedAt: "2026-10-09T10:00:00.000Z" };
    const ID_RE = /^aud-[A-Za-z0-9_:.-]{1,120}$/;
    ok("T5 a line's base id maps to aud-<id>", C.cloudAudioEntityId("shot-1:line.2") === "aud-shot-1:line.2");
    const v1 = C.cloudAudioEntityId("shot-1", "u1", "h1"), v2 = C.cloudAudioEntityId("shot-1", "u2", "h1"), v3 = C.cloudAudioEntityId("shot-1", "u1", "h2");
    ok("T5 a voicing id is per person + render, inside the allowed set", ID_RE.test(v1) && v1.indexOf("aud-shot-1-") === 0 && v1 !== v2 && v1 !== v3 && v1 === C.cloudAudioEntityId("shot-1", "u1", "h1"));
    const odd = C.cloudAudioEntityId("x".repeat(130), "u1", "h"), odd2 = C.cloudAudioEntityId("a b/c");
    ok("T5 long or unusual line ids are hashed into the allowed set", ID_RE.test(odd) && odd.length < 50 && ID_RE.test(odd2) && odd2 !== C.cloudAudioEntityId("a b/d"));
    const rowOf = id => S.rows.find(r => r.entity_id === id);
    const r1 = await C.cloudCommitAudio("shot-1", mp3, meta, { projectId: "p1", uid: "u1" });
    const row = rowOf(v1);
    ok("T5 the bytes go to <uid>/<projectId>/stage-audio/ as the signed-in user", /^u1\/p1\/stage-audio\/[a-z0-9]+-[a-z0-9]+\.mp3$/.test(S.uploads[0]), S.uploads[0]);
    ok("T5 the row: storage_path, meta {kind, updatedAt, audio:{meta + lineId}}, no refs/history",
      row && row.storage_path === S.uploads[0] && row.meta.kind === "audio" && row.meta.audio.meta.hash === "h1" && row.meta.audio.meta.by === "u1"
      && row.meta.audio.meta.lineId === "shot-1" && typeof row.meta.updatedAt === "number" && !row.refs.length && !row.history.length && !row.meta.cleanupPending);
    ok("T5 cloudCommitAudio returns a signed url, the path and the row id", r1.url && r1.path === S.uploads[0] && r1.entityId === v1 && /^[0-9a-f]{64}$/.test(r1.meta.sha256));
    const r1b = await C.cloudCommitAudio("shot-1", mp3, meta, { projectId: "p1", uid: "u1" });
    ok("T5 the same person voicing the same render replaces their own file (cleanupPending, then removed)",
      S.removed.includes(r1.path) && rowOf(v1).storage_path === r1b.path && !rowOf(v1).meta.cleanupPending);
    // another person voices the line: a row of their own; the first person's row is untouched
    S.removed.length = 0; S.mutations.length = 0;
    const r2 = await C.cloudCommitAudio("shot-1", mp3, { ...meta, renderedAt: "2026-10-09T11:00:00.000Z" }, { projectId: "p1", uid: "u2" });
    ok("T5 another person's voicing is its own row; nobody else's row or file is touched",
      rowOf(v2) && rowOf(v2).storage_path === r2.path && rowOf(v1).storage_path === r1b.path && !S.removed.length
      && S.mutations.every(m => m.kind === "insert" || m.filters.some(f => f[0] === "entity_id" && f[2] === v2)));
    // the same person re-voices with a new render: their older voicing of the line goes
    const r3 = await C.cloudCommitAudio("shot-1", mp3, { ...meta, hash: "h2" }, { projectId: "p1", uid: "u1" });
    ok("T5 a new render replaces the person's own older voicing of the line (row and file), not anyone else's",
      rowOf(v3) && !rowOf(v1) && S.removed.includes(r1b.path) && rowOf(v2) && !S.removed.includes(r2.path));
    let wrong = null;
    try { await C.cloudCommitAudio("shot-9", mp3, { ...meta, projectId: "p2" }, { projectId: "p1", uid: "u1" }); } catch (e) { wrong = e; }
    ok("T5 a line of another film is refused", !!wrong);
    // load all: one query, foreign paths ignored
    S.rows.push({ project_id: "p1", owner: "u9", entity_id: "aud-planted", storage_path: "u9/OTHER/stage-audio/x.mp3", meta: { kind: "audio", audio: { meta: {} } }, refs: [], history: [] });
    const idx = await C.cloudAudioLoadAll("p1");
    ok("T5 cloudAudioLoadAll: every voicing of the film, nothing outside its stage-audio folders",
      idx[v2] && idx[v3] && idx[v3].meta.hash === "h2" && !idx["aud-planted"]);
    const blob = await C.cloudAudioDownload("p1", idx[v3]);
    ok("T5 cloudAudioDownload returns the verified bytes", blob && blob.size === Buffer.from("ID3-line-audio-bytes").length && /^audio\//.test(blob.type));
    S.files.set(idx[v3].path, new Blob(["ID3-line-audio-bytez"], { type: "audio/mpeg" }));
    ok("T5 bytes that don't match the recorded SHA-256 are refused", (await C.cloudAudioDownload("p1", idx[v3])) === null);
    ok("T5 a record outside the film is never fetched", (await C.cloudAudioDownload("p1", { path: "u9/OTHER/stage-audio/x.mp3", meta: {} })) === null);
    const refusedDel = await C.cloudDeleteAudio("p1", v2, "u1");
    ok("T5 cloudDeleteAudio never touches another person's voicing", !refusedDel.ok && rowOf(v2) && !S.removed.includes(r2.path));
    const path = rowOf(v3).storage_path;
    const del = await C.cloudDeleteAudio("p1", v3, "u1");
    ok("T5 cloudDeleteAudio removes your own voicing row and its file", del.ok && !rowOf(v3) && S.removed.includes(path));
    let refusedCode = C.cloudPermissionRefused({ message: "TURN_TEAM:stage_slot: TURN_ROLE_SCOPE: not your take" });
    ok("T3 the database's Team codes (stage_slot, cleanup_path, take_owner) count as refusals",
      refusedCode && C.cloudPermissionRefused({ message: "TURN_TEAM:take_owner: TURN_ROLE_SCOPE: x" }) && C.cloudPermissionRefused({ message: "TURN_ROLE_SCOPE: x" })
      && !C.cloudPermissionRefused({ message: "network down" }));

    /* ════════ T6 — cleanup stays inside this film ════════ */
    const uuidP = "d4432e3f-3682-40e6-bff4-0c218dae6d1e";
    S.removed.length = 0;
    S.rows.push({ project_id: uuidP, owner: "u1", entity_id: "asset-1", storage_path: null, refs: [], history: [], updated_at: "x1",
      meta: { cleanupPending: ["u2/" + uuidP + "/shot/a.png", "admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--" + uuidP + "/shot/b.png",
        "u2/0c218dae-3682-40e6-bff4-d4432e3f6d1e/shot/c.png", "u2/stage-tmp/1-video.mp4", "_internal/video-snapshots/1.mp4", "../" + uuidP + "/x", "u2/" + uuidP] } });
    await C.cloudGetGen(uuidP, "asset-1");
    ok("T6 only keys in THIS film's folders are removed (legacy and readable project folders)",
      JSON.stringify(S.removed.slice().sort()) === JSON.stringify(["admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--" + uuidP + "/shot/b.png", "u2/" + uuidP + "/shot/a.png"].sort()), JSON.stringify(S.removed));
    const a1 = S.rows.find(r => r.entity_id === "asset-1");
    ok("T6 keys outside the film leave the ledger instead of being retried forever", a1 && !a1.meta.cleanupPending);
    ok("T6 cloudPathInFilm", C.cloudPathInFilm("u/p1/x/y", "p1") && !C.cloudPathInFilm("u/p2/x/y", "p1") && !C.cloudPathInFilm("p1/x", "p1") && !C.cloudPathInFilm("u//p1/x", "p1"));
    S.removed.length = 0;
    S.rows.push({ project_id: "p1", owner: "u2", entity_id: "clip-evil", storage_path: null, refs: [], history: [], updated_at: "x2",
      meta: { kind: "video", video: { url: "https://v3.fal.media/x.mp4" }, cleanupPending: ["u1/p1/character/c/hero.png"] } });
    const mutationsBefore = S.mutations.length;
    await C.cloudAssetLoadAll("p1");
    ok("T6 the owner's prewarm never acts on a clip row's cleanup marker", !S.removed.length && S.mutations.length === mutationsBefore && S.rows.some(r => r.entity_id === "clip-evil"));
  }

  /* ════════ T5 — voicegen: load once per film, the voicing matching the line's hash, commit, clear ════════ */
  {
    const A = baseSandbox();
    let sc = { projectId: "p1", uid: "u-collab", epoch: 1 };
    A.nbCloudScope = () => sc;
    A.nbBackend = () => "cloud";
    A.__turnCurrentProjectId = "p1";
    const bytes = "data:audio/mpeg;base64," + Buffer.from("LINE").toString("base64");
    let loads = 0; const downloaded = [];
    const cloudIdx = {
      "aud-shot-1-o1": { path: "u-owner/p1/stage-audio/a.mp3", meta: { lineId: "shot-1", hash: "h1", voiceId: "v1", text: "Hi", projectId: "p1", renderedAt: "2026-10-09T10:00:00Z" }, owner: "u-owner" },
      "aud-shot-1-c1": { path: "u-collab/p1/stage-audio/a2.mp3", meta: { lineId: "shot-1", hash: "h1b", projectId: "p1", renderedAt: "2026-10-09T12:00:00Z" }, owner: "u-collab" },
      "aud-shot-2-o1": { path: "u-owner/p1/stage-audio/b.mp3", meta: { lineId: "shot-2", hash: "h2", projectId: "p1" }, owner: "u-owner" },
      "aud-shot-x-o1": { path: "u-owner/p1/stage-audio/x.mp3", meta: { lineId: "shot-x", hash: "hx", projectId: "p2" }, owner: "u-owner" },
      "aud-mine-c1": { path: "u-collab/p1/stage-audio/m.mp3", meta: { lineId: "mine", hash: "hm", projectId: "p1", by: "u-collab" }, owner: "u-collab" },
    };
    A.cloudAudioEntityId = id => "aud-" + id;
    A.cloudAudioLoadAll = async pid => { loads++; return clone(cloudIdx); };
    A.cloudAudioDownload = async (pid, rec) => { downloaded.push(rec.path); return new Blob([Buffer.from("LINE")], { type: "audio/mpeg" }); };
    const audioCommits = []; let audioCommitImpl = null;
    A.cloudCommitAudio = async (id, dataUrl, meta, scope) => { audioCommits.push({ id, scope: clone(scope) }); return audioCommitImpl ? audioCommitImpl() : { url: "https://sb.test/signed", path: "u-collab/p1/stage-audio/new.mp3", entityId: "aud-shot-9-c1", meta: { ...meta, lineId: id, by: "u-collab" } }; };
    const audioDeletes = [];
    A.cloudDeleteAudio = async (pid, key, uid) => { audioDeletes.push([key, uid]); return { ok: true }; };
    vm.createContext(A);
    vm.runInContext(compile("app/voicegen.jsx"), A, { filename: "app/voicegen.jsx" });
    const u1 = await A.vgLoadAudio("shot-1", undefined, { hash: "h1" });
    ok("T5 a line whose bytes aren't on this device is fetched from the film", u1 === bytes, u1);
    ok("T5 the voicing whose hash matches the line's render record is used, other voicings ignored",
      downloaded[0] === "u-owner/p1/stage-audio/a.mp3" && (A.vgGetMeta("shot-1") || {}).hash === "h1");
    const u2 = await A.vgLoadAudio("shot-2");
    ok("T5 without a hash, the newest voicing of the line", u2 === bytes && downloaded[1] === "u-owner/p1/stage-audio/b.mp3");
    ok("T5 the film's audio rows load ONCE per film open", loads === 1 && downloaded.length === 2);
    ok("T5 the fetched line carries its stored meta (vgLineAudioStatus checks it)", (A.vgGetMeta("shot-1") || {}).cloudPath === "u-owner/p1/stage-audio/a.mp3");
    ok("T5 a voicing whose hash nobody has is not fetched", (await A.vgLoadAudio("shot-2", undefined, { hash: "nope" })) === bytes && downloaded.length === 2);
    ok("T5 a stored line of another film is never used", (await A.vgLoadAudio("shot-x")) === "");
    ok("T5 the lineage check still sees the stored meta",
      A.vgLineAudioStatus({ durationMs: 1000, text: "Hi", voiceId: "v1", hash: "h-other" }, { voiceId: "v1" }, "Hi", u1, "p1", A.vgGetMeta("shot-1")).state === "stale-bytes");
    await A.vgLoadAudio("shot-1", undefined, { hash: "h1" });
    ok("T5 a line already in memory is not fetched again", downloaded.length === 2);
    await A.vgLoadAudio("shot-1", undefined, { hash: "h1b" });
    ok("T5 a different render of the line in memory fetches the matching voicing", downloaded[2] === "u-collab/p1/stage-audio/a2.mp3" && (A.vgGetMeta("shot-1") || {}).hash === "h1b");
    A.vgResetAll();
    await A.vgLoadAudio("shot-2");
    ok("T5 a new film open reloads the film's rows", loads === 2);

    await A.elCommit("shot-9", bytes, { hash: "h9", projectId: "p1" });
    ok("T5 elCommit saves the line to the film as the signed-in user", audioCommits.length === 1 && audioCommits[0].id === "shot-9" && audioCommits[0].scope.uid === "u-collab");
    ok("T5 the device keeps the data URL (a signed link would expire) and the film's path", A.vgGetAudio("shot-9") === bytes && (A.vgGetMeta("shot-9") || {}).cloudPath === "u-collab/p1/stage-audio/new.mp3");
    A.__toasts.length = 0;
    audioCommitImpl = () => { const e = new Error("TURN_TEAM:stage_slot: TURN_ROLE_SCOPE: not yours"); throw e; };
    await A.elCommit("shot-10", bytes, { hash: "h10", projectId: "p1" });
    ok("T5 a refused save is told plainly and not queued for a retry",
      A.__toasts.some(t => /your access to it changed/.test(t.m)) && !(JSON.parse(A.localStorage.getItem("turn_vg_unsynced") || "{}").p1 || []).includes("shot-10"));
    audioCommitImpl = () => { throw new Error("net down"); };
    A.__toasts.length = 0;
    await A.elCommit("shot-11", bytes, { hash: "h11", projectId: "p1" });
    ok("T5 a network failure is queued to be saved again when the film reopens", (JSON.parse(A.localStorage.getItem("turn_vg_unsynced") || "{}").p1 || []).includes("shot-11"));
    audioCommitImpl = null;

    await A.vgClearAudio("shot-1");
    ok("T5 clearing a line removes only this person's own voicings of it (their folder)",
      JSON.stringify(audioDeletes) === JSON.stringify([["aud-shot-1-c1", "u-collab"]]), JSON.stringify(audioDeletes));
    sc = { projectId: "p1", uid: "u-owner", epoch: 1 };
    audioDeletes.length = 0;
    await A.vgClearAudio("mine");
    ok("T5 not even the film's owner removes another person's voicing", !audioDeletes.length);
    await A.vgClearAudio("shot-2");
    ok("T5 the owner's clear removes the owner's own voicing", JSON.stringify(audioDeletes) === JSON.stringify([["aud-shot-2-o1", "u-owner"]]));
  }

  /* ════════ source pins: the wiring the behaviour above relies on ════════ */
  const vsrc = readFileSync("app/videogen.jsx", "utf8"), vgsrc = readFileSync("app/voicegen.jsx", "utf8");
  ok("pin: the submit is wrapped with its take context", vsrc.includes('sub = await vidProxy("submit", _vidWithTakeContext(takeContext, isKlingMotion'));
  ok("pin: elCommit no longer swaps the data URL for a signed link", !vgsrc.includes("_vgMem.set(memKey,{url:r.url"));
})();

console.log((failures ? "RESULT: FAIL — " : "RESULT: OK — ") + passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/* ============================================================================
   HEADLESS VIDEO CLOUD-SYNC TESTS — videogen.jsx money-path + persistence
   (plus the pure Timeline export playlist and the cloud spend queue).
   Runs against the MINIFIED dist build in a stubbed vm sandbox:

   - vidCommit: local mode (no cloud calls), cloud push shape, take roll
   - push failure → dirty ledger + honest toast → vidCloudFlushDirty repush
   - vidCloudHydrate: cloud wins EXCEPT locally-dirty clips; vid-done event
   - vidClear: run-token bump + pending removal + cloud delete
   - seedanceGenerate races: Clear mid-render → discarded (no commit, no
     resurrection); film switch mid-render → stale (job stays pending)
   - vidRecoverPending: project-scoped, COMPLETED saves, FAILED reported,
     a job older than 7 days polled once and then dropped (billing round 2),
     other-film jobs untouched
   - stageExportPlaylist (stage.jsx): rendered-only, story order
   - cloudSpendCreditReliable / cloudFlushSpendQueue (cloud.jsx): failed RPC
     queues + toast, later flush drains

   Deterministic asserts only — any mismatch exits 1. Run AFTER `npm run build`:

     node scripts/test-videogen-cloudsync.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const makeSandbox = () => {
  const sb = {
    console, Date, Math, JSON, Promise,
    // short (poll) timers stay REF'D so the loop survives awaited waits; the
    // module-load timers (4s recovery pass, 6s spend flush) are unref'd so they
    // neither hold node open nor fire mid-test.
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms >= 1000 && t && t.unref) t.unref(); return t; },
    clearTimeout,
    setInterval: () => 0, clearInterval: noop,          // patrol timers must not hold node open
    React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: "node-test", onLine: true },
    location: { href: "", search: "", hash: "", origin: "" },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    Image: class {},
    document: {
      createElement: () => ({ getContext: () => null, style: {}, setAttribute: noop, appendChild: noop }),
      getElementById: () => null,
      addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
      body: { appendChild: noop, removeChild: noop },
    },
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  };
  sb.__events = []; sb.__toasts = [];
  sb.dispatchEvent = ev => { sb.__events.push(ev); return true; };
  sb.appToast = (m, k) => sb.__toasts.push({ m, k });
  sb.window = sb; sb.globalThis = sb;
  return sb;
};

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++;
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};
const tick = ms => new Promise(r => setTimeout(r, ms));   // REF'D — keeps node alive across awaits
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await tick(5); } return true; };

/* ════════ videogen sandbox ════════ */
const V = makeSandbox();
vm.createContext(V);

// controllable cloud stubs (videogen reaches them via window.*)
let scope = null;                     // what nbCloudScope() reports
let epoch = 1;
V.nbCloudScope = () => scope;
V.nbEpoch = () => epoch;
const cloudCalls = [];
let commitFail = false;
let loadRows = null;
V.cloudCommitVideo = async (pid, uid, cid, entry) => {
  if (commitFail) throw new Error("net down");
  cloudCalls.push(["commit", pid, uid, cid, entry]); return { ok: true };
};
V.cloudVideoDelete = async (pid, cid) => { cloudCalls.push(["del", pid, cid]); return { ok: true }; };
V.cloudVideoLoadAll = async pid => { cloudCalls.push(["load", pid]); return loadRows; };

// proxy stubs for seedanceGenerate / vidRecoverPending
let released = false, polls = 0, subN = 0;
const pollResponses = {};             // statusUrl → fixed poll payload
V.TURN_SUPABASE = { url: "u", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy" };
V.sbClient = () => ({
  functions: {
    invoke: async (fn, { body }) => {
      if (body.op === "submit") return { data: { requestId: "rq-" + (++subN), statusUrl: "s-live", responseUrl: "r", status: "IN_QUEUE" } };
      if (body.op === "poll") {
        if (pollResponses[body.statusUrl]) return { data: pollResponses[body.statusUrl] };
        polls++;
        return released ? { data: { status: "COMPLETED", videoUrl: "http://cdn/x.mp4", seed: 7 } } : { data: { status: "IN_PROGRESS" } };
      }
      return { data: {} };
    },
  },
});

vm.runInContext(readFileSync("dist/app/videogen.js", "utf8"), V, { filename: "dist/app/videogen.js" });
for (const fn of ["vidCommit", "vidClear", "vidCloudHydrate", "vidCloudFlushDirty", "vidRecoverPending", "vidPendingList", "vidRunToken", "vidRunBump", "seedanceGenerate", "vidGetVideo", "vidGetTakes"])
  if (typeof V[fn] !== "function") { console.log("FAIL window." + fn + " missing from dist build"); process.exit(1); }

const dirtyLedger = () => { try { return JSON.parse(V.localStorage.getItem("turn_vid_dirty") || "{}"); } catch (e) { return {}; } };
const toastsWith = re => V.__toasts.filter(t => re.test(t.m));

await (async () => {
  /* ---- 1. local mode: commit works, cloud untouched ---- */
  scope = null;
  await V.vidCommit("clip-local", "http://cdn/l1.mp4", { hash: "hl" });
  ok("local: url committed", V.vidGetVideo("clip-local") === "http://cdn/l1.mp4");
  ok("local: no cloud calls", cloudCalls.length === 0, JSON.stringify(cloudCalls));

  /* ---- 2. cloud push on commit + take roll ---- */
  scope = { projectId: "p1", uid: "u1", epoch: 1 };
  await V.vidCommit("clip-x", "http://cdn/x1.mp4", { hash: "h1" });
  const c1 = cloudCalls.find(c => c[0] === "commit" && c[3] === "clip-x");
  ok("cloud: commit pushed", !!c1, JSON.stringify(cloudCalls));
  ok("cloud: push shape (projectId, uid, entry.url)", c1 && c1[1] === "p1" && c1[2] === "u1" && c1[4] && c1[4].url === "http://cdn/x1.mp4", JSON.stringify(c1));
  await V.vidCommit("clip-x", "http://cdn/x2.mp4", { hash: "h2" });
  const takes = V.vidGetTakes("clip-x");
  ok("cloud: take rolled (2 takes, new one current)", takes.length === 2 && takes[0].current && takes[0].url === "http://cdn/x2.mp4", JSON.stringify(takes.map(t => t.url)));
  const c2 = cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-x");
  ok("cloud: second push carries rolled meta", c2.length === 2 && c2[1][4].meta && Array.isArray(c2[1][4].meta.takes) && c2[1][4].meta.takes.length === 1, JSON.stringify(c2[1] && c2[1][4] && c2[1][4].meta && c2[1][4].meta.takes));

  /* ---- 3. push failure → dirty + honest toast → flush repushes ---- */
  commitFail = true;
  await V.vidCommit("clip-dirty", "http://local/v.mp4", { hash: "hd" });
  ok("dirty: committed locally despite cloud failure", V.vidGetVideo("clip-dirty") === "http://local/v.mp4");
  ok("dirty: marked in ledger", (dirtyLedger().p1 || {})["clip-dirty"] === "put", JSON.stringify(dirtyLedger()));
  ok("dirty: user told (no silent catch)", toastsWith(/Couldn't save this clip's takes/).length === 1, JSON.stringify(V.__toasts));

  /* ---- 4. hydrate: cloud wins EXCEPT dirty; vid-done announced ---- */
  loadRows = { "clip-a": { url: "http://cdn/a.mp4", meta: null }, "clip-dirty": { url: "http://cdn/STALE.mp4", meta: null } };
  const n = await V.vidCloudHydrate();
  ok("hydrate: cloud row landed", V.vidGetVideo("clip-a") === "http://cdn/a.mp4");
  ok("hydrate: dirty clip NOT clobbered by stale cloud row", V.vidGetVideo("clip-dirty") === "http://local/v.mp4");
  ok("hydrate: count + vid-done event", n === 1 && V.__events.some(e => e.type === "vid-done" && e.detail && (e.detail.ids || []).includes("clip-a")), "n=" + n);

  /* ---- 5. flush after reconnect pushes the dirty clip up ---- */
  commitFail = false;
  await V.vidCloudFlushDirty();
  const cd = cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-dirty");
  ok("flush: dirty clip pushed with LOCAL url", cd.length === 1 && cd[0][4].url === "http://local/v.mp4", JSON.stringify(cd));
  ok("flush: ledger cleared", !((dirtyLedger().p1 || {})["clip-dirty"]), JSON.stringify(dirtyLedger()));

  /* ---- 6. vidClear: token bump + pending removal + cloud delete ---- */
  V.localStorage.setItem("turn_vid_pending", JSON.stringify([{ requestId: "rq-z", id: "clip-x", model: "m", statusUrl: "s-z", responseUrl: "r", at: Date.now(), projectId: "p1", uid: "u1", meta: {} }]));
  await V.vidClear("clip-x");
  ok("clear: video gone", V.vidGetVideo("clip-x") === "");
  ok("clear: run token bumped", V.vidRunToken("clip-x") === 1);
  ok("clear: cloud delete pushed", cloudCalls.some(c => c[0] === "del" && c[1] === "p1" && c[2] === "clip-x"), JSON.stringify(cloudCalls.filter(c => c[0] === "del")));
  ok("clear: pending job for the clip dropped", V.vidPendingList().every(j => j.id !== "clip-x"), JSON.stringify(V.vidPendingList()));

  /* ---- 7. RACE: Clear mid-render → discarded, never resurrected ---- */
  released = false; polls = 0;
  const commitsBefore = cloudCalls.filter(c => c[0] === "commit").length;
  const pRace = V.seedanceGenerate("clip-race", { frameUrl: "http://img/1.png", prompt: "go", pollMs: 5, maxPolls: 400 });
  ok("race: poll started", await until(() => polls > 0));
  await V.vidClear("clip-race");            // user clears while the render cooks
  released = true;
  const r = await pRace;
  ok("race: result flagged discarded", r && r.discarded === true, JSON.stringify(r));
  ok("race: clip stays cleared (no resurrection)", V.vidGetVideo("clip-race") === "");
  ok("race: nothing committed to cloud", cloudCalls.filter(c => c[0] === "commit").length === commitsBefore + 0 + (cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-race").length ? 1 : 0) && !cloudCalls.some(c => c[0] === "commit" && c[3] === "clip-race"));
  ok("race: no pending leftover", V.vidPendingList().every(j => j.id !== "clip-race"), JSON.stringify(V.vidPendingList()));
  ok("race: discard disclosed", toastsWith(/finished after you cleared/).length === 1, JSON.stringify(V.__toasts.slice(-3)));

  /* ---- 8. RACE: film switch mid-render → stale, job stays pending ---- */
  released = false; polls = 0;
  const pEpoch = V.seedanceGenerate("clip-epoch", { frameUrl: "http://img/2.png", prompt: "go", pollMs: 5, maxPolls: 400 });
  ok("stale: poll started", await until(() => polls > 0));
  epoch = 2;                                // film switched
  released = true;
  const r2 = await pEpoch;
  ok("stale: result flagged stale", r2 && r2.stale === true, JSON.stringify(r2));
  ok("stale: nothing committed", !cloudCalls.some(c => c[0] === "commit" && c[3] === "clip-epoch"));
  ok("stale: job kept pending for its own film", V.vidPendingList().some(j => j.id === "clip-epoch" && j.projectId === "p1"), JSON.stringify(V.vidPendingList()));
  epoch = 1;

  /* ---- 9. recovery: project-scoped, honest outcomes ---- */
  pollResponses["s-ok"] = { status: "COMPLETED", videoUrl: "http://cdn/rec.mp4", seed: 3 };
  pollResponses["s-fail"] = { status: "FAILED", error: "boom" };
  pollResponses["s-still"] = { status: "IN_PROGRESS" };
  V.__toasts.length = 0;
  V.localStorage.setItem("turn_vid_pending", JSON.stringify([
    { requestId: "ra", id: "clip-reca", model: "m", statusUrl: "s-ok", responseUrl: "r", at: Date.now(), projectId: "p1", uid: "u1", meta: { hash: "h" } },
    { requestId: "rb", id: "clip-otherfilm", model: "m", statusUrl: "s-ok", responseUrl: "r", at: Date.now(), projectId: "p2", uid: "u1", meta: {} },
    // over a week old and still unfinished: polled once more, then dropped (a day-old job is kept now)
    { requestId: "rc", id: "clip-old", model: "m", statusUrl: "s-still", responseUrl: "r", at: Date.now() - 8 * 24 * 3600 * 1000, projectId: "p1", uid: "u1", meta: {} },
    { requestId: "rd", id: "clip-recfail", model: "m", statusUrl: "s-fail", responseUrl: "r", at: Date.now(), projectId: "p1", uid: "u1", meta: {} },
  ]));
  const saved = await V.vidRecoverPending();
  ok("recover: finished render saved as a take", saved === 1 && V.vidGetVideo("clip-reca") === "http://cdn/rec.mp4", "saved=" + saved);
  ok("recover: saved take pushed to cloud", cloudCalls.some(c => c[0] === "commit" && c[3] === "clip-reca"));
  const left = V.vidPendingList();
  ok("recover: other film's job untouched", left.length === 1 && left[0].requestId === "rb", JSON.stringify(left));
  ok("recover: outcomes disclosed (saved/failed/expired)",
    toastsWith(/Recovered a finished render/).length === 1 && toastsWith(/failed at the provider/).length === 1 && toastsWith(/from over a week ago still couldn’t be collected/).length === 1,
    JSON.stringify(V.__toasts));

  /* ---- 10. take MANAGEMENT writes reach the cloud too (review fix) ---- */
  await V.vidCommit("clip-app", "http://cdn/ap1.mp4", { hash: "a1" });
  await V.vidCommit("clip-app", "http://cdn/ap2.mp4", { hash: "a2" });
  const pushesBeforeApprove = cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-app").length;
  await V.vidApproveTake("clip-app", "http://cdn/ap1.mp4", true);   // star the ARCHIVED take
  const apPush = cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-app");
  ok("takes: approval pushed to cloud", apPush.length === pushesBeforeApprove + 1, "pushes=" + apPush.length);
  const apEntry = apPush[apPush.length - 1][4];
  ok("takes: pushed entry carries the approval", apEntry.meta && (apEntry.meta.takes || []).some(t => t && t.meta && t.meta.status === "approved"), JSON.stringify(apEntry.meta && apEntry.meta.takes));
  // a queued take action racing a film switch is DROPPED, never cross-written
  const scopeSave = scope;
  const pGuard = V.vidApproveTake("clip-app", "http://cdn/ap2.mp4", true);   // captured under the old film
  scope = { projectId: "p2", uid: "u1", epoch: 2 };                          // film switches before the queue runs it
  const rGuard = await pGuard;
  scope = scopeSave;
  ok("takes: queued approval dropped after film switch", rGuard === null && cloudCalls.filter(c => c[0] === "commit" && c[3] === "clip-app").length === apPush.length, JSON.stringify(rGuard));

  /* ---- 11. queued commit refused after film switch (review fix) ---- */
  const skip1 = await V.vidCommit("clip-skip", "http://cdn/s.mp4", { hash: "hs" }, { projectId: "pOTHER", uid: "u1", epoch: 1 });
  ok("scope-skip: other film's queued commit refused", skip1 && skip1.skipped === true && V.vidGetVideo("clip-skip") === "" && !cloudCalls.some(c => c[0] === "commit" && c[3] === "clip-skip"), JSON.stringify(skip1));
  const skip2 = await V.vidCommit("clip-skip", "http://cdn/s.mp4", { hash: "hs" }, { projectId: "p1", uid: "u1", epoch: 99 });
  ok("scope-skip: stale epoch refused even in the same film", skip2 && skip2.skipped === true && V.vidGetVideo("clip-skip") === "", JSON.stringify(skip2));

  /* ---- 12. hydrate reconciles REMOTE deletions, never other films' caches ---- */
  ok("reconcile precondition: clip-dirty is clean + local", V.vidGetVideo("clip-dirty") === "http://local/v.mp4");
  V.__events.length = 0;
  loadRows = { "clip-a": { url: "http://cdn/a.mp4", meta: null } };   // clip-dirty vanished remotely
  await V.vidCloudHydrate();
  ok("reconcile: remotely-deleted clip dropped locally", V.vidGetVideo("clip-dirty") === "");
  ok("reconcile: deletion announced", V.__events.some(e => e.type === "vid-done" && (e.detail.ids || []).includes("clip-dirty")), JSON.stringify(V.__events.map(e => e.detail && e.detail.ids)));
  ok("reconcile: local-mode film untouched", V.vidGetVideo("clip-local") === "http://cdn/l1.mp4");

  /* ---- 13. video is charged on the SERVER (billing fixes 2026-09-30): the browser records no spend ---- */
  const spendCalls = [];
  V.cloudSpendCreditReliable = async (cost, reason, uid, eventId) => { spendCalls.push({ cost, reason, uid, eventId }); return true; };
  released = true; polls = 0;
  const rSpend = await V.seedanceGenerate("clip-paid", { frameUrl: "http://img/3.png", prompt: "go", pollMs: 5, maxPolls: 400, quote: { cost: 4, reason: "stage-video-render" } });
  ok("server-billed: a completed render records no browser spend", rSpend && rSpend.videoUrl && spendCalls.length === 0, JSON.stringify(spendCalls));
  V.localStorage.setItem("turn_vid_pending", JSON.stringify([
    { requestId: "rs", id: "clip-recpaid", model: "m", statusUrl: "s-ok", responseUrl: "r", at: Date.now(), projectId: "p1", uid: "u1", meta: {}, spend: { cost: 2, reason: "stage-video-render", uid: "uA", id: "evt-rec-1" } },
  ]));
  await V.vidRecoverPending({ quiet: true });
  ok("server-billed: crash-recovery records no browser spend", spendCalls.length === 0, JSON.stringify(spendCalls));
  delete V.cloudSpendCreditReliable;
})();

/* ════════ stage: pure export playlist ════════ */
const S = makeSandbox();
vm.createContext(S);
vm.runInContext(readFileSync("dist/app/stage.js", "utf8"), S, { filename: "dist/app/stage.js" });
if (typeof S.stageExportPlaylist !== "function") { console.log("FAIL window.stageExportPlaylist missing from dist build"); process.exit(1); }
{
  const orderedClips = [{ id: "c1", label: "01A" }, { id: "c2", label: "01B" }, null, { id: "c3", label: "02A" }];
  const pl = S.stageExportPlaylist(orderedClips, { c1: "http://cdn/1.mp4", c3: "http://cdn/3.mp4" });
  ok("export playlist: rendered-only, story order", JSON.stringify(pl.map(p => p.id)) === JSON.stringify(["c1", "c3"]), JSON.stringify(pl));
  ok("export playlist: carries urls + labels", pl[0].url === "http://cdn/1.mp4" && pl[1].label === "02A", JSON.stringify(pl));
  ok("export playlist: empty inputs safe", S.stageExportPlaylist(null, null).length === 0 && S.stageExportPlaylist(orderedClips, {}).length === 0);
  ok("export film fn present", typeof S.stageExportFilm === "function");
}

/* ════════ cloud: spend queue ════════ */
const C = makeSandbox();
vm.createContext(C);
let rpcFail = true, rejectEventId = false; const rpcCalls = [];
C.__uid = "u1";                       // the signed-in account — switchable mid-test
C.TURN_SUPABASE = { url: "u", anonKey: "k" };
C._sbClient = {   // sbClient() returns window._sbClient directly — no supabase lib needed
  rpc: async (name, args) => {
    rpcCalls.push([name, args]);
    if (rejectEventId && args && args.event_id) return { data: null, error: { message: "Could not find the function public.turn_spend_credit(cost, event_id) in the schema cache" } };
    return rpcFail ? { data: null, error: { message: "down" } } : { data: [{ credits: 9 }], error: null };
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "n/a" } }) }) }) }),
  auth: {
    getSession: async () => ({ data: { session: C.__uid ? { user: { id: C.__uid } } : null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }),
  },
  functions: { invoke: async () => ({ data: {} }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: noop,
};
vm.runInContext(readFileSync("dist/app/cloud.js", "utf8"), C, { filename: "dist/app/cloud.js" });
if (typeof C.cloudSpendCreditReliable !== "function") { console.log("FAIL window.cloudSpendCreditReliable missing from dist build"); process.exit(1); }
await (async () => {
  const q = () => { try { return JSON.parse(C.localStorage.getItem("turn_spend_queue") || "[]"); } catch (e) { return []; } };
  const okFlag = await C.cloudSpendCreditReliable(3, "stage-video-render");
  ok("spend: failed RPC leaves the spend QUEUED", okFlag === false && q().length === 1 && q()[0].cost === 3, JSON.stringify(q()));
  ok("spend: queued entry tagged with the account", q()[0].uid === "u1", JSON.stringify(q()));
  ok("spend: failure disclosed", C.__toasts.some(t => /credit spend didn't go through/.test(t.m)), JSON.stringify(C.__toasts));
  // account switch: user B must never be debited user A's held spend
  C.__uid = "u2"; rpcFail = false;
  const rpcN = rpcCalls.length;
  await C.cloudFlushSpendQueue();
  ok("spend: another account's entry is HELD, not debited", q().length === 1 && rpcCalls.length === rpcN, JSON.stringify(q()));
  // signed out: nothing flushes at all
  C.__uid = null;
  await C.cloudFlushSpendQueue();
  ok("spend: signed out flushes nothing", q().length === 1 && rpcCalls.length === rpcN);
  // the right account returns → the spend drains
  C.__uid = "u1";
  const flushed = await C.cloudFlushSpendQueue();
  ok("spend: later flush drains the queue", flushed === true && q().length === 0, JSON.stringify(q()));
  ok("spend: RPC shape (turn_spend_credit, cost)", rpcCalls.length >= 2 && rpcCalls.every(c => c[0] === "turn_spend_credit") && rpcCalls[rpcCalls.length - 1][1].cost === 3, JSON.stringify(rpcCalls));
  ok("spend: replay carries a dedupe event id", typeof rpcCalls[rpcCalls.length - 1][1].event_id === "string" && rpcCalls[rpcCalls.length - 1][1].event_id.length > 0, JSON.stringify(rpcCalls[rpcCalls.length - 1]));

  // database WITHOUT the idempotency migration: PostgREST rejects the two-arg
  // signature — the client must degrade to the legacy call, not lose the spend
  rejectEventId = true;
  const okLegacy = await C.cloudSpendCreditReliable(1, "stage-video-extend");
  const lastTwo = rpcCalls.slice(-2);
  ok("spend: legacy-schema fallback still records", okLegacy === true && q().length === 0 && lastTwo.length === 2 && !!lastTwo[0][1].event_id && lastTwo[1][1].event_id === undefined, JSON.stringify(lastTwo));
  rejectEventId = false;

  // uid pinned at LAUNCH: whoever is signed in at completion never pays for it
  const okPinned = await C.cloudSpendCreditReliable(2, "stage-video-render", "uZ");
  ok("spend: launcher-pinned spend held under another session", okPinned === false && q().length === 1 && q()[0].uid === "uZ", JSON.stringify(q()));
  C.__uid = "uZ";
  await C.cloudFlushSpendQueue();
  ok("spend: held spend drains when the launcher signs back in", q().length === 0, JSON.stringify(q()));
  C.__uid = "u1";

  // same event id settled twice (live poll + recovery racing) → queued ONCE
  rpcFail = true;
  await C.cloudSpendCreditReliable(3, "stage-video-render", null, "evt-dup");
  await C.cloudSpendCreditReliable(3, "stage-video-render", null, "evt-dup");
  ok("spend: duplicate event id queued once", q().length === 1 && q()[0].id === "evt-dup", JSON.stringify(q()));
  rpcFail = false;
  await C.cloudFlushSpendQueue();
  ok("spend: dup entry drains as one charge", q().length === 0 && rpcCalls[rpcCalls.length - 1][1].event_id === "evt-dup", JSON.stringify(q()));

  // localStorage write failure (quota/privacy mode): the entry lives on in the
  // in-memory mirror and still charges once the connection returns
  rpcFail = true;
  const rpcN2 = rpcCalls.length;
  const realSet = C.localStorage.setItem.bind(C.localStorage);
  C.localStorage.setItem = (k, v) => { if (String(k) === "turn_spend_queue") throw new Error("quota"); return realSet(k, v); };
  await C.cloudSpendCreditReliable(5, "stage-video-render");
  C.localStorage.setItem = realSet;
  ok("spend: storage failure disclosed", C.__toasts.some(t => /Couldn't save the credit record queue/.test(t.m)), JSON.stringify(C.__toasts.slice(-3)));
  rpcFail = false;
  await C.cloudFlushSpendQueue();
  ok("spend: memory-mirrored spend still charges", rpcCalls.slice(rpcN2).some(c => c[1].cost === 5) && q().length === 0, JSON.stringify(rpcCalls.slice(rpcN2)));
})();

console.log((failures ? "RESULT: FAIL" : "RESULT: OK") + " — " + passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/* test-storage-folders-client.mjs — the app's readable storage folders (owner decision
   2026-09-27), run on the REAL app/cloud.jsx and app/storage-keys.js in a vm with a
   fake Supabase client (no network, no Supabase, no credentials):
   - turn_storage_folders answering → readable "{handle}--{uid}/{slug}--{pid}/…" keys;
   - PGRST202 (SQL not installed), 42501 (execute revoked), a network error, a timeout,
     a mismatched or malformed answer, a missing parser → legacy "{uid}/{pid}/…" keys;
   - the client kill switch (TURN_SUPABASE.readableStorageKeys === false);
   - the 5-minute cache (both answers), its expiry, and the invalidation on rename;
   - one save = one prefix across the sheet and its references (one RPC call), and one
     cameo = one prefix across its angles;
   - the one-shot legacy retry when the server refuses a readable key (reservation scope
     check, Storage row-level security), never on "Art Room write access is required",
     and never twice.
   Run: node scripts/test-storage-folders-client.mjs */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const U = "8d3e4f10-0000-4000-8000-000000000001";
const P = "5a7b1c22-0000-4000-8000-000000000002";
const OTHER = "0de1e7ed-0000-4000-8000-000000000005";
const ACCT = "alex-smith--" + U, PROJ = "pine-soot--" + P;
const png = "data:image/png;base64,QQ==";
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
let passed = 0, failed = 0;
const ok = (name, condition, detail) => {
  if (condition) { passed++; console.log("PASS " + name); }
  else { failed++; console.error("FAIL " + name + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
};

function harness(options = {}) {
  const state = { rows: new Map(), uploads: [], removed: [], rpcCalls: [], begins: [], clock: 0,
    folderMode: options.folderMode || "ok", warnings: [], release: [] };
  const key = (f) => (f.project_id || "") + "|" + (f.entity_id || f.char_id || "");
  class Query {
    constructor(table) { this.table = table; this.op = "read"; this.value = null; this.filters = {}; }
    select() { return this; }
    eq(k, v) { this.filters[k] = v; return this; }
    update(v) { this.op = "update"; this.value = v; return this; }
    insert(v) { this.op = "insert"; this.value = v; return this; }
    upsert(v) { this.op = "upsert"; this.value = v; return this; }
    delete() { this.op = "delete"; return this; }
    async _run() {
      if (this.table === "turn_projects") {
        if (this.op === "update") return { data: [{ id: this.filters.id }], error: null };
        return { data: null, error: null };
      }
      if (this.table === "turn_cameos") {
        if (this.op === "upsert") { state.cameo = clone(this.value); return { data: null, error: null }; }
        return { data: null, error: null };
      }
      const k = key(this.filters), row = state.rows.get(k) || null;
      if (this.op === "read") return { data: clone(row), error: null };
      if (this.op === "insert") {
        const r = clone(this.value), rk = key(r);
        if (state.rows.has(rk)) return { data: null, error: { code: "23505", status: 409, message: "duplicate key" } };
        state.rows.set(rk, r); return { data: clone(r), error: null };
      }
      if (!row) return { data: null, error: null };
      if (this.op === "update") { const next = { ...row, ...clone(this.value) }; state.rows.set(k, next); return { data: clone(next), error: null }; }
      if (this.op === "delete") { state.rows.delete(k); return { data: clone(row), error: null }; }
      return { data: null, error: null };
    }
    single() { return this._run(); }
    maybeSingle() { return this._run(); }
    then(resolve, reject) { return this._run().then(resolve, reject); }
  }
  const storage = {
    async upload(path, blob) {
      state.uploads.push(path);
      if (options.storageRefuses && options.storageRefuses(path))
        return { error: { statusCode: "403", status: 403, message: "new row violates row-level security policy" } };
      return { error: null };
    },
    async remove(paths) { state.removed.push(...paths); return { error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: "signed:" + path }, error: null }; },
  };
  const folderAnswer = (args) => {
    const m = state.folderMode;
    if (m === "ok") return { data: { v: 1, account: ACCT, project: "pine-soot--" + args.p_project_id }, error: null };
    if (m === "missing") return { status: 404, data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_storage_folders(p_project_id) in the schema cache" } };
    if (m === "revoked") return { status: 403, data: null, error: { code: "42501", message: "permission denied for function turn_storage_folders" } };
    if (m === "network") throw new TypeError("Failed to fetch");
    if (m === "hang") return new Promise(() => {});
    // held until the test calls state.release.shift()(answer); the 8 s timeout is real here
    if (m === "held") return new Promise((resolve) => state.release.push(resolve));
    if (m === "fixed-P") return { data: { v: 1, account: ACCT, project: PROJ }, error: null };
    if (m === "mismatch-account") return { data: { v: 1, account: "alex-smith--" + OTHER, project: PROJ }, error: null };
    if (m === "mismatch-project") return { data: { v: 1, account: ACCT, project: "pine-soot--" + OTHER }, error: null };
    if (m === "legacy-answer") return { data: { v: 1, account: U, project: P }, error: null };
    if (m === "bad-label") return { data: { v: 1, account: "Alex--" + U, project: PROJ }, error: null };
    if (m === "null-project") return { data: { v: 1, account: ACCT, project: null }, error: null };
    if (m === "v2") return { data: { v: 2, account: ACCT, project: PROJ }, error: null };
    throw new Error("unknown folder mode " + m);
  };
  const sb = {
    from: (t) => new Query(t),
    storage: { from: () => storage },
    auth: { getSession: async () => ({ data: { session: { user: { id: U } } }, error: null }) },
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args: clone(args) });
      if (name === "turn_storage_folders") return folderAnswer(args);
      if (name === "turn_begin_asset_upload") {
        state.begins.push(args.p_path);
        const refusal = options.reservationRefuses && options.reservationRefuses(args.p_path);
        if (refusal) return { status: 400, data: null, error: refusal };
        return { data: new Date(Date.now() + 3600e3).toISOString(), error: null };
      }
      if (name === "turn_finish_asset_upload") return { data: null, error: null };
      return { data: null, error: { status: 500, code: "unexpected_rpc", message: "unexpected RPC " + name } };
    },
  };
  class FakeDate extends Date { static now() { return super.now() + state.clock; } }
  const sandbox = {
    console: { warn: (...a) => state.warnings.push(a.join(" ")), log: () => {}, error: () => {} },
    Blob, Uint8Array, atob, Date: FakeDate, Math, Map, Set, JSON, Promise,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {}, navigator: {}, location: { origin: "https://app.test" },
    fetch: async () => { throw new Error("network should not be called"); },
    // the folder RPC's 8 s timeout fires at once in this harness; every other timer is real
    setTimeout: (fn, ms, ...rest) => (ms === 8000 && state.folderMode !== "held" ? setTimeout(fn, 0, ...rest) : setTimeout(fn, ms, ...rest)),
    clearTimeout, setInterval, clearInterval,
    TURN_SUPABASE: { url: "https://supabase.test", anonKey: "anon", bucket: "turn-assets",
      ...(options.killSwitch ? { readableStorageKeys: false } : {}) },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.window._sbClient = sb;
  vm.createContext(sandbox);
  if (!options.noParser) vm.runInContext(readFileSync("app/storage-keys.js", "utf8"), sandbox, { filename: "app/storage-keys.js" });
  vm.runInContext(readFileSync("app/cloud.jsx", "utf8"), sandbox, { filename: "app/cloud.jsx" });
  const folderCalls = () => state.rpcCalls.filter((c) => c.name === "turn_storage_folders").length;
  const commit = (entity = "adem", refs = [], diagnostics = {}) =>
    sandbox.cloudCommit(P, U, entity, png, { version: 1 }, refs, "character", undefined, diagnostics);
  return { sandbox, state, folderCalls, commit };
}
const top2 = (path) => String(path).split("/").slice(0, 2).join("/");
const REF = (kind) => ({ kind, label: kind, url: png });

{
  const h = harness();
  const diagnostics = {};
  const r = await h.commit("adem", [REF("owner"), REF("prop")], diagnostics);
  ok("RPC answer → the sheet is saved under the readable folders", r.tier === "cloud" && top2(h.state.uploads[0]) === ACCT + "/" + PROJ, h.state.uploads);
  ok("the folder RPC is called with p_project_id (the SQL argument name)",
    JSON.stringify(h.state.rpcCalls.find((c) => c.name === "turn_storage_folders").args) === JSON.stringify({ p_project_id: P }));
  ok("one save = one prefix: the sheet and both references share the readable folders, one RPC call",
    h.state.uploads.length === 3 && h.state.uploads.every((p) => top2(p) === ACCT + "/" + PROJ) && h.folderCalls() === 1, h.state.uploads);
  ok("each reservation names the exact readable key it uploads", JSON.stringify(h.state.begins) === JSON.stringify(h.state.uploads));
  ok("the generation row records the readable keys", h.state.rows.get(P + "|adem").storage_path === h.state.uploads[0]
    && h.state.rows.get(P + "|adem").refs.every((ref) => top2(ref.storage_path) === ACCT + "/" + PROJ));
  ok("a clean readable save carries no warning", !diagnostics.warning && !r.warning);
  const K = h.sandbox.TurnStorageKeys;
  ok("every readable key parses back to this uploader and project", h.state.uploads.every((p) => K.uid(p) === U && K.projectId(p) === P));

  await h.commit("neo");
  ok("the answer is cached: a second save within 5 minutes asks nothing", h.folderCalls() === 1 && top2(h.state.uploads[3]) === ACCT + "/" + PROJ);
  h.state.clock += 5 * 60 * 1000 + 1;
  await h.commit("trin");
  ok("after 5 minutes the server is asked again", h.folderCalls() === 2);
  const renamed = await h.sandbox.cloudRenameProject(P, "Pine Soot");
  await h.commit("morpheus");
  ok("a successful rename drops the cached folders (the server names an untitled project from its first title)",
    renamed.ok === true && h.folderCalls() === 3);
  const other = await h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, OTHER);
  ok("folders are cached per uid|project: another project gets its own answer", other.readable === true && other.project === "pine-soot--" + OTHER);
  h.state.folderMode = "fixed-P";
  const THIRD = "0de1e7ed-0000-4000-8000-000000000006";
  const third = await h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, THIRD);
  ok("folders are per project: an answer naming another project id is refused", third.readable === false && third.project === THIRD);
  h.state.folderMode = "ok";
}

for (const mode of ["missing", "revoked", "network", "hang", "mismatch-account", "mismatch-project", "legacy-answer", "bad-label", "null-project", "v2"]) {
  const h = harness({ folderMode: mode });
  const r = await h.commit("adem", [REF("owner")]);
  ok(mode + " → legacy {uid}/{pid}/ keys for the sheet and its reference",
    r.tier === "cloud" && h.state.uploads.length === 2 && h.state.uploads.every((p) => top2(p) === U + "/" + P), h.state.uploads);
  await h.commit("neo");
  ok(mode + " → the legacy answer is cached too (no second RPC within 5 minutes)", h.folderCalls() === 1);
}

{
  const h = harness({ killSwitch: true });
  await h.commit("adem", [REF("owner")]);
  ok("kill switch readableStorageKeys:false → legacy keys and the RPC is never called",
    h.folderCalls() === 0 && h.state.uploads.every((p) => top2(p) === U + "/" + P));
}
{
  const h = harness({ noParser: true });
  await h.commit("adem");
  ok("parser missing → legacy keys and the RPC is never called", h.folderCalls() === 0 && top2(h.state.uploads[0]) === U + "/" + P);
}

// ── the one-shot legacy retry ──────────────────────────────────────────────
const scopeRefusal = { code: "22023", message: "TURN_ASSET_UPLOAD: path is outside the caller project scope" };
{
  const h = harness({ reservationRefuses: (p) => (p.startsWith(ACCT + "/") ? scopeRefusal : null) });
  const diagnostics = {};
  const r = await h.commit("adem", [REF("owner")], diagnostics);
  ok("reservation scope refusal of a readable key → one retry with a fresh legacy key and a fresh reservation",
    r.tier === "cloud" && h.state.begins.length === 3 && top2(h.state.begins[0]) === ACCT + "/" + PROJ
      && top2(h.state.begins[1]) === U + "/" + P && h.state.uploads.length === 2 && h.state.uploads.every((p) => top2(p) === U + "/" + P), h.state.begins);
  ok("the retried save records the legacy key, says so in a warning, and keeps no stale error",
    h.state.rows.get(P + "|adem").storage_path === h.state.uploads[0] && /standard storage folders/.test(r.warning || "")
      && !diagnostics.error && !diagnostics.stage, { warning: r.warning, diagnostics });
  ok("the reference follows the sheet's legacy prefix (one save = one prefix)", top2(h.state.uploads[1]) === U + "/" + P);
  ok("the fallback is reported once on the console (the save itself succeeds silently)",
    h.state.warnings.length === 1 && /standard storage folders[\s\S]*admin-inventory\.sql[\s\S]*row 126/.test(h.state.warnings[0]), h.state.warnings);
  const beginsBefore = h.state.begins.length;
  await h.commit("neo");
  const secondBegins = h.state.begins.slice(beginsBefore);
  ok("after a refusal the client writes legacy keys for 5 minutes without asking again",
    h.folderCalls() === 1 && top2(h.state.uploads.at(-1)) === U + "/" + P);
  ok("…and never even tries a readable key again: the next save reserves one legacy key, once",
    secondBegins.length === 1 && top2(secondBegins[0]) === U + "/" + P, secondBegins);
  await h.commit("trin-early", [REF("owner")]);
  ok("…nor for a save with references", h.state.begins.slice(beginsBefore + 1).every((p) => top2(p) === U + "/" + P)
    && h.state.begins.length === beginsBefore + 3 && h.state.warnings.length === 1, h.state.begins.slice(beginsBefore));
  h.state.clock += 5 * 60 * 1000 + 1;
  await h.commit("trin");
  ok("…and asks again after 5 minutes", h.folderCalls() === 2);
}
{
  const h = harness({ storageRefuses: (p) => p.startsWith(ACCT + "/") });
  const r = await h.commit("adem");
  ok("Storage row-level-security refusal of a readable key → exact compensation, then one legacy retry",
    r.tier === "cloud" && h.state.uploads.length === 2 && top2(h.state.uploads[0]) === ACCT + "/" + PROJ
      && JSON.stringify(h.state.removed) === JSON.stringify([h.state.uploads[0]]) && top2(h.state.uploads[1]) === U + "/" + P, { up: h.state.uploads, rm: h.state.removed });
  const r2 = await h.commit("neo", [REF("owner")]);
  ok("after a Storage refusal the next save uploads legacy keys only: no refused readable upload, no compensation, no extra reservation",
    r2.tier === "cloud" && h.state.uploads.length === 4 && h.state.uploads.slice(2).every((p) => top2(p) === U + "/" + P)
      && h.state.removed.length === 1 && h.state.begins.length === 4 && h.folderCalls() === 1,
    { up: h.state.uploads, rm: h.state.removed, begins: h.state.begins });
}
{
  const h = harness({ reservationRefuses: () => ({ code: "42501", message: "TURN_ASSET_UPLOAD: Art Room write access is required" }) });
  const diagnostics = {};
  const r = await h.commit("adem", [], diagnostics);
  ok("never a retry on 'Art Room write access is required'", r.tier === "error" && h.state.begins.length === 1
    && h.state.uploads.length === 0 && /write access is required/.test(r.error || ""), { begins: h.state.begins, r });
  await h.commit("neo");
  ok("…and a missing role does not switch readable keys off", top2(h.state.begins.at(-1)) === ACCT + "/" + PROJ);
}
{
  const h = harness({ reservationRefuses: () => scopeRefusal });
  const r = await h.commit("adem");
  ok("the retry happens once: a legacy key refused too fails the save", r.tier === "error" && h.state.begins.length === 2
    && top2(h.state.begins[0]) === ACCT + "/" + PROJ && top2(h.state.begins[1]) === U + "/" + P, h.state.begins);
}
{
  const h = harness({ folderMode: "missing", storageRefuses: () => true });
  const r = await h.commit("adem");
  ok("a legacy key refused by Storage is never retried", r.tier === "error" && h.state.uploads.length === 1);
}

// ── cache details: per uid|project, one request in flight, disable clears it ──
{
  const h = harness({ folderMode: "held" });
  const a = h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P), b = h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P);
  await new Promise((r) => setTimeout(r, 5));
  ok("two concurrent asks for the same uid|project share one RPC", h.folderCalls() === 1, h.folderCalls());
  h.state.release.shift()({ data: { v: 1, account: ACCT, project: PROJ }, error: null });
  const [ra, rb] = await Promise.all([a, b]);
  ok("…and both get the readable answer", ra.readable && rb.readable && ra.project === PROJ);
  h.state.folderMode = "ok";
  const SECOND = "9f0e1d2c-0000-4000-8000-000000000009";
  const other = await h.sandbox.turnStorageFolders(h.sandbox._sbClient, SECOND, P);
  ok("another signed-in user in the same tab never gets the first user's cached folders (cache key is uid|project)",
    h.folderCalls() === 2 && other.readable === false && other.account === SECOND, { other, calls: h.folderCalls() });
  h.sandbox.turnStorageFoldersDisable(1000);   // a short window, well inside the cached answer's 5-minute life
  h.state.clock += 1001;
  await h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P);
  ok("a disable drops the cached readable answer: after the window the server is asked again", h.folderCalls() === 3, h.folderCalls());
}
{
  // Storage can refuse with a bare 403 (no row-level-security text): still the stale-SQL case
  const h = harness({ storageRefuses: (p) => p.startsWith(ACCT + "/") });
  h.sandbox._sbClient.storage.from = () => ({
    async upload(path) { h.state.uploads.push(path); return path.startsWith(ACCT + "/") ? { error: { statusCode: "403", message: "Unauthorized" } } : { error: null }; },
    async remove(paths) { h.state.removed.push(...paths); return { error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: "signed:" + path }, error: null }; },
  });
  const r = await h.commit("adem");
  ok("a bare 403 from Storage on a readable key also gets the one legacy retry", r.tier === "cloud" && h.state.uploads.length === 2
    && top2(h.state.uploads[1]) === U + "/" + P, h.state.uploads);
}

// ── the folder cache under concurrent invalidation (review 2026-09-27) ──────
{
  const h = harness({ folderMode: "held" });
  const Y = "6b8c2d33-0000-4000-8000-000000000003", X = "7c9d3e44-0000-4000-8000-000000000004";
  const inFlight = h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, Y);   // project Y's first ask hangs…
  await new Promise((r) => setTimeout(r, 5));
  h.sandbox.turnStorageFoldersForget(X);                                       // …a rename of ANOTHER project lands meanwhile…
  h.state.release.shift()({ data: null, error: { code: "500", message: "transient" } });   // …then Y's RPC fails once
  const first = await inFlight;
  ok("a transient failure while another project is renamed answers legacy for that one call", first.readable === false);
  h.state.folderMode = "ok";
  h.state.clock += 60 * 60 * 1000;
  const later = await h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, Y);
  ok("…and is never pinned: the next ask goes to the server again and gets the readable folders",
    later.readable === true && later.account === ACCT && later.project === "pine-soot--" + Y, { later, calls: h.folderCalls() });
  ok("…(exactly one new RPC)", h.folderCalls() === 2, h.folderCalls());
}
{
  const h = harness({ folderMode: "held" });
  const first = h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P);
  await new Promise((r) => setTimeout(r, 5));
  h.sandbox.turnStorageFoldersDisable();                                       // the kill switch path, mid-flight
  const second = h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P);      // while disabled: legacy, no RPC
  h.state.release.shift()({ data: { v: 1, account: ACCT, project: PROJ }, error: null });
  const [a, b] = await Promise.all([first, second]);
  ok("a disable that lands mid-flight wins over the late readable answer, and nothing is cached from it",
    a.readable === false && b.readable === false && h.folderCalls() === 1, { a, b, calls: h.folderCalls() });
  h.state.clock += 5 * 60 * 1000 + 1;
  h.state.folderMode = "ok";
  const c = await h.sandbox.turnStorageFolders(h.sandbox._sbClient, U, P);
  ok("…after the disable window the server is asked again", c.readable === true && h.folderCalls() === 2, { c, calls: h.folderCalls() });
}

// ── cameo: one cameo = one prefix ──────────────────────────────────────────
{
  const h = harness();
  const saved = await h.sandbox.cloudSyncCameo(P, U, "adem", { consent: true, angles: [
    { label: "Front", url: png }, { label: "¾ Left", url: png }, { label: "Profile", url: png }] });
  ok("a cameo's angles share the readable folders, resolved once",
    saved === true && h.state.uploads.length === 3 && h.state.uploads.every((p) => top2(p) === ACCT + "/" + PROJ)
      && h.folderCalls() === 1 && h.state.uploads.every((p) => p.split("/")[2] === "cameo"), h.state.uploads);
  ok("the cameo row records the readable keys", h.state.cameo && h.state.cameo.angles.every((a) => top2(a.storage_path) === ACCT + "/" + PROJ));
}
{
  const h = harness({ reservationRefuses: (p) => (p.startsWith(ACCT + "/") ? scopeRefusal : null) });
  const saved = await h.sandbox.cloudSyncCameo(P, U, "adem", { consent: true, angles: [
    { label: "Front", url: png }, { label: "Left", url: png }, { label: "Right", url: png }] });
  ok("a cameo whose first readable angle is refused falls back once; every angle then shares the legacy prefix",
    saved === true && h.state.begins.length === 4 && top2(h.state.begins[0]) === ACCT + "/" + PROJ
      && h.state.begins.slice(1).every((p) => top2(p) === U + "/" + P) && h.state.cameo.angles.every((a) => top2(a.storage_path) === U + "/" + P),
    h.state.begins);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

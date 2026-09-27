/* Admin Storage page, SERVER half (2026-09-27): runs the REAL
   supabase/functions/admin-storage/core.mjs against the REAL SQL on an
   in-memory Postgres (PGlite). Setup: the Supabase stub from
   test-series-production-sql.mjs, the README chain + series-production.sql
   (so the real cleanup-queue functions run), admin-inventory.sql, then
   admin-storage.sql twice under a hostile global default privilege.
   Covers spec §6 and §10.1 (T1–T17): auth gate and allowlist, overview /
   project-files equal the SQL Editor's saved queries, preview plan = the
   orphans view, deletes never touch live / referenced / service / in-progress
   files, per-batch re-verification, write-ahead audit + crash reconciliation,
   honest Storage failures, resumable runs, the drain's grace rules, fail-closed
   setup states, privileges, scale, and static checks on the source.
   Every name handed to the fake Storage API is audited at call time: it must
   exist, be unreferenced, be marked 'sending' first, and (for deletes) pass the
   path guard and belong to no live project; for drains, pass the path guard
   for its queue row and hold no live upload reservation.
   2026-09-27 review: a crash between 'sending' and the Storage request, a
   project re-inserted mid-call, a lease lost between batches and during a
   slow Storage request, a hung request cut off inside the lease, the drain's
   Storage-before-complete order, and History keyset pages.
   OFFLINE ONLY: no network, no Supabase project, no credentials.
   Run: node scripts/test-admin-storage.mjs */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import * as core from "../supabase/functions/admin-storage/core.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const INV = read("supabase/admin-inventory.sql");
const OPS = read("supabase/admin-storage.sql");
const SERIES = read("supabase/series-production.sql");
const CORE_SRC = read("supabase/functions/admin-storage/core.mjs");
const INDEX_SRC = read("supabase/functions/admin-storage/index.ts");
// code only (comments describe the design in words that would trip the scans)
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const CORE_CODE = code(CORE_SRC);
const INDEX_CODE = code(INDEX_SRC);
// the other harnesses' stubs, read from their files so they stay in step
const SUPABASE_STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
const INV_STUB = read("scripts/test-admin-inventory.mjs").match(/^const STUB = `([\s\S]*?)^`;/m)?.[1];
assert.ok(SUPABASE_STUB && INV_STUB, "stubs found in the other test files");
const README_CHAIN = ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql",
  "shared-owners.sql", "enforce-role-scopes.sql", "cameos.sql", "credits.sql"];

let checks = 0;
const acheck = async (name, fn) => { await fn(); checks++; console.log("PASS", name); };
const j = (v) => JSON.stringify(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const sorted = (a) => [...a].sort();
const VIOLATIONS = [];

// ── ids ─────────────────────────────────────────────────────────────────────
const ADMIN_ID = "ad000000-0000-4000-8000-0000000000ad";
const ALICE = "a11ce000-0000-4000-8000-000000000001";
const BOB   = "b0b00000-0000-4000-8000-000000000002";
const CAROL = "ca201000-0000-4000-8000-000000000003";
const GONE  = "0de1e7ed-0000-4000-8000-000000000005";   // upload folder of a deleted account
const F1 = "f1100000-0000-4000-8000-0000000000f1";      // Alice's live film, Bob collaborates
const S1 = "5b000000-0000-4000-8000-000000000051";      // Carol's Show
const E1 = "e1000000-0000-4000-8000-0000000000e1";      // its Episode 1 (deleted; the Show's sheet lives in its folder)
const E2 = "e2000000-0000-4000-8000-0000000000e2";      // live Episode 2 with an unreferenced file
const DEL  = "de1e7ed0-0000-4000-8000-0000000000d1";    // deleted film: every special case
const DEL2 = "de1e7ed0-0000-4000-8000-0000000000d2";    // crash + reconcile (450 files)
const DEL3 = "de1e7ed0-0000-4000-8000-0000000000d3";    // Storage 503 on one batch (410)
const DEL4 = "de1e7ed0-0000-4000-8000-0000000000d4";    // zero-progress stop, lie, half (610)
const DEL5 = "de1e7ed0-0000-4000-8000-0000000000d5";    // project id re-inserted (3)
const DEL6 = "de1e7ed0-0000-4000-8000-0000000000d6";    // injected items vs the path guard (3)
const DEL7 = "de1e7ed0-0000-4000-8000-0000000000d7";    // preview expiry (3)
const DEL8 = "de1e7ed0-0000-4000-8000-0000000000d8";    // 45 s budget (250)
// 2026-09-27 review fixes
const DEL9 = "de1e7ed0-0000-4000-8000-0000000000d9";    // crash after 'sending', before the Storage request (250)
const DELA = "de1e7ed0-0000-4000-8000-0000000000da";    // project re-inserted DURING a call (450)
const DELB = "de1e7ed0-0000-4000-8000-0000000000db";    // lease taken between two batches (260)
const DELC = "de1e7ed0-0000-4000-8000-0000000000dc";    // lease lost during a slow Storage request (3)
const DELD = "de1e7ed0-0000-4000-8000-0000000000dd";    // a hung Storage request is cut off (3)
const BULK = { [DEL]: 230, [DEL2]: 450, [DEL3]: 410, [DEL4]: 610, [DEL5]: 3, [DEL6]: 3, [DEL7]: 3, [DEL8]: 250,
  [DEL9]: 250, [DELA]: 450, [DELB]: 260, [DELC]: 3, [DELD]: 3 };
const bulkPath = (pid, i) => `${ALICE}/${pid}/character/c1/f${String(i).padStart(4, "0")}.png`;

const F = {
  f1current:     `${ALICE}/${F1}/character/neo/20260101-100000-sheet-v2-aaaa0001.png`,
  f1bob:         `${BOB}/${F1}/character/trin/20260102-100000-sheet-bbbb0001.png`,
  f1preview:     `${ALICE}/studio-previews/${F1}/loc-harbor/preview-r2.png`,
  f1abandoned:   `${ALICE}/${F1}/prop/prop-knife/20260926-090000-sheet-ab000001.png`,
  s1loc:         `${CAROL}/${S1}/location/loc-well/20260103-100000-sheet-cccc0001.png`,
  e1sheet:       `${CAROL}/${E1}/character/mara/20251101-100000-sheet-cccc0002.png`,
  e1shot:        `${CAROL}/${E1}/shot/shot-1/20260105-100000-sheet-cccc0003.png`,
  e2ref:         `${CAROL}/${E2}/location/loc-well/20260106-100000-sheet-dddd0001.png`,
  e2unref:       `${CAROL}/${E2}/prop/prop-lamp/20260107-100000-sheet-dddd0002.png`,
  delShared:     `${ALICE}/${DEL}/prop/prop-x/20250101-100000-sheet-9999aaaa.png`,
  delFresh:      `${ALICE}/${DEL}/character/c2/20260927-000000-sheet-fresh001.png`,
  delLiveIntent: `${ALICE}/${DEL}/character/c3/20260926-000000-sheet-intent01.png`,
  delExpIntent:  `${ALICE}/${DEL}/character/c3/20260925-000000-sheet-intent02.png`,
  delQueued:     `${ALICE}/${DEL}/prop/prop-q/20260920-000000-sheet-queued01.png`,
  delQFail:      `${ALICE}/${DEL}/prop/prop-q/20260920-000000-sheet-qfail001.png`,
  delPreview:    `${ALICE}/studio-previews/${DEL}/loc-1/preview-r1.png`,
  delRelay:      `${ALICE}/${DEL}/shot/job-9/blender-preview-job-9.png`,
  delMigration:  `${ALICE}/${DEL}/series-migration/x-1/abc123.png`,
  delBob:        `${BOB}/${DEL}/shot/s1/20260101-100000-sheet-bbbb0009.png`,
  goneDel:       `${GONE}/${DEL}/lookbook/lb1/20250101-100000-sheet-g0000001.png`,
  internal:      `_internal/blender-bridge/claims/9f8e7d.json`,
  mesh:          `blender-studio-internal/output/n0nce/asset.glb`,
  stageTmp:      `${ALICE}/stage-tmp/1758800000000-image-0-a1b2.png`,
};
const AGE = { delFresh: "10 minutes", stageTmp: "3 hours", f1abandoned: "1 hour" };
const LATE_ORPHAN = `${ALICE}/${DEL}/prop/p7/20250101-100000-sheet-late0001.png`;

const confirmedAt = new Date().toISOString();
const ADMIN = { id: ADMIN_ID, email: "admin@infinitestudioai.com", email_confirmed_at: confirmedAt, aud: "authenticated", is_anonymous: false };
const USERS = {
  "tok-admin": ADMIN,
  "tok-admin-mixed": { ...ADMIN, email: "  Admin@InfiniteStudioAI.com " },
  "tok-alice": { id: ALICE, email: "alice@example.com", email_confirmed_at: confirmedAt, aud: "authenticated", is_anonymous: false },
  "tok-unconfirmed": { ...ADMIN, email_confirmed_at: null },
  "tok-anon": { ...ADMIN, is_anonymous: true },
  "tok-aud": { ...ADMIN, aud: "anon" },
};

// ── the adapters index.ts would inject, over PGlite ─────────────────────────
async function auditStorageCall(db, names) {
  const rows = (await db.query(`with n as (select value as path from jsonb_array_elements_text($1::jsonb))
    select n.path,
           exists (select 1 from storage.objects o where o.bucket_id = 'turn-assets' and o.name = n.path) as present,
           exists (select 1 from turn_admin.referenced_paths r where r.path = n.path) as referenced,
           exists (select 1 from public.turn_asset_upload_intents i where i.path = n.path) as reserved,
           exists (select 1 from public.turn_asset_upload_intents i where i.path = n.path and i.expires_at > now()) as reserved_live,
           coalesce((select array_agg(distinct i.project_id::text) from turn_admin_ops.storage_run_items i
                       join turn_admin_ops.storage_runs r on r.id = i.run_id
                      where i.path = n.path and i.outcome = 'sending' and r.action = 'drain-cleanup-queue'
                        and i.project_id is not null), '{}') as drain_pids,
           coalesce((select array_agg(r.action) from turn_admin_ops.storage_run_items i
                       join turn_admin_ops.storage_runs r on r.id = i.run_id
                      where i.path = n.path and i.outcome = 'sending'), '{}') as sending_in,
           coalesce((select array_agg(distinct x::text) from turn_admin_ops.storage_run_items i
                       join turn_admin_ops.storage_runs r on r.id = i.run_id
                      cross join lateral unnest(r.project_ids) x
                      where i.path = n.path and i.outcome = 'sending'), '{}') as run_pids,
           exists (select 1 from public.turn_projects p
                    where p.id::text = split_part(n.path, '/', 2)
                       or (split_part(n.path, '/', 2) = 'studio-previews' and p.id::text = split_part(n.path, '/', 3))) as project_live
      from n`, [j(names)])).rows;
  for (const r of rows) {
    const why = [];
    if (!r.present) why.push("not an existing object");
    if (r.referenced) why.push("referenced");
    if (!r.sending_in.length) why.push("not marked 'sending' before the call (write-ahead)");
    if (r.sending_in.includes("delete-deleted-project-files")) {
      if (r.project_live) why.push("belongs to a live project");
      if (r.reserved) why.push("has an upload reservation");
      if (!core.pathGuard(r.path, new Set(r.run_pids))) why.push("fails the path guard");
    }
    if (r.sending_in.includes("drain-cleanup-queue")) {
      if (r.reserved_live) why.push("has a live upload reservation (drain)");
      if (!core.pathGuard(r.path, new Set(r.drain_pids))) why.push("fails the path guard for its queue row (drain)");
    }
    if (why.length) VIOLATIONS.push(r.path + ": " + why.join(", "));
  }
}

function harness(db, { env = {}, role = null, tx: txImpl = null } = {}) {
  const st = { tx: 0, openTx: 0, concurrent: false, dead: false, storage: [], rpc: [], mode: null, hook: null,
    rpcFail: null, storageDelay: 0, rpcDelay: 0, clock: null, logs: [], events: [], rpcHook: null, onStatement: null };
  const tx = txImpl || (async (mode, fn) => {
    st.tx++;
    if (st.dead) throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
    st.openTx++;
    try {
      return await db.transaction(async (t) => {
        if (mode === "read") await t.query("set transaction isolation level repeatable read, read only");
        else if (mode !== "write") throw new Error("bad tx mode " + mode);
        if (role) await t.query(`set local role ${role}`);
        return fn(async (text, params = []) => {
          if (st.onStatement) await st.onStatement(text, t, params);
          return (await t.query(text, params)).rows;
        });
      });
    } finally {
      st.openTx--;
    }
  });
  // no transaction may be open across a Storage or RPC call (one caller at a time)
  const noOpenTx = (what) => { if (!st.concurrent && st.openTx > 0) VIOLATIONS.push(what + " called inside an open transaction"); };
  const storageRemove = async (names) => {
    noOpenTx("storageRemove");
    st.events.push("storage");
    const n = st.storage.push(Array.isArray(names) ? names.slice() : names);
    if (!Array.isArray(names) || !names.length || names.length > 200 || names.some((x) => typeof x !== "string")) {
      VIOLATIONS.push("storageRemove got something other than 1-200 exact names");
      return { error: { message: "bad call" } };
    }
    await auditStorageCall(db, names);
    if (st.storageDelay) await sleep(st.storageDelay);
    if (st.hook) await st.hook(n, names);
    if (st.clock) st.clock.t += st.clock.perCall;
    const m = st.mode ? st.mode(n, names) : "ok";
    const mode = typeof m === "string" ? m : "keep";
    // the instance dies after marking 'sending', before the request leaves: nothing is removed
    if (mode === "die-before") { st.dead = true; throw new Error("edge instance died before the Storage request"); }
    if (mode === "error") return { data: null, error: { message: "simulated 503 Service Unavailable" } };
    if (mode === "lie") return { data: [], error: null };
    let remove = names;
    if (mode === "half") remove = names.slice(0, Math.ceil(names.length / 2));
    if (mode === "keep") remove = names.filter((x) => !m.keep.includes(x));
    await db.query(`delete from storage.objects where bucket_id = 'turn-assets'
                     and name in (select value from jsonb_array_elements_text($1::jsonb))`, [j(remove)]);
    if (mode === "crash") { st.dead = true; throw new Error("edge instance died right after remove"); }
    if (mode === "keep") return { data: null, error: { message: m.error } };
    return { data: remove.map((name) => ({ name })), error: null };
  };
  // PostgREST as service_role: claims + SET LOCAL ROLE, named arguments
  const rpc = async (name, args) => {
    noOpenTx("rpc " + name);
    st.events.push("rpc:" + name);
    st.rpc.push([name, args]);
    if (st.rpcHook) await st.rpcHook(name, args);
    if (st.rpcDelay) await sleep(st.rpcDelay);
    if (st.rpcFail && st.rpcFail(name, args)) return { data: null, error: { message: "simulated PostgREST 502" } };
    const keys = Object.keys(args);
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    const table = name === "turn_claim_asset_cleanup_batch";
    try {
      const rows = await db.transaction(async (t) => {
        await t.query("select set_config('request.jwt.claims', $1, true)", [j({ role: "service_role" })]);
        await t.query("set local role service_role");
        return (await t.query(table ? `select * from ${call}` : `select ${call} as r`, keys.map((k) => args[k]))).rows;
      });
      return { data: table ? rows : rows[0].r, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  };
  const getUser = async (token) => {
    if (token === "tok-throws") throw new Error("GoTrue unreachable");
    return USERS[token] || null;
  };
  const app = core.createAdminStorage({
    getUser, tx, storageRemove, rpc,
    env: { adminEmails: ["admin@infinitestudioai.com"], ...env },
    now: () => (st.clock ? st.clock.t : Date.now()),
    log: (...a) => st.logs.push(a.join(" ")),
  });
  LAST_LOGS = st.logs;
  const call = (body, token = "tok-admin", extra = {}) => app.handle({
    authorization: token === null ? "" : `Bearer ${token}`,
    body: typeof body === "string" ? body : j(body),
    ...extra,
  });
  return { st, app, call };
}
let LAST_LOGS = [];
const ok200 = (r) => { assert.equal(r.status, 200, JSON.stringify(r.json) + " " + LAST_LOGS.slice(-3).join(" | ")); assert.equal(r.json.ok, true); return r.json; };
const err = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(r.json.ok, false);
  if (code) assert.equal(r.json.error.code, code, JSON.stringify(r.json));
  return r.json;
};

// ── fixture ─────────────────────────────────────────────────────────────────
const filmDoc = (title) => ({
  scenes: [{ id: "s1", title: "Opening" }], characters: [{ id: "neo", name: "Neo", scenes: ["s1"] }],
  props: [{ id: "prop-knife", name: "Knife" }], locations: [{ id: "loc-harbor", name: "Harbor" }],
  lookbook: [], lookbookNote: "", shots: [],
  project: { title, genre: "noir", logline: "x", format: "feature" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [], props: [], locations: [], shots: [] }, _rev: 3,
});
const emptyEpisode = (showId, episodeNo, title) => ({
  scenes: [], characters: [], props: [], locations: [], lookbook: [], lookbookNote: "", lookbookApplied: {}, shots: [],
  project: { title, genre: "", logline: "", controllingIdea: {}, format: "series" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [], props: [], locations: [], shots: [] }, blank: true,
  showId, episodeNo, _rev: 2,
});

async function putObject(db, path, age = "3 days", size = 1000) {
  await db.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
                  values ('turn-assets', $1, $2, now() - $3::interval, now() - $3::interval)`,
    [path, j({ size, mimetype: path.endsWith(".json") ? "application/json" : "image/png" }), age]);
}

async function buildMainDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const f of README_CHAIN) {
    try { await db.exec(read("supabase/" + f)); } catch (e) { throw new Error(`prerequisite ${f} failed: ${e.message}`); }
  }
  // legacy data first (as older clients wrote it); series-production.sql backfills it
  for (const [id, email] of [[ALICE, "alice@example.com"], [BOB, "bob@example.com"], [CAROL, "carol@example.com"]]) {
    await db.query(`insert into auth.users(id, email, email_confirmed_at, last_sign_in_at) values ($1, $2, now(), now() - interval '1 day')`, [id, email]);
  }
  await db.query(`insert into public.turn_credits(owner, remaining, plan) values ($1, 500, 'studio')`, [ALICE]);
  await db.query(`insert into storage.buckets(id, name, public) values ('turn-assets', 'turn-assets', false) on conflict do nothing`);
  const project = (id, owner, title, doc) => db.query(
    `insert into public.turn_projects(id, owner, title, doc) values ($1, $2, $3, $4)`, [id, owner, title, j(doc)]);
  await project(F1, ALICE, "Neon Harbor", filmDoc("Neon Harbor"));
  await project(S1, CAROL, "Dust Road", {
    isShow: true,
    bible: { characters: [{ id: "mara", name: "Mara", scenes: ["s1"] }], locations: [{ id: "loc-well", name: "The Well" }],
      props: [{ id: "prop-lamp", name: "Lamp" }], lookbook: [], lookbookNote: "" },
    _rev: 3,
  });
  await project(E1, CAROL, "Dust Road E1", { ...filmDoc("Dust Road"), characters: [{ id: "mara", name: "Mara", scenes: ["s1"] }],
    locations: [{ id: "loc-well", name: "The Well" }], showId: S1, episodeNo: 1 });
  await project(E2, CAROL, "Dust Road E2", emptyEpisode(S1, 2, "Dust Road E02"));
  for (const pid of Object.keys(BULK)) await project(pid, ALICE, "Doomed " + pid.slice(-2), filmDoc("Doomed"));
  const gen = (pid, owner, entity, storagePath, refs = []) => db.query(
    `insert into public.turn_generations(project_id, owner, entity_id, storage_path, refs) values ($1, $2, $3, $4, $5)`,
    [pid, owner, entity, storagePath, j(refs)]);
  await gen(F1, ALICE, "neo", F.f1current, [{ kind: "owner", storage_path: F.delShared }]); // a live film points into DEL's folder
  await gen(F1, BOB, "trin", F.f1bob);                                                   // collaborator upload
  await gen(S1, CAROL, "mara", F.e1sheet);                                               // the Show's sheet under Episode 1
  await gen(S1, CAROL, "loc-well", F.s1loc);
  await gen(E2, CAROL, "loc-well", F.e2ref);
  await gen(DEL, ALICE, "c1", bulkPath(DEL, 0));                                         // cascades away with DEL
  for (const [k, p] of Object.entries(F)) await putObject(db, p, AGE[k] || "3 days", 2000);
  for (const [pid, n] of Object.entries(BULK)) {
    await db.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
                    select 'turn-assets', value, '{"size":1000,"mimetype":"image/png"}'::jsonb, now() - interval '3 days', now() - interval '3 days'
                      from jsonb_array_elements_text($1::jsonb)`, [j(Array.from({ length: n }, (_, i) => bulkPath(pid, i)))]);
  }
  // another bucket is ignored entirely
  await db.query(`insert into storage.buckets(id, name) values ('other-bucket', 'other-bucket')`);
  await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('other-bucket', $1, '{}')`, [bulkPath(DEL, 0)]);

  try { await db.exec(SERIES); } catch (e) { throw new Error("series-production.sql failed: " + e.message); }
  const kinds = Object.fromEntries((await db.query(`select id, project_kind from public.turn_projects where id in ($1, $2, $3)`, [S1, E1, E2])).rows.map((r) => [r.id, r.project_kind]));
  assert.deepEqual(kinds, { [S1]: "show", [E1]: "episode", [E2]: "episode" }, "the legacy Show was backfilled");

  // delete Episode 1 through its lifecycle scope, then the films
  await db.transaction(async (t) => {
    await t.query(`select set_config('turn.series_delete_scope', $1, true)`, [E1]);
    await t.query(`delete from public.turn_projects where id = $1`, [E1]);
  });
  await db.query(`delete from public.turn_projects where id = any($1::uuid[])`, [Object.keys(BULK)]);

  // upload reservations and the cleanup queue (series-production.sql tables)
  await db.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at) values
      ($1, $3, $4, now() - interval '3 hours', now() + interval '2 hours'),
      ($2, $3, $4, now() - interval '1 day', now() - interval '23 hours')`, [F.delLiveIntent, F.delExpIntent, DEL, ALICE]);
  await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, queued_at, available_at) values
      ($1, $5, $7, 'project_deleted', now() - interval '2 hours', now() - interval '1 minute'),
      ($2, $5, $7, 'project_deleted', now() - interval '2 hours', now() - interval '1 minute'),
      ($3, $5, $7, 'project_deleted', now() - interval '2 hours', now() - interval '1 minute'),
      ($4, $6, $7, 'abandoned_upload', now() - interval '1 hour', now() - interval '1 minute')`,
    [F.delQueued, F.delShared, F.delQFail, F.f1abandoned, DEL, F1, ALICE]);
  try { await db.exec(INV); } catch (e) { throw new Error("admin-inventory.sql failed: " + e.message); }
  return db;
}

const savedQuery = (heading) => {
  const head = INV.indexOf(heading);
  assert.ok(head > 0, "saved query in admin-inventory.sql: " + heading);
  const lines = INV.slice(head).split("\n");
  const from = lines.findIndex((l) => /^-- (select|with)\b/.test(l));
  const to = lines.findIndex((l, i) => i >= from && /;\s*$/.test(l));
  assert.ok(from > 0 && to > from);
  return lines.slice(from, to + 1).map((l) => l.replace(/^-- ?/, "")).join("\n").replace(/;\s*$/, "");
};
const rowsOf = async (db, sql, params) => core.normalize((await db.query(sql, params)).rows);
const objectNames = async (db) => new Set((await db.query(`select name from storage.objects where bucket_id = 'turn-assets'`)).rows.map((r) => r.name));
const itemsOf = async (db, runId) => rowsOf(db, `select path, outcome, detail, attempts from turn_admin_ops.storage_run_items where run_id = $1 order by path`, [runId]);
const runRow = async (db, runId) => (await rowsOf(db, `select * from turn_admin_ops.storage_runs where id = $1`, [runId]))[0];
const byOutcome = (items) => items.reduce((m, i) => ((m[i.outcome] = (m[i.outcome] || 0) + 1), m), {});

// ═════════════════════════════════════════════════════════════════════════════
console.log("building the fixture (README chain + series-production.sql + admin-inventory.sql)…");
const db = await buildMainDb();

// ── T17 static (first: cheap, and it guards everything below) ───────────────
await acheck("T17 static: every SQL constant is plain $n-parameterised text; q() only ever runs S.*; Storage gets exact names only", async () => {
  const block = CORE_SRC.slice(CORE_SRC.indexOf("export const S = Object.freeze({"), CORE_SRC.indexOf("\n});", CORE_SRC.indexOf("export const S = Object.freeze({")));
  assert.ok(block.length > 1000, "the S block is found");
  assert.ok(!block.includes("${"), "no template interpolation inside SQL text");
  assert.ok(!/[`'"]\s*\+|\+\s*[`'"]/.test(block), "no string concatenation inside SQL text");
  for (const [name, text] of Object.entries(core.S)) {
    assert.equal(typeof text, "string", name);
    const used = [...new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    assert.deepEqual(used, used.map((_, i) => i + 1), `${name}: placeholders are $1..$n`);
  }
  assert.ok(Object.isFrozen(core.S));
  const calls = [...CORE_CODE.matchAll(/\bq\(\s*([^,)\s]+)/g)].map((m) => m[1]);
  assert.ok(calls.length > 40, "q() call sites found");
  const bad = calls.filter((a) => !/^S\.[A-Z0-9_]+$/.test(a));
  assert.deepEqual(bad, [], "q() is only ever called with a constant from S");
  for (const a of calls) assert.ok(core.S[a.slice(2)], "S constant exists: " + a);
  const unused = Object.keys(core.S).filter((k) => !calls.includes("S." + k));
  assert.deepEqual(unused, [], "every SQL constant is used");
  // no raw SQL anywhere else in core.mjs or index.ts
  const sStart = CORE_CODE.indexOf("export const S = Object.freeze({");
  const outside = CORE_CODE.slice(0, sStart) + CORE_CODE.slice(CORE_CODE.indexOf("\n});", sStart));
  const templates = [...outside.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(templates.length > 0);
  const sqlish = templates.filter((t) => /\b(select|insert|update|delete)\s[\s\S]*\b(from|into|set|where)\b/i.test(t));
  assert.deepEqual(sqlish, [], "no SQL template outside S");
  assert.ok(!/[`"'][^`"'\n]*\b(select|insert|update|delete)\s+[^`"'\n]*\b(from|into|set)\b/i.test(INDEX_CODE), "index.ts holds no SQL");
  // Storage: exact names, no listing, no prefixes
  const removeCalls = [...CORE_CODE.matchAll(/storageRemove\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(removeCalls, ["names", "names"], "core calls storageRemove(names) only, names = exactNames(...)");
  assert.equal((CORE_CODE.match(/const names = exactNames\(/g) || []).length, 2);
  assert.ok(!/\.list\(|\blist\(\s*["'`]/.test(CORE_CODE) && !/\.list\(/.test(INDEX_CODE), "no Storage list() anywhere");
  assert.deepEqual([...INDEX_CODE.matchAll(/\.remove\(([^)]*)\)/g)].map((m) => m[1]), ["paths"], "index.ts removes exact paths only");
  assert.ok(/from\("turn-assets"\)\.remove\(paths\)/.test(INDEX_CODE));
  assert.ok(!/delete\s+from\s+storage\.objects/i.test(CORE_CODE + INDEX_CODE), "never deletes storage rows directly");
  // 2026-09-27 review: every item write after a Storage call is lease-guarded; Storage is bounded inside the lease
  for (const k of ["ITEMS_SETTLE", "MARK_SENDING", "ITEMS_CONFIRM", "RUN_FINISH", "DRAIN_ITEMS_WRITE", "DRAIN_FINISH"])
    assert.match(core.S[k], /lease_token = \$\d::uuid/, k + " checks the lease");
  assert.equal((CORE_CODE.match(/await bounded\(io\.storageRemove\(names\)\)/g) || []).length, 2, "both Storage calls are bounded");
  assert.match(INDEX_CODE, /AbortSignal\.timeout\(SERVICE_TIMEOUT_MS\)/);
  assert.match(INDEX_CODE, /global: \{ fetch: timedFetch \}/);
  // the wrapper: pinned driver, lazy pool, CORS + no-store, queue RPCs only
  assert.ok(INDEX_SRC.includes('import postgres from "npm:postgres@3.4.5"'));
  assert.equal((INDEX_SRC.match(/\bpostgres\(DB_URL/g) || []).length, 1);
  assert.ok(/function db\(\)[\s\S]*pool \?\?= postgres\(DB_URL/.test(INDEX_SRC), "the pool is created lazily inside db()");
  for (const opt of ["max: 3", "prepare: false", "idle_timeout: 20", "max_lifetime: 300", "connect_timeout: 10", 'application_name: "turn-admin-storage"'])
    assert.ok(INDEX_SRC.includes(opt), "pool option " + opt);
  assert.ok(INDEX_SRC.includes('"Cache-Control": "no-store"') && INDEX_SRC.includes('"Access-Control-Allow-Methods": "POST, OPTIONS"'));
  assert.ok(INDEX_SRC.includes('"turn_claim_asset_cleanup_batch", "turn_complete_asset_cleanup"'));
  assert.ok(INDEX_SRC.includes('"isolation level repeatable read read only"') && INDEX_SRC.includes('"read write"'));
  assert.ok(!/image-proxy/.test(INDEX_CODE) && !/image-proxy/.test(CORE_CODE), "image-proxy is not referenced in code");
  assert.deepEqual([...core.ACTIONS], ["status", "overview", "project-files", "preview-delete", "delete", "runs", "drain-queue"]);
  // core.mjs has no imports (Node-testable, like blender-bridge/relay-core.mjs)
  assert.ok(!/^\s*import\s/m.test(CORE_SRC) && !/\brequire\(/.test(CORE_SRC) && !/\bimport\(/.test(CORE_SRC));
  // owner decisions 2026-09-27: manual drain (no cron file / schedule); not in APP_FEATURES
  assert.ok(!existsSync(new URL("supabase/admin-storage-cron.sql", ROOT)), "no pg_cron schedule file");
  assert.ok(!/cron\.schedule/i.test(OPS));
  const ai = read("app/ai.jsx");
  const feat = ai.slice(ai.indexOf("const APP_FEATURES"), ai.indexOf("];", ai.indexOf("const APP_FEATURES")));
  assert.ok(feat.length > 100 && !/admin-storage|Storage · admin|Admin Storage/i.test(feat), "APP_FEATURES does not list the operator page");
});

await acheck("path guard: TURN asset layout only (units)", async () => {
  const set = new Set([DEL]);
  const good = [bulkPath(DEL, 1), F.delPreview, F.delMigration, F.delBob, F.goneDel, `${ALICE}/${DEL.toUpperCase()}/prop/p/x.png`];
  for (const p of good) assert.equal(core.pathGuard(p, set), true, p);
  const bad = ["_internal/x/y.json", "blender-studio-internal/a/b.glb", `${ALICE}/${DEL}/../x/y.png`, `${ALICE}/${F1}/character/c/x.png`,
    `/${ALICE}/${DEL}/character/c/a.png`, `${ALICE}\\${DEL}/character/c/a.png`, F.delRelay, `${ALICE}/${DEL}/character//a.png`,
    `${ALICE}/${DEL}/zzz/x/y.png`, `${ALICE}/${DEL}/character/x.png`, `${ALICE}/stage-tmp/1-a.png`, `${ALICE}/studio-previews/${F1}/l/p.png`,
    `not-a-uuid/${DEL}/character/c/a.png`, `${ALICE}/${DEL}/character/c/a\u0000.png`, "ab", 42, null];
  for (const p of bad) assert.equal(core.pathGuard(p, set), false, String(p));
  // a Show-promotion copy kept for a retry is never planned, whatever the guard says
  assert.equal(core.plannedRule({ path: F.delMigration, area: "show-import-copy", status: "kept-for-promotion-retry", safe_to_delete: false }, set), false);
  assert.equal(core.plannedRule({ path: F.delRelay, area: "asset", status: "service", safe_to_delete: true }, set), false, "relay PNG");
  assert.equal(core.plannedRule({ path: bulkPath(DEL, 1), area: "asset", status: "unreferenced", safe_to_delete: true }, set), false, "unreferenced (live project) is never planned");
  assert.equal(core.plannedRule({ path: F.stageTmp, area: "stage-temp", status: "service", safe_to_delete: true }, set), false);
});

// ── T1 auth ─────────────────────────────────────────────────────────────────
await acheck("T1 auth: sign-in, allowlist, confirmed, not anonymous, aud, uid pin, cron secret, action allowlist, body; no SQL before auth", async () => {
  const h = harness(db);
  err(await h.call({ action: "status" }, null), 401, "sign_in");
  err(await h.app.handle({ authorization: "Basic abc", body: j({ action: "status" }) }), 401, "sign_in");
  err(await h.call({ action: "status" }, "tok-unknown"), 401, "sign_in");
  err(await h.call({ action: "status" }, "tok-throws"), 401, "sign_in");
  err(await h.call({ action: "delete", runId: ADMIN_ID }, null), 401, "sign_in");
  err(await h.call({ action: "list-bucket" }, null), 401, "sign_in");
  const denied = new Set();
  for (const tok of ["tok-alice", "tok-unconfirmed", "tok-anon", "tok-aud"]) {
    const r = err(await h.call({ action: "overview" }, tok), 403, "admin_only");
    denied.add(j(r));
  }
  assert.equal(denied.size, 1, "the 403 body never says which condition failed");
  assert.equal(h.st.tx, 0, "no SQL ran before auth passed");
  const pinned = harness(db, { env: { adminUserIds: [ALICE] } });
  err(await pinned.call({ action: "status" }), 403, "admin_only");
  assert.equal(pinned.st.tx, 0);
  ok200(await harness(db, { env: { adminUserIds: [ADMIN_ID.toUpperCase()] } }).call({ action: "status" }));
  const mixed = ok200(await h.call({ action: "status" }, "tok-admin-mixed"));
  assert.equal(mixed.admin.email, "admin@infinitestudioai.com");
  assert.equal(mixed.version, core.VERSION);
  assert.equal(typeof mixed.elapsedMs, "number");
  const before = h.st.tx;
  err(await h.call({ action: "list-bucket" }), 400, "bad_request");
  err(await h.call("{not json"), 400, "bad_request");
  err(await h.call("[1,2]"), 400, "bad_request");
  err(await h.call({}), 400, "bad_request");
  err(await h.call(j({ action: "status", pad: "x".repeat(17 * 1024) })), 413, "bad_request");
  assert.equal(h.st.tx, before, "rejected requests open no transaction");
  // cron: only drain-queue, only with a 32+ character secret
  const SECRET = "c".repeat(40);
  const cron = harness(db, { env: { cronSecret: SECRET } });
  for (const action of ["status", "overview", "preview-delete", "delete", "runs", "nope"]) {
    err(await cron.app.handle({ cronSecret: SECRET, body: j({ action }) }), 403, "admin_only");
  }
  err(await cron.app.handle({ cronSecret: SECRET.slice(1) + "x", body: j({ action: "drain-queue" }) }), 401, "sign_in");
  assert.equal(cron.st.tx, 0);
  const viaCron = await cron.app.handle({ cronSecret: SECRET, body: j({ action: "drain-queue" }) });
  assert.ok(![400, 401, 403].includes(viaCron.status), "a valid cron secret passes auth for drain-queue: " + viaCron.status);
  const short = harness(db, { env: { cronSecret: "short-secret" } });
  err(await short.app.handle({ cronSecret: "short-secret", body: j({ action: "drain-queue" }) }), 401, "sign_in");
  assert.equal(short.st.tx, 0, "a short secret is ignored");
});

// ── T13 (part 1) + fail-closed states before admin-storage.sql ─────────────
await acheck("T13 no audit schema: status says why, overview works, every deleting action is 412 audit_missing", async () => {
  const h = harness(db);
  const s = ok200(await h.call({ action: "status" }));
  assert.deepEqual(s.admin, { id: ADMIN_ID, email: "admin@infinitestudioai.com" });
  assert.equal(s.db.user, "postgres");
  assert.equal(s.db.superuser, true);
  assert.equal(s.seesAll, true);
  assert.deepEqual(s.setup, { views: 6, missingColumns: [], audit: false, queue: true, intents: true, queueWorker: true });
  assert.deepEqual([s.browseEnabled, s.deleteEnabled, s.drainEnabled], [true, false, false]);
  ok200(await h.call({ action: "overview" }));
  ok200(await h.call({ action: "project-files", projectId: F1 }));
  err(await h.call({ action: "preview-delete", projectIds: [DEL] }), 412, "audit_missing");
  err(await h.call({ action: "delete", runId: ADMIN_ID }), 412, "audit_missing");
  err(await h.call({ action: "runs" }), 412, "audit_missing");
  err(await h.call({ action: "drain-queue" }), 412, "audit_missing");
  assert.equal(h.st.storage.length + h.st.rpc.length, 0);
});

await acheck("T14 preflight: without admin-inventory.sql, or as a non-bypass role, admin-storage.sql stops and creates nothing", async () => {
  const tmp = new PGlite();
  await tmp.exec(INV_STUB);
  await assert.rejects(tmp.exec(OPS), /run admin-inventory\.sql first\. Nothing was created/);
  await tmp.exec("rollback").catch(() => {});
  const n = async () => (await tmp.query(`select count(*)::int n from pg_namespace where nspname = 'turn_admin_ops'`)).rows[0].n;
  assert.equal(await n(), 0);
  await tmp.exec(`insert into storage.buckets(id, name) values ('turn-assets', 'turn-assets')`);
  await tmp.exec(INV);
  await tmp.exec(`create role auditor nologin; grant usage on schema turn_admin to auditor; grant select on all tables in schema turn_admin to auditor; set role auditor;`);
  await assert.rejects(tmp.exec(OPS), /role auditor cannot see every row\)\. Nothing was created/);
  await tmp.exec("rollback").catch(() => {});
  await tmp.exec("reset role");
  assert.equal(await n(), 0);
  await tmp.close();
});

// install: hostile global default privilege first, then the file twice
await db.exec(`alter default privileges grant select on tables to anon, authenticated, service_role;`);
await db.exec(OPS);
const opsRun = await db.exec(OPS);

await acheck("T14 admin-storage.sql: idempotent, RESULT rows ok, no grant to public/anon/authenticated/service_role, not in the Data API", async () => {
  const last = opsRun.at(-1);
  assert.deepEqual(last.fields.map((f) => f.name), ["item", "status", "detail"]);
  assert.deepEqual(last.rows.map((r) => r.status), ["ok", "ok", "ok", "ok", "0"]);
  const acl = (await db.query(`
    select count(*)::int n from (
      select a.grantee from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname = 'turn_admin_ops'
      union all
      select a.grantee from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a where n.nspname = 'turn_admin_ops') g
     where g.grantee = 0 or g.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))`)).rows[0].n;
  assert.equal(acl, 0, "aclexplode finds no grant to an API role (despite the hostile default privilege)");
  const priv = (await db.query(`select has_schema_privilege('anon', 'turn_admin_ops', 'USAGE') a, has_schema_privilege('authenticated', 'turn_admin_ops', 'USAGE') b,
      has_schema_privilege('service_role', 'turn_admin_ops', 'USAGE') c, has_table_privilege('service_role', 'turn_admin_ops.storage_runs', 'SELECT') d,
      has_table_privilege('authenticated', 'turn_admin_ops.storage_run_items', 'SELECT') e`)).rows[0];
  assert.deepEqual(priv, { a: false, b: false, c: false, d: false, e: false });
  const objs = (await db.query(`select c.relkind, count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'turn_admin_ops' group by 1 order by 1`)).rows;
  assert.deepEqual(objs.find((o) => o.relkind === "r"), { relkind: "r", n: 2 });
  assert.equal((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'turn_admin_ops'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from pg_views where schemaname = 'turn_admin'`)).rows[0].n, 6, "turn_admin still holds exactly six views");
  assert.equal(OPS.match(/^\s*(grant|create\s+(or\s+replace\s+)?(function|trigger|policy|view))\b/gim), null, "no grant / function / trigger / policy / view");
  // row 30 notices an exposed schema
  await db.exec(`alter role authenticator set pgrst.db_schemas = 'public, turn_admin_ops'`);
  const exposed = (await db.exec(OPS)).at(-1).rows;
  assert.match(exposed[2].status, /^FAIL/);
  await db.exec(`alter role authenticator set pgrst.db_schemas = 'public, graphql_public'`);
});

// ── T2 overview equals the SQL Editor ───────────────────────────────────────
await acheck("T2 overview: accounts = turn_admin.users, projects = turn_admin.projects + live/owner_id, folders roll up to the saved Storage map", async () => {
  const h = harness(db);
  const ov = ok200(await h.call({ action: "overview" }));
  assert.ok(!Number.isNaN(Date.parse(ov.asOf)));
  assert.equal(ov.setup.deleteEnabled, true);
  assert.equal(ov.setup.drainEnabled, true);
  const users = await rowsOf(db, `select * from turn_admin.users`);
  const authIds = new Set((await db.query(`select id from auth.users`)).rows.map((r) => r.id));
  const key = (r) => r.user_id;
  assert.equal(ov.accounts.length, users.length);
  const accById = new Map(ov.accounts.map((a) => [key(a), a]));
  for (const u of users) {
    const a = accById.get(u.user_id);
    assert.ok(a, "account " + u.email);
    for (const c of core.REQUIRED_COLUMNS.users) assert.deepEqual(a[c], u[c], `${u.email}.${c}`);
    assert.equal(a.deleted_account, !authIds.has(u.user_id));
  }
  assert.equal(accById.get(GONE).deleted_account, true);
  assert.equal(accById.get(GONE).email, "(deleted account)");
  const projects = await rowsOf(db, `select * from turn_admin.projects`);
  const live = new Map((await db.query(`select id, owner from public.turn_projects`)).rows.map((r) => [r.id, r.owner]));
  assert.equal(ov.projects.length, projects.length);
  const projById = new Map(ov.projects.map((p) => [p.project_id, p]));
  for (const p of projects) {
    const o = projById.get(p.project_id);
    for (const c of core.REQUIRED_COLUMNS.projects) assert.deepEqual(o[c], p[c], `${p.title}.${c}`);
    assert.equal(o.live, live.has(p.project_id));
    assert.equal(o.owner_id, live.get(p.project_id) ?? null);
  }
  assert.equal(projById.get(DEL).live, false);
  assert.equal(projById.get(E1).live, false);
  assert.equal(projById.get(S1).kind, "show");
  assert.equal(projById.get(E2).episode, 2);
  // every file is in exactly one Q3 group
  const total = (await db.query(`select count(*)::int n, coalesce(sum(bytes), 0)::bigint b from turn_admin.files`)).rows[0];
  assert.equal(ov.folders.reduce((s, f) => s + f.files, 0), total.n);
  assert.equal(ov.folders.reduce((s, f) => s + f.bytes, 0), Number(total.b));
  const map = (await db.query(savedQuery("-- ── Storage map: who owns each folder you see in the Dashboard"))).rows;
  const agg = new Map();
  for (const f of ov.folders) {
    const k = f.user_folder + "/" + f.project_folder;
    const a = agg.get(k) || { files: 0, verdicts: [] };
    a.files += f.files; a.verdicts.push(f.verdict); agg.set(k, a);
  }
  assert.equal(agg.size, map.length, "one rolled-up row per saved-query folder");
  for (const m of map) {
    const a = agg.get(m.user_folder + "/" + m.project_folder);
    assert.ok(a, "folder " + m.user_folder + "/" + m.project_folder);
    assert.equal(a.files, Number(m.files));
    const v = a.verdicts.every((x) => x === "delete-folder") ? "YES" : a.verdicts.some((x) => x !== "in-use") ? "some" : "no";
    const want = m.delete_folder.startsWith("YES") ? "YES" : m.delete_folder.startsWith("some") ? "some" : "no";
    assert.equal(v, want, m.user_folder + "/" + m.project_folder);
  }
  // studio previews split per project (the third grouping key)
  const previews = ov.folders.filter((f) => f.user_folder === ALICE && f.project_folder === "studio-previews");
  assert.deepEqual(sorted(previews.map((f) => f.project_id)), sorted([DEL, F1]));
  assert.ok(ov.queue && ov.queue.byReason.length === 2, "queue summary by reason");
  assert.ok(ov.queue.byReason.find((r) => r.reason === "project_deleted").ready >= 3);
  assert.ok(JSON.stringify(ov).length < 250_000);
});

// ── T3 project-files ────────────────────────────────────────────────────────
await acheck("T3 project-files: equals the saved Film detail query (Show sheet under Episode 1 = stored_elsewhere); keyset pages have no gaps", async () => {
  const h = harness(db);
  const film = (id) => savedQuery("-- ── Film detail (paste one project id)").replace("00000000-0000-0000-0000-000000000000", id);
  for (const pid of [S1, F1, E2, DEL]) {
    const want = (await db.query(film(pid))).rows;
    const got = ok200(await h.call({ action: "project-files", projectId: pid }));
    assert.deepEqual(sorted(got.rows.map((r) => r.path)), sorted(want.map((r) => r.path)), "same files for " + pid);
    assert.equal(got.total, want.length);
    assert.equal(got.nextCursor, null);
    const st = new Map(want.map((r) => [r.path, r]));
    for (const r of got.rows) {
      assert.equal(r.status, st.get(r.path).status);
      assert.equal(r.safe_to_delete, st.get(r.path).safe_to_delete);
    }
  }
  const show = ok200(await h.call({ action: "project-files", projectId: S1.toUpperCase() }));
  assert.equal(show.rows.find((r) => r.path === F.e1sheet).stored_elsewhere, true, "the Show's sheet lives in Episode 1's folder");
  assert.equal(show.rows.find((r) => r.path === F.s1loc).stored_elsewhere, false);
  // keyset paging over DEL (230+ files) with small pages
  const all = [];
  let cursor = null, pages = 0, total = null;
  do {
    const p = ok200(await h.call({ action: "project-files", projectId: DEL, cursor, limit: 70 }));
    if (pages === 0) total = p.total; else assert.equal(p.total, null);
    assert.ok(p.rows.length <= 70);
    all.push(...p.rows.map((r) => r.path));
    cursor = p.nextCursor; pages++;
  } while (cursor);
  assert.ok(pages >= 4);
  assert.equal(new Set(all).size, all.length, "no duplicates");
  assert.equal(all.length, total, "no gaps");
  assert.deepEqual(all, sorted(all));
  err(await h.call({ action: "project-files", projectId: "nope" }), 400, "bad_request");
  err(await h.call({ action: "project-files", projectId: DEL, cursor: "x".repeat(1025) }), 400, "bad_request");
  err(await h.call({ action: "project-files", projectId: DEL, cursor: 5 }), 400, "bad_request");
});

// ── T4 preview ──────────────────────────────────────────────────────────────
const runCount = async () => (await db.query(`select count(*)::int n from turn_admin_ops.storage_runs`)).rows[0].n;
let runA, previewA, plannedA;
await acheck("T4 preview: live id → 409 and no run; bad input → 400; planned = turn_admin.orphans; kept explains itself", async () => {
  const h = harness(db);
  const n0 = await runCount();
  const live = err(await h.call({ action: "preview-delete", projectIds: [DEL, F1] }), 409, "project_live");
  assert.deepEqual(live.error.ids, [F1]);
  assert.equal(await runCount(), n0, "no run row for a refused preview");
  const many = Array.from({ length: 51 }, (_, i) => `de1e7ed0-0000-4000-8000-${String(i).padStart(12, "0")}`);
  err(await h.call({ action: "preview-delete", projectIds: many }), 400, "bad_request");
  err(await h.call({ action: "preview-delete", projectIds: [] }), 400, "bad_request");
  err(await h.call({ action: "preview-delete", projectIds: ["de1e7ed0-0000-4000-8000-00000000zzzz"] }), 400, "bad_request");
  err(await h.call({ action: "preview-delete", projectIds: DEL }), 400, "bad_request");
  assert.equal(await runCount(), n0);

  previewA = ok200(await h.call({ action: "preview-delete", projectIds: [DEL, E1, DEL.toUpperCase()] }));
  runA = previewA.runId;
  const run = await runRow(db, runA);
  assert.equal(run.status, "previewed");
  assert.deepEqual(sorted(run.project_ids), sorted([DEL, E1]), "ids are deduplicated and lowercased");
  assert.equal(run.admin_email, "admin@infinitestudioai.com");
  assert.equal(run.admin_id, ADMIN_ID);
  assert.equal(run.function_version, core.VERSION);
  const mins = (Date.parse(previewA.previewExpiresAt) - Date.now()) / 60000;
  assert.ok(mins > 14 && mins <= 15.1, "expires in 15 minutes");
  const items = await itemsOf(db, runA);
  plannedA = items.filter((i) => i.outcome === "planned").map((i) => i.path);
  const orphans = (await db.query(`select path from turn_admin.orphans where project_id = any($1::uuid[])
      and area in ('asset', 'show-import-copy', 'studio-preview')`, [[DEL, E1]])).rows.map((r) => r.path);
  assert.deepEqual(sorted(plannedA), sorted(orphans), "planned = turn_admin.orphans for those projects");
  assert.equal(previewA.total.files, plannedA.length);
  assert.equal(previewA.total.bytes, plannedA.reduce((s, p) => s + (p.startsWith(ALICE + "/" + DEL + "/character/c1/") ? 1000 : 2000), 0));
  for (const p of [F.delPreview, F.delMigration, F.delBob, F.goneDel, F.e1shot, bulkPath(DEL, 0)]) assert.ok(plannedA.includes(p), "planned " + p);
  const kept = Object.fromEntries(items.filter((i) => i.outcome === "kept").map((i) => [i.path, i.detail]));
  assert.equal(kept[F.delQueued], "queued-for-cleanup");
  assert.equal(kept[F.delExpIntent], "queued-for-cleanup");
  assert.equal(kept[F.delLiveIntent], "uploading");
  assert.equal(kept[F.delFresh], "uploading", "a file under 1 h old");
  assert.equal(kept[F.delRelay], "service", "the Blender relay PNG");
  assert.equal(kept[F.delShared], "ref", "referenced by a live film");
  assert.equal(kept[F.e1sheet], "current", "the live Show's sheet under the deleted Episode 1");
  assert.equal(previewA.kept.files, Object.keys(kept).length);
  assert.deepEqual(sorted(previewA.kept.usedBy.map((u) => u.projectId)), sorted([F1, S1]), "usedBy names the live Show and film");
  assert.equal(previewA.kept.byStatus["queued-for-cleanup"], 3);
  assert.deepEqual(previewA.projects.map((p) => p.projectId), [DEL, E1]);
  assert.equal(previewA.projects.find((p) => p.projectId === E1).files, 1);
  assert.deepEqual(previewA.sample, sorted(plannedA).slice(0, 20));
  for (const p of [F.internal, F.mesh, F.stageTmp, F.f1current, F.e2unref]) assert.ok(!items.some((i) => i.path === p), "never a candidate: " + p);
});

// ── T6 changes between preview and delete, then T10 + T5 ───────────────────
let batchRecheck = [], pQueueG = null;
await acheck("T6+T10+T5 delete: changes after the preview are honoured, two parallel deletes → one 409, only planned ∩ still-safe removed", async () => {
  const P = sorted(plannedA);
  assert.ok(P.length > 206, "more than one batch");
  const [pRef, pIntent, pQueue] = [P[3], P[4], P[5]];
  pQueueG = pQueue;
  // three ordinary asset files that sort into batch 2
  batchRecheck = P.filter((p) => p.startsWith(`${ALICE}/${DEL}/character/c1/`)).slice(-3).reverse();
  assert.ok(batchRecheck.every((p) => P.indexOf(p) > 203), "in batch 2");
  const pidOf = (p) => (p.split("/")[1] === "studio-previews" ? p.split("/")[2] : p.split("/")[1]);
  const uidOf = (p) => p.split("/")[0];
  // (a) a live project starts referencing a planned path; (b) an upload reservation; (c) a queue row; (d) a new orphan
  await db.query(`insert into public.turn_generations(project_id, owner, entity_id, refs) values ($1, $2, 'late-ref', $3)`, [F1, ALICE, j([{ storage_path: pRef }])]);
  await db.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, expires_at) values ($1, $2, $3, now() + interval '2 hours')`, [pIntent, pidOf(pIntent), uidOf(pIntent)]);
  await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, available_at) values ($1, $2, $3, 'project_deleted', now() + interval '1 hour')`, [pQueue, pidOf(pQueue), uidOf(pQueue)]);
  await putObject(db, LATE_ORPHAN);
  const before = await objectNames(db);

  const h = harness(db);
  h.st.storageDelay = 25;
  h.st.concurrent = true;   // two callers share this harness
  // while batch 1 is in flight, three paths of batch 2 change: the per-batch recheck must catch them
  h.st.hook = async (n) => {
    if (n !== 1) return;
    const [x, y, z] = batchRecheck;
    await db.query(`insert into public.turn_generations(project_id, owner, entity_id, refs) values ($1, $2, 'late-ref-2', $3)`, [F1, ALICE, j([{ storage_path: x }])]);
    await db.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, expires_at) values ($1, $2, $3, now() + interval '2 hours')`, [y, pidOf(y), uidOf(y)]);
    await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, available_at) values ($1, $2, $3, 'project_deleted', now() + interval '1 hour')`, [z, pidOf(z), uidOf(z)]);
  };
  const [r1, r2] = await Promise.all([h.call({ action: "delete", runId: runA }), h.call({ action: "delete", runId: runA })]);
  const done = [r1, r2].find((r) => r.status === 200);
  const busy = [r1, r2].find((r) => r.status !== 200);
  assert.ok(done && busy, "exactly one call ran: " + r1.status + " / " + r2.status);
  err(busy, 409, "run_busy");
  const res = done.json;
  assert.equal(res.status, "done");
  assert.equal(h.st.storage.length, 2, "two batches of exact names");

  const skippedExpect = { [pRef]: "ref", [pIntent]: "uploading", [pQueue]: "queued-for-cleanup",
    [batchRecheck[0]]: "referenced", [batchRecheck[1]]: "upload in progress", [batchRecheck[2]]: "queued-for-cleanup" };
  const items = await itemsOf(db, runA);
  const skipped = Object.fromEntries(items.filter((i) => i.outcome === "skipped").map((i) => [i.path, i.detail]));
  assert.deepEqual(skipped, skippedExpect);
  const removedExpect = P.filter((p) => !(p in skippedExpect));
  const removed = items.filter((i) => i.outcome === "removed").map((i) => i.path);
  assert.deepEqual(sorted(removed), sorted(removedExpect), "removed = planned ∩ still safe");
  assert.deepEqual(sorted(h.st.storage.flat()), sorted(removedExpect), "Storage saw exactly those names");
  const after = await objectNames(db);
  const gone = [...before].filter((p) => !after.has(p));
  assert.deepEqual(sorted(gone), sorted(removedExpect), "storage.objects diff = the removed items");
  for (const p of [F.internal, F.mesh, F.delRelay, F.stageTmp, F.f1current, F.f1bob, F.f1preview, F.f1abandoned, F.e1sheet, F.s1loc,
    F.e2ref, F.e2unref, F.delShared, F.delFresh, F.delLiveIntent, F.delExpIntent, F.delQueued, F.delQFail, LATE_ORPHAN, bulkPath(DEL2, 0)]) {
    assert.ok(after.has(p), "untouched: " + p);
  }
  assert.equal((await db.query(`select count(*)::int n from storage.objects where bucket_id = 'other-bucket'`)).rows[0].n, 1);
  assert.equal(res.removed, removedExpect.length);
  assert.equal(res.planned, P.length);
  assert.equal(res.remaining, 0);
  assert.deepEqual(res.skipped, { count: 6, byStatus: { "queued-for-cleanup": 2, ref: 1, referenced: 1, "upload in progress": 1, uploading: 1 } });
  assert.equal(res.failed.count, 0);
  assert.ok(res.leftInProjects && res.leftInProjects["queued-for-cleanup"] >= 3, "what is left, by status");
  const run = await runRow(db, runA);
  assert.equal(run.status, "done");
  assert.equal(run.lease_token, null);
  assert.ok(run.finished_at);
  const c = byOutcome(items);
  assert.deepEqual([run.removed_files, run.skipped_files, run.already_gone, run.failed_files], [c.removed, c.skipped, c.already_gone || 0, c.failed || 0], "counters = item counts");
  assert.equal(run.removed_bytes, removedExpect.reduce((s, p) => s + (p.includes("/character/c1/f") ? 1000 : 2000), 0));
  const orphansLeft = (await db.query(`select path from turn_admin.orphans where project_id = any($1::uuid[])`, [[DEL, E1]])).rows.map((r) => r.path);
  assert.deepEqual(orphansLeft, [LATE_ORPHAN], "a file that appeared after the preview was never in the set");
});

await acheck("T7 idempotency: replaying a done run returns the stored result and calls Storage zero times", async () => {
  const h = harness(db);
  const r = ok200(await h.call({ action: "delete", runId: runA }));
  assert.equal(r.status, "done");
  assert.equal(r.replayed, true);
  assert.equal(r.removed, plannedA.length - 6);
  assert.equal(h.st.storage.length, 0);
  assert.equal((await runRow(db, runA)).status, "done");
});

await acheck("T6 project id re-inserted between preview and delete → 409, nothing deleted; resumable once it is gone again", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL5] }));
  assert.equal(pv.total.files, 3);
  await db.query(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Back again', $3)`, [DEL5, ALICE, j(filmDoc("Back again"))]);
  const r = err(await h.call({ action: "delete", runId: pv.runId }), 409, "project_live");
  assert.deepEqual(r.error.ids, [DEL5]);
  assert.equal(r.error.message, "One of these projects exists again, so nothing was deleted. Refresh.");
  assert.deepEqual([r.error.result.removed, r.error.result.remaining, r.error.result.status], [0, 3, "partial"], "the 409 carries the run's counts");
  assert.equal(h.st.storage.length, 0, "Storage never called");
  const run = await runRow(db, pv.runId);
  assert.equal(run.status, "partial");
  assert.equal(run.lease_token, null);
  assert.equal(run.last_error, "a project in this run exists again; nothing was deleted");
  for (let i = 0; i < 3; i++) assert.ok((await objectNames(db)).has(bulkPath(DEL5, i)));
  await db.query(`delete from public.turn_projects where id = $1`, [DEL5]);
  const again = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([again.status, again.removed], ["done", 3]);
});

await acheck("T12 path guard: injected items outside the layout never reach Storage and are recorded as skipped", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL6] }));
  const injected = ["_internal/x/admin-storage-test.json", `${ALICE}/${DEL6}/../x/y.png`, F.f1current,
    `/${ALICE}/${DEL6}/character/c/a.png`, `${ALICE}\\${DEL6}/character/c/a.png`, `${ALICE}/${DEL6}/shot/job-7/blender-preview-job-7.png`];
  for (const p of injected) if (p !== F.f1current) await putObject(db, p);
  await db.query(`insert into turn_admin_ops.storage_run_items(run_id, path, project_id, bytes, outcome)
                  select $1, value, null, 1, 'planned' from jsonb_array_elements_text($2::jsonb)`, [pv.runId, j(injected)]);
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.equal(r.status, "done");
  assert.equal(r.removed, 3);
  assert.deepEqual(sorted(h.st.storage.flat()), sorted([0, 1, 2].map((i) => bulkPath(DEL6, i))));
  const items = Object.fromEntries((await itemsOf(db, pv.runId)).map((i) => [i.path, i]));
  for (const p of injected) {
    assert.equal(items[p].outcome, "skipped", p);
    assert.equal(items[p].detail, "outside the TURN asset layout", p);
    assert.ok((await objectNames(db)).has(p), "still stored: " + p);
  }
  assert.equal(r.skipped.byStatus["outside the TURN asset layout"], injected.length);
});

await acheck("T11 expiry: a preview older than 15 minutes → 409 preview_expired and status 'expired'; unknown runs → 409 run_not_found", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL7] }));
  await db.query(`update turn_admin_ops.storage_runs set preview_expires_at = now() - interval '1 minute' where id = $1`, [pv.runId]);
  err(await h.call({ action: "delete", runId: pv.runId }), 409, "preview_expired");
  assert.equal((await runRow(db, pv.runId)).status, "expired");
  err(await h.call({ action: "delete", runId: pv.runId }), 409, "preview_expired");
  err(await h.call({ action: "delete", runId: "00000000-0000-4000-8000-000000000000" }), 409, "run_not_found");
  err(await h.call({ action: "delete", runId: "not-a-uuid" }), 400, "bad_request");
  assert.equal(h.st.storage.length, 0);
  for (let i = 0; i < 3; i++) assert.ok((await objectNames(db)).has(bulkPath(DEL7, i)));
});

await acheck("T8 crash: the instance dies after batch 2's remove → run stays 'running'; after the lease a resume reconciles by absence and finishes", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL2] }));
  assert.equal(pv.total.files, 450);
  h.st.mode = (n) => (n === 2 ? "crash" : "ok");
  err(await h.call({ action: "delete", runId: pv.runId }), 503, "db_unreachable");
  h.st.dead = false;
  const mid = await runRow(db, pv.runId);
  assert.equal(mid.status, "running", "left running with its lease");
  assert.deepEqual(byOutcome(await itemsOf(db, pv.runId)), { removed: 200, sending: 200, planned: 50 });
  err(await h.call({ action: "delete", runId: pv.runId }), 409, "run_busy");   // the lease is still live
  await db.query(`update turn_admin_ops.storage_runs set lease_expires_at = now() - interval '1 second' where id = $1`, [pv.runId]);
  const hist = ok200(await h.call({ action: "runs" }));
  assert.equal(hist.runs.find((r) => r.id === pv.runId).interrupted, true, "History shows it as Interrupted");
  const calls = h.st.storage.length;
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r.status, r.removed, r.remaining, r.failed.count], ["done", 450, 0, 0]);
  assert.equal(h.st.storage.length - calls, 1, "only the 50 never-sent items went to Storage; the 200 in flight were reconciled");
  assert.equal(h.st.storage.at(-1).length, 50);
  const items = await itemsOf(db, pv.runId);
  assert.equal(items.filter((i) => i.detail === "reconciled after an interrupted step").length, 200);
  const run = await runRow(db, pv.runId);
  assert.deepEqual([run.status, run.removed_files, run.removed_bytes], ["done", 450, 450_000], "counters recomputed from items");
  assert.equal((await db.query(`select count(*)::int n from storage.objects where name like $1`, [`${ALICE}/${DEL2}/%`])).rows[0].n, 0);
});

await acheck("T9 Storage 503 on one batch: those items fail honestly, the run is partial, a retry completes it", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL3] }));
  h.st.mode = (n) => (n === 2 ? "error" : "ok");
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r.status, r.removed, r.failed.count, r.remaining], ["partial", 210, 200, 200]);
  assert.equal(r.failed.sample.length, 20);
  assert.ok(r.failed.sample.every((f) => /simulated 503/.test(f.detail)));
  const run = await runRow(db, pv.runId);
  assert.equal(run.status, "partial");
  assert.match(run.last_error, /simulated 503/);
  assert.equal(run.failed_files, 200);
  h.st.mode = null;
  const again = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([again.status, again.removed, again.failed.count, again.remaining], ["done", 410, 0, 0]);
});

await acheck("T9 three consecutive zero-progress batches stop the call; 'lies' and half-removals are caught by absence", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL4] }));
  h.st.mode = () => "error";
  const r1 = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.equal(h.st.storage.length, 3, "stopped after 3 failed batches (a 4th exists)");
  assert.deepEqual([r1.status, r1.removed, r1.failed.count, r1.remaining], ["partial", 0, 600, 610]);
  // Storage says OK but removes nothing (lie), then removes half: confirmed by absence
  h.st.mode = (n) => (n === 4 ? "lie" : n === 5 ? "half" : "ok");
  const r2 = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r2.status, r2.removed, r2.failed.count], ["partial", 310, 300]);
  assert.ok(r2.failed.sample.every((f) => f.detail === "still present after remove"));
  const perItem = (await itemsOf(db, pv.runId)).filter((i) => i.outcome === "failed");
  assert.ok(perItem.every((i) => i.attempts === 2), "each item is attempted at most once per call");
  h.st.mode = null;
  const r3 = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r3.status, r3.removed, r3.remaining], ["done", 610, 0]);
});

await acheck("45 s budget: no new batch starts after 45 s; the run is partial and the next call carries on", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL8] }));
  h.st.clock = { t: 1_000_000, perCall: 50_000 };
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r.status, r.removed, r.remaining], ["partial", 200, 50]);
  assert.equal(h.st.storage.length, 1);
  const again = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([again.status, again.removed, again.remaining], ["done", 250, 0]);
});

// ── 2026-09-27 review: interruptions and races inside one delete call ──────
const namesOf = (pid, n) => Array.from({ length: n }, (_, i) => bulkPath(pid, i));
const leftOf = async (pid) => (await db.query(`select count(*)::int n from storage.objects where bucket_id = 'turn-assets' and name like $1`, [`${ALICE}/${pid}/%`])).rows[0].n;
const expireLease = (runId) => db.query(`update turn_admin_ops.storage_runs set lease_expires_at = now() - interval '1 second' where id = $1`, [runId]);

await acheck("T8 crash after marking 'sending' but before the Storage request: a resume puts those items back to planned and deletes them", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DEL9] }));
  h.st.mode = (n) => (n === 1 ? "die-before" : "ok");
  err(await h.call({ action: "delete", runId: pv.runId }), 503, "db_unreachable");
  h.st.dead = false;
  assert.deepEqual(byOutcome(await itemsOf(db, pv.runId)), { sending: 200, planned: 50 });
  assert.equal(await leftOf(DEL9), 250, "nothing was removed");
  await expireLease(pv.runId);
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r.status, r.removed, r.remaining, r.failed.count], ["done", 250, 0, 0]);
  assert.equal(await leftOf(DEL9), 0, "the files that were only marked 'sending' are really gone, not just recorded as removed");
  assert.deepEqual(sorted(h.st.storage.slice(1).flat()), sorted(namesOf(DEL9, 250)), "the resume sent all 250, the 200 again");
});

await acheck("T6 a project re-inserted DURING a call: the next batch stops, and the run says how many files were already deleted", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DELA] }));
  h.st.hook = async (n) => {
    if (n === 1) await db.query(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Back mid-run', $3)`, [DELA, ALICE, j(filmDoc("Back"))]);
  };
  const r = err(await h.call({ action: "delete", runId: pv.runId }), 409, "project_live");
  assert.equal(h.st.storage.length, 1, "batch 2 never reached Storage");
  assert.equal(r.error.message, "One of these projects exists again, so deleting stopped. 200 files had already been deleted. Refresh.");
  assert.deepEqual([r.error.result.removed, r.error.result.remaining, r.error.result.planned], [200, 250, 450]);
  let run = await runRow(db, pv.runId);
  assert.deepEqual([run.status, run.removed_files, run.lease_token], ["partial", 200, null]);
  assert.equal(run.last_error, "stopped: a project in this run exists again; 200 files had already been deleted");
  // the next call (still live) stops before any batch and still reports the 200
  h.st.hook = null;
  const again = err(await h.call({ action: "delete", runId: pv.runId }), 409, "project_live");
  assert.match(again.error.message, /deleting stopped\. 200 files had already been deleted/);
  assert.equal(again.error.result.removed, 200);
  assert.equal(h.st.storage.length, 1);
  run = await runRow(db, pv.runId);
  assert.doesNotMatch(run.last_error, /nothing was deleted/);
  assert.equal(await leftOf(DELA), 250);
  await db.query(`delete from public.turn_projects where id = $1`, [DELA]);
  const done = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([done.status, done.removed], ["done", 450]);
});

await acheck("lease taken between two batches: the second batch's mark-sending is refused and Storage is not called", async () => {
  const h = harness(db);
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DELB] }));
  let marks = 0;
  h.st.onStatement = async (text, t, params) => {
    if (text !== core.S.MARK_SENDING || ++marks !== 2) return;
    // another call (a second tab, or one still running after 90 s) holds the lease now
    await t.query(`update turn_admin_ops.storage_runs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '90 seconds' where id = $1`, [params[0]]);
  };
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  h.st.onStatement = null;
  assert.equal(h.st.storage.length, 1, "only batch 1 was sent");
  assert.deepEqual([r.status, r.removed, r.remaining], ["partial", 200, 60]);
  assert.deepEqual(byOutcome(await itemsOf(db, pv.runId)), { removed: 200, planned: 60 }, "batch 2 was never marked 'sending'");
  const run = await runRow(db, pv.runId);
  assert.ok(run.status === "running" && run.lease_token, "the other call's lease is untouched");
  await expireLease(pv.runId);
  const done = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([done.status, done.removed], ["done", 260]);
});

await acheck("lease lost during a slow Storage request: the old call's confirm writes nothing, the new holder's removals are credited", async () => {
  const hA = harness(db), hB = harness(db);
  hA.st.concurrent = hB.st.concurrent = true;
  const pv = ok200(await hA.call({ action: "preview-delete", projectIds: [DELC] }));
  const inA = deferred(), gateA = deferred(), inB = deferred(), gateB = deferred();
  hA.st.hook = async () => { inA.resolve(); await gateA.promise; };
  hA.st.mode = () => "error";                      // A's request fails while the files are still there
  hB.st.hook = async () => { inB.resolve(); await gateB.promise; };
  const pA = hA.call({ action: "delete", runId: pv.runId });
  await inA.promise;                               // A marked its 3 items 'sending' and waits on Storage
  await expireLease(pv.runId);
  const pB = hB.call({ action: "delete", runId: pv.runId });
  await inB.promise;                               // B leased the run, reconciled A's items and marked them 'sending'
  gateA.resolve();
  const rA = ok200(await pA);
  assert.equal(rA.failed.count, 0, "A recorded no failure over B's items");
  assert.deepEqual(byOutcome(await itemsOf(db, pv.runId)), { sending: 3 }, "B's items are still B's");
  gateB.resolve();
  const rB = ok200(await pB);
  assert.deepEqual([rB.status, rB.removed, rB.failed.count, rB.remaining], ["done", 3, 0, 0]);
  const run = await runRow(db, pv.runId);
  assert.deepEqual([run.status, run.removed_files, run.failed_files, run.already_gone], ["done", 3, 0, 0], "History credits the removals");
  assert.equal(await leftOf(DELC), 0);
});

await acheck("a hung Storage request is reported as failed well inside the lease; the next call settles those files by absence", async () => {
  const h = harness(db, { env: { storageTimeoutMs: 40 } });
  const pv = ok200(await h.call({ action: "preview-delete", projectIds: [DELD] }));
  h.st.storageDelay = 250;                         // answers (and removes) long after the guard
  const r = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([r.status, r.removed, r.failed.count], ["partial", 0, 3]);
  assert.ok(r.failed.sample.every((f) => /Storage did not answer within 1 s/.test(f.detail)));
  await sleep(400);                                // the late request lands
  h.st.storageDelay = 0;
  const again = ok200(await h.call({ action: "delete", runId: pv.runId }));
  assert.deepEqual([again.status, again.alreadyGone, again.remaining], ["done", 3, 0]);
  assert.equal(await leftOf(DELD), 0);
});

await acheck("runs: History list (Done / Partial / Interrupted / Expired / Reviewed) and per-outcome detail pages", async () => {
  const h = harness(db);
  const pending = ok200(await h.call({ action: "preview-delete", projectIds: [DEL] }));   // reviewed, not run
  const list = ok200(await h.call({ action: "runs", limit: 50 }));
  const st = list.runs.map((r) => r.status);
  assert.ok(st.includes("done") && st.includes("expired") && st.includes("previewed"));
  assert.equal(list.runs[0].id, pending.runId, "newest first");
  assert.ok(list.runs.every((r) => typeof r.planned_files === "number" && typeof r.interrupted === "boolean"));
  const d = ok200(await h.call({ action: "runs", runId: runA, outcome: "skipped" }));
  assert.equal(d.run.id, runA);
  assert.equal(d.items.length, 6);
  assert.equal(d.outcomes.removed, plannedA.length - 6);
  const k = ok200(await h.call({ action: "runs", runId: runA, outcome: "kept" }));
  assert.ok(k.items.some((i) => i.path === F.e1sheet && i.detail === "current"));
  const page = ok200(await h.call({ action: "runs", runId: runA, outcome: "removed" }));
  assert.equal(page.nextCursor, null);
  err(await h.call({ action: "runs", runId: runA, outcome: "everything" }), 400, "bad_request");
  err(await h.call({ action: "runs", runId: "00000000-0000-4000-8000-000000000000" }), 409, "run_not_found");
  assert.equal(ok200(await h.call({ action: "runs", limit: 2 })).runs.length, 2);
  // 2026-09-27 review: keyset pages, so no run (and no Resume) ever falls off the list
  const all = list.runs.map((r) => r.id);
  assert.ok(all.length > 10 && all.length < 50, "the whole history fits one 50-row page here: " + all.length);
  assert.equal(list.nextCursor, null);
  assert.ok(!("cursor_at" in list.runs[0]), "the cursor column stays internal");
  const paged = [];
  let cursor = null, pages = 0;
  do {
    const p = ok200(await h.call({ action: "runs", limit: 3, cursor }));
    paged.push(...p.runs.map((r) => r.id));
    cursor = p.nextCursor; pages++;
    assert.ok(pages <= all.length, "paging moves forward and ends");
  } while (cursor);
  assert.ok(pages > 3);
  assert.deepEqual(paged, all, "3 at a time: the same runs in the same order, no gaps, no repeats");
  // reviews that were never run can be left out (the page's default view)
  const real = ok200(await h.call({ action: "runs", limit: 50, reviews: false })).runs;
  assert.deepEqual(real.map((r) => r.id), list.runs.filter((r) => !["previewed", "expired"].includes(r.status)).map((r) => r.id));
  assert.ok(real.length > 5 && real.some((r) => r.status === "done"));
  err(await h.call({ action: "runs", cursor: "not-a-cursor" }), 400, "bad_request");
  err(await h.call({ action: "runs", cursor: "2026-09-27 03:00:00+00|nope" }), 400, "bad_request");
});

// ── T15 drain-queue with the real claim / complete ──────────────────────────
const queueRow = async (p) => (await rowsOf(db, `select *, available_at > now() + interval '4 minutes' and available_at <= now() + interval '6 minutes' as five_min
                                                    from public.turn_asset_cleanup_queue where path = $1`, [p]))[0];
await acheck("T15 drain: removes unreferenced queued files, keeps referenced ones, holds fresh abandoned uploads 24 h, reports Storage failures", async () => {
  const h = harness(db);
  h.st.mode = (n, names) => (names.includes(F.delQFail) ? { keep: [F.delQFail], error: "simulated 503 for one file" } : "ok");
  const r = ok200(await h.call({ action: "drain-queue" }));
  assert.equal(r.status, "done");
  const names = await objectNames(db);
  // unreferenced, project deleted → removed and dequeued (also the expired reservation the claim queued)
  for (const p of [F.delQueued, F.delExpIntent]) {
    assert.ok(!names.has(p), "removed " + p);
    assert.equal(await queueRow(p), undefined, "dequeued " + p);
  }
  // referenced → kept, completed false, attempts up, never sent
  const shared = await queueRow(F.delShared);
  assert.ok(names.has(F.delShared));
  assert.equal(shared.last_error, "still referenced; kept by admin-storage");
  assert.equal(shared.attempts, 1);
  assert.ok(!h.st.storage.flat().includes(F.delShared));
  // abandoned upload in a live project, queued 1 h ago → held (not stuck)
  const held = await queueRow(F.f1abandoned);
  assert.ok(names.has(F.f1abandoned));
  assert.match(held.last_error, /^held: abandoned less than 24 h ago/);
  // Storage failure → last_error, claimable again in 5 minutes
  const failed = await queueRow(F.delQFail);
  assert.ok(names.has(F.delQFail));
  assert.match(failed.last_error, /simulated 503 for one file/);
  assert.equal(failed.five_min, true);
  assert.equal(failed.lease_token, null);
  assert.deepEqual([r.keptReferenced, r.held, r.failed], [1, 1, 1]);
  assert.deepEqual([r.heldGrace, r.heldUpload], [1, 0], "the 24 h wait and live uploads are counted apart");
  assert.ok(r.removed >= 2 && r.claimed >= 5);
  assert.equal(r.stillQueued, (await db.query(`select count(*)::int n from public.turn_asset_cleanup_queue`)).rows[0].n);
  const run = await runRow(db, r.runId);
  assert.deepEqual([run.action, run.status, run.admin_email, run.lease_token], ["drain-cleanup-queue", "done", "admin@infinitestudioai.com", null]);
  assert.equal(run.removed_files, r.removed);
  assert.equal(run.kept_files, 1);
  // Q4 / Q5: the held row is not stuck; the referenced and failed ones stay visible
  const ov = ok200(await h.call({ action: "overview" }));
  assert.equal(ov.queue.byReason.find((x) => x.reason === "abandoned_upload").stuck, 0);
  assert.deepEqual(sorted(ov.queue.stuck.map((x) => x.path)), sorted([F.delShared, F.delQFail]));
  assert.equal(ov.queue.stuck.find((x) => x.path === F.delShared).project_live, false);
});

await acheck("T15 drain: the same abandoned upload queued 25 h ago is removed; not-yet-available rows are not claimed", async () => {
  await db.query(`update public.turn_asset_cleanup_queue set queued_at = now() - interval '25 hours', available_at = now() - interval '1 minute',
                  lease_token = null, lease_expires_at = null where path = $1`, [F.f1abandoned]);
  const h = harness(db);
  const r = ok200(await h.call({ action: "drain-queue", max: 9999 }));
  assert.ok(!(await objectNames(db)).has(F.f1abandoned));
  assert.equal(await queueRow(F.f1abandoned), undefined);
  assert.deepEqual(h.st.storage.flat(), [F.f1abandoned]);
  assert.ok(!h.st.rpc.some(([, a]) => a.p_path === F.delShared || a.p_path === F.delQFail), "rows waiting for available_at are left alone");
  assert.equal(r.removed, 1);
});

await acheck("T15 drain: concurrent drains → one 409; a stale drain lease is taken over and its in-flight items reconciled; cron runs record 'cron'", async () => {
  const h = harness(db);
  h.st.rpcDelay = 40;
  h.st.concurrent = true;
  const [a, b] = await Promise.all([h.call({ action: "drain-queue" }), h.call({ action: "drain-queue" })]);
  const statuses = sorted([a.status, b.status]);
  assert.deepEqual(statuses, [200, 409]);
  err([a, b].find((x) => x.status === 409), 409, "run_busy");
  // a drain that died mid-flight
  const stale = "57a1e000-0000-4000-8000-000000000001";
  await db.query(`insert into turn_admin_ops.storage_runs(id, action, admin_email, status, preview_expires_at, started_at, lease_token, lease_expires_at)
                  values ($1, 'drain-cleanup-queue', 'admin@infinitestudioai.com', 'running', now(), now() - interval '20 minutes', gen_random_uuid(), now() - interval '10 minutes')`, [stale]);
  await db.query(`insert into turn_admin_ops.storage_run_items(run_id, path, outcome) values ($1, $2, 'sending')`, [stale, `${ALICE}/${DEL}/prop/gone/x.png`]);
  ok200(await harness(db).call({ action: "drain-queue" }));
  const old = await runRow(db, stale);
  assert.deepEqual([old.status, old.last_error, old.lease_token, old.removed_files], ["partial", "interrupted (lease expired)", null, 1]);
  assert.ok(old.finished_at);
  assert.equal((await itemsOf(db, stale))[0].outcome, "removed");
  // the (inert unless configured) cron path
  const SECRET = "s".repeat(48);
  const cron = harness(db, { env: { cronSecret: SECRET } });
  const c = ok200(await cron.app.handle({ cronSecret: SECRET, body: j({ action: "drain-queue", max: 10 }) }));
  const cr = await runRow(db, c.runId);
  assert.deepEqual([cr.admin_email, cr.admin_id], ["cron", null]);
  assert.equal((await db.query(`select count(*)::int n from turn_admin_ops.storage_runs where status = 'running'`)).rows[0].n, 0);
});

await acheck("T15 drain: a claim failure stops before Storage; a complete failure after Storage leaves the removal recorded, and the next drain dequeues it", async () => {
  await db.query(`update public.turn_asset_cleanup_queue set available_at = now() - interval '1 minute', lease_token = null, lease_expires_at = null
                   where path = any($1::text[])`, [[pQueueG, F.delShared]]);
  const lastDrain = async () => (await rowsOf(db, `select * from turn_admin_ops.storage_runs where action = 'drain-cleanup-queue' order by created_at desc limit 1`))[0];
  const claimFails = harness(db);
  claimFails.st.rpcFail = (name) => name === "turn_claim_asset_cleanup_batch";
  err(await claimFails.call({ action: "drain-queue" }), 500, "internal");
  assert.equal(claimFails.st.storage.length, 0, "Storage was never called");
  assert.deepEqual([(await lastDrain()).status, (await itemsOf(db, (await lastDrain()).id)).length], ["partial", 0]);

  const h = harness(db);
  h.st.rpcFail = (name) => name === "turn_complete_asset_cleanup";
  err(await h.call({ action: "drain-queue" }), 500, "internal");
  assert.deepEqual(h.st.storage, [[pQueueG]], "the unreferenced file went to Storage straight after the recheck");
  const run = await lastDrain();
  assert.equal(run.status, "partial");
  assert.match(run.last_error, /simulated PostgREST 502/);
  const items = Object.fromEntries((await itemsOf(db, run.id)).map((i) => [i.path, i]));
  assert.deepEqual([items[F.delShared].outcome, items[pQueueG].outcome], ["kept", "removed"], "confirmed by absence, never left 'sending'");
  assert.ok(!(await objectNames(db)).has(pQueueG) && (await objectNames(db)).has(F.delShared));
  assert.ok(await queueRow(pQueueG), "still queued: its complete failed");
  // once the claim leases expire, the next drain dequeues it as already gone
  await db.query(`update public.turn_asset_cleanup_queue set lease_expires_at = now() - interval '1 second' where path = any($1::text[])`, [[pQueueG, F.delShared]]);
  const next = ok200(await harness(db).call({ action: "drain-queue" }));
  assert.equal(await queueRow(pQueueG), undefined);
  assert.ok(next.alreadyGone >= 1 && next.keptReferenced >= 1);
});

// ── 2026-09-27 review: drain guards the fake Storage audit now checks too ───
const Q_RELAY = `${ALICE}/${DEL}/shot/job-5/blender-preview-job-5.png`;
const Q_RES = `${ALICE}/${DEL}/prop/prop-r/20260926-000000-sheet-reserve1.png`;
const RACE_HELD = `${ALICE}/${F1}/prop/prop-knife/20260927-010000-sheet-race0001.png`;
const RACE_OLD = `${ALICE}/${F1}/prop/prop-knife/20260925-010000-sheet-race0002.png`;
const onlyReady = (paths) => db.query(`update public.turn_asset_cleanup_queue set available_at = now() + interval '1 hour', lease_token = null, lease_expires_at = null
                                        where not (path = any($1::text[]))`, [paths]);
await acheck("T15 drain: a queued path outside the asset layout and one with a live upload reservation are never sent to Storage", async () => {
  for (const p of [Q_RELAY, Q_RES]) await putObject(db, p);
  await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, queued_at, available_at) values
      ($1, $3, $4, 'project_deleted', now() - interval '2 hours', now() - interval '1 minute'),
      ($2, $3, $4, 'project_deleted', now() - interval '2 hours', now() - interval '1 minute')`, [Q_RELAY, Q_RES, DEL, ALICE]);
  await db.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, expires_at) values ($1, $2, $3, now() + interval '2 hours')`, [Q_RES, DEL, ALICE]);
  await onlyReady([Q_RELAY, Q_RES]);
  const v0 = VIOLATIONS.length;
  const h = harness(db);
  const r = ok200(await h.call({ action: "drain-queue" }));
  assert.equal(VIOLATIONS.length, v0, "audit: " + VIOLATIONS.slice(v0).join("; "));
  assert.deepEqual(h.st.storage, [], "nothing was sent");
  const names = await objectNames(db);
  assert.ok(names.has(Q_RELAY) && names.has(Q_RES));
  const items = Object.fromEntries((await itemsOf(db, r.runId)).map((i) => [i.path, i]));
  assert.deepEqual([items[Q_RELAY].outcome, items[Q_RELAY].detail], ["failed", "path outside the TURN asset layout; review by hand"]);
  assert.deepEqual([items[Q_RES].outcome, items[Q_RES].detail], ["skipped", "held: upload in progress"]);
  assert.deepEqual([r.heldUpload, r.heldGrace, r.failed], [1, 0, 1]);
  assert.match((await queueRow(Q_RELAY)).last_error, /outside the TURN asset layout/);
  assert.match((await queueRow(Q_RES)).last_error, /^held: upload in progress/);
});

await acheck("T15 drain: Storage is called right after the recheck; completing the held rows waits, so a reference committed meanwhile is never raced", async () => {
  await putObject(db, RACE_HELD, "1 hour");
  await putObject(db, RACE_OLD, "26 hours");
  await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, queued_at, available_at) values
      ($1, $3, $4, 'abandoned_upload', now() - interval '1 hour', now() - interval '1 minute'),
      ($2, $3, $4, 'abandoned_upload', now() - interval '25 hours', now() - interval '1 minute')`, [RACE_HELD, RACE_OLD, F1, ALICE]);
  await onlyReady([RACE_HELD, RACE_OLD]);
  const v0 = VIOLATIONS.length;
  const h = harness(db);
  let fired = false;
  // the uploader commits a generation that uses RACE_OLD while the drain is completing a queue row
  h.st.rpcHook = async (name) => {
    if (name !== "turn_complete_asset_cleanup" || fired) return;
    fired = true;
    await db.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path) values ($1, $2, 'race', $3)`, [F1, ALICE, RACE_OLD]);
  };
  const r = ok200(await h.call({ action: "drain-queue" }));
  assert.ok(fired);
  assert.equal(VIOLATIONS.length, v0, "audit: " + VIOLATIONS.slice(v0).join("; "));
  const storageAt = h.st.events.indexOf("storage");
  const firstComplete = h.st.events.indexOf("rpc:turn_complete_asset_cleanup");
  assert.ok(storageAt >= 0 && storageAt < firstComplete, "no queue RPC between the recheck and Storage: " + h.st.events.join(" "));
  assert.deepEqual(h.st.storage, [[RACE_OLD]]);
  assert.deepEqual([r.removed, r.heldGrace], [1, 1]);
  assert.ok((await objectNames(db)).has(RACE_HELD));
  assert.match((await queueRow(RACE_HELD)).last_error, /^held: abandoned less than 24 h ago/);
});

// ── T13 (rest): fail closed ─────────────────────────────────────────────────
await acheck("T13 a reader limited by row-level security: seesAll false, deleting and draining off", async () => {
  await db.exec(`
    create role auditor nologin;
    grant usage on schema turn_admin, auth, storage to auditor;
    grant select on all tables in schema turn_admin, auth, storage, public to auditor;
  `);
  const h = harness(db, { role: "auditor" });
  const s = ok200(await h.call({ action: "status" }));
  assert.deepEqual([s.db.user, s.db.superuser, s.db.bypassRls, s.seesAll], ["auditor", false, false, false]);
  assert.equal(s.setup.audit, true, "the audit tables exist (read from the catalog, no USAGE needed)");
  assert.deepEqual([s.browseEnabled, s.deleteEnabled, s.drainEnabled], [true, false, false]);
  err(await h.call({ action: "preview-delete", projectIds: [DEL] }), 412, "not_full_reader");
  err(await h.call({ action: "delete", runId: runA }), 412, "not_full_reader");
  err(await h.call({ action: "drain-queue" }), 412, "not_full_reader");
  assert.equal(h.st.storage.length + h.st.rpc.length, 0);
});

await acheck("T13 a view recreated without a column the function reads → 412 views_drift; turn_admin dropped → 412 views_missing", async () => {
  const h = harness(db);
  await db.exec(`alter view turn_admin.files rename column orphan_reason to orphan_reason_old`);
  const s = ok200(await h.call({ action: "status" }));
  assert.deepEqual(s.setup.missingColumns, ["files.orphan_reason"]);
  assert.equal(s.browseEnabled, false);
  err(await h.call({ action: "overview" }), 412, "views_drift");
  err(await h.call({ action: "project-files", projectId: F1 }), 412, "views_drift");
  err(await h.call({ action: "preview-delete", projectIds: [DEL] }), 412, "views_drift");
  await db.exec(`alter view turn_admin.files rename column orphan_reason_old to orphan_reason`);
  ok200(await h.call({ action: "overview" }));
  const runsBefore = await runCount();
  await db.exec(`drop schema turn_admin cascade`);
  const gone = ok200(await h.call({ action: "status" }));
  assert.deepEqual([gone.setup.views, gone.browseEnabled, gone.deleteEnabled], [0, false, false]);
  err(await h.call({ action: "overview" }), 412, "views_missing");
  err(await h.call({ action: "preview-delete", projectIds: [DEL] }), 412, "views_missing");
  err(await h.call({ action: "drain-queue" }), 412, "views_missing");
  ok200(await h.call({ action: "runs" }));   // History still reads the audit log
  // T14: re-running admin-inventory.sql leaves the audit tables intact
  await db.exec(INV);
  assert.equal(await runCount(), runsBefore);
  assert.equal((await runRow(db, runA)).status, "done");
  ok200(await h.call({ action: "overview" }));
});

await acheck("T13 database unreachable → 503; an unexpected error → 500 with no SQL or stack in the body", async () => {
  const dead = harness(db);
  dead.st.dead = true;
  err(await dead.call({ action: "status" }), 503, "db_unreachable");
  const broken = harness(db, { tx: async () => { throw new Error('syntax error at or near "select" in select * from turn_admin.files'); } });
  const r = err(await broken.call({ action: "overview" }), 500, "internal");
  assert.ok(!/select|turn_admin|at \w+ \(/i.test(JSON.stringify(r)), "no SQL text or stack is sent");
  assert.ok(broken.st.logs.some((l) => /syntax error/.test(l)), "details go to the log only");
});

assert.deepEqual(VIOLATIONS, [], "every name handed to Storage was audited clean at call time");
await acheck("audit of every Storage call: exact existing names, unreferenced, marked 'sending' first, guard + no live project for deletes", async () => {
  assert.deepEqual(VIOLATIONS, []);
});
await db.close();

// ── T16 scale (a separate, lighter fixture: admin-inventory's own stub) ─────
await acheck("T16 scale: 20k files, overview payload under 250 KB, project pages of at most 1,000 rows without gaps", async () => {
  const big = new PGlite();
  await big.exec(INV_STUB);
  await big.exec(`insert into storage.buckets(id, name) values ('turn-assets', 'turn-assets')`);
  const users = Array.from({ length: 12 }, (_, i) => `a${String(i).padStart(7, "0")}-0000-4000-8000-000000000001`);
  const projects = Array.from({ length: 150 }, (_, i) => `b${String(i).padStart(7, "0")}-0000-4000-8000-000000000002`);
  await big.query(`insert into auth.users(id, email) select value::uuid, 'user' || ordinality || '@example.com' from jsonb_array_elements_text($1::jsonb) with ordinality`, [j(users)]);
  await big.query(`insert into public.turn_projects(id, owner, title) select value::uuid, ($2::jsonb ->> ((ordinality - 1) % 12)::int)::uuid, 'Film ' || ordinality
                   from jsonb_array_elements_text($1::jsonb) with ordinality`, [j(projects), j(users)]);
  const paths = [];
  for (let i = 0; i < 20000; i++) {
    const p = i < 2500 ? projects[0] : projects[i % 150];
    const u = users[projects.indexOf(p) % 12];
    paths.push(`${u}/${p}/character/c${i % 20}/20260101-000000-sheet-${String(i).padStart(8, "0")}.png`);
  }
  for (let i = 0; i < paths.length; i += 5000) {
    await big.query(`insert into storage.objects(bucket_id, name, metadata, created_at)
                     select 'turn-assets', value, '{"size":1300000,"mimetype":"image/png"}'::jsonb, now() - interval '3 days'
                       from jsonb_array_elements_text($1::jsonb)`, [j(paths.slice(i, i + 5000))]);
  }
  await big.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path)
                   select split_part(value, '/', 2)::uuid, split_part(value, '/', 1)::uuid, 'e' || ordinality, value
                     from jsonb_array_elements_text($1::jsonb) with ordinality where ordinality % 5 <> 0`, [j(paths)]);
  await big.exec(`delete from public.turn_projects where id in (select value::uuid from jsonb_array_elements_text('${j(projects.slice(140))}'::jsonb))`);
  await big.exec(INV);
  const h = harness(big);
  let t = Date.now();
  const ov = ok200(await h.call({ action: "overview" }));
  const size = JSON.stringify(ov).length;
  console.log(`      overview: ${Date.now() - t} ms (elapsedMs ${ov.elapsedMs}), ${size} bytes, ${ov.folders.length} folder rows, ${ov.projects.length} projects`);
  assert.ok(size < 250_000, "overview payload " + size);
  assert.equal(ov.folders.reduce((s, f) => s + f.files, 0), 20000);
  // admin-inventory's stub queue lacks the worker columns: no queue summary, no drain (never a 500)
  assert.equal(ov.queue, null);
  assert.deepEqual([ov.setup.setup.queue, ov.setup.setup.queueWorker, ov.setup.drainEnabled], [false, false, false]);
  await big.exec(OPS);
  err(await h.call({ action: "drain-queue" }), 412, "queue_missing");
  const seen = [];
  let cursor = null, pages = 0;
  t = Date.now();
  do {
    const p = ok200(await h.call({ action: "project-files", projectId: projects[0], cursor }));
    assert.ok(p.rows.length <= 1000);
    if (!pages) assert.equal(p.total, paths.filter((x) => x.split("/")[1] === projects[0]).length);
    seen.push(...p.rows.map((r) => r.path));
    cursor = p.nextCursor; pages++;
  } while (cursor);
  console.log(`      project-files: ${pages} pages in ${Date.now() - t} ms`);
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(pages >= 3);
  await big.close();
});

console.log(`${checks} checks passed`);

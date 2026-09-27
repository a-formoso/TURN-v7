#!/usr/bin/env node
/* ============================================================================
   storage-readable-folders.sql — EXECUTED against an in-memory Postgres (PGlite).

   New turn-assets keys get readable top folders ({handle}--{user id} /
   {project name}--{project id}); the id is the only thing any access check
   reads, and old {user id}/{project id}/… keys keep working forever. This test
   applies the real SQL files to a database that stubs the Supabase pieces they
   use (the SUPABASE_STUB of test-series-production-sql.mjs), and proves:

     A   production as it is today (schema, storage, team-collaboration,
         shared-owners, enforce-role-scopes, cameos, credits, series-production,
         admin-inventory; the three access files as FROZEN pre-change copies in
         scripts/fixtures/pre-readable-folders/*.4ccb774.DO-NOT-RUN.txt, verbatim
         from 4ccb774 below a guard that raises if the file is run as it is) with
         legacy data, then the migration TWICE:
           - both runs succeed, the second changes nothing, RESULT rows 10-90 'ok';
           - the legacy access matrix (select / insert / update / delete /
             turn_can_delete_asset_path / turn_begin_asset_upload, for owner,
             art director, writer, view-only, outsider, anon, over asset, cameo,
             Show-import, relay-PNG, stage-tmp, studio-preview, upload-intent and
             cleanup-queue keys) is deep-equal before and after;
           - the Show / Episode lifecycle deletes authorize the same legacy keys;
           - admin-inventory.sql still re-runs.
     A2  readable keys: the readable twin of every key answers exactly like the
         key itself, for every role and operation (before the migration it did
         not); nobody can write under another account's id whatever handle they
         use; project checks read only the id; every malformed or ambiguous
         folder is refused by Storage and by the upload reservation; lifecycle
         grants, upload intents, the cleanup queue and the commit triggers all
         accept readable keys.
     A3  helper equivalence: the old plpgsql turn_storage_project_id (from the
         frozen file) and the old folder-1 rule against the new helpers, over a
         legacy corpus and 5,000 fuzzed paths.
     A4  project folder names (storage_slug): trigger-owned, first real title,
         frozen, client input ignored, Show / Episode names, backfill keeps every
         updated_at and the Home order, constraint validated.
     A5  account handles: backfill, derivation examples, reserved names, email
         change does not rename, turn_storage_folders / turn_storage_folders_for.
     A6  EXECUTE and table rights of everything the migration creates.
     B   preflight: each missing prerequisite stops the run with a named
         problem and creates nothing.
     C   re-run safety: the CURRENT team-collaboration / enforce-role-scopes /
         series-production (one at a time, then in README order) keep readable
         keys working and install byte-identical helpers; a STALE pre-change
         copy of each of the three (and a storage.sql re-run) breaks what the
         README says, is named by admin-inventory.sql's read-only RESULT row
         126 and by the migration's RESULT rows run on their own, and the
         current files repair it; every RESULT row 10-90 can turn FAIL; a
         frozen fixture run as it is stops at once and changes nothing.
     D   fresh install in the README order, end to end; the file run before
         series-production.sql stops at the preflight.
     E   text: the helper block and the upload rules are identical in all four
         files, the two function bodies match series-production.sql, RPC
         argument names used by app/ and supabase/functions/ match, README.

   OFFLINE ONLY: no network, no Supabase project, no credentials.
     node scripts/test-storage-readable-folders.mjs
   ============================================================================ */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const crashed = (e) => {   // print the SQL error, not PGlite's minified source
  console.log("\nFAIL (crashed) " + (e && e.message ? e.message : String(e)) + (e && e.where ? " — " + e.where : "")
    + (e && e.stack ? "\n" + String(e.stack).split("\n").filter((l) => l.includes("test-storage-readable-folders")).slice(0, 3).join("\n") : ""));
  process.exit(1);
};
process.on("unhandledRejection", crashed);
process.on("uncaughtException", crashed);
const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const MIGRATION = read("supabase/storage-readable-folders.sql");
const README = read("supabase/README.md");
const SUPABASE_STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
if (!SUPABASE_STUB) throw new Error("could not read SUPABASE_STUB from scripts/test-series-production-sql.mjs");
// "pre:" = the frozen pre-change copy production runs today; otherwise the current file.
// The frozen copies are named *.4ccb774.DO-NOT-RUN.txt and start with a statement that
// raises at once (so nobody can paste one into the SQL Editor by mistake); the test
// strips that guard and checks the rest is byte-identical to commit 4ccb774.
const FIXTURE_DIR = "scripts/fixtures/pre-readable-folders/";
const FIXTURE_MARK = "-- ── the frozen copy starts below this line (the test strips everything above) ──\n";
const FIXTURE_SHA256 = {   // sha256 of `git show 4ccb774:supabase/<file>`
  "team-collaboration.sql": "5cf8c79a8c3ee0b43b106a8a468d2b8f69783f1565f359baec2683cb2a6d69b7",
  "enforce-role-scopes.sql": "4c35e75305c716ff169fe5fef957050b89c4134c827758499438d7f93bae22f5",
  "series-production.sql": "2431154dde9f7615f40942fc4965f56e003a34b6e78cebfe5032ee6337da39a5",
};
const fixturePath = (name) => FIXTURE_DIR + name.replace(/\.sql$/, "") + ".4ccb774.DO-NOT-RUN.txt";
const fixtureRaw = (name) => read(fixturePath(name));
function fixture(name) {
  const raw = fixtureRaw(name);
  const at = raw.indexOf(FIXTURE_MARK);
  if (at < 0) throw new Error("fixture guard marker missing in " + fixturePath(name));
  return raw.slice(at + FIXTURE_MARK.length);
}
const source = (name) => name === "storage-readable-folders.sql" ? MIGRATION
  : name.startsWith("pre:") ? fixture(name.slice(4)) : read("supabase/" + name);

let passes = 0, failures = 0;
const ok = (name, condition, detail) => {
  if (condition) { passes++; console.log("PASS " + name); }
  else {
    failures++;
    console.log("FAIL " + name + (detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))));
  }
};
const section = (title) => console.log("\n=== " + title + " ===");

/* ── database plumbing ─────────────────────────────────────────────────────── */
async function newDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  return db;
}
/* Runs a whole file as ONE simple-protocol query, like the SQL Editor. */
async function runSql(db, text) {
  try {
    const results = await db.exec(text);
    return { ok: true, results, last: results[results.length - 1] };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return { ok: false, error: e.message, code: e.code, hint: e.hint };
  }
}
async function chain(db, files) {
  for (const f of files) {
    const r = await runSql(db, source(f));
    if (!r.ok) throw new Error(`prerequisite ${f} failed: ${r.error}`);
  }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;

function claimsFor(who) {
  if (who === "anon") return { claims: { role: "anon" }, role: "anon" };
  if (who === "service") return { claims: { role: "service_role" }, role: "service_role" };
  return { claims: { sub: who.id, email: who.email.toLowerCase(), role: "authenticated" }, role: "authenticated" };
}
/* PostgREST-like request: one transaction as one caller. */
async function as(db, who, fn, { commit = false } = {}) {
  await db.exec("begin");
  try {
    const { claims, role } = claimsFor(who);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    const value = await fn();
    await db.exec(commit ? "commit" : "rollback");
    return { ok: true, value };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return { ok: false, error: e.message, code: e.code };
  }
}
const rows = (db, who, sql, params = [], opts) => as(db, who, async () => (await db.query(sql, params)).rows, opts);
const affected = (db, who, sql, params = [], opts) => as(db, who, async () => (await db.query(sql, params)).affectedRows ?? 0, opts);
/* Many probes as one caller in one rolled-back transaction, each in a savepoint. */
async function session(db, who, fn) {
  await db.exec("begin");
  try {
    const { claims, role } = claimsFor(who);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally {
    await db.exec("rollback").catch(() => {});
  }
}
async function attempt(db, sql, params = []) {
  await db.exec("savepoint probe");
  try {
    const r = await db.query(sql, params);
    await db.exec("rollback to savepoint probe");
    return { ok: true, rows: r.rows, n: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec("rollback to savepoint probe");
    return { ok: false, code: e.code, error: e.message };
  }
}
const errText = (r) => "error " + r.code + " " + String(r.error).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");

/* Schema + data fingerprint: proves "nothing changed" / "idempotent". */
async function snapshot(db) {
  const has = async (t) => (await q(db, `select to_regclass($1) is not null as x`, [t]))[0].x;
  const data = {};
  for (const t of ["public.turn_projects", "public.turn_project_members", "public.turn_generations", "public.turn_cameos",
    "public.turn_asset_upload_intents", "public.turn_asset_cleanup_queue", "public.turn_asset_cleanup_grants",
    "public.turn_storage_accounts", "storage.objects", "storage.buckets"]) {
    data[t] = (await has(t)) ? await q(db, `select to_jsonb(x) j from ${t} x order by 1`) : "absent";
  }
  return {
    columns: await q(db, `select table_schema, table_name, column_name, data_type, column_default, is_nullable
                            from information_schema.columns where table_schema in ('public','storage')
                           order by 1,2,3`),
    tables: await q(db, `select schemaname, tablename, rowsecurity from pg_tables where schemaname in ('public','storage') order by 1,2`),
    functions: await q(db, `select p.proname, pg_get_function_identity_arguments(p.oid) args, md5(pg_get_functiondef(p.oid)) def,
                                   coalesce(array_to_string(p.proacl, ','), '') acl
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1,2`),
    triggers: await q(db, `select tgrelid::regclass::text rel, tgname, tgenabled, pg_get_triggerdef(oid) def from pg_trigger
                            where not tgisinternal order by 1,2`),
    policies: await q(db, `select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies order by 1,2,3`),
    constraints: await q(db, `select conrelid::regclass::text rel, conname, pg_get_constraintdef(oid) def, convalidated
                                from pg_constraint where connamespace = 'public'::regnamespace order by 1,2`),
    tableAcl: await q(db, `select relname, coalesce(array_to_string(relacl, ','), '') acl from pg_class
                            where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
    comments: await q(db, `select objoid::regclass::text rel, objsubid, description from pg_description
                            where classoid = 'pg_class'::regclass and objoid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
                            order by 1,2`),
    data,
  };
}
function diff(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (k === "data") {
      for (const t of Object.keys(a.data)) if (JSON.stringify(a.data[t]) !== JSON.stringify(b.data[t])) out.push("data:" + t);
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}
const MIGRATION_RESULT = MIGRATION.slice(MIGRATION.indexOf("-- ── RESULT"));
/* admin-inventory.sql's RESULT on its own (as the README says an admin may run it):
   row 126 is the read-only check that the readable-folder access pieces are current. */
const INVENTORY = read("supabase/admin-inventory.sql");
const INVENTORY_RESULT = INVENTORY.slice(INVENTORY.indexOf("-- ── RESULT — the table the SQL Editor shows after Run"),
  INVENTORY.indexOf("-- SAVED QUERIES"));
async function inventoryHealth(db) {
  const r = await runSql(db, INVENTORY_RESULT);
  if (!r.ok) return { status: "ERROR " + r.error };
  return (r.last.rows || []).find((x) => x.item === "Readable storage folders: access helpers and rules are current") || { status: "missing row" };
}
const resultRows = (run) => Object.fromEntries(((run && run.last && run.last.rows) || []).map((r, i) => [[10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110][i], r]));
function resultAllOk(run) {
  const r = resultRows(run);
  const bad = [10, 20, 30, 40, 50, 60, 70, 80, 90].filter((o) => !r[o] || r[o].status !== "ok").map((o) => o + " " + (r[o] ? r[o].item + ": " + r[o].status : "missing"));
  return { good: run.ok && bad.length === 0 && Object.keys(r).length === 11, bad };
}

/* ── the people, projects and keys ─────────────────────────────────────────── */
const U = {
  alice: { id: "a11ce000-0000-4000-8000-000000000001", email: "Alice.Owner+turn@example.com" }, // owner
  bob:   { id: "b0b00000-0000-4000-8000-000000000002", email: "bob@example.com" },               // art director
  carol: { id: "ca201000-0000-4000-8000-000000000003", email: "carol@example.com" },             // writer (was art director once)
  vera:  { id: "7e2a0000-0000-4000-8000-000000000004", email: "vera@example.com" },              // view-only
  dave:  { id: "da7e0000-0000-4000-8000-000000000005", email: "dave@example.com" },              // outsider with his own film
};
// accounts that exercise the handle derivation (no projects)
const HANDLE_CASES = [
  ["01000000-0000-4000-8000-000000000101", "Wái.Súk-Yíng@x.hk", "wai-suk-ying"],
  ["01000000-0000-4000-8000-000000000102", "日本@x.jp", "account"],
  ["01000000-0000-4000-8000-000000000103", "deadbeef-01@x.com", "01"],
  ["01000000-0000-4000-8000-000000000104", "admin@gmail.com", "user-admin"],
  ["01000000-0000-4000-8000-000000000105", "admin@infinitestudioai.com", "admin"],
  ["01000000-0000-4000-8000-000000000106", "12345678@qq.com", "account"],
  ["01000000-0000-4000-8000-000000000107", null, "account"],
  ["01000000-0000-4000-8000-000000000108", "Straße.Øresund-Łódź@x.de", "strasse-oresund-lodz"],
  ["01000000-0000-4000-8000-000000000109", "Support+billing@Example.org", "user-support"],
];
const A = U.alice.id, B = U.bob.id, C = U.carol.id, DV = U.dave.id;
const P = {
  F:    "f1000000-0000-4000-8000-000000000001", // Alice's film "Neon Harbor": Bob art director, Carol writer, Vera view-only
  S:    "5e100000-0000-4000-8000-000000000051", // Alice's legacy Show "Pine Soot — Show" (same team on the Show)
  E1:   "e1000000-0000-4000-8000-0000000000e1", // its Episode 1 "Pine Soot"
  E2:   "e2000000-0000-4000-8000-0000000000e2", // its Episode 2 "Pine Soot — E02"
  UT:   "f2000000-0000-4000-8000-000000000002", // Alice's "Untitled film"
  D:    "d0000000-0000-4000-8000-00000000000d", // Dave's "Dave's Film"
  GONE: "9e000000-0000-4000-8000-000000000099", // a deleted project: one cleanup-queue row only
};
const L = {  // legacy keys, in the shapes the app, image-proxy and blender-bridge write
  fSheet:       `${A}/${P.F}/character/neo/20260101-100000-sheet-v2-aaaa0001.png`,
  fUpper:       `${A}/${P.F.toUpperCase()}/character/neo/20260101-100000-ref-owner-aaaa0010.png`, // folder 2 in capitals: accepted before, so still accepted
  fBobProp:     `${B}/${P.F}/prop/lamp/20260102-100000-sheet-bbbb0001.png`,
  fCarolOld:    `${C}/${P.F}/character/neo/20260103-100000-sheet-cccc0001.png`,
  fCarolCam:    `${C}/${P.F}/cameo/carol-cam/20260103-100000-front-cccc0002.png`,
  fBobCam:      `${B}/${P.F}/cameo/trin/20260103-100000-front-bbbb0002.png`,
  fRelayPng:    `${A}/${P.F}/shot/job-1/blender-preview-job-1.png`,
  fCarolIntent: `${C}/${P.F}/character/neo/20260107-100000-sheet-cccc0003.png`, // reserved while Carol was art director
  sSheet:       `${A}/${P.S}/character/mara/20260104-100000-sheet-aaaa0004.png`,
  sImport:      `${A}/${P.S}/series-migration/mara/0123456789abcdef.png`,
  e2Shot:       `${A}/${P.E2}/shot/shot-1/20260105-100000-sheet-aaaa0005.png`,
  e2ShotOld:    `${A}/${P.E2}/shot/shot-1/20260101-100000-sheet-aaaa0006.png`,
  e2Cam:        `${A}/${P.E2}/cameo/mara/20260106-100000-front-aaaa0007.png`,
  goneQueued:   `${B}/${P.GONE}/prop/x/20260108-100000-sheet-bbbb0003.png`,
  dSheet:       `${DV}/${P.D}/character/d/20260109-100000-sheet-dddd0001.png`,
  stageTmp:     `${A}/stage-tmp/1759000000000-video-aaaa0008.mp4`,
  studioPrev:   `${A}/studio-previews/${P.F}/loc-1/prev-1.png`,
};
const INTERNAL = ["_internal/blender-bridge/relay-marker-1.json", `blender-studio-internal/${A}/mesh-1.glb`];
const HANDLE = { [A]: "alice-owner", [B]: "bob", [C]: "carol", [DV]: "dave" };
const NAME = { [P.F]: "neon-harbor", [P.S]: "pine-soot-show", [P.E2]: "pine-soot-e02", [P.GONE]: "untitled", [P.D]: "daves-film" };
/* The readable twin of a key: the same ids, with name-first folders. */
function twin(path) {
  const seg = path.split("/");
  if (HANDLE[seg[0]]) seg[0] = HANDLE[seg[0]] + "--" + seg[0];
  if (seg[1] === "studio-previews") seg[2] = NAME[seg[2]] + "--" + seg[2];
  else if (NAME[seg[1]]) seg[1] = NAME[seg[1]] + "--" + seg[1];
  return seg.join("/");
}
const R = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, twin(v)]));
const RX = {  // readable-only files referenced by the Show family
  sRef:     `alice-owner--${A}/pine-soot-show--${P.S}/character/mara/20260104-110000-ref-owner-aaaa0009.png`,
  e2New:    `alice-owner--${A}/pine-soot-e02--${P.E2}/shot/shot-1/20260110-100000-sheet-v3-aaaa0011.png`,
  e2CamL:   `alice-owner--${A}/pine-soot-e02--${P.E2}/cameo/mara/20260110-100000-left-aaaa0012.png`,
};
const projectOf = (path) => {
  const m = /^[^/]+\/(?:[a-z0-9-]*--)?([0-9a-fA-F-]{36})\//.exec(path);
  return m ? m[1].toLowerCase() : P.F;
};
const fresh = (path) => path.replace(/(\.[a-z0-9]+)$/, "-fresh$1");
const isLegacy = (path) => !path.split("/").slice(0, 3).some((s) => s.includes("--"));
const WHO = [["owner", U.alice], ["artDirector", U.bob], ["writer", U.carol], ["viewOnly", U.vera], ["outsider", U.dave], ["anon", "anon"]];

const filmDoc = (title, extra = {}) => ({
  scenes: [{ id: "s1", title: "Opening" }], characters: [{ id: "neo", name: "Neo", scenes: ["s1"] }],
  props: [], locations: [], lookbook: [], lookbookNote: "", shots: [],
  project: { title, genre: "noir", logline: "x", format: "feature" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [], props: [], locations: [], shots: [] }, _rev: 3, ...extra,
});
const emptyEpisode = (showId, episodeNo, title) => ({
  scenes: [], characters: [], props: [], locations: [], lookbook: [], lookbookNote: "", lookbookApplied: {}, shots: [],
  project: { title, genre: "", logline: "", controllingIdea: {}, format: "series" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [], props: [], locations: [], shots: [] }, blank: true, showId, episodeNo, _rev: 2,
});

/* Everything before series-production.sql: users, projects, team, generation
   rows, cameos and objects (legacy keys, their readable twins, service keys). */
async function seedCore(db) {
  for (const u of Object.values(U)) {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())`, [u.id, u.email]);
  }
  for (const [id, email] of HANDLE_CASES) await db.query(`insert into auth.users(id, email) values ($1, $2)`, [id, email]);
  await db.query(`insert into storage.buckets(id, name, public) values ('turn-assets','turn-assets',false) on conflict do nothing`);
  const projects = [
    [P.F, A, "Neon Harbor", filmDoc("Neon Harbor")],
    [P.S, A, "Pine Soot — Show", { isShow: true, bible: { characters: [{ id: "mara", name: "Mara", scenes: ["s1"] }], locations: [], props: [], lookbook: [], lookbookNote: "" }, _rev: 2 }],
    [P.E1, A, "Pine Soot", { ...filmDoc("Pine Soot"), characters: [{ id: "mara", name: "Mara", scenes: ["s1"] }], showId: P.S, episodeNo: 1 }],
    [P.E2, A, "Pine Soot — E02", emptyEpisode(P.S, 2, "Pine Soot E02")],
    [P.UT, A, "Untitled film", filmDoc("Untitled film")],
    [P.D, DV, "Dave's Film", filmDoc("Dave's Film")],
  ];
  let t = 0;
  for (const [id, owner, title, doc] of projects) {
    t++;
    await db.query(`insert into public.turn_projects(id, owner, title, doc, created_at, updated_at)
                    values ($1, $2, $3, $4, now() - ($5 || ' days')::interval, now() - ($6 || ' hours')::interval)`,
      [id, owner, title, JSON.stringify(doc), String(40 - t), String(13 * t % 7 + t)]);
  }
  for (const pid of [P.F, P.S]) {
    for (const [email, user, role] of [["bob@example.com", B, "art_director"], ["carol@example.com", C, "writer"], ["vera@example.com", U.vera.id, "view_only"]]) {
      await db.query(`insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status, created_at, updated_at)
                      values ($1, $2, $3, $4, $5, 'active', now() - interval '90 days', now() - interval '90 days')`, [pid, A, email, user, role]);
    }
  }
  const gens = [
    [P.F, A, "neo", L.fSheet, [{ storage_path: L.fUpper }], [{ storage_path: L.fCarolOld }]],
    [P.F, B, "lamp", L.fBobProp, [], []],
    [P.S, A, "mara", L.sSheet, [{ storage_path: RX.sRef }], []],
    [P.E2, A, "shot-1", RX.e2New, [], [{ storage_path: L.e2Shot }, { storage_path: L.e2ShotOld }]],
    [P.D, DV, "d", L.dSheet, [], []],
  ];
  for (const [pid, owner, ent, sp, refs, hist] of gens) {
    await db.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path, refs, history) values ($1,$2,$3,$4,$5,$6)`,
      [pid, owner, ent, sp, JSON.stringify(refs), JSON.stringify(hist)]);
  }
  const cameos = [
    [P.F, C, "carol-cam", [{ label: "front", storage_path: L.fCarolCam }]],
    [P.F, B, "trin", [{ label: "front", storage_path: L.fBobCam }]],
    [P.E2, A, "mara", [{ label: "front", storage_path: L.e2Cam }, { label: "left", storage_path: RX.e2CamL }]],
  ];
  for (const [pid, owner, ch, angles] of cameos) {
    await db.query(`insert into public.turn_cameos(project_id, owner, char_id, angles, prov) values ($1,$2,$3,$4,'{"consent":true}')`,
      [pid, owner, ch, JSON.stringify(angles)]);
  }
  for (const p of [...Object.values(L), ...Object.values(R), ...Object.values(RX), ...INTERNAL]) {
    await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":100}')`, [p]);
  }
}
/* After series-production.sql: an upload reservation Carol made while she was
   art director, and a queued cleanup for a deleted project (both key forms). */
async function seedSeries(db) {
  for (const path of [L.fCarolIntent, R.fCarolIntent]) {
    await db.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, expires_at) values ($1, $2, $3, now() + interval '20 minutes')`, [path, P.F, C]);
  }
  for (const path of [L.goneQueued, R.goneQueued]) {
    await db.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader, reason, available_at) values ($1, $2, $3, 'project_deleted', now() + interval '1 day')`, [path, P.GONE, B]);
  }
}
const PROD_BEFORE_SERIES = ["schema.sql", "storage.sql", "pre:team-collaboration.sql", "shared-owners.sql",
  "pre:enforce-role-scopes.sql", "cameos.sql", "credits.sql"];
async function productionDb() {
  const db = await newDb();
  await chain(db, PROD_BEFORE_SERIES);
  await seedCore(db);
  await chain(db, ["pre:series-production.sql"]);
  await seedSeries(db);
  await chain(db, ["admin-inventory.sql"]);
  return db;
}

/* ── the access matrix ─────────────────────────────────────────────────────── */
async function matrix(db, keys) {
  const out = {};
  for (const [whoName, who] of WHO) {
    await session(db, who, async () => {
      for (const [name, path] of Object.entries(keys)) {
        const sel = await attempt(db, `select count(*)::int n from storage.objects where bucket_id = 'turn-assets' and name = $1`, [path]);
        const ins = await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [fresh(path)]);
        const upd = await attempt(db, `update storage.objects set metadata = '{"touched":true}' where bucket_id = 'turn-assets' and name = $1`, [path]);
        const del = await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [path]);
        const can = await attempt(db, `select public.turn_can_delete_asset_path($1) r`, [path]);
        const beg = await attempt(db, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) is not null r`, [projectOf(path), fresh(path)]);
        out[whoName + " " + name] = {
          select: sel.ok ? sel.rows[0].n : errText(sel),
          insert: ins.ok ? "ok" : errText(ins),
          update: upd.ok ? upd.n : errText(upd),
          delete: del.ok ? del.n : errText(del),
          canDelete: can.ok ? can.rows[0].r : errText(can),
          reserve: beg.ok ? "ok" : errText(beg),
        };
      }
    });
  }
  return out;
}
function matrixDiff(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    for (const op of Object.keys(a[k])) {
      if (JSON.stringify(a[k][op]) !== JSON.stringify(b[k] && b[k][op])) out.push(`${k} ${op}: ${JSON.stringify(a[k][op])} → ${JSON.stringify(b[k] && b[k][op])}`);
    }
  }
  return out;
}

/* Show / Episode deletion as the owner, rolled back: which keys get an exact-path
   grant, and who may delete them inside that transaction. */
async function lifecycle(db) {
  const out = {};
  for (const [label, sql, param] of [["episode", `select public.turn_delete_show_episode(p_episode_id => $1) r`, P.E2],
                                     ["show", `select public.turn_delete_show(p_show_id => $1) r`, P.S]]) {
    const r = await as(db, U.alice, async () => {
      const res = (await db.query(sql, [param])).rows[0].r;
      const authorized = res.authorized_cleanup_paths.slice().sort();
      await db.exec("reset role");   // the grants table is private: read it as the table owner, in the same transaction
      const grants = (await db.query(`select path, project_id from public.turn_asset_cleanup_grants where path = any($1) order by path`, [authorized])).rows;
      await db.exec("set local role authenticated");
      const aliceMay = [];
      for (const p of authorized) aliceMay.push((await db.query(`select public.turn_can_delete_asset_path($1) r`, [p])).rows[0].r);
      return { authorized, grants, aliceMay, protected: (res.protected_storage_paths || []).slice().sort() };
    });
    out[label] = r.ok ? r.value : { error: r.error };
  }
  return out;
}
const legacyOnly = (lc) => Object.fromEntries(Object.entries(lc).map(([k, v]) => [k, v.error ? v : {
  authorized: v.authorized.filter(isLegacy),
  grants: v.grants.filter((g) => isLegacy(g.path)),
  aliceMay: v.aliceMay.filter((_, i) => isLegacy(v.authorized[i])),
  protected: v.protected.filter(isLegacy),
}]));

/* ═══════════════════════════════════════════════════════════════════════════
   A. Production before → after
   ═══════════════════════════════════════════════════════════════════════════ */
section("A: production-shaped database + legacy data, then the migration twice");
const db = await productionDb();
{
  const preRules = await q(db, `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') t from pg_policies where schemaname = 'storage' order by 1`);
  ok("A: the production chain has the pre-change folder-1 text rule (this test starts from today's production)",
    preRules.some((r) => r.policyname === "turn assets write collab" && /foldername\(name\)\)\[1\]/.test(r.t)), preRules);
}
const legacyBefore = await matrix(db, L);
const readableBefore = await matrix(db, R);
const lifecycleBefore = await lifecycle(db);
const homeBefore = await q(db, `select id, updated_at from public.turn_projects order by updated_at desc, id`);
ok("A: before the migration, readable twins are NOT accessible (the matrix really exercises the change)",
  legacyBefore["owner fSheet"].select === 1 && readableBefore["owner fSheet"].select === 0
  && legacyBefore["artDirector fBobProp"].insert === "ok" && readableBefore["artDirector fBobProp"].insert !== "ok",
  [legacyBefore["owner fSheet"], readableBefore["owner fSheet"]]);
ok("A: before the migration, a lifecycle delete authorizes no readable key", lifecycleBefore.episode.authorized
  && lifecycleBefore.episode.authorized.every(isLegacy) && lifecycleBefore.show.authorized.every(isLegacy), lifecycleBefore);

{
  const inv = await inventoryHealth(db);
  ok("A: before the migration, admin-inventory's row 126 says there is nothing to check yet", inv.status === "not installed — nothing to check", inv);
}
const run1 = await runSql(db, MIGRATION);
ok("A: first run succeeds", run1.ok, run1.error);
const r1 = resultAllOk(run1);
ok("A: first run — RESULT rows 10-90 read 'ok'", r1.good, r1.bad);
const afterFirst = await snapshot(db);
const run2 = await runSql(db, MIGRATION);
ok("A: second run succeeds", run2.ok, run2.error);
const r2 = resultAllOk(run2);
ok("A: second run — RESULT rows 10-90 read 'ok'", r2.good, r2.bad);
const d12 = diff(afterFirst, await snapshot(db));
ok("A: second run changes nothing (schema, functions, rights, rules, triggers, constraints, data)", d12.length === 0, d12);
{
  const res = resultRows(run2);
  ok("A: RESULT row 100 counts the readable keys already stored", res[100] && Number(res[100].status) === Object.keys(R).length + Object.keys(RX).length,
    res[100]);
  ok("A: RESULT row 30 checked every object", res[30] && res[30].detail.startsWith(String((await q(db, `select count(*)::int n from storage.objects where bucket_id = 'turn-assets'`))[0].n)), res[30]);
}
const legacyAfter = await matrix(db, L);
const legacyChange = matrixDiff(legacyBefore, legacyAfter);
ok(`A: the legacy access matrix (${Object.keys(legacyBefore).length} role×key cells × 6 operations) is identical before and after`,
  legacyChange.length === 0, legacyChange.slice(0, 20));
{
  const m = legacyAfter;
  const expectations = [
    ["owner uploads and reserves in her folder", m["owner fSheet"].insert === "ok" && m["owner fSheet"].reserve === "ok"],
    ["art director uploads in his folder", m["artDirector fBobProp"].insert === "ok" && m["artDirector fBobProp"].reserve === "ok"],
    ["art director deletes anyone's project file", m["artDirector fSheet"].delete === 1 && m["artDirector fSheet"].insert !== "ok"],
    ["writer reads, cannot write, and is refused Art Room access in her own folder",
      m["writer fSheet"].select === 1 && m["writer fSheet"].insert !== "ok" && /write access/.test(m["writer fCarolOld"].reserve)
      && /outside the caller project scope/.test(m["writer fSheet"].reserve)],
    ["view-only member reads an Episode through the Show, deletes nothing", m["viewOnly e2Shot"].select === 1 && m["viewOnly e2Shot"].delete === 0],
    ["outsider and anon see nothing", m["outsider fSheet"].select === 0 && m["anon fSheet"].select === 0 && /permission denied/.test(m["anon fSheet"].reserve)],
    ["outsider owns his own film", m["outsider dSheet"].insert === "ok" && m["owner dSheet"].select === 0],
    ["a capturer deletes her own cameo photo only", m["writer fCarolCam"].delete === 1 && m["writer fBobCam"].delete === 0],
    ["upload-intent and queue delete rights", m["writer fCarolIntent"].canDelete === true && m["artDirector goneQueued"].canDelete === true
      && m["owner goneQueued"].canDelete === false],
    ["a capitalised project folder is accepted, as before", m["owner fUpper"].insert === "ok"],
    ["service areas are closed to signed-in users", m["owner stageTmp"].select === 0 && m["owner studioPrev"].select === 0 && m["owner studioPrev"].insert !== "ok"],
  ];
  const missed = expectations.filter(([, v]) => !v).map(([k]) => k);
  ok(`A: the matrix covers real grants and refusals (${expectations.length} spot checks)`, missed.length === 0, missed);
}
const lifecycleAfter = await lifecycle(db);
ok("A: the Show / Episode lifecycle deletes authorize and grant exactly the same legacy keys as before",
  JSON.stringify(legacyOnly(lifecycleBefore)) === JSON.stringify(legacyOnly(lifecycleAfter)), { before: legacyOnly(lifecycleBefore), after: legacyOnly(lifecycleAfter) });
const homeAfter = await q(db, `select id, updated_at from public.turn_projects order by updated_at desc, id`);
ok("A: the slug backfill left every updated_at, and so the Home order, unchanged",
  JSON.stringify(homeBefore) === JSON.stringify(homeAfter), { before: homeBefore, after: homeAfter });
{
  // …and switched the touch trigger back on: otherwise every later save would stop
  // bumping updated_at and the Home wall (ordered by it) would freeze for everyone
  const touch = await q(db, `select tgenabled from pg_trigger where tgrelid = 'public.turn_projects'::regclass and tgname = 'turn_projects_touch'`);
  ok("A: after two runs, turn_projects_touch is enabled again (tgenabled 'O', as before the migration)", touch.length === 1 && touch[0].tgenabled === "O", touch);
  const bumped = await as(db, U.alice, async () => {
    const was = (await db.query(`select updated_at from public.turn_projects where id = $1`, [P.UT])).rows[0].updated_at;
    await db.query(`update public.turn_projects set doc = doc where id = $1`, [P.UT]);
    const now = (await db.query(`select updated_at from public.turn_projects where id = $1`, [P.UT])).rows[0].updated_at;
    return { was, now };
  });
  ok("A: an owner's save still bumps updated_at after the migration", bumped.ok && bumped.value.now > bumped.value.was, bumped);
}
{
  const inv = await runSql(db, source("admin-inventory.sql"));
  ok("A: admin-inventory.sql re-runs after the migration (rollout step 2)", inv.ok, inv.error);
  const files = await q(db, `select count(*)::int n from turn_admin.files`);
  ok("A: its views still read the bucket", files[0].n >= Object.keys(L).length, files);
  const res = (inv.last.rows || []).find((x) => x.item === "Readable storage folders: access helpers and rules are current");
  ok("A: ...and its RESULT row 126 (the read-only stale-copy check) reads 'ok'", res && res.status === "ok", res);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A2. Readable keys
   ═══════════════════════════════════════════════════════════════════════════ */
section("A2: readable keys");
const readableAfter = await matrix(db, R);
const twinDiff = matrixDiff(legacyAfter, readableAfter);
ok("A2: the readable twin of every key answers exactly like the key itself, for every role and operation",
  twinDiff.length === 0, twinDiff.slice(0, 20));
ok("A2: e.g. owner and art director reserve and upload readable keys; writer, view-only, outsider and anon cannot",
  readableAfter["owner fSheet"].reserve === "ok" && readableAfter["owner fSheet"].insert === "ok"
  && readableAfter["artDirector fBobProp"].reserve === "ok" && readableAfter["artDirector fBobProp"].insert === "ok"
  && ["writer", "viewOnly", "outsider", "anon"].every((w) => readableAfter[w + " fSheet"].insert !== "ok" && readableAfter[w + " fSheet"].reserve !== "ok"),
  readableAfter["artDirector fBobProp"]);

const PF = P.F;
const upload = (seg1, seg2, file = "character/neo/20260110-100000-sheet-aaaa1111.png") => `${seg1}/${seg2}/${file}`;
async function tryUpload(who, path, projectId = PF) {
  return session(db, who, async () => ({
    insert: await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [path]),
    reserve: await attempt(db, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [projectId, path]),
  }));
}
const refused = (t) => !t.insert.ok && /row-level security/.test(t.insert.error) && !t.reserve.ok && /outside the caller project scope/.test(t.reserve.error);
const accepted = (t) => t.insert.ok && t.reserve.ok;
{
  const spoofs = [
    [U.bob, `bob--${A}`, "Bob, his own handle on Alice's id"],
    [U.bob, `alice-owner--${A}`, "Bob, Alice's handle and id"],
    [U.alice, `alice-owner--${B}`, "Alice, her handle on Bob's id"],
    [U.alice, `alice-owner--${DV}`, "Alice, her handle on Dave's id"],
    [U.bob, A, "Bob, Alice's bare id"],
  ];
  const bad = [];
  for (const [who, seg1, label] of spoofs) {
    const t = await tryUpload(who, upload(seg1, `neon-harbor--${PF}`));
    if (!refused(t)) bad.push(label + ": " + JSON.stringify(t));
  }
  ok("A2: nobody can write or reserve under another account's id, whatever handle the folder shows", bad.length === 0, bad);
  const own = await tryUpload(U.bob, upload(`alice-owner--${B}`, `neon-harbor--${PF}`));
  ok("A2: a label is display text only — Bob may label his OWN folder with any valid handle (the documented format-only rule)", accepted(own), own);
}
{
  const bad = [];
  const good1 = await tryUpload(U.alice, upload(`alice-owner--${A}`, `daves-film--${PF}`));
  if (!accepted(good1)) bad.push("label daves-film on Alice's project id refused: " + JSON.stringify(good1));
  const other = await tryUpload(U.alice, upload(`alice-owner--${A}`, `neon-harbor--${P.D}`), P.D);
  if (!(!other.insert.ok && !other.reserve.ok && /write access/.test(other.reserve.error))) bad.push("Dave's project id under Alice's label accepted: " + JSON.stringify(other));
  const mismatch = await tryUpload(U.alice, upload(`alice-owner--${A}`, `neon-harbor--${P.E2}`), PF);
  if (!(!mismatch.reserve.ok && /outside the caller project scope/.test(mismatch.reserve.error))) bad.push("reservation for F with E2's id accepted: " + JSON.stringify(mismatch.reserve));
  ok("A2: project checks read only the id (any label on the right id works; the right label on another id never does)", bad.length === 0, bad);
}
{
  const U0 = A;
  const seg1Rejects = [`Alice--${U0}`, `alice--${U0.toUpperCase()}`, `a--b--${U0}`, `--${U0}`, `alice---${U0}`, `-alice--${U0}`,
    `deadbeef--${U0}`, `deadbeef-x--${U0}`, `a11ce000-0000--${U0}`, "x".repeat(65) + "--" + U0, `a_b--${U0}`, `a.b--${U0}`, `é--${U0}`,
    U0.toUpperCase(), `{${U0}}`, U0.replace(/-/g, ""), `alice-owner--${U0}x`, `alice-owner-${U0}`, `alice-owner--`, "",
    // review 2026-09-27: another account's uuid dressed up as a label on Alice's OWN id
    `${B.replace("-", "a-")}--${U0}`, `0${B}--${U0}`, `${B.replace(/-/g, "")}--${U0}`, `x-${B}--${U0}`, `alice-20260927--${U0}`];
  const bad = [];
  for (const seg1 of seg1Rejects) {
    const t = await tryUpload(U.alice, upload(seg1, `neon-harbor--${PF}`));
    if (!refused(t)) bad.push(JSON.stringify(seg1) + " " + JSON.stringify(t));
  }
  ok(`A2: all ${seg1Rejects.length} malformed or ambiguous account folders are refused by Storage and by the reservation`, bad.length === 0, bad);
  const seg2Rejects = [`Neon--${PF}`, `a--b--${PF}`, `--${PF}`, `deadbeef--${PF}`, `neon-harbor--${PF.toUpperCase()}`, "x".repeat(65) + "--" + PF,
    `neon_harbor--${PF}`, `neon-harbor-${PF}`, "stage-tmp", "studio-previews"];
  const bad2 = [];
  for (const seg2 of seg2Rejects) {
    const t = await tryUpload(U.alice, upload(`alice-owner--${A}`, seg2));
    if (!(!t.insert.ok && !t.reserve.ok && /outside the caller project scope/.test(t.reserve.error))) bad2.push(JSON.stringify(seg2) + " " + JSON.stringify(t));
  }
  ok(`A2: all ${seg2Rejects.length} malformed project folders (and the service folders) are refused`, bad2.length === 0, bad2);
  const longOk = await tryUpload(U.alice, upload("x".repeat(64) + "--" + A, "y".repeat(64) + "--" + PF));
  ok("A2: 64-character labels (the grammar's limit) are accepted", accepted(longOk), longOk);
}
{
  const fn = async (sql, p) => (await q(db, sql, [p]))[0].r;
  const checks = [
    [await fn(`select public.turn_storage_project_id($1) r`, R.stageTmp), null, "readable stage-tmp has no project"],
    [await fn(`select public.turn_storage_uid($1) r`, R.stageTmp), A, "readable stage-tmp belongs to its account"],
    [await fn(`select public.turn_storage_project_id($1) r`, R.studioPrev), null, "readable studio-preview has no project (folder 2 is studio-previews)"],
    [await fn(`select public.turn_storage_uid($1) r`, INTERNAL[0]), null, "_internal never resolves an account"],
    [await fn(`select public.turn_storage_uid($1) r`, INTERNAL[1]), null, "blender-studio-internal never resolves an account"],
    [await fn(`select public.turn_storage_project_id($1) r`, `alice-owner--${A}/studio-previews--${PF}/x/y.png`), PF, "a project NAMED studio-previews is a project (different string)"],
  ];
  const bad = checks.filter(([got, want]) => got !== want).map(([got, want, label]) => `${label}: ${got} ≠ ${want}`);
  ok("A2: service folders never resolve a project, internal folders never resolve an account", bad.length === 0, bad);
}
{
  // Show / Episode deletion: readable keys are authorized and granted with the right project, only for the owner.
  const lc = lifecycleAfter;
  ok("A2: deleting an Episode authorizes its readable and legacy keys (generation history and cameo angles alike)",
    [RX.e2New, RX.e2CamL, L.e2Shot, L.e2ShotOld, L.e2Cam].every((p) => lc.episode.authorized.includes(p))
    && lc.episode.grants.filter((g) => !isLegacy(g.path)).every((g) => g.project_id === P.E2) && lc.episode.aliceMay.every(Boolean), lc.episode);
  ok("A2: deleting the Show authorizes readable keys under the Show's folder too, with the Show's id on the grant",
    lc.show.authorized.includes(RX.sRef) && lc.show.grants.find((g) => g.path === RX.sRef)?.project_id === P.S && lc.show.aliceMay.every(Boolean), lc.show);
  const bobGrant = await as(db, U.bob, async () => (await db.query(`select public.turn_can_delete_asset_path($1) r`, [RX.e2New])).rows[0].r);
  ok("A2: (sanity) without the grant, a readable key of a live project follows the normal rule", bobGrant.ok && bobGrant.value === true, bobGrant);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A3. Helper equivalence (old vs new), legacy corpus + fuzz
   ═══════════════════════════════════════════════════════════════════════════ */
section("A3: old vs new helpers over a legacy corpus and 5,000 fuzzed paths");
{
  const pre = source("pre:team-collaboration.sql");
  const oldFn = pre.slice(pre.indexOf("create or replace function public.turn_storage_project_id(path text)"));
  const oldText = oldFn.slice(0, oldFn.indexOf("$$;", oldFn.indexOf("as $$") + 5) + 3).replace("public.turn_storage_project_id(", "public.old_turn_storage_project_id(");
  ok("A3: the frozen pre-change turn_storage_project_id is the plpgsql folders[2]::uuid version", /language plpgsql/.test(oldText) && /folders\[2\]::uuid/.test(oldText), oldText);
  await db.exec(oldText);
  let seed = 20260927;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
  const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  const mixCase = (s) => [...s].map((c) => (rnd() < 0.5 ? c.toUpperCase() : c)).join("");
  const regroup = (u) => { const h = u.replace(/-/g, ""); let o = ""; for (let i = 0; i < 32; i += 4) { o += h.slice(i, i + 4); if (i < 28 && rnd() < 0.5) o += "-"; } return o; };
  const label = () => pick(["admin", "pine-soot", "a", "x".repeat(64), "deadbee1", "user-admin", "u-1234567", "p-deadbee", "wai-suk-ying", "untitled", "0", "9-9"]);
  const badLabel = () => pick(["Admin", "a--b", "", "-a", "a-", "deadbeef", "deadbeef-x", "deadbeef1", "u-12345678", "take-20260927", "b2444e18-5133", "x".repeat(65), "a_b", "a.b", "é", "a b", "{a}"]);
  const SEG = [
    () => uuid(), () => uuid().toUpperCase(), () => mixCase(uuid()), () => "{" + uuid() + "}", () => "{" + mixCase(regroup(uuid())) + "}",
    () => uuid().replace(/-/g, ""), () => regroup(uuid()), () => mixCase(regroup(uuid())), () => "{" + regroup(uuid()), () => regroup(uuid()) + "}",
    () => uuid().slice(1), () => uuid() + pick(["0", "-", " ", "g", "}"]), () => " " + uuid(), () => uuid().replace("-", "--"),
    () => "-" + uuid().replace(/-/g, ""), () => uuid().replace(/-/g, "") + "-",
    () => label() + "--" + uuid(), () => label() + "--" + uuid().toUpperCase(), () => badLabel() + "--" + uuid(), () => label() + "---" + uuid(),
    () => label() + "--" + uuid().replace(/-/g, ""), () => label() + "--{" + uuid() + "}",
    () => pick(["stage-tmp", "studio-previews", "_internal", "blender-studio-internal", "", ".", "..", "series-migration", "cameo", "character"]),
    () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick([..."abcdef0123456789-{}_ .XZ"])).join(""),
  ];
  const fuzz = [];
  while (fuzz.length < 5000) {
    const n = 1 + Math.floor(rnd() * 5);
    let p = Array.from({ length: n }, () => pick(SEG)()).join("/");
    if (rnd() < 0.1) p += "/";
    if (rnd() < 0.05) p = "/" + p;
    fuzz.push(p);
  }
  const corpus = [...Object.values(L), ...INTERNAL, `${A}/${P.F}`, `${A}/${P.F}/`, `${A}/${P.F}/x`, A, `${A}/`, ""];
  await db.query(`create temp table fz(p text)`);
  await db.query(`insert into fz select unnest($1::text[])`, [[...corpus, ...fuzz]]);
  const [cmp] = await q(db, `
    with v as (
      select p, public.old_turn_storage_project_id(p) old_pid, public.turn_storage_project_id(p) new_pid,
             coalesce(public.turn_storage_segment_id(split_part(p, '/', 1)),
                      case when split_part(p, '/', 1) ~* '^(\\{[0-9a-f]{4}(-?[0-9a-f]{4}){7}\\}|[0-9a-f]{4}(-?[0-9a-f]{4}){7})$'
                           then split_part(p, '/', 1)::uuid end,
                      'b2444e18-5133-4155-bb2f-d2719dcdb442'::uuid) u
        from fz)
    select count(*)::int total,
           count(*) filter (where old_pid is not null)::int old_resolved,
           count(*) filter (where old_pid is not null and new_pid is distinct from old_pid)::int changed,
           count(*) filter (where old_pid is null and new_pid is not null)::int widened,
           count(*) filter (where old_pid is null and new_pid is not null
                              and public.turn_storage_segment_id(split_part(p, '/', 2)) is null)::int widened_not_readable,
           count(*) filter (where split_part(p, '/', 1) not like '%--%'
                              and coalesce((storage.foldername(p))[1] = u::text, false)
                                  is distinct from coalesce(public.turn_storage_uid(p) = u, false))::int uid_changed,
           count(*) filter (where coalesce((storage.foldername(p))[1] = u::text, false))::int uid_old_matches,
           count(*) filter (where split_part(p, '/', 1) like '%--%' and public.turn_storage_uid(p) = u)::int uid_readable
      from v`);
  ok(`A3: ${cmp.total} inputs; wherever the old turn_storage_project_id resolved (${cmp.old_resolved}), the new one returns the same id`,
    cmp.total === corpus.length + 5000 && cmp.old_resolved > 500 && cmp.changed === 0, cmp);
  ok(`A3: the new one only adds readable folders (${cmp.widened} newly resolved, all of them grammar-valid 'label--uuid')`,
    cmp.widened > 100 && cmp.widened_not_readable === 0, cmp);
  ok(`A3: turn_storage_uid gives exactly the old folder-1 rule's answer for every non-readable path (${cmp.uid_old_matches} matches)`,
    cmp.uid_changed === 0 && cmp.uid_old_matches > 100 && cmp.uid_readable > 100, cmp);
  await db.exec(`drop table fz; drop function public.old_turn_storage_project_id(text)`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A4. Project folder names
   ═══════════════════════════════════════════════════════════════════════════ */
section("A4: project folder names (turn_projects.storage_slug)");
{
  const slugs = Object.fromEntries((await q(db, `select id, storage_slug from public.turn_projects`)).map((r) => [r.id, r.storage_slug]));
  ok("A4: the backfill named every real title and left placeholders null",
    slugs[P.F] === "neon-harbor" && slugs[P.S] === "pine-soot-show" && slugs[P.E1] === "pine-soot" && slugs[P.E2] === "pine-soot-e02"
    && slugs[P.D] === "dave-s-film" && slugs[P.UT] === null, slugs);
  const fnCases = [["Straße Øresund Łódź æon", "strasse-oresund-lodz-aeon"], ["Crème Brûlée", "creme-brulee"], ["Pine Soot — E02", "pine-soot-e02"],
    ["日本語の映画", "project"], ["Untitled film — Show", null], ["Untitled film — E02", null], ["Untitled film", null], ["   ", null], [null, null],
    ["Deadbeef", "project"], ["12345678-go", "go"], ["Take 20260927", "take"], ["X B2444E18 5133 4155 BB2F D2719DCDB442", "x-5133-4155-bb2f"],
    ["Cafe Babe 1234567", "cafe-babe-1234567"], ["The Matrix", "the-matrix"], ["Untitled", null], ["Untitled Road", "untitled-road"],
    ["M".repeat(60), "m".repeat(40)], ["A".repeat(60), "project"], ["ﬁn — ①", "fin-1"]];
  const bad = [];
  for (const [title, want] of fnCases) {
    const got = (await q(db, `select public.turn_storage_project_slug($1) s`, [title]))[0].s;
    if (got !== want) bad.push(`${JSON.stringify(title)} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
  ok(`A4: turn_storage_project_slug gives the documented names (${fnCases.length} cases)`, bad.length === 0, bad);
  const slugGrammar = await q(db, `select count(*)::int n from unnest($1::text[]) t where public.turn_storage_segment_id(
                                     public.turn_storage_project_slug(t) || '--${P.F}') is distinct from '${P.F}'::uuid
                                     and public.turn_storage_project_slug(t) is not null`,
    [["20260927", "Deadbeef Cafe 12345678", "a1b2c3d4e5f6a7b8", "ÉTÉ 0123456789abcdef", "x".repeat(80), "b2444e1-85133-4155-bb2f-d2719dcdb442"]]);
  ok("A4: every derived project name is a valid label (hex runs of 8+ are dropped before the name is used)", slugGrammar[0].n === 0, slugGrammar);

  const NEW = "f3000000-0000-4000-8000-000000000003";
  const ins = await affected(db, U.alice, `insert into public.turn_projects(id, owner, title, storage_slug) values ($1, $2, 'Untitled film', 'hacked')`, [NEW, A], { commit: true });
  const s0 = (await q(db, `select storage_slug from public.turn_projects where id = $1`, [NEW]))[0].storage_slug;
  ok("A4: a new \"Untitled film\" gets no name, and a client-supplied storage_slug on insert is ignored", ins.ok && s0 === null, [ins, s0]);
  const folders0 = await rows(db, U.alice, `select public.turn_storage_folders(p_project_id => $1) r`, [NEW]);
  ok("A4: while it is untitled, its folder is untitled--{id}", folders0.ok && folders0.value[0].r.project === "untitled--" + NEW, folders0);
  const setWhileUntitled = await affected(db, U.alice, `update public.turn_projects set storage_slug = 'hacked' where id = $1`, [NEW], { commit: true });
  ok("A4: setting storage_slug directly while untitled is ignored",
    setWhileUntitled.ok && (await q(db, `select storage_slug from public.turn_projects where id = $1`, [NEW]))[0].storage_slug === null);
  await affected(db, U.alice, `update public.turn_projects set title = 'Pine Soot Two' where id = $1`, [NEW], { commit: true });
  const s1 = (await q(db, `select storage_slug from public.turn_projects where id = $1`, [NEW]))[0].storage_slug;
  ok("A4: the first real title names the folder", s1 === "pine-soot-two", s1);
  await affected(db, U.alice, `update public.turn_projects set title = 'Something Else Entirely' where id = $1`, [NEW], { commit: true });
  const hack = await affected(db, U.alice, `update public.turn_projects set storage_slug = 'hacked' where id = $1`, [NEW], { commit: true });
  const upsert = await affected(db, U.alice, `insert into public.turn_projects(id, owner, title, storage_slug) values ($1, $2, 'Other', 'hacked2')
                                              on conflict (id) do update set title = excluded.title, storage_slug = excluded.storage_slug`, [NEW, A], { commit: true });
  const s2 = (await q(db, `select title, storage_slug from public.turn_projects where id = $1`, [NEW]))[0];
  ok("A4: a rename, a direct update and an upsert all leave the name frozen", hack.ok && upsert.ok && s2.storage_slug === "pine-soot-two" && s2.title === "Other", [s2, hack, upsert]);
  const bobSets = await affected(db, U.bob, `update public.turn_projects set storage_slug = 'bobs-name' where id = $1`, [P.F], { commit: true });
  const carolSets = await affected(db, U.carol, `update public.turn_projects set storage_slug = 'carols-name' where id = $1`, [P.F], { commit: true });
  const fSlug = (await q(db, `select storage_slug, updated_at from public.turn_projects where id = $1`, [P.F]))[0];
  ok("A4: collaborators cannot set a project's folder name", bobSets.ok && carolSets.ok && fSlug.storage_slug === "neon-harbor", [bobSets, carolSets, fSlug]);
  const bobTitle = await affected(db, U.bob, `update public.turn_projects set title = 'Bob Title' where id = $1`, [P.F]);
  ok("A4: (and still cannot rename it, so cannot name it either)", !bobTitle.ok && /only the owner can rename/.test(bobTitle.error), bobTitle);

  // Show conversion and Episode creation through the app's RPCs
  const SR = "f4000000-0000-4000-8000-000000000004";
  await q(db, `insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Salt Road', $3)`, [SR, A, JSON.stringify(filmDoc("Salt Road"))]);
  const bible = { characters: [{ id: "neo", name: "Neo", scenes: ["s1"], episodeScenes: { [SR]: ["s1"] } }], locations: [], props: [], lookbook: [], lookbookNote: "",
    trash: { characters: [], locations: [], props: [] } };
  const conv = await rows(db, U.alice, `select public.turn_convert_project_to_show(p_episode_id => $1, p_show_title => null, p_bible => $2, p_format => 'series') r`,
    [SR, JSON.stringify(bible)], { commit: true });
  const showId = conv.ok && conv.value[0].r.show.id;
  const created = conv.ok && await rows(db, U.alice, `select public.turn_create_show_episode(p_show_id => $1, p_episode_doc => $2, p_request_id => $3) r`,
    [showId, JSON.stringify(emptyEpisode(null, null, "")), "3d0c1f5e-7a2b-4c9d-8e1f-5a6b7c8d9e0f"], { commit: true });
  const epId = created && created.ok && created.value[0].r.episode.id;
  const fam = Object.fromEntries((await q(db, `select id, title, storage_slug from public.turn_projects where id = any($1)`, [[SR, showId, epId].filter(Boolean)])).map((r) => [r.id, r]));
  ok("A4: converting \"Salt Road\" names the Show salt-road-show; its new Episode is salt-road-e02; Episode 1 keeps salt-road",
    fam[showId]?.storage_slug === "salt-road-show" && fam[epId]?.storage_slug === "salt-road-e02" && fam[SR]?.storage_slug === "salt-road",
    { conv: conv.error, created: created && created.error, fam });
  const con = await q(db, `select convalidated, pg_get_constraintdef(oid) def from pg_constraint where conname = 'turn_projects_storage_slug_check'`);
  ok("A4: the storage_slug check constraint exists and is validated", con.length === 1 && con[0].convalidated === true, con);
  const badHandles = [];
  for (const h of ["u-12345678", "Admin", "a--b", "x".repeat(33), "b2444e18a-5133"]) {
    const r = await runSql(db, `insert into public.turn_storage_accounts(user_id, handle) values ('${P.GONE}', '${h}')`);
    if (r.ok || !/turn_storage_accounts_handle_check|violates foreign key/.test(r.error)) badHandles.push(h + ": " + (r.ok ? "accepted" : r.error));
  }
  {
    // with a real user row, only the check constraint can refuse (not the foreign key)
    const r = await runSql(db, `update public.turn_storage_accounts set handle = 'u-12345678' where user_id = '${A}'`);
    if (r.ok || !/turn_storage_accounts_handle_check/.test(r.error)) badHandles.push("update to u-12345678: " + (r.ok ? "accepted" : r.error));
    const r2 = await runSql(db, `update public.turn_storage_accounts set handle = 'john-2026' where user_id = '${A}'; update public.turn_storage_accounts set handle = 'alice-owner' where user_id = '${A}'`);
    if (!r2.ok) badHandles.push("a valid handle was refused: " + r2.error);
  }
  ok("A4: the handles table's constraint refuses a handle that would break the grammar (8 hex digits in a row, capitals, '--', over 32)", badHandles.length === 0, badHandles);
  const badSlug = await runSql(db, `update public.turn_projects set storage_slug = 'Bad Slug' where false; alter table public.turn_projects disable trigger turn_projects_storage_slug;
                                    update public.turn_projects set storage_slug = 'take-20260927' where id = '${P.UT}'`);
  await db.exec(`alter table public.turn_projects enable trigger turn_projects_storage_slug`);
  ok("A4: the constraint refuses a name that would break the grammar, even with the trigger off", !badSlug.ok && /turn_projects_storage_slug_check/.test(badSlug.error), badSlug);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A5. Account handles and the folder RPCs
   ═══════════════════════════════════════════════════════════════════════════ */
section("A5: account handles and the folder RPCs");
{
  const acc = Object.fromEntries((await q(db, `select user_id, handle from public.turn_storage_accounts`)).map((r) => [r.user_id, r.handle]));
  const users = (await q(db, `select count(*)::int n from auth.users`))[0].n;
  ok("A5: the backfill made exactly one handle per existing account", Object.keys(acc).length === users, { handles: Object.keys(acc).length, users });
  const bad = HANDLE_CASES.filter(([id, , want]) => acc[id] !== want).map(([id, email, want]) => `${email} → ${acc[id]} (want ${want})`);
  if (acc[A] !== "alice-owner") bad.push(`Alice → ${acc[A]}`);
  ok(`A5: handles follow the documented derivation (${HANDLE_CASES.length + 1} accounts: +tag and domain dropped, accents folded, non-Latin → account, reserved → user-, UUID-like → u-)`,
    bad.length === 0, bad);
  const fnBad = [];
  for (const [email, want] of [["Alex.Smith+turn@x.com", "alex-smith"], ["", "account"], ["noat", "noat"], ["m".repeat(70) + "@x.com", "m".repeat(32)], ["a".repeat(70) + "@x.com", "account"],
    ["deadbeef@x.com", "account"], ["john.20260101@x.com", "john"], ["b2444e18a-5133-4155-bb2f-d2719dcdb442@evil.test", "5133-4155-bb2f"],
    ["admin12345678@gmail.com", "user-admin"], ["ROOT@infinitestudioai.com", "root"], ["root@infinitestudioai.co", "user-root"], ["---@x.com", "account"]]) {
    const got = (await q(db, `select public.turn_storage_account_handle($1) h`, [email]))[0].h;
    if (got !== want) fnBad.push(`${email} → ${got} (want ${want})`);
  }
  ok("A5: turn_storage_account_handle edge cases", fnBad.length === 0, fnBad);

  const f1 = await rows(db, U.alice, `select public.turn_storage_folders(p_project_id => $1) r`, [P.F]);
  ok("A5: turn_storage_folders answers the owner with her account and project folders",
    f1.ok && JSON.stringify(f1.value[0].r) === JSON.stringify({ v: 1, account: "alice-owner--" + A, project: "neon-harbor--" + P.F }), f1);
  const f2 = await rows(db, U.vera, `select public.turn_storage_folders(p_project_id => $1) r`, [P.E2]);
  ok("A5: ...and a view-only member of the Show, for an Episode (inherited access)", f2.ok && f2.value[0].r.project === "pine-soot-e02--" + P.E2
    && f2.value[0].r.account === "vera--" + U.vera.id, f2);
  const f3 = await rows(db, U.alice, `select public.turn_storage_folders(p_project_id => null) r`);
  ok("A5: ...and with no project, just the account folder", f3.ok && f3.value[0].r.project === null && f3.value[0].r.account === "alice-owner--" + A, f3);
  const out = await rows(db, U.dave, `select public.turn_storage_folders(p_project_id => $1) r`, [P.F]);
  ok("A5: an outsider asking about someone else's project gets 42501 (no project name leaks)",
    !out.ok && out.code === "42501" && /project not accessible/.test(out.error), out);
  const anonF = await rows(db, "anon", `select public.turn_storage_folders(p_project_id => $1) r`, [P.F]);
  ok("A5: anon is refused", !anonF.ok && anonF.code === "42501", anonF);
  const svcF = await rows(db, "service", `select public.turn_storage_folders(p_project_id => null) r`);
  ok("A5: turn_storage_folders needs a signed-in user (service role without a user is refused)", !svcF.ok && /sign in first/.test(svcF.error), svcF);

  await q(db, `update auth.users set email = 'totally.new@example.net' where id = $1`, [A]);
  const f4 = await rows(db, { id: A, email: "totally.new@example.net" }, `select public.turn_storage_folders(p_project_id => null) r`);
  ok("A5: an email change does not rename the account folder", f4.ok && f4.value[0].r.account === "alice-owner--" + A, f4);

  const NU = "0a000000-0000-4000-8000-0000000000aa";
  await q(db, `insert into auth.users(id, email) values ($1, 'Newcomer.Person@example.com')`, [NU]);
  ok("A5: an account created after the migration has no handle yet", (await q(db, `select count(*)::int n from public.turn_storage_accounts where user_id = $1`, [NU]))[0].n === 0);
  const nf = await rows(db, { id: NU, email: "newcomer.person@example.com" }, `select public.turn_storage_folders(p_project_id => null) r`, [], { commit: true });
  const nf2 = await rows(db, "service", `select public.turn_storage_folders_for(p_user => $1) r`, [NU], { commit: true });
  const nrows = (await q(db, `select handle from public.turn_storage_accounts where user_id = $1`, [NU]));
  ok("A5: its first call creates exactly one handle; the signed-in and service answers agree (repeat calls never add rows)",
    nf.ok && nf2.ok && nf.value[0].r.account === "newcomer-person--" + NU && nf2.value[0].r.account === nf.value[0].r.account && nrows.length === 1, [nf, nf2, nrows]);

  const svc = await rows(db, "service", `select public.turn_storage_folders_for(p_user => $1, p_project_id => $2) r`, [A, P.UT]);
  ok("A5: turn_storage_folders_for (service role) answers for any account and project, untitled--{id} while unnamed",
    svc.ok && svc.value[0].r.account === "alice-owner--" + A && svc.value[0].r.project === "untitled--" + P.UT, svc);
  const svcMissing = await rows(db, "service", `select public.turn_storage_folders_for(p_user => $1, p_project_id => $2) r`, [A, P.GONE]);
  ok("A5: ...a deleted project is P0002", !svcMissing.ok && svcMissing.code === "P0002", svcMissing);
  const svcUnknown = await rows(db, "service", `select public.turn_storage_folders_for(p_user => $1) r`, ["0b000000-0000-4000-8000-0000000000bb"]);
  ok("A5: ...an unknown account gets a null account folder (callers fall back to legacy keys)", svcUnknown.ok && svcUnknown.value[0].r.account === null, svcUnknown);
  const authFor = await rows(db, U.alice, `select public.turn_storage_folders_for(p_user => $1) r`, [A]);
  ok("A5: a signed-in user cannot call turn_storage_folders_for", !authFor.ok && /permission denied/.test(authFor.error), authFor);
  const ownerNoJwt = await runSql(db, `select public.turn_storage_folders_for(p_user => '${A}')`);
  ok("A5: ...and even the table owner without a service-role JWT is refused by the function itself",
    !ownerNoJwt.ok && /service role required/.test(ownerNoJwt.error), ownerNoJwt);
  // put Alice's email back for the rest of the test
  await q(db, `update auth.users set email = $2 where id = $1`, [A, U.alice.email]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   A6. Rights
   ═══════════════════════════════════════════════════════════════════════════ */
section("A6: rights");
{
  const created = [...new Set([...MIGRATION.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]))].sort();
  const expect = {
    turn_storage_segment_id: [true, true, true], turn_storage_uid: [true, true, true], turn_storage_project_id: [true, true, true],
    turn_can_delete_asset_path: [true, true, null], turn_begin_asset_upload: [false, true, null],
    turn_storage_folders: [false, true, null], turn_storage_folders_for: [false, false, true],
    turn_storage_slugify: [false, false, null], turn_storage_account_handle: [false, false, null], turn_storage_project_slug: [false, false, null],
    turn_storage_account_folder: [false, false, null], turn_projects_storage_slug: [false, false, null],
  };
  ok("A6: the rights table below covers every function the migration creates", JSON.stringify(created) === JSON.stringify(Object.keys(expect).sort()), created);
  const priv = await q(db, `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                                   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                                   has_function_privilege('service_role', p.oid, 'EXECUTE') svc
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [created]);
  const bad = [];
  for (const r of priv) {
    const [an, au, sv] = expect[r.proname];
    if (r.anon !== an) bad.push(`${r.proname}: anon ${r.anon}`);
    if (r.auth !== au) bad.push(`${r.proname}: authenticated ${r.auth}`);
    if (sv !== null && r.svc !== sv) bad.push(`${r.proname}: service_role ${r.svc}`);
  }
  ok("A6: EXECUTE: helpers for every API role; folders RPC for signed-in users; folders_for for the service role; name derivation and internals for no API role",
    bad.length === 0 && priv.length === created.length, bad);
  const tbl = await q(db, `select r, has_table_privilege(r, 'public.turn_storage_accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') any
                             from unnest(array['anon','authenticated']) r`);
  const rls = await q(db, `select relrowsecurity from pg_class where oid = 'public.turn_storage_accounts'::regclass`);
  ok("A6: turn_storage_accounts: RLS on, no rights for anon or authenticated", tbl.every((r) => r.any === false) && rls[0].relrowsecurity === true, [tbl, rls]);
  const peek = await rows(db, U.alice, `select * from public.turn_storage_accounts`);
  const derive = await rows(db, U.alice, `select public.turn_storage_account_handle('x@y.z')`);
  ok("A6: a signed-in user can neither read the handles table nor call the derivation", !peek.ok && /permission denied/.test(peek.error)
    && !derive.ok && /permission denied/.test(derive.error), [peek.error, derive.error]);
}

/* ── A2 (continued): intents, queue and commit triggers with readable keys ── */
section("A2: upload intents, cleanup queue and commit triggers with readable keys");
{
  const bobUp = `bob--${B}/neon-harbor--${P.F}/prop/lamp/20260111-100000-sheet-v2-bbbb1111.png`;
  const beg = await rows(db, U.bob, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [P.F, bobUp], { commit: true });
  const put = await affected(db, U.bob, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [bobUp], { commit: true });
  const intent = await q(db, `select project_id, uploader from public.turn_asset_upload_intents where path = $1`, [bobUp]);
  const gen = await affected(db, U.bob, `update public.turn_generations set storage_path = $1 where project_id = $2 and entity_id = 'lamp'`, [bobUp, P.F], { commit: true });
  ok("A2: an art director's readable reservation records the right project; committing the generation retires it",
    beg.ok && put.ok && intent[0]?.project_id === P.F && intent[0]?.uploader === B && gen.ok && gen.value === 1
    && (await q(db, `select count(*)::int n from public.turn_asset_upload_intents where path = $1`, [bobUp]))[0].n === 0, [beg.error, put.error, intent, gen]);
  const camUp = `bob--${B}/neon-harbor--${P.F}/cameo/trin/20260111-100000-left-bbbb2222.png`;
  await rows(db, U.bob, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [P.F, camUp], { commit: true });
  const cam = await affected(db, U.bob, `update public.turn_cameos set angles = angles || $1::jsonb where project_id = $2 and char_id = 'trin'`,
    [JSON.stringify([{ label: "left", storage_path: camUp }]), P.F], { commit: true });
  ok("A2: saving a cameo angle retires its readable reservation", cam.ok && cam.value === 1
    && (await q(db, `select count(*)::int n from public.turn_asset_upload_intents where path = $1`, [camUp]))[0].n === 0, cam);

  const expired = `alice-owner--${A}/neon-harbor--${P.F}/shot/s-9/20260111-100000-sheet-aaaa3333.png`;
  await q(db, `insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at) values ($1, $2, $3, now() - interval '2 hours', now() - interval '1 hour')`, [expired, P.F, A]);
  await rows(db, U.alice, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`,
    [P.F, `alice-owner--${A}/neon-harbor--${P.F}/shot/s-9/20260111-110000-sheet-aaaa3334.png`], { commit: true });
  const moved = await q(db, `select project_id, uploader, reason from public.turn_asset_cleanup_queue where path = $1`, [expired]);
  ok("A2: an expired readable reservation moves to the cleanup queue with its project and uploader",
    moved.length === 1 && moved[0].project_id === P.F && moved[0].uploader === A && moved[0].reason === "abandoned_upload", moved);

  const e2Up = `alice-owner--${A}/pine-soot-e02--${P.E2}/shot/shot-7/20260111-100000-sheet-aaaa4444.png`;
  const r1b = await rows(db, U.alice, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [P.E2, e2Up], { commit: true });
  await affected(db, U.alice, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [e2Up], { commit: true });
  const delEp = await rows(db, U.alice, `select public.turn_delete_show_episode(p_episode_id => $1) r`, [P.E2], { commit: true });
  const queued = await q(db, `select project_id, reason from public.turn_asset_cleanup_queue where path = $1`, [e2Up]);
  ok("A2: deleting the Episode queues its unfinished readable upload (project_deleted, the Episode's id)",
    r1b.ok && delEp.ok && queued[0]?.project_id === P.E2 && queued[0]?.reason === "project_deleted", [r1b.error, delEp.error, queued]);
  const grantRows = await q(db, `select path, project_id from public.turn_asset_cleanup_grants where project_id = $1 order by path`, [P.E2]);
  ok("A2: the committed Episode delete left exact-path grants for its readable keys", [RX.e2New, RX.e2CamL].every((p) => grantRows.some((g) => g.path === p)), grantRows);
  const mayQueued = await rows(db, U.alice, `select public.turn_can_delete_asset_path($1) r`, [e2Up]);
  const bobQueued = await rows(db, U.bob, `select public.turn_can_delete_asset_path($1) r`, [e2Up]);
  ok("A2: the uploader holds the delete right on her queued readable key after the project is gone; nobody else does",
    mayQueued.ok && mayQueued.value[0].r === true && bobQueued.ok && bobQueued.value[0].r === false, [mayQueued, bobQueued]);
  await q(db, `update public.turn_asset_cleanup_queue set available_at = now() - interval '1 minute' where path = $1`, [e2Up]);
  const claim = await rows(db, "service", `select * from public.turn_claim_asset_cleanup_batch(p_limit => 50)`, [], { commit: true });
  const lease = claim.ok && claim.value.find((r) => r.path === e2Up);
  const done = lease && await rows(db, "service", `select public.turn_complete_asset_cleanup(p_path => $1, p_lease_token => $2, p_confirmed_removed => true) r`,
    [e2Up, lease.lease_token], { commit: true });
  ok("A2: the service-role cleanup worker leases and completes a readable key like any other",
    !!lease && lease.project_id === P.E2 && done.ok && done.value[0].r === true
    && (await q(db, `select count(*)::int n from public.turn_asset_cleanup_queue where path = $1`, [e2Up]))[0].n === 0, [claim.error, lease, done]);
  const fin = await rows(db, U.alice, `select public.turn_finish_asset_cleanup(p_project_ids => $1) r`, [[P.E2]], { commit: true });
  ok("A2: finishing the cleanup releases the readable grants", fin.ok && fin.value[0].r >= 2
    && (await q(db, `select count(*)::int n from public.turn_asset_cleanup_grants where project_id = $1`, [P.E2]))[0].n === 0, fin);
}
await db.close();

/* ═══════════════════════════════════════════════════════════════════════════
   B. Preflight
   ═══════════════════════════════════════════════════════════════════════════ */
async function expectStopped(label, db, patterns, { asRole = null } = {}) {
  const before = await snapshot(db);
  const hadSlugColumn = (await q(db, `select count(*)::int n from information_schema.columns where table_name = 'turn_projects' and column_name = 'storage_slug'`))[0].n;
  if (asRole) await db.exec(`set role ${asRole}`);
  const r = await runSql(db, MIGRATION);
  if (asRole) await db.exec(`reset role`);
  const stopped = !r.ok && /^TURN_STORAGE_READABLE_PREREQUISITE: storage-readable-folders\.sql stopped before changing anything/.test(r.error);
  for (const pattern of [].concat(patterns)) {
    ok(`${label}: the run stops with a TURN_STORAGE_READABLE_PREREQUISITE message naming ${pattern}`, stopped && r.error.includes(pattern), r.error);
  }
  ok(`${label}: the hint gives the run order`, stopped && /series-production\.sql, then storage-readable-folders\.sql/.test(r.hint || ""), r.hint);
  const d = diff(before, await snapshot(db));
  ok(`${label}: nothing was created or changed (columns, tables, functions, rights, rules, triggers, data)`, d.length === 0, d);
  const left = (await q(db, `select
      (select count(*) from information_schema.columns where table_name = 'turn_projects' and column_name = 'storage_slug')::int slug_col,
      (select count(*) from pg_class where relname = 'turn_storage_accounts')::int accounts,
      (select count(*) from pg_proc where proname in ('turn_storage_folders', 'turn_storage_folders_for', 'turn_storage_slugify'))::int fns`))[0];
  ok(`${label}: no storage_slug column${hadSlugColumn ? " beyond the one planted before the run" : ""}, handles table or folder RPC exists afterwards`,
    left.slug_col === hadSlugColumn && left.accounts === 0 && left.fns === 0, left);
  return r;
}
section("B1: series-production.sql never ran");
{
  const db = await newDb();
  await chain(db, PROD_BEFORE_SERIES);
  await seedCore(db);
  await expectStopped("B1", db, ["missing table public.turn_asset_upload_intents (run series-production.sql first)",
    "missing function public.turn_begin_asset_upload(uuid,text) (run series-production.sql first)",
    "the Storage rule \"turn assets delete collab\" is missing or not the exact-path one"]);
  await db.close();
}
section("B2: helpers with the wrong argument names; the read rule gone");
{
  const db = await productionDb();
  await db.exec(`
    drop function public.turn_can_write_assets(uuid) cascade;
    create function public.turn_can_write_assets(project uuid) returns boolean language sql stable as 'select false';
    drop function public.turn_storage_project_id(text) cascade;
    create function public.turn_storage_project_id(p text) returns uuid language sql stable as 'select null::uuid';
    drop function public.turn_can_delete_asset_path(text) cascade;
    create function public.turn_can_delete_asset_path(p_path text) returns boolean language sql stable as 'select false';`);
  await expectStopped("B2", db, ["public.turn_can_write_assets(uuid) must have the arguments {pid}",
    "public.turn_storage_project_id(text) must have the arguments {path}", "public.turn_can_delete_asset_path(text) must have the arguments {path}",
    "missing Storage rule \"turn assets read collab\""]);
  const series = await runSql(db, source("series-production.sql"));
  ok("B2: series-production.sql's own guard also refuses a turn_storage_project_id with another argument name",
    !series.ok && /TURN_SERIES_PREREQUISITE/.test(series.error)
    && series.error.includes("public.turn_storage_project_id(text) must have the argument (path) and return uuid"), series.error);
  await db.close();
}
section("B3: the touch trigger is missing; a bad storage_slug column already exists");
{
  const db = await productionDb();
  await db.exec(`drop trigger turn_projects_touch on public.turn_projects;
                 alter table public.turn_projects add column storage_slug text;
                 update public.turn_projects set storage_slug = 'Not Valid' where id = '${P.F}';`);
  await expectStopped("B3", db, ["missing trigger turn_projects_touch on public.turn_projects", "1 row(s) of public.turn_projects hold a storage_slug that is not a valid folder name"]);
  await db.close();
}
section("B4: run by a role that does not own turn_projects");
{
  const db = await productionDb();
  await db.exec(`create role sql_editor nologin;
                 grant usage on schema public, auth, storage to sql_editor;
                 grant select on storage.buckets to sql_editor;`);
  await expectStopped("B4", db, "role sql_editor does not own public.turn_projects", { asRole: "sql_editor" });
  await db.close();
}
section("B5: the turn-assets bucket is missing");
{
  const db = await newDb();
  await chain(db, [...PROD_BEFORE_SERIES, "pre:series-production.sql"]);
  await db.exec(`delete from storage.buckets where id = 'turn-assets'`);
  await expectStopped("B5", db, "missing the private bucket turn-assets (run storage.sql first)");
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   C. Re-run safety
   ═══════════════════════════════════════════════════════════════════════════ */
section("C: re-running the other access files after the migration");
{
  const db = await productionDb();
  const m = await runSql(db, MIGRATION);
  ok("C: migration applied", m.ok, m.error);
  const DEFS = ["public.turn_storage_segment_id(text)", "public.turn_storage_uid(text)", "public.turn_storage_project_id(text)",
    "public.turn_begin_asset_upload(uuid,text)", "public.turn_can_delete_asset_path(text)"];
  const defs = async () => Object.fromEntries((await q(db, `select f, pg_get_functiondef(to_regprocedure(f)) d, (select array_to_string(proacl, ',') from pg_proc where oid = to_regprocedure(f)) acl
                                                             from unnest($1::text[]) f`, [DEFS])).map((r) => [r.f, r.d + " " + r.acl]));
  const rulesOf = async () => (await q(db, `select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                              and policyname in ('turn assets write collab', 'turn assets update collab') order by 1`));
  const base = await defs();
  const baseRules = await rulesOf();
  let probes = 0;
  const probe = async (label, { cameo = true } = {}) => {
    const k = `alice-owner--${A}/neon-harbor--${P.F}/character/neo/20260112-100000-sheet-c${String(++probes).padStart(7, "0")}.png`;
    const ins = await affected(db, U.alice, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [k], { commit: true });
    const res = await rows(db, U.alice, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [P.F, fresh(k)]);
    const sel = await rows(db, U.carol, `select count(*)::int n from storage.objects where name = any($1)`, [[k, R.fSheet]]);
    const del = await affected(db, U.bob, `delete from storage.objects where name = $1`, [R.fBobProp]);
    const cam = await affected(db, U.carol, `delete from storage.objects where name = $1`, [R.fCarolCam]);
    const noText = (await q(db, `select count(*)::int n from pg_policies where schemaname = 'storage'
                                    and (coalesce(qual, '') || coalesce(with_check, '')) like '%foldername(name))[1]%'`))[0].n;
    // (team-collaboration / enforce-role-scopes alone put back their own, non-exact delete rule — documented;
    //  the capturer's cameo right returns with series-production.sql, so it is checked only after that file)
    ok(`C: after ${label}: readable keys still upload, reserve, read and delete${cameo ? ", and a capturer still removes her readable cameo photo" : ""}`,
      ins.ok && ins.value === 1 && res.ok && sel.ok && sel.value[0].n === 2 && del.ok && del.value === 1 && (!cameo || (cam.ok && cam.value === 1)),
      { ins, res: res.error, sel, del, cam });
    ok(`C: after ${label}: no Storage rule compares folder 1's text`, noText === 0, noText);
    const now = await defs();
    const changed = DEFS.filter((f) => now[f] !== base[f]);
    ok(`C: after ${label}: the three helpers and both series functions are byte-identical to the migration's (definition and rights)`, changed.length === 0, changed);
    ok(`C: after ${label}: the upload rules are identical to the migration's`, JSON.stringify(await rulesOf()) === JSON.stringify(baseRules), await rulesOf());
  };
  for (const f of ["team-collaboration.sql", "enforce-role-scopes.sql", "series-production.sql"]) {
    const r = await runSql(db, source(f));
    ok(`C: re-running the current ${f} alone succeeds`, r.ok, r.error);
    await probe(f + " alone", { cameo: f === "series-production.sql" });
    if (f !== "series-production.sql") {
      const s = await runSql(db, source("series-production.sql"));   // README: always re-run series-production.sql after it
      ok(`C: ...then series-production.sql after it, as the README says`, s.ok, s.error);
      await probe(f + " + series-production.sql");
    }
  }
  for (const f of ["team-collaboration.sql", "invitations.sql", "shared-owners.sql", "enforce-role-scopes.sql", "cameos.sql", "series-production.sql"]) {
    const r = await runSql(db, source(f));
    if (!r.ok) ok(`C: README-order re-run of ${f}`, false, r.error);
  }
  await probe("the README-order re-run");
  const again = await runSql(db, MIGRATION);
  ok("C: the migration itself re-runs afterwards with RESULT rows 10-90 'ok'", resultAllOk(again).good, resultAllOk(again).bad);

  ok("C: admin-inventory.sql's read-only check (RESULT row 126) reads 'ok' on the healthy database", (await inventoryHealth(db)).status === "ok",
    await inventoryHealth(db));

  // A frozen fixture pasted by mistake stops at its first statement and changes nothing.
  {
    const before = await snapshot(db);
    const raw = await runSql(db, fixtureRaw("team-collaboration.sql"));
    const d = diff(before, await snapshot(db));
    ok("C: running a frozen fixture file as it is (e.g. pasted into the SQL Editor) stops at once with 'TEST FIXTURE — DO NOT RUN' and changes nothing",
      !raw.ok && /TEST FIXTURE — DO NOT RUN/.test(raw.error) && d.length === 0, { error: raw.error, d });
  }

  const detectNow = async () => resultRows(await runSql(db, MIGRATION_RESULT));
  const failing = (rows, ords) => ords.filter((o) => !rows[o] || rows[o].status !== "ok");
  const readableSelect = async () => rows(db, U.carol, `select count(*)::int n from storage.objects where name = $1`, [R.fSheet]);
  const readableReserve = async () => rows(db, U.alice, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`,
    [P.F, fresh(fresh(fresh(R.fSheet)))]);
  const readableCameoDelete = async () => affected(db, U.carol, `delete from storage.objects where name = $1`, [R.fCarolCam]);
  const healthy = async (label) => {
    const res = await detectNow();
    ok(`C: after ${label}: the migration's RESULT rows 10-90 read 'ok'`, failing(res, [10, 20, 30, 40, 50, 60, 70, 80, 90]).length === 0, res);
    const inv = await inventoryHealth(db);
    ok(`C: after ${label}: admin-inventory's row 126 reads 'ok'`, inv.status === "ok", inv);
  };

  // 1. A STALE pre-change team-collaboration.sql: readable files become unreadable, exactly as the README warns...
  const stale = await runSql(db, source("pre:team-collaboration.sql"));
  const lost = await readableSelect();
  const upBlocked = await affected(db, U.alice, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [fresh(fresh(R.fSheet))]);
  const det = await detectNow();
  ok("C: a stale pre-change team-collaboration.sql makes readable files unreadable and blocks readable uploads (the README warning)",
    stale.ok && lost.ok && lost.value[0].n === 0 && !upBlocked.ok, { lost, upBlocked: upBlocked.error });
  ok("C: ...the migration's RESULT rows 10 and 40, run on their own, can report it", det[10]?.status !== "ok" && det[40]?.status !== "ok", [det[10], det[40]]);
  {
    const inv = await inventoryHealth(db);
    ok("C: ...and admin-inventory's read-only row 126 names it (bare-id project helper, text upload rules) with the repair",
      /^FAIL — .*turn_storage_project_id reads bare ids only.*the upload rules do not read folder 1 through turn_storage_uid/.test(inv.status)
      && /Re-run the current storage-readable-folders\.sql/.test(inv.detail), inv);
  }
  // ...and the CURRENT series-production.sql (always run last) repairs it.
  const repair = await runSql(db, source("series-production.sql"));
  ok("C: re-running the current series-production.sql repairs it", repair.ok, repair.error);
  await probe("the repair by series-production.sql");
  await healthy("the repair by series-production.sql");

  // 2. A STALE pre-change enforce-role-scopes.sql: the upload rules compare folder 1 as text again.
  {
    const r = await runSql(db, source("pre:enforce-role-scopes.sql"));
    const up = await affected(db, U.alice, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [fresh(fresh(fresh(fresh(R.fSheet))))]);
    const res = await detectNow();
    const inv = await inventoryHealth(db);
    ok("C: a stale pre-change enforce-role-scopes.sql blocks readable uploads; RESULT row 40 and admin-inventory row 126 report it",
      r.ok && !up.ok && res[40]?.status !== "ok" && /the upload rules do not read folder 1 through turn_storage_uid/.test(inv.status), { r: r.error, up, row40: res[40], inv });
    const fix = await runSql(db, source("series-production.sql"));
    ok("C: ...and the current series-production.sql repairs that too", fix.ok, fix.error);
    await probe("repairing a stale enforce-role-scopes.sql");
    await healthy("repairing a stale enforce-role-scopes.sql");
  }

  // 3a. Just one of the two series functions out of date is caught too.
  {
    const pre = source("pre:series-production.sql");
    const at = pre.indexOf("create or replace function public.turn_can_delete_asset_path(path text)");
    const oldDelete = pre.slice(at, pre.indexOf("$$;", pre.indexOf("as $$", at) + 5) + 3);
    ok("C: (the frozen series-production.sql's delete function compares folder 1 as text)", at > 0 && /split_part\(\$1, '\/', 1\) = auth\.uid\(\)::text/.test(oldDelete), oldDelete.slice(0, 200));
    await db.exec(oldDelete);
    const res = await detectNow();
    const inv = await inventoryHealth(db);
    ok("C: an out-of-date turn_can_delete_asset_path alone turns RESULT row 50 and admin-inventory row 126 to FAIL",
      res[50]?.status !== "ok" && /turn_begin_asset_upload \/ turn_can_delete_asset_path compare folder 1 as text/.test(inv.status), [res[50], inv]);
    const fix = await runSql(db, source("series-production.sql"));
    ok("C: ...repaired by the current series-production.sql", fix.ok, fix.error);
    await healthy("repairing the delete function");
  }

  // 3. A STALE pre-change series-production.sql (the file the README says to re-run last,
  //    so the likeliest to come from an out-of-date checkout).
  {
    const r = await runSql(db, source("pre:series-production.sql"));
    const reserve = await readableReserve();
    const legacyReserve = await rows(db, U.alice, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [P.F, fresh(fresh(fresh(L.fSheet)))]);
    const cam = await readableCameoDelete();
    const legacyCam = await affected(db, U.carol, `delete from storage.objects where name = $1`, [L.fCarolCam]);
    ok("C: a stale pre-change series-production.sql refuses readable reservations and a capturer's readable cameo delete (legacy keys still work)",
      r.ok && !reserve.ok && /outside the caller project scope/.test(reserve.error) && cam.ok && cam.value === 0
      && legacyReserve.ok && legacyCam.ok && legacyCam.value === 1, { r: r.error, reserve, cam, legacyReserve, legacyCam });
    const res = await detectNow();
    ok("C: ...the migration's RESULT row 50, run on its own, turns FAIL (the only row that sees this case)",
      res[50]?.status !== "ok" && /stale series-production\.sql/.test(res[50]?.status || "") && res[40]?.status === "ok" && res[10]?.status === "ok", [res[10], res[40], res[50]]);
    const inv = await inventoryHealth(db);
    ok("C: ...and admin-inventory's row 126 names the two functions", /turn_begin_asset_upload \/ turn_can_delete_asset_path compare folder 1 as text/.test(inv.status), inv);
    const fix = await runSql(db, source("series-production.sql"));
    ok("C: ...re-running the current series-production.sql repairs it", fix.ok, fix.error);
    await probe("repairing a stale series-production.sql");
    await healthy("repairing a stale series-production.sql");
  }

  // 4. storage.sql re-run: the owner-only "… own" rules come back.
  {
    const r = await runSql(db, source("storage.sql"));
    const res = await detectNow();
    const inv = await inventoryHealth(db);
    ok("C: a storage.sql re-run brings back the owner-only rules: RESULT rows 40 and 90 turn FAIL, and admin-inventory row 126 too",
      r.ok && res[90]?.status !== "ok" && /storage\.sql was re-run/.test(res[90]?.status || "") && res[40]?.status !== "ok"
      && /a turn-assets rule still compares folder 1 as text/.test(inv.status), { r: r.error, row40: res[40], row90: res[90], inv });
    const run = await runSql(db, MIGRATION);   // the migration drops them again (its own "drop policy if exists … own" lines)
    const own = await q(db, `select policyname from pg_policies where schemaname = 'storage' and policyname like 'turn assets % own'`);
    ok("C: ...re-running storage-readable-folders.sql removes them again and reads 'ok' (rows 10-90)", resultAllOk(run).good && own.length === 0, { bad: resultAllOk(run).bad, own });
    await probe("storage.sql, then the migration");
    await healthy("storage.sql, then the migration");
  }

  // 5. Rows that guard the migration's own objects: each can turn FAIL.
  {
    const PID = "public.turn_storage_project_id(text)";
    const current = (await q(db, `select pg_get_functiondef(to_regprocedure($1)) d`, [PID]))[0].d;
    await db.exec(current.replace("~* '^(\\{[0-9a-f]{4}", "~ '^(\\{[0-9a-f]{4}"));   // the legacy fallback loses its case-insensitivity
    const broken = (await q(db, `select pg_get_functiondef(to_regprocedure($1)) d`, [PID]))[0].d;
    const res = await detectNow();
    ok("C: row 30 turns FAIL when the installed project helper resolves a real legacy key differently (e.g. an uppercase folder 2)",
      broken !== current && res[30]?.status !== "ok" && /project/.test(res[30]?.status || ""), { row30: res[30], changed: broken !== current });
    await db.exec(current);
  }
  {
    await db.exec(`alter table public.turn_projects disable trigger turn_projects_touch`);
    const res = await detectNow();
    await db.exec(`alter table public.turn_projects enable trigger turn_projects_touch`);
    ok("C: row 60 turns FAIL (and says how to fix it) when turn_projects_touch is switched off",
      /^FAIL — turn_projects_touch is switched off[\s\S]*enable trigger turn_projects_touch/.test(res[60]?.status || ""), res[60]);
    await db.exec(`alter table public.turn_projects disable trigger turn_projects_storage_slug`);
    const res2 = await detectNow();
    await db.exec(`alter table public.turn_projects enable trigger turn_projects_storage_slug`);
    ok("C: ...and when the storage_slug trigger is switched off", res2[60]?.status !== "ok", res2[60]);
  }
  {
    const NU = "0f000000-0000-4000-8000-0000000000ff";
    await q(db, `insert into auth.users(id, email) values ($1, 'late.signup@example.com')`, [NU]);
    const res = await detectNow();
    ok("C: row 70 turns FAIL when an account has no handle row (the full run backfills it)", res[70]?.status !== "ok", res[70]);
    const run = await runSql(db, MIGRATION);
    ok("C: ...and a re-run backfills it", resultAllOk(run).good, resultAllOk(run).bad);
  }
  {
    await db.exec(`grant execute on function public.turn_storage_folders_for(uuid, uuid) to authenticated`);
    const res = await detectNow();
    ok("C: row 80 turns FAIL when a signed-in user may call the service-role folders RPC", res[80]?.status !== "ok", res[80]);
    await db.exec(`revoke execute on function public.turn_storage_folders_for(uuid, uuid) from authenticated`);
    await db.exec(`grant select on public.turn_storage_accounts to authenticated`);
    const res2 = await detectNow();
    ok("C: ...or may read the handles table", res2[80]?.status !== "ok", res2[80]);
    const run = await runSql(db, MIGRATION);
    ok("C: ...and a re-run takes those rights away again", resultAllOk(run).good, resultAllOk(run).bad);
  }
  await healthy("all of the above");
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   D. Fresh install in the README order
   ═══════════════════════════════════════════════════════════════════════════ */
section("D: fresh install, README order, end to end");
{
  const db = await newDb();
  const ORDER = ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql", "shared-owners.sql", "enforce-role-scopes.sql",
    "cameos.sql", "series-production.sql", "storage-readable-folders.sql", "credits.sql", "app-config.sql", "styles.sql", "admin-inventory.sql", "admin-storage.sql"];
  const failed = [];
  let mig;
  for (const f of ORDER) {
    const r = await runSql(db, source(f));
    if (f === "storage-readable-folders.sql") mig = r;
    if (!r.ok) failed.push(f + ": " + r.error);
  }
  ok("D: every file runs in the README's fresh-install order", failed.length === 0, failed);
  ok("D: the migration's RESULT rows 10-90 read 'ok' on an empty database", mig && resultAllOk(mig).good, mig && resultAllOk(mig).bad);
  const me = { id: "0c000000-0000-4000-8000-0000000000cc", email: "Pat.Doe@example.com" };
  const pal = { id: "0d000000-0000-4000-8000-0000000000dd", email: "sam@example.com" };
  await q(db, `insert into auth.users(id, email) values ($1, $2), ($3, $4)`, [me.id, me.email, pal.id, pal.email]);
  const PID = "0e000000-0000-4000-8000-0000000000ee";
  const mk = await affected(db, me, `insert into public.turn_projects(id, owner, title) values ($1, $2, 'Untitled film')`, [PID, me.id], { commit: true });
  await affected(db, me, `insert into public.turn_project_members(project_id, owner, member_email, member_user, role) values ($1, $2, 'sam@example.com', $3, 'view_only')`, [PID, me.id, pal.id], { commit: true });
  const f0 = await rows(db, me, `select public.turn_storage_folders(p_project_id => $1) r`, [PID], { commit: true });
  await affected(db, me, `update public.turn_projects set title = 'Wái Súk-Yíng' where id = $1`, [PID], { commit: true });
  const f1 = await rows(db, me, `select public.turn_storage_folders(p_project_id => $1) r`, [PID]);
  ok("D: a new account on a new film: untitled--{id} first, the real name after the first rename",
    mk.ok && f0.ok && f0.value[0].r.account === "pat-doe--" + me.id && f0.value[0].r.project === "untitled--" + PID
    && f1.ok && f1.value[0].r.project === "wai-suk-ying--" + PID, [mk, f0, f1]);
  const key = `${f1.value[0].r.account}/${f1.value[0].r.project}/character/wai-suk-ying/20260927-101500-sheet-v1-ab12cd34.png`;
  const res = await rows(db, me, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [PID, key], { commit: true });
  const up = await affected(db, me, `insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":10}')`, [key], { commit: true });
  const gen = await affected(db, me, `insert into public.turn_generations(project_id, owner, entity_id, storage_path) values ($1, $2, 'wai-suk-ying', $3)`, [PID, me.id, key], { commit: true });
  const seen = await rows(db, pal, `select name from storage.objects where name = $1`, [key]);
  const palDel = await affected(db, pal, `delete from storage.objects where name = $1`, [key]);
  const legacyKey = `${me.id}/${PID}/character/wai-suk-ying/20260927-101600-sheet-v2-ab12cd35.png`;
  const legacyUp = await affected(db, me, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [legacyKey], { commit: true });
  const del = await affected(db, me, `delete from storage.objects where name = any($1)`, [[key, legacyKey]], { commit: true });
  ok("D: reserve → upload → record → a view-only member reads it (cannot delete) → the owner deletes both key forms",
    res.ok && up.ok && up.value === 1 && gen.ok && seen.ok && seen.value.length === 1 && palDel.ok && palDel.value === 0 && legacyUp.ok && del.ok && del.value === 2,
    { res: res.error, up, gen, seen, palDel, legacyUp, del });
  const inv = await q(db, `select count(*)::int n from turn_admin.files`);
  ok("D: admin-inventory.sql and admin-storage.sql installed after it", inv.length === 1, inv);
  await db.close();
}
section("D2: the file run before series-production.sql");
{
  const db = await newDb();
  await chain(db, ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql", "shared-owners.sql", "enforce-role-scopes.sql", "cameos.sql"]);
  await expectStopped("D2", db, "(run series-production.sql first)");
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   E. Text
   ═══════════════════════════════════════════════════════════════════════════ */
section("E: the four files agree; app calls; README");
{
  const FILES = ["team-collaboration.sql", "enforce-role-scopes.sql", "series-production.sql", "storage-readable-folders.sql"];
  const block = (text) => {
    const a = text.indexOf("-- >>> TURN storage key helpers");
    const b = text.indexOf("-- <<< end of the TURN storage key helpers");
    return a >= 0 && b > a && text.indexOf("-- >>> TURN storage key helpers", a + 1) < 0 ? text.slice(a, b) : null;
  };
  const blocks = FILES.map((f) => block(source(f)));
  ok("E: each of the four files holds the storage key helper block exactly once", blocks.every(Boolean), FILES.filter((_, i) => !blocks[i]));
  ok("E: the helper block is byte-identical in all four files", blocks.every((b) => b === blocks[0]), FILES.filter((_, i) => blocks[i] !== blocks[0]));
  const rule = (text, name) => { const m = text.match(new RegExp(`create policy "${name}" on storage\\.objects[\\s\\S]*?\\);\\n`, "g")); return m; };
  const badRules = [];
  for (const name of ["turn assets write collab", "turn assets update collab"]) {
    const texts = FILES.map((f) => rule(source(f), name));
    if (!texts.every((t) => t && t.length === 1 && t[0] === texts[0][0])) badRules.push(name + ": " + JSON.stringify(texts.map((t) => t && t.length)));
    if (!/public\.turn_storage_uid\(name\) = auth\.uid\(\)/.test(texts[0] && texts[0][0])) badRules.push(name + " does not use turn_storage_uid");
  }
  ok("E: the upload rules (write / update collab) are identical in all four files and read folder 1 through turn_storage_uid", badRules.length === 0, badRules);
  const series = source("series-production.sql");
  const body = (text, head) => { const a = text.indexOf(head); if (a < 0) return null; const s = text.indexOf("as $$", a); return text.slice(s, text.indexOf("$$;", s + 5) + 3); };
  const same = [["create or replace function public.turn_can_delete_asset_path(path text)", "create or replace function public.turn_can_delete_asset_path(path text)"],
                ["create function public.turn_begin_asset_upload(p_project_id uuid, p_path text)", "create or replace function public.turn_begin_asset_upload(p_project_id uuid, p_path text)"]]
    .filter(([s, m]) => { const x = body(series, s), y = body(MIGRATION, m); return !(x && y && x === y && /turn_storage_uid\(/.test(x)); });
  ok("E: turn_can_delete_asset_path and turn_begin_asset_upload have the same bodies in series-production.sql and the migration", same.length === 0, same);
  const code = (text) => text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");   // SQL without full-line comments
  const stillText = FILES.filter((f) => /foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/.test(code(source(f)))
    || /folders\[1\]\s+is\s+distinct\s+from\s+caller::text/.test(code(source(f))) || /split_part\(\$1,\s*'\/',\s*1\)\s*=\s*auth\.uid\(\)::text/.test(code(source(f))));
  ok("E: no access file's SQL still compares folder 1's text", stillText.length === 0, stillText);

  // RPC calls in the app and the Edge Functions (none yet: the JS half lands separately)
  const listFiles = (dir, exts) => {
    const out = [];
    const walk = (rel) => {
      for (const name of readdirSync(new URL(rel, ROOT)).sort()) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const child = rel + name;
        if (statSync(new URL(child, ROOT)).isDirectory()) walk(child + "/");
        else if (exts.some((e) => name.endsWith(e))) out.push(child);
      }
    };
    walk(dir);
    return out;
  };
  const SIG = { turn_storage_folders: { args: ["p_project_id"], required: ["p_project_id"] },
                turn_storage_folders_for: { args: ["p_user", "p_project_id"], required: ["p_user"] } };
  const calls = [];
  for (const file of [...listFiles("app/", [".js", ".jsx", ".mjs"]), ...listFiles("supabase/functions/", [".ts", ".js", ".mjs"])]) {
    const src = read(file);
    const re = /\.rpc\(\s*(["'`])(turn_storage_folders(?:_for)?)\1\s*(?:,\s*\{([^}]*)\})?/g;
    let m;
    while ((m = re.exec(src))) {
      const keys = m[3] === undefined ? [] : m[3].split(",").map((s) => s.trim().split(/\s*:/)[0].replace(/["']/g, "")).filter(Boolean);
      calls.push({ at: file + ":" + src.slice(0, m.index).split("\n").length, name: m[2], keys });
    }
  }
  const badCalls = calls.filter((c) => c.keys.some((k) => !SIG[c.name].args.includes(k)) || SIG[c.name].required.some((k) => !c.keys.includes(k)));
  ok(`E: every .rpc("turn_storage_folders…") call in app/ and supabase/functions/ sends the SQL argument names (${calls.length} call(s) found)`,
    badCalls.length === 0, badCalls);

  const fresh = README.slice(README.indexOf("**Fresh install, in order:**"));
  const order = ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql", "shared-owners.sql", "enforce-role-scopes.sql",
    "cameos.sql", "series-production.sql", "storage-readable-folders.sql", "admin-inventory.sql", "admin-storage.sql"].map((f) => fresh.indexOf("`" + f + "`"));
  ok("E: README gives the fresh-install order with storage-readable-folders.sql after series-production.sql and before admin-inventory.sql",
    order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), order);
  const lastRule = README.slice(README.indexOf("must always be the LAST"), README.indexOf("Not implemented yet"));
  ok("E: README's re-run section says the readable-folders file needs no re-run, and how a stale copy is repaired",
    /`storage-readable-folders\.sql`[\s\S]{0,120}needs no re-run/.test(lastRule) && /before 2026-09-27/.test(lastRule) && /re-run\s+the\s+current\s+`series-production\.sql`/i.test(lastRule));
  ok("E: README warns never to roll the file back once a readable key exists, and names the kill switches",
    /Never roll it back once a readable key exists/.test(README) && /turn_storage_folders_for/.test(README) && /readableStorageKeys: false/.test(README));
  ok("E: README points to a check that can really see a stale copy (admin-inventory row 126), not to this file's RESULT rows",
    /To check, read-only, at any time:\*\* run `admin-inventory\.sql`[\s\S]{0,120}row 126/.test(README)
    && !/RESULT rows 10, 40 and 50 show the problem/.test(README) && /cannot show this/.test(README));
  const rollout = README.slice(README.indexOf("### Readable storage folders: rollout, rollback and checks"), README.indexOf("## Architecture"));
  ok("E: README's rollout notes gate the functions and the app on the privacy.html sentence (owner decision O1), stage-tmp included",
    rollout.length > 500 && /owner decision O1/.test(rollout) && /privacy\.html/.test(rollout) && /stage-tmp/.test(rollout) && /fal\.ai/.test(rollout)
    && /before deploying `image-proxy`/.test(rollout));
  ok("E: README warns that rolling back or redeploying blender-bridge / image-proxy from an older checkout breaks readable relay PNGs and stage refs",
    /Edge Function rollback:\*\* never deploy `blender-bridge` or `image-proxy` from a\s+checkout without/.test(rollout)
    && /Blender result is unavailable/.test(rollout) && /never removes a replaced readable shot PNG/.test(rollout) && /sweep never lists/.test(rollout));
  ok("E: README says an old app build skips readable keys when deleting a Show or Episode, and prefers the kill switch to a Replit rollback",
    /App rollback:\*\* prefer the server kill switch/.test(rollout) && /deleting a Show or an Episode treats every\s+readable key as unsafe/.test(rollout)
    && /orphan: project deleted/.test(rollout));
  ok("E: README states exactly what the grammar guarantees about folder names (first eight characters never all hex) and what it does not",
    /first\s+eight characters are never all hex digits/.test(rollout) && /nothing about ownership/.test(rollout));
  ok("E: the migration header sends a later check to admin-inventory.sql row 126 and covers code rollbacks",
    /admin-inventory\.sql RESULT row 126/.test(MIGRATION) && /do not redeploy\s*\n?--\s*blender-bridge \/ image-proxy from a checkout without this change/.test(MIGRATION)
    && /Replit\s*\n?--\s*app rollback/.test(MIGRATION));
  ok("E: the migration header documents the grammar, the run order, the rollback policy and the kill switches",
    /KEY GRAMMAR/.test(MIGRATION) && /Run it AFTER series-production\.sql/.test(MIGRATION) && /ROLLBACK POLICY/.test(MIGRATION)
    && /revoke execute on function public\.turn_storage_folders\(uuid\) from authenticated;/.test(MIGRATION)
    && /revoke execute on function public\.turn_storage_folders_for\(uuid, uuid\) from service_role;/.test(MIGRATION));
  ok("E: storage.sql's header documents both folder forms and that only the id is checked",
    /'\{name\}--\{id\}'/.test(source("storage.sql")) && /read ONLY the\s*\n?--\s*id/.test(source("storage.sql")));
  {
    const names = readdirSync(new URL(FIXTURE_DIR, ROOT)).sort();
    ok("E: the frozen fixtures can't be mistaken for the real files: named *.4ccb774.DO-NOT-RUN.txt, no .sql file in the fixture folder",
      JSON.stringify(names) === JSON.stringify(Object.keys(FIXTURE_SHA256).map((f) => fixturePath(f).slice(FIXTURE_DIR.length)).sort())
      && names.every((n) => !/\.sql$/.test(n) && !n.includes(".sql")), names);
    const guarded = Object.keys(FIXTURE_SHA256).filter((f) => {
      const raw = fixtureRaw(f), head = raw.slice(0, raw.indexOf(FIXTURE_MARK));
      const firstStatement = head.split("\n").filter((l) => l.trim() && !/^\s*--/.test(l))[0] || "";
      return /^-- #+\n-- TEST FIXTURE — DO NOT RUN\./.test(raw) && /^do \$fixture\$ begin raise exception 'TEST FIXTURE — DO NOT RUN/.test(firstStatement);
    });
    ok("E: each fixture opens with a 'TEST FIXTURE — DO NOT RUN' banner and a statement that raises before anything else runs",
      guarded.length === 3, guarded);
    const drift = Object.entries(FIXTURE_SHA256).filter(([f, sha]) => createHash("sha256").update(fixture(f)).digest("hex") !== sha).map(([f]) => f);
    ok("E: below the guard, each fixture is byte-identical to the file at commit 4ccb774 (pinned sha256)", drift.length === 0, drift);
  }
  ok("E: the frozen fixtures are the pre-change files (folder-1 text rule, plpgsql project helper)",
    /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(source("pre:team-collaboration.sql"))
    && /folders\[1\] is distinct from caller::text/.test(source("pre:series-production.sql"))
    && /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(source("pre:enforce-role-scopes.sql")));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

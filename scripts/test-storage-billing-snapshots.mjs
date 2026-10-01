#!/usr/bin/env node
/* ============================================================================
   image-proxy's billing snapshots — the Storage rules, EXECUTED on PGlite.

   Owner decision (billing fixes, round 5): a video that image-proxy sizes or
   bills by the length it reads, and that the account could still change after
   that read (a file in the film's storage, or a `stage:` upload), is COPIED by
   image-proxy with the service role, at submit, into a server-only snapshot key.
   The proxy reads the copy's length and hands the provider a signed URL of the
   copy, so the length it billed is the length the provider gets. That only holds
   if NO signed-in user can write, overwrite, move onto, delete or list a
   snapshot. This test proves it with the real SQL files, on every Storage rule
   set production can be in:

     P1  production as it is today (schema, storage, team-collaboration,
         shared-owners, enforce-role-scopes, cameos, series-production; the three
         access files as the frozen pre-2026-09-27 copies in
         scripts/fixtures/pre-readable-folders/, as test-storage-readable-folders
         uses them);
     P2  P1 + storage-readable-folders.sql (the repo's current rules);
     P3  P2 + a storage.sql re-run (the README's documented mistake: it puts the
         owner-only "own folder" rules back until enforce-role-scopes.sql runs);
     P4  a fresh install in the README's order.

   The keys are built by image-proxy's own snapshotPath() (video-snapshots.mjs):
   _internal/video-snapshots/<13-digit ms>-<the hold's uuid>-<index>.<ext>.
   For each rule set, those keys (and two that don't exist yet: a later
   snapshot's) are probed as the render's owner,
   an art director, a writer, a view-only member, an outsider and anon, with
   every uuid in the key also made a project the render's owner owns and the art
   director may write to (so no id-reading rule can open it). Every probe must be
   refused: read / list by prefix (0 rows), insert of a new key and upsert of the
   existing one, update of its bytes' row, a move of the snapshot away, a move of
   the caller's own file ONTO a snapshot key, delete, turn_can_delete_asset_path,
   and turn_begin_asset_upload; the key helpers read no account or project out of
   a snapshot key. The service role can insert, read, update and delete. Controls
   prove the harness can see an opening: the same people CAN write their own
   film's files, and a snapshot folder placed under the account's own folder
   WOULD be writable in P3 (why the key must not start with the uid). Also shown:
   stage-tmp (device uploads, staged data URLs) is closed to the account's own
   writes on P1, P2 and P4 and open again only in P3.

   OFFLINE ONLY: no network, no Supabase project, no credentials.
     node scripts/test-storage-billing-snapshots.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { SNAPSHOT_DIR, isSnapshotPath, snapshotPath } from "../supabase/functions/image-proxy/video-snapshots.mjs";

const crashed = (e) => {
  console.log("\nFAIL (crashed) " + (e && e.message ? e.message : String(e)) + (e && e.where ? " — " + e.where : ""));
  process.exit(1);
};
process.on("unhandledRejection", crashed);
process.on("uncaughtException", crashed);

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const SUPABASE_STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
if (!SUPABASE_STUB) throw new Error("could not read SUPABASE_STUB from scripts/test-series-production-sql.mjs");
const FIXTURE_MARK = "-- ── the frozen copy starts below this line (the test strips everything above) ──\n";
function source(name) {
  if (!name.startsWith("pre:")) return read("supabase/" + name);
  const raw = read("scripts/fixtures/pre-readable-folders/" + name.slice(4).replace(/\.sql$/, "") + ".4ccb774.DO-NOT-RUN.txt");
  const at = raw.indexOf(FIXTURE_MARK);
  if (at < 0) throw new Error("fixture guard marker missing for " + name);
  return raw.slice(at + FIXTURE_MARK.length);
}

let passes = 0, failures = 0;
const ok = (name, condition, detail) => {
  if (condition) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)))); }
};
const section = (title) => console.log("\n=== " + title + " ===");

/* ── database plumbing (as in test-storage-readable-folders.mjs) ─────────── */
async function newDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  return db;
}
async function chain(db, files) {
  for (const f of files) {
    try { await db.exec(source(f)); } catch (e) { throw new Error(`${f} failed: ${e.message}`); }
  }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
function claimsFor(who) {
  if (who === "anon") return { claims: { role: "anon" }, role: "anon" };
  if (who === "service") return { claims: { role: "service_role" }, role: "service_role" };
  return { claims: { sub: who.id, email: who.email, role: "authenticated" }, role: "authenticated" };
}
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

/* ── the people, the film and the keys ──────────────────────────────────── */
const U = {
  alice: { id: "a11ce000-0000-4000-8000-000000000001", email: "alice@example.com" },  // the render's account; owns the film
  bob:   { id: "b0b00000-0000-4000-8000-000000000002", email: "bob@example.com" },    // art director on Alice's film
  carol: { id: "ca201000-0000-4000-8000-000000000003", email: "carol@example.com" },  // writer
  vera:  { id: "7e2a0000-0000-4000-8000-000000000004", email: "vera@example.com" },   // view-only
  dave:  { id: "da7e0000-0000-4000-8000-000000000005", email: "dave@example.com" },   // outsider with his own film
};
const A = U.alice.id;
const FILM = "f1000000-0000-4000-8000-000000000001";
const DAVE_FILM = "d0000000-0000-4000-8000-00000000000d";
const WHO = [["render owner", U.alice], ["art director", U.bob], ["writer", U.carol], ["view-only", U.vera], ["outsider", U.dave], ["anon", "anon"]];
const ACCOUNT_FOLDERS = [A, "alice--" + A];   // legacy and readable account folders (only the id is ever checked)

// The keys image-proxy writes, built by its own code (video-snapshots.mjs): a render's hold id,
// several indexes and every extension it uses. FUTURE keys don't exist yet (a later render's
// snapshot, or the next index of this one): nobody may place a file there before the proxy does.
const HOLD = "c0ffee00-0000-4000-8000-0000000000a1", LATER_HOLD = "c0ffee00-0000-4000-8000-0000000000b2";
const T0 = 1759300000000;
const SNAP = {
  where: "supabase/functions/image-proxy/video-snapshots.mjs snapshotPath(), SNAPSHOT_DIR = " + JSON.stringify(SNAPSHOT_DIR),
  keys: [snapshotPath(HOLD, 0, "mp4", T0), snapshotPath(HOLD, 1, "mov", T0), snapshotPath(HOLD, 2, "webm", T0 + 1), snapshotPath(HOLD, 3, "m4v", T0 + 2)],
  future: [snapshotPath(HOLD, 4, "mp4", T0 + 3), snapshotPath(LATER_HOLD, 0, "mp4", T0 + 60000)],
};
const SNAP_KEYS = SNAP.keys;
const ownFilmKey = (n) => `${A}/${FILM}/character/neo/20260101-10000${n}-sheet-aaaa000${n}.png`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUIDS_IN_KEYS = [...new Set([...SNAP_KEYS, ...SNAP.future].flatMap((k) => (k.match(UUID_RE) || []).map((s) => s.toLowerCase())))];
const variant = (key, tag) => key.replace(/(\.[A-Za-z0-9]+)?$/, (ext) => "-" + tag + (ext || ""));
const prefixOf = (key) => key.slice(0, key.lastIndexOf("/") + 1);

async function seed(db) {
  for (const u of Object.values(U)) await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())`, [u.id, u.email]);
  await db.query(`insert into storage.buckets(id, name, public) values ('turn-assets','turn-assets',false) on conflict do nothing`);
  const doc = (title) => JSON.stringify({ scenes: [], characters: [], props: [], locations: [], shots: [], project: { title, format: "feature" }, _rev: 1 });
  await db.query(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Neon Harbor', $3)`, [FILM, A, doc("Neon Harbor")]);
  await db.query(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Dave''s Film', $3)`, [DAVE_FILM, U.dave.id, doc("Dave's Film")]);
  // Every uuid inside a snapshot key becomes a project the render's owner owns (Bob its art
  // director), so a rule that reads an id out of the key can't be what keeps it closed by luck.
  for (const id of UUIDS_IN_KEYS) {
    await db.query(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, 'Named like a key', $3) on conflict (id) do nothing`, [id, A, doc("Named like a key")]);
  }
  for (const pid of [FILM, ...UUIDS_IN_KEYS]) {
    if (!(await q(db, `select 1 from public.turn_projects where id = $1 and owner = $2`, [pid, A])).length) continue;
    for (const [user, role] of [[U.bob, "art_director"], [U.carol, "writer"], [U.vera, "view_only"]]) {
      await db.query(`insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status)
                      values ($1, $2, $3, $4, $5, 'active') on conflict do nothing`, [pid, A, user.email, user.id, role]);
    }
  }
  // the account's own film files (for the move-onto probe and the controls)
  for (const n of [1, 2]) await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":100}')`, [ownFilmKey(n)]);
}

/* The snapshots are written as image-proxy writes them: by the service role. */
async function serviceWritesSnapshots(db) {
  const r = await session(db, "service", async () => {
    const out = [];
    for (const k of SNAP_KEYS) out.push(await attempt(db, `insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":4096}') returning name`, [k]));
    return out;
  });
  // keep them (the session rolls back): insert for real as the table owner, which is what
  // the Storage API does on the service role's behalf
  for (const k of SNAP_KEYS) await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":4096}') on conflict do nothing`, [k]);
  return r;
}

/* Every probe, as one caller, over every snapshot key. Returns what got through. */
async function probe(db, who) {
  return session(db, who, async () => {
    const opened = [];
    for (const key of SNAP_KEYS) {
      const pfx = prefixOf(key);
      const sel = await attempt(db, `select count(*)::int n from storage.objects where bucket_id = 'turn-assets' and name = $1`, [key]);
      if (!sel.ok || sel.rows[0].n !== 0) opened.push(["read", key, sel.ok ? sel.rows[0].n : sel.code]);
      const list = await attempt(db, `select count(*)::int n from storage.objects where bucket_id = 'turn-assets' and name like $1 || '%'`, [pfx]);
      if (!list.ok || list.rows[0].n !== 0) opened.push(["list", pfx, list.ok ? list.rows[0].n : list.code]);
      const ins = await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [variant(key, "new")]);
      if (ins.ok) opened.push(["insert", variant(key, "new")]);
      for (const f of SNAP.future) {   // placing a file where a later snapshot will go
        const pre = await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [f]);
        if (pre.ok) opened.push(["insert future snapshot", f]);
        const mv = await attempt(db, `update storage.objects set name = $2 where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(2), f]);
        if (mv.ok && mv.n !== 0) opened.push(["move onto future snapshot", f]);
      }
      const ups = await attempt(db, `insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":1}')
                                     on conflict (bucket_id, name) do update set metadata = excluded.metadata`, [key]);
      if (ups.ok) opened.push(["upsert", key]);
      const upd = await attempt(db, `update storage.objects set metadata = '{"size":1,"swapped":true}', updated_at = now() where bucket_id = 'turn-assets' and name = $1`, [key]);
      if (!upd.ok ? false : upd.n !== 0) opened.push(["update", key, upd.n]);
      const away = await attempt(db, `update storage.objects set name = $2 where bucket_id = 'turn-assets' and name = $1`, [key, variant(key, "moved")]);
      if (away.ok && away.n !== 0) opened.push(["move away", key, away.n]);
      const onto = await attempt(db, `update storage.objects set name = $2 where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(2), variant(key, "onto")]);
      if (onto.ok && onto.n !== 0) opened.push(["move onto", variant(key, "onto"), onto.n]);
      const del = await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [key]);
      if (del.ok && del.n !== 0) opened.push(["delete", key, del.n]);
      const can = await attempt(db, `select public.turn_can_delete_asset_path($1) r`, [key]);
      if (can.ok && can.rows[0].r !== false) opened.push(["turn_can_delete_asset_path", key, can.rows[0].r]);
      for (const pid of [FILM, ...UUIDS_IN_KEYS]) {
        const beg = await attempt(db, `select public.turn_begin_asset_upload(p_project_id => $1, p_path => $2) r`, [pid, variant(key, "reserved")]);
        if (beg.ok) opened.push(["turn_begin_asset_upload", pid, variant(key, "reserved")]);
      }
    }
    return opened;
  });
}

/* What the service role can do (image-proxy copies, reads for signing, and deletes at settle). */
async function serviceCan(db) {
  return session(db, "service", async () => {
    const key = SNAP_KEYS[0];
    const sel = await attempt(db, `select count(*)::int n from storage.objects where bucket_id = 'turn-assets' and name = $1`, [key]);
    const ins = await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [variant(key, "svc")]);
    const upd = await attempt(db, `update storage.objects set metadata = '{"size":2}' where bucket_id = 'turn-assets' and name = $1`, [key]);
    const del = await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [key]);
    return { read: sel.ok ? sel.rows[0].n : sel.code, insert: ins.ok, update: upd.ok ? upd.n : upd.code, delete: del.ok ? del.n : del.code };
  });
}

/* Controls: the harness sees an opening where there is one. */
async function controls(db, label, { ownFolderOpen }) {
  const alice = await session(db, U.alice, async () => ({
    insert: (await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [ownFilmKey(9)])).ok,
    update: (await attempt(db, `update storage.objects set metadata = '{"x":1}' where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(1)])).n,
    delete: (await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(1)])).n,
  }));
  ok(`${label}: control — the render's owner CAN write, update and delete her own film's files (the probes can see an opening)`,
    alice.insert === true && alice.update === 1 && alice.delete === 1, alice);
  const bob = await session(db, U.bob, async () => (await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(1)])).n);
  ok(`${label}: control — the art director CAN delete a file of that film`, bob === 1, bob);
  // Why the snapshot key must not start with the account's folder: under the owner-only
  // rules (storage.sql), anything below folder 1 = the uid is the account's to change.
  const underOwn = `${A}/billing-snapshots/1759000000000-video-aaaa0001.mp4`;
  await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":4096}') on conflict do nothing`, [underOwn]);
  const own = await session(db, U.alice, async () => ({
    insert: (await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [variant(underOwn, "new")])).ok,
    update: (await attempt(db, `update storage.objects set metadata = '{"x":1}' where bucket_id = 'turn-assets' and name = $1`, [underOwn])).n,
    delete: (await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [underOwn])).n,
  }));
  ok(`${label}: control — a snapshot folder under the account's own folder ({uid}/billing-snapshots/…) would be ${ownFolderOpen ? "OPEN to the account (insert, update, delete)" : "closed here (no own-folder rule on this rule set)"}`,
    ownFolderOpen ? (own.insert && own.update === 1 && own.delete === 1) : (!own.insert && own.update === 0 && own.delete === 0), own);
  await db.query(`delete from storage.objects where name = $1`, [underOwn]);
  // stage-tmp, where the app's device uploads land (through a service-signed upload slot) and
  // where image-proxy stages a data URL's bytes: closed to the account's own writes on every
  // production rule set, open again only after a storage.sql re-run (the README's mistake).
  const staged = ACCOUNT_FOLDERS.map((f) => `${f}/stage-tmp/1759000000000-video-device-aaaa0002.mp4`);
  for (const k of staged) await db.query(`insert into storage.objects(bucket_id, name, metadata) values ('turn-assets', $1, '{"size":4096}') on conflict do nothing`, [k]);
  const st = await session(db, U.alice, async () => {
    const out = [];
    for (const k of staged) {
      if ((await attempt(db, `insert into storage.objects(bucket_id, name) values ('turn-assets', $1)`, [variant(k, "new")])).ok) out.push("insert " + k);
      if ((await attempt(db, `update storage.objects set metadata = '{"x":1}' where bucket_id = 'turn-assets' and name = $1`, [k])).n) out.push("update " + k);
      const onto = await attempt(db, `update storage.objects set name = $2 where bucket_id = 'turn-assets' and name = $1`, [ownFilmKey(2), variant(k, "onto")]);
      if (onto.ok && onto.n) out.push("move onto " + k);
      if ((await attempt(db, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [k])).n) out.push("delete " + k);
    }
    return out;
  });
  ok(`${label}: stage-tmp (device uploads, staged data URLs) is ${ownFolderOpen ? "OPEN again to the account's own writes (why a storage.sql re-run must be followed by enforce-role-scopes.sql and series-production.sql)" : "closed to the account's own writes: no insert, update, move onto or delete"}`,
    ownFolderOpen ? st.filter((x) => x.endsWith(" " + staged[0])).length === 4 : st.length === 0, st);   // storage.sql's rules read folder 1's text: the bare-id folder
  for (const k of staged) await db.query(`delete from storage.objects where name = $1`, [k]);
}

async function check(label, files, { ownFolderOpen = false, after = [] } = {}) {
  section(label);
  const db = await newDb();
  const beforeSeries = files.filter((f) => !/series-production|storage-readable-folders/.test(f));
  await chain(db, beforeSeries);
  await seed(db);
  await chain(db, files.slice(beforeSeries.length));
  await chain(db, after);
  const rules = await q(db, `select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`);
  ok(`${label}: the rule set under test (${rules.map((r) => r.policyname).join(", ")})`, rules.length >= 4, rules);
  const helpers = await q(db, `select k, public.turn_storage_project_id(k)::text as project,
      case when to_regprocedure('public.turn_storage_uid(text)') is null then null else 'n/a' end as has_uid
    from unnest($1::text[]) k`, [[...SNAP_KEYS, ...SNAP.future]]);
  let uids = [];
  if (helpers[0].has_uid) uids = await q(db, `select k, public.turn_storage_uid(k)::text as uid from unnest($1::text[]) k`, [[...SNAP_KEYS, ...SNAP.future]]);
  ok(`${label}: the storage key helpers read no project${helpers[0].has_uid ? " and no account" : ""} out of any snapshot key`,
    helpers.every((h) => h.project === null) && uids.every((u) => u.uid === null), { helpers, uids });
  const svcWrite = await serviceWritesSnapshots(db);
  ok(`${label}: the service role can write every snapshot key (image-proxy's copy)`, svcWrite.every((r) => r.ok), svcWrite);
  for (const [name, who] of WHO) {
    const opened = await probe(db, who);
    ok(`${label}: ${name} can't read, list, insert, upsert, update, move away, move onto, delete or reserve a snapshot`, opened.length === 0, opened.slice(0, 6));
  }
  const svc = await serviceCan(db);
  ok(`${label}: the service role can read, insert, update and delete a snapshot (sign it for the provider, clean it up at settle)`,
    svc.read === 1 && svc.insert === true && svc.update === 1 && svc.delete === 1, svc);
  await controls(db, label, { ownFolderOpen });
  const left = await q(db, `select count(*)::int n from storage.objects where name = any($1)`, [SNAP_KEYS]);
  ok(`${label}: every snapshot is still there after all the probes`, left[0].n === SNAP_KEYS.length, left);
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════ */
section("K: the snapshot keys image-proxy builds");
ok(`K1 the keys come from image-proxy's own code (${SNAP.where}) and are keys it recognises as its snapshots`,
  SNAP_KEYS.length === 4 && [...SNAP_KEYS, ...SNAP.future].every(isSnapshotPath), { keys: SNAP_KEYS, future: SNAP.future });
for (const k of SNAP_KEYS) console.log("     key: " + k);
ok("K2 folder 1 is `_internal` (the service files' root, which the key parser never reads as an account): no account id and no readable account folder",
  SNAPSHOT_DIR.split("/")[0] === "_internal" && [...SNAP_KEYS, ...SNAP.future].every((k) => k.split("/")[0] === "_internal"), SNAPSHOT_DIR);
ok("K3 folder 2 is a fixed word, never an id, `stage-tmp` or `studio-previews` (no rule reads a project out of it); the file sits directly in it",
  [...SNAP_KEYS, ...SNAP.future].every((k) => { const seg = k.split("/"); return seg.length === 3 && seg[1] === SNAPSHOT_DIR.split("/")[1]
    && !/[0-9a-f]{8}/i.test(seg[1]) && !seg[1].includes("--") && !["stage-tmp", "studio-previews"].includes(seg[1]); }), SNAP_KEYS);

const PROD_TODAY = ["schema.sql", "storage.sql", "pre:team-collaboration.sql", "shared-owners.sql", "pre:enforce-role-scopes.sql", "cameos.sql", "pre:series-production.sql"];
await check("P1 production as it is today (pre-readable-folder access files)", PROD_TODAY);
await check("P2 production + storage-readable-folders.sql (the current rules)", [...PROD_TODAY, "storage-readable-folders.sql"]);
await check("P3 P2 + a storage.sql re-run (owner-only rules back)", [...PROD_TODAY, "storage-readable-folders.sql"], { ownFolderOpen: true, after: ["storage.sql"] });
await check("P4 fresh install in the README order", ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql", "shared-owners.sql",
  "enforce-role-scopes.sql", "cameos.sql", "series-production.sql", "storage-readable-folders.sql"]);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

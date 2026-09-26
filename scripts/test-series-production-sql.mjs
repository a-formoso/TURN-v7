#!/usr/bin/env node
/* ============================================================================
   series-production.sql — EXECUTED against an in-memory Postgres (PGlite).

   scripts/test-series-production.mjs checks the file's text. This test runs
   it: the real supabase/*.sql files are applied in README order to a database
   that stubs the Supabase pieces they use, legacy data is seeded in the shapes
   older clients wrote, and then:

     A  likely production (schema, storage, team-collaboration, invitations,
        shared-owners, enforce-role-scopes, cameos, credits + legacy data):
        the read-only probe before and after, two runs (idempotent), the app's
        RPCs called as signed-in users with the argument names the app sends
        (read from every .rpc() call in app/ and supabase/functions/: convert,
        create/delete Episode, delete Show, upload reservations),
        writer/art-director/outsider/anon access, EXECUTE privileges of every
        function the file creates, cameo and cameo-photo delete rights, which
        Episode teams are (not) widened to the whole Show on the first run
        (a legacy Show whose Episode 1 is gone; a grant newer than the Show),
        and a re-run after Episode 1 of a legacy Show is deleted and a new
        grant was added to a recorded source Episode.
     B  prerequisites missing (no team-collaboration / no role-scope file /
        every other object the guard checks): the guard stops the run with a
        message naming each problem, and nothing at all is created.
     C  a member still holds the retired producer_admin role: the guard stops
        the run until migrate-remove-producer-admin.sql has been applied.
     D  a database that ran an earlier copy of the file (which recorded no
        sourceEpisodeId for a Show without a linked Episode) holds Show Bibles
        with keys for no live Episode: the re-run must not abort on the
        previous run's Bible-key trigger.
     R  README statements this file backs (re-run list, cleanup worker).

   OFFLINE ONLY: no network, no Supabase project, no credentials.
   Emulated Supabase pieces (see SUPABASE_STUB): the anon / authenticated /
   service_role roles, Supabase's default privileges (new functions are
   granted to anon and authenticated DIRECTLY, so "revoke from public" alone
   does not hide them), auth.users/uid()/role()/email()/jwt(), and
   storage.buckets/objects/foldername(). PGlite runs the migration as a
   superuser; PostgREST is emulated by SET LOCAL ROLE + request.jwt.claims
   and named-argument calls inside a transaction.

     node scripts/test-series-production-sql.mjs
   ============================================================================ */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const sqlFile = (name) => read("supabase/" + name);
const SERIES = sqlFile("series-production.sql");
const PROBE = sqlFile("series-production-probe.sql");
const README = sqlFile("README.md");

let passes = 0, failures = 0;
const ok = (name, condition, detail) => {
  if (condition) { passes++; console.log("PASS " + name); }
  else {
    failures++;
    console.log("FAIL " + name + (detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))));
  }
};
const section = (title) => console.log("\n=== " + title + " ===");

/* ── Supabase stub ─────────────────────────────────────────────────────────── */
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator nologin noinherit;
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  created_at timestamptz default now(), last_sign_in_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text
$f$;
create or replace function auth.email() returns text language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')), '')::text
$f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text, user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language plpgsql as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts,1)-1];
end
$f$;
create or replace function storage.filename(name text) returns text language plpgsql as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts,1)];
end
$f$;
grant execute on all functions in schema storage to anon, authenticated, service_role;
`;

async function newDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  return db;
}

/* Runs a whole file as ONE simple-protocol query, like the SQL Editor. */
async function runFile(db, name, text = sqlFile(name)) {
  try {
    await db.exec(text);
    return { ok: true };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return { ok: false, error: e.message, code: e.code, hint: e.hint };
  }
}
async function chain(db, files) {
  for (const f of files) {
    const r = await runFile(db, f);
    if (!r.ok) throw new Error(`prerequisite ${f} failed: ${r.error}`);
  }
}
const README_CHAIN = ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql",
  "shared-owners.sql", "enforce-role-scopes.sql", "cameos.sql", "credits.sql"];

/* PostgREST-like request: one transaction as one caller. */
async function as(db, who, fn, { commit = false } = {}) {
  await db.exec("begin");
  try {
    let claims, role;
    if (who === "anon") { claims = { role: "anon" }; role = "anon"; }
    else if (who === "service") { claims = { role: "service_role" }; role = "service_role"; }
    else { claims = { sub: who.id, email: who.email, role: "authenticated" }; role = "authenticated"; }
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
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const rows = (db, who, sql, params = [], opts) => as(db, who, async () => (await db.query(sql, params)).rows, opts);
const affected = (db, who, sql, params = [], opts) =>
  as(db, who, async () => (await db.query(sql, params)).affectedRows ?? 0, opts);

/* Schema + data fingerprint: proves "nothing changed" / "idempotent". */
async function snapshot(db) {
  const has = async (t) => (await q(db, `select to_regclass($1) is not null as x`, [t]))[0].x;
  const data = {};
  for (const t of ["public.turn_projects", "public.turn_project_members", "public.turn_generations",
    "public.turn_cameos", "public.turn_credits", "public.turn_asset_upload_intents",
    "public.turn_asset_cleanup_queue", "public.turn_asset_cleanup_grants", "storage.objects", "storage.buckets"]) {
    data[t] = (await has(t)) ? await q(db, `select to_jsonb(x) j from ${t} x order by 1`) : "absent";
  }
  return {
    columns: await q(db, `select table_schema, table_name, column_name, data_type, column_default, is_nullable
                            from information_schema.columns where table_schema in ('public','storage')
                           order by 1,2,3`),
    tables: await q(db, `select schemaname, tablename, rowsecurity from pg_tables
                          where schemaname in ('public','storage') order by 1,2`),
    functions: await q(db, `select p.proname, pg_get_function_identity_arguments(p.oid) args, md5(p.prosrc) src,
                                   p.prosecdef, coalesce(array_to_string(p.proacl, ','), '') acl
                              from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1,2`),
    triggers: await q(db, `select event_object_schema s, event_object_table t, trigger_name, action_timing,
                                  event_manipulation, action_statement
                             from information_schema.triggers where event_object_schema in ('public','storage')
                            order by 1,2,3,5`),
    policies: await q(db, `select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies order by 1,2,3`),
    constraints: await q(db, `select conrelid::regclass::text rel, conname, pg_get_constraintdef(oid) def, convalidated
                                from pg_constraint where connamespace = 'public'::regnamespace order by 1,2`),
    indexes: await q(db, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1,2`),
    tableAcl: await q(db, `select relname, coalesce(array_to_string(relacl, ','), '') acl from pg_class
                            where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
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

/* The probe: one read-only SELECT. Returns rows keyed by ord. */
async function runProbe(db, label) {
  const before = await snapshot(db);
  await db.exec("begin transaction read only");
  let out, err;
  try { out = (await db.query(PROBE)).rows; } catch (e) { err = e; }
  await db.exec("rollback");
  ok(`[${label}] probe runs as one statement inside a READ ONLY transaction`, !err, err && err.message);
  if (err) return {};
  let plain, plainErr;
  try { plain = await db.exec(PROBE); } catch (e) { plainErr = e; }
  ok(`[${label}] probe also runs as plain SQL Editor text (one result table)`,
    !plainErr && plain.length === 1 && plain[0].rows.length === out.length, plainErr ? plainErr.message : plain.length);
  const d = diff(before, await snapshot(db));
  ok(`[${label}] probe changed nothing`, d.length === 0, d);
  return Object.fromEntries(out.map((r) => [r.ord, r]));
}
const leadingNumber = (row) => { const m = /^(\d+)/.exec(row && row.found || ""); return m ? Number(m[1]) : null; };

/* ── Legacy data, in the shapes older clients wrote ────────────────────────── */
const U = {
  alice: { id: "a11ce000-0000-4000-8000-000000000001", email: "alice@example.com" },
  bob:   { id: "b0b00000-0000-4000-8000-000000000002", email: "bob@example.com" },
  carol: { id: "ca201000-0000-4000-8000-000000000003", email: "carol@example.com" },
  dave:  { id: "da7e0000-0000-4000-8000-000000000004", email: "dave@example.com" }, // outsider
  gina:  { id: "91a00000-0000-4000-8000-000000000006", email: "gina@example.com" }, // Episode-only grant on S3's E02
  hank:  { id: "4a4c0000-0000-4000-8000-000000000007", email: "hank@example.com" }, // grant on E21 newer than S2
  zed:   { id: "2ed00000-0000-4000-8000-000000000009", email: "zed@example.com" },  // grant on E21 added after the first run
};
const A = U.alice.id, B = U.bob.id, C = U.carol.id;
const P = {
  F1:   "f1000000-0000-4000-8000-000000000001", // Alice film, converted to a Show by the app below
  F2:   "f2000000-0000-4000-8000-000000000002", // Alice film shared: Bob art_director, Carol writer
  F3:   "f3000000-0000-4000-8000-000000000003", // Alice film with two spellings of Carol's invite
  S1:   "5e100000-0000-4000-8000-000000000051", // Alice legacy Show (no sourceEpisodeId recorded)
  E1:   "e1000000-0000-4000-8000-0000000000e1", // S1 Episode 1 (the original film), Bob writer grant
  E2:   "e2000000-0000-4000-8000-0000000000e2", // S1 Episode 2, STRING episodeNo "2", Erin Episode-only grant
  E3:   "e3000000-0000-4000-8000-0000000000e3", // S1 Episode 3
  EBAD: "eb000000-0000-4000-8000-0000000000eb", // claims S1 with episodeNo "two" -> stays a film
  FXP:  "f9000000-0000-4000-8000-000000000009", // doc.showId points at a FILM (F1) -> stays a film
  EXB:  "b2e00000-0000-4000-8000-0000000000b2", // Bob-owned row claiming Alice's S1 -> stays a film
  B1:   "b1000000-0000-4000-8000-0000000000b1", // Bob's own film
  S2:   "5e200000-0000-4000-8000-000000000052", // Alice Show, isShow "TRUE", sourceEpisodeId recorded = E21
  E21:  "e2100000-0000-4000-8000-000000000e21", // S2 Episode 1, Bob writer grant (the conversion artifact)
  E22:  "e2200000-0000-4000-8000-000000000e22", // S2 Episode 2
  S3:   "5e300000-0000-4000-8000-000000000053", // Alice legacy Show (June-Sept app): no sourceEpisodeId, Episode 1 already deleted
  E32:  "e3200000-0000-4000-8000-000000000e32", // S3 Episode 2, Gina writer grant OLDER than the Show row
  E33:  "e3300000-0000-4000-8000-000000000e33", // S3 Episode 3
};
const path = {
  f1neo:        `${A}/${P.F1}/character/neo/20260101-100000-sheet-v2-aaaa0001.png`,
  f1neoRef:     `${A}/${P.F1}/character/neo/20260101-100000-ref-owner-aaaa0002.png`,
  f1neoOld:     `${A}/${P.F1}/character/neo/20251201-100000-sheet-v1-aaaa0003.png`,
  f1neoOldRef:  `${A}/${P.F1}/character/neo/20251201-100000-ref-owner-aaaa0005.png`,
  f1neoOldTmp:  `${A}/${P.F1}/character/neo/20251201-100000-sheet-aaaa0006.png`,
  f1cameo:      `${A}/${P.F1}/cameo/neo/20260102-100000-front-aaaa0004.png`,
  f2trin:       `${B}/${P.F2}/character/trin/20260103-100000-sheet-bbbb0001.png`,
  f2cameo:      `${B}/${P.F2}/cameo/trin/20260103-100000-front-bbbb0002.png`,
  f2carolCameo: `${C}/${P.F2}/cameo/carol-cam/20260103-100000-front-cccc9001.png`,
  f2carolSheet: `${C}/${P.F2}/character/trin/20260103-100000-sheet-cccc9002.png`, // Carol's upload while art director: project material
  bobOnF1cameo: `${B}/${P.F1}/cameo/neo/20260103-100000-front-bbbb0003.png`,
  s1mara:       `${A}/${P.S1}/character/mara/20260104-100000-sheet-cccc0001.png`,
  e1maraLegacy: `${A}/${P.E1}/character/mara/20251101-100000-sheet-cccc0002.png`, // still referenced by S1
  e1shot:       `${A}/${P.E1}/shot/shot-1/20260105-100000-sheet-cccc0003.png`,
  e1shotOld:    `${A}/${P.E1}/shot/shot-1/20260101-100000-sheet-cccc0004.png`,
  e1pending:    `${A}/${P.E1}/shot/shot-1/20251231-100000-sheet-cccc0005.png`,
  e2shot:       `${A}/${P.E2}/shot/shot-2/20260106-100000-sheet-dddd0001.png`,
  e2cameo:      `${A}/${P.E2}/cameo/mara/20260106-100000-front-dddd0002.png`,
  b1x:          `${B}/${P.B1}/character/x/20260107-100000-sheet-eeee0001.png`,
  e22shot:      `${A}/${P.E22}/shot/shot-9/20260108-100000-sheet-ffff0001.png`,
};
const filmDoc = (title, extra = {}) => ({
  scenes: [{ id: "s1", title: "Opening" }, { id: "s2", title: "Turn" }],
  characters: [{ id: "neo", name: "Neo", scenes: ["s1"] }],
  props: [], locations: [{ id: "loc-harbor", name: "Harbor" }], lookbook: [], lookbookNote: "", shots: [],
  project: { title, genre: "noir", logline: "x", format: "feature" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [{ id: "c-old", name: "Old" }], props: [], locations: [], shots: [] },
  _rev: 5, ...extra,
});
const emptyEpisode = (showId, episodeNo, title) => ({
  scenes: [], characters: [], props: [], locations: [], lookbook: [], lookbookNote: "", lookbookApplied: {}, shots: [],
  project: { title, genre: "", logline: "", controllingIdea: {}, format: "series" },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  trash: { characters: [], props: [], locations: [], shots: [] }, blank: true,
  showId, episodeNo, _rev: 2,
});
function projectRows() {
  return [
    [P.F1, A, "Neon Harbor", filmDoc("Neon Harbor")],
    [P.F2, A, "Shared Film", filmDoc("Shared Film", { _rev: 2 })],
    [P.F3, A, "Invite Probe", filmDoc("Invite Probe", { _rev: 1 })],
    [P.S1, A, "Dust Road — Show", {
      isShow: true,
      bible: {
        characters: [{ id: "mara", name: "Mara", scenes: ["s1"] }],
        locations: [{ id: "loc-well", name: "Well" }],
        props: [], lookbook: [{ id: "look-1" }], lookbookNote: "dusty",
      },
      _rev: 3,
    }],
    [P.E1, A, "Dust Road", {
      ...filmDoc("Dust Road", { _rev: 7 }),
      characters: [{ id: "mara", name: "Mara (stale episode copy)", scenes: ["s1"] }, { id: "only-in-ep1", name: "Never reached the Bible" }],
      locations: [{ id: "loc-well", name: "Well" }],
      lookbookNote: "stale note",
      trash: { characters: [{ id: "c-del", name: "Deleted", scenes: ["s2"] }], props: [], locations: [], shots: [{ id: "sh-del" }] },
      showId: P.S1, episodeNo: 1,
    }],
    [P.E2, A, "Dust Road — E02", emptyEpisode(P.S1, "2", "Dust Road E02")],
    [P.E3, A, "Dust Road — E03", emptyEpisode(P.S1, 3, "Dust Road E03")],
    [P.EBAD, A, "Dust Road — E??", { ...emptyEpisode(P.S1, "two", "Dust Road E??"), scenes: [{ id: "bad-1", title: "keep me" }] }],
    [P.FXP, A, "Points at a film", { ...filmDoc("Points at a film"), showId: P.F1, episodeNo: 3, seriesCreateRequestId: "stale" }],
    [P.EXB, B, "Bob fake episode", { ...emptyEpisode(P.S1, 4, "Bob E04"), scenes: [{ id: "bx", title: "bob scene" }] }],
    [P.B1, B, "Bob Film", filmDoc("Bob Film", { _rev: 1 })],
    [P.S2, A, "Salt — Show", {
      isShow: "TRUE", format: "limited", sourceEpisodeId: P.E21,
      bible: { characters: [], locations: [], props: [], lookbook: [], lookbookNote: "" }, _rev: 1,
    }],
    [P.E21, A, "Salt", { ...filmDoc("Salt", { _rev: 4 }), characters: [], locations: [], trash: { characters: [], props: [], locations: [], shots: [] }, showId: P.S2, episodeNo: 1 }],
    [P.E22, A, "Salt — E02", emptyEpisode(P.S2, 2, "Salt E02")],
    [P.S3, A, "No-E1 — Show", {
      isShow: true,
      bible: { characters: [], locations: [], props: [], lookbook: [], lookbookNote: "" }, _rev: 2,
    }],
    [P.E32, A, "No-E1 — E02", emptyEpisode(P.S3, 2, "No-E1 E02")],
    [P.E33, A, "No-E1 — E03", emptyEpisode(P.S3, 3, "No-E1 E03")],
  ];
}
// Member timestamps are relative to now, like the project rows below, so the
// "older than the Show row" rule does not depend on the machine's clock.
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
async function seed(db, { memberships = true, cameos = true } = {}) {
  for (const u of Object.values(U)) {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())`, [u.id, u.email]);
  }
  await db.query(`insert into storage.buckets(id, name, public) values ('turn-assets','turn-assets',false) on conflict do nothing`);
  let t = 0;
  for (const [id, owner, title, doc] of projectRows()) {
    t++;
    await db.query(`insert into public.turn_projects(id, owner, title, doc, created_at, updated_at)
                    values ($1,$2,$3,$4, now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval)`,
      [id, owner, title, JSON.stringify(doc), String(30 - t)]);
  }
  if (memberships) {
    const m = [
      [P.F2, A, "bob@example.com", B, "art_director", "active", ago(90)],
      [P.F2, A, "Carol@Example.com", null, "writer", "active", ago(90)],   // mixed case, not yet linked
      [P.E1, A, "bob@example.com", B, "writer", "active", ago(90)],
      [P.E21, A, "bob@example.com", B, "writer", "active", ago(90)],
      [P.E2, A, "erin@example.com", null, "writer", "active", ago(90)],    // Episode-only legacy grant
      [P.F3, A, "carol@example.com", null, "writer", "active", ago(90)],
      [P.F3, A, " Carol@Example.com ", null, "view_only", "removed", ago(60)], // newer spelling wins
      // Older than S3's row, so only "a missing Episode 1 is never replaced by a guess" keeps it Episode-only.
      [P.E32, A, "gina@example.com", null, "writer", "active", ago(90)],
      // Added to S2's recorded source Episode AFTER the Show row existed: not the conversion leftover.
      [P.E21, A, "hank@example.com", null, "view_only", "active", ago(1)],
    ];
    for (const r of m) {
      await db.query(`insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status, created_at, updated_at)
                      values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$7::timestamptz)`, r);
    }
  }
  const gens = [
    [P.F1, A, "neo", path.f1neo, [{ storage_path: path.f1neoRef }],
      [{ storage_path: path.f1neoOld, refs: [{ storage_path: path.f1neoOldRef }], meta: { cleanupPending: [path.f1neoOldTmp] } }], {}],
    [P.F2, B, "trin", path.f2trin, [], [], {}],
    [P.S1, A, "mara", path.s1mara, [{ storage_path: path.e1maraLegacy }], [], {}],
    [P.E1, A, "mara", path.e1maraLegacy, [], [], {}],
    [P.E1, A, "shot-1", path.e1shot, [], [{ storage_path: path.e1shotOld }], { cleanupPending: [path.e1pending] }],
    [P.E2, A, "shot-2", path.e2shot, [], [], {}],
    [P.B1, B, "x", path.b1x, [], [], {}],
    [P.E22, A, "shot-9", path.e22shot, [], [], {}],
  ];
  for (const [pid, owner, ent, sp, refs, hist, meta] of gens) {
    await db.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path, refs, history, meta)
                    values ($1,$2,$3,$4,$5,$6,$7)`, [pid, owner, ent, sp, JSON.stringify(refs), JSON.stringify(hist), JSON.stringify(meta)]);
  }
  if (cameos) {
    const c = [
      [P.F1, A, "neo", [{ label: "front", storage_path: path.f1cameo }]],
      [P.E2, A, "mara", [{ label: "front", storage_path: path.e2cameo }]],
      [P.F2, B, "trin", [{ label: "front", storage_path: path.f2cameo }]],
      [P.F2, C, "carol-cam", [{ label: "front", storage_path: path.f2carolCameo }]], // captured while Carol was art director
      [P.F1, B, "bob-extra", [{ label: "front", storage_path: path.bobOnF1cameo }]],
    ];
    for (const [pid, owner, ch, angles] of c) {
      await db.query(`insert into public.turn_cameos(project_id, owner, char_id, angles, prov) values ($1,$2,$3,$4,'{"consent":true}')`,
        [pid, owner, ch, JSON.stringify(angles)]);
    }
  }
  for (const p of Object.values(path)) {
    await db.query(`insert into storage.objects(bucket_id, name, owner, metadata) values ('turn-assets', $1, $2, '{"size":100}')`,
      [p, p.split("/")[0]]);
  }
}

/* ── What the file creates, and who may call what ─────────────────────────── */
const CREATED = [...new Set([...SERIES.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]))].sort();
// Every RPC the browser calls that this file defines. The scan below must find
// exactly these in app/, so a new call anywhere fails here until it is added.
const APP_RPCS = ["turn_begin_asset_upload", "turn_convert_project_to_show", "turn_create_show_episode",
  "turn_delete_show", "turn_delete_show_episode", "turn_finish_asset_cleanup", "turn_finish_asset_upload",
  "turn_shared_film_owners"];

/* Every .rpc("name", { ...args }) call in the app and the edge functions, with
   the argument names it sends. A call whose arguments are not a literal object
   is recorded with keys = null so it fails the checks instead of being skipped. */
function listFiles(dir, exts) {
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
}
function balancedBody(src, start) {           // src[start] is "{"; returns the text inside it
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c) && --depth === 0) return src.slice(start + 1, i);
  }
  return null;
}
function topLevelKeys(body) {
  if (body === null) return null;
  const parts = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { cur += c; if (c === "\\") cur += body[++i]; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; cur += c; continue; }
    if ("{[(".includes(c)) depth++;
    if ("}])".includes(c)) depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  const keys = [];
  for (const part of parts.map((x) => x.trim()).filter(Boolean)) {
    const k = /^(?:([A-Za-z_$][\w$]*)|"([^"]*)"|'([^']*)')\s*(?::|$)/.exec(part);
    if (!k || part.startsWith("...")) return null;
    keys.push(k[1] || k[2] || k[3]);
  }
  return keys.sort();
}
function rpcCalls(file) {
  const src = read(file);
  const calls = [];
  const re = /\.rpc\(\s*(["'`])([A-Za-z0-9_]+)\1/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    while (/\s/.test(src[i])) i++;
    let keys = [];
    if (src[i] === ",") {
      i++;
      while (/\s/.test(src[i])) i++;
      keys = src[i] === "{" ? topLevelKeys(balancedBody(src, i)) : null;
    } else if (src[i] !== ")") keys = null;
    calls.push({ at: file + ":" + src.slice(0, m.index).split("\n").length, name: m[2], keys });
  }
  return calls;
}
const BROWSER_CALLS = listFiles("app/", [".js", ".jsx", ".mjs"]).flatMap(rpcCalls).filter((c) => CREATED.includes(c.name));
const EDGE_CALLS = listFiles("supabase/functions/", [".ts", ".js", ".mjs", ".jsx"]).flatMap(rpcCalls).filter((c) => CREATED.includes(c.name));
const APP_ARGS = {};
for (const c of BROWSER_CALLS) (APP_ARGS[c.name] ||= []).push(c.keys);

/* Calls one of the app's RPCs the way PostgREST does (named arguments), and
   proves the argument names are the ones the app actually sends. */
const shapesChecked = new Set();
function appRpc(db, who, name, args, opts = {}) {
  const keys = Object.keys(args).sort();
  const shape = name + "(" + keys.join(", ") + ")";
  if (!shapesChecked.has(shape)) {
    shapesChecked.add(shape);
    ok(`app call ${shape} uses argument names the app sends`,
      (APP_ARGS[name] || []).some((k) => k && k.join() === keys.join()), { app: APP_ARGS[name] || "never called" });
  }
  const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  const sql = opts.table ? `select * from ${call}` : `select ${call} r`;
  return rows(db, who, sql, keys.map((k) => args[k]), opts);
}
// Evaluated inside RLS policies as the calling role, so both API roles need EXECUTE.
const RLS_HELPERS = ["turn_can_access_project", "turn_can_delete_asset_path", "turn_can_write_assets"];
// The (not yet implemented) cleanup worker's contract: service_role only.
const SERVICE_ONLY = ["turn_claim_asset_cleanup_batch", "turn_complete_asset_cleanup"];

/* The app's Show Bible for conversion, as prepareBibleForEpisode() builds it. */
const bibleFor = (episodeId) => ({
  characters: [{ id: "neo", name: "Neo", scenes: ["s1"], episodeScenes: { [episodeId]: ["s1"] } }],
  locations: [{ id: "loc-harbor", name: "Harbor", scenes: [], episodeScenes: { [episodeId]: [] } }],
  props: [], lookbook: [], lookbookNote: "",
  trash: { characters: [], locations: [], props: [] },
});

/* ═══════════════════════════════════════════════════════════════════════════
   A. Likely production
   ═══════════════════════════════════════════════════════════════════════════ */
section("A: README chain + legacy data");
{
  const db = await newDb();
  await chain(db, README_CHAIN);
  await seed(db);

  // ── the read-only probe, before ───────────────────────────────────────────
  const pre = await runProbe(db, "A before");
  const stops = Object.values(pre).filter((r) => r.ord > 0 && r.status === "STOP").map((r) => r.ord + " " + r.item);
  ok("A: probe finds no STOP rows on this database", stops.length === 0, stops);
  ok("A: probe row 42 sees turn_role_allowed_sections", pre[42] && pre[42].status === "OK", pre[42] && pre[42].found);
  ok("A: probe row 62 sees no Show functions yet", pre[62] && /none yet/.test(pre[62].found), pre[62] && pre[62].found);
  ok("A: probe row 80 predicts one guessed source Episode (S1's Episode 1), one Show with no Episode 1 (S3), none gone",
    pre[80] && pre[80].status === "INFO"
    && /^1 guessed \(Episode 1\), 1 with no Episode 1 \(none recorded\), 0 recorded with no live source Episode$/.test(pre[80].found),
    pre[80] && pre[80].found);
  ok("A: probe row 95 predicts two promotions (Bob E1 -> S1, Bob E21 -> S2) and one newer grant left alone (Hank on E21)",
    leadingNumber(pre[95]) === 2 && /, 1 newer grant\(s\) on a source Episode left Episode-only$/.test(pre[95].found), pre[95] && pre[95].found);

  // ── the migration, twice ──────────────────────────────────────────────────
  const run1 = await runFile(db, "series-production.sql", SERIES);
  ok("A: first run succeeds", run1.ok, run1.error);
  const afterFirst = await snapshot(db);
  const run2 = await runFile(db, "series-production.sql", SERIES);
  ok("A: second run succeeds", run2.ok, run2.error);
  const d12 = diff(afterFirst, await snapshot(db));
  ok("A: second run changes nothing (schema, privileges, data)", d12.length === 0, d12);

  // ── backfill outcome ──────────────────────────────────────────────────────
  const kinds = Object.fromEntries((await q(db, `select id, project_kind k, show_id, episode_no from public.turn_projects`)).map((r) => [r.id, r]));
  ok("A: legacy Shows become Shows", kinds[P.S1].k === "show" && kinds[P.S2].k === "show" && kinds[P.S3].k === "show");
  ok("A: legacy Episodes are linked, a string episodeNo included",
    kinds[P.E1].k === "episode" && kinds[P.E2].k === "episode" && kinds[P.E2].episode_no === 2 && kinds[P.E3].episode_no === 3 && kinds[P.E21].show_id === P.S2
    && kinds[P.E32].show_id === P.S3 && kinds[P.E33].episode_no === 3);
  ok("A: broken links stay films (bad number, points at a film, other owner)",
    kinds[P.EBAD].k === "film" && kinds[P.FXP].k === "film" && kinds[P.EXB].k === "film");
  const src = Object.fromEntries((await q(db, `select id, doc ? 'sourceEpisodeId' has, jsonb_typeof(doc->'sourceEpisodeId') t, doc->>'sourceEpisodeId' s
                                                  from public.turn_projects where project_kind = 'show'`)).map((r) => [r.id, r]));
  ok("A: S1's guessed source Episode (Episode 1) is recorded; S2 keeps its recorded one",
    src[P.S1].s === P.E1 && src[P.S2].s === P.E21, src);
  ok("A: S3 (Episode 1 already deleted) records no source Episode (JSON null), not its lowest Episode",
    src[P.S3].has === true && src[P.S3].t === "null", src[P.S3]);
  const mem = await q(db, `select project_id, member_email, role, status from public.turn_project_members order by 1, 2`);
  const m = (pid, email) => mem.filter((r) => r.project_id === pid && r.member_email === email);
  ok("A: source-Episode teams promoted to their Show, Episode rows switched off",
    m(P.S1, "bob@example.com")[0]?.status === "active" && m(P.S2, "bob@example.com")[0]?.status === "active"
    && m(P.E1, "bob@example.com")[0]?.status === "removed" && m(P.E21, "bob@example.com")[0]?.status === "removed", mem);
  ok("A: an Episode-only grant on a non-source Episode is not promoted",
    m(P.E2, "erin@example.com")[0]?.status === "active" && m(P.S1, "erin@example.com").length === 0);
  ok("A: first run does not widen an older Episode-only grant when Episode 1 is gone (Gina stays on S3's E02 only)",
    m(P.E32, "gina@example.com")[0]?.status === "active" && m(P.S3, "gina@example.com").length === 0,
    mem.filter((r) => r.member_email === "gina@example.com"));
  ok("A: first run does not promote a grant added to the source Episode after the Show existed (Hank stays on E21 only)",
    m(P.E21, "hank@example.com")[0]?.status === "active" && m(P.S2, "hank@example.com").length === 0,
    mem.filter((r) => r.member_email === "hank@example.com"));
  const sees = async (who, ids) => {
    const r = await rows(db, who, `select id from public.turn_projects where id = any($1) order by id`, [ids]);
    return r.ok ? r.value.map((x) => x.id).sort().join() : "error: " + r.error;
  };
  const writes = async (who, id) => {
    const r = await affected(db, who, `update public.turn_projects set doc = jsonb_set(doc, '{scenes}', '[{"id":"w1"}]') where id = $1`, [id]);
    return r.ok ? r.value : "error: " + r.error;
  };
  ok("A: Gina reaches S3's E02 (and its Bible) but not E03, and cannot write E03",
    (await sees(U.gina, [P.S3, P.E32, P.E33])) === [P.S3, P.E32].sort().join() && (await writes(U.gina, P.E33)) === 0,
    [await sees(U.gina, [P.S3, P.E32, P.E33]), await writes(U.gina, P.E33)]);
  ok("A: Hank reaches E21 (and S2's Bible) but not E22",
    (await sees(U.hank, [P.S2, P.E21, P.E22])) === [P.S2, P.E21].sort().join(), await sees(U.hank, [P.S2, P.E21, P.E22]));
  ok("A: emails are lower-cased and duplicate spellings collapse to the newest",
    mem.every((r) => r.member_email === r.member_email.trim().toLowerCase())
    && m(P.F3, "carol@example.com").length === 1 && m(P.F3, "carol@example.com")[0].status === "removed"
    && m(P.F2, "carol@example.com")[0]?.role === "writer", mem.filter((r) => r.project_id === P.F3 || r.project_id === P.F2));

  // ── the read-only probe, after ────────────────────────────────────────────
  const post = await runProbe(db, "A after");
  ok("A: probe row 62 lists all four Show functions as present, with no bug note",
    post[62] && post[62].status === "INFO" && ["turn_convert_project_to_show", "turn_create_show_episode", "turn_delete_show_episode", "turn_delete_show("]
      .every((f) => post[62].found.includes(f)) && !/ambiguous|bug/i.test(post[62].found), post[62] && post[62].found);
  ok("A: probe row 80 has nothing left to guess (S3's null counts as recorded)",
    post[80] && /^0 guessed \(Episode 1\), 0 with no Episode 1 \(none recorded\), 1 recorded with no live source Episode$/.test(post[80].found),
    post[80] && post[80].found);
  ok("A: probe row 95 predicts no further promotion after the run (Hank still left alone)",
    leadingNumber(post[95]) === 0 && /, 1 newer grant\(s\)/.test(post[95].found), post[95] && post[95].found);
  ok("A: no installed function still aliases a column as versions(history)",
    (await q(db, `select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%versions(history)%'`))[0].n === 0);

  // ── EXECUTE privileges of every function the file creates ─────────────────
  section("A: privileges");
  const priv = await q(db, `
    select p.proname,
           count(*) over (partition by p.proname)::int n,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
           has_function_privilege('service_role', p.oid, 'EXECUTE') svc
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [CREATED]);
  ok(`A: every one of the ${CREATED.length} functions the file creates exists exactly once`,
    priv.length === CREATED.length && priv.every((r) => r.n === 1), { created: CREATED.length, found: priv.length });
  const called = [...new Set(BROWSER_CALLS.map((c) => c.name))].sort();
  ok("A: the app-facing allow-list is exactly the file's functions that any app/ file calls",
    JSON.stringify(called) === JSON.stringify(APP_RPCS), { calledByApp: called, allowList: APP_RPCS });
  ok("A: the scan sees the app's calls (at least one per allow-listed RPC)", APP_RPCS.every((n) => (APP_ARGS[n] || []).length > 0), APP_ARGS);
  const unreadable = [...BROWSER_CALLS, ...EDGE_CALLS].filter((c) => c.keys === null).map((c) => c.at + " " + c.name);
  ok("A: every call to one of the file's functions passes a literal argument object the test can read", unreadable.length === 0, unreadable);
  const sig = Object.fromEntries((await q(db, `
    select p.proname,
           coalesce((select array_agg(a.name order by a.ord)
                       from unnest(p.proargnames, p.proargmodes::text[]) with ordinality a(name, mode, ord)
                      where coalesce(a.mode, 'i') in ('i', 'b', 'v')), array[]::text[]) args,
           p.pronargs - p.pronargdefaults required
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [CREATED])).map((r) => [r.proname, r]));
  const badArgs = [];
  for (const c of [...BROWSER_CALLS, ...EDGE_CALLS].filter((x) => x.keys)) {
    const s = sig[c.name];
    const unknown = c.keys.filter((k) => !s.args.includes(k));
    const missing = s.args.slice(0, s.required).filter((k) => !c.keys.includes(k));
    if (unknown.length || missing.length) badArgs.push(`${c.at} ${c.name}: unknown ${unknown.join("/") || "-"}, missing ${missing.join("/") || "-"}`);
  }
  ok("A: every app and edge-function call sends argument names the SQL function has, and all its required ones",
    badArgs.length === 0, badArgs);
  const edgeDenied = EDGE_CALLS.filter((c) => !priv.find((r) => r.proname === c.name)?.svc).map((c) => c.at + " " + c.name);
  ok("A: every one of the file's functions an edge function calls is executable by service_role", edgeDenied.length === 0, edgeDenied);
  const policyText = (await q(db, `select coalesce(qual, '') || ' ' || coalesce(with_check, '') t from pg_policies`)).map((r) => r.t).join("\n");
  const inPolicies = CREATED.filter((n) => new RegExp("\\b" + n + "\\(").test(policyText)).sort();
  ok("A: the RLS-helper allow-list is exactly the file's functions used by RLS policies",
    JSON.stringify(inPolicies) === JSON.stringify(RLS_HELPERS), inPolicies);
  const badAnon = priv.filter((r) => r.anon !== RLS_HELPERS.includes(r.proname)).map((r) => r.proname + (r.anon ? " (anon CAN)" : " (anon cannot)"));
  ok("A: anon can execute only the RLS helpers (no RPC, no internal helper)", badAnon.length === 0, badAnon);
  const authAllowed = new Set([...APP_RPCS, ...RLS_HELPERS]);
  const badAuth = priv.filter((r) => r.auth !== authAllowed.has(r.proname)).map((r) => r.proname + (r.auth ? " (authenticated CAN)" : " (authenticated cannot)"));
  ok("A: authenticated can execute exactly the app RPCs plus the RLS helpers", badAuth.length === 0, badAuth);
  ok("A: service_role can execute the cleanup-worker contract",
    SERVICE_ONLY.every((n) => priv.find((r) => r.proname === n)?.svc));
  const anonHelper = await rows(db, "anon", `select public.turn_series_try_uuid('x')`);
  ok("A: anon calling an internal helper is refused", !anonHelper.ok && /permission denied/.test(anonHelper.error), anonHelper);
  const anonRpc = await appRpc(db, "anon", "turn_delete_show", { p_show_id: P.S1 });
  ok("A: anon calling a lifecycle RPC is refused", !anonRpc.ok && /permission denied/.test(anonRpc.error), anonRpc);
  const authHelper = await rows(db, U.bob, `select * from public.turn_effective_project_roles($1)`, [P.S1]);
  ok("A: a signed-in user calling an internal definer helper is refused", !authHelper.ok && /permission denied/.test(authHelper.error), authHelper);
  const authWorker = await rows(db, U.alice, `select * from public.turn_claim_asset_cleanup_batch(p_limit => 5)`);
  ok("A: a signed-in user cannot lease the cleanup queue", !authWorker.ok && /permission denied/.test(authWorker.error), authWorker);

  // ── the app's lifecycle RPCs, as the owner ────────────────────────────────
  section("A: app lifecycle RPCs");
  const conv = await appRpc(db, U.alice, "turn_convert_project_to_show",
    { p_episode_id: P.F1, p_show_title: "Neon Harbor — Show", p_bible: JSON.stringify(bibleFor(P.F1)), p_format: "series" }, { commit: true });
  const NS = conv.ok && conv.value[0].r.show.id;
  ok("A: convert a film into a Show succeeds (Episode 1 attached)",
    conv.ok && conv.value[0].r.episode.project_kind === "episode" && conv.value[0].r.episode.show_id === NS, conv.error);
  const REQ = "3d0c1f5e-7a2b-4c9d-8e1f-5a6b7c8d9e0f";
  const created = await appRpc(db, U.alice, "turn_create_show_episode",
    { p_show_id: NS, p_episode_doc: JSON.stringify(emptyEpisode(null, null, "")), p_request_id: REQ }, { commit: true });
  const EP2 = created.ok && created.value[0].r.episode.id;
  ok("A: create Episode 2 succeeds and is numbered 2", created.ok && created.value[0].r.episode_no === 2, created.error);
  const replay = await appRpc(db, U.alice, "turn_create_show_episode", { p_show_id: NS, p_episode_doc: "{}", p_request_id: REQ });
  ok("A: a retried create with the same request id returns the same Episode",
    replay.ok && replay.value[0].r.idempotent_replay === true && replay.value[0].r.episode.id === EP2, replay.error);
  // an upload reserved on Episode 2 and uploaded, but never committed, must survive the delete as a queued obligation
  const ep2Upload = `${A}/${EP2}/shot/shot-7/20260301-100000-sheet-aaaa7777.png`;
  const reserveEp2 = await appRpc(db, U.alice, "turn_begin_asset_upload", { p_project_id: EP2, p_path: ep2Upload }, { commit: true });
  const ep2Bytes = await affected(db, U.alice, `insert into storage.objects(bucket_id, name, owner) values ('turn-assets', $1, $2)`, [ep2Upload, A], { commit: true });
  ok("A: begin an asset upload on Episode 2 and upload its bytes", reserveEp2.ok && ep2Bytes.ok && ep2Bytes.value === 1, [reserveEp2.error, ep2Bytes.error]);
  const delEp = await appRpc(db, U.alice, "turn_delete_show_episode", { p_episode_id: EP2 }, { commit: true });
  ok("A: delete Episode 2 succeeds", delEp.ok && delEp.value[0].r.remaining_episode_count === 1, delEp.error);
  ok("A: Episode 2 is gone and its unfinished upload is queued for cleanup",
    (await q(db, `select count(*)::int n from public.turn_projects where id = $1`, [EP2]))[0].n === 0
    && (await q(db, `select reason from public.turn_asset_cleanup_queue where path = $1`, [ep2Upload]))[0]?.reason === "project_deleted");
  // Documented in supabase/README.md: once the project row is gone, nobody signed
  // in can remove its bytes (Storage's read rule needs the project), not even the
  // uploader whose key is in the cleanup queue. The service-role worker is not built yet.
  const queuedRm = await rows(db, U.alice, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1 returning name`, [ep2Upload], { commit: true });
  ok("A: (README) the uploader's Storage delete of a queued key of a deleted Episode removes nothing",
    queuedRm.ok && queuedRm.value.length === 0 && (await q(db, `select count(*)::int n from storage.objects where name = $1`, [ep2Upload]))[0].n === 1, queuedRm);
  const finalEp = await appRpc(db, U.alice, "turn_delete_show_episode", { p_episode_id: P.F1 });
  ok("A: deleting the final Episode is refused (the Show must be deleted instead)",
    !finalEp.ok && /delete the Show to remove its final Episode/.test(finalEp.error), finalEp);
  const direct = await affected(db, U.alice, `delete from public.turn_projects where id = $1`, [NS]);
  ok("A: a direct REST delete of a Show is still blocked", !direct.ok && /requires the series lifecycle operation/.test(direct.error), direct);
  const delShow = await appRpc(db, U.alice, "turn_delete_show", { p_show_id: NS }, { commit: true });
  const dsr = delShow.ok && delShow.value[0].r;
  ok("A: delete the Show succeeds", delShow.ok && dsr.episode_count === 1, delShow.error);
  ok("A: the Show and its Episode 1 are gone",
    (await q(db, `select count(*)::int n from public.turn_projects where id = any($1)`, [[NS, P.F1]]))[0].n === 0);
  ok("A: the delete snapshot includes history refs and history cleanupPending keys",
    dsr && [path.f1neo, path.f1neoRef, path.f1neoOld, path.f1neoOldRef, path.f1neoOldTmp].every((p) => dsr.generation_storage_paths.includes(p)), dsr && dsr.generation_storage_paths);
  ok("A: cameo keys of every capturer are returned and authorized for cleanup",
    dsr && [path.f1cameo, path.bobOnF1cameo].every((p) => dsr.cameo_storage_paths.includes(p) && dsr.authorized_cleanup_paths.includes(p)), dsr && dsr.cameo_storage_paths);
  const grantOwner = await rows(db, U.alice, `select public.turn_can_delete_asset_path($1) r`, [path.f1neoOld]);
  const grantOther = await rows(db, U.bob, `select public.turn_can_delete_asset_path($1) r`, [path.f1neoOld]);
  ok("A: the owner holds an exact-path delete grant for the deleted Show's files; nobody else does",
    grantOwner.ok && grantOwner.value[0].r === true && grantOther.ok && grantOther.value[0].r === false, [grantOwner, grantOther]);
  // Known limitation, out of scope for this file and documented in the README: a
  // Storage DELETE with a WHERE clause must also pass the SELECT policy ("turn
  // assets read collab"), which needs the now-deleted project, so the grant alone
  // cannot remove the bytes. If this starts removing the file, update the README.
  const rm = await affected(db, U.alice, `delete from storage.objects where bucket_id = 'turn-assets' and name = $1`, [path.f1neoOld]);
  ok("A: (README, known limitation) the owner's Storage delete of a granted file after the Show is gone removes nothing",
    rm.ok && rm.value === 0, rm);
  const fin = await appRpc(db, U.alice, "turn_finish_asset_cleanup", { p_project_ids: [NS, P.F1, EP2] }, { commit: true });
  ok("A: finishing cleanup releases the grants", fin.ok && fin.value[0].r > 0
    && (await q(db, `select count(*)::int n from public.turn_asset_cleanup_grants where project_id = any($1)`, [[NS, P.F1]]))[0].n === 0, fin);

  // ── upload reservations ───────────────────────────────────────────────────
  section("A: asset uploads and collaborator access");
  const aliceUpload = `${A}/${P.F2}/character/trin/20260201-100000-sheet-aaaa9999.png`;
  const begin = await appRpc(db, U.alice, "turn_begin_asset_upload", { p_project_id: P.F2, p_path: aliceUpload }, { commit: true });
  ok("A: begin an asset upload (owner)", begin.ok && !!begin.value[0].r, begin.error);
  const finish = await appRpc(db, U.alice, "turn_finish_asset_upload", { p_paths: [aliceUpload] }, { commit: true });
  ok("A: finish the asset upload", finish.ok && finish.value[0].r === 1, finish.error);

  // art director: reserve, upload into their own folder, commit a generation row
  const bobUpload = `${B}/${P.F2}/prop/lamp/20260202-100000-sheet-bbbb9999.png`;
  const bobBegin = await appRpc(db, U.bob, "turn_begin_asset_upload", { p_project_id: P.F2, p_path: bobUpload }, { commit: true });
  const bobObject = await affected(db, U.bob, `insert into storage.objects(bucket_id, name, owner) values ('turn-assets', $1, $2)`, [bobUpload, B], { commit: true });
  const bobGen = await affected(db, U.bob, `insert into public.turn_generations(project_id, owner, entity_id, storage_path) values ($1, $2, 'lamp', $3)`, [P.F2, B, bobUpload], { commit: true });
  ok("A: an art director can reserve, upload and record an asset",
    bobBegin.ok && bobObject.ok && bobObject.value === 1 && bobGen.ok && bobGen.value === 1, [bobBegin.error, bobObject.error, bobGen.error]);
  ok("A: committing the generation retires the art director's reservation",
    (await q(db, `select count(*)::int n from public.turn_asset_upload_intents where path = $1`, [bobUpload]))[0].n === 0);
  const bobCameoUpload = `${B}/${P.F2}/cameo/trin/20260203-100000-left-bbbb8888.png`;
  await appRpc(db, U.bob, "turn_begin_asset_upload", { p_project_id: P.F2, p_path: bobCameoUpload }, { commit: true });
  const bobCameo = await affected(db, U.bob, `update public.turn_cameos set angles = angles || $1::jsonb where project_id = $2 and char_id = 'trin'`,
    [JSON.stringify([{ label: "left", storage_path: bobCameoUpload }]), P.F2], { commit: true });
  ok("A: an art director can edit their cameo, and that retires its reservation",
    bobCameo.ok && bobCameo.value === 1 && (await q(db, `select count(*)::int n from public.turn_asset_upload_intents where path = $1`, [bobCameoUpload]))[0].n === 0, bobCameo);

  // writer (mixed-case email invite, never linked to an account id)
  const carolDoc = await rows(db, U.carol, `select doc from public.turn_projects where id = $1`, [P.F2]);
  ok("A: a writer invited by a mixed-case email can read the film", carolDoc.ok && carolDoc.value.length === 1, carolDoc);
  const doc = carolDoc.ok ? carolDoc.value[0].doc : {};
  const save = await affected(db, U.carol, `update public.turn_projects set doc = $1 where id = $2`,
    [JSON.stringify({ ...doc, scenes: [...doc.scenes, { id: "s3", title: "Carol's scene" }], _rev: doc._rev + 1 }), P.F2], { commit: true });
  ok("A: a writer's doc save still works (role trigger finds turn_role_allowed_sections)", save.ok && save.value === 1, save);
  const outOfScope = await affected(db, U.carol, `update public.turn_projects set doc = jsonb_set(doc, '{characters}', '[]') where id = $1`, [P.F2]);
  ok("A: a writer still cannot change the art department's sections", !outOfScope.ok && /TURN_ROLE_SCOPE/.test(outOfScope.error), outOfScope);
  const carolUpload = await appRpc(db, U.carol, "turn_begin_asset_upload",
    { p_project_id: P.F2, p_path: `${C}/${P.F2}/prop/x/20260204-100000-sheet-cccc7777.png` });
  ok("A: a writer cannot reserve an asset upload", !carolUpload.ok && /Art Room write access/.test(carolUpload.error), carolUpload);

  // Show-level membership reaches every Episode
  const bobEp = await rows(db, U.bob, `select id, doc from public.turn_projects where id = $1`, [P.E3]);
  ok("A: a promoted Show writer can read a sibling Episode", bobEp.ok && bobEp.value.length === 1, bobEp);
  const bobEpSave = await affected(db, U.bob, `update public.turn_projects set doc = jsonb_set(doc, '{scenes}', '[{"id":"z1"}]') where id = $1`, [P.E3], { commit: true });
  ok("A: a promoted Show writer can save that Episode's scenes", bobEpSave.ok && bobEpSave.value === 1, bobEpSave);
  const owners = await appRpc(db, U.bob, "turn_shared_film_owners", {}, { table: true });
  ok("A: turn_shared_film_owners works for a signed-in collaborator (inherited rows included)",
    owners.ok && owners.value.some((r) => r.project_id === P.E3) && owners.value.some((r) => r.project_id === P.F2), owners);

  // outsider and anon read nothing
  const TABLES = ["public.turn_projects", "public.turn_generations", "public.turn_project_members", "public.turn_cameos",
    "storage.objects", "public.turn_asset_upload_intents", "public.turn_asset_cleanup_queue", "public.turn_asset_cleanup_grants"];
  for (const who of [U.dave, "anon"]) {
    const name = who === "anon" ? "anon" : "an outsider";
    const seen = [];
    for (const t of TABLES) {
      const r = await rows(db, who, `select count(*)::int n from ${t}`);
      if (r.ok && r.value[0].n > 0) seen.push(t + "=" + r.value[0].n);
      if (!r.ok && !/permission denied/.test(r.error)) seen.push(t + " error " + r.error);
    }
    ok(`A: ${name} can read nothing`, seen.length === 0, seen);
  }
  const daveDel = await appRpc(db, U.dave, "turn_delete_show", { p_show_id: P.S1 });
  ok("A: an outsider cannot delete someone else's Show", !daveDel.ok && /only the Show owner/.test(daveDel.error), daveDel);
  const daveUpd = await affected(db, U.dave, `update public.turn_projects set title = 'x' where id = $1`, [P.F2]);
  ok("A: an outsider cannot update a film", daveUpd.ok && daveUpd.value === 0, daveUpd);

  // ── cameo rules ───────────────────────────────────────────────────────────
  section("A: cameo rules");
  const carolEditsOwn = await affected(db, U.carol, `update public.turn_cameos set prov = '{"x":1}' where owner = $1 and project_id = $2`, [C, P.F2]);
  ok("A: a collaborator who is not an art director can no longer edit their cameo", carolEditsOwn.ok && carolEditsOwn.value === 0, carolEditsOwn);
  const carolEditsBobs = await affected(db, U.carol, `update public.turn_cameos set prov = '{"x":1}' where owner = $1 and project_id = $2`, [B, P.F2]);
  ok("A: ...and cannot update another person's cameo", carolEditsBobs.ok && carolEditsBobs.value === 0, carolEditsBobs);
  const carolAdds = await affected(db, U.carol, `insert into public.turn_cameos(project_id, owner, char_id, angles) values ($1, $2, 'new-cam', '[]')`, [P.F2, C]);
  ok("A: ...and cannot add a cameo to the project", !carolAdds.ok && /row-level security/.test(carolAdds.error), carolAdds);
  // cloudDeleteCameo removes the photos first, through the Storage API (a
  // DELETE ... RETURNING as the signed-in user), then the row.
  const storageDelete = (who, name) => rows(db, who,
    `delete from storage.objects where bucket_id = 'turn-assets' and name = $1 returning name`, [name], { commit: true });
  const carolPhoto = await storageDelete(U.carol, path.f2carolCameo);
  ok("A: ...and can delete her own cameo photo, so deleting the cameo leaves no orphaned face image",
    carolPhoto.ok && carolPhoto.value.length === 1, carolPhoto);
  const carolBobPhoto = await storageDelete(U.carol, path.f2cameo);
  ok("A: ...but not another person's cameo photo", carolBobPhoto.ok && carolBobPhoto.value.length === 0, carolBobPhoto);
  const carolSheet = await storageDelete(U.carol, path.f2carolSheet);
  ok("A: ...nor project material in her own folder (that still needs Art Room write access)",
    carolSheet.ok && carolSheet.value.length === 0, carolSheet);
  const daveBobPhoto = await storageDelete(U.dave, path.f2cameo);
  ok("A: an outsider cannot delete anyone's cameo photo", daveBobPhoto.ok && daveBobPhoto.value.length === 0, daveBobPhoto);
  const bobPhotoAgain = await rows(db, U.bob, `select count(*)::int n from storage.objects where name = any($1)`, [[path.f2cameo, path.f2carolSheet, path.f2carolCameo]]);
  ok("A: Bob's photo and Carol's sheet are still there; Carol's photo is gone",
    bobPhotoAgain.ok && bobPhotoAgain.value[0].n === 2, bobPhotoAgain);
  const carolDeletes = await affected(db, U.carol, `delete from public.turn_cameos where owner = $1 and project_id = $2`, [C, P.F2], { commit: true });
  ok("A: ...but can still delete their own cameo row", carolDeletes.ok && carolDeletes.value === 1, carolDeletes);
  const carolDeletesBobs = await affected(db, U.carol, `delete from public.turn_cameos where owner = $1`, [B]);
  ok("A: ...and cannot delete another person's cameo", carolDeletesBobs.ok && carolDeletesBobs.value === 0, carolDeletesBobs);

  // ── cleanup-worker contract (service_role) ────────────────────────────────
  section("A: cleanup queue worker contract");
  const claim = await rows(db, "service", `select * from public.turn_claim_asset_cleanup_batch(p_limit => 10)`, [], { commit: true });
  ok("A: service_role can lease queued keys (queue kept until it is available)", claim.ok, claim.error);
  await db.query(`update public.turn_asset_cleanup_queue set available_at = now() - interval '1 minute' where path = $1`, [ep2Upload]);
  const claim2 = await rows(db, "service", `select * from public.turn_claim_asset_cleanup_batch(p_limit => 10)`, [], { commit: true });
  const lease = claim2.ok && claim2.value.find((r) => r.path === ep2Upload);
  ok("A: a due queued key is leased with a token", !!lease && !!lease.lease_token, claim2);
  const done = await rows(db, "service", `select public.turn_complete_asset_cleanup(p_path => $1, p_lease_token => $2, p_confirmed_removed => true) r`,
    [ep2Upload, lease && lease.lease_token], { commit: true });
  ok("A: completing the lease removes the queued key", done.ok && done.value[0].r === true
    && (await q(db, `select count(*)::int n from public.turn_asset_cleanup_queue where path = $1`, [ep2Upload]))[0].n === 0, done);

  // ── re-run after Episode 1 of a legacy Show is deleted ────────────────────
  section("A: re-run after deleting a legacy Show's Episode 1");
  const delE1 = await appRpc(db, U.alice, "turn_delete_show_episode", { p_episode_id: P.E1 }, { commit: true });
  const e1r = delE1.ok && delE1.value[0].r;
  ok("A: delete legacy Episode 1 succeeds", delE1.ok, delE1.error);
  ok("A: its own keys are authorized for cleanup; a key the Show still references is protected",
    e1r && [path.e1shot, path.e1shotOld, path.e1pending].every((p) => e1r.authorized_cleanup_paths.includes(p))
    && !e1r.authorized_cleanup_paths.includes(path.e1maraLegacy) && e1r.protected_storage_paths.includes(path.e1maraLegacy), e1r);
  // After the first run the owner (or a stale client inviting on the open
  // Episode) adds an Episode-only grant on S2's recorded source Episode.
  const zedGrant = await affected(db, U.alice, `insert into public.turn_project_members(project_id, owner, member_email, role, status)
                                                 values ($1, $2, 'zed@example.com', 'view_only', 'active')`, [P.E21, A], { commit: true });
  ok("A: an Episode-only grant is added on a recorded source Episode after the first run", zedGrant.ok && zedGrant.value === 1, zedGrant);
  const probeGone = await runProbe(db, "A after Episode 1 deleted");
  ok("A: probe row 80 reports the recorded source Episode as gone (nobody to promote)",
    probeGone[80] && /^0 guessed \(Episode 1\), 0 with no Episode 1 \(none recorded\), 2 recorded with no live source Episode$/.test(probeGone[80].found),
    probeGone[80] && probeGone[80].found);
  ok("A: probe row 95 predicts no promotions (Hank and Zed are newer than S2)",
    leadingNumber(probeGone[95]) === 0 && /, 2 newer grant\(s\)/.test(probeGone[95].found), probeGone[95] && probeGone[95].found);
  const membersBefore = await q(db, `select id, project_id, member_email, role, status from public.turn_project_members order by id`);
  const run3 = await runFile(db, "series-production.sql", SERIES);
  ok("A: re-run succeeds", run3.ok, run3.error);
  const membersAfter = await q(db, `select id, project_id, member_email, role, status from public.turn_project_members order by id`);
  ok("A: the re-run promotes nobody new and changes no membership", JSON.stringify(membersBefore) === JSON.stringify(membersAfter),
    membersAfter.filter((r) => !membersBefore.some((b) => JSON.stringify(b) === JSON.stringify(r))));
  ok("A: Erin's Episode-only grant on Episode 2 stays Episode-only",
    membersAfter.filter((r) => r.member_email === "erin@example.com").map((r) => r.project_id + ":" + r.status).join() === P.E2 + ":active");
  ok("A: Zed's grant on the recorded source Episode is not promoted by the re-run",
    membersAfter.filter((r) => r.member_email === "zed@example.com").map((r) => r.project_id + ":" + r.status).join() === P.E21 + ":active");
  ok("A: Zed reaches E21 (and S2's Bible) but not E22",
    (await rows(db, U.zed, `select id from public.turn_projects where id = any($1) order by id`, [[P.S2, P.E21, P.E22]])).value?.map((r) => r.id).sort().join()
      === [P.S2, P.E21].sort().join());
  ok("A: S1's recorded source Episode is kept, not re-guessed",
    (await q(db, `select doc->>'sourceEpisodeId' s from public.turn_projects where id = $1`, [P.S1]))[0].s === P.E1);
  const erin = { id: "e7170000-0000-4000-8000-000000000005", email: "erin@example.com" };
  await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())`, [erin.id, erin.email]);
  const erinSees = await rows(db, erin, `select id from public.turn_projects where id = any($1) order by id`, [[P.E2, P.E3]]);
  ok("A: Erin still reaches Episode 2 only, not its sibling", erinSees.ok && erinSees.value.map((r) => r.id).join() === P.E2, erinSees);
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   B. Prerequisites missing: the guard stops the run before anything exists
   ═══════════════════════════════════════════════════════════════════════════ */
async function expectStopped(label, db, patterns) {
  const before = await snapshot(db);
  const r = await runFile(db, "series-production.sql", SERIES);
  const stopped = !r.ok && /^TURN_SERIES_PREREQUISITE: series-production\.sql stopped before changing anything/.test(r.error);
  for (const pattern of [].concat(patterns)) {
    ok(`${label}: the run stops with a TURN_SERIES_PREREQUISITE message naming ${pattern}`,
      stopped && r.error.includes(pattern), r.error);
  }
  const d = diff(before, await snapshot(db));
  ok(`${label}: nothing was created or changed (functions, tables, columns, triggers, policies, data)`, d.length === 0, d);
  const leftovers = await q(db, `select
      (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like any (array['turn_series_%','turn_delete_show%','turn_begin_asset_upload']))::int fns,
      (select count(*) from pg_class where relname like 'turn_asset_%')::int rels,
      (select count(*) from information_schema.columns where table_name = 'turn_projects' and column_name in ('project_kind','show_id','episode_no'))::int cols`);
  ok(`${label}: no series function, table or column exists afterwards`,
    leftovers[0].fns === 0 && leftovers[0].rels === 0 && leftovers[0].cols === 0, leftovers[0]);
  return r;
}

section("B1: team-collaboration.sql and enforce-role-scopes.sql never ran");
{
  const db = await newDb();
  await chain(db, ["schema.sql", "storage.sql", "cameos.sql", "credits.sql"]);
  await seed(db, { memberships: false });
  const pr = await runProbe(db, "B1");
  ok("B1: probe predicts STOP (members table, helpers, role sections)",
    pr[0]?.status === "STOP" && pr[32]?.status === "STOP" && pr[42]?.status === "STOP", [pr[0]?.found, pr[32]?.found, pr[42]?.found]);
  const r = await expectStopped("B1", db, "team-collaboration.sql");
  ok("B1: the message also names enforce-role-scopes.sql", /enforce-role-scopes\.sql/.test(r.error || ""));
  await db.close();
}

section("B2: team-collaboration.sql older than commit d4242ad, enforce-role-scopes.sql never ran");
{
  const db = await newDb();
  await chain(db, ["schema.sql", "storage.sql", "team-collaboration.sql", "invitations.sql", "shared-owners.sql", "cameos.sql", "credits.sql"]);
  // Older copies of team-collaboration.sql did not define the per-role section lists.
  await db.exec(`drop function public.turn_role_allowed_sections(text)`);
  await seed(db);
  const pr = await runProbe(db, "B2");
  ok("B2: probe row 42 is STOP", pr[42]?.status === "STOP", pr[42]?.found);
  await expectStopped("B2", db, "turn_role_allowed_sections(text)");
  const again = await runFile(db, "series-production.sql", SERIES);
  ok("B2: the message says to run enforce-role-scopes.sql first", !again.ok && /run enforce-role-scopes\.sql first/.test(again.error), again.error);
  ok("B2: the message dates team-collaboration.sql by commit (d4242ad), not by a day that older copies share",
    !again.ok && /from commit d4242ad on/.test(again.error) && !/31 August/.test(again.error), again.error);
  const fix = await runFile(db, "enforce-role-scopes.sql");
  const r = await runFile(db, "series-production.sql", SERIES);
  ok("B2: after enforce-role-scopes.sql the migration runs", fix.ok && r.ok, fix.error || r.error);
  await db.close();
}

section("B3: every other object the guard checks is missing or has the wrong shape");
{
  const db = await newDb();
  await chain(db, README_CHAIN);
  await seed(db);
  // Each line breaks one check. The guard collects every problem before it
  // raises, so one run proves each check fires (and that none of them crashes
  // on a database this broken).
  await db.exec(`
    alter role service_role rename to service_role_gone;
    alter function auth.uid() rename to uid_gone;
    alter table auth.users rename column email to email_gone;
    alter table public.turn_generations rename column history to history_gone;
    alter table public.turn_cameos rename column angles to angles_gone;
    alter table public.turn_project_members drop constraint turn_project_members_project_id_member_email_key;
    alter function public.turn_current_email() rename to turn_current_email_gone;
    alter function public.turn_storage_project_id(text) rename to turn_storage_project_id_gone;
    drop function public.turn_can_access_project(uuid, boolean) cascade;
    create function public.turn_can_access_project(p_project uuid, p_write boolean default false)
      returns boolean language sql stable as 'select false';
    drop function public.turn_can_write_assets(uuid) cascade;
    create function public.turn_can_write_assets(project uuid) returns boolean language sql stable as 'select false';
    drop function public.turn_shared_film_owners();
    create function public.turn_shared_film_owners() returns table(project_id uuid, email text)
      language sql stable as 'select null::uuid, null::text where false';
  `);
  const pr = await runProbe(db, "B3");
  const probeStops = [20, 21, 22, 31, 33, 34, 40, 41, 43, 44, 45].filter((o) => pr[o]?.status !== "STOP");
  ok("B3: the probe marks every one of these as STOP", pr[0]?.status === "STOP" && probeStops.length === 0,
    probeStops.map((o) => o + " " + (pr[o] && pr[o].status + " " + pr[o].found)));
  await expectStopped("B3", db, [
    "missing roles service_role",
    "missing functions auth.uid()",
    "missing columns email on auth.users (part of Supabase Auth)",
    "missing columns history on public.turn_generations (run schema.sql first)",
    "missing columns angles on public.turn_cameos (re-run cameos.sql first)",
    "missing the unique (project_id, member_email) key on public.turn_project_members",
    "missing function public.turn_current_email()",
    "missing function public.turn_storage_project_id(text)",
    "turn_can_access_project(uuid, boolean) must have the arguments (pid, write_access)",
    "turn_can_write_assets(uuid) must have the argument (pid)",
    "turn_shared_film_owners() must return TABLE(project_id uuid, owner_email text)",
  ]);
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   C. A member still holds the retired producer_admin role
   ═══════════════════════════════════════════════════════════════════════════ */
section("C: producer_admin member present");
{
  const db = await newDb();
  await chain(db, README_CHAIN);
  await seed(db);
  // As on a database set up with the July team-collaboration.sql, which allowed the role.
  await db.exec(`alter table public.turn_project_members drop constraint turn_project_members_role_check;
                 alter table public.turn_project_members add constraint turn_project_members_role_check
                   check (role in ('view_only','writer','art_director','producer_admin'));`);
  await db.query(`insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status)
                  values ($1, $2, 'dave@example.com', $3, 'producer_admin', 'active')`, [P.F2, A, U.dave.id]);
  const pr = await runProbe(db, "C");
  ok("C: probe row 53 is STOP", pr[53]?.status === "STOP" && /producer_admin 1/.test(pr[53].found), pr[53]?.found);
  await expectStopped("C", db, "migrate-remove-producer-admin.sql");
  const fix = await runFile(db, "migrate-remove-producer-admin.sql");
  const r = await runFile(db, "series-production.sql", SERIES);
  ok("C: after migrate-remove-producer-admin.sql the migration runs", fix.ok && r.ok, fix.error || r.error);
  const role = (await q(db, `select role from public.turn_project_members where member_email = 'dave@example.com'`))[0]?.role;
  ok("C: the former producer_admin is a writer", role === "writer", role);
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   D. Re-run over Show Bibles holding keys for no live Episode
   ═══════════════════════════════════════════════════════════════════════════ */
section("D: re-run after a run that recorded no sourceEpisodeId, Bible keys for no live Episode");
{
  const db = await newDb();
  await chain(db, README_CHAIN);
  await seed(db);
  const S4 = "5e400000-0000-4000-8000-000000000054";   // its only Episode has episodeNo "two" and stays a film
  const EB4 = "eb400000-0000-4000-8000-0000000000e4";
  const S5 = "5e500000-0000-4000-8000-000000000055";   // no Episodes; Bible holds the '__episode1__' alias
  const legacyBible = (episodeScenes) => ({
    characters: [{ id: "mara", name: "Mara", scenes: ["s1"], episodeScenes }],
    locations: [], props: [], lookbook: [], lookbookNote: "",
  });
  await db.query(`insert into public.turn_projects(id, owner, title, doc) values
      ($1, $4, 'Standalone-episode Show', $5), ($2, $4, 'Standalone E??', $6), ($3, $4, 'Alias Show', $7)`,
    [S4, EB4, S5, A,
      JSON.stringify({ isShow: true, bible: legacyBible({ [EB4]: ["s1"] }), _rev: 4 }),
      JSON.stringify({ showId: S4, episodeNo: "two", scenes: [{ id: "s1", title: "keep me" }], _rev: 1 }),
      JSON.stringify({ isShow: true, bible: legacyBible({ __episode1__: ["s1"] }), _rev: 2 })]);
  const pr = await runProbe(db, "D before");
  ok("D: probe row 82 counts both Shows as REVIEW", pr[82]?.status === "REVIEW" && pr[82].found === "2", pr[82] && pr[82].found);
  const r1 = await runFile(db, "series-production.sql", SERIES);
  ok("D: first run succeeds", r1.ok, r1.error);
  // What a database that ran an earlier copy of this file looks like: that copy
  // recorded sourceEpisodeId only when it found a source Episode, and it left
  // the Bible-key trigger installed.
  await db.exec(`alter table public.turn_projects disable trigger turn_validate_show_bible_episode_keys;
                 update public.turn_projects set doc = doc - 'sourceEpisodeId' where id in ('${S4}', '${S5}');
                 alter table public.turn_projects enable trigger turn_validate_show_bible_episode_keys;`);
  const trig = async () => (await q(db, `select count(*)::int n from pg_trigger where tgname = 'turn_validate_show_bible_episode_keys' and tgenabled <> 'D'`))[0].n;
  ok("D: the previous run's Bible-key trigger is installed before the re-run", (await trig()) === 1);
  const r2 = await runFile(db, "series-production.sql", SERIES);
  ok("D: the re-run succeeds instead of stopping on the previous run's Bible-key trigger", r2.ok, r2.error);
  const shows = Object.fromEntries((await q(db, `select id, jsonb_typeof(doc->'sourceEpisodeId') t, doc->'bible'->'characters'->0->'episodeScenes' es
                                                   from public.turn_projects where id = any($1)`, [[S4, S5]])).map((r) => [r.id, r]));
  ok("D: both Shows now record no source Episode (null), so nobody is promoted",
    shows[S4]?.t === "null" && shows[S5]?.t === "null", shows);
  ok("D: the re-run leaves their Bible keys as they were (no data removed)",
    JSON.stringify(shows[S4]?.es) === JSON.stringify({ [EB4]: ["s1"] }) && JSON.stringify(shows[S5]?.es) === JSON.stringify({ __episode1__: ["s1"] }), shows);
  ok("D: the Bible-key trigger is installed again after the re-run", (await trig()) === 1);
  const after2 = await snapshot(db);
  const r3 = await runFile(db, "series-production.sql", SERIES);
  const d23 = diff(after2, await snapshot(db));
  ok("D: a further run succeeds and changes nothing", r3.ok && d23.length === 0, r3.error || d23);
  // The trigger still guards ordinary saves: the owner cannot add a key for an Episode of no Show.
  const bogus = "b0905000-0000-4000-8000-000000000999";
  const bad = await affected(db, U.alice, `update public.turn_projects
       set doc = jsonb_set(doc, '{bible,characters}', $2::jsonb) where id = $1`,
    [P.S1, JSON.stringify([{ id: "mara", name: "Mara", scenes: ["s1"], episodeScenes: { [bogus]: ["s1"] } }])]);
  ok("D: an owner save that adds a key for no live Episode is still refused, and the error names the Show",
    !bad.ok && /does not identify a live Episode of this Show/.test(bad.error) && bad.error.includes(P.S1), bad);
  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
   R. README statements this file backs
   ═══════════════════════════════════════════════════════════════════════════ */
section("R: supabase/README.md");
{
  const lastRule = README.slice(README.indexOf("must always be the LAST"), README.indexOf("Not implemented yet"));
  const reverting = ["migrate-remove-producer-admin.sql", "shared-owners.sql", "team-collaboration.sql",
    "enforce-role-scopes.sql", "storage.sql", "cameos.sql"];
  ok("R: the README's re-run-last list names every file whose re-run reverts the Show-aware rules",
    lastRule.length > 0 && reverting.every((f) => lastRule.includes("`" + f + "`")), reverting.filter((f) => !lastRule.includes("`" + f + "`")));
  ok("R: the README points operators to the read-only probe", /series-production-probe\.sql/.test(README));
  ok("R: the README says the cleanup-queue worker is not implemented and that nothing removes those bytes until it is",
    /Not implemented yet: the scheduled service-role worker/.test(README) && /nothing removes a queued\s+upload's bytes/.test(README)
    && !/unless the uploader's own client removes them/.test(README));
  ok("R: the README says deleting a Cameo's photos stays the capturer's right", /deleting its\s+photos while they can still open the project/.test(README));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

/* Admin storage inventory (supabase/admin-inventory.sql) — runs the real SQL file
   against an in-memory Postgres (PGlite) with stub auth/storage schemas and the
   public tables the views read (real column names from the migrations), then
   checks every classification, the safe-to-delete list, privacy, idempotency,
   the preflight guard, that only postgres can read the schema, that a Show-
   promotion copy a retry would reuse is never offered for deletion, and that
   each storage key is parsed once per file (query plan).
   Then the same file runs on a LEGACY database (series-production.sql never
   applied: no project_kind / show_id / episode_no, no upload reservations, no
   cleanup queue; Shows and Episodes marked only in the doc, as the app writes
   them there), and again after that database gets the migration.
   Readable folders (2026-09-27): every key and every reference of the full
   fixture rewritten to "{handle}--{uid}/{slug}--{pid}/…" classifies exactly
   like its legacy twin; label columns, label_note, and the grammar rejects.
   Run: node scripts/test-admin-inventory.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(new URL("../supabase/admin-inventory.sql", import.meta.url), "utf8");
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log("PASS", name); };
const acheck = async (name, fn) => { await fn(); checks++; console.log("PASS", name); };

// ── ids ─────────────────────────────────────────────────────────────────────
const ALICE = "a11ce000-0000-4000-8000-000000000001";
const BOB   = "b0b00000-0000-4000-8000-000000000002";
const CAROL = "ca201000-0000-4000-8000-000000000003";
const DAVE  = "da7e0000-0000-4000-8000-000000000004";
const GONE_USER = "0de1e7ed-0000-4000-8000-000000000005"; // folder of a deleted account
const P1 = "f1100000-0000-4000-8000-0000000000f1";  // Alice's film "Neon Harbor"
const S1 = "5b000000-0000-4000-8000-000000000051";  // Carol's Show "Dust Road"
const E1 = "e1000000-0000-4000-8000-0000000000e1";  // Episode 1
const E2 = "e2000000-0000-4000-8000-0000000000e2";  // Episode 2
const PD = "de1e7ed0-0000-4000-8000-0000000000dd";  // deleted film
const P0 = "e3970000-0000-4000-8000-000000000000";  // Dave's empty film

// ── stub Supabase: roles, auth, storage, and the TURN tables the views read ─
const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role authenticator nologin;
alter role authenticator set pgrst.db_schemas = 'public, graphql_public';

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- schema.sql + series-production.sql (normalized series columns)
create table public.turn_projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled film',
  doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_kind text not null default 'film',
  show_id uuid references public.turn_projects(id),
  episode_no integer
);
create table public.turn_generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.turn_projects(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  entity_id text not null,
  storage_path text,
  meta jsonb not null default '{}'::jsonb,
  refs jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (project_id, entity_id)
);
-- cameos.sql
create table public.turn_cameos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.turn_projects(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  char_id text not null,
  angles jsonb not null default '[]',
  prov jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, char_id)
);
-- series-production.sql (upload reservations + durable cleanup queue)
create table public.turn_asset_upload_intents (
  path text primary key,
  project_id uuid not null,
  uploader uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table public.turn_asset_cleanup_queue (
  path text primary key,
  project_id uuid not null,
  uploader uuid not null,
  reason text not null default 'abandoned_upload',
  queued_at timestamptz not null default now(),
  available_at timestamptz not null default now()
);
-- credits.sql
create table public.turn_credits (
  owner uuid primary key references auth.users(id) on delete cascade,
  remaining integer not null default 0,
  plan text not null default 'none',
  updated_at timestamptz not null default now()
);
-- storage-readable-folders.sql (the stored folder names; the views read only these)
alter table public.turn_projects add column storage_slug text;
create table public.turn_storage_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  created_at timestamptz not null default now()
);
alter table public.turn_storage_accounts enable row level security;
`;

// A hostile starting point: the schema already exists and was (wrongly) opened
// up, and a global default privilege would hand every new view to anon. The
// migration must close all of that.
const HOSTILE = `
create schema turn_admin;
grant usage on schema turn_admin to public, anon, authenticated, service_role;
alter default privileges grant select on tables to anon, authenticated, service_role;
`;

// ── storage paths (files) ───────────────────────────────────────────────────
const F = {
  current:      `${ALICE}/${P1}/character/adem/sheet-v2-20260101-000000-aaaa1111.png`,
  ref:          `${ALICE}/${P1}/character/adem/ref-owner-20260101-000000-aaaa2222.png`,
  history:      `${ALICE}/${P1}/character/adem/sheet-v1-20251201-000000-aaaa3333.png`,
  historyRef:   `${ALICE}/${P1}/character/adem/ref-old-20251201-000000-aaaa4444.png`,
  pending:      `${ALICE}/${P1}/character/adem/sheet-v0-20251101-000000-aaaa5555.png`,
  histPending:  `${ALICE}/${P1}/character/adem/sheet-v0-20251001-000000-aaaa6666.png`,
  newLayoutRef: `${ALICE}/${P1}/character/adem/states/st-1/20260926-101500-sheet-v3-abcd1234.jpg`,
  newLayoutUnref:`${ALICE}/${P1}/character/adem/states/st-2/20260920-080000-sheet-deadbeef.webp`,
  collab:       `${BOB}/${P1}/character/neo/sheet-20260102-000000-bbbb1111.png`,
  cameo:        `${ALICE}/${P1}/cameo/adem/front-20260103-000000-cccc1111.png`,
  locVariant:   `${ALICE}/${P1}/location/loc-harbor-dusk/sheet-20260104-000000-dddd1111.png`,
  locunit:      `${ALICE}/${P1}/locunit/locunit-harbor-EXT-night-1x2y3z/sheet-20260104-000000-dddd2222.png`,
  restoreBin:   `${ALICE}/${P1}/character/ghost/sheet-20260105-000000-eeee1111.png`,
  lookbook:     `${ALICE}/${P1}/lookbook/look-k1/20260925-120000-sheet-eeee2222.png`,
  unreferenced: `${ALICE}/${P1}/prop/prop-knife/sheet-20260106-000000-ffff1111.png`,
  fresh:        `${ALICE}/${P1}/shot/shot-s1-1-a/sheet-20260926-000000-ffff2222.png`,
  liveIntent:   `${ALICE}/${P1}/location/loc-harbor/sheet-20260926-000000-ffff3333.png`,
  queued:       `${ALICE}/${P1}/prop/prop-knife/sheet-20260107-000000-ffff4444.png`,
  expiredIntent:`${ALICE}/${P1}/prop/prop-knife/sheet-20260108-000000-ffff5555.png`,
  relayPng:     `${ALICE}/${P1}/shot/job-123/blender-preview-job-123.png`,
  relayPngGone: `${ALICE}/${PD}/shot/job-9/blender-preview-job-9.png`,
  deleted:      `${ALICE}/${PD}/prop/prop-x/sheet-20250101-000000-99991111.png`,
  showLegacy:   `${CAROL}/${E1}/character/mara/sheet-20250601-000000-77771111.png`,
  showCopy:     `${CAROL}/${S1}/series-migration/mara/k3j2h1.png`,
  showCopyUnref:`${CAROL}/${S1}/series-migration/mara/zz9y8x.png`,
  // Show-promotion copies nothing points at. Their names are fixed, and a retry
  // reuses the copy when the Show has no complete row for that exact entity id.
  showCopyInterrupted:`${CAROL}/${S1}/series-migration/loc-well/q7w8e9.png`,    // Show has no row for loc-well
  showCopyState:`${CAROL}/${S1}/series-migration/mara:st-9/a1b2c3.png`,          // "mara" is complete, "mara:st-9" is not
  showCopyIncomplete:`${CAROL}/${S1}/series-migration/prop-lamp/m4n5b6.png`,     // Show row records no file (ledger only)
  showCopySafeSeg:`${CAROL}/${S1}/series-migration/loc-well_dusk/p0o9i8.png`,    // entity "loc-well dusk" (space → "_") is complete
  showCopyGone: `${ALICE}/${PD}/series-migration/x-1/abc123.png`,                // its Show / project was deleted
  epBible:      `${CAROL}/${E2}/location/loc-well/sheet-20250701-000000-77772222.png`,
  epState:      `${CAROL}/${E2}/character/mara:st-9/sheet-20250702-000000-77773333.png`,
  marker:       `_internal/blender-bridge/claims/9f8e7d.json`,
  mesh:         `blender-studio-internal/output/n0nce/asset.glb`,
  stageOld:     `${ALICE}/stage-tmp/1758800000000-image-0-a1b2.png`,
  stageMid:     `${ALICE}/stage-tmp/1758890000000-image-1-c3d4.png`,
  stageFresh:   `${ALICE}/stage-tmp/1758895000000-image-2-e5f6.png`,
  previewGone:  `${ALICE}/studio-previews/${PD}/loc-1/preview-r1.png`,
  previewLive:  `${ALICE}/studio-previews/${P1}/loc-harbor/preview-r2.png`,
  nonUuid:      `not-a-uuid/whatever/file.png`,
  nonUuid2:     `${ALICE}/not-a-uuid/character/x/y.png`,
  nonUuid3:     `rootfile.png`,
  nonUuid4:     `${ALICE}//character/x/y.png`,
  unknownKind:  `${ALICE}/${P1}/zzz/x/y.png`,
  goneUser:     `${GONE_USER}/${PD}/character/c1/sheet-20250101-000000-12341234.png`,
};

// [path, age, bytes, mime]
const OBJECTS = [
  [F.current, "3 days", 1000, "image/png"],
  [F.ref, "3 days", 200, "image/png"],
  [F.history, "30 days", 900, "image/png"],
  [F.historyRef, "30 days", 150, "image/png"],
  [F.pending, "40 days", 800, "image/png"],
  [F.histPending, "50 days", 700, "image/png"],
  [F.newLayoutRef, "1 day", 500, "image/jpeg"],
  [F.newLayoutUnref, "6 days", 450, "image/webp"],
  [F.collab, "2 days", 1200, "image/png"],
  [F.cameo, "2 days", 300, "image/png"],
  [F.locVariant, "2 days", 640, "image/png"],
  [F.locunit, "2 days", 610, "image/png"],
  [F.restoreBin, "2 days", 620, "image/png"],
  [F.lookbook, "2 days", 630, "image/png"],
  [F.unreferenced, "2 days", 4000, "image/png"],
  [F.fresh, "10 minutes", 2500, "image/png"],
  [F.liveIntent, "3 hours", 2600, "image/png"],
  [F.queued, "1 day", 2700, "image/png"],
  [F.expiredIntent, "1 day", 2800, "image/png"],
  [F.relayPng, "5 days", 3000, "image/png"],
  [F.relayPngGone, "5 days", 3100, "image/png"],
  [F.deleted, "90 days", 5000, "image/png"],
  [F.showLegacy, "100 days", 6000, "image/png"],
  [F.showCopy, "80 days", 6100, "image/png"],
  [F.showCopyUnref, "80 days", 6200, "image/png"],
  [F.showCopyInterrupted, "3 days", 6210, "image/png"],
  [F.showCopyState, "3 days", 6220, "image/png"],
  [F.showCopyIncomplete, "3 days", 6230, "image/png"],
  [F.showCopySafeSeg, "3 days", 6240, "image/png"],
  [F.showCopyGone, "90 days", 6250, "image/png"],
  [F.epBible, "70 days", 6300, "image/png"],
  [F.epState, "70 days", 6400, "image/png"],
  [F.marker, "10 days", 64, "application/json"],
  [F.mesh, "10 days", 90000, "model/gltf-binary"],
  [F.stageOld, "3 hours", 7000, "image/png"],
  [F.stageMid, "90 minutes", 7100, "image/png"],
  [F.stageFresh, "30 minutes", 7200, "image/png"],
  [F.previewGone, "20 days", 7300, "image/png"],
  [F.previewLive, "20 days", 7400, "image/png"],
  [F.nonUuid, "20 days", 11, "image/png"],
  [F.nonUuid2, "20 days", 12, "image/png"],
  [F.nonUuid3, "20 days", 13, "image/png"],
  [F.nonUuid4, "20 days", 14, "image/png"],
  [F.unknownKind, "20 days", 15, "image/png"],
  [F.goneUser, "20 days", 16, "image/png"],
];

const j = (v) => JSON.stringify(v);
const NOW_MS = Date.now();

async function seed(db) {
  await db.exec(`
    insert into auth.users(id, email, created_at, last_sign_in_at) values
      ('${ALICE}', 'alice@example.com', now() - interval '200 days', now() - interval '1 day'),
      ('${BOB}',   'bob@example.com',   now() - interval '150 days', now() - interval '2 days'),
      ('${CAROL}', 'carol@example.com', now() - interval '120 days', null),
      ('${DAVE}',  'dave@example.com',  now() - interval '10 days',  null);
    insert into public.turn_credits(owner, remaining, plan) values
      ('${ALICE}', 500, 'studio'), ('${CAROL}', 0, 'none');
    insert into storage.buckets(id, name, public) values ('turn-assets', 'turn-assets', false);
  `);

  const filmDoc = {
    characters: [{ id: "adem", name: "Adem" }, { id: "neo", name: "Neo" }],
    props: [{ id: "prop-knife", name: "Knife" }],
    locations: [{ id: "loc-harbor", name: "Harbor" }],
    sluglineUnits: [{ key: "harbor|EXT|night", notes: "" }],
    lookbook: [{ id: "look-k1", source: "Palette study", category: "Palette", negativePrompt: "SECRET-PROMPT-LOOKBOOK" }],
    shots: [{ id: "shot-s1-1-a", sceneId: "s1", beatN: 1, action: "SECRET-PROMPT-SHOT", negativePrompt: "SECRET-PROMPT-SHOT" }],
    trash: { characters: [{ id: "ghost", name: "Ghost", _deletedAt: "2026-09-01T00:00:00Z" }] },
  };
  const showDoc = {
    isShow: true,
    bible: {
      characters: [{ id: "mara", name: "Mara" }],
      locations: [{ id: "loc-well", name: "The Well" }],
      props: [{ id: "prop-lamp", name: "Lamp" }], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] },
    },
  };
  const epDoc = (n) => ({ showId: S1, episodeNo: n, scenes: [], shots: [] });

  const q = (sql, params) => db.query(sql, params);
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind) values ($1, $2, 'Neon Harbor', $3, 'film')`, [P1, ALICE, j(filmDoc)]);
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind) values ($1, $2, 'Dust Road', $3, 'show')`, [S1, CAROL, j(showDoc)]);
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind, show_id, episode_no) values ($1, $2, 'Dust Road E1', $3, 'episode', $4, 1)`, [E1, CAROL, j(epDoc(1)), S1]);
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind, show_id, episode_no) values ($1, $2, 'Dust Road E2', $3, 'episode', $4, 2)`, [E2, CAROL, j(epDoc(2)), S1]);
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind) values ($1, $2, 'Empty Film', '{}', 'film')`, [P0, DAVE]);
  // the film that gets deleted (its generation rows cascade away, its files stay)
  await q(`insert into public.turn_projects(id, owner, title, doc, project_kind) values ($1, $2, 'Doomed Film', '{}', 'film')`, [PD, ALICE]);
  await q(`insert into public.turn_generations(project_id, owner, entity_id, storage_path) values ($1, $2, 'prop-x', $3)`, [PD, ALICE, F.deleted]);

  const gen = (project, owner, entity, storage_path, extra = {}) => q(
    `insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta, refs, history)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [project, owner, entity, storage_path, j(extra.meta || {}), j(extra.refs || []), j(extra.history || [])]);

  // a live film: current sheet, refs, history, history refs, both cleanup ledgers
  await gen(P1, ALICE, "adem", F.current, {
    meta: { version: 2, prompt: "SECRET-PROMPT-SHEET", cleanupPending: [F.pending] },
    refs: [{ kind: "owner", storage_path: F.ref }, "not-an-object", { kind: "blank", storage_path: "" }, null],
    history: [
      { version: 1, storage_path: F.history, refs: [{ storage_path: F.historyRef }], meta: { cleanupPending: [F.histPending], prompt: "SECRET-PROMPT-OLD" } },
      "garbage-history-entry",
      { version: 0, storage_path: null, refs: "not-an-array" },
    ],
  });
  await gen(P1, ALICE, "adem:st-1", F.newLayoutRef);        // new layout appearance state
  await gen(P1, BOB, "neo", F.collab);                       // collaborator upload
  await gen(P1, ALICE, "loc-harbor-dusk", F.locVariant);     // location variant (prefix match)
  await gen(P1, ALICE, "locunit-harbor-EXT-night-1x2y3z", F.locunit);
  await gen(P1, ALICE, "ghost", F.restoreBin);               // entity in the restore bin
  await gen(P1, ALICE, "look-k1", F.lookbook);
  await gen(P1, ALICE, "bad-json", null, { meta: { cleanupPending: "not-an-array" }, refs: {}, history: {} });
  // a Stage clip: external provider URLs, a prompt that must never surface
  await gen(P1, BOB, "clip-abc", null, {
    meta: {
      kind: "video", updatedAt: NOW_MS,
      video: {
        url: "https://v3.fal.media/files/rabbit/abc.mp4",
        meta: {
          prompt: "SECRET-PROMPT-VIDEO", createdAt: NOW_MS - 3600_000,
          takes: [
            { url: "https://fal.media/files/older.mp4", savedAt: NOW_MS - 7200_000, meta: { prompt: "SECRET-PROMPT-VIDEO" } },
            { url: "https://abc.supabase.co/storage/v1/object/sign/turn-assets/x.mp4", savedAt: NOW_MS },
            { url: "data:video/mp4;base64,AAAA" },
          ],
        },
      },
    },
  });
  // the Show row references the legacy file under Episode 1's folder + a promotion copy
  await gen(S1, CAROL, "mara", F.showLegacy, { refs: [{ storage_path: F.showCopy }] });
  // a Show row whose promotion did not complete: it records only a cleanup-ledger
  // path, so the app treats it as incomplete and a retry repairs it with its copies
  await gen(S1, CAROL, "prop-lamp", null, {
    meta: { seriesMigrationKey: `series-asset-v2:${E1}:prop-lamp`, cleanupPending: [`${CAROL}/${S1}/series-migration/prop-lamp/old000.png`] },
  });
  // a complete Show row for an entity id the app writes to a folder as "loc-well_dusk"
  await gen(S1, CAROL, "loc-well dusk", `${CAROL}/${E1}/location/loc-well_dusk/sheet-20250603-000000-77774444.png`);
  // an Episode row whose entity is named only in the Show Bible
  await gen(E2, CAROL, "loc-well", F.epBible);

  // cameo with a private subject that must never surface
  await q(`insert into public.turn_cameos(project_id, owner, char_id, angles, prov) values ($1, $2, 'adem', $3, $4)`,
    [P1, ALICE, j([{ label: "Front", storage_path: F.cameo }, { label: "junk" }, "x"]), j({ consent: true, subject: "SECRET-SUBJECT-NAME" })]);

  // upload reservations and the cleanup queue
  await q(`insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at)
           values ($1, $2, $3, now() - interval '3 hours', now() + interval '10 minutes')`, [F.liveIntent, P1, ALICE]);
  await q(`insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at)
           values ($1, $2, $3, now() - interval '1 day', now() - interval '23 hours')`, [F.expiredIntent, P1, ALICE]);
  await q(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader) values ($1, $2, $3)`, [F.queued, P1, ALICE]);

  for (const [path, age, bytes, mime] of OBJECTS) {
    await q(`insert into storage.objects(bucket_id, name, owner, owner_id, metadata, created_at, updated_at)
             values ('turn-assets', $1, null, null, $2, now() - $3::interval, now() - $3::interval)`,
      [path, j({ size: bytes, mimetype: mime, eTag: "x" }), age]);
  }
  // another bucket's object must be ignored entirely
  await q(`insert into storage.objects(bucket_id, name, metadata) values ('other-bucket', $1, '{}')`, [`${ALICE}/${P1}/character/adem/x.png`]);

  // delete the doomed film now: its generation row cascades away, its files stay
  await q(`delete from public.turn_projects where id = $1`, [PD]);
}

// ── main instance ───────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(STUB);
await db.exec(HOSTILE);
await seed(db);

let fullRun; // results of the second full-schema run (the last one is the status table)
await acheck("the SQL file runs cleanly twice (idempotent re-run)", async () => {
  await db.exec(SQL);
  fullRun = await db.exec(SQL);
  const views = (await db.query(`select viewname from pg_views where schemaname = 'turn_admin' order by 1`)).rows.map(r => r.viewname);
  assert.deepEqual(views, ["external_media", "files", "orphans", "projects", "referenced_paths", "users"]);
});

const rowsOf = async (sql, params) => (await db.query(sql, params)).rows;
const files = await rowsOf(`select * from turn_admin.files`);
const byPath = new Map(files.map(r => [r.path, r]));
const file = (p) => { const r = byPath.get(p); assert.ok(r, "missing files row for " + p); return r; };
const orphanPaths = new Set((await rowsOf(`select path from turn_admin.orphans`)).map(r => r.path));

check("files has exactly one row per turn-assets object (other buckets ignored)", () => {
  assert.equal(files.length, OBJECTS.length);
  assert.equal(new Set(files.map(r => r.path)).size, OBJECTS.length);
});

{
  const refs = await rowsOf(`select path, ref_kind, project_id, entity_id from turn_admin.referenced_paths`);
  const kinds = (p) => refs.filter(r => r.path === p).map(r => r.ref_kind).sort();
  await acheck("referenced_paths: current / ref / history / history-ref / both cleanup ledgers / cameo", async () => {
    assert.deepEqual(kinds(F.current), ["current"]);
    assert.deepEqual(kinds(F.ref), ["ref"]);
    assert.deepEqual(kinds(F.history), ["history"]);
    assert.deepEqual(kinds(F.historyRef), ["history-ref"]);
    assert.deepEqual(kinds(F.pending), ["cleanup-pending"]);
    assert.deepEqual(kinds(F.histPending), ["history-cleanup-pending"]);
    assert.deepEqual(kinds(F.cameo), ["cameo-angle"]);
    assert.equal(refs.find(r => r.path === F.cameo).entity_id, "adem");
    assert.ok(refs.every(r => r.path && r.path.trim() !== ""), "blank / null paths are dropped");
    assert.ok(!refs.some(r => r.path === "not-an-object" || r.path === "not-an-array"), "junk JSON is ignored");
  });
}

check("live film: sheet, refs, history files are referenced with the right kinds and names", () => {
  const cur = file(F.current);
  assert.equal(cur.status, "current");
  assert.equal(cur.area, "asset");
  assert.equal(cur.asset_folder, "character");
  assert.equal(cur.entity_id, "adem");
  assert.equal(cur.entity_name, "Adem");
  assert.equal(cur.project_title, "Neon Harbor");
  assert.equal(cur.project_kind, "film");
  assert.equal(cur.project_id, P1);
  assert.equal(cur.uploader_email, "alice@example.com");
  assert.equal(cur.project_owner_email, "alice@example.com");
  assert.equal(Number(cur.bytes), 1000);
  assert.equal(cur.mime, "image/png");
  assert.equal(cur.safe_to_delete, false);
  assert.equal(file(F.ref).status, "ref");
  assert.equal(file(F.history).status, "history");
  assert.equal(file(F.historyRef).status, "history-ref");
  assert.equal(file(F.pending).status, "cleanup-pending");
  assert.equal(file(F.histPending).status, "history-cleanup-pending");
  assert.equal(file(F.cameo).status, "cameo-angle");
  assert.equal(file(F.cameo).entity_name, "Adem");
  for (const p of [F.ref, F.history, F.historyRef, F.pending, F.histPending]) assert.equal(file(p).entity_name, "Adem", p);
});

check("Show row referencing a file under Episode 1's folder is NOT an orphan", () => {
  const r = file(F.showLegacy);
  assert.equal(r.status, "current");
  assert.equal(r.project_id, E1, "project_id stays the folder-2 id (Episode 1)");
  assert.equal(r.project_title, "Dust Road E1");
  assert.equal(r.project_kind, "episode");
  assert.equal(r.show_title, "Dust Road");
  assert.equal(r.episode, 1);
  assert.equal(r.entity_id, "mara");
  assert.equal(r.entity_name, "Mara");
  assert.deepEqual(r.referenced_by_project_ids, [S1]);
  assert.equal(r.safe_to_delete, false);
  assert.ok(!orphanPaths.has(F.showLegacy));
  const copy = file(F.showCopy);
  assert.equal(copy.area, "show-import-copy");
  assert.equal(copy.status, "ref");
  assert.equal(copy.project_kind, "show");
  assert.equal(copy.show_title, "Dust Road");
  assert.equal(copy.entity_name, "Mara");
});

check("Show-promotion copies: only superseded ones are safe; one a retry would reuse is kept", () => {
  // interrupted: the next retry adopts these exact objects by name
  const cases = [
    [F.showCopyInterrupted, "loc-well", "The Well", "no Show row for the entity"],
    [F.showCopyState, "mara:st-9", "Mara", "a complete row for the base entity 'mara' does not cover 'mara:st-9'"],
    [F.showCopyIncomplete, "prop-lamp", "Lamp", "a Show row that records only a cleanup ledger is incomplete"],
  ];
  for (const [p, entity, name, why] of cases) {
    const r = file(p);
    assert.equal(r.area, "show-import-copy", p);
    assert.equal(r.safe_to_delete, false, why);
    assert.ok(!orphanPaths.has(p), why);
    assert.equal(r.status, "kept-for-promotion-retry", why);
    assert.equal(r.orphan_reason, null, why);
    assert.equal(r.entity_id, entity);
    assert.equal(r.entity_name, name);
    assert.equal(r.project_kind, "show");
  }
  // superseded: the Show has a complete row for that entity that records other files
  const sup = file(F.showCopyUnref);
  assert.equal(sup.status, "unreferenced");
  assert.equal(sup.safe_to_delete, true);
  assert.match(sup.orphan_reason, /Superseded Show-promotion copy/);
  const seg = file(F.showCopySafeSeg);
  assert.equal(seg.status, "unreferenced", "entity id matched the way the app names the folder");
  assert.equal(seg.safe_to_delete, true);
  // the Show itself is gone: no retry can land, so the copy is safe
  const gone = file(F.showCopyGone);
  assert.equal(gone.status, "orphan: project deleted");
  assert.equal(gone.safe_to_delete, true);
});

check("Episode doc with names only in the Show Bible: entity_name resolves", () => {
  const r = file(F.epBible);
  assert.equal(r.status, "current");
  assert.equal(r.entity_name, "The Well");
  assert.equal(r.episode, 2);
  assert.equal(r.show_title, "Dust Road");
  const st = file(F.epState);            // old layout, ':state' suffix, unreferenced
  assert.equal(st.entity_id, "mara:st-9");
  assert.equal(st.entity_name, "Mara");
  assert.equal(st.status, "unreferenced");
});

check("deleted project's leftover file is 'orphan: project deleted'", () => {
  const r = file(F.deleted);
  assert.equal(r.status, "orphan: project deleted");
  assert.equal(r.project_title, "(deleted project)");
  assert.equal(r.project_owner_email, null);
  assert.equal(r.uploader_email, "alice@example.com");
  assert.equal(r.safe_to_delete, true);
  assert.ok(orphanPaths.has(F.deleted));
  const g = file(F.goneUser);            // deleted account + deleted project
  assert.equal(g.uploader_email, null);
  assert.equal(g.status, "orphan: project deleted");
});

check("unreferenced old file is 'unreferenced' (and safe to delete)", () => {
  const r = file(F.unreferenced);
  assert.equal(r.status, "unreferenced");
  assert.equal(r.entity_name, "Knife");
  assert.equal(r.safe_to_delete, true);
  assert.match(r.orphan_reason, /no generation/);
});

check("fresh upload (<1h) and an old file with a live upload intent are 'uploading'", () => {
  assert.equal(file(F.fresh).status, "uploading");
  assert.equal(file(F.fresh).entity_name, "Shot 1 of scene s1");
  assert.equal(file(F.liveIntent).status, "uploading");
  assert.equal(file(F.liveIntent).entity_name, "Harbor");
});

check("cleanup-queue row (and an expired reservation) is 'queued-for-cleanup'", () => {
  assert.equal(file(F.queued).status, "queued-for-cleanup");
  assert.equal(file(F.expiredIntent).status, "queued-for-cleanup");
});

check("Blender relay PNG is 'service' (even when its project is gone)", () => {
  const r = file(F.relayPng);
  assert.equal(r.area, "asset");
  assert.equal(r.status, "service");
  const g = file(F.relayPngGone);
  assert.equal(g.status, "service");
  assert.equal(g.safe_to_delete, false);
});

check("_internal marker is a relay-security-marker, studio mesh is a studio-mesh", () => {
  const m = file(F.marker);
  assert.equal(m.area, "relay-security-marker");
  assert.equal(m.status, "service");
  assert.equal(m.uploader_email, null);
  assert.equal(m.project_id, null);
  const s = file(F.mesh);
  assert.equal(s.area, "studio-mesh");
  assert.equal(s.status, "service");
});

check("stage-tmp: older than 2h is in the orphan list; 90 min and 30 min are not", () => {
  for (const p of [F.stageOld, F.stageMid, F.stageFresh]) {
    assert.equal(file(p).area, "stage-temp");
    assert.equal(file(p).status, "service");
    assert.equal(file(p).project_id, null);
    assert.equal(file(p).uploader_email, "alice@example.com");
  }
  assert.ok(orphanPaths.has(F.stageOld));
  assert.ok(!orphanPaths.has(F.stageMid));
  assert.ok(!orphanPaths.has(F.stageFresh));
});

check("studio preview of a deleted project is in the orphan list; a live one is not", () => {
  const g = file(F.previewGone);
  assert.equal(g.area, "studio-preview");
  assert.equal(g.project_id, PD, "studio-previews take the project id from folder 3");
  assert.equal(g.project_title, "(deleted project)");
  assert.ok(orphanPaths.has(F.previewGone));
  const l = file(F.previewLive);
  assert.equal(l.status, "service");
  assert.equal(l.project_title, "Neon Harbor");
  assert.equal(l.entity_name, "Harbor");
  assert.ok(!orphanPaths.has(F.previewLive));
});

check("collaborator upload: uploader_email differs from project_owner_email", () => {
  const r = file(F.collab);
  assert.equal(r.uploader_email, "bob@example.com");
  assert.equal(r.project_owner_email, "alice@example.com");
  assert.equal(r.entity_name, "Neo");
  assert.equal(r.status, "current");
});

check("new layout character/adem/states/st-1/… resolves to the character name", () => {
  const r = file(F.newLayoutRef);
  assert.equal(r.entity_id, "adem:st-1");
  assert.equal(r.entity_name, "Adem");
  assert.equal(r.status, "current");
  assert.equal(r.mime, "image/jpeg");
  const u = file(F.newLayoutUnref);
  assert.equal(u.entity_id, "adem:st-2", "unreferenced new-layout state rebuilt from the path");
  assert.equal(u.entity_name, "Adem");
  assert.equal(u.status, "unreferenced");
});

check("other names: location variant, slugline unit, restore bin, lookbook", () => {
  assert.equal(file(F.locVariant).entity_name, "Harbor");
  assert.equal(file(F.locunit).entity_name, "Slugline unit harbor / EXT / night");
  assert.equal(file(F.restoreBin).entity_name, "Ghost (in restore bin)");
  assert.equal(file(F.lookbook).entity_name, "Palette study");
  assert.equal(file(F.lookbook).asset_folder, "lookbook");
});

check("non-uuid folders never raise; they are 'unknown' and never safe to delete", () => {
  for (const p of [F.nonUuid, F.nonUuid2, F.nonUuid3, F.nonUuid4, F.unknownKind]) {
    const r = file(p);
    assert.equal(r.area, "unknown", p);
    assert.equal(r.safe_to_delete, false, p);
    assert.ok(!orphanPaths.has(p), p);
  }
  assert.equal(file(F.nonUuid).uploader_email, null);
  assert.equal(file(F.nonUuid).project_id, null);
  assert.equal(file(F.nonUuid2).uploader_email, "alice@example.com");
  assert.equal(file(F.nonUuid2).project_id, null);
});

check("orphans view is EXACTLY the safe set (nothing unsafe, nothing missing)", () => {
  const expected = new Set([
    F.deleted, F.goneUser, F.unreferenced, F.newLayoutUnref, F.epState, F.showCopyUnref,
    F.showCopySafeSeg, F.showCopyGone, F.stageOld, F.previewGone,
  ]);
  assert.deepEqual([...orphanPaths].sort(), [...expected].sort());
  const unsafe = [F.marker, F.mesh, F.relayPng, F.relayPngGone, F.fresh, F.liveIntent, F.queued,
    F.expiredIntent, F.showLegacy, F.current, F.ref, F.history, F.historyRef, F.pending,
    F.histPending, F.cameo, F.collab, F.stageMid, F.stageFresh, F.previewLive,
    F.showCopyInterrupted, F.showCopyState, F.showCopyIncomplete];
  for (const p of unsafe) assert.ok(!orphanPaths.has(p), "unsafe path listed: " + p);
  assert.ok(files.filter(r => r.safe_to_delete).length === expected.size, "files.safe_to_delete mirrors orphans");
});

await acheck("orphans carry a human reason and never include service/uploading/referenced rows", async () => {
  const rows = await rowsOf(`select * from turn_admin.orphans`);
  for (const r of rows) {
    assert.ok(r.reason && r.reason.length > 10, "reason for " + r.path);
    assert.ok(!["relay-security-marker", "studio-mesh", "unknown"].includes(r.area));
    assert.ok(!["uploading", "queued-for-cleanup"].includes(r.status));
    assert.ok(["orphan: project deleted", "unreferenced", "service"].includes(r.status), r.status);
  }
  const copy = rows.find(r => r.path === F.showCopyUnref);
  assert.match(copy.reason, /Superseded Show-promotion copy/);
  assert.match(rows.find(r => r.path === F.stageOld).reason, /2 hours/);
  assert.match(rows.find(r => r.path === F.previewGone).reason, /deleted project/);
});

await acheck("projects view: every project (also empty and deleted-with-files), sizes and orphan counts", async () => {
  const rows = await rowsOf(`select * from turn_admin.projects`);
  const p = (id) => rows.find(r => r.project_id === id);
  assert.ok(p(P0), "empty film listed");
  assert.equal(Number(p(P0).files), 0);
  assert.equal(p(P0).owner_email, "dave@example.com");
  assert.equal(p(P0).total_size, "0 bytes");
  const film = p(P1);
  const p1Files = files.filter(r => r.project_id === P1);
  assert.equal(Number(film.files), p1Files.length);
  assert.equal(Number(film.total_bytes), p1Files.reduce((s, r) => s + Number(r.bytes || 0), 0));
  assert.equal(Number(film.orphan_files), p1Files.filter(r => r.safe_to_delete).length);
  assert.equal(film.uploader_emails, "alice@example.com, bob@example.com");
  assert.equal(film.kind, "film");
  assert.equal(p(E2).show_title, "Dust Road");
  assert.equal(p(E2).episode, 2);
  assert.equal(p(S1).kind, "show");
  const gone = p(PD);
  assert.ok(gone, "deleted project with leftover files listed");
  assert.equal(gone.title, "(deleted project)");
  assert.ok(Number(gone.orphan_files) >= 3);
  // ordered by owner_email, title
  const keys = rows.map(r => [r.owner_email ?? "￿", r.title]);
  const sorted = [...keys].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  assert.deepEqual(keys, sorted);
});

await acheck("users view: plan, film count, file count and size per upload folder", async () => {
  const rows = await rowsOf(`select * from turn_admin.users`);
  const u = (email) => rows.find(r => r.email === email);
  assert.equal(u("alice@example.com").plan, "studio");
  assert.equal(Number(u("alice@example.com").film_count), 1, "the deleted film no longer counts");
  const aliceFiles = files.filter(r => r.uploader_email === "alice@example.com");
  assert.equal(Number(u("alice@example.com").file_count), aliceFiles.length);
  assert.equal(Number(u("alice@example.com").total_bytes), aliceFiles.reduce((s, r) => s + Number(r.bytes || 0), 0));
  assert.equal(Number(u("carol@example.com").film_count), 3);
  assert.equal(u("carol@example.com").plan, "none");
  assert.equal(Number(u("bob@example.com").file_count), 1);
  assert.equal(u("bob@example.com").plan, null);
  assert.equal(Number(u("dave@example.com").file_count), 0);
  assert.ok(u("dave@example.com").created_at instanceof Date);
  const ghost = rows.find(r => r.user_id === GONE_USER);
  assert.ok(ghost, "a deleted account's upload folder is still counted");
  assert.equal(ghost.email, "(deleted account)");
});

await acheck("external_media: provider-hosted video takes, host only", async () => {
  const rows = await rowsOf(`select * from turn_admin.external_media order by url_host`);
  assert.deepEqual(rows.map(r => r.url_host), ["fal.media", "v3.fal.media"]);
  for (const r of rows) {
    assert.equal(r.project_title, "Neon Harbor");
    assert.equal(r.owner_email, "alice@example.com");
    assert.equal(r.saved_by_email, "bob@example.com");
    assert.equal(r.entity_id, "clip-abc");
    assert.ok(r.created_at instanceof Date);
  }
  const cur = rows.find(r => r.take === "current take");
  assert.ok(Math.abs(cur.created_at.getTime() - (NOW_MS - 3600_000)) < 2000, "createdAt (epoch ms) is decoded");
  assert.ok(!Object.keys(rows[0]).includes("url"), "full URL is not exposed");
});

await acheck("promotion retry lifecycle: kept → referenced after the retry → safe only once superseded", async () => {
  const statusOf = async (p) => (await db.query(`select status, safe_to_delete from turn_admin.files where path = $1`, [p])).rows[0];
  await db.exec(`begin`);
  try {
    assert.deepEqual(await statusOf(F.showCopyInterrupted), { status: "kept-for-promotion-retry", safe_to_delete: false });
    // the owner's retry: copy() says "already exists", the app adopts the object and inserts the Show row
    await db.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta)
                    values ($1, $2, 'loc-well', $3, $4)`,
      [S1, CAROL, F.showCopyInterrupted, j({ seriesMigrationKey: `series-asset-v2:${E1}:loc-well` })]);
    assert.deepEqual(await statusOf(F.showCopyInterrupted), { status: "current", safe_to_delete: false });
    // later the Show gets a newer sheet and drops the copy: now it is superseded
    await db.query(`update public.turn_generations set storage_path = $3 where project_id = $1 and entity_id = $2`,
      [S1, "loc-well", `${CAROL}/${S1}/location/loc-well/sheet-20260920-000000-77775555.png`]);
    assert.deepEqual(await statusOf(F.showCopyInterrupted), { status: "unreferenced", safe_to_delete: true });
  } finally {
    await db.exec(`rollback`);
  }
});

await acheck("speed: each storage key is parsed once per file in every view (no inlined copies, no metadata carried)", async () => {
  for (const v of ["files", "orphans", "projects", "users"]) {
    const plan = (await db.query(`explain (verbose, costs off) select * from turn_admin.${v}`)).rows
      .map(r => r["QUERY PLAN"]).join("\n");
    // before the fix the planner copied these into every later expression: 54 uuid
    // regexes and 206 string_to_array calls per file
    // per folder (3): the legacy uuid match + the readable grammar's uuid, and its label check (no 8 hex digits in a row)
    assert.equal((plan.match(/\[0-9a-f\]\{8\}-/g) || []).length, 2 * 3, `${v}: the folder regexes run once per folder`);
    assert.equal((plan.match(/\[0-9a-f\]\{8\}'/g) || []).length, 3, `${v}: the label check runs once per folder`);
    assert.equal((plan.match(/string_to_array/g) || []).length, 1, `${v}: the key is split once`);
    assert.equal(/metadata(?! ->>)/.test(plan), false, `${v}: the metadata jsonb is not carried into later steps`);
  }
});

await acheck("privacy: no view exposes prompts or cameo subject", async () => {
  for (const v of ["referenced_paths", "files", "orphans", "projects", "users", "external_media"]) {
    const dump = JSON.stringify((await db.query(`select * from turn_admin.${v}`)).rows, (k, x) => typeof x === "bigint" ? String(x) : x);
    assert.ok(!dump.includes("SECRET"), `${v} leaks a prompt or subject`);
  }
});

await acheck("only postgres can read: no USAGE for public/anon/authenticated/service_role", async () => {
  const r = (await db.query(`
    select has_schema_privilege('anon', 'turn_admin', 'USAGE') as anon,
           has_schema_privilege('authenticated', 'turn_admin', 'USAGE') as authed,
           has_schema_privilege('service_role', 'turn_admin', 'USAGE') as service,
           has_schema_privilege('public', 'turn_admin', 'USAGE') as pub,
           has_table_privilege('anon', 'turn_admin.files', 'SELECT') as anon_files,
           has_table_privilege('authenticated', 'turn_admin.orphans', 'SELECT') as authed_orphans,
           has_table_privilege('authenticated', 'turn_admin.users', 'SELECT') as authed_users`)).rows[0];
  assert.deepEqual(r, { anon: false, authed: false, service: false, pub: false, anon_files: false, authed_orphans: false, authed_users: false });
  // and a real attempt as anon fails
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select count(*) from turn_admin.files`), /permission denied/);
  await db.exec(`reset role`);
});

await acheck("nothing that writes: only views in turn_admin (no functions, triggers, tables)", async () => {
  const objs = (await db.query(`
    select c.relkind, count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'turn_admin' group by 1`)).rows;
  assert.deepEqual(objs, [{ relkind: "v", n: 6 }]);
  const fns = (await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(fns, 0);
  assert.equal(SQL.match(/^\s*(grant|create\s+(or\s+replace\s+)?(function|trigger|policy|table)|insert|update|delete)\b/gim), null,
    "the file contains no grant / function / trigger / policy / table / write statements");
});

await acheck("drop schema turn_admin cascade removes it cleanly", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB);
  await seed(tmp);
  await tmp.exec(SQL);
  await tmp.exec(`drop schema turn_admin cascade`);
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0);
  await tmp.close();
});

await acheck("preflight guard: a missing column aborts before anything is created", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB.replace("  episode_no integer\n", "  episode_no_renamed integer\n"));
  await assert.rejects(tmp.exec(SQL), /preflight: missing public\.turn_projects\.episode_no/);
  await tmp.exec(`rollback`).catch(() => {});
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0, "turn_admin was not created");
  await tmp.close();
});

await acheck("preflight guard: turn_admin listed as an exposed API schema aborts", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB.replace("'public, graphql_public'", "'public, turn_admin, graphql_public'"));
  await assert.rejects(tmp.exec(SQL), /exposed schemas/);
  await tmp.exec(`rollback`).catch(() => {});
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0);
  await tmp.close();
});

await acheck("safety net: a reader limited by row-level security never sees anything as safe to delete", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB);
  await seed(tmp);
  await tmp.exec(SQL);
  // test-only: hand a non-bypass role access, and let RLS hide every generation row
  await tmp.exec(`
    create role auditor nologin;
    grant usage on schema turn_admin, auth, storage to auditor;
    grant select on all tables in schema turn_admin, auth, storage, public to auditor;
    alter table public.turn_generations enable row level security;
  `);
  await tmp.exec(`set role auditor`);
  const hidden = (await tmp.query(`select count(*)::int as n from turn_admin.referenced_paths where ref_kind = 'current'`)).rows[0].n;
  assert.equal(hidden, 0, "RLS really hides the references from this reader");
  const unref = (await tmp.query(`select count(*)::int as n from turn_admin.files where status = 'unreferenced'`)).rows[0].n;
  assert.ok(unref > 5, "without the net, live files would look unreferenced");
  const orphans = (await tmp.query(`select count(*)::int as n from turn_admin.orphans`)).rows[0].n;
  assert.equal(orphans, 0, "but nothing is offered for deletion");
  const safe = (await tmp.query(`select count(*)::int as n from turn_admin.files where safe_to_delete`)).rows[0].n;
  assert.equal(safe, 0);
  // and the installer refuses to run as such a role (still acting as auditor here)
  await assert.rejects(tmp.exec(SQL), /role auditor cannot see every row/);
  await tmp.exec(`rollback`).catch(() => {});
  await tmp.close();
});

await acheck("the PREFLIGHT REPORT query alone returns all-ok on a healthy database", async () => {
  const start = SQL.indexOf("with need(schema_name");
  const end = SQL.indexOf(";", start);
  const rows = (await db.query(SQL.slice(start, end))).rows;
  assert.ok(rows.length >= 30);
  assert.ok(rows.every(r => r.ok === true), JSON.stringify(rows.filter(r => !r.ok)));
});

// the documented 'whole folders' snippet, run exactly as the admin would: every
// line from its "-- select" to the line ending in ";", comment markers stripped
const wholeFoldersQuery = () => {
  const head = SQL.indexOf("-- ── Whole folders of DELETED projects that are safe to delete");
  assert.ok(head > 0, "the saved query is in the file");
  const lines = SQL.slice(head).split("\n");
  const from = lines.findIndex(l => /^-- select\b/.test(l));
  const to = lines.findIndex((l, i) => i >= from && /;\s*$/.test(l));
  assert.ok(from > 0 && to > from, "the saved query has a select and an end");
  return lines.slice(from, to + 1).map(l => l.replace(/^-- ?/, "")).join("\n").replace(/;\s*$/, "");
};

const savedQuery = (heading) => {
  const head = SQL.indexOf(heading);
  assert.ok(head > 0, "the saved query is in the file: " + heading);
  const lines = SQL.slice(head).split("\n");
  const from = lines.findIndex(l => /^-- select\b/.test(l));
  const to = lines.findIndex((l, i) => i >= from && /;\s*$/.test(l));
  assert.ok(from > 0 && to > from);
  return lines.slice(from, to + 1).map(l => l.replace(/^-- ?/, "")).join("\n").replace(/;\s*$/, "");
};
await acheck("saved query 'Storage map': every folder named, YES only where the whole project folder can go", async () => {
  const rows = (await db.query(savedQuery("-- ── Storage map: who owns each folder you see in the Dashboard"))).rows;
  const by = k => rows.find(r => r.user_folder + "/" + r.project_folder === k);
  assert.ok(rows.length > 0 && rows.every(r => r.whose && r.project && Number(r.files) > 0));
  assert.equal(by(GONE_USER + "/" + PD).whose, "(deleted account)");
  assert.equal(by(GONE_USER + "/" + PD).delete_folder, "YES: delete this project folder");
  assert.notEqual(by(ALICE + "/" + PD).delete_folder, "YES: delete this project folder", "a Blender service file keeps it");
  assert.ok(!by(ALICE + "/" + P1).delete_folder.startsWith("YES"), "a live film's folder is never a whole-folder delete");
  assert.ok(rows.some(r => r.delete_folder === "no: in use"), "folders with nothing safe say no");
  assert.ok(rows.filter(r => r.delete_folder.startsWith("YES")).every(r => r.project === "(deleted project)"));
  assert.ok(rows.filter(r => r.user_folder === "_internal").every(r => r.whose === "(service files: keep)" && !r.delete_folder.startsWith("YES")));
});

await acheck("saved query 'whole folders': only DELETED projects' folders where EVERY file is safe", async () => {
  const rows = (await db.query(wholeFoldersQuery())).rows;
  const key = r => r.user_folder + "/" + r.project_folder;
  const got = new Set(rows.map(key));
  assert.ok(got.has(GONE_USER + "/" + PD), "a deleted account's folder of a deleted film: every file is an orphan");
  assert.ok(!got.has(ALICE + "/" + PD), "the same film's folder under Alice still holds a Blender service file");
  assert.ok(!got.has(ALICE + "/" + P1), "a live film's folder is never listed");
  assert.ok(rows.every(r => Number(r.files) > 0 && r.size));
  assert.ok(rows.every(r => r.project === "(deleted project)"), "every listed folder belongs to a deleted project");
  // A live project's folder whose every file is unreferenced right now: a folder
  // delete would also remove whatever a collaborator uploads after the query, so
  // the folder is NOT listed; the file itself is offered by exact path in orphans.
  const stale = `${DAVE}/${P0}/prop/prop-y/sheet-20260101-000000-abab0001.png`;
  await db.exec(`begin`);
  try {
    await db.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
                    values ('turn-assets', $1, $2, now() - interval '2 days', now() - interval '2 days')`,
      [stale, j({ size: 10, mimetype: "image/png" })]);
    const f = (await db.query(`select status, safe_to_delete from turn_admin.files where path = $1`, [stale])).rows[0];
    assert.deepEqual(f, { status: "unreferenced", safe_to_delete: true }, "every file of Dave's live film is safe");
    const live = (await db.query(wholeFoldersQuery())).rows;
    assert.ok(!live.some(r => r.user_folder === DAVE && r.project_folder === P0), "a LIVE project's folder is never listed");
    assert.equal((await db.query(`select count(*)::int as n from turn_admin.orphans where path = $1`, [stale])).rows[0].n, 1,
      "the file is still offered for an exact-path delete");
  } finally {
    await db.exec(`rollback`);
  }
});

// ── shared helpers for the status table and the schema-adaptive runs ────────
const ITEMS = {
  views: "turn_admin views (read-only)",
  locked: "Only postgres (the SQL Editor) can read turn_admin",
  api: "turn_admin kept out of the Data API",
  rls: "Reader sees every row (row-level security safety net)",
  pg: "Postgres 15 or newer",
  core: "Core tables (schema.sql, Supabase Auth and Storage)",
  bucket: "Bucket turn-assets",
  series: "Shows & episodes migration (series-production.sql)",
  intents: "Upload reservations (turn_asset_upload_intents)",
  queue: "Cleanup queue (turn_asset_cleanup_queue)",
  cameos: "Cameos (cameos.sql)",
  credits: "Credits (credits.sql)",
  readable: "Readable storage folders (storage-readable-folders.sql)",
  readableHealth: "Readable storage folders: access helpers and rules are current",
  files: "Files in turn-assets",
  projects: "Projects",
  users: "User accounts",
  orphans: "Orphans (safe to delete)",
};
// the result the SQL Editor shows = the last statement's result
const statusTable = (results) => {
  const last = results.at(-1);
  assert.deepEqual(last.fields.map(f => f.name), ["item", "status", "detail"], "the file ends with the status table");
  assert.deepEqual(last.rows.map(r => r.item), Object.values(ITEMS), "one row per check / feature / count, in order");
  return Object.fromEntries(Object.entries(ITEMS).map(([k, item]) => [k, last.rows.find(r => r.item === item)]));
};
const viewColumns = async (d) => (await d.query(`
  select c.relname as view, a.attnum as n, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'turn_admin' and c.relkind = 'v' and a.attnum > 0 and not a.attisdropped
   order by 1, 2`)).rows;
// every view runs with the reader's own rights, however it was built
const assertInvoker = async (d) => {
  const rows = (await d.query(`
    select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'turn_admin' and c.relkind = 'v' order by 1`)).rows;
  assert.equal(rows.length, 6);
  for (const r of rows) assert.ok((r.reloptions || []).includes("security_invoker=true"), r.relname + " is not security_invoker");
};
const privacyAndLockdown = async (d) => {
  await assertInvoker(d);
  for (const v of ["referenced_paths", "files", "orphans", "projects", "users", "external_media"]) {
    const dump = JSON.stringify((await d.query(`select * from turn_admin.${v}`)).rows, (k, x) => typeof x === "bigint" ? String(x) : x);
    assert.ok(!dump.includes("SECRET"), `${v} leaks a prompt or subject`);
  }
  const r = (await d.query(`
    select has_schema_privilege('anon', 'turn_admin', 'USAGE') as anon,
           has_schema_privilege('authenticated', 'turn_admin', 'USAGE') as authed,
           has_schema_privilege('service_role', 'turn_admin', 'USAGE') as service,
           has_schema_privilege('public', 'turn_admin', 'USAGE') as pub,
           has_table_privilege('anon', 'turn_admin.files', 'SELECT') as anon_files,
           has_table_privilege('authenticated', 'turn_admin.orphans', 'SELECT') as authed_orphans,
           has_table_privilege('authenticated', 'turn_admin.users', 'SELECT') as authed_users`)).rows[0];
  assert.deepEqual(r, { anon: false, authed: false, service: false, pub: false, anon_files: false, authed_orphans: false, authed_users: false });
  await d.exec(`set role anon`);
  await assert.rejects(d.query(`select count(*) from turn_admin.files`), /permission denied/);
  await d.exec(`reset role`);
  const objs = (await d.query(`
    select c.relkind, count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'turn_admin' group by 1`)).rows;
  assert.deepEqual(objs, [{ relkind: "v", n: 6 }]);
  const fns = (await d.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(fns, 0, "no function left behind in turn_admin");
  const tmpFns = (await d.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'turn_admin') or n.nspname like 'pg_temp%'`)).rows[0].n;
  assert.equal(tmpFns, 0, "no function left behind anywhere the file could write");
};

const fullColumns = await viewColumns(db);

check("full schema: the last result is the status table — every check ok, every feature installed, counts match", () => {
  const t = statusTable(fullRun);
  for (const k of ["locked", "api", "rls", "pg", "core", "bucket"]) assert.equal(t[k].status, "ok", k);
  for (const k of ["views", "series", "intents", "queue", "cameos", "credits", "readable"]) assert.equal(t[k].status, "installed", k);
  assert.equal(t.views.detail, "external_media, files, orphans, projects, referenced_paths, users");
  assert.equal(t.files.status, String(OBJECTS.length));
  assert.equal(t.orphans.status, String(orphanPaths.size));
  assert.equal(t.projects.status, "5", "P1, S1, E1, E2, P0 (the deleted film is not counted)");
  assert.equal(t.projects.detail, "films 2 · Shows 1 · Episodes 2 · deleted projects that still have files 1");
  assert.equal(t.users.status, "4");
  assert.equal(t.users.detail, "upload folders of deleted accounts 1");
  assert.match(t.series.detail, /project_kind, show_id, episode_no/);
  // this stub has the readable tables but none of the access files, so the read-only
  // stale-copy check (row 126) must say so; the real SQL chain is exercised in
  // scripts/test-storage-readable-folders.mjs (healthy, stale copies, repair)
  assert.match(t.readableHealth.status, /^FAIL — turn_storage_segment_id \/ turn_storage_uid missing; turn_storage_project_id reads bare ids only; the upload rules/);
  assert.match(t.readableHealth.detail, /Re-run the current storage-readable-folders\.sql/);
});

await acheck("full schema: every view (also the ones the DO block builds) is security_invoker", async () => {
  await assertInvoker(db);
});

check("the column lists of the report, the guard and the status table are identical", () => {
  const lists = [...SQL.matchAll(/need\(schema_name, table_name, column_name, feature, source\) as \(values\n([\s\S]*?)\n\s*\)/g)]
    .map(m => m[1].replace(/\s+/g, " ").trim());
  assert.equal(lists.length, 3);
  assert.equal(lists[1], lists[0], "guard list = report list");
  assert.equal(lists[2], lists[0], "status-table list = report list");
});

// ═══ READABLE folders (2026-09-27): every key rewritten, same answers ════════
// Two fresh copies of the full fixture: one exactly as seeded (legacy keys), one
// with every object key AND every stored reference rewritten to readable top
// folders ("{handle}--{uid}/{slug}--{pid}/…", studio previews: folder 3), plus
// the stored names (turn_storage_accounts, turn_projects.storage_slug). Only the
// ids decide, so each readable key must classify exactly like its legacy twin.
const HANDLE = { [ALICE]: "alice", [BOB]: "bob", [CAROL]: "carol", [DAVE]: "dave", [GONE_USER]: "gone-user" };
const SLUG = { [P1]: "neon-harbor", [S1]: "dust-road-show", [E1]: "dust-road-e1", [E2]: "dust-road-e2",
  [PD]: "doomed-film", [P0]: "empty-film" };
const R = (p) => {
  if (typeof p !== "string" || !p.includes("/")) return p;
  const seg = p.split("/");
  if (!HANDLE[seg[0]]) return p;
  seg[0] = HANDLE[seg[0]] + "--" + seg[0];
  if (seg[1] === "studio-previews") { if (SLUG[seg[2]]) seg[2] = SLUG[seg[2]] + "--" + seg[2]; }
  else if (SLUG[seg[1]]) seg[1] = SLUG[seg[1]] + "--" + seg[1];
  return seg.join("/");
};
const deepR = (v) => typeof v === "string" ? R(v)
  : Array.isArray(v) ? v.map(deepR)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepR(x)])) : v;
async function toReadable(d) {
  for (const r of (await d.query(`select id, name from storage.objects where bucket_id = 'turn-assets'`)).rows)
    await d.query(`update storage.objects set name = $2 where id = $1`, [r.id, R(r.name)]);
  for (const r of (await d.query(`select id, storage_path, meta, refs, history from public.turn_generations`)).rows)
    await d.query(`update public.turn_generations set storage_path = $2, meta = $3, refs = $4, history = $5 where id = $1`,
      [r.id, R(r.storage_path), j(deepR(r.meta)), j(deepR(r.refs)), j(deepR(r.history))]);
  for (const r of (await d.query(`select id, angles from public.turn_cameos`)).rows)
    await d.query(`update public.turn_cameos set angles = $2 where id = $1`, [r.id, j(deepR(r.angles))]);
  for (const t of ["turn_asset_upload_intents", "turn_asset_cleanup_queue"])
    for (const r of (await d.query(`select path from public.${t}`)).rows)
      await d.query(`update public.${t} set path = $2 where path = $1`, [r.path, R(r.path)]);
  for (const [id, handle] of Object.entries(HANDLE))
    await d.query(`insert into public.turn_storage_accounts(user_id, handle) select id, $2 from auth.users where id = $1`, [id, handle]);
  for (const [id, slug] of Object.entries(SLUG))
    await d.query(`update public.turn_projects set storage_slug = $2 where id = $1`, [id, slug]);
}
const tdb = new PGlite();
await tdb.exec(STUB);
await seed(tdb);
await tdb.exec(SQL);
const rdb = new PGlite();
await rdb.exec(STUB);
await seed(rdb);
await toReadable(rdb);
const readableRun = await rdb.exec(SQL);
const tFiles = new Map((await tdb.query(`select * from turn_admin.files`)).rows.map(r => [r.path, r]));
const rFiles = new Map((await rdb.query(`select * from turn_admin.files`)).rows.map(r => [r.path, r]));
const SAME_COLS = ["area", "bytes", "mime", "uploader_email", "project_id", "project_owner_email", "project_title",
  "project_kind", "show_title", "episode", "asset_folder", "entity_id", "entity_name", "status", "safe_to_delete",
  "orphan_reason", "referenced_by_project_ids", "uploader_id"];

check("readable: the fixture really holds readable keys for every area (and the status table says installed)", () => {
  const areas = new Set([...rFiles.values()].filter(r => r.account_label).map(r => r.area));
  for (const a of ["asset", "show-import-copy", "stage-temp", "studio-preview", "unknown"]) assert.ok(areas.has(a), a);
  assert.ok([...rFiles.values()].some(r => r.path === R(F.relayPng) && r.path !== F.relayPng));
  assert.equal(rFiles.size, tFiles.size);
  assert.equal(statusTable(readableRun).readable.status, "installed");
});

check("readable: every readable key classifies exactly like its legacy twin (area, owner, project, names, status, safety)", () => {
  for (const [path, legacy] of tFiles) {
    const twin = rFiles.get(R(path));
    assert.ok(twin, "readable twin of " + path);
    for (const c of SAME_COLS) assert.deepEqual(twin[c], legacy[c], `${c} of ${R(path)}`);
    assert.equal(legacy.account_label, null, "legacy keys have no labels: " + path);
    assert.equal(legacy.project_label, null);
    assert.equal(legacy.label_note, null);
    assert.equal(twin.label_note, null, "labels equal to the stored names are not flagged: " + R(path));
  }
});

check("readable: account_label / project_label come from the right folder (studio previews: folder 3)", () => {
  const row = (p) => { const r = rFiles.get(R(p)); assert.ok(r, "missing " + R(p)); return r; };
  assert.deepEqual([row(F.current).account_label, row(F.current).project_label], ["alice", "neon-harbor"]);
  assert.deepEqual([row(F.collab).account_label, row(F.collab).project_label], ["bob", "neon-harbor"]);
  assert.deepEqual([row(F.showCopy).account_label, row(F.showCopy).project_label], ["carol", "dust-road-show"]);
  assert.deepEqual([row(F.previewGone).account_label, row(F.previewGone).project_label, row(F.previewGone).project_id], ["alice", "doomed-film", PD]);
  assert.deepEqual([row(F.stageOld).account_label, row(F.stageOld).project_label, row(F.stageOld).area], ["alice", null, "stage-temp"]);
  assert.deepEqual([row(F.goneUser).account_label, row(F.goneUser).project_label, row(F.goneUser).uploader_email], ["gone-user", "doomed-film", null]);
  assert.equal(row(F.marker).account_label, null, "_internal is never an account");
  assert.equal(row(F.relayPng).status, "service", "the readable relay PNG is still a service file");
  assert.equal(row(F.nonUuid2).account_label, "alice");
  assert.equal(row(F.nonUuid2).area, "unknown");
});

await acheck("readable: orphans, projects, users and the saved queries answer as on the legacy keys", async () => {
  const orph = async (d) => (await d.query(`select path, reason from turn_admin.orphans order by path`)).rows;
  const tOrph = (await orph(tdb)).map(r => [R(r.path), r.reason]).sort();
  const rOrph = (await orph(rdb)).map(r => [r.path, r.reason]).sort();
  assert.deepEqual(rOrph, tOrph);
  const drop = (rows, cols) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))));
  const tProj = drop((await tdb.query(`select * from turn_admin.projects order by project_id`)).rows, ["last_upload", "storage_slug"]);
  const rProjRows = (await rdb.query(`select * from turn_admin.projects order by project_id`)).rows;
  assert.deepEqual(drop(rProjRows, ["last_upload", "storage_slug"]), tProj);
  assert.equal(rProjRows.find(r => r.project_id === P1).storage_slug, "neon-harbor");
  assert.equal(rProjRows.find(r => r.project_id === PD).storage_slug, null, "a deleted project has no stored name");
  const tUsers = drop((await tdb.query(`select * from turn_admin.users order by user_id`)).rows, ["created_at", "last_sign_in_at", "storage_handle"]);
  const rUserRows = (await rdb.query(`select * from turn_admin.users order by user_id`)).rows;
  assert.deepEqual(drop(rUserRows, ["created_at", "last_sign_in_at", "storage_handle"]), tUsers);
  assert.equal(rUserRows.find(r => r.user_id === ALICE).storage_handle, "alice");
  assert.equal(rUserRows.find(r => r.user_id === GONE_USER).storage_handle, null);
  // whole-folder deletes: the same (deleted) folders, under their readable names
  const whole = async (d) => (await d.query(wholeFoldersQuery())).rows.map(r => r.user_folder + "/" + r.project_folder).sort();
  assert.deepEqual(await whole(rdb), (await whole(tdb)).map(k => R(k + "/x").split("/").slice(0, 2).join("/")).sort());
  assert.ok((await whole(rdb)).includes(`gone-user--${GONE_USER}/doomed-film--${PD}`));
  const map = (await rdb.query(savedQuery("-- ── Storage map: who owns each folder you see in the Dashboard"))).rows;
  const alice = map.find(r => r.user_folder === `alice--${ALICE}` && r.project_folder === `neon-harbor--${P1}`);
  assert.ok(alice && alice.whose === "alice@example.com" && alice.project === "Neon Harbor", "a readable folder is named by its ids");
});

await acheck("readable: label_note flags a label that differs from the stored name; never changes owner, project or safety", async () => {
  const put = (p) => rdb.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
                                values ('turn-assets', $1, $2, now() - interval '3 days', now() - interval '3 days')`,
    [p, j({ size: 10, mimetype: "image/png" })]);
  const K = {
    wrongAcct:    `mallory--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00001.png`,
    wrongProj:    `alice--${ALICE}/other-name--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00002.png`,
    untitled:     `alice--${ALICE}/untitled--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00003.png`,
    noSlug:       `dave--${DAVE}/whatever--${P0}/prop/prop-y/20260927-101500-sheet-lbl00004.png`,
    wrongPreview: `alice--${ALICE}/studio-previews/wrong--${P1}/loc-1/preview-lbl5.png`,
    goneHandle:   `anything--${GONE_USER}/any-name--${PD}/character/c1/20260927-101500-sheet-lbl00006.png`,
    upperLabel:   `Alice--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00007.png`,
    hexLabel:     `deadbeef--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00008.png`,
    twoSeps:      `a--b--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00009.png`,
    badProject:   `alice--${ALICE}/neon_harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00010.png`,
    tooLong:      `${"x".repeat(65)}--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00011.png`,
    // review 2026-09-27: Bob's uuid dressed up as a label on Alice's own id
    spoofExtra:   `${BOB.replace("-", "a-")}--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00012.png`,
    spoofNoHyph:  `${BOB.replace(/-/g, "")}--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00013.png`,
    spoofInside:  `x-${BOB}--${ALICE}/neon-harbor--${P1}/prop/prop-knife/20260927-101500-sheet-lbl00014.png`,
  };
  await rdb.exec(`begin`);
  try {
    await rdb.query(`update public.turn_projects set storage_slug = null where id = $1`, [P0]);
    for (const p of Object.values(K)) await put(p);
    const row = async (p) => (await rdb.query(`select * from turn_admin.files where path = $1`, [p])).rows[0];
    const a = await row(K.wrongAcct);
    assert.equal(a.label_note, "account folder label differs from the account handle");
    assert.deepEqual([a.uploader_id, a.uploader_email, a.project_id, a.area, a.status, a.safe_to_delete],
      [ALICE, "alice@example.com", P1, "asset", "unreferenced", true], "the id decides, the label only earns a note");
    assert.equal((await row(K.wrongProj)).label_note, "project folder label differs from the project name");
    assert.equal((await row(K.untitled)).label_note, null, "'untitled' is expected before the first real title");
    assert.equal((await row(K.noSlug)).label_note, null, "no stored project name: nothing to compare");
    const pv = await row(K.wrongPreview);
    assert.deepEqual([pv.area, pv.project_id, pv.project_label, pv.label_note],
      ["studio-preview", P1, "wrong", "project folder label differs from the project name"]);
    const g = await row(K.goneHandle);
    assert.deepEqual([g.uploader_id, g.project_id, g.label_note, g.status], [GONE_USER, PD, null, "orphan: project deleted"]);
    for (const k of ["upperLabel", "hexLabel", "twoSeps", "tooLong", "spoofExtra", "spoofNoHyph", "spoofInside"]) {
      const r = await row(K[k]);
      assert.deepEqual([r.area, r.uploader_id, r.safe_to_delete, r.account_label], ["unknown", null, false, null], k + " is not a folder");
    }
    const b = await row(K.badProject);
    assert.deepEqual([b.area, b.uploader_id, b.project_id, b.safe_to_delete], ["unknown", ALICE, null, false]);
  } finally {
    await rdb.exec(`rollback`);
  }
});

await acheck("readable: views keep one parse per file with readable keys too", async () => {
  for (const v of ["files", "orphans", "projects", "users"]) {
    const plan = (await rdb.query(`explain (verbose, costs off) select * from turn_admin.${v}`)).rows
      .map(r => r["QUERY PLAN"]).join("\n");
    assert.equal((plan.match(/string_to_array/g) || []).length, 1, `${v}: the key is split once`);
  }
  assert.deepEqual(await viewColumns(rdb), fullColumns);
});
await tdb.close();
await rdb.close();

// ═══ LEGACY database: series-production.sql never applied ═══════════════════
// turn_projects has no project_kind / show_id / episode_no; there is no
// turn_asset_upload_intents and no turn_asset_cleanup_queue. turn_cameos and
// turn_credits exist (as on the owner's production database).
const SERIES_COLS = ",\n  project_kind text not null default 'film',\n  show_id uuid references public.turn_projects(id),\n  episode_no integer\n";
const RES_START = STUB.indexOf("-- series-production.sql (upload reservations");
const RES_END = STUB.indexOf("-- credits.sql");
const RESERVATION_DDL = STUB.slice(RES_START, RES_END);
const READABLE_DDL = STUB.slice(STUB.indexOf("-- storage-readable-folders.sql"));
const STUB_LEGACY = STUB.replace(SERIES_COLS, "\n").replace(RESERVATION_DDL, "").replace(READABLE_DDL, "");
assert.ok(STUB.includes(SERIES_COLS) && RES_START > 0 && RES_END > RES_START, "legacy stub derived from STUB");
assert.ok(READABLE_DDL.startsWith("-- storage-readable-folders.sql") && READABLE_DDL.length > 100, "readable DDL found");
assert.ok(!/project_kind|show_id|episode_no|turn_asset_upload_intents|turn_asset_cleanup_queue|turn_storage_accounts|storage_slug/.test(STUB_LEGACY), "legacy stub has no series-production or readable-folder objects");

const PX = "0dd00000-0000-4000-8000-0000000000ff";  // Dave's film with a stale, malformed Show marker
// well-formed doc.showId markers that name no Show: both stay plain films
const PF = "5f000000-0000-4000-8000-0000000000f2";  // Dave's film whose doc.showId names Alice's FILM P1
const PG = "9d000000-0000-4000-8000-0000000000f3";  // Dave's film whose doc.showId names the deleted PD
const L = {
  current:      `${ALICE}/${P1}/character/adem/sheet-20260101-000000-aaaa1111.png`,
  cameo:        `${ALICE}/${P1}/cameo/adem/front-20260103-000000-cccc1111.png`,
  unreferenced: `${ALICE}/${P1}/prop/prop-knife/sheet-20260106-000000-ffff1111.png`,
  stale:        `${ALICE}/${P1}/location/loc-harbor/sheet-20260926-000000-ffff3333.png`, // 3 h old: no reservation table to keep it
  fresh:        `${ALICE}/${P1}/shot/shot-s1-1-a/sheet-20260926-000000-ffff2222.png`,
  relayPng:     `${ALICE}/${P1}/shot/job-123/blender-preview-job-123.png`,
  marker:       `_internal/blender-bridge/claims/9f8e7d.json`,
  stageOld:     `${ALICE}/stage-tmp/1758800000000-image-0-a1b2.png`,
  stageFresh:   `${ALICE}/stage-tmp/1758895000000-image-2-e5f6.png`,
  showLegacy:   `${CAROL}/${E1}/character/mara/sheet-20250601-000000-77771111.png`,  // the Show row points here
  epBible:      `${CAROL}/${E2}/location/loc-well/sheet-20250701-000000-77772222.png`,
  epUnref:      `${CAROL}/${E1}/prop/prop-lamp/sheet-20250702-000000-77773333.png`,
  deleted:      `${ALICE}/${PD}/prop/prop-x/sheet-20250101-000000-99991111.png`,
  oddMarker:    `${DAVE}/${PX}/character/zed/sheet-20260110-000000-12121212.png`,
  notAShow:     `${DAVE}/${PF}/prop/prop-knife/sheet-20260111-000000-13131313.png`, // P1 names prop-knife "Knife"
};
const L_OBJECTS = [
  [L.current, "3 days", 1000, "image/png"],
  [L.cameo, "2 days", 300, "image/png"],
  [L.unreferenced, "2 days", 4000, "image/png"],
  [L.stale, "3 hours", 2600, "image/png"],
  [L.fresh, "10 minutes", 2500, "image/png"],
  [L.relayPng, "5 days", 3000, "image/png"],
  [L.marker, "10 days", 64, "application/json"],
  [L.stageOld, "3 hours", 7000, "image/png"],
  [L.stageFresh, "30 minutes", 7200, "image/png"],
  [L.showLegacy, "100 days", 6000, "image/png"],
  [L.epBible, "70 days", 6300, "image/png"],
  [L.epUnref, "70 days", 6400, "image/png"],
  [L.deleted, "90 days", 5000, "image/png"],
  [L.oddMarker, "10 days", 700, "image/png"],
  [L.notAShow, "10 days", 710, "image/png"],
];
const L_SAFE = [L.unreferenced, L.stale, L.stageOld, L.epUnref, L.deleted];

async function seedLegacy(d) {
  await d.exec(`
    insert into auth.users(id, email, created_at, last_sign_in_at) values
      ('${ALICE}', 'alice@example.com', now() - interval '200 days', now() - interval '1 day'),
      ('${BOB}',   'bob@example.com',   now() - interval '150 days', now() - interval '2 days'),
      ('${CAROL}', 'carol@example.com', now() - interval '120 days', null),
      ('${DAVE}',  'dave@example.com',  now() - interval '10 days',  null);
    insert into public.turn_credits(owner, remaining, plan) values
      ('${ALICE}', 500, 'studio'), ('${CAROL}', 0, 'none');
    insert into storage.buckets(id, name, public) values ('turn-assets', 'turn-assets', false);
  `);
  const q = (sql, params) => d.query(sql, params);
  const filmDoc = {
    characters: [{ id: "adem", name: "Adem" }],
    props: [{ id: "prop-knife", name: "Knife" }],
    locations: [{ id: "loc-harbor", name: "Harbor" }],
    shots: [{ id: "shot-s1-1-a", sceneId: "s1", beatN: 1, action: "SECRET-PROMPT-SHOT" }],
  };
  // exactly what the pre-migration app stores: the Show is marked by doc.isShow and
  // keeps its cast in doc.bible; an Episode names its Show in doc.showId and its
  // number in doc.episodeNo (a JSON number) and carries no characters/locations/props
  const showDoc = {
    isShow: true,
    bible: {
      characters: [{ id: "mara", name: "Mara" }],
      locations: [{ id: "loc-well", name: "The Well" }],
      props: [{ id: "prop-lamp", name: "Lamp" }], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] },
    },
  };
  const epDoc = (n) => ({ showId: S1, episodeNo: n, scenes: [], shots: [] });
  const oddDoc = { showId: "not-a-uuid", episodeNo: "x", characters: [{ id: "zed", name: "Zed" }] };
  const project = (id, owner, title, doc) => q(`insert into public.turn_projects(id, owner, title, doc) values ($1, $2, $3, $4)`, [id, owner, title, j(doc)]);
  await project(P1, ALICE, "Neon Harbor", filmDoc);
  await project(S1, CAROL, "Dust Road", showDoc);
  await project(E1, CAROL, "Dust Road E1", epDoc(1));
  await project(E2, CAROL, "Dust Road E2", epDoc(2));
  await project(PX, DAVE, "Odd Film", oddDoc);
  await project(PD, ALICE, "Doomed Film", {});
  await project(PF, DAVE, "Not An Episode", { showId: P1, episodeNo: 2, scenes: [] });
  await project(PG, DAVE, "Lost Parent", { showId: PD, episodeNo: 3, scenes: [] });
  const gen = (project, owner, entity, storage_path, meta = {}) => q(
    `insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta) values ($1, $2, $3, $4, $5)`,
    [project, owner, entity, storage_path, j(meta)]);
  await gen(PD, ALICE, "prop-x", L.deleted);
  await gen(P1, ALICE, "adem", L.current, { prompt: "SECRET-PROMPT-SHEET" });
  await gen(S1, CAROL, "mara", L.showLegacy);   // Show row → file under Episode 1's folder
  await gen(E2, CAROL, "loc-well", L.epBible);  // Episode row, name only in the Show Bible
  await gen(PX, DAVE, "zed", L.oddMarker);
  await gen(PF, DAVE, "prop-knife", L.notAShow);
  await q(`insert into public.turn_cameos(project_id, owner, char_id, angles, prov) values ($1, $2, 'adem', $3, $4)`,
    [P1, ALICE, j([{ label: "Front", storage_path: L.cameo }]), j({ consent: true, subject: "SECRET-SUBJECT-NAME" })]);
  for (const [path, age, bytes, mime] of L_OBJECTS) {
    await q(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
             values ('turn-assets', $1, $2, now() - $3::interval, now() - $3::interval)`,
      [path, j({ size: bytes, mimetype: mime }), age]);
  }
  await q(`delete from public.turn_projects where id = $1`, [PD]);
}

const ldb = new PGlite();
await ldb.exec(STUB_LEGACY);
await ldb.exec(HOSTILE);
await seedLegacy(ldb);

let legacyRun;
await acheck("legacy: the preflight guard does not abort, and the file runs cleanly twice", async () => {
  await ldb.exec(SQL);
  legacyRun = await ldb.exec(SQL);
  const views = (await ldb.query(`select viewname from pg_views where schemaname = 'turn_admin' order by 1`)).rows.map(r => r.viewname);
  assert.deepEqual(views, ["external_media", "files", "orphans", "projects", "referenced_paths", "users"]);
});

const lrows = async (sql, params) => (await ldb.query(sql, params)).rows;
const lfiles = await lrows(`select * from turn_admin.files`);
const lByPath = new Map(lfiles.map(r => [r.path, r]));
const lfile = (p) => { const r = lByPath.get(p); assert.ok(r, "missing legacy files row for " + p); return r; };
const lOrphans = new Set((await lrows(`select path from turn_admin.orphans`)).map(r => r.path));

check("legacy: the status table says Shows & episodes, reservations and the queue are not installed", () => {
  const t = statusTable(legacyRun);
  assert.equal(t.series.status, "not installed — Shows/episodes read from the document markers");
  assert.match(t.intents.status, /^not installed — only files under 1 hour old count as uploading$/);
  assert.match(t.queue.status, /^not installed — no file is marked queued-for-cleanup$/);
  assert.equal(t.readable.status, "not installed — folder labels are shown but not compared");
  assert.equal(t.readableHealth.status, "not installed — nothing to check");
  for (const k of ["views", "cameos", "credits"]) assert.equal(t[k].status, "installed", k);
  for (const k of ["locked", "api", "rls", "pg", "core", "bucket"]) assert.equal(t[k].status, "ok", k);
  assert.equal(t.files.status, String(L_OBJECTS.length));
  assert.equal(t.orphans.status, String(L_SAFE.length));
  assert.equal(t.projects.status, "7", "P1, S1, E1, E2, PX, PF, PG");
  assert.equal(t.projects.detail, "films 4 · Shows 1 · Episodes 2 · deleted projects that still have files 1",
    "PF and PG name a project that is not a Show: they are films, not Episodes");
  assert.equal(t.users.status, "4");
  assert.ok(!t.series.status.startsWith("FAIL") && !Object.values(t).some(r => r.status.startsWith("FAIL")));
});

check("legacy: every file is listed; a live film's files read as on the full schema", () => {
  assert.equal(lfiles.length, L_OBJECTS.length);
  const cur = lfile(L.current);
  assert.equal(cur.status, "current");
  assert.equal(cur.project_kind, "film");
  assert.equal(cur.show_title, null);
  assert.equal(cur.episode, null);
  assert.equal(cur.entity_name, "Adem");
  assert.equal(cur.project_title, "Neon Harbor");
  assert.equal(cur.project_owner_email, "alice@example.com");
  assert.equal(lfile(L.cameo).status, "cameo-angle");
  assert.equal(lfile(L.cameo).entity_name, "Adem");
});

check("legacy Show + Episode: markers resolve kind, Show title, episode number and Bible names", () => {
  const r = lfile(L.showLegacy);
  assert.equal(r.status, "current");
  assert.equal(r.project_id, E1);
  assert.equal(r.project_title, "Dust Road E1");
  assert.equal(r.project_kind, "episode");
  assert.equal(r.show_title, "Dust Road");
  assert.equal(r.episode, 1);
  assert.equal(r.entity_id, "mara");
  assert.equal(r.entity_name, "Mara", "named from the Show Bible");
  assert.deepEqual(r.referenced_by_project_ids, [S1]);
  const ep = lfile(L.epBible);
  assert.equal(ep.entity_name, "The Well", "Episode doc has no locations: the parent Show's Bible names it");
  assert.equal(ep.episode, 2);
  assert.equal(ep.show_title, "Dust Road");
  const un = lfile(L.epUnref);
  assert.equal(un.status, "unreferenced");
  assert.equal(un.entity_name, "Lamp");
  assert.equal(un.safe_to_delete, true);
});

check("legacy: a Show row referencing a file under Episode 1's folder is NOT an orphan", () => {
  const r = lfile(L.showLegacy);
  assert.equal(r.safe_to_delete, false);
  assert.equal(r.orphan_reason, null);
  assert.ok(!lOrphans.has(L.showLegacy));
});

check("legacy: a malformed doc.showId never raises and leaves a plain film", () => {
  const r = lfile(L.oddMarker);
  assert.equal(r.project_kind, "film");
  assert.equal(r.show_title, null);
  assert.equal(r.episode, null);
  assert.equal(r.entity_name, "Zed");
  assert.equal(r.status, "current");
});

await acheck("legacy: a doc.showId naming a film or a deleted project is NOT an Episode (only a Show parent counts)", async () => {
  // as series-production.sql's backfill/trigger (parent must be a Show) and the
  // app's turnSeries.groups() ('unavailable', never an Episode of that project)
  const r = lfile(L.notAShow);
  assert.deepEqual([r.project_kind, r.show_title, r.episode], ["film", null, null], "showId → the film P1");
  assert.equal(r.entity_name, null, "names never come from the unrelated film's doc (P1 calls prop-knife 'Knife')");
  assert.equal(r.status, "current");
  const rows = await lrows(`select project_id, kind, show_title, episode from turn_admin.projects where project_id in ($1, $2)`, [PF, PG]);
  assert.deepEqual(rows.map(p => [p.project_id, p.kind, p.show_title, p.episode]).sort(),
    [[PF, "film", null, null], [PG, "film", null, null]].sort(), "showId → a film, showId → a deleted project");
  // the parent's marker is read like the app reads it: 'true' in any case, also as
  // a string; once the parent stops being a Show, its Episodes read as films
  const e1 = async () => (await ldb.query(`select kind, show_title, episode from turn_admin.projects where project_id = $1`, [E1])).rows[0];
  await ldb.exec(`begin`);
  try {
    await ldb.query(`update public.turn_projects set doc = jsonb_set(doc, '{isShow}', '"TRUE"') where id = $1`, [S1]);
    assert.deepEqual(await e1(), { kind: "episode", show_title: "Dust Road", episode: 1 });
    await ldb.query(`update public.turn_projects set doc = jsonb_set(doc, '{isShow}', 'false') where id = $1`, [S1]);
    assert.deepEqual(await e1(), { kind: "film", show_title: null, episode: null });
  } finally {
    await ldb.exec(`rollback`);
  }
});

check("legacy: deleted project's file is an orphan, an unreferenced file is 'unreferenced'", () => {
  const d = lfile(L.deleted);
  assert.equal(d.status, "orphan: project deleted");
  assert.equal(d.project_title, "(deleted project)");
  assert.equal(d.project_kind, null);
  assert.equal(d.safe_to_delete, true);
  const u = lfile(L.unreferenced);
  assert.equal(u.status, "unreferenced");
  assert.equal(u.entity_name, "Knife");
  assert.match(u.orphan_reason, /no generation/);
});

check("legacy: < 1 h is 'uploading'; without the reservation table an old unreferenced file is not", () => {
  assert.equal(lfile(L.fresh).status, "uploading");
  assert.equal(lfile(L.fresh).safe_to_delete, false);
  assert.equal(lfile(L.stale).status, "unreferenced");
  assert.ok(!lfiles.some(r => r.status === "queued-for-cleanup"), "no queue, no reservations: nothing is queued");
});

check("legacy: relay PNG is 'service', _internal marker is a relay-security-marker, stage-tmp by age", () => {
  assert.equal(lfile(L.relayPng).status, "service");
  assert.equal(lfile(L.relayPng).safe_to_delete, false);
  assert.equal(lfile(L.marker).area, "relay-security-marker");
  assert.equal(lfile(L.marker).status, "service");
  assert.equal(lfile(L.marker).project_id, null);
  assert.ok(lOrphans.has(L.stageOld));
  assert.ok(!lOrphans.has(L.stageFresh));
});

check("legacy: orphans view is EXACTLY the safe set", () => {
  assert.deepEqual([...lOrphans].sort(), [...L_SAFE].sort());
  assert.equal(lfiles.filter(r => r.safe_to_delete).length, L_SAFE.length, "files.safe_to_delete mirrors orphans");
});

await acheck("legacy: projects and users views (kind from the markers, plan from turn_credits)", async () => {
  const rows = await lrows(`select * from turn_admin.projects`);
  const p = (id) => rows.find(r => r.project_id === id);
  assert.equal(p(S1).kind, "show");
  assert.equal(p(S1).show_title, "Dust Road");
  assert.equal(p(S1).episode, null);
  assert.equal(p(E1).kind, "episode");
  assert.equal(p(E1).show_title, "Dust Road");
  assert.equal(p(E1).episode, 1);
  assert.equal(p(E2).episode, 2);
  assert.equal(p(P1).kind, "film");
  assert.equal(p(PX).kind, "film");
  assert.equal(p(PD).title, "(deleted project)");
  const users = await lrows(`select * from turn_admin.users`);
  assert.equal(users.find(u => u.email === "alice@example.com").plan, "studio");
  assert.equal(Number(users.find(u => u.email === "carol@example.com").film_count), 3);
});

await acheck("legacy: privacy holds, only postgres can read, nothing but six views, no function left behind", async () => {
  await privacyAndLockdown(ldb);
});

await acheck("legacy: the PREFLIGHT REPORT alone is all-ok and names the features that are not installed", async () => {
  const start = SQL.indexOf("with need(schema_name");
  const end = SQL.indexOf(";", start);
  const rows = (await ldb.query(SQL.slice(start, end))).rows;
  assert.ok(rows.length >= 30);
  assert.ok(rows.every(r => r.ok === true), JSON.stringify(rows.filter(r => !r.ok)));
  const st = (name) => rows.find(r => r.check_name === name).status;
  for (const c of ["project_kind", "show_id", "episode_no"])
    assert.equal(st(`column public.turn_projects.${c}`), "not installed — Shows/episodes read from the document markers");
  assert.match(st("column public.turn_asset_upload_intents.expires_at"), /^not installed — /);
  assert.match(st("column public.turn_asset_cleanup_queue.path"), /^not installed — /);
  assert.equal(st("column public.turn_cameos.angles"), "ok");
  assert.equal(st("column public.turn_credits.plan"), "ok");
  assert.equal(st("column public.turn_projects.storage_slug"), "not installed — folder labels are shown but not compared (label_note stays empty)");
  // and the full schema reports everything as plain 'ok'
  const full = (await db.query(SQL.slice(start, end))).rows;
  assert.ok(full.every(r => r.status === "ok"), JSON.stringify(full.filter(r => r.status !== "ok")));
});

await acheck("legacy: saved query 'whole folders' lists only fully-safe folders of deleted projects", async () => {
  const rows = (await ldb.query(wholeFoldersQuery())).rows;
  assert.deepEqual(rows.map(r => r.user_folder + "/" + r.project_folder), [ALICE + "/" + PD],
    "the deleted film's folder only: the live film, the Episode folders (a Show row points into E1) and the odd film all hold live files");
  assert.equal(Number(rows[0].files), 1);
  // Bob's folder inside Alice's LIVE film holds only two stale, unreferenced sheets
  // (older than 1 h, no reservation table on this database). Listing it would send
  // the owner to a Dashboard folder delete, which would also take a sheet Bob
  // generates and records there after the query ran.
  const staleA = `${BOB}/${P1}/character/adem/sheet-20260101-000000-b0b0aaaa.png`;
  const staleB = `${BOB}/${P1}/character/adem/sheet-20260102-000000-b0b0bbbb.png`;
  const fresh = `${BOB}/${P1}/character/adem/sheet-20260926-000000-b0b0cccc.png`;
  const put = (p, age) => ldb.query(`insert into storage.objects(bucket_id, name, metadata, created_at, updated_at)
                                     values ('turn-assets', $1, $2, now() - $3::interval, now() - $3::interval)`,
    [p, j({ size: 20, mimetype: "image/png" }), age]);
  await ldb.exec(`begin`);
  try {
    await put(staleA, "3 days");
    await put(staleB, "2 days");
    const safe = (await ldb.query(`select path from turn_admin.orphans where path like $1 order by path`, [`${BOB}/${P1}/%`])).rows.map(r => r.path);
    assert.deepEqual(safe, [staleA, staleB], "both stale sheets are offered, by exact path");
    const before = (await ldb.query(wholeFoldersQuery())).rows;
    assert.ok(!before.some(r => r.user_folder === BOB && r.project_folder === P1), "a live project's folder is never listed");
    // 5 minutes later Bob generates a new sheet in P1: upload, then the row points at it
    await put(fresh, "0 seconds");
    await ldb.query(`insert into public.turn_generations(project_id, owner, entity_id, storage_path) values ($1, $2, 'adem-bob', $3)`, [P1, BOB, fresh]);
    const f = (await ldb.query(`select status, safe_to_delete from turn_admin.files where path = $1`, [fresh])).rows[0];
    assert.deepEqual(f, { status: "current", safe_to_delete: false });
    const after = (await ldb.query(`select path from turn_admin.orphans where path like $1 order by path`, [`${BOB}/${P1}/%`])).rows.map(r => r.path);
    assert.deepEqual(after, [staleA, staleB], "exact-path deletes still leave Bob's new sheet alone");
  } finally {
    await ldb.exec(`rollback`);
  }
});

await acheck("legacy: each storage key is still parsed once per file (the markers are per project row)", async () => {
  for (const v of ["files", "orphans", "projects", "users"]) {
    const plan = (await ldb.query(`explain (verbose, costs off) select * from turn_admin.${v}`)).rows
      .map(r => r["QUERY PLAN"]).join("\n");
    // per folder (3): the legacy uuid match + the readable grammar's uuid, and its label check (no 8 hex digits in a row)
    assert.equal((plan.match(/\[0-9a-f\]\{8\}-/g) || []).length, 2 * 3, `${v}: the folder regexes run once per folder`);
    assert.equal((plan.match(/\[0-9a-f\]\{8\}'/g) || []).length, 3, `${v}: the label check runs once per folder`);
    assert.equal((plan.match(/string_to_array/g) || []).length, 1, `${v}: the key is split once`);
    assert.equal(/metadata(?! ->>)/.test(plan), false, `${v}: the metadata jsonb is not carried into later steps`);
  }
});

await acheck("same column names and types in every view on the full and the legacy schema", async () => {
  const legacyColumns = await viewColumns(ldb);
  assert.ok(fullColumns.length > 60);
  assert.deepEqual(legacyColumns, fullColumns);
});

await acheck("preflight guard: a half-installed optional table (reservations without expires_at) aborts", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB_LEGACY + `\ncreate table public.turn_asset_upload_intents (path text primary key, project_id uuid);`);
  await assert.rejects(tmp.exec(SQL), /preflight: missing public\.turn_asset_upload_intents\.expires_at — a TURN migration is only partly applied/);
  await tmp.exec(`rollback`).catch(() => {});
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0, "turn_admin was not created");
  await tmp.close();
});

await acheck("preflight guard: half of the readable-folder feature (storage_slug without turn_storage_accounts) aborts", async () => {
  const tmp = new PGlite();
  await tmp.exec(STUB_LEGACY + `\nalter table public.turn_projects add column storage_slug text;`);
  await assert.rejects(tmp.exec(SQL), /preflight: missing public\.turn_storage_accounts\.handle, public\.turn_storage_accounts\.user_id — a TURN migration is only partly applied here \(storage-readable-folders\.sql\)/);
  await tmp.exec(`rollback`).catch(() => {});
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0, "turn_admin was not created");
  await tmp.close();
});

await acheck("preflight guard: a missing REQUIRED table (turn_cameos) still aborts on a legacy database", async () => {
  const tmp = new PGlite();
  const noCameos = STUB_LEGACY.replace(/-- cameos\.sql\ncreate table public\.turn_cameos \([\s\S]*?\n\);\n/, "");
  assert.ok(!noCameos.includes("turn_cameos"));
  await tmp.exec(noCameos);
  await assert.rejects(tmp.exec(SQL), /preflight: missing public\.turn_cameos\.angles, public\.turn_cameos\.char_id, public\.turn_cameos\.project_id — run these TURN migrations first: cameos\.sql/);
  await tmp.exec(`rollback`).catch(() => {});
  await tmp.close();
});

await acheck("preflight guard: no 'turn-assets' bucket (a required check) aborts before anything is created", async () => {
  // the header lists the bucket as required and says a failed required check stops
  // the run; without the bucket the views would install and simply list nothing
  const tmp = new PGlite();
  await tmp.exec(STUB_LEGACY);
  await seedLegacy(tmp);
  await tmp.exec(`delete from storage.buckets where id = 'turn-assets'`);
  await assert.rejects(tmp.exec(SQL), /preflight: the private bucket turn-assets does not exist .*Nothing was created/);
  await tmp.exec(`rollback`).catch(() => {});
  const n = (await tmp.query(`select count(*)::int as n from pg_namespace where nspname = 'turn_admin'`)).rows[0].n;
  assert.equal(n, 0, "turn_admin was not created");
  // and once the bucket exists the same database installs
  await tmp.exec(`insert into storage.buckets(id, name, public) values ('turn-assets', 'turn-assets', false)`);
  const t = statusTable(await tmp.exec(SQL));
  assert.equal(t.bucket.status, "ok");
  assert.equal(t.views.status, "installed");
  await tmp.close();
});

await acheck("after series-production.sql lands, a re-run switches to the columns with the same view columns", async () => {
  // the migration, reduced to what the views read: normalized columns backfilled
  // from the markers, plus the reservation and cleanup tables
  await ldb.exec(`
    alter table public.turn_projects
      add column project_kind text not null default 'film',
      add column show_id uuid references public.turn_projects(id),
      add column episode_no integer;
    update public.turn_projects set project_kind = 'show' where lower(coalesce(doc ->> 'isShow', 'false')) = 'true';
    update public.turn_projects e
       set project_kind = 'episode', show_id = s.id, episode_no = (e.doc ->> 'episodeNo')::int
      from public.turn_projects s
     where e.doc ->> 'showId' = s.id::text and s.project_kind = 'show' and e.owner = s.owner;
  ` + RESERVATION_DDL);
  const t = statusTable(await ldb.exec(SQL));
  for (const k of ["series", "intents", "queue"]) assert.equal(t[k].status, "installed", k);
  assert.deepEqual(await viewColumns(ldb), fullColumns, "create or replace view kept every column");
  await assertInvoker(ldb);
  const fileRow = async (p) => (await ldb.query(`select * from turn_admin.files where path = $1`, [p])).rows[0];
  assert.equal((await fileRow(L.showLegacy)).show_title, "Dust Road");
  // the columns are now the authority: a column value wins over the doc marker
  await ldb.query(`update public.turn_projects set episode_no = 7 where id = $1`, [E2]);
  assert.equal((await fileRow(L.epBible)).episode, 7);
  // …except on a row whose kind is not film / show / episode: then the markers
  // apply, as the app does (normalizeProjectRow)
  await ldb.query(`update public.turn_projects set project_kind = '', show_id = null, episode_no = null where id = $1`, [E1]);
  const e1 = await fileRow(L.showLegacy);
  assert.deepEqual([e1.project_kind, e1.show_title, e1.episode], ["episode", "Dust Road", 1]);
  // the same fallback on a row whose doc.showId names a film (P1 has kind 'film'):
  // still a film, and no names from P1's doc
  assert.equal((await ldb.query(`select project_kind from public.turn_projects where id = $1`, [PF])).rows[0].project_kind, "film",
    "the backfill left it a film");
  await ldb.query(`update public.turn_projects set project_kind = '' where id = $1`, [PF]);
  const pf = await fileRow(L.notAShow);
  assert.deepEqual([pf.project_kind, pf.show_title, pf.episode, pf.entity_name], ["film", null, null, null]);
  // and the reservation / queue rules are live again
  await ldb.query(`insert into public.turn_asset_upload_intents(path, project_id, uploader, expires_at) values ($1, $2, $3, now() + interval '10 minutes')`, [L.stale, P1, ALICE]);
  await ldb.query(`insert into public.turn_asset_cleanup_queue(path, project_id, uploader) values ($1, $2, $3)`, [L.unreferenced, P1, ALICE]);
  assert.equal((await fileRow(L.stale)).status, "uploading");
  assert.equal((await fileRow(L.unreferenced)).status, "queued-for-cleanup");
  assert.equal((await fileRow(L.unreferenced)).safe_to_delete, false);
});

await ldb.close();
await db.close();
console.log(`${checks} checks passed`);

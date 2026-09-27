/* test-storage-keys.mjs — the one storage-key parser (app/storage-keys.js), readable
   folders (owner decision 2026-09-27).
   - every vector in scripts/fixtures/storage-key-vectors.json: segments, full keys of
     every area, rejects;
   - folder() round-trips and throws; segmentIdLoose loosens only the legacy case;
   - the API is frozen, and the file also runs as an ES module (Deno imports it);
   - the three Edge Function copies are byte-identical to app/storage-keys.js, and
     scripts/build-dist.mjs makes them;
   - JS and SQL agree: the canonical helper block of supabase/storage-readable-folders.sql
     runs on PGlite and answers every vector plus 4,000 fuzzed segments and 1,000 fuzzed
     paths exactly like the JS parser.
   OFFLINE: no network, no Supabase. Run: node scripts/test-storage-keys.mjs */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log("PASS", name); };

const SRC = read("app/storage-keys.js");
const box = {}; box.globalThis = box; vm.createContext(box);
vm.runInContext(SRC, box, { filename: "app/storage-keys.js" });
const K = box.TurnStorageKeys;
const V = JSON.parse(read("scripts/fixtures/storage-key-vectors.json"));
const plain = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

await test("segment vectors: legacy uuid, readable label--uuid, and every reject", () => {
  assert.ok(V.segments.length >= 35);
  for (const { seg, id, note } of V.segments) {
    assert.equal(K.segmentId(seg), id, `${note}: ${JSON.stringify(seg)}`);
    const s = K.segment(seg);
    if (id === null) assert.equal(s, null, note);
    else if (seg === id) assert.deepEqual(plain(s), { id, label: null, legacy: true }, note);
    else assert.deepEqual(plain(s), { id, label: seg.slice(0, -38), legacy: false }, note);
  }
  for (const x of [null, undefined, 42, {}, [], true]) assert.equal(K.segmentId(x), null);
});

await test("anti-spoof: a readable folder can never reproduce a legacy folder's leading uuid group (review 2026-09-27)", () => {
  const victim = V.uuid, mine = V.ownerUuid;
  const spoofs = [
    `${victim.replace("-", "a-")}--${mine}`,            // one extra character in group 1
    `0${victim}--${mine}`,                               // a leading 0
    `${victim.replace(/-/g, "")}--${mine}`,              // no hyphens
    `x-${victim}--${V.projectUuid}`,                     // a uuid inside a project slug
    `${victim.slice(0, 7)}-${victim.slice(7)}--${mine}`, // hyphen moved (the last group still has 12 hex digits)
    `${victim.slice(0, 8)}--${mine}`, `${victim.slice(0, 8)}-x--${mine}`, `u-${victim.slice(0, 8)}--${mine}`,
  ];
  for (const s of spoofs) assert.equal(K.segmentId(s), null, s);
  for (const s of spoofs) assert.equal(K.uid(s + "/" + V.projectUuid + "/character/x/f.png"), null, "uid of " + s);
  // near misses stay valid: 7 hex digits in a row, anywhere
  for (const s of [`${victim.slice(0, 7)}-x--${mine}`, `deadbee-cafe-1234567--${mine}`, `abcdefgh--${mine}`])
    assert.equal(K.segmentId(s), mine, s);
});

await test("key vectors: uid (2+ segments), strict projectId (3+ segments), parse() area / project / relay PNG", () => {
  for (const k of V.keys) {
    assert.equal(K.uid(k.path), k.uid, "uid " + k.path);
    assert.equal(K.projectId(k.path), k.projectId, "projectId " + k.path);
    const p = K.parse(k.path);
    assert.equal(p.area, k.area, "area " + k.path);
    assert.equal(p.projectId, k.parseProjectId, "parse projectId " + k.path);
    assert.equal(p.relayPng, k.relayPng, "relayPng " + k.path);
    assert.equal(p.uid, k.path.split("/").length >= 2 ? K.segmentId(k.path.split("/")[0]) : null);
  }
  for (const area of ["asset", "show-import-copy", "stage-temp", "studio-preview", "unknown"])
    assert.ok(V.keys.some((k) => k.area === area && !/^[0-9a-f]{8}-/.test(k.path)), "a readable vector for " + area);
});

await test("folder() builds a folder that parses back to its id, or throws", () => {
  const U = V.uuid;
  assert.equal(K.folder("alex-smith", U), "alex-smith--" + U);
  assert.equal(K.folder(null, U), U);
  assert.equal(K.folder("", U), U);
  assert.equal(K.segmentId(K.folder("x".repeat(64), U)), U);
  for (const [label, id] of [["Alex", U], ["a--b", U], ["deadbeef", U], ["x".repeat(65), U], ["a_b", U], ["-a", U],
    ["ok", U.toUpperCase()], ["ok", "not-a-uuid"], [null, U.toUpperCase()], ["ok", null], ["ok", 42]])
    assert.throws(() => K.folder(label, id), /not a valid storage folder/, JSON.stringify([label, id]));
  assert.equal(K.isFolderFor("pine-soot--" + U, U), true);
  assert.equal(K.isFolderFor(U, U), true);
  assert.equal(K.isFolderFor("pine-soot--" + U, V.projectUuid), false);
  assert.equal(K.isFolderFor("Pine-soot--" + U, U), false);
  assert.equal(K.isFolderFor(U, ""), false);
  for (const id of [null, undefined, 42]) for (const value of ["garbage", null, undefined, ""]) assert.equal(K.isFolderFor(value, id), false, `${value} for ${id}`);
});

await test("segmentIdLoose loosens ONLY the legacy uuid (any case, lowercased); readable stays strict", () => {
  const U = V.uuid;
  assert.equal(K.segmentIdLoose(U.toUpperCase()), U);
  assert.equal(K.segmentIdLoose(U), U);
  assert.equal(K.segmentIdLoose("admin--" + U), U);
  for (const s of ["admin--" + U.toUpperCase(), "Admin--" + U, "{" + U + "}", U.replace(/-/g, ""), "stage-tmp", ""])
    assert.equal(K.segmentIdLoose(s), null, s);
});

await test("the API is frozen and names the service segments", () => {
  assert.ok(Object.isFrozen(K));
  assert.deepEqual(plain(K.SERVICE_SEGMENTS), ["stage-tmp", "studio-previews"]);
  assert.deepEqual(plain(K.INTERNAL_ROOTS), ["_internal", "blender-studio-internal"]);
  assert.ok(K.ASSET_FOLDERS.includes("storyboard") && !K.ASSET_FOLDERS.includes("series-migration"));
  assert.equal(K.MAX_SEGMENT, 102);
});

await test("the Edge Function copies are byte-identical, build-dist makes them, and the file runs as an ES module", async () => {
  for (const fn of ["image-proxy", "blender-bridge", "admin-storage"])
    assert.equal(read(`supabase/functions/${fn}/storage-keys.js`), SRC, fn + " copy drifted: run node scripts/build-dist.mjs (or copy app/storage-keys.js)");
  const build = read("scripts/build-dist.mjs");
  assert.match(build, /for \(const fn of \["image-proxy", "blender-bridge", "admin-storage"\]\)\s*\n\s*cpSync\(join\(APP, "storage-keys\.js"\), join\(ROOT, "supabase", "functions", fn, "storage-keys\.js"\)\)/);
  // Deno imports it as an ES module: no CommonJS globals, strict mode, globalThis only
  const dir = mkdtempSync(join(tmpdir(), "turn-storage-keys-"));
  try {
    const file = join(dir, "storage-keys.mjs");
    writeFileSync(file, SRC);
    delete globalThis.TurnStorageKeys;
    await import(pathToFileURL(file).href);
    assert.equal(typeof globalThis.TurnStorageKeys?.segmentId, "function", "ESM import sets globalThis.TurnStorageKeys");
    assert.equal(globalThis.TurnStorageKeys.segmentId("pine-soot--" + V.projectUuid), V.projectUuid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!/\brequire\(|\bimport\s|\bexports\./.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")), "no module system beyond the guarded module.exports");
});

await test("every .rpc(\"turn_storage_folders…\") call names exactly the SQL function's arguments", () => {
  const sql = read("supabase/storage-readable-folders.sql");
  const sqlArgs = (fn) => {
    const m = new RegExp("create or replace function public\\." + fn + "\\(([^)]*)\\)", "i").exec(sql);
    assert.ok(m, fn + " is defined in storage-readable-folders.sql");
    return m[1].split(",").map((a) => a.trim().split(/\s+/)[0]).filter(Boolean).sort();
  };
  const calls = [
    ["app/cloud.jsx", "turn_storage_folders"],
    ["supabase/functions/image-proxy/index.ts", "turn_storage_folders_for"],
    ["supabase/functions/blender-bridge/supabase-adapter.mjs", "turn_storage_folders_for"],
  ];
  for (const [file, fn] of calls) {
    const src = read(file);
    const found = [...src.matchAll(new RegExp("\\.rpc\\(\"" + fn + "\",\\s*\\{([^}]*)\\}", "g"))];
    assert.equal(found.length, 1, `${file} calls ${fn} once`);
    const keys = found[0][1].split(",").map((kv) => kv.split(":")[0].trim()).filter(Boolean).sort();
    assert.deepEqual(keys, sqlArgs(fn), `${file}: ${fn} argument names`);
  }
});

/* ── JS = SQL ─────────────────────────────────────────────────────────────── */
const MIGRATION = read("supabase/storage-readable-folders.sql");
const a = MIGRATION.indexOf("-- >>> TURN storage key helpers");
const b = MIGRATION.indexOf("-- <<< end of the TURN storage key helpers");
assert.ok(a > 0 && b > a, "the canonical helper block is in supabase/storage-readable-folders.sql");
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
await db.exec(MIGRATION.slice(a, b));
const sqlSeg = async (segs) => (await db.query(
  `select s.ord, public.turn_storage_segment_id(s.seg)::text as id
     from jsonb_array_elements_text($1::jsonb) with ordinality as s(seg, ord) order by s.ord`, [JSON.stringify(segs)])).rows.map((r) => r.id);
const sqlPath = async (paths) => (await db.query(
  `select s.ord, public.turn_storage_uid(s.p)::text as uid,
          case when coalesce(array_length(string_to_array(s.p, '/'), 1), 0) >= 3
               then public.turn_storage_segment_id(split_part(s.p, '/', 2))::text end as pid
     from jsonb_array_elements_text($1::jsonb) with ordinality as s(p, ord) order by s.ord`, [JSON.stringify(paths)])).rows;

await test("JS = SQL on every vector (segments and full keys)", async () => {
  const segs = V.segments.map((s) => s.seg);
  assert.deepEqual(await sqlSeg(segs), segs.map((s) => K.segmentId(s)));
  const rows = await sqlPath(V.keys.map((k) => k.path));
  V.keys.forEach((k, i) => {
    assert.equal(rows[i].uid, K.uid(k.path), "uid " + k.path);
    assert.equal(rows[i].pid, K.projectId(k.path), "strict project id " + k.path);
  });
});

await test("JS = SQL on 4,000 fuzzed segments and 1,000 fuzzed paths", async () => {
  let seed = 20260927;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const hex = (n, upper) => Array.from({ length: n }, () => pick([..."0123456789abcdef"])).join("")[upper ? "toUpperCase" : "toLowerCase"]();
  const uuid = () => { const up = rnd() < 0.05; return [hex(8, up), hex(4, up), hex(4, up), hex(4, up), hex(12, up)].join("-"); };
  const chars = [..."abcdefghijklmnopqrstuvwxyz0123456789-", "-", "-", "_", ".", "A", "Z", "é", " "];
  const label = () => {
    const kind = rnd();
    if (kind < 0.12) return pick(["", "", "x-", "take-", "0"]) + hex(pick([6, 7, 7, 8, 9, 12, 32])) + pick(["", "-", "-x", "1", "g", "-1234"]);   // hex runs around the 8-digit limit
    if (kind < 0.16) return "x".repeat(pick([63, 64, 65, 66]));             // the length boundary
    const n = 1 + Math.floor(rnd() * 20);
    return Array.from({ length: n }, () => pick(chars)).join("");
  };
  const segment = () => {
    const kind = rnd();
    if (kind < 0.15) return uuid();
    if (kind < 0.2) return pick(["stage-tmp", "studio-previews", "_internal", "series-migration", "", ".", ".."]);
    if (kind < 0.25) return pick(["{" + uuid() + "}", uuid().replace(/-/g, ""), uuid().slice(0, 35), uuid() + "x"]);
    return label() + pick(["--", "--", "--", "-", "---", ""]) + uuid();
  };
  const segs = Array.from({ length: 4000 }, segment);
  const js = segs.map((s) => K.segmentId(s));
  assert.deepEqual(await sqlSeg(segs), js);
  const legacyHits = segs.filter((s, i) => js[i] && s === js[i]).length, readableHits = segs.filter((s, i) => js[i] && s !== js[i]).length;
  assert.ok(legacyHits > 300 && readableHits > 250 && js.includes(null), `the fuzz reaches every branch: ${legacyHits} legacy, ${readableHits} readable`);
  // the anti-spoof property: a readable folder's first 8 characters are never all hex
  // digits (a legacy folder's always are), and no accepted label holds 8 in a row
  const readable = segs.filter((s, i) => js[i] && s !== js[i]);
  assert.ok(readable.every((s) => !/^[0-9a-f]{8}/.test(s) && !/[0-9a-f]{8}/.test(s.slice(0, -38))), "no accepted label holds 8 hex digits in a row");
  const hexRunLabels = segs.filter((s) => /--[0-9a-f]{8}-/.test(s) && /[0-9a-f]{8}/.test(s.slice(0, -38)) && /^[a-z0-9]+(?:-[a-z0-9]+)*--/.test(s));
  assert.ok(hexRunLabels.length > 50 && hexRunLabels.every((s) => K.segmentId(s) === null), `every well-formed label with an 8-hex run is refused (${hexRunLabels.length} fuzzed)`);
  const paths = Array.from({ length: 1000 }, () => Array.from({ length: 1 + Math.floor(rnd() * 5) }, segment).join("/"));
  const rows = await sqlPath(paths);
  paths.forEach((p, i) => {
    assert.equal(rows[i].uid, K.uid(p), "uid " + p);
    assert.equal(rows[i].pid, K.projectId(p), "pid " + p);
  });
});
await db.close();

console.log(checks + " checks passed");

#!/usr/bin/env node
/* supabase/voices.sql — EXECUTED against an in-memory Postgres (PGlite) on top of schema.sql and
   team-collaboration.sql (the films and team tables it reads). Whose voice is it (2026-10-11, owner — voice review):
     A a real voice can't be recorded without whose voice it is, 18 or over and the time of the consent
     B speaking: the owner; anyone ACTIVE on a film (or an Episode of a Show) the voice is linked to; nobody else;
       a deleted voice speaks for nobody; an unrecorded voice is 'unknown'
     C linking: only the voice's owner (or the film owner's own voice) by someone on that film
     D users read only their own rows and can't write any; the functions are the service role's
     E running the file twice changes nothing
   node scripts/test-voice-registry-db.mjs */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)[1];
let passes = 0, failures = 0;
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
};
const U = { dora: "d0000000-0000-4000-8000-000000000001", cara: "d0000000-0000-4000-8000-000000000002",
  eve: "d0000000-0000-4000-8000-000000000003", rex: "d0000000-0000-4000-8000-000000000004" };
const F = { film: "f0000000-0000-4000-8000-000000000001", show: "f0000000-0000-4000-8000-000000000002",
  ep: "f0000000-0000-4000-8000-000000000003", eves: "f0000000-0000-4000-8000-000000000004" };

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(STUB);
for (const [k, id] of Object.entries(U)) await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())", [id, k + "@example.com"]);
for (const f of ["schema.sql", "team-collaboration.sql", "voices.sql"]) await db.exec(read("supabase/" + f));
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
async function as(who, sql, p = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      const claims = who === "service" ? { role: "service_role" } : { sub: who, role: "authenticated" };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
      return (await tx.query(sql, p)).rows;
    });
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: e.message }; }
}
await q("insert into public.turn_projects(id, owner, title, doc) values ($1,$2,'Film','{}'), ($3,$2,'Show','{}'), ($4,$2,'Ep 1', jsonb_build_object('showId', $3::text)), ($5,$6,'Eve''s','{}')",
  [F.film, U.dora, F.show, F.ep, F.eves, U.eve]);
await q("insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status) values ($1,$2,'cara@example.com',$3,'art_director','active'), ($4,$2,'cara@example.com',$3,'writer','active'), ($1,$2,'rex@example.com',$5,'writer','removed')",
  [F.film, U.dora, U.cara, F.ep, U.rex]);

// A
const bad = await as("service", "insert into public.turn_voices(voice_id, owner, created_by, kind) values ('c0', $1, $1, 'cloned')", [U.dora]);
ok("A a real voice with no consent record is refused", !bad.ok && /turn_voices_real_voice_consent/.test(bad.error), bad.error);
const notAdult = await as("service", "insert into public.turn_voices(voice_id, owner, created_by, kind, person_kind, consent) values ('c0', $1, $1, 'cloned', 'someone', jsonb_build_object('attestedAt', now(), 'adult', false))", [U.dora]);
ok("A …or one not 18 or over", !notAdult.ok);
const good = await as("service", "insert into public.turn_voices(voice_id, owner, created_by, kind, person_kind, person_name, consent) values ('sam', $1, $1, 'cloned', 'someone', 'Sam Reyes', jsonb_build_object('attestedAt', now(), 'adult', true)), ('des', $1, $1, 'designed', null, null, '{}')", [U.dora]);
ok("A a real voice with its consent, and a designed voice, are recorded", good.ok, good.error);

// B + C
const access = async (v, u, p) => (await as("service", "select public.turn_voice_access($1, $2, $3) a", [v, u, p])).rows[0].a;
const link = async (v, u, p) => (await as("service", "select public.turn_voice_link($1, $2, $3) a", [v, u, p])).rows[0].a;
ok("B the owner speaks with it anywhere", await access("sam", U.dora, null) === "owned");
ok("B a collaborator can't before it's linked to the film", await access("sam", U.cara, F.film) === "denied");
ok("C a collaborator can't link the owner's voice to a film they're not on", await link("sam", U.eve, F.film) === "denied");
ok("C the owner links it to their film", await link("sam", U.dora, F.film) === "linked");
ok("C …twice is fine", await link("sam", U.dora, F.film) === "linked");
ok("B now the active collaborator speaks with it on that film", await access("sam", U.cara, F.film) === "film");
ok("B …not without naming the film", await access("sam", U.cara, null) === "denied");
ok("B …and a removed member or an outsider never", await access("sam", U.rex, F.film) === "denied" && await access("sam", U.eve, F.film) === "denied");
ok("B an outsider naming their own film gets nothing", await access("sam", U.eve, F.eves) === "denied");
ok("C linked to a Show…", await link("des", U.dora, F.show) === "linked");
ok("B …it speaks in the Show's Episodes for those on them", await access("des", U.cara, F.ep) === "film");
ok("C nobody links a voice to someone else's film", await link("sam", U.dora, F.eves) === "denied");
ok("C an unrecorded voice is 'unknown'; a film that doesn't exist 'no_film'", await link("x", U.dora, F.film) === "unknown"
  && await link("sam", U.dora, "f0000000-0000-4000-8000-0000000000ff") === "no_film");
ok("B an unrecorded voice is 'unknown'", await access("stock-1", U.eve, null) === "unknown");
await as("service", "update public.turn_voices set deleted_at = now() where voice_id = 'des'");
ok("B a deleted voice speaks for nobody, its owner included", await access("des", U.dora, null) === "deleted" && await access("des", U.cara, F.ep) === "deleted");

// D
const mine = await as(U.dora, "select voice_id from public.turn_voices order by 1");
const theirs = await as(U.cara, "select voice_id from public.turn_voices");
ok("D a user reads their own voices only", mine.ok && mine.rows.map((r) => r.voice_id).join() === "des,sam" && theirs.ok && theirs.rows.length === 0, [mine, theirs]);
const w1 = await as(U.dora, "insert into public.turn_voices(voice_id, owner, created_by, kind) values ('d2', $1, $1, 'designed')", [U.dora]);
const w2 = await as(U.dora, "update public.turn_voices set person_name = 'x' where voice_id = 'sam'");
const w3 = await as(U.dora, "select * from public.turn_voice_films");
const w4 = await as(U.dora, "select public.turn_voice_access('sam', $1, null)", [U.cara]);
ok("D users write nothing, read no film links and can't call the functions", !w1.ok && (!w2.ok || (await q("select person_name from public.turn_voices where voice_id='sam'"))[0].person_name === "Sam Reyes") && !w3.ok && !w4.ok, [w1.error, w2.error, w3.error, w4.error]);

// E
const before = await q("select count(*)::int n from public.turn_voice_films");
const again = await db.exec(read("supabase/voices.sql")).then(() => true, (e) => e.message);
ok("E running the file again is a no-op", again === true && (await q("select count(*)::int n from public.turn_voice_films"))[0].n === before[0].n, again);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

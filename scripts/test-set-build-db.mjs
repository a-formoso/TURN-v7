#!/usr/bin/env node
/* Build the set for paying plans (owner 2026-11-05) — the REAL supabase/blender-render-jobs.sql and
   supabase/blender-render-billing.sql EXECUTED on an in-memory Postgres (PGlite), on top of credits.sql (billing v2),
   with the Supabase stub from scripts/test-series-production-sql.mjs and a pg_cron stub.

     A  the file installs on the pilot's table (its RESULT rows all ok) and a re-run changes nothing
     B  a held build: the submit records the hold on the job and ties it to the job (provider_ref), so the 30-minute
        stale-hold release leaves a waiting build alone
     C  the hold follows the job: completed → charged the held amount; cancelled, failed by the worker, or stopped twice
        (the lease ran out twice) → given back; a balance ends where it should
     D  turn_expire_blender_render_jobs: a build queued 2 hours, or running with a lease gone 30 minutes, fails and its
        credits come back; a fresh one is untouched; it runs every 10 minutes (pg_cron) and on every submit
     E  limits: 12 waiting or rendering across everyone ('queue_busy'), 3 per account, 30 a day; a hold that isn't
        held ('hold_missing'); the pilot's 7-argument submit still works with no hold
     F  privileges: only the service role may submit or expire; the trigger function is nobody's to call

   OFFLINE ONLY: node scripts/test-set-build-db.mjs */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
const CREDITS = read("supabase/credits.sql");
const JOBS = read("supabase/blender-render-jobs.sql");
const BILLING = read("supabase/blender-render-billing.sql");
const CRON_STUB = `create schema cron;
  create table cron.job(jobid bigserial primary key, jobname text unique, schedule text not null, command text not null,
                        active boolean not null default true);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as $$
    delete from cron.job where jobid = job_id returning true $$;`;

let passes = 0, failures = 0;
const safe = (v) => { try { return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)); } catch (_e) { return String(v); } };
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + safe(detail))); }
};
const section = (t) => console.log("\n=== " + t + " ===");
if (!STUB) { console.log("FAIL the Supabase stub was not found"); process.exit(1); }

const U = {
  D: { id: "20000000-0000-0000-0000-000000000001", email: "director@example.com" },
  O: { id: "20000000-0000-0000-0000-000000000002", email: "other@example.com" },
};
const PROJECT = "30000000-0000-0000-0000-000000000001";
const SCENE = { name: "Car deck", objects: [] };
const HASH = (n) => String(n).padStart(64, "a").slice(-64).replace(/[^a-f0-9]/g, "a");

async function as(db, who, sql, params = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      if (who !== "editor") {
        const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
      }
      return (await tx.query(sql, params)).rows;
    });
    return { ok: true, rows, row: rows[0] };
  } catch (e) { return { ok: false, error: e.message }; }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const lastRows = (res) => { for (let i = res.length - 1; i >= 0; i--) if (res[i].rows && res[i].rows.length) return res[i].rows; return []; };
async function runFile(db, sql) {
  try { const res = await db.exec(sql); return { ok: true, rows: lastRows(res) }; }
  catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, error: e.message }; }
}
const balance = async (db, who) => Number((await q(db, "select remaining from public.turn_credits where owner=$1", [who.id]))[0].remaining);
const hold = async (db, who, ref, amount = 15) => {
  const r = await as(db, "service", "select public.turn_hold_credits($1, $2, $3, 'set-build') as h", [who.id, amount, ref]);
  if (!r.ok) throw new Error(r.error);
  return r.row.h;
};
let reqN = 0;
const req = () => "40000000-0000-0000-0000-" + String(++reqN).padStart(12, "0");
const submit = (db, who, ref, extra = {}) => as(db, "service",
  "select * from public.turn_submit_blender_render_job($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
  [PROJECT, U.D.id, who.id, extra.location || "loc-deck", extra.request || req(), JSON.stringify(SCENE), extra.hash || HASH(reqN), ref]);
const holdRow = async (db, ref) => (await q(db, "select * from public.turn_credit_holds where ref=$1", [ref]))[0];
const finish = (db, job, status) => as(db, "service", "select * from public.turn_finish_blender_render_job($1,$2,$3,$4::jsonb,$5)",
  [job.id, job.lease_hash, status, status === "completed" ? '{"images":{}}' : null, status === "failed" ? "boom" : null]);
const claim = async (db, token) => (await as(db, "service", "select * from public.turn_claim_blender_render_job($1)", [token])).row;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(STUB);
for (const u of Object.values(U)) await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,now())", [u.id, u.email]);
let r = await runFile(db, CREDITS);
if (!r.ok) { console.log("FAIL credits.sql: " + r.error); process.exit(1); }
await db.exec(`insert into public.turn_credits(owner, remaining, plan, tier) values
  ('${U.D.id}', 1000, 'director', 'director'), ('${U.O.id}', 1000, 'studio', 'studio')`);
r = await runFile(db, JOBS);
if (!r.ok) { console.log("FAIL blender-render-jobs.sql: " + r.error); process.exit(1); }
await db.exec(CRON_STUB);
const body = BILLING.replace(/^create extension if not exists pg_cron;$/m, "");

section("A. install");
r = await runFile(db, body);
ok("A1 blender-render-billing.sql runs after the pilot's table and billing v2", r.ok, r.error);
ok("A2 every RESULT row reads ok", r.ok && r.rows.length === 4 && r.rows.every((x) => x.status === "ok"), r.rows);
ok("A3 it enables pg_cron itself", /^create extension if not exists pg_cron;$/m.test(BILLING));
const r2 = await runFile(db, body);
ok("A4 a re-run is fine: still one expiry job, one trigger", r2.ok && (await q(db, "select count(*)::int n from cron.job where jobname='kinolot-expire-set-builds'"))[0].n === 1
  && (await q(db, "select count(*)::int n from pg_trigger where tgname='turn_blender_render_job_billing'"))[0].n === 1, r2.error);
const cron = (await q(db, "select schedule, command from cron.job where jobname='kinolot-expire-set-builds'"))[0];
ok("D0 the expiry runs every 10 minutes", cron && cron.schedule === "4,14,24,34,44,54 * * * *" && /turn_expire_blender_render_jobs\(\)/.test(cron.command), cron);

section("B. a held build");
const start = await balance(db, U.D);
const ref1 = "setbuild:r1:aaaaaaaaaaaaaaaa";
const h1 = await hold(db, U.D, ref1);
ok("B1 the hold takes 15 credits", h1.ok === true && await balance(db, U.D) === start - 15, h1);
const s1 = await submit(db, U.D, ref1);
const job1 = s1.row;
ok("B2 the job records its hold and its price", s1.ok && job1.hold_ref === ref1 && job1.credits === 15 && job1.status === "queued", s1.error || job1);
const hr1 = await holdRow(db, ref1);
ok("B3 the hold is tied to the job (provider_ref setbuild-job:<id>)", hr1.provider_ref === "setbuild-job:" + job1.id, hr1);
await db.query("update public.turn_credit_holds set created_at = now() - interval '45 minutes' where ref = $1", [ref1]);
await as(db, "service", "select public.turn_release_stale_holds(30)");
ok("B4 the 30-minute stale release leaves a waiting build's hold alone", (await holdRow(db, ref1)).status === "held");
ok("B5 the open-holds list for the reconcilers' prefixes never shows it",
  (await as(db, "service", "select * from public.turn_open_provider_holds(0, 50, 'studio:')")).rows.length === 0
  && (await as(db, "service", "select * from public.turn_open_provider_holds(0, 50, 'video:')")).rows.length === 0);

section("C. the hold follows the job");
const c1 = await claim(db, HASH("lease1"));
ok("C1 the worker claims it", c1 && c1.id === job1.id && c1.status === "running", c1);
const f1 = await finish(db, c1, "completed");
const done1 = await holdRow(db, ref1);
ok("C2 completed → the hold is charged its held amount", f1.ok && done1.status === "settled" && done1.kept === 15 && await balance(db, U.D) === start - 15, f1.error || done1);
const usage = (await q(db, "select task, credits from public.turn_usage_events where request_id=$1", [ref1]))[0];
ok("C3 the spend is recorded under set-build", usage && usage.task === "set-build" && Number(usage.credits) === 15, usage);
const again = await finish(db, c1, "completed");
ok("C4 a repeated completion changes nothing", again.ok && (await holdRow(db, ref1)).kept === 15 && await balance(db, U.D) === start - 15, again.error);

const ref2 = "setbuild:r2:aaaaaaaaaaaaaaaa";
await hold(db, U.D, ref2);
const job2 = (await submit(db, U.D, ref2)).row;
await as(db, "service", "update public.turn_blender_render_jobs set status='cancelled', progress='cancelled' where id=$1", [job2.id]);
ok("C5 cancelled → the credits come back", (await holdRow(db, ref2)).status === "released" && await balance(db, U.D) === start - 15);

const ref3 = "setbuild:r3:aaaaaaaaaaaaaaaa";
await hold(db, U.D, ref3);
const job3 = (await submit(db, U.D, ref3)).row;
const c3 = await claim(db, HASH("lease3"));
await finish(db, c3, "failed");
ok("C6 the worker fails it → the credits come back", c3.id === job3.id && (await holdRow(db, ref3)).status === "released" && await balance(db, U.D) === start - 15);

const ref4 = "setbuild:r4:aaaaaaaaaaaaaaaa";
await hold(db, U.D, ref4);
const job4 = (await submit(db, U.D, ref4)).row;
for (const t of ["lease4a", "lease4b"]) {
  await claim(db, HASH(t));
  await db.query("update public.turn_blender_render_jobs set lease_expires_at = now() - interval '1 minute' where id=$1", [job4.id]);
}
await claim(db, HASH("lease4c"));
const j4 = (await q(db, "select status from public.turn_blender_render_jobs where id=$1", [job4.id]))[0];
ok("C7 stopped twice (lease ran out twice) → failed and the credits come back", j4.status === "failed" && (await holdRow(db, ref4)).status === "released" && await balance(db, U.D) === start - 15, j4);

section("D. builds the renderer never reached");
const ref5 = "setbuild:r5:aaaaaaaaaaaaaaaa", ref6 = "setbuild:r6:aaaaaaaaaaaaaaaa", ref7 = "setbuild:r7:aaaaaaaaaaaaaaaa";
await hold(db, U.D, ref5); const job5 = (await submit(db, U.D, ref5)).row;
await hold(db, U.D, ref6); const job6 = (await submit(db, U.D, ref6)).row;
await hold(db, U.D, ref7); const job7 = (await submit(db, U.D, ref7)).row;
await db.query("update public.turn_blender_render_jobs set created_at = now() - interval '3 hours' where id=$1", [job5.id]);
await db.query("update public.turn_blender_render_jobs set status='running', progress='rendering', lease_hash=$2, lease_expires_at = now() - interval '40 minutes' where id=$1", [job6.id, HASH("lost")]);
const expired = await as(db, "service", "select public.turn_expire_blender_render_jobs() as n");
const st = async (id) => (await q(db, "select status, error from public.turn_blender_render_jobs where id=$1", [id]))[0];
ok("D1 queued 2+ hours and running with a lease gone 30+ minutes → failed (2 jobs)", expired.ok && expired.row.n === 2
  && (await st(job5.id)).status === "failed" && (await st(job6.id)).status === "failed", expired);
ok("D2 their credits come back; the fresh one keeps its hold", (await holdRow(db, ref5)).status === "released" && (await holdRow(db, ref6)).status === "released"
  && (await holdRow(db, ref7)).status === "held" && await balance(db, U.D) === start - 30);
ok("D3 the card says why, and that nothing was charged", /nothing was charged/.test((await st(job5.id)).error || ""));
await db.query("update public.turn_blender_render_jobs set created_at = now() - interval '3 hours' where id=$1", [job7.id]);
const ref8 = "setbuild:r8:aaaaaaaaaaaaaaaa";
await hold(db, U.D, ref8);
await submit(db, U.D, ref8);
ok("D4 a submit expires old builds first", (await st(job7.id)).status === "failed" && (await holdRow(db, ref7)).status === "released");

section("E. limits");
const active = Number((await q(db, "select count(*) n from public.turn_blender_render_jobs where status in ('queued','running')"))[0].n);
ok("E0 one build waiting now", active === 1, active);
// the account limit: 3 waiting
const ref9 = "setbuild:r9:aaaaaaaaaaaaaaaa", ref10 = "setbuild:r10:aaaaaaaaaaaaaaa", ref11 = "setbuild:r11:aaaaaaaaaaaaaaa";
await hold(db, U.D, ref9); await submit(db, U.D, ref9);
await hold(db, U.D, ref10); await submit(db, U.D, ref10);
await hold(db, U.D, ref11);
const third = await submit(db, U.D, ref11);
ok("E1 a fourth waiting build of one account is refused (queue_full)", !third.ok && /queue_full/.test(third.error), third);
// the whole queue: 12
await db.exec(`insert into public.turn_blender_render_jobs(project_id, owner_id, actor_id, location_id, request_id, scene, scene_hash)
  select '${PROJECT}', '${U.O.id}', gen_random_uuid(), 'loc-x', gen_random_uuid(), '{}'::jsonb, repeat('b', 64) from generate_series(1, 9)`);
const ref12 = "setbuild:r12:aaaaaaaaaaaaaaa";
await hold(db, U.O, ref12);
const busy = await submit(db, U.O, ref12);
ok("E2 a 13th build in the whole queue is refused (queue_busy)", !busy.ok && /queue_busy/.test(busy.error), busy);
ok("E3 …and its hold is untouched by the database (the function gives it back)", (await holdRow(db, ref12)).status === "held");
await db.exec("delete from public.turn_blender_render_jobs where location_id='loc-x'");
const missing = await submit(db, U.O, "setbuild:nope");
ok("E4 a hold that doesn't exist is refused (hold_missing)", !missing.ok && /hold_missing/.test(missing.error), missing);
await as(db, "service", "select public.turn_release_hold($1)", [ref12]);
const released = await submit(db, U.O, ref12);
ok("E5 a hold already given back is refused too", !released.ok && /hold_missing/.test(released.error), released);
const pilot = await as(db, "service", "select * from public.turn_submit_blender_render_job($1,$2,$3,$4,$5,$6::jsonb,$7)",
  [PROJECT, U.O.id, U.O.id, "loc-pilot", req(), JSON.stringify(SCENE), HASH("pilot")]);
ok("E6 the pilot's 7-argument submit still works, with no hold", pilot.ok && pilot.row.hold_ref === null && pilot.row.credits === null, pilot.error);
const first9 = (await q(db, "select request_id, scene_hash from public.turn_blender_render_jobs where hold_ref=$1", [ref9]))[0];
const dup = await submit(db, U.D, ref9, { request: first9.request_id, hash: first9.scene_hash });
ok("E7 the same request again answers as itself", dup.ok && dup.row.hold_ref === ref9, dup);
await db.query("update public.turn_blender_render_jobs set created_at = now() - interval '1 hour' where actor_id=$1", [U.D.id]);
for (let i = 0; i < 30; i++) await db.query(`insert into public.turn_blender_render_jobs(project_id, owner_id, actor_id, location_id, request_id, scene, scene_hash, status)
  values ($1, $2, $2, 'loc-day', gen_random_uuid(), '{}'::jsonb, repeat('c', 64), 'completed')`, [PROJECT, U.O.id]);
const ref13 = "setbuild:r13:aaaaaaaaaaaaaaa";
await hold(db, U.O, ref13);
const daily = await submit(db, U.O, ref13);
ok("E8 a 31st build in a day is refused (daily_limit)", !daily.ok && /daily_limit/.test(daily.error), daily);

section("F. privileges");
const anonTry = await as(db, U.D, "select public.turn_expire_blender_render_jobs()");
ok("F1 a signed-in account can't run the expiry", !anonTry.ok, anonTry);
const subTry = await as(db, U.D, "select * from public.turn_submit_blender_render_job($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
  [PROJECT, U.D.id, U.D.id, "loc", req(), "{}", HASH("x"), "setbuild:x"]);
ok("F2 …nor submit a build", !subTry.ok, subTry);
const trigTry = await as(db, U.D, "select public.turn__blender_render_job_billing()");
ok("F3 …nor call the trigger function", !trigTry.ok, trigTry);
const tableTry = await as(db, U.D, "select * from public.turn_blender_render_jobs");
ok("F4 …nor read the job table", !tableTry.ok, tableTry);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

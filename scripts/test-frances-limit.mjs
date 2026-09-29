#!/usr/bin/env node
/* test-frances-limit.mjs — Frances's DAILY QUESTION LIMIT (owner decision 2026-09-28).

   Chatting with Frances stays free up to 50 questions per person per UTC day. This test proves,
   offline (no network, no Supabase project, no credentials):
     A. THE SQL (supabase/frances-daily-limit.sql) on an in-memory Postgres (PGlite) with the
        Supabase stub of test-series-production-sql.mjs (anon / authenticated / service_role,
        Supabase's default privileges, auth.users, auth.role() from request.jwt.claims; PostgREST
        is emulated by SET LOCAL ROLE + claims inside a transaction): the preflight, the RESULT
        table, counting to the limit, a burst of calls taking exactly `limit` slots, the one-
        statement upsert (a refused call writes nothing), the service-role guard, RLS and grants
        (and a re-run repairing them), re-run idempotence, the UTC day and rollover, the 35-day
        tidy-up (which can never cost a question its answer), cascade on account delete, a
        failed run changing nothing, and the BUSY refusal (a 1 s lock_timeout; a lock wait past it
        answers { allowed:false, busy:true } and counts nothing).
        PGlite has ONE connection, so calls are serialised there: the burst proves the count and
        the cap; the parallel-safety comes from the single INSERT … ON CONFLICT DO UPDATE … WHERE
        (row lock + re-check), which A5 pins in the function's source.
     B. THE DECISION HELPER (supabase/functions/image-proxy/frances-limit.mjs): the limit secret,
        the next UTC midnight, allowed / limited (the 429 body) / busy (429 frances_busy) /
        fail-open (missing function, error, malformed answer, timeout, a throwing client) / admin
        exempt, and "logged once"; the 8 s timeout sits far above the 1 s busy wait.
     C. THE PROXY — the REAL supabase/functions/image-proxy/index.ts, run in Node (type
        stripping) with a stub Supabase client whose service-role RPC reaches the real SQL on
        PGlite, and a stub model endpoint: a free Frances question takes a slot and is answered;
        past the limit → 429 "frances_daily_limit" with limit / used / resets_at and NO model call
        and no usage record; FRANCES_DAILY_LIMIT; admins, metered calls, other kinds and refused
        "muse" labels never touch the limit; fail-open (function missing, no service key, a hung
        call) serves the question and logs once; a burst's busy answer → 429 "frances_busy", no
        model call. Skipped (not failed) on a Node without type
        stripping or module.registerHooks.
     D. THE APP (app/ai.jsx in node:vm): museComplete turns the 429 into Frances's calm reply with
        code "frances_daily_limit" — one call, no retry, no toast, nothing metered; the reply's
        wording; the busy 429's calm line; other 429s stay ordinary errors.
     E. THE DOCK (app/muse.jsx with a small hooks runtime, on the real aiMuseChat): the reply shows
        as a normal Frances answer (not an error), the input stays usable, the next question goes
        out once and without the limited turn in its history.
     F. What Frances knows (APP_FEATURES → museFacts) and the docs say the same; every place that
        names the daily number agrees; her prompt's rules are unchanged.

   node scripts/test-frances-limit.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { PGlite } from "@electric-sql/pglite";
import {
  FRANCES_BUSY_ERROR, FRANCES_BUSY_MESSAGE, FRANCES_DAILY_LIMIT_DEFAULT, FRANCES_LIMIT_ERROR, FRANCES_LIMIT_RPC, FRANCES_LIMIT_TIMEOUT_MS,
  createFrancesLimiter, francesDailyLimit, francesLimitBusy, francesLimitDecision, francesLimitMessage, francesLimitProblem, nextUtcMidnight,
} from "../supabase/functions/image-proxy/frances-limit.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f)=>readFileSync(ROOT + f, "utf8");
const SQL = read("supabase/frances-daily-limit.sql");
let checks = 0, failed = 0, skipped = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
};
const skip = (name, why)=>{ skipped++; console.log("SKIP", name, "—", why); };
const j = (x)=>JSON.stringify(x);
const noop = ()=>{};

/* ======================= A. the SQL on PGlite ======================= */
// the Supabase pieces this file uses (from test-series-production-sql.mjs's SUPABASE_STUB)
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text
$f$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;
const U = {
  alice: "a11ce000-0000-4000-8000-000000000001", bob: "b0b00000-0000-4000-8000-000000000002",
  carol: "ca201000-0000-4000-8000-000000000003", dave: "da7e0000-0000-4000-8000-000000000004",
  erin:  "e2100000-0000-4000-8000-000000000005", fay: "fa100000-0000-4000-8000-000000000006",
  gus:   "9a500000-0000-4000-8000-000000000007", hal: "4a100000-0000-4000-8000-000000000008",
  admin: "ad000000-0000-4000-8000-0000000000ad",
};
async function newDb({ stub = true, users = true } = {}){
  const db = new PGlite();
  if(stub) await db.exec(SUPABASE_STUB);
  if(stub && users) for(const [name, id] of Object.entries(U)) await db.query("insert into auth.users(id, email) values ($1, $2)", [id, name+"@example.com"]);
  return db;
}
/* the whole file as one simple-protocol query, like the SQL Editor; returns the last result's rows */
async function runFile(db, text = SQL){
  try{ const res = await db.exec(text); return { ok:true, rows:res[res.length-1].rows }; }
  catch(e){ await db.exec("rollback").catch(noop); return { ok:false, error:e.message, code:e.code }; }
}
const resultPart = SQL.slice(SQL.indexOf("-- ── RESULT"));
const result = async (db)=>Object.fromEntries((await db.query(resultPart)).rows.map((r, i)=>[[10,15,20,30,40,50,60][i], r]));
/* PostgREST-like: one transaction as one caller */
async function as(db, who, fn){
  return db.transaction(async (t)=>{
    const claims = who==="service" ? { role:"service_role" } : who==="anon" ? { role:"anon" } : who==="postgres" ? null : { sub:who, role:"authenticated" };
    if(claims){
      await t.query("select set_config('request.jwt.claims', $1, true)", [j(claims)]);
      await t.exec(`set local role ${who==="service" ? "service_role" : who==="anon" ? "anon" : "authenticated"}`);
    }
    return fn(t);
  });
}
const consume = (db, user, limit, who = "service")=>as(db, who, async (t)=>
  (await t.query("select public.turn_frances_consume(p_user => $1, p_limit => $2) as r", [user, limit])).rows[0].r);
const tryIt = async (p)=>{ try{ return { ok:true, value:await p }; }catch(e){ return { ok:false, error:e.message, code:e.code }; } };
const usage = async (db, user)=>(await db.query(
  "select day::text as day, questions from public.turn_frances_usage where user_id = $1 order by day", [user])).rows;
const utcToday = async (db)=>(await db.query("select ((now() at time zone 'UTC')::date)::text as d")).rows[0].d;
const utcResets = async (db)=>(await db.query(`select to_char((((now() at time zone 'UTC')::date) + 1)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as r`)).rows[0].r;
async function schemaSnapshot(db){
  const q = async (s)=>(await db.query(s)).rows;
  return j({
    cols: await q(`select column_name, data_type, column_default, is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = 'turn_frances_usage' order by ordinal_position`),
    cons: await q(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.turn_frances_usage'::regclass order by 1`),
    idx:  await q(`select indexname, indexdef from pg_indexes where tablename = 'turn_frances_usage' order by 1`),
    rls:  await q(`select relrowsecurity, relforcerowsecurity, coalesce(array_to_string(relacl, ','), '') acl from pg_class where oid = 'public.turn_frances_usage'::regclass`),
    pol:  await q(`select polname from pg_policy where polrelid = 'public.turn_frances_usage'::regclass order by 1`),
    fn:   await q(`select md5(prosrc) src, prosecdef, provolatile, proconfig, coalesce(array_to_string(proacl, ','), '') acl, prorettype::regtype::text ret
                    from pg_proc where oid = 'public.turn_frances_consume(uuid, integer)'::regprocedure`),
  });
}

const db = await newDb();
let first;
await test("A1 the preflight stops on a database without Supabase's roles and Auth — and nothing is created", async ()=>{
  const bare = await newDb({ stub:false });
  const r = await runFile(bare);
  assert.equal(r.ok, false);
  assert.match(r.error, /^Frances daily limit: missing roles anon, authenticated, service_role \(run this on the Supabase database\)\. Nothing was created\.$/);
  const left = (await bare.query("select to_regclass('public.turn_frances_usage') t, to_regprocedure('public.turn_frances_consume(uuid, integer)') f")).rows[0];
  assert.deepEqual(left, { t:null, f:null });
  const noAuth = new PGlite();
  await noAuth.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  const r2 = await runFile(noAuth);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /Supabase Auth \(auth\.users, auth\.role\(\)\) is missing\. Nothing was created\./);
});
await test("A2 first run: one transaction, and the RESULT table reads ok for rows 10–50 with today's count in row 60", async ()=>{
  first = await runFile(db);
  assert.ok(first.ok, first.error);
  assert.deepEqual(first.rows.map(r=>r.item), ["Usage table", "Rows go with their account", "Row-level security on, no policies",
    "No API access to the table", "Daily-limit function", "Only the service role can call it", "Questions asked today (UTC)"]);
  first.rows.slice(0, 6).forEach(r=>assert.equal(r.status, "ok", r.item));
  assert.equal(first.rows[6].status, "accounts: 0 · questions: 0");
  assert.match(first.rows[6].detail, /FRANCES_DAILY_LIMIT \(default 50\)/);
  assert.match(SQL, /^begin;$/m); assert.match(SQL, /^commit;$/m);
  assert.equal((SQL.match(/^(?:begin|commit);$/gm) || []).length, 2, "exactly one transaction");
  assert.ok(SQL.indexOf("-- ── RESULT") > SQL.indexOf("\ncommit;"), "the RESULT query runs after commit");
  assert.ok(SQL.indexOf("notify pgrst, 'reload schema';") > SQL.indexOf("grant execute on function public.turn_frances_consume")
    && SQL.indexOf("notify pgrst, 'reload schema';") < SQL.indexOf("\ncommit;"), "the Data API is told to reload, inside the transaction");
});
await test("A3 counting: 50 questions are allowed (used 1..50), the 51st is refused, and the day's row stays at 50", async ()=>{
  const today = await utcToday(db), resets = await utcResets(db);
  for(let i = 1; i <= 50; i++){
    const r = await consume(db, U.alice, 50);
    assert.deepEqual(r, { allowed:true, used:i, limit:50, resets_at:resets }, "question "+i);
  }
  for(let k = 0; k < 3; k++) assert.deepEqual(await consume(db, U.alice, 50), { allowed:false, used:50, limit:50, resets_at:resets });
  assert.deepEqual(await usage(db, U.alice), [{ day:today, questions:50 }]);
  assert.match(resets, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  assert.equal(Date.parse(resets) - Date.parse(today+"T00:00:00Z"), 24*3600*1000, "resets at the next UTC midnight");
  // another person is untouched; a raised limit lets the same person on again
  assert.deepEqual((await consume(db, U.bob, 50)).used, 1);
  assert.deepEqual(await consume(db, U.alice, 52), { allowed:true, used:51, limit:52, resets_at:resets });
  assert.equal((await result(db))[60].status, "accounts: 2 · questions: 52");
});
await test("A4 a burst of 80 calls sent together takes exactly 50 slots (each count 1..50 once); the rest are refused", async ()=>{
  const out = await Promise.all(Array.from({ length:80 }, ()=>consume(db, U.carol, 50)));
  const allowed = out.filter(r=>r.allowed), refused = out.filter(r=>!r.allowed);
  assert.equal(allowed.length, 50); assert.equal(refused.length, 30);
  assert.deepEqual(allowed.map(r=>r.used).sort((a, b)=>a-b), Array.from({ length:50 }, (_, i)=>i+1));
  refused.forEach(r=>assert.equal(r.used, 50));
  assert.equal((await usage(db, U.carol))[0].questions, 50);
});
await test("A5 the slot is taken by ONE upsert that increments only under the limit; a refused call writes nothing", async ()=>{
  const src = (await db.query("select prosrc from pg_proc where oid = 'public.turn_frances_consume(uuid, integer)'::regprocedure")).rows[0].prosrc;
  const code = src.replace(/--[^\n]*/g, "");
  assert.equal((code.match(/\binsert\s+into\b/gi) || []).length, 1, "one insert");
  assert.match(code, /insert into public\.turn_frances_usage as u \(user_id, day, questions\)\s+values \(p_user, v_day, 1\)\s+on conflict \(user_id, day\) do update\s+set questions = u\.questions \+ 1\s+where u\.questions < p_limit\s+returning u\.questions into v_used;/);
  assert.ok(!/\bupdate\s+public\.turn_frances_usage\b/i.test(code), "no separate read-then-update");
  assert.ok(!/for\s+update|advisory/i.test(code), "the upsert's own row lock is the only lock");
  // at 49: the next call takes the 50th slot, the one after is refused
  await db.query("insert into public.turn_frances_usage(user_id, day, questions) values ($1, (now() at time zone 'UTC')::date, 49)", [U.dave]);
  assert.equal((await consume(db, U.dave, 50)).used, 50);
  const before = (await db.query("select xmin::text x, questions from public.turn_frances_usage where user_id = $1", [U.dave])).rows[0];
  const r = await consume(db, U.dave, 50);
  assert.deepEqual([r.allowed, r.used], [false, 50]);
  const after = (await db.query("select xmin::text x, questions from public.turn_frances_usage where user_id = $1", [U.dave])).rows[0];
  assert.deepEqual(after, before, "the refused call left the row version untouched");
});
await test("A6 the service-role guard: postgres, authenticated and anon are refused; even a stray EXECUTE grant doesn't open it", async ()=>{
  const pg = await tryIt(consume(db, U.erin, 50, "postgres"));
  assert.equal(pg.ok, false); assert.equal(pg.code, "42501"); assert.match(pg.error, /^TURN_FRANCES_LIMIT: service role required$/);
  for(const who of [U.erin, "anon"]){
    const r = await tryIt(consume(db, U.erin, 50, who));
    assert.equal(r.ok, false, who); assert.equal(r.code, "42501");
    assert.match(r.error, /permission denied for function turn_frances_consume/, who);
  }
  // a mistaken grant: EXECUTE works, and the function's own check still refuses
  await db.exec("begin; grant execute on function public.turn_frances_consume(uuid, integer) to authenticated;");
  let inner;
  try{
    await db.query("select set_config('request.jwt.claims', $1, true)", [j({ sub:U.erin, role:"authenticated" })]);
    await db.exec("set local role authenticated");
    inner = await tryIt(db.query("select public.turn_frances_consume($1, 50)", [U.erin]));
  }finally{ await db.exec("rollback"); }
  assert.equal(inner.ok, false); assert.match(inner.error, /^TURN_FRANCES_LIMIT: service role required$/);
  assert.deepEqual(await usage(db, U.erin), [], "nothing was counted");
  // bad arguments from the service role are refused too
  for(const [user, limit, re] of [[null, 50, /a user is required/], [U.erin, 0, /between 1 and 100000/], [U.erin, null, /between 1 and 100000/], [U.erin, 100001, /between 1 and 100000/]]){
    const r = await tryIt(consume(db, user, limit));
    assert.equal(r.ok, false); assert.equal(r.code, "22023"); assert.match(r.error, re);
  }
  const ghost = await tryIt(consume(db, "00000000-0000-4000-8000-00000000dead", 50));
  assert.equal(ghost.ok, false); assert.equal(ghost.code, "23503", "an unknown account can't be counted");
  // SECURITY DEFINER with an empty, pinned search_path and a 1 s lock wait (the busy refusal, A13)
  const fn = (await db.query("select prosecdef, proconfig from pg_proc where oid = 'public.turn_frances_consume(uuid, integer)'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef, true); assert.deepEqual(fn.proconfig, ['search_path=""', "lock_timeout=1s"]);
});
await test("A7 RLS on with no policies, no table access for anon / authenticated; a hand-made grant or policy is flagged and a re-run repairs it", async ()=>{
  for(const who of [U.erin, "anon"]){
    for(const stmt of ["select * from public.turn_frances_usage", `insert into public.turn_frances_usage(user_id, day, questions) values ('${U.erin}', current_date, 0)`,
      "update public.turn_frances_usage set questions = 0", "delete from public.turn_frances_usage"]){
      const r = await tryIt(as(db, who, (t)=>t.query(stmt)));
      assert.equal(r.ok, false, who+" "+stmt); assert.match(r.error, /permission denied for table turn_frances_usage/);
    }
  }
  const acl = (await db.query("select coalesce(array_to_string(relacl, ','), '') a, relrowsecurity r from pg_class where oid = 'public.turn_frances_usage'::regclass")).rows[0];
  assert.equal(acl.r, true);
  assert.ok(!/(^|,)(anon|authenticated|)=/.test(acl.a), "no anon / authenticated / PUBLIC entry: "+acl.a);
  // mistakes by hand: a SELECT grant (RLS still shows no rows) and a policy
  await db.exec("grant select on public.turn_frances_usage to authenticated");
  assert.deepEqual((await as(db, U.alice, (t)=>t.query("select count(*)::int n from public.turn_frances_usage"))).rows, [{ n:0 }], "RLS hides every row");
  await db.exec("create policy frances_leak on public.turn_frances_usage for select to authenticated using (true)");
  const bad = await result(db);
  assert.match(bad[30].status, /^FAIL/); assert.match(bad[20].status, /^FAIL/);
  const again = await runFile(db);
  assert.ok(again.ok, again.error);
  again.rows.slice(0, 6).forEach(r=>assert.equal(r.status, "ok", r.item));
  assert.deepEqual((await db.query("select polname from pg_policy where polrelid = 'public.turn_frances_usage'::regclass")).rows, []);
  // and a stray EXECUTE grant is flagged, then removed by a re-run
  await db.exec("grant execute on function public.turn_frances_consume(uuid, integer) to anon");
  assert.match((await result(db))[50].status, /^FAIL/);
  assert.ok((await runFile(db)).ok);
  assert.equal((await result(db))[50].status, "ok");
});
await test("A8 re-run idempotence: the same schema, grants and function, every count kept", async ()=>{
  const s1 = await schemaSnapshot(db);
  const d1 = (await db.query("select * from public.turn_frances_usage order by user_id, day")).rows;
  const r = await runFile(db);
  assert.ok(r.ok, r.error);
  assert.equal(await schemaSnapshot(db), s1);
  assert.deepEqual((await db.query("select * from public.turn_frances_usage order by user_id, day")).rows, d1);
  assert.ok(d1.length >= 4, "there were counts to keep");
  r.rows.slice(0, 6).forEach(x=>assert.equal(x.status, "ok", x.item));
});
await test("A9 the day is the UTC date whatever the session time zone; yesterday's full count doesn't block today", async ()=>{
  const today = await utcToday(db);
  await db.query("insert into public.turn_frances_usage(user_id, day, questions) values ($1, (now() at time zone 'UTC')::date - 1, 50)", [U.fay]);
  const r = await db.transaction(async (t)=>{
    await t.exec("set local time zone 'Pacific/Kiritimati'");   // UTC+14
    await t.query("select set_config('request.jwt.claims', $1, true)", [j({ role:"service_role" })]);
    await t.exec("set local role service_role");
    return (await t.query("select public.turn_frances_consume($1, 50) as r", [U.fay])).rows[0].r;
  });
  assert.deepEqual([r.allowed, r.used], [true, 1]);
  const rows = await usage(db, U.fay);
  assert.equal(rows.length, 2); assert.deepEqual(rows[1], { day:today, questions:1 });
  assert.equal(rows[0].questions, 50, "yesterday is kept");
});
await test("A10 the first question of a person's day tidies away days older than 35; a failing tidy-up never costs the answer", async ()=>{
  const ins = (user, ago)=>db.query("insert into public.turn_frances_usage(user_id, day, questions) values ($1, (now() at time zone 'UTC')::date - $2::int, 3)", [user, ago]);
  for(const ago of [34, 35, 36, 40]) await ins(U.bob, ago);        // Bob already asked today (A3)
  await consume(db, U.bob, 50);                                     // not his first today: nothing tidied
  assert.equal((await usage(db, U.bob)).length, 5);
  await consume(db, U.gus, 50);                                     // Gus's first today: tidies everyone's old days
  const left = (await db.query("select ((now() at time zone 'UTC')::date - day) ago from public.turn_frances_usage where user_id = $1 order by 1", [U.bob])).rows.map(r=>r.ago);
  assert.deepEqual(left, [0, 34, 35]);
  // the tidy-up fails (a trigger that raises on delete): the question is still allowed, the old row stays
  await db.exec(`create function public.frances_test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
                 create trigger frances_test_boom before delete on public.turn_frances_usage for each row execute function public.frances_test_boom();`);
  await ins(U.hal, 50);
  const r = await consume(db, U.hal, 50);
  assert.deepEqual([r.allowed, r.used], [true, 1]);
  assert.equal((await usage(db, U.hal)).length, 2);
  await db.exec("drop trigger frances_test_boom on public.turn_frances_usage; drop function public.frances_test_boom();");
});
await test("A11 rows go with their account (on delete cascade)", async ()=>{
  assert.ok((await usage(db, U.gus)).length > 0);
  await db.query("delete from auth.users where id = $1", [U.gus]);
  assert.deepEqual(await usage(db, U.gus), []);
});
await test("A12 a run that fails part-way changes nothing (one transaction)", async ()=>{
  const fresh = await newDb();
  const broken = SQL.replace("\ncommit;", "\nselect 1/0;\ncommit;");
  const r = await runFile(fresh, broken);
  assert.equal(r.ok, false); assert.match(r.error, /division by zero/);
  const left = (await fresh.query("select to_regclass('public.turn_frances_usage') t, to_regprocedure('public.turn_frances_consume(uuid, integer)') f")).rows[0];
  assert.deepEqual(left, { t:null, f:null });
  assert.ok((await runFile(fresh)).ok, "and the real file then runs");
});
await test("A13 busy: a lock wait past the 1 s lock_timeout (55P03) is refused with busy:true and counts nothing; row 40 checks the setting", async ()=>{
  const lt = (await db.query("select proconfig from pg_proc where oid = 'public.turn_frances_consume(uuid, integer)'::regprocedure")).rows[0].proconfig;
  assert.ok(lt.includes("lock_timeout=1s"), j(lt));
  const src = (await db.query("select prosrc from pg_proc where oid = 'public.turn_frances_consume(uuid, integer)'::regprocedure")).rows[0].prosrc;
  assert.match(src.replace(/--[^\n]*/g, ""), /returning u\.questions into v_used;\s+v_allowed := found;\s+exception when lock_not_available then\s+v_allowed := false;\s+v_busy\s+:= true;\s+end;/,
    "only a lock wait inside the upsert is caught; anything else still raises");
  // PGlite has one connection, so a real lock wait can't happen here: a trigger raises the same
  // SQLSTATE the lock wait does, inside the upsert
  await db.exec(`create function public.frances_test_lock() returns trigger language plpgsql as $$
                   begin raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout'; end $$;
                 create trigger frances_test_lock before insert on public.turn_frances_usage for each row execute function public.frances_test_lock();`);
  const resets = await utcResets(db);
  try{
    // Dave is at 50 from A5: a busy refusal reports the day's count without taking the row
    const before = (await db.query("select xmin::text x, questions from public.turn_frances_usage where user_id = $1 and day = (now() at time zone 'UTC')::date", [U.dave])).rows[0];
    assert.deepEqual(await consume(db, U.dave, 60), { allowed:false, used:50, limit:60, resets_at:resets, busy:true });
    assert.deepEqual((await db.query("select xmin::text x, questions from public.turn_frances_usage where user_id = $1 and day = (now() at time zone 'UTC')::date", [U.dave])).rows[0], before, "nothing counted");
    // someone with no row yet today: used 0, and still no row
    await db.query("delete from public.turn_frances_usage where user_id = $1 and day = (now() at time zone 'UTC')::date", [U.erin]);
    assert.deepEqual(await consume(db, U.erin, 50), { allowed:false, used:0, limit:50, resets_at:resets, busy:true });
    const today = await utcToday(db);
    assert.equal((await usage(db, U.erin)).filter(r=>r.day === today).length, 0);
    // the guard still comes first: a non-service caller is refused before any lock
    assert.equal((await tryIt(consume(db, U.erin, 50, "postgres"))).code, "42501");
  }finally{
    await db.exec("drop trigger frances_test_lock on public.turn_frances_usage; drop function public.frances_test_lock();");
  }
  // an ordinary answer has no busy key
  assert.deepEqual(Object.keys(await consume(db, U.erin, 50)).sort(), ["allowed", "limit", "resets_at", "used"]);
  // the RESULT table flags a function without the lock wait, and a re-run puts it back
  await db.exec("alter function public.turn_frances_consume(uuid, integer) reset lock_timeout");
  assert.match((await result(db))[40].status, /^FAIL/);
  assert.ok((await runFile(db)).ok);
  assert.equal((await result(db))[40].status, "ok");
  assert.match((await result(db))[40].detail, /1 s lock_timeout/);
});

/* ======================= B. the decision helper ======================= */
const NOW = Date.parse("2026-09-29T19:00:00Z");
await test("B1 the limit secret: a whole number 1..100000, anything else means 50", ()=>{
  assert.equal(FRANCES_DAILY_LIMIT_DEFAULT, 50);
  for(const [raw, want] of [[undefined, 50], [null, 50], ["", 50], ["20", 20], [" 7 ", 7], ["0", 50], ["-3", 50], ["2.5", 50], ["abc", 50], ["1e3", 50],
    ["100000", 100000], ["100001", 50], [75, 75], ["0050", 50]]) assert.equal(francesDailyLimit(raw), want, String(raw));
});
await test("B2 the next UTC midnight (the SQL's format), across a day, a month and a year", ()=>{
  assert.equal(nextUtcMidnight(NOW), "2026-09-30T00:00:00Z");
  assert.equal(nextUtcMidnight(Date.parse("2026-09-30T00:00:00Z")), "2026-10-01T00:00:00Z");
  assert.equal(nextUtcMidnight(Date.parse("2026-12-31T23:59:59Z")), "2027-01-01T00:00:00Z");
});
await test("B3 decisions: allowed, limited (the exact 429 body), admin exempt", ()=>{
  assert.deepEqual(francesLimitDecision({ result:{ allowed:true, used:7, limit:50, resets_at:"2026-09-30T00:00:00Z" }, limit:50, nowMs:NOW }),
    { serve:true, outcome:"allowed", used:7, limit:50 });
  assert.deepEqual(francesLimitDecision({ result:{ allowed:false, used:50, limit:50, resets_at:"2026-09-30T00:00:00Z" }, limit:50, nowMs:NOW }), {
    serve:false, outcome:"limited", status:429,
    body:{ error:"frances_daily_limit", message:"That’s today’s 50 free questions with Frances. She’ll be back after midnight UTC.", limit:50, used:50, resets_at:"2026-09-30T00:00:00Z" },
  });
  assert.equal(FRANCES_LIMIT_ERROR, "frances_daily_limit"); assert.equal(FRANCES_LIMIT_RPC, "turn_frances_consume");
  // a missing / broken resets_at falls back to the next UTC midnight; the answer's own limit wins
  const d = francesLimitDecision({ result:{ allowed:false, used:3, limit:3, resets_at:"soon" }, limit:50, nowMs:NOW });
  assert.deepEqual([d.body.limit, d.body.resets_at, d.body.message], [3, "2026-09-30T00:00:00Z", "That’s today’s 3 free questions with Frances. She’ll be back after midnight UTC."]);
  assert.equal(francesLimitMessage(1), "That’s today’s 1 free question with Frances. She’ll be back after midnight UTC.");
  // supabase-js shapes: a JSON string or a one-row array still decides
  assert.equal(francesLimitDecision({ result:j({ allowed:false, used:50, limit:50, resets_at:"2026-09-30T00:00:00Z" }) }).outcome, "limited");
  assert.equal(francesLimitDecision({ result:[{ allowed:true, used:1, limit:50 }] }).outcome, "allowed");
  assert.deepEqual(francesLimitDecision({ isAdmin:true, result:{ allowed:false } }), { serve:true, outcome:"admin" });
});
await test("B4 fail-open decisions: a missing function, any error, a malformed answer", ()=>{
  const missing = [
    { code:"PGRST202", message:"Could not find the function public.turn_frances_consume(p_limit, p_user) in the schema cache" },
    { code:"42883", message:"function public.turn_frances_consume(uuid, integer) does not exist" },
    { message:"relation \"public.turn_frances_usage\" does not exist", code:"42P01" },
  ];
  for(const e of missing){
    const d = francesLimitDecision({ error:e });
    assert.deepEqual([d.serve, d.outcome, d.problem], [true, "fail-open", "missing"], e.message);
    assert.equal(francesLimitProblem(e), "missing");
  }
  for(const e of [{ message:"TURN_FRANCES_LIMIT: service role required", code:"42501" }, new Error("fetch failed"), "boom", { message:"upstream 502" }]){
    const d = francesLimitDecision({ error:e });
    assert.deepEqual([d.serve, d.outcome, d.problem], [true, "fail-open", "error"], String(e.message || e));
  }
  for(const r of [null, undefined, {}, { allowed:"no" }, "not json", [], [{ allowed:true }, { allowed:false }], 42]){
    const d = francesLimitDecision({ result:r });
    assert.deepEqual([d.serve, d.outcome, d.problem], [true, "fail-open", "malformed"], j(r));
  }
  assert.equal(francesLimitProblem({ francesTimeout:true }), "timeout");
});
await test("B5 the limiter: admins never reach the database; the sanitised limit is sent; failures serve the question and log once per kind", async ()=>{
  const logs = [], calls = [];
  const check = createFrancesLimiter({ log:(m)=>logs.push(m), timeoutMs:30, now:()=>NOW });
  const resolving = (answer)=>(args)=>{ calls.push(args); return Promise.resolve(answer); };
  assert.equal((await check({ isAdmin:true, userId:U.alice, limit:50, consume:resolving({ data:{ allowed:false } }) })).outcome, "admin");
  assert.equal(calls.length, 0, "no database call for an admin");
  const ok = await check({ userId:U.alice, limit:"lots", consume:resolving({ data:{ allowed:true, used:1, limit:50 }, error:null }) });
  assert.equal(ok.outcome, "allowed"); assert.deepEqual(calls[0], { p_user:U.alice, p_limit:50 });
  const lim = await check({ userId:U.alice, limit:3, consume:resolving({ data:{ allowed:false, used:3, limit:3, resets_at:"2026-09-30T00:00:00Z" }, error:null }) });
  assert.deepEqual([lim.serve, lim.status, lim.body.error, lim.body.limit], [false, 429, "frances_daily_limit", 3]);
  assert.equal(logs.length, 0, "nothing logged while it works");
  // missing function, twice → one log line
  const miss = { data:null, error:{ code:"PGRST202", message:"Could not find the function public.turn_frances_consume(p_limit, p_user) in the schema cache" } };
  for(let i = 0; i < 2; i++) assert.equal((await check({ userId:U.alice, limit:50, consume:resolving(miss) })).serve, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[image-proxy\] Frances daily limit not enforced \(missing: Could not find the function .*\); serving the question\. Run supabase\/frances-daily-limit\.sql to turn the limit on\. Logged once per instance\.$/);
  // a client that throws synchronously, a rejected call, a hung call
  const t1 = await check({ userId:U.alice, limit:50, consume:()=>{ throw new Error("supabaseKey is required."); } });
  const t2 = await check({ userId:U.alice, limit:50, consume:()=>Promise.reject(new Error("fetch failed")) });
  const started = Date.now();
  const t3 = await check({ userId:U.alice, limit:50, consume:()=>new Promise(noop) });
  assert.ok(Date.now() - started < 1000, "the hung call is cut off at the timeout");
  assert.deepEqual([t1, t2, t3].map(d=>[d.serve, d.outcome, d.problem]), [[true, "fail-open", "error"], [true, "fail-open", "error"], [true, "fail-open", "timeout"]]);
  assert.equal(logs.length, 3, "one line per kind: missing, error, timeout");
  assert.ok(!logs.some(l=>l.includes(U.alice)), "no account id in the log");
  // a logger that throws never breaks Frances
  const loud = createFrancesLimiter({ log:()=>{ throw new Error("log sink down"); } });
  assert.equal((await loud({ userId:U.alice, limit:50, consume:()=>{ throw new Error("x"); } })).serve, true);
});
await test("B6 busy: the function's busy answer or an escaping 55P03 → 429 frances_busy, never served, never logged as a failure", async ()=>{
  const want = { serve:false, outcome:"busy", status:429, body:{ error:"frances_busy", message:"One question at a time, please — ask me again in a moment.", limit:50, used:12 } };
  assert.deepEqual(francesLimitDecision({ result:{ allowed:false, busy:true, used:12, limit:50, resets_at:"2026-09-30T00:00:00Z" }, limit:50, nowMs:NOW }), want);
  assert.equal(FRANCES_BUSY_ERROR, "frances_busy"); assert.equal(FRANCES_BUSY_MESSAGE, want.body.message);
  for(const e of [{ code:"55P03", message:"canceling statement due to lock timeout" }, { message:"canceling statement due to lock timeout" }]){
    assert.ok(francesLimitBusy(e));
    assert.deepEqual(francesLimitDecision({ error:e, limit:20 }), { serve:false, outcome:"busy", status:429, body:{ error:"frances_busy", message:FRANCES_BUSY_MESSAGE, limit:20 } });
  }
  assert.ok(!francesLimitBusy({ code:"42501", message:"TURN_FRANCES_LIMIT: service role required" }) && !francesLimitBusy(null));
  // busy:true only matters on a refusal; an admin is never asked
  assert.equal(francesLimitDecision({ result:{ allowed:true, busy:true, used:3, limit:50 } }).outcome, "allowed");
  assert.equal(francesLimitDecision({ isAdmin:true, error:{ code:"55P03" } }).outcome, "admin");
  const logs = [];
  const check = createFrancesLimiter({ log:(m)=>logs.push(m), timeoutMs:200, now:()=>NOW });
  // the reviewer's burst: the database answers "busy" after its own (short) lock wait — before the
  // proxy's timeout — so the call is refused, not served
  const slowBusy = ()=>new Promise((r)=>setTimeout(()=>r({ data:{ allowed:false, busy:true, used:50, limit:50, resets_at:"2026-09-30T00:00:00Z" }, error:null }), 40));
  const out = await Promise.all(Array.from({ length:5 }, ()=>check({ userId:U.alice, limit:50, consume:slowBusy })));
  assert.deepEqual(out.map(d=>d.outcome+"/"+d.serve), Array(5).fill("busy/false"));
  const esc = await check({ userId:U.alice, limit:50, consume:async ()=>({ data:null, error:{ code:"55P03", message:"canceling statement due to lock timeout" } }) });
  assert.equal(esc.outcome, "busy");
  assert.deepEqual(logs, [], "busy is the limit working, not a failure to log");
});
await test("B7 the proxy's timeout (only an outage fails open) sits far above the SQL's 1 s lock wait", ()=>{
  assert.equal(FRANCES_LIMIT_TIMEOUT_MS, 8000);
  const m = SQL.match(/^set lock_timeout = '(\d+)s'$/m);
  assert.ok(m, "the function pins lock_timeout");
  assert.equal(Number(m[1]), 1);
  assert.ok(Number(m[1])*1000*4 <= FRANCES_LIMIT_TIMEOUT_MS, "a burst's lock wait ends (busy) long before the proxy would fail open");
});

/* ======================= C. the real image-proxy index.ts ======================= */
const canRunTs = !!(process.features && process.features.typescript) && typeof nodeModule.registerHooks === "function";
if(!canRunTs){
  skip("C the real index.ts", "this Node ("+process.version+") has no type stripping or module.registerHooks; A, B and the static checks in F still cover the proxy");
}else{
  // the proxy's world: a fake Supabase client (the service-role RPC reaches the real SQL on PGlite) and a fake model
  const pdb = await newDb();
  assert.ok((await runFile(pdb)).ok);
  const ENV = { SUPABASE_URL:"https://example.supabase.co", SUPABASE_ANON_KEY:"anon-key", SUPABASE_SERVICE_ROLE_KEY:"service-key", ANTHROPIC_API_KEY:"sk-test" };
  const USERS = { "tok-alice":{ id:U.alice, email:"alice@example.com" }, "tok-bob":{ id:U.bob, email:"bob@example.com" }, "tok-carol":{ id:U.carol, email:"carol@example.com" },
    "tok-admin":{ id:U.admin, email:"admin@infinitestudioai.com" } };
  const W = { freeCallsToday:0, consume:null, rpcs:[], fetches:[], warns:[] };
  const pgliteConsume = async (name, args)=>{
    try{
      const r = await pdb.transaction(async (t)=>{
        await t.query("select set_config('request.jwt.claims', $1, true)", [j({ role:"service_role" })]);
        await t.exec("set local role service_role");
        return (await t.query(`select public.${name}(p_user => $1, p_limit => $2) as r`, [args.p_user, args.p_limit])).rows[0].r;
      });
      return { data:r, error:null };
    }catch(e){ return { data:null, error:{ message:e.message, code:e.code } }; }
  };
  const chain = (res)=>{ const c = { select:()=>c, eq:()=>c, gte:()=>c, limit:()=>c, order:()=>c, then:(ok, bad)=>Promise.resolve(res).then(ok, bad) }; return c; };
  globalThis.__francesTestCreateClient = (url, key, opts)=>{
    if(!key) throw new Error("supabaseKey is required.");
    if(key === ENV.SUPABASE_ANON_KEY) return {
      auth:{ getUser:async (tok)=>USERS[tok] ? { data:{ user:USERS[tok] }, error:null } : { data:{ user:null }, error:{ message:"invalid token" } } },
      from:(t)=>t === "turn_credits" ? chain({ data:[{ plan:"writer", remaining:100 }], error:null })
        : t === "turn_usage_events" ? chain({ count:W.freeCallsToday, error:null }) : chain({ data:[], error:null }),
      rpc:async (name, args)=>{ W.rpcs.push(["user", name, args]); return { data:[{ remaining:100, plan:"writer" }], error:null }; },
    };
    if(key === ENV.SUPABASE_SERVICE_ROLE_KEY) return { rpc:(name, args)=>{ W.rpcs.push(["service", name, args]); return (W.consume || pgliteConsume)(name, args); } };
    throw new Error("unexpected key "+key);
  };
  nodeModule.registerHooks({
    resolve(spec, ctx, next){
      if(spec === "https://esm.sh/@supabase/supabase-js@2")
        return { url:"data:text/javascript,export const createClient = (...a) => globalThis.__francesTestCreateClient(...a);", shortCircuit:true };
      return next(spec, ctx);
    },
  });
  let handler = null;
  globalThis.Deno = { serve:(h)=>{ handler = h; }, env:{ get:(k)=>ENV[k] } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init)=>{
    const u = String(url);
    if(u === "https://api.anthropic.com/v1/messages"){
      W.fetches.push(JSON.parse(init.body));
      return new Response(j({ content:[{ type:"text", text:"Open Export in the top bar." }], usage:{ input_tokens:12, output_tokens:8 }, stop_reason:"end_turn" }),
        { status:200, headers:{ "content-type":"application/json" } });
    }
    throw new Error("network disabled in this test: "+u);
  };
  const realWarn = console.warn, realEmit = process.emitWarning;
  console.warn = (...a)=>{ W.warns.push(a.join(" ")); };
  process.emitWarning = noop;   // Node's note that index.ts is parsed as an ES module
  try{ await import(ROOT + "supabase/functions/image-proxy/index.ts"); }
  finally{ process.emitWarning = realEmit; }
  const post = async (token, body)=>{
    const res = await handler(new Request("https://example.supabase.co/functions/v1/image-proxy", {
      method:"POST", headers:{ Authorization:"Bearer "+token, "Content-Type":"application/json" }, body:j(body) }));
    return { status:res.status, headers:res.headers, json:await res.json() };
  };
  const MUSE = (content = "How do I export my screenplay?")=>({ task:"text", usageKind:"muse", provider:"anthropic", model:"claude-opus-5",
    messages:[{ role:"user", content }] });
  const reset = ()=>{ W.rpcs = []; W.fetches = []; W.consume = null; W.freeCallsToday = 0; };
  const limitRpcs = ()=>W.rpcs.filter(r=>r[1] === "turn_frances_consume");
  const usageRecords = ()=>W.rpcs.filter(r=>r[1] === "turn_record_usage_event");
  try{
    await test("C1 a free Frances question takes a slot through the service-role RPC (limit 50) and is answered", async ()=>{
      reset();
      const r = await post("tok-alice", MUSE());
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.text, "Open Export in the top bar.");
      assert.deepEqual(limitRpcs(), [["service", "turn_frances_consume", { p_user:U.alice, p_limit:50 }]]);
      assert.equal(W.fetches.length, 1); assert.equal(W.fetches[0].max_tokens, 4096, "the free path's reply cap still applies");
      assert.equal(usageRecords()[0][2].credit_cost, 0, "still free");
      assert.equal((await usage(pdb, U.alice))[0].questions, 1);
    });
    await test("C2 past the limit: 429 frances_daily_limit with limit / used / resets_at, CORS, no model call, no usage record", async ()=>{
      reset();
      ENV.FRANCES_DAILY_LIMIT = "3";
      try{
        for(let i = 2; i <= 3; i++){ const r = await post("tok-alice", MUSE()); assert.equal(r.status, 200); }
        assert.equal(W.fetches.length, 2);
        W.fetches = []; W.rpcs = [];
        const r = await post("tok-alice", MUSE("One more?"));
        assert.equal(r.status, 429);
        assert.deepEqual(r.json, { error:"frances_daily_limit", message:"That’s today’s 3 free questions with Frances. She’ll be back after midnight UTC.",
          limit:3, used:3, resets_at:await utcResets(pdb) });
        assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.match(r.headers.get("content-type"), /application\/json/);
        assert.equal(W.fetches.length, 0, "no model call");
        assert.equal(usageRecords().length, 0, "nothing recorded");
        assert.deepEqual(limitRpcs()[0][2], { p_user:U.alice, p_limit:3 });
        assert.equal((await usage(pdb, U.alice))[0].questions, 3, "a refused question isn't counted");
        // Bob is unaffected
        assert.equal((await post("tok-bob", MUSE())).status, 200);
      }finally{ delete ENV.FRANCES_DAILY_LIMIT; }
      // an unusable secret means 50
      ENV.FRANCES_DAILY_LIMIT = "lots";
      try{ reset(); assert.equal((await post("tok-alice", MUSE())).status, 200); assert.equal(limitRpcs()[0][2].p_limit, 50); }
      finally{ delete ENV.FRANCES_DAILY_LIMIT; }
    });
    await test("C3 admins, writing calls, refused 'muse' labels and calls past the older allowance never touch the limit", async ()=>{
      reset();
      assert.equal((await post("tok-admin", MUSE())).status, 200);
      assert.equal((await post("tok-alice", { ...MUSE(), usageKind:"writing" })).status, 200);
      assert.equal((await post("tok-alice", { ...MUSE(), model:"claude-fable-5-1" })).status, 200);            // not Frances's model: metered
      assert.equal((await post("tok-alice", { ...MUSE(), messages:[{ role:"system", content:"You are a screenwriter." }, { role:"user", content:"Write Scene 4." }] })).status, 200);
      W.freeCallsToday = 200;                                                                                   // the older 24-hour allowance: metered
      assert.equal((await post("tok-alice", MUSE())).status, 200);
      assert.deepEqual(limitRpcs(), [], "no slot taken by any of them");
      assert.equal(W.fetches.length, 5, "all of them were answered");
    });
    await test("C4 fail open: the function missing, no service key, a hung call — the question is answered, and each kind is logged once", async ()=>{
      reset(); W.warns = [];
      W.consume = async ()=>({ data:null, error:{ code:"PGRST202", message:"Could not find the function public.turn_frances_consume(p_limit, p_user) in the schema cache" } });
      for(const tok of ["tok-carol", "tok-bob"]){ const r = await post(tok, MUSE()); assert.equal(r.status, 200); assert.equal(r.json.text, "Open Export in the top bar."); }
      assert.equal(W.warns.length, 1, W.warns.join("\n"));
      assert.match(W.warns[0], /Frances daily limit not enforced \(missing: .*Run supabase\/frances-daily-limit\.sql/);
      // the real SQL removed: PostgREST's own "no such function" also fails open (already logged)
      W.consume = null;
      await pdb.exec("drop function public.turn_frances_consume(uuid, integer)");
      assert.equal((await post("tok-carol", MUSE())).status, 200);
      assert.equal(W.warns.length, 1);
      assert.ok((await runFile(pdb)).ok, "put it back");
      // no service-role key → the client can't be made → served
      const key = ENV.SUPABASE_SERVICE_ROLE_KEY; delete ENV.SUPABASE_SERVICE_ROLE_KEY;
      try{ assert.equal((await post("tok-carol", MUSE())).status, 200); }finally{ ENV.SUPABASE_SERVICE_ROLE_KEY = key; }
      assert.equal(W.warns.length, 2); assert.match(W.warns[1], /\(error: supabaseKey is required\.\)/);
      // a call that never answers is cut off after 8 s and the question served (the 8 s timer is
      // shortened here so the test doesn't wait; the helper still asks for 8000 ms)
      W.consume = ()=>new Promise(noop);
      const realSetTimeout = globalThis.setTimeout, asked = [];
      globalThis.setTimeout = (f, ms, ...a)=>{ asked.push(ms); return realSetTimeout(f, ms === 8000 ? 25 : ms, ...a); };
      const t0 = Date.now();
      try{ assert.equal((await post("tok-carol", MUSE())).status, 200); }
      finally{ globalThis.setTimeout = realSetTimeout; }
      assert.ok(asked.includes(8000), "the limiter waited 8000 ms: "+j(asked));
      assert.ok(Date.now() - t0 < 6000);
      assert.equal(W.warns.length, 3); assert.match(W.warns[2], /\(timeout: no answer within 8000 ms\)/);
      assert.equal(W.fetches.length, 5, "every one of them was answered");
    });
    await test("C5 a burst's busy answer → 429 frances_busy, no model call, nothing counted or recorded, nothing logged", async ()=>{
      reset(); W.warns = [];
      // the real SQL, with the lock wait's SQLSTATE raised inside the upsert (PGlite has one connection)
      const before = (await usage(pdb, U.bob)).map(r=>r.questions);
      await pdb.exec(`create function public.frances_test_lock() returns trigger language plpgsql as $$
                        begin raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout'; end $$;
                      create trigger frances_test_lock before insert on public.turn_frances_usage for each row execute function public.frances_test_lock();`);
      let r;
      try{ r = await post("tok-bob", MUSE()); }
      finally{ await pdb.exec("drop trigger frances_test_lock on public.turn_frances_usage; drop function public.frances_test_lock();"); }
      assert.equal(r.status, 429, j(r.json));
      assert.deepEqual(r.json, { error:"frances_busy", message:"One question at a time, please — ask me again in a moment.", limit:50, used:before[before.length - 1] });
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      assert.deepEqual((await usage(pdb, U.bob)).map(r=>r.questions), before, "nothing counted");
      // an escaping 55P03 from the Data API reads the same
      W.consume = async ()=>({ data:null, error:{ code:"55P03", message:"canceling statement due to lock timeout" } });
      const r2 = await post("tok-bob", MUSE());
      assert.equal(r2.status, 429); assert.equal(r2.json.error, "frances_busy");
      assert.equal(W.fetches.length, 0, "no model call");
      assert.equal(usageRecords().length, 0, "nothing recorded");
      assert.deepEqual(W.warns, [], "nothing logged");
      // and the next question, with the burst over, is answered
      W.consume = null;
      assert.equal((await post("tok-bob", MUSE())).status, 200);
    });
  }finally{
    console.warn = realWarn; globalThis.fetch = realFetch;
  }
}

/* ======================= D. the app: museComplete ======================= */
function aiSandbox(){
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, clearTimeout, setInterval, clearInterval, setTimeout:(f)=>setTimeout(f, 0),
    React:new Proxy({ createElement:(t, p, ...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t, k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k, v)=>store.set(k, String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop,
      removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  box.claude = { complete:async ()=>"" };   // installed before ai.jsx, so its proxy shim is skipped (MUSE has its own path)
  vm.createContext(box);
  return { box, store };
}
function loadAi(src){
  const { box, store } = aiSandbox();
  for(const f of ["app/formats.jsx", "app/frameworks.jsx", "app/contract.jsx", "app/scene-order.js", "app/story-data.jsx", "app/spine.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  vm.runInContext(src, box, { filename:"app/ai.jsx" });
  box.__store = store;
  return box;
}
const ai = loadAi(read("app/ai.jsx"));
const toasts = []; ai.appToast = (m, t)=>toasts.push([m, t]);
const res = (status, body)=>({ status, clone(){ return { json:async ()=>{ if(body instanceof Error) throw body; return body; } }; } });
let invokes = [];
const failWith = (status, body)=>()=>({ functions:{ invoke:async (fn, o)=>{ invokes.push(o.body); return { data:null, error:{ message:"Edge Function returned a non-2xx status code", context:res(status, body) } }; } } });
const inHours = (h, m = 0)=>new Date(Date.now() + (h*60 + m)*60000).toISOString();

await test("D1 Frances's reply names the limit and when she's back (hours / an hour / minutes / no countdown)", ()=>{
  const at = (mins)=>new Date(NOW + mins*60000).toISOString();
  const R = (info)=>ai.francesLimitReply(info, NOW);
  assert.equal(R({ limit:50, resets_at:at(5*60) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).");
  assert.equal(R({ limit:50, resets_at:at(4*60 + 50) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).");
  assert.equal(R({ limit:50, resets_at:at(100) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 2 hours).");
  assert.equal(R({ limit:50, resets_at:at(60) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about an hour).");
  assert.equal(R({ limit:50, resets_at:at(30) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 30 minutes).");
  assert.equal(R({ limit:50, resets_at:at(1) }), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in a minute or so).");
  for(const bad of [{}, { resets_at:"soon" }, { resets_at:at(-10) }, { resets_at:at(30*60) }])
    assert.equal(R({ limit:50, ...bad }), "That’s today’s 50 free questions — I’ll be back after midnight UTC.", j(bad));
  assert.equal(R({ limit:20, resets_at:at(3*60) }), "That’s today’s 20 free questions — I’ll be back after midnight UTC (in about 3 hours).");
  assert.equal(R({ limit:1 }), "That’s today’s 1 free question — I’ll be back after midnight UTC.");
  assert.equal(R({ limit:"many" }), "That’s today’s 50 free questions — I’ll be back after midnight UTC.");
  assert.equal(R(null), "That’s today’s 50 free questions — I’ll be back after midnight UTC.");
  assert.ok(!/MUSE|TURN|Claude|Anthropic|McKee|credit|plan/i.test(R({ limit:50, resets_at:at(60) })));
});
await test("D2 museComplete: the 429 becomes Frances's reply (code frances_daily_limit) — one call, no retry, no toast, nothing metered", async ()=>{
  invokes = []; toasts.length = 0;
  const spendBefore = j(ai.turnTextSpend());
  ai.sbClient = failWith(429, { error:"frances_daily_limit", limit:50, used:50, resets_at:inHours(5, 10) });
  let err = null;
  try{ await ai.museComplete([{ role:"user", content:"hi" }]); }catch(e){ err = e; }
  assert.ok(err, "it rejects");
  assert.equal(err.code, "frances_daily_limit");
  assert.equal(err.message, "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).");
  assert.deepEqual(j(err.francesLimit), j({ limit:50, resetsAt:err.francesLimit.resetsAt }));
  assert.equal(invokes.length, 1, "asked once, never retried");
  assert.equal(invokes[0].usageKind, "muse");
  assert.deepEqual(toasts, [], "no error toast");
  assert.equal(j(ai.turnTextSpend()), spendBefore, "nothing metered");
  // the chat and the other helpers: aiMuseChat passes the reply on, the swallowing helpers stay quiet
  invokes = [];
  await assert.rejects(ai.aiMuseChat([{ role:"user", text:"How do I export?" }], [], null, { title:"Salt" }), (e)=>e.code === "frances_daily_limit" && /^That’s today’s 50 free questions/.test(e.message));
  assert.equal(invokes.length, 1);
  assert.equal(await ai.aiMuseReply("How do I export?", [], null, { title:"Salt" }), null);
  assert.equal(await ai.aiMuseFollowups("q", "a", [], null, { title:"Salt" }), null);
  // a 2xx carrying the code (defensive) is read the same way
  ai.sbClient = ()=>({ functions:{ invoke:async ()=>({ data:{ error:"frances_daily_limit", limit:50 }, error:null }) } });
  await assert.rejects(ai.museComplete([{ role:"user", content:"hi" }]), (e)=>e.code === "frances_daily_limit" && e.message === "That’s today’s 50 free questions — I’ll be back after midnight UTC.");
});
await test("D2b the busy 429 becomes a calm line with code frances_busy — one call, no retry, no toast, nothing metered", async ()=>{
  invokes = []; toasts.length = 0;
  const spendBefore = j(ai.turnTextSpend());
  ai.sbClient = failWith(429, { error:"frances_busy", message:"One question at a time, please — ask me again in a moment.", limit:50 });
  await assert.rejects(ai.museComplete([{ role:"user", content:"hi" }]), (e)=>e.code === "frances_busy" && e.message === "One question at a time, please — ask me again in a moment.");
  assert.equal(invokes.length, 1, "asked once, never retried");
  await assert.rejects(ai.aiMuseChat([{ role:"user", text:"How do I export?" }], [], null, { title:"Salt" }), (e)=>e.code === "frances_busy");
  assert.equal(invokes.length, 2);
  assert.deepEqual(toasts, []); assert.equal(j(ai.turnTextSpend()), spendBefore);
  ai.sbClient = ()=>({ functions:{ invoke:async ()=>({ data:{ error:"frances_busy" }, error:null }) } });
  await assert.rejects(ai.museComplete([{ role:"user", content:"hi" }]), (e)=>e.code === "frances_busy");
  // the app's line is the server's line
  assert.match(read("app/ai.jsx"), new RegExp('const FRANCES_BUSY_REPLY = "'+FRANCES_BUSY_MESSAGE+'";'));
});
await test("D3 any other 429 (a gateway throttle, an unreadable body) stays an ordinary error; the 402 message is unchanged", async ()=>{
  for(const body of [{ error:"rate_limited" }, new Error("not json"), null]){
    ai.sbClient = failWith(429, body);
    await assert.rejects(ai.museComplete([{ role:"user", content:"hi" }]), (e)=>e.code !== "frances_daily_limit" && /briefly unavailable.*\(ref CM-1\d\)$/.test(e.message), j(body));
  }
  ai.sbClient = failWith(402, { error:"insufficient_credits" });
  await assert.rejects(ai.museComplete([{ role:"user", content:"hi" }]),
    /^Error: You’ve used today’s free messages with Frances, and your plan has nothing left to continue on\. Chatting with Frances is free again within a day\.$/);
});

/* ======================= E. the dock: app/muse.jsx ======================= */
const h = (type, props, ...children)=>({ type, props:props || {}, children:children.flat(Infinity) });
function hooksRuntime(){
  const st = { slots:[], refs:[], deps:[], i:0, r:0, e:0, pending:[] };
  const R = new Proxy({
    createElement:h, Fragment:"frag",
    useState:(init)=>{ const k = st.i++; if(!(k in st.slots)) st.slots[k] = typeof init === "function" ? init() : init;
      return [st.slots[k], (v)=>{ st.slots[k] = typeof v === "function" ? v(st.slots[k]) : v; }]; },
    useRef:(x)=>{ const k = st.r++; if(!(k in st.refs)) st.refs[k] = { current:x }; return st.refs[k]; },
    useEffect:(fn, deps)=>{ const k = st.e++; const prev = st.deps[k];
      if(!prev || !deps || deps.some((d, n)=>d !== prev[n])) st.pending.push(fn); st.deps[k] = deps; },
    useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f,
  }, { get:(t, k)=> (k in t) ? t[k] : noop });
  const render = (Comp, props)=>{ st.i = 0; st.r = 0; st.e = 0; st.pending = []; const tree = Comp(props); st.pending.forEach((f)=>f()); return tree; };
  return { R, render };
}
const findAll = (n, pred, out = [])=>{ if(!n || typeof n !== "object") return out; if(Array.isArray(n)){ n.forEach((x)=>findAll(x, pred, out)); return out; }
  if(pred(n)) out.push(n); (n.children || []).forEach((c)=>findAll(c, pred, out)); return out; };
const textOf = (n)=>typeof n === "string" || typeof n === "number" ? String(n) : !n || typeof n !== "object" ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children || []).map(textOf).join("");
const cls = (re)=>(n)=>n.props && re.test(n.props.className || "");

await test("E1 the dock shows the limit as Frances's calm reply, keeps the input usable, and the next question goes out once without it", async ()=>{
  const H = hooksRuntime();
  const museBox = { console:{ ...console, warn:noop, info:noop, log:noop }, setTimeout, clearTimeout, Icon:new Proxy({}, { get:()=>()=>null }),
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop }, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, CustomEvent:class {} };
  museBox.window = museBox; museBox.globalThis = museBox; museBox.React = H.R;
  vm.createContext(museBox);
  vm.runInContext(read("app/muse.jsx"), museBox, { filename:"app/muse.jsx" });
  museBox.aiMuseChat = ai.aiMuseChat;           // the real chat → the real museComplete → a fake proxy
  const sent = [];
  let mode = "answer";
  ai.sbClient = ()=>({ functions:{ invoke:async (fn, o)=>{
    sent.push(o.body.messages);
    if(mode === "limit") return { data:null, error:{ message:"Edge Function returned a non-2xx status code",
      context:res(429, { error:"frances_daily_limit", limit:50, used:50, resets_at:inHours(5, 10) }) } };
    return { data:{ text:"Open Export in the top bar." }, error:null };
  } } });
  toasts.length = 0;
  const props = { scenes:[], selScene:null, project:{ title:"Salt" }, aiOn:true, signedIn:true, onSignIn:noop };
  let tree = H.render(museBox.MuseDock, props);
  findAll(tree, cls(/muse-bubble/))[0].props.onClick();                 // open the dock
  const ask = async (q)=>{
    tree = H.render(museBox.MuseDock, props);
    findAll(tree, (n)=>n.type === "input")[0].props.onChange({ target:{ value:q } });
    tree = H.render(museBox.MuseDock, props);
    const pending = findAll(tree, cls(/muse-ask-send/))[0].props.onClick();
    await pending; await new Promise((r)=>setTimeout(r, 5));
    tree = H.render(museBox.MuseDock, props);
  };
  await ask("How do I export?");                                        // answered
  mode = "limit";
  await ask("And how do I print it?");                                  // the 51st question
  const answers = findAll(tree, cls(/\bmuse-a\b/));
  assert.equal(answers.length, 2);
  assert.equal(textOf(answers[1]), "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).");
  assert.equal(answers[1].props.className, "muse-a limit", "a normal Frances reply, not an error");
  assert.equal(findAll(tree, cls(/\berr\b/)).length, 0, "no error bubble");
  const input = findAll(tree, (n)=>n.type === "input")[0];
  assert.equal(input.props.disabled, false, "the input stays usable");
  assert.equal(input.props.value, "");
  assert.deepEqual(toasts, [], "no error toast");
  assert.equal(sent.length, 2, "one call per question — no retry");
  // tomorrow: the next question goes out once, carrying the answered turn but not the limited one
  mode = "answer";
  await ask("What should I fix first?");
  assert.equal(sent.length, 3);
  const msgs = sent[2].map((m)=>m.role+": "+m.content).join("\n");
  assert.ok(msgs.includes("Writer: How do I export?") && msgs.includes("assistant: Open Export in the top bar."), "the answered turn is remembered");
  assert.ok(!msgs.includes("And how do I print it?") && !msgs.includes("free questions"), "the limited turn is left out");
  assert.ok(sent[2][sent[2].length - 1].content.endsWith("Writer: What should I fix first?"));
  assert.equal(findAll(tree, cls(/\bmuse-a\b/)).length, 3);
});
await test("E2 a busy refusal shows Frances's calm line in the chat (no toast), the input stays usable, and the turn stays out of the history", async ()=>{
  const H = hooksRuntime();
  const museBox = { console:{ ...console, warn:noop, info:noop, log:noop }, setTimeout, clearTimeout, Icon:new Proxy({}, { get:()=>()=>null }),
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop }, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, CustomEvent:class {} };
  museBox.window = museBox; museBox.globalThis = museBox; museBox.React = H.R;
  vm.createContext(museBox);
  vm.runInContext(read("app/muse.jsx"), museBox, { filename:"app/muse.jsx" });
  museBox.aiMuseChat = ai.aiMuseChat;
  const sent = [];
  let mode = "busy";
  ai.sbClient = ()=>({ functions:{ invoke:async (fn, o)=>{
    sent.push(o.body.messages);
    if(mode === "busy") return { data:null, error:{ message:"Edge Function returned a non-2xx status code",
      context:res(429, { error:"frances_busy", message:FRANCES_BUSY_MESSAGE, limit:50 }) } };
    return { data:{ text:"Open Export in the top bar." }, error:null };
  } } });
  toasts.length = 0;
  const props = { scenes:[], selScene:null, project:{ title:"Salt" }, aiOn:true, signedIn:true, onSignIn:noop };
  let tree = H.render(museBox.MuseDock, props);
  findAll(tree, cls(/muse-bubble/))[0].props.onClick();
  const ask = async (q)=>{
    tree = H.render(museBox.MuseDock, props);
    findAll(tree, (n)=>n.type === "input")[0].props.onChange({ target:{ value:q } });
    tree = H.render(museBox.MuseDock, props);
    await findAll(tree, cls(/muse-ask-send/))[0].props.onClick(); await new Promise((r)=>setTimeout(r, 5));
    tree = H.render(museBox.MuseDock, props);
  };
  await ask("How do I print?");
  const a = findAll(tree, cls(/\bmuse-a\b/));
  assert.equal(a.length, 1); assert.equal(textOf(a[0]), "One question at a time, please — ask me again in a moment.");
  assert.deepEqual(toasts, [], "no error toast");
  assert.equal(findAll(tree, (n)=>n.type === "input")[0].props.disabled, false, "the input stays usable");
  assert.equal(sent.length, 1, "no retry");
  mode = "answer";
  await ask("How do I print?");
  assert.equal(sent.length, 2);
  assert.ok(!sent[1].map((m)=>m.content).join("\n").includes("One question at a time"), "the busy line isn't sent back as Frances's answer");
});

/* ======================= F. what Frances knows, the docs, the wiring ======================= */
const VENDOR = /anthropic|claude|openai|chatgpt|\bgpt|gemini|gemma|google|moonshot|kimi|\bopus\b|\bfable\b|sonnet|haiku|mythos|elevenlabs|\bfal\b|supabase|stripe|mckee/i;
const INFRA = /\bproxy\b|edge function|api keys?\b|_API_KEY|redeploy|server secret|\bsql\b|\brpc\b|turn_[a-z_]+|\.sql\b/i;
const BILLING = /\b(?:pricing|prices?|billing|checkout|subscriptions?|credits?|provider-cost|margin)\b|\$\d/i;
await test("F1 APP_FEATURES: Frances is free up to 50 questions a day — and that part (no billing, vendor or server words) reaches Frances", ()=>{
  const fr = ai.APP_FEATURES.find((f)=>f.name === "Frances (help assistant)");
  assert.ok(fr.what.includes("DAILY LIMIT: Frances is free to use, up to 50 questions a day per person; the count starts again at midnight UTC."));
  assert.ok(fr.what.includes("'That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).'"));
  assert.ok(fr.what.includes("'You’ve used today’s free messages with Frances…'"), "the older safeguard is still described for the team");
  const pub = ai.museFacts().find((f)=>f.name === "Frances (help assistant)").what;
  assert.ok(pub.includes("Frances is free to use, up to 50 questions a day per person; the count starts again at midnight UTC."));
  assert.ok(pub.includes("That’s today’s 50 free questions — I’ll be back after midnight UTC"));
  assert.ok(!pub.includes("200 Frances calls") && !/daily allowance/.test(pub) && !pub.includes("use no credits"), "the credit sentences stay in the team's manifest");
  assert.ok(pub.includes("If several questions reach Frances at the same moment (say, from several open tabs), she may answer one of them with 'One question at a time, please — ask me again in a moment.'; nothing is counted for it."),
    "Frances can explain the busy line");
  assert.ok(!VENDOR.test(pub) && !INFRA.test(pub) && !BILLING.test(pub));
  const p = ai.museSystemPrompt({ now:"How many questions can I ask Frances a day?" }, null);
  assert.ok(p.includes("up to 50 questions a day per person"), "the question brings the fact along");
});
await test("F2 Frances's rules are unchanged (the prompt before the facts is identical to 59e4bff)", ()=>{
  let head = null;
  try{ head = execSync("git show 59e4bff:app/ai.jsx", { cwd:ROOT, encoding:"utf8", maxBuffer:64*1024*1024, stdio:["ignore", "pipe", "ignore"] }); }catch(e){}
  if(!head){ console.log("     (git history unavailable: compared with the rule list only)"); }
  const rules = (b)=>{ const p = b.museSystemPrompt({ now:"hi" }, null); return p.slice(0, p.indexOf("\n\nABOUT THIS APP")); };
  const now = rules(ai);
  for(const n of ["1. SCOPE.", "2. ACCURACY.", "3. CONFIDENTIALITY.", "4. NO NAMES.", "5. STAY IN CHARACTER.", "6. NO OUTSIDE ADVICE.", "7. CONCISE & RIGHT-SIZED.", "8. CONVERSATION."]) assert.ok(now.includes(n));
  if(head) assert.equal(now, rules(loadAi(head)));
});
await test("F3 docs: the MUSE Protocol doc and supabase/README.md say how the limit works and how/when to run the SQL", ()=>{
  const doc = read("docs/MUSE Protocol.md").replace(/\s+/g, " ");
  for(const s of ["daily question limit", "50 free questions per UTC day", "`FRANCES_DAILY_LIMIT`", "`supabase/frances-daily-limit.sql`",
    "`supabase/functions/image-proxy/frances-limit.mjs`", "429 `frances_daily_limit`", "That’s today’s 50 free questions — I’ll be back after midnight UTC (in about 5 hours).",
    "fails open", "the prompt itself is unchanged", "429 `frances_busy`", "no answer within 8 seconds"]) assert.ok(doc.includes(s), "doc: "+s);
  const rd = read("supabase/README.md").replace(/\s+/g, " ");
  for(const s of ["## Frances's daily question limit (`frances-daily-limit.sql`)", "run on production by the owner", "**It fails open.**", "paste **`frances-daily-limit.sql`** → Run",
    "Rows 10–50 of the RESULT table must read `ok`", "`npx supabase secrets set FRANCES_DAILY_LIMIT=<whole number 1–100000>`", "*(Mac, after `git pull`",
    "`node scripts/test-frances-limit.mjs`", "`frances-daily-limit.sql` (see **Frances's daily question limit** below",
    "**Bursts are refused, not served.**", "`{ error: \"frances_busy\", message }`", "longer than 8 seconds",
    "**But Frances's own facts name the number too:** in the same change, update the Frances entry in `APP_FEATURES` (app/ai.jsx", "and `FRANCES_DAILY_LIMIT` in app/ai.jsx, then bump `app/ai.jsx?v=` in `TURN.html`"]) assert.ok(rd.includes(s), "README: "+s);
  assert.ok(!/3 seconds/.test(rd), "the old 3-second timeout is gone from the README");
  const head = SQL.slice(0, SQL.indexOf("begin;"));
  for(const s of ["HOW TO RUN", "HOW TO REMOVE IT", "FAILS OPEN", "FRANCES_DAILY_LIMIT", "rows 10-50", "Safe to re-run", "BUSY:", "within 8 s", "1 s lock_timeout"]) assert.ok(head.replace(/\n--\s+/g, " ").includes(s), "SQL header: "+s);
});
await test("F4 index.ts: the limit sits on the free path only, after the allowance and before any spend check or model call", ()=>{
  const ts = read("supabase/functions/image-proxy/index.ts");
  assert.ok(ts.includes('import { FRANCES_LIMIT_RPC, createFrancesLimiter, francesDailyLimit } from "./frances-limit.mjs";'));
  assert.ok(ts.includes("const francesLimit = createFrancesLimiter({ log: (m: string) => console.warn(m) });"));
  assert.ok(ts.indexOf("const francesLimit = createFrancesLimiter(") < ts.indexOf("Deno.serve("), "one limiter per instance (module scope)");
  const text = ts.slice(ts.indexOf('if (task === "text") {'), ts.indexOf("// ── task: VOICE"));
  const block = text.slice(text.indexOf('if (textKind === "muse") {'), text.indexOf('if (textKind !== "muse") {'));
  assert.ok(block.length > 0);
  assert.ok(text.indexOf("textBill = textBillingKind(textReq, { freeCallsToday });") < text.indexOf('if (textKind === "muse") {'), "after the allowance");
  assert.ok(text.indexOf('if (textKind === "muse") {') < text.indexOf("const block = ensureCanSpend(1);"), "before the spend check");
  assert.ok(text.indexOf('if (textKind === "muse") {') < text.indexOf("const finishText = async"), "before any model call");
  for(const s of ["isAdmin, userId: authUser.id, limit: francesDailyLimit(Deno.env.get(\"FRANCES_DAILY_LIMIT\")),",
    'createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).rpc(FRANCES_LIMIT_RPC, args)',
    "if (!francesCheck.serve) return json(francesCheck.body, francesCheck.status);"]) assert.ok(block.includes(s), s);
  // the text task here, and the New Story voice session (task "live", owner decision 2026-09-29:
  // scripts/test-frances-voice-limit.mjs covers it)
  assert.equal((ts.match(/francesLimit\(/g) || []).length, 2, "called in two places: the text task and the live task");
  // the helper is plain, Node-testable ES: no Deno or Supabase imports
  const helper = read("supabase/functions/image-proxy/frances-limit.mjs");
  assert.ok(!/^\s*import\s/m.test(helper) && !/\bDeno\b/.test(helper.replace(/\/\*[\s\S]*?\*\//g, "")));
});

await test("F5 every place that names the daily number agrees (so changing it can't leave Frances telling people the old one)", ()=>{
  const n = FRANCES_DAILY_LIMIT_DEFAULT;
  const aiSrc = read("app/ai.jsx");
  const m = aiSrc.match(/^const FRANCES_DAILY_LIMIT = (\d+);$/m);
  assert.ok(m, "app/ai.jsx has FRANCES_DAILY_LIMIT"); assert.equal(Number(m[1]), n, "app/ai.jsx FRANCES_DAILY_LIMIT");
  const fr = ai.APP_FEATURES.find((f)=>f.name === "Frances (help assistant)").what;
  const inFacts = [...fr.matchAll(/up to (\d+) questions a day|today’s (\d+) free questions/g)].map((x)=>Number(x[1] || x[2]));
  assert.ok(inFacts.length >= 2, "the facts name the number"); inFacts.forEach((x)=>assert.equal(x, n, "APP_FEATURES says "+x));
  assert.match(SQL, new RegExp("FRANCES_DAILY_LIMIT \\(default "+n+"\\)"));
  assert.match(read("supabase/README.md"), new RegExp("Unset, or anything else, means "+n+"\\."));
  assert.ok(read("docs/MUSE Protocol.md").replace(/\s+/g, " ").includes(n+" free questions per UTC day"));
  // the page's message and the client's reply use the same default
  assert.equal(francesLimitMessage(undefined), "That’s today’s "+n+" free questions with Frances. She’ll be back after midnight UTC.");
  assert.equal(ai.francesLimitReply({}), "That’s today’s "+n+" free questions — I’ll be back after midnight UTC.");
});

console.log("\n"+checks+" checks passed"+(failed ? ", "+failed+" FAILED" : "")+(skipped ? ", "+skipped+" skipped" : ""));
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* The credit and plan functions (turn_grant_credits, turn_set_plan, turn_add_pack,
   turn_apply_pack_once, turn_end_plan) are SECURITY DEFINER, so only the Stripe webhook
   (service_role) and the SQL Editor may call them (2026-09-29). Runs the REAL SQL on PGlite
   with the Supabase stub from test-series-production-sql.mjs:
   A. credits.sql as it was (HEAD before this fix, the production state) leaves them open —
      the bug; supabase/lock-credit-functions.sql then locks them and reports "was open".
   B. today's credits.sql locks them itself on a fresh database, and the lock file is a no-op.
   C. what the browser needs (turn_credit_balance, turn_spend_credit) stays callable. */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
const LOCK = read("supabase/lock-credit-functions.sql");
const NOW = read("supabase/credits.sql");
let OLD = null;
try { OLD = execSync("git show 5dab282:supabase/credits.sql", { cwd: new URL(ROOT).pathname, encoding: "utf8" }); } catch (_e) { /* no git */ }

const FNS = ["turn_grant_credits", "turn_set_plan", "turn_add_pack", "turn_apply_pack_once", "turn_end_plan"];
let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.error("FAIL " + name + (detail ? " — " + JSON.stringify(detail) : "")); } };
async function db(creditsSql) {
  const d = new PGlite({ extensions: { pgcrypto } });
  await d.exec(STUB);
  await d.exec(creditsSql);
  return d;
}
const privs = async (d) => (await d.query(`select p.proname,
    has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('authenticated', p.oid, 'execute') authed,
    has_function_privilege('service_role', p.oid, 'execute') svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any($1) order by 1`, [FNS])).rows;
const browser = async (d) => (await d.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') authed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('turn_credit_balance','turn_spend_credit') order by 1`)).rows;
const lastRows = (res) => { const r = Array.isArray(res) ? res : [res]; for (let i = r.length - 1; i >= 0; i--) if (r[i].rows && r[i].rows.length) return r[i].rows; return []; };

check("the Supabase stub was found", !!STUB);
if (OLD) {
  const d = await db(OLD);
  const before = await privs(d);
  check("A the old credits.sql defines all five functions", before.length === 5, before.map((r) => r.proname));
  check("A …and leaves them callable by anon and signed-in users (the bug)", before.every((r) => r.anon && r.authed), before);
  const out = lastRows(await d.exec(LOCK));
  const after = await privs(d);
  check("A the lock file closes them to anon and signed-in users, keeps the service role", after.every((r) => !r.anon && !r.authed && r.svc), after);
  check("A its result table says each was open and is locked now", out.length === 5 && out.every((r) => /^YES/.test(r.was_open) && r.locked_now === "ok"), out);
  check("C the browser's functions stay callable", (await browser(d)).every((r) => r.authed));
  const again = lastRows(await d.exec(LOCK));
  check("A running it again is a no-op that reports 'no' / ok", again.length === 5 && again.every((r) => r.was_open === "no" && r.locked_now === "ok"), again);
} else {
  console.log("SKIP part A (no git history)");
}
{
  const d = await db(NOW);
  const fresh = await privs(d);
  check("B today's credits.sql locks them on a fresh database", fresh.length === 5 && fresh.every((r) => !r.anon && !r.authed && r.svc), fresh);
  const out = lastRows(await d.exec(LOCK));
  check("B the lock file then reports 'no' / ok for each", out.length === 5 && out.every((r) => r.was_open === "no" && r.locked_now === "ok"), out);
  check("C the browser's functions stay callable on a fresh database", (await browser(d)).every((r) => r.authed));
}
console.log(failed ? `${passed} passed, ${failed} failed` : `${passed} checks passed`);
if (failed) process.exit(1);

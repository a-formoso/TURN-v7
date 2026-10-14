#!/usr/bin/env node
/* ============================================================================
   Billing v2 — the REAL supabase/billing-v2.sql, billing-switch.sql and credits.sql
   EXECUTED on an in-memory Postgres (PGlite) with the Supabase stub from
   scripts/test-series-production-sql.mjs (anon / authenticated / service_role,
   Supabase's default privileges, auth.users / uid() / role()).

   "Production" is the credits.sql of commit 1aaf9ad (+ the Blender Studio settle
   migration), seeded with the balances today's code writes; billing-v2.sql then runs
   on top of it, as the owner will run it.

     A  upgrade: RESULT all ok, nobody's total changes, the one-time carry-over (pack-
        like credits -> 12-month lots), a re-run changes nothing
     B  today's callers keep working: the app's balance / spend, image-proxy's usage
        event, the old webhook's set_plan / apply_pack_once / end_plan, Blender's
        settle and a hand edit of remaining (spread plan-first by the trigger)
     C  privileges: EXECUTE per the contract, helpers unreachable, tables not writable,
        pinned search_path, the service-role second lock, RESULT catches a leak
     D  holds: atomic, idempotent per ref, parallel holds can't overspend, settle keeps
        min(actual, held), release, refunds go back where they came from, frozen,
        stale holds, lock-before-read pinned in every function's source
     E  spend order (plan, then soonest-expiring pack) and expiry
     F  plans: once per event, renewal leaves packs, payment status, upgrades,
        subscription mismatch, cancellation of the stored subscription only
     G  refunds: unspent pack credits, plan grant by its key, old periods, once
     H  trial: only after the switch, only confirmed, once, one per mailbox, never
        for payers, replaced by a plan
     J  the switch: stops before v2, refuses (a FAIL row) before the day-0 deploys,
        x3 exactly once (plans, lots, holds, plan grants) or nothing commits,
        grandfathering during and after the 30 days ('pro' = Director), re-run is a
        no-op, RESULT after the commit, a refund after it removes the tripled grant,
        billing-switch-undo.sql is its exact inverse
     M  the housekeeping schedule (billing-housekeeping-cron.sql) on pg_cron / pg_net stubs:
        stale holds, expiry and the reconcile calls to image-proxy and blender-bridge
     N  the reconciliation contract: turn_open_provider_holds, turn_claim_housekeeping,
        the 30-day last-resort rule for provider-tied holds, the balance's held column
     K  fresh install: credits.sql alone = old credits.sql + billing-v2.sql (+ tax-compliance.sql,
        whose block credits.sql also carries; scripts/test-tax-compliance-db.mjs tests that file and
        turn_revoke_charge_once's refund_fraction), the shared block is byte-identical, v2 after it
        changes nothing
     L  README documents the files, the order and every contract function
     P  CLAUDE.md's billing rules (L and P read the numbers they pin from image-proxy's billing-pricing.mjs /
        video-snapshots.mjs and app/newstory.jsx, so the words can't drift from the code)
     S  the section filter below

   PGlite has ONE connection, so "parallel" calls are serialised there: the parallel
   test proves the second call sees the first one's hold; the parallel SAFETY on a
   real server comes from the row lock every function takes first (turn__lock:
   SELECT ... FOR UPDATE), which section D pins in the functions' source.

   OFFLINE ONLY: no network, no Supabase project, no credentials.
     node scripts/test-billing-db.mjs                      (everything, the default)

   SOME SECTIONS ONLY: TEST_SECTIONS takes the letters above, comma-separated (any case,
   spaces ignored; unset or empty = every section). Four parts that each fit in about a
   minute and together make the full run:
     TEST_SECTIONS=A,B,C,D     node scripts/test-billing-db.mjs
     TEST_SECTIONS=E,F,G,H     node scripts/test-billing-db.mjs
     TEST_SECTIONS=J           node scripts/test-billing-db.mjs
     TEST_SECTIONS=K,M,N,L,P,S node scripts/test-billing-db.mjs
   An unknown letter fails the run at once (a typo must not pass by testing nothing).
   Sections run in file order whatever order they are listed in. B works on the database
   A leaves behind; run without A it builds the same one (production + billing-v2.sql —
   A13 pins that A's second run of the file changes no data).
   ============================================================================ */
import { readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
const V2 = read("supabase/billing-v2.sql");
const SWITCH = read("supabase/billing-switch.sql");
const UNDO = read("supabase/billing-switch-undo.sql");
const CRON = read("supabase/billing-housekeeping-cron.sql");
const CREDITS = read("supabase/credits.sql");
const STUDIO = read("supabase/studio-credit-settlement-migration.sql");
const TAX = read("supabase/tax-compliance.sql");
const README = read("supabase/README.md");
const NOTES = read("CLAUDE.md");
let OLD = null;
try { OLD = execSync("git show 1aaf9ad:supabase/credits.sql", { cwd: new URL(ROOT).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (_e) { /* no git */ }

/* the section filter (TEST_SECTIONS, see the top) */
const SECTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "L", "P", "S"];
const SECTIONS = String(process.env.TEST_SECTIONS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const unknownSections = SECTIONS.filter((s) => !SECTION_LETTERS.includes(s));
if (unknownSections.length) {
  console.log(`FAIL TEST_SECTIONS: unknown section ${unknownSections.map((s) => `"${s}"`).join(", ")} (the letters are ${SECTION_LETTERS.join(",")})`);
  process.exit(1);
}
const RUN = (letter) => SECTIONS.length === 0 || SECTIONS.includes(letter);

let passes = 0, failures = 0, current = null;
const perSection = {};
const ok = (name, cond, detail) => {
  if (current) perSection[current] = (perSection[current] || 0) + 1;
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + safe(detail))); }
};
const safe = (v) => { try { return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)); } catch (_e) { return String(v); } };
const section = (t) => console.log("\n=== " + t + " ===");
/* a section that TEST_SECTIONS selects: prints its title and says true; otherwise prints nothing */
const part = (letter, title) => { if (!RUN(letter)) return false; current = letter; section(title); return true; };

/* ── harness ─────────────────────────────────────────────────────────────── */
const U = {
  W: { id: "10000000-0000-0000-0000-000000000001", email: "writer@example.com" },
  D: { id: "10000000-0000-0000-0000-000000000002", email: "director@example.com" },
  P: { id: "10000000-0000-0000-0000-000000000003", email: "producer@example.com" },
  C: { id: "10000000-0000-0000-0000-000000000004", email: "cancelled@example.com" },
  N: { id: "10000000-0000-0000-0000-000000000005", email: "New.Person@gmail.com" },
  N2: { id: "10000000-0000-0000-0000-000000000006", email: "newperson+promo@googlemail.com" },
  Z: { id: "10000000-0000-0000-0000-00000000000c", email: "proxy-proof@example.com" },
  X: { id: "10000000-0000-0000-0000-000000000007", email: "unconfirmed@example.com", unconfirmed: true },
  H: { id: "10000000-0000-0000-0000-000000000008", email: "holder@example.com" },
  H2: { id: "10000000-0000-0000-0000-000000000009", email: "other@example.com" },
  S: { id: "10000000-0000-0000-0000-00000000000a", email: "spender@example.com" },
  R: { id: "10000000-0000-0000-0000-00000000000b", email: "pro@example.com" },
};
async function newDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const u of Object.values(U)) {
    await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)",
      [u.id, u.email, u.unconfirmed ? null : new Date(Date.now() - 86400000)]);
  }
  return db;
}
const lastRows = (res) => { for (let i = res.length - 1; i >= 0; i--) if (res[i].rows && res[i].rows.length) return res[i].rows; return []; };
async function runFile(db, sql) {
  try { const res = await db.exec(sql); return { ok: true, rows: lastRows(res), last: res[res.length - 1]?.rows || [] }; }
  catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, error: e.message }; }
}
/* the switch needs the day-0 deploys: the marker the owner sets right before deploying image-proxy, and
   proof that the new image-proxy is live — a hold it took after the marker (a zero hold here) */
const markDeployed = async (db) => {
  await db.query("insert into public.turn_billing_state(key, value, at) values ('server_video_billing', '{}'::jsonb, now() - interval '1 hour') on conflict (key) do nothing");
  await db.query("select public.turn_hold_credits($1, 0, 'text:deploy-proof', 'text')", [U.Z.id]);
};
/* one PostgREST-like request: a transaction as one caller */
async function as(db, who, sql, params = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      if (who !== "editor") {
        let claims, role;
        if (who === "anon") { claims = { role: "anon" }; role = "anon"; }
        else if (who === "service") { claims = { role: "service_role" }; role = "service_role"; }
        else { claims = { sub: who.id, email: who.email, role: "authenticated" }; role = "authenticated"; }
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        await tx.exec(`set local role ${role}`);
      }
      return (await tx.query(sql, params)).rows;
    });
    return { ok: true, rows, row: rows[0] };
  } catch (e) { return { ok: false, error: e.message, code: e.code }; }
}
const svc = async (db, sql, params) => {
  const r = await as(db, "service", sql, params);
  if (!r.ok) throw new Error(sql + " -> " + r.error);
  return r.row ? Object.values(r.row)[0] : undefined;
};
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const n = (v) => (v == null ? v : Number(v));
async function acct(db, who) {
  const [c] = await q(db, `select c.remaining, c.plan_remaining, c.plan, c.plan_allowance, c.frozen, c.payment_status,
      c.legacy_tier, c.legacy_allowance, c.legacy_until, c.trial_granted_at, c.paid_since, c.stripe_sub_id,
      (select coalesce(sum(l.remaining), 0) from public.turn_credit_lots l where l.owner = c.owner and l.remaining > 0 and l.expires_at > now()) as lots
      from public.turn_credits c where c.owner = $1`, [who.id]);
  if (!c) return null;
  return { ...c, remaining: n(c.remaining), plan_remaining: n(c.plan_remaining), lots: n(c.lots) };
}
async function consistent(db) {
  const r = await q(db, `select count(*)::int as bad from public.turn_credits c
     where c.remaining is distinct from c.plan_remaining + coalesce((select sum(l.remaining) from public.turn_credit_lots l
       where l.owner = c.owner and l.remaining > 0 and l.expires_at > now()), 0)`);
  return r[0].bad === 0;
}
const balanceOf = (db, who) => as(db, who, "select * from public.turn_credit_balance()");
const allOk = (rows) => rows.length > 0 && rows.every((r) => r.status === "ok");
const bad = (rows) => rows.filter((r) => r.status !== "ok");
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

/* production today: credits.sql at 1aaf9ad + Studio settle, with today's data */
async function productionDb() {
  const db = await newDb();
  await db.exec(OLD);
  await db.exec(STUDIO);
  await db.exec(`
    insert into public.turn_credits(owner, remaining, plan, tier, stripe_customer_id, stripe_sub_id, renews_at) values
      ('${U.W.id}', 3000, 'writer',   'writer',   'cus_W', 'sub_W', now() + interval '20 days'),
      ('${U.D.id}', 1000, 'director', 'director', 'cus_D', 'sub_D', now() + interval '20 days'),
      ('${U.P.id}', 9000, 'studio',   'studio',   'cus_P', 'sub_P', now() + interval '20 days'),
      ('${U.C.id}',  500, 'none',     null,       'cus_C', null,    null),
      ('${U.H.id}',    0, 'none',     null,       null,    null,    null),
      ('${U.R.id}', 2000, 'pro',      'pro',      'cus_R', 'sub_R', now() + interval '20 days');
    insert into public.turn_stripe_events(id, type) values ('evt_old_pack', 'checkout.session.completed');`);
  return db;
}
/* after billing-v2 (upgrade path) */
async function upgradedDb() {
  const db = await productionDb();
  const r = await runFile(db, V2);
  if (!r.ok) throw new Error("billing-v2.sql failed: " + r.error);
  return db;
}
/* fresh install */
async function freshDb() {
  const db = await newDb();
  const r = await runFile(db, CREDITS);
  if (!r.ok) throw new Error("credits.sql failed: " + r.error);
  return db;
}
async function snapshotData(db) {
  const out = {};
  for (const t of ["turn_credits", "turn_credit_lots", "turn_plan_grants", "turn_credit_holds", "turn_billing_state", "turn_stripe_events", "turn_usage_events", "turn_spend_events"]) {
    out[t] = await q(db, `select to_jsonb(x) - 'processed_at' as j from public.${t} x order by to_jsonb(x)::text`);
  }
  return safe(out);
}

if (!STUB) { console.log("FAIL the Supabase stub was not found in test-series-production-sql.mjs"); process.exit(1); }

/* ================================ A. upgrade ================================ */
let prod = null;
const runA = part("A", "A. upgrade from production (credits.sql at 1aaf9ad)");
if (!OLD) {
  if (runA || RUN("B") || RUN("J")) console.log("SKIP A, B, J (no git history for 1aaf9ad)");
} else if (!runA) {
  // B without A: the database A leaves behind (production, then billing-v2.sql; A13 pins that A's re-run changes no data)
  if (RUN("B")) prod = await upgradedDb();
} else {
  prod = await productionDb();
  const before = await q(prod, "select owner, remaining from public.turn_credits order by owner");
  const r1 = await runFile(prod, V2);
  ok("A1 billing-v2.sql runs on the production schema", r1.ok, r1.error);
  ok("A2 every RESULT row reads ok", allOk(r1.rows || []), bad(r1.rows || []));
  ok("A3 the RESULT has its 13 rows", (r1.rows || []).length === 13, (r1.rows || []).map((r) => r.item));
  const after = await q(prod, "select owner, remaining from public.turn_credits order by owner");
  ok("A4 nobody's total balance changes", safe(before) === safe(after), { before, after });
  const w = await acct(prod, U.W), d = await acct(prod, U.D), p = await acct(prod, U.P), c = await acct(prod, U.C);
  ok("A5 Writer 3,000: 800 plan credits + 2,200 carried to a lot", w.plan_remaining === 800 && w.lots === 2200, w);
  ok("A6 Director below the allowance keeps everything as plan credits", d.plan_remaining === 1000 && d.lots === 0, d);
  ok("A7 Producer at the allowance: 9,000 plan credits", p.plan_remaining === 9000 && p.lots === 0, p);
  ok("A8 a cancelled account's 500 become a 12-month lot", c.plan_remaining === 0 && c.lots === 500, c);
  const carry = await q(prod, "select owner, source, amount, expires_at from public.turn_credit_lots order by owner");
  ok("A9 carried lots are source 'carry' and last 12 months", carry.length === 2 && carry.every((l) =>
    l.source === "carry" && Math.abs(new Date(l.expires_at) - (Date.now() + 365 * 86400000)) < 3 * 86400000), carry);
  ok("A10 today's allowance recorded for subscribers (800 / 2,400 / 9,000)",
    n(w.plan_allowance) === 800 && n(d.plan_allowance) === 2400 && n(p.plan_allowance) === 9000, [w.plan_allowance, d.plan_allowance, p.plan_allowance]);
  ok("A11 payers and holders of credits are not trial accounts", !!w.paid_since && !!c.paid_since && (await acct(prod, U.H)).paid_since == null);
  const snap = await snapshotData(prod);
  const r2 = await runFile(prod, V2);
  ok("A12 a re-run: every RESULT row ok", r2.ok && allOk(r2.rows), r2.error || bad(r2.rows));
  ok("A13 a re-run changes no data (the carry-over happens once)", snap === await snapshotData(prod));
  ok("A14 balances add up", await consistent(prod));
  const pr = await acct(prod, U.R);
  ok("A15 a legacy 'pro' (Director) subscriber below 2,400 keeps everything as plan credits, allowance 2,400",
    pr.plan_remaining === 2000 && pr.lots === 0 && n(pr.plan_allowance) === 2400 && !!pr.paid_since, pr);
}

/* ========================= B. today's callers still work ========================= */
const runB = part("B", "B. today's app, image-proxy, webhook and Blender keep working");
// (only ever prints on a broken filter: B run without A must still get A's database, not skip silently)
if (runB && OLD && !prod) ok("B0 B has the database A leaves behind (TEST_SECTIONS without A builds it)", false);
if (runB && prod) {
  const db = prod;
  const bal = await balanceOf(db, U.W);
  ok("B1 turn_credit_balance: remaining and plan are the first two columns", bal.ok && safe(Object.keys(bal.row)) ===
    safe(["remaining", "plan", "plan_remaining", "pack_remaining", "next_pack_expiry", "payment_status", "frozen", "trial", "plan_allowance", "held"]), bal);
  ok("B2 …with the right values", bal.row.remaining === 3000 && bal.row.plan === "writer" && bal.row.plan_remaining === 800 &&
    bal.row.pack_remaining === 2200 && bal.row.payment_status === "active" && bal.row.frozen === false && bal.row.trial === false && bal.row.plan_allowance === 800 &&
    bal.row.held === 0, bal.row);
  ok("B3 next_pack_expiry is the lot's expiry", bal.row.next_pack_expiry instanceof Date && bal.row.next_pack_expiry > new Date(future(360)));
  const anonBal = await balanceOf(db, "anon");
  ok("B4 the public anon key cannot read balances", !anonBal.ok && /permission denied/i.test(anonBal.error), anonBal);

  let s = await as(db, U.W, "select * from public.turn_spend_credit(900, 'evt-a')");
  ok("B5 turn_spend_credit(cost, event_id) spends plan credits first, then packs", s.ok && s.row.remaining === 2100 && s.row.plan === "writer" &&
    (await acct(db, U.W)).plan_remaining === 0 && (await acct(db, U.W)).lots === 2100, s);
  s = await as(db, U.W, "select * from public.turn_spend_credit(900, 'evt-a')");
  ok("B6 …a replayed event id is a no-op", s.ok && s.row.remaining === 2100, s);
  s = await as(db, U.C, "select * from public.turn_spend_credit(1000, 'evt-c')");
  ok("B7 …clamps at 0 (video is charged after the render)", s.ok && s.row.remaining === 0, s);
  s = await as(db, U.C, "select * from public.turn_spend_credit(cost => 3)");
  ok("B8 …the one-argument call still works", s.ok && s.row.remaining === 0, s);
  // integration (2026-09-30): once image-proxy charges video (marker 'server_video_billing', set by
  // the owner after the deploy), a stale tab's browser spend is a no-op, not a second charge
  const wBefore = (await acct(db, U.W)).remaining;
  await db.query("insert into public.turn_billing_state(key, value) values ('server_video_billing', '{}'::jsonb)");
  s = await as(db, U.W, "select * from public.turn_spend_credit(100, 'evt-stale-tab')");
  ok("B8b …after the server-video-billing marker a browser spend changes nothing", s.ok && s.row.remaining === wBefore &&
    (await acct(db, U.W)).remaining === wBefore, s);
  await db.query("delete from public.turn_billing_state where key = 'server_video_billing'");

  const use = (who, credits, status = "succeeded") => as(db, who, `select * from public.turn_record_usage_event(
      event_kind => 'generation', provider_name => 'anthropic', model_name => 'opus', task_name => 'text',
      credit_cost => $1, usage_status => $2, request_key => 'r1', input_token_count => 10, output_token_count => 5,
      provider_cost => 0.01, usage_metadata => '{}'::jsonb)`, [credits, status]);
  let u = await use(U.D, 300);
  ok("B9 turn_record_usage_event (today's image-proxy call) charges", u.ok && u.row.remaining === 700 && u.row.plan === "director", u);
  u = await use(U.D, 5000);
  ok("B10 …not enough credits raises INSUFFICIENT_CREDITS (the proxy's regex) and changes nothing",
    !u.ok && /INSUFFICIENT_CREDITS/.test(u.error) && (await acct(db, U.D)).remaining === 700, u);
  u = await use(U.D, 50, "failed");
  ok("B11 …a failed attempt is logged with 0 credits", u.ok && u.row.remaining === 700 &&
    (await q(db, "select credits from public.turn_usage_events where owner = $1 and status = 'failed'", [U.D.id]))[0]?.credits === 0);

  let v = await svc(db, "select public.turn_set_plan($1, 'writer', 800, 'sub_W', 'cus_W', now() + interval '30 days')", [U.W.id]);
  ok("B12 old webhook turn_set_plan: a renewal refills PLAN credits and leaves packs alone", v === 2900 &&
    (await acct(db, U.W)).plan_remaining === 800 && (await acct(db, U.W)).lots === 2100, v);
  v = await svc(db, "select public.turn_apply_pack_once('evt_pack_1', $1, 300, 'checkout.session.completed')", [U.D.id]);
  ok("B13 old webhook turn_apply_pack_once: the pack becomes a 12-month lot", v === 1000 && (await acct(db, U.D)).lots === 300, v);
  v = await svc(db, "select public.turn_apply_pack_once('evt_pack_1', $1, 300)", [U.D.id]);
  ok("B14 …once per event", v === 1000, v);
  v = await svc(db, "select public.turn_apply_pack_once('evt_old_pack', $1, 300)", [U.D.id]);
  ok("B15 …an event applied BEFORE billing-v2 is not applied again (shared event table)", v === 1000, v);
  await svc(db, "select public.turn_end_plan($1)", [U.D.id]);
  const d = await acct(db, U.D);
  ok("B16 old webhook turn_end_plan: plan none, credits kept (as before)", d.plan === "none" && d.remaining === 1000, d);

  const st = await as(db, "service", "select * from public.turn_studio_settle_credit($1, 1000, 'studio-abc123')", [U.W.id]);
  const w = await acct(db, U.W);
  ok("B17 Blender's settle (a direct decrement) is spread plan-first by the trigger", st.ok && st.row.remaining === 1900 &&
    w.plan_remaining === 0 && w.lots === 1900, { st, w });
  const probe = await as(db, "service", "select * from public.turn_studio_settle_credit(null, null, null)");
  ok("B18 …its readiness probe still answers ready", probe.ok && probe.row.ready === true, probe);
  await db.exec(`update public.turn_credits set remaining = remaining + 50 where owner = '${U.C.id}'`);
  let c = await acct(db, U.C);
  ok("B19 a hand edit raising remaining becomes plan credits", c.plan_remaining === 50 && c.remaining === 50, c);
  await db.exec(`update public.turn_credits set remaining = remaining - 80 where owner = '${U.W.id}'`);
  const w2 = await acct(db, U.W);
  ok("B20 a hand edit lowering remaining takes plan credits, then lots", w2.remaining === 1820 && w2.lots === 1820, w2);
  await db.exec(`update public.turn_credits set plan_remaining = 77 where owner = '${U.C.id}'`);
  c = await acct(db, U.C);
  ok("B21 a hand edit of plan_remaining wins and remaining follows", c.plan_remaining === 77 && c.remaining === 77, c);
  v = await as(db, "editor", "select public.turn_grant_credits('cancelled@example.com', 100) as v");
  c = await acct(db, U.C);
  ok("B22 turn_grant_credits (SQL editor): a 12-month 'grant' lot", v.ok && v.row.v === 177 && c.lots === 100 &&
    (await q(db, "select source from public.turn_credit_lots where owner = $1 and source = 'grant'", [U.C.id])).length === 1, v);
  v = await as(db, "editor", "select public.turn_grant_credits('cancelled@example.com', -120) as v");
  c = await acct(db, U.C);
  ok("B23 …a negative amount takes credits away, plan first", v.ok && v.row.v === 57 && c.plan_remaining === 0 && c.lots === 57, c);
  v = await as(db, "editor", "select public.turn_grant_credits('cancelled@example.com', -1000) as v");
  ok("B24 …never below 0", v.ok && v.row.v === 0, v);
  ok("B25 balances add up after every legacy path", await consistent(db));
}

/* ============================== C. privileges ============================== */
if (part("C", "C. privileges")) {
  const db = await freshDb();
  const CONTRACT_SERVICE = [
    "turn_hold_credits(uuid, integer, text, text)", "turn_settle_hold(text, integer)", "turn_release_hold(text)",
    "turn_set_plan_once(text, uuid, text, integer, text, text, timestamp with time zone)",
    "turn_adjust_plan_once(text, uuid, text, integer, text)", "turn_add_pack_once(text, uuid, integer, text, boolean)",
    "turn_revoke_charge_once(text, text, numeric)", "turn_set_payment_status(uuid, text)", "turn_set_frozen(uuid, boolean, text)",
    "turn_end_plan_for_sub(uuid, text)", "turn_hold_attach(text, text)", "turn_hold_lookup(text)",
    "turn_open_provider_holds(integer, integer, text)", "turn_claim_housekeeping(text, integer)",
  ];
  const sigs = await q(db, `select p.oid::regprocedure::text as sig,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') authed,
      has_function_privilege('service_role', p.oid, 'EXECUTE') svc, has_function_privilege('public', p.oid, 'EXECUTE') pub,
      p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as result
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname like 'turn%'`);
  // regprocedure prints "f(uuid,integer)"; the contract is written "f(uuid, integer)"
  const by = Object.fromEntries(sigs.map((s) => [s.sig.replace(/^public\./, "").replace(/,(?! )/g, ", "), s]));
  const missing = CONTRACT_SERVICE.filter((s) => !by[s]);
  ok("C1 every contract function exists with the exact argument list", missing.length === 0, missing);
  ok("C2 contract return shapes", by["turn_hold_credits(uuid, integer, text, text)"]?.result === "jsonb" &&
    by["turn_settle_hold(text, integer)"]?.result === "jsonb" && by["turn_release_hold(text)"]?.result === "jsonb" &&
    by["turn_set_plan_once(text, uuid, text, integer, text, text, timestamp with time zone)"]?.result === "integer" &&
    by["turn_adjust_plan_once(text, uuid, text, integer, text)"]?.result === "integer" &&
    by["turn_add_pack_once(text, uuid, integer, text, boolean)"]?.result === "integer" &&
    by["turn_revoke_charge_once(text, text, numeric)"]?.result === "integer" &&
    by["turn_hold_attach(text, text)"]?.result === "jsonb" && by["turn_hold_lookup(text)"]?.result === "jsonb" &&
    by["turn_open_provider_holds(integer, integer, text)"]?.result === "TABLE(ref text, owner uuid, provider_ref text, held integer, reason text, created_at timestamp with time zone)" &&
    by["turn_claim_housekeeping(text, integer)"]?.result === "boolean" &&
    by["turn_spend_credit(integer, text)"]?.result === "TABLE(remaining integer, plan text)" &&
    /^TABLE\(remaining integer, plan text, plan_remaining integer, pack_remaining integer, next_pack_expiry timestamp with time zone, payment_status text, frozen boolean, trial boolean, plan_allowance integer, held integer\)$/.test(by["turn_credit_balance()"]?.result || ""),
    Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.result])));
  const svcOnly = [...CONTRACT_SERVICE, "turn_set_plan(uuid, text, integer, text, text, timestamp with time zone)", "turn_add_pack(uuid, integer)",
    "turn_apply_pack_once(text, uuid, integer, text)", "turn_end_plan(uuid)", "turn_grant_credits(text, integer)",
    "turn_release_stale_holds(integer)", "turn_expire_lots()"];
  const leaks = svcOnly.filter((s) => !by[s] || by[s].anon || by[s].authed || by[s].pub || !by[s].svc);
  ok("C3 server functions: service role only (not public, anon or signed-in users)", leaks.length === 0, leaks.map((s) => by[s]));
  const browser = ["turn_credit_balance()", "turn_spend_credit(integer, text)",
    "turn_record_usage_event(text, text, text, text, integer, text, text, integer, integer, numeric, jsonb)"];
  ok("C4 browser functions: signed-in users, never anon", browser.every((s) => by[s] && by[s].authed && !by[s].anon && !by[s].pub), browser.map((s) => by[s]));
  const helpers = Object.keys(by).filter((s) => s.startsWith("turn__"));
  ok("C5 every turn__ helper is unreachable for every API role", helpers.length >= 20 && helpers.every((s) => !by[s].anon && !by[s].authed && !by[s].svc && !by[s].pub), helpers.filter((s) => by[s].anon || by[s].authed || by[s].svc));
  const mine = [...svcOnly, ...browser, "turn_credit_regime()", "turn__credits_sync_trg()"];
  const unpinned = mine.filter((s) => !by[s] || !by[s].prosecdef || !(by[s].proconfig || []).some((c) => /^search_path=/.test(c)));
  ok("C6 every owner-rights (SECURITY DEFINER) function pins search_path", unpinned.length === 0, unpinned);
  ok("C7 helpers run with the caller's rights and a pinned search_path", helpers.every((s) => !by[s].prosecdef && (by[s].proconfig || []).some((c) => /^search_path=/.test(c)) || s === "turn__credits_sync_trg()"));
  ok("C8 turn_credit_regime is public facts (anon may read)", by["turn_credit_regime()"]?.anon === true);
  let r = await as(db, U.W, "select public.turn_hold_credits($1, 1, 'x', 'y')", [U.W.id]);
  ok("C9 a signed-in user cannot hold credits", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, U.W, "select public.turn_set_plan_once('e', $1, 'studio', 999999)", [U.W.id]);
  ok("C10 a signed-in user cannot grant themselves a plan", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, "anon", "select public.turn_add_pack_once('e', $1, 999999, null)", [U.W.id]);
  ok("C11 the anon key cannot add a pack", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, U.W, "select public.turn_add_pack_once(event_id => 'e', uid => $1, amount => 300, legacy_unit => true)", [U.W.id]);
  ok("C11b …nor can a signed-in user, with or without legacy_unit", !r.ok && /permission denied/i.test(r.error), r);
  ok("C11c turn_add_pack_once has ONE signature (the 4-argument one was dropped: a 4-argument call is never ambiguous)",
    (await q(db, "select count(*)::int as n from pg_proc where proname = 'turn_add_pack_once'"))[0].n === 1 &&
    (await q(db, "select to_regprocedure('public.turn_add_pack_once(text, uuid, integer, text)') is null as x"))[0].x);
  r = await as(db, "service", "select * from public.turn__take($1, 1, true)", [U.W.id]);
  ok("C12 not even the service role reaches a helper", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, U.W, "select public.turn_hold_lookup('fal-req-1')");
  const r3 = await as(db, U.W, "select public.turn_hold_attach('x', 'fal-req-1')");
  ok("C12b a signed-in user can neither look up nor attach a provider job", !r.ok && /permission denied/i.test(r.error) &&
    !r3.ok && /permission denied/i.test(r3.error), [r, r3]);
  r = await as(db, U.W, "select * from public.turn_open_provider_holds()");
  const r4 = await as(db, "anon", "select public.turn_claim_housekeeping('image-proxy_reconcile', 240)");
  ok("C12c …nor list open provider jobs; the anon key can't claim a housekeeping run", !r.ok && /permission denied/i.test(r.error) &&
    !r4.ok && /permission denied/i.test(r4.error), [r, r4]);
  await db.exec("grant execute on function public.turn_set_plan_once(text, uuid, text, integer, text, text, timestamptz) to authenticated");
  r = await as(db, U.W, "select public.turn_set_plan_once('e2', $1, 'studio', 999999)", [U.W.id]);
  ok("C13 the second lock: a mistaken grant still refuses a signed-in caller", !r.ok && /service role only/.test(r.error), r);
  const leakRes = await runFile(db, V2.slice(V2.indexOf("-- ── RESULT")));
  ok("C14 the RESULT table flags the leak", leakRes.ok && leakRes.rows.find((x) => x.item === "Server functions: service role only")?.status.startsWith("FAIL"), leakRes.rows);
  const rerun = await runFile(db, V2);
  ok("C15 re-running billing-v2.sql closes it again", rerun.ok && allOk(rerun.rows), bad(rerun.rows || []));
  await svc(db, "select public.turn_add_pack_once('pk-1', $1, 10, 'ch_1')", [U.W.id]);
  r = await as(db, U.W, "update public.turn_credits set remaining = 999999 where owner = $1 returning remaining", [U.W.id]);
  ok("C16 a signed-in user cannot write their balance", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, U.W, "insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at) values ($1, 'pack', 9, 9, now() + interval '1 year')", [U.W.id]);
  ok("C17 …nor add a pack lot", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, U.W, "select count(*)::int as n from public.turn_credit_lots");
  const r2 = await as(db, U.D, "select count(*)::int as n from public.turn_credit_lots");
  ok("C18 users read their own lots only", r.ok && r.row.n === 1 && r2.ok && r2.row.n === 0, [r, r2]);
  for (const t of ["turn_credit_holds", "turn_plan_grants", "turn_billing_state", "turn_stripe_events", "turn_spend_events"]) {
    r = await as(db, U.W, `select count(*) from public.${t}`);
    ok(`C19 ${t} is invisible to signed-in users`, !r.ok && /permission denied/i.test(r.error), r);
  }
  // a render that came back longer than its length hold (image-proxy logs "[billing] length_mismatch") is recorded for
  // the owner in the EXISTING turn_grant_failures — a service-role insert, no new SQL; users can neither read nor write it
  r = await as(db, "service", `insert into public.turn_grant_failures(event_id, event_type, reason, uid, details)
      values ('video:len-1', 'video.length_mismatch', 'length_mismatch', $1, '{"held_credits": 120, "output_seconds": 9.4, "output_credits": 131}'::jsonb) returning reason`, [U.W.id]);
  const lmRead = await as(db, U.W, "select count(*) from public.turn_grant_failures");
  const lmWrite = await as(db, U.W, "insert into public.turn_grant_failures(reason) values ('length_mismatch')");
  ok("C20 the server can record a length_mismatch for the owner in turn_grant_failures (service role, no new SQL); signed-in users can neither read nor write it",
    r.ok && r.row?.reason === "length_mismatch" && !lmRead.ok && /permission denied/i.test(lmRead.error) &&
    !lmWrite.ok && /permission denied/i.test(lmWrite.error), [r, lmRead, lmWrite]);
}

/* ================================ D. holds ================================ */
if (part("D", "D. holds")) {
  const db = await freshDb();
  const hold = (who, amount, ref, reason = "video:test") => svc(db, "select public.turn_hold_credits($1, $2, $3, $4)", [who.id, amount, ref, reason]);
  const settle = (ref, actual) => svc(db, "select public.turn_settle_hold($1, $2)", [ref, actual]);
  const release = (ref) => svc(db, "select public.turn_release_hold($1)", [ref]);
  await svc(db, "select public.turn_set_plan_once('inv-h1', $1, 'writer', 100, 'sub_H', 'cus_H', now() + interval '30 days')", [U.H.id]);
  await svc(db, "select public.turn_add_pack_once('pk-h1', $1, 50, 'ch_h1')", [U.H.id]);
  let h = await hold(U.H, 120, "job-1");
  let a = await acct(db, U.H);
  ok("D1 a hold takes credits NOW, plan first then packs", h.ok === true && h.held === 120 && h.remaining === 30 && a.plan_remaining === 0 && a.lots === 30, { h, a });
  const hb = await balanceOf(db, U.H);
  ok("D1b the balance reports the open holds in its last column (held 120; remaining 30 is what is left)",
    hb.ok && hb.row.held === 120 && hb.row.remaining === 30 && Object.keys(hb.row).at(-1) === "held", hb.row);
  h = await hold(U.H, 120, "job-1");
  ok("D2 the same ref again returns the first hold (idempotent), no second take", h.ok === true && h.duplicate === true && h.held === 120 && h.remaining === 30, h);
  h = await hold(U.H, 40, "job-2");
  ok("D3 not enough credits: code 'insufficient', nothing taken", h.ok === false && h.code === "insufficient" && h.remaining === 30 && h.held === 0, h);
  const par = await Promise.all([hold(U.H, 20, "p-1"), hold(U.H, 20, "p-2")]);
  a = await acct(db, U.H);
  ok("D4 two parallel holds of 20 with 30 left: exactly one wins", par.filter((x) => x.ok).length === 1 &&
    par.filter((x) => x.code === "insufficient").length === 1 && a.remaining === 10, { par, a });
  const winner = par[0].ok ? "p-1" : "p-2";
  let s = await settle("job-1", 100);
  a = await acct(db, U.H);
  ok("D5 settle keeps min(actual, held) and gives the rest back to the pack it came from", s.ok && s.kept === 100 && s.released === 20 &&
    s.given_back === 20 && a.remaining === 30 && a.lots === 30 && a.plan_remaining === 0, { s, a });
  s = await settle("job-1", 100);
  ok("D6 a repeated settle is a no-op reporting the first outcome", s.ok && s.duplicate === true && s.kept === 100 && (await acct(db, U.H)).remaining === 30, s);
  let rl = await release("job-1");
  ok("D7 release after settle is a no-op", rl.ok && rl.duplicate === true && rl.status === "settled" && (await acct(db, U.H)).remaining === 30, rl);
  rl = await release(winner);
  ok("D8 release gives the whole hold back", rl.ok && rl.released === 20 && (await acct(db, U.H)).remaining === 50, rl);
  rl = await release(winner);
  ok("D9 a repeated release is a no-op", rl.ok && rl.duplicate === true && (await acct(db, U.H)).remaining === 50, rl);
  s = await settle(winner, 5);
  ok("D10 settle after release keeps nothing (code 'released')", s.ok === false && s.code === "released" && (await acct(db, U.H)).remaining === 50, s);
  s = await settle("nope", 5);
  ok("D11 an unknown ref: code 'not_found'", s.ok === false && s.code === "not_found", s);
  await hold(U.H, 10, "job-3");
  s = await settle("job-3", 25);
  ok("D12 settle never keeps more than was held", s.kept === 10 && (await acct(db, U.H)).remaining === 40, s);
  const ev = await q(db, "select credits, status, task, request_id from public.turn_usage_events where owner = $1 and kind = 'hold' order by created_at, request_id", [U.H.id]);
  ok("D13 each settle / release writes one ledger row (kind 'hold', task = reason)", ev.length === 3 &&
    ev.some((e) => e.request_id === "job-1" && e.credits === 100 && e.status === "succeeded" && e.task === "video:test") &&
    ev.some((e) => e.request_id === winner && e.credits === 0 && e.status === "released"), ev);
  await svc(db, "select public.turn_set_plan_once('inv-h2', $1, 'writer', 100, 'sub_H2', 'cus_H2', null)", [U.H2.id]);
  h = await hold(U.H2, 5, "job-3");
  ok("D14 a ref that belongs to another account: code 'ref_conflict'", h.ok === false && h.code === "ref_conflict" && (await acct(db, U.H2)).remaining === 100, h);

  await svc(db, "select public.turn_set_frozen($1, true, 'dispute du_1 on ch_h1')", [U.H.id]);
  h = await hold(U.H, 1, "job-f");
  ok("D15 frozen: a hold is refused with code 'frozen'", h.ok === false && h.code === "frozen", h);
  let sp = await as(db, U.H, "select * from public.turn_spend_credit(1, 'f-1')");
  ok("D16 frozen: turn_spend_credit refuses (CREDITS_FROZEN)", !sp.ok && /CREDITS_FROZEN/.test(sp.error), sp);
  sp = await as(db, U.H, "select * from public.turn_record_usage_event(credit_cost => 1)");
  ok("D17 frozen: turn_record_usage_event refuses (CREDITS_FROZEN)", !sp.ok && /CREDITS_FROZEN/.test(sp.error), sp);
  let b = await balanceOf(db, U.H);
  ok("D18 the balance says frozen (credits stay visible)", b.row.frozen === true && b.row.remaining === 40, b.row);
  await svc(db, "select public.turn_set_frozen($1, false, 'dispute du_1 won')", [U.H.id]);
  h = await hold(U.H, 1, "job-f2");
  ok("D19 unfrozen: holds work again", h.ok === true, h);
  ok("D20 the freeze reason is kept for support", (await q(db, "select frozen_reason from public.turn_credits where owner = $1", [U.H.id]))[0].frozen_reason === "dispute du_1 won");

  // plan part of a hold does not come back after a renewal reset the plan credits
  await svc(db, "select public.turn_set_plan_once('inv-h3', $1, 'writer', 100, 'sub_H', 'cus_H', null)", [U.H.id]);
  a = await acct(db, U.H);
  h = await hold(U.H, 110, "job-4");   // 100 plan + 10 pack
  await svc(db, "select public.turn_set_plan_once('inv-h4', $1, 'writer', 100, 'sub_H', 'cus_H', null)", [U.H.id]);
  rl = await release("job-4");
  const a2 = await acct(db, U.H);
  ok("D21 after a renewal, releasing an older hold gives back its pack part only", h.ok && rl.given_back === 10 && a2.plan_remaining === 100 && a2.lots === a.lots, { h, rl, a, a2 });
  // a hold on a refunded pack gives nothing back to it
  await svc(db, "select public.turn_add_pack_once('pk-h9', $1, 30, 'ch_h9')", [U.H2.id]);
  h = await hold(U.H2, 120, "job-5");   // 100 plan + 20 of the pack
  const removed = await svc(db, "select public.turn_revoke_charge_once('evt-rf-h9', 'ch_h9')");
  rl = await release("job-5");
  const lot = await q(db, "select remaining, revoked_amount from public.turn_credit_lots where event_id = 'pk-h9'");
  ok("D22 a refunded pack's held part is not given back to it", removed === 10 && rl.given_back === 100 && lot[0].remaining === 0 && lot[0].revoked_amount === 10, { removed, rl, lot });
  // stale holds
  await hold(U.H, 1, "job-old");
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '2 days' where ref = 'job-old'");
  const stale = await svc(db, "select public.turn_release_stale_holds(60)");
  ok("D23 turn_release_stale_holds releases holds left open too long", stale === 1 &&
    (await q(db, "select status from public.turn_credit_holds where ref = 'job-old'"))[0].status === "released", stale);

  // provider jobs (shared contract with image-proxy / blender-bridge): provider_ref, attach, lookup
  const attach = (ref, pref) => svc(db, "select public.turn_hold_attach($1, $2)", [ref, pref]);
  const lookup = (pref) => svc(db, "select public.turn_hold_lookup($1)", [pref]);
  await svc(db, "select public.turn_add_pack_once('pk-h-pr', $1, 100, 'ch_h_pr')", [U.H.id]);
  await hold(U.H, 30, "video:pr-1", "video");
  await hold(U.H, 20, "video:pr-2", "video");
  let at = await attach("video:pr-1", "fal-req-1");
  ok("D23a turn_hold_attach sets the provider job id once", at.ok === true && at.status === "held" &&
    (await q(db, "select provider_ref from public.turn_credit_holds where ref = 'video:pr-1'"))[0].provider_ref === "fal-req-1", at);
  at = await attach("video:pr-1", "fal-req-1");
  ok("D23b …the same value again is ok (idempotent)", at.ok === true && at.duplicate === true, at);
  at = await attach("video:pr-1", "fal-req-OTHER");
  ok("D23c …a different value is refused: code 'mismatch' (the first one stays)", at.ok === false && at.code === "mismatch" &&
    (await q(db, "select provider_ref from public.turn_credit_holds where ref = 'video:pr-1'"))[0].provider_ref === "fal-req-1", at);
  at = await attach("video:pr-2", "fal-req-1");
  ok("D23d …a job id already on ANOTHER hold is refused: code 'mismatch'", at.ok === false && at.code === "mismatch" &&
    (await q(db, "select provider_ref from public.turn_credit_holds where ref = 'video:pr-2'"))[0].provider_ref == null, at);
  at = await attach("video:nope", "fal-req-9");
  ok("D23e …an unknown ref: code 'unknown'", at.ok === false && at.code === "unknown", at);
  const e0 = await as(db, "service", "select public.turn_hold_attach('video:pr-2', '  ')");
  ok("D23f …an empty provider job id is refused", !e0.ok && /provider_ref/.test(e0.error), e0);
  let lk = await lookup("fal-req-1");
  ok("D23g turn_hold_lookup finds the hold by the provider job id", lk.found === true && lk.ref === "video:pr-1" && lk.owner === U.H.id &&
    lk.held === 30 && lk.status === "held" && lk.kept == null && lk.reason === "video" && !!lk.created_at, lk);
  lk = await lookup("fal-req-unknown");
  ok("D23h …and says found:false for an unknown job id", lk.found === false, lk);
  await attach("video:pr-2", "fal-req-2");
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '2 days' where ref in ('video:pr-1', 'video:pr-2')");
  await hold(U.H, 5, "text:recent");
  await hold(U.H, 5, "text:crashed");
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '45 minutes' where ref = 'text:crashed'");
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '20 minutes' where ref = 'text:recent'");
  const beforeStale = (await acct(db, U.H)).remaining;
  const n1 = await svc(db, "select public.turn_release_stale_holds()");
  const st = Object.fromEntries((await q(db, "select ref, status, kept from public.turn_credit_holds where ref in ('video:pr-1', 'video:pr-2', 'text:recent', 'text:crashed')")).map((x) => [x.ref, x]));
  ok("D23i the housekeeping default (30 minutes): a crashed text hold of 45 minutes is released, a 20-minute one is not",
    n1 === 1 && st["text:crashed"].status === "released" && st["text:recent"].status === "held" && (await acct(db, U.H)).remaining === beforeStale + 5, { n1, st });
  ok("D23j …a submitted provider job (provider_ref) is NEVER released by it, even after 2 days (its poll decides)",
    st["video:pr-1"].status === "held" && st["video:pr-2"].status === "held", st);
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '8 days' where ref = 'video:pr-2'");
  const beforeOld = (await acct(db, U.H)).remaining;
  const n8 = await svc(db, "select public.turn_release_stale_holds(30)");
  const pr8 = (await q(db, "select status, kept from public.turn_credit_holds where ref = 'video:pr-2'"))[0];
  ok("D23k …one open for 8 days is NOT settled by the cron: the server's reconciliation asks the provider first",
    n8 === 0 && pr8.status === "held" && pr8.kept == null && (await acct(db, U.H)).remaining === beforeOld, { n8, pr8 });
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '31 days' where ref = 'video:pr-2'");
  const n2 = await svc(db, "select public.turn_release_stale_holds(30)");
  const pr2 = (await q(db, "select status, kept, released from public.turn_credit_holds where ref = 'video:pr-2'"))[0];
  ok("D23k2 …only as a last resort, one still open after 30 days is SETTLED at the held amount (nothing comes back)",
    n2 === 1 && pr2.status === "settled" && pr2.kept === 20 && pr2.released === 0 && (await acct(db, U.H)).remaining === beforeOld &&
    (await q(db, "select status from public.turn_credit_holds where ref = 'video:pr-1'"))[0].status === "held", { n2, pr2 });
  lk = await lookup("fal-req-2");
  ok("D23l …and the lookup then reports it settled with what was kept", lk.found && lk.status === "settled" && lk.kept === 20, lk);
  await svc(db, "select public.turn_release_hold('video:pr-1')");
  await svc(db, "select public.turn_release_hold('text:recent')");
  let e = await as(db, "service", "select public.turn_hold_credits($1, -5, 'neg', null)", [U.H.id]);
  ok("D24 a negative amount is refused", !e.ok && /amount/.test(e.error), e);
  e = await as(db, "service", "select public.turn_hold_credits($1, 5, '  ', null)", [U.H.id]);
  ok("D25 an empty ref is refused", !e.ok && /ref/.test(e.error), e);
  h = await hold(U.H, 0, "job-zero");
  ok("D26 a zero hold is allowed and takes nothing", h.ok === true && h.held === 0, h);
  ok("D27 balances add up after every hold path", await consistent(db));

  // lock-before-read, pinned in the source of every function that changes a balance
  const src = Object.fromEntries((await q(db, `select p.proname, p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname like 'turn%'`)).map((r) => [r.proname, r.prosrc.replace(/--[^\n]*/g, "")]));
  ok("D28 turn__lock takes the account row with SELECT ... FOR UPDATE", /select \* into v_row from public\.turn_credits c where c\.owner = p_uid for update/.test(src.turn__lock));
  const firstLock = (name) => {
    const s = src[name] || "";
    const lock = Math.min(...["turn__lock(", "turn__prepare(", "turn__finish_hold(", "turn__apply_plan("].map((k) => { const i = s.indexOf(k); return i < 0 ? Infinity : i; }));
    const read = Math.min(...["turn__take(", "turn__active_lots(", "from public.turn_credit_holds", "public.turn_credit_lots(", "turn__give_back("].map((k) => { const i = s.indexOf(k); return i < 0 ? Infinity : i; }));
    return lock < Infinity && lock < read;
  };
  const fns = ["turn_hold_credits", "turn_settle_hold", "turn_release_hold", "turn_spend_credit", "turn_record_usage_event", "turn_add_pack_once",
    "turn_adjust_plan_once", "turn_set_plan", "turn_set_plan_once", "turn_add_pack", "turn_apply_pack_once", "turn_grant_credits",
    "turn_end_plan_for_sub", "turn_set_frozen", "turn_set_payment_status", "turn_credit_balance", "turn__apply_plan"];
  // (turn__finish_hold reads the hold's owner first, THEN locks and re-reads it: D30)
  const unlocked = fns.filter((f) => !firstLock(f));
  ok("D29 every balance-changing function locks the account before it reads a balance", unlocked.length === 0, unlocked);
  ok("D30 turn__finish_hold locks the account, THEN re-reads the hold FOR UPDATE", /turn__lock\(v_owner\);\s+select \* into v_hold from public\.turn_credit_holds h where h\.ref = p_ref for update/.test(src.turn__finish_hold));
  {
    // the old-unit x3 is decided AFTER the account lock (a grant that waited on the switch's table locks sees it
    // committed) and before the lot is written; never before the once-per-event claim
    const pk = src.turn_add_pack_once || "";
    const at = (k) => { const i = pk.indexOf(k); return i < 0 ? Infinity : i; };
    ok("D31 turn_add_pack_once: claim the event, THEN lock the account, THEN read the switch, THEN write the lot",
      at("turn__claim_event(") < at("turn__lock(v_uid)") && at("turn__lock(v_uid)") < at("turn__switched()") &&
      at("turn__switched()") < at("insert into public.turn_credit_lots") &&
      /if v_legacy and public\.turn__switched\(\) then\s+v_amount := v_amount \* 3;/.test(pk), null);
  }
}

/* ============================ E. spend order & expiry ============================ */
if (part("E", "E. spend order and expiry")) {
  const db = await freshDb();
  await svc(db, "select public.turn_set_plan_once('inv-s1', $1, 'writer', 10, 'sub_S', 'cus_S', null)", [U.S.id]);
  await svc(db, "select public.turn_add_pack_once('pk-a', $1, 5, 'ch_a')", [U.S.id]);
  await svc(db, "select public.turn_add_pack_once('pk-b', $1, 5, 'ch_b')", [U.S.id]);
  await svc(db, "select public.turn_add_pack_once('pk-c', $1, 5, 'ch_c')", [U.S.id]);
  await db.exec(`update public.turn_credit_lots set expires_at = now() + interval '30 days' where event_id = 'pk-a';
                 update public.turn_credit_lots set expires_at = now() + interval '10 days' where event_id = 'pk-b';
                 update public.turn_credit_lots set expires_at = now() - interval '1 day' where event_id = 'pk-c';`);
  let stored = (await q(db, "select remaining from public.turn_credits where owner = $1", [U.S.id]))[0].remaining;
  ok("E1 (the stored total still counts the expired lot until something reads it)", stored === 25, stored);
  const b = await balanceOf(db, U.S);
  ok("E2 the balance leaves out an expired pack", b.row.remaining === 20 && b.row.pack_remaining === 10 && b.row.plan_remaining === 10, b.row);
  const bexp = (await q(db, "select expires_at from public.turn_credit_lots where event_id = 'pk-b'"))[0].expires_at;
  ok("E3 next_pack_expiry is the soonest unexpired pack", +b.row.next_pack_expiry === +bexp, [b.row.next_pack_expiry, bexp]);
  const c = (await q(db, "select remaining, expired_amount from public.turn_credit_lots where event_id = 'pk-c'"))[0];
  ok("E4 reading zeroes the expired lot (moved to expired_amount) and fixes the stored total", c.remaining === 0 && c.expired_amount === 5 &&
    (await q(db, "select remaining from public.turn_credits where owner = $1", [U.S.id]))[0].remaining === 20, c);
  await as(db, U.S, "select * from public.turn_spend_credit(13, 'e-1')");
  let lots = Object.fromEntries((await q(db, "select event_id, remaining from public.turn_credit_lots where owner = $1", [U.S.id])).map((l) => [l.event_id, l.remaining]));
  ok("E5 spending 13: plan's 10 first, then 3 from the pack expiring soonest", (await acct(db, U.S)).plan_remaining === 0 && lots["pk-b"] === 2 && lots["pk-a"] === 5, lots);
  await as(db, U.S, "select * from public.turn_record_usage_event(credit_cost => 4)");
  lots = Object.fromEntries((await q(db, "select event_id, remaining from public.turn_credit_lots where owner = $1", [U.S.id])).map((l) => [l.event_id, l.remaining]));
  ok("E6 …then the next pack", lots["pk-b"] === 0 && lots["pk-a"] === 3, lots);
  await db.exec("update public.turn_credit_lots set expires_at = now() - interval '1 minute' where event_id = 'pk-a'");
  const swept = await svc(db, "select public.turn_expire_lots()");
  ok("E7 turn_expire_lots zeroes expired lots for every account and resyncs", swept === 1 && (await acct(db, U.S)).remaining === 0, swept);
  const sp = await as(db, U.S, "select * from public.turn_record_usage_event(credit_cost => 1)");
  ok("E8 an expired pack can't be spent", !sp.ok && /INSUFFICIENT_CREDITS/.test(sp.error), sp);
  ok("E9 balances add up", await consistent(db));
}

/* ================================ F. plans ================================ */
if (part("F", "F. plans: once per event, renewals, upgrades, cancellation")) {
  const db = await freshDb();
  const who = U.W;
  let v = await svc(db, "select public.turn_set_plan_once('invoice:in_1', $1, 'writer', 600, 'sub_1', 'cus_1', $2)", [who.id, future(30)]);
  ok("F1 turn_set_plan_once starts a plan", v === 600, v);
  const a0 = await acct(db, who);
  ok("F2 …sets tier, subscription, allowance, payer", a0.plan === "writer" && a0.stripe_sub_id === "sub_1" && n(a0.plan_allowance) === 600 && !!a0.paid_since, a0);
  v = await svc(db, "select public.turn_add_pack_once('checkout:cs_1', $1, 250, 'ch_1')", [who.id]);
  ok("F3 turn_add_pack_once adds a 12-month lot", v === 850, v);
  v = await svc(db, "select public.turn_add_pack_once('checkout:cs_1', $1, 250, 'ch_1')", [who.id]);
  ok("F4 …once per event", v === 850, v);
  let e = await as(db, "service", "select public.turn_add_pack_once('checkout:cs_2', $1, 0, null)", [who.id]);
  ok("F5 …refuses an amount below 1 (and doesn't burn the event id)", !e.ok &&
    (await q(db, "select count(*)::int as n from public.turn_stripe_events where id = 'checkout:cs_2'"))[0].n === 0, e);
  await as(db, who, "select * from public.turn_spend_credit(700, 's1')");
  v = await svc(db, "select public.turn_set_plan_once('invoice:in_2', $1, 'writer', 600, 'sub_1', 'cus_1', $2)", [who.id, future(60)]);
  const a1 = await acct(db, who);
  ok("F6 a renewal resets PLAN credits only; the pack keeps its 150", v === 750 && a1.plan_remaining === 600 && a1.lots === 150, a1);
  await as(db, who, "select * from public.turn_spend_credit(50, 's2')");
  v = await svc(db, "select public.turn_set_plan_once('invoice:in_2', $1, 'writer', 600, 'sub_1', 'cus_1', $2)", [who.id, future(60)]);
  ok("F7 a re-sent renewal refills nothing", v === 700 && (await acct(db, who)).plan_remaining === 550, v);
  await svc(db, "select public.turn_set_payment_status($1, 'past_due')", [who.id]);
  let b = await balanceOf(db, who);
  ok("F8 a failed payment: payment_status past_due, credits still usable", b.row.payment_status === "past_due" && b.row.remaining === 700, b.row);
  const sp = await as(db, who, "select * from public.turn_spend_credit(1, 's3')");
  ok("F9 …spending still works while past_due", sp.ok && sp.row.remaining === 699, sp);
  await svc(db, "select public.turn_set_plan_once('invoice:in_3', $1, 'writer', 600, 'sub_1', 'cus_1', null)", [who.id]);
  b = await balanceOf(db, who);
  ok("F10 the next paid invoice sets it back to active", b.row.payment_status === "active", b.row);
  e = await as(db, "service", "select public.turn_set_payment_status($1, 'cancelled')", [who.id]);
  ok("F11 only 'active' or 'past_due' is accepted", !e.ok && /active or past_due/.test(e.error), e);
  const before = await acct(db, who);
  v = await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_1:writer>director:p1', $1, 'director', 1000, 'sub_1')", [who.id]);
  const a2 = await acct(db, who);
  ok("F12 an upgrade sets the tier and adds the allowance difference now", v === before.remaining + 1000 && a2.plan === "director" &&
    a2.plan_remaining === before.plan_remaining + 1000 && n(a2.plan_allowance) === 1600, { before, a2 });
  v = await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_1:writer>director:p1', $1, 'director', 1000, 'sub_1')", [who.id]);
  ok("F13 …once per key", v === a2.remaining, v);
  v = await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_x:director>studio:p1', $1, 'studio', 3400, 'sub_x')", [who.id]);
  const gf = await q(db, "select reason, stripe_sub_id from public.turn_grant_failures where uid = $1", [who.id]);
  ok("F14 an upgrade for ANOTHER subscription changes nothing and is recorded", v === a2.remaining && (await acct(db, who)).plan === "director" &&
    gf.length === 1 && gf[0].reason === "subscription_mismatch", gf);
  v = await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_1:director>writer:p1', $1, 'writer', -1000, 'sub_1')", [who.id]);
  ok("F15 a negative difference adds nothing", v === a2.remaining, v);
  await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_1:writer>director:p2', $1, 'director', 0, 'sub_1')", [who.id]);
  let ended = await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_other')", [who.id]);
  ok("F16 cancelling ANOTHER subscription on the customer ends nothing", ended === false && (await acct(db, who)).plan === "director", ended);
  const packs = (await acct(db, who)).lots;
  const planLeft = (await acct(db, who)).plan_remaining;
  ended = await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_1')", [who.id]);
  const a3 = await acct(db, who);
  ok("F17 BEFORE the switch, cancelling the stored subscription ends the plan and KEEPS its plan credits (the published Terms; notice first)",
    ended === true && a3.plan === "none" && planLeft > 0 && a3.plan_remaining === planLeft && a3.lots === packs &&
    a3.remaining === planLeft + packs && a3.stripe_sub_id == null, { planLeft, a3 });
  const pe = await q(db, "select metadata from public.turn_usage_events where owner = $1 and kind = 'plan_end'", [who.id]);
  ok("F18 …logged for support: plan credits kept, none ended", pe.length === 1 && pe[0].metadata.plan_credits_kept === planLeft &&
    pe[0].metadata.plan_credits_ended === 0, pe);
  const sp2 = await as(db, who, "select * from public.turn_spend_credit(10, 'after-cancel')");
  ok("F18b …and the kept plan credits stay spendable", sp2.ok && sp2.row.remaining === planLeft + packs - 10, sp2);
  ended = await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_1')", [who.id]);
  ok("F19 …a repeat returns false", ended === false);
  v = await svc(db, "select public.turn_set_plan_once('invoice:in_9', $1, 'studio', 5000, 'sub_9', 'cus_1', null)", [who.id]);
  ok("F20 a new subscription later starts cleanly", v === 5000 + packs, v);
  e = await as(db, "service", "select public.turn_set_plan_once('  ', $1, 'writer', 600)", [who.id]);
  ok("F21 a missing event id is refused", !e.ok && /event id/.test(e.error), e);
  e = await as(db, "service", "select public.turn_set_plan_once('ev-ghost', '10000000-0000-0000-0000-0000000000ff', 'writer', 600)");
  ok("F22 an unknown account is refused (and the event id is not burnt)", !e.ok && /no account/.test(e.error) &&
    (await q(db, "select count(*)::int as n from public.turn_stripe_events where id = 'ev-ghost'"))[0].n === 0, e);
  ok("F23 balances add up", await consistent(db));

  // F8: a paid checkout carrying ANOTHER account's id (client_reference_id) never takes it over
  const vic = U.H;
  await svc(db, "select public.turn_set_plan_once('invoice:vic', $1, 'studio', 5000, 'sub_V', 'cus_V', $2)", [vic.id, future(20)]);
  const custOf = async (who) => (await q(db, "select stripe_customer_id as c, stripe_sub_id as s from public.turn_credits where owner = $1", [who.id]))[0];
  v = await svc(db, "select public.turn_set_plan_once('invoice:atk', $1, 'writer', 600, 'sub_A', 'cus_A', $2)", [vic.id, future(30)]);
  let va = await acct(db, vic);
  let gfc = await q(db, "select event_id, event_type, reason, stripe_customer_id, stripe_sub_id, details from public.turn_grant_failures where uid = $1 and reason = 'subscription_conflict'", [vic.id]);
  ok("F24 a Writer checkout for a Producer's account (other customer, stored sub still active): nothing changes",
    v === 5000 && va.plan === "studio" && va.plan_remaining === 5000 && safe(await custOf(vic)) === safe({ c: "cus_V", s: "sub_V" }), { v, va });
  ok("F25 …it is recorded for the owner (turn_grant_failures 'subscription_conflict') and the event says skipped",
    gfc.length === 1 && gfc[0].event_id === "invoice:atk" && gfc[0].stripe_customer_id === "cus_A" && gfc[0].stripe_sub_id === "sub_A" &&
    gfc[0].details.stored_sub_id === "sub_V" && gfc[0].details.stored_customer_id === "cus_V" &&
    (await q(db, "select result from public.turn_stripe_events where id = 'invoice:atk'"))[0].result.skipped === "subscription_conflict", gfc);
  v = await svc(db, "select public.turn_set_plan($1, 'writer', 600, 'sub_A2', 'cus_A2', null)", [vic.id]);
  ok("F26 …today's webhook function (turn_set_plan) refuses it the same way", v === 5000 && (await acct(db, vic)).plan === "studio" &&
    (await q(db, "select count(*)::int as n from public.turn_grant_failures where uid = $1 and reason = 'subscription_conflict'", [vic.id]))[0].n === 2, v);
  v = await svc(db, "select public.turn_set_plan_once('invoice:same', $1, 'director', 1600, 'sub_V2', 'cus_V', null)", [vic.id]);
  ok("F27 a second subscription on the SAME customer applies as today", v === 1600 && (await acct(db, vic)).plan === "director" &&
    (await custOf(vic)).s === "sub_V2", await custOf(vic));
  await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_V2')", [vic.id]);
  v = await svc(db, "select public.turn_set_plan_once('invoice:resub', $1, 'writer', 600, 'sub_N', 'cus_N', null)", [vic.id]);
  ok("F28 a legit re-subscribe after the stored subscription ended (new customer) applies",
    v === 600 && (await acct(db, vic)).plan === "writer" && safe(await custOf(vic)) === safe({ c: "cus_N", s: "sub_N" }), await custOf(vic));
  // …and a call with NO subscription id may not move a paid account to another customer either
  const conflicts = async () => (await q(db, "select count(*)::int as n from public.turn_grant_failures where uid = $1 and reason = 'subscription_conflict'", [vic.id]))[0].n;
  const c0 = await conflicts();
  v = await svc(db, "select public.turn_set_plan_once('invoice:nullsub', $1, 'studio', 5000, null, 'cus_Z', $2)", [vic.id, future(30)]);
  va = await acct(db, vic);
  ok("F28b a paid account, an incoming call WITHOUT a subscription id on ANOTHER customer: refused, nothing overwritten, recorded",
    v === 600 && va.plan === "writer" && va.plan_remaining === 600 && safe(await custOf(vic)) === safe({ c: "cus_N", s: "sub_N" }) &&
    (await conflicts()) === c0 + 1 &&
    (await q(db, "select result from public.turn_stripe_events where id = 'invoice:nullsub'"))[0].result.skipped === "subscription_conflict", { v, va });
  v = await svc(db, "select public.turn_set_plan($1, 'studio', 5000, null, 'cus_Z2', null)", [vic.id]);
  ok("F28c …today's turn_set_plan refuses it the same way", v === 600 && (await acct(db, vic)).plan === "writer" &&
    (await custOf(vic)).c === "cus_N" && (await conflicts()) === c0 + 2, v);
  v = await svc(db, "select public.turn_set_plan_once('invoice:nullsub-same', $1, 'director', 1600, null, 'cus_N', null)", [vic.id]);
  ok("F28d …without a subscription id on the SAME customer it applies (the stored subscription is kept)",
    v === 1600 && (await acct(db, vic)).plan === "director" && safe(await custOf(vic)) === safe({ c: "cus_N", s: "sub_N" }) &&
    (await conflicts()) === c0 + 2, await custOf(vic));

  // F6: an upgrade adds the difference for the part of the paid period still to run
  const up = U.D;
  await svc(db, "select public.turn_set_plan_once('invoice:pr_1', $1, 'writer', 600, 'sub_pr', 'cus_pr', $2)", [up.id, future(1)]);
  await db.exec(`update public.turn_credits set plan_period_start = now() - interval '29 days' where owner = '${up.id}'`);
  const u0 = await acct(db, up);
  await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_pr:writer>director', $1, 'director', 1000, 'sub_pr')", [up.id]);
  const u1 = await acct(db, up);
  ok("F29 an upgrade one day before the renewal adds 1/30 of the difference, rounded up (34 of 1,000), not 1,000",
    u1.plan === "director" && u1.plan_remaining === u0.plan_remaining + 34, { u0, u1 });
  const upRes = (await q(db, "select result from public.turn_stripe_events where id = 'upgrade:sub_pr:writer>director'"))[0].result;
  ok("F30 …the event records the difference and the fraction", upRes.added === 34 && upRes.difference === 1000 &&
    Math.abs(upRes.period_fraction - 1 / 30) < 0.001, upRes);
  const nop = U.N;
  await svc(db, "select public.turn_set_plan_once('invoice:np_1', $1, 'writer', 600, 'sub_np', 'cus_np', null)", [nop.id]);
  await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_np:writer>director', $1, 'director', 1000, 'sub_np')", [nop.id]);
  const n1a = await acct(db, nop);
  const npRes = (await q(db, "select result from public.turn_stripe_events where id = 'upgrade:sub_np:writer>director'"))[0].result;
  ok("F31 no renewal date known: the tier changes now, no credits are added now (deferred to the renewal)",
    n1a.plan === "director" && n1a.plan_remaining === 600 && npRes.added === 0 && npRes.deferred === "next_renewal", { n1a, npRes });
  await svc(db, "select public.turn_set_plan_once('invoice:np_2', $1, 'director', 1600, 'sub_np', 'cus_np', null)", [nop.id]);
  ok("F32 …and the next renewal gives the new plan's allowance", (await acct(db, nop)).plan_remaining === 1600);
  const gfu = U.C;
  await svc(db, "select public.turn_set_plan_once('invoice:gf_1', $1, 'writer', 600, 'sub_gf', 'cus_gf', $2)", [gfu.id, future(1)]);
  await db.exec(`update public.turn_credits set plan_period_start = now() - interval '29 days', plan_remaining = 2400,
                   legacy_tier = 'writer', legacy_allowance = 2400, legacy_until = now() + interval '20 days' where owner = '${gfu.id}'`);
  await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_gf:writer>director', $1, 'director', 1000, 'sub_gf')", [gfu.id]);
  ok("F33 a grandfathered Writer (2,400) upgrading one day before renewal gets 1/30 of 4,800 (160), not 4,800",
    (await acct(db, gfu)).plan_remaining === 2400 + 160, await acct(db, gfu));
  ok("F34 balances add up", await consistent(db));
}

/* ================================ G. refunds ================================ */
if (part("G", "G. refunds and lost disputes")) {
  const db = await freshDb();
  await svc(db, "select public.turn_add_pack_once('checkout:cs_9', $1, 1000, 'ch_9')", [U.C.id]);
  await as(db, U.C, "select * from public.turn_spend_credit(300, 'g1')");
  let r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_1', 'ch_9')");
  const lot = (await q(db, "select remaining, revoked_amount, revoked_at from public.turn_credit_lots where event_id = 'checkout:cs_9'"))[0];
  ok("G1 a pack refund removes its UNSPENT credits (700 of 1,000)", r === 700 && lot.remaining === 0 && lot.revoked_amount === 700 && !!lot.revoked_at &&
    (await acct(db, U.C)).remaining === 0, { r, lot });
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_1', 'ch_9')");
  ok("G2 once per event", r === 0);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_1b', 'ch_9')");
  ok("G3 a second event for the same charge finds nothing left", r === 0);
  const res = (await q(db, "select result from public.turn_stripe_events where id = 'evt_refund_1'"))[0].result;
  ok("G4 the outcome is recorded on the event", res.removed === 700 && res.lots === 1, res);
  r = await svc(db, "select public.turn_add_pack_once('checkout:cs_10', $1, 250, 'ch_10')", [U.C.id]);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_2', 'checkout:cs_10')");
  ok("G5 a pack can also be matched by its grant key", r === 250, r);
  await svc(db, "select public.turn_set_plan_once('invoice:in_7', $1, 'writer', 600, 'sub_3', 'cus_3', null)", [U.P.id]);
  await as(db, U.P, "select * from public.turn_spend_credit(100, 'g2')");
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_3', 'invoice:in_7')");
  ok("G6 a plan payment's refund (matched by the grant key) removes what is left of that grant", r === 500 && (await acct(db, U.P)).plan_remaining === 0, r);
  await svc(db, "select public.turn_set_plan_once('invoice:in_8', $1, 'writer', 600, 'sub_3', 'cus_3', null)", [U.P.id]);
  await svc(db, "select public.turn_set_plan_once('invoice:in_8b', $1, 'writer', 600, 'sub_3', 'cus_3', null)", [U.P.id]);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_4', 'invoice:in_8')");
  ok("G7 a refund of an earlier period's plan payment removes nothing (those credits already ended)", r === 0 && (await acct(db, U.P)).plan_remaining === 600, r);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_5', 'ch_unknown')");
  ok("G8 an unknown charge removes nothing (the webhook then records it for the owner)", r === 0);
  const e = await as(db, "service", "select public.turn_revoke_charge_once('evt_x', null)");
  ok("G9 a missing charge id is refused", !e.ok, e);
  ok("G10 balances add up", await consistent(db));

  // a full plan refund while a running job holds most of that payment's credits
  await svc(db, "select public.turn_set_plan_once('invoice:in_A', $1, 'writer', 800, 'sub_A', 'cus_A', $2)", [U.W.id, future(30)]);
  const hA = await svc(db, "select public.turn_hold_credits($1, 700, 'video:job-A', 'video')", [U.W.id]);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_A', 'invoice:in_A')");
  const relA = await svc(db, "select public.turn_release_hold('video:job-A')");
  ok("G11 Writer granted 800, 700 held by a running job, full refund: the release gives nothing back (balance 0, not 700)",
    hA.ok && r === 800 && relA.given_back === 0 && (await acct(db, U.W)).remaining === 0, { hA, r, relA, a: await acct(db, U.W) });
  const resA = (await q(db, "select result from public.turn_stripe_events where id = 'evt_refund_A'"))[0].result;
  const gA = (await q(db, "select revoked_amount from public.turn_plan_grants where event_id = 'invoice:in_A'"))[0];
  ok("G12 …the grant is revoked in full (100 unspent + 700 held) and the event says so", gA.revoked_amount === 800 &&
    resA.removed === 800 && resA.from_open_holds === 700, { gA, resA });
  // the pack part of such a hold still goes back to its (unrefunded) pack
  await svc(db, "select public.turn_set_plan_once('invoice:in_B', $1, 'writer', 100, 'sub_B', 'cus_B', $2)", [U.D.id, future(30)]);
  await svc(db, "select public.turn_add_pack_once('checkout:cs_B', $1, 50, 'ch_B')", [U.D.id]);
  await svc(db, "select public.turn_hold_credits($1, 150, 'video:job-B', 'video')", [U.D.id]);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_B', 'invoice:in_B')");
  const relB = await svc(db, "select public.turn_release_hold('video:job-B')");
  const dB = await acct(db, U.D);
  ok("G13 …a hold of 100 plan + 50 pack: the refund takes the 100, the release returns the 50 to the pack",
    r === 100 && relB.given_back === 50 && dB.plan_remaining === 0 && dB.lots === 50, { r, relB, dB });
  // settle after the refund: the job ran, the charge stands, no plan credits come back
  await svc(db, "select public.turn_set_plan_once('invoice:in_S', $1, 'writer', 600, 'sub_S', 'cus_S', $2)", [U.S.id, future(30)]);
  await svc(db, "select public.turn_hold_credits($1, 500, 'video:job-S', 'video')", [U.S.id]);
  r = await svc(db, "select public.turn_revoke_charge_once('evt_refund_S', 'invoice:in_S')");
  const stS = await svc(db, "select public.turn_settle_hold('video:job-S', 200)");
  ok("G14 …a settle after the refund keeps the real cost and returns no plan credits", r === 600 && stS.kept === 200 &&
    stS.given_back === 0 && (await acct(db, U.S)).remaining === 0, { r, stS });
  ok("G15 balances add up", await consistent(db));
}

/* ================================ H. trial ================================ */
if (part("H", "H. the free trial")) {
  const db = await freshDb();
  await svc(db, "select public.turn_set_plan_once('inv-p', $1, 'studio', 5000, 'sub_P', 'cus_P', null)", [U.P.id]);
  await svc(db, "select public.turn_add_pack_once('pk-c', $1, 10, 'ch_c')", [U.C.id]);
  let b = await balanceOf(db, U.N);
  ok("H1 before the switch: no trial (0 credits, trial false)", b.row.remaining === 0 && b.row.trial === false, b.row);
  let reg = await as(db, "anon", "select * from public.turn_credit_regime()");
  ok("H2 turn_credit_regime before the switch: $0.03, no trial", reg.ok && reg.row.switched === false && Number(reg.row.usd_per_credit) === 0.03 && reg.row.trial_credits === 0, reg);
  await markDeployed(db);
  const sw = await runFile(db, SWITCH);
  ok("H3 billing-switch.sql on a fresh install: RESULT ok", sw.ok && allOk(sw.rows), sw.error || bad(sw.rows));
  reg = await as(db, "anon", "select * from public.turn_credit_regime()");
  ok("H4 turn_credit_regime after: $0.01, trial 50", reg.row.switched === true && Number(reg.row.usd_per_credit) === 0.01 && reg.row.trial_credits === 50, reg.row);
  b = await balanceOf(db, U.N);
  ok("H5 a confirmed account gets 50 trial credits on its next balance read", b.row.remaining === 50 && b.row.plan_remaining === 50 && b.row.trial === true && b.row.plan_allowance === 50, b.row);
  b = await balanceOf(db, U.N);
  ok("H6 …once", b.row.remaining === 50 && (await q(db, "select count(*)::int as n from public.turn_plan_grants where owner = $1 and kind = 'trial'", [U.N.id]))[0].n === 1, b.row);
  b = await balanceOf(db, U.N2);
  ok("H7 the same mailbox again (Gmail dots, +tag, googlemail) gets no second trial", b.row.remaining === 0 && b.row.trial === false, b.row);
  b = await balanceOf(db, U.X);
  ok("H8 an unconfirmed email gets nothing", b.row.remaining === 0 && b.row.trial === false, b.row);
  await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U.X.id}'`);
  b = await balanceOf(db, U.X);
  ok("H9 …and 50 once confirmed", b.row.remaining === 50 && b.row.trial === true, b.row);
  // (owner 2026-10-03) an account created before email confirmation was switched on (2026-10-02
  // ~17:45 UTC) gets no trial: back then every address counted as confirmed the moment it signed up
  const OLD = { id: "10000000-0000-0000-0000-0000000000f1", email: "early-bird@example.com" };
  await db.query("insert into auth.users(id, email, email_confirmed_at, created_at) values ($1, $2, $3, $3)",
    [OLD.id, OLD.email, new Date("2026-09-15T10:00:00Z")]);
  b = await balanceOf(db, OLD);
  ok("H9b an account created before confirmation was switched on gets no trial, though 'confirmed'", b.row.remaining === 0 && b.row.trial === false, b.row);
  b = await balanceOf(db, U.P);
  ok("H10 a subscriber gets no trial (5,000 before the switch = 15,000 after)", b.row.remaining === 15000 && b.row.trial === false, b.row);
  b = await balanceOf(db, U.C);
  ok("H11 an account that bought a pack (and has no plan) gets no trial", b.row.remaining === 30 && b.row.trial === false, b.row);
  const par = await Promise.all([balanceOf(db, U.D), balanceOf(db, U.D)]);
  ok("H12 two balance reads at once grant the trial once", par.every((x) => x.row.remaining === 50) &&
    (await q(db, "select count(*)::int as n from public.turn_plan_grants where owner = $1 and kind = 'trial'", [U.D.id]))[0].n === 1, par.map((x) => x.row));
  // (after the switch the server_video_billing marker is set, so the browser's turn_spend_credit is a no-op;
  // the first spend is image-proxy's usage event)
  const sp = await as(db, U.S, "select * from public.turn_record_usage_event(credit_cost => 5)");
  ok("H13 the trial also lands when the first call is a spend", sp.ok && sp.row.remaining === 45, sp);
  await svc(db, "select public.turn_set_plan_once('inv-n', $1, 'writer', 600, 'sub_N', 'cus_N', null)", [U.N.id]);
  b = await balanceOf(db, U.N);
  ok("H14 subscribing replaces the trial credits with the allowance; trial false", b.row.remaining === 600 && b.row.trial === false, b.row);
  await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_N')", [U.N.id]);
  b = await balanceOf(db, U.N);
  ok("H15 FROM the switch day, cancelling ends the plan credits with the plan; the trial never comes back", b.row.remaining === 0 && b.row.trial === false, b.row);
  const peN = await q(db, "select metadata from public.turn_usage_events where owner = $1 and kind = 'plan_end'", [U.N.id]);
  ok("H15b …logged: 600 plan credits ended, none kept", peN.length === 1 && peN[0].metadata.plan_credits_ended === 600 &&
    peN[0].metadata.plan_credits_kept === 0, peN);
  const r = await svc(db, "select public.turn_revoke_charge_once('evt-trial', 'x')");
  ok("H16 trial grants are never matched by a refund", r === 0);
  ok("H17 the mailbox key is a hash, never the address", (await q(db, "select trial_email_key from public.turn_credits where owner = $1", [U.N.id]))[0].trial_email_key.match(/^[0-9a-f]{64}$/));
  ok("H18 balances add up", await consistent(db));
}

/* ================================ J. the switch ================================ */
if (part("J", "J. the credit switch") && OLD) {
  {
    const db = await productionDb();
    const r = await runFile(db, SWITCH);
    ok("J1 before billing-v2 the switch stops, naming the file to run first", !r.ok && /run supabase\/billing-v2\.sql first/.test(r.error), r);
    ok("J2 …and changes nothing", (await q(db, "select to_regclass('public.turn_billing_state') is null as x"))[0].x &&
      (await q(db, "select remaining from public.turn_credits where owner = $1", [U.W.id]))[0].remaining === 3000);
  }
  const db = await upgradedDb();
  await svc(db, "select public.turn_add_pack_once('pk-w', $1, 100, 'ch_w')", [U.W.id]);
  const h = await svc(db, "select public.turn_hold_credits($1, 850, 'pre-switch', 'video')", [U.W.id]);   // 800 plan + 50 of a lot
  // a Producer paid a few days before the switch: a refund after it is matched against this grant
  await svc(db, "select public.turn_set_plan_once('invoice:in_P', $1, 'studio', 9000, 'sub_P', 'cus_P', $2)", [U.P.id, future(25)]);
  // an OLD-unit pack (legacy_unit) granted BEFORE the switch is its amount as sold (the switch triples it with
  // every lot); legacy_unit false never multiplies
  const lpLot = async (ev) => (await q(db, "select amount, remaining from public.turn_credit_lots where event_id = $1", [ev]))[0];
  const lpRes = async (ev) => (await q(db, "select result from public.turn_stripe_events where id = $1", [ev]))[0]?.result || {};
  let lp = await svc(db, "select public.turn_add_pack_once('checkout:cs_old_pre', $1, 300, 'ch_old_pre', true)", [U.C.id]);
  let lpr = await lpRes("checkout:cs_old_pre");
  ok("J1a before the switch, legacy_unit=true grants the amount as sold (300), and the event's result says so",
    lp === 800 && (await lpLot("checkout:cs_old_pre")).amount === 300 && lpr.lot_credits === 300 && lpr.legacy_unit === true && lpr.x3 === false,
    { lp, lpr });
  lp = await svc(db, "select public.turn_add_pack_once('checkout:cs_new_pre', $1, 10, 'ch_new_pre', false)", [U.C.id]);
  lpr = await lpRes("checkout:cs_new_pre");
  ok("J1b before the switch, legacy_unit=false grants the amount (10)", lp === 810 && (await lpLot("checkout:cs_new_pre")).amount === 10 &&
    lpr.lot_credits === 10 && !("legacy_unit" in lpr), { lp, lpr });
  const snap0 = await snapshotData(db);
  const blocked = await runFile(db, SWITCH);
  ok("J2a before the day-0 deploys (no server_video_billing marker) the switch refuses with a FAIL row saying why",
    blocked.ok && blocked.last.length === 9 && /^FAIL/.test(blocked.last[0].status) && /server_video_billing/.test(blocked.last[0].status) &&
    /nothing changed/.test(blocked.last[0].status), blocked.error || blocked.last);
  ok("J2b …and changes nothing", snap0 === await snapshotData(db));
  // the marker alone is not enough: image-proxy must have taken a hold AFTER it (proof the new code is live).
  // The pre-switch hold is older than the marker; a Blender ('studio:') hold after it doesn't count.
  await db.exec(`update public.turn_credit_holds set created_at = now() - interval '2 minutes' where ref = 'pre-switch';
                 insert into public.turn_billing_state(key, value, at) values ('server_video_billing', '{}'::jsonb, now() - interval '1 minute');`);
  await svc(db, "select public.turn_hold_credits($1, 0, 'studio:evt-proof', 'blender-studio')", [U.D.id]);
  const snap1 = await snapshotData(db);
  const noHolds = await runFile(db, SWITCH);
  ok("J2c marker set but no image-proxy hold since it: the switch refuses with a FAIL row saying why",
    noHolds.ok && noHolds.last.length === 9 && /^FAIL — nothing changed/.test(noHolds.last[0].status) &&
    /no credit hold since the server_video_billing marker/.test(noHolds.last[0].status) && /step 4d/.test(noHolds.last[0].detail),
    noHolds.error || noHolds.last);
  ok("J2d …and changes nothing", snap1 === await snapshotData(db));
  await markDeployed(db);
  const before = Object.fromEntries((await q(db, "select owner, remaining, plan_remaining from public.turn_credits")).map((r) => [r.owner, r]));
  const lotsBefore = await q(db, "select id, amount, remaining, expires_at from public.turn_credit_lots order by id");
  const grantsBefore = await q(db, "select id, amount, revoked_amount from public.turn_plan_grants order by id");
  const sw = await runFile(db, SWITCH);
  ok("J3 billing-switch.sql: every RESULT row ok", sw.ok && allOk(sw.last), sw.error || bad(sw.last || []));
  ok("J3b …the RESULT is the LAST statement's result, after the commit (what the SQL Editor shows), 9 rows",
    sw.ok && sw.last.length === 9 && SWITCH.lastIndexOf("\ncommit;") < SWITCH.indexOf("-- ── RESULT") &&
    !/nothing is committed if you stop here/.test(SWITCH), { last: sw.last?.length });
  ok("J4 …it says it switched now", /switched NOW/.test(sw.last?.[0]?.detail || ""), sw.last?.[0]);
  const after = Object.fromEntries((await q(db, "select owner, remaining, plan_remaining from public.turn_credits")).map((r) => [r.owner, r]));
  ok("J5 every balance x3 exactly (total and plan credits)", Object.keys(before).every((k) =>
    after[k].remaining === 3 * before[k].remaining && after[k].plan_remaining === 3 * before[k].plan_remaining), { before, after });
  const lotsAfter = await q(db, "select id, amount, remaining, expires_at from public.turn_credit_lots order by id");
  ok("J6 every lot x3, expiry unchanged", lotsAfter.every((l, i) => l.amount === 3 * lotsBefore[i].amount && l.remaining === 3 * lotsBefore[i].remaining &&
    +l.expires_at === +lotsBefore[i].expires_at), { lotsBefore, lotsAfter });
  const hold = (await q(db, "select held, from_plan, from_lots from public.turn_credit_holds where ref = 'pre-switch'"))[0];
  ok("J7 an open hold x3 (so its release gives back new-unit credits)", h.ok && hold.held === 2550 && hold.from_plan === 2400 && hold.from_lots[0].n === 150, hold);
  const w = await acct(db, U.W), d = await acct(db, U.D), p = await acct(db, U.P), c = await acct(db, U.C);
  ok("J8 grandfathered: Writer 2,400 / Director 7,200 / Producer 27,000 for 30 days",
    w.legacy_tier === "writer" && w.legacy_allowance === 2400 && d.legacy_allowance === 7200 && p.legacy_allowance === 27000 &&
    Math.abs(new Date(w.legacy_until) - Date.now() - 30 * 86400000) < 120000, [w, d, p]);
  ok("J9 an account without a plan is not grandfathered", c.legacy_allowance == null && c.legacy_until == null, c);
  ok("J10 allowances x3", n(w.plan_allowance) === 2400 && n(p.plan_allowance) === 27000, [w.plan_allowance, p.plan_allowance]);
  const pr = await acct(db, U.R);
  ok("J10a a legacy 'pro' subscriber is grandfathered as Director (7,200) and its credits x3",
    pr.legacy_tier === "director" && pr.legacy_allowance === 7200 && pr.plan_remaining === 6000 && pr.lots === 0, pr);
  const grantsAfter = await q(db, "select id, amount, revoked_amount from public.turn_plan_grants order by id");
  ok("J10b plan grants x3 (what a later refund is matched against)", grantsBefore.length > 0 && grantsAfter.every((g, i) =>
    g.amount === 3 * grantsBefore[i].amount && g.revoked_amount === 3 * grantsBefore[i].revoked_amount), { grantsBefore, grantsAfter });
  const snap = await snapshotData(db);
  const again = await runFile(db, SWITCH);
  ok("J11 a re-run: RESULT ok, 'already switched … changed nothing'", again.ok && allOk(again.last) && /already switched .* changed nothing/.test(again.last[0].detail), again.last);
  ok("J12 a re-run changes no data", snap === await snapshotData(db));
  // the old-pack x3 is decided in the database (turn_add_pack_once legacy_unit), atomically with the lot
  ok("J12a the legacy pack granted before the switch was tripled ONCE, by the switch (300 -> 900; the plain 10 -> 30)",
    (await lpLot("checkout:cs_old_pre")).amount === 900 && (await lpLot("checkout:cs_new_pre")).amount === 30,
    [await lpLot("checkout:cs_old_pre"), await lpLot("checkout:cs_new_pre")]);
  const c0 = (await acct(db, U.C)).remaining;
  lp = await svc(db, "select public.turn_add_pack_once('checkout:cs_old_post', $1, 300, 'ch_old_post', true)", [U.C.id]);
  lpr = await lpRes("checkout:cs_old_post");
  const lotPost = await lpLot("checkout:cs_old_post");
  ok("J12b after the switch, legacy_unit=true grants x3 (300 old-unit credits -> a 900 lot), and the event's result says so",
    c0 === 2430 && lp === c0 + 900 && lotPost.amount === 900 && lotPost.remaining === 900 &&
    lpr.lot_credits === 900 && lpr.legacy_unit === true && lpr.x3 === true, { c0, lp, lotPost, lpr });
  lp = await svc(db, "select public.turn_add_pack_once('checkout:cs_old_post', $1, 300, 'ch_old_post', true)", [U.C.id]);
  ok("J12c …once per event: a re-sent grant adds nothing (still one 900 lot)", lp === c0 + 900 &&
    (await q(db, "select count(*)::int as n from public.turn_credit_lots where event_id = 'checkout:cs_old_post'"))[0].n === 1, lp);
  lp = await svc(db, "select public.turn_add_pack_once(event_id => $1, uid => $2, amount => 300, charge_id => 'ch_old_named', legacy_unit => true)",
    ["checkout:cs_old_named", U.C.id]);
  ok("J12d …the same with named arguments (how PostgREST calls it for the webhook): 900", (await lpLot("checkout:cs_old_named")).amount === 900, lp);
  lp = await svc(db, "select public.turn_add_pack_once('checkout:cs_new_post', $1, 250, 'ch_new_post')", [U.C.id]);
  const lp4n = await svc(db, "select public.turn_add_pack_once(event_id => $1, uid => $2, amount => 1000, charge_id => 'ch_new_named')",
    ["checkout:cs_new_named", U.C.id]);
  lpr = await lpRes("checkout:cs_new_post");
  ok("J12e the 4-argument call (positional and named) still works after the switch and never multiplies (250 / 1,000)",
    (await lpLot("checkout:cs_new_post")).amount === 250 && (await lpLot("checkout:cs_new_named")).amount === 1000 &&
    lp4n === c0 + 1800 + 250 + 1000 && lpr.lot_credits === 250 && !("legacy_unit" in lpr), { lp, lp4n, lpr });
  await svc(db, "select public.turn_add_pack_once('checkout:cs_new_false', $1, 3000, 'ch_new_false', false)", [U.C.id]);
  await svc(db, "select public.turn_add_pack_once('checkout:cs_new_null', $1, 5, 'ch_new_null', null)", [U.C.id]);
  ok("J12f …and legacy_unit false (or null) never multiplies (3,000 / 5)",
    (await lpLot("checkout:cs_new_false")).amount === 3000 && (await lpLot("checkout:cs_new_null")).amount === 5);
  const rfOld = await svc(db, "select public.turn_revoke_charge_once('evt_rf_old_post', 'ch_old_post')");
  ok("J12g a refund of the late old pack removes its whole 900", rfOld === 900 && (await lpLot("checkout:cs_old_post")).remaining === 0, rfOld);
  const rl = await svc(db, "select public.turn_release_hold('pre-switch')");
  ok("J13 releasing the pre-switch hold gives back 2,550 new credits", rl.given_back === 2550, rl);
  const refundP = await svc(db, "select public.turn_revoke_charge_once('evt_refund_P', 'invoice:in_P')");
  ok("J13b a full refund AFTER the switch of a Producer payment made BEFORE it removes the tripled 27,000 (not 9,000)",
    refundP === 27000 && (await acct(db, U.P)).plan_remaining === 0, { refundP, p: await acct(db, U.P) });
  let v = await svc(db, "select public.turn_set_plan_once('invoice:w-renew', $1, 'writer', 600, 'sub_W', 'cus_W', null)", [U.W.id]);
  ok("J14 a renewal inside the 30 days gives the old allowance (2,400), not 600", (await acct(db, U.W)).plan_remaining === 2400, v);
  v = await svc(db, "select public.turn_adjust_plan_once('upgrade:sub_W:writer>director', $1, 'director', 1000, 'sub_W')", [U.W.id]);
  ok("J15 an upgrade inside the 30 days adds the old difference (7,200 - 2,400 = 4,800)", (await acct(db, U.W)).plan_remaining === 2400 + 4800, await acct(db, U.W));
  v = await svc(db, "select public.turn_set_plan_once('invoice:w-renew2', $1, 'director', 1600, 'sub_W', 'cus_W', null)", [U.W.id]);
  ok("J16 …and its next renewal gives Director's old allowance (7,200)", (await acct(db, U.W)).plan_remaining === 7200);
  v = await svc(db, "select public.turn_set_plan_once('invoice:r-renew', $1, 'director', 1600, 'sub_R', 'cus_R', null)", [U.R.id]);
  ok("J16b a legacy 'pro' subscriber renewed as Director inside the 30 days gets Director's old allowance (7,200)",
    (await acct(db, U.R)).plan_remaining === 7200, await acct(db, U.R));
  await db.exec(`update public.turn_credits set legacy_until = now() - interval '1 minute'`);
  v = await svc(db, "select public.turn_set_plan_once('invoice:w-renew3', $1, 'director', 1600, 'sub_W', 'cus_W', null)", [U.W.id]);
  ok("J17 after the 30 days a renewal gives the Option A allowance (1,600)", (await acct(db, U.W)).plan_remaining === 1600);
  v = await svc(db, "select public.turn_set_plan_once('invoice:p-renew', $1, 'studio', 5000, 'sub_P', 'cus_P', null)", [U.P.id]);
  ok("J18 …Producer 5,000", (await acct(db, U.P)).plan_remaining === 5000);
  const reg = await as(db, U.W, "select * from public.turn_credit_regime()");
  ok("J19 turn_credit_regime reports the switch and the grandfathering date", reg.row.switched === true && reg.row.legacy_until instanceof Date, reg.row);
  const b = await balanceOf(db, U.H);
  ok("J20 an existing never-paid account gets its trial after the switch", b.row.remaining === 50 && b.row.trial === true, b.row);
  ok("J21 balances add up", await consistent(db));
  const marker = (await q(db, "select value from public.turn_billing_state where key = 'credit_unit_switch'"))[0].value;
  ok("J22 the marker keeps the before / after totals", marker.multiplier === 3 && marker.after.total === 3 * marker.before.total &&
    marker.after.grants === 3 * marker.before.grants && marker.grandfathered.director === 2, marker);
  // from the switch day on, cancelling ends the plan credits
  await svc(db, "select public.turn_end_plan_for_sub($1, 'sub_R')", [U.R.id]);
  const rEnd = await acct(db, U.R);
  ok("J23 after the switch, a cancelled subscription's plan credits end with it", rEnd.plan === "none" && rEnd.plan_remaining === 0, rEnd);

  // the ×3 check: any mismatch aborts the whole transaction
  {
    const d2 = await upgradedDb();
    await markDeployed(d2);
    await d2.exec(`alter table public.turn_credits disable trigger turn_credits_ledger_sync;
                   update public.turn_credits set remaining = remaining + 1 where owner = '${U.W.id}';
                   alter table public.turn_credits enable trigger turn_credits_ledger_sync;`);
    const s0 = await snapshotData(d2);
    const bad3 = await runFile(d2, SWITCH);
    ok("J24 totals not exactly x3 (a drifted balance): the switch raises an error…", !bad3.ok && /not exactly x3/.test(bad3.error), bad3);
    ok("J25 …and NOTHING is committed (no marker, no balance changed)", s0 === await snapshotData(d2) &&
      (await q(d2, "select count(*)::int as n from public.turn_billing_state where key = 'credit_unit_switch'"))[0].n === 0);
  }

  // billing-switch-undo.sql: the exact inverse when run soon after
  {
    const d3 = await upgradedDb();
    await markDeployed(d3);
    const undoFirst = await runFile(d3, UNDO);
    ok("J26 the undo refuses when the switch has not run, changing nothing", !undoFirst.ok && /has not run/.test(undoFirst.error), undoFirst);
    await svc(d3, "select public.turn_add_pack_once('pk-u', $1, 100, 'ch_u')", [U.W.id]);
    await svc(d3, "select public.turn_hold_credits($1, 850, 'pre-u', 'video')", [U.W.id]);
    await svc(d3, "select public.turn_set_plan_once('invoice:in_Pu', $1, 'studio', 9000, 'sub_P', 'cus_P', $2)", [U.P.id, future(25)]);
    await svc(d3, "select public.turn_revoke_charge_once('evt_rf_pre', 'ch_u')");   // a revoked lot (history columns)
    const view = async () => safe({
      credits: await q(d3, `select owner, remaining, plan_remaining, plan_allowance, legacy_tier, legacy_allowance, legacy_until,
                                   trial_granted_at, trial_email_key, plan, paid_since from public.turn_credits order by owner`),
      lots: await q(d3, "select id, amount, remaining, expired_amount, revoked_amount, expires_at from public.turn_credit_lots order by id"),
      holds: await q(d3, "select ref, held, from_plan, from_lots, status from public.turn_credit_holds order by ref"),
      grants: await q(d3, "select id, kind, amount, revoked_amount from public.turn_plan_grants order by id"),
      regime: await q(d3, "select switched, usd_per_credit, trial_credits from public.turn_credit_regime()"),
    });
    const v0 = await view();
    const s1 = await runFile(d3, SWITCH);
    const trialRead = await balanceOf(d3, U.H);
    ok("J27 (switch ran; a never-paid account got its 50-credit trial after it)", s1.ok && allOk(s1.last) && trialRead.row.remaining === 50, trialRead.row);
    const u = await runFile(d3, UNDO);
    ok("J28 billing-switch-undo.sql: RESULT after the commit, every row ok, 'exact'", u.ok && u.last.length === 6 && allOk(u.last) &&
      /exact/.test(u.last[1].detail) && UNDO.lastIndexOf("\ncommit;") < UNDO.indexOf("-- ── RESULT"), u.error || u.last);
    ok("J29 switch -> undo is the exact inverse: balances, lots, holds, grants, trial and regime as before", v0 === await view(),
      { before: JSON.parse(v0), after: JSON.parse(await view()) });
    ok("J30 …the switch marker is gone and the undo is recorded", (await q(d3, "select key from public.turn_billing_state where key like 'credit_unit_switch%' order by key"))
      .map((x) => x.key).join() === "credit_unit_switch_undone");
    ok("J31 …balances add up", await consistent(d3));
    const u2 = await runFile(d3, UNDO);
    ok("J32 a second undo refuses (the switch is not active), changing nothing", !u2.ok && /has not run/.test(u2.error) && v0 === await view(), u2);
    await svc(d3, "select public.turn_add_pack_once('checkout:old_after_undo', $1, 300, 'ch_oau', true)", [U.D.id]);
    const oau = async () => (await q(d3, "select amount from public.turn_credit_lots where event_id = 'checkout:old_after_undo'"))[0]?.amount;
    ok("J32b after an undo, legacy_unit=true grants the amount as sold again (300: the unit is back to $0.03)", await oau() === 300, await oau());
    const s2 = await runFile(d3, SWITCH);
    ok("J33 the switch can run again after an undo (x3 again)", s2.ok && allOk(s2.last) && /switched NOW/.test(s2.last[0].detail) &&
      (await acct(d3, U.P)).plan_remaining === 27000, s2.error || s2.last);
    ok("J33b …which triples that lot once (900)", await oau() === 900, await oau());
  }
}

/* ============================== K. fresh install ============================== */
if (part("K", "K. fresh install = upgrade path")) {
  const region = (text) => {
    const a = text.indexOf("-- >>> KINOLOT BILLING V2 DEFINITIONS >>>");
    const m = "-- <<< KINOLOT BILLING V2 DEFINITIONS <<<";
    const b = text.indexOf(m);
    return a >= 0 && b > a ? text.slice(a, b + m.length) : null;
  };
  ok("K1 the shared block is byte-identical in credits.sql and billing-v2.sql", region(CREDITS) !== null && region(CREDITS) === region(V2));
  const fingerprint = async (db) => safe({
    fns: await q(db, `select p.oid::regprocedure::text as sig, pg_get_function_result(p.oid) as res, p.prosecdef, p.proconfig, p.provolatile,
                             md5(p.prosrc) as src, p.proacl::text as acl
                        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                       where ns.nspname = 'public' and p.proname like 'turn%' order by 1`),
    cols: await q(db, `select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
                        where table_schema = 'public' and table_name like 'turn%' order by 1, 2`),
    cons: await q(db, `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
                        where connamespace = 'public'::regnamespace order by 1, 2`),
    idx: await q(db, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
    pol: await q(db, `select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public' order by 1, 2`),
    trg: await q(db, `select tgrelid::regclass::text as t, tgname, pg_get_triggerdef(oid) as def from pg_trigger where not tgisinternal order by 1, 2`),
    acl: await q(db, `select relname, relacl::text as acl, relrowsecurity from pg_class
                       where relnamespace = 'public'::regnamespace and relname like 'turn%' and relkind = 'r' order by 1`),
  });
  const fresh = await freshDb();
  if (OLD) {
    // (credits.sql also carries tax-compliance.sql's block: the upgrade path runs both files)
    const upg = await productionDb();
    await runFile(upg, V2);
    await runFile(upg, TAX);
    const [fa, fb] = [JSON.parse(await fingerprint(fresh)), JSON.parse(await fingerprint(upg))];
    const diff = Object.keys(fa).filter((k) => safe(fa[k]) !== safe(fb[k]));
    const detail = diff.map((k) => ({ k, fresh: fa[k].filter((x) => !fb[k].some((y) => safe(y) === safe(x))), upgrade: fb[k].filter((y) => !fa[k].some((x) => safe(x) === safe(y))) }));
    // the upgrade database also holds turn_studio_settle_credit (its own migration), nothing else differs
    const onlyStudio = detail.every((dd) => dd.k === "fns" && dd.fresh.length === 0 && dd.upgrade.every((f) => /turn_studio_settle_credit/.test(f.sig)));
    ok("K2 credits.sql alone ends in the same schema, functions and privileges as the upgrade path (billing-v2.sql, then tax-compliance.sql)", diff.length === 0 || onlyStudio, detail);
  }
  const v2 = await runFile(fresh, V2);
  ok("K3 billing-v2.sql after a fresh credits.sql: RESULT ok", v2.ok && allOk(v2.rows), v2.error || bad(v2.rows));
  const snap = await snapshotData(fresh);
  const again = await runFile(fresh, CREDITS);
  ok("K4 credits.sql is safe to re-run", again.ok, again.error);
  ok("K5 …and changes no data", snap === await snapshotData(fresh));
  ok("K6 the carry-over marker is set on a fresh install (a later v2 run never carries)",
    (await q(fresh, "select value from public.turn_billing_state where key = 'v2_installed'"))[0]?.value?.carried_credits === 0);
  ok("K7 credits.sql and billing-v2.sql are one transaction each", /^begin;$/m.test(CREDITS) && /^commit;$/m.test(CREDITS) && /^begin;$/m.test(V2) && /^commit;$/m.test(V2));
  ok("K8 billing-switch.sql and billing-switch-undo.sql are one transaction each", /^begin;$/m.test(SWITCH) && /^commit;$/m.test(SWITCH) &&
    /^begin;$/m.test(UNDO) && /^commit;$/m.test(UNDO));
  // a database that already has the 4-argument turn_add_pack_once (an earlier billing-v2 run): v2 replaces it
  await fresh.exec(`drop function public.turn_add_pack_once(text, uuid, integer, text, boolean);
    create function public.turn_add_pack_once(event_id text, uid uuid, amount integer, charge_id text default null)
      returns integer language sql security definer set search_path = '' as $f$ select -1 $f$;`);
  const v2b = await runFile(fresh, V2);
  const packFns = await q(fresh, "select p.oid::regprocedure::text as sig from pg_proc p where p.proname = 'turn_add_pack_once'");
  const call4 = await as(fresh, "service", "select public.turn_add_pack_once('checkout:k9', $1, 7, 'ch_k9') as v", [U.W.id]);
  ok("K9 billing-v2.sql over the earlier 4-argument turn_add_pack_once: RESULT ok, ONE function left (with legacy_unit), a 4-argument call works",
    v2b.ok && allOk(v2b.rows) && packFns.length === 1 && /,boolean\)$/.test(packFns[0].sig) && call4.ok && call4.row.v === 7,
    { error: v2b.error, bad: v2b.ok ? bad(v2b.rows) : null, packFns, call4 });
}

/* ======================== M. the housekeeping schedule ======================== */
const CRON_STUB = `create schema cron;
  create table cron.job(jobid bigserial primary key, jobname text unique, schedule text not null, command text not null,
                        active boolean not null default true);
  -- pg_cron 1.3+: schedule(name, …) upserts by name; unschedule(jobid) removes one job
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as $$
    delete from cron.job where jobid = job_id returning true $$;`;
const NET_STUB = `create schema net;
  create table net.calls(id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_ms integer);
  -- pg_net's signature: net.http_post(url, body, params, headers, timeout_milliseconds) returns a request id
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                                timeout_milliseconds integer default 5000) returns bigint language sql as $$
    insert into net.calls(url, body, params, headers, timeout_ms) values (url, body, params, headers, timeout_milliseconds) returning id $$;`;
const CRON_JOBS = ["kinolot-release-stale-holds", "kinolot-reconcile-video-holds", "kinolot-reconcile-studio-holds", "kinolot-expire-lots"];
if (part("M", "M. housekeeping schedule (billing-housekeeping-cron.sql)")) {
  const db = await freshDb();
  await db.exec(CRON_STUB + NET_STUB);
  ok("M1 it enables pg_cron and pg_net itself", /^create extension if not exists pg_cron;$/m.test(CRON) && /^create extension if not exists pg_net;$/m.test(CRON));
  const body = CRON.replace(/^create extension if not exists pg_(cron|net);$/gm, "");
  let r = await runFile(db, body);
  ok("M2 it runs; its RESULT lists pg_net and the four jobs, every row ok", r.ok && r.last.length === 5 && r.last.every((x) => x.status === "ok") &&
    CRON_JOBS.every((j) => r.last.some((x) => x.item === j)), r.error || r.last);
  await db.exec("update cron.job set schedule = '0 0 1 1 *' where jobname = 'kinolot-reconcile-video-holds'; delete from cron.job where jobname = 'kinolot-expire-lots'");
  r = await runFile(db, body);
  ok("M3 safe to re-run: the jobs are unscheduled by name and scheduled again (not doubled; a changed or missing one comes back)",
    r.ok && (await q(db, "select count(*)::int as n from cron.job"))[0].n === 4 &&
    (await q(db, "select schedule from cron.job where jobname = 'kinolot-reconcile-video-holds'"))[0].schedule !== "0 0 1 1 *" &&
    r.last.every((x) => x.status === "ok"), r.error || r.last);
  const jobs = Object.fromEntries((await q(db, "select jobname, schedule, command from cron.job")).map((j) => [j.jobname, j]));
  ok("M4 stale holds are released every 10 minutes, after 30 minutes", jobs["kinolot-release-stale-holds"]?.schedule === "*/10 * * * *" &&
    /select public\.turn_release_stale_holds\(30\)/.test(jobs["kinolot-release-stale-holds"]?.command || ""), jobs);
  ok("M5 expired packs are zeroed daily", /^\d+ \d+ \* \* \*$/.test(jobs["kinolot-expire-lots"]?.schedule || "") &&
    /select public\.turn_expire_lots\(\)/.test(jobs["kinolot-expire-lots"]?.command || ""), jobs);
  // what pg_cron will do: run the command as postgres (no API role, no JWT)
  await svc(db, "select public.turn_set_plan_once('inv-m', $1, 'writer', 100, 'sub_M', 'cus_M', null)", [U.H.id]);
  await svc(db, "select public.turn_hold_credits($1, 40, 'text:killed-worker', 'text')", [U.H.id]);
  await db.exec("update public.turn_credit_holds set created_at = now() - interval '31 minutes' where ref = 'text:killed-worker'");
  const cmd = (name) => jobs[name]?.command || "select 'missing job' as x where false";
  const ran = await as(db, "editor", cmd("kinolot-release-stale-holds"));
  const ran2 = await as(db, "editor", cmd("kinolot-expire-lots"));
  ok("M6 the scheduled commands run as postgres and give a killed worker's hold back", ran.ok && ran2.ok &&
    (await q(db, "select status from public.turn_credit_holds where ref = 'text:killed-worker'"))[0].status === "released" &&
    (await acct(db, U.H)).remaining === 100, [ran, ran2]);
  // the reconcile calls: POST {"op":"reconcile_holds"} to each function, no key (both are deployed --no-verify-jwt)
  const every10 = (sch) => { const m = String(sch || "").split(" ")[0]; const mins = m.startsWith("*/") ? [0, 10, 20, 30, 40, 50] : m.split(",").map(Number);
    return mins.length === 6 && mins.every((x, i) => i === 0 || x - mins[i - 1] === 10) && / \* \* \* \*$/.test(sch); };
  ok("M7 image-proxy and blender-bridge are called every 10 minutes, at different minutes",
    every10(jobs["kinolot-reconcile-video-holds"]?.schedule) && every10(jobs["kinolot-reconcile-studio-holds"]?.schedule) &&
    jobs["kinolot-reconcile-video-holds"]?.schedule !== jobs["kinolot-reconcile-studio-holds"]?.schedule, jobs);
  await db.exec("delete from net.calls");
  const rv = await as(db, "editor", cmd("kinolot-reconcile-video-holds"));
  const rs = await as(db, "editor", cmd("kinolot-reconcile-studio-holds"));
  const calls = await q(db, "select url, body, headers, timeout_ms from net.calls order by id");
  ok("M8 each command POSTs {\"op\":\"reconcile_holds\"} as JSON to its function, with no key and a timeout above the ~60 s run",
    rv.ok && rs.ok && calls.length === 2 &&
    calls[0].url === "https://vubenblfdzginlqiglzw.supabase.co/functions/v1/image-proxy" &&
    calls[1].url === "https://vubenblfdzginlqiglzw.supabase.co/functions/v1/blender-bridge" &&
    calls.every((c) => safe(c.body) === safe({ op: "reconcile_holds" }) && safe(c.headers) === safe({ "Content-Type": "application/json" }) &&
      c.timeout_ms >= 90000), [rv, rs, calls]);
  // without pg_net the RESULT says so
  const db2 = await freshDb();
  await db2.exec(CRON_STUB);
  r = await runFile(db2, body.replace(/^select cron\.schedule\('kinolot-reconcile-[\s\S]*?\$job\$\);$/gm, ""));
  const netRow = (r.last || []).find((x) => /pg_net/.test(x.item));
  ok("M9 the RESULT flags a missing pg_net and a missing job (FAIL rows)", r.ok && /^FAIL/.test(netRow?.status || "") &&
    /^FAIL/.test(r.last.find((x) => x.item === "kinolot-reconcile-video-holds")?.status || "") &&
    r.last.find((x) => x.item === "kinolot-release-stale-holds")?.status === "ok", r.error || r.last);
}

/* ===================== N. the reconciliation contract (server <-> database) ===================== */
if (part("N", "N. reconciliation: turn_open_provider_holds, turn_claim_housekeeping, the 30-day rule")) {
  const db = await freshDb();
  await svc(db, "select public.turn_set_plan_once('inv-n1', $1, 'studio', 1000, 'sub_N1', 'cus_N1', null)", [U.P.id]);
  await svc(db, "select public.turn_set_plan_once('inv-n2', $1, 'director', 500, 'sub_N2', 'cus_N2', null)", [U.D.id]);
  const hold = (who, amount, ref, reason) => svc(db, "select public.turn_hold_credits($1, $2, $3, $4)", [who.id, amount, ref, reason]);
  const attach = (ref, pref) => svc(db, "select public.turn_hold_attach($1, $2)", [ref, pref]);
  const age = (ref, iv) => db.exec(`update public.turn_credit_holds set created_at = now() - interval '${iv}' where ref = '${ref}'`);
  await hold(U.P, 63, "video:a", "video"); await attach("video:a", "req-a"); await age("video:a", "2 hours");
  await hold(U.P, 30, "video:b", "video"); await attach("video:b", "req-b"); await age("video:b", "10 minutes");
  await hold(U.D, 40, "studio:c", "blender-studio"); await attach("studio:c", "mesh-c"); await age("studio:c", "3 hours");
  await hold(U.D, 5, "text:d", "text"); await age("text:d", "2 hours");                       // no provider job
  await hold(U.P, 20, "video:e", "video"); await attach("video:e", "req-e"); await age("video:e", "5 hours");
  await svc(db, "select public.turn_settle_hold('video:e', 20)");                           // finished: not open
  const open = async (sql, params = []) => (await as(db, "service", sql, params)).rows || [];
  let rows = await open("select * from public.turn_open_provider_holds()");
  ok("N1 turn_open_provider_holds(): open holds WITH a provider job, older than 60 minutes, oldest first",
    safe(rows.map((x) => x.ref)) === safe(["studio:c", "video:a"]), rows);
  ok("N2 …each row: ref, owner, provider_ref, held, reason, created_at", safe(Object.keys(rows[0] || {})) ===
    safe(["ref", "owner", "provider_ref", "held", "reason", "created_at"]) && rows[1].owner === U.P.id && rows[1].provider_ref === "req-a" &&
    rows[1].held === 63 && rows[1].reason === "video" && rows[1].created_at instanceof Date, rows);
  rows = await open("select * from public.turn_open_provider_holds(older_than_minutes => 5)");
  ok("N3 older_than_minutes: 5 also returns the 10-minute-old render", safe(rows.map((x) => x.ref)) === safe(["studio:c", "video:a", "video:b"]), rows);
  rows = await open("select * from public.turn_open_provider_holds(max_rows => 1)");
  ok("N4 max_rows caps the batch (oldest first)", safe(rows.map((x) => x.ref)) === safe(["studio:c"]), rows);
  rows = await open("select * from public.turn_open_provider_holds(5, 50, 'video:')");
  const rows2 = await open("select * from public.turn_open_provider_holds(ref_prefix => 'studio:')");
  ok("N5 ref_prefix keeps image-proxy's and blender-bridge's holds apart (no crowding out)",
    safe(rows.map((x) => x.ref)) === safe(["video:a", "video:b"]) && safe(rows2.map((x) => x.ref)) === safe(["studio:c"]), [rows, rows2]);
  // the server settles / releases what it found — those holds are then no longer listed
  await svc(db, "select public.turn_settle_hold('video:a', 50)");
  await svc(db, "select public.turn_release_hold('studio:c')");
  rows = await open("select * from public.turn_open_provider_holds(5)");
  ok("N6 …once settled or released a hold is no longer listed", safe(rows.map((x) => x.ref)) === safe(["video:b"]), rows);

  // the throttle: one caller per window
  const claim = (job, secs) => svc(db, "select public.turn_claim_housekeeping($1, $2)", [job, secs]);
  const c1 = await claim("image-proxy_reconcile", 240);
  const c2 = await claim("image-proxy_reconcile", 240);
  const c3 = await claim("blender-bridge_reconcile", 240);
  ok("N7 turn_claim_housekeeping: the first caller in a window gets true, the next false; each job has its own window",
    c1 === true && c2 === false && c3 === true, [c1, c2, c3]);
  const par = await Promise.all([claim("burst", 240), claim("burst", 240), claim("burst", 240)]);
  ok("N8 three callers at once: exactly one gets true", par.filter((x) => x === true).length === 1, par);
  const row = (await q(db, "select key, value, at from public.turn_billing_state where key = 'housekeeping:image-proxy_reconcile'"))[0];
  ok("N9 …the run is recorded (turn_billing_state 'housekeeping:<job>': when, the window, how many runs)",
    !!row && row.value.every_seconds === 240 && row.value.runs === 1 && Math.abs(new Date(row.at) - Date.now()) < 60000, row);
  await db.exec("update public.turn_billing_state set at = now() - interval '241 seconds' where key = 'housekeeping:image-proxy_reconcile'");
  const c4 = await claim("image-proxy_reconcile", 240);
  const c5 = await claim("image-proxy_reconcile", 240);
  ok("N10 once the window has passed, one caller may run again", c4 === true && c5 === false &&
    (await q(db, "select value from public.turn_billing_state where key = 'housekeeping:image-proxy_reconcile'"))[0].value.runs === 2, [c4, c5]);
  ok("N11 every_seconds 0 always lets the caller run", (await claim("always", 0)) === true && (await claim("always", 0)) === true);
  const e = await as(db, "service", "select public.turn_claim_housekeeping('  ', 240)");
  ok("N12 an empty job name is refused", !e.ok && /job name/.test(e.error), e);

  // the 30-day last resort (the cron's own rule) and what the cron leaves to the server
  await age("video:b", "8 days");
  const before = (await acct(db, U.P)).remaining;
  let n = await svc(db, "select public.turn_release_stale_holds(30)");
  ok("N13 a provider-tied hold 8 days old is NOT settled by the cron (the reconciliation decides by the provider's answer)",
    n === 1 && (await q(db, "select status from public.turn_credit_holds where ref = 'video:b'"))[0].status === "held" &&
    (await q(db, "select status from public.turn_credit_holds where ref = 'text:d'"))[0].status === "released" &&
    (await acct(db, U.P)).remaining === before, n);
  await age("video:b", "31 days");
  n = await svc(db, "select public.turn_release_stale_holds(30)");
  const vb = (await q(db, "select status, kept, released from public.turn_credit_holds where ref = 'video:b'"))[0];
  ok("N14 …one still open after 30 days is settled at the held amount (last resort)", n === 1 && vb.status === "settled" &&
    vb.kept === 30 && vb.released === 0 && (await acct(db, U.P)).remaining === before, { n, vb });
  // the held column follows the open holds
  await hold(U.P, 11, "video:f", "video");
  let b = await balanceOf(db, U.P);
  ok("N15 turn_credit_balance().held is the sum of the account's open holds", b.row.held === 11, b.row);
  await svc(db, "select public.turn_release_hold('video:f')");
  b = await balanceOf(db, U.P);
  ok("N16 …and 0 once they are finished", b.row.held === 0 && (await balanceOf(db, U.D)).row.held === 0, b.row);
  ok("N17 balances add up", await consistent(db));
  /* the service-only guard reads the request's JWT the way Supabase's auth.role() does (Replit's real-Postgres run,
     2026-10-01: a stand-in auth.role() that falls back to current_user refused the SQL editor's own sweep) */
  await db.exec(`create or replace function auth.role() returns text language sql stable as $f$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)::text $f$`);
  const editorSweep = await as(db, "editor", "select public.turn_expire_lots() as n");
  ok("N18 turn__service_only: a session with no JWT (the SQL editor, pg_cron) passes even when auth.role() falls back to the database user",
    editorSweep.ok, editorSweep);
  const claimed = await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated" })]);
    try { await tx.query("select public.turn_expire_lots()"); return "ran"; } catch (e) { return e.message; }
  });
  const claimedOld = await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.role', 'anon', true)");
    try { await tx.query("select public.turn_expire_lots()"); return "ran"; } catch (e) { return e.message; }
  });
  ok("N19 …while a request that carries a non-service role is refused by the guard itself (claims JSON or the older claim.role setting)",
    /is for the service role only/.test(claimed) && /is for the service role only/.test(claimedOld), { claimed, claimedOld });
}

/* The server's own numbers (image-proxy) and the app's recording limit, so the owner docs (L) and CLAUDE.md (P)
   can't drift from the code. */
let SRV = null;
if (RUN("L") || RUN("P")) {
  try {
    const bp = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
    const vs = await import(new URL("supabase/functions/image-proxy/video-snapshots.mjs", ROOT));
    // the app's own recording limit (New Story's spoken answer), read from its source
    const appMax = Number((read("app/newstory.jsx").match(/^const NS_MAX_ANSWER_SECONDS = (\d+);/m) || [])[1]);
    SRV = { sttMax: bp.STT_MAX_SECONDS, promptCap: bp.IMAGE_PROMPT_MAX_CHARS, promptLimits: bp.IMAGE_PROMPT_LIMITS || {}, dir: vs.SNAPSHOT_DIR, urlSecs: vs.SNAPSHOT_URL_SECONDS, maxAgeMs: vs.SNAPSHOT_MAX_AGE_MS, appMax };
    if (![SRV.sttMax, SRV.promptCap, SRV.urlSecs, SRV.maxAgeMs, SRV.appMax].every((n) => Number.isFinite(n) && n > 0) || typeof SRV.dir !== "string" || !SRV.dir) SRV = { error: "a constant is missing", ...SRV };
  } catch (e) { SRV = { error: String((e && e.message) || e) }; }
}
const thousands = (n) => Number(n).toLocaleString("en-US");

/* ================================ L. README ================================ */
if (part("L", "L. README")) {
  const i = README.indexOf("## Billing v2");
  const sec = i >= 0 ? README.slice(i, README.indexOf("\n## ", i + 5) > 0 ? README.indexOf("\n## ", i + 5) : undefined) : "";
  ok("L1 README has a Billing v2 section", sec.length > 0);
  for (const s of ["billing-v2.sql", "billing-switch.sql", "billing-switch-undo.sql", "billing-housekeeping-cron.sql", "credits.sql", "test-billing-db.mjs", "RESULT"]) ok("L2 it names " + s, sec.includes(s));
  const order = ["billing-v2.sql", "billing-switch.sql"].map((f) => sec.indexOf(f));
  ok("L3 it gives the order: billing-v2.sql before billing-switch.sql", order[0] >= 0 && order[0] < order[1]);
  for (const f of ["turn_credit_balance", "turn_spend_credit", "turn_hold_credits", "turn_settle_hold", "turn_release_hold", "turn_set_plan_once",
    "turn_adjust_plan_once", "turn_add_pack_once", "turn_revoke_charge_once", "turn_set_payment_status", "turn_set_frozen",
    "turn_end_plan_for_sub", "turn_frances_consume", "turn_credit_regime", "turn_hold_attach", "turn_hold_lookup",
    "turn_release_stale_holds", "turn_open_provider_holds", "turn_claim_housekeeping"]) ok("L4 it documents " + f, sec.includes(f));
  const orderSec = sec.slice(sec.indexOf("### Order"), sec.indexOf("### How the balance works"));
  const at = (re) => { const m = orderSec.search(re); return m < 0 ? Infinity : m; };
  ok("L5 the housekeeping schedule is a REQUIRED day-0 step, right after billing-v2.sql (not optional)",
    at(/billing-housekeeping-cron\.sql/) < at(/functions deploy stripe-webhook|Deploy `stripe-webhook`/) && !/Optional housekeeping/i.test(orderSec) &&
    /required/i.test(orderSec.slice(at(/billing-housekeeping-cron\.sql/) - 200, at(/billing-housekeeping-cron\.sql/) + 400)));
  ok("L6 deploy stripe-webhook FIRST, then add the new Stripe events", at(/Deploy `stripe-webhook`/) < at(/invoice\.payment_failed/), [at(/Deploy `stripe-webhook`/), at(/invoice\.payment_failed/)]);
  ok("L7 the server_video_billing marker goes in immediately BEFORE deploying image-proxy",
    at(/server_video_billing/) < at(/then deploy `image-proxy`|deploy `image-proxy`/) && /immediately before/i.test(orderSec), [at(/server_video_billing/), at(/deploy `image-proxy`/)]);
  ok("L8 no step removes the old Frances model id later", !/remove `?"?claude-opus-5"?`? from `?MUSE_MODELS/.test(sec));
  ok("L9 the old packs stay on sale until the switch day; on it they are deactivated a few minutes BEFORE billing-switch.sql, after checking the webhook deliveries",
    /old pack links\s+\(300 \/ 1,200 \/ 4,000\)\s+stay on sale until the switch day/.test(orderSec) &&
    at(/[Dd]eactivate the (three )?old pack/) < at(/run\s+\*\*`billing-switch\.sql`\*\*/) &&
    at(/[Dd]eactivate the (three )?old pack/) < at(/deliveries show nothing pending or failed/) &&
    at(/deliveries show nothing pending or failed/) < at(/run\s+\*\*`billing-switch\.sql`\*\*/) &&
    at(/run\s+\*\*`billing-switch\.sql`\*\*/) < at(/`plan_credits` to 600 \/ 1,600 \/ 5,000/),
    [at(/[Dd]eactivate the (three )?old pack/), at(/deliveries show nothing pending or failed/), at(/run\s+\*\*`billing-switch\.sql`\*\*/)]);
  ok("L10 a Rollback section: the undo file, redeploy image-proxy and blender-bridge, app and image-proxy together, delete the marker",
    /### Rollback/.test(sec) && /billing-switch-undo\.sql/.test(sec.slice(sec.indexOf("### Rollback"))) &&
    /blender-bridge/.test(sec.slice(sec.indexOf("### Rollback"))) && /server_video_billing/.test(sec.slice(sec.indexOf("### Rollback"))));
  const rb = sec.slice(sec.indexOf("### Rollback"), sec.indexOf("### How the balance works"));
  ok("L11 a code rollback after the switch needs billing-switch-undo.sql first (or a hotfix), and open holds are released after the old image-proxy is live",
    /[Aa]fter the switch[\s\S]{0,200}billing-switch-undo\.sql` first[\s\S]{0,40}hotfix/.test(rb) &&
    rb.includes("select public.turn_release_hold(ref) from public.turn_credit_holds where status = 'held';"), rb);
  const flat = (t) => t.replace(/\s+/g, " ");
  ok("L12 no 'within (about) a minute' left: the functions within about 30 seconds, open tabs within about 5 minutes / on returning / on reload",
    ![sec, SWITCH, UNDO].some((t) => /within (about )?a minute/.test(flat(t))) &&
    /the functions within about 30 seconds, open tabs of the app within about 5 minutes \(sooner when someone returns to a tab after a minute away, at once on a reload\)/.test(flat(orderSec)) &&
    /functions within about 30 seconds; open tabs within about 5 minutes/.test(flat(SWITCH)), null);
  ok("L13 the day-0 check matches the app: 800 / 2,400 / 9,000 and the three current packs with Buy buttons; no \"Coming soon\"",
    /the Plans window shows 800 \/ 2,400 \/ 9,000 and the three current packs \(300 \/ 1,200 \/ 4,000\) with Buy buttons/.test(flat(orderSec)) &&
    !/Coming soon/.test(sec));
  ok("L14 step 2 explains the reconciliation in plain words; step 4d deploys image-proxy and blender-bridge together and tells the two refusals apart: \"Credits can't be checked right now\" on every paid call = billing-v2.sql hasn't run; hold_attach_failed = the render couldn't be tied to its credits (stopped, credits returned, try again), then BOTH attach log lines: \"[billing] attach … failed\" (no answer) and \"[billing] attach … refused\" (mismatch / unknown)",
    /reconcile_holds/.test(orderSec) && /charged only if it really finished, and refunded if it failed/.test(flat(orderSec)) &&
    /`image-proxy` and `blender-bridge` \*\*together\*\*/.test(flat(orderSec)) &&
    /every paid call is refused with "Credits can't be checked right now", `billing-v2\.sql` hasn't run on this database: go back to step 1/.test(flat(orderSec)) &&
    /`hold_attach_failed` means the render couldn't be tied to its credits: the render was stopped and its credits returned, so try again\. If it repeats, check the `image-proxy` logs for both lines: `\[billing\] attach … failed` \(the database didn't answer\) and `\[billing\] attach … refused` \(it answered no — `mismatch`: that job id is already on another hold; `unknown`: the database has no such hold\)/.test(flat(orderSec)) &&
    !/`hold_attach_failed` means the database didn't answer/.test(flat(orderSec)) &&
    !/hold_attach_failed[\s\S]{0,80}billing-v2\.sql` hasn't run/.test(flat(orderSec)), null);
  ok("L15 the switch refusal names the image-proxy hold proof", /taken at least one credit hold after it/.test(flat(sec)));
  const step4c = flat(orderSec.slice(orderSec.search(/- \*\*c\.\*\*/), orderSec.search(/- \*\*d\.\*\*/)));
  ok("L16 step 4c: more than a day between the marker and the image-proxy deploy -> delete the marker and insert it again immediately before the deploy (the 48-hour window restarts; the switch then needs a hold after the new marker)",
    /If more than a day passes between this line and the `image-proxy` deploy/.test(step4c) &&
    /set the marker again immediately before the deploy — both lines together: `delete from public\.turn_billing_state where key = 'server_video_billing';` then the insert above/.test(step4c) &&
    /for 48 hours after the marker's time/.test(step4c) && /needs a hold taken after the new marker/.test(step4c), step4c);
  const step6 = flat(orderSec.slice(orderSec.search(/\*\*Switch day/), orderSec.search(/\n7\. /)));
  ok("L17 step 6: the late old-pack x3 is decided in the database (legacy_unit, under the account lock), the switch-day order kept as belt and braces; the contract row documents legacy_unit",
    /`stripe-webhook` passes it with `legacy_unit` and the database decides the x3 \(`turn_add_pack_once`\) under the account lock/.test(step6) &&
    /belt and braces/.test(step6) && !/`stripe-webhook` also triples/.test(step6) &&
    /\| `turn_add_pack_once\(event_id, uid, amount, charge_id, legacy_unit default false\)` \| service role \|[^\n]*x3 from the switch on — decided after the account lock[^\n]*The 4-argument call still works and never multiplies/.test(sec), step6);
  const balance = flat(sec.slice(sec.indexOf("### How the balance works"), sec.indexOf("### The functions")));
  const checks = flat(sec.slice(sec.indexOf("**Read-only checks:**")));
  ok("L18 the length hold in plain words: an edit or a Motion Control render holds about the source's length plus a margin (x 1.1 + 1 s, never above the longest length), reference videos too, from every source the app uses (data URL, device upload, the film's storage, the provider's CDN; the film's storage and device uploads through the server's copy), a file image-proxy can't read (fragmented, damaged, compressed header) holds the longest length, the charge is the real length capped at the hold, and a longer output is a \"[billing] length_mismatch\" log line and a turn_grant_failures row the owner can find (query + the dashboard's log search)",
    /\*\*Renders priced by length \(Motion Control, Edit Video\):\*\* an edit or a Motion Control render holds about the source video's length plus a margin \(its length x 1\.1 plus 1 second, never more than the longest length allowed\)/.test(balance) &&
    /The reference videos a render is given are counted by their length the same way\. Every place the app takes a video from is held by its length: a data URL, a device upload, a video in the film's own storage and a file on the provider's media CDN — the film's storage and device uploads through the server's own copy \(see "Snapshots" below\)\./.test(balance) &&
    /A file it can't read \(a fragmented, damaged or compressed-header video, or one stored anywhere else\) holds the longest length/.test(balance) &&
    !/needs a file `image-proxy` can read cleanly from a place it fetches from/.test(balance) &&
    /The charge still comes from the finished video's real length, never above the hold/.test(balance) &&
    /`\[billing\] length_mismatch <ref> held=<n> output_s=<s>`/.test(balance) && /`turn_grant_failures` row with reason `length_mismatch`/.test(balance) &&
    checks.includes("select created_at, uid, event_id as hold_ref, details from public.turn_grant_failures where reason = 'length_mismatch' order by created_at desc;") &&
    /Edge Functions → `image-proxy` → Logs: search `length_mismatch`/.test(checks), balance);
  ok("L19 the server's numbers were read (image-proxy billing-pricing.mjs / video-snapshots.mjs)", SRV && !SRV.error, SRV);
  const srv = SRV && !SRV.error ? SRV : { dir: "\u0000", urlSecs: NaN, maxAgeMs: NaN, sttMax: NaN, promptCap: NaN, appMax: NaN };
  const snapBullet = flat(balance.slice(balance.indexOf("**Snapshots (why, where, cleanup):**"), balance.indexOf("**Speech-to-text")));
  ok("L20 snapshots in plain words: why (a stored video or device upload could be replaced after the read), where (the server's own folder, from image-proxy's SNAPSHOT_DIR, closed to every signed-in user), the provider gets a link to the copy (SNAPSHOT_URL_SECONDS), a data URL is uploaded there too and the CDN read directly, a failed copy = unread = the longest length, cleanup at settle / release by the poll or the reconciliation plus leftovers older than SNAPSHOT_MAX_AGE_MS, the offline test, and a read-only query",
    snapBullet.startsWith("**Snapshots (why, where, cleanup):** a video in the film's storage, or a device upload, could be replaced by its owner after `image-proxy` read its length, and the provider would then render a longer video than the one billed.") &&
    snapBullet.includes("`" + srv.dir + "/<time>-<hold id>-<n>.<ext>` (the hold id is the render's hold, `video:<hold id>`) — a folder no signed-in user can write, replace, move a file onto, delete or list") &&
    snapBullet.includes(`gives the provider a ${srv.urlSecs / 3600}-hour link to the copy, never to the original`) &&
    snapBullet.includes("A data URL's bytes are uploaded there the same way; a file on the provider's CDN can't change after the read, so it is read directly.") &&
    snapBullet.includes("If a copy fails, that video counts as unread: the longest length.") &&
    snapBullet.includes("The copies are deleted when the render's hold is settled or released, by the app's poll or by the 10-minute reconciliation") &&
    snapBullet.includes(`removes, as a best effort, any copy older than ${srv.maxAgeMs / 86400000} days`) &&
    snapBullet.includes("`node scripts/test-storage-billing-snapshots.mjs`") &&
    checks.includes(`select name, created_at from storage.objects where bucket_id = 'turn-assets' and starts_with(name, '${srv.dir}/') order by created_at;`), snapBullet);
  const sttBullet = flat(balance.slice(balance.indexOf("**Speech-to-text (New Story's spoken interview):**"), balance.indexOf("**Image prompts:**")));
  ok("L21 speech-to-text in plain words: charged by the recording's real length read from the file (WebM, Ogg, MP4 / MOV, WAV) before the hold (a longer provider length is only logged), never the last spoken word (silence and wordless recordings are charged); unreadable or longer than STT_MAX_SECONDS is refused (the app stops at NS_MAX_ANSWER_SECONDS) and the app switches to the browser's own speech recognition; only the app's models",
    sttBullet.includes("a recording is charged by its real length, which `image-proxy` reads from the file itself (WebM, Ogg, MP4 / MOV or WAV) before it holds anything.") &&
    sttBullet.includes("The hold and the charge are that length — never the time of the last spoken word, so silence counts and a recording with no words in it is still charged.") &&
    sttBullet.includes("A longer length reported by the provider is logged (`[billing] stt_length_mismatch`), never charged above the hold.") &&
    !/if that is longer/.test(sttBullet) &&
    sttBullet.includes(`A recording it can't read, or one longer than ${srv.sttMax / 60} minutes, is refused with a plain sentence and nothing is held (the app itself stops a spoken answer at ${srv.appMax / 60} minutes); the app then quietly switches to the browser's own speech recognition (free).`) &&
    sttBullet.includes("Only the speech-to-text models the app uses are accepted.") && !/word timestamps? (are|is) (used|kept)/i.test(sttBullet), sttBullet);
  ok("L22 the image prompt cap in plain words, with image-proxy's IMAGE_PROMPT_MAX_CHARS: refused on every image route before anything is held",
    flat(balance).includes(`**Image prompts:** an image prompt longer than ${thousands(srv.promptCap)} characters is refused on every image route before anything is held`), null);
  ok("L23 the app never records a spoken answer longer than image-proxy accepts (NS_MAX_ANSWER_SECONDS <= STT_MAX_SECONDS), so the docs' two numbers can't contradict each other",
    srv.appMax > 0 && srv.appMax <= srv.sttMax, { app: srv.appMax, server: srv.sttMax });
}

/* ============================== CLAUDE.md ============================== */
if (part("P", "P. CLAUDE.md billing rules")) {
  const bill = NOTES.slice(NOTES.indexOf("## 💳 Billing rules"), NOTES.indexOf("\n## ", NOTES.indexOf("## 💳 Billing rules") + 5)).replace(/\s+/g, " ");
  ok("P1 CLAUDE.md's billing section names the reconciliation (reconcile_holds, every 10 minutes by the cron)",
    /reconcile_holds/.test(bill) && /billing-housekeeping-cron\.sql/.test(bill) && /turn_open_provider_holds/.test(bill) && /turn_claim_housekeeping/.test(bill), bill);
  ok("P2 …and the stale-hold rule (30 minutes without a provider job; provider-tied holds settled only after 30 days)",
    /turn_release_stale_holds/.test(bill) && /30 minutes/.test(bill) && /30 days/.test(bill), bill);
  ok("P3 …and that an old-unit pack's x3 is decided in the database (turn_add_pack_once legacy_unit, under the account lock)",
    /legacy_unit/.test(bill) && /turn_add_pack_once/.test(bill) && /account lock/.test(bill), bill);
  ok("P4 …and the length holds for Motion Control and video editing (min(validator maximum, ceil-to-0.1 s(length x 1.1 + 1 s)), reference videos read the same way, from a data URL, a stage: upload, the film's storage or the provider's CDN, the maximum when fragmented / compressed-header / unreadable / untrusted, [billing] length_mismatch recorded in turn_grant_failures, the app's STAGE_LENGTH_HOLD)",
    /\*\*Length holds \(Motion Control, video editing\):\*\* hold = min\(validator maximum, ceil-to-0\.1 s\(source length x 1\.1 \+ 1 s\)\)/.test(bill) &&
    /\(reference videos' input seconds are read the same way\)/.test(bill) &&
    /from a data URL, a `stage:` device upload, the film's storage or the provider's CDN/.test(bill) &&
    /\(fragmented, compressed-header, unreadable or untrusted → the validator maximum\)/.test(bill) && /capped at the hold/.test(bill) &&
    !/only from a trusted host/.test(bill) &&
    /`\[billing\] length_mismatch` and is recorded in `turn_grant_failures` \(reason `length_mismatch`\)/.test(bill) && /STAGE_LENGTH_HOLD/.test(bill), bill);
  const psrv = SRV && !SRV.error ? SRV : { dir: "\u0000", urlSecs: NaN, maxAgeMs: NaN, sttMax: NaN, promptCap: NaN, appMax: NaN, promptLimits: {} };
  ok("P5 …and the snapshots: the changeable sources (film storage, stage: uploads, data URLs' bytes) copied by image-proxy with the service role to SNAPSHOT_DIR (video-snapshots.mjs), closed to every signed-in user (the storage test), the provider gets a signed URL of the copy, a failed copy = the maximum, cleanup at settle / release plus leftovers after SNAPSHOT_MAX_AGE_MS, never under a user's folder",
    bill.includes("**Snapshots:** a length-billed video the account could still change after the read (the film's storage, a `stage:` upload; a data URL's bytes too) is copied / uploaded by `image-proxy` (service role) at submit to `" + psrv.dir + "/<ms>-<hold id>-<n>.<ext>` (`video-snapshots.mjs`), a key no Storage rule lets a signed-in user write, update, delete or list (`scripts/test-storage-billing-snapshots.mjs`, every production rule set)") &&
    bill.includes(`hands the provider a ${psrv.urlSecs / 3600} h signed URL of the copy (a failed copy → unread → the maximum)`) &&
    bill.includes(`Deleted when the hold settles or is released (poll or reconcile); the reconcile op removes leftovers older than ${psrv.maxAgeMs / 86400000} days (best effort).`) &&
    bill.includes("Never move snapshots under a folder that starts with a user's id: `storage.sql`'s owner-only rules would open them."), bill);
  ok("P6 …and speech-to-text (container duration; a longer provider duration only logged, never word timestamps, an empty transcript still settles, 400 for an unreadable container / above STT_MAX_SECONDS / an unknown modelId, the app falls back to the browser) and the image prompt limits per engine (IMAGE_PROMPT_LIMITS, the ceiling IMAGE_PROMPT_MAX_CHARS — owner 2026-10-14)",
    bill.includes("**Speech-to-text:** held and settled on the recording's own duration read from its container (WebM/Matroska, Ogg, MP4/MOV, WAV), never word timestamps; a longer provider-reported duration is only logged (`stt_length_mismatch`), never charged above the hold; an empty transcript still settles.") &&
    bill.includes(`a recording above ${psrv.sttMax / 60} min (\`STT_MAX_SECONDS\`; the app stops at ${psrv.appMax / 60}, \`NS_MAX_ANSWER_SECONDS\`) or an unknown \`modelId\` gets a 400 before any hold, and the app then switches to the browser's speech recognition.`) &&
    // (2026-10-14, owner — commit aa4441b) a limit per engine, read from the server's own table
    psrv.promptLimits["gpt-image-2.5-flare"] === psrv.promptLimits["gpt-image-2.5-sunburst"]
      && psrv.promptLimits["gemini-nano-banana-2.1"] === psrv.promptCap &&
    bill.includes(`**Image prompts** have a limit per engine (\`billing-pricing.mjs\` \`IMAGE_PROMPT_LIMITS\` = \`app/pricing.jsx\` \`TURN_IMAGE_PROMPT_LIMITS\`, owner 2026-10-14): GPT Image 2.5 Flare / Sunburst ${thousands(psrv.promptLimits["gpt-image-2.5-flare"])} (fal takes 32,000), Seedream 5 Pro ${thousands(psrv.promptLimits["seedream-5-pro"])}, Nano Banana 2.1 and any other engine ${thousands(psrv.promptCap)} (\`IMAGE_PROMPT_MAX_CHARS\`, the ceiling). A longer prompt gets a 400 \`prompt_too_long\` before the hold; the app's builders fit themselves and \`proxyGenerate\` trims what's left in a fixed order (\`imagegen.jsx\` \`nbFitImagePrompt\`) — users are never asked to shorten a prompt.`), bill);
}

/* ============================== S. the section filter ============================== */
// Runs this file again as a child with TEST_SECTIONS set. The child never runs S itself (the
// env mark below), so even a broken filter can't make it spawn another copy; SIGKILL on the
// time limit leaves nothing running.
if (part("S", "S. the section filter (TEST_SECTIONS)") && !process.env.TEST_BILLING_DB_CHILD) {
  const self = fileURLToPath(import.meta.url);   // this very file (a scratch copy tests itself, not the repo's)
  const child = (sections) => {
    const r = spawnSync(process.execPath, [self], { env: { ...process.env, TEST_SECTIONS: sections, TEST_BILLING_DB_CHILD: "1" },
      encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
    const out = r.stdout || "";
    const total = out.match(/^(\d+) passed, (\d+) failed$/m);
    return { status: r.status, error: r.error?.code, out, heads: out.match(/^=== .*? ===$/gm) || [],
      passed: total ? Number(total[1]) : null, failed: total ? Number(total[2]) : null };
  };
  const lp = child(" p , l ");
  ok("S1 TEST_SECTIONS=\" p , l \" runs sections L and P only, in file order, and exits 0 (any case, spaces ignored)",
    lp.status === 0 && lp.heads.length === 2 && /^=== L\. /.test(lp.heads[0]) && /^=== P\. /.test(lp.heads[1]) && lp.failed === 0,
    { status: lp.status, error: lp.error, heads: lp.heads, tail: lp.out.slice(-300) });
  // the whole of each selected section runs: the same number of tests as this run's L and P (when it ran them)
  const want = RUN("L") && RUN("P") ? (perSection.L || 0) + (perSection.P || 0) : null;
  ok("S2 …with every test of those sections (the full run's L + P count), and nothing from the others",
    lp.passed != null && lp.passed > 0 && (want == null || lp.passed === want) &&
    (lp.out.match(/^(PASS|FAIL) /gm) || []).length === lp.passed + lp.failed &&
    (lp.out.match(/^(PASS|FAIL) (\S+)/gm) || []).every((l) => /^(PASS|FAIL) [LP]\d/.test(l)), { passed: lp.passed, want });
  const typo = child("L,Q,jj");
  ok("S3 an unknown letter fails the run at once, names it and runs nothing (exit 1, no section, no database)",
    typo.status === 1 && /^FAIL TEST_SECTIONS: unknown section "Q", "JJ"/m.test(typo.out) && typo.heads.length === 0 && !/^PASS /m.test(typo.out),
    { status: typo.status, error: typo.error, out: typo.out.slice(0, 300) });
}

if (SECTIONS.length) console.log(`\n(TEST_SECTIONS=${SECTIONS.join(",")}: only those sections ran; unset it for the full run)`);
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);

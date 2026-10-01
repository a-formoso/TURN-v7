#!/usr/bin/env node
/* ============================================================================
   Tax & compliance records — the REAL supabase/tax-compliance.sql (and the
   partial-refund argument of turn_revoke_charge_once in billing-v2.sql / credits.sql)
   EXECUTED on an in-memory Postgres (PGlite) with the Supabase stub from
   scripts/test-series-production-sql.mjs (anon / authenticated / service_role,
   Supabase's default privileges, auth.users / uid() / jwt()).

   "Production today" = credits.sql of commit 1aaf9ad + the Blender Studio settle
   migration + billing-v2.sql as run on day 0 (commit fea405e). The owner then
   re-runs today's billing-v2.sql and runs tax-compliance.sql.

     A  install: preflight (billing v2 first, nothing changed), RESULT all ok, the
        FAIL row until billing-v2.sql is re-run, re-run safe and changes no data
     B  privileges: the server function is service-role only (second lock too), the
        consent and summary functions signed-in only (never anon), helpers and
        tables unreachable, sequences closed
     C  turn_record_sale_once: once per source key, normalisation, refusals
     D  turn_admin_tax_summary: admin only (non-admin, anon, service role refused;
        the SQL editor allowed), the rolling 12-month window, refunds net off, the
        UK / EU / US / rest / unknown buckets, other currencies, the statuses at
        their exact thresholds, the thresholds in ONE place, totals only
     E  turn_record_checkout_consent: the caller's own row, refusals, the daily cap
     E2 turn_dispute_hold (review fix): one call under the account lock — disputes opened at the
        same moment are all kept, the first to close keeps the account held, an earlier hold
        survives, a hold that isn't this dispute's is left alone, refusals
     F  refund_fraction: one signature, the old two-argument call, partial refunds of
        pack lots and plan grants (rounding up, float noise, caps, open holds — released
        AND settled at a cost above zero (review fix: the refunded part is taken out of the
        hold) —, an earlier period, a full refund after a partial one), refusals before the
        event is claimed, once per event
     G  fresh install: the shared block is byte-identical in credits.sql, credits.sql
        alone = the upgrade path for every tax object, safe to re-run
     H  README and the runbook

   OFFLINE ONLY: no network, no Supabase project, no credentials.
     node scripts/test-tax-compliance-db.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
const TAX = read("supabase/tax-compliance.sql");
const V2 = read("supabase/billing-v2.sql");
const CREDITS = read("supabase/credits.sql");
const STUDIO = read("supabase/studio-credit-settlement-migration.sql");
const README = read("supabase/README.md");
const RUNBOOK = read("docs/Billing Rollout Runbook.md");
const git = (rev) => { try { return execSync(`git show ${rev}`, { cwd: new URL(ROOT).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (_e) { return null; } };
const OLD_CREDITS = git("1aaf9ad:supabase/credits.sql");
const DAY0_V2 = git("fea405e:supabase/billing-v2.sql");

let passes = 0, failures = 0;
const safe = (v) => { try { return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)); } catch (_e) { return String(v); } };
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + safe(detail))); }
};
const section = (t) => console.log("\n=== " + t + " ===");
/* jsonb stores object keys in its own order: compare with sorted keys */
const norm = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const ADMIN = { id: "20000000-0000-0000-0000-0000000000ad", email: "admin@infinitestudioai.com" };
const ADMIN_CASE = { id: ADMIN.id, email: "Admin@InfiniteStudioAI.com" };
const U = {
  W: { id: "20000000-0000-0000-0000-000000000001", email: "writer@example.com" },
  P: { id: "20000000-0000-0000-0000-000000000002", email: "packer@example.com" },
  H: { id: "20000000-0000-0000-0000-000000000003", email: "holder@example.com" },
  G: { id: "20000000-0000-0000-0000-000000000004", email: "grant@example.com" },
  K: { id: "20000000-0000-0000-0000-000000000005", email: "kinolot-fan@example.com" },
  FAKE: { id: "20000000-0000-0000-0000-000000000006", email: "admin@infinitestudioai.com.evil.example" },
};
async function newDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const u of [ADMIN, ...Object.values(U)]) {
    await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now() - interval '1 day')", [u.id, u.email]);
  }
  return db;
}
const lastRows = (res) => { for (let i = res.length - 1; i >= 0; i--) if (res[i].rows && res[i].rows.length) return res[i].rows; return []; };
async function runFile(db, sql) {
  try { const res = await db.exec(sql); return { ok: true, rows: lastRows(res) }; }
  catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, error: e.message }; }
}
/* one PostgREST-like request: a transaction as one caller ("editor" = the SQL editor, no JWT) */
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
const allOk = (rows) => rows.length > 0 && rows.every((r) => r.status === "ok");
const bad = (rows) => rows.filter((r) => r.status !== "ok");
const days = (d) => new Date(Date.now() - d * 86400000).toISOString();
const future = (d) => new Date(Date.now() + d * 86400000).toISOString();
async function snapshot(db) {
  const out = {};
  for (const t of ["turn_sales_ledger", "turn_checkout_consents", "turn_credits", "turn_credit_lots", "turn_plan_grants", "turn_stripe_events"]) {
    out[t] = await q(db, `select to_jsonb(x) - 'processed_at' as j from public.${t} x order by to_jsonb(x)::text`);
  }
  return safe(out);
}
const region = (text, name) => {
  const a = text.indexOf(`-- >>> ${name} >>>`);
  const m = `-- <<< ${name} <<<`;
  const b = text.indexOf(m);
  return a >= 0 && b > a ? text.slice(a, b + m.length) : null;
};
const TAX_BLOCK = "KINOLOT TAX COMPLIANCE DEFINITIONS";

/* production today, then today's billing-v2.sql re-run (+ tax-compliance.sql) */
async function productionDb() {
  const db = await newDb();
  await db.exec(OLD_CREDITS);
  await db.exec(STUDIO);
  const r = await runFile(db, DAY0_V2);
  if (!r.ok) throw new Error("day-0 billing-v2.sql failed: " + r.error);
  return db;
}
async function installedDb() {
  const db = await productionDb();
  for (const [f, sql] of [["billing-v2.sql", V2], ["tax-compliance.sql", TAX]]) {
    const r = await runFile(db, sql);
    if (!r.ok) throw new Error(f + " failed: " + r.error);
  }
  return db;
}
async function freshDb() {
  const db = await newDb();
  const r = await runFile(db, CREDITS);
  if (!r.ok) throw new Error("credits.sql failed: " + r.error);
  return db;
}
const record = (db, a) => as(db, "service", `select public.turn_record_sale_once(
    source_key => $1, app => $2, owner => $3, kind => $4, amount_cents => $5, currency => $6, country => $7,
    region => $8, country_source => $9, occurred_at => $10, stripe_ids => $11::jsonb) as v`,
  [a.key, a.app ?? "kinolot", a.owner ?? null, a.kind ?? "plan", a.cents, a.cur ?? "usd", a.country ?? null,
    a.region ?? null, a.src ?? "invoice.customer_address", a.at ?? null, a.ids === undefined ? "{}" : a.ids]);
const summary = (db, who, rate) => as(db, who, rate === undefined ? "select public.turn_admin_tax_summary() as s"
  : "select public.turn_admin_tax_summary($1) as s", rate === undefined ? [] : [rate]);

if (!STUB) { console.log("FAIL the Supabase stub was not found in test-series-production-sql.mjs"); process.exit(1); }
if (!OLD_CREDITS || !DAY0_V2) { console.log("FAIL git history for 1aaf9ad / fea405e is needed (production today)"); process.exit(1); }

/* ================================ A. install ================================ */
section("A. install on production (after billing-v2.sql)");
{
  // tax-compliance.sql before billing v2: refused, nothing changed
  const bare = await newDb();
  await bare.exec(OLD_CREDITS);
  const early = await runFile(bare, TAX);
  ok("A1 before billing-v2.sql: refused with the file to run first, nothing changed", !early.ok && /run supabase\/billing-v2\.sql first/.test(early.error) &&
    (await q(bare, "select to_regclass('public.turn_sales_ledger') is null as x"))[0].x, early);

  // on the day-0 database, BEFORE the billing-v2.sql re-run: installs, but row 80 says FAIL
  const db = await productionDb();
  const before = await runFile(db, TAX);
  const r80 = (before.rows || []).find((r) => r.item === "Partial refunds (billing-v2.sql re-run)");
  ok("A2 on the day-0 database without the re-run: it runs, and the partial-refund row says FAIL with what to do",
    before.ok && r80 && /^FAIL — run supabase\/billing-v2\.sql again \(safe\), then this file again$/.test(r80.status) &&
    bad(before.rows).length === 1, before.error || before.rows);
  const v2 = await runFile(db, V2);
  ok("A3 the billing-v2.sql re-run: RESULT all ok", v2.ok && allOk(v2.rows), v2.error || bad(v2.rows || []));
  const after = await runFile(db, TAX);
  ok("A4 then tax-compliance.sql: every RESULT row reads ok", after.ok && allOk(after.rows), after.error || bad(after.rows || []));
  ok("A5 …in its 10 rows, in order", (after.rows || []).length === 10 && safe(after.rows.map((r) => r.item)) === safe([
    "Sales ledger and consent tables, row-level security on", "Every function present", "Owner-rights functions pin search_path",
    "Recording a sale: service role only", "Consent and the tax summary: signed-in users only (never the anon key)",
    "Helpers: no API role", "Tables: no reads or writes through the API", "Partial refunds (billing-v2.sql re-run)",
    "Sales recorded so far", "Tax thresholds"]), (after.rows || []).map((r) => r.item));
  ok("A6 the empty ledger is said plainly; the thresholds row names GBP 90,000, USD 100,000 / 200 and the date",
    /none yet: stripe-webhook records every payment and refund once it is deployed/.test(after.rows[8].detail) &&
    /UK GBP 90,000 in any 12 months; EU from the first sale; US USD 100,000 or 200 sales a state \(conservative\); last checked 2026-10-01\. Check with an accountant\./.test(after.rows[9].detail),
    after.rows.slice(8));
  await record(db, { key: "invoice:in_a1", cents: 1900, country: "GB" });
  await as(db, U.W, "select public.turn_record_checkout_consent('plan:writer', 'start-now-v1')");
  const snap = await snapshot(db);
  const again = await runFile(db, TAX);
  ok("A7 a re-run: RESULT all ok and no data changes", again.ok && allOk(again.rows) && snap === await snapshot(db), again.error || bad(again.rows || []));
  ok("A8 the ledger row is counted in RESULT", /^1 rows \(1 Kinolot\) since \d{4}-\d{2}-\d{2}$/.test(again.rows[8].detail), again.rows[8]);
  ok("A9 one transaction (begin / commit), RESULT after the commit", /^begin;$/m.test(TAX) && /^commit;$/m.test(TAX) &&
    TAX.indexOf("\ncommit;") < TAX.indexOf("-- ── RESULT"));
  const leak = await (async () => {
    await db.exec("grant execute on function public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb) to authenticated");
    const res = await runFile(db, TAX.slice(TAX.indexOf("-- ── RESULT")));
    const fixed = await runFile(db, TAX);
    return { res, fixed };
  })();
  ok("A10 the RESULT flags a leaked grant, and a re-run closes it",
    leak.res.ok && leak.res.rows.find((r) => r.item === "Recording a sale: service role only")?.status.startsWith("FAIL") &&
    leak.fixed.ok && allOk(leak.fixed.rows), leak);
}

/* ================================ B. privileges ================================ */
section("B. privileges");
{
  const db = await installedDb();
  const fns = await q(db, `select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, p.provolatile,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') authed,
      has_function_privilege('service_role', p.oid, 'EXECUTE') svc, has_function_privilege('public', p.oid, 'EXECUTE') pub,
      pg_get_function_result(p.oid) as result
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and (p.proname like 'turn\\_\\_tax%' or p.proname in ('turn_record_sale_once', 'turn_record_checkout_consent', 'turn_admin_tax_summary'))`);
  const by = Object.fromEntries(fns.map((f) => [f.sig.replace(/^public\./, ""), f]));
  const SALE = "turn_record_sale_once(text,text,uuid,text,bigint,text,text,text,text,timestamp with time zone,jsonb)";
  const CONSENT = "turn_record_checkout_consent(text,text)";
  const SUMMARY = "turn_admin_tax_summary(numeric)";
  ok("B1 the three contract functions exist with the exact argument lists and return types",
    by[SALE]?.result === "boolean" && by[CONSENT]?.result === "void" && by[SUMMARY]?.result === "jsonb", Object.keys(by));
  ok("B2 turn_record_sale_once: service role only", by[SALE] && by[SALE].svc && !by[SALE].anon && !by[SALE].authed && !by[SALE].pub, by[SALE]);
  ok("B3 consent and summary: signed-in users, never anon or public", [CONSENT, SUMMARY].every((s) => by[s] && by[s].authed && !by[s].anon && !by[s].pub));
  ok("B4 all three are SECURITY DEFINER with a pinned search_path", [SALE, CONSENT, SUMMARY].every((s) => by[s]?.prosecdef && (by[s].proconfig || []).some((c) => /^search_path=$|^search_path=""$/.test(c))),
    [SALE, CONSENT, SUMMARY].map((s) => by[s]?.proconfig));
  ok("B4b the summary is read-only (STABLE), so the Data API may run it in a read-only transaction", by[SUMMARY]?.provolatile === "s", by[SUMMARY]?.provolatile);
  const helpers = Object.keys(by).filter((s) => s.startsWith("turn__tax"));
  ok("B5 the turn__tax_* helpers: caller's rights, pinned search_path, no API role at all", helpers.length === 5 &&
    helpers.every((s) => !by[s].prosecdef && (by[s].proconfig || []).some((c) => /^search_path=/.test(c)) && !by[s].anon && !by[s].authed && !by[s].svc && !by[s].pub), helpers.map((s) => by[s]));
  let r = await record(db, { key: "invoice:x" }).then(() => as(db, U.W, "select public.turn_record_sale_once('invoice:evil', 'kinolot', null, 'plan', 1, 'usd', 'GB', null, null, null, '{}')"));
  ok("B6 a signed-in user cannot record a sale", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, "anon", "select public.turn_record_sale_once('invoice:evil', 'kinolot', null, 'plan', 1, 'usd', 'GB', null, null, null, '{}')");
  ok("B7 …nor the anon key", !r.ok && /permission denied/i.test(r.error), r);
  await db.exec("grant execute on function public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb) to authenticated");
  r = await as(db, U.W, "select public.turn_record_sale_once('invoice:evil', 'kinolot', null, 'plan', 1, 'usd', 'GB', null, null, null, '{}')");
  ok("B8 the second lock: a mistaken grant still refuses a signed-in caller (service role only)", !r.ok && /service role only/.test(r.error), r);
  await db.exec("revoke execute on function public.turn_record_sale_once(text, text, uuid, text, bigint, text, text, text, text, timestamptz, jsonb) from authenticated");
  r = await as(db, "anon", "select public.turn_record_checkout_consent('plan:writer', 'v1')");
  ok("B9 the anon key cannot record a consent", !r.ok && /permission denied/i.test(r.error), r);
  r = await as(db, "anon", "select public.turn_admin_tax_summary()");
  ok("B10 the anon key cannot read the tax summary", !r.ok && /permission denied/i.test(r.error), r);
  for (const t of ["turn_sales_ledger", "turn_checkout_consents"]) {
    r = await as(db, U.W, `select count(*) from public.${t}`);
    const r2 = await as(db, ADMIN, `select count(*) from public.${t}`);
    const r3 = await as(db, U.W, t === "turn_sales_ledger"
      ? "insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, occurred_at) values ('x', 'kinolot', 'plan', 1, 'usd', now())"
      : "insert into public.turn_checkout_consents(owner, sku, consent_version) values ($1, 'x', 'y')", t === "turn_sales_ledger" ? [] : [U.W.id]);
    ok(`B11 ${t}: no signed-in user (not even the admin) reads or writes it directly`, !r.ok && /permission denied/i.test(r.error) &&
      !r2.ok && /permission denied/i.test(r2.error) && !r3.ok && /permission denied/i.test(r3.error), [r, r2, r3]);
  }
  const seq = await q(db, `select c.relname, has_sequence_privilege('anon', c.oid, 'USAGE') anon, has_sequence_privilege('authenticated', c.oid, 'USAGE') authed
      from pg_class c where c.relkind = 'S' and c.relname in ('turn_sales_ledger_id_seq', 'turn_checkout_consents_id_seq')`);
  ok("B12 their id sequences are closed to anon and signed-in users", seq.length === 2 && seq.every((s) => !s.anon && !s.authed), seq);
  const rls = await q(db, "select relname, relrowsecurity from pg_class where relname in ('turn_sales_ledger', 'turn_checkout_consents')");
  ok("B13 row-level security on both tables", rls.length === 2 && rls.every((x) => x.relrowsecurity), rls);
  const fk = await q(db, `select conname from pg_constraint where contype = 'f' and conrelid in ('public.turn_sales_ledger'::regclass, 'public.turn_checkout_consents'::regclass)`);
  ok("B14 no foreign key to auth.users: tax and consent records outlive a deleted account", fk.length === 0, fk);
}

/* ================================ C. recording a sale ================================ */
section("C. turn_record_sale_once");
{
  const db = await installedDb();
  let r = await record(db, { key: "invoice:in_1", owner: U.W.id, kind: "plan", cents: 1900, country: "gb", region: " eng ",
    src: "invoice.customer_address", at: days(3), ids: '{"invoice": "in_1", "customer": "cus_1"}' });
  const row = async (key) => (await q(db, "select app, owner, kind, amount_cents, currency, country, region, country_source, occurred_at, stripe_ids from public.turn_sales_ledger where source_key = $1", [key]))[0];
  let x = await row("invoice:in_1");
  ok("C1 a payment is recorded once (true) with country upper-cased and the region trimmed and upper-cased",
    r.ok && r.row.v === true && x && x.app === "kinolot" && x.owner === U.W.id && x.kind === "plan" && n(x.amount_cents) === 1900 &&
    x.currency === "usd" && x.country === "GB" && x.region === "ENG" && x.country_source === "invoice.customer_address" &&
    x.stripe_ids.invoice === "in_1", { r, x });
  r = await record(db, { key: "invoice:in_1", cents: 999999, country: "US" });
  x = await row("invoice:in_1");
  ok("C2 the same source key again: false, nothing changes (a resent Stripe event)", r.ok && r.row.v === false && n(x.amount_cents) === 1900 && x.country === "GB", { r, x });
  r = await record(db, { key: "refund:re_1", kind: "refund", cents: 500, country: "GB", src: "charge.billing_details" });
  x = await row("refund:re_1");
  ok("C3 a refund is always stored negative (500 -> -500)", r.ok && r.row.v === true && n(x.amount_cents) === -500, x);
  r = await record(db, { key: "refund:re_2", kind: "refund", cents: -700, country: "GB" });
  ok("C4 …and a refund already negative stays so", r.ok && n((await row("refund:re_2")).amount_cents) === -700);
  r = await record(db, { key: "checkout:cs_1", kind: "pack", cents: -100 });
  ok("C5 a negative amount for anything but a refund is refused (22023), nothing stored", !r.ok && r.code === "22023" && !(await row("checkout:cs_1")), r);
  r = await record(db, { key: "checkout:cs_2", kind: "gift", cents: 100 });
  ok("C6 an unknown kind is refused", !r.ok && r.code === "22023", r);
  r = await record(db, { key: "  ", cents: 100 });
  ok("C7 a missing source key is refused", !r.ok && r.code === "22023", r);
  r = await record(db, { key: "checkout:cs_3", cents: 100, cur: "US$" });
  ok("C8 a currency that isn't a three-letter code is refused", !r.ok && r.code === "22023", r);
  r = await record(db, { key: "checkout:cs_4", app: "The Inner Circle!", cents: 100 });
  ok("C9 an app that isn't a short name is refused", !r.ok && r.code === "22023", r);
  r = await record(db, { key: "checkout:cs_5", app: "Other", kind: "OTHER", cents: 4900, cur: "GBP", country: "United Kingdom", ids: "[1, 2]" });
  x = await row("checkout:cs_5");
  ok("C10 normalised: app and kind lower-case, currency lower-case; a country that isn't two letters is stored as no country (raw kept), a non-object stripe_ids wrapped",
    r.ok && x.app === "other" && x.kind === "other" && x.currency === "gbp" && x.country === null &&
    x.stripe_ids.country_raw === "United Kingdom" && safe(x.stripe_ids.value) === "[1,2]", x);
  r = await record(db, { key: "checkout:cs_6", kind: "pack", cents: 1000, at: null, ids: null });
  x = await row("checkout:cs_6");
  ok("C11 no occurred_at = now; no stripe_ids = {}", r.ok && Math.abs(new Date(x.occurred_at) - Date.now()) < 60000 && safe(x.stripe_ids) === "{}", x);
  r = await record(db, { key: "checkout:cs_7", kind: "pack", cents: 0, country: "" });
  ok("C12 a zero payment and an empty country are accepted (no country)", r.ok && (await row("checkout:cs_7")).country === null, r);
  const direct = await as(db, "editor", "select public.turn_record_sale_once('manual:2026-09-other', 'other', null, 'other', 123400, 'gbp', 'GB', null, 'manual', '2026-09-30', '{}') as v");
  ok("C13 the SQL editor (no JWT) may record a sale by hand (the runbook's backfill)", direct.ok && direct.row.v === true, direct);
  const ins = await as(db, "editor", "insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, occurred_at) values ('bad:1', 'kinolot', 'refund', 100, 'usd', now())");
  ok("C14 the table itself refuses a positive refund (constraint)", !ins.ok && /sign_check/.test(ins.error), ins);
}

/* ================================ D. the tax summary ================================ */
section("D. turn_admin_tax_summary");
{
  const db = await installedDb();
  let r = await summary(db, U.W);
  ok("D1 a signed-in user who isn't the admin is refused (42501)", !r.ok && r.code === "42501" && /admin only/.test(r.error), r);
  r = await summary(db, U.FAKE);
  ok("D2 …an email that only starts like the admin's is refused", !r.ok && r.code === "42501", r);
  r = await summary(db, "service");
  ok("D3 …the service role (no email) has no access", !r.ok, r);
  r = await summary(db, ADMIN);
  const empty = r.row?.s;
  ok("D4 the admin reads it; an empty ledger reads all zeros, EU 'watch' (register before the first sale), UK 'ok'",
    r.ok && empty.uk.gbp_12m_est === 0 && empty.uk.status === "ok" && empty.eu.status === "watch" && empty.eu.first_sale_at === null &&
    empty.eu.sales_12m === 0 && safe(empty.us.by_state) === "[]" && empty.unknown.sales === 0 && empty.ledger.rows === 0, r);
  ok("D5 the thresholds come back with the summary: GBP 90,000, USD 100,000, 200 sales, checked 2026-10-01; the rate used is returned",
    empty && empty.thresholds.uk_gbp === 90000 && empty.thresholds.us_usd === 100000 && empty.thresholds.us_tx === 200 &&
    empty.thresholds.checked === "2026-10-01" && empty.thresholds.uk_watch_pct === 75 && empty.thresholds.uk_near_pct === 90 &&
    empty.thresholds.us_near_pct === 80 && Number(empty.usd_to_gbp) === 0.8, empty && empty.thresholds);
  r = await summary(db, ADMIN_CASE);
  ok("D6 the admin's email is compared case-insensitively", r.ok, r);
  r = await summary(db, "editor");
  ok("D7 the SQL editor (no JWT) may read it", r.ok, r);
  for (const bad of [0, -1, 11]) {
    r = await summary(db, ADMIN, bad);
    ok(`D8 usd_to_gbp ${bad} is refused (22023)`, !r.ok && r.code === "22023", r);
  }
  r = await as(db, ADMIN, "select public.turn_admin_tax_summary(null) as s");
  ok("D9 usd_to_gbp null = the default 0.80", r.ok && Number(r.row.s.usd_to_gbp) === 0.8, r);

  // the ledger: UK, EU, US, rest of the world, no country, another currency, out of the window
  const S = [
    { key: "invoice:uk1", cents: 100000, country: "GB", at: days(10) },                       // $1,000
    { key: "checkout:uk2", kind: "pack", cents: 50000, cur: "gbp", country: "GB", at: days(40) },// £500
    { key: "invoice:im1", cents: 10000, country: "IM", at: days(5) },                          // $100 (Isle of Man: UK VAT area)
    { key: "refund:uk3", kind: "refund", cents: 20000, country: "GB", at: days(2) },           // -$200
    { key: "invoice:uk-old", cents: 500000, country: "GB", at: days(375) },                    // 12 months + 10 days ago: out
    { key: "invoice:de1", cents: 4900, country: "DE", at: days(20) },
    { key: "invoice:fr1", cents: 1900, country: "FR", at: days(21) },
    { key: "invoice:gr1", cents: 1900, country: "GR", at: days(22) },
    { key: "invoice:de-old", cents: 1900, country: "DE", at: days(400) },                      // the first EU sale ever, out of the window
    { key: "invoice:ca1", cents: 2500000, country: "US", region: "CA", at: days(30) },          // $25,000
    { key: "refund:ca2", kind: "refund", cents: 500000, country: "US", region: "CA", at: days(29) }, // -$5,000
    { key: "invoice:no1", cents: 1000, country: "NO", at: days(9) },
    { key: "invoice:jp1", app: "other", kind: "other", cents: 3000, cur: "jpy", country: "JP", at: days(8) }, // ¥3,000: not converted
    { key: "invoice:x1", cents: 4900, country: null, src: null, at: days(1) },
    { key: "invoice:x2", app: "other", kind: "other", cents: 2000, country: null, src: null, at: days(1) },
  ];
  for (const s of S) { const res = await record(db, s); if (!res.ok) ok("D seed " + s.key, false, res); }
  r = await summary(db, ADMIN);
  const s = r.row?.s;
  // UK at 0.80: ($1,000 + $100 - $200) x 0.8 + £500 = £1,220; USD = $900 + £500 / 0.8 = $1,525
  ok("D10 UK = GB + IM in the last 12 months, refunds netted, GBP at the rate: £1,220.00 ($1,525.00), 1.4 %, ok",
    s && s.uk.gbp_12m_est === 1220 && s.uk.usd_12m === 1525 && s.uk.pct === 1.4 && s.uk.status === "ok" && s.uk.sales_12m === 3, s && s.uk);
  ok("D11 UK: the last 30 days (£800 + £80 - £160 = £720), and the no-country payments ($69 = £55.20) as a conservative add-on",
    s && s.uk.gbp_30d_est === 720 && s.uk.unknown_gbp_est === Math.round((49 + 20) * 0.8 * 100) / 100 && s.uk.pct_with_unknown === 1.4, s && s.uk);
  r = await summary(db, ADMIN, 0.9);
  ok("D12 another rate changes the GBP figure (0.90: ($900) x 0.9 + £500 = £1,310)", r.ok && r.row.s.uk.gbp_12m_est === 1310 && Number(r.row.s.usd_to_gbp) === 0.9, r.row?.s?.uk);
  ok("D13 EU: 3 sales in the window ($87.00), by country (DE first), first_sale_at = the first EU sale EVER, status over",
    s && s.eu.sales_12m === 3 && s.eu.usd_12m === 87 && s.eu.status === "over" &&
    norm(s.eu.by_country) === norm([{ country: "DE", sales: 1, usd: 49 }, { country: "FR", sales: 1, usd: 19 }, { country: "GR", sales: 1, usd: 19 }]) &&
    Math.abs(new Date(s.eu.first_sale_at) - new Date(days(400))) < 60000, s && s.eu);
  ok("D14 US: per state, refunds net off the dollars but not the count: CA $20,000 (20 %), 1 sale (0.5 %), ok",
    s && s.us.usd_12m === 20000 && s.us.sales_12m === 1 &&
    norm(s.us.by_state) === norm([{ state: "CA", sales: 1, usd: 20000, pct_usd: 20, pct_tx: 0.5, status: "ok" }]), s && s.us);
  ok("D15 the rest of the world (Norway; Japan's yen are not converted, so $0) is listed by country",
    s && s.rest.sales_12m === 2 && s.rest.usd_12m === 10 &&
    safe(s.rest.by_country.map((c) => c.country)) === safe(["NO", "JP"]), s && s.rest);
  ok("D16 no country: 2 payments, $69.00 (Kinolot and the other product)", s && s.unknown.sales === 2 && s.unknown.usd === 69, s && s.unknown);
  ok("D17 by app: kinolot and other, 12-month dollars", s && norm(s.by_app) === norm([{ app: "kinolot", usd_12m: 21671 }, { app: "other", usd_12m: 20 }]), s && s.by_app);
  ok("D18 other currencies are listed in Stripe's smallest unit and left out of every total", s &&
    norm(s.other_currencies) === norm([{ currency: "jpy", sales: 1, amount_minor: 3000 }]), s && s.other_currencies);
  ok("D19 the ledger's own reach: rows, the first sale, when recording began", s && s.ledger.rows === S.length &&
    Math.abs(new Date(s.ledger.first_sale_at) - new Date(days(400))) < 60000 && !!s.ledger.recording_since, s && s.ledger);
  const text = safe(s);
  ok("D20 only totals: no account id, email or Stripe id in the answer", s && !text.includes(U.W.id) && !/@/.test(text) && !/\b(in|cus|cs|re|ch|sub)_[A-Za-z0-9]/.test(text), text.slice(0, 200));
  ok("D21 the window is rolling: as_of now, window_from 12 months back", s && Math.abs(new Date(s.as_of) - Date.now()) < 60000 &&
    Math.abs(new Date(s.window_from) - new Date(new Date().setMonth(new Date().getMonth() - 12))) < 2 * 86400000, s && [s.as_of, s.window_from]);

  // the statuses, at their exact thresholds: UK $112,500 of sales; GBP = 112,500 x rate
  const st = await installedDb();
  await record(st, { key: "invoice:big", cents: 11250000, country: "GB", at: days(1) });
  const ukAt = async (rate) => (await summary(st, ADMIN, rate)).row.s.uk;
  const u1 = await ukAt(0.5), u2 = await ukAt(0.6), u3 = await ukAt(0.72), u4 = await ukAt(0.8), u5 = await ukAt(0.7);
  ok("D22 UK status: 62.5 % ok, exactly 75 % watch, 87.5 % watch, exactly 90 % near, exactly 100 % over",
    u1.pct === 62.5 && u1.status === "ok" && u2.pct === 75 && u2.status === "watch" && u5.status === "watch" &&
    u3.pct === 90 && u3.status === "near" && u4.pct === 100 && u4.status === "over" && u4.gbp_12m_est === 90000, [u1, u2, u5, u3, u4]);
  // US: TX 160 sales (80 % of 200) near; AZ 159 sales ok; NY $100,000 over; FL $80,000 near; WA 200 sales over; no state
  await st.exec(`
    insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, country, region, occurred_at)
      select 'tx:' || g, 'kinolot', 'pack', 1000, 'usd', 'US', 'TX', now() - interval '1 day' from generate_series(1, 160) g;
    insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, country, region, occurred_at)
      select 'az:' || g, 'kinolot', 'pack', 1000, 'usd', 'US', 'AZ', now() - interval '1 day' from generate_series(1, 159) g;
    insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, country, region, occurred_at)
      select 'wa:' || g, 'kinolot', 'pack', 100, 'usd', 'US', 'WA', now() - interval '1 day' from generate_series(1, 200) g;
    insert into public.turn_sales_ledger(source_key, app, kind, amount_cents, currency, country, region, occurred_at) values
      ('ny:1', 'kinolot', 'plan', 10000000, 'usd', 'US', 'NY', now() - interval '1 day'),
      ('fl:1', 'kinolot', 'plan', 8000000, 'usd', 'US', 'FL', now() - interval '1 day'),
      ('nv:1', 'kinolot', 'plan', 7900000, 'usd', 'US', 'NV', now() - interval '1 day'),
      ('us:none', 'kinolot', 'plan', 1000, 'usd', 'US', null, now() - interval '1 day'),
      ('tx:refund', 'kinolot', 'refund', -1000, 'usd', 'US', 'TX', now() - interval '1 day');`);
  const us = (await summary(st, ADMIN)).row.s.us.by_state;
  const stOf = (code) => us.find((x) => x.state === code);
  ok("D23 US status per state: 200 sales over, $100,000 over, 160 sales (80 %) near, $80,000 (80 %) near, 159 sales and $79,000 ok; a refund lowers the dollars, never the count",
    stOf("WA")?.status === "over" && stOf("WA").pct_tx === 100 && stOf("NY")?.status === "over" && stOf("NY").pct_usd === 100 &&
    stOf("TX")?.status === "near" && stOf("TX").sales === 160 && stOf("TX").usd === 1590 && stOf("FL")?.status === "near" &&
    stOf("AZ")?.status === "ok" && stOf("AZ").pct_tx === 79.5 && stOf("NV")?.status === "ok", us);
  ok("D24 US payments with no state are their own row (state null), listed after the states", us.at(-1)?.state === null && us.at(-1).sales === 1 &&
    safe(us.slice(0, 2).map((x) => x.state).sort()) === safe(["NY", "WA"]), us.map((x) => [x.state, x.status]));

  // the thresholds live in ONE place: the summary reads them from turn__tax_thresholds(), never a number of its own
  const block = region(TAX, TAX_BLOCK) || "";
  const fnOf = (name) => { const a = block.indexOf(`create or replace function public.${name}(`); return a < 0 ? "" : block.slice(a, block.indexOf("end $$;", a) > 0 && name !== "turn__tax_thresholds" ? block.indexOf("end $$;", a) : block.indexOf("$$;", block.indexOf("as $$", a) + 5) + 3); };
  const th = fnOf("turn__tax_thresholds");
  const body = fnOf("turn_admin_tax_summary").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").replace(/0\.80/g, "");
  ok("D25 the thresholds live in ONE place (turn__tax_thresholds, with its 'checked' date); the summary has none of its own numbers (90000, 100000, 200, 75, 90, 80)",
    /'uk_gbp', 90000/.test(th) && /'us_usd', 100000, 'us_tx', 200/.test(th) && /'uk_watch_pct', 75, 'uk_near_pct', 90/.test(th) &&
    /'us_near_pct', 80/.test(th) && /'checked', '2026-10-01'/.test(th) && body.length > 1000 &&
    !/\b(90000|100000|200|75|90|80)\b/.test(body) && /v_t ->> 'uk_gbp'/.test(body) && /v_t ->> 'us_tx'/.test(body),
    body.match(/.*\b(90000|100000|200|75|90|80)\b.*/g));
}

/* ================================ E. checkout consent ================================ */
section("E. turn_record_checkout_consent");
{
  const db = await installedDb();
  let r = await as(db, U.K, "select public.turn_record_checkout_consent(' plan:director ', 'start-now-2026-10-01')");
  const rows = await q(db, "select owner, sku, consent_version, created_at from public.turn_checkout_consents");
  ok("E1 the signed-in caller's consent is stored with THEIR id (trimmed), with the time", r.ok && rows.length === 1 && rows[0].owner === U.K.id &&
    rows[0].sku === "plan:director" && rows[0].consent_version === "start-now-2026-10-01" && Math.abs(new Date(rows[0].created_at) - Date.now()) < 60000, { r, rows });
  r = await as(db, "service", "select public.turn_record_checkout_consent('pack:250', 'v1')");
  ok("E2 a call with no signed-in user (the service role) is refused: sign in first", !r.ok && /sign in first/.test(r.error), r);
  r = await as(db, "editor", "select public.turn_record_checkout_consent('pack:250', 'v1')");
  ok("E3 …and so is the SQL editor (nobody to record it for)", !r.ok && /sign in first/.test(r.error), r);
  for (const [sku, ver, why] of [["", "v1", "an empty sku"], ["pack:250", "", "an empty version"], ["x".repeat(121), "v1", "a sku of 121 characters"],
    ["pack:250", "v".repeat(81), "a version of 81 characters"], ["pack\n250", "v1", "a control character"]]) {
    r = await as(db, U.K, "select public.turn_record_checkout_consent($1, $2)", [sku, ver]);
    ok(`E4 ${why} is refused (22023)`, !r.ok && r.code === "22023", r);
  }
  await db.exec(`insert into public.turn_checkout_consents(owner, sku, consent_version, created_at)
    select '${U.P.id}', 'pack:250', 'v1', now() - interval '1 hour' from generate_series(1, 200)`);
  r = await as(db, U.P, "select public.turn_record_checkout_consent('pack:250', 'v1')");
  const capped = (await q(db, "select count(*)::int as n from public.turn_checkout_consents where owner = $1", [U.P.id]))[0].n;
  await db.exec(`update public.turn_checkout_consents set created_at = now() - interval '2 days' where owner = '${U.P.id}'`);
  const r2 = await as(db, U.P, "select public.turn_record_checkout_consent('pack:250', 'v1')");
  const after = (await q(db, "select count(*)::int as n from public.turn_checkout_consents where owner = $1", [U.P.id]))[0].n;
  ok("E5 more than 200 in a day from one account are not stored (no error: the checkout still opens); the next day they are again",
    r.ok && capped === 200 && r2.ok && after === 201, { r, capped, r2, after });
}

/* ============================ E2. dispute holds (D4) ============================ */
section("E2. turn_dispute_hold (one call under the account lock)");
{
  const db = await installedDb();
  const hold = (uid, id, open, part) => as(db, "service", "select public.turn_dispute_hold($1, $2, $3, $4) as v", [uid, id, open, part ?? null]);
  const acct = async (who) => (await q(db, "select frozen, frozen_reason, frozen_at from public.turn_credits where owner = $1", [who.id]))[0];
  const sig = (await q(db, `select p.oid::regprocedure::text as sig, p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') authed, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
      has_function_privilege('public', p.oid, 'EXECUTE') pub from pg_proc p where p.proname = 'turn_dispute_hold'`));
  ok("E2-1 turn_dispute_hold(uuid, text, boolean, text): security definer, service role only", sig.length === 1 &&
    sig[0].sig === "turn_dispute_hold(uuid,text,boolean,text)" && sig[0].prosecdef && sig[0].svc && !sig[0].anon && !sig[0].authed && !sig[0].pub, sig);
  let r = await as(db, U.W, "select public.turn_dispute_hold($1, 'dp_x', true, null)", [U.W.id]);
  ok("E2-2 a signed-in user cannot call it", !r.ok && /permission denied/i.test(r.error), r);
  const A = "dispute dp_A (fraudulent) on charge ch_1", B = "dispute dp_B (general) on charge ch_2";
  r = await hold(U.W.id, "dp_A", true, A);
  let a = await acct(U.W);
  ok("E2-3 the first dispute freezes with its own part", r.ok && r.row.v.action === "frozen" && a.frozen && a.frozen_reason === A && !!a.frozen_at, { r, a });
  const firstAt = a.frozen_at;
  r = await hold(U.W.id, "dp_B", true, B);
  await hold(U.W.id, "dp_B", true, B);                                   // a resend
  a = await acct(U.W);
  ok("E2-4 a second dispute is listed next to it, once (a resend changes nothing); frozen_at stays the first hold's",
    a.frozen_reason === A + " | " + B && String(a.frozen_at) === String(firstAt), a);
  r = await hold(U.W.id, "dp_A", false, "dispute dp_A won");
  a = await acct(U.W);
  ok("E2-5 the first to close keeps the account held for the other (action kept)", r.ok && r.row.v.action === "kept" && a.frozen && a.frozen_reason === B, { r, a });
  r = await hold(U.W.id, "dp_B", false, "dispute dp_B lost");
  a = await acct(U.W);
  ok("E2-6 the last to close lifts the hold (action lifted, reason = how it closed, frozen_at cleared)",
    r.ok && r.row.v.action === "lifted" && !a.frozen && a.frozen_reason === "dispute dp_B lost" && a.frozen_at === null, { r, a });
  // two disputes opened in parallel transactions: both parts survive (the account lock serialises them)
  await svc(db, "select public.turn_dispute_hold($1, 'dp_C', true, 'dispute dp_C on charge ch_3')", [U.P.id]);
  await Promise.all([hold(U.P.id, "dp_D", true, "dispute dp_D on charge ch_4"), hold(U.P.id, "dp_E", true, "dispute dp_E on charge ch_5")]);
  a = await acct(U.P);
  ok("E2-7 disputes opened at the same moment are all listed", ["dp_C", "dp_D", "dp_E"].every((d) => a.frozen_reason.includes("dispute " + d + " ")), a);
  // a hold placed before the dispute survives it; a hold without a reason gets a marker
  for (const who of [U.G, U.K]) await db.query("insert into public.turn_credits(owner, remaining, plan_remaining, ledger_sync) values ($1, 0, 0, true) on conflict (owner) do nothing", [who.id]);
  await db.query("update public.turn_credits set frozen = true, frozen_reason = 'owner hold: chargeback abuse', frozen_at = now() where owner = $1", [U.G.id]);
  await hold(U.G.id, "dp_F", true, "dispute dp_F on charge ch_6");
  r = await hold(U.G.id, "dp_F", false, "dispute dp_F won");
  a = await acct(U.G);
  ok("E2-8 an earlier hold survives the dispute closing", r.row?.v.action === "kept" && a.frozen && a.frozen_reason === "owner hold: chargeback abuse", { r, a });
  r = await hold(U.G.id, "dp_Z", false, "dispute dp_Z won");
  a = await acct(U.G);
  ok("E2-9 held, but not by this dispute: nothing changes (action review)", r.row?.v.action === "review" && a.frozen && a.frozen_reason === "owner hold: chargeback abuse", { r, a });
  await db.query("update public.turn_credits set frozen = true, frozen_reason = null where owner = $1", [U.K.id]);
  await hold(U.K.id, "dp_G", true, "dispute dp_G on charge ch_7");
  a = await acct(U.K);
  ok("E2-10 a hold without a reason keeps a marker next to the dispute", a.frozen_reason === "earlier hold (no reason given) | dispute dp_G on charge ch_7", a);
  r = await hold(U.K.id, "dp_G1", false, "dispute dp_G1 won");
  ok("E2-11 a dispute id is matched whole (dp_G1 is not dp_G)", r.row?.v.action === "review", r);
  r = await hold(U.H.id, "dp_H", false, "dispute dp_H won");
  a = await acct(U.H);
  ok("E2-12 closing on an account that isn't held: lifted, nothing to lift", r.ok && r.row.v.action === "lifted" && !a.frozen, { r, a });
  for (const [id, why] of [["dp-1; drop", "a non-Stripe id"], ["", "an empty id"]]) {
    r = await hold(U.H.id, id, true, null);
    ok(`E2-13 ${why} is refused (22023)`, !r.ok && r.code === "22023", r);
  }
  r = await hold("20000000-0000-0000-0000-00000000dead", "dp_I", true, null);
  ok("E2-14 an unknown account is refused like every billing write (23503)", !r.ok && r.code === "23503", r);
  r = await hold(U.H.id, "dp_J", true, "dispute dp_J | sneaky");
  a = await acct(U.H);
  ok("E2-15 the separator inside a part is neutralised", a.frozen_reason === "dispute dp_J / sneaky", a);
}

/* ================================ F. partial refunds ================================ */
section("F. turn_revoke_charge_once(event_id, charge_id, refund_fraction default 1)");
{
  const db = await installedDb();
  const sigs = await q(db, "select p.oid::regprocedure::text as sig, pg_get_function_arguments(p.oid) as args, has_function_privilege('authenticated', p.oid, 'EXECUTE') authed, has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('service_role', p.oid, 'EXECUTE') svc from pg_proc p where p.proname = 'turn_revoke_charge_once'");
  ok("F1 ONE function: (text, text, numeric) with refund_fraction default 1; the two-argument one is gone (no ambiguous call)",
    sigs.length === 1 && sigs[0].sig === "turn_revoke_charge_once(text,text,numeric)" &&
    sigs[0].args === "event_id text, charge_id text, refund_fraction numeric DEFAULT 1", sigs);
  ok("F2 …service role only, as before", sigs[0]?.svc && !sigs[0].authed && !sigs[0].anon, sigs);
  const lot = async (key) => (await q(db, "select amount, remaining, revoked_amount, revoked_at from public.turn_credit_lots where event_id = $1", [key]))[0];
  const total = async (who) => n((await q(db, "select remaining from public.turn_credits where owner = $1", [who.id]))[0]?.remaining);
  const consistent = async () => (await q(db, `select count(*)::int as bad from public.turn_credits c
     where c.remaining is distinct from c.plan_remaining + coalesce((select sum(l.remaining) from public.turn_credit_lots l
       where l.owner = c.owner and l.remaining > 0 and l.expires_at > now()), 0)`))[0].bad === 0;
  const revoke = (ev, ch, f) => as(db, "service", f === undefined ? "select public.turn_revoke_charge_once(event_id => $1, charge_id => $2) as v"
    : "select public.turn_revoke_charge_once($1, $2, $3) as v", f === undefined ? [ev, ch] : [ev, ch, f]);

  // a pack of 1,000, 300 spent: 25 % refunded, then 50 %, then the rest
  await svc(db, "select public.turn_add_pack_once('checkout:cs_p1', $1, 1000, 'ch_p1')", [U.P.id]);
  await as(db, U.P, "select * from public.turn_spend_credit(300, 'sp-p1')");
  let r = await revoke("evt_pr_1", "ch_p1", 0.25);
  let l = await lot("checkout:cs_p1");
  ok("F3 a 25 % refund of a 1,000 pack removes 250 of the 700 unused; the lot stays open", r.ok && r.row.v === 250 && l.remaining === 450 &&
    l.revoked_amount === 250 && l.revoked_at === null && await total(U.P) === 450, { r, l });
  r = await revoke("evt_pr_1", "ch_p1", 0.25);
  ok("F4 once per event id", r.ok && r.row.v === 0 && (await lot("checkout:cs_p1")).remaining === 450, r);
  const res = (await q(db, "select result from public.turn_stripe_events where id = 'evt_pr_1'"))[0].result;
  ok("F5 the event records the fraction and what was removed", Number(res.fraction) === 0.25 && res.removed === 250 && res.lots === 1, res);
  r = await revoke("evt_pr_2", "ch_p1", 0.5);
  l = await lot("checkout:cs_p1");
  ok("F6 a further 50 % (500) is capped at what is still unused (450)", r.ok && r.row.v === 450 && l.remaining === 0 && l.revoked_amount === 700 && l.revoked_at === null, { r, l });
  r = await revoke("evt_pr_3", "ch_p1");
  l = await lot("checkout:cs_p1");
  ok("F7 then a full refund (the old two-argument call): nothing left to remove, the lot is closed", r.ok && r.row.v === 0 && !!l.revoked_at && l.revoked_amount === 700, { r, l });

  // rounding up, float noise, the cap at the amount
  await svc(db, "select public.turn_add_pack_once('checkout:cs_p2', $1, 250, 'ch_p2')", [U.P.id]);
  r = await revoke("evt_pr_4", "ch_p2", 0.333);
  ok("F8 rounded up: 33.3 % of 250 = 83.25 -> 84", r.ok && r.row.v === 84 && (await lot("checkout:cs_p2")).remaining === 166, r);
  await svc(db, "select public.turn_add_pack_once('checkout:cs_p3', $1, 9, 'ch_p3')", [U.P.id]);
  r = await revoke("evt_pr_5", "ch_p3", 0.5555555555555556);   // 5/9 as JavaScript sends it: x 9 = 5.0000000000000004
  ok("F9 float noise never rounds up a whole extra credit: 5/9 of 9 = 5, not 6", r.ok && r.row.v === 5, r);
  await svc(db, "select public.turn_add_pack_once('checkout:cs_p4', $1, 100, 'ch_p4')", [U.P.id]);
  r = await revoke("evt_pr_6", "ch_p4", 0.6);
  const r2 = await revoke("evt_pr_7", "ch_p4", 0.6);
  ok("F10 two 60 % refunds of an untouched 100 remove 60, then the 40 left (never more than the amount)", r.row?.v === 60 && r2.row?.v === 40 &&
    (await lot("checkout:cs_p4")).revoked_amount === 100, [r, r2]);

  // refusals: before the event is claimed, so a corrected retry applies
  for (const f of [0, -0.1, 1.5, null, "NaN"]) {
    r = await revoke("evt_pr_bad", "ch_p2", f);
    ok(`F11 refund_fraction ${f} is refused (22023)`, !r.ok && r.code === "22023" && /refund_fraction must be above 0 and at most 1/.test(r.error), r);
  }
  ok("F12 …and the refused event is not claimed", (await q(db, "select count(*)::int as n from public.turn_stripe_events where id = 'evt_pr_bad'"))[0].n === 0);
  r = await revoke("evt_pr_bad", "ch_p2", 0.1);
  ok("F13 the corrected retry applies (10 % of 250 = 25)", r.ok && r.row.v === 25, r);

  // a pack lot partly held by a running job
  await svc(db, "select public.turn_add_pack_once('checkout:cs_h1', $1, 100, 'ch_h1')", [U.H.id]);
  await svc(db, "select public.turn_hold_credits($1, 80, 'video:job-h1', 'video')", [U.H.id]);   // 80 of the lot held, 20 left
  r = await revoke("evt_ph_1", "ch_h1", 0.5);
  const holdRow = (await q(db, "select from_lots from public.turn_credit_holds where ref = 'video:job-h1'"))[0];
  const rel = await svc(db, "select public.turn_release_hold('video:job-h1')");
  l = await lot("checkout:cs_h1");
  ok("F14 50 % of a 100 pack with 80 held: 20 from what is left, 30 from the running job's part; the release gives back 50, not 80",
    r.ok && r.row.v === 50 && holdRow.from_lots[0].n === 50 && rel.given_back === 50 && l.remaining === 50 && l.revoked_amount === 50, { r, holdRow, rel, l });
  const resH = (await q(db, "select result from public.turn_stripe_events where id = 'evt_ph_1'"))[0].result;
  ok("F15 …the event says how much came from open holds", resH.from_open_holds === 30 && resH.removed === 50, resH);

  // a plan payment: Writer 600, 100 spent, then 50 % twice, then a full refund
  await svc(db, "select public.turn_set_plan_once('invoice:in_g1', $1, 'writer', 600, 'sub_g1', 'cus_g1', $2)", [U.G.id, future(30)]);
  await as(db, U.G, "select * from public.turn_spend_credit(100, 'sp-g1')");
  const grant = async () => (await q(db, "select revoked_amount, revoked_at from public.turn_plan_grants where event_id = 'invoice:in_g1'"))[0];
  const plan = async (who) => n((await q(db, "select plan_remaining from public.turn_credits where owner = $1", [who.id]))[0].plan_remaining);
  r = await revoke("evt_pg_1", "invoice:in_g1", 0.5);
  let g = await grant();
  ok("F16 a 50 % refund of a 600 plan payment removes 300 of the 500 unused; the grant stays open", r.ok && r.row.v === 300 && await plan(U.G) === 200 &&
    g.revoked_amount === 300 && g.revoked_at === null, { r, g });
  r = await revoke("evt_pg_2", "invoice:in_g1", 0.5);
  g = await grant();
  ok("F17 a second 50 % is capped at the 200 still unused", r.ok && r.row.v === 200 && await plan(U.G) === 0 && g.revoked_amount === 500, { r, g });
  r = await revoke("evt_pg_3", "invoice:in_g1", 1);
  g = await grant();
  ok("F18 then a full refund: nothing left, the grant is closed (revoked_at)", r.ok && r.row.v === 0 && !!g.revoked_at && g.revoked_amount === 500, { r, g });

  // a plan payment partly held by a running job
  await svc(db, "select public.turn_set_plan_once('invoice:in_w1', $1, 'writer', 600, 'sub_w1', 'cus_w1', $2)", [U.W.id, future(30)]);
  await svc(db, "select public.turn_hold_credits($1, 500, 'video:job-w1', 'video')", [U.W.id]);    // 500 held, 100 left
  r = await revoke("evt_pw_1", "invoice:in_w1", 0.5);
  const relW = await svc(db, "select public.turn_release_hold('video:job-w1')");
  ok("F19 50 % of a 600 plan payment with 500 held: 100 from the plan credits left, 200 from the job's part; the release gives back 300",
    r.ok && r.row.v === 300 && relW.given_back === 300 && await plan(U.W) === 300, { r, relW, plan: await plan(U.W) });
  // an earlier period's payment
  await svc(db, "select public.turn_set_plan_once('invoice:in_w2', $1, 'writer', 600, 'sub_w1', 'cus_w1', $2)", [U.W.id, future(60)]);
  r = await revoke("evt_pw_2", "invoice:in_w1", 0.5);
  ok("F20 a partial refund of an earlier period's payment removes nothing (those credits already ended)", r.ok && r.row.v === 0 && await plan(U.W) === 600, r);

  // a full refund after a partial one closes the lot: a running job's part never comes back
  await svc(db, "select public.turn_add_pack_once('checkout:cs_h2', $1, 100, 'ch_h2')", [U.K.id]);
  await revoke("evt_pk_1", "ch_h2", 0.1);                                                          // 10 removed, 90 left
  await svc(db, "select public.turn_hold_credits($1, 40, 'video:job-k1', 'video')", [U.K.id]);      // 40 held, 50 left
  r = await revoke("evt_pk_2", "ch_h2");
  const relK = await svc(db, "select public.turn_release_hold('video:job-k1')");
  l = await lot("checkout:cs_h2");
  ok("F21 a full refund after a 10 % one removes the 50 left and closes the lot; the job's 40 don't come back on release",
    r.ok && r.row.v === 50 && relK.given_back === 0 && l.remaining === 0 && l.revoked_amount === 60 && !!l.revoked_at, { r, relK, l });

  // a partial refund taken from a running job's hold, then the job SETTLES with a cost
  // above zero (the normal path): the refunded part must not come back
  const S = {
    L: { id: "20000000-0000-0000-0000-0000000000a1", email: "settle-lot@example.com" },
    P: { id: "20000000-0000-0000-0000-0000000000a2", email: "settle-plan@example.com" },
    M: { id: "20000000-0000-0000-0000-0000000000a3", email: "settle-mixed@example.com" },
    F: { id: "20000000-0000-0000-0000-0000000000a4", email: "settle-full@example.com" },
  };
  for (const u of Object.values(S)) {
    await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now() - interval '1 day')", [u.id, u.email]);
  }
  const holdOf = async (ref) => (await q(db, "select held, from_plan, from_lots from public.turn_credit_holds where ref = $1", [ref]))[0];
  await svc(db, "select public.turn_add_pack_once('checkout:cs_s1', $1, 100, 'ch_s1')", [S.L.id]);
  await svc(db, "select public.turn_hold_credits($1, 80, 'video:job-s1', 'video')", [S.L.id]);     // 80 held, 20 left
  r = await revoke("evt_ps_1", "ch_s1", 0.5);                                                       // 20 left + 30 of the job's part
  let hs = await holdOf("video:job-s1");
  let st = await svc(db, "select public.turn_settle_hold('video:job-s1', 40)");                     // the job really cost 40
  l = await lot("checkout:cs_s1");
  ok("F21b lot: 50 % of 100 with 80 held, then the job settles at 40: its part of the lot drops to 50 (held stays 80), 10 come back (not 40); 100 = 10 left + 50 refunded + 40 used",
    r.ok && r.row.v === 50 && hs.held === 80 && hs.from_lots[0].n === 50 && st.kept === 40 && st.given_back === 10 &&
    l.remaining === 10 && l.revoked_amount === 50 && await total(S.L) === 10, { r, hs, st, l });

  await svc(db, "select public.turn_set_plan_once('invoice:in_s2', $1, 'writer', 600, 'sub_s2', 'cus_s2', $2)", [S.P.id, future(30)]);
  await svc(db, "select public.turn_hold_credits($1, 500, 'video:job-s2', 'video')", [S.P.id]);    // 500 held, 100 left
  r = await revoke("evt_ps_2", "invoice:in_s2", 0.5);                                               // 100 left + 200 of the job's part
  hs = await holdOf("video:job-s2");
  st = await svc(db, "select public.turn_settle_hold('video:job-s2', 400)");                        // the job really cost 400
  ok("F21c plan: 50 % of 600 with 500 held, then the job settles at 400: it keeps its real cost (400) and nothing comes back (plan left 0, not 100)",
    r.ok && r.row.v === 300 && hs.held === 500 && hs.from_plan === 300 && st.kept === 400 && st.given_back === 0 &&
    await plan(S.P) === 0, { r, hs, st, plan: await plan(S.P) });

  await svc(db, "select public.turn_set_plan_once('invoice:in_s3', $1, 'writer', 30, 'sub_s3', 'cus_s3', $2)", [S.M.id, future(30)]);
  await svc(db, "select public.turn_add_pack_once('checkout:cs_s3', $1, 70, 'ch_s3')", [S.M.id]);
  await svc(db, "select public.turn_hold_credits($1, 100, 'video:job-s3', 'video')", [S.M.id]);    // 30 plan + 70 lot
  r = await revoke("evt_ps_3", "ch_s3", 6 / 7);                                                     // 60 of the lot's 70
  hs = await holdOf("video:job-s3");
  st = await svc(db, "select public.turn_settle_hold('video:job-s3', 40)");
  ok("F21d mixed: a 30 plan + 70 pack hold, 60 of the pack refunded, the job settles at 40: balance 0 (nothing given back)",
    r.ok && r.row.v === 60 && hs.held === 100 && hs.from_plan === 30 && hs.from_lots[0].n === 10 && st.kept === 40 && st.given_back === 0 &&
    await total(S.M) === 0, { r, hs, st, total: await total(S.M) });

  // the FULL plan path too, when the hold's plan part is larger than what is left of the grant
  await svc(db, "select public.turn_set_plan_once('invoice:in_s4', $1, 'writer', 600, 'sub_s4', 'cus_s4', $2)", [S.F.id, future(30)]);
  await db.query("update public.turn_credits set remaining = remaining + 200 where owner = $1", [S.F.id]);   // a hand top-up: plan credits
  const topped = await plan(S.F);
  await svc(db, "select public.turn_hold_credits($1, 700, 'video:job-s4', 'video')", [S.F.id]);    // 700 held, 100 left
  r = await revoke("evt_ps_4", "invoice:in_s4");                                                    // full: 100 left + 500 of the job's part
  hs = await holdOf("video:job-s4");
  st = await svc(db, "select public.turn_settle_hold('video:job-s4', 650)");
  ok("F21e full plan refund with 700 held of 800 plan credits: the job's plan part drops to 200; a settle at 650 keeps 650 and gives nothing back (not 50)",
    topped === 800 && r.ok && r.row.v === 600 && hs.held === 700 && hs.from_plan === 200 && st.kept === 650 && st.given_back === 0 &&
    await plan(S.F) === 0, { topped, r, hs, st, plan: await plan(S.F) });
  const usage = (await q(db, "select credits, metadata from public.turn_usage_events where request_id = 'video:job-s1'"))[0];
  ok("F21f the settle's usage row records what the job kept, and the part the refund had taken from its hold",
    n(usage?.credits) === 40 && usage.metadata.refunded_from_hold === 30 && usage.metadata.given_back === 10, usage);
  // a hold no refund touched: nothing changes (the whole give-back comes back)
  await svc(db, "select public.turn_add_pack_once('checkout:cs_s5', $1, 50, 'ch_s5')", [S.L.id]);
  await svc(db, "select public.turn_hold_credits($1, 30, 'video:job-s5', 'video')", [S.L.id]);
  st = await svc(db, "select public.turn_settle_hold('video:job-s5', 12)");
  const u5 = (await q(db, "select metadata from public.turn_usage_events where request_id = 'video:job-s5'"))[0];
  ok("F21g an untouched hold settles as before: 18 of 30 come back, no refunded_from_hold", st.kept === 12 && st.given_back === 18 && !("refunded_from_hold" in u5.metadata), { st, u5 });
  ok("F22 every balance adds up", await consistent());

  // the source: refund_fraction is in BOTH copies of the shared block (K1 of test-billing-db pins them equal)
  ok("F23 billing-v2.sql and credits.sql carry the same turn_revoke_charge_once with refund_fraction",
    region(V2, "KINOLOT BILLING V2 DEFINITIONS") === region(CREDITS, "KINOLOT BILLING V2 DEFINITIONS") &&
    /create or replace function public\.turn_revoke_charge_once\(event_id text, charge_id text, refund_fraction numeric default 1\)/.test(V2) &&
    /drop function if exists public\.turn_revoke_charge_once\(text, text\);/.test(V2));
}

/* ================================ G. fresh install ================================ */
section("G. fresh install (credits.sql)");
{
  ok("G1 the tax block is byte-identical in credits.sql and tax-compliance.sql", region(CREDITS, TAX_BLOCK) !== null && region(CREDITS, TAX_BLOCK) === region(TAX, TAX_BLOCK));
  ok("G2 in credits.sql it comes after the billing v2 block (it needs turn__service_only)",
    CREDITS.indexOf("-- <<< KINOLOT BILLING V2 DEFINITIONS <<<") < CREDITS.indexOf("-- >>> KINOLOT TAX COMPLIANCE DEFINITIONS >>>") &&
    CREDITS.indexOf("-- <<< KINOLOT TAX COMPLIANCE DEFINITIONS <<<") < CREDITS.lastIndexOf("\ncommit;"));
  const fingerprint = async (db) => safe({
    fns: await q(db, `select p.oid::regprocedure::text as sig, pg_get_function_result(p.oid) as res, p.prosecdef, p.proconfig, p.provolatile,
                             md5(p.prosrc) as src, p.proacl::text as acl
                        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                       where ns.nspname = 'public' and (p.proname like 'turn\\_\\_tax%' or p.proname in ('turn_record_sale_once', 'turn_record_checkout_consent', 'turn_admin_tax_summary', 'turn_revoke_charge_once')) order by 1`),
    cols: await q(db, `select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
                        where table_schema = 'public' and table_name in ('turn_sales_ledger', 'turn_checkout_consents') order by 1, 2`),
    cons: await q(db, `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
                        where conrelid in ('public.turn_sales_ledger'::regclass, 'public.turn_checkout_consents'::regclass) order by 1, 2`),
    idx: await q(db, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('turn_sales_ledger', 'turn_checkout_consents') order by 1, 2`),
    acl: await q(db, `select relname, relacl::text as acl, relrowsecurity from pg_class
                       where relnamespace = 'public'::regnamespace and relname in ('turn_sales_ledger', 'turn_checkout_consents', 'turn_sales_ledger_id_seq', 'turn_checkout_consents_id_seq') order by 1`),
  });
  const fresh = await freshDb();
  const upg = await installedDb();
  const [fa, fb] = [await fingerprint(fresh), await fingerprint(upg)];
  ok("G3 credits.sql alone ends in the same tax tables, functions and privileges as production + billing-v2.sql + tax-compliance.sql", fa === fb,
    Object.keys(JSON.parse(fa)).filter((k) => safe(JSON.parse(fa)[k]) !== safe(JSON.parse(fb)[k])));
  const t1 = await runFile(fresh, TAX);
  ok("G4 tax-compliance.sql after a fresh credits.sql: RESULT all ok", t1.ok && allOk(t1.rows), t1.error || bad(t1.rows || []));
  await record(fresh, { key: "invoice:g1", cents: 100, country: "GB" });
  const snap = await snapshot(fresh);
  const again = await runFile(fresh, CREDITS);
  ok("G5 credits.sql is safe to re-run and changes no data", again.ok && snap === await snapshot(fresh), again.error);
}

/* ================================ H. docs ================================ */
section("H. README and the runbook");
{
  const flat = (t) => t.replace(/\s+/g, " ");
  const i = README.indexOf("## Tax & compliance records");
  const sec = i >= 0 ? README.slice(i, README.indexOf("\n## ", i + 5) > 0 ? README.indexOf("\n## ", i + 5) : undefined) : "";
  ok("H1 README has a \"Tax & compliance records\" section", sec.length > 0);
  for (const s of ["tax-compliance.sql", "billing-v2.sql", "credits.sql", "RESULT", "turn_sales_ledger", "turn_record_sale_once",
    "turn_checkout_consents", "turn_record_checkout_consent", "turn_admin_tax_summary", "refund_fraction", "test-tax-compliance-db.mjs"]) {
    ok("H2 it names " + s, sec.includes(s));
  }
  ok("H3 the order: billing-v2.sql (re-run) before tax-compliance.sql, and the RESULT's 10 rows", /run \*\*`billing-v2\.sql`\*\* again/.test(sec) &&
    sec.indexOf("billing-v2.sql") < sec.indexOf("Run **`tax-compliance.sql`**") && /10 RESULT rows/.test(sec), sec.slice(0, 600));
  ok("H4 the fresh-install list and the Billing v2 contract row know about it", /tax-compliance\.sql/.test(README.slice(0, README.indexOf("## Architecture"))) &&
    /\| `turn_revoke_charge_once\(event_id, charge_id, refund_fraction default 1\)` \| service role \|/.test(README));
  const rb = flat(RUNBOOK);
  ok("H5 runbook: run tax-compliance.sql (after the billing-v2.sql re-run)", /tax-compliance\.sql/.test(rb) && /billing-v2\.sql` again/.test(rb));
  ok("H6 runbook: every Kinolot payment link collects the billing address (required) and requires the terms with the D2 custom text",
    /billing address/i.test(rb) && /[Rr]equire customers to accept your terms of service/.test(rb) &&
    rb.includes("Start now: I want to use my credits straight away. I understand I lose my right to cancel for credits I use, and if I cancel within 14 days I only get back the part I haven't used.") && !rb.includes("Start now: I want to use my credits straight away. I understand that if I cancel within 14 days, I only get back the part I haven't used."));
  ok("H7 runbook: hand-made plan changes in Stripe charge prorations at once (always invoice), with how", /always invoice/i.test(rb) && /prorat/i.test(rb));
  ok("H8 runbook: non-Union OSS before the first EU sale, UK VAT at £90,000, US per state, Stripe Tax with tax-inclusive prices",
    /non-Union OSS/.test(rb) && /£90,000/.test(rb) && /per state/i.test(rb) && /Stripe Tax/.test(rb) && /inclusive/i.test(rb));
  ok("H9 runbook: the Admin panel's Tax & compliance panel and the legal placeholders to fill before the switch",
    /Tax & compliance/.test(rb) && rb.includes("<legal name>") && rb.includes("<business address>"));
  ok("H10 the runbook no longer says pack credits are refunded on closing an account (owner, 2026-10-01: no)",
    !/unused pack credits are refunded when we close an account/.test(rb));
  // review fixes (2026-10-01)
  ok("H11 runbook: add charge.refund.updated to the webhook (pending refunds wait for it); README too",
    /add \*\*`charge\.refund\.updated`\*\* \(ten events in all\)/.test(rb) && /\*\*`charge\.refund\.updated`\*\*/.test(README));
  ok("H12 runbook: the 14-day right is for every buyer, refunded within 14 days to the same payment method; README says every buyer",
    rb.includes("for every buyer (the law requires it for UK and EU consumers; the Terms give it to everyone)") && /within 14 days of the customer's message/.test(rb)
    && !/14-day right to cancel\*\* \(UK and EU consumers\)/.test(rb) && !/UK and EU consumers get a 14-day right/.test(flat(README)));
  ok("H13 runbook lawyer list: the CRA grey list (closure without refunding pack credits), the EU withdrawal button, the EU GDPR representative, service vs digital content, a business address service",
    /Consumer Rights Act 2015 "grey list" \(Schedule 2, Part 1, paragraph 7/.test(rb) && /2023\/2673/.test(rb) && /Article 11a/.test(rb)
    && /GDPR Article 27/.test(rb) && /service or digital content/.test(rb) && /business address service/.test(rb) && /a PO box is not/.test(rb)
    && !/a business address service is fine/.test(rb) && !/Your Name, trading as Infinite Studio AI/.test(rb));
  ok("H14 runbook: EU OSS records ten years with two pieces of evidence; the UK figure assumes digital services",
    /ten years\*\* from the end of the year of each sale/.test(rb) && /two pieces of evidence that agree/.test(rb) && /live or human-delivered services/.test(rb));
  ok("H15 runbook: where TERMS_UPDATED_AT lives and how to write it",
    rb.includes('in `app/plans.jsx` set `const TERMS_UPDATED_AT = "2026-11-14";`') && /YYYY-MM-DD/.test(rb) && rb.includes("<EU representative>"));
  ok("H16 README: turn_dispute_hold in the contract, the hyphenated consent skus",
    /\| `turn_dispute_hold\(uid, dispute_id, open, part default null\)` \| service role \|/.test(README) && README.includes("`plan-writer`, `plan-director`, `plan-studio`, `pack-250`")
    && !/e\.g\. `plan:writer`, `pack:1000`/.test(README) && !/'plan:writer', 'pack:1000'/.test(TAX));
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);

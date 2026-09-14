#!/usr/bin/env node
/*
 * Real PostgreSQL regression harness for the Blender Studio atomic-spend RPC.
 *
 * This intentionally does not use Supabase, Docker, a provider, an account
 * credential, or a JavaScript ledger.  It creates a disposable local
 * PostgreSQL cluster, installs the real credits schema and the real Studio
 * billing migration, then drives the RPC from separate authenticated
 * PostgreSQL sessions so row-lock and unique-key races are real races.
 *
 * Run with: node scripts/test-blender-studio-billing.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const creditsPath = path.join(root, "supabase", "credits.sql");
const migrationPath = path.join(root, "supabase", "studio-credit-settlement-migration.sql");
const STUDIO_FUNCTION = "turn_studio_settle_credit";

const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";
const PLAN = "none";
const INITDB_BIN = process.env.INITDB_BIN || "initdb";
const PG_CTL_BIN = process.env.PG_CTL_BIN || "pg_ctl";
const PSQL_BIN = process.env.PSQL_BIN || "psql";

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

function shellResult(command, args, { env, input = null, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => {
      const result = { code, stdout, stderr };
      if (code !== 0 && !allowFailure) {
        const detail = (stderr || stdout).trim();
        reject(new Error(`${command} ${args.join(" ")} failed (${code})${detail ? `: ${detail}` : ""}`));
      } else resolve(result);
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function selectPort() {
  // This is only a hint; startCluster retries with another local port if it is
  // already occupied.  The socket directory is unique, so no remote server
  // can be selected accidentally.
  return 54000 + (process.pid % 1000);
}

async function startCluster() {
  const directory = mkdtempSync(path.join(tmpdir(), "blender-studio-billing-"));
  const socketDirectory = path.join(directory, "sock");
  const dataDirectory = path.join(directory, "data");
  const logPath = path.join(directory, "postgres.log");
  mkdirSync(socketDirectory);
  const safeEnv = {
    PATH: process.env.PATH || "",
    HOME: directory,
    LANG: "C",
    LC_ALL: "C",
    PGHOST: socketDirectory,
    PGUSER: "postgres",
    PGDATABASE: "postgres",
    PGAPPNAME: "blender-studio-billing-regression",
  };

  await shellResult(INITDB_BIN, [
    "-D", dataDirectory, "--no-locale", "--encoding=UTF8", "--auth=trust",
    "--username=postgres",
  ], { env: safeEnv });

  let port = selectPort(), started = false, lastError = null;
  for (let attempt = 0; attempt < 20 && !started; attempt += 1) {
    const result = await shellResult(PG_CTL_BIN, [
      "-D", dataDirectory, "-o", `-p ${port} -k ${socketDirectory}`,
      "-l", logPath, "-w", "start",
    ], { env: safeEnv, allowFailure: true });
    if (result.code === 0) started = true;
    else {
      lastError = result.stderr || result.stdout;
      port += 1;
    }
  }
  if (!started) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`Could not start disposable local PostgreSQL: ${String(lastError || "").trim()}`);
  }

  const psqlEnv = {
    ...safeEnv,
    PGPORT: String(port),
  };
  const stop = async () => {
    await shellResult(PG_CTL_BIN, ["-D", dataDirectory, "-m", "immediate", "-w", "stop"], {
      env: psqlEnv,
      allowFailure: true,
    });
    rmSync(directory, { recursive: true, force: true });
  };
  return { directory, dataDirectory, port, env: psqlEnv, stop };
}

async function runPsql(cluster, sql, { role = null, allowFailure = false, appName = null } = {}) {
  const env = {
    ...cluster.env,
    ...(appName ? { PGAPPNAME: appName } : {}),
  };
  const result = await shellResult(PSQL_BIN, [
    "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", cluster.env.PGHOST, "-p", String(cluster.port),
    "-U", "postgres", "-d", "postgres", "-c", sql,
  ], { env, allowFailure });
  if (!allowFailure && result.code !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout).trim()}`);
  }
  if (role) assert.equal(role, "postgres", "runPsql role is only metadata; use authenticatedSql for client calls");
  return result;
}

async function runPsqlFile(cluster, file) {
  const env = cluster.env;
  return shellResult(PSQL_BIN, [
    "-X", "-q", "-v", "ON_ERROR_STOP=1",
    "-h", cluster.env.PGHOST, "-p", String(cluster.port),
    "-U", "postgres", "-d", "postgres", "-f", file,
  ], { env });
}

function parseLastLine(stdout) {
  const lines = stdout.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.at(-1) || "";
}

async function scalar(cluster, sql) {
  const result = await runPsql(cluster, sql);
  return parseLastLine(result.stdout);
}

async function jsonQuery(cluster, sql) {
  const text = await scalar(cluster, sql);
  try {
    return JSON.parse(text || "[]");
  } catch (error) {
    throw new Error(`Expected JSON from PostgreSQL, got ${JSON.stringify(text)}`, { cause: error });
  }
}

async function inspectStudioFunction(cluster) {
  const functionRows = await jsonQuery(cluster, `
    select coalesce(json_agg(json_build_object(
      'oid', p.oid::text,
      'name', p.proname,
      'args', coalesce(p.proargnames, array[]::text[]),
      'types', (select coalesce(json_agg(format_type(t.oid, null) order by u.ord), '[]'::json)
                from unnest(p.proargtypes) with ordinality as u(type_oid, ord)
                join pg_type t on t.oid = u.type_oid),
      'arg_text', pg_get_function_arguments(p.oid),
      'identity', pg_get_function_identity_arguments(p.oid),
      'defaults', p.pronargdefaults
    ))::text, '[]')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${sqlText(STUDIO_FUNCTION)}
  `);
  if (functionRows.length === 0) {
    throw new Error(`Studio billing function public.${STUDIO_FUNCTION} was not created by the migration.`);
  }
  const exact = functionRows.filter(row => {
    const names = Array.isArray(row.args) ? row.args : [];
    const types = Array.isArray(row.types) ? row.types : [];
    return types.length === 3 && names.length >= types.length;
  });
  if (exact.length !== 1) {
    throw new Error(
      `Expected exactly one public.${STUDIO_FUNCTION} function with named owner/event/cost arguments; ` +
      `found ${functionRows.map(row => `${row.identity} [${row.args?.join(", ")}]`).join("; ")}`,
    );
  }
  const row = exact[0];
  row.types = Array.isArray(row.types) ? row.types : [];
  row.args = (Array.isArray(row.args) ? row.args : []).slice(0, row.types.length);
  return { name: STUDIO_FUNCTION, ...row };
}

async function legacyFunctionDefinition(cluster) {
  const rows = await jsonQuery(cluster, `
    select coalesce(json_agg(json_build_object(
      'oid', p.oid::text,
      'identity', pg_get_function_identity_arguments(p.oid),
      'definition', pg_get_functiondef(p.oid)
    ))::text, '[]')
    from pg_proc p
    where p.oid = 'public.turn_spend_credit(integer,text)'::regprocedure
  `);
  assert.equal(rows.length, 1, "legacy turn_spend_credit(integer,text) exists in the fixture");
  return rows[0];
}

function functionArguments(meta, { owner, event, cost }) {
  assert.deepEqual(meta.args, ["launcher_uid", "credit_cost", "studio_event_id"],
    "Studio billing RPC argument names are the approved contract");
  assert.deepEqual(meta.types, ["uuid", "integer", "text"],
    "Studio billing RPC argument types are the approved contract");
  const ownerSql = owner == null ? "null::uuid" : `${sqlText(owner)}::uuid`;
  const costSql = cost == null ? "null::integer" : `${cost}::integer`;
  const eventSql = event == null ? "null::text" : `${sqlText(event)}::text`;
  return [ownerSql, costSql, eventSql].join(", ");
}

function clientSql(meta, {
  role = "authenticated",
  uid = UID_A,
  owner = UID_A,
  event = "event-not-set",
  cost = 1,
  appName = "blender-studio-billing-client",
} = {}) {
  if (!["authenticated", "anon", "service_role"].includes(role)) throw new Error(`Unsupported fixture role: ${role}`);
  const args = functionArguments(meta, { owner, event, cost });
  const claim = role === "authenticated" || role === "service_role" ? uid : uid;
  const roleClaim = role;
  return {
    appName,
    sql: `
      set role ${sqlIdentifier(role)};
      do $$ begin
        perform set_config('request.jwt.claim.sub', ${sqlText(claim || "")}, false);
        perform set_config('request.jwt.claim.role', ${sqlText(roleClaim)}, false);
        perform set_config('request.jwt.claims', ${sqlText(JSON.stringify({ sub: claim || null, role: roleClaim }))}, false);
      end $$;
      select coalesce(json_agg(row_to_json(result))::text, '[]')
      from (select * from public.${sqlIdentifier(meta.name)}(${args})) result;
    `,
  };
}

async function invoke(cluster, meta, options = {}) {
  const request = clientSql(meta, options);
  const result = await runPsql(cluster, request.sql, {
    allowFailure: true,
    appName: request.appName,
  });
  if (result.code !== 0) {
    return { ok: false, rows: [], stdout: result.stdout, error: (result.stderr || result.stdout).trim() };
  }
  const text = parseLastLine(result.stdout);
  let rows;
  try {
    rows = JSON.parse(text || "[]");
  } catch (error) {
    return { ok: false, rows: [], stdout: result.stdout, error: `Invalid RPC result ${JSON.stringify(text)}: ${error.message}` };
  }
  return { ok: true, rows, stdout: result.stdout, error: null };
}

async function setupLocalSchema(cluster) {
  const credits = readFileSync(creditsPath, "utf8");
  const bootstrap = `
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text
    );
    create or replace function auth.uid()
    returns uuid language sql stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.role()
    returns text language sql stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
    $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    grant usage on schema auth to public;
    grant execute on function auth.uid() to public;
    grant execute on function auth.role() to public;
    grant execute on function auth.jwt() to public;
  `;
  await runPsql(cluster, `${bootstrap}\n${credits}`);
  await runPsql(cluster, `
    insert into auth.users(id, email) values
      (${sqlText(UID_A)}::uuid, null),
      (${sqlText(UID_B)}::uuid, null);
    insert into public.turn_credits(owner, remaining, plan)
      values
        (${sqlText(UID_A)}::uuid, 0, ${sqlText(PLAN)}),
        (${sqlText(UID_B)}::uuid, 0, ${sqlText(PLAN)})
      on conflict (owner) do update
        set remaining = excluded.remaining, plan = excluded.plan, updated_at = now();
  `);
}

async function assertExistingReceiptSchema(cluster) {
  const columns = await jsonQuery(cluster, `
    select coalesce(json_agg(json_build_object(
      'name', column_name,
      'type', data_type,
      'nullable', is_nullable
    ) order by ordinal_position)::text, '[]')
    from information_schema.columns
    where table_schema = 'public' and table_name = 'turn_spend_events'
      and column_name in ('event_id', 'owner', 'cost', 'created_at')
  `);
  assert.deepEqual(columns, [
    { name: "event_id", type: "text", nullable: "NO" },
    { name: "owner", type: "uuid", nullable: "NO" },
    { name: "cost", type: "integer", nullable: "NO" },
    { name: "created_at", type: "timestamp with time zone", nullable: "NO" },
  ], "harness uses the existing credits.sql receipt schema");
  assert.equal(await scalar(cluster, `
    select to_regclass('public.turn_studio_spend_events') is null
  `), "t", "Studio settlement does not add a second receipt table");
}

async function resetFixture(cluster, { remaining = 50, clearEvents = true } = {}) {
  await runPsql(cluster, `
    delete from public.turn_spend_events;
    delete from public.turn_credits where owner in (${sqlText(UID_A)}::uuid, ${sqlText(UID_B)}::uuid);
    insert into public.turn_credits(owner, remaining, plan)
      values
        (${sqlText(UID_A)}::uuid, ${remaining}, ${sqlText(PLAN)}),
        (${sqlText(UID_B)}::uuid, ${remaining}, ${sqlText(PLAN)});
  `);
  if (!clearEvents) throw new Error("clearEvents=false is not supported by this isolated fixture");
}

async function balance(cluster, owner = UID_A) {
  return Number(await scalar(cluster, `
    select remaining from public.turn_credits where owner = ${sqlText(owner)}::uuid
  `));
}

async function eventCount(cluster, event = null) {
  const predicate = event == null ? "" : ` where event_id = ${sqlText(event)}`;
  return Number(await scalar(cluster, `select count(*) from public.turn_spend_events${predicate}`));
}

function assertRpcRows(result, expectedRemaining, message) {
  assert.equal(result.ok, true, `${message}: ${result.error || result.stdout}`);
  assert.equal(result.rows.length, 1, `${message}: expected one balance row`);
  assert.equal(Number(result.rows[0].remaining), expectedRemaining, message);
}

function assertRpcDenied(result, message) {
  if (result.ok) assert.equal(result.rows.length, 0, `${message}: RPC returned a row`);
}

async function testConcurrentDistinctSpends(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const [first, second] = await Promise.all([
    invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-race-a", cost: 40, appName: "billing-race-a" }),
    invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-race-b", cost: 40, appName: "billing-race-b" }),
  ]);
  const successes = [first, second].filter(result => result.ok);
  const failures = [first, second].filter(result => !result.ok);
  assert.equal(successes.length, 1,
    `two distinct concurrent 40-credit spends have exactly one winner: ${JSON.stringify([first, second])}`);
  assert.equal(failures.length, 1, "two distinct concurrent 40-credit spends have exactly one insufficient loser");
  assertRpcRows(successes[0], 10, "winning concurrent spend leaves 10 credits");
  assert.equal(successes[0].rows[0].duplicate, false, "distinct winning spend is not a duplicate");
  assert.match(failures[0].error, /insufficient|credit|balance|fund|INSUFFICIENT/i,
    "losing concurrent spend reports insufficient credits");
  assert.equal(await balance(cluster), 10, "concurrent spend final balance is 10");
  assert.equal(await eventCount(cluster), 1, "losing concurrent spend does not insert an event");
}

async function testDuplicateEvents(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const [first, second] = await Promise.all([
    invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-duplicate-race", cost: 40, appName: "billing-duplicate-a" }),
    invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-duplicate-race", cost: 40, appName: "billing-duplicate-b" }),
  ]);
  assertRpcRows(first, 10, "first duplicate event call");
  assertRpcRows(second, 10, "concurrent duplicate event call");
  assert.equal([first, second].filter(result => result.rows[0].duplicate === false).length, 1,
    "one concurrent duplicate call owns the receipt");
  assert.equal([first, second].filter(result => result.rows[0].duplicate === true).length, 1,
    "one concurrent duplicate call reports duplicate:true");
  assert.equal(await balance(cluster), 10, "concurrent duplicate event charged once");
  assert.equal(await eventCount(cluster, "studio-duplicate-race"), 1, "concurrent duplicate event has one ledger row");
  const replay = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-duplicate-race", cost: 40 });
  assertRpcRows(replay, 10, "replayed duplicate event");
  assert.equal(replay.rows[0].duplicate, true, "replayed duplicate event reports duplicate:true");
  assert.equal(await balance(cluster), 10, "replayed duplicate event leaves balance untouched");
  assert.equal(await eventCount(cluster, "studio-duplicate-race"), 1, "replayed duplicate event has one ledger row");
}

async function testDuplicateAfterZero(cluster, meta) {
  await resetFixture(cluster, { remaining: 40 });
  const first = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-duplicate-zero", cost: 40 });
  assertRpcRows(first, 0, "spend that reaches zero");
  assert.equal(first.rows[0].duplicate, false, "first spend at zero reports duplicate:false");
  const replay = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-duplicate-zero", cost: 40 });
  assertRpcRows(replay, 0, "duplicate after balance zero remains successful");
  assert.equal(replay.rows[0].duplicate, true, "duplicate after balance zero reports duplicate:true");
  assert.equal(await balance(cluster), 0, "duplicate after balance zero does not go negative");
  assert.equal(await eventCount(cluster, "studio-duplicate-zero"), 1, "duplicate after balance zero has one event");
}

async function testMismatchRejection(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const first = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-mismatch-event", cost: 20 });
  assertRpcRows(first, 30, "mismatch fixture initial spend");
  const costMismatch = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-mismatch-event", cost: 10 });
  assertRpcDenied(costMismatch, "replayed event with mismatched cost is rejected");
  assert.match(costMismatch.error || "", /mismatch|cost|event|idempot|conflict/i,
    "mismatched cost explains rejection");
  assert.equal(await balance(cluster), 30, "mismatched cost does not alter balance");
  const ownerMismatch = await invoke(cluster, meta, {
    role: "service_role", uid: UID_A, owner: UID_B, event: "studio-mismatch-event", cost: 20,
  });
  assertRpcDenied(ownerMismatch, "replayed event with mismatched owner is rejected");
  assert.match(ownerMismatch.error || "", /mismatch|owner|uid|auth|event|idempot|conflict/i,
    "mismatched owner explains rejection");
  assert.equal(await balance(cluster), 30, "mismatched owner does not alter owner balance");
  assert.equal(await balance(cluster, UID_B), 50, "mismatched owner does not alter other balance");
  assert.equal(await eventCount(cluster, "studio-mismatch-event"), 1, "mismatch attempts do not add events");
}

async function testInsufficientNoEvent(cluster, meta) {
  await resetFixture(cluster, { remaining: 10 });
  const result = await invoke(cluster, meta, { role: "service_role", owner: UID_A, event: "studio-insufficient-event", cost: 40 });
  assertRpcDenied(result, "insufficient spend is rejected");
  assert.match(result.error || "", /insufficient|credit|balance|fund/i,
    "insufficient spend reports insufficient credits");
  assert.equal(await balance(cluster), 10, "insufficient spend leaves balance unchanged");
  assert.equal(await eventCount(cluster, "studio-insufficient-event"), 0, "insufficient spend inserts no event");
}

async function testRoleDenial(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const unauthenticated = await invoke(cluster, meta, {
    role: "authenticated", uid: UID_A, owner: UID_A, event: "studio-client-event", cost: 10,
  });
  assertRpcDenied(unauthenticated, "authenticated client is denied even with its own UID");
  const unauthenticatedProbe = await invoke(cluster, meta, {
    role: "authenticated", uid: UID_A, owner: null, event: null, cost: null,
  });
  assertRpcDenied(unauthenticatedProbe, "authenticated client cannot use the readiness probe");
  const wrongRole = await invoke(cluster, meta, {
    role: "anon", uid: UID_A, owner: UID_A, event: "studio-anon-event", cost: 10,
  });
  assertRpcDenied(wrongRole, "anon client is denied");
  assert.equal(await balance(cluster), 50, "role-denied calls leave balance unchanged");
  assert.equal(await eventCount(cluster), 0, "role-denied calls insert no events");
}

async function testInvalidInputs(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const inputs = [
    { owner: UID_A, event: "studio-invalid-zero", cost: 0 },
    { owner: UID_A, event: "studio-invalid-negative", cost: -1 },
    { owner: UID_A, event: "", cost: 1 },
    { owner: UID_A, event: "   ", cost: 1 },
    { owner: UID_A, event: "not-studio-id", cost: 1 },
    { owner: UID_A, event: null, cost: 1 },
    { owner: UID_A, event: "studio-mixed-null-cost", cost: null },
    { owner: null, event: "studio-mixed-null-owner", cost: 1 },
  ];
  for (const input of inputs) {
    const result = await invoke(cluster, meta, {
      role: "service_role", owner: input.owner, event: input.event, cost: input.cost,
    });
    assertRpcDenied(result, `invalid input ${JSON.stringify(input)} is rejected`);
  }
  assert.equal(await balance(cluster), 50, "invalid cost/id inputs leave balance unchanged");
  assert.equal(await eventCount(cluster), 0, "invalid cost/id inputs insert no events");
}

async function testSafeZeroProbe(cluster, meta) {
  await resetFixture(cluster, { remaining: 50 });
  const before = await scalar(cluster, `
    select remaining::text || ':' || (select count(*)::text from public.turn_spend_events)
    from public.turn_credits where owner = ${sqlText(UID_A)}::uuid
  `);
  const probe = await invoke(cluster, meta, {
    role: "service_role", owner: null, event: null, cost: null,
  });
  assert.equal(probe.ok, true, `all-null service probe failed: ${probe.error || probe.stdout}`);
  assert.equal(probe.rows.length, 1, "all-null service probe returns one readiness row");
  assert.equal(probe.rows[0].ready, true, "all-null service probe returns ready:true");
  const after = await scalar(cluster, `
    select remaining::text || ':' || (select count(*)::text from public.turn_spend_events)
    from public.turn_credits where owner = ${sqlText(UID_A)}::uuid
  `);
  assert.equal(after, before, "all-null readiness probe makes zero database changes");
}

async function testLegacySignature(cluster, meta, before) {
  const after = await legacyFunctionDefinition(cluster);
  assert.equal(after.oid, before.oid, "legacy function regprocedure OID is unchanged by Studio migration");
  assert.equal(after.identity, before.identity, "legacy function identity arguments are unchanged");
  assert.equal(after.definition, before.definition, "legacy function definition is unchanged");
  assert.ok(await scalar(cluster, `
    select to_regprocedure('public.turn_spend_credit(integer,text)') is not null
  `), "legacy two-argument regprocedure remains addressable");
  assert.equal(await scalar(cluster, `
    select to_regprocedure('public.turn_spend_credit(integer)') is null
  `), "t", "legacy one-argument overload is absent");

  await resetFixture(cluster, { remaining: 50 });
  const legacy = await invokeLegacy(cluster, UID_A, "legacy-signature-event", 1);
  assert.equal(legacy.ok, true, `legacy call failed: ${legacy.error || legacy.stdout}`);
  assert.equal(legacy.rows.length, 1, "legacy call still returns one balance row");
  assert.equal(Number(legacy.rows[0].remaining), 49, "legacy call still decrements one credit");
  assert.equal(await eventCount(cluster, "legacy-signature-event"), 1,
    "legacy call still records its event id");
  void meta;
}

async function invokeLegacy(cluster, uid, event, cost) {
  const sql = `
    set role "authenticated";
    do $$ begin
      perform set_config('request.jwt.claim.sub', ${sqlText(uid)}, false);
      perform set_config('request.jwt.claim.role', 'authenticated', false);
      perform set_config('request.jwt.claims', ${sqlText(JSON.stringify({ sub: uid, role: "authenticated" }))}, false);
    end $$;
    select coalesce(json_agg(row_to_json(result))::text, '[]')
    from (select * from public.turn_spend_credit(${cost}::integer, ${sqlText(event)}::text)) result;
  `;
  const result = await runPsql(cluster, sql, {
    allowFailure: true,
    appName: "blender-studio-billing-legacy",
  });
  if (result.code !== 0) return { ok: false, rows: [], stdout: result.stdout, error: result.stderr || result.stdout };
  try {
    return { ok: true, rows: JSON.parse(parseLastLine(result.stdout) || "[]"), stdout: result.stdout };
  } catch (error) {
    return { ok: false, rows: [], stdout: result.stdout, error: error.message };
  }
}

async function main() {
  let migrationSource;
  try {
    migrationSource = readFileSync(migrationPath, "utf8");
  } catch (_) {
    throw new Error(`Required exact migration is not available yet: ${path.relative(root, migrationPath)}`);
  }
  assert.ok(migrationSource.length > 0, "exact Studio settlement migration is non-empty");
  assert.notEqual(readFileSync(creditsPath, "utf8").length, 0, "supabase/credits.sql is available");
  const cluster = await startCluster();
  const results = [];
  try {
    await setupLocalSchema(cluster);
    const legacyBefore = await legacyFunctionDefinition(cluster);
    // Keep this as a separate psql -f invocation: the migration under test is
    // loaded byte-for-byte, rather than reimplemented by this harness.
    await runPsqlFile(cluster, migrationPath);
    await assertExistingReceiptSchema(cluster);
    const meta = await inspectStudioFunction(cluster);
    console.log(`Local PostgreSQL ${cluster.port}: loaded ${path.relative(root, migrationPath)}`);
    console.log(`Testing public.${meta.name}(${meta.identity})`);

    const tests = [
      ["concurrent distinct spends", testConcurrentDistinctSpends],
      ["concurrent/replayed duplicate events", testDuplicateEvents],
      ["duplicate after balance zero", testDuplicateAfterZero],
      ["mismatched cost and owner", testMismatchRejection],
      ["insufficient credits has no event", testInsufficientNoEvent],
      ["unauthenticated and wrong-role denial", testRoleDenial],
      ["invalid cost/id input", testInvalidInputs],
      ["all-null safe readiness probe", testSafeZeroProbe],
      ["legacy function signature", testLegacySignature],
    ];
    for (const [name, test] of tests) {
      await test(cluster, meta, name === "legacy function signature" ? legacyBefore : undefined);
      results.push(name);
      console.log(`PASS ${name}`);
    }
    console.log(`Blender Studio billing PostgreSQL regression passed (${results.length} tests).`);
  } finally {
    await cluster.stop();
  }
}

main().catch(error => {
  console.error(`FAIL Blender Studio billing PostgreSQL regression\n${error.stack || error}`);
  process.exitCode = 1;
});
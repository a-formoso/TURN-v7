// ── ADMIN STORAGE PAGE — server (admin-only) ────────────────────────────────
// Owner: platform admin · 2026-09-27. Thin Deno wrapper; all logic, SQL and
// guarantees live in ./core.mjs (no imports, tested offline by
// scripts/test-admin-storage.mjs against the real SQL on PGlite).
//
// This file only: answers CORS, rejects non-POST (405) and bodies over 16 KB
// (413), then hands the raw body to core.handle(), which parses it (400),
// authenticates FIRST (401 / 403) and only then opens a database connection.
//
// Two server channels, kept separate on purpose (spec §3.1):
//   (a) Postgres as `postgres` over SUPABASE_DB_URL (auto-injected; the
//       optional secret ADMIN_STORAGE_DB_URL overrides it). The only way to
//       read turn_admin.* without exposing or granting that schema. The pool
//       is created lazily, after auth passed, so anonymous traffic never opens
//       a connection. Fixed, parameterised statements only (core.mjs S).
//   (b) The service-role supabase-js client, for exactly two things: Storage
//       remove() of exact object names (only the Storage API frees the bytes;
//       dropping the storage.objects row by hand would leave them), and the two
//       cleanup queue RPCs, whose guard is auth.role() = 'service_role'.
//
// Auth: signed-in ADMIN only (live GoTrue record: allowlisted + confirmed
// email, not anonymous, aud 'authenticated', and ADMIN_USER_IDS when set).
// The x-cron-secret path authorises only 'drain-queue' and is inert unless
// ADMIN_STORAGE_CRON_SECRET (32+ chars) is set. Owner decision 2026-09-27:
// the queue is drained manually from the page; no schedule is installed.
// image-proxy is not involved and not touched.
//
// Deploy (Mac, owner approval required; not deployed as of 2026-09-27):
//   npx -y supabase@latest functions deploy admin-storage --project-ref <ref> --use-api
// Operator tool: deliberately NOT listed in APP_FEATURES (see core.mjs).

import postgres from "npm:postgres@3.4.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createAdminStorage } from "./core.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const env = (name: string) => Deno.env.get(name) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const DB_URL = env("ADMIN_STORAGE_DB_URL") || env("SUPABASE_DB_URL");
const ADMIN_EMAILS = ["admin@infinitestudioai.com"];
const MAX_BODY_BYTES = 16 * 1024;
const QUEUE_RPCS = new Set(["turn_claim_asset_cleanup_batch", "turn_complete_asset_cleanup"]);
const list = (v: string) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// ── channel (a): postgres.js pool, module-scope lazy singleton ──────────────
// deno-lint-ignore no-explicit-any
let pool: any = null;
function db() {
  if (!DB_URL) throw Object.assign(new Error("SUPABASE_DB_URL is not set"), { code: "db_unreachable" });
  pool ??= postgres(DB_URL, {
    max: 3,
    prepare: false,          // required on the Supavisor transaction pooler, harmless on 5432
    idle_timeout: 20,
    max_lifetime: 300,
    connect_timeout: 10,
    connection: { application_name: "turn-admin-storage" },
    types: { bigint: postgres.BigInt },   // core.mjs turns int8 into Number
  });
  return pool;
}

// ── channel (b): service-role client ────────────────────────────────────────
// Every request is aborted after 30 s (2026-09-27 review): a hung Storage
// remove() must end well inside the 90 s run lease, or a second call takes the
// lease while this one still waits. core.mjs has its own 35 s guard as well.
const SERVICE_TIMEOUT_MS = 30_000;
const timedFetch: typeof fetch = (input, init = {}) =>
  fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(SERVICE_TIMEOUT_MS) });
// deno-lint-ignore no-explicit-any
let service: any = null;
const svc = () =>
  (service ??= createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  }));

const app = createAdminStorage({
  async getUser(token: string) {
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    return error ? null : (data?.user ?? null);
  },
  // One transaction per unit of work; only SET LOCAL state (no session locks,
  // temp tables, LISTEN or named statements), never held across Storage calls.
  // deno-lint-ignore no-explicit-any
  async tx(mode: "read" | "write", fn: (q: (text: string, params?: unknown[]) => Promise<any[]>) => Promise<unknown>) {
    const opts = mode === "read" ? "isolation level repeatable read read only" : "read write";
    // deno-lint-ignore no-explicit-any
    return await db().begin(opts, (t: any) => fn((text: string, params: unknown[] = []) => t.unsafe(text, params)));
  },
  async storageRemove(paths: string[]) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 1000 ||
        paths.some((p) => typeof p !== "string" || p.length < 3 || p.endsWith("/"))) {
      throw new Error("storageRemove takes exact object names only");
    }
    const { error } = await svc().storage.from("turn-assets").remove(paths);
    return { error: error ? { message: String(error.message || error) } : null };
  },
  async rpc(name: string, args: Record<string, unknown>) {
    if (!QUEUE_RPCS.has(name)) throw new Error("rpc not allowed: " + name);
    const { data, error } = await svc().rpc(name, args);
    return { data, error: error ? { message: String(error.message || error) } : null };
  },
  env: {
    adminEmails: ADMIN_EMAILS,
    adminUserIds: list(env("ADMIN_USER_IDS")),
    cronSecret: env("ADMIN_STORAGE_CRON_SECRET"),
  },
});

// Reads at most `cap` bytes; null when the body is larger (chunked bodies too).
async function readCapped(req: Request, cap: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const tooLarge = { ok: false, error: { code: "bad_request", message: "The request body is too large." } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: { code: "bad_request", message: "Use POST." } }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return json({ ok: false, error: { code: "internal", message: "admin-storage is not configured." } }, 500);
  }
  if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) return json(tooLarge, 413);
  let text: string | null;
  try {
    text = await readCapped(req, MAX_BODY_BYTES);
  } catch (_e) {
    return json({ ok: false, error: { code: "bad_request", message: "Could not read the request body." } }, 400);
  }
  if (text === null) return json(tooLarge, 413);
  const out = await app.handle({
    authorization: req.headers.get("Authorization") || "",
    cronSecret: req.headers.get("x-cron-secret") || "",
    body: text,
  });
  return json(out.json, out.status);
});

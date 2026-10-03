#!/usr/bin/env node
/* THE OWNER PAYS (Team relaunch, owner 2026-10-03; docs/Dashboard Plan.md §6).
   A  film-payer.mjs: which calls are film work, what the database's answer becomes
   B  billing-holds.mjs `film`: the hold goes through turn_hold_credits_for_film, budget refusals
   C  THE PROXY — the real image-proxy/index.ts in Node against the real billing + Team SQL
      (credits.sql, the Team chain, team-relaunch.sql) on PGlite, stub providers:
      a no-plan Co-writer writes on a Director owner's film and the owner pays; the owner's plan
      gates the call; a Co-writer's Art Room image is billed as before (to themselves); an Art
      director's image is the owner's; a Stage editor's video is held on the owner and the
      collaborator's poll settles it; the budget stops a call; a lapsed owner pauses generating;
      a forged film id bills the caller; switched off, everything is billed as before.
     node scripts/test-film-payer.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import * as FP from "../supabase/functions/image-proxy/film-payer.mjs";
import { createHoldClient } from "../supabase/functions/image-proxy/billing-holds.mjs";
import { createSupabaseAdapter } from "../supabase/functions/blender-bridge/supabase-adapter.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");
const j = (x) => JSON.stringify(x);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e && (e.stack || e.message) || e).split("\n").slice(0, 4).join("\n  ")); }
}
const FILM = "f1000000-0000-4000-8000-000000000001";

/* ── A ───────────────────────────────────────────────────────────────────── */
await test("A1 film work: writing, images, voice, video submits and Stage uploads, 3D — never Frances, speech-to-text or a poll", () => {
  assert.equal(FP.filmCallKind("text", { usageKind: "writing" }), "text");
  assert.equal(FP.filmCallKind("text", { usageKind: "muse" }), "");
  assert.equal(FP.filmCallKind(undefined, {}), "image");
  assert.equal(FP.filmCallKind("voice", { op: "tts" }), "voice");
  assert.equal(FP.filmCallKind("voice", { op: "stt" }), "");
  assert.equal(FP.filmCallKind("video", {}), "video");
  assert.equal(FP.filmCallKind("video", { op: "stage-upload" }), "video");
  assert.equal(FP.filmCallKind("video", { op: "poll" }), "");
  assert.equal(FP.filmCallKind("live", {}), "");
});
await test("A2 the database's answer: own, owner (with the member and budget), refuse, or bill the caller", async () => {
  const rpcOf = (data, error = null) => async (name, args) => { rpcOf.last = [name, args]; return { data, error }; };
  const base = { actor: "a1000000-0000-4000-8000-000000000001", context: { projectId: FILM }, kind: "text" };
  assert.deepEqual(await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, own: true }) }), { mode: "own" });
  assert.deepEqual(rpcOf.last, ["turn_film_payer", { p_actor: base.actor, p_project: FILM, p_kind: "text" }]);
  const m = "b1000000-0000-4000-8000-000000000002", o = "c1000000-0000-4000-8000-000000000003";
  const owner = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, payer: o, member_id: m, role: "writer", budget: 200, spent: 20, tier: "director" }) });
  assert.deepEqual(owner, { mode: "owner", payer: o, actor: base.actor, memberId: m, projectId: FILM, role: "writer", budget: 200, spent: 20, tier: "director" });
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, payer: o, member_id: m, budget: null }) })).budget, null, "no limit");
  const paused = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "owner_plan" }) });
  assert.equal(paused.mode, "refuse"); assert.equal(paused.refusal.status, 402); assert.equal(paused.refusal.body.code, "owner_plan");
  const used = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "budget_reached", budget: 200, spent: 1200 }) });
  assert.equal(used.refusal.body.code, "budget_reached"); assert.match(used.refusal.body.message, /1,200 of 200/);
  for (const code of ["not_member", "role", "off", "no_film"]) assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code }) })).mode, "caller", code);
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf(null, { message: "down" }) })).mode, "caller", "a failed check bills the caller, never the owner");
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: async () => { throw new Error("x"); } })).mode, "caller");
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, payer: "not-a-uuid", member_id: m }) })).mode, "caller");
  let asked = false;
  assert.equal((await FP.resolveFilmPayer({ ...base, context: { projectId: "local-1" }, rpc: async () => { asked = true; return {}; } })).mode, "caller");
  assert.equal(asked, false, "no film id (or not a uuid): no database call");
  assert.equal((await FP.resolveFilmPayer({ ...base, kind: "", rpc: rpcOf({ ok: true, own: true }) })).mode, "caller");
});
await test("A3 the collaborator never hears the owner's balance", () => {
  assert.doesNotMatch(FP.ownerShortOfCredits().body.message, /\d/);
  assert.deepEqual(FP.filmPaidMetadata({ mode: "owner", payer: "p", memberId: "m", role: "writer" }), { paidBy: "p", memberId: "m", filmRole: "writer" });
  assert.deepEqual(FP.filmPaidMetadata({ mode: "caller" }), {});
});

/* ── B ───────────────────────────────────────────────────────────────────── */
await test("B1 a film hold names the owner, the collaborator, the member row and the film; a budget refusal reads budget_reached", async () => {
  const calls = [];
  let answer = { ok: true, held: 30, remaining: 970 };
  const h = createHoldClient({ uid: "owner", film: { actor: "cara", memberId: "m1", projectId: FILM }, newId: () => "id1",
    rpc: async (name, args) => { calls.push([name, args]); return { data: answer, error: null }; } });
  const ok = await h.take({ amount: 30, kind: "text", reason: "text:x" });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[0], ["turn_hold_credits_for_film", { p_owner: "owner", p_actor: "cara", p_member: "m1", p_project: FILM, amount: 30, ref: "text:id1", reason: "text:x" }]);
  answer = { ok: false, code: "budget_reached", budget: 200, spent: 190 };
  assert.deepEqual(await h.take({ amount: 30, kind: "text" }), { ok: false, code: "budget_reached", budget: 200, spent: 190, remaining: null });
  const plain = createHoldClient({ uid: "u", newId: () => "id2", rpc: async (name, args) => { calls.push([name, args]); return { data: { ok: true, held: 1 }, error: null }; } });
  await plain.take({ amount: 1, kind: "image" });
  assert.equal(calls.at(-1)[0], "turn_hold_credits", "without a film: the caller's own hold, as before");
});

/* ── D: Blender Studio (blender-bridge) ───────────────────────────────────── */
{
  const OWNER = "c1000000-0000-4000-8000-000000000003", ME = "a1000000-0000-4000-8000-000000000001", MEMBER = "b1000000-0000-4000-8000-000000000002";
  const mk = (W) => createSupabaseAdapter({ url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service",
    createClient: (url, key) => ({
      auth: { getUser: async () => ({ data: { user: { id: ME, email: "me@example.com" } }, error: null }) },
      rpc: async (name, args) => { W.rpcs.push([key, name, args]); return W.rpc(name, args); },
      from: (t) => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: W.tables[t] || [], error: null }),
        maybeSingle: async () => ({ data: (W.tables[t] || [])[0] || null, error: null }) }; return c; },
    }) });
  const world = (payer) => ({ rpcs: [], tables: { turn_credits: [{ plan: "director", remaining: 900, frozen: false }], turn_projects: [{ id: FILM, owner: OWNER }] },
    rpc: (name, args) => name === "turn_film_payer" ? { data: payer, error: null }
      : name === "turn_hold_credits_for_film" ? { data: { ok: true, held: args.amount }, error: null }
      : name === "turn_credit_balance" ? { data: [{ plan: "none", remaining: 0 }], error: null }
      : { data: null, error: { message: "unexpected " + name } } });
  await test("D1 3D on someone's film: the owner's plan and balance, a film hold, the collaborator's budget", async () => {
    const W = world({ ok: true, payer: OWNER, member_id: MEMBER, role: "art_director", budget: 200, spent: 0 });
    const r = await mk(W).authorizeCredit({ token: "t", cost: 120, eventId: "e1", projectId: FILM, ownerId: OWNER });
    assert.deepEqual(r, { ok: true, remaining: null, holdRef: "studio:e1" });
    assert.deepEqual(W.rpcs.find((x) => x[1] === "turn_hold_credits_for_film")[2],
      { p_owner: OWNER, p_actor: ME, p_member: MEMBER, p_project: FILM, amount: 120, ref: "studio:e1", reason: "blender-studio" });
    assert.ok(!W.rpcs.some((x) => x[1] === "turn_hold_credits"), "never the caller's own hold");
  });
  await test("D2 3D refusals on a shared film: the budget, the owner's plan, the owner's balance (no figures)", async () => {
    let r = await mk(world({ ok: false, code: "budget_reached", budget: 200, spent: 200 })).authorizeCredit({ token: "t", cost: 120, eventId: "e2", projectId: FILM, ownerId: OWNER });
    assert.equal(r.code, "budget_reached"); assert.match(r.message, /200 of 200/);
    r = await mk(world({ ok: false, code: "owner_plan" })).authorizeCredit({ token: "t", cost: 120, eventId: "e3", projectId: FILM, ownerId: OWNER });
    assert.equal(r.code, "owner_plan");
    const W = world({ ok: true, payer: OWNER, member_id: MEMBER }); W.tables.turn_credits = [{ plan: "director", remaining: 10 }];
    r = await mk(W).authorizeCredit({ token: "t", cost: 120, eventId: "e4", projectId: FILM, ownerId: OWNER });
    assert.equal(r.code, "owner_insufficient"); assert.doesNotMatch(r.message, /\d/);
  });
  await test("D3 not confirmed as a member (or the caller's own film): billed to the caller, as before", async () => {
    const W = world({ ok: false, code: "not_member" });
    const r = await mk(W).authorizeCredit({ token: "t", cost: 120, eventId: "e5", projectId: FILM, ownerId: OWNER });
    assert.equal(r.code, "plan_required", "the caller's own (no-plan) account");
    const W2 = world({ ok: true, own: true });
    await mk(W2).authorizeCredit({ token: "t", cost: 120, eventId: "e6", projectId: FILM, ownerId: ME });
    assert.ok(!W2.rpcs.some((x) => x[1] === "turn_film_payer"), "the owner's own film asks nothing");
  });
  await test("D4 edit access on a shared film comes from the same database check (by account, the owner's plan)", async () => {
    const access = (payer) => mk(world(payer)).getProjectAccess(FILM, { id: ME, email: "me@example.com" });
    let a = await access({ ok: true, payer: OWNER, member_id: MEMBER });
    assert.deepEqual([a.canRead, a.canWrite, a.ownerId], [true, true, OWNER]);
    a = await access({ ok: false, code: "budget_reached", budget: 1, spent: 1 }); assert.deepEqual([a.canRead, a.canWrite], [true, true]);
    a = await access({ ok: false, code: "role", role: "writer" }); assert.deepEqual([a.canRead, a.canWrite], [true, false]);
    a = await access({ ok: false, code: "owner_plan" }); assert.deepEqual([a.canRead, a.canWrite], [true, false]);
    a = await access({ ok: false, code: "not_member" }); assert.deepEqual([a.canRead, a.canWrite], [false, false]);
  });
}

/* ── C ───────────────────────────────────────────────────────────────────── */
let PGlite, pgcrypto;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
} catch (_e) { PGlite = null; }
if (!PGlite || typeof nodeModule.registerHooks !== "function") {
  console.log("SKIP C: needs @electric-sql/pglite and module.registerHooks");
} else {
  const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)[1];
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  const mk = (n, email) => ({ id: "30000000-0000-4000-8000-0000000000" + n, email });
  const U = { dora: mk("01", "dora@example.com"), pat: mk("02", "pat@example.com"), cara: mk("03", "cara@example.com"),
    ari: mk("04", "ari@example.com"), sam: mk("05", "sam@example.com"), eve: mk("06", "eve@example.com") };
  for (const u of Object.values(U)) await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,now() - interval '1 day')", [u.id, u.email]);
  for (const f of ["schema.sql", "storage.sql", "team-collaboration.sql", "shared-owners.sql", "enforce-role-scopes.sql", "cameos.sql",
    "credits.sql", "frances-daily-limit.sql", "app-config.sql", "series-production.sql", "team-relaunch.sql"]) await db.exec(read("supabase/" + f));
  const F2 = "f1000000-0000-4000-8000-000000000002";
  await db.query("insert into public.turn_projects(id, owner, title, doc) values ($1,$2,'Dora film','{}'::jsonb), ($3,$4,'Pat film','{}'::jsonb)", [FILM, U.dora.id, F2, U.pat.id]);
  const as = async (who, sql, params = []) => {
    try {
      const rows = await db.transaction(async (tx) => {
        const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
        await tx.query("select set_config('request.jwt.claims', $1, true)", [j(claims)]);
        await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
        return (await tx.query(sql, params)).rows;
      });
      return { ok: true, rows };
    } catch (e) { return { ok: false, error: e.message, code: e.code }; }
  };
  const svc = async (sql, p) => { const r = await as("service", sql, p); if (!r.ok) throw new Error(sql + ": " + r.error); return r.rows[0]; };
  const future = new Date(Date.now() + 20 * 86400000).toISOString();
  await svc("select public.turn_set_plan_once('e-d', $1, 'director', 2400, 'sub_d', 'cus_d', $2)", [U.dora.id, future]);
  await svc("select public.turn_set_plan_once('e-p', $1, 'studio', 9000, 'sub_p', 'cus_p', $2)", [U.pat.id, future]);
  await svc("select public.turn_set_plan_once('e-e', $1, 'writer', 800, 'sub_e', 'cus_e', $2)", [U.eve.id, future]);
  await db.query("update public.turn_app_config set value = '{\"on\": true}' where key = 'team_sharing'");
  const invite = async (owner, film, who, role) => {
    const r = await as(owner, "insert into public.turn_project_members(project_id, owner, member_email, role) values ($1,$2,$3,$4) returning id", [film, owner.id, who.email, role]);
    if (!r.ok) throw new Error(r.error);
    await as(who, "select * from public.turn_claim_memberships()");
    return r.rows[0].id;
  };
  await invite(U.dora, FILM, U.cara, "writer");
  const ariRow = await invite(U.dora, FILM, U.ari, "art_director");
  await invite(U.pat, F2, U.sam, "stage_editor");

  const TABLE_FNS = new Set(["turn_credit_balance", "turn_record_usage_event", "turn_credit_regime", "turn_spend_credit", "turn_open_provider_holds"]);
  const callFn = async (who, name, args) => {
    const keys = Object.keys(args || {});
    const params = keys.map((k) => { const v = args[k]; return v != null && typeof v === "object" ? j(v) : v; });
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    const r = await as(who, TABLE_FNS.has(name) ? `select * from ${call}` : `select ${call} as r`, params);
    if (!r.ok) return { data: null, error: { message: r.error, code: r.code } };
    return { data: TABLE_FNS.has(name) ? r.rows : r.rows[0].r, error: null };
  };
  const tokens = Object.fromEntries(Object.entries(U).map(([k, u]) => ["tok-" + k, u]));
  const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",
    FAL_KEY: "fal-key", ANTHROPIC_API_KEY: "anthropic-key", OPENAI_API_KEY: "openai-key", GOOGLE_API_KEY: "google-key", VIDEO_HOLD_SECRET: "video-hold-secret" };
  const rpcs = [];
  const query = (table, who) => {
    const f = {};
    const c = { select: () => c, eq: (col, val) => { f[col] = val; return c; }, gte: () => c, order: () => c,
      limit: () => c, maybeSingle: async () => resolve(true), then: (ok, bad) => resolve(false).then(ok, bad) };
    const resolve = async (single) => {
      if (table === "turn_credits") {
        const owner = who === "service" ? f.owner : who.id;
        const rows = (await db.query("select plan, remaining, plan_remaining, payment_status, frozen from public.turn_credits where owner = $1", [owner])).rows;
        return { data: single ? rows[0] || null : rows, error: null };
      }
      if (table === "turn_billing_state") {
        const rows = (await db.query("select key, at from public.turn_billing_state where key = $1", [f.key])).rows;
        return { data: rows[0] ? { at: new Date(rows[0].at).toISOString() } : null, error: null };
      }
      if (table === "turn_usage_events") return { count: 0, error: null };
      return { data: single ? null : [], error: null };
    };
    return c;
  };
  globalThis.__filmPayerCreateClient = (url, key, opts) => {
    if (key === ENV.SUPABASE_SERVICE_ROLE_KEY) return {
      rpc: async (name, args) => { rpcs.push(["service", name, args]); return callFn("service", name, args); },
      from: (t) => query(t, "service"),
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), createSignedUrl: async (p) => ({ data: { signedUrl: "https://example.supabase.co/s/" + p }, error: null }),
        list: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
    };
    const who = tokens[String(opts?.global?.headers?.Authorization || "").replace(/^Bearer /, "")];
    return {
      auth: { getUser: async (tok) => tokens[tok] ? { data: { user: { id: tokens[tok].id, email: tokens[tok].email } }, error: null } : { data: { user: null }, error: { message: "invalid" } } },
      rpc: async (name, args) => { rpcs.push(["user", name, args]); return who ? callFn(who, name, args) : { data: null, error: { message: "no user" } }; },
      from: (t) => query(t, who),
    };
  };
  nodeModule.registerHooks({ resolve(spec, ctx, next) {
    if (spec === "https://esm.sh/@supabase/supabase-js@2")
      return { url: "data:text/javascript,export const createClient = (...a) => globalThis.__filmPayerCreateClient(...a);", shortCircuit: true };
    return next(spec, ctx);
  } });
  const reply = (status, body) => new Response(j(body), { status, headers: { "content-type": "application/json" } });
  const fal = {}; let falSeq = 0, falNext = "IN_PROGRESS";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = String(init.method || "GET").toUpperCase();
    if (u === "https://api.anthropic.com/v1/messages") return reply(200, { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 3000, output_tokens: 800 }, stop_reason: "end_turn" });
    const fq = /^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/?]+)(\/status)?(?:\?.*)?$/.exec(u);
    if (fq) {
      const job = fal[fq[2]];
      if (!job) return reply(404, { detail: "Request not found" });
      if (fq[3]) return reply(200, { status: job.status, logs: [] });
      return reply(200, /kling/.test(job.endpoint) ? { video: { url: "https://v3.fal.media/files/v.mp4", content_type: "video/mp4" } }
        : { images: [{ url: "https://v3.fal.media/files/i.png", content_type: "image/png" }] });
    }
    if (u.startsWith("https://queue.fal.run/") && method === "POST") {
      const endpoint = u.slice("https://queue.fal.run/".length), id = `7c9e6679-7425-40de-944b-${String(++falSeq).padStart(12, "0")}`;
      fal[id] = { endpoint, status: /kling/.test(endpoint) ? falNext : "COMPLETED" };
      return reply(200, { request_id: id, status: "IN_QUEUE", status_url: `https://queue.fal.run/${endpoint}/requests/${id}/status`, response_url: `https://queue.fal.run/${endpoint}/requests/${id}` });
    }
    if (u.startsWith("https://v3.fal.media/")) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": u.endsWith(".mp4") ? "video/mp4" : "image/png" } });
    throw new Error("network disabled in this test: " + u);
  };
  const realWarn = console.warn, realEmit = process.emitWarning; console.warn = () => {}; process.emitWarning = () => {};
  let handler = null;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => ENV[k] } };
  await import(pathToFileURL(ROOT + "supabase/functions/image-proxy/index.ts").href + "?instance=film-payer");
  process.emitWarning = realEmit;
  const post = async (tok, body) => {
    const res = await handler(new Request("https://example.supabase.co/functions/v1/image-proxy", {
      method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: j(body) }));
    return { status: res.status, json: await res.json() };
  };
  const bal = async (who) => { const r = (await db.query("select remaining from public.turn_credits where owner = $1", [who.id])).rows[0]; return r ? Number(r.remaining) : 0; };
  const lastHold = async () => (await db.query("select ref, owner, actor, member_id, project_id, held, kept, status from public.turn_credit_holds order by created_at desc, ref desc limit 1")).rows[0];
  const ctx = (projectId = FILM) => ({ context: { projectId } });
  const TEXT = (model, extra = {}) => ({ task: "text", usageKind: "writing", provider: "anthropic", model, messages: [{ role: "user", content: "Write scene 4." }], ...extra });
  const IMAGE = (model, imageSize, extra = {}) => ({ task: "image", provider: "fal", model, prompt: "a lighthouse at dusk", aspect: "16:9", imageSize, ...extra });
  const KLING = (extra = {}) => ({ task: "video", op: "submit", model: "fal-ai/kling-video/v3/standard/image-to-video", prompt: "waves", image_urls: ["https://cdn.example.com/f.png"], duration: 5, ...extra });
  try {
    await test("C1 a no-plan Co-writer drafts on a Director owner's film with a premium engine: the owner pays, the hold names who clicked", async () => {
      const dora0 = await bal(U.dora), cara0 = await bal(U.cara);
      const r = await post("tok-cara", TEXT("claude-fable-5", ctx()));
      assert.equal(r.status, 200, j(r.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor, h.project_id, h.status], [U.dora.id, U.cara.id, FILM, "settled"]);
      assert.equal(await bal(U.dora), dora0 - Number(h.kept)); assert.equal(await bal(U.cara), cara0, "Cara's own credits untouched");
      const usage = rpcs.filter((x) => x[1] === "turn_record_usage_event").at(-1);
      assert.equal(usage[2].usage_metadata.paidBy, U.dora.id);
    });
    await test("C2 the same call without the film: Cara's own account (no plan) — refused", async () => {
      const r = await post("tok-cara", TEXT("claude-fable-5"));
      assert.equal(r.status, 402, j(r.json));
    });
    await test("C3 a Co-writer's image on the film is billed as before (to Cara, who can't pay); nothing taken from the owner", async () => {
      const dora0 = await bal(U.dora);
      const r = await post("tok-cara", IMAGE("gemini-3.1-flash-image", "2K", ctx()));
      assert.equal(r.status, 402, j(r.json)); assert.equal(await bal(U.dora), dora0);
    });
    await test("C4 an Art director's 4K image: the owner's plan allows it, the owner pays", async () => {
      const dora0 = await bal(U.dora);
      const r = await post("tok-ari", IMAGE("gemini-3.1-flash-image", "4K", ctx()));
      assert.equal(r.status, 200, j(r.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor, h.member_id], [U.dora.id, U.ari.id, ariRow]); assert.ok(await bal(U.dora) < dora0);
    });
    await test("C5 the owner's plan gates the call: video on a Director film is refused (the Stage is Producer's)", async () => {
      const r = await post("tok-ari", KLING(ctx()));
      assert.notEqual(r.status, 200);
    });
    await test("C6 a Stage editor's video on a Producer film: held on the owner at submit; the collaborator's poll settles it", async () => {
      const pat0 = await bal(U.pat);
      falNext = "IN_PROGRESS";
      const sub = await post("tok-sam", KLING(ctx(F2)));
      assert.equal(sub.status, 200, j(sub.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor, h.status], [U.pat.id, U.sam.id, "held"]); assert.equal(await bal(U.pat), pat0 - Number(h.held));
      fal[sub.json.requestId].status = "COMPLETED";
      const p = await post("tok-sam", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl });
      assert.equal(p.json.status, "COMPLETED", j(p.json));
      assert.equal((await lastHold()).status, "settled");
      const q = await post("tok-eve", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl });
      assert.equal(q.json.code, "render_not_found", "someone else can't collect it");
    });
    await test("C7 the budget stops a call: refused with the budget's words, nothing held", async () => {
      await as(U.dora, "update public.turn_project_members set budget_credits = 1 where id = $1", [ariRow]);
      const dora0 = await bal(U.dora);
      const r = await post("tok-ari", IMAGE("gemini-3.1-flash-image", "2K", ctx()));
      assert.equal(r.status, 402); assert.equal(r.json.code, "budget_reached", j(r.json)); assert.equal(await bal(U.dora), dora0);
      await as(U.dora, "update public.turn_project_members set budget_credits = null where id = $1", [ariRow]);
    });
    await test("C8 the owner's payment failed: generating on the film pauses (owner_plan)", async () => {
      await db.query("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.dora.id]);
      const r = await post("tok-cara", TEXT("claude-opus-5-5", ctx()));
      assert.equal(r.status, 402); assert.equal(r.json.code, "owner_plan", j(r.json));
      await db.query("update public.turn_credits set payment_status = 'active' where owner = $1", [U.dora.id]);
    });
    await test("C9 a forged film id bills the caller: Eve (Writer plan) names Dora's film and pays herself", async () => {
      const dora0 = await bal(U.dora), eve0 = await bal(U.eve);
      const r = await post("tok-eve", TEXT("claude-opus-5-5", ctx()));
      assert.equal(r.status, 200, j(r.json)); assert.equal(await bal(U.dora), dora0); assert.ok(await bal(U.eve) < eve0);
    });
    await test("C10 switched off: a collaborator is billed as before", async () => {
      await db.query("update public.turn_app_config set value = '{\"on\": false}' where key = 'team_sharing'");
      const dora0 = await bal(U.dora);
      const r = await post("tok-cara", TEXT("claude-fable-5", ctx()));
      assert.equal(r.status, 402); assert.equal(await bal(U.dora), dora0);
      await db.query("update public.turn_app_config set value = '{\"on\": true}' where key = 'team_sharing'");
    });
  } finally { globalThis.fetch = realFetch; console.warn = realWarn; }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

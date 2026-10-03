#!/usr/bin/env node
/* supabase/functions/invite-collaborator/core.mjs — the invitation email (Team relaunch, 2026-10-03).
   The memo's three fixes and the caps, against a recording Supabase stub:
     A the link's host is fixed — whatever Origin or body the browser sends
     B one answer whether or not the address has an account; one wording for any failure
     C owner only, never yourself, a real active unexpired invite, the switch and the owner's plan
     D one email per invite per 10 minutes; 40 a day per owner; each send is logged
     E CORS answers only the app's hosts
     node scripts/test-invite-collaborator.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../supabase/functions/invite-collaborator/core.mjs";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e && (e.stack || e.message) || e).split("\n").slice(0, 4).join("\n  ")); }
}
const FILM = "f1000000-0000-4000-8000-000000000001", OWNER = "a0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-03T12:00:00Z");

function world(o = {}) {
  const W = { mails: [], otps: [], updates: [], logs: [], tier: "director", on: true, existing: false, failInvite: false, failOtp: false,
    member: { id: "m1", role: "writer", status: "active", member_user: null, expires_at: new Date(NOW + 86400000).toISOString(), email_sent_at: null },
    sentToday: 0, project: { id: FILM, owner: OWNER, title: "Neon Harbor" },
    users: { "tok-owner": { id: OWNER, email: "owner@example.com" }, "tok-other": { id: "b0000000-0000-4000-8000-000000000002", email: "other@example.com" },
      "tok-admin": { id: "c0000000-0000-4000-8000-000000000003", email: "admin@infinitestudioai.com" } }, ...o };
  const from = (table) => {
    const f = {};
    const c = {
      select: (_cols, opts) => { f.count = !!(opts && opts.count); return c; },
      eq: (k, v) => { f[k] = v; return c; }, gte: (k, v) => { f["gte_" + k] = v; return c; },
      maybeSingle: async () => {
        if (table === "turn_projects") return { data: f.id === W.project.id ? W.project : null, error: null };
        if (table === "turn_project_members") return { data: f.member_email === "cara@example.com" ? W.member : null, error: null };
        return { data: null, error: null };
      },
      then: (ok, bad) => Promise.resolve(table === "turn_team_invite_log" ? { count: W.sentToday, error: null } : { data: [], error: null }).then(ok, bad),
      update: (row) => ({ eq: async (k, v) => { W.updates.push([table, row, k, v]); return { error: null }; } }),
      insert: async (row) => { W.updates.push([table + ":insert", row]); return { error: null }; },
    };
    return c;
  };
  const createClient = (url, key, opts) => {
    const tok = String(opts?.global?.headers?.Authorization || "").replace(/^Bearer /, "");
    return {
      auth: {
        getUser: async (t) => (W.users[t] ? { data: { user: W.users[t] }, error: null } : { data: { user: null }, error: { message: "bad" } }),
        admin: { inviteUserByEmail: async (email, opt) => {
          W.mails.push([email, opt]);
          if (W.failInvite) return { error: { message: "smtp down" } };
          return W.existing ? { error: { message: "A user with this email address has already been registered", code: "email_exists" } } : { data: { user: { id: "new" } }, error: null };
        } },
        signInWithOtp: async (a) => { W.otps.push(a); return W.failOtp ? { error: { message: "rate" } } : { error: null }; },
      },
      rpc: async (name) => name === "turn_team_sharing_on" ? { data: W.on, error: null }
        : name === "turn_team_owner_tier" ? { data: W.tier, error: null } : { data: null, error: { message: "unexpected" } },
      from, _key: key, _tok: tok,
    };
  };
  const env = (k) => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" })[k];
  W.handle = C.createInviteHandler({ createClient, env, now: () => NOW, log: (m) => W.logs.push(m) });
  W.post = async (tok, body, origin = "https://kinolot.infinitestudioai.com") => {
    const res = await W.handle(new Request("https://x.supabase.co/functions/v1/invite-collaborator", { method: "POST",
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json(), headers: res.headers };
  };
  return W;
}
const ASK = { projectId: FILM, email: "Cara@Example.com" };

await test("A1 the link is always https://kinolot.infinitestudioai.com/?invite=<film> — never from the browser", async () => {
  const W = world();
  const r = await W.post("tok-owner", { ...ASK, origin: "https://evil.example" }, "https://evil.example");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(W.mails[0][1].redirectTo, "https://kinolot.infinitestudioai.com/?invite=" + FILM);
  assert.equal(W.mails[0][0], "cara@example.com", "lower-cased");
  const W2 = world({ existing: true });
  await W2.post("tok-owner", ASK, "http://localhost:5050");
  assert.equal(W2.otps[0].options.emailRedirectTo, "https://kinolot.infinitestudioai.com/?invite=" + FILM);
  assert.equal(W2.otps[0].options.shouldCreateUser, false);
  assert.ok(!readFileSync(new URL("../supabase/functions/invite-collaborator/core.mjs", import.meta.url), "utf8").includes("body.origin"), "the body's origin isn't read");
});
await test("B1 one answer whether or not the address has an account", async () => {
  const a = await world({ existing: false }).post("tok-owner", ASK);
  const b = await world({ existing: true }).post("tok-owner", ASK);
  assert.deepEqual([a.status, a.json], [b.status, b.json]);
  assert.deepEqual(a.json, { ok: true, sent: true, message: "Invitation sent." });
});
await test("B2 one wording for any failure (no provider detail, no account hint)", async () => {
  const a = await world({ failInvite: true }).post("tok-owner", ASK);
  const b = await world({ existing: true, failOtp: true }).post("tok-owner", ASK);
  assert.equal(a.status, 502); assert.deepEqual(a.json, b.json);
  assert.doesNotMatch(a.json.message, /smtp|rate|registered|exists/i);
});
await test("B3 a new account is never linked to the film here (the invitee's confirmed sign-in claims it)", async () => {
  const W = world();
  await W.post("tok-owner", ASK);
  assert.ok(!W.updates.some(([t, row]) => t === "turn_project_members" && "member_user" in row));
});
await test("C1 owner only; never your own address; bad input", async () => {
  const W = world();
  assert.equal((await W.post("tok-other", ASK)).json.code, "owner_only");
  assert.equal((await W.post("tok-owner", { ...ASK, email: "owner@example.com" })).json.code, "self");
  assert.equal((await W.post("tok-owner", { ...ASK, email: "nope" })).json.code, "bad_email");
  assert.equal((await W.post("tok-owner", { ...ASK, projectId: "x" })).status, 400);
  assert.equal((await W.post("nobody", ASK)).status, 401);
  assert.equal(W.mails.length, 0);
});
await test("C2 a real, active, unexpired invite with one of the four roles", async () => {
  let W = world(); assert.equal((await W.post("tok-owner", { ...ASK, email: "zed@example.com" })).json.code, "no_invite");
  W = world(); W.member.status = "removed"; assert.equal((await W.post("tok-owner", ASK)).json.code, "no_invite");
  W = world(); W.member.expires_at = new Date(NOW - 1000).toISOString(); assert.equal((await W.post("tok-owner", ASK)).json.code, "expired");
  W = world(); W.member.role = "stage_editor"; assert.equal((await W.post("tok-owner", ASK)).status, 200);
});
await test("C3 sharing switched off, or the owner below Director: nothing is sent (the admin can still test)", async () => {
  let W = world({ on: false }); assert.equal((await W.post("tok-owner", ASK)).json.code, "paused");
  W = world({ tier: "none" }); assert.equal((await W.post("tok-owner", ASK)).json.code, "plan_required");
  assert.equal(W.mails.length, 0);
  W = world({ on: false }); assert.equal((await W.post("tok-admin", ASK)).status, 200);
});
await test("D1 one email per invite per 10 minutes; each send is recorded", async () => {
  const W = world();
  assert.equal((await W.post("tok-owner", ASK)).status, 200);
  assert.ok(W.updates.some(([t, row]) => t === "turn_project_members" && row.email_sent_at));
  assert.ok(W.updates.some(([t, row]) => t === "turn_team_invite_log:insert" && row.kind === "email" && row.owner === OWNER));
  W.member.email_sent_at = new Date(NOW - 60000).toISOString();
  const r = await W.post("tok-owner", ASK);
  assert.equal(r.status, 429); assert.equal(r.json.code, "too_soon");
  W.member.email_sent_at = new Date(NOW - 11 * 60000).toISOString();
  assert.equal((await W.post("tok-owner", ASK)).status, 200);
});
await test("D2 40 invitation emails a day per owner", async () => {
  const W = world({ sentToday: 40 });
  const r = await W.post("tok-owner", ASK);
  assert.equal(r.status, 429); assert.equal(r.json.code, "daily_cap"); assert.equal(W.mails.length, 0);
});
await test("E1 CORS answers only the app's hosts", () => {
  assert.equal(C.corsFor("https://kinolot.infinitestudioai.com")["Access-Control-Allow-Origin"], "https://kinolot.infinitestudioai.com");
  assert.equal(C.corsFor("https://cinema.infinitestudioai.com")["Access-Control-Allow-Origin"], "https://cinema.infinitestudioai.com");
  assert.equal(C.corsFor("http://localhost:5050")["Access-Control-Allow-Origin"], "http://localhost:5050");
  for (const o of ["https://evil.example", "http://kinolot.infinitestudioai.com", "https://kinolot.infinitestudioai.com:8443", "", null, "https://kinolot.infinitestudioai.com.evil.example"])
    assert.equal(C.corsFor(o)["Access-Control-Allow-Origin"], undefined, String(o));
});
await test("E2 index.ts only wires core.mjs (nothing else to keep in step)", () => {
  const src = readFileSync(new URL("../supabase/functions/invite-collaborator/index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('import { createInviteHandler } from "./core.mjs";') && src.includes("Deno.serve(createInviteHandler({"));
  assert.ok(!/inviteUserByEmail|signInWithOtp/.test(src));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* supabase/team-relaunch.sql — EXECUTED against an in-memory Postgres (PGlite), on top of the files
   production has (schema, storage, team-collaboration, shared-owners, enforce-role-scopes, cameos,
   credits, app-config, series-production). The owner's rules (docs/Dashboard Plan.md §5-§7, §9):
   Director and up shares; 5 / 10 people a film (pending count); 3 Co-writers; 20 new invites a day;
   invites expire after 14 days and need a confirmed email; Stage editor on Producer films only; rooms
   follow the owner's plan (below Director → read-only); the owner pays within each person's budget
   (200 Director / 500 Producer). Uses the harness of scripts/test-series-production-sql.mjs.
   Q (Team review, 2026-10-09): every fix of that pass on two fresh databases — the 2026-10-03 file
   (from git) shows each bug, today's file the fix — then today's file installed over the old one.
   S (Stage editor review, 2026-10-09): the same pattern against production's file (151175c): Stage slots
   checked by shape and cleanup paths (the P1/P1b probes), linked memberships write, the Stage editor's
   shot/project scope with coded refusals, the kinds of paid calls, takes protected, finished renders
   collected, spend views, re-holds; then today's file over production's, and series-production.sql re-run.
     node scripts/test-team-relaunch-db.mjs */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)[1];
const RELAUNCH = read("supabase/team-relaunch.sql");
const CHAIN = ["schema.sql", "storage.sql", "team-collaboration.sql", "shared-owners.sql", "enforce-role-scopes.sql",
  "cameos.sql", "credits.sql", "app-config.sql", "series-production.sql"];

let passes = 0, failures = 0;
const ok = (name, cond, detail) => {
  if (cond) { passes++; console.log("PASS " + name); }
  else { failures++; console.log("FAIL " + name + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
};

const U = {
  dora:  { id: "d0000000-0000-4000-8000-000000000001", email: "dora@example.com" },    // Director owner
  pat:   { id: "d0000000-0000-4000-8000-000000000002", email: "pat@example.com" },     // Producer owner
  wes:   { id: "d0000000-0000-4000-8000-000000000003", email: "wes@example.com" },     // Writer-plan owner
  cara:  { id: "d0000000-0000-4000-8000-000000000004", email: "cara@example.com" },    // collaborator, no plan
  uma:   { id: "d0000000-0000-4000-8000-000000000005", email: "uma@example.com", unconfirmed: true },
  eve:   { id: "d0000000-0000-4000-8000-000000000006", email: "eve@example.com" },     // outsider
  vic:   { id: "d0000000-0000-4000-8000-000000000007", email: "vic@example.com" },     // view-only
  sam:   { id: "d0000000-0000-4000-8000-000000000008", email: "sam@example.com" },     // Stage editor
  admin: { id: "d0000000-0000-4000-8000-000000000009", email: "admin@infinitestudioai.com" },
};
const F = {
  dora1: "f0000000-0000-4000-8000-000000000001", dora2: "f0000000-0000-4000-8000-000000000002",
  pat1:  "f0000000-0000-4000-8000-000000000003", wes1:  "f0000000-0000-4000-8000-000000000004",
  admin1:"f0000000-0000-4000-8000-000000000005",
};
for (let i = 0; i < 6; i++) F["patx" + i] = `f0000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(STUB);
for (const u of Object.values(U))
  await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,$3)",
    [u.id, u.email, u.unconfirmed ? null : new Date(Date.now() - 86400000)]);
for (const f of CHAIN) {
  try { await db.exec(read("supabase/" + f)); }
  catch (e) { console.log("FAIL prerequisite " + f + ": " + e.message); process.exit(1); }
}
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
async function as(who, sql, p = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
      return (await tx.query(sql, p)).rows;
    });
    return { ok: true, rows, row: rows[0] };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function asTx(who, fn) {
  try {
    const rows = await db.transaction(async (tx) => {
      const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
      return fn(tx);
    });
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: e.message }; }
}
const svc = async (sql, p) => { const r = await as("service", sql, p); if (!r.ok) throw new Error(sql + " → " + r.error); return r.row; };
const doc = (t) => JSON.stringify({ scenes: [{ id: "s1" }], characters: [], shots: [], project: { title: t }, _rev: 1 });
for (const [id, owner, title] of [[F.dora1, U.dora, "Dora One"], [F.dora2, U.dora, "Dora Two"], [F.pat1, U.pat, "Pat One"],
  [F.wes1, U.wes, "Wes One"], [F.admin1, U.admin, "Admin One"], ...[0, 1, 2, 3, 4, 5].map((i) => [F["patx" + i], U.pat, "Pat X" + i])])
  await q("insert into public.turn_projects(id, owner, title, doc) values ($1,$2,$3,$4::jsonb)", [id, owner.id, title, doc(title)]);
await svc("select public.turn_set_plan_once('e-dora', $1, 'director', 1600, 'sub_d', 'cus_d', now() + interval '30 days')", [U.dora.id]);
await svc("select public.turn_set_plan_once('e-pat', $1, 'studio', 5000, 'sub_p', 'cus_p', now() + interval '30 days')", [U.pat.id]);
await svc("select public.turn_set_plan_once('e-wes', $1, 'writer', 600, 'sub_w', 'cus_w', now() + interval '30 days')", [U.wes.id]);

const invite = (owner, film, email, role = "writer", extra = "") =>
  as(owner, `insert into public.turn_project_members(project_id, owner, member_email, role${extra ? ", member_user" : ""})
             values ($1, $2, $3, $4${extra ? ", $5" : ""}) returning *`, extra ? [film, owner.id, email, role, extra] : [film, owner.id, email, role]);
const canRead = async (who, film) => (await as(who, "select count(*)::int n from public.turn_projects where id = $1", [film])).row?.n === 1;
const saveSection = (who, film, key, value) =>
  as(who, `update public.turn_projects set doc = jsonb_set(doc, $2::text[], $3::jsonb) where id = $1 returning id`,
    [film, `{${key}}`, JSON.stringify(value)]);
const code = (r) => (/TURN_TEAM:([a-z_]+)/.exec(r.error || "") || [])[1];

/* ── A. the file ─────────────────────────────────────────────────────────── */
let r;
try { await db.exec(RELAUNCH); r = { ok: true }; } catch (e) { r = { ok: false, error: e.message }; }
ok("A1 team-relaunch.sql runs after series-production.sql", r.ok, r.error);
try { await db.exec(RELAUNCH); r = { ok: true }; } catch (e) { r = { ok: false, error: e.message }; }
ok("A2 and again (idempotent)", r.ok, r.error);
ok("A3 the switch starts off", (await q("select value from public.turn_app_config where key='team_sharing'"))[0]?.value?.on === false);

/* ── B. the switch, the owner's plan ─────────────────────────────────────── */
r = await invite(U.dora, F.dora1, "cara@example.com");
ok("B1 switch off: an owner can't invite", !r.ok && code(r) === "paused", r.error);
r = await invite(U.admin, F.admin1, "cara@example.com", "view_only");
ok("B2 switch off: the admin still can (testing)", r.ok, r.error);
await q("update public.turn_app_config set value = '{\"on\": true}' where key = 'team_sharing'");
r = await invite(U.wes, F.wes1, "cara@example.com");
ok("B3 a Writer-plan owner can't share", !r.ok && code(r) === "plan_required", r.error);
r = await invite(U.dora, F.dora1, "dora@example.com");
ok("B4 nobody invites themselves", !r.ok && code(r) === "self", r.error);
r = await invite(U.dora, F.dora1, "eve@example.com", "writer", U.eve.id);
ok("B5 a forged member_user is dropped: the row starts unlinked", r.ok && r.row.member_user === null, r.row || r.error);
await as(U.dora, "delete from public.turn_project_members where member_email = 'eve@example.com'");
r = await invite(U.dora, F.dora1, "Cara@Example.com ");
ok("B6 a Director owner invites: lower-cased, 14-day expiry, budget 200",
  r.ok && r.row.member_email === "cara@example.com" && r.row.budget_credits === 200 &&
  Math.abs(new Date(r.row.expires_at) - Date.now() - 14 * 86400000) < 60000, r.row || r.error);
const caraRow = r.row?.id;
r = await invite(U.dora, F.dora1, "eve@example.com", "stage_editor");
ok("B7 Stage editor needs a Producer film", !r.ok && code(r) === "stage_editor_producer", r.error);
r = await as(U.eve, "insert into public.turn_project_members(project_id, owner, member_email, role) values ($1, $2, 'x@example.com', 'writer')", [F.dora1, U.eve.id]);
ok("B8 only the owner adds people", !r.ok, r.error);

/* ── C. access by account, confirmed, not expired ───────────────────────── */
ok("C1 an invited, confirmed address opens the film before claiming", await canRead(U.cara, F.dora1));
await invite(U.dora, F.dora1, "uma@example.com", "view_only");
ok("C2 an unconfirmed address doesn't", !(await canRead(U.uma, F.dora1)));
r = await as(U.uma, "select * from public.turn_claim_memberships()");
ok("C3 an unconfirmed account claims nothing", r.ok && r.rows.length === 0, r);
r = await as(U.cara, "select * from public.turn_claim_memberships()");
ok("C4 Cara claims (her two invites): linked to her account", r.ok && r.rows.length === 2 && r.rows.some((x) => x.title === "Dora One") &&
  (await q("select member_user, expires_at from public.turn_project_members where id=$1", [caraRow]))[0].member_user === U.cara.id, r);
ok("C5 a joined row has no expiry", (await q("select expires_at from public.turn_project_members where id=$1", [caraRow]))[0].expires_at === null);
await q("insert into auth.users(id, email, email_confirmed_at) values ('d0000000-0000-4000-8000-0000000000aa', 'cara@example.com', now())");
ok("C6 a second account with the same address gets nothing once the invite is linked",
  !(await canRead({ id: "d0000000-0000-4000-8000-0000000000aa", email: "cara@example.com" }, F.dora1)));
await q("update auth.users set email = 'cara.new@example.com' where id = $1", [U.cara.id]);
ok("C7 the linked account keeps access after changing its address", await canRead({ ...U.cara, email: "cara.new@example.com" }, F.dora1));
await q("update auth.users set email = 'cara@example.com' where id = $1", [U.cara.id]);
r = await invite(U.dora, F.dora2, "vic@example.com", "view_only");
await q("update public.turn_project_members set expires_at = now() - interval '1 minute' where id = $1", [r.row.id]);
ok("C8 an expired invite opens nothing", !(await canRead(U.vic, F.dora2)));
r = await as(U.vic, "select * from public.turn_claim_memberships()");
ok("C9 and can't be claimed", r.ok && r.rows.length === 0, r);
const vicRow = (await q("select id from public.turn_project_members where member_email='vic@example.com' and project_id=$1", [F.dora2]))[0].id;
r = await as(U.dora, "select public.turn_renew_invite($1) j", [vicRow]);
ok("C10 the owner renews it: 14 more days", r.ok && (await canRead(U.vic, F.dora2)), r.error);
await as(U.vic, "select * from public.turn_claim_memberships()");

/* ── D. the browser can't rewrite the row ────────────────────────────────── */
r = await as(U.dora, "update public.turn_project_members set member_email='eve@example.com', member_user=$2, expires_at=now()+interval '99 days' where id=$1 returning *", [caraRow, U.eve.id]);
ok("D1 address, linked account and expiry stay as they were",
  r.ok && r.row.member_email === "cara@example.com" && r.row.member_user === U.cara.id && r.row.expires_at === null, r.row || r.error);
ok("D2 the outsider still can't open it", !(await canRead(U.eve, F.dora1)));

/* ── E. caps ─────────────────────────────────────────────────────────────── */
// Dora One has Cara (writer) + Uma (pending view-only): 2 of 5
for (const e of ["a1@example.com", "a2@example.com", "a3@example.com"]) await invite(U.dora, F.dora1, e, "view_only");
r = await invite(U.dora, F.dora1, "a4@example.com", "view_only");
ok("E1 Director: the 6th person is refused (pending invites count)", !r.ok && code(r) === "cap", r.error);
await q("update public.turn_project_members set expires_at = now() - interval '1 minute' where member_email = 'a3@example.com'");
r = await invite(U.dora, F.dora1, "a4@example.com", "view_only");
ok("E2 an expired invite frees its place", r.ok, r.error);
for (const e of ["w1@example.com", "w2@example.com"]) await invite(U.pat, F.pat1, e, "writer");
await invite(U.pat, F.pat1, "w3@example.com", "writer");
r = await invite(U.pat, F.pat1, "w4@example.com", "writer");
ok("E3 a 4th Co-writer is refused", !r.ok && code(r) === "cowriter_cap", r.error);
r = await invite(U.pat, F.pat1, "sam@example.com", "stage_editor");
ok("E4 Producer: Stage editor allowed, budget 500", r.ok && r.row.budget_credits === 500, r.row || r.error);
await as(U.sam, "select * from public.turn_claim_memberships()");
for (let i = 0; i < 6; i++) await invite(U.pat, F.pat1, `p${i}@example.com`, "view_only");
r = await invite(U.pat, F.pat1, "p9@example.com", "view_only");
ok("E5 Producer: the 11th person is refused", !r.ok && code(r) === "cap", r.error);
// Pat has sent 3 + 1 + 6 = 10 (+ the refused) today; ten more across other films reach 20
for (let i = 0; i < 10; i++) await invite(U.pat, F["patx" + (i % 6)], `d${i}@example.com`, "view_only");
r = await invite(U.pat, F.patx5, "d99@example.com", "view_only");
ok("E6 the 21st new invite in a day is refused", !r.ok && code(r) === "daily_cap", r.error);
r = await as(U.pat, "update public.turn_project_members set budget_credits = 50 where member_email = 'sam@example.com' returning budget_credits");
ok("E7 changing a budget isn't an invite (allowed past the daily cap)", r.ok && r.row.budget_credits === 50, r.error);

/* ── F. roles write their own sections; the owner's plan decides ─────────── */
r = await saveSection(U.cara, F.dora1, "scenes", [{ id: "s1", title: "Cara" }]);
ok("F1 a Co-writer saves the story", r.ok && r.rows.length === 1, r.error);
r = await saveSection(U.cara, F.dora1, "characters", [{ id: "x" }]);
ok("F2 but not the Art Room", !r.ok && /TURN_ROLE_SCOPE/.test(r.error), r.error);
// (Stage editor review 2026-10-09) the owner designs the shot; the Stage editor changes its Stage fields only
await q(`update public.turn_projects set doc = jsonb_set(doc, '{shots}', '[{"id":"sh1","size":"MS"}]') where id = $1`, [F.pat1]);
r = await saveSection(U.sam, F.pat1, "shots", [{ id: "sh1", size: "MS", dialogue: "Hello." }]);
ok("F3 a Stage editor saves a shot's dialogue on a Producer film", r.ok && r.rows.length === 1, r.error);
r = await saveSection(U.sam, F.pat1, "scenes", []);
ok("F4 but not the story", !r.ok && /TURN_ROLE_SCOPE/.test(r.error), r.error);
r = await as(U.sam, "select public.turn_can_write_assets($1) w", [F.pat1]);
ok("F5 a Stage editor doesn't write the Art Room's files (Team review 2026-10-09: the Stage keeps none there)", r.ok && r.row.w === false, r);
r = await as(U.vic, "select public.turn_can_access_project($1, true) w", [F.dora2]);
ok("F6 View-only never writes", r.ok && r.row.w === false, r);
await q("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.dora.id]);
r = await saveSection(U.cara, F.dora1, "scenes", [{ id: "s1", title: "late" }]);
ok("F7 owner's payment failed: the Co-writer's save changes nothing (read-only)",
  (r.ok && r.rows.length === 0) || /read-only/.test(r.error || ""), r);
ok("F8 but still opens the film", await canRead(U.cara, F.dora1));
r = await invite(U.dora, F.dora1, "z@example.com", "view_only");
ok("F9 and the owner can't invite", !r.ok && code(r) === "plan_required", r.error);
r = await as(U.dora, "update public.turn_project_members set status='removed' where member_email='a4@example.com' returning id");
ok("F10 removing someone needs no plan", r.ok && r.rows.length === 1, r.error);
await q("update public.turn_credits set payment_status = 'active' where owner = $1", [U.dora.id]);
r = await as(U.cara, "select public.turn_film_owner_tier($1) t", [F.dora1]);
ok("F11 a collaborator reads the owner's tier (rooms follow it)", r.ok && r.row.t === "director", r);
r = await as(U.eve, "select public.turn_film_owner_tier($1) t", [F.dora1]);
ok("F12 an outsider reads nothing", r.ok && r.row.t === null, r);

/* ── G. a private member list; leaving ───────────────────────────────────── */
r = await as(U.cara, "select member_email from public.turn_project_members where project_id = $1", [F.dora1]);
ok("G1 a collaborator sees only their own row", r.ok && r.rows.length === 1 && r.rows[0].member_email === "cara@example.com", r.rows);
r = await as(U.dora, "select count(*)::int n from public.turn_project_members where project_id = $1 and status='active'", [F.dora1]);
ok("G2 the owner sees everyone", r.ok && r.row.n >= 5, r.row);
r = await as(U.vic, "select public.turn_leave_film($1) n", [F.dora2]);
ok("G3 Leave film: Vic's access ends at once", r.ok && r.row.n === 1 && !(await canRead(U.vic, F.dora2)), r);

/* ── H. the owner pays, within the budget ────────────────────────────────── */
const bal = async (who) => (await q("select remaining from public.turn_credits where owner=$1", [who.id]))[0]?.remaining ?? null;
const payer = async (who, film, room) => (await svc("select public.turn_film_payer($1,$2,$3) j", [who.id, film, room])).j;
let p = await payer(U.cara, F.dora1, "text");
ok("H1 Cara writing on Dora's film: Dora pays, budget 200", p.ok && p.payer === U.dora.id && p.budget === 200 && p.spent === 0, p);
ok("H2 the owner on her own film: her own", (await payer(U.dora, F.dora1, "text")).own === true);
ok("H3 an outsider: billed as before (not a member)", (await payer(U.eve, F.dora1, "text")).code === "not_member");
ok("H4 a Co-writer making Art Room images: 'role' (the server refuses it, decision C)", (await payer(U.cara, F.dora1, "image")).code === "role");
const dora0 = await bal(U.dora), cara0 = await bal(U.cara);
let h = (await svc("select public.turn_hold_credits_for_film($1,$2,$3,$4,150,'text:t1','text') j", [U.dora.id, U.cara.id, p.member_id, F.dora1])).j;
ok("H5 a 150-credit hold comes from Dora's balance", h.ok && (await bal(U.dora)) === dora0 - 150 && (await bal(U.cara)) === cara0, { h, dora: await bal(U.dora) });
h = (await svc("select public.turn_hold_credits_for_film($1,$2,$3,$4,100,'text:t2','text') j", [U.dora.id, U.cara.id, p.member_id, F.dora1])).j;
ok("H6 100 more would pass 200: refused, nothing taken", !h.ok && h.code === "budget_reached" && (await bal(U.dora)) === dora0 - 150, h);
h = (await svc("select public.turn_hold_credits_for_film($1,$2,$3,$4,150,'text:t1','text') j", [U.dora.id, U.cara.id, p.member_id, F.dora1])).j;
ok("H7 a repeat of the same hold is the first answer", h.ok && h.duplicate === true && (await bal(U.dora)) === dora0 - 150, h);
await svc("select public.turn_settle_hold('text:t1', 120)");
ok("H8 settled at 120: 30 back to Dora", (await bal(U.dora)) === dora0 - 120);
ok("H8b the hold records who started it", (await svc("select public.turn_hold_actor('text:t1') a")).a === U.cara.id);
r = await as(U.dora, "select * from public.turn_team_spend($1)", [F.dora1]);
const caraSpend = r.rows?.find((x) => x.member_id === p.member_id);
ok("H9 the owner sees Cara's use this month", caraSpend && caraSpend.spent === 120 && caraSpend.budget === 200, r.rows);
r = await as(U.cara, "select * from public.turn_team_spend($1)", [F.dora1]);
ok("H10 Cara sees her own use only", r.ok && r.rows.length === 1 && r.rows[0].spent === 120, r.rows);
await as(U.dora, "update public.turn_project_members set budget_credits = 120 where id = $1", [p.member_id]);
ok("H11 budget reached: the payer check refuses", (await payer(U.cara, F.dora1, "text")).code === "budget_reached");
await as(U.dora, "update public.turn_project_members set budget_credits = null where id = $1", [p.member_id]);
ok("H12 no limit: allowed again", (await payer(U.cara, F.dora1, "text")).ok === true);
p = await payer(U.sam, F.pat1, "video");
ok("H13 the Stage editor on Pat's film: Pat pays", p.ok && p.payer === U.pat.id && p.budget === 50, p);
ok("H13b the Stage editor's writing call on the film: Pat pays too", (await payer(U.sam, F.pat1, "text")).payer === U.pat.id);
ok("H13c but not 3D (Art director's)", (await payer(U.sam, F.pat1, "3d")).code === "role");
await q("update public.turn_credits set plan = 'writer' where owner = $1", [U.pat.id]);
ok("H14 Pat drops to Writer: generations on the film stop (owner_plan)", (await payer(U.sam, F.pat1, "video")).code === "owner_plan");
await q("update public.turn_credits set plan = 'studio' where owner = $1", [U.pat.id]);
await q("update public.turn_app_config set value = '{\"on\": false}' where key = 'team_sharing'");
ok("H15 switch off: a collaborator's call is refused (paused), never billed to anyone (decision B)", (await payer(U.cara, F.dora1, "text")).code === "paused");
ok("H15b switch off: an outsider is still not a member", (await payer(U.eve, F.dora1, "text")).code === "not_member");
await q("update public.turn_app_config set value = '{\"on\": true}' where key = 'team_sharing'");

/* ── M. several roles per person (owner 2026-10-03) ─────────────────────── */
r = await invite(U.admin, F.admin1, "multi@example.com", "writer");
const multiRow = r.row?.id;
r = await as(U.admin, "update public.turn_project_members set roles = array['art_director','writer','writer'] where id = $1 returning role, roles", [multiRow]);
ok("M1 a person can hold Co-writer AND Art director; the set is canonical and `role` its first entry",
  r.ok && JSON.stringify(r.row.roles) === JSON.stringify(["writer", "art_director"]) && r.row.role === "writer", r.row || r.error);
await q("insert into auth.users(id, email, email_confirmed_at) values ('d0000000-0000-4000-8000-0000000000bb', 'multi@example.com', now())");
const MU = { id: "d0000000-0000-4000-8000-0000000000bb", email: "multi@example.com" };
await as(MU, "select * from public.turn_claim_memberships()");
r = await saveSection(MU, F.admin1, "scenes", [{ id: "m" }]);
const rs = await saveSection(MU, F.admin1, "characters", [{ id: "m" }]);
ok("M2 both roles' sections save (story and Art Room)", r.ok && r.rows.length === 1 && rs.ok && rs.rows.length === 1, { r, rs });
r = await saveSection(MU, F.admin1, "zz_unknown", 1);
ok("M3 but nothing outside the roles' sections", !r.ok && /TURN_ROLE_SCOPE/.test(r.error), r.error);
r = await saveSection(MU, F.admin1, "sluglineUnits", [{ key: "u1" }]);
ok("M3b the Art director part saves the location units (sluglineUnits)", r.ok && r.rows.length === 1, r.error);
r = await saveSection(MU, F.admin1, "cover", "data:image/png;base64,x");
ok("M3c but never the owner's poster", !r.ok && /TURN_ROLE_SCOPE/.test(r.error), r.error);
r = await as(MU, "select public.turn_can_write_assets($1) w", [F.admin1]);
ok("M4 the Art director part writes files", r.ok && r.row.w === true);
let pp = (await svc("select public.turn_film_payer($1,$2,'image') j", [MU.id, F.admin1])).j;
ok("M5 an image call fits the Art director part: the owner pays", pp.ok && pp.payer === U.admin.id, pp);
r = await as(U.admin, "update public.turn_project_members set roles = array['view_only','writer'] where id = $1 returning roles", [multiRow]);
ok("M6 View-only can't be combined: the editing role wins", r.ok && JSON.stringify(r.row.roles) === JSON.stringify(["writer"]), r.row || r.error);
r = await as(U.admin, "update public.turn_project_members set roles = array['view_only'] where id = $1 returning roles, role", [multiRow]);
ok("M7 View-only alone", r.ok && r.row.role === "view_only", r.row || r.error);
r = await as(U.admin, "update public.turn_project_members set roles = array[]::text[] where id = $1", [multiRow]);
ok("M8 no role at all is refused", !r.ok && code(r) === "no_role", r.error);
r = await as(U.admin, "update public.turn_project_members set role = 'art_director' where id = $1 returning roles", [multiRow]);
ok("M9 an older app that changes only `role` sets that one role", r.ok && JSON.stringify(r.row.roles) === JSON.stringify(["art_director"]), r.row || r.error);
r = await as(U.dora, "update public.turn_project_members set roles = array['art_director','stage_editor'] where member_email = 'cara@example.com' and project_id = $1", [F.dora1]);
ok("M10 a combination with Stage editor still needs a Producer film", !r.ok && code(r) === "stage_editor_producer", r.error);
// Pat One already holds 3 Co-writers (w1-w3): adding Co-writer to Sam (Stage editor) is refused
r = await as(U.pat, "update public.turn_project_members set roles = array['writer','stage_editor'] where member_email = 'sam@example.com' and project_id = $1", [F.pat1]);
ok("M11 the 3-Co-writer cap counts everyone who holds Co-writer", !r.ok && code(r) === "cowriter_cap", r.error);
r = await as(MU, "select * from public.turn_claim_memberships()");
await as(U.admin, "update public.turn_project_members set roles = array['writer','art_director'] where id = $1", [multiRow]);
r = await as(U.admin, "select role from public.turn_team_notifications() where member_id = $1", [multiRow]);
ok("M12 the owner's notifications name every role ('writer+art_director')", r.ok && r.row && r.row.role === "writer+art_director", r.rows);

/* ── N. the owner's notifications ────────────────────────────────────────── */
r = await as(U.dora, "select * from public.turn_team_notifications()");
const caraNote = r.rows?.find((x) => x.member_email === "cara@example.com");
ok("N1 the owner sees who joined which film, with the role, unseen", r.ok && caraNote && caraNote.title === "Dora One" && caraNote.role === "writer" && caraNote.seen === false && caraNote.joined_at, r.rows);
ok("N2 only joins: an unanswered invite isn't one", !r.rows.some((x) => x.member_email === "uma@example.com"));
r = await as(U.cara, "select * from public.turn_team_notifications()");
ok("N3 a collaborator sees nobody's joins on films they don't own", r.ok && r.rows.length === 0, r.rows);
r = await as(U.dora, "select public.turn_team_notifications_seen() n");
ok("N4 opening the bell marks them seen", r.ok && r.row.n >= 1 && (await as(U.dora, "select bool_and(seen) s from public.turn_team_notifications()")).row.s === true, r);
r = await as(U.dora, "update public.turn_project_members set joined_at = now() - interval '99 days', owner_seen_at = null where id = $1 returning joined_at, owner_seen_at", [caraRow]);
ok("N5 the browser can't rewrite the join time or the seen mark", r.ok && Date.now() - new Date(r.row.joined_at) < 86400000 && r.row.owner_seen_at !== null, r.row || r.error);

/* ── P. privileges ───────────────────────────────────────────────────────── */
r = await as(U.cara, "select public.turn_film_payer($1,$2,'text')", [U.cara.id, F.dora1]);
ok("P1 a signed-in user can't call the payer check", !r.ok, r);
r = await as(U.cara, "select public.turn_hold_credits_for_film($1,$2,$3,$4,1,'x','text')", [U.dora.id, U.cara.id, caraRow, F.dora1]);
ok("P2 nor take a hold on someone's balance", !r.ok, r);
// (Team review 2026-10-09) P3 used to run as a non-owner (refused anyway) in one multi-statement query
// (which PGlite refuses outright), so it proved nothing. Now: the OWNER, in one transaction, sets the old
// turn.* flag by hand and then tries to relink and extend her collaborator's row — the guard still holds.
r = await asTx(U.dora, async (tx) => {
  await tx.query("select set_config('turn.team_trusted', 'on', true)");
  return (await tx.query("update public.turn_project_members set member_user = $2, member_email = 'eve@example.com', expires_at = now() + interval '99 days' where id = $1 returning member_user, member_email, expires_at", [caraRow, U.eve.id])).rows;
});
ok("P3 the owner setting the old trusted flag by hand doesn't get past the guard (link, address, expiry kept)",
  r.ok && r.rows[0].member_user === U.cara.id && r.rows[0].member_email === "cara@example.com" && r.rows[0].expires_at === null, r);
r = await as(U.dora, "insert into public.turn__team_trust(tx) values (txid_current())");
ok("P3b nor can she write the trust table itself", !r.ok && /permission denied/.test(r.error), r);
r = await as(U.dora, "select public.turn__team_trust(true)");
ok("P3c nor call the function that does", !r.ok && /permission denied/.test(r.error), r);
r = await as(U.cara, "select count(*)::int n from public.turn_team_invite_log");
ok("P4 the invite log isn't readable", !r.ok || r.row.n === 0, r);

/* ── Q. the Team review (2026-10-09) ─────────────────────────────────────────
   Every fix of this pass, on two fresh databases: the file as it was on 2026-10-03 (commit
   OLD_REV, read with `git show`; skipped without git) where each check shows the BUG, and today's
   file where it shows the FIX. The NEW database also carries a stand-in for Supabase's realtime
   schema (the private film channels); the main database above has none (the block is a no-op). */
const OLD_REV = "3ff289e", OLD_MIGRATE_REV = "32809c3";
const gitShow = (rev, path) => {
  try { return execSync(`git show ${rev}:${path}`, { cwd: new URL(ROOT).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch (_e) { return null; }
};
const REALTIME_STUB = `
create schema if not exists realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null default 'broadcast',
  payload jsonb, event text, private boolean default true, inserted_at timestamptz not null default now());
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $f$ select nullif(current_setting('realtime.topic', true), '') $f$;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to anon, authenticated;
grant usage, select on sequence realtime.messages_id_seq to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;`;
const X = {   // people only this section uses
  ari:  { id: "d0000000-0000-4000-8000-0000000000c1", email: "ari@example.com" },     // Art director
  pen:  { id: "d0000000-0000-4000-8000-0000000000c2", email: "pen@example.com" },     // a pending invitee
  vo:   { id: "d0000000-0000-4000-8000-0000000000c3", email: "vo@example.com" },      // View-only
  adm2: { id: "d0000000-0000-4000-8000-0000000000c4", email: "admin@infinitestudioai.com", unconfirmed: true },
};

async function reviewEnv(relaunch, { realtime = false } = {}) {
  const d = new PGlite({ extensions: { pgcrypto } });
  await d.exec(STUB);
  if (realtime) await d.exec(REALTIME_STUB);
  for (const u of [...Object.values(U), ...Object.values(X)])
    await d.query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,$3)",
      [u.id, u.email, u.unconfirmed ? null : new Date(Date.now() - 86400000)]);
  for (const f of CHAIN) await d.exec(read("supabase/" + f));
  await d.exec(relaunch);
  const E = { db: d };
  E.q = async (sql, p = []) => (await d.query(sql, p)).rows;
  E.tx = async (who, fn) => {
    try {
      const rows = await d.transaction(async (tx) => {
        const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        await tx.exec(`set local role ${who === "service" ? "service_role" : who === "anon" ? "anon" : "authenticated"}`);
        return fn(tx);
      });
      return { ok: true, rows, row: rows[0] };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  E.as = (who, sql, p = []) => E.tx(who, async (tx) => (await tx.query(sql, p)).rows);
  E.svc = async (sql, p) => { const r = await E.as("service", sql, p); if (!r.ok) throw new Error(sql + " → " + r.error); return r.row; };
  let n = 0;
  E.film = async (owner, title = "Film") => {
    const id = `f2000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    await E.q("insert into public.turn_projects(id, owner, title, doc) values ($1,$2,$3,$4::jsonb)", [id, owner.id, title, doc(title)]);
    return id;
  };
  E.invite = (owner, film, email, role = "writer") =>
    E.as(owner, "insert into public.turn_project_members(project_id, owner, member_email, role) values ($1,$2,$3,$4) returning *", [film, owner.id, email, role]);
  E.claim = (who) => E.as(who, "select * from public.turn_claim_memberships()");
  E.row = async (film, email) => (await E.q("select * from public.turn_project_members where project_id = $1 and member_email = $2", [film, email]))[0];
  E.resetLog = () => E.q("delete from public.turn_team_invite_log");
  E.sw = (on) => E.q(`update public.turn_app_config set value = '{"on": ${on}}' where key = 'team_sharing'`);
  E.payer = async (who, film, kind) => (await E.svc("select public.turn_film_payer($1,$2,$3) j", [who.id, film, kind])).j;
  E.hold = async (owner, who, member, film, amount, ref, kind) => (await E.svc(
    `select public.turn_hold_credits_for_film(p_owner => $1, p_actor => $2, p_member => $3, p_project => $4, amount => $5, ref => $6, reason => 'test'${kind ? ", p_kind => $7" : ""}) j`,
    kind ? [owner.id, who.id, member, film, amount, ref, kind] : [owner.id, who.id, member, film, amount, ref])).j;
  await E.svc("select public.turn_set_plan_once('e-dora', $1, 'director', 1600, 'sub_d', 'cus_d', now() + interval '30 days')", [U.dora.id]);
  await E.svc("select public.turn_set_plan_once('e-pat', $1, 'studio', 5000, 'sub_p', 'cus_p', now() + interval '30 days')", [U.pat.id]);
  await E.sw(true);
  return E;
}

async function review(E, isNew) {
  const tag = isNew ? "Q" : "Q-old";
  // fixed: today's file must satisfy it; bug: the 2026-10-03 file shows the problem (undefined = not checked there)
  const t = (name, fixed, bug, detail) => {
    if (isNew) ok(`${tag} ${name}`, fixed, detail);
    else if (bug !== undefined) ok(`${tag} bug reproduced: ${name}`, bug, detail);
  };
  const codeOf = (x) => (/TURN_TEAM:([a-z_]+)/.exec((x && x.error) || "") || [])[1];
  let r, x;

  /* 1. renewing an invite runs the caps */
  const f1 = await E.film(U.dora, "Renew");
  for (let i = 1; i <= 5; i++) await E.invite(U.dora, f1, `r${i}@example.com`, "view_only");
  await E.q("update public.turn_project_members set expires_at = now() - interval '1 minute' where project_id = $1 and member_email = 'r1@example.com'", [f1]);
  r = await E.invite(U.dora, f1, "r6@example.com", "view_only");
  x = await E.as(U.dora, "select public.turn_renew_invite($1) j", [(await E.row(f1, "r1@example.com")).id]);
  t("1a renewing an expired invite on a full film is refused (people cap)", r.ok && !x.ok && codeOf(x) === "cap", r.ok && x.ok, { r, x });
  const f2 = await E.film(U.dora, "Renew stage");
  await E.q(`insert into public.turn_project_members(project_id, owner, member_email, role, expires_at)
             values ($1, $2, 'st@example.com', 'stage_editor', now() - interval '1 minute')`, [f2, U.dora.id]);
  x = await E.as(U.dora, "select public.turn_renew_invite($1) j", [(await E.row(f2, "st@example.com")).id]);
  t("1b renewing a Stage editor invite on a Director film is refused", !x.ok && codeOf(x) === "stage_editor_producer", x.ok, x);
  const f3 = await E.film(U.dora, "Renew writers");
  for (let i = 1; i <= 3; i++) await E.invite(U.dora, f3, `cw${i}@example.com`, "writer");
  await E.q(`insert into public.turn_project_members(project_id, owner, member_email, role, expires_at)
             values ($1, $2, 'cw4@example.com', 'writer', now() - interval '1 minute')`, [f3, U.dora.id]);
  x = await E.as(U.dora, "select public.turn_renew_invite($1) j", [(await E.row(f3, "cw4@example.com")).id]);
  t("1c renewing a 4th Co-writer is refused", !x.ok && codeOf(x) === "cowriter_cap", x.ok, x);
  await E.resetLog();

  /* 2. a row never moves; 12. a new invite's server-owned fields */
  const f4 = await E.film(U.dora, "Move A"), f5 = await E.film(U.dora, "Move B");
  r = await E.invite(U.dora, f4, "mv@example.com", "view_only");
  x = await E.as(U.dora, "update public.turn_project_members set project_id = $2, id = gen_random_uuid() where id = $1 returning id, project_id", [r.row.id, f5]);
  t("2 the owner can't move a membership to another film (or give it another id)",
    x.ok && x.row.project_id === f4 && x.row.id === r.row.id, x.ok && x.row.project_id === f5, x);
  x = await E.as(U.dora, `insert into public.turn_project_members(project_id, owner, member_email, role, email_sent_at, joined_at, owner_seen_at, created_at)
                         values ($1, $2, 'nul@example.com', 'view_only', now(), now(), now(), '2000-01-01') returning email_sent_at, joined_at, owner_seen_at, created_at`, [f4, U.dora.id]);
  t("12 a new invite's email-sent, joined and seen times are the server's (null), and so is its creation time",
    x.ok && x.row.email_sent_at === null && x.row.joined_at === null && x.row.owner_seen_at === null && Date.now() - new Date(x.row.created_at) < 60000,
    x.ok && (x.row.email_sent_at !== null || x.row.joined_at !== null), x);

  /* 13. the admin account needs a confirmed address */
  x = await E.svc("select public.turn_team_owner_tier($1) t", [X.adm2.id]);
  t("13 an UNCONFIRMED account with the admin's address is not the admin (no Producer rooms)", x.t === "none", x.t === "studio", x);

  /* 4. a Stage editor writes the Stage's rows only; the Art director the Art Room's */
  const fp = await E.film(U.pat, "Stage vs Art");
  await E.invite(U.pat, fp, U.sam.email, "stage_editor"); await E.claim(U.sam);
  const ariFp = (await E.invite(U.pat, fp, X.ari.email, "art_director")).row?.id; await E.claim(X.ari);
  const artPath = `${U.pat.id}/${fp}/character/neo/20261009-100000-sheet-aaaa1111.png`;
  await E.q(`insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta) values
               ($1, $2, 'neo', $3, '{"kind":"image"}'), ($1, $2, 'clip-s1-sabc', null, '{"kind":"video","video":{"url":"https://v3.fal.media/files/a.mp4"}}')`,
    [fp, U.pat.id, artPath]);
  // (Stage editor review 2026-10-09: a take record's meta holds only kind / updatedAt / video, so the touch is updatedAt)
  const upd = (who, entity) => E.as(who, `update public.turn_generations set meta = meta || '{"updatedAt":2}' where project_id = $1 and entity_id = $2 returning entity_id`, [fp, entity]);
  x = await upd(U.sam, "neo");
  t("4a a Stage editor can't change an Art Room image row", x.ok && x.rows.length === 0, x.ok && x.rows.length === 1, x);
  x = await upd(U.sam, "clip-s1-sabc");
  t("4b but changes the Stage's take rows", x.ok && x.rows.length === 1, undefined, x);
  x = await E.as(U.sam, `insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'clip-s2-sdef', '{"kind":"video"}') returning entity_id`, [fp, U.sam.id]);
  t("4c and saves a new take row", x.ok && x.rows.length === 1, undefined, x);
  x = await upd(X.ari, "clip-s1-sabc");
  t("4d the Art director doesn't change the Stage's takes", x.ok && x.rows.length === 0, x.ok && x.rows.length === 1, x);
  x = await upd(X.ari, "neo");
  t("4e but changes the Art Room's rows", x.ok && x.rows.length === 1, undefined, x);
  x = await E.as(U.sam, "select public.turn_can_delete_asset_path($1) d, public.turn_can_write_assets($2) w", [artPath, fp]);
  t("4f a Stage editor can't delete or upload the Art Room's files", x.ok && x.row.d === false && x.row.w === false, x.ok && x.row.d === true, x);
  x = await E.as(U.sam, "delete from public.turn_generations where project_id = $1 and entity_id = 'neo' returning entity_id", [fp]);
  t("4g nor delete an Art Room row", x.ok && x.rows.length === 0, x.ok && x.rows.length === 1, x);
  x = await E.as(U.sam, "select count(*)::int n from public.turn_generations where project_id = $1", [fp]);
  t("4h every role still READS every row", x.ok && x.row.n >= 2, undefined, x);

  /* 4s. every Stage flow still works for the Stage editor, end to end (as the app writes it) */
  if (isNew) {
    // (1) a take is committed exactly as app/cloud.jsx cloudCommitVideo does: an upsert of the clip row
    // (Stage editor review 2026-10-09) as the app now writes it: the maker in video.meta.by, the takes it keeps in takes[]
    const commitTake = (who, entity, url, takes = []) => E.as(who, `insert into public.turn_generations(project_id, owner, entity_id, meta)
        values ($1, $2, $3, jsonb_build_object('kind', 'video', 'updatedAt', 1, 'video', jsonb_build_object('url', $4::text, 'meta', jsonb_build_object('by', $6::text, 'takes', $5::jsonb))))
        on conflict (project_id, entity_id) do update set meta = excluded.meta returning entity_id, owner, meta`, [fp, who.id, entity, url, JSON.stringify(takes), who.id]);
    x = await commitTake(U.sam, "clip-s3-sxyz", "https://v3.fal.media/files/t1.mp4");
    // (Stage editor review 2026-10-09, S6) the new row is the film OWNER's, so deleting Sam's account can't take it away
    t("4s1 a Stage editor commits a new take (cloudCommitVideo's upsert); the row is the owner's", x.ok && x.rows.length === 1 && x.row.owner === U.pat.id, undefined, x);
    x = await commitTake(U.sam, "clip-s1-sabc", "https://v3.fal.media/files/t2.mp4", [{ url: "https://v3.fal.media/files/a.mp4", meta: null }]);
    t("4s2 and replaces the take of a clip the owner shot first (the row stays the owner's)",
      x.ok && x.rows.length === 1 && x.row.owner === U.pat.id && x.row.meta.video.url.endsWith("t2.mp4"), undefined, x);
    x = await commitTake(U.sam, "neo", "https://v3.fal.media/files/t3.mp4");
    t("4s3 but the same upsert onto an Art Room row is refused", !x.ok && /row-level security/.test(x.error), undefined, x);
    // (5) deleting a take: the last one deletes the row (cloudVideoDelete), others rewrite it (commit again)
    x = await E.as(U.sam, "delete from public.turn_generations where project_id = $1 and entity_id = 'clip-s3-sxyz' returning entity_id", [fp]);
    t("4s4 a Stage editor deletes a clip's last take (cloudVideoDelete)", x.ok && x.rows.length === 1, undefined, x);
    // (2) a device upload goes to the uploader's own {uid}/stage-tmp/ folder through a signed slot the
    // proxy (service role) opens: no project folder, so no project rule (and no upload reservation) applies
    x = await E.as(U.sam, "select public.turn_storage_project_id($1) p", [`${U.sam.id}/stage-tmp/20261009-video-abcd1234.mp4`]);
    t("4s5 a Stage device upload's key names no film (stage-tmp): turn_can_write_assets never decides it", x.ok && x.row.p === null, undefined, x);
    // (3) voicing a line: the audio stays on the device (IndexedDB); the shot records it (doc section 'shots')
    await E.q(`update public.turn_projects set doc = jsonb_set(doc, '{shots}', '[{"id":"sh1","size":"MS"}]') where id = $1`, [fp]);
    x = await E.as(U.sam, `update public.turn_projects set doc = jsonb_set(doc, '{shots}', '[{"id":"sh1","size":"MS","lineAudio":{"durationMs":1200,"voiceId":"v1"}}]') where id = $1 returning id`, [fp]);
    t("4s6 a Stage editor voices a line into a shot (the shots section saves)", x.ok && x.rows.length === 1, undefined, x);
    // and none of it on a Director film, or with the switch off
    const fdir = await E.film(U.dora, "Director Stage");
    await E.q(`insert into public.turn_project_members(project_id, owner, member_email, member_user, role, status)
               values ($1, $2, $3, $4, 'stage_editor', 'active')`, [fdir, U.dora.id, U.sam.email, U.sam.id]);
    x = await E.as(U.sam, `insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'clip-d1-s1', '{"kind":"video"}') returning entity_id`, [fdir, U.sam.id]);
    t("4s7 a Stage editor on a DIRECTOR film writes no takes (the Stage is Producer's)", !x.ok, undefined, x);
    await E.sw(false);
    x = await commitTake(U.sam, "clip-s1-sabc", "https://v3.fal.media/files/t4.mp4");
    await E.sw(true);
    t("4s8 nor with the switch off (read-only)", !x.ok, undefined, x);
  }

  /* 6. a role change after a drop from Producer to Director (decision F) */
  await E.resetLog();
  const fd = await E.film(U.pat, "Downgrade");
  for (let i = 1; i <= 7; i++) await E.invite(U.pat, fd, `dd${i}@example.com`, "view_only");
  await E.q("update public.turn_credits set plan = 'director' where owner = $1", [U.pat.id]);
  x = await E.as(U.pat, "update public.turn_project_members set roles = array['art_director'] where project_id = $1 and member_email = 'dd1@example.com' returning roles", [fd]);
  t("6a after Producer → Director, the 7 people stay and the owner can still change a role", x.ok && x.rows.length === 1, !x.ok && codeOf(x) === "cap", x);
  r = await E.invite(U.pat, fd, "dd8@example.com", "view_only");
  t("6b but a new invite waits until the film is under the cap", !r.ok && codeOf(r) === "cap", undefined, r);
  await E.q("update public.turn_credits set plan = 'studio' where owner = $1", [U.pat.id]);

  /* 7. re-adding someone who left or was removed is a fresh invite (decision D); 14. the bell */
  const fr = await E.film(U.dora, "Re-add");
  await E.invite(U.dora, fr, U.cara.email, "writer"); await E.claim(U.cara);
  x = await E.as(U.cara, "select public.turn_leave_film($1) n", [fr]);
  const noteAfterLeave = (await E.as(U.dora, "select * from public.turn_team_notifications()")).rows.filter((n) => n.project_id === fr);
  t("14 someone who left no longer shows in the owner's bell", x.ok && x.row.n === 1 && noteAfterLeave.length === 0, noteAfterLeave.length === 1, noteAfterLeave);
  x = await E.as(U.dora, "update public.turn_project_members set status = 'active' where project_id = $1 and member_email = $2 returning member_user, joined_at, expires_at", [fr, U.cara.email]);
  t("7a adding back someone who LEFT: unlinked, not joined, 14 days to accept",
    x.ok && x.row.member_user === null && x.row.joined_at === null && Math.abs(new Date(x.row.expires_at) - Date.now() - 14 * 86400000) < 60000,
    x.ok && x.row.member_user === U.cara.id && x.row.expires_at === null, x);
  r = await E.claim(U.cara);
  x = await E.row(fr, U.cara.email);
  t("7b accepting it links the account again, with a new join time", r.ok && x.member_user === U.cara.id && Date.now() - new Date(x.joined_at) < 60000, undefined, x);
  await E.as(U.dora, "update public.turn_project_members set status = 'removed' where project_id = $1 and member_email = $2", [fr, U.cara.email]);
  x = await E.as(U.dora, "update public.turn_project_members set status = 'active' where project_id = $1 and member_email = $2 returning member_user, expires_at", [fr, U.cara.email]);
  t("7c the same after the owner REMOVED them", x.ok && x.row.member_user === null && x.row.expires_at !== null, x.ok && x.row.member_user === U.cara.id, x);
  await E.claim(U.cara);

  /* 9. the switch off (decision B): collaborators read-only, nobody charged */
  await E.resetLog();
  const fo = await E.film(U.dora, "Switch off");
  await E.invite(U.dora, fo, U.cara.email, "writer"); await E.claim(U.cara);
  await E.invite(U.dora, fo, X.ari.email, "art_director"); await E.claim(X.ari);
  await E.invite(U.dora, fo, U.vic.email, "view_only"); await E.claim(U.vic);
  await E.invite(U.dora, fo, X.pen.email, "view_only");   // pending
  await E.q(`insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'tree', '{"kind":"image"}')`, [fo, U.dora.id]);
  await E.sw(false);
  x = await E.as(U.cara, `update public.turn_projects set doc = jsonb_set(doc, '{scenes}', '[{"id":"s9"}]') where id = $1 returning id`, [fo]);
  t("9a switch off: a Co-writer's save changes nothing", (x.ok && x.rows.length === 0) || /paused/.test(x.error || ""), x.ok && x.rows.length === 1, x);
  x = await E.as(U.cara, "select public.turn_can_access_project($1, true) w, public.turn_can_access_project($1, false) r", [fo]);
  t("9b the Co-writer is read-only (reads still work)", x.ok && x.row.w === false && x.row.r === true, x.ok && x.row.w === true, x);
  x = await E.as(X.ari, `update public.turn_generations set meta = meta || '{"t":1}' where project_id = $1 and entity_id = 'tree' returning entity_id`, [fo]);
  const aw = await E.as(X.ari, "select public.turn_can_write_assets($1) w", [fo]);
  t("9c the Art director writes no image rows and no files", x.ok && x.rows.length === 0 && aw.row.w === false, x.ok && x.rows.length === 1, { x, aw });
  t("9d the payer check: the collaborator's call is refused ('paused')", (await E.payer(U.cara, fo, "text")).code === "paused", (await E.payer(U.cara, fo, "text")).code === "off");
  t("9e an outsider is still 'not_member'", (await E.payer(U.eve, fo, "text")).code === "not_member", undefined);
  x = await E.as(U.dora, "update public.turn_project_members set status = 'removed' where project_id = $1 and member_email = $2 returning id", [fo, U.vic.email]);
  const bx = await E.as(U.dora, "update public.turn_project_members set budget_credits = 10 where project_id = $1 and member_email = $2 returning budget_credits", [fo, X.ari.email]);
  t("9f the owner still removes people and sets budgets", x.ok && x.rows.length === 1 && bx.ok && bx.row.budget_credits === 10, undefined, { x, bx });
  r = await E.claim(X.pen);
  t("9g a pending invite can still be accepted (it lands read-only)", r.ok && r.rows.length === 1, undefined, r);
  r = await E.as(U.cara, "select public.turn_leave_film($1) n", [fo]);
  t("9h a collaborator can still leave", r.ok && r.row.n === 1, undefined, r);
  await E.sw(true);

  /* 10. the owner's plan lapses (decision A): read everything, write nothing */
  await E.q("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.dora.id]);
  x = await E.as(X.ari, "select (select count(*)::int from public.turn_projects where id = $1) films, (select count(*)::int from public.turn_generations where project_id = $1) gens, public.turn_can_write_assets($1) w, public.turn_can_access_project($1, true) aw", [fo]);
  t("10 lapsed owner: the film and its images are still READ, nothing is written", x.ok && x.row.films === 1 && x.row.gens === 1 && x.row.w === false && x.row.aw === false, undefined, x);
  await E.q("update public.turn_credits set payment_status = 'active' where owner = $1", [U.dora.id]);

  /* 11. the film hold re-derives the owner and the film and re-checks */
  const ariMember = ariFp;
  x = await E.hold(U.dora, X.ari, ariMember, fp, 5, "h:mm1");
  t("11a a hold naming the wrong owner is refused (mismatch), nobody's balance touched", !x.ok && x.code === "mismatch", x.ok === true, x);
  x = await E.hold(U.pat, X.ari, ariMember, fo, 5, "h:mm2");
  t("11b a hold naming another film is refused (mismatch)", !x.ok && x.code === "mismatch", x.ok === true, x);
  await E.invite(U.pat, fp, X.vo.email, "view_only"); await E.claim(X.vo);
  const voMember = (await E.row(fp, X.vo.email)).id;
  x = await E.hold(U.pat, X.vo, voMember, fp, 5, "h:vo");
  t("11c a View-only member's hold is refused (role)", !x.ok && x.code === "role", x.ok === true, x);
  if (isNew) {
    x = await E.hold(U.pat, X.ari, ariMember, fp, 5, "h:vid", "video");
    t("11d a call the role doesn't cover (video for an Art director) is refused (role)", !x.ok && x.code === "role", undefined, x);
  }
  await E.sw(false);
  x = await E.hold(U.pat, X.ari, ariMember, fp, 5, "h:off");
  t("11e switch off: refused (paused)", !x.ok && x.code === "paused", x.ok === true, x);
  await E.sw(true);
  await E.q("update public.turn_credits set plan = 'writer' where owner = $1", [U.pat.id]);
  x = await E.hold(U.pat, X.ari, ariMember, fp, 5, "h:plan");
  t("11f the owner's plan no longer carries the role: refused (owner_plan)", !x.ok && x.code === "owner_plan", x.ok === true, x);
  await E.q("update public.turn_credits set plan = 'studio' where owner = $1", [U.pat.id]);
  x = await E.hold(U.pat, X.ari, ariMember, fp, 5, "  h:trim  ");
  const trimmed = (await E.q("select actor, member_id, project_id from public.turn_credit_holds where ref = 'h:trim'"))[0];
  t("11g a padded ref is trimmed once: the hold records who clicked, on which film",
    x.ok && trimmed && trimmed.actor === X.ari.id && trimmed.member_id === ariMember && trimmed.project_id === fp,
    x.ok && trimmed && trimmed.actor === null, { x, trimmed });
  x = await E.hold(U.pat, X.ari, ariMember, fp, 5, "h:trim");
  t("11h and the same ref again is the first answer", x.ok && x.duplicate === true, undefined, x);

  /* 5. the advisory locks are taken */
  await E.resetLog();
  x = await E.tx(U.dora, async (tx) => {
    await tx.query("insert into public.turn_project_members(project_id, owner, member_email, role) values ($1, $2, 'lk@example.com', 'view_only')", [f4, U.dora.id]);
    return (await tx.query("select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()")).rows;
  });
  t("5 an invite holds the film's lock and the owner's lock until it commits", x.ok && x.rows[0].n >= 2, x.ok && x.rows[0].n === 0, x);

  /* 15. pure helpers aren't on the API */
  x = await E.as(U.cara, "select public.turn_team_cap('studio') n");
  const xa = await E.as("anon", "select public.turn_team_role_writes('writer', 'studio') w");
  t("15 a signed-in user or anon can't call the pure helpers", !x.ok && /permission denied/.test(x.error) && !xa.ok, x.ok, { x, xa });

  /* 3. turning a shared film into a Show copies the team */
  await E.resetLog();
  const bible = (id) => JSON.stringify({ characters: [], locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } });
  const convert = (film) => E.as(U.pat, "select public.turn_convert_project_to_show($1, 'Show', $2::jsonb, 'series') r", [film, bible(film)]);
  const fc = await E.film(U.pat, "Convert");
  const caraC = (await E.invite(U.pat, fc, U.cara.email, "writer")).row.id;
  await E.as(U.pat, "update public.turn_project_members set roles = array['writer','art_director'], budget_credits = 77 where id = $1", [caraC]);
  await E.claim(U.cara);
  await E.invite(U.pat, fc, "pend3@example.com", "view_only");
  const h0 = await E.hold(U.pat, U.cara, caraC, fc, 20, "h:conv");
  await E.as(U.pat, "select public.turn_team_notifications_seen()");
  const before = await E.q("select member_email, member_user, roles, budget_credits, joined_at, invited_at, expires_at, owner_seen_at from public.turn_project_members where project_id = $1 order by member_email", [fc]);
  const log0 = (await E.q("select count(*)::int n from public.turn_team_invite_log where owner = $1", [U.pat.id]))[0].n;
  await E.sw(false);
  await E.q("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.pat.id]);
  r = await convert(fc);
  await E.sw(true);
  await E.q("update public.turn_credits set payment_status = 'active' where owner = $1", [U.pat.id]);
  t("3a a shared film turns into a Show with the switch off and the owner's plan lapsed", r.ok, !r.ok && codeOf(r) === "paused", r.error);
  if (r.ok) {
    const S = r.row.r.show.id;
    const after = await E.q("select member_email, member_user, roles, budget_credits, joined_at, invited_at, expires_at, owner_seen_at from public.turn_project_members where project_id = $1 order by member_email", [S]);
    t("3b the Show's team is the film's, field for field (account, every role, budget, invite/join/seen times)",
      JSON.stringify(after) === JSON.stringify(before), undefined, { before, after });
    const notes = (await E.as(U.pat, "select * from public.turn_team_notifications() where not seen")).rows;
    const log1 = (await E.q("select count(*)::int n from public.turn_team_invite_log where owner = $1", [U.pat.id]))[0].n;
    t("3c no fresh 'joined' notices, nothing counted against the 20 a day", notes.length === 0 && log1 === log0, undefined, { notes, log0, log1 });
    const spend = (await E.as(U.pat, "select * from public.turn_team_spend($1)", [S])).rows;
    const caraS = (await E.row(S, U.cara.email)).id;
    t("3d Cara's spend this month moved with her (20 credits held on the film)", h0.ok && spend.some((s) => s.member_id === caraS && s.spent === 20), undefined, { h0, spend });
    t("3e the film's own rows are retired", (await E.q("select count(*)::int n from public.turn_project_members where project_id = $1 and status = 'active'", [fc]))[0].n === 0, undefined);
  }
  // the bugs of the old file show with the switch ON too
  const fc2 = await E.film(U.pat, "Convert 2");
  const cara2 = (await E.invite(U.pat, fc2, U.cara.email, "writer")).row.id;
  await E.as(U.pat, "update public.turn_project_members set roles = array['writer','art_director'], budget_credits = 77 where id = $1", [cara2]);
  await E.claim(U.cara);
  await E.invite(U.pat, fc2, "pend4@example.com", "view_only");
  r = await convert(fc2);
  const S2 = r.ok ? r.row.r.show.id : null;
  x = S2 && await E.row(S2, U.cara.email);
  t("3f (switch on) the copy stays linked, keeps both roles and the owner's budget",
    !!x && x.member_user === U.cara.id && JSON.stringify(x.roles) === JSON.stringify(["writer", "art_director"]) && x.budget_credits === 77,
    !!x && (x.member_user === null || x.roles.length === 1 || x.budget_credits !== 77), x);

  /* 8. people invited to a whole Show count in each Episode's caps (decision E) */
  if (S2) {
    await E.resetLog();
    const E1 = fc2;   // Episode 1 since the conversion
    await E.invite(U.pat, S2, "sw1@example.com", "writer");
    await E.invite(U.pat, S2, "sw2@example.com", "writer");   // the Show: Cara + 2 = 3 Co-writers
    r = await E.invite(U.pat, E1, "ew1@example.com", "writer");
    t("8a a 4th Co-writer on an Episode is refused: the Show's Co-writers count there", !r.ok && codeOf(r) === "cowriter_cap", r.ok, r);
    for (let i = 1; i <= 6; i++) await E.invite(U.pat, E1, `ev${i}@example.com`, "view_only");   // 4 on the Show + 6 = 10
    r = await E.invite(U.pat, E1, "ev7@example.com", "view_only");
    t("8b the Episode's 11th person (its own 6 + the Show's 4 + 1) is refused", !r.ok && codeOf(r) === "cap", r.ok, r);
    r = await E.invite(U.pat, S2, "sv1@example.com", "view_only");
    t("8c a new Show-wide invite must fit every Episode: refused while Episode 1 is full", !r.ok && codeOf(r) === "cap", r.ok, r);
    r = await E.invite(U.pat, E1, "sw1@example.com", "view_only");
    t("8d someone already on the Show takes no second place on the Episode", r.ok, undefined, r);

    /* 20. a Show row and the Episode's own row: the payer prefers the one with budget left */
    // her film row was retired by the conversion: the owner adds her back on the Episode, as Art director
    // (claims first: the 2026-10-03 file left her Show row unlinked)
    await E.claim(U.cara);
    const caraE1 = await E.as(U.pat, "update public.turn_project_members set status = 'active', roles = array['art_director'] where project_id = $1 and member_email = $2 returning id", [E1, U.cara.email]);
    await E.claim(U.cara);
    await E.as(U.pat, "update public.turn_project_members set budget_credits = 0 where project_id = $1 and member_email = $2", [E1, U.cara.email]);
    const p = await E.payer(U.cara, E1, "image");
    const showRow = (await E.row(S2, U.cara.email)).id;
    t("20 Cara on the Show (budget left) and on Episode 1 (budget 0): her image call uses the Show's grant",
      caraE1.ok && caraE1.rows.length === 1 && p.ok === true && p.member_id === showRow, p.code === "budget_reached", { caraE1, p });
  }

  if (!isNew) return;

  /* 16. private film channels (Realtime Authorization) */
  x = await E.q("select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by policyname");
  ok("Q 16a the two realtime.messages policies exist", JSON.stringify(x.map((p) => p.policyname)) === JSON.stringify(["turn film channels receive", "turn film channels send"]), x);
  await E.q("insert into realtime.messages(topic, extension, payload) values ($1, 'presence', '{}'), ($2, 'broadcast', '{}')", ["film:" + fp, "doc:" + fp]);
  const see = (who, topic) => E.tx(who, async (tx) => {
    await tx.query("select set_config('realtime.topic', $1, true)", [topic]);
    return (await tx.query("select count(*)::int n from realtime.messages")).rows;
  });
  const send = (who, topic) => E.tx(who, async (tx) => {
    await tx.query("select set_config('realtime.topic', $1, true)", [topic]);
    return (await tx.query("insert into realtime.messages(topic, extension, payload) values ($1, 'presence', '{}') returning id", [topic])).rows;
  });
  x = await see(X.vo, "film:" + fp);
  const xd = await see(X.vo, "doc:" + fp);
  ok("Q 16b a View-only member receives on the film's channels (film: and doc:)", x.ok && x.rows[0].n > 0 && xd.ok && xd.rows[0].n > 0, { x, xd });
  x = await send(X.vo, "film:" + fp);
  ok("Q 16c and can send presence there", x.ok && x.rows.length === 1, x);
  x = await see(U.eve, "film:" + fp);
  const xs = await send(U.eve, "film:" + fp);
  ok("Q 16d an outsider who knows the film's id receives and sends nothing", x.ok && x.rows[0].n === 0 && !xs.ok, { x, xs });
  x = await see(X.vo, "film:not-a-uuid");
  const xo = await see(X.vo, "presence:" + fp);
  ok("Q 16e a malformed or other topic is refused, never an error", x.ok && x.rows[0].n === 0 && xo.ok && xo.rows[0].n === 0, { x, xo });

  /* 17. the older files refuse to undo this one; 18. migrate-remove-producer-admin.sql stays safe */
  const pol0 = await E.q("select qual from pg_policies where tablename = 'turn_project_members' and policyname = 'turn_project_members_select'");
  for (const f of ["team-collaboration.sql", "invitations.sql", "shared-owners.sql", "enforce-role-scopes.sql"]) {
    let e = null;
    try { await E.db.exec(read("supabase/" + f)); } catch (err) { e = err.message; }
    ok(`Q 17 ${f} refuses to run once team-relaunch.sql is installed`, /TURN_TEAM_SUPERSEDED/.test(e || "") && e.includes("team-relaunch.sql"), e);
  }
  const pol1 = await E.q("select qual from pg_policies where tablename = 'turn_project_members' and policyname = 'turn_project_members_select'");
  ok("Q 17b and changes nothing (the private member list stays)", JSON.stringify(pol0) === JSON.stringify(pol1) && !/turn_can_access_project/.test(pol1[0]?.qual || ""), pol1);
  const oldMigrate = gitShow(OLD_MIGRATE_REV, "supabase/migrate-remove-producer-admin.sql");
  if (oldMigrate) {
    let e = null;
    try { await E.db.exec(oldMigrate); } catch (err) { e = err.message; }
    ok("Q 18 bug reproduced: the old migrate-remove-producer-admin.sql fails once a Stage editor exists", e !== null, e);
  }
  let e18 = null;
  try { await E.db.exec(read("supabase/migrate-remove-producer-admin.sql")); } catch (err) { e18 = err.message; }
  const helper = await E.q("select pg_get_functiondef('public.turn_can_access_project(uuid,boolean)'::regprocedure) d");
  ok("Q 18b today's migrate-remove-producer-admin.sql re-runs safely there and leaves the access helper alone",
    e18 === null && /turn__collab_writes/.test(helper[0].d), e18);

  /* the documented re-run order still works: series-production.sql, then this file again */
  let eR = null;
  try { await E.db.exec(read("supabase/series-production.sql")); await E.db.exec(RELAUNCH); } catch (err) { eR = err.message; }
  x = S2 && await E.row(S2, U.cara.email);
  ok("Q 19 series-production.sql re-run, then team-relaunch.sql again: both succeed, the Show's team is intact",
    eR === null && !!x && x.member_user === U.cara.id && x.status === "active", eR || x);
}

/* ── S. the Stage editor review (2026-10-09) ─────────────────────────────────
   Same pattern as Q: the file production runs today (commit PROD_REV, 2026-10-09 Team review) shows
   each bug, today's file the fix; then today's file installed over production's (with its data, twice),
   and series-production.sql re-run followed by this file again. */
const PROD_REV = "151175c";
async function stageReview(E, isNew) {
  const tag = isNew ? "S" : "S-old";
  const t = (name, fixed, bug, detail) => {
    if (isNew) ok(`${tag} ${name}`, fixed, detail);
    else if (bug !== undefined) ok(`${tag} bug reproduced: ${name}`, bug, detail);
  };
  const codeOf = (x) => (/TURN_TEAM:([a-z_]+)/.exec((x && x.error) || "") || [])[1];
  const zeroRows = (x) => x.ok && x.rows.length === 0;
  let x, r;
  const fp = await E.film(U.pat, "Stage review"), fo2 = await E.film(U.pat, "Pat's other film");
  await E.invite(U.pat, fp, U.sam.email, "stage_editor"); await E.claim(U.sam);
  const ariRow = (await E.invite(U.pat, fp, X.ari.email, "art_director")).row.id; await E.claim(X.ari);
  const samRow = (await E.row(fp, U.sam.email)).id;
  const artPath = `${U.pat.id}/${fp}/character/neo/20261009-100000-sheet-aaaa1111.png`;
  const copyPath = `${U.pat.id}/${fp}/ref/20261009-100000-copy-bbbb2222.png`;
  const otherFilmPath = `${U.pat.id}/${fo2}/character/neo/20261009-100000-sheet-cccc3333.png`;
  await E.q(`insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta, refs) values
      ($1, $2, 'neo', $3, '{"kind":"image"}', '[]'),
      ($1, $2, 'holder', null, '{"kind":"image"}', $4::jsonb),
      ($1, $2, 'clip-s1', null, '{"kind":"video","updatedAt":1,"video":{"url":"https://v3.fal.media/files/o1.mp4","meta":null}}', '[]')`,
    [fp, U.pat.id, artPath, JSON.stringify([{ storage_path: copyPath, refId: "neo" }])]);
  const ins = (who, entity, path, meta) => E.as(who, `insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta)
      values ($1, $2, $3, $4, $5::jsonb) returning entity_id, owner`, [fp, who.id, entity, path, JSON.stringify(meta)]);
  const setMeta = (who, entity, meta, extra = "") => E.as(who, `update public.turn_generations set meta = $3::jsonb${extra}
      where project_id = $1 and entity_id = $2 returning entity_id`, [fp, entity, JSON.stringify(meta)]);
  const vid = (url, metaExtra = {}) => ({ kind: "video", updatedAt: 2, video: { url, meta: metaExtra } });

  /* S1. the review's probes P1 / P1b: plant an Art Room sheet in a Stage row's cleanup list */
  x = await ins(U.sam, "clip-p1", null, { ...vid("https://v3.fal.media/files/p1.mp4"), cleanupPending: [artPath] });
  t("1a (P1) a Stage editor can't save a take record that lists the Art Room's sheet for cleanup",
    !x.ok && codeOf(x) === "stage_slot", x.ok, x);
  x = await setMeta(U.sam, "clip-s1", { ...vid("https://v3.fal.media/files/o1.mp4"), cleanupPending: [artPath], cleanupTombstone: true });
  t("1b (P1b) nor add one to the owner's take record", !x.ok && codeOf(x) === "stage_slot", x.ok && x.rows.length === 1, x);
  x = await ins(U.sam, "clip-p2", null, { ...vid("https://v3.fal.media/files/p2.mp4"), cleanupPurgeTarget: { id: "neo", storagePath: artPath } });
  t("1c nor a purge receipt naming it (the owner's sweep deletes what receipts name)", !x.ok && codeOf(x) === "stage_slot", x.ok, x);
  x = await ins(U.sam, "clip-p3", `${U.sam.id}/${fp}/stage-audio/x.mp3`, vid("https://v3.fal.media/files/p3.mp4"));
  t("1d a take record has no file", !x.ok, x.ok, x);
  x = await E.as(U.sam, `insert into public.turn_generations(project_id, owner, entity_id, meta, history) values ($1, $2, 'clip-p4', $3::jsonb, $4::jsonb) returning entity_id`,
    [fp, U.sam.id, JSON.stringify(vid("https://v3.fal.media/files/p4.mp4")), JSON.stringify([{ storage_path: artPath, meta: { cleanupPending: [artPath] } }])]);
  t("1e nor a history", !x.ok, x.ok, x);
  // (b) any collaborator: the Art director too
  x = await setMeta(X.ari, "neo", { kind: "image", cleanupPending: [otherFilmPath] });
  t("1f an Art director can't list a file of the owner's OTHER film for cleanup", !x.ok && codeOf(x) === "cleanup_path", x.ok && x.rows.length === 1, x);
  x = await E.as(X.ari, `update public.turn_generations set refs = $2::jsonb where project_id = $1 and entity_id = 'holder' returning entity_id`,
    [fp, JSON.stringify([{ storage_path: null, deleted: true, deletedStoragePath: otherFilmPath, refId: "neo", refGenerated: "" }])]);
  t("1g nor plant one as a deleted reference (deletedStoragePath)", !x.ok && codeOf(x) === "cleanup_path", x.ok && x.rows.length === 1, x);
  x = await E.as(X.ari, `update public.turn_generations set history = $2::jsonb where project_id = $1 and entity_id = 'holder' returning entity_id`,
    [fp, JSON.stringify([{ storage_path: null, meta: { cleanupPurgeReceipts: [{ id: "x", storagePath: otherFilmPath }] } }])]);
  t("1h nor in a history item's receipts", !x.ok && codeOf(x) === "cleanup_path", x.ok && x.rows.length === 1, x);
  x = await setMeta(X.ari, "holder", { kind: "image", cleanupPending: [`${X.ari.id}/${fp}/character/x/own.png`] });
  t("1i a path in the writer's own folder is fine", x.ok && x.rows.length === 1, undefined, x);
  // the Art director's own purge of an image (app/cloud.jsx cloudPurgeImageVersion): the tombstone lists the image and
  // the copy another row holds — a path this row never referenced, but one the Art director may delete
  x = await E.as(X.ari, `update public.turn_generations set storage_path = null, refs = '[]', history = '[]', meta = $2::jsonb
      where project_id = $1 and entity_id = 'neo' returning entity_id`,
    [fp, JSON.stringify({ kind: "image", cleanupPurge: true, cleanupTombstone: true, cleanupPurgeTarget: { id: "neo", storagePath: artPath },
      deleted: true, deletedStoragePath: artPath, cleanupPending: [artPath, copyPath] })]);
  t("1j an Art director's image purge still saves (its copies are in the film's folders)", x.ok && x.rows.length === 1, undefined, x);
  x = await setMeta(X.ari, "neo", { kind: "image", cleanupPurge: true, cleanupPurgeTarget: { id: "neo", storagePath: artPath } });
  t("1k and the cleanup that follows clears the list", x.ok && x.rows.length === 1, undefined, x);
  // the new voiced-line rows ('aud-…')
  const audPath = `${U.sam.id}/${fp}/stage-audio/l1-20261009.mp3`;
  const aud = (extra = {}) => ({ kind: "audio", updatedAt: 1, audio: { meta: { durationMs: 1200 } }, ...extra });
  x = await ins(U.sam, "aud-l1", audPath, aud());
  t("1l a Stage editor saves a voiced line under their own stage-audio folder; the row is the owner's",
    x.ok && x.row.owner === U.pat.id, !x.ok, x);
  if (isNew) {
    x = await ins(U.sam, "aud-l2", `${U.pat.id}/${fp}/stage-audio/l2.mp3`, aud());
    t("1m not under someone else's folder", !x.ok, undefined, x);
    x = await ins(U.sam, "aud-l3", `${U.sam.id}/${fo2}/stage-audio/l3.mp3`, aud());
    t("1n nor under another film", !x.ok, undefined, x);
    x = await ins(U.sam, "aud-l4", `${U.sam.id}/${fp}/stage-audio/l4.mp3`, aud({ cleanupPending: [artPath] }));
    t("1o a voiced line's cleanup list names only its own stage-audio files", !x.ok && codeOf(x) === "stage_slot", undefined, x);
    x = await ins(U.sam, "aud-l5", `${U.sam.id}/${fp}/stage-audio/l5.mp3`, aud({ cleanupPending: [`${U.sam.id}/${fp}/stage-audio/old.mp3`] }));
    t("1p (its own old file is fine)", x.ok, undefined, x);
    x = await ins(U.sam, "aud-l6", `${U.sam.id}/${fp}/stage-audio/l6.mp3`, aud({ note: "x" }));
    t("1q nor any other meta key", !x.ok, undefined, x);
    x = await ins(U.sam, "aud-../x", `${U.sam.id}/${fp}/stage-audio/l7.mp3`, aud());
    t("1r nor a malformed id", !x.ok, undefined, x);
    x = await setMeta(X.ari, "aud-l1", aud({ updatedAt: 9 }));
    t("1s the Art director doesn't write the Stage's voiced lines", zeroRows(x), undefined, x);
    x = await setMeta(U.sam, "aud-l1", aud({ updatedAt: 9 }));
    t("1t the Stage editor changes their own", x.ok && x.rows.length === 1, undefined, x);
    x = await E.as(U.pat, `insert into public.turn_generations(project_id, owner, entity_id, storage_path, meta) values ($1, $2, 'aud-o1', $3, $4::jsonb) returning entity_id`,
      [fp, U.pat.id, `${U.cara.id}/${fp}/stage-audio/any.mp3`, JSON.stringify(aud({ anything: true }))]);
    t("1u the owner writes any voiced-line row of the film", x.ok, undefined, x);
  }

  /* S9. the Stage's voiced-line files in Storage (the app uploads them as the signed-in user) */
  await E.q("insert into storage.buckets(id, name, public) values ('turn-assets', 'turn-assets', false) on conflict do nothing");
  await E.q("insert into storage.objects(bucket_id, name) values ('turn-assets', $1)", [artPath]);
  const sIns = (who, name) => E.as(who, "insert into storage.objects(bucket_id, name, owner) values ('turn-assets', $1, $2) returning name", [name, who.id]);
  const sUpd = (who, name) => E.as(who, "update storage.objects set metadata = '{\"v\":2}' where bucket_id = 'turn-assets' and name = $1 returning name", [name]);
  const sDel = (who, name) => E.as(who, "delete from storage.objects where bucket_id = 'turn-assets' and name = $1 returning name", [name]);
  const lineFile = `${U.sam.id}/${fp}/stage-audio/line-a.mp3`;
  x = await sIns(U.sam, lineFile);
  t("9a a Stage editor uploads a voiced line to their own <uid>/<film>/stage-audio/", x.ok && x.rows.length === 1, !x.ok, x);
  x = await sUpd(U.sam, lineFile);
  const xr = await E.as(U.sam, "select count(*)::int n from storage.objects where name = $1", [lineFile]);
  t("9b replaces it, and still reads it", x.ok && x.rows.length === 1 && xr.ok && xr.row.n === 1, zeroRows(x), { x, xr });
  x = await sDel(U.sam, lineFile);
  t("9c and deletes it", x.ok && x.rows.length === 1, zeroRows(x), x);
  const refused = async (name) => { const a = await sIns(U.sam, name); return !a.ok; };
  x = { ok: true, checks: {
    art: await refused(`${U.pat.id}/${fp}/stage-audio/x.mp3`),           // someone else's folder
    kind: await refused(`${U.sam.id}/${fp}/character/x.png`),            // an Art Room folder of the film
    film: await refused(`${U.sam.id}/${fo2}/stage-audio/x.mp3`),         // a film they aren't on
    deep: await refused(`${U.sam.id}/${fp}/stage-audio/a/b.mp3`),        // nested
    bare: await refused(`${U.sam.id}/${fp}/stage-audio/`) } };
  t("9d nothing else: another person's folder, an Art Room folder, another film, a nested or empty name",
    Object.values(x.checks).every(Boolean), undefined, x);
  x = await sDel(U.sam, artPath);
  const xu = await sUpd(U.sam, artPath);
  t("9e and the Art Room's sheet can't be deleted or replaced (P1 by Storage)", zeroRows(x) && zeroRows(xu), undefined, { x, xu });
  await E.q("update public.turn_credits set plan = 'director' where owner = $1", [U.pat.id]);
  const xdir = await sIns(U.sam, `${U.sam.id}/${fp}/stage-audio/line-dir.mp3`);
  await E.q("update public.turn_credits set plan = 'studio' where owner = $1", [U.pat.id]);
  await E.sw(false);
  const xoff = await sIns(U.sam, `${U.sam.id}/${fp}/stage-audio/line-off.mp3`);
  await E.sw(true);
  t("9f none of it once the owner drops to Director, or with the switch off", !xdir.ok && !xoff.ok, undefined, { xdir, xoff });
  x = await sIns(X.vo, `${X.vo.id}/${fp}/stage-audio/vo.mp3`);
  t("9g nor for someone without the Stage editor role", !x.ok, undefined, x);

  /* S2. writing needs a LINKED membership (decision E) */
  await E.invite(U.pat, fp, X.pen.email, "art_director");   // invited, never claimed
  x = await E.as(X.pen, "select count(*)::int n from public.turn_projects where id = $1", [fp]);
  t("2a an unclaimed invite still opens the film (read)", x.ok && x.row.n === 1, undefined, x);
  x = await setMeta(X.pen, "holder", { kind: "image", t: 1 });
  t("2b but writes no Art Room row", zeroRows(x), x.ok && x.rows.length === 1, x);
  x = await E.as(X.pen, `update public.turn_projects set doc = jsonb_set(doc, '{characters}', '[{"id":"pen"}]') where id = $1 returning id`, [fp]);
  t("2c and saves no section", zeroRows(x), x.ok && x.rows.length === 1, x);
  x = await E.as(X.pen, "select public.turn_can_write_assets($1) w, public.turn_can_access_project($1, true) aw", [fp]);
  t("2d and uploads no file", x.ok && x.row.w === false && x.row.aw === false, x.ok && x.row.w === true, x);
  x = await E.payer(X.pen, fp, "image");
  t("2e the payer check: not a member ('not_member' — the server now refuses it)", x.code === "not_member", undefined, x);
  x = await E.payer(U.eve, fp, "text");
  const xn = await E.payer(U.eve, "f2000000-0000-4000-8000-0000000fffff", "text");
  t("2f an outsider: 'not_member'; a film that doesn't exist: 'no_film'", x.code === "not_member" && xn.code === "no_film", undefined, { x, xn });

  /* S3. a Stage editor saves only the Stage's part (decision F); refusals are errors */
  await E.q(`update public.turn_projects set doc = doc || $2::jsonb where id = $1`, [fp, JSON.stringify({
    project: { title: "Stage review", logline: "x", stage: { model: "a" } },
    shots: [{ id: "a", size: "MS", action: "run", specRev: 1, specHash: "h1" }, { id: "b", size: "WS", specRev: 1, specHash: "h2" }] })]);
  const save = (who, film, key, value) => E.as(who, `update public.turn_projects set doc = jsonb_set(doc, $2::text[], $3::jsonb) where id = $1 returning id`,
    [film, `{${key}}`, JSON.stringify(value)]);
  const shotsNow = async (film) => (await E.q("select doc -> 'shots' s from public.turn_projects where id = $1", [film]))[0].s;
  let sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [{ ...sh[0], dialogue: "Hi.", dur: 2.4, specRev: 2, specHash: "h1b", lineAudio: { durationMs: 2000 },
    dialogueLines: [{ text: "Hi." }], screenplayDialogueIndex: 0, screenplayDialogueIndexes: [0], vidText: "v",
    stageCharacterReferenceOverrides: { neo: "master" } }, sh[1]]);
  t("3a a Stage editor saves a shot's line, voicing, timing and the Stage's overrides (specRev/specHash follow)", x.ok && x.rows.length === 1, undefined, x);
  sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [{ ...sh[0], size: "CU" }, sh[1]]);
  t("3b but not the shot's design (size)", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [...sh, { id: "c", size: "MS" }]);
  t("3c nor add a shot", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [sh[1], sh[0]]);
  t("3d nor reorder them", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [sh[0]]);
  t("3e nor remove one", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  x = await save(U.sam, fp, "project", { title: "Renamed", logline: "x", stage: { model: "a" } });
  t("3f nor the film's settings outside the Stage's", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  const proj = (await E.q("select doc -> 'project' p from public.turn_projects where id = $1", [fp]))[0].p;
  x = await save(U.sam, fp, "project", { ...proj, stage: { model: "b" } });
  t("3g but saves the Stage's own settings (project.stage)", x.ok && x.rows.length === 1, undefined, x);
  // several roles: the union (a Co-writer keeps all of `project`; the Stage part still only the Stage's fields of a shot)
  const fc = await E.film(U.pat, "Stage + writer");
  await E.q(`update public.turn_projects set doc = doc || '{"shots":[{"id":"a","size":"MS"}]}' where id = $1`, [fc]);
  const caraC = (await E.invite(U.pat, fc, U.cara.email, "writer")).row.id;
  await E.as(U.pat, "update public.turn_project_members set roles = array['writer','stage_editor'] where id = $1", [caraC]);
  await E.claim(U.cara);
  x = await save(U.cara, fc, "project", { title: "Retitled by the Co-writer" });
  const xs = await save(U.cara, fc, "shots", [{ id: "a", size: "MS", dialogue: "Yes." }]);
  t("3h Co-writer + Stage editor: all of `project`, and a shot's dialogue", x.ok && x.rows.length === 1 && xs.ok && xs.rows.length === 1, undefined, { x, xs });
  x = await save(U.cara, fc, "shots", [{ id: "a", size: "WS", dialogue: "Yes." }]);
  t("3i but not a shot's design", !x.ok && codeOf(x) === "stage_scope", x.ok && x.rows.length === 1, x);
  // paused roles: an ERROR the app can show, never a silent zero-row save (read as a version race)
  await E.q("update public.turn_credits set plan = 'director' where owner = $1", [U.pat.id]);
  sh = await shotsNow(fp);
  x = await save(U.sam, fp, "shots", [{ ...sh[0], dialogue: "Paused?" }, sh[1]]);
  t("3j owner dropped to Director: a Stage editor's save is refused 'role_paused' (it was a silent zero-row update)",
    !x.ok && codeOf(x) === "role_paused" && /TURN_ROLE_SCOPE/.test(x.error), zeroRows(x), x);
  x = await save(U.cara, fc, "shots", [{ id: "a", size: "MS", dialogue: "Paused?" }]);
  const xw = await save(U.cara, fc, "project", { title: "Still a Co-writer" });
  t("3k Co-writer + Stage editor there: the Stage part is 'role_paused', the Co-writer part still saves",
    !x.ok && codeOf(x) === "role_paused" && xw.ok && xw.rows.length === 1, undefined, { x, xw });
  await E.q("update public.turn_credits set plan = 'studio' where owner = $1", [U.pat.id]);
  await E.sw(false);
  x = await save(U.sam, fp, "shots", [{ ...sh[0], dialogue: "Off?" }, sh[1]]);
  await E.sw(true);
  t("3l switch off: 'paused'", !x.ok && codeOf(x) === "paused", zeroRows(x), x);
  await E.q("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.pat.id]);
  x = await save(U.sam, fp, "shots", [{ ...sh[0], dialogue: "Lapsed?" }, sh[1]]);
  const xa = await save(X.ari, fp, "characters", [{ id: "lapsed" }]);
  await E.q("update public.turn_credits set payment_status = 'active' where owner = $1", [U.pat.id]);
  t("3m owner's plan lapsed: 'owner_plan', for every role", !x.ok && codeOf(x) === "owner_plan" && !xa.ok && codeOf(xa) === "owner_plan",
    zeroRows(x), { x, xa });
  x = await E.as(U.vic, `update public.turn_projects set doc = jsonb_set(doc, '{scenes}', '[]') where id = $1 returning id`, [fp]);
  t("3n an outsider still matches no row (nothing to say)", zeroRows(x), undefined, x);

  /* S4. what each kind of paid call needs */
  x = await E.payer(U.sam, fp, "image");
  t("4a a Stage editor's image call is refused ('role'): the Stage makes no images", x.code === "role", x.ok === true, x);
  x = await E.payer(U.sam, fp, "voice");
  const xd = await E.payer(U.sam, fp, "voice_design"), xad = await E.payer(X.ari, fp, "voice_design");
  t("4b voice (text-to-speech): the Stage editor pays through the owner; designing a voice: the Art director only",
    x.ok === true && xd.code === "role" && xad.ok === true, undefined, { x, xd, xad });
  x = await E.hold(U.pat, U.sam, samRow, fp, 5, "s4:img", "image");
  t("4c and the film hold refuses an image for the Stage editor", !x.ok && x.code === "role", x.ok === true, x);
  x = await E.hold(U.pat, X.ari, ariRow, fp, 5, "s4:vd", "voice_design");
  t("4d but holds a voice design for the Art director", x.ok === true, undefined, x);

  /* S7. a collaborator can't remove someone else's take (decision C) */
  const T = (n) => `https://v3.fal.media/files/${n}.mp4`;
  const take = (url, by, extra = {}) => ({ url, meta: { ...(by ? { by } : {}), ...extra }, savedAt: 1 });
  const clip = (cur, curBy, takes, curExtra = {}) => ({ kind: "video", updatedAt: 3, video: { url: cur, meta: { ...(curBy ? { by: curBy } : {}), ...curExtra, takes } } });
  await E.q("insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'clip-t', $3::jsonb)",
    [fp, U.pat.id, JSON.stringify(clip(T("u1"), null, [take(T("u0"), null)]))]);
  x = await setMeta(U.sam, "clip-t", clip(T("s1"), U.sam.id, [take(T("u1"), null)]));
  t("7a a Stage editor's new take can't drop the owner's older take", !x.ok && codeOf(x) === "take_owner", x.ok && x.rows.length === 1, x);
  x = await setMeta(U.sam, "clip-t", clip(T("s1"), U.sam.id, [take(T("u1"), null), take(T("u0"), null)]));
  t("7b keeping it, the new take saves", x.ok && x.rows.length === 1, undefined, x);
  x = await setMeta(U.sam, "clip-t", clip(T("u0"), null, [take(T("s1"), U.sam.id), take(T("u1"), null)]));
  t("7c choosing another take as current is fine (the old current stays in the takes)", x.ok && x.rows.length === 1, undefined, x);
  x = await setMeta(U.sam, "clip-t", clip(T("u0"), null, [take(T("s1"), U.sam.id), take(T("u1"), U.sam.id)]));
  t("7d rewriting who made a take is refused", !x.ok && codeOf(x) === "take_owner", x.ok && x.rows.length === 1, x);
  x = await setMeta(U.sam, "clip-t", clip(T("u0"), null, [take(T("u1"), null)]));
  t("7e removing their OWN take is fine", x.ok && x.rows.length === 1, undefined, x);
  x = await E.as(U.sam, "delete from public.turn_generations where project_id = $1 and entity_id = 'clip-t' returning entity_id", [fp]);
  t("7f deleting a clip that holds the owner's takes is refused", !x.ok && codeOf(x) === "take_owner", x.ok && x.rows.length === 1, x);
  if (isNew) {
    x = await ins(U.sam, "clip-own", null, clip(T("o1"), U.sam.id, [take(T("o0"), U.sam.id)]));
    const xdel = await E.as(U.sam, "delete from public.turn_generations where project_id = $1 and entity_id = 'clip-own' returning entity_id", [fp]);
    t("7g a clip holding only their own takes they delete", x.ok && xdel.ok && xdel.rows.length === 1, undefined, { x, xdel });
    // the app's rollover (app/videogen.jsx capTakes): approved takes stay, plus the newest 20 others
    const loose = Array.from({ length: 20 }, (_, i) => take(T("r" + i), null));
    await E.q("insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'clip-roll', $3::jsonb)",
      [fp, U.pat.id, JSON.stringify(clip(T("rc"), null, [...loose, take(T("ra"), null, { status: "approved" })]))]);
    x = await setMeta(U.sam, "clip-roll", clip(T("n1"), U.sam.id, [take(T("rc"), null), ...loose.slice(0, 19), take(T("ra"), null, { status: "approved" })]));
    t("7h the rollover drops the owner's oldest loose take when 20 newer ones stay", x.ok && x.rows.length === 1, undefined, x);
    x = await setMeta(U.sam, "clip-roll", clip(T("n2"), U.sam.id, [take(T("n1"), U.sam.id), take(T("rc"), null), ...loose.slice(0, 17), take(T("ra"), null, { status: "approved" })]));
    t("7i but not two (only 19 others would stay)", !x.ok && codeOf(x) === "take_owner", undefined, x);
    x = await setMeta(U.sam, "clip-roll", clip(T("n2"), U.sam.id, [take(T("n1"), U.sam.id), take(T("rc"), null), ...loose.slice(0, 18)]));
    t("7j and never an approved take", !x.ok && codeOf(x) === "take_owner", undefined, x);
  }

  /* S5. a render running when the team changes still lands (decision D) */
  x = await E.hold(U.pat, U.sam, samRow, fp, 30, "s5:vid", "video");
  const held = x.ok === true;
  let rpc = await E.as(U.pat, "select * from public.turn_film_pending_takes($1)", [fp]);
  t("5a the pending-takes call exists", rpc.ok, !rpc.ok, rpc);
  if (isNew && held) {
    await E.svc(`update public.turn_credit_holds set take = '{"clipId":"clip-s1","meta":{"by":"${U.sam.id}","vno":3}}' where ref = 's5:vid'`);
    await E.as(U.pat, "update public.turn_project_members set status = 'removed' where id = $1", [samRow]);   // removed mid-render
    rpc = await E.as(U.pat, "select * from public.turn_film_pending_takes($1)", [fp]);
    t("5b nothing while the render runs", rpc.ok && rpc.rows.length === 0, undefined, rpc);
    await E.svc("select public.turn_settle_hold('s5:vid', 24)");
    await E.svc(`update public.turn_credit_holds set take = take || '{"url":"https://v3.fal.media/files/late.mp4","settledAt":"2026-10-09T10:00:00Z"}' where ref = 's5:vid'`);
    rpc = await E.as(U.pat, "select * from public.turn_film_pending_takes($1)", [fp]);
    const pt = rpc.rows && rpc.rows[0];
    t("5c settled after Sam was removed: the owner gets the take (ref, clip, url, meta, settled time, who made it)",
      rpc.ok && rpc.rows.length === 1 && pt.ref === "s5:vid" && pt.clip_id === "clip-s1" && pt.url.endsWith("late.mp4")
      && pt.take_meta.vno === 3 && new Date(pt.settled_at).toISOString() === "2026-10-09T10:00:00.000Z" && pt.actor === U.sam.id, undefined, rpc);
    x = await E.as(U.sam, "select * from public.turn_film_pending_takes($1)", [fp]);
    const xm = await E.as(X.ari, "select public.turn_film_mark_takes_collected($1, array['s5:vid']) n", [fp]);
    const xanon = await E.as("anon", "select * from public.turn_film_pending_takes($1)", [fp]);
    t("5d nobody else sees or marks them (anon can't call)", x.ok && x.rows.length === 0 && xm.ok && xm.row.n === 0 && !xanon.ok, undefined, { x, xm, xanon });
    x = await E.as(U.pat, "select public.turn_film_mark_takes_collected($1, array['s5:vid', 'nope']) n", [fp]);
    rpc = await E.as(U.pat, "select * from public.turn_film_pending_takes($1)", [fp]);
    const again = await E.as(U.pat, "select public.turn_film_mark_takes_collected($1, array['s5:vid']) n", [fp]);
    t("5e the owner marks it collected: gone from the list, and marking again changes nothing",
      x.ok && x.row.n === 1 && rpc.ok && rpc.rows.length === 0 && again.ok && again.row.n === 0, undefined, { x, rpc, again });
    // S6b: Sam was removed this month after spending: the owner still sees it
    x = await E.as(U.pat, "select * from public.turn_team_spend($1)", [fp]);
    const sRow = x.rows && x.rows.find((s) => s.member_id === samRow);
    const vRow = x.rows && x.rows.find((s) => s.member_email === X.pen.email);
    t("6b the owner's spend view keeps someone removed this month who spent (removed: true); active rows stay",
      x.ok && sRow && sRow.removed === true && sRow.spent === 24 && sRow.member_email === U.sam.email && vRow && vRow.removed === false, undefined, x);
    await E.as(U.pat, "update public.turn_project_members set status = 'removed' where project_id = $1 and member_email = $2", [fp, X.pen.email]);
    x = await E.as(U.pat, "select * from public.turn_team_spend($1)", [fp]);
    t("6b' someone removed who spent nothing doesn't show", x.ok && !x.rows.some((s) => s.member_email === X.pen.email), undefined, x);
    x = await E.as(U.sam, "select * from public.turn_team_spend($1)", [fp]);
    t("6b'' and the removed person sees nothing", x.ok && x.rows.length === 0, undefined, x);
  }

  /* S6a. a Show-wide member's spend on an Episode */
  const bibleJ = JSON.stringify({ characters: [], locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } });
  const fe = await E.film(U.pat, "Becomes Episode 1");
  r = await E.as(U.pat, "select public.turn_convert_project_to_show($1, 'Show', $2::jsonb, 'series') r", [fe, bibleJ]);
  if (r.ok) {
    const S = r.row.r.show.id;
    await E.invite(U.pat, S, X.vo.email, "art_director"); await E.claim(X.vo);
    const showRow = (await E.row(S, X.vo.email)).id;
    x = await E.hold(U.pat, X.vo, showRow, fe, 7, "s6:ep", "image");
    const sp = await E.as(X.vo, "select * from public.turn_team_spend($1)", [fe]);
    const mine = sp.rows && sp.rows.find((s) => s.member_id === showRow);
    t("6a a Show-wide member polling on an Episode gets their Show row's spend there", x.ok && mine && mine.spent === 7 && mine.removed === false,
      sp.ok && !mine, { x, sp });
  }

  /* S6c. a Stage slot a collaborator creates is the owner's: 1l above (and S-up for rows made before) */

  /* S8. a RE-HOLD for finished work (decision D): blender-bridge re-holds a 3D job housekeeping released */
  x = await E.hold(U.pat, X.ari, ariRow, fp, 6, "s8:3d", "3d");
  await E.svc("select public.turn_release_hold('s8:3d')");
  await E.as(U.pat, "update public.turn_project_members set budget_credits = 0 where id = $1", [ariRow]);
  await E.as(U.pat, "update public.turn_project_members set status = 'removed' where id = $1", [ariRow]);
  await E.sw(false);
  const rh = await E.hold(U.pat, X.ari, ariRow, fp, 6, "s8:3d:rehold", "3d");
  const rh2 = await E.hold(U.pat, X.ari, ariRow, fp, 6, "s8:3d:rehold2", "3d");
  const rhRow = (await E.q("select owner, actor, member_id, project_id, status from public.turn_credit_holds where ref = 's8:3d:rehold'"))[0];
  t("8a Ari removed, sharing off, budget 0: the re-hold of her finished 3D job still holds on the owner's balance",
    x.ok === true && rh.ok === true && rh2.ok === true && rhRow && rhRow.owner === U.pat.id && rhRow.actor === X.ari.id && rhRow.member_id === ariRow,
    x.ok === true && rh.ok !== true, { x, rh, rh2, rhRow });
  const rhx = await E.hold(U.pat, X.ari, ariRow, fp, 6, "s8:none:rehold", "3d");
  const rhs = await E.hold(U.pat, X.ari, ariRow, fp, 6, "4c-not-a-base:rehold", "3d");
  const rhSam = await E.hold(U.pat, X.ari, ariRow, fp, 6, "s5:vid:rehold", "3d");   // the base is Sam's hold, not Ari's
  t("8b without an original hold of this same person and film, the usual checks apply",
    rhx.ok !== true && rhs.ok !== true && rhSam.ok !== true, undefined, { rhx, rhs, rhSam });
  await E.sw(true);
}

{
  const PROD = gitShow(PROD_REV, "supabase/team-relaunch.sql");
  if (PROD === null) console.log("SKIP S-old: git (or the production file) isn't available");
  else {
    const PE = await reviewEnv(PROD);
    await stageReview(PE, false);
    // production's path: a Stage editor's take row made under the production file (owned by them), then today's file twice
    const fx = await PE.film(U.pat, "Upgrade");
    await PE.invite(U.pat, fx, U.sam.email, "stage_editor"); await PE.claim(U.sam);
    const made = await PE.as(U.sam, `insert into public.turn_generations(project_id, owner, entity_id, meta) values ($1, $2, 'clip-up', '{"kind":"video","video":{"url":"https://v3.fal.media/files/up.mp4"}}') returning owner`, [fx, U.sam.id]);
    let eUp = null;
    try { await PE.db.exec(RELAUNCH); await PE.db.exec(RELAUNCH); } catch (err) { eUp = err.message; }
    ok("S-up today's file installs over production's (151175c), with its data, and again", eUp === null && made.ok && made.row.owner === U.sam.id, eUp || made);
    const own = (await PE.q("select owner from public.turn_generations where project_id = $1 and entity_id = 'clip-up'", [fx]))[0];
    ok("S-up the Stage editor's existing take row now belongs to the film's owner", own && own.owner === U.pat.id, own);
    const fns = await PE.q("select pg_get_function_identity_arguments(oid) a from pg_proc where proname = 'turn_can_write_generation'");
    ok("S-up one turn_can_write_generation is left, the whole-row one", fns.length === 1 && /p_history/.test(fns[0].a), fns);
    const cols = await PE.q("select column_name from information_schema.columns where table_name = 'turn_credit_holds' and column_name = 'take'");
    ok("S-up turn_credit_holds has `take`", cols.length === 1, cols);
    let eR = null;
    try { await PE.db.exec(read("supabase/series-production.sql")); await PE.db.exec(RELAUNCH); } catch (err) { eR = err.message; }
    const fdef = (await PE.q("select pg_get_functiondef('public.turn_enforce_role_sections()'::regprocedure) d"))[0].d;
    ok("S-up series-production.sql re-run, then this file again: both succeed, the Stage scope is back", eR === null && /stage_scope/.test(fdef), eR);
    await PE.db.close();
  }
  const SE = await reviewEnv(RELAUNCH);
  await stageReview(SE, true);
  // and the whole review again after series-production.sql re-runs and this file follows (the documented order)
  let eR = null;
  try { await SE.db.exec(read("supabase/series-production.sql")); await SE.db.exec(RELAUNCH); } catch (err) { eR = err.message; }
  ok("S-rerun series-production.sql, then this file: both succeed", eR === null, eR);
  if (eR === null) {
    const x = await SE.as(U.sam, `insert into public.turn_generations(project_id, owner, entity_id, meta) values ((select id from public.turn_projects where title = 'Stage review' limit 1), $1, 'clip-p9', $2::jsonb) returning entity_id`,
      [U.sam.id, JSON.stringify({ kind: "video", video: { url: "https://v3.fal.media/files/p9.mp4" }, cleanupPending: ["x/y/z"] })]);
    ok("S-rerun and the P1 probe is still refused", !x.ok && /stage_slot/.test(x.error), x);
  }
  await SE.db.close();
}

{
  const OLD = gitShow(OLD_REV, "supabase/team-relaunch.sql");
  if (OLD === null) console.log("SKIP Q-old: git (or the 2026-10-03 file) isn't available");
  else {
    const OE = await reviewEnv(OLD);
    await review(OE, false);
    // production's path: today's file over the 2026-10-03 one, with everything the review left behind
    let eUp = null;
    try { await OE.db.exec(RELAUNCH); await OE.db.exec(RELAUNCH); } catch (err) { eUp = err.message; }
    ok("Q-up today's file installs over the 2026-10-03 one (and again), with its data", eUp === null, eUp);
    const fns = await OE.q("select pg_get_function_identity_arguments(oid) a from pg_proc where proname = 'turn_hold_credits_for_film'");
    ok("Q-up one turn_hold_credits_for_film is left, the one with p_kind", fns.length === 1 && /p_kind text/.test(fns[0].a), fns);
    await OE.sw(false);
    const pz = (await OE.svc("select public.turn_film_payer($1,$2,'image') j", [X.ari.id, (await OE.q("select project_id from public.turn_project_members where member_email = $1 and status = 'active' limit 1", [X.ari.email]))[0].project_id])).j;
    ok("Q-up and answers with today's rules (switch off: paused)", pz.code === "paused", pz);
    await OE.db.close();
  }
  const NE = await reviewEnv(RELAUNCH, { realtime: true });
  await review(NE, true);
  await NE.db.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

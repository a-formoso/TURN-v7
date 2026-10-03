#!/usr/bin/env node
/* supabase/team-relaunch.sql — EXECUTED against an in-memory Postgres (PGlite), on top of the files
   production has (schema, storage, team-collaboration, shared-owners, enforce-role-scopes, cameos,
   credits, app-config, series-production). The owner's rules (docs/Dashboard Plan.md §5-§7, §9):
   Director and up shares; 5 / 10 people a film (pending count); 3 Co-writers; 20 new invites a day;
   invites expire after 14 days and need a confirmed email; Stage editor on Producer films only; rooms
   follow the owner's plan (below Director → read-only); the owner pays within each person's budget
   (200 Director / 500 Producer). Uses the harness of scripts/test-series-production-sql.mjs.
     node scripts/test-team-relaunch-db.mjs */
import { readFileSync } from "node:fs";
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
r = await saveSection(U.sam, F.pat1, "shots", [{ id: "sh1" }]);
ok("F3 a Stage editor saves shots on a Producer film", r.ok && r.rows.length === 1, r.error);
r = await saveSection(U.sam, F.pat1, "scenes", []);
ok("F4 but not the story", !r.ok && /TURN_ROLE_SCOPE/.test(r.error), r.error);
r = await as(U.sam, "select public.turn_can_write_assets($1) w", [F.pat1]);
ok("F5 a Stage editor may upload the film's files", r.ok && r.row.w === true, r);
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
ok("H4 a Co-writer making Art Room images: billed as before (role)", (await payer(U.cara, F.dora1, "image")).code === "role");
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
ok("H15 switch off: a collaborator is billed as before", (await payer(U.cara, F.dora1, "text")).code === "off");
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
r = await as(U.cara, "select set_config('turn.team_trusted','on',true); update public.turn_project_members set role='writer' where id=$1 returning id", [caraRow]);
ok("P3 setting the trusted flag by hand is not a way around the guard (owner only)", !r.ok || (r.rows || []).length === 0, r);
r = await as(U.cara, "select count(*)::int n from public.turn_team_invite_log");
ok("P4 the invite log isn't readable", !r.ok || r.row.n === 0, r);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

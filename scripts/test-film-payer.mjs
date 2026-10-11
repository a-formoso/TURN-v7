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
   TEAM REVIEW (2026-10-09; owner decisions B and C): a role that doesn't cover the call, sharing
   switched off and an unconfirmed check are REFUSED (film_role / team_paused / film_unverified),
   never billed to the collaborator; a missing turn_film_payer bills the caller; routing fields must
   be strings; the collaborator is sent `usage.budget`, never the owner's balance or plan; their own
   provider keys are ignored when the owner pays; an admin-owned film is gated as the admin's;
   Blender's re-hold of an owner-paid job goes back to the owner.
   STAGE EDITOR REVIEW (2026-10-09; owner decisions D and E): a real film the caller isn't on is
   refused (film_access), only a film id that names no film bills the caller; voice is split into
   voice (text-to-speech) and voice_design (the Art director's; an older database is asked with
   'voice' only for an Art director); one call bigger than what's left of the budget is told so
   (`needed`); an owner-paid render's take is written on its hold at submit and gets the output's
   url when it settles (the poll — also by a person removed meanwhile — and the reconciliation);
   a malformed clipId / take is ignored; the poll finds a Show-wide member's budget.
     node scripts/test-film-payer.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import * as FP from "../supabase/functions/image-proxy/film-payer.mjs";
import { createHoldClient } from "../supabase/functions/image-proxy/billing-holds.mjs";
import { requestContext, requestTake } from "../supabase/functions/image-proxy/request-context.mjs";
import { reconcileVideoHolds } from "../supabase/functions/image-proxy/video-reconcile.mjs";
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
  // (Team review, 2026-10-09) routing fields that aren't strings are never film work; 3D is Blender's only
  assert.equal(FP.filmCallKind(["text"], {}), "", "an array task");
  assert.equal(FP.filmCallKind({ toString: () => "text" }, {}), "");
  assert.equal(FP.filmCallKind("text", { usageKind: ["writing"] }), "");
  assert.equal(FP.filmCallKind("voice", { op: ["tts"] }), "");
  assert.equal(FP.filmCallKind("video", { op: ["submit"] }), "");
  assert.equal(FP.filmCallKind("3d", {}), "", "image-proxy has no 3D route");
  assert.equal(FP.filmCallKind("3d", {}, { allow3d: true }), "3d");
  // (Stage editor review, 2026-10-09) text-to-speech is voice; the character voice tools are voice_design
  assert.equal(FP.filmCallKind("voice", {}), "voice", "the default op is tts");
  assert.equal(FP.filmCallKind("voice", { op: "listVoices" }), "voice");
  for (const op of ["design", "saveVoice", "clone"]) assert.equal(FP.filmCallKind("voice", { op }), "voice_design", op);
});
await test("A2 the database's answer: own, owner (with the member and budget), refuse, or bill the caller", async () => {
  const rpcOf = (data, error = null) => async (name, args) => { rpcOf.last = [name, args]; return { data, error }; };
  const base = { actor: "a1000000-0000-4000-8000-000000000001", context: { projectId: FILM }, kind: "text" };
  assert.deepEqual(await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, own: true }) }), { mode: "own" });
  assert.deepEqual(rpcOf.last, ["turn_film_payer", { p_actor: base.actor, p_project: FILM, p_kind: "text" }]);
  const m = "b1000000-0000-4000-8000-000000000002", o = "c1000000-0000-4000-8000-000000000003";
  const owner = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, payer: o, member_id: m, role: "writer", budget: 200, spent: 20, tier: "director" }) });
  assert.deepEqual(owner, { mode: "owner", payer: o, actor: base.actor, memberId: m, projectId: FILM, role: "writer", budget: 200, spent: 20, tier: "director", kind: "text" });
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: true, payer: o, member_id: m, budget: null }) })).budget, null, "no limit");
  const paused = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "owner_plan" }) });
  assert.equal(paused.mode, "refuse"); assert.equal(paused.refusal.status, 402); assert.equal(paused.refusal.body.code, "owner_plan");
  const used = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "budget_reached", budget: 200, spent: 1200 }) });
  assert.equal(used.refusal.body.code, "budget_reached"); assert.match(used.refusal.body.message, /1,200 of 200/);
  // (Stage editor review, 2026-10-09; owner decision E) only a film id that names no film is billed to
  // the caller; a real film the caller isn't on is refused (film_access), never billed to them
  assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "no_film" }) })).mode, "caller");
  const outsider = await FP.resolveFilmPayer({ ...base, rpc: rpcOf({ ok: false, code: "not_member" }) });
  assert.deepEqual(outsider, { mode: "refuse", refusal: FP.filmAccess() });
  assert.deepEqual(FP.filmAccess(), { status: 403, body: { error: "film_access", code: "film_access",
    message: "You're not on this film's team right now, so work on it can't be charged to it." } });
  // (Team review, 2026-10-09) refused in plain words, never billed to the collaborator
  const refusedAs = async (rpc) => { const r = await FP.resolveFilmPayer({ ...base, rpc }); assert.equal(r.mode, "refuse", j(r)); return [r.refusal.status, r.refusal.body.code]; };
  assert.deepEqual(await refusedAs(rpcOf({ ok: false, code: "role", role: "writer" })), [403, "film_role"]);
  assert.deepEqual(await refusedAs(rpcOf({ ok: false, code: "paused" })), [403, "team_paused"]);
  assert.deepEqual(await refusedAs(rpcOf({ ok: false, code: "off" })), [403, "team_paused"], "the older SQL's word for the switch");
  assert.deepEqual(await refusedAs(rpcOf(null, { message: "down" })), [503, "film_unverified"], "a failed check is refused, never billed to anyone");
  assert.deepEqual(await refusedAs(async () => { throw new Error("x"); }), [503, "film_unverified"]);
  assert.deepEqual(await refusedAs(rpcOf("not json")), [503, "film_unverified"], "an unparseable answer");
  assert.deepEqual(await refusedAs(rpcOf({ ok: false, code: "something_new" })), [503, "film_unverified"]);
  assert.deepEqual(await refusedAs(rpcOf({ ok: true, payer: "not-a-uuid", member_id: m })), [503, "film_unverified"]);
  // …except a database without turn_film_payer (before team-relaunch.sql): the caller, as before
  for (const err of [{ code: "PGRST202", message: "Could not find the function public.turn_film_payer(p_actor, p_kind, p_project) in the schema cache" },
    { code: "42883", message: "function public.turn_film_payer(uuid, uuid, text) does not exist" }])
    assert.equal((await FP.resolveFilmPayer({ ...base, rpc: rpcOf(null, err) })).mode, "caller", err.code);
  assert.deepEqual(FP.filmRole().body, { error: "film_role", code: "film_role", message: "Your role on this film doesn't include this." });
  assert.deepEqual(FP.filmUnverified().body.message, "Couldn't confirm who pays for work on this film. Try again in a moment.");
  assert.deepEqual(FP.teamPaused().body.message, "Sharing is paused on this film right now, so it's read-only for collaborators.");
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
await test("A4 (Team review, 2026-10-09) hold-time codes, the collaborator's usage shape, admin-owned films, who paid for a hold", async () => {
  const code = (h) => [FP.filmHoldRefusal(h).status, FP.filmHoldRefusal(h).body.code];
  assert.deepEqual(code({ code: "budget_reached", budget: 200, spent: 190 }), [402, "budget_reached"]);
  assert.deepEqual(code({ code: "owner_plan" }), [402, "owner_plan"]);
  assert.deepEqual(code({ code: "frozen" }), [402, "owner_plan"], "a frozen OWNER reads as the owner's plan, never 'your account is on hold'");
  assert.deepEqual(code({ code: "paused" }), [403, "team_paused"]);
  assert.deepEqual(code({ code: "role" }), [403, "film_role"]);
  assert.deepEqual(code({ code: "not_member" }), [403, "film_access"], "(Stage editor review, 2026-10-09) the person is no longer on the film");
  assert.deepEqual(code({ code: "mismatch" }), [503, "film_unverified"]);
  assert.deepEqual(code({ code: "no_film" }), [503, "film_unverified"]);
  assert.deepEqual(code({ code: "insufficient", remaining: 12 }), [402, "owner_insufficient"]);
  // no refusal carries an address or a figure of the owner's
  for (const r of [FP.filmRole(), FP.filmUnverified(), FP.teamPaused(), FP.filmAccess(), FP.ownerPlanPaused(), FP.ownerShortOfCredits(), FP.filmHoldRefusal({ code: "insufficient", remaining: 4321 })])
    assert.doesNotMatch(r.body.message, /@|\d/, j(r));
  // usage: the owner's balance and plan dropped, the collaborator's budget added
  assert.deepEqual(FP.collaboratorUsage({ credits: 30, remaining: 4321, plan: "director", planRemaining: 1, packRemaining: 2, providerCostUsd: 0.3 }, { limit: 200, spent: 50 }),
    { credits: 30, providerCostUsd: 0.3, budget: { limit: 200, spent: 50 } });
  assert.deepEqual(FP.collaboratorUsage({ credits: 1, remaining: 9 }, { limit: null, spent: 7 }), { credits: 1, budget: { limit: null, spent: 7 } }, "null = no limit");
  assert.deepEqual(FP.collaboratorUsage({ credits: 1, remaining: 9, plan: "studio" }, null), { credits: 1 }, "budget unknown: still nothing of the owner's");
  // the owner's account: an admin owner needs no credits row; anyone else's missing row is "unavailable"
  const from = (rows, error = null) => () => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: rows, error }) }; return c; };
  const getUser = async (id) => ({ data: { user: { id, email: id === "adm" ? "Admin@InfiniteStudioAI.com" : "x@example.com" } } });
  const adminEmails = ["admin@infinitestudioai.com"];
  assert.deepEqual(await FP.loadOwnerAccountRow(from([]), "adm", { getUser, adminEmails }), { row: null, ok: true, isAdmin: true });
  assert.deepEqual(await FP.loadOwnerAccountRow(from([]), "u2", { getUser, adminEmails }), { row: null, ok: false, isAdmin: false });
  assert.deepEqual(await FP.loadOwnerAccountRow(from([{ plan: "director" }]), "u2", { getUser, adminEmails }), { row: { plan: "director" }, ok: true, isAdmin: false });
  assert.equal((await FP.loadOwnerAccountRow(from([]), "adm", { getUser: async () => { throw new Error("x"); }, adminEmails })).isAdmin, false, "a failed read is not admin");
  // who paid for a hold (a video poll's usage row)
  const tables = { turn_credit_holds: [{ owner: "o1", actor: "a1", member_id: "m1", project_id: FILM }], turn_project_members: [{ role: "stage_editor" }] };
  const tf = (t) => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: tables[t] || [], error: null }) }; return c; };
  const hp = await FP.loadHoldPayer(tf, "video:x");
  assert.deepEqual(hp, { ok: true, found: true, owner: "o1", actor: "a1", memberId: "m1", projectId: FILM, role: "stage_editor", memberProjectId: "" });
  assert.deepEqual(FP.filmPaidMetadataFromHold(hp), { paidBy: "o1", memberId: "m1", filmRole: "stage_editor" });
  assert.deepEqual(FP.filmPaidMetadataFromHold({ ok: true, found: true, owner: "o1", memberId: "" }), {});
  assert.deepEqual(await FP.loadHoldPayer(() => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: null, error: { message: "x" } }) }; return c; }, "r"), { ok: false });
  // FILM_HOLD_RPC has ONE home (billing-holds.mjs)
  const { FILM_HOLD_RPC } = await import("../supabase/functions/image-proxy/billing-holds.mjs");
  assert.equal(FP.FILM_HOLD_RPC, FILM_HOLD_RPC);
  assert.doesNotMatch(read("supabase/functions/image-proxy/film-payer.mjs"), /export const FILM_HOLD_RPC/);
});

await test("A5 (Stage editor review, 2026-10-09) voice_design: asked as is; an older database that refuses an Art director is asked with 'voice' — a Stage editor never is", async () => {
  const actor = "a1000000-0000-4000-8000-000000000001", m = "b1000000-0000-4000-8000-000000000002", o = "c1000000-0000-4000-8000-000000000003";
  const okFor = (kind) => ({ ok: true, payer: o, member_id: m, role: "art_director", budget: 200, spent: 0, tier: "studio" });
  // the newer database knows voice_design: one question, the hold names voice_design
  let asked = [];
  let r = await FP.resolveFilmPayer({ actor, context: { projectId: FILM }, kind: "voice_design",
    rpc: async (n, a) => { asked.push(a.p_kind); return { data: okFor(a.p_kind), error: null }; } });
  assert.deepEqual(asked, ["voice_design"]); assert.equal(r.mode, "owner"); assert.equal(r.kind, "voice_design");
  // the production SQL before this review: an unknown kind needs no role at all → 'role' (with the member's role)
  const oldSql = (role) => async (n, a) => { asked.push(a.p_kind); return { data: a.p_kind === "voice" ? { ...okFor(a.p_kind), role } : { ok: false, code: "role", role }, error: null }; };
  asked = []; const logs = [];
  r = await FP.resolveFilmPayer({ actor, context: { projectId: FILM }, kind: "voice_design", rpc: oldSql("art_director"), log: (x) => logs.push(x) });
  assert.deepEqual(asked, ["voice_design", "voice"]); assert.equal(r.mode, "owner"); assert.equal(r.kind, "voice", "the hold names the kind that database knows");
  assert.match(logs.join("\n"), /doesn't know 'voice_design' yet/);
  asked = [];
  r = await FP.resolveFilmPayer({ actor, context: { projectId: FILM }, kind: "voice_design", rpc: oldSql("stage_editor") });
  assert.deepEqual(asked, ["voice_design"], "a Stage editor's refusal is final"); assert.deepEqual(r, { mode: "refuse", refusal: FP.filmRole() });
  // text-to-speech is never retried, and a refusal never carries the database's code / role out
  asked = [];
  r = await FP.resolveFilmPayer({ actor, context: { projectId: FILM }, kind: "voice",
    rpc: async (n, a) => { asked.push(a.p_kind); return { data: { ok: false, code: "role", role: "art_director" }, error: null }; } });
  assert.deepEqual(asked, ["voice"]); assert.deepEqual(Object.keys(r).sort(), ["mode", "refusal"]);
  // the hold names the confirmed kind (p_kind)
  const calls = [];
  const h = createHoldClient({ uid: o, film: { actor, memberId: m, projectId: FILM, kind: "voice_design" }, newId: () => "v1",
    rpc: async (n, a) => { calls.push(a); return { data: { ok: true, held: a.amount }, error: null }; } });
  await h.take({ amount: 40, kind: "voice" });
  assert.equal(calls[0].p_kind, "voice_design");
  assert.ok(read("supabase/functions/image-proxy/index.ts").includes("kind: film.kind || filmKind"), "index.ts holds with the confirmed kind");
});
await test("A6 (Stage editor review, 2026-10-09) the budget refusal: one call bigger than what's left is told so; 'You've used…' only when it's used up", () => {
  const r = FP.budgetReached(500, 0, 640);
  assert.deepEqual(r, { status: 402, body: { error: "budget_reached", code: "budget_reached", budget: 500, spent: 0, needed: 640,
    message: "This needs about 640 credits, and your budget on this film has 500 left this month. The film's owner can raise it." } });
  assert.equal(FP.budgetReached(1200, 1150, 3000).body.message, "This needs about 3,000 credits, and your budget on this film has 50 left this month. The film's owner can raise it.");
  assert.equal(FP.budgetReached(500, 500, 640).body.message, "You've used this month's credit budget on this film (500 of 500). The film's owner can raise it.");
  assert.equal(FP.budgetReached(500, 520).body.message, "You've used this month's credit budget on this film (520 of 500). The film's owner can raise it.");
  assert.equal(FP.budgetReached(200, 190).body.needed, undefined, "no needed: none sent");
  // the hold's refusal carries the database's needed (or the amount asked)
  assert.match(FP.filmHoldRefusal({ code: "budget_reached", budget: 500, spent: 10, needed: 640 }).body.message, /^This needs about 640 credits, and your budget on this film has 490 left/);
  // the proxy: the local pre-check and the hold both pass what this call needs
  const proxy = read("supabase/functions/image-proxy/index.ts");
  assert.ok(proxy.includes("need > filmBudgetLeft ? budgetReached(film.budget, film.spent || 0, need) : ownerShortOfCredits()"));
  assert.ok(proxy.includes("refuse(budgetReached(h.budget ?? 0, h.spent ?? 0, h.needed ?? need))"));
});
await test("A7 (Stage editor review, 2026-10-09) the take: context.clipId + context.take, shapes checked; clipId is attribution, take never is", () => {
  const meta = { kind: "video", takeId: "t-1", shot: { n: 3 } };
  assert.deepEqual(requestTake({ clipId: "clip-s4_l2-a", take: meta }), { clipId: "clip-s4_l2-a", meta });
  assert.deepEqual(requestTake({ clipId: "clip-x" }), { clipId: "clip-x" }, "a take without meta");
  for (const bad of ["clip-", "clip-a b", "Clip-x", "x-clip-1", "clip-" + "a".repeat(101), 42, null, ["clip-x"], "clip-x\n"])
    assert.equal(requestTake({ clipId: bad, take: meta }), null, j(bad));
  assert.equal(requestTake(null), null); assert.equal(requestTake(["clip-x"]), null);
  for (const badMeta of [["a"], "text", 7, { big: "x".repeat(4000) }, { nul: "a\u0000b" }])
    assert.deepEqual(requestTake({ clipId: "clip-x", take: badMeta }), { clipId: "clip-x" }, "meta left out: " + j(badMeta).slice(0, 30));
  const edge = { s: "x".repeat(4000 - 8) };   // {"s":"…"} = exactly 4,000 characters
  assert.equal(j(edge).length, 4000); assert.deepEqual(requestTake({ clipId: "clip-x", take: edge }).meta, edge);
  assert.deepEqual(requestContext({ projectId: FILM, clipId: "clip-1", take: meta }), { projectId: FILM, clipId: "clip-1" }, "take is never attribution");
  assert.deepEqual(requestContext({ clipId: "clip-<b>" }), {});
});
// a fake turn_credit_holds for the take helpers (service role: select / update by ref)
const takeTable = (rows, { selectError = null, updateError = null } = {}) => {
  const writes = [];
  const from = (t) => {
    assert.equal(t, "turn_credit_holds");
    let vals = null; const f = {};
    const c = { select: () => c, update: (v) => { vals = v; return c; }, eq: (k, v) => { f[k] = v; return c; },
      limit: async () => ({ data: selectError ? null : rows.filter((r) => r.ref === f.ref), error: selectError }),
      then: (ok, bad) => Promise.resolve().then(() => {
        if (updateError) return { error: updateError };
        writes.push([f.ref, vals]); for (const r of rows) if (r.ref === f.ref) Object.assign(r, vals);
        return { error: null };
      }).then(ok, bad) };
    return c;
  };
  return { from, writes, rows };
};
await test("A8 (Stage editor review, 2026-10-09; owner decision D) the take is written at submit and gets the output's url at settle — only a hold that carries one", async () => {
  const T = takeTable([{ ref: "video:a", take: null }, { ref: "video:own", take: null }]);
  assert.equal(await FP.writeHoldTake(T.from, "video:a", { clipId: "clip-9", meta: { n: 1 } }), true);
  assert.deepEqual(T.rows[0].take, { clipId: "clip-9", meta: { n: 1 } });
  assert.equal(await FP.writeHoldTake(T.from, "video:a", null), false); assert.equal(await FP.writeHoldTake(T.from, "", { clipId: "clip-9" }), false);
  const at = new Date("2026-10-09T12:00:00Z");
  assert.equal(await FP.recordTakeUrl(T.from, "video:a", "https://v3.fal.media/files/out.mp4", { now: () => at }), true);
  assert.deepEqual(T.rows[0].take, { clipId: "clip-9", meta: { n: 1 }, url: "https://v3.fal.media/files/out.mp4", settledAt: "2026-10-09T12:00:00.000Z" });
  const n = T.writes.length;
  assert.equal(await FP.recordTakeUrl(T.from, "video:a", "https://v3.fal.media/files/out.mp4", { now: () => new Date() }), true);
  assert.equal(T.writes.length, n, "the same url again: nothing rewritten (settledAt kept)");
  assert.equal(await FP.recordTakeUrl(T.from, "video:own", "https://v3.fal.media/files/o.mp4"), false, "a hold without a take (the caller's own render) is left alone");
  assert.equal(T.writes.length, n);
  assert.equal(await FP.recordTakeUrl(T.from, "video:a", "javascript:alert(1)"), false);
  // failures are logged, never thrown; a database without the column (before the SQL) is quiet
  const logs = [];
  assert.equal(await FP.recordTakeUrl(takeTable([], { selectError: { code: "42703", message: 'column "take" does not exist' } }).from, "video:a", "https://x.example/v.mp4", { log: (m) => logs.push(m) }), false);
  assert.equal(await FP.writeHoldTake(takeTable([], { updateError: { code: "42703", message: 'column "take" of relation "turn_credit_holds" does not exist' } }).from, "video:a", { clipId: "clip-1" }, { log: (m) => logs.push(m) }), false);
  assert.equal(logs.length, 0, j(logs));
  assert.equal(await FP.writeHoldTake(takeTable([], { updateError: { message: "connection reset" } }).from, "video:a", { clipId: "clip-1" }, { log: (m) => logs.push(m) }), false);
  assert.equal(await FP.recordTakeUrl(() => { throw new Error("boom"); }, "video:a", "https://x.example/v.mp4", { log: (m) => logs.push(m) }), false);
  assert.equal(logs.length, 2); assert.ok(logs.every((m) => /^\[billing\] take video:a/.test(m)), j(logs));
});
await test("A9 (Stage editor review, 2026-10-09) the reconciliation hands a settled render's output to onSettled; a failure there never breaks the settle", async () => {
  const reason = "video:kling-3.0:720p m=fal-ai/kling-video/v3/standard/image-to-video";
  const old = new Date(Date.now() - 2 * 3600e3).toISOString();
  const T = takeTable([{ ref: "video:r1", take: { clipId: "clip-r1" } }, { ref: "video:r2", take: null }]);
  const settled = {};
  const rpc = async (name, args) => name === "turn_claim_housekeeping" ? { data: true }
    : name === "turn_open_provider_holds" ? { data: [{ ref: "video:r1", owner: "o", provider_ref: "r1", held: 50, reason, created_at: old },
        { ref: "video:r2", owner: "o", provider_ref: "r2", held: 50, reason, created_at: old }, { ref: "video:r3", owner: "o", provider_ref: "r3", held: 50, reason, created_at: old }] }
    : name === "turn_settle_hold" ? (settled[args.ref] = args.actual, { data: { ok: true, kept: args.actual } }) : { error: { message: "unexpected " + name } };
  const fetchImpl = async (url) => {
    const m = /\/requests\/([^/]+)(\/status)?$/.exec(String(url));
    if (m[2]) return new Response(j({ status: "COMPLETED" }), { status: 200 });
    return new Response(j({ video: { url: `https://v3.fal.media/files/${m[1]}.mp4` } }), { status: 200 });
  };
  const seen = [];
  const r = await reconcileVideoHolds({ rpc, falKey: "k", fetchImpl, onSettled: async ({ ref, videoUrl }) => {
    seen.push(ref); if (ref === "video:r3") throw new Error("boom");
    await FP.recordTakeUrl(T.from, ref, videoUrl, { now: () => new Date("2026-10-09T13:00:00Z") });
  } });
  assert.deepEqual([r.body.settled, Object.keys(settled).sort()], [3, ["video:r1", "video:r2", "video:r3"]], j(r.body));
  assert.deepEqual(seen.sort(), ["video:r1", "video:r2", "video:r3"]);
  assert.deepEqual(T.rows[0].take, { clipId: "clip-r1", url: "https://v3.fal.media/files/r1.mp4", settledAt: "2026-10-09T13:00:00.000Z" });
  assert.equal(T.rows[1].take, null, "no take: nothing recorded");
  // index.ts wires it to the hold's take (service role)
  assert.ok(read("supabase/functions/image-proxy/index.ts").includes("onSettled: ({ ref, videoUrl }: { ref: string; videoUrl: string }) =>\n        recordTakeUrl((t: string) => svc.from(t), ref, videoUrl,"));
});
await test("A10 (Stage editor review, 2026-10-09) the poll reads the collaborator's budget on the hold's film, then on the film their row is on (a Show-wide member)", async () => {
  const EP = "e1000000-0000-4000-8000-000000000001", SHOW = "5a000000-0000-4000-8000-000000000001", M = "b1000000-0000-4000-8000-000000000002";
  const asked = [];
  const rpc = async (n, a) => { asked.push(a.pid); return { data: a.pid === SHOW ? [{ member_id: M, spent: 120, budget: 500 }] : [], error: null }; };
  assert.deepEqual(await FP.pollBudget(rpc, { memberId: M, projectId: EP, memberProjectId: SHOW }), { limit: 500, spent: 120 });
  assert.deepEqual(asked, [EP, SHOW]);
  asked.length = 0;
  const fam = async (n, a) => { asked.push(a.pid); return { data: [{ member_id: M, spent: 7, budget: null }], error: null }; };
  assert.deepEqual(await FP.pollBudget(fam, { memberId: M, projectId: EP, memberProjectId: SHOW }), { limit: null, spent: 7 });
  assert.deepEqual(asked, [EP], "a family-aware turn_team_spend answers on the Episode");
  assert.equal(await FP.pollBudget(async () => ({ data: [], error: null }), { memberId: M, projectId: EP, memberProjectId: EP }), null, "removed: no budget sent");
  assert.equal(await FP.pollBudget(async () => { throw new Error("x"); }, { memberId: M, projectId: EP }), null);
  assert.equal(await FP.pollBudget(rpc, null), null);
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
  assert.deepEqual(await h.take({ amount: 30, kind: "text" }), { ok: false, code: "budget_reached", budget: 200, spent: 190, needed: 30, remaining: null },
    "(Stage editor review, 2026-10-09) needed: the amount asked when the database doesn't say");
  answer = { ok: false, code: "budget_reached", budget: 500, spent: 0, needed: 640 };
  assert.equal((await h.take({ amount: 640, kind: "video" })).needed, 640);
  const plain = createHoldClient({ uid: "u", newId: () => "id2", rpc: async (name, args) => { calls.push([name, args]); return { data: { ok: true, held: 1 }, error: null }; } });
  await plain.take({ amount: 1, kind: "image" });
  assert.equal(calls.at(-1)[0], "turn_hold_credits", "without a film: the caller's own hold, as before");
});
await test("B2 (Team review, 2026-10-09) the film hold names the kind (p_kind; once more without it on an older database), keeps the database's refusal codes and carries the budget", async () => {
  const calls = [];
  let answer = (args) => ({ data: { ok: true, held: args.amount, remaining: 970, budget: 200, spent: 80 }, error: null });
  const h = createHoldClient({ uid: "owner", film: { actor: "cara", memberId: "m1", projectId: FILM, kind: "image" }, newId: () => "id" + calls.length,
    rpc: async (name, args) => { calls.push([name, args]); return answer(args); } });
  const ok = await h.take({ amount: 30, kind: "image" });
  assert.equal(calls[0][1].p_kind, "image"); assert.deepEqual([ok.budget, ok.spent], [200, 80]);
  answer = (args) => ("p_kind" in args ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } } : { data: { ok: true, held: args.amount }, error: null });
  calls.length = 0;
  assert.equal((await h.take({ amount: 5, kind: "image" })).ok, true);
  assert.deepEqual(calls.map((c) => "p_kind" in c[1]), [true, false], "asked once more without p_kind");
  for (const code of ["paused", "role", "owner_plan", "not_member"]) {
    answer = () => ({ data: { ok: false, code, held: 0 }, error: null });
    assert.equal((await h.take({ amount: 5, kind: "image" })).code, code);
  }
  answer = () => ({ data: null, error: { message: "connection reset" } });
  assert.equal((await h.take({ amount: 5, kind: "image" })).code, "unavailable");
});

/* ── D: Blender Studio (blender-bridge) ───────────────────────────────────── */
{
  const OWNER = "c1000000-0000-4000-8000-000000000003", ME = "a1000000-0000-4000-8000-000000000001", MEMBER = "b1000000-0000-4000-8000-000000000002";
  const mk = (W) => createSupabaseAdapter({ url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service",
    createClient: (url, key) => ({
      auth: { getUser: async () => ({ data: { user: { id: ME, email: "me@example.com" } }, error: null }) },
      rpc: async (name, args) => { W.rpcs.push([key, name, args]); return W.rpc(name, args); },
      from: (t) => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: W.tables[t] || [], error: null }),
        maybeSingle: async () => ({ data: (W.tables[t] || [])[0] || null, error: null }),
        then: (ok, bad) => Promise.resolve({ data: W.tables[t] || [], error: null }).then(ok, bad) }; return c; },
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
      { p_owner: OWNER, p_actor: ME, p_member: MEMBER, p_project: FILM, amount: 120, ref: "studio:e1", reason: "blender-studio", p_kind: "3d" });
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
  await test("D3 (Stage editor review, 2026-10-09) a real film the caller isn't on: refused (film_access), never billed; no such film (or the caller's own): the caller, as before", async () => {
    const W0 = world({ ok: false, code: "not_member" });
    const r0 = await mk(W0).authorizeCredit({ token: "t", cost: 120, eventId: "e5", projectId: FILM, ownerId: OWNER });
    assert.deepEqual([r0.code, r0.message], ["film_access", "You're not on this film's team right now, so work on it can't be charged to it."]);
    assert.ok(!W0.rpcs.some((x) => /^turn_hold_credits|turn_credit_balance/.test(x[1])), "nothing held, nothing of the caller's read");
    const W = world({ ok: false, code: "no_film" });
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
    a = await access({ ok: false, code: "paused" }); assert.deepEqual([a.canRead, a.canWrite], [true, false], "switched off: read-only");
  });
  await test("D5 (Team review, 2026-10-09) 3D refusals: a role without 3D, sharing paused, an unconfirmed check — never billed to the collaborator; a missing turn_film_payer bills the caller", async () => {
    const auth = (W) => mk(W).authorizeCredit({ token: "t", cost: 120, eventId: "e9", projectId: FILM, ownerId: OWNER });
    const noHold = (W) => assert.ok(!W.rpcs.some((x) => /^turn_hold_credits/.test(x[1])), "nothing held");
    let W = world({ ok: false, code: "role", role: "writer" }); let r = await auth(W);
    assert.deepEqual([r.code, r.message], ["film_role", "Your role on this film doesn't include this."]); noHold(W);
    for (const c of ["paused", "off"]) { W = world({ ok: false, code: c }); r = await auth(W); assert.equal(r.code, "team_paused", c); noHold(W); }
    W = world(null); W.rpc = (name) => (name === "turn_film_payer" ? { data: null, error: { message: "timeout" } } : { data: null, error: { message: "unexpected " + name } });
    r = await auth(W); assert.deepEqual([r.code, r.message], ["film_unverified", "Couldn't confirm who pays for work on this film. Try again in a moment."]); noHold(W);
    W = world("garbage"); r = await auth(W); assert.equal(r.code, "film_unverified");
    W = world(null); W.rpc = (name) => (name === "turn_film_payer" ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
      : name === "turn_credit_balance" ? { data: [{ plan: "none", remaining: 0 }], error: null } : { data: null, error: { message: "unexpected " + name } });
    r = await auth(W); assert.equal(r.code, "plan_required", "not installed: the caller's own account, as before");
    // a film hold refused by the database's re-check, in the same words
    for (const [code, want] of [["paused", "team_paused"], ["role", "film_role"], ["owner_plan", "owner_plan"], ["frozen", "owner_plan"], ["not_member", "film_access"], ["mismatch", "film_unverified"], ["insufficient", "owner_insufficient"]]) {
      W = world({ ok: true, payer: OWNER, member_id: MEMBER, role: "art_director" });
      const base = W.rpc; W.rpc = (name, args) => (name === "turn_hold_credits_for_film" ? { data: { ok: false, code }, error: null } : base(name, args));
      r = await auth(W); assert.equal(r.code, want, code); assert.doesNotMatch(r.message, /\d|@/);
    }
    // the service maps the new codes to plain statuses
    assert.match(read("supabase/functions/blender-bridge/studio-service.mjs"), /code === "film_role" \|\| code === "team_paused" \|\| code === "film_access" \? 403\s*: code === "billing_unavailable" \|\| code === "film_unverified" \? 503 : 402/);
  });
  await test("D8 (Stage editor review, 2026-10-09) one 3D job bigger than what's left of the budget says so; 'You've used…' only when it's used up", async () => {
    const auth = (W, cost = 120) => mk(W).authorizeCredit({ token: "t", cost, eventId: "e10", projectId: FILM, ownerId: OWNER });
    let W = world({ ok: true, payer: OWNER, member_id: MEMBER, role: "art_director" });
    let base = W.rpc; W.rpc = (name, args) => (name === "turn_hold_credits_for_film" ? { data: { ok: false, code: "budget_reached", budget: 100, spent: 40, needed: 120 }, error: null } : base(name, args));
    let r = await auth(W);
    assert.deepEqual([r.code, r.budget, r.spent, r.needed, r.message], ["budget_reached", 100, 40, 120,
      "This needs about 120 credits, and your budget on this film has 60 left this month. The film's owner can raise it."]);
    W = world({ ok: true, payer: OWNER, member_id: MEMBER, role: "art_director" });
    base = W.rpc; W.rpc = (name, args) => (name === "turn_hold_credits_for_film" ? { data: { ok: false, code: "budget_reached", budget: 100, spent: 0 }, error: null } : base(name, args));
    r = await auth(W, 150); assert.equal(r.needed, 150, "the amount asked when the database doesn't say"); assert.match(r.message, /^This needs about 150 credits, and your budget on this film has 100 left/);
    r = await auth(world({ ok: false, code: "budget_reached", budget: 200, spent: 200 }));
    assert.equal(r.message, "You've used this month's credit budget on this film (200 of 200). The film's owner can raise it.");
  });
  await test("D6 (Team review, 2026-10-09) sharing switched off under the older rule: collaborators read-only (an Art director no longer writes 3D)", async () => {
    const W = world({ ok: false, code: "off" });
    W.tables.turn_project_members = [{ member_user: ME, member_email: "me@example.com", role: "art_director", status: "active" }];
    let a = await mk(W).getProjectAccess(FILM, { id: ME, email: "me@example.com" });
    assert.deepEqual([a.canRead, a.canWrite], [true, false]);
    const W2 = world(null); W2.tables.turn_project_members = W.tables.turn_project_members;
    W2.rpc = (name) => ({ data: null, error: { message: "timeout" } });
    a = await mk(W2).getProjectAccess(FILM, { id: ME, email: "me@example.com" });
    assert.deepEqual([a.canRead, a.canWrite], [true, false], "an unconfirmed check: read-only");
    const W3 = world(null); W3.tables.turn_project_members = W.tables.turn_project_members;
    W3.rpc = (name) => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    a = await mk(W3).getProjectAccess(FILM, { id: ME, email: "me@example.com" });
    assert.deepEqual([a.canRead, a.canWrite], [true, true], "before team-relaunch.sql: the older rule, unchanged");
  });
  await test("D7 (Team review, 2026-10-09) a RELEASED owner-paid Studio hold is re-held for the OWNER through the budget — never on the launcher's account", async () => {
    const W = world({ ok: true, payer: OWNER, member_id: MEMBER });
    W.tables.turn_credit_holds = [{ owner: OWNER, actor: ME, member_id: MEMBER, project_id: FILM }];
    const settled = {};
    W.rpc = (name, args) => {
      if (name === "turn_settle_hold") return args.ref === "studio:e7" ? { data: { ok: false, code: "released", status: "released" }, error: null }
        : (settled[args.ref] = args.actual, { data: { ok: true, kept: args.actual, remaining: 4321, plan: "director" }, error: null });
      if (name === "turn_hold_credits_for_film") return { data: { ok: true, held: args.amount, remaining: 4321 }, error: null };
      return { data: null, error: { message: "unexpected " + name } };
    };
    const r = await mk(W).spendCredit({ uid: ME, cost: 12, eventId: "e7", holdRef: "studio:e7" });
    assert.deepEqual(r, { ok: true, remaining: null, plan: null }, "the owner's balance and plan never come back");
    assert.deepEqual(W.rpcs.find((x) => x[1] === "turn_hold_credits_for_film")[2],
      { p_owner: OWNER, p_actor: ME, p_member: MEMBER, p_project: FILM, amount: 12, ref: "studio:e7:rehold", reason: "blender-studio:rehold", p_kind: "3d" });
    assert.ok(!W.rpcs.some((x) => x[1] === "turn_hold_credits"), "never the launcher's own hold");
    assert.equal(settled["studio:e7:rehold"], 12);
    // the budget used up meanwhile: the budget's words, the task stays retryable
    W.rpc = (name, args) => name === "turn_settle_hold" ? { data: { ok: false, code: "released", status: "released" }, error: null }
      : name === "turn_hold_credits_for_film" ? { data: { ok: false, code: "budget_reached", budget: 200, spent: 200 }, error: null } : { data: null, error: { message: "x" } };
    const b = await mk(W).spendCredit({ uid: ME, cost: 12, eventId: "e8", holdRef: "studio:e8" });
    assert.equal(b.ok, false); assert.match(b.message, /200 of 200/);
    // the original hold unreadable: no guess — retryable
    const W2 = world(null); W2.rpc = (name) => (name === "turn_settle_hold" ? { data: { ok: false, code: "released", status: "released" }, error: null } : { data: null, error: { message: "x" } });
    const m2 = createSupabaseAdapter({ url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service",
      createClient: () => ({ rpc: async (n, a) => W2.rpc(n, a), from: () => { const c = { select: () => c, eq: () => c, limit: async () => ({ data: null, error: { message: "down" } }) }; return c; } }) });
    const u = await m2.spendCredit({ uid: ME, cost: 12, eventId: "e9", holdRef: "studio:e9" });
    assert.deepEqual([u.ok, u.message], [false, "Could not settle Studio credits."]);
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
  const samRow = await invite(U.pat, F2, U.sam, "stage_editor");
  // (Stage editor review, 2026-10-09) the hold's take column (team-relaunch.sql adds it; here too, so this
  // runs before and after that SQL lands)
  await db.exec("alter table public.turn_credit_holds add column if not exists take jsonb");

  const TABLE_FNS = new Set(["turn_credit_balance", "turn_record_usage_event", "turn_credit_regime", "turn_spend_credit", "turn_open_provider_holds", "turn_team_spend"]);
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
    let cols = "", upd = null;
    const c = { select: (s) => { cols = String(s || ""); return c; }, update: (v) => { upd = v; return c; }, eq: (col, val) => { f[col] = val; return c; }, gte: () => c, order: () => c,
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
      // who paid for a hold, and the member's role (service role; Team review, 2026-10-09)
      if (table === "turn_credit_holds" && who === "service") {
        // (Stage editor review, 2026-10-09) the take: written at submit, its url added at settle
        if (upd) {
          if (Object.keys(upd).join() !== "take") return { data: null, error: { message: "unexpected update " + j(upd) } };
          await db.query("update public.turn_credit_holds set take = $1::jsonb where ref = $2", [j(upd.take), f.ref]);
          return { data: null, error: null };
        }
        const want = cols === "take" ? "take" : "owner, actor, member_id, project_id";
        const rows = (await db.query(`select ${want} from public.turn_credit_holds where ref = $1`, [f.ref])).rows;
        return { data: single ? rows[0] || null : rows, error: null };
      }
      if (table === "turn_project_members" && who === "service") {
        const rows = (await db.query("select role, project_id from public.turn_project_members where id = $1", [f.id])).rows;
        return { data: single ? rows[0] || null : rows, error: null };
      }
      return { data: single ? null : [], error: null };
    };
    return c;
  };
  globalThis.__filmPayerCreateClient = (url, key, opts) => {
    if (key === ENV.SUPABASE_SERVICE_ROLE_KEY) return {
      auth: { admin: { getUserById: async (id) => {
        const r = (await db.query("select id, email from auth.users where id = $1", [id])).rows[0];
        return r ? { data: { user: { id: r.id, email: r.email } }, error: null } : { data: { user: null }, error: { message: "not found" } };
      } } },
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
  const sentKeys = [];   // the provider key each provider call carried
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = String(init.method || "GET").toUpperCase();
    const hd = init.headers || {}; sentKeys.push([u, String(hd.Authorization || hd["x-api-key"] || "")]);
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
      // (Team review, 2026-10-09) Cara is sent her budget on the film — never Dora's balance or plan
      assert.equal(r.json.usage.remaining, undefined, j(r.json.usage)); assert.equal(r.json.usage.plan, undefined);
      assert.deepEqual(r.json.usage.budget, { limit: 200, spent: Number(h.kept) }, "Director default budget; spent includes this call");
    });
    await test("C2 the same call without the film: Cara's own account (no plan) — refused", async () => {
      const r = await post("tok-cara", TEXT("claude-fable-5"));
      assert.equal(r.status, 402, j(r.json));
    });
    await test("C3 (Team review, 2026-10-09) a Co-writer's image on the film is REFUSED (film_role) — not billed to Cara, nothing taken from the owner", async () => {
      const dora0 = await bal(U.dora), cara0 = await bal(U.cara), holds0 = (await db.query("select count(*)::int n from public.turn_credit_holds")).rows[0].n;
      const r = await post("tok-cara", IMAGE("gemini-nano-banana-2.1", "2K", ctx()));
      assert.equal(r.status, 403, j(r.json)); assert.equal(r.json.code, "film_role"); assert.equal(r.json.message, "Your role on this film doesn't include this.");
      assert.equal(await bal(U.dora), dora0); assert.equal(await bal(U.cara), cara0);
      assert.equal((await db.query("select count(*)::int n from public.turn_credit_holds")).rows[0].n, holds0, "nothing held");
    });
    await test("C4 an Art director's 4K image: the owner's plan allows it, the owner pays", async () => {
      const dora0 = await bal(U.dora);
      const keys0 = sentKeys.length;
      // (Team review, 2026-10-09) Ari's own fal key is ignored: the owner's bill runs on the platform's key
      const r = await post("tok-ari", IMAGE("gemini-nano-banana-2.1", "4K", { ...ctx(), userApiKeys: { fal: "ari-own-fal-key" } }));
      assert.equal(r.status, 200, j(r.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor, h.member_id], [U.dora.id, U.ari.id, ariRow]); assert.ok(await bal(U.dora) < dora0);
      const used = sentKeys.slice(keys0).filter(([u]) => u.startsWith("https://queue.fal.run/"));
      assert.ok(used.length && used.every(([, k]) => k === "Key fal-key"), j(used));
      assert.equal(r.json.usage.remaining, undefined); assert.equal(r.json.usage.plan, undefined); assert.equal(r.json.usage.budget.limit, 200);
    });
    await test("C5 the owner's plan gates the call: video on a Director film is refused (the Stage is Producer's)", async () => {
      const r = await post("tok-ari", KLING(ctx()));
      assert.notEqual(r.status, 200);
      assert.equal(r.json.code, "film_role", "an Art director's role has no video (Team review, 2026-10-09: refused, not billed to Ari)");
    });
    await test("C6 a Stage editor's video on a Producer film: held on the owner at submit; the collaborator's poll settles it", async () => {
      const pat0 = await bal(U.pat);
      falNext = "IN_PROGRESS";
      const sub = await post("tok-sam", KLING(ctx(F2)));
      assert.equal(sub.status, 200, j(sub.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor, h.status], [U.pat.id, U.sam.id, "held"]); assert.equal(await bal(U.pat), pat0 - Number(h.held));
      fal[sub.json.requestId].status = "COMPLETED";
      // (Team review, 2026-10-09) the submit's usage: Sam's budget (Producer default 500), not Pat's balance
      assert.equal(sub.json.usage.remaining, undefined); assert.equal(sub.json.usage.plan, undefined);
      assert.deepEqual(sub.json.usage.budget, { limit: 500, spent: Number(h.held) });
      const keys0 = sentKeys.length;
      const p = await post("tok-sam", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl,
        userApiKeys: { fal: "sam-own-fal-key" } });
      assert.equal(p.json.status, "COMPLETED", j(p.json));
      const settledHold = await lastHold();
      assert.equal(settledHold.status, "settled");
      // the poll: who paid is recorded, Sam is sent his budget (never Pat's balance or plan), fal is asked on the platform key
      const usageRow = rpcs.filter((x) => x[1] === "turn_record_usage_event").at(-1)[2];
      assert.deepEqual([usageRow.usage_metadata.paidBy, usageRow.usage_metadata.memberId, usageRow.usage_metadata.filmRole], [U.pat.id, settledHold.member_id, "stage_editor"]);
      assert.equal(p.json.usage.remaining, undefined, j(p.json.usage)); assert.equal(p.json.usage.plan, undefined);
      assert.deepEqual(p.json.usage.budget, { limit: 500, spent: Number(settledHold.kept) });
      assert.ok(sentKeys.slice(keys0).filter(([u]) => u.startsWith("https://queue.fal.run/")).every(([, k]) => k === "Key fal-key"));
      const q = await post("tok-eve", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl });
      assert.equal(q.json.code, "render_not_found", "someone else can't collect it");
    });
    await test("C7 the budget stops a call: refused with the budget's words, nothing held", async () => {
      await as(U.dora, "update public.turn_project_members set budget_credits = 1 where id = $1", [ariRow]);
      const dora0 = await bal(U.dora);
      const r = await post("tok-ari", IMAGE("gemini-nano-banana-2.1", "2K", ctx()));
      assert.equal(r.status, 402); assert.equal(r.json.code, "budget_reached", j(r.json)); assert.equal(await bal(U.dora), dora0);
      await as(U.dora, "update public.turn_project_members set budget_credits = null where id = $1", [ariRow]);
    });
    await test("C8 the owner's payment failed: generating on the film pauses (owner_plan)", async () => {
      await db.query("update public.turn_credits set payment_status = 'past_due' where owner = $1", [U.dora.id]);
      const r = await post("tok-cara", TEXT("claude-opus-5-5", ctx()));
      assert.equal(r.status, 402); assert.equal(r.json.code, "owner_plan", j(r.json));
      await db.query("update public.turn_credits set payment_status = 'active' where owner = $1", [U.dora.id]);
    });
    await test("C9 (Stage editor review, 2026-10-09; owner decision E) Eve names Dora's film without being on it: refused (film_access), nobody charged; a film id that names no film bills Eve", async () => {
      const dora0 = await bal(U.dora), eve0 = await bal(U.eve);
      let r = await post("tok-eve", TEXT("claude-opus-5-5", ctx()));
      assert.equal(r.status, 403, j(r.json)); assert.equal(r.json.code, "film_access");
      assert.equal(r.json.message, "You're not on this film's team right now, so work on it can't be charged to it.");
      assert.equal(await bal(U.dora), dora0); assert.equal(await bal(U.eve), eve0);
      r = await post("tok-eve", TEXT("claude-opus-5-5", ctx("f1000000-0000-4000-8000-0000000000ff")));
      assert.equal(r.status, 200, j(r.json)); assert.equal(await bal(U.dora), dora0); assert.ok(await bal(U.eve) < eve0, "no such film: Eve's own spend");
    });
    await test("C10 (Team review, 2026-10-09; owner decision B) switched off: collaborators are read-only — refused (team_paused), nobody charged", async () => {
      await db.query("update public.turn_app_config set value = '{\"on\": false}' where key = 'team_sharing'");
      const dora0 = await bal(U.dora), cara0 = await bal(U.cara);
      const r = await post("tok-cara", TEXT("claude-fable-5", ctx()));
      assert.equal(r.status, 403, j(r.json)); assert.equal(r.json.code, "team_paused");
      assert.equal(r.json.message, "Sharing is paused on this film right now, so it's read-only for collaborators.");
      assert.equal(await bal(U.dora), dora0); assert.equal(await bal(U.cara), cara0);
      await db.query("update public.turn_app_config set value = '{\"on\": true}' where key = 'team_sharing'");
    });
    await test("C11 (Team review, 2026-10-09) routing fields must be strings: task ['text'] is a 400 before anything is held or sent", async () => {
      const dora0 = await bal(U.dora), holds0 = (await db.query("select count(*)::int n from public.turn_credit_holds")).rows[0].n, fetch0 = sentKeys.length;
      for (const bad of [{ task: ["text"] }, { op: ["submit"], task: "video" }, { usageKind: ["writing"] }, { provider: ["fal"] }, { model: ["gemini-nano-banana-2.1"] }])
        assert.equal((await post("tok-cara", { ...TEXT("claude-fable-5", ctx()), ...bad })).status, 400, j(bad));
      assert.equal((await post("tok-cara", [1, 2])).status, 400, "a body that isn't an object");
      assert.equal(await bal(U.dora), dora0); assert.equal(sentKeys.length, fetch0, "no provider called");
      assert.equal((await db.query("select count(*)::int n from public.turn_credit_holds")).rows[0].n, holds0);
    });
    await test("C12 (Team review, 2026-10-09) a film the ADMIN owns: gated as the admin's (no 503, no plan gate), held on the admin's balance", async () => {
      const ADM = { id: "30000000-0000-4000-8000-000000000099", email: "admin@infinitestudioai.com" };
      await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1,$2,now() - interval '1 day')", [ADM.id, ADM.email]);
      tokens["tok-adm"] = ADM;
      const F3 = "f1000000-0000-4000-8000-000000000003";
      await db.query("insert into public.turn_projects(id, owner, title, doc) values ($1,$2,'Admin film','{}'::jsonb)", [F3, ADM.id]);
      await invite(ADM, F3, U.eve, "art_director");
      // no credits row at all: the owner's balance can't cover it — never "billing unavailable" or a plan gate
      let r = await post("tok-eve", IMAGE("gemini-nano-banana-2.1", "4K", ctx(F3)));
      assert.equal(r.json.code, "owner_insufficient", j(r.json)); assert.doesNotMatch(j(r.json), /@|\d{2,}/);
      // a Writer-plan row (4K is Director's): the admin's gates let it run; the hold is the admin's
      await svc("select public.turn_set_plan_once('e-adm', $1, 'writer', 800, 'sub_a', 'cus_a', $2)", [ADM.id, future]);
      const adm0 = await bal(ADM), eve0 = await bal(U.eve);
      r = await post("tok-eve", IMAGE("gemini-nano-banana-2.1", "4K", ctx(F3)));
      assert.equal(r.status, 200, j(r.json));
      const h = await lastHold();
      assert.deepEqual([h.owner, h.actor], [ADM.id, U.eve.id]); assert.ok(await bal(ADM) < adm0); assert.equal(await bal(U.eve), eve0);
      assert.equal(r.json.usage.remaining, undefined);
    });

    const holdOf = async (requestId) => (await db.query("select ref, owner, actor, member_id, held, kept, status, take from public.turn_credit_holds where provider_ref = $1", [requestId])).rows[0];
    const spentOf = async (memberId) => Number((await db.query("select public.turn__member_spent($1) as n", [memberId])).rows[0].n);
    await test("C13 (Stage editor review, 2026-10-09) one render bigger than what's left of a Stage editor's budget: told what it needs and what's left — never 'You've used… (0 of 500)'", async () => {
      const spent = await spentOf(samRow);
      await as(U.pat, "update public.turn_project_members set budget_credits = $2 where id = $1", [samRow, spent + 5]);
      const pat0 = await bal(U.pat);
      const r = await post("tok-sam", KLING(ctx(F2)));
      assert.equal(r.status, 402, j(r.json)); assert.equal(r.json.code, "budget_reached");
      assert.deepEqual([r.json.budget, r.json.spent], [spent + 5, spent]); assert.ok(r.json.needed > 5, j(r.json));
      assert.equal(r.json.message, `This needs about ${r.json.needed.toLocaleString("en-US")} credits, and your budget on this film has 5 left this month. The film's owner can raise it.`);
      assert.equal(await bal(U.pat), pat0, "nothing held");
      await as(U.pat, "update public.turn_project_members set budget_credits = null where id = $1", [samRow]);
    });
    await test("C14 (Stage editor review, 2026-10-09; owner decision D) the take is written on the owner's hold at submit; a person removed meanwhile still collects the render, the owner pays, the url lands on the take", async () => {
      falNext = "IN_PROGRESS";
      const meta = { kind: "video", label: "Take 2", line: { scene: 4, n: 2 } };
      const sub = await post("tok-sam", KLING({ context: { projectId: F2, clipId: "clip-s4-l2", take: meta } }));
      assert.equal(sub.status, 200, j(sub.json));
      let h = await holdOf(sub.json.requestId);
      assert.deepEqual([h.owner, h.actor, h.status], [U.pat.id, U.sam.id, "held"]);
      assert.deepEqual(h.take, { clipId: "clip-s4-l2", meta });
      // malformed: a clipId that isn't "clip-…" writes no take; a take over 4,000 characters keeps only the clipId
      const bad = await post("tok-sam", KLING({ context: { projectId: F2, clipId: "s4 l2", take: meta } }));
      assert.equal(bad.status, 200, j(bad.json)); assert.equal((await holdOf(bad.json.requestId)).take, null);
      const big = await post("tok-sam", KLING({ context: { projectId: F2, clipId: "clip-big", take: { notes: "x".repeat(4100) } } }));
      assert.deepEqual((await holdOf(big.json.requestId)).take, { clipId: "clip-big" });
      // Pat's own render on Pat's own film: no take (only owner-paid renders carry one)
      const own = await post("tok-pat", KLING({ context: { projectId: F2, clipId: "clip-own" } }));
      assert.equal(own.status, 200, j(own.json)); assert.equal((await holdOf(own.json.requestId)).take, null);
      // Pat removes Sam while the render runs; it finishes; Sam's poll still collects it, billed to Pat
      const pat0 = await bal(U.pat), sam0 = await bal(U.sam);
      const rm = await as(U.pat, "update public.turn_project_members set status = 'removed' where id = $1", [samRow]);
      assert.ok(rm.ok, j(rm));
      fal[sub.json.requestId].status = "COMPLETED";
      const p = await post("tok-sam", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl });
      assert.equal(p.json.status, "COMPLETED", j(p.json)); assert.equal(p.json.videoUrl, "https://v3.fal.media/files/v.mp4");
      h = await holdOf(sub.json.requestId);
      assert.equal(h.status, "settled"); assert.equal(await bal(U.pat), pat0, "the hold was already taken from Pat"); assert.equal(await bal(U.sam), sam0);
      assert.equal(h.take.clipId, "clip-s4-l2"); assert.deepEqual(h.take.meta, meta); assert.equal(h.take.url, "https://v3.fal.media/files/v.mp4");
      assert.ok(Math.abs(Date.parse(h.take.settledAt) - Date.now()) < 60000, h.take.settledAt);
      assert.equal(p.json.usage.remaining, undefined); assert.equal(p.json.usage.plan, undefined); assert.equal(p.json.usage.budget, undefined, "removed: no budget row, nothing of Pat's");
      // a second poll: the same video, no second charge, the take unchanged
      const again = await post("tok-sam", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl });
      assert.equal(again.json.status, "COMPLETED"); assert.deepEqual((await holdOf(sub.json.requestId)).take, h.take);
      // and Sam can no longer start anything on the film
      const after = await post("tok-sam", KLING(ctx(F2)));
      assert.equal(after.status, 403, j(after.json)); assert.equal(after.json.code, "film_access");
      // THE RECONCILIATION settles a render nobody polled and records its url too (the "bad" job had no take: left alone)
      fal[big.json.requestId].status = "COMPLETED"; fal[bad.json.requestId].status = "COMPLETED";
      await db.query("update public.turn_credit_holds set created_at = created_at - interval '2 hours' where provider_ref = any($1)", [[big.json.requestId, bad.json.requestId]]);
      const rec = await handler(new Request("https://example.supabase.co/functions/v1/image-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: j({ op: "reconcile_holds" }) }));
      const rb = await rec.json();
      assert.equal(rec.status, 200, j(rb)); assert.ok(rb.settled >= 2, j(rb));
      const hb = await holdOf(big.json.requestId);
      assert.equal(hb.status, "settled"); assert.equal(hb.take.clipId, "clip-big"); assert.equal(hb.take.url, "https://v3.fal.media/files/v.mp4"); assert.ok(hb.take.settledAt);
      assert.equal((await holdOf(bad.json.requestId)).take, null);
    });
  } finally { globalThis.fetch = realFetch; console.warn = realWarn; }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* Build the set for paying plans (owner 2026-11-05: Director and Producer; 15 credits a build, held when queued,
   charged when the four views arrive, given back on failure / cancel; the owner or an Art director on a shared film,
   the owner paying within the budget; one renderer with a queue cap). The real blender-render core.mjs with
   in-memory identities, queue and billing; the app's switch, price, card and Frances's notes from source.
     A  open mode: who may build / read (owner, Art director, other roles, non-members); capabilities say the price
     B  job.create: the hold (15 credits at today's unit, 5 at the old one, "setbuild:" prefix, the film's owner),
        refusals in plain words with nothing queued, the queue cap before any hold, a hold given back when queueing
        fails (never when the job exists after all), a retried click holds nothing new
     C  pilot mode unchanged: allowlist only, no charge
     D  the adapter: the prefix option, Blender Studio's own holds unchanged; the reconcilers list only their prefix
     E  the app: the switch (supabase-config.js setBuild), app price = server price, the card's chip / role note /
        queue line, Frances's notes, cache keys
   node scripts/test-set-build-release.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import { createRenderService, SET_BUILD_USD, SET_BUILD_QUEUE_CAP } from "../supabase/functions/blender-render/core.mjs";
import "../app/blender-render-contract.js";
import "../app/blender-contract.js";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const contract = globalThis.KinolotRenderContract;
let checks = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); checks++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n   ", String(e && e.stack || e).split("\n").slice(0, 5).join("\n    ")); } };

const OWNER = "11111111-1111-4111-8111-111111111111", ART = "22222222-2222-4222-8222-222222222222",
  WRITER = "33333333-3333-4333-8333-333333333333", STRANGER = "44444444-4444-4444-8444-444444444444";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const SECRET = "offline-only-worker-secret-with-at-least-thirty-two-characters";
const scene = () => ({ schema: contract.SCHEMA, name: "Car deck", units: "metres", notes: [], materials: { grey: { baseColor: [.45, .48, .5] } }, previewLights: [],
  objects: [{ id: "box", name: "Box", kind: "box", material: "grey", position: [0, 0, .5], size: [1, 1, 1], rotation: [0, 0, 0] }],
  cameras: Object.fromEntries(contract.PANELS.map((p, i) => [p, { position: [0, -4, 1.6], yaw: i * 90, pitch: -5, lensMm: 24 }])) });

function world({ open = true, unit = 0.01, held = null, active = 0, submitError = null, madeAfterError = false } = {}) {
  const jobs = [], calls = { holds: [], releases: [], submits: [] };
  const sessions = { "owner-session": OWNER, "art-session": ART, "writer-session": WRITER, "stranger-session": STRANGER };
  const auth = {
    async getUserByAccessToken(t) { return sessions[t] ? { id: sessions[t] } : null; },
    async getUserById(id) { return { id }; },
    async hasLocation(p, l) { return p === PROJECT && l === "deck"; },
    async getProjectAccess(p, user) {
      if (p !== PROJECT) return { exists: false };
      if (user.id === OWNER) return { exists: true, ownerId: OWNER, canRead: true, canWrite: true };
      if (user.id === ART) return { exists: true, ownerId: OWNER, canRead: true, canWrite: true };       // turn_film_payer '3d' ok
      if (user.id === WRITER) return { exists: true, ownerId: OWNER, canRead: true, canWrite: false };   // a Co-writer: reads
      return { exists: true, ownerId: OWNER, canRead: false, canWrite: false };
    },
  };
  const db = {
    async submit(a) {
      calls.submits.push(a);
      if (submitError) { if (madeAfterError) jobs.push(row(a)); throw Object.assign(new Error(submitError), {}); }
      const known = jobs.find((j) => j.actor_id === a.actor && j.request_id === a.request);
      if (known) return known;
      const j = row(a); jobs.push(j); return j;
    },
    async byRequest(actor, request) { return jobs.find((j) => j.actor_id === actor && j.request_id === request) || null; },
    async activeCount() { return active + jobs.filter((j) => ["queued", "running"].includes(j.status)).length; },
    async ahead() { return 2; },
    async latest(p, l) { return jobs.filter((j) => j.project_id === p && j.location_id === l).slice(-1)[0] || null; },
    async get(id) { return jobs.find((j) => j.id === id) || null; },
    async cancel(id) { const j = jobs.find((x) => x.id === id); j.status = "cancelled"; return j; },
  };
  const row = (a) => ({ id: "66666666-6666-4666-8666-" + String(jobs.length + 1).padStart(12, "0"), project_id: a.project, owner_id: a.owner,
    actor_id: a.actor, location_id: a.location, request_id: a.request, scene: a.scene, scene_hash: a.hash, status: "queued", progress: "queued",
    attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), hold_ref: a.hold, credits: a.hold ? 15 : null });
  const billing = {
    async creditUnit() { return unit; },
    async authorizeCredit(args) { calls.holds.push(args); return held ? held(args) : { ok: true, holdRef: args.refPrefix + args.eventId }; },
    async releaseCredit(args) { calls.releases.push(args); return { ok: true }; },
  };
  const service = createRenderService({ auth, db, storage: { sign: async (p) => "https://storage.example.test/" + p }, contract, png: globalThis.BlenderContract,
    enabled: true, allowedUsers: open ? [] : [OWNER], workerSecret: SECRET, open, billing: open ? billing : null });
  const call = async (action, body, token = "owner-session") => {
    const r = await service.handle(new Request("https://offline.example.test/render", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action }) }));
    return { status: r.status, body: await r.json() };
  };
  const create = (token = "owner-session", extra = {}) => call("job.create", { projectId: PROJECT, locationId: "deck", requestId: extra.requestId || crypto.randomUUID(), scene: scene() }, token);
  return { jobs, calls, call, create };
}

await test("A capabilities: the price (15 credits at today's unit) and who may build — owner and Art director yes, a Co-writer reads", async () => {
  const w = world();
  const own = await w.call("capabilities", { projectId: PROJECT });
  assert.equal(own.status, 200); assert.equal(own.body.open, true); assert.equal(own.body.ownerPilot, false);
  assert.equal(own.body.credits, 15); assert.equal(own.body.canBuild, true); assert.equal(own.body.queueCap, SET_BUILD_QUEUE_CAP);
  assert.equal((await w.call("capabilities", { projectId: PROJECT }, "art-session")).body.canBuild, true);
  const reader = await w.call("capabilities", { projectId: PROJECT }, "writer-session");
  assert.equal(reader.status, 200); assert.equal(reader.body.canBuild, false);
  assert.equal((await w.call("job.latest", { projectId: PROJECT, locationId: "deck" }, "writer-session")).status, 200, "a Co-writer sees what was built");
  const stranger = await w.call("capabilities", { projectId: PROJECT }, "stranger-session");
  assert.equal(stranger.status, 403);
  assert.equal(SET_BUILD_USD, 0.15); assert.equal(SET_BUILD_QUEUE_CAP, 12);
});

await test("B the owner's build holds 15 credits ('setbuild:' prefix, reason set-build) before queueing; the job carries its hold", async () => {
  const w = world();
  const rid = crypto.randomUUID();
  const r = await w.create("owner-session", { requestId: rid });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const h = w.calls.holds[0];
  assert.equal(h.cost, 15); assert.equal(h.refPrefix, "setbuild:"); assert.equal(h.reason, "set-build");
  assert.equal(h.projectId, PROJECT); assert.equal(h.ownerId, OWNER); assert.equal(h.token, "owner-session");
  assert.match(h.eventId, new RegExp("^" + rid + ":[a-f0-9]{16}$"));
  assert.equal(w.calls.submits[0].hold, "setbuild:" + h.eventId);
  assert.equal(r.body.job.credits, 15); assert.equal(r.body.job.queueAhead, 2, "a waiting build says how many are ahead");
  assert.equal(w.calls.releases.length, 0);
});

await test("B an Art director builds on the shared film: the hold names the film and its owner (the owner pays within the budget)", async () => {
  const w = world();
  const r = await w.create("art-session");
  assert.equal(r.status, 200);
  assert.equal(w.calls.holds[0].ownerId, OWNER); assert.equal(w.calls.holds[0].projectId, PROJECT);
  assert.equal(w.calls.submits[0].actor, ART); assert.equal(w.calls.submits[0].owner, OWNER);
});

await test("B a Co-writer or a stranger can't start a build — no hold, nothing queued", async () => {
  const w = world();
  const co = await w.create("writer-session");
  assert.equal(co.status, 403); assert.match(co.body.error, /role on this film doesn't include building the set/);
  assert.equal((await w.create("stranger-session")).status, 403);
  assert.equal(w.calls.holds.length, 0); assert.equal(w.jobs.length, 0);
});

await test("B refusals in plain words, nothing queued: the plan, credits, a team budget, billing unavailable, no hold ref", async () => {
  const cases = [
    [{ ok: false, code: "tier_required" }, 403, /needs the Director or Producer plan/],
    [{ ok: false, code: "plan_required" }, 403, /needs the Director or Producer plan/],
    [{ ok: false, code: "insufficient_credits" }, 402, /needs 15 credits, and this account doesn't have enough/],
    [{ ok: false, code: "budget_reached", message: "You've used this month's credit budget on this film (200 of 200)." }, 402, /budget on this film/],
    [{ ok: false, code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." }, 503, /can't be checked/],
    [{ ok: true }, 503, /can't be checked/],
  ];
  for (const [answer, status, words] of cases) {
    const w = world({ held: () => answer });
    const r = await w.create();
    assert.equal(r.status, status, JSON.stringify(answer)); assert.match(r.body.error, words);
    assert.equal(w.calls.submits.length, 0, "nothing queued"); assert.equal(w.calls.releases.length, 0);
  }
});

await test("B the price follows the live unit (5 credits at the old $0.03); an unreadable unit refuses before any hold", async () => {
  const old = world({ unit: 0.03 });
  await old.create(); assert.equal(old.calls.holds[0].cost, 5);
  const none = world({ unit: null });
  const r = await none.create(); assert.equal(r.status, 503); assert.equal(none.calls.holds.length, 0);
});

await test("B a full queue refuses before any hold ('nothing was charged')", async () => {
  const w = world({ active: SET_BUILD_QUEUE_CAP });
  const r = await w.create();
  assert.equal(r.status, 429); assert.equal(r.body.code, "queue_busy"); assert.match(r.body.error, /nothing was charged/);
  assert.equal(w.calls.holds.length, 0);
});

await test("B queueing fails after the hold → the hold is given back; unless the job exists after all", async () => {
  const w = world({ submitError: "Render database unavailable" });
  assert.equal((await w.create()).status, 503);
  assert.equal(w.calls.releases.length, 1); assert.equal(w.calls.releases[0].holdRef, "setbuild:" + w.calls.holds[0].eventId);
  const made = world({ submitError: "Render database unavailable", madeAfterError: true });
  await made.create();
  assert.equal(made.calls.releases.length, 0, "a job that holds it keeps it");
});

await test("B a retried click (the same request) answers as itself and holds nothing new; a cancel is allowed to the builder", async () => {
  const w = world();
  const rid = crypto.randomUUID();
  const first = await w.create("owner-session", { requestId: rid });
  const again = await w.create("owner-session", { requestId: rid });
  assert.equal(again.status, 200); assert.equal(again.body.job.id, first.body.job.id); assert.equal(w.calls.holds.length, 1);
  const cancel = await w.call("job.cancel", { projectId: PROJECT, jobId: first.body.job.id });
  assert.equal(cancel.status, 200); assert.equal(cancel.body.job.status, "cancelled");
  assert.equal((await w.call("job.cancel", { projectId: PROJECT, jobId: first.body.job.id }, "writer-session")).status, 403, "a Co-writer can't cancel");
});

await test("C pilot mode is unchanged: allowlisted owner only, no hold, no price", async () => {
  const w = world({ open: false });
  const cap = await w.call("capabilities", { projectId: PROJECT });
  assert.equal(cap.body.ownerPilot, true); assert.equal(cap.body.credits, 0);
  assert.equal((await w.create()).status, 200); assert.equal(w.calls.submits[0].hold, null);
  assert.equal((await w.create("art-session")).status, 403, "not allowlisted");
  assert.equal((await w.call("capabilities", { projectId: PROJECT }, "art-session")).status, 403);
});

await test("C open mode without billing wired fails closed (503)", async () => {
  const { createRenderService: make } = await import("../supabase/functions/blender-render/core.mjs");
  const s = make({ auth: {}, db: {}, storage: {}, contract, png: globalThis.BlenderContract, enabled: true, workerSecret: SECRET, open: true, billing: null });
  const r = await s.handle(new Request("https://x.test/", { method: "POST", headers: { Authorization: "Bearer owner-session" }, body: "{}" }));
  assert.equal(r.status, 503);
});

await test("D the adapter: a prefix of its own; Blender Studio's holds stay 'studio:'; the reconcilers list only their prefix", () => {
  const a = read("supabase/functions/blender-bridge/supabase-adapter.mjs");
  assert.ok(a.includes('async function authorizeCredit({ token, cost, eventId, projectId = null, ownerId = null, refPrefix = "studio:", reason = "blender-studio" }) {'));
  assert.equal((a.match(/const ref = `\$\{refPrefix\}\$\{eventId\}`;/g) || []).length, 2);
  assert.ok(!a.includes("const ref = `studio:${eventId}`;"), "no fixed prefix left in authorizeCredit");
  assert.ok(read("supabase/functions/blender-bridge/studio-reconcile.mjs").includes('r.ref.startsWith("studio:")'));
  assert.ok(read("supabase/functions/image-proxy/video-reconcile.mjs").includes('r.ref.startsWith("video:")'));
  const idx = read("supabase/functions/blender-render/index.ts");
  assert.ok(idx.includes('open:env("BLENDER_RENDER_OPEN")==="true",') && idx.includes("billing:bridge,"));
  const ad = read("supabase/functions/blender-render/adapter.mjs");
  assert.ok(ad.includes("...(a.hold?{p_hold:a.hold}:{})"), "the pilot keeps the 7-argument submit");
  assert.ok(ad.includes('created_at.lt."${row.created_at}"'), "a quoted timestamp in the queue-position filter");
});

await test("E the app: the switch, the price (app = server), the card's chip, role note and queue line, Frances's notes, cache keys", () => {
  const cfg = read("app/supabase-config.js");
  assert.ok(/\n  setBuild: true,\n/.test(cfg));
  const js = read("app/blender-render.js");
  assert.ok(js.includes("function enabled(){return (root.TURN_SUPABASE||{}).setBuild===true||local()&&root.turnIsAdmin===true;}"));
  const b = { console, Math, Number, JSON, Object, Array, String, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, dispatchEvent() {} };
  b.window = b; vm.createContext(b);
  vm.runInContext(transformSync(read("app/pricing.jsx"), { presets: [["@babel/preset-react", { runtime: "classic" }]], babelrc: false, configFile: false }).code, b);
  assert.equal(b.turnSetBuildCredits(), Math.ceil(SET_BUILD_USD / 0.01 - 1e-9), "the app quotes what the server holds");
  assert.equal(b.turnSetBuildCredits(), 15);
  const ui = read("app/blender-render-ui.jsx");
  assert.ok(ui.includes('"data-testid":"set-build-cost"'), "the price chip on Build set");
  assert.ok(ui.includes("The film's owner or its Art director builds the set; you can see what they built."));
  assert.ok(ui.includes('" set"+(ahead===1?" is":"s are")+" ahead of yours, about "'));
  assert.ok(ui.includes('" Its credits were given back."'));
  assert.ok(ui.includes('E("p",{className:"loc-layer-note"},paid\n      ?"The same set as Previs, from the same floor plan and cameras, built and rendered by Blender in the cloud:'), "paid words when open");
  assert.ok(ui.includes(':"The same set as Previs, from the same floor plan and cameras, built and rendered by Blender in the cloud. Free during the pilot; separate from the location image."'), "the pilot's words only without it");
  const ai = read("app/ai.jsx");
  // 2026-11-15 (owner: one road, "remove Blender"): the card no longer offers the build, and Frances says so. The
  // component above is kept in the file, unmounted; the server side this test covers is unchanged.
  assert.ok(ai.includes('APP_FEATURES.push({ name:"Location floor plan, cameras and 3D set (Locations)"'));
  assert.ok(ai.includes("a location card no longer has the steps Build the set and Style it")&&!ai.includes("one build costs 15 credits"));
  const card = read("app/locations-ui.jsx");
  assert.ok(!card.includes("LocationCloudRender")&&!card.includes("LocationStyleStep"), "the card mounts neither the cloud build nor its styling step");
  const html = read("TURN.html");
  for (const f of ["supabase-config.js", "pricing.jsx", "blender-render.js", "blender-render-ui.jsx", "ai.jsx", "script.jsx"])
    assert.ok(["20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1"].some((k) => html.includes('src="app/' + f + "?v=" + k + '"')), f);
});

console.log(`\n${checks} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);

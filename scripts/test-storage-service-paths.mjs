/* test-storage-service-paths.mjs — the Edge Functions' readable storage folders
   (owner decision 2026-09-27), offline: no network, no Supabase, no Deno, no Blender.
   image-proxy (supabase/functions/image-proxy/stage-paths.mjs + index.ts wiring):
     - `stage:` refs are accepted in both folder forms for the CALLER only: exactly three
       segments, folder 2 exactly "stage-tmp", folder 1 naming the caller's id, a plain
       file name; another uid, another folder 2, extra segments, `..` are refused;
     - the account folder comes from turn_storage_folders_for and falls back to the bare
       uid on every failure (missing, revoked, error, timeout, mismatch);
     - the sweep lists both folders and counts live device slots across both.
   blender-bridge (storage-paths.mjs, supabase-adapter.mjs, relay-core.mjs, studio-service.mjs):
     - the relay shot PNG is written under readable folders when the adapter supplies
       valid ones, legacy otherwise (adapters without storageFolders, bad answers);
     - a stored legacy job.pngPath still downloads; isRelayPngPath refuses the wrong
       owner, project or job; a replaced job's PNG (either form) is removed;
     - a Studio preview publishes under readable folders, and a stored legacy preview
       path still reads.
   Run: node scripts/test-storage-service-paths.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../app/blender-studio-contract.js";
import {
  accountFolderFromRpc, isCallerStagePath, planStageSweep, resolveAccountFolder, stageDirs, stagedRefPath, stagePath,
} from "../supabase/functions/image-proxy/stage-paths.mjs";
import {
  isRelayPngPath, legacyRelayPngPath, relayPngPathFor, relayPngTarget, resolveStorageFolders, studioPreviewPath, validStorageFolders,
} from "../supabase/functions/blender-bridge/storage-paths.mjs";
import { createBlenderRelay } from "../supabase/functions/blender-bridge/relay-core.mjs";
import { createSupabaseAdapter } from "../supabase/functions/blender-bridge/supabase-adapter.mjs";
import { createStudioService } from "../supabase/functions/blender-bridge/studio-service.mjs";

let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log("PASS", name); };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const U = "aaaa1111-1111-4111-8111-1111111111ff";
const P = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ACCT = "alex-smith--" + U, PROJ = "pine-soot--" + P;

/* ── image-proxy staging ─────────────────────────────────────────────────── */
await test("stage refs: legacy and readable folders of the caller are accepted", () => {
  for (const p of [`${U}/stage-tmp/1759000000000-video-device-0a1b2c.mp4`, `${ACCT}/stage-tmp/1759000000000-image-1-0a1b2c.png`,
    `u-deadbee-01--${U}/stage-tmp/1759000000000-audio-device-x_y.z.wav`]) {
    assert.equal(isCallerStagePath(p, U), true, p);
    assert.equal(stagedRefPath("stage:" + p, U), p);
    assert.equal(stagedRefPath("STAGE:" + p, U), p, "the scheme is case-insensitive, as before");
  }
});
await test("stage refs: another uid, another folder 2, extra segments, traversal and junk are refused", () => {
  const bad = [
    `${OTHER}/stage-tmp/1759000000000-video-device-a.mp4`, `alex-smith--${OTHER}/stage-tmp/1759000000000-video-a.mp4`,
    `${U}/${P}/1759000000000-video-a.mp4`, `${U}/studio-previews/1759000000000-video-a.mp4`, `${U}/stage-tmp-x/a.mp4`,
    `${U}/stage-tmp/sub/1759000000000-video-a.mp4`, `${U}/stage-tmp`, `${U}/stage-tmp/`, `${U}/stage-tmp/..`,
    `${U}/stage-tmp/../x.mp4`, `${U}/stage-tmp/a b.mp4`, `${U}/stage-tmp/a%2Fb.mp4`, `${U.toUpperCase()}/stage-tmp/a.mp4`,
    `Alex--${U}/stage-tmp/a.mp4`, `deadbeef--${U}/stage-tmp/a.mp4`, `a--b--${U}/stage-tmp/a.mp4`, `/${U}/stage-tmp/a.mp4`,
    `u-deadbeef-01--${U}/stage-tmp/a.mp4`, `${OTHER.replace("-", "a-")}--${U}/stage-tmp/a.mp4`, `${OTHER.replace(/-/g, "")}--${U}/stage-tmp/a.mp4`,
    `stage-tmp/a.mp4`, "",
  ];
  for (const p of bad) {
    assert.equal(isCallerStagePath(p, U), false, p);
    if (p) assert.throws(() => stagedRefPath("stage:" + p, U), /outside your upload namespace/, p);
    else assert.equal(stagedRefPath("stage:", U), null, "an empty stage: ref is not a reference (as before)");
  }
  assert.equal(stagedRefPath("https://signed.example/x.mp4", U), null, "not a stage ref");
  assert.equal(stagedRefPath("data:video/mp4;base64,AAAA", U), null);
  assert.equal(isCallerStagePath(`${U}/stage-tmp/a.mp4`, ""), false);
  assert.equal(isCallerStagePath(`${U}/stage-tmp/a.mp4`, null), false);
});
await test("account folder: the RPC's readable folder, else the bare uid (missing, revoked, error, timeout, mismatch)", async () => {
  assert.equal(accountFolderFromRpc({ data: { v: 1, account: ACCT, project: null }, error: null }, U), ACCT);
  for (const r of [null, undefined, { data: null, error: { code: "PGRST202" } }, { data: null, error: { code: "42501" } },
    { data: { v: 1, account: "alex-smith--" + OTHER } }, { data: { v: 1, account: U } }, { data: { v: 2, account: ACCT } },
    { data: { v: 1, account: "Alex--" + U } }, { data: { v: 1, account: null } }, { data: "x" }])
    assert.equal(accountFolderFromRpc(r, U), U, JSON.stringify(r));
  const calls = [];
  assert.equal(await resolveAccountFolder(() => { calls.push(1); return { data: { v: 1, account: ACCT } }; }, U), ACCT);
  assert.equal(await resolveAccountFolder(async () => { throw new Error("fetch failed"); }, U), U);
  assert.equal(await resolveAccountFolder(() => { throw new Error("sync throw"); }, U), U);
  assert.equal(await resolveAccountFolder(() => new Promise(() => {}), U, 20), U, "a hung RPC times out to the bare uid");
  assert.equal(calls.length, 1);
  assert.equal(stagePath(ACCT, "1759000000000-image-1-ab.png"), `${ACCT}/stage-tmp/1759000000000-image-1-ab.png`);
  assert.equal(isCallerStagePath(stagePath(ACCT, "1759000000000-image-1-ab.png"), U), true, "a minted key is a valid ref");
  assert.equal(isCallerStagePath(stagePath(U, "1759000000000-image-1-ab.png"), U), true);
});
await test("sweep: both folders are listed, expired files removed from both, live device slots counted across both", () => {
  assert.deepEqual(stageDirs(U, U), [`${U}/stage-tmp`]);
  assert.deepEqual(stageDirs(U, ACCT), [`${U}/stage-tmp`, `${ACCT}/stage-tmp`]);
  assert.deepEqual(stageDirs(U, "alex-smith--" + OTHER), [`${U}/stage-tmp`], "never another account's folder");
  assert.deepEqual(stageDirs(U, null), [`${U}/stage-tmp`]);
  const now = 1759000000000, ttl = 7200 * 1000, old = now - ttl - 1, fresh = now - 1000;
  const plan = planStageSweep([
    { dir: `${U}/stage-tmp`, rows: [{ name: `${old}-video-device-a.mp4` }, { name: `${fresh}-video-device-b.mp4` }, { name: `${old}-image-1-c.png` }, { name: "folder/" }, null] },
    { dir: `${ACCT}/stage-tmp`, rows: [{ name: `${fresh}-image-device-d.png` }, { name: `${old}-audio-device-e.wav` }, { name: "no-stamp-device-f.png" }] },
  ], now, ttl);
  assert.deepEqual(plan.expired, [`${U}/stage-tmp/${old}-video-device-a.mp4`, `${U}/stage-tmp/${old}-image-1-c.png`, `${ACCT}/stage-tmp/${old}-audio-device-e.wav`]);
  assert.equal(plan.live, 3, "b, d and the unstamped device slot (as before: only a valid old stamp expires)");
});
await test("image-proxy wiring: staging keys, refs and the sweep go through stage-paths.mjs", () => {
  const src = read("supabase/functions/image-proxy/index.ts");
  assert.match(src, /from "\.\/stage-paths\.mjs"/);
  assert.match(src, /const stagedRefPath = \(s: string\): string \| null => parseStagedRef\(s, authUser\.id\);/);
  assert.match(src, /\.rpc\("turn_storage_folders_for", \{ p_user: authUser\.id, p_project_id: null \}\)/, "argument names match the SQL");
  assert.equal((src.match(/stagePath\(await accountFolder\(\), /g) || []).length, 1, "data-URL staging");
  assert.match(src, /const acct = await accountFolder\(\);[\s\S]{0,400}stageDirs\(authUser\.id, acct\)/);
  assert.match(src, /const path = stagePath\(acct, `\$\{Date\.now\(\)\}-\$\{kind\}-device-/);
  assert.ok(!/\$\{authUser\.id\}\/stage-tmp/.test(src) && !/STAGE_TMP_PREFIX/.test(src), "no hard-coded {uid}/stage-tmp prefix left");
  assert.match(read("supabase/functions/image-proxy/stage-paths.mjs"), /^import "\.\/storage-keys\.js";$/m);
});

/* ── blender-bridge helpers ──────────────────────────────────────────────── */
await test("relay PNG keys: legacy stays exact; readable only when both folders name the owner and project", () => {
  assert.equal(legacyRelayPngPath(U, P, "job-1"), `${U}/${P}/shot/job-1/blender-preview-job-1.png`);
  assert.deepEqual(validStorageFolders({ v: 1, account: ACCT, project: PROJ }, U, P), { account: ACCT, project: PROJ });
  for (const a of [null, { v: 2, account: ACCT, project: PROJ }, { v: 1, account: "x--" + OTHER, project: PROJ },
    { v: 1, account: ACCT, project: "x--" + OTHER }, { v: 1, account: ACCT, project: null }, { v: 1, account: "Alex--" + U, project: PROJ }])
    assert.equal(validStorageFolders(a, U, P), null, JSON.stringify(a));
  assert.equal(relayPngPathFor({ account: ACCT, project: PROJ }, U, P, "job-1"), `${ACCT}/${PROJ}/shot/job-1/blender-preview-job-1.png`);
  assert.equal(relayPngPathFor(null, U, P, "job-1"), legacyRelayPngPath(U, P, "job-1"));
  const readable = relayPngPathFor({ account: ACCT, project: PROJ }, U, P, "job-1");
  assert.equal(isRelayPngPath(readable, U, P, "job-1"), true);
  assert.equal(isRelayPngPath(legacyRelayPngPath(U, P, "job-1"), U, P, "job-1"), true);
  assert.equal(isRelayPngPath("owner/project/shot/j/blender-preview-j.png", "owner", "project", "j"), true, "non-UUID test ids: the exact legacy key");
  const cases = [[readable, OTHER, P, "job-1"], [readable, U, OTHER, "job-1"], [readable, U, P, "job-2"],
    [`${ACCT}/${PROJ}/shot/job-1/extra/blender-preview-job-1.png`, U, P, "job-1"], [`${ACCT}/${PROJ}/prop/job-1/blender-preview-job-1.png`, U, P, "job-1"],
    [`${ACCT}/${PROJ}/shot/job-1/blender-preview-job-2.png`, U, P, "job-1"], [`Alex--${U}/${PROJ}/shot/job-1/blender-preview-job-1.png`, U, P, "job-1"],
    [null, U, P, "job-1"], ["", U, P, "job-1"]];
  for (const [p, o, pr, j] of cases) assert.equal(isRelayPngPath(p, o, pr, j), false, `${p} for ${o}/${pr}/${j}`);
  assert.equal(studioPreviewPath({ account: ACCT, project: PROJ }, U, P, "loc-1", "preview-r1"), `${ACCT}/studio-previews/${PROJ}/loc-1/preview-r1.png`);
  assert.equal(studioPreviewPath(null, U, P, "loc-1", "preview-r1"), `${U}/studio-previews/${P}/loc-1/preview-r1.png`);
});
await test("adapter.storageFolders: the service-role RPC with {p_user, p_project_id}; null on every failure", async () => {
  let mode = "ok";
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (mode === "throw") throw new Error("network");
      if (mode === "hang") return new Promise(() => {});
      if (mode === "missing") return { data: null, error: { code: "PGRST202", message: "not found" } };
      if (mode === "other") return { data: { v: 1, account: "x--" + OTHER, project: PROJ }, error: null };
      return { data: { v: 1, account: ACCT, project: PROJ }, error: null };
    },
  };
  const adapter = createSupabaseAdapter({ createClient: () => client, url: "https://recording.test", anonKey: "anon", serviceKey: "service" });
  assert.deepEqual(await adapter.storageFolders(U, P), { account: ACCT, project: PROJ });
  assert.deepEqual(rpcCalls[0], { name: "turn_storage_folders_for", args: { p_user: U, p_project_id: P } }, "argument names match the SQL");
  for (const m of ["throw", "missing", "other"]) { mode = m; assert.equal(await adapter.storageFolders(U, P), null, m); }
  assert.equal(await resolveStorageFolders({}, U, P), null, "an adapter without storageFolders → legacy");
  assert.equal(await resolveStorageFolders({ storageFolders: async () => ({ account: "x--" + OTHER, project: PROJ }) }, U, P), null, "re-validated");
  assert.equal(await resolveStorageFolders({ storageFolders: async () => { throw new Error("x"); } }, U, P), null);
  assert.match(read("supabase/functions/blender-bridge/storage-paths.mjs"), /^import "\.\/storage-keys\.js";$/m);
  assert.equal(read("supabase/functions/blender-bridge/storage-keys.js"), read("app/storage-keys.js"));
});

/* ── the relay, end to end, with and without readable folders ────────────── */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (text) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""));
function pngB64(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(12, 0x49484452);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}
const spec = {
  version: 1, projectId: P, shotId: "shot-1", sceneId: "scene-1", locationId: "loc-1",
  label: "Readable folders", room: { width: 12, depth: 12, height: 4 }, landmarks: [], actors: [], props: [],
  camera: { position: [0, -6, 1.65], target: [0, 0, 1.4], focalLength: 50, sensorWidth: 36 },
  render: { width: 640, height: 360, samples: 16 },
};
const actualCamera = { position: [0, -6, 1.65], direction: [0, 0.999, -0.04], focalLength: 50, sensorWidth: 36, width: 640, height: 360 };
const contract = {
  validateSpec: () => true, canonical: stable, hashSpec: (v) => digest(stable(v)), validateCameraResult: () => true,
  validatePNG: (bytes, w, h) => bytes.length >= 24 && bytes[0] === 137 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) === w
    && new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) === h,
};
function relayHarness({ folders }) {
  const states = new Map(), files = new Map(), calls = [];
  const adapter = {
    async getUserByAccessToken(t) { return t === "browser-secret" ? { id: U, email: "owner@example.test" } : null; },
    async getUserById(id) { return id === U ? { id, email: "owner@example.test" } : null; },
    async getProjectAccess(id, subject) {
      return id === P && subject.id === U ? { exists: true, ownerId: U, actorId: U, canWrite: true }
        : { exists: false, ownerId: null, actorId: subject.id, canWrite: false };
    },
    async getState(_p, entity) { return structuredClone(states.get(entity) || null); },
    async insertState(row) {
      if (states.has(row.entity_id)) { const e = new Error("duplicate"); e.conflict = true; throw e; }
      const saved = { id: `state-${states.size + 1}`, ...structuredClone(row) }; states.set(row.entity_id, saved); return structuredClone(saved);
    },
    async casState(row, expected, next) {
      const cur = states.get(row.entity_id);
      if (!cur || JSON.stringify(cur.meta) !== JSON.stringify(expected)) return { ok: false };
      cur.meta = structuredClone(next); return { ok: true, row: structuredClone(cur) };
    },
    async uploadPng(_b, path, bytes) { calls.push(["upload", path]); if (files.has(path)) return { created: false }; files.set(path, new Uint8Array(bytes)); return { created: true }; },
    async createMarker(_b, path, bytes) { if (files.has(path)) return { created: false }; files.set(path, new Uint8Array(bytes)); return { created: true }; },
    async readMarker(_b, path) { return files.has(path) ? new Uint8Array(files.get(path)) : null; },
    async downloadPng(_b, path) { calls.push(["download", path]); if (!files.has(path)) throw new Error("missing fake file"); return new Uint8Array(files.get(path)); },
    async removePng(_b, path) { calls.push(["remove", path]); files.delete(path); },
  };
  if (folders) adapter.storageFolders = folders;
  let seed = 11;
  const relay = createBlenderRelay({ adapter, contract, serverSecret: "test-only-service-role-key-which-is-long",
    random: (n) => new Uint8Array(n).fill(seed++) });
  const call = async (action, body = {}, authorization) => {
    const headers = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    const response = await relay.handle(new Request("https://relay.test", { method: "POST", headers, body: JSON.stringify({ action, ...body }) }));
    return { status: response.status, json: await response.json() };
  };
  const renderOne = async (device, requestId) => {
    const job = (await call("job.create", { projectId: P, spec, requestId }, "Bearer browser-secret")).json.job;
    const claim = await call("device.claim", {}, `Device ${device}`);
    const done = await call("device.complete", { jobId: job.id, leaseToken: claim.json.leaseToken, pngBase64: pngB64(640, 360), actualCamera }, `Device ${device}`);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    return job.id;
  };
  const connect = async () => {
    const pair = await call("pair.create", { projectId: P }, "Bearer browser-secret");
    return (await call("device.connect", { pairCode: pair.json.pairCode, deviceName: "Test Blender" })).json.deviceToken;
  };
  return { adapter, states, files, calls, call, renderOne, connect };
}
const uploads = (h) => h.calls.filter((c) => c[0] === "upload").map((c) => c[1]);

await test("relay: with valid folders the shot PNG is written under the readable folders and reads back", async () => {
  const h = relayHarness({ folders: async (owner, project) => (owner === U && project === P ? { account: ACCT, project: PROJ } : null) });
  const device = await h.connect();
  const jobId = await h.renderOne(device, "request-1");
  assert.deepEqual(uploads(h), [`${ACCT}/${PROJ}/shot/${jobId}/blender-preview-${jobId}.png`]);
  const got = await h.call("job.get", { projectId: P, jobId }, "Bearer browser-secret");
  assert.equal(got.status, 200);
  assert.equal(got.json.job.pngBase64, pngB64(640, 360), "the readable key downloads");
  // a new job replaces it: the relay removes the old readable PNG (its own key only)
  await h.call("job.create", { projectId: P, spec, requestId: "request-2" }, "Bearer browser-secret");
  assert.deepEqual(h.calls.filter((c) => c[0] === "remove").map((c) => c[1]), [uploads(h)[0]]);
});
await test("relay: an adapter without storageFolders, or with a bad answer, writes the legacy key", async () => {
  for (const folders of [null, async () => ({ account: "x--" + OTHER, project: PROJ }), async () => { throw new Error("rpc down"); }]) {
    const h = relayHarness({ folders });
    const device = await h.connect();
    const jobId = await h.renderOne(device, "request-1");
    assert.deepEqual(uploads(h), [legacyRelayPngPath(U, P, jobId)]);
  }
});
await test("relay: a job completed under a legacy key still downloads after readable folders switch on; its replacement removes it", async () => {
  const h = relayHarness({ folders: null });
  const device = await h.connect();
  const jobId = await h.renderOne(device, "request-1");
  h.adapter.storageFolders = async () => ({ account: ACCT, project: PROJ });   // the SQL lands afterwards
  const got = await h.call("job.get", { projectId: P, jobId }, "Bearer browser-secret");
  assert.equal(got.status, 200);
  assert.equal(got.json.job.pngBase64, pngB64(640, 360));
  await h.call("job.create", { projectId: P, spec, requestId: "request-2" }, "Bearer browser-secret");
  assert.deepEqual(h.calls.filter((c) => c[0] === "remove").map((c) => c[1]), [legacyRelayPngPath(U, P, jobId)]);
  const claim = await h.call("device.claim", {}, `Device ${device}`);
  const second = claim.json.job.id;
  await h.call("device.complete", { jobId: second, leaseToken: claim.json.leaseToken, pngBase64: pngB64(640, 360), actualCamera }, `Device ${device}`);
  assert.equal(uploads(h).at(-1), `${ACCT}/${PROJ}/shot/${second}/blender-preview-${second}.png`, "new renders use the readable folders");
});
await test("relay: the stored-key check accepts only this job's own key in the same folders", async () => {
  const h = relayHarness({ folders: async () => ({ account: ACCT, project: PROJ }) });
  const device = await h.connect();
  const jobId = await h.renderOne(device, "request-1");
  const good = uploads(h)[0];
  const forged = `${ACCT}/${PROJ}/shot/job-other/blender-preview-job-other.png`;
  h.files.set(forged, h.files.get(good));
  // the encrypted state cannot be edited from outside; exercise the check itself
  assert.equal(isRelayPngPath(forged, U, P, jobId), false);
  assert.equal(isRelayPngPath(good, U, P, jobId), true);
});

await test("relay: the PNG key is chosen once per job; a retried completion after a lost storage response adopts the same key (review 2026-09-27)", async () => {
  // the project is still untitled when the render is requested…
  let answer = { account: ACCT, project: "untitled--" + P };
  const h = relayHarness({ folders: async () => answer });
  const device = await h.connect();
  const job = (await h.call("job.create", { projectId: P, spec, requestId: "request-1" }, "Bearer browser-secret")).json.job;
  const claim = await h.call("device.claim", {}, `Device ${device}`);
  const first = `${ACCT}/untitled--${P}/shot/${job.id}/blender-preview-${job.id}.png`;
  // …attempt 1: Storage creates the object but the response is lost, and the read-back fails too
  const realUpload = h.adapter.uploadPng, realDownload = h.adapter.downloadPng;
  let lose = true;
  h.adapter.uploadPng = async (b, path, bytes) => { const r = await realUpload(b, path, bytes); if (lose) throw new Error("response lost"); return r; };
  h.adapter.downloadPng = async (b, path) => { if (lose) throw new Error("read-back failed"); return realDownload(b, path); };
  const body = { jobId: job.id, leaseToken: claim.json.leaseToken, pngBase64: pngB64(640, 360), actualCamera };
  const attempt1 = await h.call("device.complete", body, `Device ${device}`);
  assert.notEqual(attempt1.status, 200, "attempt 1 fails");
  assert.deepEqual(uploads(h), [first]);
  // …meanwhile the owner names the project, and the folder lookup would now answer differently
  lose = false;
  answer = { account: ACCT, project: "pine-soot--" + P };
  const attempt2 = await h.call("device.complete", body, `Device ${device}`);
  assert.equal(attempt2.status, 200, JSON.stringify(attempt2.json));
  assert.deepEqual(uploads(h), [first, first], "the retry writes (and adopts) exactly the key chosen at creation");
  const pngs = [...h.files.keys()].filter((k) => k.endsWith(`/blender-preview-${job.id}.png`));
  assert.deepEqual(pngs, [first], "no second PNG is left behind");
  const got = await h.call("job.get", { projectId: P, jobId: job.id }, "Bearer browser-secret");
  assert.equal(got.json.job.pngBase64, pngB64(640, 360));
  // the same holds when the lookup fails outright at completion time
  const h2 = relayHarness({ folders: async () => ({ account: ACCT, project: PROJ }) });
  const d2 = await h2.connect();
  const j2 = (await h2.call("job.create", { projectId: P, spec, requestId: "request-1" }, "Bearer browser-secret")).json.job;
  const c2 = await h2.call("device.claim", {}, `Device ${d2}`);
  h2.adapter.storageFolders = async () => { throw new Error("rpc down"); };
  const done2 = await h2.call("device.complete", { jobId: j2.id, leaseToken: c2.json.leaseToken, pngBase64: pngB64(640, 360), actualCamera }, `Device ${d2}`);
  assert.equal(done2.status, 200);
  assert.deepEqual(uploads(h2), [`${ACCT}/${PROJ}/shot/${j2.id}/blender-preview-${j2.id}.png`], "completion never asks the lookup again");
});
await test("relayPngTarget: the stored target when it is this job's own key; otherwise (a job made by the previous deployment) the legacy key", () => {
  const readable = `${ACCT}/${PROJ}/shot/job-1/blender-preview-job-1.png`;
  assert.equal(relayPngTarget({ id: "job-1", pngTarget: readable }, U, P), readable);
  assert.equal(relayPngTarget({ id: "job-1" }, U, P), legacyRelayPngPath(U, P, "job-1"), "no pngTarget (created before this change)");
  assert.equal(relayPngTarget({ id: "job-1", pngTarget: legacyRelayPngPath(U, P, "job-1") }, U, P), legacyRelayPngPath(U, P, "job-1"));
  for (const bad of [`${ACCT}/${PROJ}/shot/job-2/blender-preview-job-2.png`, `x--${OTHER}/${PROJ}/shot/job-1/blender-preview-job-1.png`,
    `${ACCT}/x--${OTHER}/shot/job-1/blender-preview-job-1.png`, `${ACCT}/${PROJ}/shot/job-1/other.png`, 42, null])
    assert.equal(relayPngTarget({ id: "job-1", pngTarget: bad }, U, P), legacyRelayPngPath(U, P, "job-1"), String(bad));
});
await test("relay: a job created without folders completes under the legacy key even if the lookup answers by then", async () => {
  const h = relayHarness({ folders: null });
  const device = await h.connect();
  const job = (await h.call("job.create", { projectId: P, spec, requestId: "request-1" }, "Bearer browser-secret")).json.job;
  h.adapter.storageFolders = async () => ({ account: ACCT, project: PROJ });   // readable folders switch on meanwhile
  const claim = await h.call("device.claim", {}, `Device ${device}`);
  const done = await h.call("device.complete", { jobId: job.id, leaseToken: claim.json.leaseToken, pngBase64: pngB64(640, 360), actualCamera }, `Device ${device}`);
  assert.equal(done.status, 200);
  assert.deepEqual(uploads(h), [legacyRelayPngPath(U, P, job.id)]);
});

/* ── Studio previews ─────────────────────────────────────────────────────── */
async function publishPreview(adapter, stateIn) {
  const service = createStudioService({ contract: globalThis.BlenderStudioContract, adapter, provider: {} });
  let state = stateIn;
  const ctx = {
    kind: "browser", snapshot: { state }, actor: { id: U }, access: { ownerId: U }, projectId: P,
    recheck: async () => {}, save: async (next) => { state = structuredClone(next); return { state }; },
  };
  const out = await service.handle(new Request("https://relay.test"), {
    action: "studio.preview.publish", locationId: "loc-1", baseRevision: 3, requestId: "req-1",
    pngBase64: pngB64(64, 64), actualCamera: { position: [0, -5, 2], target: [0, 0, 1], focalLength: 50, sensorWidth: 36 },
  }, { context: async () => ctx });
  return { out, state, service, ctx: () => ({ ...ctx, snapshot: { state } }) };
}
const studioState = () => ({ studio: { v: 1, current: {}, tasks: {}, workspaces: { "loc-1": {
  schema: "cm-studio-v1", projectId: P, locationId: "loc-1", name: "Harbor", parentLocationId: null, rootLocationId: "loc-1",
  revision: 3, context: { description: "", architecture: "", materials: "", staging: "", productionPlan: "" },
  objects: [], shots: [], references: [{ entityId: "loc-1", kind: "location", label: "Harbor", version: "v1" }], assets: [], previews: [] } } } });
function studioAdapter(folders) {
  const files = new Map();
  const a = {
    files,
    async validateStudioReference() { return true; },
    async uploadStudioAsset(path, bytes) { files.set(path, new Uint8Array(bytes)); return { created: true }; },
    async downloadStudioAsset(path) { if (!files.has(path)) throw new Error("missing"); return new Uint8Array(files.get(path)); },
  };
  if (folders) a.storageFolders = folders;
  return a;
}
await test("studio: a preview publishes under the readable owner/project folders (folder 2 stays studio-previews) and reads back", async () => {
  const adapter = studioAdapter(async (o, p) => (o === U && p === P ? { account: ACCT, project: PROJ } : null));
  const { out, state, service, ctx } = await publishPreview(adapter, studioState());
  assert.equal(out.preview.id, "preview-req-1");
  assert.deepEqual([...adapter.files.keys()], [`${ACCT}/studio-previews/${PROJ}/loc-1/preview-req-1.png`]);
  assert.equal(state.studio.previewPaths["preview-req-1"], `${ACCT}/studio-previews/${PROJ}/loc-1/preview-req-1.png`);
  const got = await service.handle(new Request("https://relay.test"), { action: "studio.preview.get", locationId: "loc-1", previewId: "preview-req-1" },
    { context: async () => ctx() });
  assert.equal(got.pngBase64, pngB64(64, 64));
});
await test("studio: without valid folders the legacy preview key; a stored legacy preview still reads once folders exist", async () => {
  const adapter = studioAdapter(null);
  const { state, service, ctx } = await publishPreview(adapter, studioState());
  const legacy = `${U}/studio-previews/${P}/loc-1/preview-req-1.png`;
  assert.deepEqual([...adapter.files.keys()], [legacy]);
  adapter.storageFolders = async () => ({ account: ACCT, project: PROJ });
  const got = await service.handle(new Request("https://relay.test"), { action: "studio.preview.get", locationId: "loc-1", previewId: "preview-req-1" },
    { context: async () => ctx() });
  assert.equal(got.pngBase64, pngB64(64, 64), "reads use the stored data.previewPaths entry");
  assert.equal(state.studio.previewPaths["preview-req-1"], legacy);
  const bad = studioAdapter(async () => ({ account: ACCT, project: "x--" + OTHER }));
  await publishPreview(bad, studioState());
  assert.deepEqual([...bad.files.keys()], [legacy], "a mismatched project folder falls back to legacy");
});

console.log(checks + " checks passed");

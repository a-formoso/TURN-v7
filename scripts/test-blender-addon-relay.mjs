/* Local createBlenderRelay + packaged add-on/Blender interop regression.
 * Run with: node scripts/test-blender-addon-relay.mjs
 * Set BLENDER_BIN when Blender is not on PATH. */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBlenderRelay } from "../supabase/functions/blender-bridge/relay-core.mjs";
import contract from "../supabase/functions/blender-bridge/shared-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = path.join(root, "app", "downloads", "cinema-machine-blender.zip");
const runnerPath = path.join(root, "scripts", "test-blender-addon-relay.py");
const ownerId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const browserToken = "blender-relay-interop-browser-fixture";
const serverSecret = "blender-relay-interop-server-secret";
const spec = {
  version: 1, projectId, shotId: "shot-interop", sceneId: "scene-interop",
  locationId: "location-interop", label: "Packaged add-on relay proof",
  room: { width: 3.3333333333333335, depth: 6, height: 4 },
  landmarks: [], actors: [], props: [],
  camera: { position: [0, -3, 1.6], target: [0, 0, 1.3], focalLength: 50, sensorWidth: 36 },
  render: { width: 128, height: 128, samples: 1 },
};

const clone = (value) => value == null ? value : structuredClone(value);
const fail = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) fail(message); };
const states = new Map();
const files = new Map();
const actions = [];
let writable = true;
let seed = 7;

const adapter = {
  async getUserByAccessToken(token) {
    return token === browserToken ? { id: ownerId, email: "owner@example.test" } : null;
  },
  async getUserById(id) {
    return id === ownerId ? { id, email: "owner@example.test" } : null;
  },
  async getProjectAccess(id, subject) {
    return id === projectId && subject.id === ownerId
      ? { exists: true, ownerId, actorId: ownerId, canWrite: writable }
      : { exists: false, ownerId: null, actorId: subject.id, canWrite: false };
  },
  async getState(_project, entity) { return clone(states.get(entity) || null); },
  async insertState(row) {
    if (states.has(row.entity_id)) {
      const error = new Error("state conflict");
      error.conflict = true;
      throw error;
    }
    const saved = { id: `state-${states.size + 1}`, ...clone(row) };
    states.set(row.entity_id, saved);
    return clone(saved);
  },
  async casState(row, expected, next) {
    const current = states.get(row.entity_id);
    if (!current || JSON.stringify(current.meta) !== JSON.stringify(expected)) return { ok: false };
    current.meta = clone(next);
    return { ok: true, row: clone(current) };
  },
  async uploadPng(_bucket, pathName, bytes) {
    if (files.has(pathName)) return { created: false };
    files.set(pathName, new Uint8Array(bytes));
    return { created: true };
  },
  async downloadPng(_bucket, pathName) {
    if (!files.has(pathName)) throw new Error("missing fixture file");
    return new Uint8Array(files.get(pathName));
  },
  async removePng(_bucket, pathName) { files.delete(pathName); },
  async createMarker(_bucket, pathName, bytes) {
    if (files.has(pathName)) return { created: false };
    files.set(pathName, new Uint8Array(bytes));
    return { created: true };
  },
  async readMarker(_bucket, pathName) {
    return files.has(pathName) ? new Uint8Array(files.get(pathName)) : null;
  },
};

const relay = createBlenderRelay({
  adapter,
  contract,
  serverSecret,
  now: () => Date.now(),
  random: (length) => new Uint8Array(length).fill(seed++),
});

async function startServer() {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    let parsedBody = null;
    if (body.length) {
      try { parsedBody = JSON.parse(body.toString("utf8")); } catch (_error) { parsedBody = null; }
    }
    if (parsedBody?.action) actions.push(parsedBody.action);
    try {
      const relayRequest = new Request("http://127.0.0.1", {
        method: request.method,
        headers: request.headers,
        body: body.length ? body : undefined,
      });
      const relayResponse = await relay.handle(relayRequest);
      response.writeHead(relayResponse.status, Object.fromEntries(relayResponse.headers));
      response.end(Buffer.from(await relayResponse.arrayBuffer()));
    } catch (_error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"test relay handler failed"}');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  check(address && typeof address === "object", "local relay server did not bind");
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}

async function post(endpoint, action, fields, authorization) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(endpoint, {
    method: "POST", headers, body: JSON.stringify({ action, ...fields }),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function runBlender(endpoint, pairCode, markerPath, releasePath, commandDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.BLENDER_BIN || "blender", [
      "--background", "--factory-startup", "--python", runnerPath,
    ], {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        CM_TEST_ENDPOINT: endpoint,
        CM_TEST_PAIR_CODE: pairCode,
        CM_TEST_ZIP: zipPath,
        CM_TEST_MARKER: markerPath,
        CM_TEST_RELEASE: releasePath,
        CM_TEST_COMMAND_DIR: commandDir,
      },
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 180000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === "ENOENT" ? "Blender binary was not found" : "Blender could not start"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForMarker(markerPath, childDone) {
  for (let count = 0; count < 3600; count += 1) {
    if (fs.existsSync(markerPath)) return JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (childDone.code !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function waitForResult(resultPath) {
  for (let count = 0; count < 2400; count += 1) {
    if (fs.existsSync(resultPath)) return JSON.parse(fs.readFileSync(resultPath, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function main() {
  check(fs.existsSync(zipPath), "packaged add-on ZIP is missing");
  check(fs.existsSync(runnerPath), "Blender interop runner is missing");
  const { server, endpoint } = await startServer();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cinema-machine-relay-"));
  const markerPath = path.join(temporary, "marker.json");
  const releasePath = path.join(temporary, "release");
  const commandDir = path.join(temporary, "commands");
  fs.mkdirSync(commandDir);
  let childPromise;
  try {
    let response = await post(endpoint, "pair.create", { projectId }, `Bearer ${browserToken}`);
    check(response.status === 200 && typeof response.json.pairCode === "string", "pair.create response shape changed");
    const pairCode = response.json.pairCode;
    response = await post(endpoint, "job.create", {
      projectId, spec, requestId: "packaged-addon-interop",
    }, `Bearer ${browserToken}`);
    check(response.status === 200 && response.json.job?.status === "queued", "job.create response shape changed");

    childPromise = runBlender(endpoint, pairCode, markerPath, releasePath, commandDir);
    const childState = { code: null };
    childPromise.then((result) => Object.assign(childState, result));
    const marker = await waitForMarker(markerPath, childState);
    check(marker?.ok === true, "packaged add-on did not complete a real Blender proof");

    response = await post(endpoint, "job.create", {
      projectId, spec, requestId: "cancel-response-interop",
    }, `Bearer ${browserToken}`);
    check(response.status === 200, "second job.create failed");
    const cancelJobId = response.json.job?.id;
    const cancelResultPath = path.join(commandDir, "cancel-result.json");
    fs.writeFileSync(path.join(commandDir, "cancel.json"), JSON.stringify({ jobId: cancelJobId }));
    const cancelResult = await waitForResult(cancelResultPath);
    check(cancelResult?.ok === true && cancelResult.status === "cancelled",
      "packaged client job.cancel response shape changed");
    response = await post(endpoint, "job.cancel", {
      projectId, jobId: cancelJobId,
    }, `Bearer ${browserToken}`);
    check(response.status === 200 && response.json.job?.status === "cancelled",
      "job.cancel response is not the documented job envelope");
    response = await post(endpoint, "job.get", {
      projectId, jobId: cancelJobId,
    }, `Bearer ${browserToken}`);
    check(response.status === 200 && response.json.job?.status === "cancelled",
      "cancelled job was not persisted");

    response = await post(endpoint, "job.create", {
      projectId, spec, requestId: "failure-response-interop",
    }, `Bearer ${browserToken}`);
    check(response.status === 200, "third job.create failed");
    const failResultPath = path.join(commandDir, "fail-result.json");
    fs.writeFileSync(path.join(commandDir, "fail.json"), "{}");
    const failResult = await waitForResult(failResultPath);
    check(failResult?.ok === true && failResult.leaseInEnvelope === true &&
      failResult.leaseInJob === true && failResult.status === "failed",
      "packaged client device.claim/device.fail response shape changed");
    check(failResult.error === "Blender render failed.",
      "device.fail object error normalization changed unexpectedly");
    check(actions.includes("device.complete") && actions.includes("job.get"),
      "packaged runtime did not use the complete/readback HTTP path");
    fs.writeFileSync(releasePath, "done");
    await childPromise;
    check(actions.includes("connection.disconnect"), "packaged runtime did not use disconnect");
    console.log("BLENDER_RELAY_ADDON_INTEROP_OK real_claim real_blender_png device_complete device_fail job_cancel");
  } finally {
    if (releasePath && !fs.existsSync(releasePath)) fs.writeFileSync(releasePath, "abort");
    if (childPromise) await childPromise.catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Never print relay responses: they can contain scoped fixture credentials.
  console.error(error.message);
  process.exitCode = 1;
});
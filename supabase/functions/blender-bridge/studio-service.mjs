/*
 * Additive cm-studio-v1 extension.  This deliberately receives authenticated
 * relay hooks instead of implementing a second, weaker auth stack.
 */
import { resolveStorageFolders, studioPreviewPath } from "./storage-paths.mjs";
import { answerProviderRef, isTrustedFalUrl, meshOutputFile } from "./studio-reconcile.mjs";
const text = new TextEncoder();
const MAX_GLB = 64 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MODELS = ["claude-fable-5", "claude-opus-5", "gpt-6-astra", "gpt-5.5-2026-04-23"];
const MESH_MODELS = ["meshy/v7/image-to-3d"];
const studioActions = new Set([
  "studio.capabilities", "studio.workspace.open", "studio.workspace.get",
  "studio.workspace.current", "studio.workspace.save", "studio.assistant.submit",
  "studio.assistant.get", "studio.assistant.cancel", "studio.mesh.submit",
  "studio.mesh.get", "studio.mesh.cancel", "studio.asset.get", "studio.reference.get",
  "studio.preview.publish", "studio.preview.get", "studio.board.publish",
]);
/* BLENDER BOARDS (owner 2026-10-26: "Blender board stills feeding the Stage"): a shot's board is 1-4 stills
   rendered through its camera (start → end), published in one call as ordinary previews whose ids say which
   board and frame they are — preview-board_<requestId>_<n>of<N>_f<frame> — so the workspace schema (and every
   add-on that validates it strictly) is unchanged. The browser composes them into one lettered board page. */
const MAX_BOARD_FRAMES = 4, MAX_BOARD_BYTES = 8 * 1024 * 1024;
export function boardPreviewId(requestId, index, count, frame) {
  return `preview-board_${requestId}_${index + 1}of${count}_f${frame}`;
}

function error(status, code, message) {
  const e = new Error(message); e.status = status; e.code = code; return e;
}
function bad(message) { return error(400, "bad_request", message); }
function denied(message = "Studio permission required.") { return error(403, "forbidden", message); }
function conflict(message = "Studio workspace changed; reload before saving.") { return error(409, "conflict", message); }
function id(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw bad(`Invalid ${label}.`);
  return value;
}
function str(value, label, max = 4000, optional = false) {
  if (optional && value == null) return value;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw bad(`Invalid ${label}.`);
  return value;
}
function object(v) { return !!v && Object.getPrototypeOf(v) === Object.prototype; }
function clone(v) { return structuredClone(v); }
function bytesB64(bytes) {
  let binary = ""; for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
function b64Bytes(value, max) {
  // a flat character check plus the length rule: the grouped pattern this replaced ran out of stack on
  // images above about 3 MB (2026-10-26) and turned a valid upload into a crash
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) + 8 || value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw bad("Invalid encoded bytes.");
  const s = atob(value), bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  if (bytes.length > max) throw error(413, "too_large", "File is too large."); return bytes;
}
async function sha(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
}
function defaultWorkspace(projectId, location) {
  const incoming = object(location.context) ? location.context : {};
  const context = { description: "", architecture: "", materials: "", staging: "", productionPlan: "" };
  ["description","architecture","materials","staging","productionPlan"].forEach(key => {
    if (typeof incoming[key] === "string") context[key] = incoming[key];
  });
  return { schema: "cm-studio-v1", projectId, locationId: location.id, name: location.name,
    parentLocationId: location.parentLocationId || null, rootLocationId: location.rootLocationId || location.id,
    revision: 0, context,
    objects: [], shots: [], references: [], assets: [], previews: [] };
}
function studio(state) {
  // relay-core addresses this sealed state by canonical project owner + project,
  // not the requesting member.  Thus `workspaces` is shared by owner and
  // active art directors; only keyed current/delegated authorization values
  // below are actor-private and never serialized to another caller.
  if (!object(state.studio)) state.studio = { v: 1, workspaces: {}, tasks: {}, current: {} };
  if (!object(state.studio.workspaces) || !object(state.studio.tasks) || !object(state.studio.current)) throw error(500, "state_corrupt", "Studio state is unavailable.");
  return state.studio;
}
function taskPublic(task) {
  const result = { id: task.id, type: task.type, status: task.status, modelId: task.modelId, locationId: task.locationId };
  ["baseRevision","message","error","costEstimate"].forEach(k => { if (task[k] != null) result[k] = clone(task[k]); });
  // A provider result is sealed until its associated successful debit is
  // durable. In particular, an unpaid proposal must never be Apply-able.
  if (task.status === "completed" && task.usageSettled) {
    ["proposal","asset"].forEach(k => { if (task[k] != null) result[k] = clone(task[k]); });
  }
  return result;
}
function taskId(type, requestId) { return `studio-${type}-${requestId}`.slice(0, 128); }
function spendEventId() {
  // This is generated server-side before the durable task claim and never sent
  // to a browser/desktop. It cannot be pre-seeded through legacy user-callable
  // spend receipts, and remains stable for retries once the claim succeeds.
  return `studio-${crypto.randomUUID()}`;
}
// isTrustedFalUrl and meshOutputFile live in studio-reconcile.mjs: the housekeeping reconciliation
// decides a finished mesh's hold with the very same checks (billing round 3, S3).
export function validateGlb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > MAX_GLB) throw bad("Invalid GLB size.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw bad("Invalid GLB header.");
  let at = 12, json = null, chunks = 0;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) throw bad("Truncated GLB.");
    const length = view.getUint32(at, true), kind = view.getUint32(at + 4, true); at += 8;
    if (length % 4 || at + length > bytes.length || ++chunks > 2) throw bad("Invalid GLB chunk.");
    if (kind === 0x4e4f534a) { if (json) throw bad("Invalid GLB JSON."); json = new TextDecoder().decode(bytes.subarray(at, at + length)).replace(/\0+$/, ""); }
    else if (kind !== 0x004e4942) throw bad("Unsupported GLB chunk.");
    at += length;
  }
  if (at !== bytes.length || !json) throw bad("Invalid GLB.");
  let doc; try { doc = JSON.parse(json); } catch (_) { throw bad("Invalid GLB JSON."); }
  let safe = true;
  (function walk(v, key = "") {
    if (!safe) return;
    if (/^(uri|script|command|python|shell|exec|driver)$/i.test(key)) { safe = false; return; }
    if (typeof v === "string" && (v.length > 16384 || /javascript:|file:|https?:\/\//i.test(v))) { safe = false; return; }
    if (Array.isArray(v)) v.forEach(x => walk(x)); else if (object(v)) Object.entries(v).forEach(([k, x]) => walk(x, k));
  })(doc);
  if (!safe || !object(doc.asset) || typeof doc.asset.version !== "string") throw bad("GLB contains unsafe external content.");
  return doc;
}
/* CREDIT ANCHOR (billing fixes, owner decision 2026-09-30, Option A): 1 credit = $0.01 of
   provider cost (it was $0.03), rounded up, at least 1. The same anchor lives in
   supabase/functions/image-proxy/billing-pricing.mjs and app/pricing.jsx — change them together.
   Until the switch day the balances are still in the old unit, so the service prices in the
   LIVE unit the adapter reads from turn_credit_regime() (adapter.creditUnit(): $0.03 before
   supabase/billing-switch.sql, $0.01 after); an adapter without it (tests) uses the anchor. */
export const PROVIDER_USD_PER_CREDIT = 0.01;
export function studioCredits(usd, unit = PROVIDER_USD_PER_CREDIT) {
  const n = Number(usd);
  const u = Number(unit) >= 0.001 && Number(unit) <= 1 ? Number(unit) : PROVIDER_USD_PER_CREDIT;
  return !Number.isFinite(n) || n <= 0 ? 1 : Math.max(1, Math.ceil(n / u - 1e-9));
}
/* Assistant list prices per 1M input / output tokens (platform.claude.com and
   developers.openai.com pricing, checked 2026-09-29; they were 2-3x too high until 2026-09-30). */
export const ASSISTANT_RATES = Object.freeze({
  "claude-fable-5": Object.freeze([10, 50]), "claude-opus-5": Object.freeze([5, 25]),
  "gpt-6-astra": Object.freeze([10, 50]), "gpt-5.5-2026-04-23": Object.freeze([5, 30]),
});
/* The most one assistant call can use: the prompt is bounded (studio-provider-prompt.mjs keeps
   the workspace context under 24,000 characters, the request prompt under 6,000; with the
   instructions and one image that stays under 20,000 tokens) and the reply is capped in index.ts
   (2,048 tokens for Claude, as before; 16,000 for OpenAI, whose cap also covers its reasoning).
   The hold is this maximum; settlement keeps the reported cost, never more than the hold. */
export const ASSISTANT_MAX_INPUT_TOKENS = 20000;
export const ASSISTANT_MAX_OUTPUT_TOKENS = Object.freeze({ claude: 2048, openai: 16000 });
export function meshEstimate(rigged, animated, unit = PROVIDER_USD_PER_CREDIT) {
  const providerCostUsd = 1.20 + (rigged ? .20 : 0) + (animated ? .12 : 0);
  return { providerCostUsd, credits: studioCredits(providerCostUsd, unit), currency: "USD", basis: "Meshy v7 full texture pricing" };
}
export function assistantEstimate(modelId, usage, unit = PROVIDER_USD_PER_CREDIT) {
  const rates = ASSISTANT_RATES[modelId];
  if (!rates) throw bad("Unsupported model.");
  const inputTokens = Math.max(0, Number(usage?.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage?.outputTokens) || 0);
  const providerCostUsd = inputTokens / 1000000 * rates[0] + outputTokens / 1000000 * rates[1];
  return { providerCostUsd, credits: studioCredits(providerCostUsd, unit),
    currency: "USD", inputTokens, outputTokens, basis: "reported provider token usage" };
}
/** The HOLD for one assistant call: its bounded maximum. */
export function assistantHoldCredits(modelId, unit = PROVIDER_USD_PER_CREDIT) {
  const out = String(modelId).startsWith("claude-") ? ASSISTANT_MAX_OUTPUT_TOKENS.claude : ASSISTANT_MAX_OUTPUT_TOKENS.openai;
  return assistantEstimate(modelId, { inputTokens: ASSISTANT_MAX_INPUT_TOKENS, outputTokens: out }, unit).credits;
}

export function createStudioService({ contract, provider = {}, adapter, now = () => Date.now() } = {}) {
  if (!contract?.validateWorkspace || !contract?.validateProposal) throw new Error("Studio contract is required.");
  async function persist(ctx, next) { return ctx.save(next, ctx.snapshot); }
  function workspaceFor(state, locationId) {
    const value = studio(state).workspaces[locationId]; if (!value) throw error(404, "not_found", "Studio workspace not found."); return value;
  }
  async function validateReferences(ctx, references) {
    if (!Array.isArray(references) || references.length > 200) throw bad("Invalid references (maximum 200).");
    if (!references.length) return [];
    if (typeof adapter?.validateStudioReference !== "function") {
      throw error(503, "reference_validation_unavailable", "Studio reference validation is unavailable.");
    }
    for (const reference of references) {
      if (!object(reference) || typeof reference.entityId !== "string" ||
        !(await adapter.validateStudioReference({ projectId: ctx.projectId, entityId: reference.entityId,
          kind: reference.kind, version: reference.version }))) {
        throw bad("Reference is not an authorized generated project asset.");
      }
    }
    await ctx.recheck();
    return clone(references);
  }
  async function requireLocationImage(ctx, locationId, references) {
    const source = (references || []).find(r => r.entityId === locationId && r.kind === "location");
    if (!source?.version) throw bad("Generate this location's image before opening Blender Studio.");
    await validateReferences(ctx, [source]);
    return source;
  }
  async function readGeneratedImage(ctx, reference) {
    const image = typeof adapter?.getStudioReference === "function" &&
      await adapter.getStudioReference({ projectId: ctx.projectId, entityId: reference.entityId, reference });
    if (!image || !(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > MAX_IMAGE ||
      !/^image\/(png|jpeg|webp)$/.test(image.contentType || ""))
      throw bad("The generated source image is unavailable. Regenerate or restore it before opening Studio.");
    await ctx.recheck();
    return image;
  }
  function validateBindings(workspace) {
    const assets = new Set(workspace.assets.map(asset => asset.id));
    const characters = new Set(workspace.references.filter(reference => reference.kind === "character")
      .map(reference => reference.entityId));
    const check = list => list.forEach(item => {
      if (item.assetId != null && !assets.has(item.assetId)) throw bad("Object asset is not authorized for this workspace.");
      if (item.characterId != null && !characters.has(item.characterId)) throw bad("Object character is not an authorized workspace reference.");
    });
    check(workspace.objects); workspace.shots.forEach(shot => check(shot.objects));
  }
  function ensureCurrent(s, actorId, locationId, shotId) { studio(s).current[actorId] = { locationId, shotId: shotId || null, updatedAt: now() }; }
  async function billingReady() {
    if (typeof adapter?.studioBillingReady === "function") return (await adapter.studioBillingReady()) === true;
    return adapter?.atomicStudioSettlement === true;
  }
  /* BILLING (2026-09-30): authorize checks the plan (Blender Studio is Director and up; no trial,
     no frozen account) and HOLDS the job's credits before the provider is called — the mesh's
     price, or the assistant's bounded maximum. The hold's ref rides the task (sealed relay
     state); settlement then settles that hold (min(actual, held)) and a failed or cancelled job
     releases it. An adapter without holds (tests, or before billing-v2.sql) keeps the older
     check-then-debit settlement. Returns the hold ref, or null. */
  async function authorize(ctx, token, cost = 1, eventId = null) {
    if (!(await billingReady())) {
      throw error(503, "billing_atomic_settlement_unavailable",
        "Studio generation is unavailable until atomic credit settlement is configured.");
    }
    if (typeof adapter?.authorizeCredit !== "function") throw error(503, "billing_unavailable", "Studio billing is unavailable.");
    // projectId + ownerId: on someone else's film the owner pays (Team, 2026-10-03; supabase-adapter.mjs)
    const result = await adapter.authorizeCredit({ token, uid: ctx.actor.id, cost, eventId,
      projectId: ctx.projectId || null, ownerId: (ctx.access && ctx.access.ownerId) || null });
    if (!result?.ok) {
      const code = result?.code || "insufficient_credits";
      // Team review (2026-10-09): film_role / team_paused 403, film_unverified 503 (supabase-adapter.mjs);
      // Stage editor review (2026-10-09): film_access (a real film the caller isn't on) 403
      const status = code === "tier_required" || code === "account_frozen" || code === "film_role" || code === "team_paused" || code === "film_access" ? 403
        : code === "billing_unavailable" || code === "film_unverified" ? 503 : 402;
      throw error(status, code, result?.message || "Insufficient credits for this generation.");
    }
    return result.holdRef || null;
  }
  /* The live credit unit (USD per credit). An adapter without creditUnit keeps the anchor; one
     that answers nothing usable refuses paid work (503) rather than guess — `display` callers
     (the capabilities estimate) fall back to the anchor instead. */
  async function creditUnitNow({ display = false } = {}) {
    if (typeof adapter?.creditUnit !== "function") return PROVIDER_USD_PER_CREDIT;
    let unit = null;
    try { unit = await adapter.creditUnit(); } catch (_) { unit = null; }
    if (Number(unit) >= 0.001 && Number(unit) <= 1) return Number(unit);
    if (display) return PROVIDER_USD_PER_CREDIT;
    throw error(503, "billing_unavailable", "Credits can't be checked right now. Please try again in a minute.");
  }
  async function releaseHold(holdRef) {
    if (!holdRef || typeof adapter?.releaseCredit !== "function") return;
    try { await adapter.releaseCredit({ holdRef }); } catch (_) { /* idempotent; retried by the next release */ }
  }
  /* Tie a mesh hold to the provider's job id (turn_hold_attach) right after the submit: the
     housekeeping job then never releases it while the provider may still finish the job (the
     poll settles or releases it). Best effort — a hold that can't be tied is still settled or
     released by this task; an adapter without it (tests, before billing-v2.sql) skips it. */
  async function attachHold(holdRef, providerRef) {
    if (!holdRef || !providerRef || typeof adapter?.attachHold !== "function") return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const r = await adapter.attachHold({ holdRef, providerRef: String(providerRef) }); if (r?.ok !== false) return; } catch (_) { /* retried once */ }
    }
  }
  /* ROUND 2 (2026-09-30): once the assistant has ANSWERED (the provider was paid and the proposal
     is saved as settlement_pending), its hold is tied to `studio-answer:<event id>:<credits>` —
     the task's own server-side event id (unique across projects, unlike the client-derived task
     id) and its reported cost. The 30-minute housekeeping release then leaves it, and the
     reconciliation (studio-reconcile.mjs) settles it at that cost if nobody comes back to it. */
  async function attachAnswer(task) {
    if (!task?.holdRef || task.type !== "assistant") return;
    await attachHold(task.holdRef, answerProviderRef(task.spendEventId, task.costEstimate?.credits));
  }
  /* The provider's own view of a mesh job, normalized: fal reports IN_QUEUE / IN_PROGRESS /
     COMPLETED (older adapters say queued / running). Anything unknown counts as still running,
     never as a failure. */
  function meshState(status) {
    const v = String(status || "").toLowerCase();
    if (v === "queued" || v === "in_queue" || v === "pending") return "queued";
    if (v === "completed") return "completed";
    if (v === "failed" || v === "cancelled" || v === "canceled" || v === "error") return "failed";
    return "running";
  }
  /* REPAIR (2026-09-30): a mesh job's credits come back on cancel only when the provider job is
     really stopped — it never started (still in the provider's queue AND the provider accepted
     the cancellation) or the provider already reports it failed. A job the provider is building
     (or has built) cannot be stopped; it keeps running, is delivered, and is charged as shown. */
  async function stopMeshJob(upstreamId) {
    if (typeof provider.cancelMesh !== "function") return false;
    if (typeof provider.getMesh === "function") {
      let remote = null;
      try { remote = await provider.getMesh(upstreamId); } catch (_) { return false; }
      const st = meshState(remote?.status);
      if (st === "failed") return true;
      if (st !== "queued") return false;
    }
    try { const r = await provider.cancelMesh(upstreamId); return r === true || r?.cancelled === true; } catch (_) { return false; }
  }
  const MESH_NOT_STOPPABLE = "Already being built — it can't be stopped now. It will finish, arrive in your assets and be charged as shown.";
  async function settle(ctx, task, token) {
    if (typeof adapter?.spendCredit !== "function") throw error(503, "billing_unavailable", "Studio billing is unavailable.");
    const result = await adapter.spendCredit({ token, uid: ctx.actor.id, cost: task.costEstimate.credits, eventId: task.spendEventId, reason: `blender-studio:${task.type}`, ...(task.holdRef ? { holdRef: task.holdRef } : {}) });
    if (result?.unavailable) throw error(503, "billing_atomic_settlement_unavailable",
      result.message || "Studio atomic credit settlement is unavailable.");
    if (!result?.ok) throw error(402, "insufficient_credits", result?.message || "Insufficient credits for this generation.");
    task.usageSettled = true;
  }
  async function recoverTaskResponse(ctx, taskKey, cause) {
    // Never retry a write with the snapshot that just lost a CAS. The result
    // was already checkpointed before settlement, so returning its current
    // task gives the client a recovery id without risking another generation.
    const fresh = await ctx.refresh(), current = studio(fresh.state).tasks[taskKey];
    if (!current) throw cause || error(404, "not_found", "Studio task not found.");
    const task = taskPublic(current);
    if (current.status === "settlement_pending") {
      task.message = "Provider completed; credit settlement can be retried.";
      task.error = String(cause?.message || "Credit settlement pending.").slice(0, 400);
    }
    return { task };
  }
  async function fetchOutput(url) {
    if (!isTrustedFalUrl(url) || typeof provider.fetchFile !== "function") throw error(502, "provider_output_invalid", "Provider returned an untrusted asset URL.");
    const result = await provider.fetchFile(url, MAX_GLB);
    if (!result || !(result.bytes instanceof Uint8Array) || result.bytes.length > MAX_GLB) throw error(502, "provider_output_invalid", "Provider asset is invalid.");
    return result.bytes;
  }
  async function resolveMesh(task, ctx, token) {
    if (task.status === "cancelled" || task.status === "failed" || task.status === "completed") return task;
    let bytes, digest;
    if (task.stageReady) {
      // Once the checkpoint is durable, provider URLs are deliberately never
      // consulted again. A transient/corrupt private-stage read stays pending.
      try {
        bytes = await adapter.downloadStudioAsset(task.stagePath);
        validateGlb(bytes); digest = await sha(bytes);
        if (bytes.length !== task.stageReady.bytes || digest !== task.stageReady.sha256) throw new Error("Staged GLB integrity mismatch.");
      } catch (e) {
        task.status = "settlement_pending";
        task.message = "Validated asset staging is temporarily unavailable; retry.";
        task.error = String(e.message || "Staged asset unavailable.").slice(0, 400);
        return task;
      }
    } else {
      if (typeof provider.getMesh !== "function") return task;
      const remote = await provider.getMesh(task.upstreamId);
      await ctx.recheck();
      const state = meshState(remote?.status);
      if (!remote || state === "queued" || state === "running") { task.status = state === "running" ? "running" : "queued"; return task; }
      if (state === "failed") { task.status = "failed"; task.error = String(remote.error || "Mesh provider refused this request.").slice(0, 400); task.providerRefusal = true; await releaseHold(task.holdRef); return task; }
      const file = meshOutputFile(remote, !!task.rigged);
      if (!file || !isTrustedFalUrl(file.url)) { task.status = "failed"; task.error = "Provider returned no trusted GLB."; await releaseHold(task.holdRef); return task; }
      task.upstreamOutputUrl = file.url; // sealed relay state only; never an API response
      bytes = await fetchOutput(file.url); validateGlb(bytes); await ctx.recheck();
      digest = await sha(bytes);
      if (typeof adapter?.uploadStudioAsset !== "function") throw error(503, "storage_unavailable", "Studio asset storage is unavailable.");
      try { await adapter.uploadStudioAsset(task.stagePath, bytes, "model/gltf-binary"); }
      catch (e) { e.studioOutputDurable = true; throw e; }
      // This checkpoint is persisted by the caller before any debit. A later
      // reconciliation reads this stage and cannot fall back to the provider.
      task.stageReady = { sha256: digest, bytes: bytes.length };
      task.providerCompleted = true; task.status = "settlement_pending";
      task.message = "Validated asset staged; awaiting credit settlement.";
      return task;
    }
    const assetId = `asset-${task.id}`.slice(0, 128), path = task.stagePath;
    if (!task.usageSettled) { await settle(ctx, task, token); await ctx.recheck(); }
    task.status = "completed"; task.asset = { id: assetId, name: task.name, kind: "glb", sha256: digest, bytes: bytes.length, modelId: task.modelId, rigged: !!task.rigged, animated: !!task.animated, ...(task.characterId ? { characterId: task.characterId } : {}) };
    task.assetPath = path; return task;
  }
  async function handler(request, body, hooks) {
    if (!studioActions.has(body.action)) return null;
    const ctx = await hooks.context(request, body);
    const initial = ctx.snapshot;
    const state = clone(initial.state), data = studio(state), locationId = body.locationId == null ? null : id(body.locationId, "location id");
    if (body.action === "studio.capabilities") {
      return {
        schema: "cm-studio-v1",
        sourcePolicy: "generated-project-image-v1",
        models: MODELS.map(modelId => {
          const configured = !!provider.models?.[modelId], verified = !!provider.verifiedModels?.[modelId];
          return { modelId, configured, verified, selectable: configured,
            ...(configured && !verified ? { warning: "Configured but not catalog-verified; provider may refuse this exact model." } : {}) };
        }),
        meshModels: MESH_MODELS.map(modelId => ({ modelId, configured: !!provider.meshConfigured,
          verified: !!provider.meshVerified, selectable: !!provider.meshConfigured,
          ...(!provider.meshVerified && provider.meshConfigured ? { warning: "Configured but not catalog-verified." } : {}) })),
        available: !!provider.available, billingReady: await billingReady(),
        billingMessage: await billingReady() ? null :
          "Studio generation is unavailable until atomic credit settlement is configured.",
        meshEstimate: meshEstimate(false, false, await creditUnitNow({ display: true })),
        boardPublish: { maxFrames: MAX_BOARD_FRAMES, maxBytes: MAX_BOARD_BYTES },
      };
    }
    if (body.action === "studio.workspace.open") {
      if (ctx.kind !== "browser") throw denied("Only a browser session can open a workspace.");
      if (!object(body.location)) throw bad("Location is required."); const loc = body.location;
      id(loc.id, "location id"); str(loc.name, "location name", 120);
      const source = await requireLocationImage(ctx, loc.id, body.references);
      await readGeneratedImage(ctx, source);
      let work = data.workspaces[loc.id], changed = false;
      if (!work) { work = defaultWorkspace(ctx.projectId, loc); data.workspaces[loc.id] = work; }
      else {
        if (loc.name && loc.name !== work.name) { work.name = loc.name; changed = true; }
        ["parentLocationId","rootLocationId"].forEach(k => { if (loc[k] !== undefined && work[k] !== (loc[k] || null)) { work[k] = loc[k] || null; changed = true; } });
        if (loc.context && object(loc.context)) ["description","architecture","materials","staging","productionPlan"].forEach(k => {
          if (typeof loc.context[k] === "string" && work.context[k] !== loc.context[k]) { work.context[k] = loc.context[k]; changed = true; }
        });
      }
      contract.validateWorkspace(work);
      const shotId = body.shot?.id || body.shotId || null;
      if (shotId) id(shotId, "shot id");
      if (body.shot && !work.shots.some(shot => shot.id === body.shot.id)) {
        // Validate using the shared schema, then append only. Existing manual
        // shot camera/actors/tracks are never replaced by workspace.open.
        const candidate = clone(work); candidate.shots.push(clone(body.shot));
        contract.validateWorkspace(candidate); work.shots.push(clone(body.shot)); changed = true;
      }
      ensureCurrent(state, ctx.actor.id, loc.id, shotId);
      if (body.references) { work.references = await validateReferences(ctx, body.references); changed = true; contract.validateWorkspace(work); }
      if (changed) work.revision++;
      validateBindings(work);
      // This sealed, short-lived authorization is for a paired desktop's
      // server-side credit RPC only. It is captured from the authenticated
      // request and is never accepted from, or returned to, a desktop client.
      if (!object(data.delegatedAuth)) data.delegatedAuth = {};
      if (ctx.browserToken) data.delegatedAuth[ctx.actor.id] = { token: ctx.browserToken, expiresAt: now() + 55 * 60 * 1000 };
      const saved = await persist(ctx, state); return { workspace: clone(saved.state.studio.workspaces[loc.id]) };
    }
    // Protect reads and writes as well as the UI entry point. Keep task polling
    // and cancellation available so already-paid work can still be settled.
    if (locationId && data.workspaces[locationId])
      await requireLocationImage(ctx, locationId, data.workspaces[locationId].references);
    if (body.action === "studio.workspace.get") return { workspace: clone(workspaceFor(state, locationId)) };
    if (body.action === "studio.workspace.current") {
      const current = data.current[ctx.actor.id];
      if(current&&data.workspaces[current.locationId])await requireLocationImage(ctx,current.locationId,data.workspaces[current.locationId].references);
      return current ? { workspace: clone(data.workspaces[current.locationId] || null), shotId: current.shotId } : { workspace: null, shotId: null };
    }
    if (body.action === "studio.workspace.save") {
      const work = workspaceFor(state, locationId); if (body.baseRevision !== work.revision) throw conflict();
      id(body.mutationId, "mutation id"); if (!object(body.workspace)) throw bad("Workspace is required.");
      const proposed = clone(body.workspace);
      // These records and their backing paths are relay-owned. Never accept
      // client supplied hashes/bytes/previews as an authority claim.
      proposed.assets = clone(work.assets); proposed.previews = clone(work.previews);
      proposed.references = await validateReferences(ctx, proposed.references);
      await requireLocationImage(ctx, locationId, proposed.references);
      contract.validateWorkspace(proposed); validateBindings(proposed);
      if (proposed.projectId !== ctx.projectId || proposed.locationId !== locationId || proposed.revision !== work.revision) throw conflict();
      if (data.mutations?.[locationId] === body.mutationId) return { workspace: clone(work) };
      if (!object(data.mutations)) data.mutations = {};
      proposed.revision++; data.mutations[locationId] = body.mutationId; data.workspaces[locationId] = proposed; ensureCurrent(state, ctx.actor.id, locationId, data.current[ctx.actor.id]?.shotId);
      const saved = await persist(ctx, state); return { workspace: clone(saved.state.studio.workspaces[locationId]) };
    }
    if (body.action === "studio.assistant.submit" || body.action === "studio.mesh.submit") {
      const isMesh = body.action === "studio.mesh.submit", work = workspaceFor(state, locationId);
      const requestId = id(body.requestId, "request id"), key = `${isMesh ? "mesh" : "assistant"}:${requestId}`;
      if (data.tasks[key]) return { task: taskPublic(data.tasks[key]) };
      if (body.acknowledgeCost !== true) throw bad("Cost acknowledgement is required.");
      const modelId = str(body.modelId, "model id", 128);
      if ((isMesh ? MESH_MODELS : MODELS).indexOf(modelId) < 0) throw bad("Unsupported model.");
      if (isMesh && (!provider.meshConfigured || !provider.available)) throw error(503, "provider_unavailable", "Meshy is not configured.");
      if (!isMesh && (!provider.models?.[modelId] || !provider.available)) throw error(503, "provider_unavailable", "Selected assistant model is unavailable.");
      // Paid activation must fail before durable task publication as well as
      // before provider work when atomic sufficient-funds settlement is absent.
       if (!(await billingReady())) throw error(503,
        "billing_atomic_settlement_unavailable",
        "Studio generation is unavailable until atomic credit settlement is configured.");
      if (!isMesh && body.baseRevision !== work.revision) throw conflict();
      if (!isMesh && body.snapshot != null) { contract.validateWorkspace(body.snapshot); if (body.snapshot.locationId !== locationId || body.snapshot.projectId !== ctx.projectId) throw bad("Snapshot belongs to another workspace."); if(body.snapshot.revision!==work.revision)throw conflict(); }
      const inputWorkspace=!isMesh&&body.snapshot ? {...clone(body.snapshot),context:clone(work.context),
        references:clone(work.references),assets:clone(work.assets)} : work;
      validateBindings(inputWorkspace);
      if(body.imageDataUrl != null)throw bad("Use a saved generated project reference, not a temporary upload.");
      const referenceId=id(body.referenceId,"generated source reference id");
      const source=work.references.find(reference=>reference.entityId===referenceId);
      if(!source||!source.version)throw bad("Select a saved generated project image in this workspace.");
      if(!isMesh&&body.mode==="scene"&&referenceId!==locationId)
        throw bad("Scene Builder must derive the set from its location image.");
      const image=await readGeneratedImage(ctx,source);
      if (isMesh) {
        if (body.prompt != null) str(body.prompt, "mesh prompt", 600);
        if (modelId === "meshy/v7/image-to-3d" && !image) throw bad("The selected image-to-3D model requires an image.");
        if (body.targetPolycount != null && (!Number.isInteger(body.targetPolycount) ||
          body.targetPolycount < 1000 || body.targetPolycount > 100000)) throw bad("Invalid target polycount.");
        if (body.animated && !body.rigged) throw bad("Animation requires rigging.");
        if (body.animationActionId != null && (!Number.isInteger(body.animationActionId) || body.animationActionId < 0 || body.animationActionId > 696)) throw bad("Invalid animation action.");
        if (body.characterId && !work.references.some(reference =>
          reference.kind === "character" && reference.entityId === id(body.characterId, "character id"))) {
          throw bad("Character is not an authorized workspace reference.");
        }
      } else { if (body.mode !== "scene" && body.mode !== "animation") throw bad("Invalid assistant mode."); str(body.prompt, "assistant prompt", 6000); }
      const unit = await creditUnitNow();   // every credit figure for this job, in the live unit
      const type = isMesh ? "mesh" : "assistant", outputNonce = isMesh ? crypto.randomUUID() : null,
        task = { id: taskId(type, requestId), type, status: "queued", modelId, locationId, baseRevision: isMesh ? undefined : work.revision, requestId, launcherId: ctx.actor.id, message: "Queued.", spendEventId: spendEventId(), costEstimate: isMesh ? meshEstimate(!!body.rigged, !!body.animated, unit) : { providerCostUsd: null, credits: null, basis: "final cost uses reported provider token usage" }, ...(isMesh ? { stagePath: `blender-studio-internal/output/${outputNonce}/asset.glb`, name: str(body.name, "asset name", 120), rigged: !!body.rigged, animated: !!body.animated, characterId: body.characterId ? id(body.characterId, "character id") : undefined } : {}) };
      const delegated = data.delegatedAuth?.[ctx.actor.id];
      const token = ctx.browserToken || (delegated?.expiresAt > now() ? delegated.token : null);
      if (!token) throw error(401, "billing_authorization_expired", "Open this workspace in a browser again before paid generation.");
      data.tasks[key] = task; const saved = await persist(ctx, state); // record before any provider await
      if (isMesh) {
        let meshHoldRef = null, submittedId = null;
        try {
          meshHoldRef = await authorize(ctx, token, task.costEstimate.credits, task.spendEventId); await ctx.recheck();
          const remote = await provider.submitMesh({ endpoint: modelId, prompt: body.prompt, image: image?.bytes, target_polycount: body.targetPolycount, enable_rigging: !!body.rigged, enable_animation: !!body.animated, animation_action_id: body.animationActionId == null ? 92 : body.animationActionId, requestId });
          await ctx.recheck(); const fresh = await ctx.refresh(), next = clone(fresh.state), durable = studio(next).tasks[key];
          submittedId = remote?.requestId || remote?.id || null;
          if (submittedId && meshHoldRef) await attachHold(meshHoldRef, submittedId);
          if (durable.status === "cancelled") {
            // cancelled while the submit was in flight: the credits come back only if the job
            // really stops at the provider; otherwise it runs on and is delivered and charged
            if (!submittedId || await stopMeshJob(submittedId)) { await releaseHold(meshHoldRef); return { task: taskPublic(durable) }; }
            durable.status = "queued"; durable.message = MESH_NOT_STOPPABLE;
          }
           if (meshHoldRef) durable.holdRef = meshHoldRef;
           durable.upstreamId = submittedId;
           if (!durable.upstreamId) { durable.status = "failed"; durable.error = "Mesh provider did not return a request id."; await releaseHold(meshHoldRef); }
           else {
             // The upstream job must survive an edge response/CAS failure. It
             // can then be reconciled and settled with this same task event.
             const claimed = await persist({ ...ctx, snapshot: fresh }, next);
             const claimedState = clone(claimed.state), claimedTask = studio(claimedState).tasks[key];
             await resolveMesh(claimedTask, { ...ctx, snapshot: claimed, access: ctx.access, recheck: ctx.recheck }, token);
             if (claimedTask.asset && !claimedState.studio.workspaces[locationId].assets.some(a => a.id === claimedTask.asset.id)) claimedState.studio.workspaces[locationId].assets.push(claimedTask.asset);
             const updated = await persist({ ...ctx, snapshot: claimed }, claimedState);
             return { task: taskPublic(updated.state.studio.tasks[key]) };
           }
          if (durable.asset && !next.studio.workspaces[locationId].assets.some(a => a.id === durable.asset.id)) next.studio.workspaces[locationId].assets.push(durable.asset);
          const updated = await persist({ ...ctx, snapshot: fresh }, next); return { task: taskPublic(updated.state.studio.tasks[key]) };
         } catch (e) { const fresh = await ctx.refresh(), next = clone(fresh.state), durable = studio(next).tasks[key];
           // cancelled meanwhile: the credits come back when nothing was submitted, or the job stopped
           if (durable && durable.status === "cancelled" && meshHoldRef && (!submittedId || await stopMeshJob(submittedId))) await releaseHold(meshHoldRef);
           if (durable && durable.status !== "cancelled") {
           if (meshHoldRef && !durable.holdRef) durable.holdRef = meshHoldRef;
           if (durable.upstreamId && (e?.status == null || e?.status === 402 || e?.status === 503 || e?.status === 409 || e?.studioOutputDurable || durable.providerCompleted)) {
             durable.status = "settlement_pending"; durable.message = "Provider completed; credit settlement can be retried.";
             durable.error = String(e.message || "Credit settlement pending.").slice(0,400); durable.providerRefusal = false;
           } else { durable.status = "failed"; durable.error = String(e.message || "Mesh provider refused this request.").slice(0,400); durable.providerRefusal = true; await releaseHold(meshHoldRef); }
           const updated = await persist({ ...ctx, snapshot:fresh },next);
           if (durable.status === "settlement_pending") return {task:taskPublic(updated.state.studio.tasks[key])};
           if (e?.status === 402 || e?.status === 403 || e?.status === 503) throw e;
           return {task:taskPublic(updated.state.studio.tasks[key])}; } throw e; }
      }
      let assistantHoldRef = null;
      try {
        assistantHoldRef = await authorize(ctx, token, assistantHoldCredits(modelId, unit), task.spendEventId); await ctx.recheck();
        const answer = await provider.submitAssistant({ modelId, mode: body.mode, prompt: body.prompt,
          workspace: inputWorkspace, image: image.bytes, imageType: image.contentType, requestId });
        await ctx.recheck(); const fresh = await ctx.refresh(), next = clone(fresh.state), durable = studio(next).tasks[key];
        // the provider has ANSWERED (and billed): a cancel that arrived meanwhile can't un-spend it,
        // so the proposal is kept and charged at its reported usage (never above the hold) instead
        // of the hold being given back for work that was done (repair, 2026-09-30)
        if (durable.status === "cancelled") { durable.status = "running"; durable.message = "The assistant had already answered when the cancel arrived."; }
        if (durable.status !== "cancelled") {
          if (assistantHoldRef) durable.holdRef = assistantHoldRef;
          durable.proposal = typeof answer === "string" ? JSON.parse(answer) : answer?.proposal || answer;
          const proposalWorkspace = next.studio.workspaces[locationId];
          contract.validateProposal(durable.proposal, proposalWorkspace);
          // Validate any referenced asset/character in a proposal against the
          // existing sealed workspace authority before exposing it to Apply.
          for (const operation of durable.proposal.ops) if (operation.object) {
            const candidate = clone(proposalWorkspace);
            if (operation.scope === "set") candidate.objects = [operation.object];
            else candidate.shots = candidate.shots.map(shot => shot.id === operation.shotId
              ? { ...shot, objects: [operation.object] } : shot);
            validateBindings(candidate);
          }
          durable.costEstimate = assistantEstimate(modelId, typeof answer === "object" ? answer.usage : null, unit);
          // Save the validated provider result before charging. If a debit
          // response is lost or rejects due to a concurrent spend, retry the
          // same private event from assistant.get without resubmitting.
          durable.status = "settlement_pending";
          durable.message = "Provider completed; awaiting credit settlement.";
        }
        const prepared = await persist({ ...ctx, snapshot:fresh }, next);
        const settledState = clone(prepared.state), settled = studio(settledState).tasks[key];
        if (settled.status === "cancelled" || settled.status === "completed") return { task: taskPublic(settled) };
        await attachAnswer(settled);
        try {
          await settle(ctx, settled, token); await ctx.recheck();
          settled.status = "completed"; settled.message = "Proposal ready for explicit Apply.";
          const updated = await persist({ ...ctx, snapshot: prepared }, settledState);
          return { task: taskPublic(updated.state.studio.tasks[key]) };
        } catch (e) {
          return await recoverTaskResponse(ctx, key, e);
        }
      } catch (e) { const fresh=await ctx.refresh(), next=clone(fresh.state), durable=studio(next).tasks[key]; if(durable&&durable.status==="cancelled")await releaseHold(assistantHoldRef); if(durable&&durable.status!=="cancelled"&&durable.status!=="settlement_pending"){durable.status="failed";durable.error=String(e.message||"Assistant refused this request.").slice(0,400);durable.providerRefusal=true;await releaseHold(assistantHoldRef);const updated=await persist({...ctx,snapshot:fresh},next);if(e?.status===402||e?.status===403)throw e;return {task:taskPublic(updated.state.studio.tasks[key])};} throw e; }
    }
    if (body.action === "studio.assistant.get" || body.action === "studio.mesh.get" || body.action === "studio.assistant.cancel" || body.action === "studio.mesh.cancel") {
      const type = body.action.includes(".mesh.") ? "mesh" : "assistant", task = Object.values(data.tasks).find(t => t.id === id(body.taskId, "task id") && t.type === type);
      if (!task) throw error(404, "not_found", "Studio task not found.");
      if (body.action.endsWith(".cancel")) {
        if (task.launcherId !== ctx.actor.id) throw denied("Only the task launcher can cancel this generation.");
        if (task.status === "queued" || task.status === "running") {
          const taskKey = Object.keys(data.tasks).find(k => data.tasks[k].id === task.id);
          // a submitted mesh job is cancelled (and its credits returned) only when it really stops
          // at the provider; one already being built keeps running and says so
          if (task.type === "mesh" && task.upstreamId) {
            const stopped = await stopMeshJob(task.upstreamId); await ctx.recheck();
            if (!stopped) { task.message = MESH_NOT_STOPPABLE; const saved = await persist(ctx, state); return { task: taskPublic(saved.state.studio.tasks[taskKey]) }; }
          }
          task.status = "cancelled"; task.message = "Cancelled."; await releaseHold(task.holdRef);
          const saved = await persist(ctx, state); return { task: taskPublic(saved.state.studio.tasks[taskKey]) };
        }
        return { task: taskPublic(task) }; }
      if (type === "assistant" && task.status === "settlement_pending") {
        if (task.launcherId !== ctx.actor.id) return { task: taskPublic(task) };
        const fresh = await ctx.refresh(), next = clone(fresh.state),
          taskKey = Object.keys(studio(next).tasks).find(k => studio(next).tasks[k].id === task.id),
          durable = studio(next).tasks[taskKey];
        if (!durable || durable.status === "completed" || durable.status === "cancelled") {
          return { task: taskPublic(durable || task) };
        }
        if (durable.status !== "settlement_pending") return { task: taskPublic(durable) };
        const delegated = studio(next).delegatedAuth?.[task.launcherId];
        const token = ctx.browserToken || (delegated?.expiresAt > now() ? delegated.token : null);
        if (!token) throw error(401, "billing_authorization_expired", "Open this workspace in a browser again before paid generation.");
        try {
          if (typeof ctx.writeCheck === "function") await ctx.writeCheck();
          await attachAnswer(durable);   // idempotent: ties the hold if the first attach was lost
          await settle(ctx, durable, token); await ctx.recheck();
          durable.status = "completed"; durable.message = "Proposal ready for explicit Apply."; delete durable.error;
          const saved = await persist({ ...ctx, snapshot: fresh }, next);
          return { task: taskPublic(saved.state.studio.tasks[taskKey]) };
        } catch (e) {
          return await recoverTaskResponse(ctx, taskKey, e);
        }
      }
      if (type === "mesh" && task.upstreamId && ["queued","running","settlement_pending"].includes(task.status)) {
        // A collaborator may inspect shared task status but may not consume
        // the launcher's sealed billing authorization or settle its spend.
        if (task.launcherId !== ctx.actor.id) return { task: taskPublic(task) };
        const fresh = await ctx.refresh(), next = clone(fresh.state), taskKey = Object.keys(data.tasks).find(k => data.tasks[k].id === task.id), durable = studio(next).tasks[taskKey];
        if (!durable || durable.status === "completed" || durable.status === "cancelled") {
          return { task: taskPublic(durable || task) };
        }
        if (!["queued","running","settlement_pending"].includes(durable.status)) return { task: taskPublic(durable) };
        const delegated = studio(next).delegatedAuth?.[task.launcherId];
        const token = ctx.browserToken || (delegated?.expiresAt > now() ? delegated.token : null);
        if (!token) throw error(401, "billing_authorization_expired", "Open this workspace in a browser again before paid generation.");
        try {
          if (typeof ctx.writeCheck === "function") await ctx.writeCheck();
          await resolveMesh(durable, { ...ctx, snapshot: fresh }, token);
        }
        catch (e) {
          if (e?.status == null || e?.status === 402 || e?.status === 503 || e?.status === 409 || e?.studioOutputDurable || durable.providerCompleted) {
            durable.status = "settlement_pending"; durable.providerRefusal = false;
            durable.message = "Provider completed; credit settlement can be retried.";
          } else { durable.status = "failed"; durable.providerRefusal = true; }
          durable.error = String(e.message || "Mesh provider refused this request.").slice(0, 400);
        }
        if (durable.asset && !next.studio.workspaces[durable.locationId].assets.some(a => a.id === durable.asset.id)) next.studio.workspaces[durable.locationId].assets.push(durable.asset);
        const saved = await persist({ ...ctx, snapshot: fresh }, next);
        return { task: taskPublic(saved.state.studio.tasks[taskKey]) };
      }
      return { task: taskPublic(task) };
    }
    if (body.action === "studio.asset.get") {
      const work = workspaceFor(state, locationId), asset = work.assets.find(a => a.id === id(body.assetId, "asset id")); if (!asset) throw error(404,"not_found","Studio asset not found.");
      const path = Object.values(data.tasks).find(t => t.asset?.id === asset.id &&
        t.locationId === locationId)?.assetPath; if (!path || typeof adapter?.downloadStudioAsset !== "function") throw error(404,"not_found","Studio asset bytes not found.");
      const bytes = await adapter.downloadStudioAsset(path); validateGlb(bytes); if (bytes.length !== asset.bytes || await sha(bytes) !== asset.sha256) throw error(500,"asset_corrupt","Studio asset integrity check failed."); await ctx.recheck(); return { asset: clone(asset), base64: bytesB64(bytes) };
    }
    if (body.action === "studio.reference.get") {
      const work = workspaceFor(state, locationId), entityId = id(body.entityId, "reference entity id");
      if (!work.references.some(reference => reference.entityId === entityId) || typeof adapter?.getStudioReference !== "function") throw error(404, "not_found", "No authorized generated reference is attached.");
      const reference = await adapter.getStudioReference({ projectId: ctx.projectId, entityId,
        reference: work.references.find(item => item.entityId === entityId) });
      if (!reference || !(reference.bytes instanceof Uint8Array) || reference.bytes.length > MAX_IMAGE ||
        !/^image\/(png|jpeg|webp)$/.test(reference.contentType || "")) throw error(404, "not_found", "No authorized generated reference is attached.");
      await ctx.recheck();
      return { entityId, dataUrl: `data:${reference.contentType};base64,${bytesB64(reference.bytes)}` };
    }
    if (body.action === "studio.preview.publish") {
      const work = workspaceFor(state, locationId);
      if (body.baseRevision !== work.revision) throw conflict();
      const requestId = id(body.requestId, "request id"), previewId = `preview-${requestId}`.slice(0, 128);
      const existing = work.previews.find(preview => preview.id === previewId);
      if (existing) return { preview: clone(existing) };
      const bytes = b64Bytes(body.pngBase64, MAX_IMAGE);
      if (!(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) throw bad("Preview must be a PNG.");
      contract.validateCamera(body.actualCamera);
      if (body.shotId != null && !work.shots.some(shot => shot.id === id(body.shotId, "shot id"))) throw bad("Shot is not in this workspace.");
      if (typeof adapter?.uploadStudioAsset !== "function") throw error(503, "storage_unavailable", "Studio preview storage is unavailable.");
      // readable owner/project folders when valid (2026-09-27), else the legacy key;
      // reads always use the stored data.previewPaths[id], so old previews keep working
      const folders = await resolveStorageFolders(adapter, ctx.access.ownerId, ctx.projectId);
      const digest = await sha(bytes), path = studioPreviewPath(folders, ctx.access.ownerId, ctx.projectId, locationId, previewId);
      await adapter.uploadStudioAsset(path, bytes, "image/png"); await ctx.recheck();
      const preview = { id: previewId, ...(body.shotId ? { shotId: body.shotId } : {}), sha256: digest, bytes: bytes.length, actualCamera: clone(body.actualCamera) };
      work.previews.push(preview); if (!object(data.previewPaths)) data.previewPaths = {}; data.previewPaths[previewId] = path; work.revision++;
      const saved = await persist(ctx, state); return { preview: clone(saved.state.studio.workspaces[locationId].previews.find(item => item.id === previewId)) };
    }
    if (body.action === "studio.board.publish") {
      const work = workspaceFor(state, locationId);
      if (body.baseRevision !== work.revision) throw conflict();
      const requestId = id(body.requestId, "request id");
      if (requestId.length > 64) throw bad("Invalid request id.");
      const shotId = id(body.shotId, "shot id");
      if (!work.shots.some(shot => shot.id === shotId)) throw bad("Shot is not in this workspace.");
      const frames = body.frames;
      if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_BOARD_FRAMES) throw bad(`A board has 1 to ${MAX_BOARD_FRAMES} frames.`);
      const ids = frames.map((f, i) => {
        if (!object(f) || !Number.isInteger(f.frame) || f.frame < 0 || f.frame > 1000000) throw bad("Invalid board frame.");
        return boardPreviewId(requestId, i, frames.length, f.frame);
      });
      if (ids.every(pid => work.previews.some(p => p.id === pid)))
        return { previews: ids.map(pid => clone(work.previews.find(p => p.id === pid))), revision: work.revision };
      let total = 0;
      const decoded = frames.map(f => {
        const bytes = b64Bytes(f.pngBase64, MAX_IMAGE); total += bytes.length;
        if (!(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) throw bad("Board frames must be PNGs.");
        contract.validateCamera(f.actualCamera); return bytes;
      });
      if (total > MAX_BOARD_BYTES) throw error(413, "too_large", "This board is too large; render it smaller.");
      if (work.previews.length + ids.length > 200) throw bad("This workspace has too many previews.");
      if (typeof adapter?.uploadStudioAsset !== "function") throw error(503, "storage_unavailable", "Studio preview storage is unavailable.");
      const folders = await resolveStorageFolders(adapter, ctx.access.ownerId, ctx.projectId);
      if (!object(data.previewPaths)) data.previewPaths = {};
      for (let i = 0; i < ids.length; i++) {
        if (work.previews.some(p => p.id === ids[i])) continue;
        const digest = await sha(decoded[i]), path = studioPreviewPath(folders, ctx.access.ownerId, ctx.projectId, locationId, ids[i]);
        await adapter.uploadStudioAsset(path, decoded[i], "image/png"); await ctx.recheck();
        work.previews.push({ id: ids[i], shotId, sha256: digest, bytes: decoded[i].length, actualCamera: clone(frames[i].actualCamera) });
        data.previewPaths[ids[i]] = path;
      }
      work.revision++;
      const saved = await persist(ctx, state), out = saved.state.studio.workspaces[locationId];
      return { previews: ids.map(pid => clone(out.previews.find(p => p.id === pid))), revision: out.revision };
    }
    if (body.action === "studio.preview.get") {
      const work = workspaceFor(state, locationId), preview = work.previews.find(item => item.id === id(body.previewId, "preview id"));
      const path = data.previewPaths?.[body.previewId]; if (!preview || !path || typeof adapter?.downloadStudioAsset !== "function") throw error(404, "not_found", "Studio preview not found.");
      const bytes = await adapter.downloadStudioAsset(path);
      if (!(bytes instanceof Uint8Array) || bytes.length !== preview.bytes || await sha(bytes) !== preview.sha256) throw error(500, "asset_corrupt", "Studio preview integrity check failed.");
      await ctx.recheck(); return { preview: clone(preview), pngBase64: bytesB64(bytes) };
    }
    throw bad("Unknown studio action.");
  }
  return { actions: studioActions, handle: handler, validateGlb };
}

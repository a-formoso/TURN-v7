/*
 * Supabase-only adapter for relay-core.mjs.  Keeping this file free of a
 * static npm/URL import makes the kernel and this adapter testable in Node:
 * tests pass a recording createClient implementation.  (./storage-paths.mjs is
 * local and pure.)
 */
import { validStorageFolders } from "./storage-paths.mjs";

export function createSupabaseAdapter({
  createClient, url, anonKey, serviceKey, bucket = "turn-assets",
} = {}) {
  if (typeof createClient !== "function" || !url || !anonKey || !serviceKey) {
    throw new Error("Supabase adapter is not configured.");
  }

  const admin = createClient(url, serviceKey);
  let studioBillingReady;
  let studioBillingReadyAt = 0;

  async function getUserByAccessToken(token) {
    const auth = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  }

  async function getUserById(id) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data?.user) return null;
    return data.user;
  }

  async function getProjectAccess(projectId, actor) {
    const projectQuery = await admin.from("turn_projects")
      .select("id,owner").eq("id", projectId).maybeSingle();
    if (projectQuery.error || !projectQuery.data) {
      return { exists: false, ownerId: null, actorId: actor.id, canWrite: false };
    }
    if (projectQuery.data.owner === actor.id) {
      return {
        exists: true, ownerId: projectQuery.data.owner, actorId: actor.id, canRead: true, canWrite: true,
      };
    }
    const members = await admin.from("turn_project_members")
      .select("member_user,member_email,role,status")
      .eq("project_id", projectId).eq("status", "active");
    if (members.error) return { exists: true, ownerId: projectQuery.data.owner,
      actorId: actor.id, canWrite: false };
    const email = String(actor.email || "").toLowerCase();
    const member = (members.data || []).find((row) =>
      row.member_user === actor.id ||
      (email && String(row.member_email || "").toLowerCase() === email));
    return {
      exists: true, ownerId: projectQuery.data.owner, actorId: actor.id,
      canRead: !!member && member.status === "active",
      canWrite: !!member && member.role === "art_director" && member.status === "active",
    };
  }

  // Readable storage folders (2026-09-27) for the project OWNER's account and the
  // project: the service-role RPC from supabase/storage-readable-folders.sql.
  // Returns {account, project} only when both parse back to exactly these ids;
  // null (legacy keys) when the SQL is not installed, execute was revoked (the
  // server kill switch), the call fails or times out, or the answer is wrong.
  async function storageFolders(ownerId, projectId) {
    let timer = null;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); });
      const result = await Promise.race([
        Promise.resolve().then(() => admin.rpc("turn_storage_folders_for", { p_user: ownerId, p_project_id: projectId })),
        timeout,
      ]);
      if (!result || result.error) return null;
      return validStorageFolders(result.data, ownerId, projectId);
    } catch (_error) {
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function getState(projectId, entityId) {
    const result = await admin.from("turn_generations")
      .select("id,project_id,owner,entity_id,storage_path,meta,refs,history")
      .eq("project_id", projectId).eq("entity_id", entityId).maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
  }

  function isDuplicateStorageError(error) {
    const status = Number(error?.statusCode || error?.status);
    if (status === 409) return true;
    return status === 400 &&
      /already exists|duplicate|resource exists/i.test(String(error?.message || ""));
  }

  async function insertState(row) {
    const result = await admin.from("turn_generations").insert(row).select(
      "id,project_id,owner,entity_id,storage_path,meta,refs,history",
    ).single();
    if (result.error) {
      // The core retries the exact namespace after this particular race.  Do
      // not turn any other database failure into a successful state creation.
      if (result.error.code === "23505") {
        const conflict = new Error("state already exists");
        conflict.conflict = true;
        throw conflict;
      }
      throw result.error;
    }
    return result.data;
  }

  async function casState(row, expectedMeta, nextMeta) {
    let query = admin.from("turn_generations").update({ meta: nextMeta })
      .eq("id", row.id).eq("project_id", row.project_id)
      .eq("owner", row.owner).eq("entity_id", row.entity_id)
      .is("storage_path", null).eq("meta", JSON.stringify(expectedMeta))
      .select("id,project_id,owner,entity_id,storage_path,meta,refs,history");
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    return { ok: !!result.data, row: result.data || null };
  }

  async function uploadPng(targetBucket, path, bytes) {
    const result = await admin.storage.from(targetBucket || bucket).upload(
      path, new Blob([bytes], { type: "image/png" }), {
        contentType: "image/png", cacheControl: "60", upsert: false,
      },
    );
    if (result.error) {
      if (isDuplicateStorageError(result.error)) return { created: false };
      throw result.error;
    }
    return { created: true };
  }

  async function createMarker(targetBucket, path, bytes) {
    const result = await admin.storage.from(targetBucket || bucket).upload(
      path, new Blob([bytes], { type: "application/json" }), {
        contentType: "application/json", cacheControl: "31536000", upsert: false,
      },
    );
    if (result.error) {
      if (isDuplicateStorageError(result.error)) return { created: false };
      throw result.error;
    }
    return { created: true };
  }

  async function downloadPng(targetBucket, path) {
    const result = await admin.storage.from(targetBucket || bucket).download(path);
    if (result.error || !result.data) throw result.error || new Error("PNG not found");
    return new Uint8Array(await result.data.arrayBuffer());
  }

  async function readMarker(targetBucket, path) {
    const result = await admin.storage.from(targetBucket || bucket).download(path);
    if (result.error) {
      const status = Number(result.error.statusCode || result.error.status);
      if (status === 404) return null;
      throw result.error;
    }
    if (!result.data) throw new Error("Marker body missing");
    return new Uint8Array(await result.data.arrayBuffer());
  }

  async function removePng(targetBucket, path) {
    const result = await admin.storage.from(targetBucket || bucket).remove([path]);
    if (result.error) throw result.error;
  }

  // Studio files use an ordinary project-owned asset path and are only returned
  // after the relay's authenticated state check.  Internal authority receipts
  // remain in the legacy non-project second-segment namespace above.
  async function uploadStudioAsset(path, bytes, contentType = "model/gltf-binary") {
    const result = await admin.storage.from(bucket).upload(
      path, new Blob([bytes], { type: contentType }), {
        contentType, cacheControl: "31536000", upsert: false,
      },
    );
    if (result.error && !isDuplicateStorageError(result.error)) throw result.error;
    return { created: !result.error };
  }

  async function downloadStudioAsset(path) {
    const result = await admin.storage.from(bucket).download(path);
    if (result.error || !result.data) throw result.error || new Error("Studio asset not found");
    return new Uint8Array(await result.data.arrayBuffer());
  }

  function catalogEntity(doc, entityId, kind) {
    const catalog = kind === "location" ? doc?.locations :
      kind === "character" ? doc?.characters : doc?.props;
    return Array.isArray(catalog) && catalog.some(item => item?.id === entityId);
  }
  function imageType(bytes) {
    if (!(bytes instanceof Uint8Array)) return null;
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 &&
      bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
    return null;
  }
  async function validateStudioReference({ projectId, entityId, kind, version }) {
    if (!["location", "character", "prop"].includes(kind)) return false;
    const project = await admin.from("turn_projects").select("doc").eq("id", projectId).maybeSingle();
    if (project.error || !project.data || !catalogEntity(project.data.doc || {}, entityId, kind)) return false;
    const record = await admin.from("turn_generations")
      .select("project_id,entity_id,storage_path,meta")
      .eq("project_id", projectId).eq("entity_id", entityId).maybeSingle();
    const meta = record.data?.meta;
    // Production location rows carry modelId/requestedModel, prompt, ISO and
    // promptCompiler (not a MIME `meta.kind`). Require a real generated image
    // provenance marker and, when supplied, bind the catalog ref version.
    const provenance = meta && typeof meta === "object" && !meta.uploaded &&
      typeof meta.iso === "string" && Number.isFinite(Date.parse(meta.iso)) &&
      !/upload/i.test(String(meta.modelId || "") + String(meta.requestedModel || "")) &&
      (typeof meta.modelId === "string" && !!meta.modelId ||
        typeof meta.requestedModel === "string" && !!meta.requestedModel);
    if (record.error || !record.data || typeof record.data.storage_path !== "string" || !provenance) return false;
    return version == null || String(version) === String(meta.iso || meta.version);
  }
  async function getStudioReference({ projectId, entityId, reference }) {
    if (!(await validateStudioReference({ projectId, entityId, kind: reference?.kind,
      version: reference?.version }))) return null;
    const record = await admin.from("turn_generations")
      .select("project_id,owner,entity_id,storage_path,meta")
      .eq("project_id", projectId).eq("entity_id", entityId).maybeSingle();
    if (record.error || !record.data || typeof record.data.storage_path !== "string" ||
      (reference?.version != null && String(reference.version) !== String(record.data.meta?.iso))) return null;
    const file = await admin.storage.from(bucket).download(record.data.storage_path);
    if (file.error || !file.data) return null;
    const bytes = new Uint8Array(await file.data.arrayBuffer()), contentType = imageType(bytes);
    return contentType ? { bytes, contentType } : null;
  }

  // This non-spending preflight intentionally uses the launching browser JWT.
  // A paired desktop can only use the sealed, short-lived authorization
  // captured by workspace.open; the JWT is never in a relay response.
  async function authorizeCredit({ token, cost }) {
    if (!token) return { ok: false, message: "Generation authorization expired." };
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // Match image-proxy's server-side entitlement and balance gate before the
    // debit RPC (the RPC itself clamps at zero, so it is not an authorization
    // check). A failed read is a failed authorization, never a free desktop
    // generation.
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user) return { ok: false, message: "Generation authorization expired." };
    const user = authData.user;
    const required = Math.max(1, Math.ceil(Number(cost) || 1));
    // Studio's service-role settlement has no email bypass and never creates a
    // balance row, so its preflight must use the same actual-balance rule.
    const credits = await client.from("turn_credits").select("plan,remaining")
      .eq("owner", user.id).limit(1);
    const row = Array.isArray(credits.data) ? credits.data[0] : credits.data;
    const plan = String(row?.plan || "none").toLowerCase().trim();
    const remaining = Number(row?.remaining) || 0;
    if (!row || (!["writer", "director", "studio"].includes(plan) && remaining <= 0)) {
      return { ok: false, message: "Choose a plan to start creating — every generation runs on your plan's credits." };
    }
    if (remaining < required) return { ok: false, message: `This generation needs ${required} credits, but this account has ${remaining}.` };
    return { ok: true, remaining };
  }

  async function studioBillingReadyProbe() {
    const now = Date.now();
    if (studioBillingReady !== undefined && now - studioBillingReadyAt < (studioBillingReady ? 60000 : 5000)) {
      return studioBillingReady;
    }
    try {
      const { data, error } = await admin.rpc("turn_studio_settle_credit", {
        launcher_uid: null, credit_cost: null, studio_event_id: null,
      });
      const row = Array.isArray(data) ? data[0] : data;
      studioBillingReady = !error && row?.ready === true;
    } catch (_) {
      studioBillingReady = false;
    }
    studioBillingReadyAt = now;
    return studioBillingReady;
  }

  async function spendCredit({ uid, cost, eventId }) {
    // Studio settlement is distinct from legacy browser spend events. The
    // service-role-only RPC atomically checks/debits an already-existing row
    // and checks the private server-generated Studio receipt id; no client can
    // seed the unpredictable id through the legacy browser RPC.
    if (!(await studioBillingReadyProbe())) {
      return { ok: false, unavailable: true,
        message: "Studio atomic credit settlement is not installed." };
    }
    if (typeof uid !== "string" || !uid) return { ok: false, message: "Studio launcher is unavailable." };
    if (!Number.isSafeInteger(cost) || cost <= 0) return { ok: false, message: "Invalid Studio credit cost." };
    const required = cost;
    const { data, error } = await admin.rpc("turn_studio_settle_credit", {
      launcher_uid: uid, credit_cost: required, studio_event_id: eventId,
    });
    if (error) return { ok: false, message: error.message || "Could not settle Studio credits." };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.ready !== true || !Number.isSafeInteger(row.remaining) || row.remaining < 0 ||
      typeof row.plan !== "string") return { ok: false, message: "Invalid Studio settlement response." };
    return { ok: true, remaining: row.remaining, plan: row.plan };
  }

  return {
    getUserByAccessToken,
    getUserById,
    getProjectAccess,
    storageFolders,
    getState,
    insertState,
    casState,
    uploadPng,
    createMarker,
    downloadPng,
    readMarker,
    removePng,
    uploadStudioAsset,
    downloadStudioAsset,
    getStudioReference,
    validateStudioReference,
    authorizeCredit,
    spendCredit,
    studioBillingReady: studioBillingReadyProbe,
    // Kept for injected/offline adapters. Production readiness comes from the
    // non-spending service-role probe above, and fails closed if absent.
    atomicStudioSettlement: true,
  };
}

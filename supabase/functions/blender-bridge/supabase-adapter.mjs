/*
 * Supabase-only adapter for relay-core.mjs.  Keeping this file free of a
 * static npm/URL import makes the kernel and this adapter testable in Node:
 * tests pass a recording createClient implementation.
 */

export function createSupabaseAdapter({
  createClient, url, anonKey, serviceKey, bucket = "turn-assets",
} = {}) {
  if (typeof createClient !== "function" || !url || !anonKey || !serviceKey) {
    throw new Error("Supabase adapter is not configured.");
  }

  const admin = createClient(url, serviceKey);

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
        exists: true, ownerId: projectQuery.data.owner, actorId: actor.id, canWrite: true,
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
      canWrite: !!member && member.role === "art_director" && member.status === "active",
    };
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

  return {
    getUserByAccessToken,
    getUserById,
    getProjectAccess,
    getState,
    insertState,
    casState,
    uploadPng,
    createMarker,
    downloadPng,
    readMarker,
    removePng,
  };
}
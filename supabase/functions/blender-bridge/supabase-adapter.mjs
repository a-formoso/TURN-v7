/*
 * Supabase-only adapter for relay-core.mjs.  Keeping this file free of a
 * static npm/URL import makes the kernel and this adapter testable in Node:
 * tests pass a recording createClient implementation.  (./storage-paths.mjs is
 * local and pure.)
 */
import { validStorageFolders } from "./storage-paths.mjs";

/* A credit count as users read it: whole, with thousands separators ("1,709"; billing round 3,
   S7 — the same rule as image-proxy/billing-policy.mjs formatCredits). */
export function formatCredits(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

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
    // Team (2026-10-03): the database decides — supabase/team-relaunch.sql turn_film_payer() reads
    // the membership by ACCOUNT (an unlinked invite only by a confirmed, unexpired address) and
    // knows whether the owner's plan carries 3D for this role. Edit access = it would bill the
    // owner (or only the budget is used up); a member with another role reads.
    // Team review (2026-10-09; owner decision B): sharing switched off ('paused'; the older SQL's
    // 'off') = read-only for collaborators, and so is a check that fails — only a database without
    // turn_film_payer at all (before team-relaunch.sql) keeps the older rule's writes.
    const fp = await filmPayerAnswer(actor.id, projectId);
    const film = fp.film;
    const code = film ? String(film.code || "") : "";
    if (film && code !== "off") {
      const ok = film.ok === true || film.ok === "true";
      return {
        exists: true, ownerId: projectQuery.data.owner, actorId: actor.id,
        canRead: ok || ["role", "owner_plan", "budget_reached", "paused"].includes(code),
        canWrite: ok || code === "budget_reached",
      };
    }
    const legacyWrites = !film && fp.missing;
    // before team-relaunch.sql: the older rule; switched off (or unconfirmed): the same members, read-only
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
      canWrite: legacyWrites && !!member && member.role === "art_director" && member.status === "active",
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
  // fitBytes: when the original is larger, the storage's resized copy (1568 px long side) is returned instead —
  // still the same generated image, read server-side (studio-service.mjs SOURCE IMAGES, 2026-10-26)
  async function getStudioReference({ projectId, entityId, reference, fitBytes }) {
    if (!(await validateStudioReference({ projectId, entityId, kind: reference?.kind,
      version: reference?.version }))) return null;
    const record = await admin.from("turn_generations")
      .select("project_id,owner,entity_id,storage_path,meta")
      .eq("project_id", projectId).eq("entity_id", entityId).maybeSingle();
    if (record.error || !record.data || typeof record.data.storage_path !== "string" ||
      (reference?.version != null && String(reference.version) !== String(record.data.meta?.iso))) return null;
    const file = await admin.storage.from(bucket).download(record.data.storage_path);
    if (file.error || !file.data) return null;
    let bytes = new Uint8Array(await file.data.arrayBuffer());
    if (Number(fitBytes) > 0 && bytes.length > Number(fitBytes)) {
      const fitted = await admin.storage.from(bucket).download(record.data.storage_path,
        { transform: { width: 1568, height: 1568, resize: "contain", quality: 85 } });
      if (fitted.error || !fitted.data) return null;
      bytes = new Uint8Array(await fitted.data.arrayBuffer());
    }
    const contentType = imageType(bytes);
    return contentType ? { bytes, contentType } : null;
  }

  // This preflight intentionally uses the launching browser JWT for the plan read: a paired
  // desktop can only use the sealed, short-lived authorization captured by workspace.open; the JWT
  // is never in a relay response.
  //
  // BILLING FIXES (2026-09-30): the old gate ("a paid plan OR a balance above 0") is replaced by
  //   - the PLAN: Blender Studio lives in the Art Room (Locations), so Director and up; a trial or
  //     no-plan account (including one holding pack credits) and a frozen account are refused;
  //   - a HOLD of the job's credits (service role, turn_hold_credits, ref "studio:<event id>")
  //     before any provider work. The hold ref is returned so settlement settles THAT hold and a
  //     failed or cancelled job releases it. When the hold functions are not installed yet
  //     (billing-v2.sql not run), the older balance check stands and settlement debits through
  //     turn_studio_settle_credit as before (atomic: it never overspends).
  const STUDIO_PLANS = new Set(["director", "pro", "studio"]);
  function rpcObject(data, name) {
    let r = data;
    if (typeof r === "string") { try { r = JSON.parse(r); } catch (_) { return null; } }
    if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
    if (r && typeof r === "object" && r[name] && typeof r[name] === "object") r = r[name];
    return r && typeof r === "object" ? r : null;
  }
  const missingFunction = (e) => /PGRST202|42883|could not find the function|does not exist/i.test(String((e && (e.code || "")) + " " + (e && e.message || "")));
  // On someone else's film the OWNER pays (Team, 2026-10-03; image-proxy/film-payer.mjs): the
  // owner's plan gates 3D and the hold comes from the owner's balance within the collaborator's
  // monthly budget (turn_hold_credits_for_film).
  // Team review (2026-10-09; owner decision C): what can't be confirmed is REFUSED in plain words —
  // a role without 3D (film_role), sharing switched off (team_paused), a failed or unreadable check
  // (film_unverified) — never billed to the collaborator. Only a non-member (their own spend), or a
  // database without turn_film_payer (before team-relaunch.sql), bills the caller. A film the ADMIN
  // owns is gated as the admin's (no plan needed; its holds still come from that balance). The same
  // words as image-proxy/film-payer.mjs.
  // Stage editor review (2026-10-09; owner decision E): a real film the caller isn't on
  // ('not_member') is refused too (film_access, 403), never billed to the caller — only a film id
  // that names no film ('no_film') is; and one 3D job bigger than what's left of the budget says so
  // (budgetMessage with `needed`), "You've used…" only when the budget is used up.
  const FILM_REFUSALS = {
    owner_plan: "The film's owner's plan doesn't include shared work right now, so generating on this film is paused.",
    owner_insufficient: "The film's owner doesn't have enough credits for this right now.",
    film_role: "Your role on this film doesn't include this.",
    film_unverified: "Couldn't confirm who pays for work on this film. Try again in a moment.",
    team_paused: "Sharing is paused on this film right now, so it's read-only for collaborators.",
    film_access: "You're not on this film's team right now, so work on it can't be charged to it.",
  };
  const ADMIN_EMAILS = ["admin@infinitestudioai.com"];
  const budgetMessage = (budget, spent, needed = null) => {
    const b = Math.max(0, Math.floor(Number(budget) || 0)), s = Math.max(0, Math.floor(Number(spent) || 0));
    const n = needed == null || !Number.isFinite(Number(needed)) ? 0 : Math.floor(Number(needed));
    return n > 0 && s < b
      ? `This needs about ${formatCredits(n)} credits, and your budget on this film has ${formatCredits(b - s)} left this month. The film's owner can raise it.`
      : `You've used this month's credit budget on this film (${formatCredits(s)} of ${formatCredits(b)}). The film's owner can raise it.`;
  };
  const budgetRefusal = (d, needed) => {
    const b = Math.max(0, Math.floor(Number(d && d.budget) || 0)), s = Math.max(0, Math.floor(Number(d && d.spent) || 0));
    const n = d && d.needed != null && Number.isFinite(Number(d.needed)) ? Math.floor(Number(d.needed)) : needed;
    return { ok: false, code: "budget_reached", budget: b, spent: s, ...(n > 0 ? { needed: n } : {}), message: budgetMessage(b, s, n) };
  };
  const filmRefusal = (code) => ({ ok: false, code, message: FILM_REFUSALS[code] });
  /** The answer of turn_film_payer for 3D: { film } (parsed, or null when unreadable), { error, missing }. */
  async function filmPayerAnswer(actorId, projectId) {
    try {
      const r = await admin.rpc("turn_film_payer", { p_actor: actorId, p_project: projectId, p_kind: "3d" });
      if (r && r.error) return { film: null, error: true, missing: missingFunction(r.error) };
      return { film: rpcObject(r && r.data, "turn_film_payer"), error: false, missing: false };
    } catch (e) {
      return { film: null, error: true, missing: missingFunction(e) };
    }
  }
  async function filmPayer(actorId, projectId, ownerId) {
    if (!projectId || !ownerId || ownerId === actorId) return null;
    return filmPayerAnswer(actorId, projectId);
  }
  /** A film hold's refusal (turn_hold_credits_for_film codes), in the collaborator's words.
      `amount`: what the hold asked for (the budget's `needed` when the database doesn't say). */
  function filmHoldRefusal(h, amount = null) {
    const code = String((h && h.code) || "insufficient").toLowerCase();
    if (code === "budget_reached") return budgetRefusal(h, amount);
    if (code === "paused" || code === "off") return filmRefusal("team_paused");
    if (code === "role") return filmRefusal("film_role");
    if (code === "not_member") return filmRefusal("film_access");
    if (code === "owner_plan" || code === "frozen") return filmRefusal("owner_plan");
    if (code === "insufficient") return filmRefusal("owner_insufficient");
    return filmRefusal("film_unverified");
  }
  /** Hold on the OWNER's balance for a collaborator's 3D call (p_kind named; asked again without it
      on a database whose function has no p_kind yet). */
  async function holdForFilm({ owner, actor, memberId, projectId, amount, ref, reason }) {
    const args = { p_owner: owner, p_actor: actor, p_member: memberId, p_project: projectId, amount, ref, reason };
    let held;
    try { held = await admin.rpc("turn_hold_credits_for_film", { ...args, p_kind: "3d" }); }
    catch (e) { held = { error: e }; }
    if (held && held.error && /PGRST202/i.test(String((held.error.code || "") + " " + (held.error.message || "")))) {
      try { held = await admin.rpc("turn_hold_credits_for_film", args); }
      catch (e) { held = { error: e }; }
    }
    return held && !held.error ? rpcObject(held.data, "turn_hold_credits_for_film") : null;
  }
  async function authorizeCredit({ token, cost, eventId, projectId = null, ownerId = null }) {
    if (!token) return { ok: false, message: "Generation authorization expired." };
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user) return { ok: false, message: "Generation authorization expired." };
    const user = authData.user;
    const required = Math.max(1, Math.ceil(Number(cost) || 1));
    const answer = await filmPayer(user.id, projectId, ownerId);
    // the check failed: refused — unless turn_film_payer isn't installed (then the caller, as before)
    if (answer && answer.error && !answer.missing) return filmRefusal("film_unverified");
    if (answer && !answer.error && !answer.film) return filmRefusal("film_unverified");
    const fp = answer && answer.film;
    if (fp && (fp.ok === false || fp.ok === "false")) {
      const code = String(fp.code || "");
      if (code === "owner_plan") return filmRefusal("owner_plan");
      if (code === "budget_reached") return budgetRefusal(fp, required);
      if (code === "paused" || code === "off") return filmRefusal("team_paused");
      if (code === "role") return filmRefusal("film_role");
      if (code === "not_member") return filmRefusal("film_access");   // (Stage editor review, 2026-10-09)
      if (code !== "no_film") return filmRefusal("film_unverified");
      // no such film: the caller's own spend, below
    }
    if (fp && (fp.ok === true || fp.ok === "true") && !(fp.own === true || fp.own === "true")) {
      if (!fp.payer || !fp.member_id) return filmRefusal("film_unverified");
      let ownerIsAdmin = false;
      try { const ou = await getUserById(fp.payer); ownerIsAdmin = !!ou && ADMIN_EMAILS.includes(String(ou.email || "").toLowerCase()); }
      catch (_) { ownerIsAdmin = false; }
      const owned = await admin.from("turn_credits").select("plan,remaining,frozen,payment_status").eq("owner", fp.payer).limit(1);
      const orow = Array.isArray(owned.data) ? owned.data[0] : owned.data;
      if (owned.error || (!orow && !ownerIsAdmin)) return { ok: false, code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." };
      if (!ownerIsAdmin && (orow.frozen === true || !STUDIO_PLANS.has(String(orow.plan || "").toLowerCase().trim())))
        return filmRefusal("owner_plan");
      if ((Number(orow && orow.remaining) || 0) < required) return filmRefusal("owner_insufficient");
      if (!eventId) return { ok: true, remaining: null };
      const ref = `studio:${eventId}`;
      const h = await holdForFilm({ owner: fp.payer, actor: user.id, memberId: fp.member_id, projectId, amount: required, ref, reason: "blender-studio" });
      if (!h) return { ok: false, code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." };
      if (h.ok === false || h.ok === "false") return filmHoldRefusal(h, required);
      return { ok: true, remaining: null, holdRef: ref };   // the owner's balance is never shown to a collaborator
    }
    // turn_credit_balance() (billing-v2.sql) carries frozen / trial; the older row is the fallback.
    // A failed read is a failed authorization, never a free desktop generation.
    let row = null;
    try {
      const bal = await client.rpc("turn_credit_balance");
      row = !bal.error ? (Array.isArray(bal.data) ? bal.data[0] : bal.data) : null;
    } catch (_) { row = null; }
    if (!row) {
      const credits = await client.from("turn_credits").select("plan,remaining").eq("owner", user.id).limit(1);
      row = Array.isArray(credits.data) ? credits.data[0] : credits.data;
    }
    const plan = String(row?.plan || "none").toLowerCase().trim();
    const remaining = Number(row?.remaining) || 0;
    if (!row) return { ok: false, code: "plan_required", message: "3D needs a paid plan. Choose a plan to start creating." };
    if (row.frozen === true) return { ok: false, code: "account_frozen", message: "Your account is on hold while a payment is disputed, so spending credits is paused." };
    if (!STUDIO_PLANS.has(plan)) {
      return plan === "writer"
        ? { ok: false, code: "tier_required", message: "Blender Studio needs the Director plan." }
        : { ok: false, code: "plan_required", message: "3D needs a paid plan. Without a plan, credits cover writing on the default engines and draft images." };
    }
    if (remaining < required) return { ok: false, code: "insufficient_credits", message: `This generation needs ${formatCredits(required)} credits, but this account has ${formatCredits(remaining)}.` };
    if (!eventId) return { ok: true, remaining };
    // the HOLD — atomic and idempotent per ref, so a retried submit holds once
    const ref = `studio:${eventId}`;
    let held;
    try { held = await admin.rpc("turn_hold_credits", { uid: user.id, amount: required, ref, reason: "blender-studio" }); }
    catch (e) { held = { error: e }; }
    if (held?.error) {
      if (missingFunction(held.error)) return { ok: true, remaining };   // before billing-v2.sql: the older settlement
      return { ok: false, code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." };
    }
    const h = rpcObject(held.data, "turn_hold_credits");
    if (!h) return { ok: false, code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." };
    if (h.ok === false) {
      const code = String(h.code || "insufficient").toLowerCase();
      if (code === "frozen") return { ok: false, code: "account_frozen", message: "Your account is on hold while a payment is disputed, so spending credits is paused." };
      const left = Number.isFinite(Number(h.remaining)) ? Number(h.remaining) : remaining;
      return { ok: false, code: "insufficient_credits", message: `This generation needs ${formatCredits(required)} credits, but this account has ${formatCredits(left)}.` };
    }
    return { ok: true, remaining: Number.isFinite(Number(h.remaining)) ? Number(h.remaining) : remaining, holdRef: ref };
  }

  // THE LIVE CREDIT UNIT (USD of provider cost per credit), from turn_credit_regime()
  // (billing-v2.sql): $0.03 until supabase/billing-switch.sql runs, $0.01 after — so this bridge can
  // ship before the switch day and flips with it. A switched answer is kept for the instance's life
  // (the switch never goes back); a pre-switch one is re-read every 30 s. Before billing-v2.sql the
  // function does not exist, which can only mean the old unit. Anything else unreadable → null (the
  // service then refuses paid work rather than guess).
  const CREDIT_UNITS = [0.01, 0.03];
  let regime = null;
  async function creditUnit() {
    const at = Date.now();
    if (regime && (regime.switched || at - regime.at < 30000)) return regime.unit;
    try {
      const { data, error } = await admin.rpc("turn_credit_regime");
      if (error) {
        if (missingFunction(error)) { regime = { unit: 0.03, switched: false, at }; return 0.03; }
        return regime ? regime.unit : null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const u = Number(row && row.usd_per_credit);
      const unit = CREDIT_UNITS.find((k) => Math.abs(k - u) < 1e-9);
      if (!unit) return regime ? regime.unit : null;
      regime = { unit, switched: unit === 0.01, at };
      return unit;
    } catch (_) {
      return regime ? regime.unit : null;
    }
  }

  async function releaseCredit({ holdRef }) {
    if (typeof holdRef !== "string" || !holdRef) return { ok: false };
    const { error } = await admin.rpc("turn_release_hold", { ref: holdRef });
    return { ok: !error };
  }

  // Ties a mesh hold to the provider's job id (turn_hold_attach, billing-v2.sql) so the
  // housekeeping job never releases it while the provider may still finish the job.
  async function attachHold({ holdRef, providerRef }) {
    if (typeof holdRef !== "string" || !holdRef || typeof providerRef !== "string" || !providerRef) return { ok: false };
    try {
      const { data, error } = await admin.rpc("turn_hold_attach", { ref: holdRef, provider_ref: providerRef });
      if (error) return { ok: false, unavailable: missingFunction(error) };
      const row = rpcObject(data, "turn_hold_attach");
      return { ok: !!row && row.ok !== false, code: row && row.code ? String(row.code) : "" };
    } catch (_) {
      return { ok: false };
    }
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

  const settleRef = async (ref, cost) => {
    const { data, error } = await admin.rpc("turn_settle_hold", { ref, actual: cost });
    if (error) return { error };
    return { row: rpcObject(data, "turn_settle_hold") };
  };
  const settled = (row) => ({ ok: true, remaining: Number.isSafeInteger(Number(row.remaining)) ? Number(row.remaining) : null, plan: typeof row.plan === "string" ? row.plan : null });
  const wasReleased = (row) => !!row && row.ok === false && (String(row.code || "") === "released" || String(row.status || "") === "released");

  async function spendCredit({ uid, cost, eventId, holdRef }) {
    // A HELD job (2026-09-30) settles its own hold: min(cost, held) is kept, the rest released.
    // Idempotent per ref, so a retried settlement never charges twice.
    if (typeof holdRef === "string" && holdRef) {
      if (!Number.isSafeInteger(cost) || cost <= 0) return { ok: false, message: "Invalid Studio credit cost." };
      const first = await settleRef(holdRef, cost);
      if (first.error) return { ok: false, unavailable: missingFunction(first.error), message: "Could not settle Studio credits." };
      if (first.row && first.row.ok !== false) return settled(first.row);
      if (!wasReleased(first.row)) return { ok: false, message: "Could not settle Studio credits." };
      // ROUND 2 (2026-09-30): the hold was already given back (the housekeeping release, or a
      // rollback) although the provider did the work. Instead of failing on every retry forever,
      // the job's ACTUAL cost is held again under a derived ref and settled — idempotent per ref,
      // so concurrent retries charge once. A derived ref that was itself released moves on to the
      // next (at most three).
      if (typeof uid !== "string" || !uid) return { ok: false, message: "Studio launcher is unavailable." };
      // TEAM REVIEW (2026-10-09): a hold the film's OWNER paid is re-held for the owner, through the
      // collaborator's budget (turn_hold_credits_for_film) — never on the launcher's own account.
      // Who paid is read from the original hold's row (team-relaunch.sql's actor / member_id /
      // project_id); a read that fails leaves the task retryable instead of guessing.
      let orig;
      try { orig = await admin.from("turn_credit_holds").select("owner,actor,member_id,project_id").eq("ref", holdRef).limit(1); }
      catch (e) { orig = { error: e }; }
      if (!orig || orig.error) return { ok: false, message: "Could not settle Studio credits." };
      const origRow = Array.isArray(orig.data) ? orig.data[0] : orig.data;
      const ownerPaid = !!origRow && !!origRow.member_id && !!origRow.actor && !!origRow.owner && origRow.owner !== origRow.actor;
      for (let n = 1; n <= 3; n++) {
        const ref = n === 1 ? `${holdRef}:rehold` : `${holdRef}:rehold${n}`;
        if (ownerPaid) {
          const fh = await holdForFilm({ owner: String(origRow.owner), actor: String(origRow.actor), memberId: String(origRow.member_id),
            projectId: String(origRow.project_id || ""), amount: cost, ref, reason: "blender-studio:rehold" });
          if (!fh) return { ok: false, message: "Could not settle Studio credits." };
          if (fh.ok === false || fh.ok === "false") {
            if (String(fh.code || "").toLowerCase() === "released") continue;
            const why = filmHoldRefusal(fh, cost);
            return { ok: false, code: why.code, message: why.message };
          }
          const again = await settleRef(ref, cost);
          if (again.error) return { ok: false, unavailable: missingFunction(again.error), message: "Could not settle Studio credits." };
          // the owner's balance and plan are never handed back for a collaborator's job
          if (again.row && again.row.ok !== false) return { ok: true, remaining: null, plan: null };
          if (!wasReleased(again.row)) return { ok: false, message: "Could not settle Studio credits." };
          continue;
        }
        let held;
        try { held = await admin.rpc("turn_hold_credits", { uid, amount: cost, ref, reason: "blender-studio:rehold" }); }
        catch (e) { held = { error: e }; }
        if (held?.error) return { ok: false, unavailable: missingFunction(held.error), message: "Could not settle Studio credits." };
        const h = rpcObject(held.data, "turn_hold_credits");
        if (!h) return { ok: false, message: "Could not settle Studio credits." };
        if (h.ok === false) {
          const code = String(h.code || "").toLowerCase();
          if (code === "released") continue;
          if (code === "frozen") return { ok: false, message: "Your account is on hold while a payment is disputed, so spending credits is paused." };
          const left = Number.isFinite(Number(h.remaining)) ? Number(h.remaining) : null;
          return { ok: false, message: `This generation needs ${formatCredits(cost)} credits${left != null ? `, but this account has ${formatCredits(left)}` : ""}. Add credits, then open it again.` };
        }
        const again = await settleRef(ref, cost);
        if (again.error) return { ok: false, unavailable: missingFunction(again.error), message: "Could not settle Studio credits." };
        if (again.row && again.row.ok !== false) return settled(again.row);
        if (!wasReleased(again.row)) return { ok: false, message: "Could not settle Studio credits." };
      }
      return { ok: false, message: "Could not settle Studio credits." };
    }
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
    if (error) return { ok: false, message: "Could not settle Studio credits." };
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
    releaseCredit,
    attachHold,
    creditUnit,
    studioBillingReady: studioBillingReadyProbe,
    // Kept for injected/offline adapters. Production readiness comes from the
    // non-spending service-role probe above, and fails closed if absent.
    atomicStudioSettlement: true,
  };
}

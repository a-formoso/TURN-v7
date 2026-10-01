import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createBlenderRelay } from "./relay-core.mjs";
import { createSupabaseAdapter } from "./supabase-adapter.mjs";
import { createStudioService } from "./studio-service.mjs";
import studioContract from "./studio-contract-module.mjs";
import { sceneBuilderProviderPrompt } from "./studio-provider-prompt.mjs";
// Housekeeping (billing fixes, round 2): POST {"op":"reconcile_holds"} settles or releases the
// holds of Studio jobs nobody came back to — see studio-reconcile.mjs.
import { RECONCILE_OP, meshResultState, reconcileStudioHolds } from "./studio-reconcile.mjs";
// The build/deploy step copies app/blender-contract.js here.  It is intentionally
// not reimplemented in the relay: browser and server must freeze the same schema.
import * as contractModule from "./shared-contract.js";

const env = (name: string) => Deno.env.get(name) ?? "";
const url = env("SUPABASE_URL");
const anonKey = env("SUPABASE_ANON_KEY");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

const importedContract = (contractModule as {
  default?: Record<string, unknown>;
  BlenderContract?: Record<string, unknown>;
});
const contract = importedContract.default || importedContract.BlenderContract ||
  (globalThis as typeof globalThis & { BlenderContract?: Record<string, unknown> }).BlenderContract ||
  importedContract;
const falKey = env("FAL_KEY");
const assistantKeys = {
  "claude-fable-5": env("ANTHROPIC_API_KEY"),
  "claude-opus-5": env("ANTHROPIC_API_KEY"),
  "gpt-6-astra": env("OPENAI_API_KEY"),
  "gpt-5.5-2026-04-23": env("OPENAI_API_KEY"),
};

// Provider transport is intentionally kept server-side.  It does not expose
// a provider job URL or key through the relay.  The exact queue host/path
// checks are mirrored in studio-service before any output download.
const provider = {
  available: !!(falKey || Object.values(assistantKeys).some(Boolean)),
  models: Object.fromEntries(Object.entries(assistantKeys).map(([id, key]) => [id, !!key])),
  verifiedModels: {},
  meshConfigured: !!falKey,
  meshVerified: false,
  async submitMesh(input: Record<string, unknown>) {
    if (!falKey) throw new Error("Meshy is not configured.");
    const endpoint = input.endpoint === "meshy/v7/image-to-3d"
      ? "meshy/v7/image-to-3d" : "meshy/v7/text-to-3d";
    const payload: Record<string, unknown> = {
      mode: "full", target_polycount: input.target_polycount,
      enable_rigging: input.enable_rigging, enable_animation: input.enable_animation,
      animation_action_id: input.animation_action_id,
    };
    if (endpoint.endsWith("image-to-3d")) {
      const image = input.image as Uint8Array | undefined;
      if (!image) throw new Error("Mesh image is required.");
      let binary = ""; for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
      payload.image_url = `data:image/png;base64,${btoa(binary)}`;
    } else payload.prompt = input.prompt;
    const response = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: "POST", headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("Mesh provider refused this request.");
    const json = await response.json();
    return { requestId: json.request_id || json.requestId || json.id };
  },
  async getMesh(requestId: string) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) throw new Error("Invalid provider request.");
    const response = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}/status`, {
      headers: { Authorization: `Key ${falKey}` },
    });
    if (!response.ok) throw new Error("Mesh provider status failed.");
    const json = await response.json();
    // fal's queue says IN_QUEUE / IN_PROGRESS / COMPLETED; studio-service reads queued / running /
    // completed / failed. (Passing "in_progress" through used to read as a finished job with no
    // GLB: the task failed and its hold was released while fal went on building the mesh.)
    const raw = String(json.status || "").toUpperCase();
    if (raw === "IN_QUEUE") return { status: "queued" };
    if (raw === "IN_PROGRESS") return { status: "running" };
    if (raw === "COMPLETED" && typeof json.error === "string" && json.error) return { status: "failed", error: json.error };
    if (raw !== "COMPLETED") return { status: /^(FAILED|ERROR|CANCELLED|CANCELED)$/.test(raw) ? "failed" : "running" };
    // Fal queue result URLs stay server-side; studio-service validates output
    // URL host and GLB bytes before persistence.
    const result = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Key ${falKey}` } });
    if (!result.ok) throw new Error("Mesh provider result failed.");
    return { status: "completed", ...(await result.json()) };
  },
  // The queue's own word on a mesh job, for the housekeeping reconciliation: "queued" | "running" |
  // "completed" | "failed" | "not_found" (fal has no such request) | "unknown" (a transient
  // failure: the job is left for the next run). ROUND 3 (S3): on COMPLETED it fetches the RESULT
  // and says "completed" only when it holds a GLB on a trusted fal host (meshResultState — the
  // launcher's own check); a result without one, or one fal refuses (4xx), is "failed"; a result
  // fal can't serve right now (429 / 5xx / timeout) is "unknown".
  async meshStatus(requestId: string) {
    if (!falKey || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) return { state: "unknown" };
    try {
      const response = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}/status`, {
        headers: { Authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) { try { await response.body?.cancel(); } catch (_e) { /* noop */ } return { state: "not_found" }; }
      if (!response.ok) { try { await response.body?.cancel(); } catch (_e) { /* noop */ } return { state: "unknown" }; }
      const json = await response.json();
      const raw = String(json?.status || "").toUpperCase();
      if (raw === "IN_QUEUE") return { state: "queued" };
      if (/^(FAILED|ERROR|CANCELLED|CANCELED)$/.test(raw)) return { state: "failed" };
      if (raw !== "COMPLETED") return { state: "running" };
      if (typeof json.error === "string" && json.error) return { state: "failed" };
      const result = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) {
        try { await result.body?.cancel(); } catch (_e) { /* noop */ }
        if (result.status === 404) return { state: "not_found" };
        return { state: result.status === 408 || result.status === 429 || result.status >= 500 ? "unknown" : "failed" };
      }
      return { state: meshResultState(await result.json().catch(() => null)) };
    } catch (_e) {
      return { state: "unknown" };
    }
  },
  // { cancelled: true } only when fal accepted the cancellation (fal's queue cancel is a PUT; it
  // answers 202 for a job still in the queue and 400 once the job has completed)
  async cancelMesh(requestId: string) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) return { cancelled: false };
    try {
      const response = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}/cancel`, { method: "PUT", headers: { Authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(10000) });
      try { await response.body?.cancel(); } catch (_e) { /* noop */ }
      return { cancelled: response.status >= 200 && response.status < 300 };
    } catch (_e) {
      return { cancelled: false };
    }
  },
  async fetchFile(fileUrl: string, max: number) {
    const response = await fetch(fileUrl);
    const length = Number(response.headers.get("content-length") || 0);
    if (!response.ok || (length && length > max)) throw new Error("Provider asset download failed.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > max) throw new Error("Provider asset is too large.");
    return { bytes };
  },
  async submitAssistant(input: Record<string, unknown>) {
    const modelId = String(input.modelId || "");
    const key = assistantKeys[modelId as keyof typeof assistantKeys];
    if (!key) throw new Error("Selected assistant model is unavailable.");
    // Models remain exact caller choices: no fallback or provider/model
    // substitution.  The assistant must return a bounded JSON proposal.
    const prompt = sceneBuilderProviderPrompt({ mode: input.mode, prompt: input.prompt,
      workspace: input.workspace });
    const image = input.image as Uint8Array | undefined;
    let imageDataUrl: string | null = null;
    if (image) {
      const type = /^image\/(png|jpeg|webp)$/.test(String(input.imageType || ""))
        ? String(input.imageType) : "image/png";
      let binary = ""; for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
      imageDataUrl = `data:${type};base64,${btoa(binary)}`;
    }
    if (modelId.startsWith("claude-")) {
      const content: unknown = imageDataUrl ? [
        { type: "image", source: { type: "base64", media_type: String(input.imageType), data: imageDataUrl.split(",")[1] } },
        { type: "text", text: prompt },
      ] : prompt;
      // 380 s, under the Edge wall clock: a slow answer throws, so the task's hold is released (repair F11)
      const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(380000), headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: modelId, max_tokens: 2048, messages: [{ role: "user", content }] }) });
      if (!response.ok) throw new Error("Assistant provider refused this request.");
      const json = await response.json();
      const proposal = JSON.parse(String(json.content?.[0]?.text || ""));
      return { proposal, usage: {
        inputTokens: Number(json.usage?.input_tokens || 0),
        outputTokens: Number(json.usage?.output_tokens || 0),
      } };
    }
    const inputContent: unknown = imageDataUrl ? [{ role: "user", content: [
      { type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl },
    ] }] : prompt;
    // max_output_tokens bounds the reply (reasoning included) so the credit hold taken before
    // this call (studio-service.mjs assistantHoldCredits / ASSISTANT_MAX_OUTPUT_TOKENS) covers its
    // whole cost; 16,000 leaves a reasoning model room to think and still answer
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: AbortSignal.timeout(380000), headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: modelId, input: inputContent, max_output_tokens: 16000 }) });
    if (!response.ok) throw new Error("Assistant provider refused this request.");
    const json = await response.json();
    const proposal = JSON.parse(String(json.output_text || ""));
    return { proposal, usage: {
      inputTokens: Number(json.usage?.input_tokens || 0),
      outputTokens: Number(json.usage?.output_tokens || 0),
    } };
  },
};
const relay = (url && anonKey && serviceKey)
  ? createBlenderRelay({
    adapter: createSupabaseAdapter({
      createClient, url, anonKey, serviceKey,
    }),
    contract,
    studio: createStudioService({
      contract: studioContract, provider,
      adapter: createSupabaseAdapter({ createClient, url, anonKey, serviceKey }),
    }),
    serverSecret: serviceKey,
  })
  : null;

/* HOUSEKEEPING (billing fixes, round 2, 2026-09-30): pg_cron + pg_net POST {"op":"reconcile_holds"}
   here every 10 minutes with NO auth (supabase/billing-housekeeping-cron.sql; this function is
   deployed --no-verify-jwt). Throttled in the database, bounded, idempotent, and it answers counts
   only — so it is harmless whoever calls it. Only a small body is looked at. */
async function reconcileRequest(request: Request): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const len = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > 4096) return null;
  let peek: Record<string, unknown> | null = null;
  try { peek = JSON.parse(await request.clone().text()); } catch (_e) { return null; }
  if (!peek || typeof peek !== "object" || Array.isArray(peek) || peek.op !== RECONCILE_OP) return null;
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!url || !serviceKey) return reply({ ok: false, error: "Not configured." }, 503);
  try {
    const svc = createClient(url, serviceKey);
    const r = await reconcileStudioHolds({
      rpc: (name: string, args: Record<string, unknown>) => svc.rpc(name, args),
      meshStatus: falKey ? (id: string) => provider.meshStatus(id) : null,
      log: (m: string) => console.warn("[blender-bridge] " + m),
    });
    return reply(r.body, r.status);
  } catch (e) {
    console.warn("[blender-bridge] [billing] reconcile failed: " + String((e as Error)?.message || e).slice(0, 200));
    return reply({ ok: false, error: "The reconciliation didn't finish." }, 500);
  }
}

Deno.serve(async (request) => {
  const housekeeping = await reconcileRequest(request);
  if (housekeeping) return housekeeping;
  if (!relay) {
    return new Response(JSON.stringify({
      error: "Blender relay is not configured.", code: "misconfigured",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return relay.handle(request);
});

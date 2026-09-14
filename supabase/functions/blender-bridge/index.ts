import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createBlenderRelay } from "./relay-core.mjs";
import { createSupabaseAdapter } from "./supabase-adapter.mjs";
import { createStudioService } from "./studio-service.mjs";
import studioContract from "./studio-contract-module.mjs";
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
    if (json.status !== "COMPLETED" && json.status !== "completed") return { status: String(json.status || "queued").toLowerCase() };
    // Fal queue result URLs stay server-side; studio-service validates output
    // URL host and GLB bytes before persistence.
    const result = await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Key ${falKey}` } });
    if (!result.ok) throw new Error("Mesh provider result failed.");
    return { status: "completed", ...(await result.json()) };
  },
  async cancelMesh(requestId: string) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) return;
    await fetch(`https://queue.fal.run/meshy/v7/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", headers: { Authorization: `Key ${falKey}` } });
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
    const prompt = `Return JSON only: {"summary":string,"ops":array}. Never return code. ${String(input.prompt || "")}`;
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
      const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: modelId, max_tokens: 2048, messages: [{ role: "user", content }] }) });
      if (!response.ok) throw new Error("Assistant provider refused this request.");
      const json = await response.json(); return json.content?.[0]?.text || "";
    }
    const inputContent: unknown = imageDataUrl ? [{ role: "user", content: [
      { type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl },
    ] }] : prompt;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: modelId, input: inputContent }) });
    if (!response.ok) throw new Error("Assistant provider refused this request.");
    const json = await response.json(); return json.output_text || "";
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

Deno.serve(async (request) => {
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
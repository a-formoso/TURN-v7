import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createBlenderRelay } from "./relay-core.mjs";
import { createSupabaseAdapter } from "./supabase-adapter.mjs";
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
const relay = (url && anonKey && serviceKey)
  ? createBlenderRelay({
    adapter: createSupabaseAdapter({
      createClient, url, anonKey, serviceKey,
    }),
    contract,
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
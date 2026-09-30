// ── MANAGE PLAN — Stripe Customer Portal sessions (signed-in users) ─────────
// Owner request 2026-09-30: the dashboard's Customer Portal activation page
// would not save, so the portal is configured and opened through the API
// instead. Thin Deno wrapper; every rule lives in ./core.mjs (no imports,
// tested offline by scripts/test-billing-portal.mjs).
//
// This file only: answers CORS, hands method + Authorization + Origin to
// core.handle() (405 / 401 / 409 / 500 / 502 are decided there), and injects
// three adapters:
//   getUser        the anon client's auth.getUser(<the caller's JWT>): the
//                  user always comes from the token, never from the body
//                  (which is not read at all)
//   customerIdFor  the service-role client reads
//                  public.turn_credits.stripe_customer_id for that user (the
//                  mapping stripe-webhook stored on the first purchase)
//   stripe         billingPortal.configurations.list / .create and
//                  billingPortal.sessions.create (stripe@16, like the webhook)
//
// Secrets: STRIPE_SECRET_KEY (already set for stripe-webhook). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// No SQL, no new secret, no dashboard step: the first call creates Kinolot's
// portal configuration (metadata app=kinolot; plan switching off, cancel at
// the end of the period, invoices and card updates on) and later calls reuse it.
//
// Deploy (Mac, owner approval required). JWT verification stays ON: do NOT
// pass --no-verify-jwt; only signed-in callers reach this code.
//   npx -y supabase@latest functions deploy billing-portal --project-ref vubenblfdzginlqiglzw --use-api

import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createBillingPortal } from "./core.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const env = (name: string) => Deno.env.get(name) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const STRIPE_KEY = env("STRIPE_SECRET_KEY");
const CONFIGURED = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY && STRIPE_KEY);

const stripe = CONFIGURED ? new Stripe(STRIPE_KEY, { timeout: 20_000, maxNetworkRetries: 1 }) : null;
// deno-lint-ignore no-explicit-any
let service: any = null;
const svc = () =>
  (service ??= createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));

const app = createBillingPortal({
  configured: CONFIGURED,
  async getUser(token: string) {
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    return error ? null : (data?.user ?? null);
  },
  async customerIdFor(userId: string) {
    const { data, error } = await svc()
      .from("turn_credits")
      .select("stripe_customer_id")
      .eq("owner", userId)
      .maybeSingle();
    if (error) throw Object.assign(new Error("turn_credits read failed"), { code: String(error.code || "db_error") });
    return (data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
  },
  stripe: {
    listConfigurations: (params: Stripe.BillingPortal.ConfigurationListParams) =>
      stripe!.billingPortal.configurations.list(params),
    createConfiguration: (body: Stripe.BillingPortal.ConfigurationCreateParams) =>
      stripe!.billingPortal.configurations.create(body),
    createSession: (params: Stripe.BillingPortal.SessionCreateParams) =>
      stripe!.billingPortal.sessions.create(params),
  },
  log(message: string, detail: Record<string, unknown>) {
    console.error(`BILLING_PORTAL ${message}`, JSON.stringify(detail ?? {}));
  },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const out = await app.handle({
    method: req.method,
    authorization: req.headers.get("Authorization") || "",
    origin: req.headers.get("Origin") || "",
  });
  return json(out.json, out.status);
});

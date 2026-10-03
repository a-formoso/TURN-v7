// ── COLLABORATOR INVITATION EMAILS (Team relaunch, owner 2026-10-03) ─────────
//
// Everything lives in ./core.mjs (tested in Node by scripts/test-invite-collaborator.mjs):
// a fixed link host, one answer whether or not the address has an account, the switch and the
// owner's plan re-checked, one email per invite per 10 minutes, 40 a day per owner.
//
// NOTE on --no-verify-jwt (same convention as image-proxy): the function verifies the user itself
// via auth.getUser(token); the gateway's JWT gate would reject the browser's CORS preflight.
// Deploy from the Mac, after `git pull`:
//   npx -y supabase@2.117.0 functions deploy invite-collaborator --project-ref vubenblfdzginlqiglzw --use-api --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createInviteHandler } from "./core.mjs";

Deno.serve(createInviteHandler({
  createClient,
  env: (k: string) => Deno.env.get(k),
  log: (m: string) => console.warn(m),
}));

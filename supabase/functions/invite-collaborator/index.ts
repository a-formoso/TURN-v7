// ── REAL COLLABORATOR INVITATIONS (owner-only) ───────────────────────────────
//
// The Team panel used to only insert a membership row — no email, no landing,
// nothing the invitee could see. This function sends the actual invitation
// using Supabase's BUILT-IN auth mailer (no third-party mail provider):
//
//   • email has NO account yet → auth.admin.inviteUserByEmail(...) sends the
//     "Invite user" email and pre-creates the account. We pass the film title
//     and inviter address as .Data so the email template can say who invited
//     them and to what ({{ .Data.invited_by }} / {{ .Data.invited_project }}).
//     The created user id is linked onto the membership row immediately.
//   • email already HAS an account → a magic-link sign-in email (OTP with
//     shouldCreateUser:false). The template is the generic Magic Link one, but
//     the redirect lands them on ?invite=<projectId>, where the app names the
//     film and inviter in its own welcome surface.
//
// Either way the link redirects to `${origin}/?invite=<projectId>` — the app's
// acceptance landing. Add your app origins under Authentication → URL
// Configuration → Redirect URLs, or Supabase silently falls back to Site URL.
//
// AUTH: caller must be signed in AND be the project's owner (or the admin
// allowlist). The membership row must already exist (the client inserts it
// first) — this function only ever SENDS MAIL + links a user id; it cannot be
// used to grant access, so a stolen JWT can't invite anyone to someone else's
// film.
//
// NOTE on --no-verify-jwt (same convention as image-proxy): this function
// verifies the user itself via sb.auth.getUser(token); the gateway JWT gate
// would reject the browser's unauthenticated CORS preflight.
// Deploy: npx supabase functions deploy invite-collaborator --no-verify-jwt
//
// Built-in mailer caveat: Supabase's default SMTP is heavily rate-limited
// (a few auth emails per hour) — fine for trying the flow, not for a real
// team. Configure custom SMTP (Project Settings → Auth → SMTP) for volume.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const ADMIN_EMAILS = ["admin@infinitestudioai.com"];
const ROLES = ["view_only", "writer", "art_director"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return json({ ok: false, message: "Function misconfigured." }, 500);

  // ── who is calling? ────────────────────────────────────────────────────────
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, message: "Sign in to send invitations." }, 401);
  const sbAuth = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await sbAuth.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ ok: false, message: "Sign in to send invitations." }, 401);
  const callerEmail = String(caller.email || "").toLowerCase();

  // ── validate the request ──────────────────────────────────────────────────
  let body: { projectId?: string; email?: string; origin?: string } = {};
  try { body = await req.json(); } catch (_e) { /* fall through */ }
  const projectId = String(body.projectId || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const origin = String(body.origin || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ ok: false, message: "Bad project id." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, message: "Bad email address." }, 400);
  if (email === callerEmail) return json({ ok: false, message: "That's your own address." }, 400);
  // origin becomes the redirect target — only a plain http(s) origin, no path.
  // Supabase's Redirect URL allowlist is the real gate; this just rejects junk.
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return json({ ok: false, message: "Bad origin." }, 400);
  const redirectTo = `${origin}/?invite=${projectId}`;

  const admin = createClient(url, serviceKey);

  // ── caller must own the project (or be the app admin) ────────────────────
  const { data: proj, error: projErr } = await admin
    .from("turn_projects").select("id,owner,title").eq("id", projectId).maybeSingle();
  if (projErr || !proj) return json({ ok: false, message: "Film not found." }, 404);
  const isAdmin = ADMIN_EMAILS.includes(callerEmail);
  if (proj.owner !== caller.id && !isAdmin) {
    return json({ ok: false, message: "Only the film's owner can send invitations." }, 403);
  }

  // ── the membership row must already exist (client inserts it under RLS);
  //    mail is only ever sent for a real, active grant ────────────────────────
  const { data: member } = await admin
    .from("turn_project_members")
    .select("id,role,status,member_user")
    .eq("project_id", projectId)
    .eq("member_email", email)
    .maybeSingle();
  if (!member || member.status !== "active" || !ROLES.includes(String(member.role))) {
    return json({ ok: false, message: "Add the collaborator in the Team panel first." }, 400);
  }

  const title = String(proj.title || "Untitled film");

  // ── send the email: invite for new accounts, magic link for existing ─────
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      turn_invited: true,
      invited_project: title,
      invited_by: callerEmail,
    },
  });
  if (!invErr) {
    // brand-new account: link the membership row to it right away, so access
    // never depends on the email string again
    const newId = invited?.user?.id;
    if (newId && !member.member_user) {
      await admin.from("turn_project_members")
        .update({ member_user: newId }).eq("id", member.id).is("member_user", null);
    }
    return json({ ok: true, mode: "invite" });
  }

  const already = /already\s+(been\s+)?(registered|exists|invited)|email_exists/i
    .test(String(invErr.message || "") + " " + String((invErr as { code?: string }).code || ""));
  if (!already) {
    return json({ ok: false, message: "Invite email failed: " + (invErr.message || "unknown error.") }, 502);
  }

  // existing account → sign-in link via the built-in OTP mailer
  const sbAnon = createClient(url, anonKey);
  const { error: otpErr } = await sbAnon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (otpErr) {
    return json({ ok: false, message: "Sign-in email failed: " + (otpErr.message || "unknown error.") }, 502);
  }
  return json({ ok: true, mode: "magiclink" });
});

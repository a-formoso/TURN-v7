/* invite-collaborator — the invitation EMAIL for a collaborator the owner added in the Team window
   (Team relaunch, owner 2026-10-03; docs/Dashboard Plan.md §7). Pure and testable in Node
   (scripts/test-invite-collaborator.mjs): index.ts hands in createClient and the environment.

   WHAT IT DOES: the membership row already exists (the owner's browser inserts it, and the
   database's guard — supabase/team-relaunch.sql — has already checked the switch, the owner's plan,
   the caps and the 20-a-day rule). This function only SENDS the email, through Supabase's auth
   mailer (ZeptoMail SMTP on production):
     - an address with no account → "Invite user" (the account is pre-created; it is NOT linked to
       the film here — the invitee's own confirmed sign-in claims it, turn_claim_memberships);
     - an address with an account → the magic-link sign-in email.
   Both land on https://kinolot.infinitestudioai.com/?invite=<film id>.

   THE MEMO'S THREE FIXES (docs/Team Decision Memo.md §3), before any email is sent:
     1. the link's host is FIXED (SITE) — never taken from the browser;
     2. the answer is the SAME whether or not the address has an account ({ok:true, sent:true},
        and one wording for any failure), so it can't be used to find out who has an account;
     3. caps: the switch and the owner's plan are re-checked here; one email per invite per 10
        minutes; 40 invitation emails per owner per day (turn_team_invite_log kind 'email').
   Only the film's owner (or the admin, for testing) can send; never to their own address; CORS
   answers only the app's hosts.
   (Team review, 2026-10-09) The 10-minute slot and the day's email are CLAIMED before anything is
   sent (a guarded update of email_sent_at, then a log row counted after it is written), so two
   requests at once can't both send; a send that fails gives both claims back. A failed lookup of
   the invite answers "couldn't send right now", never "add the person first". The email names the
   film's OWNER by name (display name, else the address's handle — app/cloud.jsx cloudHandleName),
   never an address — and never the admin's when the admin sends a test. */

export const VERSION = "invite-collaborator@2026-10-09.1";
export const SITE = "https://kinolot.infinitestudioai.com";
export const ADMIN_EMAILS = Object.freeze(["admin@infinitestudioai.com"]);
export const ROLES = Object.freeze(["view_only", "writer", "art_director", "stage_editor"]);
export const RESEND_GAP_MS = 10 * 60 * 1000;
export const DAILY_EMAILS = 40;
export const APP_HOSTS = Object.freeze(["kinolot.infinitestudioai.com", "cinema.infinitestudioai.com", "kinolot.replit.app"]);
export const DEV_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** The one link every invitation carries. */
export function inviteRedirect(projectId) {
  return `${SITE}/?invite=${projectId}`;
}

/** CORS headers: the Origin is echoed only for the app's own hosts (https) and local dev. */
export function corsFor(origin) {
  const base = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  let u = null;
  try { u = new URL(String(origin || "")); } catch (_e) { u = null; }
  if (!u || u.origin !== String(origin)) return base;
  const host = u.hostname.toLowerCase();
  const ok = (APP_HOSTS.includes(host) && u.protocol === "https:" && !u.port) ||
    (DEV_HOSTS.includes(host) && (u.protocol === "http:" || u.protocol === "https:"));
  return ok ? { ...base, "Access-Control-Allow-Origin": u.origin } : base;
}

const SENT = { ok: true, sent: true, message: "Invitation sent." };
const FAILED = { ok: false, code: "email_failed", message: "The invitation email couldn't be sent right now. Please try again in a few minutes." };
const UNAVAILABLE = { ok: false, code: "unavailable", message: "Couldn't send the invite right now. Please try again in a few minutes." };

/** The handle an address reads as: its local part, a "+tag" dropped, words capitalised (the app's
    cloudHandleName). "" for no address. */
export function handleName(email) {
  const local = String(email || "").split("@")[0].split("+")[0].trim();
  if (!local) return "";
  return local.split(/[._-]+/).filter(Boolean)
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ").slice(0, 80);
}
/** The name an invitation shows for the film's owner: the account's display name, else its handle —
    never an email address (a "name" that is one is skipped). "" when it can't be read. */
export function ownerDisplayName(user) {
  if (!user || typeof user !== "object") return "";
  const m = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  for (const k of ["display_name", "full_name", "name", "user_name", "preferred_username"]) {
    const v = typeof m[k] === "string" ? m[k].replace(/\s+/g, " ").trim() : "";
    if (v && !v.includes("@")) return v.slice(0, 80);
  }
  return handleName(user.email);
}

export function createInviteHandler({ createClient, env, now = () => Date.now(), log = () => {} }) {
  return async function handle(req) {
    const cors = corsFor(req.headers.get("Origin"));
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);

    const url = env("SUPABASE_URL") || "", anonKey = env("SUPABASE_ANON_KEY") || "", serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anonKey || !serviceKey) return json({ ok: false, message: "Invitations aren't set up yet." }, 503);

    const token = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, code: "signed_out", message: "Sign in to send invitations." }, 401);
    const sbAuth = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await sbAuth.auth.getUser(token);
    const caller = userData && userData.user;
    if (userErr || !caller) return json({ ok: false, code: "signed_out", message: "Sign in to send invitations." }, 401);
    const callerEmail = String(caller.email || "").trim().toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(callerEmail);

    let body = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const projectId = String((body && body.projectId) || "").trim();
    const email = String((body && body.email) || "").trim().toLowerCase();
    if (!UUID_RE.test(projectId)) return json({ ok: false, code: "bad_request", message: "That film couldn't be found." }, 400);
    if (!EMAIL_RE.test(email)) return json({ ok: false, code: "bad_email", message: "That email address doesn't look right." }, 400);
    if (email === callerEmail) return json({ ok: false, code: "self", message: "That's your own address." }, 400);

    const admin = createClient(url, serviceKey);
    const { data: proj, error: projErr } = await admin.from("turn_projects").select("id,owner,title").eq("id", projectId).maybeSingle();
    if (projErr || !proj) return json({ ok: false, code: "not_found", message: "That film couldn't be found." }, 404);
    if (proj.owner !== caller.id && !isAdmin) return json({ ok: false, code: "owner_only", message: "Only the film's owner can send invitations." }, 403);

    // the switch and the owner's plan (the database's guard checked them at insert; checked again here)
    if (!isAdmin) {
      const on = await admin.rpc("turn_team_sharing_on");
      if (on.error || on.data !== true) return json({ ok: false, code: "paused", message: "Team sharing is switched off right now." }, 403);
      const tier = await admin.rpc("turn_team_owner_tier", { p_owner: proj.owner });
      if (tier.error || !["director", "studio"].includes(String(tier.data))) {
        return json({ ok: false, code: "plan_required", message: "Sharing a film needs the Director or Producer plan." }, 403);
      }
    }

    // a real, active, unexpired invite for this address on this film (a failed read is "try again",
    // never "add the person first")
    const { data: member, error: memberErr } = await admin.from("turn_project_members")
      .select("id,role,status,member_user,expires_at,email_sent_at")
      .eq("project_id", projectId).eq("member_email", email).maybeSingle();
    if (memberErr) {
      log("[invite] member lookup failed: " + String(memberErr.message || memberErr).slice(0, 200));
      return json(UNAVAILABLE, 503);
    }
    if (!member || member.status !== "active" || !ROLES.includes(String(member.role))) {
      return json({ ok: false, code: "no_invite", message: "Add the person in the Team window first." }, 400);
    }
    if (!member.member_user && member.expires_at && Date.parse(member.expires_at) <= now()) {
      return json({ ok: false, code: "expired", message: "This invite has expired. Use “Invite again” to renew it." }, 400);
    }
    const TOO_SOON = { ok: false, code: "too_soon", message: "An invitation was just sent to this address. Please wait a few minutes before sending another." };
    if (member.email_sent_at && now() - Date.parse(member.email_sent_at) < RESEND_GAP_MS) return json(TOO_SOON, 429);

    // CLAIM the 10-minute slot before sending (Team review, 2026-10-09): only the request whose
    // guarded update changed the row sends; a parallel one finds the slot taken
    const sentAt = new Date(now()).toISOString(), prevSentAt = member.email_sent_at || null;
    const gapStart = new Date(now() - RESEND_GAP_MS).toISOString();
    const slot = await admin.from("turn_project_members").update({ email_sent_at: sentAt })
      .eq("id", member.id).or(`email_sent_at.is.null,email_sent_at.lt."${gapStart}"`).select("id");
    if (slot.error) {
      log("[invite] slot claim failed: " + String(slot.error.message || slot.error).slice(0, 200));
      return json(UNAVAILABLE, 503);
    }
    if (!Array.isArray(slot.data) || !slot.data.length) return json(TOO_SOON, 429);
    const giveSlotBack = async () => {
      try {
        await admin.from("turn_project_members").update({ email_sent_at: prevSentAt })
          .eq("id", member.id).eq("email_sent_at", sentAt);
      } catch (_e) { /* best effort: the slot then reopens after 10 minutes */ }
    };
    // CLAIM one of the day's emails: the log row is written first and counted after, so two
    // requests at the cap can't both pass (at the boundary both may be refused — never both sent)
    const since = new Date(now() - 86400000).toISOString();
    const logged = await admin.from("turn_team_invite_log").insert({ owner: proj.owner, project_id: projectId, kind: "email", at: sentAt }).select("id");
    const logId = !logged.error && Array.isArray(logged.data) && logged.data[0] ? logged.data[0].id : null;
    if (logId == null) { await giveSlotBack(); return json(FAILED, 503); }
    const giveEmailBack = async () => {
      try { await admin.from("turn_team_invite_log").delete().eq("id", logId); } catch (_e) { /* best effort */ }
    };
    const sentToday = await admin.from("turn_team_invite_log").select("id", { count: "exact", head: true })
      .eq("owner", proj.owner).eq("kind", "email").gte("at", since);
    if (sentToday.error) { await giveEmailBack(); await giveSlotBack(); return json(FAILED, 503); }
    if ((sentToday.count || 0) > DAILY_EMAILS) {
      await giveEmailBack(); await giveSlotBack();
      return json({ ok: false, code: "daily_cap", message: `You can send up to ${DAILY_EMAILS} invitation emails a day.` }, 429);
    }

    // the film OWNER's name for the email — never an address (and never the admin's, for a test send)
    let ownerName = "";
    try {
      const o = await admin.auth.admin.getUserById(proj.owner);
      ownerName = ownerDisplayName(o && o.data && o.data.user);
    } catch (_e) { ownerName = ""; }

    // send: an invite for a new address, a sign-in link for an existing account — one answer either way
    const redirectTo = inviteRedirect(projectId);
    const title = String(proj.title || "Untitled film").slice(0, 120);
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo, data: { turn_invited: true, invited_project: title, ...(ownerName ? { invited_by: ownerName } : {}) },
    });
    let sent = !invErr;
    if (invErr) {
      const exists = /already\s+(been\s+)?(registered|exists|invited)|email_exists/i
        .test(String(invErr.message || "") + " " + String(invErr.code || ""));
      if (exists) {
        const sbAnon = createClient(url, anonKey);
        const { error: otpErr } = await sbAnon.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
        sent = !otpErr;
        if (otpErr) log("[invite] sign-in email failed: " + String(otpErr.message || otpErr).slice(0, 200));
      } else {
        log("[invite] invite email failed: " + String(invErr.message || invErr).slice(0, 200));
      }
    }
    // nothing went out: both claims are given back, so the owner can try again at once
    if (!sent) { await giveEmailBack(); await giveSlotBack(); return json(FAILED, 502); }
    return json(SENT);
  };
}

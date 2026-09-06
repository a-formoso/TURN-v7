/* cloud.jsx — Supabase integration for Cinema Machine.
   Increment 1: client initialisation + authentication (email + password).
   Projects, cloud doc sync, and the cloud image storage adapter are layered on
   in later increments. Everything here no-ops gracefully when Supabase isn't
   configured or the library hasn't loaded, so the app still runs locally. */

/* ── client ──────────────────────────────────────────────────────────────── */
function sbClient(){
  if(window._sbClient) return window._sbClient;
  const cfg = window.TURN_SUPABASE;
  if(!cfg || !cfg.url || !cfg.anonKey || !window.supabase || !window.supabase.createClient) return null;
  try{
    window._sbClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "turn-auth" },
    });
  }catch(e){ return null; }
  return window._sbClient;
}
function cloudConfigured(){ return !!sbClient(); }
window.sbClient = sbClient;
window.cloudConfigured = cloudConfigured;

/* ── auth ────────────────────────────────────────────────────────────────── */
async function cloudSignUp(email, password){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  return sb.auth.signUp({ email, password });
}
async function cloudSignIn(email, password){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  return sb.auth.signInWithPassword({ email, password });
}
async function cloudSignOut(){
  const sb = sbClient(); if(!sb) return;
  try{ await sb.auth.signOut(); }catch(e){}
}
async function cloudResetPassword(email){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  return sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
}
async function cloudGetSession(){
  const sb = sbClient(); if(!sb) return null;
  try{ const { data } = await sb.auth.getSession(); return data ? data.session : null; }catch(e){ return null; }
}
/* subscribe to auth changes; returns an unsubscribe fn */
function cloudOnAuth(cb){
  const sb = sbClient(); if(!sb) return ()=>{};
  const { data } = sb.auth.onAuthStateChange((_event, session)=>{ try{ cb(session); }catch(e){} });
  return ()=>{ try{ data.subscription.unsubscribe(); }catch(e){} };
}
function cloudUserEmail(session){ return session && session.user ? (session.user.email||"") : ""; }
function cloudUserId(session){ return session && session.user ? session.user.id : null; }

window.cloudSignUp = cloudSignUp;
window.cloudSignIn = cloudSignIn;
window.cloudSignOut = cloudSignOut;
window.cloudResetPassword = cloudResetPassword;
window.cloudGetSession = cloudGetSession;
window.cloudOnAuth = cloudOnAuth;
window.cloudUserEmail = cloudUserEmail;
window.cloudUserId = cloudUserId;

/* ── credits / usage balance ─────────────────────────────────────────────────
   The billing schema may evolve, so this reader is intentionally tolerant:
   it first tries an RPC, then a few likely per-user balance tables, and finally
   falls back to auth metadata. UI can show "unavailable" instead of inventing a
   number when no backend balance source exists yet. */
function _turnCreditShape(row, source){
  if(!row || typeof row!=="object") return null;
  const pick = (...ks)=>{
    for(const k of ks){ if(row[k]!==undefined && row[k]!==null && row[k]!=="") return row[k]; }
    return null;
  };
  const remaining = pick("remaining","credits_remaining","credit_balance","balance","credits","available_credits","available");
  const used = pick("used","credits_used","usage","spent");
  const limit = pick("limit","credits_limit","monthly_credits","included_credits","quota");
  const plan = pick("plan","tier","subscription_tier");
  const n = remaining==null ? null : Number(remaining);
  if(!Number.isFinite(n)) return null;
  return {
    remaining:n,
    used: used==null || !Number.isFinite(Number(used)) ? null : Number(used),
    limit: limit==null || !Number.isFinite(Number(limit)) ? null : Number(limit),
    plan: plan==null ? "" : String(plan),
    source:source||"unknown"
  };
}
async function cloudGetCreditBalance(){
  const sb = sbClient(); if(!sb) return null;
  const session = await cloudGetSession();
  const uid = session && session.user && session.user.id;
  if(!uid) return null;
  const meta = {
    ...((session.user&&session.user.user_metadata)||{}),
    ...((session.user&&session.user.app_metadata)||{})
  };
  const fromMeta = _turnCreditShape(meta, "auth metadata");
  try{
    const { data, error } = await sb.rpc("turn_credit_balance");
    if(!error){
      const shaped = _turnCreditShape(Array.isArray(data)?data[0]:data, "turn_credit_balance");
      if(shaped) return shaped;
    }
  }catch(e){}
  const tables = [
    ["turn_credit_balances","owner"],
    ["turn_user_credits","owner"],
    ["turn_credits","owner"],
    ["turn_credit_balances","user_id"],
    ["turn_user_credits","user_id"],
    ["turn_credits","user_id"],
  ];
  for(const [table,col] of tables){
    try{
      const { data, error } = await sb.from(table).select("*").eq(col, uid).maybeSingle();
      if(!error){
        const shaped = _turnCreditShape(data, table);
        if(shaped) return shaped;
      }
    }catch(e){}
  }
  return fromMeta;
}
window.cloudGetCreditBalance = cloudGetCreditBalance;

/* decrement after a successful render (supabase/credits.sql turn_spend_credit).
   Fire-and-forget from the render path; the UI refreshes via cloudGetCreditBalance
   on the "turn-credits-changed" event either way. Returns the new balance or null. */
async function cloudSpendCredit(cost, eventId){
  const sb = sbClient(); if(!sb) return null;
  try{
    const call = (withId)=> sb.rpc("turn_spend_credit", {
      cost: Math.max(1, Number(cost)||1),
      ...(withId && eventId ? { event_id: String(eventId) } : {}),
    });
    let { data, error } = await call(true);
    /* the event id makes retried spends idempotent server-side (spend-idempotency
       migration). Against a database that hasn't run it, PostgREST rejects the
       two-arg signature — degrade to the legacy call rather than losing the spend. */
    if(error && eventId && /schema cache|function/i.test(String(error.message||"")))
      ({ data, error } = await call(false));
    if(error) return null;
    return _turnCreditShape(Array.isArray(data)?data[0]:data, "turn_spend_credit");
  }catch(e){ return null; }
}
window.cloudSpendCredit = cloudSpendCredit;

/* Spend that can't silently vanish: the provider already charged the render, so a
   lost decrement here would show a rosier balance than the truth. A failed spend
   queues in localStorage and re-flushes on the next spend, the next load, and on
   reconnect — serialized so two parallel renders can't double-flush the queue. */
const SPEND_QUEUE_KEY = "turn_spend_queue";
/* the in-memory MIRROR backs the localStorage queue: when a write fails (quota,
   privacy mode), the entries keep living — and retrying — here for as long as
   the tab does, instead of being silently unpaid. Reads union both by id. */
let _spendMirror = [];
function _spendQueue(){
  let l = [];
  try{ l = JSON.parse(localStorage.getItem(SPEND_QUEUE_KEY)||"[]")||[]; }catch(e){}
  const seen = new Set(l.map(it=> it && it.id));
  for(const it of _spendMirror) if(it && !seen.has(it.id)) l.push(it);
  return l;
}
// money events are NEVER truncated — every queued entry is an incurred charge.
// Past 500 we warn loudly (billing has been unreachable for a very long run of
// renders) but keep everything; a failed local write is disclosed too.
function _spendQueueSave(l){
  l = l||[];
  _spendMirror = l;
  if(l.length > 500){ try{ if(typeof window.appToast==="function") window.appToast("Over 500 credit records are waiting to be recorded — please reconnect so billing can catch up.","error"); }catch(e){} }
  try{ localStorage.setItem(SPEND_QUEUE_KEY, JSON.stringify(l)); }
  catch(e){ try{ if(typeof window.appToast==="function") window.appToast("Couldn't save the credit record queue locally — spends may go unrecorded if you close this tab.","error"); }catch(_e){} }
}
let _spendFlushQ = Promise.resolve(false);
async function _spendUid(){ try{ const s = await cloudGetSession(); return (s && s.user && s.user.id) || null; }catch(e){ return null; } }
function cloudFlushSpendQueue(){
  const run = async ()=>{
    if(!sbClient()) return false;
    const items = _spendQueue(); if(!items.length) return true;
    /* ACCOUNT SAFETY: each queued spend is tagged with the uid that incurred it.
       Another account's entries are HELD, never debited to whoever is signed in
       now; signed out, nothing flushes at all. */
    const uid = await _spendUid();
    if(!uid) return false;
    const left = [];
    for(const it of items){
      if(it && it.uid && it.uid!==uid){ left.push(it); continue; }   // another account's spend — hold it
      const r = await cloudSpendCredit(it.cost, it && it.id);        // event id → server-side dedupe on replay
      if(!r) left.push(it);
    }
    _spendQueueSave(left);
    return !left.some(it=> !(it && it.uid) || it.uid===uid);   // all of OUR spends recorded?
  };
  /* cross-tab: the Web Locks API keeps two tabs from double-charging the same
     queue (the loser simply reports "still queued"); where locks don't exist,
     the in-context serialization below still holds within one tab. */
  const runLocked = ()=> (typeof navigator!=="undefined" && navigator.locks && navigator.locks.request)
    ? navigator.locks.request("turn_spend_flush", { ifAvailable:true }, lock => lock ? run() : false)
    : run();
  _spendFlushQ = _spendFlushQ.then(runLocked, runLocked);
  return _spendFlushQ;
}
async function cloudSpendCreditReliable(cost, reason, uid, eventId){
  /* uid: the account that LAUNCHED the render, captured at submit time by the
     caller. If the signed-in user changed while the render cooked, the spend
     stays pinned to the launcher — never whoever happens to be signed in now.
     eventId: callers that settle the SAME charge from multiple paths (live
     poll vs crash-recovery) pass the job's own id — duplicates are skipped
     here and, post-migration, deduped server-side too. */
  const eid = (eventId!=null && eventId!=="") ? String(eventId)
    : (typeof crypto!=="undefined" && crypto.randomUUID) ? crypto.randomUUID()
    : (Date.now().toString(36)+"-"+Math.random().toString(36).slice(2));
  if(!_spendQueue().some(it=> it && it.id===eid))
    _spendQueueSave([..._spendQueue(), { id: eid, cost:Math.max(1, Number(cost)||1), reason:reason||"", at:Date.now(), uid: (uid!=null && uid!=="") ? String(uid) : await _spendUid() }]);
  await cloudFlushSpendQueue();
  // judge OUR entry specifically — the flush verdict covers the whole queue,
  // and a launcher-pinned spend held for another account is "queued", not "ok"
  const still = _spendQueue().some(it=> it && it.id===eid);
  if(still && typeof window.appToast==="function")
    window.appToast("The render finished but recording its credit spend didn't go through — it's queued and will be recorded automatically.","info");
  return !still;
}
window.cloudFlushSpendQueue = cloudFlushSpendQueue;
window.cloudSpendCreditReliable = cloudSpendCreditReliable;
try{
  setTimeout(()=>{ try{ if(_spendQueue().length) cloudFlushSpendQueue(); }catch(e){} }, 6000);
  window.addEventListener("online", ()=>{ try{ if(_spendQueue().length) cloudFlushSpendQueue(); }catch(e){} });
}catch(e){}

/* ── projects ────────────────────────────────────────────────────────────────
   A project row holds the whole story `doc` (scenes, characters, props, drafts,
   beats, continuity) as JSON, scoped to the signed-in user by RLS. */
async function cloudListProjects(){
  const sb = sbClient(); if(!sb) return [];
  try{
    // show fields ride along (Phase 3): a SHOW is a project row whose doc carries
    // isShow + bible; an EPISODE carries showId + episodeNo. PostgREST returns the
    // jsonb ->> extracts as strings (or null).
    // hasShots/hasLocs: tiny scalar probes (the first element's id) so the Home
    // cards can show each film's honest pipeline PHASE without fetching whole
    // docs — shots exist → Production; location cards → Pre-production; else Development.
    const session = await cloudGetSession();
    const uid = session && session.user && session.user.id;
    const email = String((session && session.user && session.user.email) || "").toLowerCase();
    const { data, error } = await sb.from("turn_projects")
      .select("id,owner,title,updated_at,created_at,isShow:doc->>isShow,showId:doc->>showId,episodeNo:doc->>episodeNo,cover:doc->>cover,coverPrev:doc->>coverPrev,fmt:doc->project->>format,logline:doc->project->>logline,ord:doc->>homeOrder,hasShots:doc->shots->0->>id,hasLocs:doc->locations->0->>id")
      .order("updated_at",{ ascending:false });
    // null = REQUEST FAILED (e.g. expired token → 401), [] = genuinely no projects.
    // Callers must not treat a failure as "new user" — that's how an auth hiccup
    // once spawned a create-first-project during boot and stranded the app.
    if(error) return null;
    let memberships = [];
    try{
      const { data:ms } = await sb.from("turn_project_members")
        .select("project_id,role,member_email,status")
        .or("member_user.eq."+uid+",member_email.eq."+email);
      memberships = (ms||[]).filter(m=>String(m.status||"active")==="active");
    }catch(e){}
    const byProject = {};
    memberships.forEach(m=>{ if(m && m.project_id) byProject[m.project_id]=m; });
    // owner attribution for shared films ("Shared by x@y.com" on the home wall):
    // owner emails live in auth.users, so a tiny definer RPC (shared-owners.sql)
    // returns them for the caller's own memberships only. Quiet degrade — if the
    // SQL hasn't been run, shared films simply show without the owner's name.
    let ownersBy = {};
    if(memberships.length){
      try{
        const { data:ow, error:oe } = await sb.rpc("turn_shared_film_owners");
        if(!oe)(ow||[]).forEach(r=>{ if(r && r.project_id) ownersBy[r.project_id]=r.owner_email||""; });
      }catch(e){}
    }
    return (data || []).map(p=>{
      const m = byProject[p.id] || null;
      const isOwner = !!(uid && p.owner===uid);
      // FAIL CLOSED: any accessible project I don't own IS shared with me — RLS
      // only returns rows I can access. The memberships query merely supplies the
      // role + attribution; if it failed, the row must still classify as shared
      // (role "" = write-blocked everywhere) rather than slip into the owned
      // pipeline and, e.g., auto-spend credits painting someone else's poster.
      return { ...p, isOwner, isShared:!isOwner, shareRole: isOwner ? "owner" : ((m && m.role) || ""),
        ownerEmail: !isOwner ? (ownersBy[p.id]||"") : "" };
    });
  }catch(e){ return null; }
}
function _teamEmail(s){ return String(s||"").trim().toLowerCase(); }
function _teamSchemaMissing(err){
  const msg = String((err && err.message) || err || "");
  return /turn_project_members|schema cache|relation .* does not exist|could not find the table/i.test(msg);
}
function _teamSetupMessage(){
  return "Team collaboration needs the Supabase team-collaboration.sql migration before invites can be added.";
}
async function cloudListProjectMembers(projectId){
  const sb = sbClient(); if(!sb || !projectId) return [];
  try{
    // removed members stay in the table as an audit trail, but every list the
    // app shows is ACTIVE members only — a removed row must never look like access
    const { data, error } = await sb.from("turn_project_members")
      .select("id,project_id,member_email,member_user,role,status,created_at")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("created_at", { ascending:true });
    if(error){
      window.turnTeamSchemaMissing = _teamSchemaMissing(error);
      return [];
    }
    window.turnTeamSchemaMissing = false;
    return data || [];
  }catch(e){ window.turnTeamSchemaMissing = _teamSchemaMissing(e); return []; }
}
async function cloudInviteProjectMember(projectId, email, role){
  const sb = sbClient(); if(!sb || !projectId) return { ok:false };
  const e = _teamEmail(email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok:false, message:"Enter a valid email address." };
  // exactly three roles exist (producer/admin was retired); an unrecognized role —
  // including "" / false / 0 — is rejected outright, never silently coerced into a
  // grant. Only an ABSENT role (null/undefined) defaults to writer.
  if(role!=null && ["view_only","writer","art_director"].indexOf(role)<0) return { ok:false, message:"Unknown role." };
  const r = role==null ? "writer" : role;
  try{
    // UPSERT, not insert: re-inviting an existing address is a normal action
    // (re-send the email, possibly with a new role) and it revives a
    // previously-removed row instead of failing on the unique constraint.
    const { error } = await sb.from("turn_project_members")
      .upsert({ project_id:projectId, member_email:e, role:r, status:"active" },
              { onConflict:"project_id,member_email" });
    if(error){
      if(_teamSchemaMissing(error)){ window.turnTeamSchemaMissing = true; return { ok:false, setup:true, message:_teamSetupMessage() }; }
      return { ok:false, message:error.message };
    }
    window.turnTeamSchemaMissing = false;
    // The row grants access; the EMAIL makes it real. Send it via the
    // invite-collaborator Edge Function — and if that fails, say so explicitly
    // (the grant still stands; silent "sent" claims are how invites die).
    const mail = await _sendInviteEmail(sb, projectId, e);
    return { ok:true, emailSent:mail.sent, emailNote:mail.note };
  }catch(err){
    if(_teamSchemaMissing(err)){ window.turnTeamSchemaMissing = true; return { ok:false, setup:true, message:_teamSetupMessage() }; }
    return { ok:false, message:(err&&err.message)||"Invite failed." };
  }
}
async function _sendInviteEmail(sb, projectId, email){
  try{
    const { data, error } = await sb.functions.invoke("invite-collaborator",
      { body:{ projectId, email, origin: window.location.origin } });
    if(!error && data && data.ok) return { sent:true, note:"" };
    let msg = (data && data.message) || "";
    if(!msg && error){
      // FunctionsHttpError carries the response; the useful message is in its body
      try{ const j = error.context && await error.context.json(); msg = (j && j.message) || ""; }catch(e){}
      if(!msg) msg = String(error.message||"");
    }
    if(/not\s*found|404|Failed to send a request/i.test(msg))
      msg = "the invite email function isn't deployed yet (see supabase/README.md).";
    return { sent:false, note: msg || "the invitation email could not be sent." };
  }catch(err){
    return { sent:false, note: (err && err.message) || "the invitation email could not be sent." };
  }
}
/* Link my membership rows to my account id (invitations addressed to my verified
   email). Runs on every signed-in boot — idempotent, returns only NEWLY linked
   films so the app can announce them once. */
async function cloudClaimInvites(){
  const sb = sbClient(); if(!sb) return [];
  try{
    const { data, error } = await sb.rpc("turn_claim_memberships");
    if(error) return [];                        // function not installed yet → quiet no-op
    return Array.isArray(data) ? data : [];
  }catch(e){ return []; }
}
/* Invited accounts are created by the invite email and sign in through its link —
   they have no password yet. This sets one (and remembers that it was set) so
   they can sign in directly next time. */
async function cloudSetPassword(password){
  const sb = sbClient(); if(!sb) return { ok:false, message:"Not connected." };
  const pw = String(password||"");
  if(pw.length < 8) return { ok:false, message:"Use at least 8 characters." };
  try{
    const { error } = await sb.auth.updateUser({ password:pw, data:{ turn_password_set:true } });
    if(error) return { ok:false, message:error.message };
    return { ok:true };
  }catch(err){ return { ok:false, message:(err&&err.message)||"Could not set the password." }; }
}
async function cloudUpdateProjectMember(memberId, patch){
  const sb = sbClient(); if(!sb || !memberId) return { ok:false };
  const role = patch && patch.role;
  // fail CLOSED on an unknown role: passing it through would either hit the DB CHECK
  // with a cryptic error or, worse, store a grant this build can't scope
  if(role!=null && ["view_only","writer","art_director"].indexOf(role)<0) return { ok:false, message:"Unknown role." };
  try{
    const { error } = await sb.from("turn_project_members").update(role?{role}:patch).eq("id", memberId);
    if(error) return { ok:false, message:error.message };
    return { ok:true };
  }catch(err){ return { ok:false, message:(err&&err.message)||"Update failed." }; }
}
async function cloudRemoveProjectMember(memberId, projectId){
  const sb = sbClient(); if(!sb || !memberId) return { ok:false };
  try{
    // status flip, NOT delete: the row stays as an audit trail of who had access
    // (and RLS keys every grant on status='active', so access ends immediately).
    // Re-inviting the same address later revives this row via the upsert.
    const { error } = await sb.from("turn_project_members")
      .update({ status:"removed" }).eq("id", memberId);   // updated_at set by DB trigger
    if(error) return { ok:false, message:error.message };
    // tell everyone in the film's channel — the removed person's open tab hears
    // this, re-checks with the server, and gets the access-ended message at once
    if(projectId) _pushMemberRemoved(projectId);
    return { ok:true };
  }catch(err){ return { ok:false, message:(err&&err.message)||"Remove failed." }; }
}
window.cloudListProjectMembers = cloudListProjectMembers;
window.cloudInviteProjectMember = cloudInviteProjectMember;
window.cloudUpdateProjectMember = cloudUpdateProjectMember;
window.cloudRemoveProjectMember = cloudRemoveProjectMember;
window.cloudClaimInvites = cloudClaimInvites;
window.cloudSetPassword = cloudSetPassword;
/* persist a film's poster (a downscaled data URL) onto its doc.cover, merging so the
   rest of the story doc is untouched. Used by the Home screen's poster generator. */
async function cloudSaveCover(id, cover, prevCover){
  // fenced: a poster save must never revert story edits made while it was in flight
  await cloudPatchDoc(id, (doc)=>{
    doc.cover = cover || "";
    // one-deep poster history: a REGENERATE passes the outgoing poster so the
    // Home card's Restore can bring it back
    if(prevCover!==undefined) doc.coverPrev = prevCover || "";
  });
}
window.cloudSaveCover = cloudSaveCover;
/* swap a film's poster with its one-deep history (doc.cover <-> doc.coverPrev) —
   the Home card's Restore. Returns the new pair, or null on failure. */
async function cloudSwapCover(id){
  let out = null;
  const r = await cloudPatchDoc(id, (doc)=>{
    if(!doc.coverPrev) return false;   // nothing to restore
    const cur = doc.cover || "";
    doc.cover = doc.coverPrev; doc.coverPrev = cur;
    out = { cover:doc.cover, coverPrev:doc.coverPrev };
  });
  return (r && r.ok) ? out : null;
}
window.cloudSwapCover = cloudSwapCover;
/* persist a film's manual position on the Home wall onto doc.homeOrder (merged), so a
   user-arranged order survives reload and rides along in cloudListProjects (`ord`). */
async function cloudSaveOrder(id, order){
  await cloudPatchDoc(id, (doc)=>{ doc.homeOrder = order; });
}
window.cloudSaveOrder = cloudSaveOrder;
/* decode the JWT the client is ACTUALLY sending, for RLS failure diagnostics:
   which role it carries, whether it's the signed-in user, whether it expired */
async function _cloudJwtDiag(sb, uid){
  try{
    const { data } = await sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if(!tok) return "no access token attached";
    const p = JSON.parse(atob(String(tok).split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
    const secs = Math.round((p.exp||0) - Date.now()/1000);
    return "token role="+(p.role||"?")
      +" \u00b7 user "+(p.sub===uid ? "matches" : "MISMATCH")
      +" \u00b7 "+(secs>=0 ? "expires in "+secs+"s" : "EXPIRED "+(-secs)+"s ago");
  }catch(e){ return "token unreadable"; }
}
async function cloudCreateProject(title, doc){
  // record WHY a create failed so the UI can say something better than "hiccup"
  window.cloudLastCreateError = "";
  const sb = sbClient(); if(!sb){ window.cloudLastCreateError = "cloud storage isn\u2019t ready in this window"; return null; }
  const session = await cloudGetSession();
  const uid = session && session.user && session.user.id;
  if(!uid){ window.cloudLastCreateError = "your session has expired \u2014 sign in again"; return null; }
  const ins = ()=> sb.from("turn_projects")
    .insert({ owner:uid, title: title || "Untitled film", doc: doc || {} }).select().single();
  try{
    let { data, error } = await ins();
    if(error && /row-level security/i.test(error.message||"")){
      // the DB didn't recognise this sign-in — force a token refresh, retry once
      try{ await sb.auth.refreshSession(); }catch(e){}
      ({ data, error } = await ins());
    }
    if(error){
      let why = error.message || "the server rejected the save";
      if(/row-level security/i.test(why)){
        const diag = await _cloudJwtDiag(sb, uid);
        why += diag ? " ["+diag+"]" : "";
        try{ console.error("[turn] create-film RLS failure:", why, "uid:", uid); }catch(e){}
      }
      window.cloudLastCreateError = why; return null;
    }
    return data;
  }catch(e){ window.cloudLastCreateError = (e && e.message) || "network error"; return null; }
}
async function cloudLoadProject(id){
  const sb = sbClient(); if(!sb) return null;
  try{
    const { data, error } = await sb.from("turn_projects").select("*").eq("id", id).single();
    if(error) return null;
    return data;
  }catch(e){ return null; }
}
/* MULTI-WINDOW SAVE FENCE — the auto-save is a full-doc overwrite, so two open
   sessions on one account used to silently erase each other's edits (last writer
   wins). Every doc now carries a monotonic _rev; a save only lands if the cloud
   still holds the revision THIS session last saw (atomic .eq filter — no read
   race). A stale window's save matches 0 rows and reports {conflict:true}
   instead of clobbering the newer work. */
const _docRevSeen = {};   // project id -> the _rev this session last loaded/wrote
function cloudNoteDocRev(id, doc){ if(id) _docRevSeen[id] = (doc && Number(doc._rev)) || 0; }
window.cloudNoteDocRev = cloudNoteDocRev;
/* SERVER ROLE-SCOPE REJECTION — the database trigger (enforce-role-scopes.sql)
   raises 'TURN_ROLE_SCOPE: ...' when a write touches doc sections outside the
   collaborator's role. That is a PERMANENT verdict for this payload, not a blip:
   callers must surface it as the role-scope notice, never retry-loop on it. */
function _roleScopeErr(error){
  const msg = String((error && error.message) || "");
  if(msg.indexOf("TURN_ROLE_SCOPE") < 0) return null;
  return msg.replace(/^.*TURN_ROLE_SCOPE:\s*/, "");
}
async function cloudSaveDoc(id, doc){
  const sb = sbClient(); if(!sb || !id) return { ok:false };
  const seen = _docRevSeen[id] || 0;
  const next = { ...doc, _rev: seen + 1 };
  try{
    let q = sb.from("turn_projects").update({ doc: next }).eq("id", id);
    // fence: overwrite only the revision we last saw. Legacy docs (no _rev yet)
    // match the null/0 branch once, then join the fenced world.
    q = seen ? q.eq("doc->>_rev", String(seen))
             : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
    const { data, error } = await q.select("id");
    if(error){ const rs = _roleScopeErr(error); return rs ? { ok:false, roleScope:true, message:rs } : { ok:false }; }
    if(!data || !data.length) return { ok:false, conflict:true };
    _docRevSeen[id] = seen + 1;
    _pushDocRev(id, seen + 1);
    return { ok:true };
  }catch(e){ return { ok:false }; }
}
/* FENCED PATCH — change a FEW keys on a doc without the last-writer-wins hazard of a
   plain read-modify-write. The naive form (select doc → mutate → update) writes back the
   whole snapshot it read, so an autosave that lands in between is silently reverted AND
   _rev goes backwards, which then makes every later save conflict. This reads the current
   doc, applies `mutate`, and writes under the SAME atomic _rev fence cloudSaveDoc uses,
   retrying on a lost race. `mutate(doc)` returns false to abort (nothing to do).
   Fence bookkeeping: only advance this session's _docRevSeen when it was exactly in sync
   before the patch — if the session was already behind, leave it stale so the next
   autosave conflicts honestly and takes the reload path instead of clobbering. */
async function cloudPatchDoc(id, mutate){
  const sb = sbClient(); if(!sb || !id) return { ok:false };
  for(let attempt=0; attempt<3; attempt++){
    try{
      const { data, error } = await sb.from("turn_projects").select("doc").eq("id", id).single();
      if(error) return { ok:false };
      const doc = (data && data.doc) || {};
      const cur = Number(doc._rev) || 0;
      const wasInSync = (_docRevSeen[id] || 0) === cur;
      if(mutate(doc) === false) return { ok:false, skipped:true };
      let q = sb.from("turn_projects").update({ doc: { ...doc, _rev: cur + 1 } }).eq("id", id);
      q = cur ? q.eq("doc->>_rev", String(cur))
              : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
      const { data: rows, error: wErr } = await q.select("id");
      if(wErr){ const rs = _roleScopeErr(wErr); return rs ? { ok:false, roleScope:true, message:rs } : { ok:false }; }
      if(rows && rows.length){
        if(wasInSync) _docRevSeen[id] = cur + 1;
        _pushDocRev(id, cur + 1);
        return { ok:true, doc };
      }
      // someone else wrote between our read and write — re-read and retry
    }catch(e){ return { ok:false }; }
  }
  return { ok:false, conflict:true };
}
window.cloudPatchDoc = cloudPatchDoc;

/* COLLABORATIVE SECTION SAVE — the collaboration fix.
   The old autosave overwrote the WHOLE doc behind a single _rev fence. That is correct
   for one user in two windows (it refuses to clobber), but for two COLLABORATORS it meant
   whoever saved second was told "changed in another window", reloaded, and lost their
   edits — every ~700ms of typing. Real collaboration was impossible.
   Now a window writes ONLY the top-level sections it actually changed, merged onto the
   freshest cloud doc. Two people working on different parts (one on scenes, one on props)
   never collide at all; two people in the SAME section still resolve last-writer-wins, but
   only for that section instead of the entire film.
   Returns { ok, doc } where `doc` is the cloud doc AS READ (before our overlay), so the
   caller can adopt the sections OTHER people changed. */
async function cloudSaveSections(id, sections){
  const sb = sbClient(); if(!sb || !id) return { ok:false };
  const keys = Object.keys(sections||{});
  if(!keys.length) return { ok:true, noop:true };
  for(let attempt=0; attempt<4; attempt++){
    try{
      const { data, error } = await sb.from("turn_projects").select("doc").eq("id", id).single();
      if(error) return { ok:false };
      const cloudDoc = (data && data.doc) || {};
      const cur = Number(cloudDoc._rev) || 0;
      const next = { ...cloudDoc };
      keys.forEach(k=>{ next[k] = sections[k]; });
      next._rev = cur + 1;
      let q = sb.from("turn_projects").update({ doc: next }).eq("id", id);
      q = cur ? q.eq("doc->>_rev", String(cur))
              : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
      const { data: rows, error: wErr } = await q.select("id");
      if(wErr){ const rs = _roleScopeErr(wErr); return rs ? { ok:false, roleScope:true, message:rs } : { ok:false }; }
      if(rows && rows.length){
        _docRevSeen[id] = cur + 1;      // we merged onto the freshest doc, so we ARE current
        _pushDocRev(id, cur + 1);       // wake collaborators' windows right away
        return { ok:true, doc:cloudDoc };
      }
      // someone wrote between our read and our write — re-read and merge again
    }catch(e){ return { ok:false }; }
  }
  return { ok:false, conflict:true };   // pathological contention only
}
window.cloudSaveSections = cloudSaveSections;

/* PRESENCE — who else has this film open right now.
   Per-section saves stop collaborators from destroying each other's work, but a
   same-section collision still resolves last-writer-wins, and arriving at that silently
   is a nasty surprise. Presence makes concurrent work VISIBLE before it collides.
   Built on Supabase Realtime presence (no schema, no table writes). The key is per
   SESSION, not per user, so the same person in two windows shows as two entries — which
   is exactly the situation that used to trigger the save-conflict reload.
   Degrades silently: if Realtime is unavailable the callback simply never fires and the
   UI shows nothing rather than erroring. Returns an unsubscribe function. */
const _presenceKey = "s"+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
window.turnPresenceKey = _presenceKey;
/* LIVE PUSH rides the SAME per-film channel as presence: a successful save
   broadcasts the new _rev so every other window pulls within a second or two,
   instead of waiting for the fallback poll. Module-level so the save functions
   (which know nothing about React) can reach the channel. turnPushHealthy tells
   the poller it may relax while push is delivering. */
let _presenceCh = null, _presenceChProject = null, _presenceReady = false;
function _pushDocRev(projectId, rev){
  // fire-and-forget: losing the message is harmless — the fallback poll still runs
  if(!_presenceCh || _presenceChProject!==projectId || !_presenceReady) return;
  try{ _presenceCh.send({ type:"broadcast", event:"doc-rev", payload:{ rev:Number(rev)||0, key:_presenceKey } }); }catch(e){}
}
function _pushMemberRemoved(projectId){
  // removal changes no document rev, so it needs its own announcement — otherwise
  // the removed person's open tab wouldn't learn until the slow fallback probe.
  // The payload names nobody: it only says "membership changed, re-verify your
  // access", and every recipient checks with the SERVER before acting.
  if(!_presenceCh || _presenceChProject!==projectId || !_presenceReady) return;
  try{ _presenceCh.send({ type:"broadcast", event:"member-removed", payload:{ key:_presenceKey } }); }catch(e){}
}
function cloudJoinPresence(projectId, meta, onChange){
  const sb = sbClient();
  if(!sb || !projectId || typeof sb.channel!=="function") return ()=>{};
  let ch = null, dead = false;
  try{
    ch = sb.channel("film:"+projectId, { config:{ presence:{ key:_presenceKey } } });
    const emit = ()=>{
      if(dead || !ch) return;
      let people = [];
      try{
        const state = ch.presenceState() || {};
        Object.keys(state).forEach(k=>{
          const entry = (state[k]||[])[0];
          if(entry) people.push({ key:k, ...entry, isSelf:k===_presenceKey });
        });
      }catch(e){ people = []; }
      try{ onChange(people); }catch(e){}
    };
    ch.on("presence", { event:"sync" }, emit);
    ch.on("presence", { event:"join" }, emit);
    ch.on("presence", { event:"leave" }, emit);
    // a collaborator's save announces its new _rev here; hand it to the app as a
    // DOM event so the live-refresh logic (which owns the dirty/hydrating guards)
    // decides whether to pull. Our own saves are filtered by session key.
    ch.on("broadcast", { event:"doc-rev" }, (msg)=>{
      if(dead) return;
      const p = (msg && msg.payload) || {};
      if(p.key === _presenceKey) return;
      try{ window.dispatchEvent(new CustomEvent("turn-doc-push", { detail:{ projectId, rev:Number(p.rev)||0 } })); }catch(e){}
    });
    // "someone was removed from this film" — a hint, never an order: the app
    // re-verifies its own access against the server (RLS) before reacting
    ch.on("broadcast", { event:"member-removed" }, (msg)=>{
      if(dead) return;
      const p = (msg && msg.payload) || {};
      if(p.key === _presenceKey) return;
      try{ window.dispatchEvent(new CustomEvent("turn-member-removed", { detail:{ projectId } })); }catch(e){}
    });
    // leave LOUDLY when the tab closes/navigates: untrack broadcasts the leave at
    // once, so a closed laptop lid's ghost chip doesn't linger for the timeout
    const bye = ()=>{ try{ if(ch) ch.untrack(); }catch(e){} };
    window.addEventListener("pagehide", bye);
    ch._turnBye = bye;
    ch.subscribe(async (status)=>{
      if(dead) return;
      if(status==="SUBSCRIBED"){
        _presenceCh = ch; _presenceChProject = projectId; _presenceReady = true;
        window.turnPushHealthy = true;
        try{ await ch.track(meta||{}); }catch(e){}
      }
      // CHANNEL_ERROR / TIMED_OUT (Realtime off for this project): stay silent —
      // and tell the poller push is NOT covering us, so it keeps full cadence
      else if(status==="CHANNEL_ERROR" || status==="TIMED_OUT" || status==="CLOSED"){
        if(_presenceCh===ch){ _presenceReady = false; window.turnPushHealthy = false; }
        try{ onChange([]); }catch(e){}
      }
    });
  }catch(e){ return ()=>{}; }
  return ()=>{
    dead = true;
    if(_presenceCh===ch){ _presenceCh = null; _presenceChProject = null; _presenceReady = false; window.turnPushHealthy = false; }
    try{ if(ch && ch._turnBye) window.removeEventListener("pagehide", ch._turnBye); }catch(e){}
    try{ if(ch){ ch.untrack(); sb.removeChannel(ch); } }catch(e){}
  };
}
window.cloudJoinPresence = cloudJoinPresence;

/* LIVE REFRESH support.
   cloudDocRev is a DELIBERATELY tiny probe — it selects only the doc's _rev scalar, not
   the doc, because a film's doc can be megabytes (255 shots, every draft) and polling
   that would be indefensible. The full pull happens only once the probe says there is
   actually something newer to fetch. */
async function cloudDocRev(id){
  const sb = sbClient(); if(!sb || !id) return null;
  try{
    const { data, error } = await sb.from("turn_projects").select("rev:doc->>_rev").eq("id", id).single();
    if(error) return null;
    return Number((data && data.rev) || 0) || 0;
  }catch(e){ return null; }
}
function cloudSeenRev(id){ return _docRevSeen[id] || 0; }
window.cloudDocRev = cloudDocRev;
window.cloudSeenRev = cloudSeenRev;
/* ACCESS PROBE — distinguishes "this film is gone for me" (owner removed me, or
   deleted the film: RLS returns ZERO ROWS with no error) from a transient failure
   (network / expired token: an ERROR). Callers may only act on "gone" — "error"
   means try again later, never kick the user out over a blip. */
async function cloudCheckAccess(id){
  const sb = sbClient(); if(!sb || !id) return "error";
  try{
    const { data, error } = await sb.from("turn_projects").select("id").eq("id", id).maybeSingle();
    if(error) return "error";
    return data ? "ok" : "gone";
  }catch(e){ return "error"; }
}
window.cloudCheckAccess = cloudCheckAccess;
async function cloudRenameProject(id, title){
  const sb = sbClient(); if(!sb || !id) return;
  try{ await sb.from("turn_projects").update({ title }).eq("id", id); }catch(e){}
}
async function cloudDeleteProject(id){
  const sb = sbClient(); if(!sb || !id) return;
  try{ await sb.from("turn_projects").delete().eq("id", id); }catch(e){}
}
window.cloudListProjects = cloudListProjects;
window.cloudCreateProject = cloudCreateProject;
window.cloudLoadProject = cloudLoadProject;
window.cloudSaveDoc = cloudSaveDoc;
window.cloudRenameProject = cloudRenameProject;
window.cloudDeleteProject = cloudDeleteProject;

/* ── storage / generations (images) ──────────────────────────────────────────
   Images are uploaded to the private `turn-assets` bucket as real files; the
   turn_generations row keeps the storage path + metadata + reference list +
   version history (paths, not blobs). The app sees short-lived signed URLs. */
function turnBucket(){ const c = window.TURN_SUPABASE; return (c && c.bucket) || "turn-assets"; }
function dataUrlToBlob(dataUrl){
  const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  if(!m) return null;
  const mime = m[1] || "image/png";
  try{
    const bin = atob(m[2]); const u8 = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type:mime });
  }catch(e){ return null; }
}
const _signCache = new Map();   // path -> { url, exp }
async function cloudSignedUrl(path){
  if(!path) return "";
  const now = Date.now();
  const c = _signCache.get(path);
  if(c && c.exp > now + 30000) return c.url;
  const sb = sbClient(); if(!sb) return "";
  try{
    const { data, error } = await sb.storage.from(turnBucket()).createSignedUrl(path, 3600);
    if(error || !data) return "";
    _signCache.set(path, { url:data.signedUrl, exp: now + 3600*1000 });
    return data.signedUrl;
  }catch(e){ return ""; }
}
/* Batch sign many paths (cache-aware, chunked). Returns { path: url }. */
async function cloudSignedUrlsBatch(paths){
  const out = {}; const now = Date.now(); const need = [];
  for(const p of (paths||[])){ if(!p) continue; const c=_signCache.get(p);
    if(c && c.exp > now + 30000) out[p]=c.url; else if(need.indexOf(p)<0) need.push(p); }
  const sb = need.length ? sbClient() : null;
  if(sb){
    for(let i=0;i<need.length;i+=100){            // chunk so a big project stays within limits
      const chunk = need.slice(i, i+100);
      try{
        const { data } = await sb.storage.from(turnBucket()).createSignedUrls(chunk, 3600);
        for(const d of (data||[])){ if(d && d.signedUrl && d.path){
          _signCache.set(d.path, { url:d.signedUrl, exp: now + 3600*1000 }); out[d.path]=d.signedUrl; } }
      }catch(e){}
    }
  }
  return out;
}
/* Storage path convention (forward-only — see supabase/README.md and storage.sql):
     {userId}/{projectId}/{assetType}/{entityId}/{role}[-v{N}]-{timestamp}-{shortId}.png
   Level 1 MUST be the user id: RLS in storage.sql pins it to auth.uid(). Only stable
   IDs appear in the path — never mutable display names — so renaming a project or
   character never orphans a file. assetType ∈ character|prop|location|shot|cameo;
   role ∈ sheet|ref-<kind>|<cameo-angle>. The optional v{N} is a NON-AUTHORITATIVE
   version-at-birth hint (the live version shown in Details comes from the DB and
   stays correct after restore/delete; this filename token never changes). The
   {timestamp}-{shortId} remains the real uniqueness key (collision-proof). Old files
   keep their original paths and keep working; only new uploads use this. */
function turnSafeSeg(s){ return String(s==null?"":s).replace(/[^a-zA-Z0-9_:-]/g,"_"); }
function turnStamp(){
  const d = new Date(), p = (n)=>String(n).padStart(2,"0");   // sortable UTC YYYYMMDD-HHMMSS
  return ""+d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+"-"+p(d.getUTCHours())+p(d.getUTCMinutes())+p(d.getUTCSeconds());
}
function turnShortId(){
  const u = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(36).slice(2));
  return String(u).replace(/-/g,"").slice(0,8);
}
function turnStoragePath(uid, projectId, entityId, assetType, role, ext, version){
  const vtag = (version!=null && version!=="") ? ("v"+turnSafeSeg(version)+"-") : "";
  return uid+"/"+projectId+"/"+turnSafeSeg(assetType||"asset")+"/"+turnSafeSeg(entityId)+"/"
    + turnSafeSeg(role||"file")+"-"+vtag+turnStamp()+"-"+turnShortId()+"."+(ext||"png");
}
window.turnStoragePath = turnStoragePath;   // exposed for inspection / tests

async function cloudUploadImage(projectId, uid, entityId, dataUrl, assetType, role, version, allowRemote){
  const sb = sbClient(); if(!sb) return null;
  let blob = dataUrlToBlob(dataUrl);
  /* Generated project references are commonly short-lived signed HTTP URLs,
     not data URLs. Snapshot their bytes while the URL is valid so Details can
     keep showing the exact input after reload/expiry. Personal/device inputs
     are filtered out by the generation runner before cloudCommit receives
     refs, so this path remains project-material only. */
  if(!blob && allowRemote && /^(https?:|blob:)/i.test(String(dataUrl||""))){
    try{
      const response=await fetch(dataUrl);
      if(response.ok){
        const candidate=await response.blob();
        if(candidate && /^image\//i.test(candidate.type||"")) blob=candidate;
      }
    }catch(e){}
  }
  if(!blob) return null;
  const path = turnStoragePath(uid, projectId, entityId, assetType, role, "png", version);
  try{
    const { error } = await sb.storage.from(turnBucket()).upload(path, blob, { contentType:blob.type, upsert:false });
    if(error) return null;
    return path;
  }catch(e){ return null; }
}
async function cloudRemovePaths(paths){
  const sb = sbClient(), unique=Array.from(new Set((paths||[]).filter(Boolean)));
  if(!unique.length) return { ok:true };
  if(!sb) throw new Error("cloud cleanup unavailable");
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const { error }=await sb.storage.from(turnBucket()).remove(unique);
      if(!error) return { ok:true };
      last=error;
    }catch(e){ last=e; }
  }
  throw new Error("cloud cleanup failed: "+((last&&last.message)||"unknown error"));
}
function cloudRowPaths(row){
  const out=new Set(), add=(p)=>{ if(p) out.add(p); }, addRefs=(rs)=>{ for(const r of (rs||[])) add(r&&r.storage_path); };
  if(!row) return out;
  add(row.storage_path); addRefs(row.refs);
  for(const h of (row.history||[])){ add(h&&h.storage_path); addRefs(h&&h.refs); }
  return out;
}
function cloudApplySnapshot(q,row){
  for(const key of ["storage_path","meta","refs","history"]){
    const value=row ? row[key] : null;
    q=value==null ? q.is(key,null) : q.eq(key,(key==="storage_path"?value:JSON.stringify(value)));
  }
  return q;
}
async function cloudGetGenStrict(projectId, entityId){
  const sb=sbClient(); if(!sb) throw new Error("cloud unavailable");
  const { data,error }=await sb.from("turn_generations").select("*")
    .eq("project_id",projectId).eq("entity_id",entityId).maybeSingle();
  if(error) throw new Error(error.message||"cloud read failed");
  let row=data||null;
  if(row&&row.meta&&Array.isArray(row.meta.cleanupPending)&&row.meta.cleanupPending.length){
    const retried=await cloudFinishPending(projectId,row.owner,entityId,row);
    row=retried.row;
    if(row&&retried.warning) row={...row,_cleanupWarning:retried.warning};
  }
  return row;
}
async function cloudGetGen(projectId, entityId){
  try{ return await cloudGetGenStrict(projectId,entityId); }catch(e){ return null; }
}
async function cloudUpsertGen(projectId, uid, entityId, fields){
  const sb = sbClient(); if(!sb) return null;
  try{
    const { data,error } = await sb.from("turn_generations")
      .upsert({ project_id:projectId, owner:uid, entity_id:entityId, ...fields }, { onConflict:"project_id,entity_id" })
      .select().single();
    if(error) return null;
    return data || null;
  }catch(e){ return null; }
}
/* Best available optimistic CAS without a schema migration. It prevents an existing
   sheet from overwriting a collaborator who changed storage_path after our read.
   It cannot detect a metadata/history-only concurrent edit, nor atomically insert a
   previously absent row; a revision column/RPC would be needed for full CAS. */
async function cloudCasGen(projectId, uid, entityId, previous, fields){
  const sb=sbClient(); if(!sb) return null;
  try{
    if(!previous){
      const table=sb.from("turn_generations");
      /* Production uses insert-if-absent. The fallback only supports older recording
         adapters that predate insert(); Supabase clients always take the insert path. */
      const mutation=typeof table.insert==="function"
        ? table.insert({project_id:projectId,owner:uid,entity_id:entityId,...fields})
        : table.upsert({project_id:projectId,owner:uid,entity_id:entityId,...fields},{onConflict:"project_id,entity_id"});
      const {data,error}=await mutation.select().single();
      if(error) return null;
      return data||null;
    }
    let q=sb.from("turn_generations").update(fields)
      .eq("project_id",projectId).eq("entity_id",entityId);
    q=cloudApplySnapshot(q,previous);
    const { data,error }=await q.select().maybeSingle();
    if(error) return null;
    return data||null;
  }catch(e){ return null; }
}
function cloudPendingMeta(meta,paths,tombstone){
  const next={...(meta||{})}, pending=Array.from(new Set((paths||[]).filter(Boolean)));
  if(pending.length) next.cleanupPending=pending; else delete next.cleanupPending;
  if(tombstone) next.cleanupTombstone=true; else delete next.cleanupTombstone;
  return next;
}
async function cloudFinishPending(projectId,uid,entityId,row){
  const pending=row&&row.meta&&Array.isArray(row.meta.cleanupPending)?row.meta.cleanupPending:[];
  if(!pending.length) return {row,warning:null};
  const retained=cloudRowPaths(row), remove=pending.filter(p=>!retained.has(p));
  try{ await cloudRemovePaths(remove); }
  catch(e){ return {row,warning:e.message||"cloud cleanup failed"}; }
  const sb=sbClient();
  if(row.meta&&row.meta.cleanupTombstone){
    let q=sb.from("turn_generations").delete().eq("project_id",projectId).eq("entity_id",entityId);
    q=cloudApplySnapshot(q,row);
    const {data,error}=await q.select().maybeSingle();
    if(error||!data) return {row,warning:"cleanup completed; tombstone changed before removal"};
    return {row:null,warning:null};
  }
  const meta={...(row.meta||{})}; delete meta.cleanupPending; delete meta.cleanupTombstone;
  const after=await cloudCasGen(projectId,uid||row.owner,entityId,row,{
    storage_path:row.storage_path,meta,refs:row.refs||[],history:row.history||[]});
  return after ? {row:after,warning:null}
    : {row,warning:"cleanup completed; pending marker changed before removal"};
}
/* commit a new generation: upload image, roll the previous one into history,
   upload + store reference images, persist metadata. refs in = [{kind,label,url}]. */
async function cloudCommit(projectId, uid, entityId, dataUrl, meta, refs, kind, cancelled){
  const _cxl=()=>typeof cancelled==="function"&&!!cancelled();
  if(_cxl()) return { tier:"cancelled", url:dataUrl };
  const assetType = kind || "character";   // {assetType} path segment (see turnStoragePath)
  // version-at-birth hint in the filename (non-authoritative; the live version comes
  // from the DB). refs/cameo angles aren't versioned, so they pass no version.
  const ver = (meta && meta.version) || 1, created=[];
  let row;
  try{ row=await cloudGetGenStrict(projectId,entityId); }
  catch(e){ return { tier:"error", url:dataUrl, error:e.message||"cloud read failed" }; }
  if(_cxl()) return { tier:"cancelled", url:dataUrl };
  const newPath = await cloudUploadImage(projectId, uid, entityId, dataUrl, assetType, "sheet", ver);
  if(!newPath) return { tier:"error", url:dataUrl, error:"image upload failed" };
  created.push(newPath);
  if(_cxl()){ try{ await cloudRemovePaths(created); }catch(e){ return {tier:"error",url:dataUrl,error:e.message}; } return {tier:"cancelled",url:dataUrl}; }
  let history = (row && row.history) || [];
  let dropped=[];
  if(row && row.storage_path){
    history = [{ storage_path:row.storage_path, meta:row.meta||{}, refs:row.refs||[] }, ...history];
    if(history.length > 12){ dropped=history.slice(12); history = history.slice(0,12); }
  }
  const refRows = [];
  for(const r of (refs || [])){
    let p = null;
    if(r.url) p = await cloudUploadImage(projectId, uid, entityId, r.url, assetType, "ref-"+turnSafeSeg(r.kind||"img"),undefined,true);
    if(p) created.push(p);
    if(_cxl()){ try{ await cloudRemovePaths(created); }catch(e){ return {tier:"error",url:dataUrl,error:e.message}; } return {tier:"cancelled",url:dataUrl}; }
    refRows.push({ kind:r.kind, label:r.label, storage_path:p, refId:r.refId||undefined,
      refVersion:r.refVersion||undefined,refGenerated:r.refGenerated||undefined });
  }
  let cleanMeta={...(meta||{})}; delete cleanMeta.approval;
  const pendingBefore=(row&&row.meta&&row.meta.cleanupPending)||[];
  const provisional={storage_path:newPath,meta:cleanMeta,refs:refRows,history};
  const retained=cloudRowPaths(provisional);
  const trimPaths=Array.from(cloudRowPaths({history:dropped})).filter(p=>!retained.has(p));
  cleanMeta=cloudPendingMeta(cleanMeta,[...pendingBefore,...trimPaths],false);
  const fields = { storage_path:newPath, meta:cleanMeta, refs:refRows, history };
  if(_cxl()){ try{ await cloudRemovePaths(created); }catch(e){ return {tier:"error",url:dataUrl,error:e.message}; } return {tier:"cancelled",url:dataUrl}; }
  /* Signing is read-only, but doing it before the row mutation removes another
     cancellation window after durable success. */
  const url = await cloudSignedUrl(newPath);
  if(_cxl()){ try{ await cloudRemovePaths(created); }catch(e){ return {tier:"error",url:dataUrl,error:e.message}; } return {tier:"cancelled",url:dataUrl}; }
  if(!url){
    try{ await cloudRemovePaths(created); }catch(e){ return {tier:"error",url:dataUrl,error:e.message}; }
    return {tier:"error",url:dataUrl,error:"signed URL failed"};
  }
  let written=await cloudCasGen(projectId,uid,entityId,row,fields);
  if(!written || written.storage_path!==newPath){
    let live=null, readbackFailed=false;
    try{ live=await cloudGetGenStrict(projectId,entityId); }catch(e){ readbackFailed=true; }
    // Returning representation can fail independently of an already-committed
    // mutation. A strict reread is the verification; upload success alone never is.
    if(live && live.storage_path===newPath) written=live;
    else{
      /* If both the mutation response and readback are inconclusive, the write may
         have landed. Deleting its unique bytes could corrupt that live row. Report
         the uncertain outcome and leave cleanup to a later explicit user action. */
      if(readbackFailed) return {tier:"error",url:dataUrl,path:newPath,persisted:"unknown",
        error:"generation row write outcome could not be verified"};
      try{ await cloudRemovePaths(created.filter(p=>!cloudRowPaths(live).has(p))); }
      catch(e){ return {tier:"error",url:dataUrl,error:e.message}; }
      return { tier:"error",url:dataUrl,retry:!row,
        error:!row?"another client created this asset; retry against its preserved version":"generation row write failed" };
    }
  }
  if(!written || written.storage_path!==newPath){
    return { tier:"error",url:dataUrl,error:"generation row write failed" };
  }
  const compensateCancellation=async(snapshot)=>{
    const sb=sbClient();
    let compensated=null, compensationError=null;
    try{
      if(row){
        const restore={storage_path:row.storage_path,meta:row.meta||{},refs:row.refs||[],history:row.history||[]};
        let q=sb.from("turn_generations").update(restore).eq("project_id",projectId).eq("entity_id",entityId);
        q=cloudApplySnapshot(q,snapshot);
        const result=await q.select().maybeSingle();
        if(result.error) compensationError=result.error;
        else compensated=result.data||null;
      }else{
        let q=sb.from("turn_generations").delete().eq("project_id",projectId).eq("entity_id",entityId);
        q=cloudApplySnapshot(q,snapshot);
        const result=await q.select().maybeSingle();
        if(result.error) compensationError=result.error;
        else compensated=result.data||null;
      }
    }catch(e){ compensationError=e; }
    let live;
    try{ live=await cloudGetGenStrict(projectId,entityId); }
    catch(e){ return {tier:"cancellation-error",url:dataUrl,path:newPath,persisted:"unknown",
      error:"cancellation rollback could not be verified"}; }
    if(live && live.storage_path===newPath && !compensated)
      return {tier:"cancellation-error",url:dataUrl,path:newPath,persisted:true,
        error:"cancellation rollback failed: "+((compensationError&&compensationError.message)||"conditional mutation failed")};
    /* A zero-row compensation means a newer collaborator already replaced this write.
       Never clear that result; only remove our unique files if it does not retain them. */
    try{ await cloudRemovePaths(created.filter(p=>!cloudRowPaths(live).has(p))); }
    catch(e){ return {tier:"cancellation-error",url:dataUrl,persisted:!!(live&&live.storage_path===newPath),error:e.message}; }
    return { tier:"cancelled",url:dataUrl, compensated:!!compensated };
  };
  if(_cxl()){
    return await compensateCancellation(written);
  }
  const hadPending=!!(written.meta&&Array.isArray(written.meta.cleanupPending)
    && written.meta.cleanupPending.length);
  const finished=await cloudFinishPending(projectId,uid,entityId,written);
  if(_cxl()){
    /* Once tracked old files may have been removed, restoring the prior row could
       point it at missing history/reference bytes. Surface the persisted outcome
       rather than claiming discard or performing an unsafe rollback. */
    if(hadPending) return {tier:"cancellation-error",url:dataUrl,path:newPath,persisted:true,
      ...(finished.warning?{cleanupWarning:finished.warning}:{}),
      error:"cancelled during final cleanup; saved generation could not be safely rolled back"};
    return await compensateCancellation(finished.row||written);
  }
  return { tier:"cloud", url, path:newPath,...(finished.warning?{cleanupWarning:finished.warning}:{}) };
}
async function cloudAssetLoad(projectId, entityId){
  const row = await cloudGetGen(projectId, entityId);
  if(!row || !row.storage_path) return null;
  const url = await cloudSignedUrl(row.storage_path);
  return { url, path: row.storage_path, meta: row.meta || null };
}
/* Batch-load many assets: ONE lean DB query for all entity ids + ONE batched signing,
   instead of a query+sign per entity. Returns { entityId: { url, meta } }. Used to
   pre-warm the image cache so a tab (e.g. Characters) shows instantly. */
async function cloudAssetLoadMany(projectId, entityIds, strict){
  const sb = sbClient();
  const ids = Array.from(new Set((entityIds||[]).filter(Boolean)));
  if(!sb){ if(strict) throw new Error("cloud unavailable"); return {}; }
  if(!ids.length) return {};
  let rows = [];
  try{
    // strict mode surfaces query failures (throws) so callers can tell a genuine
    // "no assets" result apart from a transient read failure; default stays lenient.
    const { data, error } = await sb.from("turn_generations")
      .select("entity_id, storage_path, meta")
      .eq("project_id", projectId).in("entity_id", ids);
    if(error) throw error;
    rows = data || [];
  }catch(e){ if(strict) throw e; return {}; }
  const urlByPath = await cloudSignedUrlsBatch(rows.filter(r=>r.storage_path).map(r=>r.storage_path));
  const out = {};
  for(const r of rows){ const u = r.storage_path && urlByPath[r.storage_path]; if(u) out[r.entity_id] = { url:u, path:r.storage_path, meta:r.meta||null }; }
  return out;
}
/* Load EVERY current asset in a project in one lean query + batched signing. Format-agnostic
   (covers characters, props, locations, shots, variants — whatever has a generation), so the
   whole Art Room can be pre-warmed at once. Returns { entityId: { url, meta } }. */
async function cloudAssetLoadAll(projectId){
  const sb = sbClient();
  if(!sb || !projectId) return {};
  let rows = [];
  try{
    const { data } = await sb.from("turn_generations")
      .select("entity_id, storage_path, meta").eq("project_id", projectId);
    rows = data || [];
  }catch(e){ return {}; }
  /* A cleared asset's tombstone has no card to trigger a later entity-specific read.
     Project prewarm is the bounded, one-shot recovery point: inspect only tracked
     cleanup markers (never sweep storage), and retry at most 20 with concurrency 3.
     Failures leave cleanupPending intact for a future prewarm. */
  const pending=rows.filter(r=>r&&r.meta&&Array.isArray(r.meta.cleanupPending)
    && r.meta.cleanupPending.length).slice(0,20);
  if(pending.length){
    let cursor=0;
    const workers=Array.from({length:Math.min(3,pending.length)},async()=>{
      while(cursor<pending.length){
        const item=pending[cursor++];
        try{
          const refreshed=await cloudGetGenStrict(projectId,item.entity_id);
          const at=rows.findIndex(r=>r.entity_id===item.entity_id);
          if(at>=0){ if(refreshed) rows[at]=refreshed; else rows.splice(at,1); }
        }catch(e){} // marker remains durable; there is deliberately no immediate loop
      }
    });
    await Promise.all(workers);
  }
  const urlByPath = await cloudSignedUrlsBatch(rows.filter(r=>r.storage_path).map(r=>r.storage_path));
  const out = {};
  for(const r of rows){ const u = r.storage_path && urlByPath[r.storage_path]; if(u) out[r.entity_id] = { url:u, path:r.storage_path, meta:r.meta||null }; }
  return out;
}
async function cloudClear(projectId, entityId){
  const row = await cloudGetGenStrict(projectId, entityId);
  if(!row) return {ok:true};
  const paths=[...((row.meta&&row.meta.cleanupPending)||[]),...Array.from(cloudRowPaths(row))];
  const tombstone={storage_path:null,meta:cloudPendingMeta({},paths,true),refs:[],history:[]};
  const saved=await cloudCasGen(projectId,row.owner,entityId,row,tombstone);
  if(!saved) throw new Error("asset changed; clear refused");
  const finished=await cloudFinishPending(projectId,row.owner,entityId,saved);
  return {ok:true,...(finished.warning?{cleanupWarning:finished.warning}:{})};
}

/* ── video takes (Stage clips) ────────────────────────────────────────────────
   A clip's takes are small JSON (fal CDN urls + render facts), so the durable
   record is the turn_generations ROW itself: entity_id = the clip's stable id
   ("clip-…"), storage_path stays untouched/NULL (the image loaders skip
   path-less rows), meta = { kind:"video", video:{url,meta}, updatedAt }. Same
   table → the same collaboration RLS as every other asset, no new migration.
   These THROW on failure — the video store keeps a dirty ledger and retries;
   a silent null here is how paid takes used to die with a browser profile. */
async function cloudCommitVideo(projectId, uid, clipId, entry){
  const sb = sbClient();
  if(!sb || !projectId || !clipId) throw new Error("cloud unavailable");
  const meta = { kind:"video", updatedAt:Date.now(),
    video:{ url:(entry&&entry.url)||"", meta:(entry&&entry.meta)||null } };
  const { error } = await sb.from("turn_generations")
    .upsert({ project_id:projectId, owner:uid, entity_id:clipId, meta }, { onConflict:"project_id,entity_id" });
  if(error) throw new Error(error.message||"cloud save failed");
  return { ok:true };
}
async function cloudVideoDelete(projectId, clipId){
  const sb = sbClient();
  if(!sb || !projectId || !clipId) throw new Error("cloud unavailable");
  const { error } = await sb.from("turn_generations").delete()
    .eq("project_id", projectId).eq("entity_id", clipId);
  if(error) throw new Error(error.message||"cloud delete failed");
  return { ok:true };
}
/* all of one film's take records in one query. Returns { clipId:{url,meta} },
   or NULL when the query itself failed (≠ "no videos") so the caller can keep
   its local cache instead of treating a blip as an empty film. */
async function cloudVideoLoadAll(projectId){
  const sb = sbClient(); if(!sb || !projectId) return null;
  try{
    const { data, error } = await sb.from("turn_generations")
      .select("entity_id, meta").eq("project_id", projectId).like("entity_id","clip-%");
    if(error) return null;
    const out = {};
    for(const r of (data||[])){
      const v = r && r.meta && r.meta.kind==="video" && r.meta.video;
      if(v && v.url) out[r.entity_id] = { url:v.url, meta:v.meta||null };
    }
    return out;
  }catch(e){ return null; }
}
window.cloudCommitVideo = cloudCommitVideo;
window.cloudVideoDelete = cloudVideoDelete;
window.cloudVideoLoadAll = cloudVideoLoadAll;
async function cloudRevert(projectId, uid, entityId, index){
  const row = await cloudGetGenStrict(projectId, entityId);
  if(!row) return null;
  const history = (row.history || []).slice();
  if(index<0 || index>=history.length) return null;
  const chosen = history[index];
  const present = { storage_path:row.storage_path, meta:row.meta||{}, refs:row.refs||[] };
  let newHist = history.filter((_,i)=>i!==index);
  if(present.storage_path) newHist.unshift(present);
  const provisional={storage_path:chosen.storage_path,meta:chosen.meta||{},refs:chosen.refs||[],history:newHist.slice(0,12)};
  const remove=Array.from(cloudRowPaths(row)).filter(p=>!cloudRowPaths(provisional).has(p));
  provisional.meta=cloudPendingMeta(provisional.meta,[...((row.meta&&row.meta.cleanupPending)||[]),...remove],false);
  const after=await cloudCasGen(projectId, uid, entityId,row,provisional);
  if(!after) throw new Error("asset changed; revert refused");
  const finished=await cloudFinishPending(projectId,uid,entityId,after);
  const url = await cloudSignedUrl(chosen.storage_path);
  return { url, meta: chosen.meta || null,...(finished.warning?{cleanupWarning:finished.warning}:{}) };
}
/* delete the CURRENT image, promote the newest prior version, and do NOT keep the
   deleted current image in history. Used by Image Details' "Delete current" action. */
async function cloudDeleteCurrentAndPromote(projectId, uid, entityId){
  const row = await cloudGetGenStrict(projectId, entityId);
  if(!row) return null;
  const history = (row.history || []).slice();
  if(!history.length) return null;
  const chosen = history.shift();
  const provisional={
    storage_path:chosen.storage_path,
    meta:chosen.meta||{},
    refs:chosen.refs||[],
    history:history.slice(0,12),
  };
  const remove=Array.from(cloudRowPaths(row)).filter(p=>!cloudRowPaths(provisional).has(p));
  provisional.meta=cloudPendingMeta(provisional.meta,[...((row.meta&&row.meta.cleanupPending)||[]),...remove],false);
  const after=await cloudCasGen(projectId, uid, entityId,row,provisional);
  if(!after) throw new Error("asset changed; delete refused");
  const finished=await cloudFinishPending(projectId,uid,entityId,after);
  const url = await cloudSignedUrl(chosen.storage_path);
  return { url, meta: chosen.meta || null,...(finished.warning?{cleanupWarning:finished.warning}:{}) };
}
window.cloudDeleteCurrentAndPromote = cloudDeleteCurrentAndPromote;
/* delete ONE history entry (and its stored image) from a cloud generation row. */
async function cloudDeleteHistoryEntry(projectId, uid, entityId, index){
  const row = await cloudGetGenStrict(projectId, entityId);
  if(!row) return false;
  const history = (row.history || []).slice();
  if(index<0 || index>=history.length) return false;
  history.splice(index,1);
  const provisional={storage_path:row.storage_path,meta:row.meta||{},refs:row.refs||[],history};
  const remove=Array.from(cloudRowPaths(row)).filter(p=>!cloudRowPaths(provisional).has(p));
  provisional.meta=cloudPendingMeta(provisional.meta,[...((row.meta&&row.meta.cleanupPending)||[]),...remove],false);
  const after=await cloudCasGen(projectId, uid, entityId,row,provisional);
  if(!after) throw new Error("asset changed; history delete refused");
  const finished=await cloudFinishPending(projectId,uid,entityId,after);
  return finished.warning?{ok:true,cleanupWarning:finished.warning}:true;
}
window.cloudDeleteHistoryEntry = cloudDeleteHistoryEntry;
async function cloudSetAssetApproval(projectId, uid, entityId, expectedIso, approved, reviewKey){
  const row=await cloudGetGenStrict(projectId,entityId);
  if(!row || !row.storage_path) return {ok:false,error:"asset not found"};
  if(!expectedIso || !row.meta || row.meta.iso!==expectedIso) return {ok:false,error:"asset version changed"};
  const approval={iso:expectedIso,approved:!!approved,at:new Date().toISOString()};
  if(reviewKey!=null) approval.reviewKey=String(reviewKey);
  const meta={...(row.meta||{}),approval};
  const after=await cloudCasGen(projectId,uid,entityId,row,{
    storage_path:row.storage_path,meta,refs:row.refs||[],history:row.history||[]});
  if(!after || after.storage_path!==row.storage_path || !after.meta || after.meta.iso!==expectedIso)
    return {ok:false,error:"asset version changed"};
  return {ok:true,meta:after.meta};
}
window.cloudSetAssetApproval=cloudSetAssetApproval;
async function cloudLoadDetails(projectId, entityId){
  const row = await cloudGetGen(projectId, entityId);
  if(!row) return { id:entityId, url:"", meta:null, refs:[], history:[] };
  const url = row.storage_path ? await cloudSignedUrl(row.storage_path) : "";
  const rawHistory=row.history||[];
  const history=[];
  for(const h of rawHistory) history.push({url:h.storage_path?await cloudSignedUrl(h.storage_path):"",meta:h.meta||{},refs:[]});
  const missingIds=[];
  const allRefSets=[row.refs||[],...rawHistory.map(h=>h.refs||[])];
  for(const set of allRefSets){ for(const r of set){
      if(!r.storage_path && r.refId) missingIds.push(r.refId);
      // Legacy character/prop state sheets used parentId:stateId but did not
      // persist the parent id on their Base sheet reference.
      if(!r.storage_path && !r.refId && r.kind==="base" && String(entityId).includes(":"))
        missingIds.push(String(entityId).slice(0,String(entityId).lastIndexOf(":")));
  }}
  const liveFallbacks=missingIds.length ? await cloudAssetLoadMany(projectId,missingIds) : {};
  const resolveRefs=async(rawRefs,previous)=>{
    const out=[];
    for(const r of (rawRefs||[])){
      let refUrl=r.storage_path ? await cloudSignedUrl(r.storage_path) : "";
      let recovered="";
      let version=r.refVersion||null;
      let resolvedVersion=version;
      let resolvedGenerated=r.refGenerated||"";
      // Existing rows created before HTTP reference snapshots were supported can
      // still resolve a generated project asset by its stable entity id.
      if(!refUrl && r.refId && liveFallbacks[r.refId] && liveFallbacks[r.refId].url){
        refUrl=liveFallbacks[r.refId].url; recovered="current-project-asset";
        const liveMeta=liveFallbacks[r.refId].meta||{};
        resolvedVersion=liveMeta.version||null;
        resolvedGenerated=liveMeta.iso||"";
        version=version||resolvedVersion;
      }
      // A self-update's Base sheet is the immediately preceding version, which is
      // an exact historical input and safer than resolving the new current image.
      if(!refUrl && r.kind==="base" && previous && previous.url){
        refUrl=previous.url; recovered="previous-version";
        version=version||(previous.meta&&previous.meta.version)||null;
        resolvedVersion=(previous.meta&&previous.meta.version)||version;
        resolvedGenerated=(previous.meta&&previous.meta.iso)||r.refGenerated||"";
      }
      if(!refUrl && r.kind==="base" && !r.refId && String(entityId).includes(":")){
        const parentId=String(entityId).slice(0,String(entityId).lastIndexOf(":"));
        if(liveFallbacks[parentId]&&liveFallbacks[parentId].url){
          refUrl=liveFallbacks[parentId].url; recovered="current-project-asset";
          const liveMeta=liveFallbacks[parentId].meta||{};
          resolvedVersion=liveMeta.version||null;
          resolvedGenerated=liveMeta.iso||"";
          version=version||resolvedVersion;
        }
      }
      out.push({kind:r.kind,label:r.label,refId:r.refId,url:refUrl,recovered,
        refVersion:version,refGenerated:r.refGenerated||"",
        resolvedVersion:resolvedVersion||version,resolvedGenerated});
    }
    return out;
  };
  const refs=await resolveRefs(row.refs||[],history[0]||null);
  for(let i=0;i<history.length;i++){
    history[i].refs=await resolveRefs((rawHistory[i]&&rawHistory[i].refs)||[],history[i+1]||null);
  }
  return { id:entityId, url, meta: row.meta || null, refs, history };
}
window.cloudCommit = cloudCommit;
window.cloudAssetLoad = cloudAssetLoad;
window.cloudAssetLoadMany = cloudAssetLoadMany;
window.cloudAssetLoadAll = cloudAssetLoadAll;
window.cloudClear = cloudClear;
window.cloudRevert = cloudRevert;
window.cloudLoadDetails = cloudLoadDetails;
window.cloudGetGen = cloudGetGen;
window.cloudSignedUrl = cloudSignedUrl;

/* ── cameos (Increment B cloud sync) ─────────────────────────────────────────
   Opt-in only. Face angles are uploaded as private files (same per-user RLS as
   generations); the turn_cameos row keeps storage paths + provenance (paths,
   not blobs). Local IDB remains the source of truth; cloud is for cross-device. */
async function cloudCameoRow(projectId, charId){
  const sb = sbClient(); if(!sb) return null;
  try{ const { data } = await sb.from("turn_cameos").select("*")
    .eq("project_id",projectId).eq("char_id",charId).maybeSingle(); return data||null; }catch(e){ return null; }
}
async function cloudSyncCameo(projectId, uid, charId, rec){
  const sb = sbClient(); if(!sb) return null;
  /* drop any prior cloud copy's files first (replace semantics) */
  const prev = await cloudCameoRow(projectId, charId);
  if(prev && prev.angles){ try{ await sb.storage.from(turnBucket()).remove((prev.angles||[]).map(a=>a.storage_path).filter(Boolean)); }catch(e){} }
  const angleRows = [];
  for(const a of (rec.angles||[])){
    const p = await cloudUploadImage(projectId, uid, charId, a.url, "cameo", turnSafeSeg(a.label||"angle"));
    if(p) angleRows.push({ label:a.label, storage_path:p });
  }
  const prov = { consent:!!rec.consent, source:rec.source||"webcam", subject:rec.subject||"",
    iso:rec.iso, date:rec.date, w:rec.w||0, h:rec.h||0 };
  try{
    await sb.from("turn_cameos").upsert({ project_id:projectId, owner:uid, char_id:charId,
      angles:angleRows, prov:prov }, { onConflict:"project_id,char_id" });
    return true;
  }catch(e){ return null; }
}
async function cloudLoadCameo(projectId, charId){
  const row = await cloudCameoRow(projectId, charId);
  if(!row || !row.angles) return null;
  const angles = [];
  for(const a of row.angles){ const url = a.storage_path ? await cloudSignedUrl(a.storage_path) : ""; if(url) angles.push({ label:a.label, url }); }
  const p = row.prov || {};
  return { angles, url: angles.length?angles[0].url:"", consent:!!p.consent, sync:true,
    source:p.source||"webcam", subject:p.subject||"", iso:p.iso, date:p.date, w:p.w||0, h:p.h||0 };
}
async function cloudDeleteCameo(projectId, charId){
  const sb = sbClient(); if(!sb) return;
  const row = await cloudCameoRow(projectId, charId);
  if(row && row.angles){ try{ await sb.storage.from(turnBucket()).remove((row.angles||[]).map(a=>a.storage_path).filter(Boolean)); }catch(e){} }
  try{ await sb.from("turn_cameos").delete().eq("project_id",projectId).eq("char_id",charId); }catch(e){}
}
window.cloudSyncCameo = cloudSyncCameo;
window.cloudLoadCameo = cloudLoadCameo;
window.cloudDeleteCameo = cloudDeleteCameo;

/* ── render styles (locked "Surprise me" styles) ──────────────────────────────
   Two tiers (see supabase/styles.sql):
     • turn_user_styles   — PERSONAL, RLS-scoped to the owner (cross-device sync).
     • turn_global_styles — admin-curated HOUSE styles; everyone reads, admin writes.
   All no-op gracefully when Supabase isn't configured. Shapes: {key,label,render}.
   Global render blocks may carry app metadata keys such as __hidden / __order;
   artroom.jsx strips those before using the style block in prompts. */
async function cloudListUserStyles(){
  const sb = sbClient(); if(!sb) return [];
  try{
    const { data, error } = await sb.from("turn_user_styles").select("style_key,label,render").order("created_at",{ ascending:true });
    if(error) return [];
    return (data||[]).map(r=>({ key:r.style_key, label:r.label, render:r.render }));
  }catch(e){ return []; }
}
async function cloudSaveUserStyle(key, label, render){
  const sb = sbClient(); if(!sb || !key) return false;
  const session = await cloudGetSession(); const uid = session && session.user && session.user.id; if(!uid) return false;
  try{
    const { error } = await sb.from("turn_user_styles")
      .upsert({ owner:uid, style_key:key, label:label||"Locked style", render:render||{} }, { onConflict:"owner,style_key" });
    return !error;
  }catch(e){ return false; }
}
async function cloudDeleteUserStyle(key){
  const sb = sbClient(); if(!sb || !key) return false;
  try{ const { error } = await sb.from("turn_user_styles").delete().eq("style_key", key); return !error; }catch(e){ return false; }
}
async function cloudListGlobalStyles(){
  const sb = sbClient(); if(!sb) return [];
  try{
    const { data, error } = await sb.from("turn_global_styles").select("style_key,label,render").order("created_at",{ ascending:true });
    if(error) return [];
    return (data||[]).map(r=>({ key:r.style_key, label:r.label, render:r.render }));
  }catch(e){ return []; }
}
async function cloudSaveGlobalStyle(key, label, render){
  const sb = sbClient(); if(!sb || !key) return false;
  const session = await cloudGetSession(); const uid = session && session.user && session.user.id;
  try{
    const { error } = await sb.from("turn_global_styles")
      .upsert({ style_key:key, label:label||"House style", render:render||{}, created_by:uid||null }, { onConflict:"style_key" });
    return !error;     // RLS rejects non-admins → error truthy → false
  }catch(e){ return false; }
}
async function cloudDeleteGlobalStyle(key){
  const sb = sbClient(); if(!sb || !key) return false;
  try{ const { error } = await sb.from("turn_global_styles").delete().eq("style_key", key); return !error; }catch(e){ return false; }
}
window.cloudListUserStyles = cloudListUserStyles;
window.cloudSaveUserStyle = cloudSaveUserStyle;
window.cloudDeleteUserStyle = cloudDeleteUserStyle;
window.cloudListGlobalStyles = cloudListGlobalStyles;
window.cloudSaveGlobalStyle = cloudSaveGlobalStyle;
window.cloudDeleteGlobalStyle = cloudDeleteGlobalStyle;

/* ---- app config (admin-editable global settings, e.g. plan-card copy) ----------
   Public READ (the landing shows plan cards to signed-out visitors); admin-only
   WRITE, enforced by RLS (supabase/app-config.sql). */
async function cloudGetAppConfig(key){
  const sb = sbClient(); if(!sb || !key) return null;
  try{ const { data, error } = await sb.from("turn_app_config").select("value").eq("key", key).maybeSingle();
    if(error) return null; return data ? data.value : null;
  }catch(e){ return null; }
}
async function cloudSaveAppConfig(key, value){
  const sb = sbClient(); if(!sb || !key) return false;
  try{ const { error } = await sb.from("turn_app_config").upsert({ key, value }, { onConflict:"key" });
    return !error;     // RLS rejects non-admins → error truthy → false
  }catch(e){ return false; }
}
window.cloudGetAppConfig = cloudGetAppConfig;
window.cloudSaveAppConfig = cloudSaveAppConfig;

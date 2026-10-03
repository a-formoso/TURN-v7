/* cloud.jsx — Supabase integration for Kinolot (codename TURN).
   Increment 1: client initialisation + authentication (email + password).
   Projects, cloud doc sync, and the cloud image storage adapter are layered on
   in later increments. Everything here no-ops gracefully when Supabase isn't
   configured or the library hasn't loaded, so the app still runs locally. */

/* ── client ──────────────────────────────────────────────────────────────── */
function _cloudWaitMs(kind){
  const override=Number(window.__TURN_CLOUD_TIMEOUT_MS);
  if(Number.isFinite(override)&&override>0) return Math.max(10,Math.min(60000,override));
  /* "save": a fenced doc read/write can carry a multi-MB film over a slow uplink,
     so it gets a long deadline. It still needs one: a request that never settles
     used to leave the chip on SAVING and block every queued save behind it. */
  return kind==="auth" ? 6000 : kind==="save" ? 60000 : 12000;
}
function _cloudDeadline(promise, kind, label){
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const error=new Error((label||"Cloud request")+" timed out.");
      error.code="TURN_CLOUD_TIMEOUT";
      reject(error);
    },_cloudWaitMs(kind));
  });
  return Promise.race([Promise.resolve(promise),timeout]).finally(()=>{ if(timer) clearTimeout(timer); });
}
function _cloudQuery(builder,label,kind){
  let request=builder, controller=null;
  try{
    if(typeof AbortController!=="undefined" && request && typeof request.abortSignal==="function"){
      controller=new AbortController();
      request=request.abortSignal(controller.signal);
    }
  }catch(e){ controller=null; request=builder; }
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      try{ controller&&controller.abort(); }catch(e){}
      const error=new Error((label||"Cloud request")+" timed out.");
      error.code="TURN_CLOUD_TIMEOUT";
      reject(error);
    },_cloudWaitMs(kind||"request"));
  });
  return Promise.race([Promise.resolve(request),timeout]).finally(()=>{ if(timer) clearTimeout(timer); });
}
/* REMEMBER ME (owner request 2026-10-03). Ticked (the default): the session is kept, as before.
   Unticked: it lasts until the browser closes — a session cookie (no expiry, shared by every tab)
   marks it alive, and when a new browser session starts without that cookie the saved session is
   dropped from this browser BEFORE the client reads it. Only this browser; other devices are untouched. */
const REMEMBER_FLAG = "turn-forget-session", ALIVE_COOKIE = "turn_session_alive";
function _sessionCookieAlive(){ try{ return document.cookie.split(/;\s*/).some(c=>c===ALIVE_COOKIE+"=1"); }catch(e){ return true; } }
function _markSessionCookie(){
  try{ document.cookie = ALIVE_COOKIE+"=1; path=/; SameSite=Lax"+(location.protocol==="https:" ? "; Secure" : ""); }catch(e){}
}
function _forgetEndedSession(){
  try{
    if(localStorage.getItem(REMEMBER_FLAG)==="1" && !_sessionCookieAlive()){
      localStorage.removeItem("turn-auth");
      localStorage.removeItem(REMEMBER_FLAG);
    }
  }catch(e){}
}
function cloudSetRememberMe(remember){
  try{
    if(remember){ localStorage.removeItem(REMEMBER_FLAG); }
    else { localStorage.setItem(REMEMBER_FLAG, "1"); _markSessionCookie(); }
  }catch(e){}
}
window.cloudSetRememberMe = cloudSetRememberMe;
function sbClient(){
  if(window._sbClient) return window._sbClient;
  const cfg = window.TURN_SUPABASE;
  if(!cfg || !cfg.url || !cfg.anonKey || !window.supabase || !window.supabase.createClient) return null;
  _forgetEndedSession();
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
let _cloudSessionSnapshot=null;
function _cloudRememberSession(session){
  _cloudSessionSnapshot=(session&&session.user)?session:null;
  return _cloudSessionSnapshot;
}
/* THE CHOSEN PLAN RIDES THE ACCOUNT (billing fixes, 2026-09-30). A visitor who picks a
   plan on the landing page and confirms their email later — or in another browser — used
   to lose the choice (it lived only in this browser's localStorage for 20 minutes). The
   choice is now also saved in the new account's user metadata at sign-up
   (intended_plan + intended_plan_at), and app.jsx opens that plan's checkout on the first
   signed-in load wherever the email is confirmed, then clears it. Only a real plan tier is
   stored; "free" / nothing stores nothing. User metadata is user-editable: it only ever
   decides which checkout OPENS, never what anyone is granted. */
const INTENT_TIERS = ["writer","director","studio"];
function cloudIntendedPlanFromStorage(){
  try{
    const p = String(localStorage.getItem("turn-intended-plan")||"").toLowerCase().trim();
    return INTENT_TIERS.indexOf(p)>=0 ? p : "";
  }catch(e){ return ""; }
}
async function cloudSignUp(email, password, opts){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  const plan = String((opts && opts.plan) || cloudIntendedPlanFromStorage() || "").toLowerCase().trim();
  const data = INTENT_TIERS.indexOf(plan)>=0 ? { intended_plan:plan, intended_plan_at:new Date().toISOString() } : null;
  return sb.auth.signUp(data ? { email, password, options:{ data } } : { email, password });
}
/* the account's saved plan choice, or null ({ plan, at } with at in ms) */
function cloudAccountIntendedPlan(session){
  const m = (session && session.user && session.user.user_metadata) || {};
  const plan = String(m.intended_plan||"").toLowerCase().trim();
  if(INTENT_TIERS.indexOf(plan)<0) return null;
  const at = Date.parse(String(m.intended_plan_at||"")) || 0;
  return { plan, at };
}
/* consume it: best-effort, so a later sign-in never reopens a checkout */
async function cloudClearAccountIntendedPlan(){
  const sb = sbClient(); if(!sb || !sb.auth || typeof sb.auth.updateUser!=="function") return false;
  try{
    const { error } = await sb.auth.updateUser({ data:{ intended_plan:null, intended_plan_at:null } });
    return !error;
  }catch(e){ return false; }
}
window.cloudAccountIntendedPlan = cloudAccountIntendedPlan;
window.cloudClearAccountIntendedPlan = cloudClearAccountIntendedPlan;
async function cloudSignIn(email, password){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  return sb.auth.signInWithPassword({ email, password });
}
async function cloudSignOut(){
  const sb = sbClient(); if(!sb) return;
  try{ await sb.auth.signOut(); }catch(e){} finally{ _cloudRememberSession(null); }
}
async function cloudResetPassword(email){
  const sb = sbClient(); if(!sb) return { error:{ message:"Cloud not configured." } };
  return sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
}
async function cloudGetSession(){
  const sb = sbClient(); if(!sb) return null;
  try{
    const { data } = await _cloudDeadline(sb.auth.getSession(),"auth","Session check");
    const session=data&&data.session;
    // A subscribed SIGNED_OUT event owns cache invalidation. Do not let a stale
    // null getSession result erase a newer INITIAL_SESSION/TOKEN_REFRESHED event.
    return session ? _cloudRememberSession(session) : _cloudSessionSnapshot;
  }catch(e){
    // Supabase auth can wait behind a stale Web Lock after a tab sleeps. The most
    // recent auth event is still sufficient to let ordinary requests refresh the
    // token themselves, so a bounded session check must not strand app bootstrap.
    return _cloudSessionSnapshot;
  }
}
/* subscribe to auth changes; returns an unsubscribe fn */
function cloudOnAuth(cb){
  const sb = sbClient(); if(!sb) return ()=>{};
  const { data } = sb.auth.onAuthStateChange((_event, session)=>{ try{ cb(_cloudRememberSession(session)); }catch(e){} });
  return ()=>{ try{ data.subscription.unsubscribe(); }catch(e){} };
}
function cloudUserEmail(session){ return session && session.user ? (session.user.email||"") : ""; }
function cloudUserId(session){ return session && session.user ? session.user.id : null; }
/* An email's HANDLE as a name (screenplay credit, 2026-09-28): the local part with any "+tag"
   dropped (a sorting tag, never part of the name: "jane+kinolot" -> "Jane"), separators read as
   spaces ("jane.doe" -> "Jane Doe"). "" for no email. */
function cloudHandleName(email){
  const local = String(email||"").split("@")[0].split("+")[0].trim();
  if(!local) return "";
  const words = local.split(/[._-]+/).filter(Boolean);
  return words.map(w=> /^[a-z]/.test(w) ? w.charAt(0).toUpperCase()+w.slice(1) : w).join(" ").slice(0, 80);
}
/* The name a screenplay export credits as its writer (owner, 2026-09-28): the account's own
   display name when it has one, else its handle (cloudHandleName). "" when signed out — the export
   then omits the credit. On a film shared WITH this user the export credits the film's owner
   instead (app.jsx window.turnOpenFilmCredit), never the collaborator who presses Export. */
function cloudUserDisplayName(session){
  const u = session && session.user; if(!u) return "";
  const m = u.user_metadata || {};
  for(const k of ["display_name","full_name","name","user_name","preferred_username"]){
    const v = typeof m[k]==="string" ? m[k].replace(/\s+/g," ").trim() : "";
    if(v) return v.slice(0, 80);
  }
  return cloudHandleName(u.email);
}

window.cloudSignUp = cloudSignUp;
/* the trial welcome (app.jsx) is shown once per ACCOUNT: remembered in its user metadata, so it
   doesn't come back on another device; best effort (a failed write only means it may show again) */
function cloudTrialWelcomeSeen(session){
  const m = (session && session.user && session.user.user_metadata) || {};
  return m.turn_trial_welcome_seen === true;
}
async function cloudMarkTrialWelcomeSeen(){
  const sb = sbClient(); if(!sb) return false;
  try{ const { error } = await sb.auth.updateUser({ data:{ turn_trial_welcome_seen:true } }); return !error; }
  catch(e){ return false; }
}
window.cloudTrialWelcomeSeen = cloudTrialWelcomeSeen;
window.cloudMarkTrialWelcomeSeen = cloudMarkTrialWelcomeSeen;
window.cloudSignIn = cloudSignIn;
window.cloudSignOut = cloudSignOut;
window.cloudResetPassword = cloudResetPassword;
window.cloudGetSession = cloudGetSession;
window.cloudOnAuth = cloudOnAuth;
window.cloudUserEmail = cloudUserEmail;
window.cloudUserId = cloudUserId;
window.cloudUserDisplayName = cloudUserDisplayName;
window.cloudHandleName = cloudHandleName;

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
  const num = (v)=> (v==null || !Number.isFinite(Number(v))) ? null : Number(v);
  /* PLAN vs PACK credits + billing state (billing fixes, 2026-09-30) — the columns
     turn_credit_balance() gained: plan_remaining, pack_remaining, next_pack_expiry,
     payment_status, frozen, trial (+ an optional plan_allowance). Only the LEDGER RPC is
     trusted for them: user-editable auth metadata can never mark an account paid-up,
     unfrozen or on a trial. Against an older database the fields are null / false and
     every readout falls back to the single `remaining` total. */
  const ledger = source==="turn_credit_balance" || source==="turn_spend_credit";
  const status = ledger ? pick("payment_status") : null;
  return {
    remaining:n,
    used: num(used),
    limit: num(limit),
    plan: plan==null ? "" : String(plan),
    planRemaining: ledger ? num(pick("plan_remaining")) : null,
    packRemaining: ledger ? num(pick("pack_remaining")) : null,
    nextPackExpiry: ledger ? (pick("next_pack_expiry") || null) : null,
    paymentStatus: status==null ? null : String(status).toLowerCase(),
    frozen: ledger && (row.frozen===true || row.frozen==="true"),
    trial: ledger && (row.trial===true || row.trial==="true"),
    allowance: ledger ? num(pick("plan_allowance","monthly_allowance")) : null,
    // credits held by jobs still running, if the ledger ever reports them (the low-balance
    // notice counts them as still spendable: app/plans.jsx lowBalanceStep)
    held: ledger ? num(pick("held","open_holds")) : null,
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

/* decrement through supabase/credits.sql turn_spend_credit. LEGACY since the billing fixes
   (2026-09-30): video and voice are charged on the SERVER now (image-proxy holds credits
   before the job and settles or refunds after), so no render path calls this any more. It
   stays only to drain spend records an older build queued in this browser before the
   switch (renders the server did not charge). Returns the new balance or null. */
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
function _cloudNormalizeSeriesRow(row){
  if(window.turnSeries&&typeof window.turnSeries.normalizeProjectRow==="function")
    return window.turnSeries.normalizeProjectRow(row);
  return row;
}
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
    const legacyFields="id,owner,title,updated_at,created_at,isShow:doc->>isShow,showId:doc->>showId,episodeNo:doc->>episodeNo,cover:doc->>cover,coverPrev:doc->>coverPrev,fmt:doc->project->>format,logline:doc->project->>logline,ord:doc->>homeOrder,hasShots:doc->shots->0->>id,hasLocs:doc->locations->0->>id,hasScenes:doc->scenes->0->>id,hasChars:doc->characters->0->>id";
    let { data, error } = await _cloudQuery(sb.from("turn_projects")
      .select("id,owner,title,updated_at,created_at,project_kind,show_id,episode_no,isShow:doc->>isShow,showId:doc->>showId,episodeNo:doc->>episodeNo,cover:doc->>cover,coverPrev:doc->>coverPrev,fmt:doc->project->>format,logline:doc->project->>logline,ord:doc->>homeOrder,hasShots:doc->shots->0->>id,hasLocs:doc->locations->0->>id,hasScenes:doc->scenes->0->>id,hasChars:doc->characters->0->>id")
      .order("updated_at",{ ascending:false }),"Project list");
    // Older film-only installations do not have the normalized column yet. Keep
    // their project wall usable and fall back to the case-insensitive JSON marker.
    if(error && /project_kind|schema cache/i.test(String(error.message||"")))
      ({data,error}=await _cloudQuery(sb.from("turn_projects").select(legacyFields).order("updated_at",{ascending:false}),"Legacy project list"));
    // null = REQUEST FAILED (e.g. expired token → 401), [] = genuinely no projects.
    // Callers must not treat a failure as "new user" — that's how an auth hiccup
    // once spawned a create-first-project during boot and stranded the app.
    if(error) return null;
    let memberships = [];
    try{
      const { data:ms } = await _cloudQuery(sb.from("turn_project_members")
        .select("project_id,role,member_email,status")
        .or("member_user.eq."+uid+",member_email.eq."+email),"Project memberships");
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
        const { data:ow, error:oe } = await _cloudQuery(sb.rpc("turn_shared_film_owners"),"Shared-film owners");
        if(!oe)(ow||[]).forEach(r=>{ if(r && r.project_id) ownersBy[r.project_id]=r.owner_email||""; });
      }catch(e){}
    }
    // Canonical columns override legacy JSON markers. In particular, a bad or
    // orphaned pre-migration doc.showId is normalized to a standalone film by SQL
    // and must remain visible/openable as that film in every client surface.
    const rows = (data || []).map(_cloudNormalizeSeriesRow);
    /* A Show membership is inherited by every episode (series-production.sql).
       Keep the client classification in step with RLS so inherited collaborators
       never fall through with an empty role and have every save fail closed. Legacy
       episode-level grants also project back onto the Show until owners re-share it. */
    const memberFor = (p)=>{
      let m = byProject[p.id] || null;
      if(!m && p.showId) m = byProject[p.showId] || null;
      const isShow=(window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
        ? window.turnSeries.isShowDoc(p)
        : String(p.project_kind||"").toLowerCase()==="show" || String(p.isShow).toLowerCase()==="true";
      if(!m && isShow){
        const child = rows.find(ep=>ep && String(ep.showId||"")===String(p.id) && byProject[ep.id]);
        if(child) m = byProject[child.id] || null;
      }
      return m;
    };
    return rows.map(p=>{
      const m = memberFor(p);
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
/* TEAM IS COMING SOON (owner decision 2026-10-02, docs/Team Decision Memo.md Option C): only
   the admin may start or alter a share from the app — adding, re-roling or removing a member
   is refused here for everyone else, before any request (team.jsx keeps the Team window
   admin-only too). The database and its access rules are unchanged, so films already shared
   keep opening with their role. */
function _teamPausedRefusal(){
  if(window.turnIsAdmin) return null;
  return { ok:false, paused:true,
    message:(window.TEAM_SOON_TEXT || "Team sharing is coming soon: invite co-writers and art directors to work on your film.") };
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
  const paused = _teamPausedRefusal(); if(paused) return paused;
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
    // (2026-10-02) plain words, no file names: invitation emails aren't switched on yet
    if(/not\s*found|404|Failed to send a request/i.test(msg))
      msg = "invitation emails aren't switched on yet.";
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
async function cloudUpdateProjectMember(memberId, patch, projectId){
  const paused = _teamPausedRefusal(); if(paused) return paused;
  const sb = sbClient(); if(!sb || !memberId) return { ok:false };
  const role = patch && patch.role;
  // fail CLOSED on an unknown role: passing it through would either hit the DB CHECK
  // with a cryptic error or, worse, store a grant this build can't scope
  if(role!=null && ["view_only","writer","art_director"].indexOf(role)<0) return { ok:false, message:"Unknown role." };
  try{
    const { error } = await sb.from("turn_project_members").update(role?{role}:patch).eq("id", memberId);
    if(error) return { ok:false, message:error.message };
    // A role change is an access-boundary change just as removal is. Wake open
    // collaborators so they refresh the server-derived role before their next edit.
    if(projectId) _pushMemberRemoved(projectId);
    return { ok:true };
  }catch(err){ return { ok:false, message:(err&&err.message)||"Update failed." }; }
}
async function cloudRemoveProjectMember(memberId, projectId){
  const paused = _teamPausedRefusal(); if(paused) return paused;
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
  return await cloudPatchDoc(id, (doc)=>{
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
async function _cloudReadCreatedProject(sb, id, uid){
  if(!sb || !id || !uid) return null;
  try{
    const { data, error } = await sb.from("turn_projects").select("*").eq("id",id).maybeSingle();
    if(error || !data || String(data.owner||"")!==String(uid)) return null;
    const row=_cloudNormalizeSeriesRow(data);
    cloudNoteDocRev(row.id,row.doc||{});
    return row;
  }catch(e){ return null; }
}
async function cloudCreateProject(title, doc, opts){
  // record WHY a create failed so the UI can say something better than "hiccup"
  window.cloudLastCreateError = "";
  window.cloudLastCreateRequestId = "";
  const sb = sbClient(); if(!sb){ window.cloudLastCreateError = "cloud storage isn\u2019t ready in this window"; return null; }
  const session = await cloudGetSession();
  const uid = session && session.user && session.user.id;
  if(!uid){ window.cloudLastCreateError = "your session has expired \u2014 sign in again"; return null; }
  /* Choose the row UUID once per visible create intent. Retrying an INSERT after
     a lost response can then only rediscover that same row; it cannot strand a
     duplicate film (including the first Episode before Series conversion). */
  const requestId=_seriesEpisodeRequest(opts);
  window.cloudLastCreateRequestId=requestId;
  const payload={id:requestId,owner:uid,title:title||"Untitled film",doc:doc||{}};
  const ins = ()=> sb.from("turn_projects").insert(payload).select().single();
  try{
    let { data, error } = await ins();
    if(error && /row-level security/i.test(error.message||"")){
      // the DB didn't recognise this sign-in — force a token refresh, retry once
      try{ await sb.auth.refreshSession(); }catch(e){}
      ({ data, error } = await ins());
    }
    if(data){
      const row=_cloudNormalizeSeriesRow(data);
      cloudNoteDocRev(row.id,row.doc||{});
      return row;
    }
    if(error){
      /* A duplicate key normally means the first response was lost. Transport
         failures can have the same shape, so reconcile the caller-owned UUID
         under RLS before reporting a failure. */
      const recovered=await _cloudReadCreatedProject(sb,requestId,uid);
      if(recovered) return recovered;
      let why = error.message || "the server rejected the save";
      if(/row-level security/i.test(why)){
        const diag = await _cloudJwtDiag(sb, uid);
        why += diag ? " ["+diag+"]" : "";
        try{ console.error("[turn] create-film RLS failure:", why, "uid:", uid); }catch(e){}
      }
      window.cloudLastCreateError = why; return null;
    }
    const recovered=await _cloudReadCreatedProject(sb,requestId,uid);
    if(recovered) return recovered;
    window.cloudLastCreateError = "The server did not confirm the new film";
    return null;
  }catch(e){
    const recovered=await _cloudReadCreatedProject(sb,requestId,uid);
    if(recovered) return recovered;
    window.cloudLastCreateError = (e && e.message) || "network error";
    return null;
  }
}
async function cloudLoadProject(id){
  const sb = sbClient(); if(!sb) return null;
  try{
    const { data, error } = await _cloudQuery(sb.from("turn_projects").select("*").eq("id", id).single(),"Project load");
    if(error) return null;
    return _cloudNormalizeSeriesRow(data);
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
/* 0 ROWS IS NOT ALWAYS A LOST RACE (2026-09-27 review). A fenced UPDATE that
   matches 0 rows is normally another writer's newer _rev. RLS filtering the
   UPDATE (a collaborator demoted mid-session) or a BEFORE trigger returning NULL
   also returns 0 rows, but then the re-read still shows the SAME _rev: _rev only
   ever grows, and a writer that left it unchanged would still have matched our
   filter. Report that as a plain failure (Not saved + retry with backoff), not
   as {conflict} — the conflict dialog would blame "another window" and offer the
   destructive Load cloud version, and every later edit would re-open it. */
function _seriesSaveNotAccepted(what){
  const subject = what==="bible" ? "this Show Bible save"
    : what==="patch" ? "this change" : "this save";
  return { ok:false, rejected:true,
    message:"The server did not accept "+subject+". No newer cloud version exists, so another window did not cause it; your access to this film may have changed. Your edit is still on screen and not saved." };
}
/* A merge that could not even compare (missing or malformed baseline) is not
   evidence of another window. Say so instead of reusing the overlap message. */
function _seriesConflictMessage(conflicts, overlapMessage){
  const list = Array.isArray(conflicts) ? conflicts : [];
  const structural = list.length>0 && list.every(c=>/invalid|missing merge baseline/.test(String(c)));
  return structural
    ? "We couldn't safely compare this save with the cloud copy because this window has no reliable saved baseline for it. Reload before applying these edits."
    : overlapMessage;
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
  let zeroRowRev = null;
  for(let attempt=0; attempt<3; attempt++){
    try{
      const { data, error } = await _cloudQuery(sb.from("turn_projects").select("doc").eq("id", id).single(),"Project patch read","save");
      if(error) return { ok:false };
      const doc = (data && data.doc) || {};
      const cur = Number(doc._rev) || 0;
      // 0 rows at an unchanged _rev: nobody else wrote (see _seriesSaveNotAccepted)
      if(zeroRowRev!==null && cur===zeroRowRev) return _seriesSaveNotAccepted("patch");
      const wasInSync = (_docRevSeen[id] || 0) === cur;
      if(mutate(doc) === false) return { ok:false, skipped:true };
      let q = sb.from("turn_projects").update({ doc: { ...doc, _rev: cur + 1 } }).eq("id", id);
      q = cur ? q.eq("doc->>_rev", String(cur))
              : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
      const { data: rows, error: wErr } = await _cloudQuery(q.select("id"),"Project patch","save");
      if(wErr){ const rs = _roleScopeErr(wErr); return rs ? { ok:false, roleScope:true, message:rs } : { ok:false }; }
      if(rows && rows.length){
        if(wasInSync) _docRevSeen[id] = cur + 1;
        _pushDocRev(id, cur + 1);
        return { ok:true, doc };
      }
      zeroRowRev = cur;
      // someone else wrote between our read and write — re-read and retry
    }catch(e){ return { ok:false }; }
  }
  return { ok:false, conflict:true };
}
window.cloudPatchDoc = cloudPatchDoc;

function _seriesRpcMissing(error,functionName){
  const code=String((error&&error.code)||"");
  const msg=String((error&&error.message)||error||"");
  const expected=String(functionName||"").replace(/[^a-zA-Z0-9_]/g,"");
  const named=!expected || new RegExp("(?:public[.])?"+expected+"\\b","i").test(msg);
  /* PGRST202 specifically means the requested RPC signature is absent from the
     API schema cache. PostgreSQL 42883 is broader, so accept it only when the
     error names the outer lifecycle function; an undefined helper *inside* an
     installed RPC is an operational failure, not permission to clear a retry id. */
  if(code==="PGRST202") return named;
  return code==="42883" && named && /function[\s\S]*does not exist/i.test(msg);
}
function _seriesBeginAssetUploadIntentMissing(response,error){
  const code=String((error&&error.code)||(response&&response.code)||"");
  if(code!=="PGRST202") return false;
  const msg=String((error&&error.message)||response&&response.message||error||response||"");
  /* This compatibility branch belongs only to the exact deployed helper
     signature. Bare names, wrong argument lists, and other 202s fail closed. */
  if(!/public\s*\.\s*turn_begin_asset_upload\s*\(\s*(?:p_path\s*,\s*p_project_id|p_project_id\s*,\s*p_path)\s*\)/i.test(msg))
    return false;
  const statuses=[];
  const addStatus=value=>{
    const n=Number(value);
    if(Number.isFinite(n)) statuses.push(n);
  };
  addStatus(response&&response.status);
  addStatus(response&&response.response&&response.response.status);
  addStatus(error&&error.status);
  addStatus(error&&error.statusCode);
  addStatus(error&&error.response&&error.response.status);
  /* A missing status is not proof of a 404. Require at least one exposed
     status and reject if any exposed response/error status disagrees. */
  return statuses.length>0 && statuses.every(status=>status===404);
}
function _seriesRpcResponseStatus(response){
  const value=response&&response.status!==undefined ? response.status
    : response&&response.response&&response.response.status;
  const status=Number(value);
  return Number.isFinite(status)?status:null;
}
function _seriesError(error,fallback){ return String((error&&error.message)||error||fallback||"Series operation failed."); }
function _seriesConversionRetry(episodeId, message){
  return {ok:false,retrySafe:true,
    retryState:{operation:"convert-project-to-show",episodeId:String(episodeId||"")},
    message:message||"The server did not confirm the Show conversion. Try Create show again; we'll safely reuse the same Episode 1."};
}
async function _seriesReadConvertedPair(sb, episodeId){
  try{
    const {data:episodeData,error:episodeError}=await sb.from("turn_projects")
      .select("*").eq("id",episodeId).single();
    if(episodeError||!episodeData) return {ok:false,unconfirmed:true};
    const episode=_cloudNormalizeSeriesRow(episodeData);
    const showId=episode&&(episode.showId||episode.show_id||(episode.doc&&episode.doc.showId));
    if(!showId) return {ok:false,notCommitted:true};
    const {data:showData,error:showError}=await sb.from("turn_projects")
      .select("*").eq("id",showId).single();
    if(showError||!showData) return {ok:false,unconfirmed:true};
    const show=_cloudNormalizeSeriesRow(showData);
    const showDoc=(show&&show.doc)||{};
    const isShow=String(show&&show.project_kind||"").toLowerCase()==="show"
      || showDoc.isShow===true || String(showDoc.isShow||"").toLowerCase()==="true";
    if(!isShow || String(showDoc.sourceEpisodeId||"")!==String(episodeId))
      return {ok:false,unconfirmed:true};
    cloudNoteDocRev(show.id,show.doc||{});
    cloudNoteDocRev(episode.id,episode.doc||{});
    return {ok:true,show,episode,atomic:true,reconciled:true};
  }catch(e){ return {ok:false,unconfirmed:true}; }
}
async function _seriesReconcileConversion(sb, episodeId, message){
  const committed=await _seriesReadConvertedPair(sb,episodeId);
  return committed&&committed.ok ? committed : _seriesConversionRetry(episodeId,message);
}

/* Durable conversion: the production RPC creates the Show and attaches the
   current film as Episode 1 inside one database transaction. There is no browser
   multi-write fallback: an ambiguous response must never strand a hidden Show or
   claim a conversion that only lived in React state. */
async function cloudConvertProjectToShow(episodeId, showTitle, bible, episodeProject){
  const sb=sbClient(); if(!sb||!episodeId) return {ok:false,message:"Cloud storage is unavailable."};
  const format=String((episodeProject&&episodeProject.format)||"series");
  try{
    const {data,error}=await sb.rpc("turn_convert_project_to_show",{
      p_episode_id:episodeId,p_show_title:showTitle,p_bible:bible||{},p_format:format
    });
    if(!error && data && data.show && data.episode){
      const show=_cloudNormalizeSeriesRow(data.show);
      const episode=_cloudNormalizeSeriesRow(data.episode);
      cloudNoteDocRev(show.id,show.doc||{});
      cloudNoteDocRev(episode.id,episode.doc||{});
      return {ok:true,show,episode,atomic:true};
    }
    if(error){
      if(_seriesRpcMissing(error,"turn_convert_project_to_show")) return {ok:false,setup:true,message:"Show conversion needs the series-production database migration. No projects were changed."};
      if(_seriesAmbiguousTransport(error)) return await _seriesReconcileConversion(sb,episodeId,
        "The connection ended before Show conversion was confirmed. Try Create show again; we'll safely reuse the same Episode 1.");
      return {ok:false,message:_seriesError(error,"The show could not be created.")};
    }
    return await _seriesReconcileConversion(sb,episodeId);
  }catch(e){
    if(_seriesRpcMissing(e,"turn_convert_project_to_show")) return {ok:false,setup:true,message:"Show conversion needs the series-production database migration. No projects were changed."};
    return await _seriesReconcileConversion(sb,episodeId,
      "The connection ended before Show conversion was confirmed. Try Create show again; we'll safely reuse the same Episode 1.");
  }
}
window.cloudConvertProjectToShow=cloudConvertProjectToShow;

function _seriesUuid(){
  try{ if(window.crypto&&typeof window.crypto.randomUUID==="function") return window.crypto.randomUUID(); }catch(e){}
  const bytes=new Uint8Array(16);
  try{ window.crypto.getRandomValues(bytes); }
  catch(e){ for(let i=0;i<16;i++) bytes[i]=Math.floor(Math.random()*256); }
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
}
window.cloudCreateRequestId=_seriesUuid;
function _seriesEpisodeRequest(opts){
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const supplied=typeof opts==="string" ? opts : opts&&opts.requestId;
  return valid.test(String(supplied||"")) ? String(supplied) : _seriesUuid();
}
function _seriesAmbiguousTransport(error){
  const code=String((error&&error.code)||"");
  const status=Number(error&&(error.status||error.statusCode));
  const msg=String((error&&error.message)||error||"");
  return /^5\d\d$/.test(code) || status>=500
    || /failed to fetch|fetch failed|network|load failed|connection|timeout|timed out|abort|socket|econn|gateway|response.*lost/i.test(msg);
}

/* New episode numbering is reserved on the locked Show row by the RPC. Every
   UI intent carries a request UUID: if a committed response is lost, the retry
   for that same intent reuses it and the server returns the same Episode instead
   of allocating another. The caller owns that short-lived retry state, so another
   tab or a later, unrelated click can never inherit a stale create request.
   The browser deliberately has no multi-write lifecycle fallback; production
   safety requires the migration's single transaction. */
async function cloudCreateShowEpisode(showId, blankDoc, opts){
  const sb=sbClient(); if(!sb||!showId) return {ok:false,message:"Cloud storage is unavailable."};
  const requestId=_seriesEpisodeRequest(opts);
  try{
    const {data,error}=await sb.rpc("turn_create_show_episode",{
      p_show_id:showId,p_episode_doc:blankDoc||{},p_request_id:requestId
    });
    if(!error && data && data.episode){
      const episode=_cloudNormalizeSeriesRow(data.episode);
      cloudNoteDocRev(showId,(data.show&&data.show.doc)||{});
      cloudNoteDocRev(episode.id,episode.doc||{});
      return {ok:true,episode,episodeNo:Number(data.episode_no)||Number(episode.doc&&episode.doc.episodeNo)||1,
        requestId,atomic:true};
    }
    if(error){
      if(_seriesRpcMissing(error,"turn_create_show_episode")){
        return {ok:false,setup:true,message:"Episode creation needs the series-production database migration. No projects were changed."};
      }
      if(_seriesAmbiguousTransport(error)) return {ok:false,retrySafe:true,
        requestId,retryState:{operation:"create-show-episode",showId:String(showId),requestId},
        message:"The connection ended before Episode creation was confirmed. Try again; we'll safely resume the same request."};
      return {ok:false,message:_seriesError(error,"The episode could not be created.")};
    }
    return {ok:false,retrySafe:true,requestId,
      retryState:{operation:"create-show-episode",showId:String(showId),requestId},
      message:"The server did not confirm which Episode was created. Try again; we'll safely resume the same request."};
  }catch(e){
    if(_seriesRpcMissing(e,"turn_create_show_episode")){
      return {ok:false,setup:true,message:"Episode creation needs the series-production database migration. No projects were changed."};
    }
    return {ok:false,retrySafe:true,requestId,
      retryState:{operation:"create-show-episode",showId:String(showId),requestId},
      message:"The connection ended before Episode creation was confirmed. Try again; we'll safely resume the same request."};
  }
}
window.cloudCreateShowEpisode=cloudCreateShowEpisode;

/* Inventory the exact Storage objects which will lose their database references
   when a Show is deleted. Project rows/generation rows are still removed only by
   the transactional RPC below; this preflight merely gives the client a bounded,
   reviewable list of object keys to clean up after that transaction commits.

   Never derive deletion keys from a prefix or a display name. A generation row
   is allowed to nominate only keys whose project folder (folder 2) belongs to the
   Show inventory (folder 1 must also be a valid uploader folder). Both folders
   are parsed by app/storage-keys.js — legacy "{uuid}" or readable "{name}--{uuid}";
   only the uuid is compared, never the name. Anything else (including the
   uppercase legacy keys the app never wrote) is "unsafe" and therefore kept. This
   prevents stale/corrupt JSON from turning a Show deletion into an arbitrary
   Storage delete. */
function _seriesScopedStoragePath(path,projectIds){
  const value=String(path||"").trim();
  if(!value || value[0]==="/" || value.indexOf("\\")>=0) return null;
  const parts=value.split("/");
  const keys=_turnStorageKeys();
  const uploader=keys?keys.segmentId(parts[0]):null, project=keys?keys.segmentId(parts[1]):null;
  if(parts.length<3 || parts.some(part=>!part || part==="." || part==="..") || !uploader || !project)
    return {path:value,safe:false,inScope:false};
  return {path:value,safe:true,inScope:projectIds.has(project)};
}
function _seriesReferencedPaths(row){
  const paths=new Map();
  const add=(path,direct)=>{ if(path){ const key=String(path); paths.set(key,!!paths.get(key)||!!direct); } };
  const addRefs=refs=>(refs||[]).forEach(ref=>add(ref&&ref.storage_path,false));
  add(row&&row.storage_path,true); addRefs(row&&row.refs);
  for(const item of ((row&&row.history)||[])){
    add(item&&item.storage_path,true); addRefs(item&&item.refs);
    const oldPending=item&&item.meta&&Array.isArray(item.meta.cleanupPending) ? item.meta.cleanupPending : [];
    oldPending.forEach(path=>add(path,true));
  }
  const pending=row&&row.meta&&Array.isArray(row.meta.cleanupPending) ? row.meta.cleanupPending : [];
  pending.forEach(path=>add(path,true));
  return Array.from(paths,(pair)=>({path:pair[0],direct:pair[1]}));
}
function _seriesOptionalTableMissing(error,table){
  const msg=String((error&&error.message)||error||"");
  return !!(error&&["42P01","PGRST204","PGRST205"].indexOf(error.code)>=0)
    || new RegExp("(?:relation|table|schema cache).*"+table,"i").test(msg);
}
async function _seriesRowsForProjects(sb,table,columns,projectIds,optional,orderColumn){
  const rows=[], ids=Array.from(new Set((projectIds||[]).filter(Boolean)));
  /* Keep both the PostgREST URL and every response bounded. range() also avoids
     silently accepting the server's default 1,000-row cap on a long-running Show. */
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    for(let from=0;;from+=1000){
      let query=sb.from(table).select(columns).in("project_id",batch)
        .order("project_id",{ascending:true});
      if(orderColumn) query=query.order(orderColumn,{ascending:true});
      const {data,error}=await query.range(from,from+999);
      if(error){
        if(optional&&_seriesOptionalTableMissing(error,table)) break;
        return {ok:false,message:(error&&error.message)||("Could not inventory "+table+".")};
      }
      const page=data||[]; rows.push(...page);
      if(page.length<1000) break;
    }
  }
  return {ok:true,rows};
}
async function _seriesDeleteInventory(sb,showId){
  const session=await cloudGetSession();
  const uid=session&&session.user&&session.user.id;
  if(!uid) return {ok:false,message:"Sign in before deleting a Show. No projects were deleted."};

  const {data:show,error:showErr}=await sb.from("turn_projects")
    .select("id,owner,project_kind,isShow:doc->>isShow").eq("id",showId).maybeSingle();
  if(showErr){
    const setup=_seriesOptionalTableMissing(showErr,"turn_projects") || /project_kind|schema cache/i.test(String(showErr.message||""));
    return {ok:false,setup,message:setup
      ? "Show deletion needs the series-production database migration. No projects were deleted."
      : "The Show's stored assets could not be inventoried safely. No projects were deleted."};
  }
  if(!show) return {ok:false,message:"The Show is unavailable. No projects were deleted."};
  if(String(show.owner)!==String(uid))
    return {ok:false,message:"Only the Show owner can delete the Show. No projects were deleted."};
  if(!((window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
    ? window.turnSeries.isShowDoc(show)
    : (String(show.project_kind||"").toLowerCase()==="show"||String(show.isShow).toLowerCase()==="true")))
    return {ok:false,message:"That project is not a Show. No projects were deleted."};

  const {data:episodes,error:episodeErr}=await sb.from("turn_projects")
    .select("id,owner,show_id").eq("show_id",showId);
  if(episodeErr){
    const setup=/show_id|schema cache/i.test(String(episodeErr.message||""));
    return {ok:false,setup,message:setup
      ? "Show deletion needs the series-production database migration. No projects were deleted."
      : "The Show's Episodes could not be inventoried safely. No projects were deleted."};
  }
  const invalidOwner=(episodes||[]).find(ep=>String(ep.owner)!==String(show.owner));
  if(invalidOwner) return {ok:false,message:"The Show has an invalid Episode ownership link. No projects were deleted."};
  const projectIds=[showId,...(episodes||[]).map(ep=>ep.id).filter(Boolean)];

  const gens=await _seriesRowsForProjects(sb,"turn_generations",
    "project_id,owner,entity_id,storage_path,meta,refs,history",projectIds,false,"entity_id");
  if(!gens.ok) return {ok:false,message:"The Show's generated assets could not be inventoried safely. No projects were deleted."};
  /* Cameos are an optional installation, but when installed their angle files
     must be included because the project-row cascade removes their references. */
  const cameos=await _seriesRowsForProjects(sb,"turn_cameos",
    "project_id,owner,char_id,angles",projectIds,true,"char_id");
  if(!cameos.ok) return {ok:false,message:"The Show's cameo assets could not be inventoried safely. No projects were deleted."};

  const paths=new Set(), unsafe=new Set(), allowedProjects=new Set(projectIds.map(String));
  const take=(path,direct)=>{
    const checked=_seriesScopedStoragePath(path,allowedProjects);
    if(checked&&checked.safe&&checked.inScope) paths.add(checked.path);
    /* A well-formed reference into a different project is deliberately retained:
       it belongs to that other production. A malformed key, or a generation's
       own direct key outside this Show, cannot be deleted safely and is reported. */
    else if(path && (direct || !(checked&&checked.safe))) unsafe.add(String(path));
  };
  for(const row of gens.rows){
    if(projectIds.indexOf(row.project_id)<0 || !row.owner){ unsafe.add("invalid-generation-row"); continue; }
    for(const item of _seriesReferencedPaths(row)) take(item.path,item.direct);
  }
  for(const row of cameos.rows){
    if(projectIds.indexOf(row.project_id)<0 || !row.owner){ unsafe.add("invalid-cameo-row"); continue; }
    for(const angle of (Array.isArray(row.angles)?row.angles:[])) take(angle&&angle.storage_path,true);
  }
  return {ok:true,projectIds:Array.from(new Set(projectIds.map(String))),paths:Array.from(paths),unsafeCount:unsafe.size};
}
async function _seriesDeleteEpisodeInventory(sb,episodeId){
  const session=await cloudGetSession();
  const uid=session&&session.user&&session.user.id;
  if(!uid) return {ok:false,message:"Sign in before deleting an Episode. No projects were deleted."};

  const {data:episode,error:episodeErr}=await sb.from("turn_projects")
    .select("id,owner,project_kind,show_id,showId:doc->>showId").eq("id",episodeId).maybeSingle();
  if(episodeErr){
    const setup=/project_kind|show_id|schema cache/i.test(String(episodeErr.message||""));
    return {ok:false,setup,message:setup
      ? "Episode deletion needs the series-production database migration. No projects were deleted."
      : "The Episode's stored assets could not be inventoried safely. No projects were deleted."};
  }
  if(!episode) return {ok:false,message:"The Episode is unavailable. No projects were deleted."};
  if(String(episode.owner)!==String(uid))
    return {ok:false,message:"Only the Show owner can delete an Episode. No projects were deleted."};
  const showId=String(episode.show_id||episode.showId||"");
  if(episode.project_kind!=="episode" || !showId)
    return {ok:false,message:"That project is not a Show Episode. No projects were deleted."};

  const {data:show,error:showErr}=await sb.from("turn_projects")
    .select("id,owner,project_kind,isShow:doc->>isShow").eq("id",showId).maybeSingle();
  if(showErr) return {ok:false,message:"The Episode's Show could not be verified. No projects were deleted."};
  if(!show || String(show.owner)!==String(episode.owner)
      || !((window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
        ? window.turnSeries.isShowDoc(show)
        : (String(show.project_kind||"").toLowerCase()==="show"||String(show.isShow).toLowerCase()==="true")))
    return {ok:false,message:"The Episode has an invalid Show relationship. No projects were deleted."};

  /* This is only an early UX check; the RPC repeats it under the Show lock, so a
     simultaneous sibling deletion can never strand an empty Show. */
  const {data:siblings,error:siblingErr}=await sb.from("turn_projects")
    .select("id,owner").eq("show_id",showId);
  if(siblingErr) return {ok:false,message:"The Show's Episodes could not be verified. No projects were deleted."};
  const invalidOwner=(siblings||[]).find(row=>String(row.owner)!==String(show.owner));
  if(invalidOwner) return {ok:false,message:"The Show has an invalid Episode ownership link. No projects were deleted."};
  if((siblings||[]).length<=1) return {ok:false,finalEpisode:true,
    message:"Delete the Show to remove its final Episode. No projects were deleted."};

  const projectIds=[episodeId];
  const survivingProjectIds=[showId,...(siblings||[]).map(row=>String(row.id)).filter(id=>id!==String(episodeId))];
  const gens=await _seriesRowsForProjects(sb,"turn_generations",
    "project_id,owner,entity_id,storage_path,meta,refs,history",projectIds,false,"entity_id");
  if(!gens.ok) return {ok:false,message:"The Episode's generated assets could not be inventoried safely. No projects were deleted."};
  const cameos=await _seriesRowsForProjects(sb,"turn_cameos",
    "project_id,owner,char_id,angles",projectIds,true,"char_id");
  if(!cameos.ok) return {ok:false,message:"The Episode's cameo assets could not be inventoried safely. No projects were deleted."};
  /* A legacy Show/sibling row may still reference a file physically stored in
     this Episode's namespace. Such a key is shared live data, not garbage. */
  const survivingGens=await _seriesRowsForProjects(sb,"turn_generations",
    "project_id,owner,entity_id,storage_path,meta,refs,history",survivingProjectIds,false,"entity_id");
  if(!survivingGens.ok) return {ok:false,message:"Surviving Show asset references could not be verified. No projects were deleted."};
  const survivingCameos=await _seriesRowsForProjects(sb,"turn_cameos",
    "project_id,owner,char_id,angles",survivingProjectIds,true,"char_id");
  if(!survivingCameos.ok) return {ok:false,message:"Surviving Show cameo references could not be verified. No projects were deleted."};

  const paths=new Set(), protectedPaths=new Set(), unsafe=new Set(), allowedProjects=new Set(projectIds.map(String));
  const take=(path,direct)=>{
    const checked=_seriesScopedStoragePath(path,allowedProjects);
    if(checked&&checked.safe&&checked.inScope) paths.add(checked.path);
    else if(path && (direct || !(checked&&checked.safe))) unsafe.add(String(path));
  };
  const protect=path=>{
    const checked=_seriesScopedStoragePath(path,allowedProjects);
    if(checked&&checked.safe&&checked.inScope) protectedPaths.add(checked.path);
    else if(path && !(checked&&checked.safe)) unsafe.add(String(path));
  };
  for(const row of gens.rows){
    if(String(row.project_id)!==String(episodeId) || !row.owner){ unsafe.add("invalid-generation-row"); continue; }
    for(const item of _seriesReferencedPaths(row)) take(item.path,item.direct);
  }
  for(const row of cameos.rows){
    if(String(row.project_id)!==String(episodeId) || !row.owner){ unsafe.add("invalid-cameo-row"); continue; }
    for(const angle of (Array.isArray(row.angles)?row.angles:[])) take(angle&&angle.storage_path,true);
  }
  for(const row of survivingGens.rows)
    for(const item of _seriesReferencedPaths(row)) protect(item.path);
  for(const row of survivingCameos.rows)
    for(const angle of (Array.isArray(row.angles)?row.angles:[])) protect(angle&&angle.storage_path);
  for(const path of protectedPaths) paths.delete(path);
  return {ok:true,showId,projectIds:[String(episodeId)],paths:Array.from(paths),
    protectedPaths:Array.from(protectedPaths),unsafeCount:unsafe.size,
    remainingEpisodeCount:Math.max(0,(siblings||[]).length-1)};
}
async function _seriesRemoveExactPaths(paths){
  const exact=Array.from(new Set((paths||[]).filter(Boolean))), failed=[];
  let removed=0;
  /* Supabase Storage accepts an explicit key list. Small chunks bound request
     size and let later chunks continue when one batch is rejected. */
  for(let i=0;i<exact.length;i+=100){
    const batch=exact.slice(i,i+100);
    try{
      await cloudRemovePaths(batch);
      removed+=batch.length;
    }catch(e){ failed.push(...batch); }
  }
  return {ok:failed.length===0,removed,failedCount:failed.length};
}
async function _seriesConfirmProjectAbsent(sb,projectId){
  try{
    const {data,error}=await sb.from("turn_projects").select("id").eq("id",projectId).maybeSingle();
    if(error) return {ok:false,message:(error&&error.message)||"Project state could not be verified."};
    return {ok:true,absent:!data};
  }catch(e){ return {ok:false,message:(e&&e.message)||"Project state could not be verified."}; }
}

/* Whole-show database deletion is deliberately RPC-only: deleting several
   JSON-linked rows one by one can strand a half-deleted production after one
   network error. Storage is not transactional with Postgres, so its exact keys
   are inventoried before the RPC and removed best-effort only after commit. */
async function cloudDeleteShow(showId){
  const sb=sbClient(); if(!sb||!showId) return {ok:false,message:"Cloud storage is unavailable."};
  let inventory;
  try{
    inventory=await _seriesDeleteInventory(sb,showId);
    if(!inventory.ok) return inventory;
  }catch(e){ return {ok:false,message:_seriesError(e,"The Show's assets could not be inventoried. No projects were deleted.")}; }

  let data, responseLost=false;
  try{
    const response=await sb.rpc("turn_delete_show",{p_show_id:showId});
    data=response&&response.data;
    const error=response&&response.error;
    if(error){
      if(_seriesRpcMissing(error,"turn_delete_show")) return {ok:false,setup:true,message:"Show deletion needs the series-production database migration. No projects were deleted."};
      if(!_seriesAmbiguousTransport(error)) return {ok:false,message:_seriesError(error,"The show could not be deleted.")};
      responseLost=true;
    }
    if(!error && (!data || !Array.isArray(data.deleted_project_ids)
      || !data.deleted_project_ids.some(id=>String(id)===String(showId)))) responseLost=true;
  }catch(e){
    if(_seriesRpcMissing(e,"turn_delete_show")) return {ok:false,setup:true,message:"Show deletion needs the series-production database migration. No projects were deleted."};
    if(!_seriesAmbiguousTransport(e)) return {ok:false,message:_seriesError(e,"The show could not be deleted.")};
    responseLost=true;
  }
  if(responseLost){
    const confirmation=await _seriesConfirmProjectAbsent(sb,showId);
    if(!confirmation.ok) return {ok:false,uncertain:true,retrySafe:true,
      message:"The connection ended during Show deletion, and we couldn't verify whether it went through. Refresh Films & TV Shows before trying again; no asset cleanup was attempted."};
    if(!confirmation.absent) return {ok:false,retrySafe:true,
      message:"Show deletion was not confirmed. The Show is still present, so no assets were removed."};
    /* The row's absence proves the database transaction committed. The response's
       transaction-time manifest is unavailable, so use the safe preflight set and
       retain the cleanup grant until expiry for anything created in the lock gap. */
    data={deleted_project_ids:inventory.projectIds,episode_count:Math.max(0,inventory.projectIds.length-1)};
  }

  /* From this point onward the database transaction committed. Cleanup errors
     must never be re-labelled as a failed Show deletion. */
  try{
    const deletedIds=Array.isArray(data&&data.deleted_project_ids)
      ? data.deleted_project_ids.map(String) : [];
    const missingInventory=deletedIds.filter(id=>inventory.projectIds.indexOf(id)<0).length;
    const allowedProjects=new Set([...inventory.projectIds,...deletedIds]);
    const exactPaths=new Set(inventory.paths||[]);
    let unsafeCount=Number(inventory.unsafeCount)||0;
    /* The RPC supplements the browser preflight inside its transaction: this
       catches a generation committed during the preflight/lock gap, plus
       capture-owner-private cameos the Show owner cannot normally read. Validate
       every returned string against the deleted UUID set before cleanup. */
    const serverExact=[
      ...(Array.isArray(data&&data.generation_storage_paths)?data.generation_storage_paths:[]),
      ...(Array.isArray(data&&data.cameo_storage_paths)?data.cameo_storage_paths:[]),
    ];
    for(const path of serverExact){
      const checked=_seriesScopedStoragePath(path,allowedProjects);
      if(checked&&checked.safe&&checked.inScope) exactPaths.add(checked.path);
      else if(path) unsafeCount++;
    }
    const cleanup=await _seriesRemoveExactPaths(Array.from(exactPaths));
    /* An Episode created in the preflight/lock gap is diagnostic, not by itself
       a cleanup failure: the RPC's transaction-time path arrays above are the
       authoritative supplement for precisely that race. */
    const manifestUncertain=responseLost;
    const incomplete=unsafeCount+cleanup.failedCount;
    let grantReleased=false;
    if(incomplete===0 && !manifestUncertain){
      try{
        const finished=await sb.rpc("turn_finish_asset_cleanup",{p_project_ids:Array.from(allowedProjects)});
        grantReleased=!(finished&&finished.error);
      }catch(e){}
    }
    const result={ok:true,episodeCount:Number(data&&data.episode_count)||0,
      cleanup:{ok:incomplete===0&&!manifestUncertain,removed:cleanup.removed,failedCount:cleanup.failedCount,
        skippedUnsafe:unsafeCount,uninventoriedProjects:missingInventory,grantReleased,
        unverifiedTransactionManifest:manifestUncertain,
        grantExpiresAt:String((data&&data.cleanup_expires_at)||"")}};
    if(manifestUncertain) result.cleanupWarning="Show deletion was confirmed after the connection ended. Preflight assets were cleaned, but assets committed during the final transaction window could still need cleanup.";
    else if(incomplete) result.cleanupWarning=incomplete+" stored asset "+(incomplete===1?"item needs":"items need")+" manual cleanup.";
    return result;
  }catch(e){
    return {ok:true,episodeCount:Number(data&&data.episode_count)||0,
      cleanup:{ok:false,removed:0,failedCount:(inventory.paths||[]).length,
        skippedUnsafe:Number(inventory.unsafeCount)||0,uninventoriedProjects:0},
      cleanupWarning:"Stored asset cleanup could not be completed automatically and may need manual attention."};
  }
}
window.cloudDeleteShow=cloudDeleteShow;

/* Single-Episode deletion uses the same two-phase asset boundary as whole-Show
   deletion. Postgres atomically protects the Show invariant and removes the
   Episode rows; Storage cleanup runs afterward against exact, validated keys
   under the RPC's short-lived owner tombstone. */
async function cloudDeleteShowEpisode(episodeId){
  const sb=sbClient(); if(!sb||!episodeId) return {ok:false,message:"Cloud storage is unavailable."};
  let inventory;
  try{
    inventory=await _seriesDeleteEpisodeInventory(sb,episodeId);
    if(!inventory.ok) return inventory;
  }catch(e){ return {ok:false,message:_seriesError(e,"The Episode's assets could not be inventoried. No projects were deleted.")}; }

  let data, responseLost=false;
  try{
    const response=await sb.rpc("turn_delete_show_episode",{p_episode_id:episodeId});
    data=response&&response.data;
    const error=response&&response.error;
    if(error){
      const message=_seriesError(error,"The Episode could not be deleted.");
      if(_seriesRpcMissing(error,"turn_delete_show_episode")) return {ok:false,setup:true,message:"Episode deletion needs the series-production database migration. No projects were deleted."};
      if(/final Episode/i.test(message)) return {ok:false,finalEpisode:true,message:"Delete the Show to remove its final Episode. No projects were deleted."};
      if(!_seriesAmbiguousTransport(error)) return {ok:false,message};
      responseLost=true;
    }
    if(!error && (!data || String(data.episode_id||"")!==String(episodeId))) responseLost=true;
  }catch(e){
    const message=_seriesError(e,"The Episode could not be deleted.");
    if(_seriesRpcMissing(e,"turn_delete_show_episode")) return {ok:false,setup:true,message:"Episode deletion needs the series-production database migration. No projects were deleted."};
    if(/final Episode/i.test(message)) return {ok:false,finalEpisode:true,message:"Delete the Show to remove its final Episode. No projects were deleted."};
    if(!_seriesAmbiguousTransport(e)) return {ok:false,message};
    responseLost=true;
  }
  if(responseLost){
    const confirmation=await _seriesConfirmProjectAbsent(sb,episodeId);
    if(!confirmation.ok) return {ok:false,uncertain:true,retrySafe:true,
      message:"The connection ended during Episode deletion, and we couldn't verify whether it went through. Refresh Films & TV Shows before trying again; no asset cleanup was attempted."};
    if(!confirmation.absent) return {ok:false,retrySafe:true,
      message:"Episode deletion was not confirmed. The Episode is still present, so no assets were removed."};
    data={episode_id:String(episodeId),show_id:inventory.showId,
      deleted_project_ids:[String(episodeId)],remaining_episode_count:inventory.remainingEpisodeCount};
  }

  /* The database commit has happened. Any later error is a cleanup warning,
     never a false claim that the Episode itself still exists. */
  try{
    const deletedIds=Array.isArray(data.deleted_project_ids)?data.deleted_project_ids.map(String):[];
    const expectedId=String(episodeId), allowedProjects=new Set([expectedId]);
    let unsafeCount=Number(inventory.unsafeCount)||0;
    if(deletedIds.length!==1 || deletedIds[0]!==expectedId) unsafeCount++;
    const exactPaths=new Set(inventory.paths||[]), protectedPaths=new Set(inventory.protectedPaths||[]);
    const serverExact=[
      ...(Array.isArray(data.generation_storage_paths)?data.generation_storage_paths:[]),
      ...(Array.isArray(data.cameo_storage_paths)?data.cameo_storage_paths:[]),
    ];
    for(const path of serverExact){
      const checked=_seriesScopedStoragePath(path,allowedProjects);
      if(checked&&checked.safe&&checked.inScope) exactPaths.add(checked.path);
      else if(path) unsafeCount++;
    }
    for(const path of (Array.isArray(data.protected_storage_paths)?data.protected_storage_paths:[])){
      const checked=_seriesScopedStoragePath(path,allowedProjects);
      if(checked&&checked.safe&&checked.inScope) protectedPaths.add(checked.path);
      else if(path && !(checked&&checked.safe)) unsafeCount++;
    }
    for(const path of protectedPaths) exactPaths.delete(path);
    const cleanup=await _seriesRemoveExactPaths(Array.from(exactPaths));
    const manifestUncertain=responseLost;
    const incomplete=unsafeCount+cleanup.failedCount;
    let grantReleased=false;
    if(incomplete===0 && !manifestUncertain){
      try{
        const finished=await sb.rpc("turn_finish_asset_cleanup",{p_project_ids:[episodeId]});
        grantReleased=!(finished&&finished.error);
      }catch(e){}
    }
    const result={ok:true,id:expectedId,showId:String(data.show_id||inventory.showId||""),
      remainingEpisodeCount:Number(data.remaining_episode_count)||0,
      cleanup:{ok:incomplete===0&&!manifestUncertain,removed:cleanup.removed,failedCount:cleanup.failedCount,
        skippedUnsafe:unsafeCount,grantReleased,unverifiedTransactionManifest:manifestUncertain,
        grantExpiresAt:String(data.cleanup_expires_at||"")}};
    if(manifestUncertain) result.cleanupWarning="Episode deletion was confirmed after the connection ended. Preflight assets were cleaned, but assets committed during the final transaction window could still need cleanup.";
    else if(incomplete) result.cleanupWarning=incomplete+" stored asset "+(incomplete===1?"item needs":"items need")+" manual cleanup.";
    return result;
  }catch(e){
    return {ok:true,id:String(episodeId),showId:String(data.show_id||inventory.showId||""),
      remainingEpisodeCount:Number(data.remaining_episode_count)||0,
      cleanup:{ok:false,removed:0,failedCount:(inventory.paths||[]).length,
        skippedUnsafe:Number(inventory.unsafeCount)||0},
      cleanupWarning:"Stored asset cleanup could not be completed automatically and may need manual attention."};
  }
}
window.cloudDeleteShowEpisode=cloudDeleteShowEpisode;

function _seriesMergeProjectObject(latest,incoming,baseline){
  const object=v=>v&&typeof v==="object"&&!Array.isArray(v);
  if(!object(latest)||!object(incoming))
    return {ok:false,value:latest,conflicts:["project (invalid shape)"]};
  if(baseline===undefined){
    return _seriesJsonSame(latest,incoming)?{ok:true,value:latest,conflicts:[]}
      :{ok:false,value:latest,conflicts:["project (missing merge baseline)"]};
  }
  if(!object(baseline)) return {ok:false,value:latest,conflicts:["project (invalid merge baseline)"]};
  const out={...latest}, conflicts=[], applied=[];
  const keys=new Set([...Object.keys(baseline),...Object.keys(incoming)]);
  keys.forEach(key=>{
    const localChanged=!_seriesJsonSame(incoming[key],baseline[key]);
    const remoteChanged=!_seriesJsonSame(latest[key],baseline[key]);
    if(localChanged&&remoteChanged&&!_seriesJsonSame(incoming[key],latest[key])){
      conflicts.push("project."+key); return;
    }
    if(localChanged){
      applied.push(key);   // this window's value is what the write puts on the server
      if(Object.prototype.hasOwnProperty.call(incoming,key)) out[key]=incoming[key];
      else delete out[key];
    }
  });
  return {ok:!conflicts.length,value:out,conflicts,applied};
}

/* COLLABORATIVE SECTION SAVE — the collaboration fix.
   The old autosave overwrote the WHOLE doc behind a single _rev fence. That is correct
   for one user in two windows (it refuses to clobber), but for two COLLABORATORS it meant
   whoever saved second was told "changed in another window", reloaded, and lost their
   edits — every ~700ms of typing. Real collaboration was impossible.
   Now a window writes ONLY the top-level sections it actually changed, merged onto the
   freshest cloud doc. The mixed-domain `project` object receives an additional shallow
   three-way merge, so writer metadata and an art director's styleBible can coexist while
   two divergent edits to the same key stop with an explicit conflict.
   Returns { ok, doc } where `doc` is the cloud doc AS READ (before our overlay), so the
   caller can adopt the sections OTHER people changed. When `project` was saved it
   also returns `project`: the merged value now on the server, which can hold keys
   another window changed that this window has not seen yet. */
/* UNACKNOWLEDGED WRITES (2026-09-27 review). A fenced UPDATE can commit while its
   response is lost (flaky wifi, a timeout). The caller then keeps its old
   baseline, so its retry saw this tab's OWN committed value as a remote change
   and, if the same setting moved again meanwhile, raised a false "changed in
   another window" in a single tab. Remember what each such attempt wrote for
   the baseline-merged parts (project keys, recovery-journal sections) — per
   project, this tab only — and treat a server value equal to one of them as
   ours. Only this window's LOCAL changes are recorded, never keys the merge took
   from the server, so a collaborator's value can't be mistaken for ours and
   reverted. Cleared once a later write of those parts is acknowledged. */
const _seriesUnackedWrites = {};   // project id -> [{project:{key:value}|null, sections:{key:value}|null}], oldest first
function _seriesRememberUnacked(id, sent){
  if(!id || !sent) return;
  const list = _seriesUnackedWrites[id] || (_seriesUnackedWrites[id] = []);
  list.push(sent);
  while(list.length > 4) list.shift();
}
function _seriesSettleUnacked(id, settledProject, settledSections){
  const list = _seriesUnackedWrites[id]; if(!list) return;
  const kept = [];
  list.forEach(sent=>{
    const project = settledProject ? null : sent.project;
    let sections = sent.sections ? { ...sent.sections } : null;
    if(sections) settledSections.forEach(k=>{ delete sections[k]; });
    if(sections && !Object.keys(sections).length) sections = null;
    if(project || sections) kept.push({ project, sections });
  });
  if(kept.length) _seriesUnackedWrites[id] = kept; else delete _seriesUnackedWrites[id];
}
function _seriesOwnUnacked(latestValue, key, list, field){
  for(let i=list.length-1; i>=0; i--){   // newest first
    const sent = list[i] && list[i][field];
    if(!sent || !Object.prototype.hasOwnProperty.call(sent,key)) continue;
    if(_seriesJsonSame(latestValue, sent[key])) return { hit:true, value:sent[key] };
  }
  return { hit:false };
}
async function cloudSaveSections(id, sections, opts){
  const sb = sbClient(); if(!sb || !id) return { ok:false };
  const keys = Object.keys(sections||{});
  if(!keys.length) return { ok:true, noop:true };
  let zeroRowRev = null;
  for(let attempt=0; attempt<4; attempt++){
    let sent = null;   // set only while a write that changes baseline-merged parts is on the wire
    try{
      const { data, error } = await _cloudQuery(sb.from("turn_projects").select("doc").eq("id", id).single(),"Project save read","save");
      if(error) return { ok:false };
      const cloudDoc = (data && data.doc) || {};
      const cur = Number(cloudDoc._rev) || 0;
      if(zeroRowRev!==null && cur===zeroRowRev) return _seriesSaveNotAccepted("project");
      const next = { ...cloudDoc };
      const sectionBaseline=opts&&opts.baseline&&typeof opts.baseline==="object"
        ? opts.baseline : {};
      const unacked = _seriesUnackedWrites[id] || [];
      const record = { project:null, sections:null };
      const settledSections = [];
      let mergedProject;
      if(keys.indexOf("project")>=0){
        let baseline=sectionBaseline.project;
        const latestProject=cloudDoc.project||{};
        if(unacked.length && baseline && typeof baseline==="object" && !Array.isArray(baseline)){
          const candidates = new Set();
          unacked.forEach(sentBefore=>{ if(sentBefore.project) Object.keys(sentBefore.project).forEach(k=>candidates.add(k)); });
          candidates.forEach(key=>{
            const own=_seriesOwnUnacked(latestProject[key],key,unacked,"project");
            if(!own.hit) return;
            if(baseline===sectionBaseline.project) baseline={...baseline};
            if(own.value===undefined) delete baseline[key]; else baseline[key]=own.value;
          });
        }
        const merged=_seriesMergeProjectObject(latestProject,sections.project,baseline);
        if(!merged.ok) return {ok:false,conflict:true,conflicts:merged.conflicts,
          message:_seriesConflictMessage(merged.conflicts,
            "Project settings changed in another window. Reload before applying overlapping edits.")};
        next.project=merged.value;
        mergedProject=merged.value;
        (merged.applied||[]).forEach(key=>{
          record.project=record.project||{};
          record.project[key]=Object.prototype.hasOwnProperty.call(sections.project,key)?sections.project[key]:undefined;
        });
      }
      const sectionConflicts=[];
      keys.forEach(k=>{
        if(k==="project") return;
        /* A full baseline is supplied by the paired-save recovery journal. If
           its Episode half already committed, an identical replay is a no-op;
           if somebody changed that same section afterward, stop rather than
           overwriting their newer work with the journal's old snapshot. Normal
           debounced saves omit these baselines and retain section-level merge. */
        if(Object.prototype.hasOwnProperty.call(sectionBaseline,k)){
          let base=sectionBaseline[k];
          const incoming=sections[k], latest=cloudDoc[k];
          const own=unacked.length?_seriesOwnUnacked(latest,k,unacked,"sections"):{hit:false};
          if(own.hit) base=own.value;
          const localChanged=!_seriesJsonSame(incoming,base);
          const remoteChanged=!_seriesJsonSame(latest,base);
          if(localChanged&&remoteChanged&&!_seriesJsonSame(incoming,latest)){
            sectionConflicts.push(k); return;
          }
          settledSections.push(k);
          if(localChanged){ record.sections=record.sections||{}; record.sections[k]=incoming; }
          next[k]=localChanged?incoming:latest;
          return;
        }
        next[k]=sections[k];
      });
      if(sectionConflicts.length) return {ok:false,conflict:true,conflicts:sectionConflicts,
        message:"This Episode changed after an interrupted save. Reload before reconciling the overlapping sections."};
      next._rev = cur + 1;
      let q = sb.from("turn_projects").update({ doc: next }).eq("id", id);
      q = cur ? q.eq("doc->>_rev", String(cur))
              : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
      if(record.project || record.sections) sent = record;
      const { data: rows, error: wErr } = await _cloudQuery(q.select("id"),"Project save","save");
      sent = null;   // a response arrived, so this attempt's outcome is known
      if(wErr){ const rs = _roleScopeErr(wErr); return rs ? { ok:false, roleScope:true, message:rs } : { ok:false }; }
      if(rows && rows.length){
        _seriesSettleUnacked(id, keys.indexOf("project")>=0, settledSections);
        _docRevSeen[id] = cur + 1;      // we merged onto the freshest doc, so we ARE current
        _pushDocRev(id, cur + 1);       // wake collaborators' windows right away
        return mergedProject!==undefined ? { ok:true, doc:cloudDoc, project:mergedProject } : { ok:true, doc:cloudDoc };
      }
      zeroRowRev = cur;
      // someone wrote between our read and our write — re-read and merge again
    }catch(e){
      if(sent) _seriesRememberUnacked(id, sent);   // committed or not: unknown
      return { ok:false };
    }
  }
  return { ok:false, conflict:true };   // pathological contention only
}
window.cloudSaveSections = cloudSaveSections;

/* SHOW-BIBLE SECTION SAVE — the shared world is nested under doc.bible, so the
   ordinary top-level section merge cannot protect two episodes editing different
   departments at once. Merge only the changed Bible departments onto the freshest
   Show doc and fence the write. Same-department edits remain last-writer-wins; cast
   work can no longer erase a location edit merely because both live in `bible`. */
/* ORDER-INSENSITIVE (2026-09-27, "Pine Soot" false conflict). Every merge here
   compares three copies of one value in three key orders: the baseline
   (JSON.parse(stableJson) → alphabetical), the server doc (jsonb → shorter keys
   first) and React state (build order). Plain JSON.stringify called identical
   content "changed on both sides", so one window running Adaptation got a
   bogus "Another window saved this film first" and lost everything from the
   continuity step on. Meaning: equal exactly when JSON.stringify output would
   be equal apart from object key order (jsonb can't keep key order anyway).
   Array order stays significant; undefined/function/symbol values drop out of
   objects and become null in arrays, holes read as null, NaN/Infinity as null,
   toJSON and boxed primitives apply — JSON.stringify's own rules. A structural
   walk, not string building: it stops at the first difference and costs about
   one JSON.stringify on equal values (a sorted-key canonical string cost ~5x).
   Cyclic or BigInt values fall back to identity, as JSON.stringify's throw did.
   Kept self-contained (cloud.jsx loads before app.jsx; tests vm-extract it). */
function _seriesJsonSame(a,b){
  if(a===undefined&&b===undefined) return true;
  const absent=v=>v===undefined||typeof v==="function"||typeof v==="symbol";
  const norm=(v,key)=>{
    if(v!==null&&typeof v==="object"){
      if(typeof v.toJSON==="function") v=v.toJSON(key);
      if(v instanceof Number) v=Number(v);
      else if(v instanceof String) v=String(v);
      else if(v instanceof Boolean) v=v.valueOf();
    }
    if(typeof v==="bigint") throw new TypeError("BigInt value can't be serialized in JSON");
    return (typeof v==="number"&&!isFinite(v)) ? null : v;
  };
  const pathA=[], pathB=[];
  const same=(x,y)=>{
    if(x===y) return true;
    if(x===null||y===null||typeof x!=="object"||typeof y!=="object") return false;
    const list=Array.isArray(x);
    if(list!==Array.isArray(y)) return false;
    if(pathA.indexOf(x)>=0||pathB.indexOf(y)>=0) throw new TypeError("Converting circular structure to JSON");
    pathA.push(x); pathB.push(y);
    try{
      if(list){
        if(x.length!==y.length) return false;
        for(let i=0;i<x.length;i++){
          let u=norm(x[i],String(i)), w=norm(y[i],String(i));
          if(absent(u)) u=null;
          if(absent(w)) w=null;
          if(!same(u,w)) return false;
        }
        return true;
      }
      let present=0;
      for(const k of Object.keys(x)){
        const u=norm(x[k],k);
        if(absent(u)) continue;
        present++;
        const w=Object.prototype.propertyIsEnumerable.call(y,k)?norm(y[k],k):undefined;
        if(absent(w)||!same(u,w)) return false;
      }
      for(const k of Object.keys(y)) if(!absent(norm(y[k],k))) present--;
      return present===0;
    }finally{ pathA.pop(); pathB.pop(); }
  };
  try{
    const x=norm(a,""), y=norm(b,"");
    if(absent(x)||absent(y)) return absent(x)&&absent(y);
    return same(x,y);
  }catch(e){ return a===b; }
}
function _seriesOwnSceneSlice(item,episodeId){
  const map=item&&item.episodeScenes&&typeof item.episodeScenes==="object"?item.episodeScenes:{};
  if(Array.isArray(map[episodeId])) return map[episodeId];
  /* Once any Episode namespace exists, a missing caller key means this Episode
     has no links. Falling back to the Show-wide/legacy flat list here can make
     repeated ids (for example each Episode's `s1`) look locally unchanged and
     silently discard the first real mapping saved by a new Episode. */
  if(Object.keys(map).length) return [];
  return Array.isArray(item&&item.scenes)?item.scenes:[];
}
function _seriesRebuildSceneUnion(episodeScenes){
  const scenes=[];
  Object.keys(episodeScenes||{}).sort().forEach(ep=>(episodeScenes[ep]||[]).forEach(id=>{
    if(!scenes.some(x=>String(x)===String(id))) scenes.push(id);
  }));
  return scenes;
}
function _seriesLocationMetaSlice(item){
  if(window.turnSeries&&typeof window.turnSeries.locationMetaSlice==="function")
    return window.turnSeries.locationMetaSlice(item||{});
  const unique=values=>Array.from(new Set((Array.isArray(values)?values:[])
    .map(value=>String(value==null?"":value).trim()).filter(Boolean)));
  const side=String(item&&item.intExt||"").toUpperCase().replace(/\+/g,"/");
  const scope=String(item&&item.scope||"").toLowerCase();
  return {times:unique(item&&item.times),areas:unique(item&&item.areas),
    intExt:["INT","EXT","INT/EXT"].includes(side)?side:"",
    scope:["atomic","compound"].includes(scope)?scope:"",
    parentKey:String(item&&item.parentKey||""),continuityRootKey:String(item&&item.continuityRootKey||"")};
}
function _seriesLocationMetaMap(item){
  if(window.turnSeries&&typeof window.turnSeries.episodeLocationMetaMap==="function")
    return window.turnSeries.episodeLocationMetaMap(item||{});
  const source=item&&item.episodeLocationMeta&&typeof item.episodeLocationMeta==="object"
    && !Array.isArray(item.episodeLocationMeta)?item.episodeLocationMeta:{};
  const out={}; Object.keys(source).forEach(ep=>{ out[ep]=_seriesLocationMetaSlice(source[ep]); });
  return out;
}
function _seriesOwnLocationMeta(item,episodeId){
  const map=_seriesLocationMetaMap(item), keys=Object.keys(map);
  if(keys.length) return Object.prototype.hasOwnProperty.call(map,episodeId)
    ? map[episodeId] : _seriesLocationMetaSlice({});
  return _seriesLocationMetaSlice(item||{});
}
function _seriesRebuildLocationMeta(item,map){
  if(window.turnSeries&&typeof window.turnSeries.rebuildLocationMetaProjection==="function")
    return window.turnSeries.rebuildLocationMetaProjection(item||{},map||{});
  const episodeIds=Object.keys(map||{}).sort(), times=[], areas=[], parents=[], roots=[], scopes=[];
  let hasInt=false,hasExt=false;
  episodeIds.forEach(ep=>{
    const slice=_seriesLocationMetaSlice(map[ep]);
    slice.times.forEach(v=>{ if(!times.includes(v)) times.push(v); });
    slice.areas.forEach(v=>{ if(!areas.includes(v)) areas.push(v); });
    if(slice.intExt==="INT"||slice.intExt==="INT/EXT") hasInt=true;
    if(slice.intExt==="EXT"||slice.intExt==="INT/EXT") hasExt=true;
    if(slice.scope&&!scopes.includes(slice.scope)) scopes.push(slice.scope);
    if(slice.parentKey&&!parents.includes(slice.parentKey)) parents.push(slice.parentKey);
    if(slice.continuityRootKey&&!roots.includes(slice.continuityRootKey)) roots.push(slice.continuityRootKey);
  });
  parents.sort(); roots.sort();
  const parentKey=parents[0]||"";
  const scope=parentKey?"atomic":(scopes.includes("compound")?"compound":(scopes.includes("atomic")?"atomic":""));
  const continuityRootKey=(parentKey&&roots.includes(parentKey)?parentKey:roots[0])
    ||parentKey||String(item&&item.continuityRootKey||item&&item.key||item&&item.id||"");
  const intExt=hasInt&&hasExt?"INT/EXT":(hasExt?"EXT":(hasInt?"INT":""));
  return {...(item||{}),times,areas,intExt,scope,parentKey,continuityRootKey,episodeLocationMeta:map};
}
function _seriesMergeEntity(latest,incoming,baseline,episodeId,id,department){
  const conflicts=[]; let out={...(latest||{})};
  if(!baseline){
    // Without a last-acknowledged baseline there is no honest way to decide
    // whether a difference is local or remote. Equal data is a safe no-op.
    if(!_seriesJsonSame(incoming,latest)) conflicts.push(String(id)+" (missing merge baseline)");
    return {ok:!conflicts.length,value:out,conflicts};
  }
  const locationEpisode=department==="locations"&&!!episodeId;
  const skip=new Set(["episodeScenes","scenes",
    ...(locationEpisode?["episodeLocationMeta","times","areas","intExt","scope","parentKey","continuityRootKey"]:[])]);
  const keys=new Set([...Object.keys(baseline||{}),...Object.keys(incoming||{})]);
  keys.forEach(key=>{
    if(skip.has(key)) return;
    const localChanged=!_seriesJsonSame(incoming&&incoming[key],baseline&&baseline[key]);
    const remoteChanged=!_seriesJsonSame(latest&&latest[key],baseline&&baseline[key]);
    if(localChanged&&remoteChanged&&!_seriesJsonSame(incoming&&incoming[key],latest&&latest[key])){
      conflicts.push(String(id)+"."+key); return;
    }
    if(localChanged){
      if(incoming&&Object.prototype.hasOwnProperty.call(incoming,key)) out[key]=incoming[key];
      else delete out[key];
    }
  });

  if(episodeId){
    const priorMap=latest&&latest.episodeScenes&&typeof latest.episodeScenes==="object"?latest.episodeScenes:{};
    const nextMap=incoming&&incoming.episodeScenes&&typeof incoming.episodeScenes==="object"?incoming.episodeScenes:{};
    const baseOwn=_seriesOwnSceneSlice(baseline,episodeId);
    const localOwn=_seriesOwnSceneSlice(incoming,episodeId);
    const remoteOwn=_seriesOwnSceneSlice(latest,episodeId);
    const localChanged=!_seriesJsonSame(localOwn,baseOwn);
    const remoteChanged=!_seriesJsonSame(remoteOwn,baseOwn);
    if(localChanged&&remoteChanged&&!_seriesJsonSame(localOwn,remoteOwn)) conflicts.push(String(id)+".episodeScenes."+episodeId);
    /* Do not manufacture empty relationship fields (the rule series.js follows in
       prepareBibleForEpisode): an entity with no scene map on either side, no flat
       links and no links in this Episode keeps exactly the fields it has. Writing
       `episodeScenes:{[episode]:[]}` + `scenes:[]` onto such canon made every save's
       echo differ from what this window sent, which the agent read as a mid-run edit. */
    const hasLinks=Object.keys(priorMap).length>0 || Object.keys(nextMap).length>0
      || (Array.isArray(latest&&latest.scenes)&&latest.scenes.length>0)
      || (Array.isArray(incoming&&incoming.scenes)&&incoming.scenes.length>0);
    if(hasLinks || localChanged || localOwn.length>0){
      const episodeScenes={...priorMap};
      if(localChanged || !Object.prototype.hasOwnProperty.call(episodeScenes,episodeId)) episodeScenes[episodeId]=localOwn;
      // Ignore every non-calling slice in the incoming snapshot. It may be stale;
      // the freshest server row remains authoritative for those Episodes.
      out.episodeScenes=episodeScenes;
      out.scenes=_seriesRebuildSceneUnion(episodeScenes);
    }
  }
  if(locationEpisode){
    const priorMap=_seriesLocationMetaMap(latest);
    const baseOwn=_seriesOwnLocationMeta(baseline,episodeId);
    const localOwn=_seriesOwnLocationMeta(incoming,episodeId);
    const remoteOwn=_seriesOwnLocationMeta(latest,episodeId);
    const localChanged=!_seriesJsonSame(localOwn,baseOwn);
    const remoteChanged=!_seriesJsonSame(remoteOwn,baseOwn);
    if(localChanged&&remoteChanged&&!_seriesJsonSame(localOwn,remoteOwn))
      conflicts.push(String(id)+".episodeLocationMeta."+episodeId);
    const metaMap={...priorMap};
    if(localChanged || !Object.prototype.hasOwnProperty.call(metaMap,episodeId)) metaMap[episodeId]=localOwn;
    // As with scene references, every sibling slice in the incoming browser
    // snapshot may be stale. Keep the freshest Show row and merge only the caller.
    out=_seriesRebuildLocationMeta(out,metaMap);
  }
  return {ok:!conflicts.length,value:out,conflicts};
}
function _mergeEpisodeBibleDepartment(latest,incoming,baseline,episodeId,tombstones,department){
  if(!Array.isArray(latest)||!Array.isArray(incoming))
    return {ok:false,value:latest,conflicts:["invalid department shape"]};
  const byId=list=>{
    const map=new Map(); (list||[]).forEach(item=>{ if(item&&item.id!=null) map.set(String(item.id),item); }); return map;
  };
  const latestBy=byId(latest), incomingBy=byId(incoming), baselineBy=byId(Array.isArray(baseline)?baseline:[]);
  const deleted=new Set((tombstones||[]).map(String)), out=[], conflicts=[];
  // The app edits full department snapshots. A baseline entity omitted from the
  // incoming snapshot is therefore an explicit local deletion; an entity absent
  // from the baseline is remote/new and must be retained. Example:
  // baseline [A,B] + incoming [A] + latest [A,B,C] => [A,C].
  baselineBy.forEach((item,id)=>{ if(!incomingBy.has(id)) deleted.add(id); });
  for(const current of latest){
    if(!current||current.id==null){ out.push(current); continue; }
    const id=String(current.id), next=incomingBy.get(id), base=baselineBy.get(id);
    if(!next){
      if(deleted.has(id)){
        if(!base || !_seriesJsonSame(current,base)) conflicts.push(id+" (delete conflicted)");
        continue;
      }
      // Absence alone is never a deletion: retain server-only/concurrently-added
      // entities. Destructive intent requires an explicit tombstone.
      out.push(current); continue;
    }
    const merged=_seriesMergeEntity(current,next,base,episodeId,id,department);
    out.push(merged.value); conflicts.push(...merged.conflicts);
  }
  for(const next of incoming){
    if(!next||next.id==null){ out.push(next); continue; }
    const id=String(next.id);
    if(latestBy.has(id)||deleted.has(id)) continue;
    const base=baselineBy.get(id);
    if(base){
      // The server deleted it since our baseline. Do not silently resurrect it.
      if(!_seriesJsonSame(next,base)) conflicts.push(id+" (deleted remotely)");
      continue;
    }
    out.push(next);
  }
  return {ok:!conflicts.length,value:out,conflicts};
}
function _seriesSharedTrashShape(value){
  if(!value || typeof value!=="object" || Array.isArray(value)) return null;
  const out={};
  for(const key of ["characters","locations","props"]){
    if(!Array.isArray(value[key])) return null;
    out[key]=value[key];
  }
  return out;
}
/* Restore-bin entries are full shared entities, not an Episode preference. Merge
   each tombstone bucket by entity id with the same baseline semantics as its live
   department: independent deletes/restores compose; overlapping edits conflict. */
function _seriesMergeSharedTrash(latest,incoming,baseline,episodeId){
  const a=_seriesSharedTrashShape(latest), b=_seriesSharedTrashShape(incoming);
  const base=baseline===undefined?null:_seriesSharedTrashShape(baseline);
  if(!a||!b||!base) return {ok:false,value:a||latest,conflicts:["trash (invalid or missing merge baseline)"]};
  const value={}, conflicts=[];
  ["characters","locations","props"].forEach(key=>{
    const merged=_mergeEpisodeBibleDepartment(a[key],b[key],base[key],String(episodeId||""),null,key);
    value[key]=merged.value;
    if(!merged.ok) conflicts.push(...merged.conflicts.map(id=>"trash."+key+"."+id));
  });
  return {ok:!conflicts.length,value,conflicts};
}
function _seriesMergeBibleValue(latest,incoming,baseline,key){
  if(baseline===undefined){
    return _seriesJsonSame(latest,incoming)?{ok:true,value:latest,conflicts:[]}
      :{ok:false,value:latest,conflicts:[key+" (missing merge baseline)"]};
  }
  const localChanged=!_seriesJsonSame(incoming,baseline), remoteChanged=!_seriesJsonSame(latest,baseline);
  if(localChanged&&remoteChanged&&!_seriesJsonSame(incoming,latest))
    return {ok:false,value:latest,conflicts:[key]};
  return {ok:true,value:localChanged?incoming:latest,conflicts:[]};
}
/* REPLAY REBASE — a paired Episode/Bible save can be confirmed by the recovery
   journal while the user has already made a newer local edit. The confirmed
   server Bible is now the latest truth, but the local snapshot must be rebased
   onto it before another save. Reuse the exact same merge semantics as the
   network boundary: this preserves collaborator additions, still honours a
   deletion made after the journal checkpoint, and reports overlapping edits
   instead of silently choosing a winner. */
function _seriesRebaseBibleAfterReplay(latest,current,checkpoint,episodeId){
  latest=latest&&typeof latest==="object"?latest:{};
  current=current&&typeof current==="object"?current:{};
  checkpoint=checkpoint&&typeof checkpoint==="object"?checkpoint:{};
  const bible={...latest}, conflicts=[];
  ["characters","locations","props","lookbook","lookbookNote","trash"].forEach(k=>{
    const merged=(["characters","locations","props"].indexOf(k)>=0)
      ? _mergeEpisodeBibleDepartment(latest[k]||[],current[k]||[],checkpoint[k],String(episodeId||""),null,k)
      : k==="trash"
        ? _seriesMergeSharedTrash(latest[k],current[k],checkpoint[k],String(episodeId||""))
        : _seriesMergeBibleValue(latest[k],current[k],checkpoint[k],k);
    bible[k]=merged.value;
    if(!merged.ok) conflicts.push(...merged.conflicts);
  });
  return {ok:!conflicts.length,bible,conflicts};
}
window.seriesRebaseBibleAfterReplay=_seriesRebaseBibleAfterReplay;
async function cloudSaveBibleSections(showId, sections, opts){
  const sb = sbClient(); if(!sb || !showId) return { ok:false, message:"Cloud storage is unavailable." };
  const keys = Object.keys(sections||{});
  if(!keys.length) return { ok:true, noop:true };
  let zeroRowRev = null;
  for(let attempt=0; attempt<4; attempt++){
    try{
      const { data, error } = await _cloudQuery(sb.from("turn_projects").select("doc").eq("id", showId).single(),"Show Bible read","save");
      if(error) return { ok:false, message:error.message||"The Show Bible could not be loaded." };
      const cloudDoc = (data && data.doc) || {};
      if(!((window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
        ? window.turnSeries.isShowDoc(cloudDoc)
        : (cloudDoc.isShow===true || String(cloudDoc.isShow).toLowerCase()==="true")))
        return { ok:false, message:"The linked Show Bible is invalid." };
      if(window.turnSeries&&typeof window.turnSeries.validBibleShape==="function"
        && !window.turnSeries.validBibleShape(cloudDoc.bible))
        return {ok:false,message:"The linked Show Bible is incomplete or malformed. Run the current series-production migration before saving."};
      const cur = Number(cloudDoc._rev) || 0;
      if(zeroRowRev!==null && cur===zeroRowRev) return _seriesSaveNotAccepted("bible");
      const bible = { ...((cloudDoc && cloudDoc.bible)||{}) };
      const episodeId=opts&&opts.episodeId?String(opts.episodeId):"";
      const baseline=opts&&opts.baseline&&typeof opts.baseline==="object"?opts.baseline:{};
      const tombstones=opts&&opts.tombstones&&typeof opts.tombstones==="object"?opts.tombstones:{};
      const conflicts=[];
      keys.forEach(k=>{
        const merged=(["characters","locations","props"].indexOf(k)>=0)
          ? _mergeEpisodeBibleDepartment(bible[k]||[],sections[k],baseline[k],episodeId,tombstones[k],k)
          : k==="trash"
            ? _seriesMergeSharedTrash(bible[k],sections[k],baseline[k],episodeId)
            : _seriesMergeBibleValue(bible[k],sections[k],baseline[k],k);
        bible[k]=merged.value;
        if(!merged.ok) conflicts.push(...merged.conflicts);
      });
      if(conflicts.length) return {ok:false,conflict:true,conflicts,
        message:_seriesConflictMessage(conflicts,
          "The Show Bible changed in another Episode. Reload before applying overlapping edits.")};
      const next = { ...cloudDoc, bible, _rev:cur+1 };
      let q = sb.from("turn_projects").update({doc:next}).eq("id",showId);
      q = cur ? q.eq("doc->>_rev",String(cur)) : q.or("doc->>_rev.is.null,doc->>_rev.eq.0");
      const { data:rows, error:wErr } = await _cloudQuery(q.select("id"),"Show Bible save","save");
      if(wErr){
        const rs=_roleScopeErr(wErr);
        return rs ? {ok:false,roleScope:true,message:rs} : {ok:false,message:wErr.message||"The Show Bible could not be saved."};
      }
      if(rows && rows.length){
        _docRevSeen[showId]=cur+1;
        _pushDocRev(showId,cur+1);
        return {ok:true,doc:next,bible};
      }
      zeroRowRev=cur;
    }catch(e){ return {ok:false,message:(e&&e.message)||"The Show Bible could not be saved."}; }
  }
  return {ok:false,conflict:true,message:"The Show Bible changed in another window."};
}
window.cloudSaveBibleSections = cloudSaveBibleSections;

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
const _docChannels = {};   // Show id -> lightweight broadcast subscription (no presence UI)
function _pushDocRev(projectId, rev){
  // fire-and-forget: losing the message is harmless — the fallback poll still runs
  const payload={ rev:Number(rev)||0, key:_presenceKey };
  const docEntry=_docChannels[projectId];
  if(docEntry&&docEntry.ready&&docEntry.ch){
    try{ docEntry.ch.send({type:"broadcast",event:"doc-rev",payload}); }catch(e){}
  }
  if(_presenceCh && _presenceChProject===projectId && _presenceReady){
    try{ _presenceCh.send({ type:"broadcast", event:"doc-rev", payload }); }catch(e){}
  }
}
function _pushMemberRemoved(projectId){
  // removal changes no document rev, so it needs its own announcement — otherwise
  // the removed person's open tab wouldn't learn until the slow fallback probe.
  // The payload names nobody: it only says "membership changed, re-verify your
  // access", and every recipient checks with the SERVER before acting.
  const payload={ key:_presenceKey };
  // Team management for a series happens on the Show row, while presence lives
  // on the episode currently being edited. The Show's lightweight doc channel is
  // therefore the only immediate path to a collaborator working in another
  // episode; the normal access poll remains the loss-tolerant fallback.
  const docEntry=_docChannels[projectId];
  if(docEntry&&docEntry.ready&&docEntry.ch){
    try{ docEntry.ch.send({type:"broadcast",event:"member-removed",payload}); }catch(e){}
  }
  if(_presenceCh && _presenceChProject===projectId && _presenceReady){
    try{ _presenceCh.send({ type:"broadcast", event:"member-removed", payload }); }catch(e){}
  }
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

/* Episodes use their own presence channel, while their shared Bible lives on the
   Show row. This second, presence-free subscription keeps Bible edits live across
   different episodes without making Episode 1's collaborator list appear in
   Episode 2. It also gives _pushDocRev an exact Show channel for outgoing saves. */
function cloudSubscribeDoc(projectId){
  const sb=sbClient();
  if(!sb||!projectId||typeof sb.channel!=="function") return ()=>{};
  const release=()=>{
    const e=_docChannels[projectId];
    if(!e) return;
    e.refs=Math.max(0,e.refs-1);
    if(e.refs) return;
    e.dead=true; delete _docChannels[projectId];
    try{ e.sb.removeChannel(e.ch); }catch(err){}
  };
  if(_docChannels[projectId]){
    _docChannels[projectId].refs++;
    return release;
  }
  const ch=sb.channel("doc:"+projectId);
  const entry={ch,sb,ready:false,refs:1,dead:false};
  _docChannels[projectId]=entry;
  try{
    ch.on("broadcast",{event:"doc-rev"},msg=>{
      if(entry.dead) return;
      const p=(msg&&msg.payload)||{};
      if(p.key===_presenceKey) return;
      try{ window.dispatchEvent(new CustomEvent("turn-doc-push",{detail:{projectId,rev:Number(p.rev)||0}})); }catch(e){}
    });
    ch.on("broadcast",{event:"member-removed"},msg=>{
      if(entry.dead) return;
      const p=(msg&&msg.payload)||{};
      if(p.key===_presenceKey) return;
      try{ window.dispatchEvent(new CustomEvent("turn-member-removed",{detail:{projectId}})); }catch(e){}
    });
    ch.subscribe(status=>{
      if(entry.dead) return;
      entry.ready=status==="SUBSCRIBED";
    });
  }catch(e){ delete _docChannels[projectId]; return ()=>{}; }
  return release;
}
window.cloudSubscribeDoc=cloudSubscribeDoc;

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
  const sb = sbClient();
  if(!sb || !id) return { ok:false, message:"Cloud storage is unavailable." };
  const nextTitle=String(title||"").trim();
  if(!nextTitle) return { ok:false, message:"Enter a project title." };
  try{
    const { data,error }=await sb.from("turn_projects").update({title:nextTitle}).eq("id",id).select("id");
    if(error) return {ok:false,message:error.message||"The project could not be renamed."};
    if(!data||!data.length) return {ok:false,message:"The project is unavailable or you no longer have permission to rename it."};
    /* the server names an untitled project's storage folder from its first real
       title: ask again on the next upload instead of waiting for the cache */
    turnStorageFoldersForget(id);
    return {ok:true,title:nextTitle};
  }catch(e){ return {ok:false,message:(e&&e.message)||"The project could not be renamed."}; }
}
async function cloudDeleteProject(id){
  const sb = sbClient();
  if(!sb || !id) return { ok:false, message:"Cloud storage is unavailable." };
  try{
    const {data,error}=await sb.from("turn_projects").delete().eq("id",id).select("id");
    if(error) return {ok:false,message:error.message||"The project could not be deleted."};
    if(!data||!data.length) return {ok:false,message:"The project is unavailable or you no longer have permission to delete it."};
    return {ok:true,id};
  }catch(e){ return {ok:false,message:(e&&e.message)||"The project could not be deleted."}; }
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
async function cloudSignedUrl(path, diagnostics){
  if(!path) return "";
  const now = Date.now();
  const c = _signCache.get(path);
  if(c && c.exp > now + 30000) return c.url;
  const sb = sbClient();
  if(!sb){
    _seriesRecordUploadError(diagnostics,"client",null,
      "Cloud image storage is unavailable. Sign in again or check cloud configuration.");
    return "";
  }
  try{
    const { data, error } = await sb.storage.from(turnBucket()).createSignedUrl(path, 3600);
    if(error || !data){
      _seriesRecordUploadError(diagnostics,"signing",error,
        "The uploaded image could not be prepared for viewing.");
      return "";
    }
    _signCache.set(path, { url:data.signedUrl, exp: now + 3600*1000 });
    return data.signedUrl;
  }catch(e){
    _seriesRecordUploadError(diagnostics,
      _seriesUploadNetworkError(e)?"signing-network":"signing",e,
      "The uploaded image could not be prepared for viewing.");
    return "";
  }
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
     {account}/{project}/{folder}/{entity}[/states/{stateId} | /{sub}]/{timestamp}-{role}[-v{N}]-{shortId}.{ext}
   {account} is the uploader's folder and {project} the project's folder. Since 2026-09-27
   (owner decision, readable folders) each is either
     - READABLE: "{name}--{full uuid}", name first because the Supabase dashboard cuts off
       the end of long names: "alex-smith--8d3e…/pine-soot--5a7b…/character/…"; or
     - LEGACY: the bare uuid, "{userId}/{projectId}/…" — every key written before, and
       every key written whenever the server has not handed out readable folders.
   The grammar (app/storage-keys.js, identical to public.turn_storage_segment_id in SQL):
   a name is lowercase [a-z0-9] runs joined by single hyphens, 1-64 characters, with no
   8 hex digits in a row anywhere (a legacy folder's first 8 characters are always hex
   digits, a readable folder's never are); the uuid is always the last 36 characters.
   The storage policies and the upload reservation read ONLY the uuid of folder 1 (it
   must be the caller) and folder 2 (a project the caller may write art for) — never a
   name — and nothing below folder 2. The names are chosen by the server only
   (turn_storage_folders: the account handle from the email's local part, the project
   name from its first real title, both frozen), so a rename never moves or orphans a
   file. Old keys stay valid forever: signing, removal, history and receipts all use
   the stored string.
   folder ∈ character|prop|location|shot|storyboard|lookbook|cameo|other (turnAssetFolder);
   an appearance state nests inside its character ("adem/states/st-1"), a sub-slot inside
   its owner ("sbsheet-p1/half-top"). role ∈ sheet|ref-<kind>|<cameo-angle>. The optional
   v{N} is a NON-AUTHORITATIVE version-at-birth hint (the live version comes from the DB).
   The timestamp leads so a folder lists in time order; one save shares one timestamp
   across its sheet and reference snapshots; {shortId} keeps every key unique; {ext} is the
   file's real type. Old files keep their original paths and keep working (2026-09-26
   tidy: storyboards used to land in character/, lookbook and location plates in asset/). */
function turnSafeSeg(s){ return String(s==null?"":s).replace(/[^a-zA-Z0-9_:-]/g,"_"); }
function turnStamp(){
  const d = new Date(), p = (n)=>String(n).padStart(2,"0");   // sortable UTC YYYYMMDD-HHMMSS
  return ""+d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+"-"+p(d.getUTCHours())+p(d.getUTCMinutes())+p(d.getUTCSeconds());
}
function turnShortId(){
  const u = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(36).slice(2));
  return String(u).replace(/-/g,"").slice(0,8);
}
/* the readable folder for an asset: the entity's own prefix decides first (storyboard
   sheets, lookbook frames, scale sheets, slugline units), then the caller's kind. The
   kind itself is left untouched upstream — it also drives reference-role inference. */
function turnAssetFolder(kind, entityId){
  const id = String(entityId||""), k = String(kind||"");
  if(id.indexOf("sbsheet-")===0) return "storyboard";
  if(id.indexOf("look-")===0) return "lookbook";
  if(id.indexOf("charscale-")===0) return "character";
  if(id.indexOf("locunit-")===0 || k==="locunit") return "location";
  if(k==="character" || k==="prop" || k==="location" || k==="shot" || k==="cameo") return k;
  if(k==="asset") return /^loc-/.test(id) ? "location" : "other";
  return k ? "other" : "character";   // a commit with no kind was always a character sheet
}
/* "adem:st-mrnfi0nm-0" → "adem/states/st-mrnfi0nm-0"; "sbsheet-p1:half-top" → "sbsheet-p1/half-top" */
function turnEntityPath(entityId){
  const id = turnSafeSeg(entityId), i = id.indexOf(":");
  if(i<=0) return id.replace(/:/g,"-");
  const base = id.slice(0,i), sub = id.slice(i+1).replace(/:/g,"-") || "sub";
  return base+"/"+(/^st-/.test(sub) ? "states/" : "")+sub;
}
/* a readable path segment from a display label ("¾ Left" → "three-quarter-left") */
function turnReadableSeg(label, fallback){
  const t = String(label==null?"":label).replace(/¾/g," three-quarter ").replace(/½/g," half ").replace(/¼/g," quarter ")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  return t || fallback || "file";
}
function turnExtForMime(mime){
  const m = String(mime||"").toLowerCase();
  return m==="image/jpeg" || m==="image/jpg" ? "jpg" : m==="image/webp" ? "webp" : m==="image/gif" ? "gif" : "png";
}
/* accountFolder / projectFolder: the two top folders from turnStorageFolders() — for a
   legacy key simply the uid and the project id. */
function turnStoragePath(accountFolder, projectFolder, entityId, assetType, role, ext, version, stamp){
  const vtag = (version!=null && version!=="") ? ("-v"+turnSafeSeg(version)) : "";
  return accountFolder+"/"+projectFolder+"/"+turnAssetFolder(assetType, entityId)+"/"+turnEntityPath(entityId)+"/"
    + (stamp||turnStamp())+"-"+turnSafeSeg(role||"file")+vtag+"-"+turnShortId()+"."+(ext||"png");
}
window.turnAssetFolder = turnAssetFolder;
window.turnStoragePath = turnStoragePath;   // exposed for inspection / tests

/* ── readable storage folders (owner decision 2026-09-27) ─────────────────────
   The app writes readable top folders ONLY after the server answers
   turn_storage_folders(p_project_id) (supabase/storage-readable-folders.sql) with
   folders that parse back to exactly this uid and project id. Every other outcome —
   the kill switch TURN_SUPABASE.readableStorageKeys === false, the RPC missing
   (PGRST202: the SQL isn't installed yet), execute revoked (the server kill switch),
   an error, a timeout, a malformed or mismatched answer, the parser missing — writes a
   legacy {uid}/{projectId}/… key, which the database accepts forever. The answer
   (readable or legacy) is cached per uid|project for 5 minutes: that is the feature
   flag, so clients switch within 5 minutes of the SQL going in or being revoked. */
const TURN_STORAGE_FOLDER_TTL_MS = 5*60*1000;
const _turnStorageFolderCache = new Map();      // "uid|pid" → { exp, value }
const _turnStorageFolderInflight = new Map();   // "uid|pid" → Promise<value>
let _turnStorageFoldersOffUntil = 0;
let _turnStorageFolderEpoch = 0;
function _turnLegacyStorageFolders(uid, projectId){
  return { account:String(uid), project:String(projectId), readable:false };
}
function _turnStorageKeys(){
  const k = window.TurnStorageKeys;
  return k && typeof k.segment==="function" && typeof k.uid==="function" && typeof k.projectId==="function" ? k : null;
}
/* the server refused a readable key (a stale SQL file was re-run): legacy keys only,
   for one cache lifetime */
function turnStorageFoldersDisable(ms){
  _turnStorageFoldersOffUntil = Date.now() + (Number(ms)>0 ? Number(ms) : TURN_STORAGE_FOLDER_TTL_MS);
  _turnStorageFolderEpoch++;
  _turnStorageFolderCache.clear(); _turnStorageFolderInflight.clear();
}
function turnStorageFoldersForget(projectId){
  const tail = "|"+String(projectId);
  _turnStorageFolderEpoch++;
  for(const key of Array.from(_turnStorageFolderCache.keys())) if(key.endsWith(tail)) _turnStorageFolderCache.delete(key);
  for(const key of Array.from(_turnStorageFolderInflight.keys())) if(key.endsWith(tail)) _turnStorageFolderInflight.delete(key);
}
/* true when a built key really lives under this uploader and this project */
function _turnPathInScope(path, uid, projectId){
  const k = _turnStorageKeys();
  return !!k && k.uid(path)===String(uid) && k.projectId(path)===String(projectId);
}
/* the two top folders a stored key was written under (one save shares one prefix) */
function _turnFoldersOfPath(path, uid, projectId){
  const parts = String(path||"").split("/");
  if(parts.length<3 || !parts[0] || !parts[1]) return null;
  return { account:parts[0], project:parts[1],
    readable:parts[0]!==String(uid) || parts[1]!==String(projectId) };
}
async function _turnFetchStorageFolders(sb, uid, projectId, keys){
  const legacy = _turnLegacyStorageFolders(uid, projectId);
  let timer = null;
  try{
    const timeout = new Promise(resolve=>{ timer = setTimeout(()=>resolve({timedOut:true}), 8000); });
    const res = await Promise.race([Promise.resolve(sb.rpc("turn_storage_folders",{p_project_id:projectId})), timeout]);
    const data = res && !res.timedOut && !res.error ? res.data : null;
    if(!data || data.v!==1) return legacy;
    const account = keys.segment(data.account), project = keys.segment(data.project);
    if(!account || !project || !account.label || !project.label) return legacy;
    if(account.id!==String(uid) || project.id!==String(projectId)) return legacy;
    return { account:data.account, project:data.project, readable:true };
  }catch(e){ return legacy; }
  finally{ if(timer!==null) try{ clearTimeout(timer); }catch(e){} }
}
async function turnStorageFolders(sb, uid, projectId){
  const legacy = _turnLegacyStorageFolders(uid, projectId);
  const cfg = window.TURN_SUPABASE || {};
  const keys = _turnStorageKeys();
  if(cfg.readableStorageKeys===false || Date.now()<_turnStorageFoldersOffUntil
    || !sb || typeof sb.rpc!=="function" || !keys || !uid || !projectId) return legacy;
  const cacheKey = String(uid)+"|"+String(projectId);
  const hit = _turnStorageFolderCache.get(cacheKey);
  if(hit && hit.exp>Date.now()) return { ...hit.value };
  let pending = _turnStorageFolderInflight.get(cacheKey);
  if(!pending){
    const epoch = _turnStorageFolderEpoch;
    const request = _turnFetchStorageFolders(sb, uid, projectId, keys).then(value=>{
      /* always retire this request's own in-flight entry (never a newer one); only the
         cache write is skipped when a disable/forget (of ANY project) happened meanwhile,
         so a stale answer can never outlive the 5-minute TTL or the kill switch */
      if(_turnStorageFolderInflight.get(cacheKey)===request) _turnStorageFolderInflight.delete(cacheKey);
      if(epoch===_turnStorageFolderEpoch)
        _turnStorageFolderCache.set(cacheKey, { exp:Date.now()+TURN_STORAGE_FOLDER_TTL_MS, value });
      return value;
    });
    _turnStorageFolderInflight.set(cacheKey, request);
    pending = request;
  }
  const value = await pending;
  // a disable/rename that landed while the RPC was in flight wins
  if(Date.now()<_turnStorageFoldersOffUntil) return legacy;
  return { ...value };
}
window.turnStorageFolders = turnStorageFolders;
window.turnStorageFoldersDisable = turnStorageFoldersDisable;
window.turnStorageFoldersForget = turnStorageFoldersForget;

/* Storage and Postgres cannot commit atomically. Reserve each exact object key
   before upload; if the project is deleted before its generation/Cameo row can
   commit, this short-lived intent lets the original uploader delete that one
   orphan without restoring broad access to the deleted project. */
const _seriesPendingUploadIntents=new Set();
const _seriesMissingUploadIntentWarning =
  "Exact orphan-cleanup reservations are not installed; image upload is continuing with the current storage permissions. Install the asset-upload intent SQL migration to enable exact cleanup reservations.";
let _seriesMissingUploadIntentWarned=false;
function _seriesSafeUploadMessage(error,fallback){
  let message=String((error&&error.message)||error||fallback||"Cloud upload failed.");
  /* Error text is user-visible diagnostics. Keep the actionable database/storage
     reason, but never echo a URL, bearer token, object key, or scoped identifier. */
  /* The keyword groups CAPTURE so "$1" keeps the label ("token=[redacted]", "project
     [redacted]") instead of printing a literal "$1". Object keys are redacted before
     bare ids: an id replaced first leaves "[redacted-id]/…/file.png", which the
     object pattern can no longer match, so the rest of the key (and a readable
     folder's handle / project name) used to survive. */
  message=message
    .replace(/\b(?:https?|blob|data|storage):\/\/?[^\s"'<>]+/ig,"[redacted-url]")
    .replace(/\b(access[_ -]?token|refresh[_ -]?token|token|password)\s*[:=]\s*["']?[^,\s"']+/ig,"$1=[redacted]")
    .replace(/\b((?:p_)?(?:path|project[_ -]?id|user[_ -]?id|owner|entity[_ -]?id|uid))\s*[:=]\s*["']?[^,\s"']+/ig,"$1=[redacted]")
    .replace(/(^|[\s"'(])\/?(?:[A-Za-z0-9_.:-]+\/){2,}[A-Za-z0-9_.:-]+(?=$|[\s"')])/g,"$1[redacted-object]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/ig,"[redacted-id]")
    .replace(/\b(project|user|owner|entity)(?:\s+id)?\s*[:=]?\s+[A-Za-z0-9_.:-]+/ig,"$1 [redacted]");
  return message;
}
function _seriesUploadErrorMeta(error,fallback){
  const meta={message:_seriesSafeUploadMessage(error,fallback)};
  const status=Number(error&&(error.statusCode!==undefined?error.statusCode
    :error.status!==undefined?error.status
    :error.response&&error.response.status));
  const code=String((error&&error.code)||"");
  if(Number.isFinite(status)&&status>=0) meta.status=status;
  if(code) meta.code=code;
  return meta;
}
function _seriesUploadNetworkError(error){
  const status=Number(error&&(error.statusCode!==undefined?error.statusCode:error.status));
  const name=String(error&&error.name||"");
  const message=String((error&&error.message)||error||"");
  const code=String(error&&error.code||"");
  return status===0 || /network|failed to fetch|fetch failed|offline|timeout|timed out|connection reset|load failed|econnreset|enotfound|etimedout/i.test(name+" "+message+" "+code);
}
function _seriesUploadActionableMessage(stage,message){
  if(stage==="reservation") return "Cloud upload reservation failed: "+message;
  if(stage==="storage-network") return "Cloud image upload could not reach storage: "+message;
  if(stage==="storage") return "Cloud image upload failed: "+message;
  if(stage==="auth") return "Cloud image save requires an active session: "+message;
  if(stage==="generation-read"||stage==="generation-write") return "Cloud generation save failed: "+message;
  if(stage==="signing-network") return "The uploaded image could not be prepared because storage was unreachable: "+message;
  if(stage==="signing") return "The uploaded image could not be prepared for viewing: "+message;
  if(stage==="reference-network") return "Reference image download failed: "+message;
  return message;
}
function _seriesRecordUploadError(diagnostics,stage,error,fallback){
  const meta=_seriesUploadErrorMeta(error,fallback);
  const actionable=_seriesUploadActionableMessage(stage,meta.message);
  const result={...meta,message:actionable};
  if(diagnostics&&typeof diagnostics==="object"){
    diagnostics.stage=stage;
    diagnostics.error=result;
    diagnostics.message=actionable;
    if(result.status!==undefined) diagnostics.status=result.status;
    if(result.code) diagnostics.code=result.code;
  }
  return result;
}
function _seriesRecordMissingUploadIntent(diagnostics){
  if(diagnostics&&typeof diagnostics==="object"){
    diagnostics.reservation="unavailable";
    diagnostics.warning=_seriesMissingUploadIntentWarning;
  }
  /* Probe again on the next call: this is deliberately not a permanent
     unsupported-RPC cache. Only the user-facing console warning is once/client. */
  if(!_seriesMissingUploadIntentWarned){
    _seriesMissingUploadIntentWarned=true;
    try{ if(window.console&&typeof window.console.warn==="function") window.console.warn(_seriesMissingUploadIntentWarning); }catch(e){}
  }
}
/* The raw reservation error per diagnostics object (never shown: the recorded
   message is sanitised). cloudUploadImage reads it to spot a refused readable key. */
const _seriesReservationErrors=new WeakMap();
async function _seriesBeginAssetUploadIntent(sb,projectId,path,diagnostics){
  /* Local recording adapters predate Supabase RPC entirely. They are not
     production clients and cannot claim a reservation, but retain the existing
     dependency-free adapter behavior. A configured cloud client without rpc()
     is a real capability failure and must fail closed. */
  if(!sb||typeof sb.rpc!=="function"){
    const configured=!!(window.TURN_SUPABASE&&window.TURN_SUPABASE.url);
    if(configured){
      _seriesRecordUploadError(diagnostics,"reservation",null,
        "Cloud upload reservation service is unavailable.");
      return false;
    }
    if(diagnostics&&typeof diagnostics==="object") diagnostics.reservation="adapter-unavailable";
    return true;
  }
  try{
    const rpcResponse=await sb.rpc("turn_begin_asset_upload",{p_project_id:projectId,p_path:path});
    const error=rpcResponse&&rpcResponse.error;
    if(error){
      const responseStatus=_seriesRpcResponseStatus(rpcResponse);
      const diagnosticError=(responseStatus!==null&&error.status===undefined&&error.statusCode===undefined)
        ? {...error,status:responseStatus} : error;
      /* Compatibility is intentionally narrow: only an API schema-cache
         response naming THIS exact helper permits the ordinary RLS upload. */
      if(_seriesBeginAssetUploadIntentMissing(rpcResponse,error)){
        _seriesRecordMissingUploadIntent(diagnostics);
        return true;
      }
      _seriesRecordUploadError(diagnostics,"reservation",diagnosticError,"Cloud upload reservation failed.");
      if(diagnostics&&typeof diagnostics==="object") _seriesReservationErrors.set(diagnostics,error);
      return false;
    }
    _seriesPendingUploadIntents.add(path);
    if(diagnostics&&typeof diagnostics==="object") diagnostics.reservation="reserved";
    return true;
  }catch(e){
    if(_seriesBeginAssetUploadIntentMissing(null,e)){
      _seriesRecordMissingUploadIntent(diagnostics);
      return true;
    }
    _seriesRecordUploadError(diagnostics,"reservation",e,"Cloud upload reservation failed.");
    if(diagnostics&&typeof diagnostics==="object") _seriesReservationErrors.set(diagnostics,e);
    return false;
  }
}
async function _seriesFinishAssetUploadIntents(paths){
  const exact=Array.from(new Set((paths||[]).filter(path=>_seriesPendingUploadIntents.has(path))));
  if(!exact.length) return true;
  const sb=sbClient();
  if(!sb||typeof sb.rpc!=="function"){
    exact.forEach(path=>_seriesPendingUploadIntents.delete(path));
    return true;
  }
  try{
    const {error}=await sb.rpc("turn_finish_asset_upload",{p_paths:exact});
    if(error) return false;
    exact.forEach(path=>_seriesPendingUploadIntents.delete(path));
    return true;
  }catch(e){ return false; }
}

/* A readable key refused by the server — the reservation's folder check or the Storage
   rule — means a stale copy of team-collaboration / enforce-role-scopes /
   series-production.sql was re-run. A missing Art Room role is NEVER this case. */
function _turnReadableKeyRefused(stage, error){
  const text = String((error&&error.message)||error||"");
  if(/write access is required/i.test(text)) return false;
  if(stage==="reservation") return /path is outside the caller project scope/i.test(text);
  const status = Number(error&&(error.statusCode!==undefined?error.statusCode:error.status));
  return status===403 || /row-level security/i.test(text);
}
const TURN_READABLE_FALLBACK_WARNING =
  "This image was saved under the standard storage folders: the server refused the readable folder names (re-run the current supabase SQL files).";
/* The fallback is silent for users (the save succeeds); tell whoever has the console
   open, once per page, where to look: admin-inventory.sql's RESULT row 126. */
let _turnReadableFallbackWarned = false;
function _turnWarnReadableFallback(){
  if(_turnReadableFallbackWarned) return;
  _turnReadableFallbackWarned = true;
  try{
    if(window.console && typeof window.console.warn==="function")
      window.console.warn("[TURN storage] "+TURN_READABLE_FALLBACK_WARNING
        +" Admin: run supabase/admin-inventory.sql and read RESULT row 126.");
  }catch(e){}
}
async function cloudUploadImage(projectId, uid, entityId, dataUrl, assetType, role, version, allowRemote, diagnostics, stamp, folders){
  // callers that pass no diagnostics still need the stage/error for the legacy retry
  if(!diagnostics || typeof diagnostics!=="object") diagnostics = {};
  const sb = sbClient();
  if(!sb){
    _seriesRecordUploadError(diagnostics,"client",null,
      "Cloud image storage is unavailable. Sign in again or check cloud configuration.");
    return null;
  }
  let blob = dataUrlToBlob(dataUrl);
  /* Generated project references are commonly short-lived signed HTTP URLs,
     not data URLs. Snapshot their bytes while the URL is valid so Details can
     keep showing the exact input after reload/expiry. Personal/device inputs
     are filtered out by the generation runner before cloudCommit receives
     refs, so this path remains project-material only. */
  if(!blob && allowRemote && /^(https?:|blob:)/i.test(String(dataUrl||""))){
    try{
      const response=await fetch(dataUrl);
      if(!response.ok){
        _seriesRecordUploadError(diagnostics,"reference-network",
          {message:"Reference image download returned HTTP "+(response.status||"error"),status:response.status},
          "Reference image could not be downloaded.");
        return null;
      }
      const candidate=await response.blob();
      if(candidate && /^image\//i.test(candidate.type||"")) blob=candidate;
      else{
        _seriesRecordUploadError(diagnostics,"reference-input",null,
          "Reference image data is not a valid image.");
        return null;
      }
    }catch(e){
      _seriesRecordUploadError(diagnostics,"reference-network",e,
        "Reference image could not be downloaded.");
      return null;
    }
  }
  if(!blob || !blob.size || !/^image\//i.test(blob.type||"")){
    _seriesRecordUploadError(diagnostics,"input",null,
      "The generated image data is invalid or could not be read as an image.");
    return null;
  }
  /* Top folders: the caller's (one save shares one prefix), else resolved here. */
  let useFolders = (folders && typeof folders==="object" && folders.account && folders.project)
    ? folders : await turnStorageFolders(sb, uid, projectId);
  const noteFallback = ()=>{
    if(diagnostics&&typeof diagnostics==="object") diagnostics.warning=TURN_READABLE_FALLBACK_WARNING;
    _turnWarnReadableFallback();
  };
  for(let attempt=0; attempt<2; attempt++){
    let path;
    try{
      path = turnStoragePath(useFolders.account, useFolders.project, entityId, assetType, role, turnExtForMime(blob.type), version, stamp);
      /* A readable key must parse back to exactly this uploader and project (the
         only thing the server checks); anything else is rebuilt as a legacy key. */
      if(useFolders.readable && !_turnPathInScope(path, uid, projectId)){
        useFolders = _turnLegacyStorageFolders(uid, projectId);
        path = turnStoragePath(uid, projectId, entityId, assetType, role, turnExtForMime(blob.type), version, stamp);
        noteFallback();
      }
    }
    catch(e){
      _seriesRecordUploadError(diagnostics,"input",e,"The generated image path could not be prepared.");
      return null;
    }
    /* One-shot legacy retry (spec §5.1): only for a readable key the server refused
       by its folder check, never for a missing Art Room role. */
    const retryLegacy = (stage, error)=>{
      if(!useFolders.readable || attempt>0 || !_turnReadableKeyRefused(stage, error)) return false;
      turnStorageFoldersDisable();
      useFolders = _turnLegacyStorageFolders(uid, projectId);
      if(diagnostics&&typeof diagnostics==="object"){
        for(const key of ["stage","error","message","status","code"]) delete diagnostics[key];
      }
      noteFallback();
      return true;
    };
    /* Compatibility contract: _seriesBeginAssetUploadIntent(sb,projectId,path) */
    if(!await _seriesBeginAssetUploadIntent(sb,projectId,path,diagnostics)){
      const refusal = _seriesReservationErrors.get(diagnostics);
      _seriesReservationErrors.delete(diagnostics);
      if(retryLegacy("reservation", refusal)) continue;
      return null;
    }
    try{
      const { error } = await sb.storage.from(turnBucket()).upload(path, blob, { contentType:blob.type, upsert:false });
      if(error){
        /* if(error){ cloudRemovePaths([path]) remains the exact compensation key. */
        _seriesRecordUploadError(diagnostics,
          _seriesUploadNetworkError(error)?"storage-network":"storage",error,
          "Cloud image storage rejected the upload.");
        /* The response may be ambiguous even when Storage accepted the bytes.
           Compensate while the exact intent is live; finish is performed by
           cloudRemovePaths only after Storage confirms removal. */
         try{ await cloudRemovePaths([path]); }
         catch(e){
           if(diagnostics&&typeof diagnostics==="object")
             diagnostics.cleanupWarning=_seriesSafeUploadMessage(e,"Cloud upload cleanup failed.");
         }
        if(retryLegacy("storage", error)) continue;
        return null;
      }
      return path;
    }catch(e){
       try{ await cloudRemovePaths([path]); }
       catch(cleanupError){
         if(diagnostics&&typeof diagnostics==="object")
           diagnostics.cleanupWarning=_seriesSafeUploadMessage(cleanupError,"Cloud upload cleanup failed.");
       }
      _seriesRecordUploadError(diagnostics,
        _seriesUploadNetworkError(e)?"storage-network":"storage",e,
        "Cloud image storage could not accept the upload.");
      return null;
    }
  }
  return null;
}
async function cloudRemovePaths(paths){
  const sb = sbClient(), unique=Array.from(new Set((paths||[]).filter(Boolean)));
  if(!unique.length) return { ok:true };
  if(!sb) throw new Error("cloud cleanup unavailable");
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const { error }=await sb.storage.from(turnBucket()).remove(unique);
      if(!error){
        /* A failed finish is harmless: the one-path capability expires on the
           server and remains in memory so another confirmed removal can retry. */
        await _seriesFinishAssetUploadIntents(unique);
        return { ok:true };
      }
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

function _seriesStableHash(value){
  /* Deterministic 53-bit hash. Promotion paths must survive a lost HTTP response:
     a retry addresses the same object instead of making another orphan. */
  const s=String(value||"");
  let h1=0xdeadbeef^s.length, h2=0x41c6ce57^s.length;
  for(let i=0;i<s.length;i++){
    const c=s.charCodeAt(i);
    h1=Math.imul(h1^c,2654435761); h2=Math.imul(h2^c,1597334677);
  }
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(36);
}
function _seriesMigrationKey(fromProjectId,entityId){
  return "series-asset-v2:"+String(fromProjectId)+":"+String(entityId);
}
/* folders: the uploader's and the Show's top folders from turnStorageFolders (legacy:
   uid and Show id). The file name stays deterministic, so a retry under the same
   folders adopts the same copy; a retry after readable folders switched on makes one
   extra copy, which admin-inventory lists as superseded once the Show row exists. */
function _seriesMigrationTarget(folders,entityId,sourcePath){
  const filename=String(sourcePath||"").split("/").pop()||"asset.png";
  const dot=filename.lastIndexOf(".");
  const ext=(dot>0&&/^[.][a-z0-9]{1,10}$/i.test(filename.slice(dot)))?filename.slice(dot).toLowerCase():".png";
  return [folders.account,folders.project,"series-migration",turnSafeSeg(entityId),_seriesStableHash(sourcePath)+ext].join("/");
}
function _seriesCopyAlreadyExists(error){
  const status=Number(error&&(error.statusCode||error.status));
  return status===409 || /already exists|duplicate|resource exists|the resource already exists/i.test(String(error&&error.message||error||""));
}
function _seriesMigrationRowValid(row,sourcePathCount){
  if(!row || !Array.isArray(row.refs) || !Array.isArray(row.history)) return false;
  return !sourcePathCount || cloudRowPaths(row).size>0;
}
async function _seriesDestinationRow(sb,projectId,entityId){
  const {data,error}=await sb.from("turn_generations").select("*")
    .eq("project_id",projectId).eq("entity_id",entityId).maybeSingle();
  if(error) throw error;
  return data||null;
}

/* Promote every sheet belonging to a shared Bible entity from Episode 1 into
   the Show scope. Source rows/files are immutable. Destination object names and
   the row migration key are deterministic, so a retry after an ambiguous copy
   or insert response can adopt the already-committed result. Cleanup first reads
   back every destination row and never removes an object that any row references. */
async function cloudPromoteProjectAssets(fromProjectId,toProjectId,baseEntityIds){
  const sb=sbClient();
  if(!sb||!fromProjectId||!toProjectId) return {ok:false,message:"Cloud asset storage is unavailable."};
  if(String(fromProjectId)===String(toProjectId)) return {ok:true,moved:0,skipped:0};
  const bases=Array.from(new Set((baseEntityIds||[]).filter(Boolean).map(String)));
  if(!bases.length) return {ok:true,moved:0,skipped:0};
  const belongs=(entityId)=>bases.some(base=>{
    const id=String(entityId||"");
    return id===base || id.indexOf(base+":")===0 || id.indexOf(base+"-")===0;
  });
  const copied=new Set();
  let cleanupVerificationBlocked=false;
  const cleanMeta=(meta)=>{
    const next={...(meta||{})};
    delete next.cleanupPending; delete next.cleanupTombstone;
    return next;
  };
  const remapRef=(ref,pathMap)=> ref ? {...ref,
    ...(ref.storage_path?{storage_path:pathMap.get(ref.storage_path)||ref.storage_path}:{})} : ref;
  const remapHistory=(history,pathMap)=>(history||[]).map(h=> h ? {...h,
    ...(h.storage_path?{storage_path:pathMap.get(h.storage_path)||h.storage_path}:{}),
    meta:cleanMeta(h.meta), refs:(h.refs||[]).map(r=>remapRef(r,pathMap))} : h);
  const cleanupUnreferenced=async()=>{
    if(!copied.size) return null;
    if(cleanupVerificationBlocked)
      return "Copied assets were retained because the migration commit could not be read back safely.";
    /* Query the complete destination project, not merely the promoted entities:
       references may intentionally be shared between generation rows. If this
       safety read is ambiguous, retain the bytes for the next idempotent retry. */
    let destination;
    try{
      const {data,error}=await sb.from("turn_generations")
        .select("entity_id,storage_path,refs,history").eq("project_id",toProjectId);
      if(error) throw error;
      destination=data||[];
    }catch(e){
      return "Copied assets were retained because their committed references could not be verified.";
    }
    const protectedPaths=new Set();
    for(const row of destination) for(const path of cloudRowPaths(row)) protectedPaths.add(path);
    const remove=Array.from(copied).filter(path=>!protectedPaths.has(path));
    if(!remove.length) return null;
    try{
      const {error}=await sb.storage.from(turnBucket()).remove(remove);
      if(error) throw error;
      return null;
    }catch(e){ return "Some unreferenced migration copies could not be cleaned up and will be retried later."; }
  };
  let moved=0, skipped=0;
  try{
    const session=await cloudGetSession();
    const uid=session&&session.user&&session.user.id;
    if(!uid) return {ok:false,message:"Your session has expired. Sign in again."};
    // one promotion = one prefix: the uploader's and the Show's folders, resolved once
    let promotionFolders=await turnStorageFolders(sb,uid,toProjectId);
    const {data:source,error:sourceErr}=await sb.from("turn_generations").select("*")
      .eq("project_id",fromProjectId);
    if(sourceErr) throw sourceErr;
    const rows=(source||[]).filter(r=>r&&belongs(r.entity_id)
      && !(r.meta&&r.meta.cleanupTombstone));
    if(!rows.length) return {ok:true,moved:0,skipped:0};
    const ids=rows.map(r=>r.entity_id);
    const {data:existing,error:destErr}=await sb.from("turn_generations").select("*")
      .eq("project_id",toProjectId).in("entity_id",ids);
    if(destErr) throw destErr;
    const existingById=new Map((existing||[]).map(r=>[String(r.entity_id),r]));
    for(const row of rows){
      const entityId=String(row.entity_id), migrationKey=_seriesMigrationKey(fromProjectId,entityId);
      let current=existingById.get(entityId)||null;
      const sourcePaths=Array.from(cloudRowPaths(row));
      const currentKey=current&&current.meta&&current.meta.seriesMigrationKey;
      const legacySource=current&&current.meta&&String(current.meta.seriesMigratedFrom||"")===String(fromProjectId);
      /* A complete idempotent replay or a legitimate, populated Show-owned row
         wins. Never replace later Show edits with the old Episode snapshot. */
      if(current && _seriesMigrationRowValid(current,sourcePaths.length)
        && (currentKey===migrationKey || legacySource || !currentKey)){
        skipped++; continue;
      }
      if(current && currentKey!==migrationKey && !legacySource){
        throw new Error("The existing shared asset "+entityId+" is incomplete and was not created by this migration.");
      }
      const pathMap=new Map();
      for(const sourcePath of sourcePaths){
        let target=_seriesMigrationTarget(promotionFolders,entityId,sourcePath);
        let {error:copyErr}=await sb.storage.from(turnBucket()).copy(sourcePath,target);
        if(copyErr && promotionFolders.readable && !_seriesCopyAlreadyExists(copyErr)
          && _turnReadableKeyRefused("storage",copyErr)){
          /* a stale SQL re-run refuses readable folders: legacy keys from here on */
          turnStorageFoldersDisable();
          if(typeof _turnWarnReadableFallback==="function") _turnWarnReadableFallback();
          promotionFolders=_turnLegacyStorageFolders(uid,toProjectId);
          target=_seriesMigrationTarget(promotionFolders,entityId,sourcePath);
          ({error:copyErr}=await sb.storage.from(turnBucket()).copy(sourcePath,target));
        }
        if(copyErr && !_seriesCopyAlreadyExists(copyErr)) throw copyErr;
        if(!copyErr) copied.add(target);
        pathMap.set(sourcePath,target);
      }
      const fields={
        storage_path:row.storage_path?(pathMap.get(row.storage_path)||null):null,
        meta:{...cleanMeta(row.meta),seriesMigratedFrom:fromProjectId,
          seriesMigrationKey:migrationKey,seriesMigrationStatus:"complete",
          seriesMigratedAt:(current&&current.meta&&current.meta.seriesMigratedAt)||new Date().toISOString()},
        refs:(row.refs||[]).map(r=>remapRef(r,pathMap)),
        history:remapHistory(row.history,pathMap)};
      let written=null, mutationError=null;
      try{
        if(current){
          /* Only an invalid/incomplete row from this same migration is repaired.
             The CAS fence prevents overwriting a collaborator who fixed it after
             our read. */
          written=await cloudCasGen(toProjectId,uid,entityId,current,fields);
          if(written&&written._cloudMutationError) mutationError=new Error(written._cloudMutationError);
          else if(!written) mutationError=new Error("Shared asset changed while its migration was being repaired.");
        }else{
          const result=await sb.from("turn_generations").insert({
            project_id:toProjectId,owner:uid,entity_id:entityId,...fields,
          }).select().single();
          if(result.error) mutationError=result.error; else written=result.data||null;
        }
      }catch(e){ mutationError=e; }
      if(mutationError || !written){
        /* Insert/update responses can be lost after the database commits. Read
           back before classifying failure or deleting a single copied object. */
        try{ current=await _seriesDestinationRow(sb,toProjectId,entityId); }
        catch(readError){
          cleanupVerificationBlocked=true;
          throw (mutationError||readError);
        }
        const replay=current&&current.meta&&current.meta.seriesMigrationKey===migrationKey;
        if(replay && _seriesMigrationRowValid(current,sourcePaths.length)) written=current;
        else if(current && _seriesMigrationRowValid(current,sourcePaths.length)){
          skipped++; continue; // a concurrent canonical Show row won
        }else throw (mutationError||new Error("Shared asset migration did not commit."));
      }
      moved++;
    }
    const cleanupWarning=await cleanupUnreferenced();
    return {ok:true,moved,skipped,...(cleanupWarning?{cleanupWarning}:{})};
  }catch(e){
    const cleanupWarning=await cleanupUnreferenced();
    return {ok:false,moved,skipped,message:(e&&e.message)||"Shared assets could not be migrated.",
      ...(cleanupWarning?{cleanupWarning}:{})};
  }
}
window.cloudPromoteProjectAssets=cloudPromoteProjectAssets;
function cloudApplySnapshot(q,row){
  /* Every turn_generations update passes through turn_generations_touch, so
     updated_at is the row's compact optimistic-concurrency token. The previous
     implementation put storage_path + the complete meta/refs/history JSON into
     URL query filters; richly referenced location plates could exceed the HTTP
     URL limit and fail after their image bytes had already uploaded. */
  if(row&&row.updated_at) return q.eq("updated_at",row.updated_at);
  // Compatibility fallback for local recording adapters or pre-migration rows.
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
  /* A permanent image purge deliberately retains its tombstone row (and its
     history/specification evidence).  The old generic pending-cleanup reader
     deletes tombstone rows after storage cleanup, which would make a later
     retry or a details read capable of falling back to the wrong pixels. */
  if(row&&row.meta&&row.meta.cleanupPurge&&!row.storage_path) return row;
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
    fields=_cloudPreservePurgeReceipts(previous,fields,entityId);
    if(!previous){
      const table=sb.from("turn_generations");
      /* Production uses insert-if-absent. The fallback only supports older recording
         adapters that predate insert(); Supabase clients always take the insert path. */
      const mutation=typeof table.insert==="function"
        ? table.insert({project_id:projectId,owner:uid,entity_id:entityId,...fields})
        : table.upsert({project_id:projectId,owner:uid,entity_id:entityId,...fields},{onConflict:"project_id,entity_id"});
      const {data,error}=await mutation.select().single();
      if(error) return {_cloudMutationError:error.message||"generation row insert failed"};
      return data||null;
    }
    let q=sb.from("turn_generations").update(fields)
      .eq("project_id",projectId).eq("entity_id",entityId);
    q=cloudApplySnapshot(q,previous);
    const { data,error }=await q.select().maybeSingle();
    if(error) return {_cloudMutationError:error.message||"generation row update failed"};
    return data||null;
  }catch(e){ return {_cloudMutationError:(e&&e.message)||"generation row mutation failed"}; }
}
function cloudPendingMeta(meta,paths,tombstone){
  const next={...(meta||{})}, pending=Array.from(new Set((paths||[]).filter(Boolean)));
  if(pending.length) next.cleanupPending=pending; else delete next.cleanupPending;
  if(tombstone) next.cleanupTombstone=true; else delete next.cleanupTombstone;
  return next;
}
async function cloudFinishPending(projectId,uid,entityId,row,options){
  options=options||{};
  const pending=row&&row.meta&&Array.isArray(row.meta.cleanupPending)?row.meta.cleanupPending:[];
  if(!pending.length) return {row,warning:null};
  const retained=cloudRowPaths(row), remove=pending.filter(p=>!retained.has(p));
  let failed=[];
  if(options.perPath){
    /* Storage.remove is an exact-key operation, but a provider adapter can
       report a partial batch failure.  Retrying one key at a time lets the
       durable ledger truthfully retain only keys still needing cleanup. */
    for(let i=0;i<remove.length;i++){
      if(typeof options.cancelled==="function"&&options.cancelled())
        return {row,warning:"Cloud cleanup was cancelled; exact cleanup remains pending."};
      const path=remove[i];
      try{ await cloudRemovePaths([path]); }catch(e){ failed.push(path); }
    }
  }else{
    try{ await cloudRemovePaths(remove); }
    catch(e){ failed=pending.slice(); }
  }
  if(failed.length){
    const warning="Cloud cleanup is incomplete; "+failed.length+" exact object"+(failed.length===1?" remains":"s remain")+" pending.";
    /* The row is still the tombstone authority.  Recording the exact remainder
       is best effort; if a collaborator changed it, leaving the old superset is
       safer than claiming bytes were removed. */
    const nextMeta=cloudPendingMeta(row.meta||{},failed,!!(row.meta&&row.meta.cleanupTombstone));
    const marked=await cloudCasGen(projectId,uid||row.owner,entityId,row,{
      storage_path:row.storage_path,meta:nextMeta,refs:row.refs||[],history:row.history||[]});
    if(marked&&!marked._cloudMutationError) return {row:marked,warning};
    return {row,warning};
  }
  const sb=sbClient();
  if(row.meta&&row.meta.cleanupTombstone){
    if(options.retainTombstone){
      const meta={...(row.meta||{})};
      delete meta.cleanupPending; delete meta.cleanupTombstone;
      const after=await cloudCasGen(projectId,uid||row.owner,entityId,row,{
        storage_path:row.storage_path,meta,refs:row.refs||[],history:row.history||[]});
      return after&&!after._cloudMutationError
        ? {row:after,warning:null}
        : {row,warning:"cleanup completed; purge tombstone changed before removal"};
    }
    let q=sb.from("turn_generations").delete().eq("project_id",projectId).eq("entity_id",entityId);
    q=cloudApplySnapshot(q,row);
    const {data,error}=await q.select().maybeSingle();
    if(error||!data) return {row,warning:"cleanup completed; tombstone changed before removal"};
    return {row:null,warning:null};
  }
  const meta={...(row.meta||{})}; delete meta.cleanupPending; delete meta.cleanupTombstone;
  const after=await cloudCasGen(projectId,uid||row.owner,entityId,row,{
    storage_path:row.storage_path,meta,refs:row.refs||[],history:row.history||[]});
  return after&&!after._cloudMutationError ? {row:after,warning:null}
    : {row,warning:(after&&after._cloudMutationError)||"cleanup completed; pending marker changed before removal"};
}
/* commit a new generation: upload image, roll the previous one into history,
   upload + store reference images, persist metadata. refs in = [{kind,label,url}]. */
async function cloudCommit(projectId, uid, entityId, dataUrl, meta, refs, kind, cancelled, diagnostics){
  const uploadDiagnostics=(diagnostics&&typeof diagnostics==="object")?diagnostics:{};
  const withDiagnostics=(result)=>{
    if(!Object.keys(uploadDiagnostics).length) return result;
    return {...result,
      ...(uploadDiagnostics.warning&&!result.warning?{warning:uploadDiagnostics.warning}:{}),
      ...(uploadDiagnostics.cleanupWarning&&!result.cleanupWarning
        ?{cleanupWarning:uploadDiagnostics.cleanupWarning}:{}),
      diagnostics:uploadDiagnostics};
  };
  const commitError=(error,extra)=>{
    const result={tier:"error",url:dataUrl,error,...(extra||{})};
    return withDiagnostics(result);
  };
  const cleanupCreated=async(result)=>{
    try{ await cloudRemovePaths(created); }
    catch(e){
      /* Never replace the staged upload/RPC/storage error with a cleanup error.
         The exact-path cleanup warning remains available to the pending-save UI. */
      result.cleanupWarning=_seriesSafeUploadMessage(e,"Cloud upload cleanup failed.");
    }
    return result;
  };
  const _cxl=()=>typeof cancelled==="function"&&!!cancelled();
  if(_cxl()) return { tier:"cancelled", url:dataUrl };
  if(!sbClient()){
    _seriesRecordUploadError(uploadDiagnostics,"client",null,
      "Cloud image storage is unavailable. Sign in again or check cloud configuration.");
    return commitError(uploadDiagnostics.message);
  }
  const activeClient=sbClient();
  /* Real Supabase clients expose auth.getSession. Check it before the reservation
     RPC so an expired session cannot reach Storage through the compatibility path.
     Tiny local recording adapters intentionally omit this method. */
  if(activeClient&&typeof activeClient.rpc==="function"
    && activeClient.auth&&typeof activeClient.auth.getSession==="function"){
    try{
      const authResult=await activeClient.auth.getSession();
      const session=authResult&&authResult.data&&authResult.data.session;
      if((authResult&&authResult.error)||!session||!session.user){
        const authError=(authResult&&authResult.error)||{
          status:401,code:"AUTH_SESSION",message:"Your cloud session has expired. Sign in again before saving this image.",
        };
        _seriesRecordUploadError(uploadDiagnostics,"auth",authError,
          "Your cloud session has expired. Sign in again before saving this image.");
        return commitError(uploadDiagnostics.message);
      }
    }catch(e){
      _seriesRecordUploadError(uploadDiagnostics,"auth",e,
        "Your cloud session could not be verified. Sign in again before saving this image.");
      return commitError(uploadDiagnostics.message);
    }
  }
  const assetType = kind || "character";   // {assetType} path segment (see turnStoragePath)
  // version-at-birth hint in the filename (non-authoritative; the live version comes
  // from the DB). refs/cameo angles aren't versioned, so they pass no version.
  const ver = (meta && meta.version) || 1, created=[];
  const saveStamp = turnStamp();   // one save = one timestamp across the sheet and its reference snapshots
  // one save = one prefix: the top folders are resolved ONCE for the sheet and every reference
  const saveFolders = await turnStorageFolders(activeClient, uid, projectId);
  let row;
  try{ row=await cloudGetGenStrict(projectId,entityId); }
  catch(e){
    _seriesRecordUploadError(uploadDiagnostics,"generation-read",e,"Cloud generation could not be read.");
    return commitError(uploadDiagnostics.message||"Cloud generation could not be read.");
  }
  if(_cxl()) return { tier:"cancelled", url:dataUrl };
  let purgeReceipts=[];
  try{
    /* One bounded preflight receipt read prevents supported writers from
       reintroducing references that a completed purge already revoked.  The
       post-write fence below closes the intervening scan/write race. */
    purgeReceipts=_purgeReceiptTargets(
      await _purgeReceiptCandidateRows(activeClient,projectId,entityId,refs,row));
  }catch(e){
    return commitError("Cloud purge receipts could not be verified before saving.");
  }
  if(_cxl()) return { tier:"cancelled", url:dataUrl };
  const newPath = await cloudUploadImage(projectId, uid, entityId, dataUrl, assetType, "sheet", ver, false, uploadDiagnostics, saveStamp, saveFolders);
  if(!newPath) return commitError(
    (uploadDiagnostics.error&&uploadDiagnostics.error.message)||"Image upload failed.");
  created.push(newPath);
  /* the references follow the folders the sheet really landed under (a refused
     readable key retries the sheet as a legacy key) */
  const refFolders = _turnFoldersOfPath(newPath, uid, projectId) || saveFolders;
  if(_cxl()) return await cleanupCreated(withDiagnostics({tier:"cancelled",url:dataUrl}));
  let history = (row && row.history) || [];
  let dropped=[];
  if(row && row.storage_path){
    history = [{ storage_path:row.storage_path, meta:row.meta||{}, refs:row.refs||[] }, ...history];
    if(history.length > 12){ dropped=history.slice(12); history = history.slice(0,12); }
  }
  const refRows = [];
  for(const r of (refs || [])){
    const provenance={kind:r&&r.kind, label:r&&r.label,
      refId:r&&r.refId||undefined,refVersion:r&&r.refVersion||undefined,
      refGenerated:r&&r.refGenerated||undefined,
      ...(r&&r.meta?{meta:r.meta}:{}),
      ...(r&&r.seedSource?{seedSource:r.seedSource}:{})};
    const blocked=_purgeReceiptMatch(r,purgeReceipts,{meta:(r&&r.meta)||{}});
    if(blocked){
      /* Keep the derived output, but never persist a fresh live copy of a
         reference whose source version has a durable purge receipt. */
      refRows.push(_purgeDeletedReference({...provenance,storage_path:null}));
      continue;
    }
    let p = null;
    /* Reference snapshots remain best-effort. A failed optional reference keeps
       its null storage_path/provenance row and must not abort the generated sheet. */
    if(r&&r.url) p = await cloudUploadImage(projectId, uid, entityId, r.url, assetType, "ref-"+turnSafeSeg(r.kind||"img"),undefined,true,undefined,saveStamp,refFolders);
    if(p) created.push(p);
    if(_cxl()) return await cleanupCreated(withDiagnostics({tier:"cancelled",url:dataUrl}));
    refRows.push({...provenance,storage_path:p});
  }
  let cleanMeta={...(meta||{})}; delete cleanMeta.approval;
  /* A new generation may legitimately replace a completed purge tombstone, but
     its receipt must travel with the current/history metadata so future writers
     still fence the deleted ISO. */
  const inheritedReceipts=[
    ...((row&&row.meta&&row.meta.cleanupPurgeReceipts)||[]),
    ...(row&&row.meta&&row.meta.cleanupPurgeTarget?[row.meta.cleanupPurgeTarget]:[]),
  ].filter(Boolean);
  if(inheritedReceipts.length){
    const seen=new Set();
    cleanMeta.cleanupPurgeReceipts=inheritedReceipts.filter(marker=>{
      const target=_purgeReceiptTarget(marker,entityId);
      if(!target) return false;
      const key=[target.id,target.storagePath,target.iso,
        target.version==null?"":String(target.version)].join("\x1f");
      if(seen.has(key)) return false;
      seen.add(key); return true;
    });
    if(!cleanMeta.cleanupPurgeTarget)
      cleanMeta.cleanupPurgeTarget=cleanMeta.cleanupPurgeReceipts[0];
  }
  const pendingBefore=(row&&row.meta&&row.meta.cleanupPending)||[];
  const provisional={storage_path:newPath,meta:cleanMeta,refs:refRows,history};
  const retained=cloudRowPaths(provisional);
  const trimPaths=Array.from(cloudRowPaths({history:dropped})).filter(p=>!retained.has(p));
  cleanMeta=cloudPendingMeta(cleanMeta,[...pendingBefore,...trimPaths],false);
  const fields = { storage_path:newPath, meta:cleanMeta, refs:refRows, history };
  if(_cxl()) return await cleanupCreated(withDiagnostics({tier:"cancelled",url:dataUrl}));
  /* Signing is read-only, but doing it before the row mutation removes another
     cancellation window after durable success. */
  const url = await cloudSignedUrl(newPath,uploadDiagnostics);
  if(_cxl()) return await cleanupCreated(withDiagnostics({tier:"cancelled",url:dataUrl}));
  if(!url){
    return await cleanupCreated(commitError(
      uploadDiagnostics.message||"The uploaded image could not be prepared for viewing."));
  }
  let written=await cloudCasGen(projectId,uid,entityId,row,fields);
  if(!written || written.storage_path!==newPath){
    const mutationError=written&&written._cloudMutationError;
    if(mutationError)
      _seriesRecordUploadError(uploadDiagnostics,"generation-write",mutationError,"Generation row write failed.");
    let live=null, readbackFailed=false;
    try{ live=await cloudGetGenStrict(projectId,entityId); }catch(e){ readbackFailed=true; }
    // Returning representation can fail independently of an already-committed
    // mutation. A strict reread is the verification; upload success alone never is.
    if(live && live.storage_path===newPath) written=live;
    else{
      /* If both the mutation response and readback are inconclusive, the write may
         have landed. Deleting its unique bytes could corrupt that live row. Report
         the uncertain outcome and leave cleanup to a later explicit user action. */
      if(readbackFailed) return commitError("Generation row write outcome could not be verified",
        {path:newPath,persisted:"unknown"});
      const mutationMessage=mutationError
        ? "Generation row write failed: "+_seriesSafeUploadMessage(mutationError)
        : (!row?"Another client created this asset; retry against its preserved version":"Generation row changed while saving; retry against the latest version");
      const failed=commitError(mutationMessage,{retry:!row});
      try{ await cloudRemovePaths(created.filter(p=>!cloudRowPaths(live).has(p))); }
      catch(e){ failed.cleanupWarning=_seriesSafeUploadMessage(e,"Cloud upload cleanup failed."); }
      return failed;
    }
  }
  if(!written || written.storage_path!==newPath){
    return commitError(uploadDiagnostics.message||"Generation row write failed");
  }
  let postFenceWarning="";
  try{
    /* The source may be purged after preflight but before this row CAS.  Scan
       once after the write and fence only matching refs; the derived output and
       its current image remain intact. */
    const postRows=await _purgeReceiptCandidateRows(
      activeClient,projectId,entityId,refs,written);
    const postReceipts=_purgeReceiptTargets(postRows);
    const fencePaths=new Set();
    const rewritten=_purgeRewriteReceiptRow(written,postReceipts,fencePaths);
    if(rewritten.changed){
      const fenceMeta=cloudPendingMeta(written.meta||{},
        [...((written.meta&&written.meta.cleanupPending)||[]),...fencePaths],false);
      const fenced=await cloudCasGen(projectId,uid,entityId,written,{
        storage_path:written.storage_path,meta:fenceMeta,
        refs:rewritten.refs,history:rewritten.history});
      if(!fenced||fenced._cloudMutationError)
        return commitError("Generation saved, but its revoked reference fence changed; refresh before using this output.",
          {path:newPath,persisted:true,
            cleanupWarning:"A late purged reference remains pending for the next authorized refresh."});
      const finishedFence=await cloudFinishPending(projectId,uid,entityId,fenced);
      written=finishedFence.row||fenced;
      if(finishedFence.warning) postFenceWarning=finishedFence.warning;
    }
  }catch(e){
    return commitError("Generation saved, but its revoked reference fence could not be verified.",
      {path:newPath,persisted:true,
        cleanupWarning:"A late purged reference remains pending for the next authorized refresh."});
  }
  /* The row now durably owns every newly uploaded path. Retire the temporary
     exact-path cleanup capability. If this acknowledgement is lost, the intent
     simply expires; it never expands beyond these paths. */
  await _seriesFinishAssetUploadIntents(created);
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
    return withDiagnostics(await compensateCancellation(written));
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
    return withDiagnostics(await compensateCancellation(finished.row||written));
  }
  return withDiagnostics({ tier:"cloud", url, path:newPath,
    ...(postFenceWarning?{cleanupWarning:postFenceWarning}:{}),
    ...(finished.warning?{cleanupWarning:finished.warning}:{}) });
}
async function cloudAssetLoad(projectId, entityId){
  /* Per-card and Stage loads are latency-sensitive. Cleanup is maintenance, not a
     prerequisite for reading this exact current row; awaiting the project-wide
     sweep here made every individual image request queue behind cleanup and could
     leave generated sheets showing Loading forever on a recovering connection. */
  try{ Promise.resolve(cloudSweepPurgeReferences(projectId)).catch(()=>{}); }catch(e){}
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
  try{ await cloudSweepPurgeReferences(projectId); }catch(e){}
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

/* ── exact current-image purge -------------------------------------------------
   This is intentionally separate from cloudClear/cloudDeleteCurrentAndPromote:
   a permanent purge clears one exact current image, never promotes history, and
   never turns an entity-id/name into a storage sweep.  Reference snapshots are
   identified only by their exact path, by (refId, refGenerated), or by the
   explicit shot seed lineage written on the reference entry/history item. */
function _purgeTargetSame(a,b){
  if(!a||!b) return false;
  return String(a.id||"")===String(b.id||"")
    && String(a.storagePath||"")===String(b.storagePath||"")
    && String(a.iso||"")===String(b.iso||"")
    && ((a.version==null && b.version==null)
      || (a.version!=null && b.version!=null && Number(a.version)===Number(b.version)));
}
function _purgeSeedSource(ref,entry){
  return (ref&&ref.meta&&ref.meta.seedSource)
    || (ref&&ref.seedSource)
    || (entry&&entry.meta&&entry.meta.seedSource)
    || null;
}
function _purgeRefMatches(ref,target,entry){
  if(!ref) return false;
  const allowDeleted=arguments.length>3&&arguments[3]===true;
  if(ref.deleted&&!allowDeleted) return false;
  const path=String(ref.storage_path||ref.deletedStoragePath||"");
  if(path && path===String(target.storagePath||"")) return true;
  /* An ISO is the authoritative identity for a generated version.  A refId
     alone is deliberately insufficient: it commonly points at a newer take. */
  if(ref.refId!=null && String(ref.refId)===String(target.id)
      && target.iso && String(ref.refGenerated||"")===String(target.iso)) return true;
  /* Unnamed Base references are used by shot seed chains.  Require the direct
     source shot and its exact ISO; version alone is not enough because old
     imported rows reused version numbers. */
  const seed=_purgeSeedSource(ref,entry);
  if(!ref.refId && seed
      && String(seed.seedShotId||"")===String(target.id)
      && target.iso && String(seed.seedIso||"")===String(target.iso)){
    if(seed.seedVersion!=null && target.version!=null
       && Number(seed.seedVersion)!==Number(target.version)) return false;
    return true;
  }
  return false;
}
function _purgeCollectEvidencePaths(row,target,paths){
  const collect=(ref,entry)=>{
    if(!_purgeRefMatches(ref,target,entry,true)) return;
    const path=ref&& (ref.storage_path||ref.deletedStoragePath);
    if(path) paths.add(String(path));
  };
  for(const ref of (row&&row.refs)||[]) collect(ref,row);
  for(const item of (row&&row.history)||[]){
    if(item&&String(item.storage_path||item.deletedStoragePath||"")===String(target.storagePath||""))
      paths.add(String(item.storage_path||item.deletedStoragePath));
    for(const ref of (item&&item.refs)||[]) collect(ref,item);
  }
}
function _purgeRefWarning(ref,target,entry){
  if(!ref||ref.deleted||!ref.storage_path) return false;
  /* These are the only shapes that could plausibly be a copy of this target
     while lacking enough provenance to prove it.  We retain them and disclose
     that scope could not be verified; names and versions are never guessed. */
  if(ref.refId!=null && String(ref.refId)===String(target.id)
      && !String(ref.refGenerated||"")) return true;
  const seed=_purgeSeedSource(ref,entry);
  return !ref.refId && !seed;
}
function _purgeDeletedReference(ref){
  const path=ref&&ref.storage_path ? String(ref.storage_path) : "";
  return {...ref,deleted:true,deletedAt:new Date().toISOString(),
    ...(path?{deletedStoragePath:path}:{}),storage_path:null,url:""};
}
function _purgeRewriteRefs(refs,target,entry,warnings,paths){
  let removed=0, changed=false;
  const out=(Array.isArray(refs)?refs:[]).map(ref=>{
    if(_purgeRefMatches(ref,target,entry)){
      removed++; changed=true;
      if(ref.storage_path) paths.add(String(ref.storage_path));
      return _purgeDeletedReference(ref);
    }
    if(_purgeRefWarning(ref,target,entry)) warnings.add("An older reference snapshot could not be identified exactly and was retained.");
    return ref;
  });
  return {refs:out,removed,changed};
}
function _purgeRewriteRowReferences(row,target,warnings,paths){
  let removed=0,changed=false;
  const direct=_purgeRewriteRefs(row&&row.refs,target,row,warnings,paths);
  removed+=direct.removed; changed=changed||direct.changed;
  const history=(Array.isArray(row&&row.history)?row.history:[]).map(item=>{
    /* A legacy row can (incorrectly but validly) retain the same exact object
       as both current and history.  That history entry is the selected pixels,
       not an unrelated version, so clear its direct path while retaining the
       version/evidence record. */
    if(item&&item.storage_path&&String(item.storage_path)===String(target.storagePath)){
      paths.add(String(item.storage_path)); changed=true;
      return {...item,storage_path:null,deleted:true,
        deletedAt:new Date().toISOString(),deletedStoragePath:String(item.storage_path)};
    }
    const rewritten=_purgeRewriteRefs(item&&item.refs,target,item,warnings,paths);
    removed+=rewritten.removed; changed=changed||rewritten.changed;
    return rewritten.changed ? {...item,refs:rewritten.refs} : item;
  });
  return {
    refs:direct.changed?direct.refs:(row&&row.refs)||[],
    history:changed?history:(row&&row.history)||[],
    removed,changed,
  };
}
async function _purgeProjectGenerationRows(sb,projectId,maxRows){
  const limit=Number.isFinite(maxRows)&&maxRows>0?Math.floor(maxRows):Infinity;
  const rows=[];
  for(let offset=0;;offset+=1000){
    let q=sb.from("turn_generations")
      .select("project_id,owner,entity_id,storage_path,meta,refs,history,updated_at")
      .eq("project_id",projectId);
    if(q&&typeof q.order==="function") q=q.order("entity_id",{ascending:true});
    let response;
    if(q&&typeof q.range==="function")
      response=await q.range(offset,Math.min(offset+999,limit-1));
    else response=await q;
    if(response&&response.error) throw new Error(response.error.message||"generation reference query failed");
    const page=(response&&response.data)||[];
    rows.push(...page);
    if(page.length<1000 || rows.length>=limit || !q || typeof q.range!=="function") break;
  }
  return rows;
}
function _purgeReceiptCandidateIds(entityId,refs,row){
  const ids=new Set();
  const add=id=>{ if(id!=null&&String(id)) ids.add(String(id)); };
  add(entityId);
  const addRef=ref=>{
    add(ref&&ref.refId);
    const seed=(ref&&ref.meta&&ref.meta.seedSource)
      ||(ref&&ref.seedSource);
    add(seed&&seed.seedShotId);
  };
  for(const ref of refs||[]) addRef(ref);
  for(const ref of (row&&row.refs)||[]) addRef(ref);
  for(const item of (row&&row.history)||[])
    for(const ref of item&&item.refs||[]) addRef(ref);
  return Array.from(ids);
}
async function _purgeReceiptCandidateRows(sb,projectId,entityId,refs,row){
  const ids=_purgeReceiptCandidateIds(entityId,refs,row);
  if(!ids.length) return [];
  const fields="project_id,owner,entity_id,storage_path,meta,refs,history,updated_at";
  if(sb.from("turn_generations").in){
    let q=sb.from("turn_generations").select(fields)
      .eq("project_id",projectId).in("entity_id",ids);
    const response=await q;
    if(response&&response.error) throw new Error(response.error.message||"purge receipt query failed");
    return (response&&response.data)||[];
  }
  /* Tiny recording adapters may not expose PostgREST .in().  Keep the
     compatibility path bounded to the exact candidate ids; never fall back to
     a project-wide scan from a normal commit. */
  const rows=[];
  for(const id of ids){
    const response=await sb.from("turn_generations").select(fields)
      .eq("project_id",projectId).eq("entity_id",id);
    if(response&&response.error) throw new Error(response.error.message||"purge receipt query failed");
    if(response&&response.data) rows.push(response.data);
  }
  return rows;
}
function _purgeReceiptTarget(marker,fallbackId){
  if(!marker||!marker.storagePath) return null;
  return {id:String(marker.id||fallbackId||""),storagePath:String(marker.storagePath),
    iso:String(marker.iso||""),version:marker.version==null?null:marker.version};
}
function _purgeReceiptTargets(rows){
  const out=[],seen=new Set(),add=(marker,id)=>{
    const target=_purgeReceiptTarget(marker,id);
    if(!target) return;
    const key=[target.id,target.storagePath,target.iso,
      target.version==null?"":String(target.version)].join("\x1f");
    if(seen.has(key)) return;
    seen.add(key); out.push(target);
  };
  for(const row of rows||[]){
    add(row&&row.meta&&row.meta.cleanupPurgeTarget,row&&row.entity_id);
    for(const marker of (row&&row.meta&&row.meta.cleanupPurgeReceipts)||[])
      add(marker,row&&row.entity_id);
    for(const item of (row&&row.history)||[])
      add(item&&item.meta&&item.meta.cleanupPurgeTarget,row&&row.entity_id);
    for(const item of (row&&row.history)||[])
      for(const marker of (item&&item.meta&&item.meta.cleanupPurgeReceipts)||[])
        add(marker,row&&row.entity_id);
  }
  return out;
}
function _cloudPreservePurgeReceipts(previous,fields,entityId){
  const next={...(fields||{})}, nextMeta={...(next.meta||{})};
  /* Metadata replacement is used by history actions as well as new commits.
     Union only immutable purge receipts from the old current/history and the
     replacement current/history.  Deliberately do not copy cleanupPending or
     any of the old generation's ordinary metadata into the replacement. */
  const receipts=_purgeReceiptTargets([
    previous,
    {entity_id:entityId,meta:nextMeta,history:next.history||[]},
  ]);
  if(!receipts.length) return next;
  nextMeta.cleanupPurgeReceipts=receipts;
  nextMeta.cleanupPurgeTarget=receipts[0];
  next.meta=nextMeta;
  return next;
}
function _purgeReceiptMatch(ref,receipts,entry){
  for(const target of receipts||[])
    if(_purgeRefMatches(ref,target,entry)) return target;
  return null;
}
function _purgeRewriteReceiptRow(row,receipts,paths){
  let changed=false;
  const rewrite=(refs,entry)=>{
    return (Array.isArray(refs)?refs:[]).map(ref=>{
      if(!_purgeReceiptMatch(ref,receipts,entry)) return ref;
      changed=true;
      const path=ref&&ref.storage_path;
      if(path) paths.add(String(path));
      return _purgeDeletedReference(ref);
    });
  };
  const refs=rewrite(row&&row.refs,row);
  const history=(Array.isArray(row&&row.history)?row.history:[]).map(item=>{
    const direct=(receipts||[]).find(target=>item
      &&String(item.storage_path||"")===String(target.storagePath||""));
    if(direct){
      changed=true;
      paths.add(String(item.storage_path));
      return {...item,storage_path:null,deleted:true,
        deletedAt:new Date().toISOString(),deletedStoragePath:String(item.storage_path)};
    }
    const next=rewrite(item&&item.refs,item);
    return next.length||Array.isArray(item&&item.refs)
      ? (next.some((ref,i)=>ref!==((item&&item.refs)||[])[i])
        ? {...item,refs:next}:item) : item;
  });
  return {refs,history,changed};
}
function _purgeCurrentMatches(row,target){
  if(!row) return false;
  return String(row.storage_path||"")===String(target.storagePath||"")
    && ((String(target.iso||"")==="" && String(row.meta&&row.meta.iso||"")==="")
      || String(row.meta&&row.meta.iso||"")===String(target.iso||""))
    && ((target.version==null && row.meta&&row.meta.version==null)
      || (target.version!=null && row.meta&&row.meta.version!=null
        && Number(row.meta&&row.meta.version)===Number(target.version)));
}
function _purgeTargetMarker(row,target){
  const marker=row&&row.meta&&row.meta.cleanupPurgeTarget;
  return marker && _purgeTargetSame(marker,target);
}
function _purgeCancelled(options){
  const c=options&&options.cancelled;
  return typeof c==="function" ? !!c() : c===true;
}
function _purgeRunBusy(entityId){
  try{ return !!(window.__nbGenInflight&&window.__nbGenInflight[entityId]); }catch(e){ return false; }
}
async function cloudPrepareImageDeletion(projectId,entityId){
  if(!projectId||!entityId) throw new Error("image scope is required");
  const pending=await cloudLoadPendingImageDeletion(projectId,entityId);
  if(pending) return pending;
  const row=await cloudGetGenStrict(projectId,entityId);
  if(!row||!row.storage_path) throw new Error("No current image is available to purge.");
  const meta=row.meta||{}, url=await cloudSignedUrl(row.storage_path);
  if(!url) throw new Error("The current image could not be prepared for exact deletion.");
  return Object.freeze({id:String(entityId),epoch:null,backend:"cloud",scope:String(projectId),
    storagePath:String(row.storage_path),iso:String(meta.iso||""),version:meta.version==null?null:meta.version,url});
}
async function cloudLoadPendingImageDeletion(projectId,entityId){
  if(!projectId||!entityId) return null;
  const row=await cloudGetGenStrict(projectId,entityId);
  const meta=row&&row.meta||{}, marker=meta.cleanupPurgeTarget;
  if(!row||row.storage_path||!meta.cleanupPurge||!marker) return null;
  if(String(marker.id||entityId)!==String(entityId)||!marker.storagePath) return null;
  const pending=Array.isArray(meta.cleanupPending)&&meta.cleanupPending.length;
  const unresolved=!!pending||!!meta.cleanupTombstone||!!meta.cleanupPurgeWarning;
  if(!unresolved) return null;
  const actionable=!!pending||!!meta.cleanupTombstone;
  const retryable=actionable && meta.cleanupPurgeRetryable!==false;
  return Object.freeze({id:String(marker.id||entityId),epoch:null,backend:"cloud",
    scope:String(projectId),storagePath:String(marker.storagePath||""),
    iso:String(marker.iso||""),version:marker.version==null?null:marker.version,
    url:"",pending:true,retryable,status:retryable
      ? (meta.cleanupPurgeStatus||"cleanup-pending")
      : "retained-unverified"});
}
async function cloudPurgeImageVersion(projectId,uid,target,options){
  options=options||{};
  if(!projectId||!target||String(target.scope||projectId)!==String(projectId))
    return {ok:false,error:"asset scope changed"};
  if(String(target.backend||"cloud")!=="cloud") return {ok:false,error:"asset backend changed"};
  const sb=sbClient(); if(!sb) throw new Error("cloud unavailable");
  const id=String(target.id||"");
  if(!id||!target.storagePath) return {ok:false,error:"exact image identity required"};
  const guard=()=>_purgeCancelled(options);
  const busy=()=>_purgeRunBusy(id);
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(busy()) return {ok:false,error:"image generation is still in progress"};
  let row=await cloudGetGenStrict(projectId,id);
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(busy()) return {ok:false,error:"image generation is still in progress"};
  if(!row) return {ok:false,error:"image is unavailable"};

  /* A retry addresses only the same durable tombstone.  It can never select a
     newer current image merely because the original path has disappeared. */
  const retryTombstone=!row.storage_path && _purgeTargetMarker(row,target);
  if(!retryTombstone && !_purgeCurrentMatches(row,target))
    return {ok:false,error:"current image changed; purge refused"};
  if(row.storage_path && row.meta&&row.meta.cleanupPurge
      && !_purgeCurrentMatches(row,target))
    return {ok:false,error:"current image changed; purge refused"};

  let rows;
  try{
    rows=await _purgeProjectGenerationRows(sb,projectId);
  }catch(e){ return {ok:false,error:(e&&e.message)||"reference scope could not be verified"}; }
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(busy()) return {ok:false,error:"image generation is still in progress"};

  const warnings=new Set(),paths=new Set([String(target.storagePath)]);
  const mutations=[],sourceRow=rows.find(r=>String(r.entity_id)===id)||row;
  /* The strict read above protects the first window; this second read protects
     the reference-inventory window.  Never turn a collaborator's newer current
     image into this target's tombstone. */
  if((retryTombstone&&!_purgeTargetMarker(sourceRow,target))
      ||(!retryTombstone&&!_purgeCurrentMatches(sourceRow,target)))
    return {ok:false,error:"current image changed; purge refused"};
  const retainedOnly=retryTombstone&&sourceRow.meta
    &&!!sourceRow.meta.cleanupPurgeWarning
    &&!(Array.isArray(sourceRow.meta.cleanupPending)&&sourceRow.meta.cleanupPending.length)
    &&!sourceRow.meta.cleanupTombstone;
  if(retainedOnly){
    const known=rows.some(candidate=>{
      if(!candidate||String(candidate.entity_id)===id
          ||candidate.meta&&candidate.meta.kind==="video") return false;
      return (candidate.refs||[]).some(ref=>_purgeRefMatches(ref,target,candidate))
        ||(candidate.history||[]).some(item=>
          (item&&item.refs||[]).some(ref=>_purgeRefMatches(ref,target,item)));
    });
    if(!known)
      return {ok:false,error:"purge retained an unverified reference; refresh required",
        status:"retained-unverified",retryable:false};
  }
  if(sourceRow.meta&&sourceRow.meta.cleanupPurgeWarning)
    warnings.add(String(sourceRow.meta.cleanupPurgeWarning));
  /* Evidence written by an earlier reference-row CAS is itself a durable
     cleanup ledger.  Recover every deletedStoragePath before making any
     destructive Storage call, including copies attached after the first
     attempt. */
  for(const candidate of rows) _purgeCollectEvidencePaths(candidate,target,paths);
  for(const pending of (sourceRow.meta&&sourceRow.meta.cleanupPending)||[])
    if(pending) paths.add(String(pending));
  let referencesRemoved=0;
  /* Tombstone retries do not rewrite unrelated rows a second time, but a
     partially committed first pass can still finish evidence writes. */
  for(const candidate of rows){
    if(!candidate||String(candidate.entity_id)===id) continue;
    if(candidate.meta&&candidate.meta.kind==="video") continue;
    const rewritten=_purgeRewriteRowReferences(candidate,target,warnings,paths);
    if(rewritten.changed){
      mutations.push({row:candidate,fields:{
        storage_path:candidate.storage_path||null,meta:candidate.meta||{},
        refs:rewritten.refs,history:rewritten.history}});
      referencesRemoved+=rewritten.removed;
    }
  }
  const sourceRewrite=_purgeRewriteRowReferences(sourceRow,target,warnings,paths);
  referencesRemoved+=sourceRewrite.removed;
  if(!retryTombstone){
    const originalMeta={...(sourceRow.meta||{})};
    let purgeMeta={...originalMeta,cleanupPurge:true,cleanupPurgeTarget:{
      id,storagePath:String(target.storagePath),iso:String(target.iso||""),
      version:target.version==null?null:target.version},
      deleted:true,deletedStoragePath:String(target.storagePath),
      cleanupPurgeRetryable:true,cleanupPurgeStatus:"cleanup-pending"};
    purgeMeta.cleanupPurgeTarget=Object.freeze({...purgeMeta.cleanupPurgeTarget});
    const warning=Array.from(warnings).join(" ");
    if(warning) purgeMeta.cleanupPurgeWarning=warning;
    purgeMeta=cloudPendingMeta(purgeMeta,Array.from(paths),true);
    mutations.push({row:sourceRow,fields:{storage_path:null,meta:purgeMeta,
      refs:sourceRewrite.refs,history:sourceRewrite.history},source:true});
  }else{
    /* A prior pass may have committed reference evidence but been cancelled
       before the source CAS.  Union newly recovered paths into the tombstone
       before cleanup; never let a retry narrow the ledger. */
    const existingPending=(sourceRow.meta&&sourceRow.meta.cleanupPending)||[];
    const union=Array.from(new Set([...existingPending,...paths]));
    const warning=Array.from(warnings).join(" ");
    const sourceMeta={...(sourceRow.meta||{})};
    const warningChanged=!!warning&&sourceMeta.cleanupPurgeWarning!==warning;
    if(warning) sourceMeta.cleanupPurgeWarning=warning;
    const activeKnown=rows.some(candidate=>{
      if(!candidate||String(candidate.entity_id)===id
          ||candidate.meta&&candidate.meta.kind==="video") return false;
      return (candidate.refs||[]).some(ref=>_purgeRefMatches(ref,target,candidate))
        ||(candidate.history||[]).some(item=>
          (item&&item.refs||[]).some(ref=>_purgeRefMatches(ref,target,item)));
    });
    if(activeKnown){
      sourceMeta.cleanupPurgeRetryable=true;
      sourceMeta.cleanupPurgeStatus="cleanup-pending";
    }
    const changed=union.length!==existingPending.length
      || union.some(path=>!existingPending.includes(path))
      || sourceRewrite.changed
      || warningChanged;
    if(changed){
      sourceMeta.cleanupPurge=true;
      sourceMeta.cleanupTombstone=true;
      sourceMeta.cleanupPurgeTarget=sourceMeta.cleanupPurgeTarget
        || {id,storagePath:String(target.storagePath),iso:String(target.iso||""),
          version:target.version==null?null:target.version};
      mutations.push({row:sourceRow,fields:{storage_path:null,
        meta:cloudPendingMeta(sourceMeta,union,true),
        refs:sourceRewrite.refs,history:sourceRewrite.history},source:true});
    }
  }
  /* Exact CAS every reference row.  A conflict stops before Storage cleanup;
     already-written evidence remains durable and the same target can retry. */
  try{
    for(const mutation of mutations){
      if(guard()) return {ok:false,error:"purge cancelled"};
      if(_purgeRunBusy(mutation.row.entity_id))
        return {ok:false,error:"a referenced image generation is still in progress"};
      const written=await cloudCasGen(projectId,uid||mutation.row.owner,
        mutation.row.entity_id,mutation.row,mutation.fields);
      if(guard()) return {ok:false,error:"purge cancelled"};
      if(!written||written._cloudMutationError)
        return {ok:false,error:(written&&written._cloudMutationError)||"reference changed; purge refused"};
    }
  }catch(e){ return {ok:false,error:(e&&e.message)||"purge write failed"}; }
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(busy()) return {ok:false,error:"image generation is still in progress"};

  /* A tombstone is not considered complete until every exact path has gone.
     cloudFinishPending retains it on partial failure and records the exact
     remainder, making this same target safe to retry. */
  let verifiedRows;
  try{ verifiedRows=await _purgeProjectGenerationRows(sb,projectId); }
  catch(e){ return {ok:false,error:"reference scope changed; cleanup refused"}; }
  if(guard()) return {ok:false,error:"purge cancelled"};
  const reattached=verifiedRows.some(candidate=>{
    if(!candidate||String(candidate.entity_id)===id) return false;
    if(String(candidate.storage_path||"")===String(target.storagePath)) return true;
    if((candidate.history||[]).some(item=>item&&String(item.storage_path||"")===String(target.storagePath)))
      return true;
    return (candidate.refs||[]).some(ref=>_purgeRefMatches(ref,target,candidate))
      || (candidate.history||[]).some(item=>(item&&item.refs||[]).some(ref=>_purgeRefMatches(ref,target,item)));
  });
  if(reattached) return {ok:false,error:"reference scope changed; cleanup refused"};
  const latest=await cloudGetGenStrict(projectId,id);
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(!latest||latest.storage_path||!_purgeTargetMarker(latest,target))
    return {ok:false,error:"purge tombstone changed; retry refused"};
  const finished=await cloudFinishPending(projectId,uid||latest.owner,id,latest,
    {perPath:true,retainTombstone:true,cancelled:guard});
  if(guard()) return {ok:false,error:"purge cancelled"};
  if(warnings.size&&!finished.warning&&finished.row){
    /* Ambiguous immutable references are disclosure-only once every actionable
       path is gone.  Persist that distinction so the UI does not offer an
       endless retry button for a copy we intentionally could not identify. */
    const retainedMeta={...(finished.row.meta||{}),
      cleanupPurgeRetryable:false,cleanupPurgeStatus:"retained-unverified"};
    const marked=await cloudCasGen(projectId,uid||finished.row.owner,id,finished.row,{
      storage_path:finished.row.storage_path,meta:retainedMeta,
      refs:finished.row.refs||[],history:finished.row.history||[]});
    if(marked&&!marked._cloudMutationError) finished.row=marked;
  }
  cloudInvalidateExactPaths(Array.from(paths));
  const purgeWarning=Array.from(warnings).join(" ");
  const cleanupWarning=[purgeWarning,finished.warning].filter(Boolean).join(" ");
  const retryable=!!finished.warning;
  const result={ok:true,referencesRemoved,url:"",meta:null,
    retryable,status:retryable?"cleanup-pending":(purgeWarning?"retained-unverified":"complete"),
    ...(cleanupWarning?{cleanupWarning}:{})};
  return result;
}
function cloudInvalidateExactPaths(paths){
  for(const path of Array.from(new Set((paths||[]).filter(Boolean)))) _signCache.delete(path);
}
const _purgeSweepAt=new Map();
async function cloudSweepPurgeReferences(projectId){
  if(!projectId) return {ok:false,error:"image scope is required"};
  const now=Date.now(), last=_purgeSweepAt.get(String(projectId))||0;
  /* Authorized loads may be frequent while a film is open.  One bounded sweep
     per window catches legacy writers without turning every thumbnail refresh
     into a read/write retry loop. */
  if(now-last<15000) return {ok:true,skipped:true};
  _purgeSweepAt.set(String(projectId),now);
  const sb=sbClient();
  if(!sb) return {ok:false,error:"cloud unavailable"};
  let rows;
  const sweepLimit=1000;
  try{ rows=await _purgeProjectGenerationRows(sb,projectId,sweepLimit); }
  catch(e){ return {ok:false,error:(e&&e.message)||"purge receipt read failed"}; }
  const receipts=_purgeReceiptTargets(rows);
  if(!receipts.length) return {ok:true,rewritten:0};
  const knownByReceipt=new Map(),receiptKey=target=>
    [target.id,target.storagePath,target.iso,target.version==null?"":String(target.version)].join("\x1f");
  const savedRows=new Map();
  let rewrittenCount=0;
  for(const candidate of rows){
    if(!candidate||candidate.meta&&candidate.meta.kind==="video") continue;
    if(rewrittenCount>=64) break;
    const paths=new Set(),rewritten=_purgeRewriteReceiptRow(candidate,receipts,paths);
    if(!rewritten.changed) continue;
    for(const ref of (candidate.refs||[])){
      const target=_purgeReceiptMatch(ref,receipts,candidate);
      if(target&&ref&&ref.storage_path){
        const key=receiptKey(target);
        if(!knownByReceipt.has(key)) knownByReceipt.set(key,{target,paths:new Set()});
        knownByReceipt.get(key).paths.add(String(ref.storage_path));
      }
    }
    for(const item of candidate.history||[]) for(const ref of item&&item.refs||[]){
      const target=_purgeReceiptMatch(ref,receipts,item);
      if(target&&ref&&ref.storage_path){
        const key=receiptKey(target);
        if(!knownByReceipt.has(key)) knownByReceipt.set(key,{target,paths:new Set()});
        knownByReceipt.get(key).paths.add(String(ref.storage_path));
      }
    }
    for(const item of candidate.history||[]){
      const target=(receipts||[]).find(receipt=>item
        &&String(item.storage_path||"")===String(receipt.storagePath||""));
      if(target){
        const key=receiptKey(target);
        if(!knownByReceipt.has(key)) knownByReceipt.set(key,{target,paths:new Set()});
        knownByReceipt.get(key).paths.add(String(item.storage_path));
      }
    }
    const meta=cloudPendingMeta(candidate.meta||{},
      [...((candidate.meta&&candidate.meta.cleanupPending)||[]),...paths],
      !!(candidate.meta&&candidate.meta.cleanupTombstone));
    const saved=await cloudCasGen(projectId,candidate.owner,candidate.entity_id,candidate,{
      storage_path:candidate.storage_path||null,meta,refs:rewritten.refs,history:rewritten.history});
    if(!saved||saved._cloudMutationError) continue; // next authorized refresh can retry
    savedRows.set(String(candidate.entity_id),saved);
    rewrittenCount++;
    const finished=await cloudFinishPending(projectId,candidate.owner,candidate.entity_id,saved,
      candidate.meta&&candidate.meta.cleanupTombstone?{retainTombstone:true}:{});
    if(finished.warning){
      /* The exact path remains in this row's cleanupPending ledger.  Do not
         claim the sweep made a complete removal. */
      continue;
    }
  }
  /* Keep the source tombstone's ledger authoritative too.  This makes a
     late-known copy retryable even if the derived row's own cleanup CAS was
     interrupted. */
  for(const item of knownByReceipt.values()){
    const owner=savedRows.get(String(item.target.id))
      ||rows.find(row=>String(row&&row.entity_id)===String(item.target.id));
    if(!owner||!owner.meta) continue;
    const ownerMarker=owner.meta.cleanupPurgeTarget
      ||(owner.meta.cleanupPurgeReceipts||[]).find(marker=>
        _purgeTargetSame(marker,item.target));
    if(!ownerMarker) continue;
    const pending=Array.from(new Set([...(owner.meta.cleanupPending||[]),...item.paths]));
    const meta={...(owner.meta||{}),cleanupPurgeRetryable:true,
      cleanupPurgeStatus:"cleanup-pending"};
    const saved=await cloudCasGen(projectId,owner.owner,owner.entity_id,owner,{
      storage_path:owner.storage_path||null,
      meta:cloudPendingMeta(meta,pending,!!owner.meta.cleanupTombstone),
      refs:owner.refs||[],history:owner.history||[]});
    if(saved&&!saved._cloudMutationError){
      const ownerFinished=await cloudFinishPending(projectId,owner.owner,owner.entity_id,saved,
        owner.meta.cleanupTombstone?{retainTombstone:true}:{});
      const done=ownerFinished&&ownerFinished.row;
      if(done&&done.meta&&done.meta.cleanupPurgeWarning
          &&!(done.meta.cleanupPending&&done.meta.cleanupPending.length)){
        await cloudCasGen(projectId,done.owner||owner.owner,done.entity_id,done,{
          storage_path:done.storage_path||null,
          meta:{...(done.meta||{}),cleanupPurgeRetryable:false,
            cleanupPurgeStatus:"retained-unverified"},
          refs:done.refs||[],history:done.history||[]});
      }
    }
  }
  return {ok:true,rewritten:rewrittenCount,truncated:rows.length>=sweepLimit};
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
  try{ await cloudSweepPurgeReferences(projectId); }catch(e){}
  const row = await cloudGetGen(projectId, entityId);
  if(!row) return { id:entityId, url:"", meta:null, refs:[], history:[] };
  const url = row.storage_path ? await cloudSignedUrl(row.storage_path) : "";
  const rawHistory=row.history||[];
  const history=[];
  for(const h of rawHistory) history.push({url:h.storage_path?await cloudSignedUrl(h.storage_path):"",meta:h.meta||{},refs:[]});
  const missingIds=[];
  const allRefSets=[row.refs||[],...rawHistory.map(h=>h.refs||[])];
  for(const set of allRefSets){ for(const r of set){
       if(r&&r.deleted) continue;
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
      if(r&&r.deleted){
        /* Deleted-reference evidence is intentionally returned as evidence only.
           Never sign its old path and never use current/previous fallbacks to
           resurrect the pixels that the purge removed. */
        out.push({kind:r.kind,label:r.label,refId:r.refId,url:"",recovered:"",
          deleted:true,deletedStoragePath:r.deletedStoragePath||"",
          refVersion:r.refVersion||null,refGenerated:r.refGenerated||"",
          resolvedVersion:null,resolvedGenerated:""});
        continue;
      }
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
window.cloudPrepareImageDeletion = cloudPrepareImageDeletion;
window.cloudLoadPendingImageDeletion = cloudLoadPendingImageDeletion;
window.cloudPurgeImageVersion = cloudPurgeImageVersion;
window.cloudInvalidateExactPaths = cloudInvalidateExactPaths;
window.cloudSweepPurgeReferences = cloudSweepPurgeReferences;
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
  // one cameo = one prefix: resolved once, then the folders the first angle really used
  let cameoFolders = await turnStorageFolders(sb, uid, projectId);
  for(const a of (rec.angles||[])){
    const p = await cloudUploadImage(projectId, uid, charId, a.url, "cameo", turnReadableSeg(a.label, "angle"),
      undefined, undefined, undefined, undefined, cameoFolders);
    if(p){
      angleRows.push({ label:a.label, storage_path:p });
      cameoFolders = _turnFoldersOfPath(p, uid, projectId) || cameoFolders;
    }
  }
  const prov = { consent:!!rec.consent, source:rec.source||"webcam", subject:rec.subject||"",
    iso:rec.iso, date:rec.date, w:rec.w||0, h:rec.h||0 };
  try{
    const {error}=await sb.from("turn_cameos").upsert({ project_id:projectId, owner:uid, char_id:charId,
      angles:angleRows, prov:prov }, { onConflict:"project_id,char_id" });
    if(error) throw error;
    await _seriesFinishAssetUploadIntents(angleRows.map(angle=>angle.storage_path));
    return true;
  }catch(e){
    /* If the owner deleted the project between upload and row commit, the
       per-path intents still authorize this collaborator to remove only their
       just-uploaded uncommitted angles. */
    try{ await cloudRemovePaths(angleRows.map(angle=>angle.storage_path)); }catch(cleanupError){}
    return null;
  }
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

/* ---- THE LIVE CREDIT UNIT (billing fixes, 2026-09-30) ---------------------------
   turn_credit_regime() (supabase/billing-v2.sql; public facts, callable signed out) says
   whether supabase/billing-switch.sql has run: before it 1 credit = $0.03 of provider cost and
   no free trial, after it $0.01 and a 50-credit trial. app/pricing.jsx turnApplyCreditRegime
   moves every cost chip, plan card and trial line to match. A database without the function
   (billing-v2.sql not run yet) is the old world: $0.03, no trial. A network failure changes
   nothing (the last value read, or the switched default, stays). Returns the regime or null. */
async function cloudLoadCreditRegime(){
  const sb = sbClient(); if(!sb || typeof sb.rpc!=="function") return null;
  const apply = (r)=> (typeof window.turnApplyCreditRegime==="function") ? (window.turnApplyCreditRegime(r, "server"), r) : r;
  try{
    const { data, error } = await sb.rpc("turn_credit_regime");
    if(error){
      const code = String(error.code||""), msg = String(error.message||"");
      if(code==="PGRST202" || code==="42883" || /could not find the function|does not exist/i.test(msg))
        return apply({ switched:false, usd_per_credit:0.03, trial_credits:0, legacy_until:null });
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row && typeof row.switched==="boolean" ? apply(row) : null;
  }catch(e){ return null; }
}
window.cloudLoadCreditRegime = cloudLoadCreditRegime;

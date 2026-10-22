/* auth-ui.jsx — sign-in / sign-up modal + the top-bar account chip.
   Rendered by app.jsx. Local-first: signing in is optional; it switches the app
   from browser-local storage to the Supabase cloud. */

/* `light` — the paper variant used over the landing page (the website palette + the Kinolot
   amber); without it the modal follows the app's theme. Both show the Kinolot lockup with the
   company endorsement, "by Infinite Studio AI". */
function AuthModal({ onClose, onAuthed, initialMode, plan, light, onPlanChange }){
  const [mode, setMode] = React.useState(initialMode==="signup"?"signup":"signin");   // signin | signup
  // the tier carried from the landing pricing (writer/director/studio) — shown as a
  // chip so the visitor sees their choice followed them into signup
  const planObj = (window.CINEMA_PLANS||[]).find(p=>String(p.tier).toLowerCase()===String(plan||"").toLowerCase());
  const planLabel = (p)=> ((typeof window.turnPlanDisplayName==="function") ? window.turnPlanDisplayName(p.tier) : p.name)+" plan · "+p.price+"/mo";
  const planName = planObj ? planLabel(planObj) : null;
  // CHANGE THE PLAN IN PLACE (owner request 2026-10-02): the plan name is a dropdown of the three
  // plans — the pick replaces the one saved in this browser (app.jsx onPlanChange), which the
  // sign-up and the checkout that follows both read. Without onPlanChange it stays plain text.
  const pickable = typeof onPlanChange==="function" ? (window.CINEMA_PLANS||[]).filter(p=>p && p.tier) : [];
  /* "Create account" always offers the choice (owner 2026-10-03: from "Sign in → Create one" there was
     no plan picker) — "No plan yet" (with the trial's credits while it's offered, the homepage's own
     rule: landing.jsx lpTrialLine) or a plan; only a plan brings the checkout and its ⓘ */
  const freeLabel = (()=>{ const t = (typeof window.lpTrialLine==="function") ? String(window.lpTrialLine()||"") : "";
    const m = t.match(/(\d[\d,]*) free credits/); return m ? "No plan yet \u00b7 "+m[1]+" free credits" : "No plan yet"; })();
  const choosing = mode==="signup" && pickable.length>1;
  // Remember me also remembers the EMAIL (owner 2026-10-03: "logged in, logged out — it didn't
  // remember me"): signing out ends the session by design, so the address is what shows it
  const [email, setEmail] = React.useState(()=>{ try{ return localStorage.getItem("turn-remember-email")||""; }catch(e){ return ""; } });
  const [pw, setPw] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [remember, setRemember] = React.useState(true);   // Remember me (sign in), on by default
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [notice, setNotice] = React.useState("");
  /* the chosen plan and its 14-day note: always when creating the account; in "Sign in" too while the
     plan picked before sign-up is still waiting in this browser (plans.jsx intendedPlanWaiting) — after
     "Check your email to confirm, then sign in" or a switch to "Sign in" its checkout still opens by
     itself, so the note must be on screen there as well (review 2026-10-02) */
  const showPlan = (!!planName && (mode==="signup"
    || (typeof window.turnIntendedPlanWaiting==="function" && window.turnIntendedPlanWaiting()))) || choosing;

  const forgot = async ()=>{
    const e = email.trim();
    if(!e){ setErr("Enter your email above, then tap “Forgot password”."); return; }
    if(typeof window.cloudResetPassword!=="function"){ setErr("Password reset isn’t available."); return; }
    setErr(""); setNotice(""); setBusy(true);
    try{
      const { error } = await window.cloudResetPassword(e);
      if(error){ setErr(error.message || "Couldn’t send the reset link."); }
      else setNotice("Reset link sent. Check your email.");
    }catch(ex){ setErr((ex && ex.message) || "Network error."); }
    setBusy(false);
  };

  const submit = async ()=>{
    if(busy) return;
    const e = email.trim();
    if(!e || !pw){ setErr("Enter your email and a password."); return; }
    if(mode==="signup" && pw.length<6){ setErr("Password must be at least 6 characters."); return; }
    setErr(""); setNotice(""); setBusy(true);
    try{
      const fn = mode==="signup" ? window.cloudSignUp : window.cloudSignIn;
      const { data, error } = await fn(e, pw);
      if(error){ setErr(error.message || "Something went wrong."); setBusy(false); return; }
      /* sign-up may require email confirmation (no active session yet) */
      if(mode==="signup" && (!data || !data.session)){
        setNotice("Account created. Check your email to confirm, then sign in.");
        setMode("signin"); setBusy(false); return;
      }
      setBusy(false);
      if(mode==="signin" && typeof window.cloudSetRememberMe==="function") window.cloudSetRememberMe(remember);
      if(mode==="signin"){ try{ if(remember) localStorage.setItem("turn-remember-email", e); else localStorage.removeItem("turn-remember-email"); }catch(_e){} }
      onAuthed && onAuthed(data && data.session);
      onClose && onClose();
    }catch(ex){ setErr((ex && ex.message) || "Network error."); setBusy(false); }
  };

  return React.createElement("div",{className:"auth-overlay"+(light?" auth-light":""),onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose && onClose(); }},
    React.createElement("div",{className:"auth-panel"+(light?" light":"")},
      React.createElement("div",{className:"auth-head"},
        // the lockup only: the "by Infinite Studio AI" endorsement goes where the company is already
        // shown (the footers) — adding it here was new copy the owner hasn't approved (review 2026-09-29)
        React.createElement("div",{className:"auth-brand"},
          React.createElement("div",{className:"auth-mark"},(typeof BrandMark==="function") && React.createElement(BrandMark,null),"Kinolot")),
        light && React.createElement("div",{className:"auth-act"}, mode==="signup"?"Prologue":"Welcome back"),
        React.createElement("div",{className:"auth-title"}, mode==="signup"?"Create your account":"Sign in"),
        // the plan's checkout opens by itself after sign-up, so its 14-day note goes with the chip —
        // behind the same ⓘ as every plan's name (owner request 2026-10-02: "turn it into a tooltip";
        // E1/R2, plans.jsx checkoutTip)
        // (owner 2026-10-02, second pass: the ⓘ takes the sparkle's place, at the start of the chip)
        showPlan && React.createElement("div",{className:"auth-plan-row checkout-tip-row"},
          React.createElement("div",{className:"auth-plan"+(planObj ? "" : " no-plan")},
            planObj && (typeof window.turnCheckoutTip==="function") && window.turnCheckoutTip("auth-checkout-note", "auth-checkout-tip"),
            // the "·" is its own span so a phone can drop it when the note takes its own line (no orphaned dot)
            pickable.length>1
              // the chosen plan as text, with the native dropdown laid invisibly over it — so the chip is
              // as wide as the plan it shows, not as its longest option
              ? React.createElement("span",{className:"auth-plan-pick"},
                  React.createElement("span",{className:"auth-plan-cur","aria-hidden":"true"}, planName || freeLabel),
                  React.createElement(Icon.chevD,{s:11}),
                  React.createElement("select",{className:"auth-plan-sel",value:planObj ? planObj.tier : "free",disabled:busy,
                    "aria-label":"Plan \u2014 change it here", title:"Choose a plan now, or start without one",
                    onChange:(e)=>onPlanChange(e.target.value)},
                    mode==="signup" && React.createElement("option",{key:"free",value:"free"},freeLabel),
                    pickable.map(p=>React.createElement("option",{key:p.tier,value:p.tier},planLabel(p)))))
              : planName,
            React.createElement("span",{className:"auth-plan-sep","aria-hidden":"true"},"·"),
            React.createElement("span",{className:"auth-plan-note"}, !planObj ? "choose a plan any time"
              : mode==="signup" ? "checkout opens after signup" : "checkout opens after sign-in")))),
      React.createElement("div",{className:"auth-body"},
        notice && React.createElement("div",{className:"auth-notice"}, notice),
        React.createElement("label",{className:"auth-field"},
          React.createElement("span",{className:"auth-lab"},"Email"),
          React.createElement("input",{className:"auth-input",type:"email",autoComplete:"email",value:email,
            placeholder:"you@studio.com",onChange:e=>setEmail(e.target.value),
            onKeyDown:e=>{ if(e.key==="Enter") submit(); }})),
        React.createElement("label",{className:"auth-field"},
          React.createElement("div",{className:"auth-lab-row"},
            React.createElement("span",{className:"auth-lab"},"Password"),
            mode==="signin" && React.createElement("button",{type:"button",className:"auth-forgot",onClick:forgot},"Forgot password?")),
          React.createElement("div",{className:"auth-pw"},
            React.createElement("input",{className:"auth-input",type:showPw?"text":"password",
              autoComplete:mode==="signup"?"new-password":"current-password",value:pw,
              placeholder:mode==="signup"?"At least 6 characters":"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
              onChange:e=>setPw(e.target.value),onKeyDown:e=>{ if(e.key==="Enter") submit(); }}),
            React.createElement("button",{type:"button",className:"auth-pw-toggle",
              "aria-label":showPw?"Hide password":"Show password",title:showPw?"Hide password":"Show password",
              onClick:()=>setShowPw(s=>!s)}, React.createElement(showPw?Icon.eyeOff:Icon.eye,{s:16})))),
        mode==="signin" && React.createElement("label",{className:"auth-remember"},
          React.createElement("input",{type:"checkbox",checked:remember,onChange:e=>setRemember(e.target.checked)}),
          React.createElement("span",null,"Remember me"),
          React.createElement("span",{className:"auth-remember-note"},remember ? "" : "\u00b7 you'll be signed out when you close the browser")),
        err && React.createElement("div",{className:"auth-err"}, err),
        React.createElement("button",{className:"auth-submit",disabled:busy,onClick:submit,"aria-describedby":(showPlan && planObj) ? "auth-checkout-note" : undefined},
          busy ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin dark"}),
              mode==="signup"?"Creating\u2026":"Signing in\u2026")
            : (mode==="signup"?"Create account":"Sign in")),
        React.createElement("div",{className:"auth-switch"},
          mode==="signup" ? "Already have an account? " : "New here? ",
          React.createElement("button",{className:"auth-link",onClick:()=>{ setErr(""); setNotice(""); setMode(mode==="signup"?"signin":"signup"); }},
            mode==="signup" ? "Sign in" : "Create one"))),
      React.createElement("button",{type:"button",className:"auth-close","aria-label":"Close",title:"Close",onClick:onClose},
        React.createElement(Icon.x,{s:16}))));
}
window.AuthModal = AuthModal;

/* MANAGE PLAN (owner request 2026-09-30) — asks the billing-portal Edge Function for a
   portal session for the signed-in user (the function reads the user from the JWT and the
   customer from the database; nothing identifying is sent in the body) and returns its url.
   The page there updates the card, lists invoices and cancels at the end of the period;
   switching plans stays on "Change plan". Resolves { ok:true, url } or { ok:false, code }. */
const BILLING_PORTAL_FN = "billing-portal";
const BILLING_PORTAL_TIMEOUT_MS = 20000;
// after handing the page to the portal url: if the page is still here this long after (the
// "Leave site?" prompt was answered Stay, or Back restored it from the back/forward cache,
// where timers pause and fire on return), the button works again
const BILLING_PORTAL_RESET_MS = 4000;
const BILLING_PORTAL_COPY = {
  // the button only shows on a paid plan, so this reads as "nothing billed to manage here"
  // (e.g. a plan granted by the team), not "choose a plan" — the menu already names the plan
  no_subscription: "There's no subscription on this account to manage here. For billing questions, write to kinolot-billing@infinitestudioai.com.",
  not_signed_in: "Sign in again to manage your plan.",
  unavailable: "Plan management isn't available right now. Try again in a moment.",
  failed: "Couldn't open plan management. Try again in a moment, or write to kinolot-billing@infinitestudioai.com.",
};
async function requestBillingPortal(){
  const sb = (typeof window.sbClient === "function") ? window.sbClient() : null;
  if(!sb || !sb.functions || typeof sb.functions.invoke !== "function") return { ok:false, code:"unavailable" };
  let timer = null;
  const timeout = new Promise((resolve)=>{ timer = setTimeout(()=> resolve({ __timeout:true }), BILLING_PORTAL_TIMEOUT_MS); });
  try{
    const r = await Promise.race([sb.functions.invoke(BILLING_PORTAL_FN, { body:{} }), timeout]);
    if(r && r.__timeout) return { ok:false, code:"failed" };
    const data = r && r.data, error = r && r.error;
    if(error){
      const name = String(error.name || "");
      if(name === "FunctionsFetchError" || name === "FunctionsRelayError") return { ok:false, code:"unavailable" };
      const ctx = error.context;
      const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
      let body = null;
      try{ if(ctx && typeof ctx.json === "function") body = await ctx.json(); }catch(e){}
      const code = body && typeof body.code === "string" ? body.code : "";
      if(code === "no_subscription" || code === "not_signed_in") return { ok:false, code:code };
      if(status === 401) return { ok:false, code:"not_signed_in" };
      if(status === 404 || code === "not_configured") return { ok:false, code:"unavailable" };
      return { ok:false, code:"failed" };
    }
    const url = data && typeof data.url === "string" ? data.url : "";
    if(!/^https:\/\//.test(url)) return { ok:false, code:"failed" };
    return { ok:true, url:url };
  }catch(e){
    return { ok:false, code:"failed" };
  }finally{
    if(timer) clearTimeout(timer);
  }
}

/* The same request for surfaces outside the account menu (billing fixes, 2026-09-30): the
   "Payment failed" / "Account on hold" banners and the Plans window's Manage plan button
   (app/plans.jsx turnOpenManagePlan) open the billing portal through this. It goes to the
   portal, or shows the menu's calm note as a toast. Resolves true when the page is leaving. */
window.turnOpenBillingPortal = async function(){
  const r = await requestBillingPortal();
  if(r.ok){ try{ window.location.assign(r.url); return true; }catch(e){} }
  const msg = BILLING_PORTAL_COPY[r.code] || BILLING_PORTAL_COPY.failed;
  if(typeof window.appToast==="function") window.appToast(msg, "info");
  return false;
};

function AccountChip({ session, cloudActive, connectionState, saveState, shareRole, roleUnavailable, onSignIn, onSignOut }){
  const [open, setOpen] = React.useState(false);
  // Manage plan: busy while the portal session is requested; msg is the calm inline note
  const [portal, setPortal] = React.useState({ busy:false, msg:"" });
  const portalResetRef = React.useRef(null);
  React.useEffect(()=>{
    // Back from the portal restores this page from the back/forward cache with its state:
    // make the button usable again right away (the reset timer also covers it)
    const onShow = (e)=>{ if(e && e.persisted) setPortal({ busy:false, msg:"" }); };
    if(typeof window.addEventListener==="function") window.addEventListener("pageshow", onShow);
    return ()=>{
      if(typeof window.removeEventListener==="function") window.removeEventListener("pageshow", onShow);
      if(portalResetRef.current){ clearTimeout(portalResetRef.current); portalResetRef.current = null; }
    };
  },[]);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if(!open) return;
    const h = e=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[open]);

  if(!window.cloudConfigured || !window.cloudConfigured()) return null;

  if(!session){
    return React.createElement("button",{className:"acct-signin",onClick:onSignIn},
      React.createElement(Icon.user,{s:13}),"Sign in");
  }
  const email = (window.cloudUserEmail && window.cloudUserEmail(session)) || "Account";
  const initial = (email[0]||"?").toUpperCase();
  // the "writer" ROLE is shown as "Co-writer" (the Writer PLAN keeps its name) — display only
  // one role or several ("Co-writer + Art director", 2026-10-03); team.jsx names them
  const scopedRole = (!shareRole || shareRole==="owner") ? ""
    : shareRole==="view_only" ? "View-only"
    : (typeof window.teamRoleKnown==="function" && window.teamRoleKnown(shareRole) && typeof window.teamRoleLabel==="function")
      ? window.teamRoleLabel(shareRole) : "";
  const roleParts = String(shareRole||"").split("+").filter(Boolean);
  const chipRole = roleParts.length>1 ? roleParts.length+" roles"
    : ({ writer:"Co-writer", art_director:"Art director", stage_editor:"Stage editor" })[shareRole] || scopedRole;   // whole words (2026-10-09)
  const roleTitle = roleUnavailable ? " Project role unavailable; this shared project is read-only."
    : (scopedRole ? " Role: "+scopedRole+"." : "");
  const managePlan = async ()=>{
    if(portal.busy) return;
    setPortal({ busy:true, msg:"" });
    const r = await requestBillingPortal();
    if(r.ok){
      // the portal's return link brings the subscriber back to this app; stay busy while the
      // page leaves — and if it doesn't leave after all, the button comes back on its own
      try{ window.location.assign(r.url); }catch(e){ setPortal({ busy:false, msg:BILLING_PORTAL_COPY.failed }); return; }
      if(portalResetRef.current) clearTimeout(portalResetRef.current);
      portalResetRef.current = setTimeout(()=>{ portalResetRef.current = null; setPortal({ busy:false, msg:"" }); }, BILLING_PORTAL_RESET_MS);
      return;
    }
    setPortal({ busy:false, msg:BILLING_PORTAL_COPY[r.code] || BILLING_PORTAL_COPY.failed });
  };
  return React.createElement("div",{className:"acct-wrap",ref:ref},
    React.createElement("button",{className:"acct-chip"+(open?" open":""),onClick:()=>{ setOpen(o=>!o); if(!portal.busy && portal.msg) setPortal({ busy:false, msg:"" }); },title:email},
      React.createElement("span",{className:"acct-av"}, initial),
      cloudActive
        // the chip reports the REAL save state — it used to read "Synced" purely because
        // cloud mode was on, so a failing save still looked healthy. Save health
        // takes precedence over a collaborator role; the role remains secondary
        // in the tooltip and expanded account menu.
        ? (saveState==="failed"
            ? React.createElement("span",{className:"acct-cloud bad",title:"Your latest changes could not be saved. Check your connection — the app keeps trying, and your work stays on screen meanwhile."+roleTitle},
                React.createElement(Icon.warn,{s:11}),"Not saved")
            : saveState==="retrying"
            ? React.createElement("span",{className:"acct-cloud warn",title:"A save didn't go through — retrying."+roleTitle},
                React.createElement(Icon.warn,{s:11}),"Retrying")
            : saveState==="saving"
            ? React.createElement("span",{className:"acct-cloud",title:"Saving your latest changes."+roleTitle},React.createElement(Icon.cloud||Icon.check,{s:11}),"Saving\u2026")
            : roleUnavailable
            ? React.createElement("span",{className:"acct-cloud bad",title:"Your role on this shared project couldn't be verified, so it is read-only: changes and AI actions will not save. Only the film's owner can change your role."},
                React.createElement(Icon.warn,{s:11}),"Role unavailable")
            : shareRole==="view_only"
            ? React.createElement("span",{className:"acct-cloud warn",title:"You have VIEW-ONLY access to this film. You can read and explore it, but changes you make here are not saved. Only the film's owner can change your role."},
                React.createElement(Icon.eye||Icon.warn,{s:11}),"View-only")
            : scopedRole
            ? React.createElement("span",{className:"acct-cloud",
                title:(window.teamRoleScopeNote ? window.teamRoleScopeNote(shareRole) : "")+" Changes inside your remit save normally."},
                React.createElement(Icon.check,{s:11}),
                chipRole)
            // healthy state is quiet — "Synced" is reassurance, not news, so it only
            // slides out on hover (desktop) or tap/open (mobile); problem states stay visible
            : React.createElement("span",{className:"acct-cloud quiet"},React.createElement(Icon.check,{s:11}),"Synced"))
        : connectionState==="retrying"
        ? React.createElement("span",{className:"acct-cloud warn",title:"The cloud connection paused. It is retrying automatically, and your open work stays on screen."},React.createElement(Icon.warn,{s:11}),"Reconnecting")
        : React.createElement("span",{className:"acct-cloud warn"},React.createElement(Icon.warn,{s:11}),"Connecting")),
    /* THE ACCOUNT MENU, quiet list (owner 2026-10-22, option A): who you are and the save state in one header,
       the credits as a bar, plain rows for the plan, the admin's tools (Render styles and API keys moved here
       from the Film menu) and Sign out — hairlines between the groups, nothing filled. A save problem or a
       project role still says itself in full under the header. */
    open && (()=>{
      const bal = window.turnCreditBalance;
      const paid = !!(bal && window.turnIsPaidPlan && window.turnIsPaidPlan(bal.plan));
      const planName = paid ? ((typeof window.turnPlanDisplayName==="function") ? window.turnPlanDisplayName(bal.plan) : bal.plan) : "";
      const healthy = cloudActive && saveState!=="failed" && saveState!=="retrying";
      const stateWord = !cloudActive ? (connectionState==="retrying" ? "Reconnecting" : "Connecting")
        : saveState==="saving" ? "Saving\u2026" : healthy ? "Synced" : "";
      const sub = [planName, stateWord].filter(Boolean).join(" \u00b7 ");
      // the bar: what's left of the plan's monthly allowance (pack credits show as the split under it)
      const left = bal ? (Number(bal.remaining)||0) : 0;
      const allow = (()=>{ const t = String(bal && bal.plan || "").toLowerCase(), A = window.TURN_PLAN_ALLOWANCES;
        if(!paid || !A) return 0; const set = (typeof window.turnCreditUnitSwitched==="function" && !window.turnCreditUnitSwitched()) ? A.legacy : A.switched;
        return Number(set && set[t==="pro" ? "director" : t]) || 0; })();
      const split = bal && (typeof window.turnCreditSplitText==="function") ? window.turnCreditSplitText(bal) : "";
      const pack = bal ? Math.max(0, Number(bal.packRemaining)||0) : 0;
      const planLeft = bal && bal.planRemaining!=null ? Math.max(0, Number(bal.planRemaining)||0) : Math.max(0, left - pack);
      const isAdmin = !!window.turnIsAdmin;
      const fire = (ev)=>{ setOpen(false); try{ window.dispatchEvent(new CustomEvent(ev)); }catch(e){} };
      return React.createElement("div",{className:"acct-menu acct-menu-a"},
        React.createElement("div",{className:"acct-head"},
          React.createElement("span",{className:"acct-head-av","aria-hidden":"true"}, initial),
          React.createElement("div",{className:"acct-head-t"},
            React.createElement("div",{className:"acct-email"}, email),
            sub && React.createElement("div",{className:"acct-sub"}, sub))),
        // problems and roles say themselves in full
        cloudActive && saveState==="failed" && React.createElement("div",{className:"acct-status acct-status-bad"},
          "The last save failed \u2014 your work is still on screen; leave this tab open until it saves."),
        cloudActive && saveState==="retrying" && React.createElement("div",{className:"acct-status"},"Retrying a save that didn't go through\u2026"),
        !cloudActive && connectionState==="retrying" && React.createElement("div",{className:"acct-status"},"The connection paused \u2014 reconnecting automatically. Your open work stays on screen."),
        scopedRole && React.createElement("div",{className:"acct-status",
          title:window.teamRoleScopeNote ? window.teamRoleScopeNote(shareRole) : ""},
          "Project role: "+scopedRole),
        roleUnavailable && React.createElement("div",{className:"acct-status acct-status-bad"},
          "Project role unavailable \u00b7 read-only"),
        // CREDITS — images, video and writing calls are charged from these on the server
        bal && React.createElement("div",{className:"acct-credits",
            title:"Credits \u2014 spent by image and video generation and by writing-model calls (see the Stage footer for per-render costs)"},
          React.createElement("div",{className:"acct-credits-row"},
            React.createElement("span",null,"Credits"),
            // "645 of 1,600" when it's all plan credits; with pack credits the total ("1,234 left") and the split under it
            React.createElement("b",null, allow && !pack && left<=allow
              ? left.toLocaleString("en-US")+" of "+allow.toLocaleString("en-US")
              : left.toLocaleString("en-US")+" left")),
          // the bar is the plan's month: what's left of its allowance (pack credits aren't in it)
          allow ? React.createElement("div",{className:"acct-credits-bar",role:"img","aria-label":planLeft+" of "+allow+" plan credits left this month"},
            React.createElement("i",{style:{width:Math.max(0,Math.min(100,Math.round(planLeft/allow*100)))+"%"}})) : null,
          split && React.createElement("div",{className:"acct-credits-split"}, split)),
        React.createElement("div",{className:"acct-sep"}),
        window.turnOpenPlans && React.createElement("button",{className:"acct-upgrade acct-row",
            onClick:()=>{ setOpen(false); window.turnOpenPlans(); }},
          React.createElement(Icon.sparkles,{s:14}),
          paid ? "Change plan" : "Get credits \u00b7 Choose a plan"),
        // Manage plan (2026-09-30): paid plans only — card, invoices, cancel at the end of the period
        (paid && typeof window.sbClient==="function") &&
          React.createElement("button",{className:"acct-upgrade acct-manage acct-row",disabled:portal.busy,"aria-busy":portal.busy?"true":"false",
              title:"Update your card, see invoices, or cancel at the end of the billing period",
              onClick:managePlan},
            portal.busy ? React.createElement("span",{className:"ns-spin"}) : React.createElement(Icon.clipboard,{s:14}),
            portal.busy ? "Opening\u2026" : "Manage plan"),
        portal.msg && React.createElement("div",{className:"acct-status acct-note",role:"status"}, portal.msg),
        // ADMIN — the platform tools, the admin only (each also checks again where it opens)
        isAdmin && React.createElement("div",{className:"acct-sep"}),
        isAdmin && React.createElement("div",{className:"acct-group"},"Admin"),
        isAdmin && React.createElement("button",{className:"acct-upgrade acct-admin acct-row",
            title:"Render styles \u2014 curate the global style list and your locked styles",
            onClick:()=>fire("turn-open-styles")},
          React.createElement(Icon.palette||Icon.sparkles,{s:14}),"Render styles"),
        isAdmin && React.createElement("button",{className:"acct-upgrade acct-admin acct-row",
            title:"API keys \u2014 the platform's provider keys",
            onClick:()=>fire("turn-open-api-keys")},
          React.createElement(Icon.key||Icon.padlock,{s:14}),"API keys"),
        // the Storage page (app/admin-storage.jsx); the admin-storage Edge Function checks the admin again
        isAdmin && typeof window.turnOpenAdminStorage==="function" &&
          React.createElement("button",{className:"acct-upgrade acct-admin acct-row",
              onClick:()=>{ setOpen(false); window.turnOpenAdminStorage(); }},
            React.createElement(Icon.box,{s:14}),"Storage"),
        // Tax & compliance (app/admin-tax.jsx); turn_admin_tax_summary refuses everyone but the admin again
        isAdmin && typeof window.turnOpenAdminTax==="function" &&
          React.createElement("button",{className:"acct-upgrade acct-admin acct-row",
              onClick:()=>{ setOpen(false); window.turnOpenAdminTax(); }},
            React.createElement(Icon.globe||Icon.clipboard,{s:14}),"Tax & compliance"),
        React.createElement("div",{className:"acct-sep"}),
        React.createElement("button",{className:"acct-signout acct-row",onClick:()=>{ setOpen(false); onSignOut && onSignOut(); }},
          "Sign out"));
    })());
}
window.AccountChip = AccountChip;

/* ProjectSwitcher — current film name + dropdown to switch / create / rename /
   delete projects. Only shown when signed in (cloud mode). */
/* short creation date for a switcher row — "Jul 12"; when another film shares
   both the name AND the day, the time is appended ("Jul 14 · 09:41") so twins
   stay distinguishable. */
function _projRowDate(p, all){
  const iso = p.created_at || p.updated_at; if(!iso) return "";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US",{ month:"short", day:"numeric" });
  const sameDayTwin = (all||[]).some(o=> o.id!==p.id && o.title===p.title &&
    new Date(o.created_at||o.updated_at||0).toDateString()===d.toDateString());
  return sameDayTwin ? (day+" \u00b7 "+d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })) : day;
}
/* A BLANK CANVAS is not a film (owner, 2026-09-26): the working row the app keeps open when
   there is no story yet — default title, no scenes, cast, shots, locations or logline, not a
   Show / Episode / shared film. It used to be listed as a film called "Untitled film", which
   read as a real project. Blank rows are never listed; the chip says "No project yet" (owner:
   "project", not "film" — the list holds films AND shows, and formats beyond film). */
function turnFilmIsBlank(p){
  if(!p) return false;
  if(p.showId || p.isShared || String(p.project_kind||"").toLowerCase()==="show" || String(p.project_kind||"").toLowerCase()==="episode"
     || String(p.isShow).toLowerCase()==="true") return false;
  const t = String(p.title||"").trim();
  if(t && t!=="Untitled film") return false;
  return !p.hasScenes && !p.hasChars && !p.hasShots && !p.hasLocs && !String(p.logline||"").trim();
}
window.turnFilmIsBlank = turnFilmIsBlank;
function ProjectSwitcher({ projects, currentId, onSwitch, onCreate, onNewStory, onRename, onDelete, formatLabel, frameworkLabel, onNewEpisode, onMakeShow, canMakeShow, onDeleteShow, seriesBusy }){
  const [open, setOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(null);   // id being renamed
  const [draft, setDraft] = React.useState("");
  const [localBusy, setLocalBusy] = React.useState("");
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if(!open) return;
    const h = e=>{ if(ref.current && !ref.current.contains(e.target)){ setOpen(false); setRenaming(null); } };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[open]);

  const current = (projects||[]).find(p=>p.id===currentId);
  const currentBlank = !!current && turnFilmIsBlank(current);
  const title = current ? (currentBlank ? "No project yet" : current.title) : "Loading\u2026";
  const currentShared = current && current.isShared;
  const currentEpisodeNo = current && Number(current.episodeNo);
  // Phase 3 grouping: SHOW rows hold the shared bible; episodes nest beneath them.
  // The shared helper deliberately returns episodes whose Show is absent/inaccessible;
  // those rows remain reachable below instead of disappearing from the switcher.
  // STABLE ORDER (user ruling 2026-07-14): films sort by CREATION date, newest
  // first — never by last-updated, so the list doesn't reshuffle as you work
  const _byCreated = (a,b)=> new Date(b.created_at||b.updated_at||0) - new Date(a.created_at||a.updated_at||0);
  const grouped = (window.turnSeries && typeof window.turnSeries.groups==="function")
    ? window.turnSeries.groups(projects||[])
    : (()=>{
        const rows=projects||[], isShow=p=>(window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
          ? window.turnSeries.isShowDoc(p)
          : !!(p&&(String(p.project_kind||"").toLowerCase()==="show"||String(p.isShow).toLowerCase()==="true"));
        const fallbackShows=rows.filter(isShow);
        const fallbackShowIds=new Set(fallbackShows.map(p=>String(p.id)));
        return { shows:fallbackShows,
          standalone:rows.filter(p=>!isShow(p) && !p.showId),
          unavailable:rows.filter(p=>!isShow(p) && p.showId && !fallbackShowIds.has(String(p.showId))) };
      })();
  const shows = (grouped.shows||[]).slice().sort(_byCreated);
  const episodesOf = (sid)=> (projects||[]).filter(p=>p.showId && String(p.showId)===String(sid))
    .sort((a,b)=>(Number(a.episodeNo)||0)-(Number(b.episodeNo)||0));
  const standalone = (grouped.standalone||[]).filter(p=>!turnFilmIsBlank(p)).slice().sort(_byCreated);
  const unavailable = (grouped.unavailable||[]).slice().sort((a,b)=>(Number(a.episodeNo)||0)-(Number(b.episodeNo)||0));
  const showById = {};
  shows.forEach(s=>{ showById[String(s.id)] = s; });

  // Parent handlers own persistence; this component owns honest interaction state.
  // `undefined` remains a success for older handlers, while the production handlers can
  // explicitly return false / {ok:false,message} to keep the UI open on a failed write.
  const externalBusy = typeof seriesBusy==="string" ? seriesBusy
    : (seriesBusy && typeof seriesBusy==="object" ? (seriesBusy.key||seriesBusy.id||"") : "");
  const allBusy = seriesBusy===true || !!externalBusy || !!localBusy;
  const busyIs = key=> seriesBusy===true || externalBusy===key || localBusy===key;
  const actionOk = r=> r!==false && r!==null && !(r && typeof r==="object" && r.ok===false);
  const actionMessage = (r, fallback)=> (r && typeof r==="object" && r.message) || fallback;
  const runAction = async (key, fn, failText)=>{
    if(allBusy || typeof fn!=="function") return false;
    setLocalBusy(key);
    try{
      const result = await fn();
      if(actionOk(result)) return true;
      if(typeof window.appToast==="function") window.appToast(actionMessage(result, failText), "error");
      return false;
    }catch(e){
      if(typeof window.appToast==="function") window.appToast((e&&e.message)||failText, "error");
      return false;
    }finally{ setLocalBusy(""); }
  };
  const beginRename = p=>{ if(!allBusy){ setRenaming(p.id); setDraft(p.title||""); } };
  const commitRename = async (p, kind)=>{
    const next = draft.trim();
    if(!next || allBusy) return;
    const done = await runAction("rename:"+p.id, ()=>onRename(p.id,next,{kind}), "Couldn’t rename this "+kind+".");
    if(done) setRenaming(null);
  };
  const renameEditor = (p, kind)=> React.createElement("div",{key:p.id,className:"proj-rename"},
    React.createElement("input",{className:"proj-rename-input",autoFocus:true,value:draft,
      disabled:busyIs("rename:"+p.id),"aria-label":"Rename "+kind,
      onChange:e=>setDraft(e.target.value),
      onKeyDown:e=>{ if(e.key==="Enter"&&draft.trim()){ e.preventDefault(); commitRename(p,kind); }
                     if(e.key==="Escape"&&!allBusy) setRenaming(null); }}),
    React.createElement("button",{className:"proj-rename-ok",disabled:allBusy||!draft.trim(),
      title:"Save "+kind+" name",
      "aria-label":"Save "+kind+" name",
      onClick:()=>commitRename(p,kind)},
      busyIs("rename:"+p.id)?"…":React.createElement(Icon.check,{s:13})));

  const confirmAction = async opts=> !window.appConfirm || await window.appConfirm(opts);
  const requestDeleteShow = async (show, eps)=>{
    if(!show || typeof onDeleteShow!=="function" || allBusy) return false;
    // The app-level handler owns the single destructive confirmation because it has
    // the authoritative cascade details. Keep this menu pending until it resolves.
    const done = await runAction("delete-show:"+show.id,
      ()=>onDeleteShow(show.id,(eps||[]).map(e=>e.id)), "Couldn’t delete this show.");
    if(done){ setRenaming(null); setOpen(false); }
    return done;
  };
  const requestDeleteEpisode = async p=>{
    if(!p || typeof onDelete!=="function" || allBusy) return false;
    const show = p.showId ? showById[String(p.showId)] : null;
    /* Cached sibling counts are presentation only. The exact-Episode RPC decides
       under the Show lock whether this is truly the final Episode; only then may
       the app offer the separate whole-Show confirmation. */
    const epNo = Number(p.episodeNo);
    const ok = await confirmAction({
      title:"Delete \u201c"+(p.title||"this episode")+"\u201d?",
      body:show
        ? "This removes "+(epNo?("Episode "+String(epNo).padStart(2,"0")):"the episode")+". The show’s shared bible and its other episodes stay."
        : (p.showId
          ? "This removes the episode. Its show is unavailable, so no shared bible or other episode will be deleted."
          : "This removes the project and its sheets. If it’s your only project, you’ll be on a blank canvas, ready for a new story."),
      confirmLabel:p.showId?"Delete episode":"Delete project",danger:true
    });
    if(!ok) return false;
    const done = await runAction("delete:"+p.id, ()=>onDelete(p.id), p.showId?"Couldn’t delete this episode.":"Couldn’t delete this project.");
    if(done){ setRenaming(null); setOpen(false); }
    return done;
  };

  const row = (p, opts)=>{
    const canOwn = p.isOwner !== false && !p.isShared;
    const isUnavailable = !!(opts&&opts.unavailable);
    const epNo = Number(p.episodeNo);
    return renaming===p.id
    ? renameEditor(p,p.showId?"episode":"project")
    : React.createElement("div",{key:p.id,className:"proj-row"+(p.id===currentId?" on":"")+(p.showId?" ep":"")},
        React.createElement("button",{className:"proj-row-main",disabled:allBusy,onClick:async ()=>{
          const done=await runAction("switch:"+p.id,()=>onSwitch(p.id),"Couldn’t open this project."); if(done)setOpen(false); }},
          React.createElement("span",{className:"proj-dot"}),
          p.showId && React.createElement("span",{className:"proj-show-tag",title:"Episode "+(epNo||"")},epNo?("E"+String(epNo).padStart(2,"0")):"EP"),
          React.createElement("span",{className:"proj-row-name"},p.title),
          isUnavailable && React.createElement("span",{className:"proj-show-tag",title:"The parent show was deleted or is not available to this account"},"Show unavailable"),
          p.isShared && React.createElement("span",{className:"proj-row-share"},"Shared \u00b7 "+(window.teamRoleLabel ? window.teamRoleLabel(p.shareRole) : (p.shareRole||"Collaborator"))),
          // creation date disambiguates same-named films (e.g. a rebuild alongside
          // its original); same-day twins also get the time
          (p.created_at||p.updated_at) && React.createElement("span",{className:"proj-row-date"},_projRowDate(p, projects))),
        canOwn && onRename && React.createElement("button",{className:"proj-row-act",title:"Rename "+(p.showId?"episode":"project"),
          disabled:allBusy,"aria-label":"Rename "+(p.showId?"episode":"project"),onClick:()=>beginRename(p)},
          React.createElement(Icon.wand,{s:12})),
        canOwn && onDelete && React.createElement("button",{className:"proj-row-act danger",title:p.showId?"Delete episode":"Delete project",
          disabled:allBusy,"aria-label":p.showId?"Delete episode":"Delete project",onClick:()=>requestDeleteEpisode(p)},
          busyIs("delete:"+p.id)?"…":React.createElement(Icon.trash,{s:12})));
  };

  return React.createElement("div",{className:"proj-wrap",ref:ref},
    React.createElement("button",{className:"proj-btn"+(open?" open":""),onClick:()=>setOpen(o=>!o),title:"Switch project"},
      React.createElement(Icon.film,{s:13}),
      React.createElement("span",{className:"proj-name"},title),
      currentShared && React.createElement("span",{className:"proj-format shared"},"Shared"),
      currentEpisodeNo>0 && React.createElement("span",{className:"proj-format"},"E"+String(currentEpisodeNo).padStart(2,"0")),
      formatLabel && React.createElement("span",{className:"proj-format"},formatLabel),
      frameworkLabel && React.createElement("span",{className:"proj-format fw"},frameworkLabel),
      React.createElement(Icon.chevD,{s:12})),
    open && React.createElement("div",{className:"proj-menu"},
      React.createElement("div",{className:"proj-menu-lab"},"Films & TV Shows"),
      React.createElement("div",{className:"proj-list"},
        (!standalone.length && !shows.length && !unavailable.length) && React.createElement("div",{className:"proj-empty"},
          "No projects yet \u2014 start one with New Story."),
        standalone.map(row),
        shows.map(s=>{
          const eps=episodesOf(s.id), owns=s.isOwner!==false&&!s.isShared;
          const count=eps.length+" episode"+(eps.length===1?"":"s")+(s.isShared?" available":"");
          return React.createElement("div",{key:s.id,className:"proj-show"+(eps.some(e=>e.id===currentId)?" current":"")},
            renaming===s.id ? renameEditor(s,"show") : React.createElement("div",{className:"proj-show-head proj-row"},
              React.createElement(Icon.layers,{s:12}),
              React.createElement("span",{className:"proj-show-name"},s.title),
              React.createElement("span",{className:"proj-row-date"},count),
              s.isShared && React.createElement("span",{className:"proj-row-share"},"Shared \u00b7 "+(window.teamRoleLabel?window.teamRoleLabel(s.shareRole):(s.shareRole||"Collaborator"))),
              React.createElement("span",{className:"proj-show-tag"},"Show"),
              owns && onRename && React.createElement("button",{className:"proj-row-act",title:"Rename show","aria-label":"Rename show",disabled:allBusy,onClick:()=>beginRename(s)},
                React.createElement(Icon.wand,{s:12})),
              owns && onDeleteShow && React.createElement("button",{className:"proj-row-act danger",title:"Delete show","aria-label":"Delete show",disabled:allBusy,onClick:()=>requestDeleteShow(s,eps)},
                busyIs("delete-show:"+s.id)?"…":React.createElement(Icon.trash,{s:12}))),
            eps.map(row),
            !eps.length && React.createElement("div",{className:"proj-row-main",style:{paddingLeft:32,color:"var(--txt-3)"}},
              owns?"No episodes yet — create Episode 1 to begin.":"No episodes available to you."),
            onNewEpisode && owns && React.createElement("button",{className:"proj-newep",disabled:allBusy,onClick:async ()=>{
              const done=await runAction("new-episode:"+s.id,()=>onNewEpisode(s.id),"Couldn’t create a new episode."); if(done)setOpen(false); }},
              React.createElement(Icon.plus,{s:12}),busyIs("new-episode:"+s.id)?"Creating…":(eps.length?"New episode":"Create Episode 1")));
        }),
        unavailable.length>0 && React.createElement("div",{className:"proj-show unavailable"},
          React.createElement("div",{className:"proj-show-head"},
            React.createElement(Icon.layers,{s:12}),React.createElement("span",{className:"proj-show-name"},"Show unavailable"),
            React.createElement("span",{className:"proj-row-date"},unavailable.length+" episode"+(unavailable.length===1?"":"s")),
            React.createElement("span",{className:"proj-show-tag"},"Recovery")),
          unavailable.map(p=>row(p,{unavailable:true})))),
      canMakeShow && onMakeShow && React.createElement("button",{className:"proj-new ghosted",disabled:allBusy,onClick:async ()=>{
        const done=await runAction("make-show:"+currentId,onMakeShow,"Couldn’t create the show."); if(done)setOpen(false); },
        title:"This project becomes Episode 1; its cast, locations, props and lookbook become the show's shared bible"},
        React.createElement(Icon.layers,{s:13}),busyIs("make-show:"+currentId)?"Creating show…":"Turn this project into a show"),
      React.createElement("button",{className:"proj-new",disabled:allBusy,title:"Start a new project from an idea \u2014 the same New Story window as the orange button",onClick:async ()=>{
        if(typeof onNewStory==="function"){ setOpen(false); onNewStory(); return; }
        const done=await runAction("new-film",()=>onCreate("Untitled film"),"Couldn’t create a new project."); if(done)setOpen(false); }},
        React.createElement(Icon.plus,{s:13}),busyIs("new-film")?"Creating…":"New Story")));
}
window.ProjectSwitcher = ProjectSwitcher;

/* auth-ui.jsx — sign-in / sign-up modal + the top-bar account chip.
   Rendered by app.jsx. Local-first: signing in is optional; it switches the app
   from browser-local storage to the Supabase cloud. */

/* `light` — the Paper & Ink variant used over the marketing landing page;
   without it the modal keeps the app's dark theme. */
function AuthModal({ onClose, onAuthed, initialMode, plan, light }){
  const [mode, setMode] = React.useState(initialMode==="signup"?"signup":"signin");   // signin | signup
  // the tier carried from the landing pricing (writer/director/studio) — shown as a
  // chip so the visitor sees their choice followed them into signup
  const planObj = (window.CINEMA_PLANS||[]).find(p=>String(p.tier).toLowerCase()===String(plan||"").toLowerCase());
  const planName = planObj ? (planObj.name+" plan · "+planObj.price+"/mo") : null;
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [notice, setNotice] = React.useState("");

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
      onAuthed && onAuthed(data && data.session);
      onClose && onClose();
    }catch(ex){ setErr((ex && ex.message) || "Network error."); setBusy(false); }
  };

  return React.createElement("div",{className:"auth-overlay"+(light?" auth-light":""),onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose && onClose(); }},
    React.createElement("div",{className:"auth-panel"+(light?" light":"")},
      React.createElement("div",{className:"auth-head"},
        React.createElement("div",{className:"auth-mark"},"Cinema Machine"),
        light && React.createElement("div",{className:"auth-act"}, mode==="signup"?"Prologue":"Welcome back"),
        React.createElement("div",{className:"auth-title"}, mode==="signup"?"Create your account":"Sign in"),
        (mode==="signup" && planName) && React.createElement("div",{className:"auth-plan"},
          React.createElement(Icon.sparkles,{s:11}), planName, React.createElement("span",{className:"auth-plan-note"},"· checkout opens after signup"))),
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
        err && React.createElement("div",{className:"auth-err"}, err),
        React.createElement("button",{className:"auth-submit",disabled:busy,onClick:submit},
          busy ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin dark"}),
              mode==="signup"?"Creating\u2026":"Signing in\u2026")
            : (mode==="signup"?"Create account":"Sign in")),
        React.createElement("div",{className:"auth-switch"},
          mode==="signup" ? "Already have an account? " : "New here? ",
          React.createElement("button",{className:"auth-link",onClick:()=>{ setErr(""); setNotice(""); setMode(mode==="signup"?"signin":"signup"); }},
            mode==="signup" ? "Sign in" : "Create one"))),
      React.createElement("button",{className:"auth-close",onClick:onClose},
        React.createElement(Icon.x,{s:16}))));
}
window.AuthModal = AuthModal;

function AccountChip({ session, cloudActive, connectionState, saveState, shareRole, roleUnavailable, onSignIn, onSignOut }){
  const [open, setOpen] = React.useState(false);
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
  const scopedRole = shareRole==="writer" ? "Writer"
    : shareRole==="art_director" ? "Art director"
    : shareRole==="view_only" ? "View only" : "";
  const roleTitle = roleUnavailable ? " Project role unavailable; this shared project is read-only."
    : (scopedRole ? " Role: "+scopedRole+"." : "");
  return React.createElement("div",{className:"acct-wrap",ref:ref},
    React.createElement("button",{className:"acct-chip"+(open?" open":""),onClick:()=>setOpen(o=>!o),title:email},
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
            ? React.createElement("span",{className:"acct-cloud bad",title:"TURN could not verify a current role for this shared project. It is read-only; changes and AI actions will not save. Ask the owner to reassign your role."},
                React.createElement(Icon.warn,{s:11}),"Role unavailable")
            : shareRole==="view_only"
            ? React.createElement("span",{className:"acct-cloud warn",title:"You have VIEW-ONLY access to this film. You can read and explore it, but changes you make here are not saved. Ask the owner for Writer access to edit."},
                React.createElement(Icon.eye||Icon.warn,{s:11}),"View only")
            : scopedRole
            ? React.createElement("span",{className:"acct-cloud",
                title:(window.teamRoleScopeNote ? window.teamRoleScopeNote(shareRole) : "")+" Changes inside your remit save normally."},
                React.createElement(Icon.check,{s:11}),
                shareRole==="writer" ? "Writer" : "Art dir")
            // healthy state is quiet — "Synced" is reassurance, not news, so it only
            // slides out on hover (desktop) or tap/open (mobile); problem states stay visible
            : React.createElement("span",{className:"acct-cloud quiet"},React.createElement(Icon.check,{s:11}),"Synced"))
        : connectionState==="retrying"
        ? React.createElement("span",{className:"acct-cloud warn",title:"The cloud connection paused. TURN is retrying automatically and your open work stays on screen."},React.createElement(Icon.warn,{s:11}),"Reconnecting")
        : React.createElement("span",{className:"acct-cloud warn"},React.createElement(Icon.warn,{s:11}),"Connecting")),
    open && React.createElement("div",{className:"acct-menu"},
      React.createElement("div",{className:"acct-email"}, email),
      React.createElement("div",{className:"acct-status"},
        cloudActive ? (saveState==="failed" ? "Signed in \u00b7 the last save FAILED \u2014 your work is still on screen; leave this tab open until it saves."
                     : saveState==="retrying" ? "Signed in \u00b7 retrying a save that didn't go through\u2026"
                     : "Signed in \u00b7 cloud storage active")
                    : connectionState==="retrying"
                    ? "Signed in \u00b7 reconnecting automatically. Your open work stays on screen."
                    : "Signed in \u00b7 opening cloud storage\u2026"),
      scopedRole && React.createElement("div",{className:"acct-status",
        title:window.teamRoleScopeNote ? window.teamRoleScopeNote(shareRole) : ""},
        "Project role: "+scopedRole),
      roleUnavailable && React.createElement("div",{className:"acct-status acct-status-bad"},
        "Project role unavailable \u00b7 read-only until the owner reassigns access"),
      // CREDITS (images, video and writing-model calls debit these server-side) + the
      // WRITING-MODEL meter (a local running tally of those calls \u2014 counted in ai.jsx)
      (()=>{
        const bal = window.turnCreditBalance;
        const ts = (typeof window.turnTextSpend==="function") ? window.turnTextSpend() : null;
        const since = ts && ts.since ? new Date(ts.since) : null;
        return React.createElement(React.Fragment,null,
          bal && React.createElement("div",{className:"acct-status",title:"Credits \u2014 spent by image and video generation and by writing-model calls (see the Stage footer for per-render costs)"},
            "Credits: "+bal.remaining+" remaining"+(window.turnIsPaidPlan&&window.turnIsPaidPlan(bal.plan)?(" \u00b7 "+bal.plan+" plan"):"")),
          // upgrade / manage plan \u2014 opens the Cinema Machine plans modal
          window.turnOpenPlans && React.createElement("button",{className:"acct-upgrade",
            onClick:()=>{ setOpen(false); window.turnOpenPlans(); }},
            React.createElement(Icon.sparkles,{s:12}),
            (bal && window.turnIsPaidPlan && window.turnIsPaidPlan(bal.plan)) ? "Change plan" : "Get credits \u00b7 Choose a plan"),
          ts && React.createElement("div",{className:"acct-status",
            title:"Writing model use \u2014 a running tally on this device of drafting, agent and QA calls. The server deducts each call's real token cost from your credits; MUSE is free."},
            "Writing model: "+ts.calls+" call"+(ts.calls===1?"":"s")+" \u00b7 \u2248"+(ts.credits||0)+" credits"
              +(since?(" since "+since.toLocaleDateString()):"")));
      })(),
      React.createElement("button",{className:"acct-signout",onClick:()=>{ setOpen(false); onSignOut && onSignOut(); }},
        "Sign out")));
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
function ProjectSwitcher({ projects, currentId, onSwitch, onCreate, onRename, onDelete, formatLabel, frameworkLabel, onNewEpisode, onMakeShow, canMakeShow, onDeleteShow, seriesBusy }){
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
  const title = current ? current.title : "Loading\u2026";
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
  const standalone = (grouped.standalone||[]).slice().sort(_byCreated);
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
          : "This removes the film and its sheets. If it’s your only film, a fresh blank one opens in its place."),
      confirmLabel:p.showId?"Delete episode":"Delete film",danger:true
    });
    if(!ok) return false;
    const done = await runAction("delete:"+p.id, ()=>onDelete(p.id), p.showId?"Couldn’t delete this episode.":"Couldn’t delete this film.");
    if(done){ setRenaming(null); setOpen(false); }
    return done;
  };

  const row = (p, opts)=>{
    const canOwn = p.isOwner !== false && !p.isShared;
    const isUnavailable = !!(opts&&opts.unavailable);
    const epNo = Number(p.episodeNo);
    return renaming===p.id
    ? renameEditor(p,p.showId?"episode":"film")
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
        canOwn && onRename && React.createElement("button",{className:"proj-row-act",title:"Rename "+(p.showId?"episode":"film"),
          disabled:allBusy,"aria-label":"Rename "+(p.showId?"episode":"film"),onClick:()=>beginRename(p)},
          React.createElement(Icon.wand,{s:12})),
        canOwn && onDelete && React.createElement("button",{className:"proj-row-act danger",title:p.showId?"Delete episode":"Delete film",
          disabled:allBusy,"aria-label":p.showId?"Delete episode":"Delete film",onClick:()=>requestDeleteEpisode(p)},
          busyIs("delete:"+p.id)?"…":React.createElement(Icon.trash,{s:12})));
  };

  return React.createElement("div",{className:"proj-wrap",ref:ref},
    React.createElement("button",{className:"proj-btn"+(open?" open":""),onClick:()=>setOpen(o=>!o),title:"Switch film"},
      React.createElement(Icon.film,{s:13}),
      React.createElement("span",{className:"proj-name"},title),
      currentShared && React.createElement("span",{className:"proj-format shared"},"Shared"),
      currentEpisodeNo>0 && React.createElement("span",{className:"proj-format"},"E"+String(currentEpisodeNo).padStart(2,"0")),
      formatLabel && React.createElement("span",{className:"proj-format"},formatLabel),
      frameworkLabel && React.createElement("span",{className:"proj-format fw"},frameworkLabel),
      React.createElement(Icon.chevD,{s:12})),
    open && React.createElement("div",{className:"proj-menu"},
      React.createElement("div",{className:"proj-menu-lab"},"Films & shows"),
      React.createElement("div",{className:"proj-list"},
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
        title:"This film becomes Episode 1; its cast, locations, props and lookbook become the show's shared bible"},
        React.createElement(Icon.layers,{s:13}),busyIs("make-show:"+currentId)?"Creating show…":"Turn this film into a show"),
      React.createElement("button",{className:"proj-new",disabled:allBusy,onClick:async ()=>{
        const done=await runAction("new-film",()=>onCreate("Untitled film"),"Couldn’t create a new film."); if(done)setOpen(false); }},
        React.createElement(Icon.plus,{s:13}),busyIs("new-film")?"Creating…":"New film")));
}
window.ProjectSwitcher = ProjectSwitcher;

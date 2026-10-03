/* team.jsx — project collaboration UI.
   First collaboration layer: project owners can invite collaborators by email and
   assign a role. Shared projects appear in the collaborator's project switcher
   once supabase/team-collaboration.sql has been run.
   RELAUNCHED (owner 2026-10-03: "Let's ship Collaboration (Teams)"; the rules are
   docs/Dashboard Plan.md §5-§7): Director and up shares; 5 people a film on Director, 10 on
   Producer (pending invites count), at most 3 Co-writers, 20 new invites a day; invites expire
   after 14 days; the Stage editor role on Producer films; a shared film's rooms follow the
   OWNER's plan; the owner pays for work on the film within each person's monthly budget
   (200 credits on Director, 500 on Producer). The database enforces all of it
   (supabase/team-relaunch.sql) and the server decides who pays (image-proxy/film-payer.mjs);
   this file is the UI. The switch `team_sharing` (turn_app_config) can turn new sharing off in
   one place: then the Team button shows "Soon" again, as during the pause (TEAM_SOON_TEXT). */

/* FOUR collaborator roles (the old "Producer/admin" was removed by user decision — it
   promised team management it never had; the Stage editor came with the relaunch,
   owner 2026-10-02 §9.2: it edits the Stage on Producer films). Each role carries its plain-language permission blurb;
   the panel shows these wherever a role is chosen so nobody has to guess.
   DISPLAY vs ID (owner decision 2026-09-28): the "writer" role is SHOWN as "Co-writer" so it
   no longer reads like the Writer plan. The id "writer", the stored role values and the
   section map below are unchanged. */
const TEAM_ROLES = [
  { id:"view_only", label:"View-only", blurb:"Opens and reads the film. Cannot save any change." },
  { id:"writer", label:"Co-writer", blurb:"Saves story work \u2014 spine, scenes, beats, script and continuity. Art Room changes aren't saved." },
  { id:"art_director", label:"Art director", blurb:"Saves Art Room work \u2014 cast, props, locations, lookbook and shots. Story and script aren't saved." },
  { id:"stage_editor", label:"Stage editor", producerOnly:true, blurb:"Saves Stage work \u2014 shots' takes, voices and the Stage's settings (Producer films). Story and the rest of the Art Room aren't saved." },
];
function teamRoleLabel(id){
  const r = TEAM_ROLES.find(x=>x.id===id);
  return r ? r.label : (id ? "Legacy role" : "Role unavailable");
}
function teamRoleBlurb(id){
  const r = TEAM_ROLES.find(x=>x.id===id);
  return r ? r.blurb : (id
    ? "This role no longer exists \u2014 pick one of the four roles to restore this collaborator's access."
    : "The current collaborator role couldn't be verified, so access is read-only. Ask the film's owner to check your role in the Team window.");
}
function teamScopedRoleBlurb(id, series){
  if(!series) return teamRoleBlurb(id);
  if(id==="view_only") return "Opens and reads the Show's shared Bible and all existing and future episodes. Cannot save any change.";
  if(id==="writer") return "Saves story work across the Show's existing and future episodes \u2014 spine, scenes, beats, script and continuity. The shared Bible is readable; Art Room changes aren't saved.";
  if(id==="art_director") return "Saves the Show's shared Bible and Art Room work across all existing and future episodes \u2014 cast, props, locations, lookbook and shots. Story and script changes aren't saved.";
  if(id==="stage_editor") return "Saves Stage work across the Show's existing and future episodes \u2014 shots' takes, voices and the Stage's settings. Story and the rest of the Art Room aren't saved.";
  return teamRoleBlurb(id);
}
/* WHAT EACH ROLE MAY WRITE, by doc SECTION — the same granularity the per-section save
   already uses, so scoping is enforced at the exact layer that writes.
   `project` is deliberately writable by BOTH writer and art director: it holds the story
   identity (logline, premise) AND the style bible, so locking either side out of it would
   block ordinary work. Only the owner is unrestricted. */
const TEAM_ROLE_SECTIONS = {
  owner:          "*",
  writer:         ["scenes","beatsMap","drafts","history","continuityMap","project"],
  art_director:   ["characters","props","locations","lookbook","lookbookNote","lookbookApplied",
                   "shots","trash","project","propsSeeded","locsSeeded","visualsSeeded"],
  stage_editor:   ["shots","project"],
  view_only:      [],
};
/* NO role at all (a film that is simply yours, or a project list that hasn't loaded yet)
   never restricts — that would silently block every save for a solo user. But a role we
   don't recognize (a legacy 'producer_admin' row before the migration ran, or a future
   role this build predates) fails CLOSED: an unknown grant must never mean "write
   everything". The blocked-save notice tells the collaborator what happened. */
function teamCanWriteSection(role, section){
  // ABSENT role (null/undefined — a solo film, or a list that hasn't loaded) stays
  // unrestricted; any PRESENT value that isn't a known grant — including the empty
  // string — is an unknown grant and fails closed.
  if(role==null || role==="owner") return true;
  const allow = TEAM_ROLE_SECTIONS[role];
  if(allow === "*") return true;
  if(!allow) return false;                      // unknown/legacy/empty role → fail closed
  return allow.indexOf(section) >= 0;
}
/* Room mutability is a UI capability, not a navigation permission. Collaborators may
   inspect departments they cannot change (an Art director can read the Writers' Room),
   so derive disabled/editable state from the same section allow-list used by autosave. */
function teamCanWriteRoom(role, room){
  if(role==null || role==="owner") return true;
  if(room==="writers") return teamCanWriteSection(role,"scenes")
    && teamCanWriteSection(role,"beatsMap") && teamCanWriteSection(role,"drafts");
  if(room==="art") return teamCanWriteSection(role,"characters")
    && teamCanWriteSection(role,"props") && teamCanWriteSection(role,"shots");
  if(room==="stage") return role==="stage_editor";
  return false;
}
/* plain-language name for what a role may NOT touch, for the "that wasn't saved" notice */
function teamRoleScopeNote(role){
  if(role==="writer") return "Your Co-writer role covers the story, script and beats — Art Room changes (cast, props, locations, lookbook, shots) aren't saved.";
  if(role==="art_director") return "Your Art director role covers the Art Room — story and script changes aren't saved.";
  if(role==="stage_editor") return "Your Stage editor role covers the Stage — story and the rest of the Art Room aren't saved.";
  if(role==="" || (role && role!=="view_only" && !TEAM_ROLES.find(r=>r.id===role)))
    return "Your role on this film is missing or from an older version of the app, so changes aren't saved. Ask the film's owner to check your role in the Team window.";
  return "";
}
window.TEAM_ROLE_SECTIONS = TEAM_ROLE_SECTIONS;
window.teamCanWriteSection = teamCanWriteSection;
window.teamCanWriteRoom = teamCanWriteRoom;
window.teamRoleScopeNote = teamRoleScopeNote;

/* THE RULES, as the database enforces them (supabase/team-relaunch.sql) — shown, never trusted */
const TEAM_LIMITS = Object.freeze({
  people:{ director:5, studio:10 }, cowriters:3, invitesPerDay:20, inviteDays:14,
  budget:{ director:200, studio:500 },
});
/* sharing is on (turn_app_config "team_sharing", cloud.jsx cloudLoadTeamSharing), or the admin */
function teamSharingOn(){ return !!window.turnTeamSharing || !!window.turnIsAdmin; }
/* what the SIGNED-IN account's plan allows for sharing: "studio" | "director" | "none", or null
   while the ledger hasn't loaded. A frozen or past-due account can't share (Dashboard Plan §5). */
function teamAccountTier(){
  if(window.turnIsAdmin) return "studio";
  const b = window.turnCreditBalance;
  if(!b) return null;
  if(b.frozen || b.paymentStatus==="past_due") return "none";
  const p = String(b.plan||"").toLowerCase();
  if(p==="studio" || p==="producer") return "studio";
  if(p==="director" || p==="pro") return "director";
  return "none";
}
/* people on a film who count toward its cap: joined, or invited and not expired */
function teamCountsTowardCap(m, now){
  if(!m || m.status!=="active") return false;
  if(m.member_user) return true;
  return !m.expires_at || Date.parse(m.expires_at) > (now||Date.now());
}
function teamCanManage(projectMeta){
  if(!teamSharingOn()) return false;
  return !!(projectMeta && (projectMeta.isOwner || window.turnIsAdmin));
}
window.TEAM_LIMITS = TEAM_LIMITS;
window.teamSharingOn = teamSharingOn;
window.teamAccountTier = teamAccountTier;

/* THE SWITCH — while team_sharing is off (and before it loads), Team looks the way it did during
   the pause (owner decision 2026-10-02, Option C): everyone but the admin sees the Team button and
   the phone ⋯ entry with a "Soon" chip, disabled-looking (aria-disabled, still focusable so the
   tooltip can be read), and a click only shows TEAM_SOON_TEXT. Films already shared keep opening
   with their role either way — that is access to a film, not the Team feature. */
const TEAM_SOON_TEXT = "Team sharing is coming soon: invite co-writers and art directors to work on your film.";
// isAdmin: app.jsx passes the signed-in account's admin flag; without it, window.turnIsAdmin.
// sharing: app.jsx passes the switch it loaded; without it, window.turnTeamSharing.
function teamWindowAllowed(isAdmin, sharing){
  const admin = (isAdmin===undefined || isAdmin===null) ? !!window.turnIsAdmin : !!isAdmin;
  const on = (sharing===undefined || sharing===null) ? !!window.turnTeamSharing : !!sharing;
  return admin || on;
}
function teamSoonNotice(){
  if(typeof window.appToast==="function") window.appToast(TEAM_SOON_TEXT, "info");
}
window.TEAM_SOON_TEXT = TEAM_SOON_TEXT;
window.teamWindowAllowed = teamWindowAllowed;

/* the Team window: when sharing is on (or for the admin) — otherwise nothing (no window, no read) */
function TeamModal(props){
  if(!teamWindowAllowed(props && props.isAdmin, props && props.sharing)) return null;
  return React.createElement(TeamWindow, props);
}

const fmtCredits = (n)=> Math.max(0, Math.floor(Number(n)||0)).toLocaleString("en-US");
/* the monthly budget picker (owner 2026-10-03: "should be pulling from the credit pack options"):
   No limit, the plan's default (200 Director / 500 Producer), the three pack sizes, and a value
   set earlier that is none of these. A budget is a cap on what that person may use from the
   owner's balance, not a transfer — "Add credits" is what tops the balance up. */
function teamBudgetChoices(tier, current){
  const packs = ((window.CINEMA_CREDIT_PACKS||[]).map(p=>Number(p.credits)).filter(n=>n>0));
  const def = TEAM_LIMITS.budget[tier] || TEAM_LIMITS.budget.director;
  const nums = Array.from(new Set([def, ...(packs.length ? packs : [250,1000,3000]),
    ...(current!=null && Number.isFinite(Number(current)) ? [Number(current)] : [])])).sort((a,b)=>a-b);
  return [{ value:"", label:"No limit" }].concat(nums.map(n=>({ value:String(n),
    label:fmtCredits(n)+" a month"+(n===def?" (default)":"") })));
}
function teamInviteState(m, now){
  if(m.member_user) return { joined:true, text:"Joined" };
  const exp = m.expires_at ? Date.parse(m.expires_at) : NaN;
  if(Number.isFinite(exp) && exp <= now) return { expired:true, text:"Invite expired" };
  if(Number.isFinite(exp)){
    const days = Math.max(1, Math.ceil((exp-now)/86400000));
    return { pending:true, text:"Invited · expires in "+days+" day"+(days===1?"":"s") };
  }
  return { pending:true, text:"Invited" };
}

function TeamWindow({ projectId, projectTitle, projectMeta, series, onClose, onChanged }){
  const [members, setMembers] = React.useState([]);
  const [spend, setSpend] = React.useState({});
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("writer");
  const [busy, setBusy] = React.useState("");
  const [schemaMissing, setSchemaMissing] = React.useState(!!window.turnTeamSchemaMissing);
  const canManage = teamCanManage(projectMeta);
  const tier = teamAccountTier();
  const canInvite = canManage && (tier==="director" || tier==="studio");
  const cap = TEAM_LIMITS.people[tier] || 0;
  const now = Date.now();
  const showTitle = projectTitle || "Untitled Show";
  const scopedRoleBlurb = id=>teamScopedRoleBlurb(id,!!series);
  const roleChoices = TEAM_ROLES.filter(r=>!r.producerOnly || tier==="studio");
  const load = React.useCallback(async ()=>{
    if(!projectId || typeof window.cloudListProjectMembers!=="function"){ setMembers([]); return; }
    const [rows, used] = await Promise.all([
      window.cloudListProjectMembers(projectId),
      typeof window.cloudTeamSpend==="function" ? window.cloudTeamSpend(projectId) : Promise.resolve([]),
    ]);
    setMembers(rows||[]);
    const map = {}; (used||[]).forEach(u=>{ map[u.member_id] = u; }); setSpend(map);
    setSchemaMissing(!!window.turnTeamSchemaMissing);
  },[projectId]);
  React.useEffect(()=>{ load(); },[load]);
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  const counted = members.filter(m=>teamCountsTowardCap(m, now)).length;
  const toast = (msg, kind)=>{ if(window.appToast && msg) window.appToast(msg, kind); };
  const invite = async ()=>{
    if(!canInvite || schemaMissing) return;
    setBusy("invite");
    const addr = email.trim().toLowerCase();
    const res = await window.cloudInviteProjectMember(projectId, email, role);
    setBusy("");
    if(res && res.ok){
      setEmail("");
      await load();
      if(onChanged) onChanged();
      // the grant and the email are separate outcomes — never claim "sent" when only the row was written
      if(res.emailSent) toast(series ? "Invitation to Show “"+showTitle+"” emailed to "+addr+"." : "Invitation emailed to "+addr+".","success");
      else toast(series
        ? "Added to Show “"+showTitle+"”, but "+(res.emailNote||"the invitation email couldn't be sent.")+" They'll have access to its shared Bible and all episodes when they sign in with this address."
        : "Added, but "+(res.emailNote||"the invitation email couldn't be sent.")+" They'll see the film when they sign in with this address.","error");
    } else {
      if(res && res.setup) setSchemaMissing(true);
      toast((res&&res.message)||"Couldn't add this person.","error");
    }
  };
  const inviteAgain = async (m)=>{
    if(!canInvite || typeof window.cloudRenewInvite!=="function") return;
    setBusy("renew:"+m.id);
    const res = await window.cloudRenewInvite(m, projectId);
    setBusy("");
    await load();
    if(res && res.ok) toast(res.emailSent ? "Invitation sent again to "+m.member_email+"." : "Invite renewed for 14 days, but "+(res.emailNote||"the email couldn't be sent.")+"", res.emailSent?"success":"error");
    else toast((res&&res.message)||"Couldn't send the invite again.","error");
  };
  const updateRole = async (m, nextRole)=>{
    if(!canManage) return;
    setBusy("role:"+m.id);
    const res = await window.cloudUpdateProjectMember(m.id, { role:nextRole }, projectId);
    setBusy("");
    if(res && res.ok){ await load(); if(onChanged) onChanged(); }
    else toast((res&&res.message)||"Couldn't change the role.","error");
  };
  const saveBudget = async (m, raw)=>{
    if(!canManage || typeof window.cloudSetMemberBudget!=="function") return;
    const next = raw==="" ? null : Math.max(0, Math.floor(Number(raw)));
    if(raw!=="" && !Number.isFinite(next)) return;
    if(next===(m.budget_credits==null?null:Number(m.budget_credits))) return;
    setBusy("budget:"+m.id);
    const res = await window.cloudSetMemberBudget(m.id, next);
    setBusy("");
    if(res && res.ok){ await load(); toast(next==null ? "No monthly limit for "+m.member_email+"." : "Monthly budget for "+m.member_email+": "+fmtCredits(next)+" credits.","success"); }
    else toast((res&&res.message)||"Couldn't change the budget.","error");
  };
  const remove = async (m)=>{
    if(!canManage) return;
    const ok = !window.appConfirm || await window.appConfirm({
      title:series ? "Remove this person from the Show?" : "Remove this person?",
      body:series
        ? "This ends "+m.member_email+"'s access to Show “"+showTitle+"”, its shared Bible and all existing and future episodes immediately — if they have one open they'll be told their access ended. You can invite them again later."
        : "This ends "+m.member_email+"'s access to “"+(projectTitle||"this film")+"” immediately — if they have it open they'll be told their access ended. You can invite them again later.",
      confirmLabel:series ? "Remove Show access" : "Remove",
      danger:true
    });
    if(!ok) return;
    setBusy("remove:"+m.id);
    const res = await window.cloudRemoveProjectMember(m.id, m.project_id);
    setBusy("");
    if(res && res.ok){ await load(); if(onChanged) onChanged(); }
    else toast((res&&res.message)||"Couldn't remove this person.","error");
  };
  const leave = async ()=>{
    if(typeof window.cloudLeaveFilm!=="function") return;
    const ok = !window.appConfirm || await window.appConfirm({
      title:series ? "Leave this Show?" : "Leave this film?",
      body:"You'll lose access to “"+(series?showTitle:(projectTitle||"this film"))+"” at once. The owner can invite you again.",
      confirmLabel:"Leave", danger:true });
    if(!ok) return;
    setBusy("leave");
    const res = await window.cloudLeaveFilm(projectId);
    setBusy("");
    if(res && res.ok){ toast("You left “"+(series?showTitle:(projectTitle||"the film"))+"”.","success"); onClose(); if(onChanged) onChanged({ left:true }); }
    else toast((res&&res.message)||"Couldn't leave the film.","error");
  };
  const mine = !canManage ? members[0] : null;           // a collaborator reads only their own row
  const mySpend = mine ? spend[mine.id] : null;
  const budgetLine = (m, used)=>{
    const spent = used ? used.spent : 0;
    return m.budget_credits==null
      ? fmtCredits(spent)+" credits this month · no limit"
      : fmtCredits(spent)+" of "+fmtCredits(m.budget_credits)+" credits this month";
  };
  const shareNote = schemaMissing
    ? "Team sharing isn't set up on the server yet. Please try again later."
    : canManage && tier===null
    ? "Checking your plan\u2026"
    : canManage
    ? (canInvite
      ? (series
        ? "One team applies to Show “"+showTitle+"”: each person's access covers its shared Bible and all existing and future episodes. "
        : "Invite people by email and choose what each may do. ")
        +"Work they do here is paid from your credits, within a monthly budget per person ("+fmtCredits(TEAM_LIMITS.budget[tier]||0)+" credits by default) that you can change."
      : "Sharing a film is part of the Director and Producer plans. You can still remove anyone already here.")
    : (series
      ? "This Show was shared with you. One access grant covers its shared Bible and all existing and future episodes. You work here with the role the owner gave you"
      : "This film was shared with you. You work here with the role the owner gave you")
      +(projectMeta && projectMeta.shareRole ? (": "+teamRoleLabel(projectMeta.shareRole)+" — "+(scopedRoleBlurb(projectMeta.shareRole)||"")) : ".")
      +" Work you do here is paid by the film's owner, within your monthly budget.";
  return React.createElement("div",{className:"bible-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal team-modal"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement(Icon.user,{s:16}),"Team",
          React.createElement("span",{className:"bible-sub"},series ? ("Show · "+showTitle) : (projectTitle||"Current film"))),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"team-body"},
        React.createElement("div",{className:"team-note"}, shareNote),
        canManage && !canInvite && tier==="none" && React.createElement("button",{className:"team-add team-plans",
          onClick:()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); }},"See plans"),
        canInvite && React.createElement("div",{className:"team-invite"},
          React.createElement("input",{className:"team-email",type:"email",value:email,placeholder:"teammate@example.com",
            "aria-label":"Email address to invite",
            disabled:schemaMissing||counted>=cap,onChange:e=>setEmail(e.target.value),onKeyDown:e=>{ if(e.key==="Enter" && email.trim()) invite(); }}),
          React.createElement("select",{className:"team-role",value:role,disabled:schemaMissing,onChange:e=>setRole(e.target.value),"aria-label":"Role"},
            roleChoices.map(r=>React.createElement("option",{key:r.id,value:r.id,title:scopedRoleBlurb(r.id)},r.label))),
          React.createElement("button",{className:"team-add",disabled:schemaMissing||busy==="invite"||!email.trim()||counted>=cap,onClick:invite},
            React.createElement(Icon.plus,{s:14}),busy==="invite"?"Inviting...":"Invite")),
        // what the selected role allows, in plain language, right where it's being chosen
        canInvite && !schemaMissing && React.createElement("div",{className:"team-role-blurb"},
          teamRoleLabel(role)+" — "+scopedRoleBlurb(role)),
        // collaborators' work comes out of the owner's own balance: show it, and the way to add to it
        // (the credit packs — 250 / 1,000 / 3,000 — in the Plans window, plans.jsx turnOpenCreditPacks)
        canInvite && React.createElement("div",{className:"team-funds"},
          React.createElement("span",null, (window.turnCreditBalance && window.turnCreditBalance.remaining!=null)
            ? "Your balance: "+fmtCredits(window.turnCreditBalance.remaining)+" credits \u2014 your team's work on this film comes out of it."
            : "Your team's work on this film comes out of your credits."),
          React.createElement("button",{type:"button",className:"team-again team-add-credits",
            onClick:()=>{ if(typeof window.turnOpenCreditPacks==="function") window.turnOpenCreditPacks(); else if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); }},"Add credits")),
        canInvite && React.createElement("div",{className:"team-cap"},
          counted+" of "+cap+" people on this "+(series?"Show":"film")+" (invites count until they expire) · up to "+TEAM_LIMITS.cowriters+" Co-writers"
          +(tier!=="studio" ? " · the Stage editor role comes with the Producer plan" : "")),
        React.createElement("div",{className:"team-seats"},
          React.createElement("div",{className:"team-seat owner"},
            React.createElement("div",{className:"team-avatar"},React.createElement(Icon.user,{s:14})),
            React.createElement("div",{className:"team-member-main"},
              React.createElement("div",{className:"team-member-email"},
                canManage ? (series ? "You · Show owner" : "You · owner")
                  : ((projectMeta && projectMeta.ownerEmail && typeof cloudHandleName==="function") ? cloudHandleName(projectMeta.ownerEmail)+" · owner" : (series ? "Show owner" : "Owner"))),
              React.createElement("div",{className:"team-member-role",
                title:series
                  ? "Edits the shared Bible and every episode, invites and removes people, changes roles, and renames or deletes the Show."
                  : "Edits everything, invites and removes people, changes roles, renames or deletes the film."},
                "Edits everything; the only one who manages the team"))),
          members.length
            ? members.map(m=>{
                const legacy = !!(m.role && !TEAM_ROLES.find(r=>r.id===m.role));
                const st = teamInviteState(m, now);
                const used = spend[m.id];
                return React.createElement("div",{className:"team-seat"+(st.expired?" expired":""),key:m.id},
                React.createElement("div",{className:"team-avatar"},React.createElement(Icon.mail,{s:14})),
                React.createElement("div",{className:"team-member-main"},
                  React.createElement("div",{className:"team-member-email"},m.member_email),
                  React.createElement("div",{className:"team-member-role",title:scopedRoleBlurb(m.role)},
                    teamRoleLabel(m.role)+(legacy?" — pick a current role to restore access":"")+" · "+st.text),
                  React.createElement("div",{className:"team-member-budget"}, budgetLine(m, used))),
                canManage
                  ? React.createElement("div",{className:"team-member-actions"},
                      (st.pending||st.expired) && canInvite && React.createElement("button",{className:"team-again",disabled:!!busy,
                        title:"Send the invitation again (a fresh 14 days)",onClick:()=>inviteAgain(m)},busy==="renew:"+m.id?"Sending...":"Invite again"),
                      React.createElement("select",{className:"team-budget",
                        "aria-label":"Monthly credit budget for "+m.member_email,title:"How many of your credits this person may use a month",
                        value: m.budget_credits==null ? "" : String(m.budget_credits),
                        disabled:!!busy, onChange:e=>saveBudget(m, e.target.value)},
                        teamBudgetChoices(tier, m.budget_credits).map(o=>React.createElement("option",{key:o.value,value:o.value},o.label))),
                      React.createElement("select",{className:"team-role compact",value:m.role||"writer",disabled:!!busy||!canInvite,
                        title:scopedRoleBlurb(m.role),"aria-label":"Role for "+m.member_email,
                        onChange:e=>updateRole(m,e.target.value)},
                        // a legacy value (e.g. the retired producer/admin) still renders,
                        // clearly marked, so the owner can move the member off it
                        legacy && React.createElement("option",{value:m.role,disabled:true},"Legacy role"),
                        TEAM_ROLES.map(r=>React.createElement("option",{key:r.id,value:r.id,title:scopedRoleBlurb(r.id),
                          disabled:!!(r.producerOnly && tier!=="studio")},r.label))),
                      React.createElement("button",{className:"team-remove",disabled:!!busy,title:"Remove",onClick:()=>remove(m)},
                        React.createElement(Icon.trash,{s:14})))
                  : React.createElement("span",{className:"team-badge",title:scopedRoleBlurb(m.role)},teamRoleLabel(m.role)));
              })
            : (canManage ? React.createElement("div",{className:"team-empty"},"Nobody invited yet.") : null)),
        !canManage && mine && React.createElement("div",{className:"team-mine"},
          "Your budget on this "+(series?"Show":"film")+": "+budgetLine(mine, mySpend)+".",
          React.createElement("button",{className:"team-leave",disabled:busy==="leave",onClick:leave},busy==="leave"?"Leaving...":(series?"Leave Show":"Leave film"))),
        React.createElement("div",{className:"team-foot"},
          series
            ? "Only the Show owner invites or removes people, changes roles and budgets, renames the Show or deletes it. A collaborator who edits outside their role sees a notice that those changes weren't saved."
            : "Only the owner invites or removes people, changes roles and budgets, renames the film or deletes it. A collaborator who edits outside their role sees a notice that those changes weren't saved."))));
}

/* INVITE ACCEPTANCE LANDING — shown when the app is opened via ?invite=<projectId>
   (the link in the invitation email) once the visitor is signed in.
   `film` is the shared project row when this account can see it; null means the
   invitation is no longer active for THIS account (withdrawn, or signed in with a
   different address than the one invited) — say which, never leave them guessing.
   `canSetPassword` is true for accounts CREATED by the invite email: they signed
   in through the email link and have no password yet, so offer to set one here —
   otherwise they can never sign back in directly. */
function InviteWelcome({ film, invitedBy, sessionEmail, canSetPassword, onOpen, onClose }){
  const [pw, setPw] = React.useState("");
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwDone, setPwDone] = React.useState(false);
  const setPassword = async ()=>{
    if(pwBusy || !pw) return;
    setPwBusy(true);
    const res = (typeof window.cloudSetPassword==="function") ? await window.cloudSetPassword(pw) : { ok:false, message:"Unavailable." };
    setPwBusy(false);
    if(res && res.ok){ setPwDone(true); if(window.appToast) window.appToast("Password set — you can sign in directly next time.","success"); }
    else if(window.appToast) window.appToast((res&&res.message)||"Could not set the password.","error");
  };
  const role = film && film.shareRole;
  const isShow = !!(film && ((window.turnSeries&&typeof window.turnSeries.isShowDoc==="function")
    ? window.turnSeries.isShowDoc(film)
    : (String(film.project_kind||"").toLowerCase()==="show"||String(film.isShow).toLowerCase()==="true")));
  const invitedTitle = film ? (film.title||(isShow?"Untitled Show":"Untitled film")) : "";
  return React.createElement("div",{className:"bible-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal team-modal invite-welcome"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement(Icon.mail,{s:16}), film ? (isShow?"You've been added to a Show":"You've been added to a film") : "Invitation not active"),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"team-body"},
        film
          ? React.createElement(React.Fragment,null,
              React.createElement("div",{className:"invite-film"},
                React.createElement("div",{className:"invite-film-title"},"\u201C"+invitedTitle+"\u201D"),
                React.createElement("div",{className:"invite-film-by"},
                  isShow
                    ? (invitedBy ? invitedBy+" shared this Show with you." : "This Show was shared with you.")+
                      " Your access covers its shared Bible and all existing and future episodes."
                    : (invitedBy ? invitedBy+" shared this film with you." : "This film was shared with you."))),
              role && React.createElement("div",{className:"team-role-blurb"},
                "Your role: "+teamRoleLabel(role)+" \u2014 "+teamScopedRoleBlurb(role,isShow)),
              React.createElement("div",{className:"team-note invite-pays"},
                "Work you do on it is paid by its owner, within a monthly budget \u2014 you don't need a plan of your own."),
              canSetPassword && !pwDone && React.createElement("div",{className:"invite-pw"},
                React.createElement("div",{className:"invite-pw-note"},
                  "You signed in through the email link. Set a password so you can sign in directly next time (email: "+(sessionEmail||"this address")+")."),
                React.createElement("div",{className:"invite-pw-row"},
                  React.createElement("input",{className:"team-email",type:"password",value:pw,placeholder:"New password (8+ characters)",
                    onChange:e=>setPw(e.target.value),onKeyDown:e=>{ if(e.key==="Enter") setPassword(); }}),
                  React.createElement("button",{className:"team-add",disabled:pwBusy||pw.length<8,onClick:setPassword},
                    pwBusy?"Saving...":"Set password"))),
              React.createElement("div",{className:"invite-actions"},
                React.createElement("button",{className:"team-add invite-open",onClick:onOpen},isShow?"Open the Show":"Open the film"),
                React.createElement("button",{className:"invite-later",onClick:onClose},"Later")))
          : React.createElement(React.Fragment,null,
              React.createElement("div",{className:"team-note"},
                "This invitation is no longer active for this account. Either it was withdrawn, or you're signed in as "+
                (sessionEmail||"a different address")+" while the invitation was sent to another email \u2014 sign in with the invited address."),
              React.createElement("div",{className:"invite-actions"},
                React.createElement("button",{className:"team-add",onClick:onClose},"OK"))))));
}
window.InviteWelcome = InviteWelcome;

/* Who invited me, for the landing surface. Prefer the fresh claim row (since the relaunch
   every invite is linked by the invitee's own confirmed sign-in, so the claim names it). An
   invite linked earlier returns nothing from the claim — fall back to the inviter the
   invitation stamped onto the account's metadata, but only when it plausibly refers to THIS
   film (title match); otherwise stay generic rather than naming the wrong person. */
function teamInviteInviter(claim, userMeta, film){
  if(claim && claim.invited_by) return claim.invited_by;
  const um = userMeta || {};
  if(film && um.turn_invited && um.invited_by && String(um.invited_project||"")===String(film.title||""))
    return um.invited_by;
  return null;
}
window.teamInviteInviter = teamInviteInviter;

function TeamButton({ projectId, projectTitle, projectMeta, series, onChanged, isAdmin, sharing }){
  const [open, setOpen] = React.useState(false);
  // sharing switched off (or not loaded yet): everyone but the admin gets the "Soon" button below
  const live = teamWindowAllowed(isAdmin, sharing);
  const shared = projectMeta && projectMeta.isShared;
  const hint = !live ? TEAM_SOON_TEXT
    : shared
    ? ((series?"Show shared with you":"Shared with you")+" · "+teamRoleLabel(projectMeta.shareRole))
    : (series?"Show team · shared Bible and all episodes":"Team collaboration");
  // 2026-09-28 (Round 1): a phone (≤700px) hides this button with the other plain top-bar
  // buttons, so while it is up for a film it registers itself for the top bar's ⋯ menu
  // (chrome.jsx OverflowMenu), which then offers "Team" and opens this same window.
  // While sharing is switched off a non-admin's entry is { soon:true, notify } — no `open`: the
  // ⋯ menu shows it with the same "Soon" chip, and a tap only shows the notice.
  React.useEffect(()=>{
    if(!projectId) return;
    const entry = live ? { open:()=>setOpen(true), hint } : { soon:true, hint, notify:teamSoonNotice };
    window.turnTeamMenu = entry;
    return ()=>{ if(window.turnTeamMenu===entry) window.turnTeamMenu = null; };
  },[projectId, hint, live]);
  if(!projectId) return null;
  if(!live) return React.createElement("button",{type:"button",className:"tb-btn team-soon",
      "aria-disabled":"true","aria-label":"Team (coming soon)","aria-describedby":"team-soon-tip",
      onClick:teamSoonNotice},
    React.createElement(Icon.user,{s:14}),"Team",
    React.createElement("span",{className:"soon-chip","aria-hidden":"true"},"Soon"),
    // the tooltip: CSS shows it on hover and on keyboard focus (styles.css .team-soon-tip)
    React.createElement("span",{className:"team-soon-tip",id:"team-soon-tip",role:"tooltip"},TEAM_SOON_TEXT));
  return React.createElement(React.Fragment,null,
    React.createElement("button",{className:"tb-btn",onClick:()=>setOpen(true),title:hint},
      React.createElement(Icon.user,{s:14}),"Team"),
    open && React.createElement(TeamModal,{projectId,projectTitle,projectMeta,series,onChanged,isAdmin,sharing:live,onClose:()=>setOpen(false)}));
}

/* PRESENCE DOTS — who else has this film open right now, shown beside the Team button.
   Only renders when someone OTHER than this window is here, so a solo writer sees nothing.
   Two entries for the same email means that person has it open twice (their own second
   window) — worth surfacing, since same-section edits from two windows still resolve
   last-writer-wins. */
function PresenceDots({ people }){
  const others = (people||[]).filter(p=>!p.isSelf);
  if(!others.length) return null;
  const label = (p)=> String(p.name || "Collaborator");
  const initial = (p)=> (label(p).trim()[0] || "?").toUpperCase();
  // who someone is includes what they may DO here — show the role with the name
  const roleBit = (p)=> p.role==="owner" ? "Owner" : (p.role ? teamRoleLabel(p.role) : "");
  const me = (people||[]).find(p=>p.isSelf) || {};
  // the same person in another window: presence carries the account id, never an email (2026-10-03)
  const myEmail = String(me.uid || me.email || "").toLowerCase();
  const shown = others.slice(0,4);
  const extra = others.length - shown.length;
  const describe = (p)=>{
    const same = String(p.uid||p.email||"").toLowerCase()===myEmail && myEmail;
    const r = roleBit(p);
    return label(p) + (r ? " \u00b7 "+r : "") + (same ? " (your other window)" : "");
  };
  const title = "In this film now: " + others.map(describe).join(", ");
  return React.createElement("div",{className:"presence-dots",title},
    shown.map((p,i)=>{
      const same = String(p.uid||p.email||"").toLowerCase()===myEmail && myEmail;
      return React.createElement("span",{key:p.key||i,title:describe(p),
        className:"presence-dot"+(same?" self-other":""),},initial(p));
    }),
    extra>0 && React.createElement("span",{className:"presence-dot more"},"+"+extra));
}
window.PresenceDots = PresenceDots;

/* THE OWNER'S BELL (owner 2026-10-03: "show project owner when invited user has accepted
   invitation … add the notification bell icon at the top"). In the studio's top bar and on Home:
   a badge counts joins the owner hasn't seen; the list says who joined which film as what, and
   when; a click opens that film. Opening the list marks everything seen (on the server, so every
   device agrees). A join that lands while the app is open also gets a one-line notice. */
function teamAgo(at, now){
  const s = Math.max(0, Math.round(((now||Date.now()) - Date.parse(at||0))/1000));
  if(s < 60) return "just now";
  const m = Math.round(s/60); if(m < 60) return m+" min ago";
  const h = Math.round(m/60); if(h < 24) return h+" hour"+(h===1?"":"s")+" ago";
  const d = Math.round(h/24); return d+" day"+(d===1?"":"s")+" ago";
}
function TeamNotifications({ enabled, onOpenFilm, variant }){
  const [items, setItems] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const known = React.useRef(null);
  const ref = React.useRef(null);
  const load = React.useCallback(async ()=>{
    if(!enabled || typeof window.cloudTeamNotifications!=="function") return;
    const list = await window.cloudTeamNotifications();
    // a join that arrived while the app is open: say it once
    if(known.current){
      const fresh = list.filter(n=>!n.seen && !known.current.has(n.id));
      if(fresh.length && typeof window.appToast==="function")
        window.appToast(fresh.length===1
          ? fresh[0].email+" joined \u201c"+(fresh[0].title||"your film")+"\u201d as "+teamRoleLabel(fresh[0].role)+"."
          : fresh.length+" people joined your films.", "success");
    }
    known.current = new Set(list.map(n=>n.id));
    setItems(list);
  },[enabled]);
  React.useEffect(()=>{
    if(!enabled) return;
    load();
    const tick = setInterval(()=>{ try{ if(document.visibilityState!=="hidden") load(); }catch(e){} }, 120000);
    const onFocus = ()=>load();
    window.addEventListener("focus", onFocus);
    return ()=>{ clearInterval(tick); window.removeEventListener("focus", onFocus); };
  },[enabled, load]);
  React.useEffect(()=>{
    if(!open) return;
    const h = (e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = (e)=>{ if(e.key==="Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return ()=>{ document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  },[open]);
  if(!enabled) return null;
  const unseen = items.filter(n=>!n.seen).length;
  const toggle = ()=>{
    const next = !open; setOpen(next);
    if(next && unseen && typeof window.cloudTeamNotificationsSeen==="function"){
      window.cloudTeamNotificationsSeen();
      setItems(list=>list.map(n=>({ ...n, seen:true, wasNew:!n.seen })));
    }
  };
  const now = Date.now();
  return React.createElement("div",{className:"notify-wrap",ref},
    React.createElement("button",{type:"button",className:(variant==="home"?"hd-tbtn":"tb-btn")+" notify-btn"+(unseen?" has-new":""),
      onClick:toggle,"aria-haspopup":"dialog","aria-expanded":open?"true":"false",
      "aria-label":"Notifications"+(unseen?", "+unseen+" new":""),title:"Notifications"},
      React.createElement(Icon.bell,{s:15}),
      unseen>0 && React.createElement("span",{className:"notify-badge","aria-hidden":"true"}, unseen>9?"9+":String(unseen))),
    open && React.createElement("div",{className:"notify-pop",role:"dialog","aria-label":"Notifications"},
      React.createElement("div",{className:"notify-h"},"Notifications"),
      items.length
        ? items.map(n=>React.createElement("button",{key:n.id,type:"button",className:"notify-item"+(n.wasNew||!n.seen?" new":""),
            onClick:()=>{ setOpen(false); if(onOpenFilm && n.projectId) onOpenFilm(n.projectId); }},
            React.createElement("span",{className:"notify-ic"},React.createElement(Icon.user,{s:13})),
            React.createElement("span",{className:"notify-t"},
              React.createElement("span",{className:"notify-line"},
                React.createElement("b",null,n.email)," joined \u201c"+(n.title||"Untitled film")+"\u201d as "+teamRoleLabel(n.role)+"."),
              React.createElement("span",{className:"notify-when"},teamAgo(n.at, now)))))
        : React.createElement("div",{className:"notify-empty"},"When someone accepts an invite to one of your films, you'll see it here.")));
}
window.TeamNotifications = TeamNotifications;
window.teamAgo = teamAgo;

window.TEAM_ROLES = TEAM_ROLES;
window.teamRoleLabel = teamRoleLabel;
window.teamRoleBlurb = teamRoleBlurb;
window.TeamModal = TeamModal;
window.TeamButton = TeamButton;

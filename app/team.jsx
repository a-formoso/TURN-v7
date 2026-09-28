/* team.jsx — project collaboration UI.
   First collaboration layer: project owners can invite collaborators by email and
   assign a role. Shared projects appear in the collaborator's project switcher
   once supabase/team-collaboration.sql has been run. */

/* Exactly THREE collaborator roles (the old "Producer/admin" was removed by user
   decision — it promised team management it never had, and was unrestricted while
   the others were scoped). Each role carries its plain-language permission blurb;
   the panel shows these wherever a role is chosen so nobody has to guess.
   DISPLAY vs ID (owner decision 2026-09-28): the "writer" role is SHOWN as "Co-writer" so it
   no longer reads like the Writer plan. The id "writer", the stored role values and the
   section map below are unchanged. */
const TEAM_ROLES = [
  { id:"view_only", label:"View-only", blurb:"Opens and reads the film. Cannot save any change." },
  { id:"writer", label:"Co-writer", blurb:"Saves story work \u2014 spine, scenes, beats, script and continuity. Art Room changes aren't saved." },
  { id:"art_director", label:"Art director", blurb:"Saves Art Room work \u2014 cast, props, locations, lookbook and shots. Story and script aren't saved." },
];
function teamRoleLabel(id){
  const r = TEAM_ROLES.find(x=>x.id===id);
  return r ? r.label : (id ? "Legacy role" : "Role unavailable");
}
function teamRoleBlurb(id){
  const r = TEAM_ROLES.find(x=>x.id===id);
  return r ? r.blurb : (id
    ? "This role no longer exists \u2014 pick one of the three roles to restore this collaborator's access."
    : "The current collaborator role couldn't be verified. Access is read-only until the owner assigns View-only, Co-writer or Art director.");
}
function teamScopedRoleBlurb(id, series){
  if(!series) return teamRoleBlurb(id);
  if(id==="view_only") return "Opens and reads the Show's shared Bible and all existing and future episodes. Cannot save any change.";
  if(id==="writer") return "Saves story work across the Show's existing and future episodes \u2014 spine, scenes, beats, script and continuity. The shared Bible is readable; Art Room changes aren't saved.";
  if(id==="art_director") return "Saves the Show's shared Bible and Art Room work across all existing and future episodes \u2014 cast, props, locations, lookbook and shots. Story and script changes aren't saved.";
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
  return false;
}
/* plain-language name for what a role may NOT touch, for the "that wasn't saved" notice */
function teamRoleScopeNote(role){
  if(role==="writer") return "Your Co-writer role covers the story, script and beats — Art Room changes (cast, props, locations, lookbook, shots) aren't saved.";
  if(role==="art_director") return "Your Art director role covers the Art Room — story and script changes aren't saved.";
  if(role==="" || (role && role!=="view_only" && !TEAM_ROLES.find(r=>r.id===role)))
    return "Your role on this film is missing or from an older version of the app, so changes aren't saved. Ask the owner to reassign you a current role (View-only, Co-writer or Art director).";
  return "";
}
window.TEAM_ROLE_SECTIONS = TEAM_ROLE_SECTIONS;
window.teamCanWriteSection = teamCanWriteSection;
window.teamCanWriteRoom = teamCanWriteRoom;
window.teamRoleScopeNote = teamRoleScopeNote;

function teamCanManage(projectMeta){
  return !!(projectMeta && (projectMeta.isOwner || window.turnIsAdmin));
}

function TeamModal({ projectId, projectTitle, projectMeta, series, onClose, onChanged }){
  const [members, setMembers] = React.useState([]);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("writer");
  const [busy, setBusy] = React.useState("");
  const [schemaMissing, setSchemaMissing] = React.useState(!!window.turnTeamSchemaMissing);
  const canManage = teamCanManage(projectMeta);
  const showTitle = projectTitle || "Untitled Show";
  const scopedRoleBlurb = id=>teamScopedRoleBlurb(id,!!series);
  const load = React.useCallback(async ()=>{
    if(!projectId || typeof window.cloudListProjectMembers!=="function"){ setMembers([]); return; }
    setMembers(await window.cloudListProjectMembers(projectId));
    setSchemaMissing(!!window.turnTeamSchemaMissing);
  },[projectId]);
  React.useEffect(()=>{ load(); },[load]);
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  const invite = async ()=>{
    if(!canManage || schemaMissing) return;
    setBusy("invite");
    const addr = email.trim().toLowerCase();
    const res = await window.cloudInviteProjectMember(projectId, email, role);
    setBusy("");
    if(res && res.ok){
      setEmail("");
      await load();
      if(onChanged) onChanged();
      // the grant and the email are separate outcomes — never claim "sent" when
      // only the row was written
      if(window.appToast){
        if(res.emailSent) window.appToast(series
          ? "Invitation to Show \u201c"+showTitle+"\u201d emailed to "+addr+"."
          : "Invitation emailed to "+addr+".","success");
        else window.appToast(series
          ? "Collaborator added to Show \u201c"+showTitle+"\u201d, but "+(res.emailNote||"the invitation email could not be sent.")+" They'll still have access to its shared Bible and all existing and future episodes when they sign in with this address."
          : "Collaborator added, but "+(res.emailNote||"the invitation email could not be sent.")+" They'll still see the film when they sign in with this address.","error");
      }
    } else {
      if(res && res.setup) setSchemaMissing(true);
      if(window.appToast) window.appToast((res&&res.message)||"Could not add collaborator.","error");
    }
  };
  const updateRole = async (m, nextRole)=>{
    if(!canManage) return;
    setBusy("role:"+m.id);
    const res = await window.cloudUpdateProjectMember(m.id, { role:nextRole }, projectId);
    setBusy("");
    if(res && res.ok){ await load(); if(onChanged) onChanged(); }
    else if(window.appToast) window.appToast((res&&res.message)||"Could not update role.","error");
  };
  const remove = async (m)=>{
    if(!canManage) return;
    const ok = !window.appConfirm || await window.appConfirm({
      title:series ? "Remove collaborator from this Show?" : "Remove collaborator?",
      body:series
        ? "This ends "+m.member_email+"'s access to Show \u201c"+showTitle+"\u201d, its shared Bible and all existing and future episodes immediately \u2014 if they have one open they'll be told their access ended. You can re-invite them later."
        : "This ends "+m.member_email+"'s access to \""+(projectTitle||"this project")+"\" immediately \u2014 if they have it open they'll be told their access ended. You can re-invite them later.",
      confirmLabel:series ? "Remove Show access" : "Remove",
      danger:true
    });
    if(!ok) return;
    setBusy("remove:"+m.id);
    const res = await window.cloudRemoveProjectMember(m.id, m.project_id);
    setBusy("");
    if(res && res.ok){ await load(); if(onChanged) onChanged(); }
    else if(window.appToast) window.appToast((res&&res.message)||"Could not remove collaborator.","error");
  };
  return React.createElement("div",{className:"bible-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal team-modal"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement(Icon.user,{s:15}),"Team",
          React.createElement("span",{className:"bible-sub"},series ? ("Show \u00b7 "+showTitle) : (projectTitle||"Current project"))),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"team-body"},
        React.createElement("div",{className:"team-note"},
          schemaMissing
            ? "Team collaboration is ready in the app, but the Supabase migration has not been run yet. Run supabase/team-collaboration.sql, then reopen this panel."
            : canManage
            ? (series
              ? "One team applies to Show \u201c"+showTitle+"\u201d. Each collaborator's access covers its shared Bible and all existing and future episodes. Add them by email and choose what each may do \u2014 the invitation link opens this Show by name."
              : "Your subscription includes your seat. Add collaborators by email and choose what each may do \u2014 they get an invitation email with a link that signs them in and opens this film.")
            : (series
              ? "This Show was shared with you. One access grant covers its shared Bible and all existing and future episodes. You can work here according to the role the owner assigned"+
                (projectMeta && projectMeta.shareRole ? (": "+teamRoleLabel(projectMeta.shareRole)+" \u2014 "+(scopedRoleBlurb(projectMeta.shareRole)||"")) : ".")
              : "This project was shared with you. You can work here according to the role the owner assigned"+
                (projectMeta && projectMeta.shareRole ? (": "+teamRoleLabel(projectMeta.shareRole)+" \u2014 "+(teamRoleBlurb(projectMeta.shareRole)||"")) : "."))),
        canManage && React.createElement("div",{className:"team-invite"},
          React.createElement("input",{className:"team-email",type:"email",value:email,placeholder:"teammate@example.com",
            disabled:schemaMissing,onChange:e=>setEmail(e.target.value),onKeyDown:e=>{ if(e.key==="Enter" && email.trim()) invite(); }}),
          React.createElement("select",{className:"team-role",value:role,disabled:schemaMissing,onChange:e=>setRole(e.target.value)},
            TEAM_ROLES.map(r=>React.createElement("option",{key:r.id,value:r.id,title:scopedRoleBlurb(r.id)},r.label))),
          React.createElement("button",{className:"team-add",disabled:schemaMissing||busy==="invite"||!email.trim(),onClick:invite},
            React.createElement(Icon.plus,{s:13}),busy==="invite"?"Adding...":"Add")),
        // what the selected role allows, in plain language, right where it's being chosen
        canManage && !schemaMissing && React.createElement("div",{className:"team-role-blurb"},
          teamRoleLabel(role)+" \u2014 "+scopedRoleBlurb(role)),
        React.createElement("div",{className:"team-seats"},
          React.createElement("div",{className:"team-seat owner"},
            React.createElement("div",{className:"team-avatar"},React.createElement(Icon.user,{s:14})),
            React.createElement("div",{className:"team-member-main"},
              React.createElement("div",{className:"team-member-email"},series ? "Show owner" : "Project owner"),
              React.createElement("div",{className:"team-member-role",
                title:series
                  ? "Edits the shared Bible and every episode, invites and removes collaborators, changes roles, and renames or deletes the Show."
                  : "Edits everything, invites and removes collaborators, changes roles, renames or deletes the film."},
                series ? "Owner \u2014 edits everything; only seat that manages the Show team" : "Owner \u2014 edits everything; only seat that manages the team"))),
          members.length
            ? members.map(m=>{
                const legacy = !!(m.role && !TEAM_ROLES.find(r=>r.id===m.role));
                return React.createElement("div",{className:"team-seat",key:m.id},
                React.createElement("div",{className:"team-avatar"},React.createElement(Icon.mail,{s:14})),
                React.createElement("div",{className:"team-member-main"},
                  React.createElement("div",{className:"team-member-email"},m.member_email),
                  React.createElement("div",{className:"team-member-role",title:scopedRoleBlurb(m.role)},
                    teamRoleLabel(m.role)+(legacy?" \u2014 pick a current role to restore access":""))),
                canManage
                  ? React.createElement("div",{className:"team-member-actions"},
                      React.createElement("select",{className:"team-role compact",value:m.role||"writer",disabled:!!busy,
                        title:scopedRoleBlurb(m.role),
                        onChange:e=>updateRole(m,e.target.value)},
                        // a legacy value (e.g. the retired producer/admin) still renders,
                        // clearly marked, so the owner can move the member off it
                        legacy && React.createElement("option",{value:m.role,disabled:true},"Legacy role"),
                        TEAM_ROLES.map(r=>React.createElement("option",{key:r.id,value:r.id,title:scopedRoleBlurb(r.id)},r.label))),
                      React.createElement("button",{className:"team-remove",disabled:!!busy,title:"Remove collaborator",onClick:()=>remove(m)},
                        React.createElement(Icon.trash,{s:13})))
                  : React.createElement("span",{className:"team-badge",title:scopedRoleBlurb(m.role)},teamRoleLabel(m.role)));
              })
            : React.createElement("div",{className:"team-empty"},"No collaborators yet.")),
        React.createElement("div",{className:"team-foot"},
          schemaMissing
            ? "Setup needed: run the team collaboration SQL once in Supabase so the table and access policies exist."
            : (series
              ? "Only the Show owner can invite or remove collaborators, change roles, rename the Show or delete it. One team grant applies to the shared Bible and all existing and future episodes. A collaborator who edits outside their role sees a notice that those changes weren't saved."
              : "Only the owner can invite or remove collaborators, change roles, rename the film or delete it. A collaborator who edits outside their role sees a notice that those changes weren't saved.")))));
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
          React.createElement(Icon.mail,{s:15}), film ? (isShow?"You've been added to a Show":"You've been added to a film") : "Invitation not active"),
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
                (sessionEmail||"a different address")+" while the invitation was sent to another email \u2014 sign in with the invited address, or ask the person who invited you to re-send it."),
              React.createElement("div",{className:"invite-actions"},
                React.createElement("button",{className:"team-add",onClick:onClose},"OK"))))));
}
window.InviteWelcome = InviteWelcome;

/* Who invited me, for the landing surface. Prefer the fresh claim row (existing-
   account path). Invite-CREATED accounts were linked to the member row by the Edge
   Function before their first sign-in, so the claim returns nothing for them — fall
   back to the inviter the invitation stamped onto the account's metadata, but only
   when it plausibly refers to THIS film (title match); otherwise stay generic
   rather than naming the wrong person. */
function teamInviteInviter(claim, userMeta, film){
  if(claim && claim.invited_by) return claim.invited_by;
  const um = userMeta || {};
  if(film && um.turn_invited && um.invited_by && String(um.invited_project||"")===String(film.title||""))
    return um.invited_by;
  return null;
}
window.teamInviteInviter = teamInviteInviter;

function TeamButton({ projectId, projectTitle, projectMeta, series, onChanged }){
  const [open, setOpen] = React.useState(false);
  const shared = projectMeta && projectMeta.isShared;
  const hint = shared
    ? ((series?"Show shared with you":"Shared with you")+" · "+teamRoleLabel(projectMeta.shareRole))
    : (series?"Show team · shared Bible and all episodes":"Team collaboration");
  // 2026-09-28 (Round 1): a phone (≤700px) hides this button with the other plain top-bar
  // buttons, so while it is up for a film it registers itself for the top bar's ⋯ menu
  // (chrome.jsx OverflowMenu), which then offers "Team" and opens this same window.
  React.useEffect(()=>{
    if(!projectId) return;
    const entry = { open:()=>setOpen(true), hint };
    window.turnTeamMenu = entry;
    return ()=>{ if(window.turnTeamMenu===entry) window.turnTeamMenu = null; };
  },[projectId, hint]);
  if(!projectId) return null;
  return React.createElement(React.Fragment,null,
    React.createElement("button",{className:"tb-btn",onClick:()=>setOpen(true),title:hint},
      React.createElement(Icon.user,{s:14}),"Team"),
    open && React.createElement(TeamModal,{projectId,projectTitle,projectMeta,series,onChanged,onClose:()=>setOpen(false)}));
}

/* PRESENCE DOTS — who else has this film open right now, shown beside the Team button.
   Only renders when someone OTHER than this window is here, so a solo writer sees nothing.
   Two entries for the same email means that person has it open twice (their own second
   window) — worth surfacing, since same-section edits from two windows still resolve
   last-writer-wins. */
function PresenceDots({ people }){
  const others = (people||[]).filter(p=>!p.isSelf);
  if(!others.length) return null;
  const label = (p)=> String(p.name || p.email || "Collaborator");
  const initial = (p)=> (label(p).trim()[0] || "?").toUpperCase();
  // who someone is includes what they may DO here — show the role with the name
  const roleBit = (p)=> p.role==="owner" ? "Owner" : (p.role ? teamRoleLabel(p.role) : "");
  const me = (people||[]).find(p=>p.isSelf) || {};
  const myEmail = String(me.email || "").toLowerCase();
  const shown = others.slice(0,4);
  const extra = others.length - shown.length;
  const describe = (p)=>{
    const same = String(p.email||"").toLowerCase()===myEmail && myEmail;
    const r = roleBit(p);
    return label(p) + (r ? " \u00b7 "+r : "") + (same ? " (your other window)" : "");
  };
  const title = "In this film now: " + others.map(describe).join(", ");
  return React.createElement("div",{className:"presence-dots",title},
    shown.map((p,i)=>{
      const same = String(p.email||"").toLowerCase()===myEmail && myEmail;
      return React.createElement("span",{key:p.key||i,title:describe(p),
        className:"presence-dot"+(same?" self-other":""),},initial(p));
    }),
    extra>0 && React.createElement("span",{className:"presence-dot more"},"+"+extra));
}
window.PresenceDots = PresenceDots;

window.TEAM_ROLES = TEAM_ROLES;
window.teamRoleLabel = teamRoleLabel;
window.teamRoleBlurb = teamRoleBlurb;
window.TeamModal = TeamModal;
window.TeamButton = TeamButton;

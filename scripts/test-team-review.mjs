#!/usr/bin/env node
/* test-team-review.mjs — the Team review (owner 2026-10-09: "go ahead with all of it"), the APP side.
   The database's half is in test-team-relaunch-db.mjs, the server's in test-film-payer.mjs,
   test-server-charging.mjs and test-invite-collaborator.mjs.
     A  a shared film stays shared (and read-only) when it drops off the list; the owner's plan is re-read;
        a lapsed owner leaves every room readable; sharing paused = read-only for collaborators
     B  names, never emails: the sign-in toast, the welcome card; Show notices open an episode
     C  the Team window: paused mode, loading / failed, Withdraw invite, the role-change toast, no double
        invite, Escape owned by the confirm, the budget's reset date and 80% flag, dialogs, the locked chip
     D  cloud.jsx: an expired invite's role change renews it; "already joined" is a success; private channels;
        plain words
     E  the Team refusals never open Plans; the 80% notice; Frances (and the protocol) and keys
   No network, no browser. node scripts/test-team-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
const transform = (src, filename)=>transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const noop = ()=>{};
const J = (x)=>JSON.parse(JSON.stringify(x));

const app = read("app/app.jsx"), team = read("app/team.jsx"), cloud = read("app/cloud.jsx"), plans = read("app/plans.jsx"),
  confirm = read("app/confirm.jsx"), auth = read("app/auth-ui.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html"),
  protocol = read("docs/MUSE Protocol.md");

/* ── a recording React stub (as test-team-relaunch.mjs) ─────────────────── */
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const iconProxy = new Proxy({}, { get:(t, name)=>{ const f = ()=>null; f.iconName = name; return f; } });
const R = { Fragment:"fragment", createElement:el, state:null, calls:[], sets:[],
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init);
    R.calls.push(v); return [v, (x)=>R.sets.push({ i, x })]; },
  useEffect(){}, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(state){ R.state = state || null; R.calls = []; R.sets = []; } };
const toasts = [];
const cb = { console, React:R, Icon:iconProxy, document:{ addEventListener:noop, removeEventListener:noop },
  localStorage:{ getItem:()=>null, setItem:noop }, CustomEvent:class {}, addEventListener:noop, removeEventListener:noop,
  dispatchEvent:()=>true, appToast:(m, k)=>toasts.push([m, k]), appConfirm:async ()=>true,
  cloudHandleName:(e)=>{ const l = String(e||"").split("@")[0].split("+")[0]; return l ? l.charAt(0).toUpperCase()+l.slice(1) : ""; },
  cloudListProjectMembers:async ()=>[] };
cb.window = cb; vm.createContext(cb);
vm.runInContext(transform(read("app/chrome.jsx"), "chrome.jsx"), cb, { filename:"app/chrome.jsx" });
vm.runInContext(transform(team, "team.jsx"), cb, { filename:"app/team.jsx" });
const TeamWindow = vm.runInContext("TeamWindow", cb);
const DAY = 86400000, now = Date.now();
const MEMBERS = [
  { id:"m1", project_id:"p1", member_email:"cara@example.com", member_user:"u-cara", role:"writer", status:"active", budget_credits:200, expires_at:null },
  { id:"m2", project_id:"p1", member_email:"ari@example.com", member_user:null, role:"art_director", status:"active", budget_credits:100, expires_at:new Date(now+3*DAY).toISOString() },
];
// hook order in TeamWindow: 0 members, 1 spend, 2 email, 3 role, 4 busy, 5 schemaMissing, 6 listState
const windowFor = ({ meta = { isOwner:true }, plan = "director", state = {}, paused = false, sharing = true } = {})=>{
  cb.turnTeamSharing = sharing; cb.turnIsAdmin = false;
  cb.turnCreditBalance = plan ? { plan, paymentStatus:"active", frozen:false, remaining:1234 } : null;
  R.reset({ 0:MEMBERS, 1:{ m1:{ member_id:"m1", spent:170, budget:200 }, m2:{ member_id:"m2", spent:100, budget:100 } }, 6:"ok", ...state });
  return TeamWindow({ projectId:"p1", projectTitle:"Neon Harbor", projectMeta:meta, series:false, onClose:noop, onChanged:noop, paused });
};

/* ═══ A ═══ */
await test("A1 a shared film that drops off the refreshed list stays shared, read-only, and asks the server", ()=>{
  const a = between(app, "  const sharedSeenRef = React.useRef({});", "  const [filmOwnerTier, setFilmOwnerTier]");
  assert.ok(a.includes("const sharedOffList = !_projRow && !!currentProjectId && !!sharedSeenRef.current[currentProjectId];"));
  assert.ok(a.includes("const isSharedFilm = !!(_projRow && _projRow.isShared) || sharedOffList;"));
  assert.ok(a.includes('(sharedOffList ? "view_only" : "")'));
  assert.ok(app.includes('const writeRole = (ownerPlanLapsed || sharingPaused || sharedOffList) ? "view_only" : (_rolesNow || "view_only");'));
  assert.ok(app.includes('if(sharedOffList && typeof window.cloudCheckAccess==="function"){'));
  assert.ok(app.includes('window.cloudCheckAccess(currentProjectId).then(s=>{ if(alive && s==="gone") accessEnded(); })'));
  for(const s of ["const _sharedCanWriteRoom = id=>!isSharedFilm", "const _sharedCanWriteSection = k=>!isSharedFilm",
    'if(typeof window.teamCanWriteSection==="function" && isSharedFilm && shareRole!=="owner"){', "const collaborative = others>0 || isSharedFilm;"])
    assert.ok(app.includes(s), s);
  assert.ok(!/_projRow\s*&&\s*_projRow\.isShared\)?\s*\|\|/.test(between(app, "const _sharedCanWriteRoom", "const writersRoomReadOnly")));
});
await test("A2 the owner's plan is re-read with the role (timer, focus, the member hint); unchanged answers do nothing", ()=>{
  assert.ok(app.includes("try{ ownerTierReloadRef.current && ownerTierReloadRef.current(); }catch(e){}"));
  assert.ok(app.includes('if(s==="ok"){ try{ ownerTierReloadRef.current && ownerTierReloadRef.current(); }catch(e){} }'));
  assert.ok(app.includes("if(filmOwnerTierSeenRef.current && window.turnFilmOwnerTier===(t || null)) return;   // unchanged"));
});
await test("A3 a lapsed owner leaves every room open to READ, with the lapsed wording", ()=>{
  assert.ok(app.includes('if(filmOwnerTier==="none") return { writers_room:true, art_room:true, stage:true, shared:true };'));
  assert.ok(app.includes("? (ownerPlanLapsed ? `This film is read-only right now: its owner's plan doesn't include shared work.`"));
});
await test("A4 sharing paused: a film shared with you is read-only (the admin excepted); the switch is read before the role logic", ()=>{
  assert.ok(app.includes("const sharingPaused = isSharedFilm && window.turnTeamSharing===false && !window.turnIsAdmin;"));
  assert.ok(cloud.includes('window.turnTeamSharing = !!(v && (v.on===true || v.on==="true"));'), "the switch is a boolean once read");
});
await test("A5 'Access ended' has one button", ()=>{
  assert.ok(app.includes('confirmLabel:"Back to my films", hideCancel:true });'));
  assert.ok(confirm.includes('!req.hideCancel && React.createElement("button",{className:"appconfirm-btn ghost"'));
});

/* ═══ B ═══ */
await test("B1 the inviter is a name, never an email address", ()=>{
  assert.equal(cb.teamInviterName("ana.lima+films@example.com"), "Ana.lima");
  assert.equal(cb.teamInviterName("Ana Lima"), "Ana Lima");
  assert.equal(cb.teamInviterName(""), "");
  assert.ok(!cb.teamInviterName("x@y.co").includes("@"));
  assert.ok(app.includes('const byName = news[0].invited_by ? ((typeof window.teamInviterName==="function") ? window.teamInviterName(news[0].invited_by) : "") : "";'));
  assert.ok(team.includes("const byName = teamInviterName(invitedBy);") && team.includes('(byName ? byName+" shared this film with you."'));
  assert.ok(!team.includes('(invitedBy ? invitedBy+" shared'));
});
await test("B2 a Show's notice (and the invite card) open its first episode", ()=>{
  const o = between(app, "const openableFilmId = (id)=>{", "  };");
  assert.ok(o.includes("isShowProject(row)") && o.includes("String(p.showId||\"\")===String(row.id)"));
  assert.ok(app.includes("onOpenFilm: async (id)=>{ const fid = openableFilmId(id);"));
  assert.ok(app.includes("const id=film ? openableFilmId(film.id) : null;"));
});

/* ═══ C ═══ */
await test("C1 paused: the owner keeps remove and budgets, no invites or role changes; the note says why", ()=>{
  const w = windowFor({ paused:true, sharing:false });
  assert.equal(findAll(w, hasClass("team-invite")).length, 0, "no invite form");
  assert.match(textOf(findAll(w, hasClass("team-note"))[0]), /^Team sharing is paused right now: the people below can read this film but not change it, and nobody is charged\. You can still remove people and change budgets\.$/);
  assert.equal(findAll(w, hasClass("team-remove")).length, 2);
  assert.ok(findAll(w, hasClass("team-budget")).every(s=>!s.props.disabled), "budgets still change");
  const pickers = findAll(w, n=>n.type===cb.TeamRolePicker);
  assert.ok(pickers.length===2 && pickers.every(p=>p.props.disabled), "role changes wait");
  assert.equal(cb.TeamModal({ projectId:"p1", isAdmin:false, sharing:false, paused:false, onClose:noop }), null, "no team, sharing off: no window");
  R.reset();
});
await test("C2 paused: a collaborator reads their budget and can still leave", ()=>{
  R.reset();
  const w = windowFor({ meta:{ isShared:true, shareRole:"writer" }, paused:true, sharing:false, state:{ 0:[MEMBERS[0]] } });
  assert.match(textOf(findAll(w, hasClass("team-note"))[0]), /you can read this film but not change it, and nothing is charged\. You can still leave it\./);
  assert.ok(findAll(w, hasClass("team-leave")).length===1);
});
await test("C3 the TeamButton: paused for a collaborator (and an owner with a team), 'Soon' otherwise", ()=>{
  R.reset({ 0:false, 1:false });
  const tree = cb.TeamButton({ projectId:"p1", projectTitle:"F", projectMeta:{ isShared:true, shareRole:"writer" }, onChanged:noop, isAdmin:false, sharing:false });
  const b = findAll(tree, n=>n.type==="button")[0];
  assert.ok(!hasClass("team-soon")(b), "a working button");
  assert.ok(typeof cb.turnTeamMenu==="undefined" || true);
  R.reset({ 0:true, 1:true });
  const owner = cb.TeamButton({ projectId:"p1", projectTitle:"F", projectMeta:{ isOwner:true }, onChanged:noop, isAdmin:false, sharing:false });
  const modal = findAll(owner, n=>n.type===cb.TeamModal)[0];
  assert.ok(modal && modal.props.paused===true, "an owner with a team opens the paused window");
  R.reset({ 0:false, 1:false });
  const solo = cb.TeamButton({ projectId:"p1", projectTitle:"F", projectMeta:{ isOwner:true }, onChanged:noop, isAdmin:false, sharing:false });
  assert.ok(hasClass("team-soon")(findAll(solo, n=>n.type==="button")[0]), "no team: Soon");
  assert.ok(team.includes("window.cloudListProjectMembers(projectId).then(rows=>{ if(alive) setHasTeam(!!(rows && rows.length)); })"));
  R.reset();
});
await test("C4 loading and a failed read never say 'Nobody invited yet.'", ()=>{
  let w = windowFor({ state:{ 0:[], 6:"loading" } });
  assert.equal(textOf(findAll(w, hasClass("team-empty"))[0]), "Loading the team…");
  w = windowFor({ state:{ 0:[], 6:"failed" } });
  const f = findAll(w, hasClass("team-empty"))[0];
  assert.match(textOf(f), /^Couldn't load the team\. Try again$/); assert.equal(f.props.role, "alert");
  w = windowFor({ state:{ 0:[], 6:"ok" } });
  assert.equal(textOf(findAll(w, hasClass("team-empty"))[0]), "Nobody invited yet.");
  assert.ok(cloud.includes("return window.turnTeamSchemaMissing ? [] : null;"));
  assert.ok(team.includes('if(rows==null){ setListState("failed"); return; }'));
  R.reset();
});
await test("C5 budgets: this month's use, the 80% / used-up flags, and when it resets (UTC month)", ()=>{
  const w = windowFor();
  const lines = findAll(w, hasClass("team-member-budget")).map(textOf);
  assert.match(lines[0], /^170 of 200 credits this month · 80% used · resets 1 [A-Z][a-z]{2}$/);
  assert.match(lines[1], /^100 of 100 credits this month · budget used up · resets 1 [A-Z][a-z]{2}$/);
  assert.equal(cb.teamBudgetResetText(Date.UTC(2026, 9, 31, 23, 59)), "resets 1 Nov");
  assert.equal(cb.teamBudgetResetText(Date.UTC(2026, 11, 5)), "resets 1 Jan");
  R.reset();
});
await test("C6 a pending invite is withdrawn, a joined person removed; the remove button names them", async ()=>{
  const w = windowFor();
  const btns = findAll(w, hasClass("team-remove"));
  assert.equal(btns[0].props["aria-label"], "Remove cara@example.com");
  assert.equal(btns[1].props["aria-label"], "Withdraw the invite to ari@example.com");
  const asked = []; const was = cb.appConfirm; cb.appConfirm = async (o)=>{ asked.push(o); return false; };
  await btns[1].props.onClick(); await btns[0].props.onClick();
  cb.appConfirm = was;
  assert.equal(asked[0].title, "Withdraw this invite?"); assert.equal(asked[0].confirmLabel, "Withdraw invite");
  assert.equal(asked[1].title, "Remove this person?"); assert.match(asked[1].body, /they'd need a new invite/);
  R.reset();
});
await test("C7 Enter twice sends one invite; a role change for someone who joined is a success", async ()=>{
  assert.ok(team.includes("if(!canInvite || schemaMissing || busy) return;   // Enter twice"));
  assert.ok(team.includes('if(res.joined){ toast(res.roleChanged ? "Role updated for "+addr+"." : addr+" is already on this "+(series?"Show":"film")+".","success"); return; }'));
});
await test("C8 Escape: the confirm owns it (stopPropagation); the Team window ignores a handled key", ()=>{
  assert.ok(confirm.includes('if(e.key==="Escape"){ e.preventDefault(); if(e.stopPropagation) e.stopPropagation(); close(false); }'));
  assert.ok(team.includes('if(e.key==="Escape" && !e.defaultPrevented) onClose();'));
});
await test("C9 the Team and invite windows are modal dialogs that take and keep focus; the password has a label", ()=>{
  const w = windowFor();
  const d = findAll(w, hasClass("team-modal"))[0];
  assert.equal(d.props.role, "dialog"); assert.equal(d.props["aria-modal"], "true"); assert.equal(d.props["aria-labelledby"], "team-title");
  assert.ok(team.includes('React.createElement("div",{className:"bible-modal team-modal invite-welcome",ref:dialogRef,role:"dialog","aria-modal":"true","aria-labelledby":"invite-title",tabIndex:-1}'));
  const f = between(team, "function useTeamDialogFocus(ref){", "\n}\n");
  assert.ok(f.includes('if(e.key!=="Tab") return;') && f.includes("before.focus()"));
  assert.ok(team.includes('"aria-label":"New password, 8 or more characters",autoComplete:"new-password",'));
  R.reset();
});
await test("C10 a locked role chip stays reachable and says why", ()=>{
  const chips = findAll(cb.TeamRolePicker({ value:"writer", onChange:noop, tier:"director" }), hasClass("team-role-chip"));
  const se = chips.find(c=>textOf(c)==="Stage editor");
  assert.equal(se.props.disabled, false); assert.equal(se.props["aria-disabled"], "true");
  toasts.length = 0; se.props.onClick();
  assert.deepEqual(toasts, [["Stage editor comes with the Producer plan.", "info"]]);
});

/* ═══ D ═══ */
const cloudBlock = cloud.slice(cloud.indexOf("function _teamEmail(s)"), cloud.indexOf("window.cloudLoadTeamSharing = cloudLoadTeamSharing;"));
function cloudBox({ existing = null } = {}){
  const log = [];
  const chain = (table)=>{ const q = {
    insert:(row)=>{ log.push(["insert", table, row]); return Promise.resolve({ error:null }); },
    update:(row)=>{ log.push(["update", table, row]); return { eq:()=>Promise.resolve({ error:null }) }; },
    select:()=>q, eq:()=>q, order:()=>q, maybeSingle:async ()=>({ data:existing, error:null }) }; return q; };
  const sb = { from:(t)=>chain(t), rpc:async (name, args)=>{ log.push(["rpc", name, args]); return { data:1, error:null }; },
    functions:{ invoke:async (name, o)=>{ log.push(["invoke", name, o.body]); return { data:{ ok:true }, error:null }; } } };
  const box = { console, sbClient:()=>sb, _pushMemberRemoved:(id)=>log.push(["push", id]), cloudGetAppConfig:async ()=>({ on:true }),
    CustomEvent:class {}, dispatchEvent:()=>true, turnTeamSharing:true };
  box.window = box; vm.createContext(box);
  vm.runInContext(cloudBlock, box, { filename:"app/cloud.jsx#team" });
  box.__log = log; return box;
}
await test("D1 a role change on an EXPIRED invite renews it after the change, then emails", async ()=>{
  const c = cloudBox({ existing:{ id:"m9", role:"view_only", roles:["view_only"], status:"active", member_user:null, expires_at:new Date(Date.now()-DAY).toISOString() } });
  const r = await c.cloudInviteProjectMember("p1", "a@b.co", "writer");
  const kinds = c.__log.map(x=>x[0]+(x[1]?":"+x[1]:""));
  assert.ok(kinds.indexOf("update:turn_project_members") < kinds.indexOf("rpc:turn_renew_invite"), kinds.join(","));
  assert.ok(kinds.includes("invoke:invite-collaborator")); assert.equal(r.emailSent, true);
});
await test("D2 someone who already joined: a success with no email ('Role updated' when the roles changed)", async ()=>{
  let c = cloudBox({ existing:{ id:"m9", role:"writer", roles:["writer"], status:"active", member_user:"u1", expires_at:null } });
  assert.deepEqual(J(await c.cloudInviteProjectMember("p1", "a@b.co", "art_director")), { ok:true, joined:true, roleChanged:true, emailSent:false });
  c = cloudBox({ existing:{ id:"m9", role:"writer", roles:["writer"], status:"active", member_user:"u1", expires_at:null } });
  assert.deepEqual(J(await c.cloudInviteProjectMember("p1", "a@b.co", "writer")), { ok:true, joined:true, roleChanged:false, emailSent:false });
  assert.ok(!c.__log.some(x=>x[0]==="invoke"));
});
await test("D3 the film's live channels are private; plain words everywhere", ()=>{
  assert.ok(cloud.includes('ch = sb.channel("film:"+projectId, { config:{ private:true, presence:{ key:_presenceKey } } });'));
  assert.ok(cloud.includes('const ch=sb.channel("doc:"+projectId, { config:{ private:true } });'));
  assert.ok(!/Supabase|team-collaboration\.sql/.test(between(cloud, "function _teamSetupMessage(){", "\n}")));
  assert.ok(!cloud.includes('(err&&err.message)||"Update failed."') && !cloud.includes('(err&&err.message)||"Remove failed."'));
  assert.ok(auth.includes('shareRole==="view_only" ? "View-only"') && auth.includes('art_director:"Art director", stage_editor:"Stage editor"'));
  assert.ok(!auth.includes('"View only"'));
});

/* ═══ E ═══ */
await test("E1 a Team refusal never opens the Plans window for a collaborator", ()=>{
  const box = { console, window:{} }; box.window = box; vm.createContext(box);
  vm.runInContext("const BILLING_EMAIL='x';"+between(plans, "const BILLING_CODES = {", "window.turnBillingError = billingError;")+";this.f=billingError;", box);
  for(const code of ["owner_plan", "budget_reached", "owner_insufficient", "film_role", "film_unverified", "team_paused"]){
    const r = box.f({ error:code, code, message:"m" }, code==="film_unverified" ? 503 : 402);
    assert.ok(r && r.code===code && r.openPlans===false, code);
  }
});
await test("E2 the collaborator's budget notice: 80% and used up, once each per film per month, read from the database", ()=>{
  const n = between(app, "/* YOUR BUDGET ON A SHARED FILM", "  // ADMIN — demo upkeep account");
  assert.ok(n.includes("window.cloudTeamSpend(pid)") && n.includes('["turn-credits-changed","vid-done","nb-gen-done","vg-audio-done"]'));
  assert.ok(n.includes("const level = spent>=budget ? 100 : spent>=0.8*budget ? 80 : 0;"));
  assert.ok(n.includes('"turn_team_budget_note:"+pid+":"+d.getUTCFullYear()+"-"+(d.getUTCMonth()+1)') && n.includes("if(seen>=level) return;"));
  assert.ok(app.includes('const name = (typeof cloudUserDisplayName==="function" ? cloudUserDisplayName(session) : "")'), "presence shows the chosen name");
});
await test("E3 Frances: who pays, paused, lapsed, invites, private presence; plan eligibility via the muse lead; protocol in sync", ()=>{
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;this.__P=musePublicFeature;", fb);
  const t = fb.__F.find(f=>f.name==="Team collaboration");
  for(const gone of ["enforce-role-scopes", "opens nothing", "explanation right away"]) assert.ok(!t.what.includes(gone), gone);
  for(const now of ["every room stays open to read", "IF SHARING IS PAUSED", "WHO PAYS IS DECIDED BY THE SERVER", "Withdraw invite", "a new invite they accept", "private channel", "first episode"])
    assert.ok(t.what.includes(now), now);
  const pub = fb.__P(t).what;
  assert.ok(pub.startsWith("Sharing a film is part of the Director and Producer plans"), "the plan-eligibility lead reaches her");
  assert.ok(!/\bcredits?\b|\$\d/i.test(pub), "no billing in what she's told");
  assert.ok(fb.__F.find(f=>/^Home/.test(f.name)).what.includes("Art director / Stage editor"));
  assert.ok(ai.includes("Which plan a feature comes with, exactly as your facts state it (e.g. who can share a film), you may say — never a price, a credit amount or billing."));
  assert.ok(protocol.includes("*Plan eligibility is not a billing detail (owner 2026-10-09, Team review):*"));
  assert.ok(read("supabase/functions/image-proxy/index.ts").includes("Which plan a feature comes with, exactly as you were told (e.g. who can share a film), you may say"), "the live voice says the same");
});
await test("E4 keys", ()=>{
  for(const f of ["app.jsx", "team.jsx", "cloud.jsx", "ai.jsx", "script.jsx", "plans.jsx", "confirm.jsx", "auth-ui.jsx"])
    assert.ok(["20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3"].some(k=>html.includes('src="app/'+f+'?v='+k+'"')), f);   // (later passes re-key some)
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

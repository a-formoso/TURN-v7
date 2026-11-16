#!/usr/bin/env node
/* test-team-relaunch.mjs — Team sharing RELAUNCHED (owner 2026-10-03: "Let's ship Collaboration
   (Teams)"; the rules are docs/Dashboard Plan.md §5-§7, §9). Replaces test-team-paused.mjs.
     A. the switch (turn_app_config "team_sharing"): off → the pause's "Soon" button and ⋯ entry,
        opening nothing (the admin still opens the window); on → a working Team button for owners
        and collaborators alike.
     B. the Team window (team.jsx, Babel-transpiled, against a recording React stub):
        - a Director owner: the invite form (no Stage editor), "N of 5 people", each person's state
          (Joined / Invited · expires in N days / Invite expired + Invite again), budget box, the
          who-pays line, no "seat" or developer wording;
        - a Producer owner: the Stage editor role and "of 10";
        - a Writer-plan owner: no invite form, "See plans", removing still possible;
        - a collaborator: their role and budget, Leave film, no management controls;
        - the invite welcome says who pays.
     C. the roles: four, the same section map as supabase/team-relaunch.sql, the Stage room.
     D. cloud.jsx: switch-off refusal; a new address is inserted, an existing one changed in place,
        an expired one renewed (never an upsert the guard would count twice); TURN_TEAM:<code> in
        plain words; the email function gets no origin; presence never carries an email; the
        PostgREST filter quotes the address.
     E. app.jsx / chrome.jsx / plans.jsx wiring: rooms follow the owner's plan, a lapsed owner →
        read-only, the room switcher's "Not on this film's plan", the owner's Stage gates, the plan
        cards' team line only while sharing is on.
     F. Frances (APP_FEATURES → museFacts): the relaunched Team, four roles, rooms by the owner's
        plan; nothing says it is coming soon.
     G. docs and cache keys.
   No network, no browser, no Supabase. node scripts/test-team-relaunch.mjs */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); }
};
const noop = ()=>{};
const SOON = "Team sharing is coming soon: invite co-writers and art directors to work on your film.";
const J = (x)=>JSON.parse(JSON.stringify(x));

/* ── a recording React stub ─────────────────────────────────────────────── */
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const iconProxy = new Proxy({}, { get:(t, name)=>{ const f = ()=>null; f.iconName = name; return f; } });
function makeReact(){
  const R = { Fragment:"fragment", createElement:el, state:null, calls:[], sets:[], effects:[], runEffects:false,
    useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init);
      const set = (x)=>R.sets.push({ i, x }); R.calls.push(v); return [v, set]; },
    useEffect(fn){ if(R.runEffects){ const c = fn(); if(typeof c==="function") R.effects.push(c); } },
    useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
    reset(state){ R.state = state || null; R.calls = []; R.sets = []; } };
  return R;
}
const teamSrc = read("app/team.jsx"), chromeSrc = read("app/chrome.jsx"), appSrc = read("app/app.jsx"),
  cloudSrc = read("app/cloud.jsx"), aiSrc = read("app/ai.jsx"), plansSrc = read("app/plans.jsx"), css = read("app/styles.css"),
  sql = read("supabase/team-relaunch.sql");
const calls = { list:0, invite:0 }, toasts = [];
const React = makeReact();
const cb = { console, React, Icon:iconProxy, document:{ addEventListener:noop, removeEventListener:noop },
  localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop },
  CustomEvent:class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true,
  appToast:(m, k)=>toasts.push([m, k]), appConfirm:async ()=>true, TURNExport:{},
  cloudHandleName:(e)=>String(e||"").split("@")[0],
  cloudListProjectMembers:async ()=>{ calls.list++; return []; }, cloudInviteProjectMember:async ()=>{ calls.invite++; return { ok:true }; } };
cb.window = cb;
vm.createContext(cb);
vm.runInContext(transform(chromeSrc, "chrome.jsx"), cb, { filename:"app/chrome.jsx" });
vm.runInContext(transform(teamSrc, "team.jsx"), cb, { filename:"app/team.jsx" });
const R = cb.React;
const TeamWindow = vm.runInContext("TeamWindow", cb);
const DAY = 86400000;

/* ═══ A. the switch ═══════════════════════════════════════════════════════ */
await test("A1 switched off: the pause's 'Soon' button (aria-disabled, the tooltip), a click opens nothing; the ⋯ entry is 'soon'", ()=>{
  cb.turnTeamSharing = false; cb.turnIsAdmin = false; toasts.length = 0;
  R.runEffects = true; R.effects.length = 0; R.reset();
  const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, onChanged:noop, isAdmin:false, sharing:false });
  const b = findAll(tree, n=>n.type==="button")[0];
  assert.ok(hasClass("team-soon")(b) && b.props["aria-disabled"]==="true");
  assert.equal(textOf(findAll(b, hasClass("team-soon-tip"))[0]), SOON);
  assert.ok(cb.turnTeamMenu && cb.turnTeamMenu.soon===true && cb.turnTeamMenu.open===undefined);
  b.props.onClick(); assert.deepEqual(toasts, [[SOON, "info"]]);
  assert.equal(cb.TeamModal({ projectId:"p1", isAdmin:false, sharing:false, onClose:noop }), null, "no window");
  R.effects.splice(0).forEach(c=>c()); R.runEffects = false; R.reset();
});
await test("A2 switched on: a working Team button for an owner and for a collaborator; the ⋯ entry opens the window", ()=>{
  cb.turnTeamSharing = true; cb.turnIsAdmin = false;
  for(const meta of [{ isOwner:true }, { isShared:true, shareRole:"writer" }]){
    R.runEffects = true; R.effects.length = 0; R.reset();
    const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:meta, onChanged:noop, isAdmin:false, sharing:true });
    const b = findAll(tree, n=>n.type==="button")[0];
    assert.ok(!hasClass("team-soon")(b) && b.props["aria-disabled"]===undefined);
    assert.ok(typeof cb.turnTeamMenu.open==="function" && !cb.turnTeamMenu.soon);
    R.sets.length = 0; b.props.onClick(); assert.deepEqual(R.sets, [{ i:0, x:true }]);
    R.effects.splice(0).forEach(c=>c()); R.runEffects = false;
    R.reset({ 0:true });
    const open = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:meta, onChanged:noop, isAdmin:false, sharing:true });
    const modal = findAll(open, n=>n.type===cb.TeamModal)[0];
    assert.ok(modal && cb.TeamModal(modal.props), "the window renders");
  }
  assert.equal(cb.teamWindowAllowed(false, false), false); assert.equal(cb.teamWindowAllowed(false, true), true);
  assert.equal(cb.teamWindowAllowed(true, false), true, "the admin, sharing off: still opens (testing)");
  R.reset();
});

/* ═══ B. the Team window ═════════════════════════════════════════════════ */
const now = Date.now();
const MEMBERS = [
  { id:"m1", project_id:"p1", member_email:"cara@example.com", member_user:"u-cara", role:"writer", status:"active", budget_credits:200, expires_at:null },
  { id:"m2", project_id:"p1", member_email:"ari@example.com", member_user:null, role:"art_director", status:"active", budget_credits:null, expires_at:new Date(now+3*DAY).toISOString() },
  { id:"m3", project_id:"p1", member_email:"old@example.com", member_user:null, role:"view_only", status:"active", budget_credits:200, expires_at:new Date(now-DAY).toISOString() },
];
const SPEND = { m1:{ member_id:"m1", spent:120, budget:200 } };
const windowFor = (meta, plan, state = {})=>{
  cb.turnTeamSharing = true; cb.turnIsAdmin = false;
  cb.turnCreditBalance = plan ? { plan, paymentStatus:"active", frozen:false, remaining:1234 } : null;
  R.reset({ 0:MEMBERS, 1:SPEND, ...state });
  return TeamWindow({ projectId:"p1", projectTitle:"Neon Harbor", projectMeta:meta, series:false, onClose:noop, onChanged:noop });
};
await test("B1 a Director owner: invite form without Stage editor, '2 of 5 people', each person's state, budgets, Invite again, who pays", ()=>{
  const w = windowFor({ isOwner:true }, "director");
  const form = findAll(w, hasClass("team-invite"))[0];
  assert.ok(form, "invite form");
  // roles are toggle buttons (one or several); on Director the Stage editor is locked
  const pickers = findAll(w, n=>n.type===cb.TeamRolePicker);
  assert.equal(pickers.length, 4, "the invite's picker and one per person");
  assert.equal(pickers[0].props.value, "writer");
  const chips = findAll(cb.TeamRolePicker(pickers[0].props), hasClass("team-role-chip"));
  assert.deepEqual(chips.map(c=>[textOf(c), c.props["aria-pressed"], !!c.props.disabled]),
    [["View-only","false",false],["Co-writer","true",false],["Art director","false",false],["Stage editor","false",false]], "no Stage editor on Director");
  // (Team review 2026-10-09) the locked chip stays focusable: aria-disabled, and a press says why
  assert.equal(chips[3].props["aria-disabled"], "true");
  assert.match(textOf(findAll(w, hasClass("team-cap"))[0]), /^2 of 5 people on this film .* up to 3 Co-writers .* Stage editor role comes with the Producer plan/);
  const seats = findAll(w, n=>hasClass("team-seat")(n) && !hasClass("owner")(n));
  assert.equal(seats.length, 3);
  const roleText = seats.map(s=>textOf(findAll(s, hasClass("team-member-role"))[0]));
  assert.match(roleText[0], /Co-writer · Joined/); assert.match(roleText[1], /Art director · Invited · expires in 3 days/); assert.match(roleText[2], /Invite expired/);
  assert.ok(hasClass("expired")(seats[2]));
  // (Team review 2026-10-09) the month's reset date follows
  assert.match(textOf(findAll(seats[0], hasClass("team-member-budget"))[0]), /^120 of 200 credits this month · resets 1 [A-Z][a-z]{2}$/);
  assert.match(textOf(findAll(seats[1], hasClass("team-member-budget"))[0]), /^0 credits this month · no limit · resets 1 [A-Z][a-z]{2}$/);
  assert.equal(findAll(seats[0], hasClass("team-again")).length, 0, "no Invite again once joined");
  assert.equal(findAll(seats[1], hasClass("team-again")).length, 1); assert.equal(findAll(seats[2], hasClass("team-again")).length, 1);
  // the budget is picked from No limit, the plan's default and the credit pack sizes (owner 2026-10-03)
  const budget = findAll(seats[0], hasClass("team-budget"))[0];
  assert.equal(budget.type, "select"); assert.equal(budget.props.value, "200");
  assert.deepEqual(findAll(budget, n=>n.type==="option").map(o=>[o.props.value, textOf(o)]),
    [["", "No limit"], ["200", "200 a month (default)"], ["250", "250 a month"], ["1000", "1,000 a month"], ["3000", "3,000 a month"]]);
  assert.equal(findAll(seats[1], hasClass("team-budget"))[0].props.value, "", "no limit");
  // the owner's balance and the way to top it up
  const funds = findAll(w, hasClass("team-funds"))[0];
  assert.match(textOf(funds), /^Your balance: 1,234 credits — your team's work on this film comes out of it\.Add credits$/);
  let opened = 0; cb.turnOpenCreditPacks = ()=>{ opened++; };
  findAll(funds, n=>n.type==="button")[0].props.onClick(); assert.equal(opened, 1, "Add credits opens the credit packs");
  const note = textOf(findAll(w, hasClass("team-note"))[0]);
  assert.match(note, /paid from your credits, within a monthly budget per person \(200 credits by default\)/);
  assert.ok(!/seat|subscription|supabase|\.sql|migration/i.test(textOf(w)), "no seat or developer wording");
  assert.equal(findAll(w, hasClass("team-leave")).length, 0, "the owner doesn't 'leave'");
});
await test("B2 a Producer owner: the Stage editor role, 'of 10'", ()=>{
  const w = windowFor({ isOwner:true }, "studio", { 0:[{ ...MEMBERS[0], budget_credits:750 }] });
  const p0 = findAll(w, n=>n.type===cb.TeamRolePicker)[0];
  assert.equal(findAll(cb.TeamRolePicker(p0.props), n=>hasClass("team-role-chip")(n) && textOf(n)==="Stage editor")[0].props.disabled, false, "the Stage editor on Producer");
  assert.deepEqual(findAll(findAll(w, hasClass("team-budget"))[0], n=>n.type==="option").map(o=>o.props.value),
    ["", "250", "500", "750", "1000", "3000"], "Producer's default 500, and a value set earlier keeps its place");
  assert.match(textOf(findAll(w, hasClass("team-cap"))[0]), /^1 of 10 people/);
  assert.match(textOf(findAll(w, hasClass("team-note"))[0]), /500 credits by default/);
});
await test("B3 a Writer-plan owner: no invite form, 'See plans', people can still be removed", ()=>{
  const w = windowFor({ isOwner:true }, "writer");
  assert.equal(findAll(w, hasClass("team-invite")).length, 0);
  assert.match(textOf(findAll(w, hasClass("team-note"))[0]), /Sharing a film is part of the Director and Producer plans/);
  assert.equal(textOf(findAll(w, hasClass("team-plans"))[0]), "See plans");
  assert.equal(findAll(w, hasClass("team-remove")).length, 3, "remove stays");
  assert.equal(findAll(w, hasClass("team-again")).length, 0, "no new invites");
  const past = windowFor({ isOwner:true }, null, {}); assert.match(textOf(findAll(past, hasClass("team-note"))[0]), /Checking your plan/);
  cb.turnCreditBalance = { plan:"director", paymentStatus:"past_due" };
  assert.equal(cb.teamAccountTier(), "none", "past due can't share");
});
await test("B4 a collaborator: their role and budget, Leave film; no management controls", ()=>{
  const w = windowFor({ isShared:true, shareRole:"writer", ownerEmail:"dora@example.com" }, null, { 0:[MEMBERS[0]] });
  assert.equal(findAll(w, hasClass("team-invite")).length + findAll(w, hasClass("team-remove")).length + findAll(w, hasClass("team-budget")).length, 0);
  assert.match(textOf(findAll(w, hasClass("team-note"))[0]), /paid by the film's owner, within your monthly budget/);
  assert.match(textOf(findAll(w, hasClass("team-mine"))[0]), /Your budget on this film: 120 of 200 credits this month/);
  assert.equal(textOf(findAll(w, hasClass("team-leave"))[0]), "Leave film");
  assert.match(textOf(findAll(w, hasClass("team-seat"))[0]), /dora · owner/);
});
await test("B5 the invite welcome says who pays and still manages nothing", ()=>{
  R.reset(); cb.turnSeries = null;
  const page = cb.InviteWelcome({ film:{ id:"f1", title:"Film", shareRole:"stage_editor", isShared:true }, invitedBy:"dora@example.com",
    sessionEmail:"me@example.com", canSetPassword:false, onOpen:noop, onClose:noop });
  assert.match(textOf(page), /paid by its owner, within a monthly budget — you don't need a plan of your own/);
  assert.match(textOf(page), /Your role: Stage editor/);
  assert.equal(findAll(page, n=>n.type==="select").length, 0);
});

/* ═══ C. roles ═══════════════════════════════════════════════════════════ */
await test("C0 several roles per person: one '+' key, labels and blurbs for the set, sections from any of them, View-only alone, unknown parts fail closed", ()=>{
  assert.equal(cb.teamRoleKey(["art_director","writer","writer"]), "writer+art_director");
  assert.equal(cb.teamRoleKey("view_only+writer"), "writer", "an editing role wins over View-only");
  assert.equal(cb.teamRoleKey([]), "");
  assert.equal(cb.teamRoleKnown("writer+art_director"), true); assert.equal(cb.teamRoleKnown("writer+producer_admin"), false);
  assert.equal(cb.teamRoleKnown("view_only+writer"), false, "View-only can't be combined");
  assert.equal(cb.teamRoleLabel("writer+art_director"), "Co-writer + Art director");
  assert.match(cb.teamRoleBlurb("writer+art_director"), /^Saves story work .* and Art Room work .*\. Everything else stays read-only\.$/);
  assert.match(cb.teamScopedRoleBlurb("writer+stage_editor", true), /across the Show's existing and future episodes/);
  assert.equal(cb.teamCanWriteSection("writer+art_director", "scenes"), true);
  assert.equal(cb.teamCanWriteSection("writer+art_director", "characters"), true);
  assert.equal(cb.teamCanWriteSection("writer+art_director", "zz"), false);
  assert.equal(cb.teamCanWriteSection("writer+producer_admin", "scenes"), false, "an unknown part: the whole grant fails closed");
  assert.equal(cb.teamCanWriteRoom("writer+art_director", "writers"), true); assert.equal(cb.teamCanWriteRoom("writer+art_director", "art"), true);
  assert.equal(cb.teamCanWriteRoom("writer+art_director", "stage"), false); assert.equal(cb.teamCanWriteRoom("art_director+stage_editor", "stage"), true);
  assert.match(cb.teamRoleScopeNote("writer+art_director"), /Your roles on this film \(Co-writer \+ Art director\) don't cover that change/);
});
await test("C0b the picker: toggling adds and removes roles; View-only clears them; the last role off falls back to View-only", ()=>{
  const seen = [];
  const press = (value, label, tier = "studio")=>{
    const chip = findAll(cb.TeamRolePicker({ value, tier, onChange:(v)=>seen.push(v) }), n=>hasClass("team-role-chip")(n) && textOf(n)===label)[0];
    chip.props.onClick(); return seen.at(-1);
  };
  assert.equal(press("writer", "Art director"), "writer+art_director");
  assert.equal(press("writer+art_director", "Co-writer"), "art_director");
  assert.equal(press("art_director", "Art director"), "view_only");
  assert.equal(press("writer+art_director", "View-only"), "view_only");
  assert.equal(press("view_only", "Stage editor"), "stage_editor");
  const tree = cb.TeamRolePicker({ value:"writer+art_director", tier:"director", onChange:noop });
  assert.deepEqual(findAll(tree, hasClass("team-role-chip")).filter(c=>c.props["aria-pressed"]==="true").map(textOf), ["Co-writer", "Art director"]);
  assert.equal(tree.props.role, "group");
});
await test("C1 four roles, the section map identical to supabase/team-relaunch.sql, the Stage room is the Stage editor's", ()=>{
  assert.deepEqual(J(cb.TEAM_ROLES.map(r=>r.id)), ["view_only", "writer", "art_director", "stage_editor"]);
  const body = sql.slice(sql.indexOf("create or replace function public.turn_role_allowed_sections"), sql.indexOf("-- ── 2."));
  for(const role of ["writer", "art_director", "stage_editor"]){
    const m = new RegExp(`when '${role}' then\\s+array\\[([^\\]]+)\\]`).exec(body);
    const fromSql = m[1].split(",").map(x=>x.trim().replace(/'/g, "")).filter(x=>x!=="bible");
    assert.deepEqual(J(cb.TEAM_ROLE_SECTIONS[role]), fromSql, role);
  }
  assert.equal(cb.teamCanWriteRoom("stage_editor", "stage"), true);
  for(const r of ["writer", "art_director", "view_only"]) assert.equal(cb.teamCanWriteRoom(r, "stage"), false, r);
  assert.equal(cb.teamCanWriteRoom("stage_editor", "writers"), false);
  assert.match(cb.teamRoleScopeNote("stage_editor"), /covers the Stage/);
  assert.equal(cb.TEAM_LIMITS.people.director, 5); assert.equal(cb.TEAM_LIMITS.people.studio, 10);
  assert.ok(sql.includes("when 'studio' then 10 when 'director' then 5") && sql.includes("when 'studio' then 500 when 'director' then 200"), "the SQL caps and budgets match");
});

/* ═══ D. cloud.jsx ═══════════════════════════════════════════════════════ */
const cloudBlock = cloudSrc.slice(cloudSrc.indexOf("function _teamEmail(s)"), cloudSrc.indexOf("window.cloudLoadTeamSharing = cloudLoadTeamSharing;"));
function cloudBox({ existing = null, invoke, rpcError = null } = {}){
  const log = [];
  const chain = (table)=>{ const q = {
    insert:(row)=>{ log.push(["insert", table, row]); return Promise.resolve({ error:null }); },
    update:(row)=>{ log.push(["update", table, row]); return { eq:(k, v)=>{ log.push(["eq", k, v]); return Promise.resolve({ error:null }); } }; },
    upsert:(row)=>{ log.push(["upsert", table, row]); return Promise.resolve({ error:null }); },
    select:()=>q, eq:()=>q, order:()=>q, maybeSingle:async ()=>({ data:existing, error:null }) }; return q; };
  const sb = { from:(t)=>chain(t), rpc:async (name, args)=>{ log.push(["rpc", name, args]); return { data:1, error:rpcError }; },
    functions:{ invoke:async (name, o)=>{ log.push(["invoke", name, o.body]); return invoke || { data:{ ok:true, sent:true }, error:null }; } } };
  const box = { console, sbClient:()=>sb, _pushMemberRemoved:(id)=>log.push(["push", id]), cloudGetAppConfig:async ()=>({ on:true }),
    CustomEvent:class {}, dispatchEvent:()=>true };
  box.window = box; vm.createContext(box);
  vm.runInContext(cloudBlock, box, { filename:"app/cloud.jsx#team" });
  box.__log = log; return box;
}
await test("D1 switched off, a non-admin's invite and role change are refused before any request; removing still works", async ()=>{
  const c = cloudBox(); c.turnTeamSharing = false; c.turnIsAdmin = false;
  assert.deepEqual(J(await c.cloudInviteProjectMember("p1", "a@b.co", "writer")), { ok:false, paused:true, message:"Team sharing is paused right now. You can still remove people and change budgets." });
  assert.equal((await c.cloudUpdateProjectMember("m1", { role:"writer" }, "p1")).paused, true);
  assert.deepEqual(J(c.__log), []);
  assert.equal((await c.cloudRemoveProjectMember("m1", "p1")).ok, true, "removing always works");
});
await test("D2 a new address is INSERTED (never upserted), then the email — whose body carries no origin", async ()=>{
  const c = cloudBox(); c.turnTeamSharing = true;
  const r = await c.cloudInviteProjectMember("p1", " Cara@Example.com ", "stage_editor");
  assert.deepEqual(J(r), { ok:true, emailSent:true, emailNote:"" });
  assert.deepEqual(J(c.__log.filter(x=>x[0]==="insert")), [["insert", "turn_project_members", { project_id:"p1", member_email:"cara@example.com", role:"stage_editor", roles:["stage_editor"] }]]);
  assert.ok(!c.__log.some(x=>x[0]==="upsert"));
  assert.deepEqual(J(c.__log.find(x=>x[0]==="invoke")), ["invoke", "invite-collaborator", { projectId:"p1", email:"cara@example.com" }]);
  assert.ok(!/upsert\(/.test(cloudBlock), "no upsert anywhere in the member code");
});
await test("D3 an existing address: a removed row revived / a role changed in place; an expired invite renewed; a joined person gets no email", async ()=>{
  let c = cloudBox({ existing:{ id:"m9", role:"view_only", status:"removed", member_user:null, expires_at:null } }); c.turnTeamSharing = true;
  await c.cloudInviteProjectMember("p1", "a@b.co", "writer");
  assert.deepEqual(J(c.__log.filter(x=>x[0]==="update")), [["update", "turn_project_members", { role:"writer", roles:["writer"], status:"active" }]]);
  c = cloudBox({ existing:{ id:"m9", role:"writer", status:"active", member_user:null, expires_at:new Date(Date.now()-DAY).toISOString() } }); c.turnTeamSharing = true;
  await c.cloudInviteProjectMember("p1", "a@b.co", "writer");
  assert.deepEqual(J(c.__log.find(x=>x[0]==="rpc")), ["rpc", "turn_renew_invite", { p_member:"m9" }]);
  c = cloudBox({ existing:{ id:"m9", role:"writer", status:"active", member_user:"u1", expires_at:null } }); c.turnTeamSharing = true;
  const r = await c.cloudInviteProjectMember("p1", "a@b.co", "writer");
  assert.equal(r.emailSent, false); assert.ok(!c.__log.some(x=>x[0]==="invoke"), "already joined: no email");
});
await test("D3b several roles: the set is written with `role` as its first entry; a role change sends the set", async ()=>{
  let c = cloudBox(); c.turnTeamSharing = true;
  await c.cloudInviteProjectMember("p1", "a@b.co", "art_director+writer");
  assert.deepEqual(J(c.__log.find(x=>x[0]==="insert")[2]), { project_id:"p1", member_email:"a@b.co", role:"writer", roles:["writer", "art_director"] });
  c = cloudBox(); c.turnTeamSharing = true;
  await c.cloudUpdateProjectMember("m1", { roles:["stage_editor", "writer"] }, "p1");
  assert.deepEqual(J(c.__log.find(x=>x[0]==="update")[2]), { role:"writer", roles:["writer", "stage_editor"] });
  assert.equal((await c.cloudUpdateProjectMember("m1", { roles:["writer", "nope"] }, "p1")).message, "Unknown role.");
  assert.deepEqual(J(vm.runInContext("_teamRolesFrom", c)(["view_only", "writer"])), ["writer"]);
  assert.equal(vm.runInContext("_teamRoleKeyOf", c)({ role:"writer", roles:["writer", "art_director"] }), "writer+art_director");
  assert.equal(vm.runInContext("_teamRoleKeyOf", c)({ role:"art_director" }), "art_director", "a database without `roles`");
});
await test("D4 the database's TURN_TEAM refusals in plain words; unknown roles refused", async ()=>{
  const words = (m)=>vm.runInContext("_teamRefusal", cloudBox())({ message:m });
  assert.equal(words("TURN_TEAM:cap:5: this film already has its 5 collaborators"), "This film already has its 5 people. Remove someone, or wait for an invite to expire.");
  assert.equal(words("TURN_TEAM:daily_cap: x"), "You can send up to 20 new invites a day. Please try again tomorrow.");
  assert.equal(words("TURN_TEAM:stage_editor_producer: x"), "The Stage editor role comes with the Producer plan.");
  assert.equal(words("TURN_TEAM:plan_required: x"), "Sharing a film is part of the Director and Producer plans.");
  assert.equal(words("new row violates row-level security policy"), "Only the film's owner manages its team.");
  assert.equal(words("something else"), null);
  const c = cloudBox(); c.turnTeamSharing = true;
  assert.equal((await c.cloudInviteProjectMember("p1", "a@b.co", "producer_admin")).message, "Unknown role.");
});
await test("D5 leaving, budgets, spend, the owner's tier; the email filter is quoted; presence drops any email", async ()=>{
  const c = cloudBox(); c.turnTeamSharing = true;
  vm.runInContext(cloudSrc.slice(cloudSrc.indexOf("async function cloudSetMemberBudget"), cloudSrc.indexOf("window.cloudLoadTeamSharing = cloudLoadTeamSharing;")), c);
  assert.equal((await c.cloudLeaveFilm("p1")).ok, true);
  assert.deepEqual(J(c.__log.find(x=>x[1]==="turn_leave_film")), ["rpc", "turn_leave_film", { pid:"p1" }]);
  assert.equal((await c.cloudSetMemberBudget("m1", null)).ok, true);
  assert.deepEqual(J(c.__log.filter(x=>x[0]==="update").at(-1)), ["update", "turn_project_members", { budget_credits:null }]);
  assert.equal(vm.runInContext('_pgrstQuote(\'a"b,c@x.co\')', c), '"a\\"b,c@x.co"');
  assert.ok(cloudSrc.includes('.or("member_user.eq."+uid+",member_email.eq."+_pgrstQuote(email))'));
  assert.ok(cloudSrc.includes("const safe = { ...(meta||{}) }; delete safe.email; await ch.track(safe);"), "presence never tracks an email");
  assert.ok(!/origin: window\.location\.origin/.test(cloudSrc), "the invite email is never told an origin");
});

/* ═══ E. wiring ══════════════════════════════════════════════════════════ */
await test("E1 app.jsx: rooms follow the owner's plan; a lapsed owner → read-only; presence sends no email; the switch reaches the button", ()=>{
  assert.ok(appSrc.includes('if(filmOwnerTier==="studio") return { writers_room:true, art_room:true, stage:true, shared:true };'));
  assert.ok(appSrc.includes('if(filmOwnerTier==="director") return { writers_room:true, art_room:true, stage:false, shared:true };'));
  // (Team review 2026-10-09) also read-only while sharing is paused, and while the film is off the list
  assert.ok(appSrc.includes('const writeRole = (ownerPlanLapsed || sharingPaused || sharedOffList) ? "view_only" : (_rolesNow || (shareRole ? "view_only" : ""));'));
  assert.ok(appSrc.includes("window.teamCanWriteRoom(writeRole,id)") && appSrc.includes("window.teamCanWriteSection(writeRole,k)"));
  assert.ok(appSrc.includes('room==="stage" ? stageReadOnly : readOnlyShare'), "the Stage is read-only for every role but the Stage editor");
  assert.ok(appSrc.includes('{ uid:(session && session.user && session.user.id) || "", name, role:'), "presence: account id + name");
  assert.ok(!/cloudJoinPresence\(currentProjectId,\s*\{ email/.test(appSrc));
  assert.ok(appSrc.includes("isAdmin, sharing:teamSharing,"));
  assert.ok(appSrc.includes('["view_only","writer","art_director","stage_editor"].includes(shareRole)'), "the Stage editor is a known role");
  assert.ok(!appSrc.includes("Role changes are part of Team sharing, which is coming soon."));
  const hooks = appSrc.indexOf("const [filmOwnerTier, setFilmOwnerTier]"), firstReturn = appSrc.indexOf("if(authGate && !authReady){");
  assert.ok(hooks > 0 && hooks < firstReturn, "the new hook sits above every early return");
  const sw = appSrc.indexOf("const [teamSharing, setTeamSharing]");
  assert.ok(sw > 0 && sw < firstReturn);
});
await test("E2 chrome.jsx: a shared film's missing room says 'Not on this film's plan', not an upgrade", ()=>{
  const RS = vm.runInContext("RoomSwitcher", cb);
  R.reset({ 0:true });
  const tree = RS({ room:"writers", setRoom:noop, hasStory:true, roomEntitlements:{ writers_room:true, art_room:true, stage:false, shared:true } });
  const stage = findAll(tree, n=>n.type==="button" && /The Stage/.test(n.props["aria-label"]||""))[0];
  assert.match(stage.props["aria-label"], /Not on this film's plan/); assert.equal(stage.props.title, "The Stage isn't on this film's plan");
  R.reset({ 0:true });
  const own = RS({ room:"writers", setRoom:noop, hasStory:true, roomEntitlements:{ writers_room:true, art_room:true, stage:false } });
  assert.match(findAll(own, n=>n.type==="button" && /The Stage/.test(n.props["aria-label"]||""))[0].props["aria-label"], /plan$/);
  R.reset();
});
await test("E3 plans.jsx: the owner's Stage gates on a shared film; the cards' team line only while sharing is on", ()=>{
  const pb = { console, window:null, React, Icon:iconProxy, addEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {},
    localStorage:{ getItem:()=>null, setItem:noop }, document:{ addEventListener:noop } };
  pb.window = pb; vm.createContext(pb);
  vm.runInContext(transform(plansSrc, "plans.jsx"), pb);
  const d = { tier:"director", features:["1,600 credits / month"] }, w = { tier:"writer", features:["x"] };
  pb.turnTeamSharing = false;
  assert.deepEqual(J(pb.turnPlanCardFeatures(d)), ["1,600 credits / month", "Previs: every location as a 3D set, dressed for your film"]);   // the Previs line (2026-11-16) is on the Director and Producer cards
  pb.turnTeamSharing = true;
  assert.deepEqual(J(pb.turnPlanCardFeatures(d)), ["1,600 credits / month", "Share films with up to 5 collaborators", "Previs: every location as a 3D set, dressed for your film"]);
  assert.deepEqual(J(pb.turnPlanCardFeatures({ tier:"studio", features:[] })), ["Share films with up to 10 collaborators", "Previs: every location as a 3D set, dressed for your film"]);
  assert.deepEqual(J(pb.turnPlanCardFeatures(w)), ["x"], "Writer: no line");
  pb.turnCreditBalance = { plan:"none" }; pb.turnFilmOwnerTier = "studio";
  assert.equal(pb.turnTierGates(pb.turnCreditBalance).maxBatch, 4, "a no-plan Stage editor on a Producer film: the owner's gates");
  pb.turnFilmOwnerTier = null;
  assert.equal(pb.turnTierGates(pb.turnCreditBalance).maxBatch, 1);
  assert.ok(read("app/landing.jsx").includes("window.turnPlanCardFeatures(p)"), "the homepage cards too");
});
await test("E4 the new Team window styles exist", ()=>{
  for(const c of [".team-cap{", ".team-funds{", ".team-member-budget{", ".team-budget{", ".team-again,.team-leave{", ".team-mine{", ".team-plans{"]) assert.ok(css.includes(c), c);
});

await test("E5 the owner's bell: unseen joins badged, the list says who joined what as which role, opening marks them seen, a click opens the film", ()=>{
  R.reset(); R.runEffects = false;
  const TN = cb.TeamNotifications;
  const items = [{ id:"m1", projectId:"p1", title:"Glass Hours", email:"lanz@example.com", role:"art_director", at:new Date(Date.now()-2*3600000).toISOString(), seen:false },
    { id:"m2", projectId:"p2", title:"Neon Harbor", email:"cara@example.com", role:"writer", at:new Date(Date.now()-3*86400000).toISOString(), seen:true }];
  assert.equal(TN({ enabled:false }), null, "off: nothing");
  R.reset({ 0:items, 1:false });
  let tree = TN({ enabled:true, onOpenFilm:noop });
  const btn = findAll(tree, hasClass("notify-btn"))[0];
  assert.equal(btn.props["aria-label"], "Notifications, 1 new"); assert.equal(textOf(findAll(btn, hasClass("notify-badge"))[0]), "1");
  let seenCalls = 0; cb.cloudTeamNotificationsSeen = ()=>{ seenCalls++; return Promise.resolve(true); };
  R.sets.length = 0; btn.props.onClick();
  assert.equal(seenCalls, 1, "opening marks them seen on the server"); assert.deepEqual(J(R.sets[0]), { i:1, x:true });
  let opened = null;
  R.reset({ 0:items.map(n=>({ ...n, seen:true, wasNew:n.id==="m1" })), 1:true });
  tree = TN({ enabled:true, onOpenFilm:(id)=>{ opened = id; } });
  const rows = findAll(tree, hasClass("notify-item"));
  assert.equal(textOf(rows[0]), "lanz@example.com joined “Glass Hours” as Art director.2 hours ago"); assert.ok(hasClass("new")(rows[0]));
  assert.match(textOf(rows[1]), /cara@example.com joined “Neon Harbor” as Co-writer\.3 days ago/);
  assert.equal(findAll(tree, hasClass("notify-badge")).length, 0, "no badge once seen");
  rows[0].props.onClick(); assert.equal(opened, "p1");
  R.reset({ 0:[], 1:true });
  assert.match(textOf(TN({ enabled:true })), /When someone accepts an invite to one of your films, you'll see it here\./);
  assert.ok(appSrc.includes('notifySlot: teamNotifySlot("studio"),') && appSrc.includes('notifySlot: teamNotifySlot("home") }),'), "studio and Home");
  assert.ok(chromeSrc.includes("notifySlot || null,") && read("app/home-dashboard.jsx").includes("notifySlot || null,"));
  R.reset();
});
await test("E6 every paid call names the open film (the server bills its owner on a shared film); the free-tier locks follow the owner's plan", ()=>{
  const ctx = 'typeof window.turnFilmContext==="function" && window.turnFilmContext() ? { context:window.turnFilmContext() } : {}';
  assert.ok(aiSrc.includes('{ body:{ ...('+ctx+'), task:"text", usageKind:"writing"'), "writing");
  assert.ok(aiSrc.includes('{ body:{ ...('+ctx+'), task:"text", usageKind:"vision"'), "vision");
  assert.ok(!aiSrc.includes('...('+ctx+'), task:"text", usageKind:"muse"'), "Frances stays the caller's own");
  // video merges the film context with the submit's clip + take, the film's projectId winning (Stage editor review, 2026-10-09)
  assert.ok(read("app/videogen.jsx").includes('const filmContext = (typeof window.turnFilmContext==="function" && window.turnFilmContext()) || null;')
    && read("app/videogen.jsx").includes('const context = (filmContext || callContext) ? { ...(callContext||{}), ...(filmContext||{}) } : null;')
    && read("app/videogen.jsx").includes('{ body:{ ...(context ? { context } : {}), task:"video", op'), "video");
  assert.ok(read("app/voicegen.jsx").includes('{ body:{ ...('+ctx+'), task:"voice", op'), "voice");
  assert.ok(read("app/imagegen.jsx").includes("const _pid = opts.projectId || window.__turnCurrentProjectId;"), "images already did");
  const pb = { console, window:null, React, Icon:iconProxy, addEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {},
    localStorage:{ getItem:()=>null, setItem:noop }, document:{ addEventListener:noop } };
  pb.window = pb; vm.createContext(pb); vm.runInContext(transform(plansSrc, "plans.jsx"), pb);
  pb.turnCreditBalance = { plan:"none", remaining:0 };
  assert.equal(pb.turnOnFreeTier(), true, "a no-plan account on its own film");
  pb.turnFilmOwnerTier = "director";
  assert.equal(pb.turnOnFreeTier(), false, "on a Director owner's film: every writing engine, images beyond drafts");
  assert.equal(pb.turnTextModelAllowed("claude-fable-5"), true);
  pb.turnFilmOwnerTier = "none";
  assert.equal(pb.turnOnFreeTier(), true, "a lapsed owner gives nothing extra");
  pb.__turnCurrentProjectId = "f1"; assert.deepEqual(J(pb.turnFilmContext()), { projectId:"f1" });
  pb.__turnCurrentProjectId = null; assert.equal(pb.turnFilmContext(), null);
  assert.ok(appSrc.includes("noteTier();"), "Auto re-picks its engine when the owner's tier is known");
});

await test("E7 a role change reaches an open film: re-read about once a minute and on focus, after any refused save, and announced", ()=>{
  assert.ok(appSrc.includes("if((ticks % 5) === 0) refreshRole(50000);"), "about once a minute (5 ticks of 12 s)");
  assert.ok(appSrc.includes('window.addEventListener("focus", onRoleFocus);') && appSrc.includes('document.addEventListener("visibilitychange", onRoleFocus);'));
  assert.ok(appSrc.includes('window.removeEventListener("focus", onRoleFocus);'), "cleaned up");
  const scope = appSrc.slice(appSrc.indexOf("const _docRoleScope = (r)=>{"), appSrc.indexOf("const _docConflictCheck = (r)=>{"));
  assert.ok(scope.includes("window.cloudListProjects()") && scope.includes("setProjects(list)"), "a refused save re-reads the role");
  assert.ok(appSrc.includes('"Your role on \\u201c"+((_projRow && _projRow.title) || "this film")+"\\u201d is now "+label+". "+what'), "the change is announced");
  const hook = appSrc.indexOf("const roleSeenRef = React.useRef("), firstReturn = appSrc.indexOf("if(authGate && !authReady){");
  assert.ok(hook > 0 && hook < firstReturn, "above every early return");
  // the room boundary itself: a role's read-only Art Room is inert (no control can act)
  const art = read("app/artroom.jsx");
  // (2026-10-09, owner — Storyboards review) except the Storyboards tab, which a read-only role may page, view and
  // export: there the tools wrapper is inert and StoryboardView disables its changing controls itself
  assert.ok(art.includes('const rootInert = readOnly && !lockedView && !viewableTab;') && art.includes('inert:rootInert?"":undefined'));
  // (2026-10-09, owner — Breakdown review) the Breakdown is viewable by read-only roles too
  assert.ok(art.includes('const viewableTab = !lockedView && ((artView==="storyboard" && !!window.StoryboardView) || (artView==="breakdown" && !!window.BreakdownView));'));
  assert.ok(appSrc.includes("readOnly:roomReadOnly,canReview:!roomReadOnly,onSourceClick:openArtSource"), "the Art Room gets the room's read-only flag");
  assert.equal(cb.teamCanWriteRoom("writer", "art"), false); assert.equal(cb.teamCanWriteRoom("writer", "writers"), true);
  assert.equal(cb.teamCanWriteRoom("art_director", "writers"), false); assert.equal(cb.teamCanWriteRoom("art_director", "art"), true);
});

await test("E8 a collaborator's save never carries the owner's film card (poster, Home order); slugline units are the Art director's", ()=>{
  const save = appSrc.slice(appSrc.indexOf("const meta=(projectsRef.current||[]).find(p=>String(p.id)===String(ctx.projectId))||{};"), appSrc.indexOf("const _sectionsNow={...doc,...keep};"));
  assert.ok(/if\(!meta\.isShared\)\{\s*if\(meta\.cover\) keep\.cover=meta\.cover;\s*if\(meta\.coverPrev\) keep\.coverPrev=meta\.coverPrev;\s*if\(meta\.ord!=null\) keep\.homeOrder=Number\(meta\.ord\);\s*\}/.test(save), save);
  // every section the studio saves is covered by Co-writer + Art director together (nothing a full team can't save)
  const docKeys = (appSrc.match(/const doc = \{ ([^}]+) \};/) || [])[1].split(",").map(x=>x.trim().split(":")[0]).filter(k=>!["selId","room","view","artView"].includes(k));
  const both = docKeys.filter(k=>!cb.teamCanWriteSection("writer+art_director", k));
  assert.deepEqual(both, [], "uncovered sections: "+both.join(", "));
  assert.equal(cb.teamCanWriteSection("art_director", "sluglineUnits"), true);
  assert.equal(cb.teamCanWriteSection("writer", "sluglineUnits"), false);
});

/* ═══ F. Frances ═════════════════════════════════════════════════════════ */
await test("F1 APP_FEATURES: Team is live — four roles, rooms by the owner's plan, the caps, Leave film; nothing says it's coming soon", ()=>{
  const fb = { console, window:null }; fb.window = fb; vm.createContext(fb);
  const start = aiSrc.indexOf("const APP_FEATURES"), endA = aiSrc.indexOf("function musePublicFeature");
  assert.ok(start > 0 && endA > start);
  const team = (aiSrc.match(/APP_FEATURES\.push\(\{ name:"Team collaboration", what:"([^\n]*)" \}\);/) || [])[1] || "";
  assert.ok(team.startsWith("TEAM SHARING: the owner of a film (or a Show) invites people by email"), team.slice(0, 80));
  for(const s of ["there are FOUR, and one person can hold SEVERAL", "Stage editor (Producer films only)", "up to 5 people on a film on Director and up to 10 on Producer", "at most 3 Co-writers",
    "expires after 14 days", "ROOMS FOLLOW THE OWNER'S PLAN", "KNOWING WHO JOINED: a bell in the top bar", "does NOT need a plan of their own", "Leave film", "'Not on this film's plan'"])
    assert.ok(team.includes(s), s);
  assert.ok(!/coming soon/i.test(team.slice(0, team.indexOf("IF SHARING IS SWITCHED OFF"))), "only the switched-off case mentions Soon");
  assert.ok(!aiSrc.includes("Sharing a film is part of Team sharing, which is coming soon"));
  assert.ok(!aiSrc.includes("Sharing a Show with collaborators is part of Team sharing, which is coming soon"));
  assert.ok(!aiSrc.includes("with Team sharing coming soon, owners can't change roles"));
  assert.ok(!/McKee|Anthropic|Claude|TURN\b/.test(team), "brand rules");
});

/* ═══ G. docs and keys ═══════════════════════════════════════════════════ */
await test("G1 docs record the relaunch; the paused test is gone; TURN.html keys", ()=>{
  const readme = read("supabase/README.md"), notes = read("CLAUDE.md");
  assert.ok(readme.includes("**Team sharing relaunched (owner 2026-10-03).**") && readme.includes("Finally run **`team-relaunch.sql`**"));
  assert.ok(notes.includes("**Team (relaunched 2026-10-03)**"), "CLAUDE.md");
  assert.ok(!existsSync(new URL("scripts/test-team-paused.mjs", ROOT)), "replaced by this test");
  const html = read("TURN.html");
  // a key from after the change: a later day, or a 3 October key other than the ones before it
  // (alphabetical order doesn't work across names: "20261003-lookbook1" came after "-team2")
  const later = (k, before)=> !!k && (k.slice(0,8) > "20261003" || (k.slice(0,8)==="20261003" && !before.includes(k)));
  const BEFORE_TEAM2 = ["20261003-room1", "20261003-login1", "20261003-login2"];
  const BEFORE_TEAM4 = [...BEFORE_TEAM2, "20261003-team2", "20261003-team3"];
  for(const f of ["team.jsx", "cloud.jsx", "app.jsx", "chrome.jsx", "plans.jsx", "landing.jsx", "ai.jsx", "auth-ui.jsx", "styles.css", "script.jsx"]){
    const m = new RegExp("app/" + f.replace(".", "\\.") + "\\?v=([0-9a-z-]+)").exec(html);
    assert.ok(m && later(m[1], BEFORE_TEAM2), f + " " + (m && m[1]));
  }
  for(const f of ["home-dashboard.jsx", "icons.jsx", "videogen.jsx", "voicegen.jsx"]){
    const m = new RegExp("app/" + f.replace(".", "\\.") + "\\?v=([0-9a-z-]+)").exec(html);
    assert.ok(m && later(m[1], BEFORE_TEAM4), f + " " + (m && m[1]));
  }
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* test-team-paused.mjs — Team sharing is PAUSED and shown as "Coming soon" (owner decision
   2026-10-02, Option C of docs/Team Decision Memo.md: "go with option C. Don't let users interract
   with it in the frontend. Maybe allow them to see it like an upcoming feature").
     A. team.jsx + chrome.jsx (Babel-transpiled, run against a recording React stub):
        - everyone but the admin sees the top-bar Team button with a "Soon" chip, disabled-looking
          (aria-disabled="true", still focusable), with the coming-soon tooltip; a click opens
          nothing (no Team window, no member read or write) and only shows the same sentence;
        - the phone ⋯ entry is the same "Soon" entry, and a tap opens nothing;
        - the Team window itself refuses everyone but the admin, and only the admin manages a team;
        - the admin keeps today's behaviour (the button opens the window, which reads the members
          and shows the invite form), for testing;
        - the invite welcome page (?invite=) has no member-management control at all.
     B. cloud.jsx: adding, re-roling or removing a member is refused for everyone but the admin,
        before any request; the admin's invite path is unchanged (and its "email not sent" note
        names no file).
     C. ai.jsx APP_FEATURES and what Frances actually receives (museFacts / museSystemPrompt): Team
        is coming soon, no emails are promised, films already shared still open with their role,
        the Co-writer line is right; the homepage line no longer promises bringing a team in.
     D. app.jsx wiring, the stylesheet, the docs and the cache keys.
   No network, no browser, no Supabase. node scripts/test-team-paused.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/* ── a recording React stub ───────────────────────────────────────────────── */
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
/* member calls are counted: a paused Team must make NONE of them for a non-admin */
function makeBox(){
  const React = makeReact();
  const calls = { list:0, invite:0, update:0, remove:0 }, toasts = [];
  const box = { console, React, Icon:iconProxy,
    document:{ addEventListener:noop, removeEventListener:noop },
    localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop },
    CustomEvent:class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true,
    appToast:(m, k)=>toasts.push([m, k]), appConfirm:async ()=>true, TURNExport:{},
    cloudListProjectMembers:async ()=>{ calls.list++; return []; },
    cloudInviteProjectMember:async ()=>{ calls.invite++; return { ok:true }; },
    cloudUpdateProjectMember:async ()=>{ calls.update++; return { ok:true }; },
    cloudRemoveProjectMember:async ()=>{ calls.remove++; return { ok:true }; } };
  box.window = box; box.__calls = calls; box.__toasts = toasts;
  vm.createContext(box);
  return box;
}
const teamSrc = read("app/team.jsx"), chromeSrc = read("app/chrome.jsx"), appSrc = read("app/app.jsx"),
  cloudSrc = read("app/cloud.jsx"), aiSrc = read("app/ai.jsx"), landingSrc = read("app/landing.jsx"), css = read("app/styles.css");
const cb = makeBox();
vm.runInContext(transform(chromeSrc, "chrome.jsx"), cb, { filename:"app/chrome.jsx" });
vm.runInContext(transform(teamSrc, "team.jsx"), cb, { filename:"app/team.jsx" });
const R = cb.React;
const zero = ()=>({ list:0, invite:0, update:0, remove:0 });
const resetCalls = ()=>{ Object.assign(cb.__calls, zero()); cb.__toasts.length = 0; };

/* ═══ A. the Team button, the ⋯ entry, the Team window ═══════════════════════ */
await test("A1 the coming-soon sentence is one constant, exported for the ⋯ menu and cloud.jsx", ()=>{
  assert.equal(cb.TEAM_SOON_TEXT, SOON);
  assert.equal(typeof cb.teamWindowAllowed, "function");
  cb.turnIsAdmin = false;
  assert.equal(cb.teamWindowAllowed(), false, "no admin flag → closed");
  assert.equal(cb.teamWindowAllowed(true), true, "app.jsx's admin flag opens it");
  assert.equal(cb.teamWindowAllowed(false), false);
  cb.turnIsAdmin = true;
  assert.equal(cb.teamWindowAllowed(), true, "window.turnIsAdmin when app.jsx passes nothing");
  assert.equal(cb.teamWindowAllowed(false), false, "an explicit non-admin flag wins");
  cb.turnIsAdmin = false;
});

const soonCases = [
  ["an owner's own film", { isOwner:true, isShared:false }, false],
  ["a film shared with them (Co-writer)", { isShared:true, shareRole:"writer" }, false],
  ["a Show they own", { isOwner:true }, true],
  ["no project row yet", null, false],
];
for(const [label, meta, series] of soonCases){
  await test("A2 a non-admin on "+label+": the Team button shows 'Soon', looks disabled, has the tooltip, and opens nothing", ()=>{
    resetCalls(); R.runEffects = true; R.effects.length = 0; R.reset();
    cb.turnIsAdmin = false;
    const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:meta, series, onChanged:noop, isAdmin:false });
    const btns = findAll(tree, n=>n.type==="button");
    assert.equal(btns.length, 1, "one button");
    const b = btns[0];
    assert.ok(hasClass("tb-btn")(b) && hasClass("team-soon")(b), "a top-bar button, styled as coming soon");
    assert.equal(b.props["aria-disabled"], "true", "aria-disabled");
    assert.ok(!b.props.disabled && b.props.tabIndex===undefined, "not disabled, not removed from the tab order (its tooltip shows on focus)");
    assert.equal(b.props.type, "button");
    assert.match(b.props["aria-label"], /^Team\b/, "the spoken name starts with the visible label");
    assert.ok(textOf(b).startsWith("TeamSoon"), "reads Team + the Soon chip");
    const chip = findAll(b, hasClass("soon-chip"));
    assert.equal(chip.length, 1); assert.equal(textOf(chip[0]), "Soon"); assert.equal(chip[0].props["aria-hidden"], "true");
    const tip = findAll(b, hasClass("team-soon-tip"));
    assert.equal(tip.length, 1, "the tooltip");
    assert.equal(textOf(tip[0]), SOON);
    assert.equal(tip[0].props.role, "tooltip");
    assert.equal(b.props["aria-describedby"], tip[0].props.id, "the tooltip describes the button");
    // the ⋯ entry it registers: Coming soon, with no way to open the window
    assert.ok(cb.turnTeamMenu && cb.turnTeamMenu.soon===true, "registers the Coming-soon ⋯ entry");
    assert.equal(cb.turnTeamMenu.hint, SOON);
    assert.equal(cb.turnTeamMenu.open, undefined, "no open() on the entry");
    // click: nothing opens, nothing is read or written, one short notice
    R.sets.length = 0; b.props.onClick();
    assert.deepEqual(R.sets, [], "no state change: no window");
    assert.deepEqual(cb.__toasts, [[SOON, "info"]], "the notice repeats the sentence");
    // even with the button's open-state forced on, no Team window renders
    R.reset({ 0:true });
    const forced = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:meta, series, onChanged:noop, isAdmin:false });
    assert.equal(findAll(forced, n=>n.type===cb.TeamModal || n.type==="TeamWindow").length, 0, "no TeamModal rendered");
    assert.equal(findAll(forced, hasClass("team-modal")).length, 0);
    assert.deepEqual(cb.__calls, zero(), "no cloud member calls");
    R.effects.splice(0).forEach(c=>c());
    assert.equal(cb.turnTeamMenu, null, "unregisters when it goes");
    R.runEffects = false; R.reset();
  });
}

await test("A3 the non-admin's phone ⋯ menu: 'Team' with the Soon chip, disabled-looking; a tap closes the menu and opens nothing", ()=>{
  resetCalls(); R.runEffects = true; R.effects.length = 0; R.reset();
  cb.turnIsAdmin = false;
  cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, series:false, onChanged:noop, isAdmin:false });
  const cleanups = R.effects.splice(0);
  R.runEffects = false;
  for(const room of ["writers", "art"]){
    R.reset({ 0:true });
    const tree = cb.OverflowMenu({ onNewStory:noop, project:{ sourceBrief:"B" }, scenes:[{ id:"s1" }], drafts:{}, onReset:null, room, setArtView:noop });
    const team = findAll(tree, n=>n.type==="button" && hasClass("export-item")(n) && textOf(findAll(n, hasClass("t"))[0])==="Team");
    assert.equal(team.length, 1, room+": one Team entry");
    const t = team[0];
    assert.ok(hasClass("ovf-phone")(t) && hasClass("is-soon")(t), "phone-only, Coming soon");
    assert.equal(t.props["aria-disabled"], "true");
    assert.equal(t.props.title, SOON, "hover tooltip");
    assert.equal(textOf(findAll(t, hasClass("s"))[0]), SOON, "the sentence is its sub-line (a phone has no hover)");
    assert.equal(textOf(findAll(t, hasClass("soon-chip"))[0]), "Soon");
    R.sets.length = 0; cb.__toasts.length = 0;
    t.props.onClick();
    assert.deepEqual(R.sets, [{ i:0, x:false }], "the tap only closes the menu");
    assert.deepEqual(cb.__toasts, [[SOON, "info"]], "and shows the notice");
  }
  assert.deepEqual(cb.__calls, zero(), "no cloud member calls");
  cleanups.forEach(c=>c()); R.reset();
});

await test("A4 the Team window refuses everyone but the admin: TeamModal renders nothing and reads no members", ()=>{
  resetCalls(); R.runEffects = true; R.effects.length = 0; R.reset();
  cb.turnIsAdmin = false;
  for(const props of [{}, { isAdmin:false }, { projectMeta:{ isOwner:true } }, { projectMeta:{ isShared:true, shareRole:"art_director" } }])
    assert.equal(cb.TeamModal({ projectId:"p1", projectTitle:"Film", onClose:noop, onChanged:noop, ...props }), null);
  cb.turnIsAdmin = true;
  assert.equal(cb.TeamModal({ projectId:"p1", isAdmin:false, onClose:noop }), null, "app.jsx's non-admin flag wins over a stale window flag");
  cb.turnIsAdmin = false;
  assert.deepEqual(cb.__calls, zero(), "no member list read, no writes");
  R.effects.splice(0).forEach(c=>c()); R.runEffects = false; R.reset();
});

await test("A5 only the admin manages a team (owners get it back at relaunch)", ()=>{
  cb.turnIsAdmin = false;
  assert.equal(vm.runInContext("teamCanManage({ isOwner:true })", cb), false, "an owner who isn't the admin can't");
  assert.equal(vm.runInContext("teamCanManage({ isShared:true, shareRole:'writer' })", cb), false);
  cb.turnIsAdmin = true;
  assert.equal(vm.runInContext("teamCanManage({ isOwner:true })", cb), true, "the admin can");
  assert.equal(vm.runInContext("teamCanManage({ isShared:true })", cb), true, "the admin can, as today, on any film row");
  assert.equal(vm.runInContext("teamCanManage(null)", cb), false, "no film row, no management");
  cb.turnIsAdmin = false;
  // a TeamWindow reached some other way by a non-admin owner shows no invite form and no role / remove controls
  R.reset();
  const w = vm.runInContext("TeamWindow", cb)({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, series:false, onClose:noop, onChanged:noop });
  assert.equal(findAll(w, hasClass("team-invite")).length, 0, "no invite form");
  assert.equal(findAll(w, hasClass("team-role-blurb")).length, 0);
  assert.equal(findAll(w, n=>n.type==="select" || n.type==="input").length, 0, "no inputs at all");
  assert.equal(findAll(w, hasClass("team-remove")).length, 0, "no remove");
});

await test("A6 the admin keeps today's behaviour: the button opens the Team window, which reads the members and shows the invite form", ()=>{
  resetCalls(); R.runEffects = true; R.effects.length = 0; R.reset();
  cb.turnIsAdmin = true;
  const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, series:false, onChanged:noop, isAdmin:true });
  const b = findAll(tree, n=>n.type==="button")[0];
  assert.ok(hasClass("tb-btn")(b) && !hasClass("team-soon")(b) && b.props["aria-disabled"]===undefined, "a plain, working button");
  assert.equal(b.props.title, "Team collaboration", "the tooltip is today's");
  assert.equal(findAll(b, hasClass("soon-chip")).length, 0, "no Soon chip");
  assert.ok(cb.turnTeamMenu && typeof cb.turnTeamMenu.open==="function" && !cb.turnTeamMenu.soon, "the ⋯ entry opens the window too");
  R.sets.length = 0; b.props.onClick();
  assert.deepEqual(R.sets, [{ i:0, x:true }], "the click opens the window");
  R.sets.length = 0; cb.turnTeamMenu.open();
  assert.deepEqual(R.sets, [{ i:0, x:true }], "and so does the ⋯ entry");
  R.effects.splice(0).forEach(c=>c());
  R.reset({ 0:true });
  const open = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, series:false, onChanged:noop, isAdmin:true });
  const modal = findAll(open, n=>n.type===cb.TeamModal);
  assert.equal(modal.length, 1, "TeamModal rendered");
  assert.equal(modal[0].props.isAdmin, true, "with the admin flag");
  const inner = cb.TeamModal(modal[0].props);
  assert.ok(inner && inner.type===vm.runInContext("TeamWindow", cb), "the window itself");
  R.effects.splice(0).forEach(c=>c()); R.reset();
  const win = inner.type(inner.props);
  assert.equal(cb.__calls.list, 1, "the member list is read");
  const form = findAll(win, hasClass("team-invite"));
  assert.equal(form.length, 1, "the invite form");
  assert.equal(findAll(form[0], n=>n.type==="input" && n.props.type==="email").length, 1);
  const note = textOf(findAll(win, hasClass("team-note"))[0]);
  assert.ok(note.startsWith("Team sharing is coming soon for everyone else \u2014 only the admin can open this window, for testing."), note);
  assert.ok(!/seat|subscription/i.test(note), "no seat line");
  assert.ok(!/they get an invitation email/i.test(note), "no promise of an email");
  R.effects.splice(0).forEach(c=>c()); R.runEffects = false; R.reset();
  cb.turnIsAdmin = false;
});

await test("A7 the invite welcome page (?invite=) can't manage members: it only opens the film (or sets the visitor's own password)", ()=>{
  resetCalls(); R.reset();
  cb.turnSeries = null;
  let opened = 0, closed = 0;
  const film = { id:"f1", title:"Film", shareRole:"writer", isShared:true };
  const page = cb.InviteWelcome({ film, invitedBy:"owner@example.com", sessionEmail:"me@example.com", canSetPassword:true,
    onOpen:()=>{ opened++; }, onClose:()=>{ closed++; } });
  assert.equal(findAll(page, n=>n.type==="select").length, 0, "no role picker");
  assert.equal(findAll(page, hasClass("team-remove")).length + findAll(page, hasClass("team-invite")).length, 0, "no remove, no invite form");
  const inputs = findAll(page, n=>n.type==="input");
  assert.deepEqual(inputs.map(n=>n.props.type), ["password"], "the only field is the visitor's own new password");
  const labels = findAll(page, n=>n.type==="button").map(textOf);
  assert.deepEqual(labels.sort(), ["", "Later", "Open the film", "Set password"].sort(), "Close (×), Later, Open the film, Set password — nothing else");
  findAll(page, n=>n.type==="button" && textOf(n)==="Open the film")[0].props.onClick();
  assert.equal(opened, 1);
  const gone = cb.InviteWelcome({ film:null, sessionEmail:"me@example.com", onOpen:noop, onClose:()=>{ closed++; } });
  assert.equal(findAll(gone, n=>n.type==="input" || n.type==="select").length, 0, "an inactive invitation: no fields at all");
  assert.deepEqual(cb.__calls, zero(), "no cloud member calls");
  assert.ok(!/cloud(?:Invite|Update|Remove)ProjectMember/.test(teamSrc.slice(teamSrc.indexOf("function InviteWelcome"), teamSrc.indexOf("window.InviteWelcome"))),
    "its source calls no member write");
});

/* ═══ B. cloud.jsx — member writes refused for everyone but the admin ════════ */
const J = (x)=>JSON.parse(JSON.stringify(x));   // values from the vm realm, compared as plain data
const cloudBlock = cloudSrc.slice(cloudSrc.indexOf("function _teamEmail(s)"), cloudSrc.indexOf("window.cloudListProjectMembers = cloudListProjectMembers;"));
function cloudBox(invokeResult){
  const log = [];
  const chain = (table)=>{ const q = { upsert:(...a)=>{ log.push(["upsert", table, a[0]]); return q; },
    update:(...a)=>{ log.push(["update", table, a[0]]); return q; }, select:()=>q, eq:()=>q, order:()=>q,
    then:(res)=>res({ error:null, data:[] }) }; return q; };
  const sb = { from:(t)=>{ log.push(["from", t]); return chain(t); }, rpc:async ()=>({ data:[], error:null }),
    functions:{ invoke:async (name, o)=>{ log.push(["invoke", name]); return invokeResult || { data:{ ok:true }, error:null }; } } };
  const box = { console, sbClient:()=>sb, _pushMemberRemoved:(id)=>log.push(["push", id]), location:{ origin:"https://kinolot.infinitestudioai.com" } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(cloudBlock, box, { filename:"app/cloud.jsx#team" });
  box.__log = log;
  return box;
}
await test("B1 cloud.jsx: a non-admin can't add, re-role or remove a member — refused with the coming-soon sentence, before any request", async ()=>{
  assert.ok(cloudBlock.length > 1000 && cloudBlock.includes("function _teamPausedRefusal()"), "the block under test");
  const c = cloudBox();
  c.turnIsAdmin = false; c.TEAM_SOON_TEXT = SOON;
  for(const [fn, args] of [["cloudInviteProjectMember", ["p1", "a@b.co", "writer"]], ["cloudUpdateProjectMember", ["m1", { role:"view_only" }, "p1"]], ["cloudRemoveProjectMember", ["m1", "p1"]]]){
    const res = J(await c[fn](...args));
    assert.deepEqual(res, { ok:false, paused:true, message:SOON }, fn);
  }
  assert.deepEqual(J(c.__log), [], "no database call, no email function, no broadcast");
  delete c.TEAM_SOON_TEXT;
  assert.equal((await c.cloudInviteProjectMember("p1", "a@b.co")).message, SOON, "the same sentence even before team.jsx loads");
});
await test("B2 cloud.jsx: the admin's invite, role change and removal work as before; an unsent email's note names no file", async ()=>{
  const c = cloudBox({ data:null, error:{ message:"Function not found", context:null } });
  c.turnIsAdmin = true;
  const res = await c.cloudInviteProjectMember("p1", "A@B.co", "art_director");
  assert.equal(res.ok, true);
  assert.equal(res.emailSent, false);
  assert.equal(res.emailNote, "invitation emails aren't switched on yet.");
  assert.ok(!/supabase|README|deployed/i.test(res.emailNote), "no developer wording");
  assert.deepEqual(J(c.__log.filter(x=>x[0]==="upsert")), [["upsert", "turn_project_members", { project_id:"p1", member_email:"a@b.co", role:"art_director", status:"active" }]]);
  assert.ok(c.__log.some(x=>x[0]==="invoke" && x[1]==="invite-collaborator"), "the invite-collaborator function is still asked (source unchanged)");
  assert.equal((await c.cloudUpdateProjectMember("m1", { role:"writer" }, "p1")).ok, true);
  assert.equal((await c.cloudRemoveProjectMember("m1", "p1")).ok, true);
  assert.deepEqual(J(c.__log.filter(x=>x[0]==="update").map(x=>x[2])), [{ role:"writer" }, { status:"removed" }]);
});

/* ═══ C. what Frances knows (APP_FEATURES → museFacts → museSystemPrompt) ═════ */
function aiBox(){
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, clearTimeout, setInterval, clearInterval, setTimeout:(f)=>setTimeout(f, 0),
    React:new Proxy({ createElement:(t,p,...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t,k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop,
      removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  vm.createContext(box);
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/ai.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  return box;
}
const ai = aiBox();
const F = (n)=>ai.APP_FEATURES.find(f=>f.name===n);
const allRaw = ()=>ai.APP_FEATURES.map(f=>f.name+": "+f.what+(f.muse ? " "+f.muse : "")).join("\n");
const facts = ()=>Object.fromEntries(ai.museFacts().map(f=>[f.name, f.what]));

await test("C1 APP_FEATURES 'Team collaboration' opens with Team being coming soon and promises no email", ()=>{
  const t = F("Team collaboration").what;
  assert.ok(t.startsWith(SOON+" "), t.slice(0, 120));
  assert.ok(t.includes("Until it opens, nobody can invite collaborators to a film or a Show, change a collaborator's role or remove one"));
  assert.ok(t.includes("shown with a small 'Soon' chip and looks disabled"));
  assert.ok(t.includes("clicking it opens nothing"));
  assert.ok(t.includes("No invitation emails are sent."));
  assert.ok(t.includes("FILMS ALREADY SHARED WITH YOU STILL OPEN WITH YOUR ROLE"));
  assert.ok(t.includes("'Shared with me' section on Home"));
  assert.ok(t.includes("'Team' entry instead, with the same 'Soon' chip"), "the phone ⋯ entry");
  for(const gone of [/INVITATIONS ARE REAL EMAILS/i, /sends them an invitation/i, /Re-inviting an address re-sends the email/i, /welcome surface/i,
    /set-a-password/i, /The Team panel states each role/i, /lets a project owner share/i, /opens the same window/i, /\bseats?\b/i])
    assert.ok(!gone.test(t), "no longer says "+gone);
});
await test("C2 the Co-writer line is right: a Co-writer can't open the Art Room (app.jsx gives that role no Art Room)", ()=>{
  const t = F("Team collaboration").what;
  assert.ok(!/A Co-writer likewise sees the Art Room as read-only/.test(t), "the wrong line is gone");
  assert.ok(t.includes("On a shared film a Co-writer can't open the Art Room or the Stage, and an Art director can't open the Stage"));
  assert.ok(appSrc.includes('if(shareRole==="art_director") return { writers_room:true, art_room:true, stage:false };\n      return { writers_room:true, art_room:false, stage:false };'),
    "…which is what the app does");
});
await test("C3 every other entry: no team or email promise left; Home, Shows and the homepage say what's true now", ()=>{
  const raw = allRaw();
  for(const gone of [/INVITATIONS ARE REAL EMAILS/, /share with your team/i, /bring your team in/i, /owners manage that team once for the Show/,
    /windows they open \(Story brief, Team\)/])
    assert.ok(!gone.test(raw), "gone: "+gone);
  assert.ok(F("Home \u2014 the studio dashboard").what.includes("Sharing a film is part of Team sharing, which is coming soon, so new films can't be shared yet; films already shared with you keep appearing here and opening with your role."));
  assert.ok(F("Public homepage").what.includes("then the whole film grows in one place. "));
  assert.ok(raw.includes("Sharing a Show with collaborators is part of Team sharing, which is coming soon (see 'Team collaboration')."));
});
await test("C4 what Frances receives: the feature index and her facts say Team is coming soon; a question about inviting gets the full entry", ()=>{
  const t = facts()["Team collaboration"];
  assert.ok(t && t.startsWith(SOON), "museFacts keeps the opening sentence");
  assert.ok(t.includes("No invitation emails are sent."));
  assert.ok(t.includes("FILMS ALREADY SHARED WITH YOU STILL OPEN WITH YOUR ROLE"));
  assert.ok(!/INVITATIONS ARE REAL EMAILS|invitation email (?:with|whose) a link/i.test(t));
  const index = ai.museFeatureIndex();
  assert.match(index, /\n• Team collaboration — Team sharing is coming soon: invite co-writers and art directors/, "the one-line index entry");
  for(const q of ["How do I invite a collaborator?", "Can I share my film with my team?", "How do I add a co-writer to my film?"]){
    const p = ai.museSystemPrompt(q, null);
    const details = p.split("\n\nDETAILS")[1] || "";
    assert.ok(details.includes("• Team collaboration: "+SOON), q+" → the Team entry in full");
  }
  const all = ai.museFacts().map(f=>f.what).join("\n");
  assert.ok(!/INVITATIONS ARE REAL EMAILS|bring your team in|share with your team/i.test(all), "nothing Frances receives promises it");
});
await test("C5 Frances's rules don't need changing: the protocol and her prompt hold no Team-specific instruction", ()=>{
  const rules = ai.museStablePrefix().split("FEATURE INDEX")[0];
  assert.ok(!/\binvit|\bTeam\b/.test(rules.split("ABOUT THIS APP")[0]), "the rules part of her prompt says nothing about Team");
  assert.ok(!/invitation emails|INVITATIONS ARE REAL/i.test(read("docs/MUSE Protocol.md")));
});

/* ═══ D. wiring, stylesheet, copy, docs, cache keys ═══════════════════════════ */
await test("D1 app.jsx passes the admin flag to the Team button; the top bar keeps the slot", ()=>{
  const i = appSrc.indexOf("teamSlot: cloudMode && window.TeamButton ? React.createElement(window.TeamButton,{");
  assert.ok(i > 0);
  assert.ok(/\n\s+isAdmin,\n\s+projectId:currentShowId\|\|currentProjectId,/.test(appSrc.slice(i, i + 800)), "isAdmin is passed");
  assert.ok(appSrc.includes("const isAdmin = (((typeof cloudUserEmail===\"function\" && cloudUserEmail(session))||\"\").toLowerCase()===\"admin@infinitestudioai.com\");"),
    "the admin is admin@infinitestudioai.com");
  assert.ok(chromeSrc.includes("      teamSlot || null,"), "the top bar still shows the slot");
});
await test("D2 the stylesheet: Soon chip (a dot on the compact bar), dashed muted button, tooltip on hover and on keyboard focus, the phone keeps hiding it with the other buttons", ()=>{
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(bare.includes(".soon-chip{display:inline-flex;"));
  assert.ok(bare.includes(".tb-btn.team-soon{position:relative;cursor:default;background:transparent;border-style:dashed;color:var(--txt-3)}"));
  assert.ok(bare.includes(".tb-btn.team-soon:hover .team-soon-tip,.tb-btn.team-soon:focus-visible .team-soon-tip{opacity:1;visibility:visible}"));
  assert.ok(/\.team-soon-tip\{[^}]*pointer-events:none;opacity:0;visibility:hidden/.test(bare), "hidden until hover / focus, never clickable");
  assert.ok(bare.includes(".app.premium .tb-btn.team-soon:hover{transform:none}"), "no hover lift in the premium polish");
  assert.ok(!/\.team-soon\{[^}]*display:/.test(bare), "never sets display — the phone rule (.tb-btn:not(.accent){display:none}) still hides it");
  assert.ok(bare.includes(".export-item.is-soon{cursor:default}") && bare.includes(".export-item.is-soon:hover{background:transparent}"));
  // the compact bar (<=1100px): the chip becomes a 6px dot on the icon's corner (absolute, so it adds no width) —
  // the button is back to icon width and the film-title pill keeps its room; wider screens keep the full chip
  const compact = bare.slice(bare.lastIndexOf("@media (max-width:1100px){"));
  assert.ok(/^@media \(max-width:1100px\)\{\s*\.tb-btn\.team-soon \.soon-chip\{position:absolute;top:5px;right:5px;width:6px;height:6px;margin:0;padding:0;border:0;\s*border-radius:50%;font-size:0;line-height:0;background:var\(--txt-3\)\}\s*\}/.test(compact),
    "the dot rule is the stylesheet's last <=1100px block");
  assert.ok(bare.indexOf(".tb-btn.team-soon .soon-chip{margin-left:6px}") < bare.lastIndexOf("@media (max-width:1100px){"), "the dot overrides the 1360px chip margin");
  assert.ok(/\.tb-btn\.team-soon\{position:relative;/.test(bare), "the button anchors the dot");
  assert.ok(/aria-label":"Team \(coming soon\)"|"aria-label":\s*"Team \(coming soon\)"/.test(teamSrc), "the spoken name still says coming soon");
});
await test("D3 user-facing copy: no promise of inviting, seats, a team, a role change by the owner or a re-sent invitation left in the app's sources", ()=>{
  assert.ok(landingSrc.includes('{ n:"3", t:"Build the film", d:"Research, synopsis, spine and script, then cast, places, shots and video — it all grows in one place." },'));
  for(const [f, src] of [["landing.jsx", landingSrc], ["team.jsx", teamSrc], ["ai.jsx", aiSrc], ["cloud.jsx", cloudSrc], ["chrome.jsx", chromeSrc]]){
    for(const gone of [/bring your team in/i, /share with your team/i, /INVITATIONS ARE REAL EMAILS/, /Your subscription includes your seat/,
      /they get an invitation email with a link/, /the invite email function isn't deployed yet/])
      assert.ok(!gone.test(src), f+": "+gone);
  }
  // nobody is sent to "ask the owner" for a role or to have an invitation re-sent: owners can't
  // change roles (only the admin opens the Team window) and no invitation emails go out
  const authSrc = read("app/auth-ui.jsx"), ROLE_SOON = "Role changes are part of Team sharing, which is coming soon.";
  for(const [f, src] of [["app.jsx", appSrc], ["auth-ui.jsx", authSrc], ["team.jsx", teamSrc], ["chrome.jsx", chromeSrc], ["cloud.jsx", cloudSrc]]){
    for(const gone of [/Ask the owner for Co-writer access/, /Ask the owner to reassign/, /until the owner (re)?assigns/, /owner reassigns access/,
      /re-send it/, /fresh invitation/i, /the owner removed your access/])
      assert.ok(!gone.test(src), f+": "+gone);
  }
  assert.ok(appSrc.includes("Editing and AI-write actions are disabled. "+ROLE_SOON+'")),'), "the View-only banner");
  assert.ok(appSrc.includes("changes or AI actions will not save. "+ROLE_SOON+'")),'), "the Role unavailable banner");
  assert.ok(appSrc.includes('so these proposed changes were NOT applied."}'), "the Writers' Room run flag ends at the fact");
  assert.ok(appSrc.includes('". Please sign in with your email and password.","error");'), "a dead sign-in link asks for no new invitation");
  assert.ok(authSrc.includes("changes and AI actions will not save. "+ROLE_SOON+'"}') && authSrc.includes("are not saved. "+ROLE_SOON+'"}'), "the account chip tooltips");
  assert.ok(authSrc.includes('"Project role unavailable \\u00b7 read-only"'), "the account menu line");
  assert.ok(teamSrc.includes(' \\u2014 sign in with the invited address."'), "the invite page");
  assert.ok(cb.teamRoleScopeNote("").endsWith(ROLE_SOON) && cb.teamRoleScopeNote("producer_admin").endsWith(ROLE_SOON));
  assert.equal(cb.teamRoleBlurb(null), "The current collaborator role couldn't be verified, so access is read-only. "+ROLE_SOON);
});
await test("D4 docs: CLAUDE.md, supabase/README.md and the memo record the pause", ()=>{
  const notes = read("CLAUDE.md");
  assert.ok(/Team \(paused\)/.test(notes) && notes.includes("docs/Team Decision Memo.md"), "CLAUDE.md");
  const readme = read("supabase/README.md");
  assert.ok(readme.includes("Team sharing paused (owner 2026-10-02): UI shows Coming soon; backend kept; relaunch plan in docs/Team Decision Memo.md"), "README");
  const memo = read("docs/Team Decision Memo.md");
  assert.ok(memo.includes("Team sharing paused (owner 2026-10-02): UI shows Coming soon; backend kept; relaunch plan in docs/Team Decision Memo.md"), "memo");
});
await test("D5 TURN.html: every file this change touched loads under 20261002-team1 (or a later key); script.jsx keeps ai.jsx's key", ()=>{
  const html = read("TURN.html");
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  const LATER = ["20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-attrib1", "20261002-planpick2", "20261002-planpick3", "20261002-trialwelcome1", "20261003-room1", "20261003-login1"];   // a later change that re-keys one of these files adds its key here
  for(const f of ["app/team.jsx", "app/chrome.jsx", "app/app.jsx", "app/ai.jsx", "app/script.jsx", "app/landing.jsx", "app/cloud.jsx", "app/auth-ui.jsx", "app/styles.css"])
    assert.ok(key(f)==="20261002-team1" || LATER.includes(key(f)), f+": "+key(f));
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

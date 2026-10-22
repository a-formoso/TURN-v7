#!/usr/bin/env node
/* Round 1 (2026-09-28) — the UI & layout fixes from the Writers' Room readiness audit:
     1. phones: the ⋯ menu in the Writers' Room for everyone, carrying the top-bar buttons a
        phone hides (New Story, Story brief with its Rebuild, Team, Export), each under the
        same conditions as its button;
     2. the floating MUSE bubble no longer covers the Scene panel's last row (Delete) or the
        phone undo toast's ×;
     3. spoken names / keyboard access: beat tools, charge steppers, the item-list ×, the
        spine's act bands and scene cards;
     4. the follow lens counts every act of the story's structure (Act IV) and matches a
        character's first name as a whole word;
     5. the film's estimated total runtime stays visible below 900px.
     6. (review) the top bar's menus and windows sit above the drawers and docks while open;
        "Redraft N out-of-date" has its own strip in the Script header.
   Part A runs the CURRENT sources (Babel-transpiled, like test-viewnav.mjs) against a stub React
   that records elements; its CSS checks read the stylesheet WITHOUT comments and guard the
   cascade (no later rule may undo a clearance). Part B lays the real stylesheet out in headless
   Chrome at desktop, tablet and phone sizes (CHROMIUM env, the macOS Chrome app, or Replit's
   chromium); with no browser binary it prints SKIP — and FAILS when CI or REQUIRE_BROWSER is set.
   Part S (rebrand round, 2026-09-28) lays the SAME fixture out WITHOUT a browser — the stylesheet's
   cascade resolved per viewport — and asserts the same guarantees on the winning values, so they
   never silently go unchecked on a machine with no Chrome; where Chrome runs, Part B also checks
   Part S's computed values against getComputedStyle, so the two can't drift apart.
   No network: the fixture is a local file. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import vm from "node:vm";
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;

let passed = 0;
const test = async (name, fn)=>{ await fn(); passed++; console.log("PASS", name); };
const noop = ()=>{};

/* ── a recording React stub + helpers ─────────────────────────────────────── */
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out=[]; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=> (n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const iconProxy = new Proxy({}, { get:(t, name)=>{ const f = ()=>null; f.iconName = name; return f; } });

/* hooks: `state` answers useState in call order (else the initial value); every setter call is
   logged; effects run immediately when `runEffects` (their cleanups are kept). */
function makeReact(){
  const R = { Fragment:"fragment", createElement:el, state:null, calls:[], sets:[], effects:[], runEffects:false,
    useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init);
      const set = (x)=>R.sets.push({ i, x }); R.calls.push(v); return [v, set]; },
    useEffect(fn){ if(R.runEffects){ const c = fn(); if(typeof c==="function") R.effects.push(c); } },
    useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
    reset(state){ R.state = state || null; R.calls = []; R.sets = []; } };
  return R;
}
function makeBox(){
  const React = makeReact();
  const listeners = {}, dispatched = [];
  const box = { console, React, Icon:iconProxy,
    document:{ addEventListener:noop, removeEventListener:noop },
    localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop },
    CustomEvent:class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
    addEventListener:(t, h)=>{ (listeners[t] = listeners[t] || []).push(h); },
    removeEventListener:(t, h)=>{ listeners[t] = (listeners[t]||[]).filter(x=>x!==h); },
    dispatchEvent:(e)=>{ dispatched.push(e.type); (listeners[e.type]||[]).slice().forEach(h=>h(e)); return true; },
    appConfirm:async ()=>true, TURNExport:{} };
  box.window = box; box.__listeners = listeners; box.__dispatched = dispatched;
  vm.createContext(box);
  return box;
}

/* ── the sources ──────────────────────────────────────────────────────────── */
/* ROUND1_CSS=<file> runs every part against another stylesheet (mutation checks); NO_BROWSER=1
   runs as a machine without Chrome would (Part B skipped, Part S still asserting) */
const chromeSrc = read("app/chrome.jsx"), teamSrc = read("app/team.jsx"), inspSrc = read("app/inspector.jsx"),
  spineSrc = read("app/spine.jsx"), appSrc = read("app/app.jsx"),
  css = process.env.ROUND1_CSS ? readFileSync(process.env.ROUND1_CSS, "utf8") : read("app/styles.css");
/* (review 2026-09-28) the stylesheet as the browser reads it: comments out (a rule commented out
   is gone), and every rule with its @media context and declarations, in source order */
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssRules = (()=>{
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m)=>" ".repeat(m.length));
  const out = [], stack = []; let start = 0;
  for(let i=0;i<src.length;i++){
    const ch = src[i];
    if(ch==="{"){ stack.push({ prelude:src.slice(start, i).trim(), bodyStart:i+1 }); start = i+1; }
    else if(ch==="}"){ const top = stack.pop(); start = i+1; if(!top || top.prelude.startsWith("@")) continue;
      const media = stack.filter(x=>x.prelude.startsWith("@")).map(x=>x.prelude.replace(/\s+/g," ")).join(" & ");
      const decls = src.slice(top.bodyStart, i).split(";").map(d=>d.trim()).filter(Boolean)
        .map(d=>{ const k = d.indexOf(":"); return [d.slice(0,k).trim(), d.slice(k+1).trim()]; });
      // selectors split on top-level commas only (":has(.a, .b)" is one selector)
      const sel = []; let depth = 0, cur = "";
      for(const c of top.prelude){ if(c==="(") depth++; if(c===")") depth--; if(c==="," && !depth){ sel.push(cur); cur = ""; } else cur += c; }
      sel.push(cur);
      out.push({ media, sel:sel.map(x=>x.trim().replace(/\s+/g," ")), decls }); }
  }
  return out;
})();
// every declaration of `props` on a selector that ends in `target` (in any context), in source order
const declsOn = (target, props)=>{ const out = [];
  cssRules.forEach(r=>r.sel.forEach(sel=>{ if(sel===target || sel.endsWith(" "+target) || sel.endsWith(target))
    r.decls.forEach(([p, v])=>{ if(props.includes(p)) out.push((r.media ? r.media+" " : "")+sel+"{"+p+":"+v+"}"); }); }));
  return out; };

const cb = makeBox();
vm.runInContext(transform(chromeSrc, "chrome.jsx"), cb, { filename:"app/chrome.jsx" });
vm.runInContext(transform(teamSrc, "team.jsx"), cb, { filename:"app/team.jsx" });

const sb = makeBox();
sb.turnProject = { framework:"threeact" };
vm.runInContext(read("app/frameworks.jsx"), sb, { filename:"app/frameworks.jsx" });
vm.runInContext(transform(spineSrc, "spine.jsx"), sb, { filename:"app/spine.jsx" });
vm.runInContext(transform(inspSrc, "inspector.jsx"), sb, { filename:"app/inspector.jsx" });

/* ═══ 1. the phone ⋯ menu ════════════════════════════════════════════════════ */
const scenes2 = [{ id:"s1", no:1, act:1, title:"One", openCharge:1, closeCharge:-1 }, { id:"s2", no:2, act:2, title:"Two", openCharge:-1, closeCharge:1 }];
const openMenu = (props)=>{ cb.React.reset({ 0:true }); return cb.OverflowMenu({ onNewStory:noop, project:{}, scenes:[], drafts:{}, onReset:null, room:"writers", ...props }); };
const menuItems = (tree)=> findAll(tree, n=>n.type==="button" && hasClass("export-item")(n));
const itemTitle = (n)=> textOf(findAll(n, hasClass("t"))[0]);

await test("1 the Brief button and its ⋯ entry share one rule: Writers' Room, once a brief, logline or premise exists", ()=>{
  const s = cb.storyBriefShown;
  assert.equal(s("writers", { sourceBrief:"A brief" }), true);
  assert.equal(s("writers", { logline:"A logline" }), true);
  assert.equal(s("writers", { premise:"A premise" }), true);
  assert.equal(s("writers", {}), false);
  assert.equal(s("writers", null), false);
  assert.equal(s("art", { sourceBrief:"A brief" }), false);
  assert.equal(s("stage", { sourceBrief:"A brief" }), false);
  // homepage-style bar (2026-10-16): the brief opens from the Film menu, under the same rule
  assert.ok(chromeSrc.includes('const briefShown = storyBriefShown(room, project);')
    && chromeSrc.includes('briefShown && React.createElement("button",{type:"button",className:"export-item",onClick:openBrief},'), "the Film menu's entry uses it");
  assert.ok(!chromeSrc.includes('className:"tb-btn",onClick:()=>setBriefOpen(true)'), "no separate Brief button in the bar");
});

const topBar = (room, admin, extra)=>{
  cb.turnIsAdmin = !!admin; cb.React.reset();
  return cb.TopBar({ room, setRoom:noop, project:{ title:"F", sourceBrief:"B" }, scenes:scenes2, drafts:{}, onReset:admin?noop:null,
    onNewStory:noop, theme:"dark", onTheme:noop, ...(extra||{}) });
};
await test("1 the Film ⋯ menu renders for EVERY user in every room (homepage-style bar, 2026-10-16)", ()=>{
  const has = (t)=> findAll(t, n=>n.type===cb.OverflowMenu).length===1;
  assert.ok(has(topBar("writers", false)), "non-admin, Writers' Room");
  assert.ok(has(topBar("writers", true)), "admin, Writers' Room");
  assert.ok(has(topBar("art", false)), "Art Room, as before");
  assert.ok(has(topBar("stage", false)), "the Stage too (New Story, Team, Appearance)");
  assert.ok(has(topBar("stage", true)), "admins keep it everywhere");
  cb.turnIsAdmin = false;
  assert.ok(chromeSrc.includes("React.createElement(OverflowMenu,{onNewStory,onImportScript,onImportDraft,project,scenes,drafts,onReset,room,\n        artView,setArtView,artTabLocks,hiddenArtTabs,theme,onTheme})"),
    "the call test-art-tab-locks pins");
});

const TEAM_SOON = "Team sharing is coming soon: invite co-writers and art directors to work on your film.";
await test("1 a non-admin's Film menu in the Writers' Room: New Story · Story brief · Team (Soon) · the four exports — no Reset", ()=>{
  // Team is coming soon (owner decision 2026-10-02): a non-admin's entry (team.jsx) is { soon, hint, notify }
  let notified = 0;
  cb.turnTeamMenu = { soon:true, hint:TEAM_SOON, notify:()=>{ notified++; } };
  const tree = openMenu({ project:{ sourceBrief:"The brief", logline:"L" }, scenes:scenes2 });
  const items = menuItems(tree);
  assert.deepEqual(items.map(itemTitle), ["New Story","Story brief","Team","Screenplay (PDF)","Screenplay (.fountain)","Story outline (.txt)","Spine data (.csv)"]);
  assert.equal(findAll(tree, hasClass("export-foot")).length, 0, "no Reset for a non-admin");
  const brief = items[1], team = items[2];
  assert.ok(!hasClass("ovf-phone")(brief) && !hasClass("ovf-phone")(team), "both show at every width (the bar has no Brief / Team buttons now)");
  assert.equal(textOf(findAll(brief, hasClass("s"))[0]), "What this story was built from · rebuild as a new film");
  assert.equal(textOf(findAll(team, hasClass("s"))[0]), TEAM_SOON, "the entry says Team is coming soon");
  assert.ok(hasClass("is-soon")(team) && team.props["aria-disabled"]==="true" && team.props.title===TEAM_SOON, "disabled-looking, with the tooltip");
  assert.equal(textOf(findAll(team, hasClass("soon-chip"))[0]), "Soon", "the small Soon chip");
  brief.props.onClick();
  assert.deepEqual(cb.__dispatched, ["turn-open-brief"], "Story brief asks the top bar to open the brief window");
  assert.ok(cb.React.sets.some(s=>s.x===false), "and closes the menu");
  cb.React.sets.length = 0;
  team.props.onClick();
  assert.equal(notified, 1, "a tap only shows the coming-soon notice");
  assert.ok(cb.React.sets.some(s=>s.x===false), "and closes the menu");
  assert.deepEqual(cb.__dispatched, ["turn-open-brief"], "nothing else is opened");
  cb.__dispatched.length = 0;
});

await test("1 the admin's Film menu keeps the working Team entry (for testing)", ()=>{
  let teamOpened = 0;
  cb.turnTeamMenu = { open:()=>{ teamOpened++; }, hint:"Team collaboration" };
  const items = menuItems(openMenu({ project:{ sourceBrief:"The brief" }, scenes:scenes2, onReset:noop }));
  const team = items.find(n=>itemTitle(n)==="Team");
  assert.ok(team && !hasClass("ovf-phone")(team) && !hasClass("is-soon")(team) && team.props["aria-disabled"]===undefined);
  assert.equal(textOf(findAll(team, hasClass("s"))[0]), "Team collaboration");
  assert.equal(findAll(team, hasClass("soon-chip")).length, 0, "no Soon chip for the admin");
  team.props.onClick();
  assert.equal(teamOpened, 1, "Team opens the Team window");
  cb.turnTeamMenu = null;
});

await test("1 each ⋯ entry shows only when its button would", ()=>{
  cb.turnTeamMenu = null;
  const noTeam = menuItems(openMenu({ project:{ logline:"Only a logline" }, scenes:scenes2 }));
  assert.deepEqual(noTeam.map(itemTitle).slice(0,3), ["New Story","Story brief","Screenplay (PDF)"], "no Team while no Team button is up");
  assert.equal(textOf(findAll(noTeam[1], hasClass("s"))[0]), "The logline this story was built from", "no rebuild promised without a saved brief");
  const blank = menuItems(openMenu({ project:{}, scenes:[] }));
  assert.deepEqual(blank.map(itemTitle), ["New Story"], "a blank canvas: no brief to show, nothing to export");
  cb.turnTeamMenu = { open:noop, hint:"Show team · shared Bible and all episodes" };
  const art = menuItems(openMenu({ room:"art", project:{ sourceBrief:"B" }, scenes:scenes2, setArtView:noop }));
  assert.ok(!art.map(itemTitle).includes("Story brief"), "the brief is a Writers' Room button");
  assert.ok(art.some(n=>itemTitle(n)==="Team" && !hasClass("ovf-phone")(n)), "Team is offered in the Art Room's menu too, at every width");
  cb.turnTeamMenu = { soon:true, hint:TEAM_SOON, notify:noop };
  const artSoon = menuItems(openMenu({ room:"art", project:{}, scenes:scenes2, setArtView:noop }));
  assert.ok(artSoon.some(n=>itemTitle(n)==="Team" && hasClass("is-soon")(n)), "…and as Coming soon for a non-admin");
  cb.turnTeamMenu = { hint:"an entry with neither open nor soon" };
  assert.ok(!menuItems(openMenu({ project:{}, scenes:scenes2 })).some(n=>itemTitle(n)==="Team"), "an entry that can do nothing isn't shown");
  const admin = openMenu({ project:{ sourceBrief:"B" }, scenes:scenes2, onReset:noop });
  assert.equal(findAll(admin, hasClass("export-foot")).length, 1, "admin Reset unchanged");
  cb.turnTeamMenu = null;
});

await test("1 the top bar opens the brief window when the ⋯ entry asks", ()=>{
  cb.React.runEffects = true;
  topBar("writers", false);
  cb.React.runEffects = false;
  const briefIdx = 1;   // TopBar's second useState is briefOpen
  cb.React.sets.length = 0;
  (cb.__listeners["turn-open-brief"]||[]).forEach(h=>h({ type:"turn-open-brief" }));
  assert.deepEqual(cb.React.sets, [{ i:briefIdx, x:true }]);
  cb.React.reset({ [briefIdx]:true });
  cb.turnIsAdmin = false;
  const open = cb.TopBar({ room:"writers", setRoom:noop, project:{ sourceBrief:"B" }, scenes:scenes2, drafts:{}, onNewStory:noop, onRebuildFromBrief:noop, theme:"dark", onTheme:noop });
  assert.equal(findAll(open, n=>n.type===cb.StoryBriefModal).length, 1, "the Story brief window (with Rebuild) opens");
  Object.keys(cb.__listeners).forEach(k=>{ cb.__listeners[k] = []; });
});

await test("1 the Team button registers itself for the ⋯ menu while it is up for a film (the admin's, which still opens)", ()=>{
  const R = cb.React; R.runEffects = true; R.effects.length = 0; R.reset();
  cb.teamRoleLabel = cb.teamRoleLabel || ((r)=>r);
  cb.turnIsAdmin = true;   // Team is coming soon (2026-10-02): only the admin's button opens the window
  const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:null, series:false, onChanged:noop });
  assert.ok(tree, "renders its button");
  assert.equal(findAll(tree, n=>n.type==="button" && hasClass("tb-btn")(n))[0].props.title, "Team collaboration", "the button's tooltip is unchanged");
  assert.ok(cb.turnTeamMenu && cb.turnTeamMenu.hint==="Team collaboration");
  R.sets.length = 0; cb.turnTeamMenu.open();
  assert.deepEqual(R.sets, [{ i:0, x:true }], "opening from the menu opens this button's Team window");
  R.effects.splice(0).forEach(c=>c());
  assert.equal(cb.turnTeamMenu, null, "unregisters when it goes");
  R.reset();
  assert.equal(cb.TeamButton({ projectId:null }), null);
  assert.ok(!cb.turnTeamMenu, "no film, no Team entry");
  R.reset();
  cb.TeamButton({ projectId:"show1", projectMeta:{ isShared:true, shareRole:"writer" }, series:true });
  assert.equal(cb.turnTeamMenu.hint, "Show shared with you · "+cb.teamRoleLabel("writer"));
  R.effects.splice(0).forEach(c=>c()); R.runEffects = false; R.reset();
  cb.turnIsAdmin = false;
});

await test("1 everyone else's Team button is 'Soon': registers a Coming-soon ⋯ entry and opens nothing", ()=>{
  const R = cb.React; R.runEffects = true; R.effects.length = 0; R.reset();
  cb.turnIsAdmin = false;
  const toasts = []; cb.appToast = (m, k)=>toasts.push([m, k]);
  const tree = cb.TeamButton({ projectId:"p1", projectTitle:"Film", projectMeta:{ isOwner:true }, series:false, onChanged:noop });
  const btn = findAll(tree, n=>n.type==="button" && hasClass("tb-btn")(n))[0];
  assert.ok(btn && hasClass("team-soon")(btn) && btn.props["aria-disabled"]==="true" && !btn.props.disabled, "aria-disabled, still focusable");
  assert.equal(textOf(findAll(btn, hasClass("soon-chip"))[0]), "Soon");
  assert.equal(textOf(findAll(btn, hasClass("team-soon-tip"))[0]), TEAM_SOON, "the tooltip");
  assert.ok(cb.turnTeamMenu && cb.turnTeamMenu.soon===true && cb.turnTeamMenu.hint===TEAM_SOON && cb.turnTeamMenu.open===undefined, "a Coming-soon ⋯ entry with no open");
  R.sets.length = 0; btn.props.onClick();
  assert.deepEqual(R.sets, [], "nothing opens");
  assert.deepEqual(toasts, [[TEAM_SOON, "info"]], "a short notice repeats the sentence");
  assert.equal(findAll(tree, n=>n.type===cb.TeamModal).length, 0, "no Team window");
  R.effects.splice(0).forEach(c=>c());
  assert.equal(cb.turnTeamMenu, null, "unregisters when it goes");
  R.runEffects = false; R.reset(); delete cb.appToast;
});

await test("1 CSS: a phone hides the plain top-bar buttons and shows the ⋯ with its phone-only entries; desktop keeps them out", ()=>{
  const phone = css.slice(css.indexOf("/* ---- mobile (<=700px, matches the vp hook)"));
  const block = phone.slice(0, phone.indexOf("\n}\n")).replace(/\/\*[\s\S]*?\*\//g, "");   // a commented-out rule is no rule
  // (review) the same, read from the parsed stylesheet: the phone entries show at ≤700px only
  assert.deepEqual(declsOn(".export-menu .export-item.ovf-phone", ["display"]),
    [".export-menu .export-item.ovf-phone{display:none}", "@media (max-width:700px) .export-menu .export-item.ovf-phone{display:flex}"]);
  assert.ok(block.includes(".tb-btn:not(.accent){display:none}") && block.includes(".overflow-wrap{display:block}"));
  assert.ok(block.includes(".export-menu .export-item.ovf-phone{display:flex}"));
  assert.ok(css.includes(".overflow-wrap{position:relative;display:none}\n/* ⋯ entries for top-bar buttons a phone hides")
    && css.includes(".export-menu .export-item.ovf-phone{display:none}"));
  assert.ok(css.indexOf(".export-menu .export-item.ovf-phone{display:none}") < css.indexOf(".export-menu .export-item.ovf-phone{display:flex}"), "the phone rule wins");
});

/* ═══ 2. MUSE bubble clearance (static; part B measures it) ══════════════════ */
await test("2 the Scene panel's scroll end and the phone undo toast clear the MUSE bubble", ()=>{
  const px = (re)=>{ const m = re.exec(css); assert.ok(m, String(re)); return Number(m[1]); };
  const bottom = px(/\.muse-dock-wrap\{position:fixed;right:22px;bottom:(\d+)px/), right = px(/\.muse-dock-wrap\{position:fixed;right:(\d+)px/);
  const size = px(/\.muse-bubble\{width:(\d+)px;height:\d+px/);
  const clear = px(/--muse-clear:(\d+)px;/);
  assert.ok(clear >= bottom + size + 8 && clear >= right + size + 8, "the token clears the bubble with air: "+clear);
  assert.ok(cssBare.includes(".insp-scroll{padding-bottom:var(--muse-clear)}"));
  // (review) no later or narrower rule takes the clearance back (a `.insp-scroll{padding:14px}` in a
  // media block used to pass the substring check above)
  assert.deepEqual(declsOn(".insp-scroll", ["padding","padding-bottom"]), [".insp-scroll{padding:16px}", ".insp-scroll{padding-bottom:var(--muse-clear)}"]);
  assert.deepEqual(declsOn(".agent-undo", ["width","right","left","max-width","inset"]), [
    ".agent-undo{left:50%}", ".agent-undo{width:max-content}", ".agent-undo{max-width:calc(100vw - 24px)}",
    "@media (max-width:640px) .agent-undo{left:12px}", "@media (max-width:640px) .agent-undo{right:12px}",
    "@media (max-width:640px) .agent-undo{right:var(--muse-clear)}", "@media (max-width:640px) .agent-undo{width:auto}",
    "@media (max-width:640px) .agent-undo{max-width:none}"], "the phone toast's right edge and width are set last, at ≤640px");
  const toast = cssBare.slice(cssBare.indexOf(".agent-undo{position:fixed"));
  const phone = toast.slice(toast.indexOf("@media (max-width:640px){"), toast.indexOf("\n}\n", toast.indexOf("@media (max-width:640px){")));
  assert.ok(phone.includes(".agent-undo{right:var(--muse-clear);width:auto;max-width:none}") && phone.includes(".agent-undo.scene-undo.stacked{bottom:98px}"));
  // the Writing dock stays as committed in 193deaa — except its layer (consistency pass 2026-09-29): 72,
  // above the panel/drawer (60) but below every dialog and Home, which it used to cover at 120
  assert.ok(css.includes(".nb-dock{display:block;position:fixed;right:22px;top:50%;transform:translateY(-50%);z-index:72}")
    && css.includes(".write-dock{top:50%;transform:translateY(calc(-50% - 118px))}") && css.includes("  .write-dock{right:10px;bottom:144px}")
    && !css.includes("wr-insp-open"));
});

/* ═══ 3. spoken names and keyboard access ═══════════════════════════════════ */
await test("3 the charge steppers name what they change", ()=>{
  sb.React.reset();
  const st = sb.Stepper({ value:1, onChange:noop, readOnly:false, label:"closing value" });
  const [lo, hi] = findAll(st, n=>n.type==="button");
  assert.equal(lo.props["aria-label"], "Lower the closing value"); assert.equal(lo.props.title, "Lower the closing value");
  assert.equal(hi.props["aria-label"], "Raise the closing value"); assert.equal(hi.props.title, "Raise the closing value");
  assert.equal(st.props.role, "group"); assert.equal(st.props["aria-label"], "Closing value");
  sb.React.reset();
  const ce = sb.ChargeEditor({ scene:{ id:"s1", openCharge:1, closeCharge:-2, openValue:"Trust", closeValue:"Doubt" }, onCharge:noop, onUpdate:noop, readOnly:false });
  assert.deepEqual(findAll(ce, n=>n.type===sb.Stepper).map(n=>n.props.label), ["opening value","closing value"]);
});

await test("3 the beat tools are named, and the item list's × is reachable by keyboard", ()=>{
  sb.React.reset();
  const beats = { driverLabel:"MARA", reactorLabel:"IVO", desire:"d", obstacle:"o", result:"r",
    rows:[1,2,3].map(n=>({ id:"b"+n, n, drive:{ a:"Push", d:"x" }, react:{ a:"Pull", d:"y" } })) };
  const tree = sb.BeatEditor({ scene:{ id:"s1", no:1 }, beats, onBeats:noop, readOnly:false });
  const bx = findAll(tree, n=>n.type==="button" && hasClass("bx")(n));
  // four tools a beat since 2026-10-19: Insert a beat below sits before Delete
  assert.equal(bx.length, 12);
  assert.deepEqual(bx.slice(0,4).map(n=>n.props["aria-label"]), ["Move beat 1 up","Move beat 1 down","Insert a beat after beat 1","Delete beat 1"]);
  assert.deepEqual(bx.slice(8).map(n=>n.props.title), ["Move beat up","Move beat down","Insert a beat below this one","Delete beat"]);
  assert.ok(bx.every(n=>n.props["aria-label"] && n.props.title));
  sb.React.reset();
  const list = sb.EditableItemList({ value:"Pistol\nBadge", onCommit:noop });
  const del = findAll(list, hasClass("eil-del"));
  assert.equal(del.length, 2);
  assert.ok(del.every(n=>n.props.tabIndex===undefined), "no longer skipped by Tab");
  assert.equal(del[0].props["aria-label"], "Remove item “Pistol”");
  assert.ok(css.includes(".eil-row:focus-within .eil-del{opacity:1}") && css.includes(".eil-del:focus-visible{opacity:1;"), "it shows when focused");
});

const spineScenes = [
  { id:"a", no:1, act:1, title:"Open", openCharge:1, closeCharge:-1, conf:1, kind:"normal" },
  { id:"b", no:2, act:1, title:"Push", openCharge:-1, closeCharge:-3, conf:2, kind:"normal" },
  { id:"c", no:3, act:2, title:"Turn", openCharge:-2, closeCharge:2, conf:3, kind:"normal" },
];
await test("3 the spine's act bands and scene cards take focus, act on Enter / Space, and are named", ()=>{
  const R = sb.React; R.reset();
  const selected = [];
  const tree = sb.SpineCanvas({ scenes:spineScenes, selId:"b", onSelect:(id)=>selected.push(id), onReorder:noop, onAddScene:null, follow:null,
    readOnly:false, staleIds:new Set(["c"]), runtimes:{ a:{ sec:75, approx:true }, b:{ sec:200, long:true }, c:{ sec:64 } } });
  const bands = findAll(tree, hasClass("act-band"));
  assert.equal(bands.length, 2);
  assert.ok(bands.every(n=>n.props.role==="button" && n.props.tabIndex===0 && n.props["aria-expanded"]===true));
  assert.equal(bands[0].props["aria-label"], "Collapse Act I — Setup, about 5 min, 67% of the scenes");
  const collapseSet = R.calls.findIndex(v=>v && typeof v==="object" && !Array.isArray(v));   // the fold-state hook
  const key = (n, k, target)=>{ const e = { key:k, target:target||"self", currentTarget:"self", preventDefault(){ e.prevented = true; } }; n.props.onKeyDown(e); return e; };
  R.sets.length = 0;
  const ent = key(bands[1], "Enter");
  assert.ok(ent.prevented && R.sets.length===1 && R.sets[0].i===collapseSet && typeof R.sets[0].x==="function"
    && R.sets[0].x({})[2]===true, "Enter folds Act II");
  key(bands[1], " "); assert.equal(R.sets.length, 2, "Space too");
  key(bands[1], "Tab"); key(bands[1], "Enter", "child"); assert.equal(R.sets.length, 2, "other keys and keys from inside do nothing");
  const cards = findAll(tree, hasClass("scard"));
  assert.equal(cards.length, 3);
  assert.ok(cards.every(n=>n.props.role==="button" && n.props.tabIndex===0 && n.props.draggable===true));
  assert.equal(cards[0].props["aria-label"], "Scene 1: Open, +1 to -1, Turns, about 1:15");
  assert.equal(cards[1].props["aria-label"], "Scene 2: Push, -1 to -3, Progresses, 3:20, long for this format");
  assert.equal(cards[2].props["aria-label"], "Scene 3: Turn, -2 to +2, Turns, script out of date, 1:04");
  assert.equal(cards[1].props["aria-current"], "true"); assert.equal(cards[0].props["aria-current"], undefined);
  key(cards[2], "Enter"); key(cards[0], " "); key(cards[0], "Enter", "child");
  assert.deepEqual(selected, ["c","a"]);
  // a folded act announces itself as folded, with its scene count
  R.reset({ 2:{ 2:true } });
  const folded = findAll(sb.SpineCanvas({ scenes:spineScenes, selId:null, onSelect:noop, onReorder:noop, follow:null, readOnly:true, staleIds:new Set() }), hasClass("act-band"));
  assert.equal(folded[1].props["aria-expanded"], false);
  assert.equal(folded[1].props["aria-label"], "Expand Act II — Complication, 1 scene");
  assert.ok(css.includes(".act-band:focus-visible{") && css.includes(".scard:focus-visible{"), "a visible focus ring");
});

await test("3 the turn badge still says the same words (one source with the card's name)", ()=>{
  const b = (s)=>{ const t = sb.TurnBadge({ scene:s }); return [t.props.className, textOf(t), t.props.title]; };
  assert.deepEqual(b(spineScenes[0]), ["turn-badge ok","Turns",undefined]);
  assert.deepEqual(b(spineScenes[1]), ["turn-badge prog","Progresses","Intensifies on the same side instead of reversing"]);
  assert.deepEqual(b({ ...spineScenes[0], openCharge:1, closeCharge:1 }), ["turn-badge no","No turn",undefined]);
});

/* ═══ 4. the follow lens ═════════════════════════════════════════════════════ */
const mara = { id:"mara", name:"Mara Vey", color:"#c83" };
const drive = (id, act, open, close, extra)=>({ id, no:Number(id.slice(1)), act, driver:"mara", openCharge:open, closeCharge:close, summary:"", ...(extra||{}) });
await test("4 a four-act structure: Act IV counts, and the verdict prints every act", ()=>{
  sb.turnProject = { framework:"kishotenketsu" };
  const sc = [drive("s1",1,1,-1), drive("s2",1,-1,1), drive("s3",2,1,2), drive("s4",3,2,1), drive("s5",4,1,-1)];
  const tl = sb.characterThroughline(mara, sc, {});
  assert.equal(tl.turnsByAct[4], 1);
  assert.equal(tl.flat, false, "turns in Ketsu (Act IV) are real movement");
  assert.equal(tl.verdict, "Arc turns 3× · Act I ×2 · II ×0 · III ×0 · IV ×1.");
  const early = sb.characterThroughline(mara, [drive("s1",1,1,-1), drive("s2",1,-1,1), drive("s3",4,1,2)], {});
  assert.equal(early.verdict, "All the movement is in Act I (×2) — the arc coasts from there.");
  sb.turnProject = { framework:"threeact" };
  const three = sb.characterThroughline(mara, [drive("s1",1,1,-1), drive("s2",2,-1,1), drive("s3",3,1,-1)], {});
  assert.equal(three.verdict, "Arc turns 3× · Act I ×1 · II ×1 · III ×1.", "three acts print three");
  // a scene sitting in an act the structure doesn't list still shows up
  const stray = sb.characterThroughline(mara, [drive("s1",1,1,-1), drive("s2",4,-1,1)], {});
  assert.ok(stray.verdict.endsWith("· IV ×1."), stray.verdict);
  // (review) the act list comes from the framework, not from the scenes: a Kishōtenketsu character
  // with no scene in Ketsu still prints "· IV ×0"
  sb.turnProject = { framework:"kishotenketsu" };
  const noKetsu = sb.characterThroughline(mara, [drive("s1",1,1,-1), drive("s2",2,-1,1), drive("s3",3,1,-1)], {});
  assert.equal(noKetsu.verdict, "Arc turns 3× · Act I ×1 · II ×1 · III ×1 · IV ×0.");
  sb.turnProject = { framework:"threeact" };
});

await test("4 involvement matches the first name as a whole word", ()=>{
  const al = { id:"al", name:"Al Pacheco" };
  const scene = (id, summary, labels)=>({ id, no:1, act:1, driver:"x", openCharge:1, closeCharge:1, summary });
  const sc = [scene("s1","She also joins the call."), scene("s2","AL enters, soaked."), scene("s3","Al's gun is missing."), scene("s4","Alice waits."),
    scene("s5","Nobody here.")];
  const beats = { s5:{ driverLabel:"AL", reactorLabel:"MARA" } };
  const ids = [...sb.characterThroughline(al, sc, beats).involvedIds].sort();
  assert.deepEqual(ids, ["s2","s3","s5"]);
  const zoe = { id:"z", name:"Zoë Kent" };
  assert.deepEqual([...sb.characterThroughline(zoe, [scene("s1","Zoë's letter."), scene("s2","Zoëlle laughs.")], {}).involvedIds], ["s1"]);
  const jr = { id:"j", name:"J.R. Ewing" };
  assert.deepEqual([...sb.characterThroughline(jr, [scene("s1","J.R. arrives."), scene("s2","A jar breaks.")], {}).involvedIds], ["s1"], "punctuation in a name is literal");
});

/* ═══ 5. the runtime total below 900px ══════════════════════════════════════ */
await test("5 the spine's length and Key: the colours live in the Key's card, the length stays at every width (2026-10-21)", ()=>{
  const b900 = css.slice(css.indexOf("@media (max-width:900px){\n  .topbar{gap:8px;padding:0 12px}"));
  const block = b900.slice(0, b900.indexOf("\n}\n"));
  assert.ok(!/\.legend\{display:none\}/.test(block), "the legend is not hidden on tablets and phones");
  assert.ok(!/\.legend\{[^}]*display:none/.test(css), "nothing hides it");
  assert.ok(!css.includes(".legend-item:has(> .legend-swatch){display:none}"), "no colour row left to hide");
  assert.ok(css.includes(".legend-item:not(:has(> .legend-swatch)){white-space:nowrap}"), "the runtime reads on one line");
  // app.jsx hands the length to SpineLegend (spine.jsx): the runtime item, then the Key and its card of four colours
  assert.match(appSrc, /view==="spine" && React\.createElement\(SpineLegend,\{\n\s+runtimeText: runtimeTotal>0 \? "≈ "\+\(\(typeof fmtRuntime==="function"\) \? fmtRuntime\(runtimeTotal\)/);
  const sp = readFileSync(new URL("../app/spine.jsx", import.meta.url), "utf8");
  const fn = sp.slice(sp.indexOf("function SpineLegend("), sp.indexOf("window.SpineLegend"));
  assert.ok(fn.includes('className:"legend-item legend-runtime"') && fn.includes("Icon.clock"));
  assert.ok(fn.includes('className:"legend-key-btn"') && fn.includes('"aria-expanded"') && fn.includes('"Key"'));
  const key = sp.slice(sp.indexOf("const SPINE_KEY = ["), sp.indexOf("];", sp.indexOf("const SPINE_KEY = [")));
  for (const lab of ["Positive","Negative","Progresses","No turn"]) assert.ok(key.includes('"'+lab+'"'), lab);
  assert.ok(css.includes(".legend-key.open .legend-pop{display:block}") && css.includes("@media (hover:hover){ .legend-key:hover .legend-pop{display:block} }"));
  assert.ok(css.includes(".spine-hs .spine-chart::-webkit-scrollbar{display:none;height:0}"), "no scrollbar under the film frame");
});

/* ═══ 6. (review) layering and the Script header ═══════════════════════════ */
await test("6 while a top-bar menu or window is open, the bar sits above the drawers, the MUSE bubble and the Writing dock — below dialogs", ()=>{
  const rule = ".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay, .nb-dock-panel){z-index:130}";
  assert.ok(cssBare.includes(rule), "the rule is live (not commented out)");
  const z = (sel)=>{ const d = declsOn(sel, ["z-index"]); assert.ok(d.length, sel); return Number(d[0].match(/z-index:(\d+)/)[1]); };
  const raised = 130;
  for(const sel of [".scrim", ".muse-dock-wrap", ".nb-dock"]) assert.ok(raised > z(sel), sel+" "+z(sel));
  assert.ok(raised < z(".appconfirm-scrim"), "a confirm opened from Team or the brief stays on top");
  assert.deepEqual(declsOn(".topbar", ["z-index"]), [".topbar{z-index:30}"], "the bar's resting layer is unchanged");
  assert.deepEqual(declsOn(".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay, .nb-dock-panel)", ["z-index"]),
    [".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay, .nb-dock-panel){z-index:130}"]);
  // the windows those menus open are rendered inside the bar (so the rule reaches them)
  assert.ok(/React\.createElement\("div",\{className:"topbar",ref:barRef\},\s*bibleOpen[^\n]*\n\s*briefOpen && React\.createElement\(StoryBriefModal/.test(chromeSrc));
  assert.ok(teamSrc.includes('className:"bible-overlay"'));
});
/* (rebrand round, 2026-09-28) the same raise without :has(): a browser that can't parse :has()
   drops the whole rule, so chrome.jsx mirrors it as a class the bar gets while a layer is inside */
await test("6 the raise also works without :has(): the bar watches for its own menus and windows and sets .is-raised", ()=>{
  // one list of layers, in the stylesheet's :has() and in the watcher
  const hasArgs = /\.topbar:has\(([^)]*)\)\{z-index:130\}/.exec(cssBare);
  const jsSel = /const TOPBAR_LAYER_SEL = "([^"]+)";/.exec(chromeSrc);
  assert.ok(hasArgs && jsSel, "both lists exist");
  const list = (x)=>x.split(",").map(t=>t.trim()).sort();
  assert.deepEqual(list(jsSel[1]), list(hasArgs[1]), "the watcher looks for exactly the layers the :has() rule does");
  // its own rule, never in a selector list with :has() (which would drop it with the :has())
  assert.deepEqual(cssRules.filter(r=>r.sel.includes(".topbar.is-raised")).map(r=>[r.media, r.sel, r.decls]),
    [["", [".topbar.is-raised"], [["z-index","130"]]]]);
  const i1 = cssBare.indexOf(".topbar:has("), i2 = cssBare.indexOf(".topbar.is-raised{");
  assert.ok(i1 > 0 && i2 > i1, "declared right after the :has() rule");
  // the watcher, against a fake bar and a fake MutationObserver
  let present = false, observed = null, callback = null, disconnected = 0;
  const cls = new Set(["topbar"]), toggles = [];
  const bar = { querySelector:(sel)=>{ assert.equal(sel, jsSel[1]); return present ? {} : null; },
    classList:{ contains:(c)=>cls.has(c), toggle:(c, on)=>{ toggles.push([c, on]); on ? cls.add(c) : cls.delete(c); } } };
  cb.MutationObserver = class { constructor(f){ callback = f; } observe(t, o){ observed = [t, o]; } disconnect(){ disconnected++; } };
  const stop = cb.turnWatchTopbarLayer(bar);
  assert.ok(observed && observed[0]===bar && JSON.stringify(observed[1])===JSON.stringify({ childList:true, subtree:true }),
    "child-list changes inside the bar only (the class toggle never re-triggers it)");
  assert.ok(!cls.has("is-raised"), "resting: no menu, no window");
  present = true; callback([]);
  assert.ok(cls.has("is-raised"), "a menu or window opened inside the bar raises it");
  callback([]); assert.equal(toggles.length, 1, "no churn while it stays open");
  present = false; callback([]);
  assert.ok(!cls.has("is-raised"), "closing it lowers the bar again");
  stop(); assert.equal(disconnected, 1, "the effect's cleanup disconnects");
  assert.equal(cb.turnWatchTopbarLayer(null), undefined, "no element (first render in a test stub): nothing to watch");
  delete cb.MutationObserver;
  assert.equal(cb.turnWatchTopbarLayer(bar), undefined, "no MutationObserver: the :has() rule alone");
  // TopBar wires it to its own element, once
  assert.ok(chromeSrc.includes("const barRef = React.useRef(null);\n  React.useEffect(()=>turnWatchTopbarLayer(barRef.current),[]);"));
});
await test("6 'Redraft N out-of-date' has its own housed strip, the same look as the tool strip", ()=>{
  assert.ok(cssBare.includes(".st-group.r{border:1px solid var(--line-2);border-radius:9px;background:var(--bg-3);overflow:hidden}"));
  assert.ok(cssBare.includes(".st-group.r>*{height:32px;border:0;border-radius:0;flex:0 0 auto}"));
  const sv = read("app/script.jsx");
  assert.ok(sv.includes('React.createElement("div",{className:"st-group a"}, contBtn, scriptCheckBtn, versionUI, editBtn),'));
  assert.ok(sv.includes('redraftAllBtn && React.createElement("div",{className:"st-group r"}, redraftAllBtn),'));
});

/* ═══ B. the real stylesheet in a real browser ═══════════════════════════════ */
const CHROME = process.env.NO_BROWSER ? null : [process.env.CHROMIUM, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/repl/tools/bin/chromium"]
  .find(p=>p && existsSync(p));
const fixture = ()=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="styles.css"></head><body>
<div class="app"><div class="topbar"><div class="tb-right">
  <button class="tb-btn" id="brief"><svg width="14" height="14"></svg>Brief</button>
  <button class="tb-btn" id="team"><svg width="14" height="14"></svg>Team</button>
  <button class="tb-btn newstory" id="newstory"><svg width="14" height="14"></svg></button>
  <!-- the Art Room's menu first, so the Writers' Room ⋯ sits at the bar's right end as in the app -->
  <div class="overflow-wrap in-art" id="ovf-art"><button class="tb-icon">⋮</button><div class="export-menu" style="position:static">
    <button class="export-item ovf-phone" id="a-team"><span class="export-item-t"><span class="t">Team</span></span></button></div></div>
  <div class="overflow-wrap" id="ovf"><button class="tb-icon">⋮</button><div class="export-menu">
    <button class="export-item" id="m-new"><span class="export-item-t"><span class="t">New Story</span></span></button>
    <button class="export-item ovf-phone" id="m-brief"><span class="export-item-t"><span class="t">Story brief</span></span></button>
    <button class="export-item ovf-phone" id="m-team"><span class="export-item-t"><span class="t">Team</span></span></button></div></div>
  <div class="bible-overlay" id="modal" style="display:none"><div class="bible-modal"><div class="bible-head"><div class="bible-title">Team</div></div>
    <button class="team-remove" id="modal-btn" style="position:fixed;right:28px;bottom:30px;width:70px;height:30px">Remove</button></div></div>
</div></div>
<div class="script-scroll" id="sscroll" style="position:absolute;left:0;right:0;top:3000px">
<div class="script-head"><div class="meta"><div class="script-title-row"><div class="script-title">The Ambush</div></div></div>
<div class="script-tools">
 <div class="st-group a" id="sga"><button class="cont-btn ok"><svg width="14" height="14"></svg>Continuity</button>
  <button class="cont-btn ok"><svg width="14" height="14"></svg>Script check</button>
  <button class="draft-btn sm ghost" id="s-edit"><svg width="14" height="14"></svg>Edit</button></div>
 <div class="st-group r" id="sgr"><button class="cont-btn stale" id="s-rall"><svg width="14" height="14"></svg>Redraft 5 out-of-date</button></div>
 <div class="st-group b"><button class="draft-btn sm"><svg width="14" height="14"></svg>Redraft <span class="redraft-long">script </span>from beats</button>
  <div class="script-scenestep"><button class="panel-collapse">&lt;</button>Scene 3 / 24<button class="panel-collapse">&gt;</button></div></div>
</div></div></div>
<div class="body"><main class="canvas">
  <div class="canvas-head"><div class="canvas-head-copy"><div class="canvas-title">Value-Charge Spine</div><div class="canvas-sub">The emotional charge of every scene, end to end</div></div>
    <div class="legend"><div class="legend-item" id="rt"><svg width="11" height="11"></svg>≈ 1h 46m</div>
      <div class="legend-key" id="pos"><button class="legend-key-btn"><span class="legend-key-dots"><i></i><i></i><i></i><i></i></span>Key</button>
        <div class="legend-pop"><div class="legend-pop-row"><span class="legend-swatch" style="background:var(--pos)"></span><div><b>Positive</b><span>…</span></div></div></div></div></div></div>
</main>
<aside class="inspector"><div class="insp-tabs"><button class="insp-tab on">Scene</button></div><div class="insp-scroll" id="iscroll">
  <div style="height:1600px">scene fields</div>
  <ul class="eil-list"><li class="eil-row"><span class="eil-dot"></span><textarea class="edit-in" id="eil-in">Pistol</textarea><button class="eil-del" id="eil-del">×</button></li></ul>
  <div class="insp-actions"><button class="ia-btn">Up</button><button class="ia-btn">Down</button><button class="ia-btn">Add after</button>
    <button class="ia-btn danger" id="del"><svg width="13" height="13"></svg>Delete</button></div>
</div></aside></div>
<div class="scrim" id="scrim" style="display:none"></div></div>
<div class="write-dock nb-dock" id="wdock"><button class="nb-dock-toggle"><span class="nb-dock-label">Writing</span><span class="nb-dock-chip model">GPT5</span><span class="nb-dock-chip">AUTO</span></button></div>
<div class="agent-undo scene-undo stacked" id="t2"><span class="au-ic"><svg width="15" height="15"></svg></span><div class="au-text"><div class="au-t">Scene 12 deleted</div><div class="au-s">Restore it with its beats and draft</div></div>
  <button class="au-btn" id="t2-undo"><svg width="13" height="13"></svg>Undo</button><button class="au-x" id="t2-x">×</button></div>
<div class="agent-undo" id="t1"><span class="au-ic"><svg width="15" height="15"></svg></span><div class="au-text"><div class="au-t">Setups &amp; Payoffs changed your story</div><div class="au-s">3 agent runs can be undone</div></div>
  <button class="au-btn" id="t1-undo"><svg width="13" height="13"></svg>Undo</button><button class="au-x" id="t1-x">×</button></div>
<div class="muse-dock-wrap"><button class="muse-bubble" id="muse"></button></div>
<script>
window.measure = async function(xcheck){
  document.querySelector(".app").classList.toggle("vp-mobile", innerWidth <= 700);
  // a phone's open Scene drawer brings its scrim (app.jsx renders .scrim with an open drawer)
  document.getElementById("scrim").style.display = innerWidth <= 700 ? "" : "none";
  const $ = (id)=>document.getElementById(id), r = (e)=>e.getBoundingClientRect().toJSON();
  const shown = (e)=>getComputedStyle(e).display!=="none" && e.getBoundingClientRect().width>0;
  const top = (e, x, y)=>{ const h = document.elementFromPoint(x, y); return !!h && (h===e || e.contains(h)); };
  const clickable = (e)=>{ const b = e.getBoundingClientRect(), pts = [[b.left+b.width/2, b.top+b.height/2], [b.right-3, b.top+b.height/2],
    [b.left+3, b.top+b.height/2], [b.right-3, b.bottom-3], [b.right-3, b.top+3]];
    return pts.every(([x, y])=>top(e, x, y)); };
  const hit = (a, b)=>{ a = a.getBoundingClientRect(); b = b.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; };
  $("eil-in").focus({ preventScroll:true });
  const sc = $("iscroll"); sc.scrollTop = sc.scrollHeight;
  await new Promise(r=>setTimeout(r, 300));   // past the × fade-in and the viewport change
  // the Delete check runs with no toast up (a toast is a separate, passing layer)
  ["t1","t2"].forEach(t=>{ $(t).style.display = "none"; });
  const del = clickable($("del")), delUnderMuse = hit($("del"), $("muse"));
  ["t1","t2"].forEach(t=>{ $(t).style.display = ""; });
  await new Promise(r=>setTimeout(r, 300));   // the toasts' entry animation
  // (review) a top-bar menu over the open Scene drawer, and a top-bar window over the MUSE bubble
  const menuTap = ["m-new","m-brief","m-team"].filter(id=>shown($(id))).every(id=>clickable($(id)));
  $("modal").style.display = ""; await new Promise(r=>setTimeout(r, 50));
  const modalTap = clickable($("modal-btn")), modalOverMuse = hit($("modal-btn"), $("muse"));
  $("modal").style.display = "none";
  // (review) the Script header: "Redraft N out-of-date" in its own strip never pushes Edit out
  const inBox = (e, box)=>{ const a = e.getBoundingClientRect(), b = box.getBoundingClientRect(); return a.left>=b.left-1 && a.right<=b.right+1; };
  const hdr = { rall:inBox($("s-rall"), $("sgr")) && $("s-rall").getBoundingClientRect().right<=innerWidth+1 && $("s-rall").getBoundingClientRect().left>=-1,
    edit:inBox($("s-edit"), $("sga")) && $("s-edit").getBoundingClientRect().right<=innerWidth+1, sideways:$("sscroll").scrollWidth>$("sscroll").clientWidth+1,
    ownLine:$("sgr").getBoundingClientRect().top > $("sga").getBoundingClientRect().bottom - 1 };
  const out = { w:innerWidth, h:innerHeight, del, delUnderMuse, menuTap, modalTap, modalOverMuse, sc:hdr,
    rt:shown($("rt")), rtH:$("rt").getBoundingClientRect().height, pos:shown($("pos")),
    tbHidden:!shown($("brief")) && !shown($("team")) && !shown($("newstory")),
    ovf:shown($("ovf")), mBrief:shown($("m-brief")), mTeam:shown($("m-team")), mNew:shown($("m-new")),
    artOvf:shown($("ovf-art")), aTeam:shown($("a-team")),
    eilDel:getComputedStyle($("eil-del")).opacity, eilTab:$("eil-del").tabIndex,
    toasts:["t1","t2"].map(t=>({ id:t, x:clickable($(t+"-x")), undo:clickable($(t+"-undo")), underMuse:hit($(t), $("muse")), underDock:hit($(t), $("wdock")),
      inView:r($(t)).left>=0 && r($(t)).right<=innerWidth })),
    toastsApart:!hit($("t1"), $("t2")), toastRects:[r($("t1")), r($("t2"))] };
  // (rebrand round) what Part S predicts, read back from the browser
  out.styles = {};
  (xcheck || []).forEach(([sel, prop, maxW])=>{ if(maxW && innerWidth > maxW) return;
    const e = document.querySelector(sel); out.styles[sel+" "+prop] = e ? getComputedStyle(e).getPropertyValue(prop) : null; });
  return out;
};
</script></body></html>`;

/* ═══ S. the same layout, resolved from the stylesheet — no browser needed ═══════════════════
   (rebrand round, 2026-09-28) Part B needs a Chrome binary; without one it used to print SKIP and
   the run still ended "N passed, 0 failed", so its layout guarantees could silently go unchecked.
   This part lays the SAME fixture out as a cascade, deterministically: the fixture HTML parsed into
   an element tree, every rule of the real stylesheet matched against it per viewport (media
   queries, selectors incl. :not / :is / :has, specificity, source order, !important, inline
   styles, inheritance, var(), blockification), and the guarantees Part B measures are asserted on
   the values that win: which top-bar controls a phone shows, the layer order of the raised bar vs
   the drawers, the scrim, the Frances bubble, the Writing dock, dialogs and toasts (per stacking
   context), the bubble clearance of the Scene panel and the undo toasts, the stacked toast's gap,
   the runtime legend, the item-list ×, and the Script header's Redraft strip. It runs on every
   machine. Where Chrome runs, Part B also compares these computed values with getComputedStyle,
   so the model can't drift from a real browser. What only a browser can measure (real text
   widths: a centred toast vs the bubble above 640px, Edit fitting its strip) stays in Part B. */
const SIZES = [[1440,900,"desktop"],[1024,768,"tablet (landscape)"],[820,1180,"tablet (portrait)"],[390,844,"phone"],[375,667,"small phone"],[320,568,"narrow phone"]];
const splitTop = (str, sep)=>{ const out = []; let depth = 0, q = null, cur = "";
  for(const ch of str){
    if(q){ cur += ch; if(ch===q) q = null; continue; }
    if(ch==='"' || ch==="'"){ q = ch; cur += ch; continue; }
    if(ch==="(" || ch==="[") depth++; else if(ch===")" || ch==="]") depth--;
    if(ch===sep && depth===0){ out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out; };
const parseDecls = (body)=> splitTop(body, ";").map(d=>d.trim()).filter(Boolean).map((d, idx)=>{
  const k = d.indexOf(":"); if(k < 0) return null;
  let prop = d.slice(0, k).trim(), value = d.slice(k+1).trim(), important = false;
  if(/!\s*important$/i.test(value)){ important = true; value = value.replace(/!\s*important$/i, "").trim(); }
  if(!prop.startsWith("--")) prop = prop.toLowerCase();
  return { prop, value, important, idx };
}).filter(Boolean);

/* selectors → [{ comb, c:{ tag, id, cls, attrs, pseudo, pel } }], left to right; comb is the
   combinator BEFORE the compound (the first one's is null, or ">" in a relative :has(> …)) */
function parseSel(sel){
  const s = sel.trim(), out = []; let i = 0, comb = null;
  const fresh = ()=>({ tag:null, id:null, cls:[], attrs:[], pseudo:[], pel:false });
  let c = fresh(), empty = true;
  const ident = ()=>{ let j = i; while(j < s.length && /[\w\-\\ -￿]/.test(s[j])){ if(s[j]==="\\") j++; j++; }
    if(j===i) throw Error("selector? "+sel); const v = s.slice(i, j).replace(/\\(.)/g, "$1"); i = j; return v; };
  const paren = ()=>{ let depth = 0, j = i, q = null;
    for(; j < s.length; j++){ const ch = s[j]; if(q){ if(ch===q) q = null; continue; } if(ch==='"' || ch==="'"){ q = ch; continue; }
      if(ch==="(") depth++; else if(ch===")"){ depth--; if(!depth) break; } }
    const arg = s.slice(i+1, j); i = j+1; return arg; };
  const push = ()=>{ if(!empty) out.push({ comb, c }); c = fresh(); empty = true; };
  while(i < s.length){
    const ch = s[i];
    if(/[\s>+~]/.test(ch)){
      let j = i, k = null; while(j < s.length && /[\s>+~]/.test(s[j])){ if(!/\s/.test(s[j])) k = s[j]; j++; }
      if(!empty){ push(); comb = k || " "; } else if(!out.length && k) comb = k;
      i = j; continue;
    }
    empty = false;
    if(ch==="*"){ i++; continue; }
    if(ch==="."){ i++; c.cls.push(ident()); continue; }
    if(ch==="#"){ i++; c.id = ident(); continue; }
    if(ch==="["){ const j = s.indexOf("]", i), body = s.slice(i+1, j); i = j+1;
      const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([is])?)?\s*$/.exec(body);
      if(!m) throw Error("attribute selector? ["+body+"]");
      c.attrs.push({ name:m[1].toLowerCase(), op:m[2]||null, val:m[3]!=null ? m[3] : m[4]!=null ? m[4] : m[5], ci:m[6]==="i" }); continue; }
    if(ch===":"){
      if(s[i+1]===":"){ i += 2; ident(); if(s[i]==="(") paren(); c.pel = true; continue; }
      i++; const name = ident().toLowerCase(), arg = s[i]==="(" ? paren() : null;
      if(["before","after","first-line","first-letter"].includes(name)) c.pel = true; else c.pseudo.push({ name, arg });
      continue; }
    c.tag = ident().toLowerCase();
  }
  push(); return out;
}
const cmpSpec = (x, y)=> x[0]-y[0] || x[1]-y[1] || x[2]-y[2];
function specOf(P){
  let a = 0, b = 0, c = 0;
  for(const { c:k } of P){
    if(k.id) a++; b += k.cls.length + k.attrs.length; if(k.tag) c++; if(k.pel) c++;
    for(const p of k.pseudo){
      if(p.name==="where") continue;
      if(["not","is","has","matches","-webkit-any"].includes(p.name)){
        const m = splitTop(p.arg, ",").map(x=>specOf(parseSel(x))).sort(cmpSpec).pop() || [0,0,0];
        a += m[0]; b += m[1]; c += m[2];
      } else b++;
    }
  }
  return [a, b, c];
}

/* the stylesheet: every style rule with its at-rule context (keyframes / font-face skipped) */
const sheet = (()=>{
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m)=>" ".repeat(m.length));
  const rules = [], stack = []; let start = 0, q = null;
  for(let i = 0; i < src.length; i++){
    const ch = src[i];
    if(q){ if(ch===q) q = null; continue; }
    if(ch==='"' || ch==="'"){ q = ch; continue; }
    if(ch==="{"){ stack.push({ prelude:src.slice(start, i).split(";").pop().trim(), bodyStart:i+1 }); start = i+1; }
    else if(ch==="}"){ const top = stack.pop(); start = i+1; if(!top || top.prelude.startsWith("@")) continue;
      const ctx = stack.map(x=>x.prelude.replace(/\s+/g, " "));
      if(ctx.some(p=>/^@(-webkit-)?(keyframes|font-face|page)/i.test(p))) continue;
      rules.push({ order:rules.length, ctx, selText:splitTop(top.prelude, ",").map(x=>x.trim().replace(/\s+/g, " ")).filter(Boolean),
        decls:parseDecls(src.slice(top.bodyStart, i)), parsed:null }); }
  }
  return rules;
})();
const SHORTHANDS = { padding:["padding-top","padding-right","padding-bottom","padding-left"],
  margin:["margin-top","margin-right","margin-bottom","margin-left"], inset:["top","right","bottom","left"] };
function longhand(d, prop){
  if(d.prop===prop) return d.value;
  for(const [sh, longs] of Object.entries(SHORTHANDS)){
    const k = longs.indexOf(prop); if(k < 0 || d.prop!==sh) continue;
    const v = splitTop(d.value.replace(/\s+/g, " ").trim(), " ").filter(Boolean);
    if(/^(inherit|initial|unset|revert)$/.test(v[0])) return v[0];
    return (v.length===1 ? [v[0],v[0],v[0],v[0]] : v.length===2 ? [v[0],v[1],v[0],v[1]] : v.length===3 ? [v[0],v[1],v[2],v[1]] : v)[k];
  }
  if(d.prop==="flex-flow" && (prop==="flex-direction" || prop==="flex-wrap")){
    const v = d.value.split(/\s+/);
    return prop==="flex-direction" ? (v.find(t=>/^(row|column)(-reverse)?$/.test(t)) || "row") : (v.find(t=>/^(nowrap|wrap|wrap-reverse)$/.test(t)) || "nowrap");
  }
  if(d.prop==="overflow" && (prop==="overflow-x" || prop==="overflow-y")){ const v = d.value.split(/\s+/); return prop==="overflow-x" ? v[0] : (v[1] || v[0]); }
  return null;
}
const byProp = new Map();   // prop → the rules that may set it (directly or by shorthand)
function rulesFor(prop){
  if(!byProp.has(prop)) byProp.set(prop, sheet.filter(r=>r.decls.some(d=>longhand(d, prop)!=null)));
  return byProp.get(prop);
}

/* media: width / height from the viewport; hover / pointer from `touch`; reduced motion off */
function mediaOK(ctx, env){
  return ctx.every(p=>{
    if(/^@supports/i.test(p)) return true;
    // a container query depends on its element's width, which this model doesn't lay out: treated as not
    // applying (the one in use, 2026-10-21, only trims the spine Key's label on a narrow tools row)
    if(/^@container/i.test(p)) return false;
    if(!/^@media/i.test(p)) throw Error("at-rule context? "+p);
    return splitTop(p.replace(/^@media/i, "").trim(), ",").some(part=>{
      let qx = part.trim(), neg = false;
      if(/^not\s/i.test(qx)){ neg = true; qx = qx.replace(/^not\s+/i, ""); }
      qx = qx.replace(/^only\s+/i, "");
      const ok = qx.split(/\s+and\s+/i).map(t=>t.trim()).filter(Boolean).every(t=>{
        if(/^(screen|all)$/i.test(t)) return true;
        if(/^print$/i.test(t)) return false;
        const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/i.exec(t); if(!m) throw Error("media query? "+t);
        const f = m[1].toLowerCase(), v = (m[2]||"").trim().toLowerCase();
        const px = ()=>{ const n = /^(\d+(?:\.\d+)?)px$/.exec(v); if(!n) throw Error("media length? "+t); return Number(n[1]); };
        if(f==="max-width") return env.w <= px(); if(f==="min-width") return env.w >= px();
        if(f==="max-height") return env.h <= px(); if(f==="min-height") return env.h >= px();
        if(f==="hover" || f==="any-hover") return v==="none" ? env.touch : !env.touch;
        if(f==="pointer" || f==="any-pointer") return v==="coarse" ? env.touch : v==="fine" ? !env.touch : false;
        if(f==="prefers-reduced-motion") return v==="no-preference";
        if(f==="prefers-color-scheme") return v===(env.scheme || "light");
        if(f==="orientation") return v==="portrait" ? env.h >= env.w : env.w > env.h;
        throw Error("media feature? "+t);
      });
      return neg ? !ok : ok;
    });
  });
}

/* ── a small DOM: the fixture parsed, with the selector engine that runs on it ──────────── */
function parseHTML(html){
  const doc = { tag:"#document", attrs:{}, cls:[], id:null, children:[], parent:null, states:new Set(), style:[], text:"" };
  const VOID = new Set(["meta","link","br","img","input","hr","source","wbr","area","base","col","embed","track"]);
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let cur = doc, m;
  while((m = re.exec(html))){
    if(m[2]){ const t = m[2].toLowerCase(); let n = cur; while(n && n.tag!==t) n = n.parent; if(n) cur = n.parent; continue; }
    if(m[3]){
      const tag = m[3].toLowerCase(), attrs = {};
      (m[4]||"").replace(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (_, k, a, b, c)=>{ attrs[k.toLowerCase()] = a!=null ? a : b!=null ? b : c!=null ? c : ""; return ""; });
      const el = { tag, attrs, cls:(attrs.class||"").split(/\s+/).filter(Boolean), id:attrs.id || null, children:[], parent:cur,
        states:new Set(), style:attrs.style ? parseDecls(attrs.style) : [], text:"" };
      cur.children.push(el);
      if(!VOID.has(tag) && !m[5]) cur = el;
      continue;
    }
    if(m[6] && m[6].trim()) cur.text += m[6].trim();
  }
  return doc;
}
const isEl = (n)=> n && n.tag!=="#document";
function each(root, f){ for(const ch of root.children){ f(ch); each(ch, f); } }
const STATE_PSEUDO = new Set(["hover","focus","focus-visible","focus-within","active","visited","target","checked","indeterminate",
  "placeholder-shown","invalid","valid","required","optional","autofill","fullscreen","modal","popover-open","open","default","user-invalid"]);
const FORM = new Set(["button","input","select","textarea","option","fieldset"]);
function nth(arg, n){
  const a = arg.trim().toLowerCase();
  if(a==="odd") return n % 2===1; if(a==="even") return n % 2===0;
  const m = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(a.replace(/\s+/g, ""));
  if(!m) return n===Number(a);
  const A = m[1]==="" || m[1]==="+" ? 1 : m[1]==="-" ? -1 : Number(m[1]), B = m[2] ? Number(m[2]+m[3]) : 0;
  return A===0 ? n===B : ((n - B) / A >= 0 && (n - B) % A===0);
}
function matchCompound(el, k, scope){
  if(!isEl(el) || k.pel) return false;
  if(k.tag && k.tag!==el.tag) return false;
  if(k.id && k.id!==el.id) return false;
  for(const c of k.cls) if(!el.cls.includes(c)) return false;
  for(const a of k.attrs){
    const has = Object.prototype.hasOwnProperty.call(el.attrs, a.name); if(!has) return false;
    if(!a.op) continue;
    let v = String(el.attrs[a.name]), w = String(a.val); if(a.ci){ v = v.toLowerCase(); w = w.toLowerCase(); }
    const ok = a.op==="=" ? v===w : a.op==="~=" ? v.split(/\s+/).includes(w) : a.op==="^=" ? v.startsWith(w)
      : a.op==="$=" ? v.endsWith(w) : a.op==="*=" ? v.includes(w) : a.op==="|=" ? (v===w || v.startsWith(w+"-")) : false;
    if(!ok) return false;
  }
  const sibs = el.parent ? el.parent.children : [el], at = sibs.indexOf(el), same = sibs.filter(x=>x.tag===el.tag), atT = same.indexOf(el);
  for(const p of k.pseudo){
    const n = p.name, ok =
      n==="root" ? el.tag==="html"
      : n==="not" ? !splitTop(p.arg, ",").some(x=>matches(el, x.trim(), scope))
      : (n==="is" || n==="where" || n==="matches" || n==="-webkit-any") ? splitTop(p.arg, ",").some(x=>matches(el, x.trim(), scope))
      : n==="has" ? splitTop(p.arg, ",").some(x=>hasRel(el, x.trim()))
      : n==="first-child" ? at===0 : n==="last-child" ? at===sibs.length-1 : n==="only-child" ? sibs.length===1
      : n==="nth-child" ? nth(p.arg, at+1) : n==="nth-last-child" ? nth(p.arg, sibs.length-at)
      : n==="first-of-type" ? atT===0 : n==="last-of-type" ? atT===same.length-1 : n==="only-of-type" ? same.length===1
      : n==="nth-of-type" ? nth(p.arg, atT+1) : n==="nth-last-of-type" ? nth(p.arg, same.length-atT)
      : n==="empty" ? (!el.children.length && !el.text)
      : n==="defined" ? true
      : n==="disabled" ? (FORM.has(el.tag) && "disabled" in el.attrs)
      : n==="enabled" ? (FORM.has(el.tag) && !("disabled" in el.attrs))
      : (n==="link" || n==="any-link") ? (el.tag==="a" && "href" in el.attrs)
      : n==="read-write" ? ((el.tag==="textarea" || el.tag==="input") && !("readonly" in el.attrs))
      : n==="read-only" ? !((el.tag==="textarea" || el.tag==="input") && !("readonly" in el.attrs))
      : STATE_PSEUDO.has(n) ? el.states.has(n)
      : /^-(webkit|moz|ms)-/.test(n) ? false
      : (()=>{ throw Error("pseudo-class? :"+n); })();
    if(!ok) return false;
  }
  return true;
}
/* right to left; `scope` bounds the walk (a relative :has() argument stays inside its subject) */
function matchAt(el, P, i, scope){
  if(!matchCompound(el, P[i].c, scope)) return false;
  if(i===0) return !scope || (P[0].comb===">" ? el.parent===scope.el : within(el, scope.el));
  const up = (n)=>{ const p = n.parent; return isEl(p) && (!scope || p!==scope.el) ? p : null; };
  const prev = (n)=>{ const sibs = n.parent ? n.parent.children : []; const k = sibs.indexOf(n); return k > 0 ? sibs[k-1] : null; };
  const comb = P[i].comb;
  if(comb===">"){ const p = up(el); return !!p && matchAt(p, P, i-1, scope); }
  if(comb==="+"){ const p = prev(el); return !!p && matchAt(p, P, i-1, scope); }
  if(comb==="~"){ for(let p = prev(el); p; p = prev(p)) if(matchAt(p, P, i-1, scope)) return true; return false; }
  for(let p = up(el); p; p = up(p)) if(matchAt(p, P, i-1, scope)) return true;
  return false;
}
function within(n, root){ for(let p = n.parent; p; p = p.parent) if(p===root) return true; return false; }
const parsedCache = new Map();
const parsedSel = (x)=>{ if(!parsedCache.has(x)) parsedCache.set(x, parseSel(x)); return parsedCache.get(x); };
const matches = (el, sel, scope)=>{ const P = parsedSel(sel); return P.length ? matchAt(el, P, P.length-1, scope) : false; };
function hasRel(el, rel){
  const P = parsedSel(rel); if(!P.length) return false;
  let found = false; each(el, (d)=>{ if(!found && matchAt(d, P, P.length-1, { el })) found = true; });
  return found;
}
const qsa = (root, sel)=>{ const out = []; each(root, (n)=>{ if(matches(n, sel)) out.push(n); }); return out; };
const qs = (root, sel)=> qsa(root, sel)[0] || null;

/* ── computed values ─────────────────────────────────────────────────────────── */
const INHERITED = new Set(["white-space","visibility","color","cursor","font-family","font-size","font-weight","line-height","letter-spacing","text-transform","direction"]);
const TAG_DISPLAY = { html:"block", body:"block", div:"block", nav:"block", main:"block", aside:"block", header:"block", footer:"block",
  section:"block", ul:"block", ol:"block", p:"block", li:"list-item", button:"inline-block", select:"inline-block", input:"inline-block",
  textarea:"inline-block", head:"none", meta:"none", link:"none", title:"none", script:"none", style:"none" };
const INITIAL = { position:"static", "z-index":"auto", opacity:"1", "white-space":"normal", "flex-direction":"row", "flex-wrap":"nowrap",
  "padding-top":"0px", "padding-right":"0px", "padding-bottom":"0px", "padding-left":"0px", top:"auto", right:"auto", bottom:"auto", left:"auto",
  width:"auto", height:"auto", "max-width":"none", transform:"none", filter:"none", isolation:"auto", visibility:"visible",
  "mix-blend-mode":"normal", contain:"none", "will-change":"auto", perspective:"none", "clip-path":"none", "backdrop-filter":"none",
  "overflow-x":"visible", "overflow-y":"visible", mask:"none" };
/* computed values are memoised per element, viewport and document generation; every edit the
   checks make to the tree (classes, children, inline styles) bumps the generation */
let GEN = 0;
const bump = ()=>{ GEN++; };
const memo = new WeakMap();
function computed(el, prop, env){
  const key = GEN+"|"+env.w+"x"+env.h+(env.touch ? "t" : "")+(env.scheme||"")+"|"+prop;
  let m = memo.get(el); if(!m){ m = new Map(); memo.set(el, m); }
  if(!m.has(key)) m.set(key, computedRaw(el, prop, env));
  return m.get(key);
}
function computedRaw(el, prop, env){
  let best = null;
  const take = (cand)=>{ if(!best || (cand.important!==best.important ? cand.important : (cmpSpec(cand.spec, best.spec) || cand.order - best.order) > 0)) best = cand; };
  for(const r of rulesFor(prop)){
    if(!mediaOK(r.ctx, env)) continue;
    let spec = null;
    for(const x of r.selText){ const P = parsedSel(x); if(P.length && matchAt(el, P, P.length-1, null)){ const sp = specOf(P); if(!spec || cmpSpec(sp, spec) > 0) spec = sp; } }
    if(!spec) continue;
    for(const d of r.decls){ const v = longhand(d, prop); if(v!=null) take({ value:v, important:d.important, spec, order:r.order*1000+d.idx }); }
  }
  for(const d of el.style){ const v = longhand(d, prop); if(v!=null) take({ value:v, important:d.important, spec:[1e9,0,0], order:1e12+d.idx }); }
  const parent = isEl(el.parent) ? el.parent : null, inherits = INHERITED.has(prop) || prop.startsWith("--");
  let v = best ? best.value : null;
  if(v!=null && /^inherit$/i.test(v)) v = parent ? computed(parent, prop, env) : initialOf(el, prop);
  else if(v!=null && /^(initial|unset|revert|revert-layer)$/i.test(v)) v = (!/^initial$/i.test(v) && inherits && parent) ? computed(parent, prop, env) : initialOf(el, prop);
  else if(v==null) v = (inherits && parent) ? computed(parent, prop, env) : initialOf(el, prop);
  v = v==null ? null : resolveVars(v, el, env, 0);
  if(prop==="display" && v){   // blockification: a positioned box, or a flex / grid item
    const pos = computed(el, "position", env), pd = parent ? computed(parent, "display", env) : "";
    if(pos==="absolute" || pos==="fixed" || /(^|-)(flex|grid)$/.test(pd))
      v = v==="inline" || v==="inline-block" ? "block" : v==="inline-flex" ? "flex" : v==="inline-grid" ? "grid" : v;
  }
  return v;
}
function initialOf(el, prop){
  if(prop==="display") return TAG_DISPLAY[el.tag] || "inline";
  if(prop.startsWith("--")) return null;
  return INITIAL[prop]!=null ? INITIAL[prop] : null;
}
function resolveVars(v, el, env, depth){
  if(depth > 12 || !/var\(/.test(v)) return v;
  return resolveVars(v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, name, fb)=>{
    const c = computed(el, name, env); return c!=null ? c : (fb!=null ? fb.trim() : ""); }), el, env, depth+1);
}
const pxOf = (v, label)=>{ const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v).trim()); assert.ok(m, label+": a px length, got "+v); return Number(m[1]); };
/* does this box start a stacking context (the properties this stylesheet could use)? */
function stacks(el, env){
  const C = (p)=>computed(el, p, env), pos = C("position"), z = C("z-index");
  return (pos!=="static" && z!=="auto") || pos==="fixed" || pos==="sticky" || Number(C("opacity")) < 1 || C("transform")!=="none"
    || C("filter")!=="none" || C("isolation")==="isolate" || C("mix-blend-mode")!=="normal" || /paint|layout|strict|content/.test(C("contain"))
    || /transform|opacity|filter|perspective/.test(C("will-change")) || C("perspective")!=="none" || C("clip-path")!=="none"
    || C("backdrop-filter")!=="none";
}
/* where a box paints among the page's top-level layers: the z-index of its outermost
   stacking-context ancestor (or its own), so two boxes in different branches compare correctly */
function rootLayer(el, env){
  let top = null;
  for(let n = el; isEl(n) && n.tag!=="html" && n.tag!=="body"; n = n.parent) if(stacks(n, env)) top = n;
  if(!top) return 0;
  const z = computed(top, "z-index", env); return z==="auto" ? 0 : Number(z);
}
/* is it laid out at all (it and every ancestor displayed)? */
const displayed = (el, env)=>{ for(let n = el; isEl(n); n = n.parent) if(computed(n, "display", env)==="none") return false; return true; };

/* the fixture as it stands while Part B measures at this size: the phone class the app sets,
   the drawer's scrim, the item list's textarea focused, the toasts up, the Team window closed */
function fixtureState(doc, env){
  const app = qs(doc, ".app"), scrim = qs(doc, "#scrim"), ta = qs(doc, "#eil-in");
  app.cls = app.cls.filter(c=>c!=="vp-mobile").concat(env.w <= 700 ? ["vp-mobile"] : []);
  scrim.style = env.w <= 700 ? [] : parseDecls("display:none");
  each(doc, (n)=>n.states.clear());
  ta.states.add("focus"); ta.states.add("focus-visible");
  for(let p = ta.parent; isEl(p); p = p.parent) p.states.add("focus-within");
  bump();
  return doc;
}
const fixtureDoc = ()=> parseHTML(fixture());
/* the cross-check list Part B reads back with getComputedStyle: [selector, property, at ≤ width] */
const XCHECK = [
  [".topbar","position"],[".topbar","z-index"],["#ovf","display"],["#ovf-art","display"],["#m-new","display"],["#m-brief","display"],
  ["#m-team","display"],["#a-team","display"],["#brief","display"],["#newstory","display"],["#ovf .export-menu","position"],["#ovf .export-menu","z-index"],
  ["#modal","position"],["#modal","z-index"],["#scrim","z-index"],["#scrim","display"],[".inspector","position"],[".inspector","z-index"],
  [".muse-dock-wrap","position"],[".muse-dock-wrap","z-index"],["#wdock","position"],["#wdock","z-index"],["#iscroll","padding-bottom"],
  ["#t1","position"],["#t1","z-index"],["#t2","z-index"],["#t1","right",640],["#t2","right",640],["#t1","bottom"],["#t2","bottom"],
  ["#rt","display"],["#rt","white-space"],["#pos","display"],[".legend","display"],["#eil-del","opacity"],[".script-tools","flex-direction"],
  [".script-tools","flex-wrap"],["#sgr","display"],["#sga","display"],
];
const normCss = (v)=>{ v = String(v==null ? "" : v).trim().replace(/\s+/g, " ").toLowerCase();
  if(/^-?\d*\.?\d+$/.test(v)) return String(Number(v)); if(/^-?0(px)?$/.test(v)) return "0px"; return v; };
function staticValues(env){
  const doc = fixtureState(fixtureDoc(), env), out = {};
  for(const [sel, prop, maxW] of XCHECK){ if(maxW && env.w > maxW) continue; const el = qs(doc, sel); assert.ok(el, "fixture has "+sel);
    out[sel+" "+prop] = normCss(computed(el, prop, env)); }
  return out;
}

const MIN_TOAST_H = 56;   // an undo toast's floor: 11px + 32px button + 11px padding, 1px borders
for(const [w, h, name] of SIZES){
  for(const touch of (w <= 700 ? [false, true] : [false])){
    const env = { w, h, touch, scheme:"light" };
    const tag = "S "+name+" "+w+"px"+(touch ? " (touch)" : "")+": ";
    await test(tag+"layout guarantees, from the cascade", ()=>{
      const doc = fixtureState(fixtureDoc(), env), $ = (s)=>{ const el = qs(doc, s); assert.ok(el, s); return el; };
      const C = (s, p)=>computed($(s), p, env), shown = (s)=>displayed($(s), env), L = (s)=>rootLayer($(s), env);
      // 1. the phone ⋯ carries the buttons a phone hides; desktop keeps them in the bar
      if(w <= 700) assert.ok(!shown("#brief") && !shown("#team") && !shown("#newstory") && shown("#ovf") && shown("#m-new") && shown("#m-brief")
        && shown("#m-team") && shown("#ovf-art") && shown("#a-team"), tag+"phone: the plain buttons hide, the ⋯ and its phone entries show");
      else assert.ok(shown("#brief") && shown("#team") && shown("#newstory") && !shown("#ovf") && shown("#ovf-art") && !shown("#a-team"),
        tag+"desktop: the buttons stay, the ⋯ only in the Art Room, without the phone entries");
      // 2. layers: with a menu or window inside, the bar paints above the drawers, the scrim, the Frances
      //    bubble, the Writing dock and the undo toasts, and below a confirm and the toast stack
      assert.ok(C(".topbar", "position")!=="static", tag+"the bar is positioned (z-index applies)");
      const bar = L(".topbar");
      assert.equal(bar, 130, tag+"the raised bar's layer");
      for(const s of ["#scrim", ".inspector", ".muse-dock-wrap", "#wdock", "#t1", "#t2"])
        assert.ok(bar > L(s), tag+"the raised bar is above "+s+" ("+bar+" vs "+L(s)+")");
      for(const s of ["#ovf .export-menu", "#modal"]) assert.ok(C(s, "position")!=="static", tag+s+" is positioned inside the bar");
      assert.ok(C("#modal", "position")==="fixed", tag+"a top-bar window covers the viewport from inside the raised bar");
      assert.ok(L("#wdock") < 130 && L(".muse-dock-wrap") < 130, tag+"Team / Story brief windows (inside the bar) cover the dock and the bubble");
      // (review 2026-09-29) on a phone the Images dock sits in the bubble's corner (bottom:18px): the docks
      // paint above the Frances bubble there, or its 16:9 / 2K chips are hidden under the orb
      if(w <= 700) assert.ok(L("#wdock") > L(".muse-dock-wrap"), tag+"phone: the engine docks sit above the Frances bubble ("+L("#wdock")+" vs "+L(".muse-dock-wrap")+")");
      if(w <= 700) assert.ok(L(".inspector") > L("#scrim") && L("#t1") > L("#scrim"), tag+"the drawer and the toasts sit above the scrim");
      // a confirm and the toasts stay on top of the raised bar (appended at the end of <body>, as in the app)
      const body = qs(doc, "body");
      const extra = parseHTML('<div class="appconfirm-scrim" id="xc"></div><div id="turn-toasts"></div>');
      extra.children.forEach(n=>{ n.parent = body; body.children.push(n); }); bump();
      assert.ok(L("#xc") > bar && L("#turn-toasts") > bar, tag+"dialogs and toasts stay above the raised bar");
      // resting: no menu and no window inside → the bar is back at its own layer; the class raises it too
      const top = $(".topbar"), right = qs(top, ".tb-right"), kids = right.children.slice();
      right.children = kids.filter(n=>!matches(n, ".bible-overlay") && !matches(n, ".overflow-wrap")); bump();
      assert.equal(L(".topbar"), 30, tag+"resting bar");
      top.cls.push("is-raised"); bump();
      assert.equal(L(".topbar"), 130, tag+".is-raised (the no-:has() path) raises it the same");
      top.cls.pop(); right.children = kids; bump();
      // 3. the Scene panel's scroll end clears the Frances bubble
      const clear = pxOf(C("#iscroll", "padding-bottom"), "the Scene panel's bottom padding");
      const mb = pxOf(C(".muse-dock-wrap", "bottom"), "bubble bottom"), mr = pxOf(C(".muse-dock-wrap", "right"), "bubble right");
      const bw = pxOf(C("#muse", "width"), "bubble width"), bh = pxOf(C("#muse", "height"), "bubble height");
      assert.ok(C(".muse-dock-wrap", "position")==="fixed", tag+"the bubble floats");
      assert.ok(clear >= mb + bh + 8 && clear >= mr + bw + 8, tag+"the Scene panel scrolls its last row above the bubble ("+clear+"px vs "+(mb+bh)+"/"+(mr+bw)+")");
      assert.ok(/^(auto|scroll)$/.test(C("#iscroll", "overflow-y")), tag+"…because the panel scrolls");
      assert.ok(shown("#del"), tag+"Delete is laid out");
      // 4. the undo toasts: clear of the bubble and the Writing dock on a phone, never overlapping each other
      const t1b = pxOf(C("#t1", "bottom"), "toast bottom"), t2b = pxOf(C("#t2", "bottom"), "stacked toast bottom");
      assert.ok(t2b - t1b >= MIN_TOAST_H + 2, tag+"the stacked toast sits above the other ("+(t2b - t1b)+"px apart)");
      assert.ok(C("#t1", "position")==="fixed" && C("#t2", "position")==="fixed");
      if(w <= 640){
        for(const t of ["#t1", "#t2"]){
          const tr = pxOf(C(t, "right"), t+" right"), tl = pxOf(C(t, "left"), t+" left");
          assert.ok(tr >= mr + bw, tag+t+"'s right end stops short of the bubble ("+tr+"px)");
          const dr = pxOf(C("#wdock", "right"), "dock right"), dw = /px$/.test(C("#wdock", "width")) ? pxOf(C("#wdock", "width"), "dock width") : 54;
          assert.ok(tr >= dr + dw, tag+t+" stops short of the Writing dock ("+tr+" vs "+(dr+dw)+")");
          assert.ok(tl >= 0 && C(t, "transform")==="none" && C(t, "width")==="auto", tag+t+" spans between its insets");
        }
      } else assert.ok(C("#t1", "left")==="50%" && /translate/.test(C("#t1", "transform")) && C("#t1", "width")==="max-content", tag+"the toast is centred, sized to its words");
      // 5. the runtime total always shows, on one line, and so does the Key (its card holds the colours, 2026-10-21)
      assert.ok(shown("#rt") && C("#rt", "white-space")==="nowrap" && shown(".legend"), tag+"the runtime shows, on one line");
      assert.equal(shown("#pos"), true, tag+"the Key shows at every width");
      // 6. the item list's × shows while its row has focus
      assert.equal(Number(C("#eil-del", "opacity")), 1, tag+"the × shows with the row focused");
      assert.ok(shown("#eil-del"));
      // 7. "Redraft N out-of-date" has its own strip; on a phone the header stacks its strips
      assert.ok(shown("#sgr") && shown("#s-rall") && shown("#s-edit"), tag+"the Redraft strip and Edit are laid out");
      const dir = C(".script-tools", "flex-direction"), wrap = C(".script-tools", "flex-wrap");
      assert.ok(dir==="column" || wrap==="wrap", tag+"the strips wrap or stack instead of pushing Edit away");
      if(w <= 640) assert.ok(dir==="column" && C("#sgr", "max-width")==="100%", tag+"on a phone each strip has its own line and fits the width");
    });
  }
}

async function browserPart(){
  if(!CHROME){
    // (review) a machine that must run the layout checks can't pass without them
    if(process.env.CI || process.env.REQUIRE_BROWSER){ console.log("FAIL B — no Chrome/Chromium binary, and CI / REQUIRE_BROWSER is set (set CHROMIUM)"); process.exit(1); }
    console.log("SKIP B — no Chrome/Chromium binary (set CHROMIUM to measure in a browser). The layout guarantees still ran from the"
      +" stylesheet's cascade in Part S above; only real text widths go unmeasured (a centred toast vs the bubble above 640px, Edit fitting its strip).");
    return; }
  if(typeof WebSocket!=="function"){ console.log("SKIP B — this Node has no WebSocket"); return; }
  const dir = mkdtempSync(join(tmpdir(), "round1-ui-"));
  writeFileSync(join(dir, "styles.css"), css);
  writeFileSync(join(dir, "fixture.html"), fixture());
  const port = 9300 + Math.floor(Math.random()*400);
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port="+port, "--user-data-dir="+join(dir, "profile"), "about:blank"], { stdio:"ignore" });
  const until = async (f, label, ms=15000)=>{ const end = Date.now()+ms; while(Date.now()<end){ try{ const v = await f(); if(v) return v; }catch(e){} await new Promise(r=>setTimeout(r, 100)); } throw Error("timeout: "+label); };
  let ws;
  try{
    const page = await until(async()=>(await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(t=>t.type==="page"), "chrome");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, bad)=>{ ws.onopen = ok; ws.onerror = bad; });
    let id = 0; const waiting = new Map();
    ws.onmessage = (m)=>{ const x = JSON.parse(m.data); const f = waiting.get(x.id); if(f){ waiting.delete(x.id); f(x); } };
    const call = (method, params={})=>new Promise((ok, bad)=>{ const i = ++id; waiting.set(i, x=>x.error ? bad(Error(x.error.message)) : ok(x.result)); ws.send(JSON.stringify({ id:i, method, params })); });
    const evaluate = async (expr)=>(await call("Runtime.evaluate", { expression:expr, returnByValue:true, awaitPromise:true })).result.value;
    await call("Page.enable");
    await call("Page.navigate", { url:"file://"+join(dir, "fixture.html") });
    await until(()=>evaluate("document.readyState==='complete' && typeof window.measure==='function'"), "fixture");
    const sizes = SIZES;
    for(const [w, h, name] of sizes){
      await call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:1, mobile:w<=700 });
      await call("Emulation.setFocusEmulationEnabled", { enabled:true });
      const m = await evaluate("measure("+JSON.stringify(XCHECK)+")");
      const tag = name+" "+w+"px: ";
      assert.equal(m.w, w, tag+"viewport");
      assert.ok(m.del && !m.delUnderMuse, tag+"the Scene panel's Delete is clear of the MUSE bubble at the end of the scroll "+JSON.stringify(m));
      m.toasts.forEach(t=>{
        assert.ok(t.x && t.undo, tag+"the undo toast's Undo and × are on top ("+t.id+") "+JSON.stringify(t));
        assert.ok(!t.underMuse && !t.underDock && t.inView, tag+"the toast clears the MUSE bubble and the Writing dock ("+t.id+") "+JSON.stringify(t));
      });
      assert.ok(m.toastsApart, tag+"two undo toasts don't overlap "+JSON.stringify(m.toastRects));
      assert.ok(m.rt && m.rtH < 20, tag+"the total runtime shows, on one line ("+m.rtH+"px)");
      assert.equal(m.pos, true, tag+"the Key shows at every width");
      assert.equal(m.eilDel, "1", tag+"the item-list × shows while its row has focus");
      assert.equal(m.eilTab, 0, tag+"…and Tab reaches it");
      assert.ok(m.modalTap, tag+"a top-bar window (Team, Story brief) is on top of the MUSE bubble and the Writing dock "+JSON.stringify({ modalTap:m.modalTap, over:m.modalOverMuse }));
      assert.ok(m.sc.rall && !m.sc.sideways, tag+"'Redraft N out-of-date' is fully on screen, and the header doesn't scroll sideways "+JSON.stringify(m.sc));
      if(w >= 375) assert.ok(m.sc.edit, tag+"…and Edit stays in view in its strip "+JSON.stringify(m.sc));
      if(w <= 640) assert.ok(m.sc.ownLine, tag+"on a phone it has its own line "+JSON.stringify(m.sc));
      if(w <= 700) assert.ok(m.menuTap, tag+"phone: the ⋯ entries are tappable over the open Scene drawer");
      if(w <= 700) assert.ok(m.tbHidden && m.ovf && m.mNew && m.mBrief && m.mTeam && m.artOvf && m.aTeam, tag+"phone: buttons move into the ⋯ "+JSON.stringify(m));
      else assert.ok(!m.tbHidden && !m.ovf && m.artOvf && !m.aTeam, tag+"desktop: the buttons stay, the ⋯ only in the Art Room, without the phone entries "+JSON.stringify(m));
      // the static cascade (Part S) must agree with the browser on every value it predicts
      const want = staticValues({ w, h, touch:false, scheme:"light" });
      for(const k of Object.keys(want)) assert.equal(normCss(m.styles[k]), want[k], tag+"Part S agrees with Chrome on "+k);
      console.log("PASS B "+tag+"layout ("+Object.keys(want).length+" computed values match Part S)");
      passed++;
    }
  } finally {
    try{ ws && ws.close(); }catch(e){}
    chrome.kill("SIGKILL");
    await new Promise(r=>setTimeout(r, 300));
    try{ rmSync(dir, { recursive:true, force:true }); }catch(e){}
  }
}
await browserPart();

console.log(passed+" passed, 0 failed");

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
const chromeSrc = read("app/chrome.jsx"), teamSrc = read("app/team.jsx"), inspSrc = read("app/inspector.jsx"),
  spineSrc = read("app/spine.jsx"), css = read("app/styles.css"), appSrc = read("app/app.jsx");
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
  assert.ok(chromeSrc.includes('storyBriefShown(room, project) && React.createElement("button",{className:"tb-btn",onClick:()=>setBriefOpen(true),'), "the top-bar button uses it");
});

const topBar = (room, admin, extra)=>{
  cb.turnIsAdmin = !!admin; cb.React.reset();
  return cb.TopBar({ room, setRoom:noop, project:{ title:"F", sourceBrief:"B" }, scenes:scenes2, drafts:{}, onReset:admin?noop:null,
    onNewStory:noop, theme:"dark", onTheme:noop, ...(extra||{}) });
};
await test("1 the ⋯ menu renders for EVERY user in the Writers' Room (the stylesheet keeps it phone-only there)", ()=>{
  const has = (t)=> findAll(t, n=>n.type===cb.OverflowMenu).length===1;
  assert.ok(has(topBar("writers", false)), "non-admin, Writers' Room");
  assert.ok(has(topBar("writers", true)), "admin, Writers' Room");
  assert.ok(has(topBar("art", false)), "Art Room, as before");
  assert.ok(!has(topBar("stage", false)), "the Stage is unchanged for non-admins");
  assert.ok(has(topBar("stage", true)), "admins keep it everywhere");
  cb.turnIsAdmin = false;
  assert.ok(chromeSrc.includes("React.createElement(OverflowMenu,{onNewStory,project,scenes,drafts,onReset,room,\n        artView,setArtView,artTabLocks,hiddenArtTabs}),"),
    "the call test-art-tab-locks pins is unchanged");
});

await test("1 a non-admin's phone menu in the Writers' Room: New Story · Story brief · Team · the four exports — no Reset", ()=>{
  let teamOpened = 0;
  cb.turnTeamMenu = { open:()=>{ teamOpened++; }, hint:"Team collaboration" };
  const tree = openMenu({ project:{ sourceBrief:"The brief", logline:"L" }, scenes:scenes2 });
  const items = menuItems(tree);
  assert.deepEqual(items.map(itemTitle), ["New Story","Story brief","Team","Screenplay (PDF)","Screenplay (.fountain)","Story outline (.txt)","Spine data (.csv)"]);
  assert.equal(findAll(tree, hasClass("export-foot")).length, 0, "no Reset for a non-admin");
  const brief = items[1], team = items[2];
  assert.ok(hasClass("ovf-phone")(brief) && hasClass("ovf-phone")(team), "both are phone-only entries");
  assert.equal(textOf(findAll(brief, hasClass("s"))[0]), "What this story was built from · rebuild as a new film");
  assert.equal(textOf(findAll(team, hasClass("s"))[0]), "Team collaboration");
  brief.props.onClick();
  assert.deepEqual(cb.__dispatched, ["turn-open-brief"], "Story brief asks the top bar to open the brief window");
  assert.ok(cb.React.sets.some(s=>s.x===false), "and closes the menu");
  team.props.onClick();
  assert.equal(teamOpened, 1, "Team opens the Team window");
  cb.__dispatched.length = 0;
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
  assert.ok(art.some(n=>itemTitle(n)==="Team" && hasClass("ovf-phone")(n)), "Team is offered in the Art Room's menu too, phone-only");
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

await test("1 the Team button registers itself for the ⋯ menu while it is up for a film", ()=>{
  const R = cb.React; R.runEffects = true; R.effects.length = 0; R.reset();
  cb.teamRoleLabel = cb.teamRoleLabel || ((r)=>r);
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
  // the Writing dock stays exactly as committed in 193deaa
  assert.ok(css.includes(".nb-dock{display:block;position:fixed;right:22px;top:50%;transform:translateY(-50%);z-index:120}")
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
  assert.equal(bx.length, 9);
  assert.deepEqual(bx.slice(0,3).map(n=>n.props["aria-label"]), ["Move beat 1 up","Move beat 1 down","Delete beat 1"]);
  assert.deepEqual(bx.slice(6).map(n=>n.props.title), ["Move beat up","Move beat down","Delete beat"]);
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
await test("5 below 900px only the colour key hides: the runtime (the legend's one item with no swatch) stays", ()=>{
  const b900 = css.slice(css.indexOf("@media (max-width:900px){\n  .topbar{gap:8px;padding:0 12px}"));
  const block = b900.slice(0, b900.indexOf("\n}\n"));
  assert.ok(!/\.legend\{display:none\}/.test(block), "the legend is no longer hidden whole");
  assert.ok(block.includes(".legend-item:has(> .legend-swatch){display:none}"));
  assert.ok(css.includes(".legend-item:not(:has(> .legend-swatch)){white-space:nowrap}"), "the runtime reads on one line");
  assert.ok(!/\.legend\{[^}]*display:none/.test(css), "nothing else hides it");
  // the markup this relies on (app.jsx): the runtime item has an icon and no swatch; every other has a swatch
  const leg = appSrc.slice(appSrc.indexOf('view==="spine" && React.createElement("div",{className:"legend"}'));
  const legend = leg.slice(0, leg.indexOf("\n\n"));
  const items = legend.split('className:"legend-item"').slice(1);
  assert.equal(items.length, 5);
  assert.ok(!items[0].includes("legend-swatch") && items[0].includes("Icon.clock") && items[0].includes("fmtRuntime(runtimeTotal)"));
  assert.ok(items.slice(1).every(x=>x.includes('className:"legend-swatch"')));
});

/* ═══ 6. (review) layering and the Script header ═══════════════════════════ */
await test("6 while a top-bar menu or window is open, the bar sits above the drawers, the MUSE bubble and the Writing dock — below dialogs", ()=>{
  const rule = ".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay){z-index:130}";
  assert.ok(cssBare.includes(rule), "the rule is live (not commented out)");
  const z = (sel)=>{ const d = declsOn(sel, ["z-index"]); assert.ok(d.length, sel); return Number(d[0].match(/z-index:(\d+)/)[1]); };
  const raised = 130;
  for(const sel of [".scrim", ".muse-dock-wrap", ".nb-dock"]) assert.ok(raised > z(sel), sel+" "+z(sel));
  assert.ok(raised < z(".appconfirm-scrim"), "a confirm opened from Team or the brief stays on top");
  assert.deepEqual(declsOn(".topbar", ["z-index"]), [".topbar{z-index:30}"], "the bar's resting layer is unchanged");
  assert.deepEqual(declsOn(".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay)", ["z-index"]),
    [".topbar:has(.export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay){z-index:130}"]);
  // the windows those menus open are rendered inside the bar (so the rule reaches them)
  assert.ok(/React\.createElement\("div",\{className:"topbar"\},\s*bibleOpen[^\n]*\n\s*briefOpen && React\.createElement\(StoryBriefModal/.test(chromeSrc));
  assert.ok(teamSrc.includes('className:"bible-overlay"'));
});
await test("6 'Redraft N out-of-date' has its own housed strip, the same look as the tool strip", ()=>{
  assert.ok(cssBare.includes(".st-group.r{border:1px solid var(--line-2);border-radius:9px;background:var(--bg-3);overflow:hidden}"));
  assert.ok(cssBare.includes(".st-group.r>*{height:32px;border:0;border-radius:0;flex:0 0 auto}"));
  const sv = read("app/script.jsx");
  assert.ok(sv.includes('React.createElement("div",{className:"st-group a"}, contBtn, scriptCheckBtn, versionUI, editBtn),'));
  assert.ok(sv.includes('redraftAllBtn && React.createElement("div",{className:"st-group r"}, redraftAllBtn),'));
});

/* ═══ B. the real stylesheet in a real browser ═══════════════════════════════ */
const CHROME = [process.env.CHROMIUM, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/repl/tools/bin/chromium"]
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
      <div class="legend-item" id="pos"><span class="legend-swatch" style="background:var(--pos)"></span>POS</div>
      <div class="legend-item"><span class="legend-swatch" style="background:var(--neg)"></span>NEG</div>
      <div class="legend-item"><span class="legend-swatch" style="background:var(--prog)"></span>Progresses</div>
      <div class="legend-item"><span class="legend-swatch" style="background:var(--alert)"></span>No turn</div></div></div>
</main>
<aside class="inspector"><div class="insp-tabs"><button class="insp-tab on">Scene</button></div><div class="insp-scroll" id="iscroll">
  <div style="height:1600px">scene fields</div>
  <ul class="eil-list"><li class="eil-row"><span class="eil-dot"></span><textarea class="edit-in" id="eil-in">Pistol</textarea><button class="eil-del" id="eil-del">×</button></li></ul>
  <div class="insp-actions"><button class="ia-btn">Up</button><button class="ia-btn">Down</button><button class="ia-btn">Add after</button>
    <button class="ia-btn danger" id="del"><svg width="13" height="13"></svg>Delete</button></div>
</div></aside></div></div>
<div class="write-dock nb-dock" id="wdock"><button class="nb-dock-toggle"><span class="nb-dock-label">Writing</span><span class="nb-dock-chip model">GPT5</span><span class="nb-dock-chip">AUTO</span></button></div>
<div class="agent-undo scene-undo stacked" id="t2"><span class="au-ic"><svg width="15" height="15"></svg></span><div class="au-text"><div class="au-t">Scene 12 deleted</div><div class="au-s">Restore it with its beats and draft</div></div>
  <button class="au-btn" id="t2-undo"><svg width="13" height="13"></svg>Undo</button><button class="au-x" id="t2-x">×</button></div>
<div class="agent-undo" id="t1"><span class="au-ic"><svg width="15" height="15"></svg></span><div class="au-text"><div class="au-t">Continuity Repair changed your story</div><div class="au-s">3 agent runs can be undone</div></div>
  <button class="au-btn" id="t1-undo"><svg width="13" height="13"></svg>Undo</button><button class="au-x" id="t1-x">×</button></div>
<div class="muse-dock-wrap"><button class="muse-bubble" id="muse"></button></div>
<script>
window.measure = async function(){
  document.querySelector(".app").classList.toggle("vp-mobile", innerWidth <= 700);
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
  return out;
};
</script></body></html>`;

async function browserPart(){
  if(!CHROME){
    // (review) a machine that must run the layout checks can't pass without them
    if(process.env.CI || process.env.REQUIRE_BROWSER){ console.log("FAIL B — no Chrome/Chromium binary, and CI / REQUIRE_BROWSER is set (set CHROMIUM)"); process.exit(1); }
    console.log("SKIP B — no Chrome/Chromium binary (set CHROMIUM to run the layout checks)"); return; }
  if(typeof WebSocket!=="function"){ console.log("SKIP B — this Node has no WebSocket"); return; }
  const dir = mkdtempSync(join(tmpdir(), "round1-ui-"));
  writeFileSync(join(dir, "styles.css"), process.env.ROUND1_CSS ? readFileSync(process.env.ROUND1_CSS) : css);
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
    const sizes = [[1440,900,"desktop"],[1024,768,"tablet (landscape)"],[820,1180,"tablet (portrait)"],[390,844,"phone"],[375,667,"small phone"],[320,568,"narrow phone"]];
    for(const [w, h, name] of sizes){
      await call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:1, mobile:w<=700 });
      await call("Emulation.setFocusEmulationEnabled", { enabled:true });
      const m = await evaluate("measure()");
      const tag = name+" "+w+"px: ";
      assert.equal(m.w, w, tag+"viewport");
      assert.ok(m.del && !m.delUnderMuse, tag+"the Scene panel's Delete is clear of the MUSE bubble at the end of the scroll "+JSON.stringify(m));
      m.toasts.forEach(t=>{
        assert.ok(t.x && t.undo, tag+"the undo toast's Undo and × are on top ("+t.id+") "+JSON.stringify(t));
        assert.ok(!t.underMuse && !t.underDock && t.inView, tag+"the toast clears the MUSE bubble and the Writing dock ("+t.id+") "+JSON.stringify(t));
      });
      assert.ok(m.toastsApart, tag+"two undo toasts don't overlap "+JSON.stringify(m.toastRects));
      assert.ok(m.rt && m.rtH < 20, tag+"the total runtime shows, on one line ("+m.rtH+"px)");
      assert.equal(m.pos, w > 900, tag+"the colour key shows only above 900px");
      assert.equal(m.eilDel, "1", tag+"the item-list × shows while its row has focus");
      assert.equal(m.eilTab, 0, tag+"…and Tab reaches it");
      assert.ok(m.modalTap, tag+"a top-bar window (Team, Story brief) is on top of the MUSE bubble and the Writing dock "+JSON.stringify({ modalTap:m.modalTap, over:m.modalOverMuse }));
      assert.ok(m.sc.rall && !m.sc.sideways, tag+"'Redraft N out-of-date' is fully on screen, and the header doesn't scroll sideways "+JSON.stringify(m.sc));
      if(w >= 375) assert.ok(m.sc.edit, tag+"…and Edit stays in view in its strip "+JSON.stringify(m.sc));
      if(w <= 640) assert.ok(m.sc.ownLine, tag+"on a phone it has its own line "+JSON.stringify(m.sc));
      if(w <= 700) assert.ok(m.menuTap, tag+"phone: the ⋯ entries are tappable over the open Scene drawer");
      if(w <= 700) assert.ok(m.tbHidden && m.ovf && m.mNew && m.mBrief && m.mTeam && m.artOvf && m.aTeam, tag+"phone: buttons move into the ⋯ "+JSON.stringify(m));
      else assert.ok(!m.tbHidden && !m.ovf && m.artOvf && !m.aTeam, tag+"desktop: the buttons stay, the ⋯ only in the Art Room, without the phone entries "+JSON.stringify(m));
      console.log("PASS B "+tag+"layout");
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

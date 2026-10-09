#!/usr/bin/env node
/* ============================================================================
   LOOKBOOK FIRST + ART ROOM TAB PER FILM (owner-approved 2026-09-27)

   A) The silent cast auto-draft used to fire the FIRST time the Art Room opened,
      on any tab, even with an empty Lookbook — so the wardrobe was drafted before
      the Lookbook that steers it, Characters was later flagged "Lookbook changed —
      re-draft", and the cast was drafted twice. docs/Story Pipeline.md step 9 now
      says: only once the Lookbook has something in it (a visual statement or at
      least one reference), the first time an Art Room tab OTHER than the Lookbook
      is open after that, never while an agent runs, once per film (the once-guard
      latches only when an attempt starts), and with no Lookbook the Characters tab
      hints and Draft all still works.
      Review fixes pinned here too: only a role that can SAVE the cast runs it (a
      Writer / View-only latch looped against autosave's rollback), a latch is
      written once per film per session, a draft in flight during a film switch
      lands nowhere and re-arms its own film, a card that got a spec mid-draft is
      never overwritten, agents that draft the cast wait while a Draft all runs,
      and a blank "+ Add reference" placeholder is not a reference.
   B) The Art Room tab was remembered device-wide (NAV_KEY), so a brand-new film
      opened on whatever tab another film was left on (the owner saw Shots). It is
      now remembered per film id, capped, a never-opened film starts on the
      Lookbook, and two open windows merge (never erase) each other's films.

   This test runs the REAL code without a browser or network:
   - app.jsx's nav helpers + turnCastAutoDraftStep, the real auto-draft effect,
     the real per-film artView block, the real share-role block (with team.jsx's
     real role allow-list) and the NAV_KEY persist effect, each under a minimal
     React hook runner (the same shape as test-save-conflict-order.mjs);
   - app.jsx's real draftAllVisuals with stubbed model calls, alone and wired to
     the real effect;
   - lookbook.jsx lookbookHasLook and artroom.jsx charVisualsDrafted /
     charLookbookFirstHint;
   - ai.jsx APP_FEATURES evaluated in a vm, so MUSE's text is checked after the
     replace chain that rewrites it.

     node scripts/test-lookbook-first.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = p => readFileSync(ROOT + p, "utf8");
let passes = 0, failures = 0;
const ok = (name, condition, detail) => {
  if (condition) passes++;
  else { failures++; console.log("FAIL " + name + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
};
const between = (text, start, end) => {
  const from = text.indexOf(start);
  if (from < 0) throw new Error("source marker not found: " + start);
  const to = text.indexOf(end, from + start.length);
  if (to < 0) throw new Error("source end marker not found: " + end);
  return text.slice(from, to);
};
const tick = () => new Promise(r => setImmediate(r));
const ticks = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

const app = read("app/app.jsx");
const art = read("app/artroom.jsx");
const look = read("app/lookbook.jsx");
const ai = read("app/ai.jsx");
const team = read("app/team.jsx");
const css = read("app/styles.css");
const html = read("TURN.html");

/* ── one vm context holding the real helpers ─────────────────────────────── */
const store = new Map();
const toasts = [];
const box = {
  console, Promise, Object, Array, String, Number, Math, JSON, Set, Map,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  },
  appToast: (msg, kind) => { toasts.push({ msg, kind }); },
};
box.window = box;
// The silent cast draft is OFF by default since 2026-10-03 (owner: no silent spending); the
// A-section tests below pin its rules with the switch ON, and A0b checks the default.
box.TURN_CAST_AUTO_DRAFT = true;
vm.createContext(box);
vm.runInContext(between(look, "function lookbookCardDrafted(c)", "window.lookbookHasLook = lookbookHasLook;") + "window.lookbookHasLook = lookbookHasLook;", box, { filename: "app/lookbook.jsx" });
vm.runInContext(art.split("\n").find(l => l.startsWith("function vfield(")), box, { filename: "app/artroom.jsx" });
vm.runInContext(between(art, "function charVisualsDrafted(c){", "/* prompt for image-to-image"), box, { filename: "app/artroom.jsx" });
vm.runInContext(between(art, "function charLookbookFirstHint(", "function CharacterSheets("), box, { filename: "app/artroom.jsx" });
vm.runInContext(between(app, "const NAV_KEY = ", "function turnFirstStoryScene("), box, { filename: "app/app.jsx" });
vm.runInContext(between(team, "const TEAM_ROLE_SECTIONS = {", "/* plain-language name for what a role may NOT touch")
  + "window.teamCanWriteSection = teamCanWriteSection; window.teamCanWriteRoom = teamCanWriteRoom;", box, { filename: "app/team.jsx" });

/* ── minimal React hook runner ───────────────────────────────────────────── */
function mount(factorySrc, initialProps) {
  const slots = []; let cursor = 0, fx = [], props = { ...initialProps }, out = null, dirty = false, inPass = false;
  const useEffect = (fn, deps) => {
    const i = cursor++; const prev = slots[i];
    if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, j) => Object.is(d, prev.deps[j]))) return;
    slots[i] = { deps, cleanup: prev && prev.cleanup };
    fx.push(() => { const s = slots[i]; if (s.cleanup) s.cleanup(); const c = fn(); s.cleanup = typeof c === "function" ? c : null; });
  };
  const React = {
    useState(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { v: typeof init === "function" ? init() : init };
      const s = slots[i];
      return [s.v, v => { const nv = typeof v === "function" ? v(s.v) : v; if (Object.is(nv, s.v)) return; s.v = nv; schedule(); }];
    },
    useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const Comp = vm.runInContext(factorySrc, box)(React);
  function flush() {
    inPass = true;
    try {
      let n = 0;
      do {
        dirty = false; cursor = 0; fx = [];
        out = Comp(props);
        const run = fx; fx = []; run.forEach(f => f());
        if (++n > 100) throw new Error("render loop");
      } while (dirty);
    } finally { inPass = false; }
  }
  function schedule() { dirty = true; if (!inPass) flush(); }
  flush();
  return {
    get out() { return out; },
    update(patch) { props = { ...props, ...patch }; flush(); },
    // one React batch: prop changes + state setters land in a single render (like applyDoc + a switch)
    batch(fn) { inPass = true; try { fn(patch => { props = { ...props, ...patch }; }); } finally { inPass = false; } flush(); },
  };
}

/* ── shared source blocks ────────────────────────────────────────────────── */
const effectSrc = between(app, "  // auto-draft the cast once per story — LOOKBOOK FIRST", "  /* Deterministic scene remapping");
const filmKeyBlock = between(app, "  /* WHICH FILM a long cast draft belongs to", "  /* SHARE ROLE on the open film.");
const shareBlock = between(app, "  const _projRow = (projects||[]).find", "  const readOnlyNoticeRef = React.useRef(0);");
const draftAllSrc = between(app, "  const [draftingAllVisuals, setDraftingAllVisuals] = React.useState(false);", "  // ---- Art Room: LOOKBOOK (References) ----");

/* ── A. the silent cast auto-draft ───────────────────────────────────────── */
const autoDraftFactory = body => `(function(React){ return function AutoDraftHarness(p){
  const { room, artView, characters, lookbook, lookbookNote, agentRunTick, draftingAllVisuals,
          currentProjectId, hydrationTick, draftAllVisuals, hydratingRef, projects, projectLoading, scenes } = p;
  const [visualsSeeded, setVisualsSeeded] = React.useState(!!p.visualsSeeded);
  const projIdRef = React.useRef(null); projIdRef.current = currentProjectId;
  ${filmKeyBlock}
  ${shareBlock}
  ${body}
  return { visualsSeeded, setVisualsSeeded, tried:_autoDraftTried.current, localStoryGenRef, castAutoDraftWritable };
}; })`;
// the pre-2026-09-27 effect, kept verbatim for the sensitivity checks below
const LEGACY_EFFECT = `
  const _autoDraftTried = React.useRef(false);
  React.useEffect(()=>{
    if(visualsSeeded || hydratingRef.current) return;
    if(room!=="art") return;
    if(!characters.length) return;
    if(_autoDraftTried.current) return;
    _autoDraftTried.current = true;
    const drafted = (typeof window.charVisualsDrafted==="function") ? window.charVisualsDrafted : (()=>true);
    if(!characters.some(c=>!drafted(c))){ setVisualsSeeded(true); return; }
    Promise.resolve(draftAllVisuals()).then((ok)=>{ if(ok) setVisualsSeeded(true); });
  },[room, visualsSeeded, characters, hydrationTick]);`;
// the first builder pass (no role gate, latch re-written on every check) — for the role-loop sensitivity check
const NO_ROLE_GATE_EFFECT = effectSrc.replace("canWrite:castAutoDraftWritable,", "canWrite:true,").replace("latched:!!_autoDraftLatched.current[key],", "latched:false,");

const undrafted = (id, name) => ({ id, name });
const drafted = (id, name) => ({ id, name, coreBody: "lean, weathered", wardrobeMask: "oil-stained parka" });
const TABS = ["lookbook", "characters", "props", "locations", "stylebible", "shots", "storyboard", "breakdown"];
const NO_LOOK = { lookbook: [], lookbookNote: "" };
const WITH_NOTE = { lookbook: [], lookbookNote: "Sodium-lit noir, wet asphalt, long lenses" };
// a Visual Researcher card (named touchstone + note)
const WITH_CARD = { lookbook: [{ id: "look-1", source: "In the Mood for Love", category: "Wardrobe", note: "saturated cheongsam reds against dim corridors" }], lookbookNote: "" };
// exactly what '+ Add reference' drops in (app.jsx addLookbookCard)
const BLANK_CARD = { id: "look-blank", source: "Palette study", category: "Palette", note: "", negativePrompt: "", manual: true, autoNamed: true };

function autoDraft(extra, body = effectSrc) {
  const calls = [];
  let result = true;
  box.__turnAgentRunCount = {};
  const draftAllVisuals = () => { calls.push(Date.now()); return Promise.resolve(result); };
  const cast = [undrafted("c1", "Mara"), drafted("c2", "Tobias")];
  const h = mount(autoDraftFactory(body), {
    room: "writers", artView: "lookbook", characters: cast, ...NO_LOOK, agentRunTick: 0, draftingAllVisuals: false,
    currentProjectId: "film-A", hydrationTick: 1, draftAllVisuals, hydratingRef: { current: false }, visualsSeeded: false,
    projects: [], projectLoading: false, scenes: [{ id: "s1" }], ...extra,
  });
  return { h, calls, setResult: v => { result = v; }, cast };
}

// A0 — what counts as "the Lookbook has something in it"
{
  const has = (lb, note) => box.lookbookHasLook(lb, note);
  ok("A0 empty Lookbook → no look", has([], "") === false && has(null, null) === false);
  ok("A0 a visual statement is a look", has([], "Grainy 16mm warmth") === true);
  ok("A0 a whitespace statement is not", has([], "  \n ") === false);
  ok("A0 a Visual Researcher card (named touchstone + note) is a look", has(WITH_CARD.lookbook, "") === true);
  ok("A0 the blank '+ Add reference' placeholder is NOT a look", has([BLANK_CARD], "") === false);
  ok("A0 the placeholder counts once it has a note", has([{ ...BLANK_CARD, note: "sodium-orange highlights" }], "") === true);
  ok("A0 …or once the user names a touchstone", has([{ ...BLANK_CARD, source: "Chungking Express", autoNamed: false }], "") === true);
  ok("A0 a legacy / researcher card without autoNamed counts by its name", has([{ id: "x", source: "Blade Runner 2049", category: "Palette", note: "" }], "") === true);
  box.nbGetImage = id => (id === "look-blank" ? "blob:frame" : "");
  ok("A0 …or once it has a mood frame", has([BLANK_CARD], "") === true);
  delete box.nbGetImage;
  box.nbGetSlotImage = id => (id === "lookref-look-blank" ? "blob:dropped" : "");
  ok("A0 …or a dropped reference image", has([BLANK_CARD], "") === true);
  delete box.nbGetSlotImage;
  ok("A0 junk entries are not references", has([null, 3, "x"], "") === false);
  // addLookbookCard still creates exactly the placeholder shape tested above
  ok("A0 addLookbookCard's placeholder shape is the one tested",
    app.includes('setLookbook(ls=>[...ls, { id, source:"Palette study", category:"Palette", note:"", negativePrompt:"", manual:true, autoNamed:true }]);'));
}
// A0b — DEFAULT (2026-10-03): with the switch off, a Lookbook look + every tab never drafts the
// cast, burns no guard, and a fully drafted cast still latches visualsSeeded
{
  box.TURN_CAST_AUTO_DRAFT = undefined;
  const { h, calls } = autoDraft({ ...WITH_NOTE });
  for (const t of TABS) h.update({ room: "art", artView: t });
  ok("A0b switch off: a look + every tab drafts nothing", calls.length === 0, calls.length);
  ok("A0b switch off: no once-guard burned", Object.keys(h.out.tried).length === 0);
  const d = autoDraft({ ...WITH_NOTE, characters: [drafted("c1", "Mara")] });
  d.h.update({ room: "art", artView: "characters" });
  ok("A0b switch off: a fully drafted cast still latches", d.h.out.visualsSeeded === true && d.calls.length === 0);
  ok("A0b the step: autoDraft false → wait", box.turnCastAutoDraftStep({ canWrite: true, room: "art", characters: [undrafted("c1", "M")],
    lookbookNote: "x", lookbook: [], artView: "props", autoDraft: false, drafted: box.charVisualsDrafted }) === "wait");
  ok("A0b the effect reads the switch", app.includes("autoDraft:window.TURN_CAST_AUTO_DRAFT===true"));
  box.TURN_CAST_AUTO_DRAFT = true;
}
// A1 — no Lookbook: nothing on any tab, and the once-guard is untouched
{
  const { h, calls } = autoDraft({});
  for (const t of TABS) h.update({ room: "art", artView: t });
  ok("A1 no Lookbook → no auto-draft on any Art Room tab", calls.length === 0, calls.length);
  ok("A1 no Lookbook → visualsSeeded stays false", h.out.visualsSeeded === false);
  ok("A1 no Lookbook → the once-guard is not burned", Object.keys(h.out.tried).length === 0, h.out.tried);
  h.update({ lookbookNote: "   \n  " });
  h.update({ artView: "characters" });
  ok("A1 a whitespace-only statement is not a look", calls.length === 0, calls.length);
}
// A1b — only a blank placeholder card: still nothing; filling it in arms the draft
{
  const { h, calls } = autoDraft({ lookbook: [BLANK_CARD], lookbookNote: "" });
  h.update({ room: "art", artView: "lookbook" });
  h.update({ artView: "characters" });
  ok("A1b a blank '+ Add reference' card + Characters tab → no auto-draft (empty brief)", calls.length === 0, calls.length);
  ok("A1b …and the once-guard is not burned", Object.keys(h.out.tried).length === 0);
  h.update({ artView: "lookbook", lookbook: [{ ...BLANK_CARD, category: "Wardrobe", note: "frayed wool, mended cuffs" }] });
  h.update({ artView: "characters" });
  ok("A1b once the card has a note, leaving the Lookbook drafts once", calls.length === 1, calls.length);
}
// A2 — Lookbook content, but the user is on the Lookbook tab
{
  const { h, calls } = autoDraft({ ...WITH_NOTE });
  h.update({ room: "art", artView: "lookbook" });
  h.update({ lookbookNote: WITH_NOTE.lookbookNote + ", teal shadows" });   // still curating
  h.update({ lookbook: WITH_CARD.lookbook });
  ok("A2 Lookbook content + on the Lookbook tab → no auto-draft", calls.length === 0, calls.length);
  ok("A2 curating the Lookbook doesn't burn the once-guard", Object.keys(h.out.tried).length === 0);
  h.update({ room: "writers", artView: "characters" });
  ok("A2 a non-Lookbook tab outside the Art Room → no auto-draft", calls.length === 0, calls.length);
}
// A3 — Lookbook content + another tab → exactly one draft, and it latches on success
{
  for (const [label, lk] of [["statement", WITH_NOTE], ["one reference card", WITH_CARD]]) {
    const { h, calls } = autoDraft({ ...lk });
    h.update({ room: "art", artView: "lookbook" });
    h.update({ artView: "props" });
    ok("A3 Lookbook " + label + " + Props tab → exactly one draftAllVisuals", calls.length === 1, calls.length);
    h.update({ artView: "characters" }); h.update({ artView: "shots" }); h.update({ characters: [undrafted("c1", "Mara"), undrafted("c3", "Idris")] });
    ok("A3 later tabs / cast changes never start a second draft (" + label + ")", calls.length === 1, calls.length);
    await tick();
    ok("A3 visualsSeeded latches once specs landed (" + label + ")", h.out.visualsSeeded === true);
  }
}
// A4 — an agent is running → none; fires after the run ends
{
  const { h, calls } = autoDraft({ ...WITH_NOTE });
  box.__turnAgentRunCount = { coordinator: 1, adapt: 0 };
  h.update({ room: "art", artView: "characters" });
  h.update({ artView: "props" });
  ok("A4 Run pre-production running → no auto-draft", calls.length === 0, calls.length);
  ok("A4 waiting on an agent doesn't burn the once-guard", Object.keys(h.out.tried).length === 0);
  box.__turnAgentRunCount = { coordinator: 1, casting: 1 };
  h.update({ agentRunTick: 1 });
  ok("A4 any agent's count blocks it (two live runs)", calls.length === 0, calls.length);
  box.__turnAgentRunCount = { coordinator: 0, casting: 0 };
  h.update({ agentRunTick: 2 });   // the 'turn-agent-running' event bumps agentRunTick in App
  ok("A4 the draft fires once the runs end (re-checked on agentRunTick)", calls.length === 1, calls.length);
}
// A4b — the agent drafted the whole cast itself → latch, no model call
{
  const { h, calls } = autoDraft({ ...WITH_NOTE });
  box.__turnAgentRunCount = { coordinator: 1 };
  h.update({ room: "art", artView: "shots" });
  h.update({ characters: [drafted("c1", "Mara"), drafted("c2", "Tobias")] });
  box.__turnAgentRunCount = { coordinator: 0 };
  h.update({ agentRunTick: 1 });
  ok("A4b a cast drafted by the agent is latched without another model call", calls.length === 0 && h.out.visualsSeeded === true, { calls: calls.length, seeded: h.out.visualsSeeded });
}
// A5 — gated-out visits never burn the once-guard
{
  const { h, calls } = autoDraft({});
  h.update({ room: "art", artView: "characters" });                 // no Lookbook
  h.update({ ...WITH_NOTE, artView: "lookbook" });                   // on the Lookbook
  box.__turnAgentRunCount = { researcher: 1 };
  h.update({ artView: "props", agentRunTick: 1 });                   // agent running
  h.update({ draftingAllVisuals: true, agentRunTick: 2 });           // (agent ended) manual Draft all running
  box.__turnAgentRunCount = {};
  h.update({ agentRunTick: 3 });
  h.update({ hydratingRef: { current: true }, hydrationTick: 2 });   // mid-hydration
  ok("A5 four gated-out visits: no draft and no burned guard", calls.length === 0 && Object.keys(h.out.tried).length === 0, { calls: calls.length, tried: h.out.tried });
  h.update({ draftingAllVisuals: false, hydratingRef: { current: false }, hydrationTick: 3 });
  ok("A5 the first eligible visit still drafts", calls.length === 1, calls.length);
}
// A5b — hydration alone gates it (not masked by a running Draft all)
{
  const { h, calls } = autoDraft({ ...WITH_NOTE, hydratingRef: { current: true } });
  h.update({ room: "art", artView: "characters" });
  h.update({ artView: "props", hydrationTick: 2 });
  ok("A5b mid-hydration (nothing else blocking) → no draft, no burned guard", calls.length === 0 && Object.keys(h.out.tried).length === 0, calls.length);
  h.update({ hydratingRef: { current: false }, hydrationTick: 3 });
  ok("A5b hydration done → drafts", calls.length === 1, calls.length);
}
// A6 — per FILM: a second film in the same session auto-drafts; a film is tried once per session
{
  const { h, calls, setResult } = autoDraft({ ...WITH_NOTE });
  setResult(false);                                                   // model unreachable in film A
  h.update({ room: "art", artView: "characters" });
  await tick();
  ok("A6 film A attempted once; a failed pass does not latch visualsSeeded", calls.length === 1 && h.out.visualsSeeded === false);
  setResult(true);
  h.update({ currentProjectId: "film-B", characters: [undrafted("b1", "Noor")], lookbookNote: "Bleached coastal daylight", hydrationTick: 2 });
  ok("A6 a second film opened in the same session auto-drafts", calls.length === 2, calls.length);
  await tick();
  h.out.setVisualsSeeded(false);   // back to film A (its doc still says not seeded)
  h.update({ currentProjectId: "film-A", characters: [undrafted("c1", "Mara")], lookbookNote: WITH_NOTE.lookbookNote, hydrationTick: 3 });
  ok("A6 returning to film A in the same session doesn't loop its failed attempt", calls.length === 2, calls.length);
  ok("A6 the guard is keyed per film", !!h.out.tried["film:film-A"] && !!h.out.tried["film:film-B"], h.out.tried);
}
// A7 — signed-out New Story reuses the "local" slot: its generation re-arms the guard
{
  const { h, calls, setResult } = autoDraft({ ...WITH_NOTE, currentProjectId: null });
  setResult(false);
  h.update({ room: "art", artView: "characters" });
  await tick();
  h.update({ artView: "props" });
  ok("A7 local story attempted once", calls.length === 1, calls.length);
  h.out.localStoryGenRef.current++;   // what the signed-out New Story branch does before applyDoc(emptyDoc())
  h.update({ characters: [undrafted("n1", "Wren")], hydrationTick: 2 });
  ok("A7 a new signed-out story gets its own auto-draft", calls.length === 2, calls.length);
}
// A8 — whole cast already drafted → latch without a model call (only once eligible)
{
  const { h, calls } = autoDraft({ characters: [drafted("c1", "Mara")] });
  h.update({ room: "art", artView: "characters" });
  ok("A8 no Lookbook: nothing latched either (a later hand-added character can still auto-draft)", h.out.visualsSeeded === false && calls.length === 0);
  h.update({ ...WITH_CARD });
  ok("A8 eligible + everyone drafted → latch, no draft", h.out.visualsSeeded === true && calls.length === 0);
}
// A9 — sensitivity: the legacy effect fails the owner's rules
{
  const a = autoDraft({}, LEGACY_EFFECT);
  a.h.update({ room: "art", artView: "lookbook" });
  ok("A9 sensitivity: the legacy effect drafted with an EMPTY Lookbook on the Lookbook tab", a.calls.length === 1, a.calls.length);
  const b = autoDraft({ ...WITH_NOTE }, LEGACY_EFFECT);
  b.setResult(false);
  b.h.update({ room: "art", artView: "characters" });
  await tick();
  b.h.update({ currentProjectId: "film-B", characters: [undrafted("b1", "Noor")], hydrationTick: 2 });
  ok("A9 sensitivity: the legacy per-session guard never drafted a second film", b.calls.length === 1, b.calls.length);
}
// A10 — pure decision: every gate, in order
{
  const s = { canWrite: true, room: "art", artView: "characters", characters: [undrafted("c1")], ...WITH_NOTE, drafted: box.charVisualsDrafted };
  const step = extra => box.turnCastAutoDraftStep({ ...s, ...extra });
  ok("A10 eligible → start", step({}) === "start");
  ok("A10 a role that can't save the cast → wait (never start, never latch)",
    step({ canWrite: false }) === "wait" && step({ canWrite: false, characters: [drafted("c1")] }) === "wait" && step({ canWrite: undefined }) === "wait");
  ok("A10 visualsSeeded / hydrating / other room / empty cast → wait",
    [{ visualsSeeded: true }, { hydrating: true }, { room: "writers" }, { room: "stage" }, { characters: [] }].every(e => step(e) === "wait"));
  ok("A10 no look / blank placeholder only / Lookbook tab / agent / Draft all running / tried → wait",
    [{ lookbook: [], lookbookNote: "" }, { lookbook: [BLANK_CARD], lookbookNote: "" }, { artView: "lookbook" }, { agentRuns: { casting: 2 } }, { draftingAll: true }, { tried: true }].every(e => step(e) === "wait"));
  ok("A10 zeroed agent counts don't block", step({ agentRuns: { adapt: 0, coordinator: 0 } }) === "start");
  ok("A10 all drafted → latch (even after a failed attempt)", step({ characters: [drafted("c1")], tried: true }) === "latch");
  ok("A10 all drafted but already latched this session → wait (no second latch write)", step({ characters: [drafted("c1")], latched: true }) === "wait");
}

/* ── A12. role gate: only a role whose saves keep the cast runs it ────────── */
{
  const shared = (role) => [{ id: "film-A", isShared: true, shareRole: role }];
  // what App's autosave does ~700ms later for a denied section: restore the last accepted value
  const runWithRollback = (h, rounds = 5) => {
    let latchWrites = 0;
    for (let i = 0; i < rounds; i++) {
      if (!h.out.visualsSeeded) break;
      latchWrites++;
      h.out.setVisualsSeeded(false);   // rollback → the effect re-checks (visualsSeeded is a dep)
    }
    if (h.out.visualsSeeded) latchWrites++;
    return latchWrites;
  };
  for (const [label, role] of [["Writer", "writer"], ["View-only", "view_only"], ["a legacy role", "producer_admin"], ["an empty role", ""]]) {
    const castAll = [drafted("c1", "Mara"), drafted("c2", "Tobias")];
    const a = autoDraft({ ...WITH_NOTE, characters: castAll, projects: shared(role) });
    a.h.update({ room: "art", artView: "characters" });
    ok("A12 " + label + ": the auto-draft is off for this role", a.h.out.castAutoDraftWritable === false);
    ok("A12 " + label + ": no latch write, so no latch → rollback loop", runWithRollback(a.h) === 0 && a.calls.length === 0);
    const b = autoDraft({ ...WITH_NOTE, projects: shared(role) });
    b.h.update({ room: "art", artView: "props" });
    ok("A12 " + label + ": an undrafted cast is never drafted on their credits", b.calls.length === 0 && Object.keys(b.h.out.tried).length === 0, b.calls.length);
  }
  {
    const a = autoDraft({ ...WITH_NOTE, projects: shared("art_director") });
    a.h.update({ room: "art", artView: "props" });
    ok("A12 Art director: auto-drafts", a.h.out.castAutoDraftWritable === true && a.calls.length === 1, a.calls.length);
    const o = autoDraft({ ...WITH_NOTE, projects: [{ id: "film-A", isOwner: true }] });
    o.h.update({ room: "art", artView: "props" });
    ok("A12 owner: auto-drafts", o.calls.length === 1, o.calls.length);
    const l = autoDraft({ ...WITH_NOTE, projectLoading: true });
    l.h.update({ room: "art", artView: "props" });
    ok("A12 film still loading → no draft, no burned guard", l.calls.length === 0 && Object.keys(l.h.out.tried).length === 0);
    l.h.update({ projectLoading: false });
    ok("A12 loading done → drafts", l.calls.length === 1, l.calls.length);
  }
  {
    // even for a role that CAN save, a latch that gets reset is not re-written this session
    const a = autoDraft({ ...WITH_NOTE, characters: [drafted("c1", "Mara")] });
    a.h.update({ room: "art", artView: "characters" });
    ok("A12 a writable role latches once, and a reset never re-latches in a loop", runWithRollback(a.h) === 1);
  }
  {
    // sensitivity: the first builder pass looped against the rollback
    const castAll = [drafted("c1", "Mara"), drafted("c2", "Tobias")];
    const a = autoDraft({ ...WITH_NOTE, characters: castAll, projects: shared("writer") }, NO_ROLE_GATE_EFFECT);
    a.h.update({ room: "art", artView: "characters" });
    ok("A12 sensitivity: without the role gate / latch once, a Writer loops latch → rollback", runWithRollback(a.h) === 6);
  }
}

/* ── A11. draftAllVisuals only fills characters with no spec ──────────────── */
{
  const src = between(app, "  const draftAllVisuals = async ()=>{", "  // ---- Art Room: LOOKBOOK (References) ----");
  const make = vm.runInContext("(function(env){ with(env){ " + src + " return draftAllVisuals; } })", box);
  const run = async (map, opts = {}) => {
    const keep = drafted("c2", "Tobias");
    let cast = [undrafted("c1", "Mara"), keep, undrafted("c3", "Idris")];
    let asked = null, applied = 0, film = "film:A";
    const env = {
      draftingAllVisuals: false, characters: cast, scenes: opts.scenes || [], drafts: {}, project: {},
      castDraftFilmKey: () => film,
      aiSuggestStates: opts.states ? async (c) => { if (opts.switchDuringStates) film = opts.switchDuringStates; return opts.states; } : undefined,
      aiCastVisualBible: async targets => {
        asked = targets.map(c => c.id);
        if (opts.midDraft) cast = opts.midDraft(cast);          // something lands while the model is out
        if (opts.switchTo) film = opts.switchTo;                // the user opens another film meanwhile
        return map;
      },
      lbProject: () => ({}), setDraftingVisualIds() {}, setDraftingAllVisuals() {},
      setCharacters: fn => { cast = fn(cast); }, markApplied: () => { applied++; },
    };
    const landed = await make(env)();
    return { landed, asked, cast, keep, applied };
  };
  const r = await run({ c1: { coreBody: "tall", wardrobeMask: "coat" }, c2: { coreBody: "HIJACK" } });
  ok("A11 the model is asked only for undrafted characters", JSON.stringify(r.asked) === JSON.stringify(["c1", "c3"]), r.asked);
  ok("A11 a drafted card is never overwritten", r.cast[1] === r.keep && r.cast[1].coreBody === "lean, weathered");
  ok("A11 landed specs merge and report success", r.landed === true && r.cast[0].wardrobeMask === "coat" && !r.cast[2].coreBody && r.applied === 0);   // (2026-10-06) each drafted card records its own Lookbook — the department isn't marked
  const empty = await run({});
  ok("A11 nothing landed → false (visualsSeeded is not latched)", empty.landed === false);
  // a spec that landed WHILE the model was out (Run pre-production's Casting Director, a hand edit) is kept
  const mid = await run({ c1: { coreBody: "AUTO body", wardrobeMask: "AUTO coat" }, c3: { coreBody: "short", wardrobeMask: "vest" } },
    { midDraft: cast => cast.map(c => c.id === "c1" ? { ...c, coreBody: "casting director body", wardrobeMask: "casting director coat" } : c) });
  ok("A11 apply-time re-check: a card drafted mid-draft keeps its spec", mid.cast[0].coreBody === "casting director body" && mid.cast[0].wardrobeMask === "casting director coat", mid.cast[0]);
  ok("A11 apply-time re-check: the still-undrafted ones still merge", mid.cast[2].wardrobeMask === "vest");
  // the film changed while the model was out: nothing is written anywhere
  const moved = await run({ c1: { coreBody: "tall", wardrobeMask: "coat" } }, { switchTo: "film:B" });
  ok("A11 film switched mid-draft → no merge, no markApplied, reports false",
    moved.landed === false && !moved.cast[0].coreBody && moved.applied === 0, { landed: moved.landed, c1: moved.cast[0], applied: moved.applied });
  // states pass (a second model round): same film → states merge; a switch during it → nothing more lands here
  const withStates = await run({ c1: { coreBody: "tall", wardrobeMask: "coat" } },
    { scenes: [{ id: "s1", driver: "c1" }], states: [{ label: "Rain-soaked" }] });
  ok("A11 same film: suggested appearance states merge (the card records its own Lookbook)",
    withStates.landed === true && (withStates.cast[0].states || []).length === 1 && withStates.applied === 0, withStates.cast[0]);
  const lateSwitch = await run({ c1: { coreBody: "tall", wardrobeMask: "coat" } },
    { scenes: [{ id: "s1", driver: "c1" }], states: [{ label: "Rain-soaked" }], switchDuringStates: "film:B" });
  ok("A11 a switch during the states pass → no states, no markApplied, reports false (the open film is never latched)",
    lateSwitch.landed === false && !(lateSwitch.cast[0].states || []).length && lateSwitch.applied === 0, { landed: lateSwitch.landed, applied: lateSwitch.applied });
}

/* ── A13. the real effect + the real draftAllVisuals across a film switch ─── */
{
  const integratedFactory = `(function(React){ return function Integrated(p){
    const { room, artView, lookbook, lookbookNote, agentRunTick, currentProjectId, hydrationTick, hydratingRef,
            projects, projectLoading, scenes, drafts, project, lbProject, markApplied } = p;
    const [characters, setCharacters] = React.useState(p.characters);
    const [visualsSeeded, setVisualsSeeded] = React.useState(!!p.visualsSeeded);
    const [draftingVisualIds, setDraftingVisualIds] = React.useState([]);
    const projIdRef = React.useRef(null); projIdRef.current = currentProjectId;
    ${filmKeyBlock}
    ${shareBlock}
    ${draftAllSrc}
    ${effectSrc}
    return { characters, setCharacters, visualsSeeded, setVisualsSeeded, draftingAllVisuals, tried:_autoDraftTried.current, castDraftFilmKey };
  }; })`;
  const pending = [];
  box.aiCastVisualBible = (targets) => new Promise(resolve => pending.push({ ids: targets.map(c => c.id), resolve }));
  box.__turnAgentRunCount = {};
  const applied = [];
  let h = null;
  h = mount(integratedFactory, {
    room: "art", artView: "characters", ...WITH_NOTE, agentRunTick: 0, currentProjectId: "film-A", hydrationTick: 1,
    hydratingRef: { current: false }, projects: [], projectLoading: false, scenes: [{ id: "s1" }], drafts: {}, project: {},
    lbProject: () => ({}), markApplied: dept => applied.push([dept, h && h.out.castDraftFilmKey()]),
    characters: [undrafted("mara", "Mara"), drafted("tobias", "Tobias")], visualsSeeded: false,
  });
  ok("A13 film A: the silent draft starts (one model call, Draft all state on)", pending.length === 1 && h.out.draftingAllVisuals === true && JSON.stringify(pending[0].ids) === '["mara"]', pending.length);
  // the user opens film B from Home while A's draft is out — B has its OWN "mara" (ids are name slugs)
  h.batch(set => { set({ currentProjectId: "film-B", lookbookNote: "Bleached coastal daylight", hydrationTick: 2 });
    h.out.setCharacters([undrafted("mara", "Mara"), undrafted("noor", "Noor")]); h.out.setVisualsSeeded(false); });
  ok("A13 while A's draft is out, B waits (a Draft all is running)", pending.length === 1);
  pending[0].resolve({ mara: { coreBody: "FILM A body", wardrobeMask: "FILM A coat" } });
  await ticks();
  const bMara = h.out.characters.find(c => c.id === "mara");
  ok("A13 A's result never merges into B's same-named character", !bMara.coreBody && !bMara.wardrobeMask, bMara);
  ok("A13 A's result never latches B's visualsSeeded", h.out.visualsSeeded === false);
  ok("A13 A's Lookbook brief is never recorded as applied on B", applied.length === 0, applied);
  ok("A13 A's once-guard is re-armed (its specs never landed)", !h.out.tried["film:film-A"], h.out.tried);
  ok("A13 B then gets its own auto-draft", pending.length === 2 && JSON.stringify(pending[1].ids) === '["mara","noor"]', pending.map(x => x.ids));
  pending[1].resolve({ mara: { coreBody: "B body", wardrobeMask: "B coat" }, noor: { coreBody: "B2", wardrobeMask: "B2 coat" } });
  await ticks();
  // (2026-10-06) each drafted card records its own Lookbook — no department-wide mark, on A or on B
  ok("A13 B's own specs land and B latches; nothing marks a whole department applied",
    h.out.characters.find(c => c.id === "mara").coreBody === "B body" && h.out.visualsSeeded === true
    && applied.length === 0, { applied, seeded: h.out.visualsSeeded });
  // back to A — its specs never landed, so it drafts again
  h.batch(set => { set({ currentProjectId: "film-A", lookbookNote: WITH_NOTE.lookbookNote, hydrationTick: 3 });
    h.out.setCharacters([undrafted("mara", "Mara"), drafted("tobias", "Tobias")]); h.out.setVisualsSeeded(false); });
  ok("A13 returning to A retries its dropped draft", pending.length === 3 && JSON.stringify(pending[2].ids) === '["mara"]', pending.length);
  pending[2].resolve({ mara: { coreBody: "FILM A body", wardrobeMask: "FILM A coat" } });
  await ticks();
  ok("A13 …and it lands on A", h.out.characters.find(c => c.id === "mara").coreBody === "FILM A body" && h.out.visualsSeeded === true);
  delete box.aiCastVisualBible;
}

/* ── A14. agents that draft the cast wait while a Draft all is drafting it ── */
{
  toasts.length = 0;
  ok("A14 no Draft all running → never blocks, no toast", box.turnCastDraftingBlocksAgent(false, "Run pre-production") === false && toasts.length === 0);
  ok("A14 a Draft all running → blocks and says why", box.turnCastDraftingBlocksAgent(true, "Run pre-production") === true
    && toasts.length === 1 && /Run pre-production can start as soon as the cast's specs finish drafting/.test(toasts[0].msg) && /twice/.test(toasts[0].msg), toasts);
  ok("A14 Run pre-production checks before the confirm AND when it's confirmed",
    // (2026-10-09, Art Room third pass) a role that can't change the Art Room is told first, at both points
    /onCoordinate:async \(\)=>\{\s*if\(artRoomReadOnlyRef\.current\)\{ _mutationNotice\("art"\); return; \}\s*if\(turnCastDraftingBlocksAgent\(draftingAllVisualsRef\.current, "Run pre-production"\)\) return;\s*if\(await requireStory\("Art Coordinator"\)\) setCoordConfirm\(true\); \}/.test(app)
    && /onConfirm:\(\)=>\{ setCoordConfirm\(false\);\s*if\(artRoomReadOnlyRef\.current\)\{ _mutationNotice\("art"\); return; \}\s*if\(turnCastDraftingBlocksAgent\(draftingAllVisualsRef\.current, "Run pre-production"\)\) return;\s*setCoordOpen\(true\); \}/.test(app));
  ok("A14 Design the cast checks before opening the Casting Director",
    app.includes('onCast:(opts)=>{ if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; } if(!turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Design the cast")) setCastConfirm(opts||{}); },')
    // …and again when its preview's button starts the run (2026-10-03)
    && /onConfirm:\(scope\)=>\{ setCastConfirm\(null\);\s*if\(artRoomReadOnlyRef\.current\)\{ _mutationNotice\("art"\); return; \}\s*if\(turnCastDraftingBlocksAgent\(draftingAllVisualsRef\.current, "Design the cast"\)\) return;/.test(app));
  const apply = between(app, "  const applyLookbook = async (dept, mode)=>{", "  const [researchOpen, setResearchOpen]");
  ok("A14 a Characters re-draft from the Lookbook checks before and after its confirm",
    (apply.match(/if\(dept==="characters" && turnCastDraftingBlocksAgent\(draftingAllVisualsRef\.current, "Re-drafting Characters"\)\) return;/g) || []).length === 2
    && apply.lastIndexOf('turnCastDraftingBlocksAgent(draftingAllVisualsRef.current, "Re-drafting Characters")') < apply.indexOf("setCastingOpen(true)"));
  ok("A14 the live ref mirrors the Draft all state", draftAllSrc.includes("const draftingAllVisualsRef = React.useRef(false); draftingAllVisualsRef.current = draftingAllVisuals;"));
  ok("A14 every Casting Director / Coordinator launch is gated",
    (app.match(/setCastingOpen\(true\)/g) || []).length === 2 && (app.match(/setCoordOpen\(true\)/g) || []).length === 1);
}

/* ── B. the Art Room tab per film ────────────────────────────────────────── */
const navUseStates = between(app, "  // The Art Room TAB is remembered PER FILM (see turnNavArtViewMap)", "  // once-per-story guard so auto-seeding the Props tab");
const navDerived = between(app, "  /* ART ROOM TAB PER FILM — derived", "  /* SHARE ROLE on the open film.");
const navPersist = between(app, "  // persist navigation (room/view/artView", "  // MULTI-WINDOW CONFLICT");
const navFactoryWith = persist => `(function(React){ return function NavHarness(p){
  const nav = p.nav, saved = p.saved || null;
  const currentProjectId = p.currentProjectId, room = p.room || "art", view = p.view || "board", selId = p.selId || null;
  const projIdRef = React.useRef(null); projIdRef.current = currentProjectId;
  ${navUseStates}
  ${navDerived}
  ${persist}
  return { artView, setArtView, setArtViewFor, artViewByProject };
}; })`;
const navFactory = navFactoryWith(navPersist);
const persisted = () => JSON.parse(store.get("turn-nav-v1") || "{}");
const bootNav = () => JSON.parse(store.get("turn-nav-v1") || "null") || {};

// B1 — pure helpers
{
  ok("B1 a film never opened in the Art Room → Lookbook", box.turnNavArtViewFor({}, "p1") === "lookbook" && box.turnNavArtViewFor(null, "p1") === "lookbook");
  const m1 = box.turnNavRememberArtView({}, "p1", "shots");
  ok("B1 remember + restore", box.turnNavArtViewFor(m1, "p1") === "shots" && box.turnNavArtViewFor(m1, "p2") === "lookbook");
  ok("B1 re-remembering the same most-recent tab returns the same object (no re-render / write)", box.turnNavRememberArtView(m1, "p1", "shots") === m1);
  ok("B1 the retired Voices tab restores as Characters", box.turnNavArtViewFor(box.turnNavRememberArtView({}, "p", "voices"), "p") === "characters");
  const junk = box.turnNavArtViewMap({ a: { v: "props", n: 3 }, b: "shots", c: { v: "" }, d: null, "": { v: "x" } });
  ok("B1 sanitizing NAV_KEY keeps valid entries only", JSON.stringify(Object.keys(junk).sort()) === '["a","b"]' && junk.b.v === "shots", junk);
  ok("B1 junk map shapes → {}", [null, undefined, "x", [1, 2], 7].every(v => Object.keys(box.turnNavArtViewMap(v)).length === 0));
  let m = {};
  for (let i = 1; i <= 55; i++) m = box.turnNavRememberArtView(m, "p" + i, i % 2 ? "props" : "shots");
  ok("B1 the cap keeps the 50 most recent films", Object.keys(m).length === 50 && !m.p1 && !m.p5 && m.p6 && m.p55, Object.keys(m).length);
  ok("B1 cap constant is 50", vm.runInContext("NAV_ARTVIEW_CAP", box) === 50);
  // wall-clock stamps (what App passes) never go backwards
  const t = box.turnNavRememberArtView({ a: { v: "props", n: 5 } }, "b", "shots", undefined, 1000);
  ok("B1 a stamp is max(top+1, now)", t.b.n === 1000 && box.turnNavRememberArtView({ a: { v: "props", n: 5000 } }, "b", "shots", undefined, 1000).b.n === 5001);
  // cross-window merge
  const local = { a: { v: "props", n: 10 }, b: { v: "shots", n: 20 } };
  ok("B1 merge: nothing newer stored → the SAME local object", box.turnNavMergeArtViews({ a: { v: "shots", n: 5 }, b: { v: "shots", n: 20 } }, local) === local);
  const mg = box.turnNavMergeArtViews({ a: { v: "shots", n: 15 }, c: { v: "locations", n: 1 } }, local);
  ok("B1 merge: a newer stored entry wins; films only the other window knows are kept; ties keep local",
    mg.a.v === "shots" && mg.c.v === "locations" && mg.b.v === "shots" && box.turnNavMergeArtViews({ b: { v: "props", n: 20 } }, local).b.v === "shots", mg);
  const big = {}; for (let i = 0; i < 60; i++) big["s" + i] = { v: "props", n: i + 100 };
  ok("B1 merge: the union is capped", Object.keys(box.turnNavMergeArtViews(big, local)).length === 50);
}
// B2 — switching films, New Story, episodes, reload
{
  store.clear();
  const h = mount(navFactory, { nav: {}, currentProjectId: null });
  ok("B2 before any film loads: the Lookbook on a fresh device", h.out.artView === "lookbook");
  h.update({ currentProjectId: "film-A" });
  ok("B2 film A (never opened) → Lookbook", h.out.artView === "lookbook");
  h.out.setArtView("shots");
  ok("B2 film A → Shots", h.out.artView === "shots");
  h.update({ currentProjectId: "film-B" });
  ok("B2 switching to a brand-new film B opens on the Lookbook, not A's Shots", h.out.artView === "lookbook", h.out.artView);
  h.out.setArtView("props");
  h.update({ currentProjectId: "film-A" });
  ok("B2 switching back to A restores A's own tab", h.out.artView === "shots", h.out.artView);
  h.update({ currentProjectId: "film-B" });
  ok("B2 and B restores B's own tab", h.out.artView === "props", h.out.artView);
  // New Story: createProject records the new film's tab BEFORE React has re-rendered onto it
  h.out.setArtViewFor("film-C", "lookbook");
  ok("B2 New Story: recording the new film's Lookbook never re-tabs the film still on screen", h.out.artView === "props" && h.out.artViewByProject["film-B"].v === "props");
  h.update({ currentProjectId: "film-C" });
  ok("B2 New Story: the new film opens on the Lookbook", h.out.artView === "lookbook");
  h.out.setArtView("locations");
  // series: each Episode is its own film row
  h.update({ currentProjectId: "ep-1" }); h.out.setArtView("storyboard");
  h.update({ currentProjectId: "ep-2" });
  ok("B2 a new Episode starts on the Lookbook", h.out.artView === "lookbook");
  h.update({ currentProjectId: "ep-1" });
  ok("B2 returning to Episode 1 restores its tab", h.out.artView === "storyboard");
  // functional updater keeps working for callers that pass one
  h.out.setArtView(cur => cur === "storyboard" ? "shots" : "props");
  ok("B2 a functional setArtView updates this film", h.out.artView === "shots");
  const saved = persisted();
  ok("B2 NAV_KEY carries each film's tab + the device-wide last tab + Writers' Room view",
    saved.artViewByProject && saved.artViewByProject["film-A"].v === "shots" && saved.artViewByProject["film-B"].v === "props"
    && saved.artViewByProject["film-C"].v === "locations" && saved.artView === "shots" && saved.view === "board" && saved.room === "art", saved);
  // reload: a fresh mount reading NAV_KEY
  const r = mount(navFactory, { nav: bootNav(), currentProjectId: null });
  ok("B2 reload: before the film loads, the tab last on screen", r.out.artView === "shots");
  r.update({ currentProjectId: "film-B" });
  ok("B2 reload: Home → open film B restores B's tab", r.out.artView === "props");
  r.update({ currentProjectId: "film-A" });
  ok("B2 reload: film A restores A's tab", r.out.artView === "shots");
  r.update({ currentProjectId: "film-Z" });
  ok("B2 reload: a film never opened in the Art Room → Lookbook", r.out.artView === "lookbook");
  // signed-out local mode keeps the device-wide tab
  const local = mount(navFactory, { nav: { artView: "voices" }, currentProjectId: null });
  ok("B2 local mode (no film id): device-wide tab, Voices normalized", local.out.artView === "characters");
  local.out.setArtView("lookbook");
  ok("B2 local mode: New Story's setArtView('lookbook') lands", local.out.artView === "lookbook");
}
// B3 — legacy NAV_KEY (no per-film map) and the cap through the real hook
{
  store.clear();
  const h = mount(navFactory, { nav: { room: "art", view: "spine", artView: "shots" }, currentProjectId: null });
  ok("B3 legacy nav: the old device-wide tab only while no film is open", h.out.artView === "shots");
  h.update({ currentProjectId: "legacy-film" });
  ok("B3 legacy nav: a film with no per-film record opens on the Lookbook", h.out.artView === "lookbook");
  for (let i = 1; i <= 60; i++) { h.update({ currentProjectId: "f" + i }); h.out.setArtView(i % 2 ? "props" : "shots"); }
  // f11 is now the OLDEST film the cap kept; reopening it (no tab change) must refresh its recency
  h.update({ currentProjectId: "f11" });
  for (let i = 61; i <= 64; i++) { h.update({ currentProjectId: "f" + i }); h.out.setArtView("locations"); }
  const map = persisted().artViewByProject || {};
  ok("B3 the persisted map is capped at 50 films", Object.keys(map).length === 50, Object.keys(map).length);
  ok("B3 the least recently used films are the ones forgotten", !map.f1 && !map.f10 && !map.f12 && !map.f15 && !!map.f16 && !!map.f64 && !!map.f60, Object.keys(map));
  ok("B3 reopening a film refreshes its recency so the cap keeps it", !!map.f11 && map.f11.v === "props", map.f11);
  h.update({ currentProjectId: "f1" });
  ok("B3 a forgotten film opens on the Lookbook again", h.out.artView === "lookbook");
}
// B4 — sensitivity: the legacy device-wide state carried Shots into a brand-new film
{
  const legacy = `(function(React){ return function Legacy(p){
    const nav = p.nav, saved = null;
    const [artView, setArtView] = React.useState(()=>{ const v = nav.artView || (saved && saved.artView) || "lookbook"; return v==="voices" ? "characters" : v; });
    return { artView, setArtView };
  }; })`;
  const h = mount(legacy, { nav: {}, currentProjectId: "film-A" });
  h.out.setArtView("shots");
  h.update({ currentProjectId: "film-new" });
  ok("B4 sensitivity: the legacy state opened a brand-new film on Shots", h.out.artView === "shots");
}
// B5 — two open windows never erase each other's films
{
  store.clear();
  const w1 = mount(navFactory, { nav: bootNav(), currentProjectId: "film-A" });
  const w2 = mount(navFactory, { nav: bootNav(), currentProjectId: "film-B" });   // open alongside — knows nothing of w1's later tabs
  w1.out.setArtView("shots");                        // window 1 saves A → Shots
  w2.update({ room: "writers" });                    // window 2 writes its nav without touching any tab (its map has no A)
  let m = persisted().artViewByProject || {};
  ok("B5 window 2's write keeps the film window 1 saved", m["film-A"] && m["film-A"].v === "shots", m);
  const r = mount(navFactory, { nav: bootNav(), currentProjectId: "film-A" });
  ok("B5 a reload reopens film A on window 1's tab", r.out.artView === "shots", r.out.artView);
  w2.update({ currentProjectId: "film-A" });         // window 2 has picked no tab since — only opening A can learn it
  ok("B5 window 2 opening film A picks up window 1's tab for it", w2.out.artView === "shots", w2.out.artView);
  w2.update({ currentProjectId: "film-B" }); w2.out.setArtView("props");
  m = persisted().artViewByProject || {};
  ok("B5 …and both windows' films are stored", m["film-A"].v === "shots" && m["film-B"].v === "props", m);
  w2.update({ currentProjectId: "film-A" });
  w2.out.setArtView("locations");                    // the newest choice for A (window 2)
  w1.update({ room: "writers" });                    // window 1 writes its nav — its copy of A is older
  m = persisted().artViewByProject || {};
  ok("B5 an older copy in another window never overwrites a newer tab", m["film-A"].v === "locations", m["film-A"]);
  w1.out.setArtView("color");                        // …but the newest pick always wins, whatever the counters
  ok("B5 the newest pick for a film wins", (persisted().artViewByProject || {})["film-A"].v === "color", persisted().artViewByProject);
  w2.update({ room: "art" });
  ok("B5 …and the window holding the older copy doesn't undo it", (persisted().artViewByProject || {})["film-A"].v === "color", persisted().artViewByProject);
  // sensitivity: the first pass wrote each window's whole map and erased the other window's films
  store.clear();
  const plain = navFactoryWith(`React.useEffect(()=>{ try{ localStorage.setItem(NAV_KEY, JSON.stringify({ room, view, artView, selId, artViewByProject })); }catch(e){} },[room, view, artView, selId, artViewByProject]);`);
  const x1 = mount(plain, { nav: bootNav(), currentProjectId: "film-A" });
  const x2 = mount(plain, { nav: bootNav(), currentProjectId: "film-B" });
  x1.out.setArtView("shots");
  x2.update({ room: "writers" });
  ok("B5 sensitivity: an unmerged write erased window 1's film", !(persisted().artViewByProject || {})["film-A"]);
}

/* ── C. the Characters-tab hint ──────────────────────────────────────────── */
{
  const hint = (lb, note, cast, busy) => box.charLookbookFirstHint(lb, note, cast, busy);
  const castU = [drafted("c2"), undrafted("c1")], castD = [drafted("c1"), drafted("c2")];
  ok("C hint: empty Lookbook + someone undrafted → shown", hint([], "", castU, false) === true);
  ok("C hint: whitespace statement counts as empty", hint([], "  ", castU, false) === true);
  ok("C hint: only a blank '+ Add reference' card still counts as empty", hint([BLANK_CARD], "", castU, false) === true);
  ok("C hint: a statement hides it", hint([], "Grainy 16mm warmth", castU, false) === false);
  ok("C hint: one reference card hides it", hint(WITH_CARD.lookbook, "", castU, false) === false);
  ok("C hint: whole cast drafted hides it", hint([], "", castD, false) === false);
  ok("C hint: no cast → hidden", hint([], "", [], false) === false && hint(null, null, null, false) === false);
  ok("C hint: hidden while a Draft all is running", hint([], "", castU, true) === false);
  const sheets = between(art, "function CharacterSheets(", "/* ---- pre-production readiness");
  ok("C CharacterSheets renders the hint from the shared predicate with the owner's copy",
    sheets.includes("const lookbookFirst = charLookbookFirstHint(lookbook, lookbookNote, list, draftingAll);")
    && sheets.includes('lookbookFirst && React.createElement("div",{className:"char-lookbook-hint",role:"note"}')
    && sheets.includes('"Build the Lookbook first"') && sheets.includes('" \\u2014 drafting the cast after it gives every character the film\'s look. Or "')
    && sheets.includes('onClick:onDraftAll') && sheets.includes('"draft now"'));
  // since 2026-10-03 nothing drafts on its own, so Draft all is the draft stage's PRIMARY (not a ghost)
  ok("C the Draft all button still shows whenever someone is undrafted (the stage's primary)", sheets.includes("someUndrafted && React.createElement(\"button\",{className:\"art-draftall\",disabled:draftingAll,onClick:onDraftAll,"));
  ok("C ArtRoom hands the Lookbook + a way to open it to the Characters tab",
    art.includes('lookbook,lookbookNote,onOpenLookbook:setArtView?()=>setArtView("lookbook"):null})'));
  const rule = (css.match(/\.char-lookbook-hint\{[^}]*\}/) || [""])[0];
  const link = (css.match(/\.char-lookbook-hint-link\{[^}]*\}/) || [""])[0];
  ok("C hint CSS: small muted text from theme tokens only (light + dark follow the theme)",
    /font-size:12px/.test(rule) && /color:var\(--txt-2\)/.test(rule) && /var\(--txt-1\)/.test(link)
    && !/#[0-9a-f]{3,6}|rgb|oklch/i.test(rule + link), { rule, link });
  const mobile = between(css, "@media (max-width:700px){\n  .art-intro-row{flex-direction:column", "}\n\n");
  ok("C hint CSS: full width at phone size, wraps instead of overflowing",
    /\.char-lookbook-hint\{max-width:none\}|\.art-intro-d,\.char-lookbook-hint\{max-width:none\}/.test(mobile) && /min-width:0/.test(css.match(/\.char-lookbook-hint > span\{[^}]*\}/)[0]));
}

/* ── D. source contracts App depends on ──────────────────────────────────── */
{
  ok("D the effect re-checks on role, tab, Lookbook, agent runs, Draft all and film switches",
    effectSrc.includes("},[castAutoDraftWritable, room, artView, visualsSeeded, characters, lookbook, lookbookNote, agentRunTick, draftingAllVisuals, _autoDraftKey, hydrationTick]);"));
  ok("D the effect passes the real role gate + the per-film latch record",
    effectSrc.includes("canWrite:castAutoDraftWritable,") && effectSrc.includes("latched:!!_autoDraftLatched.current[key],"));
  ok("D the role gate uses autosave's own allow-list for both sections it writes",
    shareBlock.includes('_sharedCanWriteSection("characters") && _sharedCanWriteSection("visualsSeeded")') && /const castAutoDraftWritable = !projectLoading && !artRoomReadOnly/.test(shareBlock)
    && app.includes('lookbook:setLookbook,lookbookNote:setLookbookNote') && app.includes("visualsSeeded:setVisualsSeeded};"));
  ok("D the once-guard latches after the decision says start", effectSrc.indexOf('if(step!=="start") return;') < effectSrc.indexOf("_autoDraftTried.current[key] = true;"));
  ok("D a result from another film re-arms its own guard and never latches the open film",
    effectSrc.includes("if(castDraftFilmKey()!==key){ delete _autoDraftTried.current[key]; return; }"));
  ok("D agentRunTick is bumped by the 'turn-agent-running' event", /window\.addEventListener\("turn-agent-running", h\)/.test(app) && /const h = \(\)=> setAgentRunTick\(t=>t\+1\);/.test(app));
  ok("D both signed-out New Story branches bump the local story generation",
    (app.match(/localStoryGenRef\.current\+\+; applyDoc\(emptyDoc\(\)\); setArtView\("lookbook"\);/g) || []).length === 2);
  ok("D localStoryGenRef is declared once, before draftAllVisuals reads it", (app.match(/const localStoryGenRef = /g) || []).length === 1
    && app.indexOf("const localStoryGenRef = ") < app.indexOf("const draftAllVisuals = async"));
  const create = between(app, "  const createProject = async", "  /* Dashboard: mint an AI poster");
  ok("D createProject keys the Lookbook to the NEW film", create.includes('setArtViewFor(created.id, "lookbook");') && !create.includes('setArtView("lookbook")'));
  ok("D no leftover useState owns artView", !/const \[artView, setArtView\] = React\.useState/.test(app));
  ok("D NAV_KEY persist merges then writes the per-film map",
    navPersist.includes("turnNavMergeArtViews(turnNavArtViewMap(loadNav().artViewByProject), artViewByProject)")
    && navPersist.includes("JSON.stringify({ room, view, artView, selId, artViewByProject:merged })") && navPersist.includes("[room, view, artView, selId, artViewByProject]"));
  const ui = read("app/agents-ui.jsx");
  ok("D agents keep per-agent run counts on window.__turnAgentRunCount", ui.includes("runs[agent.id] = (runs[agent.id]||0) + 1;") && ui.includes("runs[agent.id] = Math.max(0, (runs[agent.id]||1) - 1);"));
  ok("D no stale 'auto-drafts on Art Room open' wording in app.jsx", !/AUTO-drafts on Art Room open|auto-drafted on first Art Room open/i.test(app));
}

/* ── E. MUSE product knowledge (after the replace chain) ─────────────────── */
{
  const src = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fbox = { console }; fbox.window = fbox; vm.createContext(fbox);
  vm.runInContext(src + "\n;this.__F = APP_FEATURES;", fbox, { filename: "app/ai.jsx" });
  const F = fbox.__F;
  const arr = (F.find(f => f.name === "Art Room") || {}).what || "";
  const cs = (F.find(f => f.name === "Character Sheets (Art Room)") || {}).what || "";
  const all = F.map(f => f.what).join("\n");
  ok("E MUSE: no 'first Art Room open' / 'any tab' / 'per device' / FIRST VISIT claims remain",
    !/first Art Room open|first time the Art Room is opened|\(any tab\)|remembered per device|FIRST VISIT/.test(all));
  ok("E MUSE Art Room: Lookbook first, and NOTHING drafts silently (2026-10-03)",
    /draft the cast once THE LOOKBOOK HAS SOMETHING IN IT \(a visual statement or at least one reference card/.test(arr)
    && /NOTHING IS DRAFTED SILENTLY/.test(arr) && !/AUTO-DRAFTED silently/.test(arr)
    && /Build the Lookbook first/.test(arr) && /'Draft all' button drafts the cast on demand/.test(arr));
  ok("E MUSE Art Room: a blank 'Add reference' card counts only once it has content",
    /a blank card just added with 'Add reference' starts counting once it has a note, a named touchstone or an image/.test(arr));
  ok("E MUSE Art Room: only roles that save the Art Room; agents wait for a running Draft all",
    /only for someone whose role saves Art Room changes \(the owner or an Art director\)/.test(arr)
    && /'Run pre-production', 'Design the cast' and a Characters re-draft say they can start once the specs land/.test(arr));
  // 2026-09-27 (owner-approved): the story build no longer drafts the cast's look, so a New Story
  // film's cast is designed by this same silent draft once the Lookbook has a look (and only
  // pre-change films, which carry a build-drafted spec, get the 'Lookbook changed' banner)
  ok("E MUSE Art Room: New Story films arrive with NO cast look — the user drafts it from the Lookbook (truthful about the build)",
    /A film built with New Story arrives the same way: the STORY BUILD NO LONGER DRAFTS THE CAST'S LOOK/.test(arr)
    && /open Characters and press Draft all \(or Design the cast\)/.test(arr) && !/the silent draft designs/.test(arr)
    && !/the build itself already drafts every character's spec/.test(arr)
    && /Films built before this change already carry a build-drafted spec/.test(arr) && /'Lookbook changed' banner/.test(arr));
  ok("E MUSE Art Room: tab remembered per film, new films/Episodes on the Lookbook",
    /remembered PER FILM/.test(arr) && /never opened in the Art Room opens on the LOOKBOOK/.test(arr) && /every new Episode of a series start on the Lookbook/.test(arr));
  ok("E MUSE Art Room: recommended order starts with the Lookbook", /The recommended order of work is: Lookbook → Characters/.test(arr));
  ok("E MUSE Character Sheets: both draft sentences say nothing drafts on its own (replace chain intact)",
    /NOTHING IS DRAFTED OR GENERATED ON ITS OWN \(owner 2026-10-03\)/.test(cs)
    && /Character cards have no standalone Draft details button/.test(cs)
    && /Nothing drafts silently: you draft the cast when you're ready/.test(cs)
    && !/AUTO-DRAFTS|auto-drafted once/.test(cs));
}

/* ── F. parse + cache keys ───────────────────────────────────────────────── */
{
  const babel = await import("@babel/core");
  const presetReact = (await import("@babel/preset-react")).default;
  for (const f of ["app/app.jsx", "app/artroom.jsx", "app/lookbook.jsx", "app/ai.jsx"]) {
    let error = null;
    try { babel.parseSync(read(f), { filename: ROOT + f, presets: [presetReact], babelrc: false, configFile: false }); } catch (e) { error = String(e.message).split("\n")[0]; }
    ok("F parse: " + f + " is valid JSX/JS", !error, error);
  }
  // Every file this change touches must carry a key newer than the one it had BEFORE the change
  // (a date check alone let app.jsx / ai.jsx fall back to their same-day pre-change key).
  const PRE_CHANGE = {
    "app/app.jsx": "20260927-saveorder2", "app/ai.jsx": "20260927-saveorder2", "app/artroom.jsx": "20260926-decisions2",
    "app/lookbook.jsx": "20260926-cleanup1", "app/styles.css": "20260926-blank1",
  };
  const cacheKey = f => (html.match(new RegExp(f.replace(/\./g, "\\.") + "\\?v=([^\"']+)")) || [])[1] || "";
  for (const [f, pre] of Object.entries(PRE_CHANGE)) {
    const key = cacheKey(f);
    ok("F cache key bumped: " + f, !!key && key !== pre && Number(key.slice(0, 8)) >= 20260927, { key, pre });
  }
  // the review-pass key, or a LATER change's key (e.g. 20260927-tablocks1) — never the first-pass key
  const reviewOrLater = f => { const k = cacheKey(f); return k === "20260927-lookfirst2"
    || (!!k && k !== "20260927-lookfirst1" && k !== PRE_CHANGE[f] && Number(k.slice(0, 8)) >= 20260927); };
  ok("F cache keys: the files changed in the review pass carry the review key (or a later change's)",
    ["app/app.jsx", "app/lookbook.jsx", "app/ai.jsx"].every(reviewOrLater), ["app/app.jsx", "app/lookbook.jsx", "app/ai.jsx"].map(cacheKey));
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

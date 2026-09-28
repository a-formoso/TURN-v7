#!/usr/bin/env node
/* ============================================================================
   EPISODE BUILD — the psychology check vs Show canon, the save echo, and the
   shared Babel helper.

   docs/Story Pipeline.md step 3, "In an Episode of an existing Show" (owner-approved
   2026-09-27): the check pass may refine only the characters THAT EPISODE introduced;
   characters already in the Show keep their canon; every scene's "drafted from" stamp
   follows the cast that was actually saved, so the build's own check never marks its
   scenes needs redraft.

   A  the check stamps drafts from the cast actually committed (sync, re-stamp, sync)
   B  the Episode reconcile: this run's new cast is revisable, the older Show cast is canon
   C  the log counts only revisions that landed and names the ones Show canon kept out
   D  the Show Bible save echo: no manufactured scene-link fields; the agent's mid-run
      edit detection ignores this window's own echo; one undo snapshot per clean run
   E  no object-rest destructuring in Babel-compiled app files other than app.jsx
   F  the stray "_revised" field is stripped when a project loads — and the save baseline agrees,
      so opening a project is no cast change (no save on open; no false Writer rollback)
   Review pass (2026-09-27): the check fills no EMPTY field of an existing Show character either
   (Episode 1's stamps stay current); a later save changes only the fields the build changed
   since its last save (a collaborator's mid-run edit survives, even on the build's own new
   people); a mid-run rename stays one person; a later build of the same Episode logs the true
   reason; two back-to-back commits push one undo step; the touched files' cache keys are pinned.

   Runs the REAL agent (agents.jsx), the REAL agent context + commit (app.jsx), the REAL
   Show reconcile (series.js), the REAL card snapshot (ai.jsx) and the REAL Show Bible
   department merge (cloud.jsx) together in a vm, on a scratch Show fixture (Episode 1's
   cast + an Episode 2 build). No network, no browser, no database.

     node scripts/test-episode-build-psych.mjs
   ============================================================================ */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

let passes = 0, failures = 0;
const ok = (name, cond, detail) => {
  if (cond) { passes++; return; }
  failures++;
  console.log("FAIL " + name + (detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))));
};
const read = p => readFileSync(p, "utf8");
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error("marker not found: " + a);
  const j = b ? src.indexOf(b, i + a.length) : -1; if (b && j < 0) throw new Error("marker not found: " + b);
  return src.slice(i, b ? j : undefined);
};
const plain = v => JSON.parse(JSON.stringify(v));
// Postgres jsonb stores object keys shortest-first, then bytewise — what a save's echo looks like
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : (v && typeof v === "object")
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonb(v[k])])) : v;

const seriesSrc = read("app/series.js"), cloud = read("app/cloud.jsx"), app = read("app/app.jsx");
const agents = read("app/agents.jsx"), ai = read("app/ai.jsx"), castPolicy = read("app/cast-policy.js");
const html = read("TURN.html");

/* ── the vm: real series.js + stableJson + Bible merge + card snapshot + agents + ctx factory ── */
const FACTORY_NAMES = ["React", "scenes", "characters", "project", "beatsMap", "drafts", "continuityMap",
  "currentProjectId", "projIdRef", "currentShowId", "writersRoomReadOnlyRef", "artRoomReadOnlyRef",
  "characterBibleWritableRef", "setScenes", "setCharacters", "setProject", "setBeatsMap", "setDrafts",
  "setContinuityMap", "setAgentUndo", "setProps", "setPropsSeeded", "setVisualsSeeded", "setLocations",
  "cloudMode", "renameProject", "withBeatMapIdentity", "storyFacts", "props", "locations", "shots",
  "_projRow", "shareRole", "aiAvailable"];
function makeBox(appSrc = app, agentsSrc = agents) {
  const b = { console, setTimeout, clearTimeout };
  b.window = b; b.globalThis = b;
  vm.createContext(b);
  vm.runInContext(seriesSrc, b, { filename: "app/series.js" });
  vm.runInContext(between(app, "function stableJson(v){", "\n/* ---- persistence"), b, { filename: "app/app.jsx#stableJson" });
  vm.runInContext(between(cloud, "function _seriesJsonSame", "async function cloudSaveBibleSections")
    + "\nthis.__mergeDepartment=_mergeEpisodeBibleDepartment;", b, { filename: "app/cloud.jsx#bible-merge" });
  vm.runInContext(between(ai, "function castMemberByLabel(label, cast){", "/* NAME EVERY SCENE'S VALUE"), b, { filename: "app/ai.jsx#card-snapshot" });
  b.chargeStr = v => String(v);
  vm.runInContext(agentsSrc, b, { filename: "app/agents.jsx" });
  vm.runInContext("function __makeFactory(E){ " + FACTORY_NAMES.map(n => "var " + n + "=E." + n + ";").join(" ") + "\n"
    + between(appSrc, "  const agentLiveRef = React.useRef(null);", "  const artAgentCtxFactory = (")
    + "\n  return agentCtxFactory;\n}", b, { filename: "app/app.jsx#agentCtxFactory" });
  return b;
}

/* ── the scratch Show: Episode 1's cast as stored in the Show Bible ───────── */
const E1_CAST_STORED = [
  { id: "marisol", name: "Marisol Vega", role: "Protagonist", pronouns: "she/her",
    conscious: "keep the diner open", unconscious: "to be forgiven by her sister", arc: "guarded to open",
    arcStages: { 1: "hides the debt", 2: "cracks in public", 3: "asks for help" }, humanTruth: "",
    look: "red apron", scenes: ["s1", "s2"], episodeScenes: { E1: ["s1", "s2"] } },
  { id: "tomas", name: "Tomás Carrillo", role: "Supporting", pronouns: "he/him",
    conscious: "win the lease", unconscious: "to matter to his father", arc: "proud to humble", look: "suede jacket" },
];
const EMPTY_TRASH = { characters: [], locations: [], props: [] };
const bibleOf = chars => ({ characters: chars, locations: [], props: [], lookbook: [], lookbookNote: "", trash: EMPTY_TRASH });
const REVISED_NOTE = id => "the script shows " + id + " choosing differently under pressure";

/* One Adaptation build. Episode mode: the run starts inside Episode 2 of the scratch Show
   (live cast = the Show Bible scoped to E2), and every render is followed by the Show
   Bible save the app makes (prepare → server three-way merge → scope → adopt).
   React timing is kept: a setter updates state at once, but the component — and so the
   agent's live ref — re-renders LATER (a macrotask), so two commits in one synchronous
   stretch both read the older render, exactly as in the page. Every model call takes a
   tick, so renders and saves happen between calls. */
async function runBuild(opts = {}) {
  const b = makeBox(opts.appSrc || app, opts.agentsSrc || agents);
  const S = b.turnSeries;
  const show = opts.film ? null : { characters: plain(opts.showCast || E1_CAST_STORED) };
  const startCast = show ? plain(S.bibleForEpisode(bibleOf(show.characters), "E2", "E1", 2).characters) : [];
  const live = { scenes: [], characters: startCast, project: { title: "Untitled", format: show ? "series" : "film" },
    beats: {}, drafts: {}, continuity: {} };
  const liveRef = { current: null };
  let renderQueued = false, renders = 0;
  const render = () => { renderQueued = false; renders++; liveRef.current = { ...live }; saveEcho(); };
  const set = k => v => {
    live[k] = typeof v === "function" ? v(live[k]) : v;
    if (!renderQueued) { renderQueued = true; setTimeout(render, 0); }
  };
  const tick = () => new Promise(res => setTimeout(res, 2));
  const undo = [];
  const E = {
    React: { useRef: () => liveRef },
    scenes: live.scenes, characters: live.characters, project: live.project, beatsMap: live.beats,
    drafts: live.drafts, continuityMap: live.continuity,
    currentProjectId: "E2", projIdRef: { current: "E2" }, currentShowId: show ? "SHOW" : null,
    writersRoomReadOnlyRef: { current: false }, artRoomReadOnlyRef: { current: false },
    characterBibleWritableRef: { current: opts.restricted ? false : true },
    setScenes: set("scenes"), setCharacters: set("characters"), setProject: set("project"),
    setBeatsMap: set("beats"), setDrafts: set("drafts"), setContinuityMap: set("continuity"),
    setAgentUndo: f => { const next = f(undo.slice()); undo.splice(0, undo.length, ...next); },
    setProps() {}, setPropsSeeded() {}, setVisualsSeeded() {}, setLocations() {}, cloudMode: false, renameProject() {},
    withBeatMapIdentity: undefined, storyFacts: {}, props: [], locations: [], shots: [], _projRow: null,
    shareRole: "owner", aiAvailable: () => true,
  };
  const factory = b.__makeFactory(E);

  // the Show Bible save this window makes after a render, and its echo
  let lastSent = b.stableJson(live.characters), baseline = show ? plain(show.characters) : null, echoes = 0;
  const saveEcho = () => {
    if (!show || b.stableJson(live.characters) === lastSent) return;
    const incoming = S.prepareBibleForEpisode(bibleOf(live.characters), "E2").characters;
    lastSent = b.stableJson(live.characters);                              // _rememberSent
    const merged = b.__mergeDepartment(show.characters, incoming, baseline, "E2", [], "characters");
    if (!merged.ok) throw new Error("Bible merge conflict: " + merged.conflicts.join(", "));
    show.characters = jsonb(plain(merged.value)); baseline = plain(show.characters);   // stored as jsonb
    const scoped = S.bibleForEpisode(bibleOf(show.characters), "E2", "E1", 2).characters;
    const theirs = b.stableJson(scoped);
    if (theirs !== lastSent) { lastSent = theirs; E.setCharacters(plain(scoped)); echoes++; }   // _adoptBibleTheirs(scoped, [])
  };

  // stubbed writing model (the only fake: every call returns a fixed, valid answer)
  const drivers = ["mara", "tomas", "marisol", "mara"];
  b.aiBuildSpine = async () => (await tick(), { title: "Night Shift", scenes: drivers.map((d, i) => ({
    act: i === 0 ? 1 : i === 3 ? 3 : 2, title: "Scene " + (i + 1), loc: "INT. DINER - NIGHT", summary: "s" + i, driver: d,
    openValue: "calm", openCharge: 1, closeValue: "alarm", closeCharge: -1 })) });
  b.aiBuildStoryWorld = async () => (await tick(), { genre: "drama", premise: "p", controllingIdea: { value: "v" }, setting: {},
    cast: opts.worldCast || [{ id: "mara", name: "Mara Quinn", role: "Protagonist" }, { id: "tomas", name: "Tomas Iturbe", role: "Supporting" },
      { id: "marisol", name: "Marisol Vega", role: "Mentor" }] });
  const reactorOf = { mara: "TOMAS ITURBE", tomas: "MARISOL VEGA", marisol: "MARA QUINN" };
  b.aiAuthorScene = async (s) => {
    await tick();
    const who = s.driver === "tomas-2" ? "tomas" : s.driver;
    return { patch: { objective: "objective " + s.no }, beats: { rows: [{ n: 1, action: "a", reaction: "r" }], reactorLabel: reactorOf[who] || "MARA QUINN" } };
  };
  b.aiDraftScene = async (s) => (await tick(), { blocks: [{ type: "action", text: "Scene " + s.no + " happens." }] });
  b.aiContinuityLedger = async () => (await tick(), { map: {}, facts: {}, ledger: { built: 1 } });
  b.aiCastPsychology = async (cast, scenes, P, o) => {
    if (opts.onCheck && o && o.mode === "reconcile") opts.onCheck(E);        // an edit that renders before the check commits
    await tick();
    if (opts.psych) return opts.psych(cast, o);
    const out = {};
    cast.forEach(c => {
      const canonTomas = c.name === "Tomás Carrillo";
      if (o && o.mode === "before") {
        out[c.id] = { conscious: "BEFORE want " + c.id, unconscious: "BEFORE need " + c.id,
          arcStages: { 1: "b1 " + c.id, 2: "b2 " + c.id, 3: "b3 " + c.id } };
      } else if (canonTomas) {
        out[c.id] = { pronouns: "he/him" };                                   // nothing to revise
      } else {
        out[c.id] = { conscious: "REVISED want " + c.id, unconscious: "REVISED need " + c.id,
          arcStages: { 1: "r1 " + c.id, 2: "r2 " + c.id, 3: "r3 " + c.id },
          ...(c.id === "marisol" ? { humanTruth: "kindness is a debt paid forward" } : {}),
          _revised: REVISED_NOTE(c.id) };
      }
    });
    return out;
  };

  const trace = [];
  const ctx = factory({ input: "A night-shift cook inherits her mentor's diner.", emit: e => trace.push(e),
    propose: async () => { await tick(); return true; }, cancelled: () => false, agentName: "Adaptation" });
  const commit = ctx.sync; let syncs = 0;
  let foreignDone = false;
  ctx.sync = () => { commit(); syncs++;
    if (opts.foreign && !foreignDone && (opts.foreign.when ? opts.foreign.when(ctx) : syncs === opts.foreign.at)) { foreignDone = true; opts.foreign.apply(E); } };
  await b.agentAdaptation(ctx);
  for (let i = 0; i < 3; i++) await tick();                                  // the last renders + saves settle
  const stale = live.scenes.filter(s => live.drafts[s.id] && (live.drafts[s.id].blocks || []).length).map(s =>
    ({ no: s.no, changes: b.cardChanges(live.drafts[s.id].cardSnap, b.sceneCardSnap(s, live.characters, live.beats[s.id])) }))
    .filter(x => x.changes.length);
  return { b, S, live, show, undo, trace, startCast, echoes, syncs, renders, stale, ctx };
}
const texts = (trace, k) => trace.filter(e => !k || e.k === k).map(e => e.t);
const withoutLinks = c => { const o = { ...c }; delete o.scenes; delete o.episodeScenes; return o; };
const S0 = v => JSON.stringify(jsonb(v === undefined ? null : v));

/* ── A–D: the Episode 2 build on the scratch Show ─────────────────────────── */
{
  const r = await runBuild();
  const { b, live, show, undo, trace } = r;
  const S = r.b.stableJson;
  const byId = id => live.characters.find(c => c && c.id === id);
  const drafted = live.scenes.filter(s => live.drafts[s.id] && (live.drafts[s.id].blocks || []).length);
  ok("harness: the Episode build wrote every scene", live.scenes.length === 4 && drafted.length === 4, texts(trace, "flag"));
  ok("harness: the build reached its end", trace.some(e => e.k === "done") && texts(trace, "act").some(t => /Checking the cast's psychology/.test(t)));

  // A — the drafted-from stamps follow the cast actually saved
  ok("A no scene is marked needs redraft after an Episode build", r.stale.length === 0, r.stale);
  const byNo = n => live.scenes.find(s => s.no === n);
  ok("A the stamps carry the SAVED psychology (the canon reactor and the revised driver)",
    /REVISED want mara/.test(live.drafts[byNo(1).id].cardSnap.driverPsych)
      && /keep the diner open/.test(live.drafts[byNo(2).id].cardSnap.reactorPsych)
      && !/REVISED want marisol/.test(JSON.stringify(Object.values(live.drafts).map(d => d.cardSnap))),
    Object.values(live.drafts).map(d => d.cardSnap && [d.cardSnap.driverPsych, d.cardSnap.reactorPsych]));
  // sensitivity: a stamp taken from the PROPOSED revision of a canon character would be stale
  const proposed = live.characters.map(c => c.id === "marisol" ? { ...c, conscious: "REVISED want marisol" } : c);
  const sc2 = byNo(2);
  ok("A sensitivity: stamping from the unsaved revision WOULD mark the scene out of date",
    b.cardChanges(b.sceneCardSnap(sc2, proposed, live.beats[sc2.id]), b.sceneCardSnap(sc2, live.characters, live.beats[sc2.id])).includes("the reactor's psychology"));

  // B — the Episode's own new cast is revisable, the Show's older cast keeps canon
  const mara = byId("mara"), tomas2 = byId("tomas-2"), marisol = byId("marisol"), tomas = byId("tomas");
  ok("B the Episode's new cast took the check's revision",
    mara && mara.conscious === "REVISED want mara" && mara.unconscious === "REVISED need mara" && mara.arcStages[2] === "r2 mara"
      && tomas2 && tomas2.name === "Tomas Iturbe" && tomas2.conscious === "REVISED want tomas-2", [mara, tomas2]);
  ok("B a generated id colliding with a DIFFERENT Show character became its own person (tomas-2)",
    live.scenes.filter(s => s.driver === "tomas-2").length === 1 && !live.scenes.some(s => s.driver === "tomas"), live.scenes.map(s => s.driver));
  const startById = id => r.startCast.find(c => c.id === id);
  const canonKept = id => {
    const was = withoutLinks(startById(id)), now = withoutLinks(byId(id));
    return Object.keys(was).filter(k => was[k] !== "" && S(was[k]) !== S(now[k]));
  };
  ok("B Episode 1's cast keeps its canon: every field it already had is unchanged", canonKept("marisol").length === 0 && canonKept("tomas").length === 0,
    { marisol: canonKept("marisol"), tomas: canonKept("tomas") });
  // 2026-09-28 (owner round 1): the pass BEFORE the script designs only the characters this build
  // introduced, so no field of an existing Show character moves — not even an empty one. (The one
  // exception is series.js's deliberate story-world gap fill of an avatar colour the Show character
  // never had: it steers no script and no "drafted from" stamp.)
  const filledGaps = id => {
    const was = withoutLinks(startById(id)), now = withoutLinks(byId(id));
    return Object.keys(now).filter(k => S(was[k]) !== S(now[k]) && k !== "color");
  };
  ok("B …no canon field changes (neither before the script nor by the check)", filledGaps("marisol").length === 0 && filledGaps("tomas").length === 0,
    { marisol: filledGaps("marisol"), tomas: filledGaps("tomas") });
  ok("B the CHECK fills no field of an existing character, not even an empty one (Marisol's empty humanTruth stays empty)",
    marisol.humanTruth === "" && !JSON.stringify([marisol, tomas]).includes("REVISED")
      && show.characters.find(c => c.id === "marisol").humanTruth === "", [marisol.humanTruth, tomas]);
  ok("B …and the check's revision of an existing character's want/need/arc never landed",
    marisol.conscious === "keep the diner open" && marisol.unconscious === "to be forgiven by her sister" && marisol.arcStages[2] === "cracks in public"
      && tomas.conscious === "win the lease", [marisol, tomas]);
  ok("B Episode 1's scene links survive in the Show Bible", S(show.characters.find(c => c.id === "marisol").episodeScenes.E1) === S(["s1", "s2"]));

  // C — an honest log
  const okLine = texts(trace, "ok").find(t => /^Psychology checked/.test(t)) || "";
  ok("C the log counts only the revisions that landed, and says how many Show canon kept",
    /^Psychology checked — 2 characters revised to match the choices on the page\. 1 character kept as Show canon \(already in the Show’s cast when this build started\)\.$/.test(okLine), okLine);
  const obs = texts(trace, "observe");
  ok("C each landed revision is logged", obs.some(t => t === "Revised from the script — Mara Quinn: " + REVISED_NOTE("mara"))
    && obs.some(t => t === "Revised from the script — Tomas Iturbe: " + REVISED_NOTE("tomas-2")), obs);
  ok("C a revision Show canon kept out is named as such, never as revised",
    !obs.some(t => /^Revised from the script — Marisol/.test(t))
      && obs.some(t => /^Kept as Show canon — Marisol Vega was already in the Show’s cast when this build started, so the check’s revision was not applied: in an Episode the check refines only the characters the build introduces/.test(t))
      && !obs.some(t => /only empty fields were filled|before this episode/.test(t)), obs);

  // D — the save echo is this window's own write
  ok("D harness: the Show Bible save echoed back re-derived scene links (the case that used to trip the guard)", r.echoes >= 1, r.echoes);
  ok("D no false 'edited while this agent ran' warning", !texts(trace, "flag").some(t => /edited while this agent ran/.test(t)), texts(trace, "flag"));
  ok("D exactly one undo snapshot for the run", undo.length === 1, undo.length);
  ok("D the first Undo restores the Episode exactly as it was before the run",
    undo[0] && undo[0].scenes.length === 0 && S(undo[0].characters) === S(r.startCast) && Object.keys(undo[0].drafts).length === 0);
  ok("D the save never manufactured scene-link fields on the new cast",
    ["mara", "tomas-2"].every(id => { const c = show.characters.find(x => x.id === id); return c && !("episodeScenes" in c) && !("scenes" in c); }),
    show.characters.map(c => [c.id, c.scenes, c.episodeScenes]));

  // E/F — the internal note never reaches a saved character
  ok("E the check's internal '_revised' note is never saved on a character",
    !live.characters.some(c => "_revised" in c) && !show.characters.some(c => "_revised" in c), live.characters.filter(c => "_revised" in c).map(c => c.id));
}

/* ── D: a REAL mid-run edit still counts — warned once, kept on the Undo stack ── */
{
  const r = await runBuild({ foreign: { at: 3, apply: E => E.setCharacters(cs => cs.map(c => c.id === "tomas" ? { ...c, look: "grey coat" } : c)) } });
  const flags = texts(r.trace, "flag").filter(t => /edited while this agent ran/.test(t));
  ok("D a collaborator's mid-run edit is detected and said once", flags.length === 1, texts(r.trace, "flag"));
  ok("D …its state gets its own undo snapshot, after the pre-run one",
    r.undo.length === 2 && r.undo[0].scenes.length === 0 && r.undo[1].characters.find(c => c.id === "tomas").look === "grey coat", r.undo.length);
  ok("D …and the Show canon edit itself survives the build", r.live.characters.find(c => c.id === "tomas").look === "grey coat");
  ok("D …while the build is otherwise unchanged (no stale scenes)", r.stale.length === 0, r.stale);
}

/* ── B: someone edits the Episode's NEW cast mid-run (a role, a palette, a voice) — the build's
   later saves change only the fields the BUILD changed, so the collaborator's edit survives in
   the app and the Show Bible, while the check's own revision still lands; it's said once and
   the pre-edit state is on the Undo stack ── */
const MARA_EDIT = c => c.id === "mara" ? { ...c, role: "Lead (edited)", palette: ["#112233"], voice: { id: "v-collab" } } : c;
{
  const r = await runBuild({ foreign: { at: 3, apply: E => E.setCharacters(cs => cs.map(MARA_EDIT)) } });
  const mara = r.live.characters.find(c => c.id === "mara"), stored = r.show.characters.find(c => c.id === "mara");
  ok("B a collaborator's mid-run edit to a character this build introduced survives every later save (role, palette, voice)",
    mara.role === "Lead (edited)" && S0(mara.palette) === S0(["#112233"]) && S0(mara.voice) === S0({ id: "v-collab" })
      && stored.role === "Lead (edited)" && S0(stored.palette) === S0(["#112233"]), [mara.role, mara.palette, mara.voice, stored.role]);
  ok("B …while the check's revision of that character still lands, with no stale scene",
    mara.conscious === "REVISED want mara" && mara.arcStages[2] === "r2 mara" && r.stale.length === 0, [mara.conscious, r.stale]);
  ok("B …and the mid-run edit is said once and its state kept on the Undo stack",
    texts(r.trace, "flag").filter(t => /edited while this agent ran/.test(t)).length === 1
      && r.undo.length === 2 && r.undo[1].characters.find(c => c.id === "mara").role === "Lead (edited)", r.undo.length);
  // sensitivity: without the build's last-commit record (options.base) the build's copy overwrites the edit
  const old = await runBuild({ appSrc: app.replace(",base:castCommitted});", "});"),
    foreign: { at: 3, apply: E => E.setCharacters(cs => cs.map(MARA_EDIT)) } });
  ok("B sensitivity: without the last-commit record the collaborator's edit is reverted (the reported regression)",
    old.live.characters.find(c => c.id === "mara").role === "Protagonist");
}

/* ── B (review): an EXISTING Show character with empty fields — E1's second-circle Tomás has a
   want and an arc but no need and no arc by act, and drives an E2 scene. The check proposes both;
   they must not land, or Episode 1's scene he drives reads "needs redraft" ── */
const E1_SECOND_CIRCLE = [E1_CAST_STORED[0],
  { id: "tomas", name: "Tomás Carrillo", role: "Supporting", pronouns: "he/him", conscious: "win the lease", arc: "proud to humble", look: "suede jacket" }];
const E1_SCENE_TOMAS = { id: "s2", no: 2, act: 2, title: "The Lease", loc: "INT. DINER - DAY", summary: "Tomás pushes for the lease.", driver: "tomas",
  openValue: "hope", openCharge: 1, closeValue: "doubt", closeCharge: -1 };
const CHECK_CANON_GAPS = (cast, o) => {
  const out = {};
  cast.forEach(c => {
    const canon = c.name === "Tomás Carrillo" || c.name === "Marisol Vega";
    if (o && o.mode === "before") { if (!canon) out[c.id] = { conscious: "BEFORE want " + c.id, unconscious: "BEFORE need " + c.id }; return; }
    out[c.id] = c.name === "Tomás Carrillo"
      ? { unconscious: "CHECK need tomas", arcStages: { 2: "c2 tomas" }, _revised: REVISED_NOTE("tomas") }
      : { conscious: "REVISED want " + c.id, _revised: REVISED_NOTE(c.id) };
  });
  return out;
};
const WORLD_WITH_TOMAS = [{ id: "mara", name: "Mara Quinn", role: "Protagonist" }, { id: "tomas", name: "Tomás Carrillo", role: "Supporting" },
  { id: "marisol", name: "Marisol Vega", role: "Mentor" }];
{
  const probe = makeBox();
  const e1Stamp = plain(probe.sceneCardSnap(E1_SCENE_TOMAS, plain(E1_SECOND_CIRCLE), null));   // what E1's draft of s2 carries
  const r = await runBuild({ showCast: E1_SECOND_CIRCLE, worldCast: WORLD_WITH_TOMAS, psych: CHECK_CANON_GAPS });
  const tomas = r.live.characters.find(c => c.id === "tomas"), stored = r.show.characters.find(c => c.id === "tomas");
  ok("B (review) harness: canon Tomás drives an Episode 2 scene", r.live.scenes.some(s => s.driver === "tomas"), r.live.scenes.map(s => s.driver));
  ok("B (review) the check writes nothing into an existing character's EMPTY fields (need, arc by act) — in the app or the Show Bible",
    !tomas.unconscious && !tomas.arcStages && !stored.unconscious && !stored.arcStages, [tomas, stored]);
  ok("B (review) …so Episode 1's scene he drives is NOT marked needs redraft by an Episode 2 build",
    r.b.cardChanges(e1Stamp, r.b.sceneCardSnap(E1_SCENE_TOMAS, r.live.characters, null)).length === 0,
    r.b.cardChanges(e1Stamp, r.b.sceneCardSnap(E1_SCENE_TOMAS, r.live.characters, null)));
  const obs = texts(r.trace, "observe"), okLine = texts(r.trace, "ok").find(t => /^Psychology checked/.test(t)) || "";
  ok("B (review) …and the log never calls him revised: 'Kept as Show canon', counted as such",
    !obs.some(t => /^Revised from the script — Tomás Carrillo/.test(t)) && obs.some(t => /^Kept as Show canon — Tomás Carrillo was already in the Show’s cast/.test(t))
      && /1 character revised to match the choices on the page\. 2 characters kept as Show canon/.test(okLine), [okLine, obs]);
  ok("B (review) …while the character this build introduced is refined", r.live.characters.find(c => c.id === "mara").conscious === "REVISED want mara");
  // sensitivity: letting the check apply to canon (the filled-gap path) flips Episode 1's stamp
  const old = await runBuild({ showCast: E1_SECOND_CIRCLE, worldCast: WORLD_WITH_TOMAS, psych: CHECK_CANON_GAPS,
    agentsSrc: agents.replace("return held ? c : {...c, ...fields};", "return {...c, ...fields};") });
  ok("B (review) sensitivity: a check that fills canon gaps marks Episode 1's scene out of date (the reported bug)",
    old.b.cardChanges(e1Stamp, old.b.sceneCardSnap(E1_SCENE_TOMAS, old.live.characters, null)).includes("the driver's psychology"));
}

/* ── B (review): a RENAME while the build runs — of a Show character, or of one this build
   introduced — is the same person: no duplicate, the Episode's scenes stay linked, the new name
   stands, and the log never "revises" a phantom copy ── */
{
  const renameMarisol = E => E.setCharacters(cs => cs.map(c => c.id === "marisol" ? { ...c, name: "Marisol Vega-Ruiz" } : c));
  const r = await runBuild({ foreign: { at: 3, apply: renameMarisol } });
  const ids = r.live.characters.map(c => c.id), bible = r.show.characters.map(c => c.id + ":" + c.name);
  ok("B (review) renaming a Show character mid-run adds no duplicate (app and Show Bible)",
    !ids.includes("marisol-2") && r.live.characters.filter(c => /Marisol/.test(c.name)).length === 1 && !bible.some(x => /^marisol-2/.test(x)), bible);
  ok("B (review) …the rename stands and the Episode's scene stays linked to her", r.live.characters.find(c => c.id === "marisol").name === "Marisol Vega-Ruiz"
    && S0(r.live.scenes.map(s => s.driver)) === S0(["mara", "tomas-2", "marisol", "mara"]), r.live.scenes.map(s => s.driver));
  ok("B (review) …and the log never revises a copy of her", !texts(r.trace, "observe").some(t => /^Revised from the script — Marisol/.test(t)), texts(r.trace, "observe"));
  const renameMara = E => E.setCharacters(cs => cs.map(c => c.id === "mara" ? { ...c, name: "Mara Quinn-Oduya" } : c));
  const m = await runBuild({ foreign: { at: 3, apply: renameMara } });
  const mara = m.live.characters.find(c => c.id === "mara");
  ok("B (review) renaming a character this build introduced: no mara-2, her scenes stay hers, the new name stands, the check still refines her",
    !m.live.characters.some(c => c.id === "mara-2") && mara.name === "Mara Quinn-Oduya" && mara.conscious === "REVISED want mara"
      && m.live.scenes.filter(s => s.driver === "mara").length === 2, [m.live.characters.map(c => c.id + ":" + c.name), m.live.scenes.map(s => s.driver)]);
  const old = await runBuild({ appSrc: app.replace(",base:castCommitted});", "});"), foreign: { at: 3, apply: renameMarisol } });
  ok("B (review) sensitivity: without the last-commit record the rename becomes a duplicate (the reported bug)",
    old.live.characters.some(c => c.id === "marisol-2"), old.live.characters.map(c => c.id));
}

/* ── C (review): a later build of the SAME Episode — its own earlier character is in the Show's
   cast when this build starts, so it is kept as canon (the doc: "introduced in that build"), and
   the log says exactly that, never that she belongs to an earlier episode ── */
{
  const withMara = [...E1_CAST_STORED, { id: "mara", name: "Mara Quinn", role: "Protagonist", conscious: "run-1 want", unconscious: "run-1 need",
    scenes: ["g1"], episodeScenes: { E2: ["g1"] } }];
  const r = await runBuild({ showCast: withMara });
  const obs = texts(r.trace, "observe");
  ok("C (review) a second build of the Episode keeps its earlier character and says why truthfully",
    obs.some(t => /^Kept as Show canon — Mara Quinn was already in the Show’s cast when this build started/.test(t))
      && !obs.some(t => /before this episode|earlier episode/i.test(t.split("The check suggested")[0])), obs);
}

/* ── D (review): an edit that renders just before the check — the check's two back-to-back
   commits push ONE undo snapshot for it, not two identical ones ── */
{
  const edit = E => E.setCharacters(cs => cs.map(c => c.id === "tomas" ? { ...c, look: "grey coat" } : c));
  const r = await runBuild({ onCheck: edit });
  ok("D (review) one undo step for a mid-run edit, even across two commits in one stretch",
    r.undo.length === 2 && r.undo[1].characters.find(c => c.id === "tomas").look === "grey coat", r.undo.map(u => u.ts));
  ok("D (review) …said once, and the edit itself survives", texts(r.trace, "flag").filter(t => /edited while this agent ran/.test(t)).length === 1
    && r.live.characters.find(c => c.id === "tomas").look === "grey coat");
  const old = await runBuild({ onCheck: edit, appSrc: app.replace("if(freshRender && !writtenSigs.has(", "if(!writtenSigs.has(") });
  ok("D (review) sensitivity: re-checking an already-checked render pushes the same snapshot twice", old.undo.length === 3, old.undo.length);
}

/* ── C: a Writer who cannot change the Show cast — nothing is counted as revised ── */
{
  const r = await runBuild({ restricted: true });
  const okLine = texts(r.trace, "ok").find(t => /^Psychology checked/.test(t)) || "";
  ok("C restricted Writer: no revision is claimed, and Show canon is named", /^Psychology checked — no revision applied: /.test(okLine), okLine);
  ok("C restricted Writer: no scene is marked needs redraft", r.stale.length === 0, r.stale);
  ok("C restricted Writer: the Show cast is exactly the run-start cast (no new people, no field changes)",
    r.b.stableJson(r.live.characters.map(withoutLinks)) === r.b.stableJson(r.startCast.map(withoutLinks)), r.live.characters.map(c => c.id));
}

/* ── A/C: a standalone film — every revision lands and is counted ─────────── */
{
  const r = await runBuild({ film: true });
  const okLine = texts(r.trace, "ok").find(t => /^Psychology checked/.test(t)) || "";
  ok("A film: no scene is marked needs redraft", r.stale.length === 0, r.stale);
  ok("C film: all three revisions landed and are counted", /^Psychology checked — 3 characters revised to match the choices on the page\.$/.test(okLine), okLine);
  ok("C film: no Show-canon line in a film", !texts(r.trace).some(t => /Show canon/.test(t)));
  ok("A film: the stamps carry the revised psychology", Object.values(r.live.drafts).every(d => /REVISED want/.test(d.cardSnap.driverPsych)));
  ok("D film: one undo snapshot, no false warning", r.undo.length === 1 && !texts(r.trace, "flag").some(t => /edited while/.test(t)));
  ok("E film: no '_revised' on any character", !r.live.characters.some(c => "_revised" in c));
}

/* ── B: mergeAdaptationCast, unit ─────────────────────────────────────────── */
{
  const S = makeBox().turnSeries;
  const existing = [
    { id: "marisol", name: "Marisol Vega", conscious: "canon", humanTruth: "", scenes: ["s1"], episodeScenes: { E1: ["s1"] } },
    { id: "mara", name: "Mara Quinn", conscious: "before", unconscious: "need", scenes: ["g1"], episodeScenes: { E2: ["g1"] } },
  ];
  const incoming = [
    { id: "marisol", name: "Marisol Vega", conscious: "revised", humanTruth: "gap" },
    { id: "mara", name: "Mara Quinn", conscious: "revised", unconscious: "", scenes: ["stale"], episodeScenes: {} },
    { id: "ivo", name: "Ivo" },
  ];
  const find = (res, id) => res.characters.find(c => c.id === id);
  const plainRun = plain(S.mergeAdaptationCast(plain(existing), plain(incoming), [], {}));
  ok("B without a revisable list the old rule stands: canon wins, gaps fill, new people append",
    find(plainRun, "mara").conscious === "before" && find(plainRun, "marisol").conscious === "canon"
      && find(plainRun, "marisol").humanTruth === "gap" && !!find(plainRun, "ivo"), plainRun.characters);
  ok("B the result lists the people it appended", JSON.stringify(plainRun.addedIds) === JSON.stringify(["ivo"]), plainRun.addedIds);
  const run = plain(S.mergeAdaptationCast(plain(existing), plain(incoming), [], { revisable: ["mara"] }));
  const m = find(run, "mara");
  ok("B a character this run introduced takes the run's value", m.conscious === "revised", m);
  ok("B …an empty incoming value never blanks it", m.unconscious === "need", m);
  ok("B …and its scene links stay the live, derived ones", JSON.stringify(m.scenes) === JSON.stringify(["g1"]) && JSON.stringify(m.episodeScenes) === JSON.stringify({ E2: ["g1"] }), m);
  ok("B a character that existed at run start keeps canon (only gaps fill)", find(run, "marisol").conscious === "canon" && find(run, "marisol").humanTruth === "gap");
  const restricted = plain(S.mergeAdaptationCast(plain(existing), plain(incoming), [], { allowNew: false, revisable: ["mara"] }));
  ok("B a Writer without Show-cast rights changes nothing, even for a revisable id",
    find(restricted, "mara").conscious === "before" && !find(restricted, "ivo") && restricted.blockedNames.includes("Ivo"), restricted);
  // the app wires it: run-start ids are canon, appended ids become revisable
  const block = between(app, "const agentCtxFactory", "const artAgentCtxFactory = (");
  ok("B the agent commit passes this run's own new cast as revisable",
    /revisable:Array\.from\(runIntroducedCastIds\),base:castCommitted\}\)/.test(block) && /reconciled\.addedIds/.test(block)
      && /runStartCastIds\.has\(k\)/.test(block));
}

/* ── D: the Show Bible department merge, unit ─────────────────────────────── */
{
  const b = makeBox(), S = b.turnSeries, md = b.__mergeDepartment;
  const noLinks = plain(md([{ id: "mara", name: "Mara" }], [{ id: "mara", name: "Mara", conscious: "x" }], [{ id: "mara", name: "Mara" }], "E2", [], "characters"));
  ok("D canon with no scene links on either side gets none manufactured",
    noLinks.ok && !("episodeScenes" in noLinks.value[0]) && !("scenes" in noLinks.value[0]) && noLinks.value[0].conscious === "x", noLinks);
  const mapped = plain(md([{ id: "m", scenes: ["s1"], episodeScenes: { E1: ["s1"] } }], [{ id: "m", scenes: ["s1"], episodeScenes: { E1: ["s1"], E2: [] } }],
    [{ id: "m", scenes: ["s1"], episodeScenes: { E1: ["s1"] } }], "E2", [], "characters"));
  ok("D an entity that already has a scene map still records this Episode's explicit slice",
    mapped.ok && JSON.stringify(mapped.value[0].episodeScenes) === JSON.stringify({ E1: ["s1"], E2: [] }), mapped.value[0]);
  const linked = plain(md([{ id: "p" }], [{ id: "p", scenes: ["g1"], episodeScenes: { E2: ["g1"] } }], [{ id: "p" }], "E2", [], "props"));
  ok("D a first link in this Episode is written", JSON.stringify(linked.value[0].episodeScenes) === JSON.stringify({ E2: ["g1"] })
    && JSON.stringify(linked.value[0].scenes) === JSON.stringify(["g1"]), linked.value[0]);
  const unlinked = plain(md([{ id: "p", scenes: ["g1"], episodeScenes: { E2: ["g1"] } }], [{ id: "p", scenes: [], episodeScenes: { E2: [] } }],
    [{ id: "p", scenes: ["g1"], episodeScenes: { E2: ["g1"] } }], "E2", [], "props"));
  ok("D removing the last link is still persisted as an empty slice", JSON.stringify(unlinked.value[0].episodeScenes) === JSON.stringify({ E2: [] }), unlinked.value[0]);
  // the round trip the agent sees: send → merge → scope equals what was sent
  const sent = [{ id: "ivo", name: "Ivo", conscious: "c" }];
  const stored = [{ id: "ivo", name: "Ivo" }];
  const echoed = S.bibleForEpisode(bibleOf(md(stored, S.prepareBibleForEpisode(bibleOf(sent), "E2").characters, stored, "E2", [], "characters").value), "E2", "E1", 2).characters;
  ok("D a map-less character's save echo equals what this window sent", b.stableJson(echoed) === b.stableJson(sent), plain(echoed));
  // the agent's edit signature: stable, and blind to derived scene links only
  const block = between(app, "const agentCtxFactory", "const artAgentCtxFactory = (");
  ok("D the mid-run edit signature hashes stableJson and leaves out characters' scenes / episodeScenes",
    /const sigOf = \(st\)=>\{ const j = stableJson\(st\);/.test(block) && /delete o\.scenes; delete o\.episodeScenes;/.test(block)
      && /writtenSigs\.add\(sigOf\(shapeOf\(\{/.test(block));
}

/* ── E: no object-rest destructuring in Babel-compiled files other than app.jsx ── */
{
  const require = createRequire(import.meta.url);
  const babel = require("@babel/core");
  const parse = (src, filename) => babel.parseSync(src, { filename, babelrc: false, configFile: false, presets: [],
    parserOpts: { plugins: ["jsx"], sourceType: "script", allowReturnOutsideFunction: true } });
  const restSites = (src, filename) => {
    const out = [];
    babel.traverse(parse(src, filename), { RestElement(p) { if (p.parentPath.isObjectPattern()) out.push(filename + ":" + p.node.loc.start.line); } });
    return out;
  };
  const babelScripts = [...html.matchAll(/<script type="text\/babel" src="(app\/[^"?]+)\?v=/g)].map(m => m[1]);
  const files = [...new Set([...babelScripts, ...readdirSync("app").filter(f => f.endsWith(".jsx")).map(f => "app/" + f)])];
  const offenders = files.filter(f => f !== "app/app.jsx").flatMap(f => restSites(read(f), f));
  ok("E no object-rest destructuring in any Babel-compiled app file other than app.jsx (use an explicit copy + delete)", offenders.length === 0, offenders);
  ok("E app.jsx is the LAST Babel-compiled script, so its helper list is the one left standing",
    babelScripts.length > 10 && babelScripts[babelScripts.length - 1] === "app/app.jsx", babelScripts.slice(-3));
  const sample = "const { a, ...rest } = x;\nfunction f({ b, ...more }){ return more; }\nconst g = ({ c: { d, ...deep } })=>deep;\nconst [h, ...arr] = y;";
  ok("E sensitivity: the detector sees declarations, parameters and nested patterns (not array rest)", restSites(sample, "sample.jsx").length === 3, restSites(sample, "sample.jsx"));
  ok("E the fixed sites use explicit copies",
    /const fields = \{ \.\.\.p \}; delete fields\._revised;/.test(agents)
      && /const facts = \{ \.\.\.staged \}; delete facts\.origin; delete facts\.expiresAt;/.test(read("app/videogen.jsx"))
      && read("app/props.jsx").split("const event={ ...legacy }; delete event._legacy; delete event._seq;").length === 3);
}

/* ── F: the stray "_revised" field is stripped when a project loads ───────── */
{
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(castPolicy, fb, { filename: "app/cast-policy.js" });
  const strip = fb.turnStripStrayRevised;
  ok("F cast-policy exports the cleanup", typeof strip === "function");
  if (typeof strip === "function") {
    const b2 = { id: "b", name: "B" };
    const dirty = [{ id: "a", name: "A", conscious: "x", _revised: "note" }, b2];
    const clean = strip(dirty);
    ok("F '_revised' is removed, every other field kept", !("_revised" in clean[0]) && clean[0].conscious === "x" && clean[0].name === "A");
    ok("F an untouched character is the same object; the input is not mutated", clean[1] === b2 && dirty[0]._revised === "note");
    ok("F idempotent: a clean cast comes back as the very same array", strip(clean) === clean);
    ok("F a missing cast is an empty list", Array.isArray(strip(undefined)) && strip(undefined).length === 0);
  }
  const init = between(app, "const [characters, setCharacters] = React.useState(()=>{", "const [props, setProps]");
  const load = between(app, "const loadedCharacters = d.characters||", "setProps(d.props||");
  ok("F the local restore strips it (after the accidental-cast prune)", /turnPruneAccidentalManualCast[\s\S]*turnStripStrayRevised\(pruned\)/.test(init), init);
  ok("F every project load (films, and an Episode's hydrated Show Bible cast) strips it",
    /turnPruneAccidentalManualCast[\s\S]*turnStripStrayRevised\(prunedCharacters\)/.test(load), load);
  const base = between(app, "const base = {};", "lastSentRef.current = base;");
  ok("F the save baseline leaves the stray note out too, so OPENING a project is never a cast change",
    /k==="characters" && Array\.isArray\(d\[k\]\) && typeof window\.turnStripStrayRevised==="function"\s*\?\s*window\.turnStripStrayRevised\(d\[k\]\) : d\[k\]/.test(base), base);
  ok("F an Episode loads through the same applyDoc", /hydrateEpisode\(d, showRow&&showRow\.doc, id\)[\s\S]{0,4000}applyDoc\(readyDoc, stale, settle\)/.test(app));
  const pol = html.indexOf('src="app/cast-policy.js?v='), appTag = html.indexOf('src="app/app.jsx?v=');
  ok("F cast-policy.js loads before app.jsx", pol > 0 && appTag > pol);
  // BEHAVIOUR (review): the real load transform + the real baseline + the real role table — opening
  // a project whose stored cast carries the note is no cast change, so nothing is saved on open and
  // a Writer (who can't save the cast) gets no rollback and no "Art Room changes aren't saved" notice
  const fb2 = { console }; fb2.window = fb2; vm.createContext(fb2);
  vm.runInContext(castPolicy, fb2, { filename: "app/cast-policy.js" });
  vm.runInContext(between(app, "function stableJson(v){", "\n/* ---- persistence"), fb2, { filename: "app/app.jsx#stableJson" });
  vm.runInContext(between(read("app/team.jsx"), "const TEAM_ROLE_SECTIONS = {", "/* Room mutability") + "\nthis.teamCanWriteSection = teamCanWriteSection;", fb2, { filename: "app/team.jsx#sections" });
  vm.runInContext("function __load(d, isAdmin, CHARACTERS){ let chars; const setCharacters = v => { chars = v; };\n"
    + between(app, "const loadedCharacters = d.characters||", "setProps(d.props||") + "\n return chars; }", fb2, { filename: "app/app.jsx#applyDoc-cast" });
  vm.runInContext("function __base(d){ " + between(app, "const base = {};", "lastSentRef.current = base;") + " return base; }", fb2, { filename: "app/app.jsx#baseline" });
  const storedDoc = { project: { title: "Night Shift" }, scenes: [], characters: [{ id: "a", name: "A", conscious: "x", _revised: "note" }, { id: "b", name: "B" }] };
  const loaded = fb2.__load(plain(storedDoc), false, []), baseline = fb2.__base(plain(storedDoc));
  const changedOnOpen = ["characters", "scenes", "project"].filter(k => fb2.stableJson(k === "characters" ? loaded : storedDoc[k]) !== baseline[k]);
  ok("F behaviour: the loaded cast is clean", !loaded.some(c => "_revised" in c) && loaded[1].name === "B");
  ok("F behaviour: opening the project changes no section (no save on open)", changedOnOpen.length === 0, changedOnOpen);
  ok("F behaviour: …so a Writer's first save has no cast section to roll back",
    changedOnOpen.filter(k => !fb2.teamCanWriteSection("writer", k)).length === 0 && !fb2.teamCanWriteSection("writer", "characters"));
  ok("F behaviour sensitivity: against the stored copy (the previous baseline) the cast read as a change a Writer can't save",
    fb2.stableJson(loaded) !== fb2.stableJson(storedDoc.characters));
}

/* ── cache keys: every file the Episode build (and its review) touched loads under a new key ── */
{
  const key = f => (html.match(new RegExp(f.replace(/\./g, "\\.") + "\\?v=([^\"']+)")) || [])[1] || "";
  const PRE = { "app/series.js": "20260911-series5", "app/cast-policy.js": "20260910-castderived1", "app/cloud.jsx": "20260927-redact1",
    "app/videogen.jsx": "20260917-policy-context1", "app/props.jsx": "20260927-tablocks2", "app/agents.jsx": "20260927-spcheck2",
    "app/app.jsx": "20260927-spcheck2", "app/ai.jsx": "20260927-spcheck2", "app/script.jsx": "20260927-spcheck4" };
  for (const [f, pre] of Object.entries(PRE)) { const k = key(f); ok("keys: " + f + " re-keyed past " + pre, !!k && k !== pre && k.slice(0, 8) >= "20260927", k); }
  ok("keys: script.jsx and ai.jsx share one key", key("app/script.jsx") === key("app/ai.jsx"), [key("app/script.jsx"), key("app/ai.jsx")]);
  for (const f of ["app/series.js", "app/app.jsx", "app/agents.jsx"])
    ok("keys: " + f + " (changed again by the review) moved past the Episode build's own key", key(f) !== "20260927-epbuild1", key(f));
}

/* ── MUSE knows (APP_FEATURES) and the owner's doc says it ────────────────── */
{
  const src = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fbox = { console }; fbox.window = fbox; vm.createContext(fbox);
  vm.runInContext(src.replace(/^const APP_FEATURES/, "var APP_FEATURES") + "\n;this.__F = APP_FEATURES;", fbox, { filename: "app/ai.jsx#APP_FEATURES" });
  const F = fbox.__F, what = n => (F.find(f => f.name === n) || {}).what || "";
  const psych = what("Psychology before the script (story build)");
  ok("MUSE: the Episode clause (only the episode's own new cast is refined; older Show cast keeps canon)",
    /IN AN EPISODE OF AN EXISTING TV SHOW the check may refine only the characters THAT EPISODE INTRODUCED/.test(psych) && /keep their Show canon/.test(psych));
  ok("MUSE: the honest log and the drafted-from stamps", /counts a character as revised only when the revision was actually saved/.test(psych)
    && /'Kept as Show canon \\u2014 \\u2026'|'Kept as Show canon — …'/.test(psych) && /never marks its scenes Needs redraft/.test(psych));
  ok("MUSE: Needs redraft says the build's stamps follow the saved cast", /stamps follow the cast actually saved, in a film or in a TV Show episode/.test(what("Needs redraft (script out of date)")));
  ok("MUSE: run integrity says this window's own save echo is not a mid-run edit and the first Undo restores the pre-run story",
    /OWN saves never count as someone else's edit/.test(what("Writers' Room run integrity (honest runs · saved reports)"))
      && /the first 'Undo agent changes' restores the story exactly as it was before the run/.test(what("Writers' Room run integrity (honest runs · saved reports)")));
  ok("MUSE brand rule: the new text names no vendor or method source", ![psych, what("Needs redraft (script out of date)")].some(t => /McKee|Claude|Anthropic|OpenAI|Supabase/i.test(t)));
  const doc = read("docs/Story Pipeline.md");
  ok("doc: the owner's Episode clause is in docs/Story Pipeline.md", doc.includes("**In an Episode of an existing Show** *(2026-09-27, owner-approved)*")
    && doc.includes("the check pass may refine\n> only the characters **that episode introduced** in that build"));
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

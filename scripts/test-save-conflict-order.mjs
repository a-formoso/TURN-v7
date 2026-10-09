#!/usr/bin/env node
/* ============================================================================
   SAVE CONFLICTS MUST MEAN ANOTHER WRITER — never a key-order artefact
   (2026-09-27, "Pine Soot" incident)

   One tab built a Short Film through New Story → Adaptation and, right after
   "continuity mapped", showed "Cloud version changed — Another window saved this
   film first" with the chip stuck on SAVING. No other window existed. The project
   three-way merge (cloud.jsx _seriesMergeProjectObject) compared the baseline
   (JSON.parse(stableJson) → alphabetical keys), the server doc (jsonb → shorter
   keys first) and React state (build order) with plain JSON.stringify, so
   identical nested objects (contract, controllingIdea, setting) read as
   "changed on both sides". Everything from the continuity step on was never saved.

   This test runs the REAL code end-to-end without network:
   - app/cloud.jsx (cloudSaveSections, cloudSaveBibleSections, cloudPatchDoc,
     fence bookkeeping, every merge) loaded in a vm;
   - app/app.jsx's real stableJson, _docConflictCheck, _docSaveResult,
     _adoptTheirs and _replaySeriesPairOutbox;
   - app/confirm.jsx's real ConfirmHost under a minimal hook runner;
   - a fake Supabase client backed by PGlite, so the doc read back has the exact
     jsonb key order PostgREST returns. It can also filter an UPDATE to 0 rows,
     lose a response after the commit, drop a request, or hang.
   The autosave coordinator (app.jsx performSave, non-series branch) is mirrored
   in makeWindow() as a serialized queue (run-time change detection, stale
   generations, adoption only for the newest generation); source contracts at the
   end pin the assumptions it copies.

     node scripts/test-save-conflict-order.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

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

/* ── PGlite-backed fake Supabase client ─────────────────────────────────── */
const db = new PGlite();
await db.exec(`create table turn_projects(id text primary key, owner text, title text, doc jsonb, updated_at timestamptz default now());`);
const hooks = {
  beforeUpdate: null,      // one-shot async hook run just before an UPDATE (a racing writer)
  raceAlways: false,       // every UPDATE loses to a writer that bumps _rev first
  zeroRowUpdates: false,   // RLS-filtered UPDATE / BEFORE trigger returning NULL
  loseResponses: 0,        // the next N UPDATEs commit, then the client sees "Failed to fetch"
  loseChance: null,        // () => boolean, same as loseResponses but random
  dropRequests: 0,         // the next N UPDATEs fail before reaching the server
  hang: null,              // "select" | "update": the request never settles
  updates: 0,
};
function builder() {
  const st = { op: "select", cols: "*", filters: [], orExpr: null, values: null, single: false, maybe: false };
  const b = {
    select(cols) { if (st.op === "select") st.cols = cols || "*"; return b; },
    insert(v) { st.op = "insert"; st.values = v; return b; },
    update(v) { st.op = "update"; st.values = v; return b; },
    eq(col, val) { st.filters.push([col, String(val)]); return b; },
    or(expr) { st.orExpr = expr; return b; },
    single() { st.single = true; return b; },
    maybeSingle() { st.maybe = true; return b; },
    order() { return b; },
    abortSignal() { return b; },
    then(res, rej) { return run(st).then(res, rej); },
  };
  return b;
}
function where(st, params) {
  const parts = [];
  for (const [col, val] of st.filters) {
    params.push(val);
    if (col === "id") parts.push(`id = $${params.length}`);
    else if (col === "doc->>_rev") parts.push(`doc->>'_rev' = $${params.length}`);
    else throw new Error("unsupported filter " + col);
  }
  if (st.orExpr) {
    if (st.orExpr !== "doc->>_rev.is.null,doc->>_rev.eq.0") throw new Error("unsupported or " + st.orExpr);
    parts.push(`(doc->>'_rev' is null or doc->>'_rev' = '0')`);
  }
  return parts.length ? " where " + parts.join(" and ") : "";
}
const rowOut = r => ({ id: r.id, owner: r.owner, title: r.title, doc: r.doc_text == null ? null : JSON.parse(r.doc_text) });
async function run(st) {
  if (st.op === "select") {
    if (hooks.hang === "select") return new Promise(() => {});
    const params = [];
    const { rows } = await db.query(`select id, owner, title, doc::text as doc_text, doc->>'_rev' as rev from turn_projects` + where(st, params), params);
    const out = rows.map(r => st.cols === "rev:doc->>_rev" ? { rev: r.rev }
      : st.cols === "id" ? { id: r.id }
      : st.cols === "doc" ? { doc: JSON.parse(r.doc_text) }   // jsonb text order, as PostgREST sends it
      : rowOut(r));
    if (st.single) return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
    if (st.maybe) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  if (st.op === "insert") {
    const v = st.values;
    const { rows } = await db.query(`insert into turn_projects(id, owner, title, doc) values ($1,$2,$3,$4::jsonb) returning id, owner, title, doc::text as doc_text`, [v.id, v.owner, v.title, JSON.stringify(v.doc)]);
    const out = rows.map(rowOut);
    return st.single ? { data: out[0], error: null } : { data: out, error: null };
  }
  hooks.updates++;
  if (hooks.hang === "update") return new Promise(() => {});
  if (hooks.dropRequests > 0) { hooks.dropRequests--; throw new TypeError("Failed to fetch"); }
  if (hooks.beforeUpdate) { const h = hooks.beforeUpdate; hooks.beforeUpdate = null; await h(st); }
  if (hooks.raceAlways) {
    const id = (st.filters.find(f => f[0] === "id") || [])[1];
    await db.query(`update turn_projects set doc = jsonb_set(doc, '{_rev}', to_jsonb(coalesce((doc->>'_rev')::int, 0) + 1)) where id = $1`, [id]);
  }
  if (hooks.zeroRowUpdates) return { data: [], error: null };
  const params = [JSON.stringify(st.values.doc)];
  const { rows } = await db.query(`update turn_projects set doc = $1::jsonb` + where(st, params) + ` returning id`, params);
  const lose = hooks.loseResponses > 0 ? (hooks.loseResponses--, true) : !!(hooks.loseChance && hooks.loseChance());
  if (lose) throw new TypeError("Failed to fetch");   // committed, but the response never arrived
  return { data: rows.map(r => ({ id: r.id })), error: null };
}
const sb = {
  from: () => builder(),
  rpc: () => ({ then: r => r({ data: null, error: { message: "no rpc" } }) }),
  auth: { getSession: async () => ({ data: { session: { user: { id: "owner-1" } } } }), refreshSession: async () => ({}),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};

/* ── the real app/series.js + app/cloud.jsx ─────────────────────────────── */
const noop = () => {};
const sandbox = {
  console, Promise, Date, Math, Map, Set, JSON, Uint8Array, atob, AbortController, crypto: globalThis.crypto,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 },
  document: {}, navigator: { onLine: true }, location: { origin: "https://app.test" }, fetch: () => new Promise(noop),
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop, addEventListener: noop, removeEventListener: noop,
  dispatchEvent: noop, CustomEvent: function () {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox._sbClient = sb;
vm.createContext(sandbox);
vm.runInContext(read("app/series.js"), sandbox, { filename: "app/series.js" });
vm.runInContext(read("app/cloud.jsx"), sandbox, { filename: "app/cloud.jsx" });
sandbox.cloudGetSession = async () => ({ user: { id: "owner-1" } });   // keep auth offline
const realJsonSame = sandbox._seriesJsonSame;
const legacyJsonSame = (a, b) => (a === undefined && b === undefined) || JSON.stringify(a) === JSON.stringify(b);
const unackedFor = id => vm.runInContext("_seriesUnackedWrites[" + JSON.stringify(String(id)) + "]", sandbox);

/* ── the real stableJson / _docConflictCheck / _docSaveResult / _adoptTheirs ─ */
const app = read("app/app.jsx");
const stableJson = vm.runInNewContext("(" + between(app, "function stableJson(v){", "/* ---- persistence").trim() + ")");
const conflictSrc = between(app, "const _docConflictCheck = (r)=>{", "// persist the editable story");
const saveResultSrc = between(app, "const _docSaveResult = (r, ctx)=>{", "React.useEffect(()=>{");
const adoptSrc = between(app, "const _adoptTheirs = (cloudDoc, mineKeys, mergedProject, mergedShots)=>{", "const _adoptBibleTheirs");
const replaySrc = between(app, "const _replaySeriesPairOutbox=async(episodeId,showId)=>{", "const loadProjectIntoState = async");

const SECTIONS = ["scenes", "characters", "props", "locations", "sluglineUnits", "lookbook", "lookbookNote", "lookbookApplied", "shots",
  "project", "drafts", "beatsMap", "history", "continuityMap", "trash", "selId", "propsSeeded", "locsSeeded", "visualsSeeded"];
const SETTERS = { setScenes: "scenes", setCharacters: "characters", setProps: "props", setLocations: "locations", setSlugUnitsOv: "sluglineUnits",
  setLookbook: "lookbook", setLookbookNote: "lookbookNote", setLookbookApplied: "lookbookApplied", setShots: "shots", setProject: "project",
  setDrafts: "drafts", setBeatsMap: "beatsMap", setHistory: "history", setContinuityMap: "continuityMap", setTrash: "trash" };

function makeWindow(projectId) {
  const w = { id: projectId, state: null, saveState: "saved", chipLog: [], dialogs: [], toasts: [], saves: [], logs: [], answer: null,
    retryPending: false, queue: Promise.resolve() };
  const timers = [];
  const ui = {
    Promise, String, Array, Number, Object, JSON,
    console: { info: (...a) => w.logs.push(a.join(" ")), log: console.log, warn: console.warn, error: console.error },
    window: {
      appConfirm: opts => { w.dialogs.push(opts); return new Promise(resolve => { w.answer = resolve; }); },
      appToast: msg => { w.toasts.push(String(msg)); },
    },
    currentProjectId: projectId,
    showIdRef: { current: null }, projIdRef: { current: projectId },
    dirtyRef: { current: false }, _conflictBusy: { current: false }, saveFailsRef: { current: 0 },
    bibleRebaseRef: { current: null }, saveGenerationRef: { current: 0 }, lastSentRef: { current: {} },
    trashRef: { get current() { return (w.state || {}).trash; } },
    setSaveState: s => { w.saveState = s; w.chipLog.push(s); },
    setRetryTick: () => { w.retryPending = true; },   // the effect re-runs with the CURRENT state
    setTimeout: fn => { timers.push(fn); return timers.length; },
    _docRoleScope: noop,
    _seriesOutboxRows: () => [], _seriesOutboxClear: noop,
    loadProjectIntoState: async () => { await w.load(); return true; },
    _saveScopeActive: () => true,
    stableJson,
  };
  Object.entries(SETTERS).forEach(([name, key]) => { ui[name] = v => { w.state = { ...w.state, [key]: v }; }; });
  ["characters", "locations", "props"].forEach(key => Object.defineProperty(ui, key, { enumerable: true, get: () => (w.state || {})[key] }));
  ui._saveGenerationLatest = c => !!c && c.generation === ui.saveGenerationRef.current;
  vm.createContext(ui);
  vm.runInContext(conflictSrc + "\n" + saveResultSrc + "\n" + adoptSrc
    + "\nthis._check=_docConflictCheck;this._result=_docSaveResult;this._adoptTheirs=_adoptTheirs;", ui);
  w.ui = ui;
  Object.defineProperty(w, "lastSent", { get: () => ui.lastSentRef.current, set: v => { ui.lastSentRef.current = v; } });
  w.flushTimers = () => { while (timers.length) timers.shift()(); };
  // applyDoc (app.jsx ~1077): React state := server doc; baseline := stableJson per section
  w.applyDoc = d => {
    w.state = JSON.parse(JSON.stringify(d));
    const base = {}; SECTIONS.forEach(k => { if (d[k] !== undefined) base[k] = stableJson(d[k]); });
    w.lastSent = base;
  };
  w.load = async () => {
    ui.saveGenerationRef.current++;   // hydration invalidates older completions
    const row = await sandbox.cloudLoadProject(projectId);
    sandbox.cloudNoteDocRev(projectId, row.doc);
    w.applyDoc(row.doc);
  };
  // performSave, non-series branch (app.jsx ~2690-2900), serialized like saveQueueRef
  const perform = async (snap, ctx, label) => {
    if (ui._saveGenerationLatest(ctx)) ui.setSaveState("saving");
    const changed = {};
    Object.keys(snap).forEach(k => {
      if (k === "room" || k === "view" || k === "artView" || k === "selId") return;
      if (stableJson(snap[k]) !== w.lastSent[k]) changed[k] = snap[k];   // computed at RUN time
    });
    const mine = Object.keys(changed);
    if (!mine.length) { ui._result({ ok: true }, ctx); w.saves.push({ label, result: "noop" }); return; }
    const baseline = {};   // _sectionSaveOpts: a baseline only for "project"
    mine.forEach(k => { if (k === "project" && w.lastSent[k] !== undefined) { try { baseline[k] = JSON.parse(w.lastSent[k]); } catch (e) {} } });
    const r = await sandbox.cloudSaveSections(projectId, changed, Object.keys(baseline).length ? { baseline } : undefined);
    if (r && r.ok) {
      mine.forEach(k => { w.lastSent[k] = stableJson(snap[k]); });           // _rememberSent (every generation)
      if (ui._saveGenerationLatest(ctx)) ui._adoptTheirs(r.doc, mine, r.project);   // newest generation only
      ui._result({ ok: true }, ctx);
      w.saves.push({ label, result: "ok" });
    } else {
      ui._result(r, ctx);
      w.saves.push({ label, result: r && r.conflict ? "CONFLICT" : "fail", conflicts: r && r.conflicts, rejected: !!(r && r.rejected), message: r && r.message });
    }
  };
  w.enqueue = label => {   // a state change: new generation, snapshot now, run after the previous save
    const ctx = { projectId, showId: null, generation: ++ui.saveGenerationRef.current };
    ui.dirtyRef.current = true;
    const snap = w.state;
    const launched = w.queue.catch(() => false).then(() => perform(snap, ctx, label));
    w.queue = launched.catch(() => false);
    return launched;
  };
  w.save = label => w.enqueue(label);
  w.drain = async () => {   // let scheduled retries (setRetryTick) run until the queue settles
    for (let i = 0; i < 12; i++) {
      await w.queue; w.flushTimers();
      if (!w.retryPending) break;
      w.retryPending = false; w.enqueue("retry");
    }
    await w.queue;
  };
  return w;
}
const serverDoc = async id => (await sandbox.cloudLoadProject(id)).doc;
const last = w => w.saves[w.saves.length - 1];

/* ── the Adaptation timeline (New Story → Short Film), as the agent writes it ─ */
const emptyDoc = () => ({ scenes: [], characters: [], props: [], locations: [], sluglineUnits: [], lookbook: [], lookbookNote: "", lookbookApplied: {}, shots: [],
  project: { title: "Untitled film", genre: "", logline: "", controllingIdea: {} },
  drafts: {}, beatsMap: {}, history: {}, continuityMap: {},
  selId: null, room: "writers", view: "spine", artView: "lookbook", propsSeeded: false, locsSeeded: false, visualsSeeded: false,
  trash: { characters: [], props: [], locations: [], shots: [] }, blank: true });
const scenes16 = Array.from({ length: 16 }, (_, i) => ({ id: "s" + (i + 1), no: i + 1, title: "Scene " + (i + 1), act: i < 4 ? 1 : i < 12 ? 2 : 3, driver: "c1", valueFrom: "+", valueTo: "-" }));
const cast5 = ["Ada", "Bram", "Cole", "Dina", "Eli"].map((n, i) => ({ id: "c" + (i + 1), name: n, role: i ? "Supporting" : "Protagonist", color: "#888" }));

async function adaptationTimeline() {
  const created = await sandbox.cloudCreateProject("Untitled film", emptyDoc(), {});
  if (!created) throw new Error("create failed: " + sandbox.cloudLastCreateError);
  const w = makeWindow(created.id);
  await w.load();
  const brief = "A chimney sweep's apprentice finds a letter in the soot.";
  w.state.project = { ...w.state.project, format: "film", framework: "threeact", logline: brief,
    synopsis: { paras: [{ key: "act1", label: "Act I", text: "Setup." }, { key: "act2", label: "Act II", text: "Pressure." }] },
    sourceBrief: brief, sourceBriefAt: "2026-09-27T00:05:00.000Z" };
  await w.save("S0 intake");
  // agents.jsx ~876-897 / ai.jsx ~2939-2943: fresh nested objects in build order, and the
  // keys the agent resets to undefined (continuityFacts / continuityLedger)
  let model = { ...w.state.project, title: "Pine Soot", genre: "gothic drama",
    continuityFacts: undefined, continuityLedger: undefined,
    premise: "What would a boy trade for a name?",
    controllingIdea: { value: "We find belonging", cause: "when we stop hiding what we are", polarity: "ironic" },
    centerOfGood: "The apprentice never abandons the younger sweeps.",
    setting: { period: "1890s", duration: "one winter", location: "Edinburgh rooftops", conflict: "institutional" },
    contract: { outer: "punitive", inner: "education", dominant: "inner", suggested: true } };
  w.state = { ...w.state, scenes: scenes16, characters: cast5, project: { ...model } };
  await w.save("S1 spine+world+cast");
  w.state = { ...w.state, characters: cast5.map(c => ({ ...c, conscious: "want", unconscious: "need" })), project: { ...model } };
  await w.save("S2 psychology-before");
  for (let i = 0; i < 16; i += 4) {
    const drafts = { ...w.state.drafts }, beats = { ...w.state.beatsMap };
    for (let j = i; j < i + 4; j++) { drafts["s" + (j + 1)] = { blocks: [{ t: "action", x: "Soot falls." }] }; beats["s" + (j + 1)] = { beats: [{ n: 1, text: "b" }], turnAt: 1 }; }
    w.state = { ...w.state, drafts, beatsMap: beats, project: { ...model } };
    await w.save("S3 scenes " + (i + 1) + "-" + (i + 4));
  }
  // docs/Story Pipeline.md build order: the psychology check against the script, THEN the
  // continuity ledger (agents.jsx agentAdaptation runs them in that order)
  w.state = { ...w.state, characters: w.state.characters.map(c => ({ ...c, arc: "revised" })), project: { ...model } };
  await w.save("S4 psychology reconcile");
  const facts = {}; for (let k = 1; k <= 15; k++) facts["f" + k] = { label: "Fact " + k, detail: "detail " + k, kind: "object" };
  const cmap = {}; scenes16.forEach(s => { cmap[s.id] = { establishes: ["f1"], references: [] }; });
  model = { ...model, continuityFacts: facts, continuityLedger: { sig: "abc", at: "2026-09-27T00:25:00Z", built: 15 } };
  w.state = { ...w.state, continuityMap: cmap, project: { ...model } };
  await w.save("S5 continuity mapped");
  // the build stops here (2026-09-27, owner-approved — docs/Story Pipeline.md): it no longer
  // drafts the cast's visual look, so there is no "cast visual bible" save after the ledger
  return w;
}

/* ── 0. the comparator itself ──────────────────────────────────────────── */
{
  // The real cloud.jsx source, compiled in THIS realm: in the browser app data and the
  // comparator share one realm, while a vm context adds interceptor cost to every
  // global lookup and makes instanceof realm-specific. The vm copy is checked to agree.
  const J = new Function(between(read("app/cloud.jsx"), "function _seriesJsonSame(a,b){", "function _seriesOwnSceneSlice") + "\nreturn _seriesJsonSame;")();
  const probes = [[{ a: 1, b: { c: 1, d: 2 } }, { b: { d: 2, c: 1 }, a: 1 }], [[1, 2], [2, 1]], [{ a: 1, b: undefined }, { a: 1 }], [undefined, null], [[undefined, 1], [null, 1]], [{ a: 1 }, { a: 2 }]];
  ok("comparator: the vm-loaded copy agrees with the main-realm compile", probes.every(([x, y]) => realJsonSame(x, y) === J(x, y)));
  ok("comparator ignores object key order", J({ a: 1, b: { c: 1, d: 2 } }, { b: { d: 2, c: 1 }, a: 1 }));
  ok("comparator keeps array order significant", !J([1, 2], [2, 1]));
  ok("comparator detects a changed value", !J({ a: 1 }, { a: 2 }));
  ok("comparator detects a changed nested value", !J({ s: { location: "Edinburgh", period: "1890s" } }, { s: { period: "1890s", location: "Leith" } }));
  ok("comparator detects an added or removed key", !J({ a: 1 }, { a: 1, b: 2 }) && !J({ a: 1, b: 2 }, { a: 1 }));
  ok("comparator treats an undefined-valued key as missing (JSON semantics)", J({ a: 1, b: undefined }, { a: 1 }));
  ok("comparator keeps undefined and null distinct", !J(undefined, null) && !J(null, undefined));
  ok("comparator: undefined vs undefined is same", J(undefined, undefined));
  ok("comparator: nested arrays of objects ignore key order only", J([{ x: 1, y: 2 }], [{ y: 2, x: 1 }]) && !J([{ x: 1 }, { y: 2 }], [{ y: 2 }, { x: 1 }]));
  ok("comparator: undefined array slots serialise as null", J([undefined, 1], [null, 1]));
  ok("comparator: scalars", J("a", "a") && !J("a", "b") && J(0, 0) && !J(0, "0") && J(true, true));
  ok("comparator: Date uses toJSON", J(new Date(0), "1970-01-01T00:00:00.000Z"));
  const cyc = {}; cyc.self = cyc;
  ok("comparator: cyclic values fall back to identity instead of throwing", J(cyc, cyc) && !J(cyc, {}));
  // exact JSON.stringify parity for the values JSON can't hold (review: sparse arrays / symbols)
  // eslint-disable-next-line no-sparse-arrays
  ok("comparator: array holes read as null, like JSON.stringify", J([, 1], [null, 1]) && J({ a: [, 2] }, { a: [null, 2] }));
  ok("comparator: symbol values drop out of objects and become null in arrays", J({ a: Symbol("x"), b: 1 }, { b: 1 }) && J([Symbol("x")], [null]));
  ok("comparator: function values drop out of objects and become null in arrays", J({ f() {}, b: 1 }, { b: 1 }) && J([() => 1], [null]));
  ok("comparator: NaN / Infinity read as null, -0 as 0", J(NaN, null) && J([Infinity], [null]) && J({ z: -0 }, { z: 0 }));
  ok("comparator: boxed primitives unwrap", J(new Number(2), 2) && J({ s: new String("x") }, { s: "x" }) && J([new Boolean(false)], [false]));
  ok("comparator: BigInt falls back to identity (JSON.stringify throws)", J(1n, 1n) && !J({ a: 1n }, { a: 1n }));
  // randomized parity with the reference definition: JSON.stringify, then sort object keys
  const sortDeep = v => Array.isArray(v) ? v.map(sortDeep) : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v;
  const reference = (a, b) => { let sa, sb2; try { sa = JSON.stringify(a); sb2 = JSON.stringify(b); } catch (e) { return a === b; }
    const ca = sa === undefined ? undefined : JSON.stringify(sortDeep(JSON.parse(sa)));
    const cb = sb2 === undefined ? undefined : JSON.stringify(sortDeep(JSON.parse(sb2)));
    return ca === cb; };
  let s = 90210; const R = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const leaf = () => { const r = R(); return r < .08 ? undefined : r < .12 ? (() => 1) : r < .16 ? Symbol("s") : r < .2 ? NaN : r < .24 ? -0 : r < .3 ? null
    : r < .34 ? new Date(Math.floor(R() * 2) * 1000) : r < .37 ? new Number(1) : r < .4 ? Infinity : r < .7 ? ["a", "b"][Math.floor(R() * 2)] : Math.floor(R() * 3); };
  const gen = d => { const r = R(); if (d > 3 || r < .35) return leaf();
    if (r < .65) { const arr = []; const n = Math.floor(R() * 4); for (let i = 0; i < n; i++) { if (R() < .15) { arr.length++; continue; } arr.push(gen(d + 1)); } return arr; }
    const o = {}; const n = Math.floor(R() * 4); for (let i = 0; i < n; i++) o[["a", "b", "c", "d"][Math.floor(R() * 4)]] = gen(d + 1); return o; };
  const variant = (v, d = 0) => { if (R() < .08) return gen(d);
    if (Array.isArray(v)) { const out = v.slice(); for (let i = 0; i < out.length; i++) if (i in out) out[i] = variant(out[i], d + 1); return out; }
    if (v && typeof v === "object" && v.constructor === Object) { const ks = Object.keys(v).sort(() => R() - .5); const o = {}; ks.forEach(k => { o[k] = variant(v[k], d + 1); }); if (R() < .1) o.e = gen(d + 1); return o; }
    return R() < .1 ? leaf() : v; };
  let mismatch = null, equalPairs = 0;
  for (let i = 0; i < 20000 && !mismatch; i++) { const a = gen(0), b = variant(a); const x = J(a, b); if (x) equalPairs++; if (x !== reference(a, b)) mismatch = { a: String(a), i }; }
  ok("comparator matches JSON.stringify-up-to-key-order on 20000 random pairs (holes, symbols, NaN, Dates, boxed)", !mismatch && equalPairs > 5000, { mismatch, equalPairs });
  // cost: a structural walk, about one JSON.stringify — not a sorted-key string build (review: ~7x)
  const drafts = {}; for (let i = 0; i < 120; i++) drafts["s" + i] = { blocks: Array.from({ length: 120 }, (_, j) => ({ t: "action", x: "Lorem ipsum dolor sit amet ".repeat(4) + j, id: "b" + j, meta: { a: 1, b: [1, 2, 3] } })) };
  const reversed = v => (!v || typeof v !== "object") ? v : Array.isArray(v) ? v.map(reversed) : Object.fromEntries(Object.keys(v).reverse().map(k => [k, reversed(v[k])]));
  const copy = reversed(JSON.parse(JSON.stringify(drafts)));
  const best = fn => { for (let i = 0; i < 2; i++) fn(); let t = Infinity; for (let r = 0; r < 5; r++) { const t0 = performance.now(); fn(); t = Math.min(t, performance.now() - t0); } return t; };
  const tStringify = best(() => JSON.stringify(drafts) === JSON.stringify(copy));
  const tSame = best(() => J(drafts, copy));
  ok("comparator: equal 2.4 MB drafts in reversed key order compare equal", J(drafts, copy));
  ok("comparator: cost stays within 5x of the legacy JSON.stringify compare", tSame <= Math.max(5 * tStringify, 25), { tSame: +tSame.toFixed(1), tStringify: +tStringify.toFixed(1) });
  // stableJson (the lastSentRef baseline) must stay valid JSON for JSON.parse
  // eslint-disable-next-line no-sparse-arrays
  ok("stableJson: holes, functions and symbols follow JSON rules (valid JSON baseline)",
    stableJson([, 1]) === "[null,1]" && stableJson({ f() {}, s: Symbol("x"), b: 1 }) === '{"b":1}' && stableJson([() => 1, Symbol("y")]) === "[null,null]"
    && JSON.stringify(JSON.parse(stableJson({ a: [, { z: 1, y: 2 }] }))) === '{"a":[null,{"y":2,"z":1}]}');
}

/* ── 1. the incident timeline: one window, no other writer ───────────────── */
{
  const w = await adaptationTimeline();
  ok("1 Adaptation timeline S0-S5 saves without any conflict", !w.saves.some(s => s.result !== "ok"), w.saves.map(s => s.label + ":" + s.result + (s.conflicts ? JSON.stringify(s.conflicts) : "")));
  ok("1 no conflict dialog opened", w.dialogs.length === 0, w.dialogs.map(d => d.body));
  ok("1 chip ends Saved and the save is not dirty", w.saveState === "saved" && w.ui.dirtyRef.current === false, { chip: w.saveState, dirty: w.ui.dirtyRef.current });
  const srv = await serverDoc(w.id);
  ok("1 continuity facts (15) and ledger reach the server", srv.project.continuityFacts && Object.keys(srv.project.continuityFacts).length === 15 && srv.project.continuityLedger && srv.project.continuityLedger.built === 15, Object.keys(srv.project));
  ok("1 continuity map reaches the server", Object.keys(srv.continuityMap || {}).length === 16);
  ok("1 psychology reconcile reaches the server, and the build wrote no cast look", srv.characters.length === 5 && srv.characters.every(c => c.arc === "revised" && !c.look && !c.wardrobe && !c.coreBody && !c.wardrobeMask), srv.characters[0]);
  ok("1 contract / controllingIdea / setting survive intact", srv.project.contract.dominant === "inner" && srv.project.controllingIdea.polarity === "ironic" && srv.project.setting.location === "Edinburgh rooftops");
  ok("1 fence bookkeeping matches the server revision", sandbox.cloudSeenRev(w.id) === Number(srv._rev) && Number(srv._rev) > 0, { seen: sandbox.cloudSeenRev(w.id), rev: srv._rev });
  ok("1 server project equals the window's project (nothing left unsaved or unadopted)", stableJson(srv.project) === stableJson(w.state.project));
}

/* ── 1b. sensitivity: the legacy order-sensitive comparator reproduces the incident ─ */
{
  sandbox._seriesJsonSame = legacyJsonSame;
  let w;
  try { w = await adaptationTimeline(); } finally { sandbox._seriesJsonSame = realJsonSame; }
  const first = w.saves.find(s => s.result === "CONFLICT");
  ok("1b legacy comparator: first conflict is the continuity save (the incident)", first && /continuity mapped$/.test(first.label), w.saves.map(s => s.label + ":" + s.result));
  ok("1b legacy comparator: conflicts are the client-built nested project keys",
    first && ["project.contract", "project.controllingIdea", "project.setting"].every(k => first.conflicts.includes(k)), first && first.conflicts);
  ok("1b legacy comparator: exactly one dialog; the chip still reads Not saved after later conflicts (never stuck on SAVING)",
    w.dialogs.length === 1 && w.saveState === "failed" && w.ui.dirtyRef.current === true, { dialogs: w.dialogs.length, chip: w.saveState });
  ok("1b legacy comparator: dialog names the overlapping settings in plain words instead of blaming another window",
    w.dialogs[0] && /Project settings changed/.test(w.dialogs[0].body) && !/Another window saved this film first/.test(w.dialogs[0].body)
    && Array.isArray(w.dialogs[0].items) && w.dialogs[0].items.includes("Project settings: Story contract")
    && w.dialogs[0].items.includes("Project settings: Controlling idea") && !w.dialogs[0].items.some(i => /^project\./.test(i)), w.dialogs[0]);
  ok("1b the raw conflict keys still reach the console for debugging", w.logs.some(l => /project\.contract/.test(l) && /project\.controllingIdea/.test(l)), w.logs);
}

/* ── 2. fresh load, then edit a nested project key / re-set it in client order ─ */
for (const [key, edit, check] of [
  ["setting", p => ({ ...p, setting: { ...p.setting, location: "Leith docks" } }), p => p.setting.location === "Leith docks" && p.setting.period === "1890s"],
  ["controllingIdea", p => ({ ...p, controllingIdea: { ...p.controllingIdea, value: "We find home" } }), p => p.controllingIdea.value === "We find home" && p.controllingIdea.polarity === "ironic"],
  ["contract", p => ({ ...p, contract: { ...p.contract, dominant: "outer", suggested: false } }), p => p.contract.dominant === "outer" && p.contract.suggested === false && p.contract.inner === "education"],
  ["logline", p => ({ ...p, logline: "New logline" }), p => p.logline === "New logline"],
]) {
  const created = await sandbox.cloudCreateProject("Pine Soot", { ...emptyDoc(), project: { title: "Pine Soot", logline: "x",
    setting: { period: "1890s", duration: "one winter", location: "Edinburgh rooftops", conflict: "institutional" },
    controllingIdea: { value: "We find belonging", cause: "when we stop hiding", polarity: "ironic" },
    contract: { outer: "punitive", inner: "education", dominant: "inner", suggested: true } } }, {});
  const w = makeWindow(created.id);
  await w.load();
  w.state.project = edit(w.state.project);
  await w.save("edit " + key);
  ok("2 fresh load: editing project." + key + " saves", last(w).result === "ok" && w.saveState === "saved", last(w));
  ok("2 fresh load: the nested project." + key + " edit is on the server", check((await serverDoc(created.id)).project), (await serverDoc(created.id)).project[key]);
  // an agent re-sets the same data in client order, then any later project edit
  w.state.project = { ...w.state.project, contract: { outer: w.state.project.contract.outer, inner: "education", dominant: w.state.project.contract.dominant, suggested: w.state.project.contract.suggested } };
  await w.save("re-set contract in client order");
  w.state.project = { ...w.state.project, premise: "later edit after " + key };
  await w.save("later project edit");
  ok("2 a later project edit after a client-order re-set still saves (" + key + ")", last(w).result === "ok" && w.dialogs.length === 0, last(w));
  const p = (await serverDoc(created.id)).project;
  ok("2 the earlier edit and the later one both survive (" + key + ")", check(p) && p.premise === "later edit after " + key, p);
}

/* ── 3. a REAL second window: same key, different value → conflict; loser writes nothing ─ */
let showConflictWindow;
{
  const w0 = await adaptationTimeline();
  const A = makeWindow(w0.id), B = makeWindow(w0.id);
  await A.load(); await B.load();
  B.state.project = { ...B.state.project, logline: "B's logline" }; await B.save("B logline");
  A.state.project = { ...A.state.project, logline: "A's logline" }; await A.save("A logline");
  ok("3 first saver succeeds", last(B).result === "ok");
  ok("3 second window, same key, different value → {conflict} naming project.logline",
    last(A).result === "CONFLICT" && JSON.stringify(last(A).conflicts) === JSON.stringify(["project.logline"]), last(A));
  ok("3 the loser wrote nothing (server keeps B's value)", (await serverDoc(w0.id)).project.logline === "B's logline");
  ok("3 one dialog; chip Not saved; local edit kept", A.dialogs.length === 1 && A.saveState === "failed" && A.ui.dirtyRef.current === true && A.state.project.logline === "A's logline");
  const d = A.dialogs[0];
  ok("3 dialog keeps the destructive-choice contract", d.title === "Cloud version changed" && d.confirmLabel === "Load cloud version" && d.cancelLabel === "Keep my edits" && d.danger === true);
  ok("3 dialog asks for the safe default (Keep focused, Enter never confirms)", d.safeDefault === true, d);
  ok("3 dialog says what overlapped, in plain words", /Project settings changed in another window/.test(d.body) && JSON.stringify(d.items) === JSON.stringify(["Project settings: Logline"]), d);
  ok("3 dialog keeps the not-saved promise", /Your local edit is still visible and has NOT been saved/.test(d.body));
  showConflictWindow = A;
}

/* ── C. UI state while the dialog is open, and both dialog answers ─────── */
{
  const A = showConflictWindow;
  A.state.project = { ...A.state.project, logline: "A's logline, again" };
  await A.save("A edits again while the dialog is open");
  ok("C repeat conflict while the dialog is open: chip reads Not saved, never SAVING",
    last(A).result === "CONFLICT" && A.saveState === "failed" && A.ui.dirtyRef.current === true, { chip: A.saveState, log: A.chipLog.slice(-4) });
  ok("C repeat conflict opens no second dialog", A.dialogs.length === 1, A.dialogs.length);
  // Keep my edits
  A.answer(false); await tick();
  ok("C Keep my edits leaves the local edit on screen, Not saved, with a toast",
    A.saveState === "failed" && A.state.project.logline === "A's logline, again" && A.toasts.some(t => /marked Not saved/.test(t)), { chip: A.saveState, toasts: A.toasts });
  ok("C the dialog guard is still held until its timer runs", A.ui._conflictBusy.current === true);
  A.flushTimers();
  ok("C the dialog guard releases after its timer", A.ui._conflictBusy.current === false);
  // next conflict opens a fresh dialog; Load cloud version
  A.state.project = { ...A.state.project, logline: "A's third logline" };
  await A.save("A edits after keeping");
  ok("C a later conflict opens a fresh dialog", A.dialogs.length === 2 && A.saveState === "failed");
  A.answer(true);
  for (let i = 0; i < 20 && A.saveState !== "saved"; i++) await new Promise(r => setTimeout(r, 5));
  ok("C Load cloud version replaces local state with server truth and ends Saved",
    A.saveState === "saved" && A.ui.dirtyRef.current === false && A.state.project.logline === "B's logline", { chip: A.saveState, logline: A.state.project.logline });
  A.flushTimers();
  A.state.project = { ...A.state.project, logline: "A after reload" };
  await A.save("A edits after reload");
  ok("C after Load cloud version the next edit saves", last(A).result === "ok" && A.saveState === "saved", last(A));
}

/* ── C2. dialog wording for every result shape, and readable labels ──────── */
{
  const created = await sandbox.cloudCreateProject("Labels", { ...emptyDoc(),
    characters: [{ id: "c1", name: "Ada" }], locations: [{ id: "l1", name: "Rooftops" }],
    trash: { characters: [{ id: "c3", name: "Nell", deletedAt: 1 }], props: [], locations: [], shots: [] } }, {});
  const w = makeWindow(created.id); await w.load();
  const answer = async () => { w.answer(false); await tick(); w.flushTimers(); };
  w.ui._check({ conflict: true, conflicts: ["project.logline"] });
  ok("C2 conflicts without a message fall back to 'These settings changed in another window.'",
    /^These settings changed in another window\. Your local edit is still visible/.test(w.dialogs[0].body) && JSON.stringify(w.dialogs[0].items) === JSON.stringify(["Project settings: Logline"]), w.dialogs[0]);
  await answer();
  w.ui._check({ conflict: true, message: "The Show Bible changed in another Episode. Reload before applying overlapping edits.",
    conflicts: ["c1.name", "c1 (delete conflicted)", "trash.characters.c3 (delete conflicted)", "l1.episodeScenes.ep1", "lookbookNote", "project.controllingIdea", "project (missing merge baseline)", "c9 (deleted remotely)"] });
  ok("C2 Show Bible and project keys become readable labels", JSON.stringify(w.dialogs[1].items) === JSON.stringify([
    "Ada (character): name", "Ada (character): deleted here but changed elsewhere", "Recently deleted: Nell (character): deleted here but changed elsewhere",
    "Rooftops (location): scene links in this Episode", "Lookbook note", "Project settings: Controlling idea",
    "Project settings (no reliable saved copy to compare)", "C9: deleted elsewhere but changed here"]), w.dialogs[1].items);
  await answer();
  w.ui._check({ conflict: true, message: "x", conflicts: Array.from({ length: 11 }, (_, i) => "project.k" + i) });
  ok("C2 at most 8 items, then '…and N more'", w.dialogs[2].items.length === 9 && w.dialogs[2].items[8] === "…and 3 more" && w.dialogs[2].items[0] === "Project settings: K0", w.dialogs[2].items);
  await answer();
  w.ui._check({ conflict: true });
  ok("C2 the bare lost-fence result keeps the generic wording and lists nothing",
    /^Another window saved this film first\./.test(w.dialogs[3].body) && w.dialogs[3].items === undefined, w.dialogs[3]);
  await answer();
  // a merge that could not compare at all does not blame another window
  delete w.lastSent.project;   // no acknowledged baseline for project
  w.state.project = { ...w.state.project, logline: "edited without a baseline" };
  await w.save("project save without a baseline");
  const d = w.dialogs[4];
  ok("C2 a missing-baseline project merge is a conflict whose message does not blame another window",
    last(w).result === "CONFLICT" && d && !/another window/i.test(d.body.split(" Your local edit")[0]) && /couldn't safely compare/.test(d.body)
    && JSON.stringify(d.items) === JSON.stringify(["Project settings (no reliable saved copy to compare)"]), { r: last(w), d });
}

/* ── 4. race: B commits the same key between A's read and A's fenced UPDATE ─ */
{
  const w0 = await adaptationTimeline();
  const E = makeWindow(w0.id), F = makeWindow(w0.id);
  await E.load(); await F.load();
  E.state.project = { ...E.state.project, genre: "E genre" };
  F.state.project = { ...F.state.project, genre: "F genre" };
  hooks.beforeUpdate = async () => { await F.save("F commits genre mid-flight"); };
  await E.save("E saves genre (raced)");
  ok("4 interleaved same-key race: the fence retries, then reports the conflict",
    last(F).result === "ok" && last(E).result === "CONFLICT" && last(E).conflicts.includes("project.genre"), { E: last(E), F: last(F) });
  ok("4 server keeps the committed racer's value", (await serverDoc(w0.id)).project.genre === "F genre");
}

/* ── 5. disjoint nested edits from two windows both land ────────────────── */
{
  const w0 = await adaptationTimeline();
  const C = makeWindow(w0.id), D = makeWindow(w0.id);
  await C.load(); await D.load();
  D.state.project = { ...D.state.project, setting: { location: "Leith docks", period: "1890s", duration: "one winter", conflict: "institutional" } };
  await D.save("D edits setting (client order)");
  C.state.project = { ...C.state.project, contract: { outer: "punitive", inner: "education", dominant: "outer", suggested: false } };
  await C.save("C edits contract (client order)");
  const p = (await serverDoc(w0.id)).project;
  ok("5 disjoint nested project edits from two windows merge", last(D).result === "ok" && last(C).result === "ok" && p.setting.location === "Leith docks" && p.contract.dominant === "outer", { D: last(D), C: last(C) });
  ok("5 cross-window merge keeps the rest of the project", p.continuityFacts && Object.keys(p.continuityFacts).length === 15 && p.title === "Pine Soot");
  const I = makeWindow(w0.id), K = makeWindow(w0.id);
  await I.load(); await K.load();
  K.state.characters = [...K.state.characters, { id: "c9", name: "Nell" }]; await K.save("K adds character");
  I.state.project = { ...I.state.project, continuityFacts: { ...I.state.project.continuityFacts, f99: { label: "x" } } }; await I.save("I edits continuity");
  const s = await serverDoc(w0.id);
  ok("5 cross-section edits from two windows both land", last(I).result === "ok" && last(K).result === "ok" && s.characters.some(c => c.id === "c9") && s.project.continuityFacts.f99);
}

/* ── 5b. after a clean merge the saving window shows the other window's keys ─ */
{
  const created = await sandbox.cloudCreateProject("P1", { ...emptyDoc(), project: { title: "P1", logline: "x",
    setting: { period: "1890s", duration: "one winter", location: "Edinburgh rooftops", conflict: "institutional" } } }, {});
  const A = makeWindow(created.id), B = makeWindow(created.id);
  await A.load(); await B.load();
  B.state.project = { ...B.state.project, setting: { ...B.state.project.setting, location: "Leith" } }; await B.save("B setting");
  const st = A.state.project.setting;   // A re-sets setting in client order (same content) and edits the logline
  A.state.project = { ...A.state.project, logline: "A logline", setting: { location: st.location, conflict: st.conflict, period: st.period, duration: st.duration } };
  await A.save("A logline + reordered setting");
  const p = (await serverDoc(created.id)).project;
  ok("5b A's save merges cleanly and the server keeps B's setting", last(A).result === "ok" && p.setting.location === "Leith" && p.logline === "A logline", { r: last(A), p });
  ok("5b A now shows B's setting.location (merged project adopted)", A.state.project.setting.location === "Leith" && A.state.project.logline === "A logline", A.state.project);
  ok("5b the adoption is not mistaken for a local edit (baseline = server project)", A.lastSent.project === stableJson(p));
  ok("5b adoption shows the collaborator toast", A.toasts.some(t => /Picked up changes/.test(t)), A.toasts);
  await A.save("A has nothing new");
  ok("5b the next save is a no-op, not a write-back", last(A).result === "noop", last(A));
  // a queued newer generation must not be stomped by an older save's merged project
  B.state.project = { ...B.state.project, genre: "B genre" }; await B.save("B genre");
  // React state is immutable: each change is a new object, so each queued save keeps its own snapshot
  A.state = { ...A.state, project: { ...A.state.project, logline: "A logline 2" } };
  const first = A.enqueue("A logline 2 (older generation)");
  A.state = { ...A.state, project: { ...A.state.project, premise: "A premise (newer)" } };
  const second = A.enqueue("A premise (newer generation)");
  await first;
  ok("5b an older generation's merged project is not adopted over a newer edit", A.state.project.premise === "A premise (newer)" && A.state.project.genre !== "B genre", A.state.project);
  await second;
  ok("5b both queued generations wrote (no coalescing artefact)", A.saves.slice(-2).every(x => x.result === "ok"), A.saves.slice(-2));
  const p2 = (await serverDoc(created.id)).project;
  ok("5b the newest generation adopts the merged project and nothing is lost",
    A.state.project.genre === "B genre" && A.state.project.premise === "A premise (newer)" && A.state.project.logline === "A logline 2"
    && stableJson(p2) === stableJson(A.state.project) && A.saveState === "saved", { local: A.state.project, server: p2 });
}

/* ── 6. identical concurrent edits are not a conflict ────────────────────── */
{
  const w0 = await adaptationTimeline();
  const G = makeWindow(w0.id), H = makeWindow(w0.id);
  await G.load(); await H.load();
  G.state.project = { ...G.state.project, setting: { period: "1890s", location: "Leith", duration: "one winter", conflict: "institutional" } };
  H.state.project = { ...H.state.project, setting: { conflict: "institutional", duration: "one winter", location: "Leith", period: "1890s" } };
  await G.save("G setting"); await H.save("H setting (same content, other key order)");
  ok("6 identical concurrent edit (different key order) → no conflict", last(G).result === "ok" && last(H).result === "ok" && H.dialogs.length === 0, { G: last(G), H: last(H) });
}

/* ── 7. cloudPatchDoc (cover/order) interleaved with the section save ───── */
{
  const w0 = await adaptationTimeline();
  const w = makeWindow(w0.id); await w.load();
  hooks.beforeUpdate = async () => { await sandbox.cloudPatchDoc(w0.id, d => { d.cover = "data:image/png;base64,AA"; }); };
  w.state.project = { ...w.state.project, logline: "Edited during a poster save" };
  await w.save("section save raced by cloudPatchDoc");
  const s = await serverDoc(w0.id);
  ok("7 section save absorbs a racing cloudPatchDoc (no conflict)", last(w).result === "ok" && w.dialogs.length === 0, last(w));
  ok("7 both writes survive", s.cover === "data:image/png;base64,AA" && s.project.logline === "Edited during a poster save");
  ok("7 fence bookkeeping stays in sync after the race", sandbox.cloudSeenRev(w0.id) === Number(s._rev), { seen: sandbox.cloudSeenRev(w0.id), rev: s._rev });
  const p = await sandbox.cloudPatchDoc(w0.id, d => { d.homeOrder = 4; });
  w.state.project = { ...w.state.project, premise: "after homeOrder patch" };
  await w.save("save after a clean cloudPatchDoc");
  ok("7 a later save after cloudPatchDoc still lands", p.ok && last(w).result === "ok" && (await serverDoc(w0.id)).homeOrder === 4);
}

/* ── 8. a 0-row UPDATE with an unchanged _rev (RLS / trigger) is NOT a conflict ─ */
{
  const w0 = await adaptationTimeline();
  const w = makeWindow(w0.id); await w.load();
  hooks.zeroRowUpdates = true; const before = hooks.updates;
  w.state.scenes = [...w.state.scenes, { id: "s17", title: "Coda" }];
  try { await w.save("save whose UPDATE is filtered"); } finally { hooks.zeroRowUpdates = false; }
  const r = last(w);
  ok("8 a 0-row UPDATE whose re-read shows the same _rev is a plain failure after ONE attempt, not {conflict}",
    r.result === "fail" && r.rejected === true && hooks.updates - before === 1, { r, tries: hooks.updates - before });
  ok("8 its message says the server declined and does not blame another window",
    /server did not accept/.test(r.message) && /another window did not cause it/.test(r.message), r.message);
  ok("8 no conflict dialog and no Load cloud version offer; chip Retrying (backoff), still dirty",
    w.dialogs.length === 0 && w.saveState === "retrying" && w.ui.dirtyRef.current === true, { dialogs: w.dialogs.length, chip: w.saveState });
  hooks.zeroRowUpdates = true;
  try { for (let i = 0; i < 3; i++) { w.retryPending = false; w.flushTimers(); await w.save("retry " + (i + 1) + " still filtered"); } }
  finally { hooks.zeroRowUpdates = false; }
  ok("8 after the retries are spent: chip Not saved, one toast with the server's reason, still no dialog",
    w.saveState === "failed" && w.toasts.filter(t => /server did not accept/.test(t)).length === 1 && w.dialogs.length === 0, { chip: w.saveState, toasts: w.toasts });
  await w.save("access restored");
  ok("8 once the server accepts again the same edit saves", last(w).result === "ok" && w.saveState === "saved" && (await serverDoc(w0.id)).scenes.some(s => s.id === "s17"), last(w));
  // Show Bible and cloudPatchDoc apply the same rule
  const show = await sandbox.cloudCreateProject("RLS Show", { isShow: true, _rev: 1, bible: { characters: [{ id: "c1", name: "Ada" }], locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } } }, {});
  const loaded = await serverDoc(show.id); sandbox.cloudNoteDocRev(show.id, loaded);
  hooks.zeroRowUpdates = true; let b0 = hooks.updates, br, pr;
  try {
    br = await sandbox.cloudSaveBibleSections(show.id, { characters: [{ name: "Ada Grey", id: "c1" }] }, { episodeId: "ep1", baseline: JSON.parse(stableJson(loaded.bible)) });
    ok("8 Show Bible: 0 rows at an unchanged _rev → {rejected}, one attempt, no conflict", br.ok === false && br.rejected === true && !br.conflict && hooks.updates - b0 === 1 && /Show Bible/.test(br.message), br);
    b0 = hooks.updates;
    pr = await sandbox.cloudPatchDoc(show.id, d => { d.cover = "x"; });
    ok("8 cloudPatchDoc: 0 rows at an unchanged _rev → {rejected}, one attempt, no conflict", pr.ok === false && pr.rejected === true && !pr.conflict && hooks.updates - b0 === 1, pr);
  } finally { hooks.zeroRowUpdates = false; }
  // a writer that really keeps winning is still a conflict, with the bare wording
  const v = makeWindow(w0.id); await v.load();
  hooks.raceAlways = true; const r0 = hooks.updates;
  v.state.project = { ...v.state.project, logline: "never lands" };
  try { await v.save("save that loses every race"); } finally { hooks.raceAlways = false; }
  ok("8 a genuinely newer _rev on every attempt is still {conflict} after 4 tries", last(v).result === "CONFLICT" && hooks.updates - r0 === 4, { r: last(v), tries: hooks.updates - r0 });
  ok("8 that bare lost-fence conflict shows the generic wording and lists nothing",
    v.dialogs[0] && /^Another window saved this film first\./.test(v.dialogs[0].body) && v.dialogs[0].items === undefined, v.dialogs[0]);
  ok("8 the losing write never landed", (await serverDoc(w0.id)).project.logline !== "never lands");
}

/* ── 8b. lost responses: the UPDATE commits, the client never hears back ─── */
async function lostResponseCase({ changeAgain = false, remoteAfter = false, reached = true, lose = 1 } = {}) {
  const created = await sandbox.cloudCreateProject("Pine Soot", { ...emptyDoc(), project: { title: "Pine Soot", logline: "a",
    contract: { outer: "punitive", inner: "education", dominant: "inner", suggested: true } } }, {});
  const w = makeWindow(created.id); await w.load();
  w.state = { ...w.state, project: { ...w.state.project, logline: "ab", continuityFacts: { f1: { label: "x", kind: "object" } } } };
  if (reached) hooks.loseResponses = lose; else hooks.dropRequests = 1;
  await w.save("S lost response");
  if (lose > 1) { w.state = { ...w.state, project: { ...w.state.project, logline: "abc" } }; await w.save("second lost response"); }
  if (remoteAfter) { const B = makeWindow(created.id); await B.load(); B.state.project = { ...B.state.project, logline: "B's" }; await B.save("B edits the logline"); }
  if (changeAgain) w.state = { ...w.state, project: { ...w.state.project, logline: lose > 1 ? "abcd" : "abc" } };
  hooks.loseResponses = 0; hooks.dropRequests = 0;
  await w.save("retry after lost response");
  return { w, id: created.id, srv: await serverDoc(created.id) };
}
{
  const a = await lostResponseCase();
  ok("8b lost response, retry with the same snapshot → saves, no dialog", a.w.saves[0].result === "fail" && last(a.w).result === "ok" && a.w.dialogs.length === 0 && a.srv.project.logline === "ab", a.w.saves);
  const b = await lostResponseCase({ changeAgain: true });
  ok("8b lost response, then THIS window changes the same key again → saves, no false conflict",
    last(b.w).result === "ok" && b.w.dialogs.length === 0 && b.srv.project.logline === "abc" && b.srv.project.continuityFacts.f1.label === "x", b.w.saves);
  ok("8b the unacknowledged-write memory is cleared once a write is acknowledged", unackedFor(b.id) === undefined, unackedFor(b.id));
  const c = await lostResponseCase({ changeAgain: true, remoteAfter: true });
  ok("8b lost response, then ANOTHER window changes that key, then this one → still a real conflict on that key only",
    last(c.w).result === "CONFLICT" && JSON.stringify(last(c.w).conflicts) === JSON.stringify(["project.logline"]) && c.srv.project.logline === "B's", last(c.w));
  const d = await lostResponseCase({ changeAgain: true, reached: false });
  ok("8b a request that never reached the server, then a new edit → saves", last(d.w).result === "ok" && d.srv.project.logline === "abc", d.w.saves);
  const e = await lostResponseCase({ changeAgain: true, lose: 2 });
  ok("8b two lost responses in a row, then a third edit → saves, no false conflict",
    e.w.saves.filter(s => s.result === "fail").length === 2 && last(e.w).result === "ok" && e.srv.project.logline === "abcd" && e.w.dialogs.length === 0, e.w.saves);
  // the memory holds only THIS window's changes: a collaborator's key merged into the lost
  // write must not later look like ours (or the stale local copy would revert it)
  {
    const created = await sandbox.cloudCreateProject("Pine Soot", { ...emptyDoc(), project: { title: "Pine Soot", logline: "a",
      setting: { period: "1890s", location: "Edinburgh rooftops" } } }, {});
    const A = makeWindow(created.id), B = makeWindow(created.id); await A.load(); await B.load();
    B.state.project = { ...B.state.project, setting: { ...B.state.project.setting, location: "Leith" } }; await B.save("B setting");
    A.state = { ...A.state, project: { ...A.state.project, logline: "ab" } };
    hooks.loseResponses = 1; await A.save("A logline, response lost (merge carried B's setting)"); hooks.loseResponses = 0;
    A.state = { ...A.state, project: { ...A.state.project, logline: "abc" } };   // A still shows the old setting
    await A.save("A retries");
    const p = (await serverDoc(created.id)).project;
    ok("8b a lost write that carried a collaborator's key never makes it look like ours (their value survives the retry)",
      last(A).result === "ok" && p.setting.location === "Leith" && p.logline === "abc" && A.state.project.setting.location === "Leith", { r: last(A), p });
  }
  // sensitivity: without the memory, the same sequence is the reported false conflict (R2b)
  vm.runInContext("this.__rememberUnacked=_seriesRememberUnacked;_seriesRememberUnacked=function(){};", sandbox);
  let f;
  try { f = await lostResponseCase({ changeAgain: true }); } finally { vm.runInContext("_seriesRememberUnacked=this.__rememberUnacked;", sandbox); }
  ok("8b sensitivity: without the unacknowledged-write memory the retry raises the false single-window conflict",
    last(f.w).result === "CONFLICT" && last(f.w).conflicts.includes("project.logline"), last(f.w));
}

/* ── 8c. a request that never settles cannot leave SAVING stuck ───────────── */
{
  const race = (p, ms = 3000) => Promise.race([p.then(v => ({ v })), new Promise(r => setTimeout(() => r("HUNG"), ms))]);
  const w0 = await adaptationTimeline();
  const w = makeWindow(w0.id); await w.load();
  sandbox.__TURN_CLOUD_TIMEOUT_MS = 25;
  try {
    for (const where of ["select", "update"]) {
      hooks.hang = where;
      w.state.project = { ...w.state.project, premise: "typed while the " + where + " hung" };
      const out = await race(w.save("save whose " + where + " hangs"));
      hooks.hang = null;
      ok("8c a hung " + where + " settles as a plain failure (chip Retrying, not SAVING)", out !== "HUNG" && last(w).result === "fail" && w.saveState === "retrying", { out, r: last(w), chip: w.saveState });
      if (out === "HUNG") break;   // the queue is blocked for good; later checks would wait forever
      await w.drain();
      ok("8c after a hung " + where + " the retry saves the edit", w.saveState === "saved" && (await serverDoc(w0.id)).project.premise === "typed while the " + where + " hung", { chip: w.saveState });
    }
    const show = await sandbox.cloudCreateProject("Hang Show", { isShow: true, _rev: 1, bible: { characters: [], locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } } }, {});
    hooks.hang = "update";
    const b = await race(sandbox.cloudSaveBibleSections(show.id, { lookbookNote: "n" }, { episodeId: "ep1", baseline: { lookbookNote: "" } }));
    const p = await race(sandbox.cloudPatchDoc(show.id, d => { d.cover = "x"; }));
    hooks.hang = null;
    ok("8c a hung Show Bible save and a hung cloudPatchDoc settle as failures", b !== "HUNG" && b.v.ok === false && p !== "HUNG" && p.v.ok === false, { b, p });
  } finally { hooks.hang = null; delete sandbox.__TURN_CLOUD_TIMEOUT_MS; }
}

/* ── 9. Show Bible merges: server order vs client order ─────────────────── */
{
  const look = () => ({ wardrobe: "wool coat", age: "30s", accent: "Scots" });   // alphabetical ≠ jsonb ≠ build order
  const bible = {
    characters: [{ id: "c1", name: "Ada", look: look(), episodeScenes: { ep1: ["s1"] }, scenes: ["s1"] },
      { id: "c2", name: "Bram", look: { wardrobe: "apron", age: "60s", accent: "Leith" } }],
    locations: [{ id: "l1", name: "Rooftops", palette: { primary: "soot", accent: "ember", highlights: "frost" } }],
    props: [], lookbook: [{ id: "lb1", caption: "Soot light", url: "https://x.test/1.png", tags: ["dusk"] }], lookbookNote: "",
    trash: { characters: [], locations: [], props: [] },
  };
  const show = await sandbox.cloudCreateProject("Pine Soot (Show)", { isShow: true, bible, _rev: 1 }, {});
  const loaded = await serverDoc(show.id);
  sandbox.cloudNoteDocRev(show.id, loaded);
  const baseline = JSON.parse(stableJson(loaded.bible));   // bibleSavedRef = stableJson(server bible)
  // this Episode rebuilds entities in client order, identical data, plus one real edit each
  const chars = [
    { look: look(), name: "Ada Grey", id: "c1", scenes: ["s1"], episodeScenes: { ep1: ["s1"] } },
    { look: { accent: "Leith", wardrobe: "apron", age: "60s" }, id: "c2", name: "Bram" },
  ];
  const locs = [{ palette: { highlights: "frost", accent: "ember", primary: "soot" }, id: "l1", name: "Rooftops at dusk" }];
  const lookbook = [{ url: "https://x.test/1.png", tags: ["dusk"], id: "lb1", caption: "Soot light" }, { id: "lb2", caption: "Ember", url: "https://x.test/2.png", tags: [] }];
  const r = await sandbox.cloudSaveBibleSections(show.id, { characters: chars, locations: locs, lookbook }, { episodeId: "ep1", baseline });
  ok("9 Show Bible department/entity/value merges: client-order entities are not a false conflict", r.ok === true, r);
  const b = (await serverDoc(show.id)).bible;
  ok("9 Show Bible real edits land", b.characters.find(c => c.id === "c1").name === "Ada Grey" && b.locations[0].name === "Rooftops at dusk" && b.lookbook.length === 2, b);
  // sensitivity: the legacy comparator would have raised the false conflicts
  sandbox._seriesJsonSame = legacyJsonSame;
  let legacy;
  try {
    const now = await serverDoc(show.id);
    sandbox.cloudNoteDocRev(show.id, now);
    const base2 = JSON.parse(stableJson(now.bible));
    legacy = await sandbox.cloudSaveBibleSections(show.id,
      { characters: [{ look: look(), name: "Ada Grey 2", id: "c1", scenes: ["s1"], episodeScenes: { ep1: ["s1"] } }, { look: { accent: "Leith", wardrobe: "apron", age: "60s" }, id: "c2", name: "Bram" }] },
      { episodeId: "ep1", baseline: base2 });
  } finally { sandbox._seriesJsonSame = realJsonSame; }
  ok("9 sensitivity: the legacy comparator raises a false entity conflict here", legacy && legacy.conflict === true && legacy.conflicts.some(c => /^c1\.look$|^c2\.look$/.test(c)), legacy);
  // a genuine same-field edit from another Episode still conflicts
  const now = await serverDoc(show.id);
  const base3 = JSON.parse(stableJson(now.bible));
  const other = await sandbox.cloudSaveBibleSections(show.id,
    { characters: now.bible.characters.map(c => c.id === "c1" ? { ...c, name: "Ada Black" } : c) }, { episodeId: "ep2", baseline: base3 });
  ok("9 another Episode's same-field edit saves first", other.ok === true, other);
  const mine = await sandbox.cloudSaveBibleSections(show.id,
    { characters: now.bible.characters.map(c => c.id === "c1" ? { look: look(), name: "Ada White", id: "c1", scenes: c.scenes, episodeScenes: c.episodeScenes } : c) },
    { episodeId: "ep1", baseline: base3 });
  ok("9 a genuine same-field Bible edit still conflicts, naming only that field", mine.conflict === true && JSON.stringify(mine.conflicts) === JSON.stringify(["c1.name"]), mine);
  ok("9 the Bible conflict wrote nothing", (await serverDoc(show.id)).bible.characters.find(c => c.id === "c1").name === "Ada Black");
}

/* ── 9b. Show Bible deletes, restores and tombstones through real jsonb order ─
   With the order-sensitive comparator these branches never ran in production
   (every entity read "(delete conflicted)"). Now they do, so pin them. */
{
  const character = (id, name, extra = {}) => ({ id, name, role: "Support", color: "#444", look: { wardrobe: "apron", age: "60s" }, ...extra });
  const mk = async (label, trashChars = []) => {
    const bible = { characters: [character("c1", "Ada"), character("c2", "Bram")], locations: [], props: [], lookbook: [], lookbookNote: "",
      trash: { characters: trashChars, locations: [], props: [] } };
    const show = await sandbox.cloudCreateProject(label, { isShow: true, bible, _rev: 1 }, {});
    const loaded = await serverDoc(show.id);
    sandbox.cloudNoteDocRev(show.id, loaded);
    return { id: show.id, loaded, baseline: JSON.parse(stableJson(loaded.bible)) };
  };
  const clientOrder = c => { const { look, ...rest } = c; return { look: { age: look.age, wardrobe: look.wardrobe }, ...Object.fromEntries(Object.entries(rest).reverse()) }; };
  const ids = async id => (await serverDoc(id)).bible.characters.map(c => c.id).join(",");
  // D1 local delete of an untouched entity lands (and the legacy comparator refused it)
  {
    const s = await mk("D1");
    const incoming = s.loaded.bible.characters.filter(c => c.id !== "c2").map(clientOrder);
    sandbox._seriesJsonSame = legacyJsonSame;
    let legacy; try { legacy = await sandbox.cloudSaveBibleSections(s.id, { characters: incoming }, { episodeId: "ep1", baseline: s.baseline }); } finally { sandbox._seriesJsonSame = realJsonSame; }
    ok("9b sensitivity: the legacy comparator reported a plain delete as '(delete conflicted)'", legacy.conflict === true && legacy.conflicts.includes("c2 (delete conflicted)"), legacy);
    const r = await sandbox.cloudSaveBibleSections(s.id, { characters: incoming }, { episodeId: "ep1", baseline: s.baseline });
    ok("9b D1 a local delete of an untouched character lands", r.ok === true && await ids(s.id) === "c1", { r, ids: await ids(s.id) });
  }
  // D2 local delete while another Episode edited that character → conflict, nothing written
  {
    const s = await mk("D2");
    const now = await serverDoc(s.id);
    await sandbox.cloudSaveBibleSections(s.id, { characters: now.bible.characters.map(c => c.id === "c2" ? { ...c, name: "Bram II" } : c) }, { episodeId: "ep2", baseline: s.baseline });
    const r = await sandbox.cloudSaveBibleSections(s.id, { characters: s.loaded.bible.characters.filter(c => c.id !== "c2").map(clientOrder) }, { episodeId: "ep1", baseline: s.baseline });
    ok("9b D2 deleting a character another Episode just edited conflicts and keeps their edit",
      r.conflict === true && JSON.stringify(r.conflicts) === JSON.stringify(["c2 (delete conflicted)"]) && (await serverDoc(s.id)).bible.characters.find(c => c.id === "c2").name === "Bram II", r);
  }
  // D3 deleted remotely, local copy untouched (reordered) → stays deleted, no conflict
  {
    const s = await mk("D3");
    const now = await serverDoc(s.id);
    await sandbox.cloudSaveBibleSections(s.id, { characters: now.bible.characters.filter(c => c.id !== "c2") }, { episodeId: "ep2", baseline: s.baseline });
    const r = await sandbox.cloudSaveBibleSections(s.id, { characters: s.loaded.bible.characters.map(clientOrder) }, { episodeId: "ep1", baseline: s.baseline });
    ok("9b D3 a remote delete is not resurrected by an untouched, reordered local copy", r.ok === true && await ids(s.id) === "c1", { r, ids: await ids(s.id) });
  }
  // D4 deleted remotely, local edited → conflict
  {
    const s = await mk("D4");
    const now = await serverDoc(s.id);
    await sandbox.cloudSaveBibleSections(s.id, { characters: now.bible.characters.filter(c => c.id !== "c2") }, { episodeId: "ep2", baseline: s.baseline });
    const r = await sandbox.cloudSaveBibleSections(s.id, { characters: s.loaded.bible.characters.map(c => c.id === "c2" ? clientOrder({ ...c, name: "Bram edited" }) : clientOrder(c)) }, { episodeId: "ep1", baseline: s.baseline });
    ok("9b D4 editing a character another Episode deleted conflicts ('deleted remotely')", r.conflict === true && JSON.stringify(r.conflicts) === JSON.stringify(["c2 (deleted remotely)"]), r);
  }
  // T1 delete into the shared restore bin (tombstone), client order
  {
    const s = await mk("T1");
    const c2 = s.loaded.bible.characters.find(c => c.id === "c2");
    const r = await sandbox.cloudSaveBibleSections(s.id, {
      characters: s.loaded.bible.characters.filter(c => c.id !== "c2").map(clientOrder),
      trash: { props: [], characters: [{ deletedAt: 5, ...clientOrder(c2) }], locations: [] },
    }, { episodeId: "ep1", baseline: s.baseline });
    const b = (await serverDoc(s.id)).bible;
    ok("9b T1 delete-to-bin lands: gone from the cast, present in Recently deleted", r.ok === true && b.characters.map(c => c.id).join(",") === "c1" && b.trash.characters.map(c => c.id).join(",") === "c2", { r, b });
  }
  // T2 restore from the bin, and T3 restore vs a remote edit of the binned entry
  {
    const binned = { ...character("c3", "Nell"), deletedAt: 7 };
    const s = await mk("T2", [binned]);
    const entry = s.loaded.bible.trash.characters[0];
    const { deletedAt, ...restored } = entry;
    const r = await sandbox.cloudSaveBibleSections(s.id, {
      characters: [...s.loaded.bible.characters.map(clientOrder), clientOrder(restored)],
      trash: { characters: [], locations: [], props: [] },
    }, { episodeId: "ep1", baseline: s.baseline });
    const b = (await serverDoc(s.id)).bible;
    ok("9b T2 restore from the bin lands (removed from trash, back in the cast)", r.ok === true && b.characters.some(c => c.id === "c3") && b.trash.characters.length === 0, { r, b });
    const t = await mk("T3", [binned]);
    const now = await serverDoc(t.id);
    await sandbox.cloudSaveBibleSections(t.id, { trash: { ...now.bible.trash, characters: [{ ...now.bible.trash.characters[0], name: "Nell (renamed elsewhere)" }] } }, { episodeId: "ep2", baseline: t.baseline });
    const r3 = await sandbox.cloudSaveBibleSections(t.id, {
      characters: [...t.loaded.bible.characters.map(clientOrder), clientOrder(restored)],
      trash: { characters: [], locations: [], props: [] },
    }, { episodeId: "ep1", baseline: t.baseline });
    ok("9b T3 restoring an entry another Episode changed in the bin conflicts and writes nothing",
      r3.conflict === true && JSON.stringify(r3.conflicts) === JSON.stringify(["trash.characters.c3 (delete conflicted)"])
      && !(await serverDoc(t.id)).bible.characters.some(c => c.id === "c3"), r3);
  }
  // replay rebase (bibleRebaseRef / recovery journal) with jsonb order
  {
    const jsonb = async v => JSON.parse((await db.query("select $1::jsonb::text as t", [JSON.stringify(v)])).rows[0].t);
    const look = { wardrobe: "wool", age: "30s", accent: "Scots" };   // client order ≠ alphabetical ≠ jsonb (age, accent, wardrobe)
    const latest = await jsonb({ characters: [{ id: "c1", name: "Ada", look }, { id: "c9", name: "Nell", look: { age: "9", wardrobe: "rags" } }],
      locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } });   // server: collaborator added c9
    const checkpoint = JSON.parse(stableJson({ ...latest, characters: [latest.characters[0]] }));            // this window's confirmed checkpoint
    const current = { ...latest, characters: [{ look: { ...look }, name: "Ada 3", id: "c1" }] };             // newer local edit, never saw c9
    const rebased = sandbox.seriesRebaseBibleAfterReplay(latest, current, checkpoint, "ep1");
    ok("9b replay rebase in mixed key order keeps the collaborator's entity and the newer local edit",
      rebased.ok === true && rebased.bible.characters.map(c => c.id).join(",") === "c1,c9" && rebased.bible.characters[0].name === "Ada 3", rebased);
    sandbox._seriesJsonSame = legacyJsonSame;
    let legacy; try { legacy = sandbox.seriesRebaseBibleAfterReplay(latest, current, checkpoint, "ep1"); } finally { sandbox._seriesJsonSame = realJsonSame; }
    ok("9b sensitivity: the legacy comparator made the same rebase a false conflict", legacy.ok === false && legacy.conflicts.includes("c1.look"), legacy);
  }
}

/* ── 9c. paired-save recovery journal replay (real _replaySeriesPairOutbox) ── */
{
  const makeReplay = rows => {
    const cleared = [];
    const box = { Object, String, Promise, cloudSaveSections: sandbox.cloudSaveSections, cloudSaveBibleSections: sandbox.cloudSaveBibleSections,
      _seriesOutboxRows: () => rows, _seriesOutboxClear: k => cleared.push(k) };
    vm.createContext(box);
    vm.runInContext(replaySrc + "\nthis.replay=_replaySeriesPairOutbox;", box);
    return { replay: box.replay, cleared };
  };
  const setup = async label => {
    const p0 = { title: "Ep 1", logline: "old", setting: { period: "1890s", location: "Leith", duration: "winter" } };
    const s0 = [{ id: "s1", title: "Open", beats: { turn: "+/-", n: 1 } }];
    const ep = await sandbox.cloudCreateProject(label + " ep", { ...emptyDoc(), project: p0, scenes: s0, showId: "show", episodeNo: 1 }, {});
    const c0 = [{ id: "c1", name: "Ada", look: { age: "30s", wardrobe: "wool" } }, { id: "c2", name: "Bram", look: { age: "60s", wardrobe: "apron" } }];
    const show = await sandbox.cloudCreateProject(label + " show", { isShow: true, _rev: 1, bible: { characters: c0, locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } } }, {});
    const epDoc = await serverDoc(ep.id), showDoc = await serverDoc(show.id);
    const entry = {   // as performSave journals it: client-order patches, stableJson baselines
      episodePatch: { project: { setting: { duration: "winter", location: "Leith", period: "1890s" }, logline: "new", title: "Ep 1" },
        scenes: [{ beats: { n: 1, turn: "+/-" }, title: "Open (revised)", id: "s1" }] },
      episodeBaseline: { project: JSON.parse(stableJson(epDoc.project)), scenes: JSON.parse(stableJson(epDoc.scenes)) },
      biblePatch: { characters: [{ look: { wardrobe: "wool", age: "30s" }, name: "Ada Grey", id: "c1" }] },   // c1 edited, c2 deleted
      bibleBaseline: { characters: JSON.parse(stableJson(showDoc.bible.characters)) },
    };
    return { epId: ep.id, showId: show.id, entry, rows: [{ key: "journal-" + label, entry }] };
  };
  const bibleOk = async id => { const b = (await serverDoc(id)).bible; return b.characters.length === 1 && b.characters[0].name === "Ada Grey"; };
  // O1 the Episode half committed before the crash; the Bible half did not
  {
    const s = await setup("O1");
    const first = await sandbox.cloudSaveSections(s.epId, s.entry.episodePatch, { baseline: { project: s.entry.episodeBaseline.project } });
    const { replay, cleared } = makeReplay(s.rows);
    const r = await replay(s.epId, s.showId);
    const ep = await serverDoc(s.epId);
    ok("9c O1 replay after the Episode half committed: identical Episode replay is a no-op, the Bible half (edit + delete) lands, journal cleared",
      first.ok && r.ok === true && r.replayed === true && cleared.includes("journal-O1") && ep.project.logline === "new" && ep.scenes[0].title === "Open (revised)" && await bibleOk(s.showId), { r, cleared });
    const s2 = await setup("O1L");
    await sandbox.cloudSaveSections(s2.epId, s2.entry.episodePatch, { baseline: { project: s2.entry.episodeBaseline.project } });
    const legacy = makeReplay(s2.rows);
    sandbox._seriesJsonSame = legacyJsonSame;
    let lr; try { lr = await legacy.replay(s2.epId, s2.showId); } finally { sandbox._seriesJsonSame = realJsonSame; }
    ok("9c sensitivity: under the legacy comparator that replay stalled as a conflict, keeping the journal forever", lr.ok === false && lr.conflict === true && legacy.cleared.length === 0, lr);
  }
  // O2 nothing committed → both halves apply
  {
    const s = await setup("O2");
    const { replay, cleared } = makeReplay(s.rows);
    const r = await replay(s.epId, s.showId);
    ok("9c O2 replay with nothing committed applies both halves", r.ok === true && cleared.length === 1 && (await serverDoc(s.epId)).scenes[0].title === "Open (revised)" && await bibleOk(s.showId), r);
  }
  // O3 someone changed the same Episode section after the journal → conflict, journal kept
  {
    const s = await setup("O3");
    const w = makeWindow(s.epId); await w.load();
    w.state.scenes = [{ ...w.state.scenes[0], title: "Open (someone else)" }]; await w.save("other window edits scenes");
    const { replay, cleared } = makeReplay(s.rows);
    const r = await replay(s.epId, s.showId);
    ok("9c O3 replay onto a newer same-section edit conflicts, keeps the journal and writes no Bible half",
      r.ok === false && r.conflict === true && cleared.length === 0 && (await serverDoc(s.epId)).scenes[0].title === "Open (someone else)"
      && (await serverDoc(s.showId)).bible.characters.length === 2, r);
  }
}

/* ── R. randomized same-window interleavings (queued/coalesced saves, shuffled
   key order, cloudPatchDoc races, lost responses) never conflict and converge ─ */
{
  const rng = seed => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const shuffleKeys = (o, R) => { if (!o || typeof o !== "object") return o; if (Array.isArray(o)) return o.map(x => shuffleKeys(x, R));
    const ks = Object.keys(o); for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
    const out = {}; ks.forEach(k => { out[k] = shuffleKeys(o[k], R); }); return out; };
  const runSeeds = async (seeds, withLoss) => {
    const bad = [];
    for (const seed of seeds) {
      const R = rng(seed * 7919 + (withLoss ? 17 : 0));
      const created = await sandbox.cloudCreateProject("Untitled film", emptyDoc(), {});
      const w = makeWindow(created.id); await w.load();
      const brief = "A chimney sweep's apprentice finds a letter in the soot.";
      let model = { ...w.state.project, format: "film", framework: "threeact", logline: brief, sourceBrief: brief,
        synopsis: { paras: [{ key: "act1", label: "Act I", text: "Setup." }, { key: "act2", label: "Act II", text: "Pressure." }] } };
      const steps = [];
      steps.push(() => { model = { ...model, title: "Pine Soot", genre: "gothic drama", continuityFacts: undefined, continuityLedger: undefined,
        controllingIdea: { value: "We find belonging", cause: "when we stop hiding what we are", polarity: "ironic" },
        setting: { period: "1890s", duration: "one winter", location: "Edinburgh rooftops", conflict: "institutional" },
        contract: { outer: "punitive", inner: "education", dominant: "inner", suggested: true } };
        w.state = { ...w.state, scenes: scenes16, characters: cast5 }; });
      steps.push(() => { w.state = { ...w.state, characters: cast5.map(c => ({ ...c, conscious: "want" })) }; });
      for (let i = 0; i < 16; i += 2) steps.push(() => { const d = { ...w.state.drafts }; d["s" + (i + 1)] = { blocks: [{ t: "action", x: "Soot." }] }; w.state = { ...w.state, drafts: d }; });
      steps.push(() => { const facts = {}; for (let k = 1; k <= 15; k++) facts["f" + k] = { label: "Fact " + k, detail: "d" + k, kind: "object" };
        model = { ...model, continuityFacts: facts, continuityLedger: { sig: "abc", at: "2026-09-27T00:25:00Z", built: 15 } };
        const cmap = {}; scenes16.forEach(s => { cmap[s.id] = { establishes: ["f1"], references: [] }; }); w.state = { ...w.state, continuityMap: cmap }; });
      steps.push(() => { w.state = { ...w.state, characters: w.state.characters.map(c => ({ ...c, arc: "revised" })) }; });
      steps.push(() => { w.state = { ...w.state, characters: w.state.characters.map(c => ({ ...c, look: "soot" })) }; });
      let streak = 0;
      hooks.loseChance = withLoss ? () => { if (streak >= 2) { streak = 0; return false; } const l = R() < 0.12; streak = l ? streak + 1 : 0; return l; } : null;
      const pending = [];
      try {
        for (let s = 0; s < steps.length; s++) {
          steps[s]();
          if (R() < 0.3) model = { ...model, logline: "logline v" + s };                                  // user typing / agent tweak
          if (R() < 0.2) model = { ...model, setting: { ...model.setting, duration: "winter " + s } };
          w.state = { ...w.state, project: shuffleKeys(JSON.parse(JSON.stringify(model)), R) };         // ctx.sync: fresh objects, any key order
          if (R() < 0.25) hooks.beforeUpdate = async () => { await sandbox.cloudPatchDoc(created.id, d => { d.cover = "c" + s; }); };
          // debounce: sometimes the next change coalesces, sometimes a save launches and we don't wait for it
          if (R() < 0.6 || s === steps.length - 1) { const p = w.enqueue("step " + s); if (R() < 0.5) await p; else pending.push(p); }
        }
        await Promise.all(pending);
        hooks.loseChance = null;
        await w.drain();
      } finally { hooks.beforeUpdate = null; hooks.loseChance = null; }
      const srv = await serverDoc(created.id);
      const conflicts = w.saves.filter(x => x.result === "CONFLICT");
      const projOk = stableJson(srv.project) === stableJson(w.state.project);
      if (conflicts.length || w.dialogs.length || w.saveState !== "saved" || !projOk || Object.keys(srv.project.continuityFacts || {}).length !== 15)
        bad.push({ seed, conflicts: conflicts.slice(0, 2), dialogs: w.dialogs.length, chip: w.saveState, projOk });
    }
    return bad;
  };
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const plain = await runSeeds(seeds, false);
  ok("R 40 randomized same-window Adaptation runs never conflict and converge (server project = window project)", plain.length === 0, plain.slice(0, 3));
  const lossy = await runSeeds(seeds, true);
  ok("R the same 40 runs with ~12% lost UPDATE responses (committed, unacknowledged) never conflict and converge", lossy.length === 0, lossy.slice(0, 3));
  sandbox._seriesJsonSame = legacyJsonSame;
  let legacy; try { legacy = await runSeeds([1, 2, 3], false); } finally { sandbox._seriesJsonSame = realJsonSame; }
  ok("R sensitivity: the legacy comparator fails these runs", legacy.length === 3, legacy.length);
}

/* ── K. the conflict dialog's keyboard behaviour (real app/confirm.jsx) ─────── */
{
  const src = read("app/confirm.jsx");
  const mount = () => {
    const listeners = new Set(); const slots = []; let cursor = 0, fx = [], tree = null;
    const win = { confirm: () => { throw new Error("fell back to window.confirm"); },
      addEventListener: (t, fn) => { if (t === "keydown") listeners.add(fn); }, removeEventListener: (t, fn) => { if (t === "keydown") listeners.delete(fn); } };
    const React = {
      useState(init) { const i = cursor++; if (!slots[i]) slots[i] = { v: init }; const s = slots[i]; return [s.v, v => { s.v = typeof v === "function" ? v(s.v) : v; render(); }]; },
      useCallback(fn) { const i = cursor++; if (!slots[i]) slots[i] = { fn }; return slots[i].fn; },
      useEffect(fn, deps) { const i = cursor++; const s = slots[i];
        if (s && deps && s.deps && deps.every((d, j) => d === s.deps[j])) return;
        fx.push(() => { if (s && s.cleanup) s.cleanup(); const c = fn(); slots[i] = { deps, cleanup: typeof c === "function" ? c : null }; }); },
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    };
    const box = { React, window: win, Promise, Array, String };
    vm.createContext(box); vm.runInContext(src, box, { filename: "app/confirm.jsx" });
    function render() { cursor = 0; fx = []; tree = win.ConfirmHost(); const run = fx; fx = []; run.forEach(f => f()); }
    render();
    const buttons = () => { const out = []; const walk = n => { if (!n || typeof n !== "object") return; if (n.type === "button") out.push(n); (n.children || []).forEach(walk); }; walk(tree); return out; };
    const role = r => buttons().find(b => b.props["data-appconfirm-role"] === r);
    const key = (k, target) => { const e = { key: k, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; [...listeners].forEach(fn => fn(e)); return e; };
    const el = r => ({ getAttribute: a => a === "data-appconfirm-role" ? r : null });
    return { confirm: win.appConfirm, role, key, el, open: () => !!tree };
  };
  const opts = { title: "Cloud version changed", body: "b", confirmLabel: "Load cloud version", cancelLabel: "Keep my edits", danger: true, safeDefault: true };
  const h = mount();
  let p = h.confirm(opts);
  ok("K safeDefault: Keep my edits has focus on open, Load cloud version does not", h.role("cancel").props.autoFocus === true && h.role("confirm").props.autoFocus === false);
  const e = h.key("Enter", { getAttribute: () => null });   // a stray Enter from the editor behind the dialog
  ok("K safeDefault: a stray Enter keeps the local edits (resolves false) and is swallowed", (await p) === false && e.defaultPrevented && !h.open());
  p = h.confirm(opts); h.key("Enter", h.el("cancel"));
  ok("K safeDefault: Enter on the focused Keep button keeps", (await p) === false);
  p = h.confirm(opts); h.key("Enter", h.el("confirm"));
  ok("K safeDefault: Enter only loads the cloud version when that button was deliberately focused", (await p) === true);
  p = h.confirm(opts); h.key("Escape", h.el("confirm"));
  ok("K Escape always cancels", (await p) === false);
  p = h.confirm({ ...opts, safeDefault: undefined });
  ok("K ordinary dialogs keep their behaviour: confirm focused", h.role("confirm").props.autoFocus === true && h.role("cancel").props.autoFocus === false);
  h.key("Enter", { getAttribute: () => null });
  ok("K ordinary dialogs keep their behaviour: Enter confirms", (await p) === true);
}

/* ── every file this fix touches still parses as the browser's Babel sees it ─ */
{
  const babel = await import("@babel/core");
  const presetReact = (await import("@babel/preset-react")).default;   // resolved next to this file, not the cwd
  for (const f of ["app/ai.jsx", "app/app.jsx", "app/cloud.jsx", "app/confirm.jsx"]) {
    let error = null;
    try { babel.parseSync(read(f), { filename: ROOT + f, presets: [presetReact], babelrc: false, configFile: false }); } catch (e) { error = String(e.message).split("\n")[0]; }
    ok("parse: " + f + " is valid JSX/JS", !error, error);
  }
}

/* ── MUSE product knowledge matches the behaviour ──────────────────────── */
{
  const ai = read("app/ai.jsx");
  const line = ai.split("\n").find(l => /CONFLICT CHOICE/.test(l)) || "";
  ok("MUSE: the pre-existing CONFLICT CHOICE text is kept word for word",
    line.includes("if another window wins an overlapping save, Kinolot keeps this window's local edit visible, marks it Not saved, and asks before loading the cloud version. Keep my edits cancels replacement; Load cloud version is the explicit destructive choice. Kinolot never auto-reloads over local work."));
  ok("MUSE: no absolute 'never reported as another window' promise", !/never reported as another window/.test(line) && /normally not treated as another window's change/.test(line), line.slice(0, 200));
  ok("MUSE: describes plain-word labels, the safe default, declined saves and merged-project adoption",
    /Project settings: Logline/.test(line) && /Keep my edits focused/.test(line) && /declines a save while no newer cloud version exists/.test(line)
    && /does not blame another window or offer Load cloud version/.test(line) && /also appear in this window/.test(line));
}

/* ── source contracts this mirror depends on ─────────────────────────────── */
{
  const saveBlock = between(app, "const _sectionSaveOpts=(sections,fullRecoveryBaseline)=>{", "const _episodeSectionSaveOpts");
  ok("contract: normal saves send a baseline only for project", /if\(k!=="project"&&!fullRecoveryBaseline\) return;/.test(saveBlock));
  ok("contract: the baseline is JSON.parse(lastSentRef) (stableJson, alphabetical)", /baseline\[k\]=JSON\.parse\(lastSentRef\.current\[k\]\)/.test(saveBlock));
  ok("contract: _rememberSent writes stableJson", /lastSentRef\.current\[k\]=stableJson\(_sectionsNow\[k\]\)/.test(app));
  ok("contract: both save branches hand the merged project to _adoptTheirs, newest generation only",
    // (2026-10-09, Stage editor review) the per-shot merged shots ride along
    /if\(_saveGenerationLatest\(ctx\)\) _adoptTheirs\(result\.doc,_mineKeys,result\.project,result\.shots\);/.test(app)
    && /if\(_saveGenerationLatest\(ctx\) && ep\) _adoptTheirs\(ep\.r\.doc,_mineKeys,ep\.r\.project,ep\.r\.shots\);/.test(app));
  ok("contract: conflict marks Not saved before the one-dialog guard",
    conflictSrc.indexOf('setSaveState("failed")') >= 0 && conflictSrc.indexOf('setSaveState("failed")') < conflictSrc.indexOf("if(_conflictBusy.current) return;"));
  ok("contract: stale generations never reach the conflict dialog",
    saveResultSrc.indexOf("_saveGenerationLatest(ctx)") >= 0 && saveResultSrc.indexOf("_saveGenerationLatest(ctx)") < saveResultSrc.indexOf("_docConflictCheck(r)"));
  const cloud = read("app/cloud.jsx");
  const fn = between(cloud, "function _seriesJsonSame(a,b){", "function _seriesOwnSceneSlice");
  ok("contract: _seriesJsonSame no longer compares plain JSON.stringify output", !/JSON\.stringify\(a\)\s*===\s*JSON\.stringify\(b\)/.test(fn));
  for (const [name, end] of [["async function cloudSaveSections", "window.cloudSaveSections"], ["async function cloudSaveBibleSections", "window.cloudSaveBibleSections"], ["async function cloudPatchDoc", "window.cloudPatchDoc"]]) {
    const block = between(cloud, name, end);
    ok("contract: " + name.split(" ").pop() + " bounds its read AND its write with the save deadline", (block.match(/_cloudQuery\([\s\S]*?,"save"\)/g) || []).length === 2 && !/await sb\.from/.test(block));
  }
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

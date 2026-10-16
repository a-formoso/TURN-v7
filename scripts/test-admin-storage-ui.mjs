#!/usr/bin/env node
/* test-admin-storage-ui.mjs — Admin Storage page, UI half (spec §10.2).
   Owner: platform admin · 2026-09-27. Offline: no network, no Supabase, no
   browser. app/admin-storage.jsx and app/auth-ui.jsx are transpiled exactly as
   scripts/build-dist.mjs does (preset-react classic + block scoping; no dist/
   needed) and run in a vm with a small hooks runtime (state, effects, refs,
   memo, keyed paths), so the REAL modal is driven end to end against a fake
   sb.functions.invoke that answers like supabase/functions/admin-storage.
   2026-09-27 review: sign-out closes the page with no click, Resume asks
   first, History pages and hides unrun reviews, selection / footer / × /
   50-cap rules, keyboard (Enter stays on the control, sheet focus, Tab trap),
   network vs not-deployed copy, a mid-run project_live with the server's
   counts, labels, and phone / light-theme CSS.
   2026-09-28: Clear old temp files — the "Old temp files" tile, the "Cleanup"
   tab (it was "Cleanup queue") and when it shows, every reason the button is
   off, the confirm copy (more remain, nothing planned), the run loop (partial
   then done, stalled), the result line, an older server, the error copy, the
   History labels and Resume of a temp run.
   2026-09-28 review: a stopped clear offers Try again / Retry failed on the
   same run (no new review), the confirm's expiry countdown and expired state,
   temp_interrupted copy, no made-up counts when a temp Resume got no answer,
   the Accounts tab's temp row pointing at Cleanup, and the tab strip that
   never shrinks on phones. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;
const ADMIN_SRC = read("app/admin-storage.jsx");
// ADMIN_STORAGE_UI_DIST=1 runs the same checks over the minified production build
// (node scripts/build-dist.mjs first); the default transpiles the source directly.
const DIST = !!process.env.ADMIN_STORAGE_UI_DIST;
const ADMIN_JS = DIST ? read("dist/app/admin-storage.js") : transform(ADMIN_SRC, "admin-storage.jsx");
const ADMIN_CODE = ADMIN_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // comments stripped
const AUTH_JS = DIST ? read("dist/app/auth-ui.js") : transform(read("app/auth-ui.jsx"), "auth-ui.jsx");
// TURN.html loads the storage-key parser before cloud.jsx (and so before this page)
const KEYS_JS = DIST ? read("dist/app/storage-keys.js") : read("app/storage-keys.js");

let checks = 0;
const plain = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const same = (a, b, m) => assert.deepEqual(plain(a), plain(b), ...(m === undefined ? [] : [m]));   // vm-realm arrays/objects compare by value
async function test(name, fn){ await fn(); checks++; console.log("PASS", name); }
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/* ── a tiny React: enough hooks to run the real components ─────────────── */
function createRuntime(){
  const FRAGMENT = "fragment";
  const stores = new Map();
  const roots = new Set();
  let current = null, visited = new Set(), pending = [], scheduled = false, renders = 0;
  const rt = { focused: null };
  function createElement(type, props, ...children){
    const p = Object.assign({}, props || {});
    const key = p.key; delete p.key;
    const kids = children.flat(Infinity);
    if (kids.length) p.children = kids;
    return { $$el: true, type, props: p, key: key == null ? null : String(key) };
  }
  const childPath = (path, c, i) => path + "." + (c && c.$$el && c.key != null ? "k" + c.key : i);
  function renderNode(el, path, out){
    if (el === null || el === undefined || el === false || el === true || el === "") return;
    if (Array.isArray(el)) { el.forEach((c, i) => renderNode(c, childPath(path, c, i), out)); return; }
    if (typeof el === "string" || typeof el === "number") { out.push(String(el)); return; }
    if (!el.$$el) throw new Error("not a renderable child: " + String(el).slice(0, 80));
    const { type, props } = el;
    if (typeof type === "function") {
      const id = path + ":" + (type.name || "anon");
      visited.add(id);
      let store = stores.get(id);
      if (!store) { store = { hooks: [] }; stores.set(id, store); }
      const prev = current; current = { store, i: 0 };
      let res;
      try { res = type(props); } finally { current = prev; }
      renderNode(res, id, out);
      return;
    }
    if (type === FRAGMENT) { renderNode(props.children || [], path + "/f", out); return; }
    const node = { type, props: Object.assign({}, props), children: [] };
    delete node.props.children;
    if (props.ref && typeof props.ref === "object") { node.focus = () => { rt.focused = node; }; props.ref.current = node; }
    (props.children || []).forEach((c, i) => renderNode(c, childPath(path + "/" + type, c, i), node.children));
    out.push(node);
  }
  function flush(){
    if (++renders > 5000) throw new Error("render loop");
    visited = new Set();
    let i = 0;
    for (const r of roots) { const out = []; renderNode(r.element, "root" + (i++), out); r.tree = { type: "root", props: {}, children: out }; }
    for (const [id, store] of stores) {
      if (visited.has(id)) continue;
      for (const cell of store.hooks) if (cell && typeof cell.cleanup === "function") { try { cell.cleanup(); } catch {} }
      stores.delete(id);
    }
    const effects = pending; pending = [];
    for (const { cell, fn } of effects) {
      if (typeof cell.cleanup === "function") cell.cleanup();
      const c = fn();
      cell.cleanup = typeof c === "function" ? c : null;
    }
  }
  function schedule(){
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; flush(); });
  }
  function hook(){
    if (!current) throw new Error("hook called outside a component");
    return [current.store.hooks, current.i++];
  }
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, j) => !Object.is(x, b[j]));
  const React = {
    createElement, Fragment: FRAGMENT,
    useState(init){
      const [hooks, i] = hook();
      if (!hooks[i]) {
        const cell = { v: typeof init === "function" ? init() : init };
        cell.set = (nv) => { const next = typeof nv === "function" ? nv(cell.v) : nv; if (Object.is(next, cell.v)) return; cell.v = next; schedule(); };
        hooks[i] = cell;
      }
      return [hooks[i].v, hooks[i].set];
    },
    useEffect(fn, deps){
      const [hooks, i] = hook();
      if (!hooks[i]) { hooks[i] = { deps, cleanup: null }; pending.push({ cell: hooks[i], fn }); return; }
      if (changed(hooks[i].deps, deps)) { hooks[i].deps = deps; pending.push({ cell: hooks[i], fn }); }
    },
    useRef(init){ const [hooks, i] = hook(); if (!hooks[i]) hooks[i] = { current: init === undefined ? null : init }; return hooks[i]; },
    useMemo(fn, deps){
      const [hooks, i] = hook();
      if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { v: fn(), deps };
      return hooks[i].v;
    },
    useCallback(fn, deps){ return React.useMemo(() => fn, deps); },
    useContext(){ return undefined; },
    createContext(){ return { Provider: "provider" }; },
  };
  const ReactDOM = {
    createRoot(el){
      const r = { el, element: null, tree: null };
      return {
        render(element){ r.element = element; roots.add(r); flush(); },
        unmount(){ roots.delete(r); flush(); },
      };
    },
  };
  rt.React = React; rt.ReactDOM = ReactDOM;
  rt.tree = () => { const r = [...roots][0]; return r ? r.tree : null; };
  rt.roots = roots;
  rt.mount = (element) => ReactDOM.createRoot({}).render(element);
  return rt;
}

/* ── tree queries ──────────────────────────────────────────────────────── */
const text = (n) => n == null ? "" : typeof n === "string" ? n : (n.children || []).map(text).join("");
function findAll(n, pred, acc = []){
  if (n && typeof n === "object") { if (n.type && n.type !== "root" && pred(n)) acc.push(n); (n.children || []).forEach((c) => findAll(c, pred, acc)); }
  return acc;
}
const find = (n, pred) => findAll(n, pred)[0] || null;
const hasClass = (n, c) => String(n.props.className || "").split(/\s+/).includes(c);
const byClass = (n, c) => findAll(n, (x) => hasClass(x, c));
const button = (n, re) => find(n, (x) => x.type === "button" && re.test(text(x)));
const evt = (node, extra) => Object.assign({ stopPropagation(){}, preventDefault(){}, target: node, currentTarget: node }, extra || {});
async function click(node){ assert.ok(node, "clickable node exists"); assert.ok(!node.props.disabled, "node is enabled: " + text(node)); node.props.onClick(evt(node)); await settle(); }

/* ── a vm box with the page loaded ─────────────────────────────────────── */
function makeBox(invoke, opts = {}){
  const rt = createRuntime();
  const listeners = {}, timers = [], intervals = new Map(), toasts = [], classes = new Set();
  let nextInterval = 0;
  const body = { children: [], appendChild(el){ this.children.push(el); el.parentNode = this; }, removeChild(el){ this.children = this.children.filter((x) => x !== el); el.parentNode = null; },
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); return !!on; }, contains: (c) => classes.has(c) } };
  const box = {
    console, React: rt.React, ReactDOM: rt.ReactDOM, queueMicrotask,
    Icon: new Proxy({}, { get: () => function IconStub(){ return null; } }),
    document: {
      body,
      createElement: (tag) => ({ tagName: tag, className: "" }),
      addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
      getElementById: () => null,
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { const id = ++nextInterval; intervals.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { intervals.delete(id); },
    appToast: (m, k) => toasts.push([m, k]),
    turnIsAdmin: opts.admin !== false,
  };
  box.window = box;
  if (invoke !== null) box.sbClient = () => Object.assign({ functions: { invoke } }, opts.auth ? { auth: opts.auth } : {});
  vm.createContext(box);
  if (!opts.noKeys) vm.runInContext(KEYS_JS, box);
  vm.runInContext(ADMIN_JS, box);
  const key = async (k) => { for (const fn of listeners.keydown || []) fn({ key: k, preventDefault(){} }); await settle(); };
  const tick = async (ms) => { for (const { fn, ms: every } of [...intervals.values()]) if (every === ms) fn(); await settle(); };
  return { box, rt, timers, intervals, listeners, classes, toasts, key, tick, body, tree: () => rt.tree() };
}

/* ── the fake admin-storage function ───────────────────────────────────── */
const U = (c) => c.repeat(8) + "-" + c.repeat(4) + "-4" + c.repeat(3) + "-8" + c.repeat(3) + "-" + c.repeat(12);
const A = U("a"), B = U("b"), C = U("c"), D = U("d");
const P1 = U("1"), P2 = U("2"), P3 = U("3"), P4 = U("4"), PD1 = U("e"), PD2 = U("f");
const MB = 1024 * 1024, GB = 1024 * MB;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const SETUP = (over = {}, flags = {}) => Object.assign({
  admin: { id: A, email: "admin@infinitestudioai.com" },
  db: { user: "postgres", superuser: true, bypassRls: true, serverVersion: "17.4" },
  seesAll: true,
  setup: Object.assign({ views: 6, missingColumns: [], audit: true, queue: true, intents: true, queueWorker: true, temp_action: true }, flags),
  browseEnabled: true, deleteEnabled: true, drainEnabled: true, tempEnabled: true,
}, over);
const folder = (user_folder, project_folder, project_id, o) => Object.assign({
  user_folder, project_folder, project_id, uploader_id: /^[0-9a-f]{8}-/.test(user_folder) ? user_folder : null,
  uploader_email: null, files: 0, bytes: 0, safe_files: 0, safe_bytes: 0, orphan_deleted: 0, queued: 0, uploading: 0,
  kept_retry: 0, service: 0, unreferenced: 0, referenced: 0, last_upload: iso(86400000), verdict: "in-use",
}, o);
function OVERVIEW(over = {}){
  return Object.assign({
    asOf: new Date().toISOString(),
    setup: SETUP(),
    accounts: [
      { user_id: A, email: "alice@example.test", plan: "director", created_at: iso(9e9), last_sign_in_at: iso(3 * 86400000), film_count: 3, file_count: 16, total_bytes: 3 * GB, deleted_account: false },
      { user_id: B, email: "bob@example.test", plan: null, created_at: iso(9e9), last_sign_in_at: null, film_count: 0, file_count: 2, total_bytes: 20 * MB, deleted_account: false },
      { user_id: C, email: "carol@example.test", plan: "writer", created_at: iso(9e9), last_sign_in_at: iso(3600e3), film_count: 1, file_count: 5, total_bytes: 50 * MB, deleted_account: false },
      { user_id: D, email: "(deleted account)", plan: null, created_at: null, last_sign_in_at: null, film_count: 0, file_count: 4, total_bytes: 400 * MB, deleted_account: true },
    ],
    projects: [
      { project_id: P1, owner_id: A, owner_email: "alice@example.test", title: "Neon Harbor", kind: "film", show_title: null, episode: null, live: true, files: 4, total_bytes: 30 * MB, orphan_files: 0, uploader_emails: "alice@example.test", last_upload: iso(86400000) },
      { project_id: P2, owner_id: A, owner_email: "alice@example.test", title: "Dust Road", kind: "show", show_title: "Dust Road", episode: null, live: true, files: 0, total_bytes: 0, orphan_files: 0, uploader_emails: null, last_upload: null },
      { project_id: P3, owner_id: A, owner_email: "alice@example.test", title: "Dust Road \u2014 Episode 2", kind: "episode", show_title: "Dust Road", episode: 2, live: true, files: 0, total_bytes: 0, orphan_files: 0, uploader_emails: null, last_upload: null },
      { project_id: P4, owner_id: C, owner_email: "carol@example.test", title: "Carol's film", kind: "film", show_title: null, episode: null, live: true, files: 7, total_bytes: 70 * MB, orphan_files: 0, uploader_emails: "bob@example.test, carol@example.test", last_upload: iso(7200e3) },
      { project_id: PD1, owner_id: null, owner_email: null, title: "(deleted project)", kind: null, show_title: null, episode: null, live: false, files: 11, total_bytes: GB + 10 * MB, orphan_files: 9, uploader_emails: "alice@example.test", last_upload: iso(5 * 86400000) },
      { project_id: PD2, owner_id: null, owner_email: null, title: "(deleted project)", kind: null, show_title: null, episode: null, live: false, files: 4, total_bytes: 400 * MB, orphan_files: 4, uploader_emails: null, last_upload: iso(40 * 86400000) },
    ],
    folders: [
      folder(A, P1, P1, { uploader_email: "alice@example.test", files: 3, bytes: 28 * MB, referenced: 3 }),
      folder(A, "studio-previews", P1, { uploader_email: "alice@example.test", files: 1, bytes: 2 * MB, service: 1 }),
      folder(B, P4, P4, { uploader_email: "bob@example.test", files: 2, bytes: 20 * MB, referenced: 2 }),
      folder(C, P4, P4, { uploader_email: "carol@example.test", files: 5, bytes: 50 * MB, referenced: 4, unreferenced: 1, safe_files: 1, safe_bytes: MB, verdict: "some" }),
      folder(A, PD1, PD1, { uploader_email: "alice@example.test", files: 10, bytes: GB, safe_files: 8, safe_bytes: 900 * MB, orphan_deleted: 8, queued: 2, verdict: "some" }),
      folder(A, "studio-previews", PD1, { uploader_email: "alice@example.test", files: 1, bytes: 10 * MB, safe_files: 1, safe_bytes: 10 * MB, service: 1, verdict: "some" }),
      folder(D, PD2, PD2, { uploader_email: null, files: 4, bytes: 400 * MB, safe_files: 4, safe_bytes: 400 * MB, orphan_deleted: 4, verdict: "delete-folder" }),
      folder("_internal", "relay", null, { files: 2, bytes: 1024, service: 2 }),
      folder(A, "stage-tmp", null, { uploader_email: "alice@example.test", files: 3, bytes: 3 * MB, safe_files: 1, safe_bytes: MB, service: 3 }),
    ],
    queue: {
      byReason: [
        { reason: "abandoned_upload", total: 3, ready: 2, next_at: iso(-600e3), oldest: iso(86400000), stuck: 0 },
        { reason: "project_deleted", total: 2, ready: 1, next_at: null, oldest: iso(2 * 86400000), stuck: 1 },
      ],
      stuck: [{ path: A + "/" + PD1 + "/character/c1/1-sheet.png", reason: "project_deleted", project_id: PD1, attempts: 3, last_error: "Storage 503", queued_at: iso(2 * 86400000), project_live: false }],
    },
    // overview.temp (server 2026-09-28): the stage-tmp folder above, 1 of its 3 files older than 24 h
    temp: { files: 3, bytes: 3 * MB, oldFiles: 1, oldBytes: MB, accounts: 1, oldest: iso(3 * 86400000), cutoffHours: 24 },
  }, over);
}
const ok = (data) => ({ data: Object.assign({ ok: true, version: "admin-storage@2026-09-27.1", elapsedMs: 1234 }, data), error: null });
const httpErr = (status, code, extra) => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => code ? { ok: false, error: Object.assign({ code, message: "server says " + code }, extra || {}) } : { code: "NOT_FOUND", message: "Requested function was not found" } } } });
function server(routes){
  const calls = [];
  const invoke = async (name, opts) => {
    assert.equal(name, "admin-storage", "only the admin-storage function is called");
    const body = JSON.parse(JSON.stringify(opts && opts.body));
    calls.push(body);
    const r = routes[body.action];
    if (!r) throw new Error("unexpected action " + body.action);
    return typeof r === "function" ? r(body, calls) : r;
  };
  return { calls, invoke, routes, count: (a) => calls.filter((c) => c.action === a).length };
}
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
async function openPage(routes, opts){
  const srv = server(routes);
  const page = makeBox(srv.invoke, opts);
  const opened = page.box.turnOpenAdminStorage();
  await settle();
  return Object.assign(page, { srv, opened });
}

/* ── 1. pure helpers ───────────────────────────────────────────────────── */
const lib = makeBox(null).box.AdminStorageLib;
await test("AdminStorageLib exports the spec §8.12 helpers", () => {
  for (const k of ["fmtBytes", "fmtCount", "fmtAgo", "shortId", "statusChip", "parseStorageRef", "buildModel", "keptLines", "errorMessage"])
    assert.equal(typeof lib[k], "function", k);
});
await test("fmtBytes is 1024-based; counts, ids and ages format plainly", () => {
  assert.equal(lib.fmtBytes(0), "0 B");
  assert.equal(lib.fmtBytes(1023), "1023 B");
  assert.equal(lib.fmtBytes(1024), "1 KB");
  assert.equal(lib.fmtBytes(1536), "1.5 KB");
  assert.equal(lib.fmtBytes(5.5 * GB), "5.5 GB");
  assert.equal(lib.fmtBytes(812 * MB), "812 MB");
  assert.equal(lib.fmtBytes(1.2 * GB), "1.2 GB");
  assert.equal(lib.fmtBytes(null), "\u2014");
  assert.equal(lib.fmtCount(4224), "4,224");
  assert.equal(lib.shortId(PD1), "eeeeeeee");
  const now = Date.now();
  assert.equal(lib.fmtAgo(new Date(now - 3 * 86400000).toISOString(), now), "3 d ago");
  assert.equal(lib.fmtAgo(new Date(now - 5 * 60000).toISOString(), now), "5 min ago");
  assert.equal(lib.fmtAgo(null, now), "never");
});
await test("parseStorageRef resolves dashboard paths, studio previews, bare uuids; junk is null", () => {
  same(lib.parseStorageRef("turn-assets/" + A + "/" + P1 + "/character/c1/1700-sheet.png"), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef(A + "/" + P1), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef("  " + A.toUpperCase() + "/" + P1.toUpperCase() + "/  "), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef(A + "/studio-previews/" + PD1 + "/job/preview.png"), { uid: A, pid: PD1, bare: false });
  same(lib.parseStorageRef(B), { uid: B, pid: null, bare: true });
  same(lib.parseStorageRef(A + "/stage-tmp/x.png"), { uid: A, pid: null, bare: false });
  same(lib.parseStorageRef("https://abc.supabase.co/storage/v1/object/sign/turn-assets/" + A + "/" + P1 + "/shot/s1/x.png?token=zzz"), { uid: A, pid: P1, bare: false });
  for (const junk of ["", "   ", "hello", "_internal/relay/x", "blender-studio-internal/m.glb", "1234", A.slice(0, 30), "not-a-uuid/" + P1])
    assert.equal(lib.parseStorageRef(junk), null, JSON.stringify(junk));
});
await test("parseStorageRef reads readable folders (2026-09-27): paths, URLs, studio previews and bare folders; the id decides", () => {
  same(lib.parseStorageRef("alice--" + A + "/pine-soot--" + P1 + "/character/c1/20260927-101500-sheet-v1-ab12cd34.png"), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef("turn-assets/alice--" + A + "/studio-previews/pine-soot--" + PD1 + "/loc-1/preview.png"), { uid: A, pid: PD1, bare: false });
  same(lib.parseStorageRef("https://abc.supabase.co/storage/v1/object/sign/turn-assets/alice--" + A + "/pine-soot--" + P1 + "/shot/s1/x.png?token=zzz"), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef("turn-assets/alice--" + A + "%2Fpine-soot--" + P1 + "%2Fshot%2Fs1%2Fx.png"), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef("pine-soot--" + P1), { uid: P1, pid: null, bare: true }, "a bare folder: resolveRef tries the account, then the project");
  same(lib.parseStorageRef("alice--" + A + "/"), { uid: A, pid: null, bare: true });
  same(lib.parseStorageRef("alice--" + A + "/stage-tmp/1758800000000-image-0-a1b2.png"), { uid: A, pid: null, bare: false });
  same(lib.parseStorageRef("alice--" + A + "/" + P1 + "/prop/p/x.png"), { uid: A, pid: P1, bare: false }, "mixed forms");
  same(lib.parseStorageRef(A + "/untitled--" + P1), { uid: A, pid: P1, bare: false });
  same(lib.parseStorageRef("alice--" + A + "/Pine-Soot--" + P1), { uid: A, pid: null, bare: false }, "an invalid project folder is not a project");
  for (const junk of ["Alice--" + A, "deadbeef--" + A, "a--b--" + A, "alice-" + A, "--" + A, "alice--" + A.toUpperCase(), "x".repeat(65) + "--" + A, "alice_x--" + A + "/" + P1])
    assert.equal(lib.parseStorageRef(junk), null, JSON.stringify(junk));
  // without the parser (an old cached page): legacy keys only, as before
  const bare = makeBox(null, { noKeys: true }).box.AdminStorageLib;
  same(bare.parseStorageRef(A.toUpperCase() + "/" + P1), { uid: A, pid: P1, bare: false });
  assert.equal(bare.parseStorageRef("alice--" + A + "/pine-soot--" + P1), null);
});
await test("buildModel takes the uploader of a readable account folder from its id", () => {
  const ov = OVERVIEW();
  ov.folders = ov.folders.concat([folder("alice--" + A, "pine-soot--" + P1, P1, { uploader_id: null, uploader_email: "alice@example.test", files: 2, bytes: 2 * MB, referenced: 2 })]);
  const m = lib.buildModel(ov);
  const p1 = m.projectsById[P1];
  const readable = p1.folders.find((f) => f.user_folder === "alice--" + A);
  assert.ok(readable, "the readable folder joins its project by id");
  assert.equal(readable.uploader_id, A);
  assert.equal(p1.folders.reduce((n, f) => n + f.files, 0), 3 + 1 + 2, "legacy, preview and readable folders of one project add up");
});
await test("status vocabulary: one chip map (spec §8.3)", () => {
  const c = (s, safe, live) => { const x = lib.statusChip(s, safe, live); return x.text + "|" + x.tone; };
  assert.equal(c("current, history"), "In use|neutral");
  assert.equal(lib.statusChip("current, history").title, "current, history");
  assert.equal(c("service"), "Service \u00b7 keep|neutral");
  assert.equal(c("uploading"), "Uploading|amber");
  assert.equal(c("queued-for-cleanup"), "Queued for cleanup|amber");
  assert.equal(c("kept-for-promotion-retry"), "Kept for Show retry|amber");
  assert.equal(c("orphan: project deleted", false), "Project deleted|alert");
  assert.equal(c("orphan: project deleted", true), "Project deleted \u00b7 safe to delete|alert");
  assert.equal(c("unreferenced", true, true), "Unreferenced|alert");
  assert.match(lib.statusChip("unreferenced", true, true).title, /Not deleted from this page/);
  assert.equal(lib.statusChip("service").title, "Server-owned file (relay marker, Blender mesh or preview). Kept.", "temp files are no longer called kept (2026-09-28)");
});
await test("buildModel groups Owns / Uploaded elsewhere / Deleted and totals from the folders", () => {
  const m = lib.buildModel(OVERVIEW());
  const acct = (id) => m.accountsById[id];
  same(m.accounts.map((a) => a.id), [A, D, C, B], "largest upload folder first");
  same(acct(A).owns.map((p) => p.label), ["Neon Harbor", "Dust Road \u2014 Episode 2", "Dust Road (Show)"], "an episode shows its own title");
  assert.equal(lib.kindLabel(m.projectsById[P3]), "Ep 2 \u00b7 Dust Road", "the Kind column carries the episode number");
  const ep = (o) => lib.projectLabel(Object.assign({ live: true, kind: "episode", show_title: "Dust Road" }, o));
  assert.notEqual(ep({ title: "The Well" }), ep({ title: "The Storm" }), "two unnumbered episodes stay distinguishable");
  assert.equal(ep({ title: null, episode: null }), "Dust Road \u00b7 Episode");
  assert.equal(ep({ title: null, episode: 3 }), "Dust Road \u00b7 Episode 3");
  assert.equal(lib.kindLabel({ live: true, kind: "episode", show_title: "Dust Road", episode: null }), "Episode \u00b7 Dust Road");
  assert.equal(acct(A).elsewhere.length, 0);
  assert.equal(acct(A).deleted.length, 1);
  const d = acct(A).deleted[0];
  assert.equal(d.project.id, PD1);
  assert.equal(d.files, 11, "the deleted project's asset folder + its studio previews");
  assert.equal(d.safe_files, 9);
  assert.equal(d.counts.queued, 2);
  assert.equal(d.verdict, "some");
  same(acct(B).owns, []);
  same(acct(B).elsewhere.map((e) => [e.project.id, e.files]), [[P4, 2]], "bob uploaded to carol's live film");
  same(acct(C).owns.map((p) => p.id), [P4]);
  assert.equal(acct(C).elsewhere.length, 0, "an owner's own uploads are not 'elsewhere'");
  same(acct(D).deleted.map((x) => [x.project.id, x.verdict]), [[PD2, "delete-folder"]]);
  assert.equal(m.totals.files, 31);
  assert.equal(m.totals.accounts, 3);
  assert.equal(m.totals.deletedAccounts, 1);
  assert.equal(m.totals.deletedProjects, 2);
  assert.equal(m.totals.deletedSafeFiles, 13);
  same(m.totals.queue, { ready: 3, later: 2, stuck: 1, total: 5 });
  const svc = m.service.map((s) => s.label);
  assert.ok(svc.includes("Relay security markers (_internal)"));
  assert.ok(svc.includes("Temporary image files (*/stage-tmp)"));
  assert.ok(svc.includes("Blender previews of live projects"), "a LIVE project's Blender previews are service");
  assert.equal(m.projectsById[PD1].label, "Deleted project \u00b7 eeeeeeee");
  assert.equal(m.projectsById[P1].uploaders[0].files, 4);
});
await test("keptLines: plain language, only non-zero lines (spec §8.7)", () => {
  const m = lib.buildModel(OVERVIEW());
  const lines = lib.keptLines({ kept: { files: 9, byStatus: { "queued-for-cleanup": 4, "current": 1, "kept-for-promotion-retry": 2, "uploading": 1, "service": 1, "unreferenced": 0 },
    usedBy: [{ projectId: P2, files: 1 }] } }, m.projectsById);
  same(lines, [
    "4 queued for cleanup (the cleanup queue removes these)",
    "1 still used by Dust Road (Show)",
    "2 kept for a Show-promotion retry",
    "1 still uploading",
    "1 service file (Blender relay preview)",
  ]);
  same(lib.keptLines({ kept: { files: 0, byStatus: {}, usedBy: [] } }, m.projectsById), []);
  same(lib.keptLines({ kept: { files: 3, byStatus: { "current, history": 3, "outside the TURN asset layout": 2 }, usedBy: [] } }, {}),
    ["3 still in use", "2 outside the Kinolot asset layout (review by hand)"]);
  // 2026-09-27 review: 'history-ref' (and any referenced kind) is in use, listed once, never as a raw code
  same(lib.keptLines({ kept: { files: 1, byStatus: { "history-ref": 1 }, usedBy: [{ projectId: P2, files: 1 }] } }, m.projectsById),
    ["1 still used by Dust Road (Show)"]);
  same(lib.keptLines({ kept: { files: 1, byStatus: { "history-ref": 1 }, usedBy: [] } }, {}), ["1 still in use"]);
  same(lib.keptLines({ kept: { files: 4, byStatus: { "current, history-ref": 2, "cameo-angle, history-cleanup-pending": 1, "kept": 1 }, usedBy: [] } }, {}),
    ["3 still in use", "1 kept"]);
  for (const l of lib.keptLines({ kept: { files: 2, byStatus: { "history-ref": 1, "ref, history-ref": 1 }, usedBy: [] } }, {}))
    assert.doesNotMatch(l, /history-ref|kept:/);
});
await test("errorMessage maps every server code to the page's copy (spec §8.10)", () => {
  const M = lib.MSG;
  const e = (status, code, extra) => lib.errorMessage({ status, code, message: "x", extra: extra || {} });
  assert.equal(e(404, "not_deployed"), M.notDeployed);
  assert.equal(e(0, "not_deployed"), M.notDeployed);
  assert.equal(e(401, "sign_in"), "Sign in again to use this page.");
  assert.equal(e(403, "admin_only"), "This page is only for the platform admin account.");
  assert.equal(e(412, "views_missing"), "Run supabase/admin-inventory.sql in the SQL Editor, then Refresh.");
  assert.equal(e(412, "views_drift"), "Run supabase/admin-inventory.sql in the SQL Editor, then Refresh.");
  assert.equal(e(412, "audit_missing"), "Deleting is off until supabase/admin-storage.sql is run in the SQL Editor.");
  assert.match(e(412, "not_full_reader"), /can't see every row, so nothing is marked safe and deleting is off \(check SUPABASE_DB_URL \/ ADMIN_STORAGE_DB_URL\)/);
  assert.equal(e(503, "db_unreachable"), "The database couldn't be reached from the function.");
  assert.equal(e(409, "project_live"), "One of these projects exists again, so nothing was deleted. Refresh.");
  assert.equal(e(409, "preview_expired"), "This review expired. Review again.");
  const started = new Date(2026, 8, 27, 14, 2, 0).toISOString();
  assert.equal(e(409, "run_busy", { startedAt: started }), "This delete is already running (started 14:02). It will show in History.");
  assert.equal(e(500, "internal"), "Something went wrong on the server. Nothing further was deleted; History shows what happened.");
  assert.equal(e(0, "timeout"), "The server took too long. History shows whether anything was deleted.");
  assert.equal(e(0, "fetch"), "Lost the connection to the server. History shows whether anything was deleted.", "a dropped connection is not 'not deployed'");
  assert.equal(e(409, "project_live", { result: { removed: 0 } }), M.projectLive);
  assert.equal(e(409, "project_live", { result: { removed: 200 } }), "One of these projects exists again, so deleting stopped. 200 files had already been deleted. Refresh.");
});

/* ── 2. entry point: the account chip + the opener ─────────────────────── */
await test("the AccountChip menu item renders only for the admin, and opens the page", async () => {
  const rt = createRuntime();
  const opened = [];
  const box = { console, React: rt.React, ReactDOM: rt.ReactDOM, queueMicrotask, document: { addEventListener(){}, removeEventListener(){} },
    Icon: new Proxy({}, { get: () => function IconStub(){ return null; } }),
    cloudConfigured: () => true, cloudUserEmail: () => "someone@example.test", turnIsAdmin: false };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(AUTH_JS, box);
  box.turnOpenAdminStorage = () => { opened.push(1); return true; };   // loaded for everyone in production
  const reopen = async () => { await click(find(rt.tree(), (n) => hasClass(n, "acct-chip"))); await click(find(rt.tree(), (n) => hasClass(n, "acct-chip"))); };
  rt.mount(rt.React.createElement(box.AccountChip, { session: { user: {} }, cloudActive: true, saveState: "saved" }));
  await click(find(rt.tree(), (n) => hasClass(n, "acct-chip")));
  assert.ok(find(rt.tree(), (n) => hasClass(n, "acct-menu")), "menu open");
  assert.equal(button(rt.tree(), /Storage · admin/), null, "non-admin: no item, even with the opener loaded");
  box.turnIsAdmin = true; delete box.turnOpenAdminStorage;     // admin, but the page script isn't loaded
  await reopen();
  assert.equal(button(rt.tree(), /Storage · admin/), null, "no opener: no item");
  box.turnOpenAdminStorage = () => { opened.push(1); return true; };
  await reopen();
  const item = button(rt.tree(), /Storage · admin/);
  assert.ok(item && hasClass(item, "acct-admin") && hasClass(item, "acct-upgrade"));
  const kids = find(rt.tree(), (n) => hasClass(n, "acct-menu")).children;
  assert.ok(kids.indexOf(item) >= 0 && kids.indexOf(item) < kids.findIndex((n) => hasClass(n, "acct-signout")), "above Sign out");
  await click(item);
  assert.equal(opened.length, 1);
  assert.equal(find(rt.tree(), (n) => hasClass(n, "acct-menu")), null, "the menu closes");
});
await test("the opener refuses a non-admin and fetches nothing before it opens", async () => {
  const srv = server({ overview: ok(OVERVIEW()) });
  const page = makeBox(srv.invoke, { admin: false });
  assert.equal(srv.calls.length, 0, "loading the script calls nothing");
  assert.equal(page.timers.length + page.intervals.size + Object.keys(page.listeners).length, 0, "…and schedules or listens to nothing (every visitor loads it)");
  assert.equal(page.box.turnOpenAdminStorage(), false);
  await settle();
  assert.equal(page.body.children.length, 0);
  assert.equal(srv.calls.length, 0);
  page.box.turnIsAdmin = true;
  assert.equal(page.box.turnOpenAdminStorage(), true);
  assert.equal(page.box.turnOpenAdminStorage(), false, "one instance at a time");
  assert.equal(page.body.children.length, 1);
  assert.equal(page.body.children[0].className, "adm-root");
  await settle();
  same(srv.calls, [{ action: "overview" }]);
});

await test("the page closes itself once the admin flag drops (sign-out), with no click: the 1 s watch and the auth listener", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()) });
  assert.equal(page.body.children.length, 1);
  assert.ok(page.classes.has("adm-open"), "body.adm-open while open (hides the price-drift card)");
  page.box.turnIsAdmin = false;                      // app.jsx, after a sign-out in another tab
  await page.tick(1000);
  assert.equal(page.body.children.length, 0, "gone within a second, nothing clicked");
  assert.ok(!page.classes.has("adm-open"));
  assert.equal(page.intervals.size, 0, "its timers are cleared");
  // supabase-js reports the sign-out before app.jsx re-renders
  let cb = null, unsubscribed = 0;
  const auth = { onAuthStateChange(fn){ cb = fn; return { data: { subscription: { unsubscribe(){ unsubscribed++; } } } }; } };
  const second = await openPage({ overview: ok(OVERVIEW()) }, { auth });
  assert.equal(typeof cb, "function");
  cb("TOKEN_REFRESHED", { user: {} }); await settle();
  assert.equal(second.body.children.length, 1, "a refreshed session keeps it open");
  cb("SIGNED_OUT", null); await settle();
  assert.equal(second.body.children.length, 0, "a sign-out closes it at once");
  assert.equal(unsubscribed, 1);
  // a stale close from a closed instance never closes a newer one
  const stale = cb;
  assert.equal(second.box.turnOpenAdminStorage(), true); await settle();
  assert.notEqual(cb, stale, "the new instance subscribed afresh");
  stale("SIGNED_OUT", null); await settle();
  assert.equal(second.body.children.length, 1);
});

/* ── 3. loading, empty and error states (inline, not only toasts) ─────── */
await test("loading: skeleton tiles, 'Reading the bucket…', focus on close; Esc and backdrop close", async () => {
  const gate = deferred();
  const page = await openPage({ overview: () => gate.promise });
  const t = page.tree();
  assert.equal(byClass(t, "skel").length, 4);
  assert.match(text(t), /Reading the bucket… a few seconds\./);
  assert.match(text(find(t, (n) => hasClass(n, "adm-sub"))), /admin · reading/);
  const dlg = find(t, (n) => n.props.role === "dialog");
  assert.equal(dlg.props["aria-modal"], "true");
  assert.equal(dlg.props["aria-labelledby"], "adm-title");
  assert.ok(hasClass(dlg, "bible-modal") && hasClass(dlg, "adm-storage"));
  assert.equal(page.rt.focused && page.rt.focused.props["aria-label"], "Close", "focus goes to the close button");
  gate.resolve(ok(OVERVIEW()));
  await settle();
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-sub"))), /^admin · as of \d\d:\d\d:\d\d · 1\.2 s$/);
  await page.key("Escape");
  assert.equal(page.body.children.length, 0, "Esc closes");
  assert.equal(page.box.turnOpenAdminStorage(), true, "re-openable");
  await settle();
  const overlay = find(page.tree(), (n) => hasClass(n, "adm-overlay"));
  overlay.props.onMouseDown({ target: overlay, currentTarget: overlay });
  await settle();
  assert.equal(page.body.children.length, 0, "a backdrop click closes");
});
const STATES = [
  ["404 not deployed", httpErr(404, null), /isn't deployed yet \(supabase\/README\.md → Admin Storage page\)/],
  ["fetch error", { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } }, /isn't deployed yet/],
  ["relay error", { data: null, error: { name: "FunctionsRelayError", message: "Relay Error" } }, /isn't deployed yet/],
  ["401", httpErr(401, "sign_in"), /^Sign in again to use this page\.$/],
  ["403", httpErr(403, "admin_only"), /^This page is only for the platform admin account\.$/],
  ["412 views_missing", httpErr(412, "views_missing"), /^Run supabase\/admin-inventory\.sql in the SQL Editor, then Refresh\.$/],
  ["412 views_drift", httpErr(412, "views_drift"), /^Run supabase\/admin-inventory\.sql/],
  ["503", httpErr(503, "db_unreachable"), /^The database couldn't be reached from the function\.$/],
  ["500", httpErr(500, "internal"), /^Something went wrong on the server/],
];
for (const [name, resp, re] of STATES) {
  await test("error state renders its copy inline: " + name, async () => {
    const page = await openPage({ overview: resp });
    const err = find(page.tree(), (n) => hasClass(n, "adm-error"));
    assert.ok(err, "blocking error panel");
    assert.equal(err.props.role, "alert");
    assert.match(text(find(err, (n) => hasClass(n, "adm-error-msg"))), re);
    const again = button(err, name === "503" ? /^Retry$/ : /^Refresh$/);
    assert.ok(again, "offers " + (name === "503" ? "Retry" : "Refresh"));
    page.srv.routes.overview = ok(OVERVIEW());
    await click(again);
    assert.equal(page.srv.count("overview"), 2);
    assert.equal(find(page.tree(), (n) => hasClass(n, "adm-error")), null, "recovers on retry");
  });
}
await test("client timeout (90 s) and a missing cloud client each say so", async () => {
  const page = await openPage({ overview: () => new Promise(() => {}) });
  const t90 = page.timers.find((t) => t.ms === 90000);
  assert.ok(t90, "a 90 s race timer");
  t90.fn(); await settle();
  assert.match(text(page.tree()), /The server took too long\. History shows whether anything was deleted\./);
  const none = makeBox(null);
  none.box.turnOpenAdminStorage(); await settle();
  assert.match(text(none.tree()), /Cloud isn't configured in this build/);
});
await test("empty bucket, audit-off banner, not-full-reader banner, no queue", async () => {
  let page = await openPage({ overview: ok(OVERVIEW({ folders: [], projects: [], queue: { byReason: [], stuck: [] },
    accounts: [{ user_id: A, email: "admin@infinitestudioai.com", plan: null, film_count: 0, file_count: 0, total_bytes: 0, deleted_account: false }] })) });
  assert.match(text(page.tree()), /No files in storage yet\./);
  await click(button(page.tree(), /^Cleanup$/));
  assert.match(text(page.tree()), /The cleanup queue is empty\./);
  assert.equal(button(page.tree(), /Run cleanup now/).props.disabled, true, "nothing ready");

  page = await openPage({ overview: ok(OVERVIEW({ setup: SETUP({ deleteEnabled: false, drainEnabled: false, tempEnabled: false }, { audit: false }) })) });
  let t = page.tree();
  const banner = find(t, (n) => hasClass(n, "adm-setup"));
  assert.match(text(banner), /Deleting is off until supabase\/admin-storage\.sql is run in the SQL Editor\./);
  assert.equal(button(t, /^History$/), null, "History hidden until the audit schema exists");
  assert.ok(button(t, /^Accounts$/) && button(t, /^Projects$/));
  await click(button(t, /Deleted accounts/));
  await click(find(page.tree(), (n) => hasClass(n, "adm-acct-head")));
  assert.equal(button(page.tree(), /Review & delete/), null, "no delete action while deleting is off");
  assert.match(text(page.tree()), /Deleting off/);
  page.srv.routes["project-files"] = ok({ rows: [], nextCursor: null, total: 0 });
  await click(button(page.tree(), /^Projects$/));
  assert.equal(findAll(page.tree(), (n) => n.type === "input" && n.props.type === "checkbox").length, 0, "no checkboxes while deleting is off");
  await click(find(page.tree(), (n) => hasClass(n, "adm-row") && /Deleted project · eeeeeeee/.test(text(n)) && n.props.onClick));
  const foot = find(page.tree(), (n) => hasClass(n, "adm-detail-foot"));
  assert.equal(button(foot, /Review & delete/).props.disabled, true, "the detail footer follows the same rule");
  assert.match(text(foot), /Deleting is off until supabase\/admin-storage\.sql is run/);

  page = await openPage({ overview: ok(OVERVIEW({ setup: SETUP({ seesAll: false, deleteEnabled: false, drainEnabled: false }) })) });
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-setup"))),
    /The function's database role can't see every row, so nothing is marked safe and deleting is off \(check SUPABASE_DB_URL \/ ADMIN_STORAGE_DB_URL\)\./);

  page = await openPage({ overview: ok(OVERVIEW({ queue: null, setup: SETUP({ drainEnabled: false }, { queue: false }) })) });
  t = page.tree();
  assert.match(text(t), /Not installed/);
  // 2026-09-28: the tab is "Cleanup" and the audit log alone keeps it (temp files are cleared there)
  await click(button(t, /^Cleanup$/));
  const qs = find(page.tree(), (n) => n.props["aria-label"] === "Cleanup queue");
  assert.match(text(qs), /^Cleanup queueThe cleanup queue isn't installed\.$/, "no queue: only that section says so");
  assert.ok(find(page.tree(), (n) => n.props["aria-label"] === "Old temp files"), "the temp-file section still shows");
  page = await openPage({ overview: ok(OVERVIEW({ queue: null, setup: SETUP({ deleteEnabled: false, drainEnabled: false, tempEnabled: false }, { queue: false, audit: false }) })) });
  assert.equal(button(page.tree(), /^Cleanup/), null, "no queue and no audit log: no Cleanup tab");
});

/* ── 4. tiles, accounts, search, projects, detail ──────────────────────── */
await test("tiles and the Accounts tab (default): cards, groups, filters, service row", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()) });
  let t = page.tree();
  const tiles = byClass(t, "adm-tile").map(text);
  assert.match(tiles[0], /^Stored31 files61\.\d MB$|^Stored31 files1\.\d GB$/);
  assert.equal(tiles[1], "Accounts31 deleted account folder");
  assert.match(tiles[2], /^Deleted projects2 · 1\.\d GB1\.\d GB safe to delete$/);
  assert.equal(tiles[3], "Cleanup queue3 ready · 2 later · 1 stuck");
  assert.equal(tiles[4], "Old temp files1 · 1 MBolder than 24 hours");
  same(findAll(t, (n) => n.props.role === "tab").map(text), ["Accounts", "Projects", "Cleanup", "History"]);
  assert.equal(find(t, (n) => n.props.role === "tab" && n.props["aria-selected"] === true).children[0], "Accounts");
  const cards = byClass(t, "adm-acct");
  assert.equal(cards.length, 4);
  assert.match(text(cards[0]), /alice@example\.test/);
  assert.match(text(cards[0]), /Neon Harbor · Dust Road — Episode 2 · Dust Road \(Show\)/);
  assert.match(text(cards[0]), /3 GB uploaded · 16 files/, "the card size says it is what this account uploaded");
  assert.match(text(cards[0]), /3 projects/);
  assert.match(text(cards[0]), /last sign-in 3 d ago/);
  assert.match(text(cards[1]), /Deleted account · dddddddd/);
  // 2026-09-28 review: the temp folder is no longer "kept" — it points at Cleanup; service files stay kept
  const svc = find(t, (n) => hasClass(n, "adm-service"));
  assert.equal(text(find(svc, (n) => hasClass(n, "adm-group-h"))), "Service & temporary files");
  const svcRows = Object.fromEntries(byClass(svc, "adm-service-row").map((r) => [text(find(r, (n) => hasClass(n, "c-title"))), text(find(r, (n) => hasClass(n, "adm-muted")))]));
  same(svcRows, { "Temporary image files (*/stage-tmp)": "1 older than 24 hours · clear them in Cleanup",
    "Blender previews of live projects": "kept", "Relay security markers (_internal)": "kept" });
  assert.doesNotMatch(text(svc), /expired · kept/, "no 'kept' next to the files Cleanup clears");
  // the tab strip never shrinks (phones: overflow-x:auto makes its min-height 0 in the .adm-body column)
  assert.equal(find(t, (n) => n.props.role === "tablist").props.style.flexShrink, 0);
  await click(find(cards[0], (n) => hasClass(n, "adm-acct-head")));
  t = page.tree();
  const alice = byClass(t, "adm-acct")[0];
  assert.equal(alice.children[0].props["aria-expanded"], true);
  const groups = byClass(alice, "adm-group-h").map(text);
  same(groups, ["Owns", "Deleted projects still holding files"]);
  assert.match(text(alice), /Deleted project · eeeeeeee/);
  assert.match(text(alice), /9 safe · /);
  assert.match(text(alice), /Some safe/);
  assert.match(text(alice), /alice 4/, "uploaded-by summary");
  assert.match(text(alice), /no files/, "owned project with 0 files");
  assert.ok(button(alice, /Review & delete/));
  await click(find(byClass(page.tree(), "adm-acct")[3], (n) => hasClass(n, "adm-acct-head")));
  const bob = byClass(page.tree(), "adm-acct")[3];
  same(byClass(bob, "adm-group-h").map(text), ["Uploaded to other people's projects"]);
  assert.match(text(bob), /Carol's film · owned by carol@example\.test/);
  await click(button(page.tree(), /^Deleted accounts$/));
  assert.equal(byClass(page.tree(), "adm-acct").length, 1);
  await click(button(page.tree(), /^Has deleted projects$/));
  assert.equal(byClass(page.tree(), "adm-acct").length, 2);
});
await test("search: text filters; a pasted path, folder or uuid resolves to its account or project", async () => {
  const files = { rows: [], nextCursor: null, total: 0 };
  const page = await openPage({ overview: ok(OVERVIEW()), "project-files": ok(files) });
  const input = () => find(page.tree(), (n) => n.type === "input" && n.props.type === "search");
  assert.equal(input().props.placeholder, "Email, title, or paste a Storage path / folder / UUID");
  input().props.onChange({ target: { value: "carol" } }); await settle();
  same(byClass(page.tree(), "adm-acct").map((n) => /carol@/.test(text(n))), [true]);
  input().props.onChange({ target: { value: "turn-assets/" + A + "/" + P1 + "/character/c1/1-sheet.png" } }); await settle();
  let detail = find(page.tree(), (n) => hasClass(n, "adm-detail"));
  assert.ok(detail, "uid/pid opens the project detail");
  assert.match(text(detail), /Neon Harbor/);
  same(page.srv.calls.at(-1), { action: "project-files", projectId: P1 });
  await page.key("Escape");
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-detail")), null, "Esc closes the detail first");
  assert.equal(page.body.children.length, 1, "…not the page");
  await click(button(page.tree(), /^Deleted accounts$/));
  input().props.onChange({ target: { value: B } }); await settle();
  const bob = byClass(page.tree(), "adm-acct").find((n) => /bob@/.test(text(n)));
  assert.ok(bob && hasClass(bob, "open"), "a bare uid expands that account (and clears a hiding filter)");
  input().props.onChange({ target: { value: PD2 } }); await settle();
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-detail"))), /Deleted project · ffffffff/, "a bare project id opens it");
  await page.key("Escape");
  input().props.onChange({ target: { value: U("9") + "/" + U("8") } }); await settle();
  assert.equal(text(find(page.tree(), (n) => hasClass(n, "adm-note"))), "No account or project with that id in storage.");
});
await test("project detail: folders with Copy, files grouped, tags, Load more, footer rules", async () => {
  const other = A + "/" + P1 + "/character/c9/1-sheet.png";
  const rows1 = [
    { path: A + "/" + PD1 + "/character/c1/1-sheet.png", bytes: 3 * MB, mime: "image/png", created_at: iso(5 * 86400000), uploader_email: "alice@example.test",
      asset_folder: "character", entity_id: "c1", entity_name: "Mara", status: "orphan: project deleted", safe_to_delete: true, orphan_reason: "x", referenced_by_project_ids: null, stored_elsewhere: false },
    { path: A + "/" + PD1 + "/character/c2/1-sheet.png", bytes: MB, mime: "image/png", created_at: iso(5 * 86400000), uploader_email: "alice@example.test",
      asset_folder: "character", entity_id: "c2", entity_name: "Ben", status: "current", safe_to_delete: false, orphan_reason: null, referenced_by_project_ids: [P2], stored_elsewhere: false },
  ];
  const rows2 = [{ path: other, bytes: MB, mime: "image/png", created_at: iso(86400000), uploader_email: "alice@example.test",
    asset_folder: "character", entity_id: "c9", entity_name: "Show sheet", status: "current", safe_to_delete: false, orphan_reason: null, referenced_by_project_ids: [PD1], stored_elsewhere: true }];
  const page = await openPage({ overview: ok(OVERVIEW()),
    "project-files": (b) => b.cursor ? ok({ rows: rows2, nextCursor: null, total: null }) : ok({ rows: rows1, nextCursor: rows1[1].path, total: 3 }) });
  await click(button(page.tree(), /^Projects$/));
  const row = find(page.tree(), (n) => hasClass(n, "adm-row") && /Deleted project · eeeeeeee/.test(text(n)) && n.props.onClick);
  await click(row);
  let d = find(page.tree(), (n) => hasClass(n, "adm-detail"));
  assert.match(text(d), /OwnerDeleted project/);
  assert.match(text(d), new RegExp("Project id" + PD1));
  assert.ok(find(d, (n) => n.type === "button" && n.props["aria-label"] === "Copy project id"));
  assert.match(text(find(d, (n) => hasClass(n, "adm-folders"))), new RegExp("Storage folders:" + A + "/" + PD1 + "alice@example\\.test · 10 files"));
  assert.match(text(d), /Showing 2 of 3 files/);
  assert.match(text(d), /Project deleted · safe to delete/);
  assert.match(text(d), /Used by Dust Road \(Show\)/, "a kept file used by a live project names it");
  assert.match(text(find(d, (n) => hasClass(n, "adm-detail-foot"))), /Review & delete/);
  assert.equal(button(find(d, (n) => hasClass(n, "adm-detail-foot")), /Review & delete/).props.disabled, false);
  await click(button(d, /^Load more$/));
  same(page.srv.calls.at(-1), { action: "project-files", projectId: PD1, cursor: rows1[1].path });
  d = find(page.tree(), (n) => hasClass(n, "adm-detail"));
  assert.match(text(d), /stored under another project's folder/);
  assert.equal(button(d, /^Load more$/), null);
  await click(find(d, (n) => hasClass(n, "adm-back")));
  const empty = await openPage({ overview: ok(OVERVIEW()), "project-files": ok({ rows: [], nextCursor: null, total: 0 }) });
  await click(button(empty.tree(), /^Projects$/));
  await click(find(empty.tree(), (n) => hasClass(n, "adm-row") && /Dust Road \(Show\)/.test(text(n)) && n.props.onClick));
  d = find(empty.tree(), (n) => hasClass(n, "adm-detail"));
  assert.match(text(d), /No files stored for this project\./);
  assert.equal(find(d, (n) => hasClass(n, "adm-detail-foot")), null, "live projects have no delete footer");
});

/* ── 5. review sheet → delete loop → result ────────────────────────────── */
const PREVIEW = (over = {}) => ok(Object.assign({
  runId: U("7"), previewExpiresAt: new Date(Date.now() + 14.5 * 60000).toISOString(),
  total: { files: 12, bytes: 1.2 * GB },
  kept: { files: 9, byStatus: { "queued-for-cleanup": 4, "current": 1, "kept-for-promotion-retry": 2, "uploading": 1, "service": 1 }, usedBy: [{ projectId: P2, files: 1 }] },
  projects: [{ projectId: PD1, files: 8, bytes: GB, kept: 3, keptByStatus: {} }, { projectId: PD2, files: 4, bytes: 0.2 * GB, kept: 6, keptByStatus: {} }],
  sample: [],
}, over));
const DEL = (o) => ok(Object.assign({ runId: U("7"), status: "partial", planned: 12, removed: 0, removedBytes: 0, alreadyGone: 0,
  skipped: { count: 0, byStatus: {} }, failed: { count: 0, sample: [] }, remaining: 12 }, o));
await test("bulk review from Projects: checkbox gates Delete, countdown, kept lines, progress, partial → Retry → done", async () => {
  const gates = [];
  const script = [
    DEL({ removed: 5, removedBytes: 0.5 * GB, remaining: 7 }),
    DEL({ removed: 10, removedBytes: GB, remaining: 2, failed: { count: 2, sample: [{ path: "x", detail: "Service Unavailable" }] } }),
    DEL({ removed: 10, removedBytes: GB, remaining: 2, failed: { count: 2, sample: [{ path: "x", detail: "Service Unavailable" }] } }),
    DEL({ status: "done", removed: 12, removedBytes: 1.2 * GB, remaining: 0, leftInProjects: { "queued-for-cleanup": 4 } }),
  ];
  const page = await openPage({ overview: ok(OVERVIEW()), "preview-delete": PREVIEW(), runs: ok({ runs: [] }),
    delete: () => { const g = deferred(); gates.push(g); return g.promise; } });
  await click(button(page.tree(), /^Projects$/));
  const boxes = findAll(page.tree(), (n) => n.type === "input" && n.props.type === "checkbox");
  assert.equal(boxes.length, 2, "only deleted projects with safe files get a checkbox");
  boxes[0].props.onChange({ target: { checked: true } }); await settle();
  findAll(page.tree(), (n) => n.type === "input" && n.props.type === "checkbox")[1].props.onChange({ target: { checked: true } }); await settle();
  const bulk = find(page.tree(), (n) => hasClass(n, "adm-bulk"));
  assert.match(text(bulk), /^Review & delete 2 projects · 1\.\d GB safe/);
  await click(button(bulk, /Review & delete/));
  same(page.srv.calls.at(-1), { action: "preview-delete", projectIds: [PD1, PD2] });
  let sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-sheet-title"))), "Delete 12 files (1.2 GB) from 2 deleted projects?");
  assert.match(text(sh), /Only files nothing in Kinolot uses any more\. Each file is checked again right before it is deleted, and the Storage folders of live projects are never touched\./);
  same(find(sh, (n) => n.type === "ul").children.map(text), [
    "4 queued for cleanup (the cleanup queue removes these)", "1 still used by Dust Road (Show)", "2 kept for a Show-promotion retry",
    "1 still uploading", "1 service file (Blender relay preview)"]);
  assert.match(text(find(sh, (n) => hasClass(n, "adm-expiry"))), /^This review expires in 1[34]:\d\d$/);
  assert.ok(find(sh, (n) => n.type === "details"), "per-project breakdown, collapsible");
  let del = button(sh, /^Delete 12 files$/);
  assert.equal(del.props.disabled, true, "disabled until the box is checked");
  del.props.onClick(evt(del)); await settle();
  assert.equal(page.srv.count("delete"), 0, "an unchecked click does nothing");
  assert.match(text(sh), /I understand these files are deleted permanently\./);
  find(sh, (n) => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } }); await settle();
  del = button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Delete 12 files$/);
  assert.equal(del.props.disabled, false);
  await click(del);
  same(page.srv.calls.at(-1), { action: "delete", runId: U("7") }, "the browser sends only the run id");
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.match(text(sh), /If you close this window, the current step finishes or stops on its own\. History shows where it stopped, and Resume carries on\./);
  const overlay = find(page.tree(), (n) => hasClass(n, "adm-overlay"));
  overlay.props.onMouseDown({ target: overlay, currentTarget: overlay }); await page.key("Escape");
  assert.equal(page.body.children.length, 1, "no backdrop/Esc close while a delete call is in flight");
  const x = find(page.tree(), (n) => n.type === "button" && n.props["aria-label"] === "Close" && hasClass(n, "bible-x"));
  assert.equal(x.props.disabled, true, "the header \u00d7 is disabled while deleting");
  x.props.onClick(evt(x)); await settle();
  assert.equal(page.body.children.length, 1, "\u2026and inert even if clicked");
  assert.ok(find(page.tree(), (n) => hasClass(n, "adm-sheet")));
  gates[0].resolve(script[0]); await settle();
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-progress-lab"))), /^Deleting… 5 of 12 · 512 MB freed$/);
  assert.equal(find(page.tree(), (n) => n.props.role === "progressbar").props["aria-valuenow"], 5);
  gates[1].resolve(script[1]); await settle();
  gates[2].resolve(script[2]); await settle();
  assert.equal(page.srv.count("delete"), 3, "loops while partial makes progress, stops when it doesn't");
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 10 of 12. 2 couldn't be deleted (Storage error: Service Unavailable).");
  const overviewsBefore = page.srv.count("overview");
  await click(button(sh, /^Retry failed \(2\)$/));
  gates[3].resolve(script[3]); await settle();
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 12 files · 1.2 GB freed.");
  assert.match(text(sh), /4 files remain: queued for cleanup\./);
  assert.ok(page.toasts.some(([m, k]) => m === "Deleted 12 files · 1.2 GB freed." && k === "success"), "also a toast");
  assert.ok(page.srv.count("overview") > overviewsBefore, "the overview refreshes afterwards");
  await click(button(sh, /^Close$/));
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-sheet")), null);
});
await test("review sheet: expiry state, 'Review again', and 409 messages", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()), "preview-delete": PREVIEW({ previewExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    "project-files": ok({ rows: [], nextCursor: null, total: 0 }) });
  await click(find(byClass(page.tree(), "adm-acct")[0], (n) => hasClass(n, "adm-acct-head")));
  await click(button(page.tree(), /Review & delete/));
  same(page.srv.calls.at(-1), { action: "preview-delete", projectIds: [PD1] });
  let sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.match(text(sh), /This review expired\. Review again\./);
  assert.equal(find(sh, (n) => n.type === "input" && n.props.type === "checkbox"), null);
  assert.equal(button(sh, /^Delete 12 files$/).props.disabled, true);
  page.srv.routes["preview-delete"] = PREVIEW();
  await click(button(sh, /^Review again$/));
  assert.equal(page.srv.count("preview-delete"), 2);
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.match(text(sh), /This review expires in/);

  page.srv.routes.delete = httpErr(409, "project_live", { ids: [PD1] });
  find(sh, (n) => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } }); await settle();
  await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Delete 12 files$/));
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.match(text(sh), /One of these projects exists again, so nothing was deleted\. Refresh\./);

  assert.equal(button(sh, /^(Retry failed|Try again)/), null, "no retry once a project exists again");
  const again = async () => {
    await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Close$/));
    await click(button(page.tree(), /Review & delete/));
    find(find(page.tree(), (n) => hasClass(n, "adm-sheet")), (n) => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } });
    await settle();
    await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Delete 12 files$/));
    return find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  };
  const started = new Date(2026, 8, 27, 14, 2, 0).toISOString();
  page.srv.routes.delete = httpErr(409, "run_busy", { startedAt: started });
  sh = await again();
  assert.match(text(sh), /This delete is already running \(started 14:02\)\. It will show in History\./);
  const deletesBefore = page.srv.count("delete");
  await click(button(sh, /^Try again \(12 left\)$/));
  assert.equal(page.srv.count("delete"), deletesBefore + 1, "Try again re-sends the same run id");
  page.srv.routes.delete = httpErr(409, "preview_expired");
  sh = await again();
  assert.match(text(sh), /This review expired\. Review again\./);
  await click(button(sh, /^Review again$/));
  assert.ok(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Delete 12 files$/), "a fresh review");

  page.srv.routes["preview-delete"] = httpErr(409, "project_live", { ids: [PD1] });
  await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Cancel$/));
  await click(button(page.tree(), /Review & delete/));
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-sheet-title"))), "Nothing was deleted");
  assert.match(text(sh), /One of these projects exists again/);
});

await test("a slow preview never reopens a sheet the admin already closed", async () => {
  const gate = deferred();
  const page = await openPage({ overview: ok(OVERVIEW()), "preview-delete": () => gate.promise });
  await click(find(byClass(page.tree(), "adm-acct")[0], (n) => hasClass(n, "adm-acct-head")));
  await click(button(page.tree(), /Review & delete/));
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-sheet"))), /Planning the delete/);
  await page.key("Escape");
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-sheet")), null);
  gate.resolve(PREVIEW()); await settle();
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-sheet")), null, "stays closed");
});

/* ── 5b. 2026-09-27 review: selection rules, errors, keyboard, focus ──── */
const checkboxes = (t) => findAll(t, (n) => n.type === "input" && n.props.type === "checkbox");
await test("Projects: a live project's unused files are never selectable, say so in the row, and stay out of 'Safe to delete'", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()) });
  await click(button(page.tree(), /^Projects$/));
  const carol = find(page.tree(), (n) => hasClass(n, "adm-row") && /Carol's film/.test(text(n)) && n.props.onClick);
  assert.equal(checkboxes(carol).length, 0, "no checkbox on a live project, even with safe files");
  assert.equal(text(find(carol, (n) => hasClass(n, "c-safe"))), "1 unused · kept (live)", "visible on a phone, not only in a tooltip");
  assert.equal(checkboxes(page.tree()).length, 2);
  await click(button(page.tree(), /^Safe to delete$/));
  same(byClass(page.tree(), "adm-row").filter((n) => n.props.onClick).map((n) => text(find(n, (x) => hasClass(x, "c-title")))),
    ["Deleted project · eeeeeeee", "Deleted project · ffffffff"]);
  const pick = find(page.tree(), (n) => n.type === "label" && hasClass(n, "c-pick"));
  assert.ok(pick && find(pick, (n) => n.type === "input"), "the whole pick cell is the tap target");
});
await test("Projects: at most 50 projects per review; picks that stop being deletable after a Refresh drop out", async () => {
  const many = Array.from({ length: 51 }, (_, i) => "dd" + String(i).padStart(6, "0") + "-0000-4000-8000-000000000000");
  const ov = OVERVIEW({
    projects: many.map((id) => ({ project_id: id, owner_id: null, owner_email: null, title: "(deleted project)", kind: null, show_title: null, episode: null,
      live: false, files: 1, total_bytes: MB, orphan_files: 1, uploader_emails: "alice@example.test", last_upload: iso(86400000) })),
    folders: many.map((id) => folder(A, id, id, { uploader_email: "alice@example.test", files: 1, bytes: MB, safe_files: 1, safe_bytes: MB, orphan_deleted: 1, verdict: "delete-folder" })),
  });
  const page = await openPage({ overview: ok(ov), "preview-delete": PREVIEW() });
  await click(button(page.tree(), /^Projects$/));
  for (let i = 0; i < 51; i++) { checkboxes(page.tree())[i].props.onChange({ target: { checked: true } }); await settle(); }
  assert.ok(page.toasts.some(([m]) => m === "Review at most 50 projects at a time."));
  assert.equal(checkboxes(page.tree()).filter((c) => c.props.checked).length, 50);
  await click(button(find(page.tree(), (n) => hasClass(n, "adm-bulk")), /^Review & delete 50 projects/));
  assert.equal(page.srv.calls.at(-1).projectIds.length, 50, "the review sends 50 ids");
  await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Cancel$/));
  // a Refresh that shows one picked project with nothing safe left, and one gone live
  const next = JSON.parse(JSON.stringify(ov));
  next.folders[0].safe_files = 0; next.folders[0].safe_bytes = 0;
  next.projects[1].live = true; next.projects[1].owner_id = C; next.projects[1].title = "Back";
  page.srv.routes.overview = ok(next);
  await click(button(page.tree(), /^Refresh$/));
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-bulk"))), /^Review & delete 48 projects/, "stale picks drop out of the review");
  page.srv.routes.overview = ok(Object.assign({}, next, { setup: SETUP({ deleteEnabled: false, drainEnabled: false }, { audit: false }) }));
  await click(button(page.tree(), /^Refresh$/));
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-bulk")), null, "no bulk delete once deleting is off");
});
await test("Accounts: a deleted project shared by several uploaders says the review covers the whole project; keyboard stays on the control", async () => {
  const ov = OVERVIEW();
  ov.projects.find((p) => p.project_id === PD1).files = 13;
  ov.folders.push(folder(B, PD1, PD1, { uploader_email: "bob@example.test", files: 2, bytes: 2 * MB, safe_files: 2, safe_bytes: 2 * MB, orphan_deleted: 2, verdict: "delete-folder" }));
  const page = await openPage({ overview: ok(ov), "preview-delete": PREVIEW(), "project-files": ok({ rows: [], nextCursor: null, total: 0 }) });
  await click(find(byClass(page.tree(), "adm-acct")[0], (n) => hasClass(n, "adm-acct-head")));
  const alice = byClass(page.tree(), "adm-acct")[0];
  assert.match(text(alice), /Review & delete covers the whole project, including files other accounts uploaded\./);
  const row = find(alice, (n) => hasClass(n, "adm-row") && n.props.role === "button");
  assert.equal(text(find(row, (n) => hasClass(n, "c-files"))), "11 of 13 files", "this account's share of the project");
  const review = button(row, /^Review & delete whole project$/);
  assert.ok(review);
  // Enter on the button: the button acts, the row behind it does not also open the detail
  row.props.onKeyDown({ key: "Enter", target: review, currentTarget: row, preventDefault(){} }); await settle();
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-detail")), null, "no detail drawer behind the sheet");
  row.props.onKeyDown({ key: "Enter", target: row, currentTarget: row, preventDefault(){} }); await settle();
  assert.ok(find(page.tree(), (n) => hasClass(n, "adm-detail")), "Enter on the row itself opens it");
  await page.key("Escape");
  await click(button(page.tree(), /^Projects$/));
  const prow = find(page.tree(), (n) => hasClass(n, "adm-row") && /Deleted project · eeeeeeee/.test(text(n)) && n.props.onClick);
  prow.props.onKeyDown({ key: "Enter", target: checkboxes(prow)[0], currentTarget: prow, preventDefault(){} }); await settle();
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-detail")), null, "Enter on a checkbox doesn't open the detail");
  prow.props.onKeyDown({ key: " ", target: prow, currentTarget: prow, preventDefault(){} }); await settle();
  assert.ok(find(page.tree(), (n) => hasClass(n, "adm-detail")), "Space on the row opens it, like a button");
});
await test("review sheet takes focus when it opens; Tab stays inside it (and inside the page)", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()), "preview-delete": PREVIEW() });
  await click(find(byClass(page.tree(), "adm-acct")[0], (n) => hasClass(n, "adm-acct-head")));
  await click(button(page.tree(), /Review & delete/));
  const sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.ok(page.rt.focused && hasClass(page.rt.focused, "adm-sheet") && page.rt.focused.props.role === "alertdialog", "focus moved into the alertdialog");
  assert.equal(sh.props.tabIndex, -1);
  const dlg = find(page.tree(), (n) => n.props.role === "dialog");
  assert.equal(typeof dlg.props.onKeyDown, "function", "the page traps Tab");
  // trapTab over a fake container: wraps both ways, pulls stray focus back in
  const mk = (name) => ({ name, focus(){ doc.activeElement = this; } });
  const [a, b, c] = [mk("a"), mk("b"), mk("c")];
  const box = { querySelectorAll: () => [a, b, c], contains: (el) => [a, b, c].includes(el), focus(){ doc.activeElement = box; } };
  const doc = { activeElement: c };
  const tab = (shift) => { let prevented = false; const moved = lib.trapTab({ key: "Tab", shiftKey: shift, preventDefault(){ prevented = true; } }, box, doc); return [moved, prevented]; };
  same(tab(false), [true, true]); assert.equal(doc.activeElement, a, "Tab on the last control wraps to the first");
  same(tab(true), [true, true]); assert.equal(doc.activeElement, c, "Shift+Tab on the first wraps to the last");
  doc.activeElement = b; same(tab(false), [false, false], "inside the list the browser moves focus");
  doc.activeElement = { name: "app underneath" }; tab(false); assert.equal(doc.activeElement, a, "focus outside is pulled back in");
  assert.equal(lib.trapTab({ key: "Escape" }, box, doc), false);
});
await test("a dropped connection during a delete says so; a project that reappears mid-run shows what was already deleted", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()), "preview-delete": PREVIEW(), runs: ok({ runs: [] }),
    delete: { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } } });
  const reviewAndDelete = async () => {
    await click(button(page.tree(), /Review & delete/));
    find(find(page.tree(), (n) => hasClass(n, "adm-sheet")), (n) => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } });
    await settle();
    await click(button(find(page.tree(), (n) => hasClass(n, "adm-sheet")), /^Delete 12 files$/));
    return find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  };
  await click(find(byClass(page.tree(), "adm-acct")[0], (n) => hasClass(n, "adm-acct-head")));
  let sh = await reviewAndDelete();
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-banner"))), "Lost the connection to the server. History shows whether anything was deleted.");
  assert.doesNotMatch(text(sh), /isn't deployed/, "the function answered before, so it is deployed");
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 0 of 12.", "a project delete keeps its line (only temp runs changed, 2026-09-28)");
  await click(button(sh, /^Close$/));
  page.srv.routes.delete = httpErr(409, "project_live", { ids: [PD1],
    result: { runId: U("7"), status: "partial", planned: 450, removed: 200, removedBytes: 200 * MB, alreadyGone: 0, skipped: { count: 0, byStatus: {} }, failed: { count: 0, sample: [] }, remaining: 250 } });
  sh = await reviewAndDelete();
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 200 of 450.", "the server's counts, not 0");
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-banner"))), "One of these projects exists again, so deleting stopped. 200 files had already been deleted. Refresh.");
  assert.equal(button(sh, /^(Retry failed|Try again)/), null);
});

/* ── 6. History: statuses, Resume, Interrupted, item pages ─────────────── */
await test("History: reviews hidden by default, status chips, Resume asks first (danger), expandable items, Load more", async () => {
  const base = { admin_email: "admin@infinitestudioai.com", project_ids: [PD1, PD2], planned_files: 12, planned_bytes: 1.2 * GB, kept_files: 9,
    removed_files: 0, removed_bytes: 0, already_gone: 0, skipped_files: 0, failed_files: 0, created_at: iso(3600e3), started_at: null,
    finished_at: null, preview_expires_at: iso(-600e3), lease_expires_at: null, last_error: null, interrupted: false, preview_expired: false };
  const run = (id, o) => Object.assign({}, base, { id, action: "delete-deleted-project-files" }, o);
  const runs = [
    run(U("1"), { status: "done", removed_files: 12, removed_bytes: 1.2 * GB }),
    run(U("2"), { status: "partial", removed_files: 10, removed_bytes: GB, failed_files: 2, last_error: "Service Unavailable" }),
    run(U("3"), { status: "running", interrupted: true, removed_files: 4 }),
    run(U("4"), { status: "previewed", preview_expired: true }),
    run(U("5"), { status: "previewed" }),
    run(U("6"), { status: "done", action: "drain-cleanup-queue", admin_email: "cron", project_ids: [], removed_files: 30, removed_bytes: 30 * MB }),
    run(U("8"), { status: "running", interrupted: false }),
  ];
  const older = run(U("9"), { status: "partial", removed_files: 1, created_at: iso(90 * 86400000) });
  const resumed = deferred();
  const page = await openPage({ overview: ok(OVERVIEW()),
    runs: (b) => {
      if (b.runId) return ok({ run: runs[1], outcomes: { failed: 2, removed: 10, kept: 9 }, outcome: b.outcome, nextCursor: null,
        items: b.outcome === "failed" ? [{ path: A + "/" + PD1 + "/character/c1/x.png", project_id: PD1, bytes: MB, outcome: "failed", detail: "Service Unavailable", attempts: 2 }] : [] });
      if (b.cursor) return ok({ runs: [older], nextCursor: null });
      const list = b.reviews ? runs : runs.filter((r) => r.status !== "previewed" && r.status !== "expired");
      return ok({ runs: list, nextCursor: "2026-09-27 01:00:00+00|" + U("8") });
    },
    delete: () => resumed.promise });
  await click(button(page.tree(), /^History$/));
  same(page.srv.calls.at(-1), { action: "runs", limit: 50, reviews: false }, "reviews that were never run are left out by default");
  const chipOf = (r) => text(find(r, (n) => hasClass(n, "c-state")));
  same(byClass(page.tree(), "adm-run").map(chipOf), ["Done", "Partial", "Interrupted", "Done", "Running"]);
  await click(button(page.tree(), /^Include reviews not run$/));
  same(page.srv.calls.at(-1), { action: "runs", limit: 50, reviews: true });
  let rows = byClass(page.tree(), "adm-run");
  same(rows.map(chipOf), ["Done", "Partial", "Interrupted", "Expired", "Reviewed, not run", "Done", "Running"]);
  assert.match(text(rows[0]), /Deleted files of 2 deleted projects/);
  assert.match(text(rows[3]), /Review of 2 deleted projects \(not run\)/, "a review that was never run doesn't say 'Deleted'");
  assert.match(text(rows[4]), /Review of 2 deleted projects \(not run\)/);
  assert.match(text(rows[0]), /12 of 12 · 1\.2 GB/);
  assert.match(text(rows[5]), /Cleanup queue \(scheduled\)/);
  same(rows.map((r) => !!button(r, /^Resume$/)), [false, true, true, false, false, false, false]);
  assert.ok(hasClass(button(rows[1], /^Resume$/), "danger"), "Resume is styled as the destructive action it is");
  await click(find(rows[1], (n) => hasClass(n, "adm-row")));
  same(page.srv.calls.at(-1), { action: "runs", runId: U("2"), outcome: "failed" });
  let open = byClass(page.tree(), "adm-run")[1];
  assert.match(text(open), /Failed \(2\)/);
  assert.match(text(open), /Service Unavailable/);
  await click(button(open, /^Skipped/));
  same(page.srv.calls.at(-1), { action: "runs", runId: U("2"), outcome: "skipped" });
  assert.match(text(byClass(page.tree(), "adm-run")[1]), /Nothing skipped\./);
  // Enter on Resume belongs to the button, not to the row around it
  const row2 = find(byClass(page.tree(), "adm-run")[2], (n) => hasClass(n, "adm-row"));
  row2.props.onKeyDown({ key: "Enter", target: button(row2, /^Resume$/), currentTarget: row2, preventDefault(){} }); await settle();
  assert.equal(byClass(page.tree(), "adm-run")[2].props.className.includes("open"), false, "the row did not expand");
  // Resume asks first: nothing is deleted until the admin confirms
  await click(button(byClass(page.tree(), "adm-run")[2], /^Resume$/));
  assert.equal(page.srv.count("delete"), 0, "one click on Resume deletes nothing");
  let confirmBox = find(byClass(page.tree(), "adm-run")[2], (n) => hasClass(n, "adm-confirm"));
  assert.match(text(confirmBox), /^Resume deleting up to 8 files from 2 deleted projects\? Each file is checked again right before it is deleted/);
  await click(button(confirmBox, /^Cancel$/));
  assert.equal(find(byClass(page.tree(), "adm-run")[2], (n) => hasClass(n, "adm-confirm")), null);
  assert.equal(page.srv.count("delete"), 0);
  await click(button(byClass(page.tree(), "adm-run")[2], /^Resume$/));
  confirmBox = find(byClass(page.tree(), "adm-run")[2], (n) => hasClass(n, "adm-confirm"));
  assert.ok(hasClass(button(confirmBox, /^Resume deleting$/), "danger"));
  await click(button(confirmBox, /^Resume deleting$/));
  same(page.srv.calls.at(-1), { action: "delete", runId: U("3") });
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-sheet"))), /Deleting… 0 of 12/);
  assert.equal(button(byClass(page.tree(), "adm-run")[1], /^Resume$/).props.disabled, true, "no second Resume while one is deleting");
  resumed.resolve(DEL({ runId: U("3"), status: "done", removed: 12, removedBytes: 1.2 * GB, remaining: 0, leftInProjects: {} }));
  await settle();
  const sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 12 files · 1.2 GB freed.");
  assert.match(text(sh), /Nothing left to delete in these projects\./);
  assert.ok(page.srv.count("runs") >= 5, "History reloads after the run");
  await click(button(sh, /^Close$/));
  // older runs stay reachable: Load more pages on with the server's cursor
  await click(button(page.tree(), /^Load more$/));
  same(page.srv.calls.at(-1), { action: "runs", limit: 50, reviews: true, cursor: "2026-09-27 01:00:00+00|" + U("8") });
  rows = byClass(page.tree(), "adm-run");
  assert.equal(rows.length, 8);
  assert.ok(button(rows[7], /^Resume$/), "a 90-day-old Partial run can still be resumed");
  assert.equal(button(page.tree(), /^Load more$/), null);
  const empty = await openPage({ overview: ok(OVERVIEW()), runs: ok({ runs: [] }) });
  await click(button(empty.tree(), /^History$/));
  assert.match(text(empty.tree()), /No deletions yet\./);
});

/* ── 7. Cleanup queue: table, stuck list, manual drain ─────────────────── */
await test("Cleanup queue: by reason, stuck list, inline confirm, drain result (manual, no schedule)", async () => {
  const page = await openPage({ overview: ok(OVERVIEW()), runs: ok({ runs: [] }),
    "drain-queue": ok({ runId: U("9"), status: "done", claimed: 42, removed: 30, removedBytes: 30 * MB, alreadyGone: 4, keptReferenced: 1, held: 2, heldGrace: 1, heldUpload: 1, failed: 0, notQueued: 0, stillQueued: 5 }) });
  await click(button(page.tree(), /^Cleanup$/));
  let t = page.tree();
  assert.equal(text(find(find(t, (n) => n.props["aria-label"] === "Cleanup queue"), (n) => hasClass(n, "adm-group-h"))), "Cleanup queue", "the queue keeps its name as the section heading");
  const q = find(t, (n) => hasClass(n, "adm-queue"));
  assert.match(text(q), /Abandoned upload/);
  assert.match(text(q), /Project deleted/);
  assert.match(text(t), /Stuck \(1\)/);
  assert.match(text(t), new RegExp(A + "/" + PD1 + "/character/c1/1-sheet\\.png"));
  assert.match(text(t), /Storage 503/);
  await click(button(t, /^Run cleanup now$/));
  t = page.tree();
  assert.match(text(find(t, (n) => hasClass(n, "adm-confirm"))),
    /^Remove up to 3 queued uploads that are ready\? Each is checked first: anything still in use is kept, and uploads abandoned less than 24 hours ago in live projects wait\./);
  await click(button(t, /^Run cleanup$/));
  same(page.srv.calls.find((c) => c.action === "drain-queue"), { action: "drain-queue", max: 3 });
  assert.equal(text(find(page.tree(), (n) => hasClass(n, "adm-result"))),
    "Removed 30 · already gone 4 · kept (in use) 1 · waiting (24 h) 1 · upload in progress 1 · failed 0 · still queued 5",
    "a live re-upload is not reported as a 24 h wait");
  const off = await openPage({ overview: ok(OVERVIEW({ setup: SETUP({ drainEnabled: false }, { queueWorker: false }) })) });
  assert.match(text(find(off.tree(), (n) => hasClass(n, "adm-setup"))), /worker functions are missing/);
  await click(button(off.tree(), /^Cleanup$/));
  assert.equal(button(off.tree(), /^Run cleanup now$/).props.disabled, true);
  const busy = await openPage({ overview: ok(OVERVIEW()), "drain-queue": httpErr(409, "run_busy") });
  await click(button(busy.tree(), /^Cleanup$/));
  await click(button(busy.tree(), /^Run cleanup now$/));
  await click(button(busy.tree(), /^Run cleanup$/));
  assert.match(text(busy.tree()), /A cleanup run is already in progress\. It will show in History\./);
  assert.ok(!/cron|schedule/i.test(ADMIN_CODE.replace(/"Cleanup queue \(scheduled\)"/, "").replace(/admin_email === "cron"/, "")),
    "the page never schedules anything");
});

/* ── 7b. Clear old temp files (2026-09-28) ─────────────────────────────── */
const TEMP_RUN = U("5");
const TEMP_PREVIEW = (over = {}) => ok(Object.assign({ version: "admin-storage@2026-09-28.1",
  runId: TEMP_RUN, plannedFiles: 1905, plannedBytes: 159 * MB, keptFiles: 0, keptByDetail: {}, accounts: 1,
  oldest: iso(20 * 86400000), newest: iso(2 * 86400000), moreRemain: 0,
  previewExpiresAt: new Date(Date.now() + 15 * 60000).toISOString(), cutoffHours: 24 }, over));
const CLEAR = (o) => ok(Object.assign({ version: "admin-storage@2026-09-28.1", runId: TEMP_RUN, status: "partial", planned: 1905,
  removed: 0, removedBytes: 0, alreadyGone: 0, skipped: { count: 0, byStatus: {} }, failed: { count: 0, sample: [] }, remaining: 1905 }, o));
const TEMP_BIG = { files: 1910, bytes: 160 * MB, oldFiles: 1905, oldBytes: 159 * MB, accounts: 1, oldest: iso(20 * 86400000), cutoffHours: 24 };
// what a server from before 2026-09-28 sends: no overview.temp, no tempEnabled, no temp_action
function OLD_OVERVIEW(){
  const ov = OVERVIEW();
  delete ov.temp; delete ov.setup.tempEnabled; delete ov.setup.setup.temp_action;
  return ov;
}
const tempSection = (t) => find(t, (n) => n.props["aria-label"] === "Old temp files");
const tempButton = (t) => button(tempSection(t), /^(Clear old temp files|Checking temp files…)$/);

await test("temp helpers: error copy, why the button is off, stats, confirm / empty / result lines, History labels", () => {
  const M = lib.MSG;
  const e = (status, code, extra, ctx, message) => lib.errorMessage({ status, code, message: message || "x", extra: extra || {} }, ctx);
  assert.equal(M.tempOff, "Clearing temp files is off until supabase/admin-storage.sql is run again in the SQL Editor.");
  assert.equal(e(412, "temp_action_missing", {}, "temp"), M.tempOff);
  assert.equal(e(412, "temp_action_missing"), M.tempOff, "whatever the context");
  const started = new Date(2026, 8, 28, 14, 2, 0).toISOString();
  assert.equal(e(409, "run_busy", { startedAt: started }, "temp"), "Temp files are already being cleared (started 14:02). Wait for that to finish; it will show in History.");
  assert.equal(e(409, "run_busy", {}, "temp"), "Temp files are already being cleared. Wait for that to finish; it will show in History.");
  assert.equal(e(409, "run_busy", { startedAt: started }), "This delete is already running (started 14:02). It will show in History.", "a project delete keeps its copy");
  assert.equal(e(409, "preview_expired", {}, "temp"), "This review expired. Review again.");
  assert.equal(e(409, "temp_interrupted", { startedAt: started, runId: TEMP_RUN, plannedFiles: 3 }, "temp"), "An earlier clear of old temp files was interrupted (started 14:02). Resume it in History first.");
  assert.equal(e(409, "temp_interrupted", {}), "An earlier clear of old temp files was interrupted. Resume it in History first.");
  assert.equal(e(409, "run_not_found", {}, "temp"), "That run no longer exists. Refresh History.");
  assert.equal(e(400, "bad_request", {}, "temp", "Unknown action."), "The admin-storage function needs updating before temp files can be cleared.");
  assert.equal(e(400, "bad_request", {}, undefined, "Unknown action."), "The server refused the request: Unknown action.", "only the temp flow reads it as an older server");
  assert.equal(e(400, "bad_request", {}, "temp", "runId must be a uuid."), "The server refused the request: runId must be a uuid.");

  const why = (over, flags, temp) => lib.tempBlockReason(SETUP(over, flags), temp);
  const T = { oldFiles: 3, oldBytes: MB, accounts: 1, cutoffHours: 24 };
  assert.equal(why({}, {}, T), "", "a full reader, the audit log, the upgraded check and old files: on");
  assert.equal(why({ seesAll: false, deleteEnabled: false, tempEnabled: false }, { temp_action: false }, T), M.notFullReader, "not a full reader comes first");
  assert.equal(why({ deleteEnabled: false, tempEnabled: false }, { audit: false, temp_action: false }, T), M.auditOff);
  assert.equal(why({ tempEnabled: false }, { temp_action: false }, T), M.tempOff);
  assert.equal(why({}, {}, Object.assign({}, T, { oldFiles: 0 })), "Nothing to clear yet.");
  assert.equal(why({}, {}, undefined), M.tempUpdate, "no overview.temp: an older server");
  const old = SETUP(); delete old.tempEnabled; delete old.setup.temp_action;
  assert.equal(lib.tempBlockReason(old, T), M.tempUpdate);

  assert.match(lib.tempStatsLine(TEMP_BIG), /^1,905 files · 159 MB older than 24 hours, in 1 account\. Oldest [A-Z][a-z]{2} \d{1,2}, \d\d:\d\d\.$/);
  assert.equal(lib.tempStatsLine(Object.assign({}, TEMP_BIG, { oldFiles: 1, oldBytes: 2 * MB, accounts: 2, oldest: null })), "1 file · 2 MB older than 24 hours, in 2 accounts.");
  assert.equal(lib.tempStatsLine({ oldFiles: 0, oldBytes: 0, accounts: 0, cutoffHours: 24 }), "No old temp files to clear.");

  const pv = (o) => TEMP_PREVIEW(o).data;
  assert.equal(lib.tempConfirmText(pv()), "Delete 1,905 temporary files (159 MB)? They were staged more than 24 hours ago, have expired, and no project uses them. Each file is checked again just before it's deleted. This can't be undone.");
  assert.equal(lib.tempConfirmText(pv({ plannedFiles: 1, plannedBytes: 2 * MB })), "Delete 1 temporary file (2 MB)? It was staged more than 24 hours ago, has expired, and no project uses it. Each file is checked again just before it's deleted. This can't be undone.");
  assert.equal(lib.tempKeptLine({ "held: changed in the last 24 hours": 1, "held: upload in progress": 2, "surprise": 1 }), "2 still uploading, 1 changed in the last 24 hours, 1 kept for another reason");
  assert.equal(lib.tempKeptLine({ "held: in an interrupted clear": 4 }), "4 waiting for an interrupted clear (resume it in History)");
  assert.equal(lib.tempEmptyText(pv({ plannedFiles: 0, plannedBytes: 0 })), "Nothing to delete right now.");
  assert.equal(lib.tempEmptyText(pv({ plannedFiles: 0, plannedBytes: 0, keptFiles: 1, keptByDetail: { "no longer in storage": 1 } })), "Nothing to delete right now. 1 old temp file is held back: 1 already gone.");
  assert.equal(lib.tempResultLine(CLEAR({ status: "done", removed: 1905, removedBytes: 159 * MB, remaining: 0 }).data), "Removed 1,905 · 159 MB · already gone 0 · kept 0 · failed 0");
  assert.equal(lib.tempResultLine(CLEAR({ removed: 10, removedBytes: 10 * MB, alreadyGone: 1, skipped: { count: 2, byStatus: {} }, failed: { count: 3, sample: [] }, remaining: 1892 }).data),
    "Removed 10 · 10 MB · already gone 1 · kept 2 · failed 3. Stopped early.");
  // Try again carries on with the same run, unless the answer says it can't
  const tr = (o) => lib.tempCanRetry(Object.assign({ phase: "result", result: { status: "partial", remaining: 5 } }, o));
  assert.equal(tr({}), true);
  assert.equal(tr({ error: { code: "run_busy" } }), true, "busy / timeout / dropped: try the same run again");
  assert.equal(tr({ error: { code: "timeout" } }), true);
  for (const code of ["preview_expired", "temp_interrupted", "run_not_found", "temp_action_missing", "bad_request"]) assert.equal(tr({ error: { code } }), false, code);
  assert.equal(tr({ result: { status: "done" } }), false);
  assert.equal(tr({ phase: "error" }), false);
  assert.equal(lib.tempCanRetry(null), false);
  // the Accounts tab's temp-folder row
  const svcRow = (label, safe) => ({ label, files: 3, bytes: 3 * MB, safe_files: safe });
  assert.equal(lib.serviceNote(svcRow("Temporary image files (*/stage-tmp)", 3), TEMP_BIG), "1,905 older than 24 hours · clear them in Cleanup");
  assert.equal(lib.serviceNote(svcRow("Temporary image files (*/stage-tmp)", 3), Object.assign({}, TEMP_BIG, { oldFiles: 0 })), "none older than 24 hours");
  assert.equal(lib.serviceNote(svcRow("Temporary image files (*/stage-tmp)", 3), undefined), "3 expired · kept", "an older server: as before");
  assert.equal(lib.serviceNote(svcRow("Relay security markers (_internal)", 0), TEMP_BIG), "kept");
  assert.equal(lib.serviceNote(svcRow("Relay security markers (_internal)", 2), TEMP_BIG), "2 expired · kept");

  const run = (o) => Object.assign({ id: TEMP_RUN, action: "clear-old-temp-files", project_ids: [], planned_files: 1905, planned_bytes: 159 * MB,
    removed_files: 0, removed_bytes: 0, already_gone: 0, skipped_files: 0, failed_files: 0 }, o);
  assert.equal(lib.runWhat(run({ status: "done" })), "Cleared old temp files");
  assert.equal(lib.runWhat(run({ status: "partial" })), "Cleared old temp files");
  assert.equal(lib.runWhat(run({ status: "previewed" })), "Review of old temp files (not run)");
  assert.equal(lib.runWhat(run({ status: "expired" })), "Review of old temp files (not run)");
  assert.equal(lib.runResult(run({ status: "done", removed_files: 1905, removed_bytes: 159 * MB })), "1,905 of 1,905 · 159 MB");
  assert.equal(lib.runResult(run({ status: "previewed" })), "1,905 files planned · 159 MB");
  assert.equal(lib.canResume(run({ status: "partial" })), true, "a partial temp run resumes");
  assert.equal(lib.canResume(run({ status: "running", interrupted: true })), true);
  assert.equal(lib.canResume(run({ status: "done" })), false);
  assert.equal(lib.canResume(run({ status: "partial", action: "drain-cleanup-queue" })), false, "a queue drain never resumes");
});

await test("the Old temp files tile: count · size, 'none' at zero; an older server keeps the four tiles", async () => {
  let page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })) });
  let tiles = byClass(page.tree(), "adm-tile").map(text);
  assert.equal(tiles.length, 5);
  assert.equal(tiles[4], "Old temp files1,905 · 159 MBolder than 24 hours");
  const row = find(page.tree(), (n) => hasClass(n, "adm-tiles"));
  assert.equal(row.props.style.gridTemplateColumns, "repeat(auto-fit,minmax(130px,1fr))", "five tiles share one row; 2 across at phone width");
  page = await openPage({ overview: ok(OVERVIEW({ temp: { files: 4, bytes: 4 * MB, oldFiles: 0, oldBytes: 0, accounts: 1, oldest: iso(3600e3), cutoffHours: 24 } })) });
  assert.equal(byClass(page.tree(), "adm-tile").map(text)[4], "Old temp files0 · 0 Bnone");
  page = await openPage({ overview: ok(OLD_OVERVIEW()) });
  tiles = byClass(page.tree(), "adm-tile").map(text);
  assert.equal(tiles.length, 4, "no temp summary: no tile");
  assert.equal(find(page.tree(), (n) => hasClass(n, "adm-tiles")).props.style, undefined, "…and the stylesheet's grid");
});

await test("Cleanup tab: the queue, then Old temp files with its stats; each reason the button is off shows beside it", async () => {
  const page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })) });
  await click(button(page.tree(), /^Cleanup$/));
  let t = page.tree();
  const sections = findAll(t, (n) => n.type === "section").map((n) => n.props["aria-label"]);
  same(sections, ["Cleanup queue", "Old temp files"], "the queue section first");
  const sec = tempSection(t);
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-group-h"))), "Old temp files");
  assert.match(text(sec), /Images and videos Kinolot staged for AI generation\. They expire after 2 hours, and no project uses them\./);
  assert.match(text(sec), /1,905 files · 159 MB older than 24 hours, in 1 account\. Oldest /);
  const btn = tempButton(t);
  assert.ok(btn && hasClass(btn, "adm-btn") && hasClass(btn, "danger"));
  assert.equal(btn.props.disabled, false);

  const CASES = [
    ["not a full reader", SETUP({ seesAll: false, deleteEnabled: false, drainEnabled: false, tempEnabled: false }), TEMP_BIG, lib.MSG.notFullReader],
    ["audit off", SETUP({ deleteEnabled: false, drainEnabled: false, tempEnabled: false }, { audit: false }), TEMP_BIG, lib.MSG.auditOff],
    ["temp action missing", SETUP({ tempEnabled: false }, { temp_action: false }), TEMP_BIG, "Clearing temp files is off until supabase/admin-storage.sql is run again in the SQL Editor."],
    ["nothing old", SETUP(), Object.assign({}, TEMP_BIG, { oldFiles: 0, oldBytes: 0 }), "Nothing to clear yet."],
    ["older server", null, undefined, "The admin-storage function needs updating before temp files can be cleared."],
  ];
  for (const [name, setup, temp, reason] of CASES) {
    const ov = setup ? OVERVIEW({ setup, temp }) : OLD_OVERVIEW();
    const p = await openPage({ overview: ok(ov), "preview-clear-temp": TEMP_PREVIEW() });
    await click(button(p.tree(), /^Cleanup$/));
    const s2 = tempSection(p.tree());
    const b = tempButton(p.tree());
    assert.equal(b.props.disabled, true, name + ": off");
    assert.equal(b.props.title, reason, name + ": the reason on hover");
    assert.equal(text(find(find(s2, (n) => hasClass(n, "adm-drain-row")), (n) => hasClass(n, "adm-muted"))), reason, name + ": …and visible beside it (phones)");
    b.props.onClick(evt(b)); await settle();
    assert.equal(p.srv.count("preview-clear-temp"), 0, name + ": a click does nothing");
    if (name === "nothing old") assert.match(text(s2), /No old temp files to clear\./);
    if (name === "older server") assert.doesNotMatch(text(s2), /older than 24 hours/, "no stats without a summary");
  }
});

await test("Clear old temp files asks first: the confirm copy, 'more will remain', held-back files, Cancel, and a review with nothing to delete", async () => {
  const page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": TEMP_PREVIEW(), "clear-temp": CLEAR({ status: "done" }) });
  await click(button(page.tree(), /^Cleanup$/));
  await click(tempButton(page.tree()));
  same(page.srv.calls.at(-1), { action: "preview-clear-temp" }, "the review sends the action and nothing else");
  let box = find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm"));
  assert.ok(box, "an inline confirm, like the queue's");
  assert.equal(text(box.children[0]), "Delete 1,905 temporary files (159 MB)? They were staged more than 24 hours ago, have expired, and no project uses them. Each file is checked again just before it's deleted. This can't be undone.");
  assert.doesNotMatch(text(box), /more will remain|Not included/);
  same(findAll(find(box, (n) => hasClass(n, "adm-sheet-acts")), (n) => n.type === "button").map(text), ["Cancel", "Delete temp files"]);
  assert.ok(hasClass(button(box, /^Delete temp files$/), "danger"));
  assert.equal(tempButton(page.tree()), null, "the confirm replaces the button");
  await click(button(box, /^Cancel$/));
  assert.equal(find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm")), null);
  assert.equal(tempButton(page.tree()).props.disabled, false, "back to the button");
  assert.equal(page.srv.count("clear-temp"), 0, "Cancel deletes nothing");

  page.srv.routes["preview-clear-temp"] = TEMP_PREVIEW({ plannedFiles: 5000, plannedBytes: 400 * MB, moreRemain: 12, keptFiles: 3,
    keptByDetail: { "held: upload in progress": 2, "held: changed in the last 24 hours": 1 } });
  await click(tempButton(page.tree()));
  box = find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm"));
  assert.match(text(box), /^Delete 5,000 temporary files \(400 MB\)\?/);
  assert.match(text(box), /12 more will remain — run it again afterwards\./);
  assert.match(text(box), /Not included: 2 still uploading, 1 changed in the last 24 hours\./);
  await click(button(box, /^Cancel$/));

  page.srv.routes["preview-clear-temp"] = TEMP_PREVIEW({ plannedFiles: 0, plannedBytes: 0, keptFiles: 2, keptByDetail: { "held: in the cleanup queue": 2 }, oldest: null, newest: null });
  await click(tempButton(page.tree()));
  const sec = tempSection(page.tree());
  assert.equal(button(sec, /^Delete temp files$/), null, "nothing planned: no Delete offered");
  assert.equal(find(sec, (n) => hasClass(n, "adm-confirm")), null);
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-note"))), "Nothing to delete right now. 2 old temp files are held back: 2 queued for cleanup.");
  assert.equal(tempButton(page.tree()).props.disabled, false);
  assert.equal(page.srv.count("clear-temp"), 0);
});

await test("the temp confirm counts down to the review's expiry; once expired, Delete is off and Review again reviews anew", async () => {
  const page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": TEMP_PREVIEW({ previewExpiresAt: new Date(Date.now() + 5 * 60000 + 30000).toISOString() }),
    "clear-temp": CLEAR({ status: "done" }) });
  await click(button(page.tree(), /^Cleanup$/));
  await click(tempButton(page.tree()));
  let box = find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm"));
  assert.match(text(find(box, (n) => hasClass(n, "adm-expiry"))), /^This review expires in 5:(29|30)$/);
  assert.equal(button(box, /^Delete temp files$/).props.disabled, false);
  assert.ok([...page.intervals.values()].some((i) => i.ms === 1000), "a 1 s tick while the confirm is open");
  // the review runs out while the confirm is open
  page.srv.routes["preview-clear-temp"] = TEMP_PREVIEW({ previewExpiresAt: new Date(Date.now() - 1000).toISOString() });
  await click(button(box, /^Cancel$/));
  await click(tempButton(page.tree()));
  box = find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm"));
  assert.equal(find(box, (n) => hasClass(n, "adm-expiry")), null);
  assert.match(text(find(box, (n) => hasClass(n, "adm-banner"))), /^This review expired\. Review again\./);
  const del = button(box, /^Delete temp files$/);
  assert.equal(del.props.disabled, true, "an expired review can't run");
  del.props.onClick(evt(del)); await settle();
  assert.equal(page.srv.count("clear-temp"), 0);
  const reviews = page.srv.count("preview-clear-temp");
  page.srv.routes["preview-clear-temp"] = TEMP_PREVIEW();
  await click(button(box, /^Review again$/));
  assert.equal(page.srv.count("preview-clear-temp"), reviews + 1, "Review again asks the server for a new review");
  box = find(tempSection(page.tree()), (n) => hasClass(n, "adm-confirm"));
  assert.match(text(find(box, (n) => hasClass(n, "adm-expiry"))), /^This review expires in 1[45]:\d\d$/);
  await click(button(box, /^Delete temp files$/));
  assert.equal(page.srv.count("clear-temp"), 1);
});

await test("Clear old temp files runs the delete loop: partial → partial → done, progress, busy, tab switch, result line, toast, refresh", async () => {
  const gates = [];
  const page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": TEMP_PREVIEW(),
    "clear-temp": () => { const g = deferred(); gates.push(g); return g.promise; } });
  await click(button(page.tree(), /^Cleanup$/));
  await click(tempButton(page.tree()));
  await click(button(tempSection(page.tree()), /^Delete temp files$/));
  same(page.srv.calls.at(-1), { action: "clear-temp", runId: TEMP_RUN }, "the browser sends only the run id");
  let sec = tempSection(page.tree());
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-progress-lab"))), "Deleting… 0 of 1,905");
  assert.match(text(sec), /History shows where it stopped, and Resume carries on\./);
  const x = find(page.tree(), (n) => n.type === "button" && n.props["aria-label"] === "Close" && hasClass(n, "bible-x"));
  assert.equal(x.props.disabled, true, "no closing the page mid-run");
  assert.equal(button(page.tree(), /^Refresh$/).props.disabled, true);
  assert.equal(button(page.tree(), /^Run cleanup now$/).props.disabled, true, "one destructive step at a time");
  await page.key("Escape");
  assert.equal(page.body.children.length, 1, "Esc doesn't close it either");
  const overviewsBefore = page.srv.count("overview");
  gates[0].resolve(CLEAR({ removed: 800, removedBytes: 60 * MB, remaining: 1105 })); await settle();
  assert.equal(text(find(tempSection(page.tree()), (n) => hasClass(n, "adm-progress-lab"))), "Deleting… 800 of 1,905");
  assert.equal(find(tempSection(page.tree()), (n) => n.props.role === "progressbar").props["aria-valuenow"], 800);
  // the run lives in the modal: another tab and back loses nothing
  await click(button(page.tree(), /^Accounts$/));
  await click(button(page.tree(), /^Cleanup$/));
  assert.equal(text(find(tempSection(page.tree()), (n) => hasClass(n, "adm-progress-lab"))), "Deleting… 800 of 1,905");
  gates[1].resolve(CLEAR({ removed: 1600, removedBytes: 130 * MB, remaining: 305 })); await settle();
  assert.equal(page.srv.count("clear-temp"), 3, "loops while each call makes progress");
  gates[2].resolve(CLEAR({ status: "done", removed: 1900, removedBytes: 158 * MB, alreadyGone: 3,
    skipped: { count: 2, byStatus: { "held: changed in the last 24 hours": 2 } }, remaining: 0 })); await settle();
  assert.equal(page.srv.count("clear-temp"), 3, "done: no more calls");
  sec = tempSection(page.tree());
  const res = find(sec, (n) => hasClass(n, "adm-result"));
  assert.ok(hasClass(res, "ok"));
  assert.equal(text(res), "Removed 1,900 · 158 MB · already gone 3 · kept 2 · failed 0");
  assert.ok(page.toasts.some(([m, k]) => m === "Cleared 1,900 old temp files · 158 MB freed." && k === "success"), "a toast too");
  assert.ok(page.srv.count("overview") > overviewsBefore, "the overview refreshes afterwards");
  assert.equal(find(page.tree(), (n) => n.type === "button" && n.props["aria-label"] === "Close" && hasClass(n, "bible-x")).props.disabled, false, "not busy any more");
  assert.equal(tempButton(page.tree()).props.disabled, false, "and it can run again");
});

await test("a stalled clear stops with 'Stopped early'; busy, expired, switched-off and older-server answers each say so", async () => {
  const stalled = CLEAR({ removed: 100, removedBytes: 8 * MB, failed: { count: 5, sample: [{ path: "x", detail: "Service Unavailable" }] }, remaining: 1805 });
  const page = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": TEMP_PREVIEW(), "clear-temp": stalled });
  await click(button(page.tree(), /^Cleanup$/));
  const reviewAndRun = async () => {
    await click(tempButton(page.tree()));
    const del = button(tempSection(page.tree()), /^Delete temp files$/);
    if (del) await click(del);
    return tempSection(page.tree());
  };
  let sec = await reviewAndRun();
  assert.equal(page.srv.count("clear-temp"), 2, "a call that makes no progress ends the loop");
  let res = find(sec, (n) => hasClass(n, "adm-result"));
  assert.ok(hasClass(res, "amber"));
  assert.equal(text(res), "Removed 100 · 8 MB · already gone 0 · kept 0 · failed 5. Stopped early.");
  assert.ok(page.toasts.some(([m, k]) => m === "Removed 100 of 1,905 old temp files." && k === "error"));
  // 2026-09-28 review: a stopped clear carries on with the SAME run (like the sheet's Retry), not a new review
  assert.equal(tempButton(page.tree()), null, "no new review while the run can carry on");
  const acts = find(sec, (n) => hasClass(n, "adm-temp-retry"));
  same(findAll(acts, (n) => n.type === "button").map(text), ["Close", "Retry failed (5)"]);
  assert.ok(sec.children.find((c) => hasClass(c, "adm-drain")).children.indexOf(res) < sec.children.find((c) => hasClass(c, "adm-drain")).children.indexOf(acts), "the result line, then its buttons");
  const reviews = page.srv.count("preview-clear-temp");
  await click(button(acts, /^Retry failed \(5\)$/));
  assert.equal(page.srv.count("preview-clear-temp"), reviews, "no new review");
  same(page.srv.calls.filter((c) => c.action === "clear-temp").at(-1), { action: "clear-temp", runId: TEMP_RUN }, "the same run id");
  assert.equal(page.srv.count("clear-temp"), 4);
  page.srv.routes["clear-temp"] = CLEAR({ status: "partial", removed: 1900, removedBytes: 150 * MB, remaining: 5 });
  await click(button(find(tempSection(page.tree()), (n) => hasClass(n, "adm-temp-retry")), /^Retry failed \(5\)$/));
  assert.equal(text(button(find(tempSection(page.tree()), (n) => hasClass(n, "adm-temp-retry")), /^Try again/)), "Try again (5 left)");
  await click(button(find(tempSection(page.tree()), (n) => hasClass(n, "adm-temp-retry")), /^Close$/));
  assert.equal(find(tempSection(page.tree()), (n) => hasClass(n, "adm-result")), null, "Close clears the result");
  assert.equal(tempButton(page.tree()).props.disabled, false, "back to a new review");
  page.srv.routes["clear-temp"] = stalled;

  const started = new Date(2026, 8, 28, 14, 2, 0).toISOString();
  page.srv.routes["preview-clear-temp"] = httpErr(409, "run_busy", { startedAt: started });
  sec = await reviewAndRun();
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-banner"))), "Temp files are already being cleared (started 14:02). Wait for that to finish; it will show in History.");
  assert.equal(find(sec, (n) => hasClass(n, "adm-result")), null, "a refused review shows no result line");
  assert.equal(tempButton(page.tree()).props.disabled, false, "and it can be tried again");

  page.srv.routes["preview-clear-temp"] = httpErr(412, "temp_action_missing");
  sec = await reviewAndRun();
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-banner"))), "Clearing temp files is off until supabase/admin-storage.sql is run again in the SQL Editor.");

  page.srv.routes["preview-clear-temp"] = TEMP_PREVIEW();
  page.srv.routes["clear-temp"] = httpErr(409, "preview_expired");
  sec = await reviewAndRun();
  assert.equal(text(find(sec, (n) => hasClass(n, "adm-banner"))), "This review expired. Review again.");
  assert.equal(find(sec, (n) => hasClass(n, "adm-result")), null, "no counts from the server: no made-up result line");

  assert.equal(button(sec, /^(Try again|Retry failed)/), null, "an expired review can't carry on");
  assert.equal(tempButton(page.tree()).props.disabled, false, "…a new review can");

  page.srv.routes["clear-temp"] = httpErr(409, "run_busy", { startedAt: started });
  sec = await reviewAndRun();
  assert.match(text(find(sec, (n) => hasClass(n, "adm-banner"))), /^Temp files are already being cleared \(started 14:02\)/);
  assert.equal(text(button(sec, /^Try again/)), "Try again", "no counts from the server: no made-up count on the button");

  // another clear was interrupted: resume it first (no Try again)
  const p2 = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": httpErr(409, "temp_interrupted", { startedAt: started, runId: U("9"), plannedFiles: 3 }) });
  await click(button(p2.tree(), /^Cleanup$/));
  await click(tempButton(p2.tree()));
  assert.equal(text(find(tempSection(p2.tree()), (n) => hasClass(n, "adm-banner"))), "An earlier clear of old temp files was interrupted (started 14:02). Resume it in History first.");
  assert.equal(tempButton(p2.tree()).props.disabled, false);
  assert.equal(p2.srv.count("clear-temp"), 0);

  // a page newer than the deployed function: the old server doesn't know the action
  const old = await openPage({ overview: ok(OVERVIEW({ temp: TEMP_BIG })), "preview-clear-temp": httpErr(400, "bad_request", { message: "Unknown action." }) });
  await click(button(old.tree(), /^Cleanup$/));
  await click(tempButton(old.tree()));
  assert.equal(text(find(tempSection(old.tree()), (n) => hasClass(n, "adm-banner"))), "The admin-storage function needs updating before temp files can be cleared.");
  assert.equal(old.body.children.length, 1, "no crash: the page stays open");
});

await test("History: temp runs say what they were; a partial one resumes through clear-temp (asks first, temp copy)", async () => {
  const base = { admin_email: "admin@infinitestudioai.com", project_ids: [], planned_files: 1905, planned_bytes: 159 * MB, kept_files: 0,
    removed_files: 0, removed_bytes: 0, already_gone: 0, skipped_files: 0, failed_files: 0, created_at: iso(3600e3), started_at: null,
    finished_at: null, preview_expires_at: iso(-600e3), lease_expires_at: null, last_error: null, interrupted: false, preview_expired: false };
  const run = (id, o) => Object.assign({}, base, { id, action: "clear-old-temp-files" }, o);
  const runs = [
    run(U("1"), { status: "done", removed_files: 1905, removed_bytes: 159 * MB }),
    run(TEMP_RUN, { status: "partial", removed_files: 1000, removed_bytes: 80 * MB, failed_files: 5, last_error: "Service Unavailable" }),
    run(U("3"), { status: "previewed" }),
    run(U("4"), { status: "expired" }),
    run(U("6"), { status: "done", action: "drain-cleanup-queue", admin_email: "admin@infinitestudioai.com", removed_files: 3, removed_bytes: 3 * MB, planned_files: 0 }),
  ];
  const gates = [];
  const page = await openPage({ overview: ok(OVERVIEW()), runs: (b) => b.runId ? ok({ run: runs[1], outcomes: {}, outcome: b.outcome, items: [], nextCursor: null }) : ok({ runs, nextCursor: null }),
    "clear-temp": () => { const g = deferred(); gates.push(g); return g.promise; } });
  await click(button(page.tree(), /^History$/));
  await click(button(page.tree(), /^Include reviews not run$/));
  let rows = byClass(page.tree(), "adm-run");
  same(rows.map((r) => text(find(r, (n) => hasClass(n, "c-title")))),
    ["Cleared old temp files", "Cleared old temp files", "Review of old temp files (not run)", "Review of old temp files (not run)", "Cleanup queue"]);
  same(rows.map((r) => text(find(r, (n) => hasClass(n, "c-result")))),
    ["1,905 of 1,905 · 159 MB", "1,000 of 1,905 · 80 MB", "1,905 files planned · 159 MB", "1,905 files planned · 159 MB", "Removed 3 · 3 MB"]);
  for (const r of rows) assert.doesNotMatch(text(r), /deleted project/, "a temp run never counts projects");
  same(rows.map((r) => !!button(r, /^Resume$/)), [false, true, false, false, false]);
  await click(button(rows[1], /^Resume$/));
  assert.equal(page.srv.count("clear-temp"), 0, "Resume asks first");
  const box = find(byClass(page.tree(), "adm-run")[1], (n) => hasClass(n, "adm-confirm"));
  assert.equal(text(box.children[0]), "Resume clearing up to 905 old temp files? Each file is checked again right before it is deleted, and deleted files can't be recovered.");
  await click(button(box, /^Resume deleting$/));
  same(page.srv.calls.at(-1), { action: "clear-temp", runId: TEMP_RUN }, "a temp run resumes through clear-temp, never delete");
  assert.equal(page.srv.count("delete"), 0);
  assert.match(text(find(page.tree(), (n) => hasClass(n, "adm-sheet"))), /Deleting… 0 of 1,905/);
  const started = new Date(2026, 8, 28, 14, 2, 0).toISOString();
  gates[0].resolve(httpErr(409, "run_busy", { startedAt: started })); await settle();
  let sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-banner"))), "Temp files are already being cleared (started 14:02). Wait for that to finish; it will show in History.", "the sheet speaks of temp files");
  // 2026-09-28 review: the server sent no counts, so no made-up "Deleted 0 of 1,905"
  assert.equal(find(sh, (n) => hasClass(n, "adm-result")), null);
  assert.match(text(sh), /History shows how far it got\./);
  assert.equal(text(button(sh, /^Try again/)), "Try again");
  await click(button(sh, /^Try again/));
  same(page.srv.calls.at(-1), { action: "clear-temp", runId: TEMP_RUN }, "Try again keeps the action");
  gates[1].resolve(CLEAR({ status: "done", removed: 1900, removedBytes: 150 * MB, alreadyGone: 5, remaining: 0 })); await settle();
  sh = find(page.tree(), (n) => hasClass(n, "adm-sheet"));
  assert.equal(text(find(sh, (n) => hasClass(n, "adm-result"))), "Deleted 1,900 files · 150 MB freed.");
  assert.doesNotMatch(text(sh), /these projects/, "no project leftovers line for a temp run");
});

/* ── 8. what the browser sends, markup and wiring ──────────────────────── */
await test("the browser never names a file: bodies carry ids, a run id, or a keyset cursor only", () => {
  // every body the flows above sent went through server(); re-run the invariant over a fresh sweep
  const allowed = { overview: [], "project-files": ["projectId", "cursor"], "preview-delete": ["projectIds"], delete: ["runId"],
    runs: ["limit", "reviews", "runId", "outcome", "cursor"], "drain-queue": ["max"],
    "preview-clear-temp": [], "clear-temp": ["runId"] };
  const src = ADMIN_CODE;
  // + the run loop's requests (RUN_CALL: "delete" / "clear-temp" -> a run id only)
  const bodies = [...src.matchAll(/callAdminStorage\(([^)]*\{[^}]*\})/g), ...src.matchAll(/const body = (\{[^}]*\})/g),
    ...src.matchAll(/=> \((\{ action:"[^}]*\})\)/g)].map((m) => m[1]);
  assert.ok(bodies.length >= 9, "call sites found");
  for (const a of ["preview-clear-temp", "clear-temp", "delete"]) assert.ok(bodies.some((b) => b.includes('action:"' + a + '"')), a + " body checked");
  // every other argument is a known builder: the loop's call(runId), a cursor ternary, or a `const body` checked above
  const named = new Set([...src.matchAll(/callAdminStorage\(([a-zA-Z]+)/g)].map((m) => m[1]));
  same([...named].sort(), ["body", "call", "cursor"]);
  for (const m of src.matchAll(/body\.([a-zA-Z]+) = /g)) assert.equal(m[1], "cursor", "a body built in steps only adds a keyset cursor");
  for (const b of bodies) {
    const action = (b.match(/action:"([a-z-]+)"/) || [])[1];
    assert.ok(action in allowed, "known action " + action);
    const keys = [...b.matchAll(/([a-zA-Z]+):/g)].map((m) => m[1]).filter((k) => k !== "action");
    for (const k of keys) assert.ok(allowed[action].includes(k), action + " sends only " + allowed[action] + " (saw " + k + ")");
  }
  assert.ok(!/\.remove\(|storage\.from\(|\.list\(/.test(src), "no Storage API call from the browser");
  assert.equal((src.match(/sb\.functions\.invoke\(/g) || []).length, 1, "one invoke site");
  assert.ok(src.includes('const FN = "admin-storage"'));
});
await test("styles: the .adm-* block uses existing tokens only, phone rules and the neutral admin menu item", () => {
  const css = read("app/styles.css");
  const at = css.lastIndexOf("/*", css.indexOf("ADMIN STORAGE PAGE (app/admin-storage.jsx)"));
  assert.ok(at > 0, "the block is appended");
  // the block runs to the next section appended after it (the homepage-style rooms, 2026-10-16)
  const next = css.indexOf("HOMEPAGE STYLE \u2014 the rooms", at);
  const block = css.slice(at, next > at ? css.lastIndexOf("/*", next) : undefined);
  const root = css.slice(css.indexOf(":root {"), css.indexOf("color-scheme:dark;"));
  const defined = new Set([...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  const used = new Set([...block.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
  for (const v of used) assert.ok(defined.has(v), "token " + v + " exists in :root");
  assert.ok(!/data-theme/.test(block.replace(/\/\*[\s\S]*?\*\//g, "")), "no theme-specific overrides needed");
  assert.match(block, /\.acct-upgrade\.acct-admin\{background:var\(--bg-2\);border-color:var\(--line-2\)/);
  assert.match(block, /\.bible-modal\.adm-storage\{position:relative;width:min\(1100px,96vw\);height:90vh/);
  const phone = block.slice(block.indexOf("@media (max-width:640px)"));
  assert.ok(phone.length > 100, "phone rules");
  assert.match(phone, /\.bible-modal\.adm-storage\{width:100vw;height:100dvh;max-height:100dvh;border:0;border-radius:0\}/);
  assert.match(phone, /\.adm-tiles\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(phone, /\.adm-tabs\{[^}]*overflow-x:auto/);
  assert.match(phone, /\.adm-row\{display:flex;[^}]*\}\s*\.adm-row\.adm-head-row\{display:none\}/, "head rows stay hidden on phones (after, and more specific than, .adm-row)");
  assert.match(phone, /min-height:40px/);
  assert.match(phone, /env\(safe-area-inset-bottom\)/);
  assert.match(block, /\.adm-detail\{[^}]*width:min\(560px,100%\)/);
  // 2026-09-27 review: light theme, phone width, the admin price card
  const light = css.slice(css.indexOf('html[data-theme="light"]{'), css.indexOf("}", css.indexOf('html[data-theme="light"]{')));
  const lightVal = (tok) => (light.match(new RegExp(tok + ":([^;]+);")) || [])[1].trim();
  for (const sel of ["adm-skel-line", "adm-bar", "adm-progress"]) {
    const rule = block.match(new RegExp("\\." + sel + "\\{([^}]*)\\}"))[1];
    const tok = (rule.match(/background:var\((--[a-z0-9-]+)\)/) || [])[1];
    assert.ok(tok, sel + " has a token background");
    assert.notEqual(lightVal(tok), lightVal("--bg-2"), sel + " is visible on a light card");
    assert.notEqual(lightVal(tok).toUpperCase(), "#FFFFFF", sel + " is not white on white");
  }
  assert.match(block, /body\.adm-open \.pricing-watch-card\{display:none\}/, "the price-drift card never covers the sheet");
  assert.match(phone, /\.adm-search input,\.adm-sort select\{font-size:16px\}/, "16px fields: no iOS focus zoom");
  assert.match(phone, /\.adm-row > \.c-pick\{min-width:40px;min-height:40px/, "a 40px pick target");
  assert.match(phone, /\.adm-acct-main\{flex:1 1 0\}\s*\.adm-acct-chev\{order:2\}\s*\.adm-acct-side\{order:3;flex:1 1 100%/, "the chevron stays on the email's line");
  // every row cell sits in a grid area its table defines (no implicit tracks)
  for (const [table, cells] of Object.entries({ "adm-own": "title kind state files size by date go", "adm-else": "title files size go",
      "adm-del": "title state files size safe by date act", "adm-proj": "pick title owner kind state files size safe date",
      "adm-queue": "title total ready next oldest stuck", "adm-hist": "date owner title result state act" }))
    assert.ok(block.includes("." + table + " .adm-row{") && block.includes('grid-template-areas:"' + cells + '"'), table);
});
await test("wiring: TURN.html tag after auth-ui with a ?v= key, APP_FEATURES untouched, no app.jsx dependency", () => {
  const html = read("TURN.html");
  const auth = html.indexOf('src="app/auth-ui.jsx?v=');
  // a later change's key counts too (readable storage folders re-keyed it: 20260927-readable1)
  // …and Clear old temp files (2026-09-28): 20260928-temp1; the Kinolot rebrand (2026-09-28): 20260928-brand1
  const adm = Math.max(html.indexOf('<script type="text/babel" src="app/admin-storage.jsx?v=20260927-admstorage2"></script>'),
    html.indexOf('<script type="text/babel" src="app/admin-storage.jsx?v=20260927-readable1"></script>'),
    html.indexOf('<script type="text/babel" src="app/admin-storage.jsx?v=20260928-temp1"></script>'),
    html.indexOf('<script type="text/babel" src="app/admin-storage.jsx?v=20260928-brand1"></script>'));
  assert.ok(auth > 0 && adm > auth, "admin-storage.jsx loads after auth-ui.jsx");
  const lines = html.split("\n");
  const li = lines.findIndex((l) => l.includes('src="app/auth-ui.jsx?v='));
  assert.match(lines[li + 1], /src="app\/admin-storage\.jsx\?v=/, "right after it");
  // the merge with the tab-lock work re-keyed both files (20260927-merge1): a later key counts too
  assert.ok((["20260927-admstorage1", "20260927-merge1", "20260928-brand1", "20260929-look1", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-planpick3", "20261002-planpick2", "20261002-consent1", "20261002-team1", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-lookbook1", "20261003-cast1", "20261003-team5", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1"].some(k=>html.includes('src="app/auth-ui.jsx?v='+k+'"')))
    && (["20260927-admstorage2", "20260927-merge1", "20260927-dock1", "20260928-dock2", "20260928-round1", "20260928-brand1", "20260929-look1", "20260929-look2", "20260929-look3", "20260929-look4", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-planpick3", "20261002-research2", "20261002-research1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261003-room1", "20261003-login1", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-shots3", "20261009-sb3", "20261009-tl3", "20261009-mix3", "20261009-home3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261009-bd3", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1"].some(k=>html.includes('href="app/styles.css?v='+k+'"'))), "cache keys bumped");   // …and the Kinolot identity pass (2026-09-29): 20260929-look1; Manage plan (2026-09-30): 20260930-portal1; billing fixes (2026-09-30): 20260930-billing1; consumer rights + tax (2026-10-01): 20261001-tax1; the 14-day note by the purchase buttons (2026-10-02): 20261002-consent1; the note behind an ⓘ by the plan names (2026-10-02): 20261002-tip1; Team "Coming soon" (2026-10-02): 20261002-team1 (styles.css, and auth-ui.jsx for its role tooltips)
  const ai = read("app/ai.jsx");
  const i = ai.indexOf("const APP_FEATURES");
  assert.match(ai.slice(ai.lastIndexOf("\n", i - 2), i), /Admin-only operator tools \(Storage page, price watch\) are deliberately NOT listed/);
  const manifest = ai.slice(i, ai.indexOf("];", i));
  assert.ok(!/admin-storage|Storage · admin|Admin Storage|Storage page/i.test(manifest), "not in MUSE's manifest");
  assert.ok(!/admin-storage|turnOpenAdminStorage/.test(read("app/app.jsx")), "app.jsx is not touched");
  assert.match(ADMIN_SRC, /deliberately NOT listed in APP_FEATURES/);
  assert.match(ADMIN_SRC, /no tombstone/);
  // the every-visitor script tag is a recorded trade-off (spec), not an oversight
  assert.match(ADMIN_SRC, /Trade-off recorded 2026-09-27 \(review\): TURN\.html loads this file for every\s+visitor/);
});

console.log(`PASS test-admin-storage-ui: ${checks} checks` + (DIST ? " (dist build)" : ""));

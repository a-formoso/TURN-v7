#!/usr/bin/env node
/* test-likeness-store.mjs — a character's LIKENESS (internal name "cameo"), the storage / sync /
   consent half (2026-10-10, owner — Likeness review). Offline: the REAL app/storage-keys.js,
   app/cloud.jsx, app/imagegen.jsx and app/cameo.jsx run in node:vm "devices" (each its own fake
   IndexedDB + localStorage) against one fake Supabase backend that applies the rules of
   supabase/team-relaunch.sql §7d (rows and photos: the capturer, the film's owner, its Art
   directors; one row per person per character per film; a row needs its consent record).
   Components render through a small hook renderer (useState / useEffect / useRef / useCallback).

     A  scoping: film A vs film B, an account switch, sign-out, a Show's bible scope
     B  old unscoped records: never used, listed as "Earlier", copied with their provenance
     C  sync honesty: success (photos first, then the row, then the old photos), failures keep it local
     D  a fresh device reads the cloud back (bytes, never signed links); a teammate's in memory only
     E  revoke where it lives; nbClearCameo; the sheets made with the face
     F  recapture pre-fills; toggling sync never changes the capture date
     G  the consent record; cameoConsentGate; nbCameoInfo availability; events; film delete

   node scripts/test-likeness-store.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename, compact: true,
}).code;
const SRC = { keys: read("app/storage-keys.js"), cloud: read("app/cloud.jsx"),
  imagegen: transform(read("app/imagegen.jsx"), "app/imagegen.jsx"), cameo: transform(read("app/cameo.jsx"), "app/cameo.jsx") };

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
}
const noop = () => {};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await tick(); };
const plain = (x) => JSON.parse(JSON.stringify(x));

const U1 = "a1000000-0000-4000-8000-000000000001";   // owner of film A (and of the Show)
const U2 = "a1000000-0000-4000-8000-000000000002";   // an Art director on film A
const U3 = "a1000000-0000-4000-8000-000000000003";   // a Co-writer on film A
const FA = "fa000000-0000-4000-8000-00000000000a", FB = "fb000000-0000-4000-8000-00000000000b";
const SHOW = "5c000000-0000-4000-8000-0000000000c1", E1 = "e1000000-0000-4000-8000-0000000000e1", E2 = "e2000000-0000-4000-8000-0000000000e2";
const jpg = (n) => "data:image/jpeg;base64," + Buffer.from([255, 216, 255, 224, n, n + 1, n + 2, n + 3]).toString("base64");

/* ── a tiny hook renderer (enough for the capture window and the dialogs) ── */
function makeReact(){
  const Fragment = Symbol.for("test.fragment");
  let current = null;
  const createElement = (type, props, ...children) => ({ $el: true, type, props: { ...(props || {}), children } });
  class Root {
    constructor(host){ this.host = host; this.inst = new Map(); this.el = null; this.tree = null; this.dirty = false; this.alive = true; this.effects = []; }
    render(el){ this.el = el; this.flush(); }
    schedule(){ if (this.dirty || !this.alive) return; this.dirty = true; queueMicrotask(() => { this.dirty = false; if (this.alive) this.flush(); }); }
    flush(){
      const seen = new Set(); this.effects = [];
      this.tree = this.walk(this.el, "r", seen);
      for (const [k, inst] of this.inst) if (!seen.has(k)) { for (const h of inst.h) if (h && h.cleanup) try { h.cleanup(); } catch (_e) {} this.inst.delete(k); }
      const eff = this.effects; this.effects = [];
      for (const f of eff) f();
    }
    walk(node, path, seen){
      if (node == null || node === false || node === true) return null;
      if (Array.isArray(node)) return node.map((c, i) => this.walk(c, path + "." + i, seen));
      if (typeof node !== "object" || !node.$el) return node;
      const { type, props } = node;
      if (typeof type === "function"){
        const key = path + ":" + (type.name || "fn");
        seen.add(key);
        let inst = this.inst.get(key);
        if (!inst){ inst = { h: [], root: this }; this.inst.set(key, inst); }
        inst.i = 0; const prev = current; current = inst;
        let out; try { out = type(props); } finally { current = prev; }
        return this.walk(out, key + "/", seen);
      }
      if (type === Fragment) return { type: "#frag", props: {}, children: this.walk(props.children, path + "f", seen) };
      return { type, props, children: this.walk(props.children, path + "<" + String(type) + ">", seen) };
    }
    unmount(){ this.alive = false; for (const inst of this.inst.values()) for (const h of inst.h) if (h && h.cleanup) try { h.cleanup(); } catch (_e) {} this.inst.clear(); this.tree = null; }
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((d, j) => Object.is(d, b[j]));
  const React = {
    createElement, Fragment,
    useState(init){ const inst = current, i = inst.i++; if (inst.h.length <= i) inst.h[i] = { v: typeof init === "function" ? init() : init }; const cell = inst.h[i];
      return [cell.v, (v) => { const nv = typeof v === "function" ? v(cell.v) : v; if (!Object.is(nv, cell.v)){ cell.v = nv; inst.root.schedule(); } }]; },
    useRef(init){ const inst = current, i = inst.i++; if (inst.h.length <= i) inst.h[i] = { current: init }; return inst.h[i]; },
    useCallback(fn, deps){ const inst = current, i = inst.i++; const p = inst.h[i]; if (p && deps && same(deps, p.deps)) return p.fn; inst.h[i] = { fn, deps }; return fn; },
    useMemo(fn, deps){ const inst = current, i = inst.i++; const p = inst.h[i]; if (p && deps && same(deps, p.deps)) return p.v; inst.h[i] = { v: fn(), deps }; return inst.h[i].v; },
    useEffect(fn, deps){ const inst = current, i = inst.i++; const prev = inst.h[i];
      if (prev && deps && prev.deps && same(deps, prev.deps)) return;
      const cell = { deps, cleanup: prev && prev.cleanup }; inst.h[i] = cell;
      inst.root.effects.push(() => { if (cell.cleanup){ try { cell.cleanup(); } catch (_e) {} } const c = fn(); cell.cleanup = typeof c === "function" ? c : null; }); },
  };
  const roots = [];
  const ReactDOM = { createRoot: (host) => { const r = new Root(host); roots.push(r); return r; }, createPortal: (el) => el };
  return { React, ReactDOM, Root, roots };
}
const nodesOf = (tree) => { const out = []; const visit = (n) => { if (n == null) return; if (Array.isArray(n)) return n.forEach(visit); if (typeof n !== "object") return; out.push(n); visit(n.children); }; visit(tree); return out; };
const textOf = (n) => (n == null || n === false) ? "" : (typeof n === "string" || typeof n === "number") ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : textOf(n.children);
const byRole = (tree, role) => nodesOf(tree).find((n) => n.props && n.props["data-role"] === role);
const click = (n) => n.props.onClick({ stopPropagation: noop, preventDefault: noop });

/* ── a fake IndexedDB (one per device) ── */
function fakeIDB(){
  const dbs = new Map();
  return { _dbs: dbs, open(name){
    const req = {};
    setTimeout(() => {
      let db = dbs.get(name); const fresh = !db;
      if (!db){ db = new Map(); dbs.set(name, db); }
      req.result = { objectStoreNames: { contains: (n) => db.has(n) }, createObjectStore: (n) => { db.set(n, new Map()); },
        transaction: (sn) => { const st = db.get(sn); const tx = { oncomplete: null, onerror: null };
          const done = () => setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          tx.objectStore = () => ({
            put: (v, k) => { st.set(k, structuredClone(v)); done(); },
            delete: (k) => { st.delete(k); done(); },
            get: (k) => { const r = {}; setTimeout(() => { r.result = st.has(k) ? structuredClone(st.get(k)) : undefined; r.onsuccess && r.onsuccess(); }, 0); return r; } });
          return tx; } };
      if (fresh && req.onupgradeneeded) req.onupgradeneeded();
      req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  } };
}
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k), key: (i) => Array.from(m.keys())[i] ?? null, get length(){ return m.size; }, _m: m }; };

/* ── one fake Supabase backend (the rules of team-relaunch.sql §7d) ── */
function makeBackend(){
  const B = { cameos: [], projects: new Map(), gens: [], files: new Map(), ads: new Map(), log: [], fail: {}, grants: new Set(), seq: 0, oldUnique: false };
  const parts = (p) => { const s = String(p).split("/"); return { uid: s[0], pid: s[1], folder: s[2] }; };
  const ownerOf = (pid) => (B.projects.get(String(pid)) || {}).owner || null;
  const isAD = (uid, pid) => (B.ads.get(String(pid)) || new Set()).has(uid);
  B.canRead = (uid, pid, capturer) => !!uid && (uid === capturer || ownerOf(pid) === uid || isAD(uid, pid));
  B.canWrite = (uid, pid) => !!uid && (ownerOf(pid) === uid || isAD(uid, pid));
  const consentOk = (prov) => { const c = prov && prov.consent; return !!(c && typeof c === "object" && c.adult === true && (c.subject === "self" || (c.subject === "other" && String(c.name || "").trim())) && c.textVersion); };
  const rowOk = (v) => Array.isArray(v.angles) && v.angles.length >= 1 && v.angles.length <= 3
    && v.angles.every((a) => { const p = parts(a.storage_path); return p.folder === "cameo" && p.uid === v.owner && p.pid === v.project_id; }) && consentOk(v.prov);
  const rls = { data: null, error: { code: "42501", message: "new row violates row-level security policy for table \"turn_cameos\"" } };
  class Q {
    constructor(uid, table){ this.uid = uid; this.table = table; this.op = "select"; this.f = []; this.val = null; this.opts = {}; this.ret = false; }
    select(){ if (this.op !== "select") this.ret = true; return this; }
    eq(k, v){ this.f.push((r) => String(r[k]) === String(v)); return this; }
    in(k, vs){ const s = new Set(vs.map(String)); this.f.push((r) => s.has(String(r[k]))); return this; }
    like(k, pat){
      let src = "", i = 0; const s = String(pat);
      while (i < s.length){ const ch = s[i]; if (ch === "\\" && i + 1 < s.length){ src += s[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); i += 2; continue; }
        src += ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); i++; }
      const re = new RegExp("^" + src + "$"); this.f.push((r) => re.test(String(r[k]))); return this; }
    upsert(v, o){ this.op = "upsert"; this.val = v; this.opts = o || {}; return this; }
    delete(){ this.op = "delete"; return this; }
    order(){ return this; } range(){ return this; } limit(){ return this; }
    maybeSingle(){ this.one = true; return this._run(); }
    single(){ this.one = true; return this._run(); }
    then(res, rej){ return this._run().then(res, rej); }
    match(rows){ return rows.filter((r) => this.f.every((fn) => fn(r))); }
    async _run(){
      const uid = this.uid;
      if (this.table === "turn_cameos"){
        if (this.op === "select"){
          if (B.fail.cameoRead) return { data: null, error: { message: "connection reset" } };
          const rows = this.match(B.cameos.filter((r) => B.canRead(uid, r.project_id, r.owner))).map((r) => structuredClone(r));
          if (this.one) return rows.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: rows[0] || null, error: null };
          return { data: rows, error: null };
        }
        if (this.op === "upsert"){
          const v = structuredClone(this.val);
          B.log.push("upsert:" + v.char_id);
          if (B.fail.upsert) return { data: null, error: B.fail.upsert };
          if (this.opts.onConflict === "project_id,owner,char_id" && B.oldUnique) return { data: null, error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } };
          if (v.owner !== uid || !B.canWrite(uid, v.project_id) || !rowOk(v)) return rls;
          const keyCols = String(this.opts.onConflict || "").split(",");
          const hit = B.cameos.find((r) => keyCols.every((k) => String(r[k]) === String(v[k])));
          if (hit && hit.owner !== uid) return rls;   // the old two-column key: an update of someone else's row
          const at = new Date(Date.now() + (++B.seq)).toISOString();
          if (hit) Object.assign(hit, v, { updated_at: at }); else B.cameos.push({ id: "c" + B.seq, ...v, updated_at: at });
          return { data: null, error: null };
        }
        if (this.op === "delete"){
          const gone = this.match(B.cameos).filter((r) => r.owner === uid || ownerOf(r.project_id) === uid);
          B.cameos = B.cameos.filter((r) => gone.indexOf(r) < 0);
          B.log.push("delete-row:" + gone.length);
          return { data: this.ret ? gone.map((r) => ({ id: r.id })) : null, error: null };
        }
      }
      if (this.table === "turn_projects"){
        const rows = Array.from(B.projects.values());
        if (this.op === "delete"){
          const gone = this.match(rows).filter((p) => p.owner === uid);
          for (const p of gone){ B.projects.delete(p.id); B.cameos = B.cameos.filter((c) => c.project_id !== p.id); }
          return { data: gone.map((p) => ({ id: p.id })), error: null };
        }
        const out = this.match(rows).map((p) => ({ id: p.id, owner: p.owner }));
        return this.one ? { data: out[0] || null, error: null } : { data: out, error: null };
      }
      if (this.table === "turn_generations"){
        const out = this.match(B.gens).map((g) => structuredClone(g));
        return this.one ? { data: out[0] || null, error: null } : { data: out, error: null };
      }
      return { data: [], error: null };
    }
  }
  B.client = (getUid) => ({
    from: (t) => new Q(getUid(), t),
    auth: { getSession: async () => ({ data: { session: getUid() ? { user: { id: getUid() } } : null }, error: null }), signOut: async () => ({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) },
    rpc: async (name, args) => {
      const uid = getUid();
      if (name === "turn_begin_asset_upload") return { data: "2099-01-01T00:00:00.000Z", error: null };
      if (name === "turn_finish_asset_upload" || name === "turn_finish_asset_cleanup") return { data: 1, error: null };
      // (2026-10-10, owner — Show/Episode delete files) team-relaunch.sql §7e: every file the film's rows
      // name under its own folder, less what the owner's other films name; B.noFilmDeleteCleanup = before that SQL
      if (name === "turn_film_delete_cleanup" && !B.noFilmDeleteCleanup){
        if (ownerOf(args.p_project_id) !== uid) return { data: null, error: { code: "42501", message: "TURN_FILES: only the film's owner can do this" } };
        const named = (g) => [g.storage_path, ...((g.refs || []).map((r) => r && r.storage_path))].filter(Boolean);
        const other = new Set(B.gens.filter((g) => g.project_id !== args.p_project_id && ownerOf(g.project_id) === uid).flatMap(named));
        const mine = [...B.gens.filter((g) => g.project_id === args.p_project_id).flatMap(named),
          ...B.cameos.filter((c) => c.project_id === args.p_project_id).flatMap((c) => c.angles.map((a) => a && a.storage_path))];
        const paths = Array.from(new Set(mine.filter((p) => p && parts(p).pid === args.p_project_id && !other.has(p)))).sort();
        for (const p of paths) B.grants.add(uid + "|" + p);
        B.log.push("rpc:turn_film_delete_cleanup");
        return { data: { paths, kept: [], expires_at: "2099-01-01T00:00:00.000Z" }, error: null };
      }
      if (name === "turn_film_cameo_cleanup"){
        if (ownerOf(args.p_project_id) !== uid) return { data: null, error: { code: "42501", message: "TURN_LIKENESS: only the film's owner can do this" } };
        const paths = [];
        for (const c of B.cameos) if (c.project_id === args.p_project_id) for (const a of c.angles) if (a && a.storage_path){ paths.push(a.storage_path); B.grants.add(uid + "|" + a.storage_path); }
        return { data: { paths: paths.sort() }, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "Could not find the function public." + name + " in the schema cache" } };
    },
    storage: { from: () => ({
      upload: async (path, blob) => {
        const p = parts(path);
        B.log.push("upload:" + path);
        if (B.fail.upload) return { error: { status: 500, message: "storage unavailable" } };
        if (p.uid !== getUid() || !B.canWrite(getUid(), p.pid)) return { error: { statusCode: "403", status: 403, message: "new row violates row-level security policy" } };
        B.files.set(path, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type });
        return { error: null };
      },
      download: async (path) => {
        const p = parts(path), f = B.files.get(path), uid = getUid();
        if (B.fail.download || !f || !(B.canRead(uid, p.pid, p.uid) || B.grants.has(uid + "|" + path))) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([f.bytes], { type: f.type }), error: null };
      },
      remove: async (paths) => {
        const uid = getUid(), out = [];
        for (const path of paths){
          const p = parts(path);
          const ok = p.uid === uid || ownerOf(p.pid) === uid || B.grants.has(uid + "|" + path);
          B.log.push("remove:" + path);
          if (ok && B.files.delete(path)) out.push({ name: path });
        }
        return { data: out, error: null };
      },
      createSignedUrl: async (path) => ({ data: { signedUrl: "https://supabase.test/storage/v1/object/sign/turn-assets/" + path + "?token=t" }, error: null }),
      createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: "https://supabase.test/storage/v1/object/sign/turn-assets/" + p + "?token=t" })), error: null }),
    }) },
  });
  return B;
}

/* ── one device: the real app files in a vm, its own IndexedDB and localStorage ── */
function device(B){
  const R = makeReact();
  const events = [], toasts = [], listeners = {};
  const box = { console: { ...console, warn: noop, info: noop, log: noop, error: noop }, Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, WeakMap, Symbol,
    Uint8Array, URL, Blob, atob, btoa, structuredClone, AbortController, crypto: globalThis.crypto, Error, TypeError, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    queueMicrotask, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    React: R.React, ReactDOM: R.ReactDOM, Icon: new Proxy({}, { get: () => () => null }),
    TURN_SUPABASE: { url: "https://supabase.test", anonKey: "anon", bucket: "turn-assets", imageProxy: true, readableStorageKeys: false },
    indexedDB: fakeIDB(), localStorage: mkStore(), sessionStorage: mkStore(),
    document: { createElement: (t) => ({ tagName: t, style: {}, parentNode: null, className: "" }), addEventListener: noop, removeEventListener: noop, getElementById: () => null,
      body: { kids: [], appendChild(n){ this.kids.push(n); n.parentNode = this; }, removeChild(n){ this.kids = this.kids.filter((x) => x !== n); n.parentNode = null; } } },
    navigator: { userAgent: "node-test", onLine: true }, location: { origin: "https://app.test", hostname: "localhost", href: "", search: "", hash: "" },
    CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } },
    FileReader: class { readAsDataURL(b){ b.arrayBuffer().then((x) => { this.result = "data:" + (b.type || "application/octet-stream") + ";base64," + Buffer.from(x).toString("base64"); this.onload && this.onload(); }); } },
    Image: class {}, fetch: async (u) => { throw new Error("network disabled in this test: " + u); },
    turnSafeError: (v) => v, turnAttrError: (_k, _m, msg) => msg, turnIsContentBlock: () => false, turnApiKeysForProxy: () => ({}), CREDIT_SCALE: 10,
  };
  box.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  box.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  box.dispatchEvent = (ev) => { events.push(ev); (listeners[ev.type] || []).slice().forEach((f) => f(ev)); return true; };
  box.appToast = (m, k) => toasts.push({ m, k });
  box.appConfirm = async () => true;
  box.window = box; box.globalThis = box;
  box._sbClient = B.client(() => box.__uid || null);
  vm.createContext(box);
  vm.runInContext(SRC.keys, box, { filename: "app/storage-keys.js" });
  vm.runInContext(SRC.cloud, box, { filename: "app/cloud.jsx" });
  vm.runInContext(SRC.imagegen, box, { filename: "app/imagegen.jsx" });
  vm.runInContext(SRC.cameo, box, { filename: "app/cameo.jsx" });
  const D = { box, events, toasts, listeners, R };
  D.open = async (uid, film, show = null, bibleIds = []) => {   // what app.jsx does when a film opens
    box.__uid = uid;
    box.nbUseCloud(film, uid);
    box.nbUseShared(show, bibleIds);
    await box.nbCameoRefresh(); await settle();
  };
  D.local = async () => { box.__uid = null; box.nbUseLocal(); await box.nbCameoRefresh(); await settle(); };
  D.idbKeys = () => Array.from((box.indexedDB._dbs.get("turn-images") || new Map()).get("images")?.keys() || []);
  D.idbGet = (k) => ((box.indexedDB._dbs.get("turn-images") || new Map()).get("images") || new Map()).get(k);
  D.changed = () => events.filter((e) => e.type === "turn-cameo-changed").map((e) => e.detail);
  D.lock = (charId, extra = {}) => box.nbSetCameo(charId, { angles: [{ key: "front", label: "Front", url: jpg(1), source: "webcam" },
    { key: "left", label: "¾ Left", url: jpg(11), source: "upload" }], consent: { subject: "self", name: "", adult: true }, sync: false, w: 1024, h: 1024, ...extra });
  return D;
}
const freshBackend = () => {
  const B = makeBackend();
  for (const [id, owner] of [[FA, U1], [FB, U1], [SHOW, U1], [E1, U1], [E2, U1]]) B.projects.set(id, { id, owner });
  B.ads.set(FA, new Set([U2]));
  return B;
};

/* ═══ A. scoping ═══ */
await test("A1 a likeness belongs to its film: Maya's in film A is not used for Maya in film B, and comes back in film A", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  const meta = await D.lock("maya");
  assert.equal(meta.scope, FA); assert.equal(meta.angleCount, 2); assert.equal(meta.sync, false);
  assert.ok(w.nbGetCameo("maya").startsWith("data:image/jpeg"));
  assert.ok(D.idbKeys().includes(`turn-cameo-v2|${U1}|${FA}|maya`), "keyed by account + film + character: " + D.idbKeys());
  await D.open(U1, FB);
  assert.equal(w.nbGetCameo("maya"), ""); assert.equal(w.nbCameoMeta("maya"), null);
  assert.equal(w.nbCameoInfo("maya").locked, false); assert.equal(await w.nbLoadCameoFull("maya"), null);
  assert.deepEqual(plain(w.nbListCameos()), [], "film B's count is 0");
  assert.deepEqual(plain(w.nbListOtherCameos().map((e) => [e.scope, e.charId])), [[FA, "maya"]], "listed under the person's other films");
  await D.open(U1, FA);
  assert.equal(w.nbCameoInfo("maya").locked, true); assert.equal(w.nbListCameos().length, 1);
});

await test("A2 another account on this browser sees none of it; sign-out drops the photos held in memory", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA); await D.lock("maya");
  await D.open(U3, FA);
  assert.equal(w.nbGetCameo("maya"), ""); assert.equal(w.nbCameoMeta("maya"), null);
  assert.deepEqual(plain(w.nbListCameoEntries()), []); assert.deepEqual(plain(w.nbListOtherCameos()), []);
  assert.ok(Array.from(w._cameoMem.keys()).every((k) => !k.startsWith(U1)), "the switch dropped the first account's photos from memory");
  await D.open(U1, FA);
  assert.ok((await w.nbLoadCameoFull("maya")).url.startsWith("data:image/"), "…and they're still on this device for their account");
  assert.ok(w.nbGetCameo("maya"));
  w.cloudSignOut && await w.cloudSignOut();
  assert.equal(w.nbGetCameo("maya"), "", "sign-out empties the memory");
  await D.local();
  assert.deepEqual(plain(w.nbListCameos()), [], "signed out (local mode): only local-mode likenesses");
  assert.equal(w.nbCameoInfo("maya").locked, false);
});

await test("A3 a Show character's likeness lives in the Show's bible scope: every Episode finds it; a non-bible character stays in its Episode", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, E1, SHOW, ["maya"]);
  assert.equal((await D.lock("maya")).scope, SHOW);
  assert.equal((await D.lock("bob")).scope, E1);
  await D.open(U1, E2, SHOW, ["maya"]);
  assert.equal(w.nbCameoInfo("maya").locked, true, "Episode 2 finds the Show's likeness");
  assert.ok((await w.nbLoadCameoFull("maya")).url);
  assert.equal(w.nbCameoInfo("bob").locked, false, "Episode 1's own character isn't in Episode 2");
});

/* ═══ B. old unscoped records ═══ */
await test("B1 an OLD unscoped record is never used, is listed as Earlier, and 'Use for' copies it with its provenance (the old one untouched)", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  const old = { url: jpg(40), angles: [{ label: "Front", url: jpg(40) }, { label: "¾ Right", url: jpg(41) }], consent: true, sync: false, source: "upload",
    subject: "Me", w: 800, h: 800, iso: "2026-09-01T09:00:00.000Z", date: "Sep 1, 2026" };
  const oldReg = { maya: { consent: true, sync: false, source: "upload", subject: "Me", angleCount: 2, w: 800, h: 800, iso: old.iso, date: old.date } };
  w.localStorage.setItem("turn-cameo-registry", JSON.stringify(oldReg));
  await D.open(U1, FA);   // opens IndexedDB
  await w.idbSet("turn-cameo-maya", old);
  await w.nbCameoRefresh();
  assert.equal(w.nbGetCameo("maya"), ""); assert.equal(w.nbCameoInfo("maya").locked, false, "never used automatically");
  assert.equal(await w.nbLoadCameoFull("maya"), null);
  const earlier = plain(w.nbListEarlierCameos());
  assert.deepEqual(earlier.map((e) => [e.id, e.angleCount, e.source]), [["maya", 2, "upload"]]);
  const r = await w.nbAdoptEarlierCameo("maya", "maya");
  assert.equal(r.ok, true, JSON.stringify(r));
  const info = w.nbCameoInfo("maya");
  assert.equal(info.locked, true); assert.equal(info.capturedAt, old.iso, "its original capture date"); assert.equal(info.consent.legacy, true, "its original tick, as it was");
  const full = await w.nbLoadCameoFull("maya");
  assert.deepEqual(plain(full.angles.map((a) => [a.key, a.source])), [["front", "upload"], ["right", "upload"]]);
  assert.equal(full.from, "earlier");
  assert.equal(w.localStorage.getItem("turn-cameo-registry"), JSON.stringify(oldReg), "the old registry is untouched");
  assert.deepEqual(plain(D.idbGet("turn-cameo-maya")), old, "the old record is untouched");
  // syncing it asks the consent question first (its old tick isn't today's record)
  assert.equal(w.nbCameoNeedsConsent(w.nbCameoEntryFor("maya")), true);
  const s = await w.nbSyncCameo("maya", true);
  assert.equal(s.ok, false); assert.equal(B.cameos.length, 0, "nothing reached the cloud without a consent record");
  const s2 = await w.nbSyncCameo("maya", true, { consent: { subject: "self", name: "", adult: true } });
  assert.equal(s2.ok, true, JSON.stringify(s2)); assert.equal(B.cameos[0].prov.consent.subject, "self");
  assert.equal(w.nbCameoInfo("maya").capturedAt, old.iso, "syncing never changes the capture date");
  await w.nbDeleteEarlierCameo("maya");
  assert.equal(D.idbGet("turn-cameo-maya"), undefined); assert.deepEqual(plain(w.nbListEarlierCameos()), []);
  assert.equal(w.nbCameoInfo("maya").locked, true, "deleting the earlier one leaves the film's copy");
});

/* ═══ C. sync honesty ═══ */
await test("C1 sync: photos uploaded first, then the row (with the consent record), synced only then; a recapture uploads the new photo, then the row, then removes the old one", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  const m = await D.lock("maya", { sync: true });
  assert.equal(m.sync, true); assert.equal(m.syncError, undefined);
  assert.equal(B.cameos.length, 1);
  const row = B.cameos[0];
  assert.deepEqual([row.project_id, row.owner, row.char_id, row.angles.length], [FA, U1, "maya", 2]);
  assert.ok(row.angles.every((a) => a.storage_path.startsWith(`${U1}/${FA}/cameo/maya/`)), JSON.stringify(row.angles));
  assert.deepEqual(row.angles.map((a) => a.source), ["webcam", "upload"]);
  assert.equal(row.prov.consent.textVersion, "2026-10-10");
  const ups = B.log.filter((x) => x.startsWith("upload:")).length;
  assert.ok(B.log.indexOf("upsert:maya") > B.log.lastIndexOf(B.log.filter((x) => x.startsWith("upload:")).pop()), "the row after the photos");
  const leftOld = row.angles[1].storage_path;
  B.log.length = 0;
  // recapture the ¾ Left only, still synced
  const r = await w.nbSetCameo("maya", { angles: [{ key: "front", label: "Front", url: jpg(1), source: "webcam" }, { key: "left", label: "¾ Left", url: jpg(21), source: "webcam" }],
    consent: { subject: "self", name: "", adult: true }, sync: true });
  assert.equal(r.sync, true);
  const uploads = B.log.filter((x) => x.startsWith("upload:"));
  assert.equal(uploads.length, 1, "only the changed photo is uploaded: " + B.log.join(" "));
  const iUp = B.log.indexOf(uploads[0]), iRow = B.log.indexOf("upsert:maya"), iRm = B.log.indexOf("remove:" + leftOld);
  assert.ok(iUp >= 0 && iRow > iUp && iRm > iRow, "upload → row → remove the old photo: " + B.log.join(" "));
  assert.ok(!B.files.has(leftOld) && B.files.size === 2, "the old ¾ Left is gone, two photos left");
  assert.ok(ups >= 2);
});

await test("C2 a sync that fails keeps the likeness on this device, says so plainly, and leaves no photo behind", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  B.fail.upsert = { code: "42501", message: "new row violates row-level security policy for table \"turn_cameos\"" };
  const m = await D.lock("maya", { sync: true });
  assert.equal(m.sync, false); assert.ok(m.syncError, "the failure is reported");
  assert.equal(w.nbCameoInfo("maya").synced, false); assert.equal(w.nbCameoInfo("maya").available, true, "kept on this device");
  assert.equal(B.cameos.length, 0); assert.equal(B.files.size, 0, "the uploaded photos were removed again");
  const t = D.toasts.pop();
  assert.equal(t.k, "error"); assert.match(t.m, /saved on this device, but syncing it to the cloud didn't work: this film only lets its owner and its Art directors sync a likeness\. Try Sync again/);
  assert.doesNotMatch(t.m, /TURN|Supabase|row-level|42501/);
  // a storage failure: nothing half-synced either
  B.fail = { upload: true };
  const m2 = await w.nbSyncCameo("maya", true);
  assert.equal(m2.ok, false); assert.equal(B.cameos.length, 0); assert.equal(w.nbCameoInfo("maya").synced, false);
  B.fail = {};
  const m3 = await w.nbSyncCameo("maya", true);
  assert.equal(m3.ok, true); assert.equal(w.nbCameoInfo("maya").synced, true);
});

await test("C3 two people on a shared film each sync their own likeness of the same character; before the SQL update the second one fails honestly", async () => {
  const B = freshBackend(), owner = device(B), ad = device(B);
  await owner.open(U1, FA); await owner.lock("maya", { sync: true });
  B.oldUnique = true;   // production before team-relaunch.sql §7d: unique (project_id, char_id)
  await ad.open(U2, FA);
  const m = await ad.lock("maya", { sync: true });
  assert.equal(m.sync, false, "refused (it would have rewritten the owner's row), so not 'Synced'");
  assert.equal(B.cameos.length, 1); assert.equal(B.cameos[0].owner, U1);
  B.oldUnique = false;
  const s = await ad.box.nbSyncCameo("maya", true);
  assert.equal(s.ok, true); assert.deepEqual(B.cameos.map((c) => c.owner).sort(), [U1, U2].sort());
});

/* ═══ D. the cloud read ═══ */
await test("D1 a fresh device reads the cloud back on opening the film: the bytes land in IndexedDB as data URLs (never signed links), synced, same capture date", async () => {
  const B = freshBackend(), D1 = device(B);
  await D1.open(U1, FA);
  const m = await D1.lock("maya", { sync: true });
  const D2 = device(B), w = D2.box;
  await D2.open(U1, FA);
  const info = w.nbCameoInfo("maya");
  assert.deepEqual([info.locked, info.synced, info.mine, info.available, info.angleCount], [true, true, true, true, 2]);
  assert.equal(info.capturedAt, m.capturedAt);
  const rec = D2.idbGet(`turn-cameo-v2|${U1}|${FA}|maya`);
  assert.ok(rec && rec.angles.length === 2 && rec.angles.every((a) => /^data:image\/jpeg;base64,/.test(a.url) && a.storage_path), JSON.stringify(rec && rec.angles.map((a) => a.url.slice(0, 30))));
  assert.ok(!JSON.stringify(rec).includes("token="), "no signed link is stored");
  assert.ok(D2.changed().some((d) => d.charId === "maya" && d.reason === "load"), "the cards hear about it");
  // a later sync from this device reuses the cloud's photos: nothing re-uploaded, nothing deleted
  B.log.length = 0;
  const r = await w.nbSyncCameo("maya", true);
  assert.equal(r.ok, true); assert.equal(B.log.filter((x) => x.startsWith("upload:") || x.startsWith("remove:")).length, 0, B.log.join(" "));
});

await test("D2 a likeness an older app stored with a signed link instead of the photo is re-read from its storage path when it syncs (never lost)", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  const path = `${U1}/${FA}/cameo/maya/20260901-090000-front-aaaa0001.jpg`;
  B.files.set(path, { bytes: new Uint8Array([255, 216, 1, 2]), type: "image/jpeg" });
  await w.idbSet(`turn-cameo-v2|${U1}|${FA}|maya`, { v: 2, charId: "maya", scope: FA, acct: U1, consent: { subject: "self", name: "", adult: true, textVersion: "2026-10-10", at: "x", by: U1 },
    angles: [{ key: "front", label: "Front", url: "https://supabase.test/storage/v1/object/sign/turn-assets/" + path + "?token=expired", source: "webcam" }],
    capturedAt: "2026-09-01T09:00:00.000Z", sync: false });
  const reg = {}; reg[FA + "|maya"] = { charId: "maya", scope: FA, acct: U1, sync: false, angleCount: 1, capturedAt: "2026-09-01T09:00:00.000Z" };
  w.localStorage.setItem("turn-cameo-registry-v2:" + U1, JSON.stringify(reg));
  const r = await w.nbSyncCameo("maya", true);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(B.cameos.length, 1); assert.equal(B.cameos[0].angles.length, 1);
  assert.ok(B.files.has(path), "the original photo was not deleted before the new copy existed");
});

await test("D3 a teammate's synced likeness: the film's Art director renders with it from MEMORY only; a Co-writer never sees it; the owner may see its photos", async () => {
  const B = freshBackend(), owner = device(B);
  await owner.open(U1, FA); await owner.lock("maya", { sync: true });
  const ad = device(B), w = ad.box;
  await ad.open(U2, FA);
  const info = w.nbCameoInfo("maya");
  assert.deepEqual([info.locked, info.mine, info.available, info.synced], [true, false, true, true]);
  assert.equal(w.nbGetCameoAngles("maya").length, 2, "loaded into memory for renders");
  assert.ok(w.nbGetCameoAngles("maya").every((u) => u.startsWith("data:image/")));
  assert.deepEqual(ad.idbKeys().filter((k) => k.startsWith("turn-cameo")), [], "nothing of it written to the Art director's device");
  assert.equal(w.localStorage.getItem("turn-cameo-registry-v2:" + U2), null);
  assert.equal(w.nbCameoFilmOwner(FA), U1, "the window shows a teammate's photos only to the film's owner");
  const cw = device(B);
  await cw.open(U3, FA);
  assert.equal(cw.box.nbCameoInfo("maya").locked, false, "a Co-writer reads no likeness");
  // the AD's own capture wins for the AD's renders; the owner keeps using hers
  await ad.lock("maya", { angles: [{ key: "front", label: "Front", url: jpg(90), source: "webcam" }], sync: true });
  assert.equal(w.nbCameoInfo("maya").mine, true); assert.equal(w.nbGetCameo("maya"), jpg(90));
  await owner.open(U1, FA);
  assert.equal(owner.box.nbCameoInfo("maya").mine, true); assert.equal(owner.box.nbGetCameo("maya"), jpg(1));
  assert.equal(owner.box.nbListCameoEntries().length, 2, "the owner's window lists both");
});

/* ═══ E. revoke ═══ */
await test("E1 revoke acts WHERE the likeness lives (its own film), not on the open film: local copy, cloud row and photos", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA); await D.lock("maya", { sync: true });
  await D.open(U1, FB); await D.lock("maya", { angles: [{ key: "front", label: "Front", url: jpg(60), source: "webcam" }] });
  const other = w.nbListOtherCameos();
  assert.deepEqual(plain(other.map((e) => [e.scope, e.charId, e.meta.sync])), [[FA, "maya", true]]);
  const r = await w.nbRevokeCameo(other[0]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(B.cameos.length, 0, "film A's row is gone"); assert.equal(B.files.size, 0, "and its photos");
  assert.ok(!D.idbKeys().includes(`turn-cameo-v2|${U1}|${FA}|maya`));
  assert.equal(w.nbCameoInfo("maya").locked, true, "film B's own likeness is untouched");
  assert.ok(D.changed().some((d) => d.reason === "revoke" && d.scope === FA));
  // after this browser's data was cleared, the cloud copy is still found (read back) and can be revoked
  await D.open(U1, FA); await D.lock("neo", { sync: true });
  const fresh = device(B);
  await fresh.open(U1, FA);
  assert.equal(fresh.box.nbCameoInfo("neo").synced, true);
  assert.equal((await fresh.box.nbClearCameo("neo")).ok, true);
  assert.equal(B.cameos.length, 0);
});

await test("E2 the film's owner may remove a teammate's synced likeness; an Art director can't remove the owner's", async () => {
  const B = freshBackend(), owner = device(B), ad = device(B);
  await ad.open(U2, FA); await ad.lock("maya", { sync: true });
  await owner.open(U1, FA); await owner.lock("neo", { sync: true });
  await ad.open(U2, FA);
  const r1 = await ad.box.nbRevokeCameo(ad.box.nbCameoEntryFor("neo"));
  assert.equal(r1.ok, false); assert.equal(B.cameos.length, 2);
  await owner.open(U1, FA);
  const e = owner.box.nbCameoEntryFor("maya");
  assert.equal(e.mine, false);
  const r2 = await owner.box.nbRevokeCameo(e);
  assert.equal(r2.ok, true); assert.deepEqual(B.cameos.map((c) => c.owner), [U1]);
});

await test("E3 revoke flow: lists the character's sheets made with the face (master, variants, scale — not another character's), clears them only when ticked", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.local();
  await D.lock("maya");
  const meta = (o) => JSON.stringify({ iso: "2026-10-10T10:00:00.000Z", ...o });
  w.localStorage.setItem("turn-charimg-meta-maya", meta({ cameo: true }));
  w.localStorage.setItem("turn-charimg-maya", jpg(70));
  w.localStorage.setItem("turn-charimg-meta-maya:st-1", meta({ cameo: true }));
  w.localStorage.setItem("turn-charimg-meta-charscale-maya", meta({ cameo: false }));
  w.localStorage.setItem("turn-charimg-meta-mayabelle", meta({ cameo: true }));
  await w.idbSet("turn-charimg-hist-maya", [{ url: jpg(71), meta: { cameo: true } }]);
  const sheets = await w.nbCameoSheets("maya");
  assert.deepEqual(plain(sheets.map((s) => s.id)), ["maya", "maya:st-1"]);
  // the dialog: unticked by default → the sheets stay
  let p = w.cameoRevokeFlow("maya", { name: "Maya" }); await settle();
  let root = D.R.roots[D.R.roots.length - 1];
  assert.match(textOf(root.tree), /Sheets already made with this face keep it unless you clear them\./);
  assert.match(textOf(root.tree), /Also clear these 2 sheets \(their versions too\)/);
  assert.equal(byRole(root.tree, "clear-sheets").props.checked, false, "unticked by default");
  click(byRole(root.tree, "revoke")); assert.equal(await p, true); await settle();
  assert.equal(w.nbCameoInfo("maya").locked, false);
  assert.ok(w.localStorage.getItem("turn-charimg-meta-maya"), "the sheet stays when not ticked");
  // again, ticked
  await D.lock("maya");
  p = w.cameoRevokeFlow("maya", { name: "Maya" }); await settle();
  root = D.R.roots[D.R.roots.length - 1];
  byRole(root.tree, "clear-sheets").props.onChange({ target: { checked: true } }); await settle();
  click(byRole(root.tree, "revoke")); assert.equal(await p, true); await settle();
  assert.equal(w.localStorage.getItem("turn-charimg-meta-maya"), null); assert.equal(w.localStorage.getItem("turn-charimg-meta-maya:st-1"), null);
  assert.equal(await w.idbGet("turn-charimg-hist-maya"), undefined, "its versions too");
  assert.ok(w.localStorage.getItem("turn-charimg-meta-mayabelle"), "another character's sheet is never touched");
  assert.equal(root.alive, false, "the dialog is gone");
  // Cancel revokes nothing
  await D.lock("maya");
  p = w.cameoRevokeFlow("maya", { name: "Maya" }); await settle();
  click(byRole(D.R.roots[D.R.roots.length - 1].tree, "cancel"));
  assert.equal(await p, false); assert.equal(w.nbCameoInfo("maya").locked, true);
});

await test("E4 cloud: the sheets in the likeness's film come from turn_generations (current image with meta.cameo)", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA); await D.lock("maya_1", { sync: true });
  B.gens.push({ project_id: FA, entity_id: "maya_1", storage_path: "p/a.png", meta: { cameo: true } },
    { project_id: FA, entity_id: "maya_1:st-2", storage_path: "p/b.png", meta: { cameo: true } },
    { project_id: FA, entity_id: "charscale-maya_1", storage_path: "p/c.png", meta: { cameo: true } },
    { project_id: FA, entity_id: "mayax1:st-2", storage_path: "p/d.png", meta: { cameo: true } },   // '_' is no wildcard
    { project_id: FA, entity_id: "maya_1:st-3", storage_path: null, meta: { cameo: true } },        // a cleared slot
    { project_id: FB, entity_id: "maya_1", storage_path: "p/e.png", meta: { cameo: true } });
  const sheets = await w.nbCameoSheets("maya_1");
  assert.deepEqual(plain(sheets.map((s) => s.id).sort()), ["charscale-maya_1", "maya_1", "maya_1:st-2"]);
  assert.ok(sheets.every((s) => s.scope === FA));
});

/* ═══ F. recapture + sync toggles ═══ */
await test("F1 recapture pre-fills the saved angles, whose face it is, the consent and the sync setting; locking it unchanged changes nothing in the cloud", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  await w.nbSetCameo("maya", { angles: [{ key: "front", label: "Front", url: jpg(1), source: "webcam" }, { key: "left", label: "¾ Left", url: jpg(2), source: "upload" },
    { key: "right", label: "¾ Right", url: jpg(3), source: "webcam" }], consent: { subject: "other", name: "Jo Actor", adult: true }, sync: true });
  const before = w.nbCameoInfo("maya");
  const root = D.R.ReactDOM.createRoot({});
  let saved = null;
  root.render(w.React.createElement(w.CameoModal, { character: { id: "maya", name: "Maya" }, onClose: noop, onSaved: (x) => { saved = x; } }));
  await settle();
  const all = nodesOf(root.tree);
  const imgs = all.filter((n) => n.type === "img").map((n) => n.props.src);
  assert.deepEqual(imgs, [jpg(1), jpg(2), jpg(3)], "the three saved angles fill their slots");
  assert.match(textOf(root.tree), /Likeness · Maya/);
  assert.equal(all.find((n) => n.props && n.props["data-subject"] === "other").props["aria-checked"], "true");
  assert.equal(byRole(root.tree, "consent-name").props.value, "Jo Actor");
  assert.equal(byRole(root.tree, "consent-box").props.checked, true, "today's consent stays ticked");
  assert.equal(byRole(root.tree, "sync").props.checked, true, "the sync setting is kept (unticking would remove the cloud copy)");
  B.log.length = 0;
  click(byRole(root.tree, "lock")); await settle();
  assert.ok(saved && saved.sync === true);
  assert.equal(B.log.filter((x) => x.startsWith("upload:") || x.startsWith("remove:") || x.startsWith("upsert:")).length, 0, "an unchanged likeness isn't re-synced: " + B.log.join(" "));
  const after = w.nbCameoInfo("maya");
  assert.equal(after.capturedAt, before.capturedAt); assert.equal(after.synced, true);
  assert.deepEqual(plain(after.consent), { subject: "other", name: "Jo Actor", adult: true });
  root.unmount();
});

await test("F2 sync off then on never changes the capture date; unsync removes the cloud row and photos", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  const m = await D.lock("maya", { sync: true });
  const off = await w.nbSyncCameo("maya", false);
  assert.equal(off.ok, true); assert.equal(B.cameos.length, 0); assert.equal(B.files.size, 0);
  assert.equal(w.nbCameoInfo("maya").synced, false); assert.equal(w.nbCameoInfo("maya").capturedAt, m.capturedAt);
  await new Promise((r) => setTimeout(r, 5));
  const on = await w.nbSyncCameo("maya", true);
  assert.equal(on.ok, true); assert.equal(w.nbCameoInfo("maya").capturedAt, m.capturedAt);
  assert.equal(B.cameos[0].prov.capturedAt, m.capturedAt);
  assert.ok(D.changed().filter((d) => d.reason === "sync" && d.charId === "maya").length >= 2);
});

/* ═══ G. consent, the gate, availability, events, film delete ═══ */
await test("G1 the capture window: Lock waits for 'Whose likeness is this?' and the box ('Someone else' needs a name); the record carries who / when / 18+ / the text's version and each photo's source", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  const root = D.R.ReactDOM.createRoot({});
  root.render(w.React.createElement(w.CameoModal, { character: { id: "neo", name: "Neo" }, onClose: noop, onSaved: noop }));
  await settle();
  // a capture lands (as the camera would put it) — set through the strip's state: upload path stand-in
  // the window's own state, by hook order: refs (video, stream, file), then phase, shots, sources
  const modalInst = Array.from(root.inst.entries()).find(([k]) => /:CameoModal$/.test(k))[1];
  assert.ok(["live", "nocam", "denied"].includes(modalInst.h[3].v), "hook order: " + JSON.stringify(modalInst.h[3]));
  const shotsCell = modalInst.h[4], srcCell = modalInst.h[5];
  shotsCell.v = { front: jpg(5) }; srcCell.v = { front: "upload" }; root.schedule(); await settle();
  assert.equal(byRole(root.tree, "lock").props.disabled, true, "no answer yet");
  const opt = (s) => nodesOf(root.tree).find((n) => n.props && n.props["data-subject"] === s);
  click(opt("other")); await settle();
  assert.match(textOf(root.tree), /I have their permission to use their likeness, and they're 18 or over/);
  byRole(root.tree, "consent-box").props.onChange({ target: { checked: true } }); await settle();
  assert.equal(byRole(root.tree, "lock").props.disabled, true, "'Someone else' needs their name");
  byRole(root.tree, "consent-name").props.onChange({ target: { value: "  Jo Actor " } }); await settle();
  assert.equal(byRole(root.tree, "lock").props.disabled, false);
  click(opt("self")); await settle();
  assert.match(textOf(root.tree), /This is me and I'm 18 or over/);
  assert.equal(byRole(root.tree, "consent-box").props.checked, false, "a different answer is ticked again");
  byRole(root.tree, "consent-box").props.onChange({ target: { checked: true } }); await settle();
  click(byRole(root.tree, "lock")); await settle();
  const rec = D.idbGet(`turn-cameo-v2|${U1}|${FA}|neo`);
  assert.equal(rec.consent.subject, "self"); assert.equal(rec.consent.name, ""); assert.equal(rec.consent.adult, true);
  assert.equal(rec.consent.textVersion, "2026-10-10"); assert.equal(rec.consent.by, U1); assert.ok(!Number.isNaN(Date.parse(rec.consent.at)));
  assert.equal(rec.angles[0].source, "upload");
  assert.equal(rec.charName, "Neo");
  await assert.rejects(() => w.nbSetCameo("trin", { angles: [{ key: "front", url: jpg(6) }], consent: { subject: "other", name: "", adult: true } }), /name of the person/);
  await assert.rejects(() => w.nbSetCameo("trin", { angles: [{ key: "front", url: jpg(6) }], consent: { subject: "self", adult: false } }), /18 or over/);
  root.unmount();
});

await test("G2 cameoConsentGate({ purpose }): the same question in a small dialog — true once answered and ticked, false on Cancel / Escape / outside; it remembers nothing", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  const lsBefore = JSON.stringify(Array.from(w.localStorage._m.entries()));
  let p = w.cameoConsentGate({ purpose: "This photo shows a real person. Say whose face it is before it's sent." }); await settle();
  let root = D.R.roots[D.R.roots.length - 1];
  assert.match(textOf(root.tree), /Whose likeness is this\?/); assert.match(textOf(root.tree), /before it's sent/);
  assert.equal(byRole(root.tree, "continue").props.disabled, true);
  click(nodesOf(root.tree).find((n) => n.props && n.props["data-subject"] === "self")); await settle();
  assert.equal(byRole(root.tree, "continue").props.disabled, true, "the box first");
  byRole(root.tree, "consent-box").props.onChange({ target: { checked: true } }); await settle();
  click(byRole(root.tree, "continue"));
  assert.equal(await p, true); assert.equal(root.alive, false); assert.equal(w.document.body.kids.length, 0, "its host is removed");
  p = w.cameoConsentGate({ purpose: "motion-control-face" }); await settle();
  root = D.R.roots[D.R.roots.length - 1];
  assert.match(textOf(root.tree), /sent for the motion video/, "a purpose key reads as a sentence");
  assert.doesNotMatch(textOf(root.tree), /motion-control-face/);
  assert.equal(nodesOf(root.tree).find((n) => n.props && n.props["data-subject"] === "self").props["aria-checked"], "false", "nothing remembered");
  click(byRole(root.tree, "cancel")); assert.equal(await p, false);
  p = w.cameoConsentGate({}); await settle();
  (D.listeners.keydown || []).slice().forEach((f) => f({ key: "Escape", preventDefault: noop, stopPropagation: noop }));
  assert.equal(await p, false);
  p = w.cameoConsentGate({}); await settle();
  root = D.R.roots[D.R.roots.length - 1];
  nodesOf(root.tree).find((n) => n.props && n.props.className === "cameo-overlay").props.onClick();
  assert.equal(await p, false);
  assert.equal(JSON.stringify(Array.from(w.localStorage._m.entries())), lsBefore, "no storage written");
  const ask = w.cameoConsentAsk({}); await settle();
  root = D.R.roots[D.R.roots.length - 1];
  click(nodesOf(root.tree).find((n) => n.props && n.props["data-subject"] === "other")); await settle();
  byRole(root.tree, "consent-name").props.onChange({ target: { value: " Ana " } }); await settle();
  byRole(root.tree, "consent-box").props.onChange({ target: { checked: true } }); await settle();
  click(byRole(root.tree, "continue"));
  assert.deepEqual(plain(await ask), { subject: "other", name: "Ana", adult: true });
});

await test("G3 nbCameoInfo availability: photos gone from this device (with no cloud copy) → available:false and why; a cloud copy that can't be read → its own why", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  await D.lock("maya");
  // IndexedDB cleared, the registry left behind
  await w.idbDel(`turn-cameo-v2|${U1}|${FA}|maya`);
  w._cameoMem.clear();
  await w.nbCameoRefresh();
  let info = w.nbCameoInfo("maya");
  assert.deepEqual([info.locked, info.available, info.mine], [true, false, true]);
  assert.match(info.why, /photos are no longer here\. Recapture it/);
  assert.equal(w.nbCameoMeta("maya"), null, "the card doesn't claim a usable likeness");
  assert.equal(w.nbListCameos().length, 1, "but it's listed (it can be revoked)");
  // synced from another device, its photos unreadable here
  const other = device(B);
  await other.open(U1, FA); await other.lock("neo", { sync: true });
  B.fail.download = true;
  const D3 = device(B);
  await D3.open(U1, FA);
  info = D3.box.nbCameoInfo("neo");
  assert.deepEqual([info.locked, info.available], [true, false]);
  assert.match(info.why, /in the cloud but couldn't be loaded/);
  B.fail = {};
  const full = await D3.box.nbLoadCameoFull("neo");
  assert.ok(full && full.url.startsWith("data:image/"), "it loads once the cloud answers");
  assert.equal(D3.box.nbCameoInfo("neo").available, true);
  const teamFail = device(B);
  B.fail.download = true;
  await teamFail.open(U2, FA);
  info = teamFail.box.nbCameoInfo("neo");
  assert.deepEqual([info.locked, info.mine, info.available], [true, false, false]);
  assert.match(info.why, /teammate's likeness is synced for this character, but its photos couldn't be loaded/);
  B.fail = {};
});

await test("G4 every lock / sync / revoke / load says 'turn-cameo-changed' { charId }", async () => {
  const B = freshBackend(), D = device(B), w = D.box;
  await D.open(U1, FA);
  D.events.length = 0;
  await D.lock("maya");
  await w.nbSyncCameo("maya", true);
  await w.nbRevokeCameo(w.nbCameoEntryFor("maya"));
  await w.nbCameoRefresh();
  const reasons = D.changed().map((d) => d.reason + ":" + (d.charId || "*"));
  for (const want of ["lock:maya", "sync:maya", "revoke:maya", "load:*"]) assert.ok(reasons.includes(want), want + " in " + reasons.join(" "));
});

await test("G5 deleting a plain film removes every capturer's likeness photos (the owner's one-hour grant) and this account's copies on this device", async () => {
  const B = freshBackend(), owner = device(B), ad = device(B);
  await ad.open(U2, FA); await ad.lock("maya", { sync: true });
  await owner.open(U1, FA); await owner.lock("neo", { sync: true });
  assert.equal(B.files.size, 4);
  const r = await owner.box.cloudDeleteProject(FA);
  assert.equal(r.ok, true);
  assert.equal(B.files.size, 0, "every likeness photo of the film is gone: " + Array.from(B.files.keys()).join(" "));
  assert.ok(!owner.idbKeys().some((k) => k.includes(FA)), "this account's copies of the film's likenesses left this device");
  assert.equal(owner.box.nbListOtherCameos().length, 0);
});

await test("G6 (2026-10-10, owner — Show/Episode delete files) deleting a plain film removes its generated files too, never one another of the owner's films still names; before that SQL, the likeness photos only", async () => {
  const run = async (installed) => {
    const B = freshBackend(), owner = device(B);
    B.noFilmDeleteCleanup = !installed;
    await owner.open(U1, FA); await owner.lock("neo", { sync: true });
    const sheet = U1 + "/" + FA + "/character/neo/20261010-100000-sheet-aaaa0001.png";
    const ref = U1 + "/" + FA + "/character/neo/20261010-100000-ref-aaaa0002.png";
    const shared = U1 + "/" + FA + "/character/trin/20261010-100000-sheet-aaaa0003.png";
    const elsewhere = U1 + "/" + FB + "/character/neo/20261010-100000-sheet-bbbb0001.png";
    for (const p of [sheet, ref, shared, elsewhere]) B.files.set(p, { bytes: new Uint8Array([1]), type: "image/png" });
    B.gens.push({ project_id: FA, entity_id: "neo", storage_path: sheet, refs: [{ storage_path: ref }, { storage_path: elsewhere }], meta: {} },
      { project_id: FA, entity_id: "trin", storage_path: shared, refs: [], meta: {} },
      { project_id: FB, entity_id: "trin", storage_path: elsewhere, refs: [{ storage_path: shared }], meta: {} });
    const r = await owner.box.cloudDeleteProject(FA);
    assert.equal(r.ok, true);
    return { B, left: Array.from(B.files.keys()).sort() };
  };
  const now = await run(true);
  assert.deepEqual(now.left, [U1 + "/" + FA + "/character/trin/20261010-100000-sheet-aaaa0003.png",
    U1 + "/" + FB + "/character/neo/20261010-100000-sheet-bbbb0001.png"].sort(), "the film's own files and photos went; the shared one and the other film's stayed");
  assert.ok(now.B.log.indexOf("rpc:turn_film_delete_cleanup") >= 0);
  const before = await run(false);
  assert.equal(before.left.length, 4, "without the SQL: the likeness photos go, the generated files stay (as before): " + before.left.join(" "));
  assert.ok(!before.left.some((p) => p.includes("/cameo/")));
});

await test("H1 the Likenesses window: this film / your other films / earlier; a teammate's photos only for the film's owner; 'Use for Maya in this film'", async () => {
  const B = freshBackend(), owner = device(B), ad = device(B);
  await ad.open(U2, FA); await ad.lock("maya", { sync: true });
  await owner.open(U1, FB); await owner.lock("neo");
  owner.box.localStorage.setItem("turn-cameo-registry", JSON.stringify({ maya: { consent: true, angleCount: 1, source: "webcam", iso: "2026-09-01T09:00:00.000Z" } }));
  await owner.box.idbSet("turn-cameo-maya", { url: jpg(80), consent: true, iso: "2026-09-01T09:00:00.000Z" });
  await owner.open(U1, FA);
  const nameOf = (id) => ({ maya: "Maya", neo: "Neo" })[id] || id;
  const render = async (D) => { const r = D.R.ReactDOM.createRoot({}); r.render(D.box.React.createElement(D.box.CameoManager, { nameOf, onClose: noop, onChanged: noop })); await settle(); return r; };
  let root = await render(owner);
  let t = textOf(root.tree);
  assert.match(t, /Likenesses/); assert.match(t, /This film/); assert.match(t, /Your other films on this device/); assert.match(t, /Earlier likenesses \(not tied to a film\)/);
  assert.match(t, /A teammate's · synced/);
  const teamRow = nodesOf(root.tree).find((n) => n.props && String(n.props["data-key"] || "").startsWith(FA + "|maya|" + U2));
  assert.ok(teamRow && nodesOf(teamRow).some((n) => n.type === "img"), "the film's owner sees the teammate's photos");
  assert.ok(nodesOf(root.tree).some((n) => n.props && n.props["data-role"] === "adopt" && /Use for Maya in this film/.test(textOf(n))));
  root.unmount();
  await ad.open(U2, FA);
  await owner.open(U1, FA); await owner.lock("trin", { sync: true });
  await ad.open(U2, FA);
  root = await render(ad);
  const ownerRow = nodesOf(root.tree).find((n) => n.props && String(n.props["data-key"] || "").startsWith(FA + "|trin|" + U1));
  assert.ok(ownerRow, "the Art director's window lists the owner's synced likeness");
  assert.ok(!nodesOf(ownerRow).some((n) => n.type === "img"), "…without its photos");
  assert.ok(!nodesOf(ownerRow).some((n) => n.props && n.props["data-role"] === "revoke"), "…and can't remove it");
  root.unmount();
});

await test("Z the card's Remove revokes where it lives; the manager gets the cast; Frances; keys", () => {
  const art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");
  assert.ok(art.includes("await window.cameoRevokeFlow(c.id, { name:c.name, stateLabel });"));
  assert.ok(art.includes("React.createElement(CameoManager,{nameOf,characters,onClose:()=>setMgrOpen(false),onChanged:refreshCount})"));
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b) + ";this.__F=APP_FEATURES;", fb);
  const f = fb.__F.find(x => x.name === "Likeness (Art Room)");
  assert.ok(f && !fb.__F.some(x => /^Cameo/.test(x.name)));
  for (const now of ["A LIKENESS BELONGS TO ONE FILM'S CHARACTER", "'Me' or 'Someone else'", "they're 18 or over", "ON A SHARED FILM a synced likeness",
    "sends the face photos first, numbered", "REMOVING a likeness removes it where it lives", "temporary copy of the photos used for an image render is deleted"])
    assert.ok(f.what.includes(now), now);
  const all = fb.__F.map(x => x.what).join(" ");
  assert.ok(!/\bcameo\b/i.test(all), "no 'cameo' left in what Frances is told");
  for (const file of ["cameo.jsx", "imagegen.jsx", "cloud.jsx", "artroom.jsx", "app.jsx", "agents.jsx", "stage.jsx", "ai.jsx", "script.jsx", "image-slot.js"])
    assert.ok(["20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('app/' + file + '?v=' + k + '"')), file);
  assert.ok(["20261010-like1", "20261010-voice1", "20261010-pose2", "20261010-del1", "20261010-pron1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

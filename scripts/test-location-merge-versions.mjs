#!/usr/bin/env node
/* test-location-merge-versions.mjs — A MERGE KEEPS THE OTHER CARD'S PLATES (2026-10-14, the gaps an independent check
   found in fix A of the Fondamenta plan). Merging Glass Hours' "Fondamenta" and "Fondamenta DEI Vetrai" used to send
   the merged-away card's own plate (and any extra-space / environment-state plates) to Recently deleted only — and that
   card can't come back, because the merged card took its name. Now:
   1. the plan lists the merged-away card's own images (locations.jsx locationMergeCarryIds: its plate, its extra-space
      plates, its own environment-state plates — the ones deleting it for good would clear) and the confirm says what
      happens to them; an Art director's merge says plainly that the scene card keeps its heading and the merged place
      still reads correctly, and that the owner's merge corrects it;
   2. imagegen.jsx nbCarryVersionsInto, on this device: COPIES go in front of the kept card's earlier versions, its
      current plate untouched, each copy saying where it came from, the other asset's approval / copy check / cleanup
      ledger dropped, never carried twice, nothing written once the film switched;
   3. the same through cloud.jsx cloudCarryVersions against a recording Supabase fake: each copy is a NEW file in the
      writer's folders (so deleting the other card for good never takes the kept card's history with it), the row is
      written compare-and-set (retried on a concurrent change), a write that didn't land removes its copies and one whose
      answer was lost is recognised (or its copies kept when that can't be told), a Show card read from its episode;
   4. the wiring: app.jsx mergeLocations copies after the confirmed merge (never before, never on Cancel); Details
      names the card a version came from (artroom.jsx nbCarriedFromLabel, "Kept from") and the card's earlier-versions
      count re-reads; Frances knows all of it, and that an older film's two area names tidy themselves.
   Fixture: scripts/fixtures/glass-hours-locations.json (read-only). No network, no provider: nothing is generated or
   charged. node scripts/test-location-merge-versions.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const json = (x) => JSON.parse(JSON.stringify(x));
const noop = () => {};
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const P = "loc-fondamenta-3", C = "loc-fondamenta-dei-vetrai-4";
let pass = 0;
const ok = (name, fn) => { fn(); pass++; };

/* ---- 1. the plan and the confirm ---- */
const box = { console, React: { createElement: () => null }, setTimeout, clearTimeout, localStorage: { getItem: () => null },
  Icon: new Proxy({}, { get: () => noop }), addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  CustomEvent: class {}, nbEpoch: () => 1, nbCostChip: () => null, appToast: noop, renderStyleText: () => "Photoreal",
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)) };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
const images = { [P]: "data:image/png;base64,AA", [C]: "data:image/png;base64,BB" };
const hasPlate = (id) => !!images[id];
box.turnContinuity = { locations: film.locations, scenes: film.scenes, drafts: film.drafts };
const planOf = (locs, opts) => json(box.locationMergePlan(locs, film.scenes, film.drafts, C, P, { hasPlate, nameFrom: C, ...(opts || {}) }));

ok("the carry list: exactly the images the merged-away card takes to Recently deleted under its own id", () => {
  assert.deepEqual(json(box.locationMergeCarryIds(film.locations.find((l) => l.id === C))),
    [{ id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "" }]);
  const rich = { id: "loc-x", name: "Quay", coverageSheets: [{ id: "cov-ext", name: "Quay exterior" }, { id: "cov-ext", name: "dup" }, { name: "no id" }],
    variants: [{ id: "v1", time: "Night", state: "Storm" }, { id: "v2", time: "", state: "" }] };
  assert.deepEqual(json(box.locationMergeCarryIds(rich)), [
    { id: "loc-x", cardId: "loc-x", name: "Quay", what: "plate", label: "" },
    { id: "loc-x-cov-ext", cardId: "loc-x", name: "Quay", what: "extra space", label: "Quay exterior" },
    { id: "loc-x-v1", cardId: "loc-x", name: "Quay", what: "environment state", label: "Night · Storm" },
    { id: "loc-x-v2", cardId: "loc-x", name: "Quay", what: "environment state", label: "" }]);
  // the same ids app.jsx purgeLocation clears for that card (its own id, its variants', its coverage sheets')
  const purge = read("app/app.jsx");
  assert.match(purge, /const ids = \[id,\n\s+\.\.\.\(item\.variants\|\|\[\]\)\.map\(v=>id\+"-"\+v\.id\),\n\s+\.\.\.\(item\.coverageSheets\|\|\[\]\)\.map\(v=>id\+"-"\+v\.id\)\];/);
  assert.deepEqual(json(box.locationMergeCarryIds(null)), []);
});

ok("on Glass Hours: the plan carries Fondamenta DEI Vetrai's plate, and the confirm says so", () => {
  const plan = planOf(film.locations);
  assert.deepEqual([plan.keeperId, plan.goneId, plan.name], [P, C, "Fondamenta dei Vetrai"]);
  assert.deepEqual(plan.carry, [{ id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "", hasImage: true }]);
  const conf = json(box.locationMergeConfirmText(plan, { canFixScenes: true }));
  assert.equal(conf.items[2], "A copy of its image is kept on the merged card too, as an earlier version in its image’s version history (⋯ › Details › Earlier versions, where Restore makes it the current image); “Fondamenta”’s current image stays as it is.");
  assert.equal(conf.body, "They become one location card. Nothing is generated and nothing is charged.", "still free");
  assert.equal(conf.items[1], "“Fondamenta DEI Vetrai”’s scenes join it (and any description it has that the other card lacks); its card moves to Recently deleted with its own image — nothing is deleted for good (it stays there: the merged card now has its name, so it can’t come back as a card of its own).", "the rest as it was");
});

ok("the confirm's wording follows what there is to carry", () => {
  const locs = film.locations.map((l) => l.id === C ? { ...l, coverageSheets: [{ id: "cov1", name: "Landing" }], variants: [{ id: "v1", time: "Night", state: "Fog" }] } : l);
  images[C + "-cov1"] = images[C + "-v1"] = "data:image/png;base64,CC";
  let items = json(box.locationMergeConfirmText(planOf(locs), { canFixScenes: true })).items;
  assert.equal(items[2], "Copies of its image and its 2 other images are kept on the merged card too, as earlier versions in its image’s version history (⋯ › Details › Earlier versions, where Restore makes one the current image); “Fondamenta”’s current image stays as it is.");
  delete images[C + "-v1"];
  items = json(box.locationMergeConfirmText(planOf(locs), { canFixScenes: true })).items;
  assert.match(items[2], /^Copies of its image and its other image are kept on the merged card too, as earlier versions/);
  delete images[C];
  items = json(box.locationMergeConfirmText(planOf(locs), { canFixScenes: true })).items;
  assert.match(items[2], /^A copy of its other image is kept on the merged card too, as an earlier version/);
  delete images[C + "-cov1"];
  items = json(box.locationMergeConfirmText(planOf(locs), { canFixScenes: true })).items;
  assert.ok(!items.some((t) => /kept on the merged card/.test(t)), "nothing to carry, nothing said");
  images[C] = "data:image/png;base64,BB";
  // the kept card has no plate of its own: nothing current is replaced, none is made
  const keeperless = (id) => id === C;
  const plan2 = json(box.locationMergePlan(film.locations, film.scenes, film.drafts, C, P, { hasPlate: keeperless, nameFrom: C }));
  assert.equal(plan2.keeperId, P, "the card with the shared layout stays");
  assert.match(json(box.locationMergeConfirmText(plan2, { canFixScenes: true })).items[2], /; the merged card has no current image, and none is made\.$/);
});

ok("an Art director's merge: the scene card keeps its heading, the place still reads correctly, the owner's merge corrects it", () => {
  const plan = planOf(film.locations);
  const ad = json(box.locationMergeConfirmText(plan, { canFixScenes: false })).items;
  assert.equal(ad[3], "Scene 13’s card keeps its heading as it is, EXT. FONDAMENTA · NIGHT: an Art director can’t edit scenes. The merged place still reads correctly — scene 13, its shots and its variant images are read as “Fondamenta dei Vetrai”. (The owner’s merge corrects the heading to EXT. FONDAMENTA DEI VETRAI · NIGHT; after yours, the owner can change it on the scene card.)");
  const owner = json(box.locationMergeConfirmText(plan, { canFixScenes: true })).items;
  assert.equal(owner[3], "Scene 13’s card slugline is corrected to EXT. FONDAMENTA DEI VETRAI · NIGHT, as its screenplay says.");
  // what it says is true: after the merge, scene 13 (card not corrected) still reads as the merged place
  const res = json(box.locationMergeApply(film.locations, plan, { at: "T" }));
  box.setLocationPlaceDecisions(box.locationPlaceDecisions(res.locations, [res.gone]));
  assert.deepEqual(json(box.deriveLocations(film.scenes, [...res.locations, res.gone], film.drafts)), [], "no 'Fondamenta' card comes back for it");
  const units = json(box.deriveSluglineUnits(film.scenes, film.drafts)).filter((u) => /fondamenta/.test(u.key));
  assert.deepEqual(units.map((u) => [u.key, u.subspaceKey]), [["fondamenta-dei-vetrai|EXT|Dusk", "fondamenta-dei-vetrai"],
    ["fondamenta-dei-vetrai|EXT|Night", "fondamenta-dei-vetrai"]], "its room & time plates are the merged card's (its key)");
  assert.equal(res.locations.find((l) => l.id === P).key, "fondamenta-dei-vetrai");
  box.setLocationPlaceDecisions(box.locationPlaceDecisions([], []));
});

/* ---- 2. on this device (imagegen.jsx nbCarryVersionsInto, local backend) ---- */
const ig = read("app/imagegen.jsx");
const slice = ig.slice(ig.indexOf("const NB_CARRY_DROP_META"), ig.indexOf("window.nbCarryVersionsInto = nbCarryVersionsInto;") + "window.nbCarryVersionsInto = nbCarryVersionsInto;".length);
assert.ok(slice.length > 500, "the carry code");
const local = { img: {}, meta: {}, hist: {}, events: [] };
const lb = { console, _nbEpoch: 1, _nbBackend: "local", _nbUid: "user", _nbProject: "film", _scopeFor: () => "film",
  _nbSerial: (id, f) => f(), CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  localGetHistory: async (id) => json(local.hist[id] || []), localSetHistory: async (id, h) => { local.hist[id] = json(h); },
  localLoadImage: async (id) => local.img[id] || "", localGetMeta: (id) => local.meta[id] ? json(local.meta[id]) : null };
lb.window = { dispatchEvent: (e) => local.events.push([e.type, e.detail && e.detail.id]) };
vm.createContext(lb); vm.runInContext(slice, lb, { filename: "imagegen.jsx (carry)" });
const SRC = [{ id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "" },
  { id: C + "-cov1", cardId: C, name: "Fondamenta DEI Vetrai", what: "extra space", label: "Landing" }];
const goneMeta = { iso: "2026-10-13T22:04:46.571Z", version: 2, modelId: "gpt-image-2.5", prompt: "Camera standing on Fondamenta DEI Vetrai…",
  approval: { iso: "2026-10-13T22:04:46.571Z", approved: true }, copyCheck: { near: true, iso: "2026-10-13T22:04:46.571Z", parentId: P },
  cleanupPending: ["user/film/x.png"], deletedStoragePath: "user/film/y.png" };

{
  local.img[P] = "data:image/png;base64,KEEP"; local.meta[P] = { iso: "K2", version: 2 };
  local.hist[P] = [{ url: "data:image/png;base64,K1", meta: { iso: "K1", version: 1 }, refs: [{ kind: "x" }] }];
  local.img[C] = "data:image/png;base64,GONE"; local.meta[C] = goneMeta;
  const r = json(await lb.nbCarryVersionsInto(P, SRC, { at: "2026-10-14T12:00:00Z" }));
  assert.deepEqual(r, { ok: true, carried: 1, skipped: 1, failed: [] }, "the plate carried; the extra space has no image");
  assert.equal(local.img[P], "data:image/png;base64,KEEP", "the current plate is never replaced");
  assert.deepEqual(local.meta[P], { iso: "K2", version: 2 });
  assert.equal(local.hist[P].length, 2);
  assert.equal(local.hist[P][0].url, "data:image/png;base64,GONE", "the copy comes first, behind the current plate");
  assert.deepEqual(local.hist[P][1], { url: "data:image/png;base64,K1", meta: { iso: "K1", version: 1 }, refs: [{ kind: "x" }] }, "its own earlier versions as they were");
  const m = local.hist[P][0].meta;
  assert.deepEqual(m.carriedFrom, { id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "", iso: "2026-10-13T22:04:46.571Z", at: "2026-10-14T12:00:00Z" });
  assert.deepEqual([m.iso, m.version, m.modelId, m.prompt], [goneMeta.iso, 2, "gpt-image-2.5", goneMeta.prompt], "what the version was");
  for (const k of ["approval", "copyCheck", "cleanupPending", "deletedStoragePath"]) assert.ok(!(k in m), k + " belonged to the other card");
  assert.deepEqual(local.hist[P][0].refs, []);
  assert.deepEqual(local.meta[C], goneMeta, "the original is untouched (it stays with its card in Recently deleted)");
  assert.equal(local.img[C], "data:image/png;base64,GONE");
  assert.deepEqual(local.events, [["nb-history-changed", P]], "the card's earlier-versions count re-reads");
  // never twice
  const again = json(await lb.nbCarryVersionsInto(P, SRC, { at: "later" }));
  assert.deepEqual(again, { ok: true, carried: 0, skipped: 2, failed: [] });
  assert.equal(local.hist[P].length, 2);
  // …but a NEW version of the same source is another version
  local.meta[C] = { ...goneMeta, iso: "G3" }; local.img[C] = "data:image/png;base64,GONE3";
  assert.equal((await lb.nbCarryVersionsInto(P, SRC.slice(0, 1))).carried, 1);
  assert.equal(local.hist[P][0].url, "data:image/png;base64,GONE3");
  // the film switched: nothing written
  local.events = [];
  const before = json(local.hist[P]);
  lb.localLoadImage = async (id) => { lb._nbEpoch = 2; return local.img[id] || ""; };
  local.meta[C] = { ...goneMeta, iso: "G4" };
  const st = json(await lb.nbCarryVersionsInto(P, SRC.slice(0, 1)));
  assert.equal(st.ok, false); assert.equal(st.error, "asset scope changed");
  assert.deepEqual(local.hist[P], before); assert.deepEqual(local.events, []);
  lb.localLoadImage = async (id) => local.img[id] || ""; lb._nbEpoch = 1;
  // nothing to do: itself, nobody, no target
  assert.deepEqual(json(await lb.nbCarryVersionsInto(P, [{ id: P }])), { ok: true, carried: 0, skipped: 0, failed: [] });
  assert.deepEqual(json(await lb.nbCarryVersionsInto("", SRC)), { ok: true, carried: 0, skipped: 0, failed: [] });
  // a kept card with no plate of its own: the copy waits in its earlier versions, nothing becomes current
  delete local.img["loc-empty"];
  assert.equal((await lb.nbCarryVersionsInto("loc-empty", SRC.slice(0, 1))).carried, 1);
  assert.equal(local.img["loc-empty"], undefined);
  assert.equal(local.hist["loc-empty"].length, 1);
  // a copy already restored as the current plate (Restore) is not carried again
  local.meta[C] = { ...goneMeta, iso: "G5" }; local.img[C] = "data:image/png;base64,G5";
  local.img["loc-restored"] = "data:image/png;base64,G5"; local.meta["loc-restored"] = { iso: "G5", carriedFrom: { id: C, iso: "G5" } };
  assert.deepEqual(json(await lb.nbCarryVersionsInto("loc-restored", SRC.slice(0, 1))), { ok: true, carried: 0, skipped: 1, failed: [] });
  assert.equal(local.hist["loc-restored"], undefined);
}

/* ---- 3. in the cloud (cloud.jsx cloudCarryVersions, through nbCarryVersionsInto) ---- */
const rows = new Map(), files = new Map();
let tick = 0, uploads = [], removed = [], hooks = {};
const K = (p, e) => p + "|" + e;
const stampRow = (r) => ({ ...r, updated_at: "2026-10-14T00:00:" + String(++tick).padStart(2, "0") + ".000Z" });
class Q {
  constructor() { this.op = "read"; this.filters = []; this.inF = null; }
  select() { return this; } eq(k, v) { this.filters.push([k, v]); return this; } is(k, v) { this.filters.push([k, v, "is"]); return this; }
  in(k, vs) { this.inF = [k, vs]; return this; } contains() { return this; } order() { return this; } limit() { return this; }
  update(v) { this.op = "update"; this.value = v; return this; } insert(v) { this.op = "insert"; this.value = v; return this; }
  upsert(v) { this.op = "upsert"; this.value = v; return this; } delete() { this.op = "delete"; return this; }
  _match(r) { return this.filters.every(([k, v, m]) => m === "is" ? r[k] == null && v == null : r[k] === v) && (!this.inF || this.inF[1].includes(r[this.inF[0]])); }
  async _run(single) {
    const hit = [...rows.values()].filter((r) => this._match(r));
    if (this.op === "read") {
      if (hooks.failRead && hooks.failRead()) return { data: null, error: { message: "injected read failure" } };
      return { data: single ? (hit[0] ? json(hit[0]) : null) : hit.map(json), error: null };
    }
    if (this.op === "insert") {
      const k = K(this.value.project_id, this.value.entity_id);
      if (rows.has(k)) return { data: null, error: { message: "duplicate key" } };
      rows.set(k, stampRow(json(this.value))); return { data: json(rows.get(k)), error: null };
    }
    if (this.op === "upsert") { const k = K(this.value.project_id, this.value.entity_id); rows.set(k, stampRow({ ...(rows.get(k) || {}), ...json(this.value) })); return { data: json(rows.get(k)), error: null }; }
    if (this.op === "update") {
      if (hooks.beforeUpdate) hooks.beforeUpdate();
      const now = [...rows.values()].filter((r) => this._match(r));
      if (!now.length) return { data: null, error: null };
      now.forEach((r) => rows.set(K(r.project_id, r.entity_id), stampRow({ ...r, ...json(this.value) })));
      if (hooks.loseAnswer && hooks.loseAnswer()) return { data: null, error: { message: "injected lost answer" } };
      return { data: json(rows.get(K(now[0].project_id, now[0].entity_id))), error: null };
    }
    if (this.op === "delete") { hit.forEach((r) => rows.delete(K(r.project_id, r.entity_id))); return { data: single ? json(hit[0] || null) : hit.map(json), error: null }; }
    return { data: null, error: null };
  }
  maybeSingle() { return this._run(true); } single() { return this._run(true); }
  then(res, rej) { return this._run(false).then(res, rej); }
}
const storage = {
  async upload(path, blob) { files.set(path, await blob.text()); uploads.push(path); return { error: null }; },
  async remove(paths) { paths.forEach((p) => { files.delete(p); removed.push(p); }); return { error: null }; },
  async createSignedUrl(path) { return files.has(path) ? { data: { signedUrl: "https://signed.test/" + path }, error: null } : { data: null, error: { message: "not found" } }; },
  async createSignedUrls(paths) { return { data: paths.map((p) => ({ path: p, signedUrl: "https://signed.test/" + p })), error: null }; },
};
const sb = { from: () => new Q(), storage: { from: () => storage }, auth: { refreshSession: async () => ({}) } };
const cbx = { console, Blob, Uint8Array, atob, Date, Math, Map, Set, JSON, Promise, URL,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, document: {}, navigator: {}, location: { origin: "https://app.test" },
  fetch: async (url) => { const p = String(url).replace("https://signed.test/", ""); return files.has(p) ? { ok: true, blob: async () => new Blob([files.get(p)], { type: "image/png" }) } : { ok: false, status: 404 }; },
  setTimeout, clearTimeout, setInterval, clearInterval };
cbx.window = cbx; cbx.globalThis = cbx; cbx._sbClient = sb;
vm.createContext(cbx);
vm.runInContext(read("app/cloud.jsx"), cbx, { filename: "app/cloud.jsx" });
cbx.events = [];
vm.runInContext("var _nbEpoch=1, _nbBackend='cloud', _nbUid='user', _nbProject='film'; var _nbSerial=(id,f)=>f();"
  + "var _scopeFor=(id)=>String(id).indexOf('show:')===0?'show':(window.__showIds||[]).some(b=>String(id)===b||String(id).indexOf(b+'-')===0)?'show':'film';", cbx);
cbx.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } };
cbx.dispatchEvent = (e) => { cbx.events.push([e.type, e.detail && e.detail.id]); return true; };
vm.runInContext(slice, cbx, { filename: "imagegen.jsx (carry)" });
const put = (r) => { rows.set(K(r.project_id, r.entity_id), stampRow(json(r))); (r.storage_path ? [r.storage_path] : []).concat((r.history || []).map((h) => h.storage_path)).forEach((p) => p && files.set(p, "bytes:" + p)); };
const reset = () => {
  rows.clear(); files.clear(); uploads = []; removed = []; hooks = {}; cbx.events = []; cbx._nbEpoch = 1;
  put({ project_id: "film", owner: "owner", entity_id: P, storage_path: "owner/film/location/" + P + "/cur.png", meta: { iso: "K2", version: 2 },
    refs: [{ storage_path: "owner/film/location/" + P + "/ref.png" }], history: [{ storage_path: "owner/film/location/" + P + "/k1.png", meta: { iso: "K1" }, refs: [] }] });
  // (no cleanup ledger on the stored row: reading a row that has one finishes its cleanup first, as the app always does)
  put({ project_id: "film", owner: "owner", entity_id: C, storage_path: "owner/film/location/" + C + "/gone.png", meta: goneCloudMeta,
    refs: [], history: [{ storage_path: "owner/film/location/" + C + "/gone-old.png", meta: { iso: "G0" }, refs: [] }] });
};
const row = (e, p = "film") => json(rows.get(K(p, e)));
const goneCloudMeta = (() => { const m = { ...goneMeta }; delete m.cleanupPending; return m; })();
const carry = (target = P, src = SRC) => cbx.nbCarryVersionsInto(target, src, { at: "2026-10-14T12:00:00Z" });

{
  reset();
  const keptBefore = row(P), goneBefore = row(C);
  const r = json(await carry());
  assert.deepEqual(r, { ok: true, carried: 1, skipped: 1, failed: [] }, JSON.stringify(r));
  const kept = row(P);
  assert.deepEqual([kept.storage_path, kept.meta, kept.refs], [keptBefore.storage_path, keptBefore.meta, keptBefore.refs], "its current file, meta and refs untouched");
  assert.equal(kept.history.length, 2);
  const copy = kept.history[0];
  assert.match(copy.storage_path, new RegExp("^user/film/location/" + P + "/"), "a NEW file, in the writer's own folders under the kept card");
  assert.notEqual(copy.storage_path, goneBefore.storage_path);
  assert.equal(files.get(copy.storage_path), "bytes:" + goneBefore.storage_path, "the same pixels");
  assert.deepEqual(kept.history[1], keptBefore.history[0]);
  assert.equal(copy.meta.carriedFrom.id, C); assert.equal(copy.meta.carriedFrom.iso, goneMeta.iso);
  assert.ok(!("approval" in copy.meta) && !("copyCheck" in copy.meta) && !("deletedStoragePath" in copy.meta), "the other card's own records stay with it");
  assert.deepEqual(copy.refs, []);
  assert.deepEqual(row(C), goneBefore, "the merged-away card's row is untouched");
  assert.deepEqual(uploads, [copy.storage_path]); assert.deepEqual(removed, []);
  assert.deepEqual(cbx.events, [["nb-history-changed", P]]);
  // never twice
  uploads = [];
  const again = json(await carry());
  assert.deepEqual([again.ok, again.carried, again.skipped], [true, 0, 2]);
  assert.deepEqual(uploads, [], "no copy made for a version already carried");
  assert.equal(row(P).history.length, 2);
  // deleting the merged-away card for good (Recently deleted → Delete forever) leaves the kept card's copy
  await cbx.cloudClear("film", C);
  assert.ok(removed.includes(goneBefore.storage_path), "its own file goes");
  assert.ok(files.has(copy.storage_path) && !removed.includes(copy.storage_path), "the copy is the kept card's own file");
  assert.equal(row(P).history[0].storage_path, copy.storage_path);
}
{
  // the copy restored as the kept card's current plate (Restore): the same source version is not copied again
  reset();
  await carry(P, SRC.slice(0, 1));
  const r0 = row(P), copy = r0.history[0];
  rows.set(K("film", P), stampRow({ ...r0, storage_path: copy.storage_path, meta: copy.meta,
    history: [{ storage_path: r0.storage_path, meta: r0.meta, refs: r0.refs }].concat(r0.history.slice(1)) }));
  uploads = [];
  const again = json(await carry(P, SRC.slice(0, 1)));
  assert.deepEqual([again.ok, again.carried, again.skipped], [true, 0, 1]);
  assert.deepEqual(uploads, [], "no second copy of the version that is now current");
}
{
  // a concurrent change to the kept card while copying: re-read, then written on top of it
  reset();
  let once = true;
  hooks.beforeUpdate = () => { if (!once) return; once = false; const r = row(P); r.history = [{ storage_path: "owner/film/location/" + P + "/k2.png", meta: { iso: "K2" }, refs: [] }].concat(r.history); r.storage_path = "owner/film/location/" + P + "/k3.png"; r.meta = { iso: "K3", version: 3 }; rows.set(K("film", P), stampRow(r)); };
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.deepEqual([r.ok, r.carried], [true, 1]);
  const kept = row(P);
  assert.equal(kept.storage_path, "owner/film/location/" + P + "/k3.png", "the newer current plate stays current");
  assert.deepEqual(kept.history.map((h) => h.meta.iso), [goneMeta.iso, "K2", "K1"]);
  assert.deepEqual(removed, []);
}
{
  // it keeps changing: given up, and the copy made for it removed
  reset();
  hooks.beforeUpdate = () => { const r = row(P); rows.set(K("film", P), stampRow(r)); };
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.equal(r.ok, false); assert.equal(r.error, "The card changed while its earlier versions were being added.");
  assert.equal(uploads.length, 1); assert.deepEqual(removed, uploads, "no orphan copy left behind");
  assert.equal(row(P).history.length, 1);
}
{
  // the write landed but its answer was lost: recognised by its exact file — kept, not copied again
  reset();
  let once = true; hooks.loseAnswer = () => { const l = once; once = false; return l; };
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.deepEqual([r.ok, r.carried], [true, 1]);
  assert.equal(uploads.length, 1); assert.deepEqual(removed, []);
  assert.equal(row(P).history[0].storage_path, uploads[0]);
  assert.equal(row(P).history.length, 2);
}
{
  // …and when that can't be told (the re-read fails too), the copy is kept rather than risk a version's file
  reset();
  let lost = false;
  hooks.loseAnswer = () => { if (lost) return false; lost = true; return true; };
  hooks.failRead = () => lost;
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.equal(r.ok, false); assert.equal(r.persisted, "unknown");
  assert.deepEqual(removed, [], "never removed while it may be in use");
}
{
  // a kept card with no plate yet: a row holding only the earlier version (nothing current is made)
  reset();
  rows.delete(K("film", P));
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.deepEqual([r.ok, r.carried], [true, 1]);
  const kept = row(P);
  assert.equal(kept.storage_path, null); assert.deepEqual(kept.refs, []); assert.equal(kept.history.length, 1);
  assert.equal(kept.owner, "user");
}
{
  // the film switched while copying: nothing written, the copy removed
  reset();
  const realFetch = cbx.fetch;
  cbx.fetch = async (u) => { cbx._nbEpoch = 2; return realFetch(u); };
  const r = json(await carry(P, SRC.slice(0, 1)));
  cbx.fetch = realFetch;
  assert.equal(r.ok, false); assert.equal(r.error, "asset scope changed");
  assert.equal(row(P).history.length, 1); assert.deepEqual(removed, uploads);
  assert.deepEqual(cbx.events, []);
}
{
  // a Show's shared card whose plate is still in its episode (a film made into a Show): read from there
  reset();
  cbx.__showIds = [P, C];
  put({ ...row(P), project_id: "show" });
  const r = json(await carry(P, SRC.slice(0, 1)));
  assert.deepEqual([r.ok, r.carried], [true, 1], JSON.stringify(r));
  assert.equal(row(P, "show").history[0].meta.carriedFrom.id, C);
  assert.equal(files.get(row(P, "show").history[0].storage_path), "bytes:owner/film/location/" + C + "/gone.png");
  cbx.__showIds = [];
}
pass++;

/* ---- 4. the wiring, Details, Frances ---- */
ok("app.jsx: copied after the confirmed merge, onto the kept card, told when it fails", () => {
  const app = read("app/app.jsx");
  const merge = app.slice(app.indexOf("const mergeLocations = async (aId, bId, opts)=>{"), app.indexOf("const decideLocationPlace"));
  const at = merge.indexOf("nbCarryVersionsInto(plan.keeperId, carry)");
  assert.ok(at > 0, "the kept card");
  assert.ok(merge.indexOf("window.appConfirm(locationMergeConfirmText(plan") < at && merge.indexOf("if(!ok || projIdRef.current!==film0) return;") < at, "never before the confirm (Cancel returns first)");
  assert.ok(merge.indexOf("setTrash(t=>({ ...t, locations:[ _trashStamp(res.gone)") < at, "after the merge itself");
  assert.match(merge, /const carry = \(plan\.carry\|\|\[\]\)\.map\(c=>\(\{ id:c\.id, cardId:c\.cardId, name:c\.name, what:c\.what, label:c\.label \}\)\);/);
  assert.match(merge, /if\(!r \|\| projIdRef\.current!==film1 \|\| typeof window\.appToast!=="function"\) return;/, "only on the film it started in");
  // what went wrong is said in fixed words (never a storage or database error's own text), and where the originals are
  assert.match(merge, /const many = \(\(plan\.carry\|\|\[\]\)\.filter\(c=>c && c\.hasImage\)\.length \|\| carry\.length\)!==1;/, "one plate or several, as the confirm said");
  assert.match(merge, /const carryFailText = \(\)=> "Couldn\\u2019t copy \\u201c"\+plan\.goneName\+"\\u201d\\u2019s image"\+\(many \? "s" : ""\)\+" onto \\u201c"\+plan\.name\+"\\u201d\. "/);
  assert.match(merge, /\+\(many \? "The originals are" : "The original is"\)\+" still with \\u201c"\+plan\.goneName\+"\\u201d\\u2019s card in Recently deleted\.";/);
  assert.match(merge, /if\(r\.persisted==="unknown"\) window\.appToast\("Couldn\\u2019t confirm that "/, "a write whose outcome is unknown says so");
  assert.match(merge, /the others couldn\\u2019t be copied\."\+originals,"error"\)/, "some copied, some not");
  assert.match(merge, /if\(r\.error==="asset scope changed"\) return;/, "another film opened: nothing was written, nothing said");
  assert.doesNotMatch(merge.slice(at), /r\.error\)|String\(r\.error|e\.message/, "no raw error text in the toasts");
  assert.match(read("app/locations.jsx"), /carry:locationMergeCarryIds\(gone\)\.map\(c=>\(\{ \.\.\.c, hasImage:!!hasPlate\(c\.id\) \}\)\),/);
});

/* the toasts themselves: the carry block of mergeLocations run on each outcome nbCarryVersionsInto can give */
{
  const app = read("app/app.jsx");
  const merge = app.slice(app.indexOf("const mergeLocations = async (aId, bId, opts)=>{"), app.indexOf("const decideLocationPlace"));
  const block = merge.slice(merge.indexOf("const carry = (plan.carry||[])"), merge.lastIndexOf("};"));
  const toastsFor = async (result, carryList, opts) => {
    const toasts = [];
    const tb = { console, Promise, projIdRef: { current: "film" }, window: { appToast: (t, k) => toasts.push([k, t]) },
      plan: { keeperId: P, name: "Fondamenta dei Vetrai", goneName: "Fondamenta DEI Vetrai", carry: carryList },
      nbCarryVersionsInto: () => { if (opts && opts.switchFilm) tb.projIdRef.current = "other"; return opts && opts.reject ? Promise.reject(new Error("relation turn_generations: boom")) : Promise.resolve(result); } };
    vm.createContext(tb); vm.runInContext("(function(){" + block + "})()", tb);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    return toasts;
  };
  const one = [{ id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "", hasImage: true }];
  const three = one.concat([{ id: C + "-cov1", what: "extra space", hasImage: true }, { id: C + "-v1", what: "environment state", hasImage: true }]);
  assert.deepEqual(await toastsFor({ ok: true, carried: 1, skipped: 0, failed: [] }, one),
    [["info", "“Fondamenta DEI Vetrai”’s image is now an earlier version of “Fondamenta dei Vetrai”’s image (⋯ › Details › Earlier versions)."]]);
  assert.deepEqual(await toastsFor({ ok: true, carried: 3, skipped: 0, failed: [] }, three),
    [["info", "“Fondamenta DEI Vetrai”’s images are now earlier versions of “Fondamenta dei Vetrai”’s image (⋯ › Details › Earlier versions)."]]);
  assert.deepEqual(await toastsFor({ ok: false, carried: 2, skipped: 0, failed: [C + "-v1"] }, three),
    [["error", "2 of “Fondamenta DEI Vetrai”’s images are now earlier versions of “Fondamenta dei Vetrai”’s image (⋯ › Details › Earlier versions); the others couldn’t be copied. The originals are still with “Fondamenta DEI Vetrai”’s card in Recently deleted."]]);
  const raw = { ok: false, carried: 0, skipped: 0, failed: [C], error: "new row violates row-level security policy for table \"turn_generations\"" };
  assert.deepEqual(await toastsFor(raw, one),
    [["error", "Couldn’t copy “Fondamenta DEI Vetrai”’s image onto “Fondamenta dei Vetrai”. The original is still with “Fondamenta DEI Vetrai”’s card in Recently deleted."]], "never the database's own words");
  assert.deepEqual(await toastsFor({ ok: false, carried: 0, skipped: 0, failed: [C], persisted: "unknown", error: "The earlier versions may not have been added." }, one),
    [["error", "Couldn’t confirm that “Fondamenta DEI Vetrai”’s image was copied onto “Fondamenta dei Vetrai” — look in its ⋯ › Details › Earlier versions. The original is still with “Fondamenta DEI Vetrai”’s card in Recently deleted."]]);
  assert.deepEqual(await toastsFor(null, one, { reject: true }),
    [["error", "Couldn’t copy “Fondamenta DEI Vetrai”’s image onto “Fondamenta dei Vetrai”. The original is still with “Fondamenta DEI Vetrai”’s card in Recently deleted."]]);
  assert.deepEqual(await toastsFor({ ok: false, carried: 0, failed: [C], error: "asset scope changed" }, one), [], "another film opened: nothing said");
  assert.deepEqual(await toastsFor({ ok: true, carried: 1, failed: [] }, one, { switchFilm: true }), [], "said only on the film it started in");
  assert.deepEqual(await toastsFor({ ok: true, carried: 0, skipped: 1, failed: [] }, one), [], "nothing there to copy: nothing said");
  // one image known among several ids (its extra space has none): spoken of as one image
  assert.match((await toastsFor({ ok: false, carried: 0, failed: [C, C + "-cov1"], error: "x" }, one.concat([{ id: C + "-cov1", hasImage: false }])))[0][1], /^Couldn’t copy “Fondamenta DEI Vetrai”’s image onto/);
  pass++;
}

ok("Details names the card a version came from; the card's count re-reads", () => {
  const art = read("app/artroom.jsx");
  const fnSrc = art.slice(art.indexOf("function nbCarriedFromLabel("), art.indexOf("/* SheetDetails — a modal"));
  const ab = {}; vm.createContext(ab); vm.runInContext(fnSrc, ab);
  assert.equal(ab.nbCarriedFromLabel({ name: "Fondamenta DEI Vetrai", what: "plate" }), "From “Fondamenta DEI Vetrai”’s card");
  assert.equal(ab.nbCarriedFromLabel({ name: "Quay", what: "extra space", label: "Landing" }), "From “Quay”’s card · extra space: Landing");
  assert.equal(ab.nbCarriedFromLabel(null), "");
  assert.match(art, /const layerLabel = hm\.carriedFrom \? nbCarriedFromLabel\(hm\.carriedFrom\) : isEdit/);
  assert.match(art, /field\("Kept from", meta\.carriedFrom \? nbCarriedFromLabel\(meta\.carriedFrom\)\.replace\(\/\^From \/,""\)\+" (?:\\u2014|—) copied here when the two cards were merged" : null\),/);
  assert.match(art, /const prevLabel = prev && prev\.carriedFrom \? "the earlier version "\+nbCarriedFromLabel\(prev\.carriedFrom\)/);
  assert.match(art, /window\.addEventListener\("nb-history-changed", onHistory\);/);
  assert.match(ig, /window\.dispatchEvent\(new CustomEvent\("nb-history-changed",\{ detail:\{ id:targetId \} \}\)\)/);
});

ok("Frances knows: the copies, the Art director's merge, the copy check's role, older films' area names", () => {
  const ai = read("app/ai.jsx");
  const block = ai.slice(ai.indexOf("/* MERGE AND SMALL FIXES"), ai.indexOf("/* the public view of every entry, memoised"));
  assert.ok(block.length > 200, "a dated block just before the public view");
  assert.match(block, /A MERGE KEEPS THE OTHER CARD'S PLATES: when two location cards are merged, a copy of the merged-away card's plate \(and of its extra-space and environment-state plates\) is added to the merged card's plate as an earlier version/);
  assert.match(block, /The merged card's current plate is never replaced/);
  assert.match(block, /a room & time plate stays with its room & time, which the merged card keeps\. The copies count among the 12 versions an image keeps, so the oldest go first when the next plate is made\./);
  assert.match(block, /AN ART DIRECTOR'S MERGE LEAVES THE SCENE CARD'S HEADING AS IT IS: an Art director can't edit scenes, so the scene card whose slugline disagreed with its screenplay keeps its heading \\u2014 and the merged place still reads correctly/);
  assert.match(block, /The owner's merge corrects the heading to the screenplay's words/);
  assert.match(block, /a viewer who can't change the Art Room sees the notice's words without Regenerate or Keep/);
  assert.match(block, /OLDER FILMS: on a film made before 14 October 2026, the names read from the screenplay tidy themselves \\u2014 Italian and French particles \(dei, della, di, de, la, du, des\\u2026\) go lower-case in a card's areas and on its rooms & times \('Fondamenta dei Vetrai', not 'Fondamenta DEI Vetrai'\), and an area that was only a time of day \(from a heading ending '\\u00b7 NIGHTS'\) leaves the card's areas; the areas are saved that way the next time the owner or an Art director opens the film\. No 'regenerate' notice appears, and no card's own name, plate, layout or room & time plate changes\./);
  assert.doesNotMatch(block.slice(block.indexOf("lf.what")), /TURN|McKee|Claude|Anthropic/);
  // …and what it says about older films is what the code does (the sync rewrites derived areas, nothing else)
  const fresh = json(box.deriveLocations(film.scenes, [], film.drafts));
  assert.deepEqual(fresh.find((l) => l.key === "furnace").areas, ["Furnace Office"]);
  assert.deepEqual(film.locations.find((l) => l.key === "furnace").areas, ["Furnace Office", "Nights"]);
  assert.deepEqual(fresh.find((l) => l.key === "fondamenta").areas, ["Fondamenta dei Vetrai"]);
  // a room & time shows the tidied name; its key, and so its plate's id, are the ones the film already had
  const dusk = json(box.deriveSluglineUnits(film.scenes, film.drafts)).find((u) => u.key === "fondamenta-dei-vetrai|EXT|Dusk");
  assert.equal(dusk.name, "Fondamenta dei Vetrai");
  assert.equal(box.sluglineUnitImageId(dusk.key), "locunit-fondamenta-dei-vetrai-EXT-Dusk-177y36h", "the plate id an older film saved its room & time plate under");
  assert.equal(film.locations.find((l) => l.id === C).name, "Fondamenta DEI Vetrai", "a card's own saved name stays as it is");
  assert.match(read("app/app.jsx"), /const fields=\["scope","parentKey","continuityRootKey","scenes","episodeScenes","times","areas","intExt","episodeLocationMeta"\];/);
});

console.log("PASS location merge versions (" + pass + " groups): the merged-away card's plate, extra-space and environment-state plates are copied onto the kept card as earlier versions (its current plate never replaced; on this device and in the cloud, as new files, compare-and-set, never twice, nothing left behind on failure); the confirm says so, and says plainly what an Art director's merge leaves; Details names the source; Frances knows");

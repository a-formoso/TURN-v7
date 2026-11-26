#!/usr/bin/env node
/* A card's FIRST image in the making (2026-11-05, owner: "fix this" — a crowd card read "Drop a photo of the group"
   over "Generating…"): while SheetFrame has no image yet and is generating, drafting first or saving, the frame shows
   a busy state that says which ("Generating the image…" / "Drafting the spec first…" / "Saving the image…" /
   "Retrying with a simpler prompt…"), over the empty slot or the drop zone; with reference art in the slot it is
   see-through (.over-ref). Once there is an image — or nothing is running — there is no busy state.
   node scripts/test-sheet-busy.mjs */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";

const noop = () => {};
const src = readFileSync(new URL("../app/artroom.jsx", import.meta.url), "utf8");
const code = transformSync(src, { presets: [["@babel/preset-react", { runtime: "classic" }]], babelrc: false, configFile: false,
  filename: "artroom.jsx", compact: true }).code;
let stateOverride = null;
const s = { console: { ...console, warn: noop }, React: {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  createContext: () => ({ Provider: "provider" }), useContext: () => false,
  useState: (init) => [typeof init === "function" ? init() : init, noop], useEffect: noop, useLayoutEffect: noop,
  useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: "fragment",
}, Icon: new Proxy({}, { get: () => () => null }), localStorage: { getItem: () => null }, document: {},
  setTimeout: noop, setInterval: noop, addEventListener: noop, removeEventListener: noop };
s.window = s; vm.createContext(s); vm.runInContext(code, s);

const find = (n, p) => { if (!n || typeof n !== "object") return null; if (p(n)) return n;
  for (const c of n.children || []) { const f = find(c, p); if (f) return f; } return null; };
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const frame = (gen = {}, props = {}) => s.SheetFrame({
  gen: { genUrl: "", genMeta: null, gening: false, generate: noop, cancelGen: noop, allModels: [], layers: 0, ...gen },
  slotId: "crowdref-c1", name: "Crowd", drafted: true, noun: "crowd reference", slotPlaceholder: "Drop a photo of the group",
  hideUploadButton: true, ...props });
const busy = (t) => find(t, (n) => n.props && n.props["data-testid"] === "sheet-busy");
let checks = 0;
const ok = (name, fn) => { fn(); checks++; console.log("PASS", name); };

ok("a crowd card generating its first image says so in the frame, not 'Drop a photo of the group' alone", () => {
  const b = busy(frame({ gening: true }));
  assert.ok(b, "a busy state");
  assert.equal(text(b), "Generating the image…");
  assert.equal(b.props.role, "status"); assert.equal(b.props["aria-live"], "polite");
  assert.equal(b.props.className, "sheet-busy");
});
ok("saving, retrying simplified: the frame says which", () => {
  assert.equal(text(busy(frame({ gening: true, saving: true }))), "Saving the image…");
  assert.equal(text(busy(frame({ gening: true, retrying: true }))), "Retrying with a simpler prompt…");
});
ok("with reference art in the slot it is see-through; on a drop-zone card (characters, props) it covers the zone too", () => {
  assert.equal(busy(frame({ gening: true, slotHasRef: true })).props.className, "sheet-busy over-ref");
  const t = frame({ gening: true, importSheet: noop }, { dropToImport: true, noun: "character sheet" });
  assert.ok(busy(t) && find(t, (n) => n.props && /sheet-dropzone/.test(n.props.className || "")), "both, the busy state on top");
});
ok("no busy state when idle, or once the card has an image (a re-generate keeps showing the current image)", () => {
  assert.equal(busy(frame({})), null);
  assert.equal(busy(frame({ gening: true, genUrl: "x.png" })), null);
});
ok("its styles: over the media, centred, a spinner; reduced motion slows it", () => {
  const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.ok(css.includes(".sheet-media .sheet-busy{position:absolute;inset:0;z-index:2;"));
  assert.ok(css.includes(".sheet-media .sheet-busy.over-ref{background:color-mix(in oklab, var(--bg-2) 72%, transparent)}"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce){ .sheet-busy-spin{animation-duration:2.4s} }"));
  const html = readFileSync(new URL("../TURN.html", import.meta.url), "utf8");
  for (const f of ["app/styles.css", "app/artroom.jsx"]) assert.ok(["20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2"].some((k) => html.includes(f + "?v=" + k + '"')), f);
});
ok("Frances knows: the busy frame and the plain 'not on the image server yet' refusal", () => {
  const ai = readFileSync(new URL("../app/ai.jsx", import.meta.url), "utf8");
  assert.ok(ai.includes("WHILE A CARD'S FIRST IMAGE IS BEING MADE (2026-11-05)"));
});
console.log(`\n${checks} checks passed`);

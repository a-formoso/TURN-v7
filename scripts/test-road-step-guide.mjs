#!/usr/bin/env node
/* The road: the step guide on character and prop cards (owner 2026-11-20: "yes, start on the step guide"; the Story
   Pipeline: "A numbered step guide on the character and prop cards, as locations have").

   1 A character's steps: Sheet, Check, Fix, Lock; someone who wears items also has Items and Final look. What is done
     is read from the image on the card now; the first step not done is the next one.
   2 Locked without a clean check: Check and Fix are skipped, said as they are, and are not the next step.
   3 A prop's steps: Image, Check, Fix, Lock.
   4 The pills: the location tracker's own; a press goes to that step's button and spends nothing.
   5 The cards mount it; Frances knows it; the page loads the new files.

     node scripts/test-road-step-guide.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const art = read("app/artroom.jsx"), props = read("app/props.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), html = read("TURN.html");

const el = (type, p, ...ch) => ({ type, props: p || {}, children: ch.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) });
const text = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (n && n.children ? n.children.map(text).join("") : "");
const find = (n, f, out = []) => { if (n && typeof n === "object") { if (f(n)) out.push(n); (n.children || []).forEach((c) => find(c, f, out)); } return out; };
function lab(doc) {
  const sb = { console, String, Array, JSON, setTimeout: (f) => f() };
  sb.window = sb; sb.React = { createElement: el }; sb.document = doc || { querySelector: () => null };
  vm.runInNewContext(between(art, "function charFinalLook(o){", "window.charFinalLook = charFinalLook;") + "\n" + between(art, "function roadSteps(o){", "window.roadSteps = roadSteps;")
    + "\nthis.roadSteps=roadSteps;this.roadStepTitle=roadStepTitle;this.RoadStepGuide=RoadStepGuide;this.charFinalLook=charFinalLook;", sb);
  return sb;
}
const L = lab();
const steps = (o) => plain(L.roadSteps(o));
const names = (st) => st.map((x) => x.n + " " + x.name).join(", ");
const state = (st) => st.map((x) => x.done ? "done" : x.next ? "next" : x.skipped ? "skipped" : "later").join(" ");
const ring = { id: "p1", name: "engagement ring", included: true, hasImage: true, iso: "r1", locked: true };
const lanyard = { id: "p2", name: "work lanyard", included: true, hasImage: true, iso: "l1", locked: false };

await test("1 a character's steps, read from the image on the card", async () => {
  // no items: four steps, and the lock is the end of the road
  let st = steps({ kind: "character", hasImage: false, drafted: false });
  assert.equal(names(st), "1 Sheet, 2 Check, 3 Fix, 4 Lock"); assert.equal(state(st), "next later later later");
  assert.equal(st[0].todo, "Draft the look first, then press Generate under the image.");
  assert.equal(steps({ kind: "character", hasImage: false, drafted: true })[0].todo, "Press Generate under the image.");
  assert.equal(steps({ kind: "character", hasImage: false, gening: true })[0].todo, "Making the sheet…");
  st = steps({ kind: "character", hasImage: true });
  assert.equal(state(st), "done next later later"); assert.match(st[1].todo, /^Press QA check: it reads the sheet against its description/);
  assert.equal(st[2].todo, "Nothing to fix until the sheet is checked.");
  st = steps({ kind: "character", hasImage: true, qa: "major" });
  assert.equal(state(st), "done done next later"); assert.match(st[2].todo, /Fix these areas/);
  assert.match(st[3].todo, /Best after a check that says Faithful\.$/);
  st = steps({ kind: "character", hasImage: true, qa: "pass" });
  assert.equal(state(st), "done done done next"); assert.ok(!/Best after/.test(st[3].todo));
  assert.equal(state(steps({ kind: "character", hasImage: true, qa: "pass", locked: true })), "done done done done");
  // a kept result or a lock with no image on the card counts for nothing
  assert.equal(state(steps({ kind: "character", hasImage: false, qa: "pass", locked: true })), "next later later later");

  // someone who wears items: six steps
  const items = [{ name: "engagement ring", hasImage: true, locked: true }, { name: "work lanyard", hasImage: false, locked: false }];
  st = steps({ kind: "character", hasImage: true, qa: "pass", locked: true, items, finalLook: L.charFinalLook({ meta: { iso: "s1", lock: { iso: "s1" } }, worn: [ring], qa: "pass" }) });
  assert.equal(names(st), "1 Sheet, 2 Check, 3 Fix, 4 Lock, 5 Items, 6 Final look"); assert.equal(state(st), "done done done done next later");
  assert.equal(st[4].todo, "Make the image of: work lanyard (its square on this card, or the Props tab). Then check and lock it.");
  assert.match(st[5].todo, /^Waits for the items’ images \(step 5\)/);
  // an item with an image that is not locked is named
  st = steps({ kind: "character", hasImage: true, qa: "pass", locked: true, items: [items[0], { name: "work lanyard", hasImage: true, locked: false }] });
  assert.equal(st[4].todo, "Check and lock: work lanyard.");
  // a new item image waits to be put on the sheet
  const itemsOk = [{ name: "engagement ring", hasImage: true, locked: true }, { name: "work lanyard", hasImage: true, locked: true }];
  st = steps({ kind: "character", hasImage: true, qa: "pass", locked: true, wardrobeStale: true, items: itemsOk,
    finalLook: L.charFinalLook({ meta: { iso: "s1", lock: { iso: "s1" } }, wardrobeStale: true, worn: [ring] }) });
  assert.equal(state(st), "done done done done done next"); assert.match(st[5].todo, /press “Update sheet with new wardrobe”/); assert.equal(st[5].stage, "update");
  // the updated sheet is a new image: it starts again at Check, and its lock is the final look
  const meta = { iso: "s2", wornReferences: [{ refId: "p1", mode: "visual" }, { refId: "p2", mode: "visual" }] };
  st = steps({ kind: "character", hasImage: true, qa: "", locked: false, items: itemsOk, finalLook: L.charFinalLook({ meta, worn: [ring, lanyard], qa: "" }) });
  assert.equal(state(st), "done next later later done later"); assert.match(st[5].todo, /^The sheet wears its items\. Run the QA check \(it also looks for each item\)/);
  assert.equal(st[5].more, "On the sheet: engagement ring, work lanyard. Not locked yet: work lanyard (you can lock the final look anyway).");
  st = steps({ kind: "character", hasImage: true, qa: "pass", locked: false, items: itemsOk, finalLook: L.charFinalLook({ meta, worn: [ring, lanyard], qa: "pass" }) });
  assert.equal(state(st), "done done done next done later"); assert.match(st[5].todo, /press “Lock final look”\.$/);
  st = steps({ kind: "character", hasImage: true, qa: "pass", locked: true, items: itemsOk, finalLook: L.charFinalLook({ meta: { ...meta, lock: { iso: "s2", final: true } }, worn: [ring, lanyard], qa: "pass" }) });
  assert.equal(state(st), "done done done done done done", "4 and 6 are done together: the locked sheet that wears its items is the final look");
  // an item kept as words is said in the pill
  const inWords = L.charFinalLook({ meta, worn: [ring, { ...lanyard, included: false }], qa: "" });
  assert.match(steps({ kind: "character", hasImage: true, items: itemsOk, finalLook: inWords })[5].more, /Kept as words, not drawn from an image: work lanyard\.$/);
});

await test("2 locked without a clean check: Check and Fix are skipped, and are not the next step", async () => {
  let st = steps({ kind: "character", hasImage: true, qa: "", locked: true });
  assert.equal(state(st), "done skipped skipped done"); assert.ok(!st.some((x) => x.next));
  st = steps({ kind: "character", hasImage: true, qa: "major", locked: true, items: [{ name: "ring", hasImage: true, locked: false }] });
  assert.equal(state(st), "done done skipped done next later", "the road goes on to the items");
  assert.equal(L.roadStepTitle(st[2], "sheet"), "Skipped: this sheet was locked without a clean check. You can still run the check.");
  assert.equal(L.roadStepTitle(steps({ kind: "prop", hasImage: true, locked: true })[1], "image"), "Skipped: this image was locked without a QA check. You can still run the check.");
  // the tooltips of the other states
  st = steps({ kind: "character", hasImage: true, qa: "pass" });
  assert.equal(L.roadStepTitle(st[0], "sheet"), "Done"); assert.equal(L.roadStepTitle(st[2], "sheet"), "Done: the check says Faithful.");
  assert.match(L.roadStepTitle(st[3], "sheet"), /^Next — Press Lock when you are happy: the items and the shots are then built from this sheet\.$/);
  assert.match(L.roadStepTitle(steps({ kind: "character", hasImage: true })[3], "sheet"), /^Later — /);
});

await test("3 a prop's steps", async () => {
  let st = steps({ kind: "prop", hasImage: false, drafted: false });
  assert.equal(names(st), "1 Image, 2 Check, 3 Fix, 4 Lock"); assert.equal(st[0].todo, "Draft the design first, then press Generate under the image.");
  st = steps({ kind: "prop", hasImage: true, qa: "minor", items: [{ name: "x", hasImage: true }] });
  assert.equal(st.length, 4, "a prop has no items of its own"); assert.equal(state(st), "done done next later");
  assert.match(st[3].todo, /^Press Lock when you are happy: the shots are then built from this image\./);
  assert.equal(state(steps({ kind: "prop", hasImage: true, qa: "pass", locked: true })), "done done done done");
});

await test("4 the pills: the location tracker's own; a press goes to the step's button and spends nothing", async () => {
  const seen = [];
  const node = (sel) => ({ sel, classList: { add: (c) => seen.push(["flash", sel, c]), remove: () => {} }, scrollIntoView: () => seen.push(["scroll", sel]), focus: () => seen.push(["focus", sel]) });
  const card = { querySelector: (sel) => (sel === '[data-role="owned-item-tile"]' ? null : node(sel)), classList: { add: () => {}, remove: () => {} }, scrollIntoView: () => seen.push(["scroll", "card"]) };
  const D = lab({ querySelector: (sel) => (sel === '[data-char-card="c1"]' ? card : null) });
  const st = D.roadSteps({ kind: "character", hasImage: true, qa: "major", items: [{ name: "ring", hasImage: true, locked: false }],
    finalLook: { stage: "update", hasItems: false, items: [], unlocked: [], inWords: [] } });
  const g = D.RoadStepGuide({ steps: st, cardSel: '[data-char-card="c1"]', noun: "sheet", label: "Steps for this character" });
  assert.equal(g.props.className, "loc-steps road-steps"); assert.equal(g.props["data-testid"], "road-step-guide");
  const ol = g.children[0]; assert.equal(ol.type, "ol"); assert.equal(ol.props.className, "loc-steps-list"); assert.equal(ol.props["aria-label"], "Steps for this character");
  const pills = find(g, (n) => n.type === "button");
  assert.deepEqual(pills.map((b) => b.props.className), ["loc-step done", "loc-step done", "loc-step next", "loc-step", "loc-step", "loc-step"]);
  assert.deepEqual(pills.map((b) => text(b)), ["✓Sheet", "✓Check", "3Fix", "4Lock", "5Items", "6Final look"]);
  assert.deepEqual(pills.map((b) => b.props["data-state"]), ["done", "done", "next", "later", "later", "later"]);
  assert.equal(pills[2].props["aria-current"], "step"); assert.match(pills[2].props.title, /^Next — The check found drifts/);
  pills.forEach((b) => b.props.onClick());
  const went = seen.filter((x) => x[0] === "scroll").map((x) => x[1]);
  assert.deepEqual(went, [".sheet-gen-btn", '[data-role="qa-check"]', '[data-role="qa-check"]', '[data-role="sheet-lock"]', ".sheet-gen-btn", '[data-role="wardrobe-update"]'],
    "each step's own button; a step whose button is not on the card falls back to the image's");
  // nothing in the guide can spend or start anything: it has no call but scroll, focus and a flash
  const src = between(art, "function RoadStepGuide({", "window.roadSteps = roadSteps;");
  assert.ok(!/generate\(|\.click\(|aiImageQA|nbSetAssetLock|appConfirm/.test(src));
  // no card on the page: a press does nothing
  const N = lab(); N.RoadStepGuide({ steps: st, cardSel: '[data-char-card="zz"]' }).children[0].children[0].children[0].props.onClick();
  assert.equal(N.RoadStepGuide({ steps: [] }), null);
  // the buttons the guide points at carry the marks it looks for
  assert.ok(art.includes('"data-role":"qa-check","data-qa":(kept && !busy) ? keptSev : undefined,') && art.includes('"data-role":"sheet-lock"') && art.includes('"data-role":"wardrobe-update"')
    && art.includes('"data-role":"owned-item-tile"') && art.includes('className:"sheet-gen-btn"'));
  assert.ok(css.includes(".loc-step.skipped .loc-step-name{text-decoration:line-through") && css.includes(".road-flash{outline:2px solid var(--accent)"));
});

await test("5 the cards mount it; Frances knows it; the page loads the new files", async () => {
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  const g = between(sheet, "React.createElement(RoadStepGuide,{", "// (the \"Face: … · Voice: …\" line under the buttons is gone");
  assert.ok(g.includes('kind:"character", hasImage:!!gen.genUrl, gening:!!gen.gening, drafted:!!drafted,') && g.includes("locked:!!sheetLockOf(gen.genMeta), finalLook, wardrobeStale:!!wardrobeStale,"));
  assert.ok(g.includes("items:wornProps.filter(p=>!wornExclusions.has(p.id)).map("), "worn items that are part of the look; a carried item is not on the sheet");
  assert.ok(sheet.indexOf("React.createElement(LockButton,{ gen, name:c.name") < sheet.indexOf("React.createElement(RoadStepGuide,{") && sheet.indexOf("React.createElement(RoadStepGuide,{") < sheet.indexOf('"data-testid":"char-wardrobe-update"'),
    "under the name and its buttons, above the banners");
  const pc = between(props, "window.RoadStepGuide && React.createElement(window.RoadStepGuide,{", 'React.createElement("div",{className:"char-style-row"}');
  assert.ok(pc.includes('kind:"prop", hasImage:!!gen.genUrl') && pc.includes("window.qaSeverity(k.report)") && pc.includes("window.sheetLockOf(gen.genMeta)"));
  assert.ok(art.includes("window.qaSeverity = qaSeverity;"));
  const f = between(ai, 'APP_FEATURES.push({ name:"Step guide on character and prop cards (Characters, Props, Art Room)"', "function appBrief(){");
  for (const w of ["1 Sheet, 2 Check, 3 Fix, 4 Lock", "5 Items and 6 Final look", "1 Image, 2 Check, 3 Fix, 4 Lock", "never spends credits", "IT IS A GUIDE, NOT A GATE", "read as skipped"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|McKee|Claude|Anthropic|Gemini|GPT/.test(f));
  for (const file of ["artroom.jsx", "props.jsx", "ai.jsx", "styles.css"]) assert.ok(["20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5"].some((k) => html.includes(file + "?v=" + k + '"')), file + " has the new key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

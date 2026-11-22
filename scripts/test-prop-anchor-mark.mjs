#!/usr/bin/env node
/* The road, step 5: a prop and its owner's sheet (owner 2026-11-20: "yes, build this road in that order. allow and
   mark."; "a badge made without the character sheet may not match the sheet's prompt").

   1 What a prop's image says about the sheet it was made from: without it, from an earlier one, from the sheet as it
     is, from the locked sheet. Marked, never blocked.
   2 What does NOT mark a prop: a kept update of the sheet (one item added), a sheet drawn from this very image, an
     uploaded picture, an edit of the prop's own image.
   3 The mark and "Make it again" are on the prop card and in the item popup on the character card.
   4 The prop's QA check also reads the image against how the owner's own card writes the item.
   5 A locked prop image is never made again without a yes, from the popup or any other road.
   6 Frances knows it.

     node scripts/test-prop-anchor-mark.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const art = read("app/artroom.jsx"), props = read("app/props.jsx"), css = read("app/styles.css"), ai = read("app/ai.jsx"), html = read("TURN.html");

// the two rules, run for real
const sb = { console, JSON, Array, String, Object };
sb.window = sb;
sb.splitListItems = (v) => String(v || "").split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
vm.runInNewContext(between(props, "function propAnchorState(p, propMeta, ownerMeta){", "window.propAnchorState = propAnchorState;")
  + "\nthis.state=propAnchorState;this.words=propOwnerWords;", sb);
const st = (...a) => plain(sb.state(...a));
const ring = { id: "p1", ownerId: "c1", ownerName: "Eshita", name: "engagement ring" };

await test("1 the four things a prop's image can say about its owner's sheet", async () => {
  // made without the sheet: said even before the owner's sheet is known
  for (const owner of [undefined, null, { iso: "s1" }]) {
    const r = st(ring, { iso: "a" }, owner);
    assert.equal(r.state, "none"); assert.equal(r.mark, true); assert.equal(r.label, "Made without Eshita’s sheet");
    assert.ok(/You can use it as it is\./.test(r.tip), "allowed: the tip says it can stay");
  }
  assert.ok(st(ring, { iso: "a" }, null).tip.includes("they have no sheet yet"));
  assert.ok(st(ring, { iso: "a" }, { iso: "s1" }).tip.includes("best once that sheet is locked"));
  assert.ok(!st(ring, { iso: "a" }, { iso: "s1", lock: { iso: "s1" } }).tip.includes("best once"));
  // a record for another owner is no record
  assert.equal(st(ring, { iso: "a", anchorOwnerId: "c9", anchorIso: "s1" }, { iso: "s1" }).state, "none");
  // from an earlier sheet
  const made = { iso: "a", anchorOwnerId: "c1", anchorIso: "s1" };
  let r = st(ring, made, { iso: "s2" });
  assert.equal(r.state, "earlier"); assert.equal(r.mark, true); assert.equal(r.label, "Made from an earlier sheet of Eshita");
  assert.equal(st(ring, made, null).state, "earlier", "the sheet it was made from was cleared");
  assert.ok(st(ring, made, null).tip.includes("has no sheet now"));
  assert.equal(sb.state(ring, made, undefined), null, "not known yet: nothing is claimed");
  // from the sheet as it is now
  r = st(ring, made, { iso: "s1" });
  assert.equal(r.state, "current"); assert.equal(r.mark, false); assert.equal(r.label, "From Eshita’s sheet");
  assert.ok(r.tip.includes("not locked yet"));
  // from the locked sheet; a lock that belongs to another version is no lock
  r = st(ring, made, { iso: "s1", lock: { iso: "s1", at: 5 } });
  assert.equal(r.state, "locked"); assert.equal(r.mark, false); assert.equal(r.label, "From Eshita’s locked sheet");
  assert.equal(st(ring, made, { iso: "s1", lock: { iso: "s0" } }).state, "current");
  // nothing to say: no owner, no image
  assert.equal(sb.state({ id: "p2", name: "lamp" }, { iso: "a" }, null), null);
  assert.equal(sb.state(ring, null, { iso: "s1" }), null);
  assert.equal(st({ ...ring, ownerName: "" }, { iso: "a" }, null).label, "Made without its owner’s sheet");
});

await test("2 what does not mark a prop: one item added to the same sheet, a sheet drawn from this image, an upload, an edit", async () => {
  const made = { iso: "a", anchorOwnerId: "c1", anchorIso: "s1" };
  // the wardrobe update keeps the sheet pixel for pixel: s2 is s1 with an item added
  assert.equal(st(ring, made, { iso: "s2", keptFromIso: "s1", keptRootIso: "s1" }).state, "current");
  assert.equal(st(ring, made, { iso: "s3", keptFromIso: "s2", keptRootIso: "s1" }).state, "current", "two updates on");
  assert.equal(st(ring, { ...made, anchorIso: "s2", anchorRootIso: "s1" }, { iso: "s3", keptFromIso: "s2", keptRootIso: "s1" }).state, "current");
  assert.equal(st(ring, { ...made, anchorIso: "s2", anchorRootIso: "s1" }, { iso: "s1" }).state, "current", "the first of the line, restored");
  assert.equal(st(ring, { ...made, anchorIso: "s2" }, { iso: "s3", keptFromIso: "s2", keptRootIso: "s1" }).state, "current", "an older record, one update back");
  assert.equal(st(ring, made, { iso: "s9", keptFromIso: "s8", keptRootIso: "s8" }).state, "earlier", "another line is another sheet");
  // the run records the line only for an added item: a kept FIX changes what the image shows
  const hook = between(art, "if(keptMeta) Object.assign(meta, keptMeta);", "meta.quality = _requestedQuality;");
  assert.ok(hook.includes('if(keptMeta && keptMeta.keptOriginal && keptMeta.keptKind!=="fix" && genMeta && genMeta.iso){'));
  assert.ok(hook.includes("meta.keptFromIso = genMeta.iso;") && hook.includes("meta.keptRootIso = genMeta.keptRootIso || genMeta.iso;"));
  // the owner's sheet was drawn from this very image of the prop: they agree by construction
  const drawn = { iso: "s5", wornReferences: [{ refId: "p1", mode: "visual", generated: "a" }] };
  assert.equal(st(ring, { iso: "a" }, drawn).state, "current"); assert.ok(st(ring, { iso: "a" }, drawn).tip.includes("drawn from this image"));
  assert.equal(st(ring, made, { ...drawn, lock: { iso: "s5" } }).state, "locked");
  assert.equal(st(ring, { iso: "b" }, drawn).state, "none", "a newer image of the prop is not the one on the sheet");
  assert.equal(st(ring, { iso: "a" }, { iso: "s5", wornReferences: [{ refId: "p1", mode: "text", generated: "a" }] }).state, "none", "kept as words: not drawn from it");
  // the person's own picture says nothing
  assert.equal(sb.state(ring, { iso: "a", uploaded: true }, { iso: "s1" }), null);
  // an edit of the prop's image carries the record; a new image made without the sheet does not
  const extra = between(props, "function propAnchorMetaExtra(p){", "/* THE ROAD, STEP 5");
  const run = async (mode, refsUsed, cur, ownerMeta) => {
    const s2 = { console, Promise, nbGetMeta: () => cur, nbLoadDetailsAsset: async () => ({ meta: ownerMeta }) };
    vm.runInNewContext(extra + "\nthis.f=propAnchorMetaExtra;", s2);
    return plain(await s2.f(ring)({ mode, refsUsed }));
  };
  assert.deepEqual(await run("edit", [], { anchorOwnerId: "c1", anchorOwnerName: "Eshita", anchorIso: "s1", anchorRootIso: "s0" }, { iso: "s2" }),
    { anchorOwnerId: "c1", anchorOwnerName: "Eshita", anchorIso: "s1", anchorRootIso: "s0" });
  assert.equal(await run("final", [], { anchorOwnerId: "c1", anchorIso: "s1" }, { iso: "s2" }), null, "a new image without the sheet has no record");
  assert.equal(await run("edit", [], { anchorOwnerId: "c9", anchorIso: "s1" }, { iso: "s2" }), null);
  assert.deepEqual(await run("final", [{ refId: "c1" }], null, { iso: "s2", keptRootIso: "s1" }),
    { anchorOwnerId: "c1", anchorOwnerName: "Eshita", anchorIso: "s2", anchorRootIso: "s1" }, "made with the sheet: its version and its line");
  // the road without the card records the same
  const gp = between(props, "async function generatePropSheet(p, project, opts){", "window.generatePropSheet = generatePropSheet;");
  assert.ok(gp.includes("anchorIso:ownerUrl?(ownerMeta&&ownerMeta.iso):undefined") && gp.includes("anchorRootIso:ownerMeta.keptRootIso"));
});

await test("3 the mark and 'Make it again' are on the prop card and in the item popup", async () => {
  const card = between(props, "function PropSheet({", "function PropSheets({");
  assert.ok(card.includes('const ownerSheetMeta = usePropOwnerMeta(p.ownerId||"");'));
  assert.ok(card.includes("const anchor = gen.genUrl ? propAnchorState(p, gen.genMeta, ownerSheetMeta) : null;"), "only a prop with an image is marked");
  const row = between(card, '"data-testid":"prop-anchor"', 'p.kind==="dressing"');
  assert.ok(row.includes('"prop-status-pill"+(anchor.mark?" unverified":anchor.state==="locked"?" ok":"")') && row.includes("title:anchor.tip"), "amber when marked, green when locked, the reason in the tooltip");
  assert.ok(row.includes('anchor.mark && React.createElement("button"') && row.includes('"data-role":"prop-remake"') && row.includes('"Make it again"'));
  assert.ok(row.includes("onClick:()=>genForFrame.generate()"), "the card's own generate: it asks about a locked image and about the owner's sheet");
  assert.ok(row.includes("window.nbCostChip(1)"), "the price is on the button");
  assert.ok(!/disabled:[^,]*anchor/.test(card), "nothing is blocked by the mark");
  // the owner's sheet is read again when it changes
  const hook = between(props, "function usePropOwnerMeta(ownerId){", "window.usePropOwnerMeta = usePropOwnerMeta;");
  assert.ok(hook.includes("React.useState(undefined)") && hook.includes('["nb-gen-done","nb-meta-changed","nb-history-changed","nb-prefetched"]'));
  // the popup on the character card
  const pop = between(art, "const ownedItemPanel = ()=>{", "return ReactDOM.createPortal(pop, document.body);");
  assert.ok(pop.includes("window.propAnchorState(pr, (typeof nbGetMeta===\"function\") ? nbGetMeta(pr.id) : null, gen.genUrl ? (gen.genMeta||undefined) : undefined)"));
  assert.ok(pop.includes('"data-role":"owned-item-anchor"') && pop.includes("anchor.label") && pop.includes("text:anchor.tip"));
  assert.ok(pop.includes('(url ? ((anchor && anchor.mark) ? "Make it again" : "Generate new image") : "Generate image")'));
  assert.ok(pop.includes('"own-act"+((url && !(anchor && anchor.mark))?"":" main")'), "the marked item's button is the main one");
  // colours: amber = something to do, green = locked; never the Likeness's purple
  const rule = between(css, ".prop-status-pill.ok{", "}");
  assert.ok(rule.includes("var(--ok-soft)") && rule.includes("var(--ok-line)"));
  assert.ok(css.includes(".own-anchor{"));
});

await test("4 the prop's QA check reads the image against the owner's own words too", async () => {
  const words = (p, cs) => sb.words(p, cs);
  const eshita = { id: "c1", accessories: "engagement ring (slim gold band, small round diamond), tiny gold stud earrings", props: "work lanyard with ID badge (navy strap, white card)" };
  assert.equal(words(ring, [eshita]), "engagement ring (slim gold band, small round diamond)");
  assert.equal(words({ ...ring, name: "work lanyard" }, [eshita]), "work lanyard with ID badge (navy strap, white card)", "the carried list too");
  // the list took the short name: the full words the card was shortened from are the owner's words
  assert.equal(words({ ...ring, shortenedFrom: "engagement ring (slim gold band, small round diamond)" }, [{ id: "c1", accessories: "engagement ring" }]),
    "engagement ring (slim gold band, small round diamond)");
  assert.equal(words({ ...ring, aliases: ["slim gold engagement band (worn on the left hand)"] }, [{ id: "c1", accessories: "slim gold engagement band (worn on the left hand)" }]),
    "slim gold engagement band (worn on the left hand)", "found by an older name");
  // nothing more than the name: nothing to add; no owner, no words
  assert.equal(words(ring, [{ id: "c1", accessories: "engagement ring" }]), "");
  assert.equal(words(ring, [{ id: "c2", accessories: "engagement ring (gold)" }]), "");
  assert.equal(words({ id: "p2", name: "lamp" }, [eshita]), "");
  assert.equal(words({ ...ring, name: "ring" }, [{ id: "c1", accessories: "ringed notebook (black)" }]), "", "another object that only starts alike");
  // the card hands them to the check, and the check to the read
  const card = between(props, "function PropSheet({", "function PropSheets({");
  assert.ok(card.includes("const ownerWords = propOwnerWords(p, characters);"));
  assert.ok(card.includes('ownerSays: ownerWords ? { who:(p.ownerName||"the owner"), text:ownerWords } : null,'));
  const btn = between(art, "function QaCheckButton({", "window.QaCheckButton");
  assert.ok(/function QaCheckButton\(\{[^}]*ownerSays[^}]*\}\)\{/.test(art));
  assert.ok(btn.includes("...((ownerSays && ownerSays.text) ? { ownerSays:{ who:String(ownerSays.who||\"\"), text:String(ownerSays.text) } } : {}),"));
  // the read: binding, a contradiction is a deviation that names the owner's card; only when there are words
  const qa = between(ai, "async function aiImageQA(item){", "window.aiImageQA = aiImageQA;");
  assert.ok(qa.includes("+((item.ownerSays && item.ownerSays.text)"));
  assert.ok(qa.includes("THE OWNER'S OWN WORDS (binding, part of the contract)") && qa.includes("whose character card writes it as:"));
  assert.ok(qa.includes("report it as a deviation whose 'what' starts with '") && qa.includes("\\u2019s card:'"));
  assert.ok(qa.includes("are not faults"), "words the image cannot show are not faults");
  assert.ok(qa.indexOf("THE OWNER'S OWN WORDS") < qa.indexOf("SECOND, SEPARATELY: the SCREENPLAY"), "inside the contract part, before the screenplay part");
});

await test("5 a locked prop image is never made again without a yes", async () => {
  const gp = between(props, "async function generatePropSheet(p, project, opts){", "window.generatePropSheet = generatePropSheet;");
  const guard = gp.indexOf("if(!o.lockOk && typeof window.sheetLockOf===\"function\" && window.sheetLockOf(");
  assert.ok(guard > 0 && guard < gp.indexOf("window.nbRunSheetGeneration({"), "checked before anything is sent");
  assert.ok(gp.slice(guard, guard + 400).includes('o.onError("its image is locked")') && gp.slice(guard, guard + 400).includes("return false;"));
  const pop = between(art, "const makeImage = async ()=>{", "// the name: the item's own words");
  const ask = pop.indexOf('if(sheetLockOf(prMeta) && !(await turnLockedAsk(prMeta, pr.name||"", "image", "make a new one"))) return;');
  assert.ok(ask > 0 && ask < pop.indexOf("window.generatePropSheet(pr, project, { lockOk:true })"), "the popup asks first, then says the person agreed");
});

await test("6 Frances knows it, and the page loads the new files", async () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"A prop says whether it was made from its owner\'s sheet (Props, Characters, Art Room)"', "function appBrief(){");
  for (const w of ["Nothing is blocked", "Made without [name]'s sheet", "Made from an earlier sheet of [name]", "From [name]'s sheet", "From [name]'s locked sheet", "Make it again",
    "Update sheet with new wardrobe", "An image you uploaded yourself carries no label", "how the owner's own card writes the item"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|McKee|Claude|Anthropic|Gemini|GPT/.test(f));
  for (const file of ["props.jsx", "artroom.jsx", "ai.jsx"]) {
    assert.ok(["20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2"].some((k) => html.includes(file + "?v=" + k + '"')), file + " has the new key");
  }
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

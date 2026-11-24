#!/usr/bin/env node
/* Keep the original, add only the item (owner 2026-11-19: "everything that was in the first image [must] be brought
   back out … only with a slight addition of the … worn props being added"; "we have to look at everything pixel by
   pixel in code").

   An image engine redraws the whole sheet even for a small edit (on the owner's own sheets 99.7% and 99.9% of the
   pixels changed). app/pixel-keep.js builds the picture that is saved instead: the original, with only the item's
   rectangle copied from the engine's picture. These tests run that file for real, on small made-up pictures (the
   owner's sheets are private film data and are never in the repository):

   1 The engine keeps the layout but redraws everything a little: the item is added, and every other pixel is the
     original's, exactly.
   2 A rough box is enough: the code lines the two pictures up and finds what changed.
   3 It refuses rather than put the item in the wrong place: a layout the engine moved, a patch as big as a garment,
     a box where nothing changed.
   4 What the vision model answers is read strictly (boxes in thousandths; anything else is dropped).
   5 The app side: the look (aiLocateItems), the hook in the image pipeline, the button, the choice when it cannot
     be done, the honest banner, Frances.

     node scripts/test-pixel-keep.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v));

const pk = read("app/pixel-keep.js"), art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");
const box = { Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, Math, console }; box.globalThis = box;
vm.runInNewContext(pk, box);
const PK = box.PixelKeep;

/* a made-up "sheet": a grey ground, a dark coat with a zip, a pale shirt with buttons and folds, a blank card on a strap */
const W = 900, H = 520;   // (big enough that a card is a small patch of it, as on a real sheet)
function rnd(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function sheet({ shiftX = 0, shiftY = 0, scale = 1, tone = 0, noise = 0, card = "blank", seed = 7, cardAt = null } = {}){
  const d = new Uint8ClampedArray(W * H * 4), r = rnd(seed);
  const cx0 = W / 2, cy0 = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    // where this pixel comes from in the "drawing" (the engine moves and resizes it a little)
    const u = cx0 + (x - cx0 - shiftX) / scale, v = cy0 + (y - cy0 - shiftY) / scale;
    let c = [140, 138, 144];                                                 // the ground
    if (u > 90 && u < 270){ c = [42, 40, 52]; if (Math.abs(u - 118) < 2) c = [150, 135, 100]; }          // coat, zip
    if (u > 130 && u < 230){ const f = 12 * Math.sin(u / 9 + v / 23) + 8 * Math.sin(v / 7); c = [176 + f, 190 + f, 232 + f];   // shirt with folds
      if (Math.abs(u - 180) < 3 && (Math.floor(v) % 46) < 6) c = [235, 235, 240]; }                     // buttons
    if (Math.abs(u - 180) < 2.5 && v > 30 && v < 108) c = [30, 120, 60];                                // the strap
    const k = cardAt || [158, 108, 204, 142];
    if (u >= k[0] && u < k[2] && v >= k[1] && v < k[3]){
      c = [36, 130, 66];                                                                               // the card's frame
      if (u >= k[0] + 4 && u < k[2] - 4 && v >= k[1] + 4 && v < k[3] - 4){
        c = [236, 234, 228];                                                                           // blank
        if (card === "photo"){
          const px = u - k[0], py = v - k[1];
          if (px > 6 && px < 18 && py > 7 && py < 27) c = (Math.hypot(px - 12, py - 15) < 5) ? [150, 105, 80] : [205, 205, 210];   // a face on a pale ground
          else if (px > 21 && py > 8 && (Math.floor(py) % 5) < 2) c = [70, 70, 78];                    // lines of print
        }
      }
    }
    const n = noise ? (r() - 0.5) * 2 * noise : 0, i = (y * W + x) * 4;
    d[i] = c[0] + tone + n; d[i + 1] = c[1] + tone + n; d[i + 2] = c[2] + tone + n; d[i + 3] = 255;
  }
  return { width: W, height: H, data: d };
}
const orig = sheet({});
// the same, allowing the patch to sit one pixel off (the made-up print is 2-pixel stripes: one pixel off reads as a big
// difference, which no eye would see)
const nearDiff = (a, b, bx) => { let best = 1e9; for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]){ let s = 0, n = 0;
  for (let y = bx[1]; y < bx[3]; y++) for (let x = bx[0]; x < bx[2]; x++){ const i = (y * W + x) * 4, j = ((y + dy) * W + x + dx) * 4;
    s += Math.abs(a.data[j] - b.data[i]) + Math.abs(a.data[j + 1] - b.data[i + 1]) + Math.abs(a.data[j + 2] - b.data[i + 2]); n += 3; }
  if (s / n < best) best = s / n; } return best; };
const meanDiff = (a, b, bx) => { let s = 0, n = 0; for (let y = bx[1]; y < bx[3]; y++) for (let x = bx[0]; x < bx[2]; x++){ const i = (y * W + x) * 4; s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); n += 3; } return s / n; };

await test("1 the engine redraws everything a little and adds the photo: the result is the original with only the card changed", () => {
  // the whole picture shifted by 2 px, 1% bigger, a touch brighter, with grain: nothing is pixel-identical any more
  const edit = sheet({ shiftX: 2, shiftY: 1, scale: 1.01, tone: 4, noise: 5, card: "photo", seed: 11 });
  const total = W * H, engine = PK.pkCount(edit, orig);
  assert.ok(engine > total * 0.9, "the engine's picture differs almost everywhere (" + engine + " of " + total + ")");
  const r = PK.pkCompose(orig, edit, [{ item: "work lanyard", box: [156, 106, 208, 146] }]);
  assert.deepEqual(plain(r.skipped), []); assert.equal(r.placed.length, 1); assert.equal(r.placed[0].item, "work lanyard");
  assert.ok(r.changed > 300 && r.changed < total * 0.03, "only a small patch changed: " + r.changed);
  assert.equal(r.changed, PK.pkCount(r.out, orig), "the count is a real pixel-by-pixel count");
  assert.ok(PK.pkOnlyInside(r.out, orig, r.placed.map(p => p.box), 0), "every changed pixel lies inside the reported box");
  // outside the box: the original, byte for byte
  const b = r.placed[0].box;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3){
    if (x >= b[0] && x < b[2] && y >= b[1] && y < b[3]) continue;
    const i = (y * W + x) * 4; assert.ok(r.out.data[i] === orig.data[i] && r.out.data[i + 1] === orig.data[i + 1] && r.out.data[i + 2] === orig.data[i + 2], "pixel " + x + "," + y);
  }
  // inside: the photo is there, where the ORIGINAL's card is (lined up), not 2 px off
  const want = sheet({ card: "photo" });
  assert.ok(nearDiff(r.out, want, [164, 114, 198, 136]) < 14, "the card now shows the photo, in the original's place: " + nearDiff(r.out, want, [164, 114, 198, 136]).toFixed(1));
  assert.ok(meanDiff(orig, want, [164, 114, 198, 136]) > 20, "(the original's card was blank)");
  assert.ok(Math.abs(r.placed[0].shift[0] - 2) <= 2 && Math.abs(r.placed[0].shift[1] - 1) <= 2, "the shift it found: " + r.placed[0].shift);
});

await test("2 a rough box is enough: off by several pixels, too big or too small, the same card is added", () => {
  const edit = sheet({ shiftX: -3, shiftY: 2, scale: 0.99, tone: -3, noise: 4, card: "photo", seed: 23 });
  const want = sheet({ card: "photo" });
  for (const bx of [[150, 100, 200, 138], [162, 112, 214, 150], [145, 98, 218, 152], [166, 114, 196, 136]]){
    const r = PK.pkCompose(orig, edit, [{ item: "badge", box: bx }]);
    assert.equal(r.placed.length, 1, "placed with box " + bx + " " + JSON.stringify(plain(r.skipped)));
    assert.ok(nearDiff(r.out, want, [168, 118, 194, 132]) < 16, "box " + bx + ": " + nearDiff(r.out, want, [168, 118, 194, 132]).toFixed(1));
    assert.ok(PK.pkOnlyInside(r.out, orig, r.placed.map(p => p.box), 0)); assert.ok(r.changed < W * H * 0.04);
  }
  // two items in one go; an item named twice (two panels) is two patches
  const r2 = PK.pkCompose(orig, edit, [{ item: "badge", box: [156, 106, 208, 146] }, { item: "nothing here", box: [20, 20, 50, 50] }]);
  assert.deepEqual(plain(r2.placed.map(p => p.item)), ["badge"]); assert.deepEqual(plain(r2.skipped).map(s => [s.item, s.why]), [["nothing here", "nothing changed there"]]);
});

await test("3 it refuses rather than put the item in the wrong place or mix two pictures", () => {
  // the engine redrew the figure smaller and moved the card up its strap: the surroundings no longer line up
  const moved = sheet({ scale: 0.84, shiftY: -6, tone: 6, noise: 6, card: "photo", cardAt: [158, 84, 204, 118], seed: 31 });
  const a = PK.pkCompose(orig, moved, [{ item: "work lanyard", box: [160, 86, 200, 118] }]);
  assert.equal(a.placed.length, 0); assert.equal(a.changed, 0, "nothing is copied: the original is untouched");
  assert.match(a.skipped[0].why, /^(could not be lined up|the picture around it changed too much)$/);
  for (let i = 0; i < orig.data.length; i += 997) assert.equal(a.out.data[i], orig.data[i]);
  // a box as big as a garment is a redraw, not a patch
  const edit = sheet({ shiftX: 1, noise: 4, card: "photo", seed: 5 });
  const b = PK.pkCompose(orig, edit, [{ item: "coat", box: [80, 10, 280, 250] }]);
  assert.equal(b.placed.length, 0); assert.match(b.skipped[0].why, /^too large/);
  // a place where the engine changed nothing that matters: left alone
  const c = PK.pkCompose(orig, sheet({ shiftX: 1, noise: 4, seed: 9 }), [{ item: "ring", box: [150, 180, 170, 200] }]);
  assert.equal(c.placed.length, 0); assert.equal(c.changed, 0);
  // the two bars, as measured on the owner's sheets, are in the file
  assert.ok(pk.includes("const maxScore = o.maxScore==null ? 10 : o.maxScore, maxDrift = o.maxDrift==null ? 44 : o.maxDrift;"));
  assert.ok(pk.includes("o.maxPatch==null ? 0.012 : o.maxPatch"));
});

await test("4 what the vision model answers is read strictly: thousandths of the picture, proper boxes only", () => {
  const P = plain(PK.pkPlacements([{ item: "work lanyard", boxes: [[500, 400, 560, 520], [10, 10, 10, 10], "x", [1, 2, 3]] }, { item: "", boxes: [[1, 1, 9, 9]] },
    { name: "ring", box: [900, 500, 880, 480] }, { item: "bad", boxes: [[NaN, 1, 2, 3]] }, null], 2000, 1000));
  assert.deepEqual(P, [{ item: "work lanyard", box: [1000, 400, 1120, 520] }, { item: "ring", box: [1760, 480, 1800, 500] }]);
  assert.deepEqual(plain(PK.pkPlacements(null, 100, 100)), []); assert.deepEqual(plain(PK.pkPlacements("nope", 100, 100)), []);
  assert.deepEqual(plain(PK.pkBox([10.4, 5.2, 3.1, 9.9], 100, 100)), [3, 5, 11, 10]);
  assert.equal(PK.pkCount(orig, orig), 0);
});

await test("5a the look: one reading of the engine's picture, the items by name, boxes only", () => {
  const f = between(ai, "async function aiLocateItems(url, items){", "window.aiLocateItems = aiLocateItems;");
  assert.ok(f.includes("const img = await turnDownscaleDataUrl(url, 1568);") && f.includes("aiPlannerRead([{ role:\"user\", content:prompt }], [img], { maxTokens:700 })"), "read by the edit planner (2026-11-20)");
  assert.ok(f.includes("in thousandths of the image") && f.includes("Never guess a box.") && f.includes('if(!res.vision) return { unsupported:true };'));
  assert.ok(!/TURN|MUSE|McKee|Claude|Anthropic/.test(f.replace(/turnDownscaleDataUrl/g, "")), "nothing the model is told names the codename or a vendor");
});

await test("5b the pipeline saves the kept picture; when it cannot be done the person chooses; the banner stays honest", () => {
  const hook = between(art, "      let keptMeta = null;", "      // Record the actual returned pixels");
  // (2026-11-20) the caller's own keeper first; a card that keeps its edits gives every other edit the general one
  assert.ok(hook.includes('const _keeper = !isEditMode ? null : (typeof gopts.keepOriginal==="function") ? gopts.keepOriginal') && hook.includes("const kept = await _keeper({ baseUrl:refImage, url, cancelled:_cancelledNow });"));
  assert.ok(hook.includes("if(kept && kept.discard) throw new Error(") && hook.includes("if(kept && kept.url){ url = kept.url; keptMeta = kept.meta || null; }"));
  assert.ok(art.indexOf("let keptMeta = null;") < art.indexOf("const outputDims = await nbImageDimensions(url);"), "before the size and the version are recorded");
  assert.ok(art.includes("if(keptMeta) Object.assign(meta, keptMeta);"));
  const keep = between(art, "async function turnKeepOriginal(o){", "/* what the card says afterwards");
  assert.ok(keep.includes("edit = await turnReadPixels(o.url, orig.width, orig.height);"), "the engine's picture is brought to the original's size");
  assert.ok(keep.includes("const r = PK.pkCompose(orig, edit, placements, o.maxPatch ? { maxPatch:o.maxPatch } : undefined);") && keep.includes('return { url:cv.toDataURL("image/png")'), "saved without loss");
  assert.ok(keep.includes('if(!r.placed.length) return { failed:"the new items could not be placed exactly"'));
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(sheet.includes("return { lockOk:true, keepOriginal: (io)=> keepOriginalForWardrobe(io, items),"), "the wardrobe update asks for it");
  const kw = between(sheet, "  const keepOriginalForWardrobe = async (io, items)=>{", "  const wardrobeUpdateOpts = ()=>{");
  // (2026-11-20) the rule is shared with the QA report's area fixes: turnKeepOrAsk (scripts/test-qa-area-fix.mjs runs it)
  assert.ok(kw.includes('const r = await turnKeepOrAsk(io, { items, whose:who+"\\u2019s sheet" });') && kw.includes("if(r && r.url && r.meta && r.meta.keptOriginal) keptLeftOutRef.current = (r.skipped||[]).map(x=>x.item);"));
  const ask = between(art, "async function turnKeepOrAsk(io, o){", "/* THE AREAS A QA REPORT MARKED");
  assert.ok(ask.includes('confirmLabel:"Use the engine\\u2019s picture", cancelLabel:fix ? "Keep my image" : "Keep my sheet"') && ask.includes("The image is already paid for either way.") && ask.includes("return { discard:true, message:"));
  assert.ok(sheet.includes("if(leftOut && leftOut.length) wornProps.forEach(p=>{ if(leftOut.indexOf(String(p.name||\"\").trim())>=0) usedIds.delete(p.id); });"),
    "an item that could not be added is not recorded as worn: 'New wardrobe ready' stays for it");
  // what the card says afterwards
  const sb = { String, Number, Array }; sb.window = sb;
  vm.runInNewContext(between(art, "function turnKeptSummary(meta){", "/* KEEP, OR ASK") + "\nthis.f = turnKeptSummary;", sb);
  assert.equal(sb.f({ keptOriginal: true, keptItems: ["licence badge"], keptLeftOut: [], keptChangedPixels: 2972, keptTotalPixels: 2359296 }),
    "Your sheet was kept as it was: 99.9% of its pixels are untouched. Added: licence badge.");
  assert.equal(sb.f({ keptOriginal: true, keptItems: ["ring"], keptLeftOut: ["scarf"], keptChangedPixels: 400, keptTotalPixels: 2359296 }),
    "Your sheet was kept as it was: 99.98% of its pixels are untouched. Added: ring. Not added: scarf.");
  assert.equal(sb.f({ keptOriginal: false }), ""); assert.equal(sb.f(null), "");
});

await test("F the file is loaded before the Art Room; Frances knows; nothing she is told names the codename", () => {
  assert.ok(html.indexOf('src="app/pixel-keep.js?v=') > 0 && html.indexOf('src="app/pixel-keep.js?v=') < html.indexOf('src="app/artroom.jsx?v='));
  const f = between(ai, 'APP_FEATURES.push({ name:"Update sheet with new wardrobe keeps your sheet and adds only the item (Characters, Art Room)"', "function appBrief(){");
  for (const k of ["pixel for pixel", "'Keep my sheet'", "'Use the engine's picture'", "one image", "small items", "placed exactly"]) assert.ok(f.includes(k), k);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic/.test(f));
  const KEYS = ["20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2"];   // (the list grows with each key bump)
  for (const file of ["pixel-keep.js", "artroom.jsx", "ai.jsx", "script.jsx"]) assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

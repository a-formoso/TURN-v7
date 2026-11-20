#!/usr/bin/env node
/* Edits made in code (owner 2026-11-20: "printing back out whatever … we already had, and using code … I want all of
   the editing features … to be done with code"; "they should see [the planner] as the model that did the
   editing/changes").

   1 The head, back on the headless view, from the sheet's own close-up: placed on the neck at the size of the view
     that has a head; nothing else on the sheet changes.
   2 A body drawn too high is moved down as it is; with no clean way to make room the head is made a little smaller,
     or nothing is done. A close-up with no plain background is refused.
   3 What the reader answers is read strictly; a head's width is measured, not taken from the box.
   4 Every edit on a character or prop sheet is kept: the caller's keeper, else the general one; an edit that asks for
     the head is made with no image engine.
   5 Remaster is made in code: where it is offered, what it does, that it makes no image.
   6 What Details name: the planner for a change made in code, the image engine for everything else.
   7 The planner's reads; Frances; the page loads the new files.

   The pictures are made up: the owner's sheets are private film data and are never in the repository.

     node scripts/test-code-edits.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const pk = read("app/pixel-keep.js"), art = read("app/artroom.jsx"), props = read("app/props.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");
const box = { Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, Math, console }; box.globalThis = box;
vm.runInNewContext(pk, box);
const PK = box.PixelKeep;

/* a made-up sheet: a close-up (hat, face, neck in a shirt collar, jacket), a full body with no head and an empty
   collar, and a back view with its head. bodyTop moves the headless body up or down; floor puts a shadow under it. */
const W = 1200, H = 680, SKIN = [202, 152, 116], HAT = [40, 40, 56], SHIRT = [176, 190, 232], BG = [140, 138, 144];
function rnd(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function sheet({ bodyTop = 150, floor = false, plainBg = true, seed = 5 } = {}){
  const d = new Uint8ClampedArray(W * H * 4), r = rnd(seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    let c = BG;
    if (y === 0 || y === H - 1) c = [100, 98, 104];
    if (x === 420 || x === 800) c = [100, 98, 104];
    if (x < 420){
      const u = x - 210;
      if (!plainBg) c = [90 + (x * 7 + y * 13) % 120, 100 + (x * 3) % 90, 110 + (y * 5) % 100];   // a busy ground behind the close-up
      if (y > 440){ c = [38, 38, 52];
        if (Math.abs(u) < 100) c = SHIRT;
        if (Math.abs(u) < (520 - y) * 0.6) c = [186, 136, 102]; }
      if (y >= 400 && y <= 440 && Math.abs(u) < 60) c = [186, 136, 102];
      if ((u * u) / (130 * 130) + ((y - 250) * (y - 250)) / (170 * 170) <= 1){ c = SKIN;
        if (y < 170) c = HAT;
        if (Math.abs(y - 240) < 6 && (Math.abs(u - 50) < 14 || Math.abs(u + 50) < 14)) c = [40, 30, 30]; }
    } else if (x < 800){
      const u = x - 610, v = y - bodyTop;
      if (v > 4 && v < 420 && Math.abs(u) < 70 + Math.min(40, v)){ c = [38, 38, 52]; if (Math.abs(u) < 31) c = SHIRT; }   // (the shirt as wide as the close-up's, made smaller)
      if ((u * u) / (31 * 31) + (v * v) / (13 * 13) <= 1) c = SHIRT;
      if ((u * u) / (22 * 22) + (v * v) / (10 * 10) <= 1 && v < 6 - Math.abs(u) * 0.1) c = [96, 106, 150];
      if (floor && y > H - 30 && Math.abs(u) < 90) c = [70, 70, 76];
    } else {
      const u = x - 1000;
      if (y > 150 && y < 570 && Math.abs(u) < 70 + Math.min(40, y - 150)) c = [38, 38, 52];
      if ((u * u) / (40 * 40) + ((y - 95) * (y - 95)) / (52 * 52) <= 1) c = [52, 46, 46];
    }
    const n = (r() - 0.5) * 6, i = (y * W + x) * 4; d[i] = c[0] + n; d[i + 1] = c[1] + n; d[i + 2] = c[2] + n; d[i + 3] = 255;
  }
  return { width: W, height: H, data: d };
}
const th = (x, y) => [x / W * 1000, y / H * 1000];
const answer = (bodyTop = 150) => ({ headless: true, head: [...th(84, 82), ...th(338, 420)], chin: 420 / H * 1000,
  opening: [...th(590, bodyTop - 9), ...th(630, bodyTop + 5)], otherHead: [...th(956, 40), ...th(1046, 150)], shoulders: [540 / W * 1000, 680 / W * 1000] });
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const near = (a, b, t = 22) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= t * 3;
const same = (a, b, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){ const i = (y * W + x) * 4; if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) return false; } return true; };

await test("1 the head is back on the headless view: the close-up's own, at the other view's size, on the neck", () => {
  const im = sheet({ bodyTop: 162 }), plan = PK.pkHeadPlan(answer(162), im);
  assert.ok(plan && plan.sizedFrom === "view"); assert.ok(Math.abs(plan.topGap - 43) <= 2, "the gap the sheet leaves above a head: " + plan.topGap); assert.ok(Math.abs(plan.headWidth - 80) <= 3, "as wide as the back view's head: " + plan.headWidth);
  const r = PK.pkHeadBack(im, plan);
  assert.ok(r && r.out && !r.failed, r && r.failed); assert.equal(r.moved, null, "there was room"); assert.ok(Math.abs(r.fit - 1) < 0.03, "true size");
  // LINED UP BY THE CLOTHES (owner 2026-11-20: "the close-up picture and the mid section … [need] to be aligned as far as
  // the wardrobe"): the close-up's collar and jacket are laid over the body's; one place agrees far better than the rest
  assert.ok(r.aligned && r.aligned.score < 10 && r.aligned.score < r.aligned.typical * 0.5 && Math.abs(r.aligned.size - 1) < 0.05, JSON.stringify(r.aligned));
  assert.ok(pk.includes("LINE THE CLOSE-UP UP WITH THE BODY BY THEIR CLOTHES") && pk.includes("LINED UP, THE NECK IS THE CLOSE-UP'S, EXACTLY"));
  assert.ok(Math.abs(r.scale - 80 / 260) < 0.02, "the close-up's 260 px head is now about 80 px wide");
  const [x0, y0, x1, y1] = r.box; assert.ok(x0 > 540 && x1 < 680 && y0 >= 27 && y1 <= 177, "above the body, on its centre line, with a gap above it: " + r.box);
  const cx = Math.round((x0 + x1) / 2), hh = Math.round(340 * r.scale);
  assert.ok(near(px(r.out, cx, y0 + Math.round(hh * 0.62)), SKIN), "a face"); assert.ok(near(px(r.out, cx, y0 + Math.round(hh * 0.1)), HAT), "under its hat");
  assert.ok(near(px(r.out, 610, 158), [186, 136, 102], 30), "the neck fills the empty collar");
  // the neck is the close-up's neck, in its own shape: skin down to the point of the collar's V, the shirt beside and below it
  assert.ok(near(px(r.out, 610, 178), [186, 136, 102], 30), "the neck goes down into the V as it does in the close-up");
  assert.ok(near(px(r.out, 588, 186), SHIRT) && near(px(r.out, 632, 186), SHIRT) && near(px(r.out, 610, 198), SHIRT), "the shirt beside and below the V");
  // (the first real run, 2026-11-20) pale patches in a beard do not end the jaw: only a wide run of background does
  assert.ok(pk.includes("const jawGap = Math.max(6, Math.round((hx1-hx0)*0.035));") && !pk.includes("if(++gap>=4) break;"));
  assert.ok(art.includes('(!r.aligned && r.fit<0.985) ? " The head is slightly smaller than true size, for lack of room."'), "a head sized by its clothes is not called smaller");
  // the neck is the close-up's own, never a flat fill: the code has no stand-in colour left
  assert.ok(!/rowMean/.test(pk) && pk.includes("Nothing is filled with a flat colour."));
  // nothing else on the sheet changed: the close-up, the back view, the body below the collar
  assert.ok(same(im, r.out, 0, 0, 420, H) && same(im, r.out, 801, 0, W, H) && same(im, r.out, 421, 200, 800, H));
  assert.ok(r.changed > 2000 && r.changed < W * H * 0.02, "a head's worth of pixels: " + r.changed);
  // the same face: the eyes are where the close-up's eyes are, made smaller
  const eyeY = y0 + Math.round((240 - 80) * r.scale), eyeX = cx + Math.round(50 * r.scale);
  assert.ok(px(r.out, eyeX, eyeY)[0] < 150, "an eye, darker than the skin around it");
});

await test("2 no room above the body: it is moved down as it is; else a smaller head; else nothing", () => {
  const im = sheet({ bodyTop: 110 }), r = PK.pkHeadBack(im, PK.pkHeadPlan(answer(110), im));
  assert.ok(r.out && r.moved && r.moved.by > 10 && r.moved.by < 62, JSON.stringify(r.moved)); assert.ok(Math.abs(r.fit - 1) < 0.03, "true size, because the body made room");
  // A GAP ABOVE THE HEAD (owner 2026-11-20: "he appears to almost be touching the top … create a little gap"): at least
  // 1.2% of the height, at most 4%, as the other view's head has
  assert.ok(r.box[1] >= Math.floor(H * 0.012) && r.box[1] <= Math.ceil(H * 0.04) + 2, "the head starts " + r.box[1] + " px down");
  // with a little clean floor only, the body goes down by what there is: the head is never made smaller for the gap
  const tight = sheet({ bodyTop: 110 }); for (let y = H - 40; y < H - 22; y++) for (let x = 560; x < 660; x++){ const i = (y * W + x) * 4; tight.data[i] = 70; tight.data[i + 1] = 70; tight.data[i + 2] = 76; }
  const rt = PK.pkHeadBack(tight, PK.pkHeadPlan(answer(110), tight));
  assert.equal(rt.moved.level, true, "both figures by what the tighter one has");
  assert.deepEqual(px(rt.out, 1000, 95 + rt.moved.by), px(tight, 1000, 95));
  assert.ok(rt.out && rt.moved && rt.moved.by >= 10 && rt.moved.by < r.moved.by && rt.fit > 0.9 && rt.box[1] >= 4 && rt.box[1] < r.box[1], JSON.stringify([rt.moved, rt.box, rt.fit]));
  // the figure is the same figure, lower: a body pixel is found r.moved.by rows down; the close-up and the back view are untouched
  for (const [x, y] of [[560, 300], [610, 250], [700, 480]]) assert.deepEqual(px(r.out, x, y + r.moved.by), px(im, x, y));
  // THE FIGURES STAY LEVEL (owner 2026-11-20: "even when the [character] turns around, everything is still aligned"): the
  // back view goes down with the front one, by the same rows, head and all; the close-up is untouched
  assert.equal(r.moved.level, true); assert.ok(Array.isArray(r.moved.other) && r.moved.other[0] > 800);
  for (const [x, y] of [[1000, 95], [960, 300], [1040, 560]]) assert.deepEqual(px(r.out, x, y + r.moved.by), px(im, x, y), "the back view, " + r.moved.by + " rows lower");
  assert.ok(same(im, r.out, 0, 0, 420, H));
  assert.deepEqual(px(r.out, 500, 0), px(im, 500, 0), "the frame line at the top stays where it is");
  // something reaches the bottom edge: the body cannot be moved, so the head is a little smaller
  // (a little short of room: the neck is shortened first, the head keeps its size)
  const sh = sheet({ bodyTop: 124, floor: true }), r1 = PK.pkHeadBack(sh, PK.pkHeadPlan(answer(124), sh));
  assert.ok(r1.out && !r1.moved && Math.abs(r1.fit - 1) < 0.03, "the same head, with less of a gap");
  const fl = sheet({ bodyTop: 100, floor: true }), r2 = PK.pkHeadBack(fl, PK.pkHeadPlan(answer(100), fl));
  assert.ok(r2.out && !r2.moved && r2.fit < 1 && r2.fit >= 0.85, "fit " + r2.fit);
  // far too high and nowhere to go: nothing is done, and it says why
  const hi = sheet({ bodyTop: 60, floor: true }), r3 = PK.pkHeadBack(hi, PK.pkHeadPlan(answer(60), hi));
  assert.equal(r3.out, undefined); assert.equal(r3.failed, "there is no room for the head above the body");
  // a close-up on a busy ground cannot be cut out: refused
  const busy = sheet({ plainBg: false }), r4 = PK.pkHeadBack(busy, PK.pkHeadPlan(answer(), busy));
  assert.equal(r4.out, undefined); assert.equal(r4.failed, "the close-up has no plain background to cut the head from");
});

await test("3 the reader's answer is read strictly; the head's width is measured", () => {
  const im = sheet();
  assert.equal(PK.pkHeadPlan(null, im), null); assert.equal(PK.pkHeadPlan({}, im), null);
  assert.equal(PK.pkHeadPlan({ ...answer(), head: [1, 2, 3] }, im), null, "not a box"); assert.equal(PK.pkHeadPlan({ ...answer(), chin: "low" }, im), null);
  assert.equal(PK.pkHeadPlan({ ...answer(), opening: null }, im), null); assert.equal(PK.pkHeadPlan({ ...answer(), head: [0, 0, 5000, 9000] }, im), null, "outside the picture");
  // no view with a head: the shoulders give the size; neither: no plan
  const sh = PK.pkHeadPlan({ ...answer(), otherHead: null }, im); assert.equal(sh.sizedFrom, "shoulders"); assert.ok(Math.abs(sh.headWidth - 140 / 2.8) < 1);
  assert.equal(PK.pkHeadPlan({ ...answer(), otherHead: null, shoulders: null }, im), null);
  // a box drawn too wide or too tight around the other head gives the same width
  for (const b of [[940, 30, 1060, 150], [962, 46, 1040, 148]]) assert.ok(Math.abs(PK.pkHeadWidth(im, b) - 80) <= 3, String(PK.pkHeadWidth(im, b)));
  assert.equal(PK.pkHeadWidth(im, [300, 300, 305, 304]), 0, "too small to measure");
  // a rough answer still lands the head in the same place
  const a = answer(); const rough = { ...a, head: [a.head[0] + 8, a.head[1] + 6, a.head[2] - 6, a.head[3]], opening: [a.opening[0] + 3, a.opening[1] + 2, a.opening[2] - 3, a.opening[3] - 1] };
  const r0 = PK.pkHeadBack(im, PK.pkHeadPlan(a, im)), r1 = PK.pkHeadBack(im, PK.pkHeadPlan(rough, im));
  assert.ok(r1.out); for (let k = 0; k < 4; k++) assert.ok(Math.abs(r0.box[k] - r1.box[k]) <= 4, "box " + k + ": " + r0.box + " / " + r1.box);
});

/* the app's small rules, run for real */
const sb = { console, String, Number, Array, JSON, Math }; sb.window = sb; sb.nbModelLabel = (id) => ({ "gpt-image-2.6": "GPT Image 2.6 Sunburst" }[id] || "");
vm.runInNewContext(between(art, "function turnKeptSummary(meta){", "/* KEEP, OR ASK") + "\n" + between(art, "function turnEditAsksHeadBack(instruction){", "window.turnKeepEdit = turnKeepEdit;")
  + "\n" + between(art, "function remasterIsEngineEdit(m){", "async function turnRemasterInCode(o){") + "\n" + between(art, "function nbShownModel(meta){", "window.nbShownModel = nbShownModel;")
  + "\n" + between(art, "function remasterEligible(meta){", "window.remasterEligible = remasterEligible;")
  + "\nthis.F={turnKeptSummary,turnEditAsksHeadBack,remasterIsEngineEdit,nbShownModel,codeEditLines,remasterEligible};", sb);
const F = sb.F;

await test("4 every edit on a character or prop sheet is kept; an edit that asks for the head needs no image engine", () => {
  const run = between(art, "      let keptMeta = null;", "      // Record the actual returned pixels");
  assert.ok(run.includes('const _keeper = !isEditMode ? null : (typeof gopts.keepOriginal==="function") ? gopts.keepOriginal'), "the caller's own keeper first");
  assert.ok(run.includes('(opts.keepEdits && !gopts.wholeRedraw && typeof turnKeepEdit==="function")') && run.includes("turnKeepEdit(io, { instruction:gopts.editInstruction,"), "else the general one, on a card that keeps its edits");
  assert.ok(run.includes("if(kept && kept.discard) throw new Error(") && run.includes("if(kept && kept.url){ url = kept.url; keptMeta = kept.meta || null; }"));
  // the cards that keep their edits: a character's sheet, an appearance state's, a prop's image
  assert.equal(art.split('const gen = useImageGen({\n    keepEdits:true, noun:"sheet",').length - 1, 2); assert.ok(props.includes('const gen = useImageGen({\n    keepEdits:true, noun:"image",'));
  // the general keeper: one look at the two pictures, then keep or ask; a change may be large
  const k = between(art, "async function turnKeepEdit(io, o){", "/* an edit's own words");
  assert.ok(k.includes("found = await window.aiLocateChanges(io.baseUrl, io.url, [instr]);") && k.includes('failed:"what the edit changed could not be found"') && k.includes('kind:"edit", items:found.map(x=>x.item), found, maxPatch:0.3, whose, by:found.by'));
  const ask = between(art, "async function turnKeepOrAsk(io, o){", "/* THE AREAS A QA REPORT MARKED");
  assert.ok(ask.includes('const r = (o && o.failed) ? { failed:o.failed, placed:[], skipped:[] } : await turnKeepOriginal({') && ask.includes('edit ? "The edit could not be made in place on "') && ask.includes('cancelLabel:fix ? "Keep my image" : "Keep my sheet"'));
  assert.equal(F.turnKeptSummary({ keptOriginal: true, keptKind: "edit", keptItems: ["red scarf"], keptChangedPixels: 4000, keptTotalPixels: 2000000 }), "Your image was kept as it was: 99.8% of its pixels are untouched. Changed: red scarf.");
  // the head: the words that may ask for it (the planner then confirms), and the path with no engine
  for (const t of ["Add Eshita's head to the middle front view, matching the close-up", "put the head back on the full-body view", "the front figure is missing its head, restore it"]) assert.equal(F.turnEditAsksHeadBack(t), true, t);
  for (const t of ["make the coat red", "add a scarf", "turn the head to the left", ""]) assert.equal(F.turnEditAsksHeadBack(t), false, t);
  const g = between(art, "  const generate = async (gopts)=>{", "    return await nbRunSheetGeneration({");
  assert.ok(g.includes("opts.keepEdits && !gopts.keepOriginal && !gopts.wholeRedraw") && g.includes("turnEditAsksHeadBack(gopts.editInstruction)")
    && g.includes("const made = await turnHeadBack({ genUrl, codeEdit }, lockName(), { instruction:String(gopts.editInstruction), quiet:true, lockOk:true });") && g.includes("if(made){ setEditMode(false); return true; }"));
  assert.ok(g.indexOf("turnLockedAsk(genMeta, lockName()") < g.indexOf("turnHeadBack("), "a locked sheet has asked first");
  const hb = between(art, "async function turnHeadBack(gen, name, o){", "/* REMASTER, IN CODE");
  assert.ok(hb.includes("look = await window.aiPlanHeadBack(baseUrl, o.instruction);") && hb.includes('if(o.instruction && f.asked===false) return why("that is not what was asked");')
    && hb.includes("plan = PK.pkHeadPlan(f, img);") && hb.includes("const r = PK.pkHeadBack(img, plan);") && hb.includes("const left = (why)=> o.quiet ? {} :"));
  // (the first real runs) the reading is asked for twice before the edit can go on to an image engine, and the reason is kept
  assert.ok(hb.includes("for(let attempt=0; attempt<2 && !plan; attempt++){") && hb.includes("window.__turnHeadBackWhy = { at:Date.now(), why:w };"));
  assert.ok(hb.includes('codeEdit:{ kind:"head", by:String(look.by.label), byId:String(look.by.id||""), drew:false }') && hb.includes("headBack:{ at:Date.now(),"));
  assert.ok(!/nbGenerate|gen\.generate\(/.test(hb), "no image engine in it");
  // saved as a new version; what one version owns is not carried on; a later kept change keeps the record of the head
  const ce = between(art, "  const codeEdit = async (make, o)=>{", "  /* REMASTER, IN CODE (owner 2026-11-20): the version before the edit is brought back");
  assert.ok(ce.includes("CODE_EDIT_NOT_CARRIED.forEach(k=>{ delete meta[k]; });") && ce.includes("const saveResult = await nbCommit(id, r.url, meta, [], assetKind, _editEpoch);") && ce.includes('if(!r || !r.url){ say(r && r.message); }'));
  assert.ok(ce.includes('if(sheetLockOf(genMeta) && !o.lockOk && !(await turnLockedAsk(genMeta, lockName(), "image", "change it"))) return false;') && !/nbGenerate/.test(ce));
  for (const kkey of ['"qa"', '"lock"', '"approval"', '"keptOriginal"', '"codeEdit"']) assert.ok(between(art, "const CODE_EDIT_NOT_CARRIED = [", "];").includes(kkey), kkey);
  assert.ok(art.includes("if(keptMeta && keptMeta.keptOriginal && genMeta && genMeta.headBack) meta.headBack = genMeta.headBack;"));
  // the check judges such a sheet with its head
  assert.ok(between(art, "function QaCheckButton({", "window.QaCheckButton").includes('if(contract && gm.headBack) contract += "\\n\\nON THIS IMAGE THE FRONT FULL-BODY VIEW HAS ITS HEAD'));
});

await test("5 Remaster is made in code: offered where there is something to bring back, and it makes no image", () => {
  const E = { mode: "edit", editInstruction: "add a scarf" };
  assert.equal(F.remasterEligible(E), true); assert.equal(F.remasterEligible({ ...E, keptOriginal: true }), false, "a kept edit has nothing to restore");
  assert.equal(F.remasterEligible({ ...E, codeEdit: { by: "x" } }), false); assert.equal(F.remasterEligible({ mode: "base" }), false, "a fresh image");
  assert.equal(F.remasterEligible({ mode: "edit", editInstruction: "REMASTER this sheet: …" }), false, "an old remaster pass"); assert.equal(F.remasterEligible(null), false);
  const rm = between(art, "async function turnRemasterInCode(o){", "window.turnHeadBack = turnHeadBack;");
  assert.ok(rm.includes("const base = history[0];") && !rm.includes("while(i<history.length"), "one edit back, never further: an older edit's change is not dropped without a word");
  assert.ok(rm.includes("found = await window.aiLocateChanges(base.url, o.url, asked.filter(Boolean).reverse());")
    && rm.includes('const r = await turnKeepOriginal({ baseUrl:base.url, url:o.url, items:found.map(x=>x.item), found, kind:"remaster", maxPatch:0.08, by:found.by });'));
  assert.ok(rm.includes('return left("the version before the edit is no longer in its versions");') && rm.includes("restoredFromIso:bm.iso") && !/nbGenerate|generate\(/.test(rm));
  assert.equal(F.turnKeptSummary({ keptOriginal: true, keptKind: "remaster", keptItems: ["scarf"], keptChangedPixels: 20000, keptTotalPixels: 2000000 }),
    "The version before the edit was brought back: 99.0% of the image is that version, pixel for pixel. Kept from the edit: scarf.");
  // the two buttons: no image price, no engine call
  const menu = between(art, '"data-role":"sheet-remaster"', '"Remaster \\u2014 bring the original back"),');
  assert.ok(menu.includes("onClick:()=>{ setMenuOpen(false); gen.remaster(); }},") && menu.includes("Nothing is redrawn and no image is made") && !menu.includes("nbCostChip"));
  assert.ok(art.includes("(genUrl && remasterEligible(genMeta) && typeof gen.remaster===\"function\")") && !art.includes("(forceRemaster || remasterEligible(genMeta))"));
  const lb = between(art, "// (2026-11-20) in code now, and for the image the card shows", '"Remaster this version"),');
  assert.ok(lb.includes("window.__sheetGen[eChar.id].url===cur && remasterEligible(metaByUrl[cur])") && lb.includes("g.remaster();") && !lb.includes("g.generate("));
  assert.ok(art.includes("window.__sheetGen[bid] = { generate, gening, noun, remaster:gen.remaster, url:genUrl };"));
  assert.ok(art.includes("const remaster = ()=> codeEdit(({ baseUrl, meta })=> turnRemasterInCode({ id, url:baseUrl, meta, name:lockName(), noun:opts.noun||\"image\" }),"));
});

await test("6 what Details name: the planner for a change made in code, the image engine for everything else", () => {
  assert.deepEqual(plain(F.nbShownModel({ modelLabel: "GPT Image 2.6 Sunburst", modelId: "gpt-image-2.6" })), { label: "GPT Image 2.6 Sunburst", id: "gpt-image-2.6", code: false });
  assert.deepEqual(plain(F.nbShownModel({ modelId: "gpt-image-2.6" })), { label: "GPT Image 2.6 Sunburst", id: "gpt-image-2.6", code: false });
  const head = { modelLabel: "GPT Image 2.6 Sunburst", modelId: "gpt-image-2.6", builtFromVersion: 7, codeEdit: { kind: "head", by: "Planner X", byId: "planner-x", drew: false } };
  assert.deepEqual(plain(F.nbShownModel(head)), { label: "Planner X", id: "planner-x", code: true }, "not the image engine");
  assert.deepEqual(plain(F.codeEditLines(head)), { did: "The head was put back on the front view: the close-up’s own head, made smaller. Built from v7; nothing was redrawn.", drew: "" });
  const kept = { modelLabel: "Nano Banana 2.1", keptOriginal: true, keptItems: ["work lanyard"], keptChangedPixels: 2972, keptTotalPixels: 2359296, codeEdit: { kind: "add", by: "Planner X", byId: "planner-x", drew: true } };
  const kl = plain(F.codeEditLines(kept));
  assert.equal(kl.did, "Your sheet was kept as it was: 99.9% of its pixels are untouched. Added: work lanyard."); assert.equal(kl.drew, "Nano Banana 2.1", "the engine that drew the new part is said, on its own line");
  assert.deepEqual(plain(F.codeEditLines({ modelLabel: "x" })), { did: "", drew: "" }, "an ordinary image has neither line");
  // the three places that show it, and who planned a kept change
  const det = between(art, "function SheetDetails({", "window.SheetFrame = SheetFrame;");
  assert.ok(det.includes("const modelDetail = nbShownModel(meta).label;") && det.includes('field("Changed in code", codeLines.did || null),') && det.includes('field("New part drawn by", codeLines.drew || null),'));
  assert.ok(det.includes('const modelName = (hm.codeEdit && hm.codeEdit.by) ? hm.codeEdit.by : (hm.modelId || hm.modelLabel || "unknown model");'));
  assert.ok(art.includes('if(field==="model" && m.codeEdit && m.codeEdit.by) return String(m.codeEdit.by);') && art.includes("const sm = nbShownModel(genMeta);"));
  // the two helpers sit beside the frame they serve (a browser fixture lifts the frame's source up to this line)
  assert.ok(art.indexOf("function nbShownModel(meta){") < art.indexOf("window.SheetFrame = SheetFrame;") && art.indexOf("function codeEditLines(meta){") < art.indexOf("window.SheetFrame = SheetFrame;"));
  const ko = between(art, "async function turnKeepOriginal(o){", "/* what the card says afterwards");
  assert.ok(ko.includes("const by = (found && found.by) || o.by || null;") && ko.includes('codeEdit:{ kind:o.kind||"add", by:String(by.label), byId:String(by.id||""), drew:true }'));
  const qa = between(art, "function QaCheckButton({", "window.QaCheckButton");
  assert.ok(qa.includes("rep.readBy = { id:String(lm.id||\"\"), label:String(lm.label) };") && qa.includes("maxPatch:0.04, by:report.readBy||null,"), "an area fix names the reader of its report");
});

await test("6b Upscale, in code: only the sizes above the image's own; the same picture; no engine, no reading", () => {
  const U = { console, Math, Number }; U.window = U;
  vm.runInNewContext(between(art, "const UPSCALE_LONG_EDGE = ", "async function turnUpscaleInCode(o){") + "\nthis.tiers=upscaleTiersFor;", U);
  assert.deepEqual(plain(U.tiers({ pixelW: 1024, pixelH: 576 })), ["2K", "4K"]); assert.deepEqual(plain(U.tiers({ pixelW: 2048, pixelH: 1152 })), ["4K"]);
  assert.deepEqual(plain(U.tiers({ pixelW: 3840, pixelH: 2160 })), [], "nothing above 4K"); assert.deepEqual(plain(U.tiers({ pixelW: 1700, pixelH: 900 })), ["4K"], "2K would hardly be larger");
  assert.deepEqual(plain(U.tiers({})), [], "an image whose size is not known is offered nothing");
  const up = between(art, "async function turnUpscaleInCode(o){", "window.turnUpscaleInCode = turnUpscaleInCode;");
  assert.ok(up.includes("const nw = Math.min(W, cw*2), nh = Math.min(H, chh*2);") && up.includes('g.imageSmoothingQuality = "high";') && up.includes("window.PixelKeep.pkSharpen(id, 0.35);"), "in steps of two, edges kept");
  assert.ok(up.includes('codeEdit:{ kind:"upscale", by:"In code", byId:"", drew:false }') && up.includes("It is the same picture, upscaled in code: nothing was redrawn."));
  assert.ok(!/nbGenerate|aiVisionComplete|aiPlannerRead|generate\(/.test(up), "no engine and no reading in it");
  assert.equal(F.codeEditLines({ pixelW: 2048, pixelH: 1152, upscaledFrom: { w: 1024, h: 576 }, codeEdit: { kind: "upscale", by: "In code" } }).did,
    "Upscaled in code, from 1024\u00d7576 to 2048\u00d71152. It is the same picture; nothing was redrawn and no engine was used.");
  assert.equal(F.nbShownModel({ modelLabel: "GPT Image 2.6 Sunburst", codeEdit: { kind: "upscale", by: "In code" } }).label, "In code", "no model made it larger, and none is named");
  // ONE ITEM, "Resize" (owner 2026-11-20): pressed, it shows the sizes the image can go to, smallest first, smaller or larger
  const menu = between(art, '"data-role":"sheet-resize"', '          // 4K WITH ADDED DETAIL');   // (the free sizes; the one with detail has its price)
  assert.ok(menu.includes('onClick:()=>setResizeOpen(v=>!v)},') && menu.includes('React.createElement(Icon.maximize,{s:14}),"Resize",'));
  assert.ok(menu.includes("[...downscaleTiersFor(genMeta).slice().reverse().map(t=>({ t, up:false })), ...upscaleTiersFor(genMeta).map(t=>({ t, up:true }))]"), "smallest first");
  assert.ok(menu.includes('x.t+" \\u2014 "+(x.up ? "larger" : "smaller")') && menu.includes("if(x.up) gen.upscale(x.t); else gen.downscale(x.t);") && menu.includes("setMenuOpen(false); setResizeOpen(false);"));
  assert.ok(menu.includes("It does not add detail that was never drawn. No credits.") && menu.includes("Fine detail is lost with the size. No credits.") && !menu.includes("nbCostChip"));
  assert.ok(!art.includes('"Upscale \\u2014 "+t') && !art.includes('"Downscale \\u2014 "+t'), "not two separate items any more");
  assert.ok(art.includes("React.useEffect(()=>{ if(!menuOpen) setResizeOpen(false); },[menuOpen]);"), "closed again with the menu");
  // NOTHING IS LOST BY GOING DOWN AND UP AGAIN (owner 2026-11-20): every resize is made from the master, the largest true
  // version; back at the master's own size it is the master itself, byte for byte
  const hk = between(art, "  const resizeFromMaster = (tier, up)=> codeEdit(", "  /* how many variant sub-sheets a Clear would also remove");
  assert.ok(hk.includes("const mv = h.find(x=> x && x.url && x.meta && x.meta.iso===meta.resizeMasterIso);") && hk.includes("if(mv){ srcUrl = mv.url; masterIso = meta.resizeMasterIso; fromMaster = true; }"));
  assert.ok(hk.includes("const upscale = (tier)=> resizeFromMaster(tier, true);") && hk.includes("const downscale = (tier)=> resizeFromMaster(tier, false);"));
  const rz = between(art, "async function turnResizeInCode(o){", "window.turnResizeInCode = turnResizeInCode;");
  assert.ok(rz.includes("if(o.fromMaster && k>1/1.3 && k<1.3){") && rz.includes("fr.readAsDataURL(blob);") && rz.includes('codeEdit:{ kind:"resize-back", by:"In code", byId:"", drew:false }'), "the master's own bytes, not a redraw of them");
  assert.ok(rz.includes("const keep = { resizeMasterIso:o.masterIso||\"\", resizeMasterPx:{ w:w0, h:h0 } };") && rz.includes("else if(k>=1.3) r = await turnUpscaleInCode(") && rz.includes("else r = await turnDownscaleInCode("));
  assert.ok(rz.includes("is no longer in its versions, so this was made from the image as it is"), "said plainly when the master is gone");
  for (const kkey of ['"resizeMasterIso"', '"upscaledFrom"', '"downscaledFrom"']) assert.ok(between(art, "const CODE_EDIT_NOT_CARRIED = [", "];").includes(kkey), "a change to the picture starts a new master: " + kkey);
  assert.equal(F.codeEditLines({ pixelW: 4096, pixelH: 2304, codeEdit: { kind: "resize-back", by: "In code" } }).did,
    "Brought back to its full size in code: this is the picture it was resized from, exactly as it was (4096\u00d72304). Nothing was lost and no engine was used.");
  // DOWNSCALE, the opposite (owner 2026-11-20): only the sizes below the image's own; by halves; no engine, no reading
  const Dn = { console, Math, Number }; Dn.window = Dn;
  vm.runInNewContext(between(art, "const DOWNSCALE_LONG_EDGE = ", "async function turnDownscaleInCode(o){") + "\nthis.tiers=downscaleTiersFor;", Dn);
  assert.deepEqual(plain(Dn.tiers({ pixelW: 4096, pixelH: 2304 })), ["2K", "1K"]); assert.deepEqual(plain(Dn.tiers({ pixelW: 2048, pixelH: 1152 })), ["1K"]);
  assert.deepEqual(plain(Dn.tiers({ pixelW: 2731, pixelH: 1536 })), ["2K", "1K"]); assert.deepEqual(plain(Dn.tiers({ pixelW: 1024, pixelH: 576 })), []); assert.deepEqual(plain(Dn.tiers({})), []);
  const dn = between(art, "async function turnDownscaleInCode(o){", "window.turnDownscaleInCode = turnDownscaleInCode;");
  assert.ok(dn.includes("const nw = Math.max(W, Math.ceil(cw/2)), nh = Math.max(H, Math.ceil(chh/2));") && dn.includes('codeEdit:{ kind:"downscale", by:"In code", byId:"", drew:false }') && !/nbGenerate|aiVisionComplete|aiPlannerRead|generate\(/.test(dn));
  assert.equal(F.codeEditLines({ pixelW: 1024, pixelH: 576, downscaledFrom: { w: 2048, h: 1152 }, codeEdit: { kind: "downscale", by: "In code" } }).did,
    "Downscaled in code, from 2048\u00d71152 to 1024\u00d7576. It is the same picture; nothing was redrawn and no engine was used.");
  // pkSharpen: flat areas stay as they are, an edge gets a little stronger, the picture keeps its size
  const flat = { width: 6, height: 6, data: new Uint8ClampedArray(6 * 6 * 4).fill(120) }; PK.pkSharpen(flat); assert.ok(flat.data.every((v) => v === 120));
  const edge = { width: 6, height: 6, data: new Uint8ClampedArray(6 * 6 * 4) }; for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++){ const i = (y * 6 + x) * 4, v = x < 3 ? 80 : 160; edge.data[i] = edge.data[i + 1] = edge.data[i + 2] = v; edge.data[i + 3] = 255; }
  PK.pkSharpen(edge); assert.ok(edge.data[(2 * 6 + 2) * 4] < 80 && edge.data[(2 * 6 + 3) * 4] > 160 && edge.data[(2 * 6 + 1) * 4] === 80);
  // the sheet's own instructions: room above and below the figures, and a natural stance, the same front and back
  assert.ok(art.includes("headroom_rule: \"in panels 2 and 3 the figures do NOT fill the panel's height") && art.includes("never a rigid mannequin, a soldier at attention or a T-pose") && art.includes("the SAME natural stance as panel 2 seen from behind"));
});

await test("6d 4K with added detail: the engine's fine detail only, where it agrees with the picture; the picture stays its own", () => {
  // two made-up pictures: the same broad picture; the "engine's" has fine texture, sits 2 px right and 1 px down, and has one corner changed
  const w = 400, h = 240, mk = (f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const c = f(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } return { width: w, height: h, data: d }; };
  const broad = (x, y) => { const v = 120 + 60 * Math.sin(x / 40) + 30 * Math.cos(y / 35); return [v, v * 0.8, v * 0.6]; }, tex = (x, y) => 14 * (((x * 7 + y * 13) % 5) - 2);
  const base = mk(broad), eng = mk((x, y) => { const X = x - 2, Y = y - 1; return (x > 300 && y > 150) ? [30, 200, 60] : broad(X, Y).map((v) => v + tex(X, Y)); });
  const r = PK.pkDetailTransfer(base, eng);
  assert.deepEqual(plain(r.shift), [2, 1], "the engine's picture is slid to where it fits");
  assert.ok(r.coverage > 0.85 && r.coverage < 0.97, "most of it agrees, the changed corner does not: " + r.coverage);
  const rough = (im, x0, y0, x1, y1) => { let s = 0, c = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1 - 1; x++){ s += Math.abs(im.data[(y * w + x) * 4] - im.data[(y * w + x + 1) * 4]); c++; } return s / c; };
  assert.ok(rough(base, 50, 50, 250, 130) < 2 && rough(r.out, 50, 50, 250, 130) > 25, "the fine detail is there now");
  // the broad picture is still the base's: averaged over a patch, the result is the base
  const mean = (im, x0, y0) => { let s = 0; for (let y = y0; y < y0 + 20; y++) for (let x = x0; x < x0 + 20; x++) s += im.data[(y * w + x) * 4]; return s / 400; };
  for (const [x, y] of [[60, 60], [180, 100], [240, 40]]) assert.ok(Math.abs(mean(r.out, x, y) - mean(base, x, y)) < 2, "shapes and colours are the picture's own at " + x + "," + y);
  // where the engine changed the picture, the base is untouched
  for (const [x, y] of [[350, 200], [380, 220], [330, 180]]){ const i = (y * w + x) * 4; assert.deepEqual([...r.out.data.slice(i, i + 3)], [...base.data.slice(i, i + 3)], "the changed corner"); }
  // an engine picture that is another picture gives no coverage; two sizes are refused
  assert.ok(PK.pkDetailTransfer(base, mk((x, y) => [255 - broad(x, y)[0], 40, 200])).coverage < 0.2);
  assert.equal(PK.pkDetailTransfer(base, { width: 10, height: 10, data: new Uint8ClampedArray(400) }).failed, "the two pictures are not the same size");
  // the app side: one engine image at 4K, the keeper decides; under a third agreed, the plain 4K is saved and it says so
  const kp = between(art, "async function turnUpscaleDetailKeep(io, o){", "window.turnUpscaleDetailKeep = turnUpscaleDetailKeep;");
  assert.ok(kp.includes("PK.pkDetailTransfer(U, E)") && kp.includes("if(!r || !r.out || !(r.coverage>=0.33)){") && kp.includes("so none of its detail was used.") && kp.includes('codeEdit:{ kind:"upscale-detail", by:"In code", byId:"", drew:true }'));
  assert.ok(art.includes("const upscaleDetail = ()=> generate({ editInstruction:UPSCALE_DETAIL_INSTRUCTION, imageSize:\"4K\", wholeRedraw:true,") && art.includes("Do NOT move, redraw, restyle, add or remove anything"));
  const mi = between(art, '"data-role":"sheet-upscale-detail"', 'window.nbCostChip(1, { res:"4K", refs:1 })),');
  assert.ok(mi.includes('"4K \\u2014 larger, with detail"') && mi.includes("gen.upscaleDetail();") && mi.includes("One image at 4K."), "offered with its price");
  // the "59 of 100 styles" count left the three cards (owner 2026-11-20)
  for (const src of [art, props, read("app/locations-ui.jsx")]) assert.ok(!/turnCanLockStyles\(\)\) && React\.createElement\("span",\{className:"[a-z-]*style-count/.test(src));
  // (owner 2026-11-20) offered wherever 4K is larger; an engine that cannot render 4K gets a notice in the middle of the screen, and nothing is spent
  const nudge = between(art, '"data-role":"sheet-upscale-detail"', "gen.upscaleDetail(); }},");
  assert.ok(art.includes('upscaleTiersFor(genMeta).indexOf("4K")>=0)') && nudge.includes('if(max!=="4K"){') && nudge.includes('title:label+" does not render 4K"')
    && nudge.includes('confirmLabel:"OK", hideCancel:true') && nudge.includes("Nothing was spent.") && nudge.indexOf("return; }") < nudge.length);
  assert.equal(F.codeEditLines({ modelLabel: "GPT Image 2.6 Sunburst", pixelW: 4096, pixelH: 2304, upscaledFrom: { w: 2048, h: 1152 }, detailCoverage: 0.91, codeEdit: { kind: "upscale-detail", by: "In code", drew: true } }).drew, "GPT Image 2.6 Sunburst");
});

await test("6c the stance comes from who the character is; the prop card is grouped like the character card", () => {
  const B = { console, String, Number, Array, Object }; B.window = B;
  vm.runInNewContext(between(art, "function charBearingLine(c){", "window.charBearingLine = charBearingLine;") + "\nthis.bearing=charBearingLine;this.stance=charStanceText;", B);
  assert.equal(B.bearing(null), ""); assert.equal(B.bearing({ name: "X" }), "", "nothing known yet");
  const c = { conscious: "to get his daughter home safe", unconscious: "to be forgiven for the night he was not there", dimensions: ["gentle, and immovable", "proud, and ashamed"], arcStages: { 1: "carries himself small, eyes on the road", 3: "stands his ground" } };
  assert.equal(B.bearing(c), "wants to get his daughter home safe | needs, unspoken, to be forgiven for the night he was not there | contradictions: gentle, and immovable; proud, and ashamed | when the story finds them: carries himself small, eyes on the road");
  assert.ok(B.stance(c).startsWith("standing the way THIS person stands \u2014 their bearing comes from who they are (wants to get his daughter home safe") && B.stance(c).includes("nothing written or symbolic"));
  assert.ok(B.stance({}).startsWith("standing the way this person naturally stands"), "a plain natural stance when the Cast panel says nothing");
  assert.ok(art.includes('+", "+charStanceText(c)+", clean silhouette, the full outfit and shoes visible",'), "it is in the sheet's own instructions");
  // the prop card's lower half: The object · Continuity · Advanced
  const card = between(props, 'React.createElement(window.CardGroup,{label:"The object",defaultOpen:(!drafted && !!p.manual)},', "\n}\n");
  const at = (k) => { const i = card.indexOf(k); assert.ok(i >= 0, k); return i; };
  const order = ['label:"Screenplay evidence"', 'label:"Story & ownership"', 'label:"Physical design"', "      ),\n      React.createElement(CardFold,{label:\"Continuity \\u00b7 story events\"",
    'React.createElement(window.CardGroup,{label:"Advanced"},', 'label:"Look & exclusions"', 'label:"Generation prompt"'].map(at);
  assert.deepEqual(order, [...order].sort((x, y) => x - y)); assert.ok(art.includes("window.CardGroup = CardGroup;"));
});

await test("7 the planner's reads; Frances; the page loads the new files", () => {
  const pl = between(ai, "const EDIT_PLANNER_MODEL_ID = ", "window.EDIT_PLANNER_MODEL_ID");
  assert.ok(pl.includes("res = await aiVisionComplete(messages, images, { ...(opts||{}), modelId:EDIT_PLANNER_MODEL_ID });") && pl.includes("catch(e){ pinned = false; res = await aiVisionComplete(messages, images, opts||{}); }"),
    "an account that cannot use the planner is read on its own engine");
  assert.ok(pl.includes("const m = window.__lastWritingModel || null;") && pl.includes("by: m ? { id:m.id, label:m.label } : null"), "the record names who really looked");
  assert.ok(/WRITING_MODELS\.find\(x=>x\.id===EDIT_PLANNER_MODEL_ID\)/.test(pl), "its name comes from the engine list, not from a literal");
  const li = between(ai, "async function aiLocateItems(url, items){", "window.aiLocateItems = aiLocateItems;");
  assert.ok(li.includes("aiPlannerRead(") && li.includes("out.by = res.by || null;"));
  const hp = between(ai, "async function aiPlanHeadBack(url, instruction){", "window.aiPlanHeadBack = aiPlanHeadBack;");
  assert.ok(hp.includes("in thousandths of the image") && hp.includes("Never guess: a part you cannot see is null.") && hp.includes('"asked": true when this instruction asks for a head to be put (back) on the headless full-body view and for nothing else')
    && hp.includes("if(!res.vision) return { unsupported:true };") && hp.includes("aiPlannerRead("));
  const lc = between(ai, "async function aiLocateChanges(baseUrl, url, asked){", "window.aiLocateChanges = aiLocateChanges;");
  assert.ok(lc.includes("IMAGE 1 is the ORIGINAL") && lc.includes("they were NOT asked for, ignore them") && lc.includes("Never guess a box.") && lc.includes("aiPlannerRead([{ role:\"user\", content:prompt }], [a, b]"));
  for (const f of [hp, lc]) assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic|Fable|Gemini|GPT/.test(f.replace(/turnDownscaleDataUrl/g, "")), "nothing the reader is told names the codename or a vendor");
  const fr = between(ai, 'APP_FEATURES.push({ name:"Edits on a sheet are made in code: the image is kept and only the change goes in (Characters, Props, Art Room)"', "function appBrief(){");
  for (const w of ["Your image is kept as it is, pixel for pixel", "made entirely in code, with no image engine", "'Keep my image'", "'Use the engine's picture'", "Remaster \\u2014 bring the original back", "It makes no image",
    "'Changed in code'", "'New part drawn by'", "it cannot draw something new", "Hair that falls below the chin is not carried", "RESIZE ('Resize' in the image's", "it does NOT add detail that was never drawn",
    "THE TWO FULL-BODY VIEWS STAY LEVEL", "lined up with the body by their clothes", "HOW A CHARACTER STANDS ON A NEW SHEET", "GOING SMALLER (downscaling)", "NOTHING IS LOST BY GOING DOWN AND UP AGAIN", "4K WITH ADDED DETAIL ('4K \\u2014 larger, with detail'", "THE PROP CARD IS LAID OUT LIKE THE CHARACTER CARD"]) assert.ok(fr.includes(w), w);
  assert.ok(!/\bTURN\b|McKee|Claude|Anthropic|Fable|Gemini|GPT/.test(fr));
  assert.ok(!ai.includes("clean re-render"), "the old name of Remaster is gone from what Frances is told");
  for (const file of ["artroom.jsx", "props.jsx", "ai.jsx", "pixel-keep.js"]) assert.ok(["20261120-code1", "20261120-detail1", "20261120-gta1"].some((k) => html.includes(file + "?v=" + k + '"')), file + " has the new key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

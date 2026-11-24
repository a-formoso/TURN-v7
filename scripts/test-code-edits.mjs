#!/usr/bin/env node
/* Edits made in code (owner 2026-11-20: "printing back out whatever … we already had, and using code … I want all of
   the editing features … to be done with code"; "they should see [the planner] as the model that did the
   editing/changes").

   1 The front view has no head, by design, and it stays that way (owner, later the same day: "keep it as it was
     before, having a character sheet with a midsection without a head … don't flag the missing head … That is there
     by design"). Nothing in the app puts a head there, and the QA check is told never to report it.
   4 Every edit on a character or prop sheet is kept: the caller's keeper, else the general one.
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

await test("1 the front view has no head, by design: nothing puts one there, and the QA check never reports it", () => {
  // the head-back edit is out of the app, whole: the code, its reading, its path in an edit
  assert.deepEqual(Object.keys(PK).sort(), ["pkAlign", "pkBlurBox", "pkBox", "pkCompose", "pkCount", "pkDetailTransfer", "pkOnlyInside", "pkPlacements", "pkSharpen"]);
  for (const src of [pk, art, ai]) assert.ok(!/pkHeadBack|pkHeadPlan|pkNeckOpening|pkMoveDown|turnHeadBack|turnEditAsksHeadBack|aiPlanHeadBack/.test(src));
  const g = between(art, "  const generate = async (gopts)=>{", "    return await nbRunSheetGeneration({");
  assert.ok(!/HeadBack|codeEdit\(/.test(g), "an edit goes to the runner like any other");
  // the sheet is asked for as before: no head and no neck on the front view, and no band kept free for one
  assert.ok(art.includes("NO head and NO neck are rendered") && art.includes("the missing head must NOT enlarge the front figure"));
  assert.ok(!/headroom_rule|HEADROOM:/.test(art));
  // the check: told in plain words, on every character sheet, whatever its stored prompt says
  const qa = between(art, "function QaCheckButton({", "window.QaCheckButton");
  assert.ok(qa.includes('if(contract && script && script.c && !gm.headBack) contract += "\\n\\n"+QA_HEADLESS_BY_DESIGN;'));
  const rule = between(art, "const QA_HEADLESS_BY_DESIGN = ", "window.QA_HEADLESS_BY_DESIGN");
  for (const w of ["HAS NO HEAD AND NO NECK", "This is correct.", "Never report the missing head, neck, face or hair on that view as a drift, a fault, a warning or a note", "never suggest adding a head there"]) assert.ok(rule.includes(w), w);
  // a sheet made while a head could be put there keeps its head, and its check still knows it
  assert.ok(qa.includes('if(contract && gm.headBack) contract += "\\n\\nON THIS IMAGE THE FRONT FULL-BODY VIEW HAS ITS HEAD'));
  assert.ok(art.includes("if(keptMeta && keptMeta.keptOriginal && genMeta && genMeta.headBack) meta.headBack = genMeta.headBack;"));
});

const sb = { console, String, Number, Array, JSON, Math }; sb.window = sb; sb.nbModelLabel = (id) => ({ "gpt-image-2.6": "GPT Image 2.6 Sunburst" }[id] || "");
vm.runInNewContext(between(art, "function turnKeptSummary(meta){", "/* KEEP, OR ASK")
  + "\n" + between(art, "function remasterIsEngineEdit(m){", "async function turnRemasterInCode(o){") + "\n" + between(art, "function nbShownModel(meta){", "window.nbShownModel = nbShownModel;")
  + "\n" + between(art, "function remasterEligible(meta){", "window.remasterEligible = remasterEligible;")
  + "\nthis.F={turnKeptSummary,remasterIsEngineEdit,nbShownModel,codeEditLines,remasterEligible}; this.codeEditBy=codeEditBy;", sb);
const F = sb.F;

await test("4 every edit on a character or prop sheet is kept", () => {
  const run = between(art, "      let keptMeta = null;", "      // Record the actual returned pixels");
  assert.ok(run.includes('const _keeper = !isEditMode ? null : (typeof gopts.keepOriginal==="function") ? gopts.keepOriginal'), "the caller's own keeper first");
  assert.ok(run.includes('(opts.keepEdits && !gopts.wholeRedraw && typeof turnKeepEdit==="function")') && run.includes("turnKeepEdit(io, { instruction:gopts.editInstruction,"), "else the general one, on a card that keeps its edits");
  assert.ok(run.includes("if(kept && kept.discard) throw new Error(") && run.includes("if(kept && kept.url){ url = kept.url; keptMeta = kept.meta || null; }"));
  // the cards that keep their edits: a character's sheet, an appearance state's, a prop's image
  assert.equal(art.split('const gen = useImageGen({\n    keepEdits:true, noun:"sheet",').length - 1, 2); assert.ok(props.includes('const gen = useImageGen({\n    keepEdits:true, noun:"image",'));
  // the general keeper: one look at the two pictures, then keep or ask; a change may be large
  const k = between(art, "async function turnKeepEdit(io, o){", "window.turnKeepEdit = turnKeepEdit;");
  assert.ok(k.includes("found = await window.aiLocateChanges(io.baseUrl, io.url, [instr]);") && k.includes('failed:"what the edit changed could not be found"') && k.includes('kind:"edit", items:found.map(x=>x.item), found, maxPatch:0.3, whose, by:found.by'));
  const ask = between(art, "async function turnKeepOrAsk(io, o){", "/* THE AREAS A QA REPORT MARKED");
  assert.ok(ask.includes('const r = (o && o.failed) ? { failed:o.failed, placed:[], skipped:[] } : await turnKeepOriginal({') && ask.includes('edit ? "The edit could not be made in place on "') && ask.includes('cancelLabel:fix ? "Keep my image" : "Keep my sheet"'));
  assert.equal(F.turnKeptSummary({ keptOriginal: true, keptKind: "edit", keptItems: ["red scarf"], keptChangedPixels: 4000, keptTotalPixels: 2000000 }), "Your image was kept as it was: 99.8% of its pixels are untouched. Changed: red scarf.");
  // saved as a new version; what one version owns is not carried on; a later kept change keeps the record of the head
  const ce = between(art, "  const codeEdit = async (make, o)=>{", "  /* REMASTER, IN CODE (owner 2026-11-20): the version before the edit is brought back");
  assert.ok(ce.includes("CODE_EDIT_NOT_CARRIED.forEach(k=>{ delete meta[k]; });") && ce.includes("const saveResult = await nbCommit(id, r.url, meta, [], assetKind, _editEpoch);") && ce.includes('if(!r || !r.url){ say(r && r.message); }'));
  assert.ok(ce.includes('if(sheetLockOf(genMeta) && !o.lockOk && !(await turnLockedAsk(genMeta, lockName(), "image", "change it"))) return false;') && !/nbGenerate/.test(ce));
  for (const kkey of ['"qa"', '"lock"', '"approval"', '"keptOriginal"', '"codeEdit"']) assert.ok(between(art, "const CODE_EDIT_NOT_CARRIED = [", "];").includes(kkey), kkey);
});

await test("5 Remaster is made in code: offered where there is something to bring back, and it makes no image", () => {
  const E = { mode: "edit", editInstruction: "add a scarf" };
  assert.equal(F.remasterEligible(E), true); assert.equal(F.remasterEligible({ ...E, keptOriginal: true }), false, "a kept edit has nothing to restore");
  assert.equal(F.remasterEligible({ ...E, codeEdit: { by: "x" } }), false); assert.equal(F.remasterEligible({ mode: "base" }), false, "a fresh image");
  assert.equal(F.remasterEligible({ mode: "edit", editInstruction: "REMASTER this sheet: …" }), false, "an old remaster pass"); assert.equal(F.remasterEligible(null), false);
  const rm = between(art, "async function turnRemasterInCode(o){", "window.turnRemasterInCode = turnRemasterInCode;");
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
  assert.ok(art.includes('if(field==="model" && m.codeEdit && m.codeEdit.by) return (typeof codeEditByShown==="function") ? codeEditByShown(m.codeEdit).by : String(m.codeEdit.by);') && art.includes("const sm = nbShownModel(genMeta);"));
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
  assert.ok(up.includes('codeEdit:{ kind:"upscale", ...codeEditBy(), drew:false }') && up.includes("It is the same picture, upscaled in code: nothing was redrawn."));
  assert.ok(!/nbGenerate|aiVisionComplete|aiPlannerRead|generate\(/.test(up), "no engine and no reading in it");
  assert.equal(F.codeEditLines({ pixelW: 2048, pixelH: 1152, upscaledFrom: { w: 1024, h: 576 }, codeEdit: { kind: "upscale", by: "In code" } }).did,
    "Upscaled in code, from 1024\u00d7576 to 2048\u00d71152. It is the same picture; nothing was redrawn and no engine was used.");
  // (owner 2026-11-21: "when a user chooses to resize an image, Fable 5.2 is automatically selected for this task") a resize is
  // credited to the planner, by the name the engine list gives it; one recorded as "In code" before that day reads the same
  sb.editPlannerLabel = () => "Planner X"; sb.EDIT_PLANNER_MODEL_ID = "planner-x";
  assert.deepEqual(plain(sb.codeEditBy()), { by: "Planner X", byId: "planner-x" });
  assert.deepEqual(plain(F.nbShownModel({ modelLabel: "GPT Image 2.6 Sunburst", codeEdit: { kind: "upscale", by: "In code" } })), { label: "Planner X", id: "planner-x", code: true }, "an earlier resize is shown under the same name");
  assert.equal(sb.sheetCapValue ? sb.sheetCapValue("model", { modelLabel: "GPT Image 2.6 Sunburst", codeEdit: { kind: "downscale", by: "In code" } }) : "Planner X", "Planner X");
  sb.editPlannerLabel = () => ""; assert.deepEqual(plain(sb.codeEditBy()), { by: "In code", byId: "" }, "no planner in the engine list: it says In code, never a made-up name");
  assert.equal(F.nbShownModel({ modelLabel: "GPT Image 2.6 Sunburst", codeEdit: { kind: "upscale", by: "In code" } }).label, "In code");
  delete sb.editPlannerLabel; delete sb.EDIT_PLANNER_MODEL_ID;
  assert.ok(!/by:"In code", byId:"", drew:/.test(art) && art.split("...codeEditBy(), drew:").length - 1 === 5, "every resize path");
  assert.ok(!/Fable|Claude|Anthropic/.test(between(art, "function codeEditBy(){", "window.codeEditBy = codeEditBy;")), "its name comes from the engine list, not from a literal");
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
  assert.ok(rz.includes("if(o.fromMaster && k>1/1.3 && k<1.3){") && rz.includes("fr.readAsDataURL(blob);") && rz.includes('codeEdit:{ kind:"resize-back", ...codeEditBy(), drew:false }'), "the master's own bytes, not a redraw of them");
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
  assert.ok(dn.includes("const nw = Math.max(W, Math.ceil(cw/2)), nh = Math.max(H, Math.ceil(chh/2));") && dn.includes('codeEdit:{ kind:"downscale", ...codeEditBy(), drew:false }') && !/nbGenerate|aiVisionComplete|aiPlannerRead|generate\(/.test(dn));
  assert.equal(F.codeEditLines({ pixelW: 1024, pixelH: 576, downscaledFrom: { w: 2048, h: 1152 }, codeEdit: { kind: "downscale", by: "In code" } }).did,
    "Downscaled in code, from 2048\u00d71152 to 1024\u00d7576. It is the same picture; nothing was redrawn and no engine was used.");
  // pkSharpen: flat areas stay as they are, an edge gets a little stronger, the picture keeps its size
  const flat = { width: 6, height: 6, data: new Uint8ClampedArray(6 * 6 * 4).fill(120) }; PK.pkSharpen(flat); assert.ok(flat.data.every((v) => v === 120));
  const edge = { width: 6, height: 6, data: new Uint8ClampedArray(6 * 6 * 4) }; for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++){ const i = (y * 6 + x) * 4, v = x < 3 ? 80 : 160; edge.data[i] = edge.data[i + 1] = edge.data[i + 2] = v; edge.data[i + 3] = 255; }
  PK.pkSharpen(edge); assert.ok(edge.data[(2 * 6 + 2) * 4] < 80 && edge.data[(2 * 6 + 3) * 4] > 160 && edge.data[(2 * 6 + 1) * 4] === 80);
  // the sheet's own instructions: a natural stance, the same front and back
  assert.ok(art.includes("never a rigid mannequin, a soldier at attention or a T-pose") && art.includes("the SAME natural stance as panel 2 seen from behind"));
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
  assert.ok(kp.includes("PK.pkDetailTransfer(U, E, { radius:detailRadius })") && kp.includes("const detailRadius = Math.max(2, Math.round(Math.max(W,H)/1024), Math.round(k*1.25));") && kp.includes("if(!r || !r.out || !(r.coverage>=0.33)){") && kp.includes("so none of its detail was used.") && kp.includes('codeEdit:{ kind:"upscale-detail", ...codeEditBy(), drew:true }'));
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

await test("6f 4K with detail leaves no light or dark line along a strong edge (owner: 'tune the outline')", () => {
  // a dark cap against a light wall. The enlarged picture has the edge a little soft; the engine draws it sharp.
  const w = 240, h = 120, mk = (f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const v = f(x, y), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { width: w, height: h, data: d }; };
  const sharp = (x) => x < 120 ? 60 : 180, soft = (x) => (sharp(x - 1) + sharp(x) + sharp(x + 1)) / 3;
  const base = mk((x) => soft(x)), eng = mk((x) => sharp(x));
  const at = (im, x) => im.data[(60 * w + x) * 4];
  // 1 the engine's fine part REPLACES the picture's own. Added on top of it (as it was), the light side came out at 188
  //   and the dark side at 52: a light line and a dark line that neither picture has.
  const r = PK.pkDetailTransfer(base, eng);
  let mn = 255, mx = 0; for (let x = 4; x < w - 4; x++){ mn = Math.min(mn, at(r.out, x)); mx = Math.max(mx, at(r.out, x)); }
  assert.ok(mn >= 60 && mx <= 180, "nothing lighter than the wall or darker than the cap: " + mn + ".." + mx);
  assert.ok(at(r.out, 119) <= 64 && at(r.out, 120) >= 176, "and the edge is sharp now: " + at(r.out, 119) + " | " + at(r.out, 120));
  assert.ok(at(base, 119) === 100 && at(base, 120) === 140, "(it was soft)");
  // 2 an edge the engine drew four pixels away is not copied in beside the real one: the picture keeps its own edge
  const m = PK.pkDetailTransfer(base, mk((x) => sharp(x - 4)), { maxShift: 0 });
  for (let x = 100; x < 140; x++) assert.ok(Math.abs(at(m.out, x) - at(base, x)) <= 2, "the picture's own edge at " + x + ": " + at(m.out, x) + " vs " + at(base, x));
  // 3 no pixel ends past what either picture has within two pixels of it, whatever the texture
  const tex = (x, y) => 22 * (((x * 5 + y * 3) % 4) - 1.5), eb = mk((x, y) => sharp(x) + tex(x, y)), bb = mk((x, y) => soft(x) + tex(x, y) * 0.3);
  const t = PK.pkDetailTransfer(bb, eb, { maxShift: 0 });
  for (let y = 4; y < h - 4; y += 3) for (let x = 4; x < w - 4; x++){ let lo = 255, hi = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const im of [bb, eb]){ const v = im.data[((y + dy) * w + x + dx) * 4]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const v = t.out.data[(y * w + x) * 4]; assert.ok(v >= lo && v <= hi, "within what is there at " + x + "," + y + ": " + v + " in " + lo + ".." + hi); }
  // a softer picture (a small sheet made four times larger) is given a wider fine part by the app
  const src = pk; assert.ok(src.includes("const r = o.radius || Math.max(2, Math.round(Math.max(w,h)/1024))") && src.includes("LB = LE = null;"));
  for (const wds of ["REPLACES the base's own fine part", "the base\n         keeps its own edge", "no pixel ends lighter than the lightest, or darker than the darkest"]) assert.ok(src.includes(wds), wds);
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
  // (owner 2026-11-20: "Remove selected elements … also remove the Fitting button") gone from the prop card: the "Not in
  // screenplay" pill, the ticked "From X's sheet" pill (the marked one, with "Make it again", stays), the Fitting button
  assert.ok(!props.includes('React.createElement(Icon.alert,{s:10}),"Not in screenplay")') && !props.includes('React.createElement(Icon.box,{s:12}),"Fitting")'));
  assert.ok(props.includes('(anchor && anchor.mark) && React.createElement("div",{className:"prop-status-row prop-anchor-row"'));
  // ONE CARD LOOK, GROUPS INCLUDED (owner 2026-11-20: "look at what we did for locations as far as spacing … replicate that"):
  // the location card's own rules, for a section that sits in a group too; no new pattern
  const cssAll = read("app/styles.css"), CARDS = ":is([data-location-card],[data-char-card],[data-prop-card],[data-shot-card],[data-look-card],[data-crowd-card])";
  assert.ok(cssAll.includes(".artroom " + CARDS + " > .sheet-body > :is(.sheet-fold,.sheet-group) + :is(.sheet-fold,.sheet-group){margin-top:calc(-1 * var(--card-gap,15px))}"), "rows touch on every card");
  assert.ok(cssAll.includes(CARDS + " > .sheet-body:has(> .sheet-group:last-child){padding-bottom:0}"));
  const boxOf = (sel) => { const i = cssAll.indexOf(sel); assert.ok(i >= 0, sel); const a = cssAll.indexOf("{", i) + 1; return cssAll.slice(a, cssAll.indexOf("}", a)); };
  const fields = " > :is(.sheet-field,.loc-anchor-field,.loc-render-style-details,.loc-sub,.char-phys,.role-fields,.sheet-2col,.prop-more-fields,.prop-content-fields,.bs-launch)";
  assert.equal(boxOf(CARDS + " > .sheet-body > .sheet-group > .sheet-group-body > .sheet-fold > .sheet-fold-body" + fields), boxOf(CARDS + " > .sheet-body > .sheet-fold > .sheet-fold-body" + fields),
    "a subsection in a group's section has exactly the box a location's has");
  // the prop card's lower half: The object · Continuity · Advanced
  const card = between(props, 'React.createElement(window.CardGroup,{label:"The object",defaultOpen:(!drafted && !!p.manual)},', "\n}\n");
  const at = (k) => { const i = card.indexOf(k); assert.ok(i >= 0, k); return i; };
  const order = ['label:"Screenplay evidence"', 'label:"Story & ownership"', 'label:"Physical design"', "      ),\n      React.createElement(CardFold,{label:\"Continuity \\u00b7 story events\"",
    'React.createElement(window.CardGroup,{label:"Advanced"},', 'label:"Look & exclusions"', 'label:"Generation prompt"'].map(at);
  assert.deepEqual(order, [...order].sort((x, y) => x - y)); assert.ok(art.includes("window.CardGroup = CardGroup;"));
});

await test("6e code tasks are charged, by the server, at the approved prices; the app only shows them", async () => {
  // (owner 2026-11-20: "let's charge for everything. Even when we're using code"; "yes, build the charging with these prices")
  const P = await import(new URL("../supabase/functions/image-proxy/billing-pricing.mjs", import.meta.url));
  assert.deepEqual({ ...P.CODE_TASK_USD }, { resize: 0.01, head: 0.06, remaster: 0.06, keep: 0.01, detail: 0.03 });   // (the head and the remaster by their worth: 6 credits)
  assert.deepEqual([["resize", 1], ["head", 2], ["remaster", 2], ["keep", 1], ["detail", 3]].map(([k]) => P.codeTaskCost(k).credits), [1, 6, 6, 1, 3], "in credits at one cent a credit");
  assert.equal(P.codeTaskCost("resize", 0.03).credits, 1, "never under one credit"); assert.equal(P.codeTaskCost("detail").providerCostUsd, 0, "no provider behind it");
  for (const k of ["", "image", "resize-back", "__proto__", "toString", null]) assert.equal(P.codeTaskCost(k), null, "not a priced task: " + k);
  // the app's table is the server's
  const pricing = read("app/pricing.jsx");
  assert.ok(pricing.includes("const TURN_CODE_TASK_USD = { resize:0.01, head:0.06, remaster:0.06, keep:0.01, detail:0.03 };"));
  // the server: priced, held and settled before anything is answered; an unknown task is a 400; the owner of a shared film pays as for an image
  const idx = read("supabase/functions/image-proxy/index.ts"), h = between(idx, '  if (task === "code") {', "  // \u2500\u2500 task: LIVE");
  assert.ok(h.includes("const codeCost = codeTaskCost(codeKind, codeUnit);") && h.includes('code: "bad_code_task" }, 400);') && h.includes("if (codeUnit == null) return refuse(billingUnavailable());"));
  assert.ok(h.includes('await takeHold(codeCost.credits, "image", `code:${codeKind}`);') && h.includes("if (codeHoldBlock) return codeHoldBlock;") && h.includes("await settleHold(codeHold, codeCost.credits);"));
  assert.ok(h.indexOf("takeHold(") < h.indexOf("return json({ ok: true"), "held before it answers");
  assert.ok(idx.includes('|| task === "video" || task === "code";'), "not an image request: no engine, no quality");
  // the app: asks after the work succeeded and before it is saved; refused, nothing is saved
  const ch = between(art, "async function turnChargeCodeTask(kind){", "window.turnChargeCodeTask = turnChargeCodeTask;");
  assert.ok(ch.includes("if(!window.TURN_CODE_CHARGING) return { ok:true, credits:0 };") && ch.includes('task:"code", codeTask:String(kind||"")') && ch.includes('new CustomEvent("turn-credits-changed"'));
  const ce = between(art, "  const codeEdit = async (make, o)=>{", "  /* REMASTER, IN CODE (owner 2026-11-20): the version before the edit is brought back");
  assert.ok(ce.includes("const paid = (r && r.url && r.charge) ? await turnChargeCodeTask(r.charge) : { ok:true };") && ce.includes("else if(!paid.ok){ say(paid.message); }"));
  assert.ok(ce.indexOf("turnChargeCodeTask(r.charge)") < ce.indexOf("nbCommit("), "charged before it is saved");
  assert.ok(art.includes('if(!(r.meta.codeEdit && r.meta.codeEdit.kind==="resize-back")) r.charge = "resize";'), "back to the original size is free");
  assert.ok(!art.includes('charge:"head"') && art.includes('message:turnKeptSummary(r.meta), charge:"remaster",'));
  // a kept edit and the 4K detail: their image is already paid for, so the small charge never loses it
  assert.ok(art.includes('try{ await turnChargeCodeTask("keep"); }catch(e){}') && art.includes('try{ await turnChargeCodeTask("detail"); }catch(e){}'));
  // the switch: ON since the server that knows the task was deployed and answered a real call (2026-11-20)
  assert.ok(pricing.includes("const TURN_CODE_CHARGING = true;") && pricing.includes("it may only be on while the deployed server knows the"));
  // WHICH ARE CHARGED (owner the same day: "charging people for one credit if you think it's petty, we can push back … decide
  // … what tasks to charge users. So there's no complaints"): only where code replaces a paid image edit
  const C = { console, Math, String, localStorage: { getItem: () => null, setItem: () => {} } }; C.window = C;
  assert.ok(pricing.includes('const TURN_CODE_TASKS_CHARGED = ["remaster"];'), "the head edit left the app; its price stays in the tables, unused");
  assert.ok(ch.includes('if((window.TURN_CODE_TASKS_CHARGED||[]).indexOf(String(kind||""))<0) return { ok:true, credits:0 };'), "a free task is never sent to the server");
  assert.ok(ch.indexOf("TURN_CODE_TASKS_CHARGED") < ch.indexOf("sb.functions.invoke("));
  assert.ok(pricing.includes('if(TURN_CODE_TASKS_CHARGED.indexOf(String(kind||""))<0) return 0;'), "and shows no price");
  const fr = between(ai, 'APP_FEATURES.push({ name:"Credits: which changes made in code are free and which are charged (Characters, Props, Art Room)"', "function appBrief(){");
  for (const w of ["FREE: Resize to any size", "nothing more", "ONE HAS A SMALL PRICE", "Remaster, 6 credits; it also uses one reading", "a change that could not be made costs nothing"]) assert.ok(fr.includes(w), w);
});

await test("7 the planner's reads; Frances; the page loads the new files", () => {
  const pl = between(ai, "const EDIT_PLANNER_MODEL_ID = ", "window.EDIT_PLANNER_MODEL_ID");
  assert.ok(pl.includes("res = await aiVisionComplete(messages, images, { ...(opts||{}), modelId:EDIT_PLANNER_MODEL_ID });") && pl.includes("catch(e){ pinned = false; res = await aiVisionComplete(messages, images, opts||{}); }"),
    "an account that cannot use the planner is read on its own engine");
  assert.ok(pl.includes("const m = window.__lastWritingModel || null;") && pl.includes("by: m ? { id:m.id, label:m.label } : null"), "the record names who really looked");
  assert.ok(/WRITING_MODELS\.find\(x=>x\.id===EDIT_PLANNER_MODEL_ID\)/.test(pl), "its name comes from the engine list, not from a literal");
  const li = between(ai, "async function aiLocateItems(url, items){", "window.aiLocateItems = aiLocateItems;");
  assert.ok(li.includes("aiPlannerRead(") && li.includes("out.by = res.by || null;"));
  const lc = between(ai, "async function aiLocateChanges(baseUrl, url, asked){", "window.aiLocateChanges = aiLocateChanges;");
  assert.ok(lc.includes("IMAGE 1 is the ORIGINAL") && lc.includes("they were NOT asked for, ignore them") && lc.includes("Never guess a box.") && lc.includes("aiPlannerRead([{ role:\"user\", content:prompt }], [a, b]"));
  for (const f of [lc]) assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic|Fable|Gemini|GPT/.test(f.replace(/turnDownscaleDataUrl/g, "")), "nothing the reader is told names the codename or a vendor");
  const fr = between(ai, 'APP_FEATURES.push({ name:"Edits on a sheet are made in code: the image is kept and only the change goes in (Characters, Props, Art Room)"', "function appBrief(){");
  for (const w of ["Your image is kept as it is, pixel for pixel", "'Keep my image'", "'Use the engine's picture'", "Remaster \\u2014 bring the original back", "It makes no image",
    "'Changed in code'", "'New part drawn by'", "it cannot draw something new", "THE FRONT VIEW HAS NO HEAD, ON PURPOSE", "it never reports the missing head or neck", "RESIZE ('Resize' in the image's", "it does NOT add detail that was never drawn",
    "HOW A CHARACTER STANDS ON A NEW SHEET", "GOING SMALLER (downscaling)", "NOTHING IS LOST BY GOING DOWN AND UP AGAIN", "4K WITH ADDED DETAIL ('4K \\u2014 larger, with detail'", "THE PROP CARD IS LAID OUT LIKE THE CHARACTER CARD"]) assert.ok(fr.includes(w), w);
  assert.ok(!/\bTURN\b|McKee|Claude|Anthropic|Fable|Gemini|GPT/.test(fr));
  assert.ok(!ai.includes("clean re-render"), "the old name of Remaster is gone from what Frances is told");
  for (const file of ["artroom.jsx", "props.jsx", "ai.jsx", "pixel-keep.js"]) assert.ok(["20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1"].some((k) => html.includes(file + "?v=" + k + '"')), file + " has the new key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

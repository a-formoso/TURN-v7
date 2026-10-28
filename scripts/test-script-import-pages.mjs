#!/usr/bin/env node
/* test-script-import-pages.mjs — IMPORT A SCREENPLAY, phase 5 (owner 2026-10-18; docs/Script Import Plan.md §2):
   PDF and Word scripts, and scanned PDFs. app/script-import-pages.js's pure parts here; the real PDF through pdf.js in
   headless Chrome is test-script-import-pdf-browser.

     A  the layout reader on PDF text: a Final Draft-style US Letter page — the indents learned, every kind placed, wrapped
        lines joined, the furniture off (page numbers, the repeated header, (MORE), the carried (CONT'D), revision marks,
        margin scene numbers), the title page, dual dialogue, OMITTED, a line it had to guess marked and counted
     B  other layouts read the same: A4 with other margins, another app's indents, a dialogue-heavy script (the action
        margin from the headings), a transition, centered text
     C  Word (.docx), through ScriptImport.parseFile with a real zip: a screenplay template's styles (caps style, tracked
        deletions left out, a title page), indents typed by hand (tabs), a script typed flat; an old .doc refused
     D  a scanned PDF: the pages joined (a speech over the page break goes on, a title page only on page 1, code fences
        off), labelled as a transcription, [unreadable] counted; the price per page from the reading engine's rates
     E  the window and the app: the formats line, the scan step (priced first, Stop / Read the rest, Back), the sign-in /
        plan check before a paid read, the guessed-line chip, the vision call's engine choice, pdf.js self-hosted (its
        licence, .js names any server types right, loaded only on a PDF), the file loaded with a cache key, Frances

   node scripts/test-script-import-pages.mjs */
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView, URL, File };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/script-import.js"), box);
vm.runInContext(read("app/script-import-pages.js"), box);
vm.runInContext(read("app/script-read.js"), box);
const SI = box.ScriptImport, P = box.ScriptPages;
const pages = read("app/script-import-pages.js");
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

/* a page of positioned text: rows of [x, text] (x "R" = right-aligned to `right`), "" = a blank line */
function page(spec, o){
  o = o || {}; const CW = o.cw || 7.2, LH = o.lh || 12, right = o.right || 540;
  const items = []; let y = o.top || 82;
  spec.forEach(l => { if(l === ""){ y += LH; return; }
    l.forEach(([x, t]) => items.push({ str:t, x:x === "R" ? right - t.length * CW : x, y, w:t.length * CW, size:12 })); y += LH; });
  (o.extra || []).forEach(e => items.push({ str:e[2], x:e[0], y:e[1], w:e[2].length * CW, size:12 }));
  return { width:o.width || 612, height:o.height || 792, items };
}
const blocksOf = (r) => J(r.scenes).map(s => ({ h:s.heading, n:s.number, b:s.blocks.slice(1).map(b => b.type + (b.dual ? "^" : "") + (b.unsure ? "?" : "") + (b.centered ? "~" : "") + " " + b.text) }));
const read2 = (pages, opts) => { const lines = pages.flatMap((p, i) => P.pageLines(p, i)); return P.fromLayout(lines, opts || {}); };

const A = 108, D = 180, PR = 223.2, C = 266.4;
const TITLE = { width:612, height:792, items:[
  { str:"THE LAST BUS", x:263, y:300, w:86, size:12 }, { str:"Written by", x:270, y:336, w:72, size:12 },
  { str:"Ada Lovelace", x:263, y:360, w:86, size:12 }, { str:"Blue Draft 10/10/26", x:108, y:700, w:137, size:12 } ] };
const HDR = (n) => [[108, 40, "Blue Rev. 10/10/26"], [520, 40, n + "."]];
const FD = [TITLE,
  page([
    [[54, "1"], [A, "INT. KITCHEN - NIGHT"], [547, "1"]], "",
    [[A, "Maya pours coffee into two mugs. One stays full. She"]], [[A, "waits by the window."]], "",
    [[C, "MAYA"]], [[PR, "(quietly)"]], [[D, "He isn't coming. He never was the"]], [[D, "kind to come back."]], "",
    [[A, "The kettle clicks off."], [560, "*"]], "",
    [[D, "A radio, somewhere, plays."]], "",
    [[C, "MAYA (CONT'D)"]], [[D, "I'll go myself."]], [[C, "(MORE)"]],
  ], { extra:HDR(1).slice(0, 1) }),
  page([
    [[C, "MAYA (CONT'D)"]], [[D, "Tonight."]], "",
    [["R", "CUT TO:"]], "",
    [[54, "2"], [A, "EXT. STREET - DAY"], [547, "2"]], "",
    [[A, "Rain."]], "",
    [[160, "MAYA"], [380, "NURSE"]], [[130, "Wait!"], [340, "Go home."]], "",
    [[54, "3"], [A, "OMITTED"], [547, "3"]], "",
  ], { extra:HDR(2) }),
  page([[[54, "4"], [A, "INT. BUS - DAY"], [547, "4"]], "", [[A, "Maya sits at the back."]], "", [[A, "Her stop goes by and she"]]], { extra:HDR(3) }),
  page([[[A, "doesn't move."]], "", [[260, "THE END"]]], { extra:HDR(4) }),
];

await test("A  a Final Draft-style PDF: kinds, wraps, furniture, scene numbers, title page, dual, OMITTED", () => {
  const r = read2(FD);
  assert.deepEqual(J(r.layout), { base:108, dia:72, par:116, cue:158, lh:12 });
  assert.deepEqual(J(r.titlePage), { title:"THE LAST BUS", author:"Ada Lovelace", "draft date":"Blue Draft 10/10/26" });
  assert.deepEqual(blocksOf(r), [
    { h:"INT. KITCHEN - NIGHT", n:"1", b:["action Maya pours coffee into two mugs. One stays full. She waits by the window.",
      "char MAYA", "paren (quietly)", "dia He isn't coming. He never was the kind to come back.", "action The kettle clicks off.",
      "action? A radio, somewhere, plays.", "char MAYA (CONT'D)", "dia I'll go myself. Tonight.", "trans CUT TO:"] },
    { h:"EXT. STREET - DAY", n:"2", b:["action Rain.", "char MAYA", "dia Wait!", "char^ NURSE", "dia Go home."] },
    { h:"INT. BUS - DAY", n:"4", b:["action Maya sits at the back.", "action Her stop goes by and she doesn't move.", "action~ THE END"] },
  ]);
  assert.deepEqual(J(r.notes), [{ kind:"note", text:"Scene 3 omitted" }]);
  assert.ok(r.warnings.some(w => /^1 line was indented like dialogue/.test(w)), "the guessed line is counted");
  assert.ok(r.warnings.some(w => /revision marks \(\*\) on 1 line/.test(w)));
  assert.ok(r.warnings.some(w => /1 omitted scene/.test(w)));
  assert.ok(!r.warnings.some(w => /before the first scene heading/.test(w)), "the header is furniture, not an opening scene");
});

await test("A  the words in the file are the words in the scenes (furniture aside)", () => {
  const r = SI.finishParse({ ...read2(FD), source:"pdf" });
  const words = SI.wordsOf(r);
  for (const w of ["pours coffee", "never was the kind to come back", "I'll go myself. Tonight.", "Go home.", "she doesn't move"]) assert.ok(words.includes(w), w);
  for (const w of ["(MORE)", "Blue Rev", "*", " 2.", "OMITTED"]) assert.ok(!words.includes(w), "no " + w);
  assert.deepEqual(J(r.characters.map(c => c.cue)).sort(), ["MAYA", "NURSE"]);
  // a PDF knows its pages: the stats use them (the title page aside), not the word estimate
  assert.equal(SI.stats({ ...r, pagesExact:4 }).pages, 4);
  assert.match(pages, /out\.pagesExact = Math\.max\(1, pages\.length - empty - \(Object\.keys\(r\.titlePage \|\| \{\}\)\.length \? 1 : 0\)\);/);
  // signed out: a plain sentence before any page is rendered or charged
  assert.match(pages, /"Reading scanned pages runs on the studio\\u2019s server \\u2014 sign in first\."/);
});

await test("B  A4, other margins, another app's indents: the same script", () => {
  // A4 (595 x 842), action at 1.25", dialogue at 2.25", parenthetical 2.9", character 3.4" — learned from the file
  const a = 90, d = 162, pr = 209, c = 245;
  const pages = [page([
    [[a, "INT. KITCHEN - NIGHT"]], "", [[a, "Maya pours coffee."]], "",
    [[c, "MAYA"]], [[pr, "(quietly)"]], [[d, "He isn't coming."]], "",
    [[c, "NURSE"]], [[d, "Go home, love. There's nothing"]], [[d, "here for you tonight."]], "",
    [[a, "EXT. STREET - DAY"]], "", [[a, "Rain."]],
  ], { width:595, height:842, right:540 })];
  const r = read2(pages);
  assert.equal(r.layout.base, a);
  assert.deepEqual(blocksOf(r).map(s => s.b), [["action Maya pours coffee.", "char MAYA", "paren (quietly)", "dia He isn't coming.", "char NURSE", "dia Go home, love. There's nothing here for you tonight."], ["action Rain."]]);
});

await test("B  a dialogue-heavy script: the action margin comes from the headings, not the most common indent", () => {
  const rows = [[[A, "INT. CAR - NIGHT"]], ""];
  for (let i = 0; i < 6; i++) rows.push([[C, i % 2 ? "TOM" : "MAYA"]], [[D, "Line " + (i + 1) + "."]], [[D, "And more " + (i + 1) + "."]], "");
  rows.push([[A, "INT. HOUSE - NIGHT"]], "", [[A, "Quiet."]]);
  const r = read2([page(rows)]);
  assert.equal(r.layout.base, A);
  assert.equal(r.scenes.length, 2);
  assert.equal(r.scenes[0].blocks.filter(b => b.type === "dia").length, 6);
  assert.deepEqual(J(r.scenes[0].blocks[2]), { type:"dia", text:"Line 1. And more 1." });
  assert.ok(!r.scenes.some(s => s.blocks.some(b => b.unsure)));
});

await test("B  a page break inside an action paragraph joins it; a full stop doesn't", () => {
  const r = read2([page([[[A, "INT. A - DAY"]], "", [[A, "She runs for the door and"]]]), page([[[A, "slams it."]], "", [[A, "Silence."]]]),
    page([[[A, "INT. B - DAY"]], "", [[A, "Done."]]])]);
  assert.deepEqual(blocksOf(r)[0].b, ["action She runs for the door and slams it.", "action Silence."]);
});

/* ---- Word ---- */
const crc32 = (buf) => { let c, crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++){ c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; };
function zip(files){
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const docXml = ps => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps.join("")}<w:sectPr/></w:body></w:document>`;
const sp = (style, t) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const STYLES = `<w:styles>${[["SceneHeading", "Scene Heading"], ["Action", "Action"], ["Character", "Character", true], ["Dialogue", "Dialogue"], ["Parenthetical", "Parenthetical"], ["Transition", "Transition"], ["CharacterMore", "Char More", false, "Character"]]
  .map(([id, n, caps, based]) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${n}"/>${based ? `<w:basedOn w:val="${based}"/>` : ""}${caps ? "<w:rPr><w:caps/></w:rPr>" : ""}</w:style>`).join("")}</w:styles>`;
const docx = (paras, styles) => new box.File([zip({ "[Content_Types].xml":"<Types/>", "word/document.xml":docXml(paras), ...(styles ? { "word/styles.xml":styles } : {}) })], "script.docx");

await test("C  a Word screenplay template: the styles say what each paragraph is", async () => {
  const center = t => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const r = await SI.parseFile(docx([center("THE LAST BUS"), center("Written by"), `<w:p><w:pPr><w:jc w:val="center"/><w:sectPr/></w:pPr><w:r><w:t>Ada Lovelace</w:t></w:r></w:p>`,
    sp("SceneHeading", "INT. KITCHEN - NIGHT"), sp("Action", "Maya pours coffee."), sp("Character", "maya"), sp("Parenthetical", "(quietly)"), sp("Dialogue", "He isn't coming."),
    `<w:p><w:pPr><w:pStyle w:val="Action"/></w:pPr><w:r><w:t xml:space="preserve">Gone </w:t></w:r><w:del w:author="x"><w:r><w:delText>for good</w:delText></w:r></w:del><w:ins><w:r><w:t>now.</w:t></w:r></w:ins></w:p>`,
    sp("CharacterMore", "nurse"), sp("Dialogue", "Go home."), `<w:p/>`, sp("Transition", "CUT TO:"), sp("SceneHeading", "EXT. STREET - DAY"), sp("Action", "Rain.")], STYLES));
  assert.equal(r.source, "docx"); assert.equal(r.fileName, "script.docx");
  assert.equal(r.title, "THE LAST BUS"); assert.equal(r.author, "Ada Lovelace");
  assert.deepEqual(blocksOf(r), [
    { h:"INT. KITCHEN - NIGHT", n:"", b:["action Maya pours coffee.", "char MAYA", "paren (quietly)", "dia He isn't coming.", "action Gone now.", "char NURSE", "dia Go home.", "trans CUT TO:"] },
    { h:"EXT. STREET - DAY", n:"", b:["action Rain."] }]);
  assert.deepEqual(J(r.characters.map(c => c.cue)), ["MAYA", "NURSE"]);
});

await test("C  a Word script indented by hand (tabs): read by its indents", async () => {
  const tp = (tabs, t) => `<w:p><w:r>${"<w:tab/>".repeat(tabs)}<w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`, blank = "<w:p/>";
  const r = await SI.parseFile(docx([tp(0, "INT. KITCHEN - NIGHT"), blank, tp(0, "Maya pours coffee into two mugs. One stays full, the other goes cold on the sill."), blank,
    tp(4, "MAYA"), tp(3, "(quietly)"), tp(2, "He isn't coming."), blank, tp(0, "The kettle clicks off and the room is quiet again for a long moment."), blank,
    tp(4, "NURSE"), tp(2, "Go home."), tp(0, "She doesn't."), blank, tp(8, "CUT TO:"), blank, tp(0, "EXT. STREET - DAY"), blank, tp(0, "Rain on the windscreen, and the lights change twice before she moves.")]));
  assert.deepEqual(blocksOf(r).map(s => s.b), [
    ["action Maya pours coffee into two mugs. One stays full, the other goes cold on the sill.", "char MAYA", "paren (quietly)", "dia He isn't coming.",
     "action The kettle clicks off and the room is quiet again for a long moment.", "char NURSE", "dia Go home.", "action She doesn't.", "trans CUT TO:"],
    ["action Rain on the windscreen, and the lights change twice before she moves."]]);
});

await test("C  a Word script typed flat: Fountain's rules; an old .doc is refused in plain words", async () => {
  const fp = t => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const r = await SI.parseFile(docx(["INT. KITCHEN - NIGHT", "Maya pours coffee.", "MAYA", "(quietly)", "He isn't coming.", "The kettle clicks.", "EXT. STREET - DAY", "Rain."].map(fp)));
  assert.equal(r.source, "docx");
  assert.deepEqual(blocksOf(r).map(s => s.b), [["action Maya pours coffee.", "char MAYA", "paren (quietly)", "dia He isn't coming.", "action The kettle clicks."], ["action Rain."]]);
  await assert.rejects(SI.parseFile(new box.File(["x"], "old.doc")), /older Word file \(\.doc\).*\.docx/);
  await assert.rejects(SI.parseFile(new box.File([zip({ "a.txt":"x" })], "not.docx")), /doesn.t look like a Word document/);
});

await test("C  the file types: .pdf and .docx accepted; a PDF may be up to 40 MB, other files 8 MB", async () => {
  assert.equal(SI.kindOf("a.PDF"), "pdf"); assert.equal(SI.kindOf("a.docx"), "docx"); assert.equal(SI.kindOf("a.doc"), "");
  assert.match(SI.ACCEPT, /\.pdf/); assert.match(SI.ACCEPT, /\.docx/);
  const big = (n, name) => ({ name, size:n * 1024 * 1024, arrayBuffer:async () => new ArrayBuffer(0), text:async () => "" });
  await assert.rejects(SI.parseFile(big(41, "a.pdf")), /larger than 40 MB/);
  await assert.rejects(SI.parseFile(big(9, "a.fdx")), /larger than 8 MB/);
  await assert.rejects(SI.parseFile(big(9, "a.pdf")), (e) => !/larger than/.test(e.message));   // past the size check (no pdf.js in node)
});

await test("D  a scan's pages join: the carried speech goes on, a title page only on page 1, fences off", () => {
  const t = P.joinScanPages(["Title: The Last Bus\nAuthor: Ada Lovelace\n\nINT. KITCHEN - NIGHT\n\nMaya waits.\n\nMAYA\nHe isn't coming.",
    "```\nMAYA (CONT'D)\nHe never was.\n\nEXT. STREET - DAY\n```", "", "Title: The Last Bus\nDraft date: 2\n\nNURSE\nGo home."]);
  const r = P.fromScan(["Title: The Last Bus\nAuthor: Ada Lovelace\n\nINT. KITCHEN - NIGHT\n\nMaya waits.\n\nMAYA\nHe isn't coming.",
    "```\nMAYA (CONT'D)\nHe never was. [unreadable]\n\nEXT. STREET - DAY\n```"], "scan.pdf");
  assert.doesNotMatch(t, /```/);
  assert.equal((t.match(/Title:/g) || []).length, 1);
  assert.match(t, /He isn't coming\.\nHe never was\./);
  assert.equal(r.title, "The Last Bus"); assert.equal(r.author, "Ada Lovelace");
  assert.equal(r.source, "pdf-scan"); assert.equal(r.transcribed, true); assert.equal(r.fileName, "scan.pdf");
  assert.deepEqual(blocksOf(r)[0].b, ["action Maya waits.", "char MAYA", "dia He isn't coming. He never was. [unreadable]"]);
  assert.match(r.warnings[0], /transcription, not the file.s own text/);
  assert.ok(r.warnings.some(w => /^1 word couldn.t be read/.test(w)));
  // a NEW speaker at the top of the next page is a new speech
  assert.match(P.joinScanPages(["MAYA\nHi.", "TOM (CONT'D)\nNo."]), /Hi\.\n\nTOM/);
});

await test("D  the scan's price: per page from the reading engine's rates (an image is held at 4,800 tokens)", () => {
  const e = P.scanEstimate(10, "gemini-4-argon");
  // $2 / $10 per million: (5,200 x 2 + 350 x 10) / 1e6 = $0.0139 -> 2 credits; (5,400 x 2 + 1,400 x 10) / 1e6 = $0.0248 -> 3
  assert.deepEqual({ lo:e.lo, hi:e.hi, perPage:e.perPage, pages:e.pages }, { lo:20, hi:30, perPage:3, pages:10 });
  assert.equal(P.scanEstimate(0).lo, 0);
  assert.match(read("app/script-read.js"), /READ_ENGINE_USD, DEFAULT_ENGINE, ratesOf \}/);
  assert.match(read("supabase/functions/image-proxy/billing-pricing.mjs"), /export const IMAGE_INPUT_TOKENS = 4800;/);
  assert.match(P.SCAN_PROMPT, /word for word/i);
  assert.doesNotMatch(P.SCAN_PROMPT, /Claude|Anthropic|Gemini|OpenAI|GPT|McKee/i);
});

const ui = read("app/script-import-ui.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx");
await test("E  the window: the formats line, the scan step (priced first, Stop, Read the rest, Back), the guessed-line chip", () => {
  assert.match(ui, /"Fountain \(\.fountain\), Final Draft \(\.fdx\), Highland \(\.highland\), PDF, Word \(\.docx\) or plain text \(\.txt\)\."/);
  assert.doesNotMatch(ui, /coming next/);
  assert.match(ui, /if\(r && r\.scanned\)\{ setScan\(/);
  assert.match(ui, /"This PDF is a scan"/);
  assert.match(ui, /P\.scanEstimate\(scan\.pages, modelId\)/);
  assert.match(ui, /typeof beforeScanRead==="function" && !beforeScanRead\(\)/);
  assert.match(ui, /P\.readScan\(buf, \{ modelId, prior:scan\.texts, shouldStop:\(\)=>scanStop\.current/);
  assert.match(ui, /"Read the rest \\u2192"/);
  assert.match(ui, /"Stop"\)/);
  assert.match(ui, /reading its pages is charged as writing/);
  assert.match(ui, /React\.useEffect\(\(\)=>\(\)=>\{ scanStop\.current = true; \},\[\]\)/, "closing the window stops the read");
  assert.match(ui, /className:"si-check"/);
  assert.match(ui, /pdf:"PDF", docx:"Word", "pdf-scan":/);
  assert.match(read("app/styles.css"), /\.si-scan-bar i\{/);
});

await test("E  the app: a scan read needs sign-in and a plan, as the script read does", () => {
  const i = app.indexOf("beforeScanRead:()=>{");
  assert.ok(i > 0);
  const f = app.slice(i, i + 500);
  assert.match(f, /aiAvailable\(\)/); assert.match(f, /requirePlan\("read a scanned script"\)/);
});

await test("E  the vision call takes the reading engine (opts.modelId) and a token cap", () => {
  assert.match(ai, /async function aiVisionComplete\(messages, images, opts\)\{\n  opts = opts \|\| \{\};/);
  assert.match(ai, /const asked = opts\.modelId \? WRITING_MODELS\.find\(x=>x\.id===opts\.modelId\) : null;/);
  assert.match(ai, /forced \|\| asked \|\| WRITING_MODELS\.find/);
  assert.match(ai, /\.\.\.\(opts\.maxTokens \? \{ maxTokens:opts\.maxTokens \} : \{\}\)/);
});

await test("E  pdf.js is self-hosted, licensed, served as .js and loaded only when a PDF is opened", () => {
  const dir = "app/vendor/pdfjs/v4.10.38/";
  for (const f of ["pdf.min.js", "pdf.worker.min.js", "LICENSE.txt"]) assert.ok(existsSync(new URL(dir + f, ROOT)), f);
  assert.ok(statSync(new URL(dir + "pdf.worker.min.js", ROOT)).size > 1e6);
  assert.match(read(dir + "LICENSE.txt"), /Apache License/);
  assert.match(read(dir + "pdf.min.js"), /Mozilla Foundation/);
  assert.match(pages, /const PDFJS_DIR = "app\/vendor\/pdfjs\/v4\.10\.38\/";/);
  assert.match(pages, /import\(at\("pdf\.min\.js"\)\)/);
  assert.match(pages, /isEvalSupported:false/);
  const html = read("TURN.html");
  assert.doesNotMatch(html, /pdf\.min\.js/, "not loaded with the app");
  assert.ok(["20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k => html.includes('app/script-import-pages.js?v=' + k + '"')));
  assert.ok(html.indexOf("app/script-import.js?v=") < html.indexOf("app/script-import-pages.js?v="), "after script-import.js");
  assert.match(read("serve.js"), /urlPath\.startsWith\("\/app\/vendor\/"\)/);
});

await test("E  Frances knows: PDF and Word read on the device, a scan read as paid page images (no app names)", () => {
  const k = ai.indexOf("Import a screenplay (bring your own script)");
  const line = ai.slice(k, ai.indexOf("\n", k));
  assert.match(line, /PDF/); assert.match(line, /Word \(\.docx\)/); assert.match(line, /scanned PDF/i);
  assert.doesNotMatch(line, /PDF and Word are coming next/);
  assert.doesNotMatch(line, /Final Draft|Highland|WriterDuet|Celtx|Fade In/);
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

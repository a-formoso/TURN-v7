/* script-import-pages.js — IMPORT A SCREENPLAY, phase 5 (owner 2026-10-18; docs/Script Import Plan.md §2):
   PDF scripts, Word (.docx) scripts, and scanned PDFs.

   A PDF or a Word file doesn't say which line is a scene heading, a character or dialogue — a screenplay's structure is
   in its LAYOUT. THE LAYOUT READER rebuilds it the way a reader's eye does: the action margin, the dialogue indent, the
   parenthetical indent and the character indent are learned from the file itself (the common writing apps all set
   them a little differently), then each line is placed by its indent and its capitals; lines that wrap are joined;
   page furniture (page numbers, (MORE), CONTINUED, the repeated header, revision asterisks, scene numbers in the
   margins) is lifted off, never read as words; a line it had to guess is marked and counted in a warning.
   The words are still the file's words — only their kind is inferred.

   • PDF (a text layer): pdf.js, self-hosted under app/vendor/pdfjs/ and loaded only when a PDF is opened (the file
     never leaves the device). A PDF with (almost) no text is a SCAN: parsePdf says so, and readScan reads its pages
     with the vision model, page by page — paid as writing, priced first (scanEstimate), and labelled as a
     transcription of the page images.
   • Word (.docx): a zip of XML read with ScriptImport.unzip — the paragraph styles first (a screenplay template's
     "Scene Heading", "Character", "Dialogue"…), else the indents (as a PDF), else the text as typed (Fountain's
     rules: a script typed in a plain document).
   • An old Word file (.doc) is refused with a plain sentence: save it as .docx or PDF.

   window.ScriptPages = { parsePdf, parseDocx, readScan, scanEstimate, pdfText, pageLines, fromLayout, parseDocxXml,
     joinScanPages, SCAN_PROMPT } */
(function(root){
  "use strict";

  const SI = () => root.ScriptImport;
  const clean = v => String(v == null ? "" : v).replace(/\u00a0/g, " ");
  const squash = v => clean(v).replace(/\s+/g, " ").trim();
  const PDFJS_DIR = "app/vendor/pdfjs/v4.10.38/";
  // the furniture the writing apps print on a page — never the writer's words
  const MORE = /^\(?\s*MORE\s*\)?$/i;
  const CONTINUED = /^(?:[A-Z]?\d{1,4}[A-Z]{0,3}\.?\s+)?\(?\s*CONT(?:INUED|['’]?D)\s*\)?\s*:?\s*(?:\(\s*\d+\s*\))?(?:\s+[A-Z]?\d{1,4}[A-Z]{0,3}\.?)?$/i;
  const PAGE_NO = /^(?:page\s+)?[-–—]?\s*\d{1,3}\s*[-–—]?\.?$|^\d{1,3}\s*(?:of|\/)\s*\d{1,3}$/i;
  const SCENE_NO = /^[A-Z]{0,2}\d{1,4}[A-Z]{0,3}\.?$/;
  const REV_MARK = /^\*{1,3}$/;
  const OMITTED = /^OMIT(?:TED)?$/i;
  const BY_LINE = /^(?:written\s+|screenplay\s+|teleplay\s+|story\s+|an?\s+(?:original\s+)?screenplay\s+)?by\b/i;
  const DATE_LINE = /\b(?:draft|revis(?:ed|ion)|rev\.)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i;

  function mode(values, step){
    const by = new Map(); let best = null, n = 0;
    values.forEach(v => { if(!isFinite(v)) return; const k = Math.round(v / (step || 1)) * (step || 1); const c = (by.get(k) || 0) + 1; by.set(k, c); if(c > n || (c === n && k < best)){ n = c; best = k; } });
    return best;
  }
  const isUpper = t => { const s = String(t || "").replace(/\([^)]*\)/g, ""); return /\p{L}/u.test(s) && s === s.toUpperCase(); };

  /* ---------- 1. PDF text items → lines of segments (pure) ----------
     page = { width, height, items:[{ str, x, y (baseline, from the top), w, size }] }. Items on one baseline make a
     line; a wide gap inside a line starts a new SEGMENT (a scene number in the margin, a revision asterisk, the second
     column of dual dialogue). */
  function pageLines(page, pageIndex){
    const items = (page.items || []).filter(it => it && typeof it.str === "string" && it.str.trim())
      .map(it => ({ str:clean(it.str), x:+it.x || 0, y:+it.y || 0, w:Math.max(0, +it.w || 0), size:+it.size || 12 }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    items.forEach(it => {
      const r = rows.length ? rows[rows.length - 1] : null;
      if(r && Math.abs(it.y - r.y) <= Math.max(1.5, it.size * 0.35)) r.items.push(it);
      else rows.push({ y:it.y, size:it.size, items:[it] });
    });
    return rows.map(r => {
      const its = r.items.sort((a, b) => a.x - b.x);
      const segs = [];
      its.forEach(it => {
        const cw = it.w && it.str.length ? it.w / it.str.length : it.size * 0.6;
        const s = segs[segs.length - 1];
        const end = s ? s.xEnd : 0;
        const gap = s ? it.x - end : 0;
        if(!s || gap > Math.max(cw, s.cw) * 3.2){ segs.push({ x:it.x, xEnd:it.x + it.w, text:it.str, cw }); return; }
        const needSpace = gap > Math.max(cw, s.cw) * 0.25 && !/\s$/.test(s.text) && !/^\s/.test(it.str);
        s.text += (needSpace ? " " : "") + it.str;
        s.xEnd = Math.max(s.xEnd, it.x + it.w);
      });
      segs.forEach(s => { s.text = squash(s.text); });
      return { page:pageIndex, y:r.y, size:r.size, segs:segs.filter(s => s.text), pageWidth:page.width, pageHeight:page.height };
    }).filter(l => l.segs.length);
  }

  /* ---------- 2. the title page (PDF page 1 / the Word paragraphs before the first page break) ---------- */
  function readTitleLines(texts){
    const lines = texts.map(squash).filter(Boolean);
    const tp = {};
    const by = lines.findIndex(l => BY_LINE.test(l));
    const title = lines.find((l, i) => i !== by && !BY_LINE.test(l) && !DATE_LINE.test(l) && !/@|\bwww\.|\+?\d[\d ()-]{7,}/.test(l));
    if(title) tp.title = title.replace(/^["“]|["”]$/g, "");
    if(by >= 0){ const rest = lines[by].replace(BY_LINE, "").trim(); tp.author = rest || lines[by + 1] || ""; }
    const dd = lines.find(l => DATE_LINE.test(l) && l !== tp.title && l !== tp.author);
    if(dd) tp["draft date"] = dd;
    return tp;
  }

  /* ---------- 3. THE LAYOUT READER (pure): lines with indents → scenes of screenplay blocks ----------
     lines: [{ page, y, size, segs:[{ x, xEnd, text }], pageWidth, pageHeight }] (a PDF), or Word paragraphs as one-
     segment lines with { para:true, gapBefore, align }. */
  function fromLayout(input, opts){
    opts = opts || {};
    const isCueLine = SI().isCueLine, isTransitionLine = SI().isTransitionLine, HEADING = SI().HEADING, cueName = SI().cueName;
    const para = !!opts.paragraphs;   // Word: every line is a whole paragraph (nothing wraps)
    const warnings = [], notes = [];
    let lines = (input || []).map(l => ({ ...l, segs:(l.segs || []).map(s => ({ ...s })) }));
    const pages = Array.from(new Set(lines.map(l => l.page))).sort((a, b) => a - b);

    // a. page furniture: the repeated header / footer, page numbers, (MORE), CONTINUED, revision marks
    const pageMore = {};
    let revised = 0;
    if(!para){
      const band = l => { const H = l.pageHeight || 792; return l.y < H * 0.1 ? "top" : l.y > H * 0.92 ? "bottom" : ""; };
      const keyOf = l => squash(l.segs.map(s => s.text).join(" ")).replace(/\d+/g, "#").toLowerCase();
      // a page number sharing the header's line comes off first, so the header reads the same on every page
      lines.forEach(l => { if(band(l) && l.segs.length > 1) l.segs = l.segs.filter(sg => !PAGE_NO.test(sg.text)); });
      const seen = new Map();
      lines.forEach(l => { if(!band(l)) return; const k = band(l) + "|" + keyOf(l); if(!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(l.page); });
      const repeated = new Set(Array.from(seen.entries()).filter(([, ps]) => pages.length >= 3 && ps.size >= Math.max(2, Math.ceil(pages.length * 0.4))).map(([k]) => k));
      lines = lines.filter(l => {
        const text = squash(l.segs.map(s => s.text).join(" "));
        const b = band(l);
        if(b && repeated.has(b + "|" + keyOf(l))) return false;
        if(PAGE_NO.test(text) && (b || l.segs[0].x > (l.pageWidth || 612) * 0.7)) return false;
        if(MORE.test(text)){ pageMore[l.page] = true; return false; }
        if(CONTINUED.test(text)) return false;
        return true;
      });
      lines.forEach(l => {
        // a revision asterisk in the right margin; a scene number on either side of a heading
        while(l.segs.length > 1 && REV_MARK.test(l.segs[l.segs.length - 1].text)){ l.segs.pop(); l.revised = true; revised++; }
        if(l.segs.length > 1 && SCENE_NO.test(l.segs[0].text) && (HEADING.test(l.segs[1].text + " ") || OMITTED.test(l.segs[1].text))){
          l.number = l.segs.shift().text.replace(/\.$/, ""); }
        if(l.number && l.segs.length > 1 && l.segs[l.segs.length - 1].text.replace(/\.$/, "") === l.number) l.segs.pop();
        if(!l.number && l.segs.length === 2 && SCENE_NO.test(l.segs[1].text) && HEADING.test(l.segs[0].text + " ")) l.number = l.segs.pop().text.replace(/\.$/, "");
      });
    }

    // b. the title page: the first page when it has no scene heading and the script goes on after it
    let titlePage = {};
    const textOf = l => squash(l.segs.map(s => s.text).join(" "));
    const firstPage = pages[0];
    const firstHeadingAt = lines.findIndex(l => HEADING.test(textOf(l) + " "));
    if(pages.length > 1 && firstHeadingAt >= 0 && lines[firstHeadingAt].page !== firstPage){
      const tl = lines.filter(l => l.page === firstPage);
      if(tl.length <= 40 && (tl.some(l => BY_LINE.test(textOf(l))) || tl.length <= 14)){
        titlePage = readTitleLines(tl.map(textOf));
        lines = lines.filter(l => l.page !== firstPage);
      }
    } else if(para && firstHeadingAt > 0 && firstHeadingAt <= 30 && lines.slice(0, firstHeadingAt).some(l => BY_LINE.test(textOf(l)))){
      titlePage = readTitleLines(lines.slice(0, firstHeadingAt).map(textOf));
      lines = lines.slice(firstHeadingAt);
    }

    // c. learn the indents from the file
    const rows = lines.map(l => ({ ...l, x:l.segs[0].x, xEnd:l.segs[l.segs.length - 1].xEnd, text:textOf(l) }));
    // the action margin: where the scene headings sit; else where the long lines start; else the leftmost common indent
    const headX = rows.filter(r => HEADING.test(r.text + " ")).map(r => r.x);
    const longX = rows.filter(r => r.text.length >= (para ? 60 : 40) && r.segs.length === 1).map(r => r.x);
    const xs = rows.map(r => Math.round(r.x));
    const common = Array.from(new Set(xs)).filter(v => xs.filter(x => Math.abs(x - v) <= 1).length >= Math.max(2, rows.length * 0.05)).sort((x, y) => x - y);
    const base = (headX.length >= 2 ? mode(headX, 1) : longX.length >= 3 ? mode(longX, 1) : (common[0] != null ? common[0] : mode(xs, 1))) || 0;
    rows.forEach(r => { r.dx = r.x - base; });
    const lhs = [];
    for(let i = 1; i < rows.length; i++) if(rows[i].page === rows[i - 1].page){ const d = rows[i].y - rows[i - 1].y; if(d > 0) lhs.push(d); }
    // the line height: the SMALLEST gap that keeps coming back (a blank line is two of them)
    const lhCount = new Map(); lhs.forEach(d => { const k = Math.round(d * 2) / 2; lhCount.set(k, (lhCount.get(k) || 0) + 1); });
    const lhFreq = Array.from(lhCount.entries()).filter(([k, c]) => k >= 4 && c >= Math.max(2, lhs.length * 0.05)).map(([k]) => k).sort((x, y) => x - y);
    const fsz = mode(rows.map(r => r.size || 12), 0.5) || 12;
    let lh = para ? 1 : (lhFreq[0] || fsz);
    if(!para && lh > fsz * 1.6) lh = lh / 2;   // only blank-separated lines seen: that gap is two lines
    const nextOf = i => rows[i + 1] && rows[i + 1].page === rows[i].page ? rows[i + 1] : null;
    const tight = (a, b) => !!b && (para ? !b.gapBefore : (b.y - a.y) <= lh * 1.6);
    const cueIdx = rows.map((r, i) => i).filter(i => { const r = rows[i], n = nextOf(i);
      return r.segs.length === 1 && isCueLine(r.text) && !HEADING.test(r.text + " ") && r.dx >= 40 && tight(r, n) && n.dx > 12 && n.dx < r.dx - 12; });
    const cue = mode(cueIdx.map(i => rows[i].dx), 2) || 158;
    const dia = mode(cueIdx.map(i => nextOf(i)).filter(n => n && !/^\(/.test(n.text)).map(n => n.dx), 2) || Math.round(cue * 0.46);
    const par = mode(cueIdx.map(i => nextOf(i)).filter(n => n && /^\(/.test(n.text)).map(n => n.dx), 2) || Math.round((dia + cue) / 2 - 8);
    const right = mode(rows.filter(r => r.text.length >= 40).map(r => r.xEnd), 4) || (base + 432);
    const cueMin = Math.min(cue - 24, (Math.max(par, dia) + cue) / 2);
    const inDiaZone = dx => dx >= dia - 22 && dx < cueMin;

    // d. place every line
    const scenes = [], pre = [];
    let cur = null, mode_ = "", last = null, lastSpeaker = "", unsure = 0, parenOpen = false, omitted = 0;
    const push = (b) => { (cur ? cur.blocks : pre).push(b); last = b; return b; };
    const addText = (b, t) => { b.text = squash(b.text + " " + t); };
    const speechAt = (i) => { const r = rows[i], n = nextOf(i); return tight(r, n) && n.segs.length === 1 && (inDiaZone(n.dx) || /^\(/.test(n.text)); };
    for(let i = 0; i < rows.length; i++){
      const r = rows[i], p = rows[i - 1];
      const pageBreak = !!p && p.page !== r.page;
      const newPara = !p || pageBreak || para || (r.y - p.y) > lh * 1.55;   // Word: a paragraph is always its own
      const blank = !p || (para ? !!r.gapBefore : (!pageBreak && (r.y - p.y) > lh * 1.55));
      const t = r.text;
      const centered = !para && r.dx > 40 && Math.abs((r.x - base) - (right - r.xEnd)) < Math.max(18, (right - base) * 0.06) && r.text.length < 60;
      // a scene heading (an OMITTED scene is a note, not a scene)
      if(r.segs.length === 1 && r.dx < Math.max(24, dia * 0.5) && (HEADING.test(t + " ") || (r.number && OMITTED.test(t)))){
        if(OMITTED.test(t)){ omitted++; notes.push({ kind:"note", text:"Scene " + (r.number || "") + " omitted" }); mode_ = ""; last = null; continue; }
        cur = { heading:t, number:r.number || "", blocks:[{ type:"scene", text:t }], notes:[] };
        scenes.push(cur); mode_ = ""; last = null; parenOpen = false; continue;
      }
      if(r.number && OMITTED.test(t)){ omitted++; notes.push({ kind:"note", text:"Scene " + r.number + " omitted" }); continue; }
      // dual dialogue: two cues side by side, then two columns until the speech ends
      if(r.segs.length === 2 && isCueLine(r.segs[0].text) && isCueLine(r.segs[1].text)){
        const split = r.segs[1].x - 0.45 * (r.segs[1].x - r.segs[0].x);
        const left = [r.segs[0].text], rightCol = [r.segs[1].text];
        let k = i + 1;
        while(k < rows.length && rows[k].page === r.page && tight(rows[k - 1], rows[k]) && !HEADING.test(rows[k].text + " ")){
          rows[k].segs.forEach(s => (s.x < split ? left : rightCol).push(s.text)); k++; }
        const speech = (col, dual) => { col.forEach((txt, j) => {
          if(j === 0){ push({ type:"char", text:txt, ...(dual ? { dual:true } : {}) }); return; }
          if(/^\(/.test(txt) || (last.type === "paren" && !/\)\s*$/.test(last.text))){ if(last.type === "paren" && !/\)\s*$/.test(last.text)) addText(last, txt); else push({ type:"paren", text:txt }); return; }
          if(last.type === "dia") addText(last, txt); else push({ type:"dia", text:txt }); }); };
        speech(left, false); speech(rightCol, true);
        lastSpeaker = cueName(rightCol[0]); mode_ = ""; i = k - 1; continue;
      }
      // a speech carried over a page break: the repeated "NAME (CONT'D)" at the top of the next page is the app's,
      // not the writer's — the speech just goes on
      if(pageBreak && last && (last.type === "dia" || last.type === "paren") && isCueLine(t) && /\bCONT/i.test(t) && cueName(t).toUpperCase() === lastSpeaker.toUpperCase()){
        mode_ = "dia"; continue; }
      // a transition
      if(r.segs.length === 1 && (isTransitionLine(t) || (r.align === "right" && isUpper(t)) || (isUpper(t) && /:$/.test(t) && r.dx > cue + 36) || (!para && isUpper(t) && r.dx > cue + 48 && r.xEnd >= right - 12 && t.length < 30))){
        push({ type:"trans", text:t }); mode_ = ""; continue; }
      // a character cue
      if(r.segs.length === 1 && isCueLine(t) && r.dx >= cueMin - 10 && r.dx <= cue + 90 && speechAt(i)){
        push({ type:"char", text:t }); lastSpeaker = cueName(t); mode_ = "dia"; parenOpen = false; continue; }
      // inside a speech: parentheticals and dialogue (a blank line ends it — or, across a page, (MORE) carries it on)
      const carried = pageBreak && pageMore[p.page];
      if(mode_ === "dia" && (!blank || carried) && r.dx >= dia - 22){
        if(/^\(/.test(t) || (parenOpen && last && last.type === "paren")){
          if(parenOpen && last && last.type === "paren") addText(last, t); else push({ type:"paren", text:t });
          parenOpen = !/\)\s*$/.test(last.text); continue; }
        if(inDiaZone(r.dx)){
          if(last && last.type === "dia" && (!para || !blank)) addText(last, t); else push({ type:"dia", text:t });
          parenOpen = false; continue; }
      }
      mode_ = ""; parenOpen = false;
      // action (what's left) — a wrapped line joins its paragraph, also over a page break mid-sentence
      const midSentence = pageBreak && last && last.type === "action" && !/[.!?:;"”’)\]]$/.test(last.text) && Math.abs(r.dx) < 24;
      if(!para && last && last.type === "action" && !last.centered && !centered && ((!newPara && Math.abs(r.dx - (last.dx || 0)) < 24) || midSentence)){ addText(last, t); continue; }
      const odd = !centered && r.dx >= dia - 22 && r.align !== "center";
      if(odd) unsure++;
      const b = push({ type:"action", text:t, ...((centered || r.align === "center") ? { centered:true } : {}), ...(odd ? { unsure:true } : {}) });
      Object.defineProperty(b, "dx", { value:r.dx, enumerable:false, writable:true });
    }
    if(unsure) warnings.push(unsure + " line" + (unsure !== 1 ? "s were" : " was") + " indented like dialogue with no character name over " + (unsure !== 1 ? "them" : "it") + " \u2014 brought in as action. Check " + (unsure !== 1 ? "them" : "it") + " in the scenes below.");
    if(revised) warnings.push("This draft has revision marks (*) on " + revised + " line" + (revised !== 1 ? "s" : "") + " \u2014 the marks were left out, the words kept.");
    if(omitted) warnings.push(omitted + " omitted scene" + (omitted !== 1 ? "s are" : " is") + " kept as a note, not as a scene.");
    if(pre.length){
      warnings.push(pre.length + " line" + (pre.length !== 1 ? "s come" : " comes") + " before the first scene heading \u2014 kept as an opening scene.");
      scenes.unshift({ heading:"", number:"", blocks:pre, notes:[], opening:true });
    }
    return { titlePage, scenes, notes, warnings, layout:{ base, dia, par, cue, lh } };
  }

  /* ---------- 4. PDF ---------- */
  let pdfjsP = null;
  function loadPdfjs(){
    if(!pdfjsP){
      const at = (f) => new URL(PDFJS_DIR + f, (root.document && root.document.baseURI) || root.location.href).href;
      pdfjsP = import(at("pdf.min.js")).then(m => { m.GlobalWorkerOptions.workerSrc = at("pdf.worker.min.js"); return m; })
        .catch(e => { pdfjsP = null; throw new Error("The PDF reader couldn\u2019t load \u2014 check your connection and try again."); });
    }
    return pdfjsP;
  }
  async function openPdf(buffer){
    const pdfjs = await loadPdfjs();
    const data = buffer instanceof Uint8Array ? buffer.slice() : new Uint8Array(buffer.slice(0));
    try{
      return await pdfjs.getDocument({ data, isEvalSupported:false, enableXfa:false, disableFontFace:true, useSystemFonts:false,
        stopAtErrors:false, verbosity:0 }).promise;
    }catch(e){
      if(e && /password/i.test(e.name || e.message || "")) throw new Error("This PDF is password-protected \u2014 remove the password (or export the script again without one), then import it.");
      throw new Error("This PDF couldn\u2019t be opened \u2014 it may be damaged. Export the script from your writing app again, or as Fountain or .fdx.");
    }
  }
  /* the text items of every page, positioned from the page's top-left (pdf.js's own reading of the text layer) */
  async function pdfText(buffer){
    const doc = await openPdf(buffer);
    const pages = [];
    for(let n = 1; n <= doc.numPages; n++){
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale:1 });
      const tc = await page.getTextContent();
      const items = [];
      (tc.items || []).forEach(it => {
        if(!it || typeof it.str !== "string" || !it.transform) return;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 12;
        items.push({ str:it.str, x, y, w:(it.width || 0) * vp.scale, size });
      });
      pages.push({ width:vp.width, height:vp.height, items });
      page.cleanup();
    }
    return { doc, pages };
  }
  async function parsePdf(buffer){
    const { doc, pages } = await pdfText(buffer);
    const chars = pages.map(p => p.items.reduce((s, it) => s + squash(it.str).length, 0));
    const empty = chars.filter(c => c < 40).length;
    // a SCAN: the pages are pictures — read them with the vision model (readScan), priced first
    if(!pages.length || empty > pages.length / 2){
      try{ doc.destroy(); }catch(e){}
      return { scanned:true, pageCount:pages.length, titlePage:{}, scenes:[], notes:[], warnings:[], characters:[], title:"", author:"", draftDate:"", source:"pdf-scan" };
    }
    const lines = pages.flatMap((p, i) => pageLines(p, i));
    const r = fromLayout(lines, {});
    try{ doc.destroy(); }catch(e){}
    if(empty) r.warnings.push(empty + " page" + (empty !== 1 ? "s have" : " has") + " no text (a scanned page?) and " + (empty !== 1 ? "were" : "was") + " skipped.");
    delete r.layout;
    const out = SI().finishParse({ ...r, source:"pdf" });
    out.pageCount = pages.length;
    out.pagesExact = Math.max(1, pages.length - empty - (Object.keys(r.titlePage || {}).length ? 1 : 0));
    return out;
  }

  /* ---------- 5. Word (.docx) ---------- */
  const xdecode = s => String(s || "").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const xattr = (tag, name) => { const m = new RegExp("\\bw:" + name + "\\s*=\\s*\"([^\"]*)\"").exec(tag || ""); return m ? m[1] : ""; };
  const onOff = (xml, el) => { const m = new RegExp("<w:" + el + "\\b([^>]*)/?>").exec(xml || ""); if(!m) return null; const v = xattr(m[0], "val"); return !(v === "false" || v === "0" || v === "off"); };
  function indOf(xml){
    const m = /<w:ind\b[^>]*\/?>/.exec(xml || ""); if(!m) return null;
    const n = k => { const v = xattr(m[0], k); return v === "" ? null : Number(v); };
    return { left:n("left") != null ? n("left") : n("start"), firstLine:n("firstLine"), hanging:n("hanging") };
  }
  const STYLE_KIND = [
    [/scene\s*head|slug\s*line|^slug|^heading\s*\(?scene/i, "scene"], [/parenthetical|^paren/i, "paren"], [/^character|^char\b|speaker|^cue$/i, "char"],
    [/dialog/i, "dia"], [/transition/i, "trans"], [/^action|description|^general$|^shot$/i, "action"],
  ];
  function readStyles(xml){
    const map = {};
    String(xml || "").replace(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g, (m, a, inner) => {
      const id = xattr("<x " + a, "styleId"); if(!id) return m;
      const name = xattr((/<w:name\b[^>]*\/?>/.exec(inner) || [""])[0], "val");
      const based = xattr((/<w:basedOn\b[^>]*\/?>/.exec(inner) || [""])[0], "val");
      const ppr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner) || [, ""])[1], rpr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner) || [, ""])[1];
      map[id] = { name, based, ind:indOf(ppr), jc:xattr((/<w:jc\b[^>]*\/?>/.exec(ppr) || [""])[0], "val"), caps:onOff(rpr, "caps") };
      return m;
    });
    const resolve = (id, seen) => { const s = map[id]; if(!s) return { name:"", ind:null, jc:"", caps:null };
      seen = seen || new Set(); if(seen.has(id) || !s.based) return s; seen.add(id);
      const b = resolve(s.based, seen);
      return { name:s.name, ind:s.ind || b.ind, jc:s.jc || b.jc, caps:s.caps != null ? s.caps : b.caps, baseName:b.name }; };
    return { resolve };
  }
  function kindOfStyle(name){ const n = squash(name); if(!n) return ""; const hit = STYLE_KIND.find(([re]) => re.test(n)); return hit ? hit[1] : ""; }
  /* document.xml (+ styles.xml) → the parsed script */
  function parseDocxXml(docXml, stylesXml){
    const st = readStyles(stylesXml);
    let body = String(docXml || "").replace(/<w:p(\s[^>]*)?\/>/g, "<w:p></w:p>");   // an empty paragraph written short
    body = body.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "").replace(/<w:moveFrom\b[\s\S]*?<\/w:moveFrom>/g, "")
      .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "").replace(/<w:delText\b[\s\S]*?<\/w:delText>/g, "")
      .replace(/<w:footnoteReference\b[^>]*\/>|<w:commentReference\b[^>]*\/>/g, "");
    const paras = [];
    let page = 0;
    body.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (m, inner) => {
      const ppr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(inner) || [, ""])[1];
      const sid = xattr((/<w:pStyle\b[^>]*\/?>/.exec(ppr) || [""])[0], "val");
      const s = st.resolve(sid);
      const ind = indOf(ppr) || s.ind || {};
      const jc = xattr((/<w:jc\b[^>]*\/?>/.exec(ppr) || [""])[0], "val") || s.jc || "";
      if(onOff(ppr, "pageBreakBefore")) page++;
      let text = "", lead = true, leadPt = 0;
      const runs = inner.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "");
      runs.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, (rm, rin) => {
        const rpr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(rin) || [, ""])[1];
        const caps = onOff(rpr, "caps") != null ? onOff(rpr, "caps") : !!s.caps;
        rin.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\s*\/>|<w:tab\b[^>]*\/>|<w:br\b([^>]*)\/>|<w:cr\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>|<w:lastRenderedPageBreak\b[^>]*\/>/g, (tm, t, br) => {
          if(/^<w:tab/.test(tm)){ if(lead) leadPt += 36; else text += "\t"; return tm; }
          if(/^<w:br/.test(tm)){ if(/w:type="page"/.test(br || "")) page++; else text += "\n"; return tm; }
          if(/^<w:cr/.test(tm)){ text += "\n"; return tm; }
          if(/^<w:noBreakHyphen/.test(tm)){ text += "-"; lead = false; return tm; }
          if(/^<w:lastRenderedPageBreak/.test(tm)) return tm;
          let w = xdecode(t || "");
          if(lead){ const sp = /^ */.exec(w)[0].length; leadPt += sp * 7.2; w = w.slice(sp); if(w) lead = false; }
          text += caps ? w.toUpperCase() : w;
          return tm;
        });
        return rm;
      });
      const twip = v => (Number(v) || 0) / 20;
      const x = twip(ind.left) + twip(ind.firstLine) - twip(ind.hanging) + leadPt;
      paras.push({ page, text:text.replace(/[ \t]+\n/g, "\n"), x, align:/^(?:center)$/.test(jc) ? "center" : /^(?:right|end)$/.test(jc) ? "right" : "", kind:kindOfStyle(s.name) || kindOfStyle(s.baseName) });
      if(/<w:sectPr\b/.test(ppr)) page++;   // a section break (a title page's usual end)
      return m;
    });
    const filled = paras.filter(p => squash(p.text));
    const hinted = filled.filter(p => p.kind).length;
    const xs = filled.map(p => Math.round(p.x / 6) * 6);
    const clusters = Array.from(new Set(xs)).filter(v => xs.filter(x => x === v).length >= Math.max(2, filled.length * 0.04));
    const warnings = [];
    let r;
    if(filled.length && hinted / filled.length >= 0.3){
      // A SCREENPLAY TEMPLATE: the paragraph styles say what each paragraph is
      const scenes = [], pre = []; let cur = null, unknown = 0, tp = {};
      const firstHead = filled.findIndex(p => p.kind === "scene" || SI().HEADING.test(squash(p.text) + " "));
      let list = filled;
      if(firstHead > 0 && list.slice(0, firstHead).some(p => BY_LINE.test(squash(p.text)))){ tp = readTitleLines(list.slice(0, firstHead).map(p => p.text)); list = list.slice(firstHead); }
      list.forEach(p => {
        const t = squash(p.text);
        let k = p.kind || (SI().HEADING.test(t + " ") ? "scene" : (unknown++, "action"));
        if(k === "scene"){ cur = { heading:t, number:"", blocks:[{ type:"scene", text:t }], notes:[] }; scenes.push(cur); return; }
        const b = { type:k, text:t, ...(p.align === "center" && k === "action" ? { centered:true } : {}) };
        (cur ? cur.blocks : pre).push(b);
      });
      if(unknown > filled.length * 0.2) warnings.push(unknown + " paragraph" + (unknown !== 1 ? "s have" : " has") + " no screenplay style and came in as action \u2014 check them.");
      if(pre.length){ warnings.push(pre.length + " line" + (pre.length !== 1 ? "s come" : " comes") + " before the first scene heading \u2014 kept as an opening scene.");
        scenes.unshift({ heading:"", number:"", blocks:pre, notes:[], opening:true }); }
      r = { titlePage:tp, scenes, notes:[], warnings };
    } else if(clusters.length >= 3){
      // INDENTED BY HAND: the layout reader, paragraph by paragraph
      let blank = false;
      const lines = [];
      paras.forEach(p => {
        const t = squash(p.text);
        if(!t){ blank = true; return; }
        lines.push({ page:p.page, y:lines.length, size:12, segs:[{ x:p.x, xEnd:p.x + t.length * 7.2, text:t }], gapBefore:blank, align:p.align, para:true });
        blank = false;
      });
      r = fromLayout(lines, { paragraphs:true });
      delete r.layout;
    } else {
      // TYPED AS TEXT: Fountain's rules (a blank line between elements; a name in capitals over its lines)
      const hasBlank = paras.some((p, i) => i > 0 && !squash(p.text));
      const out = [];
      paras.forEach((p, i) => {
        const t = clean(p.text).replace(/\t/g, " ").replace(/\s+$/g, "");
        out.push(p.align === "center" && squash(t) ? ">" + squash(t) + "<" : t);
        if(!hasBlank && squash(t)){
          const nx = paras[i + 1];
          const keep = SI().isCueLine(squash(t)) || /^\(.*\)$/.test(squash(t)) || (out.length > 1 && nx && /^\(.*\)$/.test(squash(nx.text)));
          if(!keep) out.push("");
        }
      });
      const f = SI().parseFountain(out.join("\n"));
      return { ...f, source:"docx" };
    }
    return SI().finishParse({ ...r, source:"docx" });
  }
  async function parseDocx(buffer){
    const z = await SI().unzip(buffer);
    const doc = z.names.find(n => /^word\/document\.xml$/i.test(n));
    if(!doc) throw new Error("This doesn\u2019t look like a Word document \u2014 save it as .docx (or PDF) and try again.");
    const styles = z.names.find(n => /^word\/styles\.xml$/i.test(n));
    return parseDocxXml(await z.read(doc), styles ? await z.read(styles) : "");
  }

  /* ---------- 6. A SCANNED PDF: the pages read with the vision model (paid as writing, page by page) ---------- */
  const SCAN_PROMPT = [
    "This image is one page of a screenplay. Transcribe it EXACTLY, word for word, as plain Fountain text.",
    "Rules:",
    "- Keep every word, spelling, capital and punctuation mark as printed. Do not correct, summarise, translate, reorder or add anything.",
    "- A scene heading (INT. / EXT. ...) goes on its own line. A scene number printed in the margin goes at the end of the heading as #12#.",
    "- A character name goes in capitals on its own line, with its dialogue on the very next lines (no blank line between them). A parenthetical like (quietly) goes on its own line inside the speech.",
    "- A transition (CUT TO:, DISSOLVE TO:) goes on its own line starting with \"> \".",
    "- Put one blank line between every other element.",
    "- Leave out page numbers, (MORE), (CONTINUED), CONTINUED:, revision asterisks and running headers or footers.",
    "- If this is the title page, write it as Fountain title-page lines: Title:, Credit:, Author:, Draft date:, Contact:.",
    "- If a word can't be read, write [unreadable] in its place.",
    "Reply with the transcription only: no commentary, no code fences.",
  ].join("\n");
  /* the pages' transcriptions → one Fountain text: a speech carried over a page break goes on (the repeated
     "NAME (CONT'D)" at the top of the next page is dropped), a title page counts only on page 1 */
  function joinScanPages(texts){
    const isCueLine = SI().isCueLine, cueName = SI().cueName;
    let out = "", lastSpeaker = "", inSpeech = false;
    (texts || []).forEach((raw, i) => {
      let t = clean(raw).replace(/\r\n?/g, "\n").replace(/^\s*```[a-z]*\s*\n?|\n?```\s*$/gi, "").replace(/^\s+|\s+$/g, "");
      if(!t) return;
      if(i > 0) t = t.replace(/^(?:(?:Title|Credit|Author|Authors|Draft date|Date|Contact|Source|Copyright|Notes):.*\n?)+/i, "").replace(/^\s+/, "");
      const lines = t.split("\n");
      let joinTight = false;
      if(i > 0 && inSpeech && lines.length && isCueLine(lines[0].trim()) && /\bCONT/i.test(lines[0]) && cueName(lines[0]).toUpperCase() === lastSpeaker.toUpperCase()){
        lines.shift(); joinTight = true; }
      t = lines.join("\n");
      out = out ? out + (joinTight ? "\n" : "\n\n") + t : t;
      // where this page leaves off: inside a speech?
      const ls = t.split("\n");
      inSpeech = false;
      for(let k = ls.length - 1; k >= 0; k--){
        const L = ls[k].trim();
        if(!L){ break; }
        if(isCueLine(L) && k < ls.length - 1){ inSpeech = true; lastSpeaker = cueName(L); break; }
      }
    });
    return out;
  }
  function scanEstimate(pageCount, modelId){
    const SR = root.ScriptRead;
    const id = modelId || (SR && SR.engineFor ? SR.engineFor() : "gemini-4-argon");
    const r = SR && SR.ratesOf ? SR.ratesOf(id) : { input:2, output:10 };
    const toCredits = usd => { const f = root.turnCreditsFromProviderUsd; const c = typeof f === "function" ? f(usd) : usd / 0.01; return Math.max(1, Math.ceil(c)); };
    // each page: the instructions + one page image (held at 4,800 input tokens on the server) in, the page's text out
    const lo = toCredits((5200 * r.input + 350 * r.output) / 1e6), hi = toCredits((5400 * r.input + 1400 * r.output) / 1e6);
    return { lo:lo * pageCount, hi:hi * pageCount, perPage:hi, pages:pageCount, modelId:id };
  }
  async function pageImage(doc, n){
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale:1 });
    const vp = page.getViewport({ scale:Math.min(3, 1500 / Math.max(1, vp1.width)) });
    const c = root.document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext:ctx, viewport:vp }).promise;
    page.cleanup();
    return c.toDataURL("image/jpeg", 0.82);
  }
  /* read the pages from `from` (0-based) on; onPage(i, n, text) after each; shouldStop() between pages.
     Returns { texts, done } — `texts` are the pages read so far (with the ones passed in `prior`). */
  async function readScan(buffer, opts){
    opts = opts || {};
    const vision = root.aiVisionComplete;
    const sb = typeof root.sbClient === "function" ? root.sbClient() : null;
    if(typeof vision !== "function" || !(sb && sb.functions)) throw new Error("Reading scanned pages runs on the studio\u2019s server \u2014 sign in first.");
    const doc = await openPdf(buffer);
    const texts = (opts.prior || []).slice();
    try{
      for(let n = texts.length + 1; n <= doc.numPages; n++){
        if(typeof opts.shouldStop === "function" && opts.shouldStop()) return { texts, done:false };
        const img = await pageImage(doc, n);
        const res = await vision([{ role:"user", content:SCAN_PROMPT + "\n\nThis is page " + n + " of " + doc.numPages + "." }], [img], { modelId:opts.modelId, maxTokens:3000 });
        if(!res || res.vision === false) throw new Error("The vision model couldn\u2019t see the page \u2014 try again in a moment.");
        texts.push(String(res.text || ""));
        if(typeof opts.onPage === "function") opts.onPage(n, doc.numPages, texts[texts.length - 1]);
      }
      return { texts, done:true };
    } finally { try{ doc.destroy(); }catch(e){} }
  }
  /* the transcribed pages → the parsed script (the preview treats it like any other) */
  function fromScan(texts, fileName){
    const r = SI().parseFountain(joinScanPages(texts));
    const unreadable = (joinScanPages(texts).match(/\[unreadable\]/g) || []).length;
    r.source = "pdf-scan"; r.transcribed = true; r.fileName = fileName || "";
    r.warnings.unshift("Read from the page images of a scanned PDF \u2014 a transcription, not the file\u2019s own text. Check the words before you import.");
    if(unreadable) r.warnings.push(unreadable + " word" + (unreadable !== 1 ? "s" : "") + " couldn\u2019t be read \u2014 they show as [unreadable] in the script.");
    return r;
  }

  root.ScriptPages = { parsePdf, parseDocx, readScan, fromScan, scanEstimate, pdfText, pageLines, fromLayout, parseDocxXml,
    readTitleLines, joinScanPages, SCAN_PROMPT, PDFJS_DIR };
})(typeof window !== "undefined" ? window : globalThis);

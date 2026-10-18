/* script-import.js — BRING YOUR OWN SCRIPT, phase 1 (owner 2026-10-18; docs/Script Import Plan.md).
   Reads a screenplay file in the browser — Fountain (.fountain/.spmd), Final Draft (.fdx), Highland (.highland,
   a zip holding Fountain text), plain text and pasted text — into scenes of screenplay blocks, WORD FOR WORD.
   No model is called and nothing leaves the browser here: this is the free part (parse → preview → fix).

   THE RULE: the words in the app are the words in the file. Formatting marks (Fountain's *bold*, forced-element
   prefixes, scene numbers) are not words and are lifted off; notes and boneyard text are kept aside as notes,
   never read as lines. Merging characters records ALIASES — the cues in the script are never renamed.

   window.ScriptImport = { parseFile, parseText, parseFountain, parseFdx, unzip, mergeScenes, splitScene,
     mergeCharacters, characterSuggestions, stats, suggestFormat, toFilm } */
(function(root){
  "use strict";

  /* ---------- shared helpers ---------- */
  const clean = v => String(v == null ? "" : v).replace(/\u00a0/g, " ");
  const squash = v => clean(v).replace(/\s+/g, " ").trim();
  const norm = v => squash(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const idOf = v => squash(v).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  const titleCase = s => squash(s).toLowerCase().replace(/(^|[\s\-'’(\/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const HEADING = /^(?:INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E|E\s*\/\s*I)[.\s]/i;
  const EXTENSION = /\s*\((?:V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|CONT['’]?D|CONT\.?|CONTINUED|PRE[- ]?LAP|FILTERED|ON (?:THE )?(?:PHONE|RADIO|TV|SCREEN)|SUBTITLED?|[^()]{1,24})\)\s*/gi;
  const REMOTE = /\((?:V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|PRE[- ]?LAP|ON (?:THE )?(?:PHONE|RADIO|TV|SCREEN)|FILTERED)\)/i;
  // Fountain emphasis (*italic*, **bold**, _underline_) is formatting, not words: the marks go, the words stay
  const unmark = s => clean(s)
    .replace(/\\\*/g, "\u0000AST\u0000").replace(/\\_/g, "\u0000US\u0000")
    .replace(/\*{1,3}(?=\S)([^*]*?\S)\*{1,3}/g, "$1")
    .replace(/(^|[\s(])_(?=\S)([^_]*?\S)_(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/\u0000AST\u0000/g, "*").replace(/\u0000US\u0000/g, "_");

  /* a character cue's NAME: the cue minus its extension ((V.O.), (CONT'D)…), dual mark and forcing @ */
  function cueName(cue){
    return squash(clean(cue).replace(/^@/, "").replace(/\^\s*$/, "").replace(EXTENSION, " "));
  }
  function isCueLine(t){
    const s = clean(t).trim();
    if(!s || s.length > 48) return false;
    if(s.charAt(0) === "@") return true;
    const name = s.replace(/\^\s*$/, "").replace(/\([^)]*\)/g, "").trim();
    if(!name || !/\p{L}/u.test(name)) return false;
    if(name !== name.toUpperCase()) return false;            // the name part must be in capitals
    if(/[.!?:;,]$/.test(name)) return false;                  // "BANG!" / "CUT TO:" are not speakers
    if(HEADING.test(name + " ")) return false;
    return true;
  }
  const isTransitionLine = t => { const s = clean(t).trim();
    return (s.charAt(0) === ">" && s.slice(-1) !== "<") || (/^[^a-z]*\bTO:$/.test(s) && s === s.toUpperCase())
      || /^(?:FADE (?:OUT|IN|TO BLACK)|CUT TO BLACK|SMASH CUT|MATCH CUT|DISSOLVE)[^a-z]*[.:]?$/.test(s); };

  /* ---------- Fountain (also plain text and paste: Fountain is designed to read a typed screenplay) ---------- */
  function parseFountain(text){
    let src = clean(text).replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
    const notes = [], warnings = [];
    // boneyard /* … */ is hidden text: kept as a note, never as script
    src = src.replace(/\/\*([\s\S]*?)\*\//g, (m, inner) => { if(squash(inner)) notes.push({ kind:"boneyard", text:squash(inner) }); return ""; });
    // [[notes]] may span lines; they ride along as notes of the scene they sit in
    const NOTE = "\u0000N";
    const noteTexts = [];
    src = src.replace(/\[\[([\s\S]*?)\]\]/g, (m, inner) => { noteTexts.push(squash(inner)); return NOTE + (noteTexts.length - 1) + "\u0000"; });
    let lines = src.split("\n");

    // the title page: "Key: value" lines at the very top, ended by the first blank line
    const titlePage = {};
    if(/^\s*[A-Za-z][A-Za-z ]{0,24}:/.test(lines[0] || "") && !HEADING.test(lines[0] || "")){
      let key = "", i = 0;
      for(; i < lines.length; i++){
        const ln = lines[i];
        if(!ln.trim()) break;
        const m = /^\s*([A-Za-z][A-Za-z ]{0,24}):\s*(.*)$/.exec(ln);
        if(m && !/^\s{2,}|\t/.test(ln)){ key = m[1].trim().toLowerCase(); titlePage[key] = squash(m[2]); }
        else if(key){ titlePage[key] = squash((titlePage[key] ? titlePage[key] + " " : "") + ln); }
      }
      lines = lines.slice(i);
    }

    const scenes = [];
    let cur = null;
    const pre = [];   // blocks before the first scene heading
    const push = (b) => { if(cur) cur.blocks.push(b); else pre.push(b); };
    const pullNotes = (s) => s.replace(new RegExp(NOTE + "(\\d+)\u0000", "g"), (m, n) => {
      const t = noteTexts[Number(n)]; if(t){ (cur ? (cur.notes = cur.notes || []) : notes).push(cur ? t : { kind:"note", text:t }); } return ""; });
    let mode = "";          // "dia" while inside a speech
    let prevBlank = true;
    let lastAction = null;  // consecutive action lines join into one paragraph
    for(let i = 0; i < lines.length; i++){
      const raw = pullNotes(lines[i]);
      const t = raw.trim();
      const next = (lines[i + 1] || "").trim();
      if(!t){
        if(/^\s{2,}$/.test(raw) && mode === "dia") continue;   // two spaces keep a speech going (Fountain)
        mode = ""; prevBlank = true; lastAction = null; continue;
      }
      if(/^={3,}\s*$/.test(t)){ prevBlank = true; lastAction = null; continue; }        // page break
      if(/^#+\s/.test(t) || /^=(?!=)/.test(t)){ (cur ? (cur.notes = cur.notes || []) : notes).push(cur ? squash(t.replace(/^[#=]+/, "")) : { kind:"section", text:squash(t.replace(/^[#=]+/, "")) }); prevBlank = true; continue; }
      // a scene heading: forced with "." (not "..."), or INT./EXT./EST./I/E after a blank line
      if((t.charAt(0) === "." && t.charAt(1) !== ".") || (prevBlank && HEADING.test(t + " "))){
        let h = t.charAt(0) === "." && t.charAt(1) !== "." ? t.slice(1) : t;
        let number = "";
        const nm = /\s*#([^#\s][^#]*)#\s*$/.exec(h);
        if(nm){ number = nm[1].trim(); h = h.slice(0, nm.index); }
        cur = { heading:squash(unmark(h)), number, blocks:[{ type:"scene", text:squash(unmark(h)) }], notes:[] };
        scenes.push(cur);
        mode = ""; prevBlank = false; lastAction = null; continue;
      }
      if(mode === "dia"){
        if(/^\(.*\)$/.test(t)){ push({ type:"paren", text:squash(unmark(t)) }); lastAction = null; continue; }
        const last = (cur ? cur.blocks : pre).slice(-1)[0];
        const words = squash(unmark(t.replace(/^~\s*/, "")));
        if(last && last.type === "dia") last.text = last.text + " " + words;
        else push({ type:"dia", text:words });
        continue;
      }
      if(t.charAt(0) === "!"){ const w = squash(unmark(t.slice(1)));
        if(lastAction){ lastAction.text += " " + w; } else { lastAction = { type:"action", text:w }; push(lastAction); }
        prevBlank = false; continue; }
      if(t.charAt(0) === ">" && t.slice(-1) === "<"){ lastAction = { type:"action", text:squash(unmark(t.slice(1, -1))), centered:true }; push(lastAction); prevBlank = false; continue; }
      if(prevBlank && isTransitionLine(t) && !next){
        push({ type:"trans", text:squash(unmark(t.replace(/^>\s*/, ""))) }); prevBlank = false; lastAction = null; continue; }
      // a character cue: capitals after a blank line, with words on the next line (or forced with "@")
      if((prevBlank || t.charAt(0) === "@") && next && isCueLine(t)){
        const dual = /\^\s*$/.test(t);
        push({ type:"char", text:squash(unmark(t.replace(/^@/, "").replace(/\^\s*$/, ""))), ...(dual ? { dual:true } : {}) });
        mode = "dia"; prevBlank = false; lastAction = null; continue;
      }
      if(t.charAt(0) === "~"){ push({ type:"dia", text:squash(unmark(t.slice(1))), lyric:true }); prevBlank = false; continue; }
      const w = squash(unmark(t));
      if(lastAction && !prevBlank){ lastAction.text += " " + w; }
      else { lastAction = { type:"action", text:w }; push(lastAction); }
      prevBlank = false;
    }
    if(pre.length){
      warnings.push(pre.length + " line" + (pre.length !== 1 ? "s come" : " comes") + " before the first scene heading \u2014 kept as an opening scene.");
      scenes.unshift({ heading:"", number:"", blocks:pre, notes:[], opening:true });
    }
    return finish({ titlePage, scenes, notes, warnings, source:"fountain" });
  }

  /* ---------- Final Draft (.fdx) — XML, read without a DOM (works in the browser and in tests) ---------- */
  const decode = s => clean(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const attr = (attrs, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"", "i").exec(attrs || ""); return m ? decode(m[1]) : ""; };
  const textOf = (inner) => {
    let out = "";
    String(inner || "").replace(/<Text\b[^>]*\/>|<Text\b[^>]*>([\s\S]*?)<\/Text>/gi, (m, t) => { out += t == null ? "" : decode(t.replace(/<[^>]+>/g, "")); return m; });
    return out;
  };
  const FDX_TYPE = { "scene heading":"scene", "action":"action", "character":"char", "dialogue":"dia", "parenthetical":"paren",
    "transition":"trans", "shot":"action", "general":"action", "lyrics":"dia", "cast list":"", "new act":"", "end of act":"", "outline":"", "outline body":"" };
  function parseFdx(xml){
    let src = clean(xml);
    const notes = [], warnings = [], titlePage = {};
    if(!/<FinalDraft\b/i.test(src)) warnings.push("This doesn\u2019t look like a Final Draft file \u2014 read as best we can.");
    // the title page: the first line is the title; the line after "written by" / "by" is the author
    src = src.replace(/<TitlePage\b[\s\S]*?<\/TitlePage>/i, (tp) => {
      const lines = [];
      tp.replace(/<Paragraph\b[^>]*>([\s\S]*?)<\/Paragraph>/gi, (m, inner) => { const t = squash(textOf(inner)); if(t) lines.push(t); return m; });
      if(lines.length) titlePage.title = lines[0];
      const by = lines.findIndex(l => /^(?:written\s+)?by\b|^screenplay by\b|^story by\b/i.test(l));
      if(by >= 0){ const rest = lines[by].replace(/^(?:written\s+|screenplay\s+|story\s+)?by\s*/i, "").trim(); titlePage.author = rest || lines[by + 1] || ""; }
      const dd = lines.find(l => /\b(?:draft|revision|revised)\b/i.test(l)); if(dd) titlePage["draft date"] = dd;
      return "";
    });
    // script notes: kept as notes, never as lines
    src = src.replace(/<ScriptNotes\b[\s\S]*?<\/ScriptNotes>/gi, (m) => { const t = squash(textOf(m)); if(t) notes.push({ kind:"note", text:t }); return ""; });
    src = src.replace(/<ScriptNote\b[\s\S]*?<\/ScriptNote>/gi, (m) => { const t = squash(textOf(m)); if(t) notes.push({ kind:"note", text:t }); return ""; });
    // dual dialogue: the inner paragraphs come out flat, each speech marked dual
    src = src.replace(/<Paragraph\b[^>]*>\s*<DualDialogue>([\s\S]*?)<\/DualDialogue>\s*<\/Paragraph>/gi, (m, inner) =>
      inner.replace(/<Paragraph\b([^>]*)>/gi, (mm, a) => "<Paragraph" + a + " data-dual=\"1\">"));
    const scenes = [], pre = [];
    let cur = null;
    let unknown = 0;
    src.replace(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi, (m, attrs, inner) => {
      const typeRaw = attr(attrs, "Type").toLowerCase();
      const type = Object.prototype.hasOwnProperty.call(FDX_TYPE, typeRaw) ? FDX_TYPE[typeRaw] : (unknown++, "action");
      const text = squash(textOf(inner));
      if(!type || !text) return m;
      const dual = attr(attrs, "data-dual") === "1";
      if(type === "scene"){
        cur = { heading:text, number:attr(attrs, "Number"), blocks:[{ type:"scene", text }], notes:[] };
        scenes.push(cur); return m;
      }
      const b = { type, text, ...(dual && type === "char" ? { dual:true } : {}) };
      (cur ? cur.blocks : pre).push(b);
      return m;
    });
    if(unknown) warnings.push(unknown + " paragraph" + (unknown !== 1 ? "s" : "") + " of a type we don\u2019t know came in as action \u2014 check them.");
    if(pre.length){
      warnings.push(pre.length + " line" + (pre.length !== 1 ? "s come" : " comes") + " before the first scene heading \u2014 kept as an opening scene.");
      scenes.unshift({ heading:"", number:"", blocks:pre, notes:[], opening:true });
    }
    return finish({ titlePage, scenes, notes, warnings, source:"fdx" });
  }

  /* ---------- Highland (.highland): a zip holding the script as Fountain text ---------- */
  async function inflateRaw(bytes){
    if(typeof DecompressionStream !== "function") throw new Error("This browser can\u2019t open zip files \u2014 export the script as Fountain or Final Draft instead.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buffer){
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for(let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
    if(eocd < 0) throw new Error("This file isn\u2019t a readable zip.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    const td = new TextDecoder("utf-8");
    for(let n = 0; n < count && p + 46 <= u8.length; n++){
      if(dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if(/\/$/.test(name)) continue;
      const lnl = dv.getUint16(local + 26, true), lel = dv.getUint16(local + 28, true);
      const start = local + 30 + lnl + lel;
      const data = u8.subarray(start, start + size);
      out.push({ name, method, data });
    }
    return {
      names: out.map(e => e.name),
      async read(name){
        const e = out.find(x => x.name === name); if(!e) return null;
        if(e.method === 0) return td.decode(e.data);
        if(e.method === 8) return td.decode(await inflateRaw(e.data));
        throw new Error("This zip uses a compression we can\u2019t read.");
      },
    };
  }
  async function parseHighland(buffer){
    const z = await unzip(buffer);
    const pick = z.names.find(n => /(^|\/)text\.(?:md|fountain)$/i.test(n))
      || z.names.find(n => /\.fountain$/i.test(n)) || z.names.find(n => /\.(?:md|markdown|txt)$/i.test(n));
    if(!pick) throw new Error("No script text was found inside this Highland file.");
    const r = parseFountain(await z.read(pick));
    r.source = "highland";
    return r;
  }

  /* ---------- the result: scenes, characters, counts ---------- */
  function finish(r){
    r.scenes = (r.scenes || []).filter(s => s && s.blocks && s.blocks.some(b => b.type !== "scene" || squash(b.text)));
    r.title = squash(r.titlePage.title || "").replace(/^["“]|["”]$/g, "");
    r.author = squash(r.titlePage.author || r.titlePage.authors || "");
    r.draftDate = squash(r.titlePage["draft date"] || r.titlePage.date || "");
    r.characters = buildCharacters(r.scenes);
    /* PROSE, NOT A SCREENPLAY (2026-10-18): no scene headings and no character cues — a story, treatment or synopsis.
       The preview offers to use it as the idea in New Story (the studio writes the screenplay) instead */
    const heads = r.scenes.some(s => !s.opening && s.heading);
    const cues = r.scenes.some(s => (s.blocks || []).some(b => b.type === "char"));
    r.looksLikeProse = !!r.scenes.length && !heads && !cues;
    if(r.looksLikeProse) r.prose = r.scenes.flatMap(s => (s.blocks || []).map(b => b.text)).join("\n\n");
    if(!r.scenes.length) r.warnings.push("No scenes were found \u2014 check the file, or paste the script as text.");
    else if(r.scenes.length === 1 && r.scenes[0].opening) r.warnings.push("No scene headings were found (INT. / EXT.) \u2014 the whole script came in as one scene. Split it below.");
    return r;
  }
  function buildCharacters(scenes){
    const by = {};
    (scenes || []).forEach((sc, si) => (sc.blocks || []).forEach((b, bi) => {
      if(b.type !== "char") return;
      const name = cueName(b.text); if(!name) return;
      const key = idOf(name); if(!key) return;
      const c = by[key] = by[key] || { key, cue:name.toUpperCase(), name:titleCase(name), lines:0, scenes:new Set(), remoteOnly:true };
      // the lines this cue speaks
      let k = bi + 1; while(sc.blocks[k] && (sc.blocks[k].type === "paren")) k++;
      if(sc.blocks[k] && sc.blocks[k].type === "dia") c.lines++;
      c.scenes.add(si);
      if(!REMOTE.test(b.text)) c.remoteOnly = false;
    }));
    return Object.values(by).map(c => ({ ...c, scenes:c.scenes.size, voiceOnly:c.remoteOnly, aliases:[] }))
      .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  }
  /* likely duplicates to offer as one-click merges: "BOB" and "BOB SMITH"; "ROBERT" isn't guessed (no nicknames) */
  function characterSuggestions(chars){
    const out = [];
    const list = (chars || []).filter(c => c && !c.mergedInto);
    list.forEach(a => list.forEach(b => {
      if(a === b) return;
      const wa = norm(a.cue).split(" "), wb = norm(b.cue).split(" ");
      // b's name is a whole word of a's longer name, and b speaks less or the same
      if(wa.length > wb.length && wb.length === 1 && wa.indexOf(wb[0]) >= 0 && wb[0].length > 2
        && !out.some(x => x.from === b.key)) out.push({ from:b.key, into:a.key, text:"\u201c" + b.cue + "\u201d may be " + a.cue });
    }));
    return out;
  }
  function mergeCharacters(parsed, fromKey, intoKey){
    const r = { ...parsed, characters:(parsed.characters || []).map(c => ({ ...c, aliases:(c.aliases || []).slice() })) };
    const from = r.characters.find(c => c.key === fromKey), into = r.characters.find(c => c.key === intoKey);
    if(!from || !into || from === into) return parsed;
    into.aliases = Array.from(new Set(into.aliases.concat([from.cue], from.aliases || [])));
    into.lines += from.lines; into.scenes = Math.max(into.scenes, from.scenes);
    into.voiceOnly = into.voiceOnly && from.voiceOnly;
    r.characters = r.characters.filter(c => c !== from)
      .sort((x, y) => y.lines - x.lines || x.name.localeCompare(y.name));   // the one who speaks most leads the cast
    return r;
  }
  /* merge scene i with the one after it: the second heading stays in the text (a sequence with two sluglines) */
  function mergeScenes(parsed, i){
    const s = parsed.scenes || [];
    if(i < 0 || i >= s.length - 1) return parsed;
    const merged = { ...s[i], blocks:s[i].blocks.concat(s[i + 1].blocks), notes:(s[i].notes || []).concat(s[i + 1].notes || []), opening:false };
    if(!merged.heading && s[i + 1].heading){ merged.heading = s[i + 1].heading; merged.number = s[i + 1].number; }
    const scenes = s.slice(0, i).concat([merged], s.slice(i + 2));
    return { ...parsed, scenes, characters:recount(scenes, parsed.characters) };
  }
  /* split scene i before block b: the new scene takes its heading from that block when it is a slugline */
  function splitScene(parsed, i, b){
    const s = parsed.scenes || [], sc = s[i];
    if(!sc || b <= 0 || b >= sc.blocks.length) return parsed;
    const head = sc.blocks[b].type === "scene" ? sc.blocks[b].text : "";
    const a = { ...sc, blocks:sc.blocks.slice(0, b) };
    const c = { heading:head || sc.heading, number:"", blocks:sc.blocks.slice(b), notes:[], splitFrom:true };
    const scenes = s.slice(0, i).concat([a, c], s.slice(i + 1));
    return { ...parsed, scenes, characters:recount(scenes, parsed.characters) };
  }
  // a recount after a merge or split keeps the character merges and names already chosen
  function recount(scenes, before){
    const out = applyCharacterMerges(buildCharacters(scenes), before);
    return out.map(c => { const p = (before || []).find(x => x.key === c.key); return p ? { ...c, name:p.name } : c; });
  }
  /* the name the cast card uses (the cues in the script stay as written) */
  function renameCharacter(parsed, key, name){
    const n = squash(name); if(!n) return parsed;
    return { ...parsed, characters:(parsed.characters || []).map(c => c.key === key ? { ...c, name:n } : c) };
  }
  function applyCharacterMerges(chars, before){
    let out = chars;
    (before || []).forEach(p => (p.aliases || []).forEach(al => {
      const from = out.find(x => x.cue === al);
      if(from) out = mergeCharacters({ characters:out }, from.key, p.key).characters;
    }));
    return out;
  }

  /* screen length: about 55 lines a page, a page a minute; action wraps at ~60 characters, dialogue at ~35 */
  function stats(parsed){
    let lines = 0, words = 0;
    (parsed.scenes || []).forEach(sc => (sc.blocks || []).forEach(b => {
      const t = squash(b.text); words += t ? t.split(" ").length : 0;
      const w = b.type === "dia" ? 35 : b.type === "paren" ? 25 : 60;
      lines += Math.max(1, Math.ceil(t.length / w)) + (b.type === "char" || b.type === "paren" ? 0 : 1);
    }));
    // a PDF knows its pages (its title page aside); otherwise ~55 lines a page
    const pages = parsed.pagesExact > 0 ? parsed.pagesExact : Math.max(1, Math.round(lines / 55));
    return { scenes:(parsed.scenes || []).length, pages, minutes:pages, words,
      speaking:(parsed.characters || []).filter(c => c.lines > 0).length };
  }
  /* the format the length suggests (the app's own registry when it's loaded) */
  function suggestFormat(st){
    const m = (st && st.minutes) || 0;
    const fmts = Array.isArray(root.FORMATS) ? root.FORMATS : [];
    const has = id => !fmts.length || fmts.some(f => f.id === id);
    const pick = m >= 70 ? "feature" : m >= 22 ? (has("series") ? "series" : "feature") : m >= 8 ? "film" : m >= 2 ? "short" : "commercial";
    const why = m >= 70 ? "about " + m + " pages \u2014 feature length"
      : m >= 22 ? "about " + m + " pages \u2014 an episode\u2019s length"
      : m >= 8 ? "about " + m + " pages \u2014 a short film"
      : m >= 2 ? "about " + m + " pages \u2014 a micro short" : "under two pages";
    return { id:has(pick) ? pick : "film", why };
  }

  /* ---------- into the app's film: scenes, screenplay blocks (word for word), cast ---------- */
  const PALETTE = ["linear-gradient(135deg,#c97b45,#5e3a1d)","linear-gradient(135deg,#3f7d86,#16323a)",
    "linear-gradient(135deg,#7a6cae,#2a2440)","linear-gradient(135deg,#5a6470,#23282f)",
    "linear-gradient(135deg,#4a8c6a,#1d3a2a)","linear-gradient(135deg,#9a5a6e,#3a2230)"];
  function sceneTitle(heading){
    const h = squash(heading).replace(/^(?:INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E|E\s*\/\s*I)[.\s]+/i, "");
    const place = h.split(/\s+[-\u2013\u2014]\s+|\s*\u00b7\s*/)[0] || h;
    return titleCase(place).slice(0, 60);
  }
  function firstWords(t, n){ const w = squash(t).split(" "); return w.slice(0, n).join(" ") + (w.length > n ? "\u2026" : ""); }
  function actsFor(frameworkId){
    const fw = typeof root.frameworkOf === "function" ? root.frameworkOf({ framework:frameworkId }) : null;
    const nos = fw && fw.acts ? Object.keys(fw.acts).map(Number).filter(Boolean).sort((a, b) => a - b) : [1, 2, 3];
    return nos.length ? nos : [1, 2, 3];
  }
  function toFilm(parsed, opts){
    opts = opts || {};
    const at = opts.now || new Date().toISOString();
    const stamp = String(Date.parse(at) || Date.now()).slice(-6) + Math.random().toString(36).slice(2, 5);
    const chars = (parsed.characters || []).slice();
    const cueToId = {};
    const used = new Set();
    const characters = chars.map((c, i) => {
      let id = idOf(c.name) || ("char" + i); while(used.has(id)) id += "x"; used.add(id);
      [c.cue].concat(c.aliases || []).forEach(n => { cueToId[idOf(n)] = id; });
      return { id, name:c.name, role:i === 0 ? "Protagonist" : "Supporting", color:PALETTE[i % PALETTE.length],
        conscious:"", unconscious:"", arc:"", look:"", wardrobe:"", props:"",
        ...(c.aliases && c.aliases.length ? { aliases:c.aliases.map(titleCase) } : {}),
        ...(c.voiceOnly ? { voiceOnly:true } : {}), imported:true };
    });
    const acts = actsFor(opts.framework);
    const n = (parsed.scenes || []).length;
    const actOf = i => {
      if(acts.length === 3){ const f = n > 1 ? i / (n - 1) : 0; return f < 0.25 ? acts[0] : f <= 0.75 ? acts[1] : acts[2]; }
      return acts[Math.min(acts.length - 1, Math.floor(i * acts.length / Math.max(1, n)))];
    };
    const scenes = [], drafts = {};
    (parsed.scenes || []).forEach((sc, i) => {
      const id = "s-imp-" + stamp + "-" + (i + 1);
      const firstAction = (sc.blocks || []).find(b => b.type === "action");
      const firstCue = (sc.blocks || []).find(b => b.type === "char");
      scenes.push({ id, act:actOf(i), seq:"", no:i + 1,
        title:sc.heading ? sceneTitle(sc.heading) : (sc.opening ? "Opening" : "Scene " + (i + 1)),
        loc:squash(sc.heading).replace(/\s+[-\u2013\u2014]\s+/, " \u00b7 "),
        summary:firstAction ? firstWords(firstAction.text, 40) : "",
        openValue:"", openCharge:0, closeValue:"", closeCharge:0, conf:1, kind:"normal", plot:"",
        driver:firstCue ? (cueToId[idOf(cueName(firstCue.text))] || "") : "",
        objective:"", turningPoint:"",
        ...(sc.number ? { sceneNumber:sc.number } : {}),
        // the read (phase 2) fills the card from the script; until then it's marked unread
        imported:true, unread:true });
      drafts[id] = { blocks:(sc.blocks || []).map(b => ({ beat:1, type:b.type, text:b.text, ...(b.dual ? { dual:true } : {}), ...(b.centered ? { centered:true } : {}) })),
        ...(sc.notes && sc.notes.length ? { notes:sc.notes.slice() } : {}),
        imported:{ at, file:opts.fileName || "" } };
    });
    const st = stats(parsed);
    const project = {
      title:squash(opts.title || parsed.title || "") || "Untitled film",
      ...(squash(opts.author || parsed.author) ? { author:squash(opts.author || parsed.author) } : {}),
      genre:"", logline:"", controllingIdea:{},
      ...(opts.format ? { format:opts.format } : {}), ...(opts.framework ? { framework:opts.framework } : {}),
      importedFrom:{ file:opts.fileName || "", kind:parsed.source || "", at, scenes:st.scenes, pages:st.pages,
        ...(parsed.draftDate ? { draftDate:parsed.draftDate } : {}), notes:(parsed.notes || []).length },
    };
    return { project, scenes, drafts, characters, beatsMap:{} };
  }

  /* ---------- A REVISED DRAFT (phase 4, owner 2026-10-18): match its scenes to the film's ---------- */
  /* Each new scene is matched to one of the film's scenes by its scene number (when both have one — production drafts
     keep them), its heading and its words; one-to-one, best match first. A matched scene is UNCHANGED (the same words,
     spacing aside) or REVISED; an unmatched new scene is NEW; a film scene nothing matched is REMOVED; a matched scene
     whose place in the order changed is also MOVED. Nothing is applied here. */
  const headKey = h => norm(String(h || "").replace(/#[^#]*#/g, "")).replace(/\b(?:cont(?:inuous|d)?|later|moments later|same)\b/g, "").trim();
  const wordsKey = blocks => (blocks || []).filter(b => b && b.type !== "scene").map(b => norm(b.text)).join(" ");
  function wordSet(t){ const set = new Set(); String(t || "").split(" ").forEach(w => { if(w.length > 1) set.add(w); }); return set; }
  function overlap(a, b){
    if(!a.size && !b.size) return 1;
    let hit = 0; a.forEach(w => { if(b.has(w)) hit++; });
    return hit / Math.max(1, Math.max(a.size, b.size));
  }
  function matchDraft(film, parsed){
    const old = (film.scenes || []).map((sc, i) => {
      const blocks = ((film.drafts || {})[sc.id] || {}).blocks || [];
      const head = (blocks.find(b => b.type === "scene") || {}).text || sc.loc || "";
      const w = wordsKey(blocks);
      return { i, id:sc.id, no:sc.no, title:sc.title, number:String(sc.sceneNumber || ""), head:headKey(head), heading:squash(head), words:w, set:wordSet(w), edited:!!((film.drafts || {})[sc.id] || {}).importedBlocks };
    });
    const neu = (parsed.scenes || []).map((sc, j) => { const w = wordsKey(sc.blocks);
      return { j, number:String(sc.number || ""), head:headKey(sc.heading), heading:squash(sc.heading), words:w, set:wordSet(w), blocks:sc.blocks }; });
    const pairs = [];
    neu.forEach(n => old.forEach(o => {
      const byNumber = n.number && o.number && n.number === o.number;
      const headSim = n.head && o.head ? (n.head === o.head ? 1 : overlap(wordSet(n.head), wordSet(o.head))) : 0;
      const textSim = overlap(n.set, o.set);
      const near = 1 - Math.min(1, Math.abs(n.j / Math.max(1, neu.length) - o.i / Math.max(1, old.length)) * 2);
      const score = byNumber ? 2 + textSim : headSim * 0.45 + textSim * 0.45 + near * 0.1;
      if(byNumber || score >= 0.42 || (headSim === 1 && textSim >= 0.2)) pairs.push({ n:n.j, o:o.i, score });
    }));
    pairs.sort((a, b) => b.score - a.score);
    const nTaken = new Map(), oTaken = new Set();
    pairs.forEach(p => { if(nTaken.has(p.n) || oTaken.has(p.o)) return; nTaken.set(p.n, p.o); oTaken.add(p.o); });
    // MOVED: matched scenes outside the longest run that keeps the film's order
    const seq = neu.filter(n => nTaken.has(n.j)).map(n => nTaken.get(n.j));
    const keep = new Set(lis(seq));
    const rows = neu.map(n => {
      if(!nTaken.has(n.j)) return { status:"new", newIndex:n.j, heading:n.heading, words:n.words.split(" ").length };
      const o = old[nTaken.get(n.j)];
      const same = o.words === n.words;
      const changed = same ? 0 : Math.round((1 - overlap(o.set, n.set)) * 100);
      return { status:same ? "unchanged" : "revised", newIndex:n.j, oldId:o.id, oldNo:o.no, title:o.title, heading:n.heading,
        moved:!keep.has(o.i), changed:same ? 0 : Math.max(1, changed), editedHere:o.edited && !same };
    });
    const removed = old.filter(o => !oTaken.has(o.i)).map(o => ({ status:"removed", oldId:o.id, oldNo:o.no, title:o.title, heading:o.heading }));
    const count = k => rows.filter(r => r.status === k).length;
    return { rows, removed, counts:{ unchanged:count("unchanged"), revised:count("revised"), new:count("new"),
      removed:removed.length, moved:rows.filter(r => r.moved).length } };
  }
  // the longest increasing subsequence's VALUES (the scenes that kept their relative order)
  function lis(a){
    const tails = [], prev = new Array(a.length), idx = [];
    a.forEach((x, i) => {
      let lo = 0, hi = tails.length;
      while(lo < hi){ const m = (lo + hi) >> 1; if(a[tails[m]] < x) lo = m + 1; else hi = m; }
      prev[i] = lo > 0 ? tails[lo - 1] : -1; tails[lo] = i;
    });
    const out = []; let k = tails.length ? tails[tails.length - 1] : -1;
    while(k >= 0){ out.push(a[k]); k = prev[k]; }
    return out.reverse();
  }

  /* the words of a parsed script, for the word-for-word check (tests, and a guard before import) */
  function wordsOf(parsed){
    return (parsed.scenes || []).flatMap(sc => (sc.blocks || []).map(b => squash(b.text))).join(" ");
  }

  /* ---------- entry points ---------- */
  const KINDS = [
    { ext:/\.(?:fountain|spmd)$/i, kind:"fountain" }, { ext:/\.fdx$/i, kind:"fdx" }, { ext:/\.highland$/i, kind:"highland" },
    { ext:/\.(?:txt|text|md|markdown)$/i, kind:"text" }, { ext:/\.pdf$/i, kind:"pdf" }, { ext:/\.docx$/i, kind:"docx" },
  ];
  const ACCEPT = ".fountain,.spmd,.fdx,.highland,.pdf,.docx,.txt,.text,.md";
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_PDF_BYTES = 40 * 1024 * 1024;
  function kindOf(name){ const k = KINDS.find(x => x.ext.test(String(name || ""))); return k ? k.kind : ""; }
  async function parseFile(file){
    if(!file) throw new Error("Choose a script file.");
    // a PDF may be a scan (page images): it may be bigger
    if(/\.pdf$/i.test(file.name) ? file.size > MAX_PDF_BYTES : file.size > MAX_BYTES)
      throw new Error("This file is larger than " + (/\.pdf$/i.test(file.name) ? "40" : "8") + " MB \u2014 a screenplay is usually well under " + (/\.pdf$/i.test(file.name) ? "10" : "1") + " MB. Check it\u2019s the script.");
    const kind = kindOf(file.name);
    if(/\.doc$/i.test(file.name)) throw new Error("This is an older Word file (.doc). Open it in Word or Google Docs and save it as .docx (or export a PDF), then import that.");
    if(!kind) throw new Error("We read Fountain (.fountain), Final Draft (.fdx), Highland (.highland), PDF, Word (.docx) and plain text (.txt) \u2014 or paste the script.");
    let r;
    // PDF and Word (phase 5): the layout reader in script-import-pages.js
    if(kind === "pdf" || kind === "docx"){
      const P = root.ScriptPages;
      if(!P) throw new Error("The PDF and Word reader didn\u2019t load \u2014 reload the page and try again.");
      r = kind === "pdf" ? await P.parsePdf(await file.arrayBuffer()) : await P.parseDocx(await file.arrayBuffer());
    }
    else if(kind === "highland") r = await parseHighland(await file.arrayBuffer());
    else {
      const text = await file.text();
      r = kind === "fdx" || /^\s*<\?xml[\s\S]{0,200}<FinalDraft/i.test(text) ? parseFdx(text) : parseFountain(text);
      if(kind === "text" && r.source === "fountain") r.source = "text";
    }
    r.fileName = file.name;
    return r;
  }
  function parseText(text){
    const t = clean(text);
    const r = /^\s*<\?xml[\s\S]{0,200}<FinalDraft/i.test(t) ? parseFdx(t) : parseFountain(t);
    r.source = r.source === "fdx" ? "fdx" : "paste";
    r.fileName = "";
    return r;
  }

  root.ScriptImport = { parseFile, parseText, parseFountain, parseFdx, parseHighland, unzip, mergeScenes, splitScene,
    mergeCharacters, renameCharacter, characterSuggestions, applyCharacterMerges, stats, suggestFormat, toFilm, wordsOf, cueName, sceneTitle,
    matchDraft, lis,
    // for the PDF / Word reader (script-import-pages.js, phase 5)
    finishParse:finish, isCueLine, isTransitionLine, HEADING,
    ACCEPT, kindOf };
})(typeof window !== "undefined" ? window : globalThis);

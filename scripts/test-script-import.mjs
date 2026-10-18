#!/usr/bin/env node
/* test-script-import.mjs — BRING YOUR OWN SCRIPT, phase 1 (owner 2026-10-18; docs/Script Import Plan.md).
   app/script-import.js reads a screenplay WORD FOR WORD; the window and the app wiring are checked at source level.

     A  Fountain: the title page, scene headings (and their numbers), action, cues and their extensions, parentheticals,
        dialogue, transitions, dual dialogue, notes and boneyard kept aside, emphasis marks lifted, "BANG!" not a cue
     B  the words in the parse are the words in the file (every word of the source's script text, in order)
     C  Final Draft (.fdx): paragraphs by type, the title page's title and author, dual dialogue, script notes aside
     D  Highland (.highland): a zip holding Fountain text, read with the browser's own inflater
     E  fixing: merge scenes (both headings stay), split at a line, merge characters (aliases; cues never renamed)
     F  into a film: a scene card per heading (marked unread), the screenplay blocks verbatim, the cast from the cues
        with merged names pointing at one character, the author and the film's import record
     G  the window and the app: New Story's "I have a script" card (admin only until the read), the import window,
        the film created with its content in it (createProject opts.doc), the files loaded with cache keys
        (public since phase 3 — test-script-import-launch)

   node scripts/test-script-import.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/script-import.js"), box);
const SI = box.ScriptImport;
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const FOUNTAIN = `Title: Soft Folder
Credit: Written by
Author: Ada Lovelace
Draft date: 1 October 2026

INT. N68 BUS - NIGHT #1#

Rain hammers the windscreen. TOMASZ (40s) grips his
citizenship folder, **knuckles white**.

TOMASZ
(quietly)
Go home, mate. Nobody here needs you tonight.

DRUNK (O.S.)
Says who?

BANG!

[[check the bus number]]

CUT TO:

EXT. WEST CROYDON - CONTINUOUS

Bernadette waits under the shelter.

BERNADETTE ^
Tomasz?

/* an old line nobody should see */
TOMASZ SMITH (CONT'D)
Get on.

> FADE OUT.
`;

await test("A Fountain: title page, headings, cues, dialogue, transitions, dual, notes, marks", () => {
  const r = SI.parseFountain(FOUNTAIN);
  assert.equal(r.title, "Soft Folder"); assert.equal(r.author, "Ada Lovelace"); assert.equal(r.draftDate, "1 October 2026");
  assert.equal(r.scenes.length, 2);
  const [a, b] = r.scenes;
  assert.equal(a.heading, "INT. N68 BUS - NIGHT"); assert.equal(a.number, "1");
  assert.deepEqual(J(a.blocks.map(x => x.type)), ["scene","action","char","paren","dia","char","dia","action","trans"]);
  assert.equal(a.blocks[1].text, "Rain hammers the windscreen. TOMASZ (40s) grips his citizenship folder, knuckles white.", "wrapped lines join; ** marks lifted");
  assert.equal(a.blocks[7].text, "BANG!", "a shout in capitals is action, not a speaker");
  assert.equal(a.blocks[8].text, "CUT TO:");
  assert.deepEqual(J(a.notes), ["check the bus number"], "[[notes]] are kept aside");
  assert.equal(b.blocks.find(x => x.type === "char").dual, true, "the ^ dual mark");
  assert.ok(!JSON.stringify(r.scenes).includes("an old line"), "boneyard text never becomes script");
  assert.equal(J(r.notes)[0].kind, "boneyard");
  assert.equal(b.blocks[b.blocks.length - 1].type, "trans", "a forced > transition");
  assert.deepEqual(J(r.characters.map(c => c.cue).sort()), ["BERNADETTE","DRUNK","TOMASZ","TOMASZ SMITH"]);
  assert.ok(r.characters.every(c => c.lines === 1));
  assert.ok(r.characters.find(c => c.cue === "DRUNK").voiceOnly, "(O.S.) only = voice only");
  assert.equal(SI.cueName("TOMASZ SMITH (CONT'D)"), "TOMASZ SMITH");
});

await test("B every word of the script text is in the parse, in order", () => {
  const r = SI.parseFountain(FOUNTAIN);
  const words = (s) => s.replace(/\*\*/g, "").replace(/#1#/g, "").replace(/\^/g, "").replace(/^>\s*/gm, "")
    .split(/\s+/).filter(Boolean);
  // the script body of the source: everything after the title page, minus notes and boneyard
  const body = FOUNTAIN.split("\n\n").slice(1).join("\n\n").replace(/\[\[[\s\S]*?\]\]/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual(words(SI.wordsOf(r)), words(body));
});

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
<Content>
<Paragraph Number="7" Type="Scene Heading"><SceneProperties Length="1/8"/><Text>INT. BUS - NIGHT</Text></Paragraph>
<Paragraph Type="Action"><Text>Tomasz grips the </Text><Text Style="Bold">folder</Text><Text>.</Text></Paragraph>
<Paragraph Type="Character"><Text>TOMASZ</Text></Paragraph>
<Paragraph Type="Parenthetical"><Text>(quietly)</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Go home &amp; sleep.</Text><ScriptNote ID="1"><Paragraph><Text>tighten this</Text></Paragraph></ScriptNote></Paragraph>
<Paragraph><DualDialogue><Paragraph Type="Character"><Text>BERNADETTE</Text></Paragraph><Paragraph Type="Dialogue"><Text>Now?</Text></Paragraph><Paragraph Type="Character"><Text>DRUNK</Text></Paragraph><Paragraph Type="Dialogue"><Text>Never.</Text></Paragraph></DualDialogue></Paragraph>
<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
<Paragraph Type="Scene Heading"><Text>EXT. STREET - DAY</Text></Paragraph>
<Paragraph Type="Action"><Text>Rain.</Text></Paragraph>
</Content>
<TitlePage><Content>
<Paragraph><Text>SOFT FOLDER</Text></Paragraph>
<Paragraph><Text>Written by</Text></Paragraph>
<Paragraph><Text>Ada Lovelace</Text></Paragraph>
</Content></TitlePage>
</FinalDraft>`;

await test("C Final Draft: paragraph types, title page, dual dialogue, notes aside", () => {
  const r = SI.parseFdx(FDX);
  assert.equal(r.source, "fdx"); assert.equal(r.title, "SOFT FOLDER"); assert.equal(r.author, "Ada Lovelace");
  assert.equal(r.scenes.length, 2); assert.equal(r.scenes[0].number, "7");
  const a = r.scenes[0].blocks;
  assert.deepEqual(J(a.map(x => x.type)), ["scene","action","char","paren","dia","char","dia","char","dia","trans"]);
  assert.equal(a[1].text, "Tomasz grips the folder.", "styled runs join into the words");
  assert.equal(a[4].text, "Go home & sleep.", "entities decoded; the note is not a line");
  assert.ok(a[5].dual && a[7].dual, "both cues of a dual dialogue are marked");
  assert.ok(J(r.notes).some(n => n.text === "tighten this"));
});

function zipOf(files){
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for(const [name, text] of files){
    const nm = enc.encode(name), raw = enc.encode(text), data = deflateRawSync(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true); eocd.setUint32(12, cdSize, true); eocd.setUint32(16, off, true);
  const all = parts.concat(central, [new Uint8Array(eocd.buffer)]);
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let p = 0; all.forEach(x => { out.set(x, p); p += x.length; });
  return out;
}

await test("D Highland: the zip's Fountain text is read with the browser's inflater", async () => {
  const z = zipOf([["Soft Folder.textbundle/info.json", "{}"], ["Soft Folder.textbundle/text.md", FOUNTAIN]]);
  const r = await SI.parseHighland(z.buffer);
  assert.equal(r.source, "highland"); assert.equal(r.title, "Soft Folder"); assert.equal(r.scenes.length, 2);
  await assert.rejects(SI.parseHighland(zipOf([["a/info.json", "{}"]]).buffer), /No script text/);
});

await test("E fixing: merge scenes, split at a line, merge characters (cues never renamed)", () => {
  const r = SI.parseFountain(FOUNTAIN);
  const m = SI.mergeScenes(r, 0);
  assert.equal(m.scenes.length, 1);
  assert.equal(m.scenes[0].blocks.filter(b => b.type === "scene").length, 2, "both sluglines stay in the text");
  const sp = SI.splitScene(m, 0, m.scenes[0].blocks.findIndex((b, i) => i > 0 && b.type === "scene"));
  assert.equal(sp.scenes.length, 2); assert.equal(sp.scenes[1].heading, "EXT. WEST CROYDON - CONTINUOUS", "a split at a slugline takes its heading");
  const sug = SI.characterSuggestions(r.characters);
  assert.ok(sug.some(s => s.from === "tomasz" && s.into === "tomaszsmith"), "TOMASZ may be TOMASZ SMITH");
  const mc = SI.mergeCharacters(r, "tomasz", "tomaszsmith");
  const ts = mc.characters.find(c => c.key === "tomaszsmith");
  assert.deepEqual(J(ts.aliases), ["TOMASZ"]); assert.equal(ts.lines, 2);
  assert.ok(JSON.stringify(mc.scenes).includes('"text":"TOMASZ"'), "the cue in the script is unchanged");
  const again = SI.mergeScenes(mc, 0);
  assert.ok(again.characters.find(c => c.key === "tomaszsmith").aliases.includes("TOMASZ") && !again.characters.some(c => c.key === "tomasz"), "a recount keeps the merge");
  const named = SI.renameCharacter(mc, "tomaszsmith", "Tomasz Nowak");
  assert.equal(named.characters.find(c => c.key === "tomaszsmith").name, "Tomasz Nowak");
});

await test("F into a film: cards per heading (unread), blocks verbatim, the cast, the author, the import record", () => {
  const r = SI.mergeCharacters(SI.parseFountain(FOUNTAIN), "tomasz", "tomaszsmith");
  const f = SI.toFilm(r, { fileName:"soft.fountain", format:"short", framework:"threeact", now:"2026-10-18T10:00:00Z" });
  assert.equal(f.scenes.length, 2);
  assert.deepEqual(J(f.scenes.map(s => [s.no, s.title, s.unread, s.imported])), [[1,"N68 Bus",true,true],[2,"West Croydon",true,true]]);
  assert.equal(f.scenes[0].sceneNumber, "1");
  assert.equal(f.scenes[0].driver, "tomaszsmith", "the merged cue points at one character");
  assert.deepEqual(J(f.drafts[f.scenes[0].id].blocks.map(b => b.text)), J(r.scenes[0].blocks.map(b => b.text)), "verbatim");
  assert.ok(f.drafts[f.scenes[0].id].blocks.every(b => b.beat === 1));
  assert.deepEqual(J(f.characters.map(c => c.name)), ["Tomasz Smith","Bernadette","Drunk"]);
  assert.deepEqual(J(f.characters[0].aliases), ["Tomasz"]);
  assert.equal(f.characters.find(c => c.name === "Drunk").voiceOnly, true);
  assert.equal(f.project.author, "Ada Lovelace"); assert.equal(f.project.format, "short"); assert.equal(f.project.framework, "threeact");
  assert.equal(f.project.importedFrom.file, "soft.fountain"); assert.equal(f.project.importedFrom.scenes, 2);
  assert.deepEqual(J(f.beatsMap), {});
  const st = SI.stats(r); assert.equal(st.scenes, 2); assert.ok(st.pages >= 1);
  assert.equal(SI.suggestFormat({ minutes:105 }).id, "feature"); assert.equal(SI.suggestFormat({ minutes:12 }).id, "film");
});

await test("G the window and the app wiring", () => {
  const ns = read("app/newstory.jsx"), ui = read("app/script-import-ui.jsx"), app = read("app/app.jsx"), html = read("TURN.html");
  assert.ok(ns.includes('const SEED_SCRIPT = { id:"script", label:"I have a script"') && ns.includes("(typeof onImportScript===\"function\") ? SEED_TYPES.concat([SEED_SCRIPT]) : SEED_TYPES"));
  // (phase 3, 2026-10-18) public — never inside a Show's episode (it was admin only until the read landed)
  assert.ok(app.includes("onImportScript:!newStoryBuildsCurrentEpisode ?"), "public; never in an episode");
  assert.ok(app.includes("opts.doc ? { ...emptyDoc(), ...opts.doc } : emptyDoc()"), "the film is created with its content");
  assert.ok(app.includes("const importScriptFilm = async (film)=>") && app.includes("React.createElement(window.ScriptImportWindow,{"));
  assert.ok(ui.includes("I wrote this script or have the rights to use it.") && ui.includes("disabled:!rights||busy||!st.scenes"), "the rights confirmation gates the import");
  assert.ok(/src="app\/script-import\.js\?v=[^"]+"/.test(html) && /src="app\/script-import-ui\.jsx\?v=[^"]+"/.test(html));
  assert.ok(html.indexOf("app/script-import-ui.jsx") < html.indexOf("app/app.jsx"), "loaded before the app");
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS all ${checks}`);
process.exit(failed ? 1 : 0);

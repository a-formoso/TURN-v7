#!/usr/bin/env node
/* test-script-import-series.mjs — IMPORT A SCREENPLAY, phase 6 (owner 2026-10-18; docs/Script Import Plan.md §8–9):
   episodes into a Show, and Adapt into a new film.

     A  an episode? ScriptImport.episodeInfo — a cold open / teaser, act breaks (Fountain markers, FDX "New Act"), an
        episode number (the title page, "Episode 3", 1x03, S01E03, "Pilot"), "Series" on the title page, the series'
        name and the episode's title; a short film is not an episode; orderEpisodes (numbers, then file names); the act
        markers before the first heading are kept aside as section notes (no stray opening scene)
     B  AdaptFilm.composeBrief — what the new film is (format, structure, retell / rewrite pass, the writer's note), the
        story (logline, controlling idea, synopsis, the scenes in order, the people by name), within the spine build's
        4,000 characters even for a long film; a scene not in the draft left out; no vendor or McKee names
     C  the import window: several files at once (scans refused in the batch), the episodes in order with up / down,
        the Show (new or one of yours, the next numbers), the cast across the episodes with "Same person as…", the
        rights line for several scripts; one script: "Where it goes" (its own film / an episode of a Show)
     D  the app: the Show import runs step by step through the app's own series steps (Episode 1 → the automatic
        conversion; createEpisode → fill → save for every other one), the cast merged by name into the Show's
        (turnSeries.mergeAdaptationCast), Stop, the owned Shows only; Adapt mints a NEW film (one helper with Rebuild),
        sets its format / structure / adaptedFrom / brief and starts the story build — the open film never changes
     E  Frances, the cache keys, the files loaded

   node scripts/test-script-import-series.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/script-import.js"), box);
vm.runInContext(read("app/adapt-film.js"), box);
const SI = box.ScriptImport, AF = box.AdaptFilm;
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}
const info = (text, file) => J(SI.episodeInfo(SI.parseFountain(text), file));

test("A  an episode: a cold open, act breaks, the number and the series' name from the title", () => {
  const e = info("Title: Night Buses - Episode 3: The Long Way\nAuthor: A\n\n>COLD OPEN<\n\nINT. BUS - NIGHT\n\nRain.\n\n>END OF COLD OPEN<\n\n>ACT ONE<\n\nEXT. ST - DAY\n\nX.\n\n>ACT TWO<\n\nINT. A - DAY\n\nY.\n", "nb.fountain");
  assert.deepEqual({ likely:e.likely, number:e.number, series:e.series, episodeTitle:e.episodeTitle, acts:e.acts, coldOpen:e.coldOpen },
    { likely:true, number:3, series:"Night Buses", episodeTitle:"The Long Way", acts:2, coldOpen:true });
  assert.deepEqual(e.why.slice(0, 2), ["a cold open", "2 act breaks"]);
});

test("A  an episode: Pilot + Series on the title page; 1x04 / S02E05 in a file name; Fountain sections as acts", () => {
  const p = info("Title: Pilot\nSeries: Night Buses\n\nINT. BUS - NIGHT\n\nRain.\n", "x.fountain");
  assert.equal(p.number, 1); assert.equal(p.series, "Night Buses"); assert.ok(p.why.includes("\u201cSeries\u201d on the title page"));
  assert.equal(info("INT. BUS - NIGHT\n\nRain.\n", "NightBuses_1x04.fountain").number, 4);
  assert.equal(info("INT. BUS - NIGHT\n\nRain.\n", "Night Buses S02E05.fdx").number, 5);
  assert.equal(info("Title: Night Buses\nEpisode: 7\n\nINT. BUS - NIGHT\n\nRain.\n", "a.fountain").number, 7);
  assert.equal(info("# ACT ONE\n\nINT. BUS - NIGHT\n\nRain.\n\n# ACT TWO\n\nEXT. A - DAY\n\nB.\n", "a.fountain").acts, 2);
  const fdx = SI.parseFdx(`<?xml version="1.0"?><FinalDraft><Content><Paragraph Type="New Act"><Text>ACT ONE</Text></Paragraph><Paragraph Type="Scene Heading"><Text>INT. A - DAY</Text></Paragraph><Paragraph Type="Action"><Text>A.</Text></Paragraph><Paragraph Type="New Act"><Text>ACT TWO</Text></Paragraph><Paragraph Type="Scene Heading"><Text>INT. B - DAY</Text></Paragraph><Paragraph Type="Action"><Text>B.</Text></Paragraph></Content></FinalDraft>`);
  assert.equal(fdx.actBreaks, 2); assert.equal(SI.episodeInfo(fdx, "a.fdx").likely, true);
});

test("A  a short film is not an episode; several files go in their numbers' order, then their names'", () => {
  assert.deepEqual(info("INT. BUS - NIGHT\n\nRain.\n\nMAYA\nHi.\n", "My Short.fountain"), { likely:false, number:0, series:"", episodeTitle:"", acts:0, coldOpen:false, why:[] });
  const mk = (fileName, title) => ({ fileName, scenes:[], titlePage:title ? { title } : {}, title:title || "" });
  assert.deepEqual(J(SI.orderEpisodes([mk("Ep 10.fountain"), mk("b.fountain", "Night Buses - Episode 2"), mk("Ep 1.fountain"), mk("notes.fountain")]).map(p => p.fileName)),
    ["Ep 1.fountain", "b.fountain", "Ep 10.fountain", "notes.fountain"]);
});

test("A  act markers before the first heading are section notes, not an opening scene; other lines still are", () => {
  const r = SI.parseFountain(">COLD OPEN<\n\nINT. BUS - NIGHT\n\nRain.\n");
  assert.equal(r.scenes.length, 1); assert.equal(r.scenes[0].heading, "INT. BUS - NIGHT");
  assert.deepEqual(J(r.notes), [{ kind:"section", text:"COLD OPEN" }]);
  assert.ok(!r.warnings.some(w => /before the first scene heading/.test(w)));
  const r2 = SI.parseFountain("Rain falls.\n\nINT. BUS - NIGHT\n\nRain.\n");
  assert.equal(r2.scenes.length, 2); assert.ok(r2.scenes[0].opening);
});

const FILM = { project:{ title:"The Last Bus", format:"feature", framework:"threeact", logline:"A night driver must choose between the last bus and her brother.",
    controllingIdea:{ value:"We find our way home", cause:"when we stop waiting to be rescued" }, synopsis:{ paras:[{ text:"Maya drives the N68." }, { text:"Her brother calls." }] } },
  scenes:[{ title:"The depot", summary:"Maya starts her shift.", openValue:"routine", closeValue:"dread" }, { title:"The call", summary:"Her brother calls from the hospital." },
    { title:"Gone", summary:"cut", notInDraft:true }],
  characters:[{ name:"Maya", role:"Protagonist", conscious:"to finish the shift", unconscious:"to forgive" }, { name:"Tomasz", role:"Brother" }] };
test("B  the brief: what the new film is, and the story — logline, idea, synopsis, scenes, people by name", () => {
  const formats = [{ id:"feature", label:"Feature Film" }, { id:"microdrama", label:"Micro-drama" }];
  const frameworks = [{ id:"threeact", label:"Three-Act Turns" }, { id:"kishotenketsu", label:"Kish\u014dtenketsu" }];
  const b = AF.composeBrief(FILM, { format:"microdrama", framework:"kishotenketsu", mode:"retell", note:"Tell it from Tomasz's side.", formats, frameworks });
  assert.match(b, /^ADAPTATION — a new film made from an existing one: “The Last Bus” \(Feature Film, Three-Act Turns\)\./);
  assert.match(b, /Make it a Micro-drama in the Kishōtenketsu structure\. RETELL this story/);
  assert.match(b, /THE WRITER'S NOTE: Tell it from Tomasz's side\./);
  assert.match(b, /LOGLINE: A night driver must choose/);
  assert.match(b, /CONTROLLING IDEA: We find our way home when we stop waiting to be rescued/);
  assert.match(b, /SYNOPSIS: Maya drives the N68\. Her brother calls\./);
  assert.match(b, /THE STORY, SCENE BY SCENE \(2\):\n1\. The depot — Maya starts her shift\. \(routine → dread\)\n2\. The call — Her brother calls from the hospital\./);
  assert.doesNotMatch(b, /Gone/, "a scene not in the draft is left out");
  assert.match(b, /THE PEOPLE \(keep their names\):\nMaya — Protagonist; wants to finish the shift; needs to forgive\nTomasz — Brother/);
  const rw = AF.composeBrief(FILM, { format:"feature", framework:"threeact", mode:"rewrite", formats, frameworks });
  assert.match(rw, /REWRITE this story as a new draft in the Infinite Studio AI method/);
  assert.doesNotMatch(b + rw, /McKee|Claude|Anthropic|Gemini|OpenAI|GPT/);
  assert.deepEqual(Object.keys(AF.MODES), ["retell", "rewrite"]);
});

test("B  a long film still fits the spine build's 4,000 characters (shorter lines, then fewer scenes)", () => {
  const scenes = Array.from({ length:60 }, (_, i) => ({ title:"Scene " + (i + 1), summary:"A long summary of what happens and why it matters to everyone in it, again and again, scene " + i, openValue:"hope", closeValue:"fear" }));
  const b = AF.composeBrief({ project:{ ...FILM.project, synopsis:{ paras:[{ text:"word ".repeat(800) }] } }, scenes, characters:FILM.characters }, { format:"microdrama", mode:"retell" });
  assert.ok(b.length <= AF.BRIEF_MAX && b.length > 2500, String(b.length));
  assert.match(b, /THE STORY, SCENE BY SCENE \(60\):\n1\. Scene 1/);
  assert.match(b, /THE PEOPLE \(keep their names\)/, "the people are never cut");
  assert.match(b, /more scenes? to the end\./);
});

const ui = read("app/script-import-ui.jsx"), app = read("app/app.jsx"), agentsUi = read("app/agents-ui.jsx");
test("C  the window: several files, the episodes in order, the Show, the cast across them, the rights for several", () => {
  assert.match(ui, /shows=\[\], onImportSeries \}\)\{/);
  assert.match(ui, /multiple:seriesOn/);
  assert.match(ui, /if\(files\.length>1 && seriesOn\) readMany\(files\); else readFile\(files\[0\]\);/);
  assert.match(ui, /is a scanned PDF \\u2014 import it on its own/);
  assert.match(ui, /SI\.orderEpisodes \? SI\.orderEpisodes\(out\) : out/);
  assert.match(ui, /if\(stage==="series" && episodes\)\{/);
  assert.match(ui, /h\("option",\{value:"new"\},"A new Show"\)/);
  assert.match(ui, /"Episodes "\+firstNo\+"\\u2013"\+\(firstNo\+episodes\.length-1\)\+", after the Show\\u2019s own"/);
  assert.match(ui, /"Move up"/); assert.match(ui, /"Move down"/);
  assert.match(ui, /"The cast across the episodes \\u00b7 "\+cast\.length/);
  assert.match(ui, /if\(f && t\) return SI\.mergeCharacters\(p, f\.key, t\.key\);\n\s+if\(f\) return SI\.renameCharacter\(p, f\.key, into\.name\);/);
  assert.match(ui, /"I wrote these scripts or have the rights to use them\."/);
  assert.match(ui, /format: newShow \? "series" : \(\(pickRow && pickRow\.format\) \|\| "series"\)/);
  assert.match(ui, /onImportSeries\(\{ films, showId: newShow \? null : showPick, showTitle: showTitle\.trim\(\) \}\)/);
  assert.match(ui, /"Import "\+episodes\.length\+" episodes \\u2192"/);
});

test("C  one script: Where it goes — its own film or an episode of a Show (offered when it looks like one)", () => {
  assert.match(ui, /setDest\(seriesOn && ep\.likely \? "show" : "film"\)/);
  assert.match(ui, /"Where it goes"/);
  assert.match(ui, /"This looks like an episode of a series \\u2014 "\+ep\.why\.join\(", "\)\+"\."/);
  assert.match(ui, /"Its own film"/); assert.match(ui, /"An episode of a Show"/);
  assert.match(ui, /"A new Show \(this is Episode 1\)"/);
  assert.match(ui, /dest!=="show" && h\("label",\{className:"si-field"\}, h\("span",null,"Format"\)/, "a Show's episode takes the Show's format");
  assert.match(ui, /"Import as an episode →"/);
});

test("D  the Show import: step by step through the app's own series steps; the cast merged by name; Stop", () => {
  const i = app.indexOf("const importSeries = ({ films, showId, showTitle })=>{"), j = app.indexOf("},[seriesImport, currentProjectId, currentShowId, scenes.length, seriesBusy, projectLoading]);");
  assert.ok(i > 0 && j > i);
  const f = app.slice(i, j);
  assert.match(f, /phase:showId \? "next" : "first"/);
  assert.match(f, /await importScriptFilm\(j\.films\[0\], \{ quiet:true \}\)/);
  assert.match(f, /phase:"await-show"/);
  assert.match(f, /if\(currentShowId && String\(currentProjectId\|\|""\)===j\.ep1 && !seriesBusy\)/, "Episode 1 becomes the Show through the automatic conversion");
  assert.match(f, /Turn this into a show/);
  assert.match(f, /const ok = await createEpisode\(j\.showId\);/);
  assert.match(f, /fillOpenEpisode\(j\.films\[j\.i\]\);/);
  assert.match(f, /await flushPendingProjectSave\(j\.episodeId\);/);
  assert.match(f, /if\(j\.stop \|\| j\.i >= N\)/);
  assert.match(f, /if\(seriesStepRef\.current===key\) return undefined;/, "each step runs once");
  const k = app.indexOf("const fillOpenEpisode = (film)=>{");
  const fill = app.slice(k, app.indexOf("const importSeries", k));
  assert.match(fill, /TS\.mergeAdaptationCast\(characters, chars, scs, \{ allowNew:true \}\)/);
  assert.match(fill, /const \{ title:_t, format:_f, \.\.\.rest \} = film\.project \|\| \{\};/, "the episode keeps the Show's title and format");
  assert.match(app, /if\(opts\.quiet\) return \{ ok:true, projectId:madeId \};/);
  assert.match(app, /onImportSeries:\(r\)=>importSeries\(r\)/);
  assert.match(app, /filter\(x=>x && x\.isOwner!==false && !x\.isShared\)/, "only your own Shows");
  assert.match(app, /startScriptImport\(all\.length>1 \? all : f\)/);
  assert.match(app, /className:"si-series-run",role:"status"/);
  assert.match(app, /onClick:\(\)=>setSeriesImport\(x=>x && \(\{ \.\.\.x, stop:true \}\)\)\},"Stop"\)/);
  assert.match(read("app/series.js"), /function mergeAdaptationCast\(existing, incoming, scenes, options\)/);
});

test("D  Adapt: a NEW film (one minting helper with Rebuild), its shape and brief, the story build started", () => {
  const m = app.indexOf("const mintFilmForBuild = async (verb)=>{");
  assert.ok(m > 0);
  assert.equal((app.match(/await mintFilmForBuild\("/g) || []).length, 2, "Rebuild and Adapt share it");
  assert.match(app, /if\(!\(await mintFilmForBuild\("rebuilt"\)\)\) return;/);
  const a = app.slice(app.indexOf("const adaptIntoNewFilm = async"), app.indexOf("const removeNotInDraft = async"));
  assert.match(a, /requirePlan\("adapt a film"\)/);
  assert.match(a, /window\.AdaptFilm\.composeBrief\(\{ project, scenes:ordered, characters \}, \{ format, framework, mode, note \}\)/);
  assert.ok(a.indexOf("composeBrief") < a.indexOf("mintFilmForBuild"), "the brief is made from THIS film before the new one opens");
  assert.ok(a.indexOf("mintFilmForBuild") < a.indexOf("setProject("), "nothing is set until the new film is open");
  assert.match(a, /adaptedFrom:from, sourceBrief:brief/);
  assert.match(a, /setAgentLaunch\(\{id:"adapt", input:brief\}\)/);
  assert.match(app, /onAdapt: \(scenes\.length && !writersRoomBlocked\) \?/);
  assert.match(agentsUi, /finishInput, onAdapt \}\)\{/);
  assert.match(agentsUi, /"Adapt into a new film\\u2026"/);
  assert.match(agentsUi, /function AdaptFilmWindow\(/);
  assert.match(agentsUi, /disabled:busy \|\| \(same && mode==="retell"\) \|\| !sceneCount/, "a retell needs another format or structure");
  assert.match(agentsUi, /haven\\u2019t":" hasn\\u2019t"\)\+" been read yet"/);
});

test("E  Frances knows both; the files load with keys", () => {
  const ai = read("app/ai.jsx");
  assert.match(ai, /INTO A SHOW: a script that looks like an episode/);
  assert.match(ai, /APP_FEATURES\.push\(\{ name:"Adapt into a new film"/);
  const k = ai.indexOf('name:"Adapt into a new film"'), line = ai.slice(k, ai.indexOf("\n", k));
  assert.doesNotMatch(line, /Final Draft|Highland|McKee|Claude|Gemini/);
  const html = read("TURN.html");
  for (const f of ["script-import.js", "script-import-ui.jsx", "agents-ui.jsx", "app.jsx", "adapt-film.js", "styles.css"])
    assert.ok(["20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37"].some(v => html.includes(f + "?v=" + v + '"')), f);
  assert.ok(html.indexOf("app/adapt-film.js?v=") > 0);
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

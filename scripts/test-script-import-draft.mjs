#!/usr/bin/env node
/* test-script-import-draft.mjs — IMPORT A NEW DRAFT, phase 4 (owner 2026-10-18; docs/Script Import Plan.md).
   A revised draft from the writer's app is matched scene by scene to the film before anything changes.

     A  matchDraft without scene numbers: unchanged / revised / new / removed by heading + words, one-to-one
     B  matchDraft with scene numbers (production drafts): the number wins even when the heading changed
     C  moved: a scene outside the longest run that keeps the film's order; lis() keeps the longest increasing run
     D  "also changed in Kinolot": a revised scene the writer had already rewritten here (drafts[id].importedBlocks)
     E  the window: draft mode, the status chips, the keep / remove choice, the rights box, nothing charged yet
     F  the app: applyNewDraft (whole-film Undo snapshot, revised scenes re-marked unread through commitVersion, new
        scenes and new speaking parts added, acts kept in order, the scenes the draft lacks kept and marked), the
        strip's Remove / Import a new draft buttons, the Film menu items, the spine's "Not in draft" mark, Frances

   node scripts/test-script-import-draft.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/script-import.js"), box);
const SI = box.ScriptImport;
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

// a film as the app holds it, built from a first draft
function filmOf(text){
  const t = SI.toFilm(SI.parseFountain(text), { now:"2026-10-18T10:00:00.000Z", fileName:"draft1.fountain" });
  return { scenes:t.scenes, drafts:t.drafts };
}

const D1 = `INT. KITCHEN - NIGHT

Maya pours coffee into two mugs. One stays full.

MAYA
He isn't coming.

EXT. STREET - DAY

Rain on the windscreen. Maya waits at the lights.

INT. BUS - DAY

Maya sits at the back with her bag on her knees.

INT. HOSPITAL CORRIDOR - NIGHT

A nurse pushes an empty bed past Maya.

NURSE
You can go in now.

EXT. DEPOT - NIGHT

Buses sleep in rows under orange lights.
`;

// draft 2: Street moves to the top, Kitchen is revised, Hospital unchanged, Bus unchanged, Depot gone, Roof new
const D2 = `EXT. STREET - DAY

Rain on the windscreen. Maya waits at the lights.

INT. KITCHEN - NIGHT

Maya pours coffee into two mugs. One stays full. She drinks his.

MAYA
He isn't coming. He never was.

INT. BUS - DAY

Maya sits at the back with her bag on her knees.

INT. HOSPITAL CORRIDOR - NIGHT

A nurse pushes an empty bed past Maya.

NURSE
You can go in now.

EXT. HOSPITAL ROOF - DAWN

Maya and the nurse share a cigarette in silence.
`;

test("A  matchDraft without scene numbers: unchanged / revised / new / removed, one-to-one", () => {
  const film = filmOf(D1);
  const m = J(SI.matchDraft(film, SI.parseFountain(D2)));
  assert.equal(m.rows.length, 5);
  assert.deepEqual(m.rows.map(r => r.status), ["unchanged", "revised", "unchanged", "unchanged", "new"]);
  const byHead = Object.fromEntries(m.rows.map(r => [r.heading, r]));
  assert.equal(byHead["EXT. STREET - DAY"].oldId, film.scenes[1].id);
  assert.equal(byHead["INT. KITCHEN - NIGHT"].oldId, film.scenes[0].id);
  assert.ok(byHead["INT. KITCHEN - NIGHT"].changed > 0 && byHead["INT. KITCHEN - NIGHT"].changed <= 100);
  assert.equal(byHead["INT. BUS - DAY"].changed, 0);
  assert.equal(byHead["EXT. HOSPITAL ROOF - DAWN"].oldId, undefined);
  assert.deepEqual(m.removed.map(r => r.oldId), [film.scenes[4].id]);
  assert.equal(m.removed[0].heading, "EXT. DEPOT - NIGHT");
  assert.deepEqual(m.counts, { unchanged:3, revised:1, new:1, removed:1, moved:1 });
  // one-to-one: no film scene is matched twice
  const ids = m.rows.map(r => r.oldId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test("A  the same draft again: everything unchanged, nothing moved", () => {
  const film = filmOf(D1);
  const m = SI.matchDraft(film, SI.parseFountain(D1));
  assert.deepEqual(J(m.counts), { unchanged:5, revised:0, new:0, removed:0, moved:0 });
  // spacing and case are not changes
  const m2 = SI.matchDraft(film, SI.parseFountain(D1.replace("One stays full.", "One  stays   full.")));
  assert.equal(m2.counts.unchanged, 5);
});

test("A  a rewritten heading still matches by its words; an unrelated scene doesn't", () => {
  const film = filmOf(D1);
  const m = J(SI.matchDraft(film, SI.parseFountain(D1.replace("INT. BUS - DAY", "INT. NIGHT BUS - NIGHT"))));
  const bus = m.rows.find(r => /BUS/.test(r.heading));
  assert.equal(bus.oldId, film.scenes[2].id);
  assert.equal(m.counts.removed, 0);
  const m2 = J(SI.matchDraft(film, SI.parseFountain("INT. CHURCH - DAY\n\nA choir rehearses a hymn nobody remembers.\n")));
  assert.deepEqual(m2.rows.map(r => r.status), ["new"]);
  assert.equal(m2.counts.removed, 5);
});

test("B  scene numbers decide when both drafts carry them", () => {
  const N1 = "INT. KITCHEN - NIGHT #1#\n\nMaya pours coffee.\n\nEXT. STREET - DAY #2#\n\nRain on the windscreen.\n";
  const film = filmOf(N1);
  assert.equal(film.scenes[0].sceneNumber, "1");
  // scene 2's heading AND words changed — the number still pairs it; a new 2A is new
  const N2 = "INT. KITCHEN - NIGHT #1#\n\nMaya pours coffee.\n\nEXT. MOTORWAY - NIGHT #2#\n\nHeadlights smear across the glass.\n\nEXT. LAYBY - NIGHT #2A#\n\nShe pulls over.\n";
  const m = J(SI.matchDraft(film, SI.parseFountain(N2)));
  assert.deepEqual(m.rows.map(r => r.status), ["unchanged", "revised", "new"]);
  assert.equal(m.rows[1].oldId, film.scenes[1].id);
  assert.equal(m.counts.removed, 0);
});

test("C  moved: only the scenes outside the run that keeps the order", () => {
  assert.deepEqual(J(SI.lis([1, 0, 2, 3])), [0, 2, 3]);
  assert.deepEqual(J(SI.lis([0, 1, 2])), [0, 1, 2]);
  assert.deepEqual(J(SI.lis([])), []);
  assert.equal(SI.lis([4, 1, 2, 3, 0]).length, 3);
  const film = filmOf(D1);
  const m = J(SI.matchDraft(film, SI.parseFountain(D2)));
  // Street came up from second to first: Kitchen/Bus/Hospital keep their order, so exactly one scene moved
  assert.deepEqual(m.rows.filter(r => r.moved).map(r => r.heading), ["EXT. STREET - DAY"]);
  assert.ok(!m.rows.find(r => r.status === "new").moved, "a new scene is new, not moved");
});

test("D  a revised scene that was also rewritten in Kinolot is flagged", () => {
  const film = filmOf(D1);
  const k = film.scenes[0].id;
  film.drafts[k] = { ...film.drafts[k], importedBlocks:film.drafts[k].blocks.slice() };
  const m = J(SI.matchDraft(film, SI.parseFountain(D2)));
  assert.equal(m.rows.find(r => r.oldId === k).editedHere, true);
  // an unchanged scene is never flagged, even when it was edited here
  const b = film.scenes[2].id;
  film.drafts[b] = { ...film.drafts[b], importedBlocks:[] };
  const m2 = J(SI.matchDraft(film, SI.parseFountain(D2)));
  assert.equal(m2.rows.find(r => r.oldId === b).editedHere, false);
});

const ui = read("app/script-import-ui.jsx");
test("E  the window in draft mode: statuses, the choice, the rights box, nothing charged yet", () => {
  assert.match(ui, /function ScriptImportWindow\(\{[^}]*existing[^}]*onApplyDraft/);
  assert.match(ui, /"Import a new draft"/);
  assert.match(ui, /what changed \\u2014 nothing is charged yet|what changed — nothing is charged yet/);
  for (const s of ["Unchanged", "Revised", "New", "Not in the new draft"]) assert.ok(ui.includes('"' + s + '"'), s);
  assert.match(ui, /si-status/);
  assert.match(ui, /si-choice/);
  assert.match(ui, /also changed in Kinolot/);
  assert.match(ui, /I wrote this script or have the rights to use it/);
  assert.match(ui, /onApplyDraft\(\{\s*parsed[^}]*match:\s*m[^}]*removeMissing[^}]*fileName/);
  assert.match(ui, /SI\.matchDraft\(|ScriptImport\.matchDraft\(/);
});

const app = read("app/app.jsx");
test("F  applyNewDraft: Undo snapshot, revised scenes unread via commitVersion, new scenes + cast, acts in order", () => {
  const i = app.indexOf("const applyNewDraft = async"), j = app.indexOf("const removeNotInDraft = async");
  assert.ok(i > 0 && j > i);
  const f = app.slice(i, j);
  assert.match(f, /label:"New draft"/);
  assert.match(f, /setAgentUndo\(stk=>\[\.\.\.stk, snap\]/);
  assert.match(f, /unread:true, revisedAt:at/);
  assert.match(f, /commitVersion\(rv\.id/);
  assert.match(f, /importedBlocks:undefined/);
  assert.match(f, /imported:\{ at, file:fileName\|\|"", draft:draftNo \}/);
  assert.match(f, /addCast\.push/);
  assert.match(f, /notInDraft:true/);
  assert.match(f, /removeMissing/);
  assert.match(f, /Number\(x\.act\) < Number\(list\[i-1\]\.act\)/, "acts never run backwards");
  assert.match(f, /drafts:draftNo/);
  assert.match(f, /importStripHidden:false/);
  assert.match(f, /setScriptReadOffer\(/, "the read is offered for what changed");
  assert.match(f, /canMutateWritersRoom\(\)/);
  // the imported words are the new draft's words, verbatim (no model in the apply)
  assert.doesNotMatch(f, /window\.claude|aiComplete|complete\(/);
});

test("F  the scenes the draft lacks: kept and marked until removed; Remove asks first and is undoable", () => {
  const i = app.indexOf("const removeNotInDraft = async");
  const f = app.slice(i, i + 2200);
  assert.match(f, /appConfirm/);
  assert.match(f, /filter\(x=>!x\.notInDraft\)/);
  assert.match(f, /setAgentUndo/);
  assert.match(app, /onClick:removeNotInDraft\},"Remove "\+\(goneN!==1\?"them":"it"\)/);
  assert.match(app, /onClick:\(\)=>startDraftImport\(\)/);
  assert.match(app, /onApplyDraft: scriptImportMode==="draft"/);
  assert.match(app, /onImportDraft: scenes\.length \?/);
  const spine = read("app/spine.jsx");
  assert.match(spine, /s\.notInDraft && React\.createElement\("span",\{className:"stile-mark gone"/);
  assert.match(spine, /"Not in draft"\)/);
  const css = read("app/styles.css");
  assert.match(css, /\.stile-mark\.gone/);
  assert.match(css, /\.si-status/);
});

test("F  the Film menu has both imports", () => {
  const chrome = read("app/chrome.jsx");
  assert.match(chrome, /function OverflowMenu\(\{[^}]*onImportScript, onImportDraft/);
  assert.match(chrome, /"Import a screenplay"/);
  assert.match(chrome, /"Import a new draft"/);
  assert.match(chrome, /function TopBar\(\{[^}]*onImportScript, onImportDraft/);
});

test("F  Frances knows about a new draft (file types only, no app names)", () => {
  const ai = read("app/ai.jsx");
  const k = ai.indexOf("Import a new draft");
  assert.ok(k > 0, "APP_FEATURES mentions Import a new draft");
  const line = ai.slice(ai.lastIndexOf("\n", k), ai.indexOf("\n", k));
  assert.doesNotMatch(line, /Final Draft|Highland|WriterDuet|Celtx|Fade In/);
});

test("F  cache keys: every changed file is loaded with a key", () => {
  const html = read("TURN.html");
  for (const f of ["app.jsx", "chrome.jsx", "script-import.js", "script-import-ui.jsx", "spine.jsx", "styles.css"])
    assert.ok(["20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k => html.includes(f + '?v=' + k + '"')), f);
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

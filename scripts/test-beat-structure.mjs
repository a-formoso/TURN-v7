#!/usr/bin/env node
/* test-beat-structure.mjs — BEATS KEEP THEIR WORK and ADDING SCENES (owner 2026-10-19, "yes, go ahead with all five").
   Every room points at a beat by its NUMBER (the screenplay's block.beat, the shots' beatN → storyboards, the Stage).

     A  beatRemap / beatRemapBlocks / beatRemapShots (app/scene-order.js): a beat deleted (its lines and shots fold into
        the beat before, marked), restored (they come back), moved (lines re-ordered with it, shots on the new number),
        inserted (the later beats move down one); other scenes untouched; nothing changes when nothing moved; a map with
        no shared ids (a Rebuild from the script) moves nothing
     B  a moved beat's approved art stays current: the shot's fingerprint keeps the number it was made under
        (specBeatN), the screenplay's revision ignores the beat number; a hand edit of a shot's beat is a real change
     C  "Script out of date" knows the beats: a snapshot with beats flags a beat added / removed / moved / rewritten; a
        snapshot from before (no beats) is never flagged for them; Write this beat settles them
     D  the Beats tab: Insert below, and every shape change (add / insert / delete / restore / move) goes through
        setBeatsStructured, which re-keys the draft (a version) and the shots (when this person may change them); text
        edits and a Rebuild don't; the Shots tab marks shots from a deleted beat
     E  adding a scene: Add before / Add after, an empty heading (no stray "New Location" card, and the old placeholder
        is skipped), the protagonist as driver, Undo for an untouched scene; a recast keeps the beats' ids (the turning
        point stays); Frances knows

   node scripts/test-beat-structure.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console }; box.window = box; vm.createContext(box);
vm.runInContext(read("app/scene-order.js"), box);
const B = box;
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const ROWS = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, n:i + 1, drive:{ a:"Act", d:"drive " + id }, react:{ a:"React", d:"react " + id } }));
const BLOCKS = [1, 1, 2, 3, 3, 4, 5].map((beat, i) => ({ beat, type:i ? "action" : "scene", text:"line " + i }));
const SHOTS = [{ id:"x3", sceneId:"S", beatN:3 }, { id:"x5", sceneId:"S", beatN:5 }, { id:"y3", sceneId:"T", beatN:3 }];
const renum = (rows) => rows.map((r, i) => ({ ...r, n:i + 1 }));

test("A  a deleted beat: its lines and shots fold into the beat before, marked; later beats move up", () => {
  const after = renum(ROWS.filter(r => r.id !== "c"));
  const R = B.beatRemap(ROWS, after);
  assert.deepEqual(J(R.map), { 1:1, 2:2, 3:2, 4:3, 5:4 });
  assert.deepEqual(J(R.removed), { 3:{ id:"c", to:2 } });
  assert.equal(R.identity, false);
  const blocks = J(B.beatRemapBlocks(BLOCKS, R));
  assert.deepEqual(blocks.map(b => b.beat), [1, 1, 2, 2, 2, 3, 4]);
  assert.deepEqual(blocks.filter(b => b.wasBeatId).map(b => b.text), ["line 3", "line 4"]);
  assert.deepEqual(blocks.map(b => b.text), BLOCKS.map(b => b.text), "the words and their order are unchanged");
  const shots = J(B.beatRemapShots(SHOTS, "S", R, "T0"));
  assert.deepEqual(shots[0], { id:"x3", sceneId:"S", beatN:2, specBeatN:3, beatRemoved:{ id:"c", was:3, at:"T0" } });
  assert.deepEqual(shots[1], { id:"x5", sceneId:"S", beatN:4, specBeatN:5 });
  assert.deepEqual(shots[2], SHOTS[2], "another scene's shots are untouched");
});

test("A  restoring the deleted beat gives its lines and shots back", () => {
  const after = renum(ROWS.filter(r => r.id !== "c"));
  const R = B.beatRemap(ROWS, after);
  const blocks = B.beatRemapBlocks(BLOCKS, R), shots = B.beatRemapShots(SHOTS, "S", R, "T0");
  const restored = after.slice(); restored.splice(2, 0, ROWS[2]);
  const R2 = B.beatRemap(after, renum(restored));
  assert.deepEqual(J(B.beatRemapBlocks(blocks, R2)), BLOCKS);
  const back = J(B.beatRemapShots(shots, "S", R2));
  assert.equal(back[0].beatN, 3); assert.equal(back[0].beatRemoved, undefined);
  assert.equal(back[1].beatN, 5);
});

test("A  a moved beat takes its lines with it; an inserted beat moves the later ones down", () => {
  const moved = renum([ROWS[0], ROWS[4], ROWS[1], ROWS[2], ROWS[3]]);
  const R = B.beatRemap(ROWS, moved);
  assert.deepEqual(J(R.map), { 1:1, 2:3, 3:4, 4:5, 5:2 });
  assert.deepEqual(J(B.beatRemapBlocks(BLOCKS, R)).map(b => b.beat + ":" + b.text),
    ["1:line 0", "1:line 1", "2:line 6", "3:line 2", "4:line 3", "4:line 4", "5:line 5"]);
  assert.deepEqual(J(B.beatRemapShots(SHOTS, "S", R)).map(s => s.beatN), [4, 2, 3]);
  const ins = renum([ROWS[0], ROWS[1], { id:"new", drive:{ d:"" }, react:{ d:"" } }, ROWS[2], ROWS[3], ROWS[4]]);
  const R2 = B.beatRemap(ROWS, ins);
  assert.deepEqual(J(B.beatRemapBlocks(BLOCKS, R2)).map(b => b.beat), [1, 1, 2, 4, 4, 5, 6]);
  assert.deepEqual(J(B.beatRemapShots(SHOTS, "S", R2)).map(s => s.beatN), [4, 6, 3]);
});

test("A  nothing moved → the same objects back; a map with no shared ids (a Rebuild) moves nothing", () => {
  const R = B.beatRemap(ROWS, ROWS.map(r => ({ ...r })));
  assert.equal(R.identity, true);
  assert.equal(B.beatRemapBlocks(BLOCKS, R), BLOCKS);
  assert.equal(B.beatRemapShots(SHOTS, "S", R), SHOTS);
  const fresh = renum(["p", "q", "r"].map(id => ({ id })));
  const R2 = B.beatRemap(ROWS, fresh);
  assert.deepEqual(J(R2.map), {});
  assert.equal(B.beatRemapBlocks(BLOCKS, R2), BLOCKS);
  assert.equal(B.beatRemapShots(SHOTS, "S", R2), SHOTS);
});

test("B  a moved beat's approved frames and takes stay current; a hand edit of the beat is a change", () => {
  const draft = { blocks:BLOCKS };
  const shot = { id:"x5", sceneId:"S", beatN:5, size:"wide", specRev:3 };
  const stampBefore = J(B.shotSourceStamp(shot, draft));
  const moved = renum([ROWS[0], ROWS[4], ROWS[1], ROWS[2], ROWS[3]]);
  const R = B.beatRemap(ROWS, moved);
  const shot2 = J(B.beatRemapShots([shot], "S", R))[0];
  const draft2 = { blocks:B.beatRemapBlocks(BLOCKS, R) };
  assert.equal(shot2.beatN, 2);
  assert.deepEqual(J(B.shotSourceStamp(shot2, draft2)), stampBefore, "same spec, same screenplay revision");
  const hand = { ...shot2, beatN:3 }; delete hand.specBeatN;
  assert.notEqual(B.shotSpecFingerprint(hand), stampBefore.specHash);
  const app = read("app/app.jsx");
  assert.match(app, /if\(patch && Object\.prototype\.hasOwnProperty\.call\(patch,"beatN"\)\) delete next\.specBeatN;/);
});

/* sceneCardSnap / cardChanges from ai.jsx, run on their own */
const ai = read("app/ai.jsx");
const slice = (from, to) => { const a = ai.indexOf(from), b = ai.indexOf(to, a); assert.ok(a > 0 && b > a, from); return ai.slice(a, b); };
const cbox = { console, window:{ beatMapSignature:B.beatMapSignature }, sceneValueAxis:() => null, sceneReactorOf:() => null };
vm.createContext(cbox);
vm.runInContext(slice("function psychKeyOf(", "/* what changed on the card since the draft") + slice("function cardChanges(", "\n}\n") + "\n}\nthis.sceneCardSnap=sceneCardSnap;this.cardChanges=cardChanges;", cbox);
test("C  the script's card snapshot knows the beats; an older snapshot is never flagged for them", () => {
  const scene = { id:"S", title:"T", act:1 };
  const map = { rows:ROWS };
  const snap = cbox.sceneCardSnap(scene, [], map);
  assert.equal(snap.beats, B.beatMapSignature(map));
  assert.deepEqual(J(cbox.cardChanges(snap, cbox.sceneCardSnap(scene, [], map))), []);
  const moved = { rows:renum([ROWS[1], ROWS[0], ...ROWS.slice(2)]) };
  assert.deepEqual(J(cbox.cardChanges(snap, cbox.sceneCardSnap(scene, [], moved))), ["beats"]);
  const rewritten = { rows:ROWS.map((r, i) => i === 2 ? { ...r, drive:{ ...r.drive, d:"changed" } } : r) };
  assert.deepEqual(J(cbox.cardChanges(snap, cbox.sceneCardSnap(scene, [], rewritten))), ["beats"]);
  const old = { ...snap }; delete old.beats;
  assert.deepEqual(J(cbox.cardChanges(old, cbox.sceneCardSnap(scene, [], moved))), [], "a draft snapped before beats were known");
  assert.match(read("app/script.jsx"), /cardSnap:\{ \.\.\.latest\.cardSnap, beats:window\.beatMapSignature\(beats\) \}/, "Write this beat settles them");
});

const insp = read("app/inspector.jsx"), app = read("app/app.jsx");
test("D  the Beats tab: Insert below; every shape change goes through setBeatsStructured, text edits don't", () => {
  assert.match(insp, /const insertBeat = \(i\)=>\{ const rows = beats\.rows\.slice\(\); rows\.splice\(i\+1, 0, newBeatRow\(\)\);/);
  assert.match(insp, /onClick:\(\)=>insertBeat\(i\),\n\s+"aria-label":"Insert a beat after beat "\+r\.n/);
  for (const fn of ["addBeat", "insertBeat", "delBeat", "undoDelete", "moveBeat"]) {
    const i = insp.indexOf("const " + fn + " = "), j = insp.indexOf("\n  const ", i + 10);
    assert.match(insp.slice(i, j), /commitShape\(/, fn);
  }
  assert.match(insp, /const setCell = \(i,side,field,val\)=>commit\(/, "a text edit is not a shape change");
  assert.match(insp, /\(onBeatsStructure\|\|onBeats\)\(id,next\)/);
  assert.match(app, /onBeats:setBeatsFor,onBeatsStructure:setBeatsStructured,/);
  const k = app.indexOf("const setBeatsStructured = (sceneId,next)=>{");
  const f = app.slice(k, app.indexOf("const setBeatsFor = ", k));
  assert.match(f, /window\.beatRemap\(before\.rows, identified\.rows\)/);
  assert.match(f, /if\(nb!==d\.blocks\) commitVersion\(sceneId, \{ \.\.\.d, blocks:nb \}\);/);
  assert.match(f, /!shotsReadOnlyRef\.current && !shotsStageOnlyRef\.current/);
  assert.match(f, /setShots\(ss=>window\.beatRemapShots\(ss, sceneId, R, at\)\)/);
  assert.match(read("app/shots-ui.jsx"), /L\.shots\.some\(x=>x&&x\.beatRemoved\) && _el\("span",\{className:"beat-lane-gone"/);
  // (2026-10-20, "can't find the Undo") the restore in a toast and in the deleted beat's own place
  assert.match(insp, /window\.appToast\("Beat "\+\(i\+1\)\+" deleted/);
  assert.match(insp, /onClick:\(\)=>\{ if\(undoRef\.current\) undoRef\.current\(\); \}/);
  assert.match(insp, /\(lastDeleted && lastDeleted\.index===i\) \? restoreInline\(i\) : null/);
  assert.match(insp, /\(lastDeleted && lastDeleted\.index>=beats\.rows\.length\) \? restoreInline\("end"\) : null/);
});

test("E  adding a scene: before or after, no placeholder heading, the protagonist, Undo; the old placeholder isn't a place", () => {
  const k = app.indexOf("const addScene = (refId, opts)=>{");
  const f = app.slice(k, app.indexOf("\n  };\n", k));
  assert.match(f, /const at = i<0 \? ss\.length : \(before \? i : i\+1\);/);
  assert.match(f, /loc:"",/);
  assert.doesNotMatch(f, /NEW LOCATION/);
  assert.match(f, /const defDriver = \(protag && protag\.id\) \|\| \(ref && ref\.driver\) \|\| "lead";/);
  assert.match(f, /action:\{ label:"Undo"/);
  assert.match(f, /That scene has a script or shots now/);
  assert.match(insp, /onClick:\(\)=>onAddScene\(scene\.id,\{before:true\}\)/);
  assert.match(insp, /"Add before"\)/);
  assert.match(read("app/locations.jsx"), /if\(\/\^new location\$\/i\.test\(String\(primary\|\|""\)\.trim\(\)\)\) return;/);
});

test("E  a recast keeps the beats' ids (the turning point stays); Frances knows", () => {
  assert.match(app, /id:\(cur\.rows && cur\.rows\[i\] && cur\.rows\[i\]\.id\) \|\| r\.id/);
  assert.match(app, /\[sceneId\]:\(typeof withBeatIdentity==="function"\) \? withBeatIdentity\(next, sceneId\) : next/);
  assert.match(ai, /INSERT one below any beat with its \+/);
  assert.match(ai, /THE WORK FOLLOWS ITS BEAT/);
  assert.match(ai, /name:"Adding a scene"/);
  const html = read("TURN.html");
  for (const f of ["scene-order.js", "inspector.jsx", "app.jsx", "shots-ui.jsx", "locations.jsx", "ai.jsx"])
    assert.ok(["20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(v => html.includes(f + "?v=" + v + '"')), f);
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

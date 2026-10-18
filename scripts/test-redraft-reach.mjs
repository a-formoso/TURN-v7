#!/usr/bin/env node
/* test-redraft-reach.mjs — a script redraft reaches the other rooms (owner 2026-10-18: "Redraft script from beats:
   are the changes in the script reflected in the other rooms?" → "yes, fix all 5").

     A  props: a reviewed passage is found wherever it now sits in the scene (a redraft renumbers the blocks); spacing
        and curly quotes don't count; a passage the script lost fails — and the card says so on its closed section
     B  shots: shotLiveText reads a shot's action and line against the CURRENT draft (a revised line is followed, a lost
        one is said to be gone, a hand-written Action and another shot's own staging are kept); the shot row, the
        printed shot list and the storyboard captions / briefs use it
     C  the Stage: the scene's Voices list and the Mix check a voiced line against the words the clips speak now
     D  the Storyboards page recounts its frames when the script changes; the Breakdown says its clip count is behind
        once a redraft changed the scene since the last Stage visit
     E  location plates made from the script (coverage pages, state and slugline units) record its text and say
        "Script changed" afterwards; an edit keeps the one the plate was made with

   node scripts/test-redraft-reach.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const sandbox = { window: {}, console };
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(read("app/shot-screenplay.js"), sandbox);
vm.runInContext(read("app/prop-screenplay.js"), sandbox);
const PS = sandbox.PropScreenplay;

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const before = { s1:{ blocks:[
  { type:"scene", text:"INT. BUS - NIGHT", beat:1 },
  { type:"action", text:"Tomasz slides the gas bill out from under the paperweight.", beat:1 },
  { type:"char", text:"TOMASZ", beat:1 },
  { type:"dia", text:"Go home, mate. Nobody here needs you tonight.", beat:1 } ] } };
// the redraft adds a line before the passage and revises the dialogue
const after = { s1:{ blocks:[
  { type:"scene", text:"INT. BUS - NIGHT", beat:1 },
  { type:"action", text:"Rain hammers the windscreen.", beat:1 },
  { type:"action", text:"Tomasz  slides the gas bill out from under the paperweight.", beat:1 },
  { type:"char", text:"TOMASZ", beat:1 },
  { type:"dia", text:"Go home, mate. Nobody on this bus needs you tonight.", beat:1 } ] } };
const src = { sceneId:"s1", block:2, quote:"slides the gas bill out from under the paperweight", presence:"handled" };

test("A a reviewed passage is found where it now sits; a lost one fails; the card says so when closed", () => {
  assert.equal(PS.locate(src, before), 2);
  assert.equal(PS.locate(src, after), 3, "moved one block down (double space ignored)");
  assert.equal(PS.sourceValid(src, after), true);
  const [moved] = PS.sources({ screenplaySources:[src] }, after);
  assert.equal(moved.block, 3, "sources() reports the block it sits in now");
  assert.equal(JSON.stringify(PS.scenesFor({ screenplaySources:[src] }, after)), '["s1"]', "the prop keeps its scene");
  assert.equal(PS.sourceValid({ ...src, quote:"“Go home, mate.”".slice(1, -1) }, after), true);
  const gone = { s1:{ blocks:[{ type:"action", text:"Tomasz pockets the bill.", beat:1 }] } };
  assert.equal(PS.sourceValid(src, gone), false);
  assert.equal(PS.scenesFor({ screenplaySources:[src] }, gone).length, 0);
  const props = read("app/props.jsx");
  assert.ok(props.includes('" source"+(savedSources.length-validSources.length!==1?"s":"")+" changed"'), "a pill on the closed evidence row");
});

test("B shotLiveText follows the current draft; the row, the print and the storyboards use it", () => {
  const scene = { id:"s1", no:1 }, ctx = { drafts:after, characters:[{ id:"c1", name:"Tomasz" }] };
  const open = sandbox.shotLiveText(scene, { beatN:1, keyframeMode:"beat-opening", action:"old", dialogue:"Go home, mate. Nobody here needs you tonight." }, ctx);
  assert.equal(open.action, "Rain hammers the windscreen.", "a beat-opening shot shows the screenplay's opening action");
  assert.equal(open.dialogue, "Go home, mate. Nobody on this bus needs you tonight.");
  assert.ok(open.dialogueChanged && !open.dialogueGone);
  const own = sandbox.shotLiveText(scene, { beatN:1, action:"his own staging", dialogue:"" }, ctx);
  assert.equal(own.action, "his own staging", "other shots keep their own staging");
  assert.equal(own.dialogue, "", "never invents a line");
  const hand = sandbox.shotLiveText(scene, { beatN:1, keyframeMode:"beat-opening", actionByHand:true, action:"mine" }, ctx);
  assert.equal(hand.action, "mine", "a hand-written Action wins");
  const lost = sandbox.shotLiveText(scene, { beatN:1, dialogue:"Completely unrelated words here" }, ctx);
  assert.ok(lost.dialogueGone && lost.dialogue === "Completely unrelated words here", "a lost line keeps its words and says so");
  const ui = read("app/shots-ui.jsx"), sb = read("app/storyboard.jsx");
  assert.ok(ui.includes("String((liveText ? liveText.action : sh.action)||\"\")") && ui.includes("liveText:(typeof window.shotLiveText===\"function\") ? window.shotLiveText(scene, sh) : null"));
  assert.ok(ui.includes("esc(lt.action||\"\")+(lt.dialogue?"), "the printed shot list");
  assert.ok(sb.includes("let action = (lt.action||\"\")") && sb.includes("const dlg = (lt.dialogue||\"\")"), "the panel captions");
  assert.ok(sb.includes("lt.action && _sbEl(\"div\",{className:\"sb-brief-line\"}") && sb.includes("\u00b7 no longer in the script"), "the briefs");
});

test("C the Stage's Voices list and the Mix check voiced lines against the words the clips speak now", () => {
  const stage = read("app/stage.jsx");
  assert.ok(stage.includes("const sh = liveLines[sh0.id] || (clipsKnowLines ? null : sh0);"), "the Voices list");
  assert.ok(stage.includes("const live = liveOf(sh);") && stage.includes("text:String(((live||sh).dialogue)||\"\").trim() });"), "the Mix placements");
  assert.ok(stage.includes("The screenplay no longer has this line"), "a lost line is not playable");
});

test("D the Storyboards page recounts on a redraft; the Breakdown says its clip count is behind", () => {
  const a = sandbox.screenplayDraftSig(before.s1), b = sandbox.screenplayDraftSig(after.s1);
  assert.ok(a && b && a !== b, "a redraft changes the signature");
  assert.equal(sandbox.screenplayDraftSig(JSON.parse(JSON.stringify(before.s1))), a, "same text, same signature");
  const sb = read("app/storyboard.jsx"), bd = read("app/breakdown.jsx"), stage = read("app/stage.jsx");
  assert.ok(sb.includes(".join(\",\"), sbDraftSig(scene),   // a redraft"), "the health count's dependencies");
  assert.ok(stage.includes("out[sid].scriptSig = ") && stage.includes("[stageStatusSig, stageFilmKey(project), vidsLoaded, draftSig]"), "the Stage saves each scene's script with its counts");
  assert.ok(bd.includes("const scriptChanged = !!(clips0 && clips0.scriptSig && scriptNow && clips0.scriptSig!==scriptNow);"));
  assert.ok(bd.includes("Script changed since your last Stage visit \\u2014 open the Stage to recount"));
  assert.ok(bd.includes("return !!c && !c.scriptChanged &&"), "never shown as done");
});

test("E location plates made from the script record it and say Script changed", () => {
  const loc = read("app/locations-ui.jsx");
  assert.ok(loc.includes('"Script changed")'));
  assert.ok(loc.includes("const ss = mode===\"edit\" ? (gen && gen.genMeta && gen.genMeta.plateScriptSig) : scriptSig;"), "an edit keeps the one it was made with");
  assert.ok(loc.includes('"screenplay-coverage")), _coverScriptSig),') && loc.includes("_parentChangedBadge(gen, l, _coverScriptSig)"), "coverage pages");
  assert.ok(loc.includes('"continuity-state")), stateUnit ? _plateScriptSig(stateUnit.scriptText) : "")),'), "state units");
  assert.ok(loc.includes('"slugline-unit")), _plateScriptSig(u.scriptText))),') && loc.includes("_parentChangedBadge(gen, l, _plateScriptSig(u.scriptText))"), "slugline units");
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS all ${checks}`);
process.exit(failed ? 1 : 0);

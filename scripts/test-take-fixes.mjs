#!/usr/bin/env node
/* From a viral short drama's making-of (owner 2026-10-27, "go ahead with 1, 2, 3 and 4"):
   1 FIX THIS TAKE — notes on a take rewrite the clip's prompt (ai.jsx aiFixTakePrompt, stage.jsx StageFixTake); the
     rewrite keeps every @reference, refuses to drop or invent one, and lands as an edit with Undo;
   2 character sheets on a plain mid-grey background, whatever the render style;
   3 an accent saved as a name gets its telltale sounds (voices-ui.jsx vcAccentSound);
   4 staging lines in every clip's PERFORMANCE section (tested with the brief in test-stage-director-brief.mjs).
   Run: node scripts/test-take-fixes.mjs (no browser, no network) */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ai = readFileSync("app/ai.jsx", "utf8"), stage = readFileSync("app/stage.jsx", "utf8"), art = readFileSync("app/artroom.jsx", "utf8");
const voices = readFileSync("app/voices-ui.jsx", "utf8"), html = readFileSync("TURN.html", "utf8");
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("PASS " + name); };
const slice = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b));

// 1. the rewrite, with a stand-in writing model
const box = { console }; box.window = box; vm.createContext(box);
vm.runInContext("function aiAvailable(){ return true; } function extractJSON(t){ try{ return JSON.parse(t); }catch(e){ return null; } }"
  + slice(ai, "async function aiFixTakePrompt", "window.aiFixTakePrompt") + "\nwindow.aiFixTakePrompt=aiFixTakePrompt;", box);
const PROMPT = "BEAT CONTRACT\nScene 1 · Beat 1\n\nACTIVE REFERENCES\n@Image1 is the first frame.\n@Image2 is Lucy.\n\nACTION AND CAMERA PLAN\nThe model falls on the runway.\n\nDIALOGUE AND SOUND\nRAPHAEL: “Next.”";
let asked = "";
const answer = (obj) => { box.claude = { complete: async ({ messages }) => { asked = messages[0].content; return JSON.stringify(obj); } }; };
await t("Fix this take rewrites from the notes and reports what changed", async () => {
  const fixed = PROMPT.replace("The model falls on the runway.", "The model's heel catches; she pitches forward onto both palms, knees hitting the boards. Six models wait along the runway.");
  answer({ prompt: fixed, changes: ["The fall is a real stumble onto her palms", "Six models wait along the runway"] });
  const r = await box.aiFixTakePrompt(PROMPT, "The fall looks fake. Add models waiting. Keep the acting and camera.", { maxChars: 12000 });
  assert.equal(r.prompt, fixed); assert.deepEqual(Array.from(r.changes), ["The fall is a real stumble onto her palms", "Six models wait along the runway"]);
  assert.ok(asked.includes("DIRECTOR'S NOTES ON THE TAKE: The fall looks fake. Add models waiting. Keep the acting and camera."));
  assert.ok(asked.includes("Change ONLY what the notes ask for") && asked.includes("the dialogue's exact words") && asked.includes("describe how it sounds"));
});
await t("…and refuses a rewrite that drops or invents a reference, changes nothing, or has no notes", async () => {
  answer({ prompt: PROMPT.replace("@Image2 is Lucy.\n", ""), changes: [] });
  assert.match((await box.aiFixTakePrompt(PROMPT, "make the fall real")).error, /dropped @Image2; nothing was changed/);
  answer({ prompt: PROMPT + "\n@Image7 is a crowd.", changes: [] });
  assert.match((await box.aiFixTakePrompt(PROMPT, "add a crowd")).error, /doesn't have \(@Image7\)/);
  answer({ prompt: PROMPT, changes: [] });
  assert.match((await box.aiFixTakePrompt(PROMPT, "make it better")).error, /didn't change anything/);
  assert.match((await box.aiFixTakePrompt(PROMPT, "x")).error, /what's wrong/);
  assert.match((await box.aiFixTakePrompt("", "the fall looks fake")).error, /no prompt/);
});
await t("the Stage shows Fix this take under the prompt once the clip has a take; the rewrite lands as an edit", () => {
  // (2026-10-27) the key also carries a fix sent from Takes, and that one runs on its own
  assert.ok(stage.includes('!readOnly && createTask==="reference" && !!playerUrl && _stEl(StageFixTake,{ key:"fix-"+clip.id+(fixRequest?"-"+fixRequest.n:""), prompt, maxChars:PANEL_PROMPT_MAX,'));
  assert.ok(stage.includes('disabled:gening, onApply:(t)=>onPromptChange(t,0),\n      initialNotes:fixRequest?fixRequest.notes:"", autoRun:!!fixRequest })'));
  const comp = slice(stage, "function StageFixTake(", "/* CHOOSE DURATION");
  assert.ok(comp.includes('"Rewrite the prompt"') && comp.includes('onApply(done.before)') && comp.includes("nothing is rendered until you press Regenerate"));
});
await t("Takes has Fix this take too: its notes open Shoot, where the clip's prompt is rewritten", () => {
  const vers = slice(stage, "function StageVersionsView(", "window.StageView");
  assert.ok(vers.includes('"data-testid":"takes-fix-take"') && vers.includes('"Fix this take\\u2026"'));
  assert.ok(vers.includes("onNotesOnly:(notes)=>{ setFixOpen(false); onFixTake(notes); }"));
  assert.ok(stage.includes("onFixTake:(notes)=>{ setPendingReuse({ clipId:clip.id, fixNotes:notes }); setStageView(\"stage\"); }"));
  assert.ok(stage.includes("if(pendingReuse.fixNotes){\n      setComposerTab(\"create\"); setCreateTask(\"reference\");\n      setFixRequest({ notes:pendingReuse.fixNotes, n:Date.now() });"));
  const comp = slice(stage, "function StageFixTake(", "/* CHOOSE DURATION");
  assert.ok(comp.includes("if(autoRef.current){ autoRef.current=false; run(); }") && comp.includes("if(onNotesOnly){ if(notes.trim().length>=4) onNotesOnly(notes.trim()); } else run();"));
  assert.ok(ai.includes("and in Takes beside Reuse settings and Branch from this take"));
});
// 2. grey sheets
await t("every character sheet is on plain mid-grey, overriding the render style's background", () => {
  assert.ok(art.includes('const CHAR_SHEET_BACKGROUND = "plain solid mid-grey studio background (neither white nor black)'));
  assert.ok(art.includes("      background: CHAR_SHEET_BACKGROUND\n") && art.includes("render: { ..._rb, background: CHAR_SHEET_BACKGROUND, rules: _rules"));
  assert.ok(slice(art, "function buildRefFromPhotoPrompt", "window.buildRefFromPhotoPrompt").includes("CHAR_SHEET_BACKGROUND.charAt(0).toUpperCase()"));
});
// 3. accents
await t("an accent saved as a name gets its telltale sounds; one already described by sound is left alone", () => {
  const b = {}; b.window = b; vm.createContext(b);
  vm.runInContext(slice(voices, "const VC_ACCENT_SOUNDS", "window.vcAccentSound") + "\nwindow.vcAccentSound=vcAccentSound;", b);
  assert.equal(b.vcAccentSound("speaks English with a noticeable French accent"),
    "speaks English with a noticeable French accent: soft uvular R made at the back of the throat, a dropped H, short pure vowels, stress falling at the end of each phrase");
  assert.match(b.vcAccentSound("light Tuscan Italian accent"), /: a tapped or rolled R/);
  assert.equal(b.vcAccentSound("French accent: soft uvular R"), "French accent: soft uvular R");
  assert.equal(b.vcAccentSound("neutral American"), "neutral American");
  assert.equal(b.vcAccentSound("a Klingon accent"), "a Klingon accent");
  assert.ok(voices.includes("? vcAccentSound(/\\baccent|dialect|speaks\\b/i.test(origin)"));
  assert.ok(stage.includes("t=[acc&&sound(/accent|dialect|speaks/i.test(acc)?acc:acc+\" accent\"),v.pitch,v.pace,v.quirks]"));
  assert.ok(ai.includes("name it as SOUND and spell out one or two of its telltale sounds"));
});
await t("Frances knows; the files are re-keyed", () => {
  assert.ok(ai.includes("FIX THIS TAKE (2026-10-27)") && ai.includes("CHARACTER SHEETS ON GREY (2026-10-27)") && ai.includes("ACCENTS BY THEIR SOUNDS (2026-10-27)") && ai.includes("STAGING IN THE STAGE PROMPT (2026-10-27)"));
  ["stage.jsx", "stage-director-brief.js", "voices-ui.jsx", "artroom.jsx", "ai.jsx"].forEach(f => assert.ok(["20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k => html.includes("app/" + f + "?v=" + k + '"')), f));
});
console.log(n + " passed, 0 failed");

#!/usr/bin/env node
/* test-script-import-launch.mjs — BRING YOUR OWN SCRIPT, phase 3: the ways in (owner 2026-10-18; docs/Script Import
   Plan.md). Source-level checks of the public launch.

     A  public: New Story's "I have a script" on every account (never inside a Show's episode); an import always makes
        its own film (never an episode of the open Show)
     B  the ways in: the empty Writers' Room, Home's "Import a script", a script file dropped on the Writers' Room or
        Home (an element with its own drop zone keeps its drop; a file that isn't a script is left alone)
     C  the landing: each room card offers "Start with your script" / "Start from an idea", carried through sign-up
        (a day at most) into Import your script or New Story; step 01 says a screenplay can come in
     D  What next after a read: the Art Room, the Stage (honestly: shots first, in the Art Room's Shots) or the Story
        Editors — the room the landing card was chosen for first
     E  Frances knows the flow and names no other company's product; the Terms and Privacy say what happens to an
        imported screenplay (dated 18 October 2026)

   node scripts/test-script-import-launch.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const app = read("app/app.jsx"), ui = read("app/script-import-ui.jsx"), home = read("app/home-dashboard.jsx"), lp = read("app/landing.jsx"),
  ai = read("app/ai.jsx"), terms = read("terms.html"), privacy = read("privacy.html");

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

test("A public, and always its own film", () => {
  assert.ok(app.includes("onImportScript:!newStoryBuildsCurrentEpisode ? (()=>{ setNewStoryOpen(false); setScriptImportOpen(true); }) : undefined"));
  assert.ok(!app.includes("onImportScript:(isAdmin"), "no admin gate left");
  assert.ok(app.includes("(scenes.length || !currentProjectId || currentShowId)"), "an episode is never filled in place");
});

test("B the empty Writers' Room, Home and a dropped file", () => {
  assert.ok(app.includes('"Import a screenplay")),') && app.includes("Or drop a Fountain, Final Draft, Highland, PDF, Word or text file anywhere on this page."));
  assert.ok(app.includes("onImportScript: ()=>{ setHomeOpen(false); setRoom(\"writers\"); setView(\"spine\"); startScriptImport(); },"));
  assert.ok(home.includes('typeof onImportScript==="function" && h("button",{className:"hd-tbtn hd-import"'));
  assert.ok(app.includes("(room===\"writers\" || homeOpen) && !scriptImportOpen && !newStoryOpen"), "the Writers' Room or Home only");
  assert.ok(app.includes("if(!hasFiles(e) || e.defaultPrevented) return;"), "an element's own drop zone keeps its drop");
  assert.ok(app.includes("if(!isScript(f)) return;   // not a script: left to the page"));
  // (phase 6: several dropped files arrive as a list — episodes)
  assert.ok(ui.includes("React.useEffect(()=>{ if(initialFile) (Array.isArray(initialFile) ? readFiles(initialFile) : readFile(initialFile)); },[initialFile]);"), "the dropped file arrives chosen");
});

test("C the landing's start choice, carried through sign-up", () => {
  assert.ok(lp.includes('"Start with your script"') && lp.includes('"Start from an idea"'));
  assert.ok(lp.includes("onStart(f.plan,{ mode:\"script\", room:f.room })") && lp.includes("onStart(f.plan,{ mode:\"idea\", room:f.room })"));
  assert.ok(app.includes('localStorage.setItem("turn-intended-start", JSON.stringify({ mode:start.mode, room:String(start.room||"writers"), at:Date.now() }))'));
  assert.ok(app.includes("if(!(Date.now() - Number(intent.at||0) < 86400000)) return;   // a day at most"));
  assert.ok(app.includes("if(intent.mode===\"script\") startScriptImport(); else startNewStory();"));
  assert.ok(lp.includes("or a finished screenplay, imported word for word."));
});

test("D What next after a read", () => {
  assert.ok(app.includes("setReadDone({ scenes:(done||total), notes:notesN,"));
  assert.ok(ui.includes("function ScriptReadDone({ info, onArt, onStage, onEditors, onClose })"));
  assert.ok(ui.includes("The Stage shoots your shots, so they come first"), "honest about the Stage");
  assert.ok(app.includes("onStage:()=>{ setReadDone(null); setIntentRoom(\"\"); setRoom(\"art\"); setArtView(\"shots\");"));
  assert.ok(ui.includes("const first = i.room===\"stage\" ? \"stage\" : \"art\";"), "the chosen room first");
});

test("E Frances, the Terms and Privacy", () => {
  const i = ai.indexOf('name:"Import a screenplay (bring your own script)"'); assert.ok(i > 0);
  const entry = ai.slice(i, ai.indexOf("});", i));
  assert.ok(entry.includes("WORD FOR WORD") && entry.includes("I have a script") && entry.includes("Restore the import") && entry.includes("Gemini 4 Argon"));
  assert.ok(!/final draft|highland|celtx|writerduet/i.test(entry), "no other company's product named");
  assert.ok(terms.includes("When you import a screenplay, it stays yours.") && terms.includes("Last updated: 18 October 2026"));
  assert.ok(privacy.includes("A screenplay you import is read on your device first") && privacy.includes("Last updated: 18 October 2026"));
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS all ${checks}`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* test-script-read.mjs — BRING YOUR OWN SCRIPT, phase 2: THE READ (owner 2026-10-18; docs/Script Import Plan.md).
   app/script-read.js is run with a stand-in writing engine; the app wiring is checked at source level.

     A  the reading engines' prices agree with the server's table (and its dated changes); Gemini 4 Argon reads by
        default, a trial account on the light default engine; the price before a read is a sane range
     B  the scene prompt: the blocks by number, READ DON'T REWRITE, the structure's acts and kinds, no vendor named
     C  the reply: beats GROUP the blocks (contiguous, in order, covering all) — anything else is one beat and "beats"
        is marked to check; charges clamped, kinds from the structure, the driver by id or name, the value at stake
     D  the words never change: applyBeats only numbers the beats, and refuses a reply that would change a word
     E  Story notes: the read's (at most two) plus the method's own (no turn; the same side as the scene before)
     F  the cast (one Protagonist) and the film's brief (the synopsis in the structure's shape)
     G  prose, not a screenplay: recognised, and the window offers New Story
     H  the app: the read asks with its price, runs scene by scene with Stop, keeps the imported words the first
        time a scene is rewritten, restores the import, shows notes (not a verdict) on an imported scene, the strip

   node scripts/test-script-read.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const box = { console, TextDecoder, Blob, Response, DecompressionStream };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/script-import.js"), box);
vm.runInContext(read("app/script-read.js"), box);
const SR = box.ScriptRead, SI = box.ScriptImport;
const J = (x) => JSON.parse(JSON.stringify(x));

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const blocks = [
  { type:"scene", text:"INT. N68 BUS - NIGHT", beat:1 },
  { type:"action", text:"Rain hammers the windscreen. Tomasz grips his folder.", beat:1 },
  { type:"char", text:"TOMASZ", beat:1 },
  { type:"dia", text:"Go home, mate.", beat:1 },
  { type:"char", text:"DRUNK (O.S.)", beat:1 },
  { type:"dia", text:"Says who?", beat:1 },
  { type:"action", text:"Bernadette laughs. The drunk gets off.", beat:1 },
];
const cast = [{ id:"tomasz", name:"Tomasz" }, { id:"drunk", name:"Drunk" }, { id:"bernadette", name:"Bernadette", aliases:["Bernie"] }];
const ctx = { title:"Soft Folder", format:"Short Film", framework:"threeact", no:1, total:6, blocks, prev:[], cast,
  fallbackDriver:"tomasz", fallbackTitle:"N68 Bus", fallbackAct:1, keepWords:[] };

await test("A prices agree with the server; the default engine; the estimate", () => {
  for(const [id, r] of Object.entries(SR.READ_ENGINE_USD)){
    assert.deepEqual(J({ input:r.input, output:r.output }), J(P.TEXT_PROVIDER_USD_PER_1M[id]), id + " list price");
    const server = P.TEXT_PRICE_CHANGES.filter(c => c.model === id).map(c => ({ from:c.from, input:c.input, output:c.output }));
    assert.deepEqual(J(r.changes || []), J(server), id + " dated changes");
  }
  assert.equal(SR.engineFor(), "gemini-4-argon");
  box.turnOnFreeTier = () => true; box.TURN_FREE_TIER_WRITING_MODEL = "gemini-3.8-flash";
  assert.equal(SR.engineFor(), "gemini-3.8-flash", "a trial account reads on the light default engine");
  box.turnOnFreeTier = () => false;
  const film = { scenes:[{ id:"a" }, { id:"b" }], drafts:{ a:{ blocks }, b:{ blocks } } };
  const e = SR.estimate(film, "gemini-4-argon", { nowMs:Date.parse("2026-10-20T00:00:00Z") });
  assert.ok(e.lo >= 1 && e.hi >= e.lo, "a range");
  const later = SR.estimate(film, "gemini-4-argon", { nowMs:Date.parse("2026-12-02T00:00:00Z") });
  assert.ok(later.hi >= e.hi, "the December price is higher");
  assert.deepEqual(J(SR.ratesOf("gemini-4-argon", Date.parse("2026-12-01T00:00:00Z"))), { input:4, output:20 });
});

await test("B the scene prompt", () => {
  const p = SR.buildScenePrompt(ctx);
  assert.ok(p.includes("READ, DON'T REWRITE") && p.includes("[4] LINE: Go home, mate.") && p.includes("[3] CUE: TOMASZ"));
  assert.ok(p.includes("THIS IS SCENE 1 OF 6") && p.includes("the last ends at block 7"));
  assert.ok(p.includes("bernadette = Bernadette (also Bernie)"));
  assert.ok(!/Claude|Anthropic|OpenAI|Gemini|Google|McKee/i.test(p), "no vendor or school named");
});

await test("C the reply: beats group the blocks; fields validated", () => {
  const ok = SR.parseSceneReply({ title:"The Offer", summary:"Tomasz holds his ground.", act:1, valueAtStake:{ positive:"Belonging", negative:"Exclusion" },
    openCharge:-2, closeCharge:5, kind:"incite", driver:"Tomasz", conf:2,
    beats:[{ from:1, to:4, drive:{ a:"Holding on", d:"He grips the folder." }, react:{ a:"Pushing", d:"The drunk taunts." } },
           { from:5, to:7, drive:{ a:"Winning", d:"He turns it round." }, react:{ a:"Leaving", d:"The drunk gets off." } }], turnAt:9 }, ctx);
  assert.equal(ok.card.title, "The Offer"); assert.equal(ok.card.closeCharge, 3, "clamped to +3");
  assert.equal(ok.card.kind, "incite"); assert.equal(ok.card.driver, "tomasz", "by name");
  assert.deepEqual(J(ok.card.value), { pos:"Belonging", neg:"Exclusion" });
  assert.equal(ok.card.openValue, "Exclusion"); assert.equal(ok.card.closeValue, "Belonging");
  assert.deepEqual(J(ok.beatOf), [1,1,1,1,2,2,2]); assert.equal(ok.beats.rows.length, 2); assert.equal(ok.beats.turnAt, 2, "turnAt within the beats");
  assert.equal(ok.regrouped, false);
  const bad = SR.parseSceneReply({ title:"X", beats:[{ from:1, to:3 }, { from:5, to:7 }], kind:"spaceship", driver:"nobody" }, ctx);
  assert.deepEqual(J(bad.beatOf), [1,1,1,1,1,1,1], "a gap → one beat holds the scene");
  assert.ok(bad.unsure.includes("beats") && bad.regrouped);
  assert.equal(bad.card.kind, "normal"); assert.equal(bad.card.driver, "tomasz", "the fallback driver");
  assert.equal(SR.parseSceneReply(null, ctx), null);
});

await test("D the words never change", () => {
  const tagged = SR.applyBeats(blocks, [1,1,1,1,2,2,2]);
  assert.deepEqual(J(tagged.map(b => b.text)), J(blocks.map(b => b.text)));
  assert.deepEqual(J(tagged.map(b => b.beat)), [1,1,1,1,2,2,2]);
  assert.equal(SR.applyBeats(blocks, []).every(b => b.beat === 1), true, "an unnumbered block stays in beat 1");
  assert.ok(read("app/script-read.js").includes('throw new Error("A read must never change the screenplay\'s words.")'), "the guard");
});

await test("E Story notes: the read's plus the method's", async () => {
  const flat = SR.methodNotes({ openCharge:1, closeCharge:2 }, { closeCharge:2 });
  assert.ok(flat[0].includes("doesn’t turn") && flat[1].includes("same side"));
  assert.deepEqual(J(SR.methodNotes({ openCharge:-2, closeCharge:2 }, { closeCharge:-1 })), []);
  box.claude = { complete: async () => JSON.stringify({ title:"Hold", openCharge:1, closeCharge:2, beats:[{ from:1, to:7 }], notes:["It stays on the same side.", "Two", "Three"] }) };
  const r = await SR.readScene({ ...ctx, modelId:"gemini-4-argon", prevCard:{ closeCharge:3 } });
  assert.ok(r.notes.length <= 3 && r.notes.some(n => n.includes("doesn’t turn")));
  box.claude = { complete: async () => "no json here" };
  await assert.rejects(SR.readScene({ ...ctx }), /unreadable/);
});

await test("F the cast (one Protagonist) and the brief (the structure's shape)", async () => {
  box.claude = { complete: async () => JSON.stringify({ cast:[{ id:"tomasz", role:"Protagonist", conscious:"To pass.", voice:"dry" },
    { id:"bernadette", role:"Protagonist", conscious:"To help." }, { id:"ghost", role:"Antagonist" }] }) };
  const c = await SR.readCast({ cast:cast.map(x => ({ ...x, lines:1, scenes:1 })), scenes:[], modelId:"gemini-4-argon" });
  assert.equal(c.tomasz.role, "Protagonist"); assert.equal(c.bernadette.role, "Supporting", "exactly one Protagonist");
  assert.ok(!c.ghost, "an id not in the cast is ignored"); assert.equal(c.tomasz.speech, "dry");
  box.claude = { complete: async () => JSON.stringify({ logline:"A bus driver keeps his nerve.", premise:"What if …?", genre:"Drama",
    controllingIdea:{ value:"Belonging", cause:"when we stand up", polarity:"idealistic" }, synopsis:[{ key:"setup", text:"He drives." }, { key:"nope", text:"x" }] }) };
  const f = await SR.readFilm({ scenes:[], cast:[], framework:"threeact", modelId:"gemini-4-argon" });
  assert.equal(f.logline, "A bus driver keeps his nerve."); assert.equal(f.controllingIdea.polarity, "idealistic");
  assert.deepEqual(J(f.synopsis.paras.map(p => p.key)), ["setup"], "only the structure's own paragraphs");
});

await test("G prose, not a screenplay", () => {
  const r = SI.parseFountain("Tomasz drove the night bus for eleven years.\n\nOne night a drunk got on and everything changed. He had a folder of papers and a test to pass.");
  assert.equal(r.looksLikeProse, true); assert.ok(r.prose.includes("eleven years"));
  assert.equal(SI.parseFountain("INT. BUS - NIGHT\n\nRain.\n\nTOMASZ\nGo.").looksLikeProse, false);
  const ui = read("app/script-import-ui.jsx"), app = read("app/app.jsx"), ns = read("app/newstory.jsx");
  assert.ok(ui.includes("This reads like prose, not a screenplay") && ui.includes("Use it as the idea in New Story"));
  assert.ok(app.includes("onUseAsIdea:(text)=>{ setScriptImportOpen(false); setNewStorySeedText("));
  assert.ok(ns.includes("React.useState(()=> String(initialSeedText||\"\"))"));
});

await test("H the app wiring", () => {
  const app = read("app/app.jsx"), insp = read("app/inspector.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");
  assert.ok(app.includes("const readImportedScript = async (opts)=>"));
  assert.ok(app.includes("Your words aren\u2019t changed. You can stop at any time; what\u2019s read is kept."), "asks with its price");
  assert.ok(app.includes("const tagged = SR.applyBeats(blocks, r.beatOf);"), "only beat numbers change");
  assert.ok(app.includes("if(typeof window.turnFailureNeedsAction===\"function\" && window.turnFailureNeedsAction(f)){ halted"), "stops on a failure retrying can't fix");
  assert.ok(app.includes("const stopScriptRead = ()=>") && app.includes("onStop: scriptReading.phase===\"scenes\" ? stopScriptRead : undefined"));
  assert.ok(app.includes("if(next && prev && prev.imported && !(\"importedBlocks\" in next)){"), "the imported words are kept on the first rewrite");
  assert.ok(app.includes("const restoreImport = async ()=>") && app.includes("\"Restore the import\""));
  assert.ok(app.includes("setScriptReadOffer(Date.now());"), "the read is offered right after an import");
  assert.ok(app.includes("(allUnread ? \"Read my script\" : unreadN ? \"Read the rest\" : \"Read the brief\")"));
  assert.ok(insp.includes("if(scene && scene.imported) return null;") && insp.includes("React.createElement(ReadNotes,{scene,project,onUpdate,readOnly})"), "notes, not a verdict");
  assert.ok(insp.includes("if(project && project.storyNotesOff) return null;"));
  assert.ok(ai.includes("|| (opts.modelId && WRITING_MODELS.find(x=>x.id===opts.modelId))"), "one call can name its engine");
  assert.ok(/src="app\/script-read\.js\?v=[^"]+"/.test(html) && html.indexOf("app/script-read.js") < html.indexOf("app/app.jsx"));
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS all ${checks}`);
process.exit(failed ? 1 : 0);

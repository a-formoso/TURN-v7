/* LIKENESS, SEAMLESS (owner 2026-11-17: "see how we could make it more seamless and not sound robotic", then "yes, go
   ahead with all of them in that order"). Five changes:
     1 no spoken count: the pose is held for a moment (1.5 s Front, 2 s a side), a soft tone marks the photo;
     2 she finishes her sentences and says less (app/face-pose.js createVoiceGuide; its rules are tested in
       test-likeness-pose.mjs V2 / V5);
     3 the lines are recorded again as one sitting, in a photographer's words, and every clip is MEASURED: the first
       script's "Two" was a third of a second of silence, and nobody knew;
     4 "Whose likeness is this?" is asked before the camera (test-likeness-pose.mjs I23 / I24);
     5 plain words on the card and in the window.
   This file: the faults of the first script can't come back, the recorded clips are whole, the words, Frances.
   No model, account or network call. */
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { measurePcm } from "./render-guide-audio.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let passed = 0, failed = 0;
async function test(name, fn){ try { await fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n    " + String(e && e.stack || e).split("\n").join("\n    ")); } }
const plain = (v) => JSON.parse(JSON.stringify(v));

const box = { console, window: {} }; box.window = box; vm.createContext(box);
vm.runInContext(read("app/face-pose.js"), box, { filename: "app/face-pose.js" });
const FP = box.turnFacePose;
const cameo = read("app/cameo.jsx"), art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");
/* every string literal of a source file (comments left out) */
const literals = (src) => (src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1").match(/"(?:[^"\\\n]|\\.)*"/g) || []).map((x) => x.slice(1, -1));

await test("1 no count: a moment's hold, no number to say, a tone for the photo", () => {
  assert.deepEqual(plain(FP.HOLD_MS), { front: 1500, left: 2000, right: 2000 });
  const ids = FP.VOICE_LINES.map((l) => l.id);
  assert.deepEqual(plain(ids.filter((id) => /^(one|two|three|four|five)$/.test(id))), [], "no number has a clip");
  assert.equal(FP.voiceCountId, undefined);
  assert.deepEqual(plain([FP.voiceHoldIds("front"), FP.voiceHoldIds("left"), FP.voiceHoldIds("right", true)]), [["hold-still"], ["hold-it-there"], ["hold-again"]]);
  assert.equal(FP.CUES.holding.text, "Hold it there…", "the caption shows no number either");
  assert.ok(!/five seconds|three seconds|\{secs\}|\{hold\}|\{n\}/.test(JSON.stringify(FP.LINES) + JSON.stringify(FP.HINTS) + JSON.stringify(FP.CUES)), "no count in what is shown or read out");
  // the window: the hold line is said as "hold", the photo as "now" with the tone; nothing is said per second
  assert.ok(cameo.includes('G.say(FP.voiceHoldIds(key, !!st.reset), { kind:"hold" });'));
  assert.ok(cameo.includes('G.say(ids, { kind:"now", tone:true });'));
  assert.ok(!/kind:"count"|voiceCountId|dropCount|lastCount/.test(cameo));
  assert.ok(cameo.includes("tone: cameoChime,"));
  assert.ok(!/3 s for Front|5 s for each side/.test(literals(cameo).join("\n")));
});

await test("2 the tone is two quiet notes made on the device; where the browser has no audio it says so and nothing waits for it", () => {
  const made = [];
  class Ctx { constructor(){ this.state = "suspended"; this.currentTime = 10; this.destination = {}; this.resumed = 0; }
    resume(){ this.resumed++; }
    createOscillator(){ const o = { frequency: { value: 0 }, connect(){}, start(t){ o.at = t; }, stop(t){ o.end = t; } }; made.push(o); return o; }
    createGain(){ const g = { peak: 0, gain: { setValueAtTime(){}, exponentialRampToValueAtTime(v){ if (v > g.peak) g.peak = v; } }, connect(){} }; made.push(g); return g; } }
  const w = { console, AudioContext: Ctx, React: { createElement: () => null, useState: () => [null, () => {}], useEffect(){}, useRef: () => ({}) }, Icon: {}, document: undefined };
  w.window = w; vm.createContext(w);
  vm.runInContext(cameo, w, { filename: "app/cameo.jsx" });
  assert.equal(w.cameoChime(), true);
  const osc = made.filter((x) => "frequency" in x), gains = made.filter((x) => "peak" in x);
  assert.equal(osc.length, 2, "two notes"); assert.ok(osc[1].frequency.value > osc[0].frequency.value, "rising");
  assert.ok(osc.every((o) => o.type === "sine")); assert.ok(osc[1].end - osc[0].at < 0.3, "over in under a third of a second");
  assert.ok(gains.every((g) => g.peak > 0 && g.peak <= 0.1), "quiet");
  delete w.AudioContext;
  const quiet = { console, React: w.React, Icon: {}, document: undefined }; quiet.window = quiet; vm.createContext(quiet);
  vm.runInContext(cameo, quiet, { filename: "app/cameo.jsx" });
  assert.equal(quiet.cameoChime(), false, "no audio context: no tone, and the voice doesn't wait for one");
  assert.ok(FP.VOICE_RULES.toneMs >= 150 && FP.VOICE_RULES.toneMs <= 300);
});

await test("3 she finishes her sentences and says less: the rules", () => {
  const R = FP.VOICE_RULES;
  assert.ok(R.gapMs >= 600 && R.gapMs <= 1200, "a beat between two corrections");
  assert.ok(R.letFinishMs >= 400 && R.fadeMs > 0 && R.fadeMs <= 200, "a sentence about to end is left to end; one that is cut fades");
  assert.ok(R.remindMs >= 7000 && R.remindMaxMs >= 20000, "reminders come later than they did (6 s, 15 s)");
  assert.ok(cameo.includes('(cue.key==="loading" ? 1500 : 600);'), "she waits a beat (0.6 s, it was 0.25) before a correction");
  assert.ok(cameo.includes("{ remind:!cue.once, nudge:cue.nudge }"), "a reminder is the cue's nudge");
  const src = read("app/face-pose.js");
  assert.ok(src.includes("el.playbackRate = 1;") && !/COUNT_RATE|LINE_RATE|playbackRate = [^1]/.test(src), "every line at its own speed");
  assert.ok(src.includes("el.currentTime = clip.lead || 0; el.volume = volumeOf(clip);"), "from where its sound starts, at an even level");
});

await test("4 the recording is measured: where the sound starts, how long it lasts, how loud — a clip with no sound is caught", () => {
  const rate = 24000, tone = (secs, amp) => Array.from({ length: Math.round(secs * rate) }, (_, i) => Math.round(amp * Math.sin(2 * Math.PI * 220 * i / rate)));
  const silence = (secs) => new Array(Math.round(secs * rate)).fill(0);
  const m = measurePcm(Int16Array.from([...silence(1.08), ...tone(0.54, 6000), ...silence(0.34)]), rate);   // the first script's "Four"
  assert.ok(Math.abs(m.lead - 1.08) < 0.02 && Math.abs(m.speech - 0.54) < 0.03, JSON.stringify(m));
  assert.ok(m.rms > 0.1 && m.rms < 0.16);
  assert.deepEqual(measurePcm(Int16Array.from(silence(0.36)), rate), { lead: 0, speech: 0, rms: 0 }, "the first script's 'Two': nothing in it");
  const quiet = measurePcm(Int16Array.from(tone(1, 3000)), rate), loud = measurePcm(Int16Array.from(tone(1, 9000)), rate);
  assert.ok(Math.abs(loud.rms / quiet.rms - 3) < 0.05, "loudness is read as it is");
  const tool = read("scripts/render-guide-audio.mjs");
  assert.ok(tool.includes("new URL(FP.VOICE_DIR, ROOT)"), "it writes where the app reads");
  assert.ok(tool.includes("record it again with --only") && tool.includes("process.exit(bad ? 1 : 0)"), "a clip with hardly any sound fails the run");
  assert.ok(tool.includes("c.lead = ") && tool.includes("c.speech = ") && tool.includes("c.gain = "));
});

await test("5 the recorded clips: every line the window can say is there, in today's words, whole, and with sound in it", () => {
  const dir = FP.VOICE_DIR;
  assert.equal(dir, "app/vendor/voice/frances-guide/v2/");
  assert.ok(existsSync(new URL(dir + "manifest.json", ROOT)), "not recorded yet: run scripts/render-guide-audio.mjs (see its first lines)");
  const man = JSON.parse(read(dir + "manifest.json"));
  const problems = [];
  for (const l of FP.VOICE_LINES){
    const c = man.clips && man.clips[l.id], f = new URL(dir + l.id + ".mp3", ROOT);
    if (!c){ problems.push(l.id + ": not in the manifest"); continue; }
    if (c.text !== l.text){ problems.push(l.id + ": recorded with other words (“" + c.text + "”)"); continue; }
    if (!existsSync(f)){ problems.push(l.id + ": no file"); continue; }
    const buf = readFileSync(f);
    if (buf.length !== c.bytes || createHash("sha256").update(buf).digest("hex") !== c.sha256) problems.push(l.id + ": the file is not the one that was recorded");
    const words = l.text.split(/\s+/).length;
    if (!(c.speech >= 0.2 && c.speech >= words * 0.12)) problems.push(l.id + ": hardly any sound in it (" + c.speech + " s for " + words + " words)");
    if (!(c.speech <= words * 0.9 + 1.5)) problems.push(l.id + ": far too long for its words (" + c.speech + " s)");
    if (!(c.lead >= 0 && c.lead <= 2)) problems.push(l.id + ": lead " + c.lead);
    if (!(c.gain >= 0.6 && c.gain <= 1.4)) problems.push(l.id + ": gain " + c.gain);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  const files = readdirSync(new URL(dir, ROOT)).filter((f) => /\.mp3$/.test(f)).map((f) => f.replace(/\.mp3$/, "")).sort();
  assert.deepEqual(files, Array.from(FP.VOICE_LINES, (l) => l.id).sort(), "no clip that nothing says");
  const total = files.reduce((n, f) => n + statSync(new URL(dir + f + ".mp3", ROOT)).size, 0);
  assert.ok(total < 4.5e6, "small enough to read when the window opens: " + total);
  assert.ok(!existsSync(new URL("app/vendor/voice/frances-guide/v1/", ROOT)), "the first script's clips are no longer shipped");
});

await test("6 plain words in the window: photos, Use this face, Take photo; the consent question's own words untouched", () => {
  const lits = literals(cameo);
  for (const old of ["Lock likeness", "Capture now", " angles", "Now: ", " · required", " · optional", "Lock anyway"])
    assert.ok(!lits.some((x) => x.includes(old)), "still says “" + old + "”");
  assert.ok(!lits.some((x) => /\block(ed|ing)?\b/i.test(x) && /[a-z] [a-z]/i.test(x)), "nothing is 'locked' in what the window says: " + lits.filter((x) => /\block(ed|ing)?\b/i.test(x) && /[a-z] [a-z]/i.test(x)).join(" | "));
  for (const now of ["Use this face", " photos", "Take photo", "Start the camera", "Next: ", " · taken", "This is your own face.", "Take this one: "])
    assert.ok(lits.some((x) => x.includes(now)), "should say “" + now + "”");
  assert.ok(cameo.includes('const CAMEO_CONSENT_SELF = "This is me and I\'m 18 or over";'));
  assert.ok(cameo.includes('const CAMEO_CONSENT_OTHER = "I have their permission to use their likeness, and they\'re 18 or over";'));
  assert.ok(cameo.includes('"Whose likeness is this?"'), "the same question");
  assert.ok(read("app/imagegen.jsx").includes('CAMEO_CONSENT_TEXT_VERSION = "2026-10-10"') || /CAMEO_CONSENT_TEXT_VERSION\s*=\s*"2026-10-10"/.test(read("app/imagegen.jsx")), "the consent wording's version is unchanged: nobody is asked again because of this");
  // the stored labels are what they were (stored data is never migrated)
  assert.ok(cameo.includes('label:"Front"') && cameo.includes('label:"¾ Left"') && cameo.includes('label:"¾ Right"'));
});

await test("7 plain words on the character card", () => {
  for (const s of ['"Real face saved"', '" photo"', '"in the cloud too":"on this device"', '"the sheet shows an earlier face" : "on the sheet"', '"not on the sheet yet"',
    '"Put it on the sheet"', '"Making the sheet\\u2026"', '"Retake"', '"Give this character a real face (webcam or photos)"', '"A real face is saved"',
    'title:"Put this face on "+(c.name||"this character")+"\'s sheet?"', 'confirmLabel:"Make the sheet"'])
    assert.ok(art.includes(s), "the card should say " + s);
  for (const s of ['"Likeness locked"', '"Apply to sheet"', '"Recapture"', '"Applying\\u2026"', "Lock a real face", '" angle"', "regenerate to apply it to the sheet"])
    assert.ok(!art.includes(s), "the card still says " + s);
  assert.ok(art.includes('"Likeness",') && art.includes('"Likeness not available here"'), "the feature is still called Likeness");
});

await test("8 Frances knows, and no older sentence of hers contradicts it", () => {
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("function appBrief(){");
  const fb = { console, window: {} }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b) + "\n;this.__F = APP_FEATURES;", fb);
  const F = fb.__F, lf = F.find((f) => f.name === "Likeness (Art Room)");
  assert.ok(lf);
  for (const s of ["THE NEWEST WORD ON THE LIKENESS WINDOW", "WHOSE FACE COMES FIRST", "'Start the camera'", "NO COUNTING", "a soft two-note tone", "'Got it'",
    "she finishes a sentence before saying the next thing", "'Take photo'", "'Use this face \u00b7 3 photos'", "'Real face saved'", "'Put it on the sheet'", "'Retake'",
    "nothing about consent, where the photos are stored, sync or sharing has changed"]) assert.ok(lf.what.includes(s), "Frances: " + s);
  const all = F.map((f) => f.what || "").join("\n");
  for (const stale of ["five, four, three", "Hold still \u2014 5", "held still for 3 seconds", "held for 5 seconds", "3-second steady hold", "Now: Your left", "Likeness locked ("])
    assert.ok(!all.includes(stale), "an older sentence still says: " + stale);
  for (const [old, was] of [["'Capture now'", "it was 'Capture now'"], ["'Apply to sheet'", "it was 'Apply to sheet'"], ["'Recapture'", "it was 'Recapture'"]])
    assert.equal(all.split(old).length - 1, all.split(was).length - 1, old + " is only named as the old word");
  assert.ok(!/McKee|Claude|Anthropic|OpenAI|\bTURN\b|\bMUSE\b/.test(lf.what));
});

await test("9 the new files are served", () => {
  for (const file of ["face-pose.js", "cameo.jsx", "artroom.jsx", "ai.jsx", "script.jsx", "imagegen.jsx", "cloud.jsx", "styles.css"])
    assert.ok(["20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-cardb1", "20261121-cardb2"].some((k) => html.includes(file + "?v=" + k + '"')), "cache key: " + file);
  assert.ok(read("app/styles.css").includes(".cameo-who-line{"));
});

await test("10 the lines that only explain are tooltips (owner 2026-11-17): none under the title, the everyday note and the long sync text behind an 'i'; warnings and the consent words stay in view", () => {
  const win = cameo.slice(cameo.indexOf("function CameoModal("), cameo.indexOf("window.CameoModal = CameoModal;"));   // the capture window
  assert.ok(win.length > 1000 && !win.includes("cameo-sub"), "no small line under the Likeness title");
  assert.ok(!/className:"cameo-note"[,}]/.test(win), "the everyday note is not in view");
  assert.ok(cameo.includes('className:"cameo-note warn"'), "the warning (the pose check couldn't start) stays in view");
  assert.match(cameo, /cameoTip\("About Likeness",/); assert.match(cameo, /cameoTip\("How the photos work", CAMEO_TIP_HOW\+"\\n\\n"\+CAMEO_NOTE_OK\)/);
  assert.match(cameo, /cloudReady && cameoTip\("About syncing", CAMEO_TIP_SYNC\)/);
  assert.ok(cameo.includes("Unticking removes its cloud copy when you save it.") && cameo.includes("Sign in to sync it"), "what the person must know before acting stays in view");
  assert.ok(cameo.includes('"Whose likeness is this?"') && cameo.includes("CAMEO_CONSENT_SELF"), "the consent question and its box are where they were");
  // the report window of the QA check: the same rule
  assert.ok(!art.includes("qa-sub") && !art.includes("qa-foot-note") && !art.includes("no image credits spent"));
  assert.match(art, /label:"About this check"/); assert.match(art, /label:"About prompt advice"/);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

#!/usr/bin/env node
/* render-guide-audio.mjs — records the Likeness capture window's spoken instructions (app/face-pose.js
   VOICE_LINES) once, in Frances's voice, through the service-role-only `guide-audio` edge function, and
   writes <VOICE_DIR>/<id>.mp3 plus a manifest (VOICE_DIR is the folder app/face-pose.js names:
   app/vendor/voice/frances-guide/v2/). Operator tool, run on the Mac:
     SUPABASE_URL=https://<ref>.supabase.co SERVICE_ROLE_KEY=<the one-time GUIDE_AUDIO_TOKEN> node scripts/render-guide-audio.mjs [--only id,id]
     node scripts/render-guide-audio.mjs --measure        (no recording: measure the clips already there again)
   Not a test (no test- prefix); never shipped to the browser. (2026-10-10, owner — Likeness voice guidance)

   (2026-11-17, owner — "more seamless and not sound robotic") EVERY CLIP IS MEASURED after it is recorded (macOS
   `afconvert` decodes it): where its sound starts (lead), how long the sound lasts (speech) and how loud it is. The
   manifest keeps them, and the window plays each clip from its lead, at a level that makes them all alike (gain).
   A clip with no sound in it fails the run (the first script's "Two" was a third of a second of silence, and nobody
   knew): record it again with --only. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const box = { console, window: {}, document: undefined };
box.window = box; box.globalThis = box; vm.createContext(box);
vm.runInContext(readFileSync(new URL("app/face-pose.js", ROOT), "utf8"), box);
const FP = box.turnFacePose || box.window.turnFacePose;
const all = (FP && FP.VOICE_LINES) || [];
if (!all.length) { console.error("No VOICE_LINES in app/face-pose.js"); process.exit(1); }
const dir = new URL(FP.VOICE_DIR, ROOT);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const measureOnly = process.argv.includes("--measure");
const only = arg("--only") ? arg("--only").split(",") : null;
const lines = only ? all.filter((l) => only.includes(l.id)) : all;
mkdirSync(dir, { recursive: true });
const manifestPath = new URL("manifest.json", dir);
let manifest = {};
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (_e) {}
manifest.clips = manifest.clips || {};

/* ── the measurement: where the sound starts, how long it lasts, how loud it is ── */
export function measurePcm(samples, rate){
  const win = Math.max(1, Math.round(rate * 0.01)), floor = 500;   // 10 ms windows; ~ -36 dB of full scale
  const peaks = [];
  for (let i = 0; i + win <= samples.length; i += win){ let m = 0; for (let j = i; j < i + win; j++){ const v = Math.abs(samples[j]); if (v > m) m = v; } peaks.push(m); }
  let a = peaks.findIndex((v) => v > floor), b = peaks.length - 1;
  if (a < 0) return { lead: 0, speech: 0, rms: 0 };
  while (b > a && peaks[b] <= floor) b--;
  let sum = 0, n = 0;
  for (let i = a * win; i < (b + 1) * win && i < samples.length; i++){ sum += samples[i] * samples[i]; n++; }
  return { lead: a * win / rate, speech: (b - a + 1) * win / rate, rms: Math.sqrt(sum / Math.max(1, n)) / 32768 };
}
export function measureFile(mp3Path){
  const tmp = mkdtempSync(join(tmpdir(), "guide-audio-")), wav = join(tmp, "clip.wav");
  try {
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", mp3Path, wav], { stdio: "ignore" });
    const buf = readFileSync(wav);
    let at = 12, data = null;                                       // RIFF....WAVE, then chunks
    while (at + 8 <= buf.length){ const id = buf.toString("ascii", at, at + 4), size = buf.readUInt32LE(at + 4);
      if (id === "data"){ data = buf.subarray(at + 8, Math.min(buf.length, at + 8 + size)); break; } at += 8 + size + (size & 1); }
    if (!data) return null;
    const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
    return measurePcm(samples, 24000);
  } catch (_e) { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch (_e) {} }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  let ok = 0, bad = 0;
  if (!measureOnly) {
    const url = process.env.SUPABASE_URL, key = process.env.SERVICE_ROLE_KEY;
    if (!url || !key) { console.error("Set SUPABASE_URL and SERVICE_ROLE_KEY (or pass --measure)."); process.exit(1); }
    // a few lines a request: the function says each one in turn
    for (let i = 0; i < lines.length; i += 12) {
      const part = lines.slice(i, i + 12);
      const res = await fetch(url.replace(/\/$/, "") + "/functions/v1/guide-audio", {
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ lines: part.map((l) => ({ id: l.id, text: l.text })) }),
      });
      if (!res.ok) { console.error("guide-audio:", res.status, await res.text()); process.exit(1); }
      const data = await res.json();
      manifest.voice = data.voice; manifest.model = data.model;
      for (const c of data.clips) {
        if (!c.mp3) { bad++; console.error("✗", c.id, c.error); continue; }
        const buf = Buffer.from(c.mp3, "base64");
        writeFileSync(new URL(c.id + ".mp3", dir), buf);
        const line = part.find((l) => l.id === c.id);
        manifest.clips[c.id] = { text: line ? line.text : "", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
        ok++;
      }
      console.log(`recorded ${Math.min(i + 12, lines.length)} of ${lines.length}`);
    }
  }
  // measure every clip that is there (all of them, so the levels are set against each other)
  const found = [];
  for (const l of all) {
    const f = new URL(l.id + ".mp3", dir);
    if (!existsSync(f) || !manifest.clips[l.id]) continue;
    const m = measureFile(fileURLToPath(f));
    if (!m) { console.error("✗ could not measure", l.id, "(afconvert is needed: run this on the Mac)"); bad++; continue; }
    found.push({ l, m });
  }
  const loud = found.filter((x) => x.m.speech >= 0.2).map((x) => x.m.rms).sort((a, b) => a - b);
  const target = loud.length ? loud[Math.floor(loud.length / 2)] : 0;      // the median clip's level
  for (const { l, m } of found) {
    const c = manifest.clips[l.id];
    c.lead = Math.max(0, Math.round((m.lead - 0.03) * 100) / 100);        // 30 ms of air before the first sound
    c.speech = Math.round(m.speech * 100) / 100;
    c.gain = m.rms > 0 && target > 0 ? Math.round(Math.min(1.4, Math.max(0.6, target / m.rms)) * 100) / 100 : 1;
    const words = l.text.split(/\s+/).length;
    const silent = m.speech < 0.2 || m.speech < words * 0.12;
    if (silent) { bad++; console.error("✗ " + l.id + ": hardly any sound in it (" + c.speech + " s for " + words + " word" + (words === 1 ? "" : "s") + "): record it again with --only " + l.id); }
  }
  const missing = all.filter((l) => !manifest.clips[l.id] || manifest.clips[l.id].text !== l.text || !existsSync(new URL(l.id + ".mp3", dir))).map((l) => l.id);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${measureOnly ? "measured" : "recorded " + ok + ", measured"} ${found.length} → ${fileURLToPath(dir)}`);
  if (missing.length) console.log("not recorded with today's words yet: " + missing.join(", "));
  process.exit(bad ? 1 : 0);
}

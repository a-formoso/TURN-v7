#!/usr/bin/env node
/* render-guide-audio.mjs — records the Likeness capture window's spoken instructions (app/face-pose.js
   VOICE_LINES) once, in Frances's voice, through the service-role-only `guide-audio` edge function, and
   writes app/vendor/voice/frances-guide/v1/<id>.mp3 plus a manifest. Operator tool, run on the Mac:
     SUPABASE_URL=https://<ref>.supabase.co SERVICE_ROLE_KEY=<the one-time GUIDE_AUDIO_TOKEN> node scripts/render-guide-audio.mjs [--only id,id]
   Not a test (no test- prefix); never shipped to the browser. (2026-10-10, owner — Likeness voice guidance) */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const url = process.env.SUPABASE_URL, key = process.env.SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SERVICE_ROLE_KEY."); process.exit(1); }
const box = { console, window: {}, document: undefined };
box.window = box; box.globalThis = box; vm.createContext(box);
vm.runInContext(readFileSync(new URL("app/face-pose.js", ROOT), "utf8"), box);
const FP = box.turnFacePose || box.window.turnFacePose;
let lines = (FP && FP.VOICE_LINES) || [];
if (!lines.length) { console.error("No VOICE_LINES in app/face-pose.js"); process.exit(1); }
const only = process.argv.indexOf("--only") > 0 ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
if (only) lines = lines.filter((l) => only.includes(l.id));
const dir = new URL("app/vendor/voice/frances-guide/v1/", ROOT);
mkdirSync(dir, { recursive: true });
const res = await fetch(url.replace(/\/$/, "") + "/functions/v1/guide-audio", {
  method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
  body: JSON.stringify({ lines: lines.map((l) => ({ id: l.id, text: l.text })) }),
});
if (!res.ok) { console.error("guide-audio:", res.status, await res.text()); process.exit(1); }
const data = await res.json();
let ok = 0, bad = 0;
const manifestPath = new URL("manifest.json", dir);
let manifest = {};
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (_e) {}
manifest.voice = data.voice; manifest.model = data.model; manifest.clips = manifest.clips || {};
for (const c of data.clips) {
  if (!c.mp3) { bad++; console.error("✗", c.id, c.error); continue; }
  const buf = Buffer.from(c.mp3, "base64");
  writeFileSync(new URL(c.id + ".mp3", dir), buf);
  const line = lines.find((l) => l.id === c.id);
  manifest.clips[c.id] = { text: line ? line.text : "", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  ok++;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`recorded ${ok}, failed ${bad} → ${dir.pathname}`);
process.exit(bad ? 1 : 0);

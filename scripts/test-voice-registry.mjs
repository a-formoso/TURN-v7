#!/usr/bin/env node
/* test-voice-registry.mjs — supabase/functions/image-proxy/voice-registry.mjs, the pure rules of whose voice it is
   (2026-10-11, owner — voice review):
     A consent: whose voice ("me" / "someone" + a name), 18 or over, the attestation — recorded with who and when
     B recordings: 1–25 audio files by their bytes, 30 MB, 30 s – 5 min when the length can be read
     C the list: stock voices and the caller's own (and the film's) — never another user's
     D speaking: owned / film / stock; deleted, unrecorded and denied refused; provider unreachable → backup only
     E the plan's number of real voices; a neutral provider name
   node scripts/test-voice-registry.mjs */
import assert from "node:assert/strict";
import * as R from "../supabase/functions/image-proxy/voice-registry.mjs";

let checks = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); checks++; console.log("PASS", name); } catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); } };
const at = () => new Date("2026-10-11T12:00:00Z");

await test("A consent", () => {
  for (const [raw, msg] of [[null, /whose voice/], [{ personKind: "friend" }, /whose voice/], [{ personKind: "someone", adult: true, attest: true }, /name of the person/],
      [{ personKind: "me", attest: true }, /18 or over/], [{ personKind: "me", adult: true }, /Confirm/], [{ personKind: "me", adult: "true", attest: true }, /18 or over/]]) {
    const r = R.cloneConsent(raw); assert.equal(r.ok, false); assert.equal(r.code, "consent_required"); assert.match(r.error, msg);
  }
  const r = R.cloneConsent({ personKind: "someone", personName: "  Sam\n Reyes  ", adult: true, attest: true }, { now: at, attestedBy: "u1" });
  assert.deepEqual(r.consent, { personKind: "someone", personName: "Sam Reyes", adult: true, attest: true, version: "voice-consent-1",
    text: R.VOICE_CONSENT_TEXT, attestedBy: "u1", attestedAt: "2026-10-11T12:00:00.000Z" });
  assert.equal(R.cloneConsent({ personKind: "me", adult: true, attest: true }).consent.personName, "");
});

// a WAV of `sec` seconds of silence (8 kHz mono 8-bit), as a data URL
const wav = (sec) => {
  const n = Math.round(8000 * sec), b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return "data:audio/wav;base64," + b.toString("base64");
};
const mp3 = "data:audio/mpeg;base64," + Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]).toString("base64");

await test("B recordings", async () => {
  const bad = async (s, re) => { const r = await R.cloneSamples(s); assert.equal(r.ok, false, JSON.stringify(s).slice(0, 60)); assert.equal(r.code, "samples_invalid"); assert.match(r.error, re); };
  await bad([], /Add a recording/);
  await bad(Array(26).fill(wav(2)), /at most 25/);
  await bad(["https://example.com/a.mp3"], /couldn't be read/);
  await bad(["data:audio/wav;base64," + Buffer.from("hello world, not audio").toString("base64")], /isn't a recording/);
  await bad([wav(10), wav(12)], /only 22 seconds/);
  await bad([wav(200), wav(120)], /more than 5 minutes/);
  let r = await R.cloneSamples([wav(20), wav(25)]);
  assert.equal(r.ok, true); assert.equal(r.seconds, 45); assert.deepEqual(r.files.map((f) => f.ext), ["wav", "wav"]);
  r = await R.cloneSamples([mp3, wav(5)]);
  assert.equal(r.ok, true, "an MP3's length can't be read here: it's not refused as too short"); assert.equal(r.seconds, null); assert.equal(r.files[0].mime, "audio/mpeg");
  const big = "data:audio/mpeg;base64," + Buffer.concat([Buffer.from("ID3"), Buffer.alloc(31 * 1024 * 1024)]).toString("base64");
  await bad([big], /too large/);
});

await test("C the list", () => {
  const provider = [{ voice_id: "s1", name: "Stock", category: "premade", preview_url: "p" }, { voice_id: "pro", name: "Pro", category: "professional" },
    { voice_id: "mine", name: "rv-1", category: "cloned" }, { voice_id: "des", name: "dv-1", category: "generated" },
    { voice_id: "theirs", name: "Their friend", category: "cloned" }, { voice_id: "film", name: "rv-2", category: "cloned" }, { voice_id: "gone", category: "cloned" }];
  const own = [{ voice_id: "mine", kind: "cloned", person_kind: "someone", person_name: "Sam", label: "Sam" }, { voice_id: "des", kind: "designed", label: "MAREN" },
    { voice_id: "gone", kind: "cloned", deleted_at: "x" }];
  const out = R.voicesForCaller(provider, own, [{ voice_id: "film", kind: "cloned", person_kind: "me", person_name: "", label: "Dora's voice" }]);
  assert.deepEqual(out.map((v) => v.voiceId), ["s1", "pro", "mine", "des", "film"]);
  assert.deepEqual(out[2], { voiceId: "mine", name: "Sam", category: "cloned", previewUrl: "", labels: {}, own: true, kind: "cloned", personKind: "someone", personName: "Sam" });
  assert.deepEqual([out[3].name, out[3].category, out[3].own], ["MAREN", "generated", true]);
  assert.deepEqual([out[4].onFilm, out[4].own, out[4].name], [true, false, "Dora's voice"]);
});

await test("D speaking", () => {
  assert.deepEqual(R.voiceUseDecision("owned"), { ok: true }); assert.deepEqual(R.voiceUseDecision("film"), { ok: true });
  assert.deepEqual(R.voiceUseDecision("unknown", "premade"), { ok: true });
  assert.deepEqual(R.voiceUseDecision("unknown", "?"), { ok: true, backupOnly: true });
  for (const [a, c, code] of [["unknown", "cloned", "voice_not_allowed"], ["unknown", "", "voice_not_allowed"], ["denied", "premade", "voice_not_allowed"], ["deleted", "", "voice_deleted"]]) {
    const r = R.voiceUseDecision(a, c); assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(r.status, 403);
  }
});

await test("E limits and names", () => {
  assert.equal(R.voiceLimit({ plan: "director" }), 3); assert.equal(R.voiceLimit({ plan: "studio" }), 6);
  assert.equal(R.voiceLimit({ plan: "writer" }), 0); assert.equal(R.voiceLimit({ isAdmin: true, plan: "none" }), Infinity);
  assert.match(R.voiceLimitRefusal(3).error, /already has 3 voices, the most its plan holds\. Delete one in Voices/);
  // the setting: defaults for anything missing or unusable
  assert.deepEqual(R.voiceSlotSettings(null), { studioMax: 30, reserve: 3, perAccount: { director: 3, studio: 6 } });
  assert.deepEqual(R.voiceSlotSettings({ studioMax: 160, reserve: 10, perAccount: { director: 5, studio: "x" } }), { studioMax: 160, reserve: 10, perAccount: { director: 5, studio: 6 } });
  assert.deepEqual(R.voiceSlotSettings({ studioMax: -1, reserve: 99 }).studioMax, 30);
  assert.equal(R.voiceSlotSettings({ studioMax: 5, reserve: 99 }).reserve, 5, "the reserve never exceeds the library");
  const S = R.voiceSlotSettings(null);
  assert.equal(R.voiceRoomRefusal({ studioUsed: 26, ownerUsed: 0, limit: 3, settings: S }), null);
  assert.equal(R.voiceRoomRefusal({ studioUsed: 27, ownerUsed: 0, limit: 3, settings: S }).code, "voice_library_full", "27 of 30: full for users");
  assert.equal(R.voiceRoomRefusal({ studioUsed: 29, ownerUsed: 0, limit: Infinity, isAdmin: true, settings: S }), null, "the admin's reserve");
  assert.equal(R.voiceRoomRefusal({ studioUsed: 30, ownerUsed: 0, limit: Infinity, isAdmin: true, settings: S }).code, "voice_library_full");
  assert.equal(R.voiceRoomRefusal({ studioUsed: 5, ownerUsed: 3, limit: 3, settings: S }).code, "voice_limit");
  assert.match(R.providerVoiceName("cloned", "d0000000-0000-4000-8000-000000000001", 1760000000000), /^rv-d0000000-[0-9a-z]+$/);
  assert.match(R.providerVoiceName("designed", "abc"), /^dv-abc-/);
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS voice registry (${checks} checks)`);
process.exit(failed ? 1 : 0);

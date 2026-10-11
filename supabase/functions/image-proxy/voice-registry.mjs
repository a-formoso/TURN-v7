/* voice-registry.mjs — WHOSE VOICE IS IT (2026-10-11, owner — "every user can use their own voice or that of another
   person"; voice review). Every designed or cloned voice lives in the studio's ONE voice-provider account, so before
   this a voice anyone cloned was listed to — and could be spoken with by — every paying user. index.ts now records
   each voice it makes (supabase/voices.sql turn_voices), lists a caller only the provider's stock voices and their own,
   and speaks with a recorded voice only for its owner or on a film it is linked to (turn_voice_access).
   Pure and testable in Node (scripts/test-voice-registry.mjs): index.ts hands in the bytes and the rows.

   A REAL PERSON'S VOICE needs, on the server, before anything is sent to the provider:
     whose voice it is — "me" or "someone" (then their name) — that they are 18 or over, and the attestation that it's
     the caller's own voice or the speaker agreed (cloneConsent). The record is kept with the voice (voices.sql).
   THE SAMPLES (cloneSamples): 1–25 audio files, 30 MB at most in all, each one an audio file by its bytes (WebM, Ogg,
     MP4 / M4A, WAV, MP3, FLAC); when their length can be read (every container but MP3 and FLAC), 30 seconds to
     5 minutes in all (the provider recommends 1–2 minutes of clean speech from one speaker).
   HOW MANY (voiceLimit): real voices an account may hold — Director 5, Producer 15; admins unlimited. */

import { audioDurationFromBytes, sniffAudioContainer, AUDIO_CONTAINERS } from "./audio-length.mjs";

export const VOICE_CONSENT_VERSION = "voice-consent-1";
export const VOICE_CONSENT_TEXT = "This is my own voice, or the person whose voice this is has agreed to it being cloned and used for characters in my films. They are 18 or over.";
export const REAL_VOICE_LIMITS = Object.freeze({ director: 5, studio: 15 });
export const CLONE_SAMPLE_LIMITS = Object.freeze({ maxFiles: 25, maxBytes: 30 * 1024 * 1024, minSeconds: 30, maxSeconds: 300 });
/* the provider's own voices anyone may use — every other voice must be one this studio recorded */
export const STOCK_VOICE_CATEGORIES = Object.freeze(["premade", "professional"]);

const refuse = (code, error, status = 400) => ({ ok: false, status, code, error });

/** The consent for a real person's voice, or a refusal. */
export function cloneConsent(raw, { now = () => new Date(), attestedBy = "" } = {}) {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const personKind = c.personKind === "me" || c.personKind === "someone" ? c.personKind : "";
  if (!personKind) return refuse("consent_required", "Say whose voice this is — yours or someone else's.");
  const personName = String(c.personName ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (personKind === "someone" && !personName) return refuse("consent_required", "Add the name of the person whose voice this is.");
  if (c.adult !== true) return refuse("consent_required", "Voices can only be cloned from people who are 18 or over.");
  if (c.attest !== true) return refuse("consent_required", "Confirm that this is your voice, or that the person agreed to it being cloned.");
  return { ok: true, consent: { personKind, personName, adult: true, attest: true, version: VOICE_CONSENT_VERSION,
    text: VOICE_CONSENT_TEXT, attestedBy: String(attestedBy || ""), attestedAt: now().toISOString() } };
}

/** How many real voices an account may hold (its plan: on a shared film, the owner's). */
export function voiceLimit(account) {
  if (!account) return 0;
  if (account.isAdmin) return Infinity;
  return REAL_VOICE_LIMITS[account.plan] || 0;
}
export function voiceLimitRefusal(limit) {
  return refuse("voice_limit", limit > 0
    ? `This account already has ${limit} real voice${limit !== 1 ? "s" : ""}, the most its plan holds. Delete one in Voices to add another.`
    : "Real voices need a Director or Producer plan.", 403);
}

function sniffMore(b) {
  const c = sniffAudioContainer(b);
  if (c) return c;
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3";             // ID3 tag
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";                        // MPEG frame sync
  if (b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return "flac";
  return null;
}
const EXTRA = { mp3: { mime: "audio/mpeg", ext: "mp3" }, flac: { mime: "audio/flac", ext: "flac" } };

function dataUrlBytes(src) {
  const m = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(String(src || ""));
  if (!m || !/;base64/i.test(m[2] || "")) return null;
  try {
    const bin = atob(m[3].replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_e) { return null; }
}

/**
 * The samples to send: { ok, files:[{ bytes, mime, ext }], seconds (null when not every length could be read),
 * readSeconds } — or a refusal, before any hold or provider call.
 */
export async function cloneSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  if (!list.length) return refuse("samples_invalid", "Add a recording of the voice to clone.");
  if (list.length > CLONE_SAMPLE_LIMITS.maxFiles) return refuse("samples_invalid", `Use at most ${CLONE_SAMPLE_LIMITS.maxFiles} recordings.`);
  const files = [];
  let total = 0, seconds = 0, allRead = true;
  for (let i = 0; i < list.length; i++) {
    const bytes = dataUrlBytes(list[i]);
    const which = list.length > 1 ? ` (recording ${i + 1})` : "";
    if (!bytes || !bytes.length) return refuse("samples_invalid", `That recording couldn't be read${which}. Record it again, or use an MP3, WAV or M4A file.`);
    total += bytes.length;
    if (total > CLONE_SAMPLE_LIMITS.maxBytes) return refuse("samples_invalid", "The recordings are too large together (30 MB at most). About 2 minutes of speech is plenty.");
    const kind = sniffMore(bytes);
    if (!kind) return refuse("samples_invalid", `That file isn't a recording this can use${which}. Use an MP3, WAV, M4A, WebM, Ogg or FLAC file.`);
    const meta = AUDIO_CONTAINERS[kind] || EXTRA[kind];
    if (kind === "mp3" || kind === "flac") allRead = false;
    else {
      const r = await audioDurationFromBytes(bytes);
      if (r.seconds == null) allRead = false; else seconds += r.seconds;
    }
    files.push({ bytes, mime: meta.mime, ext: meta.ext });
  }
  const read = Math.round(seconds * 10) / 10;
  if (read > CLONE_SAMPLE_LIMITS.maxSeconds) return refuse("samples_invalid", "That's more than 5 minutes of audio. About 2 minutes of clear speech is best.");
  if (allRead && read < CLONE_SAMPLE_LIMITS.minSeconds) return refuse("samples_invalid", `That's only ${Math.round(read)} seconds of audio. Record at least 30 seconds — about 1 to 2 minutes of clear speech works best.`);
  return { ok: true, files, seconds: allRead ? read : null, readSeconds: read };
}

/** The voice list a caller sees: the provider's stock voices, plus their own recorded voices (and the film's). */
export function voicesForCaller(providerVoices, ownRows, filmRows = []) {
  const own = new Map((ownRows || []).filter((r) => r && !r.deleted_at).map((r) => [String(r.voice_id), r]));
  const film = new Map((filmRows || []).filter((r) => r && !r.deleted_at).map((r) => [String(r.voice_id), r]));
  const out = [];
  for (const v of Array.isArray(providerVoices) ? providerVoices : []) {
    const id = String(v && v.voice_id || "");
    if (!id) continue;
    const mine = own.get(id), onFilm = film.get(id), row = mine || onFilm;
    const stock = STOCK_VOICE_CATEGORIES.includes(String(v.category || ""));
    if (!row && !stock) continue;   // someone else's designed or cloned voice: never listed
    out.push({ voiceId: id, name: row ? (row.label || row.person_name || v.name || "") : (v.name || ""),
      category: row ? (row.kind === "cloned" ? "cloned" : "generated") : (v.category || ""),
      previewUrl: row ? "" : (v.preview_url || ""), labels: row ? {} : (v.labels || {}),
      ...(row ? { own: !!mine, kind: row.kind, ...(row.kind === "cloned" ? { personKind: row.person_kind || "", personName: row.person_name || "" } : {}),
        ...(onFilm && !mine ? { onFilm: true } : {}) } : {}) });
  }
  return out;
}

/** What a speech request may do with this voice: the database's answer, plus the provider category for unknowns. */
export function voiceUseDecision(access, providerCategory) {
  if (access === "owned" || access === "film") return { ok: true };
  if (access === "deleted") return refuse("voice_deleted", "This voice was deleted. Choose another voice for this character.", 403);
  if (access === "unknown" && STOCK_VOICE_CATEGORIES.includes(String(providerCategory || ""))) return { ok: true };
  // the provider couldn't be asked: only the backup route, which renders stock voices and nothing else
  if (access === "unknown" && providerCategory === "?") return { ok: true, backupOnly: true };
  return refuse("voice_not_allowed", "This voice isn't available to this account. Choose another voice for this character.", 403);
}

/** A neutral name for the voice at the provider — no person's name or character text leaves the studio. */
export function providerVoiceName(kind, owner, nowMs = Date.now()) {
  return (kind === "cloned" ? "rv-" : "dv-") + String(owner || "").replace(/-/g, "").slice(0, 8) + "-" + Number(nowMs).toString(36);
}

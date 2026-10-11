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
   HOW MANY (owner 2026-10-11 — the studio's voice plan holds 30 custom voices for EVERYONE, designed and real alike):
     each account may hold `perAccount[plan]` designed + real voices together (Director 3, Producer 6; admins
     unlimited), and nobody adds one once the studio has `studioMax - reserve` (27 of 30: the reserve is the admin's,
     for testing). All of it is the server setting turn_app_config "voice_slots" (voiceSlotSettings) — raised the
     day the plan is, with no code change or deploy. Checked before designing (which is paid), saving and cloning. */

import { audioDurationFromBytes, sniffAudioContainer, AUDIO_CONTAINERS } from "./audio-length.mjs";

export const VOICE_CONSENT_VERSION = "voice-consent-1";
export const VOICE_CONSENT_TEXT = "This is my own voice, or the person whose voice this is has agreed to it being cloned and used for characters in my films. They are 18 or over.";
export const VOICE_SLOT_DEFAULTS = Object.freeze({ studioMax: 30, reserve: 3, perAccount: Object.freeze({ director: 3, studio: 6 }) });
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

/** The voice-room setting (turn_app_config "voice_slots"), with the defaults for anything missing or unusable. */
export function voiceSlotSettings(raw) {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const int = (x, dflt, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n >= 0 && n <= max ? n : dflt; };
  const studioMax = int(v.studioMax, VOICE_SLOT_DEFAULTS.studioMax, 100000);
  const reserve = Math.min(int(v.reserve, VOICE_SLOT_DEFAULTS.reserve, 100000), studioMax);
  const pa = v.perAccount && typeof v.perAccount === "object" ? v.perAccount : {};
  return { studioMax, reserve, perAccount: { director: int(pa.director, VOICE_SLOT_DEFAULTS.perAccount.director, 10000),
    studio: int(pa.studio, VOICE_SLOT_DEFAULTS.perAccount.studio, 10000) } };
}

/** How many voices (designed + real) an account may hold — its plan's (on a shared film, the owner's). */
export function voiceLimit(account, settings = VOICE_SLOT_DEFAULTS) {
  if (!account) return 0;
  if (account.isAdmin) return Infinity;
  return (settings.perAccount || {})[account.plan] || 0;
}
export function voiceLimitRefusal(limit) {
  return refuse("voice_limit", limit > 0
    ? `This account already has ${limit} voice${limit !== 1 ? "s" : ""}, the most its plan holds. Delete one in Voices to add another.`
    : "Character voices need a Director or Producer plan.", 403);
}
export function voiceLibraryFullRefusal() {
  return refuse("voice_library_full", "New voices can't be added right now \u2014 the studio's voice library is full. Please try again later.", 403);
}
/** May one more voice be added: null, or the refusal. `studioUsed` = every active voice the studio holds. */
export function voiceRoomRefusal({ studioUsed, ownerUsed, limit, isAdmin = false, settings = VOICE_SLOT_DEFAULTS }) {
  const ceiling = settings.studioMax - (isAdmin ? 0 : settings.reserve);
  if ((Number(studioUsed) || 0) >= ceiling) return voiceLibraryFullRefusal();
  if (limit !== Infinity && (Number(ownerUsed) || 0) >= limit) return voiceLimitRefusal(limit);
  return null;
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

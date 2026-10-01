/* audio-length.mjs — the REAL length of a recorded answer, read from its container before
   speech-to-text is held (billing fixes, round 5, S1; owner decision (2), 2026-09-30). Pure and
   testable in Node (scripts/test-server-charging.mjs): no Deno or Supabase imports.

   WHY: the providers bill the whole recording, by its audio length. Round 4 held a recording at
   its size (6 kbps) and settled it at the end of the last timed word — trailing silence was free,
   a file with no speech cost nothing, and a DTX file (silence sent as a few bytes a second) beat
   the size estimate. From round 5 the proxy reads the duration from the container itself, HOLDS
   and SETTLES on it (billing-pricing.mjs sttHoldCost / sttSettleCost), and refuses (400) a
   container it can't read or a recording longer than STT_MAX_SECONDS. Word timestamps are never
   used.

   WHAT IT READS (the container is recognised from its first bytes; the client's MIME type is
   never trusted):
     WebM / Matroska  Chrome's and Firefox's MediaRecorder. Opus audio tracks only. The length is
                      the LARGEST of: the Info Duration (when there is one — browser recordings
                      have none), the end of the last block (its Cluster Timecode + its relative
                      timecode + its duration, TimecodeScale applied; Segments and Clusters of
                      unknown size are followed as a demuxer follows them), and the sum of every
                      Opus packet's own duration (its TOC byte — what a decoder really produces,
                      whatever the timestamps say). Laced blocks are unreadable.
     Ogg              Opus (granules at 48 kHz) or Vorbis (granules at the stream's rate). The
                      LARGEST granule on any page, and for Opus the sum of the packets' durations
                      (for Vorbis a lower bound from the packet count and the short block size);
                      chained streams add up. Pages are found as a demuxer finds them (it resyncs
                      on "OggS").
     MP4 / MOV        Safari. A plain file is read by media-length.mjs (the maximum of every
                      duration it declares, hardened for billing); a FRAGMENTED file (Safari
                      writes its recording in movie fragments) is read here: every track must be
                      AAC ('mp4a'), and the length is the largest of the fragments' own timing
                      (tfdt + trun durations, tfhd / trex defaults) and the moov's. For AAC the
                      sample count x 1024 samples a frame / the sample rate is one more lower
                      bound, for plain and fragmented files alike.
     WAV              PCM (8/16/24/32-bit), IEEE float (32/64-bit), A-law or µ-law: the bytes from
                      the start of the data chunk to the END OF THE FILE / the byte rate computed
                      from the format (sample rate x channels x bytes a sample) — never the
                      declared byte rate or data size alone.
   Anything else — another container, another codec, a malformed or truncated header — is
   { seconds: null, reason: "unreadable" } (or "format" when the first bytes match no container). */

import { mp4InfoFromBytes } from "./media-length.mjs";

/* The containers the proxy accepts, with the MIME type and file extension it sends the provider
   (from what it read — not from what the client said). */
export const AUDIO_CONTAINERS = Object.freeze({
  webm: Object.freeze({ mime: "audio/webm", ext: "webm" }),
  ogg: Object.freeze({ mime: "audio/ogg", ext: "ogg" }),
  mp4: Object.freeze({ mime: "audio/mp4", ext: "mp4" }),
  wav: Object.freeze({ mime: "audio/wav", ext: "wav" }),
});

const MAX_SECONDS = 24 * 3600;   // beyond a day nothing is vouched for (the cap is far lower)
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
const u32 = (b, o) => b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const ascii = (b, o, n) => { let s = ""; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
const fail = (reason = "unreadable") => ({ seconds: null, reason });

/** The container a recording's first bytes name: "webm" | "ogg" | "wav" | "mp4" | null. */
export function sniffAudioContainer(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "ogg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (b.length >= 8 && ascii(b, 4, 4) === "ftyp") return "mp4";
  return null;
}

/**
 * The samples (at 48 kHz) one Opus packet decodes to, from its TOC byte (RFC 6716 §3.1): the frame
 * size of its configuration x its frame count (code 3 reads the count from the next byte), at most
 * 120 ms. An empty packet is 0.
 */
export function opusPacketSamples(b, off, len) {
  if (!(len >= 1)) return 0;
  const toc = b[off];
  const config = toc >> 3;
  const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]   // SILK: 10 / 20 / 40 / 60 ms
    : config < 16 ? [480, 960][config & 1]                         // hybrid: 10 / 20 ms
    : [120, 240, 480, 960][config & 3];                            // CELT: 2.5 / 5 / 10 / 20 ms
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (len >= 2 ? b[off + 1] & 0x3f : 0) : 2;
  return Math.min(5760, frame * frames);
}

/* ─────────────────────────────── WebM / Matroska ─────────────────────────────── */

const E = Object.freeze({
  EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7,
  TrackType: 0x83, CodecID: 0x86, Cues: 0x1c53bb6b, Cluster: 0x1f43b675, Tags: 0x1254c367,
  Chapters: 0x1043a770, Attachments: 0x1941a469, Void: 0xec, CRC32: 0xbf, Timecode: 0xe7,
  SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b, Position: 0xa7,
  PrevSize: 0xab, SilentTracks: 0x5854, EncryptedBlock: 0xaf,
});
const SEGMENT_CHILDREN = new Set([E.SeekHead, E.Info, E.Tracks, E.Cues, E.Cluster, E.Tags, E.Chapters, E.Attachments, E.Void, E.CRC32]);
const CLUSTER_CHILDREN = new Set([E.Timecode, E.SimpleBlock, E.BlockGroup, E.Position, E.PrevSize, E.SilentTracks, E.EncryptedBlock, E.Void, E.CRC32]);
const CLUSTER_ID_BYTES = [0x1f, 0x43, 0xb6, 0x75];

/* An EBML variable-length integer at `o`: { value, len, unknown } (unknown: every data bit set —
   an element of unknown size). `id` keeps the length marker (element IDs are written that way). */
function vint(b, o, end, id = false) {
  if (o >= end) return null;
  const first = b[o];
  if (first === 0) return null;
  let len = 1, mask = 0x80;
  while (!(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || o + len > end) return null;
  let value = id ? first : first & (mask - 1);
  let ones = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + b[o + i]; if (b[o + i] !== 0xff) ones = false; }
  return { value, len, unknown: !id && ones };
}
/* The element at `o`: { id, body, end } (end null = unknown size), or null. */
function element(b, o, end) {
  const id = vint(b, o, end, true);
  if (!id || id.len > 4) return null;
  const size = vint(b, o + id.len, end);
  if (!size) return null;
  const body = o + id.len + size.len;
  return { id: id.value, body, end: size.unknown ? null : body + size.value };
}
const uintAt = (b, o, end) => { let v = 0; for (let i = o; i < end; i++) v = v * 256 + b[i]; return v; };
function floatAt(b, o, end) {
  const n = end - o;
  if (n !== 4 && n !== 8) return null;
  const dv = new DataView(b.buffer, b.byteOffset + o, n);
  return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
}
function nextCluster(b, from, end) {
  for (let p = from; p + 4 <= end; p++) {
    if (b[p] === CLUSTER_ID_BYTES[0] && b[p + 1] === CLUSTER_ID_BYTES[1] && b[p + 2] === CLUSTER_ID_BYTES[2] && b[p + 3] === CLUSTER_ID_BYTES[3]) return p;
  }
  return -1;
}

export function webmDuration(bytes) {
  const b = bytes;
  const len = b.length;
  const head = element(b, 0, len);
  if (!head || head.id !== E.EBML || head.end == null || head.end > len) return fail();
  let docType = "";
  for (let o = head.body; o < head.end;) {
    const el = element(b, o, head.end);
    if (!el || el.end == null || el.end > head.end) return fail();
    if (el.id === E.DocType) docType = ascii(b, el.body, el.end - el.body).replace(/\0+$/, "");
    o = el.end;
  }
  if (docType !== "webm" && docType !== "matroska") return fail();
  // the Segment (skipping any Void before it)
  let o = head.end, seg = null;
  while (o < len) {
    const el = element(b, o, len);
    if (!el) return fail();
    if (el.id === E.Segment) { seg = el; break; }
    if (el.id !== E.Void || el.end == null) return fail();
    o = el.end;
  }
  if (!seg) return fail();
  const segEnd = seg.end == null ? len : Math.min(seg.end, len);   // a truncated file plays what it holds
  let scale = 1000000, infoDuration = null, sawTracks = false;
  const tracks = new Map();   // number → true (every track must be Opus audio)
  let maxEnd = 0, opusSamples = 0, blocks = 0, bad = false;
  const readBlock = (at, end, clusterTime, duration) => {
    const tn = vint(b, at, end);
    if (!tn || tn.unknown) { bad = true; return; }
    const p = at + tn.len;
    if (p + 3 > end) { bad = true; return; }
    const raw = (b[p] << 8) | b[p + 1];
    const rel = raw >= 0x8000 ? raw - 0x10000 : raw;
    const flags = b[p + 2];
    if ((flags >> 1) & 3) { bad = true; return; }   // laced frames: unreadable (browsers never lace)
    if (!sawTracks) { bad = true; return; }         // a block before the track list: nothing to vouch for
    if (!tracks.has(tn.value)) return;              // a block of no known track decodes to nothing
    const samples = opusPacketSamples(b, p + 3, end - (p + 3));
    opusSamples += samples; blocks++;
    const start = clusterTime + rel;
    const dur = duration != null ? duration : (samples / 48000) * 1e9 / scale;
    if (start + dur > maxEnd) maxEnd = start + dur;
  };
  o = seg.body;
  let guard = 0;
  while (o < segEnd && !bad) {
    if (++guard > 2000000) return fail();
    const el = element(b, o, segEnd);
    if (!el || !SEGMENT_CHILDREN.has(el.id)) {
      // a demuxer resyncs on the next Cluster: so does the reader (nothing hides behind junk)
      const next = nextCluster(b, o + 1, segEnd);
      if (next < 0) break;
      o = next; continue;
    }
    if (el.id === E.Cluster) {
      const cEnd = el.end == null ? segEnd : Math.min(el.end, segEnd);
      let clusterTime = 0, p = el.body, junk = false;
      while (p < cEnd && !bad) {
        if (++guard > 2000000) return fail();
        const c = element(b, p, cEnd);
        if (!c) { junk = true; break; }   // the segment's resync scan goes on from here
        // a Cluster of unknown size ends where an element that isn't one of its children starts
        if (!CLUSTER_CHILDREN.has(c.id)) { if (el.end == null) break; p = c.end == null ? cEnd : c.end; continue; }
        if (c.end == null) { bad = true; break; }
        const ce = Math.min(c.end, cEnd);
        if (c.id === E.Timecode) clusterTime = uintAt(b, c.body, ce);
        else if (c.id === E.SimpleBlock) readBlock(c.body, ce, clusterTime, null);
        else if (c.id === E.BlockGroup) {
          let blockAt = -1, blockEnd = -1, duration = null;
          for (let q = c.body; q < ce;) {
            const g = element(b, q, ce);
            if (!g || g.end == null) { bad = true; break; }
            if (g.id === E.Block) { blockAt = g.body; blockEnd = Math.min(g.end, ce); }
            else if (g.id === E.BlockDuration) duration = uintAt(b, g.body, Math.min(g.end, ce));
            q = g.end;
          }
          if (blockAt >= 0) readBlock(blockAt, blockEnd, clusterTime, duration);
        }
        p = ce;
      }
      o = junk || (el.end == null && p < cEnd) ? p : cEnd;
      continue;
    }
    if (el.end == null) return fail();   // only a Cluster may have an unknown size here
    const end = Math.min(el.end, segEnd);
    if (el.id === E.Info) {
      for (let q = el.body; q < end;) {
        const c = element(b, q, end);
        if (!c || c.end == null) return fail();
        if (c.id === E.TimecodeScale) scale = uintAt(b, c.body, Math.min(c.end, end));
        else if (c.id === E.Duration) infoDuration = floatAt(b, c.body, Math.min(c.end, end));
        q = c.end;
      }
    } else if (el.id === E.Tracks) {
      sawTracks = true;
      for (let q = el.body; q < end;) {
        const t = element(b, q, end);
        if (!t || t.end == null) return fail();
        if (t.id === E.TrackEntry) {
          let number = null, type = null, codec = "";
          for (let r = t.body; r < Math.min(t.end, end);) {
            const f = element(b, r, Math.min(t.end, end));
            if (!f || f.end == null) return fail();
            if (f.id === E.TrackNumber) number = uintAt(b, f.body, f.end);
            else if (f.id === E.TrackType) type = uintAt(b, f.body, f.end);
            else if (f.id === E.CodecID) codec = ascii(b, f.body, f.end - f.body).replace(/\0+$/, "");
            r = f.end;
          }
          // only Opus audio: another codec (or a video track) is a container this reader can't vouch for
          if (number == null || type !== 2 || codec !== "A_OPUS") return fail();
          tracks.set(number, true);
        }
        q = t.end;
      }
    }
    o = end;
  }
  if (bad || !sawTracks || !tracks.size || !(scale > 0)) return fail();
  const byTime = Math.max(infoDuration != null && Number.isFinite(infoDuration) && infoDuration > 0 ? infoDuration : 0, maxEnd) * scale / 1e9;
  const seconds = Math.max(byTime, opusSamples / 48000);
  if (!Number.isFinite(seconds) || seconds >= MAX_SECONDS) return fail();
  return { seconds, reason: null, blocks };
}

/* ─────────────────────────────── Ogg ─────────────────────────────── */

export function oggDuration(bytes) {
  const b = bytes;
  const len = b.length;
  const streams = new Map();   // serial → the current logical stream
  const done = [];             // finished (or replaced) streams
  let o = 0, pages = 0;
  const findOggS = (from) => { for (let p = from; p + 4 <= len; p++) if (b[p] === 0x4f && b[p + 1] === 0x67 && b[p + 2] === 0x67 && b[p + 3] === 0x53) return p; return -1; };
  const onPacket = (st, pk) => {
    const n = st.packets++;
    if (n === 0) {
      if (pk.len >= 19 && pk.head.startsWith("OpusHead")) { st.codec = "opus"; st.rate = 48000; }
      else if (pk.len >= 30 && pk.head.startsWith("\x01vorbis")) {
        st.codec = "vorbis"; st.rate = pk.rate; st.shortBlock = pk.shortBlock;
        if (!(st.rate >= 1000 && st.rate <= 768000) || !(st.shortBlock >= 64)) st.codec = "bad";
      } else st.codec = "bad";
      return;
    }
    if (st.codec === "opus" && n >= 2) st.samples += opusPacketSamples(pk.first, 0, pk.len);
    else if (st.codec === "vorbis" && n >= 3) st.audioPackets++;
  };
  while (o + 27 <= len) {
    if (!(b[o] === 0x4f && b[o + 1] === 0x67 && b[o + 2] === 0x67 && b[o + 3] === 0x53) || b[o + 4] !== 0) {
      const next = findOggS(o + 1);   // a demuxer resyncs on the next capture pattern
      if (next < 0) break;
      o = next; continue;
    }
    const type = b[o + 5];
    const gLo = u32le(b, o + 6), gHi = u32le(b, o + 10);
    const serial = u32le(b, o + 14);
    const nseg = b[o + 26];
    if (o + 27 + nseg > len) break;
    let bodyLen = 0;
    for (let i = 0; i < nseg; i++) bodyLen += b[o + 27 + i];
    const bodyStart = o + 27 + nseg;
    if (bodyStart + bodyLen > len) break;   // a truncated last page carries no whole packet
    if (++pages > 1000000) return fail();
    // the beginning of a stream — flagged, or a serial not seen before (a demuxer opens a stream for
    // it and reads its first packet as the codec header); a new start on a known serial is a chain link
    if ((type & 0x02) || !streams.has(serial)) {
      if (streams.has(serial)) done.push(streams.get(serial));
      streams.set(serial, { codec: "", rate: 0, shortBlock: 0, packets: 0, samples: 0, audioPackets: 0, maxGranule: 0, partial: null });
    }
    const st = streams.get(serial);
    if (st) {
      if (!(type & 0x01)) st.partial = null;   // not a continuation: an unfinished packet is dropped
      let p = bodyStart;
      for (let i = 0; i < nseg; i++) {
        const lace = b[o + 27 + i];
        if (!st.partial) {
          // the first bytes are all a packet's kind (and an Opus TOC) need
          st.partial = { len: 0, first: new Uint8Array(2), head: ascii(b, p, Math.min(lace, 8)), rate: lace >= 16 ? u32le(b, p + 12) : 0,
            shortBlock: lace >= 29 ? 1 << (b[p + 28] & 0x0f) : 0 };
          st.partial.first[0] = lace >= 1 ? b[p] : 0; st.partial.first[1] = lace >= 2 ? b[p + 1] : 0;
        } else if (st.partial.len === 1 && lace >= 1) {
          st.partial.first[1] = b[p];
        }
        st.partial.len += lace;
        p += lace;
        if (lace < 255) { onPacket(st, st.partial); st.partial = null; }
      }
      if (!(gLo === 0xffffffff && gHi === 0xffffffff)) {
        if (gHi >= 0x200000) return fail();   // beyond 2^53 samples: nothing to vouch for
        const g = gHi * 4294967296 + gLo;
        if (g > st.maxGranule) st.maxGranule = g;
      }
    }
    o = bodyStart + bodyLen;
  }
  const all = [...done, ...streams.values()];
  if (!all.length) return fail();
  let seconds = 0;
  for (const st of all) {
    if (st.codec === "opus") seconds += Math.max(st.maxGranule, st.samples) / 48000;
    else if (st.codec === "vorbis") seconds += Math.max(st.maxGranule, Math.max(0, st.audioPackets - 1) * (st.shortBlock / 2)) / st.rate;
    else return fail();   // a stream of a codec the reader can't vouch for (or no identification header)
  }
  if (!Number.isFinite(seconds) || seconds >= MAX_SECONDS) return fail();
  return { seconds, reason: null };
}

/* ─────────────────────────────── WAV ─────────────────────────────── */

export function wavDuration(bytes) {
  const b = bytes;
  const len = b.length;
  let o = 12, fmt = null, dataStart = -1;
  for (let n = 0; o + 8 <= len && n < 1000; n++) {
    const id = fourcc(b, o), size = u32le(b, o + 4), body = o + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > len) return fail();
      let format = u16le(b, body);
      if (format === 0xfffe) { if (size < 40 || body + 40 > len) return fail(); format = u16le(b, body + 24); }
      fmt = { format, channels: u16le(b, body + 2), rate: u32le(b, body + 4), bits: u16le(b, body + 14) };
    } else if (id === "data") { dataStart = body; break; }
    o = body + size + (size & 1);
  }
  if (!fmt || dataStart < 0) return fail();
  const { format, channels, rate, bits } = fmt;
  const okBits = format === 1 ? [8, 16, 24, 32].includes(bits) : format === 3 ? [32, 64].includes(bits) : (format === 6 || format === 7) ? bits === 8 : false;
  if (!okBits || !(channels >= 1 && channels <= 64) || !(rate >= 1000 && rate <= 768000)) return fail();
  const byteRate = rate * channels * (bits / 8);
  // to the end of the file: a data chunk that says it is shorter than what follows it can't hide the rest
  const seconds = Math.max(0, len - dataStart) / byteRate;
  if (!Number.isFinite(seconds) || seconds >= MAX_SECONDS) return fail();
  return { seconds, reason: null };
}

/* ─────────────────────────────── MP4 / MOV (audio) ─────────────────────────────── */

function boxesIn(b, start, end, cap = 100000) {
  const out = [];
  let o = start;
  while (o + 8 <= end && out.length < cap) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let head = 8;
    if (size === 1) { if (o + 16 > end) return null; size = u64(b, o + 8); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head || o + size > end) return null;
    out.push({ type, start: o, body: o + head, end: o + size });
    o += size;
  }
  return o === end || o + 8 > end ? out : null;
}
const fullVersion = (b, box) => (box.end - box.body >= 4 ? b[box.body] : -1);
const flags24 = (b, box) => (b[box.body + 1] << 16) | (b[box.body + 2] << 8) | b[box.body + 3];
function has4cc(b, start, end, set) {
  for (let p = start; p + 4 <= end; p++) { const t = fourcc(b, p); if (set.has(t)) return true; }
  return false;
}
const HIDDEN_MOVIE = new Set(["cmov", "dcom", "cmvd", "moov"]);

/* The audio facts of an MP4: its tracks (timescale, handler, sample entry, rate, sample counts and
   timing) and, for a fragmented file, each track's fragment timing. null = malformed. */
function mp4AudioFacts(b) {
  const top = boxesIn(b, 0, b.length);
  if (!top || !top.length || top[0].type !== "ftyp") return null;
  const tracks = new Map();   // track_ID → facts
  const trex = new Map();     // track_ID → default sample duration
  const frag = new Map();     // track_ID → { sum, maxEnd, count }
  let fragmented = false, moovSeen = false, mehd = 0, movieScale = 0;
  for (const box of top) {
    if (box.type === "moov") {
      if (moovSeen) return null;
      moovSeen = true;
      if (has4cc(b, box.body, box.end, HIDDEN_MOVIE)) return null;   // a compressed / nested movie
      const kids = boxesIn(b, box.body, box.end);
      if (!kids) return null;
      for (const k of kids) {
        if (k.type === "mvhd") { const v = fullVersion(b, k); if (k.end - k.body < (v === 1 ? 24 : 16)) return null; movieScale = u32(b, k.body + (v === 1 ? 20 : 12)); }
        else if (k.type === "mvex") {
          fragmented = true;
          for (const x of boxesIn(b, k.body, k.end) || []) {
            if (x.type === "trex" && x.end - x.body >= 24) trex.set(u32(b, x.body + 4), u32(b, x.body + 12));
            if (x.type === "mehd") { const v = fullVersion(b, x); mehd = Math.max(mehd, v === 1 ? u64(b, x.body + 4) : u32(b, x.body + 4)); }
          }
        } else if (k.type === "trak") {
          const t = { id: null, scale: 0, mdhd: 0, handler: "", entry: "", rate: 0, stts: 0, count: 0 };
          const walk = (s, e, depth) => {
            const list = boxesIn(b, s, e);
            if (!list) return false;
            for (const x of list) {
              if (x.type === "tkhd") { const v = fullVersion(b, x); if (x.end - x.body < (v === 1 ? 24 : 16)) return false; t.id = u32(b, x.body + (v === 1 ? 20 : 12)); }
              else if (x.type === "mdhd") { const v = fullVersion(b, x); if (x.end - x.body < (v === 1 ? 32 : 20)) return false; t.scale = u32(b, x.body + (v === 1 ? 20 : 12)); t.mdhd = v === 1 ? u64(b, x.body + 24) : u32(b, x.body + 16); }
              else if (x.type === "hdlr" && x.end - x.body >= 12) t.handler = fourcc(b, x.body + 8);
              else if (x.type === "stsd" && x.end - x.body >= 16) {
                const e0 = x.body + 8;
                t.entry = fourcc(b, e0 + 4);
                if (e0 + 36 <= x.end) t.rate = u32(b, e0 + 32) / 65536;
              } else if (x.type === "stts" && x.end - x.body >= 8) {
                const n = u32(b, x.body + 4);
                if (8 + n * 8 > x.end - x.body) return false;
                for (let i = 0, p = x.body + 8; i < n; i++, p += 8) t.stts += u32(b, p) * u32(b, p + 4);
              } else if (x.type === "stsz" && x.end - x.body >= 12) t.count = u32(b, x.body + 8);
              else if (["mdia", "minf", "stbl"].includes(x.type) && depth < 4) { if (walk(x.body, x.end, depth + 1) === false) return false; }
            }
            return true;
          };
          if (walk(k.body, k.end, 0) === false || t.id == null) return null;
          tracks.set(t.id, t);
        }
      }
    } else if (box.type === "moof") {
      fragmented = true;
      const kids = boxesIn(b, box.body, box.end);
      if (!kids) return null;
      for (const traf of kids) {
        if (traf.type !== "traf") continue;
        let id = null, defDur = null, base = null, dur = 0, count = 0;
        const parts = boxesIn(b, traf.body, traf.end);
        if (!parts) return null;
        for (const x of parts) {
          if (x.type === "tfhd" && x.end - x.body >= 8) {
            const f = flags24(b, x);
            id = u32(b, x.body + 4);
            let p = x.body + 8;
            if (f & 0x01) p += 8;
            if (f & 0x02) p += 4;
            if (f & 0x08) { if (p + 4 > x.end) return null; defDur = u32(b, p); }
          } else if (x.type === "tfdt" && x.end - x.body >= 8) {
            base = fullVersion(b, x) === 1 ? (x.end - x.body >= 12 ? u64(b, x.body + 4) : null) : u32(b, x.body + 4);
          } else if (x.type === "trun" && x.end - x.body >= 8) {
            const f = flags24(b, x);
            const n = u32(b, x.body + 4);
            let p = x.body + 8;
            if (f & 0x01) p += 4;
            if (f & 0x04) p += 4;
            const per = ((f & 0x100) ? 4 : 0) + ((f & 0x200) ? 4 : 0) + ((f & 0x400) ? 4 : 0) + ((f & 0x800) ? 4 : 0);
            if (p + n * per > x.end) return null;   // a run claiming more samples than its box holds
            const fallback = defDur != null ? defDur : (id != null && trex.has(id) ? trex.get(id) : null);
            for (let i = 0; i < n; i++, p += per) {
              if (f & 0x100) dur += u32(b, p);
              else if (fallback != null) dur += fallback;
              else return null;   // no duration anywhere: nothing to vouch for
            }
            count += n;
          }
        }
        if (id == null) return null;
        const fr = frag.get(id) || { sum: 0, maxEnd: 0, count: 0 };
        const startAt = base != null ? base : fr.sum;
        fr.maxEnd = Math.max(fr.maxEnd, startAt + dur);
        fr.sum += dur; fr.count += count;
        frag.set(id, fr);
      }
    }
  }
  if (!moovSeen) return null;
  return { tracks, frag, fragmented, mehd, movieScale };
}

export async function mp4AudioDuration(bytes) {
  const facts = mp4AudioFacts(bytes);
  if (!facts) return fail();
  // AAC's frames are 1024 samples: the sample count is a length no timing box can shorten. The rate
  // is the sample entry's (16.16), else the track's timescale (a QuickTime v2 sound description
  // keeps its real rate elsewhere and writes 1.0 there)
  const aacRate = (t) => (t.rate >= 8000 && t.rate <= 96000 ? t.rate : t.scale >= 8000 && t.scale <= 96000 ? t.scale : 0);
  const frameSeconds = (t, extra = 0) => (t.entry === "mp4a" && aacRate(t) > 0 ? ((t.count + extra) * 1024) / aacRate(t) : 0);
  if (!facts.fragmented) {
    const r = await mp4InfoFromBytes(bytes);
    if (r.seconds == null) return fail();
    let seconds = r.seconds;
    for (const t of facts.tracks.values()) seconds = Math.max(seconds, frameSeconds(t));
    return seconds < MAX_SECONDS ? { seconds, reason: null } : fail();
  }
  // a FRAGMENTED recording (Safari): AAC audio tracks only, each at the largest of its fragments'
  // timing, its moov timing and its frame count
  if (!facts.tracks.size) return fail();
  let seconds = facts.movieScale > 0 ? facts.mehd / facts.movieScale : 0;
  for (const [id, t] of facts.tracks) {
    if (t.handler !== "soun" || t.entry !== "mp4a" || !(t.scale > 0) || !(aacRate(t) > 0)) return fail();
    const fr = facts.frag.get(id) || { sum: 0, maxEnd: 0, count: 0 };
    const ticks = Math.max(fr.sum, fr.maxEnd, t.mdhd, t.stts);
    seconds = Math.max(seconds, ticks / t.scale, frameSeconds(t, fr.count));
  }
  for (const id of facts.frag.keys()) if (!facts.tracks.has(id)) return fail();   // fragments of no track
  if (!Number.isFinite(seconds) || seconds >= MAX_SECONDS) return fail();
  return { seconds, reason: null };
}

/**
 * The length of a recording held in memory: { container, seconds, reason } — reason null when read,
 * "format" when the first bytes name no accepted container, "unreadable" otherwise.
 */
export async function audioDurationFromBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const container = sniffAudioContainer(b);
  if (!container) return { container: null, seconds: null, reason: "format" };
  let r;
  try {
    r = container === "webm" ? webmDuration(b)
      : container === "ogg" ? oggDuration(b)
      : container === "wav" ? wavDuration(b)
      : await mp4AudioDuration(b);
  } catch (_e) {
    r = fail();
  }
  return { container, seconds: r.seconds, reason: r.reason };
}

#!/usr/bin/env node
/* test-server-charging.mjs — SERVER CHARGING, GATES & PRICES (billing fixes, owner decisions
   2026-09-30). Offline: no network, no Supabase project, no credentials.

   What the server now does (supabase/functions/image-proxy + blender-bridge):
     * 1 credit = $0.01 of provider cost (Option A) — but only from the switch day: every price
       is converted with the LIVE unit from turn_credit_regime() ($0.03 until
       supabase/billing-switch.sql runs, $0.01 after), so the proxy can ship right after
       billing-v2.sql;
     * every paid provider call HOLDS its credits first (turn_hold_credits) and SETTLES the
       actual cost or RELEASES the hold after — text, images, video (held at submit, settled on
       the poll that sees it finish, released on failure or timeout), voice (charged now);
     * plan TIERS and the TRIAL rule are enforced on the server (billing-policy.mjs);
     * corrected price tables (GPT-5.5, Gemini 3.5 Flash + thinking tokens, Kimi, Nano Banana
       at fal's prices incl. 4K, GPT Image 2 by size), and only known models on the direct
       Google image route;
     * Frances: Opus 5 and Opus 5.5 both ride the free path during the move, prompt caching is
       passed through, and the daily cap follows the plan (5 / 15 / 30 / 50; admins exempt);
     * errors never leak provider accounts, keys or database internals.

   Sections
     A  prices (billing-pricing.mjs): the anchor and the live unit, text / image / video / voice
     B  who may run what (billing-policy.mjs): tiers, trial, frozen, Frances caps
     C  the hold client and the signed video-hold token (billing-holds.mjs)
     D  public errors (public-errors.mjs)
     E  Frances's free path (muse-billing.mjs, frances-limit.mjs): the Opus 5.5 move, caching
     F  THE PROXY — the real image-proxy/index.ts run in Node against the REAL billing SQL
        (supabase/credits.sql + frances-daily-limit.sql, and billing-switch.sql for the switch)
        on PGlite, with stub providers: holds / settles / releases per route, tier and trial
        refusals, Frances caps per plan, the Opus 5.5 transition, the switch day
     G  Blender Studio (blender-bridge): the live unit, plan gate, hold / settle / release
   ROUND 2 (2026-09-30): S1 the reconcile_holds housekeeping op (C8, F26), S2 Blender's
   reconciliation / answered-assistant holds / re-hold (G6-G8, F27), S3 canonical request ids and
   the drain window (C7, F25), S4 robust MP4 lengths and output-only settles (A12, C6, F19, F22),
   S5 the dense-ASCII text bound (A13).
   ROUND 3 (2026-09-30): S1 the text estimate counts exactly what each provider is sent — one
   messageText normaliser, array content included (A14, F28); S2 fragmented MP4s are unreadable and
   every track's sample table counts (C6, C9, F31); S3 a finished mesh settles only with a trusted
   GLB (G7, G9, F27); S4 a temporary status failure on a poll is result_pending (F29); S5 an empty
   balance hears "add credits", not "a lighter engine" (B7, F30); S7 thousands separators in the
   refusals (B7, G8, G9); S8 a hold-less poll must spell its id as a UUID (C7, F32). The webhook's
   legacy_unit (S6) is in scripts/test-stripe-webhook.mjs (J1, J2, J6).
   ROUND 4 (2026-09-30): S1 a writing request's images must be PNG / JPEG / WebP / GIF / HEIC data
   URLs (and bytes), on every engine and the direct Google image route (A16, F33); S2 line breaks and
   short letter runs can't slip under the text bound (A13, A15, F34); S3 the MP4 reader finds fragment
   and timing boxes at any depth, counts edit lists, extends a short stts (C10); S4 speech-to-text is
   held at 6 kbps and settled at the reported length (A9, A17, F35); S5 a refused attach is logged
   (F36); S7 (owner decision) Motion Control / editing holds follow the read length x 1.1 + 1 s and a
   longer output is capped, logged and recorded (A12, A18, C11, F19, F37). The webhook's PACK_GRANT
   log (S6) is in scripts/test-stripe-webhook.mjs (J1, J6) and test-stripe-metadata.mjs (O).
   ROUND 5 (2026-09-30): S1 (owner decision 2) speech-to-text is held and settled on the recording's
   container duration — WebM with unknown-size Segment / Clusters, Ogg Opus, fragmented MP4, WAV —
   never word timestamps; an empty transcript is charged; bogus models, unreadable containers and
   recordings longer than the app ever makes (6 minutes) get a 400 before any hold (A9, A17, A19, F11,
   F35); S2 a compressed
   QuickTime movie (cmov / dcom / cmvd) or a nested moov is unreadable (C12, F37); S3 (owner decision
   1) videos a render is sized or billed by are copied to server-only snapshots that fal renders
   from, deleted on settle / release / a refused submit / after two days, and a failed copy holds
   the maximum (A20, C13, F37, F38); S4 image prompts over 40,000 characters are refused (F39). The
   storage rules that keep the snapshots server-only are executed in
   scripts/test-storage-billing-snapshots.mjs.

   node scripts/test-server-charging.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";
import * as POL from "../supabase/functions/image-proxy/billing-policy.mjs";
import * as H from "../supabase/functions/image-proxy/billing-holds.mjs";
import { GENERIC_PROVIDER_ERROR, isInternalError, publicError } from "../supabase/functions/image-proxy/public-errors.mjs";
import { MUSE_LIMITS, MUSE_MODEL, MUSE_MODELS, museRefusal, museRunModel, textBillingKind } from "../supabase/functions/image-proxy/muse-billing.mjs";
import { isFalMediaUrl, mp4DurationFromBytes, mp4InfoFromBytes, moovDurations, probeMp4Duration, probeMp4Info, readMp4Duration } from "../supabase/functions/image-proxy/media-length.mjs";
import * as VR from "../supabase/functions/image-proxy/video-reconcile.mjs";
import { KLING_MOTION_ENDPOINTS } from "../supabase/functions/image-proxy/seedance-capabilities.mjs";
import * as SR from "../supabase/functions/blender-bridge/studio-reconcile.mjs";
import { FRANCES_DAILY_LIMIT_DEFAULT, francesEffectiveLimit } from "../supabase/functions/image-proxy/frances-limit.mjs";
import {
  ASSISTANT_MAX_INPUT_TOKENS, ASSISTANT_MAX_OUTPUT_TOKENS, assistantEstimate, assistantHoldCredits, createStudioService, meshEstimate, studioCredits,
} from "../supabase/functions/blender-bridge/studio-service.mjs";
import { createSupabaseAdapter } from "../supabase/functions/blender-bridge/supabase-adapter.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");
const j = (x) => JSON.stringify(x);
let passed = 0, failed = 0, skipped = 0;
const counts = {};
let current = "";
const section = (t) => { current = t[0]; console.log("\n=== " + t + " ==="); };
async function test(name, fn) {
  try { await fn(); passed++; counts[current] = (counts[current] || 0) + 1; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ─── a synthetic MP4 (repair F2): ftyp + moov(mvhd) + mdat, moov first or last ─── */
const cat = (parts) => { const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const ascii = (t) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
const be32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const be64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const mbox = (type, ...parts) => { const body = cat(parts); return cat([be32(8 + body.length), ascii(type), body]); };
function mvhdBox(seconds, version = 0, timescale = 1000) {
  const d = Math.round(seconds * timescale);
  const rest = new Uint8Array(80);
  return version === 1
    ? mbox("mvhd", new Uint8Array([1, 0, 0, 0]), be64(0), be64(0), be32(timescale), be64(d), rest)
    : mbox("mvhd", new Uint8Array([0, 0, 0, 0]), be32(0), be32(0), be32(timescale), be32(d), rest);
}
function mp4(seconds, { moovLast = false, mdatBytes = 2000, version = 0, largeMdat = false, mvhdSecond = false } = {}) {
  const ftyp = mbox("ftyp", ascii("isom"), be32(512), ascii("isomiso2avc1mp41"));
  const moov = mvhdSecond ? mbox("moov", mbox("iods", new Uint8Array(16)), mvhdBox(seconds, version)) : mbox("moov", mvhdBox(seconds, version), mbox("trak", new Uint8Array(40)));
  const payload = new Uint8Array(mdatBytes);
  const mdat = largeMdat ? cat([be32(1), ascii("mdat"), be64(16 + mdatBytes), payload]) : mbox("mdat", payload);
  return cat(moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
/* ROUND 2 (S4): a synthetic MP4 with real tracks — tkhd (movie timescale 1000), mdia/mdhd (own
   timescale), hdlr, minf/stbl/stts — so a file whose mvhd LIES while its tracks don't can be built.
   tracks: [{ handler: "vide" | "soun", tkhd: s, mdhd: s, timescale, stts: [[count, delta], …], v1 }] */
const u8 = (...n) => new Uint8Array(n);
function tkhdBox(seconds, version = 0) {
  const d = Math.round(seconds * 1000);
  return version === 1 ? mbox("tkhd", u8(1, 0, 0, 3), be64(0), be64(0), be32(1), be32(0), be64(d), new Uint8Array(60))
    : mbox("tkhd", u8(0, 0, 0, 3), be32(0), be32(0), be32(1), be32(0), be32(d), new Uint8Array(60));
}
function mdhdBox(seconds, timescale, version = 0) {
  const d = Math.round(seconds * timescale);
  return version === 1 ? mbox("mdhd", u8(1, 0, 0, 0), be64(0), be64(0), be32(timescale), be64(d), u8(0, 0, 0, 0))
    : mbox("mdhd", u8(0, 0, 0, 0), be32(0), be32(0), be32(timescale), be32(d), u8(0, 0, 0, 0));
}
const hdlrBox = (handler) => mbox("hdlr", u8(0, 0, 0, 0), be32(0), ascii(handler), new Uint8Array(12), u8(0));
const sttsBox = (entries) => mbox("stts", u8(0, 0, 0, 0), be32(entries.length), ...entries.flatMap(([c, dl]) => [be32(c), be32(dl)]));
function trakBox({ handler = "vide", tkhd, mdhd, timescale = 12800, stts, v1 = false }) {
  const kids = [];
  if (tkhd != null) kids.push(tkhdBox(tkhd, v1 ? 1 : 0));
  const media = [];
  if (mdhd != null) media.push(mdhdBox(mdhd, timescale, v1 ? 1 : 0));
  media.push(hdlrBox(handler));
  if (stts) media.push(mbox("minf", mbox("stbl", sttsBox(stts))));
  kids.push(mbox("mdia", ...media));
  return mbox("trak", ...kids);
}
function mp4Tracks({ mvhd, tracks = [], moovLast = false, mdatBytes = 2000 }) {
  const ftyp = mbox("ftyp", ascii("isom"), be32(512), ascii("isomiso2avc1mp41"));
  const moov = mbox("moov", ...(mvhd != null ? [mvhdBox(mvhd)] : []), ...tracks.map(trakBox));
  const mdat = mbox("mdat", new Uint8Array(mdatBytes));
  return cat(moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
/* 25 fps video: n seconds = n*25 samples of 512 ticks at timescale 12800 */
const fps25 = (secs) => [[Math.round(secs * 25), 512]];
/* the reviewer's forged file: mvhd says `lie` seconds, the tracks say `real` */
const forgedMp4 = (lie, real, opts = {}) => mp4Tracks({ mvhd: lie, tracks: [{ handler: "vide", tkhd: real, mdhd: real, stts: fps25(real) }, { handler: "soun", tkhd: real, mdhd: real, timescale: 48000, stts: [[Math.round(real * 48000 / 1024), 1024]] }], ...opts });
/* ROUND 3 (S2): a FRAGMENTED MP4 — its moov declares `lie` seconds everywhere (mvhd, tkhd, mdhd;
   an empty sample table) while its samples sit in movie fragments (moof/traf/trun + mdat) that run
   `real` seconds, which mvex/mehd admits. withMvex:false leaves mvex out (the moof after the moov
   still gives it away); moovLast puts the fragments before the moov; firstMdat puts a large plain
   mdat between the moov and the first fragment (so the fragment is only found by walking on). */
function fragmentedMp4(lie, real, { withMvex = true, moovLast = false, firstMdat = 0, fragments = 2 } = {}) {
  const ftyp = mbox("ftyp", ascii("iso6"), be32(512), ascii("iso6mp41"));
  const mvex = mbox("mvex", mbox("mehd", u8(0, 0, 0, 0), be32(Math.round(real * 1000))), mbox("trex", u8(0, 0, 0, 0), be32(1), be32(1), be32(512), be32(0), be32(0)));
  const moov = mbox("moov", mvhdBox(lie), trakBox({ tkhd: lie, mdhd: lie, stts: [] }), ...(withMvex ? [mvex] : []));
  const perFrag = Math.max(1, Math.round((real * 25) / fragments));
  const frag = (seq) => cat([mbox("moof", mbox("mfhd", u8(0, 0, 0, 0), be32(seq)), mbox("traf", mbox("tfhd", u8(0, 2, 0, 0), be32(1)), mbox("trun", u8(0, 0, 0, 0), be32(perFrag)))), mbox("mdat", new Uint8Array(1500))]);
  const frags = Array.from({ length: fragments }, (_, i) => frag(i + 1));
  const plain = firstMdat ? [mbox("mdat", new Uint8Array(firstMdat))] : [];
  return cat(moovLast ? [ftyp, ...frags, moov] : [ftyp, moov, ...plain, ...frags]);
}
/* the BODY of a file's top-level moov box (what moovDurations reads) */
const moovBody = (bytes) => { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 0; o + 8 <= bytes.length;) { const size = dv.getUint32(o); if (String.fromCharCode(...bytes.subarray(o + 4, o + 8)) === "moov") return bytes.subarray(o + 8, o + size); if (size < 8) break; o += size; }
  throw new Error("no moov"); };
/* serve bytes like a CDN with HTTP Range, recording each Range asked */
const rangedCdn = (bytes, seen = []) => async (_url, init) => {
  const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); seen.push(init.headers.Range);
  const a = Number(m[1]), b = Math.min(Number(m[2]), bytes.length - 1);
  if (a >= bytes.length) return new Response("", { status: 416 });
  return new Response(bytes.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${bytes.length}` } });
};

/* ROUND 5 (S2): a QuickTime COMPRESSED movie — the outer moov says `outer` seconds, while the movie a
   demuxer plays sits zlib-deflated in moov/cmov/cmvd and says `real` (the verifier's cmovMp4). */
function cmovMp4(outer, real, { outerTrak = false } = {}) {
  const inner = mbox("moov", mvhdBox(real), trakBox({ handler: "vide", tkhd: real, mdhd: real, stts: fps25(real) }));
  const z = new Uint8Array(zlib.deflateSync(Buffer.from(inner), { level: 9 }));
  const cmov = mbox("cmov", mbox("dcom", ascii("zlib")), mbox("cmvd", be32(inner.length), z));
  const ftyp = mbox("ftyp", ascii("qt  "), be32(512), ascii("qt  "));
  const moov = mbox("moov", mvhdBox(outer), ...(outerTrak ? [trakBox({ handler: "vide", tkhd: outer, mdhd: outer, stts: fps25(outer) })] : []), cmov);
  return cat([ftyp, moov, mbox("mdat", new Uint8Array(4000))]);
}

/* ─── ROUND 5 (S1): recordings as the browsers really write them ─── */
const le16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const ebmlId = (id) => { const out = []; let v = id; while (v > 0) { out.unshift(v & 255); v = Math.floor(v / 256); } return new Uint8Array(out); };
const ebmlSize = (n) => { for (let len = 1; len <= 8; len++) if (n < 2 ** (7 * len) - 1) { const out = new Uint8Array(len); let v = n; for (let i = len - 1; i >= 0; i--) { out[i] = v & 255; v = Math.floor(v / 256); } out[0] |= 1 << (8 - len); return out; } throw new Error("too big"); };
const EBML_UNKNOWN = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const ebml = (id, ...parts) => { const body = cat(parts); return cat([ebmlId(id), ebmlSize(body.length), body]); };
const ebmlOpen = (id, ...parts) => cat([ebmlId(id), EBML_UNKNOWN, ...parts]);   // an element of UNKNOWN size
const uintB = (n) => { const out = []; let v = n; do { out.unshift(v & 255); v = Math.floor(v / 256); } while (v > 0); return new Uint8Array(out); };
const f64 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return b; };
const OPUS_HEAD = cat([ascii("OpusHead"), u8(1, 1), le16(312), le32(48000), le16(0), u8(0)]);
const OPUS_SILENCE = u8(0xf8, 0xff, 0xfe);   // one 20 ms CELT frame (TOC config 31, code 0): what silence encodes to
/* Chrome's MediaRecorder WebM ("audio/webm;codecs=opus"): EBML header (DocType webm), a Segment of
   UNKNOWN size, Info with TimecodeScale 1 ms and NO Duration, one Opus track, Clusters of UNKNOWN
   size holding SimpleBlocks of 20 ms Opus packets. packet(i) → frame i's packet (null: none, DTX). */
function chromeWebm(seconds, { frameMs = 20, packet = () => OPUS_SILENCE, clusterMs = 10000, duration = null, codec = "A_OPUS", lace = false } = {}) {
  const frames = Math.round((seconds * 1000) / frameMs);
  const head = ebml(0x1a45dfa3, ebml(0x4286, uintB(1)), ebml(0x42f7, uintB(1)), ebml(0x42f2, uintB(4)), ebml(0x42f3, uintB(8)), ebml(0x4282, ascii("webm")), ebml(0x4287, uintB(4)), ebml(0x4285, uintB(2)));
  const info = ebml(0x1549a966, ebml(0x2ad7b1, uintB(1000000)), ebml(0x4d80, ascii("Chrome")), ebml(0x5741, ascii("Chrome")), ...(duration != null ? [ebml(0x4489, f64(duration))] : []));
  const tracks = ebml(0x1654ae6b, ebml(0xae, ebml(0xd7, uintB(1)), ebml(0x73c5, uintB(123456789)), ebml(0x83, uintB(2)), ebml(0x86, ascii(codec)), ebml(0x63a2, OPUS_HEAD),
    ebml(0xe1, ebml(0xb5, f64(48000)), ebml(0x9f, uintB(1)), ebml(0x6264, uintB(32)))));
  const clusters = [];
  let blocks = [], start = 0;
  const flush = () => { if (blocks.length) clusters.push(ebmlOpen(0x1f43b675, ebml(0xe7, uintB(start)), ...blocks)); blocks = []; };
  for (let i = 0; i < frames; i++) {
    const t = i * frameMs;
    if (t - start >= clusterMs) { flush(); start = t; }
    const pk = packet(i);
    if (!pk) continue;
    const rel = t - start;
    blocks.push(ebml(0xa3, u8(0x81, (rel >> 8) & 255, rel & 255, lace ? 0x82 : 0x80), pk));
  }
  flush();
  return cat([head, ebmlOpen(0x18538067, info, tracks, ...clusters)]);
}
/* Firefox's Ogg Opus ("audio/ogg;codecs=opus"): a BOS page with OpusHead, an OpusTags page, then
   about a second of 20 ms packets a page (granule = samples at 48 kHz, pre-skip included), EOS last. */
const OGG_CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
function oggPage(packets, { granule, serial = 0x1234, seq, type = 0 }) {
  const lacing = []; for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const g = new Uint8Array(8); new DataView(g.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(granule)), true);
  const page = cat([ascii("OggS"), u8(0, type), g, le32(serial), le32(seq), le32(0), u8(lacing.length), new Uint8Array(lacing), ...packets]);
  let c = 0; for (const x of page) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ x) & 255]) >>> 0;
  new DataView(page.buffer).setUint32(22, c, true);
  return page;
}
function firefoxOgg(seconds, { frameMs = 20, packet = () => OPUS_SILENCE, lastGranule = null, head = OPUS_HEAD, serial = 0x1234, bos = true } = {}) {
  const frames = Math.round((seconds * 1000) / frameMs), per = Math.round(1000 / frameMs), spf = frameMs * 48;
  const pages = [oggPage([head], { granule: 0, seq: 0, type: bos ? 2 : 0, serial }), oggPage([cat([ascii("OpusTags"), le32(7), ascii("Firefox"), le32(0)])], { granule: 0, seq: 1, serial })];
  for (let i = 0, seq = 2; i < frames; i += per) {
    const n = Math.min(per, frames - i), last = i + n >= frames;
    pages.push(oggPage(Array.from({ length: n }, (_, k) => packet(i + k)), { granule: last && lastGranule != null ? lastGranule : 312 + (i + n) * spf, seq: seq++, type: last ? 4 : 0, serial }));
  }
  return cat(pages);
}
/* Safari's MediaRecorder MP4 ("audio/mp4"): AAC at 48 kHz in movie FRAGMENTS (mvhd / mdhd say 0,
   one moof per second: tfhd default-base-is-moof, tfdt, trun with per-sample duration and size).
   fragmented:false → a plain MP4 (stts / stsz) instead. */
function safariMp4(seconds, { rate = 48000, sampleDuration = 1024, fragmented = true } = {}) {
  const frames = Math.ceil((seconds * rate) / 1024), ms = Math.round(seconds * 1000);
  const ftyp = mbox("ftyp", ascii("mp42"), be32(1), ascii("isommp41mp42"));
  const esds = mbox("esds", new Uint8Array(4), u8(3, 25, 0, 1, 0, 4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2, 0x11, 0x88, 6, 1, 2));
  const mp4a = mbox("mp4a", new Uint8Array(6), u8(0, 1), new Uint8Array(8), u8(0, 1, 0, 16, 0, 0, 0, 0), be32((rate * 65536) >>> 0), esds);
  const stbl = mbox("stbl", mbox("stsd", new Uint8Array(4), be32(1), mp4a),
    fragmented ? mbox("stts", new Uint8Array(4), be32(0)) : mbox("stts", new Uint8Array(4), be32(1), be32(frames), be32(sampleDuration)),
    mbox("stsc", new Uint8Array(4), be32(0)), fragmented ? mbox("stsz", new Uint8Array(4), be32(0), be32(0)) : mbox("stsz", new Uint8Array(4), be32(6), be32(frames)), mbox("stco", new Uint8Array(4), be32(0)));
  const trak = mbox("trak", mbox("tkhd", u8(0, 0, 0, 3), be32(0), be32(0), be32(1), be32(0), be32(fragmented ? 0 : ms), new Uint8Array(60)),
    mbox("mdia", mbox("mdhd", u8(0, 0, 0, 0), be32(0), be32(0), be32(rate), be32(fragmented ? 0 : frames * 1024), u8(0x55, 0xc4, 0, 0)), mbox("hdlr", new Uint8Array(4), be32(0), ascii("soun"), new Uint8Array(12), ascii("SoundHandler\0")),
      mbox("minf", mbox("smhd", new Uint8Array(8)), mbox("dinf", mbox("dref", new Uint8Array(4), be32(1), mbox("url ", u8(0, 0, 0, 1)))), stbl)));
  const moov = mbox("moov", mbox("mvhd", u8(0, 0, 0, 0), be32(0), be32(0), be32(1000), be32(fragmented ? 0 : ms), new Uint8Array(80)), trak,
    ...(fragmented ? [mbox("mvex", mbox("trex", new Uint8Array(4), be32(1), be32(1), be32(0), be32(0), be32(0)))] : []));
  if (!fragmented) return cat([ftyp, moov, mbox("mdat", new Uint8Array(frames * 6))]);
  const parts = [ftyp, moov], per = Math.round(rate / 1024);
  for (let i = 0, seq = 1; i < frames; i += per, seq++) {
    const n = Math.min(per, frames - i);
    const trun = mbox("trun", u8(0, 0, 0x03, 0x01), be32(n), be32(0), ...Array.from({ length: n }, () => cat([be32(sampleDuration), be32(6)])));
    parts.push(mbox("moof", mbox("mfhd", new Uint8Array(4), be32(seq)), mbox("traf", mbox("tfhd", u8(0, 2, 0, 0), be32(1)), mbox("tfdt", u8(1, 0, 0, 0), be64(i * sampleDuration)), trun)), mbox("mdat", new Uint8Array(n * 6)));
  }
  return cat(parts);
}
/* a PCM WAV (16 kHz mono 16-bit by default); declaredData: the data chunk's size field */
function pcmWav(seconds, { rate = 16000, channels = 1, bits = 16, declaredData = null, format = 1 } = {}) {
  const data = Math.round(seconds * rate) * channels * (bits / 8);
  const fmt = cat([ascii("fmt "), le32(16), le16(format), le16(channels), le32(rate), le32((rate * channels * bits) / 8), le16((channels * bits) / 8), le16(bits)]);
  return cat([ascii("RIFF"), le32(4 + fmt.length + 8 + data), ascii("WAVE"), fmt, ascii("data"), le32(declaredData ?? data), new Uint8Array(data)]);
}
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/* ═══════════════════════════════ A. PRICES ═══════════════════════════════ */
section("A prices (billing-pricing.mjs)");

await test("A1 the anchor: 1 credit = $0.01, rounded UP, at least 1; the old unit is $0.03", () => {
  assert.equal(P.PROVIDER_USD_PER_CREDIT, 0.01);
  assert.equal(P.LEGACY_USD_PER_CREDIT, 0.03);
  assert.equal(P.creditsFromUsd(0.30), 30, "0.3 / 0.01 is 30, not 31 (float tolerance)");
  assert.equal(P.creditsFromUsd(0.3034 * 10), 304, "10 s of Seedance 2.0 720p: the report's 304 credits");
  assert.equal(P.creditsFromUsd(0.0100001), 2, "any fraction rounds up");
  assert.equal(P.creditsFromUsd(0.0001), 1); assert.equal(P.creditsFromUsd(0), 1); assert.equal(P.creditsFromUsd(NaN), 1);
  assert.equal(P.creditsFromUsd(0.30, 0.03), 10, "the same cost in the pre-switch unit");
  assert.equal(P.creditsFromUsd(0.30, "junk"), 30, "an unusable unit falls back to the anchor");
  // the Blender copy of the anchor agrees
  for (const usd of [0.001, 0.3, 1.2, 1.52, 7.77]) for (const u of [0.01, 0.03]) assert.equal(studioCredits(usd, u), P.creditsFromUsd(usd, u), usd + "@" + u);
});

await test("A2 the live unit comes from turn_credit_regime(): 0.03 before the switch, 0.01 after, anything else refused", () => {
  assert.deepEqual(P.creditUnitFromRegime([{ switched: false, usd_per_credit: "0.03" }]), { unit: 0.03, switched: false });
  assert.deepEqual(P.creditUnitFromRegime({ switched: true, usd_per_credit: 0.01 }), { unit: 0.01, switched: true });
  assert.deepEqual(P.creditUnitFromRegime([{ usd_per_credit: "0.010" }]), { unit: 0.01, switched: true }, "numeric comes back as a string");
  for (const bad of [null, [], [{}], { usd_per_credit: 0.5 }, { usd_per_credit: "x" }, "0.01"]) assert.equal(P.creditUnitFromRegime(bad), null, j(bad));
});

await test("A3 text prices: GPT-5.5 (the app's dated id) $5/$30, Gemini 3.5 Flash $1.50/$9, Kimi K3 / K2.7, Claude list and cache prices", () => {
  const r = (m, o) => P.textRates(m, o);
  assert.equal(P.textPriceKey("gpt-5.5-2026-04-23"), "gpt-5.5", "the id the app sends (it missed the old exact lookup)");
  assert.deepEqual([r("gpt-5.5-2026-04-23").input, r("gpt-5.5-2026-04-23").output], [5, 30]);
  assert.deepEqual([r("gemini-3.5-flash").input, r("gemini-3.5-flash").output], [1.5, 9]);
  assert.deepEqual([r("kimi-k3").input, r("kimi-k3").output], [3, 15]);
  assert.deepEqual([r("kimi-k2.7-code").input, r("kimi-k2.7-code").output], [0.95, 4]);
  assert.deepEqual([r("claude-opus-5-5").input, r("claude-opus-5-5").output, r("claude-opus-5-5").cacheRead, r("claude-opus-5-5").cacheWrite], [4, 20, 0.2, 5]);
  assert.deepEqual([r("claude-opus-5").input, r("claude-opus-5").output, r("claude-opus-5").cacheRead], [5, 25, 0.5]);
  assert.deepEqual([r("claude-fable-5-1").input, r("claude-fable-5-1").output], [10, 50]);
  // dated price change: Gemini 3.8 Flash doubles on 2027-01-01
  assert.equal(r("gemini-3.8-flash", { nowMs: Date.parse("2026-12-31T23:59:59Z") }).input, 0.75);
  assert.deepEqual([r("gemini-3.8-flash", { nowMs: Date.parse("2027-01-01T00:00:00Z") }).input, r("gemini-3.8-flash", { nowMs: Date.parse("2027-01-01T00:00:00Z") }).output], [1.5, 7.5]);
  // long context
  assert.equal(r("gpt-6-astra", { inputTokens: 300000 }).input, 20);
  // an unknown model has NO price (the proxy refuses it instead of guessing)
  assert.equal(P.textPriceKey("gpt-7-omega"), ""); assert.equal(r("gpt-7-omega"), null);
  assert.equal(P.textHoldEstimate({ model: "gpt-7-omega", messages: [{ role: "user", content: "x" }], outputCap: 100 }), null);
  // the report's medium GPT-5.5 call (8k in / 2k out) costs $0.10 = 10 credits (it was charged 1)
  const medium = P.textActualCost("gpt-5.5-2026-04-23", { inputTokens: 8000, outputTokens: 2000 });
  assert.ok(near(medium.providerCostUsd, 0.10)); assert.equal(medium.credits, 10);
  // a large Gemini 3.5 Flash call (30k / 8k) = $0.117 → 12 credits (it was charged 1)
  assert.equal(P.textActualCost("gemini-3.5-flash", { inputTokens: 30000, outputTokens: 8000 }).credits, 12);
});

await test("A4 Gemini thinking tokens are billed as output; Anthropic cache tokens at their own prices", () => {
  const g = P.normaliseTextUsage("google", { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 } });
  assert.deepEqual(g, { inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0 });
  const a = P.normaliseTextUsage("anthropic", { usage: { input_tokens: 50, output_tokens: 200, cache_creation_input_tokens: 10000, cache_read_input_tokens: 30000 } });
  assert.deepEqual(a, { inputTokens: 50, outputTokens: 200, cacheWriteTokens: 10000, cacheReadTokens: 30000, webSearches: 0 });
  const cost = P.textActualCost("claude-opus-5-5", a).providerCostUsd;
  assert.ok(near(cost, (50 * 4 + 10000 * 5 + 30000 * 0.2 + 200 * 20) / 1e6), String(cost));
  const o = P.normaliseTextUsage("openai", { usage: { prompt_tokens: 7, completion_tokens: 9 } });
  assert.deepEqual([o.inputTokens, o.outputTokens], [7, 9]);
  // a free Frances call costs 0 credits but keeps its real USD (the report: those rows stored $0)
  const free = P.textActualCost("claude-opus-5-5", { inputTokens: 1000, outputTokens: 500 }, { free: true });
  assert.equal(free.credits, 0); assert.ok(free.providerCostUsd > 0);
});

await test("A5 the text HOLD covers input + the whole output cap; a small balance gets a shorter cap, never more than it can pay", () => {
  const msgs = [{ role: "user", content: "x".repeat(10000) }];
  const est = P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 16000 });
  assert.ok(est.inputTokens >= 4000, "input estimated generously (≥ 1 token per 2.5 bytes)");
  assert.ok(near(est.providerCostUsd, (est.inputTokens * 4 + 16000 * 20) / 1e6));
  assert.equal(est.credits, Math.ceil(est.providerCostUsd / 0.01 - 1e-9));
  // prompt caching prices every input token as a cache write (the worst case)
  assert.ok(P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 0, promptCache: true }).providerCostUsd > P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 0 }).providerCostUsd);
  // vision keeps the proxy's 1.5x policy and counts attached images
  assert.ok(P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 1000, imageCount: 2, vision: true }).providerCostUsd
    > 1.5 * P.textHoldEstimate({ model: "claude-opus-5-5", messages: msgs, outputCap: 1000 }).providerCostUsd);
  // affordability: the full cap when it fits, a smaller one when it doesn't, 0 below the floor
  assert.equal(P.affordableOutputCap({ model: "gpt-6-astra", messages: msgs, wantedCap: 16000, availableCredits: 10000 }), 16000);
  const cap = P.affordableOutputCap({ model: "gpt-6-astra", messages: msgs, wantedCap: 16000, availableCredits: 20 });
  assert.ok(cap >= 1024 && cap < 16000, String(cap));
  assert.ok(P.textHoldEstimate({ model: "gpt-6-astra", messages: msgs, outputCap: cap }).credits <= 20, "the shrunk cap's hold fits the balance");
  assert.equal(P.affordableOutputCap({ model: "gpt-6-astra", messages: msgs, wantedCap: 16000, availableCredits: 5 }), 0, "not even 1,024 tokens fit");
  // Claude keeps its 16k thinking room: below it, nothing (the proxy refuses with the credits it needs)
  assert.equal(P.affordableOutputCap({ model: "claude-opus-5-5", messages: msgs, wantedCap: 16000, minCap: 16000, availableCredits: 30 }), 0);
  assert.equal(P.affordableOutputCap({ model: "claude-opus-5-5", messages: msgs, wantedCap: 16000, minCap: 16000, availableCredits: 40 }), 16000);
  const big = P.affordableOutputCap({ model: "claude-opus-5-5", messages: msgs, wantedCap: 32768, minCap: 16000, availableCredits: 40 });
  assert.ok(big >= 16000 && big < 32768, String(big));
  // the same balance buys three times the output in the pre-switch unit
  assert.equal(P.affordableOutputCap({ model: "claude-opus-5-5", messages: msgs, wantedCap: 16000, minCap: 16000, availableCredits: 12, unit: 0.03 }), 16000);
});

await test("A6 images: Nano Banana 2 / Pro at fal's prices incl. 4K, Nano Banana 2.1, web search, GPT Image 2 by output size", () => {
  const c = (o) => P.imageCost({ route: "fal", aspect: "16:9", ...o });
  assert.deepEqual(["1K", "2K", "4K"].map((s) => c({ model: "gemini-3.1-flash-image", imageSize: s }).credits), [8, 12, 16], "NB2 $0.08 / $0.12 / $0.16");
  assert.deepEqual(["1K", "2K", "4K"].map((s) => c({ model: "gemini-3-pro-image", imageSize: s }).credits), [15, 15, 30], "NB Pro $0.15 / $0.15 / $0.30 (4K was charged below cost)");
  assert.deepEqual(["1K", "2K", "4K"].map((s) => c({ model: "gemini-nano-banana-2.1", imageSize: s }).credits), [5, 7, 15], "Nano Banana 2.1 $0.05 / $0.07 / $0.15 (the draft engine at 1K)");
  assert.equal(c({ model: "gemini-nano-banana-2.1", imageSize: "1K", webSearch: true }).credits, 7, "+ $0.015 web search, as Nano Banana 2");
  assert.equal(c({ model: "gemini-3.1-flash-lite-image", imageSize: "1K" }), null, "Lite is no longer priced (the proxy maps its id first)");
  assert.equal(c({ model: "gemini-3.1-flash-image", imageSize: "2K", webSearch: true }).credits, 14, "+ $0.015 web search");
  // GPT Image 2 high: $0.158 at fal's 1080p canonical size, $0.401 at 4K — scaled by output pixels
  const at = (size, aspect) => P.imageCost({ route: "fal", model: "gpt-image-2", imageSize: size, aspect, pricingKey: "high" });
  assert.ok(Math.abs(at("4K", "16:9").providerCostUsd - 0.401) < 0.003, String(at("4K", "16:9").providerCostUsd));
  assert.equal(at("4K", "16:9").credits, 41);
  assert.ok(at("1K", "16:9").credits < at("2K", "16:9").credits && at("2K", "16:9").credits < at("4K", "16:9").credits, "cost follows size");
  assert.equal(P.imageCost({ route: "fal", model: "gpt-image-2", imageSize: "2K", aspect: "16:9", pricingKey: "high", referenceImages: 2 }).credits,
    P.creditsFromUsd(at("2K", "16:9").providerCostUsd + 2 * P.GPT_IMAGE_REFERENCE_USD), "reference images add their input cost");
  assert.equal(P.imageCost({ route: "fal", model: "no-such-model", imageSize: "2K" }), null);
  assert.equal(P.imageCost({ route: "fal", model: "gemini-3.1-flash-image", imageSize: "8K" }), null);
  // the pre-switch unit
  assert.equal(c({ model: "gemini-3.1-flash-image", imageSize: "2K", unit: 0.03 }).credits, 4);
});

await test("A7 the direct Google image route serves ONLY its three known models, at Google's own prices", () => {
  assert.deepEqual(Object.keys(P.GOOGLE_IMAGE_USD).sort(), ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"]);
  assert.deepEqual(["1K", "2K", "4K"].map((s) => P.imageCost({ route: "google", model: "gemini-nano-banana-2.1", imageSize: s }).providerCostUsd), [0.0336, 0.0504, 0.113]);
  const g = (m, s) => P.imageCost({ route: "google", model: m, imageSize: s });
  assert.deepEqual(["1K", "2K", "4K"].map((s) => g("gemini-3.1-flash-image", s).providerCostUsd), [0.067, 0.101, 0.151]);
  assert.equal(g("gemini-3-pro-image", "4K").providerCostUsd, 0.24);
  for (const bad of ["gemini-2.0-flash-exp", "../../v1/models/x", "gpt-image-2", ""]) assert.equal(g(bad, "2K"), null, bad);
  assert.equal(P.imageCost({ route: "openai", model: "gpt-image-2.5-flare", imageSize: "2K", pricingKey: "high" }), null, "the direct OpenAI route serves GPT Image 2 only");
  assert.ok(P.imageCost({ route: "openai", model: "gpt-image-2", imageSize: "2K", pricingKey: "high" }));
});

await test("A8 video per second: Seedance 2.0 / 2.5 (x0.6 on input + output seconds with video references), Kling, Sora gone", () => {
  const v = (o) => P.videoCost({ ...o });
  const s20 = v({ endpoint: "bytedance/seedance-2.0/image-to-video", resolution: "720p", outputSeconds: 10 });
  assert.ok(near(s20.providerCostUsd, 3.034)); assert.equal(s20.credits, 304);
  assert.equal(v({ endpoint: "bytedance/seedance-2.0/image-to-video", resolution: "4k", outputSeconds: 15 }).credits, P.creditsFromUsd(1.55 * 15), "4k normalised");
  assert.equal(v({ endpoint: "bytedance/seedance-2.0/fast/image-to-video", resolution: "720p", outputSeconds: 5 }).credits, P.creditsFromUsd(0.2419 * 5));
  const s25 = v({ endpoint: "bytedance/seedance-2.5/reference-to-video", resolution: "1080p", outputSeconds: 10, inputVideoSeconds: 6 });
  assert.ok(near(s25.providerCostUsd, 1.164 * 0.6 * 16)); assert.equal(s25.billedSeconds, 16);
  assert.equal(v({ endpoint: "fal-ai/kling-video/v3/standard/image-to-video", resolution: "720p", outputSeconds: 5 }).credits, 63);
  assert.equal(v({ endpoint: "fal-ai/kling-video/v3/pro/image-to-video", resolution: "1080p", outputSeconds: 5, inputVideoSeconds: 9 }).credits, 84, "Kling ignores input seconds");
  assert.equal(v({ endpoint: "fal-ai/sora-2/image-to-video", resolution: "720p", outputSeconds: 8 }), null, "Sora 2 was shut down on fal");
  assert.equal(v({ endpoint: "bytedance/seedance-2.5/reference-to-video", resolution: "4K", outputSeconds: 5 }), null, "no 4K price → no render");
  assert.equal(P.videoAppModel("bytedance/seedance-2.0/fast/reference-to-video"), "seedance-2.0");
  assert.equal(P.videoAppModel("fal-ai/kling-video/v3/pro/motion-control"), "kling-3.0-motion-control");
  // reviewed overrides apply only to known keys, sane values
  const m = P.mergeVideoPricingOverrides(P.VIDEO_PROVIDER_USD_PER_SECOND, { video: { "seedance-2.0": { standard: { "720p": 0.31, "8K": 9 } }, "sora-2": { standard: { "720p": 0.1 } } } });
  assert.equal(m["seedance-2.0"].standard["720p"], 0.31); assert.equal(m["seedance-2.0"].standard["8K"], undefined); assert.equal(m["sora-2"], undefined);
  assert.equal(P.VIDEO_PROVIDER_USD_PER_SECOND["seedance-2.0"].standard["720p"], 0.3034, "the base table is untouched");
});

await test("A9 voice is charged: speech by characters, transcription by length, design / clone flat", () => {
  assert.equal(P.ttsCost("x".repeat(100)).credits, 1, "a 100-character line is 1 credit (the report)");
  assert.equal(P.ttsCost("x".repeat(3000)).credits, 30);
  assert.equal(P.ttsCost("x".repeat(3000), "eleven_turbo_v2_5").credits, 15, "Turbo / Flash cost half");
  assert.equal(P.ttsCost("x".repeat(3000), "eleven_v3", 0.03).credits, 10);
  const stt = P.sttHoldCost(60);   // a one-minute recording (round 5, S1: held on its container's duration)
  assert.equal(stt.seconds, 60); assert.equal(stt.credits, 1);
  assert.equal(P.sttHoldCost(600).credits, P.creditsFromUsd((600 / 60) * 0.008), "a long recording is HELD for more");
  assert.equal(P.flatVoiceCost("design").credits, 10); assert.equal(P.flatVoiceCost("clone").credits, 10);
  assert.equal(P.base64Bytes("QUJD"), 3); assert.equal(P.base64Bytes("QUI="), 2);
});

await test("A10 (repair F5) the text hold stays an upper bound: 1 token per byte for non-ASCII input, 4,800 per image", () => {
  const ascii10k = P.estimateInputTokens([{ role: "user", content: "x".repeat(10000) }]);
  assert.equal(ascii10k, 4000 + 8 + 16, "ASCII keeps 1 token per 2.5 bytes");
  // a rare 4-byte character that a tokenizer can only split into bytes costs up to 4 tokens
  const rare = P.estimateInputTokens([{ role: "user", content: "\u{1D11E}".repeat(1000) }]);
  assert.ok(rare >= 4000, "4-byte characters: at least 4 tokens each (" + rare + ")");
  assert.equal(rare, 4000 + 8 + 16);
  assert.equal(P.estimateInputTokens([{ role: "user", content: "é".repeat(100) }]), 200 + 24, "2-byte characters: 2 tokens");
  assert.equal(P.IMAGE_INPUT_TOKENS, 4800, "the high-resolution image ceiling (≈4,784), not the old 1,600");
  assert.equal(P.estimateInputTokens([{ role: "user", content: "" }], 2), 9600 + 24);
  // the reviewer's case: 250k such characters on Opus 5.5 are held as ~1M input tokens, not 400k
  const est = P.textHoldEstimate({ model: "claude-opus-5-5", messages: [{ role: "user", content: "\u{1D11E}".repeat(250000) }], outputCap: 16000 });
  assert.ok(est.inputTokens >= 1000000, String(est.inputTokens));
  assert.ok(est.providerCostUsd >= 4.0 + 0.32, "the hold covers the worst-case $4.00 input + the output cap");
});

await test("A11 (repair F4) speech is priced by the route that serves it; an unknown voice model has no price", () => {
  const t = "x".repeat(4000);
  assert.equal(P.ttsCost(t, "eleven_flash_x"), null, "an invented 'flash' id is refused, not priced at the fast rate");
  assert.equal(P.ttsCost(t, "eleven_v3_alpha"), null);
  assert.equal(P.ttsModel("eleven_flash_v2_5").falEndpoint, "fal-ai/elevenlabs/tts/eleven-v3", "fal has no Flash mirror: the backup renders v3");
  // Flash: $0.05 direct, but its backup is Eleven v3 at $0.10 — the hold covers the dearer route
  assert.ok(near(P.ttsCost(t, "eleven_flash_v2_5", 0.01, { route: "direct" }).providerCostUsd, 0.20));
  assert.ok(near(P.ttsCost(t, "eleven_flash_v2_5", 0.01, { route: "fal" }).providerCostUsd, 0.40));
  assert.ok(near(P.ttsCost(t, "eleven_flash_v2_5").providerCostUsd, 0.40), "held at the fal price");
  // Turbo's backup is Turbo on fal: $0.05 either way; v3 / Multilingual $0.10 either way
  assert.deepEqual(["direct", "fal", "hold"].map((route) => P.ttsCost(t, "eleven_turbo_v2_5", 0.01, { route }).credits), [20, 20, 20]);
  assert.deepEqual(["direct", "fal", "hold"].map((route) => P.ttsCost(t, "eleven_multilingual_v2", 0.01, { route }).credits), [40, 40, 40]);
  assert.equal(P.ttsCost(t, "eleven_v3", 0.03).credits, 14);
});

await test("A12 (repair F2) renders billed by an input video's length: held at the most allowed, settled from the real length", () => {
  const MC = "fal-ai/kling-video/v3/pro/motion-control", S25 = "bytedance/seedance-2.5/reference-to-video", S20 = "bytedance/seedance-2.0/reference-to-video";
  // Motion Control, unreadable motion video: held at 30 s (10 s when the character follows the image)
  let h = P.lengthBilledVideoHold({ endpoint: MC, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [null] });
  assert.equal(h.cost.outputSeconds, 30); assert.equal(h.cost.credits, P.creditsFromUsd(0.168 * 30)); assert.equal(h.inputsRead, false);
  assert.equal(P.lengthBilledVideoHold({ endpoint: MC, resolution: "1080p", kind: "motion", maxOutputSeconds: 10, inputs: [null] }).cost.outputSeconds, 10);
  // …read on the server as 12.3 s: round 4 (owner decision) holds it for 12.3 x 1.1 + 1 = 14.53 → 14.6 s
  // (it was the 30 s maximum); 13 s is the price the Stage's quote is checked against; the SETTLE may
  // still count up to 30 s of output (facts.mo), capped at the hold by the caller
  h = P.lengthBilledVideoHold({ endpoint: MC, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [12.3] });
  assert.equal(h.cost.outputSeconds, 14.6); assert.equal(h.expected.outputSeconds, 13); assert.equal(h.inputsRead, true); assert.equal(h.lengthSized, true);
  assert.equal(h.facts.v, P.LENGTH_FACTS_VERSION); assert.equal(h.facts.mo, 30);
  // a length read from a file that could change before fal fetches it (sizable false) keeps the maximum
  assert.equal(P.lengthBilledVideoHold({ endpoint: MC, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [12.3], sizable: [false] }).cost.outputSeconds, 30);
  // settle: the finished render's own length (never above what was held)
  let st = P.lengthBilledVideoSettle(P.lengthBilledVideoHold({ endpoint: MC, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [null] }).facts, 12.02);
  assert.deepEqual([st.outputSeconds, st.credits], [12, P.creditsFromUsd(0.168 * 12)]);
  assert.equal(P.lengthBilledVideoSettle(h.facts, 30).outputSeconds, 30, "the verify-money case: a 30 s output is priced at 30 s although the input's header read 12.3 s (the caller caps it at the hold and reports it)");
  assert.equal(P.lengthBilledVideoSettle(h.facts, 40).outputSeconds, 30, "capped at the held (maximum) seconds");
  // Seedance 2.5 editing, one unreadable source: held at (30 + 30.2) x 0.6; a 20 s result settles (20 + 20) x 0.6
  h = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [null] });
  assert.ok(near(h.cost.providerCostUsd, 1.164 * 0.6 * 60.2));
  st = P.lengthBilledVideoSettle(h.facts, 20);
  assert.deepEqual([st.outputSeconds, st.inputSeconds], [20, 20]); assert.ok(near(st.providerCostUsd, 1.164 * 0.6 * 40));
  // two sources, one unreadable: the input part stays at the maximum
  h = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [8, null] });
  assert.equal(P.lengthBilledVideoSettle(h.facts, 8).inputSeconds, 30.2);
  // round 2 (S4): @Video1's length at the settle is the OUTPUT's (fal's own file), the other sources count as
  // read — a forged 2 s @Video1 can't lower a 20 s edit's charge below its hold. Round 4: with every source
  // read (and sizable), the edit is held for @Video1 x 1.1 + 1 = 3.2 s of output and 3.2 + 5 = 8.2 s of input
  h = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [2, 5] });
  assert.ok(near(h.cost.providerCostUsd, 1.164 * 0.6 * (3.2 + 8.2)), "held for the read lengths + the margin"); assert.ok(near(h.expected.providerCostUsd, 1.164 * 0.6 * (2 + 7)));
  assert.ok(near(P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [2, 5], sizable: [false, true] }).cost.providerCostUsd, 1.164 * 0.6 * 60.2),
    "an @Video1 that isn't sizable: held at the maximum");
  st = P.lengthBilledVideoSettle(h.facts, 20);
  assert.deepEqual([st.outputSeconds, st.inputSeconds], [20, 25], "priced from the output (the caller caps it at the hold)");
  // references read on the server (6 s + 4.04 s) with an asked-for 10 s output: billed as asked, input as read
  h = P.lengthBilledVideoHold({ endpoint: S20, resolution: "720p", kind: "refs", outputSeconds: 10, fixedOutput: true, maxOutputSeconds: 15, maxInputSeconds: 15, inputs: [6, 4.04] });
  assert.ok(near(h.cost.providerCostUsd, 0.3034 * 0.6 * (10 + 10.1)));
  st = P.lengthBilledVideoSettle(h.facts, 9.4);
  assert.deepEqual([st.outputSeconds, st.inputSeconds], [10, 10.1], "a fixed length is billed as asked");
  // unread references: held and settled at the combined maximum (15 s for 2.0)
  h = P.lengthBilledVideoHold({ endpoint: S20, resolution: "720p", kind: "refs", outputSeconds: 5, fixedOutput: true, maxOutputSeconds: 15, maxInputSeconds: 15, inputs: [null] });
  assert.equal(h.cost.credits, P.creditsFromUsd(0.3034 * 0.6 * 20));
  // facts that don't check out (a forged or old token) settle nothing below the hold
  for (const bad of [null, {}, { k: "refs", rate: -1, mo: 5 }, { k: "wat", rate: 1, mo: 5 }, { v: 2, k: "refs", rate: -1, mo: 5 }]) assert.equal(P.lengthBilledVideoSettle(bad, 5), null);
  // facts written before round 2 (no version; a motion "mo" that may be a forged input length) settle nothing below the hold
  assert.equal(P.lengthBilledVideoSettle({ k: "motion", rate: 0.168, mo: 3, fx: 0, vin: null, n: 1, mi: 0 }, 30), null);
  assert.equal(P.lengthBilledVideoSettle(h.facts, 0), null, "an unreadable length settles nothing (the hold stands)");
});

await test("A13 (round 2, S5) digits, punctuation and symbols count 1 token each; letters and whitespace keep 2.5 bytes a token", () => {
  const est = (t) => P.estimateInputTokens([{ role: "user", content: t }]) - 24;
  assert.equal(est("1234567890".repeat(1000)), 10000, "random digits: one token per character (was 4,000)");
  assert.equal(est("!@#$%^&*()".repeat(1000)), 10000, "punctuation: one token each");
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const noise = Array.from({ length: 5000 }, () => "0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"[Math.floor(rnd() * 42)]).join("");
  assert.equal(est(noise), 5000, "a random digits-and-punctuation prompt");
  assert.equal(est("hello world ".repeat(500)), 2401, "words and spaces: 6,000 bytes / 2.5 — and (round 4) the text's last space, a piece of its own, a whole token");
  assert.equal(est("x".repeat(10000)), 4000, "letters unchanged");
  assert.equal(est("a\tb\nc\r"), 6, "round 4 (S2): tabs and line breaks are 1 token each, and every letter run at least 1");
  assert.equal(est('{"a":1}'), Math.ceil(6 + 1 / 2.5), "JSON punctuation is dense");
  // the hold of a 20,000-digit prompt covers 20,000 input tokens
  const h = P.textHoldEstimate({ model: "claude-opus-5-5", messages: [{ role: "user", content: "7".repeat(20000) }], outputCap: 0 });
  assert.ok(h.inputTokens >= 20000, String(h.inputTokens));
});

await test("A14 (round 3, S1) the estimate counts EXACTLY what each provider is sent: messageText(m) — array content can't slip past the hold", () => {
  const big = "The quick brown fox jumps over the lazy dog. ".repeat(2000);
  const est = (content) => P.estimateInputTokens([{ role: "user", content }]);
  // what the providers are sent: String(content) — an array of strings arrives joined, whole
  assert.equal(P.messageText({ role: "user", content: [big] }), big);
  assert.equal(P.messageText({ role: "user", content: ["a", "b"] }), "a,b");
  assert.equal(P.messageText({ role: "user", content: [{ type: "text", text: big }] }), "[object Object]", "object parts are sent as String() gives them");
  assert.equal(P.messageText({ role: "user" }), ""); assert.equal(P.messageText(null), ""); assert.equal(P.messageText({ content: 42 }), "42");
  // …and the estimate counts that same string (it counted 0 for [string] in round 2)
  assert.equal(est([big]), est(big), "an array of strings is held like the same plain string");
  assert.equal(est([big, big]), est(big + "," + big));
  assert.ok(est([big]) > 30000, String(est([big])));
  assert.equal(est([{ type: "text", text: big }]), est("[object Object]"), "only what is sent is counted");
  assert.equal(P.textHoldEstimate({ model: "claude-opus-5-5", messages: [{ role: "user", content: [big] }], outputCap: 16000 }).credits,
    P.textHoldEstimate({ model: "claude-opus-5-5", messages: [{ role: "user", content: big }], outputCap: 16000 }).credits);
  // images are counted from the request's images, never from message content
  assert.equal(P.estimateInputTokens([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }], 2),
    P.estimateInputTokens([{ role: "user", content: "[object Object]" }]) + 2 * P.IMAGE_INPUT_TOKENS);
  // ONE normaliser: every provider branch in index.ts sends messageText(m), none builds its own String(m.content)
  const src = read("supabase/functions/image-proxy/index.ts");
  const textTask = src.slice(src.indexOf('if (task === "text") {'), src.indexOf('if (task === "voice") {'));
  assert.doesNotMatch(textTask, /String\(m\.content|String\(\(m\s*&&|m\.content\s*\|\|/, "no provider builds its own message text");
  assert.equal((textTask.match(/messageText\(m\)/g) || []).length, 5, "Google, OpenAI, Kimi, Anthropic's system prompt and turns");
  assert.match(textTask, /messages\.some\(\(m: any\) => !m \|\| typeof m !== "object" \|\| Array\.isArray\(m\)\)\) return json\(/, "a message that isn't an object is refused before any hold");
});

/* ROUND 4 (S2): a tokenizer's PRE-SPLIT, as OpenAI publishes it for o200k (the named inline flag group
   written out): every piece is at least one token, so a hold must cover at least the piece count */
const O200K_PIECES = new RegExp([
  "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?",
  "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?",
  "\\p{N}{1,3}", " ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*", "\\s*[\\r\\n]+", "\\s+(?!\\S)", "\\s+",
].join("|"), "gu");
const o200kPieces = (t) => (t.match(O200K_PIECES) || []).length;

await test("A15 (round 4, S2) line breaks count 1 token each and every letter run at least 1 (a case change starts a new one): the hold covers the pre-split's piece count", () => {
  const est = (t) => P.estimateInputTokens([{ role: "user", content: t }]) - 24;
  // the verifier's shapes: at least one token per piece (the round-3 bound gave 'a\n' 40% and 'Qz' 80% of it)
  for (const [shape, n] of [["a\n", 300000], ["Qz", 200000], ["a\r", 50000], ["\va", 50000], ["a\t", 50000], ["a  ", 50000], ["1 ", 50000], ["aB", 50000], ["x\fy", 30000]]) {
    const t = shape.repeat(n);
    assert.ok(est(t) >= o200kPieces(t), `${JSON.stringify(shape)} x ${n}: bound ${est(t)} < ${o200kPieces(t)} pieces`);
  }
  assert.equal(est("a\n".repeat(300000)), 600000, "'a\\n' repeated: one token per character (it was 240,000)");
  assert.equal(est("Qz".repeat(200000)), 200000, "'Qz' repeated: one token per pair (it was 160,000)");
  // any mix of letters, cases, spaces, line breaks, tabs, digits and punctuation (seeded, 3,000 texts)
  let seed = 4242; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const classes = ["abcxyz", "ABCXYZ", " ", "\n", "\r", "\t", "\v", "\f", "0123456789", ".,'!?-:;\"/()[]_"];
  for (let k = 0; k < 3000; k++) {
    const w = classes.map(() => rnd()), total = w.reduce((a, b) => a + b, 0);
    let t = "";
    for (let i = 0, n = 1 + Math.floor(rnd() * 80); i < n; i++) {
      let r = rnd() * total, c = 0; while (c < classes.length - 1 && r > w[c]) { r -= w[c]; c++; }
      t += classes[c][Math.floor(rnd() * classes[c].length)];
    }
    assert.ok(est(t) >= o200kPieces(t), `bound ${est(t)} < ${o200kPieces(t)} pieces for ${JSON.stringify(t)}`);
  }
  // ordinary English prose is NOT hugely over-held: within 2.5x of a 4-characters-a-token estimate
  const prose = ("The lighthouse keeper had not spoken to anyone in eleven days. When the supply boat finally rounded the point, she was already on the jetty, one hand shading her eyes, the other gripping a letter she had rewritten four times.\n\n"
    + "\"You're late,\" she said. It wasn't a complaint; it was the first true thing she'd said aloud since the storm. Marcus tied off the line and handed up a crate of tinned peaches, three paperbacks and a radio battery.\n").repeat(300);
  const ratio = est(prose) / (prose.length / 4);
  assert.ok(ratio <= 2.5 && ratio >= 1, "prose: " + ratio.toFixed(2) + "x a 4-characters-a-token estimate");
  // the long-context rate follows the NEW bound: 'a\n' x 150,000 is 300k tokens → gpt-6-astra's long-context price
  const astra = P.textHoldEstimate({ model: "gpt-6-astra", messages: [{ role: "user", content: "a\n".repeat(150000) }], outputCap: 16000 });
  assert.ok(astra.inputTokens > 272000, String(astra.inputTokens));
  assert.ok(near(astra.providerCostUsd, (astra.inputTokens * 20 + 16000 * 75) / 1e6), "held at $20 / $75 per million (long context), not $10 / $50");
  const pieces = o200kPieces("a\n".repeat(150000));
  assert.ok(astra.credits >= P.creditsFromUsd((pieces * 20 + 16000 * 75) / 1e6), "covers the pieces at the long-context price");
});

await test("A16 (round 4, S1) an attached image must BE an image: a PNG / JPEG / WebP / GIF / HEIC data URL whose bytes are one, within 30MB — nothing else", () => {
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const png = "data:image/png;base64," + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const jpeg = "data:image/jpeg;base64," + b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const gif = "data:image/gif;base64," + b64([...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0]);
  const webp = "data:image/webp;base64," + b64([...Buffer.from("RIFF"), 36, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
  const heic = "data:image/heic;base64," + b64([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic")]);
  const heif = "data:image/heif;base64," + b64([0, 0, 0, 24, ...Buffer.from("ftypmif1"), 0, 0, 0, 0, ...Buffer.from("mif1heic")]);
  assert.equal(P.visionImagesProblem([png, jpeg, gif, webp, heic, heif]), null, "the six kinds pass");
  assert.equal(P.visionImagesProblem([]), null); assert.equal(P.visionImagesProblem(undefined), null);
  assert.equal(P.visionImagesProblem(["DATA:IMAGE/PNG;base64," + png.split(",")[1]]), null, "the label's case doesn't matter");
  const pdf = b64([...Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj")]);
  const doc = b64([...Buffer.from("INT. LIGHTHOUSE - NIGHT. ".repeat(20))]);
  for (const [bad, why] of [
    ["data:text/plain;base64," + doc, "a text document"], ["data:application/pdf;base64," + pdf, "a PDF"],
    ["data:video/mp4;base64," + b64([0, 0, 0, 24, ...Buffer.from("ftypisom")]), "a video"], ["data:audio/mpeg;base64," + b64([...Buffer.from("ID3"), 4, 0, 0]), "audio"],
    ["data:audio/wav;base64," + b64([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")]), "audio (RIFF)"],
    ["data:image/png;base64," + pdf, "a PDF labelled as a PNG"], ["data:image/jpeg;base64," + doc, "text labelled as a JPEG"],
    ["data:image/svg+xml;base64," + b64([...Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")]), "SVG (not on the list)"],
    ["data:image/avif;base64," + b64([0, 0, 0, 24, ...Buffer.from("ftypavif")]), "AVIF (not on the list)"],
    ["https://v3.fal.media/files/a.png", "a link"], ["data:image/png,rawtext", "not base64"], ["data:image/png;base64,iVBORw0KGgo!!!", "broken base64"],
    ["data:image/png;foo=bar;base64," + png.split(",")[1], "extra parameters"], [42, "not a string"], [null, "not a string"],
  ]) {
    const r = P.visionImagesProblem([png, bad]);
    assert.ok(r && r.index === 1, why + ": " + j(r));
    assert.match(r.error, /PNG, JPEG, WebP, GIF or HEIC|larger than/, why);
    assert.doesNotMatch(r.error, /Google|Gemini|OpenAI|Anthropic|Claude|fal|Kimi|Moonshot/i, "no vendor names");
  }
  assert.ok(P.visionImagesProblem("data:image/png;base64,AAAA"), "images must be a list");
  // the byte cap: 30MB decoded (the largest image the app handles anywhere)
  assert.equal(P.VISION_IMAGE_MAX_BYTES, 30 * 1024 * 1024);
  const over = "data:image/png;base64," + png.split(",")[1].slice(0, 20) + "A".repeat(Math.ceil((P.VISION_IMAGE_MAX_BYTES + 3) / 3) * 4);
  assert.match(P.visionImagesProblem([over]).error, /larger than 30MB/);
  assert.deepEqual([...P.VISION_IMAGE_MIME], ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"]);
});

await test("A17 (round 5, S1) speech-to-text is HELD and SETTLED on the recording's container duration; a reported length counts only when larger; words never; only the app's models", () => {
  assert.equal(P.STT_BYTES_PER_SECOND, undefined, "no size-based estimate any more"); assert.equal(P.sttCost, undefined);
  // the cap sits just above the longest recording the app makes (New Story's spoken answer stops by itself), and
  // within the owner's 10-minute ceiling
  const appMax = Number((/const NS_MAX_ANSWER_SECONDS = (\d+);/.exec(read("app/newstory.jsx")) || [])[1]);
  assert.ok(appMax > 0, "app/newstory.jsx still names its longest spoken answer");
  assert.ok(P.STT_MAX_SECONDS >= appMax + 60 && P.STT_MAX_SECONDS <= appMax + 120, `the cap (${P.STT_MAX_SECONDS} s) follows the app's longest answer (${appMax} s)`);
  assert.ok(P.STT_MAX_SECONDS <= 600, "10 minutes at most");
  // the models: none named → the app's default; only the accepted ones otherwise
  assert.equal(P.sttModel(undefined), "scribe_v1"); assert.equal(P.sttModel(""), "scribe_v1"); assert.equal(P.sttModel(null), "scribe_v1");
  assert.equal(P.sttModel("scribe_v1"), "scribe_v1"); assert.equal(P.sttModel("scribe_v2"), "scribe_v2");
  for (const bad of ["no-such-model", "SCRIBE_V1", "scribe_v1 ", "eleven_v3", 7, {}, ["scribe_v1"]]) assert.equal(P.sttModel(bad), null, j(bad));
  // the hold: whole seconds up, at least 1
  const hold = P.sttHoldCost(299.21, 0.01);
  assert.equal(hold.seconds, 300); assert.equal(hold.credits, P.creditsFromUsd((300 / 60) * 0.008, 0.01));
  assert.equal(P.sttHoldCost(0).seconds, 1); assert.equal(P.sttHoldCost(30).seconds, 30); assert.equal(P.sttHoldCost(30.0000000001).seconds, 30, "float noise isn't a second");
  // a reported duration field only — the last word's end is NOT a length (it was, in round 4)
  assert.equal(P.sttReportedSeconds({ text: "x", audio_duration_secs: 812.4 }), 812.4);
  assert.equal(P.sttReportedSeconds({ text: "x", words: [{ text: "a", start: 0, end: 1.2 }, { text: "b", start: 1.3, end: 61.75 }] }), null, "word timestamps are never a length");
  assert.equal(P.sttReportedSeconds({ text: "x" }), null); assert.equal(P.sttReportedSeconds(null), null);
  assert.equal(P.sttReportedSeconds({ duration: -3 }), null, "junk is no length");
  // the settle: max(container, reported), never above the hold (= the container) — so the recording's length
  let st = P.sttSettleCost(0.6, 299.21, 0.01);   // one word, then silence
  assert.deepEqual([st.seconds, st.credits], [300, hold.credits], "a short reported length doesn't lower the charge");
  assert.ok(st.credits > P.sttHoldCost(1, 0.01).credits);
  st = P.sttSettleCost(null, 299.21, 0.01);
  assert.deepEqual([st.seconds, st.credits, st.reported], [300, hold.credits, false]);
  st = P.sttSettleCost(5000, 299.21, 0.01);
  assert.deepEqual([st.seconds, st.credits, st.reportedLonger], [300, hold.credits, true], "a longer reported length is capped at the hold (and flagged)");
  assert.equal(P.sttSettleCost(0.2, 0.4).seconds, 1, "at least one second");
  // an ordinary 30 s answer costs 1 credit at $0.01
  assert.equal(P.sttSettleCost(null, 30, 0.01).credits, 1);
});

await test("A18 (round 4, owner decision) Motion Control / editing HOLDS follow the source's read length x 1.1 + 1 s (tenths, up), capped at the maximum; unread or not sizable → the maximum", () => {
  const MCs = "fal-ai/kling-video/v3/standard/motion-control", MCp = "fal-ai/kling-video/v3/pro/motion-control", S25 = "bytedance/seedance-2.5/reference-to-video";
  assert.deepEqual([5, 12.3, 0.5, 2, 26, 27.3, 29.9].map(P.lengthHoldSeconds), [6.5, 14.6, 1.6, 3.2, 29.6, 31.1, 33.9]);
  // the app's mirror (app/stage.jsx stageLengthHoldSeconds) is the same arithmetic, in the same order
  const appHoldSeconds = (secs) => Math.ceil((Number(secs) * 1.1 + 1) * 10 - 1e-9) / 10;
  for (let t = 0.1; t < 31; t += 0.07) assert.equal(P.lengthHoldSeconds(t), appHoldSeconds(t), String(t));
  // a 5 s readable motion video: ~6.5 s worth, at 720p (standard) and at 1080p (pro), in either unit
  for (const [ep, res, rate] of [[MCs, "720p", 0.126], [MCp, "1080p", 0.168]]) {
    for (const unit of [0.03, 0.01]) {
      const h = P.lengthBilledVideoHold({ endpoint: ep, resolution: res, kind: "motion", maxOutputSeconds: 30, inputs: [5], unit });
      assert.equal(h.cost.outputSeconds, 6.5); assert.equal(h.cost.credits, P.creditsFromUsd(rate * 6.5, unit), `${res} at ${unit}`);
      assert.equal(h.expected.credits, P.creditsFromUsd(rate * 5, unit)); assert.equal(h.lengthSized, true);
      // unreadable / not sizable: the maximum (30 s, or 10 s when the character follows the image)
      assert.equal(P.lengthBilledVideoHold({ endpoint: ep, resolution: res, kind: "motion", maxOutputSeconds: 30, inputs: [null], unit }).cost.credits, P.creditsFromUsd(rate * 30, unit));
      assert.equal(P.lengthBilledVideoHold({ endpoint: ep, resolution: res, kind: "motion", maxOutputSeconds: 10, inputs: [5], sizable: [false], unit }).cost.outputSeconds, 10);
    }
  }
  // capped at the maximum: 28 s → 31.8 s → 30 s (and 10 s when the character follows the image)
  assert.equal(P.lengthBilledVideoHold({ endpoint: MCp, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [28] }).cost.outputSeconds, 30);
  assert.equal(P.lengthBilledVideoHold({ endpoint: MCp, resolution: "1080p", kind: "motion", maxOutputSeconds: 10, inputs: [9.5] }).cost.outputSeconds, 10);
  // editing a 5 s source: 6.5 s of output and 6.5 s of input (the settle counts the output as @Video1's input)
  let e = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [5] });
  assert.deepEqual([e.cost.outputSeconds, e.cost.inputSeconds], [6.5, 6.5]); assert.equal(e.cost.credits, P.creditsFromUsd(1.164 * 0.6 * 13, 0.01));
  assert.equal(P.lengthBilledVideoHold({ endpoint: S25, resolution: "720p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [5] }).cost.credits, P.creditsFromUsd(0.473 * 0.6 * 13, 0.01));
  // …the 1080p Producer case from round 3: 4,205 credits for any source; a 5 s source now holds ~907
  assert.equal(P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [null] }).cost.credits, 4205);
  // capped each at its own maximum (28 s source: 30 s of output, 30.2 s of input)
  e = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [28] });
  assert.deepEqual([e.cost.outputSeconds, e.cost.inputSeconds], [30, 30.2]);
  // another reference unread: the input part stays at the maximum; the output still follows @Video1
  e = P.lengthBilledVideoHold({ endpoint: S25, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [5, null] });
  assert.deepEqual([e.cost.outputSeconds, e.cost.inputSeconds], [6.5, 30.2]);
  // references are unchanged (billed by what was read; there is no margin to add)
  const r = P.lengthBilledVideoHold({ endpoint: "bytedance/seedance-2.0/reference-to-video", resolution: "720p", kind: "refs", outputSeconds: 10, fixedOutput: true, maxOutputSeconds: 15, maxInputSeconds: 15, inputs: [6, 4.04] });
  assert.ok(near(r.cost.providerCostUsd, 0.3034 * 0.6 * (10 + 10.1))); assert.equal(r.lengthSized, false);
  // the settle is unchanged: priced from the OUTPUT up to the maximum (facts.mo = 30); the caller caps it at the hold
  const h = P.lengthBilledVideoHold({ endpoint: MCp, resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [5] });
  assert.equal(h.facts.mo, 30);
  assert.equal(P.lengthBilledVideoSettle(h.facts, 5.02).credits, P.creditsFromUsd(0.168 * 5), "an honest 5 s output costs 5 s");
  assert.ok(P.lengthBilledVideoSettle(h.facts, 9).credits > h.cost.credits, "a 9 s output is priced above the hold (then capped and reported)");
});

/* ═══════════════════════════════ B. POLICY ═══════════════════════════════ */
await test("A19 (round 5, S1) the recording's duration is read from its container as the browsers write it — timestamps, packets and sizes can't shorten it", async () => {
  const A = await import("../supabase/functions/image-proxy/audio-length.mjs");
  const read = async (bytes) => A.audioDurationFromBytes(bytes);
  const secs = async (bytes) => (await read(bytes)).seconds;
  const near1 = (a, b, eps = 0.05) => a != null && Math.abs(a - b) <= eps;
  // Chrome's MediaRecorder WebM: Segment and Clusters of UNKNOWN size, no Duration → the last block's end
  let r = await read(chromeWebm(30));
  assert.equal(r.container, "webm"); assert.ok(near1(r.seconds, 30), j(r));
  assert.ok(near1(await secs(chromeWebm(595)), 595), "clusters of unknown size are followed to the end");
  // DTX: only one packet every 400 ms (silence sends almost nothing) — still the container's 300 s, not the 15 s of packets
  const dtx = chromeWebm(300, { packet: (i) => (i % 20 === 0 ? OPUS_SILENCE : null) });
  assert.ok(dtx.length < 10000, "a few KB for five minutes (no size estimate could see it)");
  assert.ok(near1(await secs(dtx), 299.62), "DTX: the container duration");
  // a Duration that lies short doesn't win; the Opus packets' own durations do when the timestamps lie
  assert.ok(near1(await secs(chromeWebm(60, { duration: 1000 })), 60), "Info Duration 1 s over 60 s of blocks");
  assert.ok(near1(await secs(chromeWebm(60, { frameMs: 20, packet: () => u8(0xfb, 0x03) })), 60 * 3), "code-3 packets of 3 x 20 ms: 60 ms each, whatever the timestamps say");
  // laced blocks, another codec, junk: unreadable
  assert.deepEqual(await read(chromeWebm(10, { lace: true })), { container: "webm", seconds: null, reason: "unreadable" });
  assert.deepEqual(await read(chromeWebm(10, { codec: "A_VORBIS" })), { container: "webm", seconds: null, reason: "unreadable" });
  // Firefox's Ogg Opus: the largest granule, or the packets' sum when a granule lies
  r = await read(firefoxOgg(45));
  assert.equal(r.container, "ogg"); assert.ok(near1(r.seconds, 45.0065), j(r));
  assert.ok(near1(await secs(firefoxOgg(45, { lastGranule: 960 })), 45), "a last page's granule of 20 ms doesn't shorten 45 s of packets");
  assert.deepEqual(await read(firefoxOgg(5, { head: cat([ascii("Speex   "), new Uint8Array(72)]) })), { container: "ogg", seconds: null, reason: "unreadable" }, "a codec it can't vouch for");
  // a second (chained) stream whose first page lacks the BOS flag still plays in a demuxer (it opens a stream for any
  // new serial): its 30 s count
  assert.ok(near1(await secs(cat([firefoxOgg(10), firefoxOgg(30, { serial: 0x9999, bos: false })])), 40.013), "10 s + a hidden 30 s stream");
  // Safari's MP4: fragmented AAC (moov durations 0) → the fragments; plain → media-length's reading; lying trun durations → the frame count
  r = await read(safariMp4(42));
  assert.equal(r.container, "mp4"); assert.ok(near1(r.seconds, 42.005), j(r));
  assert.ok(near1(await secs(safariMp4(42, { fragmented: false })), 42.005));
  assert.ok(near1(await secs(safariMp4(42, { sampleDuration: 1 })), 42.005), "1-tick sample durations: still 1,024 samples an AAC frame");
  // WAV: to the end of the file at the format's own byte rate — a data size that says less doesn't count
  assert.ok(near1(await secs(pcmWav(12)), 12)); assert.ok(near1(await secs(pcmWav(12, { declaredData: 100 })), 12));
  assert.deepEqual(await read(pcmWav(2, { format: 2 })), { container: "wav", seconds: null, reason: "unreadable" }, "ADPCM: not read");
  // nothing it recognises
  assert.deepEqual(await read(new Uint8Array(4000).fill(7)), { container: null, seconds: null, reason: "format" });
  assert.deepEqual(await read(new Uint8Array(0)), { container: null, seconds: null, reason: "format" });
  assert.equal((await read(chromeWebm(20).subarray(0, 60))).seconds, null, "a truncated header");
  // the Opus TOC table (RFC 6716 §3.1)
  assert.deepEqual([[0x00], [0x08], [0x10], [0x18], [0x60], [0x68], [0x80], [0x88], [0x90], [0x98], [0xf9], [0xfb, 0x04], [0xfb, 0x3f]].map((p) => A.opusPacketSamples(u8(...p), 0, p.length)),
    [480, 960, 1920, 2880, 480, 960, 120, 240, 480, 960, 1920, 3840, 5760]);
});

await test("A20 (round 5, S3) a reference length that may not size the hold isn't billed either: sizable [false] holds and settles the input at the maximum; the quote still sees the read", () => {
  const SD = "bytedance/seedance-2.5/reference-to-video";
  const base = { endpoint: SD, resolution: "1080p", kind: "refs", outputSeconds: 5, fixedOutput: true, maxOutputSeconds: 15, maxInputSeconds: 30.2, inputs: [2], unit: 0.03 };
  const open = P.lengthBilledVideoHold(base), same = P.lengthBilledVideoHold({ ...base, sizable: [true] }), shut = P.lengthBilledVideoHold({ ...base, sizable: [false] });
  assert.deepEqual([open.facts.vin, same.facts.vin], [2, 2], "a copy's read (or no sizable list) is billed as read");
  assert.equal(open.cost.credits, P.creditsFromUsd(1.164 * 0.6 * 7, 0.03));
  assert.equal(shut.facts.vin, null, "a read that may not bill is unread in the settle facts");
  assert.equal(shut.cost.credits, P.creditsFromUsd(1.164 * 0.6 * (5 + 30.2), 0.03), "held for the longest input");
  assert.equal(shut.expected.credits, open.cost.credits, "the quote check still compares the read length");
  // editing: the other references' read lengths may not bill either
  const ed = { endpoint: SD, resolution: "1080p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [5, 3], unit: 0.03 };
  assert.equal(P.lengthBilledVideoHold({ ...ed, sizable: [true, true] }).facts.vx, 3);
  assert.equal(P.lengthBilledVideoHold({ ...ed, sizable: [true, false] }).facts.vx, null);
  // the settle of an unread reference charges the longest input (never less than fal can bill)
  const settled = P.lengthBilledVideoSettle(shut.facts, 5, 0.03);
  assert.equal(settled.inputSeconds, 30.2);
});

section("B who may run what (billing-policy.mjs)");
const acct = (plan, extra = {}) => POL.accountFrom({ plan, remaining: 1000, ...extra });
const code = (r) => (r ? r.body.code : null);

await test("B1 the account as the proxy reads it (turn_credit_balance), with safe defaults", () => {
  const a = POL.accountFrom({ remaining: 12, plan: "studio", plan_remaining: 10, pack_remaining: 2, payment_status: "past_due", frozen: false, trial: false });
  assert.deepEqual([a.plan, a.remaining, a.planRemaining, a.packRemaining, a.paymentStatus, a.frozen], ["studio", 12, 10, 2, "past_due", false]);
  assert.equal(POL.accountFrom(null).plan, "none"); assert.equal(POL.accountFrom(null).remaining, 0);
  assert.equal(POL.normalizePlan("pro"), "director", "legacy pro reads as Director (app/plans.jsx TIER_GATES)");
  assert.equal(POL.normalizePlan("producer"), "studio");
  for (const p of ["none", "free", "cancelled", "trial", "", null, "admin"]) assert.equal(POL.normalizePlan(p), "none", String(p));
});

await test("B2 TRIAL / no plan: writing on the default engines and draft images only — no premium or formerly mispriced engines, no video, voice or 3D", () => {
  const none = acct("none", { trial: true });
  for (const m of ["claude-opus-5-5", "gemini-3.8-flash", "kimi-k2.7-code"]) assert.equal(POL.checkText(none, m), null, m);
  for (const m of ["claude-fable-5", "claude-fable-5-1", "gpt-6-astra", "kimi-k3", "gpt-5.5", "gemini-3.5-flash", "claude-opus-5"]) {
    const r = POL.checkText(none, m); assert.equal(r.status, 402, m); assert.equal(code(r), "plan_required", m);
  }
  assert.equal(POL.checkImage(none, { model: "gemini-nano-banana-2.1", imageSize: "1K" }), null);
  for (const s of ["2K", "4K"]) assert.equal(code(POL.checkImage(none, { model: "gemini-nano-banana-2.1", imageSize: s })), "plan_required", "a draft is 1K: " + s);
  assert.equal(code(POL.checkImage(none, { model: "gemini-3.1-flash-lite-image", imageSize: "1K" })), "plan_required", "the old id only passes once index.ts maps it");
  assert.equal(POL.checkImage(none, { model: P.canonicalImageModel("gemini-3.1-flash-lite-image"), imageSize: "1K" }), null);
  for (const m of ["gemini-3.1-flash-image", "gemini-3-pro-image", "gpt-image-2"]) assert.equal(code(POL.checkImage(none, { model: m, imageSize: "1K" })), "plan_required", m);
  assert.equal(code(POL.checkVideo(none, { appModel: "kling-3.0", resolution: "720p" })), "plan_required");
  for (const op of ["tts", "stt", "listVoices", "design", "saveVoice", "clone"]) assert.equal(code(POL.checkVoice(none, op)), "plan_required", op);
  assert.equal(code(POL.checkStudio3d(none)), "plan_required");
  // a cancelled account holding pack credits is a no-plan account too
  assert.equal(code(POL.checkText(acct("none", { pack_remaining: 900 }), "claude-fable-5-1")), "plan_required");
  // nothing left and no plan: the older "choose a plan" refusal (opens the Plans window)
  assert.deepEqual(POL.shortOfCredits(acct("none", { remaining: 0 }), 3, 0).body, { error: "no_plan", code: "no_plan", message: "Choose a plan to start creating — every generation runs on your plan's credits." });
  assert.equal(code(POL.shortOfCredits(acct("none"), 3000, 2)), "insufficient_credits", "a trial with credits left hears the numbers");
  assert.equal(code(POL.shortOfCredits(acct("writer"), 3, 0)), "insufficient_credits");
  assert.equal(POL.insufficientRefusal(1, 0).body.message, "This generation needs 1 credit, but this account has 0.");
  // the refusal says so in one sentence the Plans window can show
  assert.match(POL.planRequired("Video").body.message, /^Video needs a paid plan\. Without a plan, credits cover writing on the default engines and draft images\.$/);
});

await test("B3 plan TIERS exactly as the client gates them (TIER_GATES / ROOM_ENTITLEMENTS mirrored from app/plans.jsx)", () => {
  // the mirror really matches the app's tables
  const plans = read("app/plans.jsx");
  const grab = (name) => {
    const m = plans.match(new RegExp("const " + name + " = (\\{[\\s\\S]*?\\n\\});"));
    return Function("return " + m[1])();
  };
  const appGates = grab("TIER_GATES"), appRooms = grab("ROOM_ENTITLEMENTS");
  for (const t of ["writer", "none", "pro", "director", "studio"]) {
    assert.deepEqual({ ...POL.TIER_GATES[t], models: POL.TIER_GATES[t].models === "all" ? "all" : [...POL.TIER_GATES[t].models] }, appGates[t], "TIER_GATES." + t);
    assert.deepEqual({ ...POL.ROOM_ENTITLEMENTS[t] }, appRooms[t], "ROOM_ENTITLEMENTS." + t);
  }
  const draft = plans.match(/const DRAFT_IMAGE = \{ model:"([^"]+)"[^}]*maxRes:"([^"]+)" \}/);
  assert.deepEqual([draft[1], draft[2]], [POL.DRAFT_IMAGE.model, POL.DRAFT_IMAGE.maxRes], "the draft engine and its ceiling");
  // writing: every paid plan may pick every priced engine
  for (const p of ["writer", "director", "studio"]) for (const m of ["claude-fable-5-1", "gpt-5.5", "gemini-3.5-flash", "kimi-k3"]) assert.equal(POL.checkText(acct(p), m), null, p + " " + m);
  assert.equal(code(POL.checkText(acct("studio"), "")), "model_not_allowed", "an unpriced engine is refused, not guessed");
  // images: Writer up to 2K (dashboard key art; the Art Room is Director's), Director / Producer 4K
  assert.equal(POL.checkImage(acct("writer"), { model: "gpt-image-2", imageSize: "2K" }), null);
  const w4 = POL.checkImage(acct("writer"), { model: "gemini-3-pro-image", imageSize: "4K" });
  assert.equal(w4.status, 403); assert.equal(code(w4), "tier_required"); assert.equal(w4.body.requiredPlan, "director");
  assert.equal(w4.body.message, "4K images need the Director plan.");
  assert.equal(POL.checkVideo(acct("director"), {}).body.message, "The Stage needs the Producer plan.");
  assert.equal(POL.checkVoice(acct("writer"), "clone").body.message, "Character voices need the Director plan.");
  for (const p of ["director", "pro", "studio"]) assert.equal(POL.checkImage(acct(p), { model: "gemini-3-pro-image", imageSize: "4K" }), null, p);
  // video: the Stage is Producer's; its resolution ladder and takes per Generate
  for (const p of ["writer", "director", "pro"]) { const r = POL.checkVideo(acct(p), { appModel: "kling-3.0", resolution: "720p" }); assert.equal(code(r), "tier_required", p); assert.equal(r.body.requiredPlan, "studio"); }
  assert.equal(POL.checkVideo(acct("studio"), { appModel: "seedance-2.5", resolution: "4k", batch: 4 }), null);
  assert.equal(code(POL.checkVideo(acct("studio"), { appModel: "seedance-2.0", resolution: "720p", batch: 5 })), "tier_required", "at most 4 takes");
  // voice: the New Story interview (speech, transcription, the voice list) from Writer; character voices from Director
  for (const op of ["tts", "stt", "listVoices"]) assert.equal(POL.checkVoice(acct("writer"), op), null, op);
  for (const op of ["design", "saveVoice", "clone"]) { assert.equal(code(POL.checkVoice(acct("writer"), op)), "tier_required", op); assert.equal(POL.checkVoice(acct("director"), op), null, op); }
  // 3D (Blender Studio lives in the Art Room)
  assert.equal(code(POL.checkStudio3d(acct("writer"))), "tier_required"); assert.equal(POL.checkStudio3d(acct("director")), null);
});

await test("B4 a FROZEN account (disputed payment) may spend nothing; past-due keeps its plan; admins pass every gate", () => {
  const f = acct("studio", { frozen: true });
  for (const r of [POL.checkText(f, "claude-opus-5-5"), POL.checkImage(f, { model: "gemini-3.1-flash-image", imageSize: "1K" }), POL.checkVideo(f, {}), POL.checkVoice(f, "tts"), POL.checkStudio3d(f)]) {
    assert.equal(r.status, 403); assert.equal(code(r), "account_frozen");
  }
  assert.equal(POL.checkVideo(acct("studio", { payment_status: "past_due" }), { appModel: "kling-3.0", resolution: "720p" }), null);
  const admin = POL.accountFrom(null, { isAdmin: true });
  assert.equal(POL.checkVideo(admin, { appModel: "seedance-2.0", resolution: "4k", batch: 9 }), null);
  assert.equal(POL.checkText(admin, ""), null);
});

await test("B5 Frances daily caps by plan: 5 no plan / trial / cancelled / frozen, 15 Writer, 30 Director, 50 Producer; the secret is a ceiling", () => {
  const cap = (p, x) => POL.francesPlanLimit(acct(p, x));
  assert.deepEqual([cap("none"), cap("none", { trial: true }), cap("cancelled"), cap("writer"), cap("director"), cap("pro"), cap("studio"), cap("studio", { frozen: true })],
    [5, 5, 5, 15, 30, 30, 50, 5]);
  assert.deepEqual(POL.FRANCES_PLAN_LIMITS, { none: 5, writer: 15, director: 30, studio: 50 });
  assert.equal(francesEffectiveLimit(15, undefined), 15, "unset ceiling = 50 changes nothing");
  assert.equal(francesEffectiveLimit(50, "10"), 10, "an emergency brake");
  assert.equal(francesEffectiveLimit(undefined, undefined), FRANCES_DAILY_LIMIT_DEFAULT, "no plan cap (unknown account) = the ceiling");
  assert.equal(francesEffectiveLimit(5, "lots"), 5);
});

await test("B6 (repair F20) a balance too small for one answer on a heavy engine names the shortfall and a lighter engine — no vendor names", () => {
  const r = POL.writingShortfall(POL.accountFrom({ plan: "none", remaining: 20, trial: true }), 36, 20);
  assert.equal(r.status, 402); assert.equal(r.body.code, "insufficient_credits");
  assert.equal(r.body.message, "This writing engine needs at least 36 credits for one answer, but this account has 20 (16 short). Choose a lighter writing engine, or add credits.");
  assert.deepEqual([r.body.creditsRequired, r.body.creditsRemaining, r.body.creditsShort, r.body.suggest], [36, 20, 16, "lighter_writing_engine"]);
  assert.doesNotMatch(r.body.message, /claude|opus|anthropic|openai|gpt|gemini|google|kimi|moonshot|mckee/i);
  assert.equal(POL.writingShortfall(POL.accountFrom({ plan: "none", remaining: 0 }), 36, 0).body.code, "no_plan", "an empty no-plan balance still opens the plans");
  assert.match(POL.writingShortfall(POL.accountFrom({ plan: "writer", remaining: 5 }), 36, 5).body.message, /\(31 short\)/);
});

await test("B7 (round 3, S5 + S7) an empty balance (or one below the cheapest engine's one answer) hears 'add credits', not 'a lighter engine'; numbers get thousands commas", () => {
  const dir = (n) => POL.accountFrom({ plan: "director", remaining: n });
  // a paid account with 0: the plain insufficient-credits refusal — no engine can run, so none is suggested
  let r = POL.writingShortfall(dir(0), 36, 0);
  assert.deepEqual([r.status, r.body.code, r.body.message], [402, "insufficient_credits", "This generation needs 36 credits, but this account has 0."]);
  assert.equal(r.body.suggest, undefined); assert.doesNotMatch(r.body.message, /lighter/i);
  // a balance below the cheapest default engine's minimum hold: the same
  r = POL.writingShortfall(dir(5), 36, 5, { cheapest: 7 });
  assert.equal(r.body.message, "This generation needs 36 credits, but this account has 5."); assert.equal(r.body.suggest, undefined);
  // a balance a lighter engine CAN use: the lighter-engine sentence (repair F20), with the balance it reports
  r = POL.writingShortfall(dir(20), 36, 20, { cheapest: 7 });
  assert.match(r.body.message, /^This writing engine needs at least 36 credits for one answer, but this account has 20 \(16 short\)\. Choose a lighter writing engine, or add credits\.$/);
  assert.equal(r.body.suggest, "lighter_writing_engine");
  assert.equal(POL.writingShortfall(dir(7), 36, 7, { cheapest: 7 }).body.suggest, "lighter_writing_engine", "exactly the cheapest hold runs");
  // no plan: empty → 'choose a plan'; a trial remainder below the cheapest → add credits; above it → the lighter engine
  assert.equal(POL.writingShortfall(POL.accountFrom({ plan: "none", remaining: 0 }), 36, 0, { cheapest: 1 }).body.code, "no_plan");
  assert.equal(POL.writingShortfall(POL.accountFrom({ plan: "none", remaining: 3, trial: true }), 36, 3, { cheapest: 4 }).body.message, "This generation needs 36 credits, but this account has 3.");
  assert.equal(POL.writingShortfall(POL.accountFrom({ plan: "none", remaining: 3, trial: true }), 36, 3, { cheapest: 1 }).body.suggest, "lighter_writing_engine");
  // the cheapest hold is computed over the DEFAULT engines, each at its own minimum cap (Claude keeps its 16k room)
  const msgs = [{ role: "user", content: "Write scene 4." }];
  const c = P.cheapestTextHold({ models: POL.DEFAULT_TEXT_MODELS, messages: msgs, unit: 0.01 });
  const each = POL.DEFAULT_TEXT_MODELS.map((m) => P.textHoldEstimate({ model: m, messages: msgs, outputCap: P.textMinOutputCap(m), unit: 0.01 }).credits);
  assert.equal(c, Math.min(...each)); assert.equal(P.textMinOutputCap("claude-opus-5-5"), 16000); assert.equal(P.textMinOutputCap("gemini-3.8-flash"), 1024);
  assert.equal(P.cheapestTextHold({ models: ["no-such-engine"], messages: msgs }), null);
  // S7: users read credit counts with thousands separators
  assert.deepEqual([0, 7, 999, 1000, 1709, 27000, 1234567].map(POL.formatCredits), ["0", "7", "999", "1,000", "1,709", "27,000", "1,234,567"]);
  assert.equal(POL.insufficientRefusal(1709, 300).body.message, "This generation needs 1,709 credits, but this account has 300.");
  assert.deepEqual([POL.insufficientRefusal(1709, 300).body.creditsRequired, POL.insufficientRefusal(1709, 12000).body.creditsRemaining], [1709, 12000], "the numbers in the body stay numbers");
  assert.equal(POL.insufficientRefusal(4200, 1600).body.message, "This generation needs 4,200 credits, but this account has 1,600.");
  assert.match(POL.writingShortfall(dir(1200), 2500, 1200, { cheapest: 7 }).body.message, /needs at least 2,500 credits for one answer, but this account has 1,200 \(1,300 short\)/);
});

/* ═══════════════════════════ C. HOLDS & TOKEN ═══════════════════════════ */
section("C the hold client and the video-hold token (billing-holds.mjs)");

function fakeRpc(state = {}) {
  const S = { holds: {}, balance: 100, calls: [], fail: null, ...state };
  const rpc = async (name, args) => {
    S.calls.push([name, args]);
    if (S.fail && S.fail[name]) return { data: null, error: S.fail[name] };
    if (name === H.HOLD_RPC) {
      if (S.holds[args.ref]) return { data: { ok: true, duplicate: true, held: S.holds[args.ref].held, remaining: S.balance } };
      if (S.frozen) return { data: { ok: false, code: "frozen", held: 0, remaining: S.balance } };
      if (S.balance < args.amount) return { data: { ok: false, code: "insufficient", held: 0, remaining: S.balance } };
      S.balance -= args.amount; S.holds[args.ref] = { held: args.amount, status: "held" };
      return { data: { ok: true, held: args.amount, remaining: S.balance } };
    }
    const h = S.holds[args.ref];
    if (!h) return { data: { ok: false, code: "not_found" } };
    if (h.status !== "held") return { data: { ok: !(name === H.SETTLE_RPC && h.status === "released"), duplicate: true, status: h.status, kept: h.kept || 0, remaining: S.balance, ...(name === H.SETTLE_RPC && h.status === "released" ? { code: "released" } : {}) } };
    const keep = name === H.SETTLE_RPC ? Math.min(args.actual, h.held) : 0;
    S.balance += h.held - keep; h.status = name === H.SETTLE_RPC ? "settled" : "released"; h.kept = keep;
    return { data: { ok: true, status: h.status, held: h.held, kept: keep, released: h.held - keep, remaining: S.balance } };
  };
  return { S, rpc };
}

await test("C1 take → settle keeps min(actual, held) and refunds the rest; release refunds in full; both idempotent", async () => {
  const { S, rpc } = fakeRpc();
  let n = 0;
  const hc = H.createHoldClient({ rpc, uid: "u1", newId: () => "id" + (++n) });
  const h = await hc.take({ amount: 30, kind: "text", reason: "text:claude-opus-5-5" });
  assert.equal(h.ok, true); assert.equal(h.ref, "text:id1"); assert.equal(h.held, 30); assert.equal(S.balance, 70);
  assert.deepEqual(S.calls[0], [H.HOLD_RPC, { uid: "u1", amount: 30, ref: "text:id1", reason: "text:claude-opus-5-5" }]);
  const s = await h.settle(12);
  assert.equal(s.charged, 12); assert.equal(S.balance, 88); assert.equal(h.remaining, 88);
  await h.settle(12); await h.release(); await h.releaseUnlessDone();
  assert.equal(S.balance, 88, "a done hold is never touched again"); assert.equal(S.calls.length, 2);
  const h2 = await hc.take({ amount: 50, kind: "image" });
  await h2.releaseUnlessDone();
  assert.equal(S.balance, 88, "released in full");
  const h3 = await hc.take({ amount: 20, kind: "video" }); h3.keep(); await h3.releaseUnlessDone();
  assert.equal(S.balance, 68, "a hold handed to a job is not released on the way out");
  const over = await hc.take({ amount: 5 }); await over.settle(999);
  assert.equal(over.charged, 5, "never more than held");
});

await test("C2 refusals: insufficient / frozen / billing unavailable (a missing function is logged with the fix); a failed settle leaves the hold as the charge", async () => {
  const logs = [];
  let r = await H.createHoldClient({ rpc: fakeRpc({ balance: 3 }).rpc, uid: "u" }).take({ amount: 4 });
  assert.deepEqual([r.ok, r.code, r.remaining], [false, "insufficient", 3]);
  r = await H.createHoldClient({ rpc: fakeRpc({ frozen: true }).rpc, uid: "u" }).take({ amount: 1 });
  assert.deepEqual([r.ok, r.code], [false, "frozen"]);
  const missing = fakeRpc({ fail: { [H.HOLD_RPC]: { code: "PGRST202", message: "Could not find the function public.turn_hold_credits" } } });
  r = await H.createHoldClient({ rpc: missing.rpc, uid: "u", log: (m) => logs.push(m) }).take({ amount: 1 });
  assert.deepEqual([r.ok, r.code], [false, "unavailable"]); assert.match(logs[0], /Run supabase billing-v2\.sql before deploying this proxy/);
  r = await H.createHoldClient({ rpc: async () => { throw new Error("socket hang up"); }, uid: "u" }).take({ amount: 1 });
  assert.equal(r.code, "unavailable", "a throwing client is a refusal, never a free call");
  const f = fakeRpc(); const hc = H.createHoldClient({ rpc: f.rpc, uid: "u", log: (m) => logs.push(m) });
  const h = await hc.take({ amount: 9 });
  f.S.fail = { [H.SETTLE_RPC]: { message: "timeout" } };
  const s = await h.settle(2);
  assert.deepEqual([s.ok, s.charged], [false, 9]); assert.equal(f.S.balance, 91, "nothing refunded"); assert.equal(f.S.calls.filter((c) => c[0] === H.RELEASE_RPC).length, 0);
  // jsonb shapes: a one-row array, a JSON string, or wrapped in the function's name all read the same
  for (const shape of [(d) => [d], (d) => JSON.stringify(d), (d) => ({ turn_hold_credits: d })]) {
    const x = await H.createHoldClient({ rpc: async () => ({ data: shape({ ok: true, held: 7, remaining: 1 }) }), uid: "u" }).take({ amount: 7 });
    assert.deepEqual([x.ok, x.held, x.remaining], [true, 7, 1]);
  }
});

await test("C3 the signed video-hold token binds the hold to the account, the fal request and an expiry; tampering fails", async () => {
  const claims = { ref: "video:abc", uid: "user-1", rid: "req-9", held: 304, exp: Date.now() + 1000, u: 0.01 };
  const t = await H.signVideoHold("secret-1", claims);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe");
  assert.deepEqual(await H.verifyVideoHold("secret-1", t), claims);
  assert.equal(await H.verifyVideoHold("secret-2", t), null, "another secret");
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, ref: "video:abc", uid: "attacker", rid: "req-9", held: 304, exp: claims.exp })).toString("base64url");
  assert.equal(await H.verifyVideoHold("secret-1", forged + "." + sig), null, "a changed body");
  assert.equal(await H.verifyVideoHold("secret-1", body + "." + sig.slice(0, -2) + "AA"), null, "a changed signature");
  for (const junk of ["", "x", "a.b.c", null]) assert.equal(await H.verifyVideoHold("secret-1", junk), null);
  // it rides the job's own URLs and comes off before fal sees them
  const su = H.withHoldParam("https://queue.fal.run/fal-ai/kling-video/requests/req-9/status", t);
  const back = H.takeHoldParam(su);
  assert.equal(back.token, t); assert.equal(back.url, "https://queue.fal.run/fal-ai/kling-video/requests/req-9/status");
  assert.equal(H.falRequestId(back.url), "req-9"); assert.equal(H.falRequestId("https://queue.fal.run/x/requests/req-9"), "req-9");
  // settling across the switch: a hold taken at $0.03 and finished at $0.01 was multiplied by 3
  assert.equal(H.videoSettleAmount(100, 0.03, 0.01), 300); assert.equal(H.videoSettleAmount(100, 0.01, 0.01), 100); assert.equal(H.videoSettleAmount(100, null, 0.01), 100);
});

await test("C4 (repair F2) the MP4 length reader: moov first or last, 32/64-bit sizes, mvhd v0/v1, ranged reads only, junk → null", async () => {
  for (const [label, bytes, want] of [
    ["moov first", mp4(12.5), 12.5], ["moov last", mp4(30, { moovLast: true }), 30], ["mvhd v1", mp4(7.25, { version: 1 }), 7.25],
    ["64-bit mdat, moov last", mp4(4, { moovLast: true, largeMdat: true }), 4], ["mvhd after another moov child", mp4(9, { mvhdSecond: true }), 9],
  ]) assert.ok(near(await mp4DurationFromBytes(bytes), want, 1e-6), label);
  for (const junk of [new Uint8Array(0), new Uint8Array([137, 80, 78, 71]), ascii("not a video at all, just text"), mp4(0)]) assert.equal(await mp4DurationFromBytes(junk), null);
  // over HTTP: a 300 KB mdat before moov costs two small ranged GETs, never the whole file
  const big = mp4(21.3, { moovLast: true, mdatBytes: 300000 });
  const seen = [];
  const cdn = async (url, init) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); seen.push(init.headers.Range);
    assert.ok(init.signal, "every read has its own timeout");
    const a = Number(m[1]), b = Math.min(Number(m[2]), big.length - 1);
    return new Response(big.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${big.length}` } });
  };
  assert.ok(near(await probeMp4Duration("https://v3.fal.media/files/x.mp4", { fetchImpl: cdn }), 21.3, 1e-6));
  assert.equal(seen.length, 2, j(seen)); assert.match(seen[0], /^bytes=0-65535$/);
  // a server that ignores Range past the start, or answers an error: unreadable (the hold stands)
  const noRange = async () => new Response(big, { status: 200, headers: { "content-length": String(big.length) } });
  assert.equal(await probeMp4Duration("https://v3.fal.media/files/x.mp4", { fetchImpl: noRange }), null);
  assert.equal(await probeMp4Duration("https://v3.fal.media/files/x.mp4", { fetchImpl: async () => new Response("", { status: 403 }) }), null);
  assert.equal(await probeMp4Duration("https://v3.fal.media/files/x.mp4", { fetchImpl: async () => { throw new Error("reset"); } }), null);
  assert.equal(await readMp4Duration(async () => null), null);
  // only fal's media CDN counts as a render host
  assert.deepEqual(["https://v3.fal.media/files/a.mp4", "https://fal.media/a.mp4", "https://evilfal.media/a.mp4", "http://v3.fal.media/a.mp4", "https://fal.media.example.com/a.mp4"].map(isFalMediaUrl), [true, true, false, false, false]);
});

await test("C5 (repair F1) fal queue URLs are taken apart strictly; the response URL is built on the server; the token only carries settle facts", async () => {
  assert.deepEqual(H.falStatusParts("https://queue.fal.run/fal-ai/kling-video/requests/req-9/status?logs=1&kinolot_hold=x"), { base: "fal-ai/kling-video", rid: "req-9" });
  for (const bad of ["https://queue.fal.run/fal-ai/kling-video/requests/req-9", "https://evil.fal.run/fal-ai/x/requests/r/status", "http://queue.fal.run/a/requests/r/status",
    "https://queue.fal.run:8443/a/requests/r/status", "https://queue.fal.run/a/requests/r/cancel", "https://queue.fal.run/requests/r/status", "not a url"]) assert.equal(H.falStatusParts(bad), null, bad);
  assert.equal(H.falResponseUrl({ base: "fal-ai/kling-video", rid: "req-9" }), "https://queue.fal.run/fal-ai/kling-video/requests/req-9");
  assert.equal(H.falBaseMatches("fal-ai/kling-video", "fal-ai/kling-video/v3/standard/image-to-video"), true);
  assert.equal(H.falBaseMatches("bytedance/seedance-2.5/reference-to-video", "bytedance/seedance-2.5/reference-to-video"), true);
  assert.equal(H.falBaseMatches("fal-ai/kling", "fal-ai/kling-video/v3/standard/image-to-video"), false, "a whole path segment only");
  assert.equal(H.falBaseMatches("meshy/v7", "fal-ai/kling-video/v3/standard/image-to-video"), false);
  const s = { k: "motion", rate: 0.168, mo: 30, fx: 0, vin: null, n: 1, mi: 0 };
  const t = await H.signVideoHold("secret-1", { ref: "video:a", uid: "u", rid: "r", held: 5, exp: 1, u: 0.01, s });
  assert.deepEqual((await H.verifyVideoHold("secret-1", t)).s, s);
  // the lookup and attach calls speak the SQL contract
  const calls = [];
  const hc = H.createHoldClient({ rpc: async (name, args) => { calls.push([name, args]); return name === H.LOOKUP_RPC ? { data: { found: true, ref: "video:a", owner: "u", held: 63, status: "held", kept: null, created_at: "2026-09-30T10:00:00Z", reason: "video:kling-3.0:720p" } } : { data: { ok: true } }; }, uid: "u" });
  assert.deepEqual(await hc.attach("video:a", "req-1"), { ok: true });
  const lk = await hc.lookup("req-1");
  assert.deepEqual([lk.ok, lk.found, lk.ref, lk.owner, lk.held, lk.status, lk.createdAtMs], [true, true, "video:a", "u", 63, "held", Date.parse("2026-09-30T10:00:00Z")]);
  assert.deepEqual(calls, [[H.ATTACH_RPC, { ref: "video:a", provider_ref: "req-1" }], [H.LOOKUP_RPC, { provider_ref: "req-1" }]]);
  assert.deepEqual(await H.createHoldClient({ rpc: async () => ({ data: { ok: false, code: "mismatch" } }), uid: "u" }).attach("video:a", "req-2"), { ok: false, code: "mismatch" });
  assert.deepEqual(await H.createHoldClient({ rpc: async () => ({ error: { message: "down" } }), uid: "u" }).lookup("req-2"), { ok: false }, "a failed lookup is not 'no hold'");
  assert.deepEqual(await H.createHoldClient({ rpc: async () => ({ data: { found: false } }), uid: "u" }).lookup("req-2"), { ok: true, found: false });
});

await test("C6 (round 2, S4) a length is the LARGEST of mvhd, every tkhd / mdhd and the video track's stts — a lying mvhd is outvoted", async () => {
  // honest file: every field says 12 s
  const honest = mp4Tracks({ mvhd: 12, tracks: [{ tkhd: 12, mdhd: 12, stts: fps25(12) }] });
  assert.ok(near(await mp4DurationFromBytes(honest), 12, 1e-6));
  // the reviewer's forged file: mvhd edited to 3 s, the tracks still say 30 s → 30
  for (const moovLast of [false, true]) assert.ok(near(await mp4DurationFromBytes(forgedMp4(3, 30, { moovLast })), 30, 1e-6), "moovLast " + moovLast);
  // only ONE field tells the truth — each of them alone is enough
  const only = (tr, mvhd = 3) => mp4DurationFromBytes(mp4Tracks({ mvhd, tracks: [{ tkhd: 3, mdhd: 3, stts: fps25(3), ...tr }] }));
  assert.ok(near(await only({ tkhd: 30 }), 30, 1e-6), "tkhd");
  assert.ok(near(await only({ mdhd: 30 }), 30, 1e-6), "mdhd");
  assert.ok(near(await only({ stts: fps25(30) }), 30, 1e-6), "the video sample table (what a player follows)");
  assert.ok(near(await only({ tkhd: 30, mdhd: 30, v1: true }), 30, 1e-6), "64-bit (version 1) track headers");
  assert.ok(near(await mp4DurationFromBytes(mp4Tracks({ mvhd: 3, tracks: [{ tkhd: 3, mdhd: 3, stts: fps25(3) }, { handler: "soun", tkhd: 3, mdhd: 29, timescale: 48000 }] })), 29, 1e-6), "an audio track's mdhd counts too");
  // ROUND 3 (S2): EVERY track's sample table counts — an audio track's too (it used to be the video's only)
  const f = moovDurations(moovBody(mp4Tracks({ mvhd: 3, tracks: [{ handler: "soun", mdhd: 3, timescale: 1000, stts: [[1, 30000]] }] })));
  assert.deepEqual([f.mvhd, f.mdhd, f.stts], [3, [3], [30]], "an audio track's sample table is a length too");
  assert.ok(near(await mp4DurationFromBytes(mp4Tracks({ mvhd: 3, tracks: [{ tkhd: 3, mdhd: 3, stts: fps25(3) }, { handler: "soun", tkhd: 3, mdhd: 3, timescale: 48000, stts: [[28 * 48000 / 960, 960]] }] })), 28, 1e-6), "only the audio track's table tells the truth");
  // no mvhd at all, tracks only: still read
  assert.ok(near(await mp4DurationFromBytes(mp4Tracks({ tracks: [{ mdhd: 8, stts: fps25(8) }] })), 8, 1e-6));
  // every field zero (a fragmented file) → unreadable (the maximum is held)
  assert.deepEqual(await mp4InfoFromBytes(mp4Tracks({ mvhd: 0, tracks: [{ tkhd: 0, mdhd: 0, stts: [] }] })), { seconds: null, reason: "unreadable" });
  // reasons: not an MP4 / MOV, and junk
  assert.equal((await mp4InfoFromBytes(ascii("<!doctype html> this is a web page"))).reason, "format");
  assert.equal((await mp4InfoFromBytes(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).reason, "format", "WebM / Matroska");
  // over HTTP: a timed-out ranged read is retried ONCE; twice → "timeout"; an HTTP error → "unreadable"
  const bytes = forgedMp4(3, 21, { moovLast: true, mdatBytes: 200000 });
  const serve = (init) => { const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); const a = Number(m[1]), b = Math.min(Number(m[2]), bytes.length - 1);
    return new Response(bytes.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${bytes.length}` } }); };
  let n = 0;
  const flaky = async (_u, init) => { n++; if (n === 1) throw new DOMException("The operation timed out.", "TimeoutError"); return serve(init); };
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/files/f.mp4", { fetchImpl: flaky }), { seconds: 21, reason: null });
  assert.equal(n, 3, "one retry of the first read, then the moov read");
  const dead = async () => { throw new DOMException("The operation timed out.", "TimeoutError"); };
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/files/f.mp4", { fetchImpl: dead }), { seconds: null, reason: "timeout" });
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/files/f.mp4", { fetchImpl: async () => new Response("", { status: 403 }) }), { seconds: null, reason: "unreadable" });
  assert.equal(await probeMp4Duration("https://v3.fal.media/files/f.mp4", { fetchImpl: async (_u, init) => serve(init) }), 21);
});

await test("C9 (round 3, S2) a FRAGMENTED MP4 is unreadable (held at the maximum): mvex in the moov, or a moof anywhere, whatever the moov declares", async () => {
  // the verify-money file: moov says 1 s, mvex/mehd and the fragments say 15 s → unreadable (was 1 s)
  assert.deepEqual(await mp4InfoFromBytes(fragmentedMp4(1, 15)), { seconds: null, reason: "unreadable" });
  assert.deepEqual([moovDurations(moovBody(fragmentedMp4(1, 15))).fragmented, moovDurations(moovBody(fragmentedMp4(1, 15))).mvhd], [true, 1], "mvex marks the moov");
  assert.equal(moovDurations(moovBody(fragmentedMp4(1, 15, { withMvex: false }))).fragmented, false);
  // no mvex, but movie fragments follow the moov: unreadable
  assert.deepEqual(await mp4InfoFromBytes(fragmentedMp4(1, 15, { withMvex: false })), { seconds: null, reason: "unreadable" });
  // fragments before a moov at the end: unreadable
  assert.deepEqual(await mp4InfoFromBytes(fragmentedMp4(1, 15, { withMvex: false, moovLast: true })), { seconds: null, reason: "unreadable" });
  // an honest moov that happens to be long doesn't save a fragmented file (fragments are never trusted)
  assert.deepEqual(await mp4InfoFromBytes(fragmentedMp4(20, 15)), { seconds: null, reason: "unreadable" });
  // over HTTP: the walk goes on past the moov (a 300 KB plain mdat first) to find the fragment — two small ranged reads
  const seen = [];
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/files/frag.mp4", { fetchImpl: rangedCdn(fragmentedMp4(1, 15, { withMvex: false, firstMdat: 300000 }), seen) }), { seconds: null, reason: "unreadable" });
  assert.equal(seen.length, 2, j(seen));
  // plain files still read — moov first (ONE ranged read: the mdat runs to the end of the file) or last (two), 64-bit mdat, size-0 mdat
  const s1 = [];
  assert.ok(near(await probeMp4Duration("https://v3.fal.media/files/p.mp4", { fetchImpl: rangedCdn(mp4(12.5, { mdatBytes: 300000 }), s1) }), 12.5, 1e-6)); assert.equal(s1.length, 1, j(s1));
  assert.ok(near(await mp4DurationFromBytes(mp4(9, { largeMdat: true })), 9, 1e-6), "64-bit mdat after the moov");
  const zeroTail = cat([mbox("ftyp", ascii("isom"), be32(512), ascii("isom")), mbox("moov", mvhdBox(6)), be32(0), ascii("mdat"), new Uint8Array(500)]);
  assert.ok(near(await mp4DurationFromBytes(zeroTail), 6, 1e-6), "an mdat that runs to the end (size 0) ends the walk");
  // junk after the moov that isn't a box can't vouch for the file; two moovs neither
  const junkTail = cat([mbox("ftyp", ascii("isom"), be32(512), ascii("isom")), mbox("moov", mvhdBox(6)), be32(3), ascii("xxxx")]);
  assert.equal((await mp4InfoFromBytes(junkTail)).seconds, null);
  const twoMoov = cat([mbox("ftyp", ascii("isom"), be32(512), ascii("isom")), mbox("moov", mvhdBox(1)), mbox("moov", mvhdBox(30))]);
  assert.equal((await mp4InfoFromBytes(twoMoov)).seconds, null);
  // a server that won't say how long the file is (content-range */*): a failed read past the moov is the end of the file
  const bytes = mp4(7, { mdatBytes: 100 });
  const noTotal = async (_u, init) => { const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); const a = Number(m[1]); if (a >= bytes.length) return new Response("", { status: 416 });
    const b = Math.min(Number(m[2]), bytes.length - 1); return new Response(bytes.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/*` } }); };
  assert.ok(near(await probeMp4Duration("https://v3.fal.media/files/nt.mp4", { fetchImpl: noTotal }), 7, 1e-6));
});

await test("C7 (round 2, S3) request ids are canonical; the drain window; the hold's reason carries the endpoint and the settle facts", () => {
  assert.equal(H.canonicalRequestId("7C9E6679-7425-40DE-944B-E07FC1F90AE7"), "7c9e6679-7425-40de-944b-e07fc1f90ae7");
  assert.equal(H.canonicalRequestId("7c9e6679742540de944be07fc1f90ae7"), "7c9e6679-7425-40de-944b-e07fc1f90ae7", "32 hex digits get their dashes");
  assert.equal(H.canonicalRequestId(" 7C9E6679742540DE944BE07FC1F90AE7 "), "7c9e6679-7425-40de-944b-e07fc1f90ae7");
  assert.equal(H.canonicalRequestId("req-9"), "req-9");
  for (const bad of ["", null, "a b", "x".repeat(129), "../x", "é"]) assert.equal(H.canonicalRequestId(bad), "", String(bad));
  // round 3 (S8): only fal's own spelling (a UUID: 8-4-4-4-12 or 32 hex, any case) may be served without a hold row
  for (const ok of ["7c9e6679-7425-40de-944b-e07fc1f90ae7", "7C9E6679-7425-40DE-944B-E07FC1F90AE7", "7c9e6679742540de944be07fc1f90ae7", " 7c9e6679742540de944be07fc1f90ae7 "]) assert.equal(H.isUuidRequestId(ok), true, ok);
  for (const bad of ["7c9e-6679742540de944b-e07fc1f90ae7", "7c9e6679-742540de-944b-e07fc1f90ae7", "7c9e6679-7425-40de-944b-e07fc1f90ae", "req-9", "", null, "7c9e6679_7425_40de_944b_e07fc1f90ae7", "{7c9e6679-7425-40de-944b-e07fc1f90ae7}"])
    assert.equal(H.isUuidRequestId(bad), false, String(bad));
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(H.legacyPollAllowed(undefined, now), true, "no marker yet: the drain window hasn't started");
  assert.equal(H.legacyPollAllowed(null, now), true);
  assert.equal(H.legacyPollAllowed(new Date(now - 47 * 3600e3).toISOString(), now), true, "47 h after the marker");
  assert.equal(H.legacyPollAllowed(new Date(now - 49 * 3600e3).toISOString(), now), false, "49 h after the marker");
  assert.equal(H.legacyPollAllowed("not a date", now), null); assert.equal(H.legacyPollAllowed(NaN, now), null);
  assert.equal(H.VIDEO_DRAIN_WINDOW_MS, 48 * 3600e3);
  // fal's queue path is the endpoint's owner/app, for every endpoint the proxy allows
  const ALLOWED = ["bytedance/seedance-2.0/reference-to-video", "bytedance/seedance-2.0/fast/reference-to-video", "bytedance/seedance-2.0/image-to-video",
    "bytedance/seedance-2.0/fast/image-to-video", "bytedance/seedance-2.0/text-to-video", "bytedance/seedance-2.0/fast/text-to-video",
    "bytedance/seedance-2.5/reference-to-video", "bytedance/seedance-2.5/image-to-video", "bytedance/seedance-2.5/text-to-video",
    "fal-ai/kling-video/v3/standard/image-to-video", "fal-ai/kling-video/v3/pro/image-to-video", ...KLING_MOTION_ENDPOINTS];
  const src = read("supabase/functions/image-proxy/index.ts");
  for (const e of ALLOWED) {
    assert.ok(src.includes(`"${e}"`) || KLING_MOTION_ENDPOINTS.includes(e), "the proxy allows " + e);
    assert.equal(H.falQueueBase(e), e.split("/").slice(0, 2).join("/"), e);
    assert.ok(H.falBaseMatches(H.falQueueBase(e), e), e);
  }
  // the reason round-trips, stays under 200 characters in the worst case, and old reasons still name a queue path
  const facts = { v: 2, k: "editing", rate: 1.1640000000001, mo: 30, fx: 0, vin: null, vx: 27.5, n: 10, mi: 30.2 };
  let worst = 0;
  for (const e of ALLOWED) for (const k of ["motion", "editing", "refs"]) {
    const r = H.videoHoldReason({ appModel: P.videoAppModel(e), resolution: "1080p", endpoint: e, userKey: true, facts: { ...facts, k, rate: 12.345678901 } });
    worst = Math.max(worst, r.length);
    const back = H.parseVideoHoldReason(r);
    assert.equal(back.endpoint, e); assert.equal(back.base, H.falQueueBase(e)); assert.equal(back.userKey, true); assert.equal(back.facts.k, k);
    assert.ok(P.lengthBilledFacts(back.facts), "the facts survive: " + r);
  }
  assert.ok(worst < 200, "worst reason " + worst + " characters");
  const r1 = H.parseVideoHoldReason(H.videoHoldReason({ appModel: "seedance-2.5", resolution: "720p", endpoint: "bytedance/seedance-2.5/reference-to-video", facts }));
  assert.equal(r1.facts.rate, 1.164, "rates keep 6 decimals, float noise dropped"); assert.equal(r1.facts.vin, undefined, "nulls are left out");
  assert.deepEqual(H.parseVideoHoldReason("video:kling-3.0:720p"), { appModel: "kling-3.0", resolution: "720p", endpoint: "", base: "fal-ai/kling-video", userKey: false, facts: null });
  assert.equal(H.parseVideoHoldReason("video:kling-3.0-motion-control:1080p").base, "fal-ai/kling-video");
  assert.equal(H.parseVideoHoldReason("video:seedance-2.0:480p").base, "bytedance/seedance-2.0");
  assert.equal(H.parseVideoHoldReason("text:claude-opus-5-5"), null);
  assert.equal(H.parseVideoHoldReason("video:x:720p m=a/b s={broken}").facts, null, "unparseable facts: the hold is the charge");
  assert.equal(H.parseVideoHoldReason("video:x:720p m=a/b s={broken"), null);
});

await test("C8 (round 2, S1) the video reconciliation: fal's own status settles, releases or leaves each open hold; throttled; at most 50", async () => {
  const mkWorld = (o = {}) => {
    const S = { claim: o.claim ?? true, holds: o.holds || [], calls: [], fal: o.fal || {}, settled: {}, released: [] };
    const rpc = async (name, args) => {
      S.calls.push([name, args]);
      if (name === "turn_claim_housekeeping") return o.claimError ? { error: { message: "down" } } : { data: S.claim };
      if (name === "turn_open_provider_holds") return { data: S.holds.filter((h) => !S.settled[h.ref] && !S.released.includes(h.ref)).slice(0, args.max_rows) };
      if (name === H.SETTLE_RPC) { S.settled[args.ref] = args.actual; return { data: { ok: true, kept: args.actual, remaining: 1 } }; }
      if (name === H.RELEASE_RPC) { S.released.push(args.ref); return { data: { ok: true, remaining: 1 } }; }
      return { error: { message: "unexpected " + name } };
    };
    const fetchImpl = async (url, init = {}) => {
      S.calls.push(["fetch", String(url), init.method || "GET"]);
      const m = /^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/]+)(\/status|\/cancel)?$/.exec(String(url));
      const job = m && S.fal[m[2]];
      if (!m || !job || (job.base && job.base !== m[1])) return new Response(JSON.stringify({ detail: "Request not found" }), { status: 404 });
      if (job.throws) throw new TypeError("fetch failed");
      if (m[3] === "/cancel") return new Response("{}", { status: job.cancel ?? 400 });
      if (m[3] === "/status") return job.statusCode ? new Response("{}", { status: job.statusCode }) : new Response(JSON.stringify({ status: job.status, ...(job.error ? { error: job.error } : {}) }), { status: 200 });
      if (job.resultCode) return new Response("{}", { status: job.resultCode });
      return new Response(JSON.stringify({ video: job.video === null ? null : { url: job.video || "https://v3.fal.media/files/out.mp4" } }), { status: 200 });
    };
    return { S, rpc, fetchImpl };
  };
  const old = new Date(Date.now() - 2 * 3600e3).toISOString(), ancient = new Date(Date.now() - 7 * 3600e3).toISOString();
  const row = (id, extra = {}) => ({ ref: "video:" + id, owner: "u1", provider_ref: id, held: 100, created_at: old,
    reason: H.videoHoldReason({ appModel: "kling-3.0", resolution: "720p", endpoint: "fal-ai/kling-video/v3/standard/image-to-video" }), ...extra });
  const mcFacts = P.lengthBilledVideoHold({ endpoint: "fal-ai/kling-video/v3/pro/motion-control", resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [null], unit: 0.01 }).facts;
  const w = mkWorld({
    holds: [row("done"), row("mc", { held: 504, reason: H.videoHoldReason({ appModel: "kling-3.0-motion-control", resolution: "1080p", endpoint: "fal-ai/kling-video/v3/pro/motion-control", facts: mcFacts }) }),
      row("failed"), row("errored"), row("gone"), row("running"), row("queued-old", { created_at: ancient }), row("flaky"), row("no-result"), row("no-video"),
      row("mine", { reason: H.videoHoldReason({ appModel: "kling-3.0", resolution: "720p", endpoint: "fal-ai/kling-video/v3/standard/image-to-video", userKey: true }) }),
      row("legacy", { reason: "video:seedance-2.5:1080p" }), { ref: "studio:e1", owner: "u1", provider_ref: "mesh-1", held: 40, created_at: old, reason: "blender-studio" }],
    fal: { done: { status: "COMPLETED" }, mc: { status: "COMPLETED", video: "https://v3.fal.media/files/mc12.mp4" }, failed: { status: "FAILED", error: "likeness" },
      errored: { status: "COMPLETED", error: "moderation" }, running: { status: "IN_PROGRESS" }, "queued-old": { status: "IN_QUEUE", cancel: 202 },
      flaky: { throws: true }, "no-result": { status: "COMPLETED", resultCode: 502 }, "no-video": { status: "COMPLETED", video: null },
      mine: { status: "COMPLETED" }, legacy: { status: "FAILED", base: "bytedance/seedance-2.5" } },
  });
  const probe = async (url) => (url === "https://v3.fal.media/files/mc12.mp4" ? 12.02 : null);
  const r = await VR.reconcileVideoHolds({ rpc: w.rpc, falKey: "k", fetchImpl: w.fetchImpl, probe, unitNow: async () => 0.01 });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.deepEqual(w.S.settled, { "video:done": 100, "video:mc": P.creditsFromUsd(0.168 * 12) }, "completed → settled; a length-billed render at the OUTPUT's real length");
  assert.deepEqual(w.S.released.sort(), ["video:errored", "video:failed", "video:gone", "video:legacy", "video:queued-old"], "failed / errored / not found / an old reason's job / a stuck queue fal cancelled → released");
  assert.deepEqual([r.body.checked, r.body.settled, r.body.released, r.body.left], [11, 2, 5, 5], j(r.body));
  assert.ok(!w.S.calls.some((c) => c[0] === "fetch" && /\/mine\//.test(c[1])), "a job on a caller's own key isn't asked about");
  assert.ok(!w.S.calls.some((c) => c[0] === "fetch" && /mesh-1/.test(c[1])), "blender-bridge's holds are its own");
  assert.deepEqual(w.S.calls.find((c) => c[0] === "turn_claim_housekeeping")[1], { job: "image-proxy_reconcile", every_seconds: 240 });
  assert.deepEqual(w.S.calls.find((c) => c[0] === "turn_open_provider_holds")[1], { older_than_minutes: 60, max_rows: VR.RECONCILE_FETCH_ROWS, ref_prefix: "video:" });
  // a database without ref_prefix yet: asked again without it (the rows are filtered here either way)
  const np = mkWorld({ holds: [row("done")], fal: { done: { status: "COMPLETED" } } });
  const npRpc = async (name, args) => (name === "turn_open_provider_holds" && "ref_prefix" in args ? { error: { code: "PGRST202", message: "Could not find the function public.turn_open_provider_holds(max_rows, older_than_minutes, ref_prefix)" } } : np.rpc(name, args));
  assert.equal((await VR.reconcileVideoHolds({ rpc: npRpc, falKey: "k", fetchImpl: np.fetchImpl })).body.settled, 1);
  assert.ok(w.S.calls.some((c) => c[0] === "fetch" && c[1] === "https://queue.fal.run/fal-ai/kling-video/requests/queued-old/cancel" && c[2] === "PUT"));
  // throttled: no work at all
  const t = mkWorld({ claim: false, holds: [row("done")], fal: { done: { status: "COMPLETED" } } });
  const tr = await VR.reconcileVideoHolds({ rpc: t.rpc, falKey: "k", fetchImpl: t.fetchImpl });
  assert.deepEqual(tr.body, { ok: true, checked: 0, settled: 0, released: 0, left: 0, throttled: true });
  assert.ok(!t.S.calls.some((c) => c[0] === "fetch" || c[0] === "turn_open_provider_holds"));
  // at most 50 a run (the rest wait for the next)
  const many = mkWorld({ holds: Array.from({ length: 60 }, (_, i) => row("r" + i)), fal: Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["r" + i, { status: "IN_PROGRESS" }])) });
  const mr = await VR.reconcileVideoHolds({ rpc: many.rpc, falKey: "k", fetchImpl: many.fetchImpl });
  assert.deepEqual([mr.body.checked, mr.body.left], [50, 50]); assert.equal(many.S.calls.filter((c) => c[0] === "fetch").length, 50);
  // the time budget: nothing new starts after it
  let clock = 0;
  const b = mkWorld({ holds: [row("done")], fal: { done: { status: "COMPLETED" } } });
  const br = await VR.reconcileVideoHolds({ rpc: b.rpc, falKey: "k", fetchImpl: b.fetchImpl, now: () => (clock += 100000), budgetMs: 55000 });
  assert.equal(br.body.checked, 0);
  // a claim that fails, or no fal key: refused, nothing done
  assert.equal((await VR.reconcileVideoHolds({ rpc: mkWorld({ claimError: true }).rpc, falKey: "k" })).status, 503);
  assert.equal((await VR.reconcileVideoHolds({ rpc: mkWorld().rpc, falKey: "" })).status, 503);
  // the poll and the reconciliation share ONE charge rule
  assert.ok(read("supabase/functions/image-proxy/index.ts").includes("finishedVideoCharge({ held: found.held, facts, videoUrl: vurl"));
});

await test("C10 (round 4, S3) the reader walks EVERY box in the moov: a fragment box at any depth (or hidden in a data box) is unreadable, edit lists count, a stts short of stsz is extended", async () => {
  const lie = 1, real = 15;
  const ftyp = mbox("ftyp", ascii("isom"), be32(512), ascii("isomiso2avc1mp41"));
  const trex = mbox("trex", u8(0, 0, 0, 0), be32(1), be32(1), be32(512), be32(0), be32(0));
  const mehd = mbox("mehd", u8(0, 0, 0, 0), be32(real * 1000));
  const moof = mbox("moof", mbox("mfhd", u8(0, 0, 0, 0), be32(1)), mbox("traf", mbox("tfhd", u8(0, 2, 0, 0), be32(1)), mbox("trun", u8(0, 0, 0, 0), be32(375))));
  const elst = (entries, v = 0) => mbox("elst", u8(v, 0, 0, 0), be32(entries.length), ...entries.flatMap(([dur, mt]) => v === 1 ? [be64(dur), be64(mt < 0 ? 0 : mt), be32(0x00010000)] : [be32(dur), be32(mt < 0 ? 0xffffffff : mt), be32(0x00010000)]));
  const stsz = (count, constant = 100) => mbox("stsz", u8(0, 0, 0, 0), be32(constant), be32(count));
  const media = (stts, extra = []) => mbox("mdia", mdhdBox(lie, 12800), hdlrBox("vide"), mbox("minf", mbox("stbl", sttsBox(stts), ...extra)));
  const file = (moovKids, after = []) => cat([ftyp, mbox("moov", mvhdBox(lie), ...moovKids), mbox("mdat", new Uint8Array(1500)), ...after]);
  const read = async (bytes) => mp4InfoFromBytes(bytes);
  const unreadable = { seconds: null, reason: "unreadable" };
  // the verifier's case A: mvex inside the trak, the fragments inside the moov (no top-level moof)
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), media([]), mbox("mvex", mehd, trex)), moof])), unreadable, "A");
  // case B: trex and a moof inside moov/udta
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), media([[25, 512]])), mbox("udta", trex, moof)])), unreadable, "B");
  // any fragment box, at any depth — or hidden inside a box that isn't a container (a sample description)
  for (const [name, kid] of [["trex in minf", mbox("trak", tkhdBox(lie), mbox("mdia", mdhdBox(lie, 12800), hdlrBox("vide"), mbox("minf", trex, mbox("stbl", sttsBox([[25, 512]])))))],
    ["mehd in udta/meta", mbox("udta", mbox("meta", u8(0, 0, 0, 0), mbox("hdlr", new Uint8Array(20)), mehd))],
    ["traf alone", mbox("udta", mbox("traf", mbox("trun", u8(0, 0, 0, 0), be32(1))))],
    ["trex inside a sample entry (byte scan)", mbox("trak", tkhdBox(lie), media([[25, 512]], [mbox("stsd", u8(0, 0, 0, 0), be32(1), mbox("avc1", new Uint8Array(78), trex))]))]]) {
    assert.deepEqual(await read(file([kid])), unreadable, name);
  }
  // case E: an edit list whose empty edit adds 14 s before the 1 s of media (tkhd / mdhd / mvhd say 1 s) → 15 s
  const e = file([mbox("trak", tkhdBox(lie), mbox("edts", elst([[14000, -1], [1000, 0]])), media([[25, 512]]))]);
  assert.deepEqual(await read(e), { seconds: 15, reason: null }, "E");
  assert.deepEqual(moovDurations(moovBody(e)).elst, [15]);
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), mbox("edts", elst([[4000, -1], [1000, 0]], 1)), media([[25, 512]]))])), { seconds: 5, reason: null }, "a version-1 edit list");
  // an honest file with an edit list equal to its length still reads its length
  const honest8 = cat([ftyp, mbox("moov", mvhdBox(8),
    mbox("trak", tkhdBox(8), mbox("edts", elst([[8000, 0]])), mbox("mdia", mdhdBox(8, 12800), hdlrBox("vide"), mbox("minf", mbox("stbl", sttsBox(fps25(8)), stsz(200)))))),
    mbox("mdat", new Uint8Array(1500))]);
  assert.deepEqual(await read(honest8), { seconds: 8, reason: null });
  // case D: stts covers ONE sample while stsz lists 375 (15 s at 25 fps): a demuxer plays the rest at the last delta
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), media([[1, 512]], [stsz(375)]))])), { seconds: 15, reason: null }, "D");
  // tables that claim more entries than their box holds (a demuxer reads on into the next box), a timing
  // box outside its place, or twice where one belongs: unreadable
  const sttsOverclaim = mbox("stts", u8(0, 0, 0, 0), be32(1000), be32(25), be32(512));
  for (const [name, kids] of [["stts claims 1,000 entries, holds 1", [mbox("trak", tkhdBox(lie), mbox("mdia", mdhdBox(lie, 12800), hdlrBox("vide"), mbox("minf", mbox("stbl", sttsOverclaim))))]],
    ["elst claims 9 entries, holds 1", [mbox("trak", tkhdBox(lie), mbox("edts", mbox("elst", u8(0, 0, 0, 0), be32(9), be32(1000), be32(0), be32(0x00010000))), media([[25, 512]]))]],
    ["stsz claims 375 sizes, holds none", [mbox("trak", tkhdBox(lie), media([[25, 512]], [mbox("stsz", u8(0, 0, 0, 0), be32(0), be32(375))]))]],
    ["an mdhd hidden in udta", [mbox("trak", tkhdBox(lie), media([[25, 512]])), mbox("udta", mdhdBox(real, 1000))]],
    ["a stts hidden in a sample entry", [mbox("trak", tkhdBox(lie), media([[25, 512]], [mbox("stsd", u8(0, 0, 0, 0), be32(1), mbox("avc1", new Uint8Array(78), sttsBox(fps25(real))))]))]],
    ["two stts in one table", [mbox("trak", tkhdBox(lie), media([[25, 512]], [sttsBox(fps25(real))]))]],
    ["two movie headers", [mvhdBox(real)]]]) {
    assert.deepEqual(await read(file(kids)), unreadable, name);
  }
  // a declared length of a day or more can't be vouched for (a demuxer might play it): unreadable, no longer skipped as junk
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(2 * 86400), media([[25, 512]]))])), unreadable, "a two-day tkhd");
  assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), media([[25, 512]], [stsz(2000000000)]))])), unreadable, "stsz claims two billion samples");
  // outside the moov: a fragment box or a box a demuxer would read timing from (udta, a stray trak)
  for (const [name, top] of [["top-level trex", trex], ["top-level udta holding a moof", mbox("udta", moof)], ["a stray top-level trak", mbox("trak", tkhdBox(real))]]) {
    assert.deepEqual(await read(file([mbox("trak", tkhdBox(lie), media([[25, 512]]))], [top])), unreadable, name);
  }
  // case F: a host that doesn't say how long the file is, and six reads spent on large boxes before a moof —
  // running out of reads is not the end of the file
  const big = (n) => mbox("free", new Uint8Array(n));
  const fileF = cat([ftyp, mbox("moov", mvhdBox(lie), mbox("trak", tkhdBox(lie), media([[25, 512]]))), big(70000), big(70000), big(70000), big(70000), big(70000), big(70000), moof, mbox("mdat", new Uint8Array(1500))]);
  const star = async (_u, init) => { const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); const a = Number(m[1]), b = Math.min(Number(m[2]), fileF.length - 1);
    if (a >= fileF.length) return new Response("", { status: 416 }); return new Response(fileF.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/*` } }); };
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/f.mp4", { fetchImpl: star }), unreadable, "F");
  // …while an honest file on the same kind of host still reads (the end is a read past the end, not a spent budget)
  const honest = mp4Tracks({ mvhd: 6, tracks: [{ handler: "vide", tkhd: 6, mdhd: 6, stts: fps25(6) }] });
  const starH = async (_u, init) => { const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range); const a = Number(m[1]), b = Math.min(Number(m[2]), honest.length - 1);
    if (a >= honest.length) return new Response("", { status: 416 }); return new Response(honest.slice(a, b + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/*` } }); };
  assert.deepEqual(await probeMp4Info("https://v3.fal.media/h.mp4", { fetchImpl: starH }), { seconds: 6, reason: null });
  // the round-3 forged-but-consistent rules still hold: the largest duration the file declares
  assert.equal((await read(forgedMp4(1, 5))).seconds, 5);
  assert.equal((await read(mp4Tracks({ mvhd: 5, tracks: [{ handler: "vide", tkhd: 5, mdhd: 5, stts: fps25(5) }] }))).seconds, 5);
});

await test("C11 (round 4, owner decision) an output LONGER than its length-sized hold covered is charged the hold, logged as length_mismatch and recorded for the owner", async () => {
  const facts = P.lengthBilledVideoHold({ endpoint: "fal-ai/kling-video/v3/pro/motion-control", resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [5], unit: 0.01 }).facts;
  const held = P.creditsFromUsd(0.168 * 6.5, 0.01);
  const logs = [], records = [];
  const run = (seconds, extra = {}) => VR.finishedVideoCharge({ held, facts, videoUrl: "https://v3.fal.media/files/o.mp4", unit: 0.01, ref: "video:abc",
    probe: async () => seconds, log: (m) => logs.push(m), record: async (m) => { records.push(m); }, ...extra });
  let c = await run(5.02);
  assert.equal(c.amount, P.creditsFromUsd(0.168 * 5, 0.01)); assert.equal(c.note.lengthMismatch, undefined); assert.equal(records.length, 0);
  c = await run(6.02);
  assert.equal(c.amount, P.creditsFromUsd(0.168 * 6, 0.01), "a 6 s output fits the 6.5 s hold"); assert.equal(records.length, 0);
  c = await run(9.3);
  assert.equal(c.amount, held, "capped at the hold — never more");
  assert.equal(c.note.lengthMismatch, true); assert.equal(c.note.outputCredits, P.creditsFromUsd(0.168 * 10, 0.01));
  assert.ok(logs.includes(`[billing] length_mismatch video:abc held=${held} output_s=9.3`), j(logs));
  assert.deepEqual(records, [{ ref: "video:abc", held, outputSeconds: 9.3, credits: P.creditsFromUsd(0.168 * 10, 0.01), kind: "motion" }]);
  // a recorder that throws never breaks the settle
  c = await run(9.3, { record: async () => { throw new Error("db down"); } });
  assert.equal(c.amount, held);
  // a maximum hold is never "mismatched" (the settle can't count past the maximum)
  const maxFacts = P.lengthBilledVideoHold({ endpoint: "fal-ai/kling-video/v3/pro/motion-control", resolution: "1080p", kind: "motion", maxOutputSeconds: 30, inputs: [null], unit: 0.01 }).facts;
  records.length = 0;
  c = await VR.finishedVideoCharge({ held: P.creditsFromUsd(0.168 * 30, 0.01), facts: maxFacts, videoUrl: "https://v3.fal.media/files/o.mp4", unit: 0.01, probe: async () => 44, record: async (m) => records.push(m) });
  assert.equal(c.amount, P.creditsFromUsd(0.168 * 30, 0.01)); assert.equal(records.length, 0);
  // the housekeeping reconciliation records it too, with the hold's owner and fal's request id
  const rows = [{ ref: "video:rid-1", owner: "u-owner", provider_ref: "rid-1", held, created_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
    reason: H.videoHoldReason({ appModel: "kling-3.0-motion-control", resolution: "1080p", endpoint: "fal-ai/kling-video/v3/pro/motion-control", facts }) }];
  const settled = {};
  const rpc = async (name, args) => name === "turn_claim_housekeeping" ? { data: true }
    : name === "turn_open_provider_holds" ? { data: rows.filter((r) => !settled[r.ref]) }
    : name === H.SETTLE_RPC ? (settled[args.ref] = args.actual, { data: { ok: true, kept: args.actual, remaining: 1 } }) : { error: { message: "unexpected " + name } };
  const fetchImpl = async (url) => /\/status$/.test(String(url)) ? new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 })
    : new Response(JSON.stringify({ video: { url: "https://v3.fal.media/files/long.mp4" } }), { status: 200 });
  const recs = [], rlogs = [];
  const r = await VR.reconcileVideoHolds({ rpc, falKey: "k", fetchImpl, probe: async () => 12, unitNow: async () => 0.01, log: (m) => rlogs.push(m), record: async (m) => recs.push(m) });
  assert.equal(r.body.settled, 1); assert.equal(settled["video:rid-1"], held);
  assert.deepEqual(recs, [{ ref: "video:rid-1", held, outputSeconds: 12, credits: P.creditsFromUsd(0.168 * 12, 0.01), kind: "motion", owner: "u-owner", requestId: "rid-1" }]);
  assert.ok(rlogs.some((m) => m === `[billing] length_mismatch video:rid-1 held=${held} output_s=12`), j(rlogs));
  // index.ts stores both paths' records in turn_grant_failures (reason length_mismatch), service role only
  const src = read("supabase/functions/image-proxy/index.ts");
  assert.match(src, /from\("turn_grant_failures"\)\.insert\(\{\s*event_id: String\(m\.ref \|\| ""\), event_type: "video\.length_mismatch", reason: "length_mismatch"/);
  assert.match(src, /record: \(m: any\) => recordLengthMismatch\(svc, m\)/, "the reconciliation records");
  // Team review (2026-10-09): filed under the hold's owner (who paid), as the reconciliation does
  assert.match(src, /record: \(m: any\) => recordLengthMismatch\(createClient\(supabaseUrl, Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)!\), \{ \.\.\.m, owner: found\.owner \|\| authUser\.id, requestId: job\.rid, endpoint: model \}\)/, "the poll records");
});

/* ═══════════════════════════ D. PUBLIC ERRORS ═══════════════════════════ */
await test("C12 (round 5, S2) a QuickTime COMPRESSED movie (moov/cmov: dcom zlib + cmvd) — or a moov nested in the moov — is unreadable: the movie a demuxer plays is one the reader can't see", async () => {
  for (const outerTrak of [false, true]) {
    const bytes = cmovMp4(3, 15, { outerTrak });
    assert.deepEqual(await mp4InfoFromBytes(bytes), { seconds: null, reason: "unreadable" }, "outer 3 s, compressed 15 s (outer trak: " + outerTrak + ")");
    assert.equal(moovDurations(moovBody(bytes)).compressed, true);
  }
  // each of the three boxes alone, anywhere in the moov (here inside udta), and a nested moov
  const hide = (inner) => { const ftyp = mbox("ftyp", ascii("qt  "), be32(512), ascii("qt  "));
    return cat([ftyp, mbox("moov", mvhdBox(3), trakBox({ handler: "vide", tkhd: 3, mdhd: 3, stts: fps25(3) }), mbox("udta", inner)), mbox("mdat", new Uint8Array(100))]); };
  for (const inner of [mbox("cmov", new Uint8Array(8)), mbox("dcom", ascii("zlib")), mbox("cmvd", be32(10), new Uint8Array(10)), mbox("moov", mbox("iods", new Uint8Array(16)))])
    assert.deepEqual(await mp4InfoFromBytes(hide(inner)), { seconds: null, reason: "unreadable" }, String.fromCharCode(...inner.subarray(4, 8)));
  assert.deepEqual(await mp4InfoFromBytes(hide(mbox("free", new Uint8Array(8)))), { seconds: 3, reason: null }, "the same file without them reads as before");
  // at the top level too
  for (const t of ["dcom", "cmvd"]) assert.equal((await mp4InfoFromBytes(cat([mbox("ftyp", ascii("isom"), be32(0)), mbox("moov", mvhdBox(3)), mbox(t, new Uint8Array(8))]))).seconds, null, t);
});

await test("C13 (round 5, S3) video snapshots: a server-only key per job, the caller's own signed URL names the object, cleanup by the hold's ref, a bounded two-day sweep", async () => {
  const VS = await import("../supabase/functions/image-proxy/video-snapshots.mjs");
  const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7", t0 = 1790000000000;
  assert.equal(VS.SNAPSHOT_DIR, "_internal/video-snapshots");
  assert.equal(VS.snapshotPath(id, 0, "mp4", t0), `_internal/video-snapshots/${t0}-${id}-0.mp4`);
  assert.equal(VS.snapshotPath(id, 2, "exe", t0), `_internal/video-snapshots/${t0}-${id}-2.mp4`, "only video extensions");
  assert.throws(() => VS.snapshotPath("../x", 0), /hold/);
  assert.equal(VS.isSnapshotPath(VS.snapshotPath(id, 1, "mov", t0)), true);
  for (const bad of [`_internal/video-snapshots/${t0}-${id}-0.mp4/x`, `u1/stage-tmp/${t0}-video-a.mp4`, `_internal/video-snapshots/x.mp4`]) assert.equal(VS.isSnapshotPath(bad), false, bad);
  assert.equal(VS.snapshotHoldId("video:" + id), id); assert.equal(VS.snapshotHoldId("image:" + id), ""); assert.equal(VS.snapshotHoldId("video:nope"), "");
  assert.deepEqual([VS.snapshotExt("video/quicktime"), VS.snapshotExt("a/b/c.MOV"), VS.snapshotExt("video/webm"), VS.snapshotExt("video/mp4"), VS.snapshotExt("")], ["mov", "mov", "webm", "mp4", "mp4"]);
  // the object a signed URL of this project's storage names — only the sign form, this host, this bucket, a plain path
  const scope = { projectHost: "example.supabase.co", bucket: "turn-assets" };
  assert.deepEqual(VS.projectStorageObject("https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/p%201/clip.mp4?token=abc", scope), { bucket: "turn-assets", path: "u1/p 1/clip.mp4" });
  for (const u of ["https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/clip.mp4", "https://example.supabase.co/storage/v1/object/public/turn-assets/u1/clip.mp4?token=a",
    "https://example.supabase.co/storage/v1/object/sign/other/u1/clip.mp4?token=a", "https://evil.example.com/storage/v1/object/sign/turn-assets/u1/clip.mp4?token=a",
    "http://example.supabase.co/storage/v1/object/sign/turn-assets/u1/clip.mp4?token=a", "https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/%2Fetc/clip.mp4?token=a",
    "https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/a%5Cb.mp4?token=a", "https://example.supabase.co/storage/v1/object/sign/turn-assets/_internal/video-snapshots/x.mp4?token=a", "stage:u1/stage-tmp/x.mp4", ""])
    assert.equal(VS.projectStorageObject(u, scope), null, u);
  // dot segments are resolved exactly as the fetch that proves access resolves them (the same object either way)
  assert.deepEqual(VS.projectStorageObject("https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/../u2/clip.mp4?token=a", scope), { bucket: "turn-assets", path: "u2/clip.mp4" });
  assert.equal(new URL("https://example.supabase.co/storage/v1/object/sign/turn-assets/u1/%2e%2e/u2/clip.mp4?token=a").pathname, "/storage/v1/object/sign/turn-assets/u2/clip.mp4");
  // the store over a fake bucket
  const bucket = {}, calls = [];
  const api = { upload: async (p, blob, o) => { calls.push(["upload", p, o]); bucket[p] = new Uint8Array(await blob.arrayBuffer()); return { data: { path: p }, error: null }; },
    copy: async (a, b) => { calls.push(["copy", a, b]); if (!bucket[a]) return { error: { message: "Object not found" } }; bucket[b] = bucket[a]; return { data: {}, error: null }; },
    createSignedUrl: async (p, secs) => ({ data: { signedUrl: `https://x/${p}?t=${secs}` }, error: null }),
    list: async (dir, o = {}) => ({ data: Object.keys(bucket).filter((k) => k.startsWith(dir + "/")).map((k) => ({ name: k.slice(dir.length + 1) })).filter((x) => !o.search || x.name.includes(o.search)).sort((a, b) => (a.name < b.name ? -1 : 1)), error: null }),
    remove: async (ps) => { calls.push(["remove", ps]); for (const k of ps) delete bucket[k]; return { data: [], error: null }; } };
  let clock = t0;
  const store = VS.createVideoSnapshots({ storage: () => api, now: () => clock });
  const a = await store.fromBlob(id, 0, new Blob([u8(1, 2, 3)], { type: "video/mp4" }), "mp4");
  assert.deepEqual(a, { path: `_internal/video-snapshots/${t0}-${id}-0.mp4`, url: `https://x/_internal/video-snapshots/${t0}-${id}-0.mp4?t=86400` }, "a 24-hour signed URL of the copy");
  assert.equal(calls[0][2].upsert, false, "never overwrites");
  bucket["u1/p1/clip.mp4"] = u8(9);
  const b = await store.copy(id, 1, "u1/p1/clip.mp4", "mp4");
  assert.equal(b.path, `_internal/video-snapshots/${t0}-${id}-1.mp4`);
  assert.equal(await store.copy(id, 2, "u1/p1/missing.mp4", "mp4"), null, "a failed copy is null (the video counts as unread)");
  const other = "11111111-2222-4333-8444-555555555555";
  await store.fromBlob(other, 0, new Blob([u8(4)]), "mp4");
  assert.equal(await store.drop("video:" + id), 2, "both copies of the job");
  assert.deepEqual(Object.keys(bucket).filter((k) => k.startsWith("_internal/")), [`_internal/video-snapshots/${t0}-${other}-0.mp4`], "another job's copy stays");
  assert.equal(await store.drop("image:" + other), 0);
  // a Storage that ignores `search` (it is only a hint) still can't make drop() delete another job's copies
  const deaf = VS.createVideoSnapshots({ storage: () => ({ ...api, list: async (dir) => api.list(dir, {}) }), now: () => clock });
  const third = "33333333-2222-4333-8444-555555555555";
  await deaf.fromBlob(third, 0, new Blob([u8(6)]), "mp4");
  assert.equal(await deaf.drop("video:" + third), 1);
  assert.ok(bucket[`_internal/video-snapshots/${t0}-${other}-0.mp4`], "the other job's copy is still there");
  assert.equal(await store.removePaths(["u1/p1/clip.mp4"]), 0, "never removes anything but a snapshot");
  assert.ok(bucket["u1/p1/clip.mp4"]);
  // the sweep: copies older than two days go (at most SNAPSHOT_SWEEP_MAX a run); younger ones stay
  clock = t0 + 2 * 86400000 + 1;
  await store.fromBlob("22222222-2222-4333-8444-555555555555", 0, new Blob([u8(5)]), "mp4");
  assert.equal(await store.sweep(), 1);
  assert.deepEqual(Object.keys(bucket).filter((k) => k.startsWith("_internal/")).length, 1, "the fresh one stays");
  assert.equal(VS.planSnapshotSweep(Array.from({ length: 500 }, (_, i) => ({ name: `${t0}-${id}-${i}.mp4` })), t0 + 3 * 86400000).length, VS.SNAPSHOT_SWEEP_MAX);
  // the reconciliation drops a length-billed hold's copies after it settles or releases, and sweeps once per run
  const dropped = [], swept = [];
  const snapshots = { drop: async (ref) => { dropped.push(ref); return 1; }, sweep: async () => { swept.push(1); return 0; } };
  const rows = [
    { ref: "video:" + id, owner: "u", provider_ref: "req-a", held: 100, reason: 'video:kling-3.0-motion-control:1080p m=fal-ai/kling-video/v3/pro/motion-control s={"v":2,"k":"motion","rate":0.168,"mo":30,"fx":0,"vin":null,"vx":null,"n":1,"mi":0}', created_at: new Date(t0).toISOString() },
    { ref: "video:" + other, owner: "u", provider_ref: "req-b", held: 50, reason: "video:kling-3.0:720p m=fal-ai/kling-video/v3/standard/image-to-video", created_at: new Date(t0).toISOString() },
  ];
  const rpc = async (name) => name === "turn_claim_housekeeping" ? { data: true, error: null } : name === "turn_open_provider_holds" ? { data: rows, error: null }
    : name === "turn_release_hold" ? { data: { ok: true }, error: null } : { data: null, error: null };
  const fetchImpl = async (u) => (/\/status$/.test(u) ? new Response(JSON.stringify({ status: "FAILED" }), { status: 200 }) : new Response("{}", { status: 200 }));
  const out = await VR.reconcileVideoHolds({ rpc, falKey: "k", fetchImpl, snapshots });
  assert.equal(out.body.released, 2);
  assert.deepEqual(dropped, ["video:" + id], "only the length-billed render has copies to drop");
  assert.equal(swept.length, 1, "one sweep a run");
});

section("D errors never leak internals (public-errors.mjs)");

await test("D1 provider accounts, keys, database and host details are replaced; content refusals pass with company names removed", () => {
  for (const bad of [
    "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "API key not valid. Please pass a valid API key.", "Incorrect API key provided: sk-proj-****abcd",
    "new row violates row-level security policy for table \"objects\"", "Could not find the function public.turn_hold_credits(amount, reason, ref, uid) in the schema cache",
    "fetch failed: getaddrinfo ENOTFOUND queue.fal.run", "You exceeded your current quota, please check your plan and billing details.",
    "TypeError: Cannot read properties of undefined (reading 'url')", "request to https://vubenblfdzginlqiglzw.supabase.co failed",
  ]) { assert.equal(publicError(bad), GENERIC_PROVIDER_ERROR, bad); assert.ok(isInternalError(bad), bad); }
  assert.equal(publicError("Your request was rejected by the safety system (likeness of a real person)."), "Your request was rejected by the safety system (likeness of a real person).");
  assert.equal(publicError("Rejected by Google's safety filters"), "Rejected by the provider's safety filters");
  assert.equal(publicError("fal: image_urls: field required"), "the provider: image_urls: field required");
  assert.equal(publicError("", { fallback: "Try again." }), "Try again.");
  assert.equal(publicError("API key not valid", { isAdmin: true }), "API key not valid", "admins see the detail");
});

/* ═══════════════════════ E. FRANCES'S FREE PATH ═══════════════════════ */
section("E Frances: the Opus 5.5 move and prompt caching (muse-billing.mjs)");

await test("E1 (repair F18) the free path accepts claude-opus-5 AND claude-opus-5-5 permanently and always runs claude-opus-5-5; nothing else", () => {
  assert.deepEqual(MUSE_MODEL, { provider: "anthropic", model: "claude-opus-5-5" });
  assert.deepEqual([...MUSE_MODELS], ["claude-opus-5-5", "claude-opus-5"]);
  assert.equal(museRunModel("muse", "claude-opus-5"), "claude-opus-5-5", "an old tab's Opus 5 question runs on Opus 5.5");
  assert.equal(museRunModel("muse", "claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(museRunModel("text", "claude-opus-5"), "claude-opus-5", "metered calls run what they asked for");
  assert.doesNotMatch(read("supabase/functions/image-proxy/muse-billing.mjs"), /Drop "claude-opus-5"|during the move|transition/i, "no removal step left to forget");
  const q = (model, extra = {}) => ({ usageKind: "muse", provider: "anthropic", model, messages: [{ role: "user", content: "How do I export?" }], ...extra });
  assert.deepEqual(textBillingKind(q("claude-opus-5-5")), { kind: "muse", free: true, reason: "" });
  assert.deepEqual(textBillingKind(q("claude-opus-5")), { kind: "muse", free: true, reason: "" });
  for (const m of ["claude-fable-5-1", "claude-opus-5-5-20260101", "gpt-5.5"]) assert.equal(textBillingKind(q(m)).free, false, m);
  assert.equal(museRefusal({ ...q("claude-opus-5-5"), provider: "openai" }), "not MUSE's model");
  // the app's pin: app/ai.jsx MUSE_MODEL must be one the proxy accepts (either side of the move)
  const app = read("app/ai.jsx").match(/const MUSE_MODEL = \{ id:"([^"]+)", provider:"anthropic" \}/);
  assert.ok(app && MUSE_MODELS.includes(app[1]), "app/ai.jsx MUSE_MODEL " + (app && app[1]));
});

await test("E2 prompt caching: ONE leading system message (the stable guide) is allowed only when the request asks for caching", () => {
  const guide = { role: "system", content: "PRODUCT GUIDE ".repeat(500) };
  const base = { usageKind: "muse", provider: "anthropic", model: "claude-opus-5-5" };
  assert.equal(textBillingKind({ ...base, promptCache: true, messages: [guide, { role: "user", content: "q" }] }).free, true);
  assert.equal(textBillingKind({ ...base, messages: [guide, { role: "user", content: "q" }] }).reason, "not a chat turn", "no promptCache: a system message is not a chat");
  assert.equal(textBillingKind({ ...base, promptCache: true, messages: [guide] }).reason, "no question");
  assert.equal(textBillingKind({ ...base, promptCache: true, messages: [{ role: "user", content: "q" }, guide] }).reason, "not a chat turn", "only as the prefix");
  assert.equal(textBillingKind({ ...base, promptCache: true, messages: [guide, guide, { role: "user", content: "q" }] }).reason, "not a chat turn", "only one");
  assert.equal(textBillingKind({ ...base, promptCache: true, messages: [{ role: "system", content: "x".repeat(MUSE_LIMITS.maxInputChars) }, { role: "user", content: "q" }] }).reason, "over MUSE's input size", "the guide counts toward the size limit");
});

/* ═══════════════════════════════ F. THE PROXY ═══════════════════════════════ */
section("F the proxy: real index.ts against the real billing SQL");
await proxySection();

/* ═══════════════════════════════ G. BLENDER ═══════════════════════════════ */
section("G Blender Studio (blender-bridge)");
await blenderSection();

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}  (by section: ${Object.entries(counts).map(([k, v]) => k + " " + v).join(", ")})`);
process.exit(failed ? 1 : 0);

/* ═════════════════════════════ the proxy harness ═════════════════════════════ */
async function proxySection() {
  if (typeof nodeModule.registerHooks !== "function") { skipped++; console.log("SKIP F: this Node has no module.registerHooks"); return; }
  let PGlite, pgcrypto;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
    ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
  } catch (_e) { skipped++; console.log("SKIP F: @electric-sql/pglite is not installed"); return; }
  const STUB = read("scripts/test-series-production-sql.mjs").match(/^const SUPABASE_STUB = `([\s\S]*?)^`;/m)?.[1];
  if (!STUB) throw new Error("the Supabase stub moved");
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(read("supabase/credits.sql"));
  await db.exec(read("supabase/frances-daily-limit.sql"));
  // THE F1 CONTRACT (repair, 2026-09-30): billing-v2.sql (= the credits.sql block) owns
  // turn_credit_holds.provider_ref, turn_hold_attach and turn_hold_lookup. A minimal stand-in is
  // installed ONLY when that SQL doesn't have them yet, so these proxy tests pin the contract the
  // proxy codes against either way.
  await db.exec(`do $shim$ begin
    if to_regprocedure('public.turn_hold_attach(text,text)') is null then
      alter table public.turn_credit_holds add column if not exists provider_ref text;
      create unique index if not exists turn_credit_holds_provider_ref_uidx on public.turn_credit_holds(provider_ref) where provider_ref is not null;
      execute $f$ create function public.turn_hold_attach(ref text, provider_ref text) returns jsonb language plpgsql security definer set search_path = '' as $b$
        declare v public.turn_credit_holds;
        begin
          select * into v from public.turn_credit_holds h where h.ref = turn_hold_attach.ref for update;
          if not found then return jsonb_build_object('ok', false, 'code', 'unknown'); end if;
          if v.provider_ref is not null then return jsonb_build_object('ok', v.provider_ref = turn_hold_attach.provider_ref) || case when v.provider_ref = turn_hold_attach.provider_ref then '{}'::jsonb else '{"code":"mismatch"}'::jsonb end; end if;
          update public.turn_credit_holds h set provider_ref = turn_hold_attach.provider_ref where h.ref = turn_hold_attach.ref;
          return jsonb_build_object('ok', true);
        exception when unique_violation then return jsonb_build_object('ok', false, 'code', 'mismatch');
        end $b$ $f$;
      execute $f$ create function public.turn_hold_lookup(provider_ref text) returns jsonb language plpgsql security definer set search_path = '' as $b$
        declare v public.turn_credit_holds;
        begin
          select * into v from public.turn_credit_holds h where h.provider_ref = turn_hold_lookup.provider_ref;
          if not found then return jsonb_build_object('found', false); end if;
          return jsonb_build_object('found', true, 'ref', v.ref, 'owner', v.owner, 'held', v.held, 'status', v.status, 'kept', v.kept, 'created_at', v.created_at, 'reason', v.reason);
        end $b$ $f$;
      execute 'grant execute on function public.turn_hold_attach(text,text), public.turn_hold_lookup(text) to service_role';
    end if;
  end $shim$;`);
  // THE ROUND-2 CONTRACT (billing-v2.sql = the credits.sql block): turn_claim_housekeeping and
  // turn_open_provider_holds. Stand-ins are installed ONLY when that SQL doesn't have them yet, so
  // the reconciliation tests pin the contract the proxy codes against either way.
  await db.exec(`do $shim2$ begin
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'turn_claim_housekeeping') then
      execute $f$ create function public.turn_claim_housekeeping(job text, every_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $b$
        declare v_key text := 'housekeeping:' || job;
        begin
          insert into public.turn_billing_state(key, value, at) values (v_key, '{}'::jsonb, now()) on conflict (key) do nothing;
          if found then return true; end if;
          update public.turn_billing_state s set at = now() where s.key = v_key and s.at < now() - make_interval(secs => greatest(1, every_seconds));
          return found;
        end $b$ $f$;
      execute 'grant execute on function public.turn_claim_housekeeping(text,integer) to service_role';
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'turn_open_provider_holds') then
      execute $f$ create function public.turn_open_provider_holds(older_than_minutes integer default 60, max_rows integer default 50, ref_prefix text default null)
        returns table(ref text, owner uuid, provider_ref text, held integer, reason text, created_at timestamptz)
        language sql stable security definer set search_path = '' as $b$
          select h.ref, h.owner, h.provider_ref, h.held, h.reason, h.created_at from public.turn_credit_holds h
           where h.status = 'held' and h.provider_ref is not null
             and h.created_at < now() - make_interval(mins => greatest(0, coalesce(older_than_minutes, 60)))
             and (nullif(ref_prefix, '') is null or left(h.ref, length(ref_prefix)) = ref_prefix)
           order by h.created_at limit least(500, greatest(1, coalesce(max_rows, 50))) $b$ $f$;
      execute 'grant execute on function public.turn_open_provider_holds(integer,integer,text) to service_role';
    end if;
  end $shim2$;`);
  const mk = (n, email, extra = {}) => ({ id: "20000000-0000-0000-0000-0000000000" + n, email, ...extra });
  const U = {
    writer: mk("01", "writer@example.com"), director: mk("02", "director@example.com"), producer: mk("03", "producer@example.com"),
    none: mk("04", "packs-only@example.com"), frozen: mk("05", "frozen@example.com"), poor: mk("06", "poor@example.com"),
    admin: mk("07", "admin@infinitestudioai.com"), trial: mk("08", "brand.new@example.com"), other: mk("09", "other@example.com"),
    fresh: mk("10", "fresh@example.com"),
  };
  for (const u of Object.values(U)) await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)", [u.id, u.email, new Date(Date.now() - 86400000)]);
  const as = async (who, sql, params = []) => {
    try {
      const rows = await db.transaction(async (tx) => {
        if (who !== "editor") {
          const claims = who === "service" ? { role: "service_role" } : { sub: who.id, email: who.email, role: "authenticated" };
          await tx.query("select set_config('request.jwt.claims', $1, true)", [j(claims)]);
          await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
        }
        return (await tx.query(sql, params)).rows;
      });
      return { ok: true, rows };
    } catch (e) { return { ok: false, error: e.message, code: e.code }; }
  };
  const svc = async (sql, params) => { const r = await as("service", sql, params); if (!r.ok) throw new Error(sql + ": " + r.error); return r.rows[0] && Object.values(r.rows[0])[0]; };
  // seed: plans in TODAY's unit (before the switch), a pack-only account, a frozen writer, a poor writer
  const future = new Date(Date.now() + 20 * 86400000).toISOString();
  await svc("select public.turn_set_plan_once($1, $2, 'writer', 800, 'sub_w', 'cus_w', $3)", ["evt-w", U.writer.id, future]);
  await svc("select public.turn_set_plan_once($1, $2, 'director', 2400, 'sub_d', 'cus_d', $3)", ["evt-d", U.director.id, future]);
  await svc("select public.turn_set_plan_once($1, $2, 'studio', 9000, 'sub_p', 'cus_p', $3)", ["evt-p", U.producer.id, future]);
  await svc("select public.turn_set_plan_once($1, $2, 'writer', 800, 'sub_f', 'cus_f', $3)", ["evt-f", U.frozen.id, future]);
  await svc("select public.turn_set_frozen($1, true, 'dispute du_1')", [U.frozen.id]);
  await svc("select public.turn_set_plan_once($1, $2, 'writer', 5, 'sub_l', 'cus_l', $3)", ["evt-l", U.poor.id, future]);
  await svc("select public.turn_add_pack_once($1, $2, 300, 'ch_n')", ["evt-n", U.none.id]);

  const TABLE_FNS = new Set(["turn_credit_balance", "turn_record_usage_event", "turn_credit_regime", "turn_spend_credit", "turn_open_provider_holds"]);
  const W = { rpcs: [], calls: [], events: [], fal: {}, falSeq: 0, providers: {}, failServiceRpc: null, freeCallsToday: 0, mp4: {}, grantFailures: [], stored: {}, failCopy: false, removed: [] };
  const callFn = async (who, name, args) => {
    if (!/^[a-z_]+$/.test(name)) throw new Error("bad rpc name " + name);
    const keys = Object.keys(args || {});
    const params = keys.map((k) => { const v = args[k]; return v != null && typeof v === "object" ? j(v) : v; });
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    const r = await as(who, TABLE_FNS.has(name) ? `select * from ${call}` : `select ${call} as r`, params);
    if (!r.ok) return { data: null, error: { message: r.error, code: r.code } };
    return { data: TABLE_FNS.has(name) ? r.rows : r.rows[0].r, error: null };
  };
  const tokens = Object.fromEntries(Object.entries(U).map(([k, u]) => ["tok-" + k, u]));
  const ENV = {
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",   // ≥ 16 characters: blender-bridge derives its relay key from it (F27)
    FAL_KEY: "fal-key", ANTHROPIC_API_KEY: "anthropic-key", OPENAI_API_KEY: "openai-key", GOOGLE_API_KEY: "google-key",
    ELEVENLABS_API_KEY: "el-key", MOONSHOT_API_KEY: "moonshot-key", VIDEO_HOLD_SECRET: "video-hold-secret",
  };
  globalThis.__chargingTestCreateClient = (url, key, opts) => {
    if (!key) throw new Error("supabaseKey is required.");
    if (key === ENV.SUPABASE_SERVICE_ROLE_KEY) return {
      rpc: async (name, args) => { W.rpcs.push(["service", name, args]); W.events.push("rpc:" + name); if (W.failServiceRpc && W.failServiceRpc(name)) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } }; return callFn("service", name, args); },
      // round 4: the storage the proxy stages data URLs into and signs `stage:` uploads from (the
      // signed URL of a stored MP4 serves its bytes with HTTP Range, through W.mp4)
      storage: { from: (bucket) => ({
        upload: async (path, blob) => { W.stored[path] = { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "" }; W.events.push("storage:upload"); return { data: { path }, error: null }; },
        createSignedUrl: async (path, secs) => {
          const url = `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t${secs}`;
          if (W.stored[path]) W.mp4[url] = W.stored[path].bytes;
          return { data: { signedUrl: url }, error: null };
        },
        list: async (dir, opts = {}) => ({ data: Object.entries(W.stored).filter(([p]) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
          .map(([p, st]) => ({ name: p.slice(dir.length + 1), metadata: { size: st.bytes.length, mimetype: st.type } }))
          .filter((o) => !opts.search || o.name.includes(opts.search))
          .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)), error: null }),
        remove: async (paths) => { W.removed.push(...paths); for (const p of paths) delete W.stored[p]; return { data: null, error: null }; },
        // round 5 (S3): the service-role copy the video snapshots are made with (W.failCopy injects a failure)
        copy: async (from, to) => {
          W.events.push("storage:copy");
          if (W.failCopy) return { data: null, error: { message: "copy refused (injected)" } };
          if (!W.stored[from]) return { data: null, error: { message: "Object not found" } };
          if (W.stored[to]) return { data: null, error: { message: "The resource already exists" } };
          W.stored[to] = { bytes: new Uint8Array(W.stored[from].bytes), type: W.stored[from].type };
          return { data: { path: to }, error: null };
        },
      }) },
      // round 2: the drain-window marker read (turn_billing_state, service role); round 4: the owner's
      // length_mismatch records (turn_grant_failures)
      from: (table) => {
        const f = { col: null, val: null };
        // Team review (2026-10-09): who paid for a hold (image-proxy's poll, blender-bridge's re-hold) —
        // the hold's row by ref; this database has no Team columns, so actor / member_id read as null
        const rows = async () => {
          if (table === "turn_credit_holds" && f.col === "ref") {
            const r = (await db.query("select * from public.turn_credit_holds where ref = $1", [f.val])).rows;
            return { data: r.map((h) => ({ owner: h.owner, actor: h.actor ?? null, member_id: h.member_id ?? null, project_id: h.project_id ?? null })), error: null };
          }
          return { data: null, error: { message: "unexpected read of " + table } };
        };
        const c = { select: () => c, eq: (col, val) => { f.col = col; f.val = val; return c; }, limit: () => c, then: (ok, bad) => rows().then(ok, bad),
          insert: async (row) => { W.events.push("insert:" + table); if (table !== "turn_grant_failures") return { error: { message: "unexpected insert into " + table } }; W.grantFailures.push(row); return { error: null }; },
          maybeSingle: async () => {
            W.events.push("from:" + table);
            if (W.failMarkerRead) return { data: null, error: { message: "permission denied (injected)" } };
            if (table !== "turn_billing_state" || f.col !== "key") return { data: null, error: { message: "unexpected read of " + table } };
            const rows = (await db.query("select key, at from public.turn_billing_state where key = $1", [f.val])).rows;
            return { data: rows[0] ? { at: rows[0].at instanceof Date ? rows[0].at.toISOString() : rows[0].at } : null, error: null };
          } };
        return c;
      },
    };
    const bearer = String(opts?.global?.headers?.Authorization || "").replace(/^Bearer /, "");
    const who = tokens[bearer];
    const chain = (table) => {
      const c = { select: () => c, eq: () => c, gte: () => c, limit: () => c, order: () => c,
        maybeSingle: async () => resolve(), then: (ok, bad) => resolve().then(ok, bad) };
      const resolve = async () => {
        if (table === "turn_app_config") return { data: W.pricingOverrides ? { value: W.pricingOverrides } : null, error: null };
        if (table === "turn_usage_events") return { count: W.freeCallsToday, error: null };
        if (table === "turn_credits") return { data: (await db.query("select plan, remaining from public.turn_credits where owner = $1", [who.id])).rows, error: null };
        return { data: [], error: null };
      };
      return c;
    };
    return {
      auth: { getUser: async (tok) => tokens[tok] ? { data: { user: { id: tokens[tok].id, email: tokens[tok].email } }, error: null } : { data: { user: null }, error: { message: "invalid token" } } },
      rpc: async (name, args) => { W.rpcs.push(["user", name, args]); if (W.failUserRpc && W.failUserRpc(name)) return { data: null, error: { message: "connection reset" } }; return who ? callFn(who, name, args) : { data: null, error: { message: "no user" } }; },
      from: (t) => chain(t),
    };
  };
  nodeModule.registerHooks({
    resolve(spec, ctx, next) {
      if (spec === "https://esm.sh/@supabase/supabase-js@2")
        return { url: "data:text/javascript,export const createClient = (...a) => globalThis.__chargingTestCreateClient(...a);", shortCircuit: true };
      return next(spec, ctx);
    },
  });
  const reply = (status, body, headers = {}) => new Response(typeof body === "string" ? body : j(body), { status, headers: { "content-type": "application/json", ...headers } });
  const falResult = (endpoint, job) => /seedance|kling|sora/.test(endpoint)
    ? { video: { url: (job && job.videoUrl) || "https://v3.fal.media/files/v.mp4", content_type: "video/mp4" }, seed: 7 }
    : /elevenlabs\/tts/.test(endpoint) ? { audio: { url: "https://v3.fal.media/files/a.mp3" }, timestamps: [] }
    : { images: [{ url: "https://v3.fal.media/files/i.png", content_type: "image/png" }] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = String(init.method || "GET").toUpperCase();
    let body = init.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_e) { /* keep */ } }
    W.calls.push({ url: u, method, body, signal: init.signal, headers: init.headers || {} }); W.events.push("fetch:" + u);
    const custom = W.providers[Object.keys(W.providers).find((k) => u.startsWith(k)) || ""];
    if (custom) { const r = await custom(u, method, body); if (r) return r; }
    // synthetic MP4 files (W.mp4[url] = bytes), served with HTTP Range like a CDN; round 5: a signed URL of
    // the project's storage serves the object's CURRENT bytes (W.stored — an account may overwrite its own
    // file), unless its token is "bad"
    const signedObject = /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/sign\/turn-assets\/([^?]+)\?token=(.+)$/.exec(u);
    const liveObject = signedObject && signedObject[2] !== "bad" && !u.includes("/_internal/") ? W.stored[decodeURIComponent(signedObject[1])] : null;
    if (W.mp4[u] || liveObject) {
      const bytes = liveObject ? liveObject.bytes : W.mp4[u];
      const rh = String((init.headers || {}).Range || (init.headers || {}).range || "");
      const m = /^bytes=(\d+)-(\d+)$/.exec(rh);
      if (!m) return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.length) } });
      const a = Number(m[1]), b = Math.min(Number(m[2]), bytes.length - 1);
      if (a >= bytes.length) return new Response("", { status: 416 });
      return new Response(bytes.slice(a, b + 1), { status: 206, headers: { "content-type": "video/mp4", "content-range": `bytes ${a}-${b}/${bytes.length}` } });
    }
    if (u === "https://api.anthropic.com/v1/messages") return reply(200, { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 30000, output_tokens: 8000 }, stop_reason: "end_turn" });
    if (u === "https://api.moonshot.ai/v1/chat/completions") return reply(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 1000 } });
    if (u === "https://api.openai.com/v1/chat/completions") return reply(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 8000, completion_tokens: 2000 } });
    if (u === "https://api.openai.com/v1/live/sessions") return reply(201, { transport: { type: "webrtc", sdp: "v=0\r\nanswer\r\n" } });
    if (u.startsWith("https://generativelanguage.googleapis.com/")) {
      if (body?.generationConfig?.responseModalities) return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] } }] });
      return reply(200, { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 } });
    }
    const fq = /^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/?]+)(\/status|\/cancel)?(?:\?.*)?$/.exec(u);
    if (fq) {
      const job = W.fal[fq[2]];
      if (!job) return reply(404, { detail: "Request not found" });
      if (fq[3] === "/cancel") {
        job.cancelAsked = (job.cancelAsked || 0) + 1;
        if (method !== "PUT" || job.status !== "IN_QUEUE") return reply(400, { status: "ALREADY_COMPLETED" });
        job.cancelled = true; return reply(202, { status: "CANCELLATION_REQUESTED" });
      }
      if (fq[3] === "/status") return reply(200, { status: job.status, ...(job.status === "FAILED" ? { error: job.error || "The input was rejected: likeness of a real person." } : {}), logs: [] });
      if (job.result) return job.result();
      return reply(200, falResult(job.endpoint, job));
    }
    if (u.startsWith("https://queue.fal.run/") && method === "POST") {
      const endpoint = u.slice("https://queue.fal.run/".length);
      // round 2: fal's real request ids are lowercase dashed UUIDs (W.falIdStyle = "uuid")
      const id = W.falIdStyle === "uuid" ? `7c9e6679-7425-40de-944b-${String(++W.falSeq).padStart(12, "0")}` : "req-" + (++W.falSeq);
      W.fal[id] = { endpoint, input: body, status: W.falNextStatus || "COMPLETED" };
      return reply(200, { request_id: id, status: "IN_QUEUE", status_url: `https://queue.fal.run/${endpoint}/requests/${id}/status`, response_url: `https://queue.fal.run/${endpoint}/requests/${id}` });
    }
    if (u.startsWith("https://v3.fal.media/")) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": u.endsWith(".mp4") ? "video/mp4" : u.endsWith(".mp3") ? "audio/mpeg" : "image/png" } });
    if (u.startsWith("https://api.elevenlabs.io/v1/")) {
      if (/\/text-to-speech\//.test(u)) return reply(200, { audio_base64: "SUQz", alignment: { character_end_times_seconds: [0.4, 1.25] } });
      if (/\/speech-to-text$/.test(u)) return reply(200, { text: "a lighthouse keeper" });
      if (/\/text-to-voice\/design$/.test(u)) return reply(200, { previews: [{ generated_voice_id: "gen-1", audio_base_64: "SUQz" }], text: "hello" });
      if (/\/text-to-voice$/.test(u)) return reply(200, { voice_id: "voice-9" });
      if (/\/voices$/.test(u)) return reply(200, { voices: [{ voice_id: "v1", name: "Stock" }] });
      if (/\/voices\/add$/.test(u)) return reply(200, { voice_id: "clone-1" });
    }
    throw new Error("network disabled in this test: " + u);
  };
  const warns = [];
  const realWarn = console.warn, realEmit = process.emitWarning;
  console.warn = (...a) => { warns.push(a.join(" ")); };
  process.emitWarning = () => {};
  let handler = null;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => ENV[k] } };
  const indexUrl = pathToFileURL(ROOT + "supabase/functions/image-proxy/index.ts").href;
  const load = async (tag) => { handler = null; await import(indexUrl + "?instance=" + tag); return handler; };
  let post;
  try {
    const first = await load("before-switch");
    process.emitWarning = realEmit;
    post = async (tok, body, h = first) => {
      const res = await h(new Request("https://example.supabase.co/functions/v1/image-proxy", {
        method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: j(body) }));
      return { status: res.status, json: await res.json() };
    };
    const bal = async (who) => {
      const [r] = (await db.query("select remaining, plan_remaining, plan from public.turn_credits where owner = $1", [who.id])).rows;
      return r ? Number(r.remaining) : null;
    };
    const holdsOf = async (who) => (await db.query("select ref, held, kept, released, status, reason from public.turn_credit_holds where owner = $1 order by created_at, ref", [who.id])).rows
      .map((h) => ({ ...h, held: Number(h.held), kept: h.kept == null ? null : Number(h.kept), released: h.released == null ? null : Number(h.released) }));
    const lastHold = async (who) => { const h = await holdsOf(who); return h[h.length - 1]; };
    const providerCalls = (prefix) => W.calls.filter((c) => c.url.startsWith(prefix));
    const reset = () => { W.calls = []; W.rpcs = []; W.events = []; W.providers = {}; W.falNextStatus = null; W.failServiceRpc = null; W.failUserRpc = null; W.pricingOverrides = null; W.freeCallsToday = 0; W.mp4 = {}; W.falIdStyle = null; W.failMarkerRead = false; W.grantFailures = []; W.stored = {}; W.failCopy = false; W.removed = []; };
    // round 2: the housekeeping op, called like pg_net does — NO Authorization header
    const postNoAuth = async (body, h = first) => {
      const res = await h(new Request("https://example.supabase.co/functions/v1/image-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: j(body) }));
      return { status: res.status, json: await res.json() };
    };
    const unthrottle = () => db.query("update public.turn_billing_state set at = now() - interval '1 hour' where key like '%reconcile%'");
    const backdate = (rid, interval = "2 hours") => db.query(`update public.turn_credit_holds set created_at = now() - interval '${interval}' where provider_ref = $1`, [rid]);
    const TEXT = (model, provider = "anthropic", extra = {}) => ({ task: "text", usageKind: "writing", provider, model, messages: [{ role: "user", content: "Write scene 4." }], ...extra });
    const MUSE = (model = "claude-opus-5-5", extra = {}) => ({ task: "text", usageKind: "muse", provider: "anthropic", model, messages: [{ role: "user", content: "How do I export my screenplay?" }], ...extra });
    const IMAGE = (model, imageSize = "2K", provider = "fal", extra = {}) => ({ task: "image", provider, model, prompt: "a lighthouse at dusk", aspect: "16:9", imageSize, ...extra });
    const KLING = (extra = {}) => ({ task: "video", op: "submit", model: "fal-ai/kling-video/v3/standard/image-to-video", prompt: "waves", image_urls: ["https://cdn.example.com/f.png"], duration: 5, ...extra });
    const franceRpcs = () => W.rpcs.filter((r) => r[1] === "turn_frances_consume").map((r) => r[2].p_limit);

    await test("F1 TEXT: the hold covers input + the whole output cap before the call; the actual cost is settled; the rest comes back", async () => {
      reset();
      const before = await bal(U.writer);
      const r = await post("tok-writer", TEXT("claude-opus-5-5"));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.text, "ok");
      const call = providerCalls("https://api.anthropic.com/")[0].body;
      assert.equal(call.max_tokens, 16000, "a metered Claude call keeps its 16k thinking room — the held cap");
      const h = await lastHold(U.writer);
      const est = P.textHoldEstimate({ model: "claude-opus-5-5", messages: TEXT("x").messages, outputCap: 16000, unit: 0.03 });
      // the actual: 30,000 in / 8,000 out on Opus 5.5 = $0.28 → 10 credits at $0.03
      assert.deepEqual([h.held, h.kept, h.released, h.status, h.reason], [est.credits, 10, est.credits - 10, "settled", "text:claude-opus-5-5"]);
      assert.equal(await bal(U.writer), before - 10);
      assert.equal(r.json.usage.credits, 10); assert.ok(near(r.json.usage.providerCostUsd, 0.28));
      assert.ok(W.events.indexOf("rpc:turn_hold_credits") >= 0 && W.events.indexOf("rpc:turn_hold_credits") < W.events.indexOf("fetch:https://api.anthropic.com/v1/messages"), "held BEFORE the provider call: " + W.events.join(" "));
      assert.ok(W.events.indexOf("rpc:turn_settle_hold") > W.events.indexOf("fetch:https://api.anthropic.com/v1/messages"), "settled after it");
      const usage = W.rpcs.find((x) => x[1] === "turn_record_usage_event")[2];
      assert.equal(usage.credit_cost, 0, "the ledger row charges nothing: the hold did");
      assert.equal(usage.usage_metadata.credits_charged, 10); assert.equal(usage.usage_metadata.credits_held, est.credits);
    });

    await test("F2 TEXT: a provider failure releases the hold in full and says nothing internal", async () => {
      reset();
      W.providers["https://api.anthropic.com/"] = () => reply(400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing." } });
      const before = await bal(U.writer);
      const r = await post("tok-writer", TEXT("claude-opus-5-5"));
      assert.equal(r.status, 200); assert.doesNotMatch(r.json.error, /credit balance|Anthropic|Billing/i); assert.match(r.json.error, /couldn't complete|returned an error/);
      const h = await lastHold(U.writer);
      assert.deepEqual([h.status, h.kept, h.released], ["released", 0, h.held]);
      assert.equal(await bal(U.writer), before);
      assert.ok(warns.some((w) => /credit balance is too low/.test(w)), "the detail is logged server-side");
      // unreachable provider: released too
      reset(); W.providers["https://api.anthropic.com/"] = () => { throw new TypeError("fetch failed"); };
      const r2 = await post("tok-writer", TEXT("claude-opus-5-5"));
      assert.equal(r2.status, 502); assert.equal(r2.json.error, "Couldn't reach the writing engine. Please try again.");
      assert.equal((await lastHold(U.writer)).status, "released"); assert.equal(await bal(U.writer), before);
    });

    await test("F3 TEXT prices: GPT-5.5 (dated id) at $5/$30, Gemini thinking tokens counted, an unknown engine refused", async () => {
      reset();
      let r = await post("tok-director", TEXT("gpt-5.5-2026-04-23", "openai"));
      assert.equal(r.status, 200, j(r.json));
      assert.equal(r.json.usage.credits, 4, "8k/2k on GPT-5.5 = $0.10 → 4 credits at $0.03 (it was charged 1)");
      assert.ok(providerCalls("https://api.openai.com/v1/chat")[0].body.max_completion_tokens > 0, "OpenAI always gets a cap now (the hold covers it)");
      reset();
      r = await post("tok-director", TEXT("gemini-3.5-flash", "google"));
      assert.ok(near(r.json.usage.providerCostUsd, (1000 * 1.5 + 1000 * 9) / 1e6), "100 candidate + 900 thinking tokens billed as output: " + r.json.usage.providerCostUsd);
      assert.equal(r.json.usage.outputTokens, 1000);
      assert.ok(providerCalls("https://generativelanguage")[0].body.generationConfig.maxOutputTokens > 0);
      reset();
      r = await post("tok-director", TEXT("gemini-9-ultra", "google"));
      assert.equal(r.status, 400); assert.equal(r.json.code, "model_not_allowed"); assert.equal(providerCalls("https://generativelanguage").length, 0);
    });

    await test("F4 TEXT: a small balance gets a shorter cap it can pay for; below Claude's 16k room it is refused with the credits it needs", async () => {
      reset();
      W.providers["https://api.openai.com/v1/chat"] = () => reply(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      const r = await post("tok-poor", TEXT("gpt-6-astra", "openai"));
      assert.equal(r.status, 200, j(r.json));
      const cap = providerCalls("https://api.openai.com/v1/chat")[0].body.max_completion_tokens;
      assert.ok(cap >= 1024 && cap < 16000, "shrunk cap " + cap);
      assert.ok((await lastHold(U.poor)).held <= 5);
      reset();
      const r2 = await post("tok-poor", TEXT("claude-opus-5-5"));
      assert.equal(r2.status, 402); assert.equal(r2.json.code, "insufficient_credits");
      assert.match(r2.json.message, /^This writing engine needs at least \d+ credits for one answer, but this account has [1-9]\d* \(\d+ short\)\. Choose a lighter writing engine, or add credits\.$/, "the 16k room is what it can't cover (repair F20 copy)");
      assert.ok(r2.json.creditsRequired > r2.json.creditsRemaining);
      assert.equal(providerCalls("https://api.anthropic.com/").length, 0, "no provider call");
    });

    await test("F5 TRIAL / no plan (here: pack credits only): default engines only — premium and formerly mispriced engines refused before any call", async () => {
      reset();
      // a new account with nothing (before the switch there is no trial): the "choose a plan" refusal, no call
      const fresh = await post("tok-fresh", TEXT("claude-opus-5-5"));
      assert.equal(fresh.status, 402); assert.equal(fresh.json.code, "no_plan"); assert.equal(W.calls.length, 0);
      assert.equal((await post("tok-none", TEXT("claude-opus-5-5"))).status, 200);
      assert.equal((await post("tok-none", TEXT("kimi-k2.7-code", "moonshot"))).status, 200);
      for (const [m, p] of [["claude-fable-5-1", "anthropic"], ["gpt-5.5-2026-04-23", "openai"], ["gemini-3.5-flash", "google"], ["gpt-6-astra", "openai"], ["kimi-k3", "moonshot"]]) {
        W.calls = [];
        const r = await post("tok-none", TEXT(m, p));
        assert.equal(r.status, 402, m); assert.equal(r.json.code, "plan_required", m); assert.equal(r.json.error, "plan_required");
        assert.equal(W.calls.length, 0, m + ": no provider call");
      }
    });

    await test("F6 IMAGES: held before the render, settled on delivery; a failed render is released; renders sent together can't share one balance", async () => {
      reset();
      let before = await bal(U.director);
      let r = await post("tok-director", IMAGE("gemini-3.1-flash-image", "2K"));
      assert.equal(r.status, 200, j(r.json)); assert.ok(r.json.b64);
      let h = await lastHold(U.director);
      assert.deepEqual([h.held, h.kept, h.status], [4, 4, "settled"], "Nano Banana 2 at 2K: $0.12 → 4 credits at $0.03");
      assert.equal(await bal(U.director), before - 4); assert.equal(r.json.usage.credits, 4);
      // a failed render: released
      reset(); W.falNextStatus = "FAILED"; before = await bal(U.director);
      r = await post("tok-director", IMAGE("gemini-3-pro-image", "4K"));
      assert.match(r.json.error, /likeness/); h = await lastHold(U.director);
      assert.deepEqual([h.held, h.status], [10, "released"], "NB Pro 4K: $0.30 → 10 credits, given back"); assert.equal(await bal(U.director), before);
      // fal's account trouble never reaches the user
      reset(); W.providers["https://queue.fal.run/fal-ai/nano-banana-2"] = (u, m) => (m === "POST" ? reply(403, { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." }) : null);
      r = await post("tok-director", IMAGE("gemini-3.1-flash-image", "1K"));
      assert.doesNotMatch(r.json.error, /locked|balance|fal/i); assert.equal((await lastHold(U.director)).status, "released");
      // two renders at once with credits for one: the second hold is refused
      reset();
      await svc("select public.turn_set_plan_once($1, $2, 'director', 12, 'sub_o', 'cus_o', $3)", ["evt-o", U.other.id, future]);
      let release;
      const gate = new Promise((ok) => { release = ok; });
      W.providers["https://queue.fal.run/fal-ai/nano-banana-pro/requests/"] = async (u) => { if (u.endsWith("/status")) { await gate; } return null; };
      const [a, b] = [post("tok-other", IMAGE("gemini-3-pro-image", "4K")), post("tok-other", IMAGE("gemini-3-pro-image", "4K"))];
      await new Promise((ok) => setTimeout(ok, 300)); release();
      const rs = await Promise.all([a, b]);
      assert.deepEqual(rs.map((x) => x.status).sort(), [200, 402], j(rs.map((x) => x.json.code || "ok")));
      assert.equal(rs.find((x) => x.status === 402).json.code, "insufficient_credits");
      assert.equal(await bal(U.other), 2, "only one render charged (12 - 10)");
    });

    await test("F7 IMAGE gates: trial → draft engine at 1K only; Writer up to 2K; the Google route refuses unknown models before any call", async () => {
      reset();
      let r = await post("tok-none", IMAGE("gemini-nano-banana-2.1", "1K"));
      assert.equal(r.status, 200, j(r.json)); assert.equal((await lastHold(U.none)).held, 2, "Nano Banana 2.1 1K $0.05 → 2 credits at $0.03");
      // an older app's Lite pick: served (and priced) as Nano Banana 2.1 on its google/ route
      W.calls = [];
      r = await post("tok-none", IMAGE("gemini-3.1-flash-lite-image", "1K"));
      assert.equal(r.status, 200, j(r.json)); assert.equal((await lastHold(U.none)).held, 2);
      assert.ok(W.calls.some((c) => c.method === "POST" && c.url === "https://queue.fal.run/google/nano-banana-2.1"), j(W.calls.map((c) => c.url)));
      // with reference images Nano Banana 2.1 goes to its /edit route, at the real resolution asked for
      W.calls = [];
      r = await post("tok-director", IMAGE("gemini-nano-banana-2.1", "2K", "fal", { images: ["https://v3.fal.media/files/ref-a.png", "https://v3.fal.media/files/ref-b.png"] }));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.falModel, "google/nano-banana-2.1/edit");
      const editJob = Object.values(W.fal).find((x) => x.endpoint === "google/nano-banana-2.1/edit");
      assert.ok(editJob, j(Object.values(W.fal).map((x) => x.endpoint)));
      assert.deepEqual([editJob.input.image_urls, editJob.input.resolution], [["https://v3.fal.media/files/ref-a.png", "https://v3.fal.media/files/ref-b.png"], "2K"]);
      assert.equal((await lastHold(U.director)).held, P.creditsFromUsd(0.07, 0.03), "2K $0.07, no extra per reference");
      // Nano Banana 2 keeps its base route with references
      r = await post("tok-director", IMAGE("gemini-3.1-flash-image", "1K", "fal", { images: ["https://v3.fal.media/files/ref-a.png"] }));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.falModel, "fal-ai/nano-banana-2");
      for (const [m, s] of [["gemini-3.1-flash-image", "1K"], ["gemini-nano-banana-2.1", "2K"], ["gemini-3.1-flash-lite-image", "4K"], ["gpt-image-2", "1K"]]) {
        W.calls = [];
        r = await post("tok-none", IMAGE(m, s, "fal", /gpt/.test(m) ? { quality: "high" } : {}));
        assert.equal(r.status, 402, m + s); assert.equal(r.json.code, "plan_required"); assert.equal(W.calls.length, 0);
      }
      r = await post("tok-writer", IMAGE("gemini-3-pro-image", "4K"));
      assert.equal(r.status, 403); assert.equal(r.json.code, "tier_required"); assert.equal(r.json.requiredPlan, "director");
      assert.equal((await post("tok-writer", IMAGE("gpt-image-2", "2K", "fal", { quality: "high" }))).status, 200, "a Writer's 2K key art");
      reset();
      r = await post("tok-director", IMAGE("gemini-2.0-flash-exp-image-generation", "2K", "google"));
      assert.equal(r.status, 400); assert.equal(r.json.code, "model_not_allowed"); assert.equal(W.calls.length, 0, "the name never reaches Google's URL");
      r = await post("tok-director", IMAGE("gemini-3.1-flash-image", "2K", "google"));
      assert.equal(r.status, 200, j(r.json)); assert.equal((await lastHold(U.director)).held, P.creditsFromUsd(0.101, 0.03), "Google's direct price");
    });

    const strip = (x) => H.takeHoldParam(x).url;
    const vpoll = (tok, sub, extra = {}) => post(tok, { task: "video", op: "poll", model: extra.model || KLING().model, statusUrl: sub.json.statusUrl, responseUrl: sub.json.responseUrl, ...extra });
    const providerRefOf = async (rid) => (await db.query("select ref, status, held, kept from public.turn_credit_holds where provider_ref = $1", [rid])).rows[0];

    await test("F8 VIDEO: held at submit (the Stage is Producer's), tied to fal's request id on the server; the completing poll settles it once", async () => {
      reset();
      for (const [tok, codeWanted] of [["tok-none", "plan_required"], ["tok-writer", "tier_required"], ["tok-director", "tier_required"]]) {
        const r = await post(tok, KLING());
        assert.equal(r.json.code, codeWanted, tok); assert.equal(providerCalls("https://queue.fal.run/").length, 0, tok);
      }
      W.falNextStatus = "IN_PROGRESS";
      const before = await bal(U.producer);
      const sub = await post("tok-producer", KLING());
      assert.equal(sub.status, 200, j(sub.json)); assert.ok(sub.json.requestId);
      const held = P.creditsFromUsd(0.126 * 5, 0.03);
      assert.equal(held, 21); assert.equal(sub.json.usage.credits, 21); assert.equal(await bal(U.producer), before - 21, "taken at submit");
      const row = await providerRefOf(sub.json.requestId);
      assert.ok(row && row.ref.startsWith("video:") && row.status === "held", "repair F1: the hold carries fal's request id before the job is handed back");
      assert.match(sub.json.statusUrl, /[?&]kinolot_hold=/); assert.ok(sub.json.holdToken);
      let p = await vpoll("tok-producer", sub);
      assert.equal(p.json.status, "IN_PROGRESS"); assert.equal((await lastHold(U.producer)).status, "held");
      assert.ok(!W.calls.some((c) => c.url.includes("kinolot_hold")), "the token never reaches fal");
      W.fal[sub.json.requestId].status = "COMPLETED";
      p = await vpoll("tok-producer", sub);
      assert.equal(p.json.status, "COMPLETED"); assert.equal(p.json.videoUrl, "https://v3.fal.media/files/v.mp4"); assert.equal(p.json.usage.credits, 21);
      let h = await lastHold(U.producer);
      assert.deepEqual([h.held, h.kept, h.status], [21, 21, "settled"]);
      p = await vpoll("tok-producer", sub); await vpoll("tok-producer", sub);
      assert.equal(p.json.videoUrl, "https://v3.fal.media/files/v.mp4", "a settled job returns its video again");
      assert.equal(p.json.usage.credits, 0, "…with no second charge"); assert.equal(await bal(U.producer), before - 21, "recovery / a second tab polling again never charges twice");
      // the same job with its token stripped is still found by its request id: same answer, no charge
      p = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(sub.json.statusUrl), responseUrl: strip(sub.json.responseUrl) });
      assert.equal(p.json.videoUrl, "https://v3.fal.media/files/v.mp4"); assert.equal(await bal(U.producer), before - 21);
      // another account replaying the URLs: "not found" (round 2, S3 — the same answer as an id nobody holds), nothing delivered
      const other = await vpoll("tok-director", sub);
      assert.equal(other.status, 404); assert.equal(other.json.code, "render_not_found"); assert.equal(other.json.videoUrl, undefined);
      // the response URL is built on the server: fal never sees a client-chosen one
      const resultReads = W.calls.filter((c) => c.method === "GET" && c.url.startsWith("https://queue.fal.run/") && c.url.includes("/requests/") && !c.url.includes("/status"));
      assert.ok(resultReads.length > 0 && resultReads.every((c) => c.url === `https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/${sub.json.requestId}`), j(resultReads.map((c) => c.url)));
    });

    await test("F9 VIDEO: a render fal reports failed is released; one stuck in fal's queue is released only when fal confirms it cancelled it", async () => {
      reset(); W.falNextStatus = "IN_PROGRESS";
      const before = await bal(U.producer);
      const sub = await post("tok-producer", KLING({ duration: 10 }));
      assert.equal(await bal(U.producer), before - 42);
      W.fal[sub.json.requestId].status = "FAILED";
      const p = await vpoll("tok-producer", sub);
      assert.match(p.json.error, /likeness/); assert.equal(p.json.status, "FAILED"); assert.equal(p.json.usage.released, true);
      assert.equal(await bal(U.producer), before, "given back"); assert.equal((await lastHold(U.producer)).status, "released");
      // a late COMPLETED for a released job is never delivered for free
      W.fal[sub.json.requestId].status = "COMPLETED";
      const late = await vpoll("tok-producer", sub);
      assert.equal(late.json.status, "CANCELLED"); assert.equal(late.json.videoUrl, undefined); assert.equal(await bal(U.producer), before);
      // still IN_QUEUE 7 hours after its submit: the poll asks fal to cancel; fal accepts → released
      reset(); W.falNextStatus = "IN_QUEUE";
      const sub2 = await post("tok-producer", KLING());
      await db.query("update public.turn_credit_holds set created_at = now() - interval '7 hours' where provider_ref = $1", [sub2.json.requestId]);
      const p2 = await vpoll("tok-producer", sub2);
      assert.equal(p2.json.status, "CANCELLED"); assert.match(p2.json.error, /credits were returned/);
      assert.equal(W.fal[sub2.json.requestId].cancelled, true, "stopped at fal"); assert.equal(await bal(U.producer), before);
      // IN_PROGRESS for 7 hours: fal is building it — never released on age (it is charged when it finishes)
      reset(); W.falNextStatus = "IN_PROGRESS";
      const sub3 = await post("tok-producer", KLING());
      await db.query("update public.turn_credit_holds set created_at = now() - interval '7 hours' where provider_ref = $1", [sub3.json.requestId]);
      const p3 = await vpoll("tok-producer", sub3);
      assert.equal(p3.json.status, "IN_PROGRESS"); assert.equal((await providerRefOf(sub3.json.requestId)).status, "held");
      assert.equal(W.fal[sub3.json.requestId].cancelAsked || 0, 0, "a running job is not cancelled");
      W.fal[sub3.json.requestId].status = "COMPLETED";
      assert.equal((await vpoll("tok-producer", sub3)).json.usage.credits, 21);
      // a submit fal refuses: released on the spot
      W.providers["https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video"] = (u, m) => (m === "POST" ? reply(422, { detail: [{ loc: ["body", "start_image_url"], msg: "field required" }] }) : null);
      const b2 = await bal(U.producer);
      const bad = await post("tok-producer", KLING());
      assert.match(bad.json.error, /start_image_url: field required|field required/); assert.equal(await bal(U.producer), b2);
      assert.equal((await lastHold(U.producer)).status, "released");
    });

    await test("F10 VIDEO: a price well above the Stage's quote is refused, not charged; Sora 2 is gone", async () => {
      reset();
      const r = await post("tok-producer", KLING({ quotedCredits: 5 }));
      assert.equal(r.status, 409); assert.equal(r.json.code, "price_changed"); assert.equal(r.json.creditsRequired, 21);
      assert.equal(providerCalls("https://queue.fal.run/").length, 0);
      assert.equal((await post("tok-producer", KLING({ quotedCredits: 63 }))).status, 200, "the new app's $0.01 quote is above the pre-switch price: fine");
      const s = await post("tok-producer", KLING({ model: "fal-ai/sora-2/image-to-video" }));
      assert.equal(s.status, 400);
    });

    await test("F11 VOICE is charged: speech by characters, design / clone flat; list and save are free; failures release; tiers apply", async () => {
      reset();
      let before = await bal(U.writer);
      let r = await post("tok-writer", { task: "voice", op: "tts", voiceId: "v1", text: "x".repeat(3000), modelId: "eleven_v3" });
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, 10, "3,000 characters = $0.30 → 10 credits at $0.03");
      assert.equal(await bal(U.writer), before - 10); assert.equal((await lastHold(U.writer)).status, "settled");
      r = await post("tok-writer", { task: "voice", op: "stt", audioB64: b64(chromeWebm(30)), mime: "audio/webm" });
      assert.equal(r.json.text, "a lighthouse keeper"); assert.equal(r.json.usage.credits, 1);
      const holdsBefore = (await holdsOf(U.writer)).length;
      assert.ok((await post("tok-writer", { task: "voice", op: "listVoices" })).json.voices, "the voice list is free");
      assert.equal((await holdsOf(U.writer)).length, holdsBefore, "no hold for a free op");
      r = await post("tok-writer", { task: "voice", op: "design", description: "gravelly" });
      assert.equal(r.status, 403); assert.equal(r.json.code, "tier_required");
      before = await bal(U.director);
      r = await post("tok-director", { task: "voice", op: "design", description: "gravelly" });
      assert.equal(r.json.previews.length, 1); assert.equal(await bal(U.director), before - P.creditsFromUsd(0.10, 0.03));
      r = await post("tok-none", { task: "voice", op: "tts", voiceId: "v1", text: "hi" });
      assert.equal(r.status, 402); assert.equal(r.json.code, "plan_required");
      // ElevenLabs and the fal backup both fail: released, and the invoice detail stays hidden
      reset(); before = await bal(U.writer);
      W.providers["https://api.elevenlabs.io/v1/text-to-speech/"] = () => reply(401, { detail: { message: "The account has an unpaid invoice." } });
      W.providers["https://queue.fal.run/fal-ai/elevenlabs/tts/eleven-v3"] = (u, m) => (m === "POST" ? reply(500, "fal internal error") : null);
      r = await post("tok-writer", { task: "voice", op: "tts", voiceId: "v1", text: "x".repeat(300) });
      assert.doesNotMatch(r.json.error, /invoice|fal|ElevenLabs/i); assert.equal(await bal(U.writer), before);
      assert.equal((await lastHold(U.writer)).status, "released");
    });

    await test("F12 a FROZEN account (open dispute) spends nothing; Frances still answers it (5 a day)", async () => {
      reset();
      for (const body of [TEXT("claude-opus-5-5"), IMAGE("gemini-3.1-flash-image"), { task: "voice", op: "tts", voiceId: "v", text: "x" }]) {
        const r = await post("tok-frozen", body);
        assert.equal(r.status, 403, j(body)); assert.equal(r.json.code, "account_frozen");
      }
      assert.equal(W.calls.length, 0);
      const r = await post("tok-frozen", MUSE());
      assert.equal(r.status, 200); assert.deepEqual(franceRpcs(), [5]);
    });

    await test("F13 FRANCES: free on Opus 5.5 and Opus 5; the daily cap follows the plan; admins are never counted", async () => {
      reset();
      for (const [tok, cap] of [["tok-writer", 15], ["tok-director", 30], ["tok-producer", 50], ["tok-none", 5], ["tok-poor", 15]]) {
        W.rpcs = [];
        const r = await post(tok, MUSE());
        assert.equal(r.status, 200, tok + " " + j(r.json)); assert.deepEqual(franceRpcs(), [cap], tok);
        assert.equal(r.json.usage.credits, 0, "free");
      }
      W.rpcs = []; assert.equal((await post("tok-admin", MUSE())).status, 200); assert.deepEqual(franceRpcs(), [], "admin exempt");
      // both models ride the free path; nothing is held
      const holdsBefore = (await holdsOf(U.writer)).length;
      for (const m of ["claude-opus-5", "claude-opus-5-5"]) {
        W.calls = [];
        const r = await post("tok-writer", MUSE(m));
        // repair F18: either accepted name RUNS Opus 5.5 (an old tab never costs Opus 5's price)
        assert.equal(r.status, 200); assert.equal(providerCalls("https://api.anthropic.com/")[0].body.model, "claude-opus-5-5", m); assert.equal(providerCalls("https://api.anthropic.com/")[0].body.max_tokens, MUSE_LIMITS.maxOutputTokens);
      }
      assert.equal((await holdsOf(U.writer)).length, holdsBefore, "no hold on a free question");
      // the no-plan cap bites at 5 (one used above): four more, then the calm 429
      for (let i = 0; i < 4; i++) assert.equal((await post("tok-none", MUSE())).status, 200);
      W.calls = [];
      const r = await post("tok-none", MUSE());
      assert.equal(r.status, 429); assert.equal(r.json.error, "frances_daily_limit"); assert.equal(r.json.limit, 5); assert.equal(r.json.used, 5);
      assert.equal(W.calls.length, 0, "no model call");
      // a voice session takes a slot at the plan's cap too
      W.rpcs = [];
      const live = await post("tok-director", { task: "live", sdp: "v=0\r\noffer\r\n", mode: "new-story" });
      assert.equal(live.status, 201, j(live.json)); assert.deepEqual(franceRpcs(), [30]);
      // the balance can't be read at all: paid routes refuse, Frances falls back to the ceiling (fail open)
      W.rpcs = []; W.failUserRpc = (n) => n === "turn_credit_balance";
      const origFrom = globalThis.__chargingTestCreateClient;
      globalThis.__chargingTestCreateClient = (u2, k, o) => { const c = origFrom(u2, k, o); if (k === ENV.SUPABASE_ANON_KEY) c.from = () => { const x = { select: () => x, eq: () => x, gte: () => x, limit: () => x, maybeSingle: async () => ({ data: null, error: null }), then: (ok, bad) => Promise.resolve({ data: null, error: { message: "timeout" }, count: 0 }).then(ok, bad) }; return x; }; return c; };
      try {
        const m = await post("tok-producer", MUSE()); assert.equal(m.status, 200); assert.deepEqual(franceRpcs(), [50], "the ceiling");
        const t = await post("tok-producer", TEXT("claude-opus-5-5")); assert.equal(t.status, 503); assert.equal(t.json.code, "billing_unavailable");
      } finally { globalThis.__chargingTestCreateClient = origFrom; }
    });

    await test("F14 FRANCES prompt caching: the stable guide goes to Anthropic as a cached system block; cache reads are priced as such", async () => {
      reset();
      const guide = "KINOLOT PRODUCT GUIDE. ".repeat(400);
      W.providers["https://api.anthropic.com/"] = () => reply(200, { content: [{ type: "text", text: "Open Export." }], usage: { input_tokens: 40, output_tokens: 60, cache_read_input_tokens: 2400, cache_creation_input_tokens: 0 }, stop_reason: "end_turn" });
      const r = await post("tok-writer", MUSE("claude-opus-5-5", { promptCache: true, messages: [{ role: "system", content: guide }, { role: "user", content: "How do I export?" }] }));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, 0, "still free");
      const call = providerCalls("https://api.anthropic.com/")[0].body;
      assert.deepEqual(call.system, [{ type: "text", text: guide, cache_control: { type: "ephemeral" } }]);
      assert.deepEqual(call.messages, [{ role: "user", content: "How do I export?" }]);
      assert.ok(near(r.json.usage.providerCostUsd, (40 * 4 + 2400 * 0.2 + 60 * 20) / 1e6), String(r.json.usage.providerCostUsd));
      const usage = W.rpcs.find((x) => x[1] === "turn_record_usage_event")[2];
      assert.equal(usage.usage_metadata.cacheReadTokens, 2400); assert.ok(usage.provider_cost > 0, "a free row now records its real cost");
      // without promptCache the same shape is not Frances's chat: metered (held) like any writing call
      reset();
      const m = await post("tok-writer", MUSE("claude-opus-5-5", { messages: [{ role: "system", content: guide }, { role: "user", content: "Write scene 4." }] }));
      assert.equal(m.status, 200); assert.ok(m.json.usage.credits >= 1); assert.equal(typeof providerCalls("https://api.anthropic.com/")[0].body.system, "string");
    });

    await test("F15 billing unavailable (the hold functions missing): paid calls refuse with a plain 503, never run free", async () => {
      reset(); W.failServiceRpc = (n) => n === "turn_hold_credits";
      for (const body of [TEXT("claude-opus-5-5"), IMAGE("gemini-3.1-flash-image"), KLING()]) {
        W.calls = [];
        const r = await post(body.task === "video" ? "tok-producer" : "tok-director", body);
        assert.equal(r.status, 503, j(body)); assert.equal(r.json.code, "billing_unavailable");
        assert.equal(r.json.message, "Credits can't be checked right now. Please try again in a minute.");
        assert.equal(W.calls.filter((c) => !c.url.startsWith("https://example")).length, 0, "no provider call");
      }
      assert.ok(warns.some((w) => /Run supabase billing-v2\.sql before deploying this proxy/.test(w)));
      // admins are never held
      reset(); W.failServiceRpc = (n) => n === "turn_hold_credits";
      assert.equal((await post("tok-admin", TEXT("claude-fable-5-1"))).status, 200);
    });

    await test("F18 (repair F1) the reviewer's free-video probes: a bogus responseUrl, another job's result, the stale-hold sweep, a missing video — none delivers a video without its charge", async () => {
      // P1: the token rides a real statusUrl, responseUrl names a job that 404s → refused; nothing released
      reset(); W.falNextStatus = "IN_PROGRESS";
      const before = await bal(U.producer);
      const sub = await post("tok-producer", KLING({ duration: 15 }));
      const held = sub.json.usage.credits, rid = sub.json.requestId;
      assert.equal(held, P.creditsFromUsd(0.126 * 15, 0.03));
      W.fal[rid].status = "COMPLETED";
      const p1 = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl,
        responseUrl: "https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/does-not-exist" });
      assert.equal(p1.status, 400); assert.equal(p1.json.videoUrl, undefined);
      assert.equal((await providerRefOf(rid)).status, "held", "no release"); assert.equal(await bal(U.producer), before - held);
      // P1b: responseUrl of another fal job (a result without a video) → refused; nothing released
      W.providers["https://queue.fal.run/fal-ai/other/requests/x"] = () => reply(200, { images: [] });
      const p1b = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: "https://queue.fal.run/fal-ai/other/requests/x" });
      assert.equal(p1b.status, 400); assert.equal(providerCalls("https://queue.fal.run/fal-ai/other/").length, 0, "the client's responseUrl is never fetched");
      // P1c: responseUrl = the job's OWN status URL — same job, so it is ignored: the server-built result is fetched and CHARGED
      const p1c = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: sub.json.statusUrl, responseUrl: strip(sub.json.statusUrl) });
      assert.equal(p1c.json.status, "COMPLETED"); assert.equal(p1c.json.usage.credits, held);
      // …and the tokenless replay then gets the video with no refund and no second charge
      const p2 = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(sub.json.statusUrl), responseUrl: strip(sub.json.responseUrl) });
      assert.equal(p2.json.status, "COMPLETED"); assert.ok(p2.json.videoUrl);
      assert.equal(await bal(U.producer), before - held, "EXPLOIT closed: the video was delivered and charged exactly once");
      // the stale-hold sweep never releases a submitted job's hold (it carries fal's request id); the poll settles it
      reset(); W.falNextStatus = "COMPLETED";
      const b2 = await bal(U.producer);
      const sub2 = await post("tok-producer", KLING());
      await db.query("update public.turn_credit_holds set created_at = now() - interval '2 days' where provider_ref = $1", [sub2.json.requestId]);
      await svc("select public.turn_release_stale_holds(1440)");
      assert.equal((await providerRefOf(sub2.json.requestId)).status, "held", "not swept");
      const p3 = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(sub2.json.statusUrl), responseUrl: strip(sub2.json.responseUrl) });
      assert.equal(p3.json.usage.credits, 21); assert.equal(await bal(U.producer), b2 - 21);
      // a result fal can't return right now (5xx / 404) or one without a video: retryable, the hold stays
      reset(); W.falNextStatus = "COMPLETED";
      const b3 = await bal(U.producer);
      const sub3 = await post("tok-producer", KLING());
      for (const res of [() => reply(502, { detail: "upstream" }), () => reply(404, { detail: "Request not found" }), () => reply(200, { images: [] })]) {
        W.fal[sub3.json.requestId].result = res;
        const q = await vpoll("tok-producer", sub3);
        assert.equal(q.json.retry, true, j(q.json)); assert.equal(q.json.code, "result_pending"); assert.equal(q.json.videoUrl, undefined);
        assert.equal((await providerRefOf(sub3.json.requestId)).status, "held"); assert.equal(await bal(U.producer), b3 - 21, "never released for a missing result");
      }
      delete W.fal[sub3.json.requestId].result;
      assert.equal((await vpoll("tok-producer", sub3)).json.usage.credits, 21, "the next good poll settles it");
      // the status URL must be fal's queue form for THIS model
      for (const statusUrl of [`https://queue.fal.run/bytedance/seedance-2.0/requests/${sub3.json.requestId}/status`, `https://evil.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/${sub3.json.requestId}/status`,
        `https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/${sub3.json.requestId}`]) {
        assert.equal((await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl })).status, 400, statusUrl);
      }
      // a request id with NO hold row — a job from before this deploy (or an admin's) — keeps the read-only path
      // (fal's ids are UUIDs; round 3, S8: only that spelling may be served without a hold row)
      const L1 = "0a1b2c3d-0000-4000-8000-000000000001";
      W.fal[L1] = { endpoint: "fal-ai/kling-video", status: "COMPLETED" };
      const legacy = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: `https://queue.fal.run/fal-ai/kling-video/requests/${L1}/status`, responseUrl: `https://queue.fal.run/fal-ai/kling-video/requests/${L1}` });
      assert.equal(legacy.json.status, "COMPLETED"); assert.equal(legacy.json.usage, undefined, "nothing to settle");
      // …which no new job can reach: a job whose hold can't be tied to its request id is cancelled at fal and refunded
      reset(); W.falNextStatus = "IN_QUEUE"; W.failServiceRpc = (n) => n === "turn_hold_attach";
      const b4 = await bal(U.producer);
      const sub4 = await post("tok-producer", KLING());
      assert.equal(sub4.json.code, "hold_attach_failed", j(sub4.json)); assert.equal(sub4.json.requestId, undefined);
      assert.equal(W.fal["req-" + W.falSeq].cancelled, true, "stopped at fal"); assert.equal(await bal(U.producer), b4);
      assert.equal((await lastHold(U.producer)).status, "released");
      // a lookup that fails is a retry, never a free render
      reset(); W.falNextStatus = "COMPLETED";
      const sub5 = await post("tok-producer", KLING());
      W.failServiceRpc = (n) => n === "turn_hold_lookup";
      const q5 = await vpoll("tok-producer", sub5);
      assert.equal(q5.json.retry, true); assert.equal(q5.json.videoUrl, undefined);
      W.failServiceRpc = null;
      assert.equal((await vpoll("tok-producer", sub5)).json.usage.credits, 21);
    });

    await test("F19 (repair F2) renders billed by an input video's length: held at the most allowed, settled from lengths the proxy reads itself", async () => {
      const MC = (extra = {}) => ({ task: "video", op: "submit", model: "fal-ai/kling-video/v3/pro/motion-control", image_url: "https://cdn.example.com/c.png",
        video_url: "https://cdn.example.com/motion.mp4", characterOrientation: "video",
        referenceMetadata: { videos: [{ durationSeconds: 3, mime: "video/mp4", sizeBytes: 5000000 }] }, ...extra });
      const finish = (sub, url, seconds, opts) => { W.mp4[url] = mp4(seconds, opts); W.fal[sub.json.requestId].videoUrl = url; W.fal[sub.json.requestId].status = "COMPLETED"; };
      // the reviewer's probe: a 30 s motion video declared as 3 s, at a URL the proxy may not read
      reset(); W.falNextStatus = "IN_PROGRESS";
      const max = P.creditsFromUsd(0.168 * 30, 0.03);
      const b1 = await bal(U.producer);
      const r1 = await post("tok-producer", MC());
      assert.equal(r1.status, 200, j(r1.json)); assert.equal(r1.json.usage.credits, max, "held at the 30 s maximum, not the declared 3 s");
      assert.ok(!W.calls.some((c) => c.url.startsWith("https://cdn.example.com/")), "an arbitrary client URL is never fetched");
      assert.equal(W.fal[r1.json.requestId].input.duration, undefined, "fal gets no duration: it bills the real length");
      finish(r1, "https://v3.fal.media/files/mc-30.mp4", 30, { moovLast: true, mdatBytes: 100000 });
      let p = await vpoll("tok-producer", r1, { model: MC().model });
      assert.equal(p.json.usage.credits, max, "a 30 s result costs 30 s"); assert.equal(await bal(U.producer), b1 - max);
      // an honest 12 s motion video on an unreadable host: held at the maximum, settled at 12 s from the output
      reset(); W.falNextStatus = "IN_PROGRESS";
      const b2 = await bal(U.producer);
      const r2 = await post("tok-producer", MC({ referenceMetadata: { videos: [{ durationSeconds: 12, mime: "video/mp4", sizeBytes: 5000000 }] } }));
      assert.equal(r2.json.usage.credits, max); assert.equal(r2.json.usage.settlesByLength, true);
      finish(r2, "https://v3.fal.media/files/mc-12.mp4", 12.02);
      p = await vpoll("tok-producer", r2, { model: MC().model });
      assert.equal(p.json.usage.credits, P.creditsFromUsd(0.168 * 12, 0.03)); assert.equal(await bal(U.producer), b2 - P.creditsFromUsd(0.168 * 12, 0.03));
      // round 2: the settle facts are the hold's OWN (written by the server into its reason at submit) —
      // no token needed, and another job's token changes nothing
      reset(); W.falNextStatus = "IN_PROGRESS";
      const r3 = await post("tok-producer", MC());
      const h3 = (await db.query("select reason from public.turn_credit_holds where provider_ref = $1", [r3.json.requestId])).rows[0];
      assert.match(h3.reason, /^video:kling-3\.0-motion-control:1080p m=fal-ai\/kling-video\/v3\/pro\/motion-control s=\{"v":2,"k":"motion","rate":0\.168,"mo":30,/, h3.reason);
      finish(r3, "https://v3.fal.media/files/mc-12b.mp4", 12);
      p = await post("tok-producer", { task: "video", op: "poll", model: MC().model, statusUrl: strip(r3.json.statusUrl), holdToken: r2.json.holdToken });
      assert.equal(p.json.usage.credits, P.creditsFromUsd(0.168 * 12, 0.03), "the hold's own facts: its real 12 s, whatever token rides along");
      // an output whose length can't be read: the hold stands, and the server logs it
      reset(); W.falNextStatus = "COMPLETED";
      const r4 = await post("tok-producer", MC());
      warns.length = 0;
      p = await vpoll("tok-producer", r4, { model: MC().model });
      assert.equal(p.json.usage.credits, max); assert.ok(warns.some((w) => /length couldn't be read; the hold of \d+ stands/.test(w)), j(warns));
      // round 4 (owner decision): a motion video the proxy CAN read on fal's CDN (immutable) is held for its
      // length x 1.1 + 1 s (8.2 → 10.1 s), no longer the 30 s maximum; its 9 s is what the quote is checked against
      reset(); W.falNextStatus = "IN_PROGRESS"; W.mp4["https://v3.fal.media/files/motion-8.mp4"] = mp4(8.2);
      const r5 = await post("tok-producer", MC({ video_url: "https://v3.fal.media/files/motion-8.mp4", quotedCredits: P.creditsFromUsd(0.168 * 9, 0.03) }));
      assert.equal(r5.status, 200, j(r5.json));
      assert.equal(r5.json.usage.credits, P.creditsFromUsd(0.168 * 10.1, 0.03)); assert.equal(r5.json.usage.expectedCredits, P.creditsFromUsd(0.168 * 9, 0.03));
      assert.equal(r5.json.usage.heldForLength, true);
      finish(r5, "https://v3.fal.media/files/mc-8.mp4", 8.2);
      assert.equal((await vpoll("tok-producer", r5, { model: MC().model })).json.usage.credits, P.creditsFromUsd(0.168 * 9, 0.03), "settled from fal's own 8.2 s output");
      // THE VERIFY-MONEY CASE: a crafted motion video on fal.media whose mvhd says 3 s (the tracks say 30 s).
      // It is read at 30 s (the quote at 3 s is refused), held at 30 s, and fal's 30 s output settles 30 s — never capped at 3 s
      reset(); W.falNextStatus = "IN_PROGRESS"; W.mp4["https://v3.fal.media/files/forged-motion.mp4"] = forgedMp4(3, 30);
      let rf = await post("tok-producer", MC({ video_url: "https://v3.fal.media/files/forged-motion.mp4", quotedCredits: P.creditsFromUsd(0.168 * 3, 0.03) }));
      assert.equal(rf.status, 409); assert.equal(rf.json.creditsRequired, max); assert.equal(rf.json.reason, undefined, "its length WAS read — 30 s");
      rf = await post("tok-producer", MC({ video_url: "https://v3.fal.media/files/forged-motion.mp4" }));
      assert.equal(rf.json.usage.credits, max);
      finish(rf, "https://v3.fal.media/files/forged-out.mp4", 30);
      assert.equal((await vpoll("tok-producer", rf, { model: MC().model })).json.usage.credits, max, "17 vs 168 in round 1; the full 30 s now");
      // the same forged header on a Seedance REFERENCE: billed at the tracks' 10 s, not the header's 2 s
      reset(); W.mp4["https://v3.fal.media/files/forged-ref.mp4"] = forgedMp4(2, 10);
      const rr = await post("tok-producer", { task: "video", op: "submit", model: "bytedance/seedance-2.0/reference-to-video", prompt: "@Image1 moves like @Video1",
        image_urls: ["https://cdn.example.com/f.png"], video_urls: ["https://v3.fal.media/files/forged-ref.mp4"], duration: 5, resolution: "720p",
        referenceMetadata: { videos: [{ durationSeconds: 2, mime: "video/mp4", sizeBytes: 1000000 }] } });
      assert.equal(rr.status, 200, j(rr.json)); assert.equal(rr.json.usage.credits, P.creditsFromUsd(0.3034 * 0.6 * 15, 0.03));
      // …and one longer than the mode allows is refused before anything is held or submitted
      reset(); W.mp4["https://v3.fal.media/files/motion-40.mp4"] = mp4(40);
      const h0 = (await holdsOf(U.producer)).length;
      const r6 = await post("tok-producer", MC({ video_url: "https://v3.fal.media/files/motion-40.mp4" }));
      assert.equal(r6.status, 400); assert.match(r6.json.error, /40\.0s long; at most 30s/);
      assert.equal((await holdsOf(U.producer)).length, h0); assert.equal(providerCalls("https://queue.fal.run/fal-ai/kling-video/v3/pro/motion-control").filter((c) => c.method === "POST").length, 0);
      // Seedance 2.5 editing, the source declared as 1.8 s at an unreadable URL: held at (30 + 30.2) x 0.6, a 20 s result settles (20 + 20) x 0.6
      reset(); W.falNextStatus = "IN_PROGRESS";
      const ED = { task: "video", op: "submit", model: "bytedance/seedance-2.5/reference-to-video", videoTask: "editing", prompt: "restyle @Video1",
        video_urls: ["https://cdn.example.com/src-30s.mp4"], resolution: "1080p", referenceMetadata: { videos: [{ durationSeconds: 1.8, mime: "video/mp4", sizeBytes: 5000000 }] } };
      const r7 = await post("tok-producer", ED);
      assert.equal(r7.status, 200, j(r7.json)); assert.equal(r7.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * 60.2, 0.03));
      finish(r7, "https://v3.fal.media/files/edit-20.mp4", 20);
      p = await vpoll("tok-producer", r7, { model: ED.model });
      assert.equal(p.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * 40, 0.03));
      // a reference read on fal's CDN longer than Seedance allows is refused up front
      reset(); W.mp4["https://v3.fal.media/files/ref-40.mp4"] = mp4(40);
      const r8 = await post("tok-producer", { ...ED, video_urls: ["https://v3.fal.media/files/ref-40.mp4"] });
      assert.equal(r8.status, 400); assert.match(r8.json.error, /reference videos run 40\.0s/);
    });

    await test("F20 (repair F4) speech is charged by the route that served it; an unknown voice model is refused before any call", async () => {
      const t = "x".repeat(4000);
      reset();
      let v = await post("tok-writer", { task: "voice", op: "tts", voiceId: "stock-1", text: t, modelId: "eleven_flash_v2_5" });
      assert.equal(v.status, 200, j(v.json)); assert.equal(v.json.usage.credits, P.creditsFromUsd(0.20, 0.03), "ElevenLabs served it: the fast rate");
      let h = await lastHold(U.writer);
      assert.deepEqual([h.held, h.kept], [P.creditsFromUsd(0.40, 0.03), P.creditsFromUsd(0.20, 0.03)], "held at the dearer route, kept at the served one");
      // ElevenLabs refuses → the fal backup renders Eleven v3 → charged at v3's price (it was charged the fast rate)
      reset(); W.providers["https://api.elevenlabs.io/v1/text-to-speech/"] = () => reply(503, { detail: { message: "service unavailable" } });
      v = await post("tok-writer", { task: "voice", op: "tts", voiceId: "stock-1", text: t, modelId: "eleven_flash_v2_5" });
      assert.equal(v.status, 200, j(v.json)); assert.equal(v.json.via, "fal");
      assert.ok(providerCalls("https://queue.fal.run/fal-ai/elevenlabs/tts/eleven-v3").length > 0);
      assert.equal(v.json.usage.credits, P.creditsFromUsd(0.40, 0.03)); assert.ok(near(v.json.usage.providerCostUsd, 0.40));
      // the reviewer's probe: an invented 'flash' id — refused before any hold or provider call
      reset(); const hb = (await holdsOf(U.writer)).length;
      v = await post("tok-writer", { task: "voice", op: "tts", voiceId: "stock-1", text: t, modelId: "eleven_flash_x" });
      assert.equal(v.status, 400); assert.equal(v.json.code, "model_not_allowed"); assert.doesNotMatch(v.json.error, /eleven|fal/i);
      assert.equal(W.calls.filter((c) => /elevenlabs|fal\.run/.test(c.url)).length, 0); assert.equal((await holdsOf(U.writer)).length, hb);
    });

    await test("F21 (repair F11) every writing-provider call carries a timeout below the Edge wall clock; a timeout releases the hold", async () => {
      reset();
      for (const [model, prov, url] of [["claude-opus-5-5", "anthropic", "https://api.anthropic.com/v1/messages"], ["gpt-5.5-2026-04-23", "openai", "https://api.openai.com/v1/chat/completions"],
        ["gemini-3.8-flash", "google", "https://generativelanguage.googleapis.com/"], ["kimi-k2.7-code", "moonshot", "https://api.moonshot.ai/v1/chat/completions"]]) {
        W.calls = [];
        const r = await post("tok-producer", TEXT(model, prov));
        assert.equal(r.status, 200, model + " " + j(r.json));
        assert.ok(providerCalls(url)[0].signal instanceof AbortSignal, model + " passes an AbortSignal");
      }
      W.calls = []; await post("tok-writer", MUSE());
      assert.ok(providerCalls("https://api.anthropic.com/")[0].signal instanceof AbortSignal, "Frances too");
      const src = read("supabase/functions/image-proxy/index.ts");
      assert.match(src, /const TEXT_PROVIDER_TIMEOUT_MS = 380000;/);
      assert.equal((src.match(/signal: AbortSignal\.timeout\(TEXT_PROVIDER_TIMEOUT_MS\)/g) || []).length, 4, "Anthropic, OpenAI, Google and Moonshot");
      // a call that outruns it: the finally path runs — the hold comes back — and the message says so
      reset(); W.providers["https://api.anthropic.com/v1/messages"] = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
      const b = await bal(U.producer);
      const r = await post("tok-producer", TEXT("claude-opus-5-5"));
      assert.match(r.json.error, /took too long/); assert.equal(await bal(U.producer), b); assert.equal((await lastHold(U.producer)).status, "released");
    });

    await test("F22 (repair F22 + S2) the quote guard compares the FULL price (reference seconds included) at quote x 1.1 + 2", async () => {
      // S2: a render costing quote x 1.1 + 2 is accepted, x 1.1 + 3 refused — and 10 x 1.1 counts as 11, not 12
      reset(); W.pricingOverrides = { video: { "kling-3.0": { standard: { "720p": 0.078 } } } };   // 5 s = $0.39 = 13 credits at $0.03
      let r = await post("tok-producer", KLING({ quotedCredits: 10 }));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, 13);
      reset(); W.pricingOverrides = { video: { "kling-3.0": { standard: { "720p": 0.084 } } } };   // 14 credits
      r = await post("tok-producer", KLING({ quotedCredits: 10 }));
      assert.equal(r.status, 409); assert.equal(r.json.code, "price_changed"); assert.equal(r.json.creditsRequired, 14);
      // the same pair at a quote whose x 1.1 carries float error (50 x 1.1 = 55.00000000000001): 57 accepted, 58 refused
      assert.equal(50 * 1.1 > 55, true, "the float edge this pins");
      reset(); W.pricingOverrides = { video: { "kling-3.0": { standard: { "720p": 0.342 } } } };   // 5 s = $1.71 = 57 credits
      r = await post("tok-producer", KLING({ quotedCredits: 50 }));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, 57);
      reset(); W.pricingOverrides = { video: { "kling-3.0": { standard: { "720p": 0.348 } } } };   // 58 credits
      r = await post("tok-producer", KLING({ quotedCredits: 50 }));
      assert.equal(r.status, 409, "quote x 1.1 + 3 is refused, float or not"); assert.equal(r.json.creditsRequired, 58);
      // a quote that leaves out the reference-video seconds is no longer a match (it was charged ~50% above the button)
      reset(); W.mp4["https://v3.fal.media/files/ref-10.mp4"] = mp4(10);
      const SEED = (q) => ({ task: "video", op: "submit", model: "bytedance/seedance-2.0/reference-to-video", prompt: "@Image1 walks, moving like @Video1",
        image_urls: ["https://cdn.example.com/f.png"], video_urls: ["https://v3.fal.media/files/ref-10.mp4"], duration: 5, resolution: "720p",
        referenceMetadata: { videos: [{ durationSeconds: 10, mime: "video/mp4", sizeBytes: 1000000 }] }, ...(q != null ? { quotedCredits: q } : {}) });
      const full = P.creditsFromUsd(0.3034 * 0.6 * 15, 0.03), outputOnly = P.creditsFromUsd(0.3034 * 5, 0.03);
      assert.deepEqual([full, outputOnly], [92, 51]);
      r = await post("tok-producer", SEED(outputOnly));
      assert.equal(r.status, 409); assert.equal(r.json.creditsRequired, full); assert.equal(providerCalls("https://queue.fal.run/").filter((c) => c.method === "POST").length, 0);
      reset(); W.mp4["https://v3.fal.media/files/ref-10.mp4"] = mp4(10);
      r = await post("tok-producer", SEED(full));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, full);
      assert.deepEqual(W.fal[r.json.requestId].input.video_urls, ["https://v3.fal.media/files/ref-10.mp4"]);
      reset(); W.mp4["https://v3.fal.media/files/ref-10.mp4"] = mp4(10);
      r = await post("tok-producer", SEED(null));
      assert.equal(r.status, 200, "no quote (an older app): priced as before"); assert.equal(r.json.usage.credits, full);
      // a reference the proxy can't read is priced at the longest allowed length; the refusal says why (no vendor names)
      reset();
      r = await post("tok-producer", { ...SEED(full), video_urls: ["https://cdn.example.com/ref.webm"] });
      assert.equal(r.status, 409); assert.equal(r.json.lengthUnverified, true); assert.equal(r.json.creditsRequired, P.creditsFromUsd(0.3034 * 0.6 * 20, 0.03));
      assert.match(r.json.message, /couldn't be checked/); assert.doesNotMatch(r.json.message, /fal|seedance|bytedance|kling/i);
      // ROUND 2 (S4): the refusal says WHY (contract: reason length_unreadable + detail), names the credits to
      // confirm, and a resend with that quote is accepted
      assert.equal(r.json.error, "price_changed"); assert.equal(r.json.reason, "length_unreadable"); assert.equal(r.json.detail, "host");
      assert.match(r.json.message, /stored somewhere this service doesn't read from/); assert.match(r.json.message, new RegExp(`Render it at ${POL.formatCredits(r.json.creditsRequired)} credits, or upload the video from your device or library\\.$`));
      const confirmAt = r.json.creditsRequired;
      reset(); W.falNextStatus = "IN_PROGRESS";
      r = await post("tok-producer", { ...SEED(confirmAt), video_urls: ["https://cdn.example.com/ref.webm"] });
      assert.equal(r.status, 200, "resent at the credits it named: " + j(r.json)); assert.equal(r.json.usage.credits, confirmAt);
      // not an MP4 / MOV (a WebM on the readable CDN)
      reset(); W.mp4["https://v3.fal.media/files/ref.webm"] = cat([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), new Uint8Array(4000)]);
      r = await post("tok-producer", { ...SEED(full), video_urls: ["https://v3.fal.media/files/ref.webm"] });
      assert.equal(r.status, 409); assert.equal(r.json.detail, "format"); assert.match(r.json.message, /isn't an MP4 or MOV file/); assert.match(r.json.message, /use an MP4 or MOV file\.$/);
      // a read that times out twice (each ranged read is retried ONCE): "timeout"
      reset(); let slow = 0;
      W.providers["https://v3.fal.media/files/slow.mp4"] = () => { slow++; throw new DOMException("The operation timed out.", "TimeoutError"); };
      r = await post("tok-producer", { ...SEED(full), video_urls: ["https://v3.fal.media/files/slow.mp4"] });
      assert.equal(r.status, 409); assert.equal(r.json.detail, "timeout"); assert.equal(slow, 2, "retried once");
      assert.match(r.json.message, /reading it timed out/); assert.match(r.json.message, /try again in a moment\.$/);
      // …and one the retry recovers: priced from the real length, the full quote accepted
      reset(); let hiccup = 0; W.mp4["https://v3.fal.media/files/slow2.mp4"] = mp4(10);
      W.providers["https://v3.fal.media/files/slow2.mp4"] = () => { if (hiccup++ === 0) throw new DOMException("The operation timed out.", "TimeoutError"); return null; };
      r = await post("tok-producer", { ...SEED(full), video_urls: ["https://v3.fal.media/files/slow2.mp4"] });
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, full);
    });

    await test("F23 (repair F5) a prompt of 4-byte characters is held at 4 tokens a character (the hold stays an upper bound)", async () => {
      reset();
      const r = await post("tok-producer", { ...TEXT("claude-opus-5-5"), messages: [{ role: "user", content: "\u{1D11E}".repeat(5000) }] });
      assert.equal(r.status, 200, j(r.json));
      const worst = P.creditsFromUsd((5000 * 4 * 4 + 16000 * 20) / 1e6, 0.03);
      assert.ok((await lastHold(U.producer)).held >= worst, "held " + (await lastHold(U.producer)).held + " >= " + worst);
    });

    await test("F24 (repair F20) a no-plan balance too small for one answer on a heavy engine hears the shortfall and that a lighter engine runs", async () => {
      reset();
      await svc("select public.turn_add_pack_once($1, $2, 10, 'ch_fresh10')", ["evt-fresh-10", U.fresh.id]);
      const r = await post("tok-fresh", TEXT("claude-opus-5-5"));
      assert.equal(r.status, 402); assert.equal(r.json.code, "insufficient_credits");
      assert.match(r.json.message, /^This writing engine needs at least \d+ credits for one answer, but this account has 10 \(\d+ short\)\. Choose a lighter writing engine, or add credits\.$/);
      assert.doesNotMatch(r.json.message, /claude|opus|anthropic|gemini|google|kimi|openai/i);
      assert.equal(providerCalls("https://api.anthropic.com/").length, 0);
      const light = await post("tok-fresh", TEXT("gemini-3.8-flash", "google"));
      assert.equal(light.status, 200, "…and a lighter default engine runs on the same balance: " + j(light.json));
    });

    await test("F25 (round 2, S3) request ids are canonical at attach and at every lookup; another account's hold is 'not found'; no-hold polls only in the drain window", async () => {
      reset(); W.falIdStyle = "uuid"; W.falNextStatus = "IN_PROGRESS";
      const b0 = await bal(U.producer);
      const a = await post("tok-producer", KLING()); const rid = a.json.requestId;
      assert.match(rid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); assert.equal((await providerRefOf(rid)).status, "held");
      W.fal[rid].status = "COMPLETED";
      // the id in UPPER CASE: the same hold is found and settled (round 1 served it read-only, unsettled)
      const upper = (u) => u.replace(rid, rid.toUpperCase());
      W.calls = [];
      let p = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: upper(strip(a.json.statusUrl)), responseUrl: upper(strip(a.json.responseUrl)) });
      assert.equal(p.json.status, "COMPLETED", j(p.json)); assert.equal(p.json.usage.credits, 21); assert.equal((await providerRefOf(rid)).status, "settled");
      assert.ok(W.calls.filter((c) => c.url.startsWith("https://queue.fal.run/")).every((c) => !c.url.includes(rid.toUpperCase())), "fal is asked with the canonical id only");
      // the id without its dashes (and a response URL in yet another spelling): the same job, settled
      const b = await post("tok-producer", KLING()); const rid2 = b.json.requestId; W.fal[rid2].status = "COMPLETED";
      p = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(b.json.statusUrl).replace(rid2, rid2.replace(/-/g, "")),
        responseUrl: strip(b.json.responseUrl).replace(rid2, rid2.toUpperCase()) });
      assert.equal(p.json.usage.credits, 21); assert.equal((await providerRefOf(rid2)).status, "settled");
      assert.equal(await bal(U.producer), b0 - 42, "each charged exactly once");
      // ANOTHER account's id, in any spelling: "not found" — nothing delivered, the hold untouched
      const c = await post("tok-producer", KLING()); const rid3 = c.json.requestId; W.fal[rid3].status = "COMPLETED";
      for (const spell of [rid3, rid3.toUpperCase(), rid3.replace(/-/g, "")]) {
        const o = await post("tok-director", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(c.json.statusUrl).replace(rid3, spell) });
        assert.equal(o.status, 404, spell); assert.equal(o.json.code, "render_not_found"); assert.equal(o.json.videoUrl, undefined);
      }
      assert.equal((await providerRefOf(rid3)).status, "held");
      // an ADMIN's job (admins take no hold): the admin keeps the read-only path; anyone else only in the drain window
      const ad = await post("tok-admin", KLING()); const ridA = ad.json.requestId; W.fal[ridA].status = "COMPLETED";
      assert.equal(await providerRefOf(ridA), undefined, "no hold for an admin");
      const pollA = (tok) => post(tok, { task: "video", op: "poll", model: KLING().model, statusUrl: strip(ad.json.statusUrl) });
      assert.equal((await pollA("tok-admin")).json.status, "COMPLETED");
      assert.equal((await pollA("tok-producer")).json.status, "COMPLETED", "no marker yet: the drain window hasn't started (jobs from before the deploy)");
      await db.query("insert into public.turn_billing_state(key, value, at) values ('server_video_billing', '{}'::jsonb, now() - interval '47 hours') on conflict (key) do update set at = excluded.at");
      p = await pollA("tok-producer");
      assert.equal(p.json.status, "COMPLETED", "47 h after the marker: still collected"); assert.equal(p.json.usage, undefined, "read-only: nothing to settle");
      await db.query("update public.turn_billing_state set at = now() - interval '49 hours' where key = 'server_video_billing'");
      p = await pollA("tok-producer");
      assert.equal(p.status, 404, "49 h after the marker: not found"); assert.equal(p.json.code, "render_not_found"); assert.equal(p.json.videoUrl, undefined);
      assert.equal((await pollA("tok-admin")).json.status, "COMPLETED", "…while the admin still can");
      const L2 = "0a1b2c3d-0000-4000-8000-000000000002";
      W.fal[L2] = { endpoint: "fal-ai/kling-video", status: "COMPLETED" };
      p = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: `https://queue.fal.run/fal-ai/kling-video/requests/${L2}/status` });
      assert.equal(p.status, 404, "a job from before the deploy, after the window");
      // a marker that can't be read: a retry — never a free render
      W.failMarkerRead = true;
      p = await pollA("tok-producer");
      assert.equal(p.json.code, "result_pending"); assert.equal(p.json.retry, true); assert.equal(p.json.videoUrl, undefined);
      W.failMarkerRead = false;
      await db.query("delete from public.turn_billing_state where key = 'server_video_billing'");
    });

    await test("F26 (round 2, S1) POST {op:'reconcile_holds'} with NO sign-in settles, releases or leaves abandoned renders from fal's own status; throttled; at most 50", async () => {
      reset(); W.falNextStatus = "IN_PROGRESS";
      const MCX = { task: "video", op: "submit", model: "fal-ai/kling-video/v3/pro/motion-control", image_url: "https://cdn.example.com/c.png",
        video_url: "https://cdn.example.com/motion.mp4", characterOrientation: "video", referenceMetadata: { videos: [{ durationSeconds: 12, mime: "video/mp4", sizeBytes: 5000000 }] } };
      const done = await post("tok-producer", KLING()), mc = await post("tok-producer", MCX), failed = await post("tok-producer", KLING()),
        lost = await post("tok-producer", KLING()), running = await post("tok-producer", KLING()), fresh = await post("tok-producer", KLING());
      for (const x of [done, mc, failed, lost, running]) await backdate(x.json.requestId);
      W.fal[done.json.requestId].status = "COMPLETED";
      W.fal[mc.json.requestId].status = "COMPLETED"; W.fal[mc.json.requestId].videoUrl = "https://v3.fal.media/files/rc-12.mp4"; W.mp4["https://v3.fal.media/files/rc-12.mp4"] = mp4(12);
      W.fal[failed.json.requestId].status = "FAILED";
      delete W.fal[lost.json.requestId];
      W.fal[fresh.json.requestId].status = "COMPLETED";
      const mcMax = mc.json.usage.credits, mc12 = P.creditsFromUsd(0.168 * 12, 0.03);
      assert.equal(mcMax, P.creditsFromUsd(0.168 * 30, 0.03));
      const b0 = await bal(U.producer);
      await unthrottle();
      const r = await postNoAuth({ op: "reconcile_holds" });
      assert.equal(r.status, 200, j(r.json) + " " + j(warns.filter((w) => /reconcile|claim|holds list/.test(w)).slice(-3))); assert.equal(r.json.ok, true);
      assert.deepEqual([r.json.settled, r.json.released], [2, 2], j(r.json));
      assert.deepEqual([(await providerRefOf(done.json.requestId)).status, Number((await providerRefOf(done.json.requestId)).kept)], ["settled", 21], "finished → the hold is the charge");
      assert.deepEqual([(await providerRefOf(mc.json.requestId)).status, Number((await providerRefOf(mc.json.requestId)).kept)], ["settled", mc12], "Motion Control: settled at the OUTPUT's real 12 s, as a poll would");
      assert.equal((await providerRefOf(failed.json.requestId)).status, "released", "failed while nobody watched → refunded");
      assert.equal((await providerRefOf(lost.json.requestId)).status, "released", "fal has no such job → refunded");
      assert.equal((await providerRefOf(running.json.requestId)).status, "held", "still running → left");
      assert.equal((await providerRefOf(fresh.json.requestId)).status, "held", "younger than an hour → not checked yet");
      assert.equal(await bal(U.producer), b0 + 21 + 21 + (mcMax - mc12));
      // the user comes back: the reconciled render's video, no second charge; a refunded one is never delivered
      let p = await vpoll("tok-producer", done);
      assert.equal(p.json.videoUrl, "https://v3.fal.media/files/v.mp4"); assert.equal(p.json.usage.credits, 0);
      W.fal[failed.json.requestId].status = "COMPLETED";
      p = await vpoll("tok-producer", failed);
      assert.equal(p.json.videoUrl, undefined); assert.equal(p.json.status, "CANCELLED");
      // a second call right away: throttled, no provider call
      W.calls = [];
      const again = await postNoAuth({ op: "reconcile_holds" });
      assert.deepEqual(again.json, { ok: true, checked: 0, settled: 0, released: 0, left: 0, throttled: true });
      assert.equal(W.calls.filter((c) => c.url.startsWith("https://queue.fal.run/")).length, 0);
      // only this op skips the sign-in
      assert.equal((await postNoAuth(TEXT("claude-opus-5-5"))).status, 401);
      assert.equal((await postNoAuth({ op: "reconcile_holds", task: "text" })).status, 401, "…and not dressed up as another task");
      // at most 50 a run: 55 more abandoned renders, all still running
      const reason = H.videoHoldReason({ appModel: "kling-3.0", resolution: "720p", endpoint: "fal-ai/kling-video/v3/standard/image-to-video" });
      for (let i = 0; i < 55; i++) {
        await svc("select public.turn_hold_credits($1, 1, $2, $3)", [U.producer.id, "video:bulk-" + i, reason]);
        await svc("select public.turn_hold_attach($1, $2)", ["video:bulk-" + i, "bulk-" + i]);
        W.fal["bulk-" + i] = { endpoint: "fal-ai/kling-video", status: "IN_PROGRESS" };
      }
      await db.query("update public.turn_credit_holds set created_at = now() - interval '3 hours' where ref like 'video:bulk-%'");
      await unthrottle(); W.calls = [];
      const big = await postNoAuth({ op: "reconcile_holds" });
      assert.equal(big.json.checked, 50, j(big.json)); assert.equal(big.json.left, 50);
      assert.equal(W.calls.filter((c) => /^https:\/\/queue\.fal\.run\/.+\/status$/.test(c.url)).length, 50);
      for (let i = 0; i < 55; i++) await svc("select public.turn_release_hold($1)", ["video:bulk-" + i]);
    });

    await test("F27 (round 2, S2) blender-bridge's reconcile_holds (no sign-in) settles answered-assistant and finished-mesh holds, releases failed / lost meshes; a released hold is re-held and settled", async () => {
      reset();
      let bb = null;
      const realServe = globalThis.Deno.serve;
      globalThis.Deno.serve = (h) => { bb = h; };
      try { await import(pathToFileURL(ROOT + "supabase/functions/blender-bridge/index.ts").href + "?instance=f27"); }
      finally { globalThis.Deno.serve = realServe; }
      assert.equal(typeof bb, "function", "blender-bridge loaded");
      const call = async (body) => { const res = await bb(new Request("https://example.supabase.co/functions/v1/blender-bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: j(body) })); return { status: res.status, json: await res.json() }; };
      const D = U.director.id, stat = async (ref) => (await db.query("select status, kept from public.turn_credit_holds where ref = $1", [ref])).rows[0];
      const mk = async (ref, held, pref) => { await svc("select public.turn_hold_credits($1, $2, $3, 'blender-studio')", [D, held, ref]); if (pref) await svc("select public.turn_hold_attach($1, $2)", [ref, pref]); };
      const ev = "studio-" + "8c2f0b6e-1111-4222-8333-944455556666";
      await mk("studio:e-done", 40, "mesh-done"); await mk("studio:e-failed", 40, "mesh-failed"); await mk("studio:e-lost", 40, "mesh-lost");
      await mk("studio:e-running", 40, "mesh-running"); await mk("studio:e-answer", 30, SR.answerProviderRef(ev, 12)); await mk("studio:e-fresh", 40, "mesh-fresh");
      await mk("studio:e-orphan", 25, null);
      // round 3 (S3): finished at fal, but with no GLB / a GLB off fal's hosts — the launcher would refund these
      await mk("studio:e-noglb", 40, "mesh-noglb"); await mk("studio:e-offhost", 40, "mesh-offhost");
      await db.query("update public.turn_credit_holds set created_at = now() - interval '2 hours' where ref like 'studio:e-%' and ref <> 'studio:e-fresh'");
      const meshResult = (body) => () => reply(200, body);
      Object.assign(W.fal, { "mesh-done": { endpoint: "meshy/v7/image-to-3d", status: "COMPLETED", result: meshResult({ model_glb: { url: "https://v3.fal.media/files/mesh-done.glb" } }) },
        "mesh-failed": { endpoint: "meshy/v7/image-to-3d", status: "FAILED" },
        "mesh-running": { endpoint: "meshy/v7/image-to-3d", status: "IN_PROGRESS" }, "mesh-fresh": { endpoint: "meshy/v7/image-to-3d", status: "COMPLETED" },
        "mesh-noglb": { endpoint: "meshy/v7/image-to-3d", status: "COMPLETED", result: meshResult({ thumbnail: { url: "https://v3.fal.media/files/t.png" } }) },
        "mesh-offhost": { endpoint: "meshy/v7/image-to-3d", status: "COMPLETED", result: meshResult({ model_glb: { url: "https://evil.example.com/m.glb" } }) } });
      // the 30-minute housekeeping release: a hold with no provider job goes back; an ANSWERED assistant's (tied) stays
      await svc("select public.turn_release_stale_holds(30)");
      assert.equal((await stat("studio:e-orphan")).status, "released"); assert.equal((await stat("studio:e-answer")).status, "held", "the answered assistant's hold survives the 30-minute release");
      const b0 = await bal(U.director);
      await unthrottle();
      const r = await call({ op: "reconcile_holds" });
      assert.equal(r.status, 200, j(r.json));
      assert.deepEqual([r.json.checked, r.json.settled, r.json.released, r.json.left], [7, 2, 4, 1], j(r.json));
      assert.deepEqual([(await stat("studio:e-done")).status, Number((await stat("studio:e-done")).kept)], ["settled", 40], "a finished mesh: its price (the hold)");
      assert.deepEqual([(await stat("studio:e-answer")).status, Number((await stat("studio:e-answer")).kept)], ["settled", 12], "an answered assistant: its reported cost");
      assert.equal((await stat("studio:e-failed")).status, "released"); assert.equal((await stat("studio:e-lost")).status, "released");
      assert.equal((await stat("studio:e-running")).status, "held"); assert.equal((await stat("studio:e-fresh")).status, "held");
      assert.equal((await stat("studio:e-noglb")).status, "released", "finished with no GLB: refunded, as the launcher would");
      assert.equal((await stat("studio:e-offhost")).status, "released", "a GLB off fal's hosts is never delivered: refunded");
      assert.ok(W.calls.some((c) => c.url === "https://queue.fal.run/meshy/v7/requests/mesh-done"), "the finished job's result was read");
      assert.equal(await bal(U.director), b0 + 40 + 40 + 18 + 40 + 40);
      assert.ok(W.calls.some((c) => c.url === "https://queue.fal.run/meshy/v7/requests/mesh-done/status"));
      assert.equal((await call({ op: "reconcile_holds" })).json.throttled, true, "throttled");
      // a settle that finds its hold RELEASED re-holds the actual cost and settles it — once, however often it's retried
      const A = createSupabaseAdapter({ createClient: globalThis.__chargingTestCreateClient, url: ENV.SUPABASE_URL, anonKey: ENV.SUPABASE_ANON_KEY, serviceKey: ENV.SUPABASE_SERVICE_ROLE_KEY });
      await mk("studio:e-rel", 30, null); await svc("select public.turn_release_hold('studio:e-rel')");
      const b1 = await bal(U.director);
      let s = await A.spendCredit({ uid: D, cost: 12, eventId: "e-rel", holdRef: "studio:e-rel" });
      assert.equal(s.ok, true, j(s)); assert.deepEqual([(await stat("studio:e-rel:rehold")).status, Number((await stat("studio:e-rel:rehold")).kept)], ["settled", 12]);
      s = await A.spendCredit({ uid: D, cost: 12, eventId: "e-rel", holdRef: "studio:e-rel" });
      assert.equal(s.ok, true); assert.equal(await bal(U.director), b1 - 12, "charged once");
      // not enough credits for the re-hold: a clear refusal (the task stays retryable), nothing taken
      await svc("select public.turn_set_plan_once($1, $2, 'director', 5, 'sub_o2', 'cus_o', $3)", ["evt-o2", U.other.id, future]);
      await svc("select public.turn_hold_credits($1, 3, 'studio:e-poor', 'blender-studio')", [U.other.id]); await svc("select public.turn_release_hold('studio:e-poor')");
      s = await A.spendCredit({ uid: U.other.id, cost: 400, eventId: "e-poor", holdRef: "studio:e-poor" });
      assert.equal(s.ok, false); assert.match(s.message, /needs 400 credits, but this account has \d+/);
    });

    await test("F28 (round 3, S1) metered text with ARRAY content is held for what the provider really receives — the verify-money T1 case", async () => {
      const big = "The quick brown fox jumps over the lazy dog. ".repeat(4500);   // ~200k characters, ~81k tokens
      const run = async (tok, who, body, url) => {
        reset();
        let sent = null;
        W.providers[url] = (_u, _m, b) => { sent = b; return null; };   // record, then the default stub answers
        const before = await bal(who);
        const r = await post(tok, body);
        const h = await lastHold(who);
        return { status: r.status, json: r.json, sent, held: h.held, charged: before - await bal(who) };
      };
      // Anthropic (the reproduced case): the whole text reaches the provider either way, and is held either way
      const A = (content) => run("tok-producer", U.producer, { ...TEXT("claude-opus-5-5"), messages: [{ role: "user", content }] }, "https://api.anthropic.com/v1/messages");
      const asString = await A(big), asArray = await A([big]);
      assert.equal(asString.status, 200, j(asString.json)); assert.equal(asArray.status, 200, j(asArray.json));
      assert.equal(asArray.sent.messages[0].content, big, "the provider receives the whole text");
      assert.equal(asArray.held, asString.held, "an array of strings is held like the same plain string (it was held for the output cap only)");
      assert.ok(asArray.held >= P.creditsFromUsd((P.estimateInputTokens([{ content: big }]) * 4 + 16000 * 20) / 1e6, 0.03), "the input is in the hold: " + asArray.held);
      // the charge is the provider's real cost, not capped by a too-small hold
      W.providers["https://api.anthropic.com/v1/messages"] = null;
      reset();
      W.providers["https://api.anthropic.com/v1/messages"] = () => reply(200, { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 81000, output_tokens: 2000 }, stop_reason: "end_turn" });
      const b0 = await bal(U.producer);
      const r = await post("tok-producer", { ...TEXT("claude-opus-5-5"), messages: [{ role: "user", content: [big] }] });
      const real = P.textActualCost("claude-opus-5-5", { inputTokens: 81000, outputTokens: 2000 }, { unit: 0.03 }).credits;
      assert.equal(r.json.usage.credits, real); assert.equal(b0 - await bal(U.producer), real, "charged " + real + " (round 2: capped at the output-only hold)");
      // every other provider branch: the same text sent, the same hold
      for (const [model, provider, url, pick] of [["gemini-3.8-flash", "google", "https://generativelanguage.googleapis.com/", (b) => b.contents[0].parts[0].text],
        ["gpt-5.5", "openai", "https://api.openai.com/v1/chat/completions", (b) => b.messages[0].content], ["kimi-k3", "moonshot", "https://api.moonshot.ai/v1/chat/completions", (b) => b.messages[0].content]]) {
        const s1 = await run("tok-producer", U.producer, { ...TEXT(model, provider), messages: [{ role: "user", content: big }] }, url);
        const s2 = await run("tok-producer", U.producer, { ...TEXT(model, provider), messages: [{ role: "user", content: [big] }] }, url);
        assert.equal(s2.status, 200, model + " " + j(s2.json)); assert.equal(pick(s2.sent), big, model + ": the whole text is sent");
        assert.equal(s2.held, s1.held, model + ": held alike");
      }
      // a message that isn't an object is refused before any hold or provider call
      reset(); const n0 = (await holdsOf(U.producer)).length;
      for (const messages of [[null], ["just a string"], [["nested"]]]) {
        const bad = await post("tok-producer", { ...TEXT("claude-opus-5-5"), messages });
        assert.equal(bad.status, 400, j(messages));
      }
      assert.equal((await holdsOf(U.producer)).length, n0); assert.equal(providerCalls("https://api.anthropic.com/").length, 0);
    });

    await test("F29 (round 3, S4) a TEMPORARY status failure on a poll (429 / 5xx / timeout / no connection) answers result_pending — the hold stays, the render goes on", async () => {
      reset(); W.falNextStatus = "IN_PROGRESS";
      const b = await bal(U.producer);
      const sub = await post("tok-producer", KLING());
      const sp = `https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/${sub.json.requestId}/status`;
      for (const [label, bad] of [["503", () => reply(503, { detail: "upstream connect error" })], ["429", () => reply(429, { detail: "rate limited" })], ["500", () => reply(500, {})],
        ["502", () => reply(502, "<html>bad gateway</html>")], ["no connection", () => { throw new TypeError("fetch failed"); }], ["timeout", () => { throw new DOMException("The operation timed out.", "TimeoutError"); }]]) {
        W.providers[sp] = bad;
        const q = await vpoll("tok-producer", sub);
        assert.equal(q.status, 200, label);
        assert.deepEqual([q.json.code, q.json.retry, q.json.status, q.json.videoUrl], ["result_pending", true, "IN_PROGRESS", undefined], label + " " + j(q.json));
        assert.doesNotMatch(q.json.error, /fal|kling|upstream|\d{3}/i, label + ": a calm sentence, no provider or status code");
        assert.equal((await providerRefOf(sub.json.requestId)).status, "held", label); assert.equal(await bal(U.producer), b - 21, label);
      }
      // a status failure that isn't temporary (401: the key) still ends the render with an error — and keeps the hold
      W.providers[sp] = () => reply(401, { detail: "Unauthorized" });
      const q401 = await vpoll("tok-producer", sub);
      assert.equal(q401.json.code, undefined); assert.equal(q401.json.status, 401); assert.equal((await providerRefOf(sub.json.requestId)).status, "held");
      // fal answers again: the render completes and is charged once
      delete W.providers[sp]; W.fal[sub.json.requestId].status = "COMPLETED";
      const done = await vpoll("tok-producer", sub);
      assert.equal(done.json.status, "COMPLETED"); assert.equal(done.json.usage.credits, 21); assert.equal(await bal(U.producer), b - 21);
    });

    await test("F30 (round 3, S5) an empty balance, or one below the cheapest default engine's one answer, hears 'add credits' — not 'choose a lighter engine'", async () => {
      reset();
      const have = await bal(U.other);   // a Director with a few credits left (F6 / F27)
      assert.ok(have >= 2, "have " + have);
      await svc("select public.turn_hold_credits($1, $2, 'test:s5-drain', 'test')", [U.other.id, have - 1]);
      assert.equal(await bal(U.other), 1);
      try {
        // 1 credit: a short prompt runs on the cheapest default engine, so the lighter-engine sentence is right
        const short = await post("tok-other", TEXT("claude-opus-5-5"));
        assert.equal(short.status, 402); assert.equal(short.json.suggest, "lighter_writing_engine");
        assert.match(short.json.message, /^This writing engine needs at least \d+ credits for one answer, but this account has 1 \(\d+ short\)\. Choose a lighter writing engine, or add credits\.$/);
        // …a prompt too long for even the cheapest engine's one answer on 1 credit: the plain refusal
        const long = [{ role: "user", content: "word ".repeat(30000) }];
        assert.ok(P.cheapestTextHold({ models: POL.DEFAULT_TEXT_MODELS, messages: long, unit: 0.03 }) > 1, "the precondition: no default engine runs on 1 credit");
        const r = await post("tok-other", { ...TEXT("claude-opus-5-5"), messages: long });
        assert.equal(r.status, 402); assert.equal(r.json.code, "insufficient_credits"); assert.equal(r.json.suggest, undefined);
        assert.match(r.json.message, /^This generation needs [\d,]+ credits, but this account has 1\.$/); assert.doesNotMatch(r.json.message, /lighter/i);
        // 0 credits: the plain refusal on any engine
        await svc("select public.turn_hold_credits($1, 1, 'test:s5-drain2', 'test')", [U.other.id]);
        assert.equal(await bal(U.other), 0);
        for (const [model, provider] of [["claude-opus-5-5", "anthropic"], ["gemini-3.8-flash", "google"], ["kimi-k2.7-code", "moonshot"]]) {
          const z = await post("tok-other", TEXT(model, provider));
          assert.equal(z.status, 402, model); assert.equal(z.json.code, "insufficient_credits", model); assert.equal(z.json.suggest, undefined, model);
          assert.match(z.json.message, /^This generation needs [\d,]+ credits?, but this account has 0\.$/, model + ": " + z.json.message);
        }
        assert.equal(providerCalls("https://api.anthropic.com/").length + providerCalls("https://generativelanguage.googleapis.com/").length + providerCalls("https://api.moonshot.ai/").length, 0, "no provider call");
      } finally {
        await svc("select public.turn_release_hold('test:s5-drain')"); await svc("select public.turn_release_hold('test:s5-drain2')");
      }
      assert.equal(await bal(U.other), have);
    });

    await test("F31 (round 3, S2) a FRAGMENTED reference video whose moov says 2 s is priced at the longest length allowed — never at the moov's word", async () => {
      const REF = (q) => ({ task: "video", op: "submit", model: "bytedance/seedance-2.0/reference-to-video", prompt: "@Image1 walks, moving like @Video1",
        image_urls: ["https://cdn.example.com/f.png"], video_urls: ["https://v3.fal.media/files/frag-ref.mp4"], duration: 5, resolution: "720p",
        referenceMetadata: { videos: [{ durationSeconds: 2, mime: "video/mp4", sizeBytes: 1000000 }] }, ...(q != null ? { quotedCredits: q } : {}) });
      const twoSeconds = P.creditsFromUsd(0.3034 * 0.6 * 7, 0.03), longest = P.creditsFromUsd(0.3034 * 0.6 * 20, 0.03);
      reset(); W.mp4["https://v3.fal.media/files/frag-ref.mp4"] = fragmentedMp4(2, 15);
      let r = await post("tok-producer", REF(twoSeconds));
      assert.equal(r.status, 409, j(r.json)); assert.equal(r.json.creditsRequired, longest);
      assert.deepEqual([r.json.reason, r.json.detail, r.json.lengthUnverified], ["length_unreadable", "unreadable", true]);
      assert.equal(providerCalls("https://queue.fal.run/").filter((c) => c.method === "POST").length, 0, "nothing submitted");
      // no quote (an older app): held at the longest length, never at the moov's 2 s
      reset(); W.mp4["https://v3.fal.media/files/frag-ref.mp4"] = fragmentedMp4(2, 15, { withMvex: false });
      r = await post("tok-producer", REF(null));
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.usage.credits, longest, "round 2 charged " + twoSeconds);
    });

    await test("F32 (round 3, S8) a variant spelling of a held job's id (dashes moved) can't miss the hold and be served — 400", async () => {
      reset(); W.falIdStyle = "uuid"; W.falNextStatus = "COMPLETED";
      await db.query("delete from public.turn_billing_state where key = 'server_video_billing'");   // the drain window is open
      const b = await bal(U.producer);
      const sub = await post("tok-producer", KLING()); const rid = sub.json.requestId;
      assert.ok(H.isUuidRequestId(rid), rid);
      const odd = rid.replace(/-/g, "").replace(/^(.{4})(.{24})(.{4})$/, "$1-$2-$3");
      W.fal[odd] = W.fal[rid];   // an upstream that parses ids leniently would find the same job
      const before = W.calls.length;
      const q = await post("tok-producer", { task: "video", op: "poll", model: KLING().model, statusUrl: strip(sub.json.statusUrl).replace(rid, odd) });
      assert.equal(q.status, 400, j(q.json)); assert.equal(q.json.videoUrl, undefined);
      assert.ok(!W.calls.slice(before).some((c) => c.url.includes(odd)), "nothing fetched for the variant");
      assert.equal((await providerRefOf(rid)).status, "held"); assert.equal(await bal(U.producer), b - 21);
      // the real id settles it once
      const ok = await vpoll("tok-producer", sub);
      assert.equal(ok.json.status, "COMPLETED"); assert.equal(ok.json.usage.credits, 21);
    });

    await test("F33 (round 4, S1) a writing request's images must BE images: a text file, a PDF, a video or audio is refused (400) before any hold or provider call, on every engine; a PNG still works", async () => {
      const b64 = (bytes) => Buffer.from(bytes).toString("base64");
      const PNG = "data:image/png;base64," + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      const pdf = b64(Buffer.from("%PDF-1.7\n%âã\n1 0 obj << /Type /Catalog >> endobj\n".repeat(50)));
      const BAD = {
        "text/plain": "data:text/plain;base64," + b64(Buffer.from("INT. LIGHTHOUSE - NIGHT. The keeper climbs. ".repeat(4000))),
        "application/pdf": "data:application/pdf;base64," + pdf,
        "video/mp4": "data:video/mp4;base64," + b64(mp4(5)),
        "audio/mpeg": "data:audio/mpeg;base64," + b64([...Buffer.from("ID3"), 4, 0, 0, 0, 0, 0, 0]),
        "audio/webm": "data:audio/webm;base64," + b64([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
        "a PDF labelled image/png": "data:image/png;base64," + pdf,
        "a link": "https://v3.fal.media/files/notes.pdf",
      };
      for (const [provider, model] of [["google", "gemini-3.8-flash"], ["openai", "gpt-5.5"], ["anthropic", "claude-opus-5-5"], ["moonshot", "kimi-k2.7-code"]]) {
        for (const [kind, src] of Object.entries(BAD)) {
          reset();
          const b0 = await bal(U.producer), h0 = (await holdsOf(U.producer)).length;
          const r = await post("tok-producer", TEXT(model, provider, { usageKind: "vision", images: [PNG, src] }));
          assert.equal(r.status, 400, `${provider} / ${kind}: ${j(r.json)}`); assert.equal(r.json.code, "bad_image");
          assert.match(r.json.error, /Only PNG, JPEG, WebP, GIF or HEIC images can be attached \(image 2\)/);
          assert.equal(W.calls.length, 0, `${provider} / ${kind}: no provider call`);
          assert.ok(!W.rpcs.some((x) => x[1] === H.HOLD_RPC), `${provider} / ${kind}: no hold`);
          assert.equal((await holdsOf(U.producer)).length, h0); assert.equal(await bal(U.producer), b0);
        }
      }
      // the verify-money r3gem case: a 3.6M-character document as "inline data" on Gemini 3.8 Flash — refused, not held as 4,800 tokens
      reset();
      const doc = "data:text/plain;base64," + "QUJD".repeat(900000);
      const g = await post("tok-producer", TEXT("gemini-3.8-flash", "google", { images: [doc] }));
      assert.equal(g.status, 400); assert.equal(providerCalls("https://generativelanguage.googleapis.com/").length, 0);
      // a trial account is refused the same way (the check comes before the plan gate and any Frances slot)
      reset();
      assert.equal((await post("tok-trial", TEXT("gemini-3.8-flash", "google", { images: [BAD["application/pdf"]] }))).status, 400);
      // a PNG still works: attached to the last turn as inline image data, held as one image
      reset();
      const ok = await post("tok-producer", TEXT("gemini-3.8-flash", "google", { usageKind: "vision", images: [PNG] }));
      assert.equal(ok.status, 200, j(ok.json)); assert.equal(ok.json.vision, true);
      const call = providerCalls("https://generativelanguage.googleapis.com/")[0];
      assert.deepEqual(call.body.contents.at(-1).parts[1], { inlineData: { mimeType: "image/png", data: PNG.split(",")[1] } });
      // THE DIRECT GOOGLE IMAGE ROUTE: the same allow-list, before any hold
      for (const src of [BAD["application/pdf"], BAD["text/plain"], BAD["video/mp4"]]) {
        reset();
        const h0 = (await holdsOf(U.producer)).length;
        const gi = await post("tok-producer", IMAGE("gemini-3.1-flash-image", "2K", "google", { images: [src] }));
        assert.equal(gi.status, 400, j(gi.json)); assert.equal(gi.json.code, "bad_image");
        assert.equal(W.calls.length, 0); assert.equal((await holdsOf(U.producer)).length, h0);
      }
      reset();
      const gok = await post("tok-producer", IMAGE("gemini-3.1-flash-image", "2K", "google", { images: [PNG] }));
      assert.equal(gok.status, 200, j(gok.json));
      assert.deepEqual(providerCalls("https://generativelanguage.googleapis.com/")[0].body.contents[0].parts[1], { inlineData: { mimeType: "image/png", data: PNG.split(",")[1] } });
    });

    await test("F34 (round 4, S2) 'a\\n' x 150,000 on gpt-6-astra is held at the long-context price for at least its pre-split piece count (it was held at 40%, at the normal price)", async () => {
      reset();
      const t = "a\n".repeat(150000);
      const r = await post("tok-producer", TEXT("gpt-6-astra", "openai", { messages: [{ role: "user", content: t }], maxCompletionTokens: 16000 }));
      assert.equal(r.status, 200, j(r.json));
      const hold = W.rpcs.find((x) => x[1] === H.HOLD_RPC)[2];
      const pieces = o200kPieces(t);
      assert.equal(pieces, 300000);
      assert.ok(hold.amount >= P.creditsFromUsd((pieces * 20 + 16000 * 75) / 1e6, 0.03), `held ${hold.amount}: covers 300,000 input tokens at $20 / 1M and 16,000 output at $75 / 1M`);
      assert.equal(hold.amount, P.textHoldEstimate({ model: "gpt-6-astra", messages: [{ role: "user", content: t }], outputCap: 16000, unit: 0.03 }).credits);
      assert.equal(W.calls.find((c) => c.url === "https://api.openai.com/v1/chat/completions").body.max_completion_tokens, 16000);
    });

    await test("F35 (round 5, S1) speech-to-text is held and settled on the recording's container duration — one word then silence, DTX, an empty backup transcript; bogus models, unreadable and over-long recordings are refused (400) before any hold", async () => {
      const EL_STT = "https://api.elevenlabs.io/v1/speech-to-text";
      const FAL_UP = "https://rest.alpha.fal.ai/storage/upload/initiate", FAL_SCRIBE = "https://queue.fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2";
      const charge03 = (secs) => P.creditsFromUsd((Math.ceil(secs - 1e-9) / 60) * 0.008, 0.03);
      const run = async (bytes, { answer = null, extra = {}, who = "producer" } = {}) => {
        reset();
        let sent = null;
        W.providers[EL_STT] = async (_u, _m, form) => { sent = form; return answer ? (typeof answer === "function" ? answer() : reply(200, answer)) : null; };
        const b0 = await bal(U[who]), holds0 = (await holdsOf(U[who])).length;
        const r = await post("tok-" + who, { task: "voice", op: "stt", audioB64: typeof bytes === "string" ? bytes : b64(bytes), mime: "audio/webm", ...extra });
        const hs = await holdsOf(U[who]);
        return { r, sent, h: hs.length > holds0 ? hs[hs.length - 1] : null, spent: b0 - await bal(U[who]) };
      };
      // ONE WORD, THEN SILENCE: a 300 s Chrome recording (the app's longest answer) whose transcript has one word at
      // 0.1-0.6 s — charged 300 s (round 4 charged the word's 1 s)
      const oneWord = { language_code: "en", text: "hello", words: [{ text: "hello", start: 0.1, end: 0.6, type: "word" }] };
      let x = await run(chromeWebm(300), { answer: oneWord });
      assert.equal(x.r.status, 200, j(x.r.json));
      assert.equal(x.h.held, charge03(300), "held on the container's 300 s");
      assert.equal(x.r.json.usage.credits, charge03(300), "charged the recording's length, not the last word's end");
      assert.ok(x.r.json.usage.credits > charge03(1)); assert.equal(x.spent, x.r.json.usage.credits); assert.equal(x.h.status, "settled");
      // the provider is sent the container that was READ (its type and extension), whatever the client said; the app's default model
      assert.equal(x.sent.get("model_id"), "scribe_v1");
      assert.equal(x.sent.get("file").name, "answer.webm"); assert.equal(x.sent.get("file").type, "audio/webm");
      const usageRow = (await db.query("select metadata from public.turn_usage_events where owner = $1 and task = 'voice' order by created_at desc limit 1", [U.producer.id])).rows[0];
      assert.equal(usageRow.metadata.container, "webm"); assert.equal(usageRow.metadata.containerSeconds, 300);
      // DTX: a few KB for five minutes — charged its container duration (the size-based hold saw ~10 s)
      const dtx = chromeWebm(300, { packet: (i) => (i % 20 === 0 ? OPUS_SILENCE : null) });
      x = await run(dtx, { answer: oneWord });
      assert.equal(x.r.json.usage.credits, charge03(299.62), "DTX: the container's 300 s"); assert.ok(dtx.length / 750 < 15, "a 6 kbps estimate would have held ~10 s");
      // a longer REPORTED duration counts, capped at the hold (the container) and logged; a shorter one never lowers it
      warns.length = 0;
      x = await run(chromeWebm(60), { answer: { text: "x", audio_duration_secs: 4000 } });
      assert.equal(x.r.json.usage.credits, charge03(60)); assert.ok(warns.some((w) => /\[billing\] stt_length_mismatch .* container_s=60 reported_s=4000/.test(w)), j(warns));
      x = await run(chromeWebm(60), { answer: { text: "x", audio_duration_secs: 2 } });
      assert.equal(x.r.json.usage.credits, charge03(60));
      // an EMPTY transcript is charged on both routes (the provider billed the audio)
      x = await run(chromeWebm(200), { answer: { text: "", words: [] } });
      assert.deepEqual([x.r.json.text, x.r.json.usage.credits, x.h.status], ["", charge03(200), "settled"]);
      reset();
      W.providers[EL_STT] = async () => reply(500, { detail: { message: "busy" } });
      W.providers[FAL_UP] = async () => reply(200, { upload_url: "https://v3.fal.media/upload/abc", file_url: "https://v3.fal.media/files/answer.ogg" });
      W.providers["https://v3.fal.media/upload/abc"] = async () => new Response("", { status: 200 });
      let falInput = null;
      W.providers[FAL_SCRIBE] = async (_u, m, body) => { if (m === "POST") falInput = body; return reply(200, { text: "" }); };
      let b0 = await bal(U.producer);
      let r = await post("tok-producer", { task: "voice", op: "stt", audioB64: b64(firefoxOgg(240)), mime: "audio/webm" });
      assert.equal(r.status, 200, j(r.json)); assert.equal(r.json.via, "fal"); assert.equal(r.json.text, "");
      assert.equal(r.json.usage.credits, charge03(240.0065), "the backup's empty transcript is charged (it used to be released: 0 for any silence)");
      assert.equal(b0 - await bal(U.producer), r.json.usage.credits); assert.equal((await lastHold(U.producer)).status, "settled");
      assert.equal(falInput.audio_url, "https://v3.fal.media/files/answer.ogg");
      const upload = W.calls.find((c) => c.url.startsWith(FAL_UP));
      assert.deepEqual([upload.body.content_type, upload.body.file_name], ["audio/ogg", "answer.ogg"], "the backup gets the container's type too");
      // Safari's fragmented MP4 and a WAV are read and charged by their length
      x = await run(safariMp4(42), { answer: oneWord });
      assert.equal(x.r.json.usage.credits, charge03(42.005)); assert.equal(x.sent.get("file").name, "answer.mp4");
      x = await run(pcmWav(90), { answer: oneWord });
      assert.equal(x.r.json.usage.credits, charge03(90)); assert.equal(x.sent.get("file").type, "audio/wav");
      // REFUSED (400) BEFORE ANY HOLD OR PROVIDER CALL: a model the app doesn't use, a container it can't read, a recording over 10 minutes
      for (const [bytes, extra, code] of [
        [chromeWebm(30), { modelId: "no-such-model" }, "model_not_allowed"],
        [chromeWebm(30), { modelId: "scribe_v1_experimental" }, "model_not_allowed"],
        [new Uint8Array(3000000).fill(7), {}, "audio_unreadable"],
        [chromeWebm(20, { lace: true }), {}, "audio_unreadable"],
        ["%%%not base64%%%", {}, "audio_unreadable"],
        [chromeWebm(361), {}, "audio_too_long"],
        [firefoxOgg(605), {}, "audio_too_long"],
        [pcmWav(370), {}, "audio_too_long"],
      ]) {
        x = await run(bytes, { answer: oneWord, extra });
        assert.equal(x.r.status, 400, j(x.r.json)); assert.equal(x.r.json.code, code, j(x.r.json));
        assert.equal(x.h, null, "no hold"); assert.equal(x.spent, 0);
        assert.equal(W.calls.filter((c) => c.url.startsWith("https://api.elevenlabs.io/") || c.url.startsWith("https://queue.fal.run/") || c.url.startsWith("https://rest.alpha.fal.ai/")).length, 0, "no provider call");
        assert.doesNotMatch(x.r.json.error, /ElevenLabs|fal|scribe|Scribe/);
      }
      assert.match((await run(chromeWebm(361))).r.json.error, /^That recording is longer than 6 minutes\. Record a shorter answer\.$/);
      assert.equal((await run(chromeWebm(330), { answer: oneWord })).r.status, 200, "a recorder that stops late is fine");
      // an accepted non-default model is passed on
      x = await run(chromeWebm(30), { answer: oneWord, extra: { modelId: "scribe_v2" } });
      assert.equal(x.r.status, 200); assert.equal(x.sent.get("model_id"), "scribe_v2");
      // the source says so: the backup's completed transcription always settles; no word timestamps anywhere
      const idx = read("supabase/functions/image-proxy/index.ts");
      assert.match(idx, /return await voiceDone\(\{ text: txt, via: "fal" \}, \{ sttSeconds: sttReportedSeconds\(fd\) \}\);/);
      assert.doesNotMatch(idx, /transcribed nothing/);
    });

    await test("F36 (round 4, S5) an attach the database REFUSES (mismatch) is logged '[billing] attach <ref> refused (<code>)' before hold_attach_failed", async () => {
      reset(); W.falNextStatus = "IN_QUEUE";
      const first = await post("tok-producer", KLING());
      assert.equal(first.status, 200, j(first.json));
      W.falSeq -= 1;   // the next job gets the SAME request id — already tied to the first job's hold
      const b0 = await bal(U.producer);
      warns.length = 0;
      const second = await post("tok-producer", KLING());
      assert.equal(second.json.code, "hold_attach_failed", j(second.json));
      const refused = warns.find((w) => /\[billing\] attach video:\S+ refused \(mismatch\)/.test(w));
      assert.ok(refused, j(warns));
      const ref = /attach (video:\S+) refused/.exec(refused)[1];
      assert.equal((await holdsOf(U.producer)).find((h) => h.ref === ref).status, "released");
      assert.equal(await bal(U.producer), b0, "refunded");
      assert.ok(!warns.some((w) => /\[billing\] attach .* failed/.test(w)), "not the no-answer line");
    });

    await test("F37 (round 4, owner decision) Motion Control / editing are HELD for a readable source's length x 1.1 + 1 s; a longer output is charged the hold, logged and recorded for the owner", async () => {
      const b64 = (bytes) => Buffer.from(bytes).toString("base64");
      const five = mp4Tracks({ mvhd: 5, tracks: [{ handler: "vide", tkhd: 5, mdhd: 5, stts: fps25(5) }] });
      const MC = (endpoint, video_url, extra = {}) => ({ task: "video", op: "submit", model: endpoint, image_url: "https://cdn.example.com/c.png", video_url, characterOrientation: "video",
        referenceMetadata: { videos: [{ durationSeconds: 5, mime: "video/mp4", sizeBytes: five.length }] }, ...extra });
      const PRO = "fal-ai/kling-video/v3/pro/motion-control", STD = "fal-ai/kling-video/v3/standard/motion-control";
      const finish = (sub, url, seconds) => { W.mp4[url] = mp4(seconds); W.fal[sub.json.requestId].videoUrl = url; W.fal[sub.json.requestId].status = "COMPLETED"; };
      // a 5 s motion video sent as a data URL, 1080p: held for 6.5 s (it was 30 s)
      reset(); W.falNextStatus = "IN_PROGRESS";
      const a = await post("tok-producer", MC(PRO, "data:video/mp4;base64," + b64(five)));
      assert.equal(a.status, 200, j(a.json));
      assert.equal(a.json.usage.credits, P.creditsFromUsd(0.168 * 6.5, 0.03)); assert.equal(a.json.usage.heldForLength, true);
      assert.equal(a.json.usage.expectedCredits, P.creditsFromUsd(0.168 * 5, 0.03));
      // round 5 (S3): fal gets the same bytes, as the proxy's server-only copy (named after the job's hold)
      const aRef = (await providerRefOf(a.json.requestId)).ref;
      assert.match(W.fal[a.json.requestId].input.video_url, new RegExp("^https://example\\.supabase\\.co/storage/v1/object/sign/turn-assets/_internal/video-snapshots/\\d{13}-" + aRef.slice(6) + "-0\\.mp4\\?token=t86400$"), "fal gets the same bytes, copied by the proxy");
      assert.deepEqual(Object.values(W.stored).map((st) => Buffer.from(st.bytes).equals(Buffer.from(five))), [true]);
      // …its output runs 9.3 s: charged the hold (never more), logged, recorded for the owner and in the usage row
      finish(a, "https://v3.fal.media/files/mc-9.mp4", 9.3);
      warns.length = 0;
      const pa = await vpoll("tok-producer", a, { model: PRO });
      assert.equal(pa.json.usage.credits, P.creditsFromUsd(0.168 * 6.5, 0.03), "capped at the hold");
      const holdRef = (await providerRefOf(a.json.requestId)).ref;
      assert.ok(warns.some((w) => w.includes(`[billing] length_mismatch ${holdRef} held=${P.creditsFromUsd(0.168 * 6.5, 0.03)} output_s=9.3`)), j(warns));
      assert.equal(W.grantFailures.length, 1);
      assert.deepEqual(W.grantFailures[0], { event_id: holdRef, event_type: "video.length_mismatch", reason: "length_mismatch", uid: U.producer.id,
        details: { held_credits: P.creditsFromUsd(0.168 * 6.5, 0.03), output_seconds: 9.3, output_credits: P.creditsFromUsd(0.168 * 10, 0.03), kind: "motion", request_id: a.json.requestId, endpoint: PRO } });
      const usageRow = (await db.query("select metadata from public.turn_usage_events where request_id = $1", [a.json.requestId])).rows[0];
      assert.equal(usageRow.metadata.lengthMismatch, true); assert.equal(usageRow.metadata.outputCredits, P.creditsFromUsd(0.168 * 10, 0.03));
      // the same source on fal's CDN, 720p (standard): held for 6.5 s worth; an honest 5 s output costs 5 s, nothing recorded
      reset(); W.falNextStatus = "IN_PROGRESS"; W.mp4["https://v3.fal.media/files/src-5.mp4"] = five;
      const b = await post("tok-producer", MC(STD, "https://v3.fal.media/files/src-5.mp4"));
      assert.equal(b.json.usage.credits, P.creditsFromUsd(0.126 * 6.5, 0.03), j(b.json));
      finish(b, "https://v3.fal.media/files/mc-5.mp4", 5.02);
      assert.equal((await vpoll("tok-producer", b, { model: STD })).json.usage.credits, P.creditsFromUsd(0.126 * 5, 0.03));
      assert.equal(W.grantFailures.length, 0);
      // a `stage:` upload (the account's own write-once staging folder) is sized the same way
      reset(); W.falNextStatus = "IN_PROGRESS";
      const staged = `${U.producer.id}/stage-tmp/${Date.now()}-video-device-abc123.mp4`;
      W.stored[staged] = { bytes: five, type: "video/mp4" };
      const c = await post("tok-producer", MC(PRO, "stage:" + staged));
      assert.equal(c.status, 200, j(c.json)); assert.equal(c.json.usage.credits, P.creditsFromUsd(0.168 * 6.5, 0.03));
      assert.match(W.fal[c.json.requestId].input.video_url, /\/_internal\/video-snapshots\//, "round 5: fal renders from the server-only copy");
      // round 5 (S3): a file in the project's own storage is COPIED (its owner could overwrite the original) and
      // sized by the copy's length like any other
      reset(); W.falNextStatus = "IN_PROGRESS";
      W.stored[`${U.producer.id}/p1/clip-5.mp4`] = { bytes: five, type: "video/mp4" };
      const projectUrl = `https://example.supabase.co/storage/v1/object/sign/turn-assets/${U.producer.id}/p1/clip-5.mp4?token=abc`;
      const d = await post("tok-producer", MC(PRO, projectUrl));
      assert.equal(d.json.usage.credits, P.creditsFromUsd(0.168 * 6.5, 0.03), j(d.json)); assert.equal(d.json.usage.heldForLength, true);
      assert.equal(d.json.usage.expectedCredits, P.creditsFromUsd(0.168 * 5, 0.03));
      assert.match(W.fal[d.json.requestId].input.video_url, /\/_internal\/video-snapshots\//);
      // unreadable (a host the proxy doesn't read) or fragmented: the maximum, as before
      reset(); W.falNextStatus = "IN_PROGRESS";
      assert.equal((await post("tok-producer", MC(PRO, "https://cdn.example.com/m5.mp4"))).json.usage.credits, P.creditsFromUsd(0.168 * 30, 0.03));
      reset(); W.falNextStatus = "IN_PROGRESS";
      assert.equal((await post("tok-producer", MC(PRO, "data:video/mp4;base64," + b64(fragmentedMp4(5, 5))))).json.usage.credits, P.creditsFromUsd(0.168 * 30, 0.03));
      // round 5 (S2): a compressed QuickTime movie (outer 3 s, the real 15 s deflated in cmov) is unreadable: the maximum
      reset(); W.falNextStatus = "IN_PROGRESS";
      const cm = await post("tok-producer", MC(PRO, "data:video/mp4;base64," + b64(cmovMp4(3, 15)), { referenceMetadata: { videos: [{ durationSeconds: 3, mime: "video/mp4", sizeBytes: 5000 }] } }));
      assert.equal(cm.status, 200, j(cm.json)); assert.equal(cm.json.usage.credits, P.creditsFromUsd(0.168 * 30, 0.03), "held at the maximum, not 3 s + the margin");
      assert.equal(cm.json.usage.heldForLength, false);
      // forged-but-consistent files are read by the round-3 rules (the largest duration declared): an mvhd that
      // says 1 s over 5 s tracks is held for 5 s + the margin, not 1 s
      reset(); W.falNextStatus = "IN_PROGRESS";
      const f = await post("tok-producer", MC(PRO, "data:video/mp4;base64," + b64(forgedMp4(1, 5))));
      assert.equal(f.json.usage.credits, P.creditsFromUsd(0.168 * 6.5, 0.03));
      // editing a 5 s source at 1080p: 6.5 s of output + 6.5 s of input (it was 30 + 30.2 = 4,205 credits at $0.01)
      reset(); W.falNextStatus = "IN_PROGRESS";
      const ED = { task: "video", op: "submit", model: "bytedance/seedance-2.5/reference-to-video", videoTask: "editing", prompt: "restyle @Video1",
        video_urls: ["data:video/mp4;base64," + b64(five)], resolution: "1080p", referenceMetadata: { videos: [{ durationSeconds: 5, mime: "video/mp4", sizeBytes: five.length }] } };
      const e = await post("tok-producer", ED);
      assert.equal(e.status, 200, j(e.json)); assert.equal(e.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * 13, 0.03));
      finish(e, "https://v3.fal.media/files/edit-5.mp4", 5);
      assert.equal((await vpoll("tok-producer", e, { model: ED.model })).json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * 10, 0.03), "settled at the output's 5 s + 5 s");
      // THE HOUSEKEEPING PATH records a longer output too (with the hold's owner)
      reset(); W.falNextStatus = "IN_PROGRESS"; W.mp4["https://v3.fal.media/files/src-5b.mp4"] = five;
      const g = await post("tok-producer", MC(PRO, "https://v3.fal.media/files/src-5b.mp4"));
      await backdate(g.json.requestId);
      finish(g, "https://v3.fal.media/files/mc-12.mp4", 12);
      await unthrottle();
      const rc = await postNoAuth({ op: "reconcile_holds" });
      assert.equal(rc.status, 200, j(rc.json));
      assert.deepEqual([(await providerRefOf(g.json.requestId)).status, Number((await providerRefOf(g.json.requestId)).kept)], ["settled", P.creditsFromUsd(0.168 * 6.5, 0.03)]);
      const rec = W.grantFailures.find((x) => x.details.request_id === g.json.requestId);
      assert.ok(rec, j(W.grantFailures)); assert.equal(rec.uid, U.producer.id); assert.equal(rec.reason, "length_mismatch"); assert.equal(rec.details.output_seconds, 12);
    });

    await test("F38 (round 5, S3) a video a render is sized or billed by is COPIED to a server-only snapshot and fal renders the copy: a swapped project file is still charged from the copy; stage: is copied; copies go on settle, release, a refused submit and after two days; a failed copy holds the maximum", async () => {
      const SNAP = "_internal/video-snapshots/";
      const snaps = () => Object.keys(W.stored).filter((k) => k.startsWith(SNAP));
      const clip = (secs) => mp4Tracks({ mvhd: secs, tracks: [{ handler: "vide", tkhd: secs, mdhd: secs, stts: fps25(secs) }] });
      const two = clip(2), five = clip(5), fifteen = clip(15);
      const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
      const finish = (sub, url, seconds) => { W.mp4[url] = mp4(seconds); W.fal[sub.json.requestId].videoUrl = url; W.fal[sub.json.requestId].status = "COMPLETED"; };
      const SD25 = "bytedance/seedance-2.5/reference-to-video";
      const REF = (url, extra = {}) => ({ task: "video", op: "submit", model: SD25, prompt: "a walk like @Video1", video_urls: [url], resolution: "1080p", duration: 5,
        referenceMetadata: { videos: [{ durationSeconds: 2, mime: "video/mp4", sizeBytes: two.length }] }, ...extra });
      const MC = (video_url, extra = {}) => ({ task: "video", op: "submit", model: "fal-ai/kling-video/v3/pro/motion-control", image_url: "https://cdn.example.com/c.png", video_url, characterOrientation: "video",
        referenceMetadata: { videos: [{ durationSeconds: 5, mime: "video/mp4", sizeBytes: five.length }] }, ...extra });
      const projectUrl = (path, token = "abc") => `https://example.supabase.co/storage/v1/object/sign/turn-assets/${path}?token=${token}`;

      // 1. THE VERIFIER'S R4-REF: a 2 s reference in the project's storage, overwritten with 15 s right after the read
      reset(); W.falNextStatus = "IN_PROGRESS";
      const refPath = `${U.producer.id}/p1/ref.mp4`;
      W.stored[refPath] = { bytes: two, type: "video/mp4" };
      let b0 = await bal(U.producer);
      const sub = await post("tok-producer", REF(projectUrl(refPath)));
      assert.equal(sub.status, 200, j(sub.json));
      assert.equal(sub.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * (5 + 2), 0.03), "billed on the 2 s it read");
      const hold1 = (await providerRefOf(sub.json.requestId)).ref;
      assert.deepEqual(snaps().map((k) => k.replace(/^_internal\/video-snapshots\/\d{13}-/, "")), [hold1.slice(6) + "-0.mp4"], "one copy, named after the job's hold");
      const falUrl = W.fal[sub.json.requestId].input.video_urls[0];
      assert.equal(falUrl, `https://example.supabase.co/storage/v1/object/sign/turn-assets/${snaps()[0]}?token=t86400`, "fal is handed the COPY's 24-hour signed URL, not the account's file");
      W.stored[refPath] = { bytes: fifteen, type: "video/mp4" };   // the owner overwrites the original
      assert.ok(same(new Uint8Array(await (await globalThis.fetch(projectUrl(refPath))).arrayBuffer()), fifteen), "the original now serves 15 s");
      assert.ok(same(new Uint8Array(await (await globalThis.fetch(falUrl)).arrayBuffer()), two), "…but what fal fetches is still the 2 s that was billed");
      finish(sub, "https://v3.fal.media/files/ref-5.mp4", 5);
      const p1 = await vpoll("tok-producer", sub, { model: SD25 });
      assert.equal(p1.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * (5 + 2), 0.03));
      assert.equal(b0 - await bal(U.producer), p1.json.usage.credits);
      assert.deepEqual(snaps(), [], "the copy is deleted once the hold settles");
      assert.ok(W.stored[refPath], "the account's own file is never touched");

      // 2. a `stage:` upload is copied (checked first, as before); a render fal reports FAILED releases its hold AND its copy
      reset(); W.falNextStatus = "IN_PROGRESS";
      const staged = `${U.producer.id}/stage-tmp/${Date.now()}-video-device-abc123.mp4`;
      W.stored[staged] = { bytes: five, type: "video/mp4" };
      const c = await post("tok-producer", MC("stage:" + staged));
      assert.equal(c.status, 200, j(c.json)); assert.equal(c.json.usage.heldForLength, true);
      assert.equal(snaps().length, 1); assert.ok(same(W.stored[snaps()[0]].bytes, five));
      assert.match(W.fal[c.json.requestId].input.video_url, /\/_internal\/video-snapshots\/\d{13}-[0-9a-f-]{36}-0\.mp4\?token=t86400$/);
      W.fal[c.json.requestId].status = "FAILED";
      const pc = await vpoll("tok-producer", c, { model: MC("").model });
      assert.equal((await providerRefOf(c.json.requestId)).status, "released", j(pc.json));
      assert.deepEqual(snaps(), [], "released → the copy goes"); assert.ok(W.stored[staged], "the staged upload itself stays (its own sweep removes it)");
      // a staged upload of ANOTHER account is refused before any copy or hold
      reset();
      const holds0 = (await holdsOf(U.producer)).length;
      const foreign = await post("tok-producer", MC(`stage:${U.director.id}/stage-tmp/${Date.now()}-video-device-x.mp4`));
      assert.notEqual(foreign.status, 200); assert.equal((await holdsOf(U.producer)).length, holds0, "no hold"); assert.deepEqual(snaps(), []);
      assert.ok(!W.events.includes("storage:copy"), "nothing copied");

      // 3. a submit that never reaches fal deletes its copies on the way out (here: the Stage's quote is far below the price)
      reset();
      const q = await post("tok-producer", MC("data:video/mp4;base64," + b64(five), { quotedCredits: 1 }));
      assert.equal(q.status, 409, j(q.json)); assert.deepEqual(snaps(), [], "the refused submit's copy is removed");
      assert.ok(W.removed.some((k) => k.startsWith(SNAP)));
      reset(); W.providers["https://queue.fal.run/fal-ai/kling-video/v3/pro/motion-control"] = async (_u, m) => (m === "POST" ? reply(422, { detail: "bad input" }) : null);
      const refused = await post("tok-producer", MC("data:video/mp4;base64," + b64(five)));
      assert.equal(refused.status, 200); assert.ok(refused.json.error); assert.deepEqual(snaps(), [], "fal refused the job: the copy is removed");

      // 4. A FAILED COPY IS NEVER AN UNBILLED READ: the video counts as unread — held (and billed) at the longest length allowed
      reset(); W.falNextStatus = "IN_PROGRESS"; W.failCopy = true;
      const clipPath = `${U.producer.id}/p1/clip-5.mp4`;
      W.stored[clipPath] = { bytes: five, type: "video/mp4" };
      const m = await post("tok-producer", MC(projectUrl(clipPath)));
      assert.equal(m.status, 200, j(m.json));
      assert.equal(m.json.usage.credits, P.creditsFromUsd(0.168 * 30, 0.03), "Motion Control: the maximum"); assert.equal(m.json.usage.heldForLength, false);
      assert.equal(m.json.usage.expectedCredits, P.creditsFromUsd(0.168 * 30, 0.03), "the account's original is never read instead (not even for the quote)");
      assert.equal(W.fal[m.json.requestId].input.video_url, projectUrl(clipPath), "fal gets the account's URL, as before");
      reset(); W.falNextStatus = "IN_PROGRESS"; W.failCopy = true;
      W.stored[refPath] = { bytes: two, type: "video/mp4" };
      const r4 = await post("tok-producer", REF(projectUrl(refPath)));
      assert.equal(r4.json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * (5 + 30.2), 0.03), "a reference: held for the longest input");
      W.stored[refPath] = { bytes: fifteen, type: "video/mp4" };
      finish(r4, "https://v3.fal.media/files/ref-5b.mp4", 5);
      assert.equal((await vpoll("tok-producer", r4, { model: SD25 })).json.usage.credits, P.creditsFromUsd(1.164 * 0.6 * (5 + 30.2), 0.03), "…and settled there: the 15 s swap is covered");
      // a signed URL that doesn't open for this account (a bad token) is never copied
      reset(); W.falNextStatus = "IN_PROGRESS";
      W.stored[clipPath] = { bytes: five, type: "video/mp4" };
      const bad = await post("tok-producer", MC(projectUrl(clipPath, "bad")));
      assert.equal(bad.json.usage.credits, P.creditsFromUsd(0.168 * 30, 0.03)); assert.ok(!W.events.includes("storage:copy"), "no copy without the caller's own access");

      // 5. THE HOUSEKEEPING PATH: an uncollected render settles and its copy goes; copies older than two days are swept
      reset(); W.falNextStatus = "IN_PROGRESS";
      const g = await post("tok-producer", MC("data:video/mp4;base64," + b64(five)));
      const gCopy = snaps()[0];
      const oldCopy = `${SNAP}${Date.now() - 3 * 86400000}-11111111-2222-4333-8444-555555555555-0.mp4`;
      const youngCopy = `${SNAP}${Date.now() - 1 * 86400000}-11111111-2222-4333-8444-666666666666-0.mp4`;
      W.stored[oldCopy] = { bytes: five, type: "video/mp4" }; W.stored[youngCopy] = { bytes: five, type: "video/mp4" };
      await backdate(g.json.requestId);
      finish(g, "https://v3.fal.media/files/mc-5b.mp4", 5);
      await unthrottle();
      const rc = await postNoAuth({ op: "reconcile_holds" });
      assert.equal(rc.status, 200, j(rc.json));
      assert.equal((await providerRefOf(g.json.requestId)).status, "settled");
      assert.ok(!W.stored[gCopy], "the settled render's copy is gone");
      assert.ok(!W.stored[oldCopy], "a copy older than two days is swept"); assert.ok(W.stored[youngCopy], "a younger one stays");
    });

    await test("F39 (round 5, S4) every image route refuses a prompt longer than 40,000 characters (400) before any hold or provider call — the direct Google route bills a prompt's tokens", async () => {
      assert.equal(P.IMAGE_PROMPT_MAX_CHARS, 40000);
      for (const [model, provider] of [["gemini-3-pro-image", "google"], ["gemini-3.1-flash-image", "google"], ["gemini-3-pro-image", "fal"]]) {
        reset();
        const holds0 = (await holdsOf(U.director)).length, b0 = await bal(U.director);
        const r = await post("tok-director", IMAGE(model, "1K", provider, { prompt: "a lighthouse at dusk ".repeat(2500).slice(0, 40001) }));
        assert.equal(r.status, 400, j(r.json)); assert.equal(r.json.code, "prompt_too_long");
        assert.match(r.json.error, /40,001 characters; at most 40,000/);
        assert.equal((await holdsOf(U.director)).length, holds0, "no hold"); assert.equal(await bal(U.director), b0);
        assert.equal(W.calls.filter((c) => /generativelanguage|queue\.fal\.run|fal\.run/.test(c.url)).length, 0, "no provider call");
      }
      reset();
      const ok = await post("tok-director", IMAGE("gemini-3-pro-image", "1K", "google", { prompt: "x".repeat(40000) }));
      assert.equal(ok.status, 200, j(ok.json)); assert.ok(!ok.json.error, j(ok.json));
    });

    await test("F16 THE SWITCH DAY: billing-switch.sql triples balances and the proxy prices in $0.01 from then on (no redeploy)", async () => {
      reset();
      const wBefore = await bal(U.writer), dBefore = await bal(U.director);
      // the day-0 deploys are confirmed first (the switch refuses without this marker: owner runbook)
      await db.query("insert into public.turn_billing_state(key, value, at) values ('server_video_billing', '{}'::jsonb, now() - interval '1 minute') on conflict (key) do update set at = excluded.at");
      // …and the switch also wants proof the new image-proxy is live: a hold it took after the marker
      assert.equal((await post("tok-producer", IMAGE("gemini-3.1-flash-image", "2K"))).status, 200);
      const sw = await db.exec(read("supabase/billing-switch.sql")).then(() => true, (e) => e.message);
      assert.equal(sw, true, "billing-switch.sql ran");
      assert.equal(await bal(U.writer), wBefore * 3); assert.equal(await bal(U.director), dBefore * 3);
      const after = await load("after-switch");   // a fresh instance; a warm one re-reads the regime within 30 s
      reset();
      const r = await post("tok-director", IMAGE("gemini-3.1-flash-image", "2K"), after);
      assert.equal(r.status, 200); assert.equal((await lastHold(U.director)).held, 12, "Nano Banana 2 at 2K: $0.12 → 12 credits at $0.01");
      const t = await post("tok-writer", TEXT("claude-opus-5-5"), after);
      assert.equal(t.json.usage.credits, 28, "the same $0.28 call now costs 28 credits");
      const v = await post("tok-producer", KLING(), after);
      assert.equal(v.json.usage.credits, 63, "5 s of Kling = $0.63 → 63 credits");
      // a video held before the switch and finished after it: the switch tripled its open hold, the settle keeps all of it
      assert.equal(H.videoSettleAmount(21, 0.03, 0.01), 63);
    });

    await test("F17 THE TRIAL (from the switch): 50 credits once after email confirmation, for writing on the default engines and draft images only", async () => {
      reset();
      const after = await load("trial");
      const r = await post("tok-trial", TEXT("claude-opus-5-5"), after);
      assert.equal(r.status, 200, j(r.json));
      const [row] = (await as(U.trial, "select * from public.turn_credit_balance()")).rows;
      assert.equal(row.trial, true); assert.equal(row.plan, "none"); assert.equal(Number(row.remaining), 50 - r.json.usage.credits);
      assert.equal((await post("tok-trial", IMAGE("gemini-nano-banana-2.1", "1K"), after)).status, 200, "a draft image");
      for (const body of [TEXT("claude-fable-5"), IMAGE("gemini-3.1-flash-image", "1K"), KLING(), { task: "voice", op: "stt", audioB64: "AAAA" }]) {
        const x = await post("tok-trial", body, after);
        assert.equal(x.status, 402, j(body)); assert.equal(x.json.code, "plan_required");
      }
      W.rpcs = []; await post("tok-trial", MUSE(), after); assert.deepEqual(franceRpcs(), [5], "Frances: 5 a day on a trial");
    });
  } finally {
    console.warn = realWarn; globalThis.fetch = realFetch; process.emitWarning = realEmit;
  }
}

/* ═════════════════════════════ the Blender section ═════════════════════════════ */
async function blenderSection() {
  await test("G1 prices in the live unit: a mesh is 120 credits at $0.01 (40 before the switch); the assistant at list prices with a bounded hold", () => {
    assert.equal(meshEstimate(false, false).credits, 120); assert.equal(meshEstimate(false, false, 0.03).credits, 40);
    assert.equal(meshEstimate(true, true).credits, 152); assert.ok(near(meshEstimate(true, true).providerCostUsd, 1.52));
    assert.equal(assistantEstimate("claude-fable-5", { inputTokens: 1e6, outputTokens: 1e6 }).credits, 6000, "Fable $10 / $50 (it billed $25 / $100)");
    assert.equal(assistantEstimate("claude-opus-5", { inputTokens: 1e6, outputTokens: 0 }).credits, 500);
    assert.equal(assistantEstimate("gpt-5.5-2026-04-23", { inputTokens: 0, outputTokens: 1e6 }).credits, 3000);
    assert.throws(() => assistantEstimate("claude-sonnet-9", {}), /Unsupported model/);
    assert.equal(assistantHoldCredits("claude-opus-5"), P.creditsFromUsd((ASSISTANT_MAX_INPUT_TOKENS * 5 + ASSISTANT_MAX_OUTPUT_TOKENS.claude * 25) / 1e6));
    assert.equal(assistantHoldCredits("gpt-6-astra"), P.creditsFromUsd((ASSISTANT_MAX_INPUT_TOKENS * 10 + ASSISTANT_MAX_OUTPUT_TOKENS.openai * 50) / 1e6));
    assert.equal(assistantHoldCredits("gpt-6-astra", 0.03), P.creditsFromUsd((ASSISTANT_MAX_INPUT_TOKENS * 10 + ASSISTANT_MAX_OUTPUT_TOKENS.openai * 50) / 1e6, 0.03));
    // the reply caps in index.ts are the ones the hold assumes
    const edge = read("supabase/functions/blender-bridge/index.ts");
    assert.ok(edge.includes(`max_tokens: ${ASSISTANT_MAX_OUTPUT_TOKENS.claude}`), "Claude cap"); assert.ok(edge.includes(`max_output_tokens: ${ASSISTANT_MAX_OUTPUT_TOKENS.openai}`), "OpenAI cap");
  });

  await test("G2 the capabilities estimate follows the adapter's live unit (an adapter without one keeps the anchor)", async () => {
    const hooks = { context: async () => ({ snapshot: { state: {} }, kind: "browser" }) };
    const contract = { validateWorkspace() {}, validateProposal() {} };
    const req = new Request("https://x/");
    for (const [adapter, credits] of [[{ creditUnit: async () => 0.03, atomicStudioSettlement: true }, 40], [{ creditUnit: async () => 0.01, atomicStudioSettlement: true }, 120], [{ atomicStudioSettlement: true }, 120], [{ creditUnit: async () => null, atomicStudioSettlement: true }, 120]]) {
      const out = await createStudioService({ contract, adapter, provider: {} }).handle(req, { action: "studio.capabilities" }, hooks);
      assert.equal(out.meshEstimate.credits, credits, j(Object.keys(adapter)));
    }
  });

  await test("G5 (repair) the mesh provider's queue words are normalized, a cancel is fal's PUT and reports whether fal accepted it; assistant calls time out", async () => {
    const edge = read("supabase/functions/blender-bridge/index.ts");
    // run the real getMesh / cancelMesh against a stubbed fetch (the provider object is plain TS)
    const m = await import("node:module");
    const body = m.stripTypeScriptTypes(edge);
    const start = body.indexOf("const provider = {"), end = body.indexOf("const relay = ");
    const calls = [];
    let status = "IN_PROGRESS", cancelStatus = 202;
    const fetchStub = async (url, init = {}) => {
      calls.push([String(url), init.method || "GET", !!init.signal]);
      if (/\/cancel$/.test(url)) return new Response("{}", { status: cancelStatus });
      if (/\/status$/.test(url)) return new Response(JSON.stringify({ status }), { status: 200 });
      return new Response(JSON.stringify({ model_glb: { url: "https://v3.fal.media/files/m.glb" } }), { status: 200 });
    };
    const provider = new Function("fetch", "falKey", "assistantKeys", "sceneBuilderProviderPrompt", body.slice(start, end) + "\nreturn provider;")(fetchStub, "k", {}, () => "");
    assert.deepEqual(await provider.getMesh("r1"), { status: "running" }, "IN_PROGRESS is a job being built, not a finished one");
    status = "IN_QUEUE"; assert.deepEqual(await provider.getMesh("r1"), { status: "queued" });
    status = "COMPLETED"; assert.equal((await provider.getMesh("r1")).status, "completed");
    status = "SOMETHING_NEW"; assert.equal((await provider.getMesh("r1")).status, "running", "unknown words never read as a failure");
    assert.deepEqual(await provider.cancelMesh("r1"), { cancelled: true });
    assert.deepEqual(calls.at(-1), ["https://queue.fal.run/meshy/v7/requests/r1/cancel", "PUT", true]);
    cancelStatus = 400; assert.deepEqual(await provider.cancelMesh("r1"), { cancelled: false }, "fal refuses the cancel of a job that already ran");
    assert.equal((edge.match(/signal: AbortSignal\.timeout\(380000\)/g) || []).length, 2, "both assistant provider calls time out under the wall clock");
    // the adapter ties a mesh hold to the provider's job id through the SQL contract
    const rpcs = [];
    const a = createSupabaseAdapter({ url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service",
      createClient: () => ({ rpc: async (name, args) => { rpcs.push([name, args]); return { data: { ok: true }, error: null }; } }) });
    assert.deepEqual(await a.attachHold({ holdRef: "studio:e1", providerRef: "req-7" }), { ok: true, code: "" });
    assert.deepEqual(rpcs, [["turn_hold_attach", { ref: "studio:e1", provider_ref: "req-7" }]]);
  });

  const mkAdapter = (W) => createSupabaseAdapter({
    url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service",
    createClient: (url, key, opts) => ({
      auth: { getUser: async (tok) => (W.users[tok] ? { data: { user: W.users[tok] }, error: null } : { data: { user: null }, error: { message: "bad" } }) },
      rpc: async (name, args) => { W.rpcs.push([key, name, args]); return W.rpc(name, args, key); },
      from: () => { const c = { select: () => c, eq: () => c, limit: () => Promise.resolve({ data: W.table || [], error: null }) }; return c; },
    }),
  });

  await test("G3 authorizeCredit: Director and up only (no trial, Writer or frozen account); the job's credits are HELD with ref studio:<event>", async () => {
    const W = { users: { t: { id: "u1" } }, rpcs: [], row: null, hold: null };
    W.rpc = (name, args) => {
      if (name === "turn_credit_balance") return { data: [W.row], error: null };
      if (name === "turn_hold_credits") return W.hold ? W.hold(args) : { data: { ok: true, held: args.amount, remaining: 500 }, error: null };
      return { data: null, error: { message: "unexpected " + name } };
    };
    const a = mkAdapter(W);
    W.row = { plan: "writer", remaining: 900 };
    assert.deepEqual(await a.authorizeCredit({ token: "t", cost: 40, eventId: "e1" }), { ok: false, code: "tier_required", message: "Blender Studio needs the Director plan." });
    W.row = { plan: "none", remaining: 900, trial: true };
    assert.equal((await a.authorizeCredit({ token: "t", cost: 40, eventId: "e1" })).code, "plan_required");
    W.row = { plan: "director", remaining: 900, frozen: true };
    assert.equal((await a.authorizeCredit({ token: "t", cost: 40, eventId: "e1" })).code, "account_frozen");
    W.row = { plan: "director", remaining: 10 };
    const low = await a.authorizeCredit({ token: "t", cost: 40, eventId: "e1" });
    assert.deepEqual([low.ok, low.code], [false, "insufficient_credits"]); assert.match(low.message, /needs 40 credits, but this account has 10/);
    W.row = { plan: "studio", remaining: 900 }; W.rpcs = [];
    const ok = await a.authorizeCredit({ token: "t", cost: 40, eventId: "e1" });
    assert.deepEqual(ok, { ok: true, remaining: 500, holdRef: "studio:e1" });
    assert.deepEqual(W.rpcs.find((r) => r[1] === "turn_hold_credits"), ["service", "turn_hold_credits", { uid: "u1", amount: 40, ref: "studio:e1", reason: "blender-studio" }]);
    W.hold = () => ({ data: { ok: false, code: "insufficient", remaining: 3 }, error: null });
    assert.equal((await a.authorizeCredit({ token: "t", cost: 40, eventId: "e2" })).code, "insufficient_credits");
    W.hold = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_hold_credits" } });
    assert.deepEqual(await a.authorizeCredit({ token: "t", cost: 40, eventId: "e3" }), { ok: true, remaining: 900 }, "before billing-v2.sql: the older atomic settlement stands");
    W.hold = () => ({ data: null, error: { message: "timeout" } });
    assert.equal((await a.authorizeCredit({ token: "t", cost: 40, eventId: "e4" })).code, "billing_unavailable");
    assert.equal((await a.authorizeCredit({ token: "nope", cost: 1, eventId: "e5" })).ok, false);
  });

  await test("G4 a held job settles its own hold (min(actual, held)) or releases it; the live unit comes from turn_credit_regime()", async () => {
    const W = { users: {}, rpcs: [] };
    W.rpc = (name) => {
      if (name === "turn_settle_hold") return { data: { ok: true, kept: 12, remaining: 88 }, error: null };
      if (name === "turn_release_hold") return { data: { ok: true }, error: null };
      if (name === "turn_credit_regime") return W.regime();
      return { data: null, error: { message: "unexpected" } };
    };
    const a = mkAdapter(W);
    assert.deepEqual(await a.spendCredit({ uid: "u1", cost: 12, eventId: "e1", holdRef: "studio:e1" }), { ok: true, remaining: 88, plan: null });
    assert.deepEqual(W.rpcs.pop(), ["service", "turn_settle_hold", { ref: "studio:e1", actual: 12 }]);
    assert.deepEqual(await a.releaseCredit({ holdRef: "studio:e1" }), { ok: true });
    assert.deepEqual(W.rpcs.pop(), ["service", "turn_release_hold", { ref: "studio:e1" }]);
    W.regime = () => ({ data: [{ switched: false, usd_per_credit: "0.03" }], error: null });
    assert.equal(await a.creditUnit(), 0.03);
    const b = mkAdapter(W);
    W.regime = () => ({ data: [{ switched: true, usd_per_credit: "0.01" }], error: null });
    assert.equal(await b.creditUnit(), 0.01);
    W.regime = () => ({ data: null, error: { message: "down" } });
    assert.equal(await b.creditUnit(), 0.01, "a switched answer is kept (the switch never goes back)");
    const c = mkAdapter(W);
    W.regime = () => ({ data: null, error: { code: "42883", message: "function public.turn_credit_regime() does not exist" } });
    assert.equal(await c.creditUnit(), 0.03, "before billing-v2.sql: the old unit");
    const d = mkAdapter(W);
    W.regime = () => ({ data: null, error: { message: "down" } });
    assert.equal(await d.creditUnit(), null, "unknown → the service refuses paid work rather than guess");
    const e = mkAdapter(W);
    W.regime = () => ({ data: [{ usd_per_credit: "0.5" }], error: null });
    assert.equal(await e.creditUnit(), null);
  });

  await test("G6 (round 2, S2) the Studio reconciliation: finished mesh → settled at its price, failed / lost → released, running → left, answered assistant → its reported cost", async () => {
    const mk = (o = {}) => {
      const S = { calls: [], settled: {}, released: [], claim: o.claim ?? true };
      const rows = o.rows || [];
      const rpc = async (name, args) => {
        S.calls.push([name, args]);
        if (name === "turn_claim_housekeeping") return { data: S.claim };
        if (name === "turn_open_provider_holds") return { data: rows.slice(0, args.max_rows) };
        if (name === "turn_settle_hold") { S.settled[args.ref] = args.actual; return { data: { ok: true, kept: args.actual } }; }
        if (name === "turn_release_hold") { S.released.push(args.ref); return { data: { ok: true } }; }
        return { error: { message: "unexpected " + name } };
      };
      return { S, rpc };
    };
    const ev = "studio-8c2f0b6e-1111-4222-8333-944455556666";
    assert.equal(SR.answerProviderRef(ev, 11.2), "studio-answer:" + ev + ":12"); assert.equal(SR.answerProviderRef(ev, 0), ""); assert.equal(SR.answerProviderRef("bad id", 5), "");
    assert.deepEqual(SR.parseAnswerProviderRef("studio-answer:" + ev + ":12"), { eventId: ev, credits: 12 }); assert.equal(SR.parseAnswerProviderRef("mesh-1"), null);
    const row = (ref, pref, held = 40) => ({ ref, owner: "u1", provider_ref: pref, held, reason: "blender-studio", created_at: "2026-09-30T00:00:00Z" });
    const st = { "m-done": "completed", "m-failed": "failed", "m-lost": "not_found", "m-run": "running", "m-queued": "queued", "m-flaky": "unknown" };
    const w = mk({ rows: [row("studio:a", "m-done"), row("studio:b", "m-failed"), row("studio:c", "m-lost"), row("studio:d", "m-run"), row("studio:e", "m-queued"),
      row("studio:f", "m-flaky"), row("studio:g", SR.answerProviderRef(ev, 12), 30), row("studio:h", SR.answerProviderRef(ev, 99), 30), row("video:x", "req-1", 63)] });
    const asked = [];
    const r = await SR.reconcileStudioHolds({ rpc: w.rpc, meshStatus: async (id) => { asked.push(id); return { state: st[id] }; } });
    assert.deepEqual(w.S.settled, { "studio:a": 40, "studio:g": 12, "studio:h": 30 }, "a finished mesh at its price; an answer at its reported cost, never above the hold");
    assert.deepEqual(w.S.released.sort(), ["studio:b", "studio:c"]);
    assert.deepEqual([r.body.checked, r.body.settled, r.body.released, r.body.left], [8, 3, 2, 3], j(r.body));
    assert.ok(!asked.includes("req-1"), "image-proxy's video holds are its own");
    assert.deepEqual(w.S.calls.find((c) => c[0] === "turn_claim_housekeeping")[1], { job: "blender-bridge_reconcile", every_seconds: 240 });
    assert.equal(w.S.calls.find((c) => c[0] === "turn_open_provider_holds")[1].ref_prefix, "studio:");
    // throttled: nothing; no provider key: meshes are left, answers still settle; 50 a run
    const t = mk({ claim: false, rows: [row("studio:a", "m-done")] });
    assert.equal((await SR.reconcileStudioHolds({ rpc: t.rpc, meshStatus: async () => ({ state: "completed" }) })).body.throttled, true);
    assert.deepEqual(Object.keys(t.S.settled), []);
    const nk = mk({ rows: [row("studio:a", "m-done"), row("studio:g", SR.answerProviderRef(ev, 12), 30)] });
    const nr = await SR.reconcileStudioHolds({ rpc: nk.rpc, meshStatus: null });
    assert.deepEqual(nk.S.settled, { "studio:g": 12 }); assert.equal(nr.body.left, 1);
    const many = mk({ rows: Array.from({ length: 70 }, (_, i) => row("studio:m" + i, "m-run" + i)) });
    const n = []; const mr = await SR.reconcileStudioHolds({ rpc: many.rpc, meshStatus: async (id) => { n.push(id); return { state: "running" }; } });
    assert.deepEqual([mr.body.checked, n.length], [50, 50]);
  });

  await test("G7 (round 2, S2) blender-bridge asks fal's queue for a mesh's state (404 = no such job) and answers reconcile_holds before the relay", async () => {
    const edge = read("supabase/functions/blender-bridge/index.ts");
    const m = await import("node:module");
    const body = m.stripTypeScriptTypes(edge);
    const mkProvider = new Function("fetch", "falKey", "assistantKeys", "sceneBuilderProviderPrompt", "meshResultState", body.slice(body.indexOf("const provider = {"), body.indexOf("const relay = ")) + "\nreturn provider;");
    const provider = (f, key, keys, prompt) => mkProvider(f, key, keys, prompt, SR.meshResultState);
    const seen = [];
    // code/json answer the STATUS; result = [code, json] answers the RESULT (round 3, S3: fetched on COMPLETED)
    const mkFetch = (code, json, result = [200, {}]) => async (url, init = {}) => {
      seen.push([String(url), !!init.signal]);
      if (code === "throw") throw new TypeError("fetch failed");
      if (!String(url).endsWith("/status")) { if (result[0] === "throw") throw new DOMException("timed out", "TimeoutError"); return new Response(JSON.stringify(result[1] || {}), { status: result[0] }); }
      return new Response(JSON.stringify(json || {}), { status: code });
    };
    const GLB = { model_glb: { url: "https://v3.fal.media/files/m.glb" } };
    const cases = [[404, null, "not_found"], [503, null, "unknown"], ["throw", null, "unknown"], [200, { status: "IN_QUEUE" }, "queued"], [200, { status: "IN_PROGRESS" }, "running"],
      [200, { status: "COMPLETED" }, "completed", [200, GLB]], [200, { status: "COMPLETED", error: "bad input" }, "failed"], [200, { status: "FAILED" }, "failed"], [200, { status: "NEW_WORD" }, "running"],
      // round 3 (S3): COMPLETED settles only with a GLB on a trusted fal host — as the launcher's own flow decides
      [200, { status: "COMPLETED" }, "failed", [200, {}]], [200, { status: "COMPLETED" }, "failed", [200, { model_glb: { url: "https://evil.example.com/m.glb" } }]],
      [200, { status: "COMPLETED" }, "failed", [200, { model_glb: { url: "http://v3.fal.media/m.glb" } }]], [200, { status: "COMPLETED" }, "failed", [200, { images: [{ url: "https://v3.fal.media/i.png" }] }]],
      [200, { status: "COMPLETED" }, "failed", [422, { detail: "validation error" }]], [200, { status: "COMPLETED" }, "not_found", [404, {}]],
      [200, { status: "COMPLETED" }, "unknown", [503, {}]], [200, { status: "COMPLETED" }, "unknown", [429, {}]], [200, { status: "COMPLETED" }, "unknown", ["throw"]]];
    for (const [code, json, want, result] of cases) assert.deepEqual(await provider(mkFetch(code, json, result), "k", {}, () => "").meshStatus("mesh-1"), { state: want }, `${code} ${j(json)} ${j(result)}`);
    assert.deepEqual(seen[0], ["https://queue.fal.run/meshy/v7/requests/mesh-1/status", true], "fal's queue path, with a timeout");
    assert.ok(seen.some(([u, sig]) => u === "https://queue.fal.run/meshy/v7/requests/mesh-1" && sig), "the result is fetched (with a timeout) only to check the GLB");
    assert.deepEqual(await provider(mkFetch(200, { status: "COMPLETED" }), "", {}, () => "").meshStatus("mesh-1"), { state: "unknown" }, "no key: nothing can be checked");
    assert.deepEqual(await provider(mkFetch(200, { status: "COMPLETED" }), "k", {}, () => "").meshStatus("../x"), { state: "unknown" });
    // the housekeeping op is answered before the relay (which needs a signed-in caller)
    assert.ok(/const housekeeping = await reconcileRequest\(request\);\s*if \(housekeeping\) return housekeeping;/.test(edge));
    assert.ok(edge.indexOf("reconcileRequest(request)") < edge.indexOf("return relay.handle(request)"));
  });

  await test("G8 (round 2, S2) a Studio settle that finds its hold RELEASED re-holds the actual cost and settles it, idempotently (never fails forever)", async () => {
    const W = { users: {}, rpcs: [], holds: { "studio:e1": { status: "released", held: 30 } }, balance: 100, frozen: false };
    W.rpc = (name, args) => {
      if (name === "turn_settle_hold") {
        const h = W.holds[args.ref];
        if (!h) return { data: { ok: false, code: "not_found" }, error: null };
        if (h.status === "released") return { data: { ok: false, duplicate: true, status: "released", code: "released", remaining: W.balance }, error: null };
        if (h.status === "settled") return { data: { ok: true, duplicate: true, status: "settled", kept: h.kept, remaining: W.balance }, error: null };
        const keep = Math.min(args.actual, h.held); W.balance += h.held - keep; h.status = "settled"; h.kept = keep;
        return { data: { ok: true, kept: keep, remaining: W.balance }, error: null };
      }
      if (name === "turn_hold_credits") {
        const h = W.holds[args.ref];
        if (h) return { data: { ok: h.status !== "released", duplicate: true, status: h.status, ...(h.status === "released" ? { code: "released" } : {}), remaining: W.balance }, error: null };
        if (W.frozen) return { data: { ok: false, code: "frozen" }, error: null };
        if (W.balance < args.amount) return { data: { ok: false, code: "insufficient", remaining: W.balance }, error: null };
        W.balance -= args.amount; W.holds[args.ref] = { status: "held", held: args.amount };
        return { data: { ok: true, held: args.amount, remaining: W.balance }, error: null };
      }
      return { data: null, error: { message: "unexpected " + name } };
    };
    const a = mkAdapter(W);
    let r = await a.spendCredit({ uid: "u1", cost: 12, eventId: "e1", holdRef: "studio:e1" });
    assert.equal(r.ok, true, j(r)); assert.equal(W.balance, 88); assert.deepEqual(W.holds["studio:e1:rehold"], { status: "settled", held: 12, kept: 12 });
    assert.deepEqual(W.rpcs.filter((x) => x[1] === "turn_hold_credits").map((x) => x[2]), [{ uid: "u1", amount: 12, ref: "studio:e1:rehold", reason: "blender-studio:rehold" }]);
    r = await a.spendCredit({ uid: "u1", cost: 12, eventId: "e1", holdRef: "studio:e1" });
    assert.equal(r.ok, true); assert.equal(W.balance, 88, "a retry charges nothing more");
    // the derived hold itself released meanwhile: the next derived ref
    W.holds["studio:e2"] = { status: "released", held: 30 }; W.holds["studio:e2:rehold"] = { status: "released", held: 12 };
    r = await a.spendCredit({ uid: "u1", cost: 12, eventId: "e2", holdRef: "studio:e2" });
    assert.equal(r.ok, true); assert.equal(W.holds["studio:e2:rehold2"].status, "settled"); assert.equal(W.balance, 76);
    // refusals say why, and stay retryable
    W.holds["studio:e3"] = { status: "released", held: 30 };
    r = await a.spendCredit({ uid: "u1", cost: 500, eventId: "e3", holdRef: "studio:e3" });
    assert.equal(r.ok, false); assert.match(r.message, /needs 500 credits, but this account has 76/);
    W.frozen = true; r = await a.spendCredit({ uid: "u1", cost: 5, eventId: "e3", holdRef: "studio:e3" });
    assert.match(r.message, /on hold while a payment is disputed/);
    // a settle that fails for another reason is NOT turned into a new hold
    W.holds["studio:e4"] = { status: "held", held: 30 }; const before = W.rpcs.length;
    const orig = W.rpc; W.rpc = (name, args) => (name === "turn_settle_hold" ? { data: { ok: false, code: "not_found" }, error: null } : orig(name, args));
    r = await a.spendCredit({ uid: "u1", cost: 5, eventId: "e4", holdRef: "studio:e4" });
    assert.equal(r.ok, false); assert.equal(W.rpcs.slice(before).filter((x) => x[1] === "turn_hold_credits").length, 0);
    // round 3 (S7): the refusal's numbers get thousands separators
    W.rpc = orig; W.frozen = false; W.balance = 300; W.holds["studio:e5"] = { status: "released", held: 30 };
    r = await a.spendCredit({ uid: "u1", cost: 1709, eventId: "e5", holdRef: "studio:e5" });
    assert.equal(r.ok, false); assert.match(r.message, /^This generation needs 1,709 credits, but this account has 300\. Add credits, then open it again\.$/);
  });

  await test("G9 (round 3, S3 + S7) a finished mesh's hold settles only when its result has the GLB the launcher would deliver, on a trusted fal host", async () => {
    const t = (url) => ({ url });
    assert.equal(SR.meshResultState({ model_glb: t("https://v3.fal.media/files/m.glb") }), "completed");
    assert.equal(SR.meshResultState({ animation_glb: t("https://fal.media/a.glb"), model_glb: t("https://evil.example.com/m.glb") }), "completed", "the animated file is the one delivered");
    assert.equal(SR.meshResultState({ animation_glb: t("https://evil.example.com/a.glb"), model_glb: t("https://v3.fal.media/m.glb") }), "failed", "the launcher checks the file it picks, not another");
    assert.equal(SR.meshResultState({ rigged_character_glb: t("https://v3.fal.media/r.glb") }), "failed", "an unrigged job delivers no rigged file alone");
    assert.equal(SR.meshResultState({ rigged_character_glb: t("https://evil.example.com/r.glb"), model_glb: t("https://v3.fal.media/m.glb") }), "failed", "a rigged job would pick the untrusted rigged file: both readings must deliver");
    for (const bad of [null, {}, { model_glb: null }, { model_glb: {} }, { model_glb: t("http://v3.fal.media/m.glb") }, { model_glb: t("https://user:pw@v3.fal.media/m.glb") }, { model_glb: t("https://fal.media.evil.com/m.glb") }, { images: [t("https://v3.fal.media/i.png")] }])
      assert.equal(SR.meshResultState(bad), "failed", j(bad));
    // ONE rule: the launcher picks its file with the same meshOutputFile and trusts it with the same isTrustedFalUrl
    assert.equal(SR.meshOutputFile({ rigged_character_glb: t("r"), model_glb: t("m") }, true).url, "r"); assert.equal(SR.meshOutputFile({ rigged_character_glb: t("r"), model_glb: t("m") }, false).url, "m");
    const svc = read("supabase/functions/blender-bridge/studio-service.mjs");
    assert.match(svc, /import \{ answerProviderRef, isTrustedFalUrl, meshOutputFile \} from "\.\/studio-reconcile\.mjs";/);
    assert.match(svc, /const file = meshOutputFile\(remote, !!task\.rigged\);\s*if \(!file \|\| !isTrustedFalUrl\(file\.url\)\) \{ task\.status = "failed"; task\.error = "Provider returned no trusted GLB\."; await releaseHold\(task\.holdRef\);/);
    assert.doesNotMatch(svc, /function isTrustedFalUrl/, "no second copy of the trust rule");
    // S7: the Studio's own refusals format their numbers
    const { formatCredits } = await import("../supabase/functions/blender-bridge/supabase-adapter.mjs");
    assert.deepEqual([999, 1000, 27000].map(formatCredits), ["999", "1,000", "27,000"]);
  });
}

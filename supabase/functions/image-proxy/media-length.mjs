/* media-length.mjs — the REAL length of an MP4 / MOV video, read from its header (billing
   fixes, repair F2, 2026-09-30; hardened in round 2). Pure and testable in Node
   (scripts/test-server-charging.mjs): no Deno or Supabase imports.

   WHY: fal bills some renders by the length of a video it was GIVEN (Kling Motion Control bills
   the motion video's seconds; Seedance "editing" and video references bill input + output
   seconds), and the browser's own duration probe can't be trusted for money. The proxy holds
   the most the validators allow, then settles from lengths it reads itself:
     - Motion Control and editing: ONLY from the finished render (fal's own output on the
       fal.media host) — a length read from the client's input file never lowers their charge;
     - Seedance video references: from each reference file the proxy can read safely (a data URL
       it already holds, a `stage:` upload in the caller's own storage folder, or a file on the
       fal.media host / this project's own storage — since round 5 (S3) always through image-proxy's
       server-only copy of it, video-snapshots.mjs, except fal's immutable CDN). It never fetches
       an arbitrary URL a client names.

   HOW: an MP4 is a list of boxes ([size u32][type 4cc], size 1 = a 64-bit size follows, size 0 =
   to the end of the file). `moov` is either before the media (`mdat`, "fast start") or after it,
   so the reader walks the top-level boxes with RANGED reads (normally the first 64 KB, then one
   read where `moov` starts) and then reads the whole `moov` (at most MOOV_MAX_BYTES).
   ROUND 2 (S4): the movie header `mvhd` alone is one field a user can edit, so the length is the
   MAXIMUM of every duration the file declares:
       mvhd (movie timescale), every track's tkhd (movie timescale), every track's mdhd (its own
       timescale), and every track's sample table — the sum of its stts deltas / the mdhd
       timescale (the timing a player actually follows; round 3 counts audio and every other
       track's table too, not only the video's).
   A file whose mvhd lies but whose tracks don't is read at the tracks' length.
   ROUND 3 (S2): a FRAGMENTED MP4 keeps its samples in movie fragments (top-level `moof` boxes,
   their `trun` tables) after a moov that only describes the start — its moov's durations say
   nothing about its real length (they can be 0, or any number the file's author likes). A moov
   with an `mvex` child (which every fragmented file must have), or a `moof` / `mfra` box
   anywhere at the top level (the walk continues past the moov to the end of the file to look),
   makes the file UNREADABLE.
   ROUND 4 (S3): the length now sizes the HOLD of Motion Control and editing (index.ts), so the
   reader must never read a file SHORTER than a demuxer that dispatches boxes by type, whatever
   their parent, would play it:
     - every box inside the moov is found, at any depth (a byte scan for box headers, which
       reaches every box a walk into its containers could, and one hidden inside a box that isn't
       a container — a sample description, a data box), and a fragment box (mvex, trex, mehd,
       moof, traf, trun, …) ANYWHERE in it — or outside it, at the top level — makes the file
       unreadable;
     - a timing box (mvhd, tkhd, mdhd, stts, ctts, stsz, stz2, elst) is read only at its own place;
       the same box anywhere else in the moov, twice in one track, or a table that claims more
       entries than its box holds (a demuxer reads on into the next box) makes it unreadable;
     - each track's EDIT LIST counts: the sum of its segment durations (empty edits included, in
       the movie timescale) is one more length the maximum is taken over;
     - a sample table with more samples (stsz) than its timing table (stts) covers is extended by
       its last delta over the rest, as a demuxer plays it;
     - a declared length of a day or more is unreadable (it used to be skipped as junk);
     - a walk that runs out of reads before the end of the file is unreadable, whether or not the
       host said how long the file is.
   ROUND 5 (S2): a QuickTime COMPRESSED movie header — `cmov` (holding `dcom` "zlib" and `cmvd`, a
   deflated moov) — is decompressed and played by a demuxer (ffmpeg's mov_read_cmov), but its boxes
   are invisible to a byte scan. A cmov, dcom or cmvd header anywhere in the moov (or at the top
   level), or a second moov header found inside the moov, makes the file unreadable.
   A length it can't read at all (no moov, a fragmented file, a server that ignores ranges past
   the start, a non-MP4 container) is null, with a reason:
       "format"     the file doesn't start like an MP4 / MOV
       "timeout"    a ranged read timed out twice (each read is retried once on a timeout)
       "unreadable" anything else
   — the caller then charges the most the validators allow, never less. */

const CHUNK = 64 * 1024;
const MAX_READS = 6;
const MAX_HOPS = 64;
/* The largest moov read in full. A 30 s clip's moov is a few KB to ~200 KB (its sample tables
   grow with the frame count); anything bigger than this is "unreadable" (held at the maximum). */
export const MOOV_MAX_BYTES = 4 * 1024 * 1024;
const MAX_BOXES = 20000;
const MAX_SECONDS = 24 * 3600;

const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const TOP_LEVEL_FIRST = new Set(["ftyp", "moov", "free", "skip", "wide", "mdat", "pnot"]);
/* Boxes only a fragmented file has (round 3, S2; round 4, S3 adds the rest of the family):
   movie fragments, their track runs and headers, the movie-extends box and its defaults, and the
   fragment index. Found anywhere — at the top level, inside the moov at any depth, or by the
   moov's byte scan — the file is unreadable. */
const FRAGMENT_BOXES = new Set(["moof", "mfra", "mvex", "trex", "mehd", "traf", "trun", "tfhd", "tfdt", "mfhd", "tfra", "mfro"]);
/* Timing boxes (round 4, S3): read only at their own place in the moov (mvhd in the moov, tkhd in
   a trak, elst in trak/edts, mdhd in trak/mdia, the tables in trak/mdia/minf/stbl). */
const TIMING_BOXES = new Set(["mvhd", "tkhd", "mdhd", "stts", "ctts", "stsz", "stz2", "elst"]);
const SAMPLE_TABLE_TIMING = new Set(["stts", "ctts", "stsz", "stz2"]);
/* Top-level boxes that make a file unreadable (round 4, S3): the fragment family, a timing box or
   a container a demuxer would walk into OUTSIDE the moov (it would read what they hold). */
/* A compressed movie header (round 5, S2): QuickTime's `cmov` holds `dcom` (the method, "zlib") and
   `cmvd` (the deflated moov). A demuxer inflates it and plays the movie inside, whose boxes a byte
   scan can't see — found anywhere in the moov (or a nested `moov` header), the file is unreadable. */
const COMPRESSED_BOXES = new Set(["cmov", "dcom", "cmvd"]);
const TOP_LEVEL_DENIED = new Set([...FRAGMENT_BOXES, ...TIMING_BOXES, ...COMPRESSED_BOXES, "trak", "mdia", "minf", "stbl", "edts", "udta", "meta", "sidx", "styp"]);

const sane = (s) => Number.isFinite(s) && s > 0 && s < MAX_SECONDS;
/* A "full box" duration: v0 = u32 (0xffffffff = unknown), v1 = u64 (all ones = unknown). */
function durationAt(b, o, version, end) {
  if (version === 1) {
    if (o + 8 > end) return null;
    if (u32(b, o) === 0xffffffff && u32(b, o + 4) === 0xffffffff) return null;
    return u64(b, o);
  }
  if (o + 4 > end) return null;
  const d = u32(b, o);
  return d === 0xffffffff ? null : d;
}

/* The boxes directly inside [start, end) of `b`: [{ type, start, body, end }] (bounded). */
function childBoxes(b, start, end, budget) {
  const out = [];
  let o = start;
  while (o + 8 <= end && budget.n-- > 0) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let head = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = u64(b, o + 8); head = 16;
    } else if (size === 0) {
      size = end - o;   // runs to the end of its parent
    }
    if (size < head || o + size > end) break;
    out.push({ type, start: o, body: o + head, end: o + size });
    o += size;
  }
  return out;
}

/* A BYTE SCAN of [start, end) for the headers of `types` (round 4, S3): every offset where one of
   the four-character codes sits behind a size that could frame a box there (0 = to the end of its
   parent, 1 = a 64-bit size follows, else 8 bytes or more that fit). → [{ type, start }]
   It is the recursive walk of every container in the moov, and more: every box a walk into any
   container, at any depth, could reach has exactly such a header, so the scan finds it — and it
   also finds one hidden inside a box that isn't a container (a sample description, a data box),
   which a demuxer that dispatches boxes by type would still read. */
function scanBoxHeaders(b, start, end, types) {
  const hits = [];
  const first = new Set([...types].map((t) => t.charCodeAt(0)));
  for (let p = start + 4; p + 4 <= end; p++) {
    if (!first.has(b[p])) continue;
    const type = fourcc(b, p);
    if (!types.has(type)) continue;
    const o = p - 4, size = u32(b, o);
    const fits = size === 0 || (size === 1 ? p + 12 <= end && u64(b, p + 4) >= 16 && o + u64(b, p + 4) <= end : size >= 8 && o + size <= end);
    if (fits) hits.push({ type, start: o });
  }
  return hits;
}

/**
 * Every duration a `moov` box declares, in seconds: { mvhd, tkhd: [], mdhd: [], stts: [], elst: [],
 * fragmented, unplaced }. `b` holds the moov BODY from `start` to `end`.
 *   compressed  (round 5, S2) a cmov / dcom / cmvd header, or a nested moov, anywhere in the moov:
 *               the movie a demuxer plays is one the reader can't see
 *   fragmented  a fragment box anywhere in the moov (its samples live in movie fragments: its
 *               durations don't count) — round 3 (S2) looked at the moov's own children only,
 *               round 4 (S3) at every depth and in a byte scan
 *   unplaced    a timing box the reader can't vouch for (round 4, S3): the same type anywhere but
 *               its own place, twice where one belongs, or a table that claims more entries than
 *               its box holds
 *   stts        each track's sample-table length, extended by its last delta over any samples
 *               stsz lists beyond the timing table (as a demuxer plays them)
 *   elst        each track's edit-list length (the sum of its segment durations, movie timescale)
 */
export function moovDurations(b, start = 0, end = b.length) {
  const found = { mvhd: null, tkhd: [], mdhd: [], stts: [], elst: [], fragmented: false, unplaced: false, compressed: false };
  const budget = { n: MAX_BOXES };
  const placed = new Set();   // the start of every timing box read at its own place
  let movieScale = 0, mvhds = 0;
  const tkhdRaw = [], elstRaw = [];
  // a declared length: 0 or "unknown" says nothing, but one past MAX_SECONDS (a day) can't be
  // vouched for (round 4, S3: a demuxer might play it — the file is unreadable, not read shorter)
  const add = (list, secs) => {
    if (!Number.isFinite(secs) || secs <= 0) return;
    if (secs >= MAX_SECONDS) { found.unplaced = true; return; }
    list.push(secs);
  };
  const fullCount = (box, head, entryBytes) => {
    // a full box's entry count, or null when its table claims more entries than the box holds
    if (box.end - box.body < head) return null;
    const count = u32(b, box.body + head - 4);
    return count <= Math.floor((box.end - box.body - head) / entryBytes) ? count : null;
  };
  for (const box of childBoxes(b, start, end, budget)) {
    if (box.type === "mvhd") {
      placed.add(box.start);
      if (++mvhds > 1) found.unplaced = true;   // two movie headers: which one a player takes is anyone's guess
      if (box.end - box.body < 20) continue;
      const v = b[box.body];
      const scaleAt = box.body + (v === 1 ? 20 : 12);
      if (scaleAt + 4 > box.end) continue;
      movieScale = u32(b, scaleAt);
      const d = durationAt(b, scaleAt + 4, v, box.end);
      if (movieScale > 0 && d != null) { const one = []; add(one, d / movieScale); if (one.length) found.mvhd = one[0]; }
    } else if (box.type === "trak") {
      let mediaScale = 0, sttsSum = null, sttsCount = 0, lastDelta = 0, stszCount = null;
      const seen = {};
      const once = (type) => { seen[type] = (seen[type] || 0) + 1; if (seen[type] > 1) found.unplaced = true; };
      for (const t of childBoxes(b, box.body, box.end, budget)) {
        if (t.type === "tkhd") {
          placed.add(t.start); once("tkhd");
          if (t.end - t.body < 24) continue;
          const v = b[t.body];
          const d = durationAt(b, t.body + (v === 1 ? 28 : 20), v, t.end);
          if (d != null) tkhdRaw.push(d);
        } else if (t.type === "edts") {
          once("edts");
          for (const e of childBoxes(b, t.body, t.end, budget)) {
            if (e.type !== "elst") continue;
            placed.add(e.start); once("elst");
            // an edit list: the sum of its segment durations (movie timescale), empty edits included
            const v = e.end - e.body >= 1 ? b[e.body] : 0;
            const count = fullCount(e, 8, v === 1 ? 20 : 12);
            if (count == null) { found.unplaced = true; continue; }
            let sum = 0;
            for (let i = 0, o = e.body + 8; i < count; i++, o += v === 1 ? 20 : 12) sum += v === 1 ? u64(b, o) : u32(b, o);
            elstRaw.push(sum);
          }
        } else if (t.type === "mdia") {
          once("mdia");
          for (const m of childBoxes(b, t.body, t.end, budget)) {
            if (m.type === "mdhd") {
              placed.add(m.start); once("mdhd");
              if (m.end - m.body < 20) continue;
              const v = b[m.body];
              const scaleAt = m.body + (v === 1 ? 20 : 12);
              if (scaleAt + 4 > m.end) continue;
              mediaScale = u32(b, scaleAt);
              const d = durationAt(b, scaleAt + 4, v, m.end);
              if (mediaScale > 0 && d != null) add(found.mdhd, d / mediaScale);
            } else if (m.type === "minf") {
              for (const s of childBoxes(b, m.body, m.end, budget)) {
                if (s.type !== "stbl") continue;
                once("stbl");
                for (const x of childBoxes(b, s.body, s.end, budget)) {
                  if (!SAMPLE_TABLE_TIMING.has(x.type)) continue;
                  placed.add(x.start); once(x.type === "stz2" ? "stsz" : x.type);
                  if (x.type === "stts") {
                    const count = fullCount(x, 8, 8);
                    if (count == null) { found.unplaced = true; continue; }
                    let sum = 0;
                    for (let i = 0, o = x.body + 8; i < count; i++, o += 8) {
                      const n = u32(b, o), delta = u32(b, o + 4);
                      sum += n * delta; sttsCount += n; lastDelta = delta;
                    }
                    sttsSum = sum;
                  } else if (x.type === "stsz") {
                    if (x.end - x.body < 12) { found.unplaced = true; continue; }
                    const constant = u32(b, x.body + 4);
                    const count = constant === 0 ? fullCount(x, 12, 4) : u32(b, x.body + 8);
                    if (count == null) { found.unplaced = true; continue; }
                    stszCount = count;
                  } else if (x.type === "stz2") {
                    if (x.end - x.body < 12) { found.unplaced = true; continue; }
                    const bits = b[x.body + 7], count = u32(b, x.body + 8);
                    if (![4, 8, 16].includes(bits) || Math.ceil((count * bits) / 8) > x.end - x.body - 12) { found.unplaced = true; continue; }
                    stszCount = count;
                  }
                }
              }
            }
          }
        }
      }
      // every track's sample table counts (round 3): a player plays the longest track; samples
      // stsz lists beyond the timing table play at its last delta (round 4, S3)
      if (sttsSum != null && stszCount != null && sttsCount > 0 && stszCount > sttsCount) sttsSum += (stszCount - sttsCount) * lastDelta;
      if (sttsSum != null && mediaScale > 0) add(found.stts, sttsSum / mediaScale);
    }
  }
  if (movieScale > 0) {
    for (const d of tkhdRaw) add(found.tkhd, d / movieScale);
    for (const d of elstRaw) add(found.elst, d / movieScale);
  } else if (elstRaw.some((d) => d > 0)) {
    found.unplaced = true;   // an edit list with no movie timescale to read it in
  }
  // every box in the moov, at any depth (the byte scan): a fragment box anywhere, a timing box
  // anywhere but the place it was read at, or (round 5, S2) a compressed movie header or a nested moov
  for (const hit of scanBoxHeaders(b, start, end, new Set([...FRAGMENT_BOXES, ...TIMING_BOXES, ...COMPRESSED_BOXES, "moov"]))) {
    if (FRAGMENT_BOXES.has(hit.type)) found.fragmented = true;
    else if (COMPRESSED_BOXES.has(hit.type) || hit.type === "moov") found.compressed = true;
    else if (!placed.has(hit.start)) found.unplaced = true;
  }
  if (budget.n <= 0) found.unplaced = true;   // too many boxes to vouch for
  return found;
}

/** The length a moov declares: the MAXIMUM of mvhd, every tkhd / mdhd, every stts sum and every
    edit list (or null: for a fragmented file — round 3, S2 — one with a timing box the reader
    can't place — round 4, S3 — or a compressed / nested movie header — round 5, S2). */
export function moovSeconds(b, start = 0, end = b.length) {
  const f = moovDurations(b, start, end);
  if (f.fragmented || f.unplaced || f.compressed) return null;
  const all = [f.mvhd, ...f.tkhd, ...f.mdhd, ...f.stts, ...f.elst].filter((s) => s != null && sane(s));
  return all.length ? Math.max(...all) : null;
}

class ReadTimeout extends Error {}

/**
 * The movie length through `readAt(offset, length)` → Promise<{ bytes: Uint8Array, total:
 * number | null }> (the bytes from `offset`, possibly fewer than asked near the end, and the file
 * size when known). → { seconds: number | null, reason: null | "format" | "timeout" | "unreadable" }
 */
export async function readMp4Info(readAt, { maxReads = MAX_READS } = {}) {
  let buf = null, bufStart = 0, total = null, reads = 0, outOfReads = false;
  const fail = (reason) => ({ seconds: null, reason });
  const have = (start, len) => buf && start >= bufStart && start + len <= bufStart + buf.length;
  const ensure = async (start, len) => {
    if (have(start, len)) return true;
    if (reads >= maxReads) { outOfReads = true; return false; }
    reads++;
    const r = await readAt(start, Math.max(len, CHUNK));
    if (!r || !(r.bytes instanceof Uint8Array)) return false;
    buf = r.bytes; bufStart = start;
    if (Number.isFinite(Number(r.total)) && Number(r.total) > 0) total = Number(r.total);
    return have(start, len);
  };
  // a box header at `off`: { size, type, head } (size 0 = to the end of the file)
  const header = async (off) => {
    if (!(await ensure(off, 8))) return null;
    let size = u32(buf, off - bufStart);
    const type = fourcc(buf, off - bufStart + 4);
    let head = 8;
    if (size === 1) {
      if (!(await ensure(off, 16))) return null;
      size = u64(buf, off - bufStart + 8); head = 16;
    }
    if (size !== 0 && size < head) return null;
    return { size, type, head };
  };
  try {
    let off = 0;
    let seconds = null;   // the moov's length, once read; the walk goes on to the end (round 3, S2)
    const done = () => (seconds != null ? { seconds, reason: null } : fail("unreadable"));
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (total != null && off + 8 > total) return done();   // the end of the file
      const box = await header(off);
      if (!box) {
        // running out of reads is never the end of the file (round 4, S3: a host that doesn't say
        // how long the file is could otherwise hide a fragment behind a few large boxes)
        if (outOfReads) return fail("unreadable");
        // past a moov on a server that doesn't say how long the file is, a read past the end
        // fails like any other read: that is the end of the file (a file size is known on every
        // host the proxy reads — data URLs, fal's CDN, this project's storage)
        if (seconds != null && total == null) return done();
        return fail(hop === 0 && buf && buf.length < 8 && total != null ? "format" : "unreadable");
      }
      if (hop === 0 && !TOP_LEVEL_FIRST.has(box.type)) return fail("format");   // not an MP4 / MOV
      // a fragmented file (the moov's length says nothing), or a box outside the moov a demuxer
      // would read timing from (round 4, S3)
      if (TOP_LEVEL_DENIED.has(box.type)) return fail("unreadable");
      if (box.type === "moov") {
        if (seconds != null) return fail("unreadable");   // two movies in one file: nothing to trust
        const bodyStart = off + box.head;
        const size = box.size === 0 ? (total != null ? total - off : null) : box.size;
        if (size == null || size - box.head <= 0 || size > MOOV_MAX_BYTES) return fail("unreadable");
        if (!(await ensure(bodyStart, size - box.head))) return fail("unreadable");
        const s = moovSeconds(buf, bodyStart - bufStart, bodyStart - bufStart + size - box.head);
        if (s == null) return fail("unreadable");
        seconds = s;
      }
      if (box.size === 0) return done();   // a box that runs to the end of the file
      off += box.size;
    }
    return fail("unreadable");   // too many boxes to reach the end: the file can't be vouched for
  } catch (e) {
    return fail(e instanceof ReadTimeout ? "timeout" : "unreadable");
  }
}

/** The movie length in seconds (or null) — readMp4Info without the reason. */
export async function readMp4Duration(readAt, opts = {}) {
  return (await readMp4Info(readAt, opts)).seconds;
}

/** { seconds, reason } for a video held in memory (a data URL's bytes). */
export async function mp4InfoFromBytes(bytes) {
  const all = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!all.length) return { seconds: null, reason: "format" };
  return readMp4Info(async (start, len) => ({ bytes: all.subarray(start, start + len), total: all.length }));
}
/** The length of a video held in memory (a data URL's bytes), or null. */
export async function mp4DurationFromBytes(bytes) {
  return (await mp4InfoFromBytes(bytes)).seconds;
}

/* Read at most `max` bytes of a response body, then stop the download. */
async function readLimited(res, max) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) return new Uint8Array(await res.arrayBuffer()).subarray(0, max);
  const parts = []; let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length;
  }
  try { await reader.cancel(); } catch (_e) { /* already closed */ }
  const out = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const p of parts) { const take = Math.min(p.length, out.length - o); out.set(p.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}

const isTimeout = (e) => !!e && (e.name === "TimeoutError" || e.name === "AbortError" || e instanceof ReadTimeout);

/**
 * { seconds, reason } for the video at `url`, read with ranged GETs (each with its own timeout,
 * retried ONCE when it times out). The caller decides which hosts may be read (isFalMediaUrl /
 * its own storage) — this function fetches whatever it is given.
 */
export async function probeMp4Info(url, { fetchImpl = fetch, timeoutMs = 8000, maxReads = MAX_READS } = {}) {
  const once = async (start, len) => {
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=${start}-${start + len - 1}` },
      ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (res.status === 206) {
      const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(res.headers.get("content-range") || "").trim());
      if (!m || Number(m[1]) !== start) { try { await res.body?.cancel(); } catch (_e) { /* noop */ } return null; }
      return { bytes: await readLimited(res, len), total: m[3] === "*" ? null : Number(m[3]) };
    }
    if (res.status === 200 && start === 0) {
      const size = Number(res.headers.get("content-length"));
      return { bytes: await readLimited(res, len), total: Number.isFinite(size) && size > 0 ? size : null };
    }
    try { await res.body?.cancel(); } catch (_e) { /* noop */ }
    return null;   // a failed read, or a server that ignores ranges past the start
  };
  const readAt = async (start, len) => {
    for (let attempt = 0; ; attempt++) {
      try { return await once(start, len); }
      catch (e) {
        if (!isTimeout(e)) throw e;
        if (attempt >= 1) throw new ReadTimeout("read timed out twice");
      }
    }
  };
  try { return await readMp4Info(readAt, { maxReads }); } catch (_e) { return { seconds: null, reason: "unreadable" }; }
}

/** The length of the video at `url` (or null) — probeMp4Info without the reason. */
export async function probeMp4Duration(url, opts = {}) {
  return (await probeMp4Info(url, opts)).seconds;
}

/** An https URL on fal's media CDN (where finished renders live). */
export function isFalMediaUrl(u) {
  try {
    const url = new URL(String(u || ""));
    return url.protocol === "https:" && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"));
  } catch (_e) { return false; }
}

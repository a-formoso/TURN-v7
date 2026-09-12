/* Character-orbit export — deliberately buildless/browser-only.
 *
 * This file has one public global, CharacterOrbitExport.  It does not start a
 * download and it does not retain image pixels between frames.  PNGs are kept
 * as Blobs only when they are needed for the final ZIP.
 */
(function (root) {
  "use strict";

  var FRAME_COUNT = 288;
  var DEFAULT_FPS = 24;
  var VIDEO_LOOKAHEAD = 8;
  var VIDEO_PREP_MAX_BYTES = 2 * 1024 * 1024;
  var MAX_STAGING_BYTES = 192 * 1024 * 1024;
  var MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
  var MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
  var ANGLE_STEP = 360 / FRAME_COUNT;
  var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

  function doc() {
    return root && root.document ? root.document : null;
  }

  function blobConstructor() {
    if (root && typeof root.Blob === "function") return root.Blob;
    if (typeof Blob === "function") return Blob;
    return null;
  }

  function makeBlob(parts, type) {
    var Ctor = blobConstructor();
    if (!Ctor) throw new Error("This browser cannot create export files (Blob is unavailable).");
    return new Ctor(parts, { type: type || "" });
  }

  function now() {
    if (root && root.performance && typeof root.performance.now === "function") {
      return root.performance.now();
    }
    return Date.now();
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      (root.setTimeout || setTimeout)(resolve, Math.max(0, ms || 0));
    });
  }

  function isCancelled(opts) {
    return !!(opts && typeof opts.shouldCancel === "function" && opts.shouldCancel());
  }

  function checkCancelled(opts) {
    if (isCancelled(opts)) throw new Error("Character orbit export cancelled.");
  }

  /*
   * A frame provider can be a network-backed promise.  Polling the caller's
   * cancellation hook while waiting means an export does not remain stuck on
   * one expired image request.  The provider's promise cannot be forcibly
   * cancelled, but it is no longer observed or used after this returns.
   */
  function awaitCancelable(value, opts) {
    var promise;
    try {
      promise = Promise.resolve(value);
    } catch (err) {
      return Promise.reject(err);
    }
    var watchVisibility = !!(doc() && typeof doc().visibilityState === "string");
    if ((!opts || typeof opts.shouldCancel !== "function") && !watchVisibility) return promise;
    return new Promise(function (resolve, reject) {
      var finished = false;
      var timer = null;
      function finish(fn, result) {
        if (finished) return;
        finished = true;
        if (timer !== null) (root.clearInterval || clearInterval)(timer);
        fn(result);
      }
      promise.then(function (result) {
        finish(resolve, result);
      }, function (err) {
        finish(reject, err);
      });
      timer = (root.setInterval || setInterval)(function () {
        var cancelled = false;
        try { cancelled = isCancelled(opts); } catch (err) {
          finish(reject, err);
          return;
        }
        if (cancelled) finish(reject, new Error("Character orbit export cancelled."));
        else {
          try { checkVisible(); } catch (visibilityErr) { finish(reject, visibilityErr); }
        }
      }, 40);
    });
  }

  function notify(opts, phase, done, total) {
    if (opts && typeof opts.onProgress === "function") {
      opts.onProgress({ phase: phase, done: done, total: total });
    }
  }

  function memoryLimitError(kind, used, limit) {
    var usedMiB = Math.ceil(used / (1024 * 1024));
    var limitMiB = Math.floor(limit / (1024 * 1024));
    return new Error(
      "This browser stopped the " + kind + " export before it could allocate more than " +
      limitMiB + " MiB of staged media (" + usedMiB + " MiB requested). " +
      "Use lower-resolution/quality source frames, or export a smaller saved PNG subset " +
      "in separate batches; this browser cannot safely stream the full set without risking a tab crash."
    );
  }

  function assertStagingBudget(used, kind) {
    if (used > MAX_STAGING_BYTES) throw memoryLimitError(kind, used, MAX_STAGING_BYTES);
  }

  function assertSourceDimensions(image, kind) {
    if (image.width * image.height > MAX_SOURCE_PIXELS) {
      throw new Error(
        "The " + kind + " source image is larger than this browser can safely stage (" +
        Math.round(image.width) + "×" + Math.round(image.height) +
        "). Use a lower-resolution source or export smaller PNG batches."
      );
    }
  }

  function visibilityError() {
    return new Error(
      "Character orbit video export stopped because the browser tab became hidden. " +
      "Keep this tab visible and awake, then export again; hidden tabs can silently drop video frames."
    );
  }

  function checkVisible() {
    var d = doc();
    if (d && d.visibilityState === "hidden") throw visibilityError();
  }

  function videoSupport() {
    var d = doc();
    var MR = root && root.MediaRecorder;
    if (typeof MR !== "function") {
      return { video: false, videoMime: "", error: "Video export is unsupported here: MediaRecorder is unavailable. PNG frame export remains available." };
    }
    if (!d || typeof d.createElement !== "function") {
      return { video: false, videoMime: "", error: "Video export is unsupported here: this browser has no Canvas surface. PNG frame export remains available." };
    }
    var canvas;
    try { canvas = d.createElement("canvas"); } catch (err) { canvas = null; }
    if (!canvas || typeof canvas.captureStream !== "function") {
      return { video: false, videoMime: "", error: "Video export is unsupported here: Canvas captureStream is unavailable. PNG frame export remains available." };
    }
    var candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    var supported = "";
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (typeof MR.isTypeSupported !== "function" || MR.isTypeSupported(candidates[i])) {
          supported = candidates[i];
          break;
        }
      } catch (err2) {}
    }
    if (!supported) {
      return { video: false, videoMime: "", error: "Video export is unsupported here: MediaRecorder reports no MP4 or WebM format. PNG frame export remains available." };
    }
    return { video: true, videoMime: supported };
  }

  function support() {
    var result = videoSupport();
    return {
      video: !!result.video,
      videoMime: result.videoMime || "",
      error: result.error
    };
  }

  function isBlobLike(value) {
    return !!(value && typeof value === "object" &&
      typeof value.arrayBuffer === "function" && typeof value.type === "string");
  }

  function isDrawable(value) {
    return !!(value && typeof value === "object" &&
      (typeof value.naturalWidth === "number" || typeof value.videoWidth === "number" ||
       typeof value.width === "number") &&
      (typeof value.naturalHeight === "number" || typeof value.videoHeight === "number" ||
       typeof value.height === "number"));
  }

  function imageElement() {
    var d = doc();
    var image = null;
    if (d && typeof d.createElement === "function") {
      try { image = d.createElement("img"); } catch (err) { image = null; }
    }
    if (!image && root && typeof root.Image === "function") {
      try { image = new root.Image(); } catch (err2) { image = null; }
    }
    return image;
  }

  async function drawableFrom(value, opts) {
    if (isDrawable(value)) {
      return {
        source: value,
        width: Number(value.naturalWidth || value.videoWidth || value.width),
        height: Number(value.naturalHeight || value.videoHeight || value.height),
        close: function () {}
      };
    }
    if (!value) throw new Error("The frame provider returned no image.");

    var objectUrl = "";
    var bitmap = null;
    var image = null;
    try {
      if (isBlobLike(value) && root && typeof root.createImageBitmap === "function") {
        try {
          bitmap = await awaitCancelable(root.createImageBitmap(value), opts);
          if (bitmap) {
            return {
              source: bitmap,
              width: Number(bitmap.width),
              height: Number(bitmap.height),
              close: function () {
                try { if (typeof bitmap.close === "function") bitmap.close(); } catch (err) {}
              }
            };
          }
        } catch (bitmapErr) {
          if (bitmapErr && /cancelled/i.test(String(bitmapErr.message || bitmapErr))) throw bitmapErr;
          /* The object-URL/Image path below is a useful Safari fallback. */
          bitmap = null;
        }
      }
      image = imageElement();
      if (!image) throw new Error("This browser cannot decode an orbit frame (Image is unavailable).");
      if (isBlobLike(value)) {
        if (!root || !root.URL || typeof root.URL.createObjectURL !== "function") {
          throw new Error("This browser cannot decode Blob orbit frames (object URLs are unavailable).");
        }
        objectUrl = root.URL.createObjectURL(value);
      } else if (typeof value === "string") {
        objectUrl = value;
      } else {
        throw new Error("Frame provider must return an image URL, data URL, or Blob.");
      }
      image.decoding = "async";
      try { image.crossOrigin = "anonymous"; } catch (err3) {}
      await awaitCancelable(new Promise(function (resolve, reject) {
        var settled = false;
        function done(fn, arg) {
          if (settled) return;
          settled = true;
          fn(arg);
        }
        image.onload = function () { done(resolve); };
        image.onerror = function () { done(reject, new Error("The browser could not decode this orbit frame.")); };
        try { image.src = objectUrl; } catch (srcErr) { done(reject, srcErr); }
      }), opts);
      var width = Number(image.naturalWidth || image.videoWidth || image.width);
      var height = Number(image.naturalHeight || image.videoHeight || image.height);
      if (!(width > 0 && height > 0)) throw new Error("The browser decoded an orbit frame with no dimensions.");
      return {
        source: image,
        width: width,
        height: height,
        close: function () {
          try { image.onload = null; image.onerror = null; image.src = ""; } catch (err4) {}
          if (objectUrl && root && root.URL && typeof root.URL.revokeObjectURL === "function") {
            try { root.URL.revokeObjectURL(objectUrl); } catch (err5) {}
          }
        }
      };
    } catch (err6) {
      if (objectUrl && root && root.URL && typeof root.URL.revokeObjectURL === "function") {
        try { root.URL.revokeObjectURL(objectUrl); } catch (err7) {}
      }
      if (bitmap && typeof bitmap.close === "function") {
        try { bitmap.close(); } catch (err8) {}
      }
      throw err6;
    }
  }

  function canvasFor(width, height) {
    var d = doc();
    if (!d || typeof d.createElement !== "function") {
      throw new Error("This browser cannot convert orbit frames: Canvas is unavailable.");
    }
    var canvas = d.createElement("canvas");
    if (!canvas) throw new Error("This browser cannot convert orbit frames: Canvas is unavailable.");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    var context = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!context || typeof context.drawImage !== "function") {
      throw new Error("This browser cannot convert orbit frames: a 2D Canvas context is unavailable.");
    }
    return { canvas: canvas, context: context };
  }

  function canvasBlob(canvas, type, quality) {
    if (!canvas || typeof canvas.toBlob !== "function") {
      throw new Error("This browser cannot encode orbit video frames: Canvas.toBlob is unavailable.");
    }
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error("Canvas could not encode an orbit frame."));
          else resolve(blob);
        }, type, quality);
      } catch (err) { reject(err); }
    });
  }

  function canvasPng(canvas) {
    return canvasBlob(canvas, "image/png");
  }

  async function ensurePng(blob) {
    if (!blob || typeof blob.arrayBuffer !== "function") {
      throw new Error("Canvas returned an invalid PNG Blob.");
    }
    var type = String(blob.type || "").toLowerCase();
    var bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    for (var i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        throw new Error("Canvas did not return a real PNG frame; refusing to label another format as .png.");
      }
    }
    if (type && type !== "image/png") {
      throw new Error("Canvas returned " + type + " for a PNG frame; refusing a mismatched .png file.");
    }
    return type === "image/png" ? blob : makeBlob([blob], "image/png");
  }

  async function pngForFrame(index, descriptor, opts) {
    checkCancelled(opts);
    var supplied;
    try {
      supplied = await awaitCancelable(opts.loadFrame(descriptor.loadIndex), opts);
    } catch (err) {
      if (err && /cancelled/i.test(String(err.message || err))) throw err;
      throw new Error("Could not load orbit frame " + (index + 1) + ": " + (err && err.message ? err.message : String(err)));
    }
    checkCancelled(opts);
    var image = await drawableFrom(supplied, opts);
    try {
      assertSourceDimensions(image, "orbit frame");
      var surface = canvasFor(image.width, image.height);
      surface.context.drawImage(image.source, 0, 0, image.width, image.height);
      return await ensurePng(await awaitCancelable(canvasPng(surface.canvas), opts));
    } finally {
      image.close();
    }
  }

  function normalizedFps(run) {
    var fps = Number(run && run.fps);
    return fps > 0 && isFinite(fps) ? fps : DEFAULT_FPS;
  }

  function safeNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function cleanValue(value, depth, seen) {
    if (depth > 6) return "[depth limit]";
    if (value === null || value === undefined) return value;
    var kind = typeof value;
    if (kind === "string" || kind === "number" || kind === "boolean") return value;
    if (kind === "bigint") return String(value);
    if (kind !== "object") return String(value);
    if (seen.indexOf(value) >= 0) return "[circular]";
    seen.push(value);
    var result;
    if (Array.isArray(value)) {
      result = value.map(function (entry) { return cleanValue(entry, depth + 1, seen); });
    } else {
      result = {};
      Object.keys(value).forEach(function (key) {
        result[key] = cleanValue(value[key], depth + 1, seen);
      });
    }
    seen.pop();
    return result;
  }

  function metadataFor(run) {
    var supplied = run && run.metadata && typeof run.metadata === "object" ? run.metadata : {};
    var metadata = cleanValue(supplied, 0, []);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) metadata = {};
    metadata.id = run && run.id != null ? String(run.id) : "";
    metadata.characterName = run && run.characterName != null ? String(run.characterName) : "";
    metadata.pose = cleanValue(run && run.pose, 0, []);
    metadata.settings = cleanValue(run && run.settings, 0, []);
    return metadata;
  }

  function angleFor(slot, record) {
    var angle = record && safeNumber(record.angle, NaN);
    if (!isFinite(angle)) angle = slot * ANGLE_STEP;
    return Math.round(angle * 1000000) / 1000000;
  }

  function descriptorsFor(run) {
    if (!run || !Array.isArray(run.frames)) {
      throw new Error("This character orbit has no saved frames to export.");
    }
    var list = run.frames;
    var hasZero = list.some(function (frame) { return frame && Number(frame.index) === 0; });
    var has288 = list.some(function (frame) { return frame && Number(frame.index) === FRAME_COUNT; });
    var allIndexed = list.length > 0 && list.every(function (frame) {
      return frame && frame.index != null && frame.index !== "";
    });
    /*
     * The saved-run API historically accepted both array-style 0…287 indexes
     * and UI slot-style 1…288 indexes.  A full run is unambiguous.  For a
     * subset, an angle of 0 on index 1 identifies the slot-style form; an
     * angle of 1.25 on index 1 identifies the array-style form.  If angle
     * metadata is absent, retain the useful 1…288 convention for subsets
     * without index zero.
     */
    var explicitAngles = list.filter(function (frame) {
      return frame && frame.index != null && isFinite(Number(frame.angle));
    });
    var oneAngleMatches = explicitAngles.length > 0 && explicitAngles.every(function (frame) {
      return Math.abs(Number(frame.angle) - (Number(frame.index) - 1) * ANGLE_STEP) < 0.00001;
    });
    var zeroAngleMatches = explicitAngles.length > 0 && explicitAngles.every(function (frame) {
      return Math.abs(Number(frame.angle) - Number(frame.index) * ANGLE_STEP) < 0.00001;
    });
    var oneBased = allIndexed && (has288 || (!hasZero && (oneAngleMatches || (!zeroAngleMatches && list.length > 0))));
    var slots = {};
    var descriptors = [];
    list.forEach(function (record, position) {
      if (!record || typeof record !== "object") {
        throw new Error("Saved orbit frame " + (position + 1) + " has invalid metadata.");
      }
      var raw = record.index;
      var numeric = raw == null || raw === "" ? position : Number(raw);
      if (!isFinite(numeric) || Math.floor(numeric) !== numeric) {
        throw new Error("Saved orbit frame " + (position + 1) + " has an invalid index.");
      }
      var slot = oneBased ? numeric - 1 : numeric;
      if (slot < 0 || slot >= FRAME_COUNT || Math.floor(slot) !== slot) {
        throw new Error("Saved orbit frame index " + numeric + " is outside the 288-frame sequence.");
      }
      if (slots[slot]) throw new Error("Saved orbit frame index " + numeric + " is duplicated.");
      var descriptor = {
        slot: slot,
        loadIndex: raw == null || raw === "" ? slot : raw,
        angle: angleFor(slot, record),
        id: record.id == null ? "" : String(record.id),
        filename: "frame-" + String(slot + 1).padStart(4, "0") + ".png"
      };
      slots[slot] = descriptor;
      descriptors.push(descriptor);
    });
    descriptors.sort(function (a, b) { return a.slot - b.slot; });
    return { descriptors: descriptors, slots: slots, oneBased: oneBased };
  }

  function requireAll(selection) {
    var missing = [];
    for (var i = 0; i < FRAME_COUNT; i++) {
      if (!selection.slots[i]) missing.push(i + 1);
    }
    if (missing.length) {
      var sample = missing.slice(0, 8).map(function (n) { return String(n).padStart(4, "0"); }).join(", ");
      throw new Error(
        "Video and bundle exports require all 288 orbit frames; " + missing.length +
        " frame" + (missing.length === 1 ? " is" : "s are") +
        " missing (" + sample + (missing.length > 8 ? ", …" : "") +
        "). Export the saved PNG subset or complete the orbit first."
      );
    }
  }

  function manifestFor(run, descriptors, fps) {
    var exported = descriptors.length;
    var frames = descriptors.map(function (descriptor) {
      return {
        index: descriptor.slot,
        id: descriptor.id,
        angle: descriptor.angle,
        filename: descriptor.filename
      };
    });
    return {
      format: "character-orbit",
      version: 1,
      id: run && run.id != null ? String(run.id) : "",
      characterName: run && run.characterName != null ? String(run.characterName) : "",
      pose: cleanValue(run && run.pose, 0, []),
      settings: cleanValue(run && run.settings, 0, []),
      angle: ANGLE_STEP,
      angleStep: ANGLE_STEP,
      angleUnit: "degrees",
      framecount: exported,
      frameCount: exported,
      expectedFramecount: FRAME_COUNT,
      expectedFrameCount: FRAME_COUNT,
      completed: exported,
      complete: exported === FRAME_COUNT,
      incomplete: exported !== FRAME_COUNT,
      missingFrameCount: FRAME_COUNT - exported,
      savedRunCompleted: run && run.completed != null ? run.completed : exported,
      fps: fps,
      metadata: metadataFor(run),
      frames: frames
    };
  }

  function jsonBlob(value) {
    var json;
    try {
      json = JSON.stringify(value, null, 2) + "\n";
    } catch (err) {
      throw new Error("The orbit metadata could not be written to manifest.json: " + err.message);
    }
    return makeBlob([json], "application/json");
  }

  function utf8(text) {
    if (root && typeof root.TextEncoder === "function") {
      return new root.TextEncoder().encode(String(text));
    }
    var encoded = unescape(encodeURIComponent(String(text)));
    var bytes = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
    return bytes;
  }

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var bit = 0; bit < 8; bit++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function zipStore(entries, opts) {
    if (entries.length > 65535) throw new Error("The orbit ZIP has too many files for ZIP32.");
    var estimatedSize = 22;
    entries.forEach(function (entry) {
      var nameSize = utf8(entry.name).length;
      estimatedSize += 30 + nameSize + Number(entry.blob && entry.blob.size || 0);
      estimatedSize += 46 + nameSize;
    });
    if (estimatedSize > MAX_ARCHIVE_BYTES) {
      throw memoryLimitError("ZIP", estimatedSize, MAX_ARCHIVE_BYTES);
    }
    var local = [];
    var central = [];
    var offset = 0;
    for (var i = 0; i < entries.length; i++) {
      checkCancelled(opts);
      var entry = entries[i];
      var name = utf8(entry.name);
      var bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (bytes.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error("The orbit export is too large for ZIP32.");
      }
      var checksum = crc32(bytes);
      var size = bytes.byteLength;
      if (offset + size + 30 + name.length > MAX_ARCHIVE_BYTES) {
        throw memoryLimitError("ZIP", offset + size + 30 + name.length, MAX_ARCHIVE_BYTES);
      }
      /* UTF-8 names (bit 11), method 0 = stored. */
      var localHeader = new Uint8Array(30 + name.length);
      var lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint32(14, checksum, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(name, 30);
      local.push(localHeader, entry.blob);
      var centralHeader = new Uint8Array(46 + name.length);
      var cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint32(16, checksum, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      centralHeader.set(name, 46);
      central.push(centralHeader);
      offset += localHeader.length + size;
    }
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    if (offset > 0xffffffff || centralSize > 0xffffffff) throw new Error("The orbit export is too large for ZIP32.");
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return makeBlob(local.concat(central, [end]), "application/zip");
  }

  function slug(value) {
    var text = String(value == null ? "" : value).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return text || "character-orbit";
  }

  function videoExtension(mime) {
    return /^video\/mp4(?:;|$)/i.test(mime) ? "mp4" :
      (/^video\/webm(?:;|$)/i.test(mime) ? "webm" : "");
  }

  function canvasDimensions(width, height) {
    var scale = Math.min(1, 1080 / Math.max(width, height));
    var w = Math.max(2, Math.round(width * scale));
    var h = Math.max(2, Math.round(height * scale));
    /* Most MP4/WebM encoders are happiest with even dimensions. */
    if (w % 2) w--;
    if (h % 2) h--;
    return { width: Math.max(2, w), height: Math.max(2, h), scale: scale };
  }

  function drawVideoFrame(surface, image) {
    var context = surface.context;
    var canvas = surface.canvas;
    var scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    var width = image.width * scale;
    var height = image.height * scale;
    context.fillStyle = "#000";
    if (typeof context.fillRect === "function") context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image.source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  async function compressedVideoFrame(canvas, opts) {
    /*
     * The source has already been downscaled to the <=1080 video surface.
     * Re-encode as JPEG before MediaRecorder starts so slow signed-URL reads
     * and image decoding never consume the 24fps recording clock.  A few
     * quality passes keep unusually detailed frames from retaining enormous
     * encoded intermediates; the dimensions are the hard upper bound.
     */
    var qualities = [0.84, 0.70, 0.56, 0.42];
    var blob = null;
    for (var i = 0; i < qualities.length; i++) {
      checkCancelled(opts);
      blob = await awaitCancelable(canvasBlob(canvas, "image/jpeg", qualities[i]), opts);
      var type = String(blob && blob.type || "").toLowerCase();
      if (type && type !== "image/jpeg" && type !== "image/png") {
        throw new Error("Canvas returned " + type + " while preparing a video frame.");
      }
      if (blob && blob.size <= VIDEO_PREP_MAX_BYTES) break;
    }
    if (!blob) throw new Error("Canvas could not prepare a compressed video frame.");
    return String(blob.type || "").toLowerCase() ? blob : makeBlob([blob], "image/jpeg");
  }

  async function prepareVideoFrames(run, selection, opts, sourceEntries) {
    var descriptors = [];
    for (var i = 0; i < FRAME_COUNT; i++) descriptors.push(selection.slots[i]);
    if (sourceEntries && sourceEntries.length !== descriptors.length) {
      throw new Error("Bundle video preparation did not receive all 288 PNG frames.");
    }
    var prepared = [];
    var sourceBytes = sourceEntries && Number(sourceEntries.stagedBytes) || 0;
    assertStagingBudget(sourceBytes, "bundle");
    var preparedBytes = 0;
    var target = null;
    notify(opts, "prepare", 0, FRAME_COUNT);
    try {
      for (var frameNo = 0; frameNo < descriptors.length; frameNo++) {
        checkCancelled(opts);
        checkVisible();
        var supplied;
        if (sourceEntries) {
          supplied = sourceEntries[frameNo] && sourceEntries[frameNo].blob;
          if (!supplied) throw new Error("Bundle PNG " + (frameNo + 1) + " is missing before video preparation.");
        } else {
          try {
            supplied = await awaitCancelable(opts.loadFrame(descriptors[frameNo].loadIndex), opts);
          } catch (err) {
            if (err && /cancelled|hidden|timing/i.test(String(err.message || err))) throw err;
            throw new Error("Could not load orbit frame " + (frameNo + 1) + " for video preparation: " +
              (err && err.message ? err.message : String(err)));
          }
        }
        if (supplied && typeof supplied.size === "number" && supplied.size > MAX_STAGING_BYTES) {
          throw memoryLimitError("video source", supplied.size, MAX_STAGING_BYTES);
        }
        checkCancelled(opts);
        var image = await drawableFrom(supplied, opts);
        try {
          assertSourceDimensions(image, "video");
          if (!target) target = canvasDimensions(image.width, image.height);
          var surface = canvasFor(target.width, target.height);
          drawVideoFrame(surface, image);
          var compressed = await compressedVideoFrame(surface.canvas, opts);
          preparedBytes += Number(compressed.size || 0);
          assertStagingBudget(sourceBytes + preparedBytes, "video");
          prepared.push(compressed);
        } finally {
          image.close();
        }
        notify(opts, "prepare", frameNo + 1, FRAME_COUNT);
      }
      if (!target || prepared.length !== FRAME_COUNT) {
        throw new Error("Video preparation did not produce all 288 compressed frames.");
      }
      return {
        blobs: prepared,
        bytes: preparedBytes,
        sourceBytes: sourceBytes,
        width: target.width,
        height: target.height
      };
    } catch (err2) {
      /* prepared contains only encoded Blobs; releasing the array here drops
         those references while the current decoded source is closed above. */
      prepared.length = 0;
      throw err2;
    }
  }

  function streamFor(canvas, fps) {
    var stream = null;
    var manual = false;
    try {
      stream = canvas.captureStream(0);
      var tracks = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks() : [];
      manual = !!(tracks[0] && typeof tracks[0].requestFrame === "function");
    } catch (err) {
      stream = null;
    }
    /* A few implementations accept captureStream(0) but do not expose the
       requestFrame API.  A zero-rate stream would then record no frames, so
       deliberately fall back to the encoder's timed capture rate. */
    if (stream && !manual) {
      try {
        if (typeof stream.getTracks === "function") {
          stream.getTracks().forEach(function (track) { try { track.stop(); } catch (err3) {} });
        }
      } catch (err4) {}
      stream = null;
    }
    if (!stream) {
      try { stream = canvas.captureStream(fps); } catch (err2) {
        throw new Error("This browser could not start Canvas video capture; PNG frame export remains available.");
      }
      var fallbackTracks = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks() : [];
      manual = !!(fallbackTracks[0] && typeof fallbackTracks[0].requestFrame === "function");
    }
    var videoTracks = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks() : [];
    if (!videoTracks.length) throw new Error("Canvas video capture produced no video track.");
    return { stream: stream, track: videoTracks[0], manual: manual };
  }

  async function recordVideo(run, selection, opts, videoMime, sourceEntries) {
    checkCancelled(opts);
    checkVisible();
    var fps = normalizedFps(run);
    var descriptors = [];
    for (var i = 0; i < FRAME_COUNT; i++) descriptors.push(selection.slots[i]);
    /*
     * All provider reads and source decodes happen before MediaRecorder starts.
     * This is important for signed URLs and Supabase reads: a 100ms source
     * fetch must never steal a slot from the 41.67ms recording clock.
     */
    var prepared = await prepareVideoFrames(run, selection, opts, sourceEntries);
    var surface = canvasFor(prepared.width, prepared.height);
    var captured = null;
    var decoded = new Map();
    var inflight = new Map();
    var decodeAlive = true;
    var prefetchError = null;
    function releaseDecoded() {
      decodeAlive = false;
      decoded.forEach(function (image) {
        try { image.close(); } catch (err) {}
      });
      decoded.clear();
    }
    function decodePrepared(index) {
      if (index < 0 || index >= prepared.blobs.length) return Promise.resolve(null);
      if (decoded.has(index)) return Promise.resolve(decoded.get(index));
      if (inflight.has(index)) return inflight.get(index);
      var promise = drawableFrom(prepared.blobs[index], opts).then(function (image) {
        inflight.delete(index);
        if (!decodeAlive) {
          image.close();
          throw new Error("Video frame decoding finished after export cleanup.");
        }
        decoded.set(index, image);
        return image;
      }, function (err) {
        inflight.delete(index);
        throw err;
      });
      inflight.set(index, promise);
      return promise;
    }
    function prefetch(index) {
      if (index < 0 || index >= prepared.blobs.length) return;
      decodePrepared(index).catch(function (err) { prefetchError = err; });
    }
    /* Prime a bounded decode window before the recorder is even constructed. */
    var initial = [];
    for (var initialIndex = 0; initialIndex < Math.min(VIDEO_LOOKAHEAD, FRAME_COUNT); initialIndex++) {
      initial.push(decodePrepared(initialIndex));
    }
    try {
      await Promise.all(initial);
    } catch (initialErr) {
      releaseDecoded();
      throw initialErr;
    }
    try {
      checkCancelled(opts);
      checkVisible();
    } catch (initialGuardErr) {
      releaseDecoded();
      throw initialGuardErr;
    }
    var firstPreparedImage = decoded.get(0);
    if (!firstPreparedImage) {
      releaseDecoded();
      throw new Error("The first prepared orbit frame could not be decoded.");
    }
    /* Paint before MediaRecorder.start so captureStream cannot begin with a
       blank canvas.  requestFrame is still called exactly once per scheduled
       frame below, after recorder.start. */
    try {
      drawVideoFrame(surface, firstPreparedImage);
      captured = streamFor(surface.canvas, fps);
    } catch (setupErr) {
      releaseDecoded();
      throw setupErr;
    }
    var MR = root.MediaRecorder;
    var recorder;
    try {
      try {
        recorder = new MR(captured.stream, { mimeType: videoMime, videoBitsPerSecond: 8000000 });
      } catch (constructorErr) {
        throw new Error("The browser advertised " + videoMime + " but could not start that recorder: " + constructorErr.message);
      }
      var chunks = [];
      var recorderError = null;
      var recordedBytes = 0;
      recorder.ondataavailable = function (event) {
        if (event && event.data && event.data.size) {
          recordedBytes += event.data.size;
          if (prepared.sourceBytes + prepared.bytes + recordedBytes > MAX_STAGING_BYTES) {
            recorderError = memoryLimitError("video", prepared.sourceBytes + prepared.bytes + recordedBytes, MAX_STAGING_BYTES);
          } else {
            chunks.push(event.data);
          }
        }
      };
      recorder.onerror = function (event) {
        recorderError = new Error("The browser stopped recording the orbit video: " +
          ((event && event.error && event.error.message) || "MediaRecorder error"));
      };
      var stopped = new Promise(function (resolve) {
        recorder.onstop = function () { resolve(); };
      });
      try { recorder.start(); } catch (startErr) {
        throw new Error("The browser could not start orbit video recording: " + startErr.message);
      }
      notify(opts, "video", 0, FRAME_COUNT);
      var startedAt = now();
      for (var frameNo = 0; frameNo < descriptors.length; frameNo++) {
        checkCancelled(opts);
        checkVisible();
        if (recorderError) throw recorderError;
        if (prefetchError) throw new Error(
          "A prepared orbit frame could not be decoded before recording: " +
          (prefetchError.message || String(prefetchError))
        );
        var image = await awaitCancelable(decodePrepared(frameNo), opts);
        try {
          var late = now() - (startedAt + frameNo * (1000 / fps));
          if (late > 1.25 * (1000 / fps)) {
            throw new Error(
              "Video frame timing fell behind by " + Math.round(late) +
              " ms. Keep this tab visible, close heavy tabs, and export again so no frames are silently dropped."
            );
          }
          drawVideoFrame(surface, image);
          if (captured.manual && captured.track && typeof captured.track.requestFrame === "function") {
            captured.track.requestFrame();
          }
          notify(opts, "video", frameNo + 1, FRAME_COUNT);
        } finally {
          if (image) {
            image.close();
            decoded.delete(frameNo);
          }
        }
        prefetch(frameNo + VIDEO_LOOKAHEAD);
        /* A canvas stream is real-time.  Waiting here is intentional: drawing
           all 288 images in one task produces a short video with silently
           dropped frames in Chromium.  Decoding is overlapped in the bounded
           lookahead window, never done on this clock. */
        var target = startedAt + (frameNo + 1) * (1000 / fps);
        var wait = target - now();
        if (wait > 0) await sleep(wait);
      }
      checkCancelled(opts);
      checkVisible();
      try { recorder.stop(); } catch (stopErr) { throw stopErr; }
      await stopped;
      if (recorderError) throw recorderError;
      if (!chunks.length) throw new Error("MediaRecorder returned an empty video; try an up-to-date Safari or Chromium browser.");
      assertStagingBudget(prepared.sourceBytes + prepared.bytes + recordedBytes, "video");
      var blob = makeBlob(chunks, String(chunks[0].type || videoMime));
      var actualMime = String(blob.type || videoMime).toLowerCase();
      var extension = videoExtension(actualMime);
      if (!extension) {
        throw new Error("The recorder returned an unknown video format (" + actualMime + "); refusing a misleading filename.");
      }
      return {
        blob: blob,
        mime: actualMime,
        extension: extension,
        width: surface.canvas.width,
        height: surface.canvas.height
      };
    } finally {
      releaseDecoded();
      if (captured && captured.stream && typeof captured.stream.getTracks === "function") {
        captured.stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (err4) {}
        });
      }
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch (err5) {}
      }
    }
  }

  async function collectPngs(selection, opts) {
    var pngs = [];
    var stagedBytes = 0;
    notify(opts, "frames", 0, selection.descriptors.length);
    for (var i = 0; i < selection.descriptors.length; i++) {
      checkCancelled(opts);
      var descriptor = selection.descriptors[i];
      var png = await pngForFrame(descriptor.slot, descriptor, opts);
      stagedBytes += Number(png.size || 0);
      assertStagingBudget(stagedBytes, "PNG");
      pngs.push({ name: descriptor.filename, blob: png });
      notify(opts, "frames", i + 1, selection.descriptors.length);
    }
    pngs.stagedBytes = stagedBytes;
    return pngs;
  }

  async function exportFrames(run, selection, opts, fps) {
    var pngs = await collectPngs(selection, opts);
    checkCancelled(opts);
    var manifest = manifestFor(run, selection.descriptors, fps);
    var entries = pngs.concat([{ name: "manifest.json", blob: jsonBlob(manifest) }]);
    notify(opts, "zip", 0, 1);
    var zip = await zipStore(entries, opts);
    notify(opts, "zip", 1, 1);
    return { blob: zip, filename: slug(run && (run.id || run.characterName)) + "-orbit-frames.zip", mime: "application/zip" };
  }

  async function exportBundle(run, selection, opts, fps, videoMime) {
    /* Build PNGs first so a cancellation never leaves a video that claims to
       have a matching still set.  The source image itself is released after
       each conversion; only encoded PNG Blobs are held for the ZIP. */
    var pngs = await collectPngs(selection, opts);
    checkCancelled(opts);
    var recorded = await recordVideo(run, selection, opts, videoMime, pngs);
    checkCancelled(opts);
    var manifest = manifestFor(run, selection.descriptors, fps);
    manifest.video = {
      filename: "video." + recorded.extension,
      mime: recorded.mime,
      widthCappedAt: 1080,
      width: recorded.width,
      height: recorded.height,
      scheduledFramecount: FRAME_COUNT,
      encodedFramecount: null,
      encodedFramecountVerified: false,
      durationSeconds: FRAME_COUNT / fps,
      durationLabel: "~" + (FRAME_COUNT / fps) + " seconds (MediaRecorder timing)"
    };
    var entries = pngs.concat([
      { name: "video." + recorded.extension, blob: recorded.blob },
      { name: "manifest.json", blob: jsonBlob(manifest) }
    ]);
    notify(opts, "zip", 0, 1);
    var zip = await zipStore(entries, opts);
    notify(opts, "zip", 1, 1);
    return {
      blob: zip,
      filename: slug(run && (run.id || run.characterName)) + "-orbit-bundle.zip",
      mime: "application/zip"
    };
  }

  async function exportOrbit(run, options) {
    var opts = options || {};
    var kind = opts.kind || "frames";
    if (kind !== "frames" && kind !== "video" && kind !== "bundle") {
      throw new Error('Unknown character orbit export kind "' + kind + '". Use "frames", "video", or "bundle".');
    }
    if (!run || typeof run !== "object") throw new Error("A character orbit run is required.");
    if (typeof opts.loadFrame !== "function") throw new Error("Character orbit export needs loadFrame(index).");
    var selection = descriptorsFor(run);
    var fps = normalizedFps(run);
    var needsVideo = kind === "video" || kind === "bundle";
    var selectedSupport = needsVideo ? videoSupport() : null;
    if (needsVideo) {
      if (!selectedSupport.video) throw new Error(selectedSupport.error || "Video export is unsupported in this browser; PNG frame export remains available.");
      requireAll(selection);
    }
    if (!selection.descriptors.length) throw new Error("This character orbit has no saved frames to export.");
    if (kind === "frames") return await exportFrames(run, selection, opts, fps);
    if (kind === "video") {
      var recorded = await recordVideo(run, selection, opts, selectedSupport.videoMime);
      var filename = slug(run.id || run.characterName) + "-orbit." + recorded.extension;
      return { blob: recorded.blob, filename: filename, mime: recorded.mime };
    }
    return await exportBundle(run, selection, opts, fps, selectedSupport.videoMime);
  }

  function download(result, options) {
    if (!result || !result.blob) throw new Error("download(result) needs the result returned by CharacterOrbitExport.export.");
    var d = doc();
    if (!d || typeof d.createElement !== "function" || !root.URL || typeof root.URL.createObjectURL !== "function") {
      throw new Error("This browser cannot download export files (document or object URLs are unavailable).");
    }
    var href = root.URL.createObjectURL(result.blob);
    var anchor = d.createElement("a");
    anchor.href = href;
    anchor.download = result.filename || "character-orbit-export";
    anchor.rel = "noopener";
    if (d.body && typeof d.body.appendChild === "function") d.body.appendChild(anchor);
    try { anchor.click(); } finally {
      if (anchor.parentNode && typeof anchor.parentNode.removeChild === "function") anchor.parentNode.removeChild(anchor);
    }
    var delay = options && Number(options.revokeAfter);
    if (!(delay >= 0)) delay = 1500;
    (root.setTimeout || setTimeout)(function () {
      try { root.URL.revokeObjectURL(href); } catch (err) {}
    }, delay);
    return href;
  }

  root.CharacterOrbitExport = {
    export: exportOrbit,
    support: support,
    download: download
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
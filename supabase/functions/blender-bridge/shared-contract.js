/* Shared, data-only Blender preview protocol. No executable instructions. */
(function (root) {
  "use strict";
  function fail(message) { throw new Error(message); }
  function object(value, keys, name) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(name + " must be an object.");
    Object.keys(value).forEach(function (key) {
      if (keys.indexOf(key) < 0) fail("Unsupported " + name + " field: " + key);
    });
    keys.forEach(function (key) { if (!(key in value)) fail("Missing " + name + "." + key); });
  }
  function number(value, min, max, name) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      fail(name + " must be between " + min + " and " + max + ".");
  }
  function integer(value, min, max, name) {
    number(value, min, max, name);
    if (!Number.isInteger(value)) fail(name + " must be a whole number.");
  }
  function text(value, max, name, id) {
    if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f]/.test(value))
      fail("Invalid " + name + ".");
    if (id && !/^[a-zA-Z0-9_-]+$/.test(value)) fail("Invalid " + name + ".");
  }
  function vector(value, min, max, name) {
    if (!Array.isArray(value) || value.length !== 3) fail(name + " must have three coordinates.");
    value.forEach(function (v) { number(v, min, max, name); });
  }
  function validateSpec(spec) {
    object(spec, ["version","projectId","shotId","sceneId","locationId","label","room",
      "landmarks","actors","props","camera","render"], "scene");
    if (spec.version !== 1) fail("Unsupported Blender preview protocol.");
    ["projectId","shotId","sceneId","locationId"].forEach(function (k) { text(spec[k], 128, k, true); });
    text(spec.label, 120, "label");
    object(spec.room, ["width","depth","height"], "room");
    number(spec.room.width, 2, 50, "Room width");
    number(spec.room.depth, 2, 50, "Room depth");
    number(spec.room.height, 2, 12, "Room height");
    var ids = new Set();
    [["landmarks",8],["props",8],["actors",4]].forEach(function (entry) {
      var kind = entry[0], items = spec[kind];
      if (!Array.isArray(items) || items.length > entry[1]) fail("Too many " + kind + ".");
      items.forEach(function (item) {
        object(item, kind === "actors" ? ["id","label","position","height"] :
          ["id","label","position","scale"], kind);
        text(item.id, 128, kind + " id", true); text(item.label, 120, kind + " label");
        if (ids.has(item.id)) fail("Duplicate object id.");
        ids.add(item.id);
        vector(item.position, -100, 100, kind + " position");
        if (kind === "actors") number(item.height, 0.5, 3, "Stand-in height");
        else vector(item.scale, 0.05, 50, kind + " scale");
      });
    });
    object(spec.camera, ["position","target","focalLength","sensorWidth"], "camera");
    vector(spec.camera.position, -100, 100, "Camera position");
    vector(spec.camera.target, -100, 100, "Camera target");
    if (Math.hypot.apply(Math, spec.camera.target.map(function (v, i) {
      return v - spec.camera.position[i];
    })) < 0.01) fail("The camera must look at a different point.");
    number(spec.camera.focalLength, 8, 200, "Focal length");
    if (spec.camera.sensorWidth !== 36) fail("The preview uses a 36mm sensor.");
    object(spec.render, ["width","height","samples"], "render");
    integer(spec.render.width, 128, 768, "Render width");
    integer(spec.render.height, 128, 768, "Render height");
    integer(spec.render.samples, 1, 32, "Render samples");
    return spec;
  }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canonical(value[k]);
    }).join(",") + "}";
    return JSON.stringify(value);
  }
  async function hashSpec(spec) {
    validateSpec(spec);
    var crypt = root.crypto;
    if (!crypt && typeof require === "function") crypt = require("node:crypto").webcrypto;
    if (!crypt || !crypt.subtle) fail("Secure scene hashing is unavailable.");
    var digest = await crypt.subtle.digest("SHA-256", new TextEncoder().encode(canonical(spec)));
    return Array.from(new Uint8Array(digest)).map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }
  function validateCameraResult(actual, spec) {
    validateSpec(spec);
    object(actual, ["position","direction","focalLength","sensorWidth","width","height"], "camera result");
    vector(actual.position, -100, 100, "Returned position");
    vector(actual.direction, -1.001, 1.001, "Returned direction");
    var delta = spec.camera.target.map(function (v, i) { return v - spec.camera.position[i]; });
    var length = Math.hypot.apply(Math, delta);
    function near(a, b) { if (!Number.isFinite(a) || Math.abs(a - b) > 0.001) fail("Blender camera does not match this request."); }
    near(actual.focalLength, spec.camera.focalLength);
    near(actual.sensorWidth, spec.camera.sensorWidth);
    actual.position.forEach(function (v, i) { near(v, spec.camera.position[i]); });
    actual.direction.forEach(function (v, i) { near(v, delta[i] / length); });
    if (actual.width !== spec.render.width || actual.height !== spec.render.height)
      fail("Blender returned a different render size.");
    return actual;
  }
  var crcTable;
  function crc32(bytes, start, end) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function validatePNG(bytes, width, height) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > 2 * 1024 * 1024)
      fail("Preview must be a PNG under 2 MB.");
    var signature = [137,80,78,71,13,10,26,10];
    if (!signature.every(function (b, i) { return bytes[i] === b; })) fail("Preview is not a PNG.");
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 8, header = false, data = false, ended = false, gotWidth, gotHeight;
    while (pos + 12 <= bytes.length) {
      var len = view.getUint32(pos), end = pos + 12 + len;
      if (end > bytes.length) fail("Truncated PNG.");
      var type = String.fromCharCode.apply(null, bytes.subarray(pos + 4, pos + 8));
      if (crc32(bytes, pos + 4, pos + 8 + len) !== view.getUint32(pos + 8 + len)) fail("PNG checksum failed.");
      if (pos === 8 && type !== "IHDR") fail("Missing PNG header.");
      if (type === "IHDR") {
        if (header || len !== 13) fail("Invalid PNG header.");
        gotWidth = view.getUint32(pos + 8); gotHeight = view.getUint32(pos + 12);
        integer(gotWidth, 128, 768, "PNG width"); integer(gotHeight, 128, 768, "PNG height");
        if ((width != null && gotWidth !== width) || (height != null && gotHeight !== height))
          fail("PNG size does not match the shot.");
        if (bytes[pos + 16] !== 8 || [2,6].indexOf(bytes[pos + 17]) < 0 ||
            bytes[pos + 18] !== 0 || bytes[pos + 19] !== 0 || bytes[pos + 20] !== 0)
          fail("Preview requires a standard 8-bit RGB or RGBA PNG.");
        header = true;
      }
      if (type === "acTL") fail("Animated PNGs are not supported.");
      if (type === "IDAT" && len > 0) data = true;
      if (type === "IEND") {
        if (len !== 0 || end !== bytes.length || !data) fail("Invalid PNG ending.");
        ended = true;
      }
      pos = end;
    }
    if (!ended) fail("Incomplete PNG.");
    return {width:gotWidth, height:gotHeight};
  }
  function decodePNG(base64, width, height) {
    if (typeof base64 !== "string" || base64.length > 2800000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      fail("Invalid PNG encoding.");
    var str = atob(base64), bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    validatePNG(bytes, width, height);
    return bytes;
  }
  var api = {version:1,validateSpec:validateSpec,canonical:canonical,hashSpec:hashSpec,
    validateCameraResult:validateCameraResult,validatePNG:validatePNG,decodePNG:decodePNG};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BlenderContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
#!/usr/bin/env node
/*
 * Browser regression for the standalone CharacterOrbitExport global.
 *
 * It deliberately uses only data URLs containing deterministic SVG direction
 * markers.  When the repository's Chromium binary is available this exercises
 * Canvas PNG encoding, a real ZIP32 reader (also checked with unzip), and a
 * real MediaRecorder video.  Environments without a browser report a skip
 * rather than replacing the browser test with fake media.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const ROOT = new URL("../", import.meta.url);
const CHROMIUM = process.env.CHROMIUM || "/repl/tools/bin/chromium";

/* Node 20 in the repository image has no global WebSocket.  Keep this
 * regression dependency-free by using the tiny RFC6455 client below when
 * needed; Chromium's CDP messages are short text frames, so no extensions or
 * fragmented writes are necessary here. */
class NativeWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.onmessage = null;
    socket.on("data", data => this.read(data));
  }
  static async connect(url) {
    const parsed = new URL(url);
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect(Number(parsed.port), parsed.hostname);
    let response = Buffer.alloc(0);
    const client = await new Promise((resolve, reject) => {
      const fail = error => { socket.removeAllListeners("data"); reject(error); };
      socket.once("error", fail);
      socket.on("data", data => {
        response = Buffer.concat([response, data]);
        const marker = response.indexOf(Buffer.from("\r\n\r\n"));
        if (marker < 0) return;
        socket.removeListener("error", fail);
        socket.removeAllListeners("data");
        if (!response.subarray(0, marker).toString().startsWith("HTTP/1.1 101")) {
          reject(new Error("CDP WebSocket handshake failed."));
          return;
        }
        const client = new NativeWebSocket(socket);
        const leftover = response.subarray(marker + 4);
        if (leftover.length) client.read(leftover);
        resolve(client);
      });
      socket.write(
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1\r\n` +
        `Host: ${parsed.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    return client;
  }
  send(text) {
    const payload = Buffer.from(text);
    const mask = crypto.randomBytes(4);
    const header = payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, payload]));
  }
  read(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const opcode = first & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        if (high > 0) throw new Error("CDP WebSocket frame is too large.");
        length = low;
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x1 && this.onmessage) this.onmessage({data: payload.toString()});
    }
  }
  close() {
    try { this.socket.destroy(); } catch {}
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const [resolve, reject] = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
  }
  static async connect(url) {
    const ws = typeof WebSocket === "function"
      ? new WebSocket(url)
      : await NativeWebSocket.connect(url);
    if (typeof ws.onopen === "undefined") return new CDP(ws);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new CDP(ws);
  }
  call(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, [resolve, reject]));
  }
  async eval(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

function fixtureHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<script src="/character-orbit-export.js"></script>
<script>
window.__orbitFixture = (() => {
  let loadCount = 0;
  let requestFrames = 0;
  let firstCapturePixel = null;
  const svg = index => {
    const hue = (index * 17) % 360;
    const x = 24 + ((index * 7) % 272);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<rect width="320" height="180" fill="hsl(' + hue + ',55%,28%)"/>' +
      '<path d="M160 22 L' + x + ' 158 L160 134 L' + (320 - x) + ' 158 Z" fill="hsl(' +
        ((hue + 120) % 360) + ',75%,65%)"/>' +
      '<text x="8" y="20" fill="white" font-size="14">' + index + '</text></svg>'
    );
  };
  const frames = Array.from({length: 288}, (_, index) => ({
    index, id: "marker-" + index, angle: index * 1.25
  }));
  if (HTMLCanvasElement.prototype.captureStream) {
    const captureStream = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function(rate) {
      const pixel = this.getContext("2d").getImageData(0, 0, 1, 1).data;
      if (!firstCapturePixel) firstCapturePixel = [pixel[0], pixel[1], pixel[2], pixel[3]];
      const stream = captureStream.call(this, rate);
      for (const track of stream.getVideoTracks()) {
        if (typeof track.requestFrame === "function") {
          const requestFrame = track.requestFrame;
          track.requestFrame = function() {
            requestFrames++;
            return requestFrame.call(this);
          };
        }
      }
      return stream;
    };
  }
  return {
    run: {
      id: "orbit-fixture",
      characterName: "Directional Test Character",
      pose: { label: "standing", seed: 42 },
      settings: { aspect: "16:9", source: "synthetic browser fixture" },
      frames, completed: 288, fps: 24
    },
    loadFrame: async index => {
      loadCount++;
      return svg(index);
    },
    slowLoadFrame: async index => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return svg(index);
    },
    svg,
    resetLoadCount: () => { loadCount = 0; },
    loadCount: () => loadCount,
    resetCaptureMetrics: () => { requestFrames = 0; firstCapturePixel = null; },
    captureMetrics: () => ({requestFrames, firstCapturePixel})
  };
})();
</script>`;
}

async function waitFor(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function staticServer(appSource) {
  return createServer((request, response) => {
    const pathname = new URL(request.url, "http://orbit-fixture").pathname;
    if (pathname === "/character-orbit-export.js") {
      response.writeHead(200, {"content-type": "text/javascript; charset=utf-8"});
      response.end(appSource);
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      response.writeHead(200, {"content-type": "text/html; charset=utf-8"});
      response.end(fixtureHtml());
      return;
    }
    response.writeHead(404).end();
  });
}

async function main() {
  try {
    await access(CHROMIUM);
  } catch {
    console.log("SKIP — Chromium is not available for CharacterOrbitExport browser tests.");
    return;
  }
  const source = await readFile(new URL("app/character-orbit-export.js", ROOT), "utf8");
  const server = staticServer(source);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const debugPort = 9700 + Math.floor(Math.random() * 200);
  const profile = await mkdtemp(join(tmpdir(), "character-orbit-chrome-"));
  const chrome = spawn(CHROMIUM, [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"
  ], {stdio: "ignore"});
  let cdp;
  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return null;
      return (await response.json()).find(item => item.type === "page" && item.webSocketDebuggerUrl);
    }, "Chromium target", 15000);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Page.navigate", {url: `http://127.0.0.1:${port}/`});
    await waitFor(() => cdp.eval("!!window.CharacterOrbitExport"), "CharacterOrbitExport global");

    const support = await cdp.eval("window.CharacterOrbitExport.support()");
    assert.equal(typeof support.video, "boolean");
    if (support.video) assert.match(support.videoMime, /^video\/(mp4|webm)/);

    const subset = await cdp.eval(`(async () => {
      const run = {...__orbitFixture.run, frames: [__orbitFixture.run.frames[0],
        __orbitFixture.run.frames[17], __orbitFixture.run.frames[287]], completed: 3};
      const progress = [];
      const result = await CharacterOrbitExport.export(run, {
        kind: "frames", loadFrame: __orbitFixture.loadFrame,
        onProgress: value => progress.push(value)
      });
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const entries = [];
      const decoder = new TextDecoder();
      for (let offset = 0; offset + 30 <= bytes.length && new DataView(bytes.buffer).getUint32(offset, true) === 0x04034b50;) {
        const view = new DataView(bytes.buffer);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const size = view.getUint32(offset + 18, true);
        const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
        entries.push(name);
        offset += 30 + nameLength + extraLength + size;
      }
      const central = new TextDecoder();
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
      }
      return {filename: result.filename, mime: result.mime, size: result.blob.size,
        entries, progress, bytes: btoa(binary)};
    })()`);
    assert.equal(subset.filename, "orbit-fixture-orbit-frames.zip");
    assert.equal(subset.mime, "application/zip");
    assert.deepEqual(subset.entries, ["frame-0001.png", "frame-0018.png", "frame-0288.png", "manifest.json"]);
    const frameProgress = subset.progress.filter(value => value.phase === "frames");
    assert.equal(frameProgress.at(-1).done, 3);
    assert.equal(frameProgress.at(-1).total, 3);
    const subsetZip = join(profile, "subset.zip");
    await writeFile(subsetZip, Buffer.from(subset.bytes, "base64"));
    try {
      execFileSync("unzip", ["-t", subsetZip], {stdio: "ignore"});
    } catch (error) {
      throw new Error("The frame ZIP did not pass unzip -t (is the ZIP32 store corrupt?): " + error.message);
    }

    const full = await cdp.eval(`(async () => {
      const result = await CharacterOrbitExport.export(__orbitFixture.run, {
        kind: "frames", loadFrame: __orbitFixture.loadFrame
      });
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const view = new DataView(bytes.buffer);
      const decoder = new TextDecoder();
      let offset = 0, manifest = null;
      while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const size = view.getUint32(offset + 18, true);
        const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
        const start = offset + 30 + nameLength + extraLength;
        if (name === "manifest.json") manifest = JSON.parse(decoder.decode(bytes.slice(start, start + size)));
        offset = start + size;
      }
      return {filename: result.filename, size: result.blob.size, manifest};
    })()`);
    assert.equal(full.filename, "orbit-fixture-orbit-frames.zip");
    assert.equal(full.manifest.framecount, 288);
    assert.equal(full.manifest.expectedFramecount, 288);
    assert.equal(full.manifest.missingFrameCount, 0);
    assert.equal(full.manifest.frames[1].angle, 1.25);
    assert.equal(full.manifest.frames[287].filename, "frame-0288.png");

    if (support.video) {
      const video = await cdp.eval(`(async () => {
        __orbitFixture.resetCaptureMetrics();
        const progress = [];
        const result = await CharacterOrbitExport.export(__orbitFixture.run, {
          kind: "video", loadFrame: __orbitFixture.slowLoadFrame,
          onProgress: value => progress.push(value)
        });
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
        }
        return {filename: result.filename, mime: result.mime, size: result.blob.size,
          base64: btoa(binary), progress, capture: __orbitFixture.captureMetrics()};
      })()`);
      assert.ok(video.size > 0, "MediaRecorder returned a non-empty video");
      if (/mp4/i.test(video.mime)) assert.match(video.filename, /\.mp4$/);
      else if (/webm/i.test(video.mime)) assert.match(video.filename, /\.webm$/);
      else throw new Error(`Unexpected recorder MIME ${video.mime}`);
      assert.equal(video.progress.filter(value => value.phase === "prepare").at(-1).done, 288,
        "slow source acquisition completed before recording");
      assert.equal(video.progress.filter(value => value.phase === "video").at(-1).done, 288,
        "recording completed all 288 scheduled frames");
      assert.ok(video.capture.firstCapturePixel && video.capture.firstCapturePixel.some(value => value !== 0),
        "captureStream observed a painted first frame rather than a blank canvas");
      if (video.capture.requestFrames) assert.equal(video.capture.requestFrames, 288,
        "manual captureStream requestFrame was called exactly once per scheduled frame");
      console.log(`capture: first pixel ${video.capture.firstCapturePixel.join(",")}, requestFrame calls ${video.capture.requestFrames}`);
      const videoPath = join(profile, video.filename);
      await writeFile(videoPath, Buffer.from(video.base64, "base64"));
      const probe = JSON.parse(execFileSync("ffprobe", [
        "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames,nb_frames,avg_frame_rate,duration",
        "-show_entries", "format=duration", "-of", "json", videoPath
      ], {encoding: "utf8"}));
      const stream = probe.streams?.[0] || {};
      const decodedFrames = Number(stream.nb_read_frames || stream.nb_frames || 0);
      const duration = Number(stream.duration || probe.format?.duration || 0);
      const rateParts = String(stream.avg_frame_rate || "").split("/");
      const averageFps = rateParts.length === 2 ? Number(rateParts[0]) / Number(rateParts[1]) : Number(stream.avg_frame_rate || 0);
      assert.equal(decodedFrames, 288, `ffprobe decoded ${decodedFrames} video frames instead of 288`);
      assert.ok(Math.abs(duration - 12) < 0.5, `ffprobe duration ${duration}s is not approximately 12s`);
      assert.ok(Math.abs(averageFps - 24) < 0.2, `ffprobe average rate ${averageFps}fps is not approximately 24fps`);
      console.log(`ffprobe: ${decodedFrames} decoded frames, ${duration.toFixed(3)}s, ${averageFps.toFixed(3)} fps`);

      const bundle = await cdp.eval(`(async () => {
        __orbitFixture.resetLoadCount();
        const result = await CharacterOrbitExport.export(__orbitFixture.run, {
          kind: "bundle", loadFrame: __orbitFixture.loadFrame
        });
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        const view = new DataView(bytes.buffer);
        const decoder = new TextDecoder();
        const entries = [];
        let manifest = null;
        let offset = 0;
        while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
          const nameLength = view.getUint16(offset + 26, true);
          const extraLength = view.getUint16(offset + 28, true);
          const size = view.getUint32(offset + 18, true);
          const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
          const start = offset + 30 + nameLength + extraLength;
          entries.push(name);
          if (name === "manifest.json") manifest = JSON.parse(decoder.decode(bytes.slice(start, start + size)));
          offset = start + size;
        }
        return {filename: result.filename, mime: result.mime, entries, manifest,
          loadCount: __orbitFixture.loadCount()};
      })()`);
      assert.equal(bundle.filename, "orbit-fixture-orbit-bundle.zip");
      assert.equal(bundle.mime, "application/zip");
      assert.equal(bundle.entries.filter(name => name.startsWith("frame-") && name.endsWith(".png")).length, 288,
        JSON.stringify(bundle.entries.slice(0, 3)));
      assert.ok(bundle.entries.includes("manifest.json"));
      assert.ok(bundle.entries.some(name => name === "video.mp4" || name === "video.webm"));
      assert.equal(bundle.loadCount, 288, "bundle reused the prepared PNG Blobs instead of fetching frames twice");
      assert.equal(bundle.manifest.framecount, 288);
      assert.equal(bundle.manifest.video.scheduledFramecount, 288);
      assert.equal(bundle.manifest.video.encodedFramecount, null,
        "manifest does not silently claim MediaRecorder encoded exactly 288 frames");
    } else {
      console.log("Video format unsupported in this browser; frame export still passed.");
    }
    console.log("RESULT: OK — CharacterOrbitExport frames/ZIP" + (support.video ? "/video" : ""));
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGTERM");
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error("RESULT: FAIL — " + (error && error.stack || error));
  process.exitCode = 1;
});
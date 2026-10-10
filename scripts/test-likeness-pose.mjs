#!/usr/bin/env node
/* test-likeness-pose.mjs — the Likeness capture's on-device pose check (2026-10-10, owner: "when he
   moves to the left view it captures the FRONT view as the left view … it can't tell left from
   right … only capture when the user is fully turned and holding the position, like official
   ID-capture software").

   Offline (node:vm, no network): the REAL app/face-pose.js on synthetic detector results (a face
   model rotated by a known yaw / pitch / roll and projected like the library's output), and the REAL
   CameoModal (app/cameo.jsx) on a fake camera, a fake detector engine and a rAF queue pumped 100 ms
   at a time.

     P-a…P-e  the pose maths: matrix and landmark angles, the classes, one frame's reason, smoothing
     P-f…P-j  the hold machine: 3 s / 5 s holds, the owner's case (a still front face never fills a
              side slot), resets, leave-first, manual / filled, the confirmations
     P-k…P-n  a camera that flips its picture, the meter, the copy (no vendor names), timestamps,
              load errors, the vendored files, TURN.html / serve.js / dist
     P-o…P-p  the fetch guard; load(): the big files read with progress (only a stall times out), the
              window closing aborts the download, no timer outlives a load
     I1…I19   the real capture window: the owner's flow end to end, resets, the manual path when the
              pose check can't start, Capture now asking (and saving the frame it checked), unmount,
              local voices only, the strip, the saved-photo check, the flipped-camera check, uploads,
              holds that a hidden tab / a dialog / a restart can't complete, a second face
     V1…V4    (2026-10-10, owner — Likeness voice guidance) the VOICE_LINES manifest covers every instruction; the
              player's rules (4 s, the countdown, interrupts, reminders, close) and its fallbacks (the device voice,
              then the caption), on scripts/fixtures/likeness-voice/fake-audio.mjs
     I20…I22  a clean picture (no instruction text over it; the caption under it only when nothing is spoken),
              Capture now only when the photo doesn't take itself, the recorded clips in the real window

   node scripts/test-likeness-pose.mjs */
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { transformSync, parseSync, traverse } from "@babel/core";
import { createRequire } from "node:module";
import { makeAudioEnv } from "./fixtures/likeness-voice/fake-audio.mjs";

const require = createRequire(import.meta.url);
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename, compact: true,
}).code;
const FACE_SRC = read("app/face-pose.js");
const CAMEO_SRC = transform(read("app/cameo.jsx"), "app/cameo.jsx");

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
}
const noop = () => {};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || "") + ` ${a} ≈ ${b} ±${tol}`);

/* ── the pure module, in a vm of its own (no DOM, no network) ── */
const fpBox = { console, Math, JSON, Date, Promise, Object, Array, Number, String, Error, isFinite, URL,
  fetch: () => { throw new Error("network disabled in this test"); } };
fpBox.window = fpBox; fpBox.globalThis = fpBox;
vm.createContext(fpBox);
vm.runInContext(FACE_SRC, fpBox, { filename: "app/face-pose.js" });
const FP = fpBox.turnFacePose;

/* ── synthetic detector results ──────────────────────────────────────────
   Canonical points in cm (+X = the person's LEFT, +Y up, +Z out of the nose); q = R·p + (0, 1.9, −50);
   x = 0.5 + q.x/60, y = 0.5 − q.y/33.75, z = −(q.z+50)/60 — on 1280×720 a frontal face is centred with
   faceH ≈ 0.52. R = Ry(yaw)·Rx(pitch)·Rz(roll); +yaw rotates the nose toward camera +X (image right). */
const CANON = { 1: [0, -1.13, 7.48], 10: [0, 8.26, 4.48], 33: [-4.45, 2.66, 3.17], 263: [4.45, 2.66, 3.17],
  152: [0, -9.40, 4.26], 234: [-7.66, 0.67, -2.44], 454: [7.66, 0.67, -2.44] };
const rad = (d) => d * Math.PI / 180;
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
function rot(yaw = 0, pitch = 0, roll = 0){
  const [y, p, r] = [rad(yaw), rad(pitch), rad(roll)];
  const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const Rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const Rz = [[Math.cos(r), -Math.sin(r), 0], [Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
  return mul(mul(Ry, Rx), Rz);
}
function mat(yaw, pitch, roll){
  const R = rot(yaw, pitch, roll), d = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) d[c * 4 + r] = R[r][c];
  d[12] = 0; d[13] = 1.9; d[14] = -50; d[15] = 1;
  return d;
}
function landmarks(pose, o = {}){
  const R = rot(pose.yaw, pose.pitch, pose.roll), s = o.scale || 1, dx = o.dx || 0;
  const out = [];
  for (let i = 0; i < 478; i++){
    const p = (CANON[i] || CANON[1]).map((v) => v * s);
    const q = [0, 1, 2].map((k) => R[k][0] * p[0] + R[k][1] * p[1] + R[k][2] * p[2]);
    q[0] += dx; q[1] += 1.9; q[2] -= 50;
    out.push({ x: 0.5 + q[0] / 60, y: 0.5 - q[1] / 33.75, z: -(q[2] + 50) / 60, visibility: 0 });
  }
  return out;
}
const P0 = (x) => ({ yaw: 0, pitch: 0, roll: 0, ...(x || {}) });
/* a library-shaped result. o.faces: extra faces [{ pose, scale, dx }]; o.blink {left,right}; o.gaze;
   o.lmPose: build the landmarks from another pose (a disagreement); o.scale / o.dx for the main face */
function res(pose, o = {}){
  if (!pose) return { faceLandmarks: [], facialTransformationMatrixes: [], faceBlendshapes: [] };
  pose = P0(pose);
  const one = (ps, so) => {
    const blink = so.blink || { left: 0.05, right: 0.05 }, gaze = so.gaze || {};
    return {
      lm: landmarks(so.lmPose ? P0(so.lmPose) : ps, so),
      m: { rows: 4, columns: 4, data: mat(ps.yaw, ps.pitch, ps.roll) },
      b: { categories: [["eyeBlinkLeft", blink.left], ["eyeBlinkRight", blink.right],
        ["eyeLookOutLeft", gaze.outLeft || 0], ["eyeLookInRight", gaze.inRight || 0],
        ["eyeLookOutRight", gaze.outRight || 0], ["eyeLookInLeft", gaze.inLeft || 0]].map(([categoryName, score], index) => ({ index, score, categoryName, displayName: "" })) },
    };
  };
  const faces = [one(pose, o), ...((o.faces || []).map((f) => one(P0(f.pose), f)))];
  return { faceLandmarks: faces.map((f) => f.lm), facialTransformationMatrixes: faces.map((f) => f.m), faceBlendshapes: faces.map((f) => f.b) };
}
const obsOf = (pose, o) => FP.observe(res(pose, o), 1280, 720);
/* one frame through the whole chain: observe → smoother → evaluateFrame (fresh state each call) */
const evalOnce = (pose, target, o = {}) => {
  const sm = FP.createSmoother();
  return FP.evaluateFrame(sm.push(obsOf(pose, o), 0), target, { luma: o.luma != null ? o.luma : 128, prev: {} });
};
/* a 10 fps pipeline: frame(pose) → { t, ev, st } */
function pipeline(target){
  const sm = FP.createSmoother(), m = FP.createHoldMachine(), prev = {};
  const P = { m, t: 0, target, log: [] };
  P.frame = (pose, o = {}) => {
    P.t += 100;
    const ev = FP.evaluateFrame(sm.push(obsOf(pose, o), P.t), P.target, { luma: 128, prev });
    const st = m.step(ev, P.t, { target: P.target, filled: false, auto: true, engine: "ready" });
    const row = { t: P.t, ev, st }; P.log.push(row);
    return row;
  };
  P.run = (pose, ms, o) => { const out = []; for (let i = 0; i < ms / 100; i++) out.push(P.frame(pose, o)); return out; };
  return P;
}
const EV = (ok, base, reason) => ({ ok, base, reason: ok ? null : reason, measured: base });

/* ═══ P. the pure module ═══ */
await test("P-a poseFromMatrix recovers (35,0,0), (−35,0,0), (30,10,−8) within 0.1°; yaw > 0 when the nose turns toward image-right", () => {
  for (const [y, p, r] of [[35, 0, 0], [-35, 0, 0], [30, 10, -8], [0, 0, 0], [-12, -14, 9]]){
    const q = FP.poseFromMatrix(mat(y, p, r));
    near(q.yaw, y, 0.1, "yaw"); near(q.pitch, p, 0.1, "pitch"); near(q.roll, r, 0.1, "roll");
  }
  const R = rot(35, 0, 0);
  assert.ok(R[0][2] > 0, "Ry(+35) moves the nose (+Z) toward camera +X");
  const L = landmarks(P0({ yaw: 35 }));
  assert.ok(L[1].x > 0.5, "…which is the image's right in the raw frame (the person's own left)");
  assert.equal(FP.poseFromMatrix(null), null);
});

await test("P-b the landmark yaw has the matrix's sign and is within 6° up to ±40°; roll has the same sign", () => {
  for (const y of [-40, -30, -20, -10, -3, 3, 10, 20, 30, 40]){
    for (const p of [0, 8, -8]){
      const lp = FP.poseFromLandmarks(landmarks(P0({ yaw: y, pitch: p })), 1280, 720);
      assert.equal(Math.sign(lp.yaw), Math.sign(y), "sign at " + y + "/" + p);
      near(lp.yaw, y, 6, "landmark yaw " + y + "/" + p);
    }
  }
  for (const r of [-12, 12]){
    const lp = FP.poseFromLandmarks(landmarks(P0({ roll: r })), 1280, 720);
    assert.equal(Math.sign(lp.roll), Math.sign(r)); near(lp.roll, r, 1);
  }
  assert.equal(FP.poseFromLandmarks(new Array(100).fill({ x: 0, y: 0, z: 0 }), 1280, 720), null, "needs 468 points");
  const o = obsOf({ yaw: 0 });
  near(o.primary.faceH, 0.52, 0.01, "faceH"); near(o.primary.cx, 0.5, 0.005); near(o.primary.cy, 0.46, 0.01);
  assert.equal(o.primary.pose.src, "matrix");
  const noMatrix = res({ yaw: 30 }); noMatrix.facialTransformationMatrixes = [];
  const o2 = FP.observe(noMatrix, 1280, 720);
  assert.equal(o2.primary.pose.src, "landmarks"); near(o2.primary.pose.yaw, 30, 3, "the landmark fallback");
});

await test("P-c classifyPose: front / partial / side / far with hysteresis; tilt by family (stay limits only when the last frame was in the class AND level)", () => {
  const C = (yaw, prev, x) => FP.classifyPose(P0({ yaw, ...(x || {}) }), prev);
  const rows = [
    [0, null, "front"], [9, "none", "partial-left"], [9, "front", "front"], [24, null, "partial-left"], [25, null, "left"], [28, null, "left"],
    [23, "left", "left"], [21, "left", "partial-left"], [47, null, "left"], [50, "left", "left"], [50, "partial-left", "far-left"],
    [-30, null, "right"], [-9, "front", "front"], [-50, "partial-right", "far-right"],
  ];
  for (const [y, prev, want] of rows) assert.equal(C(y, prev).cls, want, y + " (" + prev + ")");
  // (2026-10-10) pitch limits widened for a webcam above the screen: front enter 15 / stay 18; (2026-10-10, owner — Likeness
  // voice guidance) side enter 22 / stay 25, roll 14 / 16, the band from 25° (front unchanged)
  let c = C(0, null, { pitch: 17 }); assert.deepEqual([c.cls, c.base, c.tilt], ["tilted", "front", "chin-down"]);
  c = C(0, null, { pitch: -17 }); assert.equal(c.tilt, "chin-up");
  c = FP.classifyPose(P0({ pitch: 17 }), "front", true); assert.equal(c.tilt, null, "the front stay limit (18) holds a 17° pitch once the head was level");
  c = C(0, "front", { pitch: 17 }); assert.equal(c.tilt, "chin-down", "…but a head that was never level enough gets the enter limit (15)");
  c = C(0, null, { pitch: 11 }); assert.equal(c.tilt, null, "a laptop-camera 11° (the real model read a straight-on face at +9.5–10.8°) is level");
  c = FP.classifyPose(P0({ yaw: 35, roll: 15 }), "left", false); assert.equal(c.tilt, "roll", "the same for a side: 15° roll against the enter limit (14)");
  c = C(0, null, { roll: 12 }); assert.equal(c.tilt, "roll", "Front's roll limit is unchanged (8)");
  c = C(35, null, { roll: 15 }); assert.deepEqual([c.cls, c.base, c.tilt], ["tilted", "left", "roll"]);
  c = FP.classifyPose(P0({ yaw: 35, roll: 15 }), "left", true); assert.equal(c.cls, "left", "the side stay limit (16)");
  c = FP.classifyPose(P0({ yaw: 35, roll: 17 }), "left", true); assert.equal(c.tilt, "roll", "…and past it");
  c = C(35, null, { roll: 13 }); assert.equal(c.cls, "left", "13° roll enters a side now (people tilt a little while turned)");
  c = C(35, null, { pitch: 21 }); assert.equal(c.cls, "left", "21° pitch enters a side (enter 22)");
  c = C(35, null, { pitch: 23 }); assert.equal(c.tilt, "chin-down", "23° doesn't enter…");
  c = FP.classifyPose(P0({ yaw: 35, pitch: 23 }), "left", true); assert.equal(c.cls, "left", "…but stays once in and level (stay 25)");
  c = FP.classifyPose(P0({ yaw: 35, pitch: -24 }), "left", true); assert.equal(c.cls, "left", "chin up the same way");
  c = FP.classifyPose(P0({ yaw: 35, pitch: 26 }), "left", true); assert.equal(c.tilt, "chin-down", "past 25: out");
  c = C(0, null, { pitch: 16 }); assert.equal(c.tilt, "chin-down", "Front's pitch limit is unchanged (15)");
  assert.deepEqual(plainify(FP.T.front), { enter: { yaw: 8, pitch: 15, roll: 8 }, stay: { yaw: 10, pitch: 18, roll: 10 } }, "Front unchanged");
  assert.deepEqual(plainify(FP.T.side), { enter: { min: 25, max: 48, pitch: 22, roll: 14 }, stay: { min: 22, max: 52, pitch: 25, roll: 16 }, target: 35 });
  assert.deepEqual(plainify(FP.HOLD_MS), { front: 3000, left: 5000, right: 5000 }, "the holds are unchanged");
  c = FP.classifyPose({ yaw: -29.5, pitch: 9.4, roll: -8.8 }, null);
  assert.deepEqual([c.cls, c.base, c.tilt], ["right", "right", null], "Girl with a Pearl Earring's measured pose: turned to her own right, not tilted");
  assert.deepEqual(plainify(FP.classifyPose(null)), { cls: "none", base: "none", tilt: null });
});
function plainify(x){ return JSON.parse(JSON.stringify(x)); }

await test("P-d evaluateFrame: the first failing check names the reason", () => {
  assert.equal(evalOnce({ yaw: 0 }, "front").ok, true, "a centred, lit, still front face fits Front");
  assert.equal(evalOnce({ yaw: 35 }, "left").ok, true, "+35 fits the person's own left");
  assert.equal(evalOnce({ yaw: -35 }, "right").ok, true);
  assert.equal(evalOnce({ yaw: 0 }, "left").reason, "not-turned", "a front face on a side target");
  assert.equal(evalOnce({ yaw: -30 }, "left").reason, "wrong-way");
  assert.equal(evalOnce({ yaw: -12 }, "left").reason, "not-turned", "a small turn the other way is just not turned");
  assert.equal(evalOnce({ yaw: 18 }, "left").reason, "more");
  assert.equal(evalOnce({ yaw: 55 }, "left").reason, "too-far");
  assert.equal(evalOnce({ yaw: 35, roll: 15 }, "left").reason, "roll");
  assert.equal(evalOnce({ yaw: 35, pitch: 23 }, "left").reason, "chin-down");
  assert.equal(evalOnce({ yaw: 25 }, "left").ok, true, "25° fits the person's own left (the band starts at 25)");
  assert.equal(evalOnce({ yaw: 24 }, "left").reason, "more", "24° is a little short");
  assert.equal(evalOnce({ yaw: 35, pitch: 21, roll: 13 }, "left").ok, true, "a turned head that dips 21° and tilts 13° fits");
  assert.equal(evalOnce({ yaw: 20 }, "front").reason, "turned");
  assert.equal(evalOnce({ yaw: 0, pitch: -17 }, "front").reason, "chin-up");
  assert.equal(evalOnce({ yaw: 0 }, "front", { faces: [{ pose: { yaw: 0 }, dx: 22 }] }).reason, "two-faces", "two equal faces");
  assert.equal(evalOnce({ yaw: 0 }, "front", { faces: [{ pose: { yaw: 0 }, dx: 22, scale: 0.4 }] }).ok, true, "a background face at 0.4× is ignored");
  assert.equal(evalOnce({ yaw: 0 }, "front", { scale: 0.385 }).reason, "far", "faceH ≈ 0.2");
  assert.equal(evalOnce({ yaw: 0 }, "front", { scale: 1.6 }).reason, "close");
  assert.equal(evalOnce({ yaw: 0 }, "front", { dx: 14 }).reason, "offcenter");
  assert.equal(evalOnce({ yaw: 0 }, "front", { luma: 30 }).reason, "dark");
  assert.equal(evalOnce({ yaw: 0 }, "front", { luma: 240 }).reason, "bright");
  assert.equal(evalOnce({ yaw: 35 }, "left", { blink: { left: 0.05, right: 0.9 } }).reason, "eyes-closed", "the near eye (an own-left turn shows the right eye) closed");
  assert.equal(evalOnce({ yaw: 35 }, "left", { blink: { left: 0.9, right: 0.05 } }).ok, true, "the far eye closed is fine");
  assert.equal(evalOnce({ yaw: 0 }, "front", { blink: { left: 0.9, right: 0.05 } }).reason, "eyes-closed", "Front needs both eyes open");
  assert.equal(evalOnce({ yaw: 35 }, "left", { lmPose: { yaw: -35 } }).reason, "uncertain", "the matrix and the landmarks disagree on the side");
  assert.equal(evalOnce({ yaw: 0 }, "left", { gaze: { outLeft: 0.6, inRight: 0.6 } }).reason, "eyes-only", "eyes to the left, head still");
  assert.equal(evalOnce(null, "front").reason, "no-face");
  // the raw frame must sit in the band too
  const o = obsOf({ yaw: 30 });
  const sobs = { ...o, pose: { yaw: 30, pitch: 0, roll: 0, src: "matrix" }, raw: { yaw: 20, pitch: 0, roll: 0, src: "matrix" }, yawL: 20,
    cx: o.primary.cx, cy: o.primary.cy, faceH: o.primary.faceH, blink: o.primary.blink, yawSpeed: 0, centreSpeed: 0 };
  const e = FP.evaluateFrame(sobs, "left", { luma: 128, prev: {} });
  assert.equal(e.ok, false, "smoothed in band, raw out of it"); assert.equal(e.base, "left");
  // and through the smoother: 24° held (stay band), then one frame at 21°
  const sm = FP.createSmoother(), prev = {}; let t = 0, last;
  for (const y of [30, 30, 30, 30, 30, 30, 30, 30, 30, 30]) last = FP.evaluateFrame(sm.push(obsOf({ yaw: y }), t += 100), "left", { luma: 128, prev });
  for (let i = 0; i < 15; i++) last = FP.evaluateFrame(sm.push(obsOf({ yaw: 24 }), t += 100), "left", { luma: 128, prev });
  assert.equal(last.ok, true, "24° stays in (hysteresis)");
  last = FP.evaluateFrame(sm.push(obsOf({ yaw: 21 }), t += 100), "left", { luma: 128, prev });
  assert.equal(last.base, "left", "smoothed still left"); assert.equal(last.ok, false, "but the raw 21° is out of the band");
  // every failing check is listed (Capture now asks about the ones that matter even when the first is light)
  const many = evalOnce({ yaw: 35 }, "left", { faces: [{ pose: { yaw: 35 }, dx: 22 }], luma: 30, blink: { left: 0.05, right: 0.9 } });
  assert.deepEqual(plainify(many.fails), ["two-faces", "dark", "eyes-closed"]); assert.equal(many.reason, "two-faces"); assert.equal(many.measured, "left");
  assert.deepEqual(plainify(evalOnce({ yaw: 0 }, "front").fails), []);
  assert.deepEqual(plainify(evalOnce({ yaw: 0 }, "left", { luma: 30 }).fails), ["not-turned", "dark"]);
  // a head never level enough is never let in by the looser "stay" tilt limits (held at pitch 17 / roll 9.5 on Front,
  // roll 15 / pitch 23 on a side, between the enter and stay limits) — and 24° never enters a side
  for (const [pose, target] of [[{ yaw: 0, pitch: 17 }, "front"], [{ yaw: 0, roll: 9.5 }, "front"], [{ yaw: 35, roll: 15 }, "left"], [{ yaw: 35, pitch: 23 }, "left"], [{ yaw: 24 }, "left"], [{ yaw: -24 }, "right"]]){
    const P = pipeline(target);
    const rows = P.run(pose, 8000);
    assert.ok(rows.every((x) => !x.ev.ok && !x.st.fire), JSON.stringify(pose) + " " + [...new Set(rows.map((x) => x.ev.reason))].join(" "));
  }
});

await test("P-e the smoother: 63% after 200 ms of steps (τ = 200 ms), resets after a 500 ms gap, reports speeds", () => {
  const sm = FP.createSmoother();
  sm.push(obsOf({ yaw: 0 }), 0);
  let s;
  for (let t = 10; t <= 200; t += 10) s = sm.push(obsOf({ yaw: 10 }), t);
  near(s.pose.yaw, 10 * (1 - Math.exp(-1)), 0.05, "after 200 ms");
  near(s.raw.yaw, 10, 1e-6, "raw is kept");
  const sm2 = FP.createSmoother();
  sm2.push(obsOf({ yaw: 0 }), 0);
  s = sm2.push(obsOf({ yaw: 10 }), 100);
  near(s.yawSpeed, 10 * (1 - Math.exp(-0.5)) / 0.1, 0.5, "yaw speed in °/s");
  assert.ok(s.centreSpeed < 0.25, "a turn alone barely moves the face box: " + s.centreSpeed);
  s = sm2.push(obsOf({ yaw: 10, }, { dx: 3 }), 200);
  assert.ok(s.centreSpeed > 0.1, "centre speed in faceH/s: " + s.centreSpeed);
  sm2.push(FP.observe(res(null), 1280, 720), 300);
  s = sm2.push(obsOf({ yaw: 30 }), 801);
  near(s.pose.yaw, 30, 1e-9, "a fresh start after more than 500 ms with no face");
  assert.equal(s.yawSpeed, 0);
  s = sm2.push(obsOf({ yaw: 30 }), 900);
  sm2.reset();
  s = sm2.push(obsOf({ yaw: -20 }), 950);
  near(s.pose.yaw, -20, 1e-9, "reset() on demand (after a photo is checked)");
});

await test("P-f the hold (10 fps): Front needs 3.0 s held, fires once; a side needs 5.0 s", () => {
  const P = pipeline("front");
  const rows = P.run({ yaw: 0 }, 2900);
  assert.ok(rows.every((r) => !r.st.fire), "no fire at 2.9 s");
  assert.equal(rows[0].st.started, true, "the hold starts on the first fitting frame");
  const t0 = rows[0].t;
  let r = P.frame({ yaw: 0 });
  assert.equal(r.t - t0, 2900); assert.equal(r.st.fire, false);
  r = P.frame({ yaw: 0 });
  assert.equal(r.t - t0, 3000); assert.equal(r.st.fire, true, "fires on the first frame ≥ 3.0 s");
  P.m.markCaptured(r.ev.base, r.t);
  const after = P.run({ yaw: 0 }, 10000);
  assert.ok(after.every((x) => !x.st.fire), "exactly once: the same still pose never fires again");
  const S = pipeline("left");
  const s1 = S.run({ yaw: 35 }, 4900);
  assert.ok(s1.every((x) => !x.st.fire), "no fire at 4.9 s"); assert.equal(s1[0].st.started, true);
  assert.deepEqual([s1[s1.length - 1].st.secsLeft, s1[0].st.secsLeft], [1, 5]);
  r = S.frame({ yaw: 35 }); assert.equal(r.st.fire, false);
  r = S.frame({ yaw: 35 }); assert.equal(r.t - s1[0].t, 5000); assert.equal(r.st.fire, true, "fires at 5.0 s");
});

await test("P-g the owner's case: after Front, a still front face never fills the left slot; a face held at +35 never fills the right one", () => {
  const P = pipeline("front");
  let r; do { r = P.frame({ yaw: 0 }); } while (!r.st.fire);
  P.m.markCaptured(r.ev.base, r.t);
  P.target = "left"; const t1 = P.t + 280; P.t = t1; P.m.retarget(t1);
  const rows = P.run({ yaw: 0 }, 30000);
  assert.ok(rows.every((x) => !x.st.fire), "frontal for 30 s: never fires");
  assert.ok(rows.every((x) => x.st.reason === "not-turned" || x.st.phase === "settle"), [...new Set(rows.map((x) => x.st.phase + ":" + x.st.reason))].join(" "));
  const firstHint = rows.find((x) => x.st.hint);
  assert.ok(firstHint, "a hint after 20 s"); near(firstHint.t - t1, 20000, 100, "the hint at 20 s");
  assert.equal(firstHint.st.hint, "not-turned");
  const cue = FP.cueFor(firstHint.st, firstHint.ev, "left", {});
  assert.equal(cue.key, "not-turned");
  assert.equal(cue.hint, "Turn your whole head until the dot reaches the green band — or press Capture now.");
  // now turn to the left: captured; then the right slot while still at +35
  let fired = null;
  for (const x of P.run({ yaw: 35 }, 8000)) if (x.st.fire && !fired) fired = x;
  assert.ok(fired, "turned to the left: captured");
  P.m.markCaptured(fired.ev.base, fired.t);
  P.target = "right"; P.m.retarget(P.t);
  const rr = P.run({ yaw: 35 }, 30000);
  assert.ok(rr.every((x) => !x.st.fire), "held at +35 for 30 s: the right slot never fires");
  const late = rr.slice(20);
  assert.ok(late.every((x) => x.st.reason === "wrong-way"), [...new Set(late.map((x) => x.st.reason))].join(" "));
});

await test("P-q holding means staying put: a sway or a slow drift inside the angle band never completes a hold; ±1.5° jitter does (owner 2026-10-10)", () => {
  // the verifier's probes: these used to fire after ~5 s
  const sway = (amp, hz) => { const S = pipeline("left"); let fired = false;
    for (let i = 0; i < 150; i++){ const yaw = 37 + amp * Math.sin(2 * Math.PI * hz * (i / 10)); if (S.frame({ yaw }).st.fire) { fired = true; break; } }
    return fired; };
  assert.equal(sway(10, 1), false, "±10° at 1 Hz (27–47°) for 15 s: no photo");
  assert.equal(sway(7, 0.5), false, "±7° at 0.5 Hz: no photo");
  const D = pipeline("left"); let fired = false;
  for (let i = 0; i < 20; i++){ if (D.frame({ yaw: 28 + i * 1.0 }).st.fire) fired = true; }   // 10°/s drift through the band
  assert.equal(fired, false, "a slow drift: no photo");
  const J = pipeline("left"); let at = null;
  for (let i = 0; i < 80 && at == null; i++){ const r = J.frame({ yaw: 35 + ((i % 3) - 1) * 1.5, pitch: ((i % 2) ? 1 : -1) }); if (r.st.fire) at = r.t; }
  assert.ok(at != null && at <= 5200, "a real hold with small jitter still captures at 5 s (" + at + ")");
  const F = pipeline("front"); let ff = false;
  for (let i = 0; i < 60; i++){ if (F.frame({ yaw: (i % 2 ? 7 : -7) }).st.fire) ff = true; }
  assert.equal(ff, false, "a front face shaking ±7°: no photo");
});

await test("P-h resets: a 600 ms dip to 18° resets (a full 5.0 s from re-entry); a 300 ms dip doesn't, and can't fire during the dip", () => {
  // through the whole chain
  const P = pipeline("left");
  const a = P.run({ yaw: 35 }, 3000);
  const t0 = a[0].t;
  const dip = P.run({ yaw: 18 }, 600);
  assert.equal(dip[dip.length - 1].st.progress, 0, "progress back to 0");
  assert.ok(dip.some((x) => x.st.reset), "a reset is reported (the hold had passed 1 s)");
  const back = P.run({ yaw: 35 }, 8000);
  const reentry = back.find((x) => x.ev.ok), fire = back.find((x) => x.st.fire);
  assert.ok(reentry && fire);
  assert.equal(fire.t - reentry.t, 5000, "a full 5.0 s from re-entry");
  assert.ok(fire.t - t0 > 5000);
  // the machine itself, frame by frame (10 fps)
  const m = FP.createHoldMachine(), ctx = { target: "left", filled: false, auto: true, engine: "ready" };
  let t = 0, st;
  for (; t < 4800; t += 100) st = m.step(EV(true, "left"), t, ctx);
  const during = [];
  for (let k = 0; k < 3; k++, t += 100) during.push(m.step(EV(false, "partial-left", "more"), t, ctx));   // 4.8 … 5.0 s
  assert.ok(during.every((x) => !x.fire), "no fire during the dip, even past 5 s");
  assert.ok(during.every((x) => x.phase === "holding" && x.progress > 0.9), "the timer keeps running in the 400 ms grace");
  st = m.step(EV(true, "left"), t, ctx);
  assert.equal(st.fire, true, "the first fitting frame after a short dip fires (no reset)");
  const m2 = FP.createHoldMachine();
  for (t = 0; t < 3000; t += 100) m2.step(EV(true, "left"), t, ctx);
  for (let k = 0; k < 6; k++, t += 100) st = m2.step(EV(false, "partial-left", "more"), t, ctx);
  assert.equal(st.progress, 0); assert.equal(st.phase, "wait");
  const re = t;
  for (; ; t += 100){ st = m2.step(EV(true, "left"), t, ctx); if (st.fire) break; if (t > 20000) break; }
  assert.equal(t - re, 5000);
});

await test("P-h2 what the frames can't show breaks a hold: no frame for over 400 ms (a hidden tab, an open dialog, a restart); a second face at once and for 1.5 s after; an uncertain direction at once; never 'Hold still — 0'", () => {
  const ctx = { target: "left", filled: false, auto: true, engine: "ready" };
  let m = FP.createHoldMachine(), t, st;
  for (t = 0; t <= 1000; t += 100) st = m.step(EV(true, "left"), t, ctx);
  st = m.step(EV(true, "left"), 11000, ctx);
  assert.equal(st.fire, false, "10 s unseen never counts as held"); assert.equal(st.started, true, "a fresh hold starts");
  let fireAt = null;
  for (t = 11100; t < 20000; t += 100){ st = m.step(EV(true, "left"), t, ctx); if (st.fire){ fireAt = t; break; } }
  assert.equal(fireAt, 16000, "a full 5 s from the first frame back");
  m = FP.createHoldMachine();
  for (t = 0; t <= 2000; t += 100) m.step(EV(true, "left"), t, ctx);
  st = m.step(EV(true, "left"), 2400, ctx); assert.equal(st.started, false, "a 400 ms step (a slow frame) is no break");
  // a second face the detector sees only some of the time never lets the shutter fire
  for (const every of [2, 3, 4]){
    const P = pipeline("left"); let fired = false;
    for (let i = 0; i < 150; i++){ const r = P.frame({ yaw: 35 }, i % every === 0 ? { faces: [{ pose: { yaw: 35 }, dx: 22 }] } : {}); if (r.st.fire) fired = true; }
    assert.equal(fired, false, "a second face in 1 of every " + every + " frames");
  }
  const P = pipeline("left");
  P.run({ yaw: 35 }, 3000);
  const two = P.frame({ yaw: 35 }, { faces: [{ pose: { yaw: 35 }, dx: 22 }] });
  assert.equal(two.st.progress, 0, "one frame with a second face ends the hold at once"); assert.equal(two.st.reset, "two-faces");
  const gone = two.t; let f = null;
  for (let i = 0; i < 100 && !f; i++){ const r = P.frame({ yaw: 35 }); if (r.st.fire) f = r.t; }
  assert.equal(f - gone, 6500, "blocked for 1.5 s after it was last seen, then a full 5 s");
  m = FP.createHoldMachine();
  for (t = 0; t <= 3000; t += 100) m.step(EV(true, "left"), t, ctx);
  st = m.step({ ok: false, reason: "uncertain", fails: ["uncertain"], base: "left", measured: "left" }, 3100, ctx);
  assert.equal(st.progress, 0, "an uncertain direction ends the hold at once"); assert.equal(st.reset, "uncertain");
  m = FP.createHoldMachine();
  for (t = 0; t < 4900; t += 100) m.step(EV(true, "left"), t, ctx);
  const shown = [];
  for (; t <= 5300; t += 100){ st = m.step(EV(false, "partial-left", "more"), t, ctx); if (st.phase === "holding") shown.push(st.secsLeft); }
  assert.ok(shown.length && shown.every((n) => n >= 1), "a dip after the hold time shows 1, not 0: " + shown);
  assert.equal(FP.cueFor({ phase: "holding", secsLeft: shown[0] }, null, "left", {}).text, "Hold still — 1");
});

await test("P-i leave first: after a capture nothing counts until the captured pose is left (≥ 300 ms) plus a 1.2 s pause; × (cleared) is a deliberate retake", () => {
  const m = FP.createHoldMachine(), ctx = { target: "left", filled: false, auto: true, engine: "ready" };
  m.markCaptured("left", 1000);
  let st = m.step(EV(true, "left"), 1500, ctx);
  assert.equal(st.phase, "settle"); assert.equal(st.fire, false);
  st = m.step(EV(true, "left"), 2199, ctx); assert.equal(st.phase, "settle");
  for (let t = 2200; t < 12000; t += 100){ st = m.step(EV(true, "left"), t, ctx); assert.equal(st.fire, false); }
  assert.equal(st.phase, "arming"); assert.equal(st.reason, "change-pose"); assert.equal(st.progress, 0);
  // leaving: the base must be something else for ≥ 300 ms
  st = m.step(EV(false, "front", "not-turned"), 12000, ctx); assert.equal(st.phase, "arming");
  st = m.step(EV(false, "front", "not-turned"), 12200, ctx); assert.equal(st.phase, "arming");
  st = m.step(EV(true, "left"), 12250, ctx); assert.equal(st.phase, "arming", "back too soon: still arming");
  st = m.step(EV(false, "front", "not-turned"), 12300, ctx);
  st = m.step(EV(false, "front", "not-turned"), 12500, ctx); assert.equal(st.phase, "arming");
  st = m.step(EV(false, "front", "not-turned"), 12600, ctx); assert.equal(st.phase, "wait", "300 ms away: armed");
  // cleared(): a fresh capture needs a full new 5 s hold
  const m2 = FP.createHoldMachine();
  m2.markCaptured("left", 0);
  m2.cleared(5000);
  let t = 5000, fireAt = null;
  for (; t < 12000; t += 100){ st = m2.step(EV(true, "left"), t, ctx); if (st.fire){ fireAt = t; break; } }
  assert.equal(fireAt, 10000, "a full 5 s after the slot was cleared");
  // a slot click (retarget) does NOT clear the leave-first rule
  const m3 = FP.createHoldMachine();
  m3.markCaptured("left", 0); m3.retarget(2000);
  for (t = 2000; t < 9000; t += 100){ st = m3.step(EV(true, "left"), t, ctx); assert.equal(st.fire, false); }
  // a measured base that isn't the target counts too: a still person can never fill two slots
  const m4 = FP.createHoldMachine(), r4 = { ...ctx, target: "right" };
  m4.markCaptured("front", 0); m4.retarget(300);
  for (t = 300; t < 30000; t += 100){ st = m4.step(EV(false, "front", "not-turned"), t, r4); assert.equal(st.fire, false); }
});

await test("P-j manual / filled / loading; canAutoCapture; the confirmations (their titles follow what the frame shows)", () => {
  const m = FP.createHoldMachine();
  assert.equal(m.step(EV(true, "front"), 0, { target: "front", auto: false, engine: "ready" }).phase, "manual");
  assert.equal(m.step(EV(true, "front"), 0, { target: "front", auto: true, filled: true, engine: "ready" }).phase, "filled");
  assert.equal(m.step(EV(true, "front"), 0, { target: "front", auto: true, engine: "loading" }).phase, "loading");
  for (const s of ["manual", "filled", "loading"]) assert.equal(FP.cueFor({ phase: s }, null, "left", {}).key, s);
  assert.equal(FP.canAutoCapture("left", "unavailable"), false);
  assert.equal(FP.canAutoCapture("right", "unavailable"), false);
  assert.equal(FP.canAutoCapture("front", "unavailable"), true);
  for (const x of ["front", "left", "right"]){ assert.equal(FP.canAutoCapture(x, "loading"), false); assert.equal(FP.canAutoCapture(x, "ready"), true); }
  const c1 = FP.confirmFor("C1", "left", "front");
  assert.deepEqual(plainify(c1), { title: "This doesn't look turned to your left", body: "It shows a front view. Use it for “Your left” anyway?",
    confirmLabel: "Use it anyway", cancelLabel: "Try again", safeDefault: true });
  assert.equal(FP.confirmFor("C1", "front", "left").title, "This doesn't look like a front view");
  assert.equal(FP.confirmFor("C1", "front", "left").body, "It shows your head turned to your left. Use it for “Front” anyway?");
  assert.deepEqual([FP.confirmFor("C1", "left", "partial-left").title, FP.confirmFor("C1", "left", "partial-left").body],
    ["Not turned far enough", "It shows your head only a little turned. Use it for “Your left” anyway?"]);
  assert.deepEqual([FP.confirmFor("C1", "right", "far-right").title, FP.confirmFor("C1", "right", "far-right").body],
    ["Turned too far", "It shows your head turned almost side-on. Use it for “Your right” anyway?"]);
  assert.deepEqual([FP.confirmFor("C1", "left", "right").title, FP.confirmFor("C1", "left", "right").body],
    ["This doesn't look turned to your left", "It shows your head turned to your right. Use it for “Your left” anyway?"]);
  assert.equal(FP.confirmFor("C1", "left", "partial-right").title, "This doesn't look turned to your left", "a little to the OTHER side isn't 'not far enough'");
  const c2 = FP.confirmFor("C2", "right", null);
  assert.equal(c2.title, "The pose couldn't be checked");
  assert.equal(c2.body, "Make sure your head is turned to your right — toward the right edge of the screen. Use this frame for “Your right”?");
  assert.equal(c2.confirmLabel, "Use this frame");
  const c3 = FP.confirmFor("C3", "left", "partial-left");
  assert.deepEqual([c3.title, c3.body, c3.confirmLabel, c3.cancelLabel], ["This photo isn't turned far enough",
    "It shows the head only a little turned. For “Your left”, pick a photo of the person turned to their own left — their nose points to the right in the photo. Put this one in anyway?",
    "Use it anyway", "Choose another"]);
  assert.equal(FP.confirmFor("C3", "right", "front").body,
    "It shows a front view. For “Your right”, pick a photo of the person turned to their own right — their nose points to the left in the photo. Put this one in anyway?");
  assert.equal(FP.confirmFor("C3", "front", "far-right").title, "This photo doesn't look like a front view");
  assert.equal(FP.confirmFor("C3", "front", "right").body, "It shows the head turned to the person's right. Put this one in anyway?");
  assert.deepEqual([FP.confirmFor("C4", "front", null).title, FP.confirmFor("C4", "front", null).body], ["No face found", "Use this frame for “Front” anyway?"]);
  assert.equal(FP.confirmFor("C4", "left", null, { photo: true }).body, "Use this photo for “Your left” anyway?");
  const C5 = (r, t = "left", o = {}) => { const c = FP.confirmFor("C5", t, null, { reason: r, ...o }); return [c.title, c.body]; };
  assert.deepEqual(C5("two-faces"), ["Someone else is in the picture", "Only the person whose likeness this is should be in it. Use this frame for “Your left” anyway?"]);
  assert.deepEqual(C5("two-faces", "front", { photo: true }), ["Someone else is in the photo", "Only the person whose likeness this is should be in it. Use this photo for “Front” anyway?"]);
  assert.deepEqual(C5("uncertain"), ["The direction couldn't be confirmed", "Make sure your head is turned to your left — toward the left edge of the screen. Use this frame for “Your left” anyway?"]);
  assert.deepEqual(C5("eyes-closed", "right"), ["Your eyes look closed", "Use this frame for “Your right” anyway?"]);
  assert.equal(C5("far")[0], "Your face looks small in the picture"); assert.equal(C5("close")[0], "Your face is very close"); assert.equal(C5("offcenter")[0], "Your face isn't centered");
  assert.equal(FP.confirmFor("C5", "left", null, { reason: "far" }).safeDefault, true);
  const flip = FP.confirmFor("flip");
  assert.equal(flip.title, "Is the preview like a mirror?"); assert.match(flip.body, /writing should read backwards\. If it reads normally, your camera already flips its picture/);
  assert.deepEqual([flip.confirmLabel, flip.cancelLabel, flip.safeDefault], ["It reads normally — switch it back", "It reads backwards — keep it", true]);
  assert.equal(FP.confirmFor("unflip").title, "Switch back to the usual mirror view?");
  const lock = FP.confirmFor("lock", null, null, { count: 2, items: ["a", "b"] });
  assert.deepEqual([lock.title, lock.confirmLabel, lock.cancelLabel, lock.safeDefault, plainify(lock.items)], ["Two photos look like the wrong angle", "Lock anyway", "Retake first", true, ["a", "b"]]);
  assert.equal(FP.confirmFor("lock", null, null, { count: 1 }).title, "One photo looks like the wrong angle");
  assert.deepEqual(["front", "partial-left", "far-right", "left", "right", "tilted", "none"].map((c) => FP.describeClass(c, "the person's")),
    ["a front view", "the head only a little turned", "the head turned almost side-on", "the head turned to the person's left", "the head turned to the person's right", "a tilted head", "no face"]);
  assert.deepEqual(["partial-right", "left"].map((c) => FP.describeClass(c, "your")), ["your head only a little turned", "your head turned to your left"]);
});

await test("P-k a camera that flips its picture: mirroredSource swaps the sides back; the meter puts the person's left on the screen's left", () => {
  const raw = obsOf({ yaw: 35, roll: 6 }, { blink: { left: 0.1, right: 0.7 }, gaze: { outLeft: 0.8 } });
  const flip = FP.observe(res({ yaw: 35, roll: 6 }, { blink: { left: 0.1, right: 0.7 }, gaze: { outLeft: 0.8 } }), 1280, 720, { mirroredSource: true });
  near(flip.primary.pose.yaw, -raw.primary.pose.yaw, 1e-9); near(flip.primary.pose.roll, -raw.primary.pose.roll, 1e-9);
  near(flip.primary.yawL, -raw.primary.yawL, 1e-9);
  assert.deepEqual(plainify(flip.primary.blink), { left: 0.7, right: 0.1 });
  assert.equal(flip.primary.gaze.toRight, raw.primary.gaze.toLeft);
  assert.equal(FP.classifyPose(flip.primary.pose).base, "right", "+35 in a flipped picture is the person's right");
  assert.ok(FP.meterPos(35) < 50 && 50 < FP.meterPos(-35));
  assert.equal(FP.meterPos(0), 50); assert.equal(FP.meterPos(90), 0); assert.equal(FP.meterPos(-90), 100);
  const L = FP.bandFor("left"), R = FP.bandFor("right"), F = FP.bandFor("front");
  near(L.from, 10, 1e-9); near(L.to, 50 - 25 / 60 * 50, 1e-9); near(R.from, 50 + 25 / 60 * 50, 1e-9); near(R.to, 90, 1e-9);
  near(F.from, 43.33, 0.01); near(F.to, 56.67, 0.01);
  assert.ok(L.to < 50 && R.from > 50);
});

const VENDOR_RE = /mediapipe|google|tensorflow|wasm|webgl|landmarker|vision/i;
await test("P-l the copy: one person's left, both ways said; no library, engine or vendor named anywhere the person reads", () => {
  const ww = FP.cueFor({ phase: "wait", reason: "wrong-way" }, null, "left", {});
  assert.equal(ww.text, "That's your right — turn the other way, to your left"); assert.equal(ww.k, "warn");
  assert.deepEqual(plainify(ww.voice), ["wrong-way-left"], "said: " + FP.VOICE_LINES.find((l) => l.id === "wrong-way-left").text);
  const nt = FP.cueFor({ phase: "wait", reason: "not-turned" }, null, "left", {});
  assert.ok(nt.text.includes("your left") && nt.text.includes("left edge of the screen"), nt.text);
  assert.deepEqual(plainify(nt.voice), ["turn-left"]);
  const ntR = FP.cueFor({ phase: "wait", reason: "not-turned" }, null, "right", {});
  assert.equal(ntR.text, "Turn your head to your right — toward the right edge of the screen");
  assert.equal(FP.cueFor({ phase: "holding", secsLeft: 4 }, null, "left", {}).text, "Hold still — 4");
  assert.deepEqual(plainify(FP.cueFor({ phase: "settle" }, null, "front", { next: "left" }).voice), ["got-it", "turn-left"]);
  assert.deepEqual(plainify(FP.cueFor({ phase: "settle" }, null, "left", { next: "right", engine: "unavailable" }).voice), ["got-it", "turn-right-capture"]);
  assert.deepEqual(plainify(FP.cueFor({ phase: "settle" }, null, "right", { next: null }).voice), ["got-it", "all-done"]);
  assert.equal(FP.nextStepLine("front"), "Look straight at the camera.");
  assert.equal(FP.nextStepLine(null), "All three done. Say whose likeness it is, tick the box, and lock it.");
  assert.equal(FP.nextStepLine("right", "unavailable"), "Turn your head to your right, then press Capture now.");
  assert.equal(FP.cueFor({ phase: "filled" }, null, "left", { mismatch: true, measured: "front" }).text,
    "This photo shows a front view — click × on it to take it again");
  assert.equal(FP.cueFor({ phase: "filled" }, null, "right", { mismatch: true, measured: "left" }).text,
    "This photo shows the head turned to the person's left — click × on it to take it again");
  // a set with photos marked as the wrong angle isn't "all three done"
  const m1 = FP.cueFor({ phase: "filled" }, null, "left", { allDone: true, mismatch: true, mismatchCount: 2, measured: "front" });
  assert.equal(m1.key, "filled-mismatch", "the marked slot on screen says so, even with all three filled");
  const m2 = FP.cueFor({ phase: "filled" }, null, "front", { allDone: true, mismatch: false, mismatchCount: 2 });
  assert.deepEqual([m2.key, m2.k, m2.text], ["check-marked", "warn", "Two photos look like the wrong angle — click × on each one marked ! to take it again"]);
  assert.equal(FP.cueFor({ phase: "filled" }, null, "front", { allDone: true, mismatchCount: 1 }).text, "One photo looks like the wrong angle — click × on the one marked ! to take it again");
  assert.equal(FP.cueFor({ phase: "filled" }, null, "front", { allDone: true, mismatchCount: 0 }).key, "complete");
  assert.equal(FP.cueFor({ phase: "manual" }, null, "left", { mismatch: true, measured: "front" }).key, "filled-mismatch", "with automatic capture off too");
  // before the camera answers (the browser is asking): no "getting ready"
  assert.deepEqual([FP.cueFor({ phase: "camera" }, null, "front", { engine: "loading" }).key, FP.cueFor({ phase: "camera" }, null, "front", {}).text],
    ["camera", "Allow the camera to start — or upload a photo"]);
  // the screen-reader line after a photo
  assert.equal(FP.srCapturedLine("left", "right", "ready"), "Photo taken: turned to your left. Next, turn your head slowly to your right, toward the right edge of the screen, and hold it there for five seconds.");
  assert.equal(FP.srCapturedLine("front", "left", "ready"), "Photo taken: front view. Next, turn your head slowly to your left, toward the left edge of the screen, and hold it there for five seconds.");
  assert.equal(FP.srCapturedLine("right", "front", "ready"), "Photo taken: turned to your right. Next, look straight at the camera.");
  assert.equal(FP.srCapturedLine("right", null, "ready"), "Photo taken: turned to your right. All three done. Say whose likeness it is, tick the box, and lock it.");
  assert.equal(FP.cueFor({ phase: "wait" }, null, "left", { engine: "unavailable" }).text, "Turn your head to your left, then press Capture now");
  assert.equal(FP.cueFor({ phase: "wait", reason: "moving" }, null, "front", { engine: "unavailable" }).key, "unavailable-front");
  assert.equal(FP.cueFor({ phase: "loading" }, null, "front", { slow: true }).text, "Still getting ready — you can press Capture now");
  assert.equal(FP.cueFor({ phase: "wait", reason: "wrong-way", hint: "wrong-way" }, null, "right", {}).hint, "You're turning to your left; turn the other way — or press Capture now.");
  // every string the person can read or hear
  const strings = [];
  for (const [k, c] of Object.entries(FP.CUES)){ strings.push(c.text); assert.ok(["wait", "go", "done", "off", "warn"].includes(c.k), k); }
  strings.push(...FP.VOICE_LINES.map((l) => l.text));
  strings.push(...Object.values(FP.HINTS));
  for (const v of Object.values(FP.LINES)) typeof v === "string" ? strings.push(v) : strings.push(...Object.values(v));
  for (const kind of ["C1", "C2", "C3", "C4", "C5", "flip", "unflip", "lock"]) for (const t of ["front", "left", "right"])
    for (const m of ["front", "left", "partial-right", "far-left", "tilted", "none"]) for (const reason of ["two-faces", "uncertain", "eyes-closed", "far", "close", "offcenter", "x"]) for (const photo of [true, false]){
      const c = FP.confirmFor(kind, t, m, { photo, reason, count: 2, items: [] }); strings.push(c.title, c.body, c.confirmLabel, c.cancelLabel || "");
    }
  for (const k of ["front", "left", "right"]) for (const n of [null, "front", "left", "right"]) for (const e of ["ready", "unavailable"]) strings.push(FP.srCapturedLine(k, n, e));
  for (const r of Object.keys(FP.CUES)) for (const t of ["front", "left", "right"]){
    const c = FP.cueFor({ phase: "wait", reason: r, hint: r, secsLeft: 3 }, null, t, { next: "left" }); strings.push(c.text, c.hint || "");
  }
  const bad = strings.filter((s) => VENDOR_RE.test(String(s)));
  assert.deepEqual(bad, [], "no vendor / library / engine names");
  // …and in the capture window's own copy (every literal in app/cameo.jsx)
  const lits = [];
  const ast = parseSync(read("app/cameo.jsx"), { filename: "app/cameo.jsx", babelrc: false, configFile: false, sourceType: "script", presets: [require.resolve("@babel/preset-react")] });
  traverse(ast, { enter(p){ const n = p.node; if (n.type === "StringLiteral") lits.push(n.value); else if (n.type === "TemplateElement") lits.push(n.value.cooked); else if (n.type === "JSXText") lits.push(n.value); } });
  assert.deepEqual(lits.filter((s) => VENDOR_RE.test(s)), [], "cameo.jsx names no library or vendor");
  assert.ok(!/\bTURN\b|\bMUSE\b|Cinema ?Machine/.test(strings.join("\n")));
});

await test("P-m timestamps strictly increase; load errors map to four codes (no library text reaches the page)", () => {
  let last = 0; const seen = [];
  for (const now of [100, 100, 99, 50, 200, 200, 150]){ last = FP.nextTs(last, now); seen.push(last); }
  assert.deepEqual(seen, [100, 101, 102, 103, 200, 201, 202]);
  const E = (m, code) => { const e = new Error(m); if (code) e.code = code; return e; };
  assert.equal(FP.mapLoadError(E("x", "unsupported")), "unsupported");
  assert.equal(FP.mapLoadError(E("x", "timeout")), "timeout");
  assert.equal(FP.mapLoadError(E("TypeError: Failed to fetch")), "offline");
  assert.equal(FP.mapLoadError(E("HTTP 404 on face_landmarker.task")), "offline");
  assert.equal(FP.mapLoadError(E("NetworkError when attempting to fetch resource.")), "offline");
  assert.equal(FP.mapLoadError(E("Aborted(). Build with -sASSERTIONS for more info.")), "failed");
  assert.equal(FP.mapLoadError(null), "failed");
  // the library's script loader rejects with the script's error EVENT (a missing file, a dropped connection)
  assert.equal(FP.mapLoadError({ type: "error", target: {} }), "offline");
  assert.equal(FP.mapLoadError("Aborted()"), "failed");
});

await test("P-n the vendored files (sizes + sha256), serve.js types and caching, TURN.html order, dist", () => {
  const serve = read("serve.js");
  assert.ok(serve.includes('".wasm": "application/wasm"') && serve.includes('".task": "application/octet-stream"'));
  assert.ok(serve.includes('urlPath.startsWith("/app/vendor/") ? "public, max-age=31536000, immutable" : "no-cache"'));
  const V = "app/vendor/face/v1.1.0/";
  const files = { "vision_bundle.js": [156161, "022cbbfcdb74bae18e4bbc722e429e046d5fdd35f6183f1359c56b652b8b87f7"],
    "vision_wasm_internal.js": [335393, "7c652617b5bef832f42878ce8c5f752b0724bca6054e4bc1013a37d4b1949723"],
    "vision_wasm_internal.wasm": [12997248, "782eda3ec1f414fdb4f1d66a8b59093eb4d5ab437e06117796abf05962d68eef"],
    "face_landmarker.task": [3758596, "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"] };
  for (const [f, [size, sha]] of Object.entries(files)){
    const buf = readFileSync(new URL(V + f, ROOT));
    assert.equal(buf.length, size, f); assert.equal(createHash("sha256").update(buf).digest("hex"), sha, f);
  }
  assert.ok(read(V + "LICENSE").includes("Apache License") && read(V + "LICENSE").includes("Version 2.0, January 2004"));
  const readme = read(V + "README.txt");
  for (const s of ["@mediapipe/tasks-vision 1.1.0", "float16/1/face_landmarker.task", "Copyright The MediaPipe Authors, Apache-2.0", "installNetGuard", ...Object.values(files).map((x) => x[1])])
    assert.ok(readme.includes(s), s);
  assert.ok(!existsSync(new URL(V + "vision_wasm_nosimd_internal.wasm", ROOT)), "no no-SIMD build shipped");
  assert.ok(read(".gitattributes").includes("app/vendor/** binary"));
  const html = read("TURN.html");
  const a = html.indexOf('<script src="app/face-pose.js?v='), b = html.indexOf('src="app/cameo.jsx?v=');
  assert.ok(a > 0 && a < b, "face-pose.js loads right before cameo.jsx");
  assert.ok(!/type="text\/babel" src="app\/face-pose/.test(html), "a plain script (no Babel)");
  assert.ok(FACE_SRC.includes('"app/vendor/face/v1.1.0/"'));
  if (existsSync(new URL("dist/index.html", ROOT))){
    assert.ok(existsSync(new URL("dist/app/vendor/face/v1.1.0/vision_wasm_internal.wasm", ROOT)), "dist has the vendored model");
    assert.equal(statSync(new URL("dist/app/vendor/face/v1.1.0/face_landmarker.task", ROOT)).size, 3758596);
    const di = read("dist/index.html");
    assert.ok(di.indexOf("app/face-pose.js") > 0 && di.indexOf("app/face-pose.js") < di.indexOf("app/cameo.js"), "dist/index.html keeps the order");
    assert.ok(existsSync(new URL("dist/app/face-pose.js", ROOT)));
  }
  // a classic script with one global and no DOM at load time (it just ran in a bare vm above)
  assert.ok(/^\(function\(root\)\{/m.test(FACE_SRC) && FACE_SRC.includes("root.turnFacePose = {"));
});

await test("P-o the fetch guard answers the metrics request locally, once per page, and passes every other request through", async () => {
  const calls = [];
  const box = { console, Promise, String, Response: class { constructor(b, o){ this.status = o && o.status; } } };
  box.fetch = async (u) => { calls.push(String(u)); return { status: 200 }; };
  box.window = box; vm.createContext(box);
  vm.runInContext(FACE_SRC, box);
  box.turnFacePose.installNetGuard(); box.turnFacePose.installNetGuard();
  const r = await box.fetch("https://odml.pa.googleapis.com/v1/log", { method: "POST" });
  assert.equal(r.status, 204); assert.deepEqual(calls, [], "never sent");
  const r2 = await box.fetch({ url: "https://odml.pa.googleapis.com/v1/log?x=1" });
  assert.equal(r2.status, 204);
  await box.fetch("http://127.0.0.1/app/vendor/face/v1.1.0/face_landmarker.task");
  assert.deepEqual(calls, ["http://127.0.0.1/app/vendor/face/v1.1.0/face_landmarker.task"]);
  assert.equal(box.__turnFaceNetGuard, true);
  // a page where the guard was pre-set (the browser test's control) is left alone
  const b2 = { console, Promise, String }; const f2 = async () => ({}); b2.fetch = f2; b2.__turnFaceNetGuard = true; b2.window = b2;
  vm.createContext(b2); vm.runInContext(FACE_SRC, b2); b2.turnFacePose.installNetGuard();
  assert.equal(b2.fetch, f2);
});

/* load() in a vm of its own: a fake library (Vision), fake files served chunk by chunk, real timers */
function loadBox(o = {}){
  const pending = new Set();
  const L = { calls: [], signals: [], created: [], closedLm: 0, blobs: [], revoked: [], pending };
  class FakeURL extends URL {
    static createObjectURL(b){ L.blobs.push(b); return "blob:http://127.0.0.1:1/b" + L.blobs.length; }
    static revokeObjectURL(u){ L.revoked.push(u); }
  }
  const box = { console, Promise, Math, JSON, Date, Object, Array, Number, String, Error, Uint8Array, isFinite, AbortController,
    URL: FakeURL, WebAssembly: {}, Response: class { constructor(b, x){ this.status = x && x.status; } },
    Blob: class { constructor(parts, x){ this.parts = parts; this.type = x && x.type; } },
    setTimeout: (fn, ms) => { const id = setTimeout(() => { pending.delete(id); fn(); }, ms); pending.add(id); return id; },
    clearTimeout: (id) => { clearTimeout(id); pending.delete(id); },
    document: { baseURI: "http://127.0.0.1:1/TURN.html", head: { appendChild: noop },
      createElement: (t) => t === "canvas" ? { getContext: (k) => k === "webgl2" ? { getExtension: () => ({ loseContext: noop }) } : null } : {} } };
  box.Vision = { FilesetResolver: { isSimdSupported: async () => o.simd !== false },
    FaceLandmarker: { createFromOptions: (fs, opts) => { L.created.push({ fs, opts }); return o.create ? o.create(L) : Promise.resolve({ close(){ L.closedLm++; }, detectForVideo: () => ({}) }); } } };
  /* each file: o.files[name] = { size, chunks, gapMs, stallAt } (stallAt: the chunk after which nothing more comes) */
  box.fetch = (url, init) => {
    L.calls.push(url); L.signals.push(init && init.signal);
    const name = url.slice(url.lastIndexOf("/") + 1), f = (o.files || {})[name] || { size: 64, chunks: 2, gapMs: 1 };
    if (f.status) return Promise.resolve({ ok: false, status: f.status, headers: { get: () => null } });
    const per = Math.ceil(f.size / f.chunks); let i = 0;
    const reader = { cancel: noop, read: () => new Promise((res, rej) => {
      const sig = init && init.signal;
      if (sig && sig.aborted) return rej(new Error("AbortError"));
      if (sig) sig.addEventListener("abort", () => rej(new Error("AbortError")));
      if (f.stallAt != null && i >= f.stallAt) return;   // nothing more, ever
      if (i >= f.chunks) return res({ done: true });
      setTimeout(() => { const n = Math.min(per, f.size - i * per); i++; res({ done: false, value: new Uint8Array(n).fill(i) }); }, f.gapMs || 1);
    }) };
    return Promise.resolve({ ok: true, status: 200, headers: { get: (k) => k === "content-length" && !f.noLength ? String(f.size) : null }, body: { getReader: () => reader } });
  };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(FACE_SRC, box, { filename: "app/face-pose.js" });
  Object.assign(box.turnFacePose.LOAD, { stallMs: 80, createMs: 120, bundleMs: 200, noStreamMs: 200 }, o.load || {});
  L.box = box; L.FP = box.turnFacePose;
  return L;
}
const codeOf = async (p) => { try { await p; return "ok"; } catch (e) { return e && e.code; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await test("P-p load(): the engine and the model are read here with progress and handed over from memory; only a STALL times out (a slow line just takes longer); closing aborts; no timer outlives it", async () => {
  // a slow but steady download: 12 chunks 30 ms apart (360 ms, over 4× the 80 ms stall limit) → ready
  let L = loadBox({ files: { "vision_wasm_internal.wasm": { size: 1200, chunks: 12, gapMs: 30 }, "face_landmarker.task": { size: 300, chunks: 3, gapMs: 30, noLength: true } } });
  const eng = await L.FP.load();
  assert.ok(eng && typeof eng.detect === "function");
  assert.deepEqual(L.calls, ["http://127.0.0.1:1/app/vendor/face/v1.1.0/vision_wasm_internal.wasm", "http://127.0.0.1:1/app/vendor/face/v1.1.0/face_landmarker.task"]);
  const { fs, opts } = L.created[0];
  assert.equal(fs.wasmLoaderPath, "http://127.0.0.1:1/app/vendor/face/v1.1.0/vision_wasm_internal.js");
  assert.equal(fs.wasmBinaryPath, "blob:http://127.0.0.1:1/b1", "the engine from memory (a local blob), not fetched twice");
  assert.equal(L.blobs[0].type, "application/wasm"); assert.equal(L.blobs[0].parts[0].length, 1200);
  assert.ok(L.blobs[0].parts[0].every((v, i) => v === Math.floor(i / 100) + 1), "the bytes in order");
  assert.ok(opts.baseOptions.modelAssetBuffer instanceof L.box.Uint8Array && opts.baseOptions.modelAssetBuffer.length === 300, "the model from memory");
  assert.equal(opts.baseOptions.modelAssetPath, undefined); assert.equal(opts.baseOptions.delegate, "CPU");
  assert.deepEqual([opts.runningMode, opts.numFaces, opts.outputFaceBlendshapes, opts.outputFacialTransformationMatrixes], ["VIDEO", 2, true, true]);
  assert.deepEqual(L.revoked, ["blob:http://127.0.0.1:1/b1"], "the blob is released once the engine started");
  assert.equal(L.pending.size, 0, "no timer left running after a load (nothing keeps a closed model alive)");
  eng.close(); assert.equal(L.closedLm, 1); eng.close(); assert.equal(L.closedLm, 1);
  // a download that stalls → "timeout" after the stall limit, its request stopped, no timer left
  L = loadBox({ files: { "vision_wasm_internal.wasm": { size: 1000, chunks: 10, gapMs: 5, stallAt: 3 } } });
  const t0 = Date.now();
  assert.equal(await codeOf(L.FP.load()), "timeout");
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(L.signals[0] && L.signals[0].aborted, "the stalled request is aborted");
  assert.equal(L.created.length, 0, "nothing started"); await wait(20); assert.equal(L.pending.size, 0);
  // a missing file → "offline"
  L = loadBox({ files: { "face_landmarker.task": { status: 404 } } });
  assert.equal(await codeOf(L.FP.load()), "offline");
  // the window closes mid-download → "aborted", the requests stopped, nothing created
  L = loadBox({ files: { "vision_wasm_internal.wasm": { size: 1000, chunks: 20, gapMs: 20 } } });
  const ctl = new AbortController();
  const pr = codeOf(L.FP.load({ signal: ctl.signal }));
  await wait(60); ctl.abort();
  assert.equal(await pr, "aborted");
  assert.ok(L.signals[0] && L.signals[0].aborted, "the download in progress is stopped"); assert.equal(L.created.length, 0);
  await wait(30); assert.equal(L.pending.size, 0);
  // the start-up itself has its own deadline; an engine that comes after it is closed, and every timer is cleared
  L = loadBox({ create: (X) => new Promise((r) => setTimeout(() => r({ close(){ X.closedLm++; } }), 250)) });
  assert.equal(await codeOf(L.FP.load()), "timeout");
  await wait(300); assert.equal(L.closedLm, 1, "the late engine is closed"); assert.equal(L.pending.size, 0);
  // the library rejecting with a script error EVENT (its loader file missing) → a connection problem
  L = loadBox({ create: () => Promise.reject({ type: "error" }) });
  assert.equal(await codeOf(L.FP.load()), "offline");
  L = loadBox({ create: () => Promise.reject(new Error("Aborted(). Build with -sASSERTIONS")) });
  assert.equal(await codeOf(L.FP.load()), "failed");
  L = loadBox({ simd: false });
  assert.equal(await codeOf(L.FP.load()), "unsupported"); assert.deepEqual(L.calls, [], "no download without SIMD");
});

/* ═══ I. the real capture window in a vm ═══ */
/* ── a tiny hook renderer (from test-likeness-store.mjs) ── */
function makeReact(){
  const Fragment = Symbol.for("test.fragment");
  let current = null;
  const createElement = (type, props, ...children) => ({ $el: true, type, props: { ...(props || {}), children } });
  class Root {
    constructor(host){ this.host = host; this.inst = new Map(); this.el = null; this.tree = null; this.dirty = false; this.alive = true; this.effects = []; }
    render(el){ this.el = el; this.flush(); }
    schedule(){ if (this.dirty || !this.alive) return; this.dirty = true; queueMicrotask(() => { this.dirty = false; if (this.alive) this.flush(); }); }
    flush(){
      const seen = new Set(); this.effects = [];
      this.tree = this.walk(this.el, "r", seen);
      for (const [k, inst] of this.inst) if (!seen.has(k)) { for (const h of inst.h) if (h && h.cleanup) try { h.cleanup(); } catch (_e) {} this.inst.delete(k); }
      const eff = this.effects; this.effects = [];
      for (const f of eff) f();
    }
    walk(node, path, seen){
      if (node == null || node === false || node === true) return null;
      if (Array.isArray(node)) return node.map((c, i) => this.walk(c, path + "." + i, seen));
      if (typeof node !== "object" || !node.$el) return node;
      const { type, props } = node;
      if (typeof type === "function"){
        const key = path + ":" + (type.name || "fn");
        seen.add(key);
        let inst = this.inst.get(key);
        if (!inst){ inst = { h: [], root: this }; this.inst.set(key, inst); }
        inst.i = 0; const prev = current; current = inst;
        let out; try { out = type(props); } finally { current = prev; }
        return this.walk(out, key + "/", seen);
      }
      if (type === Fragment) return { type: "#frag", props: {}, children: this.walk(props.children, path + "f", seen) };
      return { type, props, children: this.walk(props.children, path + "<" + String(type) + ">", seen) };
    }
    unmount(){ this.alive = false; for (const inst of this.inst.values()) for (const h of inst.h) if (h && h.cleanup) try { h.cleanup(); } catch (_e) {} this.inst.clear(); this.tree = null; }
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((d, j) => Object.is(d, b[j]));
  const React = {
    createElement, Fragment,
    useState(init){ const inst = current, i = inst.i++; if (inst.h.length <= i) inst.h[i] = { v: typeof init === "function" ? init() : init }; const cell = inst.h[i];
      return [cell.v, (v) => { const nv = typeof v === "function" ? v(cell.v) : v; if (!Object.is(nv, cell.v)){ cell.v = nv; inst.root.schedule(); } }]; },
    useRef(init){ const inst = current, i = inst.i++; if (inst.h.length <= i) inst.h[i] = { current: init }; return inst.h[i]; },
    useCallback(fn, deps){ const inst = current, i = inst.i++; const p = inst.h[i]; if (p && deps && same(deps, p.deps)) return p.fn; inst.h[i] = { fn, deps }; return fn; },
    useMemo(fn, deps){ const inst = current, i = inst.i++; const p = inst.h[i]; if (p && deps && same(deps, p.deps)) return p.v; inst.h[i] = { v: fn(), deps }; return inst.h[i].v; },
    useEffect(fn, deps){ const inst = current, i = inst.i++; const prev = inst.h[i];
      if (prev && deps && prev.deps && same(deps, prev.deps)) return;
      const cell = { deps, cleanup: prev && prev.cleanup }; inst.h[i] = cell;
      inst.root.effects.push(() => { if (cell.cleanup){ try { cell.cleanup(); } catch (_e) {} } const c = fn(); cell.cleanup = typeof c === "function" ? c : null; }); },
  };
  const roots = [];
  const ReactDOM = { createRoot: (host) => { const r = new Root(host); roots.push(r); return r; }, createPortal: (el) => el };
  return { React, ReactDOM, Root, roots };
}
const nodesOf = (tree) => { const out = []; const visit = (n) => { if (n == null) return; if (Array.isArray(n)) return n.forEach(visit); if (typeof n !== "object") return; out.push(n); visit(n.children); }; visit(tree); return out; };
const textOf = (n) => (n == null || n === false) ? "" : (typeof n === "string" || typeof n === "number") ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : textOf(n.children);
const byRole = (tree, role) => nodesOf(tree).find((n) => n.props && n.props["data-role"] === role);
const click = (n) => n.props.onClick({ stopPropagation: noop, preventDefault: noop });
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k), key: (i) => Array.from(m.keys())[i] ?? null, get length(){ return m.size; }, _m: m }; };
const macro = () => new Promise((r) => setImmediate(r));

/* one capture window on a fake camera + a fake detector engine; the clock moves only when pumped.
   The camera picture is TEXTURED (a 4-px checkerboard around W.luma, which can drift), so the simple
   Front check (used when the pose check can't start) sees what it would see in a real room: a steady,
   lit something in the ring. Every photo the window makes is logged: W.crops.get(url) → { ops
   (translate / scale = flipped), pose (the scene when it was drawn), src }. */
function mountWindow(opts = {}){
  const R = makeReact();
  const W = { simT: 0, scene: { pose: P0(), o: {} }, utter: [], confirms: [], answers: [], tracks: [], timers: [], raf: new Map(), rafId: 0,
    closes: 0, onCloseCalls: 0, voices: opts.voices || [{ localService: false, lang: "en-US", name: "net" }, { localService: true, lang: "en-US", name: "local" }],
    auditPoses: opts.auditPoses || {}, saves: [], luma: 128, crops: new Map(), urlN: 0, loads: 0, defer: false, pendingAnswer: null };
  const eng = { detects: 0, closes: 0, audits: 0, closed: false, firstAt: null, afterClose: 0, throwNext: false,
    detect(){ if (eng.closed){ eng.afterClose++; return null; }
      if (eng.throwNext){ eng.throwNext = false; const e = new Error("failed"); e.code = "failed"; throw e; }
      eng.detects++; if (eng.firstAt == null) eng.firstAt = W.simT; return res(W.scene.pose, W.scene.o); },
    audit(src){ if (eng.closed) return null; eng.audits++;
      const p = (src && src.src && src.src in W.auditPoses) ? W.auditPoses[src.src] : (W.uploadPose !== undefined ? W.uploadPose : P0());
      return box.turnFacePose.observe(res(p, W.uploadO || {}), 1280, 720); },
    close(){ eng.closes++; eng.closed = true; } };
  W.eng = eng;
  const canvas = () => {
    const c = { width: 0, height: 0, ops: [], pose: null, src: null };
    const g = { drawImage: (src) => { c.src = src; c.pose = W.scene.pose ? { ...W.scene.pose } : null; },
      translate: (x, y) => c.ops.push("translate(" + x + "," + y + ")"), scale: (x, y) => c.ops.push("scale(" + x + "," + y + ")"),
      getImageData: (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){ const v = (((i >> 2) + (j >> 2)) & 1) ? W.luma + 30 : W.luma - 30, k = (j * w + i) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
        return { data: d }; } };
    c.getContext = () => g;
    c.toDataURL = () => { const url = "data:image/jpeg;base64,QQ" + (++W.urlN); W.crops.set(url, { ops: c.ops.slice(), pose: c.pose, src: c.src && c.src._src, w: c.width }); return url; };
    return c;
  };
  const listeners = {};
  const box = { console: { ...console, warn: noop, info: noop, log: noop, error: noop }, Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, WeakMap, Symbol,
    Float32Array, Uint8ClampedArray, Error, TypeError, isFinite, parseInt, parseFloat, URL, queueMicrotask, structuredClone,
    setTimeout: (fn, ms) => { W.timers.push({ at: W.simT + (ms || 0), fn, done: false }); return W.timers.length; }, clearTimeout: noop,
    requestAnimationFrame: (fn) => { const id = ++W.rafId; W.raf.set(id, fn); return id; }, cancelAnimationFrame: (id) => { W.raf.delete(id); },
    React: R.React, ReactDOM: R.ReactDOM, Icon: new Proxy({}, { get: () => () => null }),
    localStorage: mkStore(), sessionStorage: mkStore(),
    document: { createElement: (t) => t === "canvas" ? canvas() : { tagName: t, style: {} }, baseURI: "http://127.0.0.1:1/TURN.html",
      body: { appendChild: noop, removeChild: noop }, head: { appendChild: noop }, addEventListener: noop, removeEventListener: noop },
    navigator: { userAgent: "node-test" },
    Image: class { set src(v){ this._src = v; this.width = this.naturalWidth = 640; this.height = this.naturalHeight = 640; Promise.resolve().then(() => this.onload && this.onload()); } get src(){ return this._src; } },
    // the device voice "speaks" for 50 ms a character on the test's clock, then ends (W.speechMode "fail": not allowed)
    speechSynthesis: { getVoices: () => W.voices, speaking: false, addEventListener: noop, removeEventListener: noop,
      speak: (u) => { W.utter.push(u); if (W.speechMode === "fail"){ Promise.resolve().then(() => u.onerror && u.onerror({ error: "not-allowed" })); return; }
        const n = W.utter.length; W.speakingN = n; box.setTimeout(() => { if (W.speakingN === n){ W.speakingN = 0; u.onend && u.onend({}); } }, 50 * String(u.text).length); },
      cancel: () => { W.cancels = (W.cancels || 0) + 1; W.speakingN = 0; } },
    SpeechSynthesisUtterance: class { constructor(text){ this.text = text; } },
    FileReader: class { readAsDataURL(f){ this.result = f.dataUrl; Promise.resolve().then(() => this.onload && this.onload()); } },
    appConfirm: (o) => { W.confirms.push(o); if (W.defer) return new Promise((r) => { W.pendingAnswer = (v) => { W.pendingAnswer = null; r(v); }; });
      return Promise.resolve(W.answers.length ? W.answers.shift() : true); },
    nbSetCameo: async (id, rec) => { W.saves.push(rec); return { sync: false }; },
    fetch: async (u) => {
      W.fetches.push(String(u));
      if (opts.manifest && /\/app\/vendor\/voice\/frances-guide\/v1\/manifest\.json$/.test(String(u))) return { ok: true, json: async () => JSON.parse(JSON.stringify(opts.manifest)) };
      if (W.audio && /\/app\/vendor\/voice\/frances-guide\/v1\/[a-z0-9-]+\.mp3$/.test(String(u))) return W.audio.exists(u) ? { ok: true, blob: async () => ({ fake: u }) } : { ok: false, status: 404 };
      throw new Error("network disabled in this test: " + u);
    },
  };
  W.fetches = [];
  if (opts.audio){ W.audio = makeAudioEnv({ ...opts.audio, setTimeout: (fn, ms) => box.setTimeout(fn, ms), now: () => W.simT }); box.Audio = W.audio.Audio; }
  if (opts.voiceOff) box.localStorage.setItem("turn_cameo_voice", "0");
  if (opts.denied) box.navigator.mediaDevices = { getUserMedia: () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) };
  else if (opts.camera !== false){
    box.navigator.mediaDevices = { getUserMedia: () => {
      const track = { stopped: 0, stop(){ this.stopped++; } }; W.tracks.push(track);
      const stream = { getTracks: () => [track] };
      if (opts.lateCamera){ return new Promise((resolve) => { W.releaseCamera = () => resolve(stream); }); }
      return Promise.resolve(stream);
    } };
  }
  if (opts.saved) box.nbLoadMyCameo = async () => JSON.parse(JSON.stringify(opts.saved));
  box.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  box.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  box.dispatchEvent = noop;
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(FACE_SRC, box, { filename: "app/face-pose.js" });
  vm.runInContext(CAMEO_SRC, box, { filename: "app/cameo.jsx" });
  box.turnFacePose.load = opts.load || (async (o) => { W.loads++; W.loadOpts = o; eng.closed = false; return eng; });
  W.box = box; W.listeners = listeners;
  const root = R.ReactDOM.createRoot({});
  root.render(R.React.createElement(box.CameoModal, { character: { id: "neo", name: "Neo" }, onClose: () => { W.onCloseCalls++; }, onSaved: noop }));
  W.root = root;
  W.inst = () => Array.from(root.inst.entries()).find(([k]) => /:CameoModal$/.test(k))[1];
  W.video = { videoWidth: 1280, videoHeight: 720, readyState: 4, currentTime: 0, play: () => Promise.resolve(), srcObject: null };
  W.inst().h[0].current = W.video;
  W.settle = async () => { for (let i = 0; i < 4; i++) await macro(); };
  W.pump = async (ms = 100) => {
    for (let k = 0; k < Math.round(ms / 100); k++){
      W.simT += 100; W.video.currentTime += 0.1;
      for (const tm of W.timers) if (!tm.done && tm.at <= W.simT){ tm.done = true; tm.fn(); }
      const cbs = Array.from(W.raf.values()); W.raf.clear();
      for (const fn of cbs) fn(W.simT);
      await macro();
    }
  };
  W.until = async (cond, maxMs, label) => { for (let t = 0; t <= maxMs; t += 100){ if (cond()) return W.simT; await W.pump(100); } throw new Error("timed out: " + label); };
  /* time passes but no frame is drawn (a hidden tab: the browser pauses animation frames) */
  W.pause = async (ms = 100) => {
    for (let k = 0; k < Math.round(ms / 100); k++){
      W.simT += 100; W.video.currentTime += 0.1;
      for (const tm of W.timers) if (!tm.done && tm.at <= W.simT){ tm.done = true; tm.fn(); }
      await macro();
    }
  };
  W.lastCrop = () => W.crops.get(W.shots()[Object.keys(W.shots()).pop()]);
  W.flipped = (url) => { const c = W.crops.get(url); return !!c && c.ops.includes("translate(" + c.w + ",0)") && c.ops.includes("scale(-1,1)"); };
  W.nodes = () => nodesOf(root.tree);
  W.slot = (k) => W.nodes().find((n) => n.props && n.props["data-angle"] === k);
  W.img = (k) => { const s = W.slot(k); return s ? nodesOf(s).find((n) => n.type === "img") : null; };
  /* the instruction lives in the one-line caption UNDER the picture (hidden while it's spoken) */
  W.cue = () => W.nodes().find((n) => n.props && /^cameo-caption /.test(n.props.className || ""));
  W.cueKey = () => { const c = W.cue(); return c ? c.props["data-cue"] : null; };
  W.cueText = () => { const c = W.cue(); return c ? textOf(nodesOf(c).find((n) => n.props && n.props.className === "cameo-caption-t")) : ""; };
  W.hint = () => { const c = W.cue(); const h = c && nodesOf(c).find((n) => n.props && n.props.className === "cameo-caption-hint"); return h ? textOf(h) : ""; };
  W.captionShown = () => { const c = W.cue(); return !!c && !c.props.hidden; };
  W.stage = () => W.nodes().find((n) => n.props && n.props.className === "cameo-stage");
  W.sr = () => textOf(W.nodes().find((n) => n.props && n.props.className === "cameo-sr"));
  W.said = () => W.utter.map((u) => u.text);
  W.shots = () => W.inst().h[4].v;
  W.sources = () => W.inst().h[5].v;
  W.key = (key) => { (listeners.keydown || []).slice().forEach((f) => f({ key, target: { tagName: "BODY" }, preventDefault: noop, stopPropagation: noop })); };
  return W;
}

await test("I1 the owner's flow, part 1: Front fills after 3.0–3.2 s held (once, from the webcam); then a still front face never fills the left slot (30 s), and the cue + voice say which way", async () => {
  const W = mountWindow();
  await W.settle();
  assert.equal(W.box.turnFacePose && W.inst().h[3].v, "live");
  await W.until(() => W.eng.firstAt != null, 2000, "the detector runs once the camera is on");
  const t0 = W.eng.firstAt;
  const tFront = await W.until(() => W.shots().front, 5000, "Front");
  assert.ok(tFront - t0 >= 3000 && tFront - t0 <= 3200, "Front after " + (tFront - t0) + " ms");
  assert.equal(W.sources().front, "webcam");
  assert.equal(W.crops.get(W.shots().front).pose.yaw, 0, "the photo is the frame that was checked");
  assert.equal(W.flipped(W.shots().front), false, "saved in true orientation (not mirrored)");
  const sr = W.nodes().find((n) => n.props && n.props.className === "cameo-sr");
  assert.equal(textOf(sr), "Photo taken: front view. Next, turn your head slowly to your left, toward the left edge of the screen, and hold it there for five seconds.");
  await W.pump(400);
  assert.equal(W.inst().h[6].v, 1, "the target moves to the person's left");
  await W.pump(30000);
  assert.equal(W.shots().left, undefined, "the left slot stays empty");
  assert.equal(W.shots().right, undefined);
  assert.equal(W.cueKey(), "not-turned");
  assert.equal(W.cueText(), "Turn your head to your left — toward the left edge of the screen");
  assert.ok(W.said().some((s) => /to your left/.test(s)), W.said().join(" | "));
  assert.equal(W.hint(), "Turn your whole head until the dot reaches the green band — or press Capture now.");
  assert.ok(W.said().some((s) => /You don't need to see the screen/.test(s)), "the tip is spoken once: " + W.said().join(" | "));
  assert.equal(W.said().filter((s) => /You don't need to see the screen/.test(s)).length, 1);
  assert.ok(W.said().includes("Or press Capture now."));
  // the same instruction again only as a reminder, ever further apart (6, 9, 12, 15 s), never a stream
  const turns = W.said().filter((s) => s === "Now turn your head slowly to your left, and hold it there.").length;
  assert.ok(turns >= 3 && turns <= 6, "reminders: " + turns);
  assert.equal(W.captionShown(), false, "spoken (the device voice): no caption");
  const badge = W.nodes().find((n) => n.props && n.props.className === "cameo-anglebadge");
  assert.equal(textOf(badge), "Now: Your left · optional");
  const arrow = W.nodes().find((n) => n.props && /^cameo-turn-arrow left/.test(n.props.className || ""));
  assert.ok(arrow, "an arrow on the left edge");
  assert.equal(textOf(W.slot("left")).trim(), "← Your left");
  assert.equal(W.slot("left").props.title, "Capture: Turned to your left");
  assert.equal(W.slot("front").props.title, "Click × to take this one again");
  assert.equal(textOf(W.nodes().find((n) => n.props && n.props.className === "cameo-note")),
    "The pose check runs on this device — the camera picture isn't sent anywhere while you pose. Only the photos you lock are kept, as face references for this character's images.");
  assert.ok(!byRole(W.root.tree, "flip-fix"), "a still front face on a side target is 'not turned', never 'wrong way': no flipped-camera offer");
  assert.equal(W.nodes().find((n) => n.props && n.props.className === "cameo-stage").props["data-engine"], "ready");
  W.root.unmount();
});

await test("I2 + I3 the owner's flow, part 2: +35 fills the left slot after ≥ 5.0 s; held there 30 s the right slot stays empty ('That's your left — …'); −35 fills it and all three are done", async () => {
  const W = mountWindow();
  await W.settle();
  await W.until(() => W.shots().front, 6000, "Front");
  await W.pump(1500);
  W.scene.pose = P0({ yaw: 35 });
  const turned = W.simT;
  const tLeft = await W.until(() => W.shots().left, 9000, "left");
  assert.ok(tLeft - turned >= 5000 && tLeft - turned <= 6500, "left after " + (tLeft - turned) + " ms");
  assert.equal(W.sources().left, "webcam");
  assert.ok(W.said().some((s) => s === "Hold it there."), "hold start is said");
  const fromHold = W.said().slice(W.said().lastIndexOf("Hold it there."));
  assert.deepEqual(fromHold.slice(0, 7), ["Hold it there.", "Five.", "Four.", "Three.", "Two.", "One.", "Got it."], "the whole count, in order, then the photo: " + W.said().join(" | "));
  await W.pump(30000);
  assert.equal(W.shots().right, undefined, "still at +35: the right slot stays empty");
  assert.equal(W.cueKey(), "wrong-way");
  assert.equal(W.cueText(), "That's your left — turn the other way, to your right");
  assert.equal(W.cue().props["data-k"], "warn");
  assert.ok(!byRole(W.root.tree, "flip-fix"), "holding the pose just photographed is not a flipped camera: no offer (30 s)");
  assert.ok(!W.said().some((s) => /mirror/i.test(s)));
  W.scene.pose = P0({ yaw: -35 });
  const back = W.simT;
  const tRight = await W.until(() => W.shots().right, 9000, "right");
  assert.ok(tRight - back >= 5000, "right after " + (tRight - back));
  await W.pump(500);
  assert.equal(W.cueKey(), "complete");
  assert.ok(W.said().some((s) => /All three done/.test(s)), W.said().slice(-3).join(" | "));
  assert.deepEqual(Object.keys(W.shots()).sort(), ["front", "left", "right"]);
  W.root.unmount();
});

await test("I4 resets: 600 ms with no face resets the hold (5.0 s again from the return); 300 ms doesn't", async () => {
  const run = async (gapMs) => {
    const W = mountWindow();
    await W.settle();
    await W.until(() => W.shots().front, 6000, "Front");
    await W.pump(1500);
    W.scene.pose = P0({ yaw: 35 });
    await W.until(() => W.cueKey() === "holding", 3000, "holding");
    const holdAt = W.simT;
    await W.pump(2000);
    W.scene.pose = null;
    await W.pump(gapMs);
    W.scene.pose = P0({ yaw: 35 });
    const back = W.simT;
    const t = await W.until(() => W.shots().left, 9000, "left");
    W.root.unmount();
    return { fromHold: t - holdAt, fromBack: t - back };
  };
  const long = await run(600);
  assert.ok(long.fromBack >= 5000, "reset: " + JSON.stringify(long));
  const short = await run(300);
  assert.ok(short.fromHold >= 5000 && short.fromHold <= 5300, "no reset: " + JSON.stringify(short));
});

await test("I5 the pose check can't start: a plain note; Front still takes itself after 3 s held (the simple steady-and-lit check, on a textured frame); the sides NEVER do, even on a steady, lit, slowly drifting picture — Capture now asks 'The pose couldn't be checked' and saves the frame it asked about", async () => {
  const W = mountWindow({ load: async () => { const e = new Error("x"); e.code = "unsupported"; throw e; } });
  await W.settle(); await W.pump(100);
  const t0 = W.simT;
  const note = W.nodes().find((n) => n.props && /^cameo-note/.test(n.props.className || ""));
  assert.equal(note.props.className, "cameo-note warn");
  assert.equal(textOf(note), "Automatic side photos are off — the pose check couldn't start in this browser. Turn as the sketch shows, then press Capture now.");
  assert.equal(byRole(W.root.tree, "auto").props.title, "Automatic capture works for Front only on this device");
  const tFront = await W.until(() => W.shots().front, 6000, "Front by the simple check");
  assert.ok(tFront - t0 >= 3000 && tFront - t0 <= 3400, "Front after " + (tFront - t0) + " ms");
  await W.pump(400);
  assert.equal(W.inst().h[6].v, 1, "on to the person's left");
  W.scene.pose = P0({ yaw: 35 });
  for (let i = 0; i < 300; i++){ if (i % 2 === 0) W.luma += (i < 150 ? 1 : -1); await W.pump(100); }   // 30 s, drifting a grey level every 200 ms
  assert.equal(W.shots().left, undefined, "never automatic (the old check took this picture as every angle)");
  assert.equal(W.shots().right, undefined);
  assert.equal(W.cueKey(), "unavailable-side");
  assert.equal(W.cueText(), "Turn your head to your left, then press Capture now");
  assert.equal(W.said().filter((s) => s === "Turn your head to your left, then press Capture now.").length, 1, "said once for this angle");
  assert.equal(W.eng.detects, 0);
  W.answers.push(false);
  await byRole(W.root.tree, "capture-now").props.onClick(); await W.pump(100);
  assert.equal(W.confirms.length, 1); assert.equal(W.confirms[0].title, "The pose couldn't be checked");
  assert.equal(W.shots().left, undefined, "cancelled: empty");
  // the question stays open while the person looks back at the screen; the photo is the frame from the press
  W.defer = true;
  const pr = byRole(W.root.tree, "capture-now").props.onClick(); await W.pump(100);
  W.scene.pose = P0(); await W.pump(2500);
  assert.equal(W.shots().left, undefined, "nothing while the question is open");
  W.pendingAnswer(true); await pr; await W.pump(400); W.defer = false;
  assert.ok(W.shots().left, "confirmed: filled");
  assert.equal(W.crops.get(W.shots().left).pose.yaw, 35, "the frame that was asked about, not the front view on screen when it was answered");
  // Front still captures straight away with Capture now
  const x = nodesOf(W.slot("front")).find((n) => n.props && n.props.className === "cameo-slot-x");
  x.props.onClick({ stopPropagation: noop }); await W.pump(100);
  W.root.unmount();
  const F = mountWindow({ load: async () => { const e = new Error("x"); e.code = "unsupported"; throw e; } });
  await F.settle(); await F.pump(100);
  F.scene.pose = P0({ yaw: 35 });
  await byRole(F.root.tree, "capture-now").props.onClick(); await F.pump(100);
  assert.equal(F.confirms.length, 0, "no question for Front"); assert.ok(F.shots().front);
  F.root.unmount();
  for (const [code, why] of [["offline", "(check your connection, then reopen this window)"], ["failed", "on this device"]]){
    const X = mountWindow({ load: async () => { const e = new Error("x"); e.code = code; throw e; } });
    await X.settle(); await X.pump(200);
    assert.ok(textOf(X.nodes().find((n) => n.props && /^cameo-note/.test(n.props.className || ""))).includes("couldn't start " + why), code);
    X.root.unmount();
  }
});

await test("I1b the owner's symptom, whatever the pose check's state: a still, lit, slowly drifting front face may fill Front, but never a side slot (30 s)", async () => {
  for (const mode of ["ready", "unavailable"]){
    const W = mountWindow(mode === "ready" ? {} : { load: async () => { const e = new Error("x"); e.code = "failed"; throw e; } });
    await W.settle();
    await W.until(() => W.shots().front, 6000, mode + ": Front");
    for (let i = 0; i < 300; i++){ if (i % 2 === 0) W.luma += (i < 150 ? 1 : -1); await W.pump(100); }
    assert.equal(W.shots().left, undefined, mode + ": the left slot stays empty");
    assert.equal(W.shots().right, undefined, mode + ": the right slot stays empty");
    W.root.unmount();
  }
});

await test("I6 Capture now (the C key while the button is hidden) with the pose check ready: a frame that doesn't fit asks first, titled by what it shows; the photo is the frame from the press (not from when it's answered) and is marked '!'; a fitting frame — even one only too dark — is taken at once", async () => {
  const W = mountWindow();
  await W.settle();
  click(W.slot("left")); await W.pump(1000);
  assert.equal(byRole(W.root.tree, "capture-now"), undefined, "Auto on and the pose check running: the photo takes itself, no Capture now button");
  W.answers.push(false);
  W.key("c"); await W.settle(); await W.pump(100);
  assert.equal(W.confirms.length, 1);
  assert.equal(W.confirms[0].title, "This doesn't look turned to your left");
  assert.equal(W.confirms[0].body, "It shows a front view. Use it for “Your left” anyway?");
  assert.equal(W.confirms[0].safeDefault, true);
  assert.equal(W.shots().left, undefined);
  // only a little turned; while the question is open the person looks back at the screen
  W.scene.pose = P0({ yaw: 18 }); await W.pump(800);
  W.defer = true;
  W.key("c"); await W.pump(100);
  assert.equal(W.confirms[1].title, "Not turned far enough");
  assert.equal(W.confirms[1].body, "It shows your head only a little turned. Use it for “Your left” anyway?");
  W.scene.pose = P0(); await W.pump(3000);
  W.pendingAnswer(true); await W.settle(); await W.pump(400); W.defer = false;
  assert.equal(W.crops.get(W.shots().left).pose.yaw, 18, "the frame that was checked and asked about");
  assert.equal(W.slot("left").props["data-check"], "mismatch", "kept anyway: marked '!'");
  assert.equal(W.slot("left").props.title, "This photo shows the head only a little turned — click × to take it again");
  // × and turned: no question — and the C key does the same, even when the light is too low
  nodesOf(W.slot("left")).find((n) => n.props && n.props.className === "cameo-slot-x").props.onClick({ stopPropagation: noop });
  await W.pump(100);
  assert.equal(W.inst().h[6].v, 1);
  W.scene.pose = P0({ yaw: 35 }); W.luma = 30; await W.pump(800);
  assert.equal(W.cueKey(), "dark");
  W.key("c"); await W.pump(100);
  assert.equal(W.confirms.length, 2, "a fitting pose that's only too dark is taken at once");
  assert.ok(W.shots().left, "the C key captured it"); assert.equal(W.slot("left").props["data-check"], undefined);
  W.luma = 128;
  click(byRole(W.root.tree, "auto")); await W.pump(100);
  assert.equal(byRole(W.root.tree, "capture-now").props.title, "Take this photo now (C)", "Auto off: the button is back");
  assert.equal(byRole(W.root.tree, "capture-now").props["aria-keyshortcuts"], "C");
  W.key("Escape");
  assert.equal(W.onCloseCalls, 1, "Escape closes the window");
  W.root.unmount();
});

await test("I7 closing the window closes the detector once, stops the loop and the camera; a camera that answers after closing is stopped at once", async () => {
  const W = mountWindow();
  await W.settle(); await W.pump(1000);
  assert.ok(W.eng.detects > 3);
  W.root.unmount();
  const n = W.eng.detects;
  await W.pump(2000);
  assert.equal(W.eng.closes, 1); assert.equal(W.eng.detects, n, "no detect after close"); assert.equal(W.eng.afterClose, 0);
  assert.ok(W.tracks.every((t) => t.stopped >= 1), "camera stopped");
  const L = mountWindow({ lateCamera: true });
  await L.settle();
  L.root.unmount();
  L.releaseCamera(); await L.settle();
  assert.equal(L.tracks.length, 1); assert.equal(L.tracks[0].stopped, 1, "the late stream's track is stopped");
  assert.equal(L.eng.detects, 0); assert.equal(L.eng.closes, 0, "nothing was loaded");
  // load() resolving after the window closed: the engine is closed straight away
  let release; const slow = mountWindow({ load: () => new Promise((r) => { release = r; }) });
  await slow.settle();
  slow.root.unmount();
  release(slow.eng); await slow.settle();
  assert.equal(slow.eng.closes, 1, "a late engine is closed");
});

await test("I8 with no recorded clips, the lines are said only by a voice built into the device; with network voices only (and no clips), nothing is said and Voice is disabled", async () => {
  const W = mountWindow();
  await W.settle();
  await W.until(() => W.shots().front, 6000, "Front");
  await W.pump(3000);
  assert.ok(W.utter.length > 0);
  assert.ok(W.utter.every((u) => u.voice && u.voice.localService === true), "every line on the local voice");
  assert.equal(byRole(W.root.tree, "voice").props.disabled, false);
  W.root.unmount();
  const N = mountWindow({ voices: [{ localService: false, lang: "en-US" }] });
  await N.settle();
  await N.until(() => N.shots().front, 6000, "Front");
  await N.pump(3000);
  assert.equal(N.utter.length, 0, "nothing spoken");
  const pill = byRole(N.root.tree, "voice");
  assert.equal(pill.props.disabled, true); assert.equal(pill.props.title, "Spoken directions aren't available in this browser");
  N.root.unmount();
});

await test("I9 no camera: no <img>, nothing loaded; hook order h[3] phase, h[4] shots, h[5] sources", async () => {
  let loads = 0;
  const W = mountWindow({ camera: false, load: async () => { loads++; throw new Error("x"); } });
  await W.settle(); await W.pump(500);
  assert.equal(W.inst().h[3].v, "nocam");
  assert.deepEqual(JSON.parse(JSON.stringify(W.inst().h[4].v)), {}); assert.deepEqual(JSON.parse(JSON.stringify(W.inst().h[5].v)), {});
  assert.ok(!W.nodes().some((n) => n.type === "img"));
  assert.equal(loads, 0, "no download without a camera");
  assert.ok(!W.cue(), "no live cue");
  assert.ok(textOf(W.root.tree).includes("Choose a photo for “Front”"), "the slot an upload goes to is named");
  assert.ok(/cameo-slot.* active/.test(W.slot("front").props.className), "…and highlighted, with no camera too");
  assert.equal(textOf(byRole(W.root.tree, "upload")), "Upload for “Front”");
  W.root.unmount();
});

const SAVED = { angles: [{ key: "front", label: "Front", url: "data:image/jpeg;base64,RlJPTlQ=", source: "webcam" },
  { key: "left", label: "¾ Left", url: "data:image/jpeg;base64,TEVGVA==", source: "upload" }],
  consent: { subject: "self", name: "", adult: true, textVersion: "2026-10-10" }, sync: false, w: 1024, h: 1024 };
await test("I10 the strip: every photo is shown like the mirror (webcam and upload alike, as the slot's sketch faces); labels say whose left; the Likenesses window says 'their own left'", async () => {
  const W = mountWindow({ saved: SAVED });
  await W.settle(); await W.pump(200);
  assert.equal(W.img("front").props.className, "mirror");
  assert.equal(W.img("left").props.className, "mirror", "an upload too: in the photo its nose points right, here left — like the sketch and '← Your left'");
  assert.equal(W.img("left").props.alt, "Your left");
  assert.deepEqual(["front", "left", "right"].map((k) => textOf(W.nodes().find((n) => n.props && n.props.className === "cameo-slot-lab" && nodesOf(W.slot(k)).includes(n)))),
    ["Front *", "← Your left", "Your right →"]);
  assert.deepEqual([{ key: "front" }, { key: "left" }, { label: "¾ Right" }].map((x) => W.box.cameoAngleShow(x)), ["Front", "Turned to their own left", "Turned to their own right"]);
  W.root.unmount();
});

await test("I11 the saved-photo check: a saved left photo that is really a front view is marked '!' (the record unchanged); the right slot is captured live", async () => {
  const W = mountWindow({ saved: SAVED, auditPoses: { "data:image/jpeg;base64,RlJPTlQ=": P0(), "data:image/jpeg;base64,TEVGVA==": P0({ yaw: 1 }) } });
  await W.settle(); await W.pump(500);
  assert.equal(W.slot("left").props["data-check"], "mismatch");
  assert.equal(W.slot("front").props["data-check"], "ok");
  assert.ok(nodesOf(W.slot("left")).some((n) => n.props && n.props.className === "cameo-slot-warn"));
  assert.equal(W.slot("left").props.title, "This photo shows a front view — click × to take it again");
  assert.equal(W.inst().h[6].v, 2, "the window starts on the empty right slot");
  click(W.slot("left")); await W.pump(200);
  assert.equal(W.cueKey(), "filled-mismatch");
  assert.equal(W.cueText(), "This photo shows a front view — click × on it to take it again");
  assert.equal(W.saves.length, 0, "nothing is saved or changed by the check");
  assert.equal(W.shots().left, SAVED.angles[1].url);
  const ok = mountWindow({ saved: SAVED, auditPoses: { "data:image/jpeg;base64,TEVGVA==": P0({ yaw: 33 }) } });
  await ok.settle(); await ok.pump(500);
  assert.equal(ok.slot("left").props["data-check"], "ok");
  ok.root.unmount();
  W.root.unmount();
});

const SAVED3 = { angles: [{ key: "front", label: "Front", url: "data:image/jpeg;base64,RlJPTlQ=", source: "webcam" },
  { key: "left", label: "¾ Left", url: "data:image/jpeg;base64,TEVGVA==", source: "webcam" },
  { key: "right", label: "¾ Right", url: "data:image/jpeg;base64,UklHSFQ=", source: "webcam" }],
  consent: { subject: "self", name: "", adult: true, textVersion: "2026-10-10" }, sync: false, w: 1024, h: 1024 };
await test("I11b the saved-photo check marks only a real mistake (owner 2026-10-10: a right photo the live check had taken was marked '!' on reopening)", async () => {
  const L = "data:image/jpeg;base64,TEVGVA==", R = "data:image/jpeg;base64,UklHSFQ=", F = "data:image/jpeg;base64,RlJPTlQ=";
  const run = async (poses) => { const W = mountWindow({ saved: SAVED3, auditPoses: { [F]: P0(), ...poses } }); await W.settle(); await W.pump(500);
    const out = { front: W.slot("front").props["data-check"], left: W.slot("left").props["data-check"], right: W.slot("right").props["data-check"] }; W.root.unmount(); return out; };
  // turned further than the live band (50–55°) or a little short of it (20°): still the right side — not marked
  assert.deepEqual(await run({ [L]: P0({ yaw: 52 }), [R]: P0({ yaw: -55 }) }), { front: "ok", left: "ok", right: "ok" });
  assert.deepEqual(await run({ [L]: P0({ yaw: 20 }), [R]: P0({ yaw: -19 }) }), { front: "ok", left: "ok", right: "ok" });
  // real mistakes: a front view in a side slot, a turn the other way, a turned "front"
  assert.deepEqual(await run({ [L]: P0({ yaw: 4 }), [R]: P0({ yaw: 30 }) }), { front: "ok", left: "mismatch", right: "mismatch" });
  assert.equal((await run({ [F]: P0({ yaw: 25 }), [L]: P0({ yaw: 35 }), [R]: P0({ yaw: -35 }) })).front, "mismatch");
});
await test("I14 the owner's saved likeness (all three slots, both sides really front views): the window opens on the first marked photo and says so; the set is not 'all three done'; Lock asks first", async () => {
  const W = mountWindow({ saved: SAVED3, auditPoses: { "data:image/jpeg;base64,RlJPTlQ=": P0(), "data:image/jpeg;base64,TEVGVA==": P0({ yaw: 1 }), "data:image/jpeg;base64,UklHSFQ=": P0({ yaw: -1 }) } });
  await W.settle(); await W.pump(500);
  assert.deepEqual(["front", "left", "right"].map((k) => W.slot(k).props["data-check"]), ["ok", "mismatch", "mismatch"]);
  assert.equal(W.inst().h[6].v, 1, "moved to the first photo marked as the wrong angle");
  assert.equal(W.cueKey(), "filled-mismatch"); assert.equal(W.cue().props["data-k"], "warn");
  assert.equal(W.cueText(), "This photo shows a front view — click × on it to take it again");
  click(W.slot("front")); await W.pump(200);
  assert.equal(W.cueKey(), "check-marked");
  assert.equal(W.cueText(), "Two photos look like the wrong angle — click × on each one marked ! to take it again");
  const lock = byRole(W.root.tree, "lock");
  assert.equal(lock.props.disabled, false);
  W.answers.push(false);
  await lock.props.onClick(); await W.pump(100);
  assert.equal(W.confirms.length, 1);
  assert.deepEqual([W.confirms[0].title, W.confirms[0].confirmLabel, W.confirms[0].cancelLabel, W.confirms[0].safeDefault], ["Two photos look like the wrong angle", "Lock anyway", "Retake first", true]);
  assert.deepEqual(plainify(W.confirms[0].items), ["“Your left” shows a front view", "“Your right” shows a front view"]);
  assert.equal(W.saves.length, 0, "Retake first: nothing locked");
  W.answers.push(true);
  await byRole(W.root.tree, "lock").props.onClick(); await W.settle();
  assert.equal(W.saves.length, 1, "Lock anyway: locked");
  assert.deepEqual(plainify(W.saves[0].angles.map((a) => a.label)), ["Front", "¾ Left", "¾ Right"], "the stored labels are unchanged");
  // retaking the left one live: the marked right is next, then the set is complete
  const R = mountWindow({ saved: SAVED3, auditPoses: { "data:image/jpeg;base64,RlJPTlQ=": P0(), "data:image/jpeg;base64,TEVGVA==": P0({ yaw: 1 }), "data:image/jpeg;base64,UklHSFQ=": P0({ yaw: -1 }) } });
  await R.settle(); await R.pump(500);
  nodesOf(R.slot("left")).find((n) => n.props && n.props.className === "cameo-slot-x").props.onClick({ stopPropagation: noop });
  R.scene.pose = P0({ yaw: 35 });
  await R.until(() => R.shots().left !== SAVED3.angles[1].url && R.shots().left, 9000, "left retaken");
  await R.pump(500);
  assert.equal(R.inst().h[6].v, 2, "on to the other marked photo");
  assert.equal(R.cueKey(), "filled-mismatch");
  W.root.unmount(); R.root.unmount();
});

await test("I12 'Preview not like a mirror? Check it': offered only for a fresh wrong-way turn before any side photo; it asks a question the person can see for themselves; switching flips the Front taken before and the photos after — for this window only; switching back asks and clears the side photos read the other way", async () => {
  const W = mountWindow();
  await W.settle();
  await W.until(() => W.shots().front, 6000, "Front");
  const front0 = W.shots().front;
  await W.pump(1500);
  // a camera that flips its picture: the person turns to their own LEFT, the frame shows yaw −35
  W.scene.pose = P0({ yaw: -35 });
  await W.pump(7000);
  assert.equal(W.shots().left, undefined); assert.equal(W.cueKey(), "wrong-way");
  let fix = byRole(W.root.tree, "flip-fix");
  assert.ok(fix, "offered after 6 s the wrong way"); assert.equal(textOf(fix), "Preview not like a mirror? Check it");
  W.answers.push(false); click(fix); await W.pump(100);
  assert.equal(W.confirms[0].title, "Is the preview like a mirror?");
  assert.equal(W.confirms[0].cancelLabel, "It reads backwards — keep it");
  assert.equal(W.nodes().find((n) => n.type === "video").props.className, "cameo-video", "'keep it': nothing changes");
  assert.ok(!byRole(W.root.tree, "cam-flipped"));
  await W.pump(6500);
  fix = byRole(W.root.tree, "flip-fix"); assert.ok(fix, "offered again after another 6 s");
  W.answers.push(true); click(fix); await W.pump(200);
  assert.equal(W.nodes().find((n) => n.type === "video").props.className, "cameo-video unmirror");
  assert.equal(W.box.localStorage.length, 0, "not remembered: another camera or a later window starts as a mirror");
  assert.equal(byRole(W.root.tree, "cam-flipped").props.title, "Your camera already flips the picture — click to undo");
  const front1 = W.shots().front;
  assert.notEqual(front1, front0); assert.equal(W.crops.get(front1).src, front0); assert.ok(W.flipped(front1), "the Front taken before is flipped to match");
  await W.until(() => W.shots().left, 8000, "left, read the right way round");
  assert.ok(W.flipped(W.shots().left), "the photo is flipped back to true orientation");
  assert.equal(W.crops.get(W.shots().left).pose.yaw, -35);
  // Capture now in this setting flips its photo back too (in this camera an own-right turn shows +35)
  await W.pump(1500);
  W.scene.pose = P0({ yaw: 35 }); await W.pump(800);
  W.key("c"); await W.pump(400);
  assert.ok(W.shots().right, "Capture now: right"); assert.ok(W.flipped(W.shots().right), "…flipped back to true orientation");
  // switching back: the left photo was read flipped — asked; "Keep it" keeps, "Switch back" clears it and flips the Front back
  W.answers.push(false); click(byRole(W.root.tree, "cam-flipped")); await W.pump(100);
  assert.equal(W.confirms[2].title, "Switch back to the usual mirror view?");
  assert.ok(W.shots().left); assert.ok(byRole(W.root.tree, "cam-flipped"));
  W.answers.push(true); click(byRole(W.root.tree, "cam-flipped")); await W.pump(200);
  assert.equal(W.nodes().find((n) => n.type === "video").props.className, "cameo-video");
  assert.equal(W.shots().left, undefined, "the side photos read the other way are cleared");
  assert.equal(W.shots().right, undefined);
  assert.equal(W.crops.get(W.shots().front).src, front1); assert.ok(W.flipped(W.shots().front));
  W.root.unmount();
  const W2 = mountWindow();
  await W2.settle(); await W2.pump(100);
  assert.equal(W2.nodes().find((n) => n.type === "video").props.className, "cameo-video", "a new window starts as a mirror");
  W2.root.unmount();
});

await test("I15 the upload check with the camera blocked: the slot is highlighted and named; the check loads (on this device) for the upload and marks a photo that doesn't fit; the next empty slot is next", async () => {
  const W = mountWindow({ denied: true });
  await W.settle(); await W.pump(300);
  assert.equal(W.inst().h[3].v, "denied"); assert.equal(W.loads, 0, "nothing loaded yet");
  assert.ok(/ active/.test(W.slot("front").props.className));
  assert.equal(textOf(byRole(W.root.tree, "upload")), "Upload for “Front”");
  assert.equal(byRole(W.root.tree, "upload").props.title, "Upload a photo into the “Front” slot — the person looking straight at the camera. Click another slot above to change the target.");
  const input = W.nodes().find((n) => n.type === "input" && n.props.type === "file");
  const pick = async () => { input.props.onChange({ target: { files: [{ dataUrl: "data:image/png;base64,AAAA" }], value: "x" } }); await W.settle(); await W.pump(300); };
  W.uploadPose = P0({ yaw: 35 });
  await pick();
  assert.ok(W.shots().front); assert.equal(W.confirms.length, 0, "no question before the check is ready: the photo goes in");
  assert.equal(W.loads, 1, "the check started for the upload");
  assert.equal(W.slot("front").props["data-check"], "mismatch", "then checked: marked '!'");
  assert.equal(W.slot("front").props.title, "This photo shows the head turned to the person's left — click × to take it again");
  assert.equal(W.inst().h[6].v, 1, "on to the next empty slot");
  assert.equal(textOf(byRole(W.root.tree, "upload")), "Upload for “Your left”");
  assert.equal(byRole(W.root.tree, "upload").props.title,
    "Upload a photo into the “Your left” slot — the person turned to their own left (in the photo, their nose points to the right). Click another slot above to change the target.");
  W.uploadPose = P0({ yaw: 34 });
  await pick();
  assert.ok(W.shots().left); assert.equal(W.confirms.length, 0, "it fits: no question");
  assert.equal(W.inst().h[6].v, 2);
  W.root.unmount();
});

await test("I13 uploads with the camera on: a photo that doesn't look like its slot's angle asks first (and says which to pick); a second person asks too; one that fits goes straight in; an upload doesn't arm 'change your pose'", async () => {
  const W = mountWindow();
  await W.settle(); await W.pump(500);
  click(W.slot("left")); await W.pump(200);
  const input = W.nodes().find((n) => n.type === "input" && n.props.type === "file");
  const pick = async () => { input.props.onChange({ target: { files: [{ dataUrl: "data:image/png;base64,AAAA" }], value: "x" } }); await W.settle(); await W.pump(100); };
  W.uploadPose = P0(); W.answers.push(false);
  await pick();
  assert.equal(W.confirms.length, 1);
  assert.deepEqual([W.confirms[0].title, W.confirms[0].body, W.confirms[0].confirmLabel, W.confirms[0].cancelLabel],
    ["This photo doesn't look turned to the person's left",
      "It shows a front view. For “Your left”, pick a photo of the person turned to their own left — their nose points to the right in the photo. Put this one in anyway?",
      "Use it anyway", "Choose another"]);
  assert.equal(W.shots().left, undefined, "Choose another: nothing lands");
  W.uploadPose = null; W.answers.push(false);
  await pick();
  assert.equal(W.confirms[1].title, "No face found"); assert.equal(W.confirms[1].body, "Use this photo for “Your left” anyway?");
  W.uploadPose = P0({ yaw: 34 }); W.uploadO = { faces: [{ pose: { yaw: 0 }, dx: 22 }] }; W.answers.push(false);
  await pick();
  assert.equal(W.confirms[2].title, "Someone else is in the photo"); assert.equal(W.shots().left, undefined);
  W.uploadO = {};
  await pick();
  assert.equal(W.confirms.length, 3, "a fitting photo: no question");
  assert.ok(W.shots().left); assert.equal(W.sources().left, "upload");
  assert.equal(W.img("left").props.className, "mirror");
  assert.equal(W.inst().h[6].v, 1, "with the camera on, the slot stays where the upload landed");
  const up = byRole(W.root.tree, "upload");
  assert.match(textOf(up), /^Upload for “/, "the button always names the slot it fills (2026-10-10)");
  assert.equal(up.props.title, "Upload a photo into the “Your left” slot — the person turned to their own left (in the photo, their nose points to the right). Click another slot above to change the target.");
  // a front-looking photo kept in the left slot anyway: marked "!"; and it is no live pose — Front then takes itself
  nodesOf(W.slot("left")).find((n) => n.props && n.props.className === "cameo-slot-x").props.onClick({ stopPropagation: noop });
  W.uploadPose = P0(); W.answers.push(true);
  await pick();
  assert.ok(W.shots().left); assert.equal(W.slot("left").props["data-check"], "mismatch");
  click(W.slot("front")); await W.pump(100);
  const t0 = W.simT, keys = new Set();
  for (let i = 0; i < 40 && !W.shots().front; i++){ await W.pump(100); keys.add(W.cueKey()); }
  assert.ok(W.shots().front, "Front fills from the live camera: " + [...keys].join(" "));
  assert.ok(!keys.has("change-pose")); assert.ok(W.simT - t0 <= 3400);
  W.root.unmount();
});

await test("I16 while the browser asks for the camera: 'Allow the camera to start — or upload a photo' (not 'getting ready'), no pose-check note, nothing loaded", async () => {
  const W = mountWindow({ lateCamera: true });
  await W.settle(); await W.pump(500);
  assert.equal(W.cueKey(), "camera"); assert.equal(W.cueText(), "Allow the camera to start — or upload a photo");
  assert.ok(!W.nodes().some((n) => n.props && /^cameo-note/.test(n.props.className || "")));
  assert.equal(W.loads, 0);
  W.releaseCamera(); await W.settle(); await W.pump(300);
  assert.notEqual(W.cueKey(), "camera"); assert.equal(W.loads, 1);
  assert.ok(W.nodes().some((n) => n.props && n.props.className === "cameo-note"));
  W.root.unmount();
});

await test("I17 Capture now asks about what matters even when the pose fits: a second face, an uncertain direction, a tiny face, closed eyes; both questions when the pose is wrong too", async () => {
  const W = mountWindow();
  await W.settle();
  click(byRole(W.root.tree, "auto")); click(W.slot("left")); await W.pump(300);
  const cases = [
    [{ faces: [{ pose: { yaw: 35 }, dx: 22 }] }, "Someone else is in the picture"],
    [{ lmPose: { yaw: -20 } }, "The direction couldn't be confirmed"],
    [{ scale: 0.4 }, "Your face looks small in the picture"],
    [{ blink: { left: 0.05, right: 0.9 } }, "Your eyes look closed"],
  ];
  for (const [o, title] of cases){
    W.scene.pose = P0({ yaw: 35 }); W.scene.o = o; await W.pump(1000);
    const n = W.confirms.length; W.answers.push(false);
    await byRole(W.root.tree, "capture-now").props.onClick(); await W.pump(100);
    assert.equal(W.confirms.length, n + 1, title); assert.equal(W.confirms[n].title, title);
    assert.equal(W.shots().left, undefined, title + ": Try again → nothing taken");
  }
  W.scene.pose = P0(); W.scene.o = { faces: [{ pose: { yaw: 0 }, dx: 22 }] }; await W.pump(1000);
  const n = W.confirms.length; W.answers.push(true, false);
  await byRole(W.root.tree, "capture-now").props.onClick(); await W.pump(100);
  assert.deepEqual(W.confirms.slice(n).map((c) => c.title), ["This doesn't look turned to your left", "Someone else is in the picture"]);
  assert.equal(W.shots().left, undefined);
  W.root.unmount();
});

await test("I18 a hold can't be completed by time nobody saw: a hidden tab, an open question, the check restarting — each needs a full new 5 s afterwards", async () => {
  const hold = async (W) => { click(W.slot("left")); await W.pump(200); W.scene.pose = P0({ yaw: 35 }); await W.until(() => W.cueKey() === "holding", 3000, "holding"); };
  // the tab hidden for 10 s (no animation frames) after 1 s held
  let W = mountWindow();
  await W.settle(); await hold(W); await W.pump(1000);
  await W.pause(10000);
  let back = W.simT;
  let t = await W.until(() => W.shots().left, 9000, "left after the tab came back");
  assert.ok(t - back >= 5000, "hidden tab: " + (t - back) + " ms after it came back");
  W.root.unmount();
  // a question open for 4 s after 2 s held (a one-frame face blip, Capture now → "No face found", cancelled)
  W = mountWindow();
  await W.settle(); await hold(W); await W.pump(2000);
  W.scene.pose = null; await W.pump(100);
  W.defer = true;
  W.key("c"); await W.pump(100);
  assert.equal(W.confirms[0].title, "No face found");
  W.scene.pose = P0({ yaw: 35 }); await W.pump(4000);
  W.pendingAnswer(false); await W.settle(); W.defer = false;
  back = W.simT;
  t = await W.until(() => W.shots().left, 9000, "left after the question");
  assert.ok(t - back >= 5000, "question: " + (t - back) + " ms after it closed");
  W.root.unmount();
  // the detector fails mid-hold and is started again (4 s)
  let n = 0, R;
  R = mountWindow({ load: () => { n++; R.loads++; R.eng.closed = false; return n === 1 ? Promise.resolve(R.eng) : new Promise((r) => R.box.setTimeout(() => r(R.eng), 4000)); } });
  await R.settle(); await hold(R); await R.pump(2000);
  R.eng.throwNext = true; await R.pump(200);
  assert.equal(R.loads, 2, "restarted once, quietly");
  await R.until(() => R.nodes().find((n) => n.props && n.props.className === "cameo-stage").props["data-engine"] === "ready", 6000, "ready again");
  back = R.simT;
  t = await R.until(() => R.shots().left, 9000, "left after the restart");
  assert.ok(t - back >= 5000, "restart: " + (t - back) + " ms after it came back");
  R.root.unmount();
});

await test("I19 a second face the detector sees only every other frame never lets the left slot fill (15 s); gone, it fills after 1.5 s + 5 s", async () => {
  const W = mountWindow();
  await W.settle();
  click(W.slot("left")); await W.pump(200);
  W.scene.pose = P0({ yaw: 35 });
  for (let i = 0; i < 150; i++){ W.scene.o = i % 2 ? {} : { faces: [{ pose: { yaw: 35 }, dx: 22 }] }; await W.pump(100); }
  assert.equal(W.shots().left, undefined);
  W.scene.o = {};
  const gone = W.simT;
  const t = await W.until(() => W.shots().left, 9000, "left");
  assert.ok(t - gone >= 6400 && t - gone <= 6800, "after " + (t - gone));
  W.root.unmount();
});

/* ═══ V. spoken guidance (2026-10-10, owner — Likeness voice guidance: "once the head is turned you can't read the
   screen … every instruction spoken in a natural voice") ═══ */
const FULL_MANIFEST = { voice: "test", clips: Object.fromEntries(FP.VOICE_LINES.map((l) => [l.id, { text: l.text }])) };
const CLIP_BASE = "http://127.0.0.1:1/app/vendor/voice/frances-guide/v1/";
const textFor = (id) => FP.VOICE_LINES.find((l) => l.id === id).text;

await test("V1 VOICE_LINES covers every instruction the window can give (every cue × target × engine × flag, every tip, the count, the next steps): unique kebab ids, short spoken lines, no names; every clip is used", () => {
  const ids = FP.VOICE_LINES.map((l) => l.id), known = new Set(ids), used = new Set();
  assert.equal(known.size, ids.length, "unique ids");
  for (const l of FP.VOICE_LINES){
    assert.match(l.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case: " + l.id);
    assert.ok(l.text.length >= 3 && l.text.length <= 110 && /[.?!]$/.test(l.text), "a short sentence: " + l.text);
    assert.ok(!/[—…×!]|\{/.test(l.text.replace(/!$/, "")), "plain spoken words (no dashes, symbols or placeholders): " + l.text);
  }
  assert.equal(FP.VOICE_DIR, "app/vendor/voice/frances-guide/v1/");
  const use = (list, what) => { assert.ok(Array.isArray(list) && list.length, what + ": nothing to say"); for (const id of list){ assert.ok(known.has(id), what + ": no clip " + id); used.add(id); } };
  const T3 = ["front", "left", "right"], ENG = ["ready", "unavailable", "loading"];
  for (const key of Object.keys(FP.CUES)) for (const t of T3) for (const engine of ENG) for (const next of [null, "front", "left", "right"])
    use(FP.voiceCueIds(key, t, { engine, next, secsLeft: t === "front" ? 3 : 5 }), key + "/" + t + "/" + engine);
  const flagsList = [{}, { allDone: true }, { allDone: true, mismatchCount: 2 }, { allDone: true, mismatchCount: 1 }, { mismatch: true, measured: "front" }, { slow: true }];
  for (const phase of ["camera", "loading", "wait", "holding", "settle", "filled", "manual", "arming"]) for (const reason of [null, ...Object.keys(FP.CUES)])
    for (const t of T3) for (const engine of ENG) for (const flags of flagsList){
      const c = FP.cueFor({ phase, reason, secsLeft: 4, hint: reason }, null, t, { engine, next: "left", ...flags });
      use(c.voice, "cue " + c.key);
      if (c.hint) use(c.hintVoice, "tip " + c.key);
      assert.equal(typeof c.once, "boolean");
    }
  for (const g of Object.keys(FP.HINTS)) for (const t of T3){ const h = FP.voiceHintIds(g, t); use(h, "tip " + g); assert.equal(h[h.length - 1], "or-capture-now"); }
  for (const n of [1, 2, 3, 4, 5]) use([FP.voiceCountId(n)], "count " + n);
  for (const t of T3) for (const r of [false, true]) use(FP.voiceHoldIds(t, t === "front" ? 3 : 5, r), "hold " + t);
  for (const next of [null, "front", "left", "right"]) for (const e of ENG) use(FP.voiceNextIds(next, e), "next " + next);
  use(["no-pose-check"], "the pose check can't start (said once)"); use(["check-mirror"], "the mirror check is offered");
  assert.deepEqual(plainify(ids.filter((id) => !used.has(id))), [], "every clip is said somewhere");
  // the words fit the screen: the same side, the same count
  assert.deepEqual(plainify(FP.voiceCueIds("wrong-way", "right")), ["wrong-way-right"]); assert.match(textFor("wrong-way-right"), /That's your left/);
  assert.deepEqual(plainify(FP.voiceHoldIds("left", 5)), ["hold-it-there", "five"]); assert.deepEqual(plainify(FP.voiceHoldIds("front", 3)), ["hold-still", "three"]);
  assert.deepEqual(plainify(FP.voiceHoldIds("left", 5, true)), ["hold-still", "five"], "a count restarted after a small move");
  assert.deepEqual(plainify(FP.voiceCueIds("chin-down", "left")), ["chin-level"], "a side: keep your chin level");
  assert.deepEqual(plainify(FP.voiceCueIds("chin-down", "front")), ["lift-chin"]);
  assert.equal(textFor("no-pose-check"), "I can't check your pose here. Turn as the sketch shows, then press Capture now.");
  const all = FP.VOICE_LINES.map((l) => l.text).join("\n");
  assert.ok(!VENDOR_RE.test(all) && !/\bTURN\b|\bMUSE\b/.test(all) && !/Cinema ?Machine|Frances|McKee|Claude|Anthropic|OpenAI/i.test(all), "no names in what is said");
  assert.deepEqual(JSON.parse(JSON.stringify(FP.VOICE_LINES)).map((l) => Object.keys(l).join(",")), plainify(ids).map(() => "id,text"), "plain { id, text } data for the recorder");
});

/* a guide on a fake clock: recorded clips (fake-audio), the device voice (spoken for 400 ms) */
function guideRig(o = {}){
  const R = { t: 0, timers: [], spoken: [], cancels: 0, status: [], loaded: [], released: [], speechOk: o.speech !== false };
  R.setTimeout = (fn, ms) => { R.timers.push({ at: R.t + (ms || 0), fn, done: false }); return R.timers.length; };
  R.clearTimeout = (id) => { const x = R.timers[id - 1]; if (x) x.done = true; };
  R.audio = o.audio === false ? null : makeAudioEnv({ files: o.files, autoplay: o.autoplay, playMs: o.playMs || 600, setTimeout: R.setTimeout, now: () => R.t });
  R.g = fpBox.turnFacePose.createVoiceGuide({ base: CLIP_BASE, now: () => R.t, setTimeout: R.setTimeout, clearTimeout: R.clearTimeout,
    makeAudio: R.audio ? () => new R.audio.Audio() : null,
    loadClip: (url) => { R.loaded.push(url); return Promise.resolve(R.audio && R.audio.exists(url) ? url : null); },
    releaseClip: (u) => R.released.push(u),
    loadManifest: () => o.manifestPromise || Promise.resolve(o.manifest === undefined ? FULL_MANIFEST : o.manifest),
    speak: (text, done) => { if (!R.speechOk) return false; R.spoken.push(text); R.setTimeout(() => done(true), 400); return true; },
    cancelSpeech: () => { R.cancels++; }, canSpeak: () => R.speechOk, onStatus: (st) => R.status.push(st) });
  R.flush = async () => { for (let i = 0; i < 4; i++) await macro(); };
  R.advance = async (ms) => {
    const end = R.t + ms;
    for (;;){
      const due = R.timers.filter((x) => !x.done && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      R.t = Math.max(R.t, due.at); due.done = true; due.fn(); await R.flush();
    }
    R.t = end; await R.flush();
  };
  R.clips = () => R.audio ? R.audio.audible() : [];
  R.rows = () => plainify(R.g.state.played);
  return R;
}

await test("V2 the player's rules: one clip at a time; the same words not again within 4 s; a new instruction interrupts a stale one; the countdown plays in order and a 'hold still' never cuts it; 'Got it' interrupts everything; reminders after 6 s, then further apart", async () => {
  const R = guideRig({ playMs: 2000 });
  R.g.preload(); await R.flush();
  assert.deepEqual(R.loaded, plainify(FP.VOICE_LINES.map((l) => CLIP_BASE + l.id + ".mp3")), "every clip preloaded when the window opens, from the clips folder");
  assert.equal(R.audio.created.length, 1, "one audio element plays them all");
  assert.ok(R.audio.created[0].preload === "auto" && R.audio.created[0].volume === 0.7, "a moderate volume");
  assert.equal(R.g.say(["move-closer"]), true); await R.flush();
  assert.deepEqual(R.clips(), ["move-closer"]); assert.equal(R.g.state.via, "clip");
  await R.advance(1000);
  assert.equal(R.g.say(["move-closer"]), false, "the same words 1 s later: not again");
  await R.advance(3100);
  assert.equal(R.g.say(["move-closer"]), true, "after 4 s it may be said again"); await R.flush();
  // a new instruction interrupts the stale one
  await R.advance(300);
  R.g.say(["move-back"]); await R.flush();
  assert.equal(R.g.state.playing, "move-back"); assert.equal(R.rows().filter((r) => r.id === "move-closer").pop().cut, true, "the stale line was cut");
  assert.deepEqual(R.audio.playing(), ["move-back"], "one clip at a time");
  // the countdown interrupts a stale line, plays in order, and isn't cut by "hold still"
  await R.advance(500);
  R.g.say(FP.voiceHoldIds("left", 5), { kind: "count" }); await R.flush();
  assert.equal(R.g.state.playing, "hold-it-there"); assert.deepEqual(plainify(R.g.state.queue), ["five"]);
  await R.advance(1000); R.g.say(["four"], { kind: "count" });
  assert.equal(R.g.say(["hold-still"]), false, "a 'hold still' during the count is dropped"); await R.flush();
  assert.equal(R.g.state.playing, "hold-it-there", "…and the count isn't cut");
  await R.advance(1000); R.g.say(["three"], { kind: "count" }); await R.flush();
  await R.advance(10000);
  // (2026-10-10) a number that's already late is skipped for the newest one, so the voice stays on the real count:
  // with 2 s clips "five" was still waiting when "four" came, so it was skipped; the order never goes backwards
  assert.deepEqual(R.clips().slice(-4), ["move-back", "hold-it-there", "four", "three"], "in order, late numbers skipped: " + R.clips().join(" "));
  assert.ok(R.audio.created[0].playbackRate === 1.3 || R.audio.created[0].playbackRate == null, "numbers play a little faster to keep up");
  // "Got it" interrupts everything, the queue included
  R.g.say(["two"], { kind: "count" }); R.g.say(["one"], { kind: "count" }); await R.flush();
  R.g.say(["got-it", "turn-right"], { kind: "now" }); await R.flush();
  assert.equal(R.g.state.playing, "got-it"); assert.deepEqual(plainify(R.g.state.queue), ["turn-right"], "the numbers still waiting are gone");
  await R.advance(5000);
  assert.deepEqual(R.clips().slice(-3), ["two", "got-it", "turn-right"]);
  // the hold broke: numbers still waiting are dropped, the one being said finishes
  R.g.say(["hold-still", "three"], { kind: "count" }); await R.flush(); R.g.dropCount();
  assert.deepEqual(plainify(R.g.state.queue), []); await R.advance(3000);
  // cue(): said on a change; the same instruction only as a reminder — 6 s, then 9, 12, 15 s — while nothing else is said
  const at = [];
  R.g.cue("not-turned|left", ["turn-left"]); await R.flush(); at.push(R.t);
  for (let i = 0; i < 600; i++){ await R.advance(100); if (R.g.cue("not-turned|left", ["turn-left"])) at.push(R.t); }
  const gaps = at.slice(1).map((x, i) => x - at[i]);
  assert.ok(gaps.length >= 4, "reminders: " + gaps);
  assert.ok(gaps[0] >= 6000 && gaps[0] < 6300 && gaps[1] >= 9000 && gaps[2] >= 12000 && gaps.slice(3).every((g) => g >= 15000 && g < 15300), "6, 9, 12, 15 s: " + gaps);
  // a cue said once (the person acts on it) is never repeated
  const n0 = R.clips().length;
  R.g.cue("complete|front", ["all-done"], { remind: false }); await R.advance(30000);
  for (let i = 0; i < 20; i++){ R.g.cue("complete|front", ["all-done"], { remind: false }); await R.advance(1000); }
  assert.equal(R.clips().length - n0, 1, "said once");
  // a change back to a line said a moment ago in "Got it …" isn't said twice
  R.g.say(["got-it", "turn-left"], { kind: "now" }); await R.advance(300);
  assert.equal(R.g.cue("not-turned|left#2", ["turn-left"]), false, "just said inside 'Got it. Now turn …'");
  R.g.close();
});

await test("V3 close() stops and releases every clip; setEnabled(false) silences; nothing plays afterwards", async () => {
  const R = guideRig({ playMs: 3000 });
  R.g.preload(); await R.flush();
  R.g.say(["turn-left"]); await R.flush();
  assert.deepEqual(R.audio.playing(), ["turn-left"]);
  assert.equal(R.audio.plays[0].volume, 0.7);
  R.g.setEnabled(false);
  assert.deepEqual(R.audio.playing(), [], "Voice off: stopped at once"); assert.equal(R.g.say(["move-back"]), false);
  R.g.setEnabled(true); R.g.say(["move-back"]); await R.flush();
  R.g.close();
  assert.deepEqual(R.audio.playing(), [], "closed: nothing playing");
  assert.ok(R.audio.created.every((a) => a.released), "the element let go (src removed)");
  assert.equal(R.released.length, FP.VOICE_LINES.length, "every preloaded clip released");
  const n = R.audio.plays.length;
  assert.equal(R.g.say(["move-back"], { kind: "now" }), false); await R.advance(10000);
  assert.equal(R.audio.plays.length, n, "nothing after close"); assert.equal(R.g.state.closed, true);
});

await test("V4 fallbacks: a clip that's missing, errors or can't autoplay is said by the device voice; with neither the line is 'silent' (the window shows its caption); a recorded clip whose words changed is never played", async () => {
  // no manifest yet (nothing recorded): every line by the device voice, no audio file is requested
  let R = guideRig({ manifest: null });
  R.g.preload(); await R.flush();
  assert.equal(R.audio.created.length, 0, "no audio element without a manifest"); assert.equal(R.loaded.length, 0, "no clip requested");
  assert.equal(R.status.pop().clips, 0);
  R.g.say(["hold-it-there", "five"], { kind: "count" }); await R.advance(2000);
  assert.deepEqual(R.spoken, ["Hold it there.", "Five."]); assert.deepEqual(R.rows().map((r) => r.via), ["speech", "speech"]);
  R.g.close();
  // one clip missing on the server; one that errors when played
  R = guideRig({ files: new Set(FP.VOICE_LINES.map((l) => l.id).filter((id) => id !== "a-little-further")) });
  R.g.preload(); await R.flush();
  R.audio.failAt("too-far");
  R.g.say(["a-little-further"]); await R.advance(1000);
  R.g.say(["too-far"]); await R.advance(1000);
  R.g.say(["move-back"]); await R.advance(1000);
  assert.deepEqual(R.spoken, ["A little further.", "Not so far. Come back a little."]); assert.deepEqual(R.clips(), ["move-back"]);
  assert.equal(R.g.state.silent, false);
  R.g.close();
  // autoplay refused: the device voice, until a click lets the clips play
  R = guideRig({ autoplay: "blocked" });
  R.g.preload(); await R.flush();
  R.g.say(["look-straight"]); await R.advance(1000);
  assert.deepEqual(R.spoken, ["Look straight at the camera."]); assert.equal(R.g.state.blocked, true);
  R.g.say(["move-closer"]); await R.advance(1000);
  assert.deepEqual(R.spoken.slice(-1), ["Move a little closer."], "still blocked: the device voice, without trying the clip");
  R.audio.unblock(); R.g.unlock(); await R.flush();
  assert.equal(R.audio.plays.length, 1, "the click plays the element once…"); assert.equal(R.audio.plays[0].muted, true, "…muted");
  assert.equal(R.g.state.primed, true); assert.equal(R.audio.created[0].muted, false);
  R.g.say(["move-back"]); await R.advance(1000);
  assert.deepEqual(R.clips(), ["move-back"], "after the click: the clip");
  R.g.close();
  // neither: silent → the status says so (once)
  R = guideRig({ manifest: null, speech: false });
  R.g.preload(); await R.flush();
  assert.equal(R.g.say(["turn-left"]), true); await R.flush();
  assert.equal(R.g.state.silent, true); assert.equal(R.status.filter((s) => s.silent).length >= 1, true);
  assert.deepEqual(R.rows().map((r) => r.via), ["none"]);
  R.g.close();
  // a clip recorded with other words is never played
  const man = JSON.parse(JSON.stringify(FULL_MANIFEST)); man.clips["move-closer"].text = "Come closer.";
  R = guideRig({ manifest: man });
  R.g.preload(); await R.flush();
  assert.ok(!R.loaded.some((u) => /move-closer/.test(u)), "not even loaded");
  R.g.say(["move-closer"]); await R.advance(1000);
  assert.deepEqual(R.spoken, ["Move a little closer."]);
  R.g.close();
  // lines wait for the manifest (up to 1.5 s) so the first line is in the recorded voice too
  let answer; R = guideRig({ manifestPromise: new Promise((r) => { answer = r; }) });
  R.g.preload(); R.g.say(["getting-ready"]); await R.advance(500);
  assert.deepEqual(R.spoken, []); answer(FULL_MANIFEST); await R.advance(100);
  assert.deepEqual(R.clips(), ["getting-ready"]);
  R.g.close();
  R = guideRig({ manifestPromise: new Promise(() => {}) });
  R.g.preload(); R.g.say(["getting-ready"]); await R.advance(1600);
  assert.deepEqual(R.spoken, ["One moment, getting ready."], "a manifest that never answers: the device voice after 1.5 s");
  R.g.close();
});

await test("I20 a clean picture: over the camera only the arrow, the meter, the sketch, the ring and the badge — no instruction text; the caption UNDER the picture shows only with Voice off or when nothing can speak; the screen reader hears every instruction either way", async () => {
  const W = mountWindow();
  await W.settle();
  await W.until(() => W.shots().front, 6000, "Front");
  await W.pump(3000);
  const stage = W.stage();
  const allowed = /^(cameo-video|cameo-guide|cameo-pose cameo-guide-ghost|cameo-ring|cameo-turn-arrow|cameo-flash|cameo-anglebadge|cameo-meter)/;
  const tops = [];
  const walk = (n) => { if (n == null || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.type === "string" && n.type !== "#frag" && n.props && (n.props.className || n.type === "video")) { tops.push(n); return; } walk(n.children); };
  walk(stage.children);
  assert.ok(tops.length >= 6, tops.length);
  for (const kid of tops) assert.match(kid.props.className || kid.type, allowed, "only these on the picture: " + (kid.props.className || kid.type));
  assert.ok(!nodesOf(stage).some((n) => n.type === "button"), "no button on the picture");
  assert.ok(!nodesOf(stage).some((n) => n.props && /cue|caption|hint|capnow|fix|cameo-note/.test(n.props.className || "")));
  const badge = nodesOf(stage).find((n) => n.props && n.props.className === "cameo-anglebadge");
  const meter = nodesOf(stage).find((n) => n.props && n.props.className === "cameo-meter");
  assert.equal(textOf(stage), textOf(badge) + textOf(meter), "the only words on the picture: the badge and the meter's labels");
  assert.equal(textOf(badge), "Now: Your left · optional");
  assert.ok(nodesOf(stage).some((n) => n.props && /^cameo-turn-arrow left/.test(n.props.className || "")), "the arrow stays");
  assert.ok(nodesOf(stage).some((n) => n.props && n.props["data-pose"] === "left"), "the sketch stays");
  // the caption is below the picture, not inside it; hidden while the voice speaks
  const modal = W.nodes().find((n) => n.props && n.props.className === "cameo-modal");
  const kids = modal.children.flat(Infinity).filter((n) => n && typeof n === "object");
  const iStage = kids.findIndex((n) => n.props.className === "cameo-stage"), iUnder = kids.findIndex((n) => n.props.className === "cameo-under");
  assert.ok(iStage >= 0 && iUnder === iStage + 1, "the line sits right under the picture");
  assert.ok(!nodesOf(stage).includes(W.cue()) && nodesOf(kids[iUnder]).includes(W.cue()));
  assert.equal(W.cueKey(), "not-turned"); assert.equal(W.captionShown(), false, "spoken: no caption");
  assert.equal(W.cue().props["aria-hidden"], "true", "the caption isn't read twice");
  assert.match(W.sr(), /^Turn your head to your left — toward the left edge of the screen/, "the screen reader hears it");
  assert.equal(W.nodes().find((n) => n.props && n.props.className === "cameo-sr").props["aria-live"], "polite");
  // Voice off: silent at once, and the caption shows
  const n = W.utter.length, c0 = W.cancels || 0;
  click(byRole(W.root.tree, "voice")); await W.pump(100);
  assert.equal(W.captionShown(), true, "Voice off: the caption shows"); assert.ok((W.cancels || 0) > c0, "speech stopped");
  assert.equal(W.cueText(), "Turn your head to your left — toward the left edge of the screen");
  assert.equal(W.box.localStorage.getItem("turn_cameo_voice"), "0");
  W.scene.pose = P0({ yaw: 18 }); await W.pump(8000);
  assert.equal(W.utter.length, n, "nothing said with Voice off");
  assert.equal(W.cueText(), "A little further to your left");
  click(byRole(W.root.tree, "voice")); await W.pump(1500);
  assert.equal(W.captionShown(), false); assert.ok(W.said().slice(n).includes("A little further."), "on again: the current instruction is said");
  W.root.unmount();
  // remembered off: silent from the start, the caption shown
  const Q = mountWindow({ voiceOff: true });
  await Q.settle(); await Q.until(() => Q.shots().front, 6000, "Front"); await Q.pump(3000);
  assert.equal(Q.utter.length, 0); assert.equal(Q.captionShown(), true); assert.equal(byRole(Q.root.tree, "voice").props["aria-pressed"], "false");
  Q.root.unmount();
  // nothing can speak (no recorded clips, no device voice): the caption shows
  const N = mountWindow({ voices: [{ localService: false, lang: "en-US" }] });
  await N.settle(); await N.pump(500);
  assert.equal(N.captionShown(), true); assert.equal(byRole(N.root.tree, "voice").props.disabled, true);
  N.root.unmount();
  // the device voice refuses (not allowed) and there are no clips: after the first line the caption shows
  const F = mountWindow(); F.speechMode = "fail";
  await F.settle(); await F.until(() => F.utter.length > 0, 6000, "a line tried"); await F.pump(300);
  assert.equal(F.captionShown(), true, "the voice can't play: the caption shows");
  F.root.unmount();
});

await test("I21 Capture now: hidden while the photo takes itself (Auto on, pose check running); shown while the check loads or can't start, with Auto off, and once the 20-second tip says 'or press Capture now'; the C key works throughout", async () => {
  const W = mountWindow();
  await W.settle(); await W.pump(300);
  assert.equal(W.stage().props["data-engine"], "ready");
  assert.equal(byRole(W.root.tree, "capture-now"), undefined, "Front, auto: hidden");
  click(W.slot("left")); await W.pump(500);
  assert.equal(byRole(W.root.tree, "capture-now"), undefined, "a side, auto: hidden");
  await W.pump(21000);
  assert.ok(W.hint(), "the tip after 20 s");
  const b = byRole(W.root.tree, "capture-now");
  assert.ok(b, "with the tip: shown"); assert.equal(textOf(b), "Capture now");
  assert.ok(!nodesOf(W.stage()).includes(b) && nodesOf(W.nodes().find((n) => n.props && n.props.className === "cameo-under")).includes(b), "under the picture");
  click(W.slot("right")); await W.pump(300);
  assert.equal(byRole(W.root.tree, "capture-now"), undefined, "another angle: hidden again");
  click(byRole(W.root.tree, "auto")); await W.pump(100);
  assert.ok(byRole(W.root.tree, "capture-now"), "Auto off: shown");
  click(byRole(W.root.tree, "auto")); await W.pump(100);
  assert.equal(byRole(W.root.tree, "capture-now"), undefined);
  W.scene.pose = P0({ yaw: -35 }); await W.pump(800);
  W.key("c"); await W.pump(200);
  assert.ok(W.shots().right, "the C key with the button hidden");
  W.root.unmount();
  const L = mountWindow({ load: () => new Promise(() => {}) });
  await L.settle(); await L.pump(300);
  assert.equal(L.stage().props["data-engine"], "loading"); assert.ok(byRole(L.root.tree, "capture-now"), "still loading: shown");
  L.root.unmount();
  const U = mountWindow({ load: async () => { const e = new Error("x"); e.code = "unsupported"; throw e; } });
  await U.settle(); await U.pump(300);
  assert.ok(byRole(U.root.tree, "capture-now"), "the check can't start: shown");
  U.root.unmount();
});

await test("I22 with the recorded clips: every line is played from app/vendor/voice/frances-guide/v1/<id>.mp3 (no device voice needed), the countdown in order; a missing clip is said by the device voice; autoplay held back → the device voice until a click; closing the window stops and releases them", async () => {
  const W = mountWindow({ audio: { files: null, playMs: 500 }, manifest: FULL_MANIFEST, voices: [{ localService: false, lang: "en-US" }] });
  await W.settle(); await W.pump(100);
  assert.ok(W.fetches.includes(CLIP_BASE + "manifest.json"), "the manifest is read from the clips folder: " + W.fetches.join(" "));
  assert.deepEqual(W.fetches.filter((u) => /\.mp3$/.test(u)), plainify(FP.VOICE_LINES.map((l) => CLIP_BASE + l.id + ".mp3")), "every clip preloaded when the window opens");
  assert.equal(W.audio.created.length, 1, "one audio element");
  assert.equal(byRole(W.root.tree, "voice").props.disabled, false, "clips: Voice works without a device voice");
  await W.until(() => W.shots().front, 6000, "Front");
  await W.pump(3000);
  const ids = W.audio.audible();
  const from = ids.indexOf("hold-still");
  assert.deepEqual(ids.slice(from, from + 6), ["hold-still", "three", "two", "one", "got-it", "turn-left"], ids.join(" "));
  assert.ok(W.audio.plays.every((p) => p.volume === 0.7)); assert.equal(W.utter.length, 0, "no device voice");
  assert.equal(W.captionShown(), false);
  W.scene.pose = P0({ yaw: 35 });
  await W.until(() => W.shots().left, 9000, "left");
  const ids2 = W.audio.audible();
  const h = ids2.lastIndexOf("hold-it-there");
  assert.deepEqual(ids2.slice(h, h + 7), ["hold-it-there", "five", "four", "three", "two", "one", "got-it"], ids2.join(" "));
  W.root.unmount();
  assert.deepEqual(W.audio.playing(), [], "closed: silent"); assert.ok(W.audio.created.every((a) => a.released), "…and the element let go");
  const n = W.audio.plays.length; await W.pump(3000); assert.equal(W.audio.plays.length, n);
  // one clip missing: that line by the device voice
  const M = mountWindow({ audio: { files: new Set(FP.VOICE_LINES.map((l) => l.id).filter((id) => id !== "turn-left")), playMs: 500 }, manifest: FULL_MANIFEST });
  await M.settle(); await M.until(() => M.shots().front, 6000, "Front"); await M.pump(3000);
  assert.ok(M.said().includes(textFor("turn-left")), "the missing clip's line: " + M.said().join(" | "));
  assert.ok(M.audio.plays.some((p) => p.id === "got-it"));
  M.root.unmount();
  // autoplay held back: the device voice; a click in the window lets the clips play again
  const B = mountWindow({ audio: { files: null, autoplay: "blocked", playMs: 500 }, manifest: FULL_MANIFEST });
  await B.settle(); await B.until(() => B.shots().front, 6000, "Front"); await B.pump(1000);
  assert.ok(B.said().includes("Got it."), "blocked: the device voice says it"); assert.equal(B.audio.plays.length, 0);
  B.audio.unblock();
  B.nodes().find((n) => n.props && n.props.className === "cameo-modal").props.onPointerDown();
  B.scene.pose = P0({ yaw: 18 }); await B.pump(2000);
  assert.ok(B.audio.audible().includes("a-little-further"), "after the click, clips again: " + B.audio.audible().join(" "));
  B.root.unmount();
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

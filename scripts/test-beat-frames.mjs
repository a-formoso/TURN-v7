#!/usr/bin/env node
/* test-beat-frames.mjs — A BEAT, BROKEN DOWN IN CODE (owner 2026-11-26: "let's use this structure to breakdown each
   beat in a scene using code, treating each moment as a shot ... the first frame of each moment as our shot keyframe").
   The fixture is the owner's own pack, Scene 06 beat 1 (scripts/fixtures/scene06-beat1-pack.js, as they sent it):
   5 moments, 18 frames, 31.1 seconds. Their frame board shows frame 1.2.1 at 7.6 s and 1.4.1 at 17.1 s.

   node scripts/test-beat-frames.mjs */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n    " + String(e && e.message).split("\n").slice(0, 6).join("\n    ")); } };
const box = {}; box.globalThis = box; vm.createContext(box);
vm.runInContext(read("app/beat-frames.js"), box);
vm.runInContext(read("scripts/fixtures/scene06-beat1-pack.js") + "\n;globalThis.SCENE = SCENE;", box);
const F = box.KinolotBeatFrames, plain = v => JSON.parse(JSON.stringify(v)), near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 0.011), a + " is about " + b);
const made = F.normalize(F.fromPack(box.SCENE)), B = made.breakdown;

test("1 the pack in the app's terms: metres on the floor plan (y north), degrees from north, cameras as position, yaw, pitch and lens", () => {
  const p = F.fromPack(box.SCENE);
  assert.deepEqual(plain(p.start.people.L), { at: [2.85, -2.95], face: 0, pose: "handsAtBelt", stride: 0 }, "z runs south in the pack, y north here; pi (north) is 0 degrees");
  near(p.start.people.P.face, 339.9, 0.11);                                    // 3.492 rad: a little west of north
  const wide = p.cameras.WIDE; assert.deepEqual(plain(wide.position), [1.1, -5.45, 1.59]);
  near(wide.yaw, 42.2, 0.11); near(wide.pitch, -6.22, 0.02); near(wide.lensMm, 21.7, 0.11); assert.equal(wide.role, "the suite: the desk, the board, both men");
  near(p.cameras.CELL.lensMm, 47.6, 0.11);                                     // a 24 degree view is a long lens
  assert.deepEqual(plain(p.props.bag.places.desk), { at: [3.3, -2.38, 1.2] }); assert.equal(p.props.seal.places.open, null, "a thing not seen has no place");
  assert.deepEqual(plain(p.props.tub.places.hands), { hands: "L", offset: [0, 0.05, 0], minZ: 1.3 });
  assert.deepEqual(plain(p.beats[0].moments[4].frames[1].set.people.P), { at: [3.282, -2.997], face: 134.9, pose: "takingElbow" });
  assert.equal(p.poses.L.coiling.length, 10); assert.equal(F.POSE_N, 10);
});

test("2 made safe: 5 moments and 18 frames numbered beat.moment.frame; what the breakdown does not define is dropped and said", () => {
  assert.equal(made.report.frames, 18); assert.equal(made.report.moments, 5); assert.deepEqual(plain(made.report.dropped), []);
  assert.deepEqual(plain(F.frames(B).map(f => f.id)), ["1.1.1", "1.1.2", "1.1.3", "1.1.4", "1.2.1", "1.2.2", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.4.1", "1.4.2", "1.5.1", "1.5.2", "1.5.3", "1.5.4", "1.5.5", "1.5.6"]);
  const raw = F.fromPack(box.SCENE); raw.beats[0].moments[0].frames[1].cam = "NOWHERE"; raw.beats[0].moments[0].frames[1].set.people.L.pose = "dancing";
  raw.beats[0].moments[0].frames[2].set.props.belt = "ceiling"; raw.beats[0].moments[0].frames[2].set.people.Z = { at: [0, 0] }; raw.beats[0].moments[0].frames[3].into = 900;
  const bad = F.normalize(raw), fr = F.frames(bad.breakdown);
  assert.equal(fr[1].cam, "WIDE", "a frame with an unknown camera keeps the one before it"); assert.deepEqual(plain(fr[1].set.people), {}); assert.deepEqual(plain(fr[2].set.props), {}); assert.equal(fr[3].into, 30);
  assert.deepEqual(plain(bad.report.dropped), ["1.1.2: there is no camera called NOWHERE", "1.1.2: L has no pose called dancing", "1.1.3: nobody is called Z", "1.1.3: belt has no place called ceiling"]);
});

test("3 one state that goes on: each frame changes only what it names", () => {
  const st = F.states(B);
  assert.deepEqual(plain(st[0].props), { forms: "desk", bag: "desk", seal: "open", belt: "worn", phone: "pocket", tub: "counter" });
  assert.equal(st[1].props.belt, "pulling"); assert.equal(st[3].props.belt, "counter"); assert.equal(st[17].props.belt, "counter", "the belt stays on the counter to the end");
  assert.equal(st[9].props.tub, "bag"); assert.equal(st[12].props.seal, "sealed"); assert.equal(st[17].props.phone, "bag");
  assert.equal(st[4].people.P.pose, "lookingUp"); assert.equal(st[6].people.P.pose, "signing"); assert.equal(st[11].people.P.pose, "signing", "Pike goes on signing until a frame says otherwise");
  assert.deepEqual(plain(st[11].people.L.at), [2.85, -2.95], "nobody has left the counter yet"); assert.deepEqual(plain(st[16].people.L.at), [6.197, -5.248]);
  assert.equal(st[17].cam, "CELL"); assert.deepEqual(plain(st[17].people), plain(st[16].people), "the last frame only changes the camera");
});

test("4 when: the same times as the owner's frame board (1.2.1 at 7.6 s, 1.4.1 at 17.1 s, 31.1 s in all)", () => {
  const tl = F.timeline(B), f = id => tl.frames.find(x => x.id === id);
  assert.equal(tl.seconds, 31.1); assert.equal(f("1.2.1").t0, 7.6); assert.equal(f("1.4.1").t0, 17.1);
  assert.deepEqual(plain(f("1.1.2")), { id: "1.1.2", beat: 1, moment: 1, t0: 1, t1: 2.6, t2: 3 });
  assert.deepEqual(plain(tl.moments.map(m => [m.name, m.from, m.seconds])), [["The belt", 0, 7.6], ["The questions", 7.6, 4.2], ["The bag", 11.8, 5.3], ["The solicitor", 17.1, 4.4], ["The corridor", 21.5, 9.6]]);
  assert.deepEqual(plain(tl.beats), [{ n: 1, name: "Placates", from: 0, to: 31.1, seconds: 31.1 }]);
});

test("5 every picture in between: places, the way a person faces and the ten numbers of a pose move smoothly; a camera cuts unless it glides", () => {
  const a0 = F.at(B, 0); assert.equal(a0.id, "1.1.1"); assert.equal(a0.cam, "WIDE"); assert.deepEqual(plain(a0.people.L.joints), plain(B.poses.L.handsAtBelt));
  // half way into 1.1.2 (1.0 to 2.6 s): half way between the two poses, and the belt on its way
  const mid = F.at(B, 1.8); assert.equal(mid.id, "1.1.2"); assert.equal(mid.k, 0.5);
  near(mid.people.L.joints[5], (-0.12 + 0.9) / 2, 0.002); assert.deepEqual(plain(mid.props.belt), { from: "worn", to: "pulling", k: 0.5 }); assert.deepEqual(plain(mid.props.bag), { from: "desk", to: "desk", k: 1 });
  // resting on a frame: exactly that frame
  const rest = F.at(B, 2.8); assert.equal(rest.k, 1); assert.deepEqual(plain(rest.people.L.joints), plain(B.poses.L.pullingBelt)); assert.deepEqual(plain(rest.props.belt), { from: "pulling", to: "pulling", k: 1 });
  // a cut: the new camera from the first instant of the move
  assert.equal(F.at(B, 3.01).cam, "COUNTER"); assert.equal(F.at(B, 3.01).id, "1.1.3");
  // a glide (1.5.4, 26.0 to 27.2 s): the camera travels, and both men are between their two places
  const glide = F.at(B, 26.6); assert.deepEqual(plain(glide.cam), { from: "FOLLOW1", to: "FOLLOW2", k: 0.5 });
  near(glide.people.P.at[0], (3.905 + 4.909) / 2, 0.002); near(glide.people.P.at[1], -(3.585 + 4.307) / 2, 0.002); near(glide.people.P.face, (129.8 + 117.7) / 2, 0.15);
  // the end, and past it
  assert.equal(F.at(B, 31.1).id, "1.5.6"); assert.equal(F.at(B, 99).id, "1.5.6"); assert.equal(F.at(B, -3).id, "1.1.1");
  // the way a person faces turns the short way round (350 to 10 passes north, never the long way through south)
  const two = F.normalize({ cast: { A: { name: "A", height: 1.7 } }, poses: {}, cameras: { C: { position: [0, 0, 1.5], yaw: 0, pitch: 0, lensMm: 35 } }, props: {}, start: { people: { A: { at: [0, 0], face: 350 } }, props: {} },
    beats: [{ name: "b", moments: [{ name: "m", frames: [{ cam: "C", into: 0, hold: 1, set: {} }, { cam: "C", into: 2, hold: 0, set: { people: { A: { face: 10 } } } }] }] }] }).breakdown;
  assert.equal(F.at(two, 2).people.A.face, 0);
});

test("6 a moment is a shot: its first frame is the starting frame; and when its blockout is worth giving to the video engine", () => {
  const sh = F.shots(B);
  assert.deepEqual(plain(sh.map(s => [s.key, s.name, s.start, s.end, s.seconds, s.clipSeconds])), [["1.1", "The belt", "1.1.1", "1.1.4", 7.6, 7.6], ["1.2", "The questions", "1.2.1", "1.2.2", 4.2, 4.2],
    ["1.3", "The bag", "1.3.1", "1.3.4", 5.3, 5.3], ["1.4", "The solicitor", "1.4.1", "1.4.2", 4.4, 4.4], ["1.5", "The corridor", "1.5.1", "1.5.6", 9.6, 9.6]]);
  assert.deepEqual(plain(sh.map(s => [s.cameras.join(">"), s.cuts, s.glides])), [["WIDE>COUNTER", 1, 0], ["TWO", 0, 0], ["INSERT", 0, 0], ["PIKE", 0, 0], ["BAG>ELBOW>FOLLOW1>FOLLOW2>FOLLOW3>CELL", 3, 2]]);
  assert.deepEqual(plain(sh.map(s => s.handled)), [["belt"], [], ["phone", "tub"], [], ["bag", "seal"]]);
  near(sh[4].walk, 4.26, 0.02); assert.equal(sh[1].walk, 0);
  // the two moments of talk start from their frame and are told in words; the three in which things travel carry their blockout
  assert.deepEqual(plain(sh.map(s => s.blockout.send)), [true, false, true, false, true]);
  assert.equal(sh[0].blockout.why, "In this shot one thing changes place, the camera cuts once."); assert.equal(sh[2].blockout.why, "In this shot 2 things change place.");
  assert.equal(sh[4].blockout.why, "In this shot someone walks 4.3 m, 2 things change place, the camera moves, the camera cuts 3 times.");
  assert.equal(sh[1].blockout.why, "Nobody leaves their place and nothing changes hands: the starting frame and the words are enough.");
  assert.deepEqual(plain(sh[1].lines), ["PIKE: Any medication? Thoughts of self-harm?", "LIAQAT: No, sir. No problem."]);
  // the video engine's own limits: a clip is 4 to 30 seconds, and a shot longer than its reference limit cannot carry its blockout
  assert.deepEqual(plain(F.CLIP), { min: 4, max: 30, referenceMax: 30.2 });
  const short = F.fromPack(box.SCENE); short.beats[0].moments[1].frames[0].hold = 0.2; assert.equal(F.shots(F.normalize(short).breakdown)[1].clipSeconds, 4, "a shot under 4 seconds is a 4 second clip");
  const long = F.fromPack(box.SCENE); long.beats[0].moments[4].frames[5].hold = 25; const ls = F.shots(F.normalize(long).breakdown)[4];
  assert.equal(ls.long, true); assert.equal(ls.clipSeconds, 30); assert.equal(ls.blockout.send, false); assert.match(ls.blockout.why, /longer than the 30\.2 seconds/);
});

test("7 the limits are the Stage's own", () => {
  const stage = read("app/stage.jsx");
  assert.ok(stage.includes("editOutputSeconds: 30,") && stage.includes("editInputSeconds: 30.2,"), "a Seedance 2.5 clip is at most 30 s and its reference videos 30.2 s in all");
  assert.ok(/Primary beat-first model: timed 4.30s clips/.test(stage), "and at least 4 s");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

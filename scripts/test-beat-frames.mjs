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

test("8 the frame board of a beat from what its plan already holds: a shot's frames are how it starts, midway, and how it ends", () => {
  const bd = F.board(1, "", [{ n: 1, name: "Medium", seconds: 5, says: "Come in. Tea?", cam: "Medium shot", shotId: "a", steps: ["start", "end"] },
    { n: 2, name: "Two-shot", seconds: 6, says: "", cam: "", shotId: "b", steps: ["start", "mid", "end"] }, { n: 3, name: "Insert", seconds: 4, says: "The keys.", cam: "Insert", shotId: "c", steps: ["start"] }]);
  assert.deepEqual(plain(bd.frames.map(f => [f.id, f.step, f.stepWord, f.shotId, f.first, f.t0, f.t2])), [["1.1.1", "start", "Starts", "a", true, 0, 1.5], ["1.1.2", "end", "Ends", "a", false, 1.5, 5],
    ["1.2.1", "start", "Starts", "b", true, 5, 6.5], ["1.2.2", "mid", "Midway", "b", false, 6.5, 8.3], ["1.2.3", "end", "Ends", "b", false, 8.3, 11], ["1.3.1", "start", "Starts", "c", true, 11, 15]]);
  assert.equal(bd.seconds, 15, "the beat lasts as long as its shots"); assert.deepEqual(plain(bd.moments.map(m => [m.n, m.name, m.from, m.seconds])), [[1, "Medium", 0, 5], [2, "Two-shot", 5, 6], [3, "Insert", 11, 4]]);
  assert.equal(bd.frames[0].says, "Come in. Tea?"); assert.equal(bd.frames[5].cam, "Insert"); assert.equal(bd.frames[0].momentName, "Medium");
  // a shot with no drawing yet still has its place on the board; a step the board does not know is left out
  assert.deepEqual(plain(F.board(2, "", [{ n: 1, name: "Wide", seconds: 3, shotId: "x", steps: [] }, { n: 2, name: "Close", seconds: 3, shotId: "y", steps: ["start", "sideways", "end"] }]).frames.map(f => f.id)), ["2.1.1", "2.2.1", "2.2.2"]);
});

test("9 the page: the Frame board button on a beat's card opens the board across the beat's row; nothing in it makes an image or saves", () => {
  const ui = read("app/beat-frames-ui.jsx"), face = read("app/shot-beat-card-ui.jsx"), shots = read("app/shots-ui.jsx"), strip = read("app/shot-previs-ui.jsx"), html = read("TURN.html"), css = read("app/styles.css");
  assert.ok(face.includes('"data-testid":"beat-card-board"') && face.includes('board ? "Hide the frame board" : "Frame board"'));
  assert.ok(shots.includes("board:!!boardByBeat[L.n], onBoard:window.BeatFrameBoard ? (on)=>setBoardByBeat(o=>({...o,[L.n]:!!on})) : null,") && shots.includes('"data-testid":"beat-row-board"'));
  // the frames are the drawings the beat already has, in any of the three looks, each kept apart
  assert.ok(strip.includes("function beatStripRows(info, ctx, look, written){") && strip.includes('if(look) info = { ...info, sig:info.sig+"|look:"+look };') && strip.includes("...(look ? { look } : {}),"));
  assert.ok(ui.includes("window.beatStripRows(info, ctx, look, written)") && ui.includes('if(r.start) steps.push("start"); if(r.mid) steps.push("mid"); if(r.end) steps.push("end");'));
  // what the owner's own board shows: moment, name and frame; Previous, Play frames, Next; the time; a square a frame
  for (const t of ['"Moment "+f.moment+" · "+f.momentName+" · frame "+f.id', '"Previous"', 'playing ? "Stop" : "Play frames"', '"Next"', 'secs(f.t0)+" / "+secs(board.seconds)+" s"', '"data-testid":"beat-frame-board-squares"']) assert.ok(ui.includes(t), t);
  // a moment is a shot, and its first frame is the shot's starting frame: said under the picture and marked on its square
  assert.ok(ui.includes('"This is the starting frame of shot "+f.beat+"."+f.moment+": its frame is made from this picture."') && ui.includes('className:"bfb-square"+(x.first?" key":"")') && css.includes(".bfb-square.key{"));
  // Play frames gives each frame its own time
  assert.ok(ui.includes("const t = setTimeout(()=>setAt(i+1), Math.max(300,(f.t2-f.t0)*1000));"));
  assert.ok(!/onUpdate|nbGenerate|proxyGenerate|localStorage/.test(ui), "it draws in the page: no image is made; the only thing it can start is the writing pass, which asks first");
  const at = n => html.indexOf(n); const keys = ["20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1"];
  assert.ok(at("app/beat-frames.js?v=") > 0 && at("app/beat-frames.js?v=") < at("app/beat-frames-ui.jsx?v=") && at("app/shot-previs-ui.jsx?v=") > 0, "the rules are on the page before the board that reads them");
  assert.ok(keys.some(k => html.includes('app/beat-frames.js?v=' + k + '"')) && keys.some(k => html.includes('app/beat-frames-ui.jsx?v=' + k + '"')));
});

/* ---- STAGE 2: a beat's frames written out by the writing engine, made safe (owner 2026-11-26) ---- */
const START = { people: { ann: { where: "m-door", pose: "standing", holding: ["box"] } }, things: { box: { heldBy: "ann", state: "shut" }, keys: { at: "hooks" } }, doors: [{ id: "front", open: false }] };
const END = { people: { ann: { where: "m-table", pose: "standing", holding: [] } }, things: { box: { on: "table", state: "shut" }, keys: { at: "hooks" } }, doors: [{ id: "front", open: false }] };
const CTX = { shots: [{ key: "1.1", beat: 1, moment: 1, seconds: 6, start: START, end: END }], marks: { "m-door": [0, 0], "m-table": [2, 1] }, cast: ["ann"], things: ["box", "keys"], doors: ["front"], inside: xy => xy[0] >= -1 && xy[0] <= 4 };
const REST = [0, 0, 0, 0, 0.05, 0.05, 0.2, 0.05, 0.05, 0.2], HOLD = [0.05, 0, 0.3, 0, 0.45, 0, 1.3, 0.45, 0, 1.3];
test("10 written frames made safe: the first is how the shot starts, the last how it ends, the ones between are the steps", () => {
  const raw = { moments: [{ beat: 1, moment: 1, name: "The box", frames: [
    { says: "She comes in with the box.", into: 0, hold: 1, people: { ann: { face: 90, joints: HOLD, pose: "holding the box", at: [9, 9], holding: [] } } },
    { says: "Crosses to the table.", into: 2, hold: 0, people: { ann: { at: [1, 0.5], face: 60 } } },
    { says: "Reaches it.", into: 1.5, hold: 0.5, people: { ann: { where: "m-table", joints: [0.2, 0, 0.3, 0, 0.9, 0, 0.6, 0.9, 0, 0.6] } } },
    { says: "Sets it down.", into: 0.5, hold: 0.5, people: { ann: { joints: REST, holding: ["box"], at: [3, 3] } }, things: { box: { heldBy: "ann" } } }] }] };
  const got = F.written(raw, CTX), m = got.frames["1.1"];
  assert.equal(m.name, "The box"); assert.equal(m.frames.length, 4); assert.deepEqual(plain(got.report), { moments: 1, frames: 4, dropped: [] });
  // the first frame: the plan's own start (still on her mark, still holding the box), with the written pose and the way she faces
  assert.deepEqual(plain(m.frames[0].state.people.ann), { where: "m-door", pose: "holding the box", holding: ["box"], face: 90, joints: HOLD }); assert.equal(m.frames[0].into, 0);
  // between: where she is on the floor, then on the mark she arrives at; what was not named stays
  assert.deepEqual(plain(m.frames[1].state.people.ann.xy), [1, 0.5]); assert.equal(m.frames[1].state.people.ann.face, 60); assert.deepEqual(plain(m.frames[1].state.people.ann.joints), HOLD, "her pose goes on until a frame changes it");
  assert.equal(m.frames[2].state.people.ann.where, "m-table"); assert.equal(m.frames[2].state.people.ann.xy, undefined); assert.deepEqual(plain(m.frames[2].state.things.box), { state: "shut", heldBy: "ann" });
  // the last frame: the plan's own end (the box on the table, her hands empty), whatever was written; only the pose is taken
  // (she keeps the way she faced in the frame before, since the last frame did not say; her pose is the last frame's own)
  assert.deepEqual(plain(m.frames[3].state.people.ann), { where: "m-table", pose: "standing", holding: [], face: 60, joints: REST }); assert.deepEqual(plain(m.frames[3].state.things.box), { on: "table", state: "shut" });
  // the times add up to the shot's own seconds
  near(m.frames.reduce((n, f) => n + f.into + f.hold, 0), 6, 0.02);
  assert.equal(m.sig, F.stateSig(START, END)); assert.equal(F.writtenFor(got.frames, "1.1", START, END), m); assert.equal(F.writtenFor(got.frames, "1.1", START, { ...END, doors: [{ id: "front", open: true }] }), null, "a shot that was changed since no longer has its written frames");
});
test("11 what the answer got wrong is dropped and said; things and hands agree; a pose is kept within what a body can do", () => {
  const raw = { moments: [{ beat: 1, moment: 1, name: "x", frames: [{ says: "a", into: 0, hold: 1, people: { bob: { face: 0 } } },
    { says: "b", into: 1, hold: 1, people: { ann: { at: [40, 0], where: "m-moon", joints: [1, 2, 3], holding: ["keys", "sword"] }, zed: { at: [0, 0] } }, things: { sword: { heldBy: "ann" }, box: { on: "table" } }, doors: [{ id: "back", open: true }, { id: "front", open: true }] },
    { says: "c", into: 1, hold: 1, people: { ann: { joints: [9, 9, 9, 9, 9, 9, 9, -9, -9, -9] } } },
    { says: "d", into: 0, hold: 1 }] }, { beat: 1, moment: 2, name: "one frame only", frames: [{ says: "a" }] }, { beat: 7, moment: 1, frames: [{}, {}] }] };
  const got = F.written(raw, { ...CTX, shots: CTX.shots.concat([{ key: "1.2", beat: 1, moment: 2, seconds: 3, start: END, end: END }]) }), fr = got.frames["1.1"].frames;
  assert.deepEqual(Object.keys(got.frames), ["1.1"], "a shot with fewer than two frames keeps the drawings it had; a moment that is not in this beat is ignored");
  assert.deepEqual(plain(got.report.dropped), ["1.1.1: bob is not in this shot as it starts", "1.1.2: there is no mark called m-moon", "1.1.2: ann would stand off the floor", "1.1.2: a pose is ten numbers", "1.1.2: nobody is called zed",
    "1.1.2: there is no thing called sword", "1.1.2: there is no door called back", "1.2: a shot needs at least two frames"]);
  // she took the keys and set the box down: her hands and the things say the same; the door she opened is open
  assert.deepEqual(plain(fr[1].state.people.ann.holding), ["keys"]); assert.deepEqual(plain(fr[1].state.things.keys), { heldBy: "ann" }); assert.deepEqual(plain(fr[1].state.things.box), { on: "table" });
  assert.deepEqual(plain(fr[1].state.doors), [{ id: "front", open: true }]);
  assert.deepEqual(plain(fr[2].state.people.ann.joints), [1.1, 1, 0.9, 1.3, 3.1, 1.8, 2.6, -1.2, -0.3, 0], "each number is kept inside its range");
  const many = F.written({ moments: [{ beat: 1, moment: 1, frames: Array.from({ length: 9 }, (_, i) => ({ says: "f" + i, into: 1, hold: 0 })) }] }, CTX);
  assert.equal(many.frames["1.1"].frames.length, 6); assert.deepEqual(plain(many.report.dropped), ["1.1: only the first 6 frames are kept"]);
  // times that make no sense are shared out evenly over the shot's seconds
  const flat = F.written({ moments: [{ beat: 1, moment: 1, frames: [{ says: "a" }, { says: "b" }, { says: "c" }] }] }, CTX).frames["1.1"].frames;
  near(flat.reduce((n, f) => n + f.into + f.hold, 0), 6, 0.02); assert.equal(flat[0].into, 0);
});
test("12 the board takes a shot's written frames, with their own times and lines; and the page draws, writes and saves them as designed", () => {
  const bd = F.board(1, "", [{ n: 1, name: "The box", seconds: 6, says: "fallback", cam: "Medium", shotId: "a", steps: ["start", "end"], written: [{ says: "In.", into: 0, hold: 1 }, { says: "", into: 2, hold: 1 }, { says: "Down.", into: 1, hold: 1 }] },
    { n: 2, name: "Wide", seconds: 4, shotId: "b", steps: ["start", "end"] }]);
  assert.deepEqual(plain(bd.frames.map(f => [f.id, f.step, f.stepWord, !!f.written, f.says, f.t0, f.t2])), [["1.1.1", 0, "Starts", true, "In.", 0, 1], ["1.1.2", 1, "", true, "fallback", 1, 4], ["1.1.3", 2, "Ends", true, "Down.", 4, 6],
    ["1.2.1", "start", "Starts", false, "", 6, 7.2], ["1.2.2", "end", "Ends", false, "", 7.2, 10]]);
  const sp = read("app/shot-previs.js"), ui = read("app/beat-frames-ui.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx");
  // a pose in ten numbers on the figure, and a frame's own facing; a thing held is in the posed hand
  assert.ok(sp.includes("const J=(!lying&&arr(obj(o).joints).length===10&&obj(o).joints.every(v=>Number.isFinite(Number(v))))?obj(o).joints.map(Number):null;") && sp.includes("const turn=me.face!=null?-me.face*Math.PI/180:(to?turnTo(me.xy,to):null);"));
  assert.ok(sp.includes("if(p.hands&&p.hands.r&&p.hands.l){") && sp.includes("if(Array.isArray(o.steps)&&o.steps.length){ out.steps=[]; for(const st of o.steps) out.steps.push({dataUrl:await draw(stateScene(built.scene,plan,st,ctx).scene)}); }"));
  // the board reads the frames saved with the plan while they still fit the shot, and draws each through its shot's camera
  assert.ok(ui.includes("return F.writtenFor(saved, SP.shotCameraKey(sh), st.start||sh.startState, st.end||sh.endState||sh.startState); };") && ui.includes('"data-testid":"beat-frame-board-write"'));
  // the writing pass asks first, saves with the plan it was written for, and changes no shot and no image
  assert.ok(app.includes('title:"Write the frames of beat "+beatN+" (writing credits)?"') && app.includes("if(!cur || cur.at!==plan.at) return p;") && app.includes("frames:{ ...kept, ...res.frames }, framesAt:new Date().toISOString(),"));
  const fn = app.slice(app.indexOf("const writeBeatFrames = async"), app.indexOf("window.turnWriteBeatFrames ="));
  assert.ok(!/setShots|onUpdateShot|nbGenerate/.test(fn), "never on the shots");
  // (it runs on the scene plan's own engine, the one its question names: the first real pass did not, 2026-11-26)
  assert.ok(ai.includes('["aiPlanScene","aiPlanCameras","aiBeatFrames"].forEach(n=>{ const fn = window[n];') && ai.indexOf("window.aiBeatFrames = aiBeatFrames;") < ai.indexOf('["aiPlanScene","aiPlanCameras","aiBeatFrames"]'));
  assert.ok(ai.includes("async function aiBeatFrames(scene, ctx){") && ai.includes("const out = F.written(scrubbed, {") && ai.includes("THE TEN NUMBERS, in radians, always in this order: [lean, twist, head down, head turn, right arm forward, right arm out, right elbow, left arm forward, left arm out, left elbow]."));
});

test("13 stage 3: a shot starts as its moment's first written frame, wherever the app stages it", () => {
  const strip = read("app/shot-previs-ui.jsx"), ui = read("app/beat-frames-ui.jsx"), app = read("app/app.jsx");
  // the one staging takes the plan: a shot whose written frames still fit starts as the first and ends as the last
  assert.ok(strip.includes("function shotPrevisStaged(sceneShots, plan){") && strip.includes("const m = F.writtenFor(saved, SP.shotCameraKey(sh), st.start||sh.startState, st.end||sh.endState||sh.startState); if(!m) return;"));
  assert.ok(strip.includes("out[sh.id] = { ...st, start:m.frames[0].state, end:m.frames[m.frames.length-1].state, plain:{ start:st.start, end:st.end }, written:m.frames.length }; });"));
  // every reader of the staging hands the plan in: the strip, a card's drawing, the frame made from it, the Stage's layout
  assert.equal((strip.match(/shotPrevisStaged\(sceneShots\|\|\[sh\], plan\)/g) || []).length, 4); assert.equal((strip.match(/shotPrevisStaged\(sceneShots\|\|shots, plan\)/g) || []).length, 2);
  assert.ok(!/shotPrevisStaged\(sceneShots\|\|(?:\[sh\]|shots)\)/.test(strip), "no reader is left on the plan's bare start");
  // what the frames were written for is the plan's own start and end: the board and the writing pass read those
  assert.ok(ui.includes("const st0 = (info.staged||{})[sh.id] || {}, st = st0.plain || st0;") && app.includes("window.shotPrevisStaged(mine) : {};"), "the writing pass starts from the plan's own states, never from frames written before");
  // the first frame keeps the plan's place, hands and things, so nothing a camera or a check reads has moved
  const got = F.written({ moments: [{ beat: 1, moment: 1, frames: [{ says: "a", into: 0, hold: 1, people: { ann: { face: 45, joints: HOLD, at: [3, 3], holding: [] } } }, { says: "b", into: 1, hold: 1 }] }] }, CTX).frames["1.1"];
  assert.equal(got.frames[0].state.people.ann.where, "m-door"); assert.equal(got.frames[0].state.people.ann.xy, undefined); assert.deepEqual(plain(got.frames[0].state.people.ann.holding), ["box"]); assert.deepEqual(plain(got.frames[0].state.things), plain(START.things));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

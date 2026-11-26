#!/usr/bin/env node
/* test-blockout-film.mjs — THE BLOCKOUT FILM (stage 4 of a beat broken down in code, owner 2026-11-26).
   The file written in the browser must be one the SERVER can measure (image-proxy/media-length.mjs): a reference video
   it cannot measure is charged at the longest length allowed. So the writer is tested against the server's own reader.

   node scripts/test-blockout-film.mjs */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mp4DurationFromBytes, mp4InfoFromBytes } from "../supabase/functions/image-proxy/media-length.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n    " + String(e && e.message).split("\n").slice(0, 6).join("\n    ")); } };
const box = { btoa: s => Buffer.from(s, "binary").toString("base64") }; box.globalThis = box; vm.createContext(box);
vm.runInContext(read("app/blockout-film.js"), box); vm.runInContext(read("app/beat-frames.js"), box);
const M = box.KinolotBlockoutFilm, F = box.KinolotBeatFrames, plain = v => JSON.parse(JSON.stringify(v)), near = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 0.011), a + " is about " + b);
const avcC = Uint8Array.from([1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xe0, 0x1f, 1, 0, 2, 0x68, 0xce]);
const pictures = n => Array.from({ length: n }, (_, i) => ({ data: Uint8Array.from([0, 0, 0, 3, i % 12 ? 0x41 : 0x65, i & 255, 7]), key: i % 12 === 0 }));

await test("1 the file is a plain MP4 the server's own reader measures: 53 pictures at 12 a second are 4.42 seconds", async () => {
  const bytes = M.mp4({ width: 640, height: 360, fps: 12, avcC, samples: pictures(53) });
  const type = (o) => String.fromCharCode(...bytes.slice(o + 4, o + 8)), size = o => (bytes[o] << 24 | bytes[o + 1] << 16 | bytes[o + 2] << 8 | bytes[o + 3]) >>> 0;
  assert.equal(type(0), "ftyp"); const moovAt = size(0); assert.equal(type(moovAt), "moov"); const mdatAt = moovAt + size(moovAt); assert.equal(type(mdatAt), "mdat"); assert.equal(mdatAt + size(mdatAt), bytes.length, "three boxes, nothing after them");
  near(await mp4DurationFromBytes(bytes), 53 / 12, 0.01);
  const info = await mp4InfoFromBytes(bytes); assert.ok(info && !info.reason, "read cleanly: " + JSON.stringify(info).slice(0, 200));
  assert.ok(!/moof|mvex|trun/.test(Buffer.from(bytes).toString("latin1")), "not cut into fragments");
  // the first sample is where the table says it is
  const text = Buffer.from(bytes).toString("latin1"), stco = text.indexOf("stco"), first = (bytes[stco + 12] << 24 | bytes[stco + 13] << 16 | bytes[stco + 14] << 8 | bytes[stco + 15]) >>> 0;
  assert.equal(first, mdatAt + 8); assert.deepEqual(Array.from(bytes.slice(first, first + 7)), [0, 0, 0, 3, 0x65, 0, 7]);
  assert.equal(M.dataUrl(Uint8Array.from([1, 2, 3])), "data:video/mp4;base64,AQID");
  assert.throws(() => M.mp4({ width: 640, height: 360, fps: 12, avcC, samples: [] }), /no pictures/);
});

await test("2 every picture between two frames: place, facing and pose move; hands, things and doors are the new frame's", () => {
  const A = { people: { ann: { where: "m-door", face: 350, joints: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], holding: ["box"] } }, things: { box: { heldBy: "ann" } }, doors: [{ id: "front", open: false }] };
  const B = { people: { ann: { where: "m-table", face: 30, joints: [0.2, 0, 0, 0, 1, 0, 0, 0, 0, 0], holding: [] } }, things: { box: { on: "table" } }, doors: [{ id: "front", open: true }] };
  const marks = { "m-door": [0, 0], "m-table": [2, 1] }, at = id => marks[id];
  const mid = F.between(A, B, 0.5, at);
  assert.deepEqual(plain(mid.people.ann.xy), [1, 0.5]); assert.equal(mid.people.ann.face, 10, "the short way round, through north"); assert.equal(mid.people.ann.joints[4], 0.5); assert.equal(mid.people.ann.joints[0], 0.1);
  assert.deepEqual(plain(mid.people.ann.holding), []); assert.deepEqual(plain(mid.things), { box: { on: "table" } }); assert.deepEqual(plain(mid.doors), [{ id: "front", open: true }]);
  assert.equal(F.between(A, B, 1, at).people.ann.xy, undefined, "arrived: she is on her mark"); assert.equal(F.between(A, B, 1, at).people.ann.where, "m-table");
  assert.equal(A.people.ann.face, 350, "the frames themselves are not touched");
});

await test("3 the film's pictures: a frame that rests is drawn once; the film lasts as long as the shot's frames", () => {
  const st = (x, j) => ({ people: { ann: { xy: [x, 0], face: 0, joints: [j, 0, 0, 0, 0, 0, 0, 0, 0, 0], holding: [] } }, things: {}, doors: [] });
  const frames = [{ into: 0, hold: 1, state: st(0, 0) }, { into: 1, hold: 0.5, state: st(1.2, 0.4) }, { into: 0.5, hold: 1, state: st(1.2, 0) }];
  const film = F.filmStates(frames, 12, null);
  assert.equal(film.seconds, 4); assert.equal(film.index.length, 48); assert.equal(film.fps, 12);
  assert.deepEqual(plain(film.index.slice(0, 12)), new Array(12).fill(0), "the first second rests on frame 1: one drawing");
  assert.equal(new Set(film.index.slice(12, 24)).size, 12, "the second of travel is twelve different pictures"); assert.equal(new Set(film.index.slice(24, 30)).size, 1);
  assert.equal(film.states.length, 1 + 12 + 1 + 6 + 1, "one for each rest and one for each picture of a move (the last picture of a move is not yet the rest)");
  const xs = film.index.slice(12, 24).map(i => film.states[i].people.ann.xy[0]); assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]) && xs[0] > 0 && xs[11] < 1.2, "she moves steadily on");
  assert.equal(film.states[film.index[47]], frames[2].state);
  assert.deepEqual(plain(F.filmStates([], 12)), { states: [], index: [], seconds: 0, fps: 12 });
});

await test("4 is it worth giving to the video engine: when someone walks, a thing changes place or a door moves", () => {
  const st = (x, held, open) => ({ people: { ann: { xy: [x, 0], holding: held ? ["box"] : [] } }, things: { box: held ? { heldBy: "ann" } : { on: "table" } }, doors: [{ id: "front", open: !!open }] });
  const f = (...states) => states.map((state, i) => ({ into: i ? 1 : 0, hold: 1, state }));
  assert.deepEqual(plain(F.travels(f(st(0, true), st(0, true)))), { send: false, why: "Nobody leaves their place and nothing changes hands: the starting frame and the words are enough.", walk: 0, moved: [] });
  assert.equal(F.travels(f(st(0, true), st(0.3, true))).send, false, "a shift of weight is not a walk");
  assert.equal(F.travels(f(st(0, true), st(1, true), st(2, true))).why, "In this shot someone walks 2 m.");
  assert.equal(F.travels(f(st(0, true), st(0, false))).why, "In this shot one thing changes place."); assert.equal(F.travels(f(st(0, true), st(0, true, true))).why, "In this shot a door opens or shuts.");
  assert.equal(F.travels([{ into: 0, hold: 1, state: st(0, true) }]).send, false);
});

await test("5 the page: the film is drawn in clay through the shot's own camera, played on the frame board and offered to the Stage", () => {
  const strip = read("app/shot-previs-ui.jsx"), ui = read("app/beat-frames-ui.jsx"), stage = read("app/stage.jsx"), html = read("TURN.html"), film = read("app/blockout-film.js");
  assert.ok(film.includes('codec:"avc1.42E01F"') && film.includes('avc:{format:"avc"}') && !/MediaRecorder|captureStream/.test(film.replace(/\/\*[\s\S]*?\*\//, "")), "the browser's own recorder makes fragmented files: it is not used");
  assert.ok(strip.includes("async function shotBlockoutFilm(sh, ctx, sceneShots, o){") && strip.includes('look:"clay"') && strip.includes("steps:film.states"));
  assert.ok(strip.includes("const send = F.travels(m.frames, markXY);") && strip.includes("window.KinolotBlockoutFilm.encode("));
  assert.ok(ui.includes('"data-testid":"beat-frame-board-film"') && ui.includes("window.shotBlockoutFilm("));
  // the Stage: one film a shot, a video reference on Seedance 2.5, on by default only when something travels; and what the engine is told it is
  assert.ok(stage.includes('out.push({ key:"previs-blockout:"+sh.id, kind:"video", group:"Layouts",') && stage.includes("...(B.send ? {} : { sceneOnly:true })") && stage.includes('assetSourceQuality:"previs_clay_blockout"'));
  assert.ok(stage.includes('if(k.indexOf("previs-blockout:")===0){') && stage.includes("never show the white set, the figures, the red shapes or the film itself"));
  assert.ok(html.indexOf("app/beat-frames.js?v=") < html.indexOf("app/blockout-film.js?v=") && html.indexOf("app/blockout-film.js?v=") < html.indexOf("app/shot-previs-ui.jsx?v="));
});

await test("6 the scene pager answers in the next picture (owner 2026-11-26: \"the next scene button ... is not very responsive\")", () => {
  const shots = read("app/shots-ui.jsx"), css = read("app/styles.css");
  // the press writes the new scene's number and name into the head and dims the beats, lets the browser show it, then changes the scene
  assert.ok(shots.includes('if(lab && lab.firstChild && lab.firstChild.nodeType===3) lab.firstChild.nodeValue = "Scene "+(to+1)+" of "+total;') && shots.includes('card.parentElement.classList.add("scene-switching");'));
  assert.ok(shots.includes('if(typeof requestAnimationFrame==="function") requestAnimationFrame(()=>setTimeout(run, 0)); else run();'), "the scene changes after the picture that shows the press");
  assert.ok(shots.includes("onClick:pagerGo(pager.idx-1, pager.onPrev),") && shots.includes("onClick:pagerGo(pager.idx+1, pager.onNext),") && shots.includes("pagerGo(i, ()=>pager.onJump(i))(e);"), "Previous, Next and the scene list");
  // the scene's head comes first; its beats (the heavy part) one picture later, also in a tab that is not in front
  assert.ok(shots.includes('const [bodyOn, setBodyOn] = React.useState(typeof requestAnimationFrame!=="function");') && shots.includes("const t = setTimeout(on, 150);") && shots.includes('"data-testid":"shot-scene-opening"'));
  assert.ok(shots.includes("open && bodyOn && (()=>{") && shots.includes('document.querySelectorAll(".scene-switching").forEach(x=>x.classList.remove("scene-switching"));'));
  assert.ok(css.includes(".scene-pager-arrow:active:not(:disabled){transform:scale(.92)}") && css.includes('.scene-switching [data-testid="beat-row"]'));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

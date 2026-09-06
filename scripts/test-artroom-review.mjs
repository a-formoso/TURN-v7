import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
const box = {
  window,
  React:{ createElement(){} },
  console,
  setTimeout,
  clearTimeout,
  Date,
  Map,
  Set,
};
box.globalThis = box;
vm.createContext(box);
vm.runInContext(readFileSync("app/lookbook.jsx","utf8"), box, {filename:"app/lookbook.jsx"});
vm.runInContext(readFileSync("app/storyboard.jsx","utf8"), box, {filename:"app/storyboard.jsx"});

const origin = window.artRoomPropOrigin;
assert.deepEqual({...origin("worn","character")}, {kind:"costume"});
assert.deepEqual({...origin("accessory","character")}, {kind:"costume"});
assert.deepEqual({...origin("carried","character")}, {kind:"props"});
assert.deepEqual({...origin("carried","design")}, {kind:"props"});
assert.deepEqual({...origin("carried","manual")}, {kind:"manual"});
assert.deepEqual({...origin("dressing","screenplay")}, {kind:"screenplay"});
assert.deepEqual({...origin("carried","legacy-unspecified")}, {kind:"unknown"});

const pointer = window.artRoomSourcePointer({
  sceneId:"scene-7", sceneNo:7, title:"The Crossing", beat:3, block:5,
  fullText:"A lantern falls."
});
assert.equal(pointer.sceneId,"scene-7");
assert.equal(pointer.sceneNo,7);
assert.equal(pointer.title,"The Crossing");
assert.equal(pointer.beat,3);
assert.equal(pointer.blockIndex,4,"Props source block is 1-based; ScriptView DOM index is zero-based");

const stale = window.lookbookStaleDepts(
  [{id:"lens",category:"Lens & format",source:"Wide",note:"anamorphic"}],
  "",
  {shots:"old",storyboard:""},
  {shots:true,storyboard:true}
);
assert.equal(stale.shots, true);
assert.equal(stale.storyboard, undefined, "lens changes do not stale storyboard routing");

const pages = [{pages:[
  {id:"a",shots:[{id:"1"},{id:"2"}]},
  {id:"b",shots:[{id:"3"},{id:"4"}]},
  {id:"c",shots:[{id:"5"}]},
]}];
const frames = {"sbsheet-a":"a.jpg","sbsheet-b":"b.jpg"};
const metas = {
  "sbsheet-a":{composed:true,missing:0},
  "sbsheet-b":{composed:true,missing:1},
};
assert.deepEqual(
  {...window.sbStoryboardReadiness(pages,frames,id=>metas[id])},
  {complete:1,partial:1,missing:1,total:3}
);
assert.deepEqual(
  {...window.sbStoryboardReadiness([{pages:[{id:"upload",shots:[]}]}],{"sbsheet-upload":"u.jpg"},()=>({}))},
  {complete:1,partial:0,missing:0,total:1},
  "an explicit uploaded board is complete rather than a composed placeholder sheet"
);

console.log("PASS Art Room origin, review routing, and storyboard readiness");
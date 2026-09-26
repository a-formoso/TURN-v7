/* Storage tidy (owner, 2026-09-26): new files land in readable folders below the two
   security folders (uploader id / project id, unchanged) — storyboard, lookbook and
   location plates get their own folders, appearance states nest inside their character,
   names lead with one shared timestamp, the extension is the real file type, cameo angles
   read as words. Old paths keep working (nothing parses below folder 2). */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const cloud=read("app/cloud.jsx");
const box={console,crypto:{randomUUID:()=>"abcd1234-0000-4000-8000-000000000000"}}; box.window=box; vm.createContext(box);
const a=cloud.indexOf("function turnSafeSeg("), b=cloud.indexOf("window.turnAssetFolder = turnAssetFolder;");
vm.runInContext(cloud.slice(a,b),box);
const U="8d3e4f10-0000-4000-8000-000000000001", P="5a7b1c22-0000-4000-8000-000000000002", S="20260926-101500";

await test("each kind of asset gets its own readable folder",()=>{
  const f=(kind,id)=>box.turnAssetFolder(kind,id);
  assert.equal(f("character","adem"),"character");
  assert.equal(f(undefined,"sbsheet-sbpage-gmrjwja0"),"storyboard","storyboards used to land in character/");
  assert.equal(f(undefined,"sbsheet-p1:half-top"),"storyboard");
  assert.equal(f("asset","look-k3j2"),"lookbook","lookbook frames used to land in asset/");
  assert.equal(f("asset","charscale-adem"),"character");
  assert.equal(f("asset","loc-harbor-0-cov1"),"location","location coverage used to land in asset/");
  assert.equal(f("locunit","locunit-harbor-7f3a"),"location","slugline units used to have their own locunit/");
  assert.equal(f("prop","prop-knife"),"prop"); assert.equal(f("shot","shot-s3-2"),"shot"); assert.equal(f("cameo","adem"),"cameo");
  assert.equal(f("asset","mystery-1"),"other"); assert.equal(f(undefined,"adem"),"character","a commit with no kind stays a character sheet");
});

await test("appearance states nest inside their character; names lead with one timestamp and the real extension",()=>{
  const p=box.turnStoragePath(U,P,"adem:st-mrnfi0nm-0","character","sheet","jpg",3,S);
  assert.equal(p,U+"/"+P+"/character/adem/states/st-mrnfi0nm-0/"+S+"-sheet-v3-abcd1234.jpg");
  assert.equal(box.turnStoragePath(U,P,"sbsheet-p1:half-top",undefined,"sheet","png",1,S),U+"/"+P+"/storyboard/sbsheet-p1/half-top/"+S+"-sheet-v1-abcd1234.png");
  assert.equal(box.turnStoragePath(U,P,"neo","character","ref-owner","webp",undefined,S),U+"/"+P+"/character/neo/"+S+"-ref-owner-abcd1234.webp");
  // the security folders are untouched: uploader id first, project id second, at least 4 folders
  const parts=p.split("/"); assert.equal(parts[0],U); assert.equal(parts[1],P); assert.ok(parts.length-1>=4);
  assert.ok(!p.includes(":"),"no colons in new keys");
  assert.equal(box.turnExtForMime("image/jpeg"),"jpg"); assert.equal(box.turnExtForMime("image/webp"),"webp"); assert.equal(box.turnExtForMime("image/png"),"png"); assert.equal(box.turnExtForMime(""),"png");
  assert.equal(box.turnReadableSeg("¾ Left","angle"),"three-quarter-left"); assert.equal(box.turnReadableSeg("Front","angle"),"front"); assert.equal(box.turnReadableSeg("","angle"),"angle");
});

await test("the uploader wires the real type, the shared timestamp and readable cameo angles",()=>{
  assert.ok(cloud.includes("turnStoragePath(uid, projectId, entityId, assetType, role, turnExtForMime(blob.type), version, stamp)"));
  assert.ok(cloud.includes('const saveStamp = turnStamp();')&&cloud.includes('"sheet", ver, false, uploadDiagnostics, saveStamp)')&&cloud.includes(',undefined,true,undefined,saveStamp)'));
  assert.ok(cloud.includes('"cameo", turnReadableSeg(a.label, "angle"))'));
  // nothing below folder 2 is parsed anywhere: the only path parsers read folders 1-2 or the extension
  assert.ok(/parts\[1\]/.test(read("app/imagegen.jsx")));
});

console.log(checks+" checks passed");

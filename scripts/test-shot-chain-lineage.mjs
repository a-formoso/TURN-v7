#!/usr/bin/env node
/* Focused regression for the derived seed-lineage state. No media, persistence,
   provider call, or generation is involved. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sandbox={console};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/scene-order.js","utf8"),sandbox,{filename:"app/scene-order.js"});

const status=sandbox.shotChainStatus;
assert.equal(typeof status,"function");

const fingerprint=sandbox.shotSpecFingerprint;
assert.equal(typeof fingerprint,"function");
const sourceBase={id:"source",sceneId:"scene",beatN:1,size:"Medium",action:"A fixed setup."};
assert.equal(fingerprint(sourceBase),fingerprint({...sourceBase,cameraSettings:{}}),
  "missing and empty Advanced cinematography settings have identical provenance");
assert.equal(fingerprint(sourceBase),fingerprint({...sourceBase,cameraSettings:{camera:"auto",lensType:"auto",focalLength:"auto",aperture:"auto",shutter:"auto",iso:"auto"}}),
  "explicit all-Auto storage does not freeze inferred camera guidance into provenance");
assert.notEqual(fingerprint(sourceBase),fingerprint({...sourceBase,cameraSettings:{focalLength:"85"}}),
  "an explicit Advanced cinematography override changes shot-source provenance");
assert.equal(fingerprint({...sourceBase,cameraSettings:{focalLength:"85",iso:"auto"}}),fingerprint({...sourceBase,cameraSettings:{focalLength:"85"}}),
  "Auto keys are normalized out beside explicit overrides");

const seed={id:"seed",sceneId:"scene"};
const target={id:"target",sceneId:"scene"};
const other={id:"other",sceneId:"scene"};
const meta=new Map();
const getMeta=id=>meta.get(id)||null;
sandbox.seedShotOf=()=>seed;

assert.equal(status(target,[seed,target],getMeta),"","missing target metadata is not a false alarm");
meta.set("target",{});
assert.equal(status(target,[seed,target],getMeta),"unverified","legacy lineage stays unverified");
meta.set("target",{seedSource:{fresh:true}});
assert.equal(status(target,[seed,target],getMeta),"current","an intentional Fresh render has no upstream dependency");

meta.set("seed",{version:3,iso:"2026-09-19T12:00:00.000Z"});
meta.set("target",{seedSource:{seedShotId:"seed",seedVersion:3,seedIso:"2026-09-19T12:00:00.000Z"}});
assert.equal(status(target,[seed,target],getMeta),"current","matching seed id, version and timestamp are current");

meta.set("seed",{version:4,iso:"2026-09-19T12:05:00.000Z"});
assert.equal(status(target,[seed,target],getMeta),"stale","a regenerated seed makes its direct dependent stale");

meta.set("seed",{version:3,iso:"2026-09-19T12:00:00.000Z"});
sandbox.seedShotOf=()=>other;
assert.equal(status(target,[seed,other,target],getMeta),"stale","a reordered or replaced predecessor is stale");

sandbox.seedShotOf=()=>null;
assert.equal(status(target,[target],getMeta),"stale","a removed predecessor or new Fresh boundary is stale");

sandbox.seedShotOf=()=>seed;
meta.delete("seed");
assert.equal(status(target,[seed,target],getMeta),"unverified","a cold seed cache never becomes a false stale warning");

meta.set("seed",{version:3,iso:"2026-09-19T12:00:00.000Z"});
meta.set("target",{seedSource:{seedShotId:"seed"}});
assert.equal(status(target,[seed,target],getMeta),"unverified","lineage without a saved version or timestamp stays unverified");

console.log("PASS seed-lineage derivation: current, stale, Fresh, removed and cold-cache cases");

#!/usr/bin/env node
/* Focused regression for semantic beat-primary continuity.
   This loads the real Shots data layer in an isolated VM: no React surface,
   persistence boundary, provider, network request, or image generation runs. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sandbox={console};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/shots.jsx","utf8"),sandbox,{filename:"app/shots.jsx"});

const primary=sandbox.shotPrimaryOf;
const beatPrimary=sandbox.shotBeatPrimaryOf;
const seed=sandbox.seedShotOf;
const plan=sandbox.shotRenderPlan;
const dependencyOrder=sandbox.sceneShotsDependencyOrdered;
assert.equal(typeof primary,"function");
assert.equal(typeof beatPrimary,"function");
assert.equal(typeof seed,"function");
assert.equal(typeof plan,"function");
assert.equal(typeof dependencyOrder,"function");

const shot=(id,beatN,order,extra={})=>({id,sceneId:"scene",beatN,order,...extra});
const p1=shot("beat-1-primary",1,0,{keyframeMode:"beat-opening",locked:true});
const legacy2=shot("beat-2-legacy",2,1,{action:"old tail",locked:false});
const p2=shot("beat-2-primary","2",2,{keyframeMode:"beat-opening",locked:true});
const alt2=shot("beat-2-alternative",2,3,{action:"coverage alternative"});
const p3=shot("beat-3-primary",3,4,{keyframeMode:"beat-opening"});
const stored=[p1,legacy2,p2,alt2,p3];

assert.equal(primary([legacy2,p2]),p2,
  "primary resolver follows the UI rule even when an explicit opening follows legacy rows");
assert.equal(beatPrimary(stored,2),p2,
  "numeric beat lookup resolves a string-valued explicit primary");
assert.equal(beatPrimary(stored,"2"),p2,
  "string beat lookup resolves a numeric-valued explicit primary");
assert.equal(seed(alt2,stored),p2,
  "same-beat alternatives seed their own semantic primary");
assert.equal(seed(p2,stored),p1,
  "a beat primary seeds from the previous beat primary, not its raw predecessor");
assert.equal(seed(p3,stored),p2,
  "the next beat ignores an ungenerated legacy tail after the locked prior primary");

const ordered=dependencyOrder(stored);
assert.deepEqual(Array.from(ordered,s=>s.id),
  ["beat-1-primary","beat-2-primary","beat-2-legacy","beat-2-alternative","beat-3-primary"],
  "dependency-first order moves an explicit primary ahead of its legacy alternatives");
assert.deepEqual(stored.map(s=>s.id),
  ["beat-1-primary","beat-2-legacy","beat-2-primary","beat-2-alternative","beat-3-primary"],
  "dependency ordering never rewrites the saved array");

const renderPlan=plan(p3,stored,{scene:{id:"scene"},charById:{},propById:{},project:{}});
assert.equal(renderPlan.prevSh,p2,
  "the real shared render plan consumes semantic seed resolution");
assert.equal(renderPlan.isHead,false);

const freshPrior=shot("fresh-prior","2",2,{keyframeMode:"beat-opening",anchor:true,locked:true});
const afterFresh=shot("after-fresh",3,3,{keyframeMode:"beat-opening"});
assert.equal(seed(afterFresh,[p1,freshPrior,afterFresh]),freshPrior,
  "a prior primary's fresh-start flag severs only its own seed, not the next beat's seed");

const firstLegacy=shot("first-legacy",1,0,{action:"legacy first"});
const firstPrimary=shot("first-primary",1,1,{keyframeMode:"beat-opening"});
const firstAlternative=shot("first-alternative",1,2);
assert.equal(primary([firstLegacy,firstPrimary]),firstPrimary);
assert.equal(seed(firstPrimary,[firstLegacy,firstPrimary]),null,
  "the first beat's explicit primary remains a head even when stored after legacy rows");
assert.equal(seed(firstLegacy,[firstLegacy,firstPrimary]),firstPrimary,
  "an alternative before a later explicit primary still uses that beat primary");
assert.equal(seed(firstAlternative,[firstLegacy,firstPrimary,firstAlternative]),firstPrimary);

const manual=shot("manual",null,0,{manual:true});
const firstNumbered=shot("numbered-first",1,1,{keyframeMode:"beat-opening"});
const manualLater=shot("manual-later","",2,{manual:true});
const manualShots=[manual,firstNumbered,manualLater];
assert.equal(seed(manual,null),null,"an unnumbered first/manual shot is a safe head");
assert.equal(seed(firstNumbered,manualShots),null,
  "a first numbered beat does not inherit an unrelated unnumbered/manual row");
assert.equal(seed(manualLater,manualShots),firstNumbered,
  "an unnumbered/manual shot keeps the immediate-predecessor fallback");
assert.equal(seed({...manualLater,anchor:true},manualShots),null,
  "an explicit anchor always severs its own seed");

assert.equal(sandbox.shotBeatLabel(p3),"Beat 3");
assert.equal(sandbox.shotBeatRoleLabel(p2,[legacy2,p2,alt2]),"Opening");
assert.equal(sandbox.shotBeatRoleLabel(alt2,[legacy2,p2,alt2]),"Alternative 2");
assert.equal(sandbox.shotBeatDisplayLabel(alt2,[legacy2,p2,alt2]),"Beat 2 · Alternative 2");

const chain=[legacy2,p2,alt2,p3];
let cur=p3,seen=new Set();
while(cur){
  assert.equal(seen.has(cur.id),false,"seed resolution never cycles");
  seen.add(cur.id);
  cur=seed(cur,chain);
}

const before=JSON.stringify(stored);
primary(stored);beatPrimary(stored,"2");seed(p3,stored);
dependencyOrder(stored);plan(p3,stored,{scene:{id:"scene"},charById:{},propById:{},project:{}});
assert.equal(JSON.stringify(stored),before,"all shared continuity helpers leave input shots immutable");

// the Shots tab's chain runner renders a scene dependency-first (the Scene Director, which also
// did, was removed 2026-09-26 — the runner replaced it on 2026-06-19)
const ui=readFileSync("app/shots-ui.jsx","utf8");
assert.ok(/sceneShotsDependencyOrdered/.test(ui.slice(ui.indexOf("const chainOrderIds"),ui.indexOf("const chainOrderIds")+600)),
  "Render Scene X in order walks the scene in dependency-first order");

console.log("PASS beat-primary continuity: semantic helpers, render plan, labels, dependency order, the chain runner, fallbacks and immutability");
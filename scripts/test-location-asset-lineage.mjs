#!/usr/bin/env node
/* Functional location dependency-lineage tests against the minified build. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""}
};
box.window=box;box.globalThis=box;
vm.createContext(box);
vm.runInContext(readFileSync("dist/app/locations.js","utf8"),box,{filename:"dist/app/locations.js"});
const snapshot=box.locationAssetDependencySnapshot;
const changes=box.locationAssetDependencyChanges;
let pass=0,fail=0;
const ok=(name,value,detail)=>{if(value)pass++;else{fail++;console.log("FAIL "+name+(detail?" — "+detail:""));}};
ok("snapshot helper exported",typeof snapshot==="function");
ok("change helper exported",typeof changes==="function");

const metas={
  master:{iso:"base-v1"},
  earlier:{iso:"coverage-v1"}
};
const get=id=>metas[id]||null;
const child=snapshot("master",["earlier"],"screenplay-coverage",get);
ok("snapshot records parent version",child.locationParentIso==="base-v1",JSON.stringify(child));
ok("snapshot records earlier coverage version",child.locationUpstream?.[0]?.iso==="coverage-v1",JSON.stringify(child));
ok("unchanged dependencies are fresh",changes(child,"master",["earlier"],get).length===0);

metas.master={iso:"base-v2"};
ok("new master stales derived asset",changes(child,"master",["earlier"],get).some(x=>x.kind==="parent"));
metas.master={iso:"base-v1"}; metas.earlier={iso:"coverage-v2"};
ok("new earlier sheet stales later coverage",changes(child,"master",["earlier"],get).some(x=>x.kind==="upstream"));
ok("legacy child stales once parent has tracked version",changes({},"master",[],get).some(x=>x.kind==="parent"));
ok("missing current metadata makes no unsupported stale claim",changes({},"untracked",[],get).length===0);

const ui=readFileSync("app/locations-ui.jsx","utf8");
ok("all three derived generators store lineage",
  ["screenplay-coverage","time-of-day-variant","slugline-unit"].every(k=>ui.includes(`locationAssetDependencySnapshot(l.id,${k==="screenplay-coverage"?"previousIds":"[]"},\"${k}\")`)));
ok("derived warning names regeneration action",ui.includes("Regenerate this \"+noun+\" to update it."));
const app=readFileSync("app/app.jsx","utf8");
ok("legacy fold migration refuses ambiguous unit targets",
  app.includes("const matchingUnits = units.filter")&&app.includes("if(matchingUnits.length!==1) continue;"));
ok("legacy fold migration no longer picks first matching unit",
  !app.includes("const u = units.find(x=> placeKeyOf(x.place)===l.key);"));
ok("legacy fold migration rederives unit cardinality after source awaits",
  app.includes("deriveSluglineUnits(scenesRef.current, draftsRef.current)")&&app.includes("liveMatches.length!==1"));
ok("legacy fold migration rechecks target after claiming its run lock",
  app.includes("const migrationRun=")&&app.includes("const existingNow=")&&app.includes("commitMatches.length!==1"));
ok("legacy fold migration releases only its own target lock",
  app.includes("window.__nbGenInflight[unitImgId]===migrationRun")&&app.includes("delete window.__nbGenInflight[unitImgId]"));
ok("legacy fold migration captures project epoch before source awaits",
  app.includes("const foldEpoch=(typeof nbEpoch===")&&app.indexOf("const foldEpoch=")<app.indexOf("await nbRemoteImageUrl"));
ok("legacy fold commit carries epoch and live cancellation predicate",
  app.includes('"locunit",foldEpoch,migrationLive)')&&app.includes("if(!migrationLive()) r=null;"));
ok("legacy fold live predicate checks target ownership and project scope",
  app.includes("window.__nbGenInflight[unitImgId]===migrationRun")&&app.includes("nbEpoch()===foldEpoch"));
ok("legacy fold clears a prior sticky cancellation only after claiming ownership",
  app.indexOf("window.__nbGenInflight[unitImgId]=migrationRun")<app.indexOf("window.__nbGenCancel[unitImgId]=false"));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
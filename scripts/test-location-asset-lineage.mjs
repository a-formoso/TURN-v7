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
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
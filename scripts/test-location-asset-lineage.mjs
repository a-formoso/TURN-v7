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
const canonicalSpec=box.locationCanonicalSpecPrompt;
const specStale=box.locationSpecPromptStale;
let pass=0,fail=0;
const ok=(name,value,detail)=>{if(value)pass++;else{fail++;console.log("FAIL "+name+(detail?" — "+detail:""));}};
ok("snapshot helper exported",typeof snapshot==="function");
ok("change helper exported",typeof changes==="function");
ok("location spec helpers exported",typeof canonicalSpec==="function"&&typeof specStale==="function");

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

const spec="MASTER LOCATION SPEC";
const sent=spec+" REFERENCE IMAGES are attached: Image 1 = screenplay page.";
ok("fresh referenced generation stores clean canonical spec",canonicalSpec("final",sent,spec,null)===spec);
ok("runtime reference instructions do not stale fresh legacy plate",specStale({prompt:sent},spec)===false);
ok("canonical spec metadata is fresh",specStale({prompt:sent,specPrompt:spec},spec)===false);
ok("genuine location spec change is stale",specStale({specPrompt:spec},spec+" changed")===true);
ok("photo/simple generation uses visible written spec",canonicalSpec("photo","photo request",spec,null)===spec
  && canonicalSpec("simple","simple request",spec,null)===spec);
ok("image-only edit preserves prior spec identity",canonicalSpec("edit","edit request",spec+" changed",{specPrompt:spec})===spec);

const ui=readFileSync("app/locations-ui.jsx","utf8");
ok("all three derived generator kinds store lineage",
  ui.includes('locationAssetDependencySnapshot(l.id,previousIds,"screenplay-coverage")')&&
  ui.includes('stateUnit?"slugline-unit":"continuity-state"')&&
  ui.includes('locationAssetDependencySnapshot(l.id,[],"slugline-unit")'));
ok("derived image cards omit stale warning strips",
  !ui.includes("LocationDerivedStaleBanner")&&!ui.includes("loc-derived-stale"));
const app=readFileSync("app/app.jsx","utf8");
ok("active hierarchy sync no longer invokes destructive fold migration",
  !/React\.useEffect\(\(\)=>\{[\s\S]{0,240}foldStaleLocations\(locations\)/.test(app));
ok("previously folded child cards restore from recoverable trash",
  app.includes("const restore=(trash.locations||[]).filter")&&app.includes("restore.forEach(item=>"));
ok("missing child workspaces derive without moving assets",
  app.includes("const missing=fresh.filter")
  &&app.includes("missing.forEach(item=>next.push(withEpisodeLocationMeta(item,item)))"));
ok("hierarchy sync preserves authored fields while refreshing relationship metadata",
  app.includes("const synced=withEpisodeLocationMeta(l,f)")
  &&app.includes("const restored={...clean,...f,...clean}")
  &&app.includes("next.push(withEpisodeLocationMeta(restored,f))"));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

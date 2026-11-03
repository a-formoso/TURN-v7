// AN APPROVED FRAME STILL DOWNLOADING IS NOT "TO RENDER" (2026-11-03, mobile step 3 on a slow machine): Shots counted a
// frame only once its image had downloaded, so Final Ramp read "9 approved · 5 to render" and "Render Scene 01 in order"
// priced 9 frames — pressing it would have re-made approved frames and charged for them. The film's full image check
// now records what it found; an approved frame is missing only when that check says so.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0;
const check=(ok,msg)=>{ checks++; if(!ok){ console.error("FAIL: "+msg); process.exit(1); } };

const img=read("app/imagegen.jsx"), ui=read("app/shots-ui.jsx");
const start=img.indexOf("function nbImageKnownMissing(id){");
check(start>=0,"imagegen.jsx defines nbImageKnownMissing");
const fn=img.slice(start,img.indexOf("\nwindow.nbImageKnownMissing",start));
const run=(state)=>{ const box={...state}; vm.createContext(box);
  vm.runInContext(fn+"\nthis.f=nbImageKnownMissing;",box); return box.f; };
const cached=new Set(["have"]);
const base={_nbBackend:"cloud",_nbProject:"film",nbGetImage:id=>cached.has(id)?"blob:x":""};
check(run({...base,_prefetchKnownProj:null,_prefetchKnownIds:null})("approved")===false,"Before the film's check finishes, nothing is known to be missing");
check(run({...base,_prefetchKnownProj:"film",_prefetchKnownIds:new Set(["approved"])})("approved")===false,"An image the check found is not missing, even before it downloads");
check(run({...base,_prefetchKnownProj:"film",_prefetchKnownIds:new Set(["other"])})("gone")===true,"An image the check didn't find is missing");
check(run({...base,_prefetchKnownProj:"other-film",_prefetchKnownIds:new Set([])})("x")===false,"Another film's check says nothing about this one");
check(run({...base,_prefetchKnownProj:"film",_prefetchKnownIds:new Set([])})("have")===false,"An image on this device is never missing");

check(/_prefetchKnownProj = proj; _prefetchKnownIds = new Set\(Object\.keys\(map\)\);/.test(img),"A complete check records the film's images");
check((img.match(/if\(_prefetchKnownIds\) _prefetchKnownIds\.delete\(String\(id\)\);/g)||[]).length===2,"Clearing or purging an image forgets it");
check(/const shotIsDone = \(s\)=>\{ if\(!\(s && s\.locked && \(shotHasFrame\(s\.id\)\s*\|\| \(typeof window\.nbImageKnownMissing==="function" && !window\.nbImageKnownMissing\(s\.id\)\)\)\)\) return false;/.test(ui),
  "An approved frame still downloading counts as done, so no render run includes it");
check(/if\(!u\)\{ if\(s\.locked && typeof window\.nbImageKnownMissing==="function" && !window\.nbImageKnownMissing\(s\.id\)\)\{ loading\+\+; approved\+\+; \} return; \}/.test(ui)
  && /loading>0 && loading\+" loading"/.test(ui),"The scene's slate says 'loading' for those frames and counts them approved");
console.log(`PASS approved frame loading: ${checks} checks`);

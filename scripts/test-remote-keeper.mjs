// KNOWN ONLY BY A DISTANT THING OF THEIRS (2026-11-03, test film "Slack Water"): "Across the strait, the light kept by
// KESTER LUMSDEN (early 60s) stays a dead grey smear" put Kester in Ines's lantern room in 16 of 20 shot frames — two
// people who have never met, side by side. The keeper or owner of something set far away is not a body in frame.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,turnContinuity:{}};
box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-order.js","app/shot-screenplay.js"]) vm.runInContext(read(f),box,{filename:f});
let checks=0; const check=(v,m)=>{ assert.ok(v,m); checks++; };
const scene={id:"s1",no:1,title:"The Heavy Dash",loc:"INT. LIGHT TOWER LANTERN ROOM - NIGHT"};
const A=(beat,text)=>({beat,type:"action",text});
const blocks=[{beat:1,type:"scene",text:"INT. LIGHT TOWER LANTERN ROOM - NIGHT"},
  A(1,"Black glass. Grey fog pressed against it like wet wool."),
  A(1,"INES MARR (late 50s), a keeper who has never once been late to her own light, hauls the clockwork weights up the tower hand over hand. Chain RATTLES."),
  A(1,"At the signal lamp she works the shutter. CLACK-CLACK. Her call sign spills into the fog."),
  A(1,"Across the strait, the light kept by KESTER LUMSDEN (early 60s) stays a dead grey smear."),
  A(2,"Ines turns her back on the window. Opens the logbook."),
  A(3,"A pinprick of light swells. Across the water, Kester's light holds on her tower."),
  A(4,"KESTER rows across the strait toward her."),
  A(5,"On the far shore, the cottage kept by KESTER glows."),
  A(5,"KESTER climbs the stair into the lantern room.")];
const characters=[{id:"ines",name:"Ines Marr"},{id:"kester",name:"Kester Lumsden"}];
const opts={drafts:{s1:{version:1,blocks}},characters,beatsMap:{}};
box.turnContinuity={drafts:opts.drafts,characters,scenes:[scene],beatsMap:{}};
const b1=box.shotBeatScreenplay(scene,1,opts);
check(b1.physicalCharacterIds.indexOf("kester")<0 && b1.remoteCharacterIds.indexOf("kester")>=0,"Beat 1: Kester, known only by his light across the strait, is not in the room");
check(b1.physicalCharacterIds.indexOf("ines")>=0,"Beat 1: Ines is in the room");
const ms=box.shotBeatMoments(scene,1,opts);
check(ms.every(m=>m.openingCharacterIds.indexOf("kester")<0),"No moment of beat 1 puts Kester in frame ("+JSON.stringify(ms.map(m=>m.openingCharacterIds))+")");
const b3=box.shotBeatScreenplay(scene,3,opts);
check(b3.physicalCharacterIds.indexOf("kester")<0,"\"Kester's light\" across the water is his light, not him");
const b4=box.shotBeatScreenplay(scene,4,opts);
check(b4.physicalCharacterIds.indexOf("kester")>=0,"\"KESTER rows across the strait\" — he is there, doing it");
const b5=box.shotBeatScreenplay(scene,5,opts);
check(b5.physicalCharacterIds.indexOf("kester")>=0,"A distant cottage of his doesn't hide Kester climbing into the room in the same beat");
console.log(`PASS remote keeper: ${checks} checks`);

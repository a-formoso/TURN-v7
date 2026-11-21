// A STATION CAMERA STAYS IN ITS ROOM (2026-11-03, test film "Slack Water"): the lantern room's suggested key-station
// camera stood 1.8 m back from the central burner — exactly on the octagonal room's north wall, so step Cameras
// said "It stands outside Light Tower Lantern Room". The back-off now stops 0.3 m inside the walls.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0;
const check=(ok,msg)=>{ checks++; if(!ok){ console.error("FAIL: "+msg); process.exit(1); } };
const src=read("app/locations.jsx");
const cut=(from,to)=>{ const i=src.indexOf(from); check(i>=0,"locations.jsx has "+from); return src.slice(i, src.indexOf(to,i)); };
const box={}; vm.createContext(box);
// locYaw as locations.jsx has it, without its number guard
vm.runInContext(["function locYaw(v){ const n=Number(v); return Number.isFinite(n) ? Math.round((((n%360)+360)%360)*10)/10%360 : null; }", "const LOC_COMPASS = "+src.match(/const LOC_COMPASS = (\[[^\]]*\])/)[1]+";",
  cut("function _locDir(yaw)","\nfunction _locCentroid"), cut("function _locInside(pt, poly)","\n/* A STATION CAMERA"),
  cut("const LOC_STATION_BACK","\n/* the outward facing (yaw) of a footprint edge")].join("\n")
  +"\nthis.back=_locStationBackOff; this.inside=_locInside; this.wall=_locWallDistance; this.dir=_locDir; this.place=_locStationPlace; this.compass=_locCompassYawInText;",box);
const octagon=[[-0.8,1.8],[0.8,1.8],[1.8,0.8],[1.8,-0.8],[0.8,-1.8],[-0.8,-1.8],[-1.8,-0.8],[-1.8,0.8]];
const geo={poly:octagon,floorZ:0};
// the burner at the centre, the camera facing south at it (it stands to the north)
const p=box.back([0,0], box.dir(180), geo);
check(box.inside(p,octagon),"The station camera stands inside the lantern room ("+p+")");
check(box.wall(p,octagon)>=0.3-1e-9,"…and at least 30 cm from its walls");
check(Math.hypot(p[0],p[1])>=0.6-1e-9,"…and still at least 60 cm from the burner");
// a big room keeps the full 1.8 m
const hall=[[-6,-6],[6,-6],[6,6],[-6,6]];
const q=box.back([0,0], box.dir(180), {poly:hall});
check(Math.abs(q[1]-1.8)<1e-6 && Math.abs(q[0])<1e-6,"A big room keeps the 1.8 m back-off");
// no outline: as before
const r=box.back([1,1], box.dir(90), {});
check(Math.abs(r[0]-(1-1.8))<1e-9 && Math.abs(r[1]-1)<1e-9,"With no room outline the camera stands 1.8 m back, as before");
// a pane set INTO the north wall, facing out to sea (yaw 0): "in front of it" is over the water — the camera stands on
// the room's side and looks north at it
const pane=box.place([-0.4,1.8], 180, geo);
check(box.inside(pane.xy,octagon) && box.wall(pane.xy,octagon)>=0.3-1e-9 && pane.yaw===0,"A wall-set pane is filmed from inside the room, looking at it ("+JSON.stringify(pane)+")");
// an object out in the room keeps its own direction
const own=box.place([0,0], 180, geo);
check(own.yaw===180,"An object out in the room keeps the direction it is filmed from");
check(box.compass("North-west to west run of the masonry")===315 && box.compass("the burner")===null,"A station's compass words give its direction");
check(/const at = _locStationPlace\(a\.xy, yaw, geo\);/.test(src) && /const at = _locStationPlace\(anchor\.xy, look, geo\);/.test(src)
  && /const at = _locStationPlace\(geo\.centre, toward, geo\);/.test(src),
  "Every station-camera suggestion stands inside the room (anchor, staged words, words with no object)");
console.log(`PASS station camera inside: ${checks} checks`);

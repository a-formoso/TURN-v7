#!/usr/bin/env node
/* WHAT THE PLATES SEE (owner-approved 2026-10-28, "go ahead with A–D"):
   A  the coverage of a space's panels: the directions seen, the sides and the floor plan's objects no panel sees;
   B  a room that isn't on the floor plan says so;
   C  the Reverse views sheet: the main sheet's cameras turned round, its prompt, its card;
   D  a shot's direction (written, toward an object, the reverse of the shot before) → the panel facing that way, cut
      out; the shot card says when none does.
   Run: node scripts/test-location-view-coverage.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop, CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""},
  React:{createElement:()=>null,useState:(v)=>[v,noop],useEffect:noop,useRef:(v)=>({current:v}),useMemo:(f)=>f(),useCallback:(f)=>f,useReducer:()=>[0,noop],createContext:()=>({})} };
box.window=box; box.globalThis=box; box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box,{filename:"app/locations.jsx"});
const loc=readFileSync("app/locations.jsx","utf8"), ui=readFileSync("app/locations-ui.jsx","utf8"), shots=readFileSync("app/shots.jsx","utf8"),
  shotsUi=readFileSync("app/shots-ui.jsx","utf8"), stage=readFileSync("app/stage.jsx","utf8"), ai=readFileSync("app/ai.jsx","utf8"), img=readFileSync("app/imagegen.jsx","utf8");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };

// a ship's car deck: the layout's frame makes forward north; the ramp is aft (south)
const plan={status:"reviewed", frame:"Ship frame: facing forward toward the bow. That forward direction is 'north'.",
  anchors:[{id:"ramp",space:"CAR Deck",name:"Hinged steel stern ramp",placement:"aft end",xy:[0,0]},
           {id:"hose",space:"CAR Deck",name:"Fire-hose reel cabinet",placement:"starboard bulkhead",xy:[7,8]},
           {id:"bulk",space:"CAR Deck",name:"Forward bulkhead",placement:"forward end",xy:[0,40]}],
  coordinates:{spaces:[{id:"car",name:"CAR Deck",footprint:[[-7,0],[7,0],[7,40],[-7,40]]}]}};
const ship={id:"ship",key:"ship",name:"Ship",intExt:"INT",spatialPlan:plan};
const car={id:"car",key:"car",name:"CAR Deck",intExt:"INT",parentKey:"ship"};
box.turnContinuity={locations:[ship,car],scenes:[],drafts:{},shots:[],sluglineUnits:[]};
box._locOwnerPlan=()=>({owner:ship,plan});
box.locationSpatialOwner=()=>ship;
// the main sheet's four cameras: three look forward, one looks aft (as Marmorica's did)
const poses={TL:{yaw:20,lensMm:24},TR:{yaw:10,lensMm:16},BL:{yaw:0,lensMm:35},BR:{yaw:180,lensMm:35}};
box.locationPanelPoses=(l)=>Object.keys(poses).map(k=>({key:k,pose:{...poses[k],position:[0,20,1.6]},stated:true,purpose:"view "+k}));
let metas={}; box.nbGetMeta=(id)=>metas[id]||null;

// A
let cov=box.locationViewCoverage(car,[ship,car]);
ok("A the coverage: known facings, about how much of the horizon, on the floor plan", cov.known && cov.onFloorPlan && cov.coveredDeg>100 && cov.coveredDeg<260, JSON.stringify({deg:cov.coveredDeg}));
ok("A the sides no panel sees (east and west: three panels look forward, one aft)", JSON.stringify(cov.unseenSides)==='["east","west"]', JSON.stringify(cov.unseenSides));
ok("A the floor plan's objects no panel shows (the starboard hose cabinet)", JSON.stringify(cov.unseenObjects)==='["Fire-hose reel cabinet"]', JSON.stringify(cov.unseenObjects));
// B
const galley={id:"galley",key:"galley",name:"Galley",intExt:"INT",parentKey:"ship"};
const covG=(()=>{ const was=box.locationPanelPoses; box.locationPanelPoses=()=>["TL","TR","BL","BR"].map(k=>({key:k,pose:{yaw:null,lensMm:24}})); const c=box.locationViewCoverage(galley,[ship,car,galley]); box.locationPanelPoses=was; return c; })();
ok("B a room not on the floor plan: no facings, says so", !covG.known && !covG.onFloorPlan && covG.ownerName==="Ship");
ok("B the card points to the owner's floor plan", ui.includes("isn't on the floor plan yet, so its panels have no facing") && ui.includes('"Open "+owner+"\'s floor plan"'));
// C
const rev=box.locationReversePanelPoses(car,[ship,car]);
ok("C the Reverse views: each main camera turned round", rev.map(p=>p.pose.yaw).join(",")==="200,190,180,0" && /the reverse of the main sheet's top-left view/.test(rev[0].purpose));
ok("C with the Reverse views made, the two sheets see more (no side unseen)", (()=>{ metas[box.locationReverseId(car)]={iso:"r1"}; const c=box.locationViewCoverage(car,[ship,car]); delete metas["car-rev"]; return c.hasReverse && c.coveredDeg>cov.coveredDeg && c.panels.some(p=>p.sheet==="reverse"); })());
ok("C its prompt: the main sheet's views turned round, no main-view grid", loc.includes("views: opts.reverse ? locationReverseViews(l, _C0.locations)") && loc.includes("fixtures: (fixtures.length && !opts.reverse) ? fixtures : undefined,")
  && /the REVERSE ANGLES of/.test(loc));
ok("C its card: made from the main sheet, optional, stored as a location", ui.includes('"Reverse views · the other way round"') && ui.includes("combinedLocationPrompt(l, project, { reverse:true })")
  && ui.includes('generateDisabledLabel:"Generate the main sheet first"') && img.includes('s.indexOf("locrev-")===0) return "location"'));
// D
const sh1={id:"s1",sceneId:"a",order:0,composition:"quiet frontal framing from inside the hold looking out at the ramp mouth."};
let f=box.locationShotFacing(car,sh1);
ok("D 'looking out at the ramp' → toward the ramp from the room's middle: south", f && Math.round(f.yaw)===180 && f.from==="object" && f.object==="Hinged steel stern ramp", JSON.stringify(f));
ok("D a ship's 'facing forward' → north; plain compass words too", box.locationShotFacing(car,{composition:"wide, facing forward down the lanes"}).yaw===0
  && box.locationShotFacing(car,{composition:"camera looking east across the deck"}).yaw===90);
ok("D 'reverse' of the shot before → turned round", box.locationShotFacing(car,{composition:"the reverse angle on Ottavio"},{prevShot:sh1}).yaw===0);
ok("D nothing said → no facing", box.locationShotFacing(car,{composition:"close on her hands"})===null);
const pSouth=box.locationPanelForFacing(car,180,[ship,car]), pEast=box.locationPanelForFacing(car,90,[ship,car]);
ok("D the panel facing south is the main sheet's bottom-right; none faces east", pSouth && pSouth.key==="BR" && pSouth.sheet==="main" && pEast===null);
ok("D the shot gets that panel cut out on its own, and the card says when none faces its way",
  shots.includes("const facing=shotLocationFacing(loc,sh);") && shots.includes("facingPanel:true, panelOf:panel.assetId, panelKey:panel.key,")
  && shots.includes("const fresh=await locationEnsurePanelCut(spec.panelOf, spec.panelKey);") && shotsUi.includes('"data-testid":"shot-facing-unseen"')
  && box.locationPanelCutId("car","BR")==="pc-car-br");
ok("D the Stage cuts it on first use, and reads a Blender camera only when its set shares the layout's north",
  stage.includes("u = await locationEnsurePanelCut(m[1], m[2].toUpperCase());") && stage.includes("return aligned ? ((Math.atan2(fx,fy)*180/Math.PI)+360)%360 : null;"));
ok("Frances knows", /What a location's plates see, Reverse views and the panel facing a shot/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

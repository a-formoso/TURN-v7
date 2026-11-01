/* A new floor-plan draft keeps what was set (owner 2026-11-01): saved cameras with a position, saved rooms the draft
   leaves out, and rooms whose shape was set by hand. Re-drafting The Last Crossing's Marmorica had dropped 12 cameras
   and the Passenger Lounge. No model call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,location:{hostname:"localhost"},nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};box.window=box;
vm.createContext(box);vm.runInContext(read("app/locations.jsx"),box);
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};

const room=(id,name,basis="design")=>({id,name,basis,floorZ:4.4,ceilingH:2.3,footprint:[[0,0],[4,0],[4,3],[0,3]],openings:[]});
const cam=(spaceId,panel,position,basis="design")=>({spaceId,panel,position,yaw:90,pitch:0,lensMm:24,basis});
const saved={coordinates:{spaces:[room("deck","Deck"),room("lounge","Lounge"),{...room("office","Office","user"),footprint:[[0,0],[5,0],[5,4],[0,4]]}],
  cameras:[cam("deck","TL",[1,1,1.6]),cam("deck","BL",[2,2,1.6]),cam("lounge","TR",[1,1,6]),cam("office","BR",[3,3,6]),{spaceId:"deck",panel:"TR",yaw:10}]}};
const draft={frame:"new",coordinates:{spaces:[room("deck","Deck","observed"),room("office","Office","script")],
  cameras:[cam("deck","TL",[9,9,1.6],"observed"),cam("deck","TR",[5,5,1.6],"observed")]}};
const {plan,kept}=box.locationKeepOnRedraft(draft,saved);
const sp=plan.coordinates.spaces,cams=plan.coordinates.cameras,at=(s,p)=>cams.find(c=>c.spaceId===s&&c.panel===p);
check(sp.some(s=>s.id==="lounge"),"A saved room the draft left out is kept (the Lounge)");
check(sp.find(s=>s.id==="deck").basis==="observed","A room the draft returns keeps the draft's version");
check(sp.find(s=>s.id==="office").footprint[1][0]===5,"A room whose shape was set by hand keeps the saved shape");
check(at("deck","TL").position[0]===1,"A saved camera wins over the draft's proposal for the same room and panel");
check(at("deck","BL")&&at("lounge","TR")&&at("office","BR"),"Saved cameras the draft didn't propose are kept");
check(at("deck","TR").position[0]===5,"A saved camera without a position does not replace the draft's");
check(kept.spaces.join()==="Lounge,Office"&&kept.cameras.length===4,"What was kept is listed");
check(plan.frame==="new"&&draft.coordinates.cameras.length===2,"Everything else is the new draft's, and the draft object is not mutated");
check(box.locationKeptOnRedraftText(kept)==="Kept from the saved floor plan: the rooms Lounge, Office and 4 cameras you or a fix placed.","The review says what was kept");
check(box.locationKeptOnRedraftText({spaces:[],cameras:[]})==="","Nothing kept, nothing said");
check(box.locationKeepOnRedraft(draft,{}).plan===draft,"No saved floor plan: the draft is unchanged");
// The camera dropped when its room is gone from both plans.
check(!box.locationKeepOnRedraft({coordinates:{spaces:[],cameras:[]}},{coordinates:{spaces:[],cameras:[cam("gone","TL",[1,1,1])]}}).plan.coordinates.cameras.length,
  "A camera whose room no longer exists is not kept");

const ai=read("app/ai.jsx"),ui=read("app/locations-ui.jsx");
check(/locationKeepOnRedraft\(plan,normalizeLocationSpatialPlan\(owner\.spatialPlan\)\)/.test(ai),"The floor-plan draft keeps the saved cameras and rooms");
check(ai.indexOf("locationKeepOnRedraft(plan")>ai.indexOf("locationLowerDraftOutdoorCameras(plan"),"Kept after the draft's own cameras are lowered, so saved cameras stay as set");
check(/keptNote&&React\.createElement\("p",\{className:"loc-map-check",role:"note"\},keptNote\)/.test(ui),"The draft review shows what was kept");
console.log(`PASS location redraft keeps: ${checks} camera, room and review checks`);

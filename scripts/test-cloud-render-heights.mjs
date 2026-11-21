/* Floor-plan height conventions for the cloud set preview (2026-10-31). Saved plans are read, never rewritten:
   older drafts store an object's base and a raised room's sill / head from that room's floor; plans drafted now
   carry heights:"centre"; a plan corrected by hand before the marker existed (Marmorica) must not be lifted twice.
   No renderer, account or model call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {corsFor} from "../supabase/functions/blender-render/core.mjs";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};box.window=box;
vm.createContext(box);
for(const file of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js"])
  vm.runInContext(read("app/"+file),box);
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const near=(a,b,label)=>{assert.ok(Math.abs(a-b)<1e-9,label+": "+a+" ≠ "+b);checks++;};
const clone=v=>JSON.parse(JSON.stringify(v));

// A main deck (floor 0, ceiling 4) and a raised room (floor 4.4, ceiling 2.6) in one family.
const cameras=["TL","TR","BL","BR"].map((panel,i)=>({panel,spaceId:"deck",position:[0,2+i,1.6],yaw:i*90,pitch:0,lensMm:24}));
function family(anchors,openings,heights){
  const deck={id:"deck",key:"deck",name:"Ferry - Hold",spatialPlan:{status:"reviewed",source:{assetId:"deck",iso:""},frame:"Bow is north",
    ...(heights?{heights}:{}),
    anchors:anchors.map(a=>({space:a.space||"Ferry - Hold",placement:"Saved placement",posBasis:"design",facing:0,...a})),
    coordinates:{spaces:[
      {id:"deck",name:"Ferry - Hold",floorZ:0,ceilingH:4,footprint:[[-7,0],[7,0],[7,40],[-7,40]],openings:[]},
      {id:"office",name:"Ferry - Office",floorZ:4.4,ceilingH:2.6,footprint:[[-3,20],[3,20],[3,26],[-3,26]],openings}],cameras}}};
  const office={id:"office",key:"office",name:"Ferry - Office",parentId:"deck"};
  box.turnContinuity={locations:[deck,office]};
  return deck;
}
const objectZ=(scene,id)=>scene.objects.find(o=>o.anchorId===id).position[2];
const door=(sillZ,headZ)=>({id:"office-door",name:"Office door",kind:"door",edge:0,centre:[0,20],width:0.9,sillZ,headZ});

// 1. An older plan: base heights, room-relative openings. Sizes and zBasis "base" come from the editor.
{
  const deck=family([
    {id:"vent",name:"Ventilation trunk",xy:[6,10],z:0,size:[1.2,1,4],sizeBasis:"user",zBasis:"base"},
    {id:"lamps",name:"Sodium fittings on the beams",xy:[0,15],z:4,size:[0.35,0.6,0.2],sizeBasis:"user",zBasis:"base"},
  ],[door(0.15,1.9)]);
  const before=JSON.stringify(deck);
  check(box.KinolotCloudRender.inputIssues(deck).length===0,"An older plan's room-relative door is read from its room's floor, not flagged");
  const scene=box.KinolotCloudRender.buildScene(deck);
  near(objectZ(scene,"vent"),2,"An older base height of 0 stands the 4 m trunk on the floor (centre 2), not half sunk");
  near(objectZ(scene,"lamps"),3.9,"A base height at the ceiling never pushes a fitting through it");
  check(scene.notes.some(n=>/base heights/.test(n)),"Render notes say the plan saves base heights");
  const head=scene.objects.filter(o=>/Office wall/.test(o.name)&&Math.abs(o.size[0]-0.9)<1e-6);
  check(head.some(o=>Math.abs(o.position[2]-(4.4+1.9+(2.6-1.9)/2))<1e-6),"The door is cut 0.15–1.9 m above the office floor (4.55–6.3 on the main deck)");
  check(JSON.stringify(deck)===before,"Reading an older plan never edits the saved film");
}

// 2. Marmorica: sizes and centre heights saved by hand, openings already lifted, and no marker. Read once only.
{
  const deck=family([
    {id:"vent",name:"Ventilation trunk",xy:[6,10],z:2,size:[1.2,1,4],sizeBasis:"design"},
    {id:"cabinet",name:"Fire-hose cabinet",xy:[6.8,8],z:1.2,size:[0.8,0.35,1],sizeBasis:"design"},
  ],[door(4.55,6.3)]);
  check(box.locationAnchorHeightBasis(deck.spatialPlan.anchors[0],deck.spatialPlan)==="centre","An unmarked object that already has a size was saved with a centre height");
  check(box.KinolotCloudRender.inputIssues(deck).length===0,"Hand-corrected opening heights pass the input review");
  const scene=box.KinolotCloudRender.buildScene(deck);
  near(objectZ(scene,"vent"),2,"A hand-corrected centre height is not lifted again");
  near(objectZ(scene,"cabinet"),1.2,"A wall cabinet keeps its saved centre");
  check(!scene.notes.some(n=>/base heights/.test(n)),"No base-height note on a centre-height plan");
  const o=box.locationOpeningHeights(door(4.55,6.3),{floorZ:4.4,ceilingH:2.6},deck.spatialPlan);
  check(o.sillZ===4.55&&o.headZ===6.3,"Main-floor opening heights are never lifted twice");
}

// 3. A plan drafted now: marked, every height is a centre / main-floor height.
{
  const deck=family([{id:"vent",name:"Ventilation trunk",xy:[6,10],z:2,size:[1.2,1,4],sizeBasis:"design"}],[door(4.55,6.3)],"centre");
  near(objectZ(box.KinolotCloudRender.buildScene(deck),"vent"),2,"A marked plan's height is the object's centre");
  const wrong=family([{id:"vent",name:"Ventilation trunk",xy:[6,10],z:2,size:[1.2,1,4]}],[door(0.15,1.9)],"centre");
  check(box.KinolotCloudRender.inputIssues(wrong).some(i=>/bottom.*below the room floor/.test(i)),"A marked plan's openings are main-floor heights, so a room-relative one is flagged, not guessed");
  const tooHigh=family([{id:"vent",name:"Ventilation trunk",xy:[6,10],z:2,size:[1.2,1,4]}],[door(4.55,8)],"centre");
  check(box.KinolotCloudRender.inputIssues(tooHigh).some(i=>/top is at 8 m, above the ceiling at 7 m/.test(i)),"The message gives the exact top and ceiling heights to correct");
  const inverted=family([{id:"vent",name:"Ventilation trunk",xy:[6,10],z:2,size:[1.2,1,4]}],[door(4.9,4.7)],"centre");
  check(box.KinolotCloudRender.inputIssues(inverted).some(i=>/top must be higher than its bottom/.test(i)),"An inverted opening gets a plain-language correction");
  check(box.locationAnchorHeightBasis({zBasis:"base",size:[1,1,1]},{heights:"centre"})==="base","An object's own recorded basis wins over the plan's marker");
}

// 4. The normaliser keeps both markers only where present (an older plan's signature is unchanged).
{
  const legacy=box.normalizeLocationSpatialPlan({anchors:[{id:"a",name:"Bench",xy:[0,0],z:4.4}]});
  check(!("heights" in legacy)&&!("zBasis" in legacy.anchors[0]),"An unmarked plan normalises without new keys");
  const marked=box.normalizeLocationSpatialPlan({heights:"centre",anchors:[{id:"a",name:"Bench",xy:[0,0],z:4.9,zBasis:"base",size:[4,0.5,1]}]});
  check(marked.heights==="centre"&&marked.anchors[0].zBasis==="base","The plan marker and an object's recorded basis survive normalising");
  check(!("heights" in box.normalizeLocationSpatialPlan({heights:"sideways",anchors:[]})),"Unknown height conventions are dropped");
}

// 5. The drafter marks new plans; the editor records an older object's basis when its height or size is edited.
{
  const ai=read("app/ai.jsx"),ui=read("app/locations-ui.jsx");
  check(/normalizeLocationSpatialPlan\(\{\.\.\.parsed,coordinates,status:"draft",source,heights:"centre"\}\)/.test(ai),"A drafted floor plan is saved with heights:\"centre\"");
  check(/const heightBasis=a=>a\.zBasis\|\|plan\.heights==="centre"\?\{\}:\{zBasis:locationAnchorHeightBasis\(a,plan\)\}/.test(ui),"The editor records the basis only on an older, unrecorded object");
  check((ui.match(/\.\.\.heightBasis\(a\)/g)||[]).length===2,"Editing Height or Object dimensions records how the height was meant");
  check(/locationAnchorHeightBasis\(a,plan\)==="base"\?"object base":"object centre"/.test(ui),"The Height field says whether it is the object's base or centre");
}

// 6. Frances: builds are now open to Director/Producer (owner decision 5 November); dimensions stay documented.
{
  const ai=read("app/ai.jsx");
  // 2026-11-15 (owner: one road): the cloud build left the location card, and Frances says so in the same entry
  check(ai.includes('name:"Location floor plan, cameras and 3D set (Locations)"')&&/a location card no longer has the steps Build the set and Style it/.test(ai)&&!/Who can build: Director and Producer/.test(ai),"Frances no longer describes a build the card does not offer");
  check(/Floor plan position, Vertical position, Object dimensions, Front faces/.test(ai),"Frances knows each object has dimensions");
  check(/older floor plan keeps the object's base height/.test(ai),"Frances can explain base vs centre heights");
}

// 7. The render function answers CORS only for the app's own hosts and local development.
{
  for(const o of ["https://kinolot.infinitestudioai.com","https://cinema.infinitestudioai.com","https://kinolot.replit.app","http://localhost:5000","http://127.0.0.1:8080"])
    check(corsFor(o)["Access-Control-Allow-Origin"]===o,"CORS echoes "+o);
  for(const o of ["https://evil.example","http://kinolot.infinitestudioai.com","https://kinolot.infinitestudioai.com:444","https://kinolot.infinitestudioai.com.evil.example","null",""])
    check(!("Access-Control-Allow-Origin" in corsFor(o)),"No CORS for "+(o||"(no origin)"));
  check(!/"Access-Control-Allow-Origin":"\*"/.test(read("supabase/functions/blender-render/core.mjs")),"No wildcard origin remains");
}
// Missing size is not a missing position or vertical-placement value.
{
  const deck=family([{id:'alcove',name:'Open tiled shower alcove mouth',xy:[3,8],z:1.1}],[], 'centre');
  const before=JSON.stringify(deck),issues=box.KinolotCloudRender.inputIssueList(deck).filter(i=>i.anchorId==='alcove');
  check(issues.length===1&&issues[0].fields.join(',')==='size','Only the absent physical dimensions are identified');
  check(issues[0].text.includes('Object dimensions (width, depth, height)')&&!issues[0].text.includes('Floor plan position'),'A known position is not incorrectly requested again');
  check(JSON.stringify(deck)===before,'Validation does not replace the saved vertical position or other fields');
  const a=deck.spatialPlan.anchors[0];a.size=[1,.3,2.2];delete a.xy;
  const position=box.KinolotCloudRender.inputIssueList(deck).find(i=>i.anchorId==='alcove');
  check(position.fields.join(',')==='xy'&&!position.text.includes('Object dimensions'),'A known size is preserved when only the position is missing');
  const opening=family([{id:'alcove',space:'Ferry - Office',name:'Open tiled shower alcove mouth',xy:[0,20],z:5.4}],
    [{id:'alcove',name:'Open tiled shower alcove mouth',kind:'arch',edge:0,centre:[0,20],width:1,sillZ:4.4,headZ:6.4}], 'centre');
  box.turnContinuity.locations[1].parentKey='deck';
  check(!box.locationAnchorIsOpening(opening.spatialPlan.anchors[0]),'The test covers an ambiguous name rather than a lexical door/window match');
  check(!box.KinolotCloudRender.inputIssueList(opening).some(i=>i.anchorId==='alcove'),'An explicitly saved arch does not require an extra solid object size');
  check(!box.KinolotCloudRender.buildScene(opening).objects.some(o=>o.anchorId==='alcove'),'The explicit opening is not blocked by a fabricated solid object');
}
/* A NAMED DOORWAY BEYOND THE OUTLINE (2026-11-21, a paid run on a street): the draft of "Hussain Terrace" listed
   "Kitchen doorway at far end of hall", 6 m inside the house and seen through the front door. It blocked the plan with
   a measurement nobody could give, and the free fixes found nothing. */
{
  const far={id:'kitchen-doorway',name:'Kitchen doorway at far end of hall',xy:[-13.5,10],z:1,size:[.8,.1,2]};
  const deck=family([far,{id:'vent',name:'Ventilation trunk',xy:[6,10],z:2,size:[1.2,1,4]}],[],'centre');
  check(box.locationAnchorIsOpening(deck.spatialPlan.anchors[0]),'It is an opening by its name');
  const issues=box.KinolotCloudRender.inputIssueList(deck).filter(i=>i.step===2).map(i=>i.text);
  check(!issues.some(t=>/Kitchen doorway/.test(t)),'6.5 m outside the outline: not asked for ('+issues.join(' | ')+')');
  const scene=box.KinolotCloudRender.buildScene(deck);
  check(!scene.objects.some(o=>o.anchorId==='kitchen-doorway'),'...and not built');
  check(scene.notes.some(n=>n==="Kitchen doorway at far end of hall stands beyond this place's outline (seen through an opening): it is not built."),'The set says so');
  check(scene.objects.some(o=>o.anchorId==='vent'),'Everything else is built as before');
  // inside the outline, or on its edge, a named doorway with no saved opening is still asked for
  for(const xy of [[0,10],[-7,10],[-7.4,10]]){
    const d=family([{...far,xy}],[],'centre');
    check(box.KinolotCloudRender.inputIssueList(d).some(i=>i.text==="Add Kitchen doorway at far end of hall to its room's floor-plan openings, with its dimensions."),'Still asked for at '+xy.join(','));
    assert.throws(()=>box.KinolotCloudRender.buildScene(d),/Add Kitchen doorway at far end of hall to its room's floor-plan openings/);checks++;
  }
  // with no position there is nothing to tell where it stands: asked for, as before
  const blind=family([{id:'kitchen-doorway',name:'Kitchen doorway at far end of hall',z:1}],[],'centre');
  check(box.KinolotCloudRender.inputIssueList(blind).some(i=>/Add Kitchen doorway/.test(i.text)),'No position: still asked for');
  // the drafter is told to keep to the listed spaces
  check(read('app/ai.jsx').includes('ONLY THE LISTED SPACES: every fixed object and every opening stands inside, or on the edge of, the footprint of one of the spaces listed for this plan.'),'The floor plan drafter is told');
}
console.log(`PASS cloud render heights: ${checks} height-convention, no-double-lift, editor, Frances and CORS checks`);

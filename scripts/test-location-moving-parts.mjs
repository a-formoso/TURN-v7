#!/usr/bin/env node
/* MOVING PARTS (owner 2026-11-01, "Final Ramp": the shot came out with the stern ramp shut while the screenplay has
   headlights crawling up it). A part of the set the screenplay moves has states, a usual one, and changes at story
   moments; a shot frame states the part as it is at its moment (the location's "raised and sealing" framing is
   replaced, the set reference is told it may differ), the screenplay read keeps only changes that quote their own
   moment, and the cloud set can be built at a moment (the ramp hinged down outward, the hold's detail kept).
   No model, image or render call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,crypto,TextEncoder,URL,Date,Set,Map,Math,JSON,location:{hostname:"localhost"},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[],CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},dispatchEvent:()=>{}};
box.window=box;box.globalThis=box;vm.createContext(box);
for(const f of ["app/locations.jsx","app/blender-render-contract.js","app/blender-set-detail.js","app/blender-render.js",
  "app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx"])vm.runInContext(read(f),box,{filename:f});
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};

const scenes=[{id:"s1",no:1,title:"Final Ramp"},{id:"s2",no:2,title:"Later"}];
const ramp={name:"Stern ramp",anchorId:"stern-ramp",usual:"raised",
  states:[{id:"raised",label:"Raised",look:"raised and sealing the hold: a riveted grey steel wall",pose:"as-built"},
    {id:"lowered",label:"Lowered",look:"lowered onto the quay, the hold open to the night",pose:"lowered"}],
  changes:[{sceneId:"s1",beatN:1,moment:1,state:"lowered",evidence:"Headlights crawl up the ramp into the hold."},
    {sceneId:"s1",beatN:1,moment:4,state:"raised",during:true,evidence:"The ramp GROANS up behind the last car and seals the hold."}]};

// 1 · the data and the state at a moment
const parts=box.normalizeLocationMovingParts([ramp,{name:"One state only",states:[{id:"a"}]},{name:"",states:[{id:"a"},{id:"b"}]}]);
check(parts.length===1&&parts[0].id==="stern-ramp"&&parts[0].changes.length===2,"A part needs a name and two states; changes keep their moment");
check(box.normalizeLocationMovingParts([{...ramp,changes:[{sceneId:"s1",state:"sunk"}]}])[0].changes.length===0,"A change to a state the part doesn't have is dropped");
const deck={id:"deck",name:"Ferry - CAR Deck",movingParts:[ramp]};
const at=(sceneId,beatN,moment)=>box.locationMovingPartsAt(deck,{sceneId,beatN,moment},scenes)[0];
check(at("s1",1,1).state.id==="lowered"&&at("s1",1,1).differs,"As the beat opens the ramp is already lowered (headlights crawl up it)");
check(at("s1",1,3).state.id==="lowered","Still lowered at moment 3");
check(at("s1",1,4).state.id==="lowered"&&at("s1",1,4).during.id==="raised","Moment 4 opens with the ramp lowered; it rises during the moment");
check(at("s1",2,1).state.id==="raised"&&!at("s1",2,1).differs,"After the ramp seals the hold it is raised (usual)");
check(at("s2",1,1).state.id==="raised","A later scene sees the ramp raised");
check(box.locationMovingPartsAt({...deck,movingParts:[{...ramp,changes:[ramp.changes[0]]}]},{sceneId:"s2",beatN:1,moment:1},scenes)[0].state.id==="lowered","A state lasts until the next change, across scenes");
check(box.locationMovingPartsAt({id:"x"},{sceneId:"s1",beatN:1,moment:1},scenes).length===0,"No moving parts, nothing to say");
const clause=box.locationMovingPartsClause(box.locationMovingPartsAt(deck,{sceneId:"s1",beatN:1,moment:1},scenes));
check(/^MOVING PARTS AT THIS INSTANT \(binding/.test(clause)&&/Stern ramp — lowered: lowered onto the quay, the hold open to the night/.test(clause),"The shot line names the part and its state");
check(/still|at this instant; it starts to move to raised/.test(box.locationMovingPartsClause([at("s1",1,4)])),"A part moving during the moment is shown as it starts");
check(box.locationMovingPartsClause([at("s1",2,1)])==="","A part in its usual state adds nothing");
const cell="Hinged steel stern ramp, raised and sealing the hold: a riveted grey steel wall";
check(box.locationMovingPartCell(cell,[at("s1",1,1)])==="Stern ramp — lowered: lowered onto the quay, the hold open to the night","The framing that shows the ramp shut is replaced");
check(box.locationMovingPartCell("Fire-hose reel cabinet",[at("s1",1,1)])==="Fire-hose reel cabinet","Other framing is untouched");

// 2 · the shot prompt
const staging={bg:{center:cell,left:"Fire-hose reel cabinet on the starboard bulkhead",right:"Stencilled deck number"},
  mid:{center:"",left:"Vertical steel ventilation trunk",right:"Steel stair door"},fg:{left:"",right:""},floor:"Oil-filmed chequer-plate deck"};
const loc={...deck,intExt:"INT",architecture:"A single steel hold.",lighting:"Sodium-vapour fittings.",staging,scenes:["s1"]};
const scene={id:"s1",no:1,title:"Final Ramp",loc:"INT. MARMORICA - CAR DECK - NIGHT"};
const drafts={s1:{version:1,blocks:[{beat:1,type:"scene",text:scene.loc},{beat:1,type:"action",text:"Sodium light. Diesel haze. Headlights crawl up the ramp into the hold."},
  {beat:1,type:"action",text:"OTTAVIO SPADONI ticks his clipboard."},{beat:1,type:"action",text:"The ramp GROANS up behind the last car and seals the hold."}]}};
box.turnContinuity={scenes,drafts,locations:[loc],characters:[]};
const shot={id:"p",sceneId:"s1",beatN:1,keyframeMode:"beat-opening",size:"WS",angle:"eye",move:"static",lens:"35",action:""};
const ctx={scene,location:loc,project:{id:"film"},charById:{},propById:{},drafts,scenes};
const prompt=box.buildShotPrompt(shot,ctx);
check(/background landmark: Stern ramp — lowered: lowered onto the quay/.test(prompt)&&!/raised and sealing the hold/.test(prompt),"The opening frame's framing shows the ramp lowered, never 'raised and sealing'");
check(/MOVING PARTS AT THIS INSTANT/.test(prompt),"The opening frame states the ramp's state");
const usual=box.buildShotPrompt({...shot,sceneId:"s2"},{...ctx,scene:{...scene,id:"s2",no:2}});
check(/raised and sealing the hold/.test(usual)&&!/MOVING PARTS/.test(usual),"A frame where the ramp is in its usual state keeps the location's own framing");
const shots=read("app/shots.jsx");
check(/except the moving parts set for this instant \("\+_partsMoved\.join\("; "\)\+"\), which this reference may show otherwise/.test(shots),"The set reference is told the moving parts may differ from it");

// 2b · a state's own image (owner 2026-11-01, "go ahead with the state images")
{
  const st=box.locationMovingPartsAt(deck,{sceneId:"s1",beatN:1,moment:1},scenes);
  check(box.locationPartStateKey(st)==="stern-ramp.lowered"&&box.locationPartStateLabel(st)==="Stern ramp lowered","A state is keyed and named by the parts out of their usual state");
  check(box.locationPartStateAssetId(deck,"stern-ramp.lowered")==="deck-parts-stern-ramp-lowered"&&box.locationPartStateAssetId(deck,"")==="","Its image has its own asset id; the usual state has none (it is the location image)");
  check(box.shotLocationCoverageSpecs(loc,shot,scene,drafts).every(x=>x.category!=="parts"),"No state image yet: the shot keeps its usual references");
  box.nbGetMeta=id=>id==="deck-parts-stern-ramp-lowered"?{iso:"x"}:null;
  const specs=box.shotLocationCoverageSpecs(loc,shot,scene,drafts);
  check(specs[0]&&specs[0].id==="deck-parts-stern-ramp-lowered"&&specs[0].category==="parts","With the image, a shot at that moment attaches the 'Stern ramp lowered' image");
  const placeSpec={id:"deck",category:"place",locationId:"deck",required:true,note:"Deck place"};
  const real=box.shotLocationCoverageSpecsBase;
  box.shotLocationCoverageSpecsBase=()=>[placeSpec,{id:"deck-x",category:"coverage",locationId:"deck"}];
  const swapped=box.shotLocationCoverageSpecs(loc,{...shot,referenceLocationsSet:true,referenceLocationIds:["deck"]},scene,drafts);
  check(swapped.map(x=>x.id).join()==="deck-parts-stern-ramp-lowered,deck-x"&&swapped[0].required,"It stands in for the plate a director picked, keeping any extra space");
  // the scene's location is the ship and the parts are on its CAR Deck room (The Last Crossing, 2026-11-01)
  const ship={id:"ship",name:"Marmorica",scenes:["s1"]};
  box.shotLocationCoverageSpecsBase=()=>[{id:"ship-x",category:"coverage",locationId:"ship"},placeSpec];
  const inRoom=box.shotLocationCoverageSpecs(ship,{...shot,referenceLocationsSet:true,referenceLocationIds:["deck"]},scene,drafts);
  check(inRoom.map(x=>x.id).join()==="ship-x,deck-parts-stern-ramp-lowered","A room's state image replaces the room's plate when the scene's location is the building around it");
  const autoRoom=box.shotLocationCoverageSpecs(ship,shot,scene,drafts);
  check(autoRoom.some(x=>x.id==="deck-parts-stern-ramp-lowered")&&!autoRoom.some(x=>x.id==="deck"),"The same on an automatic reference list");
  check(box.shotLocationCoverageSpecs(loc,{...shot,sceneId:"s2"},{...scene,id:"s2",no:2},drafts).every(x=>x.category!=="parts"),"A shot at a moment in the usual state keeps the location image");
  box.shotLocationCoverageSpecsBase=real;
  box.nbGetMeta=()=>null;
}
check(/\.\.\.liveLocationRefIds\(\), \.\.\._partStateIds,/.test(read("app/shots-ui.jsx")),"A shot card redraws its references when a state image arrives after it first drew (after a reload)");
check(/const missing=_partStateIds\.filter\(id=>live\.indexOf\(id\)<0\);[\s\S]{0,260}has=await nbLoadImage\(id\)/.test(read("app/shots-ui.jsx")),"A card that missed the state image's arrival fetches it itself");
const style=read("app/blender-style.js"),styleUi=read("app/blender-style-ui.jsx");
check(/const assetOf=t=>t\.key\?root\.locationPartStateAssetId\(live\(t\.loc\),t\.key\):t\.loc;/.test(style)&&/root\.nbCommit\(asset,pixels,outputMeta,/.test(style),"Accepting a state's draft saves it as the state's image, never the location image");
check(/sceneKey\(live\(t\.loc\),t\.at\)/.test(style)&&/stateKey:t\.key/.test(style)&&/\(meta\.stateKey\|\|""\)!==t\.key/.test(style),"A state's draft is checked against the set built at its moment, and never mixed up with the usual one");
check(/MOVING PARTS AT THIS MOMENT \(as built in the source\)/.test(style),"The style draft is told which parts are moved at its moment");
check(/"Use as the \\u201c"\+partState\.label\+"\\u201d image"/.test(styleUi),"The button says which image the draft becomes");
check(/data-testid":"location-part-state-images"/.test(read("app/locations-ui.jsx")),"Moving parts lists each state's image, or how to make it");
// 3 · the screenplay read (a fake model; a change must quote its own moment)
{
  const ai=read("app/ai.jsx");
  const ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
  const fn=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="aiReadLocationMovingParts");
  vm.runInContext(ai.slice(fn.start,fn.end),box);
  let asked="";
  const reply={parts:[{name:"Stern ramp",object:"Hinged steel stern ramp",usual:"raised",states:ramp.states,changes:[
    {scene:1,beat:1,moment:1,state:"lowered",during:false,quote:"Headlights crawl up the ramp into the hold."},
    {scene:1,beat:1,moment:3,state:"raised",during:true,quote:"The ramp GROANS up behind the last car and seals the hold."},
    {scene:1,beat:1,moment:2,state:"raised",during:true,quote:"The ramp GROANS up behind the last car"}]},
    {name:"Invented hatch",states:[{id:"shut"},{id:"open"}],changes:[{scene:1,beat:1,moment:1,state:"open",quote:"The hatch flies open."}]}]};
  Object.assign(box,{extractJSON:JSON.parse,locationSpaceAnchors:()=>[{id:"stern-ramp",name:"Hinged steel stern ramp"}],
    claude:{complete:async({messages})=>{asked=messages[0].content;return JSON.stringify(reply);}}});
  const found=await box.aiReadLocationMovingParts(loc,{scenes,drafts,characters:[],beatsMap:{}});
  check(/\[Scene 1 · beat 1 · moment 1\]/.test(asked)&&/Headlights crawl/.test(asked),"The read sees the screenplay moment by moment");
  check(found.length===1&&found[0].name==="Stern ramp"&&found[0].anchorId==="stern-ramp","A part is linked to its floor-plan object; a part with no quoted change is dropped");
  check(found[0].changes.length===2&&found[0].changes[1].moment===3&&found[0].changes[1].during,"A change quoting another moment's words is dropped");
  await assert.rejects(()=>box.aiReadLocationMovingParts({...loc,scenes:[]},{scenes,drafts}),/No scene takes place/);checks++;
}

// 4 · the cloud set at a moment
const fixture={id:"deck",key:"deck",name:"Ferry - CAR Deck",movingParts:[ramp],spatialPlan:{status:"reviewed",source:{assetId:"deck",iso:""},frame:"Bow is north",
  anchors:[{id:"stern-ramp",name:"Hinged steel stern ramp",xy:[0,0],z:1.9,size:[6,.25,3.8],facing:180},
    {id:"lane-markings",name:"Painted lane lines and arrows",xy:[0,15],z:.006,size:[.15,30,.012],facing:0},
    {id:"hose-cabinet",name:"Red fire-hose reel cabinet",xy:[7,9],z:1.2,size:[.8,.35,1],facing:270}]
    .map(a=>({...a,space:"Ferry - CAR Deck",placement:"Saved placement",sizeBasis:"design",posBasis:"design"})),
  coordinates:{spaces:[{id:"deck",name:"Ferry - CAR Deck",floorZ:0,ceilingH:4,footprint:[[-7,0],[7,0],[7,40],[-7,40]],
    openings:[{id:"stern-ramp",name:"Stern ramp",kind:"door",centre:[0,0],width:6,sillZ:0,headZ:3.8}]}],
    cameras:[{panel:"TL",position:[0,.6,1.6],yaw:35,pitch:0,lensMm:24},{panel:"TR",position:[-6.2,1,2.8],yaw:19,pitch:-8,lensMm:20},
      {panel:"BL",position:[4.8,8,1.6],yaw:210,pitch:-6,lensMm:24},{panel:"BR",position:[0,16.8,1.6],yaw:180,pitch:-4,lensMm:24}].map(c=>({...c,spaceId:"deck"}))}}};
box.turnContinuity={locations:[fixture],scenes};
const R=box.KinolotCloudRender;
const raised=R.buildScene(fixture),down=R.buildScene(fixture,undefined,{sceneId:"s1",beatN:1,moment:1});
const slab=s=>s.objects.find(o=>o.anchorId==="stern-ramp"&&o.id.startsWith("anchor-"));
check(slab(raised).size[2]===3.8&&raised.objects.some(o=>o.name==="Raised ramp rib"),"Usual state: the ramp stands raised with its assembly");
const d=slab(down);
check(d.size[1]===3.8&&d.size[2]===.25&&d.position[1]<0&&d.position[1]>-2.5&&d.position[2]<0,"Lowered: the ramp lies outward from the aft wall, falling toward the quay");
check(Math.abs(d.rotation[0]+8*Math.PI/180)<1e-9,"Lowered with an 8° fall");
const quay=down.objects.find(o=>/^Quay beyond/.test(o.name)),night=down.objects.find(o=>/^Night beyond/.test(o.name));
check(quay&&night&&quay.position[1]<-10&&night.position[1]<-30&&down.materials.quay&&down.materials.night,"Beyond a lowered part: a quay and a night backdrop, so the opening reads as outside");
check(!raised.objects.some(o=>/^Quay beyond|^Night beyond/.test(o.name))&&!raised.materials.quay,"The usual set is unchanged (its builds stay current)");
check(!down.objects.some(o=>o.name==="Raised ramp rib")&&down.objects.some(o=>o.name==="Transverse steel beam web"),"Lowered: no raised-ramp assembly, the hold keeps its detail");
check(down.notes.some(n=>/Stern ramp lowered at this moment/.test(n)),"The build says the part is posed for the moment");
check(JSON.stringify(R.buildScene(fixture,undefined,{sceneId:"s2",beatN:1,moment:1}))===JSON.stringify(raised),"A moment in the usual state builds the usual set");
const hidden=structuredClone(fixture);hidden.movingParts[0].states[1].pose="hidden";
check(!slab(R.buildScene(hidden,[hidden],{sceneId:"s1",beatN:1,moment:1})),"A part that isn't there is left out");
const moments=R.buildMoments(fixture);
check(moments.length===2&&moments[0].label==="Usual state"&&/Scene 1 · beat 1 · moment 1 — Stern ramp lowered/.test(moments[1].label),"Build at offers the usual state and each moment that changes the set");
R.setBuildMoment("deck",moments[1].key);check(R.buildMoment(fixture).moment===1,"The choice is remembered for the card");
R.setBuildMoment("deck","");check(R.buildMoment(fixture)===null,"Usual state again");

// 5 · the card
const ui=read("app/locations-ui.jsx"),cloud=read("app/blender-render-ui.jsx");
// since 2026-11-13 at the end of 2 · Floor plan (each part is tied to an object of the floor plan), not a section of its own
check(/function LocationMovingParts/.test(ui)&&/id:"loc-parts-"\+l\.id,"data-testid":"location-moving-parts-section"\},\s*React\.createElement\("summary",null,"Moving parts \(optional\)"/.test(ui),"The location card has Moving parts, in its floor plan step");
check(/Find them in the screenplay \(writing credits\)/.test(ui)&&/"Add one by hand"/.test(ui)&&/"Keep"\)/.test(ui)&&/"Discard"\)/.test(ui),"The read is reviewed before anything is saved, and its price is named");
check(/momentPicker\(location,api,/.test(cloud)&&/E\("span",null,"Build at"\)/.test(cloud),"Step 4 builds the set at a chosen moment");
check(/if\(key\)target=\{loc:location\.id,at:c\.at,key,label:window\.locationPartStateLabel\(states\)\};/.test(cloud),"Step 5 styles the set at the chosen moment as that state's image");
console.log(`PASS location moving parts: ${checks} state, prompt, read and set checks`);

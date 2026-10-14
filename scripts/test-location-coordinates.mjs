#!/usr/bin/env node
/* LOCATION COORDINATES, step A (owner-approved 2026-10-13, "go ahead with both, include the top-down map").
   A room's 2x2 plate is made from its own panel cameras, and each window / door a panel sees shows the parent as
   seen from that camera — the parent quadrant whose RECORDED camera faces that way, cut out and attached as its own
   numbered reference — never the parent's most striking panel.
   1. the coordinate model: metres, +Z up, +Y = the layout frame's facing, yaw clockwise from +Y; old layouts keep
      their exact shape and signature (stored data is never migrated)
   2. panel poses: a room's planned panels (doorway → far wall, high corner, stations / window wall); an owner's
      suggestions are not stated until set; set poses fill the coverage view's free text
   3. quadrant selection geometry: by facing, and with positions by coverage (a camera inside the room or one that
      faces the right way but looks elsewhere is refused); no match / no record / no plate
   4. references (2026-10-14, single cut-out panels): never the parent's whole sheet — the matched crop alone, at its own
      size (up to 1536 px), labelled for its opening, numbered; none matched → one optional small material panel
   5. prompt text per panel; the weak "Read ALL panels together" guidance is gone for a room; owner unchanged
   6. generation: the plate records its cameras; "Make a … view" (one image) records its pose and is then used
   7. the Blender handoff: studio-contract cameras
   All providers and persistence are mocked; this test spends nothing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const contract=createRequire(import.meta.url)("../supabase/functions/blender-bridge/studio-contract.js");

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const box={console,setTimeout,clearTimeout,localStorage:{getItem:()=>null},scenesInStoryOrder:x=>x||[],
  dispatchEvent:()=>true,CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},renderStyleText:()=>"Photoreal"};
box.window=box;vm.createContext(box);
vm.runInContext(read("app/locations.jsx"),box);
const json=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const deq=(a,b,m)=>assert.deepEqual(json(a),json(b),m);   // values from the vm realm
const near=(a,b,eps=0.6)=>assert.ok(Math.abs(a-b)<=eps,a+" ≈ "+b);

/* ---- 1. the model, and old layouts unchanged ---- */
const oldPlan={frame:"From the archway facing the kitchen",status:"reviewed",source:{assetId:"house",iso:"v1"},
  anchors:[{id:"table",space:"Kitchen",name:"Table",placement:"In front of the fridge",basis:"observed",evidence:"Both panels"}],
  sightlines:"Open archway",unresolved:"Dimensions unmeasured"};
const n0=box.normalizeLocationSpatialPlan(oldPlan);
deq(Object.keys(n0),["schema","frame","anchors","sightlines","unresolved","status","source"],"no coordinates key on an old layout");
deq(Object.keys(n0.anchors[0]),["id","space","name","placement","evidence","basis"],"no position keys on an old anchor");
// the signature of an old layout is exactly what the pre-coordinates code computed
const oldSig=(()=>{const p={schema:"cm-spatial-layout-v1",frame:oldPlan.frame,anchors:json(n0.anchors),sightlines:oldPlan.sightlines,
  unresolved:oldPlan.unresolved,status:"reviewed"};const str=JSON.stringify(p);let h=5381;for(let i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))|0;
  return "sp1:"+(h>>>0).toString(36)+":"+str.length;})();
assert.equal(box.locationSpatialPlanSig(oldPlan),oldSig,"an old layout's signature (and so its review state) is unchanged");
assert.equal(box.normalizeLocationSpatialPlan({...oldPlan,coordinates:{spaces:[]}}).coordinates,undefined,"an empty coordinates block is not written");
const withNumbers=box.normalizeLocationSpatialPlan({...oldPlan,anchors:[{...oldPlan.anchors[0],xy:[1.23456,"2"],z:0.75,facing:370,posBasis:"observed"}],
  coordinates:{origin:{anchorId:"table"},spaces:[{id:"kitchen",name:"Kitchen",footprint:[[0,0],[4,0],[4,3],[0,3]],ceilingH:2.6,
    openings:[{id:"sink window",kind:"window",centre:[2,0],width:1.2,sillZ:0.9,headZ:2,connectsTo:"yard",basis:"observed"},{id:"bad",kind:"portal",yaw:"x"}]}]}});
deq(json(withNumbers.anchors[0].xy),[1.235,2]);
assert.equal(withNumbers.anchors[0].facing,10,"yaw wraps into 0–360");
assert.equal(withNumbers.anchors[0].posBasis,"observed");
const ks=withNumbers.coordinates.spaces[0];
assert.equal(ks.floorZ,0);assert.equal(ks.ceilingH,2.6);
assert.equal(ks.openings[0].id,"sink-window");
assert.equal(ks.openings[0].edge,0,"an opening's wall is the nearest footprint edge");
assert.equal(ks.openings[0].yaw,180,"its outward facing comes from that edge (south)");
assert.equal(ks.openings[1].kind,"window");assert.equal(ks.openings[1].yaw,null);
assert.equal(withNumbers.coordinates.origin.anchorId,"table");
assert.notEqual(box.locationSpatialPlanSig(withNumbers),oldSig,"numbers are part of the reviewed layout");
// helpers
assert.equal(box.locYaw(-90),270);assert.equal(box.locYawDiff(10,350),20);assert.equal(box.locYawDiff(350,10),-20);
assert.equal(box.locCompass(180),"south");assert.equal(box.locCompass(44),"north-east");
near(box.locLensHfov(24),73.7,0.1);near(box.locLensHfov(18),90,0.1);
assert.equal(box.locWallYawFromText("on the south wall, overlooking the hall").yaw,180);
assert.equal(box.locWallYawFromText("against the north-west corner").yaw,315);
assert.equal(box.locWallYawFromText("on the far wall").yaw,0);
assert.equal(box.locWallYawFromText("left wall, by the door").yaw,270);
assert.equal(box.locWallYawFromText("somewhere in the room"),null);
assert.equal(box.LOCATION_COORDINATE_CONVENTION.units,"metres");
assert.match(box.LOCATION_COORDINATE_CONVENTION.yaw,/clockwise from \+Y/);

/* ---- a furnace hall with an office on its mezzanine (facings only, no coordinates) ---- */
let metas={},images={};
box.nbGetMeta=id=>metas[id]||null;box.nbGetImage=id=>images[id]||"";box.nbLoadImage=async id=>images[id]||"";
const crops=[];
box.cropRegionAsDataUrl=async(url,rect,max)=>{crops.push({url,rect,max});return "crop:"+url+":"+rect.x+","+rect.y;};
const anchors=[{id:"mouth",space:"Furnace",name:"Furnace mouth",placement:"north wall, centre"},
  {id:"office-door",space:"Furnace Office",name:"Office door",placement:"on the west wall, onto the mezzanine"},
  {id:"office-window",space:"Office",name:"Office window",placement:"south wall, overlooking the hall"},
  {id:"desk",space:"Furnace Office",name:"Foreman's desk",placement:"against the east wall"},
  {id:"conveyor",space:"Furnace",name:"Slag conveyor",placement:"along the south wall"}];
const furnace={id:"furnace",key:"furnace",name:"Furnace",spatialPlan:box.normalizeLocationSpatialPlan({frame:"From the loading door facing the furnace mouth",
  status:"reviewed",source:{assetId:"furnace",iso:"f1"},anchors})};
const office={id:"office",key:"office",name:"Furnace Office",parentKey:"furnace"};
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};
images.furnace="furnace-plate";
const furnaceRecord=(panels)=>({iso:"f1",platePanels:{schema:"cm-plate-panels-v1",spaceId:"furnace",panels}});

/* ---- 2. panel poses ---- */
assert.equal(box.locationAnchorSpaceOf(anchors[2],[furnace,office]).id,"office","'Office' names the Furnace Office room");
assert.equal(box.locationAnchorSpaceOf(anchors[4],[furnace,office]).id,"furnace");
/* (2026-10-14) NEVER THE PARENT BY DEFAULT: neither object's words name a space, so neither leads anywhere until the
   room's card says where (Plate cameras' "It opens onto Furnace" — openingLeadsTo) */
deq(box.locationSpaceOpenings(office).map(o=>[o.id,o.connectsTo,o.destination]),[["office-door","","unknown"],["office-window","","unknown"]]);
assert.equal(box.locationSubspacePanelPlan(office).panels.every(p=>!p.sights.length),true,"no parent view goes through an opening nobody placed");
office.openingLeadsTo={"office-door":"furnace","office-window":"Furnace"};
const openings=box.locationSpaceOpenings(office);
deq(openings.map(o=>[o.id,o.kind,o.yaw,o.yawFrom,o.connectsTo,o.destination]),[["office-door","door",270,"text","furnace","chosen"],["office-window","window",180,"text","furnace","chosen"]]);
let panels=box.locationPanelPoses(office);
deq(panels.map(p=>p.key),["TL","TR","BL","BR"]);
assert.ok(panels.every(p=>p.stated&&p.source==="suggested"),"a room always states its planned cameras");
assert.match(panels[0].purpose,/from the doorway, looking at the far wall/);
assert.equal(panels[0].pose.yaw,90,"TL: inside the west door, looking east at the far wall");
assert.equal(panels[1].pose.yaw,135,"TR: the high corner turns toward the window side");
assert.ok(panels[1].pose.pitch<0&&panels[1].pose.lensMm<=18);
assert.match(panels[2].purpose,/Foreman's desk/);assert.equal(panels[2].pose.yaw,90,"BL faces the wall the desk is on");
assert.match(panels[3].purpose,/window wall/);assert.equal(panels[3].pose.yaw,180);
const ownerPanels=box.locationPanelPoses(furnace);
assert.ok(ownerPanels.every(p=>!p.stated&&p.source==="suggested"),"an owner space's cameras are suggestions until set");
assert.equal(ownerPanels[0].pose.yaw,0,"the owner's establishing view faces the layout frame's direction");
assert.equal(box.locationPlatePanelRecord(furnace),null,"an owner without set cameras records nothing");
const officeRecord=box.locationPlatePanelRecord(office);
deq(Object.keys(officeRecord.panels),["TL","TR","BL","BR"]);
assert.equal(officeRecord.panels.TL.yaw,90);near(officeRecord.panels.TL.hfov,73.7,0.1);
assert.equal(box.locationPlatePanels({}),null,"an old plate (no record): every panel's facing is unknown");

/* ---- 3. quadrant selection by facing ---- */
// the furnace plate: TL faces the furnace mouth (north — its most striking panel), TR faces south from the mezzanine
metas.furnace=furnaceRecord({TL:{yaw:0,pitch:0,lensMm:24},TR:{yaw:180,pitch:-30,lensMm:18,place:"on the mezzanine"},BL:{yaw:90,lensMm:35}});
let plan=box.locationSubspacePanelPlan(office);
assert.equal(plan.sources.length,1);
assert.equal(plan.sources[0].key,"TR","the quadrant facing the window's line of sight, never the striking top-left");
deq(plan.sources[0].uses.map(u=>u.panel),["TR","BR"],"one crop serves every panel that sees the window");
const brSight=plan.panels[3].sights[0];
assert.equal(brSight.openingId,"office-window");assert.equal(brSight.yaw,180);assert.equal(brSight.approx,true,"facing-only match is marked approximate");
assert.equal(plan.panels[0].sights.length,0,"the doorway camera looks east, away from the south window");
assert.equal(plan.unresolved.length,0);
// no quadrant faces south → unresolved, described from the layout
metas.furnace=furnaceRecord({TL:{yaw:0,lensMm:24},TR:{yaw:90,lensMm:24}});
plan=box.locationSubspacePanelPlan(office);
assert.equal(plan.sources.length,0);
deq(plan.unresolved.map(u=>[u.panel,u.openingId,u.reason]),[["TR","office-window","no-match"],["BR","office-window","no-match"]]);
deq(plan.panels[3].sights[0].beyond.map(a=>a.id),["conveyor"],"what lies south of the window, from the layout");
metas.furnace={iso:"f1"};
assert.equal(box.locationSubspacePanelPlan(office).unresolved[0].reason,"no-record","an old parent plate: unknown facings, nothing inferred");
delete metas.furnace;
assert.equal(box.locationSubspacePanelPlan(office).unresolved[0].reason,"no-plate");

/* ---- 3b. with coordinates: positions and coverage ---- */
const hall=[[-10,-10],[10,-10],[10,10],[-10,10]],box2=[[2,4],[6,4],[6,8],[2,8]];
const coordFurnace={...furnace,spatialPlan:box.normalizeLocationSpatialPlan({...furnace.spatialPlan,
  anchors:anchors.map(a=>a.id==="conveyor"?{...a,xy:[4,-6]}:a.id==="mouth"?{...a,xy:[0,9]}:a),
  coordinates:{origin:{anchorId:"mouth"},spaces:[{id:"furnace",name:"Furnace",footprint:hall,ceilingH:12},
    {id:"office",name:"Furnace Office",footprint:box2,floorZ:3,ceilingH:2.7,openings:[
      {id:"office-window",name:"Office window",kind:"window",centre:[4,4],width:2,sillZ:3.9,headZ:5,connectsTo:"furnace",basis:"design"},
      {id:"office-door",name:"Office door",kind:"door",centre:[2,6],width:0.9,sillZ:3,headZ:5.1,connectsTo:"Furnace"}]}]}})};
box.turnContinuity={locations:[coordFurnace,office],scenes:[],drafts:{}};
const cOpen=box.locationSpaceOpenings(office);
deq(cOpen.map(o=>[o.id,o.yaw,o.source]),[["office-window",180,"coordinates"],["office-door",270,"coordinates"]]);
panels=box.locationPanelPoses(office);
deq(json(panels[0].pose.position),[2.6,6,4.6],"TL stands just inside the door at eye height on the mezzanine floor");
assert.equal(panels[1].pose.yaw,135);near(panels[1].pose.position[0],2.21,0.02);near(panels[1].pose.position[2],5.4,0.01);
const trSight=box.locationPanelSightlines(office,panels[1]);
assert.equal(trSight.length,1);near(trSight[0].yaw,154.7,0.2);near(trSight[0].pitch,-12.8,0.3);
assert.equal(trSight[0].from,"positions");
assert.equal(box.locationPanelSightlines(office,panels[0]).length,0,"the window is outside the doorway camera's field of view");
metas.furnace=furnaceRecord({
  TL:{yaw:0,position:[0,-8,1.6],lensMm:24},                         // looks north AT the office from the hall floor
  TR:{yaw:160,position:[4.3,3.5,4.4],lensMm:24},                    // just outside the window, looking out over the hall
  BL:{yaw:180,position:[4,6,3.5],lensMm:24},                        // inside the office — shows the room itself
  BR:{yaw:160,position:[-8,0,2],lensMm:85}});                       // faces roughly south but looks at the west side
plan=box.locationSubspacePanelPlan(office);
const trRow=plan.panels[1].sights[0];
assert.equal(plan.sources[0].key,"TR","the camera in front of the window, on its outward side, covering the area beyond it");
assert.equal(trRow.approx,false,"a position-checked match");
const sight={opening:{id:"office-window",yaw:180},yaw:154.7,pitch:-12,through:[4,4]};
const cands=box.locationViewCandidates(coordFurnace,office).candidates;
assert.equal(box.locationMatchView(sight,cands.filter(c=>c.key==="TR"),box2).key,"TR","camera in front: chosen");
assert.equal(box.locationMatchView(sight,cands.filter(c=>c.key==="BL"),box2),null,"a camera inside the room is refused");
assert.equal(box.locationMatchView(sight,cands.filter(c=>c.key==="BR"),box2),null,"facing the right way but covering another area is refused");
assert.equal(box.locationMatchView(sight,cands.filter(c=>c.key==="TL"),box2),null,"a camera looking at the office is refused");
// a camera BEHIND the room (the mezzanine behind the office, looking south over it) would show the office's own back
const behind={id:"pq-behind",kind:"quadrant",key:"TR",pose:{position:[5,9,5],yaw:180,pitch:-30,lensMm:18},hfov:box.locLensHfov(18)};
assert.equal(box.locationMatchView(sight,[behind],box2),null,"a camera behind the room (not on the opening's outward side) is never chosen");
assert.equal(box.locationMatchView({...sight,opening:{id:"office-window",yaw:180}},[{...behind,pose:{...behind.pose,position:[4.3,4.1,5]}}],box2),null,
  "…nor one barely in front of the wall (inside the margin)");
// on the outward side, but the room's own wing stands between the camera and what it must show
const lRoom=[[2,4],[5,4],[5,1],[7,1],[7,8],[2,8]];
const occluded={id:"pq-occ",kind:"quadrant",key:"BR",pose:{position:[3,3.7,4],yaw:140,pitch:0,lensMm:24},hfov:box.locLensHfov(24)};
assert.equal(box.locationMatchView(sight,[occluded],lRoom),null,"a sight line crossing the room's own footprint is refused");
assert.equal(box.locationMatchView(sight,[occluded],null).key,"BR","…the same camera, with no footprint to block it, would match");
assert.equal(box.locationSegmentCrossesFootprint([3,3.7],[5.71,0.38],lRoom),true);
assert.equal(box.locationSegmentCrossesFootprint([4.3,3.5],[4.64,2.64],box2),false);
// nothing qualifies → the no-match path: no picture, the layout's objects named, the offer
metas.furnace=furnaceRecord({TR:{yaw:180,position:[5,9,5],lensMm:18}});
plan=box.locationSubspacePanelPlan(office);
assert.equal(plan.sources.length,0,"the camera behind the office is refused");
assert.equal(plan.unresolved[0].reason,"no-match");
assert.ok(box.locationParentViewRequest(office,"office-window"),"…and 'Make a view from the office's position' is offered");
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};

/* ---- 4 · 5. references and prompt ---- */
metas.furnace=furnaceRecord({TL:{yaw:0,lensMm:24},TR:{yaw:180,pitch:-30,lensMm:18,place:"on the mezzanine"}});
crops.length=0;
const sub=await box.locationSubspacePlateReferences(office);
assert.equal(sub.refs.length,1,"the matched panel alone");
assert.ok(!sub.refs.some(r=>r.url==="furnace-plate"||r.refId==="furnace"),"never the parent's whole sheet (2026-10-14)");
assert.doesNotMatch(sub.refs.map(r=>r.note).join(" "),/Read ALL panels together|reproduce that exact room|whole plate/,"the weak room guidance is gone");
deq(json(crops),[{url:"furnace-plate",rect:{x:50.5,y:0.5,w:49,h:49},max:1536}],"the top-right quadrant is cut out at its own size");
assert.equal(sub.refs[0].url,"crop:furnace-plate:50.5,0.5");assert.equal(sub.refs[0].maxDim,1536);
assert.equal(sub.refs[0].refId,"pq-furnace-tr");assert.ok(sub.refs.every(r=>r.numbered&&r.required));
assert.match(sub.refs[0].note,/^Furnace seen facing south — the top-right panel of its plate, camera on the mezzanine: use ONLY for what is visible through the window “Office window” in the top-right and bottom-right panels; never as Furnace Office itself and never as a backdrop$/);
deq(json(box.locationReferenceNumbers(sub.refs)),{"pq-furnace-tr":1});
const promptOf=(l,o)=>box.buildLocationRefPrompt(l,{},o);
const specOf=(l,o)=>JSON.parse(promptOf(l,o).split("\n").slice(1).join("\n"));
let spec=specOf(office,{panelPlan:sub.plan,panelRefs:box.locationReferenceNumbers(sub.refs)});
assert.match(spec.views.layout,/four cameras INSIDE Furnace Office/);
assert.match(spec.views.top_left,/^from the doorway, looking at the far wall of Furnace Office\. Camera inside Furnace Office just inside Office door, facing east \(90°\), level, 24 mm lens\. Interior of Furnace Office only\.$/);
assert.match(spec.views.bottom_right,/Opening “Office window” \(window, south wall\) shows Furnace as seen from here, looking south: match Image 1 for what shows through it\./);
assert.match(spec.views.subspace_rules.join(" "),/inside of every panel is Furnace Office only/);
assert.match(spec.views.subspace_rules.join(" "),/as seen from THIS panel's camera position/);
assert.match(spec.views.subspace_rules.join(" "),/Never reuse a composition from Furnace's plate as a backdrop/);
assert.doesNotMatch(JSON.stringify(spec),/Match the exact subspace already visible/);
assert.match(spec.location.identity_layers.visual_continuity.rule,/its panels are never views to copy/);
assert.match(spec.location.identity_layers.visual_continuity.rule,/never transplant sibling-room furnishings/);
assert.match(specOf(office).views.bottom_right,/match the reference image named for it/,"the shown prompt (before references) names no number");
// no match: unresolved, described from the layout, never a copied panel
metas.furnace=furnaceRecord({TL:{yaw:0,lensMm:24}});
spec=specOf(office);
assert.match(spec.views.bottom_right,/looks south into Furnace; no reference view faces that way yet \(unresolved\) — the shared layout puts Slag conveyor in that direction\. Keep what shows through it plausible and secondary; never fill it with a copied panel of Furnace\./);
// …and no whole sheet: ONE small panel of the parent's plate, for materials and colour only — optional (it can be unticked)
crops.length=0;
const mat=(await box.locationSubspacePlateReferences(office)).refs;
assert.equal(mat.length,1,"no matching quadrant: one material panel, never the sheet");
assert.equal(mat[0].required,false);assert.equal(mat[0].numbered,true);assert.equal(mat[0].maxDim,640);
assert.equal(mat[0].refId,"pm-furnace-br","the parent's requested 'signature material detail' close-up (bottom-right)");
assert.match(mat[0].label,/^Furnace · materials and colour only$/);
assert.match(mat[0].note,/ONE panel of its plate, small: materials and colour only\. It is NOT a view: never copy its composition, framing or layout into Furnace Office/);
deq(json(crops),[{url:"furnace-plate",rect:{x:50.5,y:50.5,w:49,h:49},max:640}]);
// an unreadable material panel is simply left out (nothing names it)
box.cropRegionAsDataUrl=async()=>"";
assert.equal((await box.locationSubspacePlateReferences(office)).refs.length,0);
box.cropRegionAsDataUrl=async(url,rect,max)=>{crops.push({url,rect,max});return "crop:"+url+":"+rect.x+","+rect.y;};
// owner prompt unchanged until its cameras are set
const genericViews={layout:"exactly 4 views in a 2x2 grid",
  top_left:"wide establishing front shot at eye level with symmetrical centered composition",
  top_right:"high-angle three-quarter overview shot from an elevated corner perspective looking down into the space showing depth and spatial layout",
  bottom_left:"close-up of the space's primary, most story-relevant feature",bottom_right:"close-up of a signature material detail of the space",
  rule:"each view a distinctly different camera angle and composition — the SAME identical space, consistent architecture, scale, materials and light across all views"};
deq(specOf(furnace).views,genericViews,"an owner without set cameras: the views are exactly as before");
// a crop that can't be read stops before anything is sent
metas.furnace=furnaceRecord({TR:{yaw:180,lensMm:18}});
box.cropRegionAsDataUrl=async()=>"";
await assert.rejects(box.locationSubspacePlateReferences(office),/Nothing was sent or charged/);
box.cropRegionAsDataUrl=async(url,rect)=>"crop:"+url+":"+rect.x+","+rect.y;

/* ---- setting an owner's cameras: stated, recorded, free text filled ---- */
let views=box.locationCoverageViewsWithPose(furnace,"TL",{yaw:0,pitch:0,lensMm:24,basis:"user"});
assert.equal(views.length,1,"the principal view is the top-left camera");
assert.equal(views[0].panel,"TL");assert.equal(views[0].pose.yaw,0);
assert.match(views[0].cameraPosition,/facing north \(0°\)/);assert.equal(views[0].lens,"24 mm");
const furnace2={...furnace,coverageViews:views};
views=box.locationCoverageViewsWithPose(furnace2,"TR",{yaw:180,pitch:-30,lensMm:18});
assert.equal(views.length,2);assert.equal(views[1].id,"panel-tr");assert.equal(views[1].autoPanel,true);
const furnace3={...furnace,coverageViews:views};
deq(box.locationPanelPoses(furnace3).map(p=>p.stated),[true,true,false,false]);
spec=specOf(furnace3);
assert.match(spec.views.top_left,/^wide establishing front shot.*\. Camera at the shared layout's standpoint, facing north \(0°\), level, 24 mm lens\.$/);
assert.match(spec.views.top_right,/facing south \(180°\), looking down 30°, 18 mm lens/);
assert.equal(spec.views.bottom_left,genericViews.bottom_left,"an unset panel keeps its old wording");
assert.match(spec.views.camera_convention,/north is the facing named in its frame/);
deq(Object.keys(box.locationPlatePanelRecord(furnace3).panels),["TL","TR"]);
// the user's own text is kept; back to the suggestion removes an auto-made view
const own={...furnace,coverageViews:[{id:"principal",name:"Main",cameraPosition:"By the loading door",target:"",lens:"",staging:{}}]};
assert.equal(box.locationCoverageViewsWithPose(own,"TL",{yaw:0})[0].cameraPosition,"By the loading door");
assert.equal(box.locationCoverageViewsWithPose(furnace3,"TR",null).length,1);
assert.equal(box.locationCoverageViewsWithPose(furnace3,"TL",null)[0].panel,undefined);

/* ---- 6. generation records the cameras; the room's references reach the provider ---- */
const generated=[],commits=[];
box.nbEpoch=()=>1;
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});return "rendered";};
box.nbCommit=async(id,url,meta,used)=>{commits.push({id,meta,used});return {tier:"local"};};
metas.furnace=furnaceRecord({TL:{yaw:0,lensMm:24},TR:{yaw:180,pitch:-30,lensMm:18,place:"on the mezzanine"}});
assert.equal(await box.generateLocationPlate(office,{}),true);
deq(Array.from(generated[0].opts.extraImages),["crop:furnace-plate:50.5,0.5"],"the cut-out panel alone — never the whole sheet");
deq(Array.from(generated[0].opts.extraImageMaxDims),[1536],"at its own size");
assert.equal(generated[0].opts.referencesNumbered,true);
assert.match(generated[0].prompt,/match Image 1 for what shows through it/);
assert.match(generated[0].prompt,/REFERENCE IMAGES \(binding\): Image 1 = Furnace seen facing south/);
assert.doesNotMatch(generated[0].prompt,/whole plate/);
deq(Object.keys(commits[0].meta.platePanels.panels),["TL","TR","BL","BR"],"the room's plate records the cameras its prompt stated");
assert.equal(commits[0].meta.platePanels.panels.BR.yaw,180);
assert.equal(box.locationPlateRefCount(office).n,1,"the price counts the cut-out view (and no whole sheet)");
generated.length=0;commits.length=0;
furnace.spatialPlan={...furnace.spatialPlan,status:"reviewed"};
assert.equal(await box.generateLocationPlate(furnace,{}),true);
assert.equal(commits[0].meta.platePanels,undefined,"an owner plate without set cameras records none (and its prompt is unchanged)");
generated.length=0;commits.length=0;
const owner3={...furnace3};box.turnContinuity={locations:[owner3,office],scenes:[],drafts:{}};
await box.generateLocationPlate(owner3,{});
deq(Object.keys(commits[0].meta.platePanels.panels),["TL","TR"]);
// the simplified retry states no cameras, so records none
generated.length=0;commits.length=0;let first=true;
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});if(first){first=false;throw Error("no image");}return "rendered";};
await box.generateLocationPlate(owner3,{});
assert.equal(generated.length,2);assert.equal(commits[0].meta.platePanels,undefined);
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});return "rendered";};
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};

/* ---- 6b. "Make a Furnace view from Furnace Office's position" ---- */
metas.furnace=furnaceRecord({TL:{yaw:0,lensMm:24}});
const req=box.locationParentViewRequest(office,"office-window");
assert.equal(req.assetId,"office-pview-office-window");
assert.equal(req.panel,"TR");assert.equal(req.targetId,"furnace");
assert.equal(req.pose.yaw,135);assert.ok(req.pose.lensMm>0);
assert.equal(box.locationParentViewRefCount(office,req),1,"one reference: the furnace plate (it is also the layout's plate)");
generated.length=0;commits.length=0;
assert.equal(await box.generateLocationParentView(office,req,{}),true);
assert.equal(generated.length,1,"one paid image");
assert.equal(generated[0].opts.assetId,"office-pview-office-window");
deq(Array.from(generated[0].opts.extraImages),["furnace-plate"]);
assert.match(generated[0].prompt,/^Render ONE single full-frame environment view of Furnace/);
assert.match(generated[0].prompt,/Show ONLY Furnace as it is seen from this position/);
assert.match(generated[0].prompt,/NOT a composition to copy/);
assert.doesNotMatch(generated[0].prompt,/Cross-read ALL panels/);
const vmeta=commits[0].meta;
assert.equal(vmeta.parentViewPose.yaw,135);assert.equal(vmeta.parentViewFor.openingId,"office-window");
assert.equal(vmeta.locationDependencyKind,"parent-view");
metas[req.assetId]={...vmeta,iso:"v1",locationParentIso:"f1"};images[req.assetId]="view-image";
plan=box.locationSubspacePanelPlan(office);
deq(plan.sources.map(s=>[s.kind,s.id]),[["view","office-pview-office-window"]],"the view made from here is used");
assert.equal(plan.unresolved.length,0);
const subV=await box.locationSubspacePlateReferences(office);
assert.equal(subV.refs[0].url,"view-image");assert.match(subV.refs[0].note,/from Furnace Office's position/);
assert.equal(subV.refs.length,1,"the made view alone");
metas.furnace={...metas.furnace,iso:"f2"};
assert.equal(box.locationSubspacePanelPlan(office).sources.length,0,"a view made from an older parent plate is not used");
metas.furnace.iso="f1";
// at most four views (three when the layout's plate is another space's) are attached
assert.equal(box.locationSubspacePanelPlan(office,null,null,{maxSources:0}).sources.length,0);

/* ---- 7. the Blender handoff ---- */
const cam=box.locationPoseToStudioCamera({position:[1,2,1.6],yaw:90,pitch:0,lensMm:35});
deq(json(cam),{position:[1,2,1.6],target:[6,2,1.6],focalLength:35,sensorWidth:36});
assert.doesNotThrow(()=>contract.validateCamera(json(cam)),"the studio contract accepts it");
assert.equal(box.locationPoseToStudioCamera({yaw:90}),null,"no position: no camera");
deq(json(box.locationPoseBlenderRotation({yaw:90,pitch:-10})),[1.3963,0,-1.5708],"rotation_euler XYZ in radians");
box.turnContinuity={locations:[coordFurnace,office],scenes:[],drafts:{}};
const pkg=box.locationProductionPlan(office,[]);
assert.equal(pkg.coordinates.schema,"cm-location-coords-v1");
assert.equal(pkg.coordinates.convention.units,"metres");
assert.equal(pkg.coordinates.cameras.length,4);
assert.ok(pkg.coordinates.cameras[0].studioCamera,"a positioned panel camera reaches Blender as a studio camera");
assert.doesNotThrow(()=>contract.validateCamera(json(pkg.coordinates.cameras[0].studioCamera)));
assert.equal(pkg.coordinates.spaces.length,2);
assert.ok(pkg.sharedSetLayout.coordinates&&pkg.sharedSetLayout.coordinates.convention,"the layout contract carries the numbers when it has them");
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};
assert.equal(box.locationSpatialContract(furnace).coordinates,undefined,"a layout without numbers sends none");
assert.ok(read("app/blender-studio.js").includes("coordinates:value.coordinates,"),"the compacted plan keeps the coordinates");

/* ---- the card wiring (source checks) ---- */
const ui=read("app/locations-ui.jsx"),art=read("app/artroom.jsx");
assert.match(ui,/try\{ sub=await locationSubspacePlateReferences\(l\); \}\n\s+catch\(e\)\{ if\(e&&typeof e==="object"\)e\.requiredReference=true; throw e; \}/,"a failure reading the parent's part never becomes a render without it");
assert.match(ui,/rebuildPromptAfterAttachments:\(attach,mode,gopts\)=> mode==="final"\n\s+\? combinedLocationPrompt\([^\n]*\n\s+\.\.\.\(masterSubPlan.current\?\{panelPlan:masterSubPlan.current,panelRefs:locationReferenceNumbers\(attach\)\}:\{\}\)/);
assert.match(ui,/mode==="final"&&masterPanelRecord.current\?\{platePanels:masterPanelRecord.current\}/);
assert.match(ui,/React.createElement\(LocationPlateCameras,\{l,project,onUpdate,readOnly/);
assert.match(art,/a && Number\(a.maxDim\)>0 \? Number\(a.maxDim\)/);
assert.match(art,/if\(attach.some\(a=>a && a.numbered\)\) genOpts.referencesNumbered = true;/);
console.log("PASS location coordinates: the model, old layouts unchanged, panel poses, quadrant geometry (facing + coverage, no match), crops and labels, per-panel prompts, recorded cameras, the made view and the Blender cameras");

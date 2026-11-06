/* Measurement repair proposals: explicit bounds/estimates, no saved-film or renderer calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const compiled=process.env.REPAIR_TEST_DIST==='1';let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;},clone=x=>JSON.parse(JSON.stringify(x));
const b={console,crypto,TextEncoder,nbGetMeta:()=>null,nbGetImage:()=>'',nbEpoch:()=>1,TURN_SUPABASE:{setBuild:true}};b.window=b;vm.createContext(b);
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-detail.js','blender-render.js','location-measurement-repair.js'])vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8'),b);
const base={id:'bus',key:'bus',name:'Bus test',spatialPlan:{status:'reviewed',source:{assetId:'bus',iso:''},heights:'centre',frame:'Front is north',anchors:[
 {id:'door',space:'Bus test',name:'Folding entry door',placement:'East wall',xy:[1.15,-3],basis:'design'},
 {id:'bench',space:'Bus test',name:'Bench',placement:'Rear',xy:[0,2],z:.3,size:[.5,.8,.6],basis:'design'}],coordinates:{origin:{anchorId:'door',note:'Preserve reference'},spaces:[{id:'bus',name:'Bus test',floorZ:0,ceilingH:1.95,footprint:[[-1.15,-5],[1.15,-5],[1.15,5],[-1.15,5]],openings:[
 {id:'door',name:'Folding entry door',kind:'door',edge:1,centre:[1.15,-3],width:.8,sillZ:-.6,headZ:1.8},
 {id:'empty',name:'',kind:'window',edge:null,centre:null,width:null,sillZ:null,headZ:null}]}]}},
 coverageViews:['TL','TR','BL','BR'].map((panel,i)=>({id:panel,panel,pose:{position:[i<2?-.6:.6,i%2?-3:3,1.6],yaw:i*90,pitch:0,lensMm:24,basis:'user'}}))};
function run(l){b.turnContinuity={locations:[l]};return b.KinolotMeasurementRepair.propose(l);}
const before=JSON.stringify(base),p=run(base),door=p.plan.coordinates.spaces[0].openings[0];
ok(door.sillZ===0&&door.headZ===1.8,'The below-floor bottom is corrected without moving an already valid top');
ok(p.changes.some(c=>c.field==='Opening bottom'&&c.before===-.6&&c.after===0),'The proposal records actual before/after numbers');
ok(p.plan.coordinates.spaces[0].openings.length===1&&p.changes.some(c=>c.field==='Empty placeholder'),'Only a wholly empty unnamed placeholder is proposed for removal');
ok(JSON.stringify(base)===before,'Generating the proposal does not mutate the input or save changes');
ok(JSON.stringify(p.plan.coordinates.origin)===JSON.stringify(base.spatialPlan.coordinates.origin),'Origin data is preserved');
ok(JSON.stringify(p.plan.anchors)===JSON.stringify(b.normalizeLocationSpatialPlan(base.spatialPlan).anchors),'Object locations and dimensions remain unchanged');
ok(JSON.stringify(b.locationPanelPoses({...base,spatialPlan:p.plan},[{...base,spatialPlan:p.plan}]).map(x=>x.pose))===JSON.stringify(b.locationPanelPoses(base,[base]).map(x=>x.pose)),'Proposed measurement repairs preserve all effective camera poses');
ok(p.plan.status==='draft'&&p.remaining.length===0,'Proposed corrections pass measurement checks but stay unconfirmed');
const reviewed={...base,spatialPlan:{...p.plan,status:'reviewed'}};b.turnContinuity.locations=[reviewed];
const scene=b.KinolotCloudRender.buildScene(reviewed);b.KinolotRenderContract.validateScene(scene);ok(Object.keys(scene.cameras).length===4,'The reviewed proposal produces the existing four-camera scene');
const missing=clone(base);missing.spatialPlan.coordinates.spaces[0].openings=[{id:'window',name:'Rear window',kind:'window',edge:0}];
let result=run(missing),window=result.plan.coordinates.spaces[0].openings.find(o=>o.id==='window');
ok(window.centre?.length===2&&window.width>0&&window.headZ>window.sillZ,'An identified wall can receive proposed centre, width and heights');
ok(window.basis==='design'&&result.changes.some(c=>/Estimated/.test(c.reason)),'Estimated values are explicitly marked proposed design');
const unknown=clone(base);unknown.spatialPlan.coordinates.spaces[0].openings=[{id:'u',name:'Unknown opening',kind:'window'}];unknown.spatialPlan.anchors=unknown.spatialPlan.anchors.filter(a=>a.id!=='door');
result=run(unknown);ok(result.unresolved.some(s=>s.includes('wall cannot be determined'))&&result.remaining.length>0,'An unknown wall is not invented or treated as repaired');
const namedId=clone(base);namedId.spatialPlan.coordinates.spaces[0].openings=[{id:'door',name:'',kind:'door'}];
result=run(namedId);ok(result.plan.coordinates.spaces[0].openings.length===1&&result.plan.coordinates.spaces[0].openings[0].name==='Folding entry door','An empty row linked to a real landmark ID is repaired, not proposed for removal');
const partial=clone(base);partial.spatialPlan.coordinates.spaces[0].openings=[{id:'u',name:'',kind:'window',centre:[1.15,0]}];
result=run(partial);ok(result.plan.coordinates.spaces[0].openings.some(o=>o.id==='u'),'A partially specified unnamed opening is retained');
const facing=clone(base);facing.spatialPlan.anchors[0].xy=undefined;facing.spatialPlan.anchors[0].facing=90;facing.spatialPlan.coordinates.spaces[0].openings=[facing.spatialPlan.coordinates.spaces[0].openings[1]];
result=run(facing);ok(result.plan.coordinates.spaces[0].openings[0].edge===1,'An explicitly stated outward facing identifies the matching wall rather than guessing a side');
const legacy=clone(base);delete legacy.spatialPlan.heights;const sp=legacy.spatialPlan.coordinates.spaces[0];sp.floorZ=4.4;sp.ceilingH=2.6;sp.openings=[{id:'door',name:'Folding entry door',kind:'door',edge:1,centre:[1.15,-3],width:.8,sillZ:.15,headZ:1.9}];
result=run(legacy);ok(result.changes.length===0&&result.plan.coordinates.spaces[0].openings[0].sillZ===.15,'Valid legacy room-relative heights are not lifted or rewritten by repairs');
const inverse=clone(base);inverse.spatialPlan.coordinates.spaces[0].openings[0].sillZ=1.8;inverse.spatialPlan.coordinates.spaces[0].openings[0].headZ=.5;
result=run(inverse);ok(result.plan.coordinates.spaces[0].openings[0].headZ>result.plan.coordinates.spaces[0].openings[0].sillZ,'An inverted opening receives an ordered proposed height interval');
console.log('PASS measurement repair: '+checks+' proposal, provenance, preservation, ambiguity, legacy and build checks');

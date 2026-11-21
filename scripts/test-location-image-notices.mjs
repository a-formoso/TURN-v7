/* Saved-image freshness reasons and actual notice actions; no browser, accounts or paid calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseSync} from '@babel/core';
const compiled=process.env.NOTICE_TEST_DIST==='1';let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;},J=x=>JSON.parse(JSON.stringify(x));
const routes=[],parents=[];
const b={console,React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)})},nbGetMeta:()=>null};b.window=b;vm.createContext(b);
for(const file of ['locations','locations-ui'])vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+file+(compiled?'.js':'.jsx'),'utf8'),b);
vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+'location-camera-history.js','utf8'),b);
b.goToLocationStep=(l,step)=>routes.push({id:l.id,step});
const base={id:'room',key:'room',name:'A deliberately long location name',architecture:'A simple room',
 spatialPlan:{status:'reviewed',source:{assetId:'room',iso:''},frame:'North',anchors:[{id:'bench',space:'A deliberately long location name',name:'Bench',placement:'Rear wall',xy:[0,3],z:0,size:[1,.5,.8]}],
 coordinates:{spaces:[{id:'room',name:'Room',footprint:[[-4,-5],[4,-5],[4,5],[-4,5]],floorZ:0,ceilingH:3,openings:[]}]}},
 coverageViews:['TL','TR','BL','BR'].map((panel,i)=>({id:'v'+i,panel,name:panel,pose:{position:[i<2?-2:2,i%2?-3:3,1.6],yaw:i*90,pitch:0,lensMm:24,basis:'user'}}))};
const live=l=>{b.turnContinuity={locations:[l]};return l;};live(base);
const meta={plateLayoutSig:b.locationPlateLayoutSig(base,{panels:true}),platePanels:b.locationPlatePanelRecord(base),locSpecSig:b.locationSpecSig(base)};
const before=JSON.stringify({base,meta});
const flat=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(flat)]:[];
const text=n=>n&&typeof n==='object'?(n.children||[]).map(text).join(''):n==null?'':String(n);
const notice=(l,m=meta)=>{live(l);return b.LocationImageChangeContent({l,meta:m,hasImage:true,onSelectLocation:id=>parents.push(id)});};
const reasons=l=>{live(l);return J(b.locationPlateChangeReasons(meta,l));};
ok(notice(base)===null,'A current image has no freshness notice');
ok(Object.values(reasons(base)).every(x=>!x),'Current inputs have no change reason');
const described={...base,architecture:'Same room, blue paint'};let tree=notice(described);
ok(text(tree).includes('1 · Description or look changed')&&!text(tree).includes('2 ·'),'Description-only edits name section 1 without blaming the floor plan');
flat(tree).find(n=>n.type==='button').props.onClick();ok(routes.at(-1).step===1,'Description notice opens Describe');
const moved={...base,spatialPlan:{...base.spatialPlan,anchors:base.spatialPlan.anchors.map(a=>({...a,placement:'Front wall',xy:[0,-3]}))}};
ok(reasons(moved).floorPlan&&!reasons(moved).cameras,'Object movement is attributed to Floor plan only');tree=notice(moved);
flat(tree).find(n=>n.type==='button').props.onClick();ok(routes.at(-1).step===2,'Floor-plan notice opens the repair editor');
const recam={...base,coverageViews:b.locationCoverageViewsWithPose(base,'TR',{...base.coverageViews[1].pose,yaw:135})};
ok(reasons(recam).cameras&&!reasons(recam).floorPlan,'A camera-only change is attributed to Cameras only');tree=notice(recam);
flat(tree).find(n=>n.type==='button').props.onClick();ok(routes.at(-1).step===3,'Camera notice opens Cameras');
ok(text(tree).includes('Cause not recorded')&&text(tree).includes('In this image:')&&text(tree).includes('Now:'),'The explanation shows image-versus-current settings and honest unknown provenance');
const recorded=b.KinolotCameraHistory.apply([base],base.id,{coverageViews:recam.coverageViews},{kind:'camera-edit'},'2026-11-06T12:00:00Z')[0];
ok(text(notice(recorded)).includes('Edited camera settings'),'The camera explanation renders a matched recorded action');
const both={...moved,coverageViews:recam.coverageViews};ok(reasons(both).floorPlan&&reasons(both).cameras,'Concurrent plan and camera edits retain both reasons');
ok(flat(notice(both)).filter(n=>n.type==='button').length===2,'Both affected sections are shown independently');
const reviewed={...base,spatialPlan:{...base.spatialPlan,status:'draft',source:{assetId:'room',iso:'new'}}};
ok(!reasons(reviewed).floorPlan&&!reasons(reviewed).cameras,'Approval and source stamps alone do not falsely mark geometry or cameras changed');
const nudge={...base,coverageViews:b.locationCoverageViewsWithPose(base,'TR',{...base.coverageViews[1].pose,yaw:90.1})};
ok(!reasons(nudge).cameras,'The existing half-degree camera tolerance is preserved');
const older={...meta};delete older.platePanels;tree=notice(moved,older);
ok(text(tree).includes('cannot be identified precisely')&&text(tree).includes('2 · Review floor plan')&&text(tree).includes('3 · Review cameras'),'Older ambiguous records are labelled honestly with both review routes');
ok(!text(tree).includes('Floor plan changed')&&!text(tree).includes('Cameras changed'),'An older combined fingerprint is not assigned a guessed cause');
ok(notice(moved,{iso:'old'})===null,'Images predating fingerprints do not acquire invented change reasons');
ok(b.LocationImageChangeContent({l:moved,meta,hasImage:false})===null,'A location with no image shows no image freshness notices');
const child={...base,parentLocation:{id:'parent',name:'Parent'}};b.nbGetMeta=id=>id==='parent'?{iso:'new'}:null;
tree=notice(child,{locationParentId:'parent',locationParentIso:'old'});ok(text(tree).includes('Parent location image updated'),'Parent reference changes are named separately from section-2 geometry');
flat(tree).find(n=>n.type==='button').props.onClick();ok(parents.at(-1)==='parent','The parent notice opens its parent location');
ok(JSON.stringify({base,meta})===before,'Opening notices and navigating never change film inputs or image metadata');
// Only the compact trigger belongs in the heading; long content floats outside card flow.
const source=readFileSync('app/locations-ui.jsx','utf8'),ast=parseSync(source,{sourceType:'script',parserOpts:{plugins:['jsx']},babelrc:false,configFile:false});
function find(n,p){if(!n||typeof n!=='object')return null;if(p(n))return n;for(const v of Object.values(n)){if(Array.isArray(v)){for(const x of v){const r=find(x,p);if(r)return r;}}else if(v&&typeof v==='object'){const r=find(v,p);if(r)return r;}}return null;}
const isElement=n=>n.type==='CallExpression'&&n.callee.property?.name==='createElement';
const cls=n=>n.arguments?.[1]?.properties?.find(p=>p.key?.name==='className')?.value?.value;
const sheet=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='LocationSheet');
const body=find(sheet,n=>isElement(n)&&cls(n)==='sheet-body');
ok(!body.arguments.slice(2).some(n=>isElement(n)&&n.arguments[0]?.name==='LocationImageChangeNotices'),'Freshness messages no longer add a row above the step guide');
// the heading is made as a part of its own since the picture-first card (2026-11-21)
const heading=find(sheet,n=>isElement(n)&&cls(n)==='sheet-head');
ok(!!find(heading,n=>isElement(n)&&n.arguments[0]?.name==='LocationImageChangeNotices'),'The heading contains only the compact help trigger');
console.log('PASS image notices: '+checks+' attribution, legacy, tolerance, navigation and heading checks');

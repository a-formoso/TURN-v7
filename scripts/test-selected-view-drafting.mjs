/* Selected-camera drafting with the real prompt, data helpers and App handler. Disposable identities only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseSync} from '@babel/core';
const b={console,window:null,nbGetImage:()=>'',nbGetMeta:()=>null,nbEpoch:()=>1,scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
const compiled=process.env.SELECTED_TEST_DIST==='1';
vm.runInContext(readFileSync(compiled?'dist/app/locations.js':'app/locations.jsx','utf8'),b);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const room={id:'room',key:'room',name:'Gym',staging:{bg:{center:'Original main'}},coverageViews:['TL','TR','BL','BR'].map((panel,i)=>({id:'v'+i,name:panel+' view',panel,
  pose:{position:[1+i,1,1.6],yaw:i*90,pitch:-5,lensMm:24,basis:'user'},staging:{viewLabel:panel+' view',bg:{center:'Original '+panel}}})),
  spatialPlan:{status:'reviewed',source:{assetId:'room',iso:''},frame:'North',anchors:[{id:'net',space:'Gym',name:'Net',placement:'Centre',xy:[4,4],z:1,size:[4,.1,2]}],
    coordinates:{spaces:[{id:'room',name:'Gym',floorZ:0,ceilingH:4,footprint:[[0,0],[10,0],[10,10],[0,10]],openings:[]}]}}};
b.turnContinuity={locations:[structuredClone(room)]};
const ai=readFileSync(compiled?'dist/app/ai.js':'app/ai.jsx','utf8'),ast=parseSync(ai,{sourceType:'script',parserOpts:{plugins:['jsx']},babelrc:false,configFile:false});
const fn=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='aiDraftStaging');
let prompt='',paid=0;
Object.assign(b,{aiAvailable:()=>true,writingProjectOf:p=>p,genreTag:()=>'',extractJSON:JSON.parse,clipWords:s=>s,scrubBrand:String,writingStamp:()=>({}),
  claude:{complete:async({messages})=>{paid++;prompt=messages[0].content;return JSON.stringify({viewLabel:'Wrong AI label',lens:'85 mm',bgCenter:'Far wall',floor:'Wood'});}}});
vm.runInContext(ai.slice(fn.start,fn.end),b);
for(let i=0;i<4;i++){
 const l=structuredClone(room);b.turnContinuity.locations=[l];
 const draft=await b.aiDraftStaging(l,[],{},{throwErrors:true,viewId:'v'+i});
 ok(prompt.includes('THE SELECTED VIEW TO STAGE')&&prompt.includes('"panel":"'+l.coverageViews[i].panel+'"'),'Prompt targets the selected panel');
 ok(prompt.includes('"position":['+(1+i)+',1,1.6]'),'Prompt contains this camera’s measured position');
 ok(draft.viewLabel===l.coverageViews[i].name&&draft.lens==='24 mm','Saved name and lens override conflicting generated values');
 const updated=b.locationWithViewComposition(l,draft,'v'+i);
 ok(updated.coverageViews[i].staging.bg.center==='Far wall','Selected view receives drafted notes');
 ok(b.locationCoverageViews(updated)[i].staging.cameraSig===draft.cameraSig,'The saved camera stamp survives reloading the view projection');
 ok(updated.coverageViews.every((v,j)=>j===i||v.staging.bg.center===room.coverageViews[j].staging.bg.center),'Other views retain their notes');
 ok(i===0?updated.staging.bg.center==='Far wall':updated.staging.bg.center==='Original main','Only a main-view draft updates the legacy main composition');
 ok(JSON.stringify(l)===JSON.stringify(room),'Drafting and preparing the update never mutate the source');
}
const blank=structuredClone(room);blank.coverageViews.push({id:'extra',name:'Extra',staging:{}});b.turnContinuity.locations=[blank];
const count=paid;await assert.rejects(()=>b.aiDraftStaging(blank,[],{},{throwErrors:true,viewId:'extra'}),/Set a camera position/);checks++;
ok(paid===count,'An extra view without a viewpoint is refused before a model call');
const legacy=structuredClone(room);delete legacy.coverageViews;delete legacy.spatialPlan.coordinates;b.turnContinuity.locations=[legacy];
const legacyDraft=await b.aiDraftStaging(legacy,[],{},{throwErrors:true,viewId:'principal'});
ok(legacyDraft.bg.center==='Far wall','A main view with a relational layout still supports the existing image-only workflow');

// Evaluate the actual App closure with controlled live state, confirmations and deferred responses.
const app=readFileSync('app/app.jsx','utf8'),start=app.indexOf('const draftLocationStaging = async'),end=app.indexOf('/* SUB-SPACE CLEANUP',start);
const handler=app.slice(start,end).replace('const draftLocationStaging','var draftLocationStaging');
function setup(){
 let locations=[structuredClone(room)],allowed=true,calls=0,resolve,confirms=[],toasts=[];
 b.locationsRef={current:locations};b.projIdRef={current:'film'};b.draftingStageId=null;b.scenes=[];b.project={};
 b.canMutateSharedFilm=()=>allowed;b.setDraftingStageId=id=>b.draftingStageId=id;
 b.setLocations=fn=>{locations=fn(locations);b.locationsRef.current=locations;b.turnContinuity.locations=locations;};
 b.turnContinuity.locations=locations;b.appToast=m=>toasts.push(m);b.agentErrText=e=>e.message;
 b.appConfirm=async()=>confirms.length?confirms.shift():true;
 b.aiDraftStaging=async(l,s,p,o)=>{calls++;ok(o.viewId==='v1','App sends the selected view identity');return await new Promise(r=>resolve=r);};
 vm.runInContext(handler,b);
 return {get l(){return locations[0];},change:fn=>{locations=fn(locations);b.locationsRef.current=locations;b.turnContinuity.locations=locations;},
   done:()=>{if(!resolve)throw Error(JSON.stringify({calls,toasts,block:b.locationStagingDraftBlock(locations[0])}));return resolve({viewLabel:'TR view',bg:{center:'New right view'}});},deny:()=>allowed=false,calls:()=>calls,confirms,toasts};
}
{
 const h=setup(),run=b.draftLocationStaging(h.l,'v1');await new Promise(setImmediate);h.done();await run;
 ok(h.l.coverageViews[1].staging.bg.center==='New right view','The real App handler saves to the selected view');
 ok(h.l.coverageViews[0].staging.bg.center==='Original TL'&&h.l.staging.bg.center==='Original main','Drafting TR does not replace TL or legacy main notes');
}
{
 const h=setup(),run=b.draftLocationStaging(h.l,'v1');await new Promise(setImmediate);
 h.change(ls=>ls.map(l=>({...l,coverageViews:l.coverageViews.map(v=>v.id==='v1'?{...v,pose:{...v.pose,yaw:45}}:v)})));
 h.done();await run;ok(h.l.coverageViews[1].staging.bg.center==='Original TR','A camera change during drafting prevents stale application');
 ok(h.toasts.some(t=>t.includes('camera or floor plan changed')),'The changed-camera failure is explained');
}
{
 const h=setup(),run=b.draftLocationStaging(h.l,'v1');await new Promise(setImmediate);
 h.change(ls=>ls.map(l=>({...l,coverageViews:l.coverageViews.filter(v=>v.id!=='v1')})));h.done();await run;
 ok(h.l.coverageViews.length===3,'A deleted view is never recreated by an old draft');
}
{
 const h=setup(),run=b.draftLocationStaging(h.l,'v1');await new Promise(setImmediate);h.deny();h.done();await run;
 ok(h.l.coverageViews[1].staging.bg.center==='Original TR','Revoked edit access prevents application');
}
{
 const h=setup(),run=b.draftLocationStaging(h.l,'v1');await new Promise(setImmediate);b.projIdRef.current='another-film';h.done();await run;
 ok(h.l.coverageViews[1].staging.bg.center==='Original TR','A film switch prevents cross-film application');
}
console.log('PASS selected-view drafting: '+checks+' prompt, selected persistence, unchanged siblings and race/access checks');

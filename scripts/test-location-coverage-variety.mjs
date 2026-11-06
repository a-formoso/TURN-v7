/* Exercise real prompt assembly: varied coverage must never replace saved poses or room roles. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const compiled=process.env.COVERAGE_TEST_DIST==='1';
const b={console,nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};
b.window=b;vm.createContext(b);
vm.runInContext(readFileSync(compiled?'dist/app/locations.js':'app/locations.jsx','utf8'),b);
const room={id:'room',key:'room',name:'Workshop',intExt:'INT',architecture:'A workshop with a rear door and a workbench.',
  staging:{bg:{center:'Rear door'},mid:{left:'Workbench'}},scenes:[]};
b.turnContinuity={locations:[room],scenes:[],drafts:{},props:[],characters:[],sluglineUnits:[]};
const spec=l=>JSON.parse(b.buildLocationRefPrompt(l,{}).split('\n').slice(1).join('\n'));
let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const before=JSON.stringify(room),free=spec(room);
ok(free.views.frame_format.includes('Overall sheet aspect ratio 16:9')&&free.views.frame_format.includes('four equal 16:9 camera frames'),'Default format applies to both sheet and extracted panels');
b.nbGetAspect=()=> '2:1';
ok(spec(room).views.frame_format.includes('four equal 2:1 camera frames'),'An explicitly selected alternative format is respected');
ok(b.buildLocationFromPhotoPrompt(room,{}).includes('Overall sheet aspect ratio 2:1'),'Photo-led location generation keeps the selected format too');
delete b.nbGetAspect;
ok(free.views.top_right.includes('opposite end or reverse direction'),'Free overview seeks a complementary viewpoint');
ok(free.views.bottom_left.includes('Rear door')&&free.views.bottom_left.includes('tightly'),'Landmark close-up names the real feature and asks for inspection framing');
ok(free.views.bottom_right.includes('Workbench')&&free.views.bottom_right.includes('not a repeat'),'Detail view uses the other real station');
ok(!JSON.stringify(free).includes('School BUS'),'Coverage is shared across locations without bus-specific furniture');
ok(JSON.stringify(room)===before,'Prompt assembly does not edit the location');
const pose={position:[1,2,1.6],yaw:71,pitch:-6,lensMm:35,basis:'user'};
const saved={...room,coverageViews:b.locationCoverageViewsWithPose(room,'TR',pose)};
b.turnContinuity.locations=[saved];
const savedBefore=JSON.stringify(saved),fixed=spec(saved);
ok(fixed.views.top_right.includes('facing east (71°)')&&fixed.views.top_right.includes('35 mm lens'),'Exact saved direction and lens still reach the prompt');
ok(fixed.views.coverage_guidance.some(s=>s.includes('take priority over generic shot descriptions')),'Saved poses explicitly outrank the desired variety');
ok(JSON.stringify(saved)===savedBefore,'Variety guidance never writes or replaces a saved pose');
// Mixed interior/exterior and room-specific plans keep their own panel allocation.
b.locationMasterPanelPlan=()=>({layout:'exactly 4 views in a 2x2 grid',top_left:'Outside forecourt',top_right:'Inside workshop',bottom_left:'Threshold detail',bottom_right:'Inside workbench'});
const mixed=spec(saved);
ok(mixed.views.top_left==='Outside forecourt'&&mixed.views.bottom_left==='Threshold detail','Existing per-room coverage roles are preserved');
ok(mixed.views.coverage_guidance.some(s=>s.includes('without a fixed camera or room-specific coverage plan')),'Default roles are conditional on there being no room-specific plan');
console.log('PASS location coverage variety: '+checks+' prompt assembly, camera priority and no-mutation checks'+(compiled?' (compiled)':''));

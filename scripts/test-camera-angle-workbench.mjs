/* Real workbench handlers with disposable film data and a controlled graphics adapter. No browser or service calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync,parseSync} from '@babel/core';
const compiled=process.env.ANGLE_UI_TEST_DIST==='1';let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
function harness({pending=false,failed=false,mode="gpu",suggested=false,gpuFailure=false,detailed=false,picked={kind:'object',name:'Bench',description:'Saved set object',dimensions:[1,1,1]}}={}){
 let hooks=[],cursor=0,effects=[],writes=[],renders=[],inspections=[],disposed=0,epoch=1,writable=true;
 let location={id:'gym',key:'gym',name:'Gym',coverageViews:['TL','TR','BL','BR'].map((panel,i)=>({id:'v'+i,name:panel,panel,staging:{bg:{center:'Notes '+panel}},
   pose:{position:[[-4,-4,1.6],[4,-4,2.3],[-4,4,1.6],[4,4,1.6]][i],yaw:[35,325,145,215][i],pitch:0,lensMm:24,basis:'user'}})),
   spatialPlan:{status:'reviewed',heights:'centre',source:{assetId:'gym',iso:''},frame:'North',anchors:[{id:'bench',space:'Gym',name:'Bench',placement:'Back wall',xy:[-3,2],z:.5,size:[1,1,1]}],
     coordinates:{spaces:[{id:'gym',name:'Gym',floorZ:0,ceilingH:4,footprint:[[-5,-5],[5,-5],[5,5],[-5,5]],openings:[]}]}}};
 const b={console,crypto,TextEncoder,URL,structuredClone,location:{hostname:'localhost'},TURN_SUPABASE:{setBuild:true,setBuildMcp:detailed},turnIsAdmin:true,nbEpoch:()=>epoch,
   nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[],turnArtRoomWritable:()=>writable};b.window=b;vm.createContext(b);
 for(const f of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js'])
   vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8'),b);
 b.turnContinuity={locations:[location]};
 const proposal=suggested?b.KinolotCloudRender.proposeCameras(location,[location]):null;
 b.KinolotCloudRender.request=()=>assert.fail('Layout previews must not submit worker jobs');
 b.nbGenerate=()=>assert.fail('Layout previews must not invoke an image engine');
 b.KinolotAnglePreview={load:()=>pending?new Promise(()=>{}):failed?Promise.reject(Error('GPU unavailable')):Promise.resolve({}),
   imagePoint:(_canvas,x,y)=>({x:x/640,y:y/360}),
   create:(T,spec,options)=>{
     if(gpuFailure&&!options?.softwareOnly)throw Error("GPU unavailable");
     return {mode:options?.softwareOnly?"software":mode,render:(canvas,pose)=>renders.push(structuredClone(pose)),
       inspect:(pose,x,y)=>{inspections.push({pose:structuredClone(pose),x,y});return structuredClone(picked);},dispose:()=>disposed++};}};
 b.LocationFloorPlanMap=function(){};
 b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),
   useState:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,v=>hooks[i].value=typeof v==='function'?v(hooks[i].value):v];},
   useRef:value=>{const i=cursor++;return hooks[i]||(hooks[i]={current:value});},
   useEffect:(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,k)=>v!==old.deps[k]))effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});hooks[i]={deps,cleanup:old?.cleanup};}};
 const ui=readFileSync(compiled?'dist/app/camera-angle-preview-ui.js':'app/camera-angle-preview-ui.jsx','utf8');
 vm.runInContext(compiled?ui:transformSync(ui,{presets:['@babel/preset-react'],babelrc:false,configFile:false}).code,b);
 const flat=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flatMap(flat)];
 const text=n=>n==null?'':typeof n==='object'?(n.children||[]).map(text).join(''):String(n);
 let readonly=false;
 const onUpdate=(id,patch)=>{writes.push({id,patch:structuredClone(patch)});location={...location,...patch};b.turnContinuity.locations=[location];};
 function render(flush=true){
   cursor=0;effects=[];const tree=suggested?b.LocationSuggestedCameraPreviews({l:location,proposal,locations:b.turnContinuity.locations})
     :b.LocationCameraAngleWorkbench({l:location,onUpdate,readOnly:readonly});
   for(const n of flat(tree))if(n.props.ref){
     const element=n.type==='dialog'?{open:false,showModal(){this.open=true;}}:{getContext:()=>({drawImage(){}})};
     typeof n.props.ref==='function'?n.props.ref(element):n.props.ref.current=element;
   }
   if(flush)effects.splice(0).forEach(f=>f());return tree;
 }
 const button=(tree,label)=>flat(tree).find(n=>n.type==='button'&&text(n)===label);
 async function begin(){let tree=render();button(tree,'Preview & choose camera angles').props.onClick();tree=render();await new Promise(setImmediate);return render();}
 return {b,render,begin,flat,text,button,writes,renders,inspections,proposal,get location(){return location;},get disposed(){return disposed;},
   external:fn=>{location=fn(location);b.turnContinuity.locations=[location];},switchFilm:()=>epoch++,readonly:()=>{readonly=true;writable=false;}};
}
{
 const h=harness({suggested:true,detailed:true}),before=JSON.stringify(h.location);let tree=h.render();
 await new Promise(setImmediate);tree=h.render();
 ok(h.renders.length===4,'A suggestion draws four free 3D camera thumbnails');
 ok(h.proposal.panels.every((p,i)=>JSON.stringify(p.pose.position)===JSON.stringify(h.renders[i].position)&&p.pose.yaw===h.renders[i].yaw),
   'Thumbnails render the proposed cameras at their saved precision rather than the previously saved cameras');
 ok(h.flat(tree).filter(n=>n.type==='canvas').length===4&&h.text(tree).includes('Proposed 3D views'),'The four proposed views are labelled before camera acceptance');
 ok(h.writes.length===0&&JSON.stringify(h.location)===before,'Rendering suggested thumbnails never saves or submits a job');
 h.external(l=>({...l,spatialPlan:{...l.spatialPlan,frame:'Changed frame'}}));h.render();await new Promise(setImmediate);tree=h.render();
 ok(h.disposed===1&&h.renders.length===4&&h.text(tree).includes('changed'),'A stale suggestion releases its graphics adapter and cannot display a new preview');
}
{
 const h=harness({suggested:true,gpuFailure:true}),before=JSON.stringify(h.location);h.render();await new Promise(setImmediate);const tree=h.render();
 ok(h.renders.length===4&&!h.text(tree).includes('could not be displayed')&&JSON.stringify(h.location)===before,
   'Suggested thumbnails automatically fall back to compatibility rendering without writes');
}
{
 const h=harness({suggested:true,failed:true});h.render();await new Promise(setImmediate);const tree=h.render();
 ok(h.text(tree).includes('could not be displayed')&&h.button(tree,'Retry 3D previews')&&h.writes.length===0,
   'Failed suggestion graphics offer a free retry and preserve saved cameras');
}
{
 const h=harness();let tree=await h.begin();
 let canvas=h.flat(tree).find(n=>n.type==='canvas'&&n.props.role==='button');
 canvas.props.onClick({currentTarget:{},clientX:160,clientY:180});tree=h.render();
 ok(h.text(tree).includes('Candidate angle · Bench')&&h.text(tree).includes('Preview dimensions: 1 × 1 × 1 m'),'A preview click reports its object name and correctly labelled dimensions');
 ok(h.inspections[0].x===.25&&h.inspections[0].y===.5&&h.writes.length===0,'Inspection uses the clicked image position without saving or submitting a job');
 let prevented=0;canvas.props.onKeyDown({key:'Enter',preventDefault:()=>prevented++});
 ok(prevented===1&&h.inspections.at(-1).x===.5,'Keyboard users can identify the centre of the candidate view');
 h.flat(tree).find(n=>n.type==='button'&&n.props['aria-pressed']!==undefined&&h.text(n).startsWith('Bottom right')).props.onClick({detail:0});tree=h.render();
 ok(h.text(tree).includes('Bottom right · Bench')&&h.inspections.at(-1).pose.yaw===215&&h.writes.length===0,'Keyboard panel activation inspects its own centre and selects a destination without saving');
 const thumb=h.flat(tree).find(n=>n.type==='canvas'&&n.props['aria-label']==='Bottom left saved camera layout preview');
 thumb.props.onClick({currentTarget:{},clientX:320,clientY:180});tree=h.render();
 ok(h.text(tree).includes('Bottom left · Bench')&&h.inspections.at(-1).pose.yaw===145,'Saved-view inspection uses that panel’s camera and labels the result with that view');
 h.flat(tree).find(n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'-2'}});h.render();tree=h.render();
 ok(!h.text(tree).includes('Bottom left · Bench')&&h.writes.length===0,'Changing the candidate clears stale inspection details');
}
{
 const h=harness({picked:{kind:'opening',name:'Folding entry door',type:'door',room:'School Bus',dimensions:[.8,1.8],beyond:'Outside not modelled'}});let tree=await h.begin();
 h.flat(tree).find(n=>n.type==='canvas'&&n.props.role==='button').props.onClick({currentTarget:{},clientX:320,clientY:180});tree=h.render();
 ok(h.text(tree).includes('Folding entry door')&&h.text(tree).includes('Saved door in School Bus')&&h.text(tree).includes('Outside not modelled'),'Opening inspection names the saved opening and distinguishes unmodelled surroundings');
}
{
 const h=harness();let tree=await h.begin();
 const select=h.flat(tree).find(n=>n.type==='select');select.props.onChange({target:{value:'BL'}});tree=h.render();
 ok(h.renders.at(-1).position.every((v,i)=>v===h.location.coverageViews.find(v=>v.panel==='BL').pose.position[i]),'Starting from Bottom left loads that saved camera into the candidate');
 ok(h.flat(tree).find(n=>n.type==='button'&&n.props['aria-pressed']).children.some(n=>typeof n==='object'&&h.text(n).startsWith('Top right')),'Starting camera and replacement destination remain distinct choices');
 ok(h.text(tree).includes('Candidate angle · from Bottom left')&&h.text(tree).includes('Destination: Top right.'),'The preview identifies its source camera and save destination separately');
 const before=h.renders.at(-1);h.flat(tree).find(n=>n.type==='button'&&n.props['aria-pressed']===false&&h.text(n).startsWith('Bottom right')).props.onClick();tree=h.render();
 ok(h.button(tree,'Use this angle in Bottom right')&&JSON.stringify(h.renders.at(-1))===JSON.stringify(before)&&h.writes.length===0,'Choosing a replacement panel changes the destination without moving or saving the candidate');
}
{
 const h=harness(),before=JSON.stringify(h.location);let tree=await h.begin();
 ok(h.writes.length===0&&JSON.stringify(h.location)===before,'Opening and drawing a candidate never saves film data');
 ok(h.renders.length>=5,'Candidate and all four current panel angles are rendered');
 const destination=h.flat(tree).filter(n=>n.type==='button'&&n.props['aria-pressed']!==undefined);
 ok(destination.length===4&&destination.filter(n=>n.props['aria-pressed']).length===1,'Exactly one of four destination panels is highlighted');
 const across=h.flat(tree).find(n=>n.type==='input'&&n.props.type==='range');across.props.onChange({target:{value:'-2'}});tree=h.render();
 ok(h.renders.at(-1).position[0]===-2&&h.writes.length===0,'Moving the camera redraws its preview without saving');
 h.button(tree,'Save extra camera').props.onClick();tree=h.render();
 const extra=h.location.coverageViews.find(v=>!v.panel);ok(extra?.pose.position[0]===-2,'Save extra camera stores a measured pose');
 ok(h.location.coverageViews.filter(v=>v.panel).every(v=>v.pose.position[0]===([0,2].includes(Number(v.id.slice(1)))?-4:4)),'Saving an extra camera leaves all four panel cameras intact');
 const otherBefore=JSON.stringify(h.location.coverageViews.filter(v=>v.panel&&v.panel!=='TR'));
 h.button(tree,'Use this angle in Top right').props.onClick();tree=h.render();
 ok(h.location.coverageViews.find(v=>v.panel==='TR').pose.position[0]===-2,'Explicit assignment updates the named destination panel');
 ok(JSON.stringify(h.location.coverageViews.filter(v=>v.panel&&v.panel!=='TR'))===otherBefore,'The other three panel cameras are preserved');
 ok(h.writes.length===2,'Previewing and moving remain free of writes; only save and assign write');
 ok(h.disposed===1,'Closing after assignment disposes the graphics adapter');
}
{
 const h=harness();let tree=await h.begin();h.flat(tree).find(n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'-2'}});tree=h.render();
 h.button(tree,'Discard changes').props.onClick();h.render();ok(h.writes.length===0&&h.disposed===1,'Discarding preserves data and frees graphics resources');
}
{
 const h=harness();let tree=await h.begin();h.external(l=>({...l,spatialPlan:{...l.spatialPlan,frame:'Changed frame'}}));tree=h.render();
 h.button(tree,'Use this angle in Top right').props.onClick();tree=h.render();
 ok(h.writes.length===0&&h.text(tree).includes('changed'),'A changed saved scene blocks stale assignment');
}
{
 const h=harness();let tree=await h.begin();h.switchFilm();h.button(tree,'Use this angle in Top right').props.onClick();
 ok(h.writes.length===0,'A film-epoch switch blocks an old handler');
}
{
 const h=harness();let tree=await h.begin();h.readonly();tree=h.render();
 ok(h.button(tree,'Use this angle in Top right').props.disabled,'Read-only users may inspect but not assign');
 h.button(tree,'Use this angle in Top right').props.onClick();h.button(tree,'Save extra camera').props.onClick();ok(h.writes.length===0,'Read-only handlers also fence direct calls');
}
{
 const h=harness({pending:true});let tree=await h.begin();
 ok(h.button(tree,'Use this angle in Top right').props.disabled,'Assignment waits for an actual preview');
 h.button(tree,'Use this angle in Top right').props.onClick();ok(h.writes.length===0,'An unseen candidate cannot be assigned');
}
{
 const h=harness({failed:true});const tree=await h.begin();
 ok(h.text(tree).includes("Loading preview files: GPU unavailable")&&h.button(tree,'Save extra camera').props.disabled,'Loading failures show their stage and leave saving disabled');
 ok(!!h.button(tree,'Retry preview'),'A display error offers an explicit retry');
}
{
 const h=harness();let tree=await h.begin();
 h.flat(tree).find(n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'-2'}});tree=h.render(false);
 h.button(tree,'Use this angle in Top right').props.onClick();
 ok(h.writes.length===0,'A changed pose cannot be accepted until that exact frame has been drawn');
}
{
 const h=harness();let tree=await h.begin();
 h.flat(tree).find(n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'-5'}});tree=h.render();
 ok(h.button(tree,'Use this angle in Top right').props.disabled,'An angle inside a wall or outside its clear footprint cannot be assigned');
 h.button(tree,'Use this angle in Top right').props.onClick();ok(h.writes.length===0,'Position validity is also checked in the assignment handler');
}
{
 const h=harness();let tree=await h.begin();h.button(tree,'Views blank? Use compatibility preview').props.onClick();tree=h.render();await new Promise(setImmediate);tree=h.render();
 ok(h.text(tree).includes('Using a compatibility preview')&&h.writes.length===0,'Manual compatibility mode redraws without changing saved cameras');
}
{
 const h=harness({mode:'software'}),tree=await h.begin();
 ok(h.text(tree).includes('Using a compatibility preview')&&!h.button(tree,'Save extra camera').props.disabled,'A successfully drawn compatibility preview is labelled and can be saved');
}
{
 const h=harness();let tree=await h.begin();
 h.external(l=>({...l,coverageViews:l.coverageViews.map(v=>v.id==='v0'?{...v,staging:{bg:{center:'Concurrent note edit'}}}:v)}));tree=h.render();
 h.button(tree,'Save extra camera').props.onClick();
 ok(h.location.coverageViews[0].staging.bg.center==='Concurrent note edit','Saving an extra angle preserves concurrent changes to unrelated notes');
 const extra=h.location.coverageViews.find(v=>!v.panel);h.external(l=>({...l,coverageViews:l.coverageViews.filter(v=>v.id!==extra.id)}));tree=h.render();
 h.button(tree,'Save extra camera changes').props.onClick();
 ok(h.writes.length===1,'An extra camera deleted while its editor is open is not recreated by an old save');
}
// Both marketing surfaces call the same feature helper, including saved-copy overrides.
{
 const source=readFileSync('app/plans.jsx','utf8'),ast=parseSync(source,{sourceType:'script',parserOpts:{plugins:['jsx']},babelrc:false,configFile:false});
 const statement=ast.program.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.property?.name==='turnPlanCardFeatures');
 const b={PLAN_TEAM_LINES:{},TURN_SUPABASE:{setBuild:true},KinolotAnglePreview:{}};b.window=b;vm.createContext(b);vm.runInContext(source.slice(statement.start,statement.end),b);
 for(const tier of ['director','studio'])ok(b.turnPlanCardFeatures({tier,features:[]},['Custom copy']).includes('Cloud sets, camera-angle previews and image styling'),'Director and Producer cards include the feature after custom copy');
 ok(!b.turnPlanCardFeatures({tier:'writer',features:[]}).some(s=>s.includes('camera-angle previews')),'Writer card excludes cloud camera features');
 const old=['Custom copy'];b.turnPlanCardFeatures({tier:'director'},old);ok(old.length===1,'The helper never edits saved admin copy');
 const once=b.turnPlanCardFeatures({tier:'director'},old),twice=b.turnPlanCardFeatures({tier:'director'},once);
 ok(twice.filter(s=>s.includes('camera-angle previews')).length===1,'Shared marketing copy is not duplicated');
 b.TURN_SUPABASE.setBuild=false;ok(!b.turnPlanCardFeatures({tier:'studio',features:[]}).length,'Cloud feature copy follows the app release switch');
 ok(readFileSync('app/landing.jsx','utf8').includes('window.turnPlanCardFeatures(p)'),'Homepage uses this same feature helper');
}
console.log('PASS camera workbench: '+checks+' preview, assignment, extra-camera, stale/access, disposal and plan-card checks');

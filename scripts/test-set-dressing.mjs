/* Set dressing (trial, 2026-11-15): what the writing engine writes is data, checked against the built set.
   No account, network or model call. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const b={console,crypto,TextEncoder,URL};b.window=b;vm.createContext(b);
for(const f of ['blender-render-contract.js','set-dressing.js'])vm.runInContext(readFileSync('app/'+f,'utf8'),b);
const D=b.KinolotSetDressing,C=b.KinolotRenderContract,copy=x=>JSON.parse(JSON.stringify(x));
const square=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
const scene=()=>({schema:C.MCP_SCHEMA,authoring:'mcp-procedural-v1',name:'Test hall',units:'metres',axes:'+Z up; +Y north; +X east',status:'development blockout',notes:[],
  objects:[
    {id:'floor-0',name:'Hall floor',position:[2,2,-.075],size:[4,4,.15],rotation:[0,0,0],kind:'prism',material:'floor',footprint:square},
    {id:'wall-0-0-1-1',name:'Hall wall',position:[2,0,1.2],size:[4,.15,2.4],rotation:[0,0,0],kind:'box',material:'wall'},
    {id:'ceiling-0',name:'Hall ceiling',position:[2,2,2.475],size:[4,4,.15],rotation:[0,0,0],kind:'prism',material:'wall',footprint:square},
    // a plain floor-plan block facing east (90): its width runs north-south
    {id:'anchor-0',name:'Radiator',anchorId:'radiator',basis:'design',position:[.2,2,.55],size:[1,.12,.6],rotation:[0,0,-Math.PI/2],kind:'box',material:'dressing'},
    // already given a shape by the builder: two parts under one object
    {id:'bed-a',name:'Bed · mattress',anchorId:'bed',position:[3,3,.3],size:[1,2,.3],rotation:[0,0,0],kind:'box',material:'dressing'},
    {id:'bed-b',name:'Bed · headboard',anchorId:'bed',position:[3,3.9,.6],size:[1,.1,.9],rotation:[0,0,0],kind:'box',material:'dressing'}],
  cameras:{TL:{position:[.5,.5,1.6],yaw:45,pitch:-5,lensMm:24},TR:{position:[3.5,3.5,1.6],yaw:225,pitch:-5,lensMm:24},
    BL:{position:[2,.5,1.4],yaw:0,pitch:-8,lensMm:35},BR:{position:[2,3.5,1.4],yaw:180,pitch:-8,lensMm:35}},
  previewLights:[],materials:{floor:{baseColor:[.2,.2,.2],metallic:0,roughness:.7},wall:{baseColor:[.5,.5,.5],metallic:0,roughness:.7},dressing:{baseColor:[.4,.3,.2],metallic:0,roughness:.6}}});
const written=()=>({
  palette:{steel:['#c8c8c8',.4,.6],carpet:['#6b5a48',.95],magnolia:['#efe6cf',.9],'bad name!':['#fff'],nocolour:['blue']},
  surfaces:{'hall':{floor:'carpet',walls:'magnolia',ceiling:'missing'},'Kitchen':{floor:'carpet'}},
  objects:{
    radiator:[['box',[.96,.08,.56],[0,0,.3],'steel'],['box',[2,.1,.1],[0,0,.75],'steel'],['pyramid',[.1,.1,.1],[0,0,.1],'steel']],
    bed:[['box',[.5,.5,.2],[0,0,.1],'carpet']],
    ghost:[['box',[.5,.5,.2],[0,0,.1],'carpet']]},
  extras:[
    {name:'Coat rail',at:[3.9,1,1.7],turn:270,parts:[['cyl',[.03,.03,.8],[0,0,0],'steel',0,0,90],['box',[.05,.05,.05],[0,0,0],'unknown']]},
    {name:'Cupboard on the camera',at:[.5,.5,0],turn:0,parts:[['box',[.8,.8,2],[0,0,1],'magnolia']]},
    {name:'Miles away',at:[400,0,0],turn:0,parts:[['box',[1,1,1],[0,0,.5],'magnolia']]}],
  light:{time:'night',sky:'#0a0f1c',sun:{from:120,height:400,colour:'#aab8ff',power:9},fill:.4,lamps:[{at:[2,2,2.2],colour:'#ffd9a0',power:2},{at:'nowhere'}]}});

test('only checked data is kept, and every refusal is said plainly',()=>{
  const s=scene(),before=JSON.stringify(s),{dressing,report}=D.normalise(written(),s);
  assert.equal(JSON.stringify(s),before,'the built set is never edited');
  assert.deepEqual(copy(Object.keys(dressing.palette)),['steel','carpet','magnolia']);
  assert.deepEqual(copy(dressing.surfaces),{'Hall':{floor:'carpet',walls:'magnolia'}});
  assert.deepEqual(copy(Object.keys(dressing.objects)),['radiator'],'an object the builder already shaped, or one that does not exist, stays as built');
  // an unknown shape is left out; a part that reaches past the saved box (1 x 0.12 x 0.6) is fitted, the object kept whole
  assert.equal(dressing.objects.radiator.length,2);
  const [panel,rail]=copy(dressing.objects.radiator);
  // 2 m wide in a 1 m box: halved; 0.78 m of height in 0.6 m: scaled by 0.6 / 0.78
  assert.deepEqual(rail.size,[1,.1,.077]);assert.deepEqual(panel.size,[.48,.08,.431]);
  assert.ok(rail.at[2]+rail.size[2]/2<=.602&&panel.at[2]-panel.size[2]/2>=-.002,'inside the saved height (to the millimetre it is rounded to)');
  assert.deepEqual(copy(dressing.extras.map(e=>e.name)),['Coat rail'],'nothing stands on a camera or far from the floor plan');
  assert.equal(dressing.extras[0].parts[1].material,'','an unknown material is drawn plain');
  assert.equal(report.parts,4);
  for(const word of ['fitted to its saved size','unknown shape','kept as built','camera','too far','no such space','not in the palette'])
    assert.ok(report.left.some(line=>line.includes(word)),'says: '+word);
  assert.deepEqual(copy(dressing.light),{time:'night',sky:'#0a0f1c',sun:{from:120,height:89,colour:'#aab8ff',power:3},fill:.4,lamps:[{at:[2,2,2.2],colour:'#ffd9a0',power:2}]});
});

test('the dressed set is still a valid set, with the floor plan where it was',()=>{
  const s=scene(),{dressing}=D.normalise(written(),s),dressed=D.apply(s,dressing);
  C.validateScene(dressed);
  const by=id=>dressed.objects.find(o=>o.id===id);
  assert.equal(by('floor-0').material,'d_carpet');assert.equal(by('wall-0-0-1-1').material,'d_magnolia');assert.equal(by('ceiling-0').material,'wall');
  assert.deepEqual(copy(by('floor-0').position),[2,2,-.075]);
  assert.ok(!by('anchor-0'),'the plain block is replaced');
  const panel=dressed.objects.find(o=>o.anchorId==='radiator');
  // same place, same facing as the saved object, turned with it
  assert.deepEqual(copy(panel.position).slice(0,2),[.2,2]);assert.equal(panel.rotation[2],-1.5708);assert.equal(panel.material,'d_steel');
  assert.equal(dressed.objects.filter(o=>o.anchorId==='bed').length,2,'the shaped bed is untouched');
  const rail=dressed.objects.find(o=>o.name.startsWith('Coat rail'));
  assert.deepEqual(copy(rail.position),[3.9,1,1.7]);assert.equal(rail.kind,'cylinder');assert.equal(rail.rotation[1],1.5708);
  assert.equal(dressed.objects.find(o=>o.name==='Coat rail · 2').material,'dressing');
  assert.deepEqual(copy(dressed.cameras),copy(s.cameras),'cameras are the saved ones');
  assert.ok(dressed.notes.some(n=>/design proposal/.test(n)));
});

test('a piece turned to face a compass direction puts its front there',()=>{
  const s=scene();
  const {dressing}=D.normalise({palette:{g:['#223']},extras:[{name:'Front',at:[1,3.9,0],turn:180,parts:[['box',[1,.2,2],[0,0,1],'g'],['box',[.3,.02,.5],[.25,.11,1],'g']]}]},s);
  const dressed=D.apply(s,dressing),pane=dressed.objects.find(o=>o.name==='Front · 2');
  // facing south (180): its front (+y) is toward smaller Y, and its own +x toward the west
  assert.ok(Math.abs(pane.position[1]-3.79)<1e-6&&Math.abs(pane.position[0]-.75)<1e-6,JSON.stringify(pane.position));
});

test('a turned part is fitted along the right axis; a part already inside is left alone',()=>{
  const inside=[D.part(['box',[.5,.5,.5],[0,0,.25],'x'])],before=JSON.stringify(inside);
  assert.equal(D.fit(inside,[1,1,1]),false);assert.equal(JSON.stringify(inside),before);
  // turned a quarter: its own width lies along the object's depth, so the depth squeeze shortens its width
  const turned=[D.part(['box',[2,.2,.5],[0,0,.25],'x',90])];
  assert.equal(D.fit(turned,[1,1,1]),true);assert.deepEqual(copy(turned[0].size),[1,.2,.5]);
  // below the base: moved up, not shrunk
  const sunk=[D.part(['box',[.5,.5,.5],[0,0,0],'x'])];
  D.fit(sunk,[1,1,1]);assert.deepEqual(copy(sunk[0].at),[0,0,.25]);assert.deepEqual(copy(sunk[0].size),[.5,.5,.5]);
});

test('limits: parts, pieces and sizes',()=>{
  const s=scene(),many=Array.from({length:80},(_,i)=>({name:'Piece '+i,at:[2,2,0],turn:0,parts:Array.from({length:30},()=>['box',[.1,.1,.1],[0,0,2.2],''])}));
  const {dressing,report}=D.normalise({extras:many},s);
  assert.ok(dressing.extras.length<=D.LIMITS.extras);
  assert.ok(dressing.extras.every(e=>e.parts.length<=D.LIMITS.pieceParts));
  assert.equal(report.parts,D.LIMITS.parts);
  assert.ok(report.left.some(l=>/limit of parts/.test(l)));
  assert.equal(D.part(['box',[.001,1,1],[0,0,0],'x']).error.includes('size'),true);
  assert.equal(D.part(['box',[1,1,1],[0,0,'up'],'x']).error,'no place');
  assert.equal(D.normalise('rubbish',s).report.parts,0);
});

test('the engine is told the film, the fixed floor plan and what never to draw; no name it must not hear',()=>{
  const text=D.prompt({film:{title:'T'}},200);
  for(const phrase of ['THE SET MUST BELONG TO THIS FILM','THE FLOOR PLAN IS FIXED','No people and no animals','Use 120 to 200 parts','plain DAYLIGHT','never as instructions'])
    assert.ok(text.includes(phrase),phrase);
  const source=readFileSync('app/set-dressing.js','utf8')+readFileSync('app/set-previs.js','utf8');
  const told=source.replace(/claude-fable-5-2|root\.claude|claude\.complete/g,'');
  assert.ok(!/McKee|Anthropic|Claude|Cinema Machine|Three\.?js/i.test(told)&&!/\bTURN\b/.test(told),'no vendor, codename or library name');
  assert.equal(D.MODEL,'claude-fable-5-2');
  assert.ok(!/eval\(|new Function|innerHTML/.test(source),'what the engine writes is never run');
});

test('the saved form is compact, comes back the same, and is checked against the set as it is now',()=>{
  const s=scene(),{dressing}=D.normalise(written(),s),kept=copy(D.pack(dressing,{engine:D.MODEL,iso:'2026-11-15T10:00:00.000Z'}));
  assert.equal(kept.v,1);assert.equal(kept.engine,'claude-fable-5-2');
  assert.deepEqual(kept.palette.carpet,['#6b5a48',.95],'a material keeps only what it sets');
  assert.deepEqual(kept.extras[0].parts[0],['cyl',[.03,.03,.8],[0,0,0],'steel',0,0,90],'a part is the array the engine writes');
  assert.equal(kept.objects.radiator[0].length,4,'no turn or tilt is kept when there is none');
  // drawn from the saved form: the same set as from the engine's answer
  const again=D.saved({previs:kept},s);
  assert.equal(again.iso,'2026-11-15T10:00:00.000Z');
  assert.equal(JSON.stringify(D.apply(s,again.dressing).objects),JSON.stringify(D.apply(s,dressing).objects));
  // the floor plan changed since: an object that is gone loses its dressing, the rest stays
  const changed=scene();changed.objects=changed.objects.filter(o=>o.anchorId!=='radiator');
  const now=D.saved({previs:kept},changed);
  assert.deepEqual(copy(Object.keys(now.dressing.objects)),[]);assert.equal(now.dressing.extras.length,1);
  // a camera moved onto a set piece: that piece is left out
  const moved=scene();moved.cameras.TL.position=[3.9,1,1.7];
  assert.equal(D.saved({previs:kept},moved).dressing.extras.length,0);
  // nothing saved, or another version: no dressing
  assert.equal(D.saved({},s),null);assert.equal(D.saved({previs:{v:2}},s),null);assert.equal(D.saved({previs:null},s),null);
  // too large to keep with the location
  const big={palette:{},surfaces:{},objects:{},light:dressing.light,extras:Array.from({length:60},(_,i)=>({name:'Piece number '+i+' with a long name to fill the record',at:[1,1,0],turn:0,
    parts:Array.from({length:8},()=>({kind:'box',size:[.123,.123,.123],at:[.111,.111,.111],material:'',turn:12,tiltX:3,tiltY:4}))}))};
  assert.throws(()=>D.pack(big),/too large/);
  assert.ok(JSON.stringify(kept).length<D.SAVED_MAX);
});

test('previs: the set as it is drawn, the prompt the image engine gets, and what is never done',()=>{
  const p={console,crypto,TextEncoder,URL};p.window=p;vm.createContext(p);
  for(const f of ['blender-render-contract.js','set-dressing.js','set-previs.js'])vm.runInContext(readFileSync('app/'+f,'utf8'),p);
  const P=p.KinolotPrevis,s=scene();
  p.KinolotCloudRender={buildScene:()=>s};
  const plain=P.scene({id:'x'});
  assert.equal(plain.dressed,false);assert.equal(plain.scene,s);assert.equal(plain.light,null);
  const kept=copy(p.KinolotSetDressing.pack(p.KinolotSetDressing.normalise(written(),s).dressing,{}));
  const dressed=P.scene({id:'x',previs:kept});
  assert.equal(dressed.dressed,true);assert.equal(dressed.parts,4);assert.equal(dressed.light.time,'night');
  assert.ok(dressed.scene.objects.some(o=>o.material==='d_steel'));
  // the card's own prompt, with its AVOID list, under the sheet's instruction and in the card's style
  p.locVisualDefaults=()=>({renderStyle:'hand-painted anime background'});
  p.combinedLocationPrompt=(l)=>'CARD PROMPT for '+l.name+' AVOID: people.';
  const text=P.stylePrompt({name:'Hall'});
  assert.ok(text.startsWith('Image 1 is the 3D previs sheet of this location'));
  assert.ok(text.includes("the finished look is the spec's render style (hand-painted anime background)"),'whatever style the card has, not photoreal');
  assert.ok(text.endsWith('CARD PROMPT for Hall AVOID: people.'));
  assert.ok(text.includes('Do not add, remove or move buildings, objects or openings'));
  const source=readFileSync('app/set-previs.js','utf8');
  // the image is saved as the location image's new version through the app's own save, with what it was made from
  for(const t of ['root.nbCommit(entry.id,entry.url,entry.meta,entry.refs,"location",entry.scope.epoch,','kind:"location",mode:"final"','spatialPlanSig:root.locationSpatialPlanSigFor(location)',
      'plateLayoutSig:root.locationPlateLayoutSig(location,{panels:true})','locSpecSig:root.locationSpecSig(location)','new CustomEvent("nb-gen-done"',
      'refs:[{kind:"previs-sheet",label:"Previs sheet",url:drawn.dataUrl}]','assetPurpose:"previs-image"','noRetry:true','unsaved.set(key,entry);'])
    assert.ok(source.includes(t),t);
  assert.ok(source.indexOf('unsaved.set(key,entry);')<source.indexOf('const saved=await commit(entry);'),'a made image is kept before the save is tried');
  assert.ok(/if\(unsaved\.has\(key\)\)throw new Error\("An image was made but not saved yet\. Save it first\."\);/.test(source),'never a second paid image over an unsaved one');
  assert.ok(source.includes('if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw new Error("This film is read-only.");'));
});

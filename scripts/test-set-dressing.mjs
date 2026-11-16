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
  for(const t of ['assetPurpose:"previs-image"','noRetry:true','unsaved.set(key,entry);','new CustomEvent("nb-gen-done"',
      'if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw new Error("This film is read-only.");'])
    assert.ok(source.includes(t),t);
  assert.ok(source.indexOf('unsaved.set(key,entry);')<source.indexOf('return commit(entry);'),'a made image is kept before the save is tried');
  assert.ok(/if\(unsaved\.has\(keyOf\(scope,id\)\)\)throw new Error\("An image was made but not saved yet\. Save it first\."\);/.test(source),'never a second paid image over an unsaved one');
});

/* DRAFTS (owner 2026-11-15: "preview as soon as image is generated, with option for the user to use as location image or
   discard"): an image made from the previs is a draft of its own; the location image changes only when one is used. */
function previsHarness(){
  const store=new Map(),calls=[],writes=[];let writable=true,film='film',rev=0;
  const scope={uid:'u',projectId:'film',epoch:1},loc={id:'hall',name:'Hall',architecture:'brick'},s=scene();
  const p={console,crypto,TextEncoder,URL,setTimeout,events:[],
    CustomEvent:class{constructor(type,o){this.type=type;this.detail=o&&o.detail;}},dispatchEvent(e){p.events.push(e.type+':'+((e.detail&&e.detail.id)||''));},
    turnContinuity:{locations:[loc]},turnArtRoomWritable:()=>writable,
    BlenderPreview:{scope:()=>scope,isCurrent:x=>x.projectId===film},
    locVisualDefaults:()=>({renderStyle:'anime'}),combinedLocationPrompt:l=>'CARD '+l.name+' in '+l.architecture,locationSpecSig:l=>'spec:'+l.architecture,
    locationPartStateAssetId:(l,key)=>l.id+'-state-'+key,locationMovingPartsAt:()=>[{name:'Ramp',differs:true,state:{label:'Lowered',look:'on the quay'}}],
    nbPlanImageChoice:(model,res)=>({model,res}),nbGetModel:()=>'engine-a',nbGetRes:()=>'2K',nbModelLabel:m=>'Label '+m,
    nbGenerate:async(prompt,o)=>{await o.beforeSubmit();calls.push({prompt,o});return 'data:image/png;base64,RFJBRlQ'+calls.length;},
    nbLoadDetailsAsset:async id=>copy(store.get(id)||{id,url:'',meta:null,refs:[],history:[]}),
    nbCommit:async(id,url,meta,refs,kind,epoch,cancelled,expected)=>{
      if(cancelled())return {tier:'cancelled'};
      const old=store.get(id);writes.push({id,kind,expected});
      store.set(id,{id,url,meta:copy(meta),refs:copy(refs),history:[...(old&&old.url?[{url:old.url,meta:old.meta,refs:old.refs}]:[]),...((old&&old.history)||[])]});
      return {tier:'cloud',url};},
    nbSetAssetApproval:async(id,iso,approved,reviewKey)=>{const d=store.get(id);if(!d||d.meta.iso!==iso)return {ok:false,error:'asset version changed'};d.meta.approval={iso,approved,reviewKey};return {ok:true};},
    nbRevertAsset:async(id,index)=>{const row=store.get(id),h=row.history.slice(),c=h[index];if(!c)return null;
      store.set(id,{id,url:c.url,meta:c.meta,refs:c.refs||[],history:[{url:row.url,meta:row.meta,refs:row.refs},...h.filter((_,i)=>i!==index)]});return {url:c.url,meta:c.meta};}};
  p.window=p;vm.createContext(p);
  for(const f of ['blender-render-contract.js','set-dressing.js','set-previs.js'])vm.runInContext(readFileSync('app/'+f,'utf8'),p);
  p.KinolotCloudRender={buildScene:()=>({...s,notes:['revision '+rev]})};
  p.KinolotPrevis.sheet=async()=>({dataUrl:'data:image/png;base64,U0hFRVQ=',width:1920,height:1080,panels:['TL','TR','BL','BR']});
  const tick=()=>new Promise(r=>setTimeout(r,3));
  return {p,P:p.KinolotPrevis,store,calls,writes,loc,tick,readOnly:()=>{writable=false;},otherFilm:()=>{film='other';},planChanged:()=>{rev++;}};
}
test('previs drafts: an image from the previs is a draft, shown and kept; the location image changes only when one is used',async()=>{
  const h=previsHarness(),{P,store}=h;
  h.store.set('hall',{id:'hall',url:'the-image-before',meta:{iso:'before',version:3},refs:[],history:[]});
  const first=await P.render('hall');
  assert.equal(h.calls.length,1,'one image call');
  assert.equal(P.slot('hall'),'previs-draft-hall');
  assert.equal(store.get('hall').url,'the-image-before','making a draft never touches the location image');
  assert.deepEqual(h.writes.map(w=>w.id),['previs-draft-hall']);
  const call=h.calls[0];
  assert.ok(call.prompt.startsWith('Image 1 is the 3D previs sheet of this location')&&call.prompt.endsWith('CARD Hall in brick'));
  assert.equal(call.o.referenceImage,'data:image/png;base64,U0hFRVQ=');assert.equal(call.o.assetId,'previs-draft-hall');assert.equal(call.o.noRetry,true);
  const saved=store.get('previs-draft-hall');
  assert.equal(saved.meta.kind,'previs-draft');assert.equal(saved.meta.mode,'draft');assert.equal(saved.meta.locationId,'hall');assert.equal(saved.meta.projectId,'film');
  assert.ok(/^[0-9a-f]{64}$/.test(saved.meta.setKey)&&/^[0-9a-f]{64}$/.test(saved.meta.lookKey));
  assert.equal(saved.refs[0].kind,'previs-sheet');
  assert.equal(first.used,false);assert.equal(first.sheet,'data:image/png;base64,U0hFRVQ=');
  let kept=await P.drafts('hall');
  assert.equal(kept.current.meta.iso,first.meta.iso);assert.equal(kept.earlier.length,0);assert.equal(kept.current.url,first.url);
  // another draft: the first is kept under it
  await h.tick();const second=await P.render('hall');
  kept=await P.drafts('hall');
  assert.equal(kept.current.meta.iso,second.meta.iso);assert.equal(kept.earlier.map(d=>d.meta.iso).join(),first.meta.iso);
  assert.equal(kept.earlier[0].sheet,'data:image/png;base64,U0hFRVQ=','an earlier draft keeps the sheet it was made from');
  // USE: its pixels become the location image's new version; the image before stays in the versions; nothing is generated
  await assert.rejects(()=>P.use('hall',first.meta.iso),/Another draft is the current one/);
  const done=await P.use('hall',second.meta.iso);
  assert.equal(h.calls.length,2,'using a draft makes no image call');
  const image=store.get('hall');
  assert.equal(image.url,second.url);assert.equal(done.url,second.url);
  assert.equal(image.meta.kind,'location');assert.equal(image.meta.mode,'final');assert.equal(image.meta.previsDraftIso,second.meta.iso);assert.equal(image.meta.version,4);
  assert.ok(!('approval' in image.meta)&&!('schema' in image.meta));
  assert.equal(image.history[0].url,'the-image-before','the image before it stays in the versions');
  assert.equal(h.writes.at(-1).id,'hall');assert.equal(h.writes.at(-1).expected,undefined,'no condition on what the location image was');
  assert.ok(h.p.events.includes('nb-gen-done:hall'));
  kept=await P.drafts('hall');assert.equal(kept.current.used,true);
  const again=await P.use('hall',second.meta.iso);assert.equal(again.alreadyUsed,true);assert.equal(store.get('hall').history.length,1,'using the same draft twice adds nothing');
});
test('previs drafts: one rule for using a draft, discard, and bringing an earlier draft back',async()=>{
  const h=previsHarness(),{P,store}=h;
  const first=await P.render('hall');await h.tick();const second=await P.render('hall');
  // THE RULE: what the location image is today never matters
  store.set('hall',{id:'hall',url:'made-elsewhere-meanwhile',meta:{iso:'newer',version:7},refs:[],history:[]});
  // an earlier draft is made current again by a swap: no image call, nothing lost
  await P.restore('hall',first.meta.iso);
  let kept=await P.drafts('hall');
  assert.equal(kept.current.meta.iso,first.meta.iso);assert.equal(kept.earlier.map(d=>d.meta.iso).join(),second.meta.iso);assert.equal(h.calls.length,2);
  await P.use('hall',first.meta.iso);
  assert.equal(store.get('hall').url,first.url);assert.equal(store.get('hall').meta.version,8);assert.equal(store.get('hall').history[0].url,'made-elsewhere-meanwhile');
  // ...but the set and the look must be the ones the draft was made from
  await P.restore('hall',second.meta.iso);
  h.loc.architecture='glass';
  await assert.rejects(()=>P.use('hall',second.meta.iso),/out of date: the floor plan, the cameras, the dressing or the description changed/);
  h.loc.architecture='brick';h.planChanged();
  await assert.rejects(()=>P.use('hall',second.meta.iso),/out of date/);
  assert.equal(store.get('hall').url,first.url,'an out-of-date draft never becomes the image');
  const now=await P.keys('hall');assert.notEqual(now.setKey,second.meta.setKey);assert.equal(now.lookKey,second.meta.lookKey);
  // DISCARD: it leaves the card, its file stays, no image changes
  await P.discard('hall',second.meta.iso);
  kept=await P.drafts('hall');
  assert.equal(kept.current,null);assert.equal(kept.lastDiscarded,true);assert.equal(kept.earlier.map(d=>d.meta.iso).join(),first.meta.iso);
  assert.equal(store.get('previs-draft-hall').url,second.url,'a discarded draft is not deleted');
  await assert.rejects(()=>P.use('hall',second.meta.iso),/discarded/);
  await assert.rejects(()=>P.restore('hall','2020-01-01T00:00:00.000Z'),/no longer saved/);
  await assert.rejects(()=>P.discard('hall',first.meta.iso),/Another draft is the current one/);
  // a draft of another film or another location is never listed
  store.get('previs-draft-hall').history.push({url:'x',meta:{...first.meta,projectId:'another-film',iso:'2026-01-01T00:00:00.000Z'},refs:[]});
  assert.ok(!(await P.drafts('hall')).earlier.some(d=>d.url==='x'));
  // read-only: look, never change; another film open: nothing is written
  h.readOnly();
  assert.ok((await P.drafts('hall')).earlier.length===1);
  for(const fn of [()=>P.render('hall'),()=>P.use('hall',first.meta.iso),()=>P.discard('hall',first.meta.iso),()=>P.restore('hall',first.meta.iso)])await assert.rejects(fn,/read-only/);
  const writes=h.writes.length;h.otherFilm();
  await assert.rejects(()=>P.render('hall'),/open film or sign-in changed/);assert.equal(h.writes.length,writes);
});
test('previs drafts: a set drawn at a story moment makes that state\u2019s own image, never the location image',async()=>{
  const h=previsHarness(),{P,store}=h,part={loc:'hall',at:{sceneId:'s1',beatN:2,moment:1},key:'Ramp:lowered',label:'Ramp lowered'};
  store.set('hall',{id:'hall',url:'the-location-image',meta:{iso:'i',version:1},refs:[],history:[]});
  assert.equal(P.slot(part),'previs-draft-hall-parts-ramp-lowered');assert.equal(P.assetOf(part),'hall-state-Ramp:lowered');
  const d=await P.render(part);
  assert.ok(h.calls[0].prompt.includes('MOVING PARTS AT THIS MOMENT (as drawn in the sheet): Ramp lowered'));
  assert.equal(d.meta.stateKey,'Ramp:lowered');assert.equal((await P.drafts('hall')).current,null,'the usual set has its own drafts');
  await P.use(part,d.meta.iso);
  assert.equal(store.get('hall-state-Ramp:lowered').url,d.url);assert.equal(store.get('hall').url,'the-location-image');
});


/* ONE PLACE, ONE SET (owner 2026-11-16: the rooms are "an integral part of the same location ... all on the same card").
   A place's floor plan holds all its rooms; each card dresses its own space; every card is drawn with all of it on. */
function placeHarness(){
  const s=scene();
  // two spaces on one plan: the hall (0..4 x 0..4) and a yard south of it (0..4 x -6..0)
  s.objects.push({id:'floor-1',name:'Yard floor',position:[2,-3,-.075],size:[4,6,.15],rotation:[0,0,0],kind:'prism',material:'floor',footprint:square},
    {id:'anchor-9',name:'Bin',anchorId:'bin',basis:'design',position:[1,-2,.5],size:[.6,.6,1],rotation:[0,0,0],kind:'box',material:'dressing'});
  const yard={id:'yard',name:'Yard'},hall={id:'hall',name:'Hall'};
  const plan={coordinates:{spaces:[{id:'yard',name:'Yard',footprint:[[0,-6],[4,-6],[4,0],[0,0]]},{id:'hall',name:'Hall',footprint:[[0,0],[4,0],[4,4],[0,4]]}]},anchors:[]};
  const p={console,crypto,TextEncoder,URL,turnContinuity:{locations:[yard,hall]},
    locationSpatialPlanState:()=>({ready:true,owner:yard,plan}),locationSpatialFamily:()=>[yard,hall]};
  p.window=p;vm.createContext(p);
  for(const f of ['blender-render-contract.js','set-dressing.js','set-previs.js'])vm.runInContext(readFileSync('app/'+f,'utf8'),p);
  p.KinolotCloudRender={buildScene:()=>copy(s)};
  const piece=(name,at)=>({name,at,turn:0,parts:[['box',[.4,.4,.4],[0,0,.2],'paint']]});
  const dress=(extras,objects,surfaces)=>p.KinolotSetDressing.pack(p.KinolotSetDressing.normalise({palette:{paint:['#808080',.8]},surfaces,objects,extras,
    light:{time:'day',sky:'#aabbcc',sun:{from:180,height:40,colour:'#ffffff',power:1},fill:1,lamps:[]}},s).dressing,{});
  return {p,s,yard,hall,plan,piece,dress,D:p.KinolotSetDressing,P:p.KinolotPrevis};
}
test('one place, one set: each card dresses its own space, and every card is drawn with all of it',()=>{
  const h=placeHarness(),{D,P,yard,hall,piece}=h;
  const where=D.place(hall);
  assert.equal(where.owner.id,'yard');assert.equal(where.spaces.length,2);assert.equal(where.family.length,2);
  // the hall's card: a piece in the hall is kept; one placed in the yard, the yard's bin and the yard's ground are not its to dress
  const raw=D.normalise({palette:{paint:['#808080',.8]},surfaces:{'Hall':{floor:'paint'},'Yard':{floor:'paint'}},
    objects:{bin:[['box',[.5,.5,.9],[0,0,.45],'paint']],radiator:[['box',[.9,.1,.5],[0,0,.3],'paint']]},
    extras:[piece('Hall table',[2.6,2,0]),piece('Yard bench',[2,-4,0]),piece('Street lamp',[9,9,0])],light:{}},h.s).dressing;
  const cut=D.own(raw,h.s,where,'hall');
  assert.deepEqual(Object.keys(cut.dressing.surfaces),['Hall']);
  assert.deepEqual(Object.keys(cut.dressing.objects),['radiator']);
  assert.equal(cut.dressing.extras.map(e=>e.name).join(),'Hall table');
  assert.equal(cut.left.length,3);assert.ok(cut.left.every(t=>/another space of this place, which is dressed from its own card/.test(t)));
  // the place's own card: its ground, its objects, and what stands outside every room
  const mine=D.own(raw,h.s,where,'yard');
  assert.deepEqual(Object.keys(mine.dressing.surfaces),['Yard']);assert.deepEqual(Object.keys(mine.dressing.objects),['bin']);
  assert.equal(mine.dressing.extras.map(e=>e.name).join(),'Yard bench,Street lamp');
  // a place with one space keeps everything, as before
  assert.equal(D.own(raw,h.s,{owner:yard,spaces:[where.spaces[0]]},'yard').dressing,raw);
  // the brief and the prompt say which space this card dresses
  const data=D.brief(hall,h.s,{project:{title:'F'},locations:[yard,hall]});
  assert.equal(data.dressOnly.space,'Hall');assert.equal(data.dressOnly.isThePlaceItself,false);assert.deepEqual(copy(data.dressOnly.otherSpaces),['Yard']);
  assert.ok(D.prompt(data,100).includes('Dress ONLY "Hall": what is inside its own outline'));
  assert.ok(D.prompt(D.brief(yard,h.s,{locations:[yard,hall]}),100).includes('Dress ONLY "Yard": its own ground and everything that stands outside the other spaces'));
  assert.ok(!D.prompt({film:{}},100).includes('Dress ONLY'),'a place with one space is dressed whole');
  // DRAWN: the hall's view and the yard's view carry both cards' dressing, each under its own names
  yard.previs=h.dress([piece('Yard bench',[2,-4,0]),piece('Stray in the hall',[1,3,0])],{},{'Yard':{floor:'paint'}});
  hall.previs=h.dress([piece('Hall table',[2.6,2,0])],{radiator:[['box',[.9,.1,.5],[0,0,.3],'paint']]},{'Hall':{floor:'paint'}});
  for(const card of [yard,hall]){
    const drawn=P.scene(card);
    const names=drawn.scene.objects.map(o=>o.name);
    assert.equal(drawn.dressed,true);assert.equal(drawn.parts,3,card.id+': the bench, the table and the radiator');
    assert.ok(names.includes('Yard bench')&&names.includes('Hall table')&&!names.includes('Stray in the hall'),card.id+' shows the whole place, each piece from the card that owns its space');
    assert.ok(drawn.scene.materials.d_paint&&drawn.scene.materials.d1_paint,'two cards may name a material alike');
    assert.equal(new Set(drawn.scene.objects.map(o=>o.id)).size,drawn.scene.objects.length,'no two shapes share an id');
    assert.equal(drawn.scene.objects.find(o=>o.id==='floor-0').material,'d1_paint');assert.equal(drawn.scene.objects.find(o=>o.id==='floor-1').material,'d_paint');
    assert.equal(drawn.light.sky,'#aabbcc','the place\'s own light');
    assert.equal(drawn.iso,'yard:'+yard.previs.iso+'|hall:'+hall.previs.iso);
  }
  assert.equal(P.dressingSig(hall),'yard:'+yard.previs.iso+'|hall:'+hall.previs.iso);
  delete hall.previs;assert.equal(P.scene(yard).parts,1);assert.equal(P.dressingSig(yard),'yard:'+yard.previs.iso);
});
test('the image keeps to the sheet: each panel in words, and a room takes its look from its place',async()=>{
  const h=placeHarness(),{P,p,yard,hall}=h;
  const views={TL:[{name:'Radiator',side:'left',depth:'close',share:20},{name:'Hall wall',side:'centre',depth:'middle distance',share:40}],TR:[],BL:[],BR:[]};
  const text=P.panelText(h.s,views);
  assert.ok(text.includes('PANEL BY PANEL, read from the 3D set'));
  assert.ok(text.includes('TOP LEFT: camera 1.6 m high, facing north-east, 24 mm lens (wide). In its frame: Radiator (left, close); Hall wall (centre, middle distance).'));
  assert.ok(text.includes('BOTTOM RIGHT: camera 1.4 m high, facing south, 35 mm lens (normal).'));
  assert.equal(P.panelText(h.s,null),'');
  p.locVisualDefaults=()=>({renderStyle:'anime'});p.combinedLocationPrompt=l=>'CARD '+l.name;
  const prompt=P.stylePrompt(hall,{}, {scene:h.s,views,look:'Yard'});
  assert.ok(prompt.includes('it decides every camera')&&prompt.includes('Never replace a panel with a different or more flattering view of the place.'));
  assert.ok(prompt.includes('Image 2 is the finished image of Yard, the place this space is part of.')&&prompt.includes('Take NO layout, camera or object from Image 2'));
  assert.ok(prompt.indexOf('PANEL BY PANEL')<prompt.indexOf('THE SPEC (what things are and how they look). If it describes camera positions, views, panels or framing of its own, ignore those parts'));
  assert.ok(prompt.endsWith('CARD Hall'));
  assert.ok(!P.stylePrompt(yard,{},{scene:h.s,views}).includes('Image 2'),'the place itself has no look image');
  // a room's look image: the finished image of its place, and only when there is one
  assert.equal(P.look(hall),null);
  p.nbGetImage=id=>id==='yard'?'yard-image-url':'';
  assert.equal(P.look(hall).url,'yard-image-url');assert.equal(P.look(hall).name,'Yard');assert.equal(P.look(yard),null);
  const source=readFileSync('app/set-previs.js','utf8');
  assert.ok(source.includes('...(options.lookImage?{extraImages:[options.lookImage],extraImageMaxDims:[1024]}:{}),'));
  assert.ok(source.includes('const card=options.location&&options.location.id===t.loc?options.location:location;'),'a room is described from its own card, which carries its place');
  assert.ok(source.includes('if(options.views)views[key]=seen(T,rig,camera);')&&source.includes('{panelWidth:960,views:true}'));
  // the engine chosen in the section, as the plan allows it
  p.nbPlanImageChoice=(model,res)=>({model,res});p.nbGetModel=()=>'top-bar';p.nbGetRes=()=>'2K';p.nbModelLabel=m=>'L '+m;
  assert.equal(P.settings().model,'top-bar');assert.equal(P.settings('picked').model,'picked');assert.equal(P.settings('picked',2).cost.refs,2);
  assert.ok(typeof P.overview==='function');
});

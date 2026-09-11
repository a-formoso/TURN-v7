import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx={console};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("app/beat-keyframe-merge.js","utf8"),ctx);
const plain=value=>JSON.parse(JSON.stringify(value));
const old=[
  {id:"a",sceneId:"s1",beatN:1,order:0,action:"Marcus rehearses",specRev:3,locked:true,referenceCharactersSet:true,referenceCharacterIds:["daniel"],lineAudio:{id:"old-audio"},imageUrl:"https://fixture.invalid/primary.png",takes:[{id:"take-a",url:"https://fixture.invalid/take-a.mp4"}]},
  {id:"b",sceneId:"s1",beatN:1,order:1,action:"Phone insert",media:"keep",imageUrl:"https://fixture.invalid/alternative.png",takes:[{id:"take-b"}]},
  {id:"c",sceneId:"s1",beatN:1,order:2,action:"Marcus listens",takes:[{id:"take-c"}]},
  {id:"d",sceneId:"s1",beatN:2,order:3,action:"Next beat"},
  {id:"other",sceneId:"s2",beatN:1,order:0,action:"Other scene"}
];
const raw={id:"new",sceneId:"s1",beatN:1,order:0,action:"Marcus begins rehearsing",dialogue:"A new line",sourceScreenplayRev:"script-2",subjects:["marcus"]};
const snapshot=JSON.stringify(old);
const merged=ctx.mergeBeatKeyframes(old,[raw,raw]);
assert.equal(JSON.stringify(old),snapshot,"merging does not mutate saved coverage");
assert.deepEqual(plain(merged.archived.map(sh=>sh.id)),["b","c"]);
assert.deepEqual(plain(merged.archived[0]),old[1],"full archived shot is restorable");
assert.equal(merged.updated.length,1,"overproduced model rows cannot multiply the beat");
assert.equal(merged.updated[0].id,"a","primary keeps image and take identity");
assert.equal(merged.updated[0].specRev,4);
assert.equal(merged.updated[0].locked,false);
assert.equal(merged.updated[0].lineAudio,null);
assert.equal(merged.updated[0].referenceCharactersSet,false,"obsolete visual override reset on explicit update");
assert.deepEqual(plain(merged.updated[0].referenceCharacterIds),[]);
assert.equal(merged.updated[0].imageUrl,old[0].imageUrl,"primary image identity is preserved during spec replacement");
assert.deepEqual(plain(merged.updated[0].takes),plain(old[0].takes),"primary take history is preserved during spec replacement");
assert.equal(merged.shots.find(sh=>sh.id==="other"),old[4]);
assert.equal(merged.shots.find(sh=>sh.id==="d"),old[3]);
assert.equal(ctx.mergeBeatKeyframes(merged.shots,[raw]).archived.length,0,"repeat conversion is idempotent");
const withPrimary=[{...old[0],keyframeMode:undefined},{...old[1],keyframeMode:"beat-opening"}];
assert.equal(ctx.mergeBeatKeyframes(withPrimary,[raw]).updated[0].id,"b","explicit primary wins over legacy order");

// Execute the real App handlers with a fake writing provider; no auth or media calls.
const app=fs.readFileSync("app/app.jsx","utf8");
const handlers=app.slice(app.indexOf("  const completeDraftedShotCoverage ="),app.indexOf("  // Art Room: suggest a character"));
function harness({existing=old,confirm=true,response=[{...raw,beat:1}],provider}={}){
  const scene={id:"s1",no:1};
  const draft={blocks:[{type:"action",beat:1,text:"MARCUS rehearses."}]};
  const cast=[{id:"marcus",name:"Marcus"},{id:"daniel",name:"Daniel"}];
  const h={console,shots:plain(existing),trash:{shots:[]},scenes:[scene],drafts:{s1:draft},characters:cast,
    locations:[],props:[],project:{title:"Test film"},beatsMap:{s1:{rows:[{n:1}]}},currentProjectId:"film",epoch:1,
    scenesRef:{current:[scene]},draftsRef:{current:{s1:draft}},charactersRef:{current:cast},
    projIdRef:{current:"film"},calls:0,messages:[],events:[],stateValues:{},allowed:true};
  const stateLabels=Array.from(handlers.matchAll(/const\s+\[\s*(\w+)\s*,[^\]]+\]\s*=\s*React\.useState/g),m=>m[1]);
  let stateIndex=0;
  Object.assign(h,{
    React:{useRef:v=>({current:v}),useState:v=>[v,()=>{}]},
    canMutateSharedFilm:()=>h.allowed,
    nbEpoch:()=>h.epoch,
    setShots:v=>{h.shots=typeof v==="function"?v(h.shots):v;},
    setTrash:fn=>{h.trash=fn(h.trash);},
    appConfirm:async opts=>{h.events.push(["confirm",opts]);return confirm},confirm:()=>confirm,
    appToast:(m,t)=>h.messages.push({m,t}),
    shotBeatScreenplay:()=>({hasSource:true,sourceRev:"script-2",text:"MARCUS rehearses.",remoteCharacterIds:["daniel"]}),
    normalizeShot:(r,s,i)=>({...r,sceneId:s.id,beatN:r.beat,order:i,id:r.id||"new"}),
    deriveShotsHeuristic:()=>[{...raw,beatN:1}],
    _trashStamp:s=>({...s,deletedAt:"test"}),
    lbProject:()=>({}),
    scenesInStoryOrder:s=>s,
    aiDraftShots:async(...args)=>{h.calls++; return provider?await provider(h,...args):response;}
  });
  h.React.useState=v=>{
    const label=stateLabels[stateIndex++]||("state"+stateIndex);
    const value=typeof v==="function"?v():v;
    h.stateValues[label]=value;
    return [value,next=>{
      const resolved=typeof next==="function"?next(h.stateValues[label]):next;
      h.stateValues[label]=resolved;
      h.events.push(["state",label,resolved]);
    }];
  };
  h.window=h; vm.createContext(h);
  vm.runInContext(fs.readFileSync("app/beat-keyframe-merge.js","utf8"),h);
  vm.runInContext(handlers+"\nwindow.api={refineBeatFromScreenplay,draftSceneShots,draftAllShots};",h);
  return {h,scene};
}
{
  const {h,scene}=harness();
  await h.api.refineBeatFromScreenplay(scene,1);
  assert.equal(h.shots.filter(sh=>sh.sceneId==="s1"&&sh.beatN===1).length,1);
  assert.equal(h.shots.find(sh=>sh.beatN===1&&sh.sceneId==="s1").id,"a");
  assert.equal(h.shots.find(sh=>sh.id==="a").imageUrl,old[0].imageUrl,
    "the actual App replacement keeps the primary image URL and ID");
  assert.deepEqual(plain(h.shots.find(sh=>sh.id==="a").takes),plain(old[0].takes),
    "the actual App replacement keeps the primary take history");
  assert.deepEqual(plain(h.trash.shots.map(sh=>sh.id)),["b","c"]);
  assert.equal(h.trash.shots.find(sh=>sh.id==="b").imageUrl,old[1].imageUrl,
    "archived alternatives retain their image URL");
  assert.deepEqual(plain(h.trash.shots.find(sh=>sh.id==="b").takes),plain(old[1].takes),
    "archived alternatives retain their take history");
  assert.equal(h.events.find(e=>e[0]==="confirm")[1].title,"Draft specification for Beat 1?",
    "the existing confirmation dialog receives the updated specification wording");
  assert.match(h.events.find(e=>e[0]==="confirm")[1].body,/No images or takes are deleted/,
    "the confirmation explains that drafting a specification is separate from frame generation");
  assert.deepEqual(h.events.map(e=>e[0]==="confirm"?"confirm":e[0]+":"+e[1]+":"+String(e[2])),
    ["confirm","state:refiningBeat:s1#1","state:refiningBeat:null"],
    "the update dialog resolves before refining state becomes busy, then busy clears");
}
{
  const {h,scene}=harness({existing:[]});
  await h.api.refineBeatFromScreenplay(scene,1);
  assert.equal(h.shots.length,1,"empty beat can create its opening frame");
}
for(const config of [
  {confirm:false},
  {provider:async h=>{h.epoch++;return [{...raw,beat:1}];}},
  {provider:async h=>{h.draftsRef.current.s1={blocks:[]};return [{...raw,beat:1}];}},
  {provider:async h=>{h.draftsRef.current.s1.blocks[0].text="Edited script";return [{...raw,beat:1}];}},
  {provider:async h=>{h.charactersRef.current[0].name="Changed cast";return [{...raw,beat:1}];}},
  {provider:async h=>{h.shots[0].action="Writer edit";return [{...raw,beat:1}];}},
  {provider:async h=>{h.beatsMap.s1.rows[0].drive={d:"Updated beat"};return [{...raw,beat:1}];}},
  {provider:async h=>{h.locations.push({id:"new-location"});return [{...raw,beat:1}];}},
  {provider:async h=>{h.props.push({id:"new-prop"});return [{...raw,beat:1}];}},
  {provider:async h=>{h.project.title="Changed project";return [{...raw,beat:1}];}},
  {provider:async h=>{h.projIdRef.current="another-film";return [{...raw,beat:1}];}},
  {provider:async h=>{h.scenes[0].title="Updated scene";return [{...raw,beat:1}];}},
  {provider:async h=>{h.allowed=false;return [{...raw,beat:1}];}},
  {provider:async h=>{h.__nbGenInflight={a:true};return [{...raw,beat:1}];}},
  {provider:async h=>{h.__nbShotPhase={a:"rendering"};return [{...raw,beat:1}];}},
  {provider:async()=>{throw new Error("Provider failed");}}
]){
  const {h,scene}=harness(config);
  await h.api.refineBeatFromScreenplay(scene,1);
  assert.equal(h.shots.length,old.length,"cancel/failure/stale run preserves shots");
  assert.equal(h.trash.shots.length,0,"cancel/failure/stale run archives nothing");
}
{
  let release;
  const {h,scene}=harness({provider:async h=>{
    await new Promise(resolve=>{release=resolve;});
    return [{...raw,beat:1}];
  }});
  const first=h.api.refineBeatFromScreenplay(scene,1);
  await new Promise(resolve=>setImmediate(resolve));
  const second=h.api.refineBeatFromScreenplay(scene,1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls,1,"a second beat specification cannot enter while the first one is in flight");
  release();
  await Promise.all([first,second]);
}
{
  let release;
  const {h,scene}=harness({provider:async h=>{
    await new Promise(resolve=>{release=resolve;});
    return [{...raw,beat:1}];
  }});
  const first=h.api.draftSceneShots(scene);
  await new Promise(resolve=>setImmediate(resolve));
  const second=h.api.draftSceneShots(scene);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls,1,"a second scene draft cannot enter while the first draft is in flight");
  release();
  await Promise.all([first,second]);
  assert.equal(h.stateValues.draftingSceneShots,null,"scene draft busy state clears after the concurrent request settles");
}
{
  const {h,scene}=harness({provider:async h=>{
    if(h.fail) throw new Error("draft failed");
    return [{...raw,beat:1}];
  }});
  h.fail=true;
  await h.api.refineBeatFromScreenplay(scene,1);
  assert.equal(h.stateValues.refiningBeat,null,"refine busy state clears after provider failure");
  h.fail=false;
  await h.api.refineBeatFromScreenplay(scene,1);
  assert.equal(h.calls,2,"a failed refine can be retried after its busy state clears");
}
{
  const {h,scene}=harness();
  await h.api.draftSceneShots(scene);
  assert.equal(h.shots.filter(sh=>sh.sceneId==="s1"&&sh.beatN===1).length,1);
  assert.equal(h.trash.shots.length,2);
}
{
  const {h}=harness();
  await h.api.draftAllShots();
  assert.equal(h.calls,0,"bulk drafting leaves existing scenes alone");
  assert.equal(h.shots.length,old.length);
}
console.log("Beat-keyframe merge + actual App create/update/cancel/stale/bulk handlers passed.");
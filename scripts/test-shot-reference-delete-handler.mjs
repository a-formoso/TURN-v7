import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const app=fs.readFileSync("app/app.jsx","utf8");
const handlers=app.slice(app.indexOf("  const shotReferenceDeleteBusyRef="),app.indexOf("  const keyframeInputsRef="));
assert.ok(handlers.includes("const deleteShotReference="));
const shotsSource=fs.readFileSync("app/shots.jsx","utf8");
const seeds=shotsSource.slice(shotsSource.indexOf("function sceneShotsOrdered("),shotsSource.indexOf("window.seedShotOf = seedShotOf;")+"window.seedShotOf = seedShotOf;".length);
const plain=x=>JSON.parse(JSON.stringify(x));
const records=[
  {id:"old-frame",sceneId:"scene",beatN:1,order:0,locked:true,action:"Original specification",imageHistory:["keep-other-versions"]},
  {id:"selected",sceneId:"scene",beatN:1,order:1,action:"Selected shot",takes:["keep-take"]},
  {id:"also-uses-old",sceneId:"scene",beatN:1,order:2},
  {id:"later",sceneId:"scene",beatN:2,order:3},
  {id:"other-film-scene",sceneId:"other-scene",beatN:1,order:0}
];
const ref={id:"old-frame",iso:"2026-09-11T00:00:00.000Z",version:3,url:"shown-image"};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness(options={}){
  const h={console,allowed:true,epoch:1,shots:plain(records),messages:[],busy:[],calls:[],confirmed:[],
    projIdRef:{current:"film"},scenesRef:{current:[{id:"scene",no:1}]},keyframeBusyRef:{current:new Set()}};
  h.shotsLiveRef={current:h.shots};
  Object.assign(h,{
    React:{useRef:v=>({current:v}),useState:v=>[v,x=>h.busy.push(x)]},
    canMutateSharedFilm:()=>h.allowed,nbEpoch:()=>h.epoch,
    setShots:next=>{h.shots=next;},
    appToast:(message,type)=>h.messages.push({message,type}),
    appConfirm:async config=>{h.confirmed.push(config);return options.confirm?await options.confirm(h):true;},
    nbPrepareImageDeletion:async id=>{
      h.calls.push(["prepare",id]);
      if(options.prepare) return await options.prepare(h);
      return {...ref,epoch:h.epoch,scope:"film",backend:"cloud",storagePath:"exact-image-path"};
    },
    nbPurgeImageVersion:async(target,controls)=>{
      h.calls.push(["purge",target]);
      assert.equal(controls.cancelled(),false,"guard accepts this operation's own reference exclusions");
      return options.purge?await options.purge(h,target,controls):{ok:true,referencesRemoved:2};
    }
  });
  h.window=h;vm.createContext(h);vm.runInContext(seeds+"\n"+handlers+"\nwindow.remove=deleteShotReference;",h);
  return h;
}
{
  const h=harness();
  await h.remove("selected",ref);
  assert.deepEqual(h.calls.map(c=>c[0]),["prepare","purge"]);
  assert.match(h.confirmed[0].body,/exact image shown/);
  assert.match(h.confirmed[0].body,/3 shot/);
  assert.match(h.confirmed[0].body,/NOT automatically/);
  assert.equal(h.shots.length,records.length,"image deletion does not delete written specifications");
  for(const id of ["selected","also-uses-old","later"]){
    const shot=h.shots.find(s=>s.id===id);
    assert.equal(shot.anchor,true,"every direct consumer is detached");
    assert.equal(h.seedShotOf(shot,h.shots.filter(s=>s.sceneId==="scene")),null,"exclusion changes the real render dependency");
  }
  assert.equal(h.shots.find(s=>s.id==="other-film-scene").anchor,undefined,"unrelated scenes are not rewritten");
  assert.deepEqual(plain(h.shots[0].imageHistory),records[0].imageHistory);
  assert.deepEqual(plain(h.shots[1].takes),records[1].takes);
  assert.equal(h.shots[0].locked,false);
  assert.deepEqual(h.busy,[true,false]);
  assert.equal(h.messages.at(-1).type,"ok");
}
{
  const gate=deferred(),h=harness({confirm:()=>gate.promise});
  const first=h.remove("selected",ref);
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.calls.length,1,"confirmation comes before deletion");
  assert.deepEqual(plain(h.shots),records,"confirmation does not change references");
  await h.remove("selected",ref);
  assert.equal(h.calls.length,1,"duplicate click is latched");
  gate.resolve(false);await first;
  assert.equal(h.calls.length,1);
  assert.deepEqual(plain(h.shots),records);
}
for(const mutate of [
  h=>{h.allowed=false;},
  h=>{h.projIdRef.current="other-film";},
  h=>{h.epoch++;},
  h=>{h.shots[1].action="Writer edit";},
  h=>{h.__nbGenInflight={"selected":{}};},
  h=>{h.__nbShotPhase={"old-frame":true};},
  h=>{h.keyframeBusyRef.current.add("scene");},
]){
  const h=harness({confirm:async h=>{mutate(h);return true;}});
  await h.remove("selected",ref);
  assert.equal(h.calls.filter(c=>c[0]==="purge").length,0,"post-confirmation guard prevents deletion");
  assert.equal(h.shots[1].anchor,undefined);
  assert.equal(h.messages.at(-1).type,"error");
}
for(const config of [
  {prepare:async()=>({...ref,iso:"new-image"})},
  {prepare:async()=>({...ref,id:"different-image"})},
  {prepare:async()=>({...ref,version:4})},
]){
  const h=harness(config);await h.remove("selected",ref);
  assert.equal(h.confirmed.length,0);
  assert.equal(h.calls.filter(c=>c[0]==="purge").length,0);
}
{
  const h=harness();h.allowed=false;await h.remove("selected",ref);
  assert.equal(h.calls.length,0);
}
{
  const h=harness();await h.remove("selected",{...ref,iso:""});
  assert.equal(h.calls.length,0,"missing version identity is never guessed");
}
{
  const h=harness();await h.remove("selected",{...ref,id:"later"});
  assert.equal(h.calls.length,0,"callback cannot target an arbitrary image");
}
{
  const h=harness({purge:async()=>{throw new Error("Storage denied");}});
  await h.remove("selected",ref);
  assert.equal(h.shots[1].anchor,true,"failed storage deletion never silently reattaches unwanted reference");
  assert.equal(h.messages.at(-1).type,"error");
  assert.match(h.messages.at(-1).message,/not confirmed/);
  assert.deepEqual(h.busy,[true,false]);
  await h.remove("selected",ref);
  assert.equal(h.calls.filter(c=>c[0]==="purge").length,2,"failure releases UI operation latch");
}
{
  const h=harness({purge:async()=>({ok:true,cleanupWarning:"Storage cleanup pending"})});
  await h.remove("selected",ref);
  assert.equal(h.messages.at(-1).type,"error");
  assert.match(h.messages.at(-1).message,/not complete/);
  assert.equal(h.messages.some(m=>m.type==="ok"),false);
}
{
  const h=harness({prepare:async()=>({...ref,pending:true,storagePath:"original-pending-path"})});
  await h.remove("selected",{...ref,pending:true,url:""});
  assert.equal(h.confirmed[0].title,"Finish deleting this reference image?");
  assert.equal(h.confirmed[0].confirmLabel,"Retry image deletion");
  assert.match(h.confirmed[0].body,/previously selected image/);
  assert.equal(h.calls.find(c=>c[0]==="purge")[1].storagePath,"original-pending-path");
  assert.equal(h.messages.at(-1).type,"ok");
}
{
  const h=harness({prepare:async()=>({...ref,pending:true,retryable:false})});
  await h.remove("selected",{...ref,pending:true,url:""});
  assert.equal(h.confirmed.length,0,"immutable missing provenance is not presented as a retryable storage failure");
  assert.equal(h.calls.filter(c=>c[0]==="purge").length,0);
  assert.match(h.messages.at(-1).message,/insufficient version information/);
}
{
  const h=harness({purge:async(h,target,controls)=>{
    h.projIdRef.current="other-film";h.epoch++;
    assert.equal(controls.cancelled(),true);
    const newFilm=[{id:"new-film-shot"}];
    h.shots=newFilm;h.shotsLiveRef.current=newFilm;
    return {ok:true};
  }});
  await h.remove("selected",ref);
  assert.deepEqual(plain(h.shots),[{id:"new-film-shot"}],"late completion cannot alter new film");
  assert.equal(h.messages.some(m=>m.type==="ok"),false);
}
console.log("Shot reference deletion: real App confirmation, identity, exclusion, permission, scope, failure and preservation checks passed.");
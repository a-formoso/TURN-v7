#!/usr/bin/env node
/* Art Room persistence contracts against a recording Supabase fake.
   No provider credentials, network requests, or workspace data are used. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
let row=null, uploads=[], removed=[], failUpsert=false, uncertainUpsert=false, cancelled=false;
let cleanupFailures=0, insertRaceRow=null;
let readCount=0, failReadAt=0;
let uploadHook=null, removeHook=null, mutationHook=null, beforeMutationHook=null;
let lastMutationFilters=[];

class Query {
  constructor(){ this.op="read"; this.value=null; this.filters=[]; }
  select(){ return this; }
  eq(k,v){ this.filters.push([k,v,false]); return this; }
  is(k,v){ this.filters.push([k,v,true]); return this; }
  contains(k,v){ this.filters.push([k,v,"contains"]); return this; }
  update(v){ this.op="update"; this.value=v; return this; }
  upsert(v){ this.op="upsert"; this.value=v; return this; }
  insert(v){ this.op="insert"; this.value=v; return this; }
  delete(){ this.op="delete"; return this; }
  _matches(){
    return !!row && this.filters.every(([k,v,mode])=>mode==="contains"
      ? Object.keys(v).every(key=>row[k]&&row[k][key]===v[key])
      : mode ? row[k]==null&&v==null
      : (typeof v==="string"&&v.startsWith("{")||typeof v==="string"&&v.startsWith("["))
        ? JSON.stringify(row[k])===v : row[k]===v);
  }
  async _run(){
    if(this.op==="read"){
      readCount++;
      if(failReadAt===readCount) return {data:null,error:{message:"injected readback failure"}};
      return {data:this._matches() ? clone(row) : null,error:null};
    }
    lastMutationFilters=clone(this.filters);
    if(this.op==="insert"){
      if(insertRaceRow){ row=clone(insertRaceRow); insertRaceRow=null; return {data:null,error:{message:"duplicate key"}}; }
      if(row) return {data:null,error:{message:"duplicate key"}};
      if(failUpsert) return {data:null,error:{message:"injected insert failure"}};
      row=clone(this.value);
      if(uncertainUpsert) return {data:null,error:{message:"injected ambiguous response"}};
      if(mutationHook) mutationHook(this.op);
      return {data:clone(row),error:null};
    }
    if(this.op==="upsert"){
      if(failUpsert) return {data:null,error:{message:"injected upsert failure"}};
      row={...(row||{}),...clone(this.value)};
      if(uncertainUpsert) return {data:null,error:{message:"injected ambiguous response"}};
      if(mutationHook) mutationHook(this.op);
      return {data:clone(row),error:null};
    }
    if(beforeMutationHook){ const hook=beforeMutationHook; beforeMutationHook=null; hook(this.op); }
    if(!this._matches()) return {data:null,error:null};
    const prior=clone(row);
    if(this.op==="update") row={...row,...clone(this.value)};
    if(this.op==="delete") row=null;
    if(mutationHook) mutationHook(this.op);
    return {data:this.op==="delete"?prior:clone(row),error:null};
  }
  maybeSingle(){ return this._run(); }
  single(){ return this._run(); }
  then(resolve,reject){
    return Promise.resolve({data:row&&this._matches()?[clone(row)]:[],error:null}).then(resolve,reject);
  }
}

const storage={
  async upload(path,blob){
    uploads.push({path,size:blob.size});
    if(uploadHook) uploadHook();
    return {error:null};
  },
  async remove(paths){
    if(removeHook) removeHook();
    if(cleanupFailures>0){ cleanupFailures--; return {error:{message:"injected cleanup failure"}}; }
    removed.push(...paths); return {error:null};
  },
  async createSignedUrl(path){ return {data:{signedUrl:"signed:"+path},error:null}; },
  async createSignedUrls(paths){ return {data:paths.map(path=>({path,signedUrl:"signed:"+path})),error:null}; },
};
const sb={
  from(){ return new Query(); },
  storage:{from(){ return storage; }},
  auth:{refreshSession:async()=>({})},
};
const noop=()=>{};
const sandbox={
  console,Blob,Uint8Array,atob,Date,Math,Map,Set,JSON,Promise,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{},navigator:{},location:{origin:"https://app.test"},
  fetch:async()=>({ok:true,blob:async()=>new Blob(["REF"],{type:"image/png"})}),
  setTimeout,clearTimeout,setInterval,clearInterval,
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.window._sbClient=sb;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});

let pass=0,fail=0;
function ok(name,condition){
  if(condition) pass++;
  else{ fail++; console.error("FAIL "+name); }
}
function reset(next=null){
  row=clone(next); uploads=[]; removed=[]; failUpsert=false; cancelled=false;
  uncertainUpsert=false; cleanupFailures=0; insertRaceRow=null;
  readCount=0; failReadAt=0; uploadHook=null; removeHook=null; mutationHook=null; beforeMutationHook=null;
  lastMutationFilters=[];
}
const png="data:image/png;base64,QQ==";
/* fixture keys live in this film's folders ("user/film/…"): cleanup only ever removes keys inside the
   film it runs for (Stage editor review, 2026-10-09 — cloudPathInFilm) */
const commit=()=>sandbox.cloudCommit("film","user","asset",png,
  {iso:"2026-09-01T00:00:00.000Z",version:2,approval:{approved:true}},
  [],"character",()=>cancelled);
const old={
  project_id:"film",entity_id:"asset",owner:"user",storage_path:"user/film/asset/old-sheet",
  updated_at:"2026-09-01T00:00:00.000Z",
  meta:{iso:"2026-08-01T00:00:00.000Z"},refs:[{storage_path:"user/film/asset/old-ref"}],
  history:[{storage_path:"user/film/asset/older-sheet",refs:[{storage_path:"user/film/asset/older-ref"}]}],
};

reset(); failUpsert=true;
let result=await commit();
ok("failed upsert is not reported as upload success",result.tier==="error" && row===null);
ok("failed upsert removes its new unreferenced upload",uploads.length===1 && removed.includes(uploads[0].path));

reset(); uncertainUpsert=true; failReadAt=2;
result=await commit();
ok("uncertain write plus failed readback is reported without deleting possibly-live bytes",
  result.tier==="error" && result.persisted==="unknown" && row.storage_path===uploads[0].path
    && !removed.includes(uploads[0].path));

reset();
insertRaceRow={...old,storage_path:"user/film/asset/first-client-sheet"};
result=await commit();
ok("simultaneous first insert preserves the winner and requests an explicit retry",
  result.tier==="error" && result.retry===true && row.storage_path==="user/film/asset/first-client-sheet"
    && removed.includes(uploads[0].path));

reset(); cancelled=true;
result=await commit();
ok("cancellation before upload writes nothing",result.tier==="cancelled" && uploads.length===0 && row===null);

reset(); uploadHook=()=>{ cancelled=true; };
result=await commit();
ok("cancellation during upload removes only the new file",
  result.tier==="cancelled" && row===null && removed.length===1 && removed[0]===uploads[0].path);

reset(old);
let firstMutation=true;
mutationHook=()=>{ if(firstMutation){ firstMutation=false; cancelled=true; } };
result=await commit();
ok("cancellation during row write conditionally restores previous row",
  result.tier==="cancelled" && row.storage_path==="user/film/asset/old-sheet"
    && row.history[0].storage_path==="user/film/asset/older-sheet");
ok("compensation preserves old current, history, and references",
  !removed.includes("user/film/asset/old-sheet") && !removed.includes("user/film/asset/older-sheet")
    && !removed.includes("user/film/asset/old-ref") && !removed.includes("user/film/asset/older-ref"));

reset(old);
result=await commit();
ok("successful commit requires and returns the verified row",
  result.tier==="cloud" && row.storage_path===result.path && row.history[0].storage_path==="user/film/asset/old-sheet");
ok("existing-generation CAS uses only the compact updated-at token",
  lastMutationFilters.some(([k,v])=>k==="updated_at"&&v===old.updated_at)
    && !lastMutationFilters.some(([k])=>["meta","refs","history","storage_path"].includes(k)));
ok("new commit clears inherited approval",
  !Object.prototype.hasOwnProperty.call(row.meta,"approval"));

reset(old);
beforeMutationHook=()=>{ row.meta={...row.meta,approval:{iso:row.meta.iso,approved:true}}; row.updated_at="2026-09-01T00:00:01.000Z"; };
result=await commit();
ok("same-path concurrent metadata change refuses updated-at CAS",
  result.tier==="error" && row.storage_path==="user/film/asset/old-sheet" && row.meta.approval.approved===true);

reset(old);
beforeMutationHook=()=>{ row.history=[...row.history,{storage_path:"user/film/asset/concurrent-history"}]; row.updated_at="2026-09-01T00:00:01.000Z"; };
result=await commit();
ok("same-path concurrent history change is preserved and commit refused",
  result.tier==="error" && row.storage_path==="user/film/asset/old-sheet"
    && row.history.some(h=>h.storage_path==="user/film/asset/concurrent-history"));

reset({
  ...old,
  storage_path:"user/film/asset/current",
  refs:[{storage_path:"user/film/asset/shared-ref"}],
  history:[
    {storage_path:"user/film/asset/promoted",refs:[{storage_path:"user/film/asset/shared-ref"}]},
    {storage_path:"user/film/asset/remaining",refs:[{storage_path:"user/film/asset/remaining-ref"}]},
  ],
});
await sandbox.cloudDeleteCurrentAndPromote("film","user","asset");
ok("delete-current retains a reference shared by the resulting row",
  !removed.includes("user/film/asset/shared-ref") && removed.includes("user/film/asset/current"));

reset({
  ...old,
  storage_path:"user/film/asset/current",
  refs:[{storage_path:"user/film/asset/shared-ref"}],
  history:[
    {storage_path:"user/film/asset/historical",refs:[{storage_path:"user/film/asset/historical-ref"},{storage_path:"user/film/asset/shared-ref"}]},
    {storage_path:"user/film/asset/remaining",refs:[]},
  ],
});
const deleted=await sandbox.cloudDeleteHistoryEntry("film","user","asset",0);
ok("history deletion occurs only after its row mutation succeeds",
  deleted===true && row.history.length===1 && row.history[0].storage_path==="user/film/asset/remaining");
ok("history deletion removes historical refs but keeps retained shared refs",
  removed.includes("user/film/asset/historical") && removed.includes("user/film/asset/historical-ref") && !removed.includes("user/film/asset/shared-ref"));

const longHistory=Array.from({length:12},(_,i)=>({storage_path:"user/film/asset/history-"+i,refs:[]}));
reset({...old,history:longHistory}); cleanupFailures=2;
result=await commit();
ok("successful save remains cloud success when trim cleanup fails",
  result.tier==="cloud" && !!result.cleanupWarning && row.storage_path===result.path
    && row.meta.cleanupPending.includes("user/film/asset/history-11"));
cleanupFailures=0;
await sandbox.cloudGetGen("film","asset");
ok("later load retries durable trim cleanup and clears its marker",
  removed.includes("user/film/asset/history-11") && !row.meta.cleanupPending);

reset({...old,history:longHistory}); cleanupFailures=2;
removeHook=()=>{ cancelled=true; };
result=await commit();
ok("stop during final cleanup with unsafe rollback is surfaced, not discarded",
  result.tier==="cancellation-error" && result.persisted===true
    && row.storage_path===result.path && !!result.cleanupWarning);

reset({...old,storage_path:"user/film/asset/clear-current"}); cleanupFailures=2;
const cleared=await sandbox.cloudClear("film","asset");
ok("clear writes a durable tombstone before failed cleanup",
  cleared.ok && !!cleared.cleanupWarning && row.storage_path===null
    && row.meta.cleanupTombstone===true && row.meta.cleanupPending.includes("user/film/asset/clear-current"));
cleanupFailures=0;
await sandbox.cloudAssetLoadAll("film");
ok("project prewarm discovers and retries a tombstone without a card-specific read",
  row===null && removed.includes("user/film/asset/clear-current"));

reset({...old,meta:{iso:"2026-09-10T10:00:00.000Z"}});
let approval=await sandbox.cloudSetAssetApproval("film","user","asset",
  "2026-09-10T10:00:00.000Z",true,"spec-and-refs-v3");
ok("approval updates the same generation without changing image or history",
  approval.ok && row.storage_path==="user/film/asset/old-sheet" && row.history[0].storage_path==="user/film/asset/older-sheet"
    && row.meta.approval.iso===row.meta.iso && row.meta.approval.approved===true);
ok("approval saves the reviewed spec/reference context",
  row.meta.approval.reviewKey==="spec-and-refs-v3");
const approvedAt=row.meta.approval.at;
approval=await sandbox.cloudSetAssetApproval("film","user","asset",
  "2026-09-09T10:00:00.000Z",false);
ok("stale approval is explicitly refused without mutation",
  approval.ok===false && row.meta.approval.at===approvedAt);

reset(old);
result=await sandbox.cloudCommit("film","user","asset",png,{iso:"reviewed"},[],"location",undefined,undefined,{exists:true,iso:"outdated"});
ok("reviewed replacement refuses a stale base before uploading",result.tier==="error"&&uploads.length===0&&row.meta.iso===old.meta.iso);
reset(old);
result=await sandbox.cloudCommit("film","user","asset",png,{iso:"reviewed"},[],"location",undefined,undefined,{exists:false,iso:""});
ok("reviewed first artwork cannot replace an image created in the meantime",result.tier==="error"&&uploads.length===0);
reset(old);
result=await sandbox.cloudCommit("film","user","asset",png,{iso:"reviewed"},[],"location",undefined,undefined,{exists:true,iso:old.meta.iso});
ok("reviewed replacement with the exact base preserves prior artwork",result.tier==="cloud"&&row.history[0].storage_path===old.storage_path);

console.log(fail?`${fail} failed (${pass} passed)`:`${pass} passed, 0 failed`);
process.exit(fail?1:0);

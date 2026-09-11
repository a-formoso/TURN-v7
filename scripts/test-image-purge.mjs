#!/usr/bin/env node
/* Exact-image permanent-purge contracts.  This is a recording Supabase/
   Storage adapter: no network, secrets, live rows, or real deletes. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const clone=value=>JSON.parse(JSON.stringify(value));
let rows=[], removed=[], uploads=[], failPaths=new Set(), beforeUpdate=null, onRemove=null;
let unboundedScans=0;
const rowFor=(entity)=>rows.find(row=>String(row.entity_id)===String(entity));

function query(){
  const filters=[]; let mutation=null, range=null;
  const q={
    select(){ return q; },
    eq(key,value){ filters.push([key,value]); return q; },
    in(key,values){ filters.push(["__in",key,(values||[]).map(String)]); return q; },
    order(){ return q; },
    range(from,to){ range=[from,to]; return q; },
    update(fields){ mutation={kind:"update",fields}; return q; },
    delete(){ mutation={kind:"delete"}; return q; },
    insert(value){ mutation={kind:"insert",value}; return q; },
    maybeSingle(){ return Promise.resolve(run(true)); },
    single(){ return Promise.resolve(run(true)); },
    then(resolve,reject){ return Promise.resolve(run(false)).then(resolve,reject); },
  };
  function matches(row){ return filters.every(filter=>{
    if(filter[0]==="__in") return filter[2].includes(String((row&&row[filter[1]])??""));
    return String((row&&row[filter[0]])??"")===String(filter[1]??"");
  }); }
  function run(single){
    if(range&&!filters.some(([key])=>key==="entity_id"||key==="__in")) unboundedScans++;
    if(mutation&&mutation.kind==="update"&&beforeUpdate) beforeUpdate(filters,mutation);
    let selected=rows.filter(matches);
    if(range) selected=selected.slice(range[0],range[1]+1);
    if(mutation&&mutation.kind==="update"){
      selected.forEach(row=>{
        Object.assign(row,clone(mutation.fields));
        row.updated_at="written-"+Date.now();
      });
    }else if(mutation&&mutation.kind==="delete"){
      rows=rows.filter(row=>!matches(row));
    }else if(mutation&&mutation.kind==="insert"){
      rows.push(clone(mutation.value));
    }
    return {data:single?(selected[0]?clone(selected[0]):null):clone(selected),error:null};
  }
  return q;
}

const storage={
  createSignedUrl:async path=>({data:{signedUrl:"signed:"+path},error:null}),
  createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:"signed:"+path})),error:null}),
  upload:async(path,_blob)=>{ uploads.push(path); return {data:{path},error:null}; },
  remove:async paths=>{
    if(onRemove){ const hook=onRemove; onRemove=null; await hook(); }
    const failed=paths.filter(path=>failPaths.has(path));
    paths.filter(path=>!failPaths.has(path)).forEach(path=>removed.push(path));
    return failed.length ? {error:{message:"recorded storage failure"}} : {error:null};
  },
};
const sb={
  from:()=>query(),
  storage:{from:()=>storage},
  auth:{getSession:async()=>({data:{session:null}})},
};

const noop=()=>{};
const sandbox={
  console,Date,Math,Map,Set,JSON,Promise,Blob,Uint8Array,atob,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{},navigator:{},location:{origin:"https://test.invalid"},
  fetch:async()=>({ok:true,blob:async()=>new Blob(["pixels"],{type:"image/png"})}),
  setTimeout,clearTimeout,setInterval,clearInterval,
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.window._sbClient=sb;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});

let pass=0,fail=0;
const ok=(name,condition,detail)=>{
  if(condition) pass++;
  else{ fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); }
};
const sourcePath="u/p/shot/source/current.png";
const oldPath="u/p/shot/source/old.png";
const copyPath="u/p/shot/dependent/base-copy.png";
const makeRows=(path=sourcePath,iso="source-iso")=>[
  {project_id:"p",owner:"u",entity_id:"source",storage_path:path,updated_at:"source-1",
    meta:{iso,version:4,specification:"retain-me"},refs:[],
    history:[{storage_path:oldPath,meta:{iso:"old-iso",version:3},refs:[]}]},
  {project_id:"p",owner:"u",entity_id:"dependent",storage_path:"u/p/shot/dependent/current.png",
    updated_at:"dependent-1",meta:{iso:"dependent-iso",version:1},refs:[
      {kind:"base",label:"source",storage_path:copyPath,refId:"source",refGenerated:iso},
      {kind:"base",label:"unidentified",storage_path:"u/p/shot/dependent/legacy.png"},
    ],history:[{storage_path:"u/p/shot/dependent/old.png",meta:{iso:"dep-old"},refs:[]}]},
  {project_id:"p",owner:"u",entity_id:"clip-video",updated_at:"video-1",
    meta:{kind:"video",video:{url:"video-must-remain"}},refs:[],history:[]},
];

rows=makeRows();
const target=await sandbox.cloudPrepareImageDeletion("p","source");
ok("prepare returns direct immutable exact identity",
  target.id==="source"&&target.scope==="p"&&target.backend==="cloud"
    &&target.storagePath===sourcePath&&target.iso==="source-iso"&&target.version===4
    &&Object.isFrozen(target));
try{ target.iso="tampered"; }catch(e){}
ok("prepared target is immutable",target.iso==="source-iso");

/* A stale ISO is a refusal, not a best-effort delete of whatever is current. */
rows=makeRows(); rows[0].meta.iso="newer-iso"; removed=[];
let stale=await sandbox.cloudPurgeImageVersion("p","u",target);
ok("stale current refuses exact purge",stale.ok===false&&removed.length===0&&rowFor("source").storage_path===sourcePath);

rows=makeRows(); removed=[]; failPaths=new Set();
let purged=await sandbox.cloudPurgeImageVersion("p","u",target);
const source=rowFor("source"), dependent=rowFor("dependent");
ok("purge clears current without promoting history",
  purged.ok&&purged.url===""&&purged.meta===null&&source.storage_path===null
    &&source.history.length===1&&source.history[0].storage_path===oldPath);
ok("purge retains specifications and videos",
  source.meta.specification==="retain-me"&&rowFor("clip-video").meta.video.url==="video-must-remain");
ok("exact matching reference snapshot is deleted with evidence",
  dependent.refs[0].deleted===true&&!dependent.refs[0].storage_path
    &&removed.includes(copyPath));
ok("unidentifiable older snapshot is retained with warning",
  !!purged.cleanupWarning&&dependent.refs[1].storage_path
    &&removed.includes(sourcePath)&&!removed.includes(dependent.refs[1].storage_path));

/* A supported writer racing the purge after its final verified project scan
   is fenced by the durable receipt.  The derived output survives, but its
   newly requested source copy is persisted as deleted evidence (and is never
   uploaded because the preflight receipt is already present). */
rows=makeRows(); rows[1].refs=[rows[1].refs[0]]; removed=[]; uploads=[];
const raceCommitTarget=await sandbox.cloudPrepareImageDeletion("p","source");
let racedCommit=null;
onRemove=async()=>{
  racedCommit=await sandbox.cloudCommit("p","u","dependent","data:image/png;base64,AAAA",
    {iso:"dependent-next",version:2},
    [{kind:"base",label:"source",url:"data:image/png;base64,BBBB",
      refId:"source",refGenerated:"source-iso"}],"character",null,{});
};
const purgeDuringCommit=await sandbox.cloudPurgeImageVersion("p","u",raceCommitTarget);
const lateRow=rowFor("dependent");
ok("post-final-scan cloud commit fences late source copy",
  purgeDuringCommit.ok&&racedCommit&&racedCommit.tier==="cloud"
    &&lateRow.refs[0].deleted===true&&!lateRow.refs[0].storage_path
    &&uploads.length===1 /* derived output only; no ref upload */
    &&removed.includes(raceCommitTarget.storagePath));

/* Completed receipts remain on the source metadata when a new current output is
   later written, so a future slot cannot resurrect the deleted ISO. */
unboundedScans=0;
const sourceNext=await sandbox.cloudCommit("p","u","source","data:image/png;base64,CCCC",
  {iso:"source-next",version:5},
  [{kind:"base",label:"old-source",url:"data:image/png;base64:DDDD",
    refId:"source",refGenerated:"source-iso"}],"character",null,{});
ok("purge receipt survives future source generation",
  sourceNext.tier==="cloud"&&rowFor("source").storage_path
    &&rowFor("source").refs[0].deleted===true
    &&rowFor("source").meta.cleanupPurgeTarget.storagePath===raceCommitTarget.storagePath
    &&unboundedScans===0);

/* History actions replace current metadata, so the generic CAS boundary must
   carry a completed V3 receipt into a promoted V2 without restoring V3 pixels
   or pending paths.  A later supported commit referencing V3 is still fenced. */
rows=makeRows(); removed=[]; uploads=[];
const v3Target=await sandbox.cloudPrepareImageDeletion("p","source");
await sandbox.cloudPurgeImageVersion("p","u",v3Target);
const reverted=await sandbox.cloudRevert("p","u","source",0);
const revertedSource=rowFor("source");
const postRevertCommit=await sandbox.cloudCommit("p","u","dependent",
  "data:image/png;base64,AAAA",{iso:"dependent-after-revert",version:3},
  [{kind:"base",label:"purged-v3",url:"data:image/png;base64:BBBB",
    refId:"source",refGenerated:"source-iso"}],"character",null,{});
ok("revert preserves V3 receipt and fences later reference",
  reverted&&revertedSource.storage_path===oldPath
    &&revertedSource.meta.cleanupPurgeReceipts.some(r=>r.storagePath===v3Target.storagePath)
    &&!revertedSource.meta.cleanupPending
    &&postRevertCommit.tier==="cloud"
    &&rowFor("dependent").refs[0].deleted===true
    &&!rowFor("dependent").refs[0].storage_path
    &&uploads.length===1,JSON.stringify({reverted,revertedSource,row:rowFor("dependent"),uploads,postRevertCommit}));

/* A legacy writer that bypasses the supported pre/post fence is repaired by
   the bounded authorized generation refresh sweep. */
const legacyPath="u/p/shot/dependent/legacy-late-copy.png";
rowFor("dependent").refs=[{kind:"base",storage_path:legacyPath,
  refId:"source",refGenerated:"source-iso"}];
removed=[];
const swept=await sandbox.cloudSweepPurgeReferences("p");
ok("authorized refresh sweep fences legacy late commit",
  swept.ok&&swept.rewritten>0&&rowFor("dependent").refs[0].deleted===true
    &&removed.includes(legacyPath));

/* The same target is idempotent after cleanup; it never selects history. */
rows=makeRows(); removed=[]; failPaths=new Set();
await sandbox.cloudPurgeImageVersion("p","u",target);
const retry=await sandbox.cloudPurgeImageVersion("p","u",target);
ok("unverified warning is disclosed without endless retry",
  retry.ok===false&&retry.retryable===false&&retry.status==="retained-unverified"
    &&rowFor("source").storage_path===null);

/* Deleted evidence cannot be rehydrated through current/previous fallback. */
let detail=await sandbox.cloudLoadDetails("p","dependent");
ok("deleted refs never recover live or previous pixels",
  detail.refs[0].deleted===true&&detail.refs[0].url===""&&!detail.refs[0].recovered);

/* Partial exact Storage cleanup leaves a durable pending ledger and warning. */
const partialPath="u/p/shot/partial/current.png";
rows=makeRows(partialPath,"partial-iso");
const partialTarget=await sandbox.cloudPrepareImageDeletion("p","source");
failPaths=new Set([partialPath]); removed=[];
let partial=await sandbox.cloudPurgeImageVersion("p","u",partialTarget);
ok("partial cleanup is truthful and durable",
  partial.ok&&!!partial.cleanupWarning&&rowFor("source").meta.cleanupTombstone===true
    &&rowFor("source").meta.cleanupPending.includes(partialPath)
    &&rowFor("source").storage_path===null);
const pendingPartial=await sandbox.cloudLoadPendingImageDeletion("p","source");
ok("pending API exposes immutable tombstone target before retry",
  pendingPartial&&pendingPartial.pending&&pendingPartial.storagePath===partialPath
    &&pendingPartial.retryable===true&&Object.isFrozen(pendingPartial));
failPaths=new Set();
let finished=await sandbox.cloudPurgeImageVersion("p","u",partialTarget);
ok("same target retries pending cleanup",finished.ok
  &&!rowFor("source").meta.cleanupPending&&removed.includes(partialPath),JSON.stringify({finished,row:rowFor("source"),removed}));
const pendingAfterPartial=await sandbox.cloudLoadPendingImageDeletion("p","source");
ok("pending target survives reload and prepare remains exact",
  pendingAfterPartial&&pendingAfterPartial.pending
    &&pendingAfterPartial.storagePath===partialPath
    &&pendingAfterPartial.retryable===false
    &&pendingAfterPartial.status==="retained-unverified"
    &&Object.isFrozen(pendingAfterPartial));

/* A copy attached after the tombstone was written is unioned into the source
   ledger on retry, including its exact path. */
const lateCopy="u/p/shot/dependent/late-copy.png";
rowFor("dependent").refs.push({kind:"base",storage_path:lateCopy,refId:"source",refGenerated:"partial-iso"});
removed=[];
let lateRetry=await sandbox.cloudPurgeImageVersion("p","u",partialTarget);
ok("retry tombstones a newly attached exact copy",
  lateRetry.ok&&removed.includes(lateCopy)&&!rowFor("source").meta.cleanupPending
    &&rowFor("dependent").refs.at(-1).deleted===true);

/* A row CAS race refuses before deleting the exact object. */
rows=makeRows("u/p/shot/race/current.png","race-iso");
const raceTarget=await sandbox.cloudPrepareImageDeletion("p","source");
removed=[]; let raced=false;
beforeUpdate=(filters)=>{
  if(!raced&&filters.some(([key,value])=>key==="entity_id"&&value==="source")){
    raced=true; const r=rowFor("source"); r.updated_at="concurrent-write";
  }
};
let race=await sandbox.cloudPurgeImageVersion("p","u",raceTarget);
beforeUpdate=null;
ok("CAS race refuses without storage deletion",
  race.ok===false&&removed.length===0&&rowFor("source").storage_path===raceTarget.storagePath,JSON.stringify({race,row:rowFor("source"),removed}));

/* Reference evidence may commit before the source CAS.  A retry recovers its
   deletedStoragePath instead of losing that exact object from the ledger. */
rows=makeRows("u/p/shot/interrupted/current.png","interrupted-iso");
const interruptedTarget=await sandbox.cloudPrepareImageDeletion("p","source");
removed=[]; let sourceRace=false;
beforeUpdate=(filters)=>{
  if(!sourceRace&&filters.some(([key,value])=>key==="entity_id"&&value==="source")){
    sourceRace=true; rowFor("source").updated_at="late-source-write";
  }
};
let interrupted=await sandbox.cloudPurgeImageVersion("p","u",interruptedTarget);
beforeUpdate=null;
ok("interrupted source CAS leaves reference evidence durable",
  interrupted.ok===false&&rowFor("source").storage_path===interruptedTarget.storagePath
    &&rowFor("dependent").refs[0].deleted===true
    &&rowFor("dependent").refs[0].deletedStoragePath===copyPath
    &&removed.length===0);
let interruptedRetry=await sandbox.cloudPurgeImageVersion("p","u",interruptedTarget);
ok("retry recovers deleted evidence path into source cleanup",
  interruptedRetry.ok&&rowFor("source").storage_path===null
    &&removed.includes(copyPath)&&removed.includes(interruptedTarget.storagePath));

console.log(fail?`${fail} failed (${pass} passed)`:`${pass} passed, 0 failed`);
process.exit(fail?1:0);
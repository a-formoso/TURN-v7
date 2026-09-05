#!/usr/bin/env node
/* Functional cloud reference-thumbnail contracts. Runs cloud.jsx in a browser-like
   VM with a recording Supabase adapter; no network or workspace data is touched. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop=()=>{};
let row=null, assetRows=[], uploads=[], upserted=null;
const signed=(p)=>p?("signed:"+p):"";
const makeQuery=()=>({
  select(){ return this; }, eq(){ return this; }, in(_k,ids){
    return Promise.resolve({data:assetRows.filter(r=>ids.includes(r.entity_id)),error:null});
  }, maybeSingle(){ return Promise.resolve({data:row,error:null}); },
  upsert(v){ upserted=v; return this; }, single(){ return Promise.resolve({data:upserted,error:null}); },
});
const storage={
  upload:async(path,blob)=>{ uploads.push({path,type:blob.type,size:blob.size}); return {error:null}; },
  createSignedUrl:async(path)=>({data:{signedUrl:signed(path)},error:null}),
  createSignedUrls:async(paths)=>({data:paths.map(path=>({path,signedUrl:signed(path)})),error:null}),
  remove:async()=>({error:null}),
};
const sb={
  from:()=>makeQuery(),
  storage:{from:()=>storage},
  auth:{refreshSession:async()=>({}),getSession:async()=>({data:{session:null}})},
};
const sandbox={
  console,Blob,Uint8Array,atob,
  Date,Math,Map,Set,JSON,Promise,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{},navigator:{},location:{origin:"https://app.test"},
  fetch:async()=>({ok:true,blob:async()=>new Blob(["REFERENCE"],{type:"image/jpeg"})}),
  setTimeout,clearTimeout,setInterval,clearInterval,
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.window._sbClient=sb;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});

let pass=0,fail=0;
const ok=(name,cond)=>{ if(cond) pass++; else{ fail++; console.log("FAIL "+name); } };

row=null; assetRows=[]; uploads=[]; upserted=null;
await sandbox.cloudCommit("film-1","user-1","char-1","data:image/png;base64,QQ==",
  {version:1},[{kind:"prop",label:"Coat",url:"https://storage.test/signed-coat",refId:"prop-1",
    refVersion:7,refGenerated:"2026-09-05T09:00:00.000Z"}],"character");
ok("remote project reference is snapshotted beside generated sheet",
  uploads.length===2 && uploads[1].type==="image/jpeg");
ok("snapshot path and stable source id are persisted",
  !!(upserted&&upserted.refs&&upserted.refs[0].storage_path)
    && upserted.refs[0].refId==="prop-1");
ok("snapshot persists exact source version",
  upserted.refs[0].refVersion===7
    && upserted.refs[0].refGenerated==="2026-09-05T09:00:00.000Z");

row={
  storage_path:"character/current.png",meta:{mode:"base"},
  refs:[
    {kind:"base",label:"Base sheet",storage_path:null},
    {kind:"prop",label:"Coat",storage_path:null,refId:"prop-1",refVersion:4},
  ],
  history:[{storage_path:"character/previous.png",meta:{version:2}}],
};
assetRows=[{entity_id:"prop-1",storage_path:"prop/current.png",meta:{version:8}}];
let details=await sandbox.cloudLoadDetails("film-1","char-1");
ok("legacy base reference recovers exact previous version",
  details.refs[0].url==="signed:character/previous.png"
    && details.refs[0].recovered==="previous-version"
    && details.refs[0].refVersion===2);
ok("legacy id-backed reference recovers current project asset",
  details.refs[1].url==="signed:prop/current.png"
    && details.refs[1].recovered==="current-project-asset"
    && details.refs[1].refVersion===4
    && details.refs[1].resolvedVersion===8);

row={
  storage_path:"character/current.png",meta:{version:3},
  refs:[],
  history:[
    {storage_path:"character/v2.png",meta:{version:2},refs:[
      {kind:"prop",label:"Coat",storage_path:"refs/coat-v6.png",refId:"prop-1",refVersion:6},
    ]},
  ],
};
assetRows=[];
details=await sandbox.cloudLoadDetails("film-1","char-1");
ok("earlier generation keeps its own reference list and source version",
  details.history[0].refs[0].url==="signed:refs/coat-v6.png"
    && details.history[0].refs[0].refVersion===6);

row={
  storage_path:"state/current.png",meta:{mode:"base"},
  refs:[{kind:"base",label:"Base sheet",storage_path:null}],
  history:[],
};
assetRows=[{entity_id:"char-parent",storage_path:"character/parent.png",meta:{version:5}}];
details=await sandbox.cloudLoadDetails("film-1","char-parent:state-1");
ok("legacy state sheet infers and resolves parent reference",
  details.refs[0].url==="signed:character/parent.png"
    && details.refs[0].recovered==="current-project-asset"
    && details.refs[0].refVersion===5);

console.log(fail?`${fail} failed (${pass} passed)`:`${pass} passed, 0 failed`);
process.exit(fail?1:0);
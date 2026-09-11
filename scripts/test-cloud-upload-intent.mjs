#!/usr/bin/env node
/* Functional contract for image saves against Supabase projects at different
   migration levels. Runs the real cloud.jsx in a VM with a recording adapter;
   no network, workspace data or paid generation is touched.

   Background: the client reserves an exact Storage key through the
   turn_begin_asset_upload RPC (installed by supabase/series-production.sql).
   On a database without that migration, PostgREST answers PGRST202 and every
   sheet save used to fail with an unexplained "image upload failed". */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop=()=>{};
function makeWorld(rpcImpl){
  const world={uploads:[],removed:[],rpcCalls:[],rows:new Map()};
  const key=(v)=>v.project_id+"|"+v.entity_id;
  const makeQuery=()=>{
    let pending=null, mode="select";
    const q={
      select(){ return q; }, eq(){ return q; }, is(){ return q; },
      in(){ return Promise.resolve({data:[],error:null}); },
      maybeSingle(){ return Promise.resolve({data:pending||null,error:null}); },
      single(){ return Promise.resolve({data:pending||null,error:null}); },
      insert(v){ mode="insert"; pending={...v,updated_at:"t1"}; world.rows.set(key(v),pending); return q; },
      upsert(v){ mode="upsert"; pending={...v,updated_at:"t1"}; world.rows.set(key(v),pending); return q; },
      update(v){ mode="update"; pending={...(pending||{}),...v,updated_at:"t2"}; return q; },
      delete(){ mode="delete"; return q; },
    };
    return q;
  };
  const storage={
    upload:async(path,blob)=>{ world.uploads.push({path,type:blob.type,size:blob.size}); return {error:null}; },
    createSignedUrl:async(path)=>({data:{signedUrl:"signed:"+path},error:null}),
    createSignedUrls:async(paths)=>({data:paths.map(path=>({path,signedUrl:"signed:"+path})),error:null}),
    remove:async(paths)=>{ world.removed.push(...paths); return {error:null}; },
  };
  const sb={
    from:()=>makeQuery(),
    storage:{from:()=>storage},
    rpc:async(name,args)=>{ world.rpcCalls.push(name); return rpcImpl(name,args); },
    auth:{refreshSession:async()=>({}),getSession:async()=>({data:{session:null}})},
  };
  const sandbox={
    console:{...console,warn:(m)=>{ world.warned=(world.warned||[]).concat([String(m)]); }},
    Blob,Uint8Array,atob,Date,Math,Map,Set,JSON,Promise,
    localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
    document:{},navigator:{},location:{origin:"https://app.test"},
    fetch:async()=>({ok:false}),
    setTimeout,clearTimeout,setInterval,clearInterval,
  };
  sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.window._sbClient=sb;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});
  world.sandbox=sandbox;
  return world;
}
const missing=(name)=>({data:null,error:{code:"PGRST202",
  message:"Could not find the function public."+name+"(p_path, p_project_id) in the schema cache"}});

let pass=0,fail=0;
const ok=(name,cond)=>{ if(cond) pass++; else{ fail++; console.log("FAIL "+name); } };
const PNG="data:image/png;base64,iVBORw0KGgo=";

/* 1. Migrated database: the intent RPC exists and is honoured. */
{
  const w=makeWorld(async()=>({data:true,error:null}));
  const r=await w.sandbox.cloudCommit("film-1","user-1","shot-1",PNG,{version:1},[],"shot");
  ok("migrated db: sheet saves to cloud", r&&r.tier==="cloud" && w.uploads.length===1);
  ok("migrated db: begin and finish intents are both called",
    w.rpcCalls.includes("turn_begin_asset_upload") && w.rpcCalls.includes("turn_finish_asset_upload"));
}

/* 2. Pre-migration database (the reported failure): PGRST202 for the intent
   RPC must degrade to the legacy upload contract, not block every save. */
{
  const w=makeWorld(async(name)=>missing(name));
  const r=await w.sandbox.cloudCommit("film-1","user-1","shot-1",PNG,{version:1},[],"shot");
  ok("pre-migration db: sheet still saves to cloud", r&&r.tier==="cloud" && w.uploads.length===1);
  ok("pre-migration db: nothing is compensated/removed", w.removed.length===0);
  ok("pre-migration db: operator is warned once about the missing migration",
    Array.isArray(w.warned) && w.warned.length===1 && /series-production\.sql/.test(w.warned[0]));
  const r2=await w.sandbox.cloudCommit("film-1","user-1","shot-2",PNG,{version:1},[],"shot");
  ok("pre-migration db: later saves skip the absent RPC instead of re-probing",
    r2&&r2.tier==="cloud" && w.rpcCalls.filter(n=>n==="turn_begin_asset_upload").length===1);
}

/* 3. A real refusal (deleted project / revoked membership) must still block
   the upload and tell the user why. */
{
  const w=makeWorld(async()=>({data:null,error:{code:"42501",message:"upload not permitted for this project"}}));
  const r=await w.sandbox.cloudCommit("film-1","user-1","shot-1",PNG,{version:1},[],"shot");
  ok("refused intent: no bytes are uploaded", w.uploads.length===0);
  ok("refused intent: error names the refusal",
    r&&r.tier==="error" && /upload not permitted for this project/.test(r.error||""));
}

/* 4. Storage rejection is reported verbatim rather than as a generic failure. */
{
  const w=makeWorld(async()=>({data:true,error:null}));
  w.sandbox.window._sbClient.storage.from=()=>({
    upload:async()=>({error:{message:"new row violates row-level security policy"}}),
    remove:async(paths)=>{ w.removed.push(...paths); return {error:null}; },
  });
  const r=await w.sandbox.cloudCommit("film-1","user-1","shot-1",PNG,{version:1},[],"shot");
  ok("storage rejection: error carries the storage message",
    r&&r.tier==="error" && /row-level security/.test(r.error||""));
}

/* 5. A non-data URL sheet cannot be uploaded and says so. */
{
  const w=makeWorld(async()=>({data:true,error:null}));
  const r=await w.sandbox.cloudCommit("film-1","user-1","shot-1","https://cdn.test/frame.png",{version:1},[],"shot");
  ok("non-data-url sheet: error explains the input shape",
    r&&r.tier==="error" && /not a data URL/.test(r.error||"") && w.uploads.length===0);
}

/* 6. Concurrent failing saves must each report their own reason. The RPC for
   shot-A is held until shot-B has already failed, so a shared failure slot
   would report B's reason for A (or nothing at all). */
{
  let releaseA; const gateA=new Promise(r=>{ releaseA=r; });
  const w=makeWorld(async(name,args)=>{
    if(name!=="turn_begin_asset_upload") return {data:true,error:null};
    if(/\/shot-A\//.test(args.p_path)){ await gateA; return {data:null,error:{code:"42501",message:"ERROR-A"}}; }
    return {data:null,error:{code:"42501",message:"ERROR-B"}};
  });
  const a=w.sandbox.cloudCommit("film-1","user-1","shot-A",PNG,{version:1},[],"shot");
  const b=await w.sandbox.cloudCommit("film-1","user-1","shot-B",PNG,{version:1},[],"shot");
  releaseA();
  const ra=await a;
  ok("concurrent failures: B reports its own reason", b.tier==="error" && /ERROR-B/.test(b.error||""));
  ok("concurrent failures: A reports its own reason after B finished",
    ra.tier==="error" && /ERROR-A/.test(ra.error||"") && !/ERROR-B/.test(ra.error||""));
}

console.log(fail?`${fail} failed (${pass} passed)`:`${pass} passed, 0 failed`);
process.exit(fail?1:0);

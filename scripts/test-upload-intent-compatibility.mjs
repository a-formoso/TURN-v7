#!/usr/bin/env node
/* Upload-intent compatibility contracts. This is a dependency-free fake Supabase
   exercise: no provider credentials, network, model, or workspace data are used. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const png="data:image/png;base64,QQ==";
let passed=0, failed=0;
const ok=(name, condition)=>{
  if(condition) passed++;
  else{ failed++; console.error("FAIL "+name); }
};

function harness(options={}){
  const state={
    row:null, uploads:[], removed:[], rpcCalls:[], order:[], warnings:[],
    storageError:options.storageError||null, storageThrow:options.storageThrow||null,
    rpcMode:options.rpcMode||"modern", fetchCalls:0,
  };
  const matches=(row,filters)=>!!row && filters.every(([key,value])=>row[key]===value);
  class Query{
    constructor(){ this.op="read"; this.value=null; this.filters=[]; }
    select(){ state.order.push("select"); return this; }
    eq(key,value){ this.filters.push([key,value]); return this; }
    update(value){ this.op="update"; this.value=value; state.order.push("update"); return this; }
    insert(value){ this.op="insert"; this.value=value; state.order.push("insert"); return this; }
    delete(){ this.op="delete"; state.order.push("delete"); return this; }
    async _run(){
      if(this.op==="read"){
        return {data:matches(state.row,this.filters)?clone(state.row):null,error:null};
      }
      if(this.op==="insert"){
        if(state.row) return {data:null,error:{code:"23505",status:409,message:"duplicate key"}};
        state.row=clone(this.value);
        return {data:clone(state.row),error:null};
      }
      if(!matches(state.row,this.filters)) return {data:null,error:null};
      const prior=clone(state.row);
      if(this.op==="update") state.row={...state.row,...clone(this.value)};
      if(this.op==="delete") state.row=null;
      return {data:this.op==="delete"?prior:clone(state.row),error:null};
    }
    single(){ return this._run(); }
    maybeSingle(){ return this._run(); }
    then(resolve,reject){ return this._run().then(resolve,reject); }
  }
  const storage={
    async upload(path,blob){
      state.order.push("upload");
      state.uploads.push({path,size:blob.size,type:blob.type});
      if(state.storageThrow) throw state.storageThrow;
      if(options.failReference&&/\/ref-/.test(path))
        return {error:{status:403,code:"42501",message:"reference snapshot denied"}};
      return {error:state.storageError};
    },
    async remove(paths){
      state.order.push("remove");
      state.removed.push(...paths);
      return {error:null};
    },
    async createSignedUrl(path){
      state.order.push("sign");
      return {data:{signedUrl:"signed:"+path},error:null};
    },
  };
  const sb={
    from:()=>new Query(),
    storage:{from:()=>storage},
    auth:{getSession:async()=>options.sessionFailure
      ? {data:{session:null},error:{status:401,code:"AUTH_SESSION",message:"JWT expired"}}
      : {data:{session:{user:{id:"member-scope"}}},error:null}},
    rpc:async(name,args)=>{
      state.rpcCalls.push({name,args:clone(args)});
      state.order.push("rpc:"+name);
      if(name==="turn_begin_asset_upload"){
        if(state.rpcMode==="missing") return {
          status:404,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path,p_project_id) in schema cache"},
        };
        if(state.rpcMode==="missing-reverse") return {
          status:404,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload( p_project_id , p_path ) in schema cache"},
        };
        if(state.rpcMode==="missing-no-status") return {
          data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path,p_project_id) in schema cache"},
        };
        if(state.rpcMode==="unrelated-missing") return {
          status:404,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_other_helper(p_path,p_project_id) in schema cache"},
        };
        if(state.rpcMode==="wrong-args") return {
          status:404,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path,p_other_id) in schema cache"},
        };
        if(state.rpcMode==="missing-params") return {
          status:404,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path) in schema cache"},
        };
        if(state.rpcMode==="postgres-missing") return {
          status:428,data:null,error:{code:"42883",
            message:"function public.turn_begin_asset_upload(uuid,text) does not exist"},
        };
        if(state.rpcMode==="server") return {
          status:500,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path,p_project_id) in schema cache"},
        };
        if(state.rpcMode==="pgrst403") return {
          status:403,data:null,error:{code:"PGRST202",
            message:"Could not find public.turn_begin_asset_upload(p_path,p_project_id) in schema cache"},
        };
        if(state.rpcMode==="permission") return {
          status:403,data:null,error:{code:"42501",message:"permission denied for function"},
        };
        if(state.rpcMode==="auth") return {
          status:401,data:null,error:{code:"PGRST301",message:"JWT expired"},
        };
        return {data:null,error:null};
      }
      if(name==="turn_finish_asset_upload") return {data:null,error:null};
      return {data:null,error:{status:500,code:"unexpected_rpc",message:"unexpected RPC"}};
    },
  };
  const sandbox={
    console:{warn:message=>state.warnings.push(String(message)),log:()=>{},error:()=>{}},
    Blob,Uint8Array,atob,Date,Math,Map,Set,JSON,Promise,
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    document:{},navigator:{},location:{origin:"https://app.test"},
    fetch:async()=>{ state.fetchCalls++; throw new Error("network should not be called"); },
    setTimeout,clearTimeout,setInterval,clearInterval,
    TURN_SUPABASE:{url:"https://supabase.test",anonKey:"anon",bucket:"turn-assets"},
  };
  sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.window._sbClient=sb;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});
  return {sandbox,state};
}

const commit=(sandbox,diagnostics,extra={})=>sandbox.cloudCommit(
  "project-scope","member-scope","entity-scope",png,{version:3},[],
  "character",undefined,diagnostics,...extra.args||[]);

{
  const {sandbox,state}=harness({rpcMode:"missing"});
  const diagnostics={};
  let result=await commit(sandbox,diagnostics);
  ok("exact missing helper keeps ordinary storage upload working",
    result.tier==="cloud"&&state.uploads.length===1);
  ok("missing helper is not recorded as a pending reservation",
    diagnostics.reservation==="unavailable"&&state.rpcCalls.filter(c=>c.name==="turn_finish_asset_upload").length===0);
  ok("compatibility warning is explicit and once per client",
    !!diagnostics.warning&&state.warnings.length===1);
  const firstPath=state.uploads[0].path;
  result=await commit(sandbox,{});
  ok("missing-helper compatibility probes again on a later request",
    state.rpcCalls.filter(c=>c.name==="turn_begin_asset_upload").length===2
      && result.tier==="cloud"&&state.uploads.length===2&&state.warnings.length===1);
  ok("compatibility preserves original pixels without a model/network call",
    state.fetchCalls===0);
  ok("missing-helper upload stays in exact member/project scope",
    firstPath.startsWith("member-scope/project-scope/"));
}

{
  const {sandbox,state}=harness({rpcMode:"missing-reverse"});
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  ok("exact missing helper accepts the provider signature with reversed argument order",
    result.tier==="cloud"&&state.uploads.length===1&&diagnostics.reservation==="unavailable");
}

for(const mode of ["unrelated-missing","wrong-args","missing-params","missing-no-status","postgres-missing","server","pgrst403","permission","auth"]){
  const {sandbox,state}=harness({rpcMode:mode});
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  ok(mode+" reservation failure is fail-closed before Storage upload",
    result.tier==="error"&&state.uploads.length===0&&diagnostics.stage==="reservation");
  ok(mode+" reservation failure preserves sanitized status/code metadata",
    (mode==="missing-no-status" ? diagnostics.status===undefined : diagnostics.status>0)
      &&!!diagnostics.code&&!/project-scope|member-scope|entity-scope|https?:/i.test(JSON.stringify(diagnostics)));
}

{
  const {sandbox,state}=harness({rpcMode:"missing",sessionFailure:true});
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  ok("expired session is rejected before missing-helper compatibility",
    result.tier==="error"&&diagnostics.stage==="auth"&&state.uploads.length===0
      &&!state.rpcCalls.length);
}

{
  const {sandbox,state}=harness({rpcMode:"modern"});
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  const begin=state.rpcCalls.find(c=>c.name==="turn_begin_asset_upload");
  const finish=state.rpcCalls.find(c=>c.name==="turn_finish_asset_upload");
  ok("modern reservation succeeds and finishes after verified row commit",
    result.tier==="cloud"&&!!begin&&!!finish
      &&state.order.indexOf("rpc:turn_begin_asset_upload")<state.order.indexOf("upload")
      &&state.order.indexOf("insert")<state.order.indexOf("rpc:turn_finish_asset_upload"));
  ok("finish receives only the exact uploaded path",
    finish&&Array.isArray(finish.args.p_paths)&&finish.args.p_paths.length===1
      &&finish.args.p_paths[0]===state.uploads[0].path
      &&begin.args.p_path===finish.args.p_paths[0]);
}

{
  const {sandbox,state}=harness({rpcMode:"modern",failReference:true});
  const diagnostics={};
  const result=await sandbox.cloudCommit(
    "project-scope","member-scope","entity-scope",png,{version:3},
    [{kind:"prop",label:"Coat",url:"data:image/png;base64,QQ==",refId:"prop-1",refVersion:7}],
    "character",undefined,diagnostics);
  ok("optional reference snapshot failure does not abort the primary save",
    result.tier==="cloud"&&state.row&&state.row.storage_path===state.uploads[0].path);
  ok("optional reference keeps null path and provenance after its failed snapshot",
    state.row&&state.row.refs&&state.row.refs.length===1
      &&state.row.refs[0].storage_path===null&&state.row.refs[0].refId==="prop-1"
      &&state.row.refs[0].refVersion===7&&diagnostics.stage!=="storage");
}

{
  const {sandbox,state}=harness({
    rpcMode:"modern",
    storageError:{status:403,code:"42501",message:"new row violates row-level security policy"},
  });
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  ok("Storage RLS denial does not commit a generation",
    result.tier==="error"&&state.row===null&&state.uploads.length===1);
  ok("Storage RLS denial keeps the actual actionable error metadata",
    diagnostics.stage==="storage"&&diagnostics.status===403&&diagnostics.code==="42501"
      &&result.error.includes("new row violates row-level security policy"));
  ok("Storage denial cleanup remains exact-path before finishing its reservation",
    state.removed.length===1&&state.removed[0]===state.uploads[0].path
      &&state.rpcCalls.some(c=>c.name==="turn_finish_asset_upload")
      &&state.order.indexOf("remove")<state.order.indexOf("rpc:turn_finish_asset_upload"));
}

for(const storageFailure of [
  {name:"duplicate",error:{status:409,code:"23505",message:"The resource already exists"}},
  {name:"network",throw:{name:"TypeError",message:"Failed to fetch"}},
]){
  const {sandbox,state}=harness({
    rpcMode:"modern",storageError:storageFailure.error,storageThrow:storageFailure.throw,
  });
  const diagnostics={};
  const result=await commit(sandbox,diagnostics);
  ok(storageFailure.name+" failure preserves staged metadata and fails save",
    result.tier==="error"&&diagnostics.stage.indexOf("storage")===0
      &&!!diagnostics.error&&result.error===diagnostics.error.message);
  ok(storageFailure.name+" failure still attempts exact cleanup",
    state.removed.length===1&&state.removed[0]===state.uploads[0].path);
}

{
  const {sandbox,state}=harness({rpcMode:"modern"});
  const diagnostics={};
  const result=await sandbox.cloudCommit(
    "project-scope","member-scope","entity-scope","not-an-image",{version:1},[],
    "character",undefined,diagnostics);
  ok("malformed generated image is distinct and performs no RPC or upload",
    result.tier==="error"&&diagnostics.stage==="input"&&state.uploads.length===0
      &&state.rpcCalls.length===0&&/invalid|image/i.test(result.error));
}

console.log(failed?`${failed} failed (${passed} passed)`:`${passed} passed, 0 failed`);
process.exit(failed?1:0);
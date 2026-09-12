#!/usr/bin/env node
/* Real orbit/image/cloud storage-boundary regression.
   The provider is a local paid-render counter; cloud.jsx, imagegen.jsx, and
   character-orbit.js are loaded unmodified into the same VM. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const cloudSource=readFileSync(new URL("../app/cloud.jsx",import.meta.url),"utf8");
const imageSource=readFileSync(new URL("../app/imagegen.jsx",import.meta.url),"utf8");
const orbitSource=readFileSync(new URL("../app/character-orbit.js",import.meta.url),"utf8");
const MASTER=Buffer.from("immutable-master-bytes");
const FRAME=Buffer.from("orbit-frame-bytes");
const masterDataUrl="data:image/png;base64,"+MASTER.toString("base64");
const frameDataUrl="data:image/png;base64,"+FRAME.toString("base64");

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

class TestFileReader{
  readAsDataURL(blob){
    blob.arrayBuffer().then(bytes=>{
      this.result="data:"+(blob.type||"application/octet-stream")+";base64,"+
        Buffer.from(bytes).toString("base64");
      if(this.onload)this.onload();
    },error=>{
      this.error=error;
      if(this.onerror)this.onerror(error);
    });
  }
}

function makeHarness({urlMode="http",failUpload=false}={}){
  const rows=new Map(),objects=new Map(),uploads=[],removed=[];
  let revision=0,paidRenders=0;
  const originalPath="seed/original-master.png";
  objects.set(originalPath,Buffer.from(MASTER));
  rows.set("char-1",{
    project_id:"film-1",owner:"user-1",entity_id:"char-1",storage_path:originalPath,
    meta:{kind:"character-master",version:7},refs:[],history:[],updated_at:"1"
  });

  class Query{
    constructor(){
      this.op="read";this.value=null;this.filters=[];this.list=false;this.singleMode=false;
    }
    select(){this.list=true;return this;}
    eq(key,value){this.filters.push(["eq",key,value]);return this;}
    is(key,value){this.filters.push(["is",key,value]);return this;}
    in(key,values){this.filters.push(["in",key,values]);return this;}
    insert(value){this.op="insert";this.value=value;return this;}
    update(value){this.op="update";this.value=value;return this;}
    delete(){this.op="delete";return this;}
    matches(row){
      return this.filters.every(([mode,key,value])=>{
        if(mode==="in")return value.includes(row[key]);
        if(mode==="is")return value===null?row[key]==null:row[key]===value;
        return row[key]===value;
      });
    }
    async run(){
      const found=[...rows.values()].filter(row=>this.matches(row));
      if(this.op==="read"){
        const data=this.singleMode ? (found[0]?clone(found[0]):null)
          : this.list ? found.map(clone) : (found[0]?clone(found[0]):null);
        return {data,error:null};
      }
      if(this.op==="insert"){
        const key=String(this.value.entity_id);
        if(rows.has(key))return {data:null,error:{message:"duplicate key"}};
        const row={...clone(this.value),updated_at:String(++revision)};
        rows.set(key,row);
        return {data:clone(row),error:null};
      }
      if(this.op==="update"){
        if(!found.length)return {data:null,error:null};
        const row=found[0],next={...row,...clone(this.value),updated_at:String(++revision)};
        rows.set(String(next.entity_id),next);
        return {data:clone(next),error:null};
      }
      if(this.op==="delete"){
        if(!found.length)return {data:null,error:null};
        rows.delete(String(found[0].entity_id));
        return {data:clone(found[0]),error:null};
      }
      return {data:null,error:null};
    }
    maybeSingle(){this.singleMode=true;return this.run();}
    single(){this.singleMode=true;return this.run();}
    then(resolve,reject){return this.run().then(resolve,reject);}
  }

  const storage={
    async upload(path,blob){
      uploads.push({path,size:blob.size,type:blob.type,bytes:Buffer.from(await blob.arrayBuffer())});
      if(failUpload)return {error:{
        message:"storage rejected signed URL https://secret.example/object?token=do-not-leak",
        status:503,code:"STORAGE_REJECTED"
      }};
      objects.set(path,Buffer.from(await blob.arrayBuffer()));
      return {error:null};
    },
    async remove(paths){
      for(const path of paths||[]){removed.push(path);objects.delete(path);}
      return {error:null};
    },
    async createSignedUrl(path){
      if(urlMode==="data")return {data:{signedUrl:masterDataUrl},error:null};
      const prefix=urlMode==="blob"?"blob:https://signed.test/":"https://signed.test/";
      return {data:{signedUrl:prefix+path+"?signature=secret"},error:null};
    },
    async createSignedUrls(paths){
      const result=[];
      for(const path of paths||[]){
        const item=await this.createSignedUrl(path);
        result.push({path,signedUrl:item.data.signedUrl});
      }
      return {data:result,error:null};
    }
  };
  const sb={
    from(){return new Query();},
    storage:{from(){return storage;}},
    rpc(name){
      if(name==="turn_begin_asset_upload"||name==="turn_finish_asset_upload")
        return Promise.resolve({data:null,error:null});
      return Promise.resolve({data:null,error:{message:"unexpected rpc "+name}});
    },
    auth:{getSession:async()=>({data:{session:{user:{id:"user-1"}}},error:null})}
  };
  const listeners=new Map();
  const localStore=new Map();
  const localStorage={
    getItem:key=>localStore.has(String(key))?localStore.get(String(key)):null,
    setItem:(key,value)=>localStore.set(String(key),String(value)),
    removeItem:key=>localStore.delete(String(key))
  };
  const dataBlob=data=>{
    const match=String(data||"").match(/^data:([^;]+);base64,(.*)$/);
    if(!match)return new Blob(["missing"],{type:"image/png"});
    return new Blob([Buffer.from(match[2],"base64")],{type:match[1]});
  };
  const fetch=async input=>{
    const url=String(typeof input==="string"?input:input&&input.url||input||"");
    if(url.startsWith("data:"))return {ok:true,status:200,blob:async()=>dataBlob(url)};
    if(url.startsWith("https://signed.test/")||url.startsWith("blob:https://signed.test/")){
      const marker=url.startsWith("blob:")?"blob:https://signed.test/":"https://signed.test/";
      const path=url.slice(marker.length).split("?")[0];
      const bytes=objects.get(path);
      if(!bytes)return {ok:false,status:404,blob:async()=>new Blob([],{type:"text/plain"})};
      return {ok:true,status:200,blob:async()=>new Blob([bytes],{type:"image/png"})};
    }
    return {ok:false,status:404,blob:async()=>new Blob([],{type:"text/plain"})};
  };
  const document={
    hidden:false,
    addEventListener(){},removeEventListener(){},
    createElement(){return {style:{},getContext(){return null;}}}
  };
  const box={
    console,Blob,Uint8Array,atob,btoa,Buffer,Date,Math,Map,Set,JSON,Promise,
    structuredClone:globalThis.structuredClone,FileReader:TestFileReader,fetch,
    localStorage,sessionStorage:localStorage,document,navigator:{},
    location:{origin:"https://app.test"},crypto:{randomUUID:()=> "test-uuid"},
    TURN_SUPABASE:{bucket:"turn-assets"},_sbClient:sb,
    setTimeout,clearTimeout,setInterval,clearInterval,
    addEventListener(name,fn){listeners.set(name,fn);},
    removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
    dispatchEvent(){return true},
    CustomEvent:class CustomEvent{
      constructor(type,init){this.type=type;this.detail=init&&init.detail;}
    }
  };
  box.window=box;box.globalThis=box;
  vm.createContext(box);
  vm.runInContext(cloudSource,box,{filename:"app/cloud.jsx"});
  vm.runInContext(imageSource,box,{filename:"app/imagegen.jsx"});
  box.nbUseCloud("film-1","user-1");
  box.nbGenerate=async(_prompt,options)=>{
    if(options&&typeof options.beforeSubmit==="function")await options.beforeSubmit();
    paidRenders++;
    return frameDataUrl;
  };
  vm.runInContext(orbitSource,box,{filename:"app/character-orbit.js"});
  return {
    box,rows,objects,uploads,removed,originalPath,
    get paidRenders(){return paidRenders;}
  };
}

const orbitOptions=()=>({
  project:{id:"film-1"},
  character:{
    id:"char-1",name:"Ada",role:"watchmaker",
    description:"A careful maker",personality:"quietly observant"
  },
  pose:"A repeatable three-quarter stance.",
  settings:{model:"gemini-3.1-flash-image",quality:"medium",res:"1K",aspect:"16:9"},
  canWrite:()=>true
});

function rowsFor(h,predicate){
  return [...h.rows.values()].filter(predicate);
}

function containsImageData(value){
  if(typeof value==="string")return /^data:image\//i.test(value);
  if(Array.isArray(value))return value.some(containsImageData);
  if(value&&typeof value==="object")return Object.values(value).some(containsImageData);
  return false;
}

async function successfulCase(urlMode){
  const h=makeHarness({urlMode});
  const loaded=await h.box.nbLoadImage("char-1");
  assert.match(String(loaded),urlMode==="http"?/^https:\/\/signed\.test\//:
    urlMode==="blob"?/^blob:https:\/\/signed\.test\//:/^data:image\//);
  const result=await h.box.CharacterOrbit.create(orbitOptions());
  assert.equal(result.frames.length,1,"create stops after one reviewed preview");
  assert.equal(h.paidRenders,1,"only frame 0 reaches the paid generation boundary");
  const imageRows=rowsFor(h,row=>row.storage_path&&row.entity_id!=="char-1");
  assert.equal(imageRows.length,2,"source snapshot and one preview are committed");
  assert.deepEqual(new Set(imageRows.map(row=>row.project_id)),new Set(["film-1"]));
  assert.ok(imageRows.every(row=>row.storage_path.split("/")[2]==="character"),
    "orbit source/frame storage uses the character folder");
  assert.deepEqual(
    new Set(imageRows.map(row=>row.meta&&row.meta.kind)),
    new Set(["character-orbit-source-snapshot","character-orbit-frame"]),
    "semantic orbit metadata kinds remain intact"
  );
  const manifest=rowsFor(h,row=>row.entity_id.startsWith("orbit-run-")&&row.storage_path===null);
  assert.equal(manifest.length,1,"orbit project record is metadata-only");
  assert.equal(manifest[0].project_id,"film-1","manifest stays in the current project scope");
  assert.equal(containsImageData(manifest[0].meta),false,"manifest contains no image bytes");
  assert.equal(h.rows.get("char-1").storage_path,h.originalPath,"original master row is untouched");
  return h;
}

const httpCase=await successfulCase("http");
const sourceRow=rowsFor(httpCase,row=>row.meta&&row.meta.kind==="character-orbit-source-snapshot")[0];
const sourceUpload=httpCase.uploads.find(item=>item.path.split("/")[3]===sourceRow.entity_id);
assert.ok(sourceUpload,"source snapshot upload was a real storage upload");
assert.deepEqual(sourceUpload.bytes,MASTER,"snapshot stores the fetched master bytes");
httpCase.objects.set(httpCase.originalPath,Buffer.from("mutated-original"));
assert.deepEqual(sourceUpload.bytes,MASTER,"snapshot bytes remain immutable after master mutation");

await successfulCase("blob");
await successfulCase("data");

const failed=makeHarness({urlMode:"http",failUpload:true});
const originalBefore=clone(failed.rows.get("char-1"));
await assert.rejects(
  failed.box.CharacterOrbit.create(orbitOptions()),
  error=>/Cloud image upload failed/.test(String(error&&error.message||error))
    && !String(error&&error.message||error).includes("secret.example")
    && !String(error&&error.message||error).includes("do-not-leak")
);
assert.equal(failed.paidRenders,0,"source storage failure spends zero paid renders");
assert.deepEqual(failed.rows.get("char-1"),originalBefore,"source failure leaves original master untouched");
assert.equal(rowsFor(failed,row=>row.meta&&row.meta.kind==="character-orbit-source-snapshot").length,0,
  "failed source upload is not falsely confirmed in a generation row");
assert.equal(rowsFor(failed,row=>row.meta&&row.meta.kind==="character-orbit-frame").length,0,
  "source failure produces no frame row");

console.log("character orbit storage regression passed");
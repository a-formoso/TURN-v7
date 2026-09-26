#!/usr/bin/env node
/* Cloud bootstrap recovery contracts. No real account, network or project is used. */
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
let authCallback=null;
const never=()=>new Promise(()=>{});
const hangingQuery=()=>({
  select(){return this;}, order(){return this;}, eq(){return this;}, or(){return this;}, single(){return this;},
  then(resolve,reject){return never().then(resolve,reject);},
});
const session={user:{id:"user-1",email:"director@example.test"}};
const sb={
  auth:{
    getSession:never,
    refreshSession:async()=>({data:{session}}),
    onAuthStateChange(cb){authCallback=cb;return {data:{subscription:{unsubscribe:noop}}};},
  },
  from:()=>hangingQuery(),
  rpc:()=>hangingQuery(),
};
const shortTimer=(fn,ms)=>ms>1000?0:setTimeout(fn,ms);
const sandbox={
  console,Promise,Date,Math,Map,Set,JSON,Uint8Array,Blob,atob,AbortController,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{},navigator:{onLine:true},location:{origin:"https://app.test"},fetch:never,
  setTimeout:shortTimer,clearTimeout,setInterval:()=>0,clearInterval:noop,
  addEventListener:noop,removeEventListener:noop,
  __TURN_CLOUD_TIMEOUT_MS:20,
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox._sbClient=sb;
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/cloud.jsx","utf8"),sandbox,{filename:"app/cloud.jsx"});

let pass=0,fail=0;
const ok=(name,value)=>{if(value)pass++;else{fail++;console.error("FAIL "+name);}};

let authEventSession=null;
const stop=sandbox.cloudOnAuth(s=>{authEventSession=s;});
authCallback("INITIAL_SESSION",session);
const authStart=Date.now();
const recoveredSession=await sandbox.cloudGetSession();
ok("auth event seeds recovery snapshot",authEventSession===session&&recoveredSession===session);
ok("hung getSession is bounded",Date.now()-authStart<250);
stop();

const listStart=Date.now();
ok("hung project list returns a retry signal",await sandbox.cloudListProjects()===null);
ok("hung project list is bounded",Date.now()-listStart<300);
const loadStart=Date.now();
ok("hung project load returns a retry signal",await sandbox.cloudLoadProject("film-1")===null);
ok("hung project load is bounded",Date.now()-loadStart<300);

const app=readFileSync("app/app.jsx","utf8");
const authEffect=app.slice(app.indexOf("if(!(typeof cloudConfigured"),app.indexOf("const signOut"));
ok("auth subscription starts before session probe",authEffect.indexOf("cloudOnAuth")<authEffect.indexOf("cloudGetSession"));
ok("bootstrap no longer loops forever inside one failed attempt",!app.includes("for(let wait=3000; list===null"));
ok("bootstrap releases its latch before retry",app.includes("bootRef.current=false;")&&app.includes("retryBoot("));
ok("browser online event triggers immediate recovery",app.includes('window.addEventListener("online",reconnect)'));
const recoveryGate=app.indexOf("if(authGate && session && !currentProjectId)");
ok("heavy workspace stays unmounted during reconnect",recoveryGate>0&&recoveryGate<app.indexOf("const newStoryBuildsCurrentEpisode"));
ok("reconnect screen offers an immediate retry",app.includes('},"Retry now")'));
const account=readFileSync("app/auth-ui.jsx","utf8");
ok("account chip exposes automatic recovery",account.includes('"Reconnecting"')&&account.includes("reconnecting automatically"));

console.log(`${pass} passed, ${fail} failed`);
if(fail) process.exit(1);

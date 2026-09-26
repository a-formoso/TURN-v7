/* Claude thinking + pricing (owner, 2026-09-26): Fable 5.1 replaces Opus 5 in the picker,
   Anthropic list prices, room to think (the output cap covers thinking + text), effort per
   task, and one retry with the largest budget when a reply comes back cut off. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const ai=read("app/ai.jsx"), proxy=read("supabase/functions/image-proxy/index.ts"), pricing=read("app/pricing.jsx"), dock=read("app/aiwriter.jsx");
const ast=parseSync(ai,{sourceType:"script"});
const box={console}; box.window=box; vm.createContext(box);
const src=node=>ai.slice(node.start,node.end);
// the registry, the pick helpers and the complete() transport, exactly as shipped
for(const n of ["WRITING_MODELS","WRITING_TASK_DEFAULTS"]){ const node=ast.program.body.find(x=>x.type==="VariableDeclaration"&&x.declarations.some(d=>d.id.name===n)); vm.runInContext(src(node).replace(/^const /,"var "),box); }
for(const n of ["recommendedWritingModelId","getWritingModelId"]){ const node=ast.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n); vm.runInContext(src(node),box); }
vm.runInContext("var _writingPick=null;",box);
const ifNode=ast.program.body.find(x=>x.type==="IfStatement"&&src(x.test).includes("window.claude"));
vm.runInContext(src(ifNode),box);

let bodies=[], replies=[];
Object.assign(box,{safeError:m=>m,attributedError:(a,b,c)=>c,textSpendAdd:()=>{},CustomEvent:function(){},dispatchEvent:()=>{},
  sbClient:()=>({functions:{invoke:async(fn,{body})=>{ bodies.push(body); return { data:replies.shift() }; }}})});

await test("Fable 5.1 replaces Opus 5 in the picker; Opus 5.5 is the default (owner, 2026-09-27)",()=>{
  const ids=box.WRITING_MODELS.map(m=>m.id);
  assert.ok(ids.includes("claude-fable-5-1")&&!ids.includes("claude-opus-5")&&ids.includes("claude-opus-5-5"));
  assert.equal(box.getWritingModelId("story"),"claude-opus-5-5"); assert.equal(box.getWritingModelId("specs"),"claude-opus-5-5");
  assert.equal(box.WRITING_MODELS[0].id,"claude-opus-5-5","Opus 5.5 leads the picker and is the fallback");
  assert.ok(dock.includes('"claude-fable-5-1":"FABLE5.1"')&&!dock.includes('"claude-opus-5":"OPUS5"'));
});
await test("the proxy prices Claude at Anthropic's list prices",()=>{
  for(const [id,i,o] of [["claude-fable-5",10,50],["claude-fable-5-1",10,50],["claude-opus-5",5,25],["claude-opus-5-5",4,20]])
    assert.ok(new RegExp('"'+id+'":\\s*\\{\\s*input:\\s*'+i+',\\s*output:\\s*'+o+'\\s*\\}').test(proxy),id);
  assert.ok(!/input:\s*25,\s*output:\s*100|input:\s*15,\s*output:\s*75/.test(proxy.slice(proxy.indexOf("TEXT_PROVIDER_USD_PER_1M"),proxy.indexOf("function creditsFromProviderUsd"))));
  assert.ok(pricing.includes('"claude-fable-5-1": 0.11')&&ai.includes('"claude-fable-5-1": 0.11'));
});
await test("every Claude call has room to think, and effort reaches Anthropic",()=>{
  assert.ok(proxy.includes("max_tokens: Math.max(reqMaxTokens || 0, 16000)"));
  assert.ok(/output_config: \{ effort: claudeEffort \}/.test(proxy)&&/claudeEffort = \/\^\(low\|medium\|high\|xhigh\|max\)\$\//.test(proxy));
});
await test("specs drafting runs at medium effort; story work keeps the model's default",async()=>{
  bodies=[]; replies=[{text:"ok"},{text:"ok"}];
  box.__writingTaskHint="specs"; await box.claude.complete({messages:[{role:"user",content:"spec"}]});
  box.__writingTaskHint=undefined; await box.claude.complete({messages:[{role:"user",content:"scene"}]});
  assert.equal(bodies[0].effort,"medium"); assert.equal(bodies[1].effort,undefined);
  assert.equal(bodies[0].model,"claude-opus-5-5");
});
await test("a cut-off reply is asked for once more with the largest budget",async()=>{
  bodies=[]; replies=[{text:'{"scenes":[{"a":1',truncated:true},{text:'{"scenes":[]}'}];
  const out=await box.claude.complete({messages:[{role:"user",content:"spine"}]});
  assert.equal(bodies.length,2); assert.equal(bodies[1].maxTokens,32768); assert.equal(out,'{"scenes":[]}');
  assert.equal(box.__lastWritingTruncated,false);
  // still cut off after the retry: no loop, and the flag stays up for the callers' guards
  bodies=[]; replies=[{text:"a",truncated:true},{text:"b",truncated:true}];
  const out2=await box.claude.complete({messages:[{role:"user",content:"x"}]});
  assert.equal(bodies.length,2); assert.equal(out2,"b"); assert.equal(box.__lastWritingTruncated,true);
});
console.log(checks+" checks passed");

/* New Story Shape step + landing (owner, 2026-09-25): the format lineup (Feature Film,
   TV Series, Short Film, Micro Short, Micro-drama, Music Video, Documentary, Commercial)
   in three groups, every format with every framework, a three-act act split for any
   length, and a landing hero that shows only the three structures. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const box={console,React:{createElement:()=>null}}; box.window=box; vm.createContext(box);
vm.runInContext(read("app/formats.jsx"),box,{filename:"formats.jsx"});
vm.runInContext(read("app/frameworks.jsx"),box,{filename:"frameworks.jsx"});

await test("the lineup: long form, short form, non-fiction & brand",()=>{
  const groups=box.formatsForPicker().map(g=>[g.label,g.formats.map(f=>f.label)]);
  assert.deepEqual(plain(groups),[
    ["Long form",["Feature Film","TV Series"]],
    ["Short form",["Short Film","Micro Short","Micro-drama","Music Video"]],
    ["Non-fiction & brand",["Documentary","Commercial"]]]);
  const f=id=>box.FORMATS.find(x=>x.id===id);
  assert.equal(f("feature").sceneTarget,40); assert.equal(f("series").sceneTarget,24); assert.ok(f("series").needsShow);
  assert.equal(f("film").sceneTarget,16); assert.ok(f("musicvideo").screenplayBrief.includes("MUSIC VIDEO"));
});
await test("ids are unchanged, and unknown or legacy formats still resolve to the 16-scene film",()=>{
  assert.equal(box.formatOf({}).id,"film");
  assert.equal(box.formatOf({format:"something odd"}).id,"film");
  assert.equal(box.formatOf({format:"Feature Film"}).id,"film","legacy freeform text keeps its old meaning");
  assert.equal(box.formatOf({format:"feature"}).id,"feature");
  assert.equal(box.formatOf({format:"short"}).label,"Micro Short");
  assert.equal(box.FORMATS[0].id,"film");
});

// the spine prompt: a three-act split for ANY length
const ai=read("app/ai.jsx"), ast=parseSync(ai,{sourceType:"script"});
const fn=ast.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name==="spineBatch");
vm.runInContext(ai.slice(fn.start,fn.end),box);
let sent="";
Object.assign(box,{extractJSON:()=>({scenes:[]}),salvageSpineScenes:()=>[],normSpineScenes:x=>x,clipAtBoundary:(s)=>s,
  claude:{complete:async o=>{sent=o.messages[0].content;return "{}";}}});
const prompt=async(fmtId,part)=>{ await box.spineBatch("brief",part,box.FORMATS.find(f=>f.id===fmtId),null); return sent; };
await test("the classic 16 keeps its exact act language; a feature splits 10 · 20 · 10",async()=>{
  assert.ok((await prompt("film","first")).includes("scenes 1–8: all of ACT I (4 scenes, ending on the Act I climax) and the first half of ACT II (4 scenes, building to the midpoint)"));
  assert.ok((await prompt("film","second")).includes("scenes 9–16: the second half of ACT II (4 scenes, from after the midpoint to the Act II climax / lowest point) and all of ACT III (4 scenes: crisis, story climax, resolution)"));
  const f1=await prompt("feature","first");
  assert.ok(f1.includes("scenes 1–20: all of ACT I (10 scenes")&&f1.includes("first half of ACT II (10 scenes")&&f1.includes("a feature film"));
  assert.ok((await prompt("feature","second")).includes("scenes 21–40: the second half of ACT II (10 scenes")&&sent.includes("ACT III (10 scenes"));
  assert.ok((await prompt("series","first")).includes("scenes 1–12: all of ACT I (6 scenes"));
  // a 4-scene commercial is too short for act counts and keeps the movement wording
  assert.ok((await prompt("commercial","first")).includes("the opening movement"));
});

// ---- any format with any structure (owner, 2026-09-25): the planning prompts always
// carry the format, and a tiny Hero's Journey keeps a departure, an ordeal and a return ----
{
  const aiAst=ast;
  const loadAi=names=>names.forEach(n=>{ const node=aiAst.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n); vm.runInContext(ai.slice(node.start,node.end),box); });
  loadAi(["formatPlanLine"]);
  const fws=["threeact","kishotenketsu","herosjourney"];
  await test("every format x structure spine prompt carries the format",async()=>{
    for(const f of box.FORMATS) for(const id of fws){
      const fw=id==="threeact"?null:box.FRAMEWORKS.find(x=>x.id===id);
      for(const part of ["first","second"]){
        await box.spineBatch("brief",part,f,fw);
        const want=f.id==="film" ? "short film" : f.spineBrief;
        assert.ok(sent.includes(want),f.id+" x "+id+" ("+part+") lost the format: "+sent.slice(0,200));
      }
    }
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="documentary"),box.FRAMEWORKS.find(x=>x.id==="herosjourney"));
    assert.ok(sent.includes("never invent events, motives or words for real people")&&sent.includes("HERO'S JOURNEY"));
    assert.ok(sent.includes("keep the format's hard limits"));
  });
  await test("a 4-scene Hero's Journey plans and labels the minimum journey",async()=>{
    const hj=box.FRAMEWORKS.find(x=>x.id==="herosjourney"), com=box.FORMATS.find(f=>f.id==="commercial");
    await box.spineBatch("brief","first",com,hj);
    assert.ok(sent.includes("scene 1 is the ORDINARY WORLD")&&sent.includes("scene 2 is CROSSING THE THRESHOLD")&&!sent.includes("a refusal, meeting the mentor"),sent.slice(0,600));
    await box.spineBatch("brief","second",com,hj);
    assert.ok(sent.includes("scene 3 is the ORDEAL")&&sent.includes("scene 4 is the RETURN WITH THE ELIXIR")&&sent.includes("the last scene brings the hero home changed"));
    // an 8-scene journey keeps the full grammar
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="short"),hj);
    assert.ok(sent.includes("a refusal, meeting the mentor"));
    // the labels match the prompt
    const agents=read("app/agents.jsx"), aAst=parseSync(agents,{sourceType:"script"});
    for(const n of ["acceptDeclaredStages","assignPlotPoints"]){ const node=aAst.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n); vm.runInContext(agents.slice(node.start,node.end),box); }
    box.turnProject={framework:"herosjourney"};
    const film=n=>Array.from({length:n},(_,i)=>({id:"c"+i,no:i+1,act:i<2?1:i<n-1?2:3,openCharge:1,closeCharge:-1,kind:"normal"}));
    assert.deepEqual(plain(box.assignPlotPoints(film(4)).map(s=>s.kind)),["ordinary-world","threshold","ordeal","elixir"]);
    assert.deepEqual(plain(box.assignPlotPoints(film(3)).map(s=>s.kind)),["threshold","ordeal","elixir"]);
    const eight=Array.from({length:8},(_,i)=>({id:"e"+i,no:i+1,act:i<3?1:i<6?2:3,openCharge:1,closeCharge:-1,kind:"normal"}));
    const k8=box.assignPlotPoints(eight).map(s=>s.kind);
    assert.ok(k8.includes("call")&&k8.includes("resurrection"),"5+ scenes keep the positional stages: "+k8.join(","));
    // the returning scene may settle; the others must turn
    const rule=box.FRAMEWORKS.find(x=>x.id==="herosjourney").audit.rule;
    assert.equal(rule({openCharge:2,closeCharge:2,kind:"elixir"}).flagged,false);
    assert.equal(rule({openCharge:2,closeCharge:2,kind:"ordeal"}).flagged,true);
    box.turnProject={framework:"threeact"};
  });
  await test("the synopsis prompt knows the format too",async()=>{
    loadAi(["aiResearchSynopsis"]);
    const prompts=[];
    Object.assign(box,{aiAvailable:()=>true,scrubBrand:s=>String(s),
      claude:{complete:async o=>{ const c=o.messages[0].content; prompts.push(c);
        return /write the SYNOPSIS/.test(c) ? JSON.stringify({synopsis:{departure:"a",initiation:"b",return:"c"}}) : "{}"; }}});
    await box.aiResearchSynopsis("A retired welder retraces her father's route.","","herosjourney","documentary");
    const syn=prompts.find(p=>/write the SYNOPSIS/.test(p));
    assert.ok(syn&&syn.includes("FORMAT: this is a documentary")&&syn.includes("never invent events"),syn&&syn.slice(0,500));
    prompts.length=0;
    await box.aiResearchSynopsis("A courier races a storm.","","kishotenketsu","commercial");
    assert.ok(prompts.find(p=>/write the SYNOPSIS/.test(p)).includes("30–60 second commercial"));
  });
}

// ---- the spine names people once and declares its own stages (owner, 2026-09-25) ----
{
  const agents=read("app/agents.jsx"), aAst=parseSync(agents,{sourceType:"script"});
  for(const n of ["acceptDeclaredStages","assignPlotPoints"]){ const node=aAst.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n); vm.runInContext(agents.slice(node.start,node.end),box); }
  const hjFilm=tags=>tags.map((k,i)=>({id:"h"+i,no:i+1,act:i<5?1:i<9?2:3,openCharge:1,closeCharge:-1,kind:"normal",_stage:k}));
  await test("declared stages beat positional guesses, and bad tags fall back",()=>{
    box.turnProject={framework:"herosjourney"};
    // the model put the ordeal on scene 7 (the museum ship), not where position would (6)
    const tags=["ordinary-world","call","","mentor","threshold","tests","ordeal","reward","road-back","","resurrection","elixir"];
    const k=box.assignPlotPoints(hjFilm(tags)).map(s=>s.kind);
    assert.equal(k[6],"ordeal"); assert.equal(k[5],"tests"); assert.equal(k[2],"normal"); assert.equal(k[9],"normal");
    // out of order (elixir before the ordeal) is dropped; still valid overall
    const k2=box.assignPlotPoints(hjFilm(["","","","","threshold","elixir","ordeal","","","","",""])).map(s=>s.kind);
    assert.equal(k2[5],"normal"); assert.equal(k2[6],"ordeal");
    // no ordeal declared at all -> positional stages as before
    const k3=box.assignPlotPoints(hjFilm(["ordinary-world","","","","threshold","","","","","","",""])).map(s=>s.kind);
    assert.ok(k3.includes("ordeal")&&k3.includes("call"),k3.join(","));
    // Kishotenketsu: the twist where the story puts it; re-read may repeat
    box.turnProject={framework:"kishotenketsu"};
    const kf=["plant","","","deepen","","","","","","ten","re-read","re-read","","","","ketsu"].map((t,i)=>({id:"k"+i,no:i+1,act:1+Math.floor(i/4),openCharge:1,closeCharge:-1,kind:"normal",_stage:t}));
    const kk=box.assignPlotPoints(kf).map(s=>s.kind);
    assert.equal(kk[9],"ten"); assert.equal(kk[8],"normal"); assert.deepEqual([kk[10],kk[11]],["re-read","re-read"]); assert.equal(kk[15],"ketsu");
    box.turnProject={framework:"threeact"};
    assert.ok(agents.includes("_stage:s.stage||\"\",")&&agents.includes("newScenes.forEach(s=>{ delete s._stage; });"),"the build passes the stage and drops the temp field");
  });
  await test("the prompt asks for stages only where the model should choose them",async()=>{
    Object.assign(box,{extractJSON:()=>({scenes:[]}),salvageSpineScenes:()=>[],normSpineScenes:x=>x,
      claude:{complete:async o=>{sent=o.messages[0].content;return "{}";}}});   // the synopsis test swapped the mock
    const hj=box.FRAMEWORKS.find(x=>x.id==="herosjourney"), ki=box.FRAMEWORKS.find(x=>x.id==="kishotenketsu");
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="documentary"),hj);
    assert.ok(sent.includes('"k":"stage"')&&sent.includes("ordeal (The Ordeal)")&&sent.includes("each at most once and in that order"));
    assert.ok(!sent.includes("belly"),"hand-picked stages are not offered");
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="film"),ki);
    assert.ok(sent.includes("re-read may repeat"));
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="commercial"),hj);
    assert.ok(!sent.includes('"k":"stage"'),"a 4-scene journey keeps its fixed table");
    await box.spineBatch("brief","first",box.FORMATS.find(f=>f.id==="film"),null);
    assert.ok(!sent.includes('"k":"stage"'),"three-act keeps its exact positions");
  });
  await test("the second half continues the first: same people, same names, no repeated titles",async()=>{
    const ai2=read("app/ai.jsx"), ast2=parseSync(ai2,{sourceType:"script"});
    for(const n of ["clampCharge","normSpineScenes","aiBuildSpine"]){ const node=ast2.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n); vm.runInContext(ai2.slice(node.start,node.end),box); }
    const calls=[]; let inFlight=0, overlap=false;
    const half=(from,n,driver)=>({title:"The Cold Seam",scenes:Array.from({length:n},(_,i)=>({a:from+i<7?1:from+i<13?2:3,t:"Scene "+(from+i),l:"INT. KITCHEN - DAY",s:"noreen reads the papers",d:driver,vp:"Hope",vn:"Despair",oc:-1,cc:2,k:""}))});
    Object.assign(box,{aiAvailable:()=>true,scrubBrand:s=>String(s),extractJSON:JSON.parse,salvageSpineScenes:()=>null,
      claude:{complete:async o=>{ inFlight++; if(inFlight>1) overlap=true; const c=o.messages[0].content; calls.push(c);
        await new Promise(r=>setTimeout(r,5)); inFlight--;
        return JSON.stringify(calls.length===1 ? half(1,6,"noreen") : half(7,6,"noreen")); }}});
    const sp=await box.aiBuildSpine("LOGLINE: a welder retraces a convoy route.","documentary","herosjourney");
    assert.equal(calls.length,2); assert.equal(overlap,false,"the halves no longer run at the same time");
    assert.ok(calls[1].includes("THE FIRST HALF IS ALREADY WRITTEN (scenes 1\u20136)")&&calls[1].includes("(driver: noreen)")&&calls[1].includes("1. [act 1] Scene 1 \u2014 noreen reads the papers"));
    assert.ok(calls[1].includes("never renamed, re-invented or split in two")&&calls[1].includes("no scene title is reused"));
    assert.ok(!calls[0].includes("THE FIRST HALF IS ALREADY WRITTEN"));
    assert.equal(sp.scenes.length,12); assert.ok(sp.scenes.every(s=>"stage" in s));
    // a short second half is asked for once more, and the longer answer is kept
    calls.length=0; let n=0;
    box.claude={complete:async o=>{ calls.push(o.messages[0].content); n++;
      return JSON.stringify(n===1 ? half(1,6,"noreen") : n===2 ? half(7,3,"noreen") : half(7,6,"noreen")); }};
    const sp2=await box.aiBuildSpine("LOGLINE: a welder retraces a convoy route.","documentary","herosjourney");
    assert.equal(calls.length,3); assert.equal(sp2.scenes.length,12);
    assert.ok(calls[2].includes("THE FIRST HALF IS ALREADY WRITTEN"),"the retry still continues the first half");
  });
}

await test("the Shape step shows the groups and the three structures",()=>{
  const ns=read("app/newstory.jsx");
  assert.ok(ns.includes("window.formatsForPicker()")&&ns.includes('className:"ns-format-grouplab"'));
  assert.ok(ai.includes('f.id+" = "+f.label+((f.blurb||f.desc)'),"the shape recommendation sees each format's size");
});
await test("the landing hero turns through the three structures only, and every room is available",()=>{
  const lp=read("app/landing.jsx"), css=read("app/styles.css");
  const words=[...lp.matchAll(/\{ word:"([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(words,["Three-Act Turns","a Hero\\u2019s Journey","Kish\\u014dtenketsu"]);
  assert.ok(lp.includes("React.createElement(HeroSpine,{structure:LP_STRUCTURES[structIdx]})")&&lp.includes("React.createElement(RotatingWord,{word:LP_WORDS[structIdx]})"));
  assert.ok(!/story circle/i.test(lp));
  assert.equal((lp.match(/status:"Available now"/g)||[]).length,3);
  assert.ok(!css.includes(".lp-room-card:nth-child(3) .lp-room-status"),"Stage wears the same Available badge");
});
console.log(checks+" checks passed");

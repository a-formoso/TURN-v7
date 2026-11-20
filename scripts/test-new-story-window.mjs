/* THE NEW STORY WINDOW SAYS WHAT IT DOES (owner 2026-11-12, Writers' Room audit C3, C5 to C9). Runs the REAL app code
   (ai.jsx's planning calls, formats.jsx, the server's own web-search rule) and reads newstory.jsx / app.jsx:
     C3  the engines that check facts against the web are known to the app (the server's rule, mirrored), and the
         window says so before the research when the engine in use does not;
     C5  the loglines, the research and the synopsis read up to 7,000 characters of the writer's idea, and a longer
         one loses its middle, never its end;
     C6  the typed conversation hands over a recommended shape with its loglines;
     C7  Regenerate keeps the confirmed shape and says when the new loglines would suggest another;
     C8  "Turn this into a show" says the format change;
     C9  nothing that changes the logline, or leaves the step, is live while a step is running.
   node scripts/test-new-story-window.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};

const makeBox=()=>{
  const box={console:{...console,warn:noop,info:noop},setTimeout:(f)=>{f();return 0;},clearTimeout:noop,setInterval:()=>0,clearInterval:noop,
    React:new Proxy({createElement:()=>null,Fragment:"f",useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useCallback:f=>f,memo:f=>f},{get:(t,k)=>(k in t)?t[k]:noop}),
    ReactDOM:new Proxy({},{get:()=>noop}),Icon:new Proxy({},{get:()=>()=>null}),
    localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
    navigator:{userAgent:"node-test"},location:{href:"",search:"",hash:"",origin:""},
    CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail;}},Image:class{},
    document:{createElement:()=>({getContext:()=>null,style:{},setAttribute:noop,appendChild:noop,classList:{add:noop,remove:noop}}),getElementById:()=>null,
      addEventListener:noop,removeEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],createTextNode:()=>({}),body:{appendChild:noop,removeChild:noop},head:{appendChild:noop}},
    requestAnimationFrame:noop,cancelAnimationFrame:noop,addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,
    matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),fetch:()=>{throw new Error("network disabled");}};
  box.window=box;box.globalThis=box;box.self=box;vm.createContext(box);
  const asShipped=f=>transformSync(read(f),{plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:f}).code;
  for(const f of ["app/story-names.js","app/character-identity.js","app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx"])
    vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
  box.appToast=noop;box.aiAvailable=()=>true;box.turnIsAdmin=false;
  box.__prompts=[];box.__play=()=>"{}";
  box.claude={complete:async(o)=>{const p=o.messages.map(m=>m.content).join("\n");box.__prompts.push(p);const r=box.__play(p,box.__prompts.length);if(r instanceof Error)throw r;return r;}};
  return box;
};
const ns=read("app/newstory.jsx"),app=read("app/app.jsx");

/* ---------------------------------------------------------------- C3 */
await test("C3 · the app knows which engines check facts against the web — the server's own rule, engine by engine",async()=>{
  const box=makeBox();
  const server=await import("../supabase/functions/image-proxy/billing-pricing.mjs");
  const ids=box.WRITING_MODELS.map(m=>m.id);
  assert.ok(ids.length>=4);
  for(const id of [...ids,"claude-opus-5","claude-opus-5-5","claude-sonnet-5","claude-sonnet-5-5","claude-fable-5-2","claude-fable-5","claude-haiku-5-5","gemini-4-argon","gpt-6-astra","","nonsense"])
    assert.equal(box.writingModelSearchesWeb(id),!!server.textWebSearchTool(id),id+": the app and the server disagree");
  // today: the default engine checks, the deepest one does not
  assert.equal(box.writingModelSearchesWeb("claude-opus-5-5"),true);assert.equal(box.writingModelSearchesWeb("claude-fable-5-2"),false);
  const fable=box.researchWebCheck("claude-fable-5-2");
  assert.equal(fable.searches,false);assert.equal(fable.label,"Fable 5.2");assert.deepEqual(Array.from(fable.others),["Opus 5.5"]);
  const opus=box.researchWebCheck("claude-opus-5-5");
  assert.equal(opus.searches,true);assert.equal(opus.label,"Opus 5.5");assert.deepEqual(Array.from(opus.others),[]);
  assert.equal(box.researchWebCheck("not-an-engine").label,"");
});

await test("C3 · the window says it before the research, on the Logline step and the Research step, and only when it applies",()=>{
  assert.ok(ns.includes('const webCheck = (typeof window.researchWebCheck==="function") ? window.researchWebCheck(mid) : { searches:true, label:"", others:[] };'));
  assert.ok(ns.includes('const webNote = (!webCheck.searches && webCheck.label) ? React.createElement("div",{className:"ns-loglinecheck",role:"note","data-testid":"ns-web-note"},'));
  assert.ok(ns.includes('" writes the research\\u2019s facts from general knowledge \\u2014 it does not check them against the web."'));
  assert.ok(ns.includes('(webCheck.others.length===1 ? " does" : " do")+": choose it at the top of this window before you research if the story leans on real places, people or events."'));
  // shown on both steps, above the error line
  assert.equal((ns.match(/\n\s+webNote,\n\s+err && React\.createElement\("div",\{className:"ns-err"\}/g)||[]).length,2);
  const logl=ns.indexOf('step==="loglines"\n        ? React.createElement'),res=ns.indexOf('step==="research"\n        ? React.createElement'),syn=ns.indexOf('"Synopsis \\u2014 edit any paragraph before building"');
  const at=[...ns.matchAll(/\n\s+webNote,\n/g)].map(m=>m.index);
  assert.ok(at[0]>logl&&at[0]<res&&at[1]>res&&at[1]<syn);
  // the engine's name comes from the picker's own list, never written into the window
  assert.ok(!/Fable 5|Opus 5|Sonnet 5/.test(ns));
  // the after-the-fact labels are still there
  assert.ok(ns.includes('"Checked against the web \\u00b7 sources"')&&ns.includes("From general knowledge \\u2014 not checked against the web."));
});

/* ---------------------------------------------------------------- C5 */
await test("C5 · a long idea: 7,000 characters, and a longer one loses its middle — never its end",()=>{
  const box=makeBox();
  assert.equal(box.STORY_SEED_MAX,7000);
  assert.equal(box.storySeedText("  a short idea  "),"a short idea");assert.equal(box.storySeedText(null),"");
  const exact="x".repeat(7000);assert.equal(box.storySeedText(exact),exact);
  const talk=Array.from({length:260},(_,i)=>(i%2?"WRITER: ":"FRANCES: ")+"line "+(i+1)+" of the conversation, about the story.").join("\n")+"\nWRITER: THE LAST THING I WORKED OUT IS THAT SHE BURNS THE NETS.";
  assert.ok(talk.length>12000);
  const cut=box.storySeedText(talk);
  assert.ok(cut.length<=7000,"it is "+cut.length);assert.ok(cut.length>6800);
  assert.ok(cut.startsWith("FRANCES: line 1 of the conversation"));
  assert.ok(cut.endsWith("WRITER: THE LAST THING I WORKED OUT IS THAT SHE BURNS THE NETS."),"the end of the conversation is kept");
  assert.equal((cut.match(/\[… the middle is left out here …\]/g)||[]).length,1);
  const [head,tail]=cut.split("\n[… the middle is left out here …]\n");
  assert.ok(tail.length>head.length*1.5,"more of the end than of the start");
  assert.ok(/about the story\.$/.test(head)&&/^(WRITER|FRANCES): line \d+ /.test(tail),"a conversation is cut at whole lines: …"+head.slice(-30)+" | "+tail.slice(0,40));
  // prose with no line breaks is cut at words
  const prose=box.storySeedText(Array.from({length:1500},(_,i)=>"word"+i).join(" "));
  const [ph,pt]=prose.split("\n[\u2026 the middle is left out here \u2026]\n");
  assert.ok(/word\d+$/.test(ph)&&/^word\d+ /.test(pt)&&prose.endsWith("word1499")&&prose.length<=7000);
});

await test("C5 · the loglines, the research and the synopsis all read the whole idea",async()=>{
  const box=makeBox();
  const idea="An idea in prose. "+Array.from({length:230},(_,i)=>"Detail number "+(i+1)+" matters.").join(" ")+" AND THE ENDING IS THAT HE STAYS.";
  assert.ok(idea.length>5000&&idea.length<7000);
  box.__play=()=>JSON.stringify({loglines:["A man must choose whether to stay."],shape:{format:"film",framework:"threeact",why:"x"}});
  await box.aiSeedToLoglines("logline",idea);
  assert.ok(box.__prompts[0].includes("AND THE ENDING IS THAT HE STAYS."),"the loglines read 1,200 characters of a typed or imported idea");
  box.__prompts.length=0;box.__play=()=>JSON.stringify({title:"T",research:{memory:"m",imagination:"i",fact:{world:"w",roles:[]}}});
  await box.aiResearch("A man must choose whether to stay.",idea,null,"film","");
  assert.ok(box.__prompts[0].includes("THE WRITER'S ORIGINAL SEED")&&box.__prompts[0].includes("AND THE ENDING IS THAT HE STAYS."),"the research read the first 1,600 characters");
  box.__prompts.length=0;box.__play=()=>JSON.stringify({synopsis:{setup:"One.",confrontation:"Two.",resolution:"Three."}});
  await box.aiSynopsisFromResearch("A man must choose whether to stay.",idea,"threeact","film",null);
  assert.ok(box.__prompts[0].includes("AND THE ENDING IS THAT HE STAYS."),"the synopsis read the first 1,600 characters");
  // the old cuts are gone
  const ai=read("app/ai.jsx");
  assert.ok(!/seedText\|\|""\)\.slice\(0,1600\)/.test(ai)&&!/slice\(0,seedType==="talk"\?7000:1200\)/.test(ai));
  assert.equal((ai.match(/window\.storySeedText\((text|seedText)\) : String\((text|seedText)\|\|""\)\.slice\(0,7000\)\.trim\(\);/g)||[]).length,3);
  // a conversation is still handed over whole by the window, and a prose text from Import arrives up to 6,000
  assert.ok(ns.includes("if(transcript) setText(transcript);"));assert.ok(app.includes("setNewStorySeedText(String(text||\"\").slice(0,6000));"));
});

/* ---------------------------------------------------------------- C6 */
await test("C6 · the typed conversation hands over a recommended shape with its loglines",async()=>{
  const box=makeBox();
  const hist=[{role:"user",content:"A night call."},{role:"assistant",content:"Who answers it?"},{role:"user",content:"A paramedic who never leaves."}];
  box.__play=()=>JSON.stringify({say:"Lovely.",done:true,loglines:["A paramedic refuses to leave a silent flat."],shape:{format:"short",framework:"kishotenketsu",why:"The call is re-read once we learn who rang."}});
  const r=await box.aiSeedInterview(hist,"short film");
  assert.equal(r.done,true);assert.equal(r.loglines.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.shape)),{format:"short",framework:"kishotenketsu",why:"The call is re-read once we learn who rang."});
  // the question is asked with the real menus
  const p=box.__prompts[0];
  assert.ok(p.includes("When you hand off, also recommend the SHAPE this story wants: format = ONE id from ["));
  for(const f of box.FORMATS) assert.ok(p.includes(f.id+" = "+f.label),f.id);
  assert.ok(p.includes("kishotenketsu = ")&&p.includes("threeact = ")&&p.includes("herosjourney = "));
  assert.ok(p.includes('"shape":{"format":"<id>","framework":"<id>","why":"<one short sentence>"}'));
  // ids that are not real never survive; one real id is enough; none at all means no shape
  box.__play=()=>JSON.stringify({say:"x",done:true,loglines:["l"],shape:{format:"opera",framework:"threeact",why:"w"}});
  assert.deepEqual(JSON.parse(JSON.stringify((await box.aiSeedInterview(hist,"film")).shape)),{format:"",framework:"threeact",why:"w"});
  box.__play=()=>JSON.stringify({say:"x",done:true,loglines:["l"],shape:{format:"opera",framework:"sonnet"}});
  assert.equal((await box.aiSeedInterview(hist,"film")).shape,undefined);
  // mid-conversation there is no shape, whatever came back
  box.__play=()=>JSON.stringify({say:"And then?",done:false,shape:{format:"film",framework:"threeact"}});
  assert.equal((await box.aiSeedInterview(hist,"film")).shape,undefined);
  // the window passes it on exactly as the spoken conversation's loglines carry theirs
  assert.ok(ns.includes("const lls = r.loglines.slice(); if(r.shape) lls.shape = r.shape;\n        onComplete(lls,transcript);"));
  assert.ok(ns.includes("applyRecommendedShape(lls); setErr(\"\"); setStep(\"format\"); },"));
});

/* ---------------------------------------------------------------- C7 */
await test("C7 · Regenerate keeps the confirmed shape, and says when the new loglines would suggest another",()=>{
  const a=ns.indexOf("const develop = async (dest)=>{"),z=ns.indexOf("const askFirst",a),fn=ns.slice(a,z);
  // the first pass applies the recommendation; Regenerate (dest \"loglines\") does not
  assert.ok(fn.includes('} else { applyRecommendedShape(outs); setRegenShape(null); }'));
  assert.equal((fn.match(/applyRecommendedShape\(outs\)/g)||[]).length,1);
  assert.ok(fn.indexOf('if(dest==="loglines"){')<fn.indexOf("applyRecommendedShape(outs)"));
  // it compares with the shape as applied (the refs), respects a Show's fixed format, and names only what differs
  assert.ok(fn.includes("const fmtDiff = !!(sh && sh.format && !formatLocked && sh.format!==formatRef.current);"));
  assert.ok(fn.includes("const fwDiff = !!(sh && sh.framework && sh.framework!==frameworkRef.current);"));
  assert.ok(fn.includes("setRegenShape((fmtDiff || fwDiff) ? { why:String(sh.why||\"\"),"));
  // behaviour, with the same expressions
  const FORMATS=[{id:"film",label:"Short Film"},{id:"short",label:"Micro Short"}],FW=[{id:"threeact",label:"Three-Act"},{id:"kishotenketsu",label:"Kishōtenketsu"}];
  const regen=(sh,now,locked)=>{const fmtDiff=!!(sh&&sh.format&&!locked&&sh.format!==now.format),fwDiff=!!(sh&&sh.framework&&sh.framework!==now.framework);
    return (fmtDiff||fwDiff)?[fmtDiff?FORMATS.find(f=>f.id===sh.format).label:"",fwDiff?FW.find(f=>f.id===sh.framework).label:""].filter(Boolean).join(" · "):null;};
  assert.equal(regen({format:"film",framework:"threeact"},{format:"film",framework:"threeact"}),null,"same shape: nothing said");
  assert.equal(regen({format:"short",framework:"kishotenketsu"},{format:"film",framework:"threeact"}),"Micro Short · Kishōtenketsu");
  assert.equal(regen({format:"film",framework:"kishotenketsu"},{format:"film",framework:"threeact"}),"Kishōtenketsu");
  assert.equal(regen({format:"short",framework:"threeact"},{format:"film",framework:"threeact"},true),null,"a Show's format is fixed: not suggested");
  assert.equal(regen(null,{format:"film",framework:"threeact"}),null);
  // the note, on the Logline step
  assert.ok(ns.includes('regenShape && React.createElement("div",{className:"ns-loglinecheck",role:"note","data-testid":"ns-regen-shape"},'));
  assert.ok(ns.includes('"These new loglines would suggest ",React.createElement("b",null,regenShape.label),'));
  assert.ok(ns.includes('". Your shape stays ",React.createElement("b",null,shapeNowLabel),'));
  // the reason's own full stop is dropped, so the sentence never reads "…paperwork.. Your shape" (seen in the app)
  assert.ok(ns.includes('regenShape.why ? (" \\u2014 "+String(regenShape.why).replace(/[.\\s]+$/,"")) : "", ". Your shape stays ",'));
});

/* ---------------------------------------------------------------- C8 */
await test("C8 · \"Turn this into a show\" says the format change, and only when there is one",()=>{
  const box=makeBox();
  // (owner 2026-11-12, later the same day: "follow the traditional conventions of filmmaking" — a Micro-drama and a
  // Documentary are serial by nature and keep their format as Shows; scripts/test-film-conventions.mjs has the rule)
  assert.equal(box.turnShowFormatNote({format:"microdrama"}),
    "Its format stays Micro-drama: every episode of this Show is a Micro-drama episode (planned as about 2 minutes in 7 scenes).");
  assert.equal(box.turnShowFormatNote({format:"commercial"}),
    "Its format also changes, from Commercial to TV Series: every episode of a Show is a TV Series episode (planned as about 30 minutes in 24 scenes). The scenes already written are kept as they are.");
  assert.match(box.turnShowFormatNote({format:"film"}),/^Its format also changes, from Short Film to TV Series: /);
  assert.match(box.turnShowFormatNote({format:"feature"}),/^Its format also changes, from Feature Film to TV Series: /);
  assert.equal(box.turnShowFormatNote({format:"series"}),"","already a Show format: nothing to say");
  // the numbers are the format's own
  const series=box.FORMATS.find(f=>f.id==="series");
  assert.ok(box.turnShowFormatNote({format:"short"}).includes("planned as about "+box.runtimeText(series.runtimeMin*60)+" in "+series.sceneTarget+" scenes"));
  // every format that is not a Show format gets the sentence
  for(const f of box.FORMATS) assert.equal(!!box.turnShowFormatNote({format:f.id}),!f.needsShow,f.id);
  // the question uses it; the rule for the Show's format is unchanged
  assert.ok(app.includes('const fmtNote = (typeof window.turnShowFormatNote==="function") ? window.turnShowFormatNote(project) : "";'));
  assert.ok(app.includes('scenes, script and shots remain episode-specific."+(fmtNote ? " "+fmtNote : ""),'));
  assert.ok(app.includes('const seriesFormatId=(typeof window.turnShowFormatId==="function") ? window.turnShowFormatId(liveProject)'));
});

/* ---------------------------------------------------------------- C9 */
await test("C9 · while a step is running, nothing that changes the logline or leaves the step is live",()=>{
  assert.ok(ns.includes("const nsBusy = loading || researchLoading || synLoading;"));
  // the Logline step
  const logl=ns.slice(ns.indexOf('step==="loglines"\n        ? React.createElement'),ns.indexOf('step==="research"\n        ? React.createElement'));
  assert.ok(logl.includes('React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("format"),disabled:nsBusy},"\\u2190 Back"),'));
  assert.ok(logl.includes('React.createElement("button",{className:"ns-btn link",onClick:()=>develop("loglines"),disabled:nsBusy},'));
  assert.ok(logl.includes('className:"ns-cand "+(chosen===c?"on":""),disabled:nsBusy,'));
  assert.ok(logl.includes('React.createElement("textarea",{className:"ns-input",value:chosen,readOnly:nsBusy,'));
  assert.ok(logl.includes('React.createElement("button",{className:"ns-btn link",onClick:()=>setStep("format"),disabled:nsBusy,'));
  // the Research step and the Synopsis step
  const rest=ns.slice(ns.indexOf('step==="research"\n        ? React.createElement'));
  assert.ok(rest.includes('React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("loglines"),disabled:nsBusy},"\\u2190 Back"),'));
  assert.ok(rest.includes('React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("research"),disabled:nsBusy},"\\u2190 Research"),'));
  assert.ok(rest.includes('className:"ns-input syn-input",value:pg.text,rows:3,readOnly:synLoading,'));
  // the engine picker
  assert.ok(ns.includes('React.createElement("select",{className:"ns-model-sel",value:mid,disabled:nsBusy,'));
  // no Back of the three steps is left without it
  for(const m of ns.slice(ns.indexOf('step==="loglines"\n        ? React.createElement')).matchAll(/onClick:\(\)=>setStep\("(format|loglines|research)"\)([^}]*)\}/g))
    assert.ok(/disabled:nsBusy/.test(m[2]),"a live way off the step: setStep(\""+m[1]+"\")");
  // the handlers still refuse a second call themselves
  assert.ok(ns.includes("if(researchLoading || synLoading) return;")&&ns.includes("if(synLoading || researchLoading) return;"));
  // the Research button reads "Research →" when this exact intake is already researched (the old test never matched)
  assert.ok(ns.includes('(research && researchFor===intakeKey()) ? "Research \\u2192" : "Research"'));assert.ok(!ns.includes("researchFor===chosen.trim()"));
});

await test("Frances knows, and the page is on the new key",()=>{
  const box=makeBox();
  const f=box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith("New Story window: facts and the web"));
  assert.ok(f);
  for(const part of ["FACTS AND THE WEB","says so BEFORE you research","A LONG IDEA IS READ WHOLE","up to 7,000 characters","THE TYPED CONVERSATION RECOMMENDS A SHAPE TOO","REGENERATE KEEPS YOUR SHAPE",
    "WHILE A STEP IS RUNNING","TURNING A FILM INTO A SHOW, AND ITS FORMAT"]) assert.ok(f.what.includes(part),part);
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","app.jsx","newstory.jsx","formats.jsx"])
    assert.ok(["20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

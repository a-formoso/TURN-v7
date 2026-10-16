/* Art Room part 4 (owner, 2026-09-26): the render styles no longer carry one story's
   details, the format's coverage brief reaches the shot drafter, exports print the format
   LABEL, the dead wiring behind removed agent buttons is gone, Run pre-production is one
   press (its preview names the writing model), and the audit's dead code is removed. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const art=read("app/artroom.jsx"), app=read("app/app.jsx"), ai=read("app/ai.jsx"), ui=read("app/agents-ui.jsx"), ag=read("app/agents.jsx");

await test("built-in render styles carry no story's props, places or wardrobe",()=>{
  const start=art.indexOf("const CHAR_RENDER_STYLES"), end=art.indexOf("\n};",start);
  const styles=art.slice(start,end);
  for(const bad of ["marsh","staff-knot","glass vials","mud-slick","moss green robe","mud brown apron","olive-tan skin","oat-cream","around her\"","character's own light"])
    assert.ok(!styles.includes(bad),bad);
  const block=k=>styles.slice(styles.indexOf("\n  "+k+": {"),styles.indexOf("\n  },",styles.indexOf("\n  "+k+": {")));
  for(const k of ["ghibli","animated3d","paintedconcept","stopmotion","claymation","gaganime","pixelart"])
    assert.ok(/THIS (character|puppet)'s own colours/.test(block(k)),k+" defers to the character's own colours");
  assert.ok(/mustard yellow, avocado and moss green/.test(block("adv1960s")),"a genuine period palette stays");
});

await test("the format's coverage brief reaches the shot drafter; the prompt's example names nobody",async()=>{
  const calls=[];
  const box={console,localStorage:{removeItem(){}},setTimeout,clearTimeout,performance:{now:()=>0},
    CustomEvent:function(t,i){this.type=t;this.detail=i&&i.detail;}};
  box.window=box; box.dispatchEvent=()=>{}; vm.createContext(box);
  vm.runInContext(read("app/formats.jsx"),box);
  box.shotBeatScreenplay=()=>({hasSource:true,sourceRev:"r1",text:"A bottle turns on the counter.",openingAction:"A bottle turns on the counter.",
    openingCharacterIds:[],physicalCharacterIds:[],remoteCharacterIds:[],mentionedCharacterIds:[],dialogue:[]});
  box.writingLoglineOf=()=>"A drink that tastes like summer.";
  box.window.claude={ async complete(o){ calls.push(o.messages[0].content); return '{"shots":[]}'; } };
  vm.runInContext(read("app/ai.jsx"),box);
  const scene={id:"s1",no:1,title:"Pour",summary:"The pour."};
  const beats={s1:{rows:[{n:1,drive:{d:"Pours"},react:{d:"Sips"}}]}};
  await box.aiDraftShots(scene,beats,{s1:{blocks:[]}},[],[],[],{title:"Sun",format:"commercial"});
  assert.ok(calls[0].includes("FORMAT: commercial coverage: few shots, each one a poster"),"commercial coverage language");
  assert.ok(calls[0].includes("it never changes the one-keyframe-per-beat rule"));
  await box.aiDraftShots(scene,beats,{s1:{blocks:[]}},[],[],[],{title:"Sun",format:"film"});
  assert.ok(!calls[1].includes("FORMAT:"),"a format with no coverage brief adds nothing");
  for(const c of calls){ assert.ok(!/Marcus|recliner|eulogy|Daniel/.test(c),"no sample-film names in the prompt"); assert.ok(c.includes('"subjects":["<canonical cast name>"]')); }
});

await test("exports print the format's label, not its registry id",()=>{
  assert.ok(read("app/shots-ui.jsx").includes("esc((typeof formatOf===\"function\"&&formatOf(project).label)||project.format)"));
  const ex=read("app/export.jsx");
  assert.ok(ex.includes('const fmtLabel = project.format ? ((typeof formatOf==="function" && formatOf(project).label) || project.format) : "";'));
  assert.ok(!ex.includes("L.push([project.format,project.genre]"));
});

await test("props that went nowhere are gone, with the paths only they reached",()=>{
  for(const dead of ["onDirectScene","onShoot:","onScout:","onPullFromScript:","onClearLookbook","onAssignStyles","onAddLocation","setAnchorOnly","assignSceneStyles","const clearLookbook","const addLocation","setAssigningStyles"])
    assert.ok(!app.includes(dead),"app.jsx: "+dead);
  for(const dead of ["onDirectScene","onShoot","onScout","onPullFromScript","onClearLookbook","onAssignStyles","assigningStyles","onAddLocation"])
    assert.ok(!new RegExp("\\b"+dead+"\\b").test(art),"artroom.jsx: "+dead);
  assert.ok(!/\bonShoot\b/.test(read("app/shots-ui.jsx")));
  assert.ok(!/\bonScout\b|\bonPullFromScript\b/.test(read("app/locations-ui.jsx")));
  assert.ok(!/\bonClear\b/.test(read("app/lookbook.jsx").slice(0,read("app/lookbook.jsx").indexOf("function LookbookView(")+200)));
  assert.ok(!/assignDisabled/.test(read("app/stylebible-ui.jsx")));
  assert.ok(!ag.includes('issue.kind==="noanchor"')&&!ag.includes("cov.setAnchorOnly"));
  // the Scene Director is gone completely (owner, 2026-09-26: its buttons left the Shots tab on
  // 2026-06-19 — Render Scene X in order replaced it)
  for(const gone of ["sceneDirLaunch","sceneDirectorCtxFactory","NO LAUNCH POINT"]) assert.ok(!app.includes(gone),"app.jsx: "+gone);
  assert.ok(!ag.includes("agentSceneDirector")&&!ag.includes('"scenedirector"'));
  assert.ok(!ai.includes("aiQcShotFrame")&&!read("app/shots.jsx").includes("function generateShotFrame"));
  assert.ok(ai.includes("no automatic QC-and-repair agent"),"MUSE still knows there is no such agent");
});

await test("Run pre-production is one press, and its preview names the writing model",()=>{
  assert.ok(app.includes('initialAgentId:"coordinator", autoStart:true, runOnOpen:true,'));
  assert.ok(ui.includes("React.useEffect(()=>{ if(runOnOpen){ const t=setTimeout(()=>start(),60); return ()=>clearTimeout(t); } },[]);"));
  assert.ok(ui.includes("runOnOpen: !!runOnOpen && active.id===initialAgentId"));
  // no other panel opens running
  assert.equal((app.match(/runOnOpen:true/g)||[]).length,1);
  const cc=art.slice(art.indexOf("function CoordConfirm("),art.indexOf("window.CoordConfirm"));
  assert.ok(cc.includes('window.getWritingModelId("specs")')&&cc.includes('"turn-writing-model-changed"')&&cc.includes("The run starts as soon as you press Run."));
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(m.includes("RUN PRE-PRODUCTION, whose cost preview names the writing model")&&!m.includes("'Design the cast', 'Run pre-production') opens its panel READY"));
});

await test("the audit's dead code is gone and nothing still calls it",()=>{
  const names=["PreProductionStatus","StyleBibleModal","FrameToggles","deriveShotPrompt","shotLocationClause","isShotHead","sceneSubjectIds","shotDrafted",
    "canonicalShotCharacterIds","buildStagingClause","locDominantPreset","deriveLocationTime","propReferenceDependenciesChanged","buildStyleClause",
    "composeLookbookRefs","oaiGenerate","oaiSize","oaiHasKey","nbToInlineData","nbHasCameo","nbGetRefs","nbPrefetch"];
  const files=["artroom","stylebible-ui","shots-ui","shots","locations","props","stylebible","lookbook","imagegen","app","ai","agents","storyboard","stage"].map(f=>read("app/"+f+".jsx")).join("\n");
  for(const n of names) assert.ok(!new RegExp("\\b"+n+"\\b").test(files),n);
  assert.ok(read("app/imagegen.jsx").includes("window.nbPrefetchAll = nbPrefetchAll;"),"the live batched prefetch stays");
  assert.ok(!art.includes('"Next increment"')&&art.includes("This tab is still loading."));
});

await test("the Art Room's menu — home of its exports — shows at every width (the Film ⋯ menu, every room since 2026-10-16)",()=>{
  const chrome=read("app/chrome.jsx"), css=read("app/styles.css");
  assert.ok(chrome.includes('className:"overflow-wrap film-menu"+(room==="art"?" in-art":"")'));
  assert.ok(css.includes(".overflow-wrap.in-art{display:block}")&&css.includes(".app.hs .overflow-wrap.film-menu{display:block}"),"always on in the Art Room, and in every room with the homepage-style bar");
});

console.log(checks+" checks passed");

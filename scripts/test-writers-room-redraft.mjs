/* Writers' Room follow-ups (owner-approved 2026-09-25): the "needs redraft" marker, the
   reactor's inner life in the scene prompt, naming every scene's value, the marked turn
   beat replacing the dead turningPoint field, the Hero's Journey mentor in a short
   Departure, and the removals (Audit tab → Board Table layout, duplicate model pickers,
   the hidden framework toggle, dead props) with the Conflict style / source labels. */
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const box={console,React:{createElement:()=>null}}; box.window=box; vm.createContext(box);
vm.runInContext(read("app/frameworks.jsx"),box,{filename:"frameworks.jsx"});
vm.runInContext(read("app/scene-order.js"),box,{filename:"scene-order.js"});
const load=(file,names)=>{ const src=read(file), ast=parseSync(src,{sourceType:"script"});
  names.forEach(n=>{ const node=ast.program.body.find(x=>(x.type==="FunctionDeclaration"&&x.id.name===n)||
      (x.type==="VariableDeclaration"&&x.declarations.some(d=>d.id.name===n)));
    assert.ok(node,"missing "+n+" in "+file); vm.runInContext(src.slice(node.start,node.end).replace(/^const /,"var "),box); }); };
load("app/spine.jsx",["turnInfo","chargeStr","themeArgues"]);
load("app/ai.jsx",["castMemberByLabel","sceneReactorOf","psychKeyOf","sceneCardSnap","CARD_CHANGE_LABELS","cardChanges"]);
box.turnProject={framework:"threeact"};

const cast=[{id:"mara",name:"Mara Vey",conscious:"to keep the shop",unconscious:"to be forgiven",arcStages:{1:"hides",2:"cracks",3:"chooses"}},
  {id:"ivo",name:"Ivo Tanaka",conscious:"to collect the debt",unconscious:"to be wanted",arcStages:{2:"circles back"}}];
const beats={reactorLabel:"IVO",driverLabel:"MARA VEY",rows:[]};
const card={id:"s7",no:7,act:2,title:"The Offer",loc:"INT. SHOP - DAY",summary:"Mara refuses Ivo.",objective:"to refuse him",
  driver:"mara",kind:"normal",argues:"counter",conflictMode:"",openValue:"Trust",openCharge:2,closeValue:"Betrayal",closeCharge:-2,
  value:{pos:"Trust",neg:"Betrayal"},conf:2,confAuthored:true};

// ---- needs redraft: the card snapshot ----
await test("an unchanged card is up to date; each steering change is named",()=>{
  const was=box.sceneCardSnap(card,cast,beats);
  assert.deepEqual(plain(box.cardChanges(was,box.sceneCardSnap({...card},cast,beats))),[]);
  const ch=(patch,c=cast,b=beats)=>plain(box.cardChanges(was,box.sceneCardSnap({...card,...patch},c,b)));
  assert.deepEqual(ch({closeCharge:1}),["closing charge"]);
  assert.deepEqual(ch({conf:3}),["conflict source"]);
  assert.deepEqual(ch({argues:"idea"}),["Argues"]);
  assert.deepEqual(ch({kind:"crisis"}),["beat type"]);
  assert.deepEqual(ch({conflictMode:"indirect"}),["conflict style"]);
  assert.deepEqual(ch({summary:"Mara accepts."}),["summary"]);
  // the words follow the value at stake, so a new axis is reported once
  assert.deepEqual(ch({value:{pos:"Love",neg:"Hate"},openValue:"Love",closeValue:"Hate"}),["value at stake"]);
});
await test("the driver's and reactor's psychology for this act mark the script out of date",()=>{
  const was=box.sceneCardSnap(card,cast,beats);
  const castB=cast.map(c=>c.id==="mara"?{...c,arcStages:{...c.arcStages,2:"breaks"}}:c);
  assert.deepEqual(plain(box.cardChanges(was,box.sceneCardSnap(card,castB,beats))),["the driver's psychology"]);
  const castC=cast.map(c=>c.id==="ivo"?{...c,unconscious:"to be forgiven too"}:c);
  assert.deepEqual(plain(box.cardChanges(was,box.sceneCardSnap(card,castC,beats))),["the reactor's psychology"]);
  // another act's arc stage doesn't steer this scene
  const castD=cast.map(c=>c.id==="mara"?{...c,arcStages:{...c.arcStages,3:"walks away"}}:c);
  assert.deepEqual(plain(box.cardChanges(was,box.sceneCardSnap(card,castD,beats))),[]);
});
await test("an undeliberate conflict source never flags, and a missing baseline is not stale",()=>{
  const loose={...card,confAuthored:false};
  const was=box.sceneCardSnap(loose,cast,beats);
  assert.deepEqual(plain(box.cardChanges(was,box.sceneCardSnap({...loose,conf:3},cast,beats))),[]);
  assert.deepEqual(plain(box.cardChanges(null,was)),[]);
});

// ---- the reactor ----
await test("the reactor is the cast member the beat map names, never the driver",()=>{
  assert.equal(box.castMemberByLabel("MARA VEY",cast).id,"mara");
  assert.equal(box.castMemberByLabel("IVO",cast).id,"ivo");
  assert.equal(box.castMemberByLabel("",cast),null);
  assert.equal(box.sceneReactorOf(card,cast,beats).id,"ivo");
  assert.equal(box.sceneReactorOf(card,cast,{reactorLabel:"MARA"}),null);
  assert.equal(box.sceneReactorOf(card,cast,null),null);
});
load("app/ai.jsx",["writingProjectOf","writingLoglineOf","genreTag","driverNameOf","synopsisParasOf","protagonistOf","characterInnerBrief","CONFLICT_LEVELS","storyContext"]);
Object.assign(box,{contractBrief:()=>""});
await test("the scene prompt carries the reactor's inner life for this act",()=>{
  const P={title:"Ledger",framework:"threeact",premise:"What if the debt was love?"};
  const scenes=[{...card,no:1,id:"a",act:1},card,{...card,no:9,id:"c",act:3}];
  const ctx=box.storyContext(card,null,P,cast,scenes,beats);
  const line=ctx.split("\n").find(l=>l.startsWith("Reactor's inner life"))||"";
  assert.ok(line.includes("to collect the debt")&&line.includes("to be wanted")&&line.includes("circles back"),ctx);
  assert.ok(!box.storyContext(card,null,P,cast,scenes).includes("Reactor's inner life"),"no beat map, no reactor line");
});

// ---- the turn is the marked beat ----
await test("the turning point is the beat marked as the turn",()=>{
  const b={s:{rows:[{id:"b1",drive:{d:"Mara asks."},react:{d:"Ivo laughs."}},{id:"b2",drive:{d:"Mara burns the ledger"},react:{a:"Ivo freezes"}}],turnBeatId:"b2"}};
  assert.equal(box.sceneTurnText({id:"s"},b),"Mara burns the ledger — Ivo freezes.");
  assert.equal(box.sceneTurnText({id:"s"},{s:{rows:b.s.rows,turnAt:1}}),"Mara asks — Ivo laughs.");
  assert.equal(box.sceneTurnText({id:"x",turningPoint:"legacy text"},b),"legacy text");
  assert.equal(box.sceneTurnText({id:"x"},b),"");
  for(const f of ["app/app.jsx","app/agents.jsx"]) assert.ok(!read(f).includes('turningPoint:""'),f+" no longer creates the dead field");
  assert.ok(!/\.turningPoint\b/.test(read("app/ai.jsx").replace("(sc && sc.turningPoint)","")),"ai.jsx reads the turn through turnTextOf");
});

// ---- Hero's Journey: the mentor survives a short Departure ----
load("app/agents.jsx",["acceptDeclaredStages","assignPlotPoints"]);
await test("a short Departure keeps Meeting the Mentor",()=>{
  box.turnProject={framework:"herosjourney"};
  const film=n1=>Array.from({length:n1+8},(_,i)=>({id:"h"+i,no:i+1,act:i<n1?1:i<n1+5?2:3,openCharge:1,closeCharge:-1,kind:"normal"}));
  const dep=n1=>box.assignPlotPoints(film(n1)).slice(0,n1).map(s=>s.kind);
  assert.deepEqual(plain(dep(6)),["ordinary-world","normal","call","refusal","mentor","threshold"]);
  assert.deepEqual(plain(dep(5)),["ordinary-world","call","refusal","mentor","threshold"]);
  assert.deepEqual(plain(dep(4)),["ordinary-world","call","mentor","threshold"]);
  assert.deepEqual(plain(dep(3)),["ordinary-world","call","threshold"]);
  box.turnProject={framework:"threeact"};
});

// ---- name every scene's value ----
load("app/ai.jsx",["aiNameSceneValues"]);
await test("naming values keeps known poles and fills only the missing ones",async()=>{
  let sent="";
  Object.assign(box,{aiAvailable:()=>true,extractJSON:JSON.parse,scrubBrand:s=>String(s),
    claude:{complete:async o=>{sent=o.messages[0].content;return JSON.stringify({values:[
      {no:1,pos:"Hope",neg:"Despair."},{no:2,pos:"Freedom",neg:"Captivity"},{no:3,pos:"Same",neg:"same"},{no:99,pos:"X",neg:"Y"}]});}}});
  const out=await box.aiNameSceneValues([
    {id:"a",no:1,title:"One",summary:"x",openValue:"Trust",openCharge:2,closeValue:"",closeCharge:-1,pos:"Trust",neg:""},
    {id:"b",no:2,title:"Two",summary:"y",pos:"",neg:""},
    {id:"c",no:3,title:"Three",summary:"z",pos:"",neg:""}],{title:"Ledger"});
  assert.deepEqual(plain(out),{a:{pos:"Trust",neg:"Despair"},b:{pos:"Freedom",neg:"Captivity"}});
  assert.ok(sent.includes("positive pole: Trust | negative pole: ?")&&sent.includes("keep every known pole EXACTLY"));
  box.aiAvailable=()=>false;
  assert.deepEqual(plain(await box.aiNameSceneValues([{id:"a",no:1}],{})),{});
});

// ---- wiring ----
const app=read("app/app.jsx"), chrome=read("app/chrome.jsx"), insp=read("app/inspector.jsx"), script=read("app/script.jsx"),
  agents=read("app/agents.jsx"), agentsUi=read("app/agents-ui.jsx"), spine=read("app/spine.jsx"), ai=read("app/ai.jsx");
await test("the marker is shown on the spine, the Scene tab and the Script view, with a batch redraft",()=>{
  assert.ok(app.includes("const staleMap = React.useMemo(")&&app.includes("const redraftAllStale = async ()=>{")&&app.includes("const keepDraft = (id)=>{"));
  assert.ok(app.includes("staleIds:new Set(Object.keys(staleMap))")&&spine.includes('className:"scard-stale"'));
  assert.ok(insp.includes('className:"insp-stale"')&&script.includes("Keep this draft")&&script.includes("\"Redraft \"+staleCount+\" out-of-date\""));
  assert.ok(agents.includes("cardSnap")&&agents.includes("marked \\u201cneeds redraft\\u201d"),"story build stamps drafts; Continuity Repair says where its lines went");
});
await test("story-level inputs are editable in the left rail",()=>{
  assert.ok(chrome.includes("premise-edit")&&chrome.includes("ctrl-idea-edit")&&chrome.includes("ctrl-polarity")&&chrome.includes('"Synopsis by act"')&&chrome.includes("rail-setting-val"));
  assert.ok(app.includes("onProject:updateProjectFields"));
});
await test("the Audit tab is the Board's Table layout, and the subtitle counts the real film",()=>{
  assert.ok(!chrome.includes('["audit"')&&!chrome.includes('["beats","Audit"'));
  assert.ok(app.includes('[["columns","Columns"],["table","Table"]]')&&app.includes('boardMode==="table" && scenes.length>0 && React.createElement(TurnAudit'));
  assert.ok(!app.includes('"16 scenes across 3 acts"')&&app.includes('scenes.length+" scene"'));
});
await test("one writing-model setting: pickers where a build starts at once, labels on agent panels",()=>{
  const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+"/"+e.name):[d+"/"+e.name]);
  const src=walk("app").filter(f=>/\.(jsx|js)$/.test(f)).map(f=>[f,read(f)]);
  for(const [f,s] of src) for(const dead of ["WritingModelPicker","showFramework","onFixScene","toggleAI","aiOpen","onRedraftScript"])
    assert.ok(!s.includes(dead),dead+" is gone from "+f);
  const head=agentsUi.slice(agentsUi.indexOf('className:"ag-runner-head"'),agentsUi.indexOf("agent.needsInput && status===\"idle\""));
  assert.ok(head.includes('className:"ag-runner-model"')&&!head.includes('"select"'));
  // the rebuild starts at once, so the Story brief keeps a picker on the same one setting
  const brief=chrome.slice(chrome.indexOf("function StoryBriefModal("),chrome.indexOf("window.StoryBriefModal"));
  assert.ok(brief.includes('className:"brief-model-sel"')&&brief.includes("window.setWritingModelId(id)")&&brief.includes('"turn-writing-model-changed"'));
  assert.ok(read("app/newstory.jsx").includes('window.addEventListener("turn-writing-model-changed", h);'),"the New Story picker follows the dock too");
});
await test("labels read Conflict style / Conflict source, and the tooltip names the Final Read",()=>{
  for(const f of ["app/inspector.jsx","app/spine.jsx","app/shots-ui.jsx","app/storyboard.jsx"]){
    const s=read(f); assert.ok(!/"Conflict level|Conflict level ·|"Conflict mode"/.test(s),f);
  }
  assert.ok(insp.includes("Conflict style")&&insp.includes("Conflict source"));
  // Script Breakdown moved into the Art Room's Production check (2026-09-26)
  assert.ok(chrome.includes("Story Doctor, Script Supervisor, Setups & Payoffs, Final Read\"")&&!chrome.includes("Final Read, Script Breakdown"));
});
await test("every component the app renders is defined (the Beats tab's BeatEditor was once dropped)",()=>{
  const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+"/"+e.name):[d+"/"+e.name]);
  const all=walk("app").filter(f=>/\.(jsx|js)$/.test(f)).map(read).join("\n");
  const used=new Set([...all.matchAll(/React\.createElement\(([A-Z][A-Za-z0-9_]*)[,)]/g)].map(m=>m[1]));
  const missing=[...used].filter(c=>!new RegExp("(function "+c+"\\b|(const|let|var) "+c+" *=|window\\."+c+" *=|class "+c+"\\b)").test(all));
  assert.deepEqual(missing,[],"rendered but never defined: "+missing.join(", "));
  assert.ok(insp.includes("function BeatEditor(")&&insp.includes("React.createElement(BeatEditor,"));
});
await test("Story Circle is retired: never offered for a new story, still opens old films",()=>{
  assert.deepEqual(plain(box.frameworkChoices().map(f=>f.id)),["threeact","kishotenketsu","herosjourney"]);
  assert.equal(box.frameworkOf({framework:"storycircle"}).id,"storycircle","a film built on it keeps its four act bands");
  assert.equal(box.choosableFrameworkId("storycircle"),"threeact");
  assert.equal(box.choosableFrameworkId("herosjourney"),"herosjourney");
  const ns=read("app/newstory.jsx"), landing=read("app/landing.jsx");
  assert.ok(ns.includes("window.frameworkChoices()")&&!/\(window\.FRAMEWORKS\|\|\[\]\)\.map\(f=>\s*React\.createElement\("button"/.test(ns));
  assert.ok(ai.includes("const _fws  = _fwList.map(")&&ai.includes("const fwOk  = sh && _fwList.some(")&&!ai.includes("wants storycircle"));
  assert.ok(!/story circle/i.test(landing));
  assert.ok(app.includes("window.choosableFrameworkId(project.framework)"),"rebuilding an old Story Circle film builds Three-Act");
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(m.includes("STORY CIRCLE has been RETIRED")&&!m.includes("Story Circle gets")&&!m.includes("Hero's Journey / Story Circle)"));
  assert.ok(read("docs/Story Pipeline.md").includes("was **retired 2026-09-25 by owner**"));
});
await test("the Conflict style select fits the panel",()=>{
  assert.ok(insp.includes('React.createElement("div",{style:{flex:1,minWidth:0}}')&&insp.includes('className:"insp-select insp-select-full"'));
  assert.ok(/\.insp-select-full\{[^}]*width:100%;[^}]*max-width:100%;[^}]*box-sizing:border-box/.test(read("app/styles.css")));
});
await test("the Story Contract reads as a card: titled questions, facts, a coloured climax check",()=>{
  const c=read("app/contract.jsx"), css=read("app/styles.css");
  for(const bit of ['className:"contract-banner"','head("Outer plot","What changes in the world")','head("Inner arc","What changes inside the protagonist")',
    'head("Climax pays off"','meta("Outer value"','className:"contract-verdict "+verdictCls,role:"status"']) assert.ok(c.includes(bit),bit);
  assert.ok(!c.includes('className:"obj-lab"'),"no tiny mono labels for whole questions");
  assert.ok(/\.contract-wrap\{[^}]*background:var\(--bg-2\);border:1px solid var\(--line\)/.test(css)&&css.includes(".contract-verdict.warn{background:var(--alert-soft)"));
  assert.ok(!css.includes(".contract-note{")&&!css.includes(".contract-axis{"),"the old italic note / mono axis styles are gone");
});
load("app/chrome.jsx",["_SLUG_PREFIX","railSlugParts","railTodKind","railRoleParts"]);
await test("the Setting and Cast tabs read the film: sluglines, time of day, archetype tags",()=>{
  assert.deepEqual(plain(box.railSlugParts("INT. FATHER'S HOUSE - NIGHT")),{place:"Father's House",key:"FATHER'S HOUSE",tod:"NIGHT"});
  assert.equal(box.railSlugParts("EXT./INT. FUNERAL CHAPEL - DAWN").place,"Funeral Chapel");
  assert.equal(box.railSlugParts(""),null);
  assert.equal(box.railTodKind("NIGHT"),"night"); assert.equal(box.railTodKind("DUSK"),"dusk"); assert.equal(box.railTodKind("DAY"),"day"); assert.equal(box.railTodKind(""),"other");
  assert.deepEqual(plain(box.railRoleParts("MIRROR \u00b7 THE PRODIGAL \u2014 the brother who ran")),{tags:["Mirror","The Prodigal"],desc:"the brother who ran"});
  assert.deepEqual(plain(box.railRoleParts("PROTAGONIST \u2014 the son who stayed")),{tags:["Protagonist"],desc:"the son who stayed"});
  assert.deepEqual(plain(box.railRoleParts("")),{tags:[],desc:""});
  assert.ok(chrome.includes("React.createElement(WorldPane,{project, scenes, edit, setSetting})")&&chrome.includes("React.createElement(CastPane,{characters, scenes, selChar, onSelectChar})"));
  assert.ok(!read("app/styles.css").includes(".char-row{"),"the old cast-row styles are gone");
});
await test("the Board's Table speaks the structure's language; the spine axis is the charge itself",()=>{
  const fw=read("app/frameworks.jsx");
  assert.equal((fw.match(/tableTitle:"/g)||[]).length,4,"every framework names its own audit");
  assert.ok(fw.includes('tableTitle:"Movement audit · Ki and Shō move, the Ten reverses, the Ketsu may settle"'));
  const ta=app.slice(app.indexOf("function TurnAudit("),app.indexOf("function Board("));
  assert.ok(ta.includes("React.createElement(\"span\",{className:\"eyebrow\"},tableTitle)")&&ta.includes("actLabel(s.act)")&&!ta.includes("every scene must turn\")"));
  assert.ok(!/valueAxis/.test(spine)&&spine.includes('"Positive +"')&&!read("app/contract.jsx").includes("function contractAxis"));
  assert.ok(read("app/contract.jsx").includes('meta("Outer value"'));
});
await test("the Writing dock keeps its right-edge spot when the Scene / Character panel opens (owner 2026-09-28)",()=>{
  const css=read("app/styles.css");
  assert.ok(!app.includes("wr-insp-open")&&!css.includes("wr-insp-open"),"nothing moves the dock when the panel opens");
  assert.ok(!/insp[^{}]*\.write-dock\s*\{[^}]*\bright\s*:/.test(css),"no inspector state overrides the dock's right edge");
  // (consistency pass 2026-09-29) the dock's layer is 72: above the panel, below every dialog and Home
  assert.ok(css.includes(".nb-dock{display:block;position:fixed;right:22px;top:50%;transform:translateY(-50%);z-index:72}"),"it floats above the layout");
  const inspZ=[...css.matchAll(/\.inspector\s*\{([^}]*)\}/g)].map(m=>/z-index:\s*(\d+)/.exec(m[1])).filter(Boolean).map(m=>Number(m[1]));
  assert.ok(inspZ.every(z=>z<72),"every panel layer (the phone drawer is 60) sits below the dock");
  for(const ov of [".ag-overlay",".ns-overlay",".auth-overlay",".hd-root"]){
    const m=new RegExp(ov.replace(".","\\.")+"\\s*\\{[^}]*z-index:\\s*(\\d+)").exec(css);
    assert.ok(m&&Number(m[1])>72,ov+" (a dialog / Home) covers the dock");
  }
});
await test("Story Doctor notes are neutral and never counted as issues",()=>{
  assert.ok(agentsUi.includes("const issuesN = noTurnN + structN + contN;")&&agentsUi.includes('"No structural or continuity issues. "'));
  assert.ok(agentsUi.includes('db.n+" "+db.word+(db.n>1?"s":"")')&&read("app/styles.css").includes(".ag-issues-badge.note,.ag-card-count.note{"));
});
await test("MUSE's manifest and the pipeline doc describe the change",()=>{
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  for(const bit of ['name:"Needs redraft (script out of date)"','name:"Story-level inputs (left rail: Premise and Setting)"',"REACTOR'S inner life",
    "NAME EVERY SCENE'S VALUE","'Conflict style' select","Conflict source pips","Columns / Table switch","MEETING THE MENTOR"]) assert.ok(m.includes(bit),bit);
  for(const gone of ["Table-Read","Audit table","Conflict level pips","'Conflict mode' select","picker in every agent-panel header"]) assert.ok(!m.includes(gone),gone);
  const doc=read("docs/Story Pipeline.md");
  assert.ok(doc.includes("**Needs redraft** *(added 2026-09-25 by owner)*")&&doc.includes("**reactor's inner life** *(added 2026-09-25 by owner)*")&&!doc.includes("Table-Read"));
});
console.log(checks+" checks passed");

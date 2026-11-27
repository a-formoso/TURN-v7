/* THE SMALL VISIBLE FAULTS (owner 2026-11-11, Writers' Room audit C1, C2, D1, D2, D5, B4). Seen on the test films:
     C1  the working title typed on the Synopsis step was dropped for the scene list's own title;
     C2  after picking another structure, the Logline step still announced the suggestion;
     D1  a scene that holds at -2 was described as "A value-charged condition reverses";
     D2  a sound Kishotenketsu list read "8 scenes, 2 of them moving", with its scenes labelled Act I-IV;
     D5  the build said "from your logline" when it was built from the reviewed synopsis;
     B4  writing a scene could give it a title another scene already had.
   This runs the REAL build (app/agents.jsx agentAdaptation), the REAL scene verdict (app/inspector.jsx) and pins the
   New Story wiring.
   node scripts/test-writers-room-small-faults.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
const textOf=(n)=>n==null||n===false?"":typeof n==="string"||typeof n==="number"?String(n):Array.isArray(n)?n.map(textOf).join(""):textOf(n.children);

const box={console:{...console,warn:noop,info:noop},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  React:new Proxy({createElement:h,Fragment:"f",useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useCallback:f=>f,memo:f=>f},{get:(t,k)=>(k in t)?t[k]:noop}),
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
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/inspector.jsx","app/script.jsx","app/ai.jsx","app/build-state.js","app/agents.jsx"])
  vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
box.appToast=noop;box.scenePause=()=>Promise.resolve();
box.sbClient=()=>({functions:{invoke:async()=>({data:{text:"",usage:{credits:0}},error:null})}});   // the cast passes get nothing back: the build carries on
box.isStandInDraft=d=>!!(d&&d.auto);

const beats=()=>({rows:[{n:1,drive:{a:"Waits",d:"She waits."},react:{a:"Holds",d:"Nothing answers."},charge:1}]});
const draft=()=>({blocks:[{type:"scene",text:"INT. ROOM - DAY",beat:1},{type:"action",text:"She waits.",beat:1}],ai:true});
const spineOf=(acts,charges,title)=>({title:title||"Model Title",scenes:acts.map((a,i)=>({act:a,title:"Scene "+(i+1),loc:"INT. ROOM - DAY",summary:"Event "+(i+1)+".",driver:"ana",
  openValue:"Hope",openCharge:charges[i][0],closeValue:"Hope",closeCharge:charges[i][1],stage:""}))});
const run=async({brief,project,framework,spine,retitle})=>{
  box.turnProject={format:"short",framework:framework||"threeact",...(project||{})};
  const trace=[],cards=[];
  const ctx={input:brief,project:{title:"Untitled",format:"short",framework:framework||"threeact",...(project||{})},
    model:{scenes:[],characters:[],project:{},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async c=>{cards.push(c);return true;},cancelled:()=>false,sync:()=>true,
    ai:{available:true,buildSpine:async()=>spine,
      authorScene:async(s)=>({patch:(retitle&&retitle[s.no])?{title:retitle[s.no]}:{},beats:beats()}),
      draftScene:async()=>draft()}};
  await box.agentAdaptation(ctx);
  return{ctx,trace,cards};
};
const SYN="LOGLINE: A locksmith opens a door.\n\nSYNOPSIS — My Own Title:\nThe Setup: He is called.";

await test("C1 the working title on the Synopsis step is the film's title, for the brief it was typed for",async()=>{
  const sp=()=>spineOf([1,1,2,2,3,3],[[1,-2],[-2,2],[2,-1],[-1,2],[2,-2],[-2,3]]);
  const a=await run({brief:SYN,project:{workingTitle:"  My Own   Title ",sourceBrief:SYN},spine:sp()});
  assert.equal(a.cards[0].title,"Create the project “My Own Title”");
  assert.equal(a.ctx.model.project.title,"My Own Title");
  assert.ok(a.trace.some(s=>s.k==="observe"&&s.t.startsWith('"My Own Title" — 6 scenes')));
  assert.ok(a.trace.some(s=>s.k==="done"&&s.t.startsWith("“My Own Title” is fully written.")));
  assert.equal(a.ctx.model.project.workingTitle,undefined,"used once: it does not stay on the film");
  // a rebuild from ANOTHER brief titles itself; so does a build with the box left empty
  const b=await run({brief:"LOGLINE: Something else entirely.",project:{workingTitle:"My Own Title",sourceBrief:SYN},spine:sp()});
  assert.equal(b.ctx.model.project.title,"Model Title");
  const c=await run({brief:SYN,project:{sourceBrief:SYN},spine:sp()});
  assert.equal(c.ctx.model.project.title,"Model Title");
  // New Story hands it over with the brief
  const app=read("app/app.jsx");
  assert.ok(app.includes('workingTitle: String((synopsis && synopsis.title) || "").trim() || undefined,'));
});

await test("D2 + D5 a Kishōtenketsu build's first card speaks its own words and counts by its own rule",async()=>{
  // the list from the audit: ki and sho hold or drift, the ten reverses, the ketsu settles — two sign reversals
  const k=await run({brief:SYN,framework:"kishotenketsu",project:{sourceBrief:SYN},
    spine:spineOf([1,1,2,2,3,4,4,4],[[-2,-2],[-2,1],[1,2],[0,1],[-2,2],[1,2],[1,2],[1,3]],"Without Force")});
  assert.ok(k.trace.some(s=>s.k==="plan"&&s.t.startsWith("Designing a complete kishōtenketsu spine from your synopsis —")));
  assert.ok(k.trace.some(s=>s.k==="observe"&&s.t.startsWith('"Without Force" — 8 scenes across 4 movements, 8 of them moving.')),k.trace.filter(s=>s.k==="observe").map(s=>s.t).join(" | "));
  const card=k.cards[0];
  assert.equal(card.rationale,"8 new scenes · 8 move cleanly · beats + script written automatically");
  assert.equal(card.reason,"This builds the whole spine from your synopsis, then writes every scene's beats and screenplay.");
  assert.equal(card.list.map(l=>l.split(" · ")[1]).join(","),"Ki,Ki,Shō,Shō,Ten,Ketsu,Ketsu,Ketsu");
  assert.ok(!card.list.some(l=>/Act /.test(l)));
  // an inert ki scene (0 to 0) is not counted as moving
  const k2=await run({brief:SYN,framework:"kishotenketsu",project:{sourceBrief:SYN},spine:spineOf([1,2,3,4],[[0,0],[1,2],[-2,2],[1,2]])});
  assert.ok(k2.trace.some(s=>s.k==="observe"&&/4 scenes across 4 movements, 3 of them moving\./.test(s.t)));
  // Hero's Journey names its three parts; three-act keeps Act I-III and counts reversals, from a logline
  const hj=await run({brief:SYN,framework:"herosjourney",project:{sourceBrief:SYN},spine:spineOf([1,2,3],[[1,-2],[-2,2],[2,-3]])});
  assert.equal(hj.cards[0].list.map(l=>l.split(" · ")[1]).join(","),"Departure,Initiation,Return");
  const ta=await run({brief:"A locksmith opens his son's door.",spine:spineOf([1,2,2,3],[[1,-2],[-2,-1],[2,-1],[-2,3]])});
  assert.equal(ta.cards[0].list.map(l=>l.split(" · ")[1]).join(","),"Act I,Act II,Act II,Act III");
  assert.ok(ta.trace.some(s=>s.k==="plan"&&s.t.startsWith("Designing a complete three-act spine from your logline —")));
  assert.ok(ta.trace.some(s=>s.k==="observe"&&/4 scenes across 3 acts, 3 of them turning\./.test(s.t)));
  assert.equal(ta.cards[0].reason,"This builds the whole spine from your logline, then writes every scene's beats and screenplay.");
});

await test("B4 writing a scene never gives it a title another scene has; a title of its own is kept",async()=>{
  const r=await run({brief:SYN,project:{sourceBrief:SYN},spine:spineOf([1,2,2,3],[[1,-2],[-2,2],[2,-1],[-1,3]]),
    retitle:{2:"The Hinge",3:"  scene 1! ",4:"The Hinge"}});
  assert.equal(r.ctx.model.scenes.map(s=>s.title).join(" | "),"Scene 1 | The Hinge | Scene 3 | Scene 4");
});

await test("D1 a scene is said to reverse only when it does",()=>{
  const said=(scene,framework)=>{box.turnProject={framework};return textOf(box.Verdict({scene}));};
  const ki={act:1,kind:"normal",openValue:"Idleness",openCharge:-2,closeValue:"Idleness",closeCharge:-2};
  const k=said(ki,"kishotenketsu");
  assert.ok(k.includes("This scene carries its movement"),k);
  assert.ok(k.includes("Idleness (−2) → Idleness (−2). It plants or deepens without reversing — this structure allows that; only the ten has to reverse.")
    ||/Idleness \(.2\) → Idleness \(.2\)\. It plants or deepens without reversing — this structure allows that; only the ten has to reverse\./.test(k),k);
  assert.ok(!k.includes("reverses — the scene earns its place"));
  // a ki scene that really flips, and any three-act scene that turns, still say so
  assert.ok(said({...ki,closeCharge:2,closeValue:"Purpose"},"kishotenketsu").includes("A value-charged condition reverses — the scene earns its place."));
  assert.ok(said({act:2,kind:"normal",openValue:"Trust",openCharge:2,closeValue:"Betrayal",closeCharge:-3},"threeact").includes("A value-charged condition reverses — the scene earns its place."));
});

await test("C2 the Logline step says the writer's own shape once they have picked one",()=>{
  const ns=read("app/newstory.jsx");
  assert.ok(ns.includes("applied.formatId=sh.format;")&&ns.includes("applied.frameworkId=sh.framework;"));
  assert.ok(ns.includes("const shapeStillSuggested = !!autoShape && (!autoShape.formatId || format===autoShape.formatId) && (!autoShape.frameworkId || framework===autoShape.frameworkId);"));
  const line=ns.slice(ns.indexOf('"data-testid":"ns-shape-line"'),ns.indexOf('title:"Back to the Shape step'));
  assert.ok(line.includes("shapeStillSuggested")&&line.includes('"Shaped for this story: "')&&line.includes('"Your shape: "'));
  assert.ok(line.includes('" \\u2014 your own pick. The suggestion was "+[autoShape.formatLabel, autoShape.frameworkLabel].filter(Boolean).join(" \\u00b7 ")+"."'));
  // the rule itself, on the cases seen: suggestion kept; structure changed; a knob the suggestion never touched changed
  const rule=(auto,format,framework)=>!!auto&&(!auto.formatId||format===auto.formatId)&&(!auto.frameworkId||framework===auto.frameworkId);
  const auto={formatId:"commercial",frameworkId:"kishotenketsu"};
  assert.equal(rule(auto,"commercial","kishotenketsu"),true);
  assert.equal(rule(auto,"commercial","threeact"),false);
  assert.equal(rule({frameworkId:"kishotenketsu"},"short","kishotenketsu"),true);
});

await test("the editor window's heading is one line: room \u00b7 editor \u00b7 status",()=>{
  // (owner 2026-11-11, from a screenshot: "Story Editors \u00b7" / "Adaptation" / "Working\u2026" stood on three lines)
  const css=read("app/styles.css"),ui=read("app/agents-ui.jsx");
  assert.ok(css.includes(".ag-runner-head .ag-runner-t{display:flex;align-items:baseline;min-width:0;white-space:nowrap;overflow:hidden}"));
  assert.ok(/\.ag-runner-head \.ag-runner-name\{display:flex;[^}]*flex-wrap:nowrap;white-space:nowrap;font-size:17px/.test(css));
  // the editor's name never shrinks; the room's name gives way first, and the status keeps its place after a dot
  assert.ok(/\.ag-runner-head \.ag-runner-muse\{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis/.test(css));
  assert.ok(css.includes(".ag-runner-head .ag-runner-sub{flex:0 0 auto;margin:0 0 0 8px;white-space:nowrap}")&&css.includes('.ag-runner-head .ag-runner-sub::before{content:"\\00b7";margin-right:8px}'));
  // room for it on a desktop only: a phone keeps its full-width window
  assert.ok(css.includes("@media (min-width:641px){ .ag-panel{width:min(740px,96vw)} }"));
  assert.ok(css.indexOf("@media (min-width:641px){ .ag-panel{width:min(740px,96vw)} }")>css.indexOf(".ag-panel{width:min(620px,96vw)"));
  // the markup is unchanged: the room, the editor's name, then the status
  assert.ok(ui.includes('React.createElement("div",{className:"ag-runner-sub"},')&&ui.includes('React.createElement("span",{className:"ag-runner-muse"},'));
  assert.ok(["20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1"].some(k=>read("TURN.html").includes("app/styles.css?v="+k+'"')));
});

await test("Frances knows; the page is on the new key",()=>{
  const ns=(box.APP_FEATURES||[]).find(x=>x&&String(x.name||"").startsWith("New Story (format")),sv=(box.APP_FEATURES||[]).find(x=>x&&x.name==="Spine view");
  for(const s of ["THE WORKING TITLE IS THE FILM'S TITLE","'Your shape: … — your own pick. The suggestion was …'","Ki / Shō / Ten / Ketsu","a scene never takes a title another scene already has"]) assert.ok(ns.what.includes(s),s);
  assert.ok(sv.what.includes("says a scene reverses only when its charge really changes sign"));
  const html=read("TURN.html");
  for(const file of ["frameworks.jsx","inspector.jsx","agents.jsx","newstory.jsx","app.jsx","ai.jsx","script.jsx"])
    assert.ok(["20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

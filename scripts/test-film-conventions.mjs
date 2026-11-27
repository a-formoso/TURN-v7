/* THE TRADITIONAL CONVENTIONS OF FILMMAKING (owner 2026-11-12, two decisions in one sentence):
     1. a slugline is INT./EXT., the LOCATION, then the TIME OF DAY — the time is never part of the location's name.
        The Art Room's reader (locations.jsx parseSlugline) names location cards and slugline units, so a film that
        already has work under a name the old reading produced keeps reading its scenes onto that card;
     2. a Show has the format film convention gives it: a format that is serial by nature keeps itself (Micro-drama,
        Documentary), a single work becomes a TV Series.
   Runs the REAL app code (locations.jsx, formats.jsx, script.jsx's reader for agreement).
   node scripts/test-film-conventions.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const json=x=>JSON.parse(JSON.stringify(x));

const makeBox=()=>{
  const box={console:{...console,warn:noop,info:noop},setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,clearInterval:noop,
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
  const jsx=f=>transformSync(read(f),{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:f}).code;
  for(const f of ["app/formats.jsx","app/scene-order.js","app/script.jsx","app/locations.jsx"]) vm.runInContext(f.endsWith(".jsx")?jsx(f):read(f),box,{filename:f});
  return box;
};
const P=(box,l)=>json(box.parseSlugline(l));

/* ---------------------------------------------------------------- 1. the slugline */
await test("a slugline is INT./EXT., the LOCATION, then the TIME OF DAY — the hour is never part of the place",()=>{
  const box=makeBox();
  const cases={
    "INT. NEWSROOM - PRE-DAWN":["INT","NEWSROOM","PRE-DAWN"],
    "INT. NEWSROOM – PRE-DAWN":["INT","NEWSROOM","PRE-DAWN"],          // en dash (the old reader did not know it)
    "INT. NEWSROOM — PRE-DAWN":["INT","NEWSROOM","PRE-DAWN"],
    "INT. NEWSROOM · PRE-DAWN":["INT","NEWSROOM","PRE-DAWN"],
    "EXT. PIER - MID-MORNING":["EXT","PIER","MID-MORNING"],
    "INT. NEWSROOM - NIGHT":["INT","NEWSROOM","NIGHT"],
    "INT. CO-OP - NIGHT":["INT","CO-OP","NIGHT"],                            // a hyphen inside the place stays there
    "INT. X-RAY ROOM - CONTINUOUS":["INT","X-RAY ROOM","CONTINUOUS"],
    "INT. HOUSE - KITCHEN - NIGHT":["INT","HOUSE - KITCHEN","NIGHT"],        // a sub-location sits between the two
    "INT. NEBUCHADNEZZAR · CORE · NIGHT":["INT","NEBUCHADNEZZAR · CORE","NIGHT"],
    "INT. KITCHEN, NIGHT":["INT","KITCHEN","NIGHT"],
    "INT. SHOP-DAWN":["INT","SHOP","DAWN"],                                  // typed without spaces
    "INT. BAR - MIDNIGHT":["INT","BAR","MIDNIGHT"],                          // these three stayed in the place's name
    "EXT. SQUARE - NOON":["EXT","SQUARE","NOON"],
    "EXT. MOOR - TWILIGHT":["EXT","MOOR","TWILIGHT"],
    "EXT. PIER - DAY - LATER":["EXT","PIER","DAY"],                          // LATER / CONTINUOUS only qualify the hour
    "INT. HALL - NIGHT, CONTINUOUS":["INT","HALL","NIGHT"],
    "INT. HALL - LATER":["INT","HALL","LATER"],
    "INT. HALL - MOMENTS LATER":["INT","HALL","MOMENTS LATER"],
    "EXT. ROAD - LATE NIGHT":["EXT","ROAD","LATE NIGHT"],
    "EXT. ROAD - THE NEXT DAY":["EXT","ROAD","THE NEXT DAY"],
    "INT. FURNACE · NIGHTS":["INT","FURNACE","NIGHTS"],
    "INT. CONSTRUCT - LOADING PROGRAM":["INT","CONSTRUCT","LOADING PROGRAM"],
    "INT./EXT. CAR - DUSK":["INT/EXT","CAR","DUSK"],
    "12. INT. OFFICE - DAY":["INT","OFFICE","DAY"],
    // a time word inside the PLACE is not the time of day
    "INT. ALL-NIGHT DINER":["INT","ALL-NIGHT DINER",""],
    "INT. BAR - THE NIGHT OWL":["INT","BAR - THE NIGHT OWL",""],
    "INT. DAY CARE CENTRE":["INT","DAY CARE CENTRE",""],
    "INT. HOUSE - KITCHEN-DINER":["INT","HOUSE - KITCHEN-DINER",""],
    "EXT. STREET":["EXT","STREET",""],
  };
  for(const [slug,[side,place,time]] of Object.entries(cases)){
    const p=P(box,slug);
    assert.equal(p.intExt,side,slug);assert.equal(p.place,place,slug+" → place");assert.equal(p.time.toUpperCase(),time,slug+" → time");
  }
  assert.equal(box.parseSlugline(""),null);assert.equal(box.parseSlugline("   "),null);
});

await test("the Script view's reader and the Art Room's reader agree on the place and the hour",()=>{
  const box=makeBox();
  for(const slug of ["INT. NEWSROOM - PRE-DAWN","INT. NEWSROOM – PRE-DAWN","EXT. PIER - MID-MORNING","INT. CO-OP - NIGHT","INT. HOUSE - KITCHEN - NIGHT","INT. KITCHEN, NIGHT","INT. SHOP-DAWN","INT. BAR - MIDNIGHT"]){
    const a=P(box,slug),b=json(box.parseSlug(slug));
    assert.equal(a.place,b.place,slug);assert.equal(a.time.toUpperCase(),b.time.toUpperCase(),slug);
  }
});

const sc=(i,loc)=>({id:"s"+i,no:i,act:1,title:"S"+i,loc,summary:"x"});
await test("a new film: the Newsroom at night and at pre-dawn is ONE location, with two times of day",()=>{
  const box=makeBox();
  const scenes=[sc(1,"INT. NEWSROOM - NIGHT"),sc(2,"INT. NEWSROOM - PRE-DAWN"),sc(3,"EXT. LOADING BAY - DAWN"),sc(4,"INT. NEWSROOM - DAY")];
  box.turnNoteSavedLocations([]);
  const cards=json(box.deriveLocations(scenes,[],{}));
  assert.deepEqual(cards.map(c=>c.key),["newsroom","loading-bay"]);
  const news=cards[0];
  assert.equal(news.name,"Newsroom");assert.deepEqual(news.scenes,["s1","s2","s4"]);
  assert.deepEqual(news.times,["Dawn","Day","Night"],"pre-dawn is a time of day of the same place");
  assert.ok(!cards.some(c=>/pre/i.test(c.key)||/ - Pre/.test(c.name)),"no location called “Newsroom - Pre”");
});

await test("a film that already has work under the old name keeps reading its scenes onto that card",()=>{
  const box=makeBox();
  const scenes=[sc(1,"INT. NEWSROOM - NIGHT"),sc(2,"INT. NEWSROOM - PRE-DAWN"),sc(3,"INT. BAR - MIDNIGHT")];
  // saved before 12 November: the old reading made "Newsroom - Pre", and the writer described it
  const saved=[{id:"loc-newsroom-0",key:"newsroom",name:"Newsroom",intExt:"INT",times:["Night"],areas:[],scenes:["s1"],architecture:"",variants:[],provenance:{},fromScript:true},
    {id:"loc-newsroom-pre-1",key:"newsroom-pre",name:"Newsroom - Pre",intExt:"INT",times:["Dawn"],areas:[],scenes:["s2"],architecture:"A long open floor under strip lights.",variants:[],provenance:{},fromScript:true}];
  box.turnNoteSavedLocations(saved);
  assert.deepEqual(P(box,"INT. NEWSROOM - PRE-DAWN"),{intExt:"INT",place:"NEWSROOM - PRE",time:"DAWN"},"the saved card's reading stands");
  // nothing new is derived for that slugline, so no second card appears and the saved one keeps its scene
  const fresh=json(box.deriveLocations(scenes,saved,{}));
  assert.deepEqual(fresh.map(c=>c.key),["bar"],"only the bar is new — read by the convention (MIDNIGHT is a time)");
  // other sluglines of the same film follow the convention
  assert.equal(P(box,"INT. NEWSROOM - NIGHT").place,"NEWSROOM");assert.equal(P(box,"INT. BAR - MIDNIGHT").place,"BAR");
  // a card with no work on it does not hold the old reading
  const empty=[{...saved[1],architecture:""}];
  box.turnNoteSavedLocations(empty);
  assert.equal(P(box,"INT. NEWSROOM - PRE-DAWN").place,"NEWSROOM");
  // another film (its cards replace the list) reads by the convention
  box.turnNoteSavedLocations([]);
  assert.equal(P(box,"INT. NEWSROOM - PRE-DAWN").place,"NEWSROOM");
  box.turnNoteSavedLocations(null);assert.equal(P(box,"INT. NEWSROOM - PRE-DAWN").place,"NEWSROOM");
});

await test("what counts as work on a location card",()=>{
  const box=makeBox(),W=box.locationCardHasWork;
  const bare={id:"loc-a-0",key:"a",name:"A",intExt:"INT",times:["Night"],areas:["Bar"],scenes:["s1"],scope:"atomic",parentKey:"",continuityRootKey:"a",
    architecture:"",materials:"",lighting:"",permanentDressing:"",topology:"",continuityAnchors:"",anchorsLocked:true,significance:"",provenance:{},renderStyle:"",negativePrompt:"",variants:[],fromScript:true};
  assert.equal(W(bare),false,"what the screenplay alone derives is not work");
  assert.equal(W({...bare,episodeScenes:{e1:["s1"]},episodeLocationMeta:{e1:{}},orphan:true,sharedHeadParent:true}),false);
  for(const [k,v] of [["architecture","Brick."],["lighting","Sodium."],["variants",[{id:"v"}]],["provenance",{architecture:"script"}],["floorPlan",{rooms:[1]}],["cameras",[{id:"c"}]],["cloudSet",{job:"x"}],["img","u/f/a.png"],["locked",true]])
    assert.equal(W({...bare,[k]:v}),true,k);
  assert.equal(W({...bare,architecture:"   "}),false);assert.equal(W(null),false);assert.equal(W("x"),false);
  // the app tells the reader during render, from the film's own cards
  const app=read("app/app.jsx");
  assert.ok(app.includes('if(typeof window.turnNoteSavedLocations==="function") window.turnNoteSavedLocations(locations);'));
  assert.ok(app.indexOf("window.turnNoteSavedLocations(locations);")>app.indexOf("const [locations, setLocations] = React.useState("));
});

/* ---------------------------------------------------------------- 2. the Show's format */
await test("a Show has the format film convention gives it",()=>{
  const box=makeBox();
  const id=f=>box.turnShowFormatId({format:f});
  // serial by nature: keeps itself
  assert.equal(id("microdrama"),"microdrama");assert.equal(id("documentary"),"documentary");assert.equal(id("series"),"series");
  // a single work: becomes a TV Series
  for(const f of ["film","short","feature","commercial","musicvideo"]) assert.equal(id(f),"series",f);
  assert.equal(id(undefined),"series");assert.equal(id("not-a-format"),"series");
  // exactly the formats marked for it
  assert.deepEqual(Array.from(box.FORMATS.filter(f=>f.showKeeps).map(f=>f.id)).sort(),["documentary","microdrama"]);
  assert.deepEqual(Array.from(box.FORMATS.filter(f=>f.needsShow).map(f=>f.id)),["series"]);
  // only a TV Series film turns itself into a Show without being asked — a Micro-drama or a Documentary never does
  const app=read("app/app.jsx");
  assert.ok(app.includes("&&fmt&&fmt.needsShow&&row&&!row.isShared);"));assert.ok(!/fmt\.showKeeps/.test(app));
  assert.ok(app.includes('const seriesFormatId=(typeof window.turnShowFormatId==="function") ? window.turnShowFormatId(liveProject)'));
  assert.ok(app.includes("const episodeProject={...liveProject,format:seriesFormatId};"));
});

await test("the question says which case applies",()=>{
  const box=makeBox(),N=f=>box.turnShowFormatNote({format:f});
  assert.equal(N("microdrama"),"Its format stays Micro-drama: every episode of this Show is a Micro-drama episode (planned as about 2 minutes in 7 scenes).");
  assert.equal(N("documentary"),"Its format stays Documentary: every episode of this Show is a Documentary episode (planned as about 10 minutes in 12 scenes).");
  assert.equal(N("film"),"Its format also changes, from Short Film to TV Series: every episode of a Show is a TV Series episode (planned as about 30 minutes in 24 scenes). The scenes already written are kept as they are.");
  assert.equal(N("series"),"");
  for(const f of box.FORMATS) assert.equal(!!N(f.id),!f.needsShow,f.id);
});

await test("the database and the rest of the app take the Show's format as it is given",()=>{
  // the conversion sends the format it was handed; the database stores it and every episode inherits it
  const cloud=read("app/cloud.jsx"),sql=read("supabase/series-production.sql"),series=read("app/series.js");
  assert.ok(cloud.includes('const format=String((episodeProject&&episodeProject.format)||"series");'));
  assert.ok(cloud.includes('p_episode_id:episodeId,p_show_title:showTitle,p_bible:bible||{},p_format:format'));
  assert.ok(sql.includes("show_format := coalesce(nullif(btrim(p_format), ''), 'series');"));
  assert.ok(sql.includes("episode_project := episode_project || jsonb_build_object('format', show_format);"));
  assert.ok(series.includes('format:String(showDoc.format || (episodeDoc.project && episodeDoc.project.format) || "series")'));
  // nothing in the app behaves differently for the id "series" itself
  for(const f of ["app/app.jsx","app/newstory.jsx","app/agents.jsx","app/chrome.jsx","app/home.jsx"]){
    let src="";try{src=read(f);}catch(e){continue;}
    assert.ok(!/format\s*===?\s*"series"|"series"\s*===?\s*[a-zA-Z_.]*format/.test(src),f+" branches on the TV Series id");
  }
});

await test("Frances knows, and the page is on the new key",()=>{
  const ai=read("app/ai.jsx");
  for(const part of ["Sluglines: location and time of day (how a scene heading is read)","The time of day is never part of the location's name","A FILM KEEPS WHAT IT ALREADY HAS",
    "TURNING A FILM INTO A SHOW, AND ITS FORMAT","a Micro-drama turned into a Show stays a Micro-drama","a Documentary stays a Documentary","becomes a TV Series when it is turned into a Show"])
    assert.ok(ai.includes(part),part);
  assert.ok(!ai.includes("every episode of a Show is a TV Series episode, so 'Turn this into a show' on a Micro-drama"),"the sentence written this morning is corrected");
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","app.jsx","formats.jsx","locations.jsx"])
    assert.ok(["20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1", "20261127-place1", "20261127-note1", "20261127-angles5"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

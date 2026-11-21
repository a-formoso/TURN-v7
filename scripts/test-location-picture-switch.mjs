/* THE EARLIER LOCATION CARD, WITH THREE THINGS ADDED (owner 2026-11-21).
   The picture-first card (a row of looks, a Next box, four tabs) was published on 2026-11-21 and taken back the same
   day: "Let's go back to the old location card UI. I prefer the old location card design. I think it gave users a
   little bit more control ... Maybe the only thing I would keep is the selected element" (the Image / 3D set / Floor
   plan switch on the picture). So the card is the one before it, and:
     1. the picture's switch is kept: Image, 3D set, Floor plan, on the picture itself;
     2. a step that runs shows its progress (owner, the same day: "there was no progress bar or anything ... so they
        know this is in progress"): what is being done, a bar against the usual time, the clock, the engine's name;
     3. location writing runs on Fable 5.2 by default (owner, the same day: "I want this model to be default anytime
        we are about to draft or do anything location-wise"); a pick in the top bar still wins. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("app/locations-ui.jsx"), ai=read("app/ai.jsx"), css=read("app/styles.css"), html=read("TURN.html");
const dock=read("app/aiwriter.jsx"), app=read("app/app.jsx"), art=read("app/artroom.jsx");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };
const sheet=ui.slice(ui.indexOf("function LocationSheet("),ui.indexOf("function locationCardSteps("));

test("1 the card is the earlier one: numbered sections, the tracker and Prepare this place; no tabs, looks row or Next box", ()=>{
  for(const t of ['label:"1 \\u00b7 The Space"','label:"2 \\u00b7 Floor plan"','label:"3 \\u00b7 Cameras"','label:"4 \\u00b7 Previs"','"Draft specification"'])
    assert.ok(sheet.includes(t),"the card has "+t);
  assert.ok(ui.includes("function LocationStepGuide(")&&ui.includes('"Prepare this place"'));
  for(const t of ["LocationTabs","LocationTodoList","LocationLooks","LocationFlatRows",'"data-card-layout":"picture-first"',"loc-next-main"])
    assert.ok(!ui.includes(t),"the card has no "+t);
});

test("2 the picture's switch is kept: Image, 3D set, Floor plan, on the picture; the image stays on the page", ()=>{
  assert.ok(sheet.includes('const [mode,setMode]=React.useState("image");'));
  assert.ok(sheet.includes('[{id:"image",name:"Image",title:"The location image"}]')&&sheet.includes('{id:"set",name:"3D set",')&&sheet.includes('{id:"plan",name:"Floor plan",title:"The floor plan, from above"}'));
  const parts=['className:"loc-viewer","data-testid":"location-viewer","data-mode":modeNow}','className:"loc-viewer-bar"',
    'React.createElement(LocationSegment,{label:"What the picture shows",value:modeNow,options:viewModes,onChange:setMode})',
    'className:"loc-viewer-image",hidden:modeNow!=="image"}','React.createElement(SheetFrame,{ gen:genPlate, slotId:"locref-"+l.id,',
    'modeNow==="set"&&React.createElement(LocationSetPicture,{l})','modeNow==="plan"&&React.createElement(LocationPlanPicture,{l,spatialState})']
    .map(t=>{const i=sheet.indexOf(t);assert.ok(i>=0,"the card has "+t);return i;});
  parts.forEach((x,i)=>assert.ok(i===0||x>parts[i-1],"part "+i+" follows the one before it"));
  assert.ok(ui.includes("function LocationSegment({label,value,options,onChange}){")&&ui.includes('"aria-pressed":value===o.id?"true":"false"'));
  assert.ok(ui.includes("function LocationSetPicture({l}){")&&ui.includes("function LocationPlanPicture({l,spatialState}){"));
  // each of the two leads to the section that edits it
  assert.ok(ui.includes('"Open 2 · Floor plan"')&&ui.includes('"Open 4 · Previs"'));
  for(const t of [".loc-viewer{position:relative;",".loc-viewer-bar{position:absolute;left:20px;top:20px;z-index:6;",".loc-seg-btn.on{background:var(--txt-0);color:var(--bg-1)}",".loc-viewer-image[hidden]{display:none !important}"])
    assert.ok(css.includes(t),"styles have "+t);
});

test("3 progress: the clock and the bar run against the step's usual time and stop short of full", ()=>{
  const noop=()=>{};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useReducer:()=>[0,noop]};
  const box={React,console,Icon:{chevR:"chev"},SheetField:"SheetField"}; box.window=box; vm.createContext(box);
  vm.runInContext(transformSync(ui,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],
    babelrc:false,configFile:false,filename:"locations-ui.jsx"}).code,box);
  const st=(since,est,now)=>box.locationWorkState({since,est},now);
  assert.equal(st(1000,45,13000).clock,"0:12 of about 0:45");
  assert.equal(st(1000,45,13000).pct,27);
  assert.equal(st(1000,90,151000).clock,"Longer than usual · 2:30");
  assert.equal(st(1000,90,151000).pct,95);
  assert.equal(st(1000,90,1000).pct,4);
  assert.equal(st(0,45,5000).pct,null);
  assert.equal(st(1000,0,5000).pct,null);
  // the line itself: a bar, the clock and the engine's name
  const flat=n=>typeof n==="string"||typeof n==="number"?String(n):(n&&n.children||[]).map(flat).join("|");
  const line=box.LocationRunProgress({work:{text:"Writing the description",since:Date.now()-3000,est:45,engine:"Engine X"}});
  assert.equal(line.props["data-testid"],"location-work");
  assert.equal(line.children[0].props.role,"progressbar");
  assert.match(flat(line),/0:0[34] of about 0:45\|Engine X/);
  // the engine is named from the engine list, never by a literal
  box.writingModelInfo=task=>({label:task==="locations"?"The location engine":"Another"});
  assert.equal(box.locationWritingEngineLabel(),"The location engine");
  assert.ok(!/Fable|Opus/.test(ui.slice(ui.indexOf("function locationWritingEngineLabel("),ui.indexOf("function LocationRunProgress("))));
});

test("4 progress: where it shows (Prepare this place, the floor plan draft, the description's own button)", ()=>{
  assert.ok(ui.includes('const working=(text,est,by)=>_locPrepareSet(l.id,{text,since:Date.now(),est:est||0,engine:by||""});'));
  assert.ok(ui.includes('working("Writing the description\\u2026",45,locationWritingEngineLabel());'));
  assert.ok(ui.includes('working("Finding clear camera views\\u2026",0,"");'));
  assert.ok(ui.includes('75,dressEngine());')&&ui.includes('60,engine);'));
  assert.ok(ui.includes('const planDrafting=_locPlanDrafting[l.id]||0;'));
  assert.ok(ui.includes('work&&E("div",{className:"loc-prepare-work","data-testid":"location-prepare-work"},'));
  // the floor plan's editor says when it drafts, and stops saying so whatever happens
  assert.ok(ui.includes('_locPlanDraftingSet(owner.id,true);')&&ui.includes('finally{_locPlanDraftingSet(owner.id,false);if(alive.current)setBusy(false);}'));
  assert.ok(sheet.includes('drafting&&React.createElement(LocationRunProgress,{work:{text:"Writing the description",since:describeSince.current,est:45,engine:locationWritingEngineLabel()}}),'));
  for(const t of [".loc-work-bar > span{","@keyframes locWorkSlide",".loc-work-engine{","@media (prefers-reduced-motion: reduce){\n  .loc-work-bar > span{transition:none}"])
    assert.ok(css.includes(t),"styles have "+t);
});

test("5 location writing runs on Fable 5.2 by default; a pick wins; a trial stays on its lightest engine", ()=>{
  assert.ok(ai.includes('const WRITING_TASK_DEFAULTS = { story:"claude-opus-5-5", specs:"claude-opus-5-5", locations:"claude-fable-5-2" };'));
  const from=ai.indexOf("const WRITING_TASK_DEFAULTS"),to=ai.indexOf("window.TURN_FREE_TIER_WRITING_MODEL");
  const box={window:{}}; vm.createContext(box);
  vm.runInContext('const WRITING_MODELS=[{id:"claude-opus-5-5"},{id:"claude-fable-5-2"},{id:"gemini-3.8-flash"}];'+ai.slice(from,to)
    +';let _writingPick=null;function getWritingModelId(task){ if(_writingPick && WRITING_MODELS.find(m=>m.id===_writingPick)) return _writingPick; return recommendedWritingModelId(task); }'
    +';globalThis.rec=recommendedWritingModelId;globalThis.get=getWritingModelId;globalThis.pick=id=>{_writingPick=id;};',box);
  assert.equal(box.rec("locations"),"claude-fable-5-2");
  assert.equal(box.rec("specs"),"claude-opus-5-5");
  assert.equal(box.rec("story"),"claude-opus-5-5");
  box.pick("claude-opus-5-5"); assert.equal(box.get("locations"),"claude-opus-5-5"); box.pick(null);
  box.window.turnOnFreeTier=()=>true;
  assert.equal(box.rec("locations"),"gemini-3.8-flash");
  // every location writing function runs under the "locations" task; none is left under "specs"
  const list=ai.slice(ai.indexOf("const LOCATION_WRITING_FNS = ["),ai.indexOf("window.LOCATION_WRITING_FNS = LOCATION_WRITING_FNS;"));
  for(const n of ["aiDesignLocationBible","aiLocationVisuals","aiDraftStaging","aiReadLocationMovingParts","aiDraftLocationSpatialPlan","aiPlaceLocationRoom","aiLocationFamilies","aiReadPlateCameras"]){
    assert.ok(list.includes('"'+n+'"'),n+" runs as location work");
    assert.ok(ai.includes("window."+n+"=")||ai.includes("window."+n+" ="),n+" is on the window before it is wrapped");
  }
  assert.ok(list.includes('window.turnWithWritingTask("locations", ()=> fn(...a))'));
  const specs=ai.slice(ai.indexOf('["aiCastVisualBible","aiCharacterVisuals"'),ai.indexOf("const LOCATION_WRITING_FNS = ["));
  assert.ok(!/Location|aiDraftStaging/.test(specs.slice(0,specs.indexOf("// LOCATION WORK"))));
  // a read of images follows the task too, and a location call thinks as an Art Room one does
  assert.ok(ai.includes("const picked = forced || asked || WRITING_MODELS.find(x=>x.id===getWritingModelId(window.__writingTaskHint)) || WRITING_MODELS[0];"));
  assert.ok(ai.includes('(window.__writingTaskHint==="specs"||window.__writingTaskHint==="locations")) ? "medium" : undefined);'));
});

test("6 the top bar names the engine on the Locations tab; the pre-production window says it; Frances knows; keys are in", ()=>{
  assert.ok(app.includes('React.createElement(window.WritingDock, { task: room==="art" ? (artView==="locations" ? "locations" : "specs") : "story" })'));
  assert.ok(dock.includes('const locsOwn = !!recLocs && recLocs!==recSpecs;')&&dock.includes('(locsOwn?" · locations → "+labelOf(recLocs):"")'));
  assert.ok(art.includes('locLabel ? " (location work with "+locLabel+")" : "",'));
  const fact=ai.slice(ai.indexOf('name:"Location card: what the picture shows, progress while a step runs, and the engine for location work"'));
  assert.ok(fact.length>200);
  const what=fact.slice(0,fact.indexOf('" });'));
  for(const t of ["THE LOCATION CARD IS THE EARLIER ONE AGAIN","Image, 3D set and Floor plan choose what the picture shows","looking is free and nothing is made",
    "a bar that runs against the time the step usually takes","has a writing engine of its own by default","on the Locations tab the top bar names the engine in use"])
    assert.ok(what.includes(t),"Frances is told: "+t);
  // nothing in it names an engine or a vendor, or reads as billing
  assert.ok(!/Fable|Opus|Claude|Anthropic|Gemini|GPT|credit|price/i.test(what));
  for(const f of ["locations-ui.jsx","ai.jsx","styles.css","aiwriter.jsx","app.jsx","artroom.jsx"])
    assert.ok(["20261121-back1"].some(k=>html.includes(f+'?v='+k+'"')),f+" has the new key");
});

test("7 the film's images are asked for again when the first read failed (an empty picture on a slow connection)", ()=>{
  assert.ok(ui.includes("function useLocationImagesCheck(){"));
  const hook=ui.slice(ui.indexOf("function useLocationImagesCheck(){"),ui.indexOf("function LocationSheets("));
  assert.ok(hook.includes("if(live&&tries<4) timer=setTimeout(ask,8000);")&&hook.includes("if(!(r&&r.ok)) again();"));
  assert.match(ui,/function LocationSheets\(\{[^\n]*\n  useLocationImagesCheck\(\);\n/);
  // run: a read that fails twice is asked for three times, then no more (promises that answer at once, so it runs here)
  const syncP=v=>({then:ok=>{const r=ok(v);return r&&typeof r.then==="function"?r:syncP(r);}});
  const timers=[];let calls=0,cleanup=null;
  const box={window:{nbPrefetchAll:()=>{calls++;return syncP({ok:calls>=3});}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    React:{useEffect:fn=>{cleanup=fn();}},Promise:{resolve:v=>syncP(v)}};
  vm.createContext(box);vm.runInContext(hook+";useLocationImagesCheck();",box);
  assert.equal(calls,1);assert.equal(timers.length,1);
  for(let i=0;i<6&&timers.length;i++) timers.shift()();
  assert.equal(calls,3,"asked again until the read answered");
  assert.equal(timers.length,0);
  assert.equal(typeof cleanup,"function");
  // a read that never answers is asked for four times in all
  const t2=[];let n2=0;
  const box2={window:{nbPrefetchAll:()=>{n2++;return syncP({ok:false});}},setTimeout:fn=>{t2.push(fn);return t2.length;},clearTimeout:()=>{},
    React:{useEffect:fn=>{fn();}},Promise:{resolve:v=>syncP(v)}};
  vm.createContext(box2);vm.runInContext(hook+";useLocationImagesCheck();",box2);
  for(let i=0;i<10&&t2.length;i++) t2.shift()();
  assert.equal(n2,4);
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

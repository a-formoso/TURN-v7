/* THE EARLIER LOCATION CARD, WITH THREE THINGS ADDED (owner 2026-11-21).
   The picture-first card (a row of looks, a Next box, four tabs) was published on 2026-11-21 and taken back the same
   day: "Let's go back to the old location card UI. I prefer the old location card design. I think it gave users a
   little bit more control ... Maybe the only thing I would keep is the selected element" (the Image / 3D set / Floor
   plan switch on the picture). So the card is the one before it (since the same day in FIVE SECTIONS WITH NO NUMBERS,
   owner: "build the 5 sections, no numbers": The place, Floor plan, The set in 3D, Variants, Advanced), and:
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

/* the file itself, run with a stand-in React */
const loadUi=()=>{
  const noop=()=>{};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useReducer:()=>[0,noop]};
  const box={React,console,Icon:{chevR:"chev"},SheetField:"SheetField"}; box.window=box; vm.createContext(box);
  vm.runInContext(transformSync(ui,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],
    babelrc:false,configFile:false,filename:"locations-ui.jsx"}).code,box);
  return box;
};

/* FIVE SECTIONS, NO NUMBERS (owner 2026-11-21: "build the 5 sections, no numbers"; the card had eight numbered ones).
   Like a character or a prop card: what the thing is, the working sections, then Advanced, closed. A place that has
   rooms has one more, Rooms (its rooms open inside it). */
test("1 the card has five sections with no numbers (and Rooms on a place with rooms); the tracker has four steps; no tabs, looks row or Next box", ()=>{
  const order=['React.createElement(CardFold,{label:"The place",foldId:locationStepFoldId(l,1),','React.createElement(CardFold,{label:"Floor plan",foldId:layoutFoldId,',
    'React.createElement(CardGroup,{label:"The set in 3D",foldIds:[locationStepFoldId(l,3),locationStepFoldId(l,4)],',
    'React.createElement(CardFold,{label:"Cameras",foldId:locationStepFoldId(l,3)},','showPrevis&&React.createElement(CardFold,{label:"Previs",foldId:locationStepFoldId(l,4),',
    'React.createElement(CardFold,{label:"Variants",foldId:"loc-units-"+l.id,',
    'showSubspaces&&React.createElement(CardFold,{label:hasRooms?"Rooms":"Extra spaces",foldId:"loc-subspaces-"+l.id,',
    'React.createElement(CardGroup,{label:"Advanced",foldIds:["loc-image-"+l.id]},','React.createElement(CardFold,{label:"Look & exclusions",defaultOpen:false},',
    'React.createElement(CardFold,{label:"Quick image & image check",foldId:"loc-image-"+l.id,defaultOpen:false},',
    'React.createElement(CardFold,{label:"Generation prompt",defaultOpen:false},']
    .map(t=>{const i=sheet.indexOf(t);assert.ok(i>=0,"the card has "+t);return i;});
  order.forEach((x,i)=>assert.ok(i===0||x>order[i-1],"section "+i+" follows the one before it"));
  // those are all of them: nine sections or parts in two groups, and none carries a number
  const labels=sheet.match(/Card(?:Fold|Group),\{label:[^,]+/g)||[];
  assert.equal(labels.length,11);
  for(const x of labels) assert.ok(!/\d \\u00b7|\d ·|sectionNo/.test(x),"no number on "+x);
  for(const gone of ["sectionNo","locationSectionNumbers","imageN"]) assert.ok(!ui.includes(gone),"gone: "+gone);
  // the two groups: the set opens for a link to its cameras or its Previs, Advanced for a link to the quick image
  assert.ok(sheet.includes('defaultOpen:initialSection==="previs"||initialSection==="build"||initialSection==="style"},\n      React.createElement(CardFold,{label:"Cameras",'));
  // Rooms keeps its place on the page as before: open when the place has rooms
  assert.ok(sheet.includes('count:hasRooms?roomLocations.length:undefined,defaultOpen:hasRooms},'));
  assert.ok(sheet.includes('"Draft specification"'));
  assert.ok(ui.includes("function LocationStepGuide(")&&ui.includes('"Prepare this place"'));
  for(const t of ["LocationTabs","LocationTodoList","LocationLooks","LocationFlatRows",'"data-card-layout":"picture-first"',"loc-next-main"])
    assert.ok(!ui.includes(t),"the card has no "+t);
  // THE TRACKER: four steps from the card's five (the cameras and Previs are one step)
  const box=loadUi();
  const five=(d1,d2,d3,d4,d5,goTo)=>[{n:1,done:d1,todo:"a"},{n:2,done:d2,todo:"b"},{n:3,done:d3,todo:"The Wide camera: it stands in a wall"},
    {n:4,key:"previs",optional:true,done:d4,todo:"p"},{n:5,key:"image",done:d5,todo:"i",goTo:goTo||0}];
  const names=x=>Array.from(x,s=>s.name),nextOf=x=>(Array.from(x).find(s=>s.next)||{}).key||"";
  let g=box.locationGuideSteps(five(false,false,false,false,false));
  assert.deepEqual(names(g),["The place","Floor plan","The set in 3D","Location image"]);
  assert.deepEqual(Array.from(g,s=>s.n),[1,2,3,4]);
  assert.equal(nextOf(g),"place");
  assert.equal(g[2].to,3);assert.equal(g[2].todo,"The Wide camera: it stands in a wall");
  assert.equal(g[3].to,5);
  // the cameras usable, the set not dressed: the set is not done yet, it is the next step, and a press opens Previs
  g=box.locationGuideSteps(five(true,true,true,false,false,4));
  assert.equal(g[2].done,false);assert.equal(g[2].to,4);assert.equal(nextOf(g),"set");
  assert.match(g[2].todo,/^Dress the set in Previs/);
  assert.equal(g[3].to,4,"the image is made in Previs when the set is ready");
  // dressed: the set is done, the image is next
  g=box.locationGuideSteps(five(true,true,true,true,false,4));
  assert.equal(g[2].done,true);assert.equal(nextOf(g),"image");
  // dressed but a camera stands badly: not done, and a press opens Cameras
  g=box.locationGuideSteps(five(true,true,false,true,false));
  assert.equal(g[2].done,false);assert.equal(g[2].to,3);
  // everything done: nothing is next
  g=box.locationGuideSteps(five(true,true,true,true,true));
  assert.equal(nextOf(g),"");
  // a card with no Previs step: the cameras alone decide
  g=box.locationGuideSteps([{n:1,done:true},{n:2,done:true},{n:3,done:true},{n:5,key:"image",done:false}]);
  assert.equal(g[2].done,true);assert.equal(g[2].to,3);assert.equal(nextOf(g),"image");
  // the guide draws those four, and a press opens the step's own section
  const guide=ui.slice(ui.indexOf("function LocationStepGuide("),ui.indexOf("/* Camera-relative composition"));
  assert.ok(guide.includes("function LocationStepGuide({l,steps:cardSteps}){\n  const steps=locationGuideSteps(cardSteps);"));
  assert.ok(guide.includes("const st=steps.find(x=>x.n===n)||{},to=st.to||n;"));
  assert.ok(ui.includes('{n:1,name:"The place",done:!!drafted,'));
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
  assert.ok(ui.includes('"Open Floor plan"')&&ui.includes('"Open Previs"'));
  for(const t of [".loc-viewer{position:relative;",".loc-viewer-bar{position:absolute;left:20px;top:20px;z-index:6;",".loc-seg-btn.on{background:var(--txt-0);color:var(--bg-1)}",".loc-viewer-image[hidden]{display:none !important}"])
    assert.ok(css.includes(t),"styles have "+t);
});

test("3 progress: the clock and the bar run against the step's usual time and stop short of full", ()=>{
  const box=loadUi();
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
  // a floor plan draft's usual time grows with the rooms the place holds (a real draft of 8 rooms took about 5 minutes)
  box.locationSpatialOwner=l=>({id:l.parent||l.id});
  box.turnContinuity={locations:[{id:"p"},{id:"r1",parent:"p"},{id:"r2",parent:"p"},{id:"other"}]};
  assert.equal(box.locationPlanDraftEstimate("p"),150);
  assert.equal(box.locationPlanDraftEstimate("other"),90);
  assert.equal(box.locationPlanDraftWork("p"),null);
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
  assert.ok(ui.includes(':planDrafting?locationPlanDraftWork(l.id):null;'));
  // beside the editor's own button too, and the Prepare box says it once while the plan is drafted
  assert.ok(ui.includes('busy&&!placing&&locationPlanDraftWork(owner.id)?React.createElement(LocationRunProgress,{work:locationPlanDraftWork(owner.id)}):null,'));
  assert.ok(ui.includes('line&&!planDrafting&&E("p",{className:"loc-layer-note","data-testid":"location-prepare-next"},line),'));
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
  const fact=ai.slice(ai.indexOf('name:"Location card: its five sections, what the picture shows, progress while a step runs, and the engine for location work"'));
  assert.ok(fact.length>200);
  const what=fact.slice(0,fact.indexOf('" });'));
  for(const t of ["This entry is the newest word on how a location card is laid out","THE CARD HAS FIVE SECTIONS, WITH NO NUMBERS, like a character or a prop card",
    "THE SET IN 3D, which holds two parts: Cameras (the four cameras) and Previs","ADVANCED, closed until you open it, which holds Look & exclusions",
    "Quick image & image check (the quick image from the description alone, Edit one view, and the check of the image against the description; it was the Location image section)",
    "A place that has rooms has one more section, ROOMS, between Variants and Advanced (it was called Subspaces)",
    "THE TRACKER under the name has four steps: The place, Floor plan, The set in 3D (done when the four cameras are usable and the set is dressed) and Location image",
    "that design was taken back the same day, so there are no such tabs","Image, 3D set and Floor plan choose what the picture shows",
    "the same line stands beside Draft floor plan while the floor plan is being drafted (a place with many rooms takes several minutes)","looking is free and nothing is made",
    "a bar that runs against the time the step usually takes","has a writing engine of its own by default","on the Locations tab the top bar names the engine in use"])
    assert.ok(what.includes(t),"Frances is told: "+t);
  // nothing in it names an engine or a vendor, or reads as billing
  assert.ok(!/Fable|Opus|Claude|Anthropic|Gemini|GPT|credit|price/i.test(what));
  for(const f of ["locations-ui.jsx","ai.jsx","styles.css","aiwriter.jsx","app.jsx","artroom.jsx"])
    assert.ok(["20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2"].some(k=>html.includes(f+'?v='+k+'"')),f+" has the new key");
  // the five sections changed the card and what Frances is told: both carry the newest key
  for(const f of ["locations-ui.jsx","ai.jsx"]) assert.ok(["20261121-five1", "20261121-five2"].some(k=>html.includes(f+'?v='+k+'"')),f+" has the five-sections key");
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

test("8 In this card is one line that pans; a location's menus, typed fields and map tools are the character card's sizes", ()=>{
  // owner 2026-11-21: "Make elements in this section scrollable. User should be able to pan right or left ... all on the same line"
  assert.ok(ui.includes("function LocationChipScroller({children}){"));
  assert.ok(ui.includes('      E(LocationChipScroller,null,\n        E("span",{className:"loc-space-chip on",title:"The whole place: this card"},root.name),'));
  const sc=ui.slice(ui.indexOf("function LocationChipScroller("),ui.indexOf("function LocationWorkspace("));
  assert.ok(sc.includes('if(!el||e.pointerType==="touch"||(e.button!==undefined&&e.button!==0)) return;'),"a touch scrolls by itself; only the main mouse button drags");
  assert.ok(sc.includes('if(Math.abs(dx)>4){ d.moved=true;')&&sc.includes('if(st.current.moved){ e.stopPropagation(); e.preventDefault(); st.current.moved=false; }'),"a drag that moved is not a press");
  assert.ok(sc.includes('className:"loc-space-chips"+edges,"data-testid":"location-space-chips"'));
  for(const t of [".loc-space-chips{flex-wrap:nowrap;align-items:center;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;",".loc-space-chips > .loc-space-chip{flex:0 0 auto;white-space:nowrap}",
    ".loc-space-chips.fade-r{",".loc-space-chips.fade-l.fade-r{"]) assert.ok(css.includes(t),"styles have "+t);
  // run: the side with more to see fades, and a drag scrolls and swallows the press that ends it
  const noop=()=>{};let effects=[],edges="",setEdges=v=>{edges=typeof v==="function"?v(edges):v;};
  const el={scrollLeft:0,clientWidth:200,scrollWidth:500,classList:{add:noop,remove:noop},addEventListener:noop,removeEventListener:noop};
  const handlers={};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useRef:(()=>{let n=0;const refs=[{current:el},{current:{down:false,x:0,left:0,moved:false}}];return ()=>refs[n++%2];})(),
    useState:()=>[edges,setEdges],useEffect:fn=>{effects.push(fn);}};
  const later=[];
  const box={React,console,window:{addEventListener:(n,h)=>{handlers[n]=h;},removeEventListener:noop},ResizeObserver:undefined,Math,setTimeout:fn=>{later.push(fn);return later.length;}};
  vm.createContext(box);vm.runInContext(sc+";globalThis.out=LocationChipScroller({children:[]});",box);
  effects.forEach(fn=>fn());
  assert.equal(edges," fade-r","more rooms to the right");
  const out=box.out;
  out.props.onPointerDown({pointerType:"mouse",button:0,clientX:150});
  handlers.pointermove({clientX:90});
  assert.equal(el.scrollLeft,60,"the row follows the drag");
  let stopped=false;out.props.onClickCapture({stopPropagation:()=>{stopped=true;},preventDefault:noop});
  assert.ok(stopped,"the press that ends a drag is not a press on a room");
  stopped=false;handlers.pointerup();out.props.onClickCapture({stopPropagation:()=>{stopped=true;},preventDefault:noop});
  assert.ok(!stopped,"a plain press still opens the room");
  // a drag let go outside the row (its press goes elsewhere) is forgotten, so the next press on a room is a press
  out.props.onPointerDown({pointerType:"mouse",button:0,clientX:150});handlers.pointermove({clientX:100});handlers.pointerup();
  later.splice(0).forEach(fn=>fn());
  stopped=false;out.props.onClickCapture({stopPropagation:()=>{stopped=true;},preventDefault:noop});
  assert.ok(!stopped,"the press after a drag that ended outside the row is not swallowed");
  // a touch is left to the browser's own scrolling
  el.scrollLeft=0;out.props.onPointerDown({pointerType:"touch",clientX:150});handlers.pointermove({clientX:50});
  assert.equal(el.scrollLeft,0);
  // sizes: a menu or a typed field 28px at 12.5px, the map's tools 28px, on a desktop only
  const sizes=css.slice(css.indexOf("THE LOCATION CARD'S CONTROLS AT THE CHARACTER CARD'S SIZES"));
  assert.ok(sizes.includes("@media (min-width:641px){")&&sizes.includes("[data-location-card] .sheet-fold-body :is(select.prop-select,input.prop-select){height:28px;min-height:28px;padding-top:0;padding-bottom:0;font-size:12.5px}"));
  assert.ok(sizes.includes(".loc-map-zbtn{min-width:28px;min-height:28px;")&&sizes.includes(".loc-map-segbtn{min-height:28px}")&&sizes.includes(".loc-map-chip{min-height:28px;"));
  assert.ok(css.includes(".char-pronoun-sel{height:28px;")&&/\.char-pronoun-sel\{[^}]*font-size:12\.5px/.test(css),"the character card's own menu is the measure");
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

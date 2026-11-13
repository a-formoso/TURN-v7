/* THE LOCATION CARD AS A TREE (owner 2026-11-13, "go ahead with all of it").
   The card shows what is stored in the owner's own structure:

     LOCATION                      the place: 1 · The Space, Narrative Significance, Look Dev, Screenplay Coverage
     ├─ Space and staging          2 · Floor plan, 3 · Cameras, 4 · Build the set, 5 · Style it, Moving parts
     ├─ VARIANTS                   each time of day or state, its image, and "Used in" (each scene's dressing & blocking)
     ├─ SUBSPACES                  a main location's rooms (their variants and scenes) and its extra spaces
     └─ Generation Prompt          read-only, with the QA check

   Only where things are SHOWN changed. Nothing stored was renamed or moved, so the Blender package and the cloud set
   build read what they read before (pinned at the end). */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ui=read("app/locations-ui.jsx"), ai=read("app/ai.jsx"), css=read("app/styles.css"), html=read("TURN.html");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };

/* the file itself, run with a stand-in React (as test-cloud-set-controls does) */
const noop=()=>{};
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop};
const box={React,console,Icon:{chevR:"chev"},SheetField:"SheetField",events:[]}; box.window=box; vm.createContext(box);
vm.runInContext(transformSync(ui,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],
  babelrc:false,configFile:false,filename:"locations-ui.jsx"}).code,box);
const nodes=tree=>{const out=[];const walk=n=>{if(n&&typeof n==="object"){out.push(n);(n.children||[]).forEach(walk);}};walk(tree);return out;};
const text=n=>typeof n==="string"||typeof n==="number"?String(n):(n&&n.children||[]).map(text).join("");
const sheet=ui.slice(ui.indexOf("function LocationSheet("),ui.indexOf("function useLocationCloudJob("));
const at=t=>{ const i=sheet.indexOf(t); assert.ok(i>=0,"the card has "+t); return i; };

test("1 the card's sections, in the tree's order", ()=>{
  const order=['title:placeGroup.title','label:"1 \\u00b7 The Space"','label:"Narrative Significance"','label:"Look Dev"','label:"Screenplay Coverage"',
    'title:"Space and staging"','label:"2 \\u00b7 Floor plan"','label:"3 \\u00b7 Cameras"','label:"4 \\u00b7 Build the set"','label:"5 \\u00b7 Style it"',
    'label:"Moving parts"','label:"Variants"','label:"Subspaces"','label:"Generation Prompt"'].map(at);
  order.forEach((x,i)=>assert.ok(i===0||x>order[i-1],"section "+i+" follows the one before it"));
  // gone: the flat list, the two nested lists, and More
  for(const t of ['label:"More"','label:"Rooms & times"','label:"1 \\u00b7 Describe the place"','label:"Screenplay evidence"','label:"Look & exclusions"',
      '"Additional environment states"','"Scene dressing & blocking"','"Add environment state"'])
    assert.ok(!sheet.includes(t),"no "+t);
  // the step guide and the build's "Go to" buttons use the same name for step 1
  assert.ok(ui.includes('{n:1,name:"The Space",done:!!drafted,'));
  assert.ok(read("app/blender-render-ui.jsx").includes('const LOCATION_STEP_NAMES={1:"The Space",2:"Floor plan",3:"Cameras",4:"Build the set",5:"Style it"};'));
});

test("2 the place's group says whose description it is, in plain words", ()=>{
  const src=sheet.slice(sheet.indexOf("const placeGroup="),sheet.indexOf("const promptBuiltFrom="));
  const groupOf=(l,hasRooms)=>vm.runInNewContext(src+";({placeGroup,stagingNote})",{l,hasRooms});
  const room=groupOf({name:"Kitchen",parentLocation:{name:"House"}},false);
  assert.equal(room.placeGroup.title,"This room");
  assert.equal(room.placeGroup.note,"uses House's unless you fill in its own");
  assert.equal(room.stagingNote,"this room's own floor plan, cameras and set");
  const house=groupOf({name:"House"},true);
  assert.deepEqual([house.placeGroup.title,house.placeGroup.note],["The whole place","shared by every room"]);
  assert.equal(house.stagingNote,"the whole place's floor plan and cameras; each room has its own");
  const single=groupOf({name:"Newsroom"},false);
  assert.deepEqual([single.placeGroup.title,single.placeGroup.note,single.stagingNote],["The place","",""]);
  // the two lines a room's card carries
  assert.ok(sheet.includes('" \\u00b7 uses its space and look unless filled in here"'));
  assert.ok(sheet.includes("\"'s architecture, materials, scale, connections and locked landmarks. Fill in below only what is different here.\""));
  const head=box.LocationGroupHead({title:"The place",note:""});
  assert.equal(text(head),"The place"); assert.equal(nodes(head).filter(n=>n.type==="span").length,1,"no empty note");
});

test("3 Used in: every scene with its time, in story order", ()=>{
  assert.equal(box.locationSceneTag(2,"Pre-dawn"),"Sc 02 (Pre-dawn)");
  assert.equal(box.locationSceneTag(14,""),"Sc 14");
  assert.equal(box.locationSceneTag(null,"Night"),"Sc ? (Night)");
  const units=[{key:"k|INT|dawn",time:"Dawn",sceneNos:[6]},{key:"k|INT|night",time:"Night",sceneNos:[3,9]},
    {key:"k|INT|gone",time:"Dusk",sceneNos:[1],orphan:true},{key:"k|INT|untimed",time:"",sceneNos:[12]}];
  assert.equal(box.locationUsedInText(units),"Sc 03 (Night), Sc 06 (Dawn), Sc 09 (Night), Sc 12");
  assert.equal(box.locationUsedInText([]),"");
  // one scene, two times (INT. KITCHEN - NIGHT, later INT. KITCHEN - DAWN in the same scene): both are said
  assert.equal(box.locationUsedInText([{time:"Night",sceneNos:[4]},{time:"Dawn",sceneNos:[4]}]),"Sc 04 (Night), Sc 04 (Dawn)");
});

test("4 a variant's name is its time; the side comes first only when the space is seen from both", ()=>{
  assert.deepEqual(Array.from(box.locationVariantNames([{time:"Night",intExt:"INT"},{time:"Pre-dawn",intExt:"INT"},{time:"Night",intExt:"INT"}],[])),["Night","Pre-dawn"]);
  assert.deepEqual(Array.from(box.locationVariantNames([{time:"Night",intExt:"INT"},{time:"Night",intExt:"EXT"}],[])),["INT · Night","EXT · Night"]);
  assert.deepEqual(Array.from(box.locationVariantNames([{time:"",intExt:"INT"}],[{id:"v1",time:"Storm"}])),["No time stated","Storm"]);
  assert.deepEqual(Array.from(box.locationVariantNames([{time:"Dusk",orphan:true}],[])),[],"a room & time no longer in the script is not counted");
});

test("5 Variants: each room & time with its scenes under it; a look of your own is a variant too", ()=>{
  const fold=sheet.slice(at('label:"Variants"'),at('label:"Subspaces"'));
  // the same fold id the Shots tab opens (a shot's missing view), and the same openers
  assert.ok(fold.includes('foldId:"loc-units-"+l.id,count:variantCount||undefined,'));
  assert.ok(fold.includes('defaultOpen:initialSection==="units"||initialSection==="environments"'));
  const unit=fold.indexOf("React.createElement(SluglineUnitCard,"), used=fold.indexOf("React.createElement(LocationVariantUsedIn,");
  const extra=fold.indexOf("environment.additional.map(v=>React.createElement(LocationVariant,"), add=fold.indexOf('"Add a variant"');
  assert.ok(unit>0&&used>unit&&extra>used&&add>extra,"room & time, its Used in, then your own variants, then Add a variant");
  assert.ok(fold.includes("setups:sceneSetups.filter(s=>s.unitKey===u.key),onUpdateSetup:updateSceneSetup"),"each variant gets its own scenes' notes");
  assert.ok(fold.includes('"data-location-variant":u.key'));
  assert.ok(sheet.includes("const variantCount=units.filter(u=>!u.orphan).length+environment.additional.length;"));
  // what a variant is, in one line; and where its rooms' variants are when the place itself has none
  assert.ok(fold.includes("a variant uses the description above and changes only its light and environment. Each has its own image."));
  assert.ok(fold.includes("Its rooms' variants are under Subspaces."));
  // the wording that went with the old name
  assert.ok(ui.includes('title:"Remove this variant?",')&&ui.includes('|| "New variant";')&&!ui.includes("Remove this environment state?"));
  assert.ok(ui.includes("a scene's dressing and blocking go under Used in, below."));
});

test("6 Used in, on the page: a scene opens its dressing & blocking; saving goes to that scene's notes", ()=>{
  const saved=[];
  const setups=[{id:"u|s3|0",unitKey:"u",sceneNo:3,time:"Night",occurrenceCount:1,occurrenceOrdinal:1,blocking:"Marcus crosses to the table"},
    {id:"u|s9|0",unitKey:"u",sceneNo:9,time:"Night",occurrenceCount:2,occurrenceOrdinal:1},
    {id:"u|s9|1",unitKey:"u",sceneNo:9,time:"Night",occurrenceCount:2,occurrenceOrdinal:2},
    {id:"old",unitKey:"u",sceneNo:5,time:"Night",orphan:true,notes:"kept"}];
  const tree=box.LocationVariantUsedIn({unit:{key:"u",time:"Night",sceneNos:[3,9]},setups,onUpdateSetup:(s,patch)=>saved.push([s.id,patch])});
  assert.equal(tree.props["data-testid"],"variant-used-in");
  const rows=nodes(tree).filter(n=>n.type==="details");
  assert.deepEqual(rows.map(r=>text(nodes(r).find(n=>n.type==="summary"))),[
    "Sc 03 (Night) · dressing & blocking noted","Sc 09 (Night) · visit 1 of 2 · dressing & blocking",
    "Sc 09 (Night) · visit 2 of 2 · dressing & blocking","Saved notes · scene removed · dressing & blocking noted"]);
  const card=nodes(rows[1]).find(n=>n.type===box.SceneSetupCard);
  assert.equal(card.props.setup.id,"u|s9|0"); card.props.onUpdate({blocking:"x"});
  // the row already names the scene, the room and the time: the notes under it don't repeat them
  assert.equal(card.props.nested,true);
  const setup={id:"s",sceneNo:9,spaceName:"Kitchen",time:"Night",occurrenceCount:2,occurrenceOrdinal:1,sourceKind:"slugline"};
  const headOf=nested=>text(nodes(box.SceneSetupCard({setup,unit:{key:"u"},onUpdate:noop,nested})).find(n=>n.props&&n.props.className==="loc-coverage-title"));
  assert.equal(headOf(false),"Scene 09KitchenNightOccurrence 1 of 2"); assert.equal(headOf(true),"");
  assert.deepEqual(saved,[["u|s9|0",{blocking:"x"}]]);
  // a variant whose scenes have no saved occurrence yet still says where it is used; one with no scene shows nothing
  assert.equal(text(box.LocationVariantUsedIn({unit:{key:"u",time:"Dawn",sceneNos:[6]},setups:[]})),"Used inSc 06 (Dawn)");
  assert.equal(box.LocationVariantUsedIn({unit:{key:"u",time:"Dawn",sceneNos:[]},setups:[]}),null);
  assert.ok(ui.includes("Shot timing, cuts and performance are directed in Shots / Blender previz."));
});

test("7 Subspaces: each room with its variants and scenes; a row opens the room, its plan, its variants or its build", ()=>{
  const went=[];
  const rooms=[{id:"kit",key:"house-kitchen",name:"Kitchen",variants:[{id:"v1",time:"Storm",state:"rain on the window"}]},
    {id:"liv",key:"house-living-room",name:"Living Room"},{id:"att",key:"house-attic",name:"Attic"}];
  const units=[{key:"a",subspaceKey:"house-kitchen",time:"Night",intExt:"INT",sceneNos:[3]},
    {key:"b",subspaceKey:"house-kitchen",time:"Dawn",intExt:"INT",sceneNos:[6]},
    {key:"c",locationKey:"house-living-room",time:"Dawn",intExt:"INT",sceneNos:[6]},
    {key:"d",subspaceKey:"house-kitchen",time:"Dusk",intExt:"INT",sceneNos:[1],orphan:true}];
  const tree=box.LocationSubspaceList({rooms,units,onSelectLocation:(id,section)=>went.push([id,section]),canBuild:true});
  const rows=nodes(tree).filter(n=>n.props&&n.props["data-location-subspace"]);
  assert.deepEqual(rows.map(r=>r.props["data-location-subspace"]),["kit","liv","att"]);
  const lines=r=>nodes(r).filter(n=>n.type==="small").map(text);
  assert.deepEqual(lines(rows[0]),["Variants: Night, Dawn, Storm","Used in: Sc 03 (Night), Sc 06 (Dawn)"]);
  assert.deepEqual(lines(rows[1]),["Variants: Dawn","Used in: Sc 06 (Dawn)"]);
  assert.deepEqual(lines(rows[2]),["Variants: none yet","Used in: no scene yet"]);
  const buttons=nodes(rows[0]).filter(n=>n.type==="button");
  assert.deepEqual(buttons.map(b=>text(b).replace(/Variants:.*/,"")),["Kitchen","Floor plan","Variants","Build the set"]);
  buttons.forEach(b=>b.props.onClick());
  assert.deepEqual(went,[["kit",""],["kit","layout"],["kit","units"],["kit","build"]]);
  // no build link where the build isn't on
  const off=box.LocationSubspaceList({rooms:[rooms[1]],units,onSelectLocation:noop,canBuild:false});
  assert.deepEqual(nodes(off).filter(n=>n.type==="button").map(b=>text(b).replace(/Variants:.*/,"")),["Living Room","Floor plan","Variants"]);
  // on the card: a main location only, open when it has rooms, with its extra spaces in the same section
  const fold=sheet.slice(at('label:"Subspaces"'),at('label:"Generation Prompt"'));
  assert.ok(sheet.includes('!l.parentLocation&&(hasRooms||coverageSheets.length>0)&&React.createElement(CardFold,{label:"Subspaces",foldId:"loc-subspaces-"+l.id,'));
  assert.ok(fold.includes("count:hasRooms?roomLocations.length:undefined,defaultOpen:hasRooms}"));
  assert.ok(fold.includes("React.createElement(LocationSubspaceList,{rooms:roomLocations,units:sluglineUnits,onSelectLocation,canBuild:cloudPilot})"));
  assert.ok(fold.indexOf('"Extra spaces"')>fold.indexOf("LocationSubspaceList")&&fold.includes("React.createElement(LocationCoverageSheet,"));
  assert.ok(fold.includes("'s space and look unless you fill in its own."));
});

test("8 Build the set and Style it show where a set can be built; Blender has one home on every card", ()=>{
  assert.ok(sheet.includes("const buildHere=cloudPilot&&(ownRoom||!hasRooms);"));
  const can=(cloudPilot,ownRoom,hasRooms)=>cloudPilot&&(ownRoom||!hasRooms);
  assert.equal(can(true,true,false),true,"a room with its footprint");
  assert.equal(can(true,false,false),true,"an unfinished place with no rooms keeps the steps, with what to do first");
  assert.equal(can(true,true,true),true,"a place with rooms AND a footprint of its own");
  assert.equal(can(true,false,true),false,"a place whose rooms are built one by one: its rooms carry the steps");
  assert.equal(can(false,true,false),false,"the build switched off");
  // the step guide lists the steps the card shows
  assert.ok(sheet.includes("const cardSteps=locationCardSteps({l,drafted,spatialState,gen,cloudPilot:buildHere,cloudJob});"));
  const steps=on=>box.locationCardSteps({l:{id:"x"},drafted:true,spatialState:{ready:false,reason:"r"},gen:{},cloudPilot:on,cloudJob:null}).map(s=>s.n);
  assert.deepEqual(Array.from(steps(true)),[1,2,3,4,5,6]); assert.deepEqual(Array.from(steps(false)),[1,2,3,6]);
  for(const n of [4,5]) assert.ok(new RegExp('buildHere&&React\\.createElement\\(CardFold,\\{label:"'+n+' \\\\u00b7 ').test(sheet),"step "+n+" follows buildHere");
  // the handoff: inside step 4, or a small section of its own; the QA check with the prompt
  assert.equal((sheet.match(/\bstudioHandoff\b/g)||[]).length,3);
  assert.ok(sheet.includes('!buildHere&&window.BlenderStudioLaunch&&React.createElement(CardFold,{label:"Blender Studio",foldId:"loc-blender-"+l.id,defaultOpen:false},\n        studioHandoff),'));
  assert.ok(sheet.includes('React.createElement("h4",{className:"loc-step-sub"},"Or in your own Blender"),\n        studioHandoff),'));
  const prompt=sheet.slice(at('label:"Generation Prompt"'));
  assert.ok(prompt.includes("window.QaCheckButton")&&prompt.includes('"data-testid":"loc-prompt-built-from"'));
  const built=l=>vm.runInNewContext(sheet.slice(sheet.indexOf("const promptBuiltFrom="),sheet.indexOf("// the time of day beside each scene"))+";promptBuiltFrom",{l});
  assert.equal(built({name:"Kitchen",parentLocation:{name:"House"}}),
    "Built from House (shared) and Kitchen (its own). Each variant adds its light and environment for its own image; each shot adds its camera in Shots.");
  assert.equal(built({name:"Newsroom"}),
    "Built from Newsroom. Each variant adds its light and environment for its own image; each shot adds its camera in Shots.");
});

test("9 nothing stored moved: the same records, ids and fields, and the same Blender package", ()=>{
  // the card still reads and writes the fields it did (a rename here would orphan saved work)
  for(const t of ['field:"architecture"','field:"materials"','field:"lighting"','field:"permanentDressing"','field:"topology"','field:"keySizes"',
      'onUpdate(l.id,{continuityAnchors:val})','onUpdate(l.id,{significance:val})','onUpdate(l.id,{negativePrompt:val})',
      'onUpdate(l.id,{renderStyle:val,renderStyleKey:styleKey,renderStyleIndependent:true})',
      'onUpdateUnit(unit.key,{setups:list,dressing:[],notes:""})','onUpdateUnit(u.key,{appearance:value})',
      'onUpdate(l.id,{ variants:[...(l.variants||[]), { id:"v"+Date.now().toString(36), time:suggest, state:"", manualState:true }] })',
      'id: l.id, slotId: "locref-"+l.id,','"data-location-unit-image":imgId'])
    assert.ok(ui.includes(t),t);
  // what Blender is sent is built from the stored location, not from the card's layout
  const loc=read("app/locations.jsx");
  const plan=loc.slice(loc.indexOf("function locationProductionPlan(l,units){"),loc.indexOf("window.screenplaySpaceSourceMeta=screenplaySpaceSourceMeta;"));
  for(const t of ['schema:"cm-location-plan-v1"','sharedSetLayout:locationSpatialContract(l)','coordinates:locationCoordinateExport(l)','canonicalSet:canon(l)',
      'continuityRoot:parent?','screenplaySpaces:spaces.map(','appearanceStates:states.map(','requiredSpacePlates:','coverageViews:locationCoverageViews(l).map(','sceneSetups:locationSceneSetups(l,spaces).map('])
    assert.ok(plan.includes(t),"the Blender package keeps "+t);
  assert.ok(sheet.includes("productionPlan:(typeof locationProductionPlan===\"function\")\n              ? locationProductionPlan(l,units) : null}},"));
});

test("10 the other tabs point at the new name; Frances knows the card; the styles and cache keys are in", ()=>{
  const shots=read("app/shots-ui.jsx");
  assert.ok(shots.includes('" \\u2192 Variants, in the Art Room\'s Locations tab"')&&!shots.includes("\\u2192 Rooms & times, in the Art Room"));
  const s=ai.slice(ai.indexOf('APP_FEATURES.push({ name:"Location card structure (the card as a tree)"'));
  const entry=s.slice(0,s.indexOf("\n"));
  for(const re of [/1 \\u00b7 The Space/,/Narrative Significance, Look Dev/,/Screenplay Coverage \(read from the screenplay, read-only/,/SPACE AND STAGING: 2 \\u00b7 Floor plan, 3 \\u00b7 Cameras/,
      /Build in Blender inside step 4/,/VARIANTS: each time of day/,/Add a variant/,/Sc 02 \(Pre-dawn\)/,/SUBSPACES \(a main location only\)/,/holds the QA check/,/Nothing saved moved/])
    assert.ok(re.test(entry),String(re));
  assert.ok(!/TURN|McKee|Claude|Anthropic|MUSE|Cinema Machine/.test(entry));
  assert.ok(ai.includes("'Rooms & times' is now the card's 'Variants' section")&&ai.includes("the 'More' section is gone"));
  for(const c of [".loc-group-head{",".loc-group-title{",".loc-used-in{",".loc-subspaces{",".loc-subspace-link{",".loc-variant-group{"]) assert.ok(css.includes(c),c);
  for(const f of ["locations-ui.jsx","blender-render-ui.jsx","shots-ui.jsx","ai.jsx","script.jsx","app.jsx"])
    assert.ok(["20261113-tree1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its new cache key");
  assert.ok(["20261113-tree1"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

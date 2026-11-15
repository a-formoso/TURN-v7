/* THE LOCATION CARD AS A TREE (owner 2026-11-13, "go ahead with all of it"), EVERY SECTION NUMBERED IN ORDER
   (owner 2026-11-13, second pass: "organized in order of what comes first and what comes last ... if they're not
   needed, get rid of them"). The card shows what is stored in the owner's own structure, as one numbered list:

     1 · The Space          the place; Screenplay Coverage at its top (read-only), Narrative Significance its last field
     2 · Floor plan         with Moving parts (optional) at its end
     3 · Cameras
     4 · Build the set      where a set can be built (your own Blender inside it)
     5 · Style it
     n · Location image     Look Dev (the look of the image) and the QA check; the image is generated at the top
     n · Variants           each time of day or state, its image, and "Used in" (each scene's dressing & blocking)
     n · Subspaces          a main location's rooms (their variants and scenes) and its extra spaces
     n · Generation Prompt  read-only, the last section

   No section without a number and no gap: the last four take the numbers that follow the build steps.
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
const numbered=(key,name)=>'label:sectionNo.'+key+'+" \\u00b7 '+name+'"';

test("1 the card's sections, in the order of the work, every one numbered", ()=>{
  const order=['label:"1 \\u00b7 The Space"','summary",null,"Screenplay Coverage"','field:"architecture"','"Narrative Significance \\u2014 what this place means in the story"',
    'label:"2 \\u00b7 Floor plan"','"Moving parts (optional)"','label:"3 \\u00b7 Cameras"','label:"4 \\u00b7 Build the set"','label:"5 \\u00b7 Style it"',
    numbered("previs","Previs"),numbered("image","Location image"),'"Look Dev"',numbered("variants","Variants"),numbered("subspaces","Subspaces"),numbered("prompt","Generation Prompt")].map(at);
  order.forEach((x,i)=>assert.ok(i===0||x>order[i-1],"section "+i+" follows the one before it"));
  // every fold of the card carries a number: the first five their own, the rest the next ones
  const labels=sheet.slice(at("// THE CARD IN ORDER (owner 2026-11-13)")).match(/CardFold,\{label:[^,]+/g)||[];
  assert.equal(labels.length,10);
  for(const x of labels) assert.match(x,/label:"[1-5] \\u00b7 |label:sectionNo\.(previs|image|variants|subspaces|prompt)\+" \\u00b7 /);
  // gone: the flat list, the two nested lists, More, the sections without a number and the group headings over them
  for(const t of ['label:"More"','label:"Rooms & times"','label:"1 \\u00b7 Describe the place"','label:"Screenplay evidence"','label:"Look & exclusions"',
      '"Additional environment states"','"Scene dressing & blocking"','"Add environment state"','label:"Narrative Significance"','label:"Look Dev"',
      'label:"Screenplay Coverage"','label:"Moving parts"','label:"Blender Studio"','LocationGroupHead','placeGroup','"Space and staging"'])
    assert.ok(!sheet.includes(t),"no "+t);
  assert.ok(!ui.includes("function LocationGroupHead")&&!css.includes(".loc-group-head"));
  // the step guide and the build's "Go to" buttons use the same name for step 1
  assert.ok(ui.includes('{n:1,name:"The Space",done:!!drafted,'));
  assert.ok(read("app/blender-render-ui.jsx").includes('const LOCATION_STEP_NAMES={1:"The Space",2:"Floor plan",3:"Cameras",4:"Build the set",5:"Style it"};'));
});

test("2 the numbers follow the card with no gap; a room's card says whose description it uses", ()=>{
  const no=o=>({...box.locationSectionNumbers(o)});
  // a room, or a place with no rooms: the set steps, then the image, variants and the prompt
  assert.deepEqual(no({build:true,style:true,subspaces:false}),{space:1,plan:2,cameras:3,build:4,style:5,image:6,variants:7,prompt:8});
  // a place with extra spaces (or rooms and a footprint of its own): Subspaces too
  assert.deepEqual(no({build:true,style:true,subspaces:true}),{space:1,plan:2,cameras:3,build:4,style:5,image:6,variants:7,subspaces:8,prompt:9});
  // a place whose rooms are built one by one: no steps 4 and 5, and no hole where they were
  assert.deepEqual(no({build:false,style:false,subspaces:true}),{space:1,plan:2,cameras:3,image:4,variants:5,subspaces:6,prompt:7});
  // the cloud build switched off: step 4 holds your own Blender alone
  assert.deepEqual(no({build:true,style:false,subspaces:false}),{space:1,plan:2,cameras:3,build:4,image:5,variants:6,prompt:7});
  assert.deepEqual(no({build:false,style:true,subspaces:false}),{space:1,plan:2,cameras:3,image:4,variants:5,prompt:6},"no Style it without Build the set");
  assert.ok(sheet.includes("const sectionNo=locationSectionNumbers({build:showBuild,style:buildHere,previs:showPrevis,subspaces:showSubspaces});"));
  // Previs (2026-11-15) takes the number just before Location image; steps 4 and 5 keep theirs
  assert.deepEqual(no({build:true,style:true,previs:true,subspaces:true}),{space:1,plan:2,cameras:3,build:4,style:5,previs:6,image:7,variants:8,subspaces:9,prompt:10});
  assert.deepEqual(no({build:false,style:false,previs:true,subspaces:false}),{space:1,plan:2,cameras:3,previs:4,image:5,variants:6,prompt:7});
  assert.ok(sheet.includes("const showSubspaces=!l.parentLocation&&(hasRooms||coverageSheets.length>0);"));
  // the two lines a room's card carries
  assert.ok(sheet.includes('" \\u00b7 uses its space and look unless filled in here"'));
  assert.ok(sheet.includes("\"'s architecture, materials, scale, connections and locked landmarks. Fill in below only what is different here.\""));
  // 1 · The Space: what the screenplay says first (read-only), what the place means last (the same saved field)
  const space=sheet.slice(at('label:"1 \\u00b7 The Space"'),at('label:"2 \\u00b7 Floor plan"'));
  assert.ok(space.includes('"data-testid":"loc-screenplay-coverage"')&&space.includes("React.createElement(LocationScreenplayEvidence,{units:evidenceUnits,onScene:onChipClick})"));
  assert.ok(space.includes("onCommit:val=>onUpdate(l.id,{significance:val})"));
  assert.ok(space.includes("Narrative Significance, the last field, says what the place means in the story."));
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
  const fold=sheet.slice(at(numbered("variants","Variants")),at(numbered("subspaces","Subspaces")));
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
  const fold=sheet.slice(at(numbered("subspaces","Subspaces")),at(numbered("prompt","Generation Prompt")));
  assert.ok(sheet.includes('showSubspaces&&React.createElement(CardFold,{label:sectionNo.subspaces+" \\u00b7 Subspaces",foldId:"loc-subspaces-"+l.id,'));
  assert.ok(fold.includes("count:hasRooms?roomLocations.length:undefined,defaultOpen:hasRooms}"));
  assert.ok(fold.includes("React.createElement(LocationSubspaceList,{rooms:roomLocations,units:sluglineUnits,onSelectLocation,canBuild:cloudPilot})"));
  assert.ok(fold.indexOf('"Extra spaces"')>fold.indexOf("LocationSubspaceList")&&fold.includes("React.createElement(LocationCoverageSheet,"));
  assert.ok(fold.includes("'s space and look unless you fill in its own."));
});

test("8 Build the set and Style it show where a set can be built; Blender and the image each have one numbered home", ()=>{
  assert.ok(sheet.includes("const buildHere=cloudPilot&&(ownRoom||!hasRooms);"));
  const can=(cloudPilot,ownRoom,hasRooms)=>cloudPilot&&(ownRoom||!hasRooms);
  assert.equal(can(true,true,false),true,"a room with its footprint");
  assert.equal(can(true,false,false),true,"an unfinished place with no rooms keeps the steps, with what to do first");
  assert.equal(can(true,true,true),true,"a place with rooms AND a footprint of its own");
  assert.equal(can(true,false,true),false,"a place whose rooms are built one by one: its rooms carry the steps");
  assert.equal(can(false,true,false),false,"the build switched off");
  // the step guide lists the steps the card shows, with the card's numbers
  assert.ok(sheet.includes("const cardSteps=locationCardSteps({l,drafted,spatialState,gen,cloudPilot:buildHere,cloudJob,ownBlender:showBuild&&!buildHere,imageN:sectionNo.image,previsN:sectionNo.previs});"));
  const guide=o=>box.locationCardSteps({l:{id:"x"},drafted:true,spatialState:{ready:false,reason:"r"},gen:{},cloudJob:null,...o});
  const steps=o=>Array.from(guide(o).map(s=>s.n+" "+s.name));
  assert.deepEqual(steps({cloudPilot:true,imageN:6}),["1 The Space","2 Floor plan","3 Cameras","4 Build the set","5 Style it","6 Location image"]);
  assert.deepEqual(steps({cloudPilot:false,imageN:4}),["1 The Space","2 Floor plan","3 Cameras","4 Location image"],"no hole where the build steps were");
  assert.deepEqual(steps({cloudPilot:false,ownBlender:true,imageN:5}),["1 The Space","2 Floor plan","3 Cameras","4 Build the set","5 Location image"]);
  assert.deepEqual(steps({cloudPilot:false}),["1 The Space","2 Floor plan","3 Cameras","4 Location image"],"the number is right without being told");
  assert.equal(guide({cloudPilot:false,ownBlender:true}).find(s=>s.n===4).optional,true,"your own Blender never holds up the next step");
  assert.equal(guide({cloudPilot:false,imageN:4}).find(s=>s.key==="image").n,4);
  assert.ok(ui.includes('if((steps.find(x=>x.n===n)||{}).key==="image"){'),"Go on the image step goes to the top of the card, whatever its number");
  assert.ok(/showBuild&&React\.createElement\(CardFold,\{label:"4 \\u00b7 /.test(sheet)&&/buildHere&&React\.createElement\(CardFold,\{label:"5 \\u00b7 /.test(sheet));
  assert.ok(sheet.includes("const handoffInSubspaces=!buildHere&&hasRooms;")&&sheet.includes("const showBuild=buildHere||(!!window.BlenderStudioLaunch&&!handoffInSubspaces);"));
  // the handoff: inside step 4, or at the end of Subspaces on a place whose rooms are built one by one
  assert.equal((sheet.match(/\bstudioHandoff\b/g)||[]).length,3);
  assert.ok(sheet.includes('buildHere&&React.createElement("h4",{className:"loc-step-sub"},"Or in your own Blender"),\n          studioHandoff)),'));
  assert.ok(sheet.includes('React.createElement("h4",{className:"loc-step-sub"},"The whole place in your own Blender"),\n          studioHandoff)),'));
  assert.equal((sheet.match(/className:"loc-sub","data-testid":"loc-own-blender"/g)||[]).length,2,"each home of the hand-off is a boxed subsection");
  // the image's own section: Look Dev (the same two saved fields) and the check; the prompt is read-only and last
  const image=sheet.slice(at(numbered("image","Location image")),at(numbered("variants","Variants")));
  assert.ok(image.includes("foldId:locationStepFoldId(l,6),count:stepCount(sectionNo.image)"));
  assert.ok(image.includes('React.createElement("h4",{className:"loc-step-sub"},"Look Dev")')&&image.includes('className:"loc-render-style-details"'));
  assert.ok(image.includes("onUpdate(l.id,{negativePrompt:val})")&&image.includes("window.QaCheckButton && gen.genUrl && React.createElement("),"the check takes a row only when there is an image");
  assert.ok(image.includes('"Generate the image at the top of the card. It is made from 1 \\u00b7 The Space and the look set here."'));
  const prompt=sheet.slice(at(numbered("prompt","Generation Prompt")));
  assert.ok(!prompt.includes("window.QaCheckButton")&&prompt.includes('"data-testid":"loc-prompt-built-from"'));
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

test("10 Moving parts: at the end of the floor plan, said in plain words", ()=>{
  const plan=sheet.slice(at('label:"2 \\u00b7 Floor plan"'),at('label:"3 \\u00b7 Cameras"'));
  assert.ok(plan.includes('id:"loc-parts-"+l.id,"data-testid":"location-moving-parts-section"'));
  assert.ok(plan.includes('"Moving parts (optional)"+(partsCount?" \\u00b7 "+partsCount:"")'));
  assert.ok(plan.includes("React.createElement(LocationMovingParts,{l,scenes,drafts,onUpdate,readOnly})"),"the same editor, the same saved list");
  assert.ok(sheet.includes("const partsCount=Array.isArray(l.movingParts)?l.movingParts.length:0;"));
  box.locationSpaceAnchors=()=>[]; box.normalizeLocationMovingParts=x=>Array.isArray(x)?x:[];
  const tree=box.LocationMovingParts({l:{id:"deck",scenes:["s1"],movingParts:[]},scenes:[{id:"s1",no:3}],drafts:{},onUpdate:noop});
  const words=text(tree);
  assert.match(words,/^Only for a set that changes during the story: a ramp that is lowered, a shutter that closes, a hatch that opens\./);
  assert.match(words,/Most places have none: leave this empty\./);
  const buttons=nodes(tree).filter(n=>n.type==="button");
  assert.deepEqual(buttons.map(text),["Find them in the screenplay (writing credits)","Add one by hand"]);
  assert.match(buttons[0].props.title,/lists any part of the set that moves, and the moment it moves\. One writing call \(writing credits\)\. You see the list and choose Keep or Discard before anything is saved\./);
  assert.match(buttons[1].props.title,/Starts an empty part \(Closed \/ Open\) for you to name and set by hand\. Free\./);
  assert.equal(buttons[0].props.disabled,false);
  // a place no scene plays in has nothing to read
  const none=box.LocationMovingParts({l:{id:"deck",scenes:[],movingParts:[]},scenes:[],drafts:{},onUpdate:noop});
  assert.equal(nodes(none).filter(n=>n.type==="button")[0].props.disabled,true);
});

test("11 first things first: with no description yet, the bar under the image opens step 1, as Go does; the fields are plain", ()=>{
  // the same block as before decides IF an image can be made; only the words and where the bar leads changed
  assert.ok(sheet.includes("generateDisabled:!spatialState.ready||!!l.parentLocation&&(!parentRefUrl||masterRefs.some(r=>r.required&&!r.ready&&!r.preview)),"));
  assert.ok(sheet.includes('generateDisabledLabel:!spatialState.ready?(drafted?"Review floor plan":"Start at 1 \\u00b7 The Space"):"Generate parent plate first",'));
  assert.ok(sheet.includes("onResolveGenerationBlock:!spatialState.ready?(drafted?reviewLayout:startAtSpace):undefined,"));
  assert.ok(sheet.includes('const startAtSpace=()=>window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:locationStepFoldId(l,1)}));'));
  assert.ok(sheet.includes('"Describe the place first, in 1 \\u00b7 The Space. The floor plan and the image come after it. No image will be generated."'));
  assert.ok(sheet.includes('label:"1 \\u00b7 The Space",foldId:locationStepFoldId(l,1),'),"the fold the bar opens");
  // the guide: the first step that is not done is next, so a place with no description starts at 1
  const guide=drafted=>box.locationCardSteps({l:{id:"x"},drafted,spatialState:{ready:false,reason:"r"},gen:{},cloudPilot:true,cloudJob:null}).find(s=>s.next);
  assert.equal(guide(false).n,1); assert.equal(guide(true).n,2);
  // a field of The Space: its name and a text box, nothing else; a hand edit is saved with the note that it is yours
  const saved=[];
  const field=box.LocationIdentityField({l:{id:"k",fromScript:true,provenance:{materials:"script",lighting:"locked"}},field:"materials",label:"Materials & palette",value:"Oak.",placeholder:"p",onUpdate:(id,patch)=>saved.push([id,patch])});
  assert.equal(field.type,"SheetField"); assert.equal(field.props.label,"Materials & palette");
  assert.equal(nodes(field).filter(n=>n.type==="select").length,0);
  field.props.onCommit("Pine.");
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),[["k",{materials:"Pine.",provenance:{materials:"design",lighting:"locked"}}]]);
  assert.ok(!ui.includes("LocationProvenanceSelect")&&!css.includes(".loc-prov-select"));
  const landmarks=sheet.slice(at('className:"loc-anchor-head"'),at("onCommit:val=>onUpdate(l.id,{continuityAnchors:val})"));
  assert.ok(!/select/.test(landmarks)&&landmarks.includes('"Fixed landmarks"')&&landmarks.includes("anchorsLocked"),"Fixed landmarks keeps its lock, which the image prompt reads");
});

test("12 one rhythm down the card, and every subsection in a box (every Art Room card)", ()=>{
  // (owner 2026-11-13) one distance between the name, the step guide, Render style, Scenes and the first section; the
  // rows' own one-sided margins are gone; a card that ends on a section ends on that section's own space. First on the
  // location card, then "replicated in the props card, the characters card, all the other ... cards".
  const CARD=":is([data-location-card],[data-char-card],[data-prop-card],[data-shot-card],[data-look-card],[data-crowd-card])";
  const rule=sel=>{ const i=css.indexOf(sel); assert.ok(i>=0,"styles have "+sel); return css.slice(i,css.indexOf("}",i)+1); };
  assert.ok(css.includes(CARD+"{--card-gap:15px}"));
  assert.equal(rule(CARD+" > .sheet-body{"),CARD+" > .sheet-body{gap:var(--card-gap);padding:var(--card-gap) 15px}");
  assert.equal(rule(CARD+" > .sheet-body:has("),CARD+" > .sheet-body:has(> .sheet-fold:last-child){padding-bottom:0}");
  assert.equal(rule(CARD+" > .sheet-body > :is(.loc-steps,"),
    CARD+" > .sheet-body > :is(.loc-steps,.char-style-row,.location-scenes,.sheet-scenes,.prop-scenes,.prompt-drift-banner,.shot-beat-context){margin-top:0;margin-bottom:0}");
  assert.equal(rule(".artroom "+CARD+" > .sheet-body > .sheet-fold + .sheet-fold{"),
    ".artroom "+CARD+" > .sheet-body > .sheet-fold + .sheet-fold{margin-top:calc(-1 * var(--card-gap))}");
  assert.ok(rule(".artroom "+CARD+" > .sheet-body > .sheet-fold > .sheet-fold-body{").includes("padding-bottom:var(--card-gap)"));
  // every kind of card the Art Room draws is in the list
  const kinds=new Set(); for(const f of ["artroom.jsx","locations-ui.jsx","shots-ui.jsx","props.jsx","lookbook.jsx"]){
    let src=""; try{ src=read("app/"+f); }catch(e){ continue; } for(const m of src.matchAll(/"(data-[a-z]+-card)"/g)) kinds.add(m[1]); }
  assert.ok(kinds.size>=5,"found the card kinds"); for(const k of kinds) assert.ok(CARD.includes("["+k+"]"),k+" is in the list");
  // a section title keeps the same 15px above and below it, which is what the gap matches
  assert.ok(/\.sheet-fold-head\{[^}]*\n?\s*padding:15px 6px 15px 0;/.test(css));
  // these rules come after the Art Room's general ones they adjust
  assert.ok(css.indexOf(CARD+"{--card-gap:15px}")>css.indexOf(".artroom .sheet-card .sheet-body > .sheet-fold + .sheet-fold{margin-top:-11px}"));
  // the frame the floor plan's parts have, on a field, Look Dev's settings, the paired and "more detail" fields and the
  // hand-off to your own Blender
  const box=rule(CARD+" > .sheet-body > .sheet-fold > .sheet-fold-body > :is(.sheet-field,");
  for(const r of [".sheet-field",".loc-anchor-field",".loc-render-style-details",".loc-sub",".char-phys",".role-fields",".sheet-2col",".prop-more-fields",".prop-content-fields",".bs-launch"]) assert.ok(box.includes(r),r);
  assert.ok(box.endsWith("{border:1px solid var(--line);border-radius:var(--r-m);padding:8px 10px;background:var(--bg-2);min-width:0}"));
  assert.ok(/\.loc-evidence-source,\.loc-nested-section\{border:1px solid var\(--line\);border-radius:var\(--r-m\);padding:8px 10px;background:var\(--bg-2\)\}/.test(css),"the same frame as the floor plan's parts");
  assert.ok(css.includes(CARD+" .loc-sub > .bs-launch{margin-top:0;padding-top:0;border-top:0}"));
  assert.ok(css.includes("[data-location-card] .loc-variant > .sheet-frame{padding:10px 0 0;border-bottom:0}"));
  // step 1: the help sits on the Draft row, not on a row of its own
  const space=sheet.slice(at('label:"1 \\u00b7 The Space"'),at('"data-testid":"loc-screenplay-coverage"'));
  assert.ok(/"Draft specification"\),\s*\/\/[^\n]*\n\s*React\.createElement\(LocationSectionHelp,\{\s*label:"About The Space",/.test(space));
  assert.ok(css.includes("[data-location-card] .sheet-fold-body > .loc-step-actions > .loc-section-help{margin:0 0 0 auto}"));
});

test("13 a button is as big as the level it sits at (every Art Room card)", ()=>{
  // (owner 2026-11-13) the card's bar 36px and Go 32px; a section 32px; a box in a section 28px; a box in a box 26px
  const CARD=":is([data-location-card],[data-char-card],[data-prop-card],[data-shot-card],[data-look-card],[data-crowd-card])";
  const a=css.indexOf("/* A BUTTON IS AS BIG AS THE LEVEL IT SITS AT"); assert.ok(a>0);
  const block=css.slice(a,css.indexOf("\n}\n",a)+3);
  assert.ok(block.includes("@media (min-width:641px){"),"phones keep their 44px touch sizes");
  assert.ok(block.includes(CARD+"{--card-btn-section:32px;--card-btn-box:28px;--card-btn-deep:26px}"));
  const BOXES=".loc-nested-section,.loc-sub,.loc-variant,.loc-step-fixes,.sheet-field,.loc-anchor-field,.loc-render-style-details,.loc-evidence-source,.loc-map-check,.loc-subspace";
  const BTN=":is(.art-draftall,.char-draft-btn,.bs-launch-button)";
  assert.ok(block.includes(CARD+" .sheet-fold-body "+BTN+"{height:auto;min-height:var(--card-btn-section);"));
  assert.ok(block.includes(CARD+" .sheet-fold-body :is("+BOXES+",.sheet-fold-body > .bs-launch) "+BTN+"{width:auto;max-width:100%;min-height:var(--card-btn-box);"),"a box's action: its own width, the box's size");
  assert.ok(block.includes(CARD+" .sheet-fold-body :is("+BOXES+") :is("+BOXES+") "+BTN+"{min-height:var(--card-btn-deep);"));
  assert.ok(block.includes(CARD+" .sheet-fold-body .sheet-gen-btn{height:30px;font-size:12px}"),"an image bar inside a section is a step under the card's");
  // the sizes they are measured against
  assert.ok(/\.sheet-gen-btn\{[^}]*height:36px/.test(css)&&/\.art-draftall\{[^}]*height:32px/.test(css));
  // the two that were the biggest buttons on the card
  assert.ok(css.includes(".loc-spatial-plan .loc-spatial-confirm{justify-content:center;width:100%;min-height:44px;"),"the floor plan's main button, before the level rule");
  assert.ok(sheet.includes('className:"loc-sub","data-testid":"loc-own-blender"'),"Build in Blender sits in a box, so the box rule sizes it");
  assert.ok(["20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});

test("14 the other tabs point at the new name; Frances knows the card; the styles and cache keys are in", ()=>{
  const shots=read("app/shots-ui.jsx");
  assert.ok(shots.includes('" \\u2192 Variants, in the Art Room\'s Locations tab"')&&!shots.includes("\\u2192 Rooms & times, in the Art Room"));
  const s=ai.slice(ai.indexOf('APP_FEATURES.push({ name:"Location card structure (the card as a tree)"'));
  const entry=s.slice(0,s.indexOf("\n"));
  for(const re of [/one numbered list, top to bottom, in the order you work: every section has a number and there is no gap/,/1 \\u00b7 The Space/,
      /Screenplay Coverage, at its top, is read from the screenplay and read-only/,/Narrative Significance, its last field/,
      /2 \\u00b7 Floor plan, with Moving parts \(optional\) at its end\. 3 \\u00b7 Cameras\./,/Build in Blender inside step 4/,
      /LOCATION IMAGE: Look Dev \(render style instructions and what to leave out\) and the QA check/,/VARIANTS: each time of day/,/Add a variant/,/Sc 02 \(Pre-dawn\)/,
      /SUBSPACES \(a main location only\)/,/GENERATION PROMPT: read-only, the last section/,/6, 7, 8 and 9/,/Its fields are plain text boxes/,
      /the Go button in the step guide and the bar under the image \(Start at 1 \\u00b7 The Space\) both open 1 \\u00b7 The Space/,/so they are 4, 5, 6 and 7/,/Nothing saved moved/])
    assert.ok(re.test(entry),String(re));
  assert.ok(!/TURN|McKee|Claude|Anthropic|MUSE|Cinema Machine/.test(entry));
  assert.ok(!/Blender Studio section|Space and staging|SPACE AND STAGING/.test(ai),"Frances is not told about sections that are gone");
  const parts=ai.slice(ai.indexOf('APP_FEATURES.push({ name:"Moving parts of a location"'));
  const partsEntry=parts.slice(0,parts.indexOf("\n"));
  for(const re of [/MOVING PARTS \(optional, at the end of a location card's 2 · Floor plan section\) is only for a set that changes during the story; most places have none/,
      /'Find them in the screenplay' reads the location's scenes and proposes them/,/'Add one by hand' starts an empty part \(free\)/])
    assert.ok(re.test(partsEntry),String(re));
  assert.ok(ai.includes("'Rooms & times' is now the card's 'Variants' section")&&ai.includes("the 'More' section is gone"));
  for(const c of [".loc-parts-section{",".loc-used-in{",".loc-subspaces{",".loc-subspace-link{",".loc-variant-group{"]) assert.ok(css.includes(c),c);
  for(const f of ["locations-ui.jsx","blender-render-ui.jsx","shots-ui.jsx","ai.jsx","script.jsx","app.jsx"])
    assert.ok(["20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its new cache key");
  assert.ok(["20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2"].some(k=>html.includes("app/styles.css?v="+k+'"')));
  for(const f of ["locations-ui.jsx","ai.jsx","script.jsx"]) assert.ok(["20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" was re-keyed for the numbered sections");
});

test("15 Previs: the numbered section before Location image, an optional step, opened by name", ()=>{
  // on every card, where the 3D view loaded; the fold draws only while it is open (CardFold mounts its body when open)
  assert.ok(sheet.includes("const showPrevis=!!(window.LocationPrevisStep&&window.KinolotPrevis&&window.KinolotSetDressing&&window.KinolotCloudRender);"));
  assert.ok(sheet.includes('showPrevis&&React.createElement(CardFold,{label:sectionNo.previs+" \\u00b7 Previs",foldId:"loc-previs-"+l.id,count:stepCount(sectionNo.previs),defaultOpen:initialSection==="previs"},\n        React.createElement(window.LocationPrevisStep,{location:l,project,readOnly,onUpdate,hasImage:!!gen.genUrl,imageN:sectionNo.image})),'));
  assert.ok(at(numbered("previs","Previs"))>at('label:"5 \\u00b7 Style it"')&&at(numbered("previs","Previs"))<at(numbered("image","Location image")));
  // the step guide: optional (it never holds up the next step), done once the set is dressed, numbered as the card is
  const guide=o=>box.locationCardSteps({l:{id:"x"},drafted:true,spatialState:{ready:false,reason:"r"},gen:{},cloudJob:null,...o});
  const names=o=>Array.from(guide(o).map(s=>s.n+" "+s.name));
  assert.deepEqual(names({cloudPilot:true,previsN:6,imageN:7}),["1 The Space","2 Floor plan","3 Cameras","4 Build the set","5 Style it","6 Previs","7 Location image"]);
  assert.deepEqual(names({cloudPilot:false,previsN:4,imageN:5}),["1 The Space","2 Floor plan","3 Cameras","4 Previs","5 Location image"]);
  const step=guide({cloudPilot:false,previsN:4,imageN:5}).find(s=>s.key==="previs");
  assert.equal(step.optional,true);assert.equal(step.done,false);assert.ok(!step.next);
  assert.equal(guide({l:{id:"x",previs:{v:1}},cloudPilot:false,previsN:4,imageN:5}).find(s=>s.key==="previs").done,true);
  // its number moves with the card, so Go opens it by its own fold, never by number (6 is the image fold's id)
  assert.ok(ui.includes('if((steps.find(x=>x.n===n)||{}).key==="previs"){window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:"loc-previs-"+l.id}));return;}'));
  // the section itself
  const step_ui=read("app/set-previs-ui.jsx");
  for(const t of ['"data-testid":"previs-sheet"','"data-testid":"previs-dress"','"data-testid":"previs-render"','"data-testid":"previs-not-ready"','"data-testid":"previs-unsaved"',
      '"Dress the set"','"Remove the dressing"','"Make the location image"','" (writing credits)"','window.nbCostChip(1,choice.cost)',
      '"Go to 2 \\u00b7 Floor plan"','onUpdate(l.id,{previs:D.pack(r.dressing,{engine:D.MODEL})})','onUpdate(l.id,{previs:null})',
      'title:"Make a new location image?"',"The image you have now stays in the card's versions.\""])
    assert.ok(step_ui.includes(t),t);
  assert.ok(step_ui.includes("window.LocationPrevisStep=LocationPrevisStep;"));
  // three boxed subsections, like every other section of the card; no button without its row
  assert.equal((step_ui.match(/className:"loc-sub/g)||[]).length,3);
  assert.ok(!/Three\.?js|Blender|WebGL/i.test(step_ui.replace(/\/\*[\s\S]*?\*\//g,"").replace(/BlenderPreview/g,"")),"the library is never named on the card");
  // Frances knows it; the page loads it; the styles are in
  const ai=read("app/ai.jsx"),html=read("TURN.html");
  assert.ok(ai.includes('name:"Previs (the set in 3D on a location card)"')&&ai.includes("DRESS THE SET")&&ai.includes("MAKE THE LOCATION IMAGE"));
  for(const f of ["set-dressing.js","set-previs.js","set-previs-ui.jsx","locations-ui.jsx","ai.jsx","styles.css"])
    assert.ok(["20261115-previs2"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its cache key");
  assert.ok(html.indexOf("app/set-previs.js")>html.indexOf("app/camera-angle-preview.js")&&html.indexOf("app/set-dressing.js")>html.indexOf("app/blender-render.js"));
  assert.ok(css.includes(".previs-sheet{aspect-ratio:16/9;"));
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

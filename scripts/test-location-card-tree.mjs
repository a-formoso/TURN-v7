/* THE LOCATION CARD AS A TREE (owner 2026-11-13, "go ahead with all of it"), EVERY SECTION NUMBERED IN ORDER
   (owner 2026-11-13, second pass: "organized in order of what comes first and what comes last ... if they're not
   needed, get rid of them"). The card shows what is stored in the owner's own structure, as one numbered list:

     1 · The Space          the place; Screenplay Coverage at its top (read-only), Narrative Significance its last field
     2 · Floor plan         with Moving parts (optional) at its end
     3 · Cameras
     4 · Previs             the set in 3D; the location image is made from it, as drafts (2026-11-15)
     5 · Location image     The look and the QA check; the image is made in Previs or generated at the top
                            (ONE ROAD, owner 2026-11-15: "yes, and remove Blender". Build the set and Style it,
                            steps 5 and 6 until then, are no longer on the card.)
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
const sheet=ui.slice(ui.indexOf("function LocationSheet("),ui.indexOf("function locationCardSteps("));
const at=t=>{ const i=sheet.indexOf(t); assert.ok(i>=0,"the card has "+t); return i; };
const numbered=(key,name)=>'label:sectionNo.'+key+'+" \\u00b7 '+name+'"';

test("1 the card's sections, in the order of the work, every one numbered", ()=>{
  const order=['label:"1 \\u00b7 The Space"','summary",null,"Screenplay Coverage"','field:"architecture"','"Narrative Significance \\u2014 what this place means in the story"',
    'label:"2 \\u00b7 Floor plan"','"Moving parts (optional)"','label:"3 \\u00b7 Cameras"','label:"4 \\u00b7 Previs"',
    numbered("image","Location image"),'"The look"',numbered("variants","Variants"),numbered("subspaces","Subspaces"),numbered("prompt","Generation Prompt")].map(at);
  order.forEach((x,i)=>assert.ok(i===0||x>order[i-1],"section "+i+" follows the one before it"));
  // every fold of the card carries a number: the first four their own, the rest the next ones (5 on)
  const labels=sheet.slice(at("// THE CARD IN ORDER (owner 2026-11-13)")).match(/CardFold,\{label:[^,]+/g)||[];
  assert.equal(labels.length,8);
  for(const x of labels) assert.match(x,/label:"[1-4] \\u00b7 |label:sectionNo\.(image|variants|subspaces|prompt)\+" \\u00b7 /);
  // gone: the flat list, the two nested lists, More, the sections without a number and the group headings over them;
  // and since 2026-11-15 (one road) the cloud build's two steps, the Blender hand-off and the name Look Dev
  for(const t of ['label:"More"','label:"Rooms & times"','label:"1 \\u00b7 Describe the place"','label:"Screenplay evidence"','label:"Look & exclusions"',
      '"Additional environment states"','"Scene dressing & blocking"','"Add environment state"','label:"Narrative Significance"','label:"Look Dev"','"Look Dev"',
      'label:"Screenplay Coverage"','label:"Moving parts"','label:"Blender Studio"','LocationGroupHead','placeGroup','"Space and staging"',
      'label:"5 \\u00b7 Build the set"','label:"6 \\u00b7 Style it"','LocationCloudRender','LocationStyleStep','studioHandoff','loc-own-blender','cloudPilot'])
    assert.ok(!sheet.includes(t),"no "+t);
  assert.ok(!ui.includes("function LocationGroupHead")&&!css.includes(".loc-group-head"));
  assert.ok(!ui.includes("function LocationCloudBuildSetup")&&!ui.includes("function useLocationCloudJob"));
  // the step guide and the "Go to" buttons use the same names
  assert.ok(ui.includes('{n:1,name:"The Space",done:!!drafted,'));
  assert.ok(read("app/blender-render-ui.jsx").includes('const LOCATION_STEP_NAMES={1:"The Space",2:"Floor plan",3:"Cameras",4:"Previs",5:"Location image"};'));
});

test("2 the numbers follow the card with no gap; a room's card says whose description it uses", ()=>{
  const no=o=>({...box.locationSectionNumbers(o)});
  // one road (2026-11-15): the first five are on every card. A room, or a place with no rooms: then variants and the prompt
  assert.deepEqual(no({subspaces:false}),{space:1,plan:2,cameras:3,previs:4,image:5,variants:6,prompt:7});
  // a place with rooms or extra spaces: Subspaces too
  assert.deepEqual(no({subspaces:true}),{space:1,plan:2,cameras:3,previs:4,image:5,variants:6,subspaces:7,prompt:8});
  assert.deepEqual(no({build:true,style:true,subspaces:true}),{space:1,plan:2,cameras:3,previs:4,image:5,variants:6,subspaces:7,prompt:8},"nothing brings the build's numbers back");
  assert.ok(sheet.includes("const sectionNo=locationSectionNumbers({subspaces:showSubspaces});"));
  // (2026-11-17) extra spaces count only while the place has no confirmed floor plan, or when one has an image
  assert.ok(sheet.includes('const showSubspaces=!l.parentLocation&&(hasRooms||(spatialState.ready?coverageSheets.some(v=>{try{return typeof nbGetImage==="function"&&!!nbGetImage(l.id+"-"+v.id);}catch(_){return false;}}):coverageSheets.length>0));'));
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

test("7 Subspaces: each room with its variants and scenes; a row opens the room, its plan, its variants or its Previs", ()=>{
  const went=[];
  const rooms=[{id:"kit",key:"house-kitchen",name:"Kitchen",variants:[{id:"v1",time:"Storm",state:"rain on the window"}]},
    {id:"liv",key:"house-living-room",name:"Living Room"},{id:"att",key:"house-attic",name:"Attic"}];
  const units=[{key:"a",subspaceKey:"house-kitchen",time:"Night",intExt:"INT",sceneNos:[3]},
    {key:"b",subspaceKey:"house-kitchen",time:"Dawn",intExt:"INT",sceneNos:[6]},
    {key:"c",locationKey:"house-living-room",time:"Dawn",intExt:"INT",sceneNos:[6]},
    {key:"d",subspaceKey:"house-kitchen",time:"Dusk",intExt:"INT",sceneNos:[1],orphan:true}];
  const tree=box.LocationSubspaceList({rooms,units,onSelectLocation:(id,section)=>went.push([id,section])});
  const rows=nodes(tree).filter(n=>n.props&&n.props["data-location-subspace"]);
  assert.deepEqual(rows.map(r=>r.props["data-location-subspace"]),["kit","liv","att"]);
  const lines=r=>nodes(r).filter(n=>n.type==="small").map(text);
  assert.deepEqual(lines(rows[0]),["Variants: Night, Dawn, Storm","Used in: Sc 03 (Night), Sc 06 (Dawn)"]);
  assert.deepEqual(lines(rows[1]),["Variants: Dawn","Used in: Sc 06 (Dawn)"]);
  assert.deepEqual(lines(rows[2]),["Variants: none yet","Used in: no scene yet"]);
  const buttons=nodes(rows[0]).filter(n=>n.type==="button");
  assert.deepEqual(buttons.map(b=>text(b).replace(/Variants:.*/,"")),["Kitchen","Floor plan","Variants","Previs"]);
  buttons.forEach(b=>b.props.onClick());
  assert.deepEqual(went,[["kit",""],["kit","layout"],["kit","units"],["kit","previs"]]);
  // on the card: a main location only, open when it has rooms, with its extra spaces in the same section
  const fold=sheet.slice(at(numbered("subspaces","Subspaces")),at(numbered("prompt","Generation Prompt")));
  assert.ok(sheet.includes('showSubspaces&&React.createElement(CardFold,{label:sectionNo.subspaces+" \\u00b7 Subspaces",foldId:"loc-subspaces-"+l.id,'));
  assert.ok(fold.includes("count:hasRooms?roomLocations.length:undefined,defaultOpen:hasRooms}"));
  assert.ok(fold.includes("React.createElement(LocationSubspaceList,{rooms:roomLocations,units:sluglineUnits,onSelectLocation,\n          outside:outsideRooms,\n          onAddToPlan:()=>window.goToLocationStep&&window.goToLocationStep(l,2)}),"));
  // (2026-11-16, the whole place first) a room with no outline on the place's floor plan says so on its row
  const flagged=box.LocationSubspaceList({rooms,units,onSelectLocation:()=>{},outside:[{id:"att",name:"Attic"}],onAddToPlan:()=>went.push(["plan"])});
  const flags=nodes(flagged).filter(n=>n.props&&n.props["data-testid"]==="subspace-outside");
  assert.equal(flags.length,1);assert.ok(text(flags[0]).startsWith("Not on the floor plan yet, so it cannot be drawn in 3D."));
  nodes(flags[0]).find(n=>n.type==="button").props.onClick();assert.deepEqual(went.at(-1),["plan"]);
  assert.ok(fold.indexOf('"Extra spaces"')>fold.indexOf("LocationSubspaceList")&&fold.includes("React.createElement(LocationCoverageSheet,"));
  assert.ok(fold.includes("'s space and look unless you fill in its own."));
});

test("8 one road: the step guide ends at the image, whose Go opens Previs when the set is ready; the image has one numbered home", ()=>{
  // the step guide lists the steps the card shows, with the card's numbers: five, on every card
  assert.ok(sheet.includes("const cardSteps=locationCardSteps({l,drafted,spatialState,gen,previs:showPrevis&&(ownRoom||!hasRooms)});"));
  const guide=o=>box.locationCardSteps({l:{id:"x"},drafted:true,spatialState:{ready:false,reason:"r"},gen:{},...o});
  const steps=o=>Array.from(guide(o).map(s=>s.n+" "+s.name));
  for(const o of [{},{previs:true},{previs:false,cloudPilot:true,ownBlender:true}])
    assert.deepEqual(steps(o),["1 The Space","2 Floor plan","3 Cameras","4 Previs","5 Location image"]);
  // with the floor plan and the cameras done, the image's road is Previs: its Go opens step 4; before that, the top of the card
  const ready={spatialState:{ready:true}};
  const image=o=>guide(o).find(s=>s.key==="image");
  assert.equal(image({...ready,previs:true}).goTo,4);assert.equal(image({...ready,previs:true}).next,true);
  // (2026-11-17) the other way, the quick image, is in 5 · Location image: nothing is generated at the top of the card
  assert.match(image({...ready,previs:true}).todo,/^Open 4 · Previs, choose Make the location image, then Use as location image on the draft\. A quick image, from the description alone, is in 5 · Location image\.$/);
  assert.equal(image({...ready,previs:false}).goTo,0);assert.equal(image({...ready,previs:false}).todo,"Open 5 · Location image and make a quick image from the description.");
  assert.equal(image({previs:true}).goTo,0,"not before the floor plan and the cameras are done");
  assert.equal(guide({...ready,previs:true}).find(s=>s.key==="previs").optional,true,"Previs never holds up the guide");
  assert.ok(ui.includes('const st=steps.find(x=>x.n===n)||{},to=st.key==="image"&&st.goTo?st.goTo:n;'),"the image step opens Previs when the set is ready, else its own section (the quick image)");
  assert.ok(ui.includes('if(typeof window.goToLocationStep==="function")window.goToLocationStep(l,to);'));
  // the image's own section: The look (the same two saved fields) and the check; the prompt is read-only and last
  const section=sheet.slice(at(numbered("image","Location image")),at(numbered("variants","Variants")));
  assert.ok(section.includes('foldId:"loc-image-"+l.id,defaultOpen:false}'),"the image section keeps its own fold id, which step 5 opens");
  assert.ok(section.includes('React.createElement("h4",{className:"loc-step-sub"},"The look")')&&section.includes('className:"loc-render-style-details"'));
  assert.ok(section.includes('React.createElement(SheetField,{label:"Leave out",value:l.negativePrompt||d.negativePrompt,multiline:true,'),"Leave out: the same saved field, a plain name");
  assert.ok(section.includes("onUpdate(l.id,{negativePrompt:val})")&&section.includes("window.QaCheckButton && gen.genUrl && React.createElement("),"the check takes a row only when there is an image");
  assert.ok(section.includes('"data-testid":"loc-image-step-note"},locationImageStepNote({previs:showPrevis})),'),"the section's first line names every way this card makes the image");
  const note=box.locationImageStepNote;
  assert.equal(note({previs:true}),"The finished image of this place, shown at the top of the card. Make it in 4 \u00b7 Previs, from the set in 3D (make a draft, then choose Use as location image): that image keeps to the floor plan and the cameras. A quick image, from the description alone, can be made below. The look set here is used whichever way it is made.");
  assert.equal(note({previs:false}),"The finished image of this place, shown at the top of the card. A quick image, from the description in 1 \u00b7 The Space alone, can be made below. The look set here is used whichever way it is made.");
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
  // the card has no Blender hand-off since 2026-11-15; the Art Room toolbar's Blender Studio builds the same package itself
  assert.ok(read("app/blender-studio-ui.jsx").includes("const plan=typeof locationProductionPlan===\"function\"?locationProductionPlan(l,units||[]):null;"));
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

test("11 first things first: with no description yet, the quick image says to start at step 1, as the tracker does; the fields are plain", ()=>{
  // (2026-11-17) the bar under the image left with the top Generate; the same three conditions decide IF a quick image
  // can be made, said in 5 · Location image with the way there
  assert.ok(sheet.includes('const quickBlock=!drafted?{text:"Describe the place first, in 1 \\u00b7 The Space. The floor plan and the image come after it.",go:startAtSpace,label:"Go to 1 \\u00b7 The Space"}'));
  assert.ok(sheet.includes(':!spatialState.ready?{text:"Check the floor plan and confirm it first, in 2 \\u00b7 Floor plan.",go:reviewLayout,label:"Go to 2 \\u00b7 Floor plan"}'));
  assert.ok(sheet.includes(":l.parentLocation&&(!parentRefUrl||masterRefs.some(r=>r.required&&!r.ready&&!r.preview))?{text:"));
  assert.ok(!sheet.includes("generateDisabledLabel")&&!sheet.includes("onResolveGenerationBlock"));
  assert.ok(sheet.includes('const startAtSpace=()=>window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:locationStepFoldId(l,1)}));'));
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
  assert.ok(!sheet.includes('"data-testid":"loc-own-blender"'),"the card has no Blender hand-off box any more (2026-11-15)");
  assert.ok(["20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/styles.css?v="+k+'"')));
});

test("14 the other tabs point at the new name; Frances knows the card; the styles and cache keys are in", ()=>{
  const shots=read("app/shots-ui.jsx");
  assert.ok(shots.includes('" \\u2192 Variants, in the Art Room\'s Locations tab"')&&!shots.includes("\\u2192 Rooms & times, in the Art Room"));
  const s=ai.slice(ai.indexOf('APP_FEATURES.push({ name:"Location card structure (the card as a tree)"'));
  const entry=s.slice(0,s.indexOf("\n"));
  for(const re of [/one numbered list, top to bottom, in the order you work: every section has a number and there is no gap/,/1 \\u00b7 The Space/,
      /Screenplay Coverage, at its top, is read from the screenplay and read-only/,/Narrative Significance, its last field/,
      /2 \\u00b7 Floor plan, with Moving parts \(optional\) at its end\. 3 \\u00b7 Cameras\./,/4 \\u00b7 Previs: the set in 3D, on every card \(optional\), where the location image is made from the set/,
      /5 \\u00b7 LOCATION IMAGE: The look \(render style instructions and the Leave out field\) and the QA check/,/VARIANTS: each time of day/,/Add a variant/,/Sc 02 \(Pre-dawn\)/,
      /SUBSPACES \(a main location only\)/,/GENERATION PROMPT: read-only, the last section/,/5 \\u00b7 Location image, 6 \\u00b7 Variants, 7 \\u00b7 Subspaces and 8 \\u00b7 Generation Prompt/,/Its fields are plain text boxes/,
      /WHERE TO START: the tracker at the top of the card marks the step to do next and opens it \(1 \\u00b7 The Space first, where Draft specification writes the description\); Prepare this place, under the tracker, does what is left in order\./,/so its Generation Prompt is 7/,/Nothing saved moved/])
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
    assert.ok(["20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its new cache key");
  assert.ok(["20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/styles.css?v="+k+'"')));
  for(const f of ["locations-ui.jsx","ai.jsx","script.jsx"]) assert.ok(["20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" was re-keyed for the numbered sections");
});

test("15 Previs: step 4 on every card; optional; the camera check, the drafts under the button and the one rule", ()=>{
  // on every card, where the 3D view loaded; the fold draws only while it is open (CardFold mounts its body when open)
  assert.ok(sheet.includes("const showPrevis=!!(window.LocationPrevisStep&&window.KinolotPrevis&&window.KinolotSetDressing&&window.KinolotCloudRender);"));
  assert.ok(sheet.includes('showPrevis&&React.createElement(CardFold,{label:"4 \\u00b7 Previs",foldId:locationStepFoldId(l,4),\n          defaultOpen:initialSection==="previs"||initialSection==="build"||initialSection==="style"},\n        React.createElement(LocationPartOfPlace,{l,place:spatialState.owner,step:4,onSelectLocation}),\n        // a place with rooms shows them here too, each inside the place\'s one 3D set (LocationPrevisPlace)\n        React.createElement(window.LocationPrevisPlace||window.LocationPrevisStep,{location:l,rooms:roomLocations,project,readOnly,onUpdate,hasImage:!!gen.genUrl,\n          imageMeta:gen.genUrl?gen.genMeta:null,imageN:sectionNo.image,onSelectLocation})),'));
  assert.ok(at('label:"4 \\u00b7 Previs"')>at('label:"3 \\u00b7 Cameras"')&&at('label:"4 \\u00b7 Previs"')<at(numbered("image","Location image")));
  // the step guide: optional (it never holds up the next step), done once the set is dressed
  const guide=o=>box.locationCardSteps({l:{id:"x"},drafted:true,spatialState:{ready:false,reason:"r"},gen:{},...o});
  const step=guide({previs:true}).find(s=>s.key==="previs");
  assert.equal(step.n,4);assert.equal(step.optional,true);assert.equal(step.done,false);assert.ok(!step.next);
  assert.equal(guide({l:{id:"x",previs:{v:1}}}).find(s=>s.key==="previs").done,true);
  // a step number opens its own section: 4 Previs, 5 Location image; an old link to step 6 (Style it) opens Previs
  const ids=n=>vm.runInNewContext(read("app/locations.jsx").match(/function locationStepFoldId\(l,step\)\{[\s\S]*?\n\}/)[0]+";locationStepFoldId({id:'k'},"+n+")");
  assert.deepEqual([1,2,3,4,5,6].map(ids),["loc-step1-k","loc-layout-k","loc-step3-k","loc-step4-k","loc-image-k","loc-step4-k"]);
  assert.ok(!ui.includes('"loc-previs-"'),"no second way to open it");
  // every button that used to send you to the build or the styling leads to Previs
  const angle=read("app/camera-angle-preview-ui.jsx"),ideas=read("app/camera-inspiration-ui.jsx");
  assert.equal((ui.match(/window\.goToLocationStep\(l,4\)\},"Go to 4 \\u00b7 Previs"\)/g)||[]).length,1,"from 3 · Cameras, once the cameras are clear");
  assert.ok(ui.includes('window.goToLocationStep(l,4);}},url?"Make it again in 4 \\u00b7 Previs":"Make it in 4 \\u00b7 Previs"));'),"a moving part's state image");
  assert.ok(ui.includes('E("button",{type:"button",className:"loc-subspace-link",onClick:go("previs")},"Previs")'),"a room, from its place's Subspaces");
  assert.ok(angle.includes("4 \\u00b7 Previs redraws the set from it.")&&ideas.includes("All 4 cameras are set. Continue in 4 \\u00b7 Previs."));
  for(const src of [ui,angle,ideas]) assert.ok(!/Build the set|Style it|Rebuild in step|step 6|cloud Build set/.test(src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"")),"no wording of the removed steps is left on the card");
  // the section itself
  const step_ui=read("app/set-previs-ui.jsx");
  for(const t of ['"data-testid":"previs-sheet"','"data-testid":"previs-dress"','"data-testid":"previs-render"','"data-testid":"previs-not-ready"','"data-testid":"previs-unsaved"',
      '"data-testid":"previs-draft"','"data-testid":"previs-drafts-earlier"','"data-testid":"previs-compare-drafts"','"data-testid":"previs-review"','"data-testid":"previs-moment"',
      '"data-testid":"camera-check"','"data-testid":"camera-check-fix"',
      '"Dress the set"','"Remove dressing"','"Make the location image"','"Make another draft"','"data-testid":"previs-dress-cost"','window.nbCostChip(1,choice.cost)',
      '"Use as location image"','"Compare with the 3D set"','"Delete"','"Delete this draft"','"Delete the earlier draft"','"data-testid":"previs-draft-delete"','"Compare drafts"','"Make this the current draft"','"Fix cameras"',
      '"Go to 2 \\u00b7 Floor plan"','"Go to 3 \\u00b7 Cameras"','onUpdate(l.id,{previs:D.pack(r.dressing,{engine:D.MODEL})})','onUpdate(l.id,{previs:null})'])
    assert.ok(step_ui.includes(t),t);
  assert.ok(step_ui.includes("window.LocationPrevisStep=LocationPrevisStep;"));
  // the draft sits right under the button that makes it, inside the same box (owner 2026-11-15)
  const make=step_ui.indexOf('"Make another draft"'),draft=step_ui.indexOf('"data-testid":"previs-draft"'),earlier=step_ui.indexOf('"data-testid":"previs-drafts-earlier"'),compare=step_ui.indexOf('"data-testid":"previs-compare-drafts"');
  assert.ok(step_ui.indexOf('"data-testid":"previs-render"')<make&&make<draft&&draft<earlier&&earlier<compare&&compare<step_ui.indexOf("notice&&E("));
  // no confirmation step and no tick box before using a draft: the image before it always stays in the versions.
  // The one question the section asks is before a draft is deleted for good (owner 2026-11-16).
  assert.ok(!step_ui.includes('type:"checkbox"')&&(step_ui.match(/window\.appConfirm\(\{title:"Delete this draft\?"/g)||[]).length===2&&(step_ui.match(/appConfirm\(/g)||[]).length===3
    // (2026-11-16) the third question is Dress the whole place: several writing calls, asked first with the total
    &&step_ui.includes('await window.appConfirm({title:todo.length===1?"Dress "+names[0]+"?":"Dress these "+todo.length+" spaces?",'));
  assert.ok(!step_ui.includes('"Discard"')&&step_ui.includes("await P.remove(target,d.meta.iso);")&&step_ui.includes("setReview(null);\n    const theirs="),"the comparison closes before the question is asked");
  assert.ok(read("app/blender-preview.css").includes(".loc-style-dialog{margin:auto}")&&read("app/blender-preview.css").includes(".loc-style-dialog .loc-cloud-render-actions{margin-top:14px}"));
  // ONE RULE, in the same words everywhere: the draft must still match the set and the look it was made from
  const api=read("app/set-previs.js");
  assert.ok(api.includes('const OUT_OF_DATE="This draft is out of date: the floor plan, the cameras, the dressing or the description changed after it was made. Make a new one.";'));
  assert.ok(step_ui.includes("const stale=d=>!nowKeys||d.meta.setKey!==nowKeys.setKey||d.meta.lookKey!==nowKeys.lookKey;")&&step_ui.includes("P.OUT_OF_DATE"));
  assert.ok(api.includes("if(now.setKey!==saved.meta.setKey||now.lookKey!==saved.meta.lookKey)throw new Error(OUT_OF_DATE);"));
  assert.ok(!/expected/.test(api.slice(api.indexOf("async function use("),api.indexOf("// DISCARD:"))),"using a draft never depends on what the location image is today");
  // deleting is only ever a draft's own file, inside remove(), which the card calls after asking (owner 2026-11-16)
  const removal=api.slice(api.indexOf("  async function remove(id,iso){"),api.indexOf("  // An earlier draft becomes the current one again;"));
  assert.ok(removal.includes("root.nbDeleteHistoryEntry(slot(id),index)")&&removal.includes("root.nbDeleteCurrentAndPromoteAsset(slot(id))")&&removal.includes("root.nbClearAsset(slot(id))"));
  assert.ok(!/nbClearAsset|nbDeleteHistoryEntry|nbDeleteCurrentAndPromoteAsset/.test(api.replace(removal,"")),"nothing else in Previs deletes, and never anything but a draft's own slot");
  // three boxed subsections, like every other section of the card (and two more on the whole-place view: the place
  // from above, and Dress the whole place, 2026-11-16)
  assert.equal((step_ui.match(/className:"loc-sub/g)||[]).length,5);
  // 2026-11-16: the engine is picked in the section, what the step does sits behind the (i) beside its heading, and a
  // place with rooms shows the whole place and each room in the same section
  for(const t of ['"data-testid":"previs-engine"','E("span",null,"Image engine")','label:"About making the image"','"data-testid":"previs-undressed-hint"',
      '"data-testid":"previs-spaces"','"data-testid":"previs-overview"','"data-testid":"previs-set-cameras"','"Set 4 clear cameras (free)"','"Whole place"','"Turn the view"',
      'window.LocationPrevisPlace=LocationPrevisPlace;','asRoom:true'])
    assert.ok(step_ui.includes(t),t);
  assert.ok(!step_ui.slice(0,step_ui.indexOf("function LocationPrevisOverview(")).includes("chosen in the top bar"),"the location image's engine is no longer only the top bar's");
  assert.ok(!/Three\.?js|Blender|WebGL/i.test(step_ui.replace(/\/\*[\s\S]*?\*\//g,"").replace(/BlenderPreview/g,"")),"the library is never named on the card");
  // Frances knows it; the page loads it; the styles are in
  const ai=read("app/ai.jsx"),html=read("TURN.html");
  assert.ok(ai.includes('name:"Previs (the set in 3D on a location card)"')&&ai.includes("DRESS THE SET")&&ai.includes("MAKE THE LOCATION IMAGE")&&ai.includes("THE RESULT IS A DRAFT")&&ai.includes("ONE RULE FOR USING A DRAFT"));
  for(const f of ["set-previs.js","set-previs-ui.jsx","locations-ui.jsx","locations.jsx","ai.jsx"])
    assert.ok(["20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its cache key");
  assert.ok(html.indexOf("app/set-previs.js")>html.indexOf("app/camera-angle-preview.js")&&html.indexOf("app/set-dressing.js")>html.indexOf("app/blender-render.js"));
  assert.ok(css.includes(".previs-sheet{aspect-ratio:16/9;")&&read("app/blender-preview.css").includes(".style-draft-thumb{"));
});

test("16 one road and plainer names: what left the card, what was folded away, and what Frances says", ()=>{
  // owner 2026-11-15: "we have previs and then we have build the set, which looks to me like it's doing the same thing";
  // then, to the nine listed changes: "1. yes, and remove Blender" … "8. yes"
  // written view notes: offered only where no 3D camera frames the views (a card with no floor plan of its own)
  assert.ok(sheet.includes("!(spatialState.ready&&ownRoom)&&React.createElement(CoverageViewsEditor,{l,views:coverageViews,onUpdateView:updateCoverageView,"));
  // a floor-plan object's three source fields are one closed line under the fields that place it; the same saved values
  const anchors=ui.slice(ui.indexOf('"Objects & placements · "+plan.anchors.length'),ui.indexOf('"Add fixed anchor"'));
  assert.ok(anchors.includes('React.createElement("details",{className:"loc-nested-section loc-anchor-source","data-testid":"anchor-source"},'));
  const source=anchors.slice(anchors.indexOf('"data-testid":"anchor-source"'));
  for(const t of ['anchorChange(a.id,{basis:e.target.value})','anchorChange(a.id,{evidence:value})','anchorChange(a.id,{posBasis:v})','"Where this came from \\u00b7 "'])assert.ok(source.includes(t),t);
  for(const old of ['"Evidence basis"','"Supporting panels / evidence"','"Position basis"'])assert.ok(!ui.includes(old),old+" is renamed and folded");
  assert.ok(anchors.indexOf('label:"Floor plan position"')<anchors.indexOf('"data-testid":"anchor-source"'),"placement first, where it came from after");
  // names
  assert.ok(ui.includes('"The four cameras \\u00b7 where each view is taken from"')&&!ui.includes('"Plate cameras \\u00b7 where each panel is shot from"'));
  // the plans' cards no longer add a cloud-sets line; the build's server side and its unmounted components are untouched
  assert.ok(!read("app/plans.jsx").includes('list.push("Cloud sets'));
  assert.ok(read("app/blender-render-ui.jsx").includes("function LocationCloudRender(")&&read("app/blender-style.js").includes("root.KinolotSetStyle="),"kept in their files, unmounted");
  // Frances: no step the card does not have
  const names=Array.from(ai.matchAll(/APP_FEATURES\.push\(\{ name:"([^"]+)"/g)).map(m=>m[1]);
  assert.ok(names.includes("Location floor plan, cameras and 3D set (Locations)")&&!names.includes("Build the set (Locations)")&&!names.includes("Detailed cloud sets")&&!names.includes("Location build storage"));
  assert.ok(!/5 (·|\\u00b7) Build the set|6 (·|\\u00b7) Style it|Build in Blender button in the card|Compare with Blender|one build costs 15 credits/.test(ai));
  assert.ok(ai.includes("a location card no longer has the steps Build the set and Style it")&&ai.includes("IT IS THE CARD'S ONE ROAD FROM THE SET TO ITS IMAGE (owner 2026-11-15)"));
  assert.ok(ai.includes("under The look, in the card's Location image section")&&ai.includes("THE FOUR CAMERAS (called 'Plate cameras' until 2026-11-15)"));
});

test("17 variants from the location image: one of its views at another hour, the one road to a variant's image; no Blender left on a shot card", ()=>{
  // owner 2026-11-16: "variants should be deriving from already generated location image ... the image a user chooses"
  const step_ui=read("app/set-previs-ui.jsx"),api=read("app/set-previs.js");
  for(const t of ['function LocationPrevisVariant({location:l,variantKey,asset,label,time,notes,meta,readOnly=false}){','"data-testid":"previs-variant"',
      '"Make this variant from the location image"','"Use as this variant\\u2019s image"','"Compare with the location image"','"Delete"','"Delete this draft"','"Make this the current draft"',
      'E("span",null,"View")','P.variantSource(l.id,camera)','"data-testid":"previs-variant-not-ready"','"Choose the location image first."','"Go to 4 \\u00b7 Previs"','window.LocationPrevisVariant=LocationPrevisVariant;'])
    assert.ok(step_ui.includes(t),t);
  const variant=step_ui.slice(step_ui.indexOf("function LocationPrevisVariant("));
  assert.ok(!/P\.scene\(|P\.sheet\(|From the 3D set|3D frame/.test(variant),"a variant draws nothing from the 3D set");
  // ONE ROAD (owner 2026-11-16: "Remove the older Generate image on variants"): neither kind of variant card has a
  // Generate button, a reference strip or a Regenerate; the frame keeps drop-your-own, Edit and the versions
  const cardOf=name=>{const i=ui.indexOf("function "+name+"(");return ui.slice(i,ui.indexOf("\nfunction ",i+10));};
  for(const name of ["LocationVariant","SluglineUnitCard"]){
    const card=cardOf(name);
    assert.ok(card.includes("noGenerate:true }),")&&card.includes("dropToImport:true,")&&card.includes("variant:true }));"),name);
    assert.ok(!/referenceControls|generateRefs|generateDisabled|refPreview|canGenerate|onRegenerate|CoverageReferenceStrip/.test(card),name+" has no Generate left");
    assert.ok(card.includes("window.LocationPrevisVariant"),name);
  }
  const frame=read("app/artroom.jsx");
  assert.ok(frame.includes("draftNote, noGenerate=false }){")&&frame.includes('(!noGenerate || gening || gen.pendingSave) && React.createElement("div",{className:"sheet-gen-row"},'));
  assert.ok(ui.includes("onRegenerate, variant=false }){")&&ui.includes('(variant ? ". Make a new draft from the location image below, or keep this one." : " \u2014 regenerate?")')
    &&ui.includes('!variant && React.createElement("button",{type:"button",className:"art-draftall",'));
  // the box is open while the variant has no image yet
  assert.ok(step_ui.includes('window.nbLoadDetailsAsset(asset,"")).then(saved=>{if(live&&!touched.current&&!(saved&&saved.url))setOpen(true);},()=>{});')
    &&step_ui.includes('E("summary",{onClick:()=>{touched.current=true;}},"Make this variant\\u2019s image"),'));
  // nothing is read for a variant until its fold is opened
  assert.ok(variant.includes("    if(!open)return;\n    let live=true;setError(\"\");\n    P.variantSource(l.id,camera)")&&variant.includes("open&&E(React.Fragment,null,"));
  // both kinds of variant carry it, each with its time and notes and what its own Generate records
  assert.ok(ui.includes('React.createElement(window.LocationPrevisVariant,{ location:l, variantKey:u.key, asset:imgId,')&&ui.includes("notes:()=> previsVariantNotes({ side:role, name:u.name||l.name, time:u.time, state:u.appearance||u.environment }),")
    &&ui.includes('meta:()=> previsVariantMeta(l, "slugline-unit", u.scriptText, {sceneNos:u.sceneNos}) }),'));
  assert.ok(ui.includes('React.createElement(window.LocationPrevisVariant,{ location:l, variantKey:"state:"+v.id, asset:id,')&&ui.includes('previsVariantMeta(l, stateUnit?"slugline-unit":"continuity-state", stateUnit?stateUnit.scriptText:null, null)'));
  assert.equal(box.previsVariantNotes({side:"ext",name:"Ellis House",time:"Night",state:"Rain,  street lamps on"}),"EXT. Ellis House. Time: Night. Light, weather and state: Rain, street lamps on.");
  assert.equal(box.previsVariantNotes({name:"Hall",time:"Dawn"}),"Hall. Time: Dawn.");
  assert.ok(ui.includes("function previsVariantMeta(l, kind, scriptText, drawn){")&&ui.includes("locationAssetDependencySnapshot(l.id, locationRootIds(l), kind)"));
  // the source is the location image: one view cut out of a four-view sheet, or the whole image
  assert.ok(api.includes("async function variantSource(locationId,camera){")&&api.includes("root.cropRegionAsDataUrl(data,info.crop,1536,1024)")&&api.includes("Redraw EXACTLY this picture at another hour or in another state."));
  assert.ok(api.includes('"-var-"+slug(t.variant.key)')&&api.includes("return t.variant?t.variant.asset:")&&!/lightFor|framePrompt/.test(api));
  // the shot card has no Blender section any more (owner 2026-11-16: "that should go too")
  const shots=read("app/shots-ui.jsx").replace(/\/\/[^\n]*/g,"");
  assert.ok(!/More tools|BlenderPreviewPanel|BlenderStudioLaunch|Open this shot in Blender/.test(shots),"no Blender on a shot card");
  assert.ok(!read("app/chrome.jsx").includes('"aria-label":"Blender Studio"'));
  // Frances knows
  assert.ok(ai.includes("VARIANTS FROM THE LOCATION IMAGE (2026-11-16)")&&ai.includes("has ONE road to its image: the box 'Make this variant's image' under its frame")&&ai.includes("no 'Generate image' button and no Reference images strip any more")&&ai.includes("A variant's image is one frame, as before, never a grid.")&&!ai.includes("VARIANTS FROM THE 3D SET")&&ai.includes("BLENDER IS NOT OFFERED IN THE APP AT PRESENT"));
  for(const f of ["set-previs.js","set-previs-ui.jsx","locations-ui.jsx","shots-ui.jsx","ai.jsx"])
    assert.ok(["20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f+" has its cache key");
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

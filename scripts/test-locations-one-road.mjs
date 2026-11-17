/* THE LOCATIONS TAB, ONE ROAD (owner 2026-11-17: "yes, go ahead with all of them in that order"). Nine changes:
   added   Prepare this place (one run per place, asked first with the price), the Show list (where each place stands,
           the most used first), the batch buttons saying their road and price;
   removed the Generate button at the top of a card (the quick image lives in 5 . Location image), two of the three
           progress displays (the tracker stays), the word "plate" in what users read, the "53 rooms" label for 53
           variants, a prompt section that showed only the quick image's specification, and extra spaces on a place
           with a confirmed floor plan (one that has an image stays). No model call here. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log("PASS "+name);}catch(e){failed++;console.log("FAIL "+name+"\n    "+String(e&&e.stack||e).split("\n").join("\n    "));}}
const copy=v=>JSON.parse(JSON.stringify(v));

function harness(){
  const box={console,location:{hostname:"localhost"},nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[],nbEpoch:()=>1};
  box.window=box;vm.createContext(box);
  vm.runInContext(read("app/locations.jsx"),box,{filename:"app/locations.jsx"});
  return box;
}
const ui=read("app/locations-ui.jsx");
const part=(from,to)=>{const a=ui.indexOf(from);assert.ok(a>=0,"missing: "+from);const b=ui.indexOf(to,a+from.length);assert.ok(b>a,"missing after it: "+to);return ui.slice(a,b);};
const sheet=part("function LocationSheet({","function LocationPromptSection(");
const tab=part("function LocationSheets({","window.LocationSheets = LocationSheets;");
const prepare=part("function LocationPreparePlace({","window.LocationPreparePlace=LocationPreparePlace;");

await test("1 Prepare this place, first half: the description when it is missing, then the floor plan with every room",()=>{
  const box=harness();
  const bare=copy(box.locationPreparePlan({id:"house",name:"Ellis House",rooms:3,drafted:false,planReady:false,planEmpty:true}));
  assert.equal(bare.stage,"plan");
  assert.deepEqual(bare.steps.map(s=>s.kind),["describe","plan"]);
  assert.equal(bare.steps[0].text,"Write the description of Ellis House (a writing call)");
  assert.equal(bare.steps[1].text,"Draft the floor plan, with its 3 rooms (a writing call)");
  assert.equal(bare.total,0,"the first half is writing charged by length: no figure is invented for it");
  const described=copy(box.locationPreparePlan({id:"cab",name:"Minicab",rooms:0,drafted:true,planReady:false,planEmpty:true}));
  assert.deepEqual(described.steps.map(s=>s.text),["Draft the floor plan (a writing call)"]);
  assert.equal(copy(box.locationPreparePlan({id:"h",name:"H",rooms:1,drafted:true,planReady:false,planEmpty:true})).steps[0].text,"Draft the floor plan, with its 1 room (a writing call)");
});

await test("2 a floor plan is confirmed by a person: while one waits, or is being drafted, the run only points to it",()=>{
  const box=harness();
  const pending=box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:false,planEmpty:true,planPending:true});
  assert.equal(pending.stage,"review");assert.equal(pending.steps.length,0);assert.match(pending.text,/Check it in 2 · Floor plan and confirm it/);
  // a saved plan that is not confirmed is never drafted over: it waits for the check
  const unconfirmed=box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:false,planEmpty:false});
  assert.equal(unconfirmed.stage,"review");assert.equal(unconfirmed.steps.length,0);assert.match(unconfirmed.text,/waiting for your check/);
  // a confirmed plan that cannot be drawn yet: said, with the plan's own reason
  const blocked=box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,planIssue:"The hallway has no ceiling height."});
  assert.equal(blocked.stage,"blocked");assert.equal(blocked.text,"The hallway has no ceiling height.");assert.equal(blocked.steps.length,0);
});

await test("3 second half: cameras (free), dressing (an estimate), the place's first image as a draft, with the total",()=>{
  const box=harness();
  const plan=copy(box.locationPreparePlan({id:"house",name:"Ellis House",rooms:2,drafted:true,planReady:true,hasImage:false,
    lacking:[{id:"hall",name:"Hallway"}],undressed:[{id:"house",name:"Ellis House",credits:9},{id:"hall",name:"Hallway",credits:7}],
    imageCredits:14,roomImageCredits:16,roomsToDraw:[{id:"hall",name:"Hallway"}]}));
  assert.equal(plan.stage,"set");
  assert.deepEqual(plan.steps.map(s=>s.kind),["cameras","dress","image"]);
  assert.equal(plan.steps[0].text,"Set the cameras of Hallway (free)");
  assert.equal(plan.steps[1].text,"Dress Ellis House, Hallway (about 16 writing credits)");
  assert.equal(plan.steps[2].text,"Make the first image of Ellis House, as a draft (14 image credits)");
  // the place first: no room is drawn before the place has its image (a room takes its look from it)
  assert.deepEqual(plan.steps[2].ids,["house"]);
  assert.deepEqual([plan.writing,plan.image,plan.total],[16,14,30]);
  // an estimate that could not be made is not shown as a number
  const noPrice=copy(box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,undressed:[{id:"h",name:"H",credits:0}],imageCredits:0}));
  assert.equal(noPrice.steps[0].text,"Dress H (writing credits)");assert.equal(noPrice.steps[1].text,"Make the first image of H, as a draft (image credits)");
});

await test("4 a draft that waits is the user's turn: the run makes no second one, and says where it is",()=>{
  const box=harness();
  const waits=copy(box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,hasImage:false,hasDraft:true,lacking:[],undressed:[],imageCredits:14}));
  assert.equal(waits.stage,"done");assert.equal(waits.waitingDraft,true);
  assert.equal(waits.text,"A draft of the image is waiting in 4 · Previs. Use it as the location image, or delete it.");
  // other work is still done, without a second image
  const dress=copy(box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,hasImage:false,hasDraft:true,undressed:[{id:"k",name:"Kitchen",credits:6}],imageCredits:14}));
  assert.deepEqual(dress.steps.map(s=>s.kind),["dress"]);assert.equal(dress.image,0);assert.equal(dress.total,6);
  // not known yet whether the place has an image (the film's images are still arriving): no image is offered
  assert.equal(copy(box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,hasImage:false,imageKnown:false,imageCredits:14,roomsToDraw:[{id:"r",name:"R"}]})).stage,"done");
  // a place with no outline of its own on the plan has no image to make from the set
  assert.equal(copy(box.locationPreparePlan({id:"h",name:"H",drafted:true,planReady:true,hasImage:false,onPlan:false,imageCredits:14})).stage,"done");
});

await test("5 once the place has its image: a draft for each room that has none, and nothing when all is made",()=>{
  const box=harness();
  const rooms=copy(box.locationPreparePlan({id:"house",name:"Ellis House",rooms:2,drafted:true,planReady:true,hasImage:true,lacking:[],undressed:[],
    imageCredits:14,roomImageCredits:16,roomsToDraw:[{id:"hall",name:"Hallway"},{id:"kit",name:"Kitchen"}]}));
  assert.equal(rooms.stage,"set");
  assert.equal(rooms.steps[0].text,"Make an image draft for Hallway, Kitchen (32 image credits)");
  assert.deepEqual(rooms.steps[0].targets.map(t=>t.id),["hall","kit"]);assert.equal(rooms.total,32);
  const done=copy(box.locationPreparePlan({id:"house",name:"Ellis House",drafted:true,planReady:true,hasImage:true,lacking:[],undressed:[],roomsToDraw:[]}));
  assert.equal(done.stage,"done");assert.equal(done.text,"");assert.equal(done.waitingDraft,false);
});

await test("6 the run on the card: asks first every time, saves each result, and never chooses an image for the user",()=>{
  // on the place's own card, under the tracker
  assert.match(sheet,/React\.createElement\(LocationStepGuide,\{l,steps:cardSteps\}\),\s*\/\/[^\n]*\n\s*showPrevis&&React\.createElement\(LocationPreparePlace,\{l,rooms:roomLocations,project,drafted,spatialState,hasImage:!!gen\.genUrl,onDraft,onUpdate,readOnly\}\)/);
  assert.match(prepare,/if\(readOnly\|\|l\.parentLocation\|\|!api\|\|!D\|\|!P\|\|typeof locationPreparePlan!=="function"\)return null;/);
  // each half starts only on a yes
  assert.match(prepare,/const ok=await ask\(\{title:"Prepare "\+name\+"\?",[\s\S]{0,700}?if\(ok\)await runPlan\(plan\.steps\);/);
  assert.match(prepare,/items:exact\.steps\.map\(s=>s\.text\),confirmLabel:"Start",cancelLabel:"Not now"\}\);\s*if\(ok\)await runSet\(exact\);/);
  assert.equal((prepare.match(/runPlan\(/g)||[]).length,2,"runPlan: defined once, called once");
  assert.equal((prepare.match(/runSet\(/g)||[]).length,2,"runSet: defined once, called once");
  // the price shown is the exact one: drafts already waiting are read from the film before the question
  assert.match(prepare,/const d=await P\.drafts\(id\);drafts\[id\]=!!\(d&&d\.current\);/);
  assert.match(prepare,/const exact=locationPreparePlan\(gather\(drafts\)\);/);
  // ...and so are the film's images: an image is offered only where one is known to be missing
  assert.match(prepare,/try\{if\(typeof window\.nbPrefetchAll==="function"\)await window\.nbPrefetchAll\(\);\}catch\(_\)\{\}\s*const known=gather\(\)/);
  assert.match(prepare,/f\.hasImage=!!hasImage\|\|got\(l\.id\);f\.imageKnown=f\.hasImage\|\|lacksImage\(l\.id\);/);
  assert.match(prepare,/f\.roomsToDraw=cards\.filter\(c=>c\.id!==l\.id&&!borrows\(c\)&&lacksImage\(c\.id\)&&!\(drafts&&drafts\[c\.id\]\)\)/);
  // saved as made; a draft is never used by the run
  assert.match(prepare,/onUpdate\(card\.id,\{previs:D\.pack\(r\.dressing,\{engine:D\.MODEL\}\)\}\);/);
  assert.match(prepare,/fitted\.forEach\(r=>onUpdate\(r\.id,\{coverageViews:r\.views\},\{kind:"suggested-cameras"\}\)\);/);
  assert.match(prepare,/await P\.render\(t\.id,\{project,location:card,settings:choice\}\);/);
  assert.ok(!/P\.use\(/.test(prepare),"the run never uses a draft: the user does");
  assert.ok(!/P\.remove\(|P\.discard\(/.test(prepare),"the run deletes nothing");
  // it stops between two steps, and on a change of film
  assert.match(prepare,/if\(epochNow\(\)!==epoch\|\|!writable\(\)\)throw new Error\("The open film changed\. Nothing more was saved\."\)/);
  assert.match(prepare,/"Stop after this step"/);
  // the floor plan is drafted by the place's own editor, as a draft to review: the run never confirms it
  assert.match(prepare,/requests\.set\(l\.id,Date\.now\(\)\);/);
  assert.ok(!/spatialPlan/.test(prepare),"the run writes no floor plan");
  const editor=part("function LocationSpatialPlanEditor({","const fitPlaceCameras=");
  assert.match(editor,/if\(!requests\|\|l\.id!==owner\.id\|\|!requests\.has\(owner\.id\)\)return;\s*requests\.delete\(owner\.id\);/);
  assert.match(editor,/if\(shown\.readOnly\|\|shown\.busy\|\|shown\.candidate\)return;/);
  assert.match(editor,/window\.addEventListener\("kinolot-draft-floor-plan",asked\)/);
});

await test("7 the top of a card shows the image; the quick image is made in 5 . Location image",()=>{
  const head=part("    React.createElement(SheetFrame,{ gen:genPlate, slotId:\"locref-\"+l.id,","deleteLabel:\"Delete location\" }),");
  assert.match(head,/noun:"location image", noGenerate:true,/);
  for(const gone of ["generateDisabled","generateDisabledLabel","onResolveGenerationBlock","referenceControls","generateRefs","Edit a panel","specGate"])
    assert.ok(!head.includes(gone),"left the head of the card: "+gone);
  assert.match(head,/label:"Same place as\\u2026"/);
  assert.ok(!sheet.includes("Start at 1 \\u00b7 The Space"),"the bar under the image is gone");
  // the quick image: its own block, the reference strip with it, what stops it said in words with the way there
  const quick=part("\"data-testid\":\"loc-quick-image\"","// EDIT ONE VIEW");
  assert.match(quick,/"Quick image from the description"/);
  assert.match(quick,/React\.createElement\(CoverageReferenceStrip,\{ refs:masterRefs, excludedIds:masterRefOff, onToggle:toggleMasterRef, onView \}\)/);
  assert.match(quick,/onClick:\(\)=>\{ if\(!gen\.gening&&!gen\.pendingSave\) genPlate\.generate\(\); \}/);
  assert.match(quick,/gen\.genUrl\?"Make a new quick image":"Make a quick image"/);
  assert.match(quick,/window\.nbCostChip\(1, masterGenerateRefs!=null \? \{ refs:Number\(masterGenerateRefs\)\|\|0 \} : undefined\)/);
  assert.match(sheet,/const quickBlock=!drafted\?\{text:"Describe the place first, in 1 \\u00b7 The Space\./);
  assert.match(sheet,/:!spatialState\.ready\?\{text:"Check the floor plan and confirm it first, in 2 \\u00b7 Floor plan\.",go:reviewLayout/);
  assert.match(sheet,/\{text:"Make the image of "\+\(l\.parentLocation\.name\|\|"the whole place"\)\+" first: this room is matched to it\."\}/);
  // one view of the image is edited from the same section
  assert.match(sheet,/"data-testid":"loc-edit-one-view"/);assert.match(sheet,/panelEdit\?"Close the view edit":"Edit one view\\u2026"/);
  assert.ok(sheet.indexOf("className:\"sheet-edit-panel loc-panel-edit\"")>sheet.indexOf("\"data-testid\":\"loc-edit-one-view\""),"the view edit box opens in the section");
  // the steps' words no longer send anyone to the top of the card
  assert.ok(!/top of the card/.test(part("function locationCardSteps(","function LocationStepGuide(")));
  assert.match(ui,/:"Open 5 \\u00b7 Location image and make a quick image from the description\."\}\];/);
  const box=harness();vm.runInContext(part("function locationImageStepNote(","function locationSectionNumbers("),box);
  assert.match(box.locationImageStepNote({previs:true}),/^The finished image of this place, shown at the top of the card\. Make it in 4 · Previs/);
  assert.match(box.locationImageStepNote({previs:true}),/A quick image, from the description alone, can be made below\./);
  assert.ok(!/Generate at the top/.test(box.locationImageStepNote({previs:false})));
});

await test("8 one progress display: the tracker; the folds say facts, not the tracker's words again",()=>{
  const guide=part("function LocationStepGuide({l,steps}){","/* Camera-relative composition");
  assert.ok(!/loc-steps-next|"Go"|LocationHelpPopover|Every step is done/.test(guide),"the Next ... Go row is gone");
  assert.match(guide,/E\("ol",\{className:"loc-steps-list","aria-label":"Steps for this location"\}/);
  assert.match(guide,/"aria-current":st\.next\?"step":undefined/);
  assert.match(guide,/to=st\.key==="image"&&st\.goTo\?st\.goTo:n;/);
  assert.ok(!/stepCount/.test(sheet),"no fold repeats done / next / optional");
  assert.ok(!/layout needs review|drafts on first render/.test(sheet));
  assert.match(sheet,/count:\(outsideRooms\.length\?outsideRooms\.length\+\(outsideRooms\.length===1\?" room to add":" rooms to add"\):""\)\|\|\(locStaged&&/);
  assert.match(read("app/styles.css"),/\.loc-steps > \.loc-steps-list:first-child\{margin-top:0\}/);
});

await test("9 the Show list: where each place stands, the most used first; the count says what it counts",()=>{
  const box=harness();
  assert.equal(box.locationPlaceStatus({planReady:false,hasImage:false}),"plan");
  assert.equal(box.locationPlaceStatus({planReady:true,hasImage:false}),"image");
  assert.equal(box.locationPlaceStatus({planReady:true,hasImage:true}),"done");
  assert.equal(box.locationPlaceStatus({planReady:false,hasImage:true}),"done","an uploaded image counts: the place has its image");
  for(const option of ['{value:""},"All places \\u00b7 story order"','{value:"busy"},"All places \\u00b7 most scenes first"','{value:"plan"},"Needs its floor plan ("+statusCount("plan")+")"',
    '{value:"image"},"Needs its image ("+statusCount("image")+")"','{value:"done"},"Has its image ("+statusCount("done")+")"'])
    assert.ok(tab.includes("React.createElement(\"option\","+option+")"),"missing option "+option);
  assert.match(tab,/if\(showFilter==="plan"\|\|showFilter==="image"\|\|showFilter==="done"\) shownGroups=shownGroups\.filter\(g=>placeStatus\[g\.root\.id\]===showFilter\|\|inBatch\(g\)\);/);
  // the most used first, story order kept among equals; story order untouched while nothing is chosen
  assert.match(tab,/if\(showFilter\) shownGroups=shownGroups\.map\(\(g,i\)=>\(\{g,i\}\)\)\.sort\(\(a,b\)=>\(\(b\.g\.root\.scenes\|\|\[\]\)\.length-\(a\.g\.root\.scenes\|\|\[\]\)\.length\)\|\|\(a\.i-b\.i\)\)\.map\(x=>x\.g\);/);
  // a batch reaches every card: the list is cleared with the scene and the search
  assert.match(tab,/if\(query\) setQuery\(""\);\s*if\(showFilter\) setShowFilter\(""\);/);
  assert.match(tab,/setSceneFilter\(""\); setQuery\(""\); setShowFilter\(""\); \}\},"Show all locations"/);
  // 34 places . 13 rooms . 53 variants (it read "34 . 53 rooms")
  assert.match(tab,/const roomCardN = Math\.max\(0, list\.length-groups\.length\);\s*const variantN = \(sluglineUnits\|\|\[\]\)\.filter\(u=>u && !u\.orphan\)\.length;/);
  assert.match(tab,/groups\.length\+\(roomCardN \? " \\u00b7 "\+roomCardN\+" room"\+\(roomCardN!==1\?"s":""\) : ""\)\s*\+\(variantN \? " \\u00b7 "\+variantN\+" variant"\+\(variantN!==1\?"s":""\) : ""\)/);
  assert.ok(!/\(sluglineUnits\|\|\[\]\)\.length\+" rooms"/.test(tab));
  // the bar has one more cell: the scene list gives up its 260px minimum so that it stays inside its own
  assert.match(read("app/styles.css"),/\.loc-slate \.prop-scenebar-select\{min-width:0\}/);
  assert.match(tab,/\(showFilter && !q\) \? "No place is at this point" : "No matching locations"/);
});

await test("10 the batch buttons say their road (quick images, from the description) and show their price",()=>{
  assert.match(tab,/\("Quick images \\u00b7 "\+missingAll\.length\+" missing"\),\s*batchChip\(missingAll\.map\(id=>plateRefsOf\(byLocId\[id\], missingAll\)\)\)/);
  assert.match(tab,/"Redo quick images\\u2026",\s*!batchActiveId && batchChip\(redoAllIds\.map\(id=>plateRefsOf\(byLocId\[id\], redoAllIds\)\)\)/);
  assert.match(tab,/from its description alone, without the 3D set\. For an image that keeps to the floor plan and its cameras, use Prepare this place on a card\./);
  assert.match(tab,/\("Quick images \\u00b7 "\+sceneMissingN\+" missing in Scene "/);
  assert.match(tab,/\("Redo Scene "\+String\(sceneNoOf\(sceneFilter\)\)\.padStart\(2,"0"\)\+"'s quick images\\u2026"\)/);
  // a redo says how many images made from the 3D set it would replace, before anything is redone
  assert.match(tab,/const fromPrevisN = \(ids\)=> \(ids\|\|\[\]\)\.filter\(id=>\{ const m = hasImg\(id\) && typeof nbGetMeta==="function" \? nbGetMeta\(id\) : null; return !!\(m && m\.previsDraftIso\); \}\)\.length;/);
  assert.match(tab,/previsWarning\(existing\)\]\.filter\(Boolean\)\.join\(" "\); \},/);
  assert.match(tab,/note:\(missing, existing\)=>previsWarning\(existing\), refsOf:/);
  assert.ok(!/Regenerate plates|missing plate/.test(tab));
});

await test("11 the prompt section shows the prompt that made the image, then what the next image would send",()=>{
  const section=part("function LocationPromptSection({","/* ONE NUMBERED PATH PER LOCATION CARD");
  assert.match(sheet+ui,/React\.createElement\(LocationPromptSection,\{l,project,gen,finalPrompt,builtFrom:promptBuiltFrom,previs:showPrevis&&spatialState\.ready\}\)/);
  assert.match(section,/meta&&meta\.previsDraftIso\?"The image on this card was made in 4 \\u00b7 Previs, from the 3D set\."/);
  assert.match(section,/:used\?"The image on this card was made from the description alone \(a quick image\)\."/);
  assert.match(section,/used&&E\(CopyBox,\{label:"Prompt used for the current image",text:used\}\)/);
  assert.match(section,/next=P\.stylePrompt\(l,project,whole\?\{look:whole\.name\}:null\);/);
  assert.match(section,/E\(CopyBox,\{label:"Next image from 4 \\u00b7 Previs",text:next\}\)/);
  // the order on the page: the one used, the next from Previs, the quick one folded last
  const order=["loc-prompt-how","Prompt used for the current image","Next image from 4","loc-prompt-quick"].map(x=>section.lastIndexOf(x));
  assert.deepEqual(order,order.slice().sort((a,b)=>a-b));
  // the Previs text is what the image call sends with the sheet
  assert.match(read("app/set-previs.js"),/const prompt=options\.prompt\|\|stylePrompt\(location,options\.project,options\.drawn\)\+\(options\.after\|\|""\)/);
});

await test("12 extra spaces: not offered on a place with a confirmed floor plan; one that has an image stays",()=>{
  assert.match(sheet,/const shownExtras=l\.parentLocation\?\[\]:spatialState\.ready\?coverageSheets\.filter\(extraHasImage\):coverageSheets;/);
  assert.match(sheet,/const extraHasImage=v=>\{try\{return typeof nbGetImage==="function"&&!!nbGetImage\(l\.id\+"-"\+v\.id\);\}catch\(_\)\{return false;\}\};/);
  assert.match(sheet,/shownExtras\.length>0&&React\.createElement\("details",\{className:"loc-nested-section","data-testid":"loc-extra-spaces"\}/);
  assert.match(sheet,/spatialState\.ready\?"Extra spaces \\u00b7 images kept \("\+shownExtras\.length\+"\)":"Extra spaces"/);
  // each keeps its place in the order the earlier ones are read in
  assert.match(sheet,/previousSheets:coverageSheets\.slice\(0,coverageSheets\.indexOf\(v\)\)/);
  // nothing saved is dropped: the cards still derive and keep their extra spaces, and clearing still counts them
  assert.match(sheet,/if\(!same\) onUpdate\(l\.id, \{ coverageSheets: merged \}\);/);
  assert.match(sheet,/\.\.\.\(l\.coverageSheets\|\|\[\]\)\.map\(v=>l\.id\+"-"\+v\.id\),/);
  // the list is read again when the film's images arrive (an image not loaded yet must not hide its extra space for good)
  assert.match(sheet,/window\.addEventListener\("nb-prefetched",imagesArrived\)/);
});

await test("13 the word users read is \"image\": no \"plate\" in the Locations tab's own text",()=>{
  // what a model reads keeps its wording: prompts, and the reference notes sent with them
  const model=["A continuity-root plate is binding","Time-of-Day Variant plate","Edit this location reference plate for","Required Space Plate","master plate","Slugline Unit plate for"];
  const hits=[];let block=false;
  ui.split("\n").forEach((line,i)=>{
    const st=line.trim();
    if(block){if(line.includes("*/"))block=false;return;}
    if(st.startsWith("/*")&&!st.includes("*/")){block=true;return;}
    if(st.startsWith("//")||st.startsWith("/*")||st.startsWith("*")||model.some(m=>line.includes(m)))return;
    for(const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g))
      if(m[1].includes(" ")&&/(?<![\w-])plates?(?![\w-])/i.test(m[1]))hits.push((i+1)+": "+m[1].slice(0,90));
  });
  assert.deepEqual(hits,[]);
  const chrome=read("app/chrome.jsx");
  assert.match(chrome,/locations:\["Every place, ","as one set\."\]/);
  assert.match(chrome,/locations:"Reusable sets for every scene, built from the screenplay\. A place and its rooms are one set: the place's image comes first, and its rooms take their look from it\."/);
  // the image's noun on each card, and internal names left alone
  assert.match(ui,/noun:"extra-space image"/);assert.equal((ui.match(/noun:"variant image"/g)||[]).length,2);
  assert.match(read("app/locations.jsx"),/what:"plate", label:"" \}\];/,"an internal key is not a word users read");
  assert.match(read("app/artroom.jsx"),/noun!=="location plate" && noun!=="location image" &&/);
});

await test("14 Frances knows, and the changed files have new cache keys",()=>{
  const ai=read("app/ai.jsx"),a=ai.indexOf("name:\"Locations tab: one road, quick images and Prepare this place\"");
  assert.ok(a>0);
  const entry=ai.slice(a,ai.indexOf("\n",a));
  for(const fact of ["it was called a 'plate' before 2026-11-17","nothing is generated from the top of the card any more","PREPARE THIS PLACE","a floor plan is always confirmed by you, never by the run",
    "the run never chooses for you","'Make a quick image'","'Edit one view\\u2026'","'Quick images \\u00b7 N missing'","'Redo quick images\\u2026'","SHOW:","THE COUNT","'Extra spaces \\u00b7 images kept'","nothing is deleted"])
    assert.ok(entry.includes(fact),"Frances is not told: "+fact);
  assert.ok(!/on one plate/.test(ai));assert.match(ai,/'Every place, as one set\.' for Locations/);
  assert.ok(!ai.includes("generated at the top of the card"));
  const html=read("TURN.html");
  for(const f of ["ai.jsx","script.jsx","locations.jsx","locations-ui.jsx","chrome.jsx","artroom.jsx","app.jsx","shots-ui.jsx","breakdown.jsx","agents.jsx","props.jsx","styles.css"])
    assert.ok(["20261117-oneroad1"].some(k=>html.includes("app/"+f+"?v="+k+"\"")),"cache key of "+f);
});

/* THE RUN ITSELF, on the card's own code, with the writing engine, the camera fit and the image engine as stubs.
   Nothing here spends: every call is counted. */
function runner(opts){
  opts=opts||{};
  const noop=()=>{},calls=[],asked=[],saved=[],events=[];
  const box={console,setTimeout,clearTimeout,localStorage:{getItem:()=>null},Icon:new Proxy({},{get:()=>noop}),
    React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),Fragment:"Fragment",
      useState:i=>[typeof i==="function"?i():i,noop],useRef:i=>({current:i}),useEffect:noop,useReducer:(f,i)=>[i,noop],useMemo:f=>f()},
    addEventListener:noop,removeEventListener:noop,dispatchEvent:e=>{events.push(e.type+(e.detail&&e.detail.locationId?":"+e.detail.locationId:""));return true;},
    CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},document:{createElement:()=>({})},
    scenesInStoryOrder:x=>x||[],renderStyleText:()=>"Photoreal",nbEpoch:()=>opts.epoch?opts.epoch():1,nbGetMeta:()=>null};
  box.window=box;vm.createContext(box);
  vm.runInContext(read("app/locations.jsx"),box,{filename:"app/locations.jsx"});
  vm.runInContext(read("app/locations-ui.jsx"),box,{filename:"app/locations-ui.jsx"});
  const house={id:"house",key:"house",name:"Ellis House",previs:opts.dressed?{v:1}:null,coverageViews:[]};
  const hall={id:"hall",key:"house-hall",name:"Hallway",parentKey:"house",parentLocation:{id:"house",name:"Ellis House"},previs:null,coverageViews:[]};
  box.turnContinuity={locations:[house,hall]};
  const images=new Set(opts.images||[]),drafts=new Set(opts.drafts||[]);
  box.nbGetImage=id=>images.has(id)?"url:"+id:"";
  box.nbImageKnownMissing=id=>!images.has(id);
  box.nbPrefetchAll=async()=>{calls.push("read the film's images");return {ok:true};};
  box.nbImageCostText=()=>"14";
  box.turnArtRoomWritable=()=>true;
  box.appConfirm=async o=>{asked.push(o);return opts.answer!==false;};
  let lacking=opts.lacking===false?[]:[{id:"hall",name:"Hallway"}];
  box.KinolotCloudRender={inputIssueList:()=>[],camerasMissingForPlace:()=>lacking,
    proposeCamerasForPlace:async()=>{calls.push("fit cameras");return lacking.map(r=>({id:r.id,name:r.name,views:[{id:"v-"+r.id}]}));}};
  box.KinolotSetDressing={MODEL:"writer",place:()=>({spaces:[{id:"house"},{id:"hall"}]}),estimate:()=>({credits:8}),
    draft:async card=>{calls.push("dress "+card.id);if(opts.failDress===card.id)throw new Error("The dressing came back empty. Nothing was changed.");return {dressing:{for:card.id},report:{parts:12}};},
    pack:d=>({v:1,of:d.for})};
  box.KinolotPrevis={settings:(e,refs)=>({label:"Test Engine",cost:{refs}}),
    drafts:async id=>{calls.push("read drafts "+id);return {current:drafts.has(id)?{meta:{}}:null,earlier:[]};},
    render:async(id,o)=>{calls.push("image "+id+" as "+(o.location&&o.location.id));return {};},
    use:async()=>{calls.push("USE");},remove:async()=>{calls.push("REMOVE");}};
  const onUpdate=(id,patch,meta)=>{saved.push([id,Object.keys(patch).join(","),meta&&meta.kind||""]);
    box.turnContinuity.locations=box.turnContinuity.locations.map(x=>x.id===id?{...x,...patch}:x);};
  const props={l:house,rooms:[hall],project:{},drafted:true,spatialState:{ready:true,plan:{frame:"f",anchors:[{}]}},hasImage:images.has("house"),
    onDraft:async()=>{calls.push("describe");},onUpdate,readOnly:false,...(opts.props||{})};
  const flat=n=>n&&typeof n==="object"?[n,...(n.children||[]).flatMap(flat)]:[];
  const text=n=>n==null?"":typeof n==="string"||typeof n==="number"?String(n):(n.children||[]).map(text).join("");
  const render=()=>box.LocationPreparePlace(props);
  const press=async()=>{const tree=render(),b=flat(tree).find(n=>n.props&&n.props["data-testid"]==="location-prepare-go");assert.ok(b,"the button is on the card");await b.props.onClick();};
  const state=()=>copy(vm.runInContext("_locPrepareRuns.house||{}",box));
  return {box,calls,asked,saved,events,props,render,press,state,flat,text,drafts,images};
}

await test("15 a run, start to end: asked once with its steps, then cameras, each dressing saved, and one draft of the place",async()=>{
  const r=runner();
  // before the press: the button with the price of what is left, and what it will do
  const before=r.render();
  assert.equal(before.props["data-prepare-stage"],"set");
  assert.equal(r.text(r.flat(before).find(n=>n.props["data-testid"]==="location-prepare-cost")),"30","two dressings at 8 and one image at 14");
  assert.match(r.text(r.flat(before).find(n=>n.props["data-testid"]==="location-prepare-next")),/^Does what is left, in order: set the cameras of Hallway \(free\); dress Ellis House, Hallway \(about 16 writing credits\); make the first image of Ellis House, as a draft \(14 image credits\)\.$/);
  assert.deepEqual(r.calls,[],"looking costs nothing and reads nothing");
  await r.press();
  // asked once, after reading what is already made, with every step and the total
  assert.equal(r.asked.length,1);
  assert.equal(r.asked[0].title,"Prepare Ellis House?");
  assert.deepEqual(copy(r.asked[0].items),["Set the cameras of Hallway (free)","Dress Ellis House, Hallway (about 16 writing credits)","Make the first image of Ellis House, as a draft (14 image credits)"]);
  assert.match(r.asked[0].body,/About 30 credits in all \(the writing part is an estimate: a writing call is charged by its length\)\. Images are made with Test Engine, the engine in the top bar\. An image made here is a draft: nothing becomes the location image until you choose it\./);
  // in order; the place before its rooms; one image, of the place, drawn from the place's own card
  assert.deepEqual(r.calls,["read the film's images","read drafts house","fit cameras","dress house","dress hall","image house as house"]);
  assert.deepEqual(r.saved,[["hall","coverageViews","suggested-cameras"],["house","previs",""],["hall","previs",""]],"each result is saved as it is made");
  assert.ok(!r.calls.includes("USE")&&!r.calls.includes("REMOVE"),"the draft is left for the user to use or delete");
  assert.match(r.state().note,/^Done: cameras set for Hallway; Ellis House dressed \(12 shapes\); Hallway dressed \(12 shapes\); a draft of Ellis House\. Each draft is in 4 · Previs: it becomes the image only when you choose to use it\.$/);
  assert.ok(r.events.includes("nb-open-fold"),"Previs opens on the draft");
});

await test("16 no is no; a draft that waits is not made twice; a failure keeps what was saved; rooms come after the place's image",async()=>{
  // Not now: nothing runs
  const no=runner({answer:false});await no.press();
  assert.equal(no.asked.length,1);assert.deepEqual(no.calls,["read the film's images","read drafts house"],"only the read before the question");assert.deepEqual(no.saved,[]);
  // a draft of the place already waits: the run does the rest and makes no second image
  const waits=runner({drafts:["house"]});await waits.press();
  assert.deepEqual(copy(waits.asked[0].items),["Set the cameras of Hallway (free)","Dress Ellis House, Hallway (about 16 writing credits)"]);
  assert.ok(!waits.calls.some(c=>c.startsWith("image ")));
  // a dressing that fails: what was done is saved and said, and no image is made on a set that is not ready
  const fails=runner({failDress:"hall"});await fails.press();
  assert.deepEqual(fails.saved,[["hall","coverageViews","suggested-cameras"],["house","previs",""]]);
  assert.ok(!fails.calls.some(c=>c.startsWith("image ")));
  assert.equal(fails.state().fail,"Done and saved: cameras set for Hallway; Ellis House dressed (12 shapes). Stopped at dressing Hallway: The dressing came back empty. Nothing was changed.");
  // the film changes under the run: nothing more is saved
  let epoch=1;const moved=runner({epoch:()=>epoch});
  moved.box.KinolotSetDressing.draft=async card=>{moved.calls.push("dress "+card.id);epoch=2;return {dressing:{for:card.id},report:{parts:3}};};
  await moved.press();
  assert.deepEqual(moved.saved,[["hall","coverageViews","suggested-cameras"]]);assert.match(moved.state().fail,/The open film changed\. Nothing more was saved\.$/);
  // the place has its image, everything is dressed and has cameras: a draft for the room that has none, with the place's look
  const rooms=runner({images:["house"],lacking:false,dressed:true});
  rooms.box.turnContinuity.locations=rooms.box.turnContinuity.locations.map(x=>({...x,previs:{v:1}}));rooms.props.rooms=[{...rooms.props.rooms[0],previs:{v:1}}];
  await rooms.press();
  assert.deepEqual(copy(rooms.asked[0].items),["Make an image draft for Hallway (14 image credits)"]);
  assert.deepEqual(rooms.calls,["read the film's images","read drafts hall","image hall as hall"]);
  // ...and a room that has its image, or whose draft waits, is left alone: nothing to do, no button
  const all=runner({images:["house","hall"],lacking:false,dressed:true});
  all.box.turnContinuity.locations=all.box.turnContinuity.locations.map(x=>({...x,previs:{v:1}}));all.props.rooms=[{...all.props.rooms[0],previs:{v:1}}];
  assert.equal(all.render(),null);
});

await test("17 the first half: the description when missing, then the floor plan asked of the place's own editor; a room's card has no run",async()=>{
  const r=runner({props:{drafted:false,spatialState:{ready:false,plan:{frame:"",anchors:[],sightlines:"",unresolved:""}}}});
  r.props.onDraft=async l=>{r.calls.push("describe "+l.id);r.box.turnContinuity.locations=r.box.turnContinuity.locations.map(x=>x.id===l.id?{...x,architecture:"A terraced house.",materials:"Brick.",lighting:"Sash windows."}:x);};
  r.box.locVisualsDrafted=c=>!!(c&&c.architecture);
  assert.equal(r.render().props["data-prepare-stage"],"plan");
  await r.press();
  assert.equal(r.asked.length,1);
  assert.deepEqual(copy(r.asked[0].items),["Write the description of Ellis House (a writing call)","Draft the floor plan, with its 1 room (a writing call)"]);
  assert.match(r.asked[0].body,/no image is made yet\. You then check the floor plan and confirm it\./);
  assert.deepEqual(r.calls,["describe house"],"no camera, dressing or image before the plan is confirmed");
  assert.deepEqual(r.saved,[],"the run saves no floor plan: the editor shows a draft to review");
  assert.ok(r.box.KinolotFloorPlanDraftRequests.has("house"));
  assert.ok(r.events.includes("kinolot-draft-floor-plan:house")&&r.events.includes("nb-open-fold"));
  assert.match(r.state().note,/^The floor plan is being drafted in 2 · Floor plan\. Check it there and confirm it\./);
  // a description that did not come: the floor plan is not asked for
  const bad=runner({props:{drafted:false,spatialState:{ready:false,plan:{}}}});bad.box.locVisualsDrafted=()=>false;
  const realSettle=bad.box.setTimeout;bad.box.Date={now:(()=>{let t=0;return ()=>(t+=4000);})()};
  await bad.press();
  assert.equal(bad.state().fail,"The description could not be written. Nothing else was started.");
  assert.ok(!bad.box.KinolotFloorPlanDraftRequests||!bad.box.KinolotFloorPlanDraftRequests.has("house"));
  // a plan that waits for its check: the button only opens it
  const review=runner({props:{spatialState:{ready:false,plan:{frame:"Facing the door.",anchors:[{}]}}}});
  const tree=review.render();assert.equal(tree.props["data-prepare-stage"],"review");
  assert.equal(review.text(review.flat(tree).find(n=>n.props["data-testid"]==="location-prepare-go")),"Open 2 · Floor plan");
  await review.press();assert.equal(review.asked.length,0);assert.deepEqual(review.calls,[]);
  // a room's card, and a read-only film: no run
  const room=runner();assert.equal(room.box.LocationPreparePlace({...room.props,l:room.props.rooms[0],rooms:[]}),null);
  assert.equal(room.box.LocationPreparePlace({...room.props,readOnly:true}),null);
});

console.log("\n"+passed+" passed, "+failed+" failed");
process.exit(failed?1:0);

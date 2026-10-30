/* Art Room part 3 (owner, 2026-09-26): the Breakdown tab — the First AD's stripboard — and
   the art department bible export. The strips read what the other tabs made (no
   generation), use the Run pre-production readiness rules, colour the crew way, and both
   exports go through the ⋮ menu's document preview. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const previews=[];
const box={console, React:{createElement:()=>null}, docPreview:(o)=>previews.push(o)}; box.window=box; vm.createContext(box);
vm.runInContext(read("app/scene-order.js"),box,{filename:"scene-order.js"});
vm.runInContext(read("app/breakdown.jsx"),box,{filename:"breakdown.jsx"});
const art=read("app/artroom.jsx"), chrome=read("app/chrome.jsx"), html=read("TURN.html"), ai=read("app/ai.jsx"), css=read("app/styles.css");

await test("sluglines parse into INT/EXT, set and time of day",()=>{
  assert.deepEqual(plain(box.bdSlug("INT. FATHER'S HOUSE - NIGHT")),{ie:"INT",place:"Father's House",tod:"NIGHT",todKind:"night"});
  assert.deepEqual(plain(box.bdSlug("EXT. PIER - DAWN")),{ie:"EXT",place:"Pier",tod:"DAWN",todKind:"dusk"});
  assert.equal(box.bdSlug("INT./EXT. CAR - DAY").ie,"INT/EXT");
  assert.equal(box.bdSlug("I/E. PORCH - MORNING").ie,"INT/EXT");
  assert.equal(box.bdSlug("EXT. ROAD - CONTINUOUS").todKind,"");
});

// a two-scene film: scene 1 fully made, scene 2 missing a variant, a plate, a prop sheet and frames
const made=new Set(["marcus","loc-chapel","p-card","sh1","sh2","loc-road"]);
const film=()=>({
  scenes:[{id:"s2",no:2,act:1,title:"The Road",loc:"EXT. ROAD - CONTINUOUS",driver:"marcus"},
          {id:"s1",no:1,act:1,title:"Closing",loc:"INT. CHAPEL - NIGHT",driver:"marcus"}],
  characters:[{id:"marcus",name:"Marcus",states:[{id:"wet",label:"Wet suit",sceneId:"s2"}]},{id:"ana",name:"Ana"}],
  props:[{id:"p-card",name:"Eulogy card",kind:"carried",scenes:["s1"]},{id:"p-coin",name:"Coin",kind:"carried",ownerId:"ana",scenes:["s2"]},
         {id:"p-rain",name:"Rain",kind:"dressing",scenes:["s2"]},{id:"p-watch",name:"Watch",kind:"worn",ownerName:"Marcus",scenes:["s2"]}],
  locations:[{id:"loc-chapel",name:"Chapel",scenes:["s1"]},{id:"loc-road",name:"Road",scenes:["s2"]}],
  shots:[{id:"sh1",sceneId:"s1"},{id:"sh2",sceneId:"s1",approved:true},{id:"sh3",sceneId:"s2"},{id:"sh4",sceneId:"s2"}],
  drafts:{},
});
box.sceneRoster=(scene)=> scene.id==="s2" ? ["marcus","ana"] : ["marcus"];
box.locationForScene=(locs,sid)=> locs.find(l=>l.scenes.indexOf(sid)>=0)||null;
box.shotCharacterReferenceSpec=(c,scene)=>{ const st=(c.states||[]).find(s=>s.sceneId===scene.id); return st?{id:c.id+":"+st.id,state:st}:{id:c.id,state:null}; };
const rowsOf=(f)=>box.breakdownRows({...f, img:id=>made.has(id), tierOf:p=>p.id==="p-rain"?"text":"own"});

await test("each strip lists the cast in their look, the location, props and shots — and what's missing",()=>{
  const rows=rowsOf(film());
  assert.deepEqual(rows.map(r=>r.scene.no),[1,2],"story order");
  const [a,b]=rows;
  assert.ok(a.ready && !a.missing.length,"scene 1 has everything: "+JSON.stringify(plain(a.missing)));
  // (2026-10-09, fourth pass) toApprove and approvedOld are counted apart (the summary and the export)
  assert.deepEqual(plain(a.shots),{total:2,rendered:2,approved:1,toRender:0,toApprove:0,approvedOld:0});
  assert.equal(b.slug.todKind,"night","CONTINUOUS keeps the previous scene's clock");
  const m=b.cast.find(c=>c.id==="marcus");
  assert.ok(m.state==="Wet suit" && m.sheetId==="marcus:wet" && !m.ready,"the variant this scene calls for");
  assert.ok(b.location.ready,"the road plate exists");
  const rain=b.props.find(p=>p.id==="p-rain"); assert.ok(!rain.needs && rain.ready,"text-only props need no sheet");
  assert.deepEqual(plain(b.wardrobe.map(p=>p.name)),["Watch"],"worn items are wardrobe, not props");
  assert.ok(!b.props.some(p=>p.kind==="worn"));
  // a worn item rides on its owner's character sheet (the Shots rule, 2026-10-08) — no "Watch sheet" line
  assert.deepEqual(plain(b.missing.map(x=>x.text)),["Marcus · Wet suit variant","Ana's sheet","Coin sheet","2 frames"]);
  assert.deepEqual(plain(b.missing.map(x=>x.tab)),["characters","characters","props","shots"]);
});

await test("the film-wide totals count each missing sheet once",()=>{
  const f=film(); f.scenes.push({id:"s3",no:3,act:2,title:"Later",loc:"INT. CHAPEL - DAY",driver:"ana"});
  box.sceneRoster=(scene)=> scene.id==="s1" ? ["marcus"] : ["marcus","ana"];
  const sum=box.breakdownSummary(rowsOf(f));
  assert.equal(sum.total,3); assert.equal(sum.ready,1);
  assert.equal(sum.castSheets,2,"Marcus's wet variant + Ana's sheet (needed in two scenes, counted once); Marcus's master in scene 3 is made");
  assert.equal(sum.noShots,1); assert.equal(sum.frames,2);
  assert.equal(sum.noLoc,1,"scene 3 resolves to no location card in this fixture");
  assert.match(box.bdSummaryLine ? box.bdSummaryLine(sum) : vm.runInContext("bdSummaryLine("+JSON.stringify(sum)+")",box),
    /^1 of 3 scenes ready to shoot · to go: 2 cast sheets, 1 prop sheet, 2 frames, 1 scene without shots, 1 without a location card$/);
  box.sceneRoster=(scene)=> scene.id==="s2" ? ["marcus","ana"] : ["marcus"];
});

await test("strips are coloured the crew way",()=>{
  const k=s=>box.bdStripKind ? box.bdStripKind(box.bdSlug(s)) : vm.runInContext("bdStripKind(bdSlug("+JSON.stringify(s)+"))",box);
  assert.equal(k("INT. KITCHEN - DAY"),"int-day"); assert.equal(k("EXT. FIELD - DAY"),"ext-day");
  assert.equal(k("INT. KITCHEN - NIGHT"),"int-night"); assert.equal(k("EXT. FIELD - NIGHT"),"ext-night");
  assert.equal(k("INT./EXT. CAR - NIGHT"),"ext-night","an INT/EXT scene is shot as an exterior");
  assert.equal(k("EXT. PIER - DUSK"),"dusk");
  for(const c of ["int-day","ext-day","int-night","ext-night","dusk"]) assert.ok(css.includes(".bd-k-"+c+"{--bd-c:"),c);
});

await test("the stripboard and the art department bible print through the document preview",async ()=>{
  previews.length=0;
  box.exportStripboard(rowsOf(film()),{title:"The Last Word"});
  const sp=previews.pop();
  assert.equal(sp.fileName,"THE_LAST_WORD_STRIPBOARD.html");
  assert.ok(/<tr class="k-int-night">[\s\S]*Closing/.test(sp.html)&&/Ready/.test(sp.html)&&/Coin sheet/.test(sp.html));
  assert.ok(sp.html.includes("<th>Wardrobe</th>")&&sp.html.includes('<td class="w">Watch <i>(Marcus)</i> ○</td>'),"a Wardrobe column");
  const f=film(); f.characters[0].pronouns="he/him"; f.characters[0].voice={accent:"soft Glaswegian"};
  box.nbGetImage=id=> id==="marcus" ? "https://example.test/marcus.png" : "";
  box.PropScreenplay={ sheetTier:(p)=>({ tier: p.id==="p-rain" ? "text" : "own" }) };
  await box.exportArtBible({project:{title:"The Last Word"},...f});
  const bb=previews.pop();
  assert.equal(bb.fileName,"THE_LAST_WORD_ART_BIBLE.html");
  assert.ok(bb.html.includes('<img src="https://example.test/marcus.png" alt="Marcus">'),"current sheet image");
  assert.ok(/Wet suit<\/b>[^<]*<span class="m">\(from Sc 2\)/.test(bb.html),"appearance states with their first scene");
  assert.ok(bb.html.includes("soft Glaswegian")&&bb.html.includes("Text only — described in shots")&&bb.html.includes("No sheet yet"));
  assert.ok(/<h2>Cast<\/h2>[\s\S]*<h2>Props<\/h2>[\s\S]*<h2>Locations<\/h2>/.test(bb.html));
  // the physique prints once when Body already carries it
  const h=film(); h.characters[0].coreBody="Apparent age: mid 40s. Build: stooped and thick."; h.characters[0].physique={age:"mid 40s",build:"stooped and thick"};
  await box.exportArtBible({project:{title:"T"},...h});
  const once=previews.pop().html;
  assert.ok(once.includes("Apparent age: mid 40s")&&!/<span class="l">Age<\/span>/.test(once));
  h.characters[0].coreBody="Weathered hands."; await box.exportArtBible({project:{title:"T"},...h});
  assert.ok(/<span class="l">Age<\/span>mid 40s/.test(previews.pop().html),"shown when Body doesn't carry it");
  // no HTML injection from card text
  const g=film(); g.characters[1].name='<script>x</script>';
  await box.exportArtBible({project:{title:"T"},...g});
  assert.ok(!previews.pop().html.includes("<script>x</script>"));
});

await test("the tab and the ⋮ menu exports are wired",()=>{
  assert.ok(art.includes('{ id:"breakdown",  label:"Breakdown",   icon:"grid" },'));
  assert.ok(art.includes('tab==="breakdown" && window.BreakdownView'));   // (2026-10-30) each tab from renderTab(tab)
  assert.ok(art.includes("window.turnExportArtBible = ()=> window.exportArtBible && window.exportArtBible({ project, characters, props, locations, scenes, drafts, shots });"));
  assert.ok(chrome.includes('["strip","Export stripboard"')&&chrome.includes('["bible","Export art department bible"')&&chrome.includes('["shots","Export shot list"'));
  assert.ok(/src="app\/breakdown\.jsx\?v=[^"]+"/.test(html));
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(m.includes('name:"Breakdown (Art Room)"')&&m.includes("Lookbook, Characters, Props, Locations, Color, Shots, Storyboards and Breakdown"));
});

console.log(checks+" checks passed");

#!/usr/bin/env node
/* A SMALL ROOM BORROWS ITS PARENT'S PLATE (owner-approved 2026-10-27, "go ahead with 5 and 6"). A one-off room with no
   plate of its own (usesParentPlate on its card) gets, in its shots and Stage clips, ONE small panel of its parent's
   plate for materials, colour and light — kept as the room's own "ps-" asset — and is described in words:
   - shotLocationCoverageSpecs gives only that panel (no plate, room & time plate or extra space of the room's own);
   - the spec keeps the ROOM as its location (the prompt describes the room) and says it is not the room;
   - the panel is cut from the parent's current plate, stored once, and cut again when the parent's plate changes;
   - the Locations card offers it, the batch skips such a room, the Stage names it and gives it its own role line.
   Run: node scripts/test-location-parent-style.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop, CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""},
  React:{createElement:()=>null,useState:(v)=>[v,noop],useEffect:noop,useRef:(v)=>({current:v}),useMemo:(f)=>f(),useCallback:(f)=>f,useReducer:()=>[0,noop],createContext:()=>({})} };
box.window=box; box.globalThis=box; box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box,{filename:"app/locations.jsx"});
let shotsLoaded=true;
try{ vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"}); }catch(e){ shotsLoaded=false; console.log("shots.jsx load: "+e.message); }
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
ok("shots.jsx loads", shotsLoaded);

const house={id:"loc-house",key:"theatre",name:"Teatro Verdi",intExt:"INT",scenes:["s1","s2","s3"]};
const room={id:"loc-dress",key:"dressing-room",name:"Dressing Room",intExt:"INT",parentKey:"theatre",
  parentLocation:{id:"loc-house",name:"Teatro Verdi"},scenes:["s2"],usesParentPlate:true};
const plain={...room,id:"loc-box",key:"box",name:"Royal Box",usesParentPlate:false};
box.turnContinuity={locations:[house,room,plain],scenes:[{id:"s2",no:2,loc:"INT. TEATRO VERDI - DRESSING ROOM - NIGHT"}],sluglineUnits:[],drafts:{}};

ok("a room with the switch on and a parent borrows; one without the switch, or without a parent, doesn't",
  box.locationUsesParentPlate(room) && !box.locationUsesParentPlate(plain)
  && !box.locationUsesParentPlate({...room,parentKey:"",parentLocation:null}));
ok("its panel is the room's own asset id", box.locationParentStyleId(room)==="ps-loc-dress");

const specs=box.shotLocationCoverageSpecs(room,{id:"sh1",sceneId:"s2"},box.turnContinuity.scenes[0],{});
const sp=specs[0]||{};
ok("a borrowing room's shot gets exactly the one panel", specs.length===1 && sp.id==="ps-loc-dress" && sp.parentStyle===true, JSON.stringify(specs));
ok("…its location stays the room (the prompt describes the room), with the parent named apart",
  sp.locationId==="loc-dress" && sp.entityId==="loc-dress" && sp.parentLocationId==="loc-house");
ok("…and its note says materials, colour and light only, never the room or its layout",
  /materials, colour and light only/.test(sp.note) && /It is NOT Dressing Room/.test(sp.note) && /never copy this panel's layout/.test(sp.note), sp.note);
ok("the prompt location is the room, not the parent", box.shotPromptLocation(room,specs,{locations:[house,room,plain]}).id==="loc-dress");
const cat=box.shotLocationReferenceCatalog(room,{id:"sh1",sceneId:"s2"},box.turnContinuity.scenes[0],{});
ok("the reference picker lists the panel", cat.some(s=>s.id==="ps-loc-dress"), cat.map(s=>s.id).join(","));
ok("a room that doesn't borrow gets no panel", !box.shotLocationCoverageSpecs(plain,{id:"sh2",sceneId:"s2"},box.turnContinuity.scenes[0],{}).some(s=>s.parentStyle));

// cutting and keeping the panel
const store={ "loc-house":{url:"data:parent-v1",meta:{iso:"2026-10-27T10:00:00Z"}} };
let cuts=0, commits=[];
box.nbGetImage=(id)=>(store[id]||{}).url||"";
box.nbLoadImage=async(id)=>(store[id]||{}).url||"";
box.nbGetMeta=(id)=>(store[id]||{}).meta||null;
box.nbEpoch=()=>7;
box.cropRegionAsDataUrl=async(src,crop,max)=>{ cuts++; return "data:cut-of-"+src.slice(5)+"-"+max; };
box.nbCommit=async(id,url,meta,refs,kind,epoch)=>{ commits.push({id,meta,kind,epoch}); store[id]={url:"https://cdn/"+id+"/"+cuts,meta}; return {tier:"cloud",url:store[id].url}; };
const u1=await box.locationEnsureParentStyle(room);
ok("the first use cuts one small panel (640 px) of the parent's plate and keeps it under the room's id",
  cuts===1 && commits.length===1 && commits[0].id==="ps-loc-dress" && commits[0].meta.parentStyleOf==="loc-house"
  && commits[0].meta.parentIso==="2026-10-27T10:00:00Z" && commits[0].epoch===7 && u1==="https://cdn/ps-loc-dress/1", JSON.stringify(commits));
const u2=await box.locationEnsureParentStyle(room);
ok("the next use reads the kept panel (no new cut)", cuts===1 && u2===u1);
store["loc-house"]={url:"data:parent-v2",meta:{iso:"2026-10-27T12:00:00Z"}};
await box.locationEnsureParentStyle(room);
ok("a new parent plate → the panel is cut again", cuts===2 && commits.length===2 && commits[1].meta.parentIso==="2026-10-27T12:00:00Z");
ok("read-only (a viewer) never cuts or saves", await box.locationEnsureParentStyle({...room,id:"loc-other"},{readOnly:true})==="" && cuts===2);
delete store["loc-house"];
ok("no parent plate yet → nothing", await box.locationEnsureParentStyle({...room,id:"loc-third"})==="" && cuts===2);

// the shot's loader cuts on first use
store["loc-house"]={url:"data:parent-v3",meta:{iso:"2026-10-27T13:00:00Z"}};
const r=await box.shotLoadLocationSpecImage(sp,async(id)=>"",{requireAll:true});
ok("the shot frame's loader gets the panel even before it was kept", r && /^https:\/\/cdn\/ps-loc-dress\//.test(r.url) && r.locationId==="loc-dress", JSON.stringify(r));

// the wiring
const ui=readFileSync("app/locations-ui.jsx","utf8"), stage=readFileSync("app/stage.jsx","utf8"), sui=readFileSync("app/shots-ui.jsx","utf8");
ok("the room's card shows the switch (one-off rooms are offered it; on, it shows the panel and 'Give it its own plate')",
  /function LocationParentStyleNotice\(/.test(ui) && /sceneN>2/.test(ui) && /"Use "\+pName\+"'s image"/.test(ui) && /"Give it its own image"/.test(ui)
  && /React\.createElement\(LocationParentStyleNotice,\{ l, gen, readOnly, onUpdate \}\)/.test(ui));
ok("generating the room's own plate turns borrowing off", /if\(on && own && !readOnly && typeof onUpdate==="function"\) onUpdate\(l\.id,\{ usesParentPlate:false \}\)/.test(ui));
ok("the missing-plates batch and the scene run skip a borrowing room",
  /draftedIds\(list\.filter\(l=>!borrows\(l\)\)\)/.test(ui) && /need\.has\(l\.id\) && !borrows\(l\)/.test(ui) && /x\.owner && !borrows\(x\.owner\)/.test(ui));
ok("the Stage names the panel and gives it a materials-only role line, and cuts it on first load",
  /"'s materials and colour"/.test(stage) && /It is NOT this room: build the room from the text/.test(stage)
  && /String\(id\)\.indexOf\("ps-"\)===0 && typeof locationEnsureParentStyle==="function"/.test(stage));
ok("the Shots warning says the parent's image is what's missing", /borrows its parent's image, which isn't ready yet/.test(sui));
const html=readFileSync("TURN.html","utf8"), ai=readFileSync("app/ai.jsx","utf8");
ok("Frances knows", /A small room that borrows its parent's plate/.test(ai));
// (owner 2026-10-27) THE PARENT'S OWN VIEW OF THE ROOM: Marmorica's plate asked for "INTERIOR establishing view of
// Marmorica - CAR Deck" (top-left); the CAR Deck room was sent the Upper Deck's exterior as materials-only instead
{
  const realViews = box.locationRequestedViews;
  const ship={id:"loc-m",key:"marmorica",name:"Marmorica",intExt:"INT/EXT"};
  const car={id:"loc-car",key:"car",name:"Marmorica - CAR Deck",intExt:"INT",parentKey:"marmorica"};
  const upper={id:"loc-up",key:"up",name:"Marmorica - Upper Deck",intExt:"EXT",parentKey:"marmorica"};
  const galley={id:"loc-gal",key:"gal",name:"Marmorica - Galley",intExt:"INT",parentKey:"marmorica"};
  box.locationRequestedViews=()=>[
    {key:"TL",purpose:"INTERIOR establishing view of Marmorica - CAR Deck because the action starts inside"},
    {key:"TR",purpose:"INTERIOR key action station from the screenplay"},
    {key:"BL",purpose:"EXTERIOR context of Marmorica - Upper Deck seen from the connected approach"},
    {key:"BR",purpose:"THRESHOLD CONNECTION view: between Marmorica - Upper Deck and Marmorica - CAR Deck"}];
  ok("the CAR Deck gets the top-left panel (its own interior view), never the threshold or the exterior",
    box.locationParentPanelShowing(ship,car,null)==="TL");
  ok("the Upper Deck (outside) gets the bottom-left exterior view", box.locationParentPanelShowing(ship,upper,null)==="BL");
  ok("a room the plate doesn't show gets none", box.locationParentPanelShowing(ship,galley,null)==="");
  ok("the plate's recorded cameras win when they say a panel shows the room",
    box.locationParentPanelShowing(ship,galley,{panels:{TR:{childrenVisible:[{spaceId:"loc-gal"}]}}})==="TR");
  ok("an inside room's materials panel is an INTERIOR one when it has to fall back (not the threshold, not the exterior)",
    box.locationParentMaterialPanel(ship,galley,null)==="TR", box.locationParentMaterialPanel(ship,galley,null));
  ok("an outside room's is the EXTERIOR one",
    box.locationParentMaterialPanel(ship,{id:"loc-bow",name:"Marmorica Bow",intExt:"EXT",parentKey:"marmorica"},null)==="BL");
  box.locationRequestedViews=realViews;
}
{
  const ui=readFileSync("app/artroom.jsx","utf8");
  ok("a panel cut for a reference is scaled UP to its minimum (never above its maximum)",
    ui.includes("const sc = Math.min(maxDim/long, Math.max(1, (Number(minDim)||0)/long));") && ui.includes('ctx.imageSmoothingQuality = "high"'));
  const loc=readFileSync("app/locations.jsx","utf8");
  ok("the borrowed panel is cut again when the panel choice changes (an older cut may be the wrong panel)",
    loc.includes("cur.panelKey===key && !!cur.showsRoom===pick.showsRoom"));
}
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

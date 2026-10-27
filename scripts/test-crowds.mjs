#!/usr/bin/env node
/* CROWDS (owner-approved 2026-10-27, "go ahead with 5 and 6"): one group image per crowd the screenplay calls for,
   used for every shot of that crowd (the casting models of a fashion show, the passengers of a ferry).
   - crowds derive from the screenplay's ACTION lines (never added by hand), in screenplay order, one per group noun;
   - a card's own settings (look, how many, off) live in project.crowds[key];
   - a shot gets a crowd only in its scene AND when its own action names it; "Don't use" keeps it out;
   - shot frames attach it after the props (never required), name it as background extras, and drop
     "no bystanders, no extras" for a shot with a crowd; the Stage offers it on by default with its own role line.
   Run: node scripts/test-crowds.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""},
  React:{createElement:()=>null,useState:(v)=>[v,noop],useEffect:noop,useRef:(v)=>({current:v}),useMemo:(f)=>f(),useCallback:(f)=>f,useReducer:()=>[0,noop],createContext:()=>({})} };
box.window=box; box.globalThis=box; box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("app/crowds.js","utf8"),box,{filename:"app/crowds.js"});
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box,{filename:"app/locations.jsx"});
vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"});
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };

const scenes=[{id:"s1",no:1},{id:"s2",no:2},{id:"s3",no:3}];
const drafts={
  s1:{blocks:[{type:"scene",text:"INT. FERRY - CAR DECK - NIGHT"},{type:"action",text:"A few passengers drift toward the stairs. Aurelio checks tickets."},
    {type:"dialogue",text:"The passengers are late."}]},
  s2:{blocks:[{type:"scene",text:"EXT. UPPER DECK - NIGHT"},{type:"action",text:"Wind. Passengers huddle under the lifeboats."}]},
  s3:{blocks:[{type:"scene",text:"INT. SALON - NIGHT"},{type:"action",text:"Dozens of guests in evening wear. A crowd parts as Mara enters."}]},
};
const crowds=box.deriveCrowds(scenes,drafts,{guest:{look:"black tie, older money",count:9},crowd:{off:true}});
ok("crowds come from the action lines, in screenplay order, one per group noun",
  crowds.map(c=>c.key).join(",")==="passenger,crowd,guest" || crowds.map(c=>c.key).join(",")==="passenger,guest,crowd", crowds.map(c=>c.key).join(","));
const pas=crowds.find(c=>c.key==="passenger"), gst=crowds.find(c=>c.key==="guest"), crd=crowds.find(c=>c.key==="crowd");
ok("…a crowd gathers every scene that names it, with the lines that name it", pas.scenes.join(",")==="s1,s2" && pas.excerpts.length===2
  && /A few passengers drift/.test(pas.excerpts[0]) && pas.id==="crowd-passenger", JSON.stringify(pas));
ok("…dialogue doesn't make a crowd (only action does)", !pas.excerpts.some(x=>/are late/.test(x)));
ok("…'a few' shows 4 people; the card's own count and look win; off is kept", pas.count===4 && gst.count===9 && gst.look==="black tie, older money" && crd.off===true);
ok("a shot gets a crowd only in its scene and when its own action names it",
  box.crowdsForShot(crowds,scenes[0],{action:"Passengers file past Aurelio."}).map(c=>c.key).join()==="passenger"
  && box.crowdsForShot(crowds,scenes[0],{action:"Aurelio alone at the ramp."}).length===0
  && box.crowdsForShot(crowds,scenes[2],{action:"Passengers? none here."}).length===0);
ok("a crowd switched off is never given to a shot", box.crowdsForShot(crowds,scenes[2],{action:"The crowd parts."}).length===0);
ok("the reference note: anonymous background extras, never a named character, never a lineup",
  /PASSENGERS crowd reference — anonymous background extras only/.test(box.crowdReferenceNote(pas)) && /None of them is a named character/.test(box.crowdReferenceNote(pas))
  && /Never a lineup/.test(box.crowdReferenceNote(pas)));
const prompt=box.crowdImagePrompt(gst,{style:"Photoreal"});
ok("the group image: N different people in one row, full body, plain mid-grey background, the look and the screenplay lines",
  /a group of 9 guests/.test(prompt) && /Their look: black tie, older money\./.test(prompt) && /From the screenplay: Dozens of guests/.test(prompt)
  && /plain mid-grey studio background/.test(prompt) && /clearly a different individual/.test(prompt) && /No named or main character/.test(prompt), prompt);

// the Shots room
box.turnContinuity={scenes,drafts}; box.turnProjectCrowds={};
const specs=box.shotCrowdSpecs({id:"sh1",sceneId:"s2",action:"Passengers huddle; Aurelio watches."},{scene:scenes[1]});
ok("a shot's crowd spec: the group image's id, kind crowd, not required, with the note",
  specs.length===1 && specs[0].id==="crowd-passenger" && specs[0].referenceKind==="crowd" && specs[0].required===false && /anonymous background extras/.test(specs[0].note), JSON.stringify(specs));
const shotsSrc=readFileSync("app/shots.jsx","utf8");
ok("the render plan attaches crowds after the props", /\.\.\.propSpec, \.\.\.carrySpec, \.\.\.crowdSpec\]/.test(shotsSrc) && /crowdSpec, orderedSpecs \}/.test(shotsSrc));
ok("a shot with a crowd says who the background people are and drops 'no bystanders, no extras'",
  /stage\.push\("Background people: the "/.test(shotsSrc) && /if\(subjects\.length && !_shotCrowds\.length && !_crowdRx\.test/.test(shotsSrc));
const sui=readFileSync("app/shots-ui.jsx","utf8");
ok("the shot card shows the crowd image among its references (it can be unticked)", /kind:"crowd", refId:c\.id/.test(sui) && /crowdSpecs\.map\(s=>s\.id\)\.join\(","\)/.test(sui));
const stage=readFileSync("app/stage.jsx","utf8");
ok("the Stage offers each crowd its clip names, on by default, loads its image, and gives it a background-only role line",
  /key:"crowd:"\+c\.key, kind:"image", group:"Crowds"/.test(stage) && /shotCrowds\(sh,\{project,scene:hydrationScene\}\)\.forEach\(c=>s\.add\(c\.id\)\)/.test(stage)
  && /crowd reference \\u2014 anonymous background extras only/.test(stage) && /none speaks/.test(stage));
const ui=readFileSync("app/crowds-ui.jsx","utf8"), art=readFileSync("app/artroom.jsx","utf8"), app=readFileSync("app/app.jsx","utf8");
ok("Characters › Crowds lists them (one card each: screenplay lines, look, people, Don't use, a 16:9 group image)",
  /window\.CrowdSheets && React\.createElement\(window\.CrowdSheets/.test(art) && /"Don't use this crowd"/.test(ui) && /aspectRatio:"16:9"/.test(ui)
  && /"People in the image"/.test(ui));
ok("a card's settings are saved in project.crowds (the Art Room's own part of the film)",
  /const updateCrowd = \(key, patch\)=>\{ if\(artRoomReadOnlyRef\.current/.test(app) && /return \{ \.\.\.p, crowds:all \}/.test(app) && /onUpdateCrowd:updateCrowd/.test(app));
const html=readFileSync("TURN.html","utf8");
ok("TURN.html loads crowds.js and crowds-ui.jsx", /app\/crowds\.js\?v=/.test(html) && /app\/crowds-ui\.jsx\?v=/.test(html));
ok("Frances knows", /name:"Crowds \(Characters\)"/.test(readFileSync("app/ai.jsx","utf8")));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

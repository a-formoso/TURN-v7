import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8"), box={console,setTimeout,clearTimeout};box.window=box;
vm.createContext(box);
for(const f of ["app/prop-screenplay.js","app/props.jsx"])vm.runInContext(read(f),box,{filename:f});
const plain=x=>JSON.parse(JSON.stringify(x)), P=box.PropScreenplay;
let checks=0;
const test=(name,f)=>{f();checks++;console.log("PASS",name);};
const scenes=[{id:"s1",no:1,title:"Kitchen"},{id:"s2",no:2,title:"Office"}];
const characters=[{id:"m",name:"Marcus Tillmon"},{id:"d",name:"Daniel Tillmon"},{id:"r",name:"Reuben"}];
const drafts={s1:{blocks:[{type:"action",beat:1,text:"Marcus opens the medication notebook."},{type:"char",text:"REUBEN (V.O.)"},{type:"dialogue",text:"I remember the old watch."},{type:"action",beat:2,text:"Marcus hands the notebook to Daniel."}]},s2:{blocks:[{type:"action",text:"Marcus opens a sealed letter."}]}};
const raw={props:[{name:"Medication notebook",kind:"carried",ownerId:"m",aliases:["dose log"],sources:[{block:1,quote:"Marcus opens the medication notebook.",presence:"handled"},{block:4,quote:"Marcus hands the notebook to Daniel.",presence:"handled"}],events:[{type:"handed_over",holderId:"d",block:4,quote:"Marcus hands the notebook to Daniel."}]},{name:"Old watch",sources:[{block:3,quote:"I remember the old watch.",presence:"visible"}]},{name:"Invented gun",sources:[{block:1,quote:"Marcus fires a gun.",presence:"handled"}]}]};
const parsed=P.normalizeResult(raw,scenes[0],drafts,characters,[]);
const proposal={...parsed.candidates[0],target:"new",includeEvents:true,warnings:[]};
test("classifier uses the object, not its container",()=>assert.equal(box.classifyPropKind("A folded index card with Dad's words in his jacket pocket"),"carried"));
test("glasses on a chain remain glasses",()=>assert.equal(box.propHeadNoun("Silver-framed reading glasses worn on a fine chain"),"glasses"));
test("distinct letters are not deduplicated by owner + noun",()=>assert.deepEqual(plain(box.findDuplicateProps([{id:"a",ownerId:"m",name:"Drawer letter"},{id:"b",ownerId:"m",name:"Final letter"}])),{}));
test("same-named set objects in different locations are distinct",()=>assert.deepEqual(plain(box.findDuplicateProps([{id:"a",locationId:"k",name:"Desk"},{id:"b",locationId:"o",name:"Desk"}])),{}));
test("same owner's separate phones survive seeding",()=>assert.equal(box.propsFromCast([{id:"m",props:"Work phone; Personal phone"}],[]).length,2));
test("incomplete legacy names are flagged, not guessed",()=>assert.ok(P.nameIssue("Plain…")));
test("incomplete cast fragments are not imported",()=>assert.equal(box.propsFromCast([{id:"m",accessories:"Plain…; black belt"}],[]).length,1));
// (2026-10-29) costume and an unproven card are Not story props, shown in their own group, never deleted
test("ordinary accessories are grouped without deleting cards",()=>assert.equal(P.group({kind:"worn",name:"Black belt"}),"other"));
test("a card that returns in two scenes is a story object",()=>assert.equal(P.group({kind:"worn",name:"index card in jacket pocket",
  screenplaySources:[{sceneId:"a",sceneNo:1,presence:"handled"},{sceneId:"b",sceneNo:2,presence:"visible"}]}),"story"));
test("exact source validation rejects hallucinated quotes",()=>assert.equal(parsed.candidates.length,2));
test("dialogue mention cannot become physical presence",()=>assert.equal(parsed.candidates[1].screenplaySources[0].presence,"mentioned"));
test("source beat is read from screenplay, not guessed",()=>assert.equal(proposal.screenplaySources[1].beat,2));
test("voice-only characters do not bring worn assets",()=>assert.deepEqual(plain(P.characterScenes("r","Reuben",scenes,drafts,characters)),[]));
test("spoken character cues count physical presence",()=>assert.deepEqual(plain(P.characterScenes("r","Reuben",scenes,{s1:{blocks:[{type:"char",text:"REUBEN"}]}},characters)),["s1"]));
const accepted=P.accept([], [proposal],drafts), item=accepted[0];
test("applying creates one object with evidence and events",()=>{assert.equal(accepted.length,1);assert.equal(item.continuityEvents[0].holderId,"d");assert.deepEqual(plain(item.scenes),["s1"]);});
test("events require a separate approval",()=>assert.equal(P.accept([],[{...proposal,includeEvents:false}],drafts)[0].continuityEvents.length,0));
test("skip never creates an object",()=>assert.equal(P.accept([],[{...proposal,target:"skip"}],drafts).length,0));
test("linking preserves existing artwork/design/ownership",()=>{
  const old={id:"old",name:"My notebook",ownerId:"d",form:"Authored form",imageUrl:"keep.png",origin:{kind:"manual"}};
  const linked=P.accept([old],[{...proposal,target:"old"}],drafts)[0];
  assert.equal(linked.imageUrl,"keep.png");assert.equal(linked.form,old.form);assert.equal(linked.ownerId,"d");assert.equal(linked.name,old.name);assert.equal(linked.origin.kind,"manual");
});
test("relinking is idempotent for evidence and events",()=>{
  const twice=P.accept(accepted,[{...proposal,target:item.id}],drafts)[0];assert.equal(twice.screenplaySources.length,2);assert.equal(twice.continuityEvents.length,1);
});
test("stale source blocks application atomically",()=>assert.throws(()=>P.accept(accepted,[{...proposal,target:item.id}],{s1:{blocks:[]}}),/screenplay changed/));
test("missing target blocks application",()=>assert.throws(()=>P.accept([], [{...proposal,target:"deleted"}],drafts),/no longer available/));
test("edited evidence disappears from mapping, not inventory",()=>{assert.deepEqual(plain(P.scenesFor(item,{})),[]);assert.equal(accepted.length,1);});
test("missing reviewed evidence cannot make an object appear everywhere",()=>assert.equal(box.propStateAt(item,"s2",null,null,null,{scenes,drafts:{}}).active,false));
test("explicit empty wearable map means absent",()=>assert.equal(box.propStateAt({id:"w",kind:"worn",scenes:[]},"s1",null,null,null,{scenes}).active,false));
test("re-extraction archives outdated source passages",()=>{
  // (2026-10-18) a passage that only MOVED (a redraft added a line above it) is the same passage: kept, never archived
  const shifted={s1:{blocks:[{type:"action",text:"A pause."},...drafts.s1.blocks]}};
  const fresh={...proposal,target:item.id,screenplaySources:proposal.screenplaySources.map(e=>({...e,block:e.block+1})),includeEvents:false};
  const updated=P.accept(accepted,[fresh],shifted)[0];assert.equal(updated.screenplaySources.length,2);assert.equal((updated.screenplaySourceHistory||[]).length,0);assert.equal(P.sources(updated,shifted).length,2);
  assert.equal(P.sources(accepted[0],shifted).length,2,"before re-extraction the moved passages are still found");
  // a passage the redraft REWROTE is outdated: archived when the extraction runs again
  const rewritten={s1:{blocks:[{type:"action",beat:1,text:"Marcus opens the medication notebook."},{type:"char",text:"REUBEN (V.O.)"},{type:"dialogue",text:"I remember the old watch."},{type:"action",beat:2,text:"Marcus slides the notebook across to Daniel."}]},s2:drafts.s2};
  const fresh2={...proposal,target:item.id,screenplaySources:[proposal.screenplaySources[0]],includeEvents:false};
  const updated2=P.accept(accepted,[fresh2],rewritten)[0];assert.equal(updated2.screenplaySources.length,1);assert.equal(updated2.screenplaySourceHistory.length,1);
});
test("full screenplay chunks include objects after character 600",()=>{
  const long={s1:{blocks:[{type:"action",text:"A long pause. ".repeat(3000)+"The final envelope appears."}]}};
  const all=P.chunks(scenes[0],long).flat().map(b=>b.text).join("");assert.equal(all,long.s1.blocks[0].text);
});
test("document prompt preserves writing, excludes sheet annotations",()=>{
  const prompt=box.buildPropRefPrompt({name:"Letter",contentNotes:"To Marcus",contentVersion:"original",detail:"Represents forgiveness",signatureFeature:"Yellowed paper"});
  assert.ok(prompt.includes("To Marcus"));assert.ok(prompt.includes("Yellowed paper"));assert.ok(!prompt.includes("Represents forgiveness"));assert.ok(!prompt.includes("no text, labels"));
});
test("content updates resolve at the right story moment",()=>{
  const p={id:"l",name:"letter",kind:"carried",contentNotes:"Clean",contentVersion:"original",continuityEvents:[{id:"e",sceneId:"s2",type:"updated",contentNotes:"Crossed out",contentVersion:"marked"}]};
  assert.equal(box.propStateAt(p,"s1",null,null,null,{scenes}).contentNotes,"Clean");assert.equal(box.propStateAt(p,"s2",null,null,null,{scenes}).contentNotes,"Crossed out");
});

test("brief-only proposals are flagged as not in screenplay; hand-added and reviewed are not",()=>{
  assert.equal(P.notInScreenplay(box.propsFromCast([{id:"m",props:"Lighter"}],[])[0]),true);
  assert.equal(P.notInScreenplay({id:"h",name:"Key",manual:true}),false);
  assert.equal(P.notInScreenplay({id:"o",name:"Key",origin:{kind:"manual"}}),false);
  assert.equal(P.notInScreenplay(item),false);
});
const once={id:"once",name:"Vase",kind:"dressing",screenplaySources:[{sceneId:"s2",sceneNo:2,block:1,quote:"Marcus opens a sealed letter.",presence:"visible"}]};
test("reference-image tier follows reviewed evidence",()=>{
  assert.equal(P.sheetTier(item,drafts).tier,"own");                       // handled
  assert.equal(P.sheetTier(once,drafts).tier,"text");                      // seen once, never handled
  assert.equal(P.sheetTier({...once,contentNotes:"To Marcus"},drafts).tier,"own");
  assert.equal(P.sheetTier({...once,sheetTier:"own"},drafts).tier,"own");  // user override
  assert.equal(P.sheetTier({id:"b",name:"Lighter"},drafts).tier,"own");    // no evidence: unchanged behaviour
  assert.equal(P.sheetTier(once,{}).tier,"own");                            // stale evidence: needs review
});
test("text-only applies only without an existing image",()=>{
  box.turnContinuity={drafts,scenes};
  assert.equal(box.propTextOnly(once),true);assert.equal(box.propTextOnly(item),false);assert.equal(box.propTextOnly({...once,kind:"worn"}),false);
  box.nbGetImage=id=>id==="once"?"data:image/png;base64,x":"";assert.equal(box.propTextOnly(once),false);
  delete box.nbGetImage;delete box.turnContinuity;
});
test("a cast member is never accepted as a prop",()=>{
  const r=P.normalizeResult({props:[{name:"Reuben",sources:[{block:1,quote:"Marcus opens the medication notebook.",presence:"visible"}]}]},scenes[0],drafts,characters,[]);
  assert.equal(r.candidates.length,0);assert.equal(r.rejected,1);
});
test("legacy custody handovers resolve as story events",()=>{
  const p={id:"c",name:"Letter",ownerId:"m",ownerName:"Marcus",custody:[{id:"cu1",charId:"d",charName:"Daniel",fromSceneId:"s2"}]};
  assert.equal(box.custodyOwnerAt(p,scenes[0],scenes).name,"Marcus");assert.equal(box.custodyOwnerAt(p,scenes[1],scenes).name,"Daniel");
  assert.equal(box.custodyChainLabel(p,scenes),"Marcus \u2192 Daniel (Sc 2)");
  const migrated={...p,custody:[],continuityEvents:[{id:"cu1",type:"handed_over",sceneId:"s2",holderId:"d",holderName:"Daniel"}]};
  assert.equal(box.custodyChainLabel(migrated,scenes),"Marcus \u2192 Daniel (Sc 2)");assert.equal(box.propHandoverEvents(migrated,scenes).length,1);
});

const ai=read("app/ai.jsx"), ast=parseSync(ai,{sourceType:"script"});
for(const name of ["aiExtractScreenplayProps","propSceneMap"]){const node=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name===name);vm.runInContext(ai.slice(node.start,node.end),box);}
box.aiAvailable=()=>true;box.scenesInStoryOrder=s=>s;box.extractJSON=JSON.parse;
let calls=[];box.claude={complete:async o=>{calls.push(o);return JSON.stringify(raw);}};
const review=await box.aiExtractScreenplayProps([scenes[0]],drafts,characters,[],[],()=>{},()=>false);
test("AI extraction returns proposals without mutating data",()=>{assert.equal(review.candidates.length,2);assert.equal(review.candidates[1].target,"skip");assert.equal(drafts.s1.blocks.length,4);});
test("source rejection is visible in extraction report",()=>assert.ok(review.rejected>0));
const before=calls.length;
const mapped=await box.propSceneMap([item,{id:"rw",kind:"worn",ownerId:"r",ownerName:"Reuben"},{id:"bw",name:"Old watch",kind:"carried",ownerId:"r",fromCast:true},{id:"bl",name:"Sealed letter",kind:"carried",ownerId:"m",fromCast:true}],scenes,drafts,characters);
test("reviewed/worn refresh is deterministic and free of model calls",()=>{assert.equal(calls.length,before);assert.deepEqual(plain(mapped.rw),[]);assert.deepEqual(plain(mapped[item.id]),["s1"]);});
test("unestablished objects map lexically from action, never dialogue",()=>{assert.deepEqual(plain(mapped.bw),[]);assert.deepEqual(plain(mapped.bl),["s2"]);});
test("extraction prompt states the prop boundaries",()=>{const p=calls[0].messages[0].content;assert.ok(/animals and creatures are cast/.test(p)&&/vehicle that scenes take place INSIDE is a location/.test(p)&&/ambient multiples/.test(p));});
box.claude.complete=async()=>{throw Error("Offline");};
const failed=await box.aiExtractScreenplayProps(scenes,drafts,characters,[],[],()=>{},()=>false);
test("partial failure names unread scenes",()=>assert.equal(failed.failures.length,2));
const cancelled=await box.aiExtractScreenplayProps(scenes,drafts,characters,[],[],()=>{},()=>true);
test("cancellation stops before any further request",()=>assert.equal(cancelled,null));

for(const f of ["app/props.jsx","app/ai.jsx","app/app.jsx","app/artroom.jsx","app/agents.jsx","app/shots.jsx","app/shots-ui.jsx","app/storyboard.jsx","app/stage.jsx"])parseSync(read(f),{sourceType:"script"});
test("all changed scripts parse",()=>{});
const agent=read("app/agents.jsx"), agentStart=agent.indexOf("async function agentPropsMaster"), agentEnd=agent.indexOf("async function agentLocationScout",agentStart);
test("Props Master cannot silently extract or merge",()=>{const s=agent.slice(agentStart,agentEnd);assert.ok(!s.includes("pm.deriveSet()"));assert.ok(!s.includes("pm.dedup()"));});
const app=read("app/app.jsx"), props=read("app/props.jsx"), shots=read("app/shots.jsx");
test("leftover prop code is gone",()=>{
  assert.ok(!props.includes("function PropStateRow")&&!props.includes("Legacy custody handovers")&&!props.includes("legacy inline renderer"));
  assert.ok(!ai.includes("aiDeriveSetDressing")&&!ai.includes("aiPropScenes")&&!app.includes("tagPropScenes")&&!app.includes("deriveSet")&&!app.includes("dedup: ()"));
});
test("breakdown reads the Props inventory instead of tagging its own list",()=>{
  assert.ok(!agent.includes("bd.props")&&!agent.includes("bd.set_dressing")&&agent.includes("inventoryProps"));
  const bd=ai.slice(ai.indexOf("async function aiScriptBreakdown"),ai.indexOf("window.aiScriptBreakdown"));assert.ok(!bd.includes("set_dressing")&&!bd.includes('"props":'));
});
test("agent descriptions match current behaviour",()=>{assert.ok(!agent.includes("set dressing in the action")&&!agent.includes("Tagged props are listed for the Props Master")&&!ai.includes("Design all props"));});
const shotsAst=parseSync(shots,{sourceType:"script"});
{const node=shotsAst.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="shotPropAttachable");vm.runInContext(shots.slice(node.start,node.end),box);}
test("shots describe text-only objects instead of attaching or generating them",()=>{
  box.turnContinuity={drafts,scenes};
  assert.equal(box.shotPropAttachable(once,{size:"CU",sceneId:"s2"},scenes[1]),false);
  assert.equal(box.shotPropAttachable(item,{size:"MS",sceneId:"s1"},scenes[0]),true);
  delete box.turnContinuity;
  assert.ok(shots.includes("Minor objects without reference images")&&shots.includes('if(typeof propTextOnly==="function" && propTextOnly(p)) return;               // described in text instead'));
});
test("feature manifest documents the review flow",()=>assert.ok(ai.includes("Apply reviewed proposals")&&ai.includes("Missing evidence never automatically deletes")));
test("feature manifest documents the new prop behaviour",()=>assert.ok(ai.includes("NOT IN SCREENPLAY:")&&ai.includes("REFERENCE IMAGE (own image vs text only)")&&ai.includes("EXTRACTION BOUNDARIES")&&ai.includes("SCENE MAPPING is deterministic")));
console.log(`${checks} checks passed`);

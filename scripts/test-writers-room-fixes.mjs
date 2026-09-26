/* Writers' Room correctness fixes (2026-09-25): driver names in prompts, screenplay
   evidence for character drafting, the cast voice block, the spine brief, continuity
   facts, genre, framework-aware turns, scene delete and the Doctor's issue count. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=(name,f)=>{f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const ai=read("app/ai.jsx"), aiAst=parseSync(ai,{sourceType:"script"});
const box={console}; box.window=box; vm.createContext(box);
const load=(src,ast,names)=>names.forEach(n=>{
  const node=ast.program.body.find(x=>x.type==="FunctionDeclaration"&&x.id.name===n);
  assert.ok(node,"missing function "+n); vm.runInContext(src.slice(node.start,node.end),box);
});
load(ai,aiAst,["driverNameOf","draftParagraphs","scriptEvidenceFor"]);

test("prompts name the driver from this film's cast, not a sample-story map",()=>{
  const cast=[{id:"anna",name:"Anna Ferreira"}];
  assert.equal(box.driverNameOf({driver:"anna"},cast),"Anna Ferreira");
  box.turnCast=[{id:"ben",name:"Ben Okafor"}];
  assert.equal(box.driverNameOf({driver:"ben"}),"Ben Okafor");
  assert.equal(box.driverNameOf({driver:"night_porter"},[]),"Night Porter");
  delete box.turnCast;
  assert.ok(!ai.includes("DRIVER_NAME"));
});

const drafts={s1:{blocks:[{type:"scene",text:"INT. KITCHEN - NIGHT"},{type:"action",text:"Marcus opens the notebook."},
  {type:"char",text:"MARCUS"},{type:"paren",text:"quietly"},{type:"dia",text:"I kept every dose."},{type:"action",text:"Daniel stares."}]}};
test("saved drafts render as screenplay paragraphs",()=>{
  assert.equal(box.draftParagraphs(drafts.s1),"INT. KITCHEN - NIGHT\n\nMarcus opens the notebook.\n\nMARCUS: (quietly) I kept every dose.\n\nDaniel stares.");
  assert.equal(box.draftParagraphs("plain text"),"plain text");
});
test("character drafting receives the script's own lines about the character",()=>{
  const ev=box.scriptEvidenceFor("Marcus Tillmon",[{id:"s1",no:1}],drafts);
  assert.ok(ev.includes("Marcus opens the notebook.")&&ev.includes("I kept every dose."),ev);
  assert.ok(!ev.includes("object Object"));
});


// ---- 3. the cast voice block survives the story build ----
const agents=read("app/agents.jsx");
test("the story build keeps each character's voice block",()=>{
  assert.ok(/\.\.\.\(c\.voice && typeof c\.voice==="object" \? \{ voice:\{\.\.\.c\.voice\} \} : \{\}\)/.test(agents));
});

// ---- 4. spine, world and contract read the whole brief ----
test("the spine, world and contract prompts read the whole brief",()=>{
  assert.ok(!/String\(brief\)\.slice\(0,1600\)/.test(ai)&&!/String\(brief\)\.slice\(0,2600\)/.test(ai)&&!/String\(brief\|\|""\)\.slice\(0,2000\)/.test(ai));
  assert.equal((ai.match(/clipAtBoundary\(String\(brief(\|\|"")?\), 4000\)/g)||[]).length,3);
});

// ---- 5. continuity ledger ----
vm.runInContext("function scrubBrand(s){return String(s)} function scenesInStoryOrder(s){return s}",box);
load(ai,aiAst,["continuityLedgerFrom","continuityLedgerSig"]);
const film=[{id:"a",no:1,summary:"Mara finds the key."},{id:"b",no:2,summary:"She hides it."},{id:"c",no:3,summary:"The vault opens."}];
test("the continuity ledger maps facts onto real scenes only",()=>{
  const L=box.continuityLedgerFrom({facts:[
    {key:"Brass Key",label:"the brass key",established:1,references:[3,9],setup:true},
    {key:"vault_code",label:"the vault code",established:null,references:[3]},
    {key:"ghost",label:"nothing real",established:42,references:[]},
    {key:"brass_key",label:"duplicate",established:2,references:[]}]},film);
  assert.deepEqual(plain(Object.keys(L.facts)),["brass_key","vault_code"]);
  assert.equal(L.facts.brass_key.setup,true);
  assert.deepEqual(plain(L.map.a.establishes),["brass_key"]);
  assert.deepEqual(plain(L.map.c.references),["brass_key","vault_code"]);
  assert.deepEqual(plain(L.map.b),{establishes:[],references:[]});
});
test("the ledger fingerprint changes when the script changes",()=>{
  const d1={a:{blocks:[{type:"action",text:"Mara finds the key."}]}}, d2={a:{blocks:[{type:"action",text:"Mara finds a knife."}]}};
  assert.notEqual(box.continuityLedgerSig(film,d1),box.continuityLedgerSig(film,d2));
  assert.equal(box.continuityLedgerSig(film,d1),box.continuityLedgerSig(film,d1));
});
const script=read("app/script.jsx"), app=read("app/app.jsx");
test("an unmapped film is never reported as continuity-clean",()=>{
  assert.ok(script.includes("Continuity \\u00b7 not mapped")&&script.includes("Build continuity ledger"));
  assert.ok(app.includes("project, facts:storyFacts,")&&!app.includes("facts:FACTS"));
  assert.ok(agents.includes("ctx.ai.continuityLedger()")&&agents.includes("continuityFacts: undefined, continuityLedger: undefined"));
});

test("every story build maps continuity once the scenes are written",()=>{
  const build=agents.slice(agents.indexOf("async function agentAdaptation"),agents.indexOf("async function agentTableRead"));
  assert.equal((build.match(/await buildContinuityLedgerStep\(ctx\);/g)||[]).length,2);
  const step=agents.slice(agents.indexOf("async function buildContinuityLedgerStep"),agents.indexOf("async function agentAdaptation"));
  assert.ok(step.includes("}catch(e){")&&step.includes("The film is fine"));
  assert.ok(read("docs/Story Pipeline.md").includes("**Continuity ledger** *(added 2026-09-25 by owner-delegated decision)*"));
});

// ---- 6. genre ----
load(ai,aiAst,["genreTag"]);
test("a blank genre never prints 'FILM: Title — .'",()=>{
  assert.equal(box.genreTag({genre:"  "}),"");
  assert.equal(box.genreTag({genre:"psychological thriller"})," — psychological thriller");
  assert.ok(!/\+\(P\.genre\|\|""\)/.test(ai)&&!/\$\{P\.genre\|\|""\}/.test(ai));
  assert.ok(ai.includes('{"genre":"1-3 words naming the genre')&&agents.includes('genre: world ? (world.genre || "") : (base.genre || ""),'));
});

// ---- 7. beat authoring: framework-aware turn, and the writer's card is kept ----
{
  const fw=read("app/frameworks.jsx"); vm.runInContext(fw,box);
  load(ai,aiAst,["writingProjectOf","writingLoglineOf","synopsisParasOf","protagonistOf","characterInnerBrief","castMemberByLabel","sceneReactorOf","storyContext","clampCharge","_beatChg","aiAuthorScene"]);
  vm.runInContext("var CONFLICT_LEVELS={};",box);
  vm.runInContext("var SELF_CONTAINED_BEATS='';",box);
  Object.assign(box,{aiAvailable:()=>true,castPronounBlock:()=>"",conflictModeBrief:()=>"",writingStamp:()=>"t",chargeStr:v=>String(v),extractJSON:JSON.parse,contractBrief:()=>""});
  let reply, sent;
  box.claude={complete:async o=>{sent=o.messages[0].content;return JSON.stringify(reply);}};
  const cast=[{id:"mara",name:"Mara Vey"},{id:"ivo",name:"Ivo"}];
  const beatsReply={beats:[{drive:{a:"Asks",d:"Mara asks"},react:{a:"Refuses",d:"Ivo refuses"}}],driverLabel:"IVO",reactorLabel:"MARA"};
  const card={id:"s",no:4,title:"The Offer",loc:"INT. SHOP - DAY",summary:"Mara makes her offer.",driver:"mara",objective:"",
    openValue:"Hope",openCharge:2,closeValue:"Hope",closeCharge:1,kind:"normal"};
  const run=async()=>{
    reply={...beatsReply,title:"Something Else",driver:"ivo",openCharge:-3,closeCharge:3,objective:"to close the deal"};
    const kept=await box.aiAuthorScene(card,null,cast,{framework:"threeact"},{keepCard:true});
    assert.deepEqual(plain(kept.patch),{objective:"to close the deal"});
    assert.equal(kept.beats.driverLabel,"MARA VEY");
    assert.ok(sent.includes("Driver: Mara Vey.")&&sent.includes("The card's value turn is fixed"));
    // the story build may rework its own spine, and a normal three-act scene must turn
    reply={...beatsReply,openCharge:2,closeCharge:1};
    const built=await box.aiAuthorScene(card,null,cast,{framework:"threeact"});
    assert.ok(built.patch.closeCharge<0);
    // a Resolution scene (exempt) may settle; the build does not force a flip
    const res=await box.aiAuthorScene({...card,kind:"resolution"},null,cast,{framework:"threeact"});
    assert.equal(res.patch.closeCharge,1);
    assert.ok(sent.includes("does not require a reversal"));
    // kishōtenketsu Ki/Shō: only an inert 0→0 scene is flagged
    const ki=await box.aiAuthorScene({...card,act:1,kind:"plant"},null,cast,{framework:"kishotenketsu"});
    assert.equal(ki.patch.closeCharge,1);
    checks++; console.log("PASS beat authoring respects the framework's turn rule and the writer's card");
  };
  await run();
}
test("Writers' Room drafting passes keepCard; the story build does not",()=>{
  assert.equal((app.match(/aiAuthorScene\(s, prev, characters, project, \{ keepCard:true \}\)/g)||[]).length,2);
  assert.ok(app.includes("authorScene:(s,p)=>window.aiAuthorScene(s,p,model.characters,model.project,{scenes:model.scenes}),"));
  assert.ok(app.includes("draftScene:(s,b,p)=>window.aiDraftScene(s,b,p,model.project,model.characters,model.scenes),"));
});

// ---- 8. scene delete: confirmation + undo ----
test("deleting a scene asks first and can be undone with its beats and draft",()=>{
  const del=app.slice(app.indexOf("const deleteScene = async (id)=>{"),app.indexOf("const reorderScenes"));
  assert.ok(del.includes("window.appConfirm")&&del.includes("setDeletedScene({ owner:currentProjectId"));
  assert.ok(del.includes("const undoDeleteScene = ()=>{")&&del.includes("setBeatsMap(m=> m[id] ? m : {...m,[id]:d.beats})"));
  assert.ok(app.includes('className:"agent-undo scene-undo"'));
});

// ---- 9. the Doctor's badge counts the Doctor's own audit ----
test("the Story Editors issue count is the Doctor's full audit",()=>{
  assert.ok(app.includes("const list = window.auditSpine(scenesInStoryOrder(scenes));")&&app.includes("doctor: doctorIssues, doctorNoTurn: doctorAudit.noTurn"));
  // the banner never calls the Doctor's other notes "scenes that don't turn"
  const ui=read("app/agents-ui.jsx");
  assert.ok(ui.includes("iss.doctorNoTurn")&&ui.includes("iss.doctorNotes")&&ui.includes('className:"ag-issues-row notes"'));
  assert.ok(app.includes("notes:list.filter(i=>!(Number(i.sev)>0)).length")&&app.includes("doctorNotes: doctorAudit.notes"));
});

process.on("exit",()=>console.log(checks+" checks passed"));

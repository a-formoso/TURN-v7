#!/usr/bin/env node
/* END FRAMES (owner 2026-11-22: "end frames per beat"; then "go ahead with stage 2"). The scene plan, stage 2.

   The last shot of each beat of a planned scene has a second picture, its end frame: the same shot as it ENDS. The
   first shot of the next beat is seeded from it. The end frame is never a row of the shot list: it is the picture
   "<shot id>-end", and shotEndShot() stands for it wherever a shot is needed (its seed, its stamps, its turn in a
   run), so every rule a frame follows holds for it unchanged.

     1. which shots carry one, and its ids
     2. the seed rule: an end frame builds on its own shot; the next beat starts from the end frame
     3. out of date: a re-made shot frame puts its end frame out of date, a re-made end frame the next opening
     4. the prompt: same camera and framing, the shot's last instant, the plan's end state, no line about to be spoken
     5. the card, the ordered run and what it asks
     6. what Frances is told, the pipeline, the keys

   No browser, no network, no paid call. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
const shotsSrc=read("app/shots.jsx"), ui=read("app/shots-ui.jsx"), ai=read("app/ai.jsx"), html=read("TURN.html"),
  pipe=read("docs/Story Pipeline.md"), css=read("app/styles.css"), breakdown=read("app/breakdown.jsx");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }
  catch(e){ fail++; console.log("FAIL "+name+"\n    "+(process.env.FULL?String(e&&e.stack||e):String(e&&e.message||e).split("\n")[0])); } };
const plain=v=>JSON.parse(JSON.stringify(v));

const box={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat,setTimeout,clearTimeout,
  document:{createElement:()=>({getContext:()=>({measureText:()=>({width:1}),fillRect(){},fillText(){}}),toDataURL:()=>""})},turnContinuity:{},
  CustomEvent:(type,init)=>({type,detail:init&&init.detail}),dispatchEvent:()=>{}};
box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx","app/scene-plan.js"]) vm.runInContext(read(f),box,{filename:f});

/* a planned scene of three beats: beat 1 has two moments, beat 2 one shot, beat 3 one shot with no end state */
const endA={people:{amira:{where:"m-counter",pose:"standing",holding:["tupperware"]}},things:{keys:{at:"m-counter"}},doors:[{id:"back-door",open:true}]};
const shots=[
  {id:"b1",sceneId:"s5",beatN:1,order:1,keyframeMode:"beat-opening",moment:{n:1,of:2},planned:true,subjectsByPlan:true,subjects:["amira"],size:"WS",angle:"eye",lens:"32",move:"static",
    action:"Amira packs rice.",endState:{people:{amira:{where:"m-counter",pose:"standing",holding:[]}}}},
  {id:"b1m2",sceneId:"s5",beatN:1,order:1.02,keyframeMode:"moment",moment:{n:2,of:2},planned:true,subjectsByPlan:true,subjects:["yusuf"],size:"MCU",angle:"ots",lens:"85",move:"static",
    action:"Yusuf watches from the doorway.",dialogue:"You are not taking the car.",specHash:"h2",specRev:3,locked:true,
    startState:{people:{yusuf:{where:"m-door",pose:"leaning",holding:["keys"]}}},endState:endA},
  {id:"b2",sceneId:"s5",beatN:2,order:2,keyframeMode:"beat-opening",planned:true,subjectsByPlan:true,subjects:["amira","yusuf"],size:"MS",angle:"eye",lens:"50",move:"static",
    action:"He puts the keys down.",endState:{people:{yusuf:{where:"m-door",pose:"standing",holding:[]}}}},
  {id:"b3",sceneId:"s5",beatN:3,order:3,keyframeMode:"beat-opening",planned:true,subjects:["amira"],size:"WS",angle:"eye",lens:"32",move:"static",action:"Amira at the rail.",endState:{people:{},things:{},doors:[]}}];
const S=id=>shots.find(x=>x.id===id);

test("1 the last planned shot of a beat carries its end frame; the picture is kept at <shot id>-end", ()=>{
  assert.equal(box.shotEndFrameId("b1m2"),"b1m2-end"); assert.equal(box.shotEndOwnerId("b1m2-end"),"b1m2");
  assert.equal(box.shotEndOwnerId("b1m2"),""); assert.equal(box.shotEndOwnerId("-end"),""); assert.equal(box.shotEndOwnerId(null),"");
  assert.equal(box.shotBeatLastOf(shots.filter(x=>x.beatN===1)).id,"b1m2","the last moment ends the beat");
  assert.equal(box.shotEndFrameWanted(S("b1m2"),shots),true);
  assert.equal(box.shotEndFrameWanted(S("b1"),shots),false,"not the beat's last shot");
  assert.equal(box.shotEndFrameWanted(S("b2"),shots),true,"a beat of one shot ends on it");
  assert.equal(box.shotEndFrameWanted(S("b3"),shots),false,"no end state, no end frame");
  // only a planned shot: a scene with no plan has no end frames
  assert.equal(box.shotEndFrameWanted({...S("b2"),planned:false},shots.map(x=>x.id==="b2"?{...x,planned:false}:x)),false);
  // an old "alternative" shot stored after the last moment never ends the beat
  const alt={id:"b1alt",sceneId:"s5",beatN:1,order:1.5,planned:true,endState:endA};
  assert.equal(box.shotBeatLastOf(shots.filter(x=>x.beatN===1).concat(alt)).id,"b1m2"); assert.equal(box.shotEndFrameWanted(alt,shots.concat(alt)),false);
  // the end frame as a shot: its owner's camera and specification, the people the end state puts in frame, no line
  const e=plain(box.shotEndShot(S("b1m2")));
  assert.equal(e.id,"b1m2-end"); assert.equal(e.endFrameOf,"b1m2"); assert.equal(e.keyframeMode,"beat-end"); assert.equal(e.anchor,false);
  assert.deepEqual([e.size,e.angle,e.lens,e.move,e.beatN,e.sceneId,e.specHash,e.specRev,e.locked],["MCU","ots","85","static",1,"s5","h2",3,true]);
  assert.deepEqual(e.subjects,["amira"]); assert.deepEqual(e.referenceCharacterIds,["amira"]); assert.equal(e.dialogue,"");
  assert.deepEqual(e.startState,endA,"it starts where its shot ends"); assert.deepEqual(e.endState,endA);
  assert.equal(box.shotEndFrameWanted(box.shotEndShot(S("b1m2")),shots),false,"an end frame has no end frame of its own");
  assert.deepEqual(plain(box.shotEndShotsOf(shots).map(x=>x.id)),["b1m2-end","b2-end"]);
  assert.equal(box.shotEndShot(null),null);
});

test("2 an end frame builds on its own shot's frame, and the next beat starts from the end frame", ()=>{
  const seed=(sh,list)=>{ const x=box.seedShotOf(sh,list||shots); return x ? x.id : null; };
  assert.equal(seed(box.shotEndShot(S("b1m2"))),"b1m2");
  assert.equal(seed(S("b2")),"b1m2-end","beat 2 opens from how beat 1 ended (it used to open from beat 1's first frame)");
  assert.equal(box.seedShotOf(S("b2"),shots).endFrameOf,"b1m2");
  assert.equal(seed(S("b3")),"b2-end");
  // inside a beat nothing changed: a later moment builds on the one before; the scene's first shot is a head
  assert.equal(seed(S("b1m2")),"b1"); assert.equal(seed(S("b1")),null);
  // a fresh start still cuts the chain; an end frame of a shot that is gone has no seed
  assert.equal(seed({...S("b2"),anchor:true}),null); assert.equal(seed({id:"x-end",endFrameOf:"x",sceneId:"s5",beatN:1}),null);
  // a scene with no plan keeps the old rule: the earlier beat's opening shot
  const old=shots.map(x=>({...x,planned:false}));
  assert.equal(seed(old[2],old),"b1"); assert.equal(seed(old[3],old),"b2");
  // the label a card, a notice or a run shows for it
  assert.equal(box.shotBeatDisplayLabel(box.shotEndShot(S("b1m2")),shots.filter(x=>x.beatN===1)),"Beat 1 · End frame");
  assert.equal(box.shotBeatDisplayLabel(S("b1m2"),shots.filter(x=>x.beatN===1)),"Beat 1 · Moment 2");
  // the scene's own order of shots is untouched: end frames are never rows of the list
  assert.deepEqual(plain(box.sceneShotsDependencyOrdered(shots).map(x=>x.id)),["b1","b1m2","b2","b3"]);
});

test("3 out of date follows the chain: a re-made shot frame, then its end frame, then the next opening", ()=>{
  const metas={};
  const getMeta=id=>metas[id]||null;
  const stamp=(seed)=>box.shotSeedStamp(seed,getMeta(seed.id));
  const end=box.shotEndShot(S("b1m2"));
  metas["b1m2"]={version:1,iso:"t1"};
  metas["b1m2-end"]={version:1,iso:"t2",seedSource:stamp(S("b1m2"))};
  metas["b2"]={version:1,iso:"t3",seedSource:stamp(end)};
  assert.deepEqual(plain(metas["b2"].seedSource),{seedShotId:"b1m2-end",seedVersion:1,seedIso:"t2"});
  assert.equal(box.shotChainStatus(end,shots,getMeta),"current"); assert.equal(box.shotChainStatus(S("b2"),shots,getMeta),"current");
  // the shot's frame is made again: its end frame is out of date, the next opening not yet (its seed is unchanged)
  metas["b1m2"]={version:2,iso:"t4"};
  assert.equal(box.shotChainStatus(end,shots,getMeta),"stale"); assert.equal(box.shotChainStatus(S("b2"),shots,getMeta),"current");
  // the end frame is made again: now the next beat's opening is out of date
  metas["b1m2-end"]={version:2,iso:"t5",seedSource:stamp(S("b1m2"))};
  assert.equal(box.shotChainStatus(end,shots,getMeta),"current"); assert.equal(box.shotChainStatus(S("b2"),shots,getMeta),"stale");
  // an opening made BEFORE end frames (seeded from the earlier beat's first shot) reads as out of date in a planned scene
  metas["b2"]={version:1,iso:"t3",seedSource:{seedShotId:"b1",seedVersion:1,seedIso:"t0"}};
  assert.equal(box.shotChainStatus(S("b2"),shots,getMeta),"stale");
  // an end frame not made yet has nothing to judge
  assert.equal(box.shotChainStatus(box.shotEndShot(S("b2")),shots,getMeta),"");
});

test("4 the prompt of an end frame: same camera and framing, the last instant, the plan's end state, nobody about to speak", ()=>{
  const scene={id:"s5",no:5,title:"The Lunch Box",loc:"INT. HUSSAIN KITCHEN - NIGHT"};
  const blocks=[{type:"scene",text:"INT. HUSSAIN KITCHEN - NIGHT",beat:1},{type:"action",text:"AMIRA HUSSAIN packs rice into a Tupperware at the counter.",beat:1},
    {type:"action",text:"YUSUF HUSSAIN watches from the doorway, car keys in his hand.",beat:1},{type:"dia",text:"You are not taking the car.",beat:1},
    {type:"action",text:"He puts the keys down.",beat:2}];
  const chars=[{id:"amira",name:"AMIRA HUSSAIN"},{id:"yusuf",name:"YUSUF HUSSAIN"}];
  const plan={marks:[{id:"m-counter",set:"set1",name:"at the counter"},{id:"m-door",set:"set1",name:"in the doorway"}],
    things:[{key:"tupperware",name:"Tupperware",kind:"prop"},{key:"keys",name:"the car keys",kind:"prop"}],fixed:[{id:"back-door",name:"Back door",set:"set1",kind:"opening"}]};
  const ctx={scene,location:null,project:{id:"f",scenePlans:{s5:plan}},charById:{amira:chars[0],yusuf:chars[1]},propById:{},drafts:{s5:{version:"v1",blocks}},scenes:[scene]};
  const owner=S("b1m2"), end=box.shotEndShot(owner);
  assert.equal(box.shotEndStateText(owner,ctx),"AMIRA HUSSAIN at the counter, standing, holding the Tupperware. The car keys: at the counter. Doors: the back door open.");
  const p=box.buildShotPrompt(end,{...ctx,prevShot:owner,prevFrameRole:true});
  for(const t of ["THIS SAME SHOT AS IT BEGINS — keep its camera position, framing, lens, set, light, colour grade, faces and wardrobe exactly; change only what has changed by the END of the shot",
    "As the shot ends: AMIRA HUSSAIN at the counter, standing, holding the Tupperware",
    "Stage the LAST instant of this shot — its action finished, everyone and everything where the shot leaves them; this frame ends the moving clip"])
    assert.ok(p.includes(t),"an end frame is told: "+t.slice(0,60));
  assert.ok(!p.includes("do NOT copy its framing"),"it keeps its shot's framing");
  assert.ok(!/Stage the (?:beat's )?OPENING instant/.test(p)&&!p.includes("About to speak"),"never an opening instant, nobody about to speak");
  assert.ok(!/OPENING ACTION \(|SCREENPLAY OPENING SOURCE/.test(p));
  if(p.includes("END STATE (")) assert.ok(p.includes("END STATE (how this shot ends, from the scene plan; this is the shot's LAST frame, not its first): AMIRA HUSSAIN at the counter"));
  // the shot's own frame is told what it always was
  const q=box.buildShotPrompt(owner,{...ctx,prevShot:S("b1"),prevFrameRole:true});
  assert.ok(q.includes("the REFERENCE frame — carry its colour grade, lighting and every established physical state (wardrobe wear, wetness, dirt, damage) forward exactly, but do NOT copy its framing"));
  assert.ok(/Stage the OPENING instant|Stage the beat's OPENING instant/.test(q)&&!q.includes("THIS SAME SHOT AS IT BEGINS")&&!q.includes("LAST instant"));
  // nothing an engine is told names a vendor or the codename
  assert.ok(!/Anthropic|Claude|OpenAI|Gemini|GPT|McKee|Fable|Opus|\bTURN\b/.test(p));
  // with no scene plan helper at hand the words are simply left out (never an id shown as a name)
  const SP=box.ScenePlan; box.ScenePlan=null; assert.equal(box.shotEndStateText(owner,ctx),""); box.ScenePlan=SP;
});

/* the end frame through the real frame factory, with a stand-in image store: what it builds on, what it records, what it sends */
await (async ()=>{
  const name="4b through the frame factory: it builds on its shot's frame, records that frame as its seed, and the next opening records the end frame";
  try{
    const from=ui.indexOf("function shotFrameGenOpts("), to=ui.indexOf("\nwindow.shotFrameGenOpts",from);
    vm.runInContext(ui.slice(from,to)+"\nwindow.shotFrameGenOpts=shotFrameGenOpts;",box,{filename:"app/shots-ui.jsx#shotFrameGenOpts"});
    const images={b1m2:"img://b1m2","b1m2-end":"img://b1m2-end",amira:"img://amira",yusuf:"img://yusuf"}, metas={b1m2:{version:4,iso:"t4"},"b1m2-end":{version:2,iso:"t9"}};
    Object.assign(box,{nbEpoch:()=>1,nbAssertMediaIdentity:()=>{},shotGrabImage:async id=>images[id]||"",nbGetImage:id=>images[id]||"",nbLoadImage:async id=>images[id]||null,
      nbGetMeta:id=>metas[id]||null,nbPreferBestAssetRefs:r=>r,nbAssetRoleLabel:id=>id,nbAssetRolePriority:()=>0});
    const scene={id:"s5",no:5,title:"The Lunch Box",loc:"INT. HUSSAIN KITCHEN - NIGHT"};
    const blocks=[{type:"scene",text:"INT. HUSSAIN KITCHEN - NIGHT",beat:1},{type:"action",text:"AMIRA HUSSAIN packs rice into a Tupperware at the counter.",beat:1},
      {type:"action",text:"YUSUF HUSSAIN watches from the doorway, car keys in his hand.",beat:1},{type:"action",text:"He puts the keys down.",beat:2},{type:"action",text:"Amira stands at the rail.",beat:3}];
    const ctx={filmId:"f",scene,location:null,project:{id:"f",scenePlans:{s5:{marks:[{id:"m-counter",name:"at the counter"}],things:[{key:"tupperware",name:"Tupperware"},{key:"keys",name:"the car keys"}],fixed:[{id:"back-door",name:"Back door"}]}}},
      charById:{amira:{id:"amira",name:"AMIRA HUSSAIN"},yusuf:{id:"yusuf",name:"YUSUF HUSSAIN"}},propById:{},drafts:{s5:{version:"v1",blocks}},scenes:[scene],referenceBudget:14};
    box.turnContinuity={drafts:ctx.drafts};
    const owner=S("b1m2"), end=box.shotEndShot(owner);
    const pack=box.shotFrameGenOpts(end,shots,ctx);
    assert.equal(pack.opts.id,"b1m2-end"); assert.equal(pack.opts.slotId,"shot-b1m2-end"); assert.equal(pack.prevShot.id,"b1m2");
    assert.equal(await pack.opts.referenceFallback({}),"img://b1m2","made from its own shot's frame");
    assert.equal(await pack.opts.referenceFallback({fresh:true}),null);
    const chain=pack.opts.buildFromBase();
    assert.ok(chain.includes("THIS SAME SHOT AS IT BEGINS")&&chain.includes("As the shot ends: AMIRA HUSSAIN at the counter, standing, holding the Tupperware")&&chain.includes("Stage the LAST instant of this shot"));
    const meta=await pack.opts.metaStart({});
    assert.deepEqual(plain(meta.seedSource),{seedShotId:"b1m2",seedVersion:4,seedIso:"t4"},"its lineage is its shot's frame (an approved shot: no unapproved mark)");
    // MADE AS AN EDIT of its shot's frame (it keeps the camera): still stamped as a new frame, with its seed; a later
    // edit by hand reworks it in place and keeps what it was made from
    const made=await pack.opts.metaStart({gopts:{editInstruction:"show this SAME shot a few seconds later",endFrameMake:true,editBaseUrl:"img://b1m2"}});
    assert.deepEqual(plain(made.seedSource),{seedShotId:"b1m2",seedVersion:4,seedIso:"t4"});
    metas["b1m2-end"]={version:2,iso:"t9",seedSource:{seedShotId:"b1m2",seedVersion:3,seedIso:"t3"},shotSource:{shotId:"b1m2-end",specHash:"old"}};
    const reworked=await pack.opts.metaStart({gopts:{editInstruction:"brighten the hall"}});
    assert.deepEqual(plain(reworked.seedSource),{seedShotId:"b1m2",seedVersion:3,seedIso:"t3"}); assert.equal(plain(reworked.shotSource).specHash,"old");
    metas["b1m2-end"]={version:2,iso:"t9"};
    const editPrompt=pack.opts.buildEdit("show this SAME shot a few seconds later, as it ENDS",[],undefined);
    assert.ok(editPrompt.startsWith("Edit this film frame. Apply ONLY this change: show this SAME shot a few seconds later, as it ENDS. Keep the same shot size, lens, staging,"));
    assert.equal(plain(meta.shotSource).shotId,"b1m2-end"); // its specification stamp is worked out from its shot's own fields: a changed shot puts its end frame out of date
    const stampOf=sh=>plain(box.shotSourceStamp(box.shotEndShot(sh),ctx.drafts.s5)).specHash;
    assert.equal(plain(meta.shotSource).specHash,stampOf(owner)); assert.notEqual(stampOf({...owner,size:"WS"}),stampOf(owner));
    assert.notEqual(stampOf({...owner,endState:{people:{amira:{where:"m-door",pose:"standing",holding:[]}}}}),stampOf(owner),"another end state is another end frame");
    // its sheets resolve as a frame's do: the person its end state puts in frame, never the shot's opening cast
    const refs=await pack.opts.attachments();
    assert.ok(refs.some(r=>r&&r.url==="img://amira")&&!refs.some(r=>r&&r.url==="img://yusuf"));
    // the next beat's opening: its base image and its recorded seed are the end frame
    const next=box.shotFrameGenOpts(S("b2"),shots,ctx);
    assert.equal(next.prevShot.id,"b1m2-end"); assert.equal(await next.opts.referenceFallback({}),"img://b1m2-end");
    assert.deepEqual(plain((await next.opts.metaStart({})).seedSource),{seedShotId:"b1m2-end",seedVersion:2,seedIso:"t9"});
    // an end frame whose shot is not approved says so on what is made from it
    const loose=shots.map(x=>x.id==="b1m2"?{...x,locked:false}:x);
    assert.equal(plain((await box.shotFrameGenOpts(loose[2],loose,ctx).opts.metaStart({})).seedSource).seedUnapproved,true);
    // with the end frame not made yet, the next opening has no base image (the run makes the end frame first)
    delete images["b1m2-end"]; assert.equal(await next.opts.referenceFallback({}),null);
    pass++; console.log("PASS "+name);
  }catch(e){ fail++; console.log("FAIL "+name+"\n    "+(process.env.FULL?String(e&&e.stack||e):String(e&&e.message||e).split("\n")[0])); }
})();

test("5 the card, the ordered run and what it asks", ()=>{
  // the card: its own always-mounted part on the beat's last planned shot, through the same factory as a frame
  assert.ok(ui.includes('slot("endFrame", (typeof shotEndFrameWanted==="function" && shotEndFrameWanted(sh, sceneShots||[]))\n        && _el(ShotEndFrame,{key:"end-"+sh.id,sh,sceneShots,ctx,onView,batchActiveId,onBatchDone,onGenerateShot,onStopChain,beatLabel,readOnly})),'));
  // (beat-first layout: the end frame is outside every folded part of the open shot, so its own generator is always in the page)
  assert.ok(ui.includes("    faceSlots.endFrame,\n    _el(\"details\",{className:\"sbc-adv\""),"always mounted, before Advanced");
  const comp=ui.slice(ui.indexOf("function ShotEndFrame("),ui.indexOf('const CONF_LABELS = ["Inner","Personal","Extra-personal"];'));
  for(const t of ["const end = shotEndShot(sh);","const pack = shotFrameGenOpts(end, sceneShots||[], ctx);","const gen = useImageGen(pack.opts);",
    'const mine = batchActiveId===end.id;','onBatchDone && onBatchDone(end.id)','onGenerateShot(end.id)',
    '_el(CardFold,{label:"End frame",count:state,defaultOpen:false,foldId:"shot-end-"+sh.id},','"How this shot ends"',
    'const state = gen.gening ? "making\\u2026" : !gen.genUrl ? "not made yet" : chainStatus==="stale" ? "out of date" : "made";',
    "Promise.resolve().then(()=>makeOpts()).then(o=>gen.generate(o)).then(settle, settle);","const base = { endFrameMake:true, editBaseUrl:from,",
    'editInstruction:"show this SAME shot a few seconds later, as it ENDS. The camera has not moved: same position, same framing, same lens, same set and light. By then: "',
    "generateDisabled:readOnly || waiting || !ownerFrame,",'"Make this shot\'s frame first"','noun:"end frame"',"hideUploadButton:true"])
    assert.ok(comp.includes(t),"the end frame part has "+t);
  // the image hook takes the handed-over base as the picture to edit, on a slot that has no image yet
  assert.ok(read("app/artroom.jsx").includes("const isEditMode = !!(gopts.editInstruction && (genUrl || gopts.editBaseUrl));")
    && read("app/artroom.jsx").includes('if(isEditMode){ refImage = gopts.editBaseUrl || genUrl; mode = "edit"; }'));
  assert.ok(comp.indexOf("useImageGen(pack.opts)")<comp.indexOf("_el(CardFold,"),"its generator is mounted with the card, outside the fold");
  assert.ok(!/Fable|Opus|Claude|Nano|\bTURN\b|MUSE/.test(comp.replace(/owner 2026[^\n]*/g,"")));
  // a run's step belongs to a card for its own frame or its end frame, wherever cards are matched to the step
  const b={}; vm.createContext(b); b.shotEndFrameId=box.shotEndFrameId;
  vm.runInContext(ui.slice(ui.indexOf("function shotRunsHere("),ui.indexOf("/* a labelled grammar dropdown"))+";globalThis.f=shotRunsHere;",b);
  assert.equal(b.f({id:"b2"},"b2"),true); assert.equal(b.f({id:"b2"},"b2-end"),true); assert.equal(b.f({id:"b2"},"b3"),false); assert.equal(b.f({id:"b2"},null),false);
  // (8 since the beat-first layout: the open shot's own card, and the beat's row, which shows the shot a run is making)
  assert.equal(ui.split("shotRunsHere(sh,batchActiveId)").length-1,9);   // (9 since 2026-11-27: the beat a run is working in comes up by itself)
  assert.ok(!/sh\.id===batchActiveId\?batchActiveId:null|ordered\.find\(sh=>sh\.id===batchActiveId\)|L\.shots\.find\(sh=>sh\.id===batchActiveId\)/.test(ui));
  // the run: an end frame has its turn right after its shot; it is in the price; its step writes no approval
  assert.ok(ui.includes('.flatMap(s=> (typeof shotEndFrameWanted==="function" && shotEndFrameWanted(s, list||[])) ? [s.id, shotEndFrameId(s.id)] : [s.id]);'));
  assert.ok(ui.includes('if(typeof shotEndShotsOf==="function") Object.keys(by).forEach(sid=> shotEndShotsOf(by[sid]).forEach(e=>{ m[e.id]=e; }));'));
  assert.ok(ui.includes("const lockStep = (id, on)=>{ if(!isEndStep(id)) onUpdateShot(id, { locked:!!on }); };"));
  const run=ui.slice(ui.indexOf("const stepChain = (ids, fromIdx, force, unlock)=>{"),ui.indexOf("const stopPaused = ()=>"));
  assert.ok(!/onUpdateShot\([^)]*locked:/.test(run),"every approval a run writes goes through lockStep");
  assert.equal(run.split("lockStep(").length-1,3);
  assert.ok(ui.includes('": the last frame of a beat, which the next beat starts from.")(plan.toRender.filter(isEndStep).length)'));
  assert.ok(ui.includes('const at=target.endFrameOf ? orderedShots.findIndex(s=>s.id===target.endFrameOf) : orderedShots.findIndex(s=>s.id===id);'));
  // the unapproved-seed question names the right frame to approve when the seed is an end frame
  assert.ok(ui.includes('(unapproved.endFrameOf ? "An end frame is approved with its shot: \u201cApprove frame as seed\u201d in that shot\'s image Options menu is the continuity gate"'));
  // the film button names shots, its price is every frame; the scene's To do counts end frames still to make
  assert.ok(ui.includes('("Generate "+filmShotN+" shot"+(filmShotN!==1?"s":""))')&&ui.includes("window.nbCostChip(filmPlan.toRender.length)"));
  assert.ok(ui.includes('endTodo>0 && endTodo+" end frame"+(endTodo!==1?"s":"")+" to make",'));
  // what follows a frame counts across a beat's end frame
  assert.ok(ui.includes("if(sd && dep.has(sd.endFrameOf||sd.id)){ dep.add(s.id); n++; }")&&breakdown.includes("if(seed && will.has(seed.endFrameOf||seed.id)){ will.add(sh.id); cascade++; } else done++; }"));
  // the next beat's first card says where it starts from
  assert.ok(ui.includes('(prevShot && prevShot.endFrameOf) && _el("div",{className:"shot-plan-from","data-testid":"shot-starts-from"},\n        "Starts from the end frame of beat "+prevShot.beatN+": the picture of how that beat ended.")),'));
  for(const c of [".shot-end{",".shot-end-head{",".shot-end-lab{",".shot-end-how{",".shot-end-note{",".shot-plan-from{"]) assert.ok(css.includes(c),c);
});

test("6 what Frances is told, the pipeline and the keys", ()=>{
  const line=ai.split("\n").find(l=>l.startsWith("APP_FEATURES.push({ name:\"Shots: a beat's end frame (the scene plan)\""));
  assert.ok(line);
  const b={}; vm.createContext(b);
  vm.runInContext(ai.slice(ai.indexOf("const MUSE_OFF_LIMITS"),ai.indexOf("/* SHOTS REVIEW (owner 2026-10-03)"))+";globalThis.pub=musePublicFeature;globalThis.sent=factSentences;",b);
  const fact=vm.runInContext("("+line.slice("APP_FEATURES.push(".length,-2)+")",b);
  const told=b.pub(fact);
  assert.ok(told&&told.what.length>900);
  assert.equal(b.sent(told.what).length,b.sent(fact.what.replace(/\s+/g," ")).length,"no sentence is dropped as billing, plan or vendor talk");
  assert.ok(!/Anthropic|Claude|OpenAI|Google|Gemini|GPT|Fable|Opus|Sonnet|McKee|\bTURN\b|Cinema Machine|MUSE|credit/i.test(fact.name+" "+fact.what));
  for(const t of ["the section named End frame","the same shot, with the same camera and framing, as it ends","It is made from that shot's own frame, so that frame comes first",
    "the first shot of the next beat starts from the end frame","Render Scene in order makes each end frame right after its shot and before the next beat opens",
    "its end frame says out of date","an end frame is approved with its shot and has no approval of its own","A scene that has no scene plan has no end frames and works as before"])
    assert.ok(fact.what.includes(t),"Frances is told: "+t);
  const shotsPart=pipe.slice(pipe.indexOf("- **Shot List (the convergence tab).**"),pipe.indexOf("### 10. The Stage"));
  assert.ok(shotsPart.includes('**End frames (added 2026-11-22 by owner approval: "end frames per beat", then "go ahead with stage 2").**'));
  for(const t of ["its **end frame**: the same shot, same camera and","**The first shot\n  of the next beat starts from the end frame**","An end frame is approved with its shot",
    "takes a few short writing passes (the\n  staging first, then the shots a few beats at a time)"]) assert.ok(shotsPart.includes(t),"the pipeline says "+t);
  assert.ok(!shotsPart.includes("is one writing pass that reads"));
  assert.ok(pipe.includes('- *(2026-11-22 — Step 9, Shots, end frames, by owner approval: "yes, correct the doc, and go ahead with stage 2")*'));
  assert.equal((pipe.match(/^### \d+\. /gm)||[]).length,11,"no step was added or removed");
  assert.ok(html.includes('app/scene-order.js?v=20261122-end1"'));
  for(const f of ["shots.jsx","shots-ui.jsx","breakdown.jsx","ai.jsx","script.jsx","styles.css"])
    assert.ok(["20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1", "20261127-place1", "20261127-note1"].some(k=>html.includes('app/'+f+'?v='+k+'"')),f+" has a current key");
});

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

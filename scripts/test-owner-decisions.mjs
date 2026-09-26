/* Owner decisions (2026-09-26): signature expressions reach the models as TEXT (the Shot
   Designer's performance register) while the sheet stays neutral; a character sheet is an
   identity-only reference in every shot prompt; the gag-anime backdrop is place-free (and
   four sibling style leaks are fixed); formats show their real labels; a TV Series build
   finishes before it converts to a Show. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const art=read("app/artroom.jsx"), ai=read("app/ai.jsx"), ag=read("app/agents.jsx"), app=read("app/app.jsx"), ui=read("app/agents-ui.jsx");

// the real shot drafter, in a sandbox, with a fake model that records the prompt
const calls=[];
const box={console,localStorage:{removeItem(){}},setTimeout,clearTimeout,performance:{now:()=>0},
  CustomEvent:function(t,i){this.type=t;this.detail=i&&i.detail;}};
box.window=box; box.dispatchEvent=()=>{}; vm.createContext(box);
vm.runInContext(read("app/formats.jsx"),box);
let opening=["ana"], remote=[];
box.shotBeatScreenplay=()=>({hasSource:true,sourceRev:"r1",text:"Ana folds the letter.",openingAction:"Ana folds the letter.",
  openingCharacterIds:opening,physicalCharacterIds:opening,remoteCharacterIds:remote,mentionedCharacterIds:opening,dialogue:[]});
box.writingLoglineOf=()=>"A daughter answers her father's last letter.";
box.window.claude={ async complete(o){ calls.push(o.messages[0].content); return '{"shots":[]}'; } };
vm.runInContext(read("app/ai.jsx"),box);
const scene={id:"s1",no:1,title:"The letter",summary:"Ana reads."};
const beats={s1:{rows:[{n:1,drive:{d:"Reads"},react:{d:"Folds"}}]}};
const cast=[
  {id:"ana",name:"Ana",pronouns:"she/her",expressions:["grief","resolve","tenderness"],signatureGesture:"presses her thumb to her lip"},
  {id:"leo",name:"Leo",pronouns:"he/him",expressions:["anger"],signatureGesture:"cracks his knuckles"},
];

await test("the Shot Designer reads each on-screen character's performance register — as context, not labels",async()=>{
  calls.length=0;
  await box.aiDraftShots(scene,beats,{s1:{blocks:[]}},[],[],cast,{title:"Letters",format:"film"});
  const p=calls[0];
  assert.ok(p.includes("CHARACTER PERFORMANCE REGISTER (film-level, NOT this beat's emotion)"));
  assert.ok(p.includes("Ana — most often plays: grief, resolve, tenderness; signature gesture: presses her thumb to her lip"));
  assert.ok(!p.includes("Leo —"),"only characters in the opening frame");
  assert.ok(/when the beat plays a different feeling, follow the beat. Never write emotion words or labels into composition/.test(p));
  assert.ok(p.includes("composition may describe observable body language grounded in the beat source"));
  // a remote character never gets a register; none at all → no block
  opening=["ana","leo"]; remote=["leo"]; calls.length=0;
  await box.aiDraftShots(scene,beats,{s1:{blocks:[]}},[],[],cast,{title:"Letters",format:"film"});
  assert.ok(!calls[0].includes("Leo —"),"a remote (off-screen) character is not in frame");
  opening=["ana"]; remote=[]; calls.length=0;
  await box.aiDraftShots(scene,beats,{s1:{blocks:[]}},[],[],[{id:"ana",name:"Ana",pronouns:"she/her"}],{title:"Letters",format:"film"});
  assert.ok(!calls[0].includes("PERFORMANCE REGISTER"),"old projects without expressions get the prompt they had");
});

await test("the character sheet stays neutral — no expression row, by design",()=>{
  assert.ok(art.includes("NO EXPRESSION ROW, BY DESIGN"));
  assert.ok(art.includes('no_extra_views: "do not add expression rows'));
  assert.ok(art.includes('"PANEL 1 — large close-up hero FACE PORTRAIT, front-facing, neutral controlled expression'));
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(m.includes("The sheet deliberately has NO expression row")&&m.includes("PERFORMANCE REGISTER"));
  assert.ok(ag.includes("The Shot Designer uses them as film-level acting context"));
});

await test("near-synonym emotions count as one in the signature tally",()=>{
  const b={console}; b.window=b; vm.createContext(b);
  vm.runInContext(ag.slice(ag.indexOf("const _EMOTION_SYNONYMS"),ag.indexOf("/* Returns { drift, reconciled, enriched, exprSet, propScenes }")),b);
  assert.equal(b._emotionKey("Rage"),"anger"); assert.equal(b._emotionKey("fury"),"anger"); assert.equal(b._emotionKey("anger"),"anger");
  assert.equal(b._emotionKey("Sorrow"),"grief"); assert.equal(b._emotionKey("wonder"),"wonder");
});

await test("every shot prompt treats a character sheet as identity only",()=>{
  const s=read("app/shots.jsx");
  assert.ok(s.includes('const SHOT_SHEET_IDENTITY_ONLY = " (identity only: take the face, build, hair and wardrobe from it; never copy its background, pose, lighting or panel layout; its face is neutral by design, so the expression comes from this beat)";'));
  assert.ok(s.includes("canonical scale: \"+scale+SHOT_SHEET_IDENTITY_ONLY;"),"the unresolved image map");
  assert.ok(s.includes('+(r.referenceKind==="character" ? SHOT_SHEET_IDENTITY_ONLY : ""));'),"the resolved image map");
  // an edit keeps the frame's own expression, so its sheets get edit wording (no "from this beat")
  assert.ok(read("app/shots-ui.jsx").includes('+(r.referenceKind==="character" ? " (identity only: take the face, build, hair and wardrobe from it; never copy its background, pose, lighting or panel layout)" : "")'),"the edit path's reference order");
});

await test("gag-anime is place-free with no lettering; sibling style leaks are fixed",()=>{
  const g=art.slice(art.indexOf("  gaganime: {"),art.indexOf("\n  },",art.indexOf("  gaganime: {")));
  assert.ok(!/bridge|skyline|coastal|graffiti|"typography"|poster|low-angle|concept-art sheet/.test(g),g.slice(0,200));
  assert.ok(g.includes('"rules": ["no text, labels, watermarks, annotations, typography or captions"'));
  assert.ok(/no scenery, buildings, landmarks or objects/.test(g)&&/THIS character's own colours/.test(g));
  assert.ok(read("app/locations.jsx").includes('gaganime:  "1990s gag-anime 2D cartoon background, thick bold black outlines, flat high-saturation colors, simple graphic shapes, sticker-like finish"'));
  assert.ok(read("app/props.jsx").includes("simple graphic shadows, sticker-like finish"));
  assert.ok(!art.includes("venetian-blind")&&!art.includes("rain-streaked highlights"),"noir no longer casts blinds and rain on every sheet");
  const gtaLoc=read("app/locations.jsx").match(/\n  gtaLoadingScreen:"[^"]+"/)[0];
  assert.ok(!/streets|sunset/.test(gtaLoc)&&/this plate's own time of day/.test(gtaLoc),"a GTA plate keeps its own time of day");
  assert.ok(!/sunset/.test(read("app/props.jsx").match(/\n  gtaLoadingScreen:"[^"]+"/)[0]));
  assert.ok(art.includes('_noTextRule+(/calligraph|seal|stamp/i.test(r) ? "; no calligraphy, seals or stamps either" : "")'),"ukiyo-e keeps its seal rule");
});

await test("a prompt never names a franchise, while the menu still shows its label",()=>{
  const b={console}; b.window=b; vm.createContext(b);
  b.window.RENDER_STYLE_LABELS={gtaLoadingScreen:"GTA Loading-Screen Art",photoreal:"Photoreal"};
  vm.runInContext(art.slice(art.indexOf("const RENDER_STYLE_PROMPT_NAMES"),art.indexOf("window.renderStylePromptName = renderStylePromptName;")),b);
  assert.equal(b.renderStylePromptName("gtaLoadingScreen"),"open-world crime-game loading-screen art");
  assert.equal(b.renderStylePromptName("photoreal"),"Photoreal");
  assert.ok(art.includes("(renderStylePromptName(typeof inferCharacterRenderStyleKey===\"function\"")&&read("app/props.jsx").includes("window.renderStylePromptName(_styleKey"));
  assert.ok(art.includes("const back = Object.keys(RENDER_STYLE_PROMPT_NAMES).find(k=>RENDER_STYLE_PROMPT_NAMES[k]===spec.style_name);"),"saved sheets still show the menu label");
});

await test("formats show their real labels everywhere",()=>{
  assert.equal(box.formatOf({format:"Feature Film"}).id,"feature");
  assert.equal(box.formatOf({format:"film"}).label,"Short Film");
  assert.ok(!read("app/home-dashboard.jsx").includes("FMT_DISPLAY"),"Home reads the registry labels");
  assert.ok(read("app/story-data.jsx").includes('  format: "feature",'));
  assert.ok(ag.includes("Designing a complete Hero's Journey spine")&&ag.includes('format: base.format || "film",'));
});

await test("a TV Series build finishes before the film becomes a Show",()=>{
  // a per-agent COUNT, raised inside the run's try and lowered in its finally — a stopped run
  // winding down can't clear a newer run's mark, and an early throw can't leave it stuck
  assert.ok(ui.includes("runs[agent.id] = (runs[agent.id]||0) + 1;")&&ui.includes("runs[agent.id] = Math.max(0, (runs[agent.id]||1) - 1);"));
  const inc=ui.indexOf("runs[agent.id] = (runs[agent.id]||0) + 1;"), tryAt=ui.indexOf("try{\n    ctx = ctxFactory({",inc), dec=ui.indexOf("runs[agent.id] = Math.max(0",inc);
  assert.ok(inc>0&&tryAt>inc&&dec>tryAt,"the factory and the run sit inside the try whose finally lowers the count");
  const eff=app.slice(app.indexOf("Series is not merely a badge"),app.indexOf("const [agentLaunch, setAgentLaunch]"));
  const guard='if(((window.__turnAgentRunCount||{}).adapt||0)>0) return;';
  assert.ok(eff.includes(guard));
  assert.ok(eff.indexOf(guard)<eff.indexOf("autoSeriesAttemptRef.current[projectKey]=attemptKey;"),"waiting never burns the one automatic attempt");
  assert.ok(eff.includes("seriesBusy,agentRunTick]"),"the effect re-checks when the build ends");
});

await test("MUSE's writing-model facts match the code",()=>{
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(!m.includes("defaults to the fast engine")&&m.includes("default to Opus 5.5"));
  assert.ok(!m.includes("they are NOT deducted")&&m.includes("deducts it from the account's credit balance"));
});

await test("review fixes: slash emotions, edit numbering, poster medium, money copy, run ids",()=>{
  const b={console}; b.window=b; vm.createContext(b);
  vm.runInContext(ag.slice(ag.indexOf("const _EMOTION_SYNONYMS"),ag.indexOf("/* Returns { drift, reconciled, enriched, exprSet, propScenes }")),b);
  assert.equal(b._emotionKey("grief/anger"),"grief/anger","a slash label is never fused into one word");
  assert.equal(b._emotionKey("Rage / Fear"),"anger/fear");
  const sui=read("app/shots-ui.jsx");
  assert.ok(sui.includes("Image 1 is the frame being edited — keep its composition, pose, expression and lighting.")&&sui.includes('"Image "+(i+2)+" is "'),"an edit numbers its references after the frame");
  assert.ok(app.includes('window.renderStylePromptName(topKey)) || (window.RENDER_STYLE_LABELS||{})[topKey]'),"the poster names the medium by its prompt name");
  assert.ok(app.includes("format: undef(project.format), framework: undef(project.framework),"));
  const au=read("app/auth-ui.jsx");
  assert.ok(!au.includes("not deducted from your generation credits")&&au.includes("The server deducts each call's real token cost from your credits; MUSE is free."));
  const m=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));
  assert.ok(!m.includes("(Short Film, Feature Film, TV Series, Commercial, Micro-Drama, Documentary)")&&m.includes("Micro Short, Micro-drama, Music Video"));
  assert.ok(!/GTA Loading-Screen Art \(Illustration \/ Concept Art: semi-realistic figures, bold black outlines, hard cel shading, a saturated sunset palette/.test(m)&&m.includes("location plates keep their own time of day"));
  assert.ok(!/gtaLoadingScreen:"For the GTA[^"]*sunset/.test(art));
  assert.ok(ui.includes("const myRun = ++runIdRef.current;")&&ui.includes("cancelled:()=>cancelled.current || runIdRef.current!==myRun,")&&ui.includes("if(runIdRef.current!==myRun) return;   // superseded"),"Run again never revives a stopped run");
});

console.log(checks+" checks passed");

#!/usr/bin/env node
/* VIDEO ELEMENTS (owner-approved 2026-10-27, "Video Elements Over Image Elements"): a character's reusable short video
   — made from their sheet and their locked voice — used as their character reference on the Stage.
   - the line is their own first spoken screenplay line (4–18 words), voiced in the LOCKED voice (model + settings);
   - the render: Seedance 2.5, 480p, 4–8 s (the line + 1 s), the sheet as @Image1 and the line as @Audio1, alone on grey;
   - it is kept as "ve-<id>" with what it was made from, and goes out of date when the sheet or the voice changes;
   - the Stage sends it for each on-screen character: on by default on Seedance 2.5, offered off on 2.0; the role line
     takes face motion and voice tone only, never its words or framing; the card can stop sending it;
   - paid only when asked: the card names the price (voice line + render) and asks first.
   Run: node scripts/test-video-elements.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import babel from "@babel/core";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,addEventListener:noop,removeEventListener:noop,
  React:{createElement:()=>null,useState:(v)=>[v,noop],useEffect:noop,useRef:(v)=>({current:v}),useMemo:(f)=>f(),useCallback:(f)=>f} };
box.window=box; box.globalThis=box;
vm.createContext(box);
const src=babel.transformSync(readFileSync("app/video-elements.jsx","utf8"),{presets:["@babel/preset-react"],filename:"video-elements.jsx"}).code;
vm.runInContext(src,box,{filename:"app/video-elements.jsx"});
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };

const scenes=[{id:"s1",no:1},{id:"s2",no:2}];
const drafts={
  s1:{blocks:[{type:"char",text:"OTTAVIO"},{type:"dia",text:"Tickets."},{type:"char",text:"AURELIO BASSI"},{type:"paren",text:"(text)"},{type:"dia",text:"Running late tonight, sorry about that."},
    {type:"char",text:"AURELIO (CONT'D)"},{type:"dia",text:"[sighs] Every regular by the bumper, and none of them by the face."}]},
  s2:{blocks:[{type:"char",text:"AURELIO"},{type:"dia",text:"Second line here for the record, friend."}]}};
const aurelio={id:"c1",name:"Aurelio Bassi",voiceLock:{voiceId:"v-1",modelId:"eleven_v4",defaults:{stability:0.7}}};
ok("the line is their own first spoken line of 4–18 words (a text message and audio tags left out; the cue's first name and CONT'D count)",
  box.veLine(aurelio,scenes,drafts)==="Every regular by the bumper, and none of them by the face.", box.veLine(aurelio,scenes,drafts));
ok("…with no line of their own, a neutral sentence", /quick beige fox/.test(box.veLine({id:"x",name:"Nobody"},scenes,drafts)));
ok("the render runs the line + 1 s, between 4 and 8 s", box.veSeconds(1200)===4 && box.veSeconds(4100)===6 && box.veSeconds(20000)===8);
const prompt=box.vePrompt(aurelio,"Every regular by the bumper.");
ok("the prompt: the sheet as @Image1, their voice as @Audio1, alone on plain grey, lip-synced, living face",
  /@Image1 is Aurelio Bassi's character sheet/.test(prompt) && /@Audio1 is Aurelio Bassi's own voice saying: “Every regular by the bumper\.”/.test(prompt)
  && /plain mid-grey studio background/.test(prompt) && /exact lip-sync/.test(prompt) && /Only Aurelio Bassi in frame/.test(prompt), prompt);

// price: the voice line + Seedance 2.5 at 480p
box.SEEDANCE_MODELS=[{id:"seedance-2.5",tiers:[{id:"standard",falModel:"bytedance/seedance-2.5/reference-to-video",creditRate:{"480p":2.21}}]}];
box.stageRenderCost=(tier,res,secs)=>Math.ceil(tier.creditRate[res]*secs*10);
box.vgLineCredits=(t,m)=>3; box.vgDeliveryModelOf=(l)=>l.modelId;
const cost=box.veCost(aurelio,"Every regular by the bumper, and none of them by the face.");
ok("the price is the voice line plus the 480p Seedance 2.5 render", cost.voice===3 && cost.secs===6 && cost.video===133 && cost.total===136, JSON.stringify(cost));

// making it
const calls=[];
box.nbGetImage=(id)=>id==="c1"?"https://cdn/sheet-c1.png":"";
box.nbGetMeta=(id)=>id==="c1"?{iso:"2026-10-27T09:00:00Z"}:null;
box.vgVoiceLockSignature=(l)=>"sig:"+l.voiceId+":"+l.modelId;
box.elGenerate=async(id,text,opts)=>{ calls.push(["voice",id,text,opts.voiceId,opts.modelId,opts.voiceLock===aurelio.voiceLock]); return {audioUrl:"data:audio/mpeg;base64,AAA",durationMs:3600}; };
const gen={generate:async(o)=>{ calls.push(["video",o]); return {videoUrl:"https://cdn/ve.mp4"}; }};
await box.veMake(aurelio,gen,{scenes,drafts});
const v=calls[1]&&calls[1][1]||{};
ok("making it voices the line in the LOCKED voice first (its model and settings), under its own audio id",
  calls[0][0]==="voice" && calls[0][1]==="ve-line-c1" && calls[0][3]==="v-1" && calls[0][4]==="eleven_v4" && calls[0][5]===true, JSON.stringify(calls[0]));
ok("…then renders Seedance 2.5 at 480p for the line + 1 s, with the sheet and the line, and a quote",
  calls[1][0]==="video" && v.falModel==="bytedance/seedance-2.5/reference-to-video" && v.resolution==="480p" && v.durationMs===5000
  && v.imageUrls[0]==="https://cdn/sheet-c1.png" && v.audioUrls[0]==="data:audio/mpeg;base64,AAA" && v.quote.cost===111 && v.quote.reason==="character-video-element"
  && v.identityCharacterIds[0]==="c1", JSON.stringify(v));
ok("…and records what it was made from (sheet version, voice signature, line, length)",
  v.takeMeta.videoElement.sheetIso==="2026-10-27T09:00:00Z" && v.takeMeta.videoElement.voiceSig==="sig:v-1:eleven_v4" && v.takeMeta.videoElement.durationSec===5
  && /Every regular/.test(v.takeMeta.videoElement.line));
let refused=0;
try{ await box.veMake({...aurelio,voiceLock:null},gen,{scenes,drafts}); }catch(e){ if(/Lock .*voice first/.test(e.message)) refused++; }
try{ await box.veMake({...aurelio,id:"c9"},gen,{scenes,drafts}); }catch(e){ if(/sheet first/.test(e.message)) refused++; }
ok("no locked voice or no sheet → refused before anything is made or charged", refused===2 && calls.length===2);

// out of date
const store={ "ve-c1":{url:"https://cdn/ve.mp4",meta:{videoElement:{sheetIso:"2026-10-27T09:00:00Z",voiceSig:"sig:v-1:eleven_v4",durationSec:5,line:"Every regular."}}} };
box.vidGetVideo=(id)=>(store[id]||{}).url||""; box.vidGetMeta=(id)=>(store[id]||{}).meta||null;
let st=box.veStatus(aurelio);
ok("made from today's sheet and voice → current", st.url && !st.stale && st.seconds===5);
box.nbGetMeta=(id)=>id==="c1"?{iso:"2026-10-28T09:00:00Z"}:null;
st=box.veStatus(aurelio);
ok("a new sheet → out of date, and it says why", st.stale && st.why==="the sheet");
st=box.veStatus({...aurelio,voiceLock:{voiceId:"v-2",modelId:"eleven_v4"}});
ok("a new voice too → 'the sheet and the voice'", st.stale && st.why==="the sheet and the voice");

// the Stage row
const a=box.veStageAsset(aurelio,{}), off=box.veStageAsset(aurelio,{offByDefault:true});
ok("the Stage row: a video reference with its length (for the price), on by default; offered off when asked",
  a && a.key==="ve:c1" && a.kind==="video" && a.seconds===5 && a.id==="ve-c1" && !a.sceneOnly && off.sceneOnly===true && /out of date/.test(a.label));
ok("a character whose card stops sending it gets no row", box.veStageAsset({...aurelio,videoElementOff:true},{})===null);
const role=box.veRoleLine("@Video2",a);
ok("the role line: face motion and voice tone only, never its words, background or framing",
  /@Video2 is Aurelio Bassi's video element/.test(role) && /Never repeat its words/.test(role) && /grey background, framing or camera/.test(role));

// wiring
const stage=readFileSync("app/stage.jsx","utf8"), art=readFileSync("app/artroom.jsx","utf8"), html=readFileSync("TURN.html","utf8");
ok("the Stage offers each on-screen character's element (on for Seedance 2.5, off on 2.0) and loads them",
  /identityCast\.forEach\(c=>\{ const a=window\.veStageAsset\(c,\{ offByDefault:modelId!=="seedance-2\.5" \}\); if\(a\) out\.push\(a\); \}\)/.test(stage)
  && /window\.useVideoElementUrls\(identityCast\)/.test(stage) && /\[clip\.id, activeShot\.id, veTick,/.test(stage));
ok("the Stage gives it its own role line (not 'the previous clip')", /if\(k\.indexOf\("ve:"\)===0 && typeof window\.veRoleLine==="function"\) return window\.veRoleLine\(T,a\);\n  if\(a\.kind==="video"\)/.test(stage));
ok("the character card has the Video element fold", /window\.VideoElementFold && React\.createElement\(window\.VideoElementFold,\{ c, readOnly, scenes, drafts, onUpdate \}\)/.test(art));
const ui=readFileSync("app/video-elements.jsx","utf8");
ok("the card asks first and names the price", /window\.appConfirm\(\{/.test(ui) && /confirmLabel:"Make it · "\+cost\.total\+" credits"/.test(ui));
ok("TURN.html loads it after the Stage", /app\/stage\.jsx\?v=[^"]+"><\/script>\n<script type="text\/babel" src="app\/video-elements\.jsx\?v=/.test(html));
ok("Frances knows", /name:"Video elements \(Characters and the Stage\)"/.test(readFileSync("app/ai.jsx","utf8")));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

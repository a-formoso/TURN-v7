#!/usr/bin/env node
/*
 * Fixes from the live test film (2026-10-25, owner: "fix 1, 2, 5 and 7"):
 *  1 the Stage asks again for an image that came back empty (frames made in the same visit);
 *  2 a speaker with no locked voice — Shoot's notice names them and opens their Voice, the rail and the
 *    Breakdown say it, and an unvoiced line's speaker comes from the screenplay (lineSpeaker);
 *  5 "punches tickets" is not violence (pinned in test-stage-director-brief.mjs);
 *  7 no stray "0" under a shot card's Reference images.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const stage=readFileSync("app/stage.jsx","utf8");
const app=readFileSync("app/app.jsx","utf8");
const art=readFileSync("app/artroom.jsx","utf8");
const bd=readFileSync("app/breakdown.jsx","utf8");
const shotsUi=readFileSync("app/shots-ui.jsx","utf8");
const brief=readFileSync("app/stage-director-brief.js","utf8");
const ai=readFileSync("app/ai.jsx","utf8");
const voicegen=readFileSync("app/voicegen.jsx","utf8");
const html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
const fnSrc=(src,name)=>{ const a=src.indexOf("function "+name+"("); assert.ok(a>=0,name);
  let i=src.indexOf("{",a), d=0; for(;i<src.length;i++){ if(src[i]==="{")d++; else if(src[i]==="}"){ d--; if(!d) break; } }
  return src.slice(a,i+1); };

// the three helpers, run for real with voicegen.jsx's own line-audio rule
const box={window:{}, console};
vm.createContext(box);
vm.runInContext(fnSrc(voicegen,"vgLineAudioStatus")+"\nwindow.vgLineAudioStatus=vgLineAudioStatus;",box);
vm.runInContext([fnSrc(stage,"_lineSpeakerOf"),fnSrc(stage,"_shotAudioState"),fnSrc(stage,"stageClipVoiceNote"),
  "this._shotAudioState=_shotAudioState; this.stageClipVoiceNote=stageClipVoiceNote; this._lineSpeakerOf=_lineSpeakerOf;"].join("\n"),box);
const cast=[{id:"c1",name:"Ottavio Spadoni"},{id:"c2",name:"Aurelio Bassi",voiceLock:{voiceId:"v2"}}];

t("2a an unvoiced line's speaker comes from the screenplay (lineSpeaker), not a guess", ()=>{
  assert.equal(box._lineSpeakerOf({lineSpeaker:{id:"c1",name:"OTTAVIO SPADONI"}},cast).id,"c1");
  assert.equal(box._lineSpeakerOf({lineSpeaker:{name:"aurelio bassi"}},cast).id,"c2");
  assert.equal(box._lineSpeakerOf({lineAudio:{speakerId:"c2"},lineSpeaker:{id:"c1"}},cast).id,"c2");   // the voice it was rendered in wins
  assert.equal(box._lineSpeakerOf({},cast),null);
  assert.ok(stage.includes("return { ...src, dialogue:p.dialogue, lineAudio:src.lineAudio, lineSpeaker:p.speaker||null };"));
});
t("2b a speaker with a lock reads 'not voiced', one without reads 'no voice lock'", ()=>{
  const locked=box._shotAudioState({id:"s1",dialogue:"Last one.",lineSpeaker:{id:"c2"}},{},cast);
  const lockless=box._shotAudioState({id:"s1",dialogue:"Last one.",lineSpeaker:{id:"c1"}},{},cast);
  assert.notEqual(locked.state,"missing-lock");
  assert.equal(lockless.state,"missing-lock");
});
t("2c the rail's words: under Locked voice, a line to voice or the speaker with no lock; nothing under Native", ()=>{
  const clip=(sp)=>({data:{lineShots:[{id:"s1",dialogue:"Last one, Bassi.",lineSpeaker:sp}]}});
  assert.equal(box.stageClipVoiceNote(clip({id:"c1"}),{},cast,"locked",true),"No locked voice — Ottavio Spadoni");
  assert.equal(box.stageClipVoiceNote(clip({id:"c2"}),{},cast,"locked",true),"1 line to voice");
  assert.equal(box.stageClipVoiceNote(clip({id:"c1"}),{},cast,"native",true),"");
  assert.equal(box.stageClipVoiceNote(clip({id:"c1"}),{},cast,"locked",false),"");   // an engine that takes no line audio
  assert.equal(box.stageClipVoiceNote({data:{lineShots:[]}},{},cast,"locked",true),"");
  assert.ok(stage.includes("stageClipVoiceNote(c, auds, characters||[], clipAudioModes[c.id] || (shootMemRef.current.get(c.id)||{}).dialogueAudio || \"locked\", railModel.audioRefs!==false)"));
  assert.ok(stage.includes(": (issueText || \"Ready to render\");"));
  assert.ok(stage.includes("React.useEffect(()=>{ if(onAudioMode) onAudioMode(clip.id, dialogueAudio); }, [clip.id, dialogueAudio]);"));
});
t("2d Shoot's notice names the speaker and opens their Voice instead of a voicing that can only fail", ()=>{
  assert.ok(stage.includes('if(needsVoice && locklessNames.length) blockers.push({ key:"voice",'));
  assert.ok(stage.includes('actionLabel:canOpenVoice ? "Lock "+locklessChar.name+"\u2019s voice" : null,'));
  assert.ok(stage.includes("action:canOpenVoice ? ()=>window.turnOpenCharacterVoice(locklessChar.id) : null,"));
  assert.ok(stage.includes("const canOpenVoice = !!(locklessChar && !readOnly && typeof window.turnOpenCharacterVoice===\"function\");"));
});
t("2e the hand-off: app.jsx opens Characters, the card's Voice opens (asked before or after the tab mounts)", ()=>{
  assert.ok(app.includes("window.turnOpenCharacterVoice = (characterId)=>{"));
  assert.ok(app.includes('setRoom("art"); setArtView("characters");'));
  assert.ok(art.includes('window.addEventListener("turn-character-voice", on);'));
  assert.ok(art.includes("if(ask && Date.now()-ask.at<15000 && (ask.film||null)===(window.turnOpenFilmId||null) && take(ask.id)) window.turnCharacterVoiceAsk = null;"));
  assert.ok(art.includes("openVoice(id); setSceneFilter(\"\");"));
});
t("2f the Breakdown notes a speaker with no locked voice (a note, not a block) and the note opens their Voice", ()=>{
  assert.ok(bd.includes("if(c && !(c.voiceLock && c.voiceLock.voiceId)) unlocked.set(c.id, c.name||\"A character\");"));
  assert.ok(bd.includes("if(unlocked.size) notes.push({ tab:\"characters\""));
  assert.ok(bd.includes("if(n.tab===\"characters\" && n.cardId && typeof window.turnOpenCharacterVoice===\"function\") window.turnOpenCharacterVoice(n.cardId); else go(n.tab);"));
});
t("1 an image that came back empty is asked again after 4 s and 12 s, without flickering to Loading", ()=>{
  assert.ok(stage.includes("if(alive && empty.length && attempt<2) timers.push(setTimeout(()=>{ if(alive) run(empty, attempt+1); }, attempt===0 ? 4000 : 12000));"));
  // (2026-11-03) a frame known to exist stays "loading" while it is asked again; others keep the first answer
  assert.ok(stage.includes("if(alive && u) setImageLoadState(prev=>({...prev,[id]:\"ready\"}));"));
  assert.ok(stage.includes("else if(alive && (attempt===0 || (known && last))) setImageLoadState(prev=>({...prev,[id]:known && !last ? \"loading\" : \"unavailable\"}));"));
  assert.ok(/const knownImage = \(id\)=>\{ const sh=\(shots\|\|\[\]\)\.find/.test(stage));
  // only an approved shot frame counts as known (an approved appearance variant with no image must read missing)
  assert.ok(stage.includes('return !!(sh && sh.locked && !(typeof window.nbImageKnownMissing==="function" && window.nbImageKnownMissing(id))); };'));
  assert.ok(stage.includes('(unknown || frameLoading) ? "Loading\u2026"') || stage.includes('(unknown || frameLoading) ? "Loading…"'));
  assert.ok(stage.includes("return ()=>{ alive=false; timers.forEach(clearTimeout); }; }, [neededIds.join(\",\"), imgTick]);"));
});
t("5 the ticket-punch exclusions sit in front of the violence test", ()=>{
  assert.ok(brief.includes("|bleeding|blood)\\b/i.test(fight))return \"violence\";"));
});
t("7 the reference warning is false, never 0, when nothing is missing", ()=>{
  assert.ok(shotsUi.includes("const refWarn = (_missCast.length>0 || _missLoc.length>0) && "));
  assert.ok(!shotsUi.includes("const refWarn = (_missCast.length || _missLoc.length) && "));
});
t("3 a scene's length on the Stage is its clips' (rail and heading), not the shots' planning estimates", ()=>{
  const b={window:{},vidGetMeta:(id)=>id==="c1"?{durationSec:4.06}:null}; vm.createContext(b);
  vm.runInContext(fnSrc(stage,"stageClipSecs")+";this.f=stageClipSecs;",b);
  assert.equal(b.f({id:"c1",data:{dur:4}},{c1:"blob:x"}),4.06);   // the rendered take's own length
  assert.equal(b.f({id:"c2",data:{dur:11}},{}),11);              // else the planned length
  assert.ok(stage.includes("const sceneDur = sceneClips.length ? sceneClips.reduce((t,c)=>t+stageClipSecs(c, vids),0)"));
  assert.ok(stage.includes("_fmtSecs(selectedSceneClips.length ? selectedSceneClips.reduce((t,c)=>t+stageClipSecs(c, vids),0)"));
  assert.ok(stage.includes("const secs = stageClipSecs(c, vids);"));
});
t("4 the Mix and the Timeline show a line only the screenplay holds; a shot's own words still come first", ()=>{
  const b={window:{}}; vm.createContext(b);
  vm.runInContext([fnSrc(voicegen,"vgLineAudioStatus"),"window.vgLineAudioStatus=vgLineAudioStatus;",
    "const CLIP_AIR = { lead:0.6, gap:0.8, tail:0.6 };","function stageActionSec(){ return 3; }",
    "function _seedanceVoiceSec(sh){ return String(sh&&sh.dialogue||'').split(/\\s+/).filter(Boolean).length>2 ? 2 : 1; }",
    fnSrc(stage,"_lineSpeakerOf"),fnSrc(stage,"_shotAudioState"),fnSrc(stage,"clipLinePlacements"),"this.f=clipLinePlacements;"].join("\n"),b);
  const sh1={id:"s1",dialogue:""}, sh2={id:"s2",dialogue:""};
  const clip={data:{shots:[sh1,sh2],lineShots:[{...sh2,dialogue:"Last one, Bassi.",lineSpeaker:{id:"c1",name:"OTTAVIO SPADONI"}}],panelLines:[]}};
  const out=b.f(clip,{},cast);
  assert.equal(out.length,1);
  assert.equal(out[0].shotId,"s2"); assert.equal(out[0].text,"Last one, Bassi."); assert.equal(out[0].speaker,"OTTAVIO SPADONI");
  assert.equal(out[0].at,3.6);   // after the silent first shot (lead 0.6 + 3)
  // a line a redraft removed: the shot's own words, listed but not playable
  const gone=b.f({data:{shots:[{id:"s3",dialogue:"Old words."}],lineShots:[],panelLines:[]}},{},cast);
  assert.equal(gone.length,1); assert.equal(gone[0].audioState.state,"stale-text");
});
t("Frances knows", ()=>{
  assert.ok(ai.includes("Voicing a clip's lines and the scene type (Stage, test-film fixes)"));
});
t("cache keys", ()=>{
  ["stage.jsx","ai.jsx","script.jsx","app.jsx","artroom.jsx","shots-ui.jsx","breakdown.jsx"].forEach(f=>
    assert.ok(["20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
  assert.ok(["20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/stage-director-brief.js?v="+k+'"')));
});
console.log(pass+" passed, 0 failed");

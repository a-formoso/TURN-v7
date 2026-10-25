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
  assert.ok(stage.includes("if(alive && (u || attempt===0)) setImageLoadState(prev=>({...prev,[id]:u?\"ready\":\"unavailable\"}));"));
  assert.ok(stage.includes("return ()=>{ alive=false; timers.forEach(clearTimeout); }; }, [neededIds.join(\",\"), imgTick]);"));
});
t("5 the ticket-punch exclusions sit in front of the violence test", ()=>{
  assert.ok(brief.includes("|bleeding|blood)\\b/i.test(fight))return \"violence\";"));
});
t("7 the reference warning is false, never 0, when nothing is missing", ()=>{
  assert.ok(shotsUi.includes("const refWarn = (_missCast.length>0 || _missLoc.length>0) && "));
  assert.ok(!shotsUi.includes("const refWarn = (_missCast.length || _missLoc.length) && "));
});
t("Frances knows", ()=>{
  assert.ok(ai.includes("Voicing a clip's lines and the scene type (Stage, test-film fixes)"));
});
t("cache keys", ()=>{
  ["stage.jsx","ai.jsx","script.jsx","app.jsx","artroom.jsx","shots-ui.jsx","breakdown.jsx"].forEach(f=>
    assert.ok(["20261025-hs74"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
  assert.ok(["20261025-hs74"].some(k=>html.includes("app/stage-director-brief.js?v="+k+'"')));
});
console.log(pass+" passed, 0 failed");

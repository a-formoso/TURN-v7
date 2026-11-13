/* VIDEO ELEMENTS (owner-approved 2026-10-27, "go ahead with 5 and 6. Also, Video Elements Over Image Elements"):
   a still sheet tells the video model what a character looks like; a short video of them speaking tells it how their
   face moves and how they sound. A character's VIDEO ELEMENT is made once from their sheet and their locked voice:
   one of their own screenplay lines is voiced in that voice (a voice line), then Seedance 2.5 renders a few seconds of
   them saying it — alone, against plain grey, lip-synced — and keeps it as "ve-<character id>" in the film's videos.
   The Stage sends it with every clip the character is in (Seedance 2.5: on by default; Seedance 2.0, whose video
   references are capped at 3 files / 15 s together, offers it off), with a role line: face motion, expressions and
   voice tone only — never its words, background or framing.
   Paid, and only when asked: "Make video element" names the price (the voice line + the render) and asks first.
   It goes OUT OF DATE when the sheet or the locked voice changes since it was made, and says so. */
const VE_PREFIX = "ve-";
const VE_RESOLUTION = "480p";      // a reference, not a shot: the lowest resolution is plenty and costs least
const VE_MIN_SEC = 4, VE_MAX_SEC = 8;
function veId(c){ return VE_PREFIX+String((c&&c.id)||c||""); }
function veLineAudioId(c){ return "ve-line-"+String((c&&c.id)||c||""); }
const _veClean = (s)=> String(s||"").replace(/\[[^\]]*\]/g," ").replace(/\s+/g," ").trim();
const _veCue = (s)=> String(s||"").replace(/\(.*?\)/g," ").replace(/[^A-Za-zÀ-ɏ' -]/g," ").replace(/\s+/g," ").trim().toUpperCase();
/* the line it speaks: the one chosen on the card (an audition line or your own — c.videoElementLine, 2026-10-27), else
   their first spoken screenplay line of 4–18 words (first sentences, up to 18 words); else a pangram */
const VE_LINE_MAX_WORDS = 20;      // ~8 s at an ordinary pace: the element's longest
function veLine(c, scenes, drafts){
  const own = _veClean(c && c.videoElementLine);
  if(own && own.split(" ").length>=3) return own.split(" ").slice(0, VE_LINE_MAX_WORDS).join(" ");
  return veScreenplayLine(c, scenes, drafts);
}
/* every line they speak in the screenplay (not text messages), in story order — what the audition lines are written from */
function veSpokenLines(c, scenes, drafts, max){
  const name = _veCue(c && c.name), first = name.split(" ")[0], out = [];
  const isThem = (cue)=>{ const k = _veCue(cue); return !!k && (k===name || k===first || k.split(" ")[0]===first); };
  const list = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  for(const s of list){
    let speaker = "", paren = "";
    for(const b of ((((drafts||{})[s && s.id])||{}).blocks || [])){
      if(!b) continue;
      if(b.type==="char"){ speaker = b.text; paren = ""; continue; }
      if(b.type==="paren"){ paren = String(b.text||""); continue; }
      if(b.type==="dia" && isThem(speaker) && !/\b(text|sms|message)\b/i.test(paren)){ const t = _veClean(b.text); if(t) out.push(t); }
      if(b.type!=="paren") paren = "";
      if(out.length>=(max||12)) return out;
    }
  }
  return out;
}
function veScreenplayLine(c, scenes, drafts){
  const name = _veCue(c && c.name), first = name.split(" ")[0];
  const isThem = (cue)=>{ const k = _veCue(cue); return !!k && (k===name || k===first || k.split(" ")[0]===first); };
  const list = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  let fallback = "";
  for(const s of list){
    const blocks = (((drafts||{})[s && s.id])||{}).blocks || [];
    let speaker = "", paren = "";
    for(const b of blocks){
      if(!b) continue;
      if(b.type==="char"){ speaker = b.text; paren = ""; continue; }
      if(b.type==="paren"){ paren = String(b.text||""); continue; }
      if(b.type==="dia" && isThem(speaker) && !/\b(text|sms|message)\b/i.test(paren)){
        const t = _veClean(b.text); if(!t) continue;
        const words = t.split(" ");
        if(words.length>=4 && words.length<=18) return t;
        if(words.length>18){
          const sentences = t.split(/(?<=[.!?])\s+/); let out = "";
          for(const x of sentences){ const next = (out ? out+" " : "")+x; if(next.split(" ").length>18) break; out = next; }
          if(out.split(" ").length>=4) return out;
          if(!fallback) fallback = words.slice(0,14).join(" ").replace(/[,;:]$/,"")+".";
        }else if(!fallback) fallback = t;
      }
      if(b.type!=="paren") paren = "";
    }
  }
  if(fallback && fallback.split(" ").length>=3) return fallback;
  return "That quick beige fox jumped in the air over each thin dog.";
}
/* what it was made from: the sheet's version and the locked voice */
function veSources(c){
  const sheet = (typeof nbGetMeta==="function" && nbGetMeta(c.id)) || {};
  const lock = c && c.voiceLock;
  const voiceSig = (lock && lock.voiceId && typeof window.vgVoiceLockSignature==="function") ? window.vgVoiceLockSignature(lock) : (lock&&lock.voiceId)||"";
  return { sheetIso:String(sheet.iso||""), voiceSig:String(voiceSig||"") };
}
function veStatus(c){
  const meta = (typeof vidGetMeta==="function" && vidGetMeta(veId(c))) || null;
  const url = (typeof vidGetVideo==="function" && vidGetVideo(veId(c))) || "";
  if(!url) return { url:"", meta:null, stale:false, why:"" };
  const now = veSources(c), was = (meta && (meta.videoElement||meta)) || {};
  const why = [ was.sheetIso && now.sheetIso && was.sheetIso!==now.sheetIso ? "the sheet" : "",
    was.voiceSig && now.voiceSig && was.voiceSig!==now.voiceSig ? "the voice" : "" ].filter(Boolean);
  return { url, meta, stale:why.length>0, why:why.join(" and "), seconds:Number(was.durationSec)||Number(meta&&meta.durationSec)||0, line:was.line||"" };
}
function veSeconds(audioMs){ return Math.max(VE_MIN_SEC, Math.min(VE_MAX_SEC, Math.ceil((Number(audioMs)||3000)/1000 + 1))); }
/* the render's prompt: the character alone, saying the line in @Audio1, against plain grey. No written voice (owner
   2026-10-27): the recording in @Audio1 is the voice. */
function vePrompt(c, line){
  const name = (c && c.name) || "the character";
  return [
    "@Image1 is "+name+"'s character sheet: their face, hair, build and wardrobe. @Audio1 is "+name+"'s own voice saying: “"+line+"”",
    "A medium close-up of "+name+" alone, facing the camera at a slight three-quarter angle, against a plain mid-grey studio background, soft even light, a locked-off camera.",
    name+" says the line from @Audio1 with exact lip-sync, as themselves: natural blinks, small head and eye movements, breath in the chest and shoulders, real micro-expressions that change with the words. Never a frozen stare.",
    "Only "+name+" in frame. No other people, no text, no captions, no music, no sound but the voice."
  ].filter(Boolean).join("\n");
}
function veTier(){
  const m = (window.SEEDANCE_MODELS||[]).find(x=>x && x.id==="seedance-2.5");
  return m && (m.tiers||[]).find(t=>t.id==="standard") || null;
}
/* the voice line is already recorded for this line in this voice: Make it again reuses it (elGenerate's own cache,
   same text + voice + settings), so it isn't paid for twice — e.g. after a refused render (2026-10-27) */
function veLineRecorded(c, line){
  const lock = (c && c.voiceLock) || {};
  if(!lock.voiceId || typeof window.vgHash!=="function" || typeof window.vgGetMeta!=="function") return null;
  const modelId = (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(lock) : (lock.modelId||"");
  const meta = window.vgGetMeta(veLineAudioId(c)), url = typeof window.vgGetAudio==="function" ? window.vgGetAudio(veLineAudioId(c)) : "";
  const base = (typeof VG_DEFAULTS!=="undefined") ? VG_DEFAULTS : {};
  const hash = window.vgHash(String(line||"").trim(), lock.voiceId, { ...base, ...(lock.defaults||{}), modelId:modelId || ((typeof VG_TTS_MODEL!=="undefined") ? VG_TTS_MODEL : "") });
  return (meta && url && meta.hash===hash) ? meta : null;
}
function veCost(c, line){
  const lock = (c && c.voiceLock) || {};
  const modelId = (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(lock) : (lock.modelId||"");
  const rec = veLineRecorded(c, line);
  const words = String(line||"").split(" ").length;
  const secs = rec && rec.durationMs ? veSeconds(rec.durationMs) : veSeconds(words*400);   // ~2.5 words a second until it's recorded
  const voice = rec ? 0 : (typeof window.vgLineCredits==="function") ? Number(window.vgLineCredits(line, modelId))||0 : 0;
  const video = (typeof window.stageRenderCost==="function" && veTier()) ? Number(window.stageRenderCost(veTier(), VE_RESOLUTION, secs))||0 : 0;
  return { voice, video, total:voice+video, secs, recorded:!!rec };
}
/* make it: the voice line, then the render (each held and settled by the server like any other call) */
async function veMake(c, gen, ctx){
  ctx = ctx || {};
  if(!c || !c.id) throw new Error("No character.");
  const lock = c.voiceLock;
  if(!lock || !lock.voiceId) throw new Error("Lock "+(c.name||"this character")+"'s voice first (the Voice button on the card).");
  let sheet = (typeof nbGetImage==="function" && nbGetImage(c.id)) || "";
  if(!sheet && typeof nbLoadImage==="function") sheet = await nbLoadImage(c.id);
  if(!sheet) throw new Error("Generate "+(c.name||"this character")+"'s sheet first.");
  const line = veLine(c, ctx.scenes, ctx.drafts);
  const modelId = (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(lock) : (lock.modelId||"");
  const audio = await window.elGenerate(veLineAudioId(c), line, { voiceId:lock.voiceId, settings:lock.defaults, modelId, voiceLock:lock,
    characterId:c.id, characterName:c.name||"Character", assetRole:"character_video_element_line",
    identityCharacter:c, identityCharacterIds:[c.id], identityCast:[c] });
  if(!audio || !audio.audioUrl) throw new Error("The voice line came back empty. Nothing else was made.");
  const secs = veSeconds(audio.durationMs);
  const tier = veTier();
  const src = veSources(c);
  const cost = (typeof window.stageRenderCost==="function" && tier) ? window.stageRenderCost(tier, VE_RESOLUTION, secs) : 0;
  return gen.generate({ imageUrls:[sheet], audioUrls:[audio.audioUrl], prompt:vePrompt(c, line), durationMs:secs*1000,
    aspectRatio:"16:9", resolution:VE_RESOLUTION, falModel:(tier&&tier.falModel)||window.VID25_MODEL, generateAudio:true,
    quote:{ cost, reason:"character-video-element" }, identityCharacterIds:[c.id], identityCast:[c],
    takeMeta:{ videoElement:{ characterId:c.id, sheetIso:src.sheetIso, voiceSig:src.voiceSig, line, durationSec:secs },
      durationSec:secs, assetRole:"video_element", assetRoleLabel:"Video element", inputs:"1 text · 1 img · 0 vid · 1 aud" },
    force:true });
}
/* the Stage's reference row for a character's video element (or null) */
function veStageAsset(c, opts){
  const o = opts || {};
  if(!c || c.videoElementOff) return null;
  const s = veStatus(c);
  if(!s.url) return null;
  return { key:"ve:"+c.id, kind:"video", group:"Video elements", label:(c.name||"Character")+" · video element"+(s.stale?" (out of date)":""),
    url:s.url, ready:true, id:veId(c), seconds:s.seconds||VE_MAX_SEC, characterId:c.id, characterName:c.name||"",
    referenceKind:"video_element", assetRole:"derived_reference", assetSourceQuality:"character_video_element",
    ...(o.offByDefault ? { sceneOnly:true } : {}) };
}
function veRoleLine(T, a){
  const name = (a && a.characterName) || "the character";
  return T+" is "+name+"'s video element — how "+name+"'s face moves and how they sound: match their facial motion, expressions, blinks, "
    +"mouth shapes and the tone, accent and rhythm of their voice whenever "+name+" is on screen or speaks. Never repeat its words, "
    +"its grey background, framing or camera; it is not a shot of this clip.";
}
/* the card's videos: loads the character's element and follows new takes */
function useVideoElement(c){
  const id = veId(c);
  const [tick, setTick] = React.useState(0);
  React.useEffect(()=>{
    let alive = true;
    if(typeof vidGetVideo==="function" && !vidGetVideo(id) && typeof vidLoadVideo==="function")
      vidLoadVideo(id).then(u=>{ if(alive && u) setTick(t=>t+1); }, ()=>{});
    const h = (e)=>{ if(e && e.detail && Array.isArray(e.detail.ids) && e.detail.ids.indexOf(id)>=0) setTick(t=>t+1); };
    window.addEventListener("vid-done", h);
    return ()=>{ alive = false; window.removeEventListener("vid-done", h); };
  },[id]);
  return tick;
}
/* the Stage: load the clip cast's elements once, so a clip shows them without a reload */
function useVideoElementUrls(cast){
  const ids = (cast||[]).map(c=>c && veId(c)).filter(Boolean).join(",");
  const [tick, setTick] = React.useState(0);
  React.useEffect(()=>{
    let alive = true;
    ids.split(",").filter(Boolean).forEach(id=>{
      if(typeof vidGetVideo==="function" && !vidGetVideo(id) && typeof vidLoadVideo==="function")
        vidLoadVideo(id).then(u=>{ if(alive && u) setTick(t=>t+1); }, ()=>{});
    });
    const h = (e)=>{ if(e && e.detail && Array.isArray(e.detail.ids) && e.detail.ids.some(x=>ids.split(",").indexOf(x)>=0)) setTick(t=>t+1); };
    window.addEventListener("vid-done", h);
    return ()=>{ alive = false; window.removeEventListener("vid-done", h); };
  },[ids]);
  return tick;
}

/* THE CARD'S FOLD: Characters › a character › Video element */
function VideoElementBare({ children }){
  return React.createElement("div",{className:"ve-bare"}, React.createElement("div",{className:"ve-sub"},"Video element"), children);
}
function VideoElementFold({ c, readOnly=false, scenes, drafts, onUpdate, bare=false }){
  useVideoElement(c);
  const [, setLineTick] = React.useState(0);
  React.useEffect(()=>{ let alive = true;
    if(typeof window.vgLoadAudio==="function" && !(typeof window.vgGetAudio==="function" && window.vgGetAudio(veLineAudioId(c))))
      window.vgLoadAudio(veLineAudioId(c)).then(u=>{ if(alive && u) setLineTick(t=>t+1); }, ()=>{});
    return ()=>{ alive = false; };
  },[c && c.id]);
  const gen = (typeof useSeedanceGen==="function") ? useSeedanceGen(veId(c)) : null;
  const [busy, setBusy] = React.useState("");
  const [err, setErr] = React.useState("");
  const s = veStatus(c);
  const hasSheet = !!((typeof nbGetImage==="function" && nbGetImage(c.id)) || (typeof nbGetMeta==="function" && nbGetMeta(c.id)));
  const locked = !!(c.voiceLock && c.voiceLock.voiceId);
  const line = veLine(c, scenes, drafts);
  const ownLine = _veClean(c.videoElementLine);
  const usingOwn = !!ownLine && ownLine.split(" ").length>=3;
  const options = Array.isArray(c.auditionLines) ? c.auditionLines.filter(x=>x && x.text) : [];
  const [writing, setWriting] = React.useState(false);
  const writeLines = async ()=>{
    if(writing || readOnly || typeof window.aiAuditionLines!=="function" || typeof onUpdate!=="function") return;
    setWriting(true); setErr("");
    try{
      const r = await window.aiAuditionLines(c, { lines:veSpokenLines(c, scenes, drafts, 10),
        voice:(typeof stageVoiceText==="function") ? String(stageVoiceText(c)||"") : "" });
      if(!r || r.error){ setErr((r && r.error) || "The lines didn't come back. Try again."); return; }
      onUpdate(c.id, { auditionLines:r.lines.map(x=>({ kind:x.kind, label:x.label, text:x.text })) });
    }finally{ setWriting(false); }
  };
  const pick = (text)=>{ if(!readOnly && typeof onUpdate==="function") onUpdate(c.id, { videoElementLine:text ? _veClean(text).split(" ").slice(0, VE_LINE_MAX_WORDS).join(" ") : "" }); };
  const cost = veCost(c, line);
  const working = !!(busy || (gen && gen.gening));
  const make = async ()=>{
    if(!gen || working || readOnly) return;
    setErr("");
    const ok = !window.appConfirm || await window.appConfirm({
      title:(s.url ? "Make "+(c.name||"this character")+"'s video element again?" : "Make "+(c.name||"this character")+"'s video element?"),
      body:"A "+cost.secs+"-second clip of "+(c.name||"them")+" saying “"+line+"” in their locked voice, made from their sheet. "
        +(cost.recorded
          ? "About "+cost.total+" credits for the render (Seedance 2.5, 480p); the voice line is already recorded and is reused. "
          : "About "+cost.total+" credits: the voice line ("+cost.voice+") and the render ("+cost.video+", Seedance 2.5, 480p). ")
        +(s.url ? "The one you have stays in its takes." : "The Stage then sends it with every clip "+(c.name||"they")+" are in."),
      confirmLabel:"Make it · "+cost.total+" credits", cancelLabel:"Cancel" });
    if(!ok) return;
    setBusy("Voicing the line…");
    try{
      const p = veMake(c, gen, { scenes, drafts });
      setBusy("Rendering…");
      await p;
    }catch(e){ setErr(String((e&&e.message)||e||"It couldn't be made.")); }
    finally{ setBusy(""); }
  };
  const status = busy || (gen && gen.gening ? ("Rendering… "+String(gen.status||"").toLowerCase().replace(/_/g," ")) : "");
  // bare (owner 2026-10-29): inside the character card's "Voice & video" section, under its own small heading
  return React.createElement(bare ? VideoElementBare : CardFold, bare ? {} : {label:"Video element",defaultOpen:!!s.url,foldId:"ve-"+c.id},
    React.createElement("div",{className:"char-scalesheet-hint"},
      "A few seconds of "+(c.name||"this character")+" saying a line in their locked voice, made from their sheet. "
      +"The Stage sends it with every clip they're in, so their face moves and their voice sounds the same in every scene."),
    s.url && React.createElement("video",{className:"ve-video",src:s.url,controls:true,playsInline:true,preload:"metadata"}),
    s.url && s.line && React.createElement("div",{className:"ve-line"},"“"+s.line+"”"),
    // THE LINE THEY SAY (2026-10-27): the screenplay's, an audition line written for them, or your own
    React.createElement("div",{className:"ve-pick",role:"group","aria-label":"The line they say"},
      React.createElement("div",{className:"obj-lab"},"The line they say"),
      React.createElement("div",{className:"ve-chosen"},"“"+line+"”",
        React.createElement("span",{className:"ve-src"}, usingOwn ? (options.some(x=>_veClean(x.text)===ownLine) ? " · audition line" : " · your line") : " · from the screenplay")),
      options.length>0 && React.createElement("ul",{className:"ve-options"},
        options.map((x,i)=>{ const on = usingOwn && _veClean(x.text)===ownLine;
          return React.createElement("li",{key:x.kind||i,className:"ve-option"+(on?" on":"")},
            React.createElement("b",null,(x.label||x.kind||"Line")+": "),
            React.createElement("span",null,"“"+x.text+"”"),
            !readOnly && React.createElement("button",{type:"button",className:"ve-use-line",disabled:on||working,
              "aria-label":"Use the "+(x.label||"audition")+" line", onClick:()=>pick(x.text)}, on ? "In use" : "Use this")); })),
      !readOnly && React.createElement(SheetField,{label:"Or write their line ("+VE_LINE_MAX_WORDS+" words at most)",value:ownLine,
        placeholder:"e.g. a line that sounds like them", onCommit:val=>pick(val)}),
      !readOnly && React.createElement("div",{className:"ve-pick-acts"},
        React.createElement("button",{type:"button",className:"art-draftall ghost","data-testid":"ve-write-lines",disabled:writing||working,
          title:"Writes three short lines in "+(c.name||"their")+"'s voice: Signature (what drives them), Everyday and Under pressure. Uses a little writing credit; nothing is filmed.",
          onClick:writeLines}, React.createElement(Icon.sparkles,{s:12}), writing ? "Writing\u2026" : (options.length ? "Write new audition lines" : "Write audition lines")),
        usingOwn && React.createElement("button",{type:"button",className:"ve-use-line",disabled:working,onClick:()=>pick("")},"Use the screenplay line"),
        React.createElement("small",{className:"ve-note"},"Writing the lines uses a little writing credit; nothing is filmed until you make the video element.")),
      s.url && s.line && _veClean(s.line)!==_veClean(line) && React.createElement("div",{className:"ve-need"},
        "The video element says a different line. Make it again to film the one above.")),
    s.url && s.stale && React.createElement("div",{className:"sheet-undrafted",role:"status"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,"Out of date: "+s.why+" changed since it was made. The Stage still sends it until you make it again.")),
    !hasSheet && React.createElement("div",{className:"ve-need"},"Needs the character's sheet first."),
    hasSheet && !locked && React.createElement("div",{className:"ve-need"},"Needs a locked voice first (the Voice button above)."),
    !readOnly && hasSheet && locked && React.createElement("button",{type:"button",className:"art-draftall"+(s.url&&!s.stale?" ghost":""),disabled:working,
      title:"Voices “"+line+"” in their locked voice, then renders "+cost.secs+" seconds of them saying it (Seedance 2.5, 480p) — about "+cost.total+" credits. Asks first.",
      onClick:make},
      React.createElement(Icon.sparkles,{s:12}), working ? (status||"Working…") : (s.url ? "Make it again" : "Make video element"),
      // the price as every other button shows it: the credit mark, then the number (it read " · 12 credits" until 2026-11-13)
      !working && React.createElement("span",{className:"nb-cost ve-cost",title:"About "+cost.total+" credits"},
        typeof window.nbCreditMark==="function" ? window.nbCreditMark() : null, String(cost.total))),
    s.url && !readOnly && typeof onUpdate==="function" && React.createElement("label",{className:"ve-use"},
      React.createElement("input",{type:"checkbox",checked:!c.videoElementOff,onChange:e=>onUpdate(c.id,{ videoElementOff:!e.target.checked })}),
      " Send it with this character's Stage clips"),
    (err || (gen && gen.err && !working)) && React.createElement("div",{className:"ve-err",role:"alert"}, err || String((gen.err&&gen.err.message)||gen.err)));
}

window.VE_PREFIX = VE_PREFIX;
window.veId = veId;
window.veLine = veLine;
window.veScreenplayLine = veScreenplayLine;
window.veSpokenLines = veSpokenLines;
window.VE_LINE_MAX_WORDS = VE_LINE_MAX_WORDS;
window.veStatus = veStatus;
window.veSeconds = veSeconds;
window.vePrompt = vePrompt;
window.veCost = veCost;
window.veLineRecorded = veLineRecorded;
window.veMake = veMake;
window.veStageAsset = veStageAsset;
window.veRoleLine = veRoleLine;
window.useVideoElementUrls = useVideoElementUrls;
window.VideoElementFold = VideoElementFold;

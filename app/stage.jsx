/* stage.jsx — The Stage (Production), Step 10.

   The SEEDANCE 2.0 DIRECTOR CONSOLE. The unit of work is the CLIP (one
   sceneSequences group, the <=15s render unit) = exactly one Seedance generation.
   Each clip's START FRAME (its first shot's rendered frame) + a composed multi-beat
   prompt + the locked-voice line audio + derived reference sheets are assembled into
   a multimodal Seedance job (see app/videogen.jsx seedanceGenerate / useSeedanceGen,
   bytedance/seedance-2.0 via the fal.ai proxy). Generation is deploy-gated exactly
   like voice — without the proxy route + FAL_KEY it shows a friendly message.

   Layout: a left STORY-SPINE rail (acts → scenes → clips), a CENTER (player +
   shot-take filmstrip + prompt box + input assets) and a RIGHT Seedance panel
   (capability card + mode selector + assets summary + controls + Generate). Reuses
   the same window helpers as the Shot List / Storyboard so the partition matches. */

const _stEl = React.createElement;

function _pad2(n){ return String(n||0).padStart(2,"0"); }
function _clipLetter(i){ return (i<26) ? String.fromCharCode(65+i) : String(i+1); }
function _uniq(a){ const o=[], s=new Set(); (a||[]).forEach(x=>{ if(x && !s.has(x)){ s.add(x); o.push(x); } }); return o; }
function _clipDur(g, maxSec){
  const raw=Math.max(4,Math.round(g&&g.dur||5));
  /* A beat-opening shot is one unsplittable screenplay unit. Preserve its full
     required duration so Stage can show the model-cap blocker instead of
     silently squeezing/truncating exact dialogue to 15 seconds. */
  if((g&&g.shots||[]).some(stageBeatOpeningShot))return raw;
  return Math.min(Number(maxSec)||15,raw);
}
function _firstWords(t, n){ const w=String(t||"").trim().split(/\s+/).filter(Boolean); return w.slice(0,n).join(" ")+(w.length>n?"…":""); }
function _stageAspect(project){ return (typeof aspectFor==="function") ? aspectFor(project) : "16:9"; }
function _stageAspectCss(aspect){
  const raw = String(aspect||"16:9").trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  return { "--stage-aspect": m ? (m[1]+" / "+m[2]) : "16 / 9" };
}
function _stageSavedSource(){
  try{ const v=localStorage.getItem("turn_stage_visual_source"); return v==="halves" ? "halves" : "shots"; }catch(e){ return "shots"; }
}
/* Full-screen for any rendered-video player: native fullscreen on the <video>,
   falling back to a self-mounting in-app overlay (same .stage2-lightbox chrome)
   when the browser refuses — embedded frames often leave the request pending or
   reject it. Shared by the clip console, the Versions viewer and the Timeline/
   Audio players so every generated video can go full screen the same way. */
function _stageVideoFullscreen(v, url){
  const src = url || (v && (v.currentSrc || v.src)) || "";
  const overlay = ()=>{
    if(!src) return;
    const wrap = document.createElement("div"); wrap.className = "stage2-lightbox";
    const vid = document.createElement("video");
    vid.className = "stage2-lightbox-media"; vid.src = src;
    vid.controls = true; vid.autoplay = true; vid.playsInline = true;
    if(v){ try{ vid.currentTime = v.currentTime||0; }catch(e){} }
    wrap.appendChild(vid);
    const onKey = (e)=>{ if(e.key==="Escape") close(); };
    const close = ()=>{ try{ wrap.remove(); }catch(e){} document.removeEventListener("keydown", onKey); };
    wrap.addEventListener("mousedown",(e)=>{ if(e.target===wrap) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
  };
  if(!v){ overlay(); return; }
  try{
    if(v.requestFullscreen){ const p = v.requestFullscreen(); if(p&&p.catch) p.catch(()=>{}); }
    else if(v.webkitRequestFullscreen) v.webkitRequestFullscreen();
    else if(v.webkitEnterFullscreen){ v.webkitEnterFullscreen(); return; }   // iOS Safari
    else { overlay(); return; }
    // an embedded frame can leave the request PENDING forever — if nothing is
    // fullscreen shortly after, open the overlay instead
    setTimeout(()=>{ if(!document.fullscreenElement && !document.webkitFullscreenElement) overlay(); }, 600);
  }catch(e){ overlay(); }
}
function _chipClass(k){ return String(k||"").toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"") || "tag"; }
function _fmtSecs(n){ n=Number(n)||0; return (Math.round(n*10)/10).toString().replace(/\.0$/,"")+"s"; }
function _stageClock(n){
  n = Math.max(0, Number(n)||0);
  const m = Math.floor(n/60);
  const s = Math.floor(n%60);
  return m+":"+_pad2(s);
}
function stageScenePlace(scene){
  const raw = String((scene&&scene.loc) || (scene&&scene.title) || "Scene").replace(/\s+/g," ").trim();
  if(!raw) return "Scene";
  const stripped = raw.replace(/^\s*\d+[A-Z]?\s+/i,"").trim();
  const parts = stripped.split(/\s+\u00b7\s+/).map(s=>s.trim()).filter(Boolean);
  const loc = parts.find(p=>/\b(?:INT|EXT|INT\/EXT|I\/E)\.?\b/i.test(p)) || parts[0] || stripped;
  return loc.replace(/^\s*\d+[A-Z]?\s+/i,"").trim() || stripped;
}
function stageCreditInfo(balance, cost){
  cost = Number(cost)||1;
  const b = balance || (typeof window!=="undefined" ? window.turnCreditBalance : null);
  const remaining = b && Number(b.remaining);
  const known = Number.isFinite(remaining);
  const after = known ? Math.max(0, remaining-cost) : null;
  return {
    known,
    remaining:known ? remaining : null,
    after,
    empty:known && remaining < cost,
    label: known
      ? ("Uses "+cost+" generation credit"+(cost!==1?"s":"")+" · "+remaining+" remaining"+(remaining>=cost ? (" → "+after+" after render") : ""))
      : ("Uses "+cost+" generation credit"+(cost!==1?"s":"")+" · remaining credits unavailable"),
    title: known
      ? ("Current balance: "+remaining+" generation credit"+(remaining===1?"":"s")+". This render costs "+cost+".")
      : "Cinema Machine could not read a credit balance from the current account/backend yet."
  };
}
function stageFriendlyVideoError(err){
  const raw = String((err&&err.message)||err||"").trim();
  if(!raw) return "";
  const low = raw.toLowerCase();
  if((low.includes("video") && low.includes("reference") && (low.includes("resolution") || low.includes("720") || low.includes("480"))) ||
     (low.includes("reference video") && low.includes("duration"))){
    return "Seedance refused one selected video reference. Reference videos must be short and draft-resolution (roughly 480p/720p, 2–15s). The Stage now skips unsafe previous-clip references automatically; reload and try the render again.";
  }
  if(low.includes("failed to download") || low.includes("download the file") || low.includes("url is accessible")){
    return "The video model couldn't download one of the selected input assets. Cinema Machine now refreshes cloud image URLs and stages browser-only blobs through the proxy, so if this persists, one selected asset is likely missing, expired, private, or too large to stage. Re-open or regenerate that source asset, make sure the selected thumbnails load, then try Generate clip again.";
  }
  return raw;
}
function stageCanOfferTextOnlyRecovery(err, modelId){
  if(String(modelId||"")!=="seedance-2.5") return false;
  const s=String((err&&err.message)||err||"");
  const policy=/provider rejected|content(?:,| ) safety|content policy|safety policy|likeness policy|policy refusal/i.test(s);
  const suppliedMedia=/images? or videos?|supplied (?:media|inputs?)|character reference|likeness(?:es)? of real (?:people|persons?)|private information/i.test(s);
  return policy && suppliedMedia;
}
function stageTextOnlyAssetLabel(asset){
  if(!asset) return "the described subject";
  if(asset.kind==="audio") return "the quoted dialogue";
  if(asset.kind==="video") return "the preceding action";
  let label=String(asset.label||"").split(/\s+[·—]\s+/)[0].trim();
  if(asset.assetRole==="shot_anchor") return "the designed shot composition";
  if(!label) label=asset.referenceKind==="location" ? "the described location"
    : asset.referenceKind==="prop" ? "the described prop"
    : asset.referenceKind==="character" ? "the described character"
    : "the described subject";
  return label;
}
function stageTextOnlyPrompt(prompt, assets){
  const labels={};
  (assets||[]).forEach(a=>{
    const tok=stageAssetMention(a);
    if(tok&&tok!=="@") labels[tok.toLowerCase()]=stageTextOnlyAssetLabel(a);
  });
  let out=String(prompt||"")
    // Locked voice references cannot travel on Seedance's text-to-video endpoint.
    // The exact quoted screenplay dialogue remains in the timed plan for native speech.
    .replace(/^VOICE CAST\s*[—-][^\n]*(?:\n+)?/gmi,"")
    .replace(/@(Image|Video|Audio)\d+/gi,m=>labels[m.toLowerCase()]||({image:"the described subject",video:"the preceding action",audio:"the quoted dialogue"}[m.slice(1).replace(/\d+$/g,"").toLowerCase()]))
    .replace(/Use the selected references to lock identity, appearance variants, wardrobe, props and location geography\./gi,
      "Use the written character, wardrobe, prop and location continuity descriptions consistently.")
    .replace(/from the references/gi,"from the written continuity description")
    .replace(/selected references/gi,"written continuity description")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
  return "REFERENCE-FREE RENDER — generate only from the written direction; no source media is attached.\n\n"+out;
}
function stageShotRangeLabel(values){
  const nums=Array.from(new Set((values||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))).sort((a,b)=>a-b);
  if(!nums.length) return "";
  const ranges=[];
  for(let i=0;i<nums.length;){
    const start=nums[i];let end=start;
    while(i+1<nums.length&&nums[i+1]===end+1){ i++;end=nums[i]; }
    ranges.push(start===end?String(start):(start+"–"+end));i++;
  }
  return (nums.length===1?"Shot ":"Shots ")+ranges.join(", ");
}
function stageGroupReferenceIssues(rows){
  const groups=new Map();
  (rows||[]).filter(Boolean).forEach((row,i)=>{
    const key=String(row.groupKey||[row.blocking?"blocking":"notice",row.message||"",i].join("|"));
    let group=groups.get(key);
    if(!group){ group={...row,shotNs:[]};groups.set(key,group); }
    if(Number.isInteger(Number(row.shotN))&&Number(row.shotN)>0) group.shotNs.push(Number(row.shotN));
    if(row.blocking) group.blocking=true;
  });
  return Array.from(groups.values()).map(group=>{
    const affected=stageShotRangeLabel(group.shotNs);
    const base=String(group.message||"Required reference is unavailable").trim().replace(/[.\s]+$/g,"");
    return {...group,message:base+(affected?(". Affects "+affected+"."):"."),shotNs:undefined};
  });
}
window.stageCanOfferTextOnlyRecovery=stageCanOfferTextOnlyRecovery;
window.stageTextOnlyPrompt=stageTextOnlyPrompt;
window.stageShotRangeLabel=stageShotRangeLabel;
window.stageGroupReferenceIssues=stageGroupReferenceIssues;
/* raw fal queue statuses (IN_QUEUE / IN_PROGRESS…) are for machines — this is what
   people see. Batch composites like "2/4 takes · IN_PROGRESS" humanize too. */
function stageStatusLabel(s){
  const raw = String(s||"").trim();
  if(!raw) return "";
  return raw
    .replace(/\bIN_QUEUE\b/g,"Waiting in the queue")
    .replace(/\bIN_PROGRESS\b/g,"Rendering")
    .replace(/\bRECONNECTING\b/g,"Connection blip — reconnecting to the render")
    .replace(/\bCOMPLETED\b/g,"Finishing up")
    .replace(/\bCANCELL?ED\b/g,"Cancelled")
    .replace(/_/g," ");
}
async function stageServerAssetUrl(asset, fallbackUrl){
  const raw = (asset&&asset.url) || fallbackUrl || "";
  const id = asset && asset.id;
  if(id && typeof nbRemoteImageUrl==="function"){
    try{ const u = await nbRemoteImageUrl(id); if(u) return u; }catch(e){}
  }
  return raw;
}
function _shotAudioReady(sh, auds){ return !!((auds&&auds[sh.id]) || (sh&&sh.lineAudio&&sh.lineAudio.durationMs)); }
/* the clip's AUDIO-CLOCK duration — measured line audio PLUS breathing room. Scenes
   need air: 0.6s to settle in, 0.8s between lines (a look, a reaction), 0.6s to hold
   the final moment. Without it a two-line clip rendered wall-to-wall speech and the
   prompt's action beats had zero seconds to happen in. Clamped to the model's ceiling. */
const CLIP_AIR = { lead:0.6, gap:0.8, tail:0.6 };
function _clipMeasuredSec(clip, maxSec){
  const shots = ((clip&&clip.data&&clip.data.shots)||[]);
  const lines = ((clip&&clip.data&&clip.data.lineShots)||[]).filter(sh=>String(sh.dialogue||"").trim());
  if(!lines.length) return 0;
  if(!lines.every(sh=>sh.lineAudio && sh.lineAudio.durationMs)) return 0;
  // walk EVERY member shot, the same way the Timeline recipe lays its windows:
  // dialogue shots = air + the measured line; ACTION shots = their runtime estimate
  // (capped — an estimate must never eat the whole clip). Counting only the lines
  // used to squeeze a one-line + two-action clip to ~4s with no time to act.
  let t = CLIP_AIR.lead, spoken = 0;
  shots.forEach(sh=>{
    const talks = String((sh&&sh.dialogue)||"").trim();
    if(talks){ if(spoken>0) t += CLIP_AIR.gap; t += Number((sh.lineAudio||{}).durationMs||0)/1000; spoken++; }
    else t += Math.min(3.5, (typeof stageShotRuntime==="function") ? stageShotRuntime(sh) : 2);
  });
  t += CLIP_AIR.tail;
  return Math.max(4, Math.min(maxSec||15, Math.round(t*10)/10));
}
function _normStageText(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function stageBeatRow(beatsMap, sceneId, beatN){
  return (((beatsMap||{})[sceneId]||{}).rows||[]).find(r=>Number(r.n)===Number(beatN)) || null;
}
/* The canonical screenplay resolver is app/shot-screenplay.js. Stage deliberately
   does not provide a second parser: shipped load order must expose that helper
   before this module, and beat-opening shots fail explicitly when it is absent. */
function stageBeatOpeningShot(sh){
  return !!(sh&&sh.keyframeMode==="beat-opening");
}
function stageDeliveryIsRemote(delivery){
  const d=String(delivery||"").trim().toLowerCase().replace(/\s+/g,"-");
  return !!d && d!=="in-room" && d!=="onscreen" && /^(?:vo|voice-over|off-screen|offscreen|phone|text|sms|message|voicemail|radio|intercom)$/.test(d);
}
function stageDeliveryIsText(delivery){
  const d=String(delivery||"").trim().toLowerCase().replace(/\s+/g,"-");
  return /^(?:text|sms|message)$/.test(d);
}
function stageBeatSource(scene,sh,ctx){
  ctx=ctx||{};
  const helper=typeof window.shotBeatScreenplay==="function" ? window.shotBeatScreenplay : null;
  if(!helper)return stageBeatOpeningShot(sh) ? {hasSource:false,missing:true} : null;
  let live=null;
  try{ live=helper(scene,sh&&sh.beatN,{drafts:ctx.drafts||{},characters:ctx.characters||[],
    beatsMap:ctx.beatsMap||{}}); }catch(e){ live=null; }
  if(live&&live.hasSource)return live;
  return stageBeatOpeningShot(sh) ? {hasSource:false,missing:true} : null;
}
/*
 * Ordinary Stage shots are not beat-opening keyframes, so their historical
 * action / beatPlan.micro fields used to become the editable video direction.
 * Those fields are production design from the moment shots were drafted, not
 * the current Writers' Room source.  Resolve the authored action blocks again
 * at render time and map them to the selected shot's old coverage only as
 * navigation.  The returned object is prompt data, never a write-back to a
 * shot or a screenplay draft.
 */
function stageCurrentScreenplayDirection(scene,sh,ctx,peerShots,clipBeatComplete){
  const source=stageBeatSource(scene,sh,ctx);
  if(!source||!source.hasSource||!Array.isArray(source.blocks)) return null;
  const blocks=source.blocks.filter(b=>b&&String(b.type||"").toLowerCase()!=="scene"
    && String(b.text||"").trim());
  const actions=blocks.filter(b=>/^(action|trans)$/i.test(String(b.type||"")));
  const group=(peerShots||[]).filter(x=>x&&Number(x.beatN)===Number(sh&&sh.beatN)
    && String(x.sceneId||"")===String(sh&&sh.sceneId||""));
  const oldMicro=(sh&&sh.beatPlan&&Array.isArray(sh.beatPlan.micro))
    ? sh.beatPlan.micro.map(x=>String(x||"").replace(/\s+/g," ").trim()).filter(Boolean) : [];
  const textOf=b=>String(b&&b.text||"").replace(/\s+/g," ").trim();
  const issue=(message,code="screenplay-coverage-review")=>({
    blocked:true,code,message,source,actions:[],text:"",script:"",
    dialogue:"",dialogueRow:null,dialogueDelivery:"onscreen"
  });
  const covers=Array.isArray(sh&&sh.covers)
    ? sh.covers.map(Number).filter(Number.isFinite) : [];
  const completeBeat=!!clipBeatComplete;
  const wholeBeat=completeBeat&&group.length===1&&group[0]&&group[0].id===sh.id;
  /*
   * The clip builder marks a beat complete only when it contains every
   * scene/beat peer. A sole peer is therefore a whole-beat unit too; a
   * part/single-shot render is not. Resolve partial coverage against every
   * scene/beat peer, never against the selected clip's shortened peer list.
   */
  if(!wholeBeat){
    if(!group.length||!covers.length)
      return issue("This partial screenplay beat has no explicit shot coverage. Reconcile Covers in Shots before rendering.");
    if(covers.some(n=>!Number.isInteger(n)||n<1||n>actions.length))
      return issue("This shot's screenplay coverage no longer maps to the current authored action blocks. Review Covers in Shots before rendering.");
    if(oldMicro.length&&oldMicro.length!==actions.length)
      return issue("The screenplay action blocks changed shape under an existing multi-shot coverage map. Reconcile the shot boundaries in Shots before rendering.");
  }
  /*
   * Covers are the stable association.  Apply them before looking at any
   * historical micro text. An exact authored line can relocate within the
   * selected covered slots (legacy shots stored per-shot micro arrays); all
   * rewrites fall back to the stable covered index only when the action shape
   * is unchanged. Never fuzzy-match a rewrite or infer an ordinal.
   */
  let actionIndexes=wholeBeat ? actions.map((_,i)=>i) : covers.map(n=>n-1);
  if(!wholeBeat&&oldMicro.length){
    const coveredOld=covers.map(n=>oldMicro[n-1]).filter(Boolean);
    const exactIndexes=[];
    coveredOld.forEach(old=>{
      const hits=actions.map((block,i)=>({i,text:textOf(block)}))
        .filter(x=>x.text===old);
      if(hits.length===1) exactIndexes.push(hits[0].i);
    });
    if(exactIndexes.length===coveredOld.length) actionIndexes=exactIndexes;
  }
  const selectedActions=actionIndexes.map(i=>actions[i]).filter(Boolean);
  const dialogue=Array.isArray(source.dialogue) ? source.dialogue.filter(x=>x&&String(x.text||"").trim()) : [];
  const selectedDialogue=[];
  let clipDialogues=[];
  const explicitDialogueFor=(candidate)=>{
    const explicitLines=Array.isArray(candidate&&candidate.dialogueLines)
      ? candidate.dialogueLines.map(x=>String(x&&x.text||x||"").trim()).filter(Boolean)
      : (String(candidate&&candidate.dialogue||candidate&&candidate.lineAudio&&candidate.lineAudio.text||"").trim()
        ? [String(candidate.dialogue||candidate.lineAudio.text).trim()] : []);
    const explicitIndexes=[];
    ["screenplayDialogueIndex","dialogueIndex","lineIndex","dialogueBlockIndex"].forEach(k=>{
      const n=Number(candidate&&candidate[k]);
      if(Number.isInteger(n)&&n>=0) explicitIndexes.push(n);
    });
    const indexes=[];
    for(const i of explicitIndexes){
      if(i>=dialogue.length)return {error:"A shot's saved dialogue index no longer matches the current authored lines."};
      if(indexes.indexOf(i)<0)indexes.push(i);
    }
    for(const line of explicitLines){
      const matches=dialogue.map((x,i)=>({x,i}))
        .filter(v=>String(v.x&&v.x.text||"").trim()===line);
      if(matches.length!==1)
        return {error:matches.length
          ? "A shot's saved dialogue matches multiple authored lines. Reconcile the line assignment before rendering."
          : "A shot's saved dialogue no longer matches the current authored line. Reconcile the line assignment before rendering."};
      if(indexes.indexOf(matches[0].i)<0)indexes.push(matches[0].i);
    }
    indexes.sort((a,b)=>a-b);
    return {hasExplicit:!!(explicitLines.length||explicitIndexes.length),indexes};
  };
  if(dialogue.length){
    const localExplicit=explicitDialogueFor(sh);
    if(localExplicit.error)
      return issue(localExplicit.error,"screenplay-dialogue-review");
    const assigned=new Set();
    const assignments=(group.length?group:[sh]).map(candidate=>explicitDialogueFor(candidate));
    for(const assignment of assignments){
      if(assignment.error)
        return issue(assignment.error,"screenplay-dialogue-review");
      (assignment.indexes||[]).forEach(i=>assigned.add(i));
    }
    const allAssigned=assigned.size===dialogue.length;
    (localExplicit.indexes||[]).forEach(i=>selectedDialogue.push(dialogue[i]));
    if(wholeBeat) selectedDialogue.splice(0,selectedDialogue.length,...dialogue);
    else if(completeBeat) clipDialogues=dialogue.filter((_,i)=>!assigned.has(i));
    /*
     * A partial silent shot is safe only when every authored line has an
     * explicit assignment on another complete-peer shot. Any remaining
     * unassigned speech must stop the render rather than becoming guessed
     * silence. Complete clips keep those rows as ordered clip-level speech.
     */
    if(!completeBeat&&!allAssigned)
      return issue("This partial screenplay beat has authored dialogue without an explicit shot line association. Assign every line to a shot before rendering.","screenplay-dialogue-review");
  }
  const actionItems=selectedActions.map(textOf).filter(Boolean);
  const line=selectedDialogue[0]||null;
  const scriptParts=actionItems.slice();
  if(line)scriptParts.push(String(line.speaker||"the speaker")+": "+String(line.text||"").trim());
  return {
    source,
    actions:actionItems,
    text:actionItems.join(" "),
    script:scriptParts.join(" "),
    dialogues:selectedDialogue.slice(),
    clipDialogues,
    dialogueUnassigned:clipDialogues.length>0,
    dialogue:selectedDialogue.map(x=>String(x&&x.text||"").trim()).filter(Boolean).join(" "),
    dialogueRow:line,
    dialogueDelivery:line&&line.delivery || "onscreen"
  };
}
function stageShotMicroTexts(sh){
  if(stageBeatOpeningShot(sh))return [];
  // the micro-beats this shot COVERS are the story canon ("what happens"); sh.action is
  // the camera's staging of them. Coverage is explicit (sh.covers, 1-based into
  // beatPlan.micro); older shots drafted before covers existed fall back to the SAME fuzzy
  // matcher the Shots UI badges use — never a second, divergent heuristic.
  const micro = (sh && sh.beatPlan && Array.isArray(sh.beatPlan.micro)) ? sh.beatPlan.micro : [];
  if(!micro.length) return [];
  let nums = [];
  if(Array.isArray(sh.covers) && sh.covers.length) nums = sh.covers;
  else if(typeof window.microCoverage==="function" && sh.id){
    // window.microCoverage explicitly (not a bare global): vm test harnesses isolate
    // globals, and a silent no-op here would only surface as missing prompt text.
    // force:true bypasses the UI's no-data-no-signal gate — see microCoverage.
    try{
      const r = window.microCoverage([sh], micro, {force:true});
      const s = r && r.map && r.map[sh.id];
      if(s && s.size) nums = Array.from(s);
    }catch(e){}
  }
  const out = nums.map(n=>String(micro[Number(n)-1]||"").replace(/\s+/g," ").trim()).filter(Boolean);
  // legacy clips carry a baked-in "\u2026" (180-char drafting cap) — heal against the
  // beat's screenplay canon so prompts and the shoot package get the FULL sentence
  if(out.some(t=>/\u2026\s*$/.test(t)) && typeof window.microHealText==="function"
      && typeof window.beatScriptText==="function" && sh.sceneId){
    const canon = window.beatScriptText(sh.sceneId, sh.beatN);
    if(canon) return out.map(t=>window.microHealText(t, canon));
  }
  return out;
}
function stageBeatScriptBlocks(scene, drafts, beatN){
  const n = Number(beatN);
  const d = scene && drafts && drafts[scene.id];
  const blocks = (d && Array.isArray(d.blocks)) ? d.blocks : [];
  return blocks.filter(b=>b && b.type!=="scene" && Number(b.beat)===n);
}
function stageBeatDialogueLines(scene, drafts, beatN){
  const live=(typeof window.shotBeatScreenplay==="function")
    ? window.shotBeatScreenplay(scene,beatN,{drafts}) : null;
  if(live&&live.hasSource)return live.dialogue||[];
  const blocks = stageBeatScriptBlocks(scene, drafts, beatN);
  const out = [];
  let speaker = "", parenthetical = "";
  blocks.forEach(b=>{
    const t = String(b.text||"").replace(/\s+/g," ").trim();
    if(!t) return;
    if(b.type==="char"){ speaker = t.replace(/\(cont'?d\)/ig,"").trim(); parenthetical = ""; return; }
    if(b.type==="paren"){ parenthetical = t.replace(/^\(|\)$/g,"").trim(); return; }
    if(b.type==="dia"){
      out.push({ speaker:speaker||"the speaker", parenthetical, text:t,
        delivery:/\b(?:v\.?\s*o\.?|voice\s*over|off[\s-]?screen|phone|telephone|voicemail|radio|intercom)\b/i.test(parenthetical)
          ? "vo" : /\b(?:text|sms|message)\b/i.test(parenthetical) ? "text" : "onscreen" });
      parenthetical = "";
      return;
    }
    parenthetical = "";
  });
  return out;
}
function stageShotDialogueLine(scene, drafts, sh, ctx){
  const lines = stageBeatDialogueLines(scene, drafts, sh&&sh.beatN);
  const fallbackText = String((sh&&sh.dialogue) || (sh&&sh.lineAudio&&sh.lineAudio.text) || "").trim().replace(/^["“]|["”]$/g,"");
  if(!lines.length) return fallbackText ? {
    speaker:(stageDialogueSpeaker(scene, drafts, (ctx&&ctx.beatsMap)||{}, sh, ctx)||{}).name || "the speaker",
    text:fallbackText
  } : null;
  if(!fallbackText) return null;
  if(lines.length===1) return { ...lines[0], text:fallbackText,
    char:stageCharNameMatch(lines[0].speaker, ctx&&ctx.characters) };
  const raw = _normStageText(fallbackText);
  let best = null, score = -1;
  lines.forEach(ln=>{
    const n = _normStageText(ln.text);
    let s = 0;
    if(raw && n && (n.indexOf(raw)>=0 || raw.indexOf(n)>=0)) s = 2;
    else if(raw && n){
      const rt = new Set(raw.split(/\s+/).filter(Boolean));
      const nt = new Set(n.split(/\s+/).filter(Boolean));
      let hit = 0; rt.forEach(w=>{ if(nt.has(w)) hit++; });
      s = hit / Math.max(1, Math.sqrt(rt.size*nt.size));
    }
    if(s>score){ score=s; best=ln; }
  });
  // If the selected shot's words do not actually match a screenplay line, never
  // borrow the first line from the whole beat. Older shot lists often contain a
  // shortened/revised dialogue field; those exact selected words are safer than
  // leaking another shot's speech into this render.
  if(!best || score<0.55){
    const sp=stageDialogueSpeaker(scene,drafts,(ctx&&ctx.beatsMap)||{},sh,ctx)||{};
    return { speaker:sp.name||"the speaker", text:fallbackText,
      char:stageCharNameMatch(sp.name,ctx&&ctx.characters) };
  }
  // Speaker/parenthetical may come from the matched script block, but the words
  // belong to the selected shot. Never expand or replace them with whole-beat text.
  return { ...best, text:fallbackText, char:stageCharNameMatch(best.speaker, ctx&&ctx.characters) };
}
function stageShotMicroPromptText(scene, drafts, beatsMap, sh, max){
  if(stageBeatOpeningShot(sh)){
    const src=stageBeatSource(scene,sh,{drafts,beatsMap});
    return src&&src.text ? src.text : "";
  }
  const micro = stageShotMicroTexts(sh);
  let text = micro.length ? micro.map((m,i)=>"Micro-beat "+(i+1)+": "+m.replace(/[\s.;]+$/,".")).join(" ") : "";
  if(!text) text = stageShotCanonLine(scene, drafts, beatsMap, sh, max||0);
  if(max && text.length>max) text = text.slice(0, Math.max(0, max-1)).replace(/\s+\S*$/,"")+"…";
  return text;
}
function stageShotScriptText(scene, drafts, sh, max){
  if(stageBeatOpeningShot(sh)){
    const src=stageBeatSource(scene,sh,{drafts});
    if(src&&src.text)return src.text;
  }
  // resolve through the beat's micro-beats first: the covered micro-beat is the complete,
  // canonical statement of the event (and names characters the camera line may only imply,
  // which the cast-sheet scan relies on). sh.action is appended as staging detail when it
  // adds information beyond the micro-beat. Beat prose is the last-resort fallback for
  // shots with neither — reading it FIRST stamped the whole beat's prose onto every shot.
  const M = (max==null) ? 160 : max;   // 0 = NO cap — editor views show the FULL line
  const own = String((sh&&sh.action)||"").replace(/\s+/g," ").trim();
  const microT = stageShotMicroTexts(sh).join(" ").replace(/\s+/g," ").trim();
  let base = "";
  if(microT && own){
    const a = _normStageText(microT), b = _normStageText(own);
    if(a && b && a!==b && a.indexOf(b)<0 && b.indexOf(a)<0){
      // BUDGETED merge: canon + staging combine ONLY when both fit the cap whole.
      // Otherwise return just the canon and let stageShotCanonLine carry the staging
      // as its "Storyboard panel action" part — a mid-sentence "…" cut of the merge
      // is worse than either complete half (and broke canon-line dedupe downstream,
      // duplicating the staging text verbatim in derived prompts).
      const merged = microT+" "+own;
      base = (M>0 && merged.length>M) ? microT : merged;
    }
    else base = (own.length >= microT.length) ? own : microT; // one contains the other: keep the fuller
  } else base = microT || own;
  if(base){
    return (M>0 && base.length>M) ? base.slice(0, Math.max(0, M-1)).replace(/\s+\S*$/,"")+"\u2026" : base;
  }
  if(typeof screenplayBeatTitle==="function"){
    const t = screenplayBeatTitle(scene, drafts||{}, sh&&sh.beatN, M>0?M:undefined);
    if(t) return t;
  }
  return "";
}
function stageCharNameMatch(name, characters){
  const n = _normStageText(String(name||"").replace(/\(cont'?d\)/ig,""));
  if(!n) return null;
  return (characters||[]).find(c=>{
    const cn = _normStageText(c&&c.name);
    return cn && (cn===n || cn.indexOf(n)>=0 || n.indexOf(cn)>=0);
  }) || null;
}
function stageDialogueSpeaker(scene, drafts, beatsMap, sh, ctx){
  const blocks = (((drafts||{})[scene.id]||{}).blocks||[]).filter(b=>Number(b.beat)===Number(sh&&sh.beatN));
  const line = _normStageText(sh&&sh.dialogue);
  for(let i=0;i<blocks.length;i++){
    const b = blocks[i] || {}, next = blocks[i+1] || {};
    if(b.type==="char" && (next.type==="dia" || next.type==="paren")){
      const nextText = _normStageText(next.text);
      if(!line || !nextText || nextText.indexOf(line)>=0 || line.indexOf(nextText)>=0){
        const c = stageCharNameMatch(b.text, ctx&&ctx.characters);
        if(c) return { id:c.id, name:c.name };
        const nm = String(b.text||"").replace(/\(cont'?d\)/ig,"").trim();
        if(nm) return { id:"", name:nm };
      }
    }
  }
  const script = stageShotScriptText(scene, drafts, sh, 220);
  const m = String(script||"").match(/^\s*([A-Z0-9][A-Z0-9 _.'-]{1,40})\s*:/);
  if(m){
    const c = stageCharNameMatch(m[1], ctx&&ctx.characters);
    if(c) return { id:c.id, name:c.name };
    return { id:"", name:m[1].replace(/\(cont'?d\)/ig,"").trim() };
  }
  // text drift tolerance: when the beat's script has exactly ONE speaking character,
  // trust it even though the dialogue string didn't substring-match above
  const charBlocks = blocks.filter(b=>b && b.type==="char");
  const distinct = Array.from(new Set(charBlocks.map(b=>_normStageText(b.text))));
  if(charBlocks.length && distinct.length===1){
    const c = stageCharNameMatch(charBlocks[0].text, ctx&&ctx.characters);
    if(c) return { id:c.id, name:c.name };
    const nm = String(charBlocks[0].text||"").replace(/\(cont'?d\)/ig,"").trim();
    if(nm) return { id:"", name:nm };
  }
  // From here down it's guessing (the script named no speaker). The FRESH guess —
  // the character named EARLIEST in the action text (its subject) — outranks the
  // lineAudio stamp, because that stamp was itself minted by this resolver at
  // voicing time: trusting it first made a wrong guess permanent (every re-voice
  // re-read its own stale answer). Cast-array order is never used — that bias
  // credited the protagonist with everyone's lines.
  const ids = (typeof inFrameCast==="function") ? inFrameCast(sh, scene, (ctx&&ctx.characters)||[]) : ((sh&&sh.subjects)||[]);
  const act = " "+String((sh&&sh.action)||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ")+" ";
  const posOf = (c)=>{ const w = String(c.name||"").toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3)[0];
    const i = w ? act.indexOf(" "+w+" ") : -1; return i<0 ? 1e9 : i; };
  const first = (ids||[]).map(id=>ctx&&ctx.charById&&ctx.charById[id]).filter(Boolean)
    .sort((a,b)=>posOf(a)-posOf(b))[0];
  if(first) return { id:first.id, name:first.name };
  const la = sh && sh.lineAudio;
  if(la && (la.speaker || la.speakerId)){
    const c = (la.speakerId && ctx && ctx.charById && ctx.charById[la.speakerId]) || stageCharNameMatch(la.speaker, ctx&&ctx.characters);
    return { id:(c&&c.id)||la.speakerId||"", name:(c&&c.name)||la.speaker||"" };
  }
  return { id:"", name:"the speaker" };
}
function stageShotSheetText(scene, beatsMap, sh, max){
  if(stageBeatOpeningShot(sh)){
    const src=stageBeatSource(scene,sh,{beatsMap});
    return String((src&&src.openingAction)||(sh&&sh.action)||"").replace(/\s+/g," ").trim();
  }
  let t = String((sh&&sh.action)||"").replace(/\s+/g," ").trim();
  if(!t){
    const r = stageBeatRow(beatsMap, scene&&scene.id, sh&&sh.beatN);
    t = [r&&r.drive&&r.drive.d, r&&r.react&&r.react.d].filter(Boolean).join(" ");
  }
  if(max && t.length>max) t = t.slice(0, max-1).replace(/\s+\S*$/,"")+"…";
  return t;
}
function stageShotCanonLine(scene, drafts, beatsMap, sh, max){
  const cap = (max==null) ? 180 : max;   // 0 = NO cap — full canon (the Multi-shot editor)
  const script = stageShotScriptText(scene, drafts, sh, cap);
  const sheet = stageShotSheetText(scene, beatsMap, sh, cap);
  if(script && sheet){
    // judge "does the storyboard line add information" on the text actually RETURNED.
    // stageShotScriptText never returns a truncated merge anymore (budgeted merge:
    // canon+staging combine only when both fit whole), so this containment check is
    // exact — when the budget forced canon-only, the staging line rides here instead.
    const a=_normStageText(script), b=_normStageText(sheet);
    if(a && b && a!==b && a.indexOf(b)<0 && b.indexOf(a)<0)
      return script+" Storyboard panel action: "+String(sheet||"").replace(/[\s.;…]+$/,"");
  }
  return script || sheet || "";
}
function stageSheetPanelMeta(g, i, scene){
  const abs = (Number(g&&g.start)||0) + i;
  const sceneShots = scene ? ((window.__sbShots||[]).filter(sh=>sh && sh.sceneId===scene.id)
    .sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0))) : null;
  const ranges = stagePageRanges(sceneShots);
  let page = Math.floor(abs/4)+1, cell = abs % 4;   // legacy fallback
  let acc = 0;
  for(let p=0;p<ranges.length;p++){
    if(abs>=acc && abs<acc+ranges[p].count){ page=p+1; cell=abs-acc; break; }
    acc += ranges[p].count;
  }
  return { abs, page, panel:cell+1, half:cell<2?"top":"bottom" };
}

/* ---------- derive everything a clip needs from existing pre-production --------- */
function stageScenePeerShots(scene,ctx,fallback){
  ctx=ctx||{};
  const sceneId=String(scene&&scene.id||"");
  let list=[];
  if(ctx.shotsByScene&&Array.isArray(ctx.shotsByScene[sceneId]))
    list=ctx.shotsByScene[sceneId];
  else if(Array.isArray(ctx.sceneShots))
    list=ctx.sceneShots;
  else if(Array.isArray(ctx.shots))
    list=ctx.shots;
  if(!list.length) list=fallback||[];
  return list.filter(sh=>sh&&String(sh.sceneId||"")===sceneId);
}
function buildClipData(scene, g, ctx, maxSec){
  const shots = g.shots||[];
  const first = shots[0]||{};
  const scenePeerShots=stageScenePeerShots(scene,ctx,shots);
  const currentDirections = new Map();
  const completeBeatNumbers=new Set();
  const clipDialogueByBeat=new Map();
  const shotIds=new Set(shots.map(sh=>sh&&sh.id).filter(Boolean));
  Array.from(new Set(scenePeerShots.map(sh=>Number(sh&&sh.beatN))))
    .forEach(beatN=>{
      const peers=scenePeerShots.filter(sh=>Number(sh&&sh.beatN)===beatN);
      if(peers.length&&peers.every(sh=>shotIds.has(sh&&sh.id))) completeBeatNumbers.add(beatN);
    });
  const screenplayDirectionIssues=[];
  shots.forEach(sh=>{
    const completeBeat=completeBeatNumbers.has(Number(sh&&sh.beatN));
    const direction=stageCurrentScreenplayDirection(scene,sh,ctx,scenePeerShots,completeBeat);
    if(direction){
      currentDirections.set(sh&&sh.id,direction);
      if(completeBeat){
        const lines=direction.clipDialogues||[];
        if(lines.length&&!clipDialogueByBeat.has(Number(sh&&sh.beatN)))
          clipDialogueByBeat.set(Number(sh&&sh.beatN),lines);
      }
      if(direction.blocked) screenplayDirectionIssues.push({
        code:direction.code||"screenplay-coverage-review",blocking:true,
        shotId:sh&&sh.id,message:direction.message
      });
    }
  });
  // in-frame cast (union across the clip's shots), de-duped, names + ids
  const castIds = [];
  shots.forEach(sh=>{
    const beatSource=stageBeatSource(scene,sh,ctx);
    const currentDirection=currentDirections.get(sh&&sh.id)||null;
    /* A beat-opening frame is the first physical state, not a montage of every
       later action. Use the live source's opening cast and never the stale
       subjects array (which commonly still contains a phone/voicemail participant). */
    const inc=(beatSource&&beatSource.missing)
      ? []
      : (beatSource&&beatSource.hasSource)
      ? (stageBeatOpeningShot(sh) ? (beatSource.openingCharacterIds||[]) : (beatSource.physicalCharacterIds||[]))
      : ((typeof inFrameCast==="function")?inFrameCast(sh, scene, ctx.characters||[]):(sh.subjects||[]));
    // ALSO scan the text the prompt actually SPEAKS (the vidText override or the beat-prose
    // canon line, composed exactly as panelLines does): beat prose can name characters the
    // per-shot action line omits ("the rear door clunks. MARCUS folds in…"), and anyone the
    // prompt names MUST have their identity sheet attached or the model invents them.
    const spoken = (stageBeatOpeningShot(sh)&&beatSource&&beatSource.hasSource)
      ? "" : String(sh.vidText||"").trim()
      || (currentDirection ? currentDirection.text
        : ((typeof stageShotCanonLine==="function") ? stageShotCanonLine(scene, ctx.drafts, ctx.beatsMap, sh, 190) : ""));
    // dialogue surfaces too: the voice-cast preamble, lip-sync recipes and audio role
    // labels all name the SPEAKER — a speaker-only character (never in the prose) still
    // needs their identity sheet attached or lip-sync renders an invented face.
    const dlg = stageBeatOpeningShot(sh)&&beatSource&&beatSource.hasSource
      ? (beatSource.dialogue||[]).map(x=>x&&x.text||"").join(" ")
      : (currentDirection ? currentDirection.dialogue : String(sh.dialogue||""));
    const spk = dlg.trim() && (typeof stageDialogueSpeaker==="function")
      ? stageDialogueSpeaker(scene, ctx.drafts, ctx.beatsMap, sh, ctx) : null;
    const named = stageBeatOpeningShot(sh)&&beatSource&&beatSource.hasSource
      ? [] : ((typeof scanTextForChars==="function")
      ? scanTextForChars([spoken, dlg,
          (currentDirection&&currentDirection.dialogueRow&&currentDirection.dialogueRow.speaker)
            || (spk&&spk.name)||""].filter(Boolean).join("\n"), ctx.characters||[]) : []);
    const namedIds=Array.isArray(named)?named:[];
    inc.concat(namedIds).forEach(id=>{ if(castIds.indexOf(id)<0) castIds.push(id); });
  });
  const cast = castIds.map(id=>({ id, name:(ctx.charById[id]||{}).name||"" })).filter(c=>c.name);
  // in-frame props (union)
  const propIds = [];
  let propLedger = {};
  try{ propLedger = (typeof sceneContinuityLedger==="function") ? sceneContinuityLedger(scene, shots, ctx.charById, ctx.propById) : {}; }catch(e){}
  shots.forEach(sh=>{ const inc=(typeof inFrameProps==="function")?inFrameProps(sh, scene, ctx.charById, ctx.propById):[];
    (inc||[]).concat((propLedger&&propLedger[sh.id])||[]).forEach(id=>{ if(propIds.indexOf(id)<0) propIds.push(id); }); });
  // STATE + CUSTODY aware prop resolution — the same story-order rules the Shots room
  // uses: the prop's ACTIVE appearance-state variant sheet attaches (never the stale
  // base), and the reference label names who actually holds it in this scene.
  const _storyScenes = ctx.scenes || ((window.turnContinuity||{}).scenes) || [];
  const clipProps = propIds.map(id=>{
    const p = ctx.propById[id];
    if(!p || !p.name) return null;
    // A clip may cross several micro-beats. Resolve every member shot and attach the
    // prop only when it is active in at least one of those precise moments; do not let
    // the first shot's state erase a later pickup/placement.
    const resolvedStates = (shots||[]).map(sh=>(typeof propStateAt==="function")
      ? propStateAt(p,scene&&scene.id,sh&&sh.beatN,sh&&sh.microBeatId,sh&&sh.id,ctx) : null).filter(Boolean);
    const activeResolved = resolvedStates.filter(x=>x.active);
    const rs = activeResolved.slice().reverse().find(x=>x.referenceAssetId)
      || activeResolved[0]
      || resolvedStates[0]
      || null;
    if(resolvedStates.length && !resolvedStates.some(x=>x.active)) return null;
    const stateAsset=rs&&rs.referenceAssetId;
    const so = stateAsset ? {id:stateAsset,state:{label:(rs.event&&rs.event.referenceStateLabel)||rs.condition||"changed condition"}}
      : ((typeof shotPropSheetId==="function") ? shotPropSheetId(p, scene, _storyScenes) : { id:p.id, state:null });
    const co = (typeof custodyOwnerAt==="function") ? custodyOwnerAt(p, scene, _storyScenes) : { name:p.ownerName, handover:null };
    return { id:p.id, sheetId:so.id||p.id, name:p.name, kind:(rs&&rs.bindingMode)||p.kind||"",
      stateLabel:(so.state&&so.state.label)||((rs&&rs.condition&&rs.condition!=="intact")?rs.condition:""),
      holder:(rs&&rs.holderName)||co.name||p.ownerName||"", placement:rs&&rs.placement||null,
      visibility:(rs&&rs.visibility)||"visible", handover:co.handover||null };
  }).filter(Boolean);
  const loc = (typeof locationForScene==="function") ? locationForScene(ctx.locations, scene.id) : null;
  // coverage-sheet resolution: the screenplay-derived unit/coverage sheet (e.g. "Minicab
  // · NIGHT") beats the master plate when the clip's shots call for it — the same
  // resolver the Shots room's frame pipeline uses, run over every shot in the clip.
  let locSheet = null;
  if(loc && typeof shotLocationCoverageSpecs==="function"){
    const drafts0 = ctx.drafts || ((window.turnContinuity||{}).drafts) || {};
    const recs = (Array.isArray(loc.coverageSheets)&&loc.coverageSheets.length) ? loc.coverageSheets
      : ((typeof deriveLocationCoverageSheets==="function") ? (deriveLocationCoverageSheets(loc,[scene],drafts0)||[]) : []);
    const seen = {};
    for(const sh of shots){
      const specs = shotLocationCoverageSpecs(loc, sh, scene, drafts0) || [];
      for(const sp of specs){
        if(!sp || sp.id===loc.id || seen[sp.id]) continue;
        seen[sp.id] = true;
        const suffix = String(sp.id).slice(String(loc.id).length+1);
        const rec = (recs||[]).find(v=>v.id===suffix);
        if(!locSheet) locSheet = { id:sp.id, name:(rec&&rec.name)||loc.name||"Location", role:sp.role||(rec&&rec.role)||"" };
      }
      if(locSheet) break;
    }
  }
  const preset = (typeof scenePreset==="function") ? scenePreset(ctx.project, scene.id) : null;
  // camera arc: first -> last distinct move label
  const moves = _uniq(shots.map(sh=> (typeof shotMoveOf==="function") ? shotMoveOf(sh.move).label : (sh.move||"")).filter(Boolean));
  const camera = moves.length ? moves.join(" → ") : "Static";
  const cameraProfile = shots.map(sh=>sh&&sh.cameraSettings&&sh.cameraSettings.camera).find(v=>v&&v!=="auto") || "auto";
  const lighting = (preset && (preset.lighting||preset.grade)) || "Naturalistic, motivated light";
  const lead = cast[0] ? cast[0].name : "the subject";
  // composed director prompt (prose, multi-beat) — readable, not the image-gen JSON
  const panelLines = shots.map((sh,i)=>{
    const meta = stageSheetPanelMeta(g, i, scene);
    const beatSource=stageBeatSource(scene,sh,ctx);
    const currentDirection=currentDirections.get(sh&&sh.id)||null;
    const canonical=stageBeatOpeningShot(sh)&&beatSource&&
      (beatSource.hasSource||beatSource.missing);
    const manualVideo=String(sh.vidText||"").trim();
    const exactLine = stageShotDialogueLine(scene, ctx.drafts, sh, ctx);
    const primaryDialogue=canonical&&beatSource.dialogue&&beatSource.dialogue[0]||null;
    const speaker = primaryDialogue && primaryDialogue.text
      ? {id:primaryDialogue.speakerId||"",name:primaryDialogue.speaker||"the speaker"}
      : exactLine && exactLine.text
      ? (exactLine.char ? { id:exactLine.char.id, name:exactLine.char.name } : { id:"", name:exactLine.speaker||"the speaker" })
      : (String(sh&&sh.dialogue||"").trim() ? stageDialogueSpeaker(scene, ctx.drafts, ctx.beatsMap, sh, ctx) : null);
    const micro = canonical ? [] : (manualVideo ? [] : (currentDirection ? currentDirection.actions : stageShotMicroTexts(sh)));
    const microText = canonical ? String(beatSource.text||"")
      : (currentDirection ? currentDirection.text
        : stageShotMicroPromptText(scene, ctx.drafts, ctx.beatsMap, sh, 190));
    // the Shots tab's camera grammar, preserved PER SHOT — the clip-level "camera arc"
    // flattens these into one description; the shoot package and timeline recipes need
    // each setup intact (size · angle · move · lens + the composition note).
    const camSpec = (typeof shotSizeOf==="function")
      ? [shotSizeOf(sh.size).label, shotAngleOf(sh.angle).label, shotMoveOf(sh.move).label, shotLensOf(sh.lens).label].filter(Boolean).join(" · ")
      : "";
    return { shotId:sh.id, beatN:sh.beatN, sheetPage:meta.page, sheetPanel:meta.panel, half:meta.half,
      // sh.vidText = the user's per-shot VIDEO description override (Multi-shot
      // editor) — video-only, never touches the canon action the image side uses
      text: canonical ? String(beatSource.text||"") : (manualVideo || (currentDirection ? microText
        : stageShotCanonLine(scene, ctx.drafts, ctx.beatsMap, sh, 190))),
      script:canonical ? String(beatSource.text||"")
        : (manualVideo || (currentDirection ? currentDirection.script
          : stageShotScriptText(scene, ctx.drafts, sh, 190))),
      sheet:canonical ? String(beatSource.openingAction||sh.action||"")
        : (manualVideo || (currentDirection ? currentDirection.text
          : stageShotSheetText(scene, ctx.beatsMap, sh, 190))),
      speaker: currentDirection&&currentDirection.dialogueRow
        ? {id:currentDirection.dialogueRow.speakerId||"",name:currentDirection.dialogueRow.speaker||"the speaker"} : speaker,
      camera:camSpec, composition:String((sh&&sh.composition)||"").trim(),
      dur:(typeof stageShotRuntime==="function") ? stageShotRuntime(sh) : 0,
      dialogue:canonical ? String((primaryDialogue&&primaryDialogue.text)||"") :
        (currentDirection ? currentDirection.dialogue
          : (exactLine && exactLine.text ? exactLine.text : String((sh&&sh.dialogue)||"").trim())),
      dialogueLines:canonical ? (beatSource.dialogue||[]) :
        (currentDirection ? (currentDirection.dialogues||[]) : []),
      dialogueDelivery:canonical ? String((primaryDialogue&&primaryDialogue.delivery)||"onscreen")
        : (currentDirection&&currentDirection.dialogueRow
          ? String(currentDirection.dialogueDelivery||"onscreen") : "onscreen"),
      beatScript:canonical ? String(beatSource.text||"") : "",
      beatDialogue:canonical ? (beatSource.dialogue||[]) : [],
      sourceScreenplayRev:canonical ? String(beatSource.sourceRev||sh.sourceScreenplayRev||"") : "",
      dialogueParenthetical:exactLine && exactLine.parenthetical ? exactLine.parenthetical : "",
      micro };
  });
  const actions = _uniq(panelLines.map(p=>String(p.text||"").trim()).filter(Boolean));
  // multi-line: one action per line, sections separated by blank lines — readable
  // for humans, and video models take newlines fine
  const body = actions.join("\n");
  const setting = loc ? (loc.name) : (scene.loc||"");
  const styleClause = preset ? ("Style: "+preset.name+" — "+preset.grade+".") : "";
  const camClause = "Camera: "+camera.toLowerCase()+".";
  const prompt = [ body, camClause, styleClause ].filter(Boolean).join("\n\n");
  // tag chips
  const chips = [
    cast.length && { k:"subject", v:cast.map(c=>c.name).join(", ") },
    actions.length && { k:"action", v:actions.join(" "), label:_firstWords(actions[0], 4) },
    setting && { k:"setting", v:setting },
    { k:"camera", v:camera.toLowerCase() },
    preset && { k:"style", v:preset.name.toLowerCase() },
    preset && { k:"mood", v:String(preset.grade||"").trim().toLowerCase(), label:_firstWords(preset.grade, 4).toLowerCase() },
  ].filter(Boolean);
  // the beat's PROTECT line travels with the clip — the shoot package shows it as a
  // story obligation so the render never quietly drops what the beat exists to protect
  const protect = shots.map(sh=>sh&&sh.beatPlan&&String(sh.beatPlan.protect||"").trim()).find(Boolean) || "";
  const lineShots = panelLines.filter(p=>String(p.dialogue||"").trim()&&!stageDeliveryIsText(p.dialogueDelivery)).map(p=>{
    const src = shots.find(sh=>sh && sh.id===p.shotId) || {};
    return { ...src, dialogue:p.dialogue, lineAudio:src.lineAudio };
  });
  const clipDialogueLines=Array.from(clipDialogueByBeat.values()).flat();
  const beatDialogues = {};
  const beatScripts = {};
  const remoteCharacterIds = [];
  _uniq(shots.map(sh=>sh&&sh.beatN).filter(Boolean)).forEach(n=>{
    const beatShots=shots.filter(sh=>Number(sh&&sh.beatN)===Number(n));
    const src=stageBeatSource(scene,beatShots[0],ctx);
    const panelDialogue=panelLines.filter(p=>Number(p&&p.beatN)===Number(n))
      .flatMap(p=>(Array.isArray(p.dialogueLines)&&p.dialogueLines.length
        ? p.dialogueLines : (String(p&&p.dialogue||"").trim() ? [p] : []))
        .map(line=>({
          ...(line&&line.evidence ? line : {}),
          speaker:(line&&line.speaker)||((p.speaker&&p.speaker.name)||"the speaker"),
          text:String(line&&line.text!=null ? line.text : p.dialogue||"").trim(),
          parenthetical:(line&&line.parenthetical)||p.dialogueParenthetical||"",
          delivery:(line&&line.delivery)||p.dialogueDelivery||"onscreen"
        })));
    /*
     * For ordinary multi-shot coverage, only the line mapped to a selected
     * shot belongs in its editable direction. The immutable screenplay
     * reference still carries every authored line in full.
     */
    const beatDirection=currentDirections.get(beatShots[0]&&beatShots[0].id);
    const clipRows=(clipDialogueByBeat.get(Number(n))||[]).slice();
    const mergedDialogue=(panelDialogue.length||clipRows.length)&&src&&Array.isArray(src.dialogue)
      ? src.dialogue.map(row=>{
          const text=String(row&&row.text||"").trim();
          const assigned=panelDialogue.findIndex(x=>x&&String(x.text||"").trim()===text);
          if(assigned>=0){
            const picked=panelDialogue[assigned];
            panelDialogue.splice(assigned,1);
            return picked;
          }
          const clipIndex=clipRows.findIndex(x=>x&&String(x.text||"").trim()===text);
          if(clipIndex>=0){
            const picked=clipRows[clipIndex];
            clipRows.splice(clipIndex,1);
            return picked;
          }
          return null;
        }).filter(Boolean)
      : (panelDialogue.length ? panelDialogue : clipRows);
    beatDialogues[n] = mergedDialogue&&mergedDialogue.length ? mergedDialogue
      : (beatDirection ? (beatDirection.dialogues||[])
        : (src&&src.hasSource&&src.dialogue&&beatShots.length===1 ? src.dialogue
          : (src&&src.hasSource ? [] : stageBeatDialogueLines(scene, ctx.drafts, n))));
    if(src&&src.hasSource){
      beatScripts[n]={hasSource:true,text:String(src.text||""),openingAction:String(src.openingAction||""),
        sourceRev:String(src.sourceRev||""),dialogue:src.dialogue||[],
        openingCharacterIds:src.openingCharacterIds||[],physicalCharacterIds:src.physicalCharacterIds||[],
        remoteCharacterIds:src.remoteCharacterIds||[],mentionedCharacterIds:src.mentionedCharacterIds||[]};
      (src.remoteCharacterIds||[]).forEach(id=>{if(remoteCharacterIds.indexOf(id)<0)remoteCharacterIds.push(id);});
    }
  });
  /*
   * stage-plan's timing helper intentionally reads beatPlan.micro.  Give the
   * prompt/render-plan path a derived copy whose micro rows contain the current
   * screenplay action, while keeping the canonical shot objects untouched.
   * Camera, lens, duration, covers, and manual vidText remain from the shot.
   */
  const promptShots = shots.map(sh=>{
    const direction=currentDirections.get(sh&&sh.id);
    if(!direction) return sh;
    const next={...sh};
    const prior=sh&&sh.beatPlan;
    const manualVideo=String(sh&&sh.vidText||"").trim();
    const micro=manualVideo ? [manualVideo] : (direction.actions||[]).slice();
    next.beatPlan={...(prior||{}),micro};
    if(Array.isArray(sh.covers)&&sh.covers.length)
      next.covers=micro.map((_,i)=>i+1);
    return next;
  });
  return { shots, promptShots, screenplayDirectionIssues, clipDialogueByBeat, clipDialogueLines, first, cast, props:clipProps, loc, locSheet, preset, camera, cameraProfile, lighting, lead, prompt, chips, setting, panelLines, protect, beatDialogues, beatScripts, remoteCharacterIds,
    dur:_clipDur(g, maxSec), lineShots };
}

function stageRenderScopeInstruction(clipScope,clip,shots,promptShots,panelLines){
  const scopeLabel=clipScope==="shot" ? "Single shot"
    : clipScope==="legacy" ? "previous-packing clip" : "Fit beat";
  const g=clip&&clip.g||{};
  const part=Number(g.part)>0&&Number(g.parts)>1 ? " · Part "+g.part+" of "+g.parts : "";
  const list=(shots||[]).map((sh,i)=>{
    const p=(panelLines||[]).find(x=>x&&x.shotId===sh.id)||{};
    const ps=(promptShots||[]).find(x=>x&&x.id===sh.id)||sh;
    const camera=p.camera||[ps.size,ps.angle,ps.move,ps.lens].filter(Boolean).join(" · ");
    const direction=String(p.text||p.script||"").trim();
    return "Shot "+(i+1)+" (beat "+(sh.beatN||"—")+")"
      +(direction ? ": "+direction : "")
      +(camera ? " ["+camera+"]" : "");
  }).filter(Boolean);
  return [
    "SELECTED RENDER SCOPE: "+scopeLabel+part+".",
    "Perform only the selected shot unit"+(list.length===1?"":"s")+" below, in order. "
      +"The complete target beat above remains immutable reading context for continuity "
      +"and exact dialogue; do not replay omitted shot or part coverage.",
    list.length ? list.join("\n") : ""
  ].filter(Boolean).join("\n");
}

function stageClipPropDependencySignature(clipData, sceneId, context){
  if(typeof propDependencySignature!=="function") return "";
  const C=context||window.turnContinuity||{};
  return ((clipData&&clipData.shots)||[]).map(sh=>
    String(sh.id||"")+"="+propDependencySignature(C.props||[],sceneId,sh.beatN,sh.microBeatId,sh.id,C)
  ).join("||");
}
window.stageClipPropDependencySignature = stageClipPropDependencySignature;

/* beat-boundary page geometry for a scene — the SAME source of truth as the
   Storyboards tab (window.sbPageRanges); falls back to fixed 4-shot chunks when the
   geometry or the shot list isn't available. */
function stagePageRanges(sceneShots){
  if(typeof window.sbPageRanges==="function" && (sceneShots||[]).length){
    try{ return window.sbPageRanges(sceneShots); }catch(e){}
  }
  const n = (sceneShots||[]).length;
  const total = Math.max(1, Math.ceil((n||1)/4));
  const out=[]; for(let i=0;i<total;i++) out.push({ start:i*4, count:Math.min(4, Math.max(1,n-i*4)) });
  return out;
}

/* ============================ the per-clip console ============================== */
function storyboardClipIds(clip){
  const legacy = "sbsheet-sbclip-"+clip.scene.id+"-"+clip.g.index;
  const start = Number(clip && clip.g && clip.g.start) || 0;
  const count = Math.max(1, ((clip&&clip.g&&clip.g.shots)||[]).length);
  // Beat-boundary pagination (Storyboards tab): pages no longer map to fixed 4-shot
  // chunks, so the page/cell a shot lands in comes from the SAME geometry the tab used —
  // window.sbPageRanges over the scene's live shots (bridged onto window.__sbShots by
  // StageView). Falls back to the legacy fixed-4 math when the geometry isn't available.
  const sceneShots = ((window.__sbShots||[]).filter(s=>s && s.sceneId===clip.scene.id))
    .sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0));
  const ranges = stagePageRanges(sceneShots);
  const pages=[], halves=[];
  for(let n=start; n<start+count; n++){
    let pageNo = Math.floor(n/4), cell = n%4;   // legacy fallback
    if(ranges){ let acc=0;
      for(let i=0;i<ranges.length;i++){
        if(n>=acc && n<acc+ranges[i].count){ pageNo=i; cell=n-acc; break; }
        acc+=ranges[i].count; } }
    const pageId = "sbsheet-sbpage-"+clip.scene.id+"-2x2-"+pageNo;
    const half = cell < 2 ? "top" : "bottom";
    if(pages.indexOf(pageId)<0) pages.push(pageId);
    const halfId = pageId+":half-"+half;
    if(halves.indexOf(halfId)<0) halves.push(halfId);
  }
  const page = pages[0] || ("sbsheet-sbpage-"+clip.scene.id+"-2x2-"+Math.floor(start/4));
  return {
    sheet:page, pages, halves, top:halves[0]||"", bottom:halves[1]||"",
    legacySheet:legacy, legacyTop:legacy+":half-top", legacyBottom:legacy+":half-bottom",
    all:Array.from(new Set([].concat(pages, halves, [legacy, legacy+":half-top", legacy+":half-bottom"])))
  };
}
window.storyboardClipIds = storyboardClipIds;   // exported for the headless geometry tests
function storyboardClipAssets(clip, imgs){
  const ids = storyboardClipIds(clip);
  const halves = (ids.halves||[]).map(id=>({ id, url:imgs[id]||"" })).filter(h=>h.url);
  const pages = (ids.pages||[]).map(id=>({ id, url:imgs[id]||"" })).filter(p=>p.url);
  return {
    ids,
    sheet:imgs[ids.sheet]||imgs[ids.legacySheet]||"",
    pages,
    halves,
    top:imgs[ids.top]||imgs[ids.legacyTop]||"",
    bottom:imgs[ids.bottom]||imgs[ids.legacyBottom]||""
  };
}
function clipPrimaryFrame(clip, imgs, visualSource){
  const story = storyboardClipAssets(clip, imgs);
  const beatOpening=!!((clip&&clip.data&&clip.data.shots)||[]).some(stageBeatOpeningShot);
  if(beatOpening) return imgs[(clip.data.first||{}).id] || "";
  if(visualSource==="halves") return story.top || story.bottom || story.sheet || "";
  return imgs[(clip.data.first||{}).id] || "";
}

/* ---- per-clip visual-source planner. Researched behaviour: individual frames give the
   best per-shot precision and identity (full-res, first-frame anchoring) but each frame
   costs one of the 9 image slots that cast/location/prop refs also need; multi-panel
   storyboard sheets pace a continuous clip well ("animates through it panel by panel")
   but the model misses the directional logic between panels without prose, and captions/
   panel borders can bleed into the output. So the pick is per-clip, not global:
     dialogue or 1 shot  → the shot frame (lip-sync/precision beats blocking)
     2 merged shots      → the 2-panel half (clear A→B, exact 16:9, one asset slot)
     3–4 merged shots    → per-shot frames IF they fit the image budget, else the 4-panel sheet
   with availability fallbacks so a missing source degrades gracefully. ---- */
const STAGE_SOURCE_MODES = {
  frame:  { label:"shot frame",      glyph:"▢",  pick:"Shot frame" },
  frames: { label:"per-shot frames", glyph:"▢▢", pick:"Per-shot frames" },
  halves: { label:"2-panel half",    glyph:"▤",  pick:"Storyboard halves" },
  sheet:  { label:"4-panel sheet",   glyph:"▦",  pick:"Full storyboard sheet" },
};
function stageClipSourcePlan(clip, imgs){
  const d = (clip&&clip.data)||{};
  const shots = d.shots||[];
  /* A beat-opening keyframe is the sole visual start state. Storyboard sheets and
     halves are legacy multi-shot sources and must not turn one screenplay beat into
     a panel montage. */
  if(shots.some(stageBeatOpeningShot)){
    const frameReady=!!imgs[(d.first||{}).id];
    return {mode:"frame",ready:frameReady,hasHalves:false,hasSheet:false,frameReady,framesReady:frameReady,
      ...STAGE_SOURCE_MODES.frame,beatOpening:true};
  }
  const story = storyboardClipAssets(clip, imgs);
  const hasHalves = !!((story.halves||[]).length || story.top || story.bottom);
  const hasSheet = !!story.sheet;
  const frameReady = !!imgs[(d.first||{}).id];
  const framesReady = shots.length>0 && shots.every(sh=>!!imgs[sh.id]);
  const refSlots = (d.cast||[]).length + (d.loc?1:0) + (d.props||[]).length;
  let mode;
  const hasLines = !!(d.lineShots||[]).length;
  if(shots.length<=1) mode = "frame";
  // dialogue clips avoid panel sources (lip-sync wants clean frame anchors), but a
  // small merged clip still gets per-shot frames when they exist and fit the budget —
  // full-res anchors per shot beat a single frame for the non-speaking beats.
  else if(hasLines) mode = (framesReady && (shots.length+refSlots)<=9) ? "frames" : "frame";
  else if(shots.length===2) mode = hasHalves ? "halves" : (framesReady ? "frames" : (hasSheet ? "sheet" : "frames"));
  else mode = (framesReady && (shots.length+refSlots)<=9) ? "frames"
    : hasSheet ? "sheet" : hasHalves ? "halves" : "frames";
  if(mode==="frames" && shots.length<=1) mode = "frame";
  // frames mode needs EVERY shot's frame — checking only the first green-lit clips
  // whose later shots had no anchor at all
  const ready = mode==="halves" ? hasHalves : mode==="sheet" ? hasSheet : mode==="frames" ? framesReady : frameReady;
  return { mode, ready, hasHalves, hasSheet, frameReady, framesReady,
    ...(STAGE_SOURCE_MODES[mode]||STAGE_SOURCE_MODES.frame) };
}

/* the recipe that best matches a clip's shape + visual source — the DEFAULT, not a
   lock: a SINGLE-shot dialogue moment wants the @Audio-anchored lip-sync phrasing;
   a MULTI-shot clip wants structure (per-panel narration for storyboard sources,
   time-coded windows otherwise — both carry per-line speaker + @AudioN tags now,
   so dialogue attribution survives either way); a single silent frame reads best
   as prose. */
function stageSmartRecipe(clip, sourceMode, modelId){
  const d = (clip&&clip.data)||{};
  const shotsN = ((d.shots||[]).length);
  if((d.lineShots||[]).length && shotsN<=1) return "lipsync";
  if(sourceMode==="halves" || sourceMode==="sheet") return "panels";
  if(shotsN>=2) return "timeline";
  return "narrative";
}

/* ---- Seedance 2.0 prompt RECIPES — named ways to phrase the SAME clip for the model.
   Each rebuilds the (still hand-editable) prompt from the clip's beats. Researched from
   how Seedance 2.0 responds best: a flowing paragraph (Narrative), a per-panel beat board
   with dialogue durations + anti-hallucination rules (Panel-by-panel), labelled control
   fields (Structured), and an audio-anchored lip-sync phrasing (Dialogue). ---- */
const SEEDANCE_RECIPES = [
  ["narrative",  "Narrative",        "One flowing paragraph — the default."],
  ["panels",     "Panel-by-panel",   "Explicit SHOT 1 / SHOT 2 cut points tied to the screenplay, storyboard panel, camera, motion and dialogue."],
  ["timeline",   "Timeline",         "Time-coded windows (0–4s, 4–9s…) scripted from each shot's measured runtime — paces motion across the clip."],
  ["structured", "Structured",       "Labelled fields: Subject / Action / Setting / Camera / Lighting / Style."],
  ["lipsync",    "Dialogue / lip-sync","Phrased around the spoken lines — each speaker paired with their own audio reference for accurate lip-sync."],
];

/* ---- model/tier registry — the single source of truth the model picker renders from.
   Adding a future model (Seedance 2.5, a third provider, etc.) is one entry here; the
   UI below just maps over this list, so it never needs a second edit. "soon" entries
   render disabled with their note as a tooltip. Standard/Fast tiers researched against
   fal.ai's live Seedance 2.0 API + this app's own docs/Voice & Lip-Sync (Seedance) Plan.md. ---- */
const SEEDANCE_MODELS = [
  // maxShotsPerClip drives the CLIP PACKER (sceneSequences): 3 keeps per-shot frames +
  // identity refs inside 2.0's 9-image budget; 0 = no shot-count cap (time still caps).
  // creditRate = generation credits PER SECOND at each resolution (cost = ceil(seconds ×
  // rate), min 1). Scaled off fal's real per-second pricing so the relative cost of every
  // tier/resolution choice is honest: 1 credit ≈ 1s of 720p Standard (~$0.30 of fal spend).
  // metaRes/metaDur render as small badge chips on each dropdown option;
  // capabilities feed the panel's model card, so the card follows the selection.
  { id:"seedance-2.0", label:"Seedance 2.0", status:"active", maxShotsPerClip:3,
    metaRes:"4K", metaDur:"4–15s",
    // researched prompting guidance (fal + community prompt guides, 2026-08) —
    // bestFor rides the dropdown option, promptFormula the menu footer
    bestFor:"Reference-driven shots — @-mention frames, clips & voices (up to 12); strong lip-sync and character consistency.",
    promptFormula:"subject → action → camera move (dolly, orbit, pan, push-in — it knows the vocabulary) → specific lighting → sound. Camera and subject motion in SEPARATE clauses; @-mention assets instead of re-describing them; timeline blocks pace each beat.",
    capabilities:["Multimodal video generation","Up to 12 assets combined","Up to 4K output (Standard tier)","Start→end frame transitions","Typical clip length 4–15s","Strong motion stability","Character consistency","Native audio","Director controls"],
    tiers:[
      // Rates come from app/pricing.jsx as provider USD/sec converted into base
      // credits/sec. The final visible-denomination cost is computed below.
      { id:"standard", label:"Standard", fast:false, maxRes:"4K", note:"Best quality and motion consistency · resolution up to 4K",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.0","standard")) || { "480p":0.5, "720p":1, "1080p":2, "4K":5 } },
      { id:"fast",     label:"Fast",     fast:true,  maxRes:"720p",  note:"Lower latency and cost for iteration · capped at 720p",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.0","fast")) || { "480p":0.4, "720p":0.8 } },
    ] },
  // (Sora 2 was removed from the picker 2026-07-05 by user decision — its proxy
  // routing and videogen isSora branch remain dormant, so re-adding it later is
  // just restoring a registry entry here.)
  // Seedance 2.5 — LIVE on fal: bytedance/seedance-2.5/reference-to-video.
  // Current endpoint supports up to 50 multimodal refs, 4–30s and 1080p output.
  // default on, @-mention reference grammar, and NO fast endpoint exists. The whole app
  // was pre-wired for the 30s ceiling: maxClipSec:30 feeds the caphead / tick guard /
  // duration options / measured-seconds floor; caps lift (maxShotsPerClip:0,
  // maxDialoguePerClip:0); videogen clamps at 30s and polls ~20 min; the proxy
  // allowlists the endpoint and caps its resolution ladder at 720p.
  { id:"seedance-2.5", label:"Seedance 2.5", status:"active", maxShotsPerClip:0, maxDialoguePerClip:0,
    maxClipSec:30, maxAssets:50,
    metaRes:"1080p", metaDur:"4–30s",
    bestFor:"Beat-first sequences — up to 30s with 50 multimodal references and a timed shot plan.",
    promptFormula:"one dramatic beat per render, with timed shot windows, exact covered micro-beats and exact selected dialogue.",
    capabilities:["Beat-first 30s clips","Up to 50 multimodal references","Timed shot sequences","Native audio","Strong character consistency","Output up to 1080p"],
    tiers:[
      // fal lists ONE endpoint (no fast tier) at 480p/720p only — rates in
      // app/pricing.jsx are the real fal per-second prices (2026-08-07).
      { id:"standard", label:"Standard", fast:false, maxRes:"1080p", falModel:"bytedance/seedance-2.5/reference-to-video",
        note:"Beat-first clips up to 30s · up to 50 references · resolution up to 1080p",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.5","standard")) || { "480p":0.75, "720p":1.6, "1080p":2.4 } },
    ],
    note:"Primary beat-first model: timed 4–30s clips, up to 50 references and output through 1080p. Keep Seedance 2.0 Standard for Fast iterations and 4K masters." },
];
function seedanceModelOf(id){ return SEEDANCE_MODELS.find(m=>m.id===id) || SEEDANCE_MODELS[0]; }
function seedanceTierOf(model, tierId){ return (model&&model.tiers||[]).find(t=>t.id===tierId) || (model&&model.tiers||[])[0] || null; }
/* resolution ladder — gates each tier's ceiling (Fast caps at 720p; Standard reaches 4K) */
const STAGE_RESOLUTIONS = ["480p","720p","1080p","4K"];
function stageResRank(r){ const i = STAGE_RESOLUTIONS.indexOf(String(r||"")); return i<0 ? 1 : i; }
function stageResAllowed(tierObj, r){ return stageResRank(r) <= stageResRank((tierObj&&tierObj.maxRes)||"1080p"); }
function stageServerResolutionAllowed(modelId,r,runtime,endpoint){
  const staticCaps=typeof window.seedanceCapabilities==="function"
    ? window.seedanceCapabilities(endpoint||modelId) : null;
  if(staticCaps&&Array.isArray(staticCaps.resolutions)&&staticCaps.resolutions.indexOf(r)<0) return false;
  if(modelId!=="seedance-2.5"||r!=="1080p") return true;
  // 1080p requires the updated proxy. Stay safely on 720p until the read-only
  // runtime handshake explicitly advertises it.
  const caps=runtime&&runtime.known&&runtime.capabilities;
  return !!(caps&&Array.isArray(caps.resolutions)&&caps.resolutions.indexOf("1080p")>=0);
}
window.stageServerResolutionAllowed=stageServerResolutionAllowed;

/* this render's credit cost from the registry rates: seconds × tier/resolution rate,
   rounded up, never below 1. Every cost-bearing setting (model tier, resolution,
   duration) flows through here so the Generate button always shows the true price. */
function stageRenderCost(tierObj, resolution, durationSec){
  const rate = Number(tierObj && tierObj.creditRate && tierObj.creditRate[resolution]);
  const r = rate>0 ? rate : 1;
  const s = Math.max(1, Number(durationSec)||5);
  // credits are denominated ×CREDIT_SCALE so plan allowances read generously (800 not
  // 80) — grant AND cost scale together, so real value is unchanged. Round after
  // scaling so lower-cost models/resolutions don't over-round to a whole base credit.
  const scale = Number(window.CREDIT_SCALE)||1;
  return Math.max(1, Math.ceil(s*r*scale));
}
window.SEEDANCE_MODELS = SEEDANCE_MODELS;
/* tier creditRates are COPIES of the pricing table (turnVideoCreditRates builds a
   new object), so an admin-applied pricing override would leave them stale —
   refresh them in place whenever the table changes. */
window.addEventListener("turn-pricing-changed", ()=>{
  SEEDANCE_MODELS.forEach(m=> (m.tiers||[]).forEach(t=>{
    const r = (typeof window.turnVideoCreditRates==="function") && window.turnVideoCreditRates(m.id, t.id);
    if(r) t.creditRate = r;
  }));
});
/* per-shot seconds interval grid for the Multi-shot composer (bounded per model —
   the stepper filters anything past the model's cap, so the 20s/30s rungs only ever
   surface on Seedance 2.5-class models) */
window.STAGE_MS_STEPS = [4, 8, 12, 15, 20, 30];

/* ---- camera vocabulary Seedance 2.0 is tuned to recognise (fal.ai prompting guide:
   "Subject + Action + Camera + Scene/Lighting + Style", named cinematographer terms). ---- */
const SEEDANCE_CAMERA_MOVES = [
  "Slow push in", "Push in", "Pull back", "Dolly zoom", "Rack focus", "Tracking shot",
  "Handheld drift", "POV switch", "Aerial shot", "Orbit", "Whip pan", "Tilt up", "Crane up",
  "Locked-off tableau",
];
const STAGE_PROMPT_SCHEMA = "seedance-scene-screenplay-v6";
function _seedanceVoiceSec(sh, textOverride){
  const ms = sh && sh.lineAudio && sh.lineAudio.durationMs;
  if(ms) return Math.round(ms/100)/10;                                  // measured audio
  const w = String(textOverride!=null ? textOverride : ((sh&&sh.dialogue)||"")).trim().split(/\s+/).filter(Boolean).length;
  return w ? Math.max(1, Math.round(w/2.4)) : 0;                        // estimate from word count
}
function _seedanceShotGrammar(sh){
  if(typeof shotGrammarLabel==="function") return shotGrammarLabel(sh);
  const size = (typeof shotSizeOf==="function") ? shotSizeOf(sh&&sh.size).label : (sh&&sh.size);
  const angle = (typeof shotAngleOf==="function") ? shotAngleOf(sh&&sh.angle).label : (sh&&sh.angle);
  const move = (typeof shotMoveOf==="function") ? shotMoveOf(sh&&sh.move).label : (sh&&sh.move);
  const lens = (typeof shotLensOf==="function") ? shotLensOf(sh&&sh.lens).label : (sh&&sh.lens);
  return [size, angle, move, lens].filter(Boolean).join(" · ");
}
function _stageAgo(ts){
  if(!ts) return "";
  const s = Math.max(0, (Date.now()-Number(ts))/1000);
  if(s<60) return "just now";
  if(s<3600) return Math.round(s/60)+"m ago";
  if(s<86400) return Math.round(s/3600)+"h ago";
  return Math.round(s/86400)+"d ago";
}
// short + long names for a take's visual source (meta.source) in version labels
const STAGE_SOURCE_SHORT = { frame:"frame", frames:"frames", halves:"halves", sheet:"sheet" };
function _stageTakeVno(t, list, i){
  const v = t && t.meta && t.meta.vno;
  return v ? ("v"+v) : ("v"+((list?list.length:0)-i));   // legacy takes (pre-vno) fall back to position
}
function stageVideoRefSafe(meta){
  if(!meta) return false;
  const res = String(meta.resolution||"").toLowerCase();
  if(res && res!=="480p" && res!=="720p") return false;
  const sec = Number(meta.durationSec || (meta.durationMs ? meta.durationMs/1000 : 0));
  return !sec || (sec>=2 && sec<=15);
}
/* @AudioN numbering follows the clip's lineShots order — the same order the audio
   assets are pushed into the composer (and the REFERENCES block) at render. */
function stageLineAudioIndex(d, shotId){
  if(d && d.audioRefsOn===false) return 0;   // native performance: no audio refs → no @Audio tags
  let list = ((d&&d.lineShots)||[]);
  // when the console tells us which lines actually attach (user deselections), number
  // within THAT order — a dropped line must not shift the tags off their files
  if(d && Array.isArray(d.audioIncluded)) list = list.filter(sh=>sh && d.audioIncluded.indexOf(sh.id)>=0);
  const i = list.findIndex(sh=>sh&&sh.id===shotId);
  return i>=0 ? i+1 : 0;
}
/* the SCREENPLAY words, quoted. Micro-beat canon PARAPHRASES the moment ("Yusuf
   offers his polite greeting into the mirror") — a motion prompt that never quotes
   the line itself leaves the model to improvise dialogue the film never wrote, and
   hides from the director what the render will actually say. In locked-voice renders
   the words still ride alongside the @Audio tag: the audio pins the performance,
   the words steer the tone. */
function _stagePromptEntityToken(refs, kind, item){
  if(!refs) return "";
  if(kind==="character" && typeof refs.character==="function") return refs.character(item);
  if(kind==="speaker" && typeof refs.speaker==="function") return refs.speaker(item);
  if(kind==="prop" && typeof refs.prop==="function") return refs.prop(item);
  if(kind==="setting" && typeof refs.setting==="function") return refs.setting(item);
  if(kind==="audio" && typeof refs.audioForShot==="function") return refs.audioForShot(item);
  return "";
}
function _stagePromptEntityLabel(refs, kind, item, fallback){
  return _stagePromptEntityToken(refs, kind, item) || String(fallback||"").trim();
}
function _seedanceDialogueClause(sh, p, d, refs){
  const rows=Array.isArray(p&&p.dialogueLines)&&p.dialogueLines.length
    ? p.dialogueLines : null;
  if(rows){
    const aIdx = (typeof stageLineAudioIndex==="function") ? stageLineAudioIndex(d, sh.id) : 0;
    return rows.map((row,i)=>{
      const dialogue=String(row&&row.text||"").trim().replace(/^["“]|["”]$/g,"");
      if(!dialogue)return "";
      const speakerName=(row&&row.speaker)||(p&&p.speaker&&p.speaker.name)
        ||(sh&&sh.lineAudio&&sh.lineAudio.speaker)||"the speaker";
      const speaker=_stagePromptEntityLabel(refs,"speaker",speakerName,speakerName);
      const paren=String((row&&row.parenthetical)||p&&p.dialogueParenthetical||"").trim();
      return speaker+" says \""+dialogue+"\""+(paren?(" ("+paren+")"):"")
        +(aIdx&&i===0?(" (lip-sync @Audio"+aIdx+")"):"");
    }).filter(Boolean).join("; ");
  }
  const dialogue = String((p&&p.dialogue) || (sh&&sh.dialogue) || (sh&&sh.lineAudio&&sh.lineAudio.text) || "").trim().replace(/^["“]|["”]$/g,"");
  if(!dialogue) return "";
  const speakerName = (p&&p.speaker&&p.speaker.name) || (sh&&sh.lineAudio&&sh.lineAudio.speaker) || "the speaker";
  const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
  const aIdx = (typeof stageLineAudioIndex==="function") ? stageLineAudioIndex(d, sh.id) : 0;
  const paren = String((p&&p.dialogueParenthetical)||"").trim();
  return speaker+" says \""+dialogue+"\""+(paren?(" ("+paren+")"):"")+(aIdx?(" (lip-sync @Audio"+aIdx+")"):"");
}
function _seedanceMicroLines(d, shots){
  const panelLines = d && d.panelLines || [];
  const list = shots && shots.length ? shots : ((d&&d.shots)||[]);
  return (list||[]).map((sh,i)=>{
    const p = panelLines.find(x=>x&&x.shotId===(sh&&sh.id)) || panelLines[i] || {};
    const micro = Array.isArray(p.micro) ? p.micro.filter(Boolean) : [];
    const text = micro.length
      ? micro.map((m,j)=>(j+1)+") "+String(m||"").replace(/[\s.;]+$/,"")).join("; ")
      : String(p.text||sh&&sh.action||"").trim();
    return { sh, p, text };
  }).filter(x=>String(x.text||"").trim());
}
function _seedanceMicroPlan(d, shots){
  const rows = _seedanceMicroLines(d, shots);
  if(!rows.length) return "";
  return "Micro-beat action plan:\n"+rows.map((r,i)=>"SHOT "+(i+1)+" / Beat "+((r.sh&&r.sh.beatN)||"—")+": "+r.text+".").join("\n");
}
function _seedanceClipDialogueClause(d, refs){
  const rows=Array.isArray(d&&d.clipDialogueLines) ? d.clipDialogueLines : [];
  return rows.map(row=>{
    const text=String(row&&row.text||"").trim().replace(/^["“]|["”]$/g,"");
    if(!text)return "";
    const name=(row&&row.speaker)||"the speaker";
    const speaker=_stagePromptEntityLabel(refs,"speaker",name,name);
    return speaker+" says \""+text+"\"";
  }).filter(Boolean).join("; ");
}
function _seedanceBeatMicroText(d, shots, activeShot){
  const beatN = activeShot && activeShot.beatN;
  const planShot = (activeShot && activeShot.beatPlan && Array.isArray(activeShot.beatPlan.micro) && activeShot.beatPlan.micro.length)
    ? activeShot
    : ((shots||[]).find(sh=>sh && sh.beatN===beatN && sh.beatPlan && Array.isArray(sh.beatPlan.micro) && sh.beatPlan.micro.length)
      || (shots||[]).find(sh=>sh && sh.beatPlan && Array.isArray(sh.beatPlan.micro) && sh.beatPlan.micro.length));
  const micro = (planShot && planShot.beatPlan && Array.isArray(planShot.beatPlan.micro)) ? planShot.beatPlan.micro : [];
  if(micro.length){
    const items = micro.map(m=>String(m||"").replace(/[\s.;]+$/,"")).filter(Boolean);
    return {
    beatN:(planShot&&planShot.beatN)||beatN,
    items,
    text:items.map((m,i)=>(i+1)+") "+m).join("; "),
    protect:String((planShot.beatPlan&&planShot.beatPlan.protect)||"").trim()
    };
  }
  const rows = _seedanceMicroLines(d, shots);
  if(!rows.length) return { beatN, text:"", protect:"" };
  const items = rows.map(r=>String(r.text||"").replace(/[\s.;]+$/,"")).filter(Boolean);
  return { beatN, items, text:items.map((r,i)=>(i+1)+") "+r).join("; "), protect:"" };
}
function _seedanceDialogueLinesForBeat(d, beatN){
  const fromBeat = d && d.beatDialogues && Array.isArray(d.beatDialogues[beatN]) ? d.beatDialogues[beatN] : [];
  if(fromBeat.length) return fromBeat;
  return ((d&&d.panelLines)||[]).filter(p=>String(p&&p.dialogue||"").trim()).map(p=>({
    speaker:(p.speaker&&p.speaker.name)||"the speaker",
    parenthetical:p.dialogueParenthetical||"",
    text:p.dialogue
  }));
}
function seedanceMicroBeatDirectorPrompt(clip, shots, activeShot, audioRefsOn, audioIncluded, refs){
  const d = (clip&&clip.data) || {};
  const cast = (d.cast||[]).map(c=>_stagePromptEntityLabel(refs, "character", c, c.name)).filter(Boolean);
  const props = (d.props||[]).map(p=>_stagePromptEntityLabel(refs, "prop", p, p.name)).filter(Boolean);
  const setting = d.setting || (clip&&clip.scene&&clip.scene.loc) || "";
  const settingRef = _stagePromptEntityLabel(refs, "setting", d.loc || setting, setting);
  const style = d.preset ? (d.preset.name+" — "+d.preset.grade) : "";
  const beat = _seedanceBeatMicroText(d, shots, activeShot);
  const beatN = beat.beatN || (activeShot&&activeShot.beatN) || (((shots||[])[0]||{}).beatN);
  const beatDialogue = _seedanceDialogueLinesForBeat(d, beatN);
  const panelLines = d.panelLines || [];
  const audioShotIds = Array.isArray(audioIncluded) ? audioIncluded : [];
  const audioLine = (ln)=>{
    const p = panelLines.find(x=>_normStageText(x&&x.dialogue)===_normStageText(ln&&ln.text)) || {};
    const aIdx = audioRefsOn===false ? 0 : (p.shotId ? stageLineAudioIndex({ ...d, audioIncluded:audioShotIds }, p.shotId) : 0);
    const par = String(ln&&ln.parenthetical||"").trim();
    const speakerName = ln.speaker || "the speaker";
    const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
    return speaker+" says \""+String(ln.text||"").replace(/^["“]|["”]$/g,"")+"\""
      +(par?(" ("+par+")"):"")+(aIdx?(" — lip-sync to @Audio"+aIdx):"");
  };
  const cameraRows = _uniq((shots||[]).map(sh=>_seedanceShotGrammar(sh)).filter(Boolean));
  const beatAction = (beat.items&&beat.items.length)
    ? "Action: Animate Beat "+(beatN||"")+" as one continuous moment, following these micro-beats in exact order:\n"
      + beat.items.map((m,i)=>(i+1)+") "+m+";").join("\n")
    : (beat.text && ("Action: Animate Beat "+(beatN||"")+" as one continuous moment, following these micro-beats in exact order:\n"+beat.text+"."));
  const rows = [
    cast.length && ("Subject: "+cast.join(", ")+"."),
    settingRef && ("Setting: "+settingRef+"."),
    beatAction,
    beat.protect && ("Protected dramatic core: "+beat.protect+"."),
    beatDialogue.length && ("Dialogue from screenplay: "+beatDialogue.map(audioLine).join("; ")+"."),
    cameraRows.length && ("Camera: "+cameraRows.join(" → ")+". Keep camera movement motivated and separate from subject movement."),
    props.length && ("Continuity props: "+props.join(", ")+". Keep them present unless the micro-beats explicitly remove them."),
    style && ("Look: "+style+"."),
    d.lighting && ("Lighting: "+d.lighting+"."),
    "Performance: grounded, cinematic, subtle physical business; let looks and pauses breathe between actions.",
    "Continuity: use the selected visual source and references for identity, wardrobe, location geometry, prop design and blocking. Do not add extra story beats, new characters, new props, captions, subtitles, panel borders or burned-in text."
  ].filter(Boolean);
  return rows.join("\n");
}
/* Dormant legacy whole-scene recipe retained only to display/reproduce old takes. It
   its interior follows screenplay chronology rather than flattening a scene into a
   shot list. Each BEAT section carries the canonical Art Room micro-plan, screenplay
   texture, exact speech/audio placement, camera progression and its causal handoff. */
function seedanceWholeSceneDirectorPrompt(clip, audioRefsOn, audioIncluded, refs, opts){
  const d=(clip&&clip.data)||{}, shots=d.shots||[], panels=d.panelLines||[];
  const nums=_uniq(shots.map(s=>s&&s.beatN).filter(Boolean));
  const included=Array.isArray(audioIncluded)?audioIncluded:[];
  opts=opts||{};
  const directAudioCap=Math.max(0,Number.isFinite(Number(opts.directAudioCap))?Number(opts.directAudioCap):10);
  const videoRefBase=Math.max(0,Number(opts.videoRefBase)||0);
  const videoRefCap=Math.max(0,Number(opts.videoRefCap)||3);
  const entity=(kind,x,fallback)=>_stagePromptEntityLabel(refs,kind,x,fallback);
  const sections=nums.map((n,bi)=>{
    const bs=shots.filter(s=>Number(s.beatN)===Number(n));
    const bp=panels.filter(p=>Number(p.beatN)===Number(n));
    const planShot=bs.find(s=>s&&s.beatPlan&&Array.isArray(s.beatPlan.micro)&&s.beatPlan.micro.length);
    const micro=planShot ? planShot.beatPlan.micro.map(x=>String(x||"").replace(/[\s.;]+$/,"")).filter(Boolean)
      : _uniq(bp.flatMap(p=>Array.isArray(p.micro)?p.micro:[]).map(x=>String(x||"").replace(/[\s.;]+$/,"")).filter(Boolean));
    const texture=_uniq(bp.map(p=>String(p.script||"").trim()).filter(Boolean));
    const dialogue=bp.filter(p=>String(p.dialogue||"").trim()).map(p=>{
      const name=(p.speaker&&p.speaker.name)||"the speaker";
      const who=entity("speaker",name,name);
      const idx=audioRefsOn===false?0:stageLineAudioIndex({ ...d,audioIncluded:included },p.shotId);
      const carrierIdx=idx>directAudioCap ? videoRefBase+(idx-directAudioCap) : 0;
      const audioToken=idx && idx<=directAudioCap ? ("@Audio"+idx)
        : (carrierIdx>0 && carrierIdx<=videoRefCap ? ("@Video"+carrierIdx+" voice carrier") : "");
      const par=String(p.dialogueParenthetical||"").trim();
      return who+' delivers "'+String(p.dialogue).replace(/^["“]|["”]$/g,"")+'"'
        +(par?" ("+par+")":"")+(audioToken?" in "+audioToken:" in a natural in-character voice");
    });
    const cameras=_uniq(bs.map(_seedanceShotGrammar).filter(Boolean));
    const protect=String((planShot&&planShot.beatPlan&&planShot.beatPlan.protect)||"").trim();
    const next=nums[bi+1];
    const transition=next
      ? "Transition: let the final reaction/action causally trigger BEAT "+next+"; preserve screen direction, identity, wardrobe, props and location geography."
      : "Ending: finish the dramatic result, then HOLD the final composition and the subject's stillness long enough to read; no new action, cutaway or reset.";
    return [
      "BEAT "+n,
      micro.length&&("Micro-beats: "+micro.map((m,i)=>(i+1)+") "+m).join("; ")+"."),
      texture.length&&("Screenplay texture: "+texture.join(" ")),
      dialogue.length&&("Dialogue/audio: "+dialogue.join("; ")+"."),
      cameras.length&&("Camera progression: "+cameras.join(" → ")+"."),
      protect&&("Protect: "+protect+"."),
      transition
    ].filter(Boolean).join("\n");
  });
  const cast=(d.cast||[]).map(c=>entity("character",c,c.name)).filter(Boolean);
  const props=(d.props||[]).map(p=>entity("prop",p,p.name)).filter(Boolean);
  const setting=entity("setting",d.loc||d.setting,d.setting||((clip&&clip.scene&&clip.scene.loc)||""));
  const clipDialogue=_seedanceClipDialogueClause(d,refs);
  return [
    "ONE CONTINUOUS SCENE — perform these dramatic sections in exact order. Do not merge, reorder, skip or invent beats.",
    cast.length&&("Cast: "+cast.join(", ")+"."),
    setting&&("Setting: "+setting+"."),
    props.length&&("Continuity props: "+props.join(", ")+"."),
    sections.join("\n\n"),
    clipDialogue&&("CLIP-LEVEL ORDERED DIALOGUE (not assigned to a shot; perform these lines once in this order): "+clipDialogue+"."),
    d.lighting&&("Lighting: "+d.lighting+"."),
    d.preset&&("Look: "+d.preset.name+" — "+d.preset.grade+"."),
    "Performance: grounded and subtle; preserve breathing room for looks, pauses and reactions. Keep camera motion motivated and separate from subject motion.",
    "Continuity: references lock identity, wardrobe, location geometry, prop design and blocking. No extra characters, props, story events, subtitles, captions, panel borders or burned-in text."
  ].filter(Boolean).join("\n");
}
window.seedanceWholeSceneDirectorPrompt=seedanceWholeSceneDirectorPrompt;
/* Seedance 2.5 WHOLE-BEAT recipe (user direction 2026-09-02): a 2.5 clip is ONE
   BEAT, shot as a SEQUENCE OF SHOTS — the continuation of the Art Room's shot
   design, where every beat carries a micro-beat plan and its shots cover that
   plan. Each SHOT unit gets its own camera grammar, its own micro-beats and its
   exact dialogue/audio placement, joined by hard cuts ("Cut to:" — the 2.5
   guide's shot-stacking grammar); the beat closes on a held composition. */
function seedanceBeatSequenceDirectorPrompt(clip, shots, audioRefsOn, audioIncluded, refs, opts){
  const d=(clip&&clip.data)||{}, panels=d.panelLines||[];
  const list=(shots&&shots.length?shots:(d.shots||[]));
  const included=Array.isArray(audioIncluded)?audioIncluded:[];
  opts=opts||{};
  const directAudioCap=Math.max(0,Number.isFinite(Number(opts.directAudioCap))?Number(opts.directAudioCap):10);
  const videoRefBase=Math.max(0,Number(opts.videoRefBase)||0);
  const videoRefCap=Math.max(0,Number(opts.videoRefCap)||3);
  const entity=(kind,x,fallback)=>_stagePromptEntityLabel(refs,kind,x,fallback);
  const beatN=(list[0]&&list[0].beatN)||((panels[0]||{}).beatN)||"";
  const planShot=list.find(s=>s&&s.beatPlan&&Array.isArray(s.beatPlan.micro)&&s.beatPlan.micro.length);
  const protect=String((planShot&&planShot.beatPlan&&planShot.beatPlan.protect)||"").trim();
  const units=list.map((sh,i)=>{
    const p=panels.find(x=>x&&x.shotId===sh.id)||{};
    const grammar=_seedanceShotGrammar(sh);
    const micro=(Array.isArray(p.micro)?p.micro:[]).map(x=>String(x||"").replace(/[\s.;]+$/,"")).filter(Boolean);
    const action=micro.length
      ? ("Micro-beats in exact order: "+micro.map((m,j)=>(j+1)+") "+m).join("; ")+".")
      : ("Action: "+String(p.text||sh.action||"").trim());
    const dlg=Array.isArray(p&&p.dialogueLines)&&p.dialogueLines.length
      ? p.dialogueLines.map(line=>String(line&&line.text||"").trim()).filter(Boolean).join(" ")
      : String((p&&p.dialogue)||sh.dialogue||"").trim().replace(/^["“]|["”]$/g,"");
    let dialogue="";
    if(dlg){
      const name=(p.speaker&&p.speaker.name)||"the speaker";
      const who=entity("speaker",name,name);
      const idx=audioRefsOn===false?0:stageLineAudioIndex({ ...d,audioIncluded:included },sh.id);
      const carrierIdx=idx>directAudioCap ? videoRefBase+(idx-directAudioCap) : 0;
      const audioToken=idx&&idx<=directAudioCap?("@Audio"+idx)
        :(carrierIdx>0&&carrierIdx<=videoRefCap?("@Video"+carrierIdx+" voice carrier"):"");
      const par=String(p.dialogueParenthetical||"").trim();
      dialogue="Dialogue/audio: "+who+' delivers "'+dlg+'"'+(par?" ("+par+")":"")
        +(audioToken?(" — lip-sync to "+audioToken+"."):" in a natural in-character voice.");
    }
    return [
      "SHOT "+(i+1)+(grammar?(" — "+grammar):""),
      action,
      dialogue,
      (i<list.length-1)&&"Cut to:"
    ].filter(Boolean).join("\n");
  });
  const cast=(d.cast||[]).map(c=>entity("character",c,c.name)).filter(Boolean);
  const propRefs=(d.props||[]).map(p=>entity("prop",p,p.name)).filter(Boolean);
  const setting=entity("setting",d.loc||d.setting,d.setting||((clip&&clip.scene&&clip.scene.loc)||""));
  const clipDialogue=_seedanceClipDialogueClause(d,refs);
  return [
    "ONE CLIP — BEAT "+beatN+" shot as a SEQUENCE OF SHOTS in exact order. Hard cut between shots; do not merge, reorder, skip or invent shots, and let each shot's last action cause the next shot's first.",
    cast.length&&("Cast: "+cast.join(", ")+"."),
    setting&&("Setting: "+setting+"."),
    propRefs.length&&("Continuity props: "+propRefs.join(", ")+"."),
    units.join("\n"),
    clipDialogue&&("CLIP-LEVEL ORDERED DIALOGUE (not assigned to a shot; perform these lines once in this order): "+clipDialogue+"."),
    protect&&("Protect the dramatic core: "+protect+"."),
    "Ending: finish the final shot's dramatic result, then HOLD the last composition long enough to read; no new action, cutaway or reset.",
    d.lighting&&("Lighting: "+d.lighting+"."),
    d.preset&&("Look: "+d.preset.name+" — "+d.preset.grade+"."),
    "Performance: grounded and subtle; leave breathing room for looks, pauses and reactions. Keep camera motion motivated and separate from subject motion.",
    "Continuity: references lock identity, wardrobe, location geometry, prop design and blocking across every shot. No extra characters, props, story events, subtitles, captions, panel borders or burned-in text."
  ].filter(Boolean).join("\n");
}
window.seedanceBeatSequenceDirectorPrompt=seedanceBeatSequenceDirectorPrompt;
function _seedancePanelText(sh, p, i, clip, refs){
  const label = p.sheetPage ? ("Sheet "+p.sheetPage+" Panel "+p.sheetPanel) : ("Panel "+(((clip.scene&&clip.scene.no)||1)+"."+(i+1)));
  const grammar = _seedanceShotGrammar(sh);
  const micro = Array.isArray(p.micro) ? p.micro.filter(Boolean) : [];
  const script = String(p.script||"").trim();
  const blocking = String(p.sheet||sh.action||"").trim();
  const speakerName = (p.speaker&&p.speaker.name) || "the speaker";
  const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
  const dialogue = String((p&&p.dialogue) || (sh&&sh.dialogue)||"").trim().replace(/^["“]|["”]$/g,"");
  const dur = dialogue ? _seedanceVoiceSec(sh, dialogue) : 0;
  return [
    "SHOT "+(i+1)+" — "+label+" · Beat "+(sh.beatN||"—"),
    grammar && ("Camera: "+grammar+"."),
    micro.length && ("Micro-beats to animate: "+micro.map((m,j)=>(j+1)+") "+m.replace(/[\s.;]+$/,"")).join("; ")+"."),
    script && ("Script intent: "+script),
    blocking && (!script || _normStageText(blocking)!==_normStageText(script)) && ("Storyboard blocking: "+blocking),
    dialogue && (()=>{ const aIdx = stageLineAudioIndex(clip&&clip.data, sh.id);
      return "Dialogue/audio: "+speaker+" says \""+dialogue+"\""+(dur?(" (~"+dur+"s)"):"")+"."
        + (aIdx?(" Lip-sync "+speaker+" to @Audio"+aIdx+"."):" Sync to the matching audio reference if included."); })(),
    "Motion: animate only this beat's physical change; keep it continuous from the prior shot unit and ready for the next."
  ].filter(Boolean).join("\n");
}
function seedancePrompt(recipe, clip, refs){
  const d = (clip&&clip.data) || {}, shots = d.shots || [];
  const cast = (d.cast||[]).map(c=>_stagePromptEntityLabel(refs, "character", c, c.name));
  const props = (d.props||[]).map(p=>_stagePromptEntityLabel(refs, "prop", p, p.name));
  const setting = d.setting || "";
  const settingRef = _stagePromptEntityLabel(refs, "setting", d.loc || setting, setting);
  const style = d.preset ? (d.preset.name+" — "+d.preset.grade) : "";
  const lead = d.lead || (cast[0] || "the subject");
  const panelLines = d.panelLines || [];
  const actionLines = _uniq((panelLines.length ? panelLines.map(p=>p.text) : shots.map(s=>String(s.action||"").trim())).filter(Boolean));
  const dialogueSpeakers = _uniq(panelLines.filter(p=>p&&p.speaker&&p.speaker.name).map(p=>p.speaker.name));
  const voiceLead = dialogueSpeakers[0] || lead;
  if(recipe==="structured"){
    const dlgLines = shots.map((sh,i)=>_seedanceDialogueClause(sh, panelLines[i]||{}, d, refs)).filter(Boolean);
    const clipDialogue=_seedanceClipDialogueClause(d,refs);
    return [
      cast.length && ("Subject: "+cast.join(", ")+"."),
      "Action: "+actionLines.join(" "),
      dlgLines.length && ("Dialogue: "+dlgLines.join("; ")+"."),
      clipDialogue && ("Clip-level ordered dialogue (not assigned to a shot; perform once in order): "+clipDialogue+"."),
      settingRef && ("Setting: "+settingRef+"."),
      "Camera: "+(d.camera||"static")+".",
      d.lighting && ("Lighting: "+d.lighting+"."),
      style && ("Style: "+style+"."),
    ].filter(Boolean).join("\n");
  }
  if(recipe==="lipsync"){
    // every spoken line gets ITS OWN speaker + @AudioN pairing (clip-wide lineShots
    // order = the order the audio assets are attached), so a two-hander never reads
    // as one character delivering both lines.
    const lineShotsAll = d.lineShots||[];
    // number lip-sync tags only over the lines that really attach (user deselections)
    const lineShots = Array.isArray(d.audioIncluded)
      ? lineShotsAll.filter(sh=>sh && d.audioIncluded.indexOf(sh.id)>=0)
      : lineShotsAll;
    const allLines = d.allPanelLines || panelLines;
    const microPlan = _seedanceMicroPlan({ ...d, panelLines:allLines }, lineShots.length ? lineShots : shots);
    const visualLead = "Start from the selected visual source"+(d.audioRefsOn===false ? "" : " and keep the frame anchored while the beat plays")+".";
    const nameOf = (sh)=>{ const p = allLines.find(x=>x&&x.shotId===(sh&&sh.id));
      const nm = (p&&p.speaker&&p.speaker.name) || (sh&&sh.lineAudio&&sh.lineAudio.speaker) || voiceLead;
      return _stagePromptEntityLabel(refs, "speaker", nm, nm); };
    const sayOf = (sh)=>{ const p = allLines.find(x=>x&&x.shotId===(sh&&sh.id));
      return String((p&&p.dialogue) || (sh&&sh.dialogue) || (sh&&sh.lineAudio&&sh.lineAudio.text) || "").trim().replace(/^["“]|["”]$/g,""); };
    const clipDialogue=_seedanceClipDialogueClause(d,refs);
    const clipDialogueNote=clipDialogue
      ? " CLIP-LEVEL ORDERED DIALOGUE (not assigned to a shot; perform once in order): "+clipDialogue+"."
      : "";
    const tail = (settingRef?(" "+settingRef+"."):"") + (style?(" "+style+"."):"");
    // NATIVE PERFORMANCE (no audio refs): the model acts the lines itself — name the
    // words, not @Audio files, and leave the pacing to the performance
    if(d.audioRefsOn===false){
      if(lineShots.length>1){
        const seq = lineShots.map((sh)=> nameOf(sh)+" says \""+sayOf(sh)+"\"").join(", then ");
        return [microPlan, visualLead+" "+seq+" — each performing their line in their own natural, in-character voice. Let the moment breathe between the lines — a look, a reaction. Grounded performances; subtle, motivated motion; hold the framing, lighting and identity steady."+tail+clipDialogueNote].filter(Boolean).join("\n\n");
      }
      const one = lineShots[0];
      const sp1 = one ? nameOf(one) : voiceLead;
      const ln1 = one ? sayOf(one) : "";
      return [microPlan, visualLead+" "+sp1+" performs "+(ln1?("\""+ln1+"\" "):"the screenplay line ")+"in a natural, in-character voice with free, believable pacing. Subtle, motivated motion; hold the framing, lighting and identity steady."+tail+clipDialogueNote].filter(Boolean).join("\n\n");
    }
    // PLACEMENT: when the clip runs longer than the speech (the 4s floor, or budgeted
    // air), say where the line lands — otherwise the model guesses and the extra
    // seconds come out as unguided vamping.
    const lineSecTotal = lineShots.reduce((t,sh)=>t+(_seedanceVoiceSec(sh, sayOf(sh))||0),0);
    const clipSec = Number(d.dur)||0;
    const roomy = !!(clipSec && lineSecTotal && (clipSec-lineSecTotal)>=1.2);
    if(lineShots.length>1){
      const seq = lineShots.map((sh,i)=>{ const w = sayOf(sh);
        return nameOf(sh)+" delivers "+(w?("\""+w+"\""):"their line")+" in @Audio"+(i+1); }).join(", then ");
       return [microPlan, visualLead+" "+seq+" — each line lip-synced to its own audio reference, and only the named speaker's lips move on their line. Let the micro-beat action plan drive the physical business between and around the lines. Grounded, in-character performances; subtle, motivated motion; hold the framing, lighting and identity steady."+tail+clipDialogueNote].filter(Boolean).join("\n\n");
    }
    const speaker1 = lineShots[0] ? nameOf(lineShots[0]) : voiceLead;
    const words1 = lineShots[0] ? sayOf(lineShots[0]) : "";
    return [microPlan, visualLead+" "+speaker1+" delivers "+(words1?("\""+words1+"\" "):"the screenplay line ")+"in @Audio1 with natural, accurate lip-sync — a grounded, in-character performance."
      +(roomy ? (" The line lands about "+CLIP_AIR.lead+"s in — settle the moment before it and hold "+speaker1+"'s reaction after it.") : "")
       +" Let the micro-beat action plan drive the physical business. Subtle, motivated motion; hold the framing, lighting and identity steady."+tail+clipDialogueNote].filter(Boolean).join("\n\n");
  }
  if(recipe==="timeline"){
    // time-coded windows — Seedance paces motion to described segments (0–4s, 4–9s…).
    // Dialogue windows carry BREATHING ROOM (the same CLIP_AIR the clip clock budgets):
    // the line is PLACED inside its window with air before and after, so the described
    // action has real seconds to happen in instead of wall-to-wall speech.
    const r1 = (x)=>Math.round(x*10)/10;
    const headLines = [
      "One continuous "+(d.dur||"4-15")+"s clip, paced to the time-coded segments below — no hard cuts unless a segment demands one.",
      cast.length && ("Cast: "+cast.join(", ")+"."),
      settingRef && ("Setting: "+settingRef+"."),
      style && ("Style: "+style+"."),
      d.lighting && ("Lighting: "+d.lighting+"."),
      _seedanceClipDialogueClause(d,refs) && ("Clip-level ordered dialogue (not assigned to a shot; perform once in order): "+_seedanceClipDialogueClause(d,refs)+"."),
    ].filter(Boolean).join(" ");
    // SINGLE-SHOT beats: one shot means one window, which defeats the point of
    // time-stamping. When the beat carries an ordered micro-beat plan (and no spoken
    // line that needs its own placed window), stamp the MICRO-BEATS instead — the
    // documented rule is that timestamps earn their keep when several events must
    // land in order, roughly one stamp per 2-4s of runtime.
    if(shots.length===1){
      const sh0 = shots[0]||{}, p0 = panelLines[0]||{};
      const spoken0 = String((p0&&p0.dialogue) || (sh0&&sh0.dialogue) || "").trim();
      const micro0 = (Array.isArray(p0.micro) ? p0.micro : []).map(m=>String(m||"").replace(/[\s.;]+$/,"")).filter(Boolean);
      if(!spoken0 && micro0.length>=2){
        const total0 = Math.max(2, Number(d.dur) || stageShotRuntime(sh0) || 4);
        const per0 = total0/micro0.length;
        const grammar0 = _seedanceShotGrammar(sh0);
        const rows0 = micro0.map((m,i)=> r1(i*per0)+"–"+r1((i+1)*per0)+"s: "+m+"."
          +((i===0 && grammar0) ? (" Camera: "+grammar0+".") : ""));
        return headLines+"\n"+rows0.join("\n");
      }
    }
    let t = 0, spokenSeen = 0;
    const lastSpokenIdx = shots.reduce((k,sh,i)=> String(sh&&sh.dialogue||"").trim() ? i : k, -1);
    const windows = shots.map((sh,i)=>{
      const p = panelLines[i]||{};
      const dialogue = String((p&&p.dialogue) || (sh&&sh.dialogue)||"").trim().replace(/^["“]|["”]$/g,"");
      const lineSec = dialogue ? _seedanceVoiceSec(sh, dialogue) : 0;
      const lead = dialogue ? (spokenSeen===0 ? CLIP_AIR.lead : CLIP_AIR.gap) : 0;
      const tail = (dialogue && i===lastSpokenIdx) ? CLIP_AIR.tail : 0;
      const dur = dialogue ? (lead + lineSec + tail) : stageShotRuntime(sh);
      const a = r1(t), b = r1(t+dur), lineAt = r1(t+lead), lineEnd = r1(t+lead+lineSec);
      t += dur; if(dialogue) spokenSeen++;
      const grammar = _seedanceShotGrammar(sh);
      const speakerName = (p.speaker&&p.speaker.name) || "the speaker";
      const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
      const aIdx = dialogue ? stageLineAudioIndex(d, sh.id) : 0;
      const microLead = (Array.isArray(p.micro) && p.micro.length) ? p.micro.map((m,j)=>(j+1)+") "+String(m||"").replace(/[\s.;]+$/,"")).join("; ") : "";
      return a+"–"+b+"s: "+(microLead || String(p.text||sh.action||"").trim() || "Hold the moment.")
        + (grammar?(" Camera: "+grammar+"."):"")
        + (dialogue?(" "+speaker+" says \""+dialogue+"\" at ~"+lineAt+"–"+lineEnd+"s"
            +(aIdx?(" — lip-sync "+speaker+" to @Audio"+aIdx):"")
            +"; let the moment breathe before and after the line."):"");
    });
    return headLines+"\n"+windows.join("\n");
  }
  if(recipe==="panels"){
    const context = [
      "SEEDANCE MULTIMODAL SHOT PLAN",
      "Clip: "+((clip&&clip.label)||"selected clip")+" from "+((clip&&clip.scene&&clip.scene.title)||"the scene")+".",
      settingRef && ("Setting: "+settingRef+"."),
      cast.length && ("Cast in frame: "+cast.join(", ")+"."),
      props.length && ("Props that must carry through when present: "+props.join(", ")+"."),
      style && ("Look: "+style+"."),
      d.lighting && ("Lighting: "+d.lighting+"."),
      d.camera && ("Camera arc: "+d.camera+"."),
      "Reference roles: the selected start image or storyboard half/page controls composition and blocking; character, prop and location references control identity, objects and geography; audio references control spoken timing and lip-sync.",
      "Generate one continuous "+(d.dur||"4-15")+"s clip. Treat the shot units below as ordered key moments inside that clip, not as separate unrelated images."
    ].filter(Boolean).join("\n");
    const panels = shots.map((sh,i)=>_seedancePanelText(sh, panelLines[i]||{}, i, clip, refs)).join("\n\n");
    const rules = [
      "Continuity rules:",
      "1. Match the referenced storyboard panel order and the screenplay beat order exactly.",
      "2. If screenplay intent and storyboard blocking differ, keep the screenplay dialogue/intent but use storyboard blocking for where bodies, props and camera begin.",
      "3. Do not invent extra beats, extra speakers, new props, new costumes or a different location.",
      "4. Preserve character identity, wardrobe, carried props, lighting and location geometry across the whole clip.",
      "5. Let Seedance pace the motion naturally inside the target duration; avoid freeze-frame panel cuts unless the action demands a cut."
    ].join("\n");
    return [context, panels, rules].filter(Boolean).join("\n\n");
  }
  return d.prompt || "";   // narrative (default)
}

/* EXPLICIT "Narrative" style — the documented Seedance shot-brief formula as ONE
   flowing paragraph: who → doing what (cause before reaction, micro-beats in order)
   → where → the spoken line in double quotes → shot how (camera in its OWN clause,
   separate from subject motion — the guides are explicit about that split) → light
   → look. No labels, no lists: the phrasing the model reads as a director's brief. */
function seedanceNarrativeParagraph(clip, sh, refs){
  const d = (clip&&clip.data) || {};
  const p = ((d.panelLines||[]).find(x=>x.shotId===(sh&&sh.id))) || (d.panelLines||[])[0] || {};
  const cast = (d.cast||[]).map(c=>_stagePromptEntityLabel(refs, "character", c, c.name)).filter(Boolean);
  const setting = d.setting || (clip&&clip.scene&&clip.scene.loc) || "";
  const settingRef = _stagePromptEntityLabel(refs, "setting", d.loc || setting, setting);
  const micro = (Array.isArray(p.micro) ? p.micro : []).map(m=>String(m||"").replace(/[\s.;]+$/,"")).filter(Boolean);
  const action = micro.length ? micro.join(", then ")
    : String(p.text || (sh&&sh.action) || "").trim().replace(/[\s.]+$/,"");
  const dialogueRows = Array.isArray(p&&p.dialogueLines)&&p.dialogueLines.length
    ? p.dialogueLines : [{speaker:(p.speaker&&p.speaker.name)||"the speaker",text:p&&p.dialogue||sh&&sh.dialogue||""}];
  const dialogue = dialogueRows.map(row=>{
    const words=String(row&&row.text||"").trim().replace(/^["“]|["”]$/g,"");
    if(!words)return "";
    const speakerName=(row&&row.speaker)||(p.speaker&&p.speaker.name)||"the speaker";
    const speaker=_stagePromptEntityLabel(refs,"speaker",speakerName,speakerName);
    return speaker+" says \""+words+"\""
      +(d.audioRefsOn===false ? " in a natural, in-character voice." : " — sync the performance to the matching audio reference when one is attached.");
  }).filter(Boolean).join(" ");
  const clipDialogue=_seedanceClipDialogueClause(d,refs);
  const grammar = _seedanceShotGrammar(sh) || d.camera || "";
  const style = d.preset ? (d.preset.name+" — "+d.preset.grade) : "";
  return [
    (cast.length ? cast.join(" and ") : "The subject")
      + (settingRef ? (" — "+settingRef+" —") : "")
      + (action ? (" "+(action.charAt(0)===action.charAt(0).toUpperCase() ? action.charAt(0).toLowerCase()+action.slice(1) : action)+".") : " holds the moment."),
    dialogue,
    clipDialogue && ("Clip-level ordered dialogue (not assigned to a shot; perform once in order): "+clipDialogue+"."),
    grammar && ("Camera: "+grammar+" — keep camera movement in its own motion, separate from the subject's."),
    d.lighting && (d.lighting.charAt(0).toUpperCase()+d.lighting.slice(1).replace(/[\s.]+$/,"")+"."),
    style && (style+"."),
    "Grounded, subtle performance; keep identity, wardrobe and location geography consistent with the references."
  ].filter(Boolean).join(" ");
}

function seedanceBeatPrompt(clip, sh, refs){
  const d = (clip&&clip.data) || {};
  const p = ((d.panelLines||[]).find(x=>x.shotId===(sh&&sh.id))) || {};
  const cast = (d.cast||[]).map(c=>_stagePromptEntityLabel(refs, "character", c, c.name)).filter(Boolean);
  const setting = d.setting || (clip&&clip.scene&&clip.scene.loc) || "";
  const settingRef = _stagePromptEntityLabel(refs, "setting", d.loc || setting, setting);
  const style = d.preset ? (d.preset.name+" — "+d.preset.grade) : "";
  const script = String(p.script||stageShotScriptText(clip&&clip.scene, {}, sh, 220)||"").trim();
  const blocking = String(p.sheet||sh&&sh.action||"").trim();
  const micro = Array.isArray(p.micro) ? p.micro.filter(Boolean) : [];
  const dialogue = String((p&&p.dialogue) || (sh&&sh.dialogue)||"").trim().replace(/^["“]|["”]$/g,"");
  const speakerName = (p.speaker&&p.speaker.name) || "the speaker";
  const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
  // append storyboard blocking ONLY when it adds real information — a 1% text wobble
  // ("sodium light" vs "sodium light,") made the sentence read twice; strip trailing
  // punctuation (as everywhere else in prompt assembly) so the dedupe is exact
  const scriptN = _normStageText(script), blockingN = _normStageText(blocking);
  const blockingAdds = !!(blockingN && blockingN!==scriptN && scriptN.indexOf(blockingN)<0 && blockingN.indexOf(scriptN)<0);
  const parts = [
    cast.length && ("Subject: "+cast.join(", ")+"."),
    (micro.length || script || blocking) && ("Action: "+(micro.length
      ? ("Animate these micro-beats in order: "+micro.map((m,i)=>(i+1)+") "+String(m||"").replace(/[\s.;]+$/,"")).join("; ")+".")
      : (script || blocking))+(script && blocking && blockingAdds ? (" Storyboard blocking: "+blocking.replace(/[\s.;…]+$/,"")) : "")),
    dialogue && ("Dialogue/audio: "+speaker+" says \""+dialogue+"\""
      +(d.audioRefsOn===false ? "; performed in a natural, in-character voice." : "; sync performance to the locked audio if present.")),
    _seedanceClipDialogueClause(d,refs) && ("Clip-level ordered dialogue (not assigned to a shot; perform once in order): "+_seedanceClipDialogueClause(d,refs)+"."),
    settingRef && ("Setting: "+settingRef+"."),
    "Camera: "+(_seedanceShotGrammar(sh)||d.camera||"static")+".",
    d.lighting && ("Lighting: "+d.lighting+"."),
    style && ("Style: "+style+"."),
    "Continuity: preserve identity, wardrobe, carried props, lighting and location geography from the references; animate only this beat's physical change."
  ].filter(Boolean);
  // one labelled field per line — readable, and the model parses it just as well
  return parts.join("\n");
}

/* seedancePrompt()/SEEDANCE_RECIPES above describe a whole CLIP (every shot in the
   sceneSequences group). The console renders one BEAT at a time, so reuse the same
   recipes scoped to just the active beat's shots (shownShots) rather than the clip's —
   otherwise "Panel-by-panel"/"Structured" would describe shots the render never sees. */
function seedanceBeatData(clip, shots){
  const d = (clip&&clip.data) || {};
  const ids = new Set((shots||[]).map(s=>s&&s.id));
  // allPanelLines stays CLIP-WIDE: @AudioN indices + speaker names must resolve against
  // the whole clip's line order even when the prompt is scoped to one beat.
  return { ...d, shots:shots||[], panelLines:(d.panelLines||[]).filter(p=>ids.has(p.shotId)), allPanelLines:d.panelLines||[] };
}
/* Canonical one-shot beat prompt. The image is only the beat's opening state;
   screenplay action and speech are the temporal script. In particular, a remote
   speaker gets voice/VO treatment without an identity image or onscreen lips. */
function seedanceBeatOpeningPrompt(clip, shots, activeShot, audioRefsOn, audioIncluded, refs, opts){
  const d=(clip&&clip.data)||{}, list=shots&&shots.length?shots:(d.shots||[]);
  const sh=list[0]||activeShot||{};
  const scripts=d.beatScripts||{};
  const src=scripts[sh.beatN]||{};
  const full=String(src.text||"").trim();
  if(!src.hasSource&&(!full||src.missing))
    return "BLOCKED: canonical screenplay source is unavailable for this beat-opening shot. Load shot-screenplay.js before Stage; stale shot text is not a valid replacement.";
  const cast=(d.cast||[]).map(c=>_stagePromptEntityLabel(refs,"character",c,c.name)).filter(Boolean);
  const setting=_stagePromptEntityLabel(refs,"setting",d.loc||d.setting,d.setting||((clip&&clip.scene&&clip.scene.loc)||""));
  const dialogues=(src.dialogue&&src.dialogue.length?src.dialogue:(d.beatDialogues&&d.beatDialogues[sh.beatN])||[]);
  const dlg=dialogues.map((ln,i)=>{
    const speaker=String(ln&&ln.speaker||"the speaker").trim();
    const who=_stagePromptEntityLabel(refs,"speaker",speaker,speaker);
    const words=String(ln&&ln.text||"").trim().replace(/^["“]|["”]$/g,"");
    const delivery=String(ln&&ln.delivery||"onscreen").toLowerCase();
    const remote=stageDeliveryIsRemote(delivery);
    if(stageDeliveryIsText(delivery))return who+' sends the exact text "'+words+'"; show the message only as diegetic content, never a speaking face or lip-sync.';
    return who+(remote
      ? ' is remote/offscreen and delivers the exact line "'+words+'" as VO/audio; do not show their body, face or lips in this beat.'
      : ' delivers the exact line "'+words+'" onscreen'+(audioRefsOn===false?" in a natural in-character voice.":"; lip-sync only the visible speaker when matching audio is attached."));
  }).filter(Boolean);
  const grammar=_seedanceShotGrammar(sh);
  const opening=String(src.openingAction||sh.openingAction||sh.action||"").trim();
  const rows=[
    "ONE SCREENPLAY BEAT — one continuous shot, no micro-beat montage, no invented cuts, inserts or later keyframes.",
    cast.length&&("Opening physical cast: "+cast.join(", ")+"."), setting&&("Setting: "+setting+"."),
    opening&&("Opening keyframe state: "+opening+". Use the selected image as the sole start state; do not depict later phone/message inserts in the opening frame."),
    full&&("FULL BEAT SCREENPLAY (verbatim; perform all action and dialogue in this one shot):\n"+full),
    dlg.length&&("Dialogue delivery (exact words; do not paraphrase): "+dlg.join(" ")),
    grammar&&("Camera: "+grammar+". Keep the opening composition and animate the beat temporally; do not cut to a montage."),
    d.lighting&&("Lighting: "+d.lighting+"."),
    d.preset&&("Look: "+d.preset.name+" — "+d.preset.grade+"."),
    "Continuity: preserve only the opening physical cast, identity, wardrobe, props and location geometry from the selected references. Remote/offscreen participants remain audio/script only. No captions, subtitles, message UI, panel borders or burned-in text."
  ].filter(Boolean);
  return rows.join("\n");
}
window.seedanceBeatOpeningPrompt=seedanceBeatOpeningPrompt;
/* Normalize the planner's public result without making Stage depend on its display
   shape. The planner owns timing/packing; Stage owns the exact prompt language. */
function stageTimedPlanRows(shots, opts){
  const list=shots||[];
  let plan=null;
  if(typeof window.stageBuildTimedPlan==="function"){
    try{ plan=window.stageBuildTimedPlan(list,opts||{}); }catch(e){ plan={ error:String((e&&e.message)||e) }; }
  }
  const raw=Array.isArray(plan) ? plan
    : ((plan&&plan.units)||(plan&&plan.rows)||(plan&&plan.segments)||(plan&&plan.schedule)||(plan&&plan.items)||[]);
  if(raw.length) return { plan, rows:raw.map((r,i)=>({
    shotId:r.shotId||r.id||((list[i]||{}).id),
    start:Number(r.startSec!=null?r.startSec:(r.start!=null?r.start:r.from))||0,
    end:Number(r.endSec!=null?r.endSec:(r.end!=null?r.end:r.to))||0,
    label:r.label||r.text||r.action||""
  })) };
  // Compatibility while stage-plan loads after this file, and for legacy builds.
  let t=0;
  const rows=list.map(sh=>{ const dur=Math.max(0.1,Number(sh&&sh.dur)||((typeof stageShotRuntime==="function")?stageShotRuntime(sh):2)||2);
    const r={shotId:sh&&sh.id,start:t,end:t+dur,label:""}; t+=dur; return r; });
  return { plan, rows };
}
function seedanceTimedPlanPrompt(clip, shots, audioRefsOn, audioIncluded, refs, opts){
  const d=(clip&&clip.data)||{}, list=shots||[], panels=d.panelLines||[];
  const timed=stageTimedPlanRows(list,{ ...(opts||{}), durationSec:Number(opts&&opts.durationSec)||Number(d.dur)||0,
    panelLines:panels, clipId:clip&&clip.id });
  const r1=n=>(Math.round((Number(n)||0)*10)/10).toString().replace(/\.0$/,"");
  const units=(timed.plan&&timed.plan.units)||[];
  const rows=timed.rows.map((r,i)=>{
    const sh=list.find(x=>x&&x.id===r.shotId)||list[i]||{};
    const p=panels.find(x=>x&&x.shotId===sh.id)||{};
    const unit=units.find(x=>x&&x.shotId===sh.id)||units[i]||{};
    const micro=(Array.isArray(unit.micro)?unit.micro:(Array.isArray(p.micro)?p.micro:[]))
      .map(x=>String(x||"").replace(/[\s.;]+$/,"")).filter(Boolean);
    // p.micro was built from sh.covers, so this is shot coverage, never the whole beat.
    const action=micro.length ? micro.map((x,j)=>(j+1)+") "+x).join("; ")
      : String(unit.action||p.text||sh.action||r.label||"Hold the composition.").trim();
    const exactDialogue=String(unit.dialogue||p.dialogue||sh.dialogue||"").trim();
    const dialogue=_seedanceDialogueClause(sh,{ ...p,dialogue:exactDialogue },{ ...d,audioRefsOn,audioIncluded },refs);
    return r1(r.start)+"–"+r1(r.end)+"s: SHOT "+(i+1)+" · Beat "+(sh.beatN||"—")
      +" — "+action+(dialogue?(" Dialogue/audio: "+dialogue+"."):"")
      +(_seedanceShotGrammar(sh)?(" Camera: "+_seedanceShotGrammar(sh)+"."):"");
  });
  const beats=_uniq(list.map(sh=>sh&&sh.beatN).filter(n=>Number(n)>0));
  return [
    "TIMED RENDER PLAN — cover every listed shot and beat in exact order; do not omit, merge, reorder or invent story events.",
    "Coverage: "+list.length+" shot"+(list.length===1?"":"s")+" · beat"+(beats.length===1?" ":"s ")+(beats.join(", ")||"unassigned")+".",
    rows.join("\n"),
    "Use the selected references to lock identity, appearance variants, wardrobe, props and location geography. Keep dialogue exactly as quoted. No captions, subtitles, panel borders or burned-in text."
  ].filter(Boolean).join("\n");
}
window.stageTimedPlanRows=stageTimedPlanRows;
window.seedanceTimedPlanPrompt=seedanceTimedPlanPrompt;
function seedanceRecipePrompt(recipeId, clip, shots, activeShot, audioRefsOn, audioIncluded, refs, opts){
  const scoped = { ...clip, data:{ ...seedanceBeatData(clip, shots),
    audioRefsOn: audioRefsOn!==false,
    audioIncluded: Array.isArray(audioIncluded) ? audioIncluded : null } };
  // EXPLICIT STYLE (the user picked a named structure in the Prompt-style menu):
  // the chosen grammar must really land in the box, so the auto director-brief
  // derivations stand down. Auto (no explicitStyle) keeps the researched defaults.
  const beatOpening=!!(scoped.data&&scoped.data.shots||[]).some(stageBeatOpeningShot);
  const base = beatOpening
    ? seedanceBeatOpeningPrompt(scoped,shots,activeShot,audioRefsOn,audioIncluded,refs,opts)
    : (opts&&opts.explicitStyle)
    ? ((!recipeId || recipeId==="narrative")
        ? seedanceNarrativeParagraph(scoped, activeShot, refs)
        : seedancePrompt(recipeId, scoped, refs))
    : (opts&&opts.timedPlan)
    ? seedanceTimedPlanPrompt(scoped,shots,audioRefsOn!==false,audioIncluded,refs,opts)
    : (opts&&opts.beatSequence)
    ? seedanceBeatSequenceDirectorPrompt(scoped, shots, audioRefsOn!==false, audioIncluded, refs, opts)
    : (opts&&opts.wholeScene)
    ? seedanceWholeSceneDirectorPrompt(scoped, audioRefsOn!==false, audioIncluded, refs, opts)
    : seedanceMicroBeatDirectorPrompt(scoped, shots, activeShot, audioRefsOn!==false, audioIncluded, refs)
    || ((!recipeId || recipeId==="narrative") ? seedanceBeatPrompt(scoped, activeShot, refs) : seedancePrompt(recipeId, scoped, refs));
  // Standing soundtrack rule (user direction): generation audio is the WORLD only —
  // spoken dialogue (when specified above) plus environmental/diegetic SFX and
  // ambience. Music belongs to post; text must never be burned into pixels.
  return base + "\nAUDIO & OVERLAYS: besides any spoken dialogue specified above, the soundtrack is environmental and diegetic sound effects with natural ambience ONLY — NO background music, NO score, NO soundtrack. NO subtitles, captions or any burned-in text overlays anywhere in the frame.";
}
/* exported for the headless prompt-style test suite (scripts/test-stage-promptstyles.mjs) */
window.seedanceRecipePrompt = seedanceRecipePrompt;
window.stageSmartRecipe = stageSmartRecipe;
window.SEEDANCE_RECIPES = SEEDANCE_RECIPES;

/* ---- @mention role assignment. Seedance treats attached references it isn't told
   about as ambient at best — best practice is one declared-role sentence per input
   ("Use @Image1 as the main character reference", "match the pacing from @Video1").
   Derived automatically from each asset's key/label; appended to the prompt at render. */
function stageAssetTagShort(a){
  const n = (String(a&&a.tag||"").match(/\d+$/)||[""])[0];
  return "@"+({ text:"Txt", image:"Img", video:"Vid", audio:"Aud" }[a&&a.kind]||"Ref")+n;
}
function stageAssetMention(a){
  const n = (String(a&&a.tag||"").match(/\d+$/)||[""])[0];
  return "@"+({ image:"Image", video:"Video", audio:"Audio" }[a&&a.kind]||"")+n;
}
function stageReferenceFileCount(assets,included){
  const on=typeof included==="function"?included:()=>true;
  return (assets||[]).filter(a=>a&&a.kind!=="text"&&on(a)).length;
}
window.stageReferenceFileCount=stageReferenceFileCount;
function stageProspectiveMentionToken(asset,assets,included){
  if(!asset||!asset.kind||asset.kind==="text")return "";
  const on=typeof included==="function"?included:()=>false;
  let before=0;
  if(asset.sceneOnly){
    // Scene-only choices append after every included base and previously chosen
    // extra, matching tagged's actual attachment order.
    before=(assets||[]).filter(a=>a&&a.kind===asset.kind&&on(a)).length;
  }else{
    const idx=(assets||[]).indexOf(asset);
    before=(assets||[]).slice(0,idx<0?0:idx).filter(a=>a&&!a.sceneOnly&&a.kind===asset.kind&&on(a)).length;
  }
  return "@"+({image:"Image",video:"Video",audio:"Audio"}[asset.kind]||"")+(before+1);
}
window.stageProspectiveMentionToken=stageProspectiveMentionToken;
function stageIncludedMentionMap(mentionables){
  const out={};
  (mentionables||[]).filter(m=>m&&m.included!==false).forEach(m=>{
    out[String(m.t||"").toLowerCase()]=m;
  });
  return out;
}
window.stageIncludedMentionMap=stageIncludedMentionMap;
function stagePromptMentionContext(includedAssets, d){
  const byKey = {};
  const byName = {};
  const identity={character:{},prop:{},location:{}};
  const addName = (name, tok, force)=>{
    const n = _normStageText(name);
    if(n && tok && (force || !byName[n])) byName[n] = tok;
  };
  (includedAssets||[]).forEach(a=>{
    if(!a || a.kind==="text") return;
    const tok = stageAssetMention(a);
    if(!tok || tok==="@") return;
    byKey[String(a.key||"")] = tok;
    if(a.kind==="image"){
      let kind=a.referenceKind||"";
      let entityId=a.entityId||"";
      if(!kind&&String(a.key||"").startsWith("c:")){kind="character";entityId=String(a.key).slice(2);}
      if(!kind&&String(a.key||"").startsWith("p:")){kind="prop";entityId=String(a.key).slice(2);}
      if(!kind&&a.key==="loc"){kind="location";entityId=a.entityId||a.id;}
      if(identity[kind]&&entityId){
        const row=identity[kind][entityId]||(identity[kind][entityId]={active:new Set(),legacy:new Set()});
        (a.referenceResolved?row.active:row.legacy).add(tok);
      }
    }
  });
  Object.entries(identity).forEach(([kind,rows])=>Object.entries(rows).forEach(([id,row])=>{
    // One authoritative active variant wins over an optional manually-added
    // master. Multiple active variants in one multi-shot package are ambiguous:
    // retain explicit @ImageN mentions, but never guess a bare entity-name token.
    const pool=row.active.size?row.active:row.legacy;
    const identityKey=(kind==="character"?"c:":kind==="prop"?"p:":"location:")+id;
    if(pool.size!==1){
      if(row.active.size) delete byKey[identityKey];
      return;
    }
    const tok=Array.from(pool)[0];
    byKey[identityKey]=tok;
  }));
  const locationTokens=new Set(Object.keys(byKey).filter(k=>k.startsWith("location:")).map(k=>byKey[k]).filter(Boolean));
  if(locationTokens.size===1)byKey.loc=Array.from(locationTokens)[0];
  else if(locationTokens.size>1)delete byKey.loc;
  (d&&d.cast||[]).forEach(c=>{
    const tok = byKey["c:"+c.id] || byName[_normStageText(c.name)];
    addName(c.name, tok, !!byKey["c:"+c.id]);
  });
  (d&&d.props||[]).forEach(p=>{
    const tok = byKey["p:"+p.id] || byName[_normStageText(p.name)];
    addName(p.name, tok, !!byKey["p:"+p.id]);
  });
  return {
    character(c){
      if(!c) return "";
      if(typeof c==="string") return byName[_normStageText(c)] || "";
      return byKey["c:"+c.id] || byName[_normStageText(c.name)] || "";
    },
    speaker(name){ return byName[_normStageText(name)] || ""; },
    prop(p){
      if(!p) return "";
      if(typeof p==="string") return byName[_normStageText(p)] || "";
      return byKey["p:"+p.id] || byName[_normStageText(p.name)] || "";
    },
    setting(){ return byKey.loc || ""; },
    audioForShot(shotId){ return byKey["a:"+shotId] || ""; }
  };
}
window.stagePromptMentionContext=stagePromptMentionContext;
function stageAssetRole(a, refs){
  if(!a || a.kind==="text") return "";
  const T = stageAssetMention(a);
  const k = String(a.key||"");
  const label = String(a.label||"").trim();
  if(a.kind==="audio"){
    const speakerName = label.replace(/\s+line$/i,"") || "the speaker";
    const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
    return T+" is "+speaker+"'s spoken line — sync lip movement and timing to it.";
  }
  if(a.kind==="video") return T+" is the previous clip — match its camera movement, pacing and continuity.";
  if(k==="frame") return T+" is the first frame — start from this exact composition.";
  if(k.indexOf("shotframe:")===0) return T+" is "+(label.toLowerCase()||"a later shot's frame")+" — anchor that shot's composition and blocking to it.";
  if(k.indexOf("scene-shotframe:")===0) return T+" is a scene shot frame chosen by the director — use its composition, identity and continuity where the prompt mentions it.";
  if(k.indexOf("sb-half")===0 || k==="sb-sheet") return T+" is the storyboard for this clip — follow its composition, blocking and panel order.";
  if(k.indexOf("c:")===0) return T+" is "+(label.replace(/\s+reference$/i,"")||"the character")+"'s identity reference — keep their appearance exactly consistent; use it for identity only and do not copy its background, pose or lighting.";
  if(k==="loc") return T+" is the "+(label||"location plate")+" — keep its geography and lighting.";
  if(k.indexOf("scene-loc:")===0) return T+" is a scene location reference chosen by the director — preserve its geography, set dressing and lighting.";
  if(k.indexOf("p:")===0) return T+" is the "+(label||"prop")+" — keep this object's design consistent; design only, ignore its backdrop.";
  return T+" is "+(label||"a reference")+".";
}

/* ---- In-text @mention CHIP editor (Seedance-style). A contentEditable prompt box
   where resolved @Image/@Video/@Audio tokens render as inline chips — thumbnail +
   token + a caret that opens a same-kind swap picker — while the canonical value
   stays the PLAIN STRING the recipes/generate path already use (chips serialize back
   to their raw token). Caret positions are tracked as absolute offsets into that
   string (a chip counts as its token's length), so autocomplete, insert-at-caret and
   maxLength all keep working exactly as they did on the old <textarea>. */
function StageMentionEditor({ value, mentionables, includeMention, maxLen, placeholder, onChange, onKeyDown, onBlur, apiRef }){
  const elRef = React.useRef(null);
  const lastVal = React.useRef(null);          // last value REFLECTED in the DOM
  const [swap, setSwap] = React.useState(null); // {tok, start, kind} — chip swap picker
  const swapRef = React.useRef(null); swapRef.current = swap;
  const byTokRef = React.useRef({});
  // Chips describe the files that are actually attached now. Prospective picker
  // options may share a future token, but must never overwrite its included chip.
  byTokRef.current = stageIncludedMentionMap(mentionables);
  const tokRe = ()=>/@(?:Image|Video|Audio)\d+/gi;
  const isChip = (n)=> n && n.nodeType===1 && n.getAttribute && n.getAttribute("data-token");

  /* DOM -> string. Only text nodes, chips and BRs exist after our own renders; DIVs
     (rare browser artifacts) serialize defensively as newline + contents. */
  const serialize = ()=>{
    let out = "";
    const walk = (n)=>{ Array.from(n.childNodes).forEach(c=>{
      if(c.nodeType===3) out += c.nodeValue;
      else if(c.nodeType===1){
        if(isChip(c)) out += c.getAttribute("data-token");
        else if(c.tagName==="BR") out += "\n";
        else { if(out && !/\n$/.test(out)) out += "\n"; walk(c); }
      } }); };
    if(elRef.current) walk(elRef.current);
    return out;
  };
  const caretOffset = ()=>{
    const el = elRef.current, sel = window.getSelection();
    const cur = lastVal.current||"";
    if(!el || !sel || !sel.rangeCount) return cur.length;
    const fN = sel.focusNode, fO = sel.focusOffset;
    if(!el.contains(fN)) return cur.length;
    let off = 0, done = false;
    const walk = (n)=>{
      const kids = Array.from(n.childNodes);
      for(let i=0;i<kids.length;i++){
        if(n===fN && n.nodeType===1 && i===fO){ done = true; return; }
        const c = kids[i];
        if(c.nodeType===3){
          if(c===fN){ off += Math.min(fO, c.nodeValue.length); done = true; return; }
          off += c.nodeValue.length;
        } else if(c.nodeType===1){
          if(isChip(c)){ const L = c.getAttribute("data-token").length;
            if(c===fN || c.contains(fN)){ off += L; done = true; return; }
            off += L; }
          else if(c.tagName==="BR") off += 1;
          else { if(c===fN && fO===0){ done = true; return; } walk(c); if(done) return; }
        }
      }
      if(n===fN && n.nodeType===1 && kids.length<=fO) done = true;
    };
    walk(el);
    return done ? off : cur.length;
  };
  const setCaret = (off)=>{
    const el = elRef.current; if(!el) return;
    const sel = window.getSelection(), r = document.createRange();
    let rem = Math.max(0, off), placed = false;
    const place = (node, o)=>{ r.setStart(node, o); r.collapse(true); placed = true; };
    const walk = (n)=>{
      for(const c of Array.from(n.childNodes)){
        if(placed) return;
        if(c.nodeType===3){
          if(rem <= c.nodeValue.length){ place(c, rem); return; }
          rem -= c.nodeValue.length;
        } else if(c.nodeType===1){
          const p = c.parentNode, idx = Array.prototype.indexOf.call(p.childNodes, c);
          if(isChip(c)){ const L = c.getAttribute("data-token").length;
            if(rem <= L){ place(p, rem===0 ? idx : idx+1); return; }  // inside a chip snaps AFTER it
            rem -= L; }
          else if(c.tagName==="BR"){ if(rem===0){ place(p, idx); return; } rem -= 1; }
          else { walk(c); if(placed) return; }
        }
      }
    };
    walk(el);
    if(!placed){ r.selectNodeContents(el); r.collapse(false); }
    try{ sel.removeAllRanges(); sel.addRange(r); }catch(_e){}
  };
  /* absolute string-offset of a node (chips count as their token length) */
  const nodeStartOffset = (target)=>{
    let off = 0, found = false;
    const walk = (n)=>{
      for(const c of Array.from(n.childNodes)){
        if(found) return;
        if(c===target){ found = true; return; }
        if(c.nodeType===3) off += c.nodeValue.length;
        else if(c.nodeType===1){
          if(isChip(c)) off += c.getAttribute("data-token").length;
          else if(c.tagName==="BR") off += 1;
          else { walk(c); if(found) return; }
        }
      }
    };
    if(elRef.current) walk(elRef.current);
    return found ? off : -1;
  };
  const chipEl = (m)=>{
    const s = document.createElement("span");
    s.className = "stage2-chip "+(m.kind||""); s.contentEditable = "false";
    s.setAttribute("data-token", m.t);
    s.title = m.t+(m.label ? " — "+m.label : "");
    if(m.kind==="image" && m.url){ const img = document.createElement("img"); img.src = m.url; img.alt = ""; s.appendChild(img); }
    else { const t = document.createElement("span"); t.className = "stage2-chip-tile"; t.textContent = m.kind==="video" ? "▸" : "♪"; s.appendChild(t); }
    const b = document.createElement("b"); b.textContent = m.t; s.appendChild(b);
    const car = document.createElement("span");
    car.className = "stage2-chip-caret"; car.textContent = "▾";
    car.setAttribute("role","button"); car.title = "Swap the referenced asset";
    car.addEventListener("mousedown", (e)=>{ e.preventDefault(); e.stopPropagation(); });
    car.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation();
      const start = nodeStartOffset(s);
      if(start>=0) setSwap(sw => (sw && sw.start===start) ? null : { tok:m.t, start, kind:m.kind }); });
    s.appendChild(car);
    return s;
  };
  const renderDom = (txt)=>{
    const el = elRef.current; if(!el) return;
    txt = String(txt||"");
    el.textContent = "";
    const frag = document.createDocumentFragment();
    const re = tokRe(); let last = 0, m;
    while((m = re.exec(txt))){
      if(m.index>last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
      const mm = byTokRef.current[m[0].toLowerCase()];
      frag.appendChild(mm ? chipEl(mm) : document.createTextNode(m[0]));
      last = m.index + m[0].length;
    }
    if(last<txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    el.appendChild(frag);
  };
  /* raw (not-yet-chip) resolved tokens sitting in plain text nodes, as [start,end) */
  const rawResolvedRanges = ()=>{
    const out = []; let off = 0;
    const walk = (n)=>{
      for(const c of Array.from(n.childNodes)){
        if(c.nodeType===3){
          const re = tokRe(); let m;
          while((m = re.exec(c.nodeValue))){
            if(byTokRef.current[m[0].toLowerCase()]) out.push({ start:off+m.index, end:off+m.index+m[0].length });
          }
          off += c.nodeValue.length;
        } else if(c.nodeType===1){
          if(isChip(c)) off += c.getAttribute("data-token").length;
          else if(c.tagName==="BR") off += 1;
          else walk(c);
        }
      }
    };
    if(elRef.current) walk(elRef.current);
    return out;
  };
  const handleInput = ()=>{
    if(swapRef.current) setSwap(null);
    let txt = serialize();
    let caret = caretOffset();
    if(maxLen && txt.length>maxLen){          // e.g. a drop that slipped past beforeinput
      txt = txt.slice(0, maxLen); caret = Math.min(caret, maxLen);
      lastVal.current = txt; renderDom(txt); setCaret(caret);
    } else {
      lastVal.current = txt;
      // chipify tokens the caret is NOT touching — a token still being typed stays text
      if(rawResolvedRanges().some(r=> caret<r.start || caret>r.end)){ renderDom(txt); setCaret(caret); }
    }
    onChange && onChange(lastVal.current, caret);
  };
  const handleKeyDown = (e)=>{
    if(e.key==="Escape" && swapRef.current){ e.preventDefault(); setSwap(null); return; }
    if(onKeyDown) onKeyDown(e);
    if(e.defaultPrevented) return;
    if(e.key==="Enter"){                       // keep newlines predictable (BR, serialized "\n")
      e.preventDefault();
      try{ if(!document.execCommand("insertLineBreak")) document.execCommand("insertText", false, "\n"); }
      catch(_e){ try{ document.execCommand("insertText", false, "\n"); }catch(_e2){} }
    }
  };
  const handlePaste = (e)=>{
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if(!t) return;
    const sel = window.getSelection();
    const selLen = (sel && sel.rangeCount) ? sel.getRangeAt(0).toString().length : 0;
    const room = (maxLen||1e9) - ((lastVal.current||"").length - selLen);
    const ins = t.slice(0, Math.max(0, room)).replace(/\r\n?/g,"\n");
    if(ins){ try{ document.execCommand("insertText", false, ins); }catch(_e){} }
  };
  const doSwap = (m)=>{
    const sw = swapRef.current; if(!sw) return;
    if(includeMention && !includeMention(m)){ setSwap(null); return; }
    const cur = lastVal.current||"";
    let changed=false;
    if(m.t!==sw.tok && cur.slice(sw.start, sw.start+sw.tok.length).toLowerCase()===sw.tok.toLowerCase()){
      const next = (cur.slice(0, sw.start)+m.t+cur.slice(sw.start+sw.tok.length)).slice(0, maxLen||1e9);
      lastVal.current = next; renderDom(next);
      onChange && onChange(next, null);
      changed=true;
    }
    // The chosen file can occupy the same ordinal after inclusion (for example,
    // replacing @Image5 with an off base asset that inserts at slot 5). Preserve
    // every word, but still record the director's explicit selection/manual intent.
    if(!changed&&m.included===false&&onChange)onChange(cur,null);
    setSwap(null);
    const el = elRef.current; if(el){ try{ el.focus(); setCaret(sw.start+m.t.length); }catch(_e){} }
  };
  // external value changes (recipe recompiles, chip buttons, insertMention) rebuild the DOM
  React.useEffect(()=>{
    if(value===lastVal.current) return;
    lastVal.current = String(value||"");
    setSwap(null);
    renderDom(lastVal.current);
  },[value]);
  // asset set changed — tokens may (un)resolve; re-chipify, preserving the caret if focused
  const mentionSig = (mentionables||[]).map(m=>
    (m.assetKey||m.key||"")+":"+m.t+":"+(m.included===false?"future":"included")+":"+(m.label||"")+":"+(m.url||"")).join("|");
  React.useEffect(()=>{
    const el = elRef.current; if(!el) return;
    const focused = document.activeElement===el;
    const caret = focused ? caretOffset() : null;
    renderDom(lastVal.current||"");
    if(focused && caret!=null){ el.focus(); setCaret(caret); }
  },[mentionSig]);
  // maxLength guard at the source (native beforeinput — React's synthetic one is unreliable here)
  React.useEffect(()=>{
    const el = elRef.current; if(!el || !maxLen) return;
    const onBI = (e)=>{
      const t = String(e.inputType||"");
      if(t.indexOf("insert")!==0 || t==="insertFromPaste") return;   // paste is pre-sliced
      const ins = (e.data!=null) ? e.data : ((t==="insertLineBreak"||t==="insertParagraph") ? "\n" : "");
      const sel = window.getSelection();
      const selLen = (sel && sel.rangeCount) ? sel.getRangeAt(0).toString().length : 0;
      if(((lastVal.current||"").length - selLen + ins.length) > maxLen) e.preventDefault();
    };
    el.addEventListener("beforeinput", onBI);
    return ()=> el.removeEventListener("beforeinput", onBI);
  },[maxLen]);
  React.useEffect(()=>{
    if(!apiRef) return;
    apiRef.current = {
      caretOffset,
      applyValue:(txt, pos)=>{ lastVal.current = String(txt||""); renderDom(lastVal.current);
        const el = elRef.current; if(el){ try{ el.focus(); if(pos!=null) setCaret(pos); }catch(_e){} } },
      focus:()=>{ try{ elRef.current && elRef.current.focus(); }catch(_e){} },
      el:elRef.current
    };
  });
  const swapItems = swap ? (mentionables||[]).filter(m=>m.kind===swap.kind) : [];
  return _stEl("div",{className:"stage2-gen-prompt-shell"},
    _stEl("div",{ref:elRef, className:"stage2-gen-prompt stage2-gen-prompt-rich",
      contentEditable:true, suppressContentEditableWarning:true, spellCheck:false,
      role:"textbox","aria-multiline":"true","aria-label":placeholder||"Prompt",
      "data-placeholder":placeholder||"",
      onInput:handleInput, onKeyDown:handleKeyDown, onPaste:handlePaste,
      onBlur:(e)=>{ setTimeout(()=>setSwap(null),120); onBlur && onBlur(e); }}),
    swap && swapItems.length>0 && _stEl("div",{className:"stage2-mention-box stage2-swap-box"},
      _stEl("div",{className:"stage2-swap-head"},"Swap "+swap.tok+" →"),
       swapItems.map(m=>_stEl("button",{key:(m.assetKey||m.key||"")+":"+m.t,type:"button",
        className:"stage2-mention-item"+(m.t===swap.tok?" hi":""),
        onMouseDown:e=>{ e.preventDefault(); doSwap(m); }},
        m.kind==="image" && m.url
          ? _stEl("img",{className:"stage2-mention-thumb",src:m.url,alt:""})
          : _stEl("span",{className:"stage2-mention-thumb tile"}, m.kind==="video" ? "▸" : "♪"),
        _stEl("span",{className:"stage2-mention-main"},
          _stEl("b",null,m.t), m.label && _stEl("span",{className:"stage2-mention-label"},m.label)),
        m.t===swap.tok && _stEl("span",{className:"stage2-mention-kind"},"Current")))));
}

/* ---- IMAGE tab of the clip composer ---------------------------------------
   A full frame composer for the ACTIVE SHOT that rides the exact Shots-tab
   pipeline (shotFrameGenOpts in shots-ui.jsx): same prompt builders, coverage-
   seed chain, unified reference plan and seed-lineage meta stamps — a frame
   rendered here is indistinguishable from an Art Room render, and the clip's
   start-frame asset updates the moment it commits. The caller keys this
   component by shot id so the gen hook re-initialises cleanly per shot. */
function StageFrameComposer({ sh, sceneShots, imgCtx, shotNo, onMax }){
  const pack = (typeof shotFrameGenOpts==="function")
    ? shotFrameGenOpts(sh, sceneShots||[], imgCtx) : null;
  const imageChars = Object.values((imgCtx&&imgCtx.charById)||{});
  const imageIds = (typeof inFrameCast==="function")
    ? inFrameCast(sh, imgCtx&&imgCtx.scene, imageChars) : ((sh&&sh.subjects)||[]);
  const imageCast = imageChars.filter(c=>imageIds.some(id=>String(id)===String(c.id)));
  const imageIdentityContext = { characterIds:imageIds, cast:imageCast,
    scenes:(imgCtx&&imgCtx.scenes)||[imgCtx&&imgCtx.scene].filter(Boolean),
    drafts:(imgCtx&&imgCtx.drafts)||{} };
  // the derived prompt is LIVE (follows the shot's action/refs); an edit takes
  // over for this session only — the shot's canon Action is never touched here
  const derived = pack ? (pack.prevShot ? pack.chainPrompt : pack.finalPrompt) : "";
  const [draft, setDraft] = React.useState("");
  const edited = draft.trim()!=="" && draft!==derived;
  const promptText = edited ? draft : derived;
  // resolution/aspect/quality follow the app-wide image settings (same stores
  // the Art Room dock writes) — changing them here changes them everywhere
  const [res, setRes] = React.useState(()=> (typeof nbGetRes==="function") ? nbGetRes() : "");
  const pickRes = (r)=>{ setRes(r); if(typeof nbSetRes==="function"){ try{ nbSetRes(r); }catch(e){} } };
  const resolutions = (window.NB_RESOLUTIONS||[]).map(r=> (r&&r.id)||r).filter(Boolean);
  const [aspect, setAspect] = React.useState(()=> (typeof nbGetAspect==="function") ? nbGetAspect() : "16:9");
  const pickAspect = (a)=>{ setAspect(a); if(typeof nbSetAspect==="function"){ try{ nbSetAspect(a); }catch(e){} } };
  const aspects = window.NB_ASPECTS||[];
  const [modelId, setModelId] = React.useState(()=> (typeof nbGetModel==="function") ? nbGetModel() : "");
  const pickModel = (mid)=>{
    setModelId(mid);
    if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(mid));
    if(typeof nbSetModel==="function"){ try{ nbSetModel(mid); }catch(e){} }
  };
  const modelDef = (window.NB_MODELS||[]).find(m=>m.id===modelId)||{};
  const modelLabel = modelDef.label || "Art Room model";
  const isGpt = modelDef.family==="openai"; // GPT prices by QUALITY on top of K-size
  const [oaiQ, setOaiQ] = React.useState(()=> (typeof nbGetOaiQuality==="function") ? nbGetOaiQuality(modelId) : "medium");
  const pickQ = (q)=>{ setOaiQ(q); if(typeof nbSetOaiQuality==="function"){ try{ nbSetOaiQuality(q,modelId); }catch(e){} } };
  const qualityChoices = (typeof nbOaiQualityChoices==="function")
    ? (nbOaiQualityChoices(modelId)||[]) : [];
  const qualityIsExpanded = isGpt && qualityChoices.indexOf("default")>=0;
  const qualitySupport = (typeof nbImageQualitySupport==="function")
    ? (nbImageQualitySupport(modelId)||{}) : { loading:false, qualities:qualityChoices, expanded:!qualityIsExpanded };
  const [,forceQuality] = React.useState(0);
  const qualityLabel = (q)=> typeof nbOaiQualityLabel==="function" ? nbOaiQualityLabel(q) : q;
  const qualityCanUse = (q)=>{
    if(typeof nbCanUseImageQuality==="function") return !!nbCanUseImageQuality(modelId,q);
    return !qualityIsExpanded || (qualitySupport.qualities||[]).indexOf(q)>=0;
  };
  const refreshQuality = (force)=>{
    if(!qualityIsExpanded || typeof nbRefreshImageQualityCapabilities!=="function") return;
    Promise.resolve(nbRefreshImageQualityCapabilities({force:!!force}))
      .catch(()=>{})
      .then(()=>forceQuality(x=>x+1));
  };
  const qualityNotReady = qualityIsExpanded && (!qualitySupport.expanded || qualitySupport.loading);
  const qualityMessage = qualityNotReady
    ? (qualitySupport.message || (qualitySupport.loading
      ? "Checking GPT Image 2.5 quality availability…"
      : "Extended quality choices are not verified yet."))
    : "";
  React.useEffect(()=>{
    if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(modelId));
    refreshQuality(false);
  },[modelId,qualityIsExpanded]);
  /* OPTIONS capability events arrive independently from the selected model and
     quality; always refresh this component when one does. */
  React.useEffect(()=>{
    const h = ()=>forceQuality(x=>x+1);
    window.addEventListener("nb-quality-capabilities",h);
    return ()=>window.removeEventListener("nb-quality-capabilities",h);
  },[]);
  React.useEffect(()=>{
    const h = ()=>{
      if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(modelId));
    };
    window.addEventListener("nb-settings-changed",h);
    return ()=>window.removeEventListener("nb-settings-changed",h);
  },[modelId]);
  React.useEffect(()=>{
    const h = ()=>{
      const next = typeof nbGetModel==="function" ? nbGetModel() : modelId;
      setModelId(next);
      if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(next));
    };
    window.addEventListener("nb-model-changed",h);
    return ()=>window.removeEventListener("nb-model-changed",h);
  },[modelId]);
  const gen = useImageGen(!pack
    ? { id:"stage-frame-none", slotId:"stage-frame-none", buildFinal:()=>"" }
    : { ...pack.opts,
        /* Stage's shared runner receives the same quality snapshot as the
           Art Room controls.  The runner re-captures synchronously at start,
           so later picker changes cannot rewrite this run's metadata. */
        quality: isGpt ? oaiQ : pack.opts.quality,
        identityCharacterIds:imageIds, identityCast:imageCast, identityContext:imageIdentityContext,
        buildFinal: ()=> edited ? promptText : pack.opts.buildFinal(),
        buildFromBase: ()=> edited ? promptText : pack.opts.buildFromBase(),
        // the "no image" recovery retry must speak the edited prompt too — without
        // this the fallback silently re-renders from the derived shot prompt
        // (review finding 2026-09-03)
        buildSimple: ()=> edited ? promptText : pack.opts.buildSimple(),
        metaStart: async ({gopts}={})=>{
          const base = (typeof pack.opts.metaStart==="function")
            ? await pack.opts.metaStart({gopts}) : {};
          return { ...(base||{}), requestedModel:modelId,
            quality:isGpt ? oaiQ : undefined };
        },
        rebuildPromptAfterAttachments: (resolvedRefs, mode, gopts)=>{
          if(edited) return promptText;
          return (typeof pack.opts.rebuildPromptAfterAttachments==="function")
            ? pack.opts.rebuildPromptAfterAttachments(resolvedRefs, mode, gopts) : undefined;
        } });
  // ONE open dropdown at a time; every bar control is the same pill+menu pattern
  const [menu, setMenu] = React.useState(null);
  const barMenu = (id, pillContent, pillTitle, items)=>
    _stEl("span",{className:"stage2-imgtab-asp"},
      _stEl("button",{type:"button",className:"sdbar-pill"+(menu===id?" open":""),
        title:pillTitle,
        onClick:()=>setMenu(m2=>m2===id?null:id),
        onBlur:()=>setTimeout(()=>setMenu(m2=>m2===id?null:m2),120)},
        pillContent, _stEl("span",{className:"stage2-imgtab-caret"},"▾")),
      menu===id && _stEl("div",{className:"stage2-imgtab-aspmenu"},
        items.map(it=>_stEl("button",{key:it.key,type:"button",
           className:"stage2-imgtab-asp-opt"+(it.on?" on":"")+(it.disabled?" disabled":""),
           disabled:!!it.disabled,"aria-disabled":it.disabled?"true":"false",
          title:it.title,
           onMouseDown:e=>{ e.preventDefault(); if(it.disabled)return; setMenu(null); it.pick(); }},
          it.content))));
  const specs = (pack && pack.renderPlan && pack.renderPlan.orderedSpecs) || [];
  const seedUrl = (pack && pack.prevShot && typeof nbGetImage==="function") ? nbGetImage(pack.prevShot.id) : "";
  const seedNo = (pack && pack.prevShot) ? ((sceneShots||[]).findIndex(x=>x&&x.id===pack.prevShot.id)+1) : 0;
  // Resolve the same reference images the render pipeline will attach, then show
  // them as an ordinary gallery. They are not a separate settings concept: every
  // image in this strip is directly accessible and automatically references the
  // next frame render.
  const [resolvedRefs, setResolvedRefs] = React.useState([]);
  React.useEffect(()=>{
    let live=true;
    if(!pack || !pack.opts || typeof pack.opts.attachments!=="function"){ setResolvedRefs([]); return ()=>{ live=false; }; }
    Promise.resolve(pack.opts.attachments()).then(rs=>{ if(live) setResolvedRefs((rs||[]).filter(r=>r&&r.url)); })
      .catch(()=>{ if(live) setResolvedRefs([]); });
    return ()=>{ live=false; };
  },[sh&&sh.id, specs.map(s=>s&&s.id).join("|")]);
  return _stEl("div",{className:"stage2-imgtab"},
    // Every card is simply an image reference available to this render.
    _stEl("div",{className:"stage2-imgtab-refs"},
      pack && pack.prevShot && seedUrl && _stEl("button",{type:"button",className:"stage2-imgtab-ref seed",
        title:"Reference: Shot "+(seedNo>0?seedNo:"?")+" frame — click to view",
        onClick:()=>{ if(onMax) onMax(seedUrl,"Shot "+(seedNo>0?seedNo:"?")+" reference"); }},
        seedUrl ? _stEl("img",{src:seedUrl,alt:""}) : (Icon.image&&_stEl(Icon.image,{s:14})),
        _stEl("span",null,"Image ref · Shot "+(seedNo>0?seedNo:"?"))),
      resolvedRefs.map((r,i)=>_stEl("button",{key:(r.refId||"ref")+"-"+i,type:"button",className:"stage2-imgtab-ref",
        title:(r.note||("Image reference "+(i+1)))+" — click to view",
        onClick:()=>{ if(onMax) onMax(r.url,r.note||("Image reference "+(i+1))); }},
        _stEl("img",{src:r.url,alt:r.note||("Image reference "+(i+1))}),
        _stEl("span",null,r.note||("Image ref "+(i+1))))),
      gen.genUrl && _stEl("button",{type:"button",className:"stage2-imgtab-ref cur",
        title:"Reference: this shot's current frame — click to view",
        onClick:()=>{ if(onMax) onMax(gen.genUrl, "Shot "+(shotNo||"")+" frame"); }},
        _stEl("img",{src:gen.genUrl,alt:""}),
        _stEl("span",null,"Image ref · Current frame"))),
    _stEl("div",{className:"stage2-imgtab-box"},
      _stEl("textarea",{className:"stage2-imgtab-prompt",value:promptText,
        placeholder:"Describe the frame you want to create…",
        onChange:e=>setDraft(e.target.value)}),
      edited && _stEl("button",{type:"button",className:"stage2-prompt-reset",
        title:"Rebuild this prompt from the shot's action, references and continuity chain — discards manual edits (this render only; the shot's canon Action is never changed)",
        onClick:()=>setDraft("")},"↺ Reset to shot"),
      gen.genErr && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
        _stEl("span",{className:"stage2-warn-text"}, String(gen.genErr))),
      _stEl("div",{className:"sdbar stage2-imgtab-bar"},
        _stEl("div",{className:"sdbar-left"},
          // every control is the same dropdown pill — model, aspect, resolution,
          // and (GPT only) quality; all write the app-wide Art Room settings
          barMenu("model",
            [Icon.image&&_stEl(Icon.image,{key:"i",s:13}), _stEl("span",{key:"t"},modelLabel)],
            "Image model — app-wide setting, shared with the Art Room",
            (window.NB_MODELS||[]).map(m=>({ key:m.id, on:m.id===modelId, title:m.note||m.label,
              pick:()=>pickModel(m.id),
              content:[_stEl("span",{key:"l"},m.label)] }))),
          aspects.length>0 && barMenu("aspect",
            [_stEl("span",{key:"i",className:"sdbar-ratio-ico inline ratio-"+String(aspect).replace(":","x")}),
             _stEl("span",{key:"t"},aspect)],
            "Aspect ratio — the frame's shape (app-wide image setting, shared with the Art Room)",
            aspects.map(a=>({ key:a, on:a===aspect, pick:()=>pickAspect(a),
              content:[_stEl("span",{key:"i",className:"sdbar-ratio-ico inline ratio-"+String(a).replace(":","x")}),
                       _stEl("span",{key:"t"},a)] }))),
          resolutions.length>0 && barMenu("res",
            [_stEl("span",{key:"t"},res||"2K")],
            "Resolution — how large the frame renders",
            resolutions.map(r=>({ key:r, on:r===res, title:"Render at "+r, pick:()=>pickRes(r),
              content:[_stEl("span",{key:"t"},r)] }))),
          isGpt && barMenu("quality",
            [_stEl("span",{key:"t"},qualityLabel(oaiQ))],
            "GPT Image quality — GPT prices by quality on top of size",
            qualityChoices.map(q=>({ key:q, on:q===oaiQ, disabled:!qualityCanUse(q),
              title: qualityCanUse(q) ? qualityLabel(q)
                : ((qualitySupport.message||"Quality is not available yet.")+" Try refreshing."),
              pick:()=>{ if(qualityCanUse(q)) pickQ(q); },
              content:[_stEl("span",{key:"t"},qualityLabel(q)),
                !qualityCanUse(q) && _stEl("span",{key:"state",className:"stage2-imgtab-asp-disabled"},"Unavailable")] }))),
          isGpt && qualityMessage && _stEl("span",{className:"stage2-quality-message"},
            _stEl("span",null,qualityMessage),
            !qualitySupport.loading && _stEl("button",{type:"button",className:"stage2-quality-retry",
             onMouseDown:e=>{ e.preventDefault(); refreshQuality(true); }},"Retry"))),
        _stEl("div",{className:"sdbar-right"},
          typeof window.nbCostChip==="function" && window.nbCostChip(1),
          gen.gening && _stEl("button",{type:"button",className:"sdbar-pill static",
            title:"Stop this render",onClick:()=>{ if(gen.cancelGen) gen.cancelGen(); }},"Stop"),
          _stEl("button",{type:"button",className:"sdbar-send"+(gen.gening?" working":""),disabled:!!gen.gening,
            title: gen.gening ? "Rendering…" : (gen.genUrl ? "Re-render this shot's frame" : "Render this shot's frame"),
            onClick:()=>{ if(!gen.gening) gen.generate(); }}, gen.gening ? "…" : "↑")))));
}

/* ---- SOUND tab — the beat's spoken lines, voiced through ElevenLabs -------
   Every line here renders with the character's LOCKED ElevenLabs voice (designed
   on the character card) — the same audio the lip-sync render rides. */
function StageSoundPanel({ lineShots, auds, onVoiceLine }){
  const [busyId, setBusyId] = React.useState("");
  const rows = lineShots||[];
  const voice = async (sh)=>{
    if(!onVoiceLine || busyId) return;
    setBusyId(sh.id);
    try{ await onVoiceLine(sh); }
    catch(e){ if(window.appToast) window.appToast(String((e&&e.message)||"Voice render failed."),"error"); }
    setBusyId("");
  };
  return _stEl("div",{className:"stage2-sndtab"},
    rows.length ? _stEl("div",{className:"stage2-snd-rows"},
      rows.map(sh=>{
        const ready = _shotAudioReady(sh, auds);
        return _stEl("div",{key:sh.id,className:"stage2-snd-row"+(ready?" ready":"")},
          _stEl("span",{className:"stage2-snd-ico"},Icon.mic&&_stEl(Icon.mic,{s:13})),
          _stEl("div",{className:"stage2-snd-main"},
            (sh.speaker||sh.speakerName) && _stEl("b",null,String(sh.speaker||sh.speakerName)),
            _stEl("span",{className:"stage2-snd-quote"},"\u201c"+String(sh.dialogue||"").trim()+"\u201d")),
          ready
            ? _stEl("span",{className:"stage2-snd-state on",title:"This line has a rendered voice take — it rides the clip's lip-sync render"},"Voiced ✓")
            : _stEl("button",{type:"button",className:"stage2-snd-voice",disabled:!!busyId||!onVoiceLine,
                title:"Render this line with the character's locked ElevenLabs voice",
                onClick:()=>voice(sh)},
                busyId===sh.id ? _stEl("span",{className:"ns-spin"}) : (Icon.sparkles&&_stEl(Icon.sparkles,{s:12})),
                busyId===sh.id ? "Voicing…" : "Voice line"));
      }))
    : _stEl("div",{className:"stage2-tab-empty"},"No spoken lines in this clip — dialogue is written in the Writers' Room; once a shot carries a line it appears here ready to voice."),
    _stEl("div",{className:"stage2-snd-foot"},
      _stEl("span",{className:"stage2-snd-note"},"Voices are designed and locked per character (Art Room → Characters → Voice) and rendered by ElevenLabs."),
      _stEl("a",{className:"stage2-snd-el",href:"https://elevenlabs.io",target:"_blank",rel:"noopener noreferrer",
        title:"Open ElevenLabs — the voice engine behind TURN's dialogue"},"Open ElevenLabs ↗")));
}

function ClipConsole({ clip, selectedShot, sceneClips, ctx, imgs, auds, beatsMap, drafts, prevClipVideoId, aspect, visualSource, setVisualSource, creditBalance, readOnly=false, onVoiceLine, onUpdateShot, onSelectClip, onFirstVideo, onStageNav, modelId, setModelId, clipScope, setClipScope, pendingReuse, onReuseConsumed }){
  const scene = clip.scene, g = clip.g, d = clip.data;
  // the CLIP is the unit of generation — it may bundle 2+ merged shots (Art Room Shots
  // "merge" / Storyboards "Compose from shot frames" / a cropped sheet-half = 1 clip).
  // activeShot is just which of the clip's shots is shown as context/poster, not a
  // separate render target.
  const activeShot = selectedShot || d.first || (d.shots||[])[0] || {};
  const beatVideoId = clip.id;
  const gen = useSeedanceGen(beatVideoId);
  const [takeList, setTakeList] = React.useState(()=> typeof vidGetTakes==="function" ? vidGetTakes(beatVideoId) : []);
  const [activeTakeUrl, setActiveTakeUrl] = React.useState(()=> (typeof vidGetVideo==="function" ? vidGetVideo(beatVideoId) : "") || "");
  // versions actions (approve/notes/restore/delete) change take meta WITHOUT changing
  // the current video url — bump a tick off vid-done so the lists re-read either way
  const [takeTick, setTakeTick] = React.useState(0);
  React.useEffect(()=>{
    const onDone=(e)=>{ if(e.detail&&e.detail.ids&&e.detail.ids.indexOf(beatVideoId)>=0) setTakeTick(t=>t+1); };
    window.addEventListener("vid-done", onDone);
    return ()=>window.removeEventListener("vid-done", onDone);
  }, [beatVideoId]);
  React.useEffect(()=>{ let alive=true;
    const sync = typeof vidGetTakes==="function" ? vidGetTakes(beatVideoId) : [];
    setTakeList(sync);
    setActiveTakeUrl((sync[0]&&sync[0].url) || "");
    if(typeof vidLoadTakes==="function"){
      vidLoadTakes(beatVideoId).then(t=>{ if(alive){ setTakeList(t||[]); setActiveTakeUrl((t&&t[0]&&t[0].url) || ""); } });
    } else if(typeof vidLoadVideo==="function") {
      vidLoadVideo(beatVideoId).then(u=>{ if(alive&&u){ const t=typeof vidGetTakes==="function"?vidGetTakes(beatVideoId):[{id:beatVideoId+":current",url:u,current:true}]; setTakeList(t); setActiveTakeUrl((t[0]&&t[0].url)||u); } });
    }
    return ()=>{ alive=false; };
  }, [beatVideoId, gen.videoUrl, takeTick]);
  const visibleTakes = (takeList&&takeList.length) ? takeList : (gen.videoUrl ? [{ id:beatVideoId+":current", url:gen.videoUrl, meta:(typeof vidGetMeta==="function"?vidGetMeta(beatVideoId):null), current:true }] : []);
  const orderedVisibleTakes = visibleTakes.slice().sort((a,b)=>{
    const am = (a&&a.meta)||{}, bm = (b&&b.meta)||{};
    const at = Number(am.createdAt || a.savedAt || 0);
    const bt = Number(bm.createdAt || b.savedAt || 0);
    if(bt!==at) return bt-at;
    return (b.current?1:0) - (a.current?1:0);
  });
  const sourceStatusOfTake = (t)=> typeof shotSourcesStatus==="function"
    ? shotSourcesStatus(d.shots||[],drafts,(t&&t.meta)||{}) : "unverified";
  const editorialStatusOfTake = (t)=> typeof shotSourcesEditorialStatus==="function"
    ? shotSourcesEditorialStatus(d.shots||[],drafts,(t&&t.meta)||{}) : sourceStatusOfTake(t);
  const approvedVisibleTakes = orderedVisibleTakes.filter(t=>
    ((t&&t.meta)||{}).status==="approved" && ["current","override"].includes(editorialStatusOfTake(t)));
  const playerUrl = activeTakeUrl || (visibleTakes[0]&&visibleTakes[0].url) || gen.videoUrl || "";
  const shotStartFrame = imgs[activeShot.id] || imgs[(d.first||{}).id] || "";
  const storyAssets = storyboardClipAssets(clip, imgs);
  // visual source: Auto follows the researched per-clip rule (stageClipSourcePlan);
  // the Render-settings panel can override it for this clip.
  const sourcePlan = stageClipSourcePlan(clip, imgs);
  const [sourceOverride, setSourceOverride] = React.useState("auto");
  React.useEffect(()=>{ setSourceOverride("auto"); }, [clip.id]);
  const beatOpeningClip=!!sourcePlan.beatOpening;
  const sourceMode = beatOpeningClip ? "frame" : (sourceOverride==="auto" ? sourcePlan.mode : sourceOverride);
  const sourceMeta = STAGE_SOURCE_MODES[sourceMode] || STAGE_SOURCE_MODES.frame;
  const usePanels = sourceMode==="halves" || sourceMode==="sheet";
  const firstStoryHalf = ((storyAssets.halves||[])[0]||{}).url || storyAssets.top || storyAssets.bottom || "";
  const startFrame = sourceMode==="halves" ? (firstStoryHalf || storyAssets.sheet || "")
    : sourceMode==="sheet" ? (storyAssets.sheet || firstStoryHalf || "")
    : (imgs[(d.first||{}).id] || shotStartFrame);
  const prevVideoRaw = prevClipVideoId ? ((typeof vidGetVideo==="function") ? vidGetVideo(prevClipVideoId) : "") : "";
  const prevVideoMeta = prevClipVideoId && typeof vidGetMeta==="function" ? vidGetMeta(prevClipVideoId) : null;
  const prevSourceShots = (typeof shotSourcesFromMeta==="function")
    ? shotSourcesFromMeta(((window.turnContinuity||{}).shots||[]),prevVideoMeta) : [];
  const prevEditorialStatus = prevVideoRaw && typeof shotSourcesEditorialStatus==="function"
    ? shotSourcesEditorialStatus(prevSourceShots,((window.turnContinuity||{}).drafts||{}),prevVideoMeta) : "current";
  const prevVideo = prevVideoRaw && ["current","override"].includes(prevEditorialStatus) ? prevVideoRaw : "";
  const prevVideoSafe = !!(prevVideo && stageVideoRefSafe(prevVideoMeta));
  const [previewId, setPreviewId] = React.useState(activeShot.id || (d.first||{}).id || null);
  React.useEffect(()=>{ setPreviewId(activeShot.id || (d.first||{}).id || null); }, [activeShot.id, clip.id]);
  const previewFrame = usePanels ? startFrame : (imgs[previewId] || startFrame);
  // the clip's own shots — this IS the render unit now, not a same-beatN subset.
  const shownShots = (d.shots||[]).length ? d.shots : [activeShot].filter(Boolean);
  /*
   * promptShots is a render-time, screenplay-derived view built by
   * buildClipData.  It carries the current authored action into every prompt
   * style and timed-plan route, while shownShots remains the canonical shot
   * list used for references, persistence and source freshness checks.
   */
  const promptShots = (d.promptShots||[]).length ? d.promptShots : shownShots;
  const promptActiveShot = promptShots.find(sh=>sh&&sh.id===activeShot.id) || promptShots[0] || activeShot;
  const screenplayContext = {...ctx, drafts, beatsMap};
  const screenplayReference = typeof window.stageScreenplayReference==="function"
    ? window.stageScreenplayReference(scene,shownShots,screenplayContext)
    : {hasSource:false,errors:["Scene screenplay is unavailable. Reload Stage before rendering."],signature:"missing"};
  const sourceScreenplayIssue = !screenplayReference.hasSource || (screenplayReference.errors||[]).length
    ? (screenplayReference.errors||[])[0] || "Write this scene's screenplay in the Writers' Room before rendering."
    : "";
  const directionIssue=(d.screenplayDirectionIssues||[]).find(x=>x&&x.blocking);
  const screenplayIssue=sourceScreenplayIssue || (directionIssue&&directionIssue.message) || "";
  const scopeInstruction=stageRenderScopeInstruction(clipScope,clip,shownShots,promptShots,d.panelLines||[]);
  /*
   * The public screenplay reference remains the immutable contract sent to the
   * transport worker.  This render-local clone lets the human-facing queued
   * block state the selected shot/part boundary without changing source text,
   * target beats, or canonical storage.
   */
  const screenplayPromptReference=screenplayReference&&typeof screenplayReference==="object"
    ? {...screenplayReference,renderScope:{instruction:scopeInstruction}} : screenplayReference;
  const screenplayCurrentRef = React.useRef(null);
  screenplayCurrentRef.current = {clipId:clip.id,scene,shots:shownShots,ctx:screenplayContext,
    fromLiveDrafts:drafts===(window.turnContinuity||{}).drafts};
  const screenplayMountedRef = React.useRef(true);
  React.useEffect(()=>{ screenplayMountedRef.current=true; return ()=>{ screenplayMountedRef.current=false; }; },[]);
  const assertScreenplayCurrent = ()=>{
    if(screenplayIssue) throw new Error(screenplayIssue);
    const current=screenplayCurrentRef.current;
    if(!screenplayMountedRef.current || !current || current.clipId!==clip.id)
      throw new Error("The selected beat changed. Review its screenplay before rendering.");
    const liveContext=current.fromLiveDrafts
      ? {...current.ctx,drafts:(window.turnContinuity||{}).drafts||{}} : current.ctx;
    const fresh=window.stageScreenplayReference(current.scene,current.shots,liveContext);
    if(!fresh.hasSource || fresh.signature!==screenplayReference.signature)
      throw new Error("The scene screenplay changed while preparing this video. Review the updated reference and prompt before rendering.");
  };
  const referencePackage = (typeof window.stageShotReferencePackage==="function")
    ? window.stageShotReferencePackage(shownShots,{ ...ctx,scene,images:imgs,drafts,
        availableImageIds:new Set(Object.keys(imgs||{})) })
    : {characters:[],locations:[],props:[],warnings:[],signature:""};
  /* The clip prompt/reference package is the authoritative cast for this
     generation.  Carry that exact cast into every Seedance attempt so a stale
     global cast cannot reject an unrelated project. */
  const sourceCastIds = shownShots.flatMap(sh=>{
    const src=stageBeatSource(scene,sh,{drafts,beatsMap,characters:ctx.characters||[]});
    return src&&src.hasSource ? (src.openingCharacterIds||[]) : (sh&&sh.subjects||[]);
  });
  const identityIds = Array.from(new Set([]
    .concat((referencePackage.characters||[]).map(r=>r&&r.entityId))
    .concat(sourceCastIds)
    .filter(Boolean)));
  const identityCast = (ctx.characters||[]).filter(c=>identityIds.indexOf(c.id)>=0);
  const identityContext = { characterIds:identityIds, scenes:ctx.scenes||[scene],
    drafts, cast:identityCast };
  const identityPrompt = identityCast.length && typeof window.turnIdentityPrompt==="function"
    ? String(window.turnIdentityPrompt(identityCast)||"").trim() : "";
  const assertStageIdentityAssets = ()=>{
    if(typeof window.nbAssertIdentityAssetFresh!=="function") return;
    (referencePackage.characters||[]).forEach(r=>{
      const c=identityCast.find(x=>x&&String(x.id)===String(r&&r.entityId));
      if(c && r&&r.assetId) window.nbAssertIdentityAssetFresh(r.assetId,c,identityContext);
    });
  };
  const beatLabel = clip.label;
  const beatName = clipBeatName(clip, beatsMap, drafts);
  const referenceWarningContext=(w)=>{
    const sh=shownShots.find(x=>String(x&&x.id||"")===String(w&&w.shotId||""));
    const shotN=Math.max(0,shownShots.indexOf(sh))+1;
    const shotLabel=sh&&String(sh.title||sh.name||sh.slug||sh.action||"").trim();
    const descriptors=[].concat(referencePackage.characters||[],referencePackage.locations||[],referencePackage.props||[]);
    const desc=descriptors.find(x=>String(x&&x.assetId||"")===String(w&&w.imageId||""));
    const entities=[].concat((ctx&&ctx.characters)||[],(ctx&&ctx.locations)||[],(ctx&&ctx.props)||[]);
    const entity=entities.find(x=>desc&&String(x&&x.id||"")===String(desc.entityId||desc.baseId||""));
    const assetLabel=(entity&&String(entity.name||entity.label||entity.title||"").trim())
      ||(desc&&String(desc.label||desc.name||"").trim())||String(w&&w.imageId||"reference asset");
    return {w,sh,shotN,shotLabel,desc,entity,assetLabel};
  };
  const rawReferenceWarnings=referencePackage.warnings||[];
  // stageReferenceStatus names absent bytes as a reason as well as the package's
  // explicit missing-reference issue. Keep one actionable issue, not two rows per
  // asset per shot.
  const explicitMissingKeys=new Set(rawReferenceWarnings
    .filter(w=>w&&w.code==="missing-reference")
    .map(w=>String(w.shotId||"")+"|"+String(w.imageId||"")));
  const referenceWarningRows=rawReferenceWarnings.filter(w=>{
    if(!w||w.code!=="review-required") return true;
    const redundant=/reference image is missing or has not finished loading/i.test(String(w.message||""));
    return !(redundant&&explicitMissingKeys.has(String(w.shotId||"")+"|"+String(w.imageId||"")));
  }).map(w=>{
    const {shotN,desc,entity,assetLabel}=referenceWarningContext(w);
    let message;
    if(desc&&desc.kind==="character"&&desc.stateId&&w&&w.severity==="error"){
      const states=(entity&&entity.states)||[];
      const state=states.find(s=>s.id===desc.stateId);
      const version=state?states.indexOf(state)+2:"?";
      const stateLabel=(state&&state.label)||"Unnamed appearance state";
      message="Required appearance “"+assetLabel+" · "+stateLabel+" (v"+version+")” is unavailable. "
        +"Load, generate, or import that state in Art Room → Characters → "+assetLabel+" → Continuity · appearance states, "
        +"or choose “Use master for this shot” beneath the reference tiles";
    }else{
      message=String(w&&w.message||"Required reference is unavailable")+" — "+assetLabel;
    }
    return {groupKey:[w.severity||"warning",w.imageId||"",w.code||"",message].join("|"),
      message,blocking:w.severity==="error",shotN};
  });
  const referenceWarningGroups=stageGroupReferenceIssues(referenceWarningRows);
  const referenceBlockingWarnings=referenceWarningGroups.filter(w=>w&&w.blocking);
  const referenceBlockMessage=referenceBlockingWarnings.map(w=>w.message).join(" ");
  const clipsInScene = (sceneClips&&sceneClips.length) ? sceneClips : [clip];
  /* the filmstrip reads vidGetVideo SYNCHRONOUSLY from the in-memory cache — only the
     clip loaded in the player ever gets vidLoadVideo'd, so takes rendered in earlier
     sessions never became cards. Preload every scene clip's stored video (IndexedDB /
     cloud) and re-read the strip when one lands, or when vid-done fires for ANY scene
     clip (background recovery, a Versions action on another clip). */
  const [stripTick, setStripTick] = React.useState(0);
  const clipIdsKey = (clipsInScene||[]).map(c=>c&&c.id).join("|");
  React.useEffect(()=>{ let alive=true;
    if(typeof vidLoadVideo==="function"){
      (clipsInScene||[]).forEach(c=>{
        if(!c||!c.id||((typeof vidGetVideo==="function")&&vidGetVideo(c.id))) return;
        vidLoadVideo(c.id).then(u=>{ if(alive&&u) setStripTick(t=>t+1); });
      });
    }
    const onDone=(e)=>{ const ids=(e&&e.detail&&e.detail.ids)||[];
      if(ids.some(id=>(clipsInScene||[]).some(c=>c&&c.id===id))) setStripTick(t=>t+1); };
    window.addEventListener("vid-done", onDone);
    return ()=>{ alive=false; window.removeEventListener("vid-done", onDone); };
  }, [clipIdsKey]);   // stripTick re-runs the strip's vidGetVideo scan below

  // ---- the derived INPUT ASSETS (tagged, toggleable), capped to Seedance's 12 ----
  /* DIALOGUE AUDIO MODE (per clip): "locked" = lip-sync to the ElevenLabs line audio
     (refs attached, duration locked to speech + air); "native" = let the model ACT the
     lines itself — no audio refs, free pacing, and the voices get swapped to the locked
     ones in post (ElevenLabs Voice Changer keeps the performance, changes the timbre). */
  const [dialogueAudio, setDialogueAudio] = React.useState("locked");
  const assets = React.useMemo(()=>{
    // model shape decides WHAT can ride: a Sora-class engine takes one start image
    // only, so identity/prop/location/video refs never appear as inputs, and audio
    // lines appear only when they'd really attach (locked voice mode on a refs model)
    const _m = seedanceModelOf(modelId);
    const _mRefs = _m.refs!==false, _mAud = _m.audioRefs!==false;
    const out = [];
    out.push({ key:"text", kind:"text", label:"Prompt", ready:true, locked:true });
    if(sourceMode==="halves"){
      const hs = (storyAssets.halves&&storyAssets.halves.length) ? storyAssets.halves : [
        storyAssets.top && { id:storyAssets.ids&&storyAssets.ids.legacyTop, url:storyAssets.top },
        storyAssets.bottom && { id:storyAssets.ids&&storyAssets.ids.legacyBottom, url:storyAssets.bottom },
      ].filter(Boolean);
      hs.forEach((h,i)=>out.push({ key:"sb-half-"+i, kind:"image", label:"Storyboard "+(i+1)+" / "+hs.length+" for this clip", url:h.url, ready:true, locked:true, id:h.id,
        assetRole:"derived_reference", assetSourceQuality:"storyboard_half_full_frame" }));
      if(!hs.length) out.push({ key:"sb-missing", kind:"image", label:"Storyboard halves", ready:false, locked:true });
    } else if(sourceMode==="sheet"){
      if(storyAssets.sheet) out.push({ key:"sb-sheet", kind:"image", label:"Full storyboard sheet", url:storyAssets.sheet, ready:true, locked:true, id:storyAssets.ids&&storyAssets.ids.sheet,
        assetRole:"derived_reference", assetSourceQuality:"storyboard_sheet_full_frame" });
      else out.push({ key:"sb-missing", kind:"image", label:"Storyboard sheet", ready:false, locked:true });
    } else if(sourceMode==="frames"){
      // per-shot frames: each merged shot's frame anchors its own moment in the clip —
      // the first is the start frame; ALL are deselectable (excluding the start frame
      // renders the clip from the prompt + remaining references, no image anchor).
      // A one-image model (Sora) takes only the first frame, so only that one shows.
      (d.shots||[]).slice(0, _mRefs ? undefined : 1).forEach((sh,i)=>{ const u=imgs[sh.id];
        out.push({ key:i===0?"frame":("shotframe:"+sh.id), kind:"image",
          label:"Shot "+(i+1)+" frame", url:u, ready:!!u, id:sh.id,
          assetRole:"shot_anchor", assetSourceQuality:"shot_frame_full_frame" }); });
    } else {
      const firstFrame = imgs[(d.first||{}).id] || shotStartFrame;
      // deselectable: excluding the start frame renders from the prompt + references
      // alone (no image anchor) — the user's call, e.g. to escape a bad frame's pull
      if(firstFrame) out.push({ key:"frame", kind:"image", label:(d.cast[0]?d.cast[0].name+" — shot frame":"Shot start frame"), url:firstFrame, ready:true, id:(d.first||{}).id||activeShot.id,
        assetRole:"shot_anchor", assetSourceQuality:"shot_frame_full_frame" });
      else out.push({ key:"frame-missing", kind:"image", label:"Shot start frame", ready:false, locked:true });
    }
    if(_mRefs){
      // Active character/location/prop rows come exclusively from the authoritative
      // shot reference package below. Legacy d.cast/d.loc/d.props masters remain
      // available only through the scene-wide, opt-in palette; they must never
      // silently replace a missing active appearance/coverage/state variant.
      // SCENE-WIDE references (user ruling 2026-08-07): the rest of this scene's cast
      // and props — from the OTHER clips' derivations — are offerable too, so the user
      // decides when to combine elements into their own shots. They default OFF
      // (sceneOnly → the extraOn set) and ride the same include/exclude machinery;
      // @mentioning one in a prompt box auto-includes it.
      const _seen = new Set(out.map(a=>a.key));
      (sceneClips||[]).forEach(c2=>{
        const dd = (c2&&c2.data)||{};
        (dd.cast||[]).forEach(c=>{ const k="c:"+c.id; if(_seen.has(k)) return; _seen.add(k);
          const u=imgs[c.id];
          out.push({ key:k, kind:"image", label:c.name+" · Master reference", url:u, ready:!!u, id:c.id, sceneOnly:true,
            entityId:c.id,referenceKind:"character",
            assetRole:"master_reference", assetSourceQuality:"character_master_sheet" }); });
        (dd.props||[]).forEach(p=>{ const k="p:"+p.id; if(_seen.has(k)) return; _seen.add(k);
          const sid = p.sheetId || p.id, u = imgs[sid];
          const plab = p.name+(p.stateLabel?(" \u2014 "+p.stateLabel):"")+(p.holder?(" \u00b7 "+(p.kind==="worn"?"worn by ":"carried by ")+p.holder):"");
          out.push({ key:k, kind:"image", label:plab+(sid===p.id?" · Master reference":" · Continuity state"), url:u||"", ready:!!u, id:sid, sceneOnly:true,
            entityId:p.id,referenceKind:"prop",
            assetRole:sid===p.id?"master_reference":"derived_reference",
            assetSourceQuality:sid===p.id?"prop_master_sheet":"prop_state_sheet" }); });
      });
      // The previous clip stays beat/clip-scoped continuity: it attaches only when
      // this selected beat really follows a rendered clip.
      if(prevVideoSafe) out.push({ key:"prev", kind:"video", label:"Previous clip (continuity)", url:prevVideo, ready:true,
        assetRole:"final_take", assetSourceQuality:"approved_or_current_video_take" });
    }
    // every dialogue line IN THE CLIP (not just the previewed shot) is a candidate lip-sync
    // audio reference — a merged multi-shot clip needs all of its speakers' lines.
    // Only in LOCKED mode on a refs-capable model — and DESELECTABLE (not locked): a
    // user can drop a line's audio and let the model play that moment natively.
    if(_mAud && dialogueAudio==="locked") (d.lineShots||[]).forEach((sh,i)=>{
      const u=auds[sh.id];
      const p = (d.panelLines||[]).find(x=>x.shotId===sh.id);
      const speaker = (p&&p.speaker&&p.speaker.name) || (sh.lineAudio&&sh.lineAudio.speaker) || "Line";
      // an unvoiced dialogue line is a MISSING ingredient, not an absent one — the
      // package must show it or the user only learns at lip-sync time
      out.push({ key:"a:"+sh.id, kind:"audio", label:speaker+" line", url:u||"", ready:!!u, shotId:sh.id });
    });

    /* The automatic package above stays CLIP-precise. The @ picker also needs the
       wider scene palette so a director can deliberately bring an off-camera actor,
       prop, alternate location plate, shot frame or recorded line into this render.
       These rows are sceneOnly: ready assets are discoverable but OFF until chosen. */
    const present = new Set(out.map(a=>a.kind+":"+(a.id||a.shotId||a.key)));
    const addSceneAsset = (a)=>{
      if(!a || !a.ready) return;
      const sig = a.kind+":"+(a.id||a.shotId||a.key);
      if(present.has(sig)) return;
      present.add(sig);
      out.push({ ...a, sceneOnly:true });
    };
    const sceneShots = [];
    const seenShots = new Set();
    (sceneClips||[]).forEach(sc=>((sc&&sc.data&&sc.data.shots)||[]).forEach(sh=>{
      if(sh&&sh.id&&!seenShots.has(sh.id)){ seenShots.add(sh.id); sceneShots.push(sh); }
    }));
    if(_mRefs){
      const rosterIds = (typeof sceneRoster==="function")
        ? sceneRoster(scene, ctx.characters||[], ctx.drafts||{}, sceneShots)
        : _uniq(sceneShots.flatMap(sh=>sh.subjects||[]));
      const rosterSet = new Set(rosterIds);
      rosterIds.forEach(id=>{ const c=(ctx.charById||{})[id]; const u=imgs[id];
        if(c&&u) addSceneAsset({ key:"c:"+id, kind:"image", group:"Characters", label:(c.name||"Character")+" · Master reference", url:u, ready:true, id,
          entityId:id,referenceKind:"character",
          assetRole:"master_reference", assetSourceQuality:"character_master_sheet" });
      });

      const scenePropIds = new Set();
      (sceneClips||[]).forEach(sc=>((sc&&sc.data&&sc.data.props)||[]).forEach(p=>p&&p.id&&scenePropIds.add(p.id)));
      (ctx.props||[]).forEach(p=>{
        if(!p||!p.id) return;
        const rs=(typeof propStateAt==="function") ? propStateAt(p,scene.id,activeShot&&activeShot.beatN,activeShot&&activeShot.microBeatId,activeShot&&activeShot.id,ctx) : null;
        if((rs&&rs.active) || (!rs&&((Array.isArray(p.scenes)&&p.scenes.indexOf(scene.id)>=0) || (p.ownerId&&rosterSet.has(p.ownerId))))) scenePropIds.add(p.id);
      });
      scenePropIds.forEach(id=>{
        const p=(ctx.propById||{})[id]; if(!p) return;
        const rs=(typeof propStateAt==="function") ? propStateAt(p,scene.id,activeShot&&activeShot.beatN,activeShot&&activeShot.microBeatId,activeShot&&activeShot.id,ctx) : null;
        if(rs && !rs.active) return;
        const so=(typeof shotPropSheetId==="function") ? shotPropSheetId(p,scene,ctx.scenes||[],activeShot&&activeShot.beatN,activeShot&&activeShot.microBeatId,activeShot&&activeShot.id,ctx) : {id:p.id,state:null};
        const co=(typeof custodyOwnerAt==="function") ? custodyOwnerAt(p,scene,ctx.scenes||[]) : {name:p.ownerName||""};
        const sid=so.id||p.id, u=imgs[sid];
        if(u) addSceneAsset({ key:"p:"+p.id, kind:"image", group:"Props", label:(p.name||"Prop")
            +(so.state&&so.state.label?(" — "+so.state.label):"")
            +((rs&&rs.holderName)||co.name?(" · "+(((rs&&rs.bindingMode)||p.kind||"")==="worn"?"worn by ":"carried by ")+((rs&&rs.holderName)||co.name)):"")
            +(rs&&rs.placement&&rs.placement.locationId?(" · placed in "+(((ctx.locations||[]).find(l=>l.id===rs.placement.locationId)||{}).name||"location")):"")
            +(sid===p.id?" · Master reference":" · Continuity state"),
          url:u, ready:true, id:sid, entityId:p.id,referenceKind:"prop",assetRole:sid===p.id?"master_reference":"derived_reference",
          assetSourceQuality:sid===p.id?"prop_master_sheet":"prop_state_sheet" });
      });

      const loc=(typeof locationForScene==="function") ? locationForScene(ctx.locations||[],scene.id) : d.loc;
      if(loc){ const u=imgs[loc.id];
        if(u) addSceneAsset({ key:"scene-loc:"+loc.id, kind:"image", group:"Locations", label:(loc.name||"Location")+" · Master reference", url:u, ready:true, id:loc.id,
          entityId:loc.id,referenceKind:"location",
          assetRole:"master_reference", assetSourceQuality:"location_master_plate" });
      }
      (sceneClips||[]).forEach(sc=>{ const ls=sc&&sc.data&&sc.data.locSheet; if(!ls||!ls.id) return; const u=imgs[ls.id];
        if(u) addSceneAsset({ key:"scene-loc:"+ls.id, kind:"image", group:"Locations", label:(ls.name||"Location")+(ls.role?(" · "+ls.role):"")+" coverage sheet", url:u, ready:true, id:ls.id,
          entityId:(sc&&sc.data&&sc.data.loc&&sc.data.loc.id)||ls.id,referenceKind:"location",
          assetRole:"derived_reference", assetSourceQuality:"location_coverage_full_frame" });
      });
      sceneShots.forEach((sh,i)=>{ const u=imgs[sh.id];
        if(u) addSceneAsset({ key:"scene-shotframe:"+sh.id, kind:"image", group:"Shot frames", label:"Scene shot "+(i+1)+" frame", url:u, ready:true, id:sh.id,
          assetRole:"shot_anchor", assetSourceQuality:"shot_frame_full_frame" });
      });
    }
    if(_mAud) sceneShots.forEach(sh=>{
      if(!String(sh&&sh.dialogue||"").trim()) return;
      const u=auds[sh.id]; if(!u) return;
      const exact=stageShotDialogueLine(scene,ctx.drafts,sh,ctx);
      const speaker=(exact&&exact.speaker) || (sh.lineAudio&&sh.lineAudio.speaker) || "Character";
      addSceneAsset({ key:"a:"+sh.id, kind:"audio", group:"Voices", label:speaker+" voice · "+_firstWords((exact&&exact.text)||sh.dialogue,6), url:u, ready:true, shotId:sh.id });
    });
    if(_mRefs&&referencePackage){
      const seenIds=new Set(out.filter(a=>a&&!a.sceneOnly).map(a=>a&&a.id).filter(Boolean));
      const addRequired=(r,referenceKind,label)=>{
        const id=r&&r.assetId;if(!id||seenIds.has(id))return;seenIds.add(id);
        const u=imgs[id]||"";
        const group=referenceKind==="character"?"Characters":referenceKind==="location"?"Locations":"Props";
        const resolved={key:"resolved:"+group.toLowerCase()+":"+id,kind:"image",group,label,url:u,
          ready:!!u,id,assetRole:(r.roles||[])[0]||"derived_reference",
          assetSourceQuality:"shot_resolved_reference",referenceSnapshot:r.snapshot,requiredByShots:r.shotIds,
          entityId:r.entityId||r.baseId,referenceKind,stateId:r.stateId||"",referenceResolved:true};
        // If the same master was already offered in the scene-only palette, replace
        // that row with the authoritative active descriptor rather than duplicating
        // it or leaving the required input default-off.
        const sceneIdx=out.findIndex(a=>a&&a.sceneOnly&&a.kind==="image"&&a.id===id);
        if(sceneIdx>=0) out[sceneIdx]=resolved; else out.push(resolved);
      };
      (referencePackage.characters||[]).forEach(r=>{ const c=(ctx.charById||{})[r.entityId]||{};
        const states=c.states||[],state=states.find(s=>s.id===r.stateId),version=state?states.indexOf(state)+2:1;
        addRequired(r,"character",state
          ?((c.name||"Character")+" · Appearance: "+(state.label||"Unnamed state")+" (v"+version+")")
          :((c.name||"Character")+" · Master reference")); });
      (referencePackage.locations||[]).forEach(r=>{ const l=(ctx.locations||[]).find(x=>x.id===r.entityId)||{};
        addRequired(r,"location",(l.name||"Location")+" · Shot coverage"); });
      (referencePackage.props||[]).forEach(r=>{ const p=(ctx.propById||{})[r.entityId]||{};
        addRequired(r,"prop",(p.name||"Prop")+(r.stateId?" · Continuity state":" · Master reference")); });
    }
    return out;
  }, [clip.id, activeShot.id, sourceMode, dialogueAudio, modelId, referencePackage.signature, shotStartFrame, JSON.stringify((storyAssets.halves||[]).map(h=>h.id+":"+!!h.url)), storyAssets.top, storyAssets.bottom, storyAssets.sheet, prevVideo, prevVideoSafe, JSON.stringify(prevVideoMeta||{}), JSON.stringify(d.cast), JSON.stringify(d.props), d.loc&&d.loc.id, d.locSheet&&d.locSheet.id, JSON.stringify((sceneClips||[]).map(sc=>{ const dd=(sc&&sc.data)||{}; return (sc&&sc.id||"")+"|"+(dd.cast||[]).map(x=>x.id).join(",")+"|"+(dd.props||[]).map(x=>x.id+":"+(x.sheetId||"")).join(",")+"|"+(dd.shots||[]).map(x=>x.id+":"+(x.dialogue||"")).join(",")+"|"+((dd.locSheet&&dd.locSheet.id)||""); })), imgs, auds]);

  // assets default ON when ready; user can toggle (off set). @tags number the INCLUDED
  // assets only — attachment order is what fal sees, so excluding @Image2 must renumber
  // the rest or every later label points at the wrong file.
  const [off, setOff] = React.useState(()=>new Set());
  // scene-wide references default OFF (not in this clip's frame) — ticking one adds it
  // to extraOn; clip-derived references keep the include-by-default off-set. Both are
  // id-keyed, so choices carry sensibly across clips of the same scene.
  const [extraOn, setExtraOn] = React.useState(()=>new Set());
  const [imgFail, setImgFail] = React.useState(()=>new Set());   // "key|url" pairs whose image failed to load — keyed BY URL so a regenerated/refreshed image (new URL) automatically retries instead of staying stuck on the placeholder
  const imgFailed = (a)=> imgFail.has(a.key+"|"+(a.url||""));
  // One transparent asset-id rehydrate repairs an expired signed URL or revoked
  // blob URL. Remember both URLs so a genuinely bad asset cannot retry-loop; a
  // later regenerated URL is different and is eligible for its own recovery.
  const imgRepairRef = React.useRef(new Map());
  const noteImgFail = (a)=>{
    const k=a.key+"|"+(a.url||"");
    setImgFail(s=>{ if(s.has(k)) return s; const n=new Set(s); n.add(k); return n; });
    if(!a.id || typeof nbRefreshImage!=="function") return;
    const prior=imgRepairRef.current.get(a.id);
    if(prior && (prior.failedUrl===a.url || prior.replacementUrl===a.url)) return;
    const rec={failedUrl:a.url||"",replacementUrl:""};
    imgRepairRef.current.set(a.id,rec);
    nbRefreshImage(a.id,a.url).then(u=>{
      rec.replacementUrl=u||"";
      // Re-test even if the refreshed signed URL string is unchanged: the first
      // load failure may have been transient. A second failure stays visible.
      if(u) setImgFail(s=>{ if(!s.has(k)) return s; const n=new Set(s); n.delete(k); return n; });
    }).catch(()=>{});
  };
  const on = (a)=> a.ready && (a.sceneOnly ? extraOn.has(a.key) : !off.has(a.key));
  const tagged = React.useMemo(()=>{
    const n={text:0,image:0,video:0,audio:0}, tags={};
    // Scene-only choices append in the order the director chose them. Adding another
    // scene asset therefore never renumbers an earlier hand-inserted @ token.
    const base=assets.filter(a=>!a.sceneOnly&&on(a));
    const extras=Array.from(extraOn).map(k=>assets.find(a=>a.sceneOnly&&a.key===k)).filter(a=>a&&on(a));
    base.concat(extras).forEach(a=>{ n[a.kind]++; tags[a.key]="@"+a.kind+n[a.kind]; });
    return assets.map(a=>({ ...a, tag:tags[a.key]||"" }));
  }, [assets, off, extraOn]);
  const toggle = (a)=>{ if(a.locked||!a.ready) return;
    const set = a.sceneOnly ? setExtraOn : setOff;
    set(s=>{ const n=new Set(s); n.has(a.key)?n.delete(a.key):n.add(a.key); return n; }); };
  // A mention/attachment is not a continuity decision. Only this explicit, persisted
  // shot-local choice replaces the scene appearance for VIDEO; Art Room is untouched.
  const characterReferenceChoices=shownShots.flatMap((sh,i)=>{
    const rows=(referencePackage.characters||[]).filter(r=>(r.shotIds||[]).includes(String(sh.id)));
    // Keep reset available even if the chosen master later becomes private/missing
    // or an old override is invalid and so has no usable package descriptor.
    Object.keys(sh.stageCharacterReferenceOverrides||{}).forEach(id=>{
      if(!rows.some(r=>r.entityId===id))rows.push({entityId:id});
    });
    return rows.map(r=>{
      const c=(ctx.charById||{})[r.entityId]||(ctx.characters||[]).find(c=>c.id===r.entityId);
      if(!c)return null;
      const hasOverride=Object.prototype.hasOwnProperty.call(sh.stageCharacterReferenceOverrides||{},c.id);
      const master=hasOverride&&(sh.stageCharacterReferenceOverrides||{})[c.id]==="master";
      if(!r.stateId&&!hasOverride)return null;
      const state=(c.states||[]).find(s=>s.id===r.stateId);
      const status=typeof window.stageReferenceStatus==="function"
        ?window.stageReferenceStatus({imageId:c.id},{...ctx,images:imgs}):null;
      return {sh,c,master,hasOverride,shotN:i+1,stateLabel:state
        ?(state.label||"Unnamed appearance")+" (v"+((c.states||[]).indexOf(state)+2)+")"
        :"Scene appearance",masterReady:!!imgs[c.id]&&!!status&&!status.missing&&!status.excluded};
    }).filter(Boolean);
  });
  const setCharacterReferenceChoice=(row)=>{
    if(readOnly||!onUpdateShot||gening||(!row.hasOverride&&!row.masterReady))return;
    const next={...(row.sh.stageCharacterReferenceOverrides||{})};
    if(row.hasOverride)delete next[row.c.id];else next[row.c.id]="master";
    // A formerly excluded master must attach when the director explicitly chooses it.
    if(!row.hasOverride)setOff(prev=>{const n=new Set(prev);n.delete("resolved:characters:"+row.c.id);return n;});
    onUpdateShot(row.sh.id,{stageCharacterReferenceOverrides:next});
  };
  const assetState = (a)=> !a.ready ? "missing" : a.locked ? "required" : on(a) ? "included" : "excluded";
  const assetStateLabel = (a)=> assetState(a)==="required" ? "Required" : assetState(a)==="included" ? "Included" : assetState(a)==="excluded" ? "Excluded" : "Missing";
  const assetTitle = (a)=>{
    const st = assetState(a), base = a.label+(a.tag?(" · "+a.tag):"")+(a.id?(" · Asset ID "+a.id):"");
    if(st==="required") return base+" · required for this render";
    if(st==="included") return base+" · included, click to exclude";
    if(st==="excluded") return base+" · excluded, click to include";
    return base+" · missing; generate this source asset first";
  };
  const tagOrder = (a)=>Number((String(a&&a.tag||"").match(/\d+$/)||[9999])[0]);
  const onImages = tagged.filter(a=>a.kind==="image" && on(a)).sort((a,b)=>tagOrder(a)-tagOrder(b));
  const onVideos = tagged.filter(a=>a.kind==="video" && on(a)).sort((a,b)=>tagOrder(a)-tagOrder(b));
  const onAudios = tagged.filter(a=>a.kind==="audio" && on(a)).sort((a,b)=>tagOrder(a)-tagOrder(b));
  // the line-audio files that will REALLY attach (order = @AudioN order) — the recipes
  // number their lip-sync tags from this, so a deselected line drops out consistently
  const audioIncluded = onAudios.map(a=>a.shotId).filter(Boolean);
  // CHARACTER-level voice groups — the Voices tray adds/removes a speaker's WHOLE
  // voice as a reference in one click (a merged clip can scatter one character's
  // lines across shots). Same speaker resolution as the audio chips above; the
  // per-line toggles stay in the References tray, and both write the same `off`
  // set so the @Audio numbering never disagrees between them.
  const voiceGroups = React.useMemo(()=>{
    const g = [], seen = {};
    (d.lineShots||[]).forEach(sh=>{
      const p = (d.panelLines||[]).find(x=>x.shotId===sh.id);
      const name = (p&&p.speaker&&p.speaker.name) || (sh.lineAudio&&sh.lineAudio.speaker) || "Line";
      if(!seen[name]){ seen[name]={ name, shots:[] }; g.push(seen[name]); }
      seen[name].shots.push(sh);
    });
    return g;
  }, [clip.id, JSON.stringify((d.lineShots||[]).map(s=>s.id+":"+((s.lineAudio&&s.lineAudio.speaker)||""))), JSON.stringify(d.panelLines)]);
  const voiceCharState = (g)=>{
    const voiced = g.shots.filter(sh=>_shotAudioReady(sh, auds));
    if(!voiced.length) return "missing";
    const inc = voiced.filter(sh=>!off.has("a:"+sh.id)).length;
    return inc===voiced.length ? "included" : inc===0 ? "excluded" : "mixed";
  };
  // any line on → remove them all; none on → add them all
  const toggleVoice = (g)=> setOff(s=>{
    const n = new Set(s);
    const keys = g.shots.filter(sh=>_shotAudioReady(sh, auds)).map(sh=>"a:"+sh.id);
    const anyOn = keys.some(k=>!n.has(k));
    keys.forEach(k=>{ anyOn ? n.add(k) : n.delete(k); });
    return n;
  });
  const onAssets = tagged.filter(on);
  const promptRefAssets = tagged.filter(a=>a.kind!=="text" && on(a));
  const promptRefs = stagePromptMentionContext(promptRefAssets, d);
  const promptRefSig = promptRefAssets.map(a=>a.key+":"+stageAssetMention(a)).join("|");
  // NB: `model` is only declared further below — resolve from modelId here instead
  const assetLimit = seedanceModelOf(modelId).maxAssets || 12;   // Seedance 2.5 raises the input budget to 50
  // Provider budgets count uploaded files only; the screenplay/script text is a
  // prompt field, not a multimodal reference slot.
  const budgetUsed = stageReferenceFileCount(tagged,on);
  const assetOver = budgetUsed > assetLimit;
  const budgetOverBy = Math.max(0, budgetUsed-assetLimit);
  const budgetLeft = Math.max(0, assetLimit-budgetUsed);
  const budgetPct = Math.min(100, Math.round((budgetUsed/assetLimit)*100));
  const budgetState = assetOver ? "over" : budgetLeft===0 ? "full" : budgetLeft<=2 ? "near" : "ok";
  const budgetText = assetOver ? (budgetOverBy+" over cap") : budgetLeft===0 ? "At cap" : (budgetLeft+" slot"+(budgetLeft!==1?"s":"")+" left");
  const counts = { text:tagged.filter(a=>a.kind==="text" && on(a)).length, images:onImages.length, videos:onVideos.length, audio:onAudios.length };
  // Shot frames are optional for video: users can render from the prompt alone, or
  // from one available first frame plus other references. Storyboard source modes
  // still block only when that explicit source is selected and missing.
  const sourceReady = sourceMode==="halves" ? sourcePlan.hasHalves
    : sourceMode==="sheet" ? sourcePlan.hasSheet
    : sourceMode==="frames" ? !!(d.shots||[]).some(sh=>imgs[sh.id])
    : true;
  const sourceBlocking = usePanels && !sourceReady;
  const sourceLabel = sourceMeta.label;
  const sourceDisplay = usePanels ? (sourceReady ? sourceLabel : "missing visual source")
    : ((sourceMode==="frames" ? sourceReady : !!(imgs[(d.first||{}).id] || shotStartFrame)) ? sourceLabel : "prompt only");

  // ---- console controls (rendered in the composer pills + the Settings drawer below) ----
  const dialogueSpeakers = _uniq((d.panelLines||[]).filter(p=>p&&p.speaker&&p.speaker.name).map(p=>p.speaker.name));
  const [camera, setCamera] = React.useState(d.camera);
  const [cameraProfile, setCameraProfile] = React.useState(d.cameraProfile || "auto");
  const [lighting, setLighting] = React.useState(d.lighting);
  const [perf, setPerf] = React.useState(dialogueSpeakers[0] || d.lead);
  // modelId/setModelId come from StageView — the model choice drives CLIP PACKING
  // (sceneSequences shot caps), so it has to live above the per-clip console.
  const [tier, setTier] = React.useState("standard");
  const [resolution, setResolution] = React.useState("720p");
  const [bitrate, setBitrate] = React.useState("standard");   // fal bitrate_mode: standard | high (compression, not price)
  const [seedInput, setSeedInput] = React.useState("");
  const [lastSeed, setLastSeed] = React.useState(null);
  const [nativeAudio, setNativeAudio] = React.useState(true);
  const [durationOverride, setDurationOverride] = React.useState(null);   // null = auto/locked
  const [endFrameId, setEndFrameId] = React.useState("");
  const [aspectOverride, setAspectOverride] = React.useState(null);   // null = project format's ratio
  const effAspect = aspectOverride || aspect || "16:9";
  const [batchN, setBatchN] = React.useState(1);   // takes per Generate (1-4 parallel fal jobs, distinct seeds)
  const stageCameraProfiles = (window.SHOT_CAMERA_PROFILES && window.SHOT_CAMERA_PROFILES.length)
    ? window.SHOT_CAMERA_PROFILES
    : [{ id:"auto", label:"Project default / None", desc:"do not add camera-body language" }];
  const cameraProfileLine = (cameraProfile && cameraProfile!=="auto" && typeof shotCameraProfilePrompt==="function")
    ? shotCameraProfilePrompt(cameraProfile)
    : "";
  // ONE derived prompt (user ruling 2026-08-02): the recipe TABS are gone — the
  // console always assembles the prompt the way that fits the clip's shape, visual
  // source and model (stageSmartRecipe; Multi-shot's row editor still surfaces
  // automatically when the pick lands on it. `recipe`
  // stays internal state so the clip/source/model effects re-derive it; nothing
  // user-facing sets it anymore.
  const defaultRecipe = ()=> stageSmartRecipe(clip, sourceMode, modelId);
  const [recipe, setRecipe] = React.useState(defaultRecipe);
  // PROMPT STYLE — the user-facing choice (user direction 2026-09-02, superseding the
  // 2026-08-02 tabs removal): "Auto" keeps the researched per-beat director brief (or
  // the 2.5 one-take scene brief); picking a named structure (Timeline, Shot list,
  // Structured fields, …) rebuilds the box in that documented Seedance grammar for the
  // beat on screen. Sticky while browsing beats; falls back to Auto whenever the pick
  // can't apply (e.g. Dialogue/lip-sync on a beat with no spoken lines).
  const [promptStyle, setPromptStyle] = React.useState("auto");
  // NOTE: the "new clip → reset recipe" effect lives BELOW with the Multi-shot row
  // state — clip.id alone can't key it (see the repack note there).
  React.useEffect(()=>{ setRecipe(defaultRecipe()); }, [sourceMode, modelId]);
  // the render-settings panel docks on the RIGHT like the Writers' Room inspector —
  // open by default, collapsible to a slim strip, remembered across sessions.
  const [settingsOpen, _setSettingsOpen] = React.useState(()=>{ try{ return localStorage.getItem("turn_stage_settings_open")!=="0"; }catch(e){ return true; } });
  const setSettingsOpen = React.useCallback((v)=>{
    _setSettingsOpen(prev=>{
      const next = (typeof v==="function") ? v(prev) : !!v;
      try{ localStorage.setItem("turn_stage_settings_open", next?"1":"0"); }catch(e){}
      return next;
    });
  },[]);
  const model = seedanceModelOf(modelId);
  const tierObj = seedanceTierOf(model, tier) || { id:"standard", label:"Standard", fast:false, maxRes:"1080p" };
  const capabilityTarget=tierObj.falModel||modelId;
  const [runtimeCaps,setRuntimeCaps]=React.useState({known:false,capabilities:null,reason:"Checking video proxy capabilities"});
  React.useEffect(()=>{ let alive=true;
    if(typeof window.seedanceGetRuntimeCapabilities!=="function"){
      setRuntimeCaps({known:false,capabilities:null,reason:"Capability handshake unavailable"}); return ()=>{alive=false;};
    }
    window.seedanceGetRuntimeCapabilities(capabilityTarget).then(r=>{if(alive)setRuntimeCaps(r||{known:false});})
      .catch(e=>{if(alive)setRuntimeCaps({known:false,capabilities:null,reason:String((e&&e.message)||e)});});
    return ()=>{alive=false;};
  },[capabilityTarget]);
  const staticTransportCaps=typeof window.seedanceCapabilities==="function"
    ? window.seedanceCapabilities(capabilityTarget) : null;
  const runtimeTransportCaps=runtimeCaps&&runtimeCaps.known&&runtimeCaps.capabilities;
  const advertisedAudioLimit=Number((staticTransportCaps&&((staticTransportCaps.references&&staticTransportCaps.references.audios&&staticTransportCaps.references.audios.maxFiles)
    ||staticTransportCaps.directAudioFiles))||10);
  const directAudioLimit=Math.max(0,Number(runtimeTransportCaps
    ? ((runtimeTransportCaps.references&&runtimeTransportCaps.references.audios&&runtimeTransportCaps.references.audios.maxFiles)
      ||runtimeTransportCaps.directAudioFiles||advertisedAudioLimit)
    : Math.min(3,advertisedAudioLimit)));
  // PLAN GATES — per-tier entitlements (plans.jsx): higher plans unlock higher Stage resolution/batch ceilings
  // models+1080p, Studio=4K+batch. Locked options stay visible and clickable — the
  // click opens the plans modal (upsell), never a silent dead button.
  const planGate = (typeof window.turnTierGates==="function") ? window.turnTierGates(creditBalance) : null;
  const planAllowsModel = (id)=> !planGate || (typeof window.turnGateAllowsModel!=="function") || window.turnGateAllowsModel(planGate, id);
  const planAllowsRes = (r)=> !planGate || (typeof window.turnGateAllowsRes!=="function") || window.turnGateAllowsRes(planGate, r);
  const planMaxBatch = planGate ? (planGate.maxBatch||1) : 4;
  const planResNote = (r)=>{ const p = (typeof window.turnPlanForRes==="function") && window.turnPlanForRes(r); return p ? (r+" needs the "+p+" plan") : (r+" is locked on this plan"); };
  const openPlansUpsell = ()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); };
  // clamp to BOTH ceilings — the model tier's (Fast caps at 720p) and the plan's
  React.useEffect(()=>{
    const cap = ["4K","1080p","720p","480p"].find(r=>stageResAllowed(tierObj,r) && stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget) && planAllowsRes(r)) || "480p";
    if(!stageResAllowed(tierObj, resolution) || !stageServerResolutionAllowed(modelId,resolution,runtimeCaps,capabilityTarget) || !planAllowsRes(resolution)) setResolution(cap);
  }, [tierObj.maxRes, modelId, capabilityTarget, runtimeCaps&&runtimeCaps.known, JSON.stringify(runtimeCaps&&runtimeCaps.capabilities||{}), planGate && planGate.maxRes]);
  // a plan that locks the selected model steers to the first allowed active one
  React.useEffect(()=>{
    if(planAllowsModel(modelId)) return;
    const ok = SEEDANCE_MODELS.find(m=>m.status==="active" && planAllowsModel(m.id));
    if(ok){ setModelId(ok.id); const t0=seedanceTierOf(ok, tier); if(t0) setTier(t0.id); }
  }, [modelId, planGate && planGate.tier]);
  // MODEL DEFAULT — Seedance 2.0 for a fresh user comes from the panel's state init
  // (first active registry entry). A stored model can ONLY exist through a hand pick,
  // so the persisted choice rules unconditionally. (The old auto-revert effect here
  // kept its "hand-picked" flag in a ref that died on every console remount — scene
  // switch or reload — while the pick itself persisted, so a saved 2.5 was silently
  // snapped back to 2.0 on mount. Removed 2026-09-02; only plan gates may steer.)
  React.useEffect(()=>{ if(batchN>planMaxBatch) setBatchN(planMaxBatch); }, [planMaxBatch]);
  // dialogue/duration are now CLIP-wide — a clip can bundle several merged shots, so the
  // voice lock and measured duration must account for every dialogue line in the clip,
  // not just the one shot a user happens to be looking at (_clipMeasuredSec already sums
  // all of the clip's line audio and requires every line to be voiced before it locks).
  const lineShots = d.lineShots || [];
  const clipDialogueLines = Array.isArray(d.clipDialogueLines) ? d.clipDialogueLines : [];
  const hasUnassignedClipDialogue = clipDialogueLines.length>0;
  const hasDialogue = lineShots.length>0 || hasUnassignedClipDialogue;
  const voicedLineCount = lineShots.filter(sh=>_shotAudioReady(sh, auds)).length;
  // capability flags from the model registry — Sora-class models take ONE start image
  // (no reference stacks) and perform dialogue themselves (no line-audio lip-sync)
  const modelRefs = model.refs!==false;
  const modelAudioRefs = model.audioRefs!==false;
  // voiceLocked = this render lip-syncs to the ElevenLabs lines (refs + locked clock);
  // otherwise the model performs the dialogue itself (native mode, or a Sora-class engine)
  const voiceLocked = hasDialogue && modelAudioRefs && dialogueAudio==="locked";
  const voiceReady = !hasDialogue || (!hasUnassignedClipDialogue && voicedLineCount===lineShots.length);
  const needsVoice = voiceLocked && !voiceReady;
  // Unassigned clip-level speech has no legal shot ID/audio attachment. Keep the
  // explicit Locked selection visible, but compile this blocked preview without
  // invented @Audio refs; the user must choose Native or assign each line first.
  const audioRefsOn = !hasDialogue || (voiceLocked && !hasUnassignedClipDialogue);
  const measuredSec = _clipMeasuredSec(clip, model.maxClipSec||15);
  const durationLocked = !!measuredSec;
  // measured voice+air is a FLOOR, not a lock — extending buys more acting time, but
  // shrinking below it would cut the lines off
  // MULTI-SHOT include set — which shots ride THIS render (render-local, resets per
  // clip; excluded shots leave the compiled prompt, the native multi_prompt payload,
  // the ceiling math and the duration — their line-audio chips stay individually
  // toggleable in the references tray).
  const [msOff, setMsOff] = React.useState(()=>new Set());
  const [msDur, setMsDur] = React.useState(()=>({})); // render-local; never rewrites canonical shot timing
  // which rows are COLLAPSED (display only — the shot stays in the list and, unless
  // also excluded, in the render). Excluding a shot auto-collapses it; the chevron
  // overrides either way. Both reset per clip.
  const [msFolded, setMsFolded] = React.useState(()=>new Set());
  // A REPACK IS NOT A NEW CLIP. clip.id hashes the member shots, and the scene's
  // clips re-pack whenever a shot's seconds change — so editing a Multi-shot row
  // used to mint a "new" clip id, which reset the recipe tab to the smart default
  // (snapping the user to Timeline/Narrative mid-edit) and re-armed auto-fit,
  // which rewrote the durations and repacked AGAIN. Only a clip sharing NO member
  // shots with the previous one counts as the user actually moving clips.
  const msMembersRef = React.useRef(null);
  React.useEffect(()=>{
    const cur = ((d.shots)||[]).map(s=>s&&s.id).filter(Boolean);
    const prev = msMembersRef.current;
    msMembersRef.current = cur;
    if(prev && cur.some(id=>prev.indexOf(id)>=0)){
      return;
    }
    setRecipe(defaultRecipe());
    setMsOff(new Set()); setMsFolded(new Set()); setMsDur({});
  }, [clip.id]);
  // MULTI-SHOT is a PER-BEAT composer: one beat at a time — the rows are exactly the
  // active clip's packed shots (the beat's equivalent), never the whole scene's 20+.
  // Pick a different beat with the scene rail's clip chips or the ◀ ▶ arrows; each
  // beat gets its own rows, its own ticked total and its own render.
  const msAllShots = shownShots;
  const msPanelLines = d.panelLines || [];
  const msCast = d.cast || [];
  const msClip = (recipe==="multishot")
    ? { ...clip, data:{ ...d, shots: msAllShots, panelLines: msPanelLines, allPanelLines: msPanelLines, cast: msCast,
        lineShots: d.lineShots || [] } }
    : clip;
  const msShots = msAllShots.filter(sh=>!msOff.has(sh.id));
  const msRuntime=(sh)=>Number(msDur[sh&&sh.id]) || Number(sh&&sh.dur) || (typeof shotDur==="function" ? shotDur(sh) : 3);
  const msTotal = msShots.reduce((a,sh)=> a + msRuntime(sh), 0);
  // AUTO-FIT — the first time a clip is shown in Multi-shot (and until the user touches
  // the rows), tick as many leading shots as fit under the model ceiling and give each
  // a grid duration (4/8/12/15) so the total never spills over. Voiced lines keep their
  // measured minimum. Runs once per clip visit; hand-editing a row/check stops it.
  // No mount-time auto-fit: it used to rewrite sh.dur and exclude the largest
  // trailing shots. Packing now splits at shot boundaries; row timing stays local.
  // LIMIT REACHED → collapse every UNTICKED row: once the ticked shots fill the
  // model's clip ceiling, rows that can't join fold away. This only ever FOLDS —
  // a hand-expanded row is never re-folded until the totals change again.
  React.useEffect(()=>{
    if(recipe!=="multishot") return;
    const cap = model.maxClipSec || 15;
    if(msTotal < cap-0.001) return;
    setMsFolded(f=>{
      let changed = false; const n = new Set(f);
      msAllShots.forEach(sh=>{ if(msOff.has(sh.id) && !n.has(sh.id)){ n.add(sh.id); changed=true; } });
      return changed ? n : f;
    });
  }, [recipe, msTotal, msOff, modelId]);
  const duration = (voiceLocked && measuredSec)
    ? Math.max(measuredSec, durationOverride||0)
    : (durationOverride
        || (recipe==="multishot"
            ? Math.max(3, Math.min(model.maxClipSec||15, Math.round(msTotal)))
            : d.dur));
  // VOICE CAST — when locked line-audio rides the render, declare which audio
  // reference is WHOSE voice BEFORE any dialogue instruction, so the model casts
  // the voices first and then performs the lines. @AudioN numbering mirrors the
  // included-audio order (audioIncluded), the same order the attachments use.
  const voiceCast = (audioRefsOn && audioIncluded.length) ? (()=>{
    // GROUP tags per speaker — six lines by one character read as one voice, never
    // six ("@Audio1 is X's; @Audio2 is X's; …" invited the model to invent variety)
    const bySpeaker = new Map();
    audioIncluded.forEach((sid,i)=>{
      const p = (d.panelLines||[]).find(x=>x.shotId===sid);
      const sh = (d.lineShots||[]).find(s=>s.id===sid);
      const speaker = (p&&p.speaker&&p.speaker.name) || (sh&&sh.lineAudio&&sh.lineAudio.speaker) || "the speaker";
      const beatLines=(d.beatDialogues&&sh&&d.beatDialogues[sh.beatN])||[];
      const beatLine=beatLines.find(x=>_normStageText(x&&x.speaker)===_normStageText(speaker));
      const remote=beatLine&&stageDeliveryIsRemote(beatLine.delivery);
      const speakerRef = _stagePromptEntityLabel(promptRefs, "speaker", speaker, speaker)
        +(remote?" (remote/offscreen VO)":"");
      if(!bySpeaker.has(speakerRef)) bySpeaker.set(speakerRef, []);
       const directCap=directAudioLimit;
       const token=i<directCap ? ("@Audio"+(i+1)) : "";
      bySpeaker.get(speakerRef).push(token);
    });
    const entries = Array.from(bySpeaker.entries());
    const body = entries.length===1
      ? "every spoken line is "+entries[0][0]+"'s voice ("+(entries[0][1].length>2
          ? entries[0][1][0]+"–"+entries[0][1][entries[0][1].length-1]
          : entries[0][1].join(", "))+")"
      : entries.map(([n,tags])=>n+"'s voice: "+tags.join(", ")).join("; ");
    return "VOICE CAST — assign these voices before performing any dialogue: "+body
      +". "+(entries.some(([n])=>/\bremote\/offscreen VO\b/.test(n))
        ? "Remote/offscreen lines use VO/audio and never drive an onscreen actor's lips; visible speakers alone may lip-sync their matching audio."
        : "Each visible character speaks ONLY in their assigned voice, lip-synced to that audio.");
  })() : "";
  const recipeText = (id, explicit)=>{
    // Multi-shot editor compiles to the TIME-CODED prompt (Seedance's segment
    // grammar) — the structured rows are the editor, this is the model payload
    // a 2.5 clip is ONE BEAT rendered as a SEQUENCE OF SHOTS (user direction
    // 2026-09-02 — the Art Room micro-beat plan continued onto the Stage; whole-
    // scene prompting retired with the packing). A single-shot clip (Single shot
    // scope, or a one-shot beat) reads better as the per-beat director brief.
    const beatSequence = modelId==="seedance-2.5" && promptShots.length>1;
    const useTimedPlan=typeof window.stageBuildTimedPlan==="function";
    const base = explicit
      ? seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs, { explicitStyle:true })
      : useTimedPlan
      ? seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs,
          {timedPlan:true,directAudioCap:directAudioLimit,durationSec:duration,modelId,
            maxSeconds:model.maxClipSec||15,audioMode:voiceLocked?"locked":"native"})
      : beatSequence
      ? seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs,
          {beatSequence:true,directAudioCap:directAudioLimit,videoRefBase:onVideos.filter(a=>a&&a.url).length,videoRefCap:10})
      : id==="multishot" ? seedanceRecipePrompt("timeline", msClip,
          promptShots.filter(sh=>msShots.some(x=>x&&x.id===sh.id)), promptActiveShot,
          audioRefsOn, audioIncluded, promptRefs)
      : seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs);
    return [voiceCast,base,scopeInstruction].filter(Boolean).join("\n\n");
  };
  // Dialogue/lip-sync needs spoken lines to phrase around; every other style always applies
  const promptStyleAvailable = (id)=> id!=="lipsync" || (d.lineShots||[]).length>0;
  const effPromptStyle = (promptStyle!=="auto" && promptStyleAvailable(promptStyle)) ? promptStyle : null;
  // per-shot overrides (vidText / dur) and include toggles recompile the prompt live
  const msSig = msAllShots.map(s=>s.id+":"+(s.vidText||"")+":"+msRuntime(s)+":"+(msOff.has(s.id)?0:1)).join("|");
  const beatPrompt = effPromptStyle ? recipeText(effPromptStyle, true) : recipeText(recipe);
  const renderPlan = (typeof window.stageBuildTimedPlan==="function")
     ? window.stageBuildTimedPlan(promptShots,{modelId,maxSeconds:model.maxClipSec||15,
        maxShots:model.maxShotsPerClip||Infinity,maxDialogue:10,
         audioMode:voiceLocked?"locked":"native",panelLines:d.panelLines||[],durationSec:duration,
         scene,drafts,characters:ctx.characters||[],beatsMap})
    : null;
  const [prompt, setPrompt] = React.useState(beatPrompt);
  // MANUAL EDITS survive input toggles: the derivation only overwrites an untouched
  // box, and "Reset to script" rebuilds from the beat + Art Room design on demand.
  // Refs (not state) so the rebuild effect below always reads the CURRENT flag even
  // on the same render pass that switches beats.
  const promptEditedRef = React.useRef(false);
  const promptSourceSig=(renderPlan&&renderPlan.signature||"")+"·"+(referencePackage.signature||"")+"·"+promptRefSig+"·"+screenplayReference.signature;
  const promptDraftKey=(scene&&scene.id||"")+"|"+shownShots.map(s=>s&&s.id).filter(Boolean).join(",");
  const promptDraftsRef=React.useRef({});
  const [promptSourceStamp,setPromptSourceStamp]=React.useState(promptSourceSig);
  const [promptDriftConfirmed,setPromptDriftConfirmed]=React.useState("");
  const promptSourceDrift=promptEditedRef.current&&!!promptSourceStamp&&promptSourceStamp!==promptSourceSig
    &&promptDriftConfirmed!==promptSourceSig;
  const promptKeyRef = React.useRef(STAGE_PROMPT_SCHEMA+"·"+clip.id+"·"+activeShot.id);
  // @-mention autocomplete lives in StagePromptArea (module level) so EVERY prompt
  // box — composer, Director and each multi-shot row — shares the same dropdown +
  // unresolved-token warning. The dropdown offers EVERY ready asset (user ruling
  // 2026-08-07: all scene-level elements reachable from the prompt): included ones
  // under their real token, not-yet-included ones under the PROSPECTIVE token they'd
  // get once included — @tokens number the INCLUDED set only, so picking one
  // auto-includes it (see includeMention) before the token lands in the text.
  const mentionables = (()=>{ const out=[];
    tagged.forEach(a=>{
      if(a.kind==="text" || !["image","video","audio"].includes(a.kind)) return;
      const group = a.group || (String(a.key).indexOf("c:")===0 ? "Characters"
        : String(a.key).indexOf("p:")===0 ? "Props"
        : a.key==="loc" || String(a.key).indexOf("scene-loc:")===0 ? "Locations"
        : String(a.key).indexOf("scene-shotframe:")===0 ? "Shot frames"
        : a.kind==="audio" ? "Voices" : "References");
      if(on(a)){
        out.push({ t:stageAssetMention(a), label:String(a.label||""), kind:a.kind, url:String(a.url||""), key:a.key, assetKey:a.key, group, included:true }); }
      else if(a.ready)
        out.push({ t:stageProspectiveMentionToken(a,tagged,on), label:String(a.label||""), kind:a.kind, url:String(a.url||""), key:a.key, assetKey:a.key, group, included:false });
    });
    return out; })();
  const availableMentionables = mentionables;
  // picking a NOT-yet-included asset from the dropdown includes it first (its token
  // has no meaning otherwise); returns false — and warns — when the input budget is full
  const includeMention = (m)=>{
    if(!m || m.included!==false) return true;
    const a = tagged.find(x=>x.key===m.key);
    if(!a || !a.ready) return false;
    if(on(a)) return true;
    if(a.locked) return false;
    if(budgetLeft<=0){
      if(typeof window.appToast==="function") window.appToast((model.label||"This model")+" accepts up to "+assetLimit+" inputs — exclude an asset before adding this one.","error");
      return false;
    }
    toggle(a);
    return true;
  };
  const includeMentionAsset = includeMention;
  const [mentionBox, setMentionBox] = React.useState(null);  // {start, query, hi}
  const promptRef = React.useRef(null);                      // StageMentionEditor imperative API
  const mentionItems = (q)=>{ q=String(q||"").toLowerCase();
    return availableMentionables.filter(m=>!q || m.t.toLowerCase().indexOf(q)>=0 || m.label.toLowerCase().indexOf(q)>=0 || m.group.toLowerCase().indexOf(q)>=0).slice(0,12); };
  // the chip editor reports (text, absolute caret offset) — same @-token detection
  // the old textarea did against selectionStart
  const onPromptChange = (text, caret)=>{ const t = String(text||"").slice(0,PANEL_PROMPT_MAX);
    promptEditedRef.current = true;
    setPromptSourceStamp(promptSourceSig); setPromptDriftConfirmed("");
    promptDraftsRef.current[promptDraftKey]={text:t,sourceSig:promptSourceSig,shotIds:shownShots.map(s=>s.id)};
    setPrompt(t);
    const pos = (caret==null) ? t.length : Math.min(caret, t.length);
    const m = /(?:^|[\s\n])@([A-Za-z0-9]*)$/.exec(t.slice(0, pos));
    setMentionBox(m ? { start:pos-m[1].length-1, query:m[1], hi:0 } : null); };
  const insertMention = (m)=>{ const api=promptRef.current; if(!api||!mentionBox) return;
    if(!includeMention(m)){ setMentionBox(null); return; }
    const tok = m.t;
    const caret = api.caretOffset();
    const next = (prompt.slice(0,mentionBox.start)+tok+" "+prompt.slice(caret)).slice(0,PANEL_PROMPT_MAX);
    const pos = Math.min(mentionBox.start+tok.length+1, next.length);
    promptEditedRef.current = true;
    setPromptSourceStamp(promptSourceSig); setPromptDriftConfirmed("");
    promptDraftsRef.current[promptDraftKey]={text:next,sourceSig:promptSourceSig,shotIds:shownShots.map(s=>s.id)};
    setPrompt(next); setMentionBox(null);
    requestAnimationFrame(()=>{ try{ api.applyValue(next, pos); }catch(_e){} }); };
  const onPromptKeyDown = (e)=>{ if(!mentionBox) return;
    const items = mentionItems(mentionBox.query);
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault();
      setMentionBox(b=>({ ...b, hi:(b.hi+(e.key==="ArrowDown"?1:-1)+Math.max(1,items.length))%Math.max(1,items.length) })); }
    else if((e.key==="Enter"||e.key==="Tab") && items.length){ e.preventDefault();
      insertMention(items[Math.min(mentionBox.hi, items.length-1)]); }
    else if(e.key==="Escape"){ setMentionBox(null); } };
  // tokens that don't resolve to an INCLUDED asset (typo, or the asset was excluded) —
  // prospective tokens of not-yet-included assets deliberately don't count as known
  const badMentions = (()=>{ const known = new Set(mentionables.filter(m=>m.included!==false).map(m=>m.t.toLowerCase()));
    const out = [], re = /@(image|video|audio)\d+/gi; let mm;
    while((mm = re.exec(prompt))){ if(!known.has(mm[0].toLowerCase()) && out.indexOf(mm[0])<0) out.push(mm[0]); }
    return out; })();
  const [modeOverride, setModeOverride] = React.useState(null);
  const [voicingClip, setVoicingClip] = React.useState(false);
  const [maxImg, setMaxImg] = React.useState(null);   // {url,label,kind} — maximised reference viewer
  // ---- Reuse/Branch handoff from the VERSIONS tab: apply the take's settings to the
  // composer once, then consume — an explicit pick from the Versions view always wins.
  React.useEffect(()=>{
    if(!pendingReuse || pendingReuse.clipId!==clip.id) return;
    const m = pendingReuse.meta || {};
    if(m.source && STAGE_SOURCE_MODES[m.source]) setSourceOverride(m.source);
    if(m.tier) setTier(m.tier);
    const tObj = seedanceTierOf(model, m.tier||tier);
    if(m.resolution && tObj && tObj.creditRate && tObj.creditRate[m.resolution]!=null) setResolution(m.resolution);
    if(m.bitrate) setBitrate(m.bitrate==="high"?"high":"standard");
    // (the take's recipe is deliberately NOT restored — since the tab row went, the
    // prompt assembly is always the smart per-clip derivation; a legacy recipe id
    // would park the composer on a shape the UI can no longer explain.)
    setSeedInput(pendingReuse.pin && m.seed!=null ? String(m.seed) : "");
    if(onReuseConsumed) onReuseConsumed();
    if(typeof window.appToast==="function") window.appToast(pendingReuse.pin
      ? "Settings + seed loaded — Generate now renders a controlled variation of that take."
      : "That take's settings are loaded into the composer.","ok");
  },[pendingReuse]);
  // full-screen preview of the rendered clip — native fullscreen on the <video>, with
  // the in-app lightbox as the fallback when the browser refuses (e.g. embedded frames)
  const playerVideoRef = React.useRef(null);
  const [playerClock, setPlayerClock] = React.useState({ time:0, duration:0, playing:false });
  React.useEffect(()=>{ setPlayerClock({ time:0, duration:0, playing:false }); }, [playerUrl, clip.id]);
  const syncPlayerClock = (playing)=>{
    const v = playerVideoRef.current;
    if(!v){ setPlayerClock({ time:0, duration:0, playing:false }); return; }
    const time = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    setPlayerClock({ time, duration:dur, playing: playing==null ? !v.paused : !!playing });
  };
  const playerFullscreen = ()=>{
    if(!playerUrl) return;
    const v = playerVideoRef.current;
    const overlay = ()=>setMaxImg({ url:playerUrl, label:"", kind:"video" });
    if(!v){ overlay(); return; }
    try{
      if(v.requestFullscreen){ const p=v.requestFullscreen(); if(p&&p.catch) p.catch(()=>{}); }
      else if(v.webkitRequestFullscreen) v.webkitRequestFullscreen();
      else if(v.webkitEnterFullscreen){ v.webkitEnterFullscreen(); return; }   // iOS Safari
      else { overlay(); return; }
      // embedded frames can leave the fullscreen request PENDING forever (it neither
      // grants nor rejects) — if nothing is fullscreen shortly after, use the overlay
      setTimeout(()=>{ if(!document.fullscreenElement && !document.webkitFullscreenElement) overlay(); }, 600);
    }catch(e){ overlay(); }
  };
  /* the NATIVE player's own fullscreen control (bottom-right ⛶) can't be re-wired —
     but when the browser refuses it (embedded frame without fullscreen permission) it
     fires "fullscreenerror"; catch that and open the same overlay so the button always
     lands the user somewhere full screen. */
  React.useEffect(()=>{
    const onErr = ()=>{
      const v = playerVideoRef.current;
      if(v && playerUrl && !document.fullscreenElement && !document.webkitFullscreenElement)
        setMaxImg({ url:playerUrl, label:"", kind:"video" });
    };
    document.addEventListener("fullscreenerror", onErr);
    document.addEventListener("webkitfullscreenerror", onErr);
    return ()=>{ document.removeEventListener("fullscreenerror", onErr); document.removeEventListener("webkitfullscreenerror", onErr); };
  }, [playerUrl]);
  const blockerRef = React.useRef(null);              // the banner naming what blocks Generate
  const [blockPulse, setBlockPulse] = React.useState(0);   // bumped when a blocked Generate is clicked → shake + scroll
  const [panelTab, setPanelTab] = React.useState("inputs"); // Render-settings panel tab: model | inputs | director
  // fixed-height prompt box (scrolls when the text runs longer) — keeps the composer
  // compact even on wordy recipes; the resize handle still lets users pull it taller.
  React.useEffect(()=>{
    const key = STAGE_PROMPT_SCHEMA+"·"+clip.id+"·"+activeShot.id;
    if(promptKeyRef.current!==key){
      promptKeyRef.current=key;
      let saved=promptDraftsRef.current[promptDraftKey];
      if(!saved){
        const ids=new Set(shownShots.map(s=>s.id));
        saved=Object.values(promptDraftsRef.current).find(x=>(x.shotIds||[]).some(id=>ids.has(id)));
      }
      promptEditedRef.current=!!saved;
      if(saved){ setPrompt(saved.text); setPromptSourceStamp(saved.sourceSig||""); setPromptDriftConfirmed(""); }
    }
    if(!promptEditedRef.current) setPrompt(effPromptStyle ? recipeText(effPromptStyle, true) : recipeText(recipe));
    setPerf(dialogueSpeakers[0] || d.lead);
    // modelId is a real dependency: an explicit style's shot SCOPE follows the model
    // (timed beat/part under either model), so a 2.0↔2.5 switch must recompile
    // an untouched box — otherwise the render ships the wrong scope under the right label
   }, [clip.id, activeShot.id, recipe, effPromptStyle, modelId, dialogueSpeakers.join("|"), d.lead, audioRefsOn, audioIncluded.join("|"), promptRefSig, msSig, screenplayReference.signature, scopeInstruction]);
  React.useEffect(()=>{ setCamera(d.camera); setCameraProfile(d.cameraProfile || "auto"); setLighting(d.lighting); },
    [clip.id, activeShot.id, d.camera, d.cameraProfile, d.lighting]);
  // a different beat resets per-beat render choices — a reused manual seed or end-frame
  // target from the last beat wouldn't make sense applied to this one.
  React.useEffect(()=>{ setSeedInput(""); setLastSeed(null); setEndFrameId(""); setDurationOverride(null); setAspectOverride(null); setBatchN(1); }, [clip.id, activeShot.id]);
  // mode auto-inferred from which asset kinds are on (overridable in the selector)
  const autoMode = (()=>{ const hasI=onImages.length>0, hasV=onVideos.length>0, hasA=onAudios.length>0;
    if(hasV && (hasI||hasA)) return "multimodal";
    if(hasA && hasI) return "multimodal";
    if(hasV) return "v2v";
    if(hasI) return "i2v";
    return "t2v"; })();
  const mode = modeOverride || autoMode;
  const MODES = [["t2v","Text to Video"],["i2v","Image to Video"],["v2v","Video to Video"],["multimodal","Multimodal"]];

  // ---- start->end frame transition: a genuinely new Seedance 2.0 capability (the
  // dedicated image-to-video endpoint's end_image_url) this console didn't expose at
  // all before. Routes through the next CLIP's frame by default, or any ready image
  // reference. Incompatible with dialogue lip-sync / video refs — see videogen.jsx. ----
  const nextClip = (()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); return i>=0 ? clipsInScene[i+1] : null; })();
  const nextFrameUrl = nextClip ? clipPrimaryFrame(nextClip, imgs, visualSource) : "";
  const endFrameCandidates = [
    nextClip && nextFrameUrl && { id:"next", label:"Next clip · "+nextClip.label, url:nextFrameUrl },
    ...tagged.filter(a=>a.kind==="image" && a.ready && a.url && a.url!==startFrame).map(a=>({ id:"asset:"+a.key, label:a.label, url:a.url })),
  ].filter(Boolean);
  const endFrameAvailable = !beatOpeningClip && !hasDialogue && onVideos.length===0 && endFrameCandidates.length>0 && modelRefs;   // beat-opening shots have one start state
  const endFrameUrl = endFrameAvailable ? ((endFrameCandidates.find(c=>c.id===endFrameId)||{}).url || "") : "";

  // ---- auto reference roles: one declared-role sentence per included asset, appended
  // to the prompt at render (and previewed read-only under the prompt box). Skipped for
  // start->end transitions — that renders on the dedicated i2v endpoint, which takes only
  // the two frames and has no @mention array to point at. ----
  // The transport supports ten direct audio slots. Keep token numbering identical
  // across prompt, preview, metadata and payload; never silently drop an overflow.
  let directAudioN=0;
  const directPromptRefAssets=promptRefAssets.filter(a=>a.kind!=="audio" || (++directAudioN)<=directAudioLimit);
  const refLines = (endFrameUrl || !modelRefs) ? [] : directPromptRefAssets.map(a=>stageAssetRole(a, promptRefs)).filter(Boolean);
  // multi-panel sources have a documented bleed failure mode — captions/panel borders
  // can leak into the video unless explicitly negated in the prompt.
  if(refLines.length && usePanels) refLines.push("The storyboard is blocking reference only — do not render its captions, text overlays, panel numbers or panel borders in the output.");
  const refBlock = refLines.length ? ("References:\n"+refLines.join("\n")) : "";

  const [staging,setStaging] = React.useState(false);
  const [prepPct,setPrepPct] = React.useState(0);
  /* gen.cancel only reaches the fal POLL loop — during pre-submit staging it was a
     no-op and the job submitted anyway. This ref is the staging-phase cancel: the
     Cancel-render button sets it, and onGenerate checks it at the one point that
     matters — right before submission, where credits would be spent. */
  const stagingCancelRef = React.useRef(false);
  const onGenerate = async (attemptOptions)=>{
    const referenceFree=!!(attemptOptions&&attemptOptions.referenceFree);
    try{
      assertScreenplayCurrent();
      if(promptSourceDrift) throw new Error("Review this edited prompt against the updated scene screenplay before rendering.");
    }catch(e){ if(typeof window.appToast==="function") window.appToast(e.message,"error"); return; }
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity({identityCharacterIds:identityIds,
        identityCast, identityContext}, "stage-video-start"); }
      catch(e){ if(typeof window.appToast==="function") window.appToast((e&&e.message)||"Character identity needs review before rendering.","error"); return; }
    }
    try{ assertStageIdentityAssets(); }
    catch(e){ if(typeof window.appToast==="function") window.appToast((e&&e.message)||"A character reference is stale; regenerate it before rendering.","error"); return; }
     /* ASSET STAGING (cloud URL refresh and blob→data-url conversion) runs
       BEFORE the hook's gening flag can light — a slow stage looked like a dead click
       and a staging throw was an uncaught rejection with no toast at all. staging
       lights the player/buttons immediately; the outer catch always surfaces. */
    if(staging) return;
    if(referenceFree&&textOnlyRecoveryBlocked){
      if(typeof window.appToast==="function") window.appToast(textOnlyRecoveryBlocked.text||"Review the remaining render blocker first.","error");
      return;
    }
     if(!stageServerResolutionAllowed(modelId,resolution,runtimeCaps,capabilityTarget)){
       if(typeof window.appToast==="function") window.appToast(resolution+" is pending a server update confirmed by the video proxy capability handshake. Choose an advertised resolution such as 720p.","error");
       return;
     }
     if(referenceBlockingWarnings.length && !referenceFree){
       if(typeof window.appToast==="function") window.appToast(referenceBlockMessage,"error");
       return;
     }
    stagingCancelRef.current=false;
    setStaging(true);
    setPrepPct(8);
    // pin the spend to the account that LAUNCHES the render — if the signed-in
    // user changes while it cooks, the launcher pays, never the new arrival
    const uid0 = (typeof window.nbCloudScope==="function" && (window.nbCloudScope()||{}).uid) || null;
    try{
    // the start frame leads ONLY when its asset chip is included — an excluded start
    // frame means a promptless-anchor render (prompt + remaining references only),
    // never a silent fallback to some other included image
    const attemptImages=referenceFree ? [] : onImages;
    const attemptVideos=referenceFree ? [] : onVideos;
    const attemptAudios=referenceFree ? [] : onAudios;
    const attemptPromptRefAssets=referenceFree ? [] : directPromptRefAssets;
    const frameAsset = referenceFree ? null : (onImages.find(a=>a.url===startFrame) || null);
    const frameUrl = frameAsset ? await stageServerAssetUrl(frameAsset, startFrame || frameAsset.url || "") : "";
    setPrepPct(22);
    const imageEntries = [];
    for(const a of attemptImages){ if(a===frameAsset) continue; const u=await stageServerAssetUrl(a); if(u) imageEntries.push({ asset:a, url:u }); }
    const imageUrls = imageEntries.map(e=>e.url);
    setPrepPct(38);
    const videoUrls = attemptVideos.map(a=>a.url).filter(Boolean);
    let audioUrls = (!referenceFree&&voiceLocked) ? attemptAudios.map(a=>a.url).filter(Boolean) : [];
    const voiceRefLines = [];
    if(audioUrls.length>directAudioLimit) throw new Error("Every screenplay line must attach before rendering. This request has "
      +audioUrls.length+" audio references; the active video transport advertises "+directAudioLimit+". Use Fit beat to split at shot boundaries.");
    setPrepPct(55);
    const controls = [cameraProfileLine, "Camera movement: "+camera+". Lighting: "+lighting+". Performance: "+perf+"."]
      .filter(Boolean).join("\n");
    const blockingPlanIssues=(renderPlan&&renderPlan.issues||[]).filter(x=>x&&x.blocking);
    if(blockingPlanIssues.length){
      if(typeof window.appToast==="function") window.appToast(blockingPlanIssues[0].message||"This screenplay coverage is blocked until its render plan is reconciled.","error");
      return;
    }
    if(clip.g&&clip.g.over&&(!renderPlan||renderPlan.over)){ if(typeof window.appToast==="function") window.appToast("This clip's current render plan needs "+_fmtSecs((renderPlan&&renderPlan.durationSec)||clip.g.dur)+" — over "+_fmtSecs(model.maxClipSec||15)+". Keep the screenplay beat intact; choose a longer model or deliberately revise/revoice it. The app will not silently compress a paid request.","error"); return; }
    if(assetOver&&!referenceFree){ if(typeof window.appToast==="function") window.appToast((model.label||"This model")+" accepts up to "+assetLimit+" inputs — exclude a few assets first.","error"); return; }
    if(sourceBlocking&&!referenceFree){ if(typeof window.appToast==="function") window.appToast("Save this clip's storyboard "+(sourceMode==="sheet"?"sheet":"halves")+" in Storyboards first, or switch Visual source back to shot/prompt rendering.","error"); return; }
    if(needsVoice&&!referenceFree){ if(typeof window.appToast==="function") window.appToast("Voice this clip's dialogue first — duration and lip-sync are locked to line audio.","error"); return; }
	    if(creditInfo.empty){ if(typeof window.appToast==="function") window.appToast("No generation credits remaining.","error"); return; }
	    const hadTakeBefore = !!((typeof vidGetTakes==="function" && vidGetTakes(beatVideoId).length) || playerUrl || gen.videoUrl);
	    const seedVal = seedInput.trim() ? Number(seedInput.trim()) : undefined;
      const promptWithScope = scopeInstruction && prompt.indexOf(scopeInstruction)<0
          ? prompt+"\n\n"+scopeInstruction : prompt;
      const promptWithIdentity = identityPrompt && promptWithScope.indexOf(identityPrompt)<0
          ? promptWithScope+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt : promptWithScope;
     const promptPayload = referenceFree
         ? stageTextOnlyPrompt(promptWithIdentity, promptRefAssets)
         : ((refBlock ? (promptWithIdentity.trim()+"\n\n"+refBlock) : promptWithIdentity)
          + (voiceRefLines.length ? (refBlock?"":"\n\nReferences:")+"\n"+voiceRefLines.join("\n") : ""));
	    const takeReferences = attemptPromptRefAssets.map(a=>({
	      key:a.key||"",
	      tag:stageAssetMention(a),
	      kind:a.kind,
	      label:a.label||stageAssetMention(a),
	      role:stageAssetRole(a, promptRefs),
	      assetRole:a.assetRole || ((typeof nbInferAssetRole==="function") ? nbInferAssetRole({ id:a.id, kind:a.kind==="video"?"video":"asset" }) : ""),
	      assetRoleLabel:a.assetRoleLabel || ((typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel(a.assetRole || ((a.kind==="video") ? "final_take" : "")) : ""),
	      assetRolePriority:a.assetRolePriority || ((typeof nbAssetRolePriority==="function") ? nbAssetRolePriority(a.assetRole || ((a.kind==="video") ? "final_take" : "")) : 0),
	      assetSourceQuality:a.assetSourceQuality || "",
	      url:(a.kind==="text"||a.kind==="audio") ? "" : (a.url||"")
	    })).concat(voiceRefLines.map((l,i)=>({
	      tag:"@Video"+(videoUrls.length-voiceRefLines.length+i+1),
	      kind:"video",
	      label:"Voice carrier",
	      role:l,
	      assetRole:"final_take",
	      assetRoleLabel:(typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel("final_take") : "Final take",
	      assetRolePriority:(typeof nbAssetRolePriority==="function") ? nbAssetRolePriority("final_take") : 100,
	      url:""
	    })));
	    // Multi-shot rows ride the payload as structured segments — models with native
	    // multi-shot-capable providers can render these per-shot; Seedance uses the
	    // compiled micro-beat director prompt text.
    const multiShot = recipe==="multishot" ? msShots.map(sh=>{
      const p = msPanelLines.find(x=>x.shotId===sh.id) || {};
      const text = String(sh.vidText||"").trim() || String(p.text||"").trim();
      // bake the screenplay words into each native row — the row text paraphrases the
      // moment (micro-beat canon); without the quoted line the per-shot prompt would
      // have the model improvise the dialogue.
      const dlg = _seedanceDialogueClause(sh, p, { ...d, audioRefsOn, audioIncluded }, promptRefs);
      // …but not twice: a hand-written row (vidText) that already quotes the line
      // keeps its own phrasing instead of getting a second "says" appended.
      const words = String((p&&p.dialogue) || sh.dialogue||"").trim().replace(/^["“]|["”]$/g,"");
      const dup = !!(words && text) && _normStageText(text).indexOf(_normStageText(words))>=0;
       return { prompt:text+((dlg && !dup)?(" — "+dlg):""), duration:Math.max(1, Math.round(msRuntime(sh))) };
    }).filter(s=>s.prompt) : undefined;
      const shotSources=(typeof shotSourceStamp==="function")
        ? (d.shots||[]).map(sh=>shotSourceStamp(sh,(drafts||{})[sh.sceneId])) : [];
      const beatSources=(d.shots||[]).map(sh=>{
        const src=stageBeatSource(scene,sh,{drafts,beatsMap,characters:ctx.characters||[]});
        return {shotId:sh.id,keyframeMode:sh.keyframeMode||"",
          beatScript:(src&&src.hasSource)?String(src.text||""):"",
          sourceScreenplayRev:(src&&src.sourceRev)||sh.sourceScreenplayRev||"",
          openingCharacterIds:(src&&src.openingCharacterIds)||[],
          physicalCharacterIds:(src&&src.physicalCharacterIds)||[],
          remoteCharacterIds:(src&&src.remoteCharacterIds)||[]};
      }).filter(x=>x.beatScript||x.keyframeMode);
      const resolvedSourceVersions=[].concat(referencePackage.characters||[],referencePackage.locations||[],referencePackage.props||[])
        .map(r=>({assetId:r.assetId,entityId:r.entityId,kind:r.kind,stateId:r.stateId||"",
          snapshot:r.snapshot,shotIds:r.shotIds,usages:r.usages}));
      const attemptRenderPlan=referenceFree&&typeof window.stageBuildTimedPlan==="function"
        ? window.stageBuildTimedPlan(promptShots,{modelId,maxSeconds:model.maxClipSec||15,
            maxShots:model.maxShotsPerClip||Infinity,maxDialogue:10,audioMode:"native",
             panelLines:d.panelLines||[],durationSec:duration,scene,drafts,
             characters:ctx.characters||[],beatsMap})
        : renderPlan;
      const payload = { frameUrl, imageUrls, videoUrls, audioUrls, prompt:promptPayload, controls, multiShot,
      screenplayReference, assertScreenplayCurrent,
      // the spend record rides the render job itself — settled at COMPLETION
      // (live or crash-recovered), pinned to the launching account, deduped by
      // a per-job event id so no path can charge twice or not at all
      spend:{ cost:renderCost, reason:"stage-video-render", uid:uid0 },
      durationMs:duration*1000, aspectRatio:effAspect||"auto", fast:!!tierObj.fast, resolution,
      seed:seedVal, generateAudio: hasDialogue ? true : nativeAudio,   // audio track must stay ON for the lip-synced line to be heard
      bitrateMode:bitrate,
       identityCharacterIds:identityIds, identityCast, identityContext,
      falModel: tierObj.falModel || undefined,   // non-Seedance engines (Sora 2) name their fal endpoint per tier
      textOnly:referenceFree,
      // facts the Versions view shows per take — stamped into the take's meta at commit
	      takeMeta:{ source:referenceFree?"text-only":sourceMode, tier:tierObj.id, tierLabel:tierObj.label, resolution, bitrate, recipe:effPromptStyle || recipe,
	        assetRole:"final_take", assetRoleLabel:(typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel("final_take") : "Final take",
	        cameraProfile:cameraProfile, cameraProfileLabel:(cameraProfile!=="auto" ? ((stageCameraProfiles.find(x=>x.id===cameraProfile)||{}).label||cameraProfile) : ""),
	        audio: hasDialogue ? ((referenceFree||!voiceLocked) ? "native" : "voice") : (nativeAudio ? "native" : "silent"),
	        inputs: referenceFree ? "1 text · 0 img · 0 vid · 0 aud"
            : (counts.text+" text · "+counts.images+" img · "+counts.videos+" vid · "+counts.audio+" aud"),
	        durationSec: duration, references: takeReferences, shotSources,
          renderPlan:attemptRenderPlan,
            beatSources, screenplayReference,
          referenceSourceVersions:referenceFree?[]:resolvedSourceVersions,
          omittedReferenceSourceVersions:referenceFree?resolvedSourceVersions:[],
          referenceSignature:referenceFree?"":(referencePackage.signature||""),
          referenceRecovery:referenceFree?"provider-media-policy-text-only":"",
          identityCharacterIds:identityIds,
          identitySnapshots:identityCast.map(c=>typeof window.nbIdentitySnapshot==="function" ? window.nbIdentitySnapshot(c) : null).filter(Boolean),
	        propDependencies:(typeof stageClipPropDependencySignature==="function")
	          ? stageClipPropDependencySignature(d,scene&&scene.id,window.turnContinuity||{}) : "" },
      // start→end transitions render on the dedicated i2v endpoint, which needs BOTH
      // frames — with the start frame excluded, the end frame quietly stands down
      endImageUrl: (!referenceFree&&frameUrl ? endFrameUrl : "") || undefined, force:true };
    // cancelled while staging? Bail BEFORE submission — nothing was spent yet.
    if(stagingCancelRef.current){ if(typeof window.appToast==="function") window.appToast("Render cancelled.","info"); return; }
    try{
      setPrepPct(70);
      setStaging(false);
      // batch: N parallel jobs with distinct seeds, every completion lands as a take
      const runPayload = (p)=> batchN>1 && typeof gen.generateBatch==="function"
        ? gen.generateBatch(p, batchN)
        : gen.generate(p).then(r=>[r]);
      // Final fail-closed guard immediately before the paid submission. A normal
      // render never changes references after moderation. The explicit text-only
      // recovery is a separate user-launched job and intentionally has no media.
      if(referenceBlockingWarnings.length&&!referenceFree) throw new Error(referenceBlockMessage);
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-before-submit");
      assertStageIdentityAssets();
      assertScreenplayCurrent();
      const results = await runPayload(payload);
      const fresh = results.filter(r=>r && !r.cached);
      const lastWithSeed = results.filter(r=>r && r.seed!=null).slice(-1)[0];
      if(lastWithSeed) setLastSeed(lastWithSeed.seed);
      // the spend itself was settled per-take at COMPLETION (the record rides the
      // job — see payload.spend); here we only nudge the credits display
      try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:"stage-video-render", cost:renderCost*Math.max(1,fresh.length) } })); }catch(_e){}
      if(!hadTakeBefore && results.some(r=>r) && onFirstVideo) setTimeout(()=>onFirstVideo(), 0);
      if(typeof window.appToast==="function") window.appToast("Clip "+beatLabel+" — "+results.length+" take"+(results.length!==1?"s":"")+" rendered","ok");
    }catch(e){ if(typeof window.appToast==="function") window.appToast(stageFriendlyVideoError(e)||"Video render failed.","error"); }
    }catch(e){ if(typeof window.appToast==="function") window.appToast(stageFriendlyVideoError(e)||"Video render failed.","error"); }
    finally{ setStaging(false); setPrepPct(0); }
  };
  const onExtend = async ()=>{
    if(!playerUrl) return;
    try{
      assertScreenplayCurrent();
      if(promptSourceDrift) throw new Error("Review this edited prompt against the updated scene screenplay before extending.");
    }catch(e){ if(typeof window.appToast==="function") window.appToast(e.message,"error"); return; }
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity({identityCharacterIds:identityIds,
        identityCast, identityContext}, "stage-video-extend-start"); }
      catch(e){ if(typeof window.appToast==="function") window.appToast((e&&e.message)||"Character identity needs review before extending this clip.","error"); return; }
    }
    if(creditInfo.empty){ if(typeof window.appToast==="function") window.appToast("No generation credits remaining.","error"); return; }
    // pin the spend to the account that LAUNCHES the extension (same rule as onGenerate)
    const uid0 = (typeof window.nbCloudScope==="function" && (window.nbCloudScope()||{}).uid) || null;
    const controls = [cameraProfileLine, "Camera movement: "+camera+". Lighting: "+lighting+". Performance: "+perf+"."]
      .filter(Boolean).join("\n");
    try{
      const frameAsset = onImages.find(a=>a.url===startFrame) || onImages[0] || null;
      const freshFrameUrl = await stageServerAssetUrl(frameAsset, startFrame || (frameAsset&&frameAsset.url) || "");
      assertStageIdentityAssets();
      assertScreenplayCurrent();
      // Seedance's canonical extension grammar: name the video and the added length,
      // then describe the continuation — not a bare re-render with a video attached.
      const extendPrompt = "Extend @Video1 by ~"+Math.round(duration)+" seconds, continuing seamlessly from where it ends: "
        +prompt.trim()+(identityPrompt?"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt:"");
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-extend-before-submit");
      const res = await gen.generate({ frameUrl:freshFrameUrl, videoUrls:[playerUrl], prompt:extendPrompt, controls,
        screenplayReference, assertScreenplayCurrent, takeMeta:{screenplayReference,source:"extend"},
        identityCharacterIds:identityIds, identityCast, identityContext,
        spend:{ cost:renderCost, reason:"stage-video-extend", uid:uid0 },   // settled at COMPLETION, rides the job
        durationMs:duration*1000, aspectRatio:effAspect||"auto", fast:!!tierObj.fast, resolution, bitrateMode:bitrate, force:true });
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-extend-after-provider");
      if(res && res.seed!=null) setLastSeed(res.seed);
      try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:"stage-video-extend", cost:renderCost } })); }catch(_e){}
    }catch(e){ if(typeof window.appToast==="function") window.appToast(stageFriendlyVideoError(e),"error"); }
  };
  const onVoiceClip = async ()=>{
    if(!onVoiceLine || voicingClip) return;
    const todo = lineShots.filter(sh=>String(sh.dialogue||"").trim() && !_shotAudioReady(sh, auds));
    if(!todo.length) return;
    setVoicingClip(true);
    for(const sh of todo){ await onVoiceLine(sh); }
    setVoicingClip(false);
  };
  const onChip = (ch)=>{
    const line = String((ch&&ch.k)||"").trim()+": "+String((ch&&ch.v)||"").trim();
    if(!line.trim() || line.indexOf(": ")===0) return;
    promptEditedRef.current=true; setPromptSourceStamp(promptSourceSig); setPromptDriftConfirmed("");
    setPrompt(p=>{
      const cur = String(p||"").trim();
      if(cur.toLowerCase().indexOf(line.toLowerCase())>=0) return p;
      const next=cur ? (cur+"\n"+line) : line;
      promptDraftsRef.current[promptDraftKey]={text:next,sourceSig:promptSourceSig,shotIds:shownShots.map(s=>s.id)};
      return next;
    });
  };
  const gening = staging || gen.gening;   // staging = pre-submit asset prep — a slow stage must not look like a dead click
  const genBusyLabel = staging ? ("Preparing inputs · "+Math.max(1, Math.min(99, Math.round(prepPct||1)))+"%") : (stageStatusLabel(gen.status)||"Rendering…");
  const genBusySub = staging ? "Preparing selected references for Seedance…" : ((model.label||"The model")+" is generating this clip…");
  // the poll loop bakes "· NN%" into the status string — lift it back out for the bar
  const genPctMatch = gening ? String(genBusyLabel).match(/(\d{1,3})%/) : null;
  const genPct = genPctMatch ? Math.min(100, Number(genPctMatch[1])) : null;
  const genErr = stageFriendlyVideoError(gen.err);
  const playerClockDuration = playerUrl ? (playerClock.duration || duration || 0) : 0;
  const playerClockFill = playerUrl && playerClockDuration
    ? Math.max(0, Math.min(100, (playerClock.time/playerClockDuration)*100))
    : 0;
  const playerClockLabel = _stageClock(playerUrl ? playerClock.time : 0)+" / "+_stageClock(playerClockDuration);
  // this render's price from the current settings — every cost-bearing choice contributes;
  // a batch multiplies it (N parallel takes) and the balance gates on the TOTAL.
  const renderCost = stageRenderCost(tierObj, resolution, duration);
  const totalCost = renderCost*Math.max(1, batchN);
  const renderCostTitle = totalCost+" credit"+(totalCost!==1?"s":"")+" — "
    +(batchN>1 ? (batchN+" takes × (") : "")+_fmtSecs(duration)+" × "+resolution+" × "+tierObj.label+(batchN>1?")":"");
  const creditInfo = stageCreditInfo(creditBalance, totalCost);
  const canTextOnlyRecovery=stageCanOfferTextOnlyRecovery(gen.err||genErr,modelId);
  const textOnlyRecoveryTitle="Start a new "+totalCost+"-credit render through Seedance 2.5 text-to-video. "
    +"No image, video, or recorded-voice files will be sent; the screenplay/shot prompt and render settings stay, but cast likeness and exact visual continuity may vary.";
  const PANEL_PROMPT_MAX = 1999;
  const activePanel = (d.panelLines||[]).find(p=>p.shotId===activeShot.id) || {};
  const scriptText = activePanel.script || stageShotScriptText(scene, drafts, activeShot, 280) || "";
  const blockingText = activePanel.sheet || stageShotSheetText(scene, beatsMap, activeShot, 280) || "";
  const castNames = (d.cast||[]).map(c=>c.name).filter(Boolean);
  const propNames = (d.props||[]).map(p=>p.name).filter(Boolean);
  const contextRows = [
    ["Scene", _pad2(scene.no)+" · "+(scene.title||scene.loc||"Untitled")],
    ["Beat", beatLabel+" · "+beatName],
    ["Video", playerUrl ? "locked · "+_fmtSecs(duration) : "not rendered"],
    ["Source", sourceDisplay],
    ["Audio", hasDialogue
      ? (!modelAudioRefs ? "native — the model voices the lines"
        : voiceLocked ? (voiceReady ? "locked voice" : "needs voice")
        : "native performance — swap voices in post")
      : "native / silent"]
  ];
  const promptChips = [
    ["subject", perf || d.lead || "selected performer"],
    ["micro-beats", (activePanel.micro&&activePanel.micro.length)
      ? activePanel.micro.map((m,i)=>(i+1)+") "+m).join("; ")
      : (_firstWords(activeShot&&activeShot.action, 8) || "clip action")],
    ["setting", scene.loc || (d.loc&&d.loc.name) || "scene location"],
    ["camera", camera || "director camera"],
    ["style", d.sceneStyle || d.style || "scene style"],
    ["mood", lighting || "scene lighting"]
  ].filter(x=>x[1]);
  // EVERY input reference shows in the strip (no +N overflow) — excluded ones dim,
  // clicking any chip still toggles it in/out of the render.
  // Keep the compact strip beat-focused; scene-wide choices appear here once the
  // director mentions/includes them instead of flooding every clip by default.
  const composerAssets = tagged.filter(a=>!a.sceneOnly||on(a));
  const composerCredit = String(totalCost);   // the render's TOTAL cost, number only (balance lives in the footer)
  // each pill opens a dropdown of options — the inline alternative to the right panel.
  const composerMenus = [
    { key:"model", icon:Icon.sparkles, label:model.label, title:"Video model", heading:"Model",
      options:SEEDANCE_MODELS.map(m=>{
        const planLocked = m.status==="active" && !planAllowsModel(m.id);
        return { value:m.id, label:m.label, selected:m.id===modelId,
          disabled:m.status!=="active",
          note:m.status!=="active" ? m.note : (planLocked ? "Every model unlocks on the Director plan — click to upgrade" : undefined),
          tag:m.status!=="active" ? "Soon" : (planLocked ? "Director plan" : undefined),
          // what this model is best at — the selection aid under each option
          desc:m.bestFor,
          meta:[ m.metaRes && { icon:Icon.diamond||Icon.image, label:m.metaRes },
                 m.metaDur && { icon:Icon.clock, label:m.metaDur } ].filter(Boolean) };
      }),
      // how to prompt the CURRENTLY SELECTED model — sits at the bottom of the
      // dropdown so the guidance is one click away while writing the prompt
      foot: model.promptFormula && _stEl(React.Fragment,null,
        _stEl("b",null,"Prompt formula — "), model.promptFormula),
      onPick:(id)=>{ const m=seedanceModelOf(id); if(m.status!=="active") return;
        if(!planAllowsModel(id)){ openPlansUpsell(); return; }
        setModelId(id); const t0=seedanceTierOf(m,tier); if(t0) setTier(t0.id); } },
    { key:"aspect", icon:Icon.monitor, label:effAspect, title:"Aspect ratio — the project format's default is "+(aspect||"16:9"), heading:"Aspect ratio",
      options:["auto","21:9","16:9","4:3","1:1","3:4","9:16"].map(v=>({ value:v,
        label: v==="auto" ? ("Project default ("+(aspect||"16:9")+")") : v,
        selected: aspectOverride ? v===aspectOverride : v==="auto" })),
      onPick:(v)=>setAspectOverride(v==="auto"?null:v) },
    { key:"res", icon:Icon.diamond||Icon.image, label:resolution, title:"Resolution", heading:"Resolution",
      options:STAGE_RESOLUTIONS.map(r=>{
        const serverPending=!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget);
        const locked = !stageResAllowed(tierObj, r)||serverPending; // model/proxy ceiling (hard)
        const planLocked = !locked && !planAllowsRes(r);      // plan ceiling (upsell)
        // honest lock copy: "needs the Standard tier" only when SOME tier of this
        // model reaches it — otherwise the model itself can't do it at all
        const anyTier = (model.tiers||[]).some(t0=>stageResAllowed(t0, r));
        return { value:r, label:r, selected:r===resolution,
          disabled:locked,
          note:serverPending ? "Pending server update — awaiting the video proxy capability handshake"
            : locked ? (anyTier ? (r+" needs the Standard tier") : (r+" isn't available on "+model.label)) : (planLocked ? planResNote(r)+" — click to upgrade" : undefined),
          tag:planLocked ? ((typeof window.turnPlanForRes==="function" && window.turnPlanForRes(r))||"Plan")+" plan" : undefined,
          meta: r==="4K" ? [{ icon:Icon.sparkles, label:"5× credits" }] : undefined };
      }),
      onPick:(r)=>{ if(!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget)) return;
        if(!planAllowsRes(r)){ openPlansUpsell(); return; } setResolution(r); } },
    { key:"dur", icon:Icon.clock, label:_fmtSecs(duration), heading:"Clip duration",
      title: durationLocked
        ? "The measured voice + breathing room ("+_fmtSecs(measuredSec)+") is the MINIMUM — extend for more acting time"
        : "Clip duration",
      options:_uniq([duration, measuredSec||0, 4,5,6,8,10,12,15, model.maxClipSec||15])
        .filter(v=> v>0 && v<=(model.maxClipSec||15) && (!durationLocked || v>=measuredSec))
        .sort((a,b)=>a-b)
        .map(v=>({ value:v, label:_fmtSecs(v)+(durationLocked&&v===measuredSec?" · voice + air":""), selected:v===duration })),
      onPick:(v)=>setDurationOverride(Number(v)===measuredSec ? null : Number(v)) },
  ].filter(Boolean);
  // (tier / bitrate / audio live as LABELLED rows in the Render settings panel;
  //  References/Elements open from labelled buttons there too)
  // ---- References / Elements trays: full asset management from the composer's two
  // tool buttons. "References" lists every derived input (source, identity, audio,
  // video); "Elements" is the story-element subset (cast · location · props). Rows
  // toggle include/exclude exactly like the (hidden) full asset row. ----
  const [trayOpen, setTrayOpen] = React.useState(null);   // "refs" | "elems" | null
  const [trayPos, setTrayPos] = React.useState(null);
  const trayRef = React.useRef(null);
  const openTray = (which, e)=>{
    const r = e.currentTarget.getBoundingClientRect();
    setTrayPos({ left:Math.round(Math.min(r.left, window.innerWidth-340)), top:Math.round(r.bottom+6) });
    setTrayOpen(t=> t===which ? null : which);
  };
  React.useEffect(()=>{
    if(!trayOpen) return;
    const close=(e)=>{
      if(trayRef.current && trayRef.current.contains(e.target)) return;
      if(e.target && e.target.closest && e.target.closest(".stage2-gen-tool, .sd-gen-refbtns")) return;
      setTrayOpen(null);
    };
    const esc=(e)=>{ if(e.key==="Escape") setTrayOpen(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return ()=>{ document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  },[trayOpen]);
  React.useEffect(()=>{ setTrayOpen(null); }, [clip.id]);
  const trayAssets = trayOpen==="elems"
    ? tagged.filter(a=>String(a.key).indexOf("c:")===0 || a.key==="loc" || String(a.key).indexOf("scene-loc:")===0 || String(a.key).indexOf("p:")===0)
    : tagged;
  const tray = trayOpen && trayPos && _stEl("div",{ref:trayRef,className:"stage2-asset-tray",style:{left:trayPos.left+"px",top:trayPos.top+"px"}},
    _stEl("b",{className:"stage2-tray-h"},
      trayOpen==="elems" ? "ELEMENTS — cast · location · props"
      : trayOpen==="voices" ? "VOICES — a character's recorded lines as references"
      : "REFERENCES — every derived input"),
    trayOpen==="voices" && dialogueAudio!=="locked"
      ? _stEl("div",{className:"stage2-tray-empty"},"Audio is set to Native performance — the model voices the lines itself. Switch Audio (Render settings → Timing & sound) to Locked voice to attach your recorded lines.")
    : trayOpen==="voices"
      ? (voiceGroups.length ? voiceGroups.map(g=>{
          const st = voiceCharState(g);
          const voicedN = g.shots.filter(sh=>_shotAudioReady(sh, auds)).length;
          return _stEl("div",{key:g.name,className:"stage2-tray-row"+(st==="included"||st==="mixed"?" on":"")+(st==="missing"?" missing":"")},
            _stEl("button",{type:"button",className:"stage2-tray-main",disabled:st==="missing",
              title: st==="missing" ? "No recorded voice for "+g.name+" in this clip yet — voice the line first"
                : st==="included" ? g.name+"'s voice is a reference — click to remove"
                : "Add "+g.name+"'s voice as a reference",
              onClick:()=>toggleVoice(g)},
              _stEl("span",{className:"stage2-tray-thumb"}, Icon.mic&&_stEl(Icon.mic,{s:12})),
              _stEl("span",{className:"stage2-tray-name"}, g.name),
              _stEl("small",null, voicedN+" of "+g.shots.length+" line"+(g.shots.length!==1?"s":"")+" voiced"),
              _stEl("span",{className:"stage2-tray-state"},
                st==="included"?"Included":st==="excluded"?"Excluded":st==="mixed"?"Partial":"No voice")));
        }) : _stEl("div",{className:"stage2-tray-empty"},"No dialogue in this clip — nothing to voice."))
    : trayAssets.length
      ? trayAssets.map(a=>_stEl("div",{key:a.key,className:"stage2-tray-row"+(on(a)?" on":"")+(!a.ready?" missing":"")},
          _stEl("button",{type:"button",className:"stage2-tray-main",title:assetTitle(a),onClick:()=>toggle(a)},
            _stEl("span",{className:"stage2-tray-thumb"},
              a.kind==="text" ? "T"
              : a.kind==="audio" ? (Icon.mic&&_stEl(Icon.mic,{s:12}))
              : a.url ? (a.kind==="video"
                  ? _stEl("video",{src:a.url,muted:true,playsInline:true,preload:"metadata"})
                  : _stEl("img",{src:a.url,alt:"",loading:"lazy"}))
              : (Icon.image&&_stEl(Icon.image,{s:12}))),
            _stEl("span",{className:"stage2-tray-name"}, a.label),
            _stEl("small",null, stageAssetTagShort(a)),
            _stEl("span",{className:"stage2-tray-state"}, assetStateLabel(a))),
          (a.url&&(a.kind==="image"||a.kind==="video")) && _stEl("button",{type:"button",className:"stage2-tray-max",title:"Maximise "+a.label,
            onClick:()=>setMaxImg({url:a.url,label:a.label,kind:a.kind})}, Icon.maximize&&_stEl(Icon.maximize,{s:11}))))
      : _stEl("div",{className:"stage2-tray-empty"},"Nothing derived for this clip yet — design its cast, location and props in the Art Room."),
    _stEl("div",{className:"stage2-tray-foot"}, budgetUsed+" / "+assetLimit+" input slots used"));
  // native audio is on but the prompt gives the soundtrack no direction — research flags
  // missing sound cues as the most common silent prompting mistake (audio comes out generic).
  const soundCueMissing = !hasDialogue && nativeAudio && !!prompt.trim() &&
    !/\b(sound|sfx|audio|music|score|jazz|melody|drone|ambien\w*|hum|rain|wind|thunder|footsteps|creak\w*|whisper\w*|roar\w*|buzz\w*|rustl\w*|echo\w*|silence|silent|quiet|crackl\w*|chirp\w*|drip\w*|splash\w*|clang\w*|click\w*|heartbeat|breath\w*|rumbl\w*|hiss\w*|murmur\w*)\b/i.test(prompt);
  // (the recipe ↔ inputs mismatch hints died with the tab row — the smart per-clip
  // derivation can't produce those mismatches, and the hints told users to switch
  // tabs that no longer exist.)
  // ---- what's blocking Generate, in priority order. The FIRST one renders as a
  // prominent actionable banner (not a modal — this is persistent state, and a popup
  // would re-interrupt on every visit); clicking the blocked Generate button shakes
  // and scrolls to it. Where a one-click fix exists, the banner carries the button. ----
  const blockers = [];
  if(screenplayIssue) blockers.push({key:"screenplay-source",text:screenplayIssue});
  if(!stageServerResolutionAllowed(modelId,resolution,runtimeCaps,capabilityTarget)) blockers.push({
    key:"server-resolution",
    text:resolution+" is pending a server update confirmed by the video proxy capability handshake. Choose an advertised resolution such as 720p before rendering."
  });
  if(referenceBlockingWarnings.length) blockers.push({
    key:"required-reference",
    text:referenceBlockMessage
  });
  if(promptSourceDrift) blockers.push({key:"prompt-drift",
    text:"This hand-edited prompt was written against an older scene screenplay, shot timing, coverage, dialogue or reference version. Review the updated screenplay and exact render package before reusing it.",
    actionLabel:"Confirm reviewed",action:()=>setPromptDriftConfirmed(promptSourceSig)});
  const planIssue=renderPlan&&(renderPlan.issues||[]).find(x=>x&&x.blocking);
  if(planIssue) blockers.push({key:"render-plan",text:planIssue.message,
    actionLabel:clipScope==="legacy"?"Fit beat":null,
    action:clipScope==="legacy"?()=>setClipScope("beat"):null});
  if(needsVoice) blockers.push({ key:"voice",
    text:hasUnassignedClipDialogue
      ? "This complete beat has ordered screenplay dialogue that is not assigned to a shot. Choose Native performance, or assign every line to a shot before using Locked voice; TURN will not invent shot IDs or audio attachments."
      : "Voice this clip before rendering — duration and lip-sync lock to the line audio.",
    actionLabel:hasUnassignedClipDialogue ? "Choose Native performance"
      : (onVoiceLine ? (voicingClip ? "Voicing…" : "Voice clip now") : null),
    action:hasUnassignedClipDialogue ? ()=>setDialogueAudio("native") : onVoiceClip,
    busy:hasUnassignedClipDialogue ? false : voicingClip });
  if(sourceBlocking) blockers.push({ key:"source",
    text:"No storyboard source is ready yet — save this clip's "+(sourceMode==="sheet"?"sheet":"halves")+" in Storyboards, or switch Visual source back to shot/prompt rendering." });
  if(clip.g&&clip.g.over&&(!renderPlan||renderPlan.over)) blockers.push({ key:"overcap",
    text:"This part needs "+_fmtSecs(clip.g.dur)+" — over "+(model.label||"this model")+"'s "+_fmtSecs(model.maxClipSec||15)+" maximum. No shot was omitted or compressed. Choose Fit beat to split at shot boundaries; if one shot alone is too long, split that shot/dialogue deliberately in the Art Room.",
    actionLabel:clipScope==="legacy"?"Fit beat":null,
    action:clipScope==="legacy"?()=>setClipScope("beat"):null });
  if(voiceLocked && onAudios.length>directAudioLimit) blockers.push({ key:"voice-cap",
    text:"This render has "+onAudios.length+" spoken lines; the active video transport advertises "+directAudioLimit+" direct audio slots. Fit the beat into shorter shot-boundary parts so no line is silently dropped." });
  // OVER THE MODEL'S CLIP CEILING — the render would clamp silently and compress
  // the pacing; force the choice instead (the fit / untick / parts fixes sit
  // with the rows). Only reachable via the seconds steppers — ticking is capped.
  if(recipe==="multishot" && msTotal > (model.maxClipSec||15)+0.001) blockers.push({ key:"overcap",
    text:"The ticked shots total "+_fmtSecs(Math.round(msTotal*10)/10)+" — over "+(model.label||"this model")+"'s "+_fmtSecs(model.maxClipSec||15)+" maximum per clip. Fit the seconds, untick rows, or render in parts (the fixes sit under the rows)." });
  if(assetOver) blockers.push({ key:"budget",
    text:"Too many inputs selected — exclude "+budgetOverBy+" optional asset"+(budgetOverBy!==1?"s":"")+" before rendering." });
  if(creditInfo.empty) blockers.push({ key:"credits",
    text:"Not enough generation credits — this render needs "+totalCost+(creditInfo.known?(", "+creditInfo.remaining+" remaining"):"")+".",
    actionLabel:"Choose a plan", action:()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); } });
  if(!prompt.trim()) blockers.push({ key:"prompt", text:"Write a prompt — describe the motion you want." });
  const blocker = blockers[0] || null;
  const textOnlyRecoveryBlocked=blockers.find(b=>!["required-reference","voice","source","budget","voice-cap"].includes(b.key))||null;
  const onBlockedGenerate = ()=>{
    setBlockPulse(x=>x+1);
    if(blockerRef.current){ try{ blockerRef.current.scrollIntoView({ behavior:"smooth", block:"center" }); }catch(e){} }
  };
  const onSeedanceGenerateClick = ()=>{
    if(gening) return;
    if(blocker){ onBlockedGenerate(); return; }
    onGenerate();
  };
  const [sdMenu, setSdMenu] = React.useState(null);
  // ---- composer TABS (Image | Video | Sound) + the suggestions row ----------
  // Video is the full render composer (unchanged); Image mounts the Shots-tab
  // frame pipeline for the active shot; Sound is the beat's ElevenLabs lines.
  const [composerTab, setComposerTab] = React.useState("video");
  // IMAGE tab inputs — the whole scene's shots in canonical running order (the
  // Shots-tab order, so seed chains resolve identically) and the Shots-tab ctx
  // shape rebuilt from the Stage ctx.
  const imgSceneShots = React.useMemo(()=>{
    const outSh=[]; const seen=new Set();
    (sceneClips||[]).forEach(sc=>((sc&&sc.data&&sc.data.shots)||[]).forEach(s2=>{
      if(s2&&s2.id&&!seen.has(s2.id)){ seen.add(s2.id); outSh.push(s2); } }));
    return (typeof sceneShotsOrdered==="function") ? sceneShotsOrdered(outSh) : outSh;
  },[sceneClips]);
  const imgCtx = React.useMemo(()=>({ scene,
    location:(typeof locationForScene==="function") ? locationForScene((ctx&&ctx.locations)||[], scene&&scene.id) : null,
     charById:(ctx&&ctx.charById)||{}, propById:(ctx&&ctx.propById)||{},
     project:(ctx&&ctx.project)||{}, locations:(ctx&&ctx.locations)||[],
     scenes:(ctx&&ctx.scenes)||[], drafts:(ctx&&ctx.drafts)||{} }),[scene&&scene.id, ctx]);
  const sdBarRef = React.useRef(null);
  React.useEffect(()=>{
    if(!sdMenu) return;
    const close = (e)=>{ if(sdBarRef.current && sdBarRef.current.contains(e.target)) return; setSdMenu(null); };
    const esc = (e)=>{ if(e.key==="Escape") setSdMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return ()=>{ document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [sdMenu]);
  React.useEffect(()=>{ setSdMenu(null); }, [clip.id]);
  const insertToolbarMention = (m)=>{
    if(!m) return;
    if(!includeMentionAsset(m)) return;
    const tok = String(m.t||"").trim();
    if(!tok) return;
    const api = promptRef.current;
    const cur = String(prompt||"");
    let pos = api && api.caretOffset ? api.caretOffset() : cur.length;
    if(!Number.isFinite(pos)) pos = cur.length;
    pos = Math.max(0, Math.min(cur.length, pos));
    const before = cur.slice(0,pos), after = cur.slice(pos);
    const leftSpace = before && !/[\s([]$/.test(before) ? " " : "";
    const rightSpace = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
    const next = (before+leftSpace+tok+rightSpace+after).slice(0, PANEL_PROMPT_MAX);
    const nextPos = Math.min((before+leftSpace+tok+rightSpace).length, next.length);
    promptEditedRef.current = true;
    setPrompt(next);
    setMentionBox(null);
    requestAnimationFrame(()=>{ try{ api && api.applyValue && api.applyValue(next, nextPos); }catch(_e){} });
  };
  const sourceUiOptions = [
    { id:"auto", label:beatOpeningClip?"Beat-opening frame":"Omni reference",
      desc:beatOpeningClip?"Use the one opening keyframe; the full screenplay beat runs as temporal direction.":"Auto-pick the best references for this beat.", onPick:()=>setSourceOverride("auto") },
    { id:"frame", label:"First frame", desc:"Use one start frame when it exists, or render from prompt alone.", onPick:()=>{ setSourceOverride("frame"); setEndFrameId(""); } },
    { id:"first-last", label:"First and last frame", desc:"Animate from this beat into a chosen end frame.", disabled:beatOpeningClip||!endFrameAvailable,
      note:beatOpeningClip ? "Beat-opening shots have one start frame" : endFrameAvailable ? "" : "No compatible end frame",
      onPick:()=>{ setSourceOverride("frame"); if(!endFrameId && endFrameCandidates[0]) setEndFrameId(endFrameCandidates[0].id); } },
    { id:"frames", label:"Reference frames", desc:"Attach each ready shot frame as a Seedance reference image.", disabled:beatOpeningClip||(d.shots||[]).length<2, onPick:()=>setSourceOverride("frames") },
    { id:"halves", label:"Storyboard half", desc:"Use the saved sheet half as a reference image.", disabled:beatOpeningClip||!sourcePlan.hasHalves, note:beatOpeningClip ? "Beat-opening shots use one opening frame" : sourcePlan.hasHalves ? "" : "No saved half", onPick:()=>setSourceOverride("halves") },
    { id:"sheet", label:"Storyboard sheet", desc:"Use the saved full 2x2 sheet as a reference image.", disabled:beatOpeningClip||!sourcePlan.hasSheet, note:beatOpeningClip ? "Beat-opening shots use one opening frame" : sourcePlan.hasSheet ? "" : "No saved sheet", onPick:()=>setSourceOverride("sheet") },
  ];
  const sourceUiLabel = endFrameUrl ? "First and last frame"
    : sourceOverride==="auto" ? "Omni reference"
    : sourceMode==="frames" ? "Reference frames"
    : sourceMode==="frame" ? "First frame"
    : sourceMode==="halves" ? "Storyboard half"
    : sourceMode==="sheet" ? "Storyboard sheet"
    : sourceMeta.pick || sourceMeta.label || "Omni reference";
  // ---- PROMPT STYLE menu — the documented Seedance prompt grammars, choosable per
  // beat. An explicit pick REBUILDS the box in that structure (even over manual edits
  // — the click is the request); Auto returns to the researched director brief.
  // Descriptions distilled from the Seedance 2.0/2.5 prompting guides (fal, 2026-08).
  const pickPromptStyle = (id)=>{
    setPromptStyle(id);
    promptEditedRef.current = false;
    delete promptDraftsRef.current[promptDraftKey];
    setPrompt((id!=="auto" && promptStyleAvailable(id)) ? recipeText(id, true) : recipeText(defaultRecipe()));
  };
  const promptStyleUiOptions = [
    { id:"auto", label:"Auto — director's brief",
      desc: modelId==="seedance-2.5"
        ? "Whole-beat shot sequence: every shot in this beat in order — each with its own micro-beats, camera and dialogue placement, joined by hard cuts. The researched 2.5 default."
        : "This beat's director brief — subject, ordered micro-beats, dialogue, camera and continuity rules. The researched default.",
      onPick:()=>pickPromptStyle("auto") },
    { id:"narrative", label:"Narrative",
      desc:"One flowing paragraph — who, doing what, where, the spoken line in quotes, camera in its own clause. Best for simple single-action beats.",
      onPick:()=>pickPromptStyle("narrative") },
    { id:"timeline", label:"Timeline",
      desc:"Time-coded windows (0–4s, 4–9s…) paced from each shot or micro-beat — use when several things must land in order.",
      onPick:()=>pickPromptStyle("timeline") },
    { id:"panels", label:"Shot list",
      desc:"Explicit SHOT 1 / SHOT 2 cut points tied to screenplay and storyboard panels, with continuity rules — for stacked shots in one render.",
      onPick:()=>pickPromptStyle("panels") },
    { id:"structured", label:"Structured fields",
      desc:"Labelled control fields — Subject / Action / Dialogue / Setting / Camera / Lighting / Style.",
      onPick:()=>pickPromptStyle("structured") },
    { id:"lipsync", label:"Dialogue / lip-sync",
      desc:"Phrased around the spoken lines — each speaker paired with their own voice reference for exact lip-sync.",
      disabled:!promptStyleAvailable("lipsync"),
      note:promptStyleAvailable("lipsync") ? "" : "No spoken lines in this beat",
      onPick:()=>pickPromptStyle("lipsync") },
  ];
  const promptStyleUiLabel = effPromptStyle
    ? ((promptStyleUiOptions.find(o=>o.id===effPromptStyle)||{}).label||"Auto")
    : "Auto";
  const sdPill = (key, cls, title, body, popover)=>_stEl("div",{className:"sdbar-anchor"+(sdMenu===key?" open":"")},
    _stEl("button",{type:"button",className:"sdbar-pill "+(cls||""),title,
      onClick:(e)=>{ e.stopPropagation(); setSdMenu(m=>m===key?null:key); }},
      body, _stEl("span",{className:"sdbar-chevron"},"⌄")),
    sdMenu===key && popover);
  const sdOption = (o)=>_stEl("button",{key:o.id||o.value,type:"button",
      className:"sdbar-option"+(o.selected?" on":"")+(o.disabled?" disabled":""),
      disabled:!!o.disabled,
      title:o.note||o.desc||o.label,
      onClick:()=>{ if(o.disabled) return; o.onPick&&o.onPick(o.value||o.id); setSdMenu(null); }},
      _stEl("span",{className:"sdbar-option-main"},
        _stEl("b",null,o.label),
        o.selected && _stEl("span",{className:"sdbar-option-check"},"✓"),
        o.beta && _stEl("small",{className:"sdbar-beta"},"Beta")),
      o.desc && _stEl("span",{className:"sdbar-option-desc"},o.desc),
      o.note && _stEl("small",{className:"sdbar-option-note"},o.note));
  const durationMin = durationLocked ? Math.max(1, Math.ceil(measuredSec||1)) : 1;
  const durationMax = Math.max(durationMin, model.maxClipSec||15);
  const seedanceToolbar = _stEl("div",{ref:sdBarRef,className:"sdbar",onMouseDown:e=>e.stopPropagation()},
    _stEl("div",{className:"sdbar-left"},
      sdPill("model","model","Video model",
        _stEl(React.Fragment,null, Icon.cube&&_stEl(Icon.cube,{s:13}), _stEl("span",null,model.label), Icon.sparkles&&_stEl(Icon.sparkles,{s:10})),
        _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
          SEEDANCE_MODELS.map(m=>{
            const planLocked = m.status==="active" && !planAllowsModel(m.id);
            return sdOption({ id:m.id, label:m.label, selected:modelId===m.id, disabled:m.status!=="active",
              desc:m.bestFor, note:m.status!=="active" ? m.note : (planLocked ? "Director plan required" : ""),
              onPick:()=>{ if(planLocked){ openPlansUpsell(); return; }
                setModelId(m.id);
                const t0=seedanceTierOf(m,tier); if(t0) setTier(t0.id); } });
          }))),
      sdPill("scope","scope","Clip scope — how much one render covers",
        _stEl(React.Fragment,null, Icon.film&&_stEl(Icon.film,{s:13}),
          _stEl("span",null, clipScope==="shot" ? "Single shot" : clipScope==="legacy" ? "Previous packing" : "Fit beat")),
        _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
          [ { id:"beat", label:"Fit beat",
              desc:"Beat-first packing. A long beat splits into numbered parts at shot boundaries without omitting coverage. A single overlong shot is blocked with deliberate split/revoice guidance.",
              selected:clipScope==="beat", onPick:()=>{ if(typeof setClipScope==="function") setClipScope("beat"); } },
            { id:"shot", label:"Single shot",
              desc:"One clip per SHOT — render and judge each shot on its own for maximum control; the rail lists every shot as its own clip.",
              selected:clipScope==="shot", onPick:()=>{ if(typeof setClipScope==="function") setClipScope("shot"); } },
            { id:"legacy", label:"Previous packing",
              desc:"View the earlier automatic groups and their historical takes. This does not delete or migrate them into the beat-first plan.",
              selected:clipScope==="legacy", onPick:()=>{ if(typeof setClipScope==="function") setClipScope("legacy"); } },
          ].map(o=>sdOption(o)))),
      sdPill("source","source","Reference mode",
        _stEl(React.Fragment,null, Icon.layers&&_stEl(Icon.layers,{s:13}), _stEl("span",null,sourceUiLabel)),
        _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
          sourceUiOptions.map(o=>sdOption({ ...o, selected:o.id==="auto" ? sourceOverride==="auto" : (o.id==="first-last" ? !!endFrameUrl : sourceOverride===o.id) })))),
      sdPill("pstyle","pstyle","Prompt style — how the prompt is written for this beat",
        _stEl(React.Fragment,null, Icon.text&&_stEl(Icon.text,{s:13}), _stEl("span",null,promptStyleUiLabel)),
        _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
          promptStyleUiOptions.map(o=>sdOption({ ...o, selected:(effPromptStyle||"auto")===o.id })))),
      sdPill("format","format","Aspect ratio and resolution",
        _stEl(React.Fragment,null, Icon.monitor&&_stEl(Icon.monitor,{s:13}), _stEl("span",null,effAspect), _stEl("span",{className:"sdbar-muted"},String(resolution).toUpperCase())),
        _stEl("div",{className:"sdbar-pop sdbar-pop-format"},
          _stEl("label",null,"Aspect ratio"),
          _stEl("div",{className:"sdbar-grid six"},
            ["21:9","16:9","4:3","1:1","3:4","9:16"].map(a=>_stEl("button",{key:a,type:"button",className:a===effAspect?"on":"",
              onClick:()=>{ setAspectOverride(a); setSdMenu(null); }}, _stEl("span",{className:"sdbar-ratio-ico ratio-"+a.replace(":","x")}), a))),
          _stEl("label",null,"Resolution"),
          _stEl("div",{className:"sdbar-grid three"},
            STAGE_RESOLUTIONS.map(r=>{
              const serverPending=!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget);
              const planLocked = stageResAllowed(tierObj, r) && !serverPending && !planAllowsRes(r);
              const disabled = !stageResAllowed(tierObj, r)||serverPending;
              return _stEl("button",{key:r,type:"button",className:(r===resolution?"on ":"")+(planLocked?"plan-locked":""),
                disabled:disabled && !planLocked,
                title:serverPending ? "Pending server update — awaiting the video proxy capability handshake"
                  : planLocked ? planResNote(r)+" — click to upgrade" : (disabled ? (r+" isn't available on "+model.label) : r),
                onClick:()=>{ if(planLocked){ openPlansUpsell(); return; } if(disabled) return; setResolution(r); setSdMenu(null); }},
                String(r).toUpperCase(), (r==="1080p"||r==="4K") && Icon.sparkles&&_stEl(Icon.sparkles,{s:10}));
            })))),
      sdPill("duration","duration","Duration",
        _stEl(React.Fragment,null, Icon.clock&&_stEl(Icon.clock,{s:13}), _stEl("span",null,_fmtSecs(duration))),
        _stEl("div",{className:"sdbar-pop sdbar-pop-duration"},
          _stEl("label",null,"Total duration"),
          _stEl("input",{type:"range",min:durationMin,max:durationMax,step:1,value:Math.round(duration),
            title:durationLocked ? "Minimum locked to voiced line timing" : "Clip duration",
            onChange:e=>setDurationOverride(Number(e.target.value))}),
          _stEl("div",{className:"sdbar-duration-row"}, _stEl("span",null,"0"), _stEl("span",null,"5"), _stEl("span",null,"10"), _stEl("span",null,String(durationMax))),
          _stEl("b",null,_fmtSecs(duration)))),
      sdPill("mention","mention","Mention references",
        _stEl(React.Fragment,null,_stEl("span",{className:"sdbar-at"},"@")),
        _stEl("div",{className:"sdbar-pop sdbar-pop-mention"},
          _stEl("label",null,'Use "@" to mention'),
          (()=>{
            const beatN=(clip.g&&clip.g.beatN)||(activeShot&&activeShot.beatN)||"—";
            const scopeLabel="Scene "+_pad2(scene.no)+(beatN?(" · Beat "+beatN):"")
              +((clip.g&&clip.g.parts)>1?(" · Part "+clip.g.part+"/"+clip.g.parts):"");
            const inc=availableMentionables.filter(m=>m.included).length;
            const more=availableMentionables.length-inc;
            return _stEl("div",{className:"sdbar-mention-scope"},
              _stEl("b",null,scopeLabel+" references"),
              _stEl("span",null,inc+" attached to this clip"+(more>0?(" · "+more+" more from this scene can be added"):"")));
          })(),
          availableMentionables.length
            ? _stEl("div",{className:"sdbar-mention-list"},
                availableMentionables.map(m=>_stEl("button",{key:m.assetKey+":"+m.t,type:"button",onClick:()=>{ insertToolbarMention(m); setSdMenu(null); }},
                  m.kind==="image" && m.url ? _stEl("img",{src:m.url,alt:""}) : _stEl("span",{className:"tile"},m.kind==="audio"?"♪":"▸"),
                  _stEl("span",null,_stEl("b",null,m.t), _stEl("small",null,m.label)),
                  _stEl("em",{className:"sdbar-mention-group"},m.included?"Included":m.group))))
            : _stEl("div",{className:"sdbar-empty"},"No scene references are ready yet."),
          _stEl("div",{className:"sdbar-addbox"},
            _stEl("button",{type:"button",onClick:()=>{ if(window.appToast) window.appToast("Upload new references from the Art Room asset tabs."); }},"↑ Upload from device"))))),
    _stEl("div",{className:"sdbar-right"},
      _stEl("span",{className:"sdbar-cost",title:renderCostTitle+". "+creditInfo.title}, Icon.sparkles&&_stEl(Icon.sparkles,{s:11}), composerCredit),
      _stEl("button",{type:"button",className:"sdbar-send"+(blocker?" blocked":"")+(gening?" working":""),
        title:blocker ? (blocker.text+" (click to see why)") : renderCostTitle,
        "aria-disabled":blocker?"true":undefined,
        disabled:gening,
        onClick:onSeedanceGenerateClick}, gening ? "…" : "↑")));
  // ---- composer header: Image | Video | Sound tabs.
  const composerHeader = _stEl("div",{className:"stage2-ctab-head"},
    _stEl("div",{className:"stage2-ctab-row"},
      _stEl("div",{className:"stage2-ctab-tabs",role:"tablist","aria-label":"Composer mode"},
        [["image","Image"],["video","Video"],["sound","Sound"]].map(([t,lab])=>
          _stEl("button",{key:t,type:"button",role:"tab","aria-selected":composerTab===t?"true":"false",
            className:"stage2-ctab-btn"+(composerTab===t?" on":""),
            title: t==="image" ? "Frame composer — render this shot's still frame (same pipeline as the Art Room's Shots tab)"
              : t==="sound" ? "This beat's spoken lines — voiced with the locked ElevenLabs voices"
              : "Video composer — render this beat as a clip",
            onClick:()=>setComposerTab(t)},lab)))));
  const activeShotNo = imgSceneShots.findIndex(x=>x&&x.id===(activeShot&&activeShot.id))+1;
  const imageTab = (activeShot && activeShot.id && typeof shotFrameGenOpts==="function" && typeof useImageGen==="function")
    ? _stEl(StageFrameComposer,{key:"sfc-"+activeShot.id, sh:activeShot, sceneShots:imgSceneShots, imgCtx,
        shotNo:activeShotNo>0?activeShotNo:"",
        onMax:(url,label)=>setMaxImg({url,label,kind:"image"})})
    : _stEl("div",{className:"stage2-tab-empty"},"No shots in this beat yet — design shots on the Art Room's Shots tab first.");
  const soundTab = _stEl(StageSoundPanel,{lineShots, auds, onVoiceLine});
  const composer = _stEl("div",{className:"stage2-gen-composer"+(gening?" working":"")+(creditInfo.empty?" no-credits":"")},
    composerHeader,
    composerTab==="image" ? imageTab
    : composerTab==="sound" ? soundTab
    : _stEl(React.Fragment,null,
    _stEl("div",{className:"stage2-gen-assets"},
      composerAssets.map(a=>_stEl("button",{key:a.key,type:"button",
        className:"stage2-gen-asset "+a.kind+(a.locked?" locked":"")+(on(a)?"":" off")+(!a.ready?" missing":""),
        title:assetTitle(a),
        onClick:()=>toggle(a)},
        a.kind==="text" ? _stEl("span",{className:"stage2-gen-asset-text"},"T")
        : a.kind==="audio" ? _stEl("span",{className:"stage2-gen-asset-icon"},Icon.mic&&_stEl(Icon.mic,{s:14}))
        : (a.url && !imgFailed(a)) ? (a.kind==="video"
            ? _stEl("video",{src:a.url,muted:true,playsInline:true,preload:"metadata"})
            : _stEl("img",{src:a.url,alt:"",loading:"lazy",
                onError:()=>noteImgFail(a)}))
        : _stEl("span",{className:"stage2-gen-asset-ph"+(a.ready?"":" miss")},
            a.kind==="video" ? (Icon.play&&_stEl(Icon.play,{s:13})) : (Icon.image&&_stEl(Icon.image,{s:13})),
            _stEl("small",null,a.label)),
        (a.url && !imgFailed(a) && (a.kind==="image"||a.kind==="video")) && _stEl("span",{className:"stage2-gen-asset-max",role:"button","aria-label":"Maximise",title:"Maximise "+a.label,
          onClick:(e)=>{ e.stopPropagation(); e.preventDefault(); setMaxImg({url:a.url, label:a.label, kind:a.kind}); }},
          Icon.maximize&&_stEl(Icon.maximize,{s:10})),
        a.kind!=="text" && a.ready && _stEl("span",{className:"stage2-gen-asset-tag",title:"Reference this asset in the prompt as "+stageAssetMention(a)}, stageAssetTagShort(a)),
        on(a) && _stEl("span",{className:"stage2-gen-asset-check"},Icon.check&&_stEl(Icon.check,{s:10}))))),
    modelRefs&&characterReferenceChoices.length>0&&_stEl("div",{className:"stage2-character-choices","aria-label":"Shot-only video character references"},
      characterReferenceChoices.map(row=>_stEl("div",{key:row.sh.id+":"+row.c.id,
        className:"stage2-character-choice","data-shot-id":row.sh.id,"data-character-id":row.c.id},
        _stEl("span",null,
          _stEl("b",null,"Shot "+row.shotN+" · "+row.c.name),
          _stEl("small",null,row.master?"Master reference · this shot's video only"
            :row.hasOverride?"Invalid reference choice — restore scene appearance":"Appearance: "+row.stateLabel)),
        _stEl("button",{type:"button","data-choice":row.hasOverride?"scene":"master",
          disabled:readOnly||!onUpdateShot||gening||(!row.hasOverride&&!row.masterReady),
          title:readOnly?"View-only access — changing a shot reference requires edit access"
            :row.hasOverride?"Restore the scene's assigned appearance for this shot's video"
            :!row.masterReady?"The master image must be loaded and shareable before it can be chosen"
            :"Use the existing master image for this shot's video only. Other shots, appearance states and generated images stay unchanged.",
          onClick:()=>setCharacterReferenceChoice(row)},
          row.hasOverride?"Use scene appearance":"Use master for this shot")))),
    typeof window.StageSceneScreenplay==="function" && _stEl(window.StageSceneScreenplay,{reference:screenplayReference}),
    // (the recipe TAB row is gone — user ruling 2026-08-02: ONE derived prompt.
    // The smart per-clip pick assembles screenplay text + Art Room cinematography;
    // the Multi-shot row editor below surfaces automatically when the pick lands on it.)
    // MULTI-SHOT editor — structured rows over the ACTIVE BEAT's shots
    // (one beat at a time, matching the clip the console is pointed at): a duration
    // stepper + a video-only description per shot + an include checkbox. Edits
    // persist on the shot (vidText/dur), feed EVERY recipe, and recompile the prompt
    // live. The canon Action (image side) is never touched; shots are added on the Shots tab.
    recipe==="multishot" && _stEl("div",{className:"stage2-ms"},
      (()=>{ // the model's clip ceiling, always visible while picking rows: the live
        // total of TICKED seconds vs the cap — amber at the limit, red over it
        const cap = model.maxClipSec || 15;
        const tot = Math.round(msTotal*10)/10;
        const over = tot > cap+0.001, at = !over && tot >= cap-0.001;
        return _stEl("div",{className:"stage2-ms-caphead"+(over?" over":(at?" at":""))},
          _stEl("span",{className:"stage2-ms-caphead-model"}, Icon.clock&&_stEl(Icon.clock,{s:12}),
            (model.label||"This model")+" renders up to "+_fmtSecs(cap)+" per clip"),
          _stEl("span",{className:"stage2-ms-caphead-total"},
            "("+_fmtSecs(tot)+" / "+_fmtSecs(cap)+" ticked)"));
      })(),
      msAllShots.map((sh,i)=>{
        const p = msPanelLines.find(x=>x.shotId===sh.id) || {};
        // the editor shows the FULL canon line — the 190-char panel-line cap (and its
        // trailing "…") is a prompt budget, not what the user reads or edits here
        const canon = String(sh.vidText||"").trim() || stageShotMicroPromptText(scene, drafts, beatsMap, sh, 0) || String(p.text||"").trim();
        const voicedMin = (sh.lineAudio && sh.lineAudio.durationMs) ? Math.max(1, Math.round(((sh.lineAudio.durationMs/1000)+0.4)*10)/10) : 1;
        const curDur = Math.max(1, Math.round(msRuntime(sh)*10)/10);
        const setDur = (nv)=>{
          const v = Math.min(model.maxClipSec||15, Math.max(voicedMin, Math.round(nv*10)/10));
          setMsDur(prev=>({ ...prev,[sh.id]:v })); };
        // an EMPTY override means "derived" (clearing the box restores the derived
        // text) — only real text counts as an edit
        const edited = sh.vidText!=null && String(sh.vidText).trim()!=="";
        const included = !msOff.has(sh.id);
        const folded = msFolded.has(sh.id);
        // would including this row burst the model's clip ceiling? The tick is then
        // refused (with a toast) and the checkbox shows the dashed "blocked" state
        const blockedIn = !included && (msTotal + curDur > (model.maxClipSec||15)+0.001);
        const toggleInclude = ()=>{
          setMsOff(s=>{
            const n = new Set(s);
            if(n.has(sh.id)){
              const cap = model.maxClipSec || 15;
              if(msTotal + curDur > cap+0.001){
                if(window.appToast) window.appToast("Shot "+(i+1)+" ("+_fmtSecs(curDur)+") would push the render to "+_fmtSecs(Math.round((msTotal+curDur)*10)/10)+" — over "+(model.label||"the model")+"'s "+_fmtSecs(cap)+" maximum. Shorten a row's seconds or untick another shot first.","error");
                return s;
              }
              n.delete(sh.id);
            }
            else {
              if(msShots.length<=1){ if(window.appToast) window.appToast("At least one shot must stay in the render."); return s; }
              n.add(sh.id);
            }
            return n;
          });
          // excluding auto-collapses the row; re-including auto-expands it
          setMsFolded(f=>{ const n=new Set(f); if(msOff.has(sh.id)) n.delete(sh.id); else n.add(sh.id); return n; });
        };
        const toggleFold = ()=> setMsFolded(f=>{ const n=new Set(f); n.has(sh.id)?n.delete(sh.id):n.add(sh.id); return n; });
        return _stEl("div",{key:sh.id,"data-ms-shot":sh.id,className:"stage2-ms-row"+(sh.id===activeShot.id?" on":"")+(included?"":" off")+(folded?" folded":"")},
          _stEl("div",{className:"stage2-ms-head"},
            _stEl("button",{type:"button",className:"stage2-ms-fold",
              "aria-expanded":folded?"false":"true",
              title: folded ? "Expand this shot" : "Collapse this shot (it stays in the list)",
              onClick:toggleFold}, folded ? "▸" : "▾"),
            _stEl("button",{type:"button",className:"stage2-ms-check"+(included?" on":"")+(blockedIn?" blocked":""),
              "aria-pressed":included?"true":"false",
              title: included
                ? "Included in this render — click to leave this shot out (prompt, native multi-shot and duration all skip it; the shot itself is untouched)"
                : blockedIn
                ? "Over "+(model.label||"the model")+"'s "+_fmtSecs(model.maxClipSec||15)+" maximum — including this "+_fmtSecs(curDur)+" shot would push the total over. Shorten a row's seconds or untick another shot first."
                : "Excluded from this render — click to include this shot again",
              onClick:toggleInclude}, included?"✓":""),
            _stEl("span",{className:"stage2-ms-tag"},"Shot "+(i+1)),
            _stEl("span",{className:"stage2-ms-beat"},"Beat "+(sh.beatN||"—")),
            included && edited && _stEl("button",{type:"button",className:"stage2-ms-reset",
              title:"Restore this shot's derived text (your edit is video-only and will be discarded)",
              onClick:()=> onUpdateShot && onUpdateShot(sh.id,{ vidText: undefined })},"↺ derived"),
            !included && _stEl("span",{className:"stage2-ms-offlab"},"not in this render"),
            _stEl("span",{className:"stage2-ms-dur"},(()=>{
              // per-shot seconds live on the INTERVAL GRID 4/8/12/15 (bounded by the
              // voiced line's measured minimum and the model's per-render cap) — the
              // current value and voiced minimum are always offered so nothing snaps
              // out from under the user; − / + step through the grid.
              const cap = model.maxClipSec||15;
              const opts = Array.from(new Set(
                  [ ...(window.STAGE_MS_STEPS||[4,8,12,15]), cap, curDur, Math.round(voicedMin*10)/10 ]))
                .filter(v=> v>=Math.max(1,voicedMin)-0.001 && v<=cap)
                .sort((a,b)=>a-b);
              const idx = opts.findIndex(v=>Math.abs(v-curDur)<0.001);
              const stepTo = (di)=>{ const v=opts[Math.max(0,Math.min(opts.length-1,(idx<0?0:idx)+di))]; if(v>0) setDur(v); };
              return [
                 _stEl("button",{key:"m",type:"button",disabled:idx<=0,
                  title: idx<=0 && voicedMin>1 ? ("Minimum "+_fmtSecs(voicedMin)+" — locked to the voiced line") : "Shorter",
                  onClick:()=>stepTo(-1)},"−"),
                 _stEl("select",{key:"s",className:"stage2-ms-durpick",value:String(curDur),
                  title:"Seconds for this shot — 4 / 8 / 12 / "+cap+"s"+(voicedMin>1?(", minimum "+_fmtSecs(voicedMin)+" (the voiced line's measured audio)"):"")
                    +", on "+(model.label||"this model"),
                  onChange:(e)=>{ const v=Number(e.target.value); if(v>0) setDur(v); }},
                  opts.map(v=>_stEl("option",{key:v,value:String(v)},_fmtSecs(Math.round(v*10)/10)))),
                 _stEl("button",{key:"p",type:"button",disabled:idx>=opts.length-1,title:"Longer",
                  onClick:()=>stepTo(1)},"+")];
            })())),
          // the shot's text sits IN the box (editable) — editing saves a video-only
          // override on the shot; ↺ derived brings the live derived line back.
          // A COLLAPSED row hides only its text box; the shot stays fully in the list.
          !folded && _stEl(StagePromptArea,{className:"stage2-ms-text"+(edited?" edited":""),rows:3,fill:true,
            placeholder:"Describe the shot — who is where and what is happening.",
            value: edited ? String(sh.vidText) : canon,
            maxLength:500,mentionables,onMentionPick:includeMention,
            setValue:(v)=>{ if(!onUpdateShot) return;
              onUpdateShot(sh.id, { vidText: v.trim()==="" ? undefined : v }); },
            title:"This shot's video description — compiled into the prompt. Editing saves a video-only override (the shot card's canon Action is never changed); ↺ derived restores the live text."}));
      }),
      (()=>{ // Ceiling notice routes to beat-first shot-boundary splitting. It never
        // rewrites canonical timing or silently drops the largest rows.
        const durOf = msRuntime;
        const minOf = (sh)=> (sh.lineAudio && sh.lineAudio.durationMs) ? Math.max(1, Math.round(((sh.lineAudio.durationMs/1000)+0.4)*10)/10) : 1;
        // ceiling math counts INCLUDED shots only — excluding a shot is itself a fix
        const totalSec = msShots.reduce((a,sh)=> a + durOf(sh), 0);
        const cap = model.maxClipSec || 15;
        if(totalSec <= cap) return null;
        const minTotal = msShots.reduce((a,sh)=> a + minOf(sh), 0);
        const canFit = minTotal <= cap;
        return _stEl("div",{className:"stage2-ms-over"},
          _stEl("span",{className:"stage2-ms-over-text"},
            "Rows total "+_fmtSecs(Math.round(totalSec*10)/10)+" — over "+(model.label||"this model")+"'s "+cap+"s ceiling."
            +(canFit ? "" : " Voiced lines alone need "+_fmtSecs(Math.round(minTotal*10)/10)+", so one render can't hold this scene.")),
          _stEl("button",{type:"button",className:"stage2-ms-over-act primary",
            title:"Split this beat into shot-boundary parts without rewriting shot timing.",
            onClick:()=>setClipScope&&setClipScope("beat")},"Fit beat"));
      })(),
      _stEl("div",{className:"stage2-ms-hint"},"One row = one shot. Edit the text freely — it shapes the video prompt only; Generate renders these rows as one continuous Seedance clip. (Add or remove shots on the Art Room's Shots tab.)")),
    _stEl("div",{className:"stage2-gen-row"+(recipe==="multishot"?" ms":"")},
    _stEl("div",{className:"stage2-gen-box"+(recipe==="multishot"?" ms-mode":"")},
      // in Multi-shot mode the ROWS are the prompt editor — the compiled text is
      // hidden (it still compiles and renders; switch to Timeline to read it)
      // composer uses the CHIP editor (resolved @tokens render as inline chips);
      // other prompt boxes (Director, multi-shot rows) keep the shared StagePromptArea
      recipe!=="multishot" && _stEl("div",{className:"stage2-gen-promptwrap"},
        _stEl(StageMentionEditor,{apiRef:promptRef, value:prompt, mentionables,includeMention,
          maxLen:PANEL_PROMPT_MAX, placeholder:"Describe the video you want to create…",
          onChange:onPromptChange, onKeyDown:onPromptKeyDown,
          onBlur:()=>setTimeout(()=>setMentionBox(null),120)}),
        // edited away from the derivation → offer the way back to the script
        prompt!==beatPrompt && _stEl("button",{type:"button",className:"stage2-prompt-reset",
          title:"Rebuild this prompt from the screenplay beat and the Art Room shot design — discards manual edits",
          onClick:()=>{ promptEditedRef.current=false; delete promptDraftsRef.current[promptDraftKey]; setPromptSourceStamp(promptSourceSig); setPromptDriftConfirmed(""); setPrompt(beatPrompt); }},
          "↺ Reset to script"),
        badMentions.length>0 && _stEl("div",{className:"stage2-mention-warn"},
          "⚠ "+badMentions.join(", ")+" — not among this render's included assets; the model will guess. Fix the token or include the asset."),
        mentionBox && mentionItems(mentionBox.query).length>0 && _stEl("div",{className:"stage2-mention-box"},
          mentionItems(mentionBox.query).map((m,i)=>_stEl("button",{key:m.t+":"+(m.key||""),type:"button",
            className:"stage2-mention-item"+(i===mentionBox.hi?" hi":""),
            title: m.included===false ? m.label+" — not among this render's inputs yet; picking it includes it" : undefined,
            onMouseDown:e=>{ e.preventDefault(); insertMention(m); }},
            // thumbnail, Seedance-style: the asset's image, or a glyph tile for video/audio
            m.kind==="image" && m.url
              ? _stEl("img",{className:"stage2-mention-thumb",src:m.url,alt:""})
              : _stEl("span",{className:"stage2-mention-thumb tile"},
                  m.kind==="video" ? (Icon.film&&_stEl(Icon.film,{s:13})) : (Icon.mic&&_stEl(Icon.mic,{s:13}))),
            _stEl("span",{className:"stage2-mention-main"},
              _stEl("b",null,m.t), m.label && _stEl("span",{className:"stage2-mention-label"},m.label)),
            _stEl("span",{className:"stage2-mention-kind"},
              m.included?"Included":(m.group|| (m.kind==="image"?"Image":m.kind==="video"?"Video":"Audio"))))))),
      seedanceToolbar)),
      // (cancelling an in-flight render lives in the Render settings panel — "Cancel render";
      //  the REFERENCES-added-at-render preview lives in the panel's Inputs tab)
    (blocker || genErr || soundCueMissing || !modelRefs
      || (hasDialogue && (!modelAudioRefs || dialogueAudio==="native"))) && _stEl("div",{className:"stage2-gen-notices"},
      // the PRIMARY blocker — prominent, actionable, and the target of a blocked
      // Generate click (key remount restarts the shake animation on every pulse)
      blocker && _stEl("div",{ref:blockerRef,key:"blk-"+blocker.key+"-"+blockPulse,
          className:"stage2-blocker"+(blockPulse?" pulse":"")},
        Icon.alert&&_stEl(Icon.alert,{s:14}),
        _stEl("span",{className:"stage2-blocker-text"}, blocker.text),
        blocker.actionLabel && _stEl("button",{type:"button",className:"stage2-blocker-act",disabled:blocker.busy,onClick:blocker.action}, blocker.actionLabel)),
      blockers.slice(1).map(b=>_stEl("div",{key:b.key,className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
        _stEl("span",{className:"stage2-warn-text"}, b.text),
        b.actionLabel && _stEl("button",{type:"button",className:"stage2-warn-act",disabled:b.busy,onClick:b.action}, b.actionLabel))),
      genErr && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
        _stEl("span",{className:"stage2-warn-text"},genErr),
        canTextOnlyRecovery && _stEl("button",{type:"button",className:"stage2-warn-act",
          disabled:gening||creditInfo.empty||!!textOnlyRecoveryBlocked,
          title:textOnlyRecoveryBlocked?(textOnlyRecoveryBlocked.text||"Review the remaining render blocker first."):textOnlyRecoveryTitle,
          onClick:()=>onGenerate({referenceFree:true})},
          "Retry from text only · "+totalCost+" credit"+(totalCost===1?"":"s"))),
      soundCueMissing && _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}), "Native audio is on but the prompt has no sound direction — name the sounds you want (ambience, effects, music) or the soundtrack comes out generic."),
      hasDialogue && !modelAudioRefs && _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}),
        model.label+" performs the dialogue ITSELF from the prompt (native synced voices) — the locked ElevenLabs voices don't ride along on this model. Switch to Seedance for voice-locked lip-sync."),
      hasDialogue && modelAudioRefs && dialogueAudio==="native" && _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}),
        "Native performance: the model acts the lines in its own voice with free, natural pacing. Swap to your locked ElevenLabs voices in post with Voice Changer — it keeps the performance and timing, changes only the timbre."),
      !modelRefs && _stEl("div",{className:"stage2-hint"}, Icon.image&&_stEl(Icon.image,{s:12}),
        model.label+" takes ONE start image — identity rides that frame, not the reference sheets. Only the selected visual source is sent; other assets stay behind.")),
    tray));

  // ----- CENTER: player + filmstrip + prompt + input assets -----
  const center = _stEl("div",{className:"stage2-center stage2-compose-mode"},
    _stEl("div",{className:"stage2-clip-head"},
      _stEl("div",{className:"stage2-clip-slug",title:beatName||""}, beatLabel+" · ",
        _stEl("span",{className:"stage2-clip-loc"}, stageScenePlace(scene)))),
      // take switching & management live in the room's Versions view (the tab above) —
      // the clip head is just the slug (full screen is a double-click on the video)
    // player
    _stEl("div",{className:"stage2-player",style:_stageAspectCss(aspect)},
      playerUrl
        ? _stEl("video",{ref:playerVideoRef,src:playerUrl,poster:shotStartFrame||undefined,controls:true,playsInline:true,
            title:"Double-click for full screen",onDoubleClick:playerFullscreen,
            onLoadedMetadata:()=>syncPlayerClock(false),onTimeUpdate:()=>syncPlayerClock(),
            onPlay:()=>syncPlayerClock(true),onPause:()=>syncPlayerClock(false),onEnded:()=>syncPlayerClock(false)})
        : _stEl("div",{className:"stage2-player-empty"},
            _stEl("span",{className:"stage2-player-playring"+(gening?" busy":"")}, Icon.play&&_stEl(Icon.play,{s:22})),
            _stEl("div",{className:"stage2-player-msg"}, gening ? genBusyLabel : "Not rendered yet"),
            gening && genPct!=null && _stEl("div",{className:"stage2-player-bar",role:"progressbar",
                "aria-valuenow":genPct,"aria-valuemin":0,"aria-valuemax":100,"aria-label":"Render progress"},
              _stEl("div",{className:"stage2-player-bar-fill",style:{width:genPct+"%"}})),
            _stEl("div",{className:"stage2-player-sub"}, gening ? genBusySub : "Generate this clip to create the video"))),
    _stEl("div",{className:"stage2-ruler"+(playerUrl?" has-video":" empty")},
      _stEl("div",{className:"stage2-ruler-track"},
        _stEl("div",{className:"stage2-ruler-fill",style:{width:playerClockFill+"%"}})),
      _stEl("span",{className:"stage2-ruler-dur"}, playerClockLabel)),
    // filmstrip below the player — approved takes for THIS selected clip, newest first.
    _stEl("div",{className:"stage2-timeline"},
      _stEl("button",{type:"button",className:"stage2-time-arrow",title:"Previous clip",
        disabled:clipsInScene.findIndex(c=>c.id===clip.id)<=0,
        onClick:()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); if(i>0) onSelectClip&&onSelectClip(clipsInScene[i-1].id); }},
        Icon.chevL&&_stEl(Icon.chevL,{s:14})),
      _stEl("div",{className:"stage2-time-track"},
        _stEl("div",{className:"stage2-time-ruler"},
          [0,2,4,6,8].map(n=>_stEl("span",{key:n,className:n===2?"on":""},"00:"+_pad2(n)))),
        _stEl("div",{className:"stage2-time-cards"},
          (()=>{ if(!approvedVisibleTakes.length) return _stEl("div",{className:"stage2-time-empty"},
              "No approved videos yet — review this clip in Takes and approve the one that should live here.");
            return approvedVisibleTakes.map((t,i)=>{
              const m = (t&&t.meta)||{};
              const active = (activeTakeUrl || playerUrl)===t.url;
              const shotCount = (d.shots||[]).length;
              const label = _stageTakeVno(t, visibleTakes, visibleTakes.indexOf(t));
              return _stEl("button",{key:t.id||t.url,type:"button",className:"stage2-time-card rendered"+(active?" on":""),
                onClick:()=>setActiveTakeUrl(t.url),title:beatLabel+" · "+label+" · "+(_stageAgo(m.createdAt)||"rendered")},
                _stEl("div",{className:"stage2-time-thumb"},
                  _stEl("video",{src:t.url+"#t=0.1",muted:true,playsInline:true,preload:"metadata"}),
                  shotCount>1 && _stEl("span",{className:"stage2-time-merge",title:shotCount+" shots merged into this clip"}, "×"+shotCount),
                  _stEl("span",{className:"stage2-time-play"},Icon.play&&_stEl(Icon.play,{s:12}))),
                _stEl("div",{className:"stage2-time-meta"},
                  _stEl("b",null,label+" "+(i===0?"Newest":"")),
                  _stEl("span",null,[m.durationSec?_fmtSecs(m.durationSec):_fmtSecs(d.dur), m.resolution].filter(Boolean).join(" · ")))); }); })())),
      _stEl("button",{type:"button",className:"stage2-time-arrow",title:"Next clip",
        disabled:(()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); return i<0 || i>=clipsInScene.length-1; })(),
        onClick:()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); if(i>=0 && i<clipsInScene.length-1) onSelectClip&&onSelectClip(clipsInScene[i+1].id); }},
        Icon.chevR&&_stEl(Icon.chevR,{s:14}))),
    composer,
    typeof window.StageRenderPlan==="function" && _stEl(window.StageRenderPlan,{
      plan:renderPlan,modelLabel:model.label,beatN:clip.g&&clip.g.beatN,
      part:clip.g&&clip.g.part,parts:clip.g&&clip.g.parts,
      referenceWarnings:referenceWarningGroups,
      onShowShots:onStageNav?()=>onStageNav("shots"):undefined,
      onSplit:clipScope==="legacy"?()=>setClipScope("beat"):undefined
    }),
    _stEl("details",{className:"stage-plan-queued"},
      _stEl("summary",null,"Exact queued render"),
      _stEl("pre",null,(()=>{
        const queuedPrompt=scopeInstruction && prompt.indexOf(scopeInstruction)<0
          ? prompt.trim()+"\n\n"+scopeInstruction : prompt.trim();
        const body=(refBlock?(queuedPrompt+"\n\n"+refBlock):queuedPrompt)
          +"\n\n"+[cameraProfileLine,"Camera movement: "+camera+". Lighting: "+lighting+". Performance: "+perf+"."].filter(Boolean).join("\n");
        if(!screenplayReference.hasSource || (screenplayReference.errors||[]).length)
          return body+"\n\nNOT READY: "+screenplayIssue;
        const withReference=window.stageAppendScreenplayReference(body,screenplayPromptReference);
        return screenplayIssue ? withReference+"\n\nNOT READY: "+screenplayIssue : withReference;
      })()),
      _stEl("small",null,"Scene "+_pad2(scene.no)+" · Beat "+((clip.g&&clip.g.beatN)||activeShot.beatN||"—")
        +((clip.g&&clip.g.parts)>1?(" · Part "+clip.g.part+"/"+clip.g.parts):"")+" · "+model.label+" · "+tierObj.label+" · "+resolution+" · "+_fmtSecs(duration)
        +" · "+counts.images+" image · "+counts.videos+" video · "+counts.audio+" audio reference"+(counts.audio===1?"":"s"))),
    _stEl("div",{className:"stage2-director-prompt"},
      _stEl("div",{className:"stage2-director-head"},
        _stEl("div",{className:"stage2-director-title"},
          _stEl("b",null,model.label+" Director"),
          _stEl("span",{className:"stage2-director-badge"},"PRIMARY PROMPT"))),
      _stEl(StagePromptArea,{className:"stage2-director-text",value:prompt,setValue:(v)=>{
          promptEditedRef.current=true;setPromptSourceStamp(promptSourceSig);setPromptDriftConfirmed("");setPrompt(v);
          promptDraftsRef.current[promptDraftKey]={text:v,sourceSig:promptSourceSig,shotIds:shownShots.map(s=>s.id)};
        },
        mentionables,onMentionPick:includeMention,fill:true,placeholder:"Describe the video you want to create…",maxLength:PANEL_PROMPT_MAX}),
      _stEl("div",{className:"stage2-director-chips"},
        promptChips.map(([k,v],i)=>_stEl("button",{key:k+i,type:"button",onClick:()=>onChip({k,v,label:v}),title:"Add "+k+" to prompt"},
          _stEl("b",null,k),_stEl("span",null,v))))),
    _stEl("div",{className:"stage2-assets-lab"},
      _stEl("span",null,"INPUT ASSETS ("+budgetUsed+"/"+assetLimit+")"),
      _stEl("b",null, budgetText)),
    _stEl("div",{className:"stage2-assets-row "+budgetState},
      tagged.map(a=> _stEl("button",{key:a.key,
        type:"button",
        className:"stage2-asset "+a.kind+" "+assetState(a)+(on(a)?" on":"")+(a.locked?" locked":""),
        "aria-pressed":(!a.locked&&a.ready)?(on(a)?"true":"false"):undefined,
        "aria-disabled":(a.locked||!a.ready)?"true":undefined,
        title:assetTitle(a),
        onClick:()=>toggle(a)},
        _stEl("span",{className:"stage2-asset-check"}, on(a) ? (Icon.check&&_stEl(Icon.check,{s:10})) : ""),
        _stEl("div",{className:"stage2-asset-vis"},
          a.kind==="text" ? _stEl("span",{className:"stage2-asset-textic"},"T")
          : a.kind==="audio" ? _stEl("span",{className:"stage2-asset-icon"}, Icon.mic&&_stEl(Icon.mic,{s:16}))
          : (a.url && !imgFailed(a)) ? _stEl(React.Fragment,null,
              a.kind==="video" ? _stEl("video",{src:a.url,muted:true,playsInline:true,preload:"metadata"}) : _stEl("img",{src:a.url,alt:"",loading:"lazy",
                onError:()=>noteImgFail(a)}),
              (a.kind==="image"||a.kind==="video") && _stEl("span",{className:"stage2-asset-max",role:"button","aria-label":"Maximise",title:"Maximise",
                onClick:(e)=>{ e.stopPropagation(); e.preventDefault(); setMaxImg({url:a.url, label:a.label, kind:a.kind}); }},
                Icon.maximize&&_stEl(Icon.maximize,{s:11})))
          : _stEl("span",{className:"stage2-asset-icon"}, a.kind==="video" ? (Icon.play&&_stEl(Icon.play,{s:16})) : (Icon.image&&_stEl(Icon.image,{s:16})))),
        _stEl("span",{className:"stage2-asset-name"}, a.label),
        _stEl("small",null,a.tag+(a.locked?" · REQUIRED":on(a)?" · INCLUDED":"")))),
      _stEl("button",{className:"stage2-asset add",type:"button",
        title:"Assets are derived from the selected clip's storyboard, frame, cast, location, props and audio"},
        _stEl("div",{className:"stage2-asset-vis"},Icon.plus&&_stEl(Icon.plus,{s:17})),
        _stEl("span",{className:"stage2-asset-name"},"Add asset"))),
    (sourceBlocking || assetOver || genErr || needsVoice || creditInfo.empty) && _stEl("div",{className:"stage2-assets-warnings"},
      needsVoice && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}), "Voice this clip before rendering so timing and lip-sync stay locked."),
      sourceBlocking && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}), "No storyboard source is ready yet."),
      assetOver && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}), "Too many inputs selected. Exclude "+budgetOverBy+" optional asset"+(budgetOverBy!==1?"s":"")+" before rendering."),
      creditInfo.empty && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
        _stEl("span",{className:"stage2-warn-text"}, "Not enough generation credits — this render needs "+totalCost+(creditInfo.known?(", "+creditInfo.remaining+" remaining"):"")+"."),
        _stEl("button",{type:"button",className:"stage2-warn-act",
          title:"Top up your balance with a one-off credit pack, or subscribe for a monthly allowance",
          onClick:()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); }}, "Get credits")),
      genErr && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}), genErr))
    /* Target Stage UI keeps supporting beat/story/reference context out of the main surface. */,
    false && _stEl("div",{className:"stage2-midcards"},
      _stEl("div",{className:"stage2-midcard"},
        _stEl("div",{className:"stage2-midcard-head"},
          _stEl("span",null,"Beat context"),
          _stEl("b",null,beatLabel)),
        _stEl("div",{className:"stage2-context-list compact"},
          contextRows.map((r,i)=>_stEl("div",{key:i,className:"stage2-context-row"},
            _stEl("span",null,r[0]), _stEl("b",null,r[1]))))),
      _stEl("div",{className:"stage2-midcard"},
        _stEl("div",{className:"stage2-midcard-head"},
          _stEl("span",null,"Story match"),
          _stEl("b",null,"live")),
        _stEl("div",{className:"stage2-context-copy"},
          _stEl("label",null,"Screenplay"),
          _stEl("p",null, scriptText || "No screenplay excerpt mapped to this beat yet."),
          blockingText && _stEl(React.Fragment,null,
            _stEl("label",null,"Storyboard blocking"),
            _stEl("p",null, blockingText)))),
      _stEl("div",{className:"stage2-midcard"},
        _stEl("div",{className:"stage2-midcard-head"},
          _stEl("span",null,"References"),
          _stEl("b",null,budgetUsed+" / "+assetLimit)),
        _stEl("div",{className:"stage2-ref-tags"},
          castNames.map(n=>_stEl("span",{key:"c"+n,className:"stage2-ref-tag cast"}, n)),
          (d.loc&&d.loc.name) && _stEl("span",{className:"stage2-ref-tag loc"}, d.loc.name),
          propNames.map(n=>_stEl("span",{key:"p"+n,className:"stage2-ref-tag prop"}, n)),
          !castNames.length && !propNames.length && !(d.loc&&d.loc.name) && _stEl("span",{className:"stage2-ref-empty"},"No derived references yet"))),
      (d.chips||[]).length>0 && _stEl("div",{className:"stage2-midcard wide"},
        _stEl("div",{className:"stage2-midcard-head"},
          _stEl("span",null,"Prompt ingredients"),
          _stEl("b",null,(d.chips||[]).length)),
        _stEl("div",{className:"stage2-chips"},
          d.chips.map((ch,i)=>_stEl("button",{key:i,type:"button",className:"stage2-chip "+_chipClass(ch.k),
            title:"Add "+ch.k+": "+(ch.v||""),onClick:()=>onChip(ch)},
            _stEl("b",null,ch.k),_stEl("span",null,ch.label||ch.v)))))));

  // ----- Render-settings panel: the full per-clip control surface (model/tier,
  // resolution, seed, end frame, camera/lighting/performance, audio, duration, recipe).
  // Docked on the RIGHT like the Writers' Room inspector — collapsible to a slim strip;
  // the composer stays a compact prompt box + pills. -----
  // ---- Render settings panel, organised into three tabs (the Writers' Room
  // segmented pattern): MODEL (engine + quality), INPUTS (what feeds the render),
  // DIRECTOR (how it's staged). Voice/errors/Generate stay persistent below. ----
  const panelTabs = [["model","Model"],["inputs","Inputs"],["director","Director"]];
  // ---- the unified RENDER card: EVERY cost-bearing choice (model · tier · resolution ·
  // duration) plus the LIVE credit cost and the model's capabilities as compact chips —
  // one glanceable answer to "what will this render cost and why". Always visible above
  // the tabs; the tabs below keep only the advanced knobs (seed, bitrate, batch, end frame). ----
  const renderCard = _stEl("div",{className:"stage2-rendercard"},
    _stEl("div",{className:"stage2-rc-head"},
      _stEl("span",{className:"eyebrow"},"Render"),
      _stEl("b",{className:"stage2-rc-cost"+(creditInfo.empty?" empty":""),
        title:renderCostTitle+". "+creditInfo.title},
        Icon.sparkles&&_stEl(Icon.sparkles,{s:11}), totalCost+" credit"+(totalCost!==1?"s":""))),
    // model picker — data-driven from SEEDANCE_MODELS; a future model is one registry
    // entry, so it shows up here (disabled, with its note as a tooltip) automatically.
    _stEl("div",{className:"sd-gen-modelrow",role:"radiogroup","aria-label":"Model"},
      SEEDANCE_MODELS.map(m=>{
        const planLocked = m.status==="active" && !planAllowsModel(m.id);
        return _stEl("button",{key:m.id,type:"button",
          className:"sd-gen-model"+(modelId===m.id?" on":"")+(m.status==="soon"?" soon":"")+(planLocked?" plan-locked":""),
          disabled:m.status==="soon",
          title:m.status==="soon" ? (m.label+" — "+m.note)
              : planLocked ? (m.label+" — every model unlocks on the Director plan. Click to upgrade.")
              : m.label,
          onClick:()=>{ if(m.status!=="active") return;
            if(planLocked){ openPlansUpsell(); return; }
            setModelId(m.id); const t0=seedanceTierOf(m,tier); if(t0) setTier(t0.id); }},
          m.label,
          m.status==="soon" && _stEl("span",{className:"sd-gen-model-soon"},"Soon"),
          planLocked && _stEl("span",{className:"sd-gen-model-soon plan"},"Director"));
      })),
    !!(model.tiers||[]).length && _ctrlRow("Tier", _stEl("div",{className:"sd-gen-quality"},
      model.tiers.map(t0=>_stEl("button",{key:t0.id,className:tier===t0.id?"on":"",type:"button",title:t0.note,onClick:()=>setTier(t0.id)},
        t0.fast&&Icon.sparkles&&_stEl(Icon.sparkles,{s:12}),t0.label)))),
    _ctrlRow("Resolution", _stEl("div",{className:"stage2-respills"},
      STAGE_RESOLUTIONS.map(r=>{
         const serverPending=!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget);
         const planLocked = stageResAllowed(tierObj, r) && !serverPending && !planAllowsRes(r);
        if(planLocked) return _stEl("button",{key:r,type:"button",
          className:"stage2-respill plan-locked"+(resolution===r?" on":""),
          title:planResNote(r)+" — click to upgrade",
          onClick:openPlansUpsell}, r, _stEl("span",{className:"respill-lock"},"↑"));
         const disabled = !stageResAllowed(tierObj, r)||serverPending;
        const reachable = (model.tiers||[]).some(t0=>stageResAllowed(t0, r));   // any tier of THIS model
        return _stEl("button",{key:r,type:"button",className:"stage2-respill"+(resolution===r?" on":""),
           disabled,"aria-disabled":disabled?"true":undefined,
           title:serverPending?"Pending server update — awaiting the video proxy capability handshake"
             :disabled?(reachable?(r+" needs the Standard tier"):(r+" isn't available on "+model.label)):(r==="4K"?"4K — ~5× the 720p credit rate":r),
           onClick:()=>{if(!disabled)setResolution(r);}}, r);
      }))),
    _ctrlRow("Duration", _stEl("select",{value:String(duration),
        title: durationLocked ? ("Minimum "+_fmtSecs(measuredSec)+" — the measured voice + breathing room; extend for more acting time") : "Clip duration",
        onChange:e=>{ const v=Number(e.target.value); setDurationOverride(durationLocked && v===measuredSec ? null : v); }},
        _uniq([duration, measuredSec||0, 4,5,6,8,10,12,15, model.maxClipSec||15])
          .filter(v=> v>0 && v<=(model.maxClipSec||15) && (!durationLocked || v>=measuredSec))
          .sort((a,b)=>a-b)
          .map(v=>_stEl("option",{key:v,value:String(v)},_fmtSecs(v)+(durationLocked&&v===measuredSec?" · voice + air (min)":""))))),
    // the cost math, spelled out — updates live with any choice above (and the batch pill)
    _stEl("div",{className:"stage2-rc-math",title:creditInfo.title},
      (batchN>1 ? (batchN+" takes × ") : "")+_fmtSecs(duration)+" × "+resolution+" × "+tierObj.label
        +" = "+totalCost+" credit"+(totalCost!==1?"s":"")
        +(creditInfo.known ? (" · "+creditInfo.remaining+" remaining") : "")),
    // capabilities as compact chips (full text on hover) — replaces the long text list
    _stEl("div",{className:"stage2-rc-caps"},
      (model.capabilities||[]).map((txt,i)=>
        _stEl("span",{key:i,className:"stage2-rc-cap",title:txt}, _firstWords(txt, 4)))));
  const tabModel = _stEl(React.Fragment,null,
    _stEl("div",{className:"sd-gen-modegrid"},
      MODES.map(([id,label])=>_stEl("button",{key:id,type:"button",
        className:"sd-gen-mode "+(mode===id?"on":""),
        onClick:()=>setModeOverride(id===autoMode?null:id),
        title:id===autoMode?"Auto-selected from current inputs":"Use "+label},
        label.split(" ").map((w,i)=>_stEl(React.Fragment,{key:w+i},i===2?_stEl("br",null):null,w+(i===label.split(" ").length-1?"":" ")))))),
    _stEl("label",{className:"sd-gen-label"},"Advanced"),
    // batch takes — parallel renders with distinct seeds; the Render card's cost
    // multiplies live as this changes (same state as the composer's batch pill)
    _ctrlRow("Batch takes", _stEl("div",{className:"stage2-seedrow stage2-batchrow"},
      _stEl("button",{type:"button",className:"stage2-seed-btn",title:"Fewer takes","aria-label":"Fewer takes",
        disabled:batchN<=1||gening,onClick:()=>setBatchN(n=>Math.max(1,n-1))},"−"),
      _stEl("span",{className:"stage2-batchrow-n",
        title:"Takes per Generate — "+batchN+" parallel render"+(batchN!==1?"s":"")+" with distinct seeds ("+totalCost+" credits total)"},
        batchN+" / "+planMaxBatch),
      _stEl("button",{type:"button",className:"stage2-seed-btn",disabled:batchN>=4||gening,
        title:batchN>=planMaxBatch&&planMaxBatch<4 ? "Batch takes need the Studio plan — click to upgrade" : "More takes",
        onClick:()=>{ if(batchN>=planMaxBatch){ if(planMaxBatch<4) openPlansUpsell(); return; } setBatchN(n=>Math.min(4,n+1)); }},"+"))),
    // bitrate is a Seedance-only lever — Sora-class engines have no bitrate_mode
    modelRefs && _ctrlRow("Bitrate", _stEl("select",{value:bitrate,
        title:"Compression of the delivered file — no cost difference",
        onChange:e=>setBitrate(e.target.value==="high"?"high":"standard")},
      _stEl("option",{value:"high"},"High — less compression, larger file"),
      _stEl("option",{value:"standard"},"Standard — more compression, smaller file"))));
  const tabInputs = _stEl(React.Fragment,null,
    _stEl("label",{className:"sd-gen-label"},"Assets summary"),
    _stEl("div",{className:"sd-gen-summary"},
      [["Text",counts.text,Icon.text],["Images",counts.images,Icon.image],["Videos",counts.videos,Icon.play],["Audio",counts.audio,Icon.mic]].map(([label,n,Ic])=>
        _stEl("div",{className:"sd-gen-summary-card",key:label},
          _stEl("span",null,label),
          _stEl("b",null,Ic&&_stEl(Ic,{s:12}),n)))),
    _stEl("label",{className:"sd-gen-label"},"References"),
    _stEl("div",{className:"sd-gen-refbtns"},
      _stEl("button",{type:"button",className:trayOpen==="refs"?"on":"",
        title:"Every derived input for this render — toggle in/out, inspect",
        onClick:(e)=>openTray("refs", e)},
        Icon.plus&&_stEl(Icon.plus,{s:13}),"All references ("+budgetUsed+"/"+assetLimit+")"),
      _stEl("button",{type:"button",className:trayOpen==="elems"?"on":"",
        title:"The story elements referenced in this clip — cast, location, props",
        onClick:(e)=>openTray("elems", e)},
        (Icon.userScan||Icon.user)&&_stEl(Icon.userScan||Icon.user,{s:13}),"Elements"),
      hasDialogue && modelAudioRefs && _stEl("button",{type:"button",className:trayOpen==="voices"?"on":"",
        title:"Add or remove a character's recorded voice as a reference for this render",
        onClick:(e)=>openTray("voices", e)},
        Icon.mic&&_stEl(Icon.mic,{s:13}),
        "Voices ("+voiceGroups.filter(g=>voiceCharState(g)!=="excluded"&&voiceCharState(g)!=="missing").length+"/"+voiceGroups.length+")")),
    // read-only preview of the auto reference-role block appended at render — kept out
    // of the editable prompt so it always matches the CURRENT included assets.
    refLines.length>0 && _stEl("div",{className:"stage2-gen-refs",title:"Appended to the prompt at render, so Seedance knows what each attached reference is for. Updates as you include/exclude assets."},
      _stEl("b",null,"REFERENCES — added at render"),
      refLines.map((l,i)=>_stEl("span",{key:i},l))),
    _ctrlRow("Visual source", _stEl("select",{value:sourceOverride,
        title:"Which visual source anchors this render. Auto follows the per-clip rule: dialogue or 1 shot → the shot frame; 2 merged shots → the 2-panel storyboard half; 3–4 merged shots → per-shot frames when they fit the image budget, else the 4-panel sheet.",
        onChange:e=>setSourceOverride(e.target.value)},
      _stEl("option",{value:"auto"},"Auto — "+(beatOpeningClip?"beat-opening frame":sourcePlan.label)),
      _stEl("option",{value:"frame"},"Shot frame"),
      _stEl("option",{value:"frames",disabled:beatOpeningClip||(d.shots||[]).length<2},"Per-shot frames"),
      _stEl("option",{value:"halves",disabled:beatOpeningClip||!sourcePlan.hasHalves},"Storyboard halves"+(beatOpeningClip?" — beat-opening uses one frame":sourcePlan.hasHalves?"":" — none saved")),
      _stEl("option",{value:"sheet",disabled:beatOpeningClip||!sourcePlan.hasSheet},"Full storyboard sheet"+(beatOpeningClip?" — beat-opening uses one frame":sourcePlan.hasSheet?"":" — none saved")))),
    _ctrlRow("End frame", _stEl("select",{
        value: endFrameAvailable ? endFrameId : "",
        disabled: !endFrameAvailable,
        title: endFrameAvailable
          ? "Transition this clip's start frame into the chosen end frame — renders through Seedance's dedicated image-to-video endpoint"
          : hasDialogue ? "Unavailable — this clip's lip-synced voice line needs the multimodal endpoint instead"
          : onVideos.length ? "Unavailable while a video reference is included"
          : "No end-frame candidates yet",
        onChange:e=>setEndFrameId(e.target.value)},
      _stEl("option",{value:""},"None — single take"),
      endFrameCandidates.map(c=>_stEl("option",{key:c.id,value:c.id},c.label)))));
  const tabDirector = _stEl(React.Fragment,null,
    _stEl("label",{className:"sd-gen-label"},"Direction"),
    _ctrlRow("Camera profile", _stEl("select",{value:cameraProfile,onChange:e=>setCameraProfile(e.target.value),
        title:"Optional capture-style hint only — it does not override the Art Room Style Preset"},
      stageCameraProfiles.map(v=>_stEl("option",{key:v.id,value:v.id,title:v.desc||""},v.label)))),
    _ctrlRow("Camera movement", _stEl("select",{value:camera,onChange:e=>setCamera(e.target.value)},
      _uniq([camera,...SEEDANCE_CAMERA_MOVES].filter(Boolean)).map(v=>_stEl("option",{key:v,value:v},v)))),
    _ctrlRow("Lighting", _stEl("select",{value:lighting,onChange:e=>setLighting(e.target.value)},
      _uniq([lighting,"Blue night + Warm practicals","Moonlit rain","Backlit silhouette","Soft ambient glow","High contrast noir"].filter(Boolean)).map(v=>_stEl("option",{key:v,value:v},v)))),
    _ctrlRow("Performance", _stEl("select",{value:perf,onChange:e=>setPerf(e.target.value)},
      _uniq([perf,d.lead].concat(dialogueSpeakers).filter(Boolean)).map(v=>_stEl("option",{key:v,value:v},v)))),
    _stEl("label",{className:"sd-gen-label"},"Timing & sound"),
    _ctrlRow("Audio", (hasDialogue && modelAudioRefs)
      ? _stEl("select",{value:dialogueAudio,
          title:"Locked voice lip-syncs to your ElevenLabs lines; Native performance lets the model act the lines itself (swap voices in post)",
          onChange:e=>setDialogueAudio(e.target.value==="native"?"native":"locked")},
          _stEl("option",{value:"locked"},"Locked voice — lip-synced to your lines"),
          _stEl("option",{value:"native"},"Native performance — model acts the lines"))
      : (hasDialogue && !modelAudioRefs)
      ? _stEl("select",{value:"native",disabled:true,onChange:()=>{}},
          _stEl("option",{value:"native"},"Native — the model voices the lines"))
      : _stEl("select",{value:nativeAudio?"on":"off",onChange:e=>setNativeAudio(e.target.value==="on")},
          _stEl("option",{value:"on"},"Generate native audio"),
          _stEl("option",{value:"off"},"Silent — no audio"))),
    _ctrlRow("Seed", modelRefs ? _stEl("div",{className:"stage2-seedrow"},
      _stEl("input",{className:"stage2-seed-input",type:"text",inputMode:"numeric",placeholder:"Random",
        value:seedInput, onChange:e=>setSeedInput(e.target.value.replace(/[^0-9]/g,""))}),
      lastSeed!=null && _stEl("button",{type:"button",className:"stage2-seed-btn",title:"Reuse the last rendered seed ("+lastSeed+")",onClick:()=>setSeedInput(String(lastSeed))},"↺"),
      seedInput && _stEl("button",{type:"button",className:"stage2-seed-btn",title:"Clear — render with a random seed",onClick:()=>setSeedInput("")},"✕"))
      : _stEl("select",{value:"na",disabled:true,onChange:()=>{}},
          _stEl("option",{value:"na"},"No seed control on this model"))),
    _stEl("div",{className:"sd-gen-pills"},
      _stEl("button",{type:"button",title:measuredSec?("Voice + breathing room = "+_fmtSecs(measuredSec)+" minimum — rendering "+_fmtSecs(duration)):"Estimated clip duration"},
        Icon.clock&&_stEl(Icon.clock,{s:14}), _fmtSecs(duration)),
      _stEl("button",{type:"button",title:"Aspect ratio"},
        Icon.monitor&&_stEl(Icon.monitor,{s:14}), effAspect||"16:9"),
      _stEl("button",{type:"button",title:hasDialogue ? (voiceReady?"Audio is on":"Voice this clip before rendering") : "No dialogue; native/silent audio"},
        Icon.mic&&_stEl(Icon.mic,{s:14}), hasDialogue ? (voiceReady?"ON":"NEEDS") : "ON")));
  const settings = _stEl("div",{className:"stage2-settings-drawer"},
    _stEl("div",{className:"stage2-settings-head"},
      _stEl("span",{className:"eyebrow"}, Icon.grid&&_stEl(Icon.grid,{s:12}),
        _stEl("span",{style:{marginLeft:7}},"Render settings")),
      _stEl("button",{className:"panel-collapse",onClick:()=>setSettingsOpen(false),title:"Collapse render settings"},
        Icon.chevR&&_stEl(Icon.chevR,{s:14}))),
    // the unified Render card leads — cost-bearing choices + live price, above the tabs
    _stEl("div",{className:"stage2-rc-wrap"}, renderCard),
    // the Writers' Room INSPECTOR tab style (underline .insp-tab), reused verbatim
    _stEl("div",{className:"insp-tabs stage2-settings-tabs"},
      panelTabs.map(([id,lab])=>_stEl("button",{key:id,className:"insp-tab"+(panelTab===id?" on":""),type:"button",
        onClick:()=>setPanelTab(id)},lab))),
    _stEl("div",{className:"sd-gen-panel"},
      panelTab==="model" && tabModel,
      panelTab==="inputs" && tabInputs,
      panelTab==="director" && tabDirector,
      needsVoice && onVoiceLine && _stEl("button",{className:"sd-gen-voice",type:"button",onClick:onVoiceClip,disabled:voicingClip},
        Icon.mic&&_stEl(Icon.mic,{s:14}), voicingClip?"Voicing…":"Voice clip first"),
      genErr && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:13}), genErr),
      sourceBlocking && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:13}), "No storyboard source is ready yet."),
      assetOver && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:13}), "Asset budget is over by "+budgetOverBy+". Exclude optional assets in the center panel."),
      creditInfo.empty && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:13}), "No generation credits remaining."),
      gening
        ? _stEl("div",{className:"stage2-gen-busy sd-gen-busy"},
            _stEl("div",{className:"stage2-gen-prog"}, _stEl("div",{className:"orb"}), genBusyLabel),
            _stEl("button",{className:"sd-gen-cancel",type:"button",onClick:()=>{ stagingCancelRef.current=true; gen.cancel(); }},"Cancel render"))
        : _stEl("button",{className:"sd-gen-submit"+(blocker?" blocked":""),type:"button",
            title: blocker ? (blocker.text+" (click to see why)") : renderCostTitle,
            "aria-disabled": blocker ? "true" : undefined, disabled:gening,
            onClick:()=>{ if(gening) return; if(blocker){ onBlockedGenerate(); return; } onGenerate(); }},
            playerUrl?"Regenerate clip":"Generate clip", Icon.sparkles&&_stEl(Icon.sparkles,{s:15})),
      _stEl("button",{className:"sd-gen-extend",type:"button",onClick:onExtend,disabled:!playerUrl||gening||creditInfo.empty},
        Icon.pencil&&_stEl(Icon.pencil,{s:13}),"Extend / edit"),
      _stEl("div",{className:"stage2-credit sd-gen-credit"+(creditInfo.empty?" empty":""),title:creditInfo.title},
        Icon.sparkles&&_stEl(Icon.sparkles,{s:11}),creditInfo.label),
      lastSeed!=null && _stEl("div",{className:"stage2-credit sd-gen-credit",title:"The seed fal returned for the last render — reuse it from the Seed control for repeatable variations"},
        "Seed "+lastSeed)));

  const lightbox = maxImg && (maxImg.kind==="video"
    ? _stEl("div",{className:"stage2-lightbox",onClick:()=>setMaxImg(null)},
        _stEl("button",{className:"stage2-lightbox-x",title:"Close",onClick:()=>setMaxImg(null)}, Icon.x&&_stEl(Icon.x,{s:18})),
        _stEl("video",{className:"stage2-lightbox-media",src:maxImg.url,controls:true,autoPlay:true,playsInline:true,onClick:(e)=>e.stopPropagation()}),
        maxImg.label && _stEl("div",{className:"stage2-lightbox-cap"}, maxImg.label))
    : _stEl("div",{className:"lb-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) setMaxImg(null); }},
        _stEl("div",{className:"lb-panel"},
          _stEl("div",{className:"lb-head"},
            _stEl("span",{className:"lb-title"}, maxImg.label || "Image preview"),
            _stEl("button",{className:"ag-x",title:"Close",onClick:()=>setMaxImg(null)}, Icon.x&&_stEl(Icon.x,{s:17}))),
          _stEl("div",{className:"lb-imgwrap"},
            _stEl("img",{className:"lb-img",src:maxImg.url,alt:maxImg.label||"full view"})))));
  // buttoned strip, matching the Writers' Room Story/Inspector strips exactly
  const settingsStrip = (typeof CollapsedStrip!=="undefined")
    ? _stEl(CollapsedStrip,{ side:"right", label:"Render settings", icon:Icon.panelRight||Icon.grid, onExpand:()=>setSettingsOpen(true) })
    : _stEl("button",{className:"strip right strip-clickable",onClick:()=>setSettingsOpen(true),title:"Expand render settings"},
        _stEl("div",{className:"strip-label"},"Render settings"));
  return _stEl("div",{className:"stage2-console stage2-console-composer"+(settingsOpen?" settings-open":"")},
    center, settingsOpen ? settings : settingsStrip, lightbox);
}
function _ctrlRow(label, control){ return _stEl("div",{className:"stage2-ctrl"},
  _stEl("span",{className:"stage2-ctrl-l"}, label), control); }

/* ---- VERSIONS view — every take this clip has rendered, as reviewable versions.
   Left: version cards (stable vN + status + facts). Center: player + version details.
   Right: iteration tools (restore / approve / reuse / branch / delete) + filters.
   Takes come from vidGetTakes (current first); actions run through window.vid* helpers
   and refresh via the vid-done event the console already listens to. ---- */
function _stageVAudioLabel(a){ return a==="voice" ? "Locked voice" : a==="native" ? "Native audio" : a==="silent" ? "Silent" : ""; }
function _stageVSourceLabel(s){ const m = STAGE_SOURCE_MODES[s]; return (m&&m.label)||""; }
function _stageVRecipeLabel(r){ if(r==="scene") return "Whole scene"; const row = SEEDANCE_RECIPES.find(x=>x[0]===r); return (row&&row[1])||""; }
function _stageTakeRefs(meta){
  const refs = (meta&&Array.isArray(meta.references)) ? meta.references : [];
  return refs.filter(r=>r&&r.label).slice(0,40);
}
function _stagePromptCopy(txt){
  txt = String(txt||"");
  if(!txt) return;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt);
      if(window.appToast) window.appToast("Prompt copied.","ok");
    }
  }catch(e){}
}
/* the VERSIONS view — a full Stage tab (was a per-clip modal). Loads the selected
   clip's takes itself, mutates them via the window.vid* helpers, and hands "Reuse /
   Branch" back to the Stage tab through onReuse (the composer applies the settings). */
function StageVersionsView({ clip, stageModel, onBack, onReuse }){
  const clipId = clip && clip.id;
  const [takes, setTakes] = React.useState(()=> (clipId && typeof vidGetTakes==="function") ? vidGetTakes(clipId) : []);
  React.useEffect(()=>{ let alive=true;
    if(clipId && typeof vidLoadTakes==="function") vidLoadTakes(clipId).then(t=>{ if(alive) setTakes(t||[]); });
    const onDone=(e)=>{ if(alive && e.detail && e.detail.ids && e.detail.ids.indexOf(clipId)>=0 && typeof vidGetTakes==="function") setTakes(vidGetTakes(clipId)); };
    window.addEventListener("vid-done", onDone);
    return ()=>{ alive=false; window.removeEventListener("vid-done", onDone); };
  }, [clipId]);
  const [selUrl, setSelUrl] = React.useState((takes[0]&&takes[0].url)||"");
  const [fStatus, setFStatus] = React.useState("all");
  const [fSource, setFSource] = React.useState("all");
  const [sortNew, setSortNew] = React.useState(true);
  // keep the selection valid when takes change under us (restore/delete re-order the list)
  React.useEffect(()=>{ if(!takes.some(t=>t.url===selUrl)) setSelUrl((takes[0]&&takes[0].url)||""); }, [takes.map(t=>t.url).join("|")]);
  const sel = takes.find(t=>t.url===selUrl) || takes[0] || null;
  const selMeta = (sel&&sel.meta)||{};
  const selApproved = selMeta.status==="approved";
  const selRefs = _stageTakeRefs(selMeta);
  const selPrompt = String(selMeta.prompt||"").trim();
  const versionSourceStatus = (t)=> typeof shotSourcesStatus==="function"
    ? shotSourcesStatus(((clip&&clip.data&&clip.data.shots)||[]),
        ((window.turnContinuity||{}).drafts||{}),(t&&t.meta)||{}) : "unverified";
  const selSourceStatus=sel?versionSourceStatus(sel):"";
  const currentPropDependencies=(typeof stageClipPropDependencySignature==="function")
    ? stageClipPropDependencySignature((clip&&clip.data)||{},clip&&clip.scene&&clip.scene.id,window.turnContinuity||{}) : "";
  const propDependenciesStale=(t)=>!!(t&&t.meta&&t.meta.propDependencies!=null
    && t.meta.propDependencies!==currentPropDependencies);
  const referenceVersionsStale=(t)=>{
    const refs=(t&&t.meta&&t.meta.referenceSourceVersions)||[];
    if(!refs.length||typeof window.stageReferenceStatus!=="function") return false;
    return refs.some(r=>{ const s=window.stageReferenceStatus({imageId:r.assetId,snapshot:r.snapshot});
      return s.missing||s.excluded||s.stale||!s.approved; });
  };
  const versionEditorialStatus = (t)=> typeof shotSourcesEditorialStatus==="function"
    ? shotSourcesEditorialStatus(((clip&&clip.data&&clip.data.shots)||[]),
        ((window.turnContinuity||{}).drafts||{}),(t&&t.meta)||{}) : versionSourceStatus(t);
  const selEditorialStatus=sel?versionEditorialStatus(sel):"";
  const sourceOverrideSnapshot=()=> typeof shotSourcesSnapshot==="function"
    ? shotSourcesSnapshot(((clip&&clip.data&&clip.data.shots)||[]),((window.turnContinuity||{}).drafts||{})) : [];
  const confirmSourceOverride=async(t,verb,recordOverride=true)=>{
    const status=versionSourceStatus(t);
    const refsStale=referenceVersionsStale(t);
    if((status==="current"||versionEditorialStatus(t)==="override")&&!refsStale) return true;
    const ok=await window.appConfirm({
      title:(status==="stale"||refsStale?"Use a stale historical take?":"Use an unverified legacy take?"),
      body:(refsStale
        ?"One or more character appearance, location coverage or prop-state references changed, is missing, or is not currently approved."
        : status==="stale"
        ?"This take was rendered from older shot specifications or screenplay text."
        :"This legacy take has no source-revision stamp, so its match to current coverage cannot be verified.")
        +" "+verb+" records an explicit override tied to the current shot sources. The override expires automatically after another source change.",
      confirmLabel:verb+" with override",danger:true
    });
    if(!ok) return false;
    if(recordOverride&&window.vidUpdateTake) await window.vidUpdateTake(clipId,t.url,{sourceOverride:sourceOverrideSnapshot()});
    return true;
  };
  const act = {
    approve:async(t,on)=>{
      if(!window.vidApproveTake) return;
      if(on && !(await confirmSourceOverride(t,"Approve"))) return;
      await window.vidApproveTake(clipId,t.url,on);
    },
    restore:async(t)=>{
      if(!window.vidRestoreTake || !(await confirmSourceOverride(t,"Restore"))) return;
      await window.vidRestoreTake(clipId,t.url);
      if(typeof window.appToast==="function") window.appToast(
        versionSourceStatus(t)==="current"
          ?"Restored as the current take — the filmstrip and assembly use it now."
          :"Restored with an explicit source override — the filmstrip and assembly may use it until the sources change.","ok");
    },
    del:(url)=>{ if(!window.vidDeleteTake) return;
      if(window.confirm("Delete this take? The rendered video link is removed from this clip's versions.")) window.vidDeleteTake(clipId, url); },
    note:(url,text)=>{ if(window.vidUpdateTake) window.vidUpdateTake(clipId, url, { note:String(text||"").slice(0,300) }); },
  };
  const list = takes.filter(t=>{
    const m = t.meta||{};
    if(fStatus==="approved" && m.status!=="approved") return false;
    if(fStatus==="drafts" && (m.status==="approved" || t.current)) return false;
    if(fSource!=="all" && m.source!==fSource) return false;
    return true;
  }).slice().sort((a,b)=>{
    const ka=((a.meta||{}).createdAt)||0, kb=((b.meta||{}).createdAt)||0;
    return sortNew ? (kb-ka) : (ka-kb);
  });
  const statusBadges = (t)=>{
    const m = t.meta||{}, out = [];
    if(t.current) out.push(_stEl("span",{key:"c",className:"stage2-vbadge current"},"Current"));
    if(m.status==="approved") out.push(_stEl("span",{key:"a",className:"stage2-vbadge approved"},"Approved"));
    if(!t.current && m.status!=="approved") out.push(_stEl("span",{key:"d",className:"stage2-vbadge draft"},"Draft"));
    const sourceStatus=versionSourceStatus(t);
    const editorialStatus=versionEditorialStatus(t);
    if(editorialStatus==="override") out.push(_stEl("span",{key:"o",className:"stage2-vbadge override"},"Source override"));
    else if(sourceStatus!=="current") out.push(_stEl("span",{key:"s",className:"stage2-vbadge "+sourceStatus},
      sourceStatus==="stale"?"Stale source":"Source unverified"));
    if(propDependenciesStale(t)) out.push(_stEl("span",{key:"p",className:"stage2-vbadge stale"},"Prop reference changed"));
    if(referenceVersionsStale(t)) out.push(_stEl("span",{key:"r",className:"stage2-vbadge stale"},"References need review"));
    return out;
  };
  const detailRows = sel ? [
    ["Model", (selMeta.model||"").indexOf("sora-2")>=0
      ? ("Sora 2"+((selMeta.model||"").indexOf("/pro")>=0?" · Pro":""))
      : (selMeta.model||"").indexOf("seedance-2.0")>=0
      ? ("Seedance 2.0"+((selMeta.model||"").indexOf("/fast/")>=0?" · Fast":"")+((selMeta.model||"").indexOf("image-to-video")>=0?" · transition":""))
      : (selMeta.model||"Seedance 2.0")],
    ["Workflow", _stageVSourceLabel(selMeta.source) || "—"],
    ["Duration", selMeta.durationSec ? (selMeta.durationSec+"s") : (selMeta.durationMs ? Math.round(selMeta.durationMs/1000)+"s" : "—")],
    ["Inputs", selMeta.inputs || "—"],
    ["Audio", _stageVAudioLabel(selMeta.audio) || "—"],
    ["Quality", [selMeta.tierLabel||selMeta.tier, selMeta.resolution, selMeta.bitrate==="high"?"high bitrate":null].filter(Boolean).join(" · ") || "—"],
    ["Camera profile", selMeta.cameraProfileLabel || "Project default / None"],
    ["Recipe", _stageVRecipeLabel(selMeta.recipe) || "—"],
    ["Seed", selMeta.seed!=null ? String(selMeta.seed) : "—"],
    ["Take", selMeta.batchCount>1 ? (selMeta.batchIndex+" of "+selMeta.batchCount+" (batch)") : "single"],
    ["Created", selMeta.createdAt ? new Date(selMeta.createdAt).toLocaleString() : "—"],
  ] : [];
  // right-column MODEL CARD (mockup-style): the active engine + its capability chips
  const modelCard = stageModel && _stEl("div",{className:"stage2-vers-model"},
    _stEl("div",{className:"stage2-vers-model-t"}, stageModel.label,
      _stEl("span",{className:"stage2-vers-model-badge"}, stageModel.metaDur||"")),
    _stEl("div",{className:"stage2-vers-model-caps"},
      (stageModel.capabilities||[]).slice(0,8).map((c,i)=>_stEl("div",{key:i,className:"stage2-vers-cap"},
        _stEl("span",{className:"stage2-vers-cap-dot"}), c))));
  return _stEl("div",{className:"stage2-vers"},
      _stEl("div",{className:"stage2-versions-head"},
        _stEl("button",{className:"stage2-iconbtn",title:"Back to Shoot",onClick:onBack}, Icon.chevL&&_stEl(Icon.chevL,{s:15})),
        _stEl("div",{className:"stage2-versions-title"},
          Icon.layers&&_stEl(Icon.layers,{s:14}), "Takes",
          _stEl("span",{className:"stage2-versions-sub"}, (clip&&clip.label)||"")),
        _stEl("span",{className:"stage2-versions-count"}, takes.length+(takes.length===1?" take":" takes")),
        _stEl("button",{className:"stage2-iconbtn",title:"Back to Shoot",onClick:onBack}, Icon.x&&_stEl(Icon.x,{s:15}))),
      _stEl("div",{className:"stage2-versions-body"},
        // left — version cards
        _stEl("div",{className:"stage2-versions-list"},
          list.length ? list.map(t=>{
            const m = t.meta||{};
            return _stEl("button",{key:t.url,type:"button",
              className:"stage2-vcard"+(sel&&sel.url===t.url?" sel":""),
              onClick:()=>setSelUrl(t.url)},
              _stEl("video",{className:"stage2-vcard-thumb",src:t.url+"#t=0.1",preload:"metadata",muted:true,playsInline:true}),
              _stEl("div",{className:"stage2-vcard-main"},
                _stEl("div",{className:"stage2-vcard-row"},
                  _stEl("span",{className:"stage2-vcard-vno"}, _stageTakeVno(t, takes, takes.indexOf(t))),
                  statusBadges(t)),
                _stEl("div",{className:"stage2-vcard-chips"},
                  [ m.tierLabel||m.tier, m.resolution,
                    m.source ? (STAGE_SOURCE_SHORT[m.source]||m.source) : null,
                    _stageVAudioLabel(m.audio)||null,
                    m.batchCount>1 ? ("take "+m.batchIndex+"/"+m.batchCount) : null
                  ].filter(Boolean).map((c,i)=>_stEl("span",{key:i,className:"stage2-vchip"},String(c)))),
                m.note && _stEl("div",{className:"stage2-vcard-note"}, m.note),
                _stEl("div",{className:"stage2-vcard-time"}, _stageAgo(m.createdAt)||"")));
          }) : _stEl("div",{className:"stage2-versions-empty"},"No versions match these filters.")),
        // center — player + details
        _stEl("div",{className:"stage2-versions-viewer"},
          sel ? _stEl("video",{key:sel.url,className:"stage2-versions-video",src:sel.url,controls:true,playsInline:true,
            title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget)}) : null,
          sel && _stEl("div",{className:"stage2-versions-details"},
            propDependenciesStale(sel) && _stEl("div",{className:"stage2-source-warning stale"},
              selApproved
                ? "A prop used by this take has changed. This approved take remains pinned; update it only when you intentionally render a new version."
                : "A prop used by this take has changed in the Art Room. Render a new version to use the current prop state and reference sheet."),
            referenceVersionsStale(sel) && _stEl("div",{className:"stage2-source-warning stale"},
              "A character appearance, location coverage or prop-state reference used by this take changed, is missing, or is not currently approved. Review and explicitly confirm before approving, restoring or reusing it."),
            selEditorialStatus!=="current" && _stEl("div",{className:"stage2-source-warning "+selEditorialStatus},
              selEditorialStatus==="override"
                ?"Explicit source override: this historical take is approved for the current shot sources. Any later shot or screenplay change invalidates the override."
                : selSourceStatus==="stale"
                ?"Historical take: its shot specification or screenplay source has changed. Re-render before using it as current editorial coverage."
                :"Legacy take: no shot/source revision stamp is available, so its match to current coverage cannot be verified."),
            _stEl("div",{className:"stage2-versions-dhead"},"Version details"),
            detailRows.map(([k,v])=>_stEl("div",{key:k,className:"stage2-vdetail"},
              _stEl("span",{className:"stage2-vdetail-k"},k), _stEl("span",{className:"stage2-vdetail-v"},v))),
            _stEl("div",{className:"stage2-vdetail notes"},
              _stEl("span",{className:"stage2-vdetail-k"},"Notes"),
              _stEl("input",{key:sel.url,className:"stage2-vnote-input",defaultValue:selMeta.note||"",
	                placeholder:"Why this take matters — e.g. best performance for this beat",
	                onBlur:(e)=>{ const v=e.target.value.trim(); if(v!==(selMeta.note||"")) act.note(sel.url, v); },
	                onKeyDown:(e)=>{ if(e.key==="Enter") e.target.blur(); }})),
            _stEl("div",{className:"stage2-versions-dhead with-action"},
              _stEl("span",null,"Prompt used"),
              selPrompt && _stEl("button",{type:"button",className:"stage2-vcopy",onClick:()=>_stagePromptCopy(selPrompt)},Icon.copy&&_stEl(Icon.copy,{s:12}),"Copy")),
            _stEl("pre",{className:"stage2-vprompt"}, selPrompt || "No prompt metadata was saved for this older take."),
            _stEl("div",{className:"stage2-versions-dhead"},"References used"),
            selRefs.length
              ? _stEl("div",{className:"stage2-vrefs"},
                  selRefs.map((r,i)=>_stEl("button",{key:(r.tag||"ref")+i,type:"button",className:"stage2-vref",
                    title:[r.tag,r.label,r.assetRoleLabel,r.role].filter(Boolean).join(" — ")},
                    r.url && r.kind!=="audio" ? (r.kind==="video"
                      ? _stEl("video",{src:r.url,muted:true,playsInline:true,preload:"metadata"})
                      : _stEl("img",{src:r.url,alt:"",loading:"lazy"}))
                      : _stEl("span",{className:"stage2-vref-tile"}, r.kind==="audio" ? "♪" : r.kind==="text" ? "T" : "•"),
                    _stEl("span",{className:"stage2-vref-copy"},
                      _stEl("b",null,[r.tag,r.label].filter(Boolean).join(" · ")),
                      r.assetRoleLabel && _stEl("em",null,r.assetRoleLabel),
                      r.role && _stEl("small",null,r.role)))))
              : _stEl("div",{className:"stage2-vrefs-empty"},"No reference assets were attached to this take, or this older take was saved before reference snapshots existed."))),
        // right — model card + iteration tools + filters
        _stEl("div",{className:"stage2-versions-tools"},
          modelCard,
          _stEl("div",{className:"stage2-versions-dhead"},"Iteration tools"),
          _stEl("button",{className:"stage2-vtool",disabled:!sel||!!(sel&&sel.current),
            title:"Make this take the clip's current video — the filmstrip and assembly use it",
             onClick:()=>sel&&act.restore(sel)}, "Restore as current"),
          _stEl("button",{className:"stage2-vtool"+(selApproved?" on":""),disabled:!sel,
            title:selApproved?"Remove the approval star":"Star this take as the clip's approved version — it never rolls off the version list",
             onClick:()=>sel&&act.approve(sel, !selApproved)}, selApproved?"★ Approved — unstar":"☆ Approve this take"),
          _stEl("button",{className:"stage2-vtool",disabled:!sel,
            title:"Load this take's visual source, tier, resolution, bitrate and recipe back into the Stage composer",
            onClick:async()=>{ if(sel&&await confirmSourceOverride(sel,"Reuse",false)) onReuse(selMeta,false); }}, "Reuse settings"),
          _stEl("button",{className:"stage2-vtool",disabled:!sel||selMeta.seed==null,
            title:"Reuse settings AND pin this take's seed — Generate renders a controlled variation",
            onClick:async()=>{ if(sel&&await confirmSourceOverride(sel,"Branch",false)) onReuse(selMeta,true); }}, "Branch from version"),
          sel && _stEl("a",{className:"stage2-vtool link",href:sel.url,target:"_blank",rel:"noreferrer",download:""},"Download / open"),
          _stEl("button",{className:"stage2-vtool danger",disabled:!sel,
            onClick:()=>sel&&act.del(sel.url)}, "Delete take"),
          _stEl("div",{className:"stage2-versions-dhead filters"},"Filters"),
          _stEl("label",{className:"stage2-vfilter"},"Status",
            _stEl("select",{value:fStatus,onChange:(e)=>setFStatus(e.target.value)},
              _stEl("option",{value:"all"},"All"),
              _stEl("option",{value:"approved"},"Approved"),
              _stEl("option",{value:"drafts"},"Drafts"))),
          _stEl("label",{className:"stage2-vfilter"},"Source",
            _stEl("select",{value:fSource,onChange:(e)=>setFSource(e.target.value)},
              _stEl("option",{value:"all"},"All sources"),
              Object.keys(STAGE_SOURCE_MODES).map(k=>_stEl("option",{key:k,value:k},_stageVSourceLabel(k)||k)))),
          _stEl("label",{className:"stage2-vfilter"},"Sort",
            _stEl("select",{value:sortNew?"new":"old",onChange:(e)=>setSortNew(e.target.value==="new")},
              _stEl("option",{value:"new"},"Newest first"),
              _stEl("option",{value:"old"},"Oldest first"))))));
}

/* where each voiced line lands inside its clip — the SAME CLIP_AIR walk the clock and
   the Timeline recipe use, so the post mixer lays the pristine ElevenLabs lines exactly
   where the render was told to put them. */
function clipLinePlacements(clip, auds){
  const shots = ((clip&&clip.data&&clip.data.shots)||[]);
  const out = []; let t = CLIP_AIR.lead, spoken = 0;
  shots.forEach(sh=>{
    const talks = String((sh&&sh.dialogue)||"").trim();
    if(talks){
      if(spoken>0) t += CLIP_AIR.gap;
      const sec = Number((sh.lineAudio||{}).durationMs||0)/1000 || ((typeof _seedanceVoiceSec==="function")?_seedanceVoiceSec(sh):2);
      const p = (((clip.data||{}).panelLines)||[]).find(x=>x&&x.shotId===sh.id);
      out.push({ shotId:sh.id, at:Math.round(t*10)/10, sec:Math.round(sec*10)/10,
        url:(auds&&auds[sh.id])||"", speaker:(p&&p.speaker&&p.speaker.name)||(sh.lineAudio&&sh.lineAudio.speaker)||"Line",
        text:String(sh.dialogue||"").trim() });
      t += sec; spoken++;
    } else t += Math.min(3.5, (typeof stageShotRuntime==="function") ? stageShotRuntime(sh) : 2);
  });
  return out;
}

/* ---- FILM EXPORT — stitch every rendered clip's current take into ONE movie,
   entirely in the browser: each take plays through a hidden <video> into a canvas
   + WebAudio graph feeding a single MediaRecorder, so the export runs in REAL TIME
   (a 3-minute film records for ~3 minutes) and lands as a WebM download — the only
   format browsers can record natively. Needs the provider CDN to allow cross-site
   reads (fal.media sends CORS headers); a blocked read aborts with a plain
   explanation instead of a corrupt file. ---- */
function stageExportPlaylist(ordered, vids){
  return (ordered||[]).filter(c=>c && vids && vids[c.id]).map(c=>({ id:c.id, label:c.label||"", url:vids[c.id] }));
}
window.stageExportPlaylist = stageExportPlaylist;   // pure — covered by the vm suite
async function stageExportFilm(playlist, opts){
  opts = opts||{};
  if(!playlist || !playlist.length) throw new Error("No rendered clips to export yet — render takes in the Shoot tab first.");
  if(typeof MediaRecorder==="undefined") throw new Error("This browser can't record video (MediaRecorder missing) — try Chrome or Edge.");
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; video.playsInline = true; video.preload = "auto";
  const AC = window.AudioContext||window.webkitAudioContext;
  const ac = new AC();
  /* the element's sound goes into the RECORDING only, not the speakers: a
     MediaElementSource takes over the element's output, and the graph never
     connects to ac.destination. */
  const srcNode = ac.createMediaElementSource(video);
  const dest = ac.createMediaStreamDestination();
  srcNode.connect(dest);
  const loadClip = (url)=> new Promise((res,rej)=>{
    video.onloadedmetadata = ()=>res();
    video.onerror = ()=>rej(new Error("A take couldn't be loaded for export — its video URL may have expired. Re-render that clip and try again."));
    video.src = url; video.load();
  });
  let raf = 0, failed = null, taintChecked = false, rec = null, stream = null;
  // ONE finalization path — every exit (success, cancel, load failure, CORS
  // taint) lands in `finally`, which must also stop the recorder and capture
  // tracks or a cancelled export leaks a live recorder + camera-style tracks.
  const cleanup = ()=>{ try{ cancelAnimationFrame(raf); }catch(e){}
    try{ if(rec && rec.state!=="inactive") rec.stop(); }catch(e){}
    try{ if(stream) stream.getTracks().forEach(t=>t.stop()); }catch(e){}
    try{ video.pause(); video.removeAttribute("src"); video.load(); }catch(e){}
    try{ srcNode.disconnect(); }catch(e){}
    try{ ac.close(); }catch(e){} };
  try{
    await loadClip(playlist[0].url);
    const vw = video.videoWidth||1280, vh = video.videoHeight||720;
    const scale = Math.min(1, 1920/Math.max(vw,vh));
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(vw*scale/2)*2); cv.height = Math.max(2, Math.round(vh*scale/2)*2);
    const cx = cv.getContext("2d");
    cx.fillStyle = "#000"; cx.fillRect(0,0,cv.width,cv.height);
    const mime = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"]
      .find(m=>{ try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || "";
    stream = cv.captureStream(30);
    dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
    rec = new MediaRecorder(stream, mime ? { mimeType:mime, videoBitsPerSecond:8000000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };
    const recStopped = new Promise(res=>{ rec.onstop = ()=>res(); });
    const draw = ()=>{
      if(failed) return;
      try{
        if(video.readyState>=2 && video.videoWidth){
          const s = Math.min(cv.width/video.videoWidth, cv.height/video.videoHeight);
          const w = video.videoWidth*s, h = video.videoHeight*s;
          cx.fillStyle = "#000"; cx.fillRect(0,0,cv.width,cv.height);
          cx.drawImage(video, (cv.width-w)/2, (cv.height-h)/2, w, h);
          // read ONE pixel on the first drawn frame: a CORS-tainted canvas throws
          // HERE, up front, instead of delivering an unplayable file at the end
          if(!taintChecked){ cx.getImageData(0,0,1,1); taintChecked = true; }
        }
      }catch(e){
        failed = new Error("The video provider blocked cross-site reading of a take, so the browser can't record it into one file. Download takes individually from the Takes tab instead.");
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    try{ await ac.resume(); }catch(e){}
    rec.start(1000);
    draw();
    for(let i=0;i<playlist.length;i++){
      if(failed) break;
      if(opts.shouldCancel && opts.shouldCancel()) throw new Error("Export cancelled.");
      if(i>0) await loadClip(playlist[i].url);
      if(opts.onProgress) opts.onProgress(i+1, playlist.length, playlist[i].label);
      await video.play();
      await new Promise((res)=>{
        const tick = setInterval(()=>{ if(failed || (opts.shouldCancel && opts.shouldCancel())){ clearInterval(tick); res(); } }, 250);
        video.onended = ()=>{ clearInterval(tick); res(); };
      });
    }
    if(!failed && opts.shouldCancel && opts.shouldCancel()) failed = new Error("Export cancelled.");
    try{ rec.stop(); }catch(e){}
    await recStopped;
    if(failed) throw failed;
    if(!chunks.length) throw new Error("The recording came out empty — try again, or use a Chromium browser (Chrome/Edge).");
    return new Blob(chunks, { type: mime || "video/webm" });
  } finally { cleanup(); }
}
window.stageExportFilm = stageExportFilm;

/* ---- TIMELINE tab — the FILM ASSEMBLY. Every clip in story order, grouped by scene,
   playing the CURRENT take back-to-back ("Restore as current" in Versions decides what
   plays). Read-only on purpose: the story defines the order; the Stage tab renders,
   the Versions tab picks takes, this tab watches the film. ---- */
function StageTimelineView({ allClips, vids, imgs, visualSource, selId, onSelectClip, onOpenStage }){
  const ordered = allClips||[];
  const startIdx = Math.max(0, ordered.findIndex(c=>c.id===selId));
  const [idx, setIdx] = React.useState(startIdx);
  const [playAll, setPlayAll] = React.useState(false);
  const videoRef = React.useRef(null);
  // follow the rail selection while this tab is open (it used to freeze on the
  // selection captured at mount — picking another clip in the rail did nothing here)
  React.useEffect(()=>{ const i = (allClips||[]).findIndex(c=>c.id===selId); if(i>=0) setIdx(x=> x===i ? x : i); },[selId]);
  const [exporting, setExporting] = React.useState(null);   // { i, n } while recording
  const exportCancelRef = React.useRef(false);
  const doExport = async ()=>{
    const pl = stageExportPlaylist(ordered, vids);
    if(!pl.length) return;
    exportCancelRef.current = false;
    setExporting({ i:0, n:pl.length });
    try{
      const blob = await stageExportFilm(pl, {
        onProgress:(i,n)=>setExporting({ i, n }),
        shouldCancel:()=>exportCancelRef.current });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "TURN-film-"+new Date().toISOString().slice(0,10)+".webm";
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 60000);
      if(typeof window.appToast==="function") window.appToast("Film exported — "+pl.length+" clip"+(pl.length!==1?"s":"")+" stitched into one WebM file.","success");
    }catch(e){
      if(!/cancelled/i.test(String(e&&e.message)) && typeof window.appToast==="function")
        window.appToast(String((e&&e.message)||"Export failed."),"error");
    }finally{ setExporting(null); exportCancelRef.current = false; }
  };
  const cur = ordered[idx] || null;
  const curUrl = cur ? (vids[cur.id]||"") : "";
  const renderedN = ordered.filter(c=>vids[c.id]).length;
  const totalSec = ordered.reduce((t,c)=>t+(Number(c.data&&c.data.dur)||0),0);
  const doneSec = ordered.reduce((t,c)=>t+(vids[c.id]?(Number(c.data&&c.data.dur)||0):0),0);
  const jump = (i, autoplay)=>{ setIdx(i); const c=ordered[i]; if(c && onSelectClip) onSelectClip(c.id);
    if(autoplay) setTimeout(()=>{ try{ videoRef.current && videoRef.current.play(); }catch(e){} }, 60); };
  const nextPlayable = (from)=>{ for(let i=from+1;i<ordered.length;i++){ if(vids[ordered[i].id]) return i; } return -1; };
  const onEnded = ()=>{ if(!playAll) return; const n = nextPlayable(idx); if(n>=0) jump(n, true); else setPlayAll(false); };
  const playFilm = ()=>{ const first = vids[ordered[idx]&&ordered[idx].id] ? idx : nextPlayable(-1);
    if(first<0) return; setPlayAll(true); jump(first, true); };
  // scene grouping for the strip
  const groups = []; ordered.forEach((c,i)=>{ const last=groups[groups.length-1];
    if(last && last.scene.id===c.scene.id) last.items.push({c,i});
    else groups.push({ scene:c.scene, items:[{c,i}] }); });
  return _stEl("div",{className:"stage2-tl"},
    _stEl("div",{className:"stage2-versions-head"},
      _stEl("div",{className:"stage2-versions-title"}, Icon.grid&&_stEl(Icon.grid,{s:14}), "Timeline",
        _stEl("span",{className:"stage2-versions-sub"},"the film, assembled from each clip's current take")),
      _stEl("span",{className:"stage2-versions-count"},
        renderedN+" / "+ordered.length+" clips rendered · "+_fmtSecs(doneSec)+" of ~"+_fmtSecs(totalSec)),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},disabled:!renderedN,
        title:renderedN?"Play every rendered clip in story order":"Render clips in the Shoot tab first",
        onClick:playFilm}, playAll?"Playing…":"▶ Play film"),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},disabled:!renderedN && !exporting,
        title: exporting ? "Recording in real time — click to cancel the export"
          : (renderedN ? "Record every rendered clip into ONE downloadable movie (WebM). Runs in real time — a 3-minute film takes about 3 minutes." : "Render clips in the Shoot tab first"),
        onClick: exporting ? ()=>{ exportCancelRef.current = true; } : doExport},
        exporting ? ("■ Recording "+exporting.i+"/"+exporting.n+"…") : "⬇ Export film")),
    _stEl("div",{className:"stage2-tl-player"},
      curUrl
        ? _stEl("video",{key:curUrl,ref:videoRef,src:curUrl,controls:true,playsInline:true,onEnded,
            title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget),
            poster:cur?clipPrimaryFrame(cur, imgs, visualSource)||undefined:undefined})
        : _stEl("div",{className:"stage2-tl-empty"},
            _stEl("div",null,(cur?cur.label+" isn't rendered yet.":"No clips yet.")),
            cur && _stEl("button",{className:"stage2-vtool",style:{width:"auto"},onClick:()=>onOpenStage&&onOpenStage(cur.id)},"Render it in Shoot"))),
    _stEl("div",{className:"stage2-tl-strip"},
      groups.map(g=>_stEl("div",{key:g.scene.id,className:"stage2-tl-scene"},
        _stEl("div",{className:"stage2-tl-scene-lab"},_pad2(g.scene.no)+" · "+(g.scene.title||g.scene.loc||"Scene")),
        _stEl("div",{className:"stage2-tl-clips"},
          g.items.map(({c,i})=>{
            const has = !!vids[c.id];
            const thumb = clipPrimaryFrame(c, imgs, visualSource);
            return _stEl("button",{key:c.id,type:"button",
              className:"stage2-tl-clip"+(i===idx?" on":"")+(has?"":" missing"),
              title:c.label+(has?" — click to play":" — not rendered yet (double-click to open in the Stage)"),
              onClick:()=>jump(i,false), onDoubleClick:()=>onOpenStage&&onOpenStage(c.id)},
              thumb ? _stEl("img",{src:thumb,alt:""}) : _stEl("span",{className:"stage2-tl-clip-blank"}),
              _stEl("span",{className:"stage2-tl-clip-lab"}, c.label+" · "+_fmtSecs(Number(c.data&&c.data.dur)||0)),
              _stEl("span",{className:"stage2-tl-dot"+(has?" ok":"")})); }))))));
}

/* ---- AUDIO tab — the POST-MIX preview. Generation audio is a scratch track; this is
   where the real sound happens: the pristine ElevenLabs lines auto-placed over the
   picture (same CLIP_AIR walk the prompts used), the clip's native mix duckable under
   them, and imported ambience/music beds per scene. Session-preview for now — export
   lands with the post engine. ---- */
function StageAudioView({ allClips, vids, auds, selId, onSelectClip }){
  const scenes = []; (allClips||[]).forEach(c=>{ if(!scenes.some(s=>s.id===c.scene.id)) scenes.push(c.scene); });
  const selScene = (allClips.find(c=>c.id===selId)||allClips[0]||{}).scene;
  const [sceneId, setSceneId] = React.useState(selScene ? selScene.id : (scenes[0]&&scenes[0].id));
  const sceneClips = (allClips||[]).filter(c=>c.scene.id===sceneId);
  // follow the rail selection while this tab is open (it used to freeze on the
  // scene captured at mount — selecting a clip from another scene did nothing here)
  React.useEffect(()=>{ if(selScene && selScene.id && selScene.id!==sceneId) setSceneId(selScene.id); },[selId]);
  // mix settings survive the session — per film, on this device
  const mixKey = (()=>{ const sc = (typeof window.nbCloudScope==="function") ? window.nbCloudScope() : null;
    return "turn_stage_mix_"+((sc&&sc.projectId)||"local"); })();
  const [gain, setGain] = React.useState(()=>{ try{ const s=JSON.parse(localStorage.getItem(mixKey)||"null");
    if(s&&s.gain&&typeof s.gain.native==="number") return s.gain; }catch(e){} return { native:0.35, dialogue:1, amb:0.7, music:0.5 }; });
  const [mute, setMute] = React.useState(()=>{ try{ const s=JSON.parse(localStorage.getItem(mixKey)||"null");
    if(s&&s.mute) return s.mute; }catch(e){} return {}; });
  React.useEffect(()=>{ try{ localStorage.setItem(mixKey, JSON.stringify({ gain, mute })); }catch(e){} },[gain,mute,mixKey]);
  const [beds, setBeds] = React.useState({});          // {amb:{url,name}, music:{url,name}}
  const [clipIdx, setClipIdx] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef(null);
  const bedRefs = { amb:React.useRef(null), music:React.useRef(null) };
  const live = React.useRef({ timers:[], audios:[] });
  const g = (k)=> mute[k] ? 0 : gain[k];
  const stopLines = ()=>{ live.current.timers.forEach(clearTimeout); live.current.audios.forEach(a=>{ try{ a.pause(); }catch(e){} });
    live.current = { timers:[], audios:[] }; };
  const scheduleLines = (clip)=>{
    stopLines();
    clipLinePlacements(clip, auds).forEach(pl=>{ if(!pl.url) return;
      const t = setTimeout(()=>{ const a = new Audio(pl.url); a.volume = g("dialogue"); live.current.audios.push(a);
        a.play().catch(()=>{}); }, Math.round(pl.at*1000));
      live.current.timers.push(t); });
  };
  const playScene = ()=>{ if(!sceneClips.length) return;
    const first = sceneClips.findIndex(c=>vids[c.id]); if(first<0) return;
    setClipIdx(first); setPlaying(true);
    Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el && beds[k]){ el.volume=g(k); el.currentTime=0; el.play().catch(()=>{}); } });
    setTimeout(()=>{ const v=videoRef.current; if(v){ v.volume=g("native"); v.play().catch(()=>{}); scheduleLines(sceneClips[first]); } }, 80);
  };
  const stopAll = ()=>{ setPlaying(false); stopLines();
    try{ videoRef.current && videoRef.current.pause(); }catch(e){}
    Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el){ try{ el.pause(); }catch(e){} } }); };
  const onClipEnded = ()=>{ if(!playing) return;
    for(let i=clipIdx+1;i<sceneClips.length;i++){ if(vids[sceneClips[i].id]){ setClipIdx(i);
      setTimeout(()=>{ const v=videoRef.current; if(v){ v.volume=g("native"); v.play().catch(()=>{}); scheduleLines(sceneClips[i]); } }, 80);
      return; } }
    stopAll(); };
  React.useEffect(()=>()=>stopAll(), []);
  React.useEffect(()=>{ stopAll(); setClipIdx(0); }, [sceneId]);
  // live volume updates
  React.useEffect(()=>{ const v=videoRef.current; if(v) v.volume=g("native");
    Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el) el.volume=g(k); });
    live.current.audios.forEach(a=>{ a.volume=g("dialogue"); });
  }, [gain, mute]);
  const importBed = (k)=>(e)=>{ const f=e.target.files&&e.target.files[0]; if(!f) return;
    setBeds(b=>({ ...b, [k]:{ url:URL.createObjectURL(f), name:f.name } })); e.target.value=""; };
  const cur = sceneClips[clipIdx];
  const curUrl = cur ? (vids[cur.id]||"") : "";
  const lane = (key, label, extra)=>_stEl("div",{className:"stage2-au-lane"},
    _stEl("div",{className:"stage2-au-lane-h"},
      _stEl("b",null,label),
      _stEl("button",{type:"button",className:"stage2-au-mute"+(mute[key]?" on":""),title:mute[key]?"Unmute":"Mute",
        onClick:()=>setMute(m=>({ ...m, [key]:!m[key] }))}, mute[key]?"M":"🔊"),
      _stEl("input",{type:"range",min:0,max:1,step:0.05,value:gain[key],
        onChange:e=>setGain(x=>({ ...x, [key]:Number(e.target.value) }))})),
    extra);
  return _stEl("div",{className:"stage2-au"},
    _stEl("div",{className:"stage2-versions-head"},
      _stEl("div",{className:"stage2-versions-title"}, Icon.mic&&_stEl(Icon.mic,{s:14}), "Mix",
        _stEl("span",{className:"stage2-versions-sub"},"pristine voices over picture · beds under it · generation audio is the scratch track")),
      _stEl("select",{className:"stage2-au-scene",value:sceneId||"",onChange:e=>setSceneId(e.target.value)},
        scenes.map(s=>_stEl("option",{key:s.id,value:s.id},_pad2(s.no)+" · "+(s.title||s.loc||"Scene")))),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},
        onClick:playing?stopAll:playScene,
        disabled:!sceneClips.some(c=>vids[c.id]),
        title:sceneClips.some(c=>vids[c.id])?"Play the scene with the post mix":"Render this scene's clips first"},
        playing?"■ Stop":"▶ Play scene mix")),
    _stEl("div",{className:"stage2-au-player"},
      curUrl ? _stEl("video",{key:curUrl,ref:videoRef,src:curUrl,controls:true,playsInline:true,onEnded:onClipEnded,
          title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget)})
        : _stEl("div",{className:"stage2-tl-empty"},"This scene has no rendered clips yet — render them in the Shoot tab.")),
    _stEl("div",{className:"stage2-au-lanes"},
      lane("native","Picture (native mix)",
        _stEl("div",{className:"stage2-au-blocks"}, sceneClips.map(c=>_stEl("span",{key:c.id,
          className:"stage2-au-block"+(vids[c.id]?"":" missing")+(cur&&cur.id===c.id?" on":""),
          title:c.label+(vids[c.id]?"":" — not rendered")}, c.label)))),
      lane("dialogue","Dialogue (pristine ElevenLabs)",
        _stEl("div",{className:"stage2-au-blocks"}, sceneClips.flatMap(c=>clipLinePlacements(c, auds).map(pl=>
          _stEl("span",{key:c.id+":"+pl.shotId,className:"stage2-au-block line"+(pl.url?"":" missing"),
            title:pl.speaker+" — \""+pl.text.slice(0,60)+"\" · lands ~"+pl.at+"s into "+c.label+(pl.url?"":" · not voiced yet")},
            pl.speaker+" · "+pl.sec+"s"))))),
      lane("amb","Ambience bed",
        _stEl("div",{className:"stage2-au-blocks"},
          beds.amb ? _stEl("span",{className:"stage2-au-block bed",title:beds.amb.name}, beds.amb.name.slice(0,34)) : _stEl("span",{className:"stage2-au-note"},"No bed yet — import a scene-long ambience file"),
          _stEl("label",{className:"stage2-au-import"},"Import audio",
            _stEl("input",{type:"file",accept:"audio/*",style:{display:"none"},onChange:importBed("amb")})),
          _stEl("audio",{ref:bedRefs.amb,src:(beds.amb&&beds.amb.url)||undefined,loop:true}))),
      lane("music","Music bed",
        _stEl("div",{className:"stage2-au-blocks"},
          beds.music ? _stEl("span",{className:"stage2-au-block bed",title:beds.music.name}, beds.music.name.slice(0,34)) : _stEl("span",{className:"stage2-au-note"},"No bed yet — import a track"),
          _stEl("label",{className:"stage2-au-import"},"Import audio",
            _stEl("input",{type:"file",accept:"audio/*",style:{display:"none"},onChange:importBed("music")})),
          _stEl("audio",{ref:bedRefs.music,src:(beds.music&&beds.music.url)||undefined})))),
    _stEl("div",{className:"stage2-au-note foot"},
      "Preview mix — the picture plays each clip's current take with its native track at the Picture volume; your pristine line audio drops in exactly where the render placed it. Volume and mute settings are remembered per film on this device; imported beds live for this session only. For a downloadable movie, use Export film in the Timeline tab."));
}

/* a composer pill that opens a dropdown of options — the inline alternative to the
   Render-settings panel. The menu renders position:fixed so the controls row's
   horizontal scroll/overflow can't clip it. */
function StagePillMenu({ icon:Ic, label, title, heading, on, disabled, options, onPick, foot }){
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  const [hi, setHi] = React.useState(-1);   // keyboard highlight — arrows move it, Enter picks
  React.useEffect(()=>{
    if(!open) return;
    const close=(e)=>{
      if(btnRef.current && btnRef.current.contains(e.target)) return;
      if(menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const keys=(e)=>{
      if(e.key==="Escape"){ setOpen(false); return; }
      const list = options||[];
      const step = e.key==="ArrowDown" ? 1 : e.key==="ArrowUp" ? -1 : 0;
      if(step){ e.preventDefault();
        // cycle to the next ENABLED option, wrapping at the ends
        setHi(h=>{ let i=h; for(let n=0;n<list.length;n++){ i=(i+step+list.length)%list.length; if(!list[i].disabled) return i; } return h; }); }
      else if(e.key==="Enter" && hi>=0 && list[hi] && !list[hi].disabled){
        e.preventDefault(); setOpen(false); onPick&&onPick(list[hi].value); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keys);
    return ()=>{ document.removeEventListener("mousedown", close); document.removeEventListener("keydown", keys); };
  },[open, hi, options, onPick]);
  const toggle=()=>{
    if(disabled || !(options&&options.length)) return;
    if(!open && btnRef.current){
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left:Math.round(Math.min(r.left, window.innerWidth-300)), top:Math.round(r.bottom+6) });
      // opening pre-highlights the selected option so arrows continue from it
      const sel = options.findIndex(o=>o.selected && !o.disabled);
      setHi(sel>=0 ? sel : options.findIndex(o=>!o.disabled));
    }
    setOpen(o=>!o);
  };
  return _stEl(React.Fragment,null,
    _stEl("button",{ref:btnRef,type:"button",title,
      className:"stage2-gen-pill"+(on?" on":"")+(open?" open":""),
      "aria-haspopup":"menu","aria-expanded":open?"true":"false",
      onClick:toggle},
      Ic&&_stEl(Ic,{s:14}), _stEl("span",null,label)),
    open && pos && _stEl("div",{ref:menuRef,className:"stage2-pill-menu",role:"menu",style:{left:pos.left+"px",top:pos.top+"px"}},
      heading && _stEl("b",{className:"stage2-pill-menu-h"}, heading),
      options.map((o,i)=>_stEl("button",{key:String(o.value),type:"button",role:"menuitemradio","aria-checked":o.selected?"true":"false",
        className:"stage2-pill-opt"+(o.selected?" on":"")+(i===hi?" hi":""),
        disabled:!!o.disabled, title:o.note||undefined,
        onMouseEnter:()=>setHi(i),
        onClick:()=>{ if(o.disabled) return; setOpen(false); onPick&&onPick(o.value); }},
        _stEl("div",{className:"stage2-pill-opt-main"},
          _stEl("span",null,o.label),
          o.tag&&_stEl("small",null,o.tag)),
        // metadata chips (resolution ceiling, duration range…) — spec at a glance
        (o.meta&&o.meta.length>0) && _stEl("div",{className:"stage2-pill-opt-meta"},
          o.meta.map((m,i)=>_stEl("span",{key:i},
            m.icon&&_stEl(m.icon,{s:10}), m.label))),
        // one-line description (e.g. bitrate trade-off)
        o.desc && _stEl("div",{className:"stage2-pill-opt-desc"}, o.desc))),
      foot && _stEl("div",{className:"stage2-pill-menu-foot"}, foot)));
}

/* ================================ the room shell =============================== */
const STAGE_ACT_TITLES = { 1:"Setup", 2:"Complication", 3:"Resolution" };
/* the beat name(s) a clip covers — prefer the stored screenplay text, then fall back to the beat map. */
function screenplayBeatTitle(scene, drafts, beatN, max){
  const fn = typeof window!=="undefined" && window.screenplayBeatExcerpt;
  if(!fn || !scene || !drafts || !drafts[scene.id]) return "";
  try{ return fn(drafts[scene.id], beatN, max||38); }catch(e){ return ""; }
}
// StagePromptArea — ONE mention-aware prompt box shared by every Stage prompt:
// the composer, the Director (primary) box, and each multi-shot row. Typing @
// opens the included-asset dropdown (thumbs + kind chips, Seedance-style);
// arrows/Enter/Tab insert, Esc/blur closes; @Tokens that don't resolve to an
// included asset are flagged under the box. The parent owns the value via
// setValue, so each instance keeps its own dropdown/caret state.
function StagePromptArea(props){
  const max = props.maxLength || 1999;
  const ment = props.mentionables || [];
  const [box, setBox] = React.useState(null);   // {start, query, hi}
  const taRef = React.useRef(null);
  const items = (q)=>{ q=String(q||"").toLowerCase();
    return ment.filter(m=>!q || m.t.toLowerCase().indexOf(q)>=0 || m.label.toLowerCase().indexOf(q)>=0).slice(0,8); };
  const caretToken = (el)=>{ const upto = el.value.slice(0, el.selectionStart||0);
    const m = /(?:^|[\s\n])@([A-Za-z0-9]*)$/.exec(upto);
    return m ? { start:(el.selectionStart||0)-m[1].length-1, query:m[1] } : null; };
  const insert = (m)=>{ const el=taRef.current; if(!el||!box) return;
    // a not-yet-included asset must be included before its token means anything —
    // the parent's onMentionPick does that (returns false when it can't, e.g. budget full)
    if(props.onMentionPick && props.onMentionPick(m)===false){ setBox(null); return; }
    const tok = m.t;
    const caret = el.selectionStart||0;
    const val = String(props.value||"");
    const next = (val.slice(0,box.start)+tok+" "+val.slice(caret)).slice(0,max);
    const pos = box.start+tok.length+1;
    props.setValue(next); setBox(null);
    requestAnimationFrame(()=>{ try{ el.focus(); el.setSelectionRange(pos,pos); }catch(_e){} }); };
  // tokens that don't resolve to an INCLUDED asset (typo, or the asset was excluded) —
  // prospective tokens of not-yet-included assets deliberately don't count as known
  const bad = (()=>{ const known = new Set(ment.filter(m=>m.included!==false).map(m=>m.t.toLowerCase()));
    const out = [], re = /@(image|video|audio)\d+/gi; let mm; const val = String(props.value||"");
    while((mm = re.exec(val))){ if(!known.has(mm[0].toLowerCase()) && out.indexOf(mm[0])<0) out.push(mm[0]); }
    return out; })();
  const list = box ? items(box.query) : [];
  return _stEl("div",{className:"stage2-gen-promptwrap"+(props.fill?" fill":"")},
    _stEl("textarea",{ref:taRef,className:props.className,value:props.value,rows:props.rows,
      placeholder:props.placeholder,maxLength:max,spellCheck:false,title:props.title,
      onChange:(e)=>{ props.setValue(e.target.value.slice(0,max));
        const tk = caretToken(e.target); setBox(tk ? { ...tk, hi:0 } : null); },
      onKeyDown:(e)=>{ if(!box) return;
        if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault();
          setBox(b=>({ ...b, hi:(b.hi+(e.key==="ArrowDown"?1:-1)+Math.max(1,list.length))%Math.max(1,list.length) })); }
        else if((e.key==="Enter"||e.key==="Tab") && list.length){ e.preventDefault();
          insert(list[Math.min(box.hi, list.length-1)]); }
        else if(e.key==="Escape"){ setBox(null); } },
      onBlur:()=>setTimeout(()=>setBox(null),120)}),
    props.warn!==false && bad.length>0 && _stEl("div",{className:"stage2-mention-warn"},
      "⚠ "+bad.join(", ")+" — not among this render's included assets; the model will guess. Fix the token or include the asset."),
    box && list.length>0 && _stEl("div",{className:"stage2-mention-box"},
      list.map((m,i)=>_stEl("button",{key:m.t+":"+(m.key||""),type:"button",
        className:"stage2-mention-item"+(i===box.hi?" hi":""),
        title: m.included===false ? m.label+" — not among this render's inputs yet; picking it includes it" : undefined,
        onMouseDown:e=>{ e.preventDefault(); insert(m); }},
        m.kind==="image" && m.url
          ? _stEl("img",{className:"stage2-mention-thumb",src:m.url,alt:""})
          : _stEl("span",{className:"stage2-mention-thumb tile"},
              m.kind==="video" ? (Icon.film&&_stEl(Icon.film,{s:13})) : (Icon.mic&&_stEl(Icon.mic,{s:13}))),
        _stEl("span",{className:"stage2-mention-main"},
          _stEl("b",null,m.t), m.label && _stEl("span",{className:"stage2-mention-label"},m.label)),
        _stEl("span",{className:"stage2-mention-kind"},
          (m.kind==="image"?"Image":m.kind==="video"?"Video":"Audio")+(m.included===false?" · add":""))))));
}
/* one BEAT's rail name, resolved the way the Art Room names it: the scripted beat
   title first (the canon text the Shots tab shows as "Scripted"), then the beat
   map's drive, then the first shot's own words. */
function stageBeatRailName(scene, drafts, beatsMap, beat){
  const n = beat && beat.n;
  if(n){
    const t = screenplayBeatTitle(scene, drafts, n, 34);
    if(t) return t;
    const rows = ((beatsMap||{})[scene.id]||{}).rows || [];
    const r = rows.find(x=>Number(x.n)===Number(n));
    if(r && r.drive && r.drive.a) return r.drive.a;
  }
  const sh0 = (beat && beat.shots && beat.shots[0]) || {};
  return _firstWords(sh0.action||sh0.dialogue||"", 5);
}
function clipBeatName(clip, beatsMap, drafts){
  const rows = ((beatsMap||{})[clip.scene.id]||{}).rows || [];
  const shots = (clip.g.shots||[]);
  const ns = _uniq(shots.map(sh=>sh.beatN).filter(Boolean));
  const scriptNames = ns.map(n=>screenplayBeatTitle(clip.scene, drafts, n, 34)).filter(Boolean);
  if(scriptNames.length) return scriptNames[0] + (scriptNames.length>1 ? (" +"+(scriptNames.length-1)) : "");
  const shotNames = shots.map(sh=>_firstWords(sh.action||sh.dialogue||"", 5)).filter(Boolean);
  if(shotNames.length) return shotNames[0] + (shotNames.length>1 ? (" +"+(shotNames.length-1)) : "");
  const names = ns.map(n=>{ const r=rows.find(x=>x.n===n); return r && r.drive && r.drive.a; }).filter(Boolean);
  if(!names.length) return _firstWords(clip.data.first.action||clip.scene.title, 3);
  return names[0] + (names.length>1 ? (" +"+(names.length-1)) : "");
}
function chargeColor(s){ const c=Number(s&&s.closeCharge)||0; return c>0?"var(--pos)":c<0?"var(--neg)":"var(--txt-3)"; }
function clipVoiceState(clip, auds){
  const lines = ((clip&&clip.data&&clip.data.lineShots)||[]).filter(sh=>String(sh.dialogue||"").trim());
  if(!lines.length) return { key:"silent", label:"silent" };
  const ready = lines.filter(sh=>_shotAudioReady(sh, auds)).length;
  if(ready===lines.length) return { key:"ready", label:"voice ✓" };
  if(ready>0) return { key:"partial", label:ready+"/"+lines.length+" voice" };
  return { key:"missing", label:"needs voice" };
}
function clipFrameState(clip, imgs, visualSource){
  if(visualSource==="halves"){
    const story = storyboardClipAssets(clip, imgs);
    if((story.halves||[]).length || story.top || story.bottom) return { key:"ready", label:"halves ✓" };
    if(story.sheet) return { key:"partial", label:"sheet ✓" };
    return { key:"missing", label:"needs halves" };
  }
  const id = clip && clip.data && clip.data.first && clip.data.first.id;
  return id && imgs && imgs[id] ? { key:"ready", label:"frame ✓" } : { key:"missing", label:"needs frame" };
}
function clipVideoReady(clip, vids){
  if(!clip) return false;
  if(vids&&vids[clip.id]) return true;
  const url=(typeof vidGetVideo==="function")&&vidGetVideo(clip.id);
  if(!url) return false;
  const meta=(typeof vidGetMeta==="function")?vidGetMeta(clip.id):null;
  return typeof shotSourcesEditorialStatus!=="function"
    || ["current","override"].includes(shotSourcesEditorialStatus(
      ((clip.data||{}).shots)||[],((window.turnContinuity||{}).drafts||{}),meta));
}
function stageBeatVidId(sh){ return sh && sh.id ? ("beat-"+sh.id) : ""; }
function stageShotRuntime(sh){
  const ms = sh && sh.lineAudio && sh.lineAudio.durationMs;
  if(ms) return Math.max(1, Math.round((Number(ms)/1000)*10)/10);
  if(typeof shotDur==="function") return Math.max(1, Number(shotDur(sh))||5);
  return Math.max(1, Number(sh&&sh.dur)||5);
}

function sceneStoryboardItems(scene, sceneShots, imgs, visualSource){
  const out = [];
  const total = stagePageRanges(sceneShots).length;
  for(let i=0;i<total;i++){
    const sheetId = "sbsheet-sbpage-"+scene.id+"-2x2-"+i;
    const sheet = imgs[sheetId] || "";
    const topId = sheetId+":half-top", bottomId = sheetId+":half-bottom";
    const top = imgs[topId] || "", bottom = imgs[bottomId] || "";
    if(visualSource==="halves" && (top || bottom)){
      out.push({ id:topId, kind:"half", half:"top", page:i+1, label:"Page "+(i+1)+" · top half", url:top, missing:!top });
      out.push({ id:bottomId, kind:"half", half:"bottom", page:i+1, label:"Page "+(i+1)+" · bottom half", url:bottom, missing:!bottom });
    } else {
      out.push({ id:sheetId, kind:"sheet", page:i+1, label:"Page "+(i+1)+" · full sheet", url:sheet, missing:!sheet,
        note:visualSource==="halves" ? "No saved halves yet" : "" });
    }
  }
  return out;
}

function StageSceneSheets({ scene, sceneShots, clips, imgs, visualSource, aspect, onOpenClip }){
  const items = sceneStoryboardItems(scene, sceneShots, imgs, visualSource);
  const ranges = stagePageRanges(sceneShots);
  const clipForItem = (it)=>{
    const pg = ranges[it.page-1] || { start:(it.page-1)*4, count:4 };
    const cell0 = (it.kind==="half" && it.half==="bottom") ? 2 : 0;
    const span = Math.max(1, Math.min(it.kind==="half" ? 2 : pg.count, pg.count-cell0));
    const start = pg.start + cell0;
    return (clips||[]).find(c=>{
      const a = Number(c&&c.g&&c.g.start)||0;
      const b = a + (((c&&c.g&&c.g.shots)||[]).length||1) - 1;
      return b>=start && a<=start+span-1;
    }) || (clips||[])[0] || null;
  };
  const cards = items.map(it=>{
    const c = clipForItem(it);
    const canOpen = !!(c && onOpenClip);
    return _stEl("button",{key:it.id,type:"button",className:"stage2-sheet-card "+it.kind+(it.missing?" missing":""),
      disabled:!canOpen, onClick:()=>canOpen&&onOpenClip(c.id),
      title:canOpen ? ("Open "+c.label+" from "+it.label) : it.label},
      _stEl("div",{className:"stage2-sheet-thumb",style:it.kind==="half"?{"--stage-aspect":"3 / 1"}:_stageAspectCss(aspect)},
        it.url ? _stEl("img",{src:it.url,alt:"",loading:"lazy"})
          : _stEl("div",{className:"stage2-sheet-missing"}, Icon.image&&_stEl(Icon.image,{s:20}), it.note||"Not saved yet")),
      _stEl("div",{className:"stage2-sheet-meta"},
        _stEl("span",{className:"stage2-sheet-label"}, it.label),
        c && _stEl("span",{className:"stage2-sheet-clip"}, c.label)));
  });
  return _stEl("div",{className:"stage2-sheets"},
    _stEl("div",{className:"stage2-sheets-head"},
      _stEl("div",null,
        _stEl("div",{className:"stage2-board-scene-k"},"SCENE "+_pad2(scene.no)),
        _stEl("div",{className:"stage2-sheets-title"}, scene.title||scene.loc)),
      _stEl("div",{className:"stage2-board-progress"},
        items.filter(x=>!x.missing).length+" / "+items.length+" "+(visualSource==="halves"?"halves":"sheets"))),
    _stEl("div",{className:"stage2-sheets-grid"}, cards));
}

function StageBoard({ scenesWithShots, allClips, imgs, auds, vids, beatsMap, drafts, visualSource, selectedId, onSelect, aspect }){
  return _stEl("div",{className:"stage2-board-scroll"},
    scenesWithShots.map(scene=>{
      const cs = allClips.filter(c=>c.scene.id===scene.id);
      const done = cs.filter(c=>clipVideoReady(c, vids)).length;
      return _stEl("section",{key:scene.id,className:"stage2-board-scene"},
        _stEl("div",{className:"stage2-board-scene-head"},
          _stEl("div",null,
            _stEl("div",{className:"stage2-board-scene-k"},"SCENE "+_pad2(scene.no)),
            _stEl("div",{className:"stage2-board-scene-t"}, scene.title||scene.loc)),
          _stEl("div",{className:"stage2-board-progress"}, done+" / "+cs.length+" clips")),
        _stEl("div",{className:"stage2-board-grid"},
          cs.map(c=>{
            const frame = clipPrimaryFrame(c, imgs, visualSource);
            const voice = clipVoiceState(c, auds);
            const frameState = clipFrameState(c, imgs, visualSource);
            const rendered = clipVideoReady(c, vids);
            return _stEl("button",{key:c.id,className:"stage2-card"+(c.id===selectedId?" on":"")+(rendered?" done":""),
              onClick:()=>onSelect(c.id),title:"Open "+c.label+" — "+clipBeatName(c, beatsMap, drafts)},
              _stEl("div",{className:"stage2-card-thumb",style:_stageAspectCss(aspect)},
                frame ? _stEl("img",{src:frame,alt:"",loading:"lazy"}) : _stEl("div",{className:"stage2-card-blank"}, Icon.image&&_stEl(Icon.image,{s:18}),"No frame"),
                rendered && _stEl("span",{className:"stage2-card-play"}, Icon.play&&_stEl(Icon.play,{s:12}))),
              _stEl("div",{className:"stage2-card-body"},
                _stEl("div",{className:"stage2-card-top"},
                  _stEl("span",{className:"stage2-card-lab"}, c.label),
                  _stEl("span",{className:"stage2-card-dur"}, _fmtSecs(c.data.dur))),
                _stEl("div",{className:"stage2-card-beat"}, clipBeatName(c, beatsMap, drafts)),
                _stEl("div",{className:"stage2-card-chips"},
                  _stEl("span",{className:"stage2-status "+frameState.key}, frameState.label),
                  _stEl("span",{className:"stage2-status "+voice.key}, voice.label),
                  _stEl("span",{className:"stage2-status "+(rendered?"ready":"missing")}, rendered?"video ✓":"pending"))));
          })));
    }));
}

function StageView({ project, scenes, shots, characters, locations, props, beatsMap, drafts, creditBalance, readOnly=false, onVoiceAll, voicingLines, onCancelVoiceAll, onVoiceLine, onUpdateShot, onStageNav }){
  const [visualSource, _setVisualSource] = React.useState(_stageSavedSource);
  const setVisualSource = React.useCallback((v)=>{
    const next = v==="halves" ? "halves" : "shots";
    _setVisualSource(next);
    try{ localStorage.setItem("turn_stage_visual_source", next); }catch(e){}
  },[]);
  const ordered = React.useMemo(()=> scenesInStoryOrder(scenes), [scenes]);
  const charById = React.useMemo(()=>{ const m={}; (characters||[]).forEach(c=>{ m[c.id]=c; }); return m; }, [characters]);
  const propById = React.useMemo(()=>{ const m={}; (props||[]).forEach(p=>{ m[p.id]=p; }); return m; }, [props]);
  const shotsByScene = React.useMemo(()=>{ const m={}; (shots||[]).forEach(s=>{ (m[s.sceneId]=m[s.sceneId]||[]).push(s); });
    Object.values(m).forEach(arr=>arr.sort((a,b)=>(a.order||0)-(b.order||0)||(a.beatN||0)-(b.beatN||0))); return m; }, [shots]);
  const scenesWithShots = ordered.filter(s=>(shotsByScene[s.id]||[]).length);
  // bridge for storyboardClipIds: the Storyboards tab's beat-boundary page geometry
  // (window.sbPageRanges) needs the scene's live shots; the pure clip→sheet helpers
  // read them from here rather than threading the list through every call site.
  window.__sbShots = shots;
  const clipMax = (typeof clipMaxFor==="function") ? clipMaxFor(project) : (window.CLIP_MAX_SECONDS||15);
  // the MODEL choice lives here (not in the per-clip console) because it drives the
  // clip PACKER: Seedance 2.0 caps clips at 3 shots so per-shot frames + identity refs
  // fit its 9-image budget; 2.5 lifts the shot-count cap but remains beat-first.
  const [modelId, _setModelId] = React.useState(()=>{
    try{ const v = localStorage.getItem("turn_stage_model");
      // Stored values are explicit historical choices. Only an actually new Stage
      // starts on 2.5; never migrate a hand-picked 2.0 model or its takes.
      return (SEEDANCE_MODELS.find(m=>m.id===v && m.status==="active")
        || SEEDANCE_MODELS.find(m=>m.id==="seedance-2.5"&&m.status==="active")
        || SEEDANCE_MODELS.find(m=>m.status==="active") || SEEDANCE_MODELS[0]).id;
    }catch(e){ return "seedance-2.5"; }
  });
  const setModelId = React.useCallback((id)=>{ _setModelId(id); try{ localStorage.setItem("turn_stage_model", id); }catch(e){} },[]);
  const stageModel = seedanceModelOf(modelId);
  // CLIP SCOPE — user choice (2026-09-02): how shots pack into render clips.
  // "auto": Seedance 2.5 packs ONE BEAT per clip (the whole beat renders as one
  // sequence of shots — the Art Room micro-beat plan continued, its 30s ceiling
  // permitting; whole-SCENE packing was retired by the same ruling); 2.0 packs by
  // its 15s/3-shot budget. "shot": one clip per SHOT on either model — maximum
  // per-render control. Persisted like the model choice.
  const [clipScope, _setClipScope] = React.useState(()=>{
    try{ const v=localStorage.getItem("turn_stage_clip_scope");
      // "auto" is the old packer and remains viewable so historical take keys stay
      // attached. No stored value means a new user: use approved beat-first packing.
      return v==="shot"?"shot":v==="beat"?"beat":v==="auto"?"legacy":"beat";
    }catch(e){ return "beat"; }
  });
  const setClipScope = React.useCallback((v)=>{ const next=v==="shot"?"shot":v==="legacy"?"legacy":"beat";
    _setClipScope(next); try{ localStorage.setItem("turn_stage_clip_scope",next==="legacy"?"auto":next); }catch(e){} },[]);
  // CLIP PACKING follows the scope above; the left rail lists the packed clips.
  // (The old Per clip / Whole scene switcher was removed 2026-08-02 by user ruling —
  // sceneSequences' wholeScene branch stays dormant.)
  // in-room view: the director console ("stage") or the take browser ("versions");
  // pendingReuse carries a Versions-tab "Reuse/Branch" pick back into the composer
  const [stageView, setStageView] = React.useState("stage");
  const [pendingReuse, setPendingReuse] = React.useState(null);
  const clipsByScene = React.useMemo(()=>{ const m={};
    // the packing budget follows the MODEL's ceiling upward — a 30s model (Seedance
    // 2.5) packs a whole BEAT into one 30s clip even when the format's budget is 15s
    const packMax = stageModel.maxClipSec || clipMax || 15;
    const packOpts = { maxShots: stageModel.maxShotsPerClip!=null ? stageModel.maxShotsPerClip : (window.CLIP_MAX_SHOTS||3),
          maxDialogue: stageModel.maxDialoguePerClip!=null ? stageModel.maxDialoguePerClip : (window.CLIP_MAX_DIALOGUE||3),
          perBeat:modelId==="seedance-2.5" };
    scenesWithShots.forEach(s=>{
      const ss=shotsByScene[s.id]||[];
      if(clipScope!=="legacy"&&typeof window.stagePlanClips==="function"){
        m[s.id]=window.stagePlanClips(ss,{ modelId,maxSeconds:packMax,
          maxShots:packOpts.maxShots,maxDialogue:packOpts.maxDialogue,
          scope:clipScope==="shot"?"shot":"beat",audioMode:"locked",
          scene:s,drafts,characters,beatsMap });
      }else{
        m[s.id]=(typeof sceneSequences==="function")
          ? sceneSequences(ss,packMax,clipScope==="shot"?{perShot:true}:packOpts) : [];
      }
    });
    return m; }, [scenesWithShots, shotsByScene, clipMax, modelId, clipScope, drafts, characters, beatsMap]);

  // ctx.scenes = the story-ORDERED list — shotPropSheetId/custodyOwnerAt resolve by story
  // position, so the raw array would mis-resolve active states/holders out of order
  const ctx = { characters, charById, props, propById, locations, project, beatsMap, drafts, scenes:ordered,
    shots, shotsByScene };
  const aspect = _stageAspect(project);
  const charSig = JSON.stringify((characters||[]).map(c=>[c.id,c.name,
    (c.states||[]).map(st=>[st.id,st.label,st.sceneId,st.change,st.version,st.updatedAt]).join("|")]));
  // CONTENT-based signatures — a state/custody/coverage edit that keeps the same counts
  // (re-pinned scene, renamed holder, new trigger words) must still bust the clip memo
  const propSig = JSON.stringify((props||[]).map(p=>[p.id,p.name,
    (p.states||[]).map(st=>[st.id,st.sceneId,st.label]).join("|"),
    (p.custody||[]).map(cu=>[cu.charId,cu.charName,cu.fromSceneId]).join("|"),
    (p.continuityEvents||[]).map(e=>[e.type,e.sceneId,e.beatId,e.microBeatId,e.shotId,e.holderId,e.locationId,e.condition,e.visibility,e.note]).join("|"),
    p.kind||p.bindingMode||"",p.ownerId||p.ownerName||"",p.custodianId||"",p.associationId||"",p.locationId||p.placementLocationId||""]));
  const locSig = JSON.stringify((locations||[]).map(l=>[l.id,l.name,(l.scenes||[]).join("|"),
    (l.coverageSheets||[]).map(v=>[v.id,v.role,v.name,(v.triggerWords||[]).join("~")]).join("|")]));
  const draftSig = JSON.stringify(Object.entries(drafts||{}).map(([id,d])=>[id,(d&&d.version)||"",((d&&d.blocks)||[]).map(b=>[b.beat,b.type,b.text]).join("|")]));
  const beatsSig = JSON.stringify(Object.entries(beatsMap||{}).map(([id,b])=>[id,((b&&b.rows)||[]).map(r=>[r.n,r&&r.drive&&r.drive.d,r&&r.react&&r.react.d]).join("|")]));

  // flatten clips with labels + derived data
  const allClips = React.useMemo(()=>{ const out=[];
    scenesWithShots.forEach(scene=>{ (clipsByScene[scene.id]||[]).forEach(g=>{
      // CONTENT-STABLE id (hash of member shots) so takes survive repacking; the old
      // positional id rides along as legacyId for the one-time take migration
      out.push({ id:(typeof clipStableId==="function")?clipStableId(scene.id, g.shots):("clip-"+scene.id+"-"+g.index),
        legacyId:(typeof clipVidId==="function")?clipVidId(scene.id,g.index):("clip-"+scene.id+"-"+g.index),
        label:_pad2(scene.no)+_clipLetter(g.index), scene, g, data:buildClipData(scene, g, ctx, stageModel.maxClipSec||15) }); }); });
    return out; }, [scenesWithShots, clipsByScene, charSig, propSig, locSig, draftSig, beatsSig, project]);
  // migrate any takes still stored under the OLD positional ids (fire-and-forget; the
  // vid-done event each migration dispatches makes mounted consoles re-read)
  React.useEffect(()=>{
    if(clipScope!=="legacy") return;
    if(typeof window.vidAdoptTakes!=="function") return;
    allClips.forEach(c=>{ if(c.legacyId && c.legacyId!==c.id) window.vidAdoptTakes(c.id, c.legacyId); });
  }, [clipScope, allClips.map(c=>c.id).join("|")]);

  // load every needed image (shot frames + storyboard clip sheets/halves + character / location / prop sheets) into one map
  const shotIdsKey = (shots||[]).map(s=>[s.id,s.sceneId,s.beatN,(s.covers||[]).join("."),
    s.referenceCharactersSet?1:0,(s.referenceCharacterIds||[]).join("."),
    s.referenceLocationsSet?1:0,(s.referenceLocationIds||[]).join("."),
    (s.refOff||[]).join("."),JSON.stringify(s.stageCharacterReferenceOverrides||{})].join(":")).join(",");
  const charIdsKey = JSON.stringify((characters||[]).map(c=>[c.id,c.name,
    (c.states||[]).map((st,i)=>[i,st.id,st.label,st.sceneId,st.change,st.version,st.updatedAt])]));
  const sceneOrderKey = JSON.stringify((ordered||[]).map((s,i)=>[i,s.id,s.no,s.order]));
  const locIdsKey = (locations||[]).map(l=>l.id).join(",");
  const propIdsKey = (props||[]).map(p=>p.id).join(",");
  const neededIds = React.useMemo(()=>{ const s=new Set();
    (shots||[]).forEach(sh=>s.add(sh.id)); (characters||[]).forEach(c=>s.add(c.id));
    (locations||[]).forEach(l=>s.add(l.id)); (props||[]).forEach(p=>s.add(p.id));
    scenesWithShots.forEach(scene=>{
      const total = stagePageRanges((shotsByScene||{})[scene.id]||[]).length;
      for(let i=0;i<total;i++){
        const sheetId = "sbsheet-sbpage-"+scene.id+"-2x2-"+i;
        s.add(sheetId); s.add(sheetId+":half-top"); s.add(sheetId+":half-bottom");
      }
    });
    allClips.forEach(c=>{ const ids=storyboardClipIds(c); (ids.all||[]).forEach(id=>s.add(id)); });
    // the clip-derived VARIANT ids too — a prop's active state sheet and the scene's
    // coverage sheet aren't in the base id lists above, so they'd never be fetched
    allClips.forEach(c=>{ const dd=c.data||{}; (dd.props||[]).forEach(p=>s.add(p.sheetId||p.id)); if(dd.locSheet&&dd.locSheet.id) s.add(dd.locSheet.id); });
    if(typeof window.stageShotReferencePackage==="function"){
      scenesWithShots.forEach(scene=>{
        const pack=window.stageShotReferencePackage(shotsByScene[scene.id]||[],{...ctx,scene,drafts});
        ["characters","locations","props"].forEach(k=>(pack[k]||[]).forEach(r=>r&&r.assetId&&s.add(r.assetId)));
      });
    }
    return Array.from(s); }, [shotIdsKey, charIdsKey, sceneOrderKey, locIdsKey, propIdsKey, allClips.map(c=>c.id).join(","), scenesWithShots.map(s=>s.id).join(","),
      JSON.stringify(allClips.map(c=>[(((c.data||{}).props)||[]).map(p=>p.sheetId||p.id).join("|"), (((c.data||{}).locSheet)||{}).id||""]))]);
  const [imgs, setImgs] = React.useState({});
  const [imgTick, setImgTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setImgTick(x=>x+1); window.addEventListener("nb-gen-done", h); window.addEventListener("nb-prefetched", h); return ()=>{ window.removeEventListener("nb-gen-done", h); window.removeEventListener("nb-prefetched", h); }; }, []);
  React.useEffect(()=>{ let alive=true;
    const ids = Array.from(new Set(neededIds||[]));
    const sync = {}, missing = [];
    ids.forEach(id=>{ const u=(typeof nbGetImage==="function")?nbGetImage(id):""; if(u) sync[id]=u; else missing.push(id); });
    setImgs(sync);
    if(typeof nbLoadImage!=="function" || !missing.length){ return ()=>{ alive=false; }; }
    (async()=>{
      const limit = 8;
      let idx = 0;
      const worker = async()=>{
        while(alive && idx<missing.length){
          const id = missing[idx++];
          try{
            const u = await nbLoadImage(id);
            if(alive && u) setImgs(prev=> prev[id] ? prev : ({...prev, [id]:u}));
          }catch(e){}
        }
      };
      await Promise.all(Array.from({length:Math.min(limit, missing.length)}, worker));
    })();
    return ()=>{ alive=false; }; }, [neededIds.join(","), imgTick]);

  // load voiced line audio for shots that have it
  const [auds, setAuds] = React.useState({});
  const [audTick, setAudTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setAudTick(x=>x+1); window.addEventListener("vg-audio-done", h); return ()=>window.removeEventListener("vg-audio-done", h); }, []);
  React.useEffect(()=>{ let alive=true;
    (async()=>{ const out={};
      for(const sh of (shots||[])){ if(!String(sh.dialogue||"").trim()) continue;
        let u=(typeof vgGetAudio==="function")?vgGetAudio(sh.id):"";
        if(!u && typeof vgLoadAudio==="function"){ try{ u=await vgLoadAudio(sh.id); }catch(e){} } if(u) out[sh.id]=u; }
      if(alive) setAuds(out); })();
    return ()=>{ alive=false; }; }, [(shots||[]).map(s=>s.id+":"+(s.lineAudio?1:0)).join(","), audTick]);

  const videoIds = React.useMemo(()=>Array.from(new Set([].concat(allClips.map(c=>c.id), (shots||[]).map(stageBeatVidId).filter(Boolean)))), [allClips.map(c=>c.id).join(","), shotIdsKey]);
  const clipIdsKey = videoIds.join(",");
  const [vids, setVids] = React.useState({});
  const [vidTick, setVidTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setVidTick(x=>x+1); window.addEventListener("vid-done", h); return ()=>window.removeEventListener("vid-done", h); }, []);
  React.useEffect(()=>{ let alive=true;
    (async()=>{ const out={};
       for(const id of videoIds){ let u=(typeof vidGetVideo==="function")?vidGetVideo(id):"";
         if(!u && typeof vidLoadVideo==="function"){ try{ u=await vidLoadVideo(id); }catch(e){} }
         const clip=allClips.find(c=>c.id===id);
         const meta=(typeof vidGetMeta==="function")?vidGetMeta(id):null;
         const usable=!clip || typeof shotSourcesEditorialStatus!=="function"
           || ["current","override"].includes(shotSourcesEditorialStatus(
             ((clip.data||{}).shots)||[],drafts,meta));
         if(u&&usable) out[id]=u; }
      if(alive) setVids(out); })();
    return ()=>{ alive=false; }; }, [clipIdsKey, vidTick, draftSig, shotIdsKey]);

  // CLIP is the unit of selection/generation (a clip can bundle 2+ merged shots —
  // see the Art Room Shots "merge" + Storyboards "Compose from shot frames" /
  // sheet-half workflows). selId is the primary selection; selShotId just tracks
  // which of the clip's own shots is previewed in its filmstrip-of-one context.
  const [selId, setSelId] = React.useState(allClips[0] ? allClips[0].id : null);
  const [selShotId, setSelShotId] = React.useState((shots||[])[0] ? (shots||[])[0].id : null);
  // REPACK-AWARE selection: clip ids hash their member shots, so editing a shot's
  // seconds re-packs the scene and the selected id can simply vanish. Falling back
  // to allClips[0] yanked the director to the first clip mid-edit — instead follow
  // the shots: re-select the clip that inherited the most of the old clip's members.
  const selMembersRef = React.useRef(null);
  React.useEffect(()=>{
    const cur = allClips.find(c=>c.id===selId);
    if(cur){ selMembersRef.current = (cur.g.shots||[]).map(s=>s.id); return; }
    const prev = selMembersRef.current || [];
    let best=null, bestN=0;
    allClips.forEach(c=>{ const n=(c.g.shots||[]).filter(s=>prev.indexOf(s.id)>=0).length; if(n>bestN){ best=c; bestN=n; } });
    const next = best || allClips[0] || null;
    selMembersRef.current = next ? (next.g.shots||[]).map(s=>s.id) : null;
    setSelId(next ? next.id : null);
  }, [allClips.map(c=>c.id).join(","), selId]);

  if(!scenesWithShots.length){
    return _stEl("div",{className:"stage2-root"},
      _stEl("div",{className:"prop-empty"},
        _stEl("div",{className:"art-soon-ic"}, Icon.clapper&&_stEl(Icon.clapper,{s:30})),
        _stEl("div",{className:"art-soon-t"},"Nothing to stage yet"),
        _stEl("div",{className:"art-soon-d"},"The Stage turns your shots into video clips. Break your scenes into shots in the Art Room → Shots first, then come back.")));
  }

  // the director console — one clip at a time
  const clip = allClips.find(c=>c.id===selId) || allClips[0];
  const selectedScene = clip.scene;
  const selectedSceneClips = allClips.filter(c=>c.scene.id===selectedScene.id);
  const selectedShot = (clip.g.shots||[]).find(sh=>sh.id===selShotId) || (clip.g.shots||[])[0] || clip.data.first;
  const clipIdx = allClips.findIndex(c=>c.id===clip.id);
  const prevBeatVideoId = clipIdx>0 ? allClips[clipIdx-1].id : null;
  const onSelectClip = (clipId)=>{
    const c = allClips.find(x=>x.id===clipId);
    setSelId(clipId);
    setSelShotId(c && (c.g.shots||[])[0] ? c.g.shots[0].id : null);
  };
  const sceneRow = (scene)=>{
    const sceneClips = allClips.filter(c=>c.scene.id===scene.id);
    const sceneShots = shotsByScene[scene.id]||[];
    const sceneDur = sceneShots.reduce((t,sh)=>t+stageShotRuntime(sh),0);
    const done = sceneClips.filter(c=>clipVideoReady(c, vids)).length;
    const total = sceneClips.length;
    const allDone = total>0 && done===total;
    return _stEl("div",{key:scene.id,className:"stage2-scene-block"},
      _stEl("button",{type:"button",className:"stage2-scene-headrow"+(selectedScene.id===scene.id?" on":"")+(allDone?" done":""),
          onClick:()=>{ if(sceneClips[0]) onSelectClip(sceneClips[0].id); },
          title:"Select Scene "+_pad2(scene.no)+" · "+done+" of "+total+" clip"+(total!==1?"s":"")+" rendered · "+_fmtSecs(sceneDur)+" runtime"},
        _stEl("span",{className:"tree-scene-no"}, _pad2(scene.no)),
        _stEl("span",{className:"tree-scene-dot",style:{background:allDone?"var(--pos)":chargeColor(scene)}}),
        _stEl("span",{className:"stage2-scene-ttl"}, scene.title||scene.loc),
        // per-scene rollup: rendered/total clips (✓-green when complete, matching the
        // chip done styling) + the scene's total runtime — the at-a-glance answer to
        // "how far along is this scene?" without scanning chips
        _stEl("span",{className:"stage2-scene-prog"+(allDone?" done":"")}, allDone?"✓ ":"", done+"/"+total),
        _stEl("span",{className:"stage2-scene-meta"}, _fmtSecs(sceneDur))),
      // thin progress bar that fills as clips render
      _stEl("div",{className:"stage2-scene-bar"+(allDone?" done":""),role:"progressbar",
          "aria-valuenow":done,"aria-valuemin":0,"aria-valuemax":total,
          "aria-label":"Scene "+_pad2(scene.no)+" render progress"},
        _stEl("div",{className:"stage2-scene-bar-fill",style:{width:(total?Math.round(done/total*100):0)+"%"}})),
      // BEATS below scenes, matching the Art Room exactly: one row per beatN (the
      // Shots tab's "Beat N" cards), in shot order. Clips stay the render unit —
      // a beat row selects the clip holding the beat's FIRST shot, but only the
      // clicked/current beat highlights (packing can span beats without looking like
      // a multi-select).
      _stEl("div",{className:"stage2-beat-list"},
        (()=>{ const beats=[];
          sceneShots.forEach(sh=>{ const n=sh.beatN||null;
            const b=beats.find(x=>x.n===n); if(b) b.shots.push(sh); else beats.push({ n, shots:[sh] }); });
          return beats.map(b=>{
            const bIds = new Set(b.shots.map(s=>s.id));   // id-compare, never object identity
            const coverClips = sceneClips.filter(c=> (c.g.shots||[]).some(sh=> bIds.has(sh.id)));
            const firstClip = coverClips[0] || null;
            const p = firstClip ? stageClipSourcePlan(firstClip, imgs) : { glyph:"", ready:false, label:"shots" };
            const rendered = coverClips.length>0 && coverClips.every(c=>clipVideoReady(c, vids));
            const on = selectedScene.id===scene.id && b.shots.some(sh=>sh.id===((selectedShot||{}).id));
            const beatNm = stageBeatRailName(scene, drafts, beatsMap, b);
            const label = "Beat "+(b.n||"—");
            return _stEl("div",{key:"beat-"+(b.n||"none"),className:"stage2-beat"+(on?" on":"")},
              _stEl("button",{type:"button",
                className:"stage2-beat-row"+(rendered?" done":"")+(p.ready?"":" missing"),
                title:label+(beatNm?" · "+beatNm:"")+" · "+b.shots.length+" shot"+(b.shots.length!==1?"s":"")
                  +(coverClips.length>1?" · spans "+coverClips.length+" clips":"")
                  +" · renders from "+p.label+(p.ready?"":" — source missing, generate it first")+(rendered?" · rendered ✓":""),
                onClick:()=>{ if(!firstClip) return; if(firstClip.id!==clip.id) onSelectClip(firstClip.id); setSelShotId(b.shots[0].id); }},
                _stEl("b",null,label),
                _stEl("span",{className:"stage2-beat-name"},beatNm||"—"),
                _stEl("span",{className:"stage2-clip-chip-glyph"},p.glyph),
                _stEl("span",{className:"stage2-clip-chip-st"}, rendered?"✓":(p.ready?"":"!"))));
          });
        })()));
  };
  // the Scenes rail collapses to the same vertical strip the Writers' Room panels use
  const [railOpen, _setRailOpen] = React.useState(()=>{ try{ return localStorage.getItem("turn_stage_rail_open")!=="0"; }catch(e){ return true; } });
  const setRailOpen = (v)=>{ _setRailOpen(v); try{ localStorage.setItem("turn_stage_rail_open", v?"1":"0"); }catch(e){} };
  const rail = _stEl("div",{className:"stage2-rail"},
    _stEl("div",{className:"stage2-rail-head"},
      Icon.layers&&_stEl(Icon.layers,{s:12}), _stEl("span",null,"Scenes"),
      _stEl("button",{className:"panel-collapse",onClick:()=>setRailOpen(false),title:"Collapse scenes"},
        Icon.chevL&&_stEl(Icon.chevL,{s:14}))),
    _stEl("div",{className:"stage2-scene-list"}, scenesWithShots.map(sceneRow)));
  const railStrip = (typeof CollapsedStrip!=="undefined")
    ? _stEl(CollapsedStrip,{ side:"left", label:"Scenes", icon:Icon.panelLeft||Icon.layers, onExpand:()=>setRailOpen(true) })
    : _stEl("button",{className:"strip left",onClick:()=>setRailOpen(true),title:"Expand scenes"},
        _stEl("div",{className:"strip-label"},"Scenes"));
    // the Stage's IN-ROOM views, named for what HAPPENS inside and ordered as the
    // production workflow: SHOOT the clips → manage the TAKES → assemble the
    // TIMELINE → MIX the sound. ("Stage" as a tab name clashed with the room
    // itself.) Internal view ids stay stable — only the labels are film-language.
    const stageTabs = [
      ["Shoot","stage",Icon.clapper||Icon.sparkles,"Render the clips — the director console"],
      ["Takes","versions",Icon.copy,"Approve, restore & reuse the selected clip's rendered takes"],
      ["Timeline","timeline",Icon.grid,"The film assembled from each clip's current take"],
      ["Mix","audio",Icon.mic,"Post-mix preview — pristine voices over picture, beds under"],
    ];
    const stageHead = _stEl("div",{className:"viewnav","aria-label":"Views"},
      _stEl("div",{className:"vn-side vn-left"}),
      _stEl("div",{className:"vn-center"},
        _stEl("div",{className:"segmented"},
          stageTabs.map(([label,id,Ic,tip])=>{
            const on = stageView===id;
            return _stEl("button",{key:id,type:"button",className:"seg"+(on?" on":""),
              onClick:()=>setStageView(id),
              title: on ? "Current workspace" : tip},
              Ic&&_stEl(Ic,{s:14}),_stEl("span",{className:"seg-lab"},label)); }))),
      _stEl("div",{className:"vn-side vn-right"}));
    // the view tabs span the FULL app width above the rail+console split — the same
    // TopBar → ViewNav → body stack every other room has.
    return _stEl("div",{className:"stage2-root",style:_stageAspectCss(aspect)},
      stageHead,
      _stEl("div",{className:"stage2-body"}, railOpen ? rail : railStrip,
        _stEl("div",{className:"stage2-main"},
          stageView==="versions"
            ? _stEl(StageVersionsView,{ key:"vers-"+clip.id, clip, stageModel,
                onBack:()=>setStageView("stage"),
                onReuse:(meta,pin)=>{ setPendingReuse({ clipId:clip.id, meta, pin }); setStageView("stage"); } })
            : stageView==="timeline"
            ? _stEl(StageTimelineView,{ key:"tl", allClips, vids, imgs, visualSource, selId, onSelectClip,
                onOpenStage:(id)=>{ onSelectClip(id); setStageView("stage"); } })
            : stageView==="audio"
            ? _stEl(StageAudioView,{ key:"au", allClips, vids, auds, selId, onSelectClip })
            // keyed by SCENE, not clip.id — clip ids change on every repack (they
            // hash the member shots), and remounting the console wiped the recipe
            // tab + Multi-shot row state mid-edit; the console's own member-overlap
            // effect handles real clip moves within the scene.
            : _stEl(ClipConsole,{ key:"console-"+selectedScene.id, clip, selectedShot, sceneClips:selectedSceneClips, ctx, imgs, auds, beatsMap, drafts, prevClipVideoId:prevBeatVideoId, aspect, visualSource, setVisualSource, creditBalance, readOnly, onVoiceLine, onUpdateShot, onStageNav, modelId, setModelId, clipScope, setClipScope,
                onSelectClip,
                onFirstVideo:()=>setStageView("versions"),
                pendingReuse, onReuseConsumed:()=>setPendingReuse(null) }))));
  }
window.StageView = StageView;

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
let _stageAudioPreview=null;
function _stagePlayAudio(url){
  try{
    if(_stageAudioPreview)_stageAudioPreview.pause();
    if(!url)return;
    _stageAudioPreview=new Audio(url);
    _stageAudioPreview.play().catch(()=>{});
  }catch(e){}
}

function _pad2(n){ return String(n||0).padStart(2,"0"); }
function _clipLetter(i){ return (i<26) ? String.fromCharCode(65+i) : String(i+1); }
function _uniq(a){ const o=[], s=new Set(); (a||[]).forEach(x=>{ if(x && !s.has(x)){ s.add(x); o.push(x); } }); return o; }
/* a clip's look line: the whole look the frames get (grade, palette, lens, texture, film stock —
   turnVideoLookText, set on the clip as d.lookText); a clip built elsewhere falls back to name — grade */
function _stageLook(d){
  if(d && typeof d.lookText==="string") return d.lookText;
  return (d && d.preset) ? (d.preset.name+" \u2014 "+d.preset.grade) : "";
}
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
/* THE STAGE'S SETTINGS BELONG TO THE FILM (2026-10-02): the visual source, the video model and
   the clip scope are saved with the film (project.stage) — they decide how its shots pack into
   clips and which saved takes attach, so a film must read the same on every device and for
   every collaborator. A film with no saved choice starts from this device's last one (the old
   device-wide setting, kept as that default); a read-only viewer's pick lasts for the visit. */
function _stageFilm(project, key){ const st = project && project.stage; return st && typeof st==="object" ? st[key] : undefined; }
function _stageSavedSource(project){
  const f = _stageFilm(project, "visualSource");
  if(f==="halves" || f==="shots") return f;
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
/* THE SERVER'S HOLD FOR RENDERS BILLED BY A VIDEO'S LENGTH (billing rounds 3-4). image-proxy holds
   Motion Control and Seedance 2.5 editing at the LENGTH IT READS from the chosen video (the motion
   video; the video to edit) plus a margin — the read length × 1.1 + 1 s, in tenths of a second
   rounded up (lengthHoldSeconds), never above the longest length its validators allow — but only
   for a file it works from its OWN COPY of (round 5: index.ts lengthSizesHold + video-snapshots.mjs —
   a data URL, a `stage:` upload or a signed file in the project's storage, copied at submit into a
   server-only path; or a take on fal's immutable media CDN); any other file, one it couldn't copy,
   or one it can't read (not an MP4 / MOV, fragmented, compressed, a slow read), is held at that
   LONGEST length. It refuses the render when the balance can't cover the hold and settles from the
   finished video's own length (never above the hold): supabase/functions/image-proxy/
   billing-pricing.mjs lengthBilledVideoHold, which index.ts feeds with the limits in
   supabase/functions/image-proxy/seedance-capabilities.mjs and the lengths it read.
   The Stage mirrors those numbers WITHOUT importing them — they must match the server files, and
   test-billing-app "K (A1)" compares them for every tier, resolution, orientation and credit unit.
   (The Stage uses the length it measured itself; the server's own read decides the real hold.) */
const STAGE_LENGTH_HOLD = Object.freeze({
  motionSeconds: Object.freeze({ video:30, image:10 }),   // motionControlCapabilities().motionVideo.maxSeconds / .maxSecondsImageOrientation
  editOutputSeconds: 30,                                  // seedanceCapabilities("…/seedance-2.5/…").duration.max
  editInputSeconds: 30.2,                                 // seedanceCapabilities("…/seedance-2.5/…").references.videos.maxSecondsCombined
  videoInputMul: 0.6,                                     // billing-pricing.mjs SEEDANCE_VIDEO_INPUT_MULTIPLIER
  lengthFactor: 1.1,                                      // billing-pricing.mjs LENGTH_HOLD_FACTOR (round 4): read length × 1.1 …
  lengthPadSeconds: 1,                                    // … LENGTH_HOLD_PAD_SECONDS: + 1 s, in tenths rounded up
});
/* provider USD per second from the live pricing table (admin overrides included, like the server's) */
function stageUsdPerSecond(family, tier, resolution){
  const t = typeof window!=="undefined" && window.TURN_PRICING && window.TURN_PRICING.video && window.TURN_PRICING.video.providerUsdPerSecond;
  const v = Number((((t||{})[family]||{})[tier]||{})[resolution]);
  return v>0 ? v : null;
}
/* whether the SERVER sizes the hold by this video's length (index.ts lengthSizesHold, round 5): a
   file it copies at submit into a server-only path and works from — a `stage:` upload (a device
   file), a data URL (a `blob:` pick is sent as one: videogen.jsx vidProxyReadyUrl), or a SIGNED
   file in this project's storage bucket (video-snapshots.mjs projectStorageObject: the
   /storage/v1/object/sign/<bucket>/<path>?token=… form, never a service file) — or a take on fal's
   immutable media CDN. Anything else (a public or another project's link, any other host) is held
   at the longest length allowed. m: a Stage media pick { kind, url, ref }. */
function stageProjectStorageObject(u){
  const cfg = (typeof window!=="undefined" && window.TURN_SUPABASE) || {};
  let host = ""; try{ host = new URL(String(cfg.url||"")).host; }catch(_e){ host = ""; }
  const bucket = String(cfg.bucket || "turn-assets");
  if(u.protocol!=="https:" || !host || u.host!==host || !u.searchParams.get("token")) return false;
  const m = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
  if(!m) return false;
  let b, segs;
  try{ b = decodeURIComponent(m[1]); segs = m[2].split("/").map(x=>decodeURIComponent(x)); }catch(_e){ return false; }
  if(b!==bucket) return false;
  if(!segs.length || segs.some(x=>!x || x==="." || x===".." || x.includes("/") || x.includes("\\") || x.includes("\0"))) return false;
  return segs.join("/").length<=1024 && segs[0]!=="_internal";
}
/* a take's link is the 1-hour signed URL loaded with the film: re-sign it right before a submit so
   the server can read (and copy) the file — an expired link counts as unread and is held at the
   longest length. Only a take in this project's storage is re-signed; any other pick goes as it is. */
async function stageFreshVideoRef(m){
  const ref = String((m && (m.ref || m.url)) || "");
  if(!m || m.kind!=="take" || typeof window==="undefined" || typeof window.cloudSignedUrl!=="function") return ref;
  let u; try{ u = new URL(ref); }catch(_e){ return ref; }
  if(!stageProjectStorageObject(u)) return ref;
  let path = "";
  try{ path = /^\/storage\/v1\/object\/sign\/[^/]+\/(.+)$/.exec(u.pathname)[1].split("/").map(x=>decodeURIComponent(x)).join("/"); }catch(_e){ return ref; }
  try{ const fresh = await window.cloudSignedUrl(path); return fresh || ref; }catch(_e){ return ref; }
}
function stageLengthSizesHold(m){
  if(!m) return false;
  const ref = String(m.ref || m.url || "");
  if(/^stage:/i.test(ref) || /^data:/i.test(ref) || /^blob:/i.test(ref)) return true;
  let u; try{ u = new URL(ref); }catch(_e){ return false; }
  if(u.protocol!=="https:") return false;
  return u.hostname==="fal.media" || u.hostname.endsWith(".fal.media") || stageProjectStorageObject(u);
}
/* the credits the server HOLDS for a "motion" or "editing" render — computed in provider USD and
   rounded exactly as the server rounds (turnCreditCost = creditsFromUsd), in the same order
   (rate × seconds; rate × 0.6 × (output + input)). o: { usdPerSecond, creditsPerSecond (fallback
   when the pricing table isn't loaded), orientation ("video" | "image", Motion Control) } */
function _stageLengthCredits(kind, o, secs){
  const mul = kind==="editing" ? STAGE_LENGTH_HOLD.videoInputMul : 1;
  const usd = Number(o.usdPerSecond);
  if(usd>0 && typeof window!=="undefined" && typeof window.turnCreditCost==="function")
    return window.turnCreditCost(kind==="motion" ? usd*secs : usd*mul*secs);
  const cps = Number(o.creditsPerSecond);
  return cps>0 ? Math.max(1, Math.ceil(cps*mul*secs - 1e-9)) : null;
}
/* the seconds held for a video the server read (billing-pricing.mjs lengthHoldSeconds): its length
   × 1.1 + 1 s, in tenths rounded up */
function stageLengthHoldSeconds(secs){
  const L = STAGE_LENGTH_HOLD;
  return Math.ceil((Number(secs)*L.lengthFactor + L.lengthPadSeconds)*10 - 1e-9)/10;
}
/* the HOLD. o.inputSeconds: the chosen video's measured length; o.sizable: the server sizes the hold
   by it (stageLengthSizesHold). Without both, the longest length allowed — what the server holds then.
   editing: the output follows the source and the source is the input, so both are held at the
   margin length (each capped at its own maximum). */
function stageLengthBilledHold(kind, o){
  o = o||{};
  const L = STAGE_LENGTH_HOLD;
  const inSecs = Number(o.inputSeconds);
  const held = (o.sizable===true && inSecs>0) ? stageLengthHoldSeconds(inSecs) : null;   // null → the maximum
  if(kind==="motion"){
    const max = o.orientation==="image" ? L.motionSeconds.image : L.motionSeconds.video;
    return _stageLengthCredits(kind, o, held!=null ? Math.min(max, held) : max);
  }
  if(kind==="editing") return _stageLengthCredits(kind, o, held!=null
    ? Math.min(L.editOutputSeconds, held) + Math.min(L.editInputSeconds, held)
    : L.editOutputSeconds + L.editInputSeconds);
  return null;
}
/* what a hold is sized on, for the tooltip: "length" (the video's length plus the margin), "stored"
   (a video the server doesn't size by its length — the longest length) or "" (no measured video yet) */
function stageLengthHoldBasis(m, inputSeconds){
  if(!m || !(Number(inputSeconds)>0)) return "";
  return stageLengthSizesHold(m) ? "length" : "stored";
}
/* the EXPECTED charge for the chosen video — what the server compares the Stage's quote with
   (lengthBilledVideoHold's `expected`): the video's length in whole seconds (0.05 s of tolerance)
   as the output, capped at the longest allowed, and for editing the same video as the input, in
   tenths rounded up. o.inputSeconds: the chosen video's measured length. */
function stageLengthBilledEstimate(kind, o){
  o = o||{};
  const L = STAGE_LENGTH_HOLD;
  const inSecs = Number(o.inputSeconds);
  if(!(inSecs>0)) return null;
  const whole = Math.max(1, Math.ceil(inSecs - 0.05));
  if(kind==="motion") return _stageLengthCredits(kind, o, Math.min(o.orientation==="image" ? L.motionSeconds.image : L.motionSeconds.video, whole));
  if(kind==="editing") return _stageLengthCredits(kind, o, Math.min(L.editOutputSeconds, whole) + Math.min(L.editInputSeconds, Math.ceil(inSecs*10 - 1e-9)/10));
  return null;
}
/* opts.hold: `cost` is what the server HOLDS (a render charged for the finished video's length);
   opts.estimate: the expected charge for the chosen video, when its length is known;
   opts.basis: what the hold is sized on (stageLengthHoldBasis: "length" | "stored" | "");
   opts.floor: `cost` is the LEAST the render can cost (Extend before the video to extend is
   measured: the added seconds alone).
   `empty`: the server would refuse this number (Generate's own block). `short`: flag a shortfall
   on screen (the composer's red outline, its warning, the right panel's error, the red footer) —
   never for a hold sized at the longest length only because no measured video is chosen yet
   (billing round 5: a short clip may well fit; the footer still says what is held and why). */
/* ON SOMEONE ELSE'S FILM THE OWNER PAYS (2026-10-09, owner — Stage editor review): the Stage checked the
   collaborator's OWN balance, blocked every render of an invitee without a plan ("Not enough generation
   credits… Choose a plan") and showed their own money. On a shared film the check is the person's monthly
   budget on the film (app.jsx keeps window.turnFilmBudget = {limit, spent}; limit null = no limit), the
   labels say who pays, and nothing opens the Plans window — the server decides. */
/* can this person change the Art Room (Shots, frames)? false for a Stage editor or a read-only share */
function stageArtWritable(){
  return !(typeof window!=="undefined" && typeof window.turnArtRoomWritable==="function") || !!window.turnArtRoomWritable();
}
function stageOwnerPaysInfo(cost, opts){
  const fmt = (n)=> (Number(n)||0).toLocaleString("en-US");
  const hold = !!(opts && opts.hold), floor = !hold && !!(opts && opts.floor);
  const b = (typeof window!=="undefined" && window.turnFilmBudget) || null;
  const limit = b && b.limit!=null && Number.isFinite(Number(b.limit)) ? Number(b.limit) : null;
  const left = limit!=null ? Math.max(0, limit - (Number(b.spent)||0)) : null;
  const short = left!=null && left < cost;
  const what = hold ? "Holds up to "+fmt(cost)+" credits while it runs" : (floor ? "Uses at least " : "Uses about ")+fmt(cost)+" credit"+(cost!==1?"s":"");
  return { known:left!=null, remaining:left, after:left!=null ? Math.max(0, left-cost) : null, frozen:false, hold, floor,
    basis:String((opts && opts.basis) || ""), cost, ownerPays:true, empty:short, short,
    label: what+" · paid by the film's owner"+(left!=null ? " · "+fmt(left)+" of your budget left this month" : ""),
    title: "Work on this film is paid from its owner's credits"+(limit!=null ? ", within your monthly budget on it ("+fmt(Number(b.spent)||0)+" of "+fmt(limit)+" used)." : ".")
      +(hold ? " The render holds credits while it runs; the rest is returned when it finishes, and a render that fails is refunded." : "") };
}
function stageCreditInfo(balance, cost, opts){
  cost = Number(cost)||1;
  if(typeof window!=="undefined" && typeof window.turnFilmPaidByOwner==="function" && window.turnFilmPaidByOwner())
    return stageOwnerPaysInfo(cost, opts);
  const hold = !!(opts && opts.hold);
  const floor = !hold && !!(opts && opts.floor);
  const estimate = (opts && Number(opts.estimate)>0) ? Math.ceil(Number(opts.estimate)) : null;
  const basis = String((opts && opts.basis) || "");
  const pending = hold && basis==="";   // no measured video yet: held at the longest length allowed
  const b = balance || (typeof window!=="undefined" ? window.turnCreditBalance : null);
  const remaining = b && Number(b.remaining);
  const known = Number.isFinite(remaining);
  const after = known ? Math.max(0, remaining-cost) : null;
  // an account ON HOLD (open payment dispute) can't spend: the server refuses the hold, so
  // Generate is blocked here too. The tooltip spells out plan vs pack credits when known.
  const frozen = !!(b && b.frozen===true) && !(typeof window!=="undefined" && window.turnIsAdmin);
  const breakdown = (known && typeof window!=="undefined" && typeof window.turnCreditBreakdownText==="function")
    ? window.turnCreditBreakdownText(b) : "";
  // one number format in the label and the tooltip (repair 2026-09-30): "1,234 remaining", "1,234 credits"
  const fmt = (n)=> (Number(n)||0).toLocaleString("en-US");
  // "Holds up to 378 credits; charged for the finished video’s length (about 63 for this video)"
  const refs = !!(opts && opts.refs);   // a reference-video render: charged for the references' real length
  const holdText = "olds up to "+fmt(cost)+" credit"+(cost!==1?"s":"")+"; charged for "+(refs ? "the reference video’s real length" : "the finished video’s length")
    +(estimate!=null ? " (about "+fmt(estimate)+(refs ? ")" : " for this video)") : "");
  return {
    known,
    remaining:known ? remaining : null,
    after,
    frozen,
    hold,
    floor,
    basis,
    cost,
    empty:frozen || (known && remaining < cost),
    short:frozen || (known && remaining < cost && !pending),
    label: frozen
      ? "Account on hold — spending credits is paused"
      : hold
      ? ("H"+holdText+" · "+(known ? fmt(remaining)+" remaining" : "remaining credits unavailable"))
      : floor
      ? ("Uses at least "+fmt(cost)+" generation credit"+(cost!==1?"s":"")+" · "+(known ? fmt(remaining)+" remaining" : "remaining credits unavailable"))
      : known
      ? ("Uses about "+fmt(cost)+" generation credit"+(cost!==1?"s":"")+" · "+fmt(remaining)+" remaining"+(remaining>=cost ? (" → "+fmt(after)+" after render") : ""))
      : ("Uses about "+fmt(cost)+" generation credit"+(cost!==1?"s":"")+" · remaining credits unavailable"),
    title: frozen
      ? "A payment on this account is being disputed, so spending credits is paused until it’s resolved."
      : hold
      ? ((known ? "Current balance: "+(breakdown || (fmt(remaining)+" generation credit"+(remaining===1?"":"s")))+". " : "Your credit balance hasn’t loaded yet. ")
        +"This render h"+holdText+": the credits are held when it starts ("
        +(basis==="length" ? "this video’s length plus a margin"
          : basis==="stored" ? "the longest length allowed: only a video the server can copy — one kept in the film’s storage, uploaded from your device, or rendered here — is held by its length"
          : "the longest length allowed until the video’s length is known")
        +"), the rest is returned when it finishes, and a render that fails is refunded.")
      : floor
      ? ((known ? "Current balance: "+(breakdown || (fmt(remaining)+" generation credit"+(remaining===1?"":"s")))+". " : "Your credit balance hasn’t loaded yet. ")
        +"This render costs at least "+fmt(cost)+"; the video’s own length is added once it’s chosen and measured. Credits are held when the render starts and refunded if it fails.")
      : known
      ? ("Current balance: "+(breakdown || (fmt(remaining)+" generation credit"+(remaining===1?"":"s")))+". This render costs about "+fmt(cost)+" \u2014 the charge follows the provider's actual cost, so it can come out a little higher, never above what is held. Credits are held when the render starts and refunded if it fails.")
      : "Your credit balance hasn’t loaded yet."
  };
}
/* the warning under the composer when the OPEN tab's render can't be covered (billing round 4).
   info: that tab's stageCreditInfo — the References render's cost on Create (the extension's on
   its Extend task), what the render HOLDS on Motion Control and Edit Video (the composer's
   footerCredit). "" when it's covered, when no measured video sizes the hold yet (round 5), or
   when the account is on hold (that has its own warning). */
function stageCreditShortText(info){
  if(!info || !info.short || info.frozen) return "";
  const fmt = (n)=> (Number(n)||0).toLocaleString("en-US");
  if(info.ownerPays) return "This needs about "+fmt(info.cost)+" credits, and your budget on this film has "+fmt(info.remaining)+" left this month. The film's owner can raise it.";
  const left = info.known ? ", "+fmt(info.remaining)+" remaining" : "";
  return info.hold
    ? "Not enough generation credits — this render holds up to "+fmt(info.cost)+" while it runs"+left+"."
    : "Not enough generation credits — this render needs "+(info.floor ? "at least " : "")+fmt(info.cost)+left+".";
}
/* the right panel's credit error for the OPEN tab's render (round 5): "" when there is no
   shortfall to flag (stageCreditInfo's `short`) */
function stageCreditPanelText(info){
  if(!info || !info.short) return "";
  if(info.ownerPays) return "Your budget on this film doesn't cover this render.";
  return info.frozen ? "Account on hold — spending credits is paused."
    : info.hold ? "Not enough generation credits to cover what this render holds."
    : "Not enough generation credits for this render.";
}
/* PLAN NAMES AS USERS SEE THEM — display only. Plan ids, stored values and the names
   plans.jsx hands back stay as they are ("studio" / "Studio"); the top plan is SHOWN
   as "Producer" so it no longer reads like the company or Blender Studio. */
function stagePlanName(p){
  const s = String(p==null?"":p).trim();
  return /^studio$/i.test(s) ? "Producer" : s;
}
function stagePlanForRes(r){
  const p = (typeof window!=="undefined" && typeof window.turnPlanForRes==="function") ? window.turnPlanForRes(r) : null;
  return p ? stagePlanName(p) : null;
}
window.stagePlanName = stagePlanName;
/* the open film's key for what the Stage keeps on this device (the Breakdown's clip counts, the
   prompt drafts) — films carry no project.id, so that alone keyed every film as "local" */
function stageFilmKey(project){
  const id = (typeof window!=="undefined" && window.turnOpenFilmId) || (project && project.id) || "";
  return String(id || "local");
}
window.stageFilmKey = stageFilmKey;
function stageFriendlyVideoError(err){
  const raw = String((err&&err.message)||err||"").trim();
  if(!raw) return "";
  const low = raw.toLowerCase();
  if((low.includes("video") && low.includes("reference") && (low.includes("resolution") || low.includes("720") || low.includes("480"))) ||
     (low.includes("reference video") && low.includes("duration"))){
    return "The video model refused one selected video reference. Reference videos must be short and draft-resolution (roughly 480p/720p, 2–15s). The Stage now skips unsafe previous-clip references automatically; reload and try the render again.";
  }
  if(low.includes("failed to download") || low.includes("download the file") || low.includes("url is accessible")){
    return "The video model couldn't download one of the selected images or clips. Kinolot refreshes cloud links and uploads files that only live in this browser before every render, so if this keeps happening, one selected source is probably missing, expired, private or too large. Re-open or regenerate that source, make sure the selected thumbnails load, then try Generate clip again.";
  }
  return raw;
}
/* PRICED AT THE LONGEST LENGTH (billing round 2): when the server can't read a reference video's
   length (a host it doesn't read, a format it can't parse, a slow read), it prices the render at the
   longest length allowed and refuses the quote shown with 409 { code:"price_changed",
   reason:"length_unreadable", creditsRequired:N, detail? }. The Stage asks first — the server's
   reason and that price — and, if the user agrees, sends the same render again quoting N (the
   server accepts a quote at or above its price). Nothing is held or charged until then. */
function stageLengthReprice(err){
  if(!err || String(err.code||err.billing||"")!=="price_changed") return null;
  if(err.reason!=="length_unreadable" && err.lengthUnverified!==true) return null;
  const credits = Math.ceil(Number(err.creditsRequired));
  if(!(credits>0)) return null;
  return { credits, detail:String(err.detail||"").trim(), message:String(err.message||"").trim() };
}
/* the server's `detail` is a CODE WORD (image-proxy index.ts, the 409's `why` map: host / format /
   timeout / unreadable), never a sentence — each becomes one plain sentence here (billing round 3).
   An unknown code shows the refusal's own message instead. */
const STAGE_LENGTH_UNREAD_WHY = Object.freeze({
  host: "The video is stored somewhere the server doesn’t read from; uploading it from your device or library avoids this.",
  format: "The video’s length couldn’t be checked because it isn’t an MP4 or MOV file.",
  timeout: "Reading the video’s length timed out.",
  unreadable: "The video’s length couldn’t be read.",
});
function stageRepriceText(rp, takes){
  const k = Math.max(1, Math.floor(Number(takes)||1));
  const n = rp.credits.toLocaleString("en-US");
  const code = String(rp.detail||"").trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(STAGE_LENGTH_UNREAD_WHY, code) ? STAGE_LENGTH_UNREAD_WHY[code] : "";
  const perTake = k>1 ? " a take ("+(rp.credits*k).toLocaleString("en-US")+" for "+k+" takes)" : "";
  const safe = "You’re never charged more than that, and a render that fails is refunded.";
  const own = String(rp.message||"").trim();
  const body = (!code || known || !own)
    ? (known || "A reference video’s length couldn’t be read.")+" So this render is priced at the longest length allowed: "+n+" credits"+perTake+". "+safe
    : own.replace(/([^.!?])$/,"$1.")+(k>1 ? " That’s"+perTake.replace(/^ a take/," per take")+"." : "")+" "+safe;
  return {
    title: "Render at "+n+" credits"+(k>1?" a take":"")+"?",
    body,
    confirmLabel: "Render at "+n+" credits",
  };
}
async function stageWithLengthReprice(run, req, takes){
  try{ return await run(req); }
  catch(e){
    const rp = stageLengthReprice(e);
    const quoted = Number(req && req.quote && req.quote.cost) || 0;
    if(!rp || rp.credits<=quoted) throw e;
    const t = stageRepriceText(rp, takes);
    let ok = false;
    try{
      ok = typeof window.appConfirm==="function"
        ? !!(await window.appConfirm({ title:t.title, body:t.body, confirmLabel:t.confirmLabel, cancelLabel:"Cancel" }))
        : (typeof window.confirm==="function" ? !!window.confirm(t.title+"\n\n"+t.body) : false);
    }catch(_e){ ok = false; }
    if(!ok){
      const no = new Error("Render not started — no credits were used.");
      no.repriceDeclined = true;
      throw no;
    }
    return await run({ ...req, quote:{ ...(req.quote||{}), cost:rp.credits } });
  }
}
window.stageWithLengthReprice = stageWithLengthReprice;
function stageCanOfferTextOnlyRecovery(err, modelId){
  if(String(modelId||"")!=="seedance-2.5") return false;
  // A media-free request already took this path. Offering the same paid retry
  // again creates a loop and cannot isolate the cause any further.
  if(err&&typeof err==="object"&&(err.requestMode==="text-only"||err.textOnly===true)) return false;
  const s=String((err&&err.message)||err||"");
  const policy=/provider rejected|content(?:,| ) safety|content policy|safety policy|likeness policy|policy refusal/i.test(s);
  const suppliedMedia=/images? or videos?|supplied (?:media|inputs?)|character reference|likeness(?:es)? of real (?:people|persons?)|private information/i.test(s);
  return policy && suppliedMedia;
}
function stageIsTextOnlyPolicyFailure(err){
  if(!err||typeof err!=="object") return false;
  const policy=err.name==="ProviderPolicyError"
    || /provider rejected|content policy|safety policy|likeness policy|policy refusal/i.test(String(err.message||""));
  return policy&&(err.requestMode==="text-only"||err.textOnly===true);
}
const STAGE_FICTIONAL_POLICY_CONTEXT="FICTIONAL CONTEXT: Treat the named characters as invented adults created for this fictional drama, not real people or public figures. Treat any names, messages, addresses or document text as fictional story material, not real private information.";
function stagePolicyContextPrompt(prompt){
  const src=String(prompt||"").trim();
  if(!src)return STAGE_FICTIONAL_POLICY_CONTEXT;
  if(src.toLowerCase().includes("fictional context:"))return src;
  return STAGE_FICTIONAL_POLICY_CONTEXT+"\n\n"+src;
}
/* LIKENESS (2026-10-10, owner — Likeness review). A clip whose cast includes a character with a locked likeness
   (or whose character sheet was made with one) shows a REAL person: the "Add fictional context" recovery says
   the characters are invented adults, not real people — untrue here — so it is not offered and its text is
   never sent for such a clip; the clip says before rendering that video engines may refuse it. Shots and
   storyboards keep using the face through the sheet only (decision F). */
const STAGE_LIKENESS_NOTE = "This clip shows a real person's likeness. Video engines may refuse it.";
function stageCastHasLikeness(cast, refChars){
  const metaCameo = (id)=>{ try{ const m = (typeof nbGetMeta==="function") ? nbGetMeta(id) : null; return !!(m && m.cameo); }catch(e){ return false; } };
  const locked = (id)=>{ try{
    if(typeof window.turnLikenessInfo==="function") return !!window.turnLikenessInfo(id);
    return !!(typeof nbCameoMeta==="function" && nbCameoMeta(id)); }catch(e){ return false; } };
  if((cast||[]).some(c=> c && c.id && (locked(c.id) || metaCameo(c.id)))) return true;
  return (refChars||[]).some(r=> r && ((r.entityId && locked(r.entityId)) || (r.assetId && metaCameo(r.assetId))));
}
function stageStripFictionalContext(prompt){
  const src = String(prompt||"");
  if(!/fictional context:/i.test(src)) return src;
  return src.split(STAGE_FICTIONAL_POLICY_CONTEXT).join("")
    .replace(/^[ \t]*FICTIONAL CONTEXT:[^\n]*(?:\n+|$)/gmi,"")
    .replace(/\n{3,}/g,"\n\n").trim();
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
window.stageIsTextOnlyPolicyFailure=stageIsTextOnlyPolicyFailure;
window.stagePolicyContextPrompt=stagePolicyContextPrompt;
window.stageCastHasLikeness=stageCastHasLikeness;
window.stageStripFictionalContext=stageStripFictionalContext;
window.STAGE_LIKENESS_NOTE=STAGE_LIKENESS_NOTE;
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
  // Current screenplay pages are local PNGs, never remote Art Room assets.
  if(asset&&asset.referenceKind==="screenplay"){
    if(!/^data:image\/png;base64,\S+$/.test(raw))
      throw new Error("A required screenplay screenshot is unavailable. Reload the beat before rendering.");
    return raw;
  }
  const id = asset && asset.id;
  if(id && typeof nbRemoteImageUrl==="function"){
    try{ const u = await nbRemoteImageUrl(id); if(u) return u; }catch(e){}
  }
  return raw;
}
function _shotAudioState(sh,auds,characters){
  const la=sh&&sh.lineAudio||{},url=(auds&&sh&&auds[sh.id])||"";
  const roster=Array.isArray(characters)?characters:null;
  const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const c=roster&&((la.speakerId&&roster.find(x=>String(x&&x.id)===String(la.speakerId)))
    ||roster.find(x=>norm(x&&x.name)===norm(la.speaker)));
  // Callers without a roster (small pure helpers/tests) can still validate bytes and
  // the line's own provenance. Production Shoot always supplies the live cast lock.
  const lock=c&&c.voiceLock ? c.voiceLock : (!roster&&la.voiceId?{
    voiceId:la.voiceId,modelId:la.modelId,modelChosen:true,defaults:la.settings||{},revision:la.voiceRevision||""
  }:null);
  // a real person's voice (source "cloned") doesn't follow the character's pronouns: never stale on an identity change (2026-10-11)
  if(c&&lock&&lock.source!=="cloned"){
    const currentRevision=c.identityRevision!=null?String(c.identityRevision):"";
    const lockedRevision=lock.identityRevision!=null?String(lock.identityRevision):"";
    const currentPronouns=String(c.canonicalPronouns||c.pronouns||"").trim().toLowerCase();
    const lockedPronouns=String(lock.identityPronouns||"").trim().toLowerCase();
    if((currentRevision!==lockedRevision&&(currentRevision||lockedRevision))
      ||(currentPronouns&&lockedPronouns&&currentPronouns!==lockedPronouns))
      return {ready:false,state:"stale-identity",reason:"The character identity changed after this voice was locked. Review and relock the canonical voice first."};
  }
  if(typeof window.vgLineAudioStatus==="function"){
    const meta=(typeof window.vgGetMeta==="function"&&sh&&sh.id)?window.vgGetMeta(sh.id):null;
    return window.vgLineAudioStatus(la,lock,sh&&sh.dialogue,url,window.__turnCurrentProjectId||"local",meta);
  }
  if(!url)return {ready:false,state:"missing-bytes",reason:"The line audio file is unavailable."};
  if(!la.durationMs)return {ready:false,state:"missing",reason:"This line has not been voiced."};
  if(la.stale)return {ready:false,state:"stale",reason:la.staleReason||"This line needs revoicing."};
  return {ready:true,state:"ready",reason:""};
}
function _shotAudioReady(sh,auds,characters){ return !!_shotAudioState(sh,auds,characters).ready; }
window.stageShotAudioState=_shotAudioState;
window.stageShotAudioReady=_shotAudioReady;
/* the clip's AUDIO-CLOCK duration — measured line audio PLUS breathing room. Scenes
   need air: 0.6s to settle in, 0.8s between lines (a look, a reaction), 0.6s to hold
   the final moment. Without it a two-line clip rendered wall-to-wall speech and the
   prompt's action beats had zero seconds to happen in. Clamped to the model's ceiling. */
const CLIP_AIR = { lead:0.6, gap:0.8, tail:0.6 };
/* ONE ACTION ESTIMATE (2026-10-09, owner — Mix review): an action shot's seconds in a dialogue clip, capped
   so an estimate never eats the clip. The clip's length, the Time-coded prompt's windows and the Mix's line
   placements all use it — the prompt counted action at full length, so it could describe more seconds than
   the clip had and the Mix dropped lines in early. */
function stageActionSec(sh){ return Math.min(3.5, (typeof stageShotRuntime==="function") ? stageShotRuntime(sh) : 2); }
function _clipMeasuredSec(clip, maxSec, auds, characters){
  const shots = ((clip&&clip.data&&clip.data.shots)||[]);
  const lines = ((clip&&clip.data&&clip.data.lineShots)||[]).filter(sh=>String(sh.dialogue||"").trim());
  if(!lines.length) return 0;
  if(!lines.every(sh=>_shotAudioReady(sh,auds,characters))) return 0;
  // walk EVERY member shot, the same way the Timeline recipe lays its windows:
  // dialogue shots = air + the measured line; ACTION shots = their runtime estimate
  // (capped — an estimate must never eat the whole clip). Counting only the lines
  // used to squeeze a one-line + two-action clip to ~4s with no time to act.
  let t = CLIP_AIR.lead, spoken = 0;
  shots.forEach(sh=>{
    const talks = String((sh&&sh.dialogue)||"").trim();
    if(talks){ if(spoken>0) t += CLIP_AIR.gap; t += Number((sh.lineAudio||{}).durationMs||0)/1000; spoken++; }
    else t += stageActionSec(sh);
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
/* One review notice per clip for beat-level coverage (see stageCurrentScreenplayDirection). */
function stageBeatLevelCoverageNote(coverage){
  const c=coverage||{};
  const planned=Number(c.planRows)>0
    ? c.planRows+" planned action moment"+(Number(c.planRows)===1?"":"s")
    : "no saved action-moment mapping";
  return "This beat has "+(Number(c.shots)||0)+" designed shot"+(Number(c.shots)===1?"":"s")
    +" based on "+planned+", but its screenplay contains "+(Number(c.blocks)||0)+" authored action block"+(Number(c.blocks)===1?"":"s")
    +". The video still performs the complete beat; each cut keeps its Shots-tab camera, composition and coverage notes as staging. "
    +"Re-draft this beat's shots from the screenplay in Shots if you want each cut linked to specific screenplay blocks.";
}
/* What a beat-level cut is TIMED against: its stored coverage rows, else its own
   Shots-tab staging line. Never the authored beat — the timed plan would budget the
   whole beat once per cut and raise a false over-duration blocker. */
function stageBeatLevelTimingRows(direction, sh){
  const rows=(direction&&Array.isArray(direction.coverage)) ? direction.coverage.map(x=>String(x||"").trim()).filter(Boolean) : [];
  if(rows.length) return rows;
  return [String((sh&&sh.action)||"").replace(/\s+/g," ").trim()].filter(Boolean);
}
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
   * Covers index the shot's STORED coverage plan when one exists (beatPlan.micro —
   * the moments the shots were drafted against, often an AI paraphrase of the
   * beat). Only shots drafted without a plan index the authored action blocks
   * directly. A stored plan maps onto the authored blocks ONLY when it has the
   * same number of rows; a count mismatch is a paraphrase granularity fact, not
   * evidence that the screenplay changed.
   */
  const planOf=x=>(x&&x.beatPlan&&Array.isArray(x.beatPlan.micro))
    ? x.beatPlan.micro.map(v=>String(v||"").replace(/\s+/g," ").trim()).filter(Boolean) : [];
  const coversOf=x=>Array.isArray(x&&x.covers) ? x.covers.map(Number).filter(Number.isFinite) : [];
  const shotMappable=x=>{
    const rows=planOf(x).length, cv=coversOf(x), target=rows||actions.length;
    return cv.length>0&&cv.every(n=>Number.isInteger(n)&&n>=1&&n<=target)&&(!rows||rows===actions.length);
  };
  const planRows=oldMicro.length;
  const coverTarget=planRows||actions.length;
  const coversInRange=covers.length>0&&covers.every(n=>Number.isInteger(n)&&n>=1&&n<=coverTarget);
  const planAligned=!planRows||planRows===actions.length;
  /*
   * A COMPLETE multi-shot beat renders every authored block whichever way the
   * cuts divide them. When the stored plan cannot be mapped onto the authored
   * blocks one-to-one (row-count mismatch, missing or out-of-range covers), the
   * beat is still fully covered by the clip: keep the authored blocks at BEAT
   * level (the performance source) and carry each shot's stored coverage rows as
   * navigation only. Never fuzzy-match paraphrased rows onto authored blocks.
   * The decision is made once for the WHOLE beat: if any peer is unmappable,
   * every cut of the beat is beat-level — otherwise a mapped cut would perform
   * its authored blocks a second time beside the beat-level block.
   */
  const beatMappable=[sh].concat(group.filter(x=>x&&x.id!==sh.id)).every(shotMappable);
  const beatLevel=completeBeat&&!wholeBeat&&group.length>0&&!beatMappable;
  /*
   * The clip builder marks a beat complete only when it contains every
   * scene/beat peer. A sole peer is therefore a whole-beat unit too; a
   * part/single-shot render is not. Resolve partial coverage against every
   * scene/beat peer, never against the selected clip's shortened peer list.
   * A PARTIAL render has no beat-level fallback: it must know which authored
   * blocks belong to the shot, so an unmappable plan stops it truthfully.
   */
  if(!wholeBeat&&!beatLevel){
    if(!group.length||!covers.length)
      return issue("This partial screenplay beat has no explicit shot coverage. Reconcile Covers in Shots before rendering.");
    if(!coversInRange)
      return issue("This shot's Covers point outside the beat's "+(planRows
        ? "saved shot plan ("+planRows+" action moment"+(planRows===1?"":"s")+")"
        : "authored action blocks ("+actions.length+")")+". Review Covers in Shots before rendering.");
    if(!planAligned)
      return issue("This shot was designed from "+planRows+" planned action moment"+(planRows===1?"":"s")
        +", but the screenplay beat has "+actions.length+" authored action block"+(actions.length===1?"":"s")
        +", so a partial render cannot tell which blocks this shot covers. Render the whole beat in one clip, or re-draft the beat's shots from the screenplay in Shots.");
  }
  /*
   * Covers are the stable association.  Apply them before looking at any
   * historical micro text. An exact authored line can relocate within the
   * selected covered slots (legacy shots stored per-shot micro arrays); all
   * rewrites fall back to the stable covered index only when the action shape
   * is unchanged. Never fuzzy-match a rewrite or infer an ordinal.
   */
  let actionIndexes=wholeBeat ? actions.map((_,i)=>i) : beatLevel ? [] : covers.map(n=>n-1);
  if(!wholeBeat&&!beatLevel&&oldMicro.length){
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
    const savedIndexes=Array.isArray(candidate&&candidate.screenplayDialogueIndexes)
      ? candidate.screenplayDialogueIndexes : [];
    savedIndexes.forEach(value=>{
      const n=Number(value);
      if(Number.isInteger(n)&&n>=0) explicitIndexes.push(n);
    });
    (Array.isArray(candidate&&candidate.dialogueLines)?candidate.dialogueLines:[]).forEach(row=>{
      const n=Number(row&&row.screenplayDialogueIndex);
      if(Number.isInteger(n)&&n>=0) explicitIndexes.push(n);
    });
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
      // A saved explicit occurrence index can disambiguate repeated exact words.
      // Do not add any of the other matching occurrences to this shot.
      if(matches.length>1&&(wholeBeat||matches.some(v=>explicitIndexes.includes(v.i))))continue;
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
      if((assignment.indexes||[]).some(i=>assigned.has(i)))
        return issue("The same screenplay dialogue occurrence is assigned to more than one shot. Assign each occurrence once before rendering.","screenplay-dialogue-review");
      (assignment.indexes||[]).forEach(i=>assigned.add(i));
    }
    const allAssigned=assigned.size===dialogue.length;
    (localExplicit.indexes||[]).forEach(i=>selectedDialogue.push(dialogue[i]));
    if(wholeBeat) selectedDialogue.splice(0,selectedDialogue.length,...dialogue);
    else if(completeBeat) clipDialogues=dialogue.map((row,i)=>assigned.has(i) ? null : {
      ...row,
      // Persist the authored occurrence, not just its words. Repeated lines are
      // therefore safe to assign from the Stage without fuzzy text matching.
      screenplayDialogueIndex:i
    }).filter(Boolean);
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
  /*
   * Beat-level coverage: the shot's stored plan rows (navigation, never
   * screenplay text) ride separately; the shot's text is the whole authored
   * beat — the performance source its prompt speaks — so the cast scan sees
   * every named identity and identical texts de-duplicate across the cuts.
   */
  const coverageRows=beatLevel&&coversInRange ? covers.map(n=>oldMicro[n-1]).filter(Boolean) : [];
  const beatActionItems=beatLevel ? actions.map(textOf).filter(Boolean) : [];
  const spokenItems=beatLevel ? beatActionItems : actionItems;
  const scriptParts=spokenItems.slice();
  if(line)scriptParts.push(String(line.speaker||"the speaker")+": "+String(line.text||"").trim());
  return {
    source,
    actions:actionItems,
    actionBlocks:selectedActions,
    beatLevel,
    coverage:coverageRows,
    beatActions:beatActionItems,
    beatActionBlocks:beatLevel ? actions.slice() : [],
    beatCoverage:beatLevel ? {planRows,blocks:actions.length,shots:group.length,coversInRange} : null,
    text:spokenItems.join(" "),
    script:scriptParts.join(" "),
    dialogues:selectedDialogue.slice(),
    clipDialogues,
    dialogueUnassigned:clipDialogues.length>0,
    dialogue:selectedDialogue.map(x=>String(x&&x.text||"").trim()).filter(Boolean).join(" "),
    dialogueRow:line,
    dialogueDelivery:line&&line.delivery || "onscreen"
  };
}

/* Turn complete-beat dialogue into explicit, durable shot ownership. This is a
   director action, never an inference: every screenplay occurrence must name one
   compatible shot, and a shot may own only one lip-sync performance because the
   current voice/render transport attaches one timed audio file per shot. */
function stageDialogueAssignmentKey(row,i){
  const e=row&&row.evidence||{};
  if(e.sceneId!=null&&e.beatN!=null&&e.blockIndex!=null)
    return [e.sceneId,e.beatN,e.blockIndex].join(":");
  return [e.beatN||"beat",row&&row.screenplayDialogueIndex!=null?row.screenplayDialogueIndex:i,String(row&&row.text||"")].join(":");
}
function stageShotHasDialogueAssignment(sh){
  return !!(String(sh&&sh.dialogue||"").trim()
    || (Array.isArray(sh&&sh.dialogueLines)&&sh.dialogueLines.length)
    || (Array.isArray(sh&&sh.screenplayDialogueIndexes)&&sh.screenplayDialogueIndexes.length)
    || (sh&&sh.screenplayDialogueIndex!=null&&Number.isInteger(Number(sh.screenplayDialogueIndex))));
}
function stageDialogueAssignmentPatches(clip,selections){
  const d=clip&&clip.data||{};
  const rows=Array.isArray(d.clipDialogueLines)?d.clipDialogueLines:[];
  const shots=Array.isArray(d.shots)?d.shots:[];
  if(!rows.length)return {patches:[],error:"There are no unassigned screenplay lines in this clip."};
  const picked=new Set(),patches=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i]||{},key=stageDialogueAssignmentKey(row,i);
    const shotId=String(selections&&selections[key]||"");
    const sh=shots.find(x=>String(x&&x.id||"")===shotId);
    if(!sh)return {patches:[],error:"Choose a shot for every screenplay line."};
    const beatN=Number(row&&row.evidence&&row.evidence.beatN || row&&row.beatN);
    if(Number.isFinite(beatN)&&Number(sh.beatN)!==beatN)
      return {patches:[],error:"Each line must be assigned to a shot from the same beat."};
    if(picked.has(shotId))
      return {patches:[],error:"Each shot can carry one locked-voice line. Choose a different shot, or add a shot in Shots."};
    if(stageShotHasDialogueAssignment(sh))
      return {patches:[],error:"That shot already owns screenplay dialogue. Choose another shot."};
    const index=Number(row.screenplayDialogueIndex);
    if(!Number.isInteger(index)||index<0)
      return {patches:[],error:"One line has no stable screenplay occurrence. Reload the Stage before assigning it."};
    picked.add(shotId);
    const savedRow={...row,screenplayDialogueIndex:index};
    patches.push({id:sh.id,patch:{
      dialogue:String(row.text||"").trim(),
      dialogueLines:[savedRow],
      screenplayDialogueIndex:index,
      screenplayDialogueIndexes:[index],
      // A previous audio file cannot legally survive a new screenplay binding.
      lineAudio:undefined
    }});
  }
  return {patches,error:""};
}
window.stageDialogueAssignmentKey=stageDialogueAssignmentKey;
window.stageDialogueAssignmentPatches=stageDialogueAssignmentPatches;
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
    const spoken = next.type==="paren" ? (blocks[i+2]||{}) : next;
    if(b.type==="char" && spoken.type==="dia"){
      const nextText = _normStageText(spoken.text);
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
/* A SHOT'S PANEL ON THE BOARD, BY BEAT (2026-10-09, owner decision — Storyboards geometry review): the board
   draws one keyframe per beat (sbBoardShots), so a shot maps to its BEAT's panel — the keyframe itself, or the
   panel of the beat an alternative / split-beat shot belongs to; an unnumbered shot maps to its own panel when
   the board draws it. -1 = no panel. `allShots` is the scene's full live list (a clip's shot objects may carry
   only their id). */
function stageBoardPanelIndex(sh, boardShots, allShots){
  if(!sh || !Array.isArray(boardShots)) return -1;
  const own = boardShots.findIndex(x=>x && String(x.id)===String(sh.id));
  if(own>=0) return own;
  const live = (allShots||[]).find(x=>x && String(x.id)===String(sh.id)) || sh;
  const n = Number(live && live.beatN);
  if(!(n>0)) return -1;
  return boardShots.findIndex(x=>x && Number(x.beatN)===n);
}
window.stageBoardPanelIndex = stageBoardPanelIndex;
function stageSheetPanelMeta(g, i, scene){
  const abs = (Number(g&&g.start)||0) + i;
  const allShots = scene ? ((window.__sbShots||[]).filter(sh=>sh && sh.sceneId===scene.id)
    .sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0))) : null;
  // the panel's place on the BOARD (one keyframe per beat — sbBoardShots): the shot's BEAT panel (G7,
  // 2026-10-09 — an off-board shot used to take its place in the full list, naming another shot's panel)
  const sceneShots = (allShots && typeof window.sbBoardShots==="function") ? window.sbBoardShots(allShots) : allShots;
  const ranges = stagePageRanges(sceneShots);
  const shotHere = (g && Array.isArray(g.shots) && g.shots[i]) || (allShots && allShots[abs]) || null;
  const boardIdx = (shotHere && sceneShots) ? stageBoardPanelIndex(shotHere, sceneShots, allShots) : -1;
  // a shot whose beat has no panel on the board has no sheet position
  if(sceneShots && sceneShots.length && shotHere && boardIdx<0) return { abs, page:null, panel:null, half:null };
  const at = boardIdx>=0 ? boardIdx : abs;
  let page = Math.floor(at/4)+1, cell = at % 4;   // legacy fallback
  let acc = 0;
  for(let p=0;p<ranges.length;p++){
    if(at>=acc && at<acc+ranges[p].count){ page=p+1; cell=at-acc; break; }
    acc += ranges[p].count;
  }
  // cells fill the 2×2 grid row by row: "top" = cells 1/2, "bottom" = cells 3/4 (names kept — saved ids use them)
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
      else if(direction.beatLevel&&direction.beatCoverage) screenplayDirectionIssues.push({
        code:"screenplay-coverage-beat-level",blocking:false,shotId:sh&&sh.id,
        message:stageBeatLevelCoverageNote(direction.beatCoverage)
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
    const stateAsset=(rs&&rs.referenceAssetId&&typeof nbGetImage==="function"&&nbGetImage(rs.referenceAssetId)) ? rs.referenceAssetId : "";   // (2026-10-08) never a variant that wasn't made
    const so = stateAsset ? {id:stateAsset,state:{label:(rs.event&&rs.event.referenceStateLabel)||rs.condition||"changed condition"}}
      : ((typeof shotPropSheetId==="function") ? shotPropSheetId(p, scene, _storyScenes) : { id:p.id, state:null });
    const co = (typeof custodyOwnerAt==="function") ? custodyOwnerAt(p, scene, _storyScenes) : { name:p.ownerName, handover:null };
    return { id:p.id, sheetId:so.id||p.id, name:p.name, kind:(rs&&rs.bindingMode)||p.kind||"",
      stateLabel:(so.state&&so.state.label)||((rs&&rs.condition&&rs.condition!=="intact")?rs.condition:""),
      holder:(rs&&rs.holderName)||co.name||p.ownerName||"", placement:rs&&rs.placement||null,
      contentByShot:(shots||[]).map((sh,i)=>({shotId:sh.id,content:resolvedStates[i]&&resolvedStates[i].contentNotes||"",version:resolvedStates[i]&&resolvedStates[i].contentVersion||""})).filter(x=>x.content),
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
  // the look's own lighting only (2026-10-08, owner — Color review): no invented "naturalistic" line when no look
  // is set (the frames get none), and the grade isn't printed twice when a look has no lighting
  const lighting = (preset && preset.lighting) || "";
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
    const beatLevel=!!(currentDirection&&currentDirection.beatLevel&&!manualVideo);
    const micro = canonical ? [] : (manualVideo ? [] : (currentDirection
      ? (beatLevel ? stageBeatLevelTimingRows(currentDirection, sh) : currentDirection.actions) : stageShotMicroTexts(sh)));
    const microText = canonical ? String(beatSource.text||"")
      : (currentDirection ? currentDirection.text
        : stageShotMicroPromptText(scene, ctx.drafts, ctx.beatsMap, sh, 190));
    // the Shots tab's camera grammar, preserved PER SHOT — the clip-level "camera arc"
    // flattens these into one description; the shoot package and timeline recipes need
    // each setup intact (size · angle · move · lens + the composition note).
    const camSpec = (typeof shotSizeOf==="function")
      ? [shotSizeOf(sh.size).label, shotAngleOf(sh.angle).label, shotMoveOf(sh.move).label, shotLensOf(sh.lens).label].filter(Boolean).join(" · ")
      : "";
    // the rest of the Shots-tab design, verbatim and labelled: the card's purpose,
    // its storyboard staging line, the director's own notes and any explicitly
    // chosen advanced camera settings (auto values are omitted, never invented)
    const cameraSettings = (typeof shotCameraSettingsClause==="function")
      ? String(shotCameraSettingsClause(sh)||"").replace(/^Advanced camera settings\s*—\s*/i,"").trim() : "";
    return { shotId:sh.id, beatN:sh.beatN, sheetPage:meta.page, sheetPanel:meta.panel, half:meta.half,
      beatLevel, coverage:beatLevel ? (currentDirection.coverage||[]).slice() : [],
      beatActionBlocks:beatLevel ? (currentDirection.beatActionBlocks||[]).slice() : [],
      beatCoverage:beatLevel ? currentDirection.beatCoverage : null,
      staging:String((sh&&sh.action)||"").replace(/\s+/g," ").trim(),
      purpose:String((sh&&sh.purpose)||"").replace(/\s+/g," ").trim(),
      directives:String((sh&&sh.directives)||"").replace(/\s+/g," ").trim(),
      cameraSettings,
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
      actionBlocks:canonical ? (beatSource.blocks||[]).filter(b=>/^(action|trans)$/i.test(b.type||""))
        : (!manualVideo&&currentDirection ? currentDirection.actionBlocks||[] : []),
      micro };
  });
  const actions = _uniq(panelLines.map(p=>String(p.text||"").trim()).filter(Boolean));
  // multi-line: one action per line, sections separated by blank lines — readable
  // for humans, and video models take newlines fine
  const body = actions.join("\n");
  const setting = loc ? (loc.name) : (scene.loc||"");
  const lookText = (typeof turnVideoLookText==="function") ? turnVideoLookText(preset, ctx.project)
    : (preset ? (preset.name+" — "+preset.grade) : "");
  const styleClause = lookText ? ("Style: "+lookText+".") : "";
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
    const occurrenceKey=row=>{
      const e=row&&row.evidence;
      return e&&Number.isInteger(e.blockIndex)
        ?JSON.stringify([e.sceneId||scene.id,e.beatN||n,e.blockIndex]):"";
    };
    const matchOccurrence=(rows,sourceRow)=>{
      const key=occurrenceKey(sourceRow);
      if(key){
        const exact=rows.findIndex(row=>occurrenceKey(row)===key);
        if(exact>=0)return exact;
      }
      const words=String(sourceRow&&sourceRow.text||"").trim();
      // Legacy rows without evidence are usable only for unique source text.
      // Repeated words must never swap speakers, delivery or attachment identity.
      if((src.dialogue||[]).filter(row=>String(row&&row.text||"").trim()===words).length!==1)return -1;
      const hits=rows.map((row,i)=>({row,i})).filter(({row})=>
        !occurrenceKey(row)&&String(row&&row.text||"").trim()===words);
      return hits.length===1?hits[0].i:-1;
    };
    const mergedDialogue=(panelDialogue.length||clipRows.length)&&src&&Array.isArray(src.dialogue)
      ? src.dialogue.map(row=>{
          const assigned=matchOccurrence(panelDialogue,row);
          if(assigned>=0){
            const picked=panelDialogue[assigned];
            panelDialogue.splice(assigned,1);
            return picked;
          }
          const clipIndex=matchOccurrence(clipRows,row);
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
      beatScripts[n]={hasSource:true,text:String(src.text||""),blocks:src.blocks||[],sceneHeading:String(src.sceneHeading||""),openingAction:String(src.openingAction||""),
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
    // beat-level shots time against their stored coverage rows (navigation), never
    // against the whole beat's authored blocks repeated once per cut
    const micro=manualVideo ? [manualVideo]
      : direction.beatLevel ? stageBeatLevelTimingRows(direction, sh) : (direction.actions||[]).slice();
    next.beatPlan={...(prior||{}),micro};
    if(Array.isArray(sh.covers)&&sh.covers.length)
      next.covers=micro.map((_,i)=>i+1);
    return next;
  });
  const sourceCharacterIds=new Set(Object.values(beatScripts).flatMap(s=>[].concat(s.physicalCharacterIds||[],s.remoteCharacterIds||[])));
  const sourceCharacters=(ctx.characters||[]).filter(c=>sourceCharacterIds.has(c.id)).map(c=>({id:c.id,name:c.name}));
  return { shots, promptShots, screenplayDirectionIssues, clipDialogueByBeat, clipDialogueLines, first, cast, sourceCharacters, props:clipProps, loc, locSheet, preset, lookText, camera, cameraProfile, lighting, lead, prompt, chips, setting, panelLines, protect, beatDialogues, beatScripts, remoteCharacterIds,
    dur:_clipDur(g, maxSec), lineShots };
}

function stageRenderScopeInstruction(clipScope,clip,shots,promptShots,panelLines){
  const scopeLabel=clipScope==="shot" ? "Single shot"
    : clipScope==="legacy" ? "earlier-grouping clip" : "Split to fit";
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

/* The automatic director brief already owns scope and reference roles. Appending
   the same blocks again weakens attention and can contradict a later manual edit.
   Untouched/current briefs therefore ship each block once; edited or legacy
   prompts still receive the hard scope/reference guards at the paid boundary. */
function stageAssembleRenderPrompt(prompt,opts){
  opts=opts||{};
  let out=String(prompt||"").trim();
  const automatic=!opts.edited;
  const add=block=>{ block=String(block||"").trim(); if(block&&out.indexOf(block)<0) out+=(out?"\n\n":"")+block; };
  if(!(automatic&&/^BEAT CONTRACT\s*$/mi.test(out))) add(opts.scopeInstruction);
  if(opts.identityPrompt&&out.indexOf(opts.identityPrompt)<0)
    add("CANONICAL CHARACTER IDENTITY (binding): "+opts.identityPrompt);
  if(!opts.referenceFree){
    if(!(automatic&&/^ACTIVE REFERENCES\s*$/mi.test(out))) add(opts.referenceBlock);
    (opts.voiceReferenceLines||[]).forEach(add);
  }
  return out;
}
window.stageAssembleRenderPrompt=stageAssembleRenderPrompt;

function stageClipPropDependencySignature(clipData, sceneId, context){
  if(typeof propDependencySignature!=="function") return "";
  const C=context||window.turnContinuity||{};
  return ((clipData&&clipData.shots)||[]).map(sh=>
    String(sh.id||"")+"="+propDependencySignature(C.props||[],sceneId,sh.beatN,sh.microBeatId,sh.id,C)
  ).join("||");
}
/* v2 (2026-10-08, owner — Props review): per shot, only the props IN it — their story state and, for
   text-only ones, their description (a regenerated SHEET is "References need review" on the take) */
/* attachedByShot ({shotId:{propId:assetId}}, 2026-10-09): the prop sheets the render really attached — a
   prop with a sheet is stamped by that sheet (its state), not its description, and the sheet it used
   (master or state) is recorded; the check reads them back from the stamp */
function stageClipPropDependenciesV2(clipData, sceneId, context, attachedByShot){
  if(typeof propFrameDependencies!=="function") return "";
  const attachedAll = attachedByShot || {};
  const C=context||window.turnContinuity||{};
  const charById={}; (C.characters||[]).forEach(c=>{ if(c&&c.id) charById[c.id]=c; });
  const propById={}; (C.props||[]).forEach(p=>{ if(p&&p.id) propById[p.id]=p; });
  const scene=(C.scenes||[]).find(s=>s&&s.id===sceneId)||{ id:sceneId };
  const per={};
  ((clipData&&clipData.shots)||[]).forEach(sh=>{ if(!sh||!sh.id) return;
    let ids=[]; try{ ids=(typeof inFrameProps==="function") ? (inFrameProps(sh, scene, charById, propById)||[]) : (sh.props||[]); }catch(e){ ids=sh.props||[]; }
    const attached=attachedAll[sh.id]||{};
    per[sh.id]=propFrameDependencies(Array.from(new Set(ids.concat(Object.keys(attached)))), attached, C.props||[], sceneId, sh.beatN, sh.microBeatId, sh.id, C); });
  return "pdc2|"+JSON.stringify(per);
}
function stageClipPropDependenciesChanged(stored, clipData, sceneId, context){
  if(stored==null || stored==="") return false;
  const s=String(stored);
  if(s.indexOf("pdc2|")!==0) return s!==stageClipPropDependencySignature(clipData, sceneId, context);   // a take stamped before
  // the sheets the take attached, read back from its own stamp, so the check compares like with like
  const attachedBack = (()=>{ const out={}; try{ const st=JSON.parse(s.slice(5))||{};
    Object.keys(st).forEach(sid=>{ let list=[]; try{ list=JSON.parse(String(st[sid]||"").replace(/^pd2\|/,"")||"[]"); }catch(e){}
      (Array.isArray(list)?list:[]).forEach(x=>{ if(x && x.id && x.sheet) (out[sid]=out[sid]||{})[x.id]=x.sheet; }); }); }catch(e){} return out; })();
  let a, b; try{ a=JSON.parse(s.slice(5)); b=JSON.parse(stageClipPropDependenciesV2(clipData, sceneId, context, attachedBack).slice(5)||"{}"); }catch(e){ return false; }
  const ka=Object.keys(a||{}), kb=Object.keys(b||{});
  if(ka.length!==kb.length) return true;
  return ka.some(k=> !(k in b) || (typeof propDependenciesChanged==="function" ? propDependenciesChanged(a[k], b[k]) : a[k]!==b[k]));
}
window.stageClipPropDependenciesV2 = stageClipPropDependenciesV2;
window.stageClipPropDependenciesChanged = stageClipPropDependenciesChanged;
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
  const allShots = ((window.__sbShots||[]).filter(s=>s && s.sceneId===clip.scene.id))
    .sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0));
  // THE BOARD DRAWS ONE KEYFRAME PER BEAT (storyboard.jsx sbBoardShots, 2026-10-09): pages are laid out from
  // that list, and a clip finds its panels BY BEAT (owner decision 2026-10-09 — Storyboards geometry review):
  // the panels of the beats its shots belong to (stageBoardPanelIndex). With the default grouping a multi-shot
  // clip is one beat, and only that beat's keyframe is on the board — matching by shot id marked every such
  // clip off the board. It is off the board only when NONE of its beats has a panel.
  const sceneShots = (typeof window.sbBoardShots==="function") ? window.sbBoardShots(allShots) : allShots;
  const ranges = stagePageRanges(sceneShots);
  const pages=[], halves=[];
  // the shots each page / half holds NOW, so a sheet drawn from other shots is never used
  // (storyboard.jsx sbSheetStale); only known when the live geometry is
  const expect = {}, halfShots = {};
  // the clip's own shots — a board is used only when every panel on it is one of these (2026-10-05)
  const clipShotsList = ((clip&&clip.g&&Array.isArray(clip.g.shots)&&clip.g.shots.length) ? clip.g.shots : allShots.slice(start, start+count));
  const clipShotIds = clipShotsList.map(s=>s && s.id).filter(Boolean);
  // the board panels this clip's beats sit on, in board order (a clip spanning cells/pages gets them in order)
  const boardAt = [];
  clipShotsList.forEach(sh=>{ const p = stageBoardPanelIndex(sh, sceneShots, allShots); if(p>=0 && boardAt.indexOf(p)<0) boardAt.push(p); });
  boardAt.sort((a,b)=>a-b);
  const clipPanelIds = boardAt.map(p=>sceneShots[p].id);
  const offBoard = !!ranges && !boardAt.length;
  for(let k=0; k<(offBoard ? 0 : (ranges ? boardAt.length : count)); k++){
    const n = ranges ? boardAt[k] : start+k;
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
    if(ranges && !expect[pageId]){
      let acc=0; for(let i=0;i<pageNo;i++) acc+=ranges[i].count;
      expect[pageId] = sceneShots.slice(acc, acc+ranges[pageNo].count).map(s=>s.id);
      halfShots[pageId+":half-top"] = expect[pageId].slice(0,2);
      halfShots[pageId+":half-bottom"] = expect[pageId].slice(2);
    }
  }
  const page = pages[0] || (offBoard ? "" : ("sbsheet-sbpage-"+clip.scene.id+"-2x2-"+Math.floor(start/4)));
  return {
    sheet:page, pages, halves, top:halves[0]||"", bottom:halves[1]||"", expect, halfShots, clipShotIds, clipPanelIds, offBoard,
    legacySheet:legacy, legacyTop:legacy+":half-top", legacyBottom:legacy+":half-bottom",
    all:Array.from(new Set([].concat(pages, halves, [legacy, legacy+":half-top", legacy+":half-bottom"])))
  };
}
window.storyboardClipIds = storyboardClipIds;   // exported for the headless geometry tests
function storyboardClipAssets(clip, imgs){
  const ids = storyboardClipIds(clip);
  // OUT-OF-DATE SHEETS STAY OUT (2026-10-02): a page or half whose recorded shots aren't the
  // shots it holds now shows other panels — it is left out (the clip falls back to its frames)
  // and listed in `stale`, so the Stage says why instead of sending the wrong board
  const metaOf = (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
  const stale = [];
  const pageOf = (id)=> String(id).replace(/:half-(top|bottom)$/,"");
  const isStale = (id)=>{
    const exp = ids.expect && ids.expect[pageOf(id)];
    if(!exp || !imgs[id]) return false;
    const m = /:half-(top|bottom)$/.exec(String(id));
    // a composed sheet with "Frame not generated" panels is never a video source (2026-10-09)
    const partial = !m && (()=>{ const sm = metaOf(id); return !!(sm && sm.composed && Number(sm.missing)>0); })();
    const bad = partial || (m
      ? (typeof window.sbHalfStale==="function" && window.sbHalfStale(metaOf(id), exp, m[1], metaOf(pageOf(id))))
      : (typeof window.sbSheetStale==="function" && window.sbSheetStale(metaOf(id), exp)));
    if(bad && stale.indexOf(id)<0) stale.push(id);
    return !!bad;
  };
  const urlOf = (id)=> (id && !isStale(id)) ? (imgs[id]||"") : "";
  /* ONLY THIS CLIP'S PANELS (2026-10-05, owner — Storyboards review): the tab packs pages by beat, the
     Stage packs clips by length, so a half or a page can hold a neighbouring clip's panels (a 2-shot clip
     across a page's middle got both halves — 4 panels). A board is used only when every panel on it is
     one of this clip's shots AND together they cover all of them; otherwise the clip uses its own shot
     frames. A clip on one whole page uses that page; one across two pages uses no sheet. */
  // (2026-10-09) "this clip's panels" are the board panels of its BEATS (storyboardClipIds clipPanelIds)
  const panelIds = ids.clipPanelIds || ids.clipShotIds || [];
  const clipSet = new Set(panelIds);
  const known = !!(panelIds.length && Object.keys(ids.expect||{}).length);
  const onlyClip = (list)=> !!(list && list.length) && list.every(x=>clipSet.has(x));
  const covers = (lists)=>{ const got = new Set(); lists.forEach(l=>(l||[]).forEach(x=>got.add(x))); return panelIds.every(x=>got.has(x)); };
  let halves = (ids.halves||[]).map(id=>({ id, url:urlOf(id) })).filter(h=>h.url);
  let pages = (ids.pages||[]).map(id=>({ id, url:urlOf(id) })).filter(p=>p.url);
  let sheet = urlOf(ids.sheet), top = urlOf(ids.top), bottom = urlOf(ids.bottom);
  if(known){
    const halvesOk = halves.length===(ids.halves||[]).length
      && halves.every(h=>onlyClip(ids.halfShots[h.id])) && covers(halves.map(h=>ids.halfShots[h.id]));
    if(!halvesOk){ halves = []; top = ""; bottom = ""; }
    const pagesOk = pages.length===(ids.pages||[]).length
      && pages.every(p=>onlyClip(ids.expect[p.id])) && covers(pages.map(p=>ids.expect[p.id]));
    if(!pagesOk) pages = [];
    // a single sheet stands for the clip only when that one page is exactly the clip
    if(!(pagesOk && pages.length===1)) sheet = "";
  }
  // an older per-clip board (sbclip ids) counts only when it records exactly this clip's shots
  const legacyOk = (id)=>{ const m = metaOf(id); return !!(imgs[id] && m && Array.isArray(m.shotIds)
    && m.shotIds.length===(ids.clipShotIds||[]).length && m.shotIds.every((x,i)=>String(x)===String(ids.clipShotIds[i]))); };
  return {
    ids,
    sheet:sheet||(legacyOk(ids.legacySheet) ? imgs[ids.legacySheet] : "")||"",
    pages,
    halves,
    top:top||(legacyOk(ids.legacyTop) ? imgs[ids.legacyTop] : "")||"",
    bottom:bottom||(legacyOk(ids.legacyBottom) ? imgs[ids.legacyBottom] : "")||"",
    stale
  };
}
/* an image map that falls back to the image cache — for scenes whose images this view hasn't loaded */
function stageImgsWithCache(imgs){
  const base = imgs||{};
  if(typeof Proxy!=="function") return base;
  return new Proxy(base, { get:(t,k)=> (t[k] || ((typeof k==="string" && typeof nbGetImage==="function") ? (nbGetImage(k)||undefined) : undefined)) });
}
function clipPrimaryFrame(clip, imgs, visualSource){
  const story = storyboardClipAssets(clip, imgs);
  const beatOpening=!!((clip&&clip.data&&clip.data.shots)||[]).some(stageBeatOpeningShot);
  if(beatOpening) return imgs[(clip.data.first||{}).id] || "";
  // a clip whose board is out of date or off the board renders from its frames — its thumbnail too
  if(visualSource==="halves") return story.top || story.bottom || story.sheet || imgs[(clip.data.first||{}).id] || "";
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
  // saved but OUT OF DATE (the page's shots changed) — the menu says so instead of "none saved"
  const halvesStale = !hasHalves && (story.stale||[]).some(id=>/:half-(top|bottom)$/.test(String(id)));
  const sheetStale = !hasSheet && (story.stale||[]).some(id=>!/:half-(top|bottom)$/.test(String(id)));
  // none of the clip's beats has a panel on the board — the menu says so, not "none saved" (2026-10-09)
  const offBoard = !!(story.ids && story.ids.offBoard);
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
  return { mode, ready, hasHalves, hasSheet, halvesStale, sheetStale, offBoard, frameReady, framesReady,
    ...(STAGE_SOURCE_MODES[mode]||STAGE_SOURCE_MODES.frame) };
}

/* ONE HONEST STATUS PER CLIP (2026-10-05, owner — Stage review): what feeds this clip, by the Art
   Room's own rules — its frames (made? approved? current? made with an earlier colour look? — the
   Shots tab's shotFrameState) and the reference images its shots attach that don't exist yet (the
   Shots "Needs:" list, sceneReferenceNeeds). The Shoot console, its Generate question and the
   Scenes rail all read this, so they never disagree. */
/* opts.loading: the view's image load state ({id:"loading"|…}) — a frame still loading is LOADING, never
   "not made yet" (2026-10-09: "Render anyway" then sent a paid render without it); opts.sourceMode: the
   visual source this render really uses — only the frames it sends are judged (board modes send none,
   "frame" sends the first). A frame both out of date and unapproved counts once, as out of date. */
function stageClipReadiness(clip, ctx, imgs, drafts, opts){
  opts = opts||{};
  const d = (clip && clip.data) || {}, shots = d.shots || [], scene = (clip && clip.scene) || {};
  const plan = stageClipSourcePlan(clip, imgs||{});
  const has = (id)=> !!((imgs||{})[id]) || (typeof nbGetImage==="function" && !!nbGetImage(id));
  const loadingOf = (id)=>{ const L = opts.loading; if(!L) return false;
    return (typeof L.has==="function") ? L.has(id) : L[id]==="loading"; };
  const mode = opts.sourceMode || plan.mode;
  const firstId = (d.first && d.first.id) || ((shots[0]||{}).id);
  const firstShot = shots.find(sh=>sh && sh.id===firstId) || shots[0];
  const used = (mode==="halves" || mode==="sheet") ? [] : mode==="frame" ? (firstShot ? [firstShot] : []) : shots;
  const sceneShotsAll = (((window.turnContinuity||{}).shots)||[]).filter(x=>x && x.sceneId===scene.id);
  const frames = { missing:0, loading:0, unapproved:0, stale:0, oldLook:0, charChanged:0, locChanged:0, propChanged:0 };
  used.forEach(sh=>{
    if(!has(sh.id) && loadingOf(sh.id)){ frames.loading++; return; }
    if(typeof shotFrameState==="function"){
      const st = shotFrameState(sh, sceneShotsAll.length ? sceneShotsAll : shots, drafts||{}, (ctx||{}).project, has);
      if(!st.rendered){ frames.missing++; return; }
      if(!st.current) frames.stale++;
      else if(!st.approved) frames.unapproved++;
      if(st.oldLook) frames.oldLook++;
      if(st.charChanged) frames.charChanged++;
      if(st.locChanged) frames.locChanged++;   // the Shots card's notes, counted the same way (2026-10-09)
      if(st.propChanged) frames.propChanged++;
    } else if(!has(sh.id)) frames.missing++;
  });
  let needs = [];
  if(typeof sceneReferenceNeeds==="function" && shots.length){
    const location = (typeof locationForScene==="function") ? locationForScene((ctx||{}).locations||[], scene.id) : null;
    try{ needs = sceneReferenceNeeds(shots, { ...(ctx||{}), scene, location }, has) || []; }catch(e){ needs = []; }
  }
  const n = (k, one, many)=> k+" "+(k===1?one:many);
  const issues = [];
  if(frames.loading) issues.push(n(frames.loading, "frame still loading", "frames still loading"));
  if(frames.missing) issues.push(n(frames.missing, "frame not made yet", "frames not made yet"));
  if(frames.unapproved) issues.push(n(frames.unapproved, "frame not approved", "frames not approved"));
  if(frames.stale) issues.push(n(frames.stale, "frame out of date", "frames out of date"));
  if(frames.oldLook) issues.push(n(frames.oldLook, "frame made with an earlier look", "frames made with an earlier look"));
  if(frames.charChanged) issues.push(n(frames.charChanged, "frame made with an older character sheet", "frames made with an older character sheet"));
  if(frames.locChanged) issues.push(n(frames.locChanged, "frame made before its location changed", "frames made before their location changed"));
  if(frames.propChanged) issues.push(n(frames.propChanged, "frame made before a prop changed", "frames made before a prop changed"));
  if(needs.length) issues.push("missing: "+needs.slice(0,3).map(x=>x.label).join(", ")+(needs.length>3?" +"+(needs.length-3)+" more":""));
  return { plan, frames, needs, issues, text:issues.join(" \u00b7 ") };
}
window.stageClipReadiness = stageClipReadiness;

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
  ["timeline",   "Time-coded",       "Time-coded windows (0–4s, 4–9s…) scripted from each shot's measured runtime — paces motion across the clip."],
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
  // rate), min 1). Scaled off fal's real per-second pricing at the Option A anchor
  // (2026-09-30: 1 credit = $0.01 of provider cost), so 1s of 720p Standard ≈ 30 credits.
  // metaRes/metaDur render as small badge chips on each dropdown option;
  // capabilities feed the panel's model card, so the card follows the selection.
  { id:"seedance-2.0", label:"Seedance 2.0", status:"active", maxShotsPerClip:3,
    metaRes:"4K", metaDur:"4–15s",
    // researched prompting guidance (fal + community prompt guides, 2026-08) —
    // bestFor rides the dropdown option, promptFormula the menu footer
    bestFor:"Reference-driven shots — @-mention frames, clips & voices (up to 12); strong lip-sync and character consistency.",
    promptFormula:"subject → action → camera move (dolly, orbit, pan, push-in — it knows the vocabulary) → specific lighting → sound. Camera and subject motion in SEPARATE clauses; @-mention assets instead of re-describing them; timeline blocks pace each beat.",
    capabilities:["Video from text, images, video and audio together","Up to 12 assets combined","Up to 4K output (Standard tier)","Start→end frame transitions","Typical clip length 4–15s","Strong motion stability","Character consistency","Native audio","Director controls"],
    tiers:[
      // Rates come from app/pricing.jsx as provider USD/sec converted into base
      // credits/sec. The final visible-denomination cost is computed below.
      { id:"standard", label:"Standard", fast:false, maxRes:"4K", note:"Best quality and motion consistency · resolution up to 4K",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.0","standard")) || { "480p":1.52, "720p":3.04, "1080p":6.82, "4K":15.5 } },
      { id:"fast",     label:"Fast",     fast:true,  maxRes:"720p",  note:"Lower latency and cost for iteration · capped at 720p",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.0","fast")) || { "480p":1.21, "720p":2.42 } },
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
    promptFormula:"reference roles → one dramatic beat → visible behavior (not emotion labels) → timed cuts with carry-over blocking → physical sound and continuity locks.",
    capabilities:["Beat-first 30s clips","Up to 50 multimodal references","Timed shot sequences","Native audio","Strong character consistency","Output up to 1080p"],
    tiers:[
      // fal lists ONE endpoint (no fast tier) at 480p/720p only — rates in
      // app/pricing.jsx are the real fal per-second prices (2026-08-07).
      { id:"standard", label:"Standard", fast:false, maxRes:"1080p", falModel:"bytedance/seedance-2.5/reference-to-video",
        note:"Beat-first clips up to 30s · up to 50 references · resolution up to 1080p",
        creditRate:(window.turnVideoCreditRates&&window.turnVideoCreditRates("seedance-2.5","standard")) || { "480p":2.21, "720p":4.73, "1080p":11.64 } },
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
   duration) flows through here so the Generate button always shows the true price.
   VIDEO REFERENCES (repair 2026-09-30): fal bills a Seedance render's reference-video seconds
   too, at 0.6 of the rate for output AND input — (output + input) × rate × 0.6, exactly as the
   server charges it (billing-pricing.mjs videoCost) and as Extend / Edit already quote. The main
   render used to quote output seconds only (473 shown, 710 charged for 10 s of 720p Seedance 2.5
   with 15 s of reference video). refs = { videoSec, inputMul } (stageVideoInputMul). */
function stageRenderCost(tierObj, resolution, durationSec, refs){
  const rate = Number(tierObj && tierObj.creditRate && tierObj.creditRate[resolution]);
  const r = rate>0 ? rate : 1;
  const s = Math.max(1, Number(durationSec)||5);
  // credits are denominated ×CREDIT_SCALE so plan allowances read generously (800 not
  // 80) — grant AND cost scale together, so real value is unchanged. Round after
  // scaling so lower-cost models/resolutions don't over-round to a whole base credit.
  const scale = Number(window.CREDIT_SCALE)||1;
  // reference seconds in tenths, rounded up — as the server reads them (billing-pricing.mjs tenthsUp)
  const inSec = Math.ceil(Math.max(0, Number(refs && refs.videoSec)||0)*10 - 1e-9)/10;
  const mul = Number(refs && refs.inputMul);
  // a hair of float tolerance, exactly as the server rounds (billing-pricing.mjs creditsFromUsd),
  // so a product that lands a float-hair above a whole number quotes what the charge will be
  if(inSec>0 && mul>0) return Math.max(1, Math.ceil((s+inSec)*r*mul*scale - 1e-9));
  return Math.max(1, Math.ceil(s*r*scale - 1e-9));
}
/* the video-input multiplier the server applies to a model's render with video references
   (app/pricing.jsx videoInputPriceMultiplier = billing-pricing.mjs, every Seedance family); 0 =
   reference video isn't billed (Kling) */
function stageVideoInputMul(modelId){
  const t = (window.TURN_PRICING && window.TURN_PRICING.video && window.TURN_PRICING.video.videoInputPriceMultiplier) || {};
  const v = Number(t[modelId]);
  return v>0 ? v : (/^seedance/.test(String(modelId||"")) ? 0.6 : 0);
}
/* a reference video longer than a clip can't be attached, so an unmeasured one is priced at
   the longest clip (a high quote is safe: the server charges the real length) */
const STAGE_REF_VIDEO_MAX_SEC = 15;
window.stageRenderCost = stageRenderCost;
window.stageVideoInputMul = stageVideoInputMul;
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
const STAGE_PROMPT_SCHEMA = "seedance-director-brief-v8";
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
      const delivery=row&&row.delivery||p&&p.dialogueDelivery;
      const message=stageDeliveryIsText(delivery),remote=stageDeliveryIsRemote(delivery);
      return speaker+(message?" sends the exact message \"" :remote?" delivers the offscreen VO line \"":" says \"")
        +dialogue+"\""+(paren?(" ("+paren+")"):"")
        +(message?" (written content only; no speech or lip-sync)":remote?" (no onscreen body, face or lip-sync)":"")
        +(!message&&aIdx&&i===0?(" ("+(remote?"timing from ":"lip-sync ")+"@Audio"+aIdx+")"):"");
    }).filter(Boolean).join("; ");
  }
  const dialogue = String((p&&p.dialogue) || (sh&&sh.dialogue) || (sh&&sh.lineAudio&&sh.lineAudio.text) || "").trim().replace(/^["“]|["”]$/g,"");
  if(!dialogue) return "";
  const speakerName = (p&&p.speaker&&p.speaker.name) || (sh&&sh.lineAudio&&sh.lineAudio.speaker) || "the speaker";
  const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
  const aIdx = (typeof stageLineAudioIndex==="function") ? stageLineAudioIndex(d, sh.id) : 0;
  const paren = String((p&&p.dialogueParenthetical)||"").trim();
  const message=stageDeliveryIsText(p&&p.dialogueDelivery),remote=stageDeliveryIsRemote(p&&p.dialogueDelivery);
  return speaker+(message?" sends the exact message \"" :remote?" delivers the offscreen VO line \"":" says \"")
    +dialogue+"\""+(paren?(" ("+paren+")"):"")
    +(message?" (written content only; no speech or lip-sync)":remote?" (no onscreen body, face or lip-sync)":"")
    +(!message&&aIdx?(" ("+(remote?"timing from ":"lip-sync ")+"@Audio"+aIdx+")"):"");
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
    const message=stageDeliveryIsText(row&&row.delivery),remote=stageDeliveryIsRemote(row&&row.delivery);
    return speaker+(message?" sends the exact message \"" :remote?" delivers the offscreen VO line \"":" says \"")
      +text+"\""+(message?" (written content only; no speech or lip-sync)":remote?" (no onscreen body, face or lip-sync)":"");
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
  const style = _stageLook(d);
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
    _stageLook(d)&&("Look: "+_stageLook(d)+"."),
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
    _stageLook(d)&&("Look: "+_stageLook(d)+"."),
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
  const style = _stageLook(d);
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
      // an action window with a line in the clip uses the clip clock's capped estimate (stageActionSec)
      const dur = dialogue ? (lead + lineSec + tail) : (lastSpokenIdx>=0 ? stageActionSec(sh) : stageShotRuntime(sh));
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
  const style = _stageLook(d);
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
  const style = _stageLook(d);
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
    return "BLOCKED: this beat's screenplay couldn't be read, so it isn't rendered from older shot text. Reload the app and try again.";
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
    _stageLook(d)&&("Look: "+_stageLook(d)+"."),
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
   if(!(opts&&opts.explicitStyle)){
     if(typeof window.seedanceDirectorBrief!=="function")throw new Error("Stage director brief helper did not load.");
     return window.seedanceDirectorBrief(scoped,shots,activeShot,audioRefsOn,audioIncluded,refs,opts);
   }
   // A named grammar must bypass ALL automatic briefs, including beat-opening.
   // Keep its coverage constraint separately instead of swallowing the style.
   const list=scoped.data.shots||[];
   const beatOpening=list.some(stageBeatOpeningShot);
   const base=(!recipeId||recipeId==="narrative")
     ?seedanceNarrativeParagraph(scoped,activeShot,refs):seedancePrompt(recipeId,scoped,refs);
   const coverage=beatOpening?(list.length===1
     ?"\nCOVERAGE LOCK: one continuous shot; no invented cuts, inserts, montage or later keyframes."
     :"\nCOVERAGE LOCK: use only the listed authored shots; each beat-opening unit remains continuous within its own shot."):"";
   const delivery=beatOpening?list.filter(stageBeatOpeningShot).map(sh=>{
     const src=scoped.data.beatScripts&&scoped.data.beatScripts[sh.beatN];
     const words=_seedanceDialogueClause(sh,{dialogueLines:src&&src.dialogue||[]},scoped.data,refs);
     return words?"EXACT DELIVERY: "+words:"";
   }).filter(Boolean).join("\n"):"";
  // Standing soundtrack rule (user direction): generation audio is the WORLD only —
  // spoken dialogue (when specified above) plus environmental/diegetic SFX and
  // ambience. Music belongs to post; text must never be burned into pixels.
   return base + coverage + (delivery?"\n"+delivery:"") + "\nAUDIO & OVERLAYS: besides any spoken dialogue specified above, the soundtrack is environmental and diegetic sound effects with natural ambience ONLY — NO background music, NO score, NO soundtrack. NO subtitles, captions or any burned-in text overlays anywhere in the frame.";
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
    assets:(includedAssets||[]).filter(a=>a&&a.kind!=="text"),
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
    const speakerName = String(a.speaker||"").trim() || label.replace(/\s+(?:line|voice)(?:\s+·.*)?$/i,"") || "the speaker";
    const speaker = _stagePromptEntityLabel(refs, "speaker", speakerName, speakerName);
    return T+" is "+speaker+"'s authoritative voice-performance reference for this exact line only. "
      +"Match its vocal identity — timbre, vocal age and register, tone, accent or dialect, cadence, pacing, emphasis, breath and delivery — and follow its exact recorded words and timing. "
      +"It controls voice and lip timing only, never visuals, blocking, ambience, music or extra dialogue. Do not revoice, paraphrase, double or add another speaker. Lip-sync only when "+speaker+" is visible; otherwise keep the voice offscreen.";
  }
  if(a.kind==="video") return T+" is the previous clip — continue its ending positions, screen direction, lighting, prop state and motion momentum. Do not replay its action or copy its opening composition.";
  if(a.referenceKind==="screenplay") return T+" is a screenshot of the scene screenplay, page "+a.page+" of "+a.totalPages
    +". Read it as writing context only; perform only the selected beat/shot/part. Never photograph or animate the page, its text, highlighting or borders, and never use it as composition or a character identity reference.";
  if(a.referenceKind==="character") return T+" is "+(label||"the character")+" — identity, wardrobe, body scale and proportions for its assigned shots only; do not inherit its background, pose or lighting. Shot-specific appearance overrides a supporting master reference.";
  if(a.referenceKind==="location") return T+" is "+(label||"the location")+" — preserve geography and materials, not reference framing. Authored lighting changes still occur.";
  if(a.referenceKind==="prop") return T+" is "+(label||"the prop")+" — preserve its design and markings, not reference backdrop, placement or custody; follow authored pickups and handovers.";
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
      "data-placeholder":placeholder||"","data-max-length":maxLen||undefined,
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

function ClipConsole({ clip, selectedShot, sceneClips, ctx, imgs, imageLoadState={}, auds, beatsMap, drafts, prevClipVideoId, aspect, visualSource, creditBalance, readOnly=false, onVoiceLine, onMakeSceneNeeds, takeStale=false, takeIdentity=false, takeOldLook=false, orphanTakes=[], onUpdateShot, onSelectClip, onFirstVideo, onStageNav, modelId, setModelId, clipScope, setClipScope, pendingReuse, onReuseConsumed }){
  const scene = clip.scene, g = clip.g, d = clip.data;
  // the scene's look + film stock when this console renders — stamped on each take it makes, so a later
  // change on the Color tab shows the take as "made with an earlier look" (2026-10-05, owner — Color review)
  const clipLookSig = (typeof shotLookSig==="function") ? shotLookSig(ctx.project, scene.id) : "";
  /* THE LOOK A TAKE REALLY CARRIES (2026-10-08, owner — Color review): an input frame made with an earlier
     look carries that grade into the take, so the take carries that frame's stamp (it was stamped current,
     so "Earlier look" never showed); a hand-edited prompt carries the look it was written against */
  const _earlierOf = (sig)=> !!(sig && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(sig, ctx.project, scene.id));
  /* (2026-10-09, owner — Stage review) only the frames and boards a render SENDS carry their look into
     the take — scanning every shot's frame stamped takes with the look of frames they never used */
  const earlierLookIn = (ids)=>{ const seen = new Set();
    const metaOf = (id)=> (id && typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
    for(const id of (ids||[])){ if(!id || seen.has(id)) continue; seen.add(id);
      const m = metaOf(id); if(!m) continue;
      if(_earlierOf(m.lookSig)) return m.lookSig;
      // a board made from frames carries their look
      for(const sid of (Array.isArray(m.shotIds) ? m.shotIds : [])){ const fm = metaOf(sid); if(fm && _earlierOf(fm.lookSig)) return fm.lookSig; } }
    return ""; };
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
  // what feeds this clip, honestly (stageClipReadiness) — the notice, the Generate question, the needs button
  const readiness = stageClipReadiness(clip, ctx, imgs, drafts, { loading:imageLoadState, sourceMode });
  const [needsRun, setNeedsRun] = React.useState(null);   // {i,total} while making what this clip needs
  const makeableNeeds = (readiness.needs||[]).filter(x=>x.makeable);
  /* (2026-10-09, owner — Breakdown review) "Making…" only once you've said yes (the run reports 0 of N after its
     question); the chip and the title count the images the question will (a variant whose master is missing makes
     both; what the run can't make here isn't counted); the question asks about THIS clip; and a run started
     anywhere else (Shots, the Breakdown, another clip) shows here too — one Make at a time, app-wide */
  const needsImages = (typeof window.turnSceneNeedsImageCount==="function") ? window.turnSceneNeedsImageCount(makeableNeeds)
    : (typeof window.sceneNeedsImageCount==="function") ? window.sceneNeedsImageCount(makeableNeeds) : makeableNeeds.length;
  const [needsApp, setNeedsApp] = React.useState(()=> (typeof window.turnSceneNeedsProgress==="function" ? window.turnSceneNeedsProgress() : null));
  React.useEffect(()=>{
    const h = (e)=> setNeedsApp((e && e.detail) || null);
    window.addEventListener("turn-scene-needs-progress", h);
    return ()=> window.removeEventListener("turn-scene-needs-progress", h);
  },[]);
  const needsShown = needsRun || (needsApp && String(needsApp.sceneId)===String(scene && scene.id) ? needsApp : null);
  const makeClipNeeds = async ()=>{
    if(!onMakeSceneNeeds || needsRun || needsApp || readOnly || !makeableNeeds.length) return;
    try{ await onMakeSceneNeeds(scene, makeableNeeds, (i,total)=>setNeedsRun({ i, total }), { scope:"clip", from:"stage" }); }
    finally{ setNeedsRun(null); }
  };
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
  // the previous clip's REAL length prices the render when it rides as a video reference (fal bills
  // those seconds; the submit probes the same file): its saved take length until the file is measured
  const [prevVideoSecs, setPrevVideoSecs] = React.useState(null);
  React.useEffect(()=>{
    let live = true; setPrevVideoSecs(null);
    if(!prevVideoSafe || typeof window.vidMediaFacts!=="function") return undefined;
    Promise.resolve().then(()=>window.vidMediaFacts(prevVideo,"video"))
      .then(f=>{ const v=Number(f&&f.durationSeconds); if(live && v>0) setPrevVideoSecs(v); }).catch(()=>{});
    return ()=>{ live=false; };
  }, [prevVideo, prevVideoSafe]);
  const prevVideoMetaSecs = (()=>{ const m=prevVideoMeta||{}; const v=Number(m.durationSec)||Number(m.durationMs)/1000; return v>0 ? v : 0; })();
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
  const screenplayImageReference = React.useMemo(()=>{
    if(typeof window.stageScreenplayImages!=="function")
      return {images:[],errors:["Screenplay screenshots are unavailable. Reload Stage before rendering."]};
    return window.stageScreenplayImages(screenplayReference);
  },[screenplayReference.signature]);
  const screenplayImages = screenplayImageReference.images||[];
  const sourceScreenplayIssue = !screenplayReference.hasSource || (screenplayReference.errors||[]).length
    ? (screenplayReference.errors||[])[0] || "Write this scene's screenplay in the Writers' Room before rendering."
    : "";
  const directionIssue=(d.screenplayDirectionIssues||[]).find(x=>x&&x.blocking);
  // Page screenshots are optional reading references. The authored screenplay text
  // remains binding even when the director excludes every page image.
  const screenplayIssue=sourceScreenplayIssue || (directionIssue&&directionIssue.message) || "";
  const scopeInstruction=stageRenderScopeInstruction(clipScope,clip,shownShots,promptShots,d.panelLines||[]);
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
        availableImageIds:new Set(Object.keys(imgs||{})),
        loadingImageIds:new Set(Object.keys(imageLoadState||{}).filter(id=>imageLoadState[id]==="loading")) })
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
  // a real person's likeness in this clip's cast (re-read when a likeness is locked / removed)
  const [, setLikenessTick] = React.useState(0);
  React.useEffect(()=>{ const h = ()=>setLikenessTick(t=>t+1);
    window.addEventListener("turn-cameo-changed", h); return ()=>window.removeEventListener("turn-cameo-changed", h); },[]);
  const clipHasLikeness = stageCastHasLikeness(identityCast, referencePackage.characters);
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
    if(desc&&desc.kind==="character"&&desc.stateId&&w&&w.severity==="error"&&w.code==="loading-reference"){
      const states=(entity&&entity.states)||[];
      const state=states.find(s=>s.id===desc.stateId);
      const version=state?states.indexOf(state)+2:"?";
      const stateLabel=(state&&state.label)||"Unnamed appearance state";
      message="Loading required appearance “"+assetLabel+" · "+stateLabel+" (v"+version+")”. It will attach automatically when the saved sheet finishes loading";
    }else if(desc&&desc.kind==="character"&&desc.stateId&&w&&w.severity==="error"){
      const states=(entity&&entity.states)||[];
      const state=states.find(s=>s.id===desc.stateId);
      const version=state?states.indexOf(state)+2:"?";
      const stateLabel=(state&&state.label)||"Unnamed appearance state";
      message="Required appearance “"+assetLabel+" · "+stateLabel+" (v"+version+")” is unavailable"
        +(state&&state.suggested
          ? " — it was suggested from the script and its sheet has never been generated. "
          : ". ")
        +"Generate or import that state in Art Room → Characters → "+assetLabel+" → Continuity · appearance states, "
        +"or choose “Use master for this shot” beneath the reference tiles to render this video with the existing master image";
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
  const sceneTakeSlots=React.useMemo(()=>stageSceneBeatTakeSlots(
    clipsInScene,drafts,null,clip&&clip.scene&&clip.scene.id),
    [clipIdsKey,stripTick,drafts,clip&&clip.scene&&clip.scene.id]);
  const readySceneTakeCount=sceneTakeSlots.filter(x=>x.rendered).length;

  // ---- the derived INPUT ASSETS (tagged, toggleable), capped to Seedance's 12 ----
  /* DIALOGUE AUDIO MODE (per clip): "locked" = lip-sync to the ElevenLabs line audio
     (refs attached, duration locked to speech + air); "native" = let the model ACT the
     lines itself with no audio refs and free pacing. Beat-level lines can be assigned
     explicitly below when the director wants locked voices and exact Mix placement. */
  const clipHasUnassignedDialogue=Array.isArray(d.clipDialogueLines)&&d.clipDialogueLines.length>0;
  const clipDialogueAssignSig=(d.clipDialogueLines||[]).map((row,i)=>
    stageDialogueAssignmentKey(row,i)+":"+String(row&&row.text||"")).join("|");
  const [dialogueAudio, setDialogueAudio] = React.useState(()=>clipHasUnassignedDialogue?"native":"locked");
  const [dialogueAssignOpen,setDialogueAssignOpen]=React.useState(false);
  const [dialogueAssignments,setDialogueAssignments]=React.useState({});
  const [dialogueAssignError,setDialogueAssignError]=React.useState("");
  // A complete beat may legitimately keep ordered screenplay dialogue at clip
  // level rather than inventing shot ownership. Native performance is the valid
  // transport for that package, so select it when the clip changes instead of
  // greeting the director with a preventable Locked-voice warning.
  React.useEffect(()=>{
    setDialogueAudio(clipHasUnassignedDialogue?"native":"locked");
    setDialogueAssignOpen(false); setDialogueAssignments({}); setDialogueAssignError("");
  },[clip.id,clipHasUnassignedDialogue,clipDialogueAssignSig]);
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
      else out.push({ key:"frame-missing", kind:"image", label:"Shot start frame", ready:false, locked:true,
        id:(d.first||{}).id||activeShot.id });
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
      const audioState=_shotAudioState(sh,auds,ctx.characters||[]);
      // an unvoiced dialogue line is a MISSING ingredient, not an absent one — the
      // package must show it or the user only learns at lip-sync time
      out.push({ key:"a:"+sh.id, kind:"audio", label:speaker+" line",speaker,url:audioState.ready?(u||""):"",
        ready:audioState.ready, audioState:audioState.state, audioIssue:audioState.reason,shotId:sh.id,
        lineAudio:sh.lineAudio||null });
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
        if(u) addSceneAsset({ key:"scene-loc:"+ls.id, kind:"image", group:"Locations", label:(ls.name||"Location")+(ls.role?(" · "+ls.role):"")+" camera view", url:u, ready:true, id:ls.id,
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
      const u=auds[sh.id],audioState=_shotAudioState(sh,auds,ctx.characters||[]); if(!audioState.ready) return;
      const exact=stageShotDialogueLine(scene,ctx.drafts,sh,ctx);
      const speaker=(exact&&exact.speaker) || (sh.lineAudio&&sh.lineAudio.speaker) || "Character";
      addSceneAsset({ key:"a:"+sh.id, kind:"audio", group:"Voices", label:speaker+" voice · "+_firstWords((exact&&exact.text)||sh.dialogue,6),
        speaker,url:u,ready:true,shotId:sh.id,lineAudio:sh.lineAudio||null });
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
        addRequired(r,"location",(l.name||"Location")+" · Camera view"); });
      (referencePackage.props||[]).forEach(r=>{ const p=(ctx.propById||{})[r.entityId]||{};
        addRequired(r,"prop",(p.name||"Prop")+(r.stateId?" · Continuity state":" · Master reference")); });
    }
    // Append required document references without replacing visual references.
    screenplayImages.forEach(p=>out.push({...p,key:p.id,kind:"image",group:"Screenplay",
      referenceKind:"screenplay",assetRole:"screenplay_reference",
      assetRoleLabel:"Screenplay screenshot",assetSourceQuality:"canonical_screenplay_page",
      ready:!!p.url,locked:false}));
    return out;
  }, [clip.id, activeShot.id, sourceMode, dialogueAudio, modelId, referencePackage.signature, screenplayImageReference, shotStartFrame, JSON.stringify((storyAssets.halves||[]).map(h=>h.id+":"+!!h.url)), storyAssets.top, storyAssets.bottom, storyAssets.sheet, prevVideo, prevVideoSafe, JSON.stringify(prevVideoMeta||{}), JSON.stringify(d.cast), JSON.stringify(d.props), d.loc&&d.loc.id, d.locSheet&&d.locSheet.id, JSON.stringify((sceneClips||[]).map(sc=>{ const dd=(sc&&sc.data)||{}; return (sc&&sc.id||"")+"|"+(dd.cast||[]).map(x=>x.id).join(",")+"|"+(dd.props||[]).map(x=>x.id+":"+(x.sheetId||"")).join(",")+"|"+(dd.shots||[]).map(x=>x.id+":"+(x.dialogue||"")).join(",")+"|"+((dd.locSheet&&dd.locSheet.id)||""); })), imgs, auds]);

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
  const [imgRetrying,setImgRetrying] = React.useState(()=>new Set());
  const imgRepairOwner = React.useRef(null);
  React.useEffect(()=>{
    const owner={};
    imgRepairOwner.current=owner;
    imgRepairRef.current.clear();
    setImgRetrying(new Set());
    setImgFail(new Set());
    return ()=>{ if(imgRepairOwner.current===owner)imgRepairOwner.current=null; };
  },[ctx.project]);
  // One transparent asset-id rehydrate repairs an expired signed URL or revoked
  // blob URL. Remember both URLs so a genuinely bad asset cannot retry-loop; a
  // later regenerated URL is different and is eligible for its own recovery.
  const imgRepairRef = React.useRef(new Map());
  const retryImg = (a,manual=false)=>{
    const k=a.key+"|"+(a.url||"");
    if(!a.id || a.referenceKind==="screenplay" || typeof nbRefreshImage!=="function") return;
    const prior=imgRepairRef.current.get(a.id);
    if(prior && (prior.pending || (!manual&&(prior.failedUrl===a.url || prior.replacementUrl===a.url)))) return;
    const owner=imgRepairOwner.current;
    const rec={failedUrl:a.url||"",replacementUrl:"",pending:true};
    imgRepairRef.current.set(a.id,rec);
    setImgRetrying(s=>new Set(s).add(k));
    const owns=()=>imgRepairOwner.current===owner&&imgRepairRef.current.get(a.id)===rec;
    Promise.resolve().then(()=>nbRefreshImage(a.id,a.url)).then(u=>{
      if(!owns())return;
      rec.replacementUrl=u||"";
      if(u){
        setImgFail(s=>{ if(!s.has(k)) return s; const n=new Set(s); n.delete(k); return n; });
        // The local backend does not broadcast refreshes; re-read the exact id
        // through the parent loader in either backend.
        window.dispatchEvent(new CustomEvent("nb-prefetched",{detail:{ids:[a.id],refreshed:true}}));
      }else if(manual&&typeof window.appToast==="function"){
        window.appToast(a.label+" is still unavailable. Check its source image in the Art Room.","info");
      }
    }).catch(()=>{
      if(!owns())return;
      setImgFail(s=>new Set(s).add(k));
      if(manual&&typeof window.appToast==="function")
        window.appToast("Could not reload "+a.label+". Check its source and access in the Art Room, or try again.","error");
    }).finally(()=>{
      rec.pending=false;
      if(owns())setImgRetrying(s=>{const n=new Set(s);n.delete(k);return n;});
    });
  };
  const noteImgFail = (a)=>{
    const k=a.key+"|"+(a.url||"");
    setImgFail(s=>{ if(s.has(k)) return s; const n=new Set(s); n.add(k); return n; });
    retryImg(a);
  };
  const thumbnailState = a=>{
    if(a.kind!=="image")return "";
    if(imgRetrying.has(a.key+"|"+(a.url||"")))return "loading";
    if(imgFailed(a))return "error";
    if(a.url)return "ready";
    return imageLoadState[a.id]||"unavailable";
  };
  const thumbnailLabel = a=>({loading:"Loading…",error:"Load failed",unavailable:"Unavailable"}[thumbnailState(a)]||"");
  const canRetryImg = a=>a.kind==="image"&&!!a.id&&a.referenceKind!=="screenplay"
    &&typeof nbRefreshImage==="function"&&["error","unavailable"].includes(thumbnailState(a));
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
      return {sh,c,master,hasOverride,shotN:i+1,state:state||null,stateLabel:state
        ?(state.label||"Unnamed appearance")+" (v"+((c.states||[]).indexOf(state)+2)+")"
        :"Scene appearance",
        // the required appearance state has no generated sheet → this shot is blocked
        stateMissing:!!(r.stateId&&r.required&&r.status&&r.status.missing),
        masterReady:!!imgs[c.id]&&!!status&&!status.missing&&!status.excluded};
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
  // ONE explicit decision per character for every clip shot still pointing at an
  // appearance state that has no generated sheet: the same persisted, per-shot,
  // revertible video-input override the row buttons write — never automatic, and
  // never a rewrite of the Art Room's appearance canon.
  const characterReferenceMissingRows=characterReferenceChoices.filter(row=>row.stateMissing&&!row.hasOverride);
  // A resolved appearance sheet is already the authoritative character reference
  // for the shot.  Do not present a master-substitution control as if the director
  // still has something to fix.  Rows are useful only while choosing a fallback for
  // a genuinely missing sheet, or while undoing an explicit fallback chosen earlier.
  const characterReferenceActionChoices=characterReferenceChoices.filter(row=>row.stateMissing||row.hasOverride);
  const characterReferenceMissingIds=_uniq(characterReferenceMissingRows.map(row=>row.c.id));
  const characterReferenceBulk=Array.from(characterReferenceMissingRows
    .reduce((m,row)=>{
      const g=m.get(row.c.id)||{c:row.c,state:row.state,stateLabel:row.stateLabel,rows:[],shotNs:[]};
      g.rows.push(row); g.shotNs.push(row.shotN); m.set(row.c.id,g); return m;
    },new Map()).values())
    .filter(g=>g.rows.length>1)
    .map(g=>({...g,shotsLabel:stageShotRangeLabel(g.shotNs),masterReady:g.rows.every(r=>r.masterReady),
      suggested:!!(g.state&&g.state.suggested)}));
  const applyCharacterReferenceBulk=(g)=>{
    if(readOnly||!onUpdateShot||gening||!g.masterReady)return;
    g.rows.forEach(row=>setCharacterReferenceChoice(row));
  };
  const canBulkCharacterReference=!readOnly&&!!onUpdateShot&&!gening;
  const assetState = (a)=> !a.ready ? "missing" : a.locked ? "required" : on(a) ? "included" : "excluded";
  const assetStateLabel = (a)=> assetState(a)==="required" ? "Required" : assetState(a)==="included" ? "Included" : assetState(a)==="excluded" ? "Excluded"
    : (a&&/^stale/.test(String(a.audioState||""))) ? "Stale" : "Missing";
  const assetTitle = (a)=>{
    const st = assetState(a), base = a.label+(a.tag?(" · "+a.tag):"")+(a.id?(" · Asset ID "+a.id):"");
    if(st==="required") return base+" · required for this render";
    if(st==="included") return base+" · included, click to exclude";
    if(st==="excluded") return base+" · excluded, click to include";
    return base+" · "+(a.audioIssue||"missing; generate this source asset first");
  };
  const tagOrder = (a)=>Number((String(a&&a.tag||"").match(/\d+$/)||[9999])[0]);
  const onImages = tagged.filter(a=>a.kind==="image" && on(a)).sort((a,b)=>tagOrder(a)-tagOrder(b));
  const includedScreenplayImages = onImages.filter(a=>a.referenceKind==="screenplay");
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
    const voiced = g.shots.filter(sh=>_shotAudioReady(sh,auds,ctx.characters||[]));
    if(!voiced.length) return "missing";
    const inc = voiced.filter(sh=>!off.has("a:"+sh.id)).length;
    return inc===voiced.length ? "included" : inc===0 ? "excluded" : "mixed";
  };
  // any line on → remove them all; none on → add them all
  const toggleVoice = (g)=> setOff(s=>{
    const n = new Set(s);
    const keys = g.shots.filter(sh=>_shotAudioReady(sh,auds,ctx.characters||[])).map(sh=>"a:"+sh.id);
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
  // The text prompt uses no media slots; each actual screenplay PNG counts.
  const budgetUsed = stageReferenceFileCount(tagged,on);
  const imageLimit = modelId==="seedance-2.5" ? 30 : 9;
  const imageOver = onImages.length>imageLimit;
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
  const directorControls=()=>{
    const rows=[];
    if(cameraProfileLine) rows.push(cameraProfileLine);
    if(camera&&camera!==d.camera) rows.push("Camera movement override: "+camera+".");
    if(lighting&&lighting!==d.lighting) rows.push("Lighting override: "+lighting+".");
    if(perf) rows.push("Acting focus: "+perf+". Prioritize this character's authored objective and beat changes through visible behavior; do not invent extra action.");
    return rows.join("\n");
  };
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
  const [runtimeCaps,setRuntimeCaps]=React.useState({known:false,capabilities:null,reason:"Checking what the video service supports"});
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
  // models+1080p, Studio (shown as "Producer")=4K+batch. Locked options stay visible and clickable — the
  // click opens the plans modal (upsell), never a silent dead button.
  const planGate = (typeof window.turnTierGates==="function") ? window.turnTierGates(creditBalance) : null;
  const planAllowsModel = (id)=> !planGate || (typeof window.turnGateAllowsModel!=="function") || window.turnGateAllowsModel(planGate, id);
  const planAllowsRes = (r)=> !planGate || (typeof window.turnGateAllowsRes!=="function") || window.turnGateAllowsRes(planGate, r);
  const planMaxBatch = planGate ? (planGate.maxBatch||1) : 4;
  const planResNote = (r)=>{ const p = stagePlanForRes(r); return p ? (r+" needs the "+p+" plan") : (r+" is locked on this plan"); };
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
    if(ok){ setModelId(ok.id, { local:true }); const t0=seedanceTierOf(ok, tier); if(t0) setTier(t0.id); }
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
  const lineAudioStates=lineShots.map(sh=>({sh,state:_shotAudioState(sh,auds,ctx.characters||[])}));
  const voicedLineCount = lineAudioStates.filter(x=>x.state.ready).length;
  const firstVoiceIssue=(lineAudioStates.find(x=>!x.state.ready)||{}).state||null;
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
  const measuredSec = _clipMeasuredSec(clip,model.maxClipSec||15,auds,ctx.characters||[]);
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
  // The timed plan's own floor (speech + action time per shot, before any requested
  // duration). AUTO duration must come from the same plan that validates it —
  // otherwise Generate sits behind a "needs N seconds" blocker nobody chose.
  const basePlan = (typeof window.stageBuildTimedPlan==="function")
    ? window.stageBuildTimedPlan(promptShots,{modelId,maxSeconds:model.maxClipSec||15,
        maxShots:model.maxShotsPerClip||Infinity,maxDialogue:10,
        audioMode:voiceLocked?"locked":"native",panelLines:d.panelLines||[],
        scene,drafts,characters:ctx.characters||[],beatsMap})
    : null;
  const planFloorSec = basePlan && Number(basePlan.minimumSec)>0 ? Number(basePlan.minimumSec) : 0;
  const autoDuration = (voiceLocked && measuredSec)
    ? measuredSec
    : (recipe==="multishot"
        ? Math.max(3, Math.min(model.maxClipSec||15, Math.round(msTotal)))
        : d.dur);
  // an explicit pick stands (the plan blocker speaks if it is too short); auto never
  // sits below the plan floor — nor is it clamped to the model ceiling here, so an
  // overlong beat reports "over-duration" instead of quietly compressing
  const autoDurationSec = Math.max(Number(autoDuration)||0, planFloorSec);
  const duration = durationOverride
    ? ((voiceLocked && measuredSec) ? Math.max(measuredSec, durationOverride) : durationOverride)
    : autoDurationSec;
  // the clip's true minimum for every duration picker: measured voice + air, or the
  // plan floor when the coverage's action/speech time asks for more
  const durationFloorSec = Math.max(durationLocked ? Math.ceil(measuredSec) : 0, planFloorSec);
  const durationFloorIsPlan = planFloorSec>0 && planFloorSec>(durationLocked ? measuredSec : 0);
  const durationTitle = durationFloorIsPlan
    ? "Minimum "+_fmtSecs(planFloorSec)+" — this clip's speech and action time; extend for more acting time"
    : durationLocked
      ? "The measured voice + breathing room ("+_fmtSecs(measuredSec)+") is the MINIMUM — extend for more acting time"
      : "Clip duration";
  // shorter picks are not offered rather than offered-then-blocked
  const durationOptions = _uniq([duration, durationFloorSec, measuredSec||0, 4,5,6,8,10,12,15, model.maxClipSec||15])
    .filter(v=> v>0 && v<=(model.maxClipSec||15) && v>=durationFloorSec)
    .sort((a,b)=>a-b);
  const durationOptionNote = (v)=> v===durationFloorSec
    ? (durationFloorIsPlan ? " · clip minimum" : durationLocked ? " · voice + air (min)" : "")
    : "";
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
            maxSeconds:model.maxClipSec||15,audioMode:voiceLocked?"locked":"native",renderPlan})
      : beatSequence
      ? seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs,
          {beatSequence:true,directAudioCap:directAudioLimit,videoRefBase:onVideos.filter(a=>a&&a.url).length,videoRefCap:10,renderPlan})
      : id==="multishot" ? seedanceRecipePrompt("timeline", msClip,
          promptShots.filter(sh=>msShots.some(x=>x&&x.id===sh.id)), promptActiveShot,
          audioRefsOn, audioIncluded, promptRefs)
      : seedanceRecipePrompt(id, clip, promptShots, promptActiveShot, audioRefsOn, audioIncluded, promptRefs);
    // The automatic director brief already maps each included audio reference in
    // ACTIVE REFERENCES and again beside its exact screenplay line. Keep VOICE
    // CAST only for named legacy styles that do not own those sections.
    return (explicit?[voiceCast,base,scopeInstruction]:[base]).filter(Boolean).join("\n\n");
  };
  // Dialogue/lip-sync needs spoken lines to phrase around; every other style always applies
  const promptStyleAvailable = (id)=> id!=="lipsync" || (d.lineShots||[]).length>0;
  const effPromptStyle = (promptStyle!=="auto" && promptStyleAvailable(promptStyle)) ? promptStyle : null;
  // per-shot overrides (vidText / dur) and include toggles recompile the prompt live
  const msSig = msAllShots.map(s=>s.id+":"+(s.vidText||"")+":"+msRuntime(s)+":"+(msOff.has(s.id)?0:1)).join("|");
  // every Shots-tab field the brief prints is a recompile dependency for an untouched box
  const promptProductionSig=JSON.stringify([d.setting,
    d.preset&&[d.preset.name,d.preset.grade,d.preset.lighting], d.lookText||"",   // palette, lens, texture, film stock too
    promptShots.map(sh=>[sh.id,sh.size,sh.angle,sh.move,sh.lens,sh.composition,
      sh.purpose||"",sh.directives||"",sh.action||"",sh.cameraSettings||null])]);
  const renderPlan = (typeof window.stageBuildTimedPlan==="function")
     ? window.stageBuildTimedPlan(promptShots,{modelId,maxSeconds:model.maxClipSec||15,
        maxShots:model.maxShotsPerClip||Infinity,maxDialogue:10,
         audioMode:voiceLocked?"locked":"native",panelLines:d.panelLines||[],durationSec:duration,
         scene,drafts,characters:ctx.characters||[],beatsMap})
    : null;
  const beatPrompt = effPromptStyle ? recipeText(effPromptStyle, true) : recipeText(recipe);
  const [prompt, setPrompt] = React.useState(beatPrompt);
  // MANUAL EDITS survive input toggles: the derivation only overwrites an untouched
  // box, and "Reset to script" rebuilds from the beat + Art Room design on demand.
  // Refs (not state) so the rebuild effect below always reads the CURRENT flag even
  // on the same render pass that switches beats.
  const promptEditedRef = React.useRef(false);
  const promptSourceSig=(renderPlan&&renderPlan.signature||"")+"·"+(referencePackage.signature||"")+"·"+promptRefSig+"·"+screenplayReference.signature+"·"+promptProductionSig;
  const promptDraftKey=(scene&&scene.id||"")+"|"+shownShots.map(s=>s&&s.id).filter(Boolean).join(",");
  /* HAND EDITS SURVIVE (2026-10-08, owner — Color review): the edited prompts are kept per film on this
     device — they lived only in memory, so changing scene, leaving the Stage or a reload recompiled them
     with no word. A kept draft comes back with its sources, so a changed look or script still asks. */
  const _draftsKey = "turn_stage_prompt_drafts:"+stageFilmKey(ctx.project);
  const promptDraftsRef=React.useRef(null);
  if(promptDraftsRef.current===null){ try{ const v = JSON.parse(localStorage.getItem(_draftsKey)||"{}"); promptDraftsRef.current = (v && typeof v==="object") ? v : {}; }catch(e){ promptDraftsRef.current = {}; } }
  /* (2026-10-09, owner — Stage review) the 60 kept are the most recently EDITED (first-inserted ones used to
     survive while the latest edit was dropped), and a draft whose shots no longer exist is pruned */
  const savePromptDrafts = ()=>{ try{
    const all = promptDraftsRef.current||{}, out = {};
    const liveShots = (((window.turnContinuity||{}).shots)||[]);
    const liveIds = new Set(liveShots.map(x=>x && x.id).filter(Boolean));
    const keys = Object.keys(all).filter(k=>{ const x = all[k]; if(!x || typeof x.text!=="string") return false;
        return !liveIds.size || (x.shotIds||[]).every(id=>liveIds.has(id)); })
      .sort((a,b)=>Number((all[b]&&all[b].updatedAt)||0)-Number((all[a]&&all[a].updatedAt)||0)).slice(0,60);
    keys.forEach(k=>{ const x = all[k]; out[k] = { ...x, text:x.text.slice(0,12000) }; });
    localStorage.setItem(_draftsKey, JSON.stringify(out)); }catch(e){} };
  const [promptSourceStamp,setPromptSourceStamp]=React.useState(promptSourceSig);
  // written whenever the box changes (edits, reset and restore all set the prompt)
  React.useEffect(()=>{ const t = setTimeout(savePromptDrafts, 400); return ()=>clearTimeout(t); },[prompt]);
  const [promptLookStamp,setPromptLookStamp]=React.useState(clipLookSig);   // the look a hand-edited prompt was written against
  const [promptDriftConfirmed,setPromptDriftConfirmed]=React.useState("");
  const [promptOtherGrouping,setPromptOtherGrouping]=React.useState(false);   // the kept edit was written for other shots
  const promptSourceDrift=promptEditedRef.current&&!!promptSourceStamp&&promptSourceStamp!==promptSourceSig
    &&promptDriftConfirmed!==promptSourceSig;
  // starts EMPTY so the first pass restores the shown clip's kept draft (2026-10-09: it only came back
  // after leaving the clip and coming back)
  const promptKeyRef = React.useRef("");
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
    setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false); setPromptDriftConfirmed("");
    promptDraftsRef.current[promptDraftKey]={text:t,sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:shownShots.map(s=>s.id),updatedAt:Date.now()};
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
    setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false); setPromptDriftConfirmed("");
    promptDraftsRef.current[promptDraftKey]={text:next,sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:shownShots.map(s=>s.id),updatedAt:Date.now()};
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
  // the viewer is a dialog: Escape closes it and focus moves to Close, then back (2026-10-09)
  const lightboxCloseRef = React.useRef(null);
  React.useEffect(()=>{ if(!maxImg) return undefined;
    const back = document.activeElement;
    try{ lightboxCloseRef.current && lightboxCloseRef.current.focus(); }catch(e){}
    const onKey = (e)=>{ if(e.key==="Escape"){ e.stopPropagation(); setMaxImg(null); } };
    window.addEventListener("keydown", onKey, true);
    return ()=>{ window.removeEventListener("keydown", onKey, true); try{ back && back.focus && back.focus(); }catch(e){} }; }, [!!maxImg]);
  // ---- Reuse/Branch handoff from the VERSIONS tab: apply the take's settings to the
  // composer once, then consume — an explicit pick from the Versions view always wins.
  React.useEffect(()=>{
    if(!pendingReuse || pendingReuse.clipId!==clip.id) return;
    const m = pendingReuse.meta || {};
    // the take's visual source only when this clip can still use it now (2026-10-09 — a take made from halves
    // or a sheet that has since been cleared, gone out of date or left the board fell into a source it can't send)
    const srcAvailable = (src)=> src==="halves" ? !!sourcePlan.hasHalves && !beatOpeningClip
      : src==="sheet" ? !!sourcePlan.hasSheet && !beatOpeningClip
      : src==="frames" ? !beatOpeningClip && ((d.shots||[]).length>=2)
      : true;
    let sourceNote = "";
    if(m.source && STAGE_SOURCE_MODES[m.source]){
      if(srcAvailable(m.source)) setSourceOverride(m.source);
      else { setSourceOverride("auto");
        sourceNote = " Its visual source ("+STAGE_SOURCE_MODES[m.source].pick+") isn\u2019t available for this clip now, so it uses Auto."; }
    }
    if(m.tier) setTier(m.tier);
    const tObj = seedanceTierOf(model, m.tier||tier);
    if(m.resolution && tObj && tObj.creditRate && tObj.creditRate[m.resolution]!=null) setResolution(m.resolution);
    if(m.bitrate) setBitrate(m.bitrate==="high"?"high":"standard");
    // (the take's recipe is deliberately NOT restored — since the tab row went, the
    // prompt assembly is always the smart per-clip derivation; a legacy recipe id
    // would park the composer on a shape the UI can no longer explain.)
    setSeedInput(pendingReuse.pin && m.seed!=null ? String(m.seed) : "");
    if(onReuseConsumed) onReuseConsumed();
    if(typeof window.appToast==="function") window.appToast((pendingReuse.pin
      ? "Settings + seed loaded — Generate now renders a controlled variation of that take."
      : "That take's settings are loaded into the composer.")+sourceNote,"ok");
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
      let otherGrouping=false;
      if(!saved){
        // a draft for EXACTLY these shots first; else the most recent draft sharing the most of them —
        // kept (a clip-scope or model change keeps your edit), but marked as written for other shots
        // so Generate asks you to review it (2026-10-09, owner — Stage review)
        const ids=shownShots.map(s=>s.id), key=ids.slice().sort().join(",");
        const all=Object.values(promptDraftsRef.current).filter(x=>x && typeof x.text==="string");
        saved=all.find(x=>(x.shotIds||[]).length===ids.length && (x.shotIds||[]).slice().sort().join(",")===key);
        if(!saved){
          const share=(x)=>(x.shotIds||[]).filter(id=>ids.indexOf(id)>=0).length;
          saved=all.filter(x=>share(x)>0).sort((a,b)=>share(b)-share(a) || Number(b.updatedAt||0)-Number(a.updatedAt||0))[0];
          otherGrouping=!!saved;
        }
      }
      promptEditedRef.current=!!saved;
      setPromptOtherGrouping(otherGrouping);
      if(saved){ setPrompt(saved.text); setPromptSourceStamp(saved.sourceSig||""); setPromptLookStamp(saved.lookSig||""); setPromptDriftConfirmed(""); }
    }
    if(!promptEditedRef.current) setPrompt(effPromptStyle ? recipeText(effPromptStyle, true) : recipeText(recipe));
    setPerf(dialogueSpeakers[0] || d.lead);
    // modelId is a real dependency: an explicit style's shot SCOPE follows the model
    // (timed beat/part under either model), so a 2.0↔2.5 switch must recompile
    // an untouched box — otherwise the render ships the wrong scope under the right label
   }, [clip.id, activeShot.id, recipe, effPromptStyle, modelId, duration, dialogueSpeakers.join("|"), d.lead, audioRefsOn, audioIncluded.join("|"), promptRefSig, msSig, screenplayReference.signature, scopeInstruction, promptProductionSig]);
  // a lighting override you set stays when only the look's lighting changes (2026-10-08 — it was reset);
  // a new clip or shot starts from its own lighting
  const lightingFromRef = React.useRef({ key:"", from:d.lighting });
  React.useEffect(()=>{ setCamera(d.camera); setCameraProfile(d.cameraProfile || "auto");
    const key = clip.id+"|"+activeShot.id, prev = lightingFromRef.current;
    setLighting(cur=> (prev.key===key && cur!==prev.from) ? cur : d.lighting);
    lightingFromRef.current = { key, from:d.lighting }; },
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
  const MODES = [["t2v","Text to Video"],["i2v","Image to Video"],["v2v","Video to Video"],["multimodal","All references"]];

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
  const endFrameAvailable = !includedScreenplayImages.length && !beatOpeningClip && !hasDialogue && onVideos.length===0 && endFrameCandidates.length>0 && modelRefs;   // transition endpoints cannot carry document references
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
  const clipIdRef = React.useRef(clip.id); clipIdRef.current = clip.id;
  // scene/project navigation unmounts this console while a handler may still be
  // awaiting asset preparation — the paid submission must not follow from a closed clip
  const consoleOpenRef = React.useRef(true);
  React.useEffect(()=>{ consoleOpenRef.current=true; return ()=>{ consoleOpenRef.current=false; }; }, []);
  const readOnlyRef = React.useRef(readOnly); readOnlyRef.current = readOnly;
  // the shots a take was made from — every render path stamps them, so a new take is checkable (2026-10-09:
  // Extend, Edit and Motion Control takes recorded none and dropped out of the film as "can't be checked")
  const clipShotSources = ()=> (typeof shotSourceStamp==="function")
    ? (d.shots||[]).map(sh=>shotSourceStamp(sh,(drafts||{})[sh.sceneId])) : [];
  /* a render still running on the server for this clip (its recovery record), shown as such — a stopped
     wait or a timeout used to look finished, inviting a second paid render (2026-10-09) */
  const pendingOnServer = ()=>{ try{
      const list = (typeof window.vidPendingList==="function") ? (window.vidPendingList()||[]) : [];
      const pid = (typeof window.nbCloudScope==="function" && window.nbCloudScope()) ? (window.nbCloudScope().projectId||null) : null;
      return list.filter(j=>j && j.id===beatVideoId && (j.projectId||null)===pid).length;
    }catch(e){ return 0; } };
  const [pendingTick, setPendingTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setPendingTick(t=>t+1);
    window.addEventListener("vid-done", h); window.addEventListener("vid-job", h);
    const iv = setInterval(h, 30000);
    return ()=>{ window.removeEventListener("vid-done", h); window.removeEventListener("vid-job", h); clearInterval(iv); }; }, []);
  const pendingN = pendingOnServer();
  const adoptOrphans = async ()=>{
    if(readOnly || !orphanTakes.length || typeof window.vidMergeTakes!=="function") return;
    const n = orphanTakes.reduce((t,o)=>t+(o.takes||0),0);
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Bring "+n+" earlier take"+(n!==1?"s":"")+" into this clip?",
        body:"They were made when this clip held a different set of shots, so they show as \u201cShots changed\u201d in Takes. They join this clip's takes; your current take stays current.",
        confirmLabel:"Bring them in", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    for(const o of orphanTakes){ try{ await window.vidMergeTakes(beatVideoId, o.id); }catch(e){} }
    if(typeof window.appToast==="function") window.appToast(n+" earlier take"+(n!==1?"s":"")+" added to this clip's takes.","ok");
  };
  const onGenerate = async (attemptOptions)=>{
    // view-only roles can't render (Edit / Extend / Motion already said so — 2026-10-05)
    if(readOnly){ if(typeof window.appToast==="function") window.appToast("View-only access \u2014 rendering requires edit access.","info"); return; }
    const referenceFree=!!(attemptOptions&&attemptOptions.referenceFree);
    // the quote this job carries: with references, their seconds are part of it; text only, none
    const quoteCost = referenceFree ? textOnlyCost : renderCost;
    try{
      assertScreenplayCurrent();
      if(promptSourceDrift) throw new Error("Review this edited prompt against the updated scene screenplay before rendering.");
    }catch(e){ if(typeof window.appToast==="function") window.appToast(e.message,"error"); return; }
    // a frame still LOADING is not a missing frame (2026-10-09): wait for it rather than render without it
    if(!referenceFree && readiness.frames.loading){
      if(typeof window.appToast==="function") window.appToast("This clip's frames are still loading \u2014 try again in a moment.","info");
      return;
    }
    // A RENDER OF THIS CLIP IS STILL RUNNING on the server (a stopped wait, a timeout): ask before another
    if(!gen.gening && pendingOnServer()>0 && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({
        title:"Render this clip again?",
        body:"A render of this clip is still running on the server. It's saved to this clip's takes when it finishes and is charged only if it finishes \u2014 a new render is charged too.",
        confirmLabel:"Render again", cancelLabel:"Wait for it" });
      if(!ok) return;
    }
    // INPUTS THAT AREN'T READY ASK FIRST (2026-10-05, owner — Stage review): a frame that isn't
    // approved, is out of date or was made with an earlier look, or a missing reference image, used
    // to feed the render with no word. A frame-less clip renders from the prompt (said too).
    if(!referenceFree && readiness.issues.length && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({
        title:"Render with these inputs?",
        body:"This clip's inputs aren't all ready: "+readiness.text+". The render uses them as they are"
          +(readiness.frames.missing ? " (a shot without a frame is rendered from the prompt only)" : "")
          +" \u2014 or fix them first in the Art Room.",
        confirmLabel:"Render anyway", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    // SEVERAL TAKES ASK FIRST (2026-10-05, owner — Stage review): one click used to start up to four
    // paid jobs. A single take still starts at once (its price is on the button).
    if(Math.max(1, batchN)>1 && typeof window.appConfirm==="function"){
      const n = Math.max(1, batchN), each = Number(quoteCost)||0;
      const ok = await window.appConfirm({
        title:"Render "+n+" takes of this clip?",
        body:n+" separate renders start together, each with its own seed"+(each ? " \u2014 about "+(each*n)+" credits in all ("+each+" each; the charge follows the actual cost, so it can come out a little higher, never above what is held)." : ".")+" Any take that fails is not charged.",
        confirmLabel:"Render "+n+" takes", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    /* TAKES PAST 20 ASK FIRST (2026-10-09, owner — Stage review): a clip keeps its newest 20 takes that
       aren't approved, and older ones rolled off for good with no word */
    { const n = Math.max(1, batchN);
      const loose = (visibleTakes||[]).filter(t=>!(t&&t.meta&&t.meta.status==="approved"));
      const over = loose.length + n - 20;
      if(over>0 && typeof window.appConfirm==="function"){
        const oldest = loose.slice().sort((a,b)=>Number((a.meta&&a.meta.createdAt)||a.savedAt||0)-Number((b.meta&&b.meta.createdAt)||b.savedAt||0)).slice(0,over);
        const names = oldest.map(t=>(t.meta&&t.meta.vno) ? ("v"+t.meta.vno) : "").filter(Boolean);
        const ok = await window.appConfirm({
          title:"Remove the oldest take"+(over!==1?"s":"")+"?",
          body:"A clip keeps its newest 20 takes that aren't approved. This render removes the oldest "+(over===1?"one":over)
            +(names.length?" ("+names.join(", ")+")":"")+" for good \u2014 approve a take in Takes to keep it.",
          confirmLabel:"Render", cancelLabel:"Cancel" });
        if(!ok) return;
      } }
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
       if(typeof window.appToast==="function") window.appToast(resolution+" isn't available yet (it's waiting on a server update). Choose a resolution such as 720p.","error");
       return;
     }
     if(referenceBlockingWarnings.length && !referenceFree){
       if(typeof window.appToast==="function") window.appToast(referenceBlockMessage,"error");
       return;
     }
    stagingCancelRef.current=false;
    setStaging(true);
    setPrepPct(8);
    // (the server charges the account whose session SUBMITS the job — no browser-side
    // spend record to pin any more, 2026-09-30)
    const clipId0 = clip.id;
    try{
    // the start frame leads ONLY when its asset chip is included — an excluded start
    // frame means a promptless-anchor render (prompt + remaining references only),
    // never a silent fallback to some other included image
    const attemptImages=referenceFree ? [] : onImages;
    const attemptVideos=referenceFree ? [] : onVideos;
    const attemptAudios=referenceFree ? [] : onAudios;
    const attemptPromptRefAssets=referenceFree ? [] : directPromptRefAssets;
    const frameAsset = referenceFree ? null : (onImages.find(a=>a.referenceKind!=="screenplay"&&a.url===startFrame) || null);
    const frameUrl = frameAsset ? await stageServerAssetUrl(frameAsset, startFrame || frameAsset.url || "") : "";
    setPrepPct(22);
    const imageEntries = [];
    for(const a of attemptImages){ if(a===frameAsset) continue; const u=await stageServerAssetUrl(a);
      if(!u&&a.referenceKind==="screenplay") throw new Error("An included screenplay screenshot could not be attached.");
      if(u) imageEntries.push({ asset:a, url:u }); }
    const imageUrls = imageEntries.map(e=>e.url);
    setPrepPct(38);
    // a take's link is re-signed right before the submit, as Extend / Edit / Motion do (2026-10-09): an
    // expired link couldn't be read or copied, so the server held the longest length or refused
    const videoUrls = [];
    for(const a of attemptVideos){ if(!a || !a.url) continue;
      const u = await stageFreshVideoRef({ kind:"take", url:a.url }); if(u) videoUrls.push(u); }
    let audioUrls = (!referenceFree&&voiceLocked) ? attemptAudios.map(a=>a.url).filter(Boolean) : [];
    const voiceRefLines = [];
    if(audioUrls.length>directAudioLimit) throw new Error("Every screenplay line must attach before rendering. This request has "
      +audioUrls.length+" audio references; this model accepts "+directAudioLimit+". Use Split to fit to split at shot boundaries.");
    setPrepPct(55);
    const controls = directorControls();
    const blockingPlanIssues=(renderPlan&&renderPlan.issues||[]).filter(x=>x&&x.blocking);
    if(blockingPlanIssues.length){
      if(typeof window.appToast==="function") window.appToast(blockingPlanIssues[0].message||"This screenplay coverage is blocked until its render plan is reconciled.","error");
      return;
    }
    if(clip.g&&clip.g.over&&(!renderPlan||renderPlan.over)){ if(typeof window.appToast==="function") window.appToast("This clip's current render plan needs "+_fmtSecs((renderPlan&&renderPlan.durationSec)||clip.g.dur)+" — over "+_fmtSecs(model.maxClipSec||15)+". Keep the screenplay beat intact; choose a longer model or deliberately revise/revoice it. The app will not silently compress a paid request.","error"); return; }
    if(assetOver&&!referenceFree){ if(typeof window.appToast==="function") window.appToast((model.label||"This model")+" accepts up to "+assetLimit+" inputs — exclude a few assets first.","error"); return; }
    if(imageOver) throw new Error("This render has "+onImages.length+" images including its screenplay pages, over the model's "+imageLimit+" image limit. No references were omitted.");
    if(sourceBlocking&&!referenceFree){ if(typeof window.appToast==="function") window.appToast("Save this clip's storyboard "+(sourceMode==="sheet"?"sheet":"halves")+" in Storyboards first, or switch Visual source back to shot/prompt rendering.","error"); return; }
    if(needsVoice&&!referenceFree){ if(typeof window.appToast==="function") window.appToast("Voice this clip's dialogue first — duration and lip-sync are locked to line audio.","error"); return; }
	    if(creditInfo.empty){ if(typeof window.appToast==="function") window.appToast(stageCreditPanelText(creditInfo) || "Not enough generation credits for this render.","error"); return; }
	    const hadTakeBefore = !!((typeof vidGetTakes==="function" && vidGetTakes(beatVideoId).length) || playerUrl || gen.videoUrl);
	    const seedVal = seedInput.trim() ? Number(seedInput.trim()) : undefined;
      // a real likeness in the cast: the "fictional context" note is untrue for it and is never sent
      const assembledPrompt=stageAssembleRenderPrompt(clipHasLikeness ? stageStripFictionalContext(prompt) : prompt,{
        scopeInstruction,identityPrompt,referenceBlock:refBlock,
        voiceReferenceLines:voiceRefLines,edited:promptEditedRef.current,
        referenceFree
      });
      const promptPayload = referenceFree
        ? stageTextOnlyPrompt(assembledPrompt, promptRefAssets)
        : assembledPrompt;
	    const takeReferences = attemptPromptRefAssets.map(a=>({
	      key:a.key||"",
	      tag:stageAssetMention(a),
	      kind:a.kind,
	      label:a.label||stageAssetMention(a),
	      role:stageAssetRole(a, promptRefs),
	      voiceId:a.lineAudio&&a.lineAudio.voiceId||"",
	      voiceName:a.lineAudio&&a.lineAudio.voiceName||"",
	      voiceRevision:a.lineAudio&&a.lineAudio.voiceRevision||"",
	      voiceSignature:a.lineAudio&&a.lineAudio.voiceSignature||"",
	      voiceModel:a.lineAudio&&a.lineAudio.modelId||"",
	      voiceProvider:a.lineAudio&&a.lineAudio.provider||"",
	      voiceRenderHash:a.lineAudio&&a.lineAudio.hash||"",
	      assetRole:a.assetRole || ((typeof nbInferAssetRole==="function") ? nbInferAssetRole({ id:a.id, kind:a.kind==="video"?"video":"asset" }) : ""),
	      assetRoleLabel:a.assetRoleLabel || ((typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel(a.assetRole || ((a.kind==="video") ? "final_take" : "")) : ""),
	      assetRolePriority:a.assetRolePriority || ((typeof nbAssetRolePriority==="function") ? nbAssetRolePriority(a.assetRole || ((a.kind==="video") ? "final_take" : "")) : 0),
	      assetSourceQuality:a.assetSourceQuality || "",
          sourceSignature:a.sourceSignature||"",page:a.page||null,totalPages:a.totalPages||null,
          targetBeats:a.targetBeats||[],
	      url:(a.kind==="text"||a.kind==="audio") ? "" : (a.url||"")
	    })).concat(voiceRefLines.map((l,i)=>({
	      tag:"@Video"+(videoUrls.length-voiceRefLines.length+i+1),
	      kind:"video",
	      label:"Voice track",
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
      // each row carries its own setup too (2026-10-05, owner — Shots review): the shot's size · angle ·
      // move · lens and composition from the Shots tab used to be dropped from native multi-shot rows
      const camLine = [String(p.camera||"").trim(), String(p.composition||"").trim().replace(/[.\s]+$/,"")].filter(Boolean).join("; ");
      const withCam = text && camLine && !_normStageText(text).includes(_normStageText(camLine)) ? (text.replace(/[.\s]+$/,"")+". Camera: "+camLine+".") : text;
       return { prompt:withCam+((dlg && !dup)?(" — "+dlg):""), duration:Math.max(1, Math.round(msRuntime(sh))) };
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
      /* WHAT THE TAKE RECORDS IS WHAT WAS SENT (2026-10-09, owner — Stage review): references you excluded
         or that weren't ready used to be recorded (false "References need review" later), and a
         start→end transition sends only its two frames. Frames, boards, the end frame and scene
         extras now record their version too (frameVersions), so re-rendering one flags the take. */
      const transition = !referenceFree && !!(frameUrl && endFrameUrl);
      const idOfUrl = (u)=> u ? (Object.keys(imgs||{}).find(k=>imgs[k]===u) || "") : "";
      const endFrameId = transition ? idOfUrl(endFrameUrl) : "";
      const sentImageIds = referenceFree ? [] : (transition
        ? [frameAsset && frameAsset.id, endFrameId]
        : onImages.filter(a=>a && a.referenceKind!=="screenplay" && a.url).map(a=>a.id)).filter(Boolean);
      const sentSet = new Set(sentImageIds);
      const packageSourceVersions=[].concat(referencePackage.characters||[],referencePackage.locations||[],referencePackage.props||[])
        .filter(r=>r && r.assetId)
        .map(r=>({assetId:r.assetId,entityId:r.entityId,kind:r.kind,stateId:r.stateId||"",
          snapshot:r.snapshot,shotIds:r.shotIds,usages:r.usages}));
      const resolvedSourceVersions=packageSourceVersions.filter(r=>sentSet.has(r.assetId));
      const resolvedIds = new Set(resolvedSourceVersions.map(r=>r.assetId));
      const frameVersions = sentImageIds.filter(id=>!resolvedIds.has(id)).map(id=>{
        const m = (typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
        return { id, iso:(m&&m.iso)||"", version:(m&&m.version!=null) ? Number(m.version) : null };
      });
      // the prop sheets this render attached, per shot — the take's prop stamp records them
      const attachedProps = {};
      (referencePackage.props||[]).forEach(r=>{ if(!r || !r.assetId || !sentSet.has(r.assetId)) return;
        (r.shotIds||[]).forEach(sid=>{ (attachedProps[sid] = attachedProps[sid] || {})[String(r.entityId||r.baseId||"")] = String(r.assetId); }); });
      const takeLookSig = (!referenceFree && earlierLookIn(sentImageIds)) || ((promptEditedRef.current && promptLookStamp) ? promptLookStamp : clipLookSig);
      const attemptRenderPlan=referenceFree&&typeof window.stageBuildTimedPlan==="function"
        ? window.stageBuildTimedPlan(promptShots,{modelId,maxSeconds:model.maxClipSec||15,
            maxShots:model.maxShotsPerClip||Infinity,maxDialogue:10,audioMode:"native",
             panelLines:d.panelLines||[],durationSec:duration,scene,drafts,
             characters:ctx.characters||[],beatsMap})
        : renderPlan;
	      const payload = { frameUrl, imageUrls, videoUrls, audioUrls, prompt:promptPayload, controls, multiShot,
       screenplayReference,
       screenplayImages:referenceFree||!includedScreenplayImages.length?undefined:includedScreenplayImages,
       screenplayImagesRequired:false, assertScreenplayCurrent,
      // the QUOTE (the cost the Generate button showed) rides the job — display/audit only:
      // image-proxy holds the real charge at submit and settles it at completion (2026-09-30)
      quote:{ cost:quoteCost, reason:"stage-video-render" },
      durationMs:duration*1000, aspectRatio:effAspect||"auto", fast:!!tierObj.fast, resolution,
      seed:seedVal, generateAudio: hasDialogue ? true : nativeAudio,   // audio track must stay ON for the lip-synced line to be heard
      bitrateMode:bitrate,
       identityCharacterIds:identityIds, identityCast, identityContext,
      falModel: tierObj.falModel || undefined,   // non-Seedance engines (Sora 2) name their fal endpoint per tier
      textOnly:referenceFree,
      // facts the Versions view shows per take — stamped into the take's meta at commit
	      takeMeta:{ lookSig:takeLookSig, frameVersions,
	        // where this render's lines were placed and which recording each was (the Mix lays them there)
	        linePlacements:clipLinePlacements(clip, auds, ctx.characters||[]).map(pl=>{ const sh=(d.shots||[]).find(x=>x&&x.id===pl.shotId)||{};
	          return { shotId:pl.shotId, at:pl.at, sec:pl.sec, hash:String((sh.lineAudio||{}).hash||"") }; }),
	        source:referenceFree?"text-only":sourceMode, tier:tierObj.id, tierLabel:tierObj.label, resolution, bitrate, recipe:effPromptStyle || recipe,
	        assetRole:"final_take", assetRoleLabel:(typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel("final_take") : "Final take",
	        cameraProfile:cameraProfile, cameraProfileLabel:(cameraProfile!=="auto" ? ((stageCameraProfiles.find(x=>x.id===cameraProfile)||{}).label||cameraProfile) : ""),
	        audio: hasDialogue ? ((referenceFree||!voiceLocked||!audioUrls.length) ? "native"
	          : (audioUrls.length===lineShots.length ? "voice" : "mixed")) : (nativeAudio ? "native" : "silent"),
	        inputs: referenceFree ? "1 text · 0 img · 0 vid · 0 aud"
            : (counts.text+" text · "+counts.images+" img · "+counts.videos+" vid · "+counts.audio+" aud"),
	        durationSec: duration, references: takeReferences, shotSources,
	        voiceReferences:attemptAudios.filter(a=>a&&a.url&&a.lineAudio).map(a=>({
	          shotId:a.shotId||"",speakerId:a.lineAudio.speakerId||"",speaker:a.lineAudio.speaker||a.speaker||"",
	          voiceId:a.lineAudio.voiceId||"",voiceName:a.lineAudio.voiceName||"",
	          masterAssetId:a.lineAudio.voiceMasterAssetId||"",masterFileName:a.lineAudio.voiceMasterFileName||"",
	          revision:a.lineAudio.voiceRevision||"",fingerprint:a.lineAudio.voiceSignature||"",
	          modelId:a.lineAudio.modelId||"",provider:a.lineAudio.provider||"",backend:a.lineAudio.backend||"",
	          renderHash:a.lineAudio.hash||"",renderedAt:a.lineAudio.renderedAt||"",text:a.lineAudio.text||""
	        })),
          renderPlan:attemptRenderPlan,
            beatSources, screenplayReference,
            screenplayImages:referenceFree?[]:includedScreenplayImages,
          referenceSourceVersions:referenceFree?[]:resolvedSourceVersions,
          omittedReferenceSourceVersions:referenceFree?packageSourceVersions:[],
          referenceSignature:referenceFree?"":(referencePackage.signature||""),
          referenceRecovery:referenceFree?"provider-media-policy-text-only":"",
          identityCharacterIds:identityIds,
          identitySnapshots:identityCast.map(c=>typeof window.nbIdentitySnapshot==="function" ? window.nbIdentitySnapshot(c) : null).filter(Boolean),
	        propDependencies:(typeof stageClipPropDependenciesV2==="function")
	          ? stageClipPropDependenciesV2(d,scene&&scene.id,window.turnContinuity||{},referenceFree?{}:attachedProps) : "" },
      // start→end transitions render on the dedicated i2v endpoint, which needs BOTH
      // frames — with the start frame excluded, the end frame quietly stands down
      endImageUrl: (!referenceFree&&frameUrl ? endFrameUrl : "") || undefined, force:true };
    // cancelled while staging? Bail BEFORE submission — nothing was spent yet.
    if(stagingCancelRef.current){ if(typeof window.appToast==="function") window.appToast("Render cancelled.","info"); return; }
    try{
      setPrepPct(70);
      setStaging(false);
      // batch: N parallel jobs with distinct seeds, every completion lands as a take
      const runPayload = (p)=>{ assertSameClip(clipId0);   // rights and clip again, after the reprice question too
        return batchN>1 && typeof gen.generateBatch==="function"
          ? gen.generateBatch(p, batchN)
          : gen.generate(p).then(r=>[r]); };
      // Final fail-closed guard immediately before the paid submission. A normal
      // render never changes references after moderation or drops screenplay pages.
      if(referenceBlockingWarnings.length&&!referenceFree) throw new Error(referenceBlockMessage);
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-before-submit");
      assertStageIdentityAssets();
      assertScreenplayCurrent();
      assertSameClip(clipId0);
      // a reference whose length the server can't read: ask before rendering at the longest length
      const results = await stageWithLengthReprice(runPayload, payload, batchN);
      const fresh = results.filter(r=>r && !r.cached);
      const lastWithSeed = results.filter(r=>r && r.seed!=null).slice(-1)[0];
      if(lastWithSeed) setLastSeed(lastWithSeed.seed);
      // the server settled each take's hold at COMPLETION (refunding failed takes);
      // here we only nudge the credits display
      try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:"stage-video-render", cost:renderCost*Math.max(1,fresh.length) } })); }catch(_e){}
      /* WHAT LANDED, SAID HONESTLY (2026-10-09, owner — Stage review): takes held for another film and
         discarded ones were counted as rendered */
      const landed = results.filter(r=>r && !r.stale && !r.discarded);
      const heldElsewhere = results.filter(r=>r && r.stale).length;
      const kept = landed.filter(r=>r.keptCurrent);
      if(!hadTakeBefore && landed.length && onFirstVideo) setTimeout(()=>onFirstVideo(), 0);
      if(kept.length){ const k=kept[kept.length-1]; if(k && k.videoUrl) setActiveTakeUrl(k.videoUrl); }
      if(typeof window.appToast==="function"){
        if(landed.length) window.appToast("Clip "+beatLabel+" \u2014 "+landed.length+" take"+(landed.length!==1?"s":"")+" rendered"
          +(kept.length ? " \u00b7 your approved take stays on the timeline (choose the new one in Takes to use it)" : ""),"ok");
        if(heldElsewhere) window.appToast(heldElsewhere+" take"+(heldElsewhere!==1?"s":"")+" finished after you switched films \u2014 "+(heldElsewhere!==1?"they land":"it lands")+" in this clip's takes when you reopen that film.","info");
      }
    // Inner catch: a submitted provider job failed. The hook retains its
    // structured failure for the inline recovery UI; the toast is immediate.
    // a render still running on the server (a stopped wait, a timeout) is news, not a failure (2026-10-09)
    }catch(e){ if(typeof window.appToast==="function") window.appToast(stageFriendlyVideoError(e)||"Video render failed.",(e&&(e.repriceDeclined||e.stillPending))?"info":"error"); }
    // Outer catch: asset preparation or payload assembly failed before submit.
    }catch(e){ if(typeof window.appToast==="function") window.appToast(stageFriendlyVideoError(e)||"Video render failed.","error"); }
    finally{ setStaging(false); setPrepPct(0); }
  };
  // ---- composer TABS: Create Video | Edit Video | Motion Control -------------
  // Create is the full beat render composer (References) or a Seedance 2.5
  // extension of an existing take (Extend Video); Edit rewrites a video through
  // Seedance 2.5's editing task; Motion Control drives a character image with a
  // motion video through Kling 3.0. Every per-tab pick resets with the clip.
  const [composerTab, setComposerTab] = React.useState("create");
  const [createTask, setCreateTask] = React.useState("reference");   // "reference" | "extension"
  // media picks: { kind:"take"|"asset"|"device", url, ref, label, seconds?, name? }
  // — url is what the UI previews (a take/asset URL or a local blob URL); ref is
  // what the render submits (the same URL, or a `stage:` reference for a device
  // upload that was staged straight into private storage — its bytes never ride
  // the proxy body and are never retained on the take).
  const [extendVideo, setExtendVideo] = React.useState(null);
  const [editVideo, setEditVideo] = React.useState(null);
  const [editPrompt, setEditPrompt] = React.useState("");
  const [motionVideo, setMotionVideo] = React.useState(null);
  const [motionImage, setMotionImage] = React.useState(null);
  const [motionTier, setMotionTier] = React.useState("standard");   // Kling 3.0 Motion Control standard | pro
  const [sceneControl, setSceneControl] = React.useState(true);
  const [motionOrientation, setMotionOrientation] = React.useState("image");   // character_orientation when scene control is on
  const [keepOriginalSound, setKeepOriginalSound] = React.useState(true);
  const [motionPrompt, setMotionPrompt] = React.useState("");
  const [motionAdvanced, setMotionAdvanced] = React.useState(false);
  const [motionHelp, setMotionHelp] = React.useState(false);
  const [mediaBusy, setMediaBusy] = React.useState("");   // which picker is staging a device file
  const [modeErr, setModeErr] = React.useState("");       // last Edit/Motion/Extend failure (shown under the composer)
  React.useEffect(()=>{
    setCreateTask("reference"); setExtendVideo(null); setEditVideo(null); setEditPrompt("");
    setMotionVideo(null); setMotionImage(null); setMotionPrompt(""); setModeErr("");
  }, [clip.id]);
  // the active orientation the request will carry: scene control OFF follows the
  // motion video's own scene (Kling's "video" orientation — up to 30s of motion)
  const effMotionOrientation = sceneControl ? motionOrientation : "video";
  const motionLimits = (typeof window.vidMotionControlLimits==="function")
    ? window.vidMotionControlLimits(effMotionOrientation) : { minSeconds:3, maxSeconds: effMotionOrientation==="image" ? 10 : 30 };
  const motionFalModel = motionTier==="pro" ? (window.VID_KLING_MOTION_PRO||"fal-ai/kling-video/v3/pro/motion-control")
    : (window.VID_KLING_MOTION_STD||"fal-ai/kling-video/v3/standard/motion-control");
  // per-mode capability handshakes (non-spending). An older deployed proxy has no
  // task modes, no motion-control endpoints and no direct-to-storage staging: the
  // tabs then say so and never submit.
  const [modeCaps, setModeCaps] = React.useState({ tasks:null, motion:null, motionModel:"" });
  const proxyReadyFlag = (typeof videoProxyReady==="function" && videoProxyReady()) ? 1 : 0;
  // an unknown answer is re-asked whenever the user opens a mode that needs it (a
  // transient failure at mount must not pin the tab to "pending" for the session);
  // a known answer is kept
  React.useEffect(()=>{
    if(typeof window.seedanceGetRuntimeCapabilities!=="function") return;
    if(modeCaps.tasks && modeCaps.tasks.known) return;
    let alive=true;
    const sd=window.VID25_MODEL||"bytedance/seedance-2.5/reference-to-video";
    Promise.resolve().then(()=>window.seedanceGetRuntimeCapabilities(sd))
      .then(a=>{ if(alive) setModeCaps(m=>({ ...m, tasks:a||{known:false} })); })
      .catch(()=>{ if(alive) setModeCaps(m=>({ ...m, tasks:{known:false} })); });
    return ()=>{ alive=false; };
  }, [proxyReadyFlag, composerTab, createTask]);
  React.useEffect(()=>{
    if(typeof window.seedanceGetRuntimeCapabilities!=="function") return;
    if(modeCaps.motion && modeCaps.motion.known && modeCaps.motionModel===motionFalModel) return;
    let alive=true;
    Promise.resolve().then(()=>window.seedanceGetRuntimeCapabilities(motionFalModel))
      .then(b=>{ if(alive) setModeCaps(m=>({ ...m, motion:b||{known:false}, motionModel:motionFalModel })); })
      .catch(()=>{ if(alive) setModeCaps(m=>({ ...m, motion:{known:false}, motionModel:motionFalModel })); });
    return ()=>{ alive=false; };
  }, [motionFalModel, proxyReadyFlag, composerTab]);
  const taskCaps = (modeCaps.tasks&&modeCaps.tasks.known&&modeCaps.tasks.capabilities)||null;
  const motionCaps = (modeCaps.motion&&modeCaps.motion.known&&modeCaps.motionModel===motionFalModel&&modeCaps.motion.capabilities)||null;
  const serverHasTask = (t)=>!!(taskCaps && Array.isArray(taskCaps.tasks) && taskCaps.tasks.includes(t));
  const serverHasMotion = !!(motionCaps && Array.isArray(motionCaps.characterOrientations) && motionCaps.characterOrientations.includes(effMotionOrientation));
  const serverHasStaging = (typeof window.vidStagingCapability==="function") ? window.vidStagingCapability(taskCaps) : false;
  const capsPending = modeCaps.tasks==null;   // Seedance task handshake still in flight
  const motionCapsPending = modeCaps.motion==null || modeCaps.motionModel!==motionFalModel;
  const PENDING_SERVER = "Not available yet — it's waiting on a server update.";
  // ---- Extend / Edit / Motion Control ------------------------------------------
  // Three paid paths beside the beat render. They share the clip's take list and
  // a device-file picker (staged straight into private storage as a `stage:`
  // reference — bytes never ride the proxy body and never persist on the take).
  const sd25Model = SEEDANCE_MODELS.find(m=>m.id==="seedance-2.5") || null;
  const sd25Tier = sd25Model ? seedanceTierOf(sd25Model,"standard") : null;
  const sd25Rate = (r)=>{ const v=Number(sd25Tier&&sd25Tier.creditRate&&sd25Tier.creditRate[r]); return v>0 ? v : null; };
  const creditScale = Number(window.CREDIT_SCALE)||1;
  // the LIVE multiplier (an admin price change reaches Extend too — 2026-10-05), Seedance 2.5's
  // input seconds rounded up to tenths exactly as the server and the main render do
  const VIDEO_INPUT_MUL = stageVideoInputMul("seedance-2.5") || 0.6;
  // A media input's length is a billing fact (fal bills input seconds and sizes
  // the output by them), so it is never guessed: device files carry probed facts,
  // takes are measured when picked, and an unmeasured video has NO price.
  const mediaSeconds = (m)=> (m && Number(m.seconds)>0) ? Number(m.seconds) : null;
  const takeChoices = orderedVisibleTakes.filter(t=>t&&t.url).map((t,i)=>({
    kind:"take", id:String(t.id||i), url:t.url, ref:t.url,
    label:(t.current ? "Current take" : "Take "+(orderedVisibleTakes.length-i)), lookSig:(t && t.meta && t.meta.lookSig) || "",
    seconds:(()=>{ const m=(t&&t.meta)||{}; const v=Number(m.durationSec)||Number(m.durationMs)/1000; return v>0 ? v : null; })() }));
  const mediaSetters = { extend:setExtendVideo, edit:setEditVideo, "motion-video":setMotionVideo, "motion-image":setMotionImage };
  const blobUrlsRef = React.useRef(new Set());
  React.useEffect(()=>()=>{ blobUrlsRef.current.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch(_e){} }); blobUrlsRef.current.clear(); }, []);
  const setMedia = (slot, media)=>{
    const set=mediaSetters[slot]; if(!set) return; setModeErr("");
    if(!media || media.kind!=="take"){ set(media); return; }
    // a take's recorded length is the REQUESTED one; the file itself is the fact
    // the price rides on — measure it, and keep the pick unpriced until it lands
    if(typeof window.vidMediaFacts!=="function"){ set({ ...media, seconds:null, measuring:false, measureError:"This build cannot verify a take's length." }); return; }
    set({ ...media, seconds:null, measuring:true, measureError:"" });
    const same = (cur)=> !!cur && cur.kind==="take" && cur.id===media.id && cur.url===media.url;
    window.vidMediaFacts(media.url,"video").then(f=>{
      const secs=Number(f&&f.durationSeconds)||0;
      set(cur=> same(cur) ? { ...cur, seconds:secs>0?secs:null, measuring:false, measureError:secs>0?"":"The take's length could not be read." } : cur);
    }).catch(e=>{ set(cur=> same(cur) ? { ...cur, seconds:null, measuring:false, measureError:(e&&e.message)||String(e) } : cur); });
  };
  const mediaUnpriced = (m)=> !m ? "" : m.measuring ? "Measuring the video's length…" : (m.measureError || (mediaSeconds(m)==null ? "The video's length is unknown — choose it again." : ""));
  const fileInputRef = React.useRef(null);
  const pendingPickRef = React.useRef(null);
  const pickDevice = (slot, kind)=>{
    const el = fileInputRef.current; if(!el) return;
    pendingPickRef.current = { slot, kind };
    el.accept = kind==="image" ? "image/*" : "video/*";
    el.value = ""; el.click();
  };
  const onDeviceFile = async (e)=>{
    const file = e.target.files && e.target.files[0];
    const pick = pendingPickRef.current; pendingPickRef.current = null;
    if(!file || !pick) return;
    if(typeof window.vidStageDeviceMedia!=="function"){ setModeErr("Device uploads are unavailable in this build."); return; }
    /* CONSENT FIRST (2026-10-10, owner — Likeness review): Motion Control's character image is a face, its motion
       video a person's body — a real person's likeness. The store's consent step ("Me" / "Someone else" +
       permission + 18 or over) runs before the file leaves this device; a refusal sends nothing. */
    if(pick.slot==="motion-image" || pick.slot==="motion-video"){
      const purpose = pick.slot==="motion-image" ? "motion-control-face" : "motion-control-body";
      let ok = true;
      try{
        if(typeof window.cameoConsentGate==="function") ok = !!(await window.cameoConsentGate({ purpose }));
        else if(typeof window.turnLikenessConsent==="function") ok = !!(await window.turnLikenessConsent(purpose));
        else if(typeof window.appConfirm==="function") ok = !!(await window.appConfirm({ title:"Use a video or photo of a real person?",
          body:"Is this you, or someone else? Only use one of yourself, or of someone who has given you permission to use their likeness \u2014 and they must be 18 or over.",
          confirmLabel:"I have permission \u2014 they're 18 or over", cancelLabel:"Cancel" }));
      }catch(err){ ok = false; }
      if(!ok){ setModeErr("Nothing was uploaded \u2014 the file needs your OK first."); return; }
    }
    setMediaBusy(pick.slot); setModeErr("");
    try{
      const staged = await window.vidStageDeviceMedia(file, pick.kind, {});
      blobUrlsRef.current.add(staged.blobUrl);
      setMedia(pick.slot, { kind:"device", url:staged.blobUrl, ref:staged.ref, name:staged.name,
        label:staged.name || ("Device "+pick.kind), seconds:Number(staged.facts&&staged.facts.durationSeconds)||null,
        sizeBytes:Number(staged.facts&&staged.facts.sizeBytes)||0, expiresAt:staged.expiresAt });
    }catch(err){ setModeErr((err&&err.message)||String(err)); }
    finally{ setMediaBusy(""); }
  };
  // the disclosure a take keeps about a media input: never a `stage:` reference or
  // a device URL — a device file is counted (privateRefs) and labelled by origin only
  const mediaReference = (m, tag, role)=>({ tag, kind:/Image/.test(tag) ? "image" : "video",
    label:m.kind==="device" ? "Device upload" : (m.label||tag), role, origin:m.kind,
    url:m.kind==="device" ? "" : (m.url||"") });
  const stagedExpired = (m)=> !!(m && m.kind==="device" && m.expiresAt && Date.now()>m.expiresAt);
  // ---- costs (estimates the button shows; the server holds + settles the real charge) ----
  // Before a video is chosen the buttons show the output-only estimate; once one
  // is chosen its measured length is part of the price, and an unmeasured input
  // has no price at all (the Generate button says why).
  const extendCost = (()=>{ const rate=sd25Rate(resolution); if(!rate) return null;
    const inRaw = extendVideo ? mediaSeconds(extendVideo) : 0; if(inRaw==null) return null;
    const inSecs = Math.ceil(Math.max(0, Number(inRaw)||0)*10 - 1e-9)/10;
    return Math.max(1, Math.ceil((duration+inSecs)*rate*VIDEO_INPUT_MUL*creditScale - 1e-9)); })();
  // MOTION CONTROL AND EDITING ARE BILLED BY THE FINISHED VIDEO'S LENGTH (billing rounds 3-4): the
  // server HOLDS the chosen video's length plus a margin while the render runs (the longest length
  // allowed for a video it doesn't size by length) and charges the finished length (stageLengthBilledHold /
  // stageLengthBilledEstimate mirror image-proxy's lengthBilledVideoHold). The button's chip shows
  // the expected charge for the chosen video; the label, the tooltip and the footer say what is
  // held, and Generate is blocked when the balance can't cover the HOLD — the number the server checks.
  // editing renders at the source length (fal coerces duration to auto): output + input seconds
  const sd25Usd = stageUsdPerSecond("seedance-2.5", "standard", resolution);
  const sd25Cps = sd25Rate(resolution)!=null ? sd25Rate(resolution)*creditScale : null;
  const editCost = (sd25Usd||sd25Cps) && editVideo && mediaSeconds(editVideo)!=null
    ? stageLengthBilledEstimate("editing", { usdPerSecond:sd25Usd, creditsPerSecond:sd25Cps, inputSeconds:mediaSeconds(editVideo) }) : null;
  const editHold = (sd25Usd||sd25Cps) ? stageLengthBilledHold("editing", { usdPerSecond:sd25Usd, creditsPerSecond:sd25Cps, inputSeconds:mediaSeconds(editVideo), sizable:stageLengthSizesHold(editVideo) }) : null;
  const motionCreditRate = (typeof window.turnVideoCreditRate==="function")
    ? window.turnVideoCreditRate("kling-3.0-motion-control", motionTier, motionTier==="pro"?"1080p":"720p") : null;
  const motionUsd = stageUsdPerSecond("kling-3.0-motion-control", motionTier, motionTier==="pro"?"1080p":"720p");
  const motionCps = motionCreditRate>0 ? motionCreditRate*creditScale : null;
  // motion control's output follows the motion video, billed per (whole) second
  const motionCost = (motionUsd||motionCps) && motionVideo && mediaSeconds(motionVideo)!=null
    ? stageLengthBilledEstimate("motion", { usdPerSecond:motionUsd, creditsPerSecond:motionCps, inputSeconds:mediaSeconds(motionVideo), orientation:effMotionOrientation }) : null;
  const motionHold = (motionUsd||motionCps) ? stageLengthBilledHold("motion", { usdPerSecond:motionUsd, creditsPerSecond:motionCps, orientation:effMotionOrientation, inputSeconds:mediaSeconds(motionVideo), sizable:stageLengthSizesHold(motionVideo) }) : null;
  const _fmtN = (n)=> (Number(n)||0).toLocaleString("en-US");
  const holdLead = (hold)=> "Holds up to "+_fmtN(hold)+" credit"+(hold!==1?"s":"")+"; charged for the finished video’s length";
  const extendCostTitle = extendCost!=null ? (extendCost+" credit"+(extendCost!==1?"s":"")+" — ~"+_fmtSecs(duration)+" added"+(extendVideo&&extendVideo.seconds?" + "+_fmtSecs(Math.round(extendVideo.seconds))+" of input":"")+" × "+resolution+" × Seedance 2.5 (video-input rate)") : "";
  const editCostTitle = editHold!=null ? (holdLead(editHold)
    +(editCost!=null ? " — about "+_fmtN(editCost)+" for this "+_fmtSecs(Math.round(mediaSeconds(editVideo)*10)/10)+" video (the edited length plus the input length × "+resolution+" × Seedance 2.5, video-input rate)" : "")
    +". The rest is returned when it finishes.") : "";
  const motionCostTitle = motionHold!=null ? (holdLead(motionHold)
    +(motionCost!=null ? " — about "+_fmtN(motionCost)+" for this "+_fmtSecs(Math.max(1, Math.ceil(mediaSeconds(motionVideo)-0.05)))+" motion video × Kling 3.0 Motion Control "+(motionTier==="pro"?"Pro":"Standard") : "")
    +". The output follows the motion video; the rest is returned when it finishes.") : "";
  const editHoldInfo = editHold!=null ? stageCreditInfo(creditBalance, editHold, { hold:true, estimate:editCost, basis:stageLengthHoldBasis(editVideo, mediaSeconds(editVideo)) }) : null;
  const motionHoldInfo = motionHold!=null ? stageCreditInfo(creditBalance, motionHold, { hold:true, estimate:motionCost, basis:stageLengthHoldBasis(motionVideo, mediaSeconds(motionVideo)) }) : null;
  const modeCreditInfo = (cost)=> stageCreditInfo(creditBalance, cost==null?1:cost);
  // the Create tab's Extend task has its OWN price (round 5: the footer, the red outline and the
  // warning agree with its button): the extension's cost once the video to extend is measured;
  // before that, the added seconds alone — the least it can cost ("at least N")
  const extendFloorCost = (()=>{ const rate=sd25Rate(resolution); if(!rate) return null;
    return Math.max(1, Math.ceil(duration*rate*VIDEO_INPUT_MUL*creditScale - 1e-9)); })();
  const extendCreditInfo = (extendVideo && mediaSeconds(extendVideo)!=null && extendCost!=null) ? modeCreditInfo(extendCost)
    : extendFloorCost!=null ? stageCreditInfo(creditBalance, extendFloorCost, { floor:true }) : null;
  const modeCreditBlock = (cost, what)=>{
    const ci = modeCreditInfo(cost);
    if(!ci.empty) return "";
    if(ci.ownerPays) return stageCreditShortText(ci);
    return ci.frozen ? "Your account is on hold while a payment is disputed, so spending credits is paused."
      : "Not enough generation credits for this "+what+".";
  };
  // the same check against what the server HOLDS (Motion Control, editing)
  const modeHoldBlock = (info, what)=>{
    if(!info || !info.empty) return "";
    if(info.ownerPays) return stageCreditShortText(info);
    return info.frozen ? "Your account is on hold while a payment is disputed, so spending credits is paused."
      : "Not enough generation credits for this "+what+": it holds up to "+_fmtN(info.cost)+" credits while it runs (charged for the finished video’s length), and "+_fmtN(info.remaining)+" remain.";
  };
  const modeGuard = ()=>{
    if(gening || staging) return "A render is already running.";
    if(readOnly) return "View-only access — rendering requires edit access.";
    return "";
  };
  // Asset preparation awaits (signed-URL refreshes, staging) run before the paid
  // submission; if the user moves to another clip meanwhile, the job must not be
  // committed under the new selection — re-check the clip right before spending.
  const assertSameClip = (clipId0)=>{
    // RIGHTS ARE RE-CHECKED before spending (2026-10-09, owner — Stage review): a role changed to view-only
    // while the render was being prepared (the confirm, staging, the reprice question) stops it here
    if(readOnlyRef.current) throw new Error("Your access to this film changed to view-only while the render was being prepared \u2014 nothing was submitted.");
    if(!consoleOpenRef.current) throw new Error("This clip's console closed while the render was being prepared — nothing was submitted. Reopen the clip and start it again.");
    if(clipIdRef.current!==clipId0) throw new Error("The clip changed while this render was being prepared — nothing was submitted. Start it again from the clip you want.");
  };
  const finishMode = (res, reason, cost)=>{
    if(res && res.seed!=null) setLastSeed(res.seed);
    try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason, cost } })); }catch(_e){}
  };
  const modeFail = (e)=>{
    // the user declined a render priced at the longest length: a choice, not an error
    if(e && e.repriceDeclined){ setModeErr(""); if(typeof window.appToast==="function") window.appToast(e.message,"info"); return; }
    const msg=stageFriendlyVideoError(e); setModeErr(msg); if(typeof window.appToast==="function") window.appToast(msg,"error"); };
  // EXTEND — Seedance 2.5 "extension": continue @Video1 by the chosen duration.
  const onExtend = async ()=>{
    const g=modeGuard(); if(g){ modeFail(new Error(g)); return; }
    if(!extendVideo){ modeFail(new Error("Choose the video to extend — one of this clip's takes or a file from this device.")); return; }
    if(stagedExpired(extendVideo)){ modeFail(new Error("That device upload has expired — choose the file again.")); return; }
    if(!sd25Tier){ modeFail(new Error("This video model isn't available right now.")); return; }
    if(modelId!=="seedance-2.5"){ modeFail(new Error("Extend Video runs on Seedance 2.5 — switch the model first.")); return; }
    if(!serverHasTask("extension")){ modeFail(new Error(PENDING_SERVER)); return; }
    try{
      assertScreenplayCurrent();
      if(promptSourceDrift) throw new Error("Review this edited prompt against the updated scene screenplay before extending.");
    }catch(e){ modeFail(e); return; }
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity({identityCharacterIds:identityIds, identityCast, identityContext}, "stage-video-extend-start"); }
      catch(e){ modeFail(e); return; }
    }
    if(mediaUnpriced(extendVideo)){ modeFail(new Error(mediaUnpriced(extendVideo))); return; }
    if(extendCost==null){ modeFail(new Error("No price is available for "+resolution+" on Seedance 2.5.")); return; }
    if(modeCreditBlock(extendCost,"extension")){ modeFail(new Error(modeCreditBlock(extendCost,"extension"))); return; }
    const clipId0 = clip.id;
    const controls = directorControls();
    try{
      // an EXCLUDED start frame stays out, exactly as in the main render (2026-10-05)
      const frameAsset = onImages.find(a=>a.referenceKind!=="screenplay"&&a.url===startFrame) || null;
      const freshFrameUrl = frameAsset ? await stageServerAssetUrl(frameAsset, startFrame || frameAsset.url || "") : "";
      const extendImages=[];
      for(const page of includedScreenplayImages)
        extendImages.push(await stageServerAssetUrl({...page,referenceKind:"screenplay"}));
      if(extendImages.length+(freshFrameUrl?1:0)>imageLimit)
        throw new Error("The selected screenplay pages exceed this model's image-reference limit. No extension was submitted.");
      assertStageIdentityAssets();
      assertScreenplayCurrent();
      // Seedance's canonical extension grammar: name the video and the added length,
      // then describe the continuation — not a bare re-render with a video attached.
      const extendPrompt = "Extend @Video1 by ~"+Math.round(duration)+" seconds, continuing seamlessly from where it ends: "
        +prompt.trim()+(identityPrompt?"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt:"");
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-extend-before-submit");
      const references=[ mediaReference(extendVideo,"@Video1","Video to extend") ];
      assertSameClip(clipId0);
      const extendRef = await stageFreshVideoRef(extendVideo);
      const res = await stageWithLengthReprice((p)=>{ assertSameClip(clipId0); return gen.generate(p); }, { frameUrl:freshFrameUrl, imageUrls:extendImages, videoUrls:[extendRef], prompt:extendPrompt, controls,
        videoTask:"extension",
        screenplayReference,
        screenplayImages:includedScreenplayImages.length?includedScreenplayImages:undefined,
        screenplayImagesRequired:false, assertScreenplayCurrent,
        // the take's look: the video it extends, or the start frame it includes, when either carries an earlier one
        takeMeta:{ lookSig:(extendVideo && _earlierOf(extendVideo.lookSig)) ? extendVideo.lookSig : (earlierLookIn(freshFrameUrl ? [(d.first||{}).id] : []) || clipLookSig),
          shotSources:clipShotSources(), screenplayReference, screenplayImages:includedScreenplayImages, source:"extend", tier:sd25Tier.id, tierLabel:sd25Tier.label, resolution, bitrate,
          durationSec:duration, inputSeconds:mediaSeconds(extendVideo), references, privateRefs:(extendVideo.kind==="device"?1:0),
          audio: hasDialogue ? "voice" : (nativeAudio ? "native" : "silent"),
          inputs:(1+(freshFrameUrl?1:0)+extendImages.length)+" img · 1 vid · 0 aud" },
        identityCharacterIds:identityIds, identityCast, identityContext,
        quote:{ cost:extendCost, reason:"stage-video-extend" },   // shown price; the server holds + settles the charge
        durationMs:duration*1000, aspectRatio:"auto", fast:false, generateAudio: hasDialogue ? true : nativeAudio,
        falModel:sd25Tier.falModel||undefined, resolution, bitrateMode:bitrate, force:true });
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity({identityCharacterIds:identityIds,identityCast,identityContext},"stage-video-extend-after-provider");
      finishMode(res, "stage-video-extend", extendCost);
    }catch(e){ modeFail(e); }
  };
  // EDIT — Seedance 2.5 "editing": rewrite @Video1 from the edit prompt, with the
  // strip's included images/audio riding as @Image/@Audio references (no screenplay
  // pages: this is a video rewrite, not a beat render).
  const editRefImages = onImages.filter(a=>a.referenceKind!=="screenplay" && a.url);
  const editRefAudios = onAudios.filter(a=>a.url);
  const editMentionables = [{ t:"@Video1", label:editVideo ? (editVideo.kind==="device" ? "Device upload" : editVideo.label) : "the video to edit", kind:"video", url:"", key:"edit-video", group:"Video to edit", included:true }]
    .concat(editRefImages.map((a,i)=>({ t:"@Image"+(i+1), label:String(a.label||""), kind:"image", url:String(a.url||""), key:a.key, assetKey:a.key, group:a.group||"References", included:true })))
    .concat(editRefAudios.map((a,i)=>({ t:"@Audio"+(i+1), label:String(a.label||""), kind:"audio", url:"", key:a.key, assetKey:a.key, group:"Voices", included:true })));
  const onEditVideo = async ()=>{
    const g=modeGuard(); if(g){ modeFail(new Error(g)); return; }
    if(!editVideo){ modeFail(new Error("Add the video to edit first — one of this clip's takes or a file from this device.")); return; }
    if(stagedExpired(editVideo)){ modeFail(new Error("That device upload has expired — choose the file again.")); return; }
    if(!String(editPrompt||"").trim()){ modeFail(new Error("Describe the edit — what should change in @Video1.")); return; }
    if(!sd25Tier){ modeFail(new Error("This video model isn't available right now.")); return; }
    if(!planAllowsModel("seedance-2.5")){ openPlansUpsell(); modeFail(new Error("Seedance 2.5 Edit needs the Director plan.")); return; }
    if(!serverHasTask("editing")){ modeFail(new Error(PENDING_SERVER)); return; }
    if(mediaUnpriced(editVideo)){ modeFail(new Error(mediaUnpriced(editVideo))); return; }
    if(editCost==null || editHold==null){ modeFail(new Error("No price is available for "+resolution+" on Seedance 2.5.")); return; }
    if(modeHoldBlock(editHoldInfo,"edit")){ modeFail(new Error(modeHoldBlock(editHoldInfo,"edit"))); return; }   // the server checks the HOLD
    if(editRefImages.length>29) { modeFail(new Error("Edit Video takes up to 29 image references beside the video.")); return; }
    const clipId0 = clip.id, editSecs = mediaSeconds(editVideo);
    try{
      const imageUrls=[];
      for(const a of editRefImages){ const u=await stageServerAssetUrl(a); if(u) imageUrls.push(u); }
      const audioUrls = editRefAudios.map(a=>a.url).filter(Boolean);
      const references=[ mediaReference(editVideo,"@Video1","Video to edit") ]
        .concat(editRefImages.map((a,i)=>({ tag:"@Image"+(i+1), kind:"image", label:a.label||"", role:"Reference", url:a.url||"" })))
        .concat(editRefAudios.map((a,i)=>({ tag:"@Audio"+(i+1), kind:"audio", label:a.label||"", role:"Reference", url:"" })));
      assertSameClip(clipId0);
      // the edit renders at the source length (fal: editing → duration auto) — record
      // it so the take carries a real length when it is reused as an input later
      const editRef = await stageFreshVideoRef(editVideo);
      const res = await stageWithLengthReprice((p)=>{ assertSameClip(clipId0); return gen.generate(p); }, { imageUrls, videoUrls:[editRef], audioUrls, prompt:String(editPrompt).trim(), controls:"",
        videoTask:"editing",
        // the edit carries the look of the video it rewrites (2026-10-09: it carried none and read as current)
        takeMeta:{ lookSig:(editVideo && _earlierOf(editVideo.lookSig)) ? editVideo.lookSig : clipLookSig, shotSources:clipShotSources(),
          source:"edit", tier:sd25Tier.id, tierLabel:sd25Tier.label, resolution, bitrate, references,
          durationSec:editSecs, inputSeconds:editSecs,
          privateRefs:(editVideo.kind==="device"?1:0), audio: nativeAudio ? "native" : "silent",
          inputs:imageUrls.length+" img · 1 vid · "+audioUrls.length+" aud" },
        quote:{ cost:editCost, reason:"stage-video-edit" },
        durationMs:Math.round(editSecs*1000), aspectRatio:"auto", fast:false, generateAudio:nativeAudio,
        falModel:sd25Tier.falModel||undefined, resolution, bitrateMode:bitrate, force:true });
      finishMode(res, "stage-video-edit", editCost);
    }catch(e){ modeFail(e); }
  };
  // MOTION CONTROL — Kling 3.0: one character image + one motion video.
  const motionTooLong = !!(motionVideo && motionVideo.seconds && motionVideo.seconds>motionLimits.maxSeconds+0.05);
  const motionTooShort = !!(motionVideo && motionVideo.seconds && motionVideo.seconds<motionLimits.minSeconds);
  const onMotionControl = async ()=>{
    const g=modeGuard(); if(g){ modeFail(new Error(g)); return; }
    if(!motionVideo){ modeFail(new Error("Add the motion to copy — a 3–"+motionLimits.maxSeconds+"s video.")); return; }
    if(!motionImage){ modeFail(new Error("Add your character — an image with a visible face and body.")); return; }
    if(stagedExpired(motionVideo)||stagedExpired(motionImage)){ modeFail(new Error("A device upload has expired — choose the file again.")); return; }
    if(motionTooLong){ modeFail(new Error("The motion video is "+_fmtSecs(Math.round(motionVideo.seconds))+" — at most "+motionLimits.maxSeconds+"s when "+(effMotionOrientation==="image"?"the scene follows the character image":"the scene follows the motion video")+".")); return; }
    if(motionTooShort){ modeFail(new Error("The motion video must be at least "+motionLimits.minSeconds+"s.")); return; }
    if(!serverHasMotion){ modeFail(new Error(PENDING_SERVER)); return; }
    if(mediaUnpriced(motionVideo)){ modeFail(new Error(mediaUnpriced(motionVideo))); return; }
    if(motionCost==null || motionHold==null){ modeFail(new Error("No price is available for Kling 3.0 Motion Control.")); return; }
    if(modeHoldBlock(motionHoldInfo,"motion render")){ modeFail(new Error(modeHoldBlock(motionHoldInfo,"motion render"))); return; }   // the server checks the HOLD
    const clipId0 = clip.id, motionSecs = mediaSeconds(motionVideo);
    try{
      const imageRef = motionImage.kind==="device" ? motionImage.ref : await stageServerAssetUrl(motionImage.asset||null, motionImage.url);
      if(!imageRef) throw new Error("The character image could not be attached.");
      const references=[ mediaReference(motionImage,"@Image1","Character"), mediaReference(motionVideo,"@Video1","Motion to copy") ];
      assertSameClip(clipId0);
      // the output follows the motion video's length — recorded on the take
      const motionRef = await stageFreshVideoRef(motionVideo);
      const res = await stageWithLengthReprice((p)=>{ assertSameClip(clipId0); return gen.generate(p); }, { frameUrl:imageRef, videoUrls:[motionRef], prompt:String(motionPrompt||"").trim(), controls:"",
        characterOrientation:effMotionOrientation, keepOriginalSound,
        takeMeta:{ lookSig:(motionImage && motionImage.asset && earlierLookIn([motionImage.asset.id])) || clipLookSig, shotSources:clipShotSources(),
          source:"motion-control", tier:motionTier, tierLabel:"Kling 3.0 Motion Control "+(motionTier==="pro"?"Pro":"Standard"),
          resolution:(motionTier==="pro"?"1080p":"720p"), bitrate:"", references, durationSec:motionSecs, inputSeconds:motionSecs,
          privateRefs:((motionImage.kind==="device"?1:0)+(motionVideo.kind==="device"?1:0)),
          sceneControl:sceneControl, characterOrientation:effMotionOrientation, keepOriginalSound,
          audio: keepOriginalSound ? "original" : "silent", inputs:"1 img · 1 vid · 0 aud" },
        quote:{ cost:motionCost, reason:"stage-video-motion-control" },
        durationMs:Math.round(motionSecs*1000), aspectRatio:"auto", fast:false, generateAudio:keepOriginalSound,
        falModel:motionFalModel, resolution:(motionTier==="pro"?"1080p":"720p"), bitrateMode:"standard", force:true });
      finishMode(res, "stage-video-motion-control", motionCost);
    }catch(e){ modeFail(e); }
  };
  // PRICED, AND ASKED (2026-10-05, owner — Stage review): each unvoiced line is one paid voice render
  const voiceTodo = lineShots.filter(sh=>String(sh.dialogue||"").trim() && !_shotAudioReady(sh,auds,ctx.characters||[]));
  const voiceLineModel = (sh)=>{ const la=(sh&&sh.lineAudio)||{}; const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const c=(ctx.characters||[]).find(x=>x && ((la.speakerId && String(x.id)===String(la.speakerId)) || norm(x.name)===norm(la.speaker)));
    // the lock's own model (an unpinned lock: the model it was made on — voicegen.jsx vgDeliveryModelOf)
    if(c && c.voiceLock) return (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(c.voiceLock) : (c.voiceLock.modelId || "eleven_v3");
    return la.modelId || window.VG_TTS_MODEL || "eleven_v4"; };
  const voiceClipCredits = voiceTodo.reduce((n,sh)=> n + ((typeof window.vgLineCredits==="function") ? window.vgLineCredits(sh.dialogue, voiceLineModel(sh)) : 1), 0);
  const onVoiceClip = async ()=>{
    // paid, and it writes the shots' line audio: never from a view-only Stage (2026-10-09)
    if(!onVoiceLine || voicingClip || readOnly) return;
    const todo = voiceTodo;
    if(!todo.length) return;
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({
        title:"Voice "+todo.length+" line"+(todo.length!==1?"s":"")+" for this clip?",
        body:"Each line is rendered in its character's locked voice \u2014 about "+voiceClipCredits+" credit"+(voiceClipCredits===1?"":"s")+" in all. Lines already voiced are kept.",
        confirmLabel:"Voice "+todo.length+" line"+(todo.length!==1?"s":""), cancelLabel:"Cancel" });
      if(!ok) return;
    }
    setVoicingClip(true);
    try{ for(const sh of todo){ await onVoiceLine(sh); } }
    finally{ setVoicingClip(false); }
  };
  const onChip = (ch)=>{
    const line = String((ch&&ch.k)||"").trim()+": "+String((ch&&ch.v)||"").trim();
    if(!line.trim() || line.indexOf(": ")===0) return;
    promptEditedRef.current=true; setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false); setPromptDriftConfirmed("");
    setPrompt(p=>{
      const cur = String(p||"").trim();
      if(cur.toLowerCase().indexOf(line.toLowerCase())>=0) return p;
      const next=cur ? (cur+"\n"+line) : line;
      promptDraftsRef.current[promptDraftKey]={text:next,sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:shownShots.map(s=>s.id),updatedAt:Date.now()};
      return next;
    });
  };
  const gening = staging || gen.gening;   // staging = pre-submit asset prep — a slow stage must not look like a dead click
  const genBusyLabel = staging ? ("Preparing inputs · "+Math.max(1, Math.min(99, Math.round(prepPct||1)))+"%") : (stageStatusLabel(gen.status)||"Rendering…");
  const genBusySub = staging ? "Preparing the selected references…" : ((model.label||"The model")+" is generating this clip…");
  // the poll loop bakes "· NN%" into the status string — lift it back out for the bar
  const genPctMatch = gening ? String(genBusyLabel).match(/(\d{1,3})%/) : null;
  const genPct = genPctMatch ? Math.min(100, Number(genPctMatch[1])) : null;
  const genErr = stageFriendlyVideoError(gen.err);
  const providerPolicyFailure=!!(gen.err&&typeof gen.err==="object"&&gen.err.name==="ProviderPolicyError");
  const textOnlyPolicyFailure=stageIsTextOnlyPolicyFailure(gen.err);
  const providerPolicyDetail=providerPolicyFailure
    ? String(gen.err.providerDetail||gen.err.message||"").trim() : "";
  const genNotice=providerPolicyFailure
    ? (textOnlyPolicyFailure
      ? "The provider also rejected the media-free render."
      : "The provider rejected this render under its content, safety, or likeness policy.")
    : genErr;
  const dialogueAssignmentRows=clipDialogueLines.map((row,i)=>({
    row,index:i,key:stageDialogueAssignmentKey(row,i),
    beatN:Number(row&&row.evidence&&row.evidence.beatN || row&&row.beatN || activeShot.beatN)
  }));
  const dialogueAssignableShots=(d.shots||[]).filter(sh=>!stageShotHasDialogueAssignment(sh));
  const assignedShotIds=Object.values(dialogueAssignments).filter(Boolean);
  const dialogueAssignmentsComplete=dialogueAssignmentRows.length>0
    &&dialogueAssignmentRows.every(x=>dialogueAssignments[x.key])
    &&new Set(assignedShotIds).size===assignedShotIds.length;
  const dialogueAssignmentCapacity=dialogueAssignmentRows.every(x=>
    dialogueAssignableShots.filter(sh=>Number(sh.beatN)===Number(x.beatN)).length
      >= dialogueAssignmentRows.filter(y=>Number(y.beatN)===Number(x.beatN)).length);
  const openDialogueAssignments=()=>{
    setDialogueAssignments({}); setDialogueAssignError(""); setDialogueAssignOpen(true);
  };
  const saveDialogueAssignments=()=>{
    if(readOnly||gening||!onUpdateShot)return;
    const result=stageDialogueAssignmentPatches(clip,dialogueAssignments);
    if(result.error){setDialogueAssignError(result.error);return;}
    result.patches.forEach(x=>onUpdateShot(x.id,x.patch));
    setDialogueAssignOpen(false); setDialogueAssignError("");
    if(typeof window.appToast==="function")window.appToast(
      "Assigned "+result.patches.length+" screenplay line"+(result.patches.length===1?"":"s")+" — Locked voice is now available.","success");
  };
  const playerClockDuration = playerUrl ? (playerClock.duration || duration || 0) : 0;
  const playerClockFill = playerUrl && playerClockDuration
    ? Math.max(0, Math.min(100, (playerClock.time/playerClockDuration)*100))
    : 0;
  const playerClockLabel = _stageClock(playerUrl ? playerClock.time : 0)+" / "+_stageClock(playerClockDuration);
  // this render's price from the current settings — every cost-bearing choice contributes;
  // a batch multiplies it (N parallel takes) and the balance gates on the TOTAL.
  // included video references (the previous clip) are billed too — measured length, else the saved
  // take length, else the longest clip (repair 2026-09-30)
  const refVideoMul = stageVideoInputMul(modelId);
  const refVideoSec = refVideoMul>0 ? onVideos.reduce((t,a)=>{
    const secs = a && a.key==="prev" ? (prevVideoSecs || prevVideoMetaSecs) : (Number(a && a.seconds)>0 ? Number(a.seconds) : 0);
    return t + (secs>0 ? secs : STAGE_REF_VIDEO_MAX_SEC);
  }, 0) : 0;
  const renderCost = stageRenderCost(tierObj, resolution, duration, { videoSec:refVideoSec, inputMul:refVideoMul });
  const textOnlyCost = stageRenderCost(tierObj, resolution, duration);   // "Retry from text only" sends no references
  const totalCost = renderCost*Math.max(1, batchN);
  const textOnlyTotal = textOnlyCost*Math.max(1, batchN);
  // "710 credits — (10s + 15s of reference video) × 720p × Standard × 0.6 (video-input rate)"
  const renderSecsText = refVideoSec>0 ? ("("+_fmtSecs(duration)+" + "+_fmtSecs(Math.round(refVideoSec*10)/10)+" of reference video)") : _fmtSecs(duration);
  const renderCostTitle = totalCost.toLocaleString("en-US")+" credit"+(totalCost!==1?"s":"")+" — "
    +(batchN>1 ? (batchN+" takes × (") : "")+renderSecsText+" × "+resolution+" × "+tierObj.label
    +(refVideoSec>0 ? " × "+refVideoMul+" (video-input rate)" : "")+(batchN>1?")":"");
  /* THE HOLD, SHOWN (2026-10-09, owner — Stage review): a reference video the server can't size by its
     length (one kept outside the film's storage) is held at the longest input length — the Stage showed
     and checked only the estimate, so the server could refuse a render the Stage said you could afford */
  const refVideoUnsized = refVideoMul>0 && onVideos.some(a=>a && a.url && !stageLengthSizesHold({ url:a.url }));
  const renderHold = refVideoUnsized ? stageRenderCost(tierObj, resolution, duration, { videoSec:STAGE_REF_VIDEO_MAX_SEC, inputMul:refVideoMul }) : null;
  const totalHold = renderHold!=null ? renderHold*Math.max(1, batchN) : null;
  const creditInfo = (totalHold!=null && totalHold>totalCost)
    ? stageCreditInfo(creditBalance, totalHold, { hold:true, refs:true, estimate:totalCost, basis:"stored" })
    : stageCreditInfo(creditBalance, totalCost);
  // the credit footer under the settings panel follows the open composer tab (billing round 3) —
  // and on the Create tab, its open task: Extend shows the extension's price (round 5)
  const footerCredit = (composerTab==="edit" && editHoldInfo) ? editHoldInfo
    : (composerTab==="motion" && motionHoldInfo) ? motionHoldInfo
    : (composerTab==="create" && createTask==="extension" && extendCreditInfo) ? extendCreditInfo : creditInfo;
  const canTextOnlyRecovery=stageCanOfferTextOnlyRecovery(gen.err||genErr,modelId);
  const textOnlyRecoveryTitle="Start a new "+textOnlyTotal.toLocaleString("en-US")+"-credit render through Seedance 2.5 text-to-video. "
    +"No image, video, or recorded-voice files will be sent; the screenplay/shot prompt and render settings stay, but cast likeness and exact visual continuity may vary.";
  // Automatic screenplay-backed briefs regularly exceed the old 1,999-character
  // textarea ceiling. Keep the whole compiled direction editable; the paid path
  // still preserves provider-specific validation and never truncates silently.
  const PANEL_PROMPT_MAX = 12000;
  const fictionalPolicyContextPresent=/fictional context:/i.test(String(prompt||""));
  const addFictionalPolicyContext=()=>{
    if(clipHasLikeness) return;   // never for a real person's likeness (owner — Likeness review)
    const next=stagePolicyContextPrompt(prompt);
    if(next.length>PANEL_PROMPT_MAX){
      if(typeof window.appToast==="function") window.appToast("The prompt is too close to the limit to add the context note. Shorten it first; no render was submitted.","error");
      return;
    }
    promptEditedRef.current=true;
    setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false); setPromptDriftConfirmed("");
    promptDraftsRef.current[promptDraftKey]={text:next,sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:shownShots.map(s=>s.id),updatedAt:Date.now()};
    setPrompt(next);
    requestAnimationFrame(()=>{ try{ promptRef.current&&promptRef.current.applyValue(next,0); }catch(_e){} });
    if(typeof window.appToast==="function") window.appToast("Added a fictional-context note to the render prompt. Review it before generating; nothing was submitted.","info");
  };
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
          note:serverPending ? "Not available yet — waiting on a server update"
            : locked ? (anyTier ? (r+" needs the Standard tier") : (r+" isn't available on "+model.label)) : (planLocked ? planResNote(r)+" — click to upgrade" : undefined),
          tag:planLocked ? (stagePlanForRes(r)||"Plan")+" plan" : undefined,
          meta: r==="4K" ? [{ icon:Icon.sparkles, label:"5× credits" }] : undefined };
      }),
      onPick:(r)=>{ if(!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget)) return;
        if(!planAllowsRes(r)){ openPlansUpsell(); return; } setResolution(r); } },
    { key:"dur", icon:Icon.clock, label:_fmtSecs(duration), heading:"Clip duration",
      title: durationTitle,
      options:durationOptions.map(v=>({ value:v, label:_fmtSecs(v)+durationOptionNote(v), selected:v===duration })),
      onPick:(v)=>setDurationOverride(Number(v)===autoDurationSec ? null : Number(v)) },
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
          const voicedN = g.shots.filter(sh=>_shotAudioReady(sh,auds,ctx.characters||[])).length;
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
            onClick:()=>setMaxImg({url:a.url,label:a.label,kind:a.kind})}, Icon.maximize&&_stEl(Icon.maximize,{s:12}))))
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
  if(readOnly) blockers.push({ key:"readonly", text:"View-only access \u2014 rendering requires edit access." });
  if(screenplayIssue) blockers.push({key:"screenplay-source",text:screenplayIssue});
  if(includedScreenplayImages.length && !modelRefs) blockers.push({
    key:"screenplay-model",
    text:"This video model cannot accept screenplay-page images. Exclude those optional page references, or choose a reference-capable model such as Seedance."
  });
  if(!stageServerResolutionAllowed(modelId,resolution,runtimeCaps,capabilityTarget)) blockers.push({
    key:"server-resolution",
    text:resolution+" isn't available yet (it's waiting on a server update). Choose a resolution such as 720p before rendering."
  });
  // ONE character's missing appearance state across several shots → the banner
  // carries the explicit bulk choice (same persisted per-shot override, one click).
  // With a second character also missing, the panel rows stay the only path: a
  // banner button must resolve the banner, not one character of two.
  const bulkChoice=characterReferenceBulk.length===1&&characterReferenceMissingIds.length===1&&modelRefs
    ? characterReferenceBulk[0] : null;
  if(referenceBlockingWarnings.length) blockers.push({
    key:"required-reference",
    text:referenceBlockMessage,
    actionLabel:bulkChoice&&canBulkCharacterReference&&bulkChoice.masterReady
      ? "Use master for "+bulkChoice.shotsLabel : null,
    action:bulkChoice ? ()=>applyCharacterReferenceBulk(bulkChoice) : null
  });
  const promptLookChanged = promptEditedRef.current && !!promptLookStamp && promptLookStamp!==clipLookSig;
  if(promptSourceDrift) blockers.push({key:"prompt-drift",
    text: promptOtherGrouping
      ? "This hand-edited prompt was written when this clip held a different set of shots (its grouping changed). Check it describes this clip's shots before you render \u2014 or Reset to script."
      : promptLookChanged
      ? "This scene's look changed on the Color tab after you edited this prompt \u2014 its Style / Look lines still describe the earlier look. Update them (or Reset to script) before reusing it; a take rendered from it is marked as made with an earlier look."
      : "This hand-edited prompt was written against an older scene screenplay, shot timing, shot list, dialogue or reference version. Review the updated screenplay screenshots and selected references before reusing it.",
    actionLabel:"Confirm reviewed",action:()=>{ setPromptDriftConfirmed(promptSourceSig); setPromptOtherGrouping(false); }});
  const planIssue=renderPlan&&(renderPlan.issues||[]).find(x=>x&&x.blocking);
  if(planIssue) blockers.push({key:"render-plan",text:planIssue.message,
    actionLabel:clipScope==="legacy"?"Split to fit":null,
    action:clipScope==="legacy"?()=>setClipScope("beat"):null});
  if(needsVoice) blockers.push({ key:"voice",
    text:hasUnassignedClipDialogue
      ? "This complete beat has ordered screenplay dialogue that is not assigned to a shot. Choose Native performance, or assign every line to a shot before using Locked voice. Lines are never matched to shots or audio by guesswork."
      : ((firstVoiceIssue&&firstVoiceIssue.reason)||"Voice this clip before rendering — duration and lip-sync lock to current line audio."),
    actionLabel:hasUnassignedClipDialogue ? "Choose Native performance"
      : ((onVoiceLine && !readOnly) ? (voicingClip ? "Voicing…" : ("Voice clip now"+(voiceClipCredits>0?" \u00b7 about "+voiceClipCredits+" credit"+(voiceClipCredits===1?"":"s"):""))) : null),
    action:hasUnassignedClipDialogue ? ()=>setDialogueAudio("native") : onVoiceClip,
    busy:hasUnassignedClipDialogue ? false : voicingClip });
  if(sourceBlocking) blockers.push({ key:"source",
    text:"No storyboard source is ready yet — save this clip's "+(sourceMode==="sheet"?"sheet":"halves")+" in Storyboards, or switch Visual source back to shot/prompt rendering." });
  if(clip.g&&clip.g.over&&(!renderPlan||renderPlan.over)) blockers.push({ key:"overcap",
    text:"This part needs "+_fmtSecs(clip.g.dur)+" — over "+(model.label||"this model")+"'s "+_fmtSecs(model.maxClipSec||15)+" maximum. No shot was omitted or compressed. Choose Split to fit to split at shot boundaries; if one shot alone is too long, split that shot/dialogue deliberately in the Art Room.",
    actionLabel:clipScope==="legacy"?"Split to fit":null,
    action:clipScope==="legacy"?()=>setClipScope("beat"):null });
  if(voiceLocked && onAudios.length>directAudioLimit) blockers.push({ key:"voice-cap",
    text:"This render has "+onAudios.length+" spoken lines; this model accepts "+directAudioLimit+" voice lines at once. Split to fit makes shorter parts at shot boundaries so no line is silently dropped." });
  // OVER THE MODEL'S CLIP CEILING — the render would clamp silently and compress
  // the pacing; force the choice instead (the fit / untick / parts fixes sit
  // with the rows). Only reachable via the seconds steppers — ticking is capped.
  if(recipe==="multishot" && msTotal > (model.maxClipSec||15)+0.001) blockers.push({ key:"overcap",
    text:"The ticked shots total "+_fmtSecs(Math.round(msTotal*10)/10)+" — over "+(model.label||"this model")+"'s "+_fmtSecs(model.maxClipSec||15)+" maximum per clip. Fit the seconds, untick rows, or render in parts (the fixes sit under the rows)." });
  if(assetOver) blockers.push({ key:"budget",
    text:"Too many inputs selected — exclude "+budgetOverBy+" optional asset"+(budgetOverBy!==1?"s":"")+" before rendering." });
  if(imageOver) blockers.push({key:"image-budget",
    text:"This render has "+onImages.length+" selected images; the chosen model allows "+imageLimit+". Exclude optional references or choose a higher-capacity model."});
  if(creditInfo.empty) blockers.push(creditInfo.ownerPays ? { key:"credits", text:stageCreditShortText(creditInfo) }   // the owner raises it — no Plans
    : { key:"credits",
    text:"Not enough generation credits — this render needs "+totalCost.toLocaleString("en-US")+(creditInfo.known?(", "+Number(creditInfo.remaining).toLocaleString("en-US")+" remaining"):"")+".",
    actionLabel:"Choose a plan", action:()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); } });
  if(!prompt.trim()) blockers.push({ key:"prompt", text:"Write a prompt — describe the motion you want." });
  const blocker = blockers[0] || null;
  const textOnlyRecoveryBlocked=null;
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
  const sdBarRef = React.useRef(null);
  // the "Add references" card lives in the reference strip (not the toolbar). Its
  // picker is position:fixed (measured from the card at open time, flipped upward
  // when the viewport has more room above, height-capped to the visible space) so
  // the strip's horizontal scroller and the scrolling centre column never clip it.
  const addRefRef = React.useRef(null);      // strip wrapper (card + picker) — clicks inside keep the menu open
  const addRefBtnRef = React.useRef(null);   // the card — focus returns here when the picker closes
  const addRefPopRef = React.useRef(null);   // the picker — first action receives focus on open
  const [addRefPos, setAddRefPos] = React.useState(null);
  const addRefOpen = sdMenu==="mention";
  const measureAddRef = (btn)=>{
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 6, edge = 8, minH = 140;
    const clamp = (v, lo, hi)=>Math.max(lo, Math.min(hi, v));
    const below = Math.max(0, vh - r.bottom - gap - edge), above = Math.max(0, r.top - gap - edge);
    const up = below < 260 && above > below;
    const width = Math.min(320, vw - edge*2);
    const left = Math.round(clamp(r.left, edge, Math.max(edge, vw - width - edge)));
    // anchor edge clamped into the viewport (a card scrolled half out of view still
    // gets an on-screen picker), then the height cap from the clamped anchor
    const pos = { left, width, offscreen: r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw };
    if(up){ pos.bottom = Math.round(clamp(vh - r.top + gap, edge, Math.max(edge, vh - edge - minH))); pos.maxH = Math.max(minH, Math.min(560, vh - pos.bottom - edge)); }
    else { pos.top = Math.round(clamp(r.bottom + gap, edge, Math.max(edge, vh - edge - minH))); pos.maxH = Math.max(minH, Math.min(560, vh - pos.top - edge)); }
    return pos;
  };
  const toggleAddRef = (e)=>{
    e.stopPropagation();
    if(addRefOpen){ setSdMenu(null); return; }
    setAddRefPos(measureAddRef(e.currentTarget));
    setSdMenu("mention");
  };
  React.useEffect(()=>{
    if(!sdMenu) return;
    const close = (e)=>{
      if(sdBarRef.current && sdBarRef.current.contains(e.target)) return;
      if(addRefRef.current && addRefRef.current.contains(e.target)) return;
      // option rows, the header card's Change and the media pickers each own an
      // anchor (pill + popover); a press inside any of them is not "outside"
      if(e.target && e.target.closest && e.target.closest(".sdbar-anchor")) return;
      setSdMenu(null); };
    const esc = (e)=>{ if(e.key==="Escape") setSdMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return ()=>{ document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [sdMenu]);
  React.useEffect(()=>{
    // the fixed picker does not move with its card: when anything else scrolls or the
    // window resizes it is re-measured against the card (one pass per frame) and
    // closes only once the card itself has left the viewport
    if(!addRefOpen) return;
    let raf = 0;
    const follow = ()=>{
      if(raf) return;
      raf = requestAnimationFrame(()=>{ raf = 0;
        const btn = addRefBtnRef.current; if(!btn) return;
        const pos = measureAddRef(btn);
        if(pos.offscreen) setSdMenu(null); else setAddRefPos(pos); });
    };
    const onScroll = (e)=>{ if(addRefPopRef.current && e.target && e.target.nodeType===1 && addRefPopRef.current.contains(e.target)) return; follow(); };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", follow);
    return ()=>{ if(raf) cancelAnimationFrame(raf); document.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", follow); };
  }, [addRefOpen]);
  const addRefWasOpen = React.useRef(false);
  React.useEffect(()=>{
    // focus enters the picker on open; when it closes and focus was lost with the
    // unmounted picker (Escape / picked option), it returns to the card. A mention
    // pick then hands focus on to the prompt editor (insertToolbarMention).
    if(addRefOpen){
      addRefWasOpen.current = true;
      const first = addRefPopRef.current && addRefPopRef.current.querySelector(".sdbar-mention-list button, .sdbar-addbox button");
      if(first){ try{ first.focus({preventScroll:true}); }catch(_e){} }
      return;
    }
    if(!addRefWasOpen.current) return;
    addRefWasOpen.current = false;
    const ae = document.activeElement;
    if((!ae || ae===document.body) && addRefBtnRef.current){ try{ addRefBtnRef.current.focus({preventScroll:true}); }catch(_e){} }
  }, [addRefOpen]);
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
  // The prompt is always written in the researched director's-brief grammar (the
  // former PROMPT STYLE menu was removed from the composer bar); promptStyle stays
  // "auto", so effPromptStyle is null and every rebuild goes through recipeText(recipe).
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
  const durationMin = Math.max(1, Math.ceil(durationFloorSec||1));
  const durationMax = Math.max(durationMin, model.maxClipSec||15);
  // ---- MODEL menu (opened by the first inline composer pill) -------------------
  const modelMenu = _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
    SEEDANCE_MODELS.map(m=>{
      const planLocked = m.status==="active" && !planAllowsModel(m.id);
      return sdOption({ id:m.id, label:m.label, selected:modelId===m.id, disabled:m.status!=="active",
        desc:m.bestFor, note:m.status!=="active" ? m.note : (planLocked ? "Director plan required" : ""),
        onPick:()=>{ if(planLocked){ openPlansUpsell(); return; }
          setModelId(m.id);
          const t0=seedanceTierOf(m,tier); if(t0) setTier(t0.id); } });
    }));
  // ---- composer bar: ONE line of inline chips at the foot of the card (model,
  // aspect, resolution, duration, sound, bitrate) with Generate at the
  // right end, taller than the chips. Every tab assembles its own bar from these
  // parts; references are added from the strip's card or by typing @ in the prompt.
  const soundOn = hasDialogue ? true : nativeAudio;   // generate_audio as the payload sends it
  const composerBar = (chips, tail, o)=>_stEl("div",{ref:o&&o.barRef,className:"sdbar inline"+(o&&o.cls?" "+o.cls:""),onMouseDown:e=>e.stopPropagation()},
    _stEl("div",{className:"sdbar-left"}, ...chips.filter(Boolean)),
    _stEl("div",{className:"sdbar-right"}, ...tail.filter(Boolean)));
  // a speaker (on) or crossed speaker (off) with a short On/Off word; the title says why
  const soundChip = (on, o)=>_stEl("button",{type:"button",className:"sdbar-chip sound"+(on?" on":""),
      "aria-pressed":on?"true":"false", "aria-label":"Sound "+(on?"on":"off"), disabled:!!o.disabled, title:o.title, onClick:o.onClick},
    _stEl(on ? Icon.volume : Icon.volumeX, {s:14}), _stEl("span",null, on?"On":"Off"));
  const createSoundChip = soundChip(soundOn, { disabled:hasDialogue,
    title:hasDialogue ? "Sound stays on — this beat has dialogue, so the audio track carries the performance"
      : (nativeAudio ? "Sound on — the model renders ambience, effects and music. Click to render silent." : "Silent render — click to turn native sound on."),
    onClick:()=>{ if(hasDialogue) return; setNativeAudio(v=>!v); } });
  const promptCount = (text)=>_stEl("span",{className:"sdbar-count",title:"Prompt length"}, String(text||"").length+" / "+PANEL_PROMPT_MAX);
  // a fixed, non-interactive chip ("Auto" values the task dictates)
  const fixedPill = (title, body)=>_stEl("div",{className:"sdbar-anchor"},
    _stEl("button",{type:"button",className:"sdbar-pill inline",disabled:true,title}, body));
  const durationPill = sdPill("duration","inline","Duration",
    _stEl(React.Fragment,null, Icon.clock&&_stEl(Icon.clock,{s:14}), _stEl("span",null,_fmtSecs(duration))),
    _stEl("div",{className:"sdbar-pop sdbar-pop-duration"},
      _stEl("label",null,"Total duration"),
      _stEl("input",{type:"range",min:durationMin,max:durationMax,step:1,value:Math.round(duration),
        title:durationFloorIsPlan ? "Minimum "+_fmtSecs(planFloorSec)+" — this clip's speech and action time"
          : durationLocked ? "Minimum locked to voiced line timing" : "Clip duration",
        onChange:e=>{ const v=Number(e.target.value); setDurationOverride(v===autoDurationSec ? null : v); }}),
      _stEl("div",{className:"sdbar-duration-row"}, _stEl("span",null,"0"), _stEl("span",null,"5"), _stEl("span",null,"10"), _stEl("span",null,String(durationMax))),
      _stEl("b",null,_fmtSecs(duration)),
      durationFloorIsPlan && _stEl("small",{className:"sdbar-duration-min"},
        "Minimum "+_fmtSecs(planFloorSec)+" — this clip's speech and action time.")));
  const aspectPill = sdPill("aspect","inline","Aspect ratio",
    _stEl(React.Fragment,null, Icon.monitor&&_stEl(Icon.monitor,{s:14}), _stEl("span",null,effAspect)),
    _stEl("div",{className:"sdbar-pop sdbar-pop-format"},
      _stEl("label",null,"Aspect ratio"),
      _stEl("div",{className:"sdbar-grid six"},
        ["21:9","16:9","4:3","1:1","3:4","9:16"].map(a=>_stEl("button",{key:a,type:"button",className:a===effAspect?"on":"",
          onClick:()=>{ setAspectOverride(a); setSdMenu(null); }}, _stEl("span",{className:"sdbar-ratio-ico ratio-"+a.replace(":","x")}), a)))));
  const resolutionPill = sdPill("format","inline","Resolution",
    _stEl(React.Fragment,null, Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), _stEl("span",null,String(resolution).toUpperCase())),
    _stEl("div",{className:"sdbar-pop sdbar-pop-format"},
      _stEl("label",null,"Resolution"),
      _stEl("div",{className:"sdbar-grid three"},
        STAGE_RESOLUTIONS.map(r=>{
          const serverPending=!stageServerResolutionAllowed(modelId,r,runtimeCaps,capabilityTarget);
          const planLocked = stageResAllowed(tierObj, r) && !serverPending && !planAllowsRes(r);
          const disabled = !stageResAllowed(tierObj, r)||serverPending;
          return _stEl("button",{key:r,type:"button",className:(r===resolution?"on ":"")+(planLocked?"plan-locked":""),
            disabled:disabled && !planLocked,
            title:serverPending ? "Not available yet — waiting on a server update"
              : planLocked ? planResNote(r)+" — click to upgrade" : (disabled ? (r+" isn't available on "+model.label) : r),
            onClick:()=>{ if(planLocked){ openPlansUpsell(); return; } if(disabled) return; setResolution(r); setSdMenu(null); }},
            String(r).toUpperCase(), (r==="1080p"||r==="4K") && Icon.sparkles&&_stEl(Icon.sparkles,{s:10}));
        }))));
  const bitratePill = sdPill("bitrate","inline","Bitrate — compression of the delivered file (not price)",
    _stEl(React.Fragment,null, _stEl("span",{className:"sdrow-label"},"Bitrate"),
      _stEl("span",{className:"sdrow-badge"}, Icon.sparkles&&_stEl(Icon.sparkles,{s:10}), bitrate==="high"?"High":"Standard")),
    _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
      [ {id:"standard",label:"Standard",desc:"More compression, smaller file — the usual draft choice."},
        {id:"high",label:"High",desc:"Less compression, larger file — for finals and grading."} ]
        .map(o=>sdOption({ ...o, selected:bitrate===o.id, onPick:()=>setBitrate(o.id) }))));
  const modelPill = sdPill("model","inline","Video model",
    _stEl(React.Fragment,null, Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), _stEl("span",null,model.label)),
    modelMenu);
  // ---- header card ("GENERAL / <model>") --------------------------------------
  // the still + shade live in their own clipped layer so the card itself can stay
  // overflow-visible for any optional header action
  const heroCard = (kicker, title, opts)=>_stEl("div",{className:"stage2-hero"+(shotStartFrame?" has-bg":"")+(opts&&opts.cls?" "+opts.cls:"")},
    shotStartFrame && _stEl("div",{className:"stage2-hero-media","aria-hidden":"true"},
      _stEl("div",{className:"stage2-hero-bg",style:{backgroundImage:"url("+JSON.stringify(shotStartFrame)+")"}}),
      _stEl("div",{className:"stage2-hero-shade"})),
    _stEl("div",{className:"stage2-hero-text"},
      _stEl("span",{className:"stage2-hero-kicker"},kicker),
      _stEl("span",{className:"stage2-hero-title"},title),
      opts&&opts.sub && _stEl("span",{className:"stage2-hero-sub"},opts.sub)),
    opts&&opts.action && _stEl("div",{className:"stage2-hero-action"}, opts.action));
  // ---- Generate (right end of the composer bar, price on the button) ----------
  const generateButton = (label, cost, onClick, o)=>{
    o=o||{};
    const disabled = !!o.disabled || gening;
    return _stEl("button",{type:"button",className:"stage2-generate"+(o.blocked?" blocked":"")+(gening?" working":""),
      title:o.title||"", "aria-disabled":o.blocked?"true":undefined, disabled,
      "data-testid":o.testId||undefined,
      onClick},
      _stEl("span",{className:"stage2-generate-label"}, gening ? (genBusyLabel||"Rendering…") : label),
      cost!=null && _stEl("span",{className:"stage2-generate-cost",title:o.costTitle||""}, Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), String(cost)));
  };
  // ---- "Add references" card — the FIRST tile of the reference strip (same 72×48
  // rectangle as the thumbnails). Opens the scene-reference picker: mention any
  // ready image / video / audio reference in the prompt with its @tag, or upload.
  const addReferencesCard = _stEl("button",{type:"button",ref:addRefBtnRef,
      className:"stage2-gen-add"+(addRefOpen?" open":""),
      title:"Add references — Image, Video or Audio. Mention this scene's references in the prompt with @",
      "aria-label":"Add references — Image, Video or Audio",
      "aria-haspopup":"dialog","aria-expanded":addRefOpen?"true":"false",
      "aria-controls":addRefOpen?"stage2-add-ref-picker":undefined,
      onClick:toggleAddRef},
    _stEl("span",{className:"stage2-gen-add-icons","aria-hidden":"true"},
      _stEl("span",{className:"stage2-gen-add-ico"}, Icon.image&&_stEl(Icon.image,{s:10,sw:2})),
      _stEl("span",{className:"stage2-gen-add-ico"}, Icon.video&&_stEl(Icon.video,{s:10,sw:2})),
      _stEl("span",{className:"stage2-gen-add-ico"}, Icon.music&&_stEl(Icon.music,{s:10,sw:2}))),
    _stEl("span",{className:"stage2-gen-add-label"},"Add references"),
    _stEl("span",{className:"stage2-gen-add-sub"},"Image, Video or Audio"));
  const addReferencesPopover = addRefOpen && addRefPos && _stEl("div",{ref:addRefPopRef,id:"stage2-add-ref-picker",
      className:"sdbar-pop sdbar-pop-mention stage2-gen-add-pop",role:"dialog","aria-label":"Add references",
      style:{left:addRefPos.left+"px",width:addRefPos.width+"px",maxHeight:addRefPos.maxH+"px",
        top:addRefPos.top!=null?addRefPos.top+"px":"auto",bottom:addRefPos.bottom!=null?addRefPos.bottom+"px":"auto"}},
    _stEl("label",null,'Add references — use "@" to mention'),
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
    // (the old "Upload from device" here only showed a message — new references are made in the
    //  Art Room; the note says so instead of a button that does nothing, 2026-10-05)
    _stEl("div",{className:"sdbar-addbox sdbar-addnote"},"New references are made in the Art Room (Characters, Props, Locations)."));
  // ---- composer header: Create Video | Edit Video | Motion Control tabs -------
  const TABS = [["create","Create Video","Create a clip for this beat from references, or extend an existing take (Seedance 2.5)"],
                ["edit","Edit Video","Rewrite an existing video with a prompt — Seedance 2.5 Edit"],
                ["motion","Motion Control","Drive a character image with a motion video — Kling 3.0 Motion Control"]];
  const composerHeader = _stEl("div",{className:"stage2-ctab-head"},
    _stEl("div",{className:"stage2-ctab-row"},
      _stEl("div",{className:"stage2-ctab-tabs",role:"tablist","aria-label":"Composer mode"},
        TABS.map(([t,lab,tip])=>
          _stEl("button",{key:t,type:"button",role:"tab","aria-selected":composerTab===t?"true":"false",
            className:"stage2-ctab-btn"+(composerTab===t?" on":""), title:tip, "data-tab":t,
            onClick:()=>{ setComposerTab(t); setSdMenu(null); setModeErr(""); }},lab)))));
  // the shared reference strip (Add references card + thumbnails)
  const referenceStrip =
    _stEl("div",{className:"stage2-gen-reference-row","aria-label":"Render references"},
      _stEl("div",{ref:addRefRef,className:"stage2-gen-strip"},
      _stEl("div",{className:"stage2-gen-assets"},
        addReferencesCard,
        composerAssets.map(a=>_stEl("button",{key:a.key,type:"button",
          className:"stage2-gen-asset "+a.kind+(a.locked?" locked":"")+(on(a)?"":" off")+(!a.ready?" missing":"")+(canRetryImg(a)?" retryable":""),
          title:assetTitle(a)+(thumbnailLabel(a)?(" · "+thumbnailLabel(a)+(canRetryImg(a)?" · Click to reload this image (no generation)":"")):""),
          "data-reference-kind":a.referenceKind||undefined,"data-asset-id":a.id||undefined,
          "data-thumbnail-state":thumbnailState(a)||undefined,
          "aria-pressed":a.kind!=="text"&&a.ready&&!a.locked?(on(a)?"true":"false"):undefined,
          "aria-busy":thumbnailState(a)==="loading"?"true":undefined,
          onClick:()=>canRetryImg(a)?retryImg(a,true):thumbnailState(a)==="loading"?null
            :toggle(a)},
          a.kind==="text" ? _stEl("span",{className:"stage2-gen-asset-text"},"T")
          : a.kind==="audio" ? _stEl("span",{className:"stage2-gen-asset-icon"},Icon.mic&&_stEl(Icon.mic,{s:14}))
          : (a.url && !imgFailed(a)) ? (a.kind==="video"
              ? _stEl("video",{src:a.url,muted:true,playsInline:true,preload:"metadata"})
              : _stEl("img",{src:a.url,alt:a.referenceKind==="screenplay"?a.label:"",loading:"lazy",
                  onError:()=>noteImgFail(a)}))
          : _stEl("span",{className:"stage2-gen-asset-ph"+(a.ready?"":" miss")},
              a.kind==="image" ? _stEl("strong",null,thumbnailLabel(a))
                : a.kind==="video" ? (Icon.play&&_stEl(Icon.play,{s:14})) : (Icon.image&&_stEl(Icon.image,{s:14})),
              _stEl("small",null,a.label)),
          a.kind==="audio"&&a.url&&_stEl("span",{className:"stage2-gen-asset-max",role:"button","aria-label":"Play voice line",title:"Play "+a.label,
            onClick:(e)=>{e.stopPropagation();e.preventDefault();_stagePlayAudio(a.url);}},
            Icon.play&&_stEl(Icon.play,{s:10})),
          (a.url && !imgFailed(a) && (a.kind==="image"||a.kind==="video")) && _stEl("span",{className:"stage2-gen-asset-max",role:"button","aria-label":"Maximise",title:"Maximise "+a.label,
            onClick:(e)=>{ e.stopPropagation(); e.preventDefault(); setMaxImg({url:a.url, label:a.label, kind:a.kind}); }},
            Icon.maximize&&_stEl(Icon.maximize,{s:10})),
          a.kind!=="text" && a.ready && _stEl("span",{className:"stage2-gen-asset-tag",title:on(a)?("Reference this asset in the prompt as "+stageAssetMention(a)):"Excluded from this render"},
            !on(a)?"Off":a.referenceKind==="screenplay"?stageAssetMention(a):stageAssetTagShort(a)),
          on(a) && _stEl("span",{className:"stage2-gen-asset-check"},Icon.check&&_stEl(Icon.check,{s:10}))))),
      addReferencesPopover));
  const characterChoicesEl =
    modelRefs&&characterReferenceActionChoices.length>0&&_stEl("div",{className:"stage2-character-choices","aria-label":"Shot-only video character reference choices"},
      // A single missing state already owns the primary blocker and its one-click
      // bulk action. Do not repeat the same warning immediately above it; retain
      // grouped controls only when several independent missing characters need
      // separate choices.
      characterReferenceBulk.filter(g=>g!==bulkChoice).map(g=>_stEl("div",{key:"bulk:"+g.c.id,className:"stage2-character-bulk","data-character-id":g.c.id},
        _stEl("span",null,
          _stEl("b",null,g.c.name+" · "+g.stateLabel+" has no generated sheet"),
          _stEl("small",null,(g.suggested?"Suggested from the script; it was never generated. ":"")
            +"Generate it in Art Room → Characters → "+g.c.name+" → Continuity · appearance states, or render "
            +g.shotsLabel+" with the existing master image — one persisted, per-shot video choice you can undo below.")),
        _stEl("button",{type:"button","data-bulk-choice":"master",
          disabled:!canBulkCharacterReference||!g.masterReady,
          title:readOnly?"View-only access — changing a shot reference requires edit access"
            :!g.masterReady?"The master image must be loaded and shareable before it can be chosen"
            :"Use the existing master image for "+g.shotsLabel+" of this clip's video only. Other shots, appearance states and generated images stay unchanged.",
          onClick:()=>applyCharacterReferenceBulk(g)},
          "Use master for "+g.shotsLabel))),
      characterReferenceActionChoices.map(row=>_stEl("div",{key:row.sh.id+":"+row.c.id,
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
          row.hasOverride?"Use scene appearance":"Use master for this shot"))));
    // (the recipe TAB row is gone — user ruling 2026-08-02: ONE derived prompt.
    // The smart per-clip pick assembles screenplay text + Art Room cinematography;
    // the Multi-shot row editor below surfaces automatically when the pick lands on it.)
    // MULTI-SHOT editor — structured rows over the ACTIVE BEAT's shots
    // (one beat at a time, matching the clip the console is pointed at): a duration
    // stepper + a video-only description per shot + an include checkbox. Edits
    // persist on the shot (vidText/dur), feed EVERY recipe, and recompile the prompt
    // live. The canon Action (image side) is never touched; shots are added on the Shots tab.
  const multishotEditor =
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
            included && edited && !readOnly && _stEl("button",{type:"button",className:"stage2-ms-reset",
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
            maxLength:500,mentionables,onMentionPick:includeMention,readOnly,ariaLabel:"Shot "+(i+1)+" video description",
            // a view-only Stage never writes the shot (2026-10-09 — it wrote on every keystroke)
            setValue:(v)=>{ if(!onUpdateShot || readOnly) return;
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
            onClick:()=>setClipScope&&setClipScope("beat")},"Split to fit"));
      })(),
      _stEl("div",{className:"stage2-ms-hint"},"One row = one shot. Edit the text freely — it shapes the video prompt only; Generate renders these rows as one continuous Seedance clip. (Add or remove shots on the Art Room's Shots tab.)"));
  const promptRowWith = (bar)=>
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
          onClick:()=>{ promptEditedRef.current=false; delete promptDraftsRef.current[promptDraftKey]; setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false); setPromptDriftConfirmed(""); setPrompt(beatPrompt); }},
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
                  m.kind==="video" ? (Icon.film&&_stEl(Icon.film,{s:14})) : (Icon.mic&&_stEl(Icon.mic,{s:14}))),
            _stEl("span",{className:"stage2-mention-main"},
              _stEl("b",null,m.t), m.label && _stEl("span",{className:"stage2-mention-label"},m.label)),
            _stEl("span",{className:"stage2-mention-kind"},
              m.included?"Included":(m.group|| (m.kind==="image"?"Image":m.kind==="video"?"Video":"Audio"))))))),
      bar));
      // (stopping the wait on an in-flight render lives in the Render settings panel — "Stop";
      //  the REFERENCES-added-at-render preview lives in the panel's Inputs tab)
  // beat-level coverage is a review notice, never a blocker: the beat renders whole
  const coverageNotice=(d.screenplayDirectionIssues||[]).find(x=>x&&!x.blocking&&x.code==="screenplay-coverage-beat-level");
  const readinessNotice = readiness.issues.length>0 && _stEl("div",{key:"readiness",className:"stage2-warn stage2-readiness","data-testid":"stage-clip-readiness"},
    Icon.alert&&_stEl(Icon.alert,{s:12}),
    _stEl("span",{className:"stage2-warn-text"}, "Inputs not ready: "+readiness.text+"."+(needsShown ? " Making "+needsShown.i+" of "+needsShown.total+"\u2026" : "")),
    (onMakeSceneNeeds && !readOnly && makeableNeeds.length>0) && _stEl("button",{type:"button",className:"stage2-warn-act",disabled:!!needsRun||!!needsApp||gening,onClick:makeClipNeeds,
        title: needsApp && !needsShown ? "Another scene is making its images \u2014 one at a time."
          : "Make the "+needsImages+" missing reference image"+(needsImages!==1?"s":"")+" this clip's shots use"},
      needsShown ? "Making\u2026" : "Make what this clip needs",
      !needsShown && needsImages>0 && typeof window.nbCostChip==="function" && window.nbCostChip(needsImages)),
    (onStageNav && (readiness.frames.missing||readiness.frames.unapproved||readiness.frames.stale||readiness.frames.oldLook)>0)
      // a role that can't change the Art Room (a Stage editor) is told who can, instead of being sent to a read-only
      // room (2026-10-09, Stage editor review)
      && (stageArtWritable()
        ? _stEl("button",{type:"button",className:"stage2-warn-act",onClick:()=>onStageNav("shots", scene.id)},"Open in Shots")
        : _stEl("span",{className:"stage2-warn-text"}," The film's owner or Art director can fix the frames in Shots.")));
  const takeStaleNotice = takeStale && _stEl("div",{key:"take-stale",className:"stage2-warn"},
    Icon.alert&&_stEl(Icon.alert,{s:12}),
    _stEl("span",{className:"stage2-warn-text"}, takeIdentity
      ? "The take in the player finished after a character's identity changed \u2014 the Timeline and the export leave it out until you check it in Takes (\u201cCheck and use this take\u201d)."
      : "The take in the player is out of date \u2014 this clip's shots changed since it was rendered, so the Timeline and the export leave it out until you regenerate."));
  // a note, not a block (2026-10-05, owner — Color review): the take stays in the film
  const takeOldLookNotice = !takeStale && takeOldLook && _stEl("div",{key:"take-old-look",className:"stage2-hint"},
    Icon.info&&_stEl(Icon.info,{s:12}),
    _stEl("span",null, "The take in the player was made with an earlier look \u2014 this scene's look or the film stock changed on the Color tab since. It stays in the film; regenerate to apply the new look."));
  // before rendering: a real person's likeness in the cast (owner — Likeness review)
  const likenessNotice = clipHasLikeness && _stEl("div",{key:"likeness",className:"stage2-hint stage2-likeness-note","data-testid":"stage-likeness-note"},
    Icon.info&&_stEl(Icon.info,{s:12}), _stEl("span",null, STAGE_LIKENESS_NOTE));
  const composerNotices =
    (blocker || genErr || soundCueMissing || !modelRefs || coverageNotice || readinessNotice || takeStaleNotice || takeOldLookNotice || likenessNotice
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
      (promptOtherGrouping && promptEditedRef.current && !promptSourceDrift) && _stEl("div",{className:"stage2-warn","data-testid":"stage-prompt-other-shots"},
        Icon.info&&_stEl(Icon.info,{s:12}),
        _stEl("span",{className:"stage2-warn-text"},"Your edited prompt was kept from when this clip held a different set of shots \u2014 check it describes this clip's shots, or Reset to script.")),
      orphanTakes.length>0 && _stEl("div",{className:"stage2-warn","data-testid":"stage-orphan-takes"},
        Icon.info&&_stEl(Icon.info,{s:12}),
        _stEl("span",{className:"stage2-warn-text"}, (()=>{ const n=orphanTakes.reduce((t,o)=>t+(o.takes||0),0);
          return n+" take"+(n!==1?"s":"")+" from an earlier grouping of these shots"+(orphanTakes.some(o=>o.approved)?" (one approved)":"")
            +" \u2014 the clip's shots changed since, so "+(n!==1?"they're":"it's")+" not in its takes."; })()),
        !readOnly && _stEl("button",{type:"button",className:"stage2-warn-act",onClick:adoptOrphans},"Bring them into this clip")),
      (pendingN>0 && !gening && !(gen.err && gen.err.stillPending)) && _stEl("div",{className:"stage2-warn","data-testid":"stage-pending-on-server",role:"status"},
        Icon.info&&_stEl(Icon.info,{s:12}),
        _stEl("span",{className:"stage2-warn-text"},"A render of this clip is still running on the server \u2014 it's saved to this clip's takes when it finishes, so there's no need to render it again.")),
      genErr && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
        _stEl("span",{className:"stage2-warn-text"},genNotice),
        canTextOnlyRecovery && _stEl("button",{type:"button",className:"stage2-warn-act",
          disabled:gening||creditInfo.empty||!!textOnlyRecoveryBlocked,
          title:textOnlyRecoveryBlocked?(textOnlyRecoveryBlocked.text||"Review the remaining render blocker first."):textOnlyRecoveryTitle,
          onClick:()=>onGenerate({referenceFree:true})},
          "Retry from text only · "+textOnlyTotal.toLocaleString("en-US")+" credit"+(textOnlyTotal===1?"":"s"))),
      genErr && providerPolicyFailure && providerPolicyDetail && _stEl("details",{
          className:"stage2-policy-details"},
        _stEl("summary",null,"Provider details"),
        _stEl("div",{className:"stage2-policy-detail-copy"},providerPolicyDetail),
        gen.err.errorCode && _stEl("small",null,"Code: "+String(gen.err.errorCode))),
      genErr && textOnlyPolicyFailure && clipHasLikeness && _stEl("div",{
          className:"stage2-hint stage2-policy-note","data-testid":"stage-likeness-policy-note"},
        Icon.info&&_stEl(Icon.info,{s:12}),
        _stEl("span",{className:"stage2-policy-note-copy"},
          "That attempt sent no images, video or recorded voice. This clip's cast includes a real person's likeness, so a note calling the characters invented isn't offered \u2014 video engines may refuse a real likeness.")),
      genErr && textOnlyPolicyFailure && !clipHasLikeness && _stEl("div",{
          className:"stage2-hint stage2-policy-note"},
        Icon.info&&_stEl(Icon.info,{s:12}),
        _stEl("span",{className:"stage2-policy-note-copy"},
          "That attempt sent no images, video or recorded voice. The provider's image/video wording is generic for this request, so repeating the same paid text-only retry would not isolate anything else. Add a factual fictional-context note to the editable render prompt, review it, then choose Generate only if you want a new render."),
        _stEl("button",{type:"button",className:"stage2-hint-act",disabled:readOnly||gening||fictionalPolicyContextPresent,
          title:readOnly?"This shared film is read-only":fictionalPolicyContextPresent?"The editable render prompt already contains a fictional-context note":"Add context to the render prompt only — does not edit the screenplay or submit a render",
          onClick:addFictionalPolicyContext},fictionalPolicyContextPresent?"Context added":"Add fictional context")),
      genErr && canTextOnlyRecovery && textOnlyRecoveryBlocked && _stEl("div",{
          className:"stage2-hint stage2-text-only-note"},
        Icon.info&&_stEl(Icon.info,{s:12}), textOnlyRecoveryBlocked.text),
      // the clip's own status follows what stops it or what just failed (a failed render reads first)
      readinessNotice, takeStaleNotice, takeOldLookNotice, likenessNotice,
      coverageNotice && _stEl("div",{className:"stage2-hint stage2-coverage-note","data-code":coverageNotice.code}, Icon.info&&_stEl(Icon.info,{s:12}), coverageNotice.message),
      soundCueMissing && _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}), "Native audio is on but the prompt has no sound direction — name the sounds you want (ambience, effects, music) or the soundtrack comes out generic."),
      hasDialogue && !modelAudioRefs && _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}),
        model.label+" performs the dialogue ITSELF from the prompt (native synced voices) — the locked character voices don't ride along on this model. Switch to Seedance for voice-locked lip-sync."),
      hasDialogue && modelAudioRefs && dialogueAudio==="native" && (hasUnassignedClipDialogue
        ? _stEl("div",{className:"stage2-dialogue-assign-wrap"},
            _stEl("div",{className:"stage2-hint stage2-dialogue-assign-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}),
              _stEl("span",{className:"stage2-dialogue-assign-copy"},
                "Complete-beat dialogue is being performed natively because its screenplay lines have no shot timing yet. Assign each line to a shot here to enable locked voices and exact Mix placement."),
              _stEl("button",{type:"button",className:"stage2-hint-act",disabled:readOnly||gening||!onUpdateShot,
                title:readOnly?"This shared film is read-only":gening?"Wait for this render to finish":"Assign every screenplay line to an authored shot",
                onClick:()=>dialogueAssignOpen?setDialogueAssignOpen(false):openDialogueAssignments()},
                dialogueAssignOpen?"Close":"Assign lines")),
            dialogueAssignOpen && _stEl("div",{className:"stage2-dialogue-assign-panel"},
              _stEl("div",{className:"stage2-dialogue-assign-head"},
                _stEl("div",null,_stEl("b",null,"Place screenplay dialogue"),
                  _stEl("small",null,"One timed locked-voice line per shot. Nothing is guessed or rewritten.")),
                _stEl("span",null,dialogueAssignmentRows.length+" line"+(dialogueAssignmentRows.length===1?"":"s"))),
              dialogueAssignmentRows.map((x,i)=>{
                const choices=dialogueAssignableShots.filter(sh=>Number(sh.beatN)===Number(x.beatN));
                return _stEl("label",{key:x.key,className:"stage2-dialogue-assign-row"},
                  _stEl("span",{className:"stage2-dialogue-line"},
                    _stEl("b",null,String(x.row&&x.row.speaker||"Speaker")),
                    _stEl("span",null,"“"+String(x.row&&x.row.text||"")+"”")),
                  _stEl("select",{value:dialogueAssignments[x.key]||"","aria-label":"Shot for "+String(x.row&&x.row.speaker||"dialogue line"),
                    onChange:e=>{const value=e.target.value;setDialogueAssignError("");setDialogueAssignments(a=>({...a,[x.key]:value}));}},
                    _stEl("option",{value:""},"Choose shot…"),
                    choices.map(sh=>{
                      const shotN=(d.shots||[]).findIndex(v=>v&&v.id===sh.id)+1;
                      const used=assignedShotIds.includes(String(sh.id))&&dialogueAssignments[x.key]!==String(sh.id);
                      return _stEl("option",{key:sh.id,value:sh.id,disabled:used},
                        "Shot "+shotN+" · "+_firstWords(sh.action||sh.purpose||"Untitled shot",7));
                    }))); }),
              !dialogueAssignmentCapacity && _stEl("div",{className:"stage2-dialogue-assign-cap"},
                "This beat needs at least one unassigned shot per line for timed lip-sync.",
                onStageNav&&(stageArtWritable()
                  ? _stEl("button",{type:"button",onClick:()=>onStageNav("shots")},"Add or split shots")
                  : _stEl("span",null," Ask the film's owner or Art director to add or split shots."))),
              dialogueAssignError && _stEl("div",{className:"stage2-dialogue-assign-error",role:"alert"},dialogueAssignError),
              _stEl("div",{className:"stage2-dialogue-assign-foot"},
                _stEl("button",{type:"button",className:"stage2-dialogue-cancel",onClick:()=>{setDialogueAssignOpen(false);setDialogueAssignError("");}},"Cancel"),
                _stEl("button",{type:"button",className:"stage2-dialogue-save",disabled:!dialogueAssignmentsComplete||!dialogueAssignmentCapacity||readOnly||gening,onClick:saveDialogueAssignments},
                  "Save assignments"))))
        : _stEl("div",{className:"stage2-hint"}, Icon.mic&&_stEl(Icon.mic,{s:12}),
            "Native performance: the model acts the lines in its own voice with free, natural pacing. For the locked character voices and exact post-mix timing, choose Locked voice and render the line audio.")),
      !modelRefs && _stEl("div",{className:"stage2-hint"}, Icon.image&&_stEl(Icon.image,{s:12}),
        model.label+" takes ONE start image and cannot carry the required screenplay screenshots separately. Choose a reference-capable model before rendering."));
  // ---- media dropzones (Extend / Edit / Motion) ---------------------------------
  const imageChoices = tagged.filter(a=>a.kind==="image" && a.ready && a.url && a.referenceKind!=="screenplay")
    .map(a=>({ kind:"asset", id:String(a.key||a.id), url:a.url, ref:a.url, label:String(a.label||"Image"), asset:a }));
  const mediaZone = (slot, kind, media, o)=>{
    o=o||{};
    const busy = mediaBusy===slot;
    const choices = kind==="video" ? takeChoices : imageChoices;
    const picked = (c)=> !!media && media.kind===c.kind && media.url===c.url;
    return _stEl("div",{className:"stage2-dz"+(media?" filled":"")+(o.error?" bad":""),"data-slot":slot,"data-kind":kind},
      media
        ? _stEl("div",{className:"stage2-dz-preview"},
            kind==="video"
              ? _stEl("video",{className:"stage2-dz-media",src:media.url,muted:true,playsInline:true,preload:"metadata",controls:true})
              : _stEl("img",{className:"stage2-dz-media",src:media.url,alt:""}),
            _stEl("div",{className:"stage2-dz-meta"},
              _stEl("b",null,media.kind==="device" ? (media.name||"Device "+kind) : media.label),
              _stEl("small",null,[ media.kind==="device" ? "From this device · private to this render" : "From this clip",
                media.seconds ? _fmtSecs(Math.round(media.seconds)) : (media.measuring ? "measuring length…" : "") ].filter(Boolean).join(" · "))),
            _stEl("button",{type:"button",className:"stage2-dz-x",title:"Remove","aria-label":"Remove "+String(o.title||"this file"),onClick:()=>setMedia(slot,null)}, Icon.x&&_stEl(Icon.x,{s:12})))
        : _stEl("div",{className:"stage2-dz-empty"},
            _stEl("span",{className:"stage2-dz-ico"}, kind==="video" ? (Icon.film&&_stEl(Icon.film,{s:18})) : (Icon.userScan&&_stEl(Icon.userScan,{s:18}))),
            _stEl("b",null,o.title), _stEl("small",null,o.sub)),
      _stEl("div",{className:"stage2-dz-actions"},
        sdPill("media-"+slot,"dz",kind==="video" ? "Choose one of this clip's takes" : "Choose one of this clip's images",
          _stEl(React.Fragment,null, (kind==="video"?Icon.play:Icon.image)&&_stEl(kind==="video"?Icon.play:Icon.image,{s:12}),
            _stEl("span",null,kind==="video" ? "Clip takes" : "Clip images")),
          _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
            choices.length ? choices.map(c=>sdOption({ id:slot+":"+c.id, label:c.label, desc:c.seconds?_fmtSecs(Math.round(c.seconds)):"", selected:picked(c), onPick:()=>setMedia(slot,c) }))
              : _stEl("div",{className:"sdbar-option-empty"}, kind==="video" ? "No takes on this clip yet — generate one or upload a video." : "No images on this clip yet."))),
        _stEl("button",{type:"button",className:"stage2-dz-btn upload",disabled:busy||gening||readOnly,
          title: serverHasStaging ? ("Upload a "+kind+" from this device — staged privately for this render, never kept on the take") : (capsPending ? "Checking what the video service supports…" : PENDING_SERVER+" Device uploads need direct-to-storage staging."),
          onClick:()=>pickDevice(slot,kind)},
          busy ? "Uploading…" : "↑ Upload from device")),
      o.error && _stEl("div",{className:"stage2-dz-err"}, Icon.alert&&_stEl(Icon.alert,{s:12}), o.error),
      o.note && !o.error && _stEl("div",{className:"stage2-dz-note"}, o.note));
  };
  const modeErrEl = modeErr && _stEl("div",{className:"stage2-err sd-gen-err stage2-mode-err",role:"alert"}, Icon.alert&&_stEl(Icon.alert,{s:14}), modeErr);
  const pendingNote = (what)=> !capsPending && _stEl("div",{className:"stage2-mode-pending"}, Icon.info&&_stEl(Icon.info,{s:12}),
    what+" isn't available yet — it's waiting on a server update. Nothing is sent until it is.");
  const segmented = (label, value, options, onPick)=>_stEl("div",{className:"stage2-seg",role:"tablist","aria-label":label},
    options.map(o=>_stEl("button",{key:o.id,type:"button",role:"tab","aria-selected":value===o.id?"true":"false",
      className:"stage2-seg-btn"+(value===o.id?" on":"")+(o.disabled?" off":""), disabled:!!o.disabled, title:o.title||o.label,
      onClick:()=>{ if(o.disabled) return; onPick(o.id); }}, o.label)));
  // ---- CREATE VIDEO -------------------------------------------------------------
  const extendPlanLocked = !planAllowsModel("seedance-2.5");
  const pickCreateTask = (t)=>{
    setCreateTask(t); setSdMenu(null); setModeErr("");
    if(t==="extension"){
      if(!extendVideo && takeChoices[0]) setMedia("extend", takeChoices[0]);   // measured like any pick
      // extension is a Seedance 2.5 task: follow the plan gate, never a silent switch on a locked plan
      if(modelId!=="seedance-2.5" && !extendPlanLocked){ setModelId("seedance-2.5"); const t0=seedanceTierOf(sd25Model,"standard"); if(t0) setTier(t0.id); }
    }
  };
  const extendBlocker = createTask!=="extension" ? "" :
    extendPlanLocked ? "Extend Video runs on Seedance 2.5 — Director plan required."
    : modelId!=="seedance-2.5" ? "Extend Video runs on Seedance 2.5 — choose it as the model."
    : !extendVideo ? "Choose the video to extend."
    : mediaUnpriced(extendVideo) ? mediaUnpriced(extendVideo)
    : (!capsPending && !serverHasTask("extension")) ? PENDING_SERVER
    : modeCreditBlock(extendCost,"extension");   // every mode's Generate is blocked below what it needs (round 3)
  const createGenerate = createTask==="extension"
    ? generateButton("Extend", extendCost, ()=>{ if(gening) return; if(extendPlanLocked){ openPlansUpsell(); return; } onExtend(); },
        { blocked:!!extendBlocker, title:extendBlocker || extendCostTitle, costTitle:extendCostTitle, testId:"stage-generate-extend",
          disabled:(!capsPending && !serverHasTask("extension")) })
    : generateButton(playerUrl ? "Regenerate" : "Generate", totalCost, onSeedanceGenerateClick,
        { blocked:!!blocker, title: blocker ? (blocker.text+" (click to see why)") : renderCostTitle, costTitle:renderCostTitle, testId:"stage-generate" });
  const createBody = _stEl(React.Fragment,null,
    heroCard("VIDEO MODEL", model.label),
    segmented("Create mode", createTask,
      [ { id:"reference", label:"References", title:"Render this beat from its references" },
        { id:"extension", label:"Extend Video", title:"Continue an existing video (Seedance 2.5 extension task)" } ], pickCreateTask),
    createTask==="extension" && mediaZone("extend","video",extendVideo,{ title:"Add a video to extend (up to 30s)", sub:"One of this clip's takes, or a video from this device — it becomes @Video1",
      note: extendVideo ? "Seedance continues @Video1 by "+_fmtSecs(duration)+" in the video's own aspect ratio; the prompt below describes what happens next." : "" }),
    referenceStrip,
    createTask==="reference" && characterChoicesEl,
    createTask==="reference" && multishotEditor,
    promptRowWith(composerBar(
      [ modelPill,
        createTask==="extension"
          ? fixedPill("Extensions keep the source video's aspect ratio", _stEl(React.Fragment,null, Icon.monitor&&_stEl(Icon.monitor,{s:14}), _stEl("span",null,"Auto")))
          : aspectPill,
        resolutionPill, durationPill, createSoundChip, bitratePill ],
      [ promptCount(prompt), createGenerate ], { barRef:sdBarRef })),
    modeErrEl,
    composerNotices);
  // ---- EDIT VIDEO ---------------------------------------------------------------
  const editPromptRef = React.useRef(null);
  const insertEditMention = (m)=>{
    const tok=String(m&&m.t||"").trim(); if(!tok) return;
    const api=editPromptRef.current, cur=String(editPrompt||"");
    let pos = api && api.caretOffset ? api.caretOffset() : cur.length;
    if(!Number.isFinite(pos)) pos=cur.length; pos=Math.max(0,Math.min(cur.length,pos));
    const before=cur.slice(0,pos), after=cur.slice(pos);
    const next=(before+(before&&!/[\s([]$/.test(before)?" ":"")+tok+(after&&!/^[\s.,;:!?)]/.test(after)?" ":"")+after).slice(0,PANEL_PROMPT_MAX);
    setEditPrompt(next);
    requestAnimationFrame(()=>{ try{ api && api.applyValue && api.applyValue(next, next.length); }catch(_e){} });
  };
  const editBlocker = !editVideo ? "Add the video to edit."
    : mediaUnpriced(editVideo) ? mediaUnpriced(editVideo)
    : !String(editPrompt||"").trim() ? "Describe the edit."
    : extendPlanLocked ? "Seedance 2.5 Edit — Director plan required."
    : (!capsPending && !serverHasTask("editing")) ? PENDING_SERVER
    : modeHoldBlock(editHoldInfo,"edit");   // Generate is blocked when the balance can't cover the hold
  const editBody = _stEl(React.Fragment,null,
    heroCard("EDIT A VIDEO", "Seedance 2.5 Edit", { sub:"Rewrite a video from a prompt — same cast, new direction" }),
    mediaZone("edit","video",editVideo,{ title:"Add a video to edit (up to 30s)", sub:"One of this clip's takes, or a video from this device — it becomes @Video1" }),
    _stEl("div",{className:"stage2-dz-heading"}, Icon.image&&_stEl(Icon.image,{s:12}), "Add elements or references (up to 29 images or audio)"),
    referenceStrip,
    _stEl("div",{className:"stage2-gen-row"},
      _stEl("div",{className:"stage2-gen-box"},
        _stEl("div",{className:"stage2-gen-promptwrap"},
          _stEl(StageMentionEditor,{apiRef:editPromptRef, value:editPrompt, mentionables:editMentionables, includeMention:()=>true,
            maxLen:PANEL_PROMPT_MAX, placeholder:"Describe the edit — e.g. \"Replace the sky in @Video1 with a storm; keep the actors and camera\"…",
            onChange:(v)=>setEditPrompt(String(v||"")), onKeyDown:()=>{}})),
        // the model is fixed (Seedance 2.5 Edit — said in the header card), so the
        // bar carries only what the editing task lets you choose
        composerBar(
          [ sdPill("edit-elements","inline chip elements","Elements — insert a reference token at the cursor",
              _stEl(React.Fragment,null, _stEl("span",{className:"sdbar-chip-at"},"@"), _stEl("span",null,"Elements")),
              _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
                editMentionables.map(m=>sdOption({ id:m.t, label:m.t, desc:m.label, onPick:()=>insertEditMention(m) })))),
            soundChip(nativeAudio, { title:nativeAudio ? "Sound on — Seedance renders the edited video's audio. Click for a silent result." : "Silent result — click to render audio.",
              onClick:()=>setNativeAudio(v=>!v) }),
            resolutionPill,
            fixedPill("Edits keep the source video's length and aspect ratio", _stEl(React.Fragment,null, Icon.clock&&_stEl(Icon.clock,{s:14}), _stEl("span",null,"Length · Auto"))),
            bitratePill ],
          [ promptCount(editPrompt),
            generateButton("Generate", editCost, ()=>{ if(gening) return; if(extendPlanLocked){ openPlansUpsell(); return; } onEditVideo(); },
              { blocked:!!editBlocker, title:editBlocker||editCostTitle, costTitle:editCostTitle, testId:"stage-generate-edit",
                disabled:(!capsPending && !serverHasTask("editing")) }) ]))),
    (!capsPending && !serverHasTask("editing")) && pendingNote("Edit Video"),
    modeErrEl);
  // ---- MOTION CONTROL -----------------------------------------------------------
  const motionErr = motionTooLong ? ("This motion video is "+_fmtSecs(Math.round(motionVideo.seconds))+" — Kling allows up to "+motionLimits.maxSeconds+"s when "+(effMotionOrientation==="image"?"the scene follows the character image (switch scene control to Video, or turn it off, for up to 30s)":"the scene follows the motion video")+".")
    : motionTooShort ? ("This motion video is under "+motionLimits.minSeconds+"s — Kling needs at least "+motionLimits.minSeconds+"s of motion.") : "";
  const motionBlocker = !motionVideo ? "Add the motion to copy."
    : mediaUnpriced(motionVideo) ? mediaUnpriced(motionVideo)
    : !motionImage ? "Add your character image."
    : motionErr ? motionErr
    : (!motionCapsPending && !serverHasMotion) ? PENDING_SERVER
    : modeHoldBlock(motionHoldInfo,"motion render");   // Generate is blocked when the balance can't cover the hold
  const motionBody = _stEl(React.Fragment,null,
    heroCard("MOTION CONTROL", "Control motion with video references", { cls:"motion",
      action:_stEl("button",{type:"button",className:"stage2-hero-help"+(motionHelp?" on":""),"aria-expanded":motionHelp?"true":"false",
        onClick:()=>setMotionHelp(v=>!v)}, Icon.info&&_stEl(Icon.info,{s:12}), "How it works") }),
    motionHelp && _stEl("div",{className:"stage2-howto"},
      _stEl("b",null,"Kling 3.0 Motion Control"),
      _stEl("p",null,"Upload a video of someone moving and one image of your character with a visible face and body. Kling transfers the performance — pose, timing, gesture — onto your character. The result is as long as the motion video."),
      _stEl("p",null,"Scene control ON lets you choose where the background comes from: the character image (motion video up to 10s) or the motion video (up to 30s). Scene control OFF always follows the motion video's scene (up to 30s).")),
    _stEl("div",{className:"stage2-opt-grid two dz"},
      mediaZone("motion-video","video",motionVideo,{ title:"Add motion to copy ("+motionLimits.minSeconds+"–"+motionLimits.maxSeconds+"s)", sub:"A video of the movement to transfer", error:motionErr }),
      mediaZone("motion-image","image",motionImage,{ title:"Add your character", sub:"An image with a visible face and body" })),
    _stEl("div",{className:"stage2-gen-box motion"},
    _stEl("div",{className:"stage2-opts"},
      _stEl("div",{className:"stage2-switch-row"},
        _stEl("div",{className:"stage2-switch-text"},
          _stEl("b",null,"Scene control mode"),
          _stEl("small",null, sceneControl
            ? "Choose where the background should come from: the character image or the motion video."
            : "Off — the background follows the motion video (up to 30s of motion).")),
        _stEl("button",{type:"button",role:"switch","aria-checked":sceneControl?"true":"false",className:"stage2-switch"+(sceneControl?" on":""),
          title:sceneControl ? "Scene control on — click to follow the motion video's scene" : "Scene control off — click to choose the scene source",
          onClick:()=>setSceneControl(v=>!v)}, _stEl("span",{className:"stage2-switch-knob"}))),
      sceneControl && segmented("Scene source", motionOrientation,
        [ { id:"video", label:"Video", title:"Background from the motion video — motion up to 30s" },
          { id:"image", label:"Image", title:"Background from the character image — motion up to 10s" } ],
        (v)=>setMotionOrientation(v)),
      _stEl("button",{type:"button",className:"stage2-adv-toggle","aria-expanded":motionAdvanced?"true":"false",onClick:()=>setMotionAdvanced(v=>!v)},
        _stEl(motionAdvanced?Icon.chevU:Icon.chevD,{s:12}), "Advanced settings"),
      motionAdvanced && _stEl("div",{className:"stage2-adv"},
        _stEl("div",{className:"stage2-switch-row"},
          _stEl("div",{className:"stage2-switch-text"}, _stEl("b",null,"Keep original sound"), _stEl("small",null,"Carry the motion video's audio into the result.")),
          _stEl("button",{type:"button",role:"switch","aria-checked":keepOriginalSound?"true":"false",className:"stage2-switch"+(keepOriginalSound?" on":""),
            onClick:()=>setKeepOriginalSound(v=>!v)}, _stEl("span",{className:"stage2-switch-knob"}))),
        _stEl("label",{className:"sd-gen-label"},"Prompt (optional)"),
        _stEl("textarea",{className:"stage2-motion-prompt",value:motionPrompt,maxLength:2000,rows:3,
          placeholder:"Optional — e.g. \"cinematic lighting, keep the costume exactly as pictured\"",
          onChange:e=>setMotionPrompt(e.target.value)}))),
    // model + quality chips and Generate share the card's foot line
    composerBar(
      [ sdPill("motion-model","inline","Motion Control model",
          _stEl(React.Fragment,null, Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), _stEl("span",null,"Kling 3.0 · "+(motionTier==="pro"?"Pro":"Standard"))),
          _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
            [ {id:"standard",label:"Kling 3.0 Motion Control — Standard",desc:"720p-class output · the usual choice"},
              {id:"pro",label:"Kling 3.0 Motion Control — Pro",desc:"1080p-class output · higher fidelity"} ]
              .map(o=>sdOption({ ...o, selected:motionTier===o.id, onPick:()=>setMotionTier(o.id) })))),
        sdPill("motion-quality","inline","Quality follows the model tier — Motion Control has no separate resolution setting",
          _stEl(React.Fragment,null, _stEl("span",{className:"sdrow-label"},"Quality"),
            _stEl("span",{className:"sdrow-badge"}, motionTier==="pro" ? "1080p · Pro" : "720p · Standard")),
          _stEl("div",{className:"sdbar-pop sdbar-pop-wide"},
            [ {id:"standard",label:"720p · Standard",desc:"Kling 3.0 Motion Control Standard"},
              {id:"pro",label:"1080p · Pro",desc:"Kling 3.0 Motion Control Pro"} ]
              .map(o=>sdOption({ ...o, selected:motionTier===o.id, onPick:()=>setMotionTier(o.id) })))) ],
      [ generateButton("Generate", motionCost, ()=>{ if(gening) return; onMotionControl(); },
          { blocked:!!motionBlocker, title:motionBlocker||motionCostTitle, costTitle:motionCostTitle, testId:"stage-generate-motion",
            disabled:(!motionCapsPending && !serverHasMotion) }) ], { cls:"divided" })),
    (!motionCapsPending && !serverHasMotion) && pendingNote("Motion Control"),
    modeErrEl);
  // the red no-credits outline follows the OPEN tab's render (footerCredit: its cost, or its hold —
  // flagged only once a measured video sizes the hold: footerCredit.short, round 5)
  const composer = _stEl("div",{className:"stage2-gen-composer"+(gening?" working":"")+(footerCredit.short?" no-credits":""),"data-composer-tab":composerTab},
    composerHeader,
    composerTab==="edit" ? editBody : composerTab==="motion" ? motionBody : createBody,
    _stEl("input",{ref:fileInputRef,type:"file",className:"stage2-file-input",tabIndex:-1,"aria-hidden":"true",onChange:onDeviceFile}),
    tray);

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
            "aria-label":"Take of "+(clip.label||"this clip"),
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
    // scene assembly strip — one CURRENT/chosen take slot per beat clip. Newly
    // generated clips appear immediately; Takes remains the place to compare,
    // approve and restore versions.
    _stEl("div",{className:"stage2-timeline"},
      _stEl("button",{type:"button",className:"stage2-time-arrow",title:"Previous clip","aria-label":"Previous clip",
        disabled:clipsInScene.findIndex(c=>c.id===clip.id)<=0,
        onClick:()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); if(i>0) onSelectClip&&onSelectClip(clipsInScene[i-1].id); }},
        Icon.chevL&&_stEl(Icon.chevL,{s:14})),
      _stEl("div",{className:"stage2-time-track"},
        _stEl("div",{className:"stage2-time-scene-head"},
          _stEl("span",null,"Scene "+_pad2(scene.no)+" · chosen take per beat"),
          _stEl("span",null,readySceneTakeCount+" / "+sceneTakeSlots.length+" ready")),
        _stEl("div",{className:"stage2-time-cards"},
          sceneTakeSlots.length ? sceneTakeSlots.map(slot=>{
            const c=slot.clip,m=slot.meta||{},shotCount=(((c.data||{}).shots)||[]).length;
            const active=c.id===clip.id;
            const thumb=clipPrimaryFrame(c,imgs,visualSource);
            const takeLabel=slot.take ? _stageTakeVno(slot.take,slot.takes,slot.takes.indexOf(slot.take)) : "";
            const statusLabel=slot.rendered ? (slot.approved?"Approved":"Current")
              : slot.state==="stale"?"Needs review":"Not rendered";
            const beatName0=clipBeatName(c,beatsMap,drafts);
            const click=()=>{ if(c.id===clip.id){ if(slot.url)setActiveTakeUrl(slot.url); }
              else if(onSelectClip)onSelectClip(c.id); };
            return _stEl("button",{key:c.id,type:"button",
              className:"stage2-time-card"+(slot.rendered?" rendered":" missing")+(slot.state==="stale"?" stale":"")+(active?" on":""),
              "data-testid":"stage-scene-beat-take","data-scene-id":String(c.scene&&c.scene.id||""),
              "data-clip-id":c.id,"data-beat":slot.beatNumbers.join(","),"data-state":slot.state,
              onClick:click,title:slot.beatLabel+" · "+(slot.rendered
                ? (takeLabel+" · "+statusLabel+" · "+(_stageAgo(m.createdAt)||"rendered"))
                : statusLabel+" — select this beat to render it")},
              _stEl("div",{className:"stage2-time-thumb"},
                slot.rendered
                  ? _stEl("video",{src:slot.url+"#t=0.1",muted:true,playsInline:true,preload:"metadata"})
                  : thumb ? _stEl("img",{src:thumb,alt:""}) : _stEl("span",{className:"stage2-time-blank"}),
                shotCount>1 && _stEl("span",{className:"stage2-time-merge",title:shotCount+" shots in this beat clip"},"×"+shotCount),
                _stEl("span",{className:"stage2-time-state "+(slot.approved?"approved":slot.state)},statusLabel),
                slot.rendered && _stEl("span",{className:"stage2-time-play"},Icon.play&&_stEl(Icon.play,{s:12}))),
              _stEl("div",{className:"stage2-time-meta"},
                _stEl("b",null,slot.beatLabel+(beatName0?" · "+beatName0:"")),
                _stEl("span",null,slot.rendered
                  ? [m.durationSec?_fmtSecs(m.durationSec):_fmtSecs((c.data||{}).dur),m.resolution].filter(Boolean).join(" · ")
                  : "—"))); })
            : _stEl("div",{className:"stage2-time-empty"},"This scene has no planned beat clips yet.") )),
      _stEl("button",{type:"button",className:"stage2-time-arrow",title:"Next clip",
        disabled:(()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); return i<0 || i>=clipsInScene.length-1; })(),
        onClick:()=>{ const i=clipsInScene.findIndex(c=>c.id===clip.id); if(i>=0 && i<clipsInScene.length-1) onSelectClip&&onSelectClip(clipsInScene[i+1].id); }},
        Icon.chevR&&_stEl(Icon.chevR,{s:14}))),
    composer,
    _stEl("div",{className:"stage2-director-prompt"},
      _stEl("div",{className:"stage2-director-head"},
        _stEl("div",{className:"stage2-director-title"},
          _stEl("b",null,model.label+" Director"),
          _stEl("span",{className:"stage2-director-badge"},"MAIN PROMPT"))),
      _stEl(StagePromptArea,{className:"stage2-director-text",value:prompt,setValue:(v)=>{
          promptEditedRef.current=true;setPromptSourceStamp(promptSourceSig),setPromptLookStamp(clipLookSig); setPromptOtherGrouping(false);setPromptDriftConfirmed("");setPrompt(v);
          promptDraftsRef.current[promptDraftKey]={text:v,sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:shownShots.map(s=>s.id),updatedAt:Date.now()};
        },
        mentionables,onMentionPick:includeMention,fill:true,placeholder:"Describe the video you want to create…",maxLength:PANEL_PROMPT_MAX}),
      _stEl("div",{className:"stage2-director-chips"},
        promptChips.map(([k,v],i)=>_stEl("button",{key:k+i,type:"button",onClick:()=>onChip({k,v,label:v}),title:"Add "+k+" to prompt"},
          _stEl("b",null,k),_stEl("span",null,v))))),
    _stEl("div",{className:"stage2-assets-lab"},
      _stEl("span",null,"INPUTS ("+budgetUsed+"/"+assetLimit+")"),
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
                Icon.maximize&&_stEl(Icon.maximize,{s:12})))
          : _stEl("span",{className:"stage2-asset-icon"}, a.kind==="video" ? (Icon.play&&_stEl(Icon.play,{s:16})) : (Icon.image&&_stEl(Icon.image,{s:16})))),
        _stEl("span",{className:"stage2-asset-name"}, a.label),
        _stEl("small",null,a.tag+(a.locked?" · REQUIRED":on(a)?" · INCLUDED":"")))),
      null),   // (the "Add asset" tile did nothing — inputs come from the clip's frames, cast, location, props and audio)
    // ONE warning in ONE place (2026-10-05): voice and source live in the composer's notices; this row
    // keeps what's about the inputs row itself (too many inputs) and the credit line
    (assetOver || genErr || footerCredit.short) && _stEl("div",{className:"stage2-assets-warnings"},
      assetOver && _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}), "Too many inputs selected. Exclude "+budgetOverBy+" optional asset"+(budgetOverBy!==1?"s":"")+" before rendering."),
      // the credit warning follows the OPEN tab too (footerCredit), never the References render alone
      footerCredit.short && (footerCredit.frozen
        ? _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
          _stEl("span",{className:"stage2-warn-text"}, "Account on hold — spending credits is paused while a payment is disputed."),
          _stEl("button",{type:"button",className:"stage2-warn-act",
            title:"Open Manage plan, or write to kinolot-billing@infinitestudioai.com",
            onClick:()=>{ if(typeof window.turnOpenManagePlan==="function") window.turnOpenManagePlan(); else if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); }}, "Manage plan"))
        : _stEl("div",{className:"stage2-warn"}, Icon.alert&&_stEl(Icon.alert,{s:12}),
          _stEl("span",{className:"stage2-warn-text"}, stageCreditShortText(footerCredit)),
          !footerCredit.ownerPays && _stEl("button",{type:"button",className:"stage2-warn-act",
            title:"Top up with a credit pack (any account; pack credits last 12 months), or upgrade your plan",
            onClick:()=>{ if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); }}, "Get credits"))),
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
        Icon.sparkles&&_stEl(Icon.sparkles,{s:12}), totalCost+" credit"+(totalCost!==1?"s":""))),
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
           title:serverPending?"Not available yet — waiting on a server update"
             :disabled?(reachable?(r+" needs the Standard tier"):(r+" isn't available on "+model.label)):(r==="4K"?"4K — ~5× the 720p credit rate":r),
           onClick:()=>{if(!disabled)setResolution(r);}}, r);
      }))),
    // title stays the stable "Clip duration" hook; the floor's reason rides the option
    // label ("· coverage minimum" / "· voice + air") and the accessible description
    _ctrlRow("Duration", _stEl("select",{value:String(duration),
        title:"Clip duration","aria-description":durationTitle==="Clip duration"?undefined:durationTitle,
        onChange:e=>{ const v=Number(e.target.value); setDurationOverride(v===autoDurationSec ? null : v); }},
        durationOptions.map(v=>_stEl("option",{key:v,value:String(v)},_fmtSecs(v)+durationOptionNote(v))))),
    // the cost math, spelled out — updates live with any choice above (and the batch pill)
    _stEl("div",{className:"stage2-rc-math",title:creditInfo.title},
      (batchN>1 ? (batchN+" takes × ") : "")+_fmtSecs(duration)+" × "+resolution+" × "+tierObj.label
        +(refVideoSec>0 ? " (+ "+_fmtSecs(Math.round(refVideoSec*10)/10)+" reference video)" : "")
        +" = "+totalCost.toLocaleString("en-US")+" credit"+(totalCost!==1?"s":"")
        +(creditInfo.known ? (" · "+Number(creditInfo.remaining).toLocaleString("en-US")+" remaining") : "")),
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
    // Grouping is separate from the beat's camera cuts. Keep historical take
    // access available without exposing this as a routine composer choice.
    _ctrlRow("Clip grouping", _stEl("select",{value:clipScope,
        "aria-label":"Clip grouping","data-testid":"stage-clip-grouping",
        title:"How shots are grouped into video clips, not where the camera cuts. Earlier grouping keeps older takes reachable.",
        onChange:e=>{ if(typeof setClipScope==="function")setClipScope(e.target.value); }},
      _stEl("option",{value:"beat",
        title:"Fit the beat to the model limit by splitting at existing shot boundaries; never drops a shot or shortens dialogue."},"Split to fit"),
      _stEl("option",{value:"shot",
        title:"One render per saved shot."},"Single shot"),
      _stEl("option",{value:"legacy",
        title:"Browse the earlier automatic groups and their older takes."},"Earlier grouping"))),
    // batch takes — parallel renders with distinct seeds; the Render card's cost
    // multiplies live as this changes (same state as the composer's batch pill)
    _ctrlRow("Batch takes", _stEl("div",{className:"stage2-seedrow stage2-batchrow"},
      _stEl("button",{type:"button",className:"stage2-seed-btn",title:"Fewer takes","aria-label":"Fewer takes",
        disabled:batchN<=1||gening,onClick:()=>setBatchN(n=>Math.max(1,n-1))},"−"),
      _stEl("span",{className:"stage2-batchrow-n",
        title:"Takes per Generate — "+batchN+" parallel render"+(batchN!==1?"s":"")+" with distinct seeds ("+totalCost+" credits total)"},
        batchN+" / "+planMaxBatch),
      _stEl("button",{type:"button",className:"stage2-seed-btn",disabled:batchN>=4||gening,
        title:batchN>=planMaxBatch&&planMaxBatch<4 ? "Batch takes need the "+stagePlanName("Studio")+" plan — click to upgrade" : "More takes",
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
        Icon.plus&&_stEl(Icon.plus,{s:14}),"All references ("+budgetUsed+"/"+assetLimit+")"),
      _stEl("button",{type:"button",className:trayOpen==="elems"?"on":"",
        title:"The story elements referenced in this clip — cast, location, props",
        onClick:(e)=>openTray("elems", e)},
        (Icon.userScan||Icon.user)&&_stEl(Icon.userScan||Icon.user,{s:14}),"Elements"),
      hasDialogue && modelAudioRefs && _stEl("button",{type:"button",className:trayOpen==="voices"?"on":"",
        title:"Add or remove a character's recorded voice as a reference for this render",
        onClick:(e)=>openTray("voices", e)},
        Icon.mic&&_stEl(Icon.mic,{s:14}),
        "Voices ("+voiceGroups.filter(g=>voiceCharState(g)!=="excluded"&&voiceCharState(g)!=="missing").length+"/"+voiceGroups.length+")")),
    // read-only preview of the auto reference-role block appended at render — kept out
    // of the editable prompt so it always matches the CURRENT included assets.
    refLines.length>0 && _stEl("div",{className:"stage2-gen-refs",title:"Appended to the prompt at render, so Seedance knows what each attached reference is for. Updates as you include/exclude assets."},
      _stEl("b",null,"REFERENCES — added at render"),
      refLines.map((l,i)=>_stEl("span",{key:i},l))),
    _ctrlRow("Visual source", _stEl("select",{value:sourceOverride,"data-testid":"stage-visual-source","aria-label":"Visual source",
        title:"Which visual source anchors this render. Auto follows the per-clip rule: dialogue or 1 shot → the shot frame; 2 merged shots → the 2-panel storyboard half; 3–4 merged shots → per-shot frames when they fit the image budget, else the 4-panel sheet.",
        onChange:e=>setSourceOverride(e.target.value)},
      _stEl("option",{value:"auto"},"Auto — "+(beatOpeningClip?"beat-opening frame":sourcePlan.label)),
      _stEl("option",{value:"frame"},"Shot frame"),
      _stEl("option",{value:"frames",disabled:beatOpeningClip||(d.shots||[]).length<2},"Per-shot frames"),
      _stEl("option",{value:"halves",disabled:beatOpeningClip||!sourcePlan.hasHalves},"Storyboard halves"+(beatOpeningClip?" — beat-opening uses one frame":sourcePlan.hasHalves?"":(sourcePlan.offBoard?" — this clip's beats aren't on the storyboard":sourcePlan.halvesStale?" — out of date (recompose in Storyboards)":" — none saved"))),
      _stEl("option",{value:"sheet",disabled:beatOpeningClip||!sourcePlan.hasSheet},"Full storyboard sheet"+(beatOpeningClip?" — beat-opening uses one frame":sourcePlan.hasSheet?"":(sourcePlan.offBoard?" — this clip's beats aren't on the storyboard":sourcePlan.sheetStale?" — out of date (recompose in Storyboards)":" — none saved"))))),
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
    _ctrlRow("Acting focus", _stEl("select",{value:perf,onChange:e=>setPerf(e.target.value),
        title:"Choose whose authored objective and visible beat changes should receive the clearest performance emphasis"},
      _uniq([perf,d.lead].concat(dialogueSpeakers).filter(Boolean)).map(v=>_stEl("option",{key:v,value:v},v)))),
    _stEl("label",{className:"sd-gen-label"},"Timing & sound"),
    _ctrlRow("Audio", (hasDialogue && modelAudioRefs)
      ? _stEl("select",{value:dialogueAudio,
          title:"Locked voice lip-syncs to your characters' recorded lines; Native performance lets the model act the lines itself (swap voices in post)",
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
    // READ-ONLY FACTS, not buttons (they did nothing when clicked), and the sound one says what the
    // render will really carry (it said "ON" even for a silent render) — 2026-10-05
    _stEl("div",{className:"sd-gen-pills"},
      _stEl("span",{className:"sd-gen-pill",title:measuredSec?("Voice + breathing room = "+_fmtSecs(measuredSec)+" minimum — rendering "+_fmtSecs(duration)):"Estimated clip duration"},
        Icon.clock&&_stEl(Icon.clock,{s:14}), _fmtSecs(duration)),
      _stEl("span",{className:"sd-gen-pill",title:"Aspect ratio (set by the film's format)"},
        Icon.monitor&&_stEl(Icon.monitor,{s:14}), effAspect||"16:9"),
      _stEl("span",{className:"sd-gen-pill",title:hasDialogue ? (voiceReady?"Lip-syncs to the locked voice lines":"Voice this clip before rendering") : (nativeAudio?"The model adds its own sound":"No sound in this render")},
        Icon.mic&&_stEl(Icon.mic,{s:14}), hasDialogue ? (voiceReady?"Voice":"Needs voice") : (nativeAudio?"Sound":"Silent"))));
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
      // (the drawer's own "Voice clip first" / source / asset errors repeated the composer's notices — removed 2026-10-05)
      genErr && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:14}), genErr),

      // the right panel's credit error follows the open tab's render too (round 5: on hold, a hold, or a cost)
      footerCredit.short && _stEl("div",{className:"stage2-err sd-gen-err"}, Icon.alert&&_stEl(Icon.alert,{s:14}), stageCreditPanelText(footerCredit)),
      gening
        ? _stEl("div",{className:"stage2-gen-busy sd-gen-busy"},
            _stEl("div",{className:"stage2-gen-prog"}, _stEl("div",{className:"orb"}), genBusyLabel),
            _stEl("button",{className:"sd-gen-cancel",type:"button",
              title:"Before the render is sent nothing is charged. Once it's sent this only stops waiting: a render that finishes is still charged and appears in Takes.",
              onClick:()=>{ stagingCancelRef.current=true; gen.cancel(); }},"Stop"))
        // ONE Generate (2026-10-05): the composer's button — it carries this render's price; the drawer
        // used to repeat it for References renders
        : _stEl("div",{className:"stage2-hint sd-gen-hint"}, "Generate from the "+(composerTab==="edit"?"Edit Video":composerTab==="motion"?"Motion Control":createTask==="reference"?"Create Video":"Extend Video")+" composer \u2014 its button carries this render's price."),
      // (Extend / Edit / Motion Control live on the composer's tabs — each with its own Generate)
      // the footer follows the open composer tab: Edit / Motion Control say what their render HOLDS
      _stEl("div",{className:"stage2-credit sd-gen-credit"+(footerCredit.short?" empty":""),title:footerCredit.title},
        Icon.sparkles&&_stEl(Icon.sparkles,{s:12}),footerCredit.label),
      lastSeed!=null && _stEl("div",{className:"stage2-credit sd-gen-credit",title:"The seed the last render used — reuse it from the Seed control for repeatable variations"},
        "Seed "+lastSeed)));

  const lightbox = maxImg && (maxImg.kind==="video"
    ? _stEl("div",{className:"stage2-lightbox",role:"dialog","aria-modal":"true","aria-label":maxImg.label||"Video",onClick:()=>setMaxImg(null)},
        _stEl("button",{ref:lightboxCloseRef,className:"stage2-lightbox-x",title:"Close","aria-label":"Close",onClick:()=>setMaxImg(null)}, Icon.x&&_stEl(Icon.x,{s:18})),
        _stEl("video",{className:"stage2-lightbox-media",src:maxImg.url,controls:true,autoPlay:true,playsInline:true,"aria-label":maxImg.label||"Video",onClick:(e)=>e.stopPropagation()}),
        maxImg.label && _stEl("div",{className:"stage2-lightbox-cap"}, maxImg.label))
    : _stEl("div",{className:"lb-overlay",role:"dialog","aria-modal":"true","aria-label":maxImg.label||"Image preview",onMouseDown:(e)=>{ if(e.target===e.currentTarget) setMaxImg(null); }},
        _stEl("div",{className:"lb-panel"},
          _stEl("div",{className:"lb-head"},
            _stEl("span",{className:"lb-title"}, maxImg.label || "Image preview"),
            _stEl("button",{ref:lightboxCloseRef,className:"ag-x",title:"Close","aria-label":"Close",onClick:()=>setMaxImg(null)}, Icon.x&&_stEl(Icon.x,{s:18}))),
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
/* a take's model, as a name — never the provider's endpoint path (2026-10-05, owner — Stage review:
   Seedance 2.5 and Kling takes showed e.g. "bytedance/seedance-2.5/reference-to-video") */
function stageTakeModelLabel(raw){
  const m = String(raw||"");
  const fast = /\/fast\//.test(m) ? " · Fast" : "";
  if(/sora-2/.test(m)) return "Sora 2"+(/\/pro/.test(m)?" · Pro":"");
  if(/seedance-2\.5/.test(m)) return "Seedance 2.5"+fast+(/edit/.test(m)?" · Edit":/extend/.test(m)?" · Extend":"");
  if(/seedance-2\.0/.test(m)) return "Seedance 2.0"+fast+(/image-to-video/.test(m)?" · transition":"");
  if(/kling/.test(m)) return "Kling"+(/v3/.test(m)?" 3.0":"")+(/motion-control/.test(m)?" · Motion Control":"")+(/\/pro\//.test(m)?" · Pro":/\/standard\//.test(m)?" · Standard":"");
  if(!m) return "Seedance 2.0";
  // an unknown id: its last readable segment, never the vendor/path
  const last = m.split("/").filter(Boolean).pop() || m;
  return last.replace(/[-_]+/g," ").replace(/\b\w/g, c=>c.toUpperCase());
}
window.stageTakeModelLabel = stageTakeModelLabel;
/* ONE SET OF TAKE NOTES (2026-10-09, owner — Stage review): "Prop reference changed", "References need
   review", "Voice changed" and the rest lived only in the Takes view — the Shoot strip, the Scenes rail,
   the Timeline and the Breakdown treated such a take as current. Every place reads these now. */
function stageTakePropChanged(clip, meta){
  return !!(meta && meta.propDependencies!=null && typeof stageClipPropDependenciesChanged==="function"
    && stageClipPropDependenciesChanged(meta.propDependencies,(clip&&clip.data)||{},clip&&clip.scene&&clip.scene.id,window.turnContinuity||{}));
}
function stageTakeVoiceChangedMeta(meta){
  const vr=(meta&&meta.voiceReferences)||[];
  if(!vr.length || typeof window.vgVoiceLockSignature!=="function") return false;
  const cast=((window.turnContinuity||{}).characters)||[];
  return vr.some(v=>{ if(!v||!v.speakerId||!v.fingerprint) return false;
    const c=cast.find(x=>x&&x.id===v.speakerId); if(!c||!c.voiceLock) return false;
    return String(window.vgVoiceLockSignature(c.voiceLock)||"")!==String(v.fingerprint); });
}
function stageTakeReferencesStale(meta){
  const refs=(meta&&meta.referenceSourceVersions)||[];
  if(!refs.length||typeof window.stageReferenceStatus!=="function") return false;
  // (2026-10-06, owner — Characters review) missing, excluded or CHANGED only: a sheet's manual approval
  // isn't a Stage requirement, and nothing can approve one any more, so every take used to say this
  return refs.some(r=>{
    const id=r&&r.assetId; if(!id) return false;
    const m=(typeof nbGetMeta==="function")?nbGetMeta(id):null, img=(typeof nbGetImage==="function")?nbGetImage(id):"";
    // (2026-10-08, owner — Locations review) not loaded on this device yet: unknown, never a warning
    if(!m && !img) return false;
    // missing when the take was made (no version recorded) and made since: the take never had it
    const snap=r.snapshot||{};
    if(!snap.iso && snap.version==null && m && m.iso) return true;
    const st=window.stageReferenceStatus({imageId:id,snapshot:r.snapshot});
    return st.missing||st.excluded||st.stale; });
}
/* the frames and boards a take was made from (meta.frameVersions, 2026-10-09): one re-rendered since
   (a new seed, look or sheet) flags the take. Not loaded on this device yet: unknown, never a warning. */
function stageTakeFramesChanged(meta){
  const fv=(meta&&meta.frameVersions)||[];
  if(!fv.length || typeof nbGetMeta!=="function") return false;
  return fv.some(f=>{ if(!f||!f.id) return false;
    const m=nbGetMeta(f.id); if(!m) return false;
    if(f.iso && m.iso && String(f.iso)!==String(m.iso)) return true;
    return f.version!=null && m.version!=null && Number(f.version)!==Number(m.version); });
}
function stageTakeNotes(clip, meta, project){
  const m=meta||{}, out=[];
  if(m.identityChanged) out.push({ key:"i", label:"Identity changed", title:"A character's identity changed while this take rendered — check it before you use it" });
  if(stageTakeFramesChanged(m)) out.push({ key:"f", label:"Frame changed", title:"A frame or storyboard this take was made from has been re-rendered since" });
  if(stageTakePropChanged(clip,m)) out.push({ key:"p", label:"Prop reference changed", title:"A prop this take shows has changed since it was rendered" });
  if(stageTakeReferencesStale(m)) out.push({ key:"r", label:"References need review", title:"A character, location or prop reference this take used has changed or is missing" });
  if(stageTakeVoiceChangedMeta(m)) out.push({ key:"v", label:"Voice changed", title:"A speaking character's voice was re-locked after this take was rendered — re-voice the lines and regenerate to use the new voice" });
  if(clip && clip.scene && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(m.lookSig, project || window.turnProject, clip.scene.id))
    out.push({ key:"l", label:"Earlier look", title:"This scene's look or the film stock changed on the Color tab after this take was rendered" });
  return out;
}
window.stageTakeNotes = stageTakeNotes;
/* a take whose address isn't one the app trusts (videogen.jsx vidTakeUrlTrusted — 2026-10-09, Stage editor review)
   comes back with url "" and the stored address in rawUrl: it's listed (and the owner can delete it) but never played */
function _stageTakeRows(list){
  return (list||[]).map(t=> t && t.unavailable && !t.url ? { ...t, url:String(t.rawUrl||""), unavailable:true } : t).filter(t=>t && t.url);
}
function StageVersionsView({ clip, stageModel, onBack, onReuse, readOnly=false, project }){
  const clipId = clip && clip.id;
  const [takes, setTakes] = React.useState(()=> (clipId && typeof vidGetTakes==="function") ? _stageTakeRows(vidGetTakes(clipId)) : []);
  React.useEffect(()=>{ let alive=true;
    if(clipId && typeof vidLoadTakes==="function") vidLoadTakes(clipId).then(t=>{ if(alive) setTakes(_stageTakeRows(t)); });
    const onDone=(e)=>{ if(alive && e.detail && e.detail.ids && e.detail.ids.indexOf(clipId)>=0 && typeof vidGetTakes==="function") setTakes(_stageTakeRows(vidGetTakes(clipId))); };
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
  const propDependenciesStale=(t)=>stageTakePropChanged(clip,t&&t.meta);
  const stageTakeVoiceChanged=(t)=>stageTakeVoiceChangedMeta(t&&t.meta);
  const referenceVersionsStale=(t)=>stageTakeReferencesStale(t&&t.meta);
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
        ?"One or more character appearance, location camera view or prop-state references changed or is missing."
        : status==="stale"
        ?"This take was rendered from older shot specifications or screenplay text."
        :"This older take doesn't record which version of the shots it was made from, so it can't be checked against them.")
        +" "+verb+" records an explicit override tied to the current shot sources. The override expires automatically after another source change.",
      confirmLabel:verb+" with override",danger:true
    });
    if(!ok) return false;
    if(recordOverride&&window.vidUpdateTake) await window.vidUpdateTake(clipId,t.url,{sourceOverride:sourceOverrideSnapshot()});
    return true;
  };
  /* CHECKING AN "IDENTITY CHANGED" TAKE (2026-10-09, owner — Timeline review): the flag kept the take out of
     the film with nothing to clear it. Choosing or approving it asks you to check it, then clears the flag. */
  const confirmIdentity = async (t, verb)=>{
    if(!(t && t.meta && t.meta.identityChanged)) return true;
    const ok = typeof window.appConfirm!=="function" ? window.confirm("Use this take?") : await window.appConfirm({
      title:"Have you checked this take?",
      body:"A character's identity changed while it rendered, so they may not look or sound as they do now. "+verb+" it only if they look right \u2014 the take then goes back into the film.",
      confirmLabel:verb+" it", cancelLabel:"Not yet" });
    if(!ok) return false;
    if(window.vidUpdateTake) await window.vidUpdateTake(clipId, t.url, { identityChanged:false, identityCheckedAt:new Date().toISOString() });
    return true;
  };
  const act = {
    approve:async(t,on)=>{
      if(!window.vidApproveTake || readOnly) return;
      if(on && !(await confirmIdentity(t,"Approve"))) return;
      if(on && !(await confirmSourceOverride(t,"Approve"))) return;
      await window.vidApproveTake(clipId,t.url,on);
    },
    restore:async(t)=>{
      if(!window.vidRestoreTake || readOnly || !(await confirmIdentity(t,"Choose")) || !(await confirmSourceOverride(t,"Restore"))) return;
      await window.vidRestoreTake(clipId,t.url);
      if(typeof window.appToast==="function") window.appToast(
        versionSourceStatus(t)==="current"
          ?"Chosen for the timeline — the scene strip, Mix and export use it now."
          :"Chosen with an explicit source override — the scene strip and assembly may use it until the sources change.","ok");
    },
    // the app's own dialog, saying what it means; a failed delete says so (2026-10-05)
    del:async (url)=>{ if(!window.vidDeleteTake || readOnly) return;
      const t = (takes||[]).find(x=>x && x.url===url) || {};
      const ok = typeof window.appConfirm!=="function" ? window.confirm("Delete this take?") : await window.appConfirm({
        title:"Delete this take?",
        body:"It's removed from this clip's takes for good \u2014 this can't be undone."
          +(t.current ? " It's the take chosen for the timeline, so the clip falls back to its previous take (or none)." : "")
          +((t.meta && t.meta.status==="approved") || t.approved ? " It's your approved take." : ""),
        confirmLabel:"Delete take", cancelLabel:"Keep it", danger:true });
      if(!ok) return;
      try{ await window.vidDeleteTake(clipId, url); }
      catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn't delete the take ("+((e&&e.message)||"error")+") \u2014 reopen Takes to see whether it's still there.","error"); } },
    note:(url,text)=>{ if(window.vidUpdateTake && !readOnly) window.vidUpdateTake(clipId, url, { note:String(text||"").slice(0,300) }); },
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
      sourceStatus==="stale"?"Shots changed":"Can't be checked"));
    // the shared take notes (stageTakeNotes): identity, frames, props, references, voice, earlier look —
    // notes, not blocks; the live project, as the Timeline reads it (2026-10-08)
    stageTakeNotes(clip, m, project).forEach(nt=>out.push(_stEl("span",{key:nt.key,className:"stage2-vbadge stale",title:nt.title},nt.label)));
    return out;
  };
  const detailRows = sel ? [
    ["Model", stageTakeModelLabel(selMeta.model)],
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
        _stEl("button",{className:"stage2-iconbtn",title:"Back to Shoot","aria-label":"Back to Shoot",onClick:onBack}, Icon.chevL&&_stEl(Icon.chevL,{s:16})),
        _stEl("div",{className:"stage2-versions-title"},
          Icon.layers&&_stEl(Icon.layers,{s:14}), "Takes",
          _stEl("span",{className:"stage2-versions-sub"}, (clip&&clip.label)||"")),
        _stEl("span",{className:"stage2-versions-count"}, takes.length+(takes.length===1?" take":" takes"))),   // (one Back to Shoot is enough — 2026-10-05)
      _stEl("div",{className:"stage2-versions-body"},
        // left — version cards
        _stEl("div",{className:"stage2-versions-list"},
          list.length ? list.map(t=>{
            const m = t.meta||{};
            return _stEl("button",{key:t.url,type:"button",
              className:"stage2-vcard"+(sel&&sel.url===t.url?" sel":""),
              onClick:()=>setSelUrl(t.url)},
              t.unavailable ? _stEl("div",{className:"stage2-vcard-thumb","aria-hidden":"true"})
                : _stEl("video",{className:"stage2-vcard-thumb",src:t.url+"#t=0.1",preload:"metadata",muted:true,playsInline:true,"aria-hidden":"true",tabIndex:-1}),
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
          sel && sel.unavailable ? _stEl("div",{className:"stage2-source-warning stale",role:"status"},"This take's video comes from an address the app doesn't play. The film's owner can delete it.")
          : sel ? _stEl("video",{key:sel.url,className:"stage2-versions-video",src:sel.url,controls:true,playsInline:true,
            "aria-label":"Selected take"+((sel.meta&&sel.meta.vno)?" v"+sel.meta.vno:""),
            title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget)}) : null,
          sel && _stEl("div",{className:"stage2-versions-details"},
            propDependenciesStale(sel) && _stEl("div",{className:"stage2-source-warning stale"},
              selApproved
                ? "A prop used by this take has changed. This approved take remains pinned; update it only when you intentionally render a new version."
                : "A prop used by this take has changed in the Art Room. Render a new version to use the current prop state and reference sheet."),
            referenceVersionsStale(sel) && _stEl("div",{className:"stage2-source-warning stale"},
              "A character appearance, location camera view or prop-state reference used by this take changed or is missing. Review and explicitly confirm before approving, restoring or reusing it."),
            selEditorialStatus!=="current" && _stEl("div",{className:"stage2-source-warning "+selEditorialStatus},
              selEditorialStatus==="override"
                ?"Explicit source override: this historical take is approved for the current shot sources. Any later shot or screenplay change invalidates the override."
                : selSourceStatus==="stale"
                ?"Historical take: its shot specification or screenplay source has changed. Re-render it before using it as the clip's current take."
                :"Legacy take: no shot/source revision stamp is available, so its match to the current shots can't be checked."),
            _stEl("div",{className:"stage2-versions-dhead"},"Version details"),
            detailRows.map(([k,v])=>_stEl("div",{key:k,className:"stage2-vdetail"},
              _stEl("span",{className:"stage2-vdetail-k"},k), _stEl("span",{className:"stage2-vdetail-v"},v))),
            _stEl("div",{className:"stage2-vdetail notes"},
              _stEl("span",{className:"stage2-vdetail-k"},"Notes"),
              _stEl("input",{key:sel.url,className:"stage2-vnote-input",defaultValue:selMeta.note||"",readOnly,"aria-label":"Notes for this take",
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
          // a CURRENT take flagged "identity changed" is out of the film until checked: this button checks it
          (()=>{ const flagged = !!(sel && sel.current && sel.meta && sel.meta.identityChanged);
            return _stEl("button",{className:"stage2-vtool",disabled:readOnly||!sel||(!!(sel&&sel.current)&&!flagged),
            title:flagged
              ? "A character's identity changed while this take rendered, so it's left out of the film \u2014 check it, then use it"
              : sel&&sel.current
              ? "This is the chosen take used by the scene strip, Timeline, Mix and export"
              : "Choose this take for the scene strip, Timeline, Mix and export",
             onClick:async()=>{ if(!sel) return;
               if(flagged){ if(await confirmIdentity(sel,"Use") && typeof window.appToast==="function") window.appToast("Checked \u2014 the take is back in the film.","ok"); return; }
               act.restore(sel); }}, flagged ? "Check and use this take" : sel&&sel.current ? "Chosen for timeline" : "Choose for timeline"); })(),
          _stEl("button",{className:"stage2-vtool"+(selApproved?" on":""),disabled:readOnly||!sel,
            title:selApproved?"Remove the approval star":"Star this take as the clip's approved version — it never rolls off the version list",
             onClick:()=>sel&&act.approve(sel, !selApproved)}, selApproved?"★ Approved — unstar":"☆ Approve this take"),
          _stEl("button",{className:"stage2-vtool",disabled:!sel,
            title:"Load this take's visual source, tier, resolution, bitrate and recipe back into the Stage composer",
            onClick:async()=>{ if(sel&&await confirmSourceOverride(sel,"Reuse",false)) onReuse(selMeta,false); }}, "Reuse settings"),
          _stEl("button",{className:"stage2-vtool",disabled:!sel||selMeta.seed==null,
            title:"Reuse settings AND pin this take's seed — Generate renders a controlled variation",
            onClick:async()=>{ if(sel&&await confirmSourceOverride(sel,"Branch",false)) onReuse(selMeta,true); }}, "Branch from version"),
          sel && !sel.unavailable && _stEl("a",{className:"stage2-vtool link",href:sel.url,target:"_blank",rel:"noreferrer",download:""},"Download / open"),
          // (2026-10-09, owner — Stage editor review, decision C) a collaborator deletes only takes they made; the
          // owner deletes any (window.vidTakeDeletable: no `by` on a take = the owner's)
          (()=>{ const mine = !sel || typeof window.vidTakeDeletable!=="function" || window.vidTakeDeletable(sel);
            return _stEl("button",{className:"stage2-vtool danger",disabled:readOnly||!sel||!mine,
              title:readOnly?"View-only access \u2014 deleting a take requires edit access"
                : !mine ? "Only the person who made this take, or the film's owner, can delete it" : "Delete this take from the clip",
              onClick:()=>sel&&mine&&act.del(sel.url)}, "Delete take"); })(),
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
   the Timeline recipe use, so the post mixer lays the voiced lines exactly
   where the render was told to put them. */
function clipLinePlacements(clip, auds, characters){
  const shots = ((clip&&clip.data&&clip.data.shots)||[]);
  const out = []; let t = CLIP_AIR.lead, spoken = 0;
  shots.forEach(sh=>{
    const talks = String((sh&&sh.dialogue)||"").trim();
    if(talks){
      if(spoken>0) t += CLIP_AIR.gap;
      const sec = Number((sh.lineAudio||{}).durationMs||0)/1000 || ((typeof _seedanceVoiceSec==="function")?_seedanceVoiceSec(sh):2);
      const p = (((clip.data||{}).panelLines)||[]).find(x=>x&&x.shotId===sh.id);
      const audioState=_shotAudioState(sh,auds,characters);
      out.push({ shotId:sh.id, at:Math.round(t*10)/10, sec:Math.round(sec*10)/10,
        // A voice relock, model/settings change, text edit or project switch makes
        // the old bytes recoverable history, never playable dialogue in Mix.
        url:audioState.ready?((auds&&auds[sh.id])||""):"", audioState,
        speaker:(p&&p.speaker&&p.speaker.name)||(sh.lineAudio&&sh.lineAudio.speaker)||"Line",
        text:String(sh.dialogue||"").trim() });
      t += sec; spoken++;
    } else t += stageActionSec(sh);
  });
  return out;
}
window.stageClipLinePlacements=clipLinePlacements;
/* WHERE THE TAKE'S LINES ARE (2026-10-09, owner — Mix review): a take records where its lines were placed
   and which recording each was (meta.linePlacements; older takes: meta.voiceReferences). A line re-voiced
   since — new audio over lips timed to the old — is left out of the Mix and the export and says so; a take
   the model voiced itself (native performance) already has its lines, so none are laid over it. */
function stageTakeLinePlacements(clip, auds, characters, meta){
  const m = meta || ((typeof vidGetMeta==="function" && clip) ? vidGetMeta(clip.id) : null) || {};
  const base = clipLinePlacements(clip, auds, characters);
  const shots = ((clip&&clip.data&&clip.data.shots)||[]);
  const rec = {}; (Array.isArray(m.linePlacements) ? m.linePlacements : []).forEach(x=>{ if(x && x.shotId) rec[x.shotId] = x; });
  const vref = {}; (Array.isArray(m.voiceReferences) ? m.voiceReferences : []).forEach(x=>{ if(x && x.shotId) vref[x.shotId] = x; });
  const native = m.audio==="native";
  const takeEnd = Number(m.durationSec) || (Number(m.durationMs)/1000) || 0;
  return base.map(pl=>{
    const r = rec[pl.shotId], v = vref[pl.shotId];
    const sh = shots.find(x=>x && x.id===pl.shotId) || {};
    const nowHash = String((sh.lineAudio||{}).hash||"");
    const thenHash = String((r && r.hash) || (v && v.renderHash) || "");
    const at = (r && Number(r.at)>=0) ? Number(r.at) : pl.at;
    const out = { ...pl, at };
    if(native){ out.url = ""; out.native = true; }
    else if(thenHash && nowHash && thenHash!==nowHash){ out.url = ""; out.revoiced = true; }
    if(takeEnd>0 && at+pl.sec > takeEnd+0.05) out.pastEnd = true;
    return out;
  });
}
window.stageTakeLinePlacements = stageTakeLinePlacements;

/* ---- THE MIX, shared by the Mix tab and the film export (owner 2026-10-05 — Stage review:
   "export the film with the Mix"). The Mix's volumes/mutes are kept per film on this device
   (localStorage), each scene's imported beds in the film's audio store (vgSaveMixBed). ---- */
const STAGE_MIX_DEFAULTS = { native:0.35, dialogue:1, amb:0.7, music:0.5 };
function stageMixKey(projectId){
  if(projectId==null){ const sc = (typeof window.nbCloudScope==="function") ? window.nbCloudScope() : null;
    // the open film's id while the cloud scope is still being set (2026-10-09, Timeline review)
    projectId = (sc && sc.projectId) || window.turnOpenFilmId || null; }
  return "turn_stage_mix_"+(projectId||"local");
}
function stageMixSettings(projectId){
  let s = null; try{ s = JSON.parse(localStorage.getItem(stageMixKey(projectId))||"null"); }catch(e){}
  return { gain:{ ...STAGE_MIX_DEFAULTS, ...((s && s.gain && typeof s.gain.native==="number") ? s.gain : {}) },
    mute:(s && s.mute && typeof s.mute==="object") ? s.mute : {},
    // which levels you moved yourself (a Picture level you set is used by the export even with nothing else to mix)
    set:(s && s.set && typeof s.set==="object") ? s.set : {} };
}
async function stageLoadMixBeds(clips, onlySceneIds){
  const out = {};
  if(typeof window.vgLoadMixBed!=="function") return out;
  // the Mix tab loads only the open scene's beds (onlySceneIds); the export reads every scene's
  const ids = Array.from(new Set((clips||[]).map(c=>c && c.scene && c.scene.id).filter(Boolean)))
    .filter(id=>!onlySceneIds || onlySceneIds.indexOf(id)>=0);
  for(const sid of ids){
    for(const k of ["amb","music"]){
      const v = await window.vgLoadMixBed(sid, k);
      if(v && v.url){ out[sid] = out[sid]||{}; out[sid][k] = { url:v.url, name:(v.meta && v.meta.name)||(k==="music"?"Music":"Ambience") }; }
    }
  }
  return out;
}
/* the clips a film export leaves out, and why — named the way the Timeline names them */
function stageExportSkipped(ordered, vids, staleVids, identityVids){
  return (ordered||[]).filter(c=>c && !(vids && vids[c.id]))
    .map(c=>({ id:c.id, name:stageClipBeatName(c),
      why:(identityVids && identityVids[c.id]) ? "identity changed \u2014 check it in Takes"
        : (staleVids && staleVids[c.id]) ? "out of date" : "not rendered" }));
}
function stageExportSkippedText(skipped){
  const list = skipped||[]; if(!list.length) return "";
  const shown = list.slice(0,6).map(x=>x.name+" ("+x.why+")");
  return "Left out: "+shown.join(", ")+(list.length>6 ? " and "+(list.length-6)+" more" : "");
}
/* what the export plays over each take: the Mix's levels (a muted lane is 0), the voiced
   lines where the render placed them, and each scene's beds (ambience loops, music once) */
function stageExportMixPlan(ordered, vids, o){
  o = o||{};
  const gain = { ...STAGE_MIX_DEFAULTS, ...(o.gain||{}) }, mute = o.mute||{};
  const lvl = (k)=> mute[k] ? 0 : Math.max(0, Math.min(1, Number(gain[k])||0));
  const beds = o.beds||{};
  const items = (ordered||[]).filter(c=>c && vids && vids[c.id]).map(c=>({ id:c.id, sceneId:(c.scene && c.scene.id)||"",
    lines:stageTakeLinePlacements(c, o.auds, o.characters).filter(pl=>pl.url).map(pl=>({ at:pl.at, url:pl.url })) }));
  const sceneBeds = {};
  items.forEach(it=>{ if(sceneBeds[it.sceneId]) return; const b = beds[it.sceneId]||{};
    sceneBeds[it.sceneId] = { amb:(b.amb && b.amb.url)||"", music:(b.music && b.music.url)||"" }; });
  const gains = { native:lvl("native"), dialogue:lvl("dialogue"), amb:lvl("amb"), music:lvl("music") };
  const lineN = gains.dialogue>0 ? items.reduce((t,it)=>t+it.lines.length,0) : 0;
  const bedN = Object.keys(sceneBeds).reduce((t,k)=>t+(sceneBeds[k].amb && gains.amb>0 ?1:0)+(sceneBeds[k].music && gains.music>0 ?1:0),0);
  // a Picture level you SET (or a mute) is part of the mix too, even with no line or bed (2026-10-09)
  const pictureSet = !!(mute.native || (o.gainSet && o.gainSet.native===true));
  return { gains, items, beds:sceneBeds, lineN, bedN, pictureSet, has:lineN>0 || bedN>0 || pictureSet };
}
window.stageMixSettings = stageMixSettings; window.stageExportSkipped = stageExportSkipped;
window.stageExportSkippedText = stageExportSkippedText; window.stageExportMixPlan = stageExportMixPlan;

/* ---- FILM EXPORT — stitch every rendered clip's current take into ONE movie,
   entirely in the browser: each take plays through a hidden <video> into a canvas
   + WebAudio graph feeding a single MediaRecorder, so the export runs in REAL TIME
   (a 3-minute film records for ~3 minutes) and lands as a WebM download — the only
   format browsers can record natively. Needs the provider CDN to allow cross-site
   reads (fal.media sends CORS headers); a blocked read aborts with a plain
   explanation instead of a corrupt file. ---- */
function stageExportPlaylist(ordered, vids){
  return (ordered||[]).filter(c=>c && vids && vids[c.id]).map(c=>({ id:c.id, label:c.label||"", name:stageClipBeatName(c), url:vids[c.id] }));
}
window.stageExportPlaylist = stageExportPlaylist;   // pure — covered by the vm suite
/* The exported film's file name: the film's title when it has one
   ("The_Matrix-2026-09-28.webm"), else "Kinolot-film-2026-09-28.webm" (also for the
   default "Untitled film"). Letters in any script are kept, with their combining marks
   (Hindi, Thai: "नमस्ते" stays whole); everything else collapses to "_". Never the
   internal codename. */
function stageFilmFileName(title, date, ext){
  const day = String(date || new Date().toISOString().slice(0,10));
  // the file's real type: a browser that records MP4 only (older Safari) gets .mp4 (2026-10-09)
  const x = "."+(String(ext||"webm").replace(/^\./,"").toLowerCase()==="mp4" ? "mp4" : "webm");
  const raw = String(title||"").trim();
  if(!raw || /^untitled(?:\s+film)?$/i.test(raw)) return "Kinolot-film-"+day+x;
  let slug = "";
  try{ slug = raw.normalize("NFC").replace(new RegExp("[^\\p{L}\\p{M}\\p{N}\\-]+","gu"),"_"); }
  catch(e){ slug = raw.replace(/[^\w\-]+/g,"_"); }
  slug = Array.from(slug.replace(/_+/g,"_").replace(/^[_\-]+|[_\-]+$/g,"")).slice(0,80).join("")
    .replace(/[_\-]+$/,"");
  return slug ? (slug+"-"+day+x) : ("Kinolot-film-"+day+x);
}
/* the extension for a recorded blob's type */
function stageFilmExt(type){ return /mp4/i.test(String(type||"")) ? "mp4" : "webm"; }
window.stageFilmExt = stageFilmExt;
window.stageFilmFileName = stageFilmFileName;   // pure — covered by test-rebrand-art
async function stageExportFilm(playlist, opts){
  opts = opts||{};
  if(!playlist || !playlist.length) throw new Error("No rendered clips to export yet — render takes in the Shoot tab first.");
  // what the browser can't do, said plainly (a raw "is not a function" used to surface — 2026-10-09)
  if(typeof MediaRecorder==="undefined") throw new Error("This browser can't record video, so the film can't be exported here \u2014 try Chrome or Edge.");
  const AC = window.AudioContext||window.webkitAudioContext;
  if(typeof AC!=="function") throw new Error("This browser can't mix audio for a recording, so the film can't be exported here \u2014 try Chrome or Edge.");
  { const probe = document.createElement("canvas");
    if(!probe || typeof probe.captureStream!=="function") throw new Error("This browser can't record a canvas, so the film can't be exported here \u2014 try Chrome or Edge."); }
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; video.playsInline = true; video.preload = "auto";
  const ac = new AC();
  /* the element's sound goes into the RECORDING only, not the speakers: a
     MediaElementSource takes over the element's output, and the graph never
     connects to ac.destination. */
  const srcNode = ac.createMediaElementSource(video);
  const dest = ac.createMediaStreamDestination();
  /* WITH THE MIX (2026-10-05): the take's own sound at the Picture level, the voiced lines and
     the scene's beds on their own levels — what "Play scene mix" plays. Without it: as rendered. */
  const mix = (opts.mix && opts.mix.has) ? opts.mix : null;
  const lane = (v)=>{ const n = ac.createGain(); n.gain.value = v; n.connect(dest); return n; };
  const nativeGain = lane(mix ? mix.gains.native : 1);
  const dialogueGain = mix ? lane(mix.gains.dialogue) : null, ambGain = mix ? lane(mix.gains.amb) : null, musicGain = mix ? lane(mix.gains.music) : null;
  srcNode.connect(nativeGain);
  const mixById = {}; ((mix && mix.items)||[]).forEach(it=>{ mixById[it.id] = it; });
  const buffers = {}, sources = []; let audioMissed = 0, bedScene = null, bedSrcs = [], lineSrcs = [];
  const decode = async (url)=>{
    if(!url || (url in buffers)) return;
    try{ const ab = await (await fetch(url)).arrayBuffer();
      buffers[url] = await new Promise((res,rej)=>{ const pr = ac.decodeAudioData(ab, res, rej); if(pr && pr.then) pr.then(res, rej); }); }
    catch(e){ buffers[url] = null; audioMissed++; }
  };
  const playBuf = (url, node, when, loop)=>{ const buf = buffers[url]; if(!buf || !node) return null;
    const sn = ac.createBufferSource(); sn.buffer = buf; sn.loop = !!loop; sn.connect(node); sn.start(when); sources.push(sn); return sn; };
  const startClipAudio = (item)=>{
    if(!mix || !item) return;
    const now = ac.currentTime;
    if(item.sceneId!==bedScene){   // a new scene: its own beds (the last scene's stop)
      bedSrcs.forEach(sn=>{ try{ sn.stop(); }catch(e){} }); bedSrcs = []; bedScene = item.sceneId;
      const b = mix.beds[item.sceneId]||{};
      [playBuf(b.amb, ambGain, now, true), playBuf(b.music, musicGain, now, false)].forEach(sn=>{ if(sn) bedSrcs.push(sn); });
    }
    // a clip's lines end with the clip, as in the Mix tab (2026-10-09 — they ran on over the next clip)
    lineSrcs = (item.lines||[]).map(l=>playBuf(l.url, dialogueGain, now+Math.max(0, Number(l.at)||0), false)).filter(Boolean);
  };
  const stopClipLines = ()=>{ lineSrcs.forEach(sn=>{ try{ sn.stop(); }catch(e){} }); lineSrcs = []; };
  /* BEDS, A SCENE AT A TIME (2026-10-09, owner — Mix review): every bed in the film was decoded up front — a
     long music file decodes to hundreds of MB, and several could crash the tab. Now a scene's beds are read
     while the scene before it plays, and let go once their scene is over. */
  const sceneOrder = []; ((mix && mix.items)||[]).forEach(it=>{ if(sceneOrder.indexOf(it.sceneId)<0) sceneOrder.push(it.sceneId); });
  const bedUrls = (sid)=>{ const b = (mix && mix.beds && mix.beds[sid])||{}; return [b.amb, b.music].filter(Boolean); };
  const bedLoads = {};
  const loadBeds = (sid)=> bedLoads[sid] || (bedLoads[sid] = (async()=>{ for(const u of bedUrls(sid)) await decode(u); })());
  const releaseBeds = (sid)=>{ const later = sceneOrder.slice(sceneOrder.indexOf(sid)+1).flatMap(bedUrls);
    bedUrls(sid).forEach(u=>{ if(later.indexOf(u)<0) delete buffers[u]; }); };
  const cancelled = ()=> !!(opts.shouldCancel && opts.shouldCancel());
  const LOAD_TIMEOUT_MS = Number(opts.loadTimeoutMs)||30000, STALL_MS = Number(opts.stallMs)||20000;
  /* A CLIP THAT NEVER LOADS NO LONGER HANGS THE EXPORT (2026-10-09, Timeline review): it times out, Cancel
     works while it loads, and the message names the clip */
  const loadClip = (item)=> new Promise((res,rej)=>{
    const name = (item && item.name) || (item && item.label) || "a clip";
    let done = false;
    const end = (fn, v)=>{ if(done) return; done = true; clearInterval(poll); clearTimeout(timer); fn(v); };
    const poll = setInterval(()=>{ if(cancelled()) end(rej, new Error("Export cancelled.")); }, 250);
    const timer = setTimeout(()=>end(rej, new Error("The take for "+name+" didn't load (its link may have expired) \u2014 re-render that clip or try again.")), LOAD_TIMEOUT_MS);
    video.onloadedmetadata = ()=>end(res);
    video.onerror = ()=>end(rej, new Error("The take for "+name+" couldn't be loaded for export \u2014 its video link may have expired. Re-render that clip and try again."));
    video.src = item && item.url; video.load();
  });
  let raf = 0, failed = null, taintChecked = false, rec = null, stream = null, hidden = false, onVis = null;
  // ONE finalization path — every exit (success, cancel, load failure, CORS
  // taint) lands in `finally`, which must also stop the recorder and capture
  // tracks or a cancelled export leaks a live recorder + camera-style tracks.
  const cleanup = ()=>{ try{ cancelAnimationFrame(raf); }catch(e){} try{ clearTimeout(raf); }catch(e){}
    try{ if(onVis) document.removeEventListener("visibilitychange", onVis); }catch(e){}
    try{ if(rec && rec.state!=="inactive") rec.stop(); }catch(e){}
    try{ if(stream) stream.getTracks().forEach(t=>t.stop()); }catch(e){}
    try{ video.pause(); video.removeAttribute("src"); video.load(); }catch(e){}
    sources.forEach(sn=>{ try{ sn.stop(); }catch(e){} });
    try{ srcNode.disconnect(); }catch(e){}
    try{ ac.close(); }catch(e){} };
  try{
    if(mix){   // read every line, and the first scene's beds, up front, so nothing stalls once recording runs
      const urls = [];
      (mix.items||[]).forEach(it=>{ (it.lines||[]).forEach(l=>urls.push(l.url)); });
      if(sceneOrder.length) urls.push(...bedUrls(sceneOrder[0]));
      if(opts.onProgress) opts.onProgress(0, playlist.length, "", "preparing");
      for(const u of urls){ if(cancelled()) throw new Error("Export cancelled."); await decode(u); }
    }
    await loadClip(playlist[0]);
    const vw = video.videoWidth||1280, vh = video.videoHeight||720;
    const scale = Math.min(1, 1920/Math.max(vw,vh));
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(vw*scale/2)*2); cv.height = Math.max(2, Math.round(vh*scale/2)*2);
    const cx = cv.getContext("2d");
    cx.fillStyle = "#000"; cx.fillRect(0,0,cv.width,cv.height);
    // WebM where the browser records it, else MP4 (older Safari) — the file is typed and named by what it is
    const mime = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4;codecs=avc1,mp4a","video/mp4"]
      .find(m=>{ try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || "";
    stream = cv.captureStream(30);
    dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
    rec = new MediaRecorder(stream, mime ? { mimeType:mime, videoBitsPerSecond:8000000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };
    // a recorder that fails partway never hands back a cut-short file as a success
    rec.onerror = ()=>{ if(!failed) failed = new Error("The recording stopped with an error, so the film wasn't saved \u2014 try again."); };
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
      // a timer, not requestAnimationFrame alone: frames keep being drawn while the page is busy
      raf = setTimeout(draw, 33);
    };
    /* A HIDDEN TAB PAUSES THE RECORDING (2026-10-09, Timeline review): browsers stop drawing a hidden page,
       so the film froze while its sound ran on. Now the picture, the sound, the recorder and the mix's
       clock all pause together while the tab is hidden, and pick up where they were when it's back. */
    onVis = ()=>{
      const h = document.visibilityState==="hidden";
      if(h===hidden) return; hidden = h;
      try{
        if(h){ video.pause(); if(rec && rec.state==="recording") rec.pause(); ac.suspend(); }
        else { ac.resume(); if(rec && rec.state==="paused") rec.resume(); if(!video.ended) video.play().catch(()=>{}); }
      }catch(e){}
      if(opts.onPaused) opts.onPaused(h);
    };
    try{ document.addEventListener("visibilitychange", onVis); }catch(e){}
    try{ await ac.resume(); }catch(e){}
    rec.start(1000);
    draw();
    for(let i=0;i<playlist.length;i++){
      if(failed) break;
      if(cancelled()) throw new Error("Export cancelled.");
      if(i>0) await loadClip(playlist[i]);
      if(opts.onProgress) opts.onProgress(i+1, playlist.length, playlist[i].name||playlist[i].label, "recording");
      while(hidden && !cancelled()) await new Promise(r=>setTimeout(r, 250));   // wait for the tab to come back
      const item = mixById[playlist[i].id];
      if(mix && item && item.sceneId!==bedScene){
        await loadBeds(item.sceneId);   // read while the scene before played (or now, for the first)
        if(bedScene) releaseBeds(bedScene);
        const nextScene = sceneOrder[sceneOrder.indexOf(item.sceneId)+1];
        if(nextScene) loadBeds(nextScene);   // read the next scene's beds while this one plays
      }
      await video.play();
      startClipAudio(item);
      const name = playlist[i].name || playlist[i].label || "a clip";
      /* the clip plays to its end; an error or a stall (no progress for a while, tab visible) stops the
         export with the clip's name instead of recording frozen frames until you cancel */
      await new Promise((res, rej)=>{
        let lastT = -1, lastMove = Date.now();
        const tick = setInterval(()=>{
          if(failed || cancelled()){ clearInterval(tick); res(); return; }
          if(hidden){ lastMove = Date.now(); return; }
          const t = Number(video.currentTime)||0;
          if(t!==lastT){ lastT = t; lastMove = Date.now(); }
          else if(Date.now()-lastMove > STALL_MS){ clearInterval(tick); rej(new Error("The take for "+name+" stopped playing partway, so the export was stopped \u2014 try again, or re-render that clip.")); }
        }, 250);
        video.onended = ()=>{ clearInterval(tick); stopClipLines(); res(); };
        video.onerror = ()=>{ clearInterval(tick); rej(new Error("The take for "+name+" failed while recording \u2014 its link may have expired. Re-render that clip and try again.")); };
      });
    }
    if(!failed && opts.shouldCancel && opts.shouldCancel()) failed = new Error("Export cancelled.");
    try{ rec.stop(); }catch(e){}
    await recStopped;
    if(failed) throw failed;
    if(!chunks.length) throw new Error("The recording came out empty — try again, or use a Chromium browser (Chrome/Edge).");
    if(opts.report) opts.report.audioMissed = audioMissed;
    return new Blob(chunks, { type: (rec && rec.mimeType) || mime || "video/webm" });
  } finally { cleanup(); }
}
window.stageExportFilm = stageExportFilm;

/* ---- TIMELINE tab — the FILM ASSEMBLY. Every clip in story order, grouped by scene,
   playing the CURRENT take back-to-back ("Choose for timeline" in Takes decides what
   plays). Read-only on purpose: the story defines the order; the Stage tab renders,
   the Takes tab picks takes, this tab watches the film. ---- */
/* ONE NAME FOR A CLIP (2026-10-05, owner — Stage review): Shoot speaks in beats ("Beat 4"), the
   Timeline and Mix in clip codes ("03A") — so the codes now carry their beats: "03A · Beat 4". */
function stageClipBeatName(c){
  const ns = Array.from(new Set(((c && c.g && c.g.shots) || []).map(sh=>Number(sh && sh.beatN)).filter(n=>n>0))).sort((a,b)=>a-b);
  const beats = !ns.length ? "" : ns.length===1 ? "Beat "+ns[0] : "Beats "+ns[0]+"\u2013"+ns[ns.length-1];
  return (c && c.label || "") + (beats ? " \u00b7 "+beats : "");
}
window.stageClipBeatName = stageClipBeatName;
function StageTimelineView({ allClips, vids, staleVids, identityVids, imgs, visualSource, selId, onSelectClip, onOpenStage, filmTitle, auds, characters, oldLookVids, noteVids, vidsLoaded=true }){
  const ordered = allClips||[];
  /* THE SELECTION IS THE RAIL'S (2026-10-09, Timeline review): the clip shown is found by its id on every
     render — a stored position drifted to another clip (or past the end: "No clips yet.") when shot edits
     changed the clip list */
  const [localId, setLocalId] = React.useState(selId||null);
  const pickId = (selId && ordered.some(c=>c.id===selId)) ? selId : localId;
  const idx = Math.max(0, ordered.findIndex(c=>c.id===pickId));
  const [playAll, setPlayAll] = React.useState(false);
  const [playErr, setPlayErr] = React.useState("");   // the selected take couldn't be played
  const videoRef = React.useRef(null);
  const autoPlayIdRef = React.useRef("");              // play this clip as soon as its video can play
  const [exporting, setExporting] = React.useState(null);   // { i, n, phase, name, paused } while recording
  const exportCancelRef = React.useRef(false);
  const exportBusyRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  /* LEAVING THE TIMELINE STOPS AN EXPORT (2026-10-09, owner — Timeline review): a recording left running
     after a tab or film switch had no progress or Cancel, could run twice, and downloaded into the next film */
  React.useEffect(()=>{ mountedRef.current = true; return ()=>{ mountedRef.current = false;
    if(exportBusyRef.current){ exportCancelRef.current = true;
      if(typeof window.appToast==="function") window.appToast("Film export stopped — leaving the Timeline stops the recording. Start it again from the Timeline.","info"); } }; }, []);
  const takeSecs = (c)=>{ const m = (typeof vidGetMeta==="function") ? vidGetMeta(c.id) : null;
    const v = m ? (Number(m.durationSec) || Number(m.durationMs)/1000) : 0; return v>0 ? v : (Number(c.data&&c.data.dur)||0); };
  const doExport = async ()=>{
    if(exportBusyRef.current) return;   // a double-click never starts two recordings
    const pl = stageExportPlaylist(ordered, vids);
    if(!pl.length) return;
    exportBusyRef.current = true;
    try{
    // the Mix, the clips left out, the takes going in with notes, and how to keep it going — said BEFORE recording
    const skipped = stageExportSkipped(ordered, vids, staleVids, identityVids);
    let mix = null;
    try{ const st = stageMixSettings();
      const plan = stageExportMixPlan(ordered, vids, { auds, characters, beds:await stageLoadMixBeds(ordered), gain:st.gain, mute:st.mute, gainSet:st.set });
      if(plan.has) mix = plan; }catch(e){}
    if(!mountedRef.current) return;
    const lookN = pl.filter(x=>(oldLookVids||{})[x.id]).length, notedN = pl.filter(x=>(noteVids||{})[x.id]).length;
    const filmSec = pl.reduce((t,x)=>{ const c = ordered.find(y=>y.id===x.id); return t+(c ? takeSecs(c) : 0); }, 0);
    const notes = [];
    if(skipped.length) notes.push((skipped.length>12 ? "…and "+(skipped.length-12)+" more left out. " : "")+"The film is stitched from the "+pl.length+" clip"+(pl.length!==1?"s":"")+" that have a current take.");
    if(lookN) notes.push(lookN+" clip"+(lookN!==1?"s use takes":" uses a take")+" made with an earlier look (included).");
    if(notedN) notes.push(notedN+" clip"+(notedN!==1?"s have":" has")+" take notes in Takes (included).");
    if(!mix) notes.push("Nothing in the Mix changes this film's sound (no voiced lines, beds or Picture level you set), so each take's sound is recorded as it was rendered.");
    notes.push("It records in real time (about "+_fmtSecs(Math.round(filmSec))+"): keep this tab open and in front — the recording pauses while the tab is hidden, and leaving the Timeline stops it.");
    if(filmSec>600) notes.push("A long film is held in memory while it records (about 60 MB a minute).");
    if(typeof window.appConfirm==="function"){
      const what = mix ? [mix.lineN ? mix.lineN+" voiced line"+(mix.lineN!==1?"s":"") : "", mix.bedN ? mix.bedN+" imported bed"+(mix.bedN!==1?"s":"") : ""].filter(Boolean).join(" and ") : "";
      const ans = await window.appConfirm({
        title: mix ? "Export the film with the Mix?" : "Export the film?",
        body: mix ? "With the Mix, each take's own sound plays at the Picture volume, with "+what+" on top at the Mix tab's levels — what \"Play scene mix\" plays. \"Picture sound only\" keeps each take's sound as it was rendered." : "",
        items: skipped.length ? skipped.slice(0,12).map(x=>x.name+" — "+x.why+", left out") : undefined,
        note: notes.join(" "),
        confirmLabel: mix ? "Export with the Mix" : "Export", altLabel: mix ? "Picture sound only" : undefined, cancelLabel:"Cancel" });
      if(!ans) return;
      if(ans==="alt") mix = null;
    }
    if(!mountedRef.current) return;
    exportCancelRef.current = false;
    setExporting({ i:0, n:pl.length, phase:"preparing" });
    const report = {};
    try{
      const blob = await stageExportFilm(pl, {
        mix, report,
        onProgress:(i,n,name,phase)=>{ if(mountedRef.current) setExporting(x=>({ ...(x||{}), i, n, name:name||"", phase:phase||"recording" })); },
        onPaused:(p)=>{ if(mountedRef.current) setExporting(x=>x ? ({ ...x, paused:!!p }) : x); },
        shouldCancel:()=>exportCancelRef.current });
      if(!mountedRef.current) return;   // left mid-export: nothing downloads into another tab or film
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ext = stageFilmExt(blob.type);
      a.download = stageFilmFileName(filmTitle, new Date().toISOString().slice(0,10), ext);
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 60000);
      const left = stageExportSkippedText(skipped);
      if(typeof window.appToast==="function") window.appToast("Film exported"+(mix?" with the Mix":"")+" — "+pl.length+" clip"+(pl.length!==1?"s":"")+" stitched into one "+ext.toUpperCase()+" file."
        +(left ? " "+left+"." : "")
        +(report.audioMissed ? " "+report.audioMissed+" audio file"+(report.audioMissed!==1?"s":"")+" couldn't be read and "+(report.audioMissed!==1?"were":"was")+" left out of the mix." : ""), (left||report.audioMissed)?"info":"success");
    }catch(e){
      if(mountedRef.current && !/cancelled/i.test(String(e&&e.message)) && typeof window.appToast==="function")
        window.appToast(String((e&&e.message)||"Export failed."),"error");
    }finally{ if(mountedRef.current) setExporting(null); exportCancelRef.current = false; }
    } finally { exportBusyRef.current = false; }
  };
  const cur = ordered[idx] || null;
  const curUrl = cur ? (vids[cur.id]||"") : "";
  React.useEffect(()=>{ setPlayErr(""); }, [curUrl]);
  const renderedN = ordered.filter(c=>vids[c.id]).length;
  const staleN = ordered.filter(c=>!vids[c.id] && ((staleVids||{})[c.id] || (identityVids||{})[c.id])).length;
  // the runtime of the takes that play (their real length), against the planned length of the film
  const totalSec = ordered.reduce((t,c)=>t+(Number(c.data&&c.data.dur)||0),0);
  const doneSec = ordered.reduce((t,c)=>t+(vids[c.id]?takeSecs(c):0),0);
  const thumbs = stageImgsWithCache(imgs);   // every scene's thumbnails, not only the open one's (2026-10-09)
  /* PLAY FILM (2026-10-09, Timeline review): from the first rendered clip, like the export; each clip starts
     as soon as its video can play (a fixed 60 ms wait could hit the old player and stop the film); a take
     that can't play is skipped and named; pausing or picking a clip stops it; the button is a Stop */
  const select = (i)=>{ const c = ordered[i]; if(!c) return; setLocalId(c.id); if(onSelectClip) onSelectClip(c.id); };
  const jump = (i, autoplay)=>{ const c = ordered[i]; if(!c) return;
    autoPlayIdRef.current = autoplay ? c.id : "";
    select(i);
    if(autoplay && c.id===(cur&&cur.id) && videoRef.current){ try{ videoRef.current.currentTime = 0; const pr = videoRef.current.play(); if(pr && pr.catch) pr.catch(()=>{}); }catch(e){} autoPlayIdRef.current = ""; } };
  const nextPlayable = (from)=>{ for(let i=from+1;i<ordered.length;i++){ if(vids[ordered[i].id]) return i; } return -1; };
  const stopFilm = ()=>{ setPlayAll(false); autoPlayIdRef.current = ""; try{ videoRef.current && videoRef.current.pause(); }catch(e){} };
  const onEnded = ()=>{ if(!playAll) return; const n = nextPlayable(idx); if(n>=0) jump(n, true); else setPlayAll(false); };
  const onCanPlay = (e)=>{ if(cur && autoPlayIdRef.current===cur.id){ autoPlayIdRef.current = "";
    try{ const pr = e.currentTarget.play(); if(pr && pr.catch) pr.catch(()=>{}); }catch(err){} } };
  const onPause = (e)=>{ const v = e.currentTarget; if(playAll && v && !v.ended && !autoPlayIdRef.current) setPlayAll(false); };
  const onVideoError = ()=>{
    const name = cur ? stageClipBeatName(cur) : "This clip";
    setPlayErr(name+"'s take couldn't be played — its link may have expired. Reload the film, or re-render the clip in Shoot.");
    if(playAll){ const n = nextPlayable(idx);
      if(typeof window.appToast==="function") window.appToast(name+"'s take couldn't be played — skipped.","info");
      if(n>=0) jump(n, true); else setPlayAll(false); } };
  const playFilm = ()=>{ const first = nextPlayable(-1); if(first<0) return; setPlayAll(true); jump(first, true); };
  const statusOf = (c)=> vids[c.id] ? "" : (identityVids||{})[c.id] ? "identity" : (staleVids||{})[c.id] ? "stale" : "missing";
  // scene grouping for the strip
  const groups = []; ordered.forEach((c,i)=>{ const last=groups[groups.length-1];
    if(last && last.scene.id===c.scene.id) last.items.push({c,i});
    else groups.push({ scene:c.scene, items:[{c,i}] }); });
  const exportLabel = !exporting ? "⬇ Export film"
    : exporting.phase==="preparing" ? "■ Preparing the sound…"
    : exporting.paused ? ("■ Paused "+exporting.i+"/"+exporting.n+" (tab hidden)")
    : ("■ Recording "+exporting.i+"/"+exporting.n+"…");
  const liveText = exporting
    ? (exporting.phase==="preparing" ? "Preparing the film's sound" : exporting.paused ? "Recording paused while the tab is hidden"
      : "Recording clip "+exporting.i+" of "+exporting.n+(exporting.name ? ", "+exporting.name : ""))
    : (playAll && cur ? "Playing the film: "+stageClipBeatName(cur) : "");
  return _stEl("div",{className:"stage2-tl"},
    _stEl("div",{className:"stage2-versions-head"},
      _stEl("div",{className:"stage2-versions-title"}, Icon.grid&&_stEl(Icon.grid,{s:14}), "Timeline",
        _stEl("span",{className:"stage2-versions-sub"},"the film, assembled from each clip's current take")),
      _stEl("span",{className:"stage2-versions-count"},
        !vidsLoaded ? "Loading takes…"
        : renderedN+" / "+ordered.length+" clips rendered · "+_fmtSecs(Math.round(doneSec))+" of ~"+_fmtSecs(totalSec)
          +(staleN ? " · "+staleN+" out of date" : "")
          +(()=>{ const n = ordered.filter(c=>(oldLookVids||{})[c.id]).length; return n ? " · "+n+" with an earlier look" : ""; })()
          +(()=>{ const n = ordered.filter(c=>(noteVids||{})[c.id]).length; return n ? " · "+n+" with take notes" : ""; })()),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},type:"button",disabled:!renderedN && !playAll,
        title:playAll ? "Stop playing the film" : (renderedN?"Play every rendered clip in story order, from the first":"Render clips in the Shoot tab first"),
        onClick:playAll ? stopFilm : playFilm}, playAll?"■ Stop film":"▶ Play film"),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},type:"button",disabled:(!renderedN || !vidsLoaded) && !exporting,
        title: exporting ? "Recording in real time — click to cancel the export"
          : (renderedN ? "Record every rendered clip into ONE downloadable movie, with the Mix tab's voices, beds and levels if you like. Runs in real time — a 3-minute film takes about 3 minutes; keep this tab open and in front." : "Render clips in the Shoot tab first"),
        onClick: exporting ? ()=>{ exportCancelRef.current = true; } : doExport},
        exportLabel),
      // the selected clip opens in Shoot from a button too — double-click was the only way (2026-10-09)
      cur && vids[cur.id] && _stEl("button",{className:"stage2-vtool",style:{width:"auto"},type:"button",
        title:"Open "+stageClipBeatName(cur)+" in Shoot"+(((oldLookVids||{})[cur.id] || (noteVids||{})[cur.id]) ? " to regenerate it" : ""),
        onClick:()=>onOpenStage&&onOpenStage(cur.id)}, "Open in Shoot")),
    _stEl("div",{className:"sb-sr-only",role:"status","aria-live":"polite"}, liveText),
    _stEl("div",{className:"stage2-tl-player"},
      curUrl && !playErr
        ? _stEl("video",{key:curUrl,ref:videoRef,src:curUrl,controls:true,playsInline:true,onEnded,onCanPlay,onPause,onError:onVideoError,
            "aria-label":cur ? ("Timeline — "+stageClipBeatName(cur)) : "Timeline",
            title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget),
            poster:cur?clipPrimaryFrame(cur, thumbs, visualSource)||undefined:undefined})
        : _stEl("div",{className:"stage2-tl-empty"},
            _stEl("div",null,(!cur ? "No clips yet."
              : playErr ? playErr
              : !vidsLoaded ? "Loading takes…"
              : (identityVids||{})[cur.id]
              ? stageClipBeatName(cur)+"'s take finished after a character's identity changed — check it in Takes (\u201cCheck and use this take\u201d) to put it back in the film."
              : (staleVids||{})[cur.id]
              ? stageClipBeatName(cur)+"'s take is out of date — its shots changed since it was rendered, so it's left out of the film."
              : stageClipBeatName(cur)+" isn't rendered yet.")),
            cur && vidsLoaded && _stEl("button",{className:"stage2-vtool",style:{width:"auto"},type:"button",onClick:()=>onOpenStage&&onOpenStage(cur.id)},
              ((staleVids||{})[cur.id] || playErr) ? "Regenerate it in Shoot" : "Render it in Shoot"))),
    _stEl("div",{className:"stage2-tl-strip"},
      groups.map(g=>_stEl("div",{key:g.scene.id,className:"stage2-tl-scene",role:"group","aria-label":"Scene "+_pad2(g.scene.no)},
        _stEl("div",{className:"stage2-tl-scene-lab"},_pad2(g.scene.no)+" · "+(g.scene.title||g.scene.loc||"Scene")),
        _stEl("div",{className:"stage2-tl-clips"},
          g.items.map(({c,i})=>{
            const has = !!vids[c.id], st = statusOf(c);
            const look = has && (oldLookVids||{})[c.id], noted = has && (noteVids||{})[c.id];
            const thumb = clipPrimaryFrame(c, thumbs, visualSource);
            const state = has ? (look ? "made with an earlier look (still in the film)" : "in the film")
              : st==="identity" ? "identity changed — check it in Takes" : st==="stale" ? "out of date (left out)" : "not rendered yet";
            return _stEl("button",{key:c.id,type:"button","aria-pressed":i===idx ? "true" : "false",
              "aria-label":stageClipBeatName(c)+", "+state+(noted ? ", take notes: "+noted.join(", ") : ""),
              className:"stage2-tl-clip"+(i===idx?" on":"")+(has?"":" missing")+(st==="stale"||st==="identity"?" stale":"")+(look?" old-look":"")+(noted?" noted":""),
              title:stageClipBeatName(c)+" — "+state+" · click to select, double-click to open it in Shoot"
                +(noted ? " · "+noted.join(", ") : ""),
              onClick:()=>{ if(playAll) stopFilm(); select(i); }, onDoubleClick:()=>onOpenStage&&onOpenStage(c.id)},
              thumb ? _stEl("img",{src:thumb,alt:""}) : _stEl("span",{className:"stage2-tl-clip-blank"}),
              _stEl("span",{className:"stage2-tl-clip-lab"}, stageClipBeatName(c)+" · "+_fmtSecs(Math.round(has ? takeSecs(c) : (Number(c.data&&c.data.dur)||0)))),
              _stEl("span",{className:"stage2-tl-dot"+(has?" ok":"")+(st==="stale"||st==="identity"?" stale":"")})); }))))));
}

/* ---- AUDIO tab — the POST MIX. Generation audio is a scratch track; this is where the
   real sound happens: the voiced lines auto-placed over the picture (same CLIP_AIR walk
   the prompts used), the clip's native mix duckable under them, and imported ambience /
   music beds per scene. Levels and beds are kept per film on this device, and Export film
   (Timeline) can record the whole film with this mix (2026-10-05). ---- */
function StageAudioView({ allClips, vids, staleVids, identityVids, noteVids, vidsLoaded=true, auds, characters, selId, onSelectClip }){
  const scenes = []; (allClips||[]).forEach(c=>{ if(!scenes.some(s=>s.id===c.scene.id)) scenes.push(c.scene); });
  const selClip = (allClips||[]).find(c=>c.id===selId) || null;
  const selScene = (selClip||allClips[0]||{}).scene;
  const [sceneIdState, setSceneId] = React.useState(selScene ? selScene.id : (scenes[0]&&scenes[0].id));
  // a scene that's gone (deleted, or no clips any more) falls back to the rail's (2026-10-09)
  const sceneId = scenes.some(x=>x.id===sceneIdState) ? sceneIdState : (selScene ? selScene.id : (scenes[0]&&scenes[0].id));
  const sceneClips = (allClips||[]).filter(c=>c.scene.id===sceneId);
  // follow the rail selection while this tab is open
  React.useEffect(()=>{ if(selScene && selScene.id && selScene.id!==sceneId) setSceneId(selScene.id); },[selId]);
  // picking a scene here moves the rail too (2026-10-09 — the two showed different scenes)
  const pickScene = (id)=>{ setSceneId(id); const c = (allClips||[]).find(x=>x.scene.id===id); if(c && onSelectClip) onSelectClip(c.id); };
  // mix settings survive the session — per film, on this device
  const mixKey = stageMixKey();
  const [gain, setGain] = React.useState(()=>stageMixSettings().gain);
  const [mute, setMute] = React.useState(()=>stageMixSettings().mute);
  const [gainSet, setGainSet] = React.useState(()=>stageMixSettings().set);
  React.useEffect(()=>{ try{ localStorage.setItem(mixKey, JSON.stringify({ gain, mute, set:gainSet })); }catch(e){} },[gain,mute,gainSet,mixKey]);
  const levelRef = React.useRef({ gain, mute }); levelRef.current = { gain, mute };
  const g = (k)=>{ const L = levelRef.current; return L.mute[k] ? 0 : L.gain[k]; };   // always the CURRENT level
  // the open scene's imported beds, kept with the film on this device: {sceneId:{amb:{url,name}, music:{url,name}}}
  const [beds, setBeds] = React.useState({});
  const filmAtMount = React.useRef((typeof window!=="undefined" && window.__turnCurrentProjectId) || null);
  // only the open scene's beds are read, and merged in (an import made meanwhile stays — 2026-10-09)
  React.useEffect(()=>{ let on = true; if(!sceneId) return undefined;
    stageLoadMixBeds(sceneClips, [sceneId]).then(b=>{ if(on) setBeds(x=>({ ...x, [sceneId]:{ ...(b[sceneId]||{}), ...(x[sceneId]||{}) } })); }).catch(()=>{});
    return ()=>{ on = false; }; },[mixKey, sceneId]);
  const sceneBeds = (sceneId && beds[sceneId]) || {};
  const firstRendered = Math.max(0, sceneClips.findIndex(c=>vids[c.id]));
  const selInScene = selClip ? sceneClips.findIndex(c=>c.id===selClip.id) : -1;
  // the clip shown: the playing one; else the rail's clip when it's rendered; else the scene's first rendered one
  const [clipIdx, setClipIdx] = React.useState(-1);
  const [playing, setPlaying] = React.useState(false);
  const shownIdx = (clipIdx>=0 && clipIdx<sceneClips.length) ? clipIdx
    : (selInScene>=0 && vids[sceneClips[selInScene].id]) ? selInScene : firstRendered;
  const videoRef = React.useRef(null);
  const bedRefs = { amb:React.useRef(null), music:React.useRef(null) };
  const live = React.useRef({ timers:[], audios:[] });
  const startOnPlayRef = React.useRef("");   // play this clip as soon as it can
  const stopLines = ()=>{ live.current.timers.forEach(clearTimeout); live.current.audios.forEach(a=>{ try{ a.pause(); }catch(e){} });
    live.current = { timers:[], audios:[] }; };
  const pauseBeds = ()=>{ Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el){ try{ el.pause(); }catch(e){} } }); };
  const playBeds = ()=>{ Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el && sceneBeds[k]){ el.volume=g(k); el.play().catch(()=>{}); } }); };
  /* LINES FOLLOW THE PICTURE'S OWN TIME (2026-10-09, owner — Mix review): they were wall-clock timers from the
     moment Play was pressed, so a take that buffered put every line early, and pausing or seeking the video
     left lines and beds running. Now each line is placed from the video's current time whenever it plays,
     seeks or resumes, and stops when it pauses; a line that would run past the take's end stops there. */
  const syncLines = (clip, v)=>{
    stopLines();
    if(!clip || !v) return;
    const from = Number(v.currentTime)||0;
    const end = Number(v.duration)||0;
    stageTakeLinePlacements(clip, auds, characters).forEach(pl=>{ if(!pl.url) return;
      if(from >= pl.at+pl.sec) return;
      const startIn = Math.max(0, pl.at-from), offset = Math.max(0, from-pl.at);
      const t = setTimeout(()=>{ const a = new Audio(pl.url); a.volume = g("dialogue");
        if(offset>0){ try{ a.currentTime = offset; }catch(e){} }
        live.current.audios.push(a);
        a.play().catch(()=>{ if(typeof window.appToast==="function") window.appToast((pl.speaker||"A")+"'s line couldn't be played.","info"); });
        if(end>0){ const stopT = setTimeout(()=>{ try{ a.pause(); }catch(e){} }, Math.max(0, (end-pl.at-offset)*1000)); live.current.timers.push(stopT); }
      }, Math.round(startIn*1000));
      live.current.timers.push(t); });
  };
  const stopAll = ()=>{ setPlaying(false); stopLines(); startOnPlayRef.current = "";
    try{ videoRef.current && videoRef.current.pause(); }catch(e){}
    pauseBeds(); };
  const playScene = ()=>{ if(!sceneClips.length) return;
    const first = sceneClips.findIndex(c=>vids[c.id]); if(first<0) return;
    setPlaying(true);
    Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el && sceneBeds[k]){ try{ el.currentTime=0; }catch(e){} } });
    if(first===shownIdx && videoRef.current){ try{ videoRef.current.currentTime = 0; videoRef.current.volume = g("native"); videoRef.current.play().catch(()=>{}); }catch(e){} }
    else { startOnPlayRef.current = sceneClips[first].id; setClipIdx(first); }
  };
  const nextRendered = (from)=>{ for(let i=from+1;i<sceneClips.length;i++){ if(vids[sceneClips[i].id]) return i; } return -1; };
  const onClipEnded = ()=>{ stopLines(); if(!playing){ pauseBeds(); return; }
    const n = nextRendered(shownIdx);
    if(n<0){ stopAll(); return; }
    startOnPlayRef.current = sceneClips[n].id; setClipIdx(n); };
  // the media's own events drive the mix: play/seek → place the lines from here; pause → everything waits
  const onVideoPlay = (e)=>{ const v = e.currentTarget; v.volume = g("native"); playBeds(); syncLines(sceneClips[shownIdx], v); };
  const onVideoPause = (e)=>{ const v = e.currentTarget; if(v.ended) return; stopLines(); pauseBeds(); if(playing && !startOnPlayRef.current) setPlaying(false); };
  const onVideoSeeked = (e)=>{ const v = e.currentTarget; if(!v.paused) syncLines(sceneClips[shownIdx], v); };
  const onCanPlay = (e)=>{ const c = sceneClips[shownIdx]; if(c && startOnPlayRef.current===c.id){ startOnPlayRef.current = "";
    const v = e.currentTarget; v.volume = g("native"); v.play().catch(()=>{}); } };
  // a take that can't be played is named and skipped (it used to hang the scene mix with the beds running)
  const onVideoError = ()=>{ const c = sceneClips[shownIdx];
    if(typeof window.appToast==="function") window.appToast((c ? stageClipBeatName(c) : "A clip")+"'s take couldn't be played — its link may have expired."+(playing ? " Skipped." : ""),"info");
    if(!playing) return; stopLines(); const n = nextRendered(shownIdx);
    if(n<0){ stopAll(); return; } startOnPlayRef.current = sceneClips[n].id; setClipIdx(n); };
  // a hidden tab pauses the mix (the picture's pause event stops the lines and beds)
  React.useEffect(()=>{ const h=()=>{ if(document.visibilityState==="hidden"){ try{ videoRef.current && videoRef.current.pause(); }catch(e){} stopLines(); pauseBeds(); } };
    document.addEventListener("visibilitychange", h); return ()=>document.removeEventListener("visibilitychange", h); }, []);
  React.useEffect(()=>()=>stopAll(), []);
  React.useEffect(()=>{ stopAll(); setClipIdx(-1); }, [sceneId]);
  // live volume updates (lines not started yet read the current level when they start)
  React.useEffect(()=>{ const v=videoRef.current; if(v) v.volume=g("native");
    Object.keys(bedRefs).forEach(k=>{ const el=bedRefs[k].current; if(el) el.volume=g(k); });
    live.current.audios.forEach(a=>{ a.volume=g("dialogue"); });
  }, [gain, mute]);
  const toast = (m, kind)=>{ if(typeof window.appToast==="function") window.appToast(m, kind); };
  const filmNow = ()=> (typeof window!=="undefined" && window.__turnCurrentProjectId) || null;
  const importBed = (k)=>async (e)=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f || !sceneId) return;
    if(f.size > (Number(window.VG_MIX_BED_MAX_BYTES)||50*1024*1024)){ toast("That file is over 50 MB — use a shorter or compressed one (MP3 or AAC).","error"); return; }
    // a file this browser can't play is refused up front (it used to import, then play silent)
    const probe = document.createElement("audio");
    if(f.type && probe.canPlayType && !probe.canPlayType(f.type)){ toast("This browser can't play “"+f.name+"” — use an MP3, AAC, WAV or OGG file.","error"); return; }
    const sid = sceneId, film = filmNow();
    const url = URL.createObjectURL(f);
    setBeds(b=>({ ...b, [sid]:{ ...(b[sid]||{}), [k]:{ url, name:f.name } } }));
    try{ if(typeof window.vgSaveMixBed==="function") await window.vgSaveMixBed(sid, k, f, f.name, film); }
    catch(err){ toast("Couldn't keep “"+f.name+"” with the film on this device (its storage may be full) — it plays for this session only.","error"); } };
  // Remove can be undone: it deletes this device's copy of the file (for the film you're in, even after a switch)
  const removeBed = async (k)=>{ const sid = sceneId, film = filmNow(); const el = bedRefs[k].current; if(el){ try{ el.pause(); }catch(e){} }
    const old = (beds[sid]||{})[k] || null;
    let keptFile = null;
    try{ const r = old && old.url ? await fetch(old.url) : null; keptFile = r ? await r.blob() : null; }catch(e){ keptFile = null; }
    setBeds(b=>{ const n = { ...(b[sid]||{}) }; delete n[k]; return { ...b, [sid]:n }; });
    try{ if(typeof window.vgClearMixBed==="function") await window.vgClearMixBed(sid, k, film); }
    catch(e){ toast("Couldn't remove the copy kept on this device — it may come back after a reload.","error"); }
    if(old && typeof window.appToast==="function") window.appToast("“"+old.name+"” taken out of the mix.","info",{ action:{ label:"Undo", onClick:async()=>{
      const back = keptFile ? { url:URL.createObjectURL(keptFile), name:old.name } : old;
      setBeds(b=>({ ...b, [sid]:{ ...(b[sid]||{}), [k]:back } }));
      try{ if(typeof window.vgSaveMixBed==="function") await window.vgSaveMixBed(sid, k, keptFile || old.url, old.name, film); }
      catch(e){ toast("Couldn't keep “"+old.name+"” on this device again (its storage may be full) — it plays for this session only.","error"); } } } }); };
  const statusOf = (c)=> vids[c.id] ? "" : (identityVids||{})[c.id] ? "identity changed — check it in Takes" : (staleVids||{})[c.id] ? "out of date (left out)" : "not rendered";
  const cur = sceneClips[shownIdx];
  const curUrl = cur ? (vids[cur.id]||"") : "";
  const levelText = (v)=> Math.round((Number(v)||0)*100)+"%";
  const lane = (key, label, extra)=>_stEl("div",{className:"stage2-au-lane",role:"group","aria-label":label},
    _stEl("div",{className:"stage2-au-lane-h"},
      _stEl("b",{id:"au-lab-"+key},label),
      _stEl("button",{type:"button",className:"stage2-au-mute"+(mute[key]?" on":""),"aria-pressed":mute[key]?"true":"false",
        "aria-label":"Mute "+label,title:mute[key]?"Unmute":"Mute",
        onClick:()=>{ setMute(m=>({ ...m, [key]:!m[key] })); setGainSet(x=>({ ...x, [key]:true })); }}, mute[key]?"Muted":"🔊"),
      _stEl("input",{type:"range",min:0,max:1,step:0.05,value:gain[key],"aria-labelledby":"au-lab-"+key,"aria-valuetext":levelText(gain[key]),
        title:label+" level "+levelText(gain[key]),
        onChange:e=>{ const v = Number(e.target.value); setGain(x=>({ ...x, [key]:v })); setGainSet(x=>({ ...x, [key]:true })); }})),
    extra);
  const bedLane = (k, label, empty, loop)=>lane(k, label,
    _stEl("div",{className:"stage2-au-blocks"},
      sceneBeds[k] ? _stEl("span",{className:"stage2-au-block bed",title:sceneBeds[k].name}, sceneBeds[k].name.slice(0,34)) : _stEl("span",{className:"stage2-au-note"},empty),
      // a real button opens the file picker, so the keyboard reaches it (a label around a hidden input didn't)
      _stEl("button",{type:"button",className:"stage2-au-import",onClick:(e)=>{ const inp=e.currentTarget.nextSibling; if(inp && inp.click) inp.click(); }},
        sceneBeds[k] ? "Replace" : "Import audio"),
      _stEl("input",{type:"file",accept:"audio/*",style:{display:"none"},tabIndex:-1,"aria-hidden":"true",onChange:importBed(k)}),
      sceneBeds[k] && _stEl("button",{type:"button",className:"stage2-au-import",title:"Take this bed out of the scene's mix — the copy kept on this device is removed (Undo brings it back; your own file is untouched)",onClick:()=>removeBed(k)}, "Remove"),
      _stEl("audio",{ref:bedRefs[k],src:(sceneBeds[k]&&sceneBeds[k].url)||undefined,loop:!!loop})));
  const lines = sceneClips.flatMap(c=>vids[c.id] ? stageTakeLinePlacements(c, auds, characters).map(pl=>({ c, pl })) : []);
  const lineWhy = (pl)=> pl.native ? "this take's own performance already speaks it (native audio) — not laid over it"
    : pl.revoiced ? "re-voiced since this take was rendered — it would no longer match the lips; re-render the clip to use it"
    : !pl.url ? ((pl.audioState&&pl.audioState.reason)||"not voiced yet") : "";
  const hasRendered = sceneClips.some(c=>vids[c.id]);
  const emptyText = !vidsLoaded ? "Loading takes…"
    : !sceneClips.length ? "This scene has no clips yet."
    : sceneClips.some(c=>(staleVids||{})[c.id]) ? "None of this scene's takes can play: "+sceneClips.map(c=>stageClipBeatName(c)+" — "+statusOf(c)).join("; ")+"."
    : "This scene has no rendered clips yet — render them in the Shoot tab.";
  const voiceNotes = sceneClips.filter(c=>((noteVids||{})[c.id]||[]).indexOf("Voice changed")>=0);
  return _stEl("div",{className:"stage2-au"},
    _stEl("div",{className:"stage2-versions-head"},
      _stEl("div",{className:"stage2-versions-title"}, Icon.mic&&_stEl(Icon.mic,{s:14}), "Mix",
        _stEl("span",{className:"stage2-versions-sub"},"voiced lines over the picture · beds under them · exported with the film")),
      _stEl("select",{className:"stage2-au-scene",value:sceneId||"","aria-label":"Scene to mix",onChange:e=>pickScene(e.target.value)},
        scenes.map(s=>_stEl("option",{key:s.id,value:s.id},_pad2(s.no)+" · "+(s.title||s.loc||"Scene")))),
      _stEl("button",{className:"stage2-vtool",style:{width:"auto"},type:"button",
        onClick:playing?stopAll:playScene,
        disabled:!hasRendered && !playing,
        title:hasRendered?"Play the scene with the post mix":"Render this scene's clips first"},
        playing?"■ Stop":"▶ Play scene mix"),
      !hasRendered && vidsLoaded && _stEl("span",{className:"stage2-au-note"},"Render this scene's clips first")),
    _stEl("div",{className:"stage2-au-player"},
      curUrl ? _stEl("video",{key:curUrl,ref:videoRef,src:curUrl,controls:true,playsInline:true,onEnded:onClipEnded,
          onPlay:onVideoPlay,onPause:onVideoPause,onSeeked:onVideoSeeked,onCanPlay,onError:onVideoError,
          "aria-label":"Mix preview"+(cur ? " — "+stageClipBeatName(cur) : ""),
          title:"Double-click for full screen",onDoubleClick:(e)=>_stageVideoFullscreen(e.currentTarget)})
        : _stEl("div",{className:"stage2-tl-empty"}, emptyText)),
    voiceNotes.length>0 && _stEl("div",{className:"stage2-au-note"},
      "A voice was re-locked after "+voiceNotes.map(stageClipBeatName).join(", ")+(voiceNotes.length!==1?" were":" was")+" rendered — the take still speaks in the earlier voice."),
    _stEl("div",{className:"stage2-au-lanes"},
      lane("native","Picture (the take's own sound)",
        _stEl("div",{className:"stage2-au-blocks"}, sceneClips.map((c,i)=>_stEl("button",{key:c.id,type:"button",
          className:"stage2-au-block"+(vids[c.id]?"":" missing")+(cur&&cur.id===c.id?" on":""),
          "aria-pressed":cur&&cur.id===c.id?"true":"false",disabled:!vids[c.id],
          title:stageClipBeatName(c)+(vids[c.id]?" — click to show it":" — "+statusOf(c)),
          onClick:()=>{ if(!vids[c.id]) return; if(playing) stopAll(); setClipIdx(i); if(onSelectClip) onSelectClip(c.id); }}, stageClipBeatName(c))))),
      lane("dialogue","Dialogue (locked voices)",
        _stEl("div",{className:"stage2-au-blocks"}, lines.length ? lines.map(({c,pl})=>
          _stEl("span",{key:c.id+":"+pl.shotId,className:"stage2-au-block line"+(pl.url?"":" missing"),tabIndex:0,
            "aria-label":pl.speaker+", "+pl.sec+" seconds, lands about "+pl.at+" seconds into "+c.label+(lineWhy(pl)?", "+lineWhy(pl):"")+(pl.pastEnd?", runs past the take's end and stops there":""),
            title:pl.speaker+" — \""+pl.text.slice(0,60)+"\" · lands ~"+pl.at+"s into "+c.label
              +(lineWhy(pl)?(" · "+lineWhy(pl)):"")+(pl.pastEnd?" · runs past the take's end — it stops there":"")},
            pl.speaker+" · "+pl.sec+"s"+(pl.pastEnd?" →|":"")))
          : _stEl("span",{className:"stage2-au-note"}, sceneClips.some(c=>vids[c.id]) ? "No dialogue in this scene's rendered clips." : "Lines appear here once the scene's clips are rendered."))),
      bedLane("amb","Ambience bed","No bed yet — import a scene-long ambience file (it loops)",true),
      bedLane("music","Music bed","No bed yet — import a track (it plays once)",false)),
    _stEl("div",{className:"stage2-au-note foot"},
      "The picture plays each clip's current take with its own sound at the Picture volume; your voiced lines drop in where the render was told to put them, and stop at the end of their clip. Levels, mutes and each scene's imported beds are kept on this device only — collaborators don't hear them, and each person's export uses their own. Export film in the Timeline tab can record the whole film with this mix."));
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
      placeholder:props.placeholder,maxLength:max,spellCheck:false,title:props.title,readOnly:!!props.readOnly,
      "aria-label":props.ariaLabel||props.placeholder||undefined,
      onChange:(e)=>{ if(props.readOnly) return; props.setValue(e.target.value.slice(0,max));
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
              m.kind==="video" ? (Icon.film&&_stEl(Icon.film,{s:14})) : (Icon.mic&&_stEl(Icon.mic,{s:14}))),
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
function clipVoiceState(clip,auds,characters){
  const lines = ((clip&&clip.data&&clip.data.lineShots)||[]).filter(sh=>String(sh.dialogue||"").trim());
  if(!lines.length) return { key:"silent", label:"silent" };
  const ready = lines.filter(sh=>_shotAudioReady(sh,auds,characters)).length;
  if(ready===lines.length) return { key:"ready", label:"voice ✓" };
  if(ready>0) return { key:"partial", label:ready+"/"+lines.length+" voice" };
  return { key:"missing", label:"needs voice" };
}
function clipVideoReady(clip, vids){
  if(!clip) return false;
  // the Stage's vetted list (usable current takes) is the one answer — the rail used to call a take
  // flagged "identity changed" rendered while the Timeline left it out (2026-10-09)
  if(vids) return !!vids[clip.id];
  const url=(typeof vidGetVideo==="function")&&vidGetVideo(clip.id);
  if(!url) return false;
  const meta=(typeof vidGetMeta==="function")?vidGetMeta(clip.id):null;
  return typeof shotSourcesEditorialStatus!=="function"
    || ["current","override"].includes(shotSourcesEditorialStatus(
      ((clip.data||{}).shots)||[],((window.turnContinuity||{}).drafts||{}),meta));
}
/* The Shoot-room strip is the selected SCENE'S assembly preview, not a second
   version browser.  A clip's CURRENT take is the editorial choice used by the
   Timeline, Mix and export; Approved is a review star only.  Keep a stable slot
   for every planned clip so a new render fills its beat immediately and a
   missing/stale beat never disappears from the scene's shape. */
function stageSceneBeatTakeSlots(sceneClips,drafts,takeLookup,sceneId,statusLookup){
  const getTakes=typeof takeLookup==="function" ? takeLookup
    : (id=>typeof vidGetTakes==="function" ? vidGetTakes(id) : []);
  const wantedScene=sceneId!=null ? String(sceneId) : "";
  return (sceneClips||[]).filter(c=>c&&c.id&&(!wantedScene
      ||String(c.scene&&c.scene.id||"")===wantedScene)).map((clip,index)=>{
    const takes=(getTakes(clip.id)||[]).filter(t=>t&&t.url);
    const current=takes.find(t=>t.current)||null;
    const meta=(current&&current.meta)||{};
    const sourceStatus=current
      ? (typeof statusLookup==="function" ? statusLookup(clip,current,drafts||{})
        : typeof shotSourcesEditorialStatus==="function"
        ? shotSourcesEditorialStatus(((clip.data||{}).shots)||[],drafts||{},meta)
        : "current")
      : "missing";
    const usable=!!(current&&["current","override"].includes(sourceStatus));
    const shots=(((clip.data||{}).shots)||((clip.g||{}).shots)||[]).filter(Boolean);
    const beats=[];
    shots.forEach(sh=>{ const n=Number(sh&&sh.beatN); if(Number.isFinite(n)&&n>0&&beats.indexOf(n)<0) beats.push(n); });
    const g=clip.g||{};
    const part=(Number(g.part)>0&&Number(g.parts)>1) ? (" · Part "+g.part+"/"+g.parts) : "";
    const beatLabel=beats.length===1 ? ("Beat "+beats[0]+part)
      : beats.length>1 ? ("Beats "+beats[0]+"–"+beats[beats.length-1]+part)
      : (clip.label||("Clip "+(index+1)));
    return { clip,takes,take:usable?current:null,url:usable?current.url:"",meta,
      rendered:usable,approved:!!(usable&&meta.status==="approved"),sourceStatus,
      state:usable?"ready":(current?"stale":"missing"),beatNumbers:beats,beatLabel };
  });
}
window.stageSceneBeatTakeSlots=stageSceneBeatTakeSlots;
function stageShotRuntime(sh){
  const ms = sh && sh.lineAudio && sh.lineAudio.durationMs;
  if(ms) return Math.max(1, Math.round((Number(ms)/1000)*10)/10);
  if(typeof shotDur==="function") return Math.max(1, Number(shotDur(sh))||5);
  return Math.max(1, Number(sh&&sh.dur)||5);
}

function StageView({ project, scenes, shots, characters, locations, props, beatsMap, drafts, creditBalance, readOnly=false, onMakeSceneNeeds, onVoiceLine, onUpdateShot, onStageNav, onStageSettings }){
  // a pick is saved with the film (and remembered as this device's default for new films)
  const saveFilmStage = React.useCallback((patch)=>{
    if(!readOnly && typeof onStageSettings==="function") onStageSettings(patch);
  },[readOnly, onStageSettings]);
  // the film's saved visual source only picks thumbnails, posters and the next clip's end frame now —
  // each clip picks its own source (stageClipSourcePlan); nothing set it any more (removed 2026-10-09)
  const [visualSource, _setVisualSource] = React.useState(()=>_stageSavedSource(project));
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
    const f = _stageFilm(project, "modelId");
    const fm = f && SEEDANCE_MODELS.find(m=>m.id===f && m.status==="active");
    if(fm) return fm.id;
    try{ const v = localStorage.getItem("turn_stage_model");
      // Stored values are explicit historical choices. Only an actually new Stage
      // starts on 2.5; never migrate a hand-picked 2.0 model or its takes.
      return (SEEDANCE_MODELS.find(m=>m.id===v && m.status==="active")
        || SEEDANCE_MODELS.find(m=>m.id==="seedance-2.5"&&m.status==="active")
        || SEEDANCE_MODELS.find(m=>m.status==="active") || SEEDANCE_MODELS[0]).id;
    }catch(e){ return "seedance-2.5"; }
  });
  // opts.local: an automatic switch (the viewer's plan doesn't allow the film's model) — this
  // visit only; it never changes the film's saved choice or this device's default
  const setModelId = React.useCallback((id, opts)=>{ _setModelId(id);
    if(opts && opts.local) return;
    try{ localStorage.setItem("turn_stage_model", id); }catch(e){}
    saveFilmStage({ modelId:id }); },[saveFilmStage]);
  const stageModel = seedanceModelOf(modelId);
  // CLIP SCOPE — user choice (2026-09-02): how shots pack into render clips.
  // "auto": Seedance 2.5 packs ONE BEAT per clip (the whole beat renders as one
  // sequence of shots — the Art Room micro-beat plan continued, its 30s ceiling
  // permitting; whole-SCENE packing was retired by the same ruling); 2.0 packs by
  // its 15s/3-shot budget. "shot": one clip per SHOT on either model — maximum
  // per-render control. Persisted like the model choice.
  const [clipScope, _setClipScope] = React.useState(()=>{
    const f = _stageFilm(project, "clipScope");
    if(f==="shot" || f==="beat") return f;
    if(f==="auto") return "legacy";
    try{ const v=localStorage.getItem("turn_stage_clip_scope");
      // "auto" is the old packer and remains viewable so historical take keys stay
      // attached. No stored value means a new user: use approved beat-first packing.
      return v==="shot"?"shot":v==="beat"?"beat":v==="auto"?"legacy":"beat";
    }catch(e){ return "beat"; }
  });
  const setClipScope = React.useCallback((v)=>{ const next=v==="shot"?"shot":v==="legacy"?"legacy":"beat";
    _setClipScope(next); try{ localStorage.setItem("turn_stage_clip_scope",next==="legacy"?"auto":next); }catch(e){}
    saveFilmStage({ clipScope: next==="legacy"?"auto":next }); },[saveFilmStage]);
  // the film's saved choice changed elsewhere (a collaborator, an undo, a reload): follow it
  const _fSrc = _stageFilm(project, "visualSource"), _fModel = _stageFilm(project, "modelId"), _fScope = _stageFilm(project, "clipScope");
  React.useEffect(()=>{ if(_fSrc==="halves" || _fSrc==="shots") _setVisualSource(_fSrc); },[_fSrc]);
  React.useEffect(()=>{ if(_fModel && SEEDANCE_MODELS.some(m=>m.id===_fModel && m.status==="active")) _setModelId(_fModel); },[_fModel]);
  React.useEffect(()=>{ if(_fScope==="shot" || _fScope==="beat") _setClipScope(_fScope); else if(_fScope==="auto") _setClipScope("legacy"); },[_fScope]);
  // CLIP PACKING follows the scope above; the left rail lists the packed clips.
  // (The old Per clip / Whole scene switcher was removed 2026-08-02 by user ruling —
  // sceneSequences' wholeScene branch stays dormant.)
  // in-room view: the director console ("stage") or the take browser ("versions");
  // pendingReuse carries a Versions-tab "Reuse/Branch" pick back into the composer
  const [stageView, setStageView] = React.useState("stage");
  // another room can open one of the Stage's tabs (the app's onStageNav "timeline" / "audio" / "versions")
  React.useEffect(()=>{ const h=(e)=>{ const v = e && e.detail && e.detail.view;
      if(["stage","versions","timeline","audio"].indexOf(v)>=0) setStageView(v); };
    window.addEventListener("turn-stage-view", h); return ()=>window.removeEventListener("turn-stage-view", h); }, []);
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

  /* PROP STATE SHEETS ARE LOADED (2026-10-09, owner — Stage review): a prop's continuity sheet
     ("damaged") is picked only when its image is known here, and the Stage never asked for it — a film
     opened straight into the Stage sent the master. The loader below asks for every state sheet the
     visible scene can use; when one arrives, the clips are rebuilt so it is picked. */
  const [propVariantTick, setPropVariantTick] = React.useState(0);
  const propVariantIdsRef = React.useRef(new Set());
  // flatten clips with labels + derived data
  const allClips = React.useMemo(()=>{ const out=[];
    scenesWithShots.forEach(scene=>{ (clipsByScene[scene.id]||[]).forEach(g=>{
      // CONTENT-STABLE id (hash of member shots) so takes survive repacking; the old
      // positional id rides along as legacyId for the one-time take migration
      out.push({ id:(typeof clipStableId==="function")?clipStableId(scene.id, g.shots):("clip-"+scene.id+"-"+g.index),
        legacyId:(typeof clipVidId==="function")?clipVidId(scene.id,g.index):("clip-"+scene.id+"-"+g.index),
        label:_pad2(scene.no)+_clipLetter(g.index), scene, g, data:buildClipData(scene, g, ctx, stageModel.maxClipSec||15) }); }); });
    return out; }, [scenesWithShots, clipsByScene, charSig, propSig, locSig, draftSig, beatsSig, project, propVariantTick]);
  // CLIP is the unit of selection/generation. Keep selection above image hydration
  // so Stage can request the visible scene's package first instead of loading every
  // shot and sheet in the film before the selected beat becomes usable.
  const [selId, setSelId] = React.useState(allClips[0] ? allClips[0].id : null);
  const [selShotId, setSelShotId] = React.useState((shots||[])[0] ? (shots||[])[0].id : null);
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
  const hydrationClip=allClips.find(c=>c.id===selId)||allClips[0]||null;
  const hydrationScene=hydrationClip&&hydrationClip.scene;
  const hydrationSceneClips=hydrationScene?allClips.filter(c=>c.scene.id===hydrationScene.id):[];
  // migrate any takes still stored under the OLD positional ids (fire-and-forget; the
  // vid-done event each migration dispatches makes mounted consoles re-read)
  React.useEffect(()=>{
    if(clipScope!=="legacy") return;
    if(typeof window.vidAdoptTakes!=="function") return;
    allClips.forEach(c=>{ if(c.legacyId && c.legacyId!==c.id) window.vidAdoptTakes(c.id, c.legacyId, (c.g.shots||[]).map(s=>s.id)); });
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
  // Resolve inventory before memoizing hydration: draft/coverage changes can
  // select another asset without changing scene, clip or entity ids.
  const requiredReferenceIds = new Set();
  if(hydrationScene&&typeof window.stageShotReferencePackage==="function"){
    const pack=window.stageShotReferencePackage(shotsByScene[hydrationScene.id]||[],{...ctx,scene:hydrationScene,drafts});
    ["characters","locations","props"].forEach(k=>(pack[k]||[]).forEach(r=>r&&r.assetId&&requiredReferenceIds.add(r.assetId)));
  }
  const requiredReferenceIdsKey=JSON.stringify(Array.from(requiredReferenceIds).sort());
  const neededIds = React.useMemo(()=>{ const s=new Set();
    // Continuity-critical sheets must occupy the first loader slots. Missing shot
    // frames and storyboard derivatives can number in the hundreds; putting them
    // first made an already-generated active appearance wait behind every optional
    // frame in the film before Stage even asked storage for it.
    requiredReferenceIds.forEach(id=>s.add(id));
    const sceneShots=hydrationScene?(shotsByScene[hydrationScene.id]||[]):[];
    sceneShots.forEach(sh=>s.add(sh.id));
    if(hydrationScene){
      // the BOARD's pages (one keyframe per beat — sbBoardShots), so only sheets that can exist are asked for (2026-10-09)
      const boardShots = (typeof window.sbBoardShots==="function") ? window.sbBoardShots(sceneShots) : sceneShots;
      const total = stagePageRanges(boardShots).length;
      for(let i=0;i<total;i++){
        const sheetId = "sbsheet-sbpage-"+hydrationScene.id+"-2x2-"+i;
        s.add(sheetId); s.add(sheetId+":half-top"); s.add(sheetId+":half-bottom");
      }
    }
    // Warm only the visible scene's palette and storyboard sources. Selecting a
    // different scene recomputes this list and loads that scene on demand.
    // every prop state sheet (and worn close-up sheet) this scene's shots can use
    const variantIds = new Set();
    if(hydrationScene && typeof propStateAt==="function") (props||[]).forEach(p=>{ if(!p||!p.id) return;
      sceneShots.forEach(sh=>{ try{
        const rs = propStateAt(p, hydrationScene.id, sh.beatN, sh.microBeatId, sh.id, ctx);
        if(!rs || rs.active===false) return;
        if(rs.referenceAssetId){ s.add(rs.referenceAssetId); variantIds.add(rs.referenceAssetId); }
        s.add(p.id); variantIds.add(p.id);
      }catch(e){} }); });
    propVariantIdsRef.current = variantIds;
    hydrationSceneClips.forEach(c=>{
      const ids=storyboardClipIds(c); (ids.all||[]).forEach(id=>s.add(id));
      const dd=c.data||{};
      (dd.cast||[]).forEach(ch=>ch&&ch.id&&s.add(ch.id));
      (dd.props||[]).forEach(p=>{if(!p)return;s.add(p.sheetId||p.id);if(p.id)s.add(p.id);});
      if(dd.loc&&dd.loc.id)s.add(dd.loc.id);
      if(dd.locSheet&&dd.locSheet.id)s.add(dd.locSheet.id);
    });
    return Array.from(s); }, [shotIdsKey, charIdsKey, sceneOrderKey, locIdsKey, propIdsKey, propSig, requiredReferenceIdsKey,
      hydrationScene&&hydrationScene.id, hydrationSceneClips.map(c=>c.id).join(","),
      JSON.stringify(hydrationSceneClips.map(c=>[(((c.data||{}).cast)||[]).map(x=>x.id).join("|"),(((c.data||{}).props)||[]).map(p=>p.sheetId||p.id).join("|"),(((c.data||{}).loc)||{}).id||"",(((c.data||{}).locSheet)||{}).id||""]))]);
  const [imgs, setImgs] = React.useState({});
  const [imageLoadState,setImageLoadState] = React.useState({});
  const [imgTick, setImgTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setImgTick(x=>x+1); window.addEventListener("nb-gen-done", h); window.addEventListener("nb-prefetched", h); return ()=>{ window.removeEventListener("nb-gen-done", h); window.removeEventListener("nb-prefetched", h); }; }, []);
  React.useEffect(()=>{ let alive=true;
    const ids = Array.from(new Set(neededIds||[]));
    const sync = {}, missing = [];
    ids.forEach(id=>{ const u=(typeof nbGetImage==="function")?nbGetImage(id):""; if(u) sync[id]=u; else missing.push(id); });
    setImgs(sync);
    setImageLoadState(Object.fromEntries(missing.map(id=>[id,typeof nbLoadImage==="function"?"loading":"unavailable"])));
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
            if(alive && u && propVariantIdsRef.current.has(id)) setPropVariantTick(t=>t+1);   // re-pick the prop's sheet
            if(alive)setImageLoadState(prev=>({...prev,[id]:u?"ready":"unavailable"}));
          }catch(e){ if(alive)setImageLoadState(prev=>({...prev,[id]:"error"})); }
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
        if(!u && typeof vgLoadAudio==="function"){ try{ u=await vgLoadAudio(sh.id, undefined, { hash:sh.lineAudio && sh.lineAudio.hash }); }catch(e){} } if(u) out[sh.id]=u; }   // the matching voicing from the film (2026-10-09)
      if(alive) setAuds(out); })();
    return ()=>{ alive=false; }; }, [(shots||[]).map(s=>s.id+":"+(s.lineAudio?1:0)).join(","), audTick]);

  // the clips' takes (the per-shot "beat-" ids were never written or read — dropped 2026-10-09)
  const videoIds = React.useMemo(()=>Array.from(new Set(allClips.map(c=>c.id))), [allClips.map(c=>c.id).join(",")]);
  const clipIdsKey = videoIds.join(",");
  const [vids, setVids] = React.useState({});
  // clips whose current take exists but is OUT OF DATE (its shots changed since) — said as such,
  // never as "not rendered" (2026-10-05, owner — Stage review)
  const [staleVids, setStaleVids] = React.useState({});
  const [vidTick, setVidTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setVidTick(x=>x+1); window.addEventListener("vid-done", h); return ()=>window.removeEventListener("vid-done", h); }, []);
  // clips whose current take was made with an EARLIER look (the scene's look or the film stock changed
  // on the Color tab since): still in the film, said in Shoot, Takes and the Timeline (2026-10-05)
  const oldLookVids = {};
  (allClips||[]).forEach(c=>{ if(!c || !vids[c.id] || !c.scene) return;
    const m = (typeof vidGetMeta==="function") ? vidGetMeta(c.id) : null;
    if(m && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(m.lookSig, project, c.scene.id)) oldLookVids[c.id] = true; });
  // the other take notes (stageTakeNotes — props, references, voice, frames, identity), read everywhere a
  // clip's current take shows, not only in Takes (2026-10-09, owner — Stage review)
  const noteVids = {};
  (allClips||[]).forEach(c=>{ if(!c || !vids[c.id] || !c.scene) return;
    const m = (typeof vidGetMeta==="function") ? vidGetMeta(c.id) : null;
    const notes = m ? stageTakeNotes(c, m, project).filter(x=>x.key!=="l") : [];
    if(notes.length) noteVids[c.id] = notes.map(x=>x.label); });
  // EACH SCENE'S CLIPS, FOR THE BREAKDOWN (2026-10-05, owner — Breakdown review): the clip grouping follows
  // this room's model and settings, so the counts are saved per film on this device on each visit
  // clips whose current take finished after a character's identity changed: left out until checked in Takes
  const [identityVids, setIdentityVids] = React.useState({});
  // (2026-10-09, Breakdown review) clips left out after an identity change are counted too, so the Breakdown's
  // Clips chip never reads "all rendered" while the Stage leaves one out
  const stageStatusSig = (allClips||[]).map(c=>c.id+":"+(vids[c.id]?1:0)+(staleVids[c.id]?"s":"")+(oldLookVids[c.id]?"l":"")+(noteVids[c.id]?"n":"")+(identityVids[c.id]?"i":"")).join(",");
  // saved only once the takes have LOADED (2026-10-09 — leaving the Stage quickly saved "0 rendered", or nothing)
  const [vidsLoaded, setVidsLoaded] = React.useState(false);
  React.useEffect(()=>{
    if(!vidsLoaded || !(allClips||[]).length) return;
    const out = {};
    (allClips||[]).forEach(c=>{ if(!c || !c.scene) return; const o = out[c.scene.id] = out[c.scene.id] || { total:0, rendered:0, stale:0, oldLook:0, notes:0, identity:0 };
      o.total++; if(vids[c.id]) o.rendered++; if(staleVids[c.id]) o.stale++; if(oldLookVids[c.id]) o.oldLook++; if(noteVids[c.id]) o.notes++;
      if(identityVids[c.id] && !vids[c.id]) o.identity++; });
    out.__at = new Date().toISOString();
    // keyed by the OPEN FILM (2026-10-09, owner — Stage review): films carry no project.id, so every
    // film wrote "local" and one film's Stage overwrote another's Breakdown counts
    try{ localStorage.setItem("turn_stage_scene_status:"+stageFilmKey(project), JSON.stringify(out)); }catch(e){}
  },[stageStatusSig, stageFilmKey(project), vidsLoaded]);
  React.useEffect(()=>{ let alive=true;
    (async()=>{ const out={}, stale={}, ident={};
       // read in parallel (2026-10-09: one at a time, the Timeline said "0 rendered" for seconds)
       const urls = await Promise.all(videoIds.map(async id=>{ let u=(typeof vidGetVideo==="function")?vidGetVideo(id):"";
         if(!u && typeof vidLoadVideo==="function"){ try{ u=await vidLoadVideo(id); }catch(e){} } return u; }));
       videoIds.forEach((id,k)=>{ const u = urls[k];
         const clip=allClips.find(c=>c.id===id);
         const meta=(typeof vidGetMeta==="function")?vidGetMeta(id):null;
         // a take flagged "identity changed" (it finished after a character changed) is never used as is
         const usable=!(meta && meta.identityChanged) && (!clip || typeof shotSourcesEditorialStatus!=="function"
           || ["current","override"].includes(shotSourcesEditorialStatus(
             ((clip.data||{}).shots)||[],drafts,meta)));
         if(u&&usable) out[id]=u; else if(u){ stale[id]=true; if(meta && meta.identityChanged) ident[id]=true; } });
      if(alive){ setVids(out); setStaleVids(stale); setIdentityVids(ident); setVidsLoaded(true); } })();
    return ()=>{ alive=false; }; }, [clipIdsKey, vidTick, draftSig, shotIdsKey]);

  /* TAKES FROM AN EARLIER GROUPING (2026-10-09, owner — Stage review): takes kept under a clip id that no
     longer exists (its shots changed: a shot added or removed, the model or clip scope switched, a beat split
     by a longer line) are matched to today's clip that shares the most shots, and offered there — moved
     only when you say so (vidMergeTakes) */
  const [orphanTakes, setOrphanTakes] = React.useState({});
  React.useEffect(()=>{ let alive=true;
    if(typeof window.vidKnownIds!=="function"){ setOrphanTakes({}); return ()=>{ alive=false; }; }
    (async()=>{
      const live = new Set(videoIds);
      const cands = (window.vidKnownIds()||[]).filter(id=>!live.has(id) && /^clip-/.test(String(id)));
      const out = {};
      for(const id of cands){
        if(!alive) return;
        let u = (typeof vidGetVideo==="function") ? vidGetVideo(id) : "";
        if(!u && typeof vidLoadVideo==="function"){ try{ u = await vidLoadVideo(id); }catch(e){} }
        if(!u) continue;
        const meta = (typeof vidGetMeta==="function") ? vidGetMeta(id) : null;
        const shotIds = (typeof window.vidTakeShotIds==="function") ? window.vidTakeShotIds(meta) : [];
        if(!shotIds.length) continue;
        let best=null, bestN=0;
        allClips.forEach(c=>{ const n=(c.g.shots||[]).filter(sh=>shotIds.indexOf(String(sh.id))>=0).length; if(n>bestN){ best=c; bestN=n; } });
        if(!best) continue;
        const takesN = 1 + (((meta&&meta.takes)||[]).length);
        (out[best.id] = out[best.id] || []).push({ id, takes:takesN, approved:!!(meta && (meta.status==="approved" || (meta.takes||[]).some(t=>t&&t.meta&&t.meta.status==="approved"))) });
      }
      if(alive) setOrphanTakes(out);
    })();
    return ()=>{ alive=false; }; }, [clipIdsKey, vidTick]);

  // the Scenes rail collapses to the same vertical strip the Writers' Room panels use. ABOVE the
  // empty-film return (2026-10-05): a hook after it threw "Rendered more hooks" when a film gained
  // its first shots (or lost its last) while the Stage was open
  const [railOpen, _setRailOpen] = React.useState(()=>{ try{ return localStorage.getItem("turn_stage_rail_open")!=="0"; }catch(e){ return true; } });
  const setRailOpen = (v)=>{ _setRailOpen(v); try{ localStorage.setItem("turn_stage_rail_open", v?"1":"0"); }catch(e){} };

  if(!scenesWithShots.length){
    return _stEl("div",{className:"stage2-root"},
      _stEl("div",{className:"prop-empty"},
        _stEl("div",{className:"wr-eyebrow stage-empty-eyebrow"},"03 \u00b7 Production"),
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
  // SAME SCENE ONLY (2026-10-05, owner — Stage review): continuity reaches back to the clip before
  // this one IN THIS SCENE. It used to cross scene boundaries, so a scene's first clip was told to
  // continue the previous scene's last shot (and those reference seconds were billed).
  const prevBeatVideoId = (clipIdx>0 && allClips[clipIdx-1].scene && clip.scene && allClips[clipIdx-1].scene.id===clip.scene.id)
    ? allClips[clipIdx-1].id : null;
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
            /* (2026-10-09, owner — Stage review) only the open scene's images are loaded here: another scene's
               beats read the image cache, and when nothing is known yet they say so instead of "no frame yet";
               the open scene's beats read the clip's readiness (stageClipReadiness), as Shoot does */
            const hydrated = !!(hydrationScene && hydrationScene.id===scene.id);
            const railImgs = hydrated ? imgs : stageImgsWithCache(imgs);
            const p = firstClip ? stageClipSourcePlan(firstClip, railImgs) : { glyph:"", ready:false, label:"shots" };
            const unknown = !hydrated && !p.ready;
            const ready = firstClip && hydrated ? stageClipReadiness(firstClip, ctx, imgs, drafts, { loading:imageLoadState }) : null;
            const notReadyText = ready && ready.issues.length ? " — "+ready.text : "";
            const rendered = coverClips.length>0 && coverClips.every(c=>clipVideoReady(c, vids));
            const noted = coverClips.some(c=>noteVids[c.id] || oldLookVids[c.id]);
            const on = selectedScene.id===scene.id && b.shots.some(sh=>sh.id===((selectedShot||{}).id));
            const beatNm = stageBeatRailName(scene, drafts, beatsMap, b);
            const label = "Beat "+(b.n||"—");
            return _stEl("div",{key:"beat-"+(b.n||"none"),className:"stage2-beat"+(on?" on":"")},
              _stEl("button",{type:"button",
                className:"stage2-beat-row"+(rendered?" done":"")+((p.ready||unknown)?"":" missing"),
                title:label+(beatNm?" · "+beatNm:"")+" · "+b.shots.length+" shot"+(b.shots.length!==1?"s":"")
                  +(coverClips.length>1?" · spans "+coverClips.length+" clips":"")
                  +" · renders from "+p.label
                  +(unknown ? " — its images load when you open this scene"
                    : (p.ready ? notReadyText : " — no frame yet: it would render from the prompt only (make it in Shots)"))
                  +(rendered?" · rendered ✓":"")
                  +(rendered && noted ? " · take notes: "+coverClips.map(c=>(noteVids[c.id]||[]).concat(oldLookVids[c.id]?["Earlier look"]:[])).flat().join(", ") : ""),
                onClick:()=>{ if(!firstClip) return; if(firstClip.id!==clip.id) onSelectClip(firstClip.id); setSelShotId(b.shots[0].id); }},
                _stEl("b",null,label),
                _stEl("span",{className:"stage2-beat-name"},beatNm||"—"),
                _stEl("span",{className:"stage2-clip-chip-glyph"},p.glyph),
                _stEl("span",{className:"stage2-clip-chip-st"}, rendered?(noted?"✓\u2022":"✓"):((p.ready||unknown)?"":"!"))));
          });
        })()));
  };
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
      ["Takes","versions",Icon.copy,"Review, approve and choose the selected clip's timeline take"],
      ["Timeline","timeline",Icon.grid,"The film assembled from each clip's current take"],
      ["Mix","audio",Icon.mic,"The post mix — voiced lines over the picture, beds under, kept with the film"],
    ];
    // THE STAGE'S PAGE HEADING (homepage style, owner 2026-10-16 — "update the Stage UI the same way" as the
    // Writers' Room and the Art Room): "03 · Production", the view's title — Shoot names the open scene,
    // "<Scene>, take by take." — a line of what it holds, and the four views as underlined text on the right.
    // It keeps the .viewnav class and the tab buttons' own words (the browser test finds them by label).
    const headSceneShots = shotsByScene[selectedScene.id]||[];
    const headDone = selectedSceneClips.filter(c=>clipVideoReady(c, vids)).length;
    const headTitle = stageView==="versions" ? ["The ","takes."] : stageView==="timeline" ? ["The ","timeline."]
      : stageView==="audio" ? ["The ","mix."] : [(selectedScene.title||selectedScene.loc||("Scene "+_pad2(selectedScene.no)))+", ","take by take."];
    const headSub = stageView==="versions" ? "Review and approve each clip's takes, and choose the one the timeline uses."
      : stageView==="timeline" ? "The film assembled from each clip's current take"+((project&&project.title)?" \u2014 "+project.title:"")+"."
      : stageView==="audio" ? "The post mix: voiced lines over the picture, beds under, kept with the film."
      : "Scene "+_pad2(selectedScene.no)+" \u00b7 "+selectedSceneClips.length+" clip"+(selectedSceneClips.length!==1?"s":"")
        +" \u00b7 "+headDone+" of "+selectedSceneClips.length+" rendered \u00b7 "+_fmtSecs(headSceneShots.reduce((t,sh)=>t+stageShotRuntime(sh),0))+".";
    const stageHead = _stEl("header",{className:"viewnav stage-head","aria-label":"Views"},
      _stEl("div",{className:"wr-head-in stage-head-in"},
        _stEl("div",{className:"wr-head-copy"},
          _stEl("div",{className:"wr-eyebrow"},"03 \u00b7 Production"),
          _stEl("h1",{className:"wr-title"},headTitle[0],_stEl("em",null,headTitle[1])),
          _stEl("p",{className:"wr-sub"},headSub)),
        _stEl("div",{className:"wr-head-side"},
          _stEl("nav",{className:"segmented stage-tabs","aria-label":"Stage views"},
          stageTabs.map(([label,id,Ic,tip])=>{
            const on = stageView===id;
            // the current tab is marked for assistive tech, and keeps its own description (2026-10-09)
            return _stEl("button",{key:id,type:"button",className:"seg"+(on?" on":""),"aria-pressed":on?"true":"false",
              onClick:()=>setStageView(id),
              title: tip},
              Ic&&_stEl(Ic,{s:14}),_stEl("span",{className:"seg-lab"},label)); })))));
    // the view tabs span the FULL app width above the rail+console split — the same
    // TopBar → ViewNav → body stack every other room has.
    return _stEl("div",{className:"stage2-root",style:_stageAspectCss(aspect)},
      stageHead,
      _stEl("div",{className:"stage2-body"}, railOpen ? rail : railStrip,
        _stEl("div",{className:"stage2-main"},
          stageView==="versions"
            ? _stEl(StageVersionsView,{ key:"vers-"+clip.id, clip, stageModel, readOnly, project,
                onBack:()=>setStageView("stage"),
                onReuse:(meta,pin)=>{ setPendingReuse({ clipId:clip.id, meta, pin }); setStageView("stage"); } })
            : stageView==="timeline"
            ? _stEl(StageTimelineView,{ key:"tl", allClips, vids, staleVids, imgs, visualSource, selId, onSelectClip,
                filmTitle:(project&&project.title)||"", auds, characters, oldLookVids, noteVids, identityVids, vidsLoaded,
                onOpenStage:(id)=>{ onSelectClip(id); setStageView("stage"); } })
            : stageView==="audio"
            ? _stEl(StageAudioView,{ key:"au", allClips, vids, staleVids, identityVids, noteVids, vidsLoaded, auds, characters, selId, onSelectClip })
            // keyed by SCENE, not clip.id — clip ids change on every repack (they
            // hash the member shots), and remounting the console wiped the recipe
            // tab + Multi-shot row state mid-edit; the console's own member-overlap
            // effect handles real clip moves within the scene.
            : _stEl(ClipConsole,{ key:"console-"+selectedScene.id, clip, selectedShot, sceneClips:selectedSceneClips, ctx, imgs, imageLoadState, auds, beatsMap, drafts, prevClipVideoId:prevBeatVideoId, aspect, visualSource, creditBalance, readOnly, onVoiceLine, onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds, takeStale:!!staleVids[clip.id], takeIdentity:!!identityVids[clip.id], takeOldLook:!!oldLookVids[clip.id], orphanTakes:orphanTakes[clip.id]||[], onUpdateShot, onStageNav, modelId, setModelId, clipScope, setClipScope,
                onSelectClip,
                onFirstVideo:()=>setStageView("versions"),
                pendingReuse, onReuseConsumed:()=>setPendingReuse(null) }))));
  }
window.StageView = StageView;

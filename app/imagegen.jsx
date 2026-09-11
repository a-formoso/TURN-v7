/* imagegen.jsx — TURN image runtime.
   All Art Room image models now route through the server proxy first, with fal.ai
   as the image broker. Writing, video, and voice-library calls keep their own
   routing elsewhere. */

const NB_KEY = "turn-nanobanana-key";
const NB_MODEL_KEY = "turn-nb-model";
const NB_AR_KEY = "turn-nb-aspect";
/* GPT Image quality (openai only): "high" routinely outruns the Edge Function
   gateway's wall-clock limit on 6-panel composite sheets → 504 → no image but a
   billed generation. Default MEDIUM; the dock exposes the knob when GPT is active. */
const OAI_Q_KEY = "turn-oai-quality";
function nbGetOaiQuality(){ try{ const q=localStorage.getItem(OAI_Q_KEY)||"medium"; return ["low","medium","high"].indexOf(q)>=0?q:"medium"; }catch(e){ return "medium"; } }
function nbSetOaiQuality(q){ try{ localStorage.setItem(OAI_Q_KEY,q); }catch(e){} _nbAnnounce("nb-settings-changed"); }
/* every model/res/aspect/quality setter announces itself so cost chips (and any other
   listener) update no matter WHERE the change came from — picker, dock, or a
   "Try <model>" fallback after a failed generation. */
function _nbAnnounce(name){ try{ window.dispatchEvent(new CustomEvent(name)); }catch(e){} }
window.nbGetOaiQuality = nbGetOaiQuality; window.nbSetOaiQuality = nbSetOaiQuality;
const NB_RES_KEY = "turn-nb-res";

/* selectable models. provider:"fal" means the browser always calls the Supabase
   proxy; the proxy then maps this UI id to fal.ai's provider route. */
const _imageProxyOn = !!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy);
const NB_MODELS = [
  { id:"gemini-3.1-flash-image",      label:"Nano Banana 2",      provider:"fal", family:"nano",   falModel:"fal-ai/nano-banana-2",      note:"fal.ai \u00b7 fast \u00b7 high quality" },
  { id:"gemini-3.1-flash-lite-image", label:"Nano Banana 2 Lite", provider:"fal", family:"nano",   falModel:"google/nano-banana-2-lite", note:"fal.ai \u00b7 fastest \u00b7 lowest cost" },
  { id:"gemini-3-pro-image",          label:"Nano Banana Pro",    provider:"fal", family:"nano",   falModel:"fal-ai/nano-banana-pro",    note:"fal.ai \u00b7 highest fidelity" },
  { id:"gpt-image-2",                 label:"GPT Image 2",        provider:"fal", family:"openai", falModel:"openai/gpt-image-2", falEditModel:"openai/gpt-image-2/edit", note:"fal.ai \u00b7 in-image text" },
  { id:"gpt-image-2.5-flare",         label:"GPT Image 2.5 Flare", provider:"fal", family:"openai", falModel:"openai/gpt-image-2.5/flare/text-to-image", falEditModel:"openai/gpt-image-2.5/flare/edit", note:"fal.ai \u00b7 fastest GPT Image 2.5" },
  { id:"gpt-image-2.5-sunburst",      label:"GPT Image 2.5 Sunburst", provider:"fal", family:"openai", falModel:"openai/gpt-image-2.5/sunburst/text-to-image", falEditModel:"openai/gpt-image-2.5/sunburst/edit", note:"fal.ai \u00b7 maximum precision and fidelity" },
];
const NB_ASPECTS = ["16:9","21:9","9:16","1:1","3:4","4:3"];
const NB_RESOLUTIONS = ["1K","2K","4K"];
window.NB_MODELS = NB_MODELS; window.NB_ASPECTS = NB_ASPECTS; window.NB_RESOLUTIONS = NB_RESOLUTIONS;

function nbGetKey(){ try{
  const k = window.turnGetApiKey ? window.turnGetApiKey("google") : "";
  if(k) return k;
  const legacy = localStorage.getItem(NB_KEY)||"";
  if(legacy && window.turnSetApiKey) window.turnSetApiKey("google", legacy);
  return legacy;
}catch(e){ return ""; } }
function nbSetKey(k){ try{
  k=(typeof sanitizeKey==="function"?sanitizeKey(k):k);
  if(window.turnSetApiKey) window.turnSetApiKey("google", k);
  k ? localStorage.setItem(NB_KEY,k) : localStorage.removeItem(NB_KEY);
}catch(e){} }
function nbHasKey(){ return !!nbGetKey(); }
function nbGetModel(){ try{
  let s=localStorage.getItem(NB_MODEL_KEY);
  // Preserve GPT Image selection across the move from the dated preview id to
  // OpenAI's stable public alias instead of silently falling back to Nano Banana.
  if(/^gpt-image-2-\d{4}-\d{2}-\d{2}$/.test(s||"") && NB_MODELS.find(m=>m.id==="gpt-image-2")){
    s="gpt-image-2";
    localStorage.setItem(NB_MODEL_KEY,s);
  }
  if(s && NB_MODELS.find(m=>m.id===s)) return s;
  if(s){ try{ localStorage.setItem(NB_MODEL_KEY, NB_MODELS[0].id); }catch(e){} }
  return NB_MODELS[0].id;
}catch(e){ return NB_MODELS[0].id; } }
function nbSetModel(m){ try{ localStorage.setItem(NB_MODEL_KEY,m); }catch(e){} _nbAnnounce("nb-model-changed"); }
function nbGetAspect(){ try{ const a=localStorage.getItem(NB_AR_KEY)||"16:9"; return (NB_ASPECTS.indexOf(a)>=0)?a:"16:9"; }catch(e){ return "16:9"; } }
function nbSetAspect(a){ try{ localStorage.setItem(NB_AR_KEY,a); }catch(e){} _nbAnnounce("nb-settings-changed"); }
function nbGetRes(){ try{ return localStorage.getItem(NB_RES_KEY)||"2K"; }catch(e){ return "2K"; } }
function nbSetRes(r){ try{ localStorage.setItem(NB_RES_KEY,r); }catch(e){} _nbAnnounce("nb-settings-changed"); }
window.nbGetKey = nbGetKey; window.nbSetKey = nbSetKey; window.nbHasKey = nbHasKey;
window.nbGetModel = nbGetModel; window.nbSetModel = nbSetModel;
window.nbGetAspect = nbGetAspect; window.nbSetAspect = nbSetAspect;
window.nbGetRes = nbGetRes; window.nbSetRes = nbSetRes;

/* ---- OpenAI (GPT Image) key — a SECOND provider key, stored separately ---- */
const OAI_KEY = "turn-openai-key";
/* Sanitize a pasted API key: strip ALL whitespace (incl. non-breaking U+00A0),
   zero-width chars, and control/non-printable chars. Mobile paste (email-wrapped
   keys, autocorrect) injects these and a plain .trim() leaves them in the middle
   or as zero-width edges — which corrupts the Bearer header and reads as a 401
   "key rejected" even though the visible characters look correct. */
function sanitizeKey(k){
  return String(k||"")
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")  // whitespace + nbsp + zero-width
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")   // control chars
    .trim();
}
window.sanitizeKey = sanitizeKey;
function oaiGetKey(){ try{
  const k = window.turnGetApiKey ? window.turnGetApiKey("openai") : "";
  if(k) return k;
  const legacy = localStorage.getItem(OAI_KEY)||"";
  if(legacy && window.turnSetApiKey) window.turnSetApiKey("openai", legacy);
  return legacy;
}catch(e){ return ""; } }
function oaiSetKey(k){ try{
  k=sanitizeKey(k);
  if(window.turnSetApiKey) window.turnSetApiKey("openai", k);
  k ? localStorage.setItem(OAI_KEY,k) : localStorage.removeItem(OAI_KEY);
}catch(e){} }
function oaiHasKey(){ return !!oaiGetKey(); }
window.oaiGetKey = oaiGetKey; window.oaiSetKey = oaiSetKey; window.oaiHasKey = oaiHasKey;

/* is the server-side image proxy enabled? When on, providers run through the Edge
   Function. The platform server secret is used unless an administrator overrides
   it for testing. */
function imageProxyOn(){ return !!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy); }
window.imageProxyOn = imageProxyOn;

/* map a UI slot id to its Storage asset type (drives the {assetType} path segment).
   Slot ids are typed by prefix: charref- / propref- / locref- / locvar- / shot-.
   Cameos take their own "cameo" type via cloudSyncCameo, not this path. */
function slotAssetKind(slotId){
  const s = String(slotId||"");
  if(s.indexOf("propref-")===0) return "prop";
  if(s.indexOf("locref-")===0 || s.indexOf("locvar-")===0) return "location";
  if(s.indexOf("shot-")===0) return "shot";
  if(s.indexOf("charref-")===0) return "character";
  return "asset";
}
window.slotAssetKind = slotAssetKind;

const NB_ASSET_ROLES = {
  MASTER_REFERENCE:"master_reference",
  DERIVED_REFERENCE:"derived_reference",
  CROP_FALLBACK:"crop_fallback",
  SHOT_ANCHOR:"shot_anchor",
  FINAL_TAKE:"final_take",
};
const NB_ASSET_ROLE_LABELS = {
  master_reference:"Master reference",
  derived_reference:"Derived reference",
  crop_fallback:"Crop fallback",
  shot_anchor:"Shot anchor",
  final_take:"Final take",
};
const NB_ASSET_ROLE_PRIORITY = {
  final_take:100,
  shot_anchor:92,
  derived_reference:86,
  master_reference:70,
  crop_fallback:20,
};
function nbNormalizeAssetRole(role){
  const r = String(role||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
  return NB_ASSET_ROLE_LABELS[r] ? r : "";
}
function nbInferAssetRole(args){
  args = args || {};
  const meta = args.meta || {};
  const explicit = nbNormalizeAssetRole(args.assetRole || meta.assetRole || meta.role);
  if(explicit) return explicit;
  const id = String(args.id||"");
  const kind = String(args.kind||"").toLowerCase();
  if(kind==="video" || kind==="take" || kind==="final_take") return NB_ASSET_ROLES.FINAL_TAKE;
  if(kind==="shot" || id.indexOf("shot-")===0) return NB_ASSET_ROLES.SHOT_ANCHOR;
  if(kind==="locunit" || id.indexOf("locunit-")===0 || id.indexOf(":half-")>=0 || id.indexOf("sbsheet-")===0) return NB_ASSET_ROLES.DERIVED_REFERENCE;
  if(/-(?:coverage|unit|state|variant|plate)-/i.test(id) || /-(?:int|ext)(?:-|$)/i.test(id)) return NB_ASSET_ROLES.DERIVED_REFERENCE;
  return NB_ASSET_ROLES.MASTER_REFERENCE;
}
function nbAssetRoleLabel(role){ return NB_ASSET_ROLE_LABELS[nbNormalizeAssetRole(role)] || "Reference"; }
function nbAssetRolePriority(role){
  const r = nbNormalizeAssetRole(role);
  return r ? (NB_ASSET_ROLE_PRIORITY[r] || 0) : 0;
}
function nbWithAssetProvenance(id, meta, kind, extra){
  const out = { ...(meta||{}) };
  const role = nbInferAssetRole({ ...(extra||{}), id, kind, meta:out });
  out.assetRole = role;
  out.assetRoleLabel = nbAssetRoleLabel(role);
  out.assetRolePriority = nbAssetRolePriority(role);
  return out;
}
function nbPreferBestAssetRefs(refs){
  const list = Array.isArray(refs) ? refs.filter(Boolean) : [];
  return list.slice().sort((a,b)=>{
    const ap = Number(a.assetRolePriority || nbAssetRolePriority(a.assetRole));
    const bp = Number(b.assetRolePriority || nbAssetRolePriority(b.assetRole));
    return bp - ap;
  });
}
window.NB_ASSET_ROLES = NB_ASSET_ROLES;
window.nbInferAssetRole = nbInferAssetRole;
window.nbAssetRoleLabel = nbAssetRoleLabel;
window.nbAssetRolePriority = nbAssetRolePriority;
window.nbWithAssetProvenance = nbWithAssetProvenance;
window.nbPreferBestAssetRefs = nbPreferBestAssetRefs;

/* which provider a model id belongs to ("google" default for older saved stories) */
function imageModelEntry(model){
  return (window.NB_MODELS||NB_MODELS).find(x=>x.id===model) || null;
}
function providerOfModel(model){
  const m = imageModelEntry(model);
  return (m && m.provider) || "google";
}
function isGptImageModel(model){
  const m = imageModelEntry(model);
  return /^gpt-image/i.test(String(model||"")) || !!(m && m.family==="openai");
}
function nbProviderLabel(provider){ return provider==="fal" ? "fal.ai" : (provider==="openai" ? "GPT Image" : "Nano Banana"); }
/* key presence per provider — used by the key bar and the batch/generate gates.
   fal.ai image generation must go through the server proxy; the proxy uses the
   platform server secret unless an administrator overrides it for testing. */
function nbHasKeyForModel(model){ return providerOfModel(model)==="fal" ? imageProxyOn() : ((providerOfModel(model)==="openai" || imageProxyOn()) ? true : nbHasKey()); }
function nbHasKeyForCurrent(){ return nbHasKeyForModel(nbGetModel()); }
window.imageModelEntry = imageModelEntry; window.providerOfModel = providerOfModel; window.isGptImageModel = isGptImageModel; window.nbProviderLabel = nbProviderLabel;
window.nbHasKeyForModel = nbHasKeyForModel; window.nbHasKeyForCurrent = nbHasKeyForCurrent;

/* ---- per-image cost, in GENERATION CREDITS.
   Provider USD assumptions live in app/pricing.jsx so pricing is auditable from
   one place. Shown on Generate buttons so cost is visible BEFORE a render —
   the server deducts whole credits after a successful image generation. */
const NB_IMG_USD = (window.turnImageProviderUsdTable && window.turnImageProviderUsdTable()) || {
  "gemini-3.1-flash-lite-image": { "1K":0.034, "2K":0.050, "4K":0.076 },
  "gemini-3.1-flash-image":      { "1K":0.067, "2K":0.101, "4K":0.151 },
  "gemini-3-pro-image":          { "1K":0.134, "2K":0.134, "4K":0.240 },
  "gpt-image-2":                 { low:0.009, medium:0.080, high:0.317 },
  "gpt-image-2.5-flare":         { low:0.005, medium:0.012, high:0.045 },
  "gpt-image-2.5-sunburst":      { low:0.005, medium:0.012, high:0.045 },
};
function nbImageCredits(opts){
  opts = opts||{};
  const model = opts.model || nbGetModel();
  const t = NB_IMG_USD[model]; if(!t) return null;
  let usd;
  if(isGptImageModel(model)){
    const q = opts.quality || nbGetOaiQuality();
    usd = (t[q]!=null) ? t[q] : t.medium;
  } else {
    const r = opts.res || nbGetRes();
    usd = (t[r]!=null) ? t[r] : t["2K"];
  }
  // ×CREDIT_SCALE so image costs read in the same generous denomination as plan
  // allowances (grant + cost scale together — real value unchanged).
  return (typeof window.turnCreditsFromProviderUsd==="function")
    ? window.turnCreditsFromProviderUsd(usd)
    : (usd / 0.30) * (Number(window.CREDIT_SCALE)||1);
}
function nbImageCostText(count, opts){
  const per = nbImageCredits(opts);
  if(per==null) return "";
  const total = per * Math.max(1, Number(count)||1);
  return String(Math.max(1, Math.ceil(total)));
}
/* small cost chip for Generate/Re-generate buttons. A tiny COMPONENT (not a static
   span) so it re-reads the current model/resolution/quality when the picker fires
   nb-model-changed / nb-settings-changed — otherwise chips deep in sheet cards would
   show the previous engine's price after a switch. */
function NbCostChipInner({ count, opts }){
  const R = window.React;
  const force = R.useState(0)[1];
  R.useEffect(()=>{
    const h = ()=>force(x=>x+1);
    window.addEventListener("nb-model-changed", h);
    window.addEventListener("nb-settings-changed", h);
    return ()=>{ window.removeEventListener("nb-model-changed", h); window.removeEventListener("nb-settings-changed", h); };
  },[]);
  const txt = nbImageCostText(count, opts);
  if(!txt) return null;
  const model = (opts&&opts.model) || nbGetModel();
  const m = (window.NB_MODELS||NB_MODELS).find(x=>x.id===model);
  const detail = isGptImageModel(model)
    ? ((opts&&opts.quality)||nbGetOaiQuality())+" quality"
    : ((opts&&opts.res)||nbGetRes());
  const n = Math.max(1, Number(count)||1);
  return window.React.createElement("span",{className:"nb-cost",
    title:"≈ "+txt+" generation credit"+(txt==="1"?"":"s")+" — "+((m&&m.label)||model)+" at "+detail
      +(n>1 ? " × "+n+" images" : " per image")},
    txt);
}
function nbCostChip(count, opts){
  if(!window.React) return null;
  return window.React.createElement(NbCostChipInner, { count, opts });
}
window.nbImageCredits = nbImageCredits; window.nbImageCostText = nbImageCostText; window.nbCostChip = nbCostChip;

/* grounding with web search — Nano Banana 2 (gemini-3.1-flash-image) only */
const NB_GROUND_KEY = "turn-nb-ground";
function nbGetGroundSearch(){ try{ return localStorage.getItem(NB_GROUND_KEY)==="1"; }catch(e){ return false; } }
function nbSetGroundSearch(v){ try{ v ? localStorage.setItem(NB_GROUND_KEY,"1") : localStorage.removeItem(NB_GROUND_KEY); }catch(e){} }
window.nbGetGroundSearch = nbGetGroundSearch; window.nbSetGroundSearch = nbSetGroundSearch;

/* simplified fallback prompt — fewer words, less detail, less likely to hit content filters */
function buildSimpleCharPrompt(c){
  const body = ((c.coreBody||c.look)||"").replace(/\.$/,"").trim();
  const wardrobe = ((c.wardrobeMask||c.wardrobe)||"").replace(/\.$/,"").trim();
  // the retry still speaks the character's PICKED render style (first clause of their
  // style block) — a content-filter fallback must not go photoreal on a stylized film
  const styleLine = (typeof window.charRenderBlock==="function")
    ? String((window.charRenderBlock(c)||{}).rendering||"").split(/[;,]/)[0].trim() : "";
  const parts = [
    "Character reference \u2014 "+(c.name||"character"),
    body||"",
    wardrobe ? ("wearing "+wardrobe) : "",
    "4-panel casting reference sheet: large close-up face portrait, full-body front view, full-body three-quarter front view, full-body back view",
    "plain grey background, studio lighting, "+(styleLine||"photoreal")+", sharp focus, no text or labels"
  ].filter(Boolean);
  const base = parts.join(". ")+".";
  const identity = (typeof window.turnIdentityPrompt==="function")
    ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  return identity ? (base+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identity) : base;
}
window.buildSimpleCharPrompt = buildSimpleCharPrompt;

/* the final character prompt the model receives. The character's exclusions are now folded
   INTO the spec's render.rules (one constraints list), so there's no separate negative prompt
   appended here — rules and the old negative prompt were doing the same job. */
function combinedImagePrompt(c, project, props){
  const base = ((typeof buildCharRefPrompt==="function") ? buildCharRefPrompt(c, project, props) : "").trim();
  const identity = (typeof window.turnIdentityPrompt==="function")
    ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  if(!identity) return base;
  return base + (base ? "\n\n" : "") + "CANONICAL CHARACTER IDENTITY (binding): "+identity;
}
window.combinedImagePrompt = combinedImagePrompt;

/* ── CANONICAL MEDIA IDENTITY GATE ──────────────────────────────────────────
   Media entry points are shared by Art Room, Shots, Stage and the voice UI.  Do
   not make each provider wrapper guess which live cast is relevant: callers pass
   an explicit identityContext/identityCharacter(s), while the arriving assertion
   helpers may fill in live scenes/drafts/cast when that context is omitted.
   The assertion is deliberately synchronous.  It therefore runs before a cache
   lookup, upload conversion, or provider submission and can never be bypassed by
   a retry path. */
function nbIdentityContext(opts, fallback){
  opts = opts || {};
  const raw = opts.identityContext || opts.identity || fallback || {};
  const cast = opts.identityCast || raw.cast || [];
  const chars = opts.identityCharacters || raw.characters || [];
  const one = opts.identityCharacter || opts.character || null;
  let ids = opts.identityCharacterIds || opts.characterIds || raw.characterIds;
  if(ids==null && one && one.id) ids = [one.id];
  if(ids==null && opts.entity && Array.isArray(opts.entity.subjects)) ids = opts.entity.subjects;
  if(ids==null) ids = [];
  const resolvedCast = Array.isArray(cast) && cast.length ? cast : (one ? [one] : (chars||[]));
  return {
    characterIds:Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : []),
    scenes:opts.identityScenes || raw.scenes,
    drafts:opts.identityDrafts || raw.drafts,
    /* Omit an empty cast so the shared helper can use the current project's
       live turnCast/turnContinuity instead of treating [] as authoritative. */
    cast:resolvedCast.length ? resolvedCast : undefined,
  };
}
function nbIdentityError(value){
  if(value instanceof Error) return value;
  const msg = value && (value.message || value.error || value.reason);
  const e = new Error(String(msg || "This media request is blocked by a character-identity contradiction."));
  e.name = "CharacterIdentityError"; e.identity = value;
  return e;
}
function nbIdentityCanonical(c){
  if(!c || typeof c!=="object") return "";
  const raw = c.canonicalPronouns || c.pronouns || "";
  const pron = typeof window.turnNormalizePronouns==="function"
    ? String(window.turnNormalizePronouns(raw)||"") : String(raw||"").trim().toLowerCase();
  return pron+"|revision:"+(c.identityRevision!=null ? String(c.identityRevision) : "");
}
function nbIdentityLiveState(){
  const live=window.turnIdentityContext;
  if(live && typeof live==="object"){
    const cast=Array.isArray(live.cast) ? live.cast
      : (Array.isArray(live.characters) ? live.characters : []);
    if(cast.length) return { cast, scenes:Array.isArray(live.scenes)?live.scenes:undefined,
      drafts:Object.prototype.hasOwnProperty.call(live,"drafts") ? live.drafts : undefined };
  }
  if(Array.isArray(window.turnCast) && window.turnCast.length)
    return { cast:window.turnCast };
  return null;
}
function nbAssertProjectIdentity(ctx, skipUnset){
  if(typeof window.turnAssertProjectIdentity!=="function") return true;
  try{ return window.turnAssertProjectIdentity(ctx); }
  catch(e){
    /* A cast-wide assertion is allowed to skip incidental unset texture
       characters.  A characterIds-scoped request is explicit and must fail
       closed; detected conflicts always fail in either case. */
    if(!(skipUnset && e && e.identityReport && e.identityReport.status==="unset")) throw e;
    const cast=Array.isArray(ctx&&ctx.cast) ? ctx.cast : [];
    const ids=Array.isArray(ctx&&ctx.characterIds) ? ctx.characterIds : [];
    const selected=ids.length ? cast.filter(c=>ids.some(id=>String(id)===String(c&&c.id))) : cast;
    const reports=[];
    selected.forEach(c=>{
      try{
        if(typeof window.turnAssertCharacterIdentity==="function")
          reports.push(window.turnAssertCharacterIdentity(c,ctx));
      }catch(err){
        if(!(err && err.identityReport && err.identityReport.status==="unset")) throw err;
      }
    });
    return reports;
  }
}
function nbAssertLiveIdentity(opts, ctx, phase){
  if(opts.identityLive===false) return null;
  const live=nbIdentityLiveState();
  if(!live) return null;
  const ids=ctx.characterIds||[];
  const startCast=Array.isArray(ctx.cast) ? ctx.cast : [];
  const selectedIds=ids.length ? ids : startCast.map(c=>c&&c.id).filter(Boolean);
  const currentCast=live.cast;
  const changed=[];
  selectedIds.forEach(id=>{
    const start=startCast.find(c=>String(c&&c.id)===String(id))
      || ((opts.identityCharacter&&String(opts.identityCharacter.id)===String(id)) ? opts.identityCharacter : null);
    const current=currentCast.find(c=>String(c&&c.id)===String(id));
    if(!start || !current) return;
    if(nbIdentityCanonical(start)!==nbIdentityCanonical(current))
      changed.push(String(current.name||start.name||id));
  });
  if(changed.length){
    const e=new Error("Character identity changed while this media request was in progress ("+changed.join(", ")+"). Review and retry.");
    e.name="CharacterIdentityChangedError"; e.phase=phase||"media"; throw e;
  }
  return { ...ctx, cast:currentCast,
    scenes:live.scenes!==undefined ? live.scenes : ctx.scenes,
    drafts:live.drafts!==undefined ? live.drafts : ctx.drafts };
}
function nbAssertMediaIdentity(opts, phase){
  opts = opts || {};
  const ctx = nbIdentityContext(opts);
  if(opts.identityLive===false){
    /* Saved dashboard/poster contexts are deliberately isolated from the
       currently open film.  Supplying an empty field is authoritative here,
       rather than an invitation for the shared helper to consult live globals. */
    if(!Array.isArray(ctx.cast)) ctx.cast=[];
    if(!Array.isArray(ctx.scenes)) ctx.scenes=[];
    if(!Object.prototype.hasOwnProperty.call(ctx,"drafts")) ctx.drafts={};
  }
  const hasScope = !!(ctx.characterIds.length || (ctx.cast&&ctx.cast.length) || opts.identityCharacter || opts.character);
  if(!hasScope) return true;
  if(opts.identityLive!==false && opts.identityEpoch!=null && typeof window.nbEpoch==="function"
    && String(window.nbEpoch())!==String(opts.identityEpoch)){
    const e=new Error("The active film changed while this media request was in progress. Review and retry.");
    e.name="IdentityScopeChangedError"; throw e;
  }
  let result;
  try{
    if(opts.identityCharacter || opts.character){
      const c = opts.identityCharacter || opts.character;
      if(typeof window.turnAssertCharacterIdentity==="function")
        result = window.turnAssertCharacterIdentity(c, { ...ctx, phase:phase||"media" });
      else if(typeof window.turnAssertProjectIdentity==="function")
        result = nbAssertProjectIdentity({ ...ctx }, false);
      const liveCtx=nbAssertLiveIdentity(opts,ctx,phase);
      if(liveCtx && typeof window.turnAssertCharacterIdentity==="function"){
        const current=(liveCtx.cast||[]).find(x=>String(x&&x.id)===String(c&&c.id));
        if(current) window.turnAssertCharacterIdentity(current,{ ...liveCtx, phase:phase||"media" });
      }
    }else if(typeof window.turnAssertProjectIdentity==="function"){
      result = nbAssertProjectIdentity(ctx, !ctx.characterIds.length);
      const liveCtx=nbAssertLiveIdentity(opts,ctx,phase);
      if(liveCtx) result=nbAssertProjectIdentity(liveCtx,!ctx.characterIds.length);
    }
  }catch(e){
    throw nbIdentityError(e);
  }
  if(result===false || (result && (result.ok===false || result.valid===false || result.blocked===true)))
    throw nbIdentityError(result);
  return result===undefined ? true : result;
}
function nbCanonicalMediaPrompt(prompt, opts){
  const cast=(opts&&opts.identityCast)||(opts&&opts.identityCharacter ? [opts.identityCharacter] : []);
  const identity=cast.length && typeof window.turnIdentityPrompt==="function"
    ? String(window.turnIdentityPrompt(cast)||"").trim() : "";
  const base=String(prompt||"");
  return identity && base.indexOf(identity)<0
    ? base+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identity : base;
}
window.nbIdentityContext = nbIdentityContext;
window.nbAssertMediaIdentity = nbAssertMediaIdentity;
window.nbCanonicalMediaPrompt = nbCanonicalMediaPrompt;

function nbIdentitySnapshot(character){
  if(!character || typeof character!=="object") return null;
  const pronouns = String(character.canonicalPronouns || character.pronouns
    || (typeof window.charPronouns==="function" ? window.charPronouns(character) : "") || "").trim();
  const out = {
    characterId:character.id||"",
    name:character.name||"",
    pronouns,
    gender:String(character.gender||character.sex||"").trim(),
    identityRevision:character.identityRevision!=null ? String(character.identityRevision) : "",
  };
  let report = null;
  try{ if(typeof window.turnIdentityReport==="function") report=window.turnIdentityReport(character); }catch(e){ out.verified=false; out.error=String(e&&e.message||e); }
  if(report && typeof report==="object"){
    out.verified = report.status!=="conflict" && report.status!=="unset"
      && report.ok!==false && report.valid!==false && !report.blocked;
    out.reportVersion = report.version || report.schemaVersion || "";
    out.canonical = report.canonical || report.identity || report.snapshot || undefined;
    if(report.pronouns || (report.canonical&&report.canonical.pronouns))
      out.pronouns = String(report.pronouns || report.canonical.pronouns || out.pronouns);
  }else if(out.verified==null) out.verified = !!out.pronouns && typeof window.turnIdentityReport==="function";
  return out;
}
window.nbIdentitySnapshot = nbIdentitySnapshot;
function nbIdentityAssetStatus(id, character, ctx){
  const meta = (typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
  /* Existing projects predate identity snapshots.  Treat those assets as
     advisory/unverified, not stale: a deploy must not invalidate every sheet.
     Only an explicit stale marker or a comparison against a known prior canon
     can block downstream use. */
  if(!meta) return { known:false, stale:false,
    reason:character ? "legacy-unverified" : "missing-metadata" };
  if(meta.identityStale)
    return { known:true, stale:true, reason:meta.identityStaleReason||"identity-check-failed", meta };
  if(!character) return { known:!!meta.identitySnapshot, stale:false, reason:meta.identitySnapshot?"verified":"unverified", meta };
  if(!meta.identitySnapshot && !meta.canonicalIdentity && !meta.canonicalPronouns)
    return { known:true, stale:false, reason:"legacy-unverified", meta };
  const current = nbIdentitySnapshot(character);
  const saved = meta.identitySnapshot || meta.canonicalIdentity || {};
  const oldPron = String(saved.pronouns || meta.canonicalPronouns || "").trim();
  const newPron = String(current&&current.pronouns||"").trim();
  const stale = (oldPron && newPron && oldPron!==newPron)
    || (saved.characterId && character.id && String(saved.characterId)!==String(character.id))
    || (current.identityRevision && String(saved.identityRevision||"")!==String(current.identityRevision));
  return { known:true, stale, reason:stale?"canon-changed":"current", meta, current };
}
function nbAssertIdentityAssetFresh(id, character, ctx){
  const s = nbIdentityAssetStatus(id, character, ctx);
  if(s.stale){
    const e = new Error("The character reference is stale or unverified for the current canon ("+(s.reason||"identity mismatch")+"). Regenerate the character sheet before using it.");
    e.name="StaleCharacterIdentityError"; e.identityStatus=s; throw e;
  }
  return s;
}
window.nbIdentityAssetStatus = nbIdentityAssetStatus;
window.nbAssertIdentityAssetFresh = nbAssertIdentityAssetFresh;

/* ===== storage backend selector: 'local' (IndexedDB) or 'cloud' (Supabase) =====
   The app calls one set of nb* functions; this routes them to the right backend.
   In cloud mode, sync reads come from these caches (filled by the async loaders). */
let _nbBackend = "local";   // 'local' | 'cloud'
let _nbProject = null;      // current cloud project id
let _nbUid = null;          // current cloud user id
const _cloudUrlCache = new Map();    // entityId -> signed url
const _cloudMetaCache = new Map();   // entityId -> meta
/* SCOPE EPOCH — bumped whenever the asset scope changes (opening another film, or
   dropping to local). Generation is async and entity ids REPEAT across films (two films
   with an office both hold "loc-office-0"), so a render that finished after a film switch
   used to commit into the NEW film under the OLD film's entity id — overwriting that
   film's real plate and rolling it into its history. Callers capture nbEpoch() before
   generating and hand it to nbCommit, which refuses a write from a dead scope. */
let _nbEpoch = 0;
function nbEpoch(){ return _nbEpoch; }
window.nbEpoch = nbEpoch;
/* Reconcile caches after a caller has independently verified that an ambiguous
   cloud save is the current generation. Synchronous by design: no second write,
   fetch, or post-check window. */
function nbAdoptVerifiedAsset(id,expectedEpoch,asset){
  if(expectedEpoch!==_nbEpoch) return false;
  if(_nbBackend==="cloud"){
    if(asset&&asset.url) _cloudUrlCache.set(id,asset.url); else _cloudUrlCache.delete(id);
    if(asset&&Object.prototype.hasOwnProperty.call(asset,"meta")) _cloudMetaCache.set(id,asset.meta||null);
  }
  return true;
}
window.nbAdoptVerifiedAsset=nbAdoptVerifiedAsset;
function nbUseCloud(projectId, uid){ if(projectId!==_nbProject) _nbEpoch++; _nbBackend="cloud"; _nbProject=projectId; _nbUid=uid; _cloudUrlCache.clear(); _cloudMetaCache.clear(); if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll(); }
function nbUseLocal(){ if(_nbProject!==null) _nbEpoch++; _nbBackend="local"; _nbProject=null; _nbUid=null; _nbShared=null; _nbSharedIds=null; _cloudUrlCache.clear(); _cloudMetaCache.clear(); if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll(); }

/* ── SHOW-SCOPED SHARED ASSETS (series) ───────────────────────────────────────
   A show's bible entities (cast / locations / props / lookbook) are shared by
   every episode, so their generated sheets live under the SHOW's bible-project
   id, not the episode's. nbUseShared(showId, bibleEntityIds) declares which
   entity ids are shared; _scopeFor(id) routes loads/commits/details for those
   ids and their derived sub-slots ("-variant" plus character ":state") to the show scope. Reads fall back to
   the episode scope so a project converted into a show keeps showing sheets it
   generated before the conversion. */
let _nbShared = null, _nbSharedIds = null;
function nbUseShared(scopeId, ids){
  _nbShared = scopeId || null;
  _nbSharedIds = (scopeId && ids && ids.length) ? ids.slice() : null;
  _cloudUrlCache.clear(); _cloudMetaCache.clear();
  if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll();
}
function _scopeFor(id){
  if(_nbShared && _nbSharedIds){
    const s = String(id||"");
    for(const b of _nbSharedIds){
      // Location/prop variants use a hyphen; character appearance sheets use
      // "characterId:stateId". Both inherit the bible entity's show scope.
      if(s===b || s.indexOf(b+"-")===0 || s.indexOf(b+":")===0) return _nbShared;
    }
  }
  return _nbProject;
}
window.nbUseShared = nbUseShared;
function nbBackend(){ return _nbBackend; }
window.nbUseCloud = nbUseCloud; window.nbUseLocal = nbUseLocal; window.nbBackend = nbBackend;
/* current cloud scope for the OTHER asset stores (video takes ride the same
   project + epoch discipline as images) — null while in local mode. */
function nbCloudScope(){ return (_nbBackend==="cloud" && _nbProject) ? { projectId:_nbProject, uid:_nbUid, epoch:_nbEpoch } : null; }
window.nbCloudScope = nbCloudScope;

/* per-character generated image store — 3-tier: localStorage → sessionStorage → in-memory Map */
const _nbImgMemory = new Map();
function nbImgKey(id){ return "turn-charimg-"+id; }
function localGetImage(id){
  const k = nbImgKey(id);
  try{ const v=localStorage.getItem(k); if(v) return v; }catch(e){}
  try{ const v=sessionStorage.getItem(k); if(v) return v; }catch(e){}
  return _nbImgMemory.get(k)||"";
}
/* sync read — cloud cache when in cloud mode, else local 3-tier */
function nbGetImage(id){
  if(_nbBackend==="cloud") return _cloudUrlCache.get(id) || "";
  return localGetImage(id);
}

/* ---- IndexedDB layer: generated sheets are large base64 data URLs (often >1MB),
   which overflow localStorage's ~5MB cap. IndexedDB holds them durably with room
   to spare. Reads are async; the in-memory Map mirrors writes for instant reads. ---- */
const IDB_DB="turn-images", IDB_STORE="images";
let _idbPromise=null;
function idbOpen(){
  if(_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve,reject)=>{
    try{
      if(!window.indexedDB){ reject(new Error("no idb")); return; }
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = ()=>{ const db=req.result; if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    }catch(e){ reject(e); }
  });
  return _idbPromise;
}
function idbSet(key,val){ return idbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,"readwrite"); tx.objectStore(IDB_STORE).put(val,key); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }
function idbGet(key){ return idbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,"readonly"); const r=tx.objectStore(IDB_STORE).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbDel(key){ return idbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,"readwrite"); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }

/* async load: memory → localStorage → sessionStorage → IndexedDB (hydrates on mount) */
async function localLoadImage(id){
  const sync = localGetImage(id);
  if(sync) return sync;
  try{ const v = await idbGet(nbImgKey(id)); if(v){ _nbImgMemory.set(nbImgKey(id), v); return v; } }catch(e){}
  return "";
}
/* ---- cloud byte-cache ----------------------------------------------------
   Signed URLs change every session, so the browser's HTTP cache NEVER hits in
   cloud mode — every app load re-downloads every multi-MB sheet. Cache the
   image bytes in IndexedDB keyed by entity and stamped with the storage path:
   same path → instant object URL, zero network; new path (a re-generation)
   → refreshed naturally. One blob per entity, so the cache can't balloon. */
function nbCloudKey(id){ return "turn-cloudimg-"+id; }
const _objUrls = new Map();   // entityId -> { url, path } (released when the path changes)
function _setObjUrl(id, blob, path){
  try{
    const cur = _objUrls.get(id);
    if(cur && cur.path===path) return cur.url;   // same version → reuse, don't churn live URLs
    const u = URL.createObjectURL(blob);
    if(cur){ try{ URL.revokeObjectURL(cur.url); }catch(e){} }
    _objUrls.set(id, { url:u, path });
    return u;
  }catch(e){ return ""; }
}
async function cloudBytesFromCache(id, path){
  const cur = _objUrls.get(id);
  if(cur && cur.path===path) return cur.url;     // already materialized this version
  try{
    const rec = await idbGet(nbCloudKey(id));
    if(rec && rec.path===path && rec.blob) return _setObjUrl(id, rec.blob, path);
  }catch(e){}
  return "";
}
let _byteQueue = Promise.resolve();   // serialize background caching — never hog bandwidth
function cloudCacheBytes(id, path, url){
  if(!path || !url || /^blob:/.test(url)) return;
  _byteQueue = _byteQueue.then(async ()=>{
    try{
      const rec = await idbGet(nbCloudKey(id));
      if(rec && rec.path===path) return;   // already cached for this version
      const res = await fetch(url); if(!res.ok) return;
      const blob = await res.blob();
      await idbSet(nbCloudKey(id), { path, blob });
    }catch(e){}
  }).catch(()=>{});
}
/* one hydrate path for every cloud load result {url, path, meta}: prefer cached
   bytes (instant, offline-tolerant); else paint from the signed URL now and
   cache its bytes in the background for the next session. */
async function cloudHydrate(id, r){
  if(!r || !r.url) return "";
  if(r.path){
    const cached = await cloudBytesFromCache(id, r.path);
    if(cached){ _cloudUrlCache.set(id, cached); _cloudMetaCache.set(id, r.meta||null); return cached; }
    cloudCacheBytes(id, r.path, r.url);
  }
  _cloudUrlCache.set(id, r.url); _cloudMetaCache.set(id, r.meta||null);
  return r.url;
}

async function nbLoadImage(id){
  if(_nbBackend==="cloud"){
    if(_cloudUrlCache.get(id)) return _cloudUrlCache.get(id);
    // a whole-project prefetch may already be in flight — ride it instead of
    // stampeding one DB query + one signing call per mounting card
    if(_prefetchAllPromise && _prefetchAllProj===_nbProject){
      try{ await _prefetchAllPromise; }catch(e){}
      if(_cloudUrlCache.get(id)) return _cloudUrlCache.get(id);
    }
    if(typeof window.cloudAssetLoad!=="function") return "";
    const scope = _scopeFor(id);
    let r = await window.cloudAssetLoad(scope, id);
    // shared-scope miss → fall back to the episode scope (pre-conversion sheets)
    if((!r || !r.path) && scope!==_nbProject){ r = await window.cloudAssetLoad(_nbProject, id); }
    return await cloudHydrate(id, r);
  }
  return localLoadImage(id);
}
/* A rendered <img> can outlive its cloud signed URL (or a cached blob URL can be
   revoked by the browser). The asset still exists; only its paint URL is stale.
   Re-resolve that exact asset id without generating or changing any pixels. */
const _nbRefreshPending = new Map();
function nbRefreshImage(id, failedUrl){
  if(!id) return Promise.resolve("");
  if(_nbRefreshPending.has(id)) return _nbRefreshPending.get(id);
  const p = (async()=>{
    if(_nbBackend!=="cloud") return await localLoadImage(id);
    const obj = _objUrls.get(id);
    // Only discard an object URL when it is the URL that actually failed. A
    // different live object URL may be painting the same asset elsewhere.
    if(obj && (!failedUrl || obj.url===failedUrl)){
      try{ URL.revokeObjectURL(obj.url); }catch(e){}
      _objUrls.delete(id);
    }
    _cloudUrlCache.delete(id);
    if(typeof window.cloudAssetLoad!=="function") return "";
    const scope = _scopeFor(id);
    let r = await window.cloudAssetLoad(scope, id);
    if((!r || !r.path) && scope!==_nbProject) r = await window.cloudAssetLoad(_nbProject, id);
    const u = await cloudHydrate(id, r);
    if(u){
      try{ window.dispatchEvent(new CustomEvent("nb-prefetched",{ detail:{ ids:[id], refreshed:true } })); }catch(e){}
    }
    return u||"";
  })();
  _nbRefreshPending.set(id,p);
  const done=()=>{ if(_nbRefreshPending.get(id)===p) _nbRefreshPending.delete(id); };
  p.then(done,done);
  return p;
}
/* Server-side render inputs need a real fetchable URL, not the browser's byte-cache
   blob URL. Use this for Stage/video hand-offs; keep nbLoadImage for painting. */
async function nbRemoteImageUrl(id){
  if(_nbBackend!=="cloud" || !id || typeof window.cloudAssetLoad!=="function") return "";
  const scope = _scopeFor(id);
  let r = await window.cloudAssetLoad(scope, id);
  if((!r || !r.path) && scope!==_nbProject){ r = await window.cloudAssetLoad(_nbProject, id); }
  if(r && r.url){ _cloudMetaCache.set(id, r.meta||null); return r.url; }
  return "";
}
window.nbLoadImage = nbLoadImage;
window.nbRefreshImage = nbRefreshImage;
window.nbRemoteImageUrl = nbRemoteImageUrl;

/* warm the browser's image cache so it paints instantly when rendered */
function nbPreloadBytes(urls){
  for(const u of (urls||[])){ if(!u) continue; try{ const im = new Image(); im.decoding="async"; im.src=u; }catch(e){} }
}
/* Pre-warm the URL cache (and image bytes) for many entity ids in ONE batched round-trip,
   BEFORE their cards mount — so a tab like Characters shows images immediately instead of
   doing a DB query + signed-URL call per card on click. Skips ids already cached. Cards read
   the warmed cache synchronously via nbGetImage(); a 'nb-prefetched' event nudges any card
   that mounted before warming finished. Safe no-op until a backend is selected. */
async function nbPrefetch(ids){
  ids = Array.from(new Set((ids||[]).filter(id => id && !_cloudUrlCache.get(id) && !nbGetImage(id))));
  if(!ids.length) return;
  if(_nbBackend==="cloud"){
    if(typeof window.cloudAssetLoadMany!=="function") return;
    // shared (bible) ids batch against the show scope; the rest against the episode
    const sharedIds = ids.filter(id=>_scopeFor(id)!==_nbProject);
    const ownIds = ids.filter(id=>_scopeFor(id)===_nbProject);
    let map = {};
    try{
      const batches = await Promise.all([
        ownIds.length ? window.cloudAssetLoadMany(_nbProject, ownIds) : {},
        sharedIds.length ? window.cloudAssetLoadMany(_nbShared, sharedIds) : {},
      ]);
      map = Object.assign({}, batches[0]||{}, batches[1]||{});
    }catch(e){ return; }
    const got = [], urls = [];
    for(const id in map){ const u = await cloudHydrate(id, map[id]); if(u){ got.push(id); urls.push(u); } }
    if(got.length){ nbPreloadBytes(urls); window.dispatchEvent(new CustomEvent("nb-prefetched",{ detail:{ ids:got } })); }
  } else {
    const got = [];
    await Promise.all(ids.map(async id=>{ try{ const u = await localLoadImage(id); if(u) got.push(id); }catch(e){} }));
    if(got.length) window.dispatchEvent(new CustomEvent("nb-prefetched",{ detail:{ ids:got } }));
  }
}
window.nbPrefetch = nbPrefetch;

/* Pre-warm EVERY asset URL in the current project in one batched round-trip (memoized per
   project), so ANY Art Room tab paints without a per-card DB + signed-URL call. URLs only —
   bytes are loaded on render (or via nbPreloadFor for the active tab). */
let _prefetchAllProj = null, _prefetchAllPromise = null;
function nbResetPrefetchAll(){ _prefetchAllProj = null; _prefetchAllPromise = null; }
async function nbPrefetchAll(){
  if(_nbBackend!=="cloud") return;
  if(_prefetchAllPromise && _prefetchAllProj===_nbProject) return _prefetchAllPromise;
  _prefetchAllProj = _nbProject;
  _prefetchAllPromise = (async()=>{
    if(typeof window.cloudAssetLoadAll!=="function") return;
    let map = {};
    try{
      // episode scope + (for series) the show's shared bible scope, in one pass.
      // The SHOW's entries win on collision — matching _scopeFor's read routing
      // (a bible sheet regenerated post-conversion supersedes the episode copy).
      const batches = await Promise.all([
        window.cloudAssetLoadAll(_nbProject),
        _nbShared ? window.cloudAssetLoadAll(_nbShared) : {},
      ]);
      map = Object.assign({}, batches[0]||{}, batches[1]||{});
    }catch(e){ return; }
    const got = [];
    for(const id in map){ const u = await cloudHydrate(id, map[id]); if(u) got.push(id); }
    if(got.length) window.dispatchEvent(new CustomEvent("nb-prefetched",{ detail:{ ids:got } }));
  })();
  return _prefetchAllPromise;
}
window.nbPrefetchAll = nbPrefetchAll;

/* Preload image BYTES for entity ids whose URLs are already cached — used for the tab on
   screen so it paints instantly. Capped to a couple screenfuls to bound bandwidth on big
   tabs (the rest lazy-load on scroll). */
async function nbPreloadFor(ids){
  ids = (ids||[]).filter(Boolean).slice(0, 24);
  if(!ids.length) return;
  if(_nbBackend==="cloud"){
    const urls = [];
    for(const id of ids){ const u = _cloudUrlCache.get(id); if(u) urls.push(u); }
    nbPreloadBytes(urls);
  } else {
    await Promise.all(ids.map(async id=>{ try{ await localLoadImage(id); }catch(e){} }));
  }
}
window.nbPreloadFor = nbPreloadFor;

/* local 3-tier save (used by the local backend) */
async function localSetImage(id, url){
  const k = nbImgKey(id);
  if(!url){
    _nbImgMemory.delete(k);
    try{ localStorage.removeItem(k); }catch(e){}
    try{ sessionStorage.removeItem(k); }catch(e){}
    try{ await idbDel(k); }catch(e){}
    try{ await idbDel(nbRefsKey(id)); }catch(e){}
    try{ await idbDel(nbHistKey(id)); }catch(e){}
    return { tier:"none" };
  }
  _nbImgMemory.set(k, url);
  try{ localStorage.removeItem(k); }catch(e){}
  try{ await idbSet(k, url); return { tier:"idb" }; }catch(e){}
  try{ localStorage.setItem(k, url); return { tier:"local" }; }catch(e){}
  try{ sessionStorage.setItem(k, url); return { tier:"session" }; }catch(e){}
  return { tier:"memory" };
}
window.nbGetImage = nbGetImage;

/* Delete only the current local bytes.  localSetImage(id,"") also removes the
   reference/history stores, which is correct for the old generic clear action
   but would violate permanent purge's history/specification retention contract. */
async function localClearCurrentImageOnly(id){
  const k=nbImgKey(id);
  _nbImgMemory.delete(k);
  try{ localStorage.removeItem(k); }catch(e){}
  try{ sessionStorage.removeItem(k); }catch(e){}
  try{ await idbDel(k); }catch(e){}
}
function _nbPurgeRefMatches(ref,target,entry){
  if(!ref) return false;
  const allowDeleted=arguments.length>3&&arguments[3]===true;
  if(ref.deleted&&!allowDeleted) return false;
  const path=String(ref.url||ref.storage_path||ref.deletedStoragePath||"");
  if(path && path===String(target.storagePath||"")) return true;
  if(ref.refId!=null && String(ref.refId)===String(target.id)
      && target.iso && String(ref.refGenerated||"")===String(target.iso)) return true;
  const seed=(ref.meta&&ref.meta.seedSource)||ref.seedSource
    ||(entry&&entry.meta&&entry.meta.seedSource);
  if(!ref.refId && seed
      && String(seed.seedShotId||"")===String(target.id)
      && target.iso && String(seed.seedIso||"")===String(target.iso)){
    return seed.seedVersion==null || target.version==null
      || Number(seed.seedVersion)===Number(target.version);
  }
  return false;
}
function _nbPurgeCollectEvidencePaths(refs,target,paths,entry){
  for(const ref of Array.isArray(refs)?refs:[]){
    if(!_nbPurgeRefMatches(ref,target,entry,true)) continue;
    const path=ref&&(ref.url||ref.storage_path||ref.deletedStoragePath);
    if(path) paths.add(String(path));
  }
}
function _nbPurgeRefWarning(ref,target,entry){
  if(!ref||ref.deleted||!(ref.url||ref.storage_path)) return false;
  if(ref.refId!=null && String(ref.refId)===String(target.id) && !ref.refGenerated) return true;
  const seed=(ref.meta&&ref.meta.seedSource)||ref.seedSource
    ||(entry&&entry.meta&&entry.meta.seedSource);
  return !ref.refId&&!seed;
}
function _nbPurgeDeletedRef(ref){
  const path=ref&&(ref.url||ref.storage_path) ? String(ref.url||ref.storage_path) : "";
  return {...ref,deleted:true,deletedAt:new Date().toISOString(),
    ...(path?{deletedStoragePath:path}:{}),url:"",storage_path:null};
}
function _nbPurgeRewriteRefs(refs,target,entry,warnings){
  let removed=0,changed=false;
  const out=(Array.isArray(refs)?refs:[]).map(ref=>{
    if(_nbPurgeRefMatches(ref,target,entry)){ removed++;changed=true;return _nbPurgeDeletedRef(ref); }
    if(_nbPurgeRefWarning(ref,target,entry)) warnings.add("An older reference snapshot could not be identified exactly and was retained.");
    return ref;
  });
  return {refs:out,removed,changed};
}
function _nbPurgeLocalTargetSame(marker,target){
  return !!(marker&&String(marker.id||"")===String(target.id||"")
    && String(marker.storagePath||"")===String(target.storagePath||"")
    && String(marker.iso||"")===String(target.iso||"")
    && ((marker.version==null&&target.version==null)
      ||(marker.version!=null&&target.version!=null
        &&Number(marker.version)===Number(target.version))));
}
function _nbPendingTargetFromMeta(id,meta,epoch,backend,scope){
  const marker=meta&&meta.cleanupPurgeTarget;
  if(!marker||!meta.cleanupPurge) return null;
  if(String(marker.id||id)!==String(id)||!marker.storagePath) return null;
  if(!meta.cleanupPurgeWarning && !meta.cleanupPending) return null;
  const retryable=meta.cleanupPurgeRetryable!=null
    ? meta.cleanupPurgeRetryable!==false : !!meta.cleanupPending;
  return Object.freeze({id:String(marker.id||id),epoch,backend,scope:scope==null?null:scope,
    storagePath:String(marker.storagePath||""),iso:String(marker.iso||""),
    version:marker.version==null?null:marker.version,url:"",pending:true,retryable,
    status:retryable?(meta.cleanupPurgeStatus||"cleanup-pending")
      :"retained-unverified"});
}

/* reference images used + version history of a generated sheet (IndexedDB — can be large) */
function nbRefsKey(id){ return "turn-charimg-refs-"+id; }
function nbHistKey(id){ return "turn-charimg-hist-"+id; }
async function localGetRefs(id){ try{ return (await idbGet(nbRefsKey(id)))||[]; }catch(e){ return []; } }
async function localSetRefs(id, refs){ try{ (refs&&refs.length) ? await idbSet(nbRefsKey(id), refs) : await idbDel(nbRefsKey(id)); }catch(e){} }
async function localGetHistory(id){ try{ return (await idbGet(nbHistKey(id)))||[]; }catch(e){ return []; } }
async function localSetHistory(id, hist){ try{ (hist&&hist.length) ? await idbSet(nbHistKey(id), hist) : await idbDel(nbHistKey(id)); }catch(e){} }
async function nbGetRefs(id){
  if(_nbBackend==="cloud"){ const d = (typeof window.cloudLoadDetails==="function") ? await window.cloudLoadDetails(_scopeFor(id), id) : null; return d ? d.refs : []; }
  return localGetRefs(id);
}
async function nbGetHistory(id){
  if(_nbBackend==="cloud"){ const d = (typeof window.cloudLoadDetails==="function") ? await window.cloudLoadDetails(_scopeFor(id), id) : null; return d ? d.history : []; }
  return localGetHistory(id);
}
window.nbGetRefs = nbGetRefs;
window.nbGetHistory = nbGetHistory;   // the fullscreen viewer's version strip reads this

/* per-character generation metadata (model, aspect, size, date) */
function nbMetaKey(id){ return "turn-charimg-meta-"+id; }
function localGetMeta(id){ try{ return JSON.parse(localStorage.getItem(nbMetaKey(id))||"null"); }catch(e){ return null; } }
function localSetMeta(id, meta){ try{ meta ? localStorage.setItem(nbMetaKey(id),JSON.stringify(meta)) : localStorage.removeItem(nbMetaKey(id)); }catch(e){} }
function nbGetMeta(id){
  if(_nbBackend==="cloud") return _cloudMetaCache.get(id) || null;
  return localGetMeta(id);
}
window.nbGetMeta = nbGetMeta;

/* ── exact-image permanent purge API -----------------------------------------
   Prepare snapshots identity before the destructive operation is queued.
   `target` is frozen so a late UI completion cannot retarget the operation at a
   newer image.  Cloud preparation delegates the row read to cloud.jsx; local
   preparation snapshots the exact current bytes/key and metadata. */
async function nbPrepareImageDeletion(id){
  if(!id) throw new Error("image id is required");
  const backend=_nbBackend, epoch=_nbEpoch, scope=backend==="cloud"?_scopeFor(id):null;
  if(backend==="cloud"){
    if(typeof window.cloudPrepareImageDeletion!=="function")
      throw new Error("cloud image purge unavailable");
    const prepared=await window.cloudPrepareImageDeletion(scope,id);
    if(epoch!==_nbEpoch||backend!==_nbBackend||scope!==_scopeFor(id))
      throw new Error("asset scope changed");
    return Object.freeze({...prepared,id:String(id),epoch,backend:"cloud",scope});
  }
  const url=await localLoadImage(id);
  if(epoch!==_nbEpoch||backend!==_nbBackend) throw new Error("asset scope changed");
  const meta=localGetMeta(id)||{};
  if(!url){
    const pending=_nbPendingTargetFromMeta(id,meta,epoch,backend,null);
    if(pending) return pending;
    throw new Error("No current image is available to purge.");
  }
  return Object.freeze({id:String(id),epoch,backend:"local",scope:null,
    storagePath:String(url),iso:String(meta.iso||""),
    version:meta.version==null?null:meta.version,url:String(url)});
}
async function nbLoadPendingImageDeletion(id){
  if(!id) return null;
  const backend=_nbBackend, epoch=_nbEpoch, scope=backend==="cloud"?_scopeFor(id):null;
  if(backend==="cloud"){
    if(typeof window.cloudLoadPendingImageDeletion!=="function") return null;
    const pending=await window.cloudLoadPendingImageDeletion(scope,id);
    if(epoch!==_nbEpoch||backend!==_nbBackend||scope!==_scopeFor(id)) return null;
    return pending ? Object.freeze({...pending,id:String(id),epoch,backend:"cloud",scope,pending:true}) : null;
  }
  const pending=_nbPendingTargetFromMeta(id,localGetMeta(id)||{},epoch,backend,null);
  if(epoch!==_nbEpoch||backend!==_nbBackend) return null;
  return pending;
}

async function _nbInvalidateCloudPurgeCache(id,target,epoch,warning,retryable,status){
  /* Scope check before and after every asynchronous cache operation is
     intentional: a late purge completion must not evict a new film's cache. */
  if(epoch!==_nbEpoch) return false;
  const obj=_objUrls.get(id);
  if(obj&&obj.path===target.storagePath){
    try{ URL.revokeObjectURL(obj.url); }catch(e){}
    _objUrls.delete(id);
  }
  if(epoch!==_nbEpoch) return false;
  try{
    const rec=await idbGet(nbCloudKey(id));
    if(epoch!==_nbEpoch) return false;
    if(rec&&rec.path===target.storagePath) await idbDel(nbCloudKey(id));
  }catch(e){}
  if(epoch!==_nbEpoch) return false;
  const cachedMeta=_cloudMetaCache.get(id), cachedUrl=_cloudUrlCache.get(id);
  const sameMeta=!!(cachedMeta&&String(cachedMeta.iso||"")===String(target.iso||"")
    && (target.version==null||cachedMeta.version==null
      ||Number(cachedMeta.version)===Number(target.version)));
  if(sameMeta||cachedUrl===target.url){
     _cloudUrlCache.delete(id);
     /* Keep tombstone/specification evidence in the metadata cache.  A warning
        must leave the UI with a retryable placeholder, not erase the identity
        needed to retry after reload. */
     _cloudMetaCache.set(id,{...(cachedMeta||{}),cleanupPurge:true,
       cleanupPurgeTarget:{id:String(target.id),storagePath:String(target.storagePath),
         iso:String(target.iso||""),version:target.version==null?null:target.version},
       deleted:true,deletedStoragePath:String(target.storagePath),
       ...(warning?{cleanupPurgeWarning:String(warning)}:{}),
       ...(retryable!=null?{cleanupPurgeRetryable:!!retryable}:{}),
       ...(status?{cleanupPurgeStatus:String(status)}:{})});
  }
  return true;
}

function nbPurgeImageVersion(target,options){
  options=options||{};
  const id=target&&target.id;
  /* Capture all scope-bearing values before entering the per-asset queue. */
  const backend=_nbBackend, epoch=_nbEpoch;
  const scope=backend==="cloud"?(id?_scopeFor(id):null):null, uid=_nbUid;
  const callerCancelled=options.cancelled;
  const cancelled=()=> (typeof callerCancelled==="function" ? !!callerCancelled() : callerCancelled===true);
  return _nbSerial(id,()=>_nbPurgeImageVersionInner(target,{...options,
    backend,epoch,scope,uid,cancelled}));
}
async function _nbPurgeImageVersionInner(target,ctx){
  const {backend,epoch,scope,uid,cancelled}=ctx, id=target&&target.id;
  const stale=()=>epoch!==_nbEpoch||backend!==_nbBackend
    ||(backend==="cloud"&&scope!==_scopeFor(id));
  const guard=()=>cancelled()||stale();
  if(!target||!id) return {ok:false,error:"exact image identity required"};
  if(target.pending&&target.retryable===false)
    return {ok:false,error:"purge retained an unverified reference; refresh required",
      status:"retained-unverified",retryable:false};
  if(target.backend!==backend
      ||(target.epoch!=null&&target.epoch!==epoch)
      ||(backend==="cloud"&&String(target.scope||"")!==String(scope||"")))
    return {ok:false,error:"asset scope changed"};
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  if(typeof window.__nbGenInflight!=="undefined"&&window.__nbGenInflight
      &&window.__nbGenInflight[id])
    return {ok:false,error:"image generation is still in progress"};

  if(backend==="cloud"){
    if(typeof window.cloudPurgeImageVersion!=="function")
      throw new Error("cloud image purge unavailable");
    let result;
    try{
      result=await window.cloudPurgeImageVersion(scope,uid,target,{
        ...ctx,cancelled:guard});
    }catch(e){
      if(stale()) return {ok:false,error:"asset scope changed"};
      throw e;
    }
    /* The server may have completed just as the user switched films.  Do not
       touch any cache belonging to the new scope or announce its old image. */
    if(stale()) return result&&result.ok ? {...result,cacheSkipped:true}
      : {ok:false,error:"asset scope changed"};
    if(result&&result.ok){
      if(typeof window.cloudInvalidateExactPaths==="function")
        window.cloudInvalidateExactPaths([target.storagePath]);
      await _nbInvalidateCloudPurgeCache(id,target,epoch,result.cleanupWarning,
        result.retryable,result.status);
      if(stale()) return {...result,cacheSkipped:true};
      try{ window.dispatchEvent(new CustomEvent("nb-gen-done",
        {detail:{id,ids:[id],url:""}})); }catch(e){}
    }
    return result||{ok:false,error:"image purge failed"};
  }

  let current=await localLoadImage(id);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  const meta=localGetMeta(id)||{};
  const marker=meta&&meta.cleanupPurgeTarget;
  if(!current&&_nbPurgeLocalTargetSame(marker,target))
    if(meta.cleanupPurgeRetryable===false)
      return {ok:false,error:"purge retained an unverified reference; refresh required",
        status:"retained-unverified",retryable:false};
  if(!current&&_nbPurgeLocalTargetSame(marker,target))
    return {ok:true,referencesRemoved:0,url:"",meta:null,
      ...(meta.cleanupPurgeWarning?{cleanupWarning:meta.cleanupPurgeWarning}:{})};
  if(!current||String(current)!==String(target.storagePath)
      ||String(meta.iso||"")!==String(target.iso||"")
      ||!((target.version==null&&meta.version==null)
        ||(target.version!=null&&meta.version!=null
          &&Number(meta.version)===Number(target.version))))
    return {ok:false,error:"current image changed; purge refused"};

  const warnings=new Set();
  let refs=await localGetRefs(id), history=await localGetHistory(id);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  const direct=_nbPurgeRewriteRefs(refs,target,{meta},warnings);
  let referencesRemoved=direct.removed, historyChanged=direct.changed;
  const nextHistory=history.map(item=>{
    const rewritten=_nbPurgeRewriteRefs(item&&item.refs,target,item,warnings);
    referencesRemoved+=rewritten.removed; historyChanged=historyChanged||rewritten.changed;
    return rewritten.changed?{...item,refs:rewritten.refs}:item;
  });
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  if(direct.changed) await localSetRefs(id,direct.refs);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  if(historyChanged) await localSetHistory(id,nextHistory);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  const deletedMeta={...meta,cleanupPurgeTarget:{
    id:String(id),storagePath:String(target.storagePath),iso:String(target.iso||""),
    version:target.version==null?null:target.version},
     deleted:true,deletedStoragePath:String(target.storagePath)};
  if(warnings.size){
    deletedMeta.cleanupPurgeWarning=Array.from(warnings).join(" ");
    deletedMeta.cleanupPurgeRetryable=false;
    deletedMeta.cleanupPurgeStatus="retained-unverified";
  }
  localSetMeta(id,deletedMeta);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  await localClearCurrentImageOnly(id);
  if(guard()) return {ok:false,error:cancelled()?"purge cancelled":"asset scope changed"};
  try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id,ids:[id],url:""}})); }catch(e){}
  return {ok:true,referencesRemoved, url:"",meta:null,
    ...(warnings.size?{cleanupWarning:Array.from(warnings).join(" ")}:{})};
}
window.nbPrepareImageDeletion=nbPrepareImageDeletion;
window.nbLoadPendingImageDeletion=nbLoadPendingImageDeletion;
window.nbPurgeImageVersion=nbPurgeImageVersion;

/* ============================================================
   CAMEO — "Cast yourself" identity capture (Increments A + B).
   A captured face becomes a persistent, reusable likeness token
   for one character: it is auto-attached as a conditioning
   reference on EVERY generation of that character (base + states)
   so the face stays consistent shot-to-shot.

   Increment B: MULTI-ANGLE capture (front + ¾ left/right) for far
   stronger consistency, full PROVENANCE metadata (source, subject,
   consent, capture date, angle count), and an explicit opt-in to
   SYNC the cameo to the cloud for cross-device use.

   Biometric data → LOCAL-ONLY by default (IndexedDB, this device).
   We only push a cameo to Supabase when sync===true.

   Record shape (IDB, key turn-cameo-<id>):
     { url, angles:[{label,url}], consent, sync, source, subject,
       w, h, iso, date }   — url mirrors angles[0] for back-compat.
   Registry (localStorage, images stripped): meta only.
   ============================================================ */
const _cameoMem = new Map();              // charId -> full record (instant sync reads)
function nbCameoKey(id){ return "turn-cameo-"+id; }
function nbCameoRegKey(){ return "turn-cameo-registry"; }
function cameoReg(){ try{ return JSON.parse(localStorage.getItem(nbCameoRegKey())||"{}"); }catch(e){ return {}; } }
function cameoRegWrite(o){ try{ localStorage.setItem(nbCameoRegKey(), JSON.stringify(o)); }catch(e){} }
function cameoMetaOf(rec){
  return { consent:!!rec.consent, sync:!!rec.sync, source:rec.source||"webcam",
    subject:rec.subject||"", angleCount:(rec.angles&&rec.angles.length)||1,
    w:rec.w||0, h:rec.h||0, iso:rec.iso, date:rec.date };
}
/* normalise any record to the multi-angle shape (handles Increment-A singles) */
function cameoNormalize(rec){
  if(!rec) return null;
  let angles = (rec.angles && rec.angles.length) ? rec.angles.slice()
             : (rec.url ? [{ label:"Front", url:rec.url }] : []);
  angles = angles.filter(a=>a && a.url);
  return { ...rec, angles, url: angles.length ? angles[0].url : (rec.url||"") };
}
/* sync existence + meta (registry is tiny, lives in localStorage) */
function nbHasCameo(id){ return !!cameoReg()[id]; }
function nbCameoMeta(id){ const r=cameoReg()[id]; return r||null; }
/* sync primary url + all angle urls, if already in memory */
function nbGetCameo(id){ const r=_cameoMem.get(id); return r&&r.url ? r.url : ""; }
function nbGetCameoAngles(id){ const r=_cameoMem.get(id); return (r&&r.angles)?r.angles.map(a=>a.url).filter(Boolean):[]; }
/* async load primary url (memory → IDB → cloud-if-synced) */
async function nbLoadCameo(id){
  const full = await nbLoadCameoFull(id);
  return full ? full.url : "";
}
async function nbLoadCameoAngles(id){
  const full = await nbLoadCameoFull(id);
  return full ? full.angles.map(a=>a.url).filter(Boolean) : [];
}
/* async load the FULL record (for the manager + generation) */
async function nbLoadCameoFull(id){
  const m=_cameoMem.get(id); if(m && m.angles && m.angles.length) return m;
  try{ const v=await idbGet(nbCameoKey(id)); if(v){ const n=cameoNormalize(v); _cameoMem.set(id,n); return n; } }catch(e){}
  /* cloud hydrate (only if this cameo was synced) */
  const meta=cameoReg()[id];
  if(meta && meta.sync && typeof window.cloudLoadCameo==="function" && _nbProject){
    try{
      const r = await window.cloudLoadCameo(_nbProject, id);
      if(r){ const n=cameoNormalize(r); _cameoMem.set(id,n); try{ await idbSet(nbCameoKey(id), n); }catch(e){} return n; }
    }catch(e){}
  }
  return null;
}
/* save/replace a cameo. rec = { angles:[{label,url}] | url, consent, sync, source, subject, w, h } */
async function nbSetCameo(id, rec){
  const now=new Date();
  const norm = cameoNormalize({ ...rec,
    iso: now.toISOString(),
    date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) });
  _cameoMem.set(id, norm);
  try{ await idbSet(nbCameoKey(id), norm); }catch(e){}
  const reg=cameoReg(); reg[id]=cameoMetaOf(norm); cameoRegWrite(reg);
  /* cloud sync (opt-in) — upload all angles + provenance row */
  if(norm.sync && typeof window.cloudSyncCameo==="function" && _nbProject && _nbUid){
    try{ await window.cloudSyncCameo(_nbProject, _nbUid, id, norm); }catch(e){}
  } else if(!norm.sync && typeof window.cloudDeleteCameo==="function" && _nbProject){
    /* sync turned off → remove any prior cloud copy */
    try{ await window.cloudDeleteCameo(_nbProject, id); }catch(e){}
  }
  return cameoMetaOf(norm);
}
async function nbClearCameo(id){
  const wasSynced = (cameoReg()[id]||{}).sync;
  _cameoMem.delete(id);
  try{ await idbDel(nbCameoKey(id)); }catch(e){}
  const reg=cameoReg(); delete reg[id]; cameoRegWrite(reg);
  if(wasSynced && typeof window.cloudDeleteCameo==="function" && _nbProject){
    try{ await window.cloudDeleteCameo(_nbProject, id); }catch(e){}
  }
}
/* registry listing for the Cameo Manager: [{id, ...meta}] */
function nbListCameos(){ const reg=cameoReg(); return Object.keys(reg).map(id=>({ id, ...reg[id] })); }
window.nbHasCameo=nbHasCameo; window.nbCameoMeta=nbCameoMeta; window.nbGetCameo=nbGetCameo;
window.nbGetCameoAngles=nbGetCameoAngles; window.nbLoadCameo=nbLoadCameo;
window.nbLoadCameoAngles=nbLoadCameoAngles; window.nbLoadCameoFull=nbLoadCameoFull;
window.nbSetCameo=nbSetCameo; window.nbClearCameo=nbClearCameo; window.nbListCameos=nbListCameos;

/* ===== backend-agnostic commit / clear / revert / details (used by useImageGen) ===== */
/* Per-asset write serialization: commit / revert / delete-version / clear all do
   read-modify-write on the same history + image + meta records. Two of them
   overlapping on one id (e.g. a late generation commit landing during a viewer
   revert) would each work from a stale snapshot and silently lose versions.
   Chaining them per id makes last-writer-wins impossible; different ids stay fully
   concurrent. Failures don't poison the chain. */
const _nbOpChain = {};
function _nbSerial(id, fn){
  const prev = _nbOpChain[id] || Promise.resolve();
  const next = prev.then(fn, fn);
  _nbOpChain[id] = next.then(()=>{}, ()=>{});
  return next;
}
async function nbCommitImageDimensions(src){
  if(!src || typeof Image==="undefined") return null;
  return await new Promise(resolve=>{ const im=new Image();
    im.onload=()=>resolve(im.naturalWidth&&im.naturalHeight ? { w:im.naturalWidth, h:im.naturalHeight } : null);
    im.onerror=()=>resolve(null); im.src=src; });
}
function nbCommit(id, dataUrl, meta, refs, kind, epoch, cancelled){
  return _nbSerial(id, ()=>_nbCommitInner(id, dataUrl, meta, refs, kind, epoch, cancelled));
}
async function _nbCommitInner(id, dataUrl, meta, refs, kind, epoch, cancelled){
  // the scope moved while this was generating — the result belongs to a film that is no
  // longer open, and this id means something different here. Drop it rather than clobber.
  // _stale() is RE-CHECKED after every await below: a film switch during any of those
  // waits would pass an entry check yet persist into the newly selected film's scope.
  const _stale = ()=> (epoch!=null && epoch!==_nbEpoch);
  // optional per-run cancellation guard, supplied by the caller (Stop / Clear): the
  // predicate is live, so a cancel that lands DURING persistence stops the write at
  // the next checkpoint instead of storing a frame the user already discarded.
  // tier:"cancelled" = nothing (or nothing further) persisted for the caller to adopt.
  const _cxl = ()=> (typeof cancelled==="function" && !!cancelled());
  if(_stale()) return { tier:"stale", url:dataUrl };
  if(_cxl())   return { tier:"cancelled", url:dataUrl };
  meta = { ...(meta||{}) };
  if((!meta.pixelW || !meta.pixelH) && dataUrl){
    const dims = await nbCommitImageDimensions(dataUrl);
    if(dims){ meta.pixelW=dims.w; meta.pixelH=dims.h; }
  }
  if(_stale()) return { tier:"stale", url:dataUrl };   // the dimension decode awaited
  if(_cxl())   return { tier:"cancelled", url:dataUrl };
  if(!meta.iso){
    const now=new Date();
    meta.iso=now.toISOString();
    if(!meta.date) meta.date=now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    if(!meta.time) meta.time=now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
  }
  // Approval belongs to one exact generation and must never be inherited by new pixels.
  delete meta.approval;
  meta = (typeof nbWithAssetProvenance==="function") ? nbWithAssetProvenance(id, meta, kind) : (meta||null);
  refs = (typeof nbPreferBestAssetRefs==="function") ? nbPreferBestAssetRefs(refs||[]) : (refs||[]);
  if(_nbBackend==="cloud"){
    if(typeof window.cloudCommit!=="function") return { tier:"error", url:dataUrl };
    // capture scope+uid at the validated moment — never re-resolve them after an await
    const _scope = _scopeFor(id), _uid = _nbUid;
    if(_cxl()) return { tier:"cancelled", url:dataUrl };   // last checkpoint BEFORE the write
    let r;
    try{ r = await window.cloudCommit(_scope, _uid, id, dataUrl, meta, refs, kind, _cxl); }
    catch(e){ return {tier:"error",url:dataUrl,error:(e&&e.message)||"cloud save failed"}; }
    // the write itself landed in the scope captured above (its correct home) — but if
    // the film switched during it, the session caches now belong to the NEW film:
    // leave them untouched and report stale so the caller stays quiet.
    if(_stale()) return { tier:"stale", url:(r&&r.url)||dataUrl };
    if(r&&r.tier==="cancelled") return { tier:"cancelled", url:r.url||dataUrl };
    if(r&&r.tier==="cancellation-error") return r;
    if(r && r.tier==="cloud" && r.url){
      _cloudUrlCache.set(id, r.url); _cloudMetaCache.set(id, meta||null);
      // we hold the bytes we just generated — warm the byte-cache directly so the
      // next session never re-downloads this sheet. This is deliberately detached:
      // persistence has reached its final cancellation decision, so cache warming
      // must not create a late "discarded" interpretation of a successful commit.
      if(r.path) Promise.resolve().then(async()=>{ try{
        const response=await fetch(dataUrl), blob=await response.blob();
        if(epoch==null || epoch===_nbEpoch) await idbSet(nbCloudKey(id), { path:r.path, blob });
      }catch(e){} });
      return r;
    }
    return r&&r.tier==="error" ? r
      : { tier:"error", url:dataUrl, error:(r&&r.error)||"cloud save failed" };
  }
  const prev = localGetImage(id);
  if(prev){
    const hist = await localGetHistory(id);
    const prevRefs = await localGetRefs(id);
    if(_stale()) return { tier:"stale", url:dataUrl };
    if(_cxl())   return { tier:"cancelled", url:dataUrl };
    hist.unshift({ url:prev, meta:localGetMeta(id), refs:prevRefs });
    await localSetHistory(id, hist.slice(0,12));
  }
  if(_stale()) return { tier:"stale", url:dataUrl };
  if(_cxl())   return { tier:"cancelled", url:dataUrl };
  const res = await localSetImage(id, dataUrl);
  await localSetRefs(id, refs||[]);
  localSetMeta(id, meta||null);
  return { tier:(res&&res.tier)||"local", url:dataUrl };
}
function nbClearAsset(id){ return _nbSerial(id, ()=>_nbClearAssetInner(id)); }
async function _nbClearAssetInner(id){
  if(_nbBackend==="cloud"){
    if(typeof window.cloudClear!=="function") throw new Error("cloud clear unavailable");
    const cloudResult=await window.cloudClear(_scopeFor(id), id);
    _cloudUrlCache.delete(id); _cloudMetaCache.delete(id);
    try{ await idbDel(nbCloudKey(id)); }catch(e){}   // drop the cached bytes too
    const old = _objUrls.get(id); if(old){ try{ URL.revokeObjectURL(old.url); }catch(e){} _objUrls.delete(id); }
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:"" } })); }catch(e){}
    return cloudResult;
  }
  await localSetImage(id, "");
  localSetMeta(id, null);
  try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:"" } })); }catch(e){}
}
function nbRevertAsset(id, index){ return _nbSerial(id, ()=>_nbRevertAssetInner(id, index)); }
async function _nbRevertAssetInner(id, index){
  if(_nbBackend==="cloud"){
    if(typeof window.cloudRevert!=="function") return null;
    const r = await window.cloudRevert(_scopeFor(id), _nbUid, id, index);
    if(r){ _cloudUrlCache.set(id, r.url); _cloudMetaCache.set(id, r.meta||null); }
    if(r){ try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:r.url } })); }catch(e){} }
    return r;
  }
  const history = await localGetHistory(id);
  if(index<0 || index>=history.length) return null;
  const chosen = history[index];
  const present = { url: localGetImage(id), meta: localGetMeta(id), refs: await localGetRefs(id) };
  const newHist = history.filter((_,i)=>i!==index);
  if(present.url) newHist.unshift(present);
  await localSetImage(id, chosen.url);
  localSetMeta(id, chosen.meta||null);
  await localSetRefs(id, chosen.refs||[]);
  await localSetHistory(id, newHist.slice(0,12));
  try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:chosen.url } })); }catch(e){}
  return { url:chosen.url, meta:chosen.meta||null };
}
function nbDeleteCurrentAndPromoteAsset(id){ return _nbSerial(id, ()=>_nbDeleteCurrentAndPromoteAssetInner(id)); }
async function _nbDeleteCurrentAndPromoteAssetInner(id){
  if(_nbBackend==="cloud"){
    if(typeof window.cloudDeleteCurrentAndPromote!=="function") return null;
    const r = await window.cloudDeleteCurrentAndPromote(_scopeFor(id), _nbUid, id);
    if(r){ _cloudUrlCache.set(id, r.url); _cloudMetaCache.set(id, r.meta||null); }
    if(r){ try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:r.url } })); }catch(e){} }
    return r;
  }
  const history = await localGetHistory(id);
  if(!history.length) return null;
  const chosen = history[0];
  await localSetImage(id, chosen.url);
  localSetMeta(id, chosen.meta||null);
  await localSetRefs(id, chosen.refs||[]);
  await localSetHistory(id, history.slice(1,13));
  try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, ids:[id], url:chosen.url } })); }catch(e){}
  return { url:chosen.url, meta:chosen.meta||null };
}
async function nbLoadDetailsAsset(id, currentUrl){
  if(_nbBackend==="cloud"){
    if(typeof window.cloudLoadDetails==="function") return await window.cloudLoadDetails(_scopeFor(id), id);
    return { id, url:currentUrl, meta:null, refs:[], history:[] };
  }
  const refs = await localGetRefs(id);
  const history = await localGetHistory(id);
  let url=currentUrl||localGetImage(id);
  if(!url) url=await localLoadImage(id);
  return { id, url:url||"", meta:localGetMeta(id), refs, history };
}
window.nbCommit = nbCommit; window.nbClearAsset = nbClearAsset;
window.nbRevertAsset = nbRevertAsset; window.nbDeleteCurrentAndPromoteAsset = nbDeleteCurrentAndPromoteAsset;
window.nbLoadDetailsAsset = nbLoadDetailsAsset;

/* delete ONE entry from a sheet's version history (local + cloud). */
function nbDeleteHistoryEntry(id, index){ return _nbSerial(id, ()=>_nbDeleteHistoryEntryInner(id, index)); }
async function _nbDeleteHistoryEntryInner(id, index){
  if(_nbBackend==="cloud"){
    if(typeof window.cloudDeleteHistoryEntry!=="function") return false;
    return await window.cloudDeleteHistoryEntry(_scopeFor(id), _nbUid, id, index);
  }
  const hist = await localGetHistory(id);
  if(index<0 || index>=hist.length) return false;
  hist.splice(index,1);
  await localSetHistory(id, hist);
  return true;
}
window.nbDeleteHistoryEntry = nbDeleteHistoryEntry;

/* A valid approval is deliberately generation-scoped; stale inherited metadata is
   treated as unapproved even if its boolean remains true. */
function nbAssetApproval(meta){
  return !!(meta && meta.iso && meta.approval
    && meta.approval.iso===meta.iso && meta.approval.approved===true);
}
function nbSetAssetApproval(id, expectedIso, approved, reviewKey){
  // Capture before queueing: an operation waiting behind a render/history mutation
  // must not silently retarget itself if the user opens another film meanwhile.
  const epoch=_nbEpoch;
  return _nbSerial(id,async()=>{
    if(!id || !expectedIso) return {ok:false,error:"asset version required"};
    if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
    const backend=_nbBackend;
    // Resolve all scope-bearing values exactly once, after validating the epoch.
    const scope=backend==="cloud"?_scopeFor(id):null, uid=_nbUid;
    if(backend==="cloud"){
      if(typeof window.cloudSetAssetApproval!=="function") return {ok:false,error:"cloud approval unavailable"};
      try{
        const result=await window.cloudSetAssetApproval(scope,uid,id,expectedIso,!!approved,reviewKey);
        if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
        if(result&&result.ok){
          _cloudMetaCache.set(id,result.meta);
          try{ window.dispatchEvent(new CustomEvent("nb-approval-changed",{detail:{id}})); }catch(e){}
        }
        return result&&typeof result.ok==="boolean" ? result : {ok:false,error:"approval update failed"};
      }catch(e){
        if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
        return {ok:false,error:(e&&e.message)||"approval update failed"};
      }
    }
    const current=localGetMeta(id);
    if(!localGetImage(id)) return {ok:false,error:"asset not found"};
    if(!current || current.iso!==expectedIso) return {ok:false,error:"asset version changed"};
    const approval={iso:expectedIso,approved:!!approved,at:new Date().toISOString()};
    if(reviewKey!=null) approval.reviewKey=String(reviewKey);
    const meta={...current,approval};
    localSetMeta(id,meta);
    try{ window.dispatchEvent(new CustomEvent("nb-approval-changed",{detail:{id}})); }catch(e){}
    return {ok:true,meta};
  });
}
window.nbAssetApproval=nbAssetApproval;
window.nbSetAssetApproval=nbSetAssetApproval;

/* read the image URL from an <image-slot> by querying its shadow DOM */
function nbGetSlotImage(slotId){
  try{
    const el = document.getElementById(slotId);
    if(!el || !el.shadowRoot) return null;
    const img = el.shadowRoot.querySelector(".frame img");
    const src = img && img.getAttribute("src");
    return (src && src.startsWith("data:image/")) ? src : null;
  }catch(e){ return null; }
}
window.nbGetSlotImage = nbGetSlotImage;

/* split a data URL into {mimeType, data} for the API inlineData field */
function nbDataUrlParts(dataUrl){
  try{
    const m = (dataUrl||"").match(/^data:(image\/[^;]+);base64,(.+)$/);
    return m ? { mimeType:m[1], data:m[2] } : null;
  }catch(e){ return null; }
}
window.nbDataUrlParts = nbDataUrlParts;

/* normalize any image reference (data URL or http(s) signed URL) to inlineData
   {mimeType,data} for the API. Cloud refs are signed URLs and must be fetched. */
async function nbToInlineData(src){
  if(!src) return null;
  if(/^data:image\//.test(src)){ return (typeof nbDataUrlParts==="function") ? nbDataUrlParts(src) : null; }
  try{
    const res = await fetch(src);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(blob); });
    return (typeof nbDataUrlParts==="function") ? nbDataUrlParts(dataUrl) : null;
  }catch(e){ return null; }
}
window.nbToInlineData = nbToInlineData;

/* map our aspect labels to the sizes GPT Image supports (closest match) */
function oaiSize(aspect){
  if(aspect==="9:16") return "1024x1536";          // portrait
  if(aspect==="1:1")  return "1024x1024";           // square
  return "1536x1024";                                // 16:9 / 21:9 → landscape
}
/* any image ref (data URL or signed http URL) -> Blob, for multipart edits */
async function oaiToBlob(src){
  if(!src) return null;
  if(/^data:/.test(src)){
    const p = (typeof nbDataUrlParts==="function") ? nbDataUrlParts(src) : null;
    if(!p) return null;
    const bin = atob(p.data); const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr], { type:p.mimeType });
  }
  try{ const r = await fetch(src); return await r.blob(); }catch(e){ return null; }
}
/* any image ref (data URL or signed http URL) -> data URL string, for JSON transport
   to the proxy (the Edge Function reconstructs Blobs server-side for /images/edits). */
async function oaiToDataUrl(src){
  if(!src) return null;
  if(/^data:/.test(src)) return src;
  const blob = await oaiToBlob(src);
  if(!blob) return null;
  return await new Promise((resolve)=>{
    const fr = new FileReader();
    fr.onload = ()=> resolve(fr.result);
    fr.onerror = ()=> resolve(null);
    fr.readAsDataURL(blob);
  });
}
/* Shrink a REFERENCE image before sending it to the proxy. Big 2K refs make the Edge
   Function slow (504 gateway timeouts) and bloat the request body; a reference only needs
   to convey identity / look / composition, so ~1024px JPEG is ample. The OUTPUT resolution
   is unaffected (set separately by imageSize) — only the inputs shrink. Returns the original
   on any failure (a big ref beats no ref). */
async function downscaleRef(dataUrl, maxDim, quality){
  maxDim = maxDim || 1024; quality = quality || 0.85;
  if(!dataUrl || !/^data:/.test(dataUrl)) return dataUrl;
  try{
    return await new Promise((resolve)=>{
      const img = new Image();
      const keep = ()=> resolve(dataUrl);
      img.onload = ()=>{
        try{
          const w0 = img.naturalWidth||img.width, h0 = img.naturalHeight||img.height;
          if(!w0 || !h0){ keep(); return; }
          const scale = Math.min(1, maxDim/Math.max(w0,h0));
          if(scale>=1){ keep(); return; }                  // already small enough
          const w = Math.round(w0*scale), h = Math.round(h0*scale);
          const cv = document.createElement("canvas"); cv.width=w; cv.height=h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL("image/jpeg", quality);
          // always prefer the dimension-capped output (the point is fewer pixels for the
          // provider to chew on); only fall back to the original if the export failed.
          resolve(out && /^data:image\/jpeg/.test(out) ? out : dataUrl);
        }catch(e){ keep(); }
      };
      img.onerror = keep;
      img.src = dataUrl;
    });
  }catch(e){ return dataUrl; }
}
window.downscaleRef = downscaleRef;

/* GPT Image's landscape/portrait Image API canvases are 3:2 / 2:3 even when
   Cinema Machine requests a cinematic ratio. Crop the returned pixels to the exact chosen
   ratio before committing the asset, so a frame labelled 16:9 really is 16:9.
   This is a crop only (no stretch, no invented pixels). */
async function cropImageToAspect(src, aspect){
  const ratios = { "16:9":16/9, "21:9":21/9, "9:16":9/16, "1:1":1 };
  const target = ratios[aspect];
  if(!src || !target) return src;
  return await new Promise((resolve,reject)=>{
    const img = new Image();
    if(/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = ()=>{
      try{
        const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
        if(!w||!h){ reject(new Error("The generated image has no readable dimensions.")); return; }
        if(Math.abs((w/h)-target)<0.005){ resolve(src); return; }
        let sx=0, sy=0, sw=w, sh=h;
        if(w/h>target){ sw=Math.round(h*target); sx=Math.round((w-sw)/2); }
        else { sh=Math.round(w/target); sy=Math.round((h-sh)/2); }
        const cv=document.createElement("canvas"); cv.width=sw; cv.height=sh;
        cv.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
        const out=cv.toDataURL("image/png");
        if(!out || out==="data:,"){ reject(new Error("The generated frame could not be normalized to "+aspect+".")); return; }
        resolve(out);
      }catch(e){ reject(new Error("The generated frame could not be normalized to "+aspect+": "+((e&&e.message)||e))); }
    };
    img.onerror=()=>reject(new Error("The generated frame could not be read for "+aspect+" normalization."));
    img.src=src;
  });
}

/* Generate through the SERVER-SIDE proxy (Supabase Edge Function). For image
   generation the client sends provider:"fal"; the proxy maps the selected TURN
   model to fal.ai's Nano Banana / GPT Image route. Requires the user to be signed
   in and the function deployed. Resolves to a data URL; mirrors nbGenerate's
   signature and reports grounding via opts.metaOut. */
/* SOFTEN — rewrite phrasings that commonly TRIP a moderation FALSE POSITIVE on
   legitimate film content into neutral, cinematic equivalents. This only rescues
   MISCLASSIFIED benign content ("gap-tooth" → "small natural gap between the front
   teeth") and TONES DOWN injury descriptors to their practical-effects framing (a
   milder image, never a disguised one). It does NOT — and must not — touch anything a
   provider genuinely prohibits: nothing about age/minors, nothing sexual. Those stay
   blocked, by design. Used for a single retry when the provider reports a content block. */
const _SOFTEN_MAP = [
  [/\bgap-?tooth(ed)?\b/gi, "with a small natural gap between the front teeth"],
  [/\bmissing (a )?(front )?teeth\b/gi, "with small gaps in the teeth"],
  [/\bblood(y|ied|-?stained|-?soaked)?\b/gi, "dark-red practical-effects marks"],
  [/\bwound(s|ed)?\b/gi, "healed injury marks"],
  [/\bgor(e|y)\b/gi, "practical special-effects detailing"],
  [/\bmutilat(ed|ion)\b/gi, "damaged (prosthetic effect)"],
  [/\bgraphic violence\b/gi, "cinematic action staging"],
  [/\bcorpse|dead body\b/gi, "still figure (film prop)"],
  [/\bnude|naked\b/gi, "in plain neutral clothing"],
];
function softenImagePrompt(p){
  let s = String(p||""), changed = false;
  for(const [re, sub] of _SOFTEN_MAP){ if(re.test(s)){ s = s.replace(re, sub); changed = true; } }
  return changed ? s : null;
}
window.softenImagePrompt = softenImagePrompt;

async function proxyGenerate(prompt, opts, provider){
  opts = opts || {};
  /* This is the last shared image-provider boundary.  It intentionally repeats
     the caller-side check: edits, simplified retries, and policy fallbacks all
     converge here, so no paid request can skip the identity gate. */
  nbAssertMediaIdentity(opts, "image-provider-start");
  prompt = nbCanonicalMediaPrompt(prompt, opts);
  const model = opts.model || nbGetModel();
  const aspect = opts.aspectRatio || nbGetAspect();
  const imageSize = opts.imageSize || nbGetRes();
  const quality = opts.quality || nbGetOaiQuality();
  // reference images (for image-edit mode) → data URLs the proxy can rebuild
  const refs = [];
  if(opts.referenceImage) refs.push(opts.referenceImage);
  if(opts.extraImages && opts.extraImages.length) refs.push(...opts.extraImages);
  const images = [];
  const referenceMaxDim = Math.max(512, Math.min(1536, Number(opts.referenceMaxDim)||1024));
  // the BASE image (an edit's own frame / the rolling-chain seed) may carry a higher
  // cap than the identity sheets: crushing a 2K frame to 640px before an EDIT visibly
  // softened the result — the model can only re-render what it was shown.
  const baseMaxDim = Math.max(referenceMaxDim, Math.min(1536, Number(opts.baseMaxDim)||0)) || referenceMaxDim;
  const extraMaxDims = Array.isArray(opts.extraImageMaxDims) ? opts.extraImageMaxDims : [];
  for(let i=0;i<refs.length;i++){ const isBase = (i===0 && !!opts.referenceImage);
    const extraIndex = i - (opts.referenceImage ? 1 : 0);
    const perRefMax = !isBase && extraIndex>=0 && Number.isFinite(Number(extraMaxDims[extraIndex]))
      ? Math.max(512,Math.min(1536,Number(extraMaxDims[extraIndex]))) : referenceMaxDim;
    let du = await oaiToDataUrl(refs[i]); if(du) du = await downscaleRef(du, isBase ? baseMaxDim : perRefMax);
    if(du) images.push(du); }

  const sb = (typeof window.sbClient==="function") ? window.sbClient() : null;
  if(!sb || !sb.functions){
    throw new Error(nbProviderLabel(provider)+" runs through your server proxy, which isn't available. Make sure you're signed in and Supabase is configured.");
  }
  const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
  const body = { provider, model, prompt, aspect, quality, imageSize, images,
                 userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy([provider]) : undefined,
                 groundSearch: !!opts.groundSearch, groundImageSearch: !!opts.groundImageSearch,
                 // least-restrictive SUPPORTED moderation for gpt-image (fewer false positives on
                 // legitimate creative content; genuinely prohibited content is still blocked)
                 ...(isGptImageModel(model) ? { moderation: opts.moderation || "low" } : {}) };
  // Only retry true NETWORK-level failures (DNS / "failed to send"): they fail FAST and no
  // server work was done, so a quick retry is safe and cheap. Do NOT retry 5xx/504 \u2014 a 504
  // only comes back after the gateway's full (~150s) timeout, and the Edge Function may STILL
  // be running the expensive generation, so retrying just multiplies the wait and the cost.
  // 504s are surfaced immediately (the real mitigation is the downscaled refs above).
  const statusOf = (err)=> (err && err.context && err.context.status) || (err && err.status) || 0;
  const isNetworkBlip = (err)=> !statusOf(err)
    && /failed to send|name_not_resolved|network|fetch|timeout|load failed/i.test(((err&&err.message)||"")+"");
  let data, error;
  // HARD CLIENT CAP: functions.invoke has no timeout of its own, so a hung provider
  // connection used to spin "Generating…" forever with no error ever surfacing.
  // 3 minutes is beyond any successful generation; after that we abandon the wait
  // and say so. (Wording deliberately avoids isNetworkBlip's trigger words so an
  // abandoned wait is never auto-retried.)
  const _capped = (pr)=> Promise.race([ pr,
    new Promise((_,rej)=> setTimeout(()=>{ const e=new Error("The image server didn't answer within 6\u00bd minutes — the request was abandoned. If this keeps happening, fal.ai may be rate-limited or the image-proxy needs a redeploy."); e.__timedOut=true; rej(e); }, 390000)) ]);
  for(let attempt=0; attempt<2; attempt++){
    error = null;
    /* Reference conversion above and a network retry are both awaits.  Re-check
       immediately before every paid proxy invocation in case canon changed while
       the request was being prepared. */
    nbAssertMediaIdentity(opts, "image-provider-submit");
    try{ ({ data, error } = await _capped(sb.functions.invoke(fnName, { body }))); }
    catch(e){ error = e; }
    if(!error) break;
    if(error.__timedOut) break;
    if(attempt<1 && isNetworkBlip(error)){ await new Promise(r=>setTimeout(r, 600)); continue; }
    break;
  }
  if(error){
    const status = statusOf(error);
    // Supabase represents every non-2xx function response as an invocation error.
    // Preserve the Edge Function's JSON explanation (invalid model, no credits,
    // provider rejection, etc.) instead of showing only the SDK's generic message.
    let relayed = "";
    try{
      const ctx = error.context;
      const j = ctx && await ctx.json();
      relayed = (j && (j.error || j.message || j.msg)) || "";
    }catch(e){}
    if(status===401) throw new Error("Sign in to use server-side image generation \u2014 it runs on your server, not in the browser.");
    const _safe = window.turnSafeError || (x=>x);
    if(status===404) throw new Error(_safe("The image proxy isn't deployed yet. Deploy supabase/functions/image-proxy and set imageProxy:true in supabase-config.js."));
    if(status===504) throw new Error("The image generation exceeded the server time limit. Cinema Machine preserved your selected quality and resolution; try again, or manually choose a faster setting if you prefer.");
    if(status===502 || status===503){
      // the function relays the SPECIFIC upstream reason in its JSON body ("Proxy
      // failed to reach fal: <cause>") — surface it instead of swallowing it behind
      // the generic advice, or every failure looks identical and undebuggable.
      throw new Error("The image server took too long or is temporarily unavailable."
        + (relayed ? " Server said: "+_safe(relayed)
                   : " High-quality GPT Image renders can take several minutes — try again, or drop the quality/resolution a notch for a faster render."));
    }
    if(relayed) throw new Error(_safe("The image server rejected this request"
      +(status?" ("+status+")":"")+": "+relayed));
    throw new Error(_safe("Couldn't reach the image proxy: "+((error && error.message) || "unknown error")+"."));
  }
  if(data && data.error){
    const _raw = String(data.error);
    // CONTENT-FILTER false positive: retry ONCE with benign-softened phrasing (e.g.
    // "gap-tooth" → "small gap between the front teeth"). Only rescues misclassified
    // legitimate content; genuinely prohibited prompts stay blocked and surface cleanly.
    if(isGptImageModel(model) && !opts.__softened && (window.turnIsContentBlock ? window.turnIsContentBlock(_raw) : false)){
      const soft = (typeof softenImagePrompt==="function") ? softenImagePrompt(prompt) : null;
      if(soft && soft!==prompt){
        if(opts.metaOut) opts.metaOut.softened = true;
        return await proxyGenerate(soft, { ...opts, __softened:true }, provider);
      }
    }
    // provider error relayed by the proxy — attributed to the image model that asked
    const _mLbl = (((window.NB_MODELS||[]).find(m=>m.id===model))||{}).label || model || "";
    throw new Error(window.turnAttrError
      ? window.turnAttrError("Image model", _mLbl, _raw)
      : (window.turnSafeError||(x=>x))(_raw));
  }
  if(opts.metaOut && data && typeof data.grounded!=="undefined") opts.metaOut.grounded = !!data.grounded;
  if(data && data.usage && typeof window.dispatchEvent==="function")
    window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:data.usage }));
  // Provider-native landscape/portrait canvases are not always Cinema Machine's selected
  // ratio (GPT Image landscape is 3:2). Normalize BEFORE returning, so callers
  // can only commit a frame whose pixels match its 16:9 / 9:16 / 21:9 label.
  if(data && data.b64) return await cropImageToAspect("data:"+(data.mime||"image/png")+";base64,"+data.b64, aspect);
  if(data && data.url) return await cropImageToAspect(data.url, aspect);
  throw new Error("The proxy returned no image. Try simplifying the prompt.");
}
async function oaiGenerate(prompt, opts){ return proxyGenerate(prompt, { ...(opts||{}), model:((opts&&opts.model)||"gpt-image-2") }, "fal"); }
window.proxyGenerate = proxyGenerate;
window.oaiGenerate = oaiGenerate;

/* call the selected image model; opts={model, aspectRatio}. resolves to a data URL or throws. */
async function nbGenerate(prompt, opts){
  opts = opts || {};
  nbAssertMediaIdentity(opts, "image-submit");
  const model = opts.model || nbGetModel();
  const provider = providerOfModel(model);
  /* dispatch to the server image broker. All current image models go through fal.ai
     first via the Supabase Edge Function; the direct browser Google path is retired
     for production reliability and key safety. */
  if(provider==="fal") return proxyGenerate(prompt, { ...opts, model }, "fal");
  if(provider==="openai") return proxyGenerate(prompt, { ...opts, model }, "openai");
  if(imageProxyOn()) return proxyGenerate(prompt, { ...opts, model }, provider);
  throw new Error("Image generation now runs through fal.ai on the server. Sign in and make sure the image proxy is enabled.");
}
window.nbGenerate = nbGenerate;

/* resize a data URL to a target long-edge and download it */
const NB_RES_PX = { "1K":1024, "2K":2048, "4K":4096 };
async function nbDownload(dataUrl, res, filename){
  const target = NB_RES_PX[res] || 2048;
  const name = filename || ("character-sheet-"+res+".png");
  // last-resort: download/open the original image untouched (used when canvas export
  // isn't possible, e.g. a cross-origin image with no CORS headers -> tainted canvas)
  const direct = ()=>{ try{
    const a = document.createElement("a");
    a.href = dataUrl; a.download = name; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){} };
  await new Promise((resolve)=>{
    let settled = false;
    const done = ()=>{ if(!settled){ settled = true; resolve(); } };
    const fail = ()=>{ direct(); done(); };
    const img = new Image();
    img.crossOrigin = "anonymous";                 // so the canvas isn't tainted when CORS allows
    const guard = setTimeout(fail, 15000);          // never hang the UI
    img.onload = ()=>{
      try{
        const long = Math.max(img.width, img.height) || target;
        const scale = Math.min(1, target/long);     // only downscale, never upscale past source
        const w = Math.max(1, Math.round(img.width*scale)), h = Math.max(1, Math.round(img.height*scale));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        cv.toBlob((blob)=>{
          clearTimeout(guard);
          if(!blob){ fail(); return; }              // tainted canvas -> null blob
          try{
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
            done();
          }catch(e){ fail(); }
        }, "image/png");
      }catch(e){ clearTimeout(guard); fail(); }      // SecurityError from a tainted canvas
    };
    img.onerror = ()=>{ clearTimeout(guard); fail(); };
    img.src = dataUrl;
  });
}
window.nbDownload = nbDownload;

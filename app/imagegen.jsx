/* imagegen.jsx — TURN image runtime.
   All Art Room image models now route through the server proxy first, with fal.ai
   as the image broker. Writing, video, and voice-library calls keep their own
   routing elsewhere. */

const NB_KEY = "turn-nanobanana-key";
const NB_MODEL_KEY = "turn-nb-model";
const NB_AR_KEY = "turn-nb-aspect";
/* Preserve the existing medium preference. GPT Image 2.5 adds model-specific
   tiers; "default" means omit the provider field (currently high), not auto. */
const OAI_Q_KEY = "turn-oai-quality";
const OAI_QUALITIES = ["low","medium","high"];
const OAI_25_QUALITIES = ["default","auto","low","medium","high","xhigh","max"];
function isGptImage25Model(model){ return /^gpt-image-2\.5-(flare|sunburst)$/.test(String(model||"")); }
function nbOaiQualityChoices(model){ return (isGptImage25Model(model||nbGetModel())?OAI_25_QUALITIES:OAI_QUALITIES).slice(); }
function nbOaiQualityLabel(q){
  return ({default:"Default (High)",auto:"Auto",low:"Low",medium:"Medium",high:"High",xhigh:"Extra high (xhigh)",max:"Max"})[q]||String(q||"");
}
function nbGetOaiQuality(model){
  model=model||nbGetModel();
  try{
    const family=isGptImage25Model(model)&&localStorage.getItem(OAI_Q_KEY+":2.5");
    const legacy=localStorage.getItem(OAI_Q_KEY);
    const q=family||legacy||"medium";
    if(!nbOaiQualityChoices(model).includes(q)) return "medium";
    // Seed an existing explicit preference once (the shared key GPT Image 2 used — 2.5 inherits
    // its low / medium / high). Leave unset defaults unset.
    if(isGptImage25Model(model)&&!family&&legacy){
      try{ localStorage.setItem(OAI_Q_KEY+":2.5",q); }catch(e){}
    }
    return q;
  }catch(e){ return "medium"; }
}
function nbSetOaiQuality(q,model){
  model=model||nbGetModel();
  if(!nbOaiQualityChoices(model).includes(q)) throw new Error("That quality is not supported by this image model.");
  try{ localStorage.setItem(OAI_Q_KEY+(isGptImage25Model(model)?":2.5":""),q); }catch(e){}
  _nbAnnounce("nb-settings-changed");
}
/* every model/res/aspect/quality setter announces itself so cost chips (and any other
   listener) update no matter WHERE the change came from — picker, dock, or a
   "Try <model>" fallback after a failed generation. */
function _nbAnnounce(name){ try{ window.dispatchEvent(new CustomEvent(name)); }catch(e){} }
window.nbGetOaiQuality = nbGetOaiQuality; window.nbSetOaiQuality = nbSetOaiQuality;
window.isGptImage25Model=isGptImage25Model;
window.nbOaiQualityChoices=nbOaiQualityChoices; window.nbOaiQualityLabel=nbOaiQualityLabel;
const NB_RES_KEY = "turn-nb-res";

// OPTIONS is non-spending even on older image proxies. Never probe with a new
// image operation: an old server can mistake an unknown operation for a render.
let _nbQualityCaps={url:"",state:"unknown",qualities:{},checkedAt:0,promise:null};
function nbImageQualityCapabilityUrl(){
  const cfg=window.TURN_SUPABASE||{};
  return cfg.url ? String(cfg.url).replace(/\/$/,"")+"/functions/v1/"+encodeURIComponent(cfg.imageProxyFn||"image-proxy") : "";
}
function nbImageQualitySupport(model){
  model=model||nbGetModel();
  if(!isGptImage25Model(model)) return {loading:false,expanded:false,qualities:OAI_QUALITIES.slice(),message:""};
  const caps=_nbQualityCaps.url===nbImageQualityCapabilityUrl()?_nbQualityCaps:{state:"unknown",qualities:{}};
  const remote=caps.qualities[model]||[];
  const qualities=OAI_25_QUALITIES.filter(q=>OAI_QUALITIES.includes(q)||remote.includes(q));
  const expanded=OAI_25_QUALITIES.every(q=>qualities.includes(q));
  const loading=caps.state==="loading";
  const message=expanded?"":loading?"Checking image-server quality support…":
    caps.state==="error"?"Could not check image-server support. Retry to enable the additional quality levels.":
    caps.state==="unknown"?"Check image-server support to enable the additional quality levels.":
    "Default, Auto, Extra high and Max aren't available yet \u2014 they're waiting on a server update. Low, Medium and High remain available.";
  return {loading,expanded,qualities,message};
}
function nbCanUseImageQuality(model,q){
  return nbOaiQualityChoices(model).includes(q)&&nbImageQualitySupport(model).qualities.includes(q);
}
async function nbRefreshImageQualityCapabilities(options){
  const force=!!(options&&options.force),url=nbImageQualityCapabilityUrl();
  if(_nbQualityCaps.url===url){
    if(_nbQualityCaps.promise) return _nbQualityCaps.promise;
    if(!force&&_nbQualityCaps.checkedAt&&Date.now()-_nbQualityCaps.checkedAt<60000) return _nbQualityCaps;
  }
  const state={url,state:"loading",qualities:{},checkedAt:0,promise:null};
  _nbQualityCaps=state;
  state.promise=(async()=>{
    let timer;
    try{
      if(!url) throw new Error("Image server unavailable");
      const controller=new AbortController();
      timer=setTimeout(()=>controller.abort(),6000);
      const response=await fetch(url,{method:"OPTIONS",credentials:"omit",cache:"no-store",signal:controller.signal});
      if(!response.ok) throw new Error("Capability check failed");
      let body=null;
      try{ body=JSON.parse(await response.text()); }catch(e){}
      if(body&&body.imageQualitySchema===1&&body.imageQualities&&typeof body.imageQualities==="object"){
        for(const model of ["gpt-image-2.5-flare","gpt-image-2.5-sunburst"]){
          const values=body.imageQualities[model];
          if(Array.isArray(values)) state.qualities[model]=OAI_25_QUALITIES.filter(q=>values.includes(q));
        }
      }
      state.state="ready";
    }catch(e){
      state.state="error";
    }finally{
      clearTimeout(timer);
      state.checkedAt=Date.now();
    }
    return state;
  })().then(result=>{
    state.promise=null;
    if(_nbQualityCaps===state) _nbAnnounce("nb-quality-capabilities");
    return result;
  });
  _nbAnnounce("nb-quality-capabilities");
  return state.promise;
}
async function nbRequireImageQuality(model,q){
  if(!isGptImageModel(model)) return;
  if(!nbOaiQualityChoices(model).includes(q)) throw new Error("Quality "+String(q)+" is not supported by "+model+".");
  if(OAI_QUALITIES.includes(q)) return;
  await nbRefreshImageQualityCapabilities();
  if(!nbCanUseImageQuality(model,q)){
    const error=new Error(nbImageQualitySupport(model).message+" No image generation was submitted.");
    error.imageQualityUnsupported=true;
    throw error;
  }
}
window.nbImageQualitySupport=nbImageQualitySupport;
window.nbCanUseImageQuality=nbCanUseImageQuality;
window.nbRefreshImageQualityCapabilities=nbRefreshImageQualityCapabilities;
window.nbRequireImageQuality=nbRequireImageQuality;

/* selectable models. provider:"fal" means the browser always calls the Supabase
   proxy; the proxy then maps this UI id to fal.ai's provider route. */
const _imageProxyOn = !!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy);
/* THE ENGINES (2026-10-11, owner — image engines): exactly these four, in this order. Nano Banana 2, Nano Banana
   Pro and GPT Image 2 were removed — a locked likeness rendered the wrong face on them. Seedream 5 Pro renders 1K
   and 2K only (maxRes: a 4K pick renders at 2K and says so) and takes at most 10 reference images (maxRefs); it
   has no quality setting and no grounding. */
const NB_MODELS = [
  { id:"gemini-nano-banana-2.1",      label:"Nano Banana 2.1",    provider:"fal", family:"nano",   falModel:"google/nano-banana-2.1", falEditModel:"google/nano-banana-2.1/edit", note:"fast \u00b7 lowest cost" },
  { id:"gpt-image-2.5-flare",         label:"GPT Image 2.5 Flare", provider:"fal", family:"openai", falModel:"openai/gpt-image-2.5/flare/text-to-image", falEditModel:"openai/gpt-image-2.5/flare/edit", note:"fastest GPT Image 2.5" },
  { id:"gpt-image-2.5-sunburst",      label:"GPT Image 2.5 Sunburst", provider:"fal", family:"openai", falModel:"openai/gpt-image-2.5/sunburst/text-to-image", falEditModel:"openai/gpt-image-2.5/sunburst/edit", note:"maximum precision and fidelity" },
  { id:"seedream-5-pro",              label:"Seedream 5 Pro",     provider:"fal", family:"seedream", falModel:"bytedance/seedream/v5/pro/text-to-image", falEditModel:"bytedance/seedream/v5/pro/edit", maxRes:"2K", maxRefs:10, note:"rich detail \u00b7 strong likeness" },
];
/* RETIRED IMAGE ENGINES: a saved pick, a dock choice, a per-device preference or an agent / batch option that still
   names an old id renders on its successor (the server maps it too: image-proxy billing-pricing.mjs
   canonicalImageModel). Old assets keep their saved meta; where one is DISPLAYED, nbModelLabel shows the engine it
   was really made with. Never offered.
     2026-10-10 (owner): Nano Banana 2 Lite → Nano Banana 2.1.
     2026-10-11 (owner — image engines): Nano Banana 2 and Nano Banana Pro → Nano Banana 2.1; GPT Image 2 →
       GPT Image 2.5 Sunburst (its low / medium / high quality carries over). */
const NB_LEGACY_MODEL_IDS = {
  "gemini-3.1-flash-lite-image":"gemini-nano-banana-2.1",
  "gemini-3.1-flash-image":"gemini-nano-banana-2.1",
  "gemini-3-pro-image":"gemini-nano-banana-2.1",
  "gpt-image-2":"gpt-image-2.5-sunburst",
};
const NB_HISTORICAL_MODEL_LABELS = {
  "gemini-3.1-flash-lite-image":"Nano Banana 2 Lite",
  "gemini-3.1-flash-image":"Nano Banana 2",
  "gemini-3-pro-image":"Nano Banana Pro",
  "gpt-image-2":"GPT Image 2",
};
function nbCanonicalModelId(id){
  return (typeof id==="string" && Object.prototype.hasOwnProperty.call(NB_LEGACY_MODEL_IDS, id)) ? NB_LEGACY_MODEL_IDS[id] : id;
}
/* the name an image's engine is SHOWN by (an old asset's id included) — display only */
function nbModelLabel(id){
  const m = (window.NB_MODELS||NB_MODELS).find(x=>x.id===id);
  if(m) return m.label;
  return (typeof id==="string" && Object.prototype.hasOwnProperty.call(NB_HISTORICAL_MODEL_LABELS, id)) ? NB_HISTORICAL_MODEL_LABELS[id] : (id || "");
}
/* web grounding: Nano Banana 2.1 is the only engine that searches the web (2026-10-11; image-search grounding was
   Nano Banana 2's and went with it) — priced in billing-pricing.mjs IMAGE_WEB_SEARCH_USD */
const NB_GROUND_MODELS = ["gemini-nano-banana-2.1"];
function nbModelGrounds(model){ return NB_GROUND_MODELS.indexOf(nbCanonicalModelId(model))>=0; }
/* the highest resolution an engine renders ("4K" unless its entry says less — Seedream 5 Pro: "2K") and the most
   reference images it uses (null = no engine-specific cap; Seedream 5 Pro: 10) */
const NB_RES_RANK = { "1K":0, "2K":1, "4K":2 };
function nbModelMaxRes(model){ const m = (window.NB_MODELS||NB_MODELS).find(x=>x.id===nbCanonicalModelId(model)); return (m && m.maxRes) || "4K"; }
function nbModelRes(model, res){
  const max = nbModelMaxRes(model);
  return (NB_RES_RANK[res]!=null && NB_RES_RANK[res] > NB_RES_RANK[max]) ? max : res;
}
function nbModelMaxRefs(model){ const m = (window.NB_MODELS||NB_MODELS).find(x=>x.id===nbCanonicalModelId(model)); return (m && Number(m.maxRefs)>0) ? Number(m.maxRefs) : null; }
function isSeedreamModel(model){ return nbCanonicalModelId(model)==="seedream-5-pro"; }
window.nbModelMaxRes = nbModelMaxRes; window.nbModelRes = nbModelRes; window.nbModelMaxRefs = nbModelMaxRefs; window.isSeedreamModel = isSeedreamModel;
window.nbCanonicalModelId = nbCanonicalModelId; window.nbModelLabel = nbModelLabel; window.nbModelGrounds = nbModelGrounds;
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
  // Preserve a GPT Image pick saved under the dated preview id (gpt-image-2-YYYY-MM-DD): it is GPT Image 2, whose
  // successor is GPT Image 2.5 Sunburst — not a silent fall back to the first engine
  if(/^gpt-image-2-\d{4}-\d{2}-\d{2}$/.test(s||"")) s="gpt-image-2";
  // a retired engine's saved pick (Nano Banana 2 Lite, Nano Banana 2, Nano Banana Pro, GPT Image 2) moves to its
  // successor, once
  if(s && nbCanonicalModelId(s)!==s){ s=nbCanonicalModelId(s); try{ localStorage.setItem(NB_MODEL_KEY,s); }catch(e){} }
  if(s && NB_MODELS.find(m=>m.id===s)) return s;
  if(s){ try{ localStorage.setItem(NB_MODEL_KEY, NB_MODELS[0].id); }catch(e){} }
  return NB_MODELS[0].id;
}catch(e){ return NB_MODELS[0].id; } }
function nbSetModel(m){ m=nbCanonicalModelId(m); try{ localStorage.setItem(NB_MODEL_KEY,m); }catch(e){} _nbAnnounce("nb-model-changed"); }
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
window.oaiGetKey = oaiGetKey; window.oaiSetKey = oaiSetKey; 

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
  // fallback copy of app/pricing.jsx (fal prices, 2026-10-11 — the server's table)
  "gemini-nano-banana-2.1":      { "1K":0.05, "2K":0.07, "4K":0.15 },
  "gpt-image-2.5-flare":         { default:0.05268, auto:0.21072, low:0.00588, medium:0.01317, high:0.05268, xhigh:0.09366, max:0.21072 },
  "gpt-image-2.5-sunburst":      { default:0.05268, auto:0.21072, low:0.00588, medium:0.01317, high:0.05268, xhigh:0.09366, max:0.21072 },
  "seedream-5-pro":              { standard:0.0675, large:0.135, extraRef:0.0045 },
};
/* Seedream 5 Pro's price without app/pricing.jsx (the same formula as turnSeedreamProviderUsd / the server's
   seedreamCostUsd): the area tier of the exact size sent, plus each reference after the first (at most 10) */
function _nbSeedreamUsd(t, aspect, res, refs){
  if(typeof window.turnSeedreamProviderUsd==="function") return window.turnSeedreamProviderUsd(aspect, res, refs);
  const ratios = { "16:9":16/9, "9:16":9/16, "21:9":21/9, "1:1":1, "3:4":3/4, "4:3":4/3 };
  const r = ratios[aspect] || ratios["16:9"], big = res!=="1K", area = big ? 2048*2048 : 1024*1024;
  const snap = (v)=> (big ? Math.floor(v/16) : Math.ceil(v/16)) * 16;
  const px = snap(Math.sqrt(area*r)) * snap(Math.sqrt(area/r));
  const n = Math.min(10, Math.max(0, Math.floor(Number(refs)||0)));
  return Number(px <= 1536*1536 ? t.standard : t.large) + Math.max(0, n-1) * (Number(t.extraRef)||0);
}
/* DRAFT IMAGES (owner decision 2026-09-30): a trial / no-plan account may generate draft
   images only — Nano Banana 2.1 at 1K (app/plans.jsx turnPlanImageChoice). Every
   request and every cost chip goes through this, so the price shown is the engine that
   will really run. Paid plans, admin and an unloaded ledger pass through unchanged. */
/* … and then the ENGINE's own ceiling (2026-10-11): Seedream 5 Pro renders at most 2K, so a 4K pick is 2K there —
   modelLimited says so (the chip and the dock name it), and the server renders a 4K Seedream request at 2K too */
function nbPlanImageChoice(model, res){
  let c;
  if(typeof window.turnPlanImageChoice!=="function") c = { model, res, limited:false };
  else { try{ c = window.turnPlanImageChoice(model, res) || { model, res, limited:false }; }
         catch(e){ c = { model, res, limited:false }; } }
  const capped = nbModelRes(c.model, c.res);
  return capped!==c.res ? { ...c, res:capped, modelLimited:true } : c;
}
window.nbPlanImageChoice = nbPlanImageChoice;
function nbImageCredits(opts){
  opts = opts||{};
  const choice = nbPlanImageChoice(nbCanonicalModelId(opts.model || nbGetModel()), opts.res || nbGetRes());
  const model = choice.model;
  const t = NB_IMG_USD[model]; if(!t) return null;
  let usd;
  if(isGptImageModel(model)){
    const q = opts.quality == null ? nbGetOaiQuality(model) : opts.quality;
    if(!nbOaiQualityChoices(model).includes(q)) return null;
    const pricedQuality=q==="default"?"high":q==="auto"?"max":q;
    usd = t[pricedQuality];
    if(usd==null) return null;
    // GPT Image cost follows the output size, as the server prices it (billing-pricing.mjs)
    if(typeof window.turnGptImageSizeFactor==="function")
      usd = usd * window.turnGptImageSizeFactor(model, opts.aspect || opts.aspectRatio || nbGetAspect(), choice.res || nbGetRes());
  } else if(isSeedreamModel(model)){
    // Seedream 5 Pro (2026-10-11): by the output's pixel area, plus $0.0045 for each reference after the first
    usd = _nbSeedreamUsd(t, opts.aspect || opts.aspectRatio || nbGetAspect(), choice.res || nbGetRes(), opts.refs);
    if(!(usd>0)) return null;
  } else {
    const r = choice.res || nbGetRes();
    usd = (t[r]!=null) ? t[r] : t["2K"];
  }
  /* WHAT THE SERVER ADDS (2026-10-09, owner — Art Room review; billing-pricing.mjs): web grounding ($0.015 an image,
     sent only on Nano Banana 2.1 — nbModelGrounds) and, on GPT Image, each reference image ($0.012) — the chips
     left both out (Seedream's reference fee is in its own price above) */
  const ground = opts.ground!=null ? !!opts.ground : (nbModelGrounds(model) && nbGetGroundSearch());
  if(ground && nbModelGrounds(model)) usd += 0.015;
  if(isGptImageModel(model) && Number(opts.refs)>0) usd += 0.012 * Number(opts.refs);
  // ×CREDIT_SCALE so image costs read in the same generous denomination as plan
  // allowances. Anchor (Option A, 2026-09-30): 1 visible credit = $0.01 of provider cost
  // — the same $0.10 base anchor as app/pricing.jsx and the image-proxy server.
  return (typeof window.turnCreditsFromProviderUsd==="function")
    ? window.turnCreditsFromProviderUsd(usd)
    : (usd / 0.10) * (Number(window.CREDIT_SCALE)||1);
}
/* the server charges each image in WHOLE credits (at least 1), so a batch costs
   count x the rounded per-image price — never the rounded total of fractions */
/* Seedream's per-reference fee ($0.0045 after the first) in credits at the live unit, for a tooltip ("0.5") */
function _nbSeedreamRefCreditText(){
  const t = NB_IMG_USD["seedream-5-pro"] || {};
  const usd = Number(t.extraRef) || 0.0045;
  const cr = (typeof window.turnCreditsFromProviderUsd==="function") ? window.turnCreditsFromProviderUsd(usd) : usd/0.01;
  return String(Math.round(cr*10)/10);
}
function nbImageCostText(count, opts){
  const per = nbImageCredits(opts);
  if(per==null) return "";
  const each = Math.max(1, Math.ceil(per - 1e-9));   // the server's rounding (billing-pricing.mjs creditsFromUsd)
  return String(each * Math.max(1, Number(count)||1));
}
/* a batch whose images send different numbers of reference images (likeness sheets; 2026-10-14 the location plates):
   the sum of each image's own rounded price, as the server charges them — "" when any one can't be priced */
function nbBatchCostText(refsList){
  let total = 0;
  for(const r of (refsList||[])){ const t = Number(nbImageCostText(1, { refs:Number(r)||0 })); if(!(t>0)) return ""; total += t; }
  return total ? String(total) : "";
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
    // a new price table or credit unit (app/pricing.jsx: admin overrides, turn_credit_regime) re-prices it too
    window.addEventListener("turn-pricing-changed", h);
    return ()=>{ window.removeEventListener("nb-model-changed", h); window.removeEventListener("nb-settings-changed", h); window.removeEventListener("turn-pricing-changed", h); };
  },[]);
  const txt = nbImageCostText(count, opts);
  if(!txt) return null;
  // the engine and size the server will really use (a trial's draft engine, a Writer's 2K) — 2026-10-09
  const picked = nbCanonicalModelId((opts&&opts.model) || nbGetModel());
  const choice = nbPlanImageChoice(picked, (opts&&opts.res)||nbGetRes());
  const model = choice.model || picked;
  const m = (window.NB_MODELS||NB_MODELS).find(x=>x.id===model);
  const detail = isGptImageModel(model)
    ? nbOaiQualityLabel(opts&&opts.quality!=null?opts.quality:nbGetOaiQuality(model))+" quality"
    : (choice.res || (opts&&opts.res) || nbGetRes()) + (choice.limited ? " (your plan's limit)"
      : choice.modelLimited ? " ("+(((m&&m.label)||model))+" renders up to "+nbModelMaxRes(model)+")" : "");
  const n = Math.max(1, Number(count)||1);
  return window.React.createElement("span",{className:"nb-cost",
    title:"≈ "+txt+" generation credit"+(txt==="1"?"":"s")+" — "+((m&&m.label)||model)+" at "+detail
      +(n>1 ? " × "+n+" images" : " per image")
      +(isGptImage25Model(model)?" (baseline estimate; prompt/reference tokens and size affect provider cost; Auto uses the Max estimate)":"")
      +(nbModelGrounds(model) && nbGetGroundSearch() ? " · includes web grounding" : "")
      +(isGptImageModel(model) && !(opts && opts.refs) ? " · each reference image the render attaches adds about 1 credit" : "")
      +(isSeedreamModel(model) && !(opts && opts.refs) ? " · each reference image after the first adds a little (about "+_nbSeedreamRefCreditText()+" credit; at most 10 are used)" : "")},
    txt);
}
function nbCostChip(count, opts){
  if(!window.React) return null;
  return window.React.createElement(NbCostChipInner, { count, opts });
}
window.nbImageCredits = nbImageCredits; window.nbImageCostText = nbImageCostText; window.nbCostChip = nbCostChip; window.nbBatchCostText = nbBatchCostText;

/* grounding with web search — Nano Banana 2.1 only (nbModelGrounds) */
const NB_GROUND_KEY = "turn-nb-ground";
function nbGetGroundSearch(){ try{ return localStorage.getItem(NB_GROUND_KEY)==="1"; }catch(e){ return false; } }
/* ONE ENGINE IN EVERY WINDOW (2026-10-09, owner — Art Room review): a pick made in another window of this browser
   changes what this one renders and charges (the settings are shared), but its dock and price chips kept showing
   the old engine — they re-read now */
try{ window.addEventListener("storage", (e)=>{
  const k = String((e && e.key) || "");
  if(k===NB_MODEL_KEY){ try{ window.dispatchEvent(new CustomEvent("nb-model-changed")); }catch(_e){} }
  if(k===NB_MODEL_KEY || k===NB_AR_KEY || k===NB_RES_KEY || k===NB_GROUND_KEY || k.indexOf(OAI_Q_KEY)===0){
    try{ window.dispatchEvent(new CustomEvent("nb-settings-changed")); }catch(_e){} }
}); }catch(e){}
function nbSetGroundSearch(v){ try{ v ? localStorage.setItem(NB_GROUND_KEY,"1") : localStorage.removeItem(NB_GROUND_KEY); }catch(e){} }
window.nbGetGroundSearch = nbGetGroundSearch; window.nbSetGroundSearch = nbSetGroundSearch;

/* simplified fallback prompt — fewer words, less detail, less likely to hit content filters */
function buildSimpleCharPrompt(c){
  // (2026-10-12, Character fidelity) the body plus its distinguishing features (artroom.jsx charBodyWithFeatures)
  const body = ((typeof window.charBodyWithFeatures==="function") ? window.charBodyWithFeatures(c) : ((c.coreBody||c.look)||"")).replace(/\.$/,"").trim();
  const wardrobe = ((c.wardrobeMask||c.wardrobe)||"").replace(/\.$/,"").trim();
  // the retry still speaks the character's PICKED render style (first clause of their
  // style block) — a content-filter fallback must not go photoreal on a stylized film
  const styleLine = (typeof window.charRenderBlock==="function")
    ? String((window.charRenderBlock(c)||{}).rendering||"").split(/[;,]/)[0].trim() : "";
  const parts = [
    "Character reference \u2014 "+(c.name||"character"),
    body||"",
    wardrobe ? ("wearing "+wardrobe) : "",
    "3-panel casting reference sheet: close-up face portrait, full-body front view without the head, full-body back view",
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

/* THE PROMPT BUDGET PER ENGINE (2026-10-14, owner — "go ahead with all of it"): the longest prompt an engine is sent
   (pricing.jsx TURN_IMAGE_PROMPT_LIMITS — the same table as the server's billing-pricing.mjs IMAGE_PROMPT_LIMITS,
   which refuses a longer prompt with prompt_too_long before any hold). GPT Image 2.5 31,500 (fal stops at 32,000),
   Seedream 5 Pro 30,000, Nano Banana 2.1 40,000. */
function nbPromptMaxChars(model){
  const id = nbCanonicalModelId(model || nbGetModel());
  return typeof window.turnImagePromptMaxChars==="function" ? window.turnImagePromptMaxChars(id) : 30000;
}
/* FIT A FINISHED PROMPT TO ITS ENGINE — the last step before an image request (proxyGenerate). The builders already
   fit themselves (locations.jsx locationFitPromptSpec, shots.jsx buildShotPrompt); this repeats the same order on the
   finished text and never refuses one for length (nobody is ever asked to shorten a prompt):
     0. the TAIL is set aside and never cut: from the first reference list (" REFERENCE IMAGES are attached: …" —
        kept exactly, as locationCanonicalSpecPrompt reads it — " REFERENCE IMAGES (binding): …", a likeness map),
        the canonical character identity or an edit's attached-reference order, to the end;
     1. a JSON spec is written without indentation, and a location spec runs locationFitPromptSpec's steps (its
        per-panel camera lines and binding fixed landmarks stay);
     2. an AVOID list says each term once;
     3. a shot's FULL SCENE CONTEXT loses the scene's text (its TARGET BEAT OPENING stays);
     4. last resort: the middle of what is left before the tail is cut ("…"), keeping its first 60% (the task, the
        image map, the style and the camera lines lead every prompt) and its end.
   → {prompt, steps, before, after, limit}; steps is empty when nothing had to go. */
function nbFitImagePrompt(prompt, max){
  const before = String(prompt||""), limit = Math.max(2000, Math.floor(Number(max)||0) || 30000);
  const out = { prompt:before, steps:[], before:before.length, after:before.length, limit };
  if(before.length<=limit) return out;
  let cut = before.length;
  const ref = before.search(/\sREFERENCE IMAGES\b/);
  if(ref>=0) cut = ref;
  ["\n\nCANONICAL CHARACTER IDENTITY", "\n\nATTACHED REFERENCE ORDER"].forEach(m=>{ const i = before.indexOf(m); if(i>=0 && i<cut) cut = i; });
  let body = before.slice(0,cut), tail = before.slice(cut);
  const room = ()=> limit - tail.length;
  // 1. a JSON spec, compact; a location spec in its own trimming order
  const jStart = body.indexOf("\n{"), jEnd = body.lastIndexOf("}");
  if(jStart>=0 && jEnd>jStart){
    try{
      let spec = JSON.parse(body.slice(jStart+1, jEnd+1));
      const head = body.slice(0, jStart+1), rest = body.slice(jEnd+1);
      let js = JSON.stringify(spec);
      if(js.length < jEnd-jStart) out.steps.push("compact JSON");
      if(head.length+js.length+rest.length > room() && spec && (spec.location || spec.coverage) && typeof window.locationFitPromptSpec==="function"){
        const f = window.locationFitPromptSpec(spec, room()-head.length-rest.length);
        spec = f.spec; js = JSON.stringify(spec); (f.steps||[]).forEach(s=>out.steps.push(s));
      }
      body = head+js+rest;
    }catch(e){}
  }
  // 2. one AVOID list, each term once
  if(body.length > room()){
    const at = body.lastIndexOf("AVOID: ");
    if(at>=0){
      const m = body.slice(at+7).match(/^([^\n]*?)\.(\s*)$/);
      if(m){
        const seen = new Set(), terms = m[1].split(/\s*,\s*/).filter(t=>{ const k = t.trim().toLowerCase(); if(!k || seen.has(k)) return false; seen.add(k); return true; });
        const next = body.slice(0,at+7)+terms.join(", ")+"."+m[2];
        if(next.length<body.length){ body = next; out.steps.push("AVOID list once"); }
      }
    }
  }
  // 3. a shot's full-scene text (shot-scene-context.js contextPrompt) — the target beat stays
  if(body.length > room()){
    const m = body.match(/(FULL SCENE CONTEXT \(background only[^\n]*\n(?:SCREENPLAY SOURCE REVISION:[^\n]*\n)?)([\s\S]*?)(\n\nTARGET BEAT OPENING)/);
    if(m && m[2].length>160){
      body = body.replace(m[0], m[1]+"(the scene's own text is left out here to fit this engine's prompt limit; the TARGET BEAT OPENING below is the authority)"+m[3]);
      out.steps.push("full-scene text left out");
    }
  }
  // 4. last resort: cut the middle of the body, never the tail
  if(body.length > room()){
    const keep = Math.max(0, room()-3), headN = Math.floor(keep*0.6);
    const h = body.slice(0, headN).replace(/\s+\S*$/,"");
    const e = body.slice(body.length-Math.max(0, keep-headN)).replace(/^\S*\s+/,"");
    body = keep>0 ? h+" … "+e : "";
    out.steps.push("middle cut");
    if(body.length+tail.length > limit){   // the tail alone is longer than the engine takes (never seen) — still fit
      const k = Math.max(0, limit-body.length-3);
      tail = tail.slice(0, Math.floor(k*0.6))+" … "+tail.slice(tail.length-(k-Math.floor(k*0.6)));
      out.steps.push("tail middle cut");
    }
  }
  out.prompt = (body+tail).slice(0, limit);
  out.after = out.prompt.length;
  return out;
}
/* a refusal for the prompt's LENGTH (the proxy's prompt_too_long, or a provider's own "at most N characters") */
function nbIsPromptLengthError(e){
  if(e && typeof e==="object" && (e.promptTooLong || e.code==="prompt_too_long")) return true;
  const s = String((e && e.message) || e || "");
  // a length word only counts beside the word "prompt" (an image's own "maximum length" is not a prompt refusal)
  return /prompt_too_long/i.test(s)
    || (/\bprompt\b/i.test(s) && /too long|longer than|at most [\d,]+ characters|string_too_long|max(?:imum)? (?:prompt )?length/i.test(s));
}
window.nbPromptMaxChars = nbPromptMaxChars;
window.nbFitImagePrompt = nbFitImagePrompt;
window.nbIsPromptLengthError = nbIsPromptLengthError;

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
function nbUseCloud(projectId, uid){
  const changed=_nbBackend!=="cloud"||projectId!==_nbProject||uid!==_nbUid;
  if(projectId!==_nbProject) _nbEpoch++;
  _nbBackend="cloud"; _nbProject=projectId; _nbUid=uid;
  /* Connection recovery may re-apply the SAME project scope.  Its already verified
     URLs include assets generated moments earlier; clearing them here made every
     mounted consumer wait for another whole-project prefetch and briefly (or, on a
     slow connection, indefinitely) misreport those assets as missing. */
  if(changed){
    _cloudUrlCache.clear(); _cloudMetaCache.clear();
    if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll();
  }
  // (2026-10-10, owner — Likeness review) the likenesses follow the film and the account
  if(changed) _cameoScopeMoved();
}
function nbUseLocal(){ if(_nbProject!==null) _nbEpoch++; _nbBackend="local"; _nbProject=null; _nbUid=null; _nbShared=null; _nbSharedIds=null; _cloudUrlCache.clear(); _cloudMetaCache.clear(); if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll(); _cameoScopeMoved(); }

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
  const nextScope=scopeId||null;
  const nextIds=(scopeId&&ids&&ids.length)?ids.slice():null;
  const sameIds=JSON.stringify(_nbSharedIds||[])===JSON.stringify(nextIds||[]);
  if(_nbShared===nextScope&&sameIds)return;
  _nbShared = nextScope;
  _nbSharedIds = nextIds;
  _cloudUrlCache.clear(); _cloudMetaCache.clear();
  if(typeof nbResetPrefetchAll==="function") nbResetPrefetchAll();
  _cameoScopeMoved();   // (2026-10-10, Likeness review) a Show character's likeness lives in the Show's scope
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
async function cloudLatestBytesForScope(id,scope){
  try{
    const rec=await idbGet(nbCloudKey(id));
    // turnStoragePath is {account}/{project}/… (legacy "{uid}/{projectId}/…" or readable
    // "{name}--{uid}/{name}--{projectId}/…", app/storage-keys.js); validate the
    // project/show scope by its id before using an entity-id cache because entity ids
    // repeat across films. Cached legacy records keep matching.
    const keys=window.TurnStorageKeys, recPath=String(rec&&rec.path||"");
    const recScope=keys&&typeof keys.projectId==="function"?keys.projectId(recPath)
      :(recPath.split("/")[1]||null);   // parser missing: the pre-2026-09-27 legacy check
    if(rec&&rec.blob&&recScope&&recScope===String(scope||""))return _setObjUrl(id,rec.blob,rec.path);
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
    /* IndexedDB is a performance cache, never an availability gate. A blocked or
       slow transaction must not hide the already-signed cloud URL (and make Stage
       call a generated continuity sheet missing/loading forever). */
    const cached = await Promise.race([
      cloudBytesFromCache(id,r.path).catch(()=>""),
      new Promise(resolve=>setTimeout(()=>resolve(""),300))
    ]);
    if(cached){ _cloudUrlCache.set(id, cached); _cloudMetaCache.set(id, r.meta||null); return cached; }
    cloudCacheBytes(id, r.path, r.url);
  }
  _cloudUrlCache.set(id, r.url); _cloudMetaCache.set(id, r.meta||null);
  return r.url;
}

const _nbCloudLoadPending=new Map();
async function nbCloudLoadRecord(scope,id,projectId){
  const one=async target=>{
    if(typeof window.cloudAssetLoadMany==="function"){
      const map=await window.cloudAssetLoadMany(target,[id],true);
      return map&&map[id]||null;
    }
    return typeof window.cloudAssetLoad==="function"?await window.cloudAssetLoad(target,id):null;
  };
  let r=await one(scope);
  if((!r||!r.path)&&scope!==projectId)r=await one(projectId);
  return r;
}
/* A signed storage link carries its expiry in its token; one that has run out (or will within a minute) is
   refreshed before it's used as a render reference (2026-11-01: an expired link made a render drop its set image). */
function nbSignedUrlStale(u){
  const m=String(u||"").match(/^https?:\/\/[^?]+\/object\/sign\/[^?]*\?(?:[^#]*&)?token=([^&#]+)/);
  if(!m) return false;
  try{
    const part=m[1].split(".")[1]||"";
    const claims=JSON.parse(atob(part.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((part.length+3)%4)));
    return !!(claims&&claims.exp)&&claims.exp*1000<Date.now()+60000;
  }catch(e){ return false; }
}
window.nbSignedUrlStale=nbSignedUrlStale;
async function nbLoadImage(id){
  if(_nbBackend==="cloud"){
    const cached=_cloudUrlCache.get(id);
    if(cached && nbSignedUrlStale(cached)) return nbRefreshImage(id, cached);
    if(cached) return cached;
    const projectAtStart=_nbProject, scopeAtStart=_scopeFor(id);
    const key=[projectAtStart,scopeAtStart,id].join("|");
    if(_nbCloudLoadPending.has(key))return _nbCloudLoadPending.get(key);
    const load=(async()=>{
      // The bytes written by the last successful cloud commit are a safe offline
      // fallback once their storage path proves they belong to this exact scope.
      // This lets a freshly generated sheet survive a slow auth/signing reconnect.
      const local=await Promise.race([
        cloudLatestBytesForScope(id,scopeAtStart),
        new Promise(resolve=>setTimeout(()=>resolve(""),300))
      ]);
      if(local){_cloudUrlCache.set(id,local);return local;}
      /* Prefer the batched prefetch, but never make a card or Stage package wait
         forever behind it.  A delayed auth refresh, cleanup sweep or signing batch
         must not strand an individually requested, already-generated sheet in a
         permanent Loading state. */
      if(_prefetchAllPromise&&_prefetchAllProj===projectAtStart){
        try{ await Promise.race([
          Promise.resolve(_prefetchAllPromise).catch(()=>{}),
          new Promise(resolve=>setTimeout(resolve,1200))
        ]); }catch(e){}
        if(_cloudUrlCache.get(id))return _cloudUrlCache.get(id);
      }
      if(typeof window.cloudAssetLoadMany!=="function"&&typeof window.cloudAssetLoad!=="function")return "";
      let timedOut=false;
      let r;
      try{
        r=await Promise.race([
          nbCloudLoadRecord(scopeAtStart,id,projectAtStart),
          new Promise(resolve=>setTimeout(()=>{timedOut=true;resolve(null);},12000))
        ]);
      }catch(e){r=null;}
      if(timedOut)return "";
      // A project/show switch while the request awaited must not hydrate the new
      // scope's cache with the old film's identically named entity.
      if(projectAtStart!==_nbProject||scopeAtStart!==_scopeFor(id))return "";
      return await cloudHydrate(id,r);
    })();
    _nbCloudLoadPending.set(key,load);
    const done=()=>{if(_nbCloudLoadPending.get(key)===load)_nbCloudLoadPending.delete(key);};
    load.then(done,done);
    return load;
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

/* Pre-warm EVERY asset URL in the current project in one batched round-trip (memoized per
   project), so ANY Art Room tab paints without a per-card DB + signed-URL call. URLs only —
   bytes are loaded on render (or via nbPreloadFor for the active tab). */
let _prefetchAllProj = null, _prefetchAllPromise = null;
function nbResetPrefetchAll(){ _prefetchAllProj = null; _prefetchAllPromise = null; }
/* A FAILED CHECK IS SAID (2026-10-09, owner — Breakdown review): the promise resolves { ok:true } or { ok:false } (never
   rejects — every caller fires and forgets it, or chains .then); a failed or timed-out query is FORGOTTEN, so the next
   call (reopening a tab) checks again; and the query has a time limit, so "Checking…" can't hang */
const NB_PREFETCH_ALL_MS = 20000;
async function nbPrefetchAll(){
  if(_nbBackend!=="cloud") return { ok:true };
  if(_prefetchAllPromise && _prefetchAllProj===_nbProject) return _prefetchAllPromise;
  _prefetchAllProj = _nbProject;
  const proj = _nbProject, shared = _nbShared;
  const mine = (async()=>{
    if(typeof window.cloudAssetLoadAll!=="function") return { ok:true };
    let map = {};
    try{
      // episode scope + (for series) the show's shared bible scope, in one pass.
      // The SHOW's entries win on collision — matching _scopeFor's read routing
      // (a bible sheet regenerated post-conversion supersedes the episode copy).
      // { strict:true }: a failed query THROWS instead of reading as "no images" (cloudAssetLoadAll)
      let timer = null;
      const timeout = new Promise((_, rej)=>{ timer = setTimeout(()=>rej(new Error("asset check timed out")), NB_PREFETCH_ALL_MS); });
      const batches = await Promise.race([Promise.all([
        window.cloudAssetLoadAll(proj, { strict:true }),
        shared ? window.cloudAssetLoadAll(shared, { strict:true }) : {},
      ]), timeout]).finally(()=>clearTimeout(timer));
      map = Object.assign({}, batches[0]||{}, batches[1]||{});
    }catch(e){
      if(_prefetchAllPromise===mine) nbResetPrefetchAll();   // the next call checks again
      return { ok:false, error:(e && e.message) || "asset check failed" };
    }
    // a film switched mid-check: its urls aren't this film's
    if(proj!==_nbProject) return { ok:false, error:"film changed" };
    const got = [];
    for(const id in map){ const u = await cloudHydrate(id, map[id]); if(u) got.push(id); }
    if(got.length) window.dispatchEvent(new CustomEvent("nb-prefetched",{ detail:{ ids:got } }));
    return { ok:true };
  })();
  _prefetchAllPromise = mine;
  return mine;
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
async function nbGetHistory(id){
  if(_nbBackend==="cloud"){ const d = (typeof window.cloudLoadDetails==="function") ? await window.cloudLoadDetails(_scopeFor(id), id) : null; return d ? d.history : []; }
  return localGetHistory(id);
}
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
   LIKENESS (internal name "cameo") — a real face locked to one character.
   (2026-10-10, owner — Likeness review)

   A likeness belongs to ONE FILM's character — in a Show, to the Show's bible scope
   (_scopeFor, the scope that character's sheets use, so every Episode finds it) — and to
   the signed-in ACCOUNT ("local" when signed out). The photos stay on this device
   (IndexedDB) unless the person syncs them; a synced likeness is one turn_cameos row per
   person per character per film plus private photos, read only by the person who captured
   it, the film's owner and the film's live Art directors (supabase/team-relaunch.sql §7d).
   Every captured angle rides as a face reference on every generation of that character.

   This device:
     IndexedDB     "turn-cameo-v2|<account>|<scope>|<charId>"  the full record (photos as data URLs)
     localStorage  "turn-cameo-registry-v2:<account>"         { "<scope>|<charId>": meta }
   A teammate's synced likeness is held in MEMORY only — never written to this device.
   OLD unscoped records (before this pass: "turn-cameo-<charId>" + "turn-cameo-registry") are
   kept untouched and never used automatically: the Likenesses window lists them under
   "Earlier likenesses (not tied to a film)" (nbListEarlierCameos / nbAdoptEarlierCameo /
   nbDeleteEarlierCameo). Stored data is never migrated.

   Record: { v:2, charId, scope, acct, charName,
     angles:[{ key:"front"|"left"|"right", label, url (a data URL — never a signed link),
               source:"webcam"|"upload", at (ISO), storage_path? (its synced copy) }],
     url (= the Front), consent:{ subject:"self"|"other", name, adult, textVersion, at, by }
     (or an earlier likeness's one tick: true), subject (shown), capturedAt (ISO, = iso — the
     photos' own time: syncing never changes it), date, sync (in the cloud now), syncedAt, w, h }
   Every lock / sync / revoke / load dispatches "turn-cameo-changed" { charId, scope, reason }
   (charId null = several may have changed).
   ============================================================ */
const CAMEO_CONSENT_TEXT_VERSION = "2026-10-10";
const CAMEO_ANGLE_LABELS = { front:"Front", left:"¾ Left", right:"¾ Right" };
const _cameoMem = new Map();      // "<acct>|<scope>|<charId>" -> this person's full record
const _cameoTeam = new Map();     // "<scope>|<charId>|<owner>" -> a teammate's synced likeness (memory only)
const _cameoMissing = new Set();  // this person's records whose photos aren't on this device any more
let _cameoCloudMine = new Set();  // "<scope>|<charId>" of this person's rows the last cloud read found
let _cameoFilmOwners = {};        // scope -> the film's owner (from the last cloud read)
let _cameoAcctSeen = null;
const _cameoHydrate = { sig:"", promise:null, timer:null };

function _cameoAcct(){ return (_nbBackend==="cloud" && _nbUid) ? String(_nbUid) : "local"; }
function _cameoScopeOf(charId){ return _nbBackend==="cloud" ? String(_scopeFor(charId) || _nbProject || "local") : "local"; }
/* a character's likeness is looked for in its own scope, then (a Show character) in the open
   Episode's — _scopeFor's read fallback for sheets made before a film became a Show */
function _cameoScopesFor(charId){
  const s = _cameoScopeOf(charId);
  return (_nbBackend==="cloud" && _nbProject && s!==String(_nbProject)) ? [s, String(_nbProject)] : [s];
}
function _cameoOpenScopes(){
  if(_nbBackend!=="cloud") return ["local"];
  return Array.from(new Set([_nbProject, _nbShared].filter(Boolean).map(String)));
}
function _cameoSig(){ return _nbBackend+"|"+(_nbUid||"")+"|"+_cameoOpenScopes().join(","); }
function _cameoFullKey(acct, scope, charId){ return acct+"|"+scope+"|"+charId; }
function _cameoIdbKey(acct, scope, charId){ return "turn-cameo-v2|"+acct+"|"+scope+"|"+encodeURIComponent(String(charId)); }
function _cameoEntryId(scope, charId){ return scope+"|"+charId; }
function _cameoRegKey(acct){ return "turn-cameo-registry-v2:"+acct; }
function _cameoRegRead(acct){
  try{ const o = JSON.parse(localStorage.getItem(_cameoRegKey(acct))||"{}"); return (o && typeof o==="object" && !Array.isArray(o)) ? o : {}; }
  catch(e){ return {}; }
}
function _cameoRegWrite(acct, o){ try{ localStorage.setItem(_cameoRegKey(acct), JSON.stringify(o||{})); }catch(e){} }
function _cameoAnnounce(charId, scope, reason){
  try{ window.dispatchEvent(new CustomEvent("turn-cameo-changed",{ detail:{ charId:charId==null?null:String(charId), scope:scope||null, reason:reason||"" } })); }catch(e){}
}
function _cameoToast(msg, kind){ try{ if(typeof window.appToast==="function") window.appToast(msg, kind||"info"); }catch(e){} }

/* the OLD unscoped store (read-only here; deleted only when the person deletes an earlier likeness) */
function nbCameoKey(id){ return "turn-cameo-"+id; }
function nbCameoRegKey(){ return "turn-cameo-registry"; }
function _cameoOldReg(){
  try{ const o = JSON.parse(localStorage.getItem(nbCameoRegKey())||"{}"); return (o && typeof o==="object" && !Array.isArray(o)) ? o : {}; }
  catch(e){ return {}; }
}

function _cameoAngleKeyOf(a, i){
  const k = String((a && a.key)||"").toLowerCase();
  if(CAMEO_ANGLE_LABELS[k]) return k;
  const l = String((a && a.label)||"").toLowerCase();
  if(/left/.test(l)) return "left";
  if(/right/.test(l)) return "right";
  if(/front/.test(l)) return "front";
  return i===0 ? "front" : "angle"+i;
}
/* any record to the multi-angle shape (an Increment-A single "url" included) */
function cameoNormalize(rec){
  if(!rec) return null;
  let angles = (Array.isArray(rec.angles) && rec.angles.length) ? rec.angles.slice()
             : (rec.url ? [{ label:"Front", url:rec.url }] : []);
  angles = angles.filter(a=>a && a.url).map((a,i)=>{
    const key = _cameoAngleKeyOf(a, i);
    const source = a.source==="upload" ? "upload" : a.source==="webcam" ? "webcam" : (rec.source==="upload" ? "upload" : "webcam");
    return { ...a, key, label:a.label || CAMEO_ANGLE_LABELS[key] || "Angle", source };
  });
  const capturedAt = rec.capturedAt || rec.iso || "";
  return { ...rec, angles, url: angles.length ? angles[0].url : "", capturedAt, iso: capturedAt || rec.iso || "" };
}
/* the consent record; an earlier likeness's single tick reads as { legacy:true } */
function _cameoConsentOf(rec){
  const c = rec && rec.consent;
  if(c && typeof c==="object") return { subject: c.subject==="other" ? "other" : (c.subject==="self" ? "self" : ""),
    name:String(c.name||"").trim(), adult:c.adult===true, textVersion:String(c.textVersion||""), at:String(c.at||""), by:String(c.by||"") };
  if(c===true) return { legacy:true, subject:"", name:String((rec && rec.subject)||"").trim(), adult:false, textVersion:"", at:"", by:"" };
  return null;
}
function _cameoConsentCurrent(c){
  return !!(c && !c.legacy && c.adult===true && (c.subject==="self" || (c.subject==="other" && !!c.name))
    && c.textVersion===CAMEO_CONSENT_TEXT_VERSION);
}
function _cameoSubjectLabel(c, rec){
  if(c && c.subject==="self") return "Me";
  if(c && c.name) return c.name;
  return String((rec && rec.subject)||"");
}
function _cameoDate(iso){
  try{ return iso ? new Date(iso).toLocaleDateString("en-US",{ month:"short", day:"numeric", year:"numeric" }) : ""; }catch(e){ return ""; }
}
function cameoMetaOf(rec){
  const n = cameoNormalize(rec) || {};
  const consent = _cameoConsentOf(n);
  const sources = Array.from(new Set((n.angles||[]).map(a=>a.source)));
  return { charId:String(n.charId||""), scope:String(n.scope||""), acct:String(n.acct||""), charName:String(n.charName||""),
    consent, subject:_cameoSubjectLabel(consent, n),
    angleCount:(n.angles && n.angles.length)||0, angleKeys:(n.angles||[]).map(a=>a.key),
    source: sources.length===1 ? sources[0] : (sources.length ? "webcam + upload" : "webcam"), sources,
    sync:!!n.sync, syncedAt:n.syncedAt||null, capturedAt:n.capturedAt||null, iso:n.capturedAt||n.iso||null,
    date:_cameoDate(n.capturedAt||n.iso), w:n.w||0, h:n.h||0, from:String(n.from||"") };
}
function _cameoMetaFromRow(row){
  const p = (row && row.prov) || {};
  const angles = Array.isArray(row && row.angles) ? row.angles.filter(a=>a && a.storage_path) : [];
  const capturedAt = p.capturedAt || p.iso || null;
  const consent = _cameoConsentOf({ consent:p.consent, subject:p.subject });
  const sources = Array.from(new Set(angles.map(a=>a.source==="upload" ? "upload" : (a.source==="webcam" ? "webcam" : (p.source==="upload" ? "upload" : "webcam")))));
  return { charId:String(row.char_id), scope:String(row.project_id), owner:String(row.owner), charName:String(p.charName||""),
    consent, subject:_cameoSubjectLabel(consent, { subject:p.subject }),
    angleCount:angles.length, angleKeys:angles.map((a,i)=>_cameoAngleKeyOf(a,i)),
    source: sources.length===1 ? sources[0] : (sources.length ? "webcam + upload" : "webcam"), sources,
    sync:true, syncedAt:row.updated_at||null, capturedAt, iso:capturedAt, date:_cameoDate(capturedAt), w:p.w||0, h:p.h||0 };
}

/* this person's own records */
async function _cameoReadOwn(acct, scope, charId){
  const k = _cameoFullKey(acct, scope, charId);
  const m = _cameoMem.get(k);
  if(m && m.angles && m.angles.length) return m;
  try{
    const v = await idbGet(_cameoIdbKey(acct, scope, charId));
    const n = v ? cameoNormalize(v) : null;
    if(n && n.angles.length){ _cameoMem.set(k, n); _cameoMissing.delete(k); return n; }
  }catch(e){}
  return null;
}
async function _cameoWriteOwn(full){
  const n = cameoNormalize(full);
  const k = _cameoFullKey(n.acct, n.scope, n.charId);
  _cameoMem.set(k, n); _cameoMissing.delete(k);
  let stored = true;
  try{ await idbSet(_cameoIdbKey(n.acct, n.scope, n.charId), n); }catch(e){ stored = false; }
  const reg = _cameoRegRead(n.acct); reg[_cameoEntryId(n.scope, n.charId)] = cameoMetaOf(n); _cameoRegWrite(n.acct, reg);
  return { rec:n, stored };
}
async function _cameoDropOwn(acct, scope, charId){
  const k = _cameoFullKey(acct, scope, charId);
  _cameoMem.delete(k); _cameoMissing.delete(k);
  try{ await idbDel(_cameoIdbKey(acct, scope, charId)); }catch(e){}
  const reg = _cameoRegRead(acct); delete reg[_cameoEntryId(scope, charId)]; _cameoRegWrite(acct, reg);
}
function _cameoMissingWhy(scope, charId){
  return _cameoCloudMine.has(_cameoEntryId(scope, String(charId)))
    ? "Its photos are in the cloud but couldn't be loaded onto this device right now. Try again in a moment."
    : "This likeness was locked on this device, but its photos are no longer here. Recapture it to use it again.";
}
function _cameoOwnEntry(acct, meta){
  const k = _cameoFullKey(acct, meta.scope, meta.charId);
  const missing = _cameoMissing.has(k);
  return { kind:"own", key:k, mine:true, charId:String(meta.charId), scope:String(meta.scope), acct,
    owner: acct==="local" ? null : acct, meta, available:!missing, why: missing ? _cameoMissingWhy(meta.scope, meta.charId) : "" };
}
function _cameoTeamEntry(t){
  const failed = t.state==="failed";
  return { kind:"team", key:t.key, mine:false, charId:t.charId, scope:t.scope, acct:_cameoAcct(), owner:t.owner, meta:t.meta,
    available:!failed, why: failed ? "A teammate's likeness is synced for this character, but its photos couldn't be loaded right now. Try again in a moment." : "" };
}
/* every likeness of this character this person may use in the open film, best first: their own,
   then the film owner's synced one, then any other synced one (latest first) */
function _cameoCandidates(charId){
  const id = String(charId), acct = _cameoAcct(), scopes = _cameoScopesFor(id), reg = _cameoRegRead(acct), out = [];
  for(const scope of scopes){
    const meta = reg[_cameoEntryId(scope, id)];
    if(meta) out.push(_cameoOwnEntry(acct, { ...meta, scope, charId:id }));
  }
  for(const t of _cameoTeam.values()) if(t.charId===id && scopes.indexOf(t.scope)>=0) out.push(_cameoTeamEntry(t));
  const rank = (c)=> (c.available ? 0 : 10) + (c.mine ? 0 : (c.owner && _cameoFilmOwners[c.scope]===c.owner ? 1 : 2)) + scopes.indexOf(c.scope)*0.5;
  out.sort((a,b)=> (rank(a)-rank(b)) || String((b.meta && b.meta.syncedAt)||"").localeCompare(String((a.meta && a.meta.syncedAt)||"")));
  return out;
}
function _cameoPick(charId){ return _cameoCandidates(charId)[0] || null; }
function _cameoFullOf(e){ return !e ? null : e.kind==="own" ? (_cameoMem.get(e.key)||null) : ((_cameoTeam.get(e.key)||{}).full||null); }

/* ── reads (the open film's scope; the names and signatures every caller already uses) ── */
function nbCameoMeta(id){ const p = _cameoPick(id); return (p && p.available) ? { ...p.meta, mine:p.mine, owner:p.owner } : null; }
function nbGetCameo(id){ const p = _cameoPick(id); const r = (p && p.available) ? _cameoFullOf(p) : null; return (r && r.url) ? r.url : ""; }
function nbGetCameoAngles(id){ const p = _cameoPick(id); const r = (p && p.available) ? _cameoFullOf(p) : null; return (r && r.angles) ? r.angles.map(a=>a.url).filter(Boolean) : []; }
async function nbLoadCameo(id){ const full = await nbLoadCameoFull(id); return full ? full.url : ""; }
async function nbLoadCameoAngles(id){ const full = await nbLoadCameoFull(id); return full ? full.angles.map(a=>a.url).filter(Boolean) : []; }
/* the FULL record used for this character in the open film (for generation), or null */
async function nbLoadCameoFull(id){
  // best first; one that couldn't be loaded before is tried again (its cloud copy may answer now)
  for(const e of _cameoCandidates(id)){
    const full = await nbLoadCameoEntry(e);
    if(full){ if(!e.available) _cameoAnnounce(e.charId, e.scope, "load"); return full; }
  }
  return null;
}
/* the full record of one entry (nbListCameoEntries / nbListOtherCameos) — this person's own from
   this device (or its synced copy, downloaded), a teammate's into memory only */
async function nbLoadCameoEntry(e){
  if(!e) return null;
  if(e.kind==="team") return await _cameoLoadTeam(e.key);
  const r = await _cameoReadOwn(e.acct, e.scope, e.charId);
  if(r) return r;
  if(_nbBackend==="cloud" && _nbUid && String(_nbUid)===String(e.acct) && _cameoCloudMine.has(_cameoEntryId(e.scope, e.charId))){
    const got = await _cameoFetchOwn(e.scope, e.charId, null);
    if(got){ _cameoAnnounce(e.charId, e.scope, "load"); return got; }
  }
  if(!_cameoMissing.has(e.key)){ _cameoMissing.add(e.key); _cameoAnnounce(e.charId, e.scope, "missing"); }
  return null;
}
/* this person's OWN record for a character of the open film (the capture window starts from it) */
async function nbLoadMyCameo(id){
  const acct = _cameoAcct();
  for(const scope of _cameoScopesFor(id)){
    const r = await _cameoReadOwn(acct, scope, String(id));
    if(r) return r;
  }
  return null;
}
/* { locked, synced, angleCount, capturedAt, consent:{subject,name,adult}, mine, available, why } —
   available:false means a likeness exists for this character here but this person can't use it
   right now; `why` says why in a plain sentence. An earlier likeness's consent reads
   { subject:"", name, adult:false, legacy:true }. */
const _cameoRetryAt = new Map();   // entry key -> when its photos were last tried again
/* a likeness whose cloud photos couldn't be read is tried again in the background (at most every 30 s);
   success says "turn-cameo-changed" so the card and its prices catch up */
function _cameoRetryLater(e){
  if(!e || e.available) return;
  const retryable = e.kind==="team" || _cameoCloudMine.has(_cameoEntryId(e.scope, e.charId));
  if(!retryable) return;
  const now = Date.now();
  if(now - (_cameoRetryAt.get(e.key)||0) < 30000) return;
  _cameoRetryAt.set(e.key, now);
  Promise.resolve().then(()=>nbLoadCameoEntry(e)).then((full)=>{ if(full) _cameoAnnounce(e.charId, e.scope, "load"); }).catch(()=>{});
}
function nbCameoInfo(id){
  const p = _cameoPick(id);
  if(!p) return { locked:false, synced:false, angleCount:0, capturedAt:null, consent:null, mine:false, available:false, why:"" };
  if(!p.available) _cameoRetryLater(p);
  const m = p.meta || {}, c = m.consent;
  return { locked:true, synced:!!m.sync, angleCount:m.angleCount||0, capturedAt:m.capturedAt||m.iso||null,
    consent: c ? { subject:c.subject||"", name:c.name||"", adult:c.adult===true, ...(c.legacy ? { legacy:true } : {}) } : null,
    mine:!!p.mine, available:!!p.available, why:p.why||"" };
}
/* the entry a character's likeness is used from in the open film (for revoke flows) */
function nbCameoEntryFor(id){ return _cameoPick(id); }

/* ── lists ── */
/* every likeness this person knows of in the open film (their own + teammates' synced ones) */
function nbListCameoEntries(){
  const acct = _cameoAcct(), scopes = _cameoOpenScopes(), reg = _cameoRegRead(acct), out = [];
  for(const meta of Object.values(reg)){
    if(!meta || scopes.indexOf(String(meta.scope))<0) continue;
    out.push(_cameoOwnEntry(acct, meta));
  }
  for(const t of _cameoTeam.values()) if(scopes.indexOf(t.scope)>=0) out.push(_cameoTeamEntry(t));
  for(const e of out){ const p = _cameoPick(e.charId); e.inUse = !!(p && p.key===e.key); }
  return out;
}
/* one per character of the open film — the likeness in use (the Characters header counts these) */
function nbListCameos(){
  const seen = new Set(), out = [];
  for(const e of nbListCameoEntries()){
    if(seen.has(e.charId)) continue; seen.add(e.charId);
    const p = _cameoPick(e.charId);
    if(p) out.push({ id:p.charId, ...p.meta, mine:p.mine, owner:p.owner, scope:p.scope, available:p.available, why:p.why });
  }
  return out;
}
/* this person's likenesses for OTHER films kept on this device */
function nbListOtherCameos(){
  const acct = _cameoAcct(), scopes = _cameoOpenScopes(), reg = _cameoRegRead(acct), out = [];
  for(const meta of Object.values(reg)) if(meta && scopes.indexOf(String(meta.scope))<0) out.push(_cameoOwnEntry(acct, meta));
  return out;
}
/* likenesses saved before 2026-10-10, not tied to a film or an account (kept as they were) */
function nbListEarlierCameos(){
  const reg = _cameoOldReg();
  return Object.keys(reg).map(id=>{
    const m = reg[id] || {};
    return { kind:"earlier", id, charId:id, subject:String(m.subject||""), angleCount:m.angleCount||1, source:m.source||"webcam",
      capturedAt:m.iso||null, date:m.date||_cameoDate(m.iso), sync:!!m.sync };
  });
}
async function nbLoadEarlierCameo(oldId){
  try{ const v = await idbGet(nbCameoKey(oldId)); const n = v ? cameoNormalize(v) : null; return (n && n.angles.length) ? n : null; }
  catch(e){ return null; }
}
/* "Use for <character> in this film": a COPY into the open film's scope with its original
   provenance (its tick, source, subject note and capture date); the earlier record stays */
async function nbAdoptEarlierCameo(oldId, charId){
  const n = await nbLoadEarlierCameo(oldId);
  if(!n) return { ok:false, message:"That earlier likeness's photos are no longer on this device." };
  const angles = [];
  for(const a of n.angles){
    // an old cloud read could leave a signed link where the photo should be: only real photo bytes are copied
    const url = /^data:image\//i.test(String(a.url)) ? a.url : await _cameoUrlToDataUrl(a.url);
    if(!url) return { ok:false, message:"That earlier likeness's photos are no longer on this device." };
    angles.push({ key:a.key, label:a.label, url, source:a.source, at:n.iso||"" });
  }
  const target = String(charId||oldId), acct = _cameoAcct(), scope = _cameoScopeOf(target);
  const capturedAt = n.iso || n.capturedAt || new Date().toISOString();
  const { rec } = await _cameoWriteOwn({ v:2, charId:target, scope, acct, charName:"", angles,
    consent: (n.consent && typeof n.consent==="object") ? n.consent : !!n.consent, subject:String(n.subject||""),
    capturedAt, iso:capturedAt, date:_cameoDate(capturedAt), w:n.w||0, h:n.h||0, sync:false, syncedAt:null,
    from:"earlier", earlierId:String(oldId) });
  _cameoAnnounce(target, scope, "lock");
  return { ok:true, meta:cameoMetaOf(rec) };
}
async function nbDeleteEarlierCameo(oldId){
  try{ await idbDel(nbCameoKey(oldId)); }catch(e){}
  const reg = _cameoOldReg(); delete reg[oldId];
  try{ localStorage.setItem(nbCameoRegKey(), JSON.stringify(reg)); }catch(e){}
  _cameoAnnounce(null, null, "revoke");
  return { ok:true };
}
async function _cameoUrlToDataUrl(url){
  try{
    if(!/^https?:/i.test(String(url||""))) return "";
    const res = await fetch(url); if(!res.ok) return "";
    const blob = await res.blob(); if(!/^image\//i.test(blob.type||"")) return "";
    return await new Promise((resolve)=>{ const rd = new FileReader(); rd.onload = ()=>resolve(String(rd.result||"")); rd.onerror = ()=>resolve(""); rd.readAsDataURL(blob); });
  }catch(e){ return ""; }
}

/* ── lock (capture / recapture) ── */
/* save or replace THIS person's likeness of a character in the open film.
   rec = { angles:[{ key, label, url, source }], consent:{ subject:"self"|"other", name, adult:true },
           sync, w, h, charName }. The capture time of a photo that didn't change is kept; a changed
   consent answer is recorded with its own time. sync:true syncs it (only a successful sync marks it
   synced — a failure keeps it on this device and says so); sync:false on a synced likeness removes
   its cloud copy. Returns its meta (+ syncError when a sync step failed). */
async function nbSetCameo(id, rec){
  rec = rec || {};
  const charId = String(id), acct = _cameoAcct(), scope = _cameoScopeOf(charId);
  const prev = await _cameoReadOwn(acct, scope, charId);
  const now = new Date().toISOString();
  const incoming = (cameoNormalize({ ...rec, charId }) || { angles:[] }).angles;
  if(!incoming.length) throw new Error("Capture the Front angle first.");
  const prevByKey = {}; ((prev && prev.angles)||[]).forEach(a=>{ prevByKey[a.key] = a; });
  const angles = incoming.map(a=>{
    const old = prevByKey[a.key], same = !!(old && old.url===a.url);
    return { key:a.key, label:a.label, url:a.url, source:a.source, at: same ? (old.at || (prev && prev.capturedAt) || now) : now,
      ...(same && old.storage_path ? { storage_path:old.storage_path } : {}) };
  });
  const capturedAt = angles.map(a=>a.at).filter(Boolean).sort().pop() || now;
  let consent;
  const c = rec.consent;
  if(c && typeof c==="object"){
    const subject = c.subject==="other" ? "other" : (c.subject==="self" ? "self" : "");
    const name = subject==="other" ? String(c.name||"").trim() : "";
    if(!subject) throw new Error("Say whose likeness this is first.");
    if(subject==="other" && !name) throw new Error("Add the name of the person whose likeness this is.");
    if(c.adult!==true) throw new Error("Confirm the person is 18 or over to lock this likeness.");
    const pc = prev ? _cameoConsentOf(prev) : null;
    const same = !!(pc && !pc.legacy && pc.subject===subject && pc.name===name && pc.textVersion===CAMEO_CONSENT_TEXT_VERSION);
    consent = same ? { subject, name, adult:true, textVersion:pc.textVersion, at:pc.at, by:pc.by }
                   : { subject, name, adult:true, textVersion:CAMEO_CONSENT_TEXT_VERSION, at:now, by:acct };
  } else if(c===true){
    consent = (prev && prev.consent) ? prev.consent : true;   // an earlier likeness's one tick, as it was
  } else if(prev && prev.consent){
    consent = prev.consent;
  } else {
    throw new Error("Say whose likeness this is and confirm their permission first.");
  }
  const consentSame = !!prev && JSON.stringify(prev.consent)===JSON.stringify(consent);
  const unchanged = !!prev && consentSame && angles.length===prev.angles.length && angles.every(a=>!!a.storage_path);
  const full = { v:2, charId, scope, acct, charName:String(rec.charName || (prev && prev.charName) || ""), angles, consent,
    subject:_cameoSubjectLabel(_cameoConsentOf({ consent }), {}),
    capturedAt, iso:capturedAt, date:_cameoDate(capturedAt), w:rec.w || (prev && prev.w) || 0, h:rec.h || (prev && prev.h) || 0,
    // the cloud copy matches only an unchanged likeness; a changed one is synced again (or stays local)
    sync: !!(prev && prev.sync && unchanged), syncedAt: (prev && prev.sync && unchanged) ? (prev.syncedAt||null) : null,
    from: (prev && prev.from) || "capture", ...(prev && prev.earlierId ? { earlierId:prev.earlierId } : {}) };
  const { stored } = await _cameoWriteOwn(full);
  if(!stored) _cameoToast("This likeness is locked for now, but this browser didn't let it be kept on this device — it will be gone after a reload.", "error");
  let syncError = "";
  const inCloud = !!(prev && prev.sync) || _cameoCloudMine.has(_cameoEntryId(scope, charId));
  if(rec.sync){
    if(!(full.sync && unchanged)){ const r = await _cameoPush(full); if(!r.ok) syncError = r.message; }
  } else if(inCloud){
    const r = await _cameoUnpush(full); if(!r.ok) syncError = r.message;
  }
  _cameoAnnounce(charId, scope, "lock");
  const now2 = _cameoMem.get(_cameoFullKey(acct, scope, charId)) || full;
  return { ...cameoMetaOf(now2), mine:true, ...(syncError ? { syncError } : {}) };
}

/* ── sync ── */
async function _cameoPush(full){
  const n = cameoNormalize(full);
  const entryId = _cameoEntryId(n.scope, n.charId);
  const fail = async (message)=>{
    const cur = (await _cameoReadOwn(n.acct, n.scope, n.charId)) || n;
    if(cur.sync) await _cameoWriteOwn({ ...cur, sync:false, syncedAt:null });
    _cameoToast("This likeness is saved on this device, but syncing it to the cloud didn't work"+(message ? ": "+message.replace(/[.\s]+$/,"") : "")+". Try Sync again from Likenesses.", "error");
    return { ok:false, message };
  };
  if(_nbBackend!=="cloud" || !_nbUid || String(_nbUid)!==String(n.acct)) return await fail("sign in to sync it");
  if(!_cameoConsentCurrent(_cameoConsentOf(n))) return await fail("first say whose likeness it is and confirm their permission");
  if(typeof window.cloudSyncCameo!=="function") return await fail("cloud sync isn't available right now");
  const diag = {};
  let ok = false;
  try{ ok = (await window.cloudSyncCameo(n.scope, String(n.acct), n.charId, n, diag))===true; }
  catch(e){ if(!diag.message) diag.message = (e && e.message) || ""; }
  if(!ok) return await fail(String(diag.message||""));
  const paths = Array.isArray(diag.angles) ? diag.angles : [];
  const angles = n.angles.map((a,i)=>{ const p = paths.find(x=>x && x.key===a.key) || paths[i]; return (p && p.storage_path) ? { ...a, storage_path:p.storage_path } : a; });
  await _cameoWriteOwn({ ...n, angles, sync:true, syncedAt:new Date().toISOString() });
  _cameoCloudMine.add(entryId);
  return { ok:true };
}
async function _cameoUnpush(full){
  const n = cameoNormalize(full);
  const fail = (message)=>{
    _cameoToast("The cloud copy of this likeness couldn't be removed"+(message ? ": "+message.replace(/[.\s]+$/,"") : "")+". It's still synced — try Unsync again from Likenesses.", "error");
    return { ok:false, message };
  };
  if(_nbBackend!=="cloud" || !_nbUid || String(_nbUid)!==String(n.acct)) return fail("sign in first");
  if(typeof window.cloudDeleteCameo!=="function") return fail("the cloud isn't available right now");
  let r = null;
  try{ r = await window.cloudDeleteCameo(n.scope, n.charId, String(n.acct)); }catch(e){ r = { ok:false, message:(e && e.message)||"" }; }
  if(!r || !r.ok){
    const cur = (await _cameoReadOwn(n.acct, n.scope, n.charId)) || n;
    await _cameoWriteOwn({ ...cur, sync:true });
    return fail(String((r && r.message)||""));
  }
  const cur = (await _cameoReadOwn(n.acct, n.scope, n.charId)) || n;
  await _cameoWriteOwn({ ...cur, angles:cur.angles.map(a=>{ const b = { ...a }; delete b.storage_path; return b; }), sync:false, syncedAt:null });
  _cameoCloudMine.delete(_cameoEntryId(n.scope, n.charId));
  return { ok:true };
}
function _cameoResolveOwn(target){
  if(target && typeof target==="object") return (target.kind==="team" || target.mine===false) ? null
    : { acct:String(target.acct || _cameoAcct()), scope:String(target.scope), charId:String(target.charId) };
  const p = _cameoCandidates(target).find(c=>c.mine);
  return p ? { acct:p.acct, scope:p.scope, charId:p.charId } : null;
}
/* sync on / off WHERE the likeness lives (its own film), never changing its capture time.
   opts.consent: a fresh consent answer (an earlier likeness asks again before its first sync) */
async function nbSyncCameo(target, on, opts){
  const e = _cameoResolveOwn(target);
  if(!e) return { ok:false, message:"This likeness isn't on this device." };
  let full = await _cameoReadOwn(e.acct, e.scope, e.charId);
  if(!full) return { ok:false, message:_cameoMissingWhy(e.scope, e.charId) };
  const c = opts && opts.consent;
  if(on && c && typeof c==="object" && c.adult===true && (c.subject==="self" || (c.subject==="other" && String(c.name||"").trim()))){
    const consent = { subject:c.subject, name:c.subject==="other" ? String(c.name).trim() : "", adult:true,
      textVersion:CAMEO_CONSENT_TEXT_VERSION, at:new Date().toISOString(), by:e.acct,
      ...(full.consent===true ? { earlier:true } : {}) };
    full = (await _cameoWriteOwn({ ...full, consent, subject:_cameoSubjectLabel(_cameoConsentOf({ consent }), {}) })).rec;
  }
  const r = on ? await _cameoPush(full) : await _cameoUnpush(full);
  _cameoAnnounce(e.charId, e.scope, "sync");
  return r;
}
/* does this likeness need the consent question before it can sync (an earlier likeness's one tick)? */
function nbCameoNeedsConsent(entry){ const m = entry && entry.meta; return !(m && _cameoConsentCurrent(m.consent)); }

/* ── revoke: where the likeness lives (its own film and account), never "the open film" ── */
async function nbRevokeCameo(target){
  const e = (target && typeof target==="object") ? target : _cameoPick(target);
  if(!e) return { ok:true, removed:0 };
  if(e.kind==="team" || e.mine===false){
    if(!(_nbUid && _cameoFilmOwners[e.scope]===String(_nbUid)))
      return { ok:false, message:"Only the person who captured this likeness, or the film's owner, can remove it." };
    if(typeof window.cloudDeleteCameo!=="function") return { ok:false, message:"The cloud isn't available right now." };
    const r = await window.cloudDeleteCameo(e.scope, e.charId, e.owner);
    if(!r || !r.ok) return { ok:false, message:(r && r.message) || "It couldn't be removed right now." };
    _cameoTeam.delete(e.key);
    _cameoAnnounce(e.charId, e.scope, "revoke");
    return { ok:true, removed:1 };
  }
  const acct = String(e.acct || _cameoAcct()), scope = String(e.scope), charId = String(e.charId);
  const meta = _cameoRegRead(acct)[_cameoEntryId(scope, charId)] || e.meta || {};
  const inCloud = !!meta.sync || _cameoCloudMine.has(_cameoEntryId(scope, charId));
  if(_nbBackend==="cloud" && String(_nbUid)===acct && typeof window.cloudDeleteCameo==="function"){
    // signed in as its owner: its row and photos go too (asked even when this device doesn't know of a
    // cloud copy — one synced from another device must not be left behind)
    let r = null;
    try{ r = await window.cloudDeleteCameo(scope, charId, acct); }catch(err){ r = { ok:false, message:(err && err.message)||"" }; }
    if((!r || !r.ok) && inCloud)
      return { ok:false, message:"Its cloud copy couldn't be removed right now"+((r && r.message) ? ": "+String(r.message).replace(/[.\s]+$/,"") : "")+". Nothing was revoked — try again." };
  } else if(inCloud){
    return { ok:false, message:"Sign in to revoke it — its cloud copy has to go too." };
  }
  await _cameoDropOwn(acct, scope, charId);
  _cameoCloudMine.delete(_cameoEntryId(scope, charId));
  _cameoAnnounce(charId, scope, "revoke");
  return { ok:true, removed:1 };
}
/* the character's likeness in the open film: this person's own (every scope it's looked for in),
   and — for the film's owner — teammates' synced ones too. Card "Remove" / delete-forever call this. */
async function nbClearCameo(id){
  let removed = 0, message = "";
  for(const e of _cameoCandidates(id)){
    if(!e.mine && !(_nbUid && _cameoFilmOwners[e.scope]===String(_nbUid))) continue;
    const r = await nbRevokeCameo(e);
    if(r && r.ok) removed += r.removed||0; else if(r && r.message) message = r.message;
  }
  return message ? { ok:false, removed, message } : { ok:true, removed };
}
/* a deleted film: this person's likenesses for it leave this device too */
async function nbCameoForgetScope(scopeId){
  const acct = _cameoAcct(), reg = _cameoRegRead(acct);
  for(const meta of Object.values(reg)) if(meta && String(meta.scope)===String(scopeId)) await _cameoDropOwn(acct, String(meta.scope), String(meta.charId));
  for(const [k,t] of _cameoTeam) if(t.scope===String(scopeId)) _cameoTeam.delete(k);
  _cameoAnnounce(null, String(scopeId), "revoke");
}

/* ── the sheets made with a likeness (meta.cameo on the current image) ── */
/* [{ id, scope, meta }]: the character's master sheet (charId), appearance variants (charId:stateId)
   and scale sheet (charscale-charId) in the likeness's film whose current image used a likeness */
async function nbCameoSheets(target){
  const e = (target && typeof target==="object") ? target : _cameoPick(target);
  if(!e) return [];
  const charId = String(e.charId);
  if(_nbBackend!=="cloud"){
    const out = [];
    try{
      for(let i=0; i<localStorage.length; i++){
        const k = localStorage.key(i) || "";
        if(k.indexOf("turn-charimg-meta-")!==0) continue;
        const sid = k.slice("turn-charimg-meta-".length);
        if(!(sid===charId || sid.indexOf(charId+":")===0 || sid==="charscale-"+charId)) continue;
        const meta = localGetMeta(sid);
        if(meta && meta.cameo===true) out.push({ id:sid, scope:"local", meta });
      }
    }catch(err){}
    return out.sort((a,b)=>a.id.localeCompare(b.id));
  }
  if(typeof window.cloudCameoSheets!=="function") return [];
  const open = _cameoOpenScopes();
  const scopes = open.indexOf(String(e.scope))>=0 ? Array.from(new Set([String(e.scope), ...open])) : [String(e.scope)];
  const r = await window.cloudCameoSheets(scopes, charId);
  return (r && Array.isArray(r.sheets)) ? r.sheets : [];
}
/* clear one such sheet with its versions (the app's own clear: nbClearAsset in the open film) */
async function nbCameoClearSheet(sheet){
  const sid = String(sheet && sheet.id || "");
  if(!sid) return { ok:false };
  if(_nbBackend!=="cloud"){
    await nbClearAsset(sid);
    await localSetHistory(sid, []); await localSetRefs(sid, []);   // the versions too (local keeps them apart)
    return { ok:true };
  }
  if(String(sheet.scope)===String(_scopeFor(sid))){ const r = await nbClearAsset(sid); return { ok:true, ...(r||{}) }; }
  if(typeof window.cloudClear!=="function") return { ok:false };
  const r = await window.cloudClear(String(sheet.scope), sid);   // a film that isn't open: its own scope
  return { ok:true, ...(r||{}) };
}

/* ── the cloud read: on opening a film and on sign-in ── */
async function _cameoFetchOwn(scope, charId, row){
  if(typeof window.cloudLoadCameo!=="function" || !_nbUid) return null;
  const uid = String(_nbUid);
  let r = null;
  try{ r = await window.cloudLoadCameo(scope, charId, uid, row||null); }catch(e){}
  if(!r || !Array.isArray(r.angles) || !r.angles.length) return null;
  if(String(_nbUid)!==uid) return null;
  const capturedAt = r.capturedAt || r.iso || null;
  const { rec } = await _cameoWriteOwn({ v:2, charId:String(charId), scope:String(scope), acct:uid, charName:String(r.charName||""),
    angles:r.angles, consent:r.consent==null ? null : r.consent, subject:String(r.subject||""), capturedAt, iso:capturedAt,
    date:_cameoDate(capturedAt), w:r.w||0, h:r.h||0, sync:true, syncedAt:r.syncedAt||null, from:"cloud" });
  _cameoCloudMine.add(_cameoEntryId(scope, charId));
  return rec;
}
async function _cameoAdoptOwnRow(row){
  const uid = String(row.owner), scope = String(row.project_id), charId = String(row.char_id);
  const cloud = _cameoMetaFromRow(row);
  const local = await _cameoReadOwn(uid, scope, charId);
  if(local && local.capturedAt && cloud.capturedAt && local.capturedAt===cloud.capturedAt){
    // the same likeness: this device's copy is the synced one (each photo keeps its cloud path)
    const angles = local.angles.map((a,i)=>{
      const ca = (row.angles||[]).find((x,j)=>x && _cameoAngleKeyOf(x,j)===a.key) || (row.angles||[])[i];
      return (ca && ca.storage_path) ? { ...a, storage_path:ca.storage_path } : a;
    });
    if(!local.sync || angles.some((a,i)=>a.storage_path!==local.angles[i].storage_path)){
      await _cameoWriteOwn({ ...local, angles, sync:true, syncedAt:local.syncedAt || row.updated_at || null });
      _cameoAnnounce(charId, scope, "load");
    }
    return;
  }
  if(local && local.capturedAt && cloud.capturedAt && String(local.capturedAt) > String(cloud.capturedAt)){
    // a newer capture on this device, not synced yet: it stays as it is (its next sync replaces the cloud's)
    if(local.sync){ await _cameoWriteOwn({ ...local, sync:false, syncedAt:null }); _cameoAnnounce(charId, scope, "load"); }
    return;
  }
  // the cloud's copy is newer, or this device has none: bring its photos here
  const got = await _cameoFetchOwn(scope, charId, row);
  if(!got){
    // still listed (so it can be seen and revoked), its photos marked as not here
    const reg = _cameoRegRead(uid), id = _cameoEntryId(scope, charId);
    if(!reg[id]){ reg[id] = { ...cloud, acct:uid, from:"cloud" }; delete reg[id].owner; _cameoRegWrite(uid, reg); }
    if(!local) _cameoMissing.add(_cameoFullKey(uid, scope, charId));
  }
  _cameoAnnounce(charId, scope, "load");
}
async function _cameoLoadTeam(key){
  const t = _cameoTeam.get(key);
  if(!t) return null;
  if(t.full) return t.full;
  if(t.loading) return await t.loading;
  t.loading = (async()=>{
    let r = null;
    try{ r = (typeof window.cloudLoadCameo==="function") ? await window.cloudLoadCameo(t.scope, t.charId, t.owner, t.row||null) : null; }catch(e){}
    if(_cameoTeam.get(key)!==t) return null;          // the film changed meanwhile
    if(r && Array.isArray(r.angles) && r.angles.length){
      // memory only: a teammate's photos are never written to this device
      t.full = cameoNormalize({ ...r, charId:t.charId, scope:t.scope, acct:"", sync:true });
      t.state = "ready";
    } else t.state = "failed";
    t.loading = null;
    return t.full || null;
  })();
  return await t.loading;
}
async function nbCameoRefresh(){
  const sig = _cameoSig();
  if(_cameoHydrate.promise && _cameoHydrate.sig===sig) return _cameoHydrate.promise;
  const run = (async()=>{
    const acct = _cameoAcct(), scopes = _cameoOpenScopes();
    // 1. this device: are the photos of each own likeness in the open film still here?
    for(const meta of Object.values(_cameoRegRead(acct))){
      if(!meta || scopes.indexOf(String(meta.scope))<0) continue;
      const r = await _cameoReadOwn(acct, String(meta.scope), String(meta.charId));
      if(!r) _cameoMissing.add(_cameoFullKey(acct, String(meta.scope), String(meta.charId)));
    }
    if(_cameoSig()!==sig) return { ok:false, stale:true };
    if(_nbBackend!=="cloud" || !_nbUid || typeof window.cloudListCameos!=="function"){ _cameoAnnounce(null, null, "load"); return { ok:true, local:true }; }
    // 2. the cloud: every likeness of this film this person may read
    const uid = String(_nbUid);
    const listedAt = new Date().toISOString();
    const res = await window.cloudListCameos(scopes);
    if(_cameoSig()!==sig) return { ok:false, stale:true };
    if(!res || !res.ok){ _cameoAnnounce(null, null, "load"); return { ok:false }; }
    _cameoFilmOwners = { ..._cameoFilmOwners, ...(res.owners||{}) };
    const mine = new Set(), teamKeys = new Set();
    for(const row of (res.rows||[])){
      if(!row || !row.char_id || !row.project_id || scopes.indexOf(String(row.project_id))<0) continue;
      const scope = String(row.project_id), charId = String(row.char_id), owner = String(row.owner);
      if(owner===uid){
        mine.add(_cameoEntryId(scope, charId));
        _cameoCloudMine.add(_cameoEntryId(scope, charId));
        await _cameoAdoptOwnRow(row);
        if(_cameoSig()!==sig) return { ok:false, stale:true };
        continue;
      }
      const key = scope+"|"+charId+"|"+owner;
      teamKeys.add(key);
      const old = _cameoTeam.get(key);
      const meta = _cameoMetaFromRow(row);
      if(old && old.full && old.meta && old.meta.syncedAt===meta.syncedAt){ old.meta = meta; old.row = row; continue; }
      _cameoTeam.set(key, { key, charId, scope, owner, meta, row, full:null, state:"loading", loading:null });
    }
    for(const [k,t] of _cameoTeam) if(scopes.indexOf(t.scope)>=0 && !teamKeys.has(k)) _cameoTeam.delete(k);
    // this person's likenesses the cloud no longer has (removed elsewhere — by the film's owner, or
    // from another device): on this device only now
    const reg = _cameoRegRead(uid);
    for(const [id, meta] of Object.entries(reg)){
      if(!meta || scopes.indexOf(String(meta.scope))<0 || mine.has(id)) continue;
      if(meta.syncedAt && String(meta.syncedAt) >= listedAt) continue;   // synced while the list was on its way
      _cameoCloudMine.delete(id);
      if(!meta.sync) continue;
      const cur = await _cameoReadOwn(uid, String(meta.scope), String(meta.charId));
      if(cur) await _cameoWriteOwn({ ...cur, angles:cur.angles.map(a=>{ const b = { ...a }; delete b.storage_path; return b; }), sync:false, syncedAt:null });
      else { const r2 = _cameoRegRead(uid); if(r2[id]){ r2[id] = { ...r2[id], sync:false, syncedAt:null }; _cameoRegWrite(uid, r2); } }
      _cameoAnnounce(meta.charId, meta.scope, "load");
    }
    _cameoAnnounce(null, null, "load");
    // 3. teammates' photos, into memory (renders use them; the Likenesses window shows them only to the owner)
    for(const t of Array.from(_cameoTeam.values())){
      if(scopes.indexOf(t.scope)<0 || t.full) continue;
      await _cameoLoadTeam(t.key);
      if(_cameoSig()!==sig) return { ok:false, stale:true };
      _cameoAnnounce(t.charId, t.scope, "load");
    }
    return { ok:true };
  })();
  _cameoHydrate.sig = sig; _cameoHydrate.promise = run;
  try{ return await run; }
  finally{ if(_cameoHydrate.promise===run) _cameoHydrate.promise = null; }
}
/* called by nbUseCloud / nbUseLocal / nbUseShared: the open film (or the account) changed */
function _cameoScopeMoved(){
  const acct = _cameoAcct();
  if(_cameoAcctSeen!==null && _cameoAcctSeen!==acct) _cameoDropMemory();   // another account: nothing of the last one stays in memory
  _cameoAcctSeen = acct;
  const scopes = _cameoOpenScopes();
  for(const [k,t] of _cameoTeam) if(scopes.indexOf(t.scope)<0) _cameoTeam.delete(k);
  if(_cameoHydrate.timer) return;
  try{ _cameoHydrate.timer = setTimeout(()=>{ _cameoHydrate.timer = null; nbCameoRefresh().catch(()=>{}); }, 0); }catch(e){}
}
function _cameoDropMemory(){ _cameoMem.clear(); _cameoTeam.clear(); _cameoMissing.clear(); _cameoCloudMine = new Set(); _cameoFilmOwners = {}; }
/* sign-out: drop every photo held in memory (the next account sees only its own) */
function nbCameoSignOut(){ _cameoDropMemory(); _cameoAcctSeen = null; _cameoAnnounce(null, null, "signout"); }
function nbCameoFilmOwner(scope){ return _cameoFilmOwners[String(scope)] || null; }
function nbCameoAccount(){ return _cameoAcct(); }

window.CAMEO_CONSENT_TEXT_VERSION = CAMEO_CONSENT_TEXT_VERSION;
window.nbCameoMeta=nbCameoMeta; window.nbGetCameo=nbGetCameo;
window.nbGetCameoAngles=nbGetCameoAngles; window.nbLoadCameo=nbLoadCameo;
window.nbLoadCameoAngles=nbLoadCameoAngles; window.nbLoadCameoFull=nbLoadCameoFull;
window.nbSetCameo=nbSetCameo; window.nbClearCameo=nbClearCameo; window.nbListCameos=nbListCameos;
window.nbCameoInfo=nbCameoInfo; window.nbCameoEntryFor=nbCameoEntryFor; window.nbLoadMyCameo=nbLoadMyCameo;
window.nbLoadCameoEntry=nbLoadCameoEntry; window.nbListCameoEntries=nbListCameoEntries; window.nbListOtherCameos=nbListOtherCameos;
window.nbListEarlierCameos=nbListEarlierCameos; window.nbLoadEarlierCameo=nbLoadEarlierCameo;
window.nbAdoptEarlierCameo=nbAdoptEarlierCameo; window.nbDeleteEarlierCameo=nbDeleteEarlierCameo;
window.nbSyncCameo=nbSyncCameo; window.nbCameoNeedsConsent=nbCameoNeedsConsent; window.nbRevokeCameo=nbRevokeCameo;
window.nbCameoSheets=nbCameoSheets; window.nbCameoClearSheet=nbCameoClearSheet;
window.nbCameoRefresh=nbCameoRefresh; window.nbCameoSignOut=nbCameoSignOut; window.nbCameoForgetScope=nbCameoForgetScope;
window.nbCameoFilmOwner=nbCameoFilmOwner; window.nbCameoAccount=nbCameoAccount;

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
function nbCommit(id, dataUrl, meta, refs, kind, epoch, cancelled, expected){
  return _nbSerial(id, ()=>_nbCommitInner(id, dataUrl, meta, refs, kind, epoch, cancelled, expected));
}
async function _nbCommitInner(id, dataUrl, meta, refs, kind, epoch, cancelled, expected){
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
    try{ r = await window.cloudCommit(_scope, _uid, id, dataUrl, meta, refs, kind, _cxl, undefined, expected); }
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
  const matchesExpected=()=>!expected||(!!localGetImage(id)===expected.exists&&(localGetMeta(id)?.iso||"")===expected.iso);
  if(!matchesExpected())return {tier:"error",url:dataUrl,error:"The artwork changed. Reopen the review before replacing it."};
  const prev = localGetImage(id);
  if(prev){
    const hist = await localGetHistory(id);
    const prevRefs = await localGetRefs(id);
    if(_stale()) return { tier:"stale", url:dataUrl };
    if(_cxl())   return { tier:"cancelled", url:dataUrl };
    if(!matchesExpected())return {tier:"error",url:dataUrl,error:"The artwork changed. Reopen the review before replacing it."};
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

/* ANOTHER ASSET'S IMAGE AS AN EARLIER VERSION (2026-10-14 — a location merge keeps the merged-away card's plates:
   locations.jsx locationMergeCarryIds, app.jsx mergeLocations). COPIES of other assets' CURRENT images go into this
   asset's version history, in front of its earlier versions — its current image is NEVER replaced (with none, the
   copies wait in Details › Earlier versions until Restore). The sources are untouched. A copy's meta keeps the
   original's (model, prompt, date, version) and says where it came from (carriedFrom); what belonged to that asset
   only is dropped: its approval, its copy check (made against its own parent), its cleanup ledger. The same version
   of a source (id + iso) is never carried twice. Free: nothing is generated or charged.
   sources: [{ id, cardId, name, what, label }] → { ok, carried, skipped, failed:[ids], error? } */
const NB_CARRY_DROP_META = ["approval","copyCheck","cleanupPending","cleanupTombstone","cleanupPurge","cleanupPurgeTarget",
  "cleanupPurgeReceipts","cleanupPurgeWarning","cleanupPurgeRetryable","cleanupPurgeStatus","deleted","deletedStoragePath",
  "seriesMigrationKey","seriesMigrationStatus","seriesMigratedFrom","seriesMigratedAt"];
function nbCarriedVersionMeta(meta, src, at){
  const out = { ...((meta && typeof meta==="object") ? meta : {}) };
  NB_CARRY_DROP_META.forEach(k=>{ delete out[k]; });
  const s = src || {};
  out.carriedFrom = { id:String(s.id||""), cardId:String(s.cardId||s.id||""), name:String(s.name||""),
    what:String(s.what||"plate"), label:String(s.label||""), iso:String((meta && meta.iso)||""), at:String(at||"") };
  return out;
}
function nbCarriedVersionKey(meta){
  const c = meta && meta.carriedFrom;
  return c && c.id ? String(c.id)+"|"+String(c.iso||"") : "";
}
function nbCarryVersionsInto(targetId, sources, opts){
  opts = opts || {};
  const epoch = _nbEpoch, backend = _nbBackend;
  const list = (Array.isArray(sources) ? sources : []).filter(s=>s && s.id && String(s.id)!==String(targetId));
  const none = { ok:true, carried:0, skipped:0, failed:[] };
  if(!targetId || !list.length) return Promise.resolve(none);
  const at = opts.at || new Date().toISOString();
  const stale = ()=> epoch!==_nbEpoch || backend!==_nbBackend;
  const scopeChanged = { ok:false, carried:0, skipped:0, failed:list.map(s=>String(s.id)), error:"asset scope changed" };
  // the card's earlier-versions count (artroom.jsx useImageGen) re-reads; its current image is the same
  const announce = (r)=>{ if(r && r.carried && !stale()){ try{ window.dispatchEvent(new CustomEvent("nb-history-changed",{ detail:{ id:targetId } })); }catch(e){} } return r; };
  if(backend==="cloud"){
    // capture scope + uid now, never after an await (the film may switch)
    const scope = _scopeFor(targetId), uid = _nbUid;
    const srcs = list.map(s=>({ id:String(s.id), projectId:_scopeFor(s.id), fallbackProjectId:_nbProject, from:s }));
    return _nbSerial(targetId, async ()=>{
      if(stale()) return scopeChanged;
      if(typeof window.cloudCarryVersions!=="function") return { ...scopeChanged, error:"cloud copy unavailable" };
      try{
        return announce(await window.cloudCarryVersions(scope, uid, targetId, srcs,
          { metaFor:(meta, from)=>nbCarriedVersionMeta(meta, from, at), keyOf:nbCarriedVersionKey, cancelled:stale }));
      }catch(e){ return { ...scopeChanged, error:(e&&e.message)||"copy failed" }; }
    });
  }
  return _nbSerial(targetId, async ()=>{
    if(stale()) return scopeChanged;
    const hist = await localGetHistory(targetId);
    if(stale()) return scopeChanged;
    // already there: in its earlier versions, or restored as its current plate
    const have = new Set(hist.map(h=>nbCarriedVersionKey(h && h.meta)).concat([nbCarriedVersionKey(localGetMeta(targetId))]).filter(Boolean));
    const add = []; let skipped = 0;
    for(const s of list){
      let url = "";
      try{ url = await localLoadImage(s.id); }catch(e){ url = ""; }
      if(stale()) return scopeChanged;
      if(!url){ skipped++; continue; }
      const meta = nbCarriedVersionMeta(localGetMeta(s.id), s, at);
      const k = nbCarriedVersionKey(meta);
      if(have.has(k)){ skipped++; continue; }
      have.add(k);
      add.push({ url, meta, refs:[] });
    }
    if(!add.length) return { ...none, skipped };
    await localSetHistory(targetId, add.concat(hist));
    return announce({ ok:true, carried:add.length, skipped, failed:[] });
  });
}
window.nbCarriedVersionMeta = nbCarriedVersionMeta;
window.nbCarryVersionsInto = nbCarryVersionsInto;

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
/* A LOCATION'S COPY CHECK (2026-10-14 — locations.jsx "THE COPY CHECK"): the result recorded on the plate's own meta,
   for this exact version only (copyCheck.iso) — "Keep" is written here. Free: no image is made, nothing is charged. */
function nbSetAssetCopyCheck(id, expectedIso, copyCheck){
  const epoch=_nbEpoch;
  return _nbSerial(id,async()=>{
    if(!id || !expectedIso || !copyCheck || typeof copyCheck!=="object") return {ok:false,error:"asset version required"};
    if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
    const check={...copyCheck,iso:expectedIso};
    const backend=_nbBackend;
    const scope=backend==="cloud"?_scopeFor(id):null, uid=_nbUid;
    if(backend==="cloud"){
      if(typeof window.cloudSetAssetCopyCheck!=="function") return {ok:false,error:"cloud update unavailable"};
      try{
        const result=await window.cloudSetAssetCopyCheck(scope,uid,id,expectedIso,check);
        if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
        if(result&&result.ok){
          _cloudMetaCache.set(id,result.meta);
          try{ window.dispatchEvent(new CustomEvent("nb-meta-changed",{detail:{id}})); }catch(e){}
        }
        return result&&typeof result.ok==="boolean" ? result : {ok:false,error:"update failed"};
      }catch(e){
        if(epoch!==_nbEpoch) return {ok:false,error:"asset scope changed"};
        return {ok:false,error:(e&&e.message)||"update failed"};
      }
    }
    const current=localGetMeta(id);
    if(!localGetImage(id)) return {ok:false,error:"asset not found"};
    if(!current || current.iso!==expectedIso) return {ok:false,error:"asset version changed"};
    const meta={...current,copyCheck:check};
    localSetMeta(id,meta);
    try{ window.dispatchEvent(new CustomEvent("nb-meta-changed",{detail:{id}})); }catch(e){}
    return {ok:true,meta};
  });
}
window.nbSetAssetCopyCheck=nbSetAssetCopyCheck;

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
  /* a failed fetch is NO image (2026-10-10, owner — Likeness review): an expired signed link answered 403 with an
     error page, and that page's bytes were sent on as a "reference image" */
  try{ const r = await fetch(src); if(!r || !r.ok) return null;
    const b = await r.blob();
    return (b && b.type && !/^image\//i.test(b.type) && !/octet-stream/i.test(b.type)) ? null : b; }catch(e){ return null; }
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
   Kinolot requests a cinematic ratio. Crop the returned pixels to the exact chosen
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
   generation the client sends provider:"fal"; the proxy maps the selected Kinolot
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

let _nbResCapToastShown = false;
async function proxyGenerate(prompt, opts, provider){
  opts = opts || {};
  /* This is the last shared image-provider boundary.  It intentionally repeats
     the caller-side check: edits, simplified retries, and policy fallbacks all
     converge here, so no paid request can skip the identity gate. */
  nbAssertMediaIdentity(opts, "image-provider-start");
  prompt = nbCanonicalMediaPrompt(prompt, opts);
  const model = nbCanonicalModelId(opts.model || nbGetModel());
  /* THE ENGINE'S PROMPT LIMIT (2026-10-14, owner — "go ahead with all of it"): checked here, after the identity text
     is added, and fitted by the same order the builders use (nbFitImagePrompt) — a prompt is never refused for its
     length and its reference list is never cut. metaOut.promptFit records what had to go. */
  { const fit = nbFitImagePrompt(prompt, Math.min(nbPromptMaxChars(model), Number(opts.__promptLimit)>0 ? Number(opts.__promptLimit) : Infinity));
    if(fit.steps.length){ prompt = fit.prompt;
      if(opts.metaOut) opts.metaOut.promptFit = { limit:fit.limit, before:fit.before, after:fit.after, steps:fit.steps.slice() }; } }
  const aspect = opts.aspectRatio || nbGetAspect();
  /* the engine's own ceiling (2026-10-11): Seedream 5 Pro renders at most 2K — a 4K pick is sent (and priced) as
     2K, said once; metaOut.imageSize records the size really rendered */
  const _wantSize = opts.imageSize || nbGetRes();
  const imageSize = nbModelRes(model, _wantSize);
  if(imageSize!==_wantSize && !_nbResCapToastShown && typeof window.appToast==="function"){
    _nbResCapToastShown = true;
    window.appToast(nbModelLabel(model)+" renders up to "+nbModelMaxRes(model)+", so this image is "+imageSize+".","info");
  }
  if(opts.metaOut) opts.metaOut.imageSize = imageSize;
  const quality = opts.quality == null ? nbGetOaiQuality(model) : opts.quality;
  await nbRequireImageQuality(model,quality);
  nbAssertMediaIdentity(opts,"image-quality-ready");
  // reference images (for image-edit mode) → data URLs the proxy can rebuild
  const refs = [];
  if(opts.referenceImage) refs.push(opts.referenceImage);
  if(opts.extraImages && opts.extraImages.length) refs.push(...opts.extraImages);
  /* an engine that uses fewer reference images (Seedream 5 Pro: 10 — fal would use only the LAST 10) gets the
     FIRST ones, in the caller's priority order (a likeness's front angle is image 1), and the user is told */
  const _maxRefs = nbModelMaxRefs(model);
  if(_maxRefs && refs.length > _maxRefs){
    const dropped = refs.length - _maxRefs;
    refs.length = _maxRefs;
    if(opts.metaOut) opts.metaOut.referencesCapped = { sent:_maxRefs, dropped };
    if(typeof window.appToast==="function")
      window.appToast(nbModelLabel(model)+" uses at most "+_maxRefs+" reference images, so the first "+_maxRefs+" were sent ("+dropped+" left out).","info");
  }
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
    if(du) images.push(du);
    /* a NUMBERED reference list (a likeness render's "Image 1 = the face…") can't lose one silently — every
       number after it would point at the wrong picture. Stop before anything is sent or charged. */
    else if(opts.referencesNumbered)
      throw new Error("Reference image "+(i+1)+" couldn't be read, so nothing was sent and nothing was charged. Try again in a moment."); }

  const sb = (typeof window.sbClient==="function") ? window.sbClient() : null;
  if(!sb || !sb.functions){
    throw new Error(nbProviderLabel(provider)+" runs through your server proxy, which isn't available. Make sure you're signed in and Supabase is configured.");
  }
  const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
  // WHICH FILM AND ITEM (2026-10-02): recorded with the call's credit hold for attribution —
  // the open film unless the caller names another (a Home poster), and the item it will be
  // saved as when the caller knows it (image-proxy request-context.mjs)
  const reqContext = {};
  const _pid = opts.projectId || window.__turnCurrentProjectId;
  if(_pid) reqContext.projectId = String(_pid);
  if(opts.assetId) reqContext.assetId = String(opts.assetId);
  if(opts.assetPurpose) reqContext.purpose = String(opts.assetPurpose);
  const body = { provider, model, prompt, aspect, quality, imageSize, images,
                 ...(Object.keys(reqContext).length ? { context:reqContext } : {}),
                 userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy([provider]) : undefined,
                 // web grounding is Nano Banana 2.1's only (image-search grounding and GPT Image 2's moderation
                 // field went with the engines that had them — 2026-10-11)
                 groundSearch: !!opts.groundSearch && nbModelGrounds(model) };
  // The legacy interactive path retries one status-less transport failure.
  // That does NOT prove the server did no work. Durable batch callers set
  // noRetry and surface an uncertain request for explicit user acknowledgement.
  // Do NOT retry 5xx/504 \u2014 a 504
  // only comes back after the gateway's full (~150s) timeout, and the Edge Function may STILL
  // be running the expensive generation, so retrying just multiplies the wait and the cost.
  // 504s are surfaced immediately (the real mitigation is the downscaled refs above).
  const statusOf = (err)=> (err && err.context && err.context.status) || (err && err.status) || 0;
  /* ONLY A REQUEST THAT NEVER LEFT IS SENT AGAIN (2026-10-09, owner — Art Room review): a dropped connection or a
     timeout can come after the server started (and charged) the image, so re-sending those was a silent second
     paid call. A request that couldn't be sent at all (no connection, no address) is the only one retried. */
  const isNetworkBlip = (err)=> !statusOf(err)
    && /failed to send|name_not_resolved|internet_disconnected|network changed/i.test(((err&&err.message)||"")+"");
  let data, error;
  // HARD CLIENT CAP: functions.invoke has no timeout of its own, so a hung provider
  // connection used to spin "Generating…" forever with no error ever surfacing.
  // 3 minutes is beyond any successful generation; after that we abandon the wait
  // and say so. (Wording deliberately avoids isNetworkBlip's trigger words so an
  // abandoned wait is never auto-retried.)
  const _capped = (pr)=> Promise.race([ pr,
    new Promise((_,rej)=> setTimeout(()=>{ const e=new Error("The image server didn't answer within 6\u00bd minutes — the request was abandoned. If this keeps happening, wait a few minutes before trying again \u2014 the image service may be busy."); e.__timedOut=true; rej(e); }, 390000)) ]);
  for(let attempt=0; attempt<(opts.noRetry ? 1 : 2); attempt++){
    error = null;
    /* Reference conversion above and a network retry are both awaits.  Re-check
       immediately before every paid proxy invocation in case canon changed while
       the request was being prepared. */
    // Long, resumable jobs revalidate ownership after reference conversion,
    // at the last point before spending. A declined guard never submits.
    if(typeof opts.beforeSubmit==="function") await opts.beforeSubmit();
    nbAssertMediaIdentity(opts, "image-provider-submit");
    try{ ({ data, error } = await _capped(sb.functions.invoke(fnName, { body }))); }
    catch(e){ error = e; }
    if(!error) break;
    if(error.__timedOut) break;
    if(!opts.noRetry && attempt<1 && isNetworkBlip(error)){ await new Promise(r=>setTimeout(r, 600)); continue; }
    break;
  }
  if(error){
    const status = statusOf(error);
    // Supabase represents every non-2xx function response as an invocation error.
    // Preserve the Edge Function's JSON explanation (invalid model, no credits,
    // provider rejection, etc.) instead of showing only the SDK's generic message.
    let relayed = "", body = null;
    try{
      const ctx = error.context;
      const j = ctx && await ctx.json();
      body = j || null;
      relayed = (j && (j.error || j.message || j.msg)) || "";
    }catch(e){}
    /* a BILLING refusal (billing fixes, 2026-09-30: no plan / not enough credits / a frozen
       account / a plan-only engine) reads as one calm sentence; credit and plan refusals open
       the Plans window */
    const billing = (typeof window.turnBillingError==="function") ? window.turnBillingError(body, status) : null;
    if(billing){
      const msg = (typeof window.turnHandleBillingError==="function") ? window.turnHandleBillingError(billing) : billing.message;
      const e = new Error(msg || billing.message);
      e.billing = billing.code;
      throw e;
    }
    /* TOO LONG FOR THIS ENGINE (2026-10-14): the server refuses before any hold and says its limit — the prompt is
       fitted to it once more (nbFitImagePrompt) and sent again, which costs nothing; it is never put to the user */
    if(body && body.code==="prompt_too_long"){
      const lim = Math.floor(Number(body.limit)||0);
      if(!opts.__promptRefit && lim>=2000 && lim<prompt.length)
        return await proxyGenerate(prompt, { ...opts, __promptRefit:true, __promptLimit:lim }, provider);
      const e = new Error("This prompt was longer than "+nbModelLabel(model)+" takes, so nothing was sent and nothing was charged.");
      e.promptTooLong = true; e.code = "prompt_too_long";
      throw e;
    }
    if(status===401) throw new Error("Sign in to use server-side image generation \u2014 it runs on your server, not in the browser.");
    const _safe = window.turnSafeError || (x=>x);
    if(status===404) throw new Error(_safe("Image generation isn't available right now \u2014 it's waiting on a server update."));
    if(status===504) throw new Error("The image took longer than the server allows. Your chosen quality and resolution were kept \u2014 try again, or pick a faster setting if you prefer.");
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
    throw new Error(_safe("Couldn't reach the image service: "+((error && error.message) || "unknown error")+"."));
  }
  if(data && data.error){
    const _raw = String(data.error);
    // CONTENT-FILTER false positive: retry ONCE with benign-softened phrasing (e.g.
    // "gap-tooth" → "small gap between the front teeth"). Only rescues misclassified
    // legitimate content; genuinely prohibited prompts stay blocked and surface cleanly.
    if(!opts.noRetry && isGptImageModel(model) && !opts.__softened && (window.turnIsContentBlock ? window.turnIsContentBlock(_raw) : false)){
      const soft = (typeof softenImagePrompt==="function") ? softenImagePrompt(prompt) : null;
      if(soft && soft!==prompt){
        if(opts.metaOut) opts.metaOut.softened = true;
        return await proxyGenerate(soft, { ...opts, __softened:true }, provider);
      }
    }
    // provider error relayed by the proxy — attributed to the image model that asked
    const _mLbl = nbModelLabel(model);
    const _pe = new Error(window.turnAttrError
      ? window.turnAttrError("Image model", _mLbl, _raw)
      : (window.turnSafeError||(x=>x))(_raw));
    // a provider's own length refusal ("prompt: String should have at most 32000 characters") — the caller's
    // simplified retry takes it (artroom.jsx), as it takes "no image"
    if(nbIsPromptLengthError(_raw)) _pe.promptTooLong = true;
    throw _pe;
  }
  if(opts.metaOut && data && typeof data.grounded!=="undefined") opts.metaOut.grounded = !!data.grounded;
  if(data && data.usage && typeof window.dispatchEvent==="function")
    window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:data.usage }));
  // every image the server made, with what it cost (the server's own count when it sends one, else the
  // price table) — a Department Heads run adds these up for its "this run used" line (2026-10-09)
  if(data && (data.b64 || data.url) && typeof window.dispatchEvent==="function"){
    let cr = data.usage && Number(data.usage.credits);
    if(!(cr>0)){ try{ cr = nbImageCredits({ model, res:opts.res||opts.resolution, quality:opts.quality }); }catch(e){ cr = null; } }
    try{ window.dispatchEvent(new CustomEvent("nb-image-made",{ detail:{ credits:(cr>0 ? cr : null), model } })); }catch(e){}
  }
  // Provider-native landscape/portrait canvases are not always Kinolot's selected
  // ratio (GPT Image landscape is 3:2). Normalize BEFORE returning, so callers
  // can only commit a frame whose pixels match its 16:9 / 9:16 / 21:9 label.
  if(data && data.b64) return await cropImageToAspect("data:"+(data.mime||"image/png")+";base64,"+data.b64, aspect);
  if(data && data.url) return await cropImageToAspect(data.url, aspect);
  throw new Error("The proxy returned no image. Try simplifying the prompt.");
}
window.proxyGenerate = proxyGenerate;

/* call the selected image model; opts={model, aspectRatio}. resolves to a data URL or throws. */
let _nbDraftToastShown = false;
async function nbGenerate(prompt, opts){
  opts = opts || {};
  nbAssertMediaIdentity(opts, "image-submit");
  let model = nbCanonicalModelId(opts.model || nbGetModel());
  if(opts.model && opts.model!==model) opts = { ...opts, model };   // a retired engine's id (an old option) → its successor
  /* trial / no-plan accounts: draft images only — swap in the draft engine (and drop the
     GPT-only quality knob) rather than send a request the server will refuse */
  const choice = nbPlanImageChoice(model, opts.imageSize || nbGetRes());
  if(choice.limited){
    opts = { ...opts, model:choice.model, imageSize:choice.res };
    delete opts.quality;
    model = choice.model;
    if(!_nbDraftToastShown && typeof window.appToast==="function"){
      _nbDraftToastShown = true;
      window.appToast("Without a plan, images are drafts (Nano Banana 2.1 at 1K). Choose a plan for every image engine.","info");
    }
  }
  // Snapshot before any async reference conversion/capability check. A change
  // in the dock while this render runs belongs to a subsequent render.
  if(isGptImageModel(model)) opts={...opts,quality:opts.quality==null?nbGetOaiQuality(model):opts.quality};
  const provider = providerOfModel(model);
  /* dispatch to the server image broker. All current image models go through fal.ai
     first via the Supabase Edge Function; the direct browser Google path is retired
     for production reliability and key safety. */
  if(provider==="fal") return proxyGenerate(prompt, { ...opts, model }, "fal");
  if(provider==="openai") return proxyGenerate(prompt, { ...opts, model }, "openai");
  if(imageProxyOn()) return proxyGenerate(prompt, { ...opts, model }, provider);
  throw new Error("Image generation runs on the studio's servers \u2014 sign in to generate images.");
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

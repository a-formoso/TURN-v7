/* lookbook.jsx — The Art Room ▸ Lookbook (References).
   The front-of-pipeline visual brief: a north-star "visual statement" plus a grid of
   reference cards (palette / lighting / lens / texture touchstones), each with an
   AI-rendered mood frame. The Visual Researcher agent fills it from the story and writes
   its references through to the Colorist (Presets) so the look propagates downstream.
   Mirrors props.jsx / locations.jsx; reuses SheetFrame / SheetField / CardFold / useImageGen. */

const LOOKBOOK_CATEGORIES = ["Palette","Lighting","Lens & format","Texture & grain","Composition","Production design","Wardrobe","Atmosphere"];
window.LOOKBOOK_CATEGORIES = LOOKBOOK_CATEGORIES;

function lookbookSourceKey(c){
  return String((c&&c.source)||"")
    .toLowerCase()
    .replace(/\([^)]*\)/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}
window.lookbookSourceKey = lookbookSourceKey;

/* RECENTLY DELETED (owner 2026-10-03): a deleted reference stays IN the lookbook list, marked
   `deletedAt`, with its mood frame — the Show Bible keeps `lookbook` as a plain list, and an
   episode's `trash` may hold only shots, so the bin can't live in `trash`. Every reader goes
   through lookbookLive() (dedupeLookbookCards does it first); every write-back keeps the bin
   with lookbookKeepDeleted(). */
function lookbookLive(cards){ return (Array.isArray(cards)?cards:[]).filter(c=>c && typeof c==="object" && !c.deletedAt); }
function lookbookDeleted(cards){ return (Array.isArray(cards)?cards:[]).filter(c=>c && typeof c==="object" && c.deletedAt); }
/* `live` becomes the lookbook's live cards; the deleted ones of `all` stay (unless live again) */
function lookbookKeepDeleted(all, live){
  const liveIds = new Set((live||[]).map(c=>c && c.id));
  return [...(live||[]), ...lookbookDeleted(all).filter(c=>!liveIds.has(c.id))];
}
window.lookbookLive = lookbookLive;
window.lookbookDeleted = lookbookDeleted;
window.lookbookKeepDeleted = lookbookKeepDeleted;
/* WHEN TWO CARDS ARE THE SAME (2026-10-03): the same touchstone for the same category — so one
   source can feed two categories (Deakins for Lighting AND for Lens), and a card you added by hand
   is always its own (two "+" cards used to share the auto name "Palette study" and the second
   vanished from the grid). */
function lookbookCardKey(c){
  if(!c) return "";
  if(c.manual || c.autoNamed) return "id:"+String(c.id||"");
  const src = lookbookSourceKey(c);
  return src ? src+"|"+String(c.category||"Palette") : "id:"+String(c.id||"");
}
window.lookbookCardKey = lookbookCardKey;
function dedupeLookbookCards(cards){
  const out=[], pos=new Map();
  const hasImg = (c)=>{ try{ return !!(c && typeof nbGetImage==="function" && nbGetImage(c.id)); }catch(e){ return false; } };
  (Array.isArray(cards)?cards:[]).forEach(c=>{
    if(!c || typeof c!=="object" || c.deletedAt) return;      // Recently deleted (lookbookLive)
    const key = (typeof lookbookCardKey==="function") ? lookbookCardKey(c) : (lookbookSourceKey(c) || String(c.id||""));
    if(!key) return;
    if(pos.has(key)){
      const idx = pos.get(key), old = out[idx] || {};
      if((hasImg(c) && !hasImg(old)) || (!(old.note||"").trim() && (c.note||"").trim())) out[idx] = c;
      return;
    }
    pos.set(key, out.length);
    out.push(c);
  });
  return out;
}
window.dedupeLookbookCards = dedupeLookbookCards;

/* a reference is generatable once it has a "what to borrow" note — the note (the abstract
   visual quality) is what the mood frame is built from, never the named source IP. */
function lookbookCardDrafted(c){ return !!((c && (c.note||"")).trim()); }
window.lookbookCardDrafted = lookbookCardDrafted;

/* LOOKBOOK FIRST (2026-09-27, owner-approved — docs/Story Pipeline.md step 9): the Lookbook "has a look"
   (has something in it) once it holds a non-empty visual statement or at least one reference card. From
   then on the cast can be drafted FROM it — the silent cast auto-draft (app.jsx) waits for this, and the
   Characters tab shows a quiet "Build the Lookbook first" hint while it's still empty.
   A card counts as a reference once it holds something: a "what to borrow" note, a touchstone someone
   named (the Visual Researcher always names its cards), or an image. The blank card "+ Add reference"
   drops in (auto-named "Palette study", no note, no image) is a placeholder, not a reference — counting it
   drafted the cast from an EMPTY brief, which the first real note then flagged "Lookbook changed —
   re-draft": the double draft this rule exists to stop. */
function lookbookCardHasContent(c){
  if(!c || typeof c!=="object") return false;
  if(lookbookCardDrafted(c)) return true;
  if(!c.autoNamed && String(c.source||"").trim()) return true;
  try{
    if(c.id && typeof nbGetImage==="function" && nbGetImage(c.id)) return true;                      // its mood frame
    if(c.id && typeof nbGetSlotImage==="function" && nbGetSlotImage("lookref-"+c.id)) return true;    // a dropped image
    // …read from the <image-slot> store too (app/image-slot.js): the element above only exists while
    // the Lookbook tab is open, but the Art Room tab locks and the silent cast draft judge the look
    // from the other tabs. The store holds only the user's drops (data URLs).
    const stored = (c.id && typeof window!=="undefined" && typeof window.imageSlotStored==="function")
      ? window.imageSlotStored("lookref-"+c.id) : null;
    if(typeof stored==="string" && stored.startsWith("data:image/")) return true;
  }catch(e){}
  return false;
}
window.lookbookCardHasContent = lookbookCardHasContent;
function lookbookHasLook(lookbook, statement){
  if(String(statement||"").trim()) return true;
  // self-contained (tests lift this function out on its own): deleted cards (deletedAt) don't count
  return Array.isArray(lookbook) && lookbook.some(c=>c && !c.deletedAt && lookbookCardHasContent(c));
}
window.lookbookHasLook = lookbookHasLook;

function lookbookDefaultName(c){
  const category = String((c&&c.category)||"Visual").trim();
  const note = String((c&&c.note)||"").trim().replace(/\s+/g," ");
  if(!note) return category+" study";
  const words = note.split(" ").slice(0,5).join(" ").replace(/[.,;:!?]+$/,"");
  return category+" study — "+words;
}
window.lookbookDefaultName = lookbookDefaultName;

/* Mood-frame prompt: an ORIGINAL frame that captures the reference's visual LANGUAGE only
   (palette / lighting / lens / texture) — deliberately NOT a depiction of any named film,
   scene, character or logo, so it stays copyright-clean (same principle as the Colorist). */
/* the film's MEDIUM (2026-10-03): the dominant render style picked across its cast, props and
   locations (app.jsx sets window.turnFilmRenderStyle) — an animated film gets animated mood frames,
   not live-action ones. null = photoreal. */
function lookbookFilmMedium(){
  const st = (typeof window!=="undefined") ? window.turnFilmRenderStyle : null;
  return st && st.medium ? st : null;
}
window.lookbookFilmMedium = lookbookFilmMedium;
function buildLookbookPrompt(c, project){
  const P = project || (window.TURN_DATA||{}).PROJECT || {};
  const note = (c.note||"").replace(/\.$/,"").trim();
  const cat = (c.category||"Palette");
  const period = P.setting && P.setting.period ? P.setting.period.split(/[—,]/)[0].trim() : "";
  const tone = [P.genre, period].filter(Boolean).join(", ");
  let s = "Cinematic visual-reference frame.\n";
  s += "CATEGORY FOCUS: "+cat+".\n";
  if(note) s += "VISUAL QUALITY TO BORROW: "+note+".\n";
  if(tone) s += "PROJECT TONE: "+tone+".\n";
  s += "Create an ORIGINAL frame that expresses the selected category and visual quality above. ";
  s += "Translate the reference language only — palette, lighting, lens, texture and atmosphere — never its story content.\n";
  s += "Do NOT depict any specific recognizable film, scene, character, real person, logo or on-screen text; no words in the image.\n";
  const medium = lookbookFilmMedium();
  s += medium
    ? "RENDER IN THE FILM'S MEDIUM — "+medium.label+": "+medium.medium+". Evocative, filmic."
    : "Photoreal, evocative, filmic, shallow depth of field.";
  return s;
}
window.buildLookbookPrompt = buildLookbookPrompt;

function combinedLookbookPrompt(c, project){
  const master = buildLookbookPrompt(c, project);
  const neg = (c.negativePrompt || "text, words, captions, logo, watermark, recognizable real film still, celebrity likeness, distorted faces").trim();
  return master + " AVOID: " + neg.replace(/\.$/,"") + ".";
}
window.combinedLookbookPrompt = combinedLookbookPrompt;

function buildSimpleLookbookPrompt(c){
  const note = (c.note||"").replace(/\.$/,"").trim();
  const medium = lookbookFilmMedium();
  return ["Cinematic reference frame", (c.category||"").toLowerCase(), note||"",
    "original, no text, no recognizable film, "+(medium ? medium.label : "photoreal")+", atmospheric"].filter(Boolean).join(". ")+".";
}
window.buildSimpleLookbookPrompt = buildSimpleLookbookPrompt;


/* Write-through (legacy migration): the Lookbook's colorist brief now auto-fills the
   Presets references field DIRECTLY (plain text, no markers — see the write-through effect
   in app.jsx, ownership tracked via styleBible.lookbookSynced). An earlier version spliced
   it into styleBible.refs inside this delimited block; docs saved then still carry it, so
   mergeLookbookIntoRefs(refs, "") is kept as the strip the effect uses to lift the block
   back out of the manual refs. */
const LB_REFS_START = "[Lookbook references]";
const LB_REFS_END   = "[/Lookbook references]";
window.LB_REFS_START = LB_REFS_START;
window.LB_REFS_END = LB_REFS_END;
function mergeLookbookIntoRefs(existingRefs, lbText){
  const esc = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = String(existingRefs||"")
    .replace(new RegExp("\\n*"+esc(LB_REFS_START)+"[\\s\\S]*?"+esc(LB_REFS_END)+"\\n*", "g"), "\n")
    .trim();
  const lb = String(lbText||"").trim();
  if(!lb) return base;                                  // lookbook empty → only the manual refs
  const block = LB_REFS_START+"\n"+lb+"\n"+LB_REFS_END;
  return base ? base+"\n\n"+block : block;
}
window.mergeLookbookIntoRefs = mergeLookbookIntoRefs;

/* which reference categories feed which downstream department. A category may feed more than
   one. Each Art Room drafter pulls only its department's categories as a focused brief, so the
   one visual lookbook propagates to every department (not just colour). */
const LOOKBOOK_ROUTING = {
  colorist:   ["Palette", "Lighting", "Texture & grain", "Atmosphere"],
  characters: ["Wardrobe"],
  locations:  ["Production design", "Atmosphere"],
  props:      ["Production design"],
  shots:      ["Lens & format", "Composition", "Lighting"],
  // (no "storyboard": the boards are composed from the shot frames, so nothing there read these —
  //  it was only ever flagged out of date. Removed 2026-10-05, owner.)
};
window.LOOKBOOK_ROUTING = LOOKBOOK_ROUTING;
/* the departments a category's notes go to, by the names their tabs show (owner 2026-10-28) */
const LOOKBOOK_DEPT_NAMES = { colorist:"Color", characters:"Characters", locations:"Locations", props:"Props", shots:"Shots" };
/* the departments in words: "Color", "Color and Shots", "Color, Locations and Shots" */
function lookbookDeptsText(category){
  const d = lookbookDeptsFor(category);
  return d.length<2 ? (d[0]||"") : d.slice(0,-1).join(", ")+" and "+d[d.length-1];
}
/* a category as the dropdown shows it, with who reads its note: "Lighting \u2014 for Color and Shots" (owner 2026-10-28) */
function lookbookCategoryLabel(category){
  const who = lookbookDeptsText(category);
  return who ? category+" \u2014 for "+who : category;
}
function lookbookDeptsFor(category){
  return Object.keys(LOOKBOOK_ROUTING).filter(d=>LOOKBOOK_ROUTING[d].indexOf(category)>=0).map(d=>LOOKBOOK_DEPT_NAMES[d]||d);
}
window.lookbookDeptsFor = lookbookDeptsFor;

/* ONE HOME FOR REFERENCE IMAGES (owner 2026-10-29: the Color tab's stills merge into the Lookbook). An image you
   UPLOADED on a card whose category goes to Color (Palette, Lighting, Texture & grain, Atmosphere) is one of the
   Colorist's reference stills — its 384px copy and its sampled hues, exactly as the Color tab's stills were. A rendered
   preview is not (it was made from the note, which the Colorist reads already). Stills saved on the Color tab before
   keep working; the tab takes no new uploads. Up to 8 stills in all. */
function lookbookColorCards(lookbook){
  const cats = LOOKBOOK_ROUTING.colorist || [];
  return lookbookLive(lookbook).filter(c=> cats.indexOf(c.category||"Palette")>=0);
}
function lookbookCardUploaded(id){
  try{ const m = (typeof nbGetMeta==="function") ? nbGetMeta(id) : null; return !!(m && m.uploaded); }catch(e){ return false; }
}
/* how many of them are known now (the image store answers for what it has loaded — useLookbookColorStillCount loads them) */
function lookbookColorStillCount(lookbook){
  return lookbookColorCards(lookbook).filter(c=>{
    let has = false; try{ has = !!(typeof nbGetImage==="function" && nbGetImage(c.id)); }catch(e){}
    return has && lookbookCardUploaded(c.id);
  }).length;
}
async function lookbookColorStills(lookbook, max){
  const room = max==null ? 8 : max, out = [];
  for(const c of lookbookColorCards(lookbook)){
    if(out.length>=room) break;
    let url = "";
    try{ url = (typeof nbGetImage==="function" && nbGetImage(c.id)) || ""; if(!url && typeof nbLoadImage==="function") url = (await nbLoadImage(c.id)) || ""; }catch(e){}
    if(!url || !lookbookCardUploaded(c.id)) continue;
    const view = (typeof turnDownscaleDataUrl==="function") ? await turnDownscaleDataUrl(url, 384) : null;
    if(!view) continue;
    let colors = [];
    try{ colors = (typeof lookbookSampleHues==="function") ? await lookbookSampleHues(view) : []; }catch(e){}
    out.push({ id:"lb-"+c.id, view, colors, source:c.source||"", fromLookbook:true });
  }
  return out;
}
function useLookbookColorStillCount(lookbook){
  const cards = lookbookColorCards(lookbook), key = cards.map(c=>c.id).join("|");
  const [n, setN] = React.useState(()=>lookbookColorStillCount(lookbook));
  React.useEffect(()=>{
    let live = true;
    const check = async ()=>{
      for(const c of cards){ try{ if(!(typeof nbGetImage==="function" && nbGetImage(c.id)) && typeof nbLoadImage==="function") await nbLoadImage(c.id); }catch(e){} }
      if(live) setN(lookbookColorStillCount(lookbook));
    };
    check();
    window.addEventListener("nb-gen-done", check);
    return ()=>{ live = false; window.removeEventListener("nb-gen-done", check); };
  },[key]);
  return n;
}
window.lookbookColorStills = lookbookColorStills;
window.lookbookColorStillCount = lookbookColorStillCount;
window.useLookbookColorStillCount = useLookbookColorStillCount;

/* Creation provenance is deliberately assigned only at creation time. Legacy cards
   without an origin stay unknown — callers must never infer/backfill them later. */
function artRoomPropOrigin(kind, source){
  if(source==="screenplay") return { kind:"screenplay" };
  if(source==="manual") return { kind:"manual" };
  if(source==="character"){
    return { kind:(kind==="worn" || kind==="accessory") ? "costume" : "props" };
  }
  if(source==="design") return { kind:"props" };
  return { kind:"unknown" };
}
window.artRoomPropOrigin = artRoomPropOrigin;

/* Normalize the Props source-pill contract. `block` is intentionally 1-based for
   people/UI; ScriptView's data-sp-block-index is zero-based. */
function artRoomSourcePointer(mention){
  const m=mention||{}, source=(m.source&&typeof m.source==="object")?m.source:{};
  const oneBased=Number(m.block);
  return {
    sceneId:m.sceneId||m.scene_id||source.sceneId||"",
    sceneNo:Number(m.sceneNo||m.scene_no),
    title:String(m.title||m.sceneTitle||"").trim(),
    beat:Number(m.beat||m.beatN||m.beatNo||source.beatN),
    blockIndex:Number.isFinite(Number(m.blockIndex)) ? Number(m.blockIndex)
      : Number.isFinite(Number(m.sourceBlockIndex)) ? Number(m.sourceBlockIndex)
      : Number.isFinite(Number(source.blockIndex)) ? Number(source.blockIndex)
      : Number.isFinite(oneBased) && oneBased>0 ? oneBased-1 : NaN,
  };
}
window.artRoomSourcePointer = artRoomSourcePointer;

/* the lookbook brief for one department: the film's visual statement (north star) + the
   reference notes whose category routes to that department. Returns "" when there's nothing. */
function lookbookBriefFor(dept, lookbook, statement){
  const cats = LOOKBOOK_ROUTING[dept] || [];
  const lines = dedupeLookbookCards(lookbook)
    .filter(c=> cats.indexOf(c.category)>=0 && (c.note||"").trim())
    .map(c=> (c.source?c.source+" — ":"")+c.note.trim());
  const st = (statement||"").trim();
  if(!lines.length && !st) return "";
  return [st ? ("Overall look: "+st) : "", ...lines].filter(Boolean).join("\n");
}
window.lookbookBriefFor = lookbookBriefFor;

/* which departments are now out of date relative to the Lookbook: a dept is stale when it HAS
   drafted content (contentFlags[dept]) AND the current brief differs from the one last applied
   (applied[dept]). Scoped per-category by lookbookBriefFor, so editing a Palette card flags only
   the colorist, editing the statement flags everything. Returns { dept:true }. */
/* the fingerprint of a department's brief a drafted card records (owner 2026-10-06) */
function lookbookBriefStamp(brief){
  const t = String(brief||"").trim();
  return "lb-"+((typeof storyRevisionOf==="function") ? storyRevisionOf(t) : String(t.length));
}
window.lookbookBriefStamp = lookbookBriefStamp;
/* PER CARD (owner 2026-10-06 — Lookbook review): with `cardsByDept`, a department is out of date when
   one of its DRAFTED cards was drafted from an older brief — its own `lookbookBrief` stamp; a card the
   model drafted before stamps existed (writingProvenance, no stamp) follows the department record as
   before; a card written by hand is never flagged. Without `cardsByDept` (Color, Shots) the department
   rule stands. */
function lookbookStaleDepts(lookbook, statement, applied, contentFlags, cardsByDept){
  const out = {};
  Object.keys(LOOKBOOK_ROUTING).forEach(dept=>{
    const cur = lookbookBriefFor(dept, lookbook, statement);
    const was = (applied && applied[dept]) || "";
    const cards = cardsByDept && cardsByDept[dept];
    if(Array.isArray(cards)){
      const now = lookbookBriefStamp(cur);
      if(cards.some(c=>c && c.lookbookBrief && c.lookbookBrief!==now)){ out[dept] = true; return; }
      if(cards.some(c=>c && !c.lookbookBrief && c.writingProvenance) && cur!==was) out[dept] = true;
      return;
    }
    if(!(contentFlags && contentFlags[dept])) return;        // nothing drafted → nothing to be stale about
    if(cur !== was) out[dept] = true;
  });
  return out;
}
window.lookbookStaleDepts = lookbookStaleDepts;

/* how the Lookbook drives each tab — which of its categories feed this department and what they
   shape — so the banner can tell the user exactly what re-drafting will pull in (mirrors
   LOOKBOOK_ROUTING). */
const LOOKBOOK_DEPT_AFFECT = {
  characters: "Its Wardrobe references shape each character's costume, silhouette and styling.",
  props:      "Its Production design references shape each prop's materials, finish and period.",
  locations:  "Its Production design and Atmosphere references shape each location's architecture, materials, light and mood.",
  colorist:   "Its Palette, Lighting, Texture & grain and Atmosphere references shape the colour grade and film stock.",
  shots:      "Its Lens & format, Composition and Lighting references shape shot design and framing.",
};
window.LOOKBOOK_DEPT_AFFECT = LOOKBOOK_DEPT_AFFECT;

/* the in-tab banner: "the Lookbook changed since this was drafted" + how it drives THIS tab
   + [Re-draft only] [Re-draft & regenerate]. onDraftOnly (optional) re-drafts the specs from
   the updated Lookbook but leaves the generated images alone — for when you want the words
   updated now and the renders later. */
function LookbookStaleNotice({ stale, onApply, onDraftOnly, label, dept, applyLabel, applyTitle }){
  if(!stale) return null;
  const affect = LOOKBOOK_DEPT_AFFECT[dept] || "";
  return React.createElement("div",{className:"lb-stale-notice",role:"status"},
    React.createElement(Icon.alert,{s:14}),
    React.createElement("span",null,
      "The ",React.createElement("b",null,"Lookbook")," changed — re-draft "+(label||"this tab")+" to apply its references.",
      affect && React.createElement("span",{className:"lb-stale-affect"}, affect)),
    onDraftOnly && React.createElement("button",{className:"lb-stale-btn ghost",onClick:onDraftOnly,
      title:"Re-draft this tab's specs from the updated Lookbook — images stay as they are; regenerate them when you're ready"},
      React.createElement(Icon.sparkles,{s:12}),"Re-draft only"),
    // a tab whose action isn't a re-draft (Color: Light the film) names its own (2026-10-05)
    React.createElement("button",{className:"lb-stale-btn",onClick:onApply,title:applyTitle||"Re-draft this tab's specs from the updated Lookbook and regenerate its sheets"},
      React.createElement(Icon.sparkles,{s:12}),applyLabel||"Re-draft & regenerate"));
}
window.LookbookStaleNotice = LookbookStaleNotice;

/* headless mood-frame generation for the Visual Researcher agent (mirrors generatePropSheet) */
async function generateLookbookFrame(c, project){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // asset scope at generation start
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function") return false;
  const prompt = (typeof combinedLookbookPrompt==="function") ? combinedLookbookPrompt(c, project) : (c.source||"reference frame");
  if(!window.__nbGenInflight) window.__nbGenInflight = {};
  window.__nbGenInflight[c.id] = true;
  try{
    let url;
    try{ url = await nbGenerate(prompt, { assetId:c.id }); }
    catch(e){ if(/no image/i.test((e&&e.message)||"") && typeof buildSimpleLookbookPrompt==="function"){ url = await nbGenerate(buildSimpleLookbookPrompt(c), { assetId:c.id }); } else throw e; }
    const model = (typeof nbGetModel==="function") ? nbGetModel() : "";
    const now = new Date();
    const mEntry = (window.NB_MODELS||[]).find(m=>m.id===model) || {};
    const meta = { modelLabel:mEntry.label||"Nano Banana", modelId:model,
      aspect:(typeof nbGetAspect==="function"?nbGetAspect():"16:9"),
      // the size really rendered (Seedream 5 Pro renders a 4K pick at 2K — 2026-10-11)
      size:(typeof window.nbModelRes==="function" ? window.nbModelRes(model, (typeof nbGetRes==="function"?nbGetRes():"2K")) : (typeof nbGetRes==="function"?nbGetRes():"2K")),
      date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
      time: now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
      iso:now.toISOString(), prompt, mode:"final", version:1,
      writingSources:(c.writingProvenance&&c.writingProvenance.model)?[{...c.writingProvenance}]:[],
      promptCompiler:"Kinolot prompt compiler" };
    await nbCommit(c.id, url, meta, [], "asset", _ep);
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:c.id, url } })); }catch(e){}
    return true;
  } finally { window.__nbGenInflight[c.id] = false; }
}
window.generateLookbookFrame = generateLookbookFrame;

/* ---- one reference card ---- */
function LookbookCard({ c, project, onUpdate, onDelete, onView, batchActiveId, onBatchDone, onSuggestNote, suggesting, onNoteFromImage, reading }){
  const finalPrompt = combinedLookbookPrompt(c, project);
  const drafted = lookbookCardDrafted(c);
  const initials = (c.source||"Ref").replace(/^the\s+/i,"").split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const gen = useImageGen({
    id: c.id, slotId: "lookref-"+c.id,
    entity: c,
    buildFinal: ()=> finalPrompt,
    buildSimple: ()=> buildSimpleLookbookPrompt(c),
    buildEdit: (instr)=>
      "Edit this reference frame. Apply ONLY this change: "+instr+". "
      +"Keep the same visual language — palette, lighting, lens, texture — in the same single frame. "
      +"No text, no recognizable film or person.",
  });
  // (a card you added by hand keeps a name that follows its category and note — app.jsx updateLookbookCard)
  const update = (patch)=>onUpdate(c.id, patch);
  // AN UPLOAD, STEP BY STEP (owner 2026-10-28): an image you uploaded with no note yet → 1 pick the category it's a
  // reference for (a card you added by hand, until you pick one), 2 Write the note from the image. The step you're on
  // is highlighted; a researched card already has its category, so it starts at step 2.
  const uploaded = !!(gen.genUrl && gen.genMeta && gen.genMeta.uploaded);
  const step = (uploaded && !drafted && onNoteFromImage) ? ((c.manual && !c.categoryPicked) ? 1 : 2) : 0;
  const stepN = (n)=> step ? React.createElement("span",{className:"lb-step-n"+(step===n?" on":step>n?" done":"")},step>n?"\u2713":String(n)) : null;
  const askDelete = async ()=>{
    const ok = !window.appConfirm || await window.appConfirm({
      title:"Delete “"+(c.source||"this reference")+"”?",
      body:"It moves to Recently deleted, with its mood frame, at the bottom of the Lookbook. You can restore it from there.",
      confirmLabel:"Delete reference", cancelLabel:"Cancel", danger:true });
    if(ok) onDelete(c.id);
  };

  // REMOUNT-SAFE (see CharacterSheet): seed batchStarted from the in-flight registry
  // (keyed by the GEN id, c.id) so a card remounting mid-generation doesn't fire a
  // second generate on completion — this card previously had no such guard at all.
  const batchStarted = React.useRef(!!(window.__nbGenInflight && window.__nbGenInflight[c.id]));
  const wasGening = React.useRef(false);
  React.useEffect(()=>{
    const mine = batchActiveId===c.id;
    const inflight = !!(window.__nbGenInflight && window.__nbGenInflight[c.id]);
    if(!mine){ batchStarted.current=inflight; wasGening.current=gen.gening; return; }
    if(!batchStarted.current && !gen.gening && !inflight){ batchStarted.current=true; wasGening.current=false; gen.generate(); return; }
    if(batchStarted.current && wasGening.current && !gen.gening){ batchStarted.current=false; onBatchDone && onBatchDone(c.id); }
    wasGening.current = gen.gening;
  },[batchActiveId, gen.gening, c.id]);

  return React.createElement("div",{className:"sheet-card lb-card"+(batchActiveId===c.id?" batch-on":""),"data-look-card":c.id},
    React.createElement(SheetFrame,{ gen, slotId:"lookref-"+c.id, name:c.source||"Reference", avatarColor:"#6b7280",
      initials, drafted, drafting:false, onDraft:()=>{}, entity:c, onView,
      // ONE SLOT, NEWEST WINS (owner 2026-10-28): your own reference image (drop it, browse, or ⋯ Replace with upload)
      // or a rendered preview — whichever came last. The note below is what the departments read; an UPLOADED image on a
      // card that goes to Color is also one of the Colorist's reference stills (lookbookColorStills, owner 2026-10-29)
      slotPlaceholder:"Drop a reference image, or render a preview", noun:"image",
      dropToImport:true,
      // no note yet: the button stays greyed out and says what to do — the Lookbook has no "specification" (owner 2026-10-28)
      specGate:{ ready:drafted, hint:"Add a ‘what to borrow’ note first — it's what the preview is built from.",
        label:"Write or suggest a note first",
        title:"A preview is built from the card's ‘what to borrow’ note: write it below, or use Suggest a note. Have a picture of the look instead? Drop it in the slot above." },
      onDelete:askDelete, deleteLabel:"Delete reference" }),
    React.createElement("div",{className:"sheet-body"},
      React.createElement("div",{className:"sheet-head"},
        React.createElement("div",{style:{flex:1,minWidth:0}},
          React.createElement("div",{className:"sheet-name"},
            React.createElement(EditText,{value:c.source||lookbookDefaultName(c),placeholder:"Reference — film, cinematographer, palette…",
              onCommit:val=>{ const clean=String(val||"").trim(); onUpdate(c.id,clean
                ? {source:clean,autoNamed:false}
                : {source:lookbookDefaultName(c),autoNamed:true}); }})))),

      // an uploaded image with no note still says so: the image alone reaches no department
      !drafted && (!gen.genUrl || (gen.genMeta && gen.genMeta.uploaded)) && React.createElement("div",{className:"sheet-undrafted"},
        React.createElement(Icon.alert,{s:14}),
        step
          ? React.createElement("span",{"data-testid":"lb-steps"},"Your image is in. Two steps turn it into a reference: ",
              React.createElement("b",{className:step===1?"lb-step-now":""},"1 \u00b7 pick the category it's a reference for"),", then ",
              React.createElement("b",{className:step===2?"lb-step-now":""},"2 \u00b7 Write the note from the image"),". The note is what the departments read.")
          : React.createElement("span",null,"No ‘what to borrow’ note yet — add one below, upload an image of the look, or let Suggest a note write it. The note is what the departments read.")),

      React.createElement(CardFold,{label:"Reference",defaultOpen:true},
        React.createElement("div",{className:"sheet-field"+(step===1?" lb-step-on":""),"data-testid":"lb-category"},
          React.createElement("div",{className:"obj-lab"},stepN(1),"Category"),
          // step 1: no category shown yet, so picking any one — Palette too — counts as your choice
          // where a note goes is INSIDE the dropdown (owner 2026-10-28): each category names the departments that read
          // its note ("Lighting \u2014 for Color and Shots"), so you see it while choosing; the preview image goes nowhere
          React.createElement("select",{className:"prop-select","data-testid":"lb-category-select",value:step===1 ? "" : (c.category||"Palette"),
            title: step===1 ? "The category decides which departments read the note"
              : "Its note goes to "+(lookbookDeptsText(c.category||"Palette")||"no department"),
            onChange:e=>update({category:e.target.value, categoryPicked:true})},
            step===1 && React.createElement("option",{key:"",value:"",disabled:true},"Choose what this image is a reference for\u2026"),
            (window.LOOKBOOK_CATEGORIES||[]).map(cat=>React.createElement("option",{key:cat,value:cat},lookbookCategoryLabel(cat))))),
        React.createElement(SheetField,{label:"What to borrow — the visual quality",value:c.note,multiline:true,
          placeholder:"The palette / lighting / lens / texture to draw from — abstract qualities, not the source's scenes…",
          onCommit:val=>update({note:val})}),
        // one writing call (about a credit): drafts this card's note — and its touchstone when you
        // added the card by hand and haven't named one
        // the note's buttons on ONE row, sized like the Characters card's "Suggest from script" / "Add state" (owner 2026-10-28)
        ((onNoteFromImage && uploaded) || onSuggestNote) && React.createElement("div",{className:"lb-note-actions"},
        // NOTE FROM AN IMAGE (owner 2026-10-28): only for an image you uploaded (reading back a preview made from the
        // note would go in a circle) — one vision call; the note it writes stays editable
        onNoteFromImage && uploaded && React.createElement("button",{type:"button",className:"lb-suggest"+(step===2?" lb-step-on":""),"data-testid":"lb-note-from-image",
          disabled:!!reading||!!suggesting||gen.gening||step===1,
          title: step===1 ? "Pick the category first — the note is written for it."
            : "Write this reference's ‘what to borrow’ note from the image you uploaded"+(c.autoNamed?" (and name the card)":"")+" — one vision call. You can edit the note afterwards.",
          onClick:()=>onNoteFromImage(c.id, gen.genUrl)},
          stepN(2) || React.createElement(Icon.image,{s:12}), reading ? "Reading the image…" : ((c.note||"").trim() ? "Rewrite the note from the image" : "Write the note from the image")),
        onSuggestNote && React.createElement("button",{type:"button",className:"lb-suggest",disabled:!!suggesting||!!reading,
          title:"Write this reference's ‘what to borrow’ note from the story"+(c.autoNamed?" (and suggest a touchstone)":"")+" — one writing call",
          onClick:()=>onSuggestNote(c.id)},
          React.createElement(Icon.sparkles,{s:12}), suggesting ? "Suggesting…" : ((c.note||"").trim() ? "Suggest another note" : "Suggest a note"))),
        // an editable setting that changes the frame: on the card, not behind the prompt (2026-10-05)
        React.createElement(SheetField,{label:"Leave out (negative prompt)",value:c.negativePrompt||"",placeholder:"e.g. text, logos, people",
          onCommit:val=>onUpdate(c.id,{negativePrompt:val})})),

      // read-only, a folded section of every card (owner 2026-10-28)
      React.createElement(CardFold,{label:"Preview prompt",defaultOpen:false},
        React.createElement(CopyBox,{label:"Preview frame — feed to your image tool",text:finalPrompt}))));
}

/* ---- the Lookbook tab ---- */
/* which references already have a mood frame — read from the image store (async in the cloud),
   refreshed whenever a frame lands */
function useLookbookFramed(ids){
  const [framed, setFramed] = React.useState({});
  const key = ids.join("|");
  React.useEffect(()=>{
    let live = true;
    const check = async ()=>{
      const next = {};
      for(const id of ids){
        let u = "";
        try{ u = (typeof nbGetImage==="function") ? nbGetImage(id) : ""; }catch(e){}
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id); }catch(e){} }
        next[id] = !!u;
      }
      if(live) setFramed(next);
    };
    check();
    const onDone = ()=>check();
    window.addEventListener("nb-gen-done", onDone);
    return ()=>{ live = false; window.removeEventListener("nb-gen-done", onDone); };
  },[key]);
  return framed;
}
function LookbookView({ project, lookbook, note, readOnly, onUpdate, onAdd, onDelete, onSetNote, onResearch, onResearchFresh, onRestore, onPurge, onSuggestNote, suggestingId, onNoteFromImage, readingImageId }){
  const [view, setView] = React.useState(null);
  const [researchMenu, setResearchMenu] = React.useState(false);
  const batch = useBatchGen();
  const batchActiveId = batch.activeId;
  const list = dedupeLookbookCards(lookbook || []);
  const deleted = lookbookDeleted(lookbook || []).map(c=>({ ...c, name:c.source||"Reference", _deletedAt:c.deletedAt }));
  const pendingAddedId = React.useRef("");
  const addReference = ()=>{
    const id = onAdd && onAdd();
    if(id) pendingAddedId.current=id;
  };
  React.useEffect(()=>{
    const id=pendingAddedId.current;
    if(!id || !list.some(c=>c.id===id)) return;
    pendingAddedId.current="";
    requestAnimationFrame(()=>{
      const card=document.querySelector('[data-look-card="'+id+'"]');
      if(card) card.scrollIntoView({behavior:"smooth",block:"center"});
    });
  },[list.map(c=>c.id).join("|")]);
  React.useEffect(()=>{
    if(!researchMenu) return;
    const close = (e)=>{ if(e.type==="keydown" && e.key!=="Escape") return; if(e.type==="pointerdown" && e.target.closest && e.target.closest(".lb-research")) return; setResearchMenu(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return ()=>{ document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  },[researchMenu]);
  // GENERATE MISSING FRAMES (2026-10-03): only the references with a note and no frame yet — a
  // frame you already have is re-rendered from its own card, never by the batch — and the
  // button's price is for all of them
  const drafted = list.filter(c=>lookbookCardDrafted(c));
  const framed = useLookbookFramed(drafted.map(c=>c.id));
  const missing = drafted.filter(c=>!framed[c.id]);
  const startMissingBatch = ()=>{
    if(batchActiveId) return;
    if(!drafted.length){ batch.setMsg("Add a ‘what to borrow’ note to a reference first — nothing is ready to render yet."); return; }
    if(!missing.length){ batch.setMsg("Every reference with a note already has its preview — re-render one from its card."); return; }
    batch.begin(missing.map(c=>c.id), list.length - missing.length);
  };
  // the look is there already: "Research again" offers to fill the gaps or start fresh
  const hasResearch = !!String(note||"").trim() || list.some(c=>!c.manual && !c.autoNamed);

  return React.createElement("div",{className:"art-scroll"},
    view && React.createElement(ImageLightbox,{url:view.url,character:view.character,onClose:()=>setView(null)}),
    React.createElement(NbKeyBar,null),
    React.createElement(NbControls,null),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement(window.ArtDeptTitle||"div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Visual Researcher",
            React.createElement(window.InfoTip,{label:"About the Lookbook",
              text:"The film's visual north star, built first so it can steer everything downstream. A short visual statement plus reference touchstones — palette, lighting, lens, texture, wardrobe, production design. The statement and each card's note are what the departments read: the category decides where a note goes (Color, Characters, Locations, Props, Shots). Drop in a picture of the look and 'Write the note from the image' turns it into words, or render an optional preview from the note. A picture you drop on a Palette, Lighting, Texture & grain or Atmosphere card is also shown to the Colorist when it lights the film (a rendered preview isn't — it was made from the note); no other department is sent a card's image. 'Research the look' writes the statement and gathers the references."}))),
        React.createElement("div",{className:"art-intro-actions"},
          // the header's "+" (add a reference by hand) went (owner 2026-10-21); an empty Lookbook keeps "Add by hand"
          onResearch && (hasResearch && onResearchFresh
            ? React.createElement("div",{className:"lb-research"},
                React.createElement("button",{className:"art-draftall ghost secondary",onClick:()=>setResearchMenu(v=>!v),"aria-haspopup":"menu","aria-expanded":researchMenu?"true":"false",
                  title:"Run the Visual Researcher again"},
                  React.createElement(Icon.robot,{s:14}),"Research again",React.createElement(Icon.chevD,{s:12})),
                researchMenu && React.createElement("div",{className:"lb-research-menu",role:"menu"},
                  React.createElement("button",{type:"button",role:"menuitem",onClick:()=>{ setResearchMenu(false); onResearch(); }},
                    React.createElement("b",null,"Fill the missing categories"),
                    React.createElement("span",null,"Keeps the statement and every card; adds one reference for each category that has none.")),
                  React.createElement("button",{type:"button",role:"menuitem",onClick:()=>{ setResearchMenu(false); onResearchFresh(); }},
                    React.createElement("b",null,"Research from scratch"),
                    React.createElement("span",null,"Writes a new statement and new references. Your hand-added cards stay; the researched ones move to Recently deleted."))))
            : React.createElement("button",{className:"art-draftall",onClick:onResearch,
                title:"Visual Researcher — writes the look statement and gathers reference touchstones"},
                React.createElement(Icon.robot,{s:14}),"Research the look")),
          // OPTIONAL PREVIEWS (owner 2026-10-28): a quiet extra, never a to-do — nothing downstream uses the images,
          // so the button only shows while some noted card has none (and says so)
          (missing.length>0 || batchActiveId) && React.createElement("button",{className:"art-draftall ghost","data-testid":"lb-previews",
            disabled:!!batchActiveId,onClick:startMissingBatch,
            title:"Optional: render a preview image for each reference that has a note and no preview yet ("+missing.length+"). Only for you to see the look — no department uses the images."},
            React.createElement(Icon.sparkles,{s:14}),
            batchActiveId ? "Rendering…" : "Preview the look",
            missing.length>0 && typeof window.nbCostChip==="function" && window.nbCostChip(missing.length)),
          // YOUR OWN REFERENCE (owner 2026-10-28): a "+" at the end of the header's row, as tall as its neighbours (just the
          // sign — its name is in the tooltip and for screen readers), adds a card by hand — a touchstone you choose, in one
          // of the categories (the category still decides which departments read its note). Once there are cards; the
          // empty Lookbook keeps its own "Add by hand"
          list.length>0 && !readOnly && onAdd && React.createElement("button",{type:"button",className:"art-draftall ghost lb-add","data-testid":"lb-add",onClick:addReference,
            "aria-label":"Add a reference",
            title:"Add a reference — upload an image of the look or name a touchstone, pick its category, write what to borrow"},
            React.createElement(Icon.plus,{s:16}))))),

    // the north-star visual statement
    React.createElement("div",{className:"lb-statement"},
      React.createElement(SheetField,{label:"Visual statement — the film's north star",value:note||"",multiline:true,
        placeholder:"How the whole film should LOOK and FEEL — palette, light, texture — in two or three sentences. Run ‘Research the look’ to draft it.",
        onCommit:val=>onSetNote&&onSetNote(val)})),

    BatchBar && React.createElement(BatchBar,{batch,noun:"frame"}),

    list.length
      ? React.createElement("div",{className:"sheet-grid"},
          list.map(c=>React.createElement(LookbookCard,{key:c.id,c,project,onUpdate,onDelete,
            onView:(url,ent)=>setView({url,character:ent}),batchActiveId,onBatchDone:batch.advance,
            onSuggestNote, suggesting:suggestingId===c.id, onNoteFromImage, reading:readingImageId===c.id})))
      : React.createElement("div",{className:"prop-empty"},
          React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.image,{s:30})),
          React.createElement("div",{className:"art-soon-t"},"No references yet"),
          React.createElement("div",{className:"art-soon-d"},"Build the film's visual brief first — ‘Research the look’ writes the statement and gathers reference touchstones (palette, lighting, lens, texture). Their notes steer every department; preview images are optional. Or add one by hand."),
          React.createElement("div",{style:{display:"flex",gap:8,marginTop:16}},
            onResearch && React.createElement("button",{className:"art-draftall",onClick:onResearch},
              React.createElement(Icon.robot,{s:14}),"Research the look"),
            React.createElement("button",{className:"art-draftall ghost",onClick:addReference},
              React.createElement(Icon.plus,{s:14}),"Add by hand"))),
    // the restore bin (Restore / Delete forever), like Characters, Props and Locations
    deleted.length>0 && window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{
      items:deleted, kind:"reference", onRestore, onPurge }));
}
window.LookbookView = LookbookView;

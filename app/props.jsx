/* props.jsx — The Art Room ▸ Props tab.
   Continuity objects (worn or carried) get their own reference sheet so an object
   looks identical in every shot it appears in. Mirrors the Character Sheets flow:
   each prop card has Draft (the writing model fills form/material/detail from the script) and
   Generate (the image model → a 4-panel object sheet). Reuses the shared
   useImageGen hook + SheetFrame so the generation machinery stays in one place. */

/* Prop prompt: a structured 4-panel object sheet (hero / front / side / detail, off-white
   background, soft contact shadow) \u2014 see combinedPropPrompt. The photo-based prompt and the
   simplified retry use the same layout and background. The render style comes from the
   card's dropdown (photoreal default). Owner
   matching is no longer carried in the prompt text \u2014 a worn/owned prop's OWNER character
   sheet rides in as a REFERENCE IMAGE (see generatePropSheet / the card's attachments)
   plus propOwnerNote, which matches the prop to the character far better than a text tag. */
/* the style KEY a prop inherits when its card has NO explicit pick: its OWNER's style
   (a worn/carried object lives in the owner's world — the owner-sheet reference image
   already says "match this character", so the TEXT must agree), else — for ownerless
   set dressing — the style of the location it's a fixture of (explicit locationId, or
   every mapped scene resolving to one place), else "" (the shared default applies).
   Explicit picks (p.renderStyleKey) and hand-edited text (p.renderStyle) always win. */
function propInheritedStyleKey(p){
  try{
    const C = window.turnContinuity || {};
    if(p && p.ownerId){
      const c = (C.characters||[]).find(x=>x && x.id===p.ownerId);
      if(c){
        const k = (typeof inferCharacterRenderStyleKey==="function") ? inferCharacterRenderStyleKey(c) : (c.renderStyleKey||"");
        if(k && k!=="surprise") return k;
      }
      return "";
    }
    const loc = propHomeLocation(p);
    if(loc && loc.renderStyleKey && loc.renderStyleKey!=="surprise") return loc.renderStyleKey;
  }catch(e){}
  return "";
}
window.propInheritedStyleKey = propInheritedStyleKey;

/* "(Proposal)" / "[Proposal]" labels (owner 2026-10-29): the prop drafter was told unspecified design is a "PROPOSAL" and
   wrote the word into the fields — it never reaches a prompt or the card (stored text is left as it is) */
function propSpecClean(t){
  return String(t==null?"":t).replace(/\s*[\(\[]\s*proposal(?:ed)?\s*[\)\]]\s*[:\-\u2013\u2014]?\s*/gi," ").replace(/^\s*proposal(?:ed)?\s*[:\u2014\u2013-]\s*/i,"").replace(/\s{2,}/g," ").trim();
}
window.propSpecClean = propSpecClean;
function buildPropRefPrompt(p, project){
  const clean = (x)=>propSpecClean(x).replace(/\.$/,"").trim();
  const name = p.name || "Object";
  const form = clean(p.form);
  const material = clean(p.material);
  const detail = clean(p.signatureFeature); // narrative meaning is not a physical mark
  const relation = clean(p.relation);   // how the owner relates to it — drives wear & condition
  const externalRefs = Array.isArray(p.referenceImages) ? p.referenceImages.filter(r=>r&&r.url) : [];
  const _size = clean(p.size);
  const scale = p.kind==="worn" ? ("wearable, true-to-body scale"+(_size?(", "+_size):""))
              : p.kind==="carried" ? ("handheld scale"+(_size?(", "+_size):""))
              : p.kind==="dressing" ? ("environment fixture at true physical scale"+(_size?(": "+_size):" as described"))
              : (_size ? ("true physical size: "+_size) : "true real-world scale as described");
  // render style: card dropdown / Surprise me → hand-edited text → INHERITED from the
  // owner (or fixture location) when the card was never touched → shared default
  const _styleKey = p.renderStyleKey || propInheritedStyleKey(p);
  const styleText = (p.renderStyleKey==="surprise" && p.surpriseRender && p.surpriseRender.style)
    ? p.surpriseRender.style
    : (clean(p.renderStyle)
       || (typeof window.renderStyleText==="function" ? window.renderStyleText("prop", _styleKey) : (window.PROP_RENDER_TEXT||{})[_styleKey||(window.turnDefaultRenderStyleKey?window.turnDefaultRenderStyleKey():"photoreal")])
       || (window.PROP_RENDER_TEXT||{}).photoreal || "hyper realistic photography, photorealistic 8k");
  // off-white / light-neutral background with a soft contact shadow (matches the cast sheets)
  const bg = "flat off-white / very light neutral panel background, even and clean, with a simple soft contact shadow beneath the object";
  // 4-PANEL object reference sheet: hero, front, side and detail, thin dividers,
  // 16:9, no baked text. The old "360 turnaround + 3-up detail column" is folded
  // into binding CONTINUITY fields (material / signature feature) so every panel
  // stays faithful without extra panels.
  const spec = {
    subject: name + (form ? (", "+form) : ""),
    object: {
      form: form || undefined,
      material: material || undefined,
      signature_feature: detail || undefined,
      owner_relationship: relation || undefined,
      document_or_screen_content: clean(p.contentNotes) || undefined,
      content_version: clean(p.contentVersion) || undefined,
      measurement_basis: p.sizeBasis || "estimated — verify before fabrication or Blender reconstruction",
      scale: scale,
      scale_against_owner: (p.ownerId && clean(p.scale)) || undefined,
    },
    layout: {
      format: "a 4-panel object reference sheet in 16:9 landscape: four EQUAL-width tall vertical panels divided by thin clean vertical lines \u2014 hero, front, side and detail; the SAME object throughout",
      panels_left_to_right: [
        "PANEL 1 \u2014 large HERO three-quarter view of the object, its most identifying angle, filling the panel, the exact identity anchor (approximately "+scale+")",
        "PANEL 2 \u2014 straight-on FRONT elevation of the whole object, sharing a baseline with the side view in panel 3",
        "PANEL 3 \u2014 SIDE PROFILE view rotated 90\u00b0 from the front, showing the object's true depth and thickness, at the SAME size and baseline as the front view",
        "PANEL 4 \u2014 DETAIL macro close-up "+(detail?("of its signature feature \u2014 "+((typeof clipWords==="function")?clipWords(detail,70):detail.slice(0,70))+" \u2014 and its "):"of the object's ")+"material & construction: fastenings, joins, edges, surface finish and wear"
      ],
      panel_widths: "all four panels are EQUAL width \u2014 a clean, evenly divided turnaround, NOT a wider hero panel (each whole-object view needs comparable readable space)",
      one_object_rule: "EXACTLY ONE object per panel \u2014 no duplicates, no exploded parts, no alternate colourways, no accessories that aren't part of the object itself",
      scale_rule: "the FRONT (panel 2) and SIDE (panel 3) views are the SAME size and share a baseline; the hero and detail panels may frame the object differently",
      no_extra_views: "do not add a BACK view, extra turnaround angles, exploded diagrams, rulers, dimension lines, captions, labels, title text, measurement text, or ANY info box (no name, size or material printed on the image \u2014 that metadata travels in the prompt, never baked into pixels)",
      background: bg
    },
    continuity: {
      identity_rule: "the SAME identical object \u2014 form, colour, materials, wear and construction \u2014 in every view",
      material_rule: material ? ("rendered in "+material+", with accurate surface texture and finish in every panel") : "accurate, consistent material and finish in every panel",
      feature_rule: detail ? ("its signature feature \u2014 "+((typeof clipWords==="function")?clipWords(detail,90):detail.slice(0,90))+" \u2014 present and consistent in every view") : undefined,
      relationship_rule: relation ? ("the owner's relationship to it \u2014 "+((typeof clipWords==="function")?clipWords(relation,90):relation.slice(0,90))+" \u2014 is visible in its condition: wear, repairs, handling marks and how carefully it has been kept") : undefined,
      harvested_reference_rule: externalRefs.length ? ("Use the attached selected-item/whole-sheet reference image"+(externalRefs.length>1?"s":"")+" as world-consistency guidance for this object's design language, material wear, likeness when the prop depicts a person, lighting feel and belonging in the same film world; do not copy unrelated surrounding scenery from the source image.") : undefined,
    },
    render: {
      style: styleText,
      aspect: "16:9",
      rules: [p.contentNotes ? "Preserve the specified writing or screen content ON the object. No added sheet labels, captions, watermarks or measurement annotations. Do not invent missing wording. Critical legibility must be checked after generation." : "No added sheet labels, watermarks, annotations or captions. Preserve any established markings on the object itself; do not invent document text.",
              "accurate material rendering, natural surface textures, soft studio lighting",
              "consistent object design, materials and lighting across all panels",
              "clean, evenly divided panel layout"],
    },
    style_name: ((p.renderStyleKey==="surprise" && p.surpriseRender && p.surpriseRender.label)
      ? p.surpriseRender.label
      : (((typeof window.renderStylePromptName==="function") ? window.renderStylePromptName(_styleKey||"photoreal") : (window.RENDER_STYLE_LABELS||{})[_styleKey||"photoreal"]) || undefined)),
  };
  return "Render this object reference sheet EXACTLY as specified by this JSON spec (continuity fields are binding):\n"+JSON.stringify(spec, null, 1);
}
window.buildPropRefPrompt = buildPropRefPrompt;

/* ---- derive standalone prop cards from the cast's existing per-character
   "Props & accessories" fields (c.accessories = worn, c.props = carried),
   which the cast's visual draft fills in the Art Room (the story build no longer
   drafts the cast's look — docs/Story Pipeline.md, 2026-09-27). Splits multi-item
   fields, assigns the owner, and dedups against props already in the tab so
   re-running never creates duplicates. No AI / no pipeline step — it just
   surfaces data the character sheets already hold. */
function propSlug(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40); }
function splitPropItems(text, opts){
  let s = String(text||"");
  // Protect parenthetical clauses so the delimiters INSIDE them (commas, dashes,
  // "and", etc.) don't shred one item into fragments like "Aud" or "possessive)".
  const stash = [];
  s = s.replace(/\([^()]*\)/g, m=>{ stash.push(m); return "\u0000"+(stash.length-1)+"\u0000"; });
  // ONE ITEM KEEPS ITS COMMAS (2026-10-05): when the list is separated by semicolons, bullets or
  // lines, commas belong INSIDE items ("a steel wristwatch with a cracked, heat-fogged crystal") —
  // splitting on them too made two cards of one watch. Comma-only lists still split on commas.
  // opts.legacyComma: the old always-comma split (only to repair cards it made).
  const strong = !(opts && opts.legacyComma) && /[;·•\n]/.test(s);
  return s
    .split(strong ? /\s*(?:;|·|•|\n)\s*/ : /\s*(?:,|;|·|•|\n)\s*/)
    .map(part=> part.replace(/\u0000(\d+)\u0000/g, (_,i)=> stash[+i]||"") )   // restore parens
    .map(x=> x.replace(/\.$/,"").trim())
    .map(x=> x.replace(/^[)\]\u2014\u2013\-\s]+/,"").trim())                  // drop leading stray bracket/dash debris
    .map(x=> x.replace(/^(?:and|then|&)\s+/i,"").trim())                      // a prose split leaves "and a ..." — drop the conjunction
    .map(x=> /^\([^)]*$/.test(x) ? x+")" : x)                                 // close a dangling "(unfinished"
    .filter(x=> x && x.replace(/[^a-z0-9]/gi,"").length>1                     // need real content, not just punctuation
      && !/^(none|n\/a|nil|various|misc\.?|etc\.?)$/i.test(x))
    .reduce((acc, x, i, arr)=> _mergeDanglingFragment(acc, x, i, arr, !!(opts && opts.legacyComma)), []);
}
/* "A thin, unpolished silver band" splits into "A thin" + "unpolished silver band" —
   the first fragment is an article + bare descriptor with no object in it, so it
   belongs to the item that follows. Re-join it. */
function _mergeDanglingFragment(acc, x, i, arr, legacy){
  const prev = acc[acc.length-1];
  const dangling = (s)=> /^(?:a|an|the)\s+\w+$/i.test(String(s||"").trim())
    && !(typeof propHeadNoun==="function" && propHeadNoun(s));
  // …and a fragment that ENDS mid-phrase: "a steel wristwatch with a cracked" + "heat-fogged
  // crystal" — a trailing "with/of/in… (a) <word>" whose last word is no object, followed by a
  // piece that doesn't start a new item (no leading a/an/the/his/her…), is one item (2026-10-05)
  const tail = (s)=>{ const m = String(s||"").trim().match(/\b(?:with|of|in|on|from|under|over)\s+(?:a|an|the|its|his|her|their)?\s*([a-z][a-z-]*)$/i);
    return !!m && !(typeof propHeadNoun==="function" && propHeadNoun(m[1])); };
  const startsItem = (s)=> /^(?:a|an|the|his|her|their|its|one|two|three|some)\b/i.test(String(s||"").trim());
  // legacy: reproduce the OLD split exactly (to find the cards it made) — no tail rule
  if(prev!==undefined && (dangling(prev) || (!legacy && tail(prev) && !startsItem(x)))){ acc[acc.length-1] = prev+", "+x; return acc; }
  acc.push(x); return acc;
}
window._mergeDanglingFragment = _mergeDanglingFragment;
/* classify a prop as worn vs carried FROM ITS NAME, independent of which character
   field it was filed under. The visual-bible AI sometimes mis-files a handheld object
   (a phone, a gun) under a character's worn "accessories", or vice-versa; this is the
   sanity check propsFromCast lacked. Returns "carried" | "worn" | "" (unsure → keep
   the source field's kind). Only fires on UNAMBIGUOUS nouns so a deliberate choice is
   never second-guessed. */
/* word-boundary search match — the query must begin a WORD in the text (case-insensitive),
   so single letters / mid-word fragments don't match noise (e.g. "h" ≠ "throat"). Shared by
   the Props / Characters / Locations search boxes. */
function searchWordMatch(text, q){
  q = String(q||"").trim().toLowerCase(); if(!q) return true;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try{ return new RegExp("\\b"+esc, "i").test(String(text||"")); }
  catch(e){ return String(text||"").toLowerCase().indexOf(q)>=0; }
}
window.searchWordMatch = searchWordMatch;

const PROP_CARRIED_WORDS = ["phone","mobile","cellphone","cell phone","smartphone","iphone","handset","gun","pistol",
  "revolver","rifle","shotgun","firearm","weapon","knife","blade","dagger","sword","machete","axe","bottle","flask",
  "canteen","cup","mug","glass","tumbler","bag","handbag","briefcase","suitcase","backpack","rucksack","satchel",
  "purse","wallet","key","keys","keycard","book","notebook","journal","ledger","folder","binder","file","dossier",
  "document","paper","letter","envelope","note","card","index card","contract","program","caddy","pen","pencil","marker","camera","torch","flashlight","lantern",
  "umbrella","cane","walking stick","staff","wand","baton","club","tool","wrench","hammer","screwdriver","cigarette",
  "cigar","lighter","money","cash","banknote","coin","ticket","map","tablet","ipad","laptop","controller","remote",
  "microphone","bouquet","flowers","gift","present","parcel","package","box","crate","plate","tray","syringe","vial","jar"];
const PROP_WORN_WORDS = ["watch","wristwatch","ring","bracelet","bangle","necklace","chain","pendant","locket","amulet",
  "earring","earrings","glasses","sunglasses","spectacles","eyeglasses","monocle","goggles","hat","cap","beanie",
  "helmet","hood","scarf","muffler","tie","necktie","bowtie","cravat","badge","brooch","insignia","medal","ribbon",
  "belt","sash","glove","gloves","mask","veil","crown","tiara","circlet","coat","jacket","cloak","cape","mantle",
  "robe","uniform","gown","dress","suit","shirt","blouse","vest","waistcoat","boots","boot","shoe","shoes","armband",
  "holster","apron","epaulette","collar","cufflink","cufflinks","bandana","headband","wig"];
function _propWordHit(name, words){
  const n = " "+String(name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ")+" ";
  return words.some(w=> n.indexOf(" "+w+" ")>=0);
}
/* SET DRESSING nouns — furniture and fixtures that live in a place rather than on a
   body: a hollow log, a bench, an apartment's wardrobe. Deliberately unambiguous words
   only (no "lamp"/"mirror"/"clock", which are as often handheld). Only consulted for
   OWNERLESS objects — an owned item is by definition worn or carried. */
const PROP_DRESSING_WORDS = ["log","stump","trunk","branch","bough","root","bloom","blossom","flower","plant","tree",
  "bush","shrub","reed","reeds","moss","mushroom","toadstool","rock","boulder","stone","pebble","bench","table","chair",
  "armchair","sofa","couch","settee","bed","cot","bunk","desk","shelf","shelves","bookcase","cabinet","cupboard",
  "wardrobe","dresser","nightstand","stool","door","doorway","gate","fence","picket","railing","sign","signpost",
  "signage","statue","sculpture","fountain","altar","throne","fireplace","hearth","stove","oven","counter","countertop",
  "workbench","booth","curtain","curtains","drapes","rug","carpet","tapestry","chandelier","web","cobweb","nest","hive",
  "pillar","column","arch","archway","bridge","well","anvil","forge","loom","barrel","cauldron","trough","manger",
  "pew","podium","lectern","monument","obelisk","totem","scaffold","awning","canopy","trellis","planter","pond","pool"];
function classifyPropKind(name, opts){
  // FIXTURE PHRASING beats the noun: "a lantern STRUNG on a thread" is installed at a
  // place, not carried — the mounting words say more than the object word does
  if(/\b(strung|hung|hanging|mounted|nailed|bolted|anchored|staked|planted|fixed to|built into|embedded)\b/i.test(String(name||""))
     && !!(opts && opts.ownerless)) return "dressing";
  // Read the object before its storage/attachment description: an index card in a
  // jacket is carried; glasses on a chain are glasses, not the chain or the collar.
  const noun = propPrimaryNoun(name, !!(opts && opts.ownerless));
  if(noun) return PROP_CARRIED_WORDS.includes(noun)?"carried":PROP_WORN_WORDS.includes(noun)?"worn":"dressing";
  const carried = _propWordHit(name, PROP_CARRIED_WORDS);
  const worn = _propWordHit(name, PROP_WORN_WORDS);
  // dressing only competes for OWNERLESS objects (opts.ownerless) — existing callers
  // that classify a character's own items keep the original worn/carried behaviour
  const dressing = !!(opts && opts.ownerless) && _propWordHit(name, PROP_DRESSING_WORDS);
  const hits = [carried&&"carried", worn&&"worn", dressing&&"dressing"].filter(Boolean);
  return hits.length===1 ? hits[0] : "";   // unknown or conflicting -> defer to the source
}
window.classifyPropKind = classifyPropKind;
window.propSlug = propSlug;

/* the location an ownerless object is a FIXTURE OF: the explicit link, else the one
   location every mapped scene resolves to (mobile objects spanning places get none). */
function propHomeLocation(p){
  try{
    const C = window.turnContinuity || {};
    const locs = C.locations||[];
    if(p && p.locationId) return locs.find(l=>l && l.id===p.locationId) || null;
    if(p && !p.ownerId && (p.scenes||[]).length && typeof locationForScene==="function"){
      const homes = [...new Set(p.scenes.map(sid=>{ const l=locationForScene(locs, sid); return l&&l.id; }).filter(Boolean))];
      if(homes.length===1) return locs.find(l=>l && l.id===homes[0]) || null;
    }
  }catch(e){}
  return null;
}
window.propHomeLocation = propHomeLocation;

/* the PRIMARY object noun of a prop name, with synonyms folded together, so two
   descriptions of the same object collapse to one head ("Mobile phone" and "Phone
   screen cracked in bottom corner" → "phone"). Returns "" when no known object noun
   is found (then only an exact-name match counts as a duplicate). Used to detect /
   prevent duplicate prop cards for one owner's one object. */
const PROP_NOUN_SYNONYMS = { mobile:"phone", cellphone:"phone", smartphone:"phone", iphone:"phone", handset:"phone",
  wristwatch:"watch", spectacles:"glasses", eyeglasses:"glasses", sunglasses:"glasses", monocle:"glasses",
  revolver:"gun", pistol:"gun", firearm:"gun", shotgun:"gun", rifle:"gun", handgun:"gun",
  blade:"knife", dagger:"knife", earrings:"earring", keys:"key", gloves:"glove", boots:"boot", shoes:"shoe",
  flowers:"bouquet", banknote:"money", cash:"money", coin:"money" };
function propHeadNoun(name){
  const noun=propPrimaryNoun(name,false);
  return PROP_NOUN_SYNONYMS[noun] || noun;
}
function propPrimaryNoun(name,includeDressing){
  const n=" "+String(name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ")+" ";
  return PROP_CARRIED_WORDS.concat(PROP_WORN_WORDS,includeDressing?PROP_DRESSING_WORDS:[])
    .map(word=>({word,index:n.indexOf(" "+word+" ")})).filter(x=>x.index>=0)
    .sort((a,b)=>a.index-b.index||b.word.length-a.word.length).map(x=>x.word)[0]||"";
}
window.propHeadNoun = propHeadNoun;

/* group props into duplicate sets — same owner + same object (head noun, or exact
   name when the object is unknown). Returns a map: signature -> array of prop ids
   (only signatures with 2+ props, i.e. actual duplicates). */
function findDuplicateProps(props){
  // Suggestions only: never equate two distinct objects because their noun matches.
  const exact={};
  (props||[]).forEach(p=>{
    const key=[p.ownerId||"",p.locationId||"",String(p.name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()].join("|");
    (exact[key]=exact[key]||[]).push(p.id);
  });
  return Object.fromEntries(Object.entries(exact).filter(([,ids])=>ids.length>1));
}
window.findDuplicateProps = findDuplicateProps;

/* POSSIBLY THE SAME OBJECT (owner 2026-10-29, the Props review): one object saved under two people — the sealed letter
   Nives carries to Aurelio, made once from each character brief. findDuplicateProps only pairs the same owner and the
   same name, so these never met. A pair here is a carried (or set-dressing) object under a DIFFERENT owner whose name
   shares most of its words with this one's (two or more of them; the other names count too). Worn items are left out:
   two people in one uniform wear two badges. A suggestion only — "Keep separate" (distinctFrom, saved on both cards)
   ends it, and a merge asks first. Returns id -> the ids it may be. */
const PROP_SAME_STOP = new Set(["the","and","with","from","for","his","her","their","its","own","that","this","into","onto","left","right","small","large","old","new","plain"]);
function propNameWords(t){
  return new Set(String(t||"").toLowerCase().replace(/[\u2019']s\b/g,"").split(/[^a-z0-9]+/)
    .filter(w=>w.length>=3 && !PROP_SAME_STOP.has(w)));
}
function findPossibleSameProps(props){
  const list = (props||[]).filter(p=>p && p.id && (p.kind||"carried")!=="worn");
  const words = {}; list.forEach(p=>{ words[p.id] = [p.name, ...(p.aliases||[])].map(propNameWords).filter(w=>w.size); });
  const out = {};
  const near = (a,b)=> words[a.id].some(wa=>words[b.id].some(wb=>{
    let n=0; wa.forEach(w=>{ if(wb.has(w)) n++; });
    return n>=2 && n/Math.min(wa.size, wb.size) >= 0.6;
  }));
  for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
    const a=list[i], b=list[j];
    if((a.ownerId||"")===(b.ownerId||"") && (a.locationId||"")===(b.locationId||"")) continue;   // findDuplicateProps' pair
    if((a.distinctFrom||[]).indexOf(b.id)>=0 || (b.distinctFrom||[]).indexOf(a.id)>=0) continue;
    if(!near(a,b)) continue;
    (out[a.id]=out[a.id]||[]).push(b.id); (out[b.id]=out[b.id]||[]).push(a.id);
  }
  return out;
}
window.findPossibleSameProps = findPossibleSameProps;

/* A SHORT NAME (owner 2026-10-29): a card made from a character brief is named with the whole description ("Old
   steel-cased wristwatch on a cracked brown leather strap, left wrist"). The card offers the part before its first
   placement clause ("Old steel-cased wristwatch"); the full text stays as one of its other names (so the character's
   list still finds it and it is never made again from the brief) and, when the card has no form yet, as its form. */
const PROP_NAME_CUT = /\s*(?:,|;|\s\u2014\s|\s-\s|\s(?:on|in|with|pinned|addressed|worn|tucked|hanging|around|at|from|under|inside|attached|clipped|kept|carried|slung|strapped|held)\s)/i;
function propShortName(name){
  const n = String(name||"").trim();
  if(n.length <= 40) return "";
  const m = n.search(PROP_NAME_CUT);
  if(m < 0) return "";
  const short = n.slice(0, m).trim().replace(/[\s,.;:\-\u2014]+$/,"");
  const words = short.split(/\s+/).filter(Boolean);
  if(!words.length || (words.length < 2 && short.length < 4) || short.length > n.length - 8) return "";
  return short;
}
window.propShortName = propShortName;
function propShortNamePatch(p){
  const short = propShortName(p && p.name);
  if(!short) return null;
  const aliases = Array.from(new Set([...(p.aliases||[]), p.name].map(x=>String(x||"").trim()).filter(Boolean)));
  return { name:short, aliases, shortenedFrom:p.name, ...(String(p.form||"").trim() ? {} : { form:p.name }) };
}
window.propShortNamePatch = propShortNamePatch;

/* A character brief's items (owner 2026-10-12: carried props come from the screenplay). WORN items —
   the watch, the scarf, the jewellery that come from designing how a character looks — become worn
   cards. A CARRIED item becomes a PROPOSAL, never a story prop: it is saved in the group "proposed"
   (PropScreenplay.isProposal) until the user keeps it or Extract screenplay props finds it in the
   screenplay; batches and agents never pay for it (PropScreenplay.batchSkip). */
function propsFromCast(characters, existing, scenes, drafts){
  const have = existing || [];
  // WORN items belong to their owner, so they're present wherever the owner is — map them
  // to owner-presence at seed time (carried items stay unmapped; the AI pins those exactly
  // later). Without this the bible showed worn props with an empty scene list.
  const wornScenes = (ownerId, name)=> (scenes && scenes.length && typeof scenesWhereCharacterAppears==="function")
    ? window.PropScreenplay.characterScenes(ownerId,name,scenes,drafts,characters) : null;
  // signature = ownerId + normalised name, so a prop already on the tab isn't re-added
  const sig = (ownerId,name)=> (ownerId||"")+"::"+String(name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  // a card's other names count too: a card given a short name (propShortNamePatch) keeps the brief's text there
  const seen = new Set(have.flatMap(p=> [p.name, ...(p.aliases||[])].map(n=>sig(p.ownerId, n))));
  const out = [];
  (characters||[]).forEach(c=>{
    const add = (text, sourceKind)=> splitPropItems(text).forEach(item=>{
      const s = sig(c.id, item);
      if(seen.has(s)) return;
      if(window.PropScreenplay && window.PropScreenplay.nameIssue(item)) return;
      seen.add(s);
      const kind = classifyPropKind(item) || sourceKind;   // name-based truth wins over the source field
      const card = {
        id: "prop-"+(c.id||"x")+"-"+kind+"-"+propSlug(item)+"-"+(out.length),
        name: item.replace(/^\w/, m=>m.toUpperCase()),
        kind, inventoryGroup:kind==="worn"?"accessories":kind==="carried"?"proposed":"story", ownerId: c.id||"", ownerName: c.name||"",
        form:"", material:"", detail:"", renderStyle:"", negativePrompt:"",
        fromCast:true,
        // This is a department design proposal copied from a character brief. It is
        // deliberately not screenplay provenance, even when the same noun is later
        // discovered lexically in screenplay text.
        origin:{kind:sourceKind==="worn"?"costume":"props",characterId:c.id||"",characterName:c.name||""},
      };
      if(kind==="worn"){ const sc = wornScenes(c.id, c.name); if(sc) card.scenes = sc; }
      out.push(card);
    });
    add(c.accessories, "worn");
    add(c.props, "carried");
  });
  return out;
}
window.propsFromCast = propsFromCast;

/* A label may only state what the saved record establishes. In particular, finding a
   matching word in screenplay text does not retroactively turn a design proposal into
   a screenplay extraction. `fromCast` and `manual` are the only trustworthy legacy
   origin flags; an old free-text `origin` field is provenance detail, not a source kind. */
function propOriginLabel(prop){
  const p=prop||{}, o=(p.origin && typeof p.origin==="object") ? p.origin : null;
  const who=(o&&(o.characterName||o.ownerName))||p.ownerName||"the character";
  if(o){
    if(o.kind==="screenplay") return "Screenplay-derived extraction";
    if(o.kind==="costume") return "Costume department design proposal from "+who+"'s character brief";
    if(o.kind==="props") return "Props department design proposal from "+who+"'s character brief";
    if(o.kind==="set-decoration") return "Set Decoration department design proposal";
    if(o.kind==="design") return "Design proposal from a selected item in "+(o.sourceName||"an Art Room image");
    if(o.kind==="manual") return "Added manually in Props";
    return "Origin not recorded";
  }
  // Legacy `fromCast` did not retain whether the item came from Accessories or Props,
  // and its current binding may since have been edited, so the department is unknown.
  if(p.fromCast) return "Department design proposal from "+who+"'s character brief";
  if(p.manual) return "Added manually in Props";
  return "Origin not recorded";
}
window.propOriginLabel = propOriginLabel;

/* Verifiable prop provenance from the screenplay page itself. Scene mappings can be
   inherited or AI-narrowed, so they are not evidence. Only the full normalized prop name
   counts as an exact mention. A recognised object noun is still useful discovery, but is
   explicitly a POSSIBLE match because words such as "key" can be non-physical homonyms. */
function propScreenplayMentions(prop, scenes, drafts){
  const esc = s=>String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const clean = s=>String(s||"").toLowerCase().replace(/[^a-z0-9' -]+/g," ").replace(/\s+/g," ").trim();
  const indexed = value=>{
    const raw=String(value==null?"":value), chars=[], map=[];
    let pendingSpace=false, pendingIndex=0;
    for(let i=0;i<raw.length;i++){
      const ch=raw[i], keep=/[a-z0-9'-]/i.test(ch);
      if(keep){
        if(pendingSpace && chars.length){ chars.push(" "); map.push(pendingIndex); }
        chars.push(ch.toLowerCase()); map.push(i); pendingSpace=false;
      }else if(chars.length && !pendingSpace){ pendingSpace=true; pendingIndex=i; }
    }
    return {raw,normalized:chars.join(""),map};
  };
  const full = clean(prop&&prop.name).replace(/^(the|a|an)\s+/,"");
  const head = (typeof propHeadNoun==="function") ? propHeadNoun(prop&&prop.name) : "";
  const exactRe = full ? new RegExp("\\b"+esc(full)+"\\b","i") : null;
  // Singular/plural variants are useful discovery only. They must stay possible:
  // lexical similarity is not proof that the text names this particular object.
  const heads=head ? [...new Set([head,head.endsWith("s")?head.slice(0,-1):head+"s"].filter(Boolean))] : [];
  const possibleTerms=heads.filter(term=>term!==full);
  const possibleRe = possibleTerms.length ? new RegExp("\\b(?:"+possibleTerms.map(esc).join("|")+")\\b","i") : null;
  const out=[];
  (scenes||[]).forEach(scene=>{
    const d=(drafts||{})[scene.id];
    if(!d||!Array.isArray(d.blocks)) return;
    d.blocks.forEach((block,index)=>{
      if(/^(scene|heading|slug|char|character|cue)$/i.test(String(block&&block.type||""))) return;
      const ix=indexed(block&&block.text);
      if(!ix.normalized) return;
      const exactHit=exactRe&&exactRe.exec(ix.normalized);
      const possibleHit=!exactHit&&possibleRe&&possibleRe.exec(ix.normalized);
      const hit=exactHit||possibleHit, match=exactHit?"exact":possibleHit?"possible":"";
      if(!match) return;
      const matchStart=ix.map[hit.index] == null ? 0 : ix.map[hit.index];
      const lastMap=ix.map[hit.index+hit[0].length-1];
      const matchEnd=(lastMap==null?matchStart:lastMap)+1;
      const radius=95, excerptStart=Math.max(0,matchStart-radius);
      const excerptEnd=Math.min(ix.raw.length,matchEnd+radius);
      const text=(excerptStart?"…":"")+ix.raw.slice(excerptStart,excerptEnd)+(excerptEnd<ix.raw.length?"…":"");
      out.push({sceneId:scene.id,sceneNo:scene.no,title:scene.title||"",beat:block.beat||block.beatId||null,
        block:index+1,text,fullText:ix.raw,match,matchStart,matchEnd,matchedText:ix.raw.slice(matchStart,matchEnd)});
    });
  });
  return out.sort((a,b)=>(a.match==="exact"?0:1)-(b.match==="exact"?0:1));
}
window.propScreenplayMentions = propScreenplayMentions;

/* true when the cast carries any worn/carried items we could pull into the tab */
function castHasProps(characters){
  return (characters||[]).some(c=> splitPropItems(c.accessories).length || splitPropItems(c.props).length);
}
window.castHasProps = castHasProps;

function propDefaults(p){
  return {
    negativePrompt: p.negativePrompt || "watermark, sheet captions, measurement annotations, blurry, low resolution, distorted, extra objects, people, hands",
    // empty style text falls back through the card's PICKED renderStyleKey, then the
    // INHERITED owner/location style — never straight to photoreal over a stylized world
    renderStyle: p.renderStyle || ((typeof window.renderStyleText==="function")
      ? window.renderStyleText("prop", p.renderStyleKey || propInheritedStyleKey(p))
      : "photoreal product reference, 85mm, soft even studio lighting, sharp focus"),
  };
}

/* Render-style text per key — the prop card uses the SAME dropdown options as the cast
   (window.CHAR_RENDER_STYLE_OPTIONS, incl. "Surprise me ✨"); picking a concrete key
   writes this prop-tuned recipe into p.renderStyle, which buildPropRefPrompt feeds into
   the sheet's render.style. "surprise" is AI-invented per prop (aiSurpriseStyleText). */
const PROP_RENDER_TEXT = {
  photoreal: "photoreal product reference, 85mm macro, soft even studio lighting, sharp focus, true-to-life materials",
  graphicNovelNoir: "black-and-white graphic-novel object illustration, bold ink contours, heavy spot blacks and screentone shading, hard noir side light, strictly monochrome",
  ukiyoe: "ukiyo-e woodblock print of the object, flat mineral-pigment colour, calligraphic keyblock outline, washi paper texture, Edo-period palette, no Western shading",
  paperCutout: "paper cut-out object, flat scissor-cut paper shapes in shallow stacked layers, real drop shadows between layers, visible construction-paper grain, handmade collage feel",
  photorealNatural: "natural-history macro photoreal reference, real-world biological materials, believable anatomy-adjacent texture, skin/fur/scales/chitin/wing micro-detail, moisture, soft specimen-studio light, minimal stylization",
  photorealCreature: "cinematic photoreal creature-shop prop/object reference, practical effects and VFX maquette realism, tactile prosthetic materials, controlled studio light, physically plausible screen design",
  photorealOrnamental: "photoreal ornamental object reference, couture/ceremonial/jewelry-like or armor-like detailing, iridescent surfaces, polished metal/glass/crystal accents, premium studio light",
  render3d:  "stylized 3D product render, clean studio HDRI lighting, physically-based materials, soft ambient occlusion, subtle bevels",
  anime:     "anime cel-shaded product illustration, clean confident linework, flat shading with soft gradients, no photoreal texture",
  flat:      "flat vector graphic, bold clean shapes, minimal flat shading, limited palette, no gradients, no photoreal texture",
  horror:    "low-key cinematic horror photography of the object, hard cold side light, deep crushed shadows, desaturated cold green-teal grade, damp grimy detail",
  ghibli:    "soft hand-painted Studio Ghibli-style 2D object, fine warm hand-drawn linework, gentle painterly cel shading, warm earthy naturalistic palette",
  animated3d:"polished animated-feature 3D product render, soft warm flattering light, appealing clean PBR materials, idealized finish, no noise",
  pixar:     "Pixar-style animated-feature 3D object, soft warm flattering light, appealing rounded stylized form, clean tactile PBR materials, idealized charming finish, no noise",
  storyboardconcept:"clean storyboard / production concept object reference, expressive linework, clear silhouette, restrained color wash, readable production-board detail",
  texturedcomic:"textured contemporary comic-art object reference, bold ink contours, etched hatching, limited palette, dramatic graphic light, visible grain",
  gtaLoadingScreen:"open-world crime-game loading-screen poster object, semi-realistic form with bold black ink outlines, hard cel shading, crisp specular highlights, saturated high-contrast palette true to the object's own colours, glossy poster finish, no text or logos",
  whimsicalwatercolor:"whimsical watercolor and fine-ink object reference, transparent washes, paper grain, delicate hand-drawn line, soft storybook charm",
  stopmotion:"photograph of a real handmade stop-motion prop, sculpted silicone/felt/wood at miniature scale, soft practical macro light, shallow depth of field",
  claymation:"photograph of a real plasticine claymation prop, rounded clay forms with thumbprints and tool marks, soft practical macro light, shallow depth of field",
  adv1960s:  "1960s painted commercial illustration of the object, smooth airbrushed gouache, vintage halftone print texture, mid-century mustard/avocado/teal palette",
  gaganime:  "1990s gag-anime 2D cel cartoon object, thick bold black outlines, flat high-saturation colors, simple graphic shadows, sticker-like finish",
  pixelart:  "retro 16/32-bit pixel-art object, hard square pixels, no anti-aliasing, limited indexed palette, dithered shading, crisp pixel outlines",
};
Object.assign(PROP_RENDER_TEXT, {
  modernAnime:"modern cinematic anime object reference, clean sharp linework, polished cel shadows, vibrant contemporary colour",
  digitalAnime:"polished digital anime object illustration, smooth refined rendering, clean line art, luminous colour, glossy highlights",
  roughSketchAnime:"rough sketch anime object concept, visible pencil/ink strokes, flat colour, light hatching, production-design energy",
  painterlyAnime:"painterly anime object reference, delicate line, soft blended brushwork, dreamy atmospheric colour wash",
  cartoon3d:"stylized 3D cartoon object render, bold simplified forms, clean animated-feature lighting, rounded appeal",
  textured3dCartoon:"textured 3D cartoon object render, felt/clay/fabric/fuzzy tactile surfaces, soft studio light",
  stylizedCartoon:"stylized cartoon object illustration, bold outlines, flat colour areas, theatrical graphic shape design",
  grittyDigital:"gritty digital illustration object reference, expressive linework, harsh light, textured shadows, high contrast",
  softPainterly:"soft painterly object illustration, visible brushstrokes, blended colour, warm handmade texture",
  realisticDigitalDrawing:"realistic digital drawing object reference, believable light, detailed material texture, illustrated not photographic",
  flatDesign:"flat design object illustration, simplified geometric shapes, bold colour, minimal shading",
  minimalistLine:"minimalist line-art object reference, sparse elegant contour, warm paper, one small accent colour",
  vintageChildrensBook:"vintage children’s book object illustration, loose ink outline, limited spot colour, aged paper print texture",
  tactileMixedMedia:"tactile mixed-media object reference, handmade fabric/felt/paper/paint/sculpted materials, miniature photographed craft",
  texturedPaperSculpture:"textured paper sculpture object reference, folded layered paper, visible fibres, photographed tabletop craft",
  texturedPaperIllustration:"textured paper illustration object reference, collage layers, stippled print grain, cut-paper edges",
  tropicalArtNouveau:"tropical Art Nouveau object illustration, flowing organic lines, botanical motifs, flat ornamental colour",
});
window.PROP_RENDER_TEXT = PROP_RENDER_TEXT;

function combinedPropPrompt(p, project){
  const master = buildPropRefPrompt(p, project);
  const neg = (p.negativePrompt || propDefaults(p).negativePrompt || "").trim();
  return neg ? (master + " AVOID: " + neg.replace(/\.$/,"") + ".") : master;
}
window.combinedPropPrompt = combinedPropPrompt;

/* simplified fallback — fewer words, less likely to trip a content filter */
function buildSimplePropPrompt(p){
  const form = (p.form||"").replace(/\.$/,"").trim();
  const material = (p.material||"").replace(/\.$/,"").trim();
  const parts = [
    "Prop reference \u2014 "+(p.name||"object"),
    form||"",
    material ? (material) : "",
    "4-panel object sheet: hero three-quarter view, front elevation, side profile, and detail macro",
    "flat off-white background with a soft contact shadow, studio product lighting, "
      +((String(p.renderStyle||((typeof window.renderStyleText==="function")?window.renderStyleText("prop",p.renderStyleKey||propInheritedStyleKey(p)):"")).split(/[;,]/)[0].trim())||"photoreal")
      +", sharp focus, no people"
  ].filter(Boolean);
  return parts.join(". ")+".";
}
window.buildSimplePropPrompt = buildSimplePropPrompt;

/* Headless prop-sheet generation — render + persist a prop's reference sheet WITHOUT
   the Props tab being mounted. Mirrors what a prop card's generate does (combined
   prompt → Nano Banana → commit as a 'prop' asset, with the same simplified retry on
   an empty result). Used by the character card's "generate props first" flow so the
   user can fill missing prop references without switching tabs. Resolves true on
   success, throws on a hard failure. */
/* the owner's generated character sheet — a worn/owned prop references it so the prop
   matches that character's style, materials, palette and wear (they belong to the same
   world / the same body). Returns "" if the owner has no generated sheet yet. */
async function propOwnerSheetUrl(p){
  if(!p || !p.ownerId) return "";
  let u = (typeof nbGetImage==="function") ? nbGetImage(p.ownerId) : "";
  if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(p.ownerId); }catch(e){} }
  return u || "";
}
window.propOwnerSheetUrl = propOwnerSheetUrl;
/* the instruction that tells the model to match the referenced character sheet. */
function propOwnerNote(p){
  const who = (p && p.ownerName) || "the owner";
  const rel = (p && p.relation) ? String(p.relation).replace(/\.$/,"").trim() : "";
  const relNote = rel ? (" "+who+"'s relationship to this object: "+rel+" \u2014 let that history show in its condition, wear and repairs.") : "";
  return ((p && p.kind==="worn")
    ? "Reference image: "+who+"'s character sheet. This prop is WORN by "+who+" — render it in the SAME visual style, materials, colour palette, surface wear and finish as that character, so it looks like it belongs on their body."
    : "Reference image: "+who+"'s character sheet. Render this prop in the SAME visual style, palette and world as that character so it reads as theirs.") + relNote;
}
window.propOwnerNote = propOwnerNote;

/* shared useImageGen plumbing for prop sheets (the base card AND state variants):
   the owner's character sheet rides as the style/belonging anchor, tagged refId so
   anchor recording stays transaction-derived. */
function propOwnerAttachments(p){
  return async ()=>{
    const out = [];
    const u = (typeof propOwnerSheetUrl==="function") ? await propOwnerSheetUrl(p) : "";
    if(u) out.push({ url:u, note:(p.ownerName||"owner")+" character sheet", refId:p.ownerId });
    for(const r of (Array.isArray(p.referenceImages)?p.referenceImages:[]).filter(Boolean).slice(0,6)){
      // A linked sheet may have been regenerated since it was attached. Resolve the
      // canonical entity now instead of reusing the URL captured at attach time.
      // A CROP (an item selected out of a sheet) is its own picture: it is sent as it was cut, never swapped for the
      // whole sheet it came from (2026-10-29 — it was, so the model got the full sheet instead of the watch)
      let refUrl = "";
      if(r.cropped && r.url){
        out.push({ url:r.url, kind:"prop-reference-crop",
          note:(r.note||"selected item")+" \u2014 cut from "+(r.sourceName||"another Art Room sheet")+": match this item's design",
          refId:r.id || r.url });
        continue;
      }
      if(r.sourceEntityId){
        try{ refUrl = (typeof nbGetImage==="function") ? nbGetImage(r.sourceEntityId) : ""; }catch(e){}
        if(!refUrl && typeof nbLoadImage==="function"){
          try{ refUrl = await nbLoadImage(r.sourceEntityId); }catch(e){}
        }
      }
      refUrl = refUrl || r.url || r.sourceUrl || "";
      if(!refUrl) continue;
      out.push({ url:refUrl, kind:"prop-reference-image",
        note:(r.note||"visual reference")+" \u2014 from "+(r.sourceName||"another Art Room sheet")+" as a consistency reference",
        refId:r.sourceEntityId || r.id });
    }
    return out;
  };
}
/* the reference sentence for prop generation, aware of WHICH refs actually attached:
   the owner-sheet note only when the owner sheet rode in. */
function propAttachmentsText(p){
  return (attach)=>{
    const hasOwner  = (attach||[]).some(a=>a && a.refId===p.ownerId);
    const visualRefs = (attach||[]).filter(a=>a && (a.kind==="prop-reference-image" || a.kind==="prop-reference-crop"));
    let t = hasOwner ? ((typeof propOwnerNote==="function") ? propOwnerNote(p) : "") : "";
    if(visualRefs.length)
      t += (t?" ":"") + "Additional consistency reference image"+(visualRefs.length>1?"s":"")+" show how this prop should belong inside the film's existing character/location/prop world. Use selected crops for item-specific design, and whole sheets for likeness, owner taste, materials, patina, colour and texture continuity; ignore unrelated surrounding objects or background.";
    return t;
  };
}
window.propAttachmentsText = propAttachmentsText;
/* records WHICH owner-sheet version a prop sheet (base or state variant) was anchored
   against — ONLY when the owner ref verifiably rode in THIS generation (refsUsed).
   Simple-mode / ref-less generations record nothing → never false-stale. */
function propAnchorMetaExtra(p){
  return async ({ refsUsed })=>{
    if(!p.ownerId || typeof nbLoadDetailsAsset!=="function") return undefined;
    const used = (refsUsed||[]).some(r=> r && r.refId===p.ownerId);
    if(!used) return undefined;
    try{
      const d = await nbLoadDetailsAsset(p.ownerId);
      const iso = d && d.meta && d.meta.iso;
      return iso ? { anchorOwnerId:p.ownerId, anchorOwnerName:(p.ownerName||""), anchorIso:iso } : undefined;
    }catch(e){ return undefined; }
  };
}
window.propOwnerAttachments = propOwnerAttachments;
window.propAnchorMetaExtra = propAnchorMetaExtra;

/* Resolve the most specific visual sheet available at this story moment. Condition
   variants now belong to sparse continuity events; legacy appearance-state sheets are
   retained through the same event contract. Fail-safe: any doubt → the base sheet. */
function shotPropSheetId(p, scene, scenes, beatId, microBeatId, shotId, context){
  const base = { id: p.id, state: null };
  try{
    if(!p || !scene || typeof propStateAt!=="function") return base;
    const resolverContext={...(window.turnContinuity||{}),...(context||{}),scenes:scenes||((context||{}).scenes)||((window.turnContinuity||{}).scenes)||[]};
    const resolved=propStateAt(p,scene.id,beatId,microBeatId,shotId,resolverContext);
    const gid=resolved&&resolved.referenceAssetId;
    if(gid && typeof nbGetImage==="function" && nbGetImage(gid)){
      const event=resolved.event||{};
      return { id:gid, state:{
        id:event.referenceStateId||event.id||gid,
        label:event.referenceStateLabel||event.condition||resolved.condition||"changed condition",
        change:event.note||event.condition||resolved.condition||"",
      }, event };
    }
  }catch(e){}
  return base;
}
window.shotPropSheetId = shotPropSheetId;

/* PROP CONTINUITY CONTRACT -------------------------------------------------------
   A prop has one canonical identity; its relationship to the story changes through
   sparse events. `kind` remains the DEFAULT binding used by existing projects, never
   a permanent restriction. Every downstream room asks this resolver for the state at
   its precise story moment instead of inventing its own custody/placement rules. */
const PROP_BINDING_MODES = ["worn","carried","dressing"];
const PROP_EVENT_TYPES = ["acquired","handed_over","placed","removed","updated","damaged","destroyed","consumed","recovered"];
window.PROP_BINDING_MODES = PROP_BINDING_MODES;
window.PROP_EVENT_TYPES = PROP_EVENT_TYPES;

function _propNum(v, fallback){
  if(v==null || v==="") return fallback;
  const n = Number(v); if(Number.isFinite(n)) return n;
  const m = String(v).match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : fallback;
}
function _propSceneIndex(sceneId, scenes){
  const list=(scenes||[]).slice().sort((a,b)=>(_propNum(a&&a.no,9999)-_propNum(b&&b.no,9999)));
  const i=list.findIndex(s=>s&&s.id===sceneId); return i<0 ? 999999 : i;
}
function _propBeatIndex(sceneId, beatId, beatsMap){
  const rows=((beatsMap&&beatsMap[sceneId]&&beatsMap[sceneId].rows)||[]);
  const i=rows.findIndex((b,n)=> b && (b.id===beatId || b.beatId===beatId || String(n+1)===String(beatId)));
  return i>=0 ? i : _propNum(beatId,0);
}
function _propShotIndex(sceneId, shotId, shots){
  const list=(shots||[]).filter(s=>s&&s.sceneId===sceneId).slice()
    .sort((a,b)=>(_propNum(a.order,0)-_propNum(b.order,0))||(_propNum(a.beatN,0)-_propNum(b.beatN,0)));
  const i=list.findIndex(s=>s&&s.id===shotId); return i>=0 ? i : _propNum(shotId,0);
}
function _propMomentTuple(moment, ctx, target){
  moment=moment||{}; ctx=ctx||{};
  const hi=target ? 999999 : 0;
  return [
    _propSceneIndex(moment.sceneId,ctx.scenes),
    moment.beatId!=null||moment.beatN!=null ? _propBeatIndex(moment.sceneId,moment.beatId!=null?moment.beatId:moment.beatN,ctx.beatsMap) : hi,
    moment.microBeatId!=null||moment.microBeatN!=null ? _propNum(moment.microBeatId!=null?moment.microBeatId:moment.microBeatN,hi) : hi,
    moment.shotId ? _propShotIndex(moment.sceneId,moment.shotId,ctx.shots) : hi,
  ];
}
function _propTupleLTE(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const x=a[i]||0,y=b[i]||0; if(x<y)return true;if(x>y)return false; } return true; }
function _propLegacyStateType(st){
  const text=String((st&&st.label)||"")+" "+String((st&&st.change)||"");
  if(/destroy|shatter|burn(?:ed|t)?\s+away/i.test(text)) return "destroyed";
  if(/consum|empty|spent|used\s+up/i.test(text)) return "consumed";
  if(/repair|restor|recover|cleaned|mended/i.test(text)) return "recovered";
  if(/remove|discard|lost|missing/i.test(text)) return "removed";
  return "damaged";
}
function _propLegacyStateEvent(p,st,i){
  const condition=String((st&&st.change)||(st&&st.label)||"changed condition").trim();
  return {
    id:"legacy-state-"+((st&&st.id)||i), type:_propLegacyStateType(st),
    sceneId:(st&&st.sceneId)||"", note:condition, condition,
    referenceAssetId:(p&&p.id)+":"+((st&&st.id)||i),
    referenceStateId:(st&&st.id)||String(i),
    referenceStateLabel:(st&&st.label)||"changed condition",
    migratedFromAppearanceState:true, _legacy:true, _seq:5000+i,
  };
}
function _propEventList(p){
  const events=(Array.isArray(p&&p.continuityEvents)?p.continuityEvents:[]).filter(Boolean).map((e,i)=>({...e,_legacy:false,_seq:i}));
  // Older projects stored visible condition changes in a separate Appearance States
  // array. Read those as Story Events until the card migrates them, preserving the
  // generated variant asset at propId:stateId.
  (Array.isArray(p&&p.states)?p.states:[]).forEach((st,i)=>{
    const legacy=_propLegacyStateEvent(p,st,i);
    const represented=events.some(e=>e&&(e.referenceAssetId===legacy.referenceAssetId||e.referenceStateId===legacy.referenceStateId));
    if(!represented) events.push(legacy);
  });
  // Read old scene-level custody handovers as sparse events until the card migrates them.
  (Array.isArray(p&&p.custody)?p.custody:[]).forEach((e,i)=>{
    const legacy=_propLegacyCustodyEvent(e,i);
    if(legacy && !events.some(x=>x&&x.id===legacy.id)) events.push(legacy);
  });
  return events;
}
function _propLegacyCustodyEvent(e,i){
  if(!e||!e.charId) return null;
  return {id:e.id||("legacy-custody-"+i),type:"handed_over",sceneId:e.fromSceneId||"",
    holderId:e.charId,holderName:e.charName||"",note:e.note||"",migratedFromCustody:true,_legacy:true,_seq:10000+i};
}
/* Handover events (acquired / handed over / recovered) in story order. Shared by the
   character card's "held from" chips and the custody label, whether or not a card's
   legacy custody list has been migrated yet. */
function propHandoverEvents(p, scenes){
  const order={}; (scenes||[]).forEach(s=>{ if(s) order[s.id]=_propSceneIndex(s.id,scenes); });
  return _propEventList(p).filter(e=>e && e.sceneId && (e.holderId||e.holderName)
      && ["acquired","handed_over","recovered"].includes(String(e.type||"").toLowerCase()))
    .sort((a,b)=>((order[a.sceneId]??999999)-(order[b.sceneId]??999999))||((a._seq||0)-(b._seq||0)));
}
window.propHandoverEvents = propHandoverEvents;
function propIdentityOf(p){
  p=p||{};
  return { id:p.id||"", name:p.name||"", ownerId:p.ownerId||"", ownerName:p.ownerName||"",
    origin:p.provenance||(typeof p.origin==="string"?p.origin:"")||p.ownerName||"", associationType:p.associationType||(p.ownerId?"character":p.locationId?"location":""),
    associationId:p.associationId||p.ownerId||p.locationId||"", associationName:p.associationName||p.ownerName||"" };
}
window.propIdentityOf = propIdentityOf;

function propStateAt(propOrId, sceneId, beatId, microBeatId, shotId, context){
  const C=context||window.turnContinuity||{};
  const p=typeof propOrId==="string" ? (C.props||[]).find(x=>x&&x.id===propOrId) : propOrId;
  if(!p) return null;
  const identity=propIdentityOf(p), mode=PROP_BINDING_MODES.includes(p.bindingMode)?p.bindingMode:(p.kind||"carried");
  const mapped=Array.isArray(p.screenplaySources)&&C.drafts&&window.PropScreenplay ? window.PropScreenplay.scenesFor(p,C.drafts) : Array.isArray(p.scenes)?p.scenes:[];
  const hasExplicitMap=Array.isArray(p.scenes)||p.screenplayReviewed;
  const currentEvents=_propEventList(p).filter(e=>!e.source||!C.drafts||!window.PropScreenplay||window.PropScreenplay.sourceValid(e.source,C.drafts));
  const hasEvents=currentEvents.length>0;
  const firstMapped=mapped.length ? Math.min(...mapped.map(id=>_propSceneIndex(id,C.scenes))) : -1;
  const targetSceneIndex=_propSceneIndex(sceneId,C.scenes);
  let state={
    propId:p.id, identity, bindingMode:mode,
    ownerId:identity.ownerId, ownerName:identity.ownerName,
    custodianId:p.custodianId||identity.ownerId||"", custodianName:p.custodianName||identity.ownerName||"",
    holderId:p.holderId||((mode==="worn"||mode==="carried")?identity.ownerId:"")||"",
    holderName:p.holderName||((mode==="worn"||mode==="carried")?identity.ownerName:"")||"",
    placement:{ locationId:p.placementLocationId||p.locationId||"", unitId:p.placementUnitId||"", note:p.placement||"" },
    condition:p.condition||"intact", visibility:p.visibility||"visible",
    contentNotes:p.contentNotes||"", contentVersion:p.contentVersion||"",
    present: sceneId ? (hasEvents ? (firstMapped<0 ? !hasExplicitMap : targetSceneIndex>=firstMapped) : ((!mapped.length&&!hasExplicitMap) || mapped.indexOf(sceneId)>=0)) : true,
    association:{ type:identity.associationType,id:identity.associationId,name:identity.associationName },
    referenceAssetId:"",
    event:null,
  };
  const target=_propMomentTuple({sceneId,beatId,microBeatId,shotId},C,true);
  const events=currentEvents.map(e=>({...e,_tuple:_propMomentTuple(e,C,false)}))
    .filter(e=>e.sceneId && _propTupleLTE(e._tuple,target))
    .sort((a,b)=>{ for(let i=0;i<4;i++){ if(a._tuple[i]!==b._tuple[i]) return a._tuple[i]-b._tuple[i]; } return (a._seq||0)-(b._seq||0); });
  events.forEach(e=>{
    const type=String(e.type||"").replace(/\s+/g,"_").toLowerCase();
    if(e.bindingMode && PROP_BINDING_MODES.includes(e.bindingMode)) state.bindingMode=e.bindingMode;
    if(type==="acquired"||type==="handed_over"||type==="recovered"){
      state.present=true; state.visibility=e.visibility||"visible"; state.bindingMode=e.bindingMode||"carried";
      state.holderId=e.holderId||e.toCharacterId||e.charId||state.holderId;
      state.holderName=e.holderName||e.toCharacterName||e.charName||state.holderName;
      state.custodianId=e.custodianId||e.toCharacterId||e.charId||state.custodianId;
      state.custodianName=e.custodianName||e.toCharacterName||e.charName||state.custodianName;
      if(type!=="recovered"){ state.placement={locationId:"",unitId:"",note:""}; }
      else { state.condition=e.condition||"intact"; state.referenceAssetId=e.referenceAssetId||""; }
    }else if(type==="placed"){
      state.present=true; state.visibility=e.visibility||"visible"; state.bindingMode=e.bindingMode||"dressing";
      state.holderId=""; state.holderName="";
      state.placement={locationId:e.locationId||e.placementLocationId||state.placement.locationId,
        unitId:e.unitId||e.placementUnitId||"",note:e.placement||e.note||""};
    }else if(type==="removed"){
      const movedToHolder=!!(e.holderId||e.toCharacterId);
      state.present=movedToHolder||e.present===true; state.visibility=e.visibility||(movedToHolder?"visible":"offscreen");
      if(movedToHolder){ state.holderId=e.holderId||e.toCharacterId; state.holderName=e.holderName||e.toCharacterName||""; state.bindingMode="carried"; }
      else state.placement={locationId:"",unitId:"",note:e.note||""};
    }else if(type==="damaged"){
      state.condition=e.condition||"damaged"; state.referenceAssetId=e.referenceAssetId||"";
    }else if(type==="destroyed"||type==="consumed"){
      state.present=false; state.visibility="absent"; state.condition=type; state.referenceAssetId=e.referenceAssetId||"";
    }
    if(e.condition) state.condition=e.condition;
    if(e.contentNotes!==undefined) state.contentNotes=e.contentNotes;
    if(e.contentVersion!==undefined) state.contentVersion=e.contentVersion;
    if(e.visibility) state.visibility=e.visibility;
    if(e.custodianId){ state.custodianId=e.custodianId; state.custodianName=e.custodianName||state.custodianName; }
    if(e.referenceAssetId) state.referenceAssetId=e.referenceAssetId;
    state.event=e;
  });
  state.active=!!(state.present && state.visibility!=="absent" && state.visibility!=="hidden" && state.visibility!=="offscreen");
  return state;
}
window.propStateAt = propStateAt;
function propsActiveAt(props, sceneId, beatId, microBeatId, shotId, context){
  return (props||[]).filter(p=>{ const s=propStateAt(p,sceneId,beatId,microBeatId,shotId,context); return s&&s.active; });
}
window.propsActiveAt = propsActiveAt;
function propAssetRevision(propOrId){
  const id=typeof propOrId==="string" ? propOrId : propOrId&&propOrId.id;
  if(!id) return "";
  const meta=(typeof nbGetMeta==="function"&&nbGetMeta(id))||{};
  const hasImage=typeof nbGetImage==="function"&&!!nbGetImage(id);
  return hasImage ? (meta.iso||meta.createdAt||meta.date||meta.version||"sheet") : "text";
}
function propReferenceSnapshot(propIds, context){
  const C=context||window.turnContinuity||{};
  return Array.from(new Set((propIds||[]).filter(Boolean))).map(id=>{
    const p=(C.props||[]).find(x=>x&&x.id===id);
    return { propId:id, name:(p&&p.name)||"Prop", revision:propAssetRevision(id) };
  });
}
window.propAssetRevision = propAssetRevision;
window.propReferenceSnapshot = propReferenceSnapshot;
function propDependencySignature(props, sceneId, beatId, microBeatId, shotId, context){
  return propsActiveAt(props,sceneId,beatId,microBeatId,shotId,context).map(p=>{
    const s=propStateAt(p,sceneId,beatId,microBeatId,shotId,context)||{};
    // The canonical asset id is intentionally stable across regeneration, so include
    // the committed revision stamp. Re-rendering the same prop can then invalidate
    // only consumers that used its previous pixels.
    const visualRevision=propAssetRevision(s.referenceAssetId||p);
    return [p.id,s.bindingMode,s.holderId,s.placement&&s.placement.locationId,s.placement&&s.placement.unitId,s.condition,s.visibility,
      s.contentVersion,s.contentNotes,visualRevision].join(":");
  }).sort().join("|");
}
window.propDependencySignature = propDependencySignature;
/* WHAT A FRAME OR TAKE REALLY USED (owner 2026-10-08 — Props review). v2 ("pd2|"): only the props IN
   the frame, each with its story state, its description when it rides as text, and — for a sheet the
   frame attached — that sheet's version. The old signature covered every prop present in the scene
   (one regenerated prop flagged every frame there), read a variant that might not exist (so the base
   sheet the frame used could change unseen), skipped text-only descriptions, and fired after a reload
   before the images loaded. A version is "?" until its image store answers: never a false alarm. */
function propTextSig(p){ return [p.name,p.form,p.material,p.detail,p.signatureFeature,p.size].map(x=>String(x||"").replace(/\s+/g," ").trim()).join("~"); }
function propRevisionKnown(id){
  const img = (typeof nbGetImage==="function") && nbGetImage(id);
  const meta = (typeof nbGetMeta==="function") && nbGetMeta(id);
  if(img) return String((meta && (meta.iso||meta.createdAt||meta.version)) || "sheet");
  return meta ? "none" : "?";
}
function propFrameDependencies(inFrameIds, attached, props, sceneId, beatId, microBeatId, shotId, context){
  const list = Array.from(new Set((inFrameIds||[]).filter(Boolean).map(String))).map(id=>{
    const p = (props||[]).find(x=>x && String(x.id)===id); if(!p) return null;
    const s = propStateAt(p,sceneId,beatId,microBeatId,shotId,context)||{};
    const sheet = (attached && attached[id]) || "";
    return { id, st:[s.bindingMode,s.holderId,s.placement&&s.placement.locationId,s.placement&&s.placement.unitId,s.condition,s.visibility,s.contentVersion,s.contentNotes].join(":"),
      text: sheet ? "" : propTextSig(p), sheet, rev: sheet ? propRevisionKnown(sheet) : "" };
  }).filter(Boolean).sort((a,b)=> a.id<b.id ? -1 : a.id>b.id ? 1 : 0);
  return "pd2|"+JSON.stringify(list);
}
/* did what a frame / take used change? a v1 stamp keeps the old whole-string check (legacyCurrent) */
function propDependenciesChanged(stored, current, legacyCurrent){
  if(stored==null || stored==="") return false;
  const s = String(stored);
  if(s.indexOf("pd2|")!==0) return legacyCurrent!=null && s!==String(legacyCurrent);
  let a, b; try{ a = JSON.parse(s.slice(4)); b = JSON.parse(String(current||"").replace(/^pd2\|/,"")||"[]"); }catch(e){ return false; }
  if(!Array.isArray(a) || !Array.isArray(b)) return false;
  if(a.length!==b.length) return true;
  const byId = {}; b.forEach(x=>{ if(x) byId[x.id]=x; });
  return a.some(x=>{ const y = byId[x.id]; if(!y) return true;
    if(x.st!==y.st || x.text!==y.text || x.sheet!==y.sheet) return true;
    return !!(x.rev && y.rev && x.rev!=="?" && y.rev!=="?" && x.rev!==y.rev); });
}
window.propTextSig = propTextSig; window.propFrameDependencies = propFrameDependencies; window.propDependenciesChanged = propDependenciesChanged;

/* CUSTODY — who holds the object AT a scene, resolved from the story events
   (propStateAt). The canonical owner holds it from the start; the card, sheets and
   style anchor stay with the owner — a handover only moves the HOLDER. */
function custodyOwnerAt(p, scene, scenes){
  const s=propStateAt(p,scene&&scene.id,null,null,null,{...(window.turnContinuity||{}),scenes:scenes||[]});
  if(s) return { id:s.holderId||s.custodianId||"", name:s.holderName||s.custodianName||"", handover:s.event&&s.event.type==="handed_over"?s.event:null, state:s };
  return { id:(p&&p.ownerId)||"", name:(p&&p.ownerName)||"", handover:null };
}
window.custodyOwnerAt = custodyOwnerAt;
/* "Marisol \u2192 Diego (Sc 12)" chain label for UI + bibles, from the handover events. */
function custodyChainLabel(p, scenes){
  const chain = propHandoverEvents(p, scenes).filter(e=>e.holderName);
  if(!chain.length) return "";
  const names = [p.ownerName||"?"];
  chain.forEach(e=>{
    const sc = (scenes||[]).find(s=>s && s.id===e.sceneId);
    names.push(e.holderName + (sc && sc.no!=null ? (" (Sc "+sc.no+")") : ""));
  });
  return names.join(" \u2192 ");
}
window.custodyChainLabel = custodyChainLabel;

/* FITTING CRITIQUE prompt — vision judge for "does this object belong to this character".
   The exact reply shape keeps the verdict machine-readable; notes stay human prose. */
function buildPropFittingPrompt(p, hasOwner){
  const clean = (x)=>String(x||"").replace(/\.$/,"").trim();
  let s = hasOwner
    ? "Image 1 is the character reference sheet for "+(p.ownerName||"the owner")+". Image 2 is the reference sheet for "+(p.name||"their object")+" ("+(p.kind||"carried")+"). "
    : "This is the reference sheet for "+(p.name||"an object")+" belonging to "+(p.ownerName||"a character")+" ("+(p.kind||"carried")+"). ";
  s += "SPEC \u2014 form: "+(clean(p.form)||"unspecified")+"; material: "+(clean(p.material)||"unspecified")
    +"; significance: "+(clean(p.detail)||"unspecified")
    +(clean(p.relation)?("; relationship: "+clean(p.relation)):"")
    +(clean(p.scale)?("; scale against the owner: "+clean(p.scale)):"")+". ";
  s += "Judge whether this object BELONGS to this character: (1) render style & medium match, (2) material and finish coherent with their wardrobe and world, (3) scale plausibility against their body, (4) the stated relationship readable in its condition. ";
  s += "Reply in EXACTLY this shape:\nVERDICT: belongs | drifted | mismatch\nNOTES: 3\u20136 short observations, one per line\nFIX: one sentence \u2014 the single most valuable change to the OBJECT (or 'none').";
  return s;
}
window.buildPropFittingPrompt = buildPropFittingPrompt;

/* opts (2026-10-09, owner — Breakdown review), for "Make what this scene needs":
   cancelled() — the caller's stop (a film switch, a role that lost the Art Room): checked at the last await
     before the image is sent (the owner's sheet is loaded) and again before it is saved — nothing is sent or
     written once it says stop;
   onRetry() — the run asked again (the simpler prompt, or another engine after a content refusal): a second
     paid image the caller says out loud;
   onError(message) — the failure, for the caller's own report (no toast of its own then). */
async function generatePropSheet(p, project, opts){
  if(!p || typeof window.nbRunSheetGeneration!=="function") return false;
  const o=opts||{};
  const noop=()=>{};
  const stopNow=()=>typeof o.cancelled==="function" && !!o.cancelled();
  const stopped=()=>({__cancelled:true,requiredReference:true});   // the run discards it: nothing is sent or saved
  let ownerMeta=null, ownerUrl="";
  const build=()=>typeof combinedPropPrompt==="function"?combinedPropPrompt(p,project):(p.name||"prop reference");
  return !!(await window.nbRunSheetGeneration({
    id:p.id,slotId:"propref-"+p.id,allModels:window.NB_MODELS||[],
    genUrl:typeof nbGetImage==="function"?nbGetImage(p.id):"",
    genMeta:typeof nbGetMeta==="function"?nbGetMeta(p.id):null,slotHasRef:false,
    opts:{
      entity:p,buildFinal:build,
      buildSimple:()=>typeof buildSimplePropPrompt==="function"?buildSimplePropPrompt(p):build(),
      attachments:async()=>{
        ownerUrl=await propOwnerSheetUrl(p);
        if(stopNow()) throw stopped();
        // Capture the source version alongside the pixels, not after generation.
        ownerMeta=typeof nbGetMeta==="function"?nbGetMeta(p.ownerId):null;
        return ownerUrl?[{url:ownerUrl,kind:"owner",note:p.ownerName||"Owner character",
          refId:p.ownerId,refVersion:ownerMeta&&ownerMeta.version,refGenerated:ownerMeta&&ownerMeta.iso}]:[];
      },
      attachmentsText:()=>ownerUrl?propOwnerNote(p):"",
      // the second try is sent right after this: said only when it really goes out
      assertFreshBeforeFallback:async()=>{ if(stopNow()) throw stopped();
        if(typeof o.onRetry==="function"){ try{ o.onRetry(); }catch(e){} } },
      assertPostGenerate:async()=>{ if(stopNow()) throw stopped(); },
      metaExtra:()=>({specPrompt:build(),anchorOwnerId:ownerUrl?p.ownerId:undefined,
        anchorOwnerName:ownerUrl?p.ownerName:undefined,anchorIso:ownerMeta&&ownerMeta.iso})
    },
    ui:{setGenErr:message=>{ if(!message) return;
        if(typeof o.onError==="function"){ try{ o.onError(message); }catch(e){} return; }
        if(typeof window.appToast==="function")window.appToast(message,"error"); },
      setGening:noop,setRetrying:noop,setGenUrl:noop,setGenTier:noop,setGenMeta:noop}
  },{batch:true}));
}
window.generatePropSheet = generatePropSheet;

/* HANDS-FREE RE-BAKE GATE — decides whether a finished background worn-prop batch may
   auto-regenerate the owner's master sheet (the app-level bootstrap). Pure + exported so
   the headless suite can exercise every refusal; ok:false always names its reason. */
function wornRebakeGate(o){
  o = o || {};
  if(!o.total)                  return { ok:false, reason:"no-worn-props" };
  if((o.failed||0) > 0)         return { ok:false, reason:"batch-had-failures" };
  if((o.done||0) < o.total)     return { ok:false, reason:"batch-incomplete" };
  // every sheet pre-existed → the master already attached them when it generated;
  // a re-bake would spend credits repainting an identical wardrobe
  if(!(o.newlyBuilt > 0))       return { ok:false, reason:"nothing-new-built" };
  if(o.inflight)                return { ok:false, reason:"generation-in-flight" };
  if(String(o.sheetIsoStart||"") !== String(o.sheetIsoNow||""))
                                return { ok:false, reason:"sheet-changed-during-batch" };
  if((o.epochStart||null) !== (o.epochNow||null))
                                return { ok:false, reason:"switched-film" };
  if(!o.canMutate)              return { ok:false, reason:"read-only" };
  return { ok:true, reason:"" };
}
window.wornRebakeGate = wornRebakeGate;

/* image-to-image from a dropped reference photo of the real object */
function buildPropFromPhotoPrompt(p, project){
  const style = p.renderStyle || ((typeof window.renderStyleText==="function")
    ? window.renderStyleText("prop", p.renderStyleKey || propInheritedStyleKey(p))
    : "photoreal product reference, 85mm, soft even studio lighting");
  let s = "Master prop reference sheet \u2014 "+(p.name||"Object")+". ";
  s += "BASE OBJECT: reproduce EXACTLY the object shown in the reference photo \u2014 its shape, ";
  s += "proportions, colour, material and finish. Do not redesign or stylise it. ";
  s += (p.detail ? ("Significance: "+p.detail.replace(/\.$/,"")+". ") : "");
  s += "RENDER STYLE: "+style.replace(/\.$/,"")+". ";
  // (2026-10-08) the same 4-panel layout as every other prop sheet (it used to ask for a 360 turnaround
  // with a back view and a detail column, so photo-made sheets came out in a different layout)
  s += "LAYOUT: a 4-panel object reference sheet in 16:9 landscape, four equal panels divided by thin clean lines \u2014 hero three-quarter view, front elevation, side profile, and a detail macro close-up of its signature feature and material; no back view, no extra angles; ";
  s += "Flat off-white / very light neutral panel background, even and clean, with a simple soft contact shadow beneath the object, no text, no labels, no annotations, soft studio lighting, no people, no hands, ";
  s += "the SAME identical object in every view, sharp focus.";
  return s;
}
window.buildPropFromPhotoPrompt = buildPropFromPhotoPrompt;

function propVisualsDrafted(p){
  return !!((p.form||"").trim() && (p.material||"").trim());
}

/* A prop that rides as TEXT in shots: its reviewed evidence says it doesn't need its own
   image (PropScreenplay.sheetTier) and none has been made. An existing image always
   attaches. Worn items keep their own rule (the owner's character sheet). */
function propTextOnly(p){
  if(!p || (p.kind||"carried")==="worn" || !window.PropScreenplay) return false;
  if(window.PropScreenplay.sheetTier(p,(window.turnContinuity||{}).drafts).tier!=="text") return false;
  try{ return !(typeof nbGetImage==="function" && nbGetImage(p.id)); }catch(e){ return true; }
}
window.propTextOnly = propTextOnly;

/* a soft, neutral object swatch for the avatar dot (props have no character colour) */
function propSwatch(kind){
  return kind==="worn"
    ? "linear-gradient(135deg,#6a6cae,#26243f)"
    : "linear-gradient(135deg,#b8412e,#5a2018)";
}

/* PropFittingModal — the FITTING view: owner sheet and prop sheet side by side, with an
   optional vision critique ("does this object belong to this character?"). Read-only;
   fixes stay manual (Regenerate / the QA apply flow). */
function PropFittingModal({ p, propUrl, onClose }){
  const [ownerUrl, setOwnerUrl] = React.useState("");
  const [crt, setCrt] = React.useState(null);   // null | {busy:true} | {text,verdict} | {error}
  React.useEffect(()=>{ let live=true;
    (async()=>{
      try{ const u = (typeof propOwnerSheetUrl==="function") ? await propOwnerSheetUrl(p) : "";
        if(live) setOwnerUrl(u||""); }catch(e){}
    })();
    return ()=>{ live=false; };
  },[p.id, p.ownerId]);
  const runCritique = async ()=>{
    if(typeof aiVisionComplete!=="function" || (crt && crt.busy)) return;
    setCrt({busy:true});
    try{
      const r = await aiVisionComplete(
        [{ role:"user", content: buildPropFittingPrompt(p, !!ownerUrl) }],
        [ownerUrl, propUrl].filter(Boolean));
      // fail safe like the other QA paths: a text-only (blind) response gets NO verdict
      if(r && r.vision===false){
        setCrt({ error:"The vision model didn\u2019t receive the images \u2014 no verdict. Check the writing engine and try again — nothing was judged." });
        return;
      }
      const m = /^VERDICT:\s*(belongs|drifted|mismatch)\s*$/im.exec((r && r.text) || "");
      setCrt({ text:(r&&r.text)||"", verdict: m ? m[1].toLowerCase() : "" });
    }catch(e){ setCrt({ error:(e&&e.message)||"Critique failed" }); }
  };
  const fig = (url, lab)=> React.createElement("figure",{style:{margin:0,flex:1,minWidth:160}},
    url
      ? React.createElement("img",{src:url,alt:lab,style:{width:"100%",borderRadius:10,display:"block"}})
      : React.createElement("div",{className:"state-empty"},"No sheet yet"),
    React.createElement("figcaption",{className:"obj-lab",style:{margin:"4px 0 0"}},lab));
  const RD = (typeof ReactDOM!=="undefined") ? ReactDOM : window.ReactDOM;
  return RD.createPortal(
    React.createElement("div",{style:{position:"fixed",inset:0,zIndex:90,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"rgba(6,6,10,.72)"},
      onClick:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
      React.createElement("div",{className:"qa-modal",style:{width:"min(880px,94vw)"}},
        React.createElement("div",{className:"qa-head"},
          React.createElement("span",{className:"qa-orb"},React.createElement(Icon.box,{s:18})),
          React.createElement("div",{style:{flex:1}},
            React.createElement("div",{style:{fontWeight:600}},(p.name||"Object")+" \u00b7 fitting"),
            React.createElement("div",{className:"obj-lab"},"against "+(p.ownerName||"its owner"))),
          React.createElement("button",{className:"ag-x",title:"Close",onClick:onClose},React.createElement(Icon.x,{s:14}))),
        React.createElement("div",{style:{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}},
          fig(ownerUrl, (p.ownerName||"Owner")+" \u2014 character sheet"),
          fig(propUrl, (p.name||"Object")+" \u2014 prop sheet")),
        !ownerUrl && React.createElement("div",{className:"state-hint",style:{marginTop:10}},
          React.createElement(Icon.alert,{s:12}),
          "Generate "+(p.ownerName||"the owner")+"\u2019s sheet for a true fitting \u2014 the critique then judges against their actual look."),
        React.createElement("div",{style:{display:"flex",gap:10,alignItems:"center",marginTop:12}},
          React.createElement("button",{className:"state-add-btn",disabled:!!(crt&&crt.busy),onClick:runCritique,
            title:"Ask the writing engine to look at both sheets — one vision call, writing credits"},
            crt&&crt.busy ? "Judging\u2026" : (crt&&(crt.text||crt.error) ? "Re-run critique" : "Critique the fit")),
          !(crt&&crt.busy) && React.createElement("span",{className:"obj-lab",style:{margin:0}},"Uses writing credits"),
          crt && crt.verdict && React.createElement("span",{className:"obj-lab",style:{margin:0,display:"inline-flex",alignItems:"center",gap:6}},
            React.createElement("span",{className:"qa-dot "+(crt.verdict==="belongs"?"minor":"major")}),crt.verdict)),
        crt && crt.error && React.createElement("div",{className:"state-hint",style:{marginTop:8}},
          React.createElement(Icon.alert,{s:12}),crt.error),
        crt && crt.text && React.createElement("pre",{style:{whiteSpace:"pre-wrap",font:"inherit",fontSize:12,margin:"10px 0 0",opacity:.92}},crt.text))),
    document.body);
}

/* does this prop's owner have a character sheet yet? (sync cache first, then storage) */
async function propOwnerHasSheet(p){
  if(!p || !p.ownerId) return true;
  let u = (typeof nbGetImage==="function") ? nbGetImage(p.ownerId) : "";
  if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(p.ownerId); }catch(e){} }
  return !!u;
}
window.propOwnerHasSheet = propOwnerHasSheet;
const PROP_HERO_MAX = 3;
window.PROP_HERO_MAX = PROP_HERO_MAX;
function PropSheet({ p, project, characters, scenes, drafts, onUpdate, onDelete, onDraft, onEnsureOwner, batchOwnerChoice, drafting, onView, batchActiveId, onBatchDone, onChipClick, onSourceClick, dupIds, dupProps, onMerge, sameProps, derivedScenes, heroCount=0 }){
  const d = propDefaults(p);
  const finalPrompt = combinedPropPrompt(p, project);
  const drafted = propVisualsDrafted(p);
  // (2026-10-29) only a story prop (one made by hand or kept) says "Not in screenplay"; any other card says it isn't a story prop
  const unverified = window.PropScreenplay.notInScreenplay(p) && window.PropScreenplay.isStoryProp(p);
  // (owner 2026-10-29) a story prop passes the tests (it returns, changes or carries a turn) or is the user's choice
  const storyProp = window.PropScreenplay.isStoryProp(p);
  const sig = window.PropScreenplay.significance(p);
  const tier = window.PropScreenplay.sheetTier(p, drafts);

  // render style — same dropdown + "Surprise me" behaviour as the character cards
  const [styling, setStyling] = React.useState(false);
  // transient "saved · unlock" chip — visible ~4s after landing on the user's own locked style
  const [unlockVisible, setUnlockVisible] = React.useState(false);
  React.useEffect(()=>{
    if(window.turnIsUserStyle && window.turnIsUserStyle(p.renderStyleKey)){
      setUnlockVisible(true); const t=setTimeout(()=>setUnlockVisible(false),4000); return ()=>clearTimeout(t);
    }
    setUnlockVisible(false);
  },[p.renderStyleKey]);
  const propBible = ()=> [p.name&&("Name: "+p.name), p.ownerName&&("Owner: "+p.ownerName),
    p.form&&("Form: "+p.form), p.material&&("Material: "+p.material), p.detail&&("Significance: "+p.detail),
    p.relation&&("Relationship: "+p.relation), p.scale&&("Scale against owner: "+p.scale),
    (typeof custodyChainLabel==="function" && custodyChainLabel(p, scenes)) && ("Custody: "+custodyChainLabel(p, scenes)),
    (project&&project.genre)&&("Genre: "+project.genre)].filter(Boolean).join("\n");
  const rollSurprise = async ()=>{
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    setStyling(true);
    try{ const r = await aiSurpriseStyleText({ name:p.name, kind:"prop", bible:propBible() }, project);
      if(r) onUpdate(p.id, { surpriseRender:r, renderStyle:r.style }); }catch(e){}
    setStyling(false);
  };
  const pickPropStyle = async (key)=>{
    if(key!=="surprise"){ onUpdate(p.id, { renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function" ? window.renderStyleText("prop", key) : (PROP_RENDER_TEXT[key]||PROP_RENDER_TEXT.photoreal)) }); return; }
    onUpdate(p.id, { renderStyleKey:"surprise" });
    if(p.surpriseRender && p.surpriseRender.style){ onUpdate(p.id, { renderStyle:p.surpriseRender.style }); return; }
    await rollSurprise();
  };
  // LOCK a surprise style → a reusable named style. The prop surprise is a STRING, so wrap it
  // into a minimal render block ({rendering, rules}) the shared registry can resolve everywhere.
  const lockSurprise = async ()=>{
    if(!(p.surpriseRender && p.surpriseRender.style) || typeof window.turnLockRenderStyle!=="function") return;
    const block = { rendering:String(p.surpriseRender.style), rules:["no text, labels, watermarks, annotations, typography or captions"] };
    const key = await window.turnLockRenderStyle(p.surpriseRender.label, block);
    if(key){ onUpdate(p.id, { renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function"?window.renderStyleText("prop",key):p.surpriseRender.style) });
      if(typeof window.appToast==="function") window.appToast("Style locked — now reusable across Characters, Props & Locations"); }
  };
  const unlockCurrent = async ()=>{
    if(!(window.turnIsUserStyle && window.turnIsUserStyle(p.renderStyleKey))) return;
    const ok = window.appConfirm ? await window.appConfirm({ title:"Unlock this saved style?",
      body:"It's removed from your saved styles. Cards still using it fall back to Photoreal." }) : true;
    if(!ok) return; const k=p.renderStyleKey; window.turnUnlockRenderStyle(k);
    onUpdate(p.id,{ renderStyleKey:"photoreal", renderStyle:(typeof window.renderStyleText==="function"?window.renderStyleText("prop","photoreal"):"") });
  };
  const initials = (p.name||"?").replace(/^the\s+/i,"").split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const referenceImages = Array.isArray(p.referenceImages) ? p.referenceImages.filter(r=>r&&r.url) : [];

  const gen = useImageGen({
    id: p.id, slotId: "propref-"+p.id,
    entity: p,
    buildFinal: ()=> finalPrompt,
    buildFromPhoto: ()=> buildPropFromPhotoPrompt(p, project),
    buildSimple: ()=> buildSimplePropPrompt(p),
    // reference the OWNER's character sheet so the prop matches their look (worn props
    // especially must read as part of THAT body, not a generic grey object).
    attachments: propOwnerAttachments(p),
    attachmentsText: propAttachmentsText(p),
    // record WHICH owner-sheet version this sheet was anchored against (transaction-derived)
    metaExtra: propAnchorMetaExtra(p),
    // clearing the base sheet also clears this prop's state variants (no orphans)
    relatedClearIds: ()=> (Array.isArray(p.states)?p.states:[]).map(s=> p.id+":"+s.id)
      .concat((Array.isArray(p.continuityEvents)?p.continuityEvents:[]).map(e=> e && e.referenceAssetId).filter(id=> id && String(id).indexOf(p.id+":")===0)),
    buildEdit: (instr)=>
      "Edit this prop reference sheet for "+(p.name||"the object")+". "
      +"Apply ONLY this change: "+instr+". "
      +"Preserve everything else without alteration \u2014 the exact same object shape, proportions and identity "
      +"across all panels. Keep the same 4-panel layout (hero \u00b7 front \u00b7 side \u00b7 detail) on the same flat off-white background. "
      +"Do not replace or re-imagine the object.",
  });

  // Guarantee the prop is generated WITH its owner's character sheet: if the owner has no
  // sheet yet, generate it first (drafting the owner's spec if needed), THEN the prop —
  // so the owner sheet is present as a reference. No-op for ownerless / already-sheeted.
  const genWithOwner = React.useCallback(async (...a)=>{
    /* cross-instance guard: the owner-prerequisite phase generates under the OWNER's
       id, so this prop's id is NOT in the inflight registry during that wait. A card
       remounting mid-sequence must not start the sequence a second time (double owner
       generation = double credit spend). Held until the prop's own generation has
       registered itself, then released. */
    window.__nbOwnerPhase = window.__nbOwnerPhase || {};
    if(window.__nbOwnerPhase[p.id] || (window.__nbGenInflight && window.__nbGenInflight[p.id])) return false;
    window.__nbOwnerPhase[p.id] = true;
    try{
      // no silent WORLD-GENERIC sheets: an ownerless carried prop has no character
      // anchor, so confirm before generating one by hand (batch skips these outright)
      if((p.kind||"carried")==="carried" && !p.ownerId && typeof window.appConfirm==="function"){
        const ok = await window.appConfirm({
          title:"No owner \u2014 generate world-generic?",
          body:(p.name||"This prop")+" isn't assigned to a character, so its sheet will be generated with no character anchor \u2014 generic world style, nothing that ties it to a person. Assign an owner first for a prop that belongs to someone.",
          confirmLabel:"Generate anyway", cancelLabel:"Cancel" });
        if(!ok) return false;
      }
      // THE OWNER'S SHEET FIRST — ASKED, NEVER SILENT (2026-10-03, owner): it used to be made
      // (and the owner's look drafted) behind the prop's one-image price. A batch asks once, up
      // front (batchOwnerChoice: "owner" | "skip"); a single generate asks here.
      if(onEnsureOwner && p.ownerId && !(await propOwnerHasSheet(p))){
        const isBatch = !!(a[0] && a[0].batch);
        let choice = isBatch ? (batchOwnerChoice==="owner") : true;
        if(!isBatch && typeof window.appConfirm==="function"){
          const who = p.ownerName||"The owner";
          const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(1) : "";
          const res = await window.appConfirm({
            title:who+" has no character sheet yet",
            body:(p.name||"This prop")+" matches its owner best when it's made with "+who+"'s sheet as a reference. Make "+who+"'s sheet first"
              +(price?" (about "+price+" credit"+(price==="1"?"":"s")+" more":" (one more image")+", plus drafting their look if it isn't written yet), then the prop \u2014 or make the prop on its own now.",
            confirmLabel:"Make "+who+"'s sheet first", altLabel:"Make the prop only", cancelLabel:"Cancel" });
          if(res===false || res==null) return false;
          choice = res===true;
        }
        if(choice){ try{ await onEnsureOwner(p); }catch(e){} }
      }
      return await gen.generate(...a);
    }finally{ delete window.__nbOwnerPhase[p.id]; }
  },[gen, onEnsureOwner, p, batchOwnerChoice]);
  const genForFrame = onEnsureOwner ? { ...gen, generate: genWithOwner } : gen;

  /* ---- batch generation: when the parent activates this card (its id == the
     batch's current id), kick off a generation and report completion so the
     queue advances. Watches gen.gening for the true->false transition. ---- */
  // REMOUNT-SAFE (see CharacterSheet): seed batchStarted from the in-flight registry so a
  // card remounting mid-generation doesn't fire a second generate on completion.
  // Keyed by the GEN id (p.id — what useImageGen registers), NOT the "propref-" slot key
  // (the slot key made this guard dead code → double generation after a remount).
  // also treat the owner-prerequisite phase as in-flight — during it the prop's own
  // id isn't registered yet (the OWNER's generation is), but the sequence has started
  const _pgen = p.id;
  const _pInflight = ()=> !!((window.__nbGenInflight && window.__nbGenInflight[_pgen]) || (window.__nbOwnerPhase && window.__nbOwnerPhase[_pgen]));
  const batchStarted = React.useRef(_pInflight());
  const wasGening = React.useRef(false);
  React.useEffect(()=>{
    const mine = batchActiveId===p.id;
    const inflight = _pInflight();
    if(!mine){ batchStarted.current=inflight; wasGening.current=gen.gening; return; }
    if(!batchStarted.current && !gen.gening && !inflight){
      batchStarted.current = true; wasGening.current = false;
      genWithOwner({ batch:true });         // the owner sheet first only if the batch said so
      return;
    }
    if(batchStarted.current && wasGening.current && !gen.gening){
      batchStarted.current = false;
      onBatchDone && onBatchDone(p.id);
    }
    wasGening.current = gen.gening;
  },[batchActiveId, gen.gening, p.id]);

  const [fitOpen, setFitOpen] = React.useState(false);   // the fitting view (owner sheet · prop sheet side by side)
  const [bindingOpen, setBindingOpen] = React.useState(false);

  const continuityEvents = Array.isArray(p.continuityEvents) ? p.continuityEvents : [];
  const legacyAppearanceStates = Array.isArray(p.states) ? p.states : [];
  const legacyCustody = Array.isArray(p.custody) ? p.custody : [];
  const legacySignature = legacyAppearanceStates.map(st=>[st&&st.id,st&&st.sceneId,st&&st.label,st&&st.change].join(":" )).join("|")
    +"#"+legacyCustody.map(cu=>[cu&&cu.id,cu&&cu.charId,cu&&cu.fromSceneId].join(":")).join("|");
  React.useEffect(()=>{
    if(!legacyAppearanceStates.length && !legacyCustody.length) return;
    const merged=continuityEvents.slice();
    legacyAppearanceStates.forEach((st,i)=>{
      const legacy=_propLegacyStateEvent(p,st,i);
      const event={ ...legacy }; delete event._legacy; delete event._seq;   // explicit copy (no object-rest: shared Babel helper)
      if(!merged.some(e=>e&&(e.referenceAssetId===event.referenceAssetId||e.referenceStateId===event.referenceStateId))){
        merged.push(event);
      }
    });
    // Older scene-level custody handovers become ordinary handed_over story events.
    legacyCustody.forEach((cu,i)=>{
      const legacy=_propLegacyCustodyEvent(cu,i);
      if(!legacy) return;
      const event={ ...legacy }; delete event._legacy; delete event._seq;   // explicit copy (no object-rest: shared Babel helper)
      if(!merged.some(e=>e&&e.id===event.id)) merged.push(event);
    });
    // Keep the generated propId:stateId image in storage; the migrated event points to
    // it. Only the redundant data/UI models are retired.
    onUpdate(p.id,{continuityEvents:merged,states:[],custody:[]});
  },[p.id,legacySignature]);
  const addContinuityEvent = ()=> onUpdate(p.id,{continuityEvents:[...continuityEvents,{id:"pe-"+Date.now().toString(36),type:"handed_over",sceneId:"",beatId:"",microBeatId:"",shotId:"",note:""}]});
  const updateContinuityEvent = (id,patch)=> onUpdate(p.id,{continuityEvents:continuityEvents.map(e=>e.id===id?{...e,...patch}:e)});
  const deleteContinuityEvent = (id)=> onUpdate(p.id,{continuityEvents:continuityEvents.filter(e=>e.id!==id)});
  const continuityLocations = ((window.turnContinuity||{}).locations)||[];

  // scenes this prop appears in, as {no,id} sorted by story order. A stored map wins;
  // an OWNED but never-mapped prop shows its derived owner-presence scenes instead.
  // Stored mappings refresh automatically when the screenplay or scene set changes.
  const sceneById = React.useMemo(()=>{ const m={}; (scenes||[]).forEach(s=>{ m[s.id]=s; }); return m; },[scenes]);
  const sceneIds = Array.isArray(p.scenes) ? p.scenes : (Array.isArray(derivedScenes) ? derivedScenes : undefined);
  const scenesDerived = !Array.isArray(p.scenes) && Array.isArray(derivedScenes);
  const propScenes = (sceneIds||[]).map(id=>sceneById[id]).filter(Boolean);
  const screenplayMentions = React.useMemo(()=>propScreenplayMentions(p,scenes,drafts).filter(m=>!(p.screenplaySources||[]).some(s=>s.sceneId===m.sceneId&&s.block===m.block)),[p.name,p.screenplaySources,scenes,drafts]);
  const savedSources=p.screenplaySources||[], validSources=window.PropScreenplay.sources(p,drafts);
  const exactMentions = screenplayMentions.filter(m=>m.match==="exact").length;
  const possibleMentions = screenplayMentions.length-exactMentions;
  const cardRefsLoader = React.useMemo(()=>propOwnerAttachments(p),[
    p.id,p.ownerId,p.ownerName,referenceImages.map(r=>r.id||r.url).join(",")
  ]);
  const renderContinuityEvent = (e,i)=>React.createElement("div",{key:e.id,className:"state-row prop-event-row"},
    React.createElement("div",{className:"state-row-head"},
      React.createElement("span",{className:"state-vtag base"},String(i+1)),
      React.createElement("select",{className:"prop-select",value:e.type||"handed_over",onChange:ev=>updateContinuityEvent(e.id,{type:ev.target.value})},
        PROP_EVENT_TYPES.map(t=>React.createElement("option",{key:t,value:t},t.replace(/_/g," ")))),
      React.createElement("button",{className:"state-del",title:"Remove event",onClick:()=>deleteContinuityEvent(e.id)},React.createElement(Icon.x,{s:14}))),
    React.createElement("div",{className:"sheet-2col prop-event-moment"},
      React.createElement("div",{className:"sheet-field"},React.createElement("div",{className:"obj-lab"},"From scene"),
        React.createElement("select",{className:"prop-select",value:e.sceneId||"",onChange:ev=>updateContinuityEvent(e.id,{sceneId:ev.target.value})},
          React.createElement("option",{value:""},"Choose scene..."),(scenes||[]).map(s=>React.createElement("option",{key:s.id,value:s.id},"Sc "+s.no+" - "+s.title)))),
      React.createElement("div",{className:"sheet-field"},React.createElement("div",{className:"obj-lab"},"Beat / shot (optional)"),
        // PICKED, NOT TYPED (2026-10-03, owner — Props review): the beat and shot come from the chosen
        // scene (they used to be free-text id boxes nobody could fill); a saved value not in the
        // lists still shows, so nothing already recorded is lost
        (()=>{
          const C = window.turnContinuity || {};
          const rows = (e.sceneId && C.beatsMap && C.beatsMap[e.sceneId] && C.beatsMap[e.sceneId].rows) || [];
          const sceneShots = (C.shots||[]).filter(sh=>sh && sh.sceneId===e.sceneId).slice()
            .sort((a,b)=>(_propNum(a.order,0)-_propNum(b.order,0))||(_propNum(a.beatN,0)-_propNum(b.beatN,0)));
          const beatOpts = rows.map((r,n)=>({ v:String((r&&r.id)||(r&&r.n)||(n+1)),
            l:"Beat "+((r&&r.n)||(n+1))+(r&&r.drive&&r.drive.d ? " \u2014 "+String(r.drive.d).slice(0,40) : "") }));
          const shotOpts = sceneShots.map((sh,n)=>({ v:sh.id, l:"Shot "+(n+1)+(sh.size?" \u00b7 "+sh.size:"")+(sh.beatN?" (beat "+sh.beatN+")":"") }));
          const keep = (opts, v)=> (v && !opts.some(o=>o.v===String(v))) ? [{ v:String(v), l:String(v)+" (saved)" }, ...opts] : opts;
          const sel = (k, label, opts, none)=> React.createElement("select",{key:k,className:"prop-select prop-event-pick","aria-label":label,
              value:e[k]||"", disabled:!e.sceneId, onChange:ev=>updateContinuityEvent(e.id,{[k]:ev.target.value})},
            React.createElement("option",{value:""},none),
            keep(opts, e[k]).map(o=>React.createElement("option",{key:o.v,value:o.v},o.l)));
          return React.createElement("div",{className:"prop-event-inline"},
            sel("beatId","Beat",beatOpts,e.sceneId?"Whole scene":"Choose a scene first"),
            e.beatId ? sel("microBeatId","Micro-beat",[1,2,3,4,5,6,7,8].map(n=>({ v:String(n), l:"Micro "+n })),"Any micro-beat") : null,
            sel("shotId","Shot",shotOpts,shotOpts.length?"Any shot":"No shots yet"));
        })())),
    (["acquired","handed_over","recovered"].includes(e.type||"handed_over")) && React.createElement("div",{className:"sheet-field"},
      React.createElement("div",{className:"obj-lab"},"Holder / user after event"),
      React.createElement("select",{className:"prop-select",value:e.holderId||e.toCharacterId||"",onChange:ev=>{const ch=(characters||[]).find(x=>x.id===ev.target.value);updateContinuityEvent(e.id,{holderId:ev.target.value,holderName:ch?ch.name:""});}},
        React.createElement("option",{value:""},"Unassigned"),(characters||[]).map(c=>React.createElement("option",{key:c.id,value:c.id},c.name)))),
    e.type==="placed" && React.createElement("div",{className:"sheet-field"},
      React.createElement("div",{className:"obj-lab"},"Physical placement"),
      React.createElement("select",{className:"prop-select",value:e.locationId||"",onChange:ev=>updateContinuityEvent(e.id,{locationId:ev.target.value})},
        React.createElement("option",{value:""},"Choose location..."),continuityLocations.map(l=>React.createElement("option",{key:l.id,value:l.id},l.name)))),
    React.createElement(SheetField,{label:"Event note / condition",value:e.note||e.condition||"",placeholder:"Placed on the dashboard / cracked during the struggle...",onCommit:val=>updateContinuityEvent(e.id,{note:val,...(e.type==="damaged"?{condition:val||"damaged"}:{})})}),
    e.type==="updated"&&React.createElement(React.Fragment,null,
      React.createElement(SheetField,{label:"Document / screen content after this event",value:e.contentNotes,multiline:true,onCommit:val=>updateContinuityEvent(e.id,{contentNotes:val})}),
      React.createElement(SheetField,{label:"Content version",value:e.contentVersion,placeholder:"Red corrections / opened letter / updated call log",onCommit:val=>updateContinuityEvent(e.id,{contentVersion:val})})),
    e.referenceAssetId && typeof nbGetImage==="function" && nbGetImage(e.referenceAssetId) &&
      React.createElement("div",{className:"state-hint"},React.createElement(Icon.image,{s:12}),
        "Visual condition reference retained from the earlier Appearance State.")
  );

  return React.createElement("div",{className:"sheet-card"+(batchActiveId===p.id?" batch-on":""),"data-prop-card":p.id},
    React.createElement(SheetFrame,{ gen:genForFrame, slotId:"propref-"+p.id, name:p.name, avatarColor:propSwatch(p.kind),
      hideSourceReview:true,
      initials, drafted, drafting, onDraft:()=>onDraft(p), entity:p, onView,
      slotPlaceholder:"Drop a photo of the object", noun:"prop sheet",
      // The empty slot is also the finished-image importer (full resolution, like the Locations
      // plate), so the separate "Upload a finished sheet" button is intentionally omitted.
      dropToImport:true,
      specGate:{ ready:!window.PropScreenplay.nameIssue(p.name)&&(drafted || !p.manual), hint:window.PropScreenplay.nameIssue(p.name)||"Draft the design spec first \u2014 form & material are what the sheet is built from." },
      referenceControls: window.SheetReferenceStrip && React.createElement(window.SheetReferenceStrip,{
        gen, loadRefs:cardRefsLoader, onView,
        refreshKey:[p.id,p.ownerId,referenceImages.map(r=>r.id||r.url).join(",")].join("|")
      }),
      // WORN items: the character sheet stays their default canon (wides/mediums).
      // A separate CLOSE-UP macro sheet is OPTIONAL, generated per-card on demand
      // against the OWNER's sheet (so the designs agree); it attaches to shots only
      // at CU/MCU/ECU/INSERT sizes where the item reads large. Batch generation
      // still skips worn items.
      onDelete:()=>onDelete(p.id), deleteLabel:"Delete prop" }),
    React.createElement("div",{className:"sheet-body"},
      React.createElement("div",{className:"sheet-head"},
        React.createElement("div",{style:{flex:1,minWidth:0}},
          React.createElement("div",{className:"prop-name-row"},
            React.createElement("button",{type:"button",
              className:"prop-kind-badge prop-binding-badge "+(p.kind==="worn"?"worn":p.kind==="dressing"?"dressing":"carried")+(bindingOpen?" open":""),
              "aria-label":(p.kind==="dressing"?"Set dressing location: ":"Prop owner: ")+(p.kind==="dressing"
                ? (((typeof propHomeLocation==="function") && (propHomeLocation(p)||{}).name) || "No location assigned")
                : (p.ownerName||"Unassigned")),
              "aria-expanded":bindingOpen?"true":"false",
              onClick:(e)=>{ e.stopPropagation(); setBindingOpen(v=>!v); },
              onBlur:()=>setBindingOpen(false)},
              React.createElement("span",{className:"prop-binding-label"},p.kind==="dressing" ? "set dressing" : (p.kind||"carried")),
              React.createElement("span",{className:"prop-binding-owner-icon","aria-hidden":"true"},
                React.createElement(p.kind==="dressing"?Icon.globe:Icon.user,{s:8})),
              React.createElement("span",{className:"prop-binding-pop",role:"tooltip"},
                React.createElement("b",null,p.kind==="dressing"?"Location":"Owner"),
                React.createElement("span",null,p.kind==="dressing"
                  ? (((typeof propHomeLocation==="function") && (propHomeLocation(p)||{}).name) || "No location assigned")
                  : (p.ownerName||"Unassigned")))),
            React.createElement("div",{className:"sheet-name",title:p.name||""},
              React.createElement(EditText,{value:p.name,placeholder:"Prop name\u2026",onCommit:val=>onUpdate(p.id,{name:val})})),
            // HERO PROP (2026-10-24, from the Anerneq study): up to three objects the film turns on are
            // described in full in every Stage clip they're in, so they never drift between takes
            (()=>{ const full = !p.hero && heroCount>=PROP_HERO_MAX;
              return React.createElement("button",{type:"button",className:"prop-hero-btn"+(p.hero?" on":""),
                "aria-pressed":p.hero?"true":"false","aria-label":p.hero?"Hero prop \u2014 click to unmark":"Mark as a hero prop",
                disabled:full,
                title:p.hero ? "Hero prop: described in full (form, material, identifying details, size) in every Stage clip it's in, so it never changes between takes. Click to unmark."
                  : full ? "Up to "+PROP_HERO_MAX+" hero props a film \u2014 unmark one first."
                  : "Mark as a hero prop: one of the few objects the film turns on. It's described in full in every Stage clip it's in, so it never changes between takes (up to "+PROP_HERO_MAX+").",
                onClick:(e)=>{ e.stopPropagation(); if(!full) onUpdate(p.id,{hero:!p.hero}); }},"\u2605"); })(),
            p.kind==="worn" && window.InfoTip && React.createElement(window.InfoTip,{
              label:"How worn prop sheets work",
              text:"Worn items are rendered on "+(p.ownerName||"the character")+"'s character sheet and that remains the canon for wide and medium shots. Generate a separate macro sheet here only when the item needs to read clearly in a close-up. The macro sheet uses the owner sheet as visual context and attaches to CU, MCU, ECU and INSERT shots. Batch generation skips these optional macro sheets."
            })),
          // A SHORT NAME (owner 2026-10-29): a name that is a whole description is offered its first part
          (storyProp && !p.longNameOk && propShortName(p.name)) && React.createElement("div",{className:"prop-status-row prop-shortname-row","data-testid":"prop-short-name"},
            React.createElement("span",{className:"prop-shortname-text"},"Long name \u2014 shorten it to ",
              React.createElement("b",null,"\u201c"+propShortName(p.name)+"\u201d"),"? The full description stays on the card."),
            React.createElement("button",{type:"button",className:"char-draft-btn ghost",
              title:"Rename the card; the full description is kept under Other names (so the character's list still finds it) and, if the card has no form yet, as its form",
              onClick:()=>{ const patch = propShortNamePatch(p); if(patch) onUpdate(p.id, patch); }},"Shorten"),
            React.createElement("button",{type:"button",className:"char-draft-btn ghost",title:"Keep the long name and stop suggesting a shorter one",
              onClick:()=>onUpdate(p.id,{longNameOk:true})},"Keep")),
          (p.kind!=="worn" && tier.tier==="text") && React.createElement("div",{className:"prop-status-row"},
            React.createElement("span",{className:"prop-status-pill",
              title:"Text only ("+tier.reason.toLowerCase()+"). Shots describe this object from its specification instead of attaching an image, and batch generation skips it. Change it in Object → Reference image, or generate an image on this card — an existing image is always used."},
              React.createElement(Icon.layers,{s:10}),"Text only")),
          // WHY IT'S A PROP (owner 2026-10-29): a story prop says why; any other card says why not, and can be kept
          storyProp && !!sig.reasons.length && React.createElement("div",{className:"prop-status-row","data-testid":"prop-why"},
            React.createElement("span",{className:"prop-why"},React.createElement("b",null,"Why it's a prop: "),sig.reasons.join(" \u00b7 "))),
          !storyProp && React.createElement("div",{className:"prop-status-row prop-proposed-row","data-testid":"prop-not-story"},
            React.createElement("span",{className:"prop-status-pill unverified",
              title:propOriginLabel(p)+". Only objects the story depends on are props: ones that come back, that something happens to, or that the story turns on. Batches and agents leave this card alone. Read the screenplay again to re-check it, keep it as a story prop, or move it to Recently deleted."},
              React.createElement(Icon.alert,{s:10}),"Not a story prop"),
            React.createElement("span",{className:"prop-notstory-why"},window.PropScreenplay.notPropReason(p)),
            React.createElement("button",{type:"button",className:"char-draft-btn ghost",
              title:"Keep this object as a story prop — batches can then draft it and make its image. It keeps its origin.",
              onClick:()=>onUpdate(p.id, window.PropScreenplay.acceptPatch())},
              React.createElement(Icon.check,{s:12}),"Keep as a story prop")),
          // the screenplay badges (2026-10-29: they were inside the evidence section's header)
          (unverified || (!!savedSources.length && validSources.length<savedSources.length)) && React.createElement("div",{className:"prop-status-row","data-testid":"prop-screenplay-badges"},
            unverified && React.createElement("span",{className:"prop-evidence-flag"},
            React.createElement("span",{className:"prop-status-pill unverified",
              title:propOriginLabel(p)+". The screenplay has not established this object"+(p.kind==="worn"?" \u2014 normal for wardrobe choices.":".")
                +" Read the screenplay for props and link a passage to this card to confirm it, or delete it if the story doesn't need it."},
              React.createElement(Icon.alert,{s:10}),"Not in screenplay")),
            // a reviewed passage the screenplay no longer has (a redraft rewrote it): said on the closed section too
          !!savedSources.length && validSources.length<savedSources.length && React.createElement("span",{className:"prop-evidence-flag"},
            React.createElement("span",{className:"prop-status-pill unverified",
              title:"The screenplay changed: "+(savedSources.length-validSources.length)+" reviewed passage"+(savedSources.length-validSources.length!==1?"s are":" is")
                +" no longer in it, so this object no longer counts as in "+((savedSources.length-validSources.length)!==1?"those scenes":"that scene")
                +". Read the screenplay again to review it; the object and its images are kept."},
              React.createElement(Icon.alert,{s:10}),(savedSources.length-validSources.length)+" source"+(savedSources.length-validSources.length!==1?"s":"")+" changed"))),
          p.kind==="dressing" && React.createElement("div",{className:"prop-worn-note",
            title:"Two ways to place this fixture into its location's plate: open the plate's Edit panel and click this fixture's Set-dressing chip (inserts an edit instruction built from this card's spec), or \u2014 once this sheet is generated \u2014 use the chip's attach button to ALSO ride this sheet along as a reference image, locking the exact design."},
            React.createElement(Icon.sparkles,{s:12}),
            React.createElement("span",null,"Placed into ",React.createElement("b",null,((typeof propHomeLocation==="function") && (propHomeLocation(p)||{}).name) || "its location"),"'s plate via the plate's Edit panel \u2014 by prompt, or prompt + this sheet as reference"))),
        React.createElement("div",{className:"sheet-head-actions"},
          React.createElement("button",{className:"char-draft-btn"+(drafting?" busy":""),disabled:drafting||!!window.PropScreenplay.nameIssue(p.name),title:window.PropScreenplay.nameIssue(p.name)||"Draft the object's design from its evidence",onClick:()=>onDraft(p)},
            React.createElement(Icon.sparkles,{s:12}), drafting?"Drafting\u2026":"Draft specification"),
          window.QaCheckButton && React.createElement(window.QaCheckButton,{ gen:genForFrame, name:p.name, noun:"prop sheet",
            specFields:()=>({ form:(p.form||""), material:(p.material||""), detail:(p.detail||""), size:(p.size||""), scale:(p.scale||"") }),
            onApplySpec:(patch)=>onUpdate(p.id, patch) }),
          // FITTING — side-by-side owner sheet · prop sheet with an optional vision critique
          (p.ownerId && gen.genUrl) && React.createElement("button",{className:"char-draft-btn ghost",
            title:"Fitting view \u2014 "+(p.name||"the object")+" side by side with "+(p.ownerName||"its owner")+"\u2019s sheet, with an optional AI critique of whether they belong together",
            onClick:()=>setFitOpen(true)},
            React.createElement(Icon.box,{s:12}),"Fitting")),
          fitOpen && React.createElement(PropFittingModal,{ p, propUrl:gen.genUrl, onClose:()=>setFitOpen(false) })),

      React.createElement("div",{className:"char-style-row"},
        React.createElement("span",{className:"char-style-lab"},"Render style"),
        React.createElement("div",{className:"char-style-pick"},
          React.createElement(window.RenderStylePicker,{context:"prop",value:p.renderStyleKey||propInheritedStyleKey(p)||(window.turnDefaultRenderStyleKey?window.turnDefaultRenderStyleKey():"photoreal"),disabled:styling,onPick:pickPropStyle}),
          (window.turnCanLockStyles && window.turnCanLockStyles()) && React.createElement("span",{className:"char-style-count"+(((window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)>=(window.turnGlobalStyleCap||40))?" full":""),title:"Global render styles ("+(window.turnGlobalStyleCap||40)+" max, admin-managed). You can save up to "+(window.turnPersonalStyleCap||10)+" personal render styles. The admin manages them via Styles in the Film menu."}, (window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)+"/"+(window.turnGlobalStyleCap||40))),
        styling && React.createElement("span",{className:"char-style-busy"},React.createElement("span",{className:"ns-spin"}),"Inventing\u2026"),
        (!styling && p.renderStyleKey==="surprise" && p.surpriseRender && p.surpriseRender.label) &&
          React.createElement("span",{className:"char-style-name",title:"Re-roll a new surprise style — one small writing call (writing credits)",onClick:rollSurprise},
            p.surpriseRender.label," \u21bb"),
        (!styling && p.renderStyleKey==="surprise" && p.surpriseRender && p.surpriseRender.style && window.turnCanLockStyles && window.turnCanLockStyles()) &&
          React.createElement("button",{className:"char-style-lock",title:"Lock this style \u2014 keep it and reuse it across Characters, Props & Locations",onClick:lockSurprise},"\ud83d\udd12 Lock this style"),
        (!styling && unlockVisible && window.turnIsUserStyle && window.turnIsUserStyle(p.renderStyleKey)) &&
          React.createElement("span",{className:"char-style-name char-style-locked",title:"Your saved style \u2014 reusable everywhere. Click to unlock.",onClick:unlockCurrent},"\ud83d\udd12 saved \u00b7 unlock")),

      (sceneIds!==undefined) && React.createElement("div",{className:"prop-scenes"},
        React.createElement("span",{className:"prop-scenes-lab",
            title: scenesDerived ? "Automatically derived from "+(p.ownerName||"the owner")+"'s scene presence" : "Automatically refreshed when the screenplay changes"},
            "SCENES"),
        React.createElement(SceneChipPager,{ none:"No scene appearances found",
          items: propScenes.map(s=>({ key:s.id, label:String(s.no).padStart(2,"0"), className:"prop-scene-chip",
            title:s.title||("Scene "+s.no), onClick:()=>onChipClick&&onChipClick(s.id) })) })),

      // SCREENPLAY EVIDENCE (owner 2026-10-29): a section like the others; its count is the summary, and its badges sit
      // under the name, so they show with it closed
      React.createElement(CardFold,{label:"Screenplay evidence",count:savedSources.length?(validSources.length+" reviewed"):[exactMentions?(exactMentions+" exact"):"",exactMentions&&possibleMentions?" · ":"",possibleMentions?(possibleMentions+" possible"):"",!screenplayMentions.length?"No screenplay matches":""].join(""),defaultOpen:false},
        React.createElement("div",{className:"prop-origin-label"},propOriginLabel(p)),
        !!savedSources.length&&React.createElement("div",{className:"prop-evidence-list"},savedSources.map((s,i)=>React.createElement("div",{key:i,className:"prop-evidence-quote"},
          React.createElement("button",{className:"prop-evidence-jump",onClick:()=>onSourceClick&&onSourceClick({...s,beat:s.beat})},"Scene "+s.sceneNo+(s.beat?" · Beat "+s.beat:"")),
          React.createElement("span",{className:"prop-evidence-kind"},window.PropScreenplay.sourceValid(s,drafts)?("Reviewed · "+s.presence):"Source changed — review"),
          React.createElement("blockquote",null,s.quote)))),
        (p.extractionWarnings||[]).map((w,i)=>React.createElement("p",{key:i,className:"prop-review-warning"},w)),
        !!savedSources.length&&validSources.length!==savedSources.length&&React.createElement("p",{className:"prop-review-warning"},"Some reviewed passages changed or were removed. Extract again to review appearances; your object and images are kept."),
        !!(p.screenplaySourceHistory||[]).length&&React.createElement("details",null,React.createElement("summary",null,"Earlier screenplay evidence"),(p.screenplaySourceHistory||[]).map((s,i)=>React.createElement("blockquote",{key:i},"Scene "+s.sceneNo+" · superseded source: "+s.quote))),
        screenplayMentions.length
          ? React.createElement("div",{className:"prop-evidence-list"},
              screenplayMentions.map((m,i)=>React.createElement("details",{className:"prop-evidence-row",key:m.sceneId+"-"+m.block+"-"+i},
                React.createElement("summary",{className:"prop-evidence-place"},
                  React.createElement("span",{className:"prop-evidence-loc"},
                    "Scene "+String(m.sceneNo).padStart(2,"0")+(m.beat!=null?(" · Beat "+m.beat):"")),
                  React.createElement("span",{className:"prop-evidence-kind "+m.match},
                    m.match==="exact"?"Exact text":"Possible match")),
                React.createElement("div",{className:"prop-evidence-actions"},
                  React.createElement("button",{type:"button",className:"prop-evidence-jump",
                    "aria-label":"Go to Scene "+String(m.sceneNo).padStart(2,"0"),
                    onClick:()=>onSourceClick&&onSourceClick(m)},"Scene"),
                  m.beat!=null&&React.createElement("button",{type:"button",className:"prop-evidence-jump",
                    "aria-label":"Go to Scene "+String(m.sceneNo).padStart(2,"0")+", Beat "+m.beat,
                    onClick:()=>onSourceClick&&onSourceClick(m)},"Beat")),
                React.createElement("q",{className:"prop-evidence-quote"},
                  m.fullText.slice(0,m.matchStart),
                  React.createElement("mark",null,m.fullText.slice(m.matchStart,m.matchEnd)),
                  m.fullText.slice(m.matchEnd)))))
          : !savedSources.length&&React.createElement("div",{className:"prop-evidence-none"},
              "No direct mention found in the screenplay text. This is not presented as a quoted script fact."),
        React.createElement("div",{className:"prop-evidence-caution"},
          "Text matches are discovery evidence only; even an exact phrase does not prove this is the same physical object.")),

      (dupIds && dupIds.length>1) && React.createElement("div",{className:"prop-dup-warn"},
        React.createElement("div",{className:"prop-dup-head"},
          React.createElement(Icon.alert,{s:14}),
          React.createElement("span",null,"This looks like the same object as ",
            React.createElement("b",null,(dupProps||[]).map(d=>d.name).join(", ")||((dupIds.length-1)+" other")),
            ". Merging combines their scenes \u2014 keep the card whose art & spec you prefer.")),
        // show the OTHER duplicate(s) so you can see what you're merging, each with its thumbnail
        React.createElement("div",{className:"prop-dup-cards"},
          (dupProps||[]).map(d=>{
            const u = (typeof nbGetImage==="function") ? nbGetImage(d.id) : "";
            return React.createElement("div",{key:d.id,className:"prop-dup-card"},
              u ? React.createElement("img",{src:u,alt:d.name,onClick:()=>onView&&onView(u,d)})
                : React.createElement("div",{className:"prop-dup-noimg"},React.createElement(Icon.image,{s:14})),
              React.createElement("span",{className:"prop-dup-name",title:d.name},d.name));
          })),
        React.createElement("div",{className:"prop-dup-acts"},
          React.createElement("button",{className:"prop-dup-merge",onClick:()=>onMerge&&onMerge(dupIds, p.id),
            title:"Merge all of these into THIS card \u2014 this card's art & spec are kept, their scenes are combined"},
            React.createElement(Icon.layers,{s:12}),"Merge \u2014 keep this card"))),
      // POSSIBLY THE SAME OBJECT under another owner (owner 2026-10-29): merge it, or keep them apart
      (sameProps && sameProps.length>0) && React.createElement("div",{className:"prop-dup-warn prop-same-warn","data-testid":"prop-possibly-same"},
        React.createElement("div",{className:"prop-dup-head"},
          React.createElement(Icon.alert,{s:14}),
          React.createElement("span",null,"Possibly the same object as ",
            sameProps.map((d,i)=>React.createElement(React.Fragment,{key:d.id},i?", ":"",
              React.createElement("b",null,d.name),
              (d.ownerName||d.kind==="dressing") ? " ("+(d.kind==="dressing"?"set dressing":d.ownerName)+")" : "")),
            ". If it's one object that changes hands, merge them and add the hand-over under Continuity.")),
        React.createElement("div",{className:"prop-dup-cards"},
          sameProps.map(d=>{
            const u = (typeof nbGetImage==="function") ? nbGetImage(d.id) : "";
            return React.createElement("div",{key:d.id,className:"prop-dup-card"},
              u ? React.createElement("img",{src:u,alt:d.name,onClick:()=>onView&&onView(u,d)})
                : React.createElement("div",{className:"prop-dup-noimg"},React.createElement(Icon.image,{s:14})),
              React.createElement("span",{className:"prop-dup-name",title:d.name},d.name));
          })),
        React.createElement("div",{className:"prop-dup-acts"},
          React.createElement("button",{className:"prop-dup-merge",onClick:()=>onMerge&&onMerge([p.id, ...sameProps.map(d=>d.id)], p.id),
            title:"Merge into THIS card \u2014 its owner, art & spec are kept; the other card's scenes, story events, sources, other names and references join it (you're asked first)"},
            React.createElement(Icon.layers,{s:12}),"Merge \u2014 keep this card"),
          React.createElement("button",{className:"char-draft-btn ghost",
            title:"They are different objects \u2014 stop suggesting this",
            onClick:()=>{ const ids = sameProps.map(d=>d.id);
              onUpdate(p.id,{distinctFrom:Array.from(new Set([...(p.distinctFrom||[]), ...ids]))});
              sameProps.forEach(d=>onUpdate(d.id,{distinctFrom:Array.from(new Set([...(d.distinctFrom||[]), p.id]))})); }},
            "Keep separate"))),

      // STORY & OWNERSHIP (owner 2026-10-29): what it means and who has it — split out of "Object", with the former
      // Narrative significance section
      React.createElement(CardFold,{label:"Story & ownership",defaultOpen:(!drafted && !!p.manual)},
        window.PropScreenplay.nameIssue(p.name)&&React.createElement("p",{className:"prop-review-warning"},window.PropScreenplay.nameIssue(p.name)),
        React.createElement(SheetField,{label:"What it means in the story",value:propSpecClean(p.detail),multiline:true,
          placeholder:"Why this object matters \u2014 what it represents, how it's used\u2026",onCommit:val=>onUpdate(p.id,{detail:val})}),
        React.createElement("div",{className:"sheet-2col"},
          React.createElement("div",{className:"sheet-field"},
            React.createElement("div",{className:"obj-lab"},"Owner"),
            React.createElement("select",{className:"prop-select",value:p.ownerId||"",
              onChange:e=>{ const id=e.target.value; const ch=(characters||[]).find(c=>c.id===id);
                onUpdate(p.id,{ownerId:id, ownerName: ch?ch.name:""}); }},
              React.createElement("option",{value:""},"Unassigned"),
              (characters||[]).map(c=>React.createElement("option",{key:c.id,value:c.id},c.name)))),
          React.createElement("div",{className:"sheet-field"},
            React.createElement("div",{className:"obj-lab"},"Type"),
            React.createElement("select",{className:"prop-select",value:p.kind||"carried",
              onChange:e=>onUpdate(p.id,{kind:e.target.value, kindSet:true})},
              React.createElement("option",{value:"carried"},"Carried"),
              React.createElement("option",{value:"worn"},"Worn"),
              React.createElement("option",{value:"dressing"},"Set dressing")))),
        React.createElement("div",{className:"sheet-props-note"},
          React.createElement(Icon.layers,{s:12}),
          "Type is where it usually is. Story events (under Continuity) can move it between a person, a hand and a place \u2014 it stays one prop."),
        p.kind!=="worn" && React.createElement("label",{className:"sheet-field"},React.createElement("span",{className:"obj-lab"},"Reference image"),
          React.createElement("select",{className:"prop-select",value:(p.sheetTier==="own"||p.sheetTier==="text")?p.sheetTier:"",
            title:"Whether this object gets its own reference image. Text-only objects are described in shot prompts from this card's specification; batch generation and shot renders don't spend image credits on them.",
            onChange:e=>onUpdate(p.id,{sheetTier:e.target.value})},
            React.createElement("option",{value:""},"Auto — "+(()=>{const a=window.PropScreenplay.sheetTier({...p,sheetTier:""},drafts);return (a.tier==="text"?"text only":"own image")+" ("+a.reason.toLowerCase()+")";})()),
            React.createElement("option",{value:"own"},"Own image"),
            React.createElement("option",{value:"text"},"Text only — described in shot prompts"))),
        // RELATIONSHIP — one line on how the owner relates to this object; feeds the
        // sheet prompt (condition/wear/repairs express it) and bakes into the owner's
        // character sheet for worn items. Belonging = character truth, not just style.
        p.ownerId && React.createElement(SheetField,{label:"Relationship \u2014 how "+(p.ownerName||"the owner")+" relates to it",value:p.relation,
          placeholder:"treasured \u2014 a gift from her mother \u00b7 resented \u00b7 stolen \u00b7 inherited \u00b7 borrowed \u00b7 made it themselves\u2026",
          title:"Feeds this prop's sheet prompt \u2014 its condition, wear and repairs express the relationship \u2014 and bakes into "+(p.ownerName||"the owner")+"'s character sheet for worn items.",
          onCommit:val=>onUpdate(p.id,{relation:val})}),
        // FIXTURE OF — a set-dressing object belongs to a PLACE (it bakes into that
        // location's plate and inherits its render style). Auto = the one location
        // every mapped scene resolves to; pick explicitly for e.g. apartment furniture.
        p.kind==="dressing" && React.createElement("div",{className:"sheet-field"},
          React.createElement("div",{className:"obj-lab"},"Fixture of"),
          React.createElement("select",{className:"prop-select",value:p.locationId||"",
            onChange:e=>onUpdate(p.id,{locationId:e.target.value})},
            React.createElement("option",{value:""},
              "Auto — "+(((typeof propHomeLocation==="function") && (propHomeLocation({...p, locationId:""})||{}).name) || "no single location from scenes")),
            (((window.turnContinuity||{}).locations)||[]).map(l=>React.createElement("option",{key:l.id,value:l.id},l.name||"Location")))),
        // the fields most people never need (2026-10-03, owner — Props review)
        React.createElement("details",{className:"prop-more-fields"},React.createElement("summary",null,"More detail \u2014 other names, identity, custodian, origin"),
        React.createElement(SheetField,{label:"Other names for this same object",value:(p.aliases||[]).join("; "),placeholder:"Medication notebook; dose log",onCommit:val=>onUpdate(p.id,{aliases:val.split(";").map(s=>s.trim()).filter(Boolean)})}),
        React.createElement(SheetField,{label:"Identity — distinguish from similar objects",value:p.identityNote,multiline:true,placeholder:"Marcus's phone, not Daniel's. The same phone travels between locations.",onCommit:val=>onUpdate(p.id,{identityNote:val})}),
        React.createElement("div",{className:"sheet-2col"},
          React.createElement("div",{className:"sheet-field"},
            React.createElement("div",{className:"obj-lab"},"Custodian"),
            React.createElement("select",{className:"prop-select",value:p.custodianId||p.ownerId||"",
              onChange:e=>{const ch=(characters||[]).find(c=>c.id===e.target.value);onUpdate(p.id,{custodianId:e.target.value,custodianName:ch?ch.name:""});}},
              React.createElement("option",{value:""},"Unassigned"),
              (characters||[]).map(c=>React.createElement("option",{key:c.id,value:c.id},c.name)))),
          React.createElement("div",{className:"sheet-field"},
            React.createElement("div",{className:"obj-lab"},"Design association"),
            React.createElement("select",{className:"prop-select",value:(p.associationType||"")+":"+(p.associationId||p.ownerId||p.locationId||""),
              onChange:e=>{const parts=e.target.value.split(":");const type=parts[0],id=parts[1]||"";const item=type==="character"?(characters||[]).find(x=>x.id===id):continuityLocations.find(x=>x.id===id);onUpdate(p.id,{associationType:type,associationId:id,associationName:item?item.name:""});}},
              React.createElement("option",{value:":"},"Project world"),
              React.createElement("optgroup",{label:"Characters"},(characters||[]).map(c=>React.createElement("option",{key:"c"+c.id,value:"character:"+c.id},c.name))),
              React.createElement("optgroup",{label:"Locations"},continuityLocations.map(l=>React.createElement("option",{key:"l"+l.id,value:"location:"+l.id},l.name)))))),
        React.createElement(SheetField,{label:"Owner / origin — canonical provenance",value:p.provenance||(typeof p.origin==="string"?p.origin:"")||p.ownerName||"",
          placeholder:"Originally Yusuf's · stolen police issue · found in the Minicab…",onCommit:val=>onUpdate(p.id,{provenance:val})}))),

      // PHYSICAL DESIGN (owner 2026-10-29): what it looks like — the fields the sheet is drawn from
      React.createElement(CardFold,{label:"Physical design",defaultOpen:(!drafted && !!p.manual)},
        React.createElement(SheetField,{label:"Form \u2014 shape & silhouette",value:propSpecClean(p.form),multiline:true,
          placeholder:"What it is and what it looks like \u2014 shape, size, silhouette\u2026",onCommit:val=>onUpdate(p.id,{form:val})}),
        React.createElement(SheetField,{label:"Material & finish",value:propSpecClean(p.material),multiline:true,
          placeholder:"What it's made of \u2014 metal, plastic, fabric; sheen, wear, texture\u2026",onCommit:val=>onUpdate(p.id,{material:val})}),
        React.createElement(SheetField,{label:"Identifying physical details",value:propSpecClean(p.signatureFeature),multiline:true,placeholder:"Crushed spiral binding, chipped enamel, distinctive repair…",onCommit:val=>onUpdate(p.id,{signatureFeature:val})}),
        React.createElement(SheetField,{label:"Physical dimensions",value:propSpecClean(p.size),
          placeholder:"~1.2 m tall \u00d7 ~60 cm wide \u00d7 ~45 cm deep \u00b7 or ~18 cm long \u00d7 ~7 cm diameter\u2026",onCommit:val=>onUpdate(p.id,{size:val})}),
        // SCALE AGAINST THE OWNER — proportions relative to the body ("hangs to mid-
        // thigh"); shot prompts carry it so the object never shrinks or grows next to them
        p.ownerId && React.createElement(SheetField,{label:"Scale against "+(p.ownerName||"the owner"),value:p.scale,
          placeholder:"hangs from her shoulder to mid-thigh \u00b7 the size of his forearm \u00b7 fills both hands\u2026",
          title:"Proportions relative to the owner\u2019s body \u2014 shot prompts carry this so the object keeps its size next to them.",
          onCommit:val=>onUpdate(p.id,{scale:val})}),
        // real-world measurement \u2014 the scale system sizes the object against the cast
        // in every shot from this ('Draft specification' drafts it; edit to correct)
        React.createElement("label",{className:"sheet-field"},React.createElement("span",{className:"obj-lab"},"Dimension source"),React.createElement("select",{className:"prop-select",value:p.sizeBasis||"estimated",onChange:e=>onUpdate(p.id,{sizeBasis:e.target.value})},
          React.createElement("option",{value:"estimated"},"Design estimate — verify for 3D"),React.createElement("option",{value:"screenplay"},"Explicit screenplay dimensions"),React.createElement("option",{value:"measured"},"Measured / verified by user"))),
        React.createElement("details",{className:"prop-content-fields"},React.createElement("summary",null,"Document, label or screen content"),
          React.createElement(SheetField,{label:"Established wording / visible content",value:p.contentNotes,multiline:true,placeholder:"Exact letter wording, call-log entries or label text. Leave unknown content unspecified.",onCommit:val=>onUpdate(p.id,{contentNotes:val})}),
          React.createElement(SheetField,{label:"Base content version",value:p.contentVersion,placeholder:"Original / clean copy / sealed",onCommit:val=>onUpdate(p.id,{contentVersion:val})}),
          React.createElement("p",{className:"sheet-props-note"},"Later edits belong in Continuity → Updated events. Check important wording in the generated image; a prompt cannot guarantee legibility."))),

      React.createElement(CardFold,{label:"Continuity \u00b7 story events",count:continuityEvents.length||null,defaultOpen:false},
        React.createElement("div",{className:"sheet-props-note"},
          React.createElement(Icon.layers,{s:12}),
          "Record changes only. Holder, placement, condition and visibility persist automatically until the next event; Shots and Stage resolve the state at their exact moment."),
        React.createElement("div",{className:"state-actions"},
          React.createElement("button",{className:"state-add-btn",onClick:addContinuityEvent},React.createElement(Icon.plus,{s:12}),"Add event")),
        continuityEvents.length
          ? React.createElement("div",{className:"state-list prop-event-list"},continuityEvents.map(renderContinuityEvent))
          : React.createElement("div",{className:"state-empty"},"No changes recorded. The default binding persists wherever the screenplay maps this prop.")),

      // the settings that change the sheet live ON the card (2026-10-05); the prompt itself is read-only
      React.createElement(CardFold,{label:"Look & exclusions",defaultOpen:false},
        React.createElement(SheetField,{label:"Render style text \u2014 the style picker above fills it; edit to fine-tune",value:p.renderStyle||d.renderStyle,multiline:true,
          placeholder:"photoreal product reference, 85mm, soft studio lighting\u2026",onCommit:val=>onUpdate(p.id,{renderStyle:val})}),
        p.contentNotes&&/\b(text|typography|label|branding)\b/i.test(p.negativePrompt||"")&&React.createElement("p",{className:"prop-review-warning"},"Your saved exclusions mention text or labels. Review them so they do not suppress required wording on this object."),
        React.createElement(SheetField,{label:"Leave out (negative prompt)",value:p.negativePrompt||d.negativePrompt,multiline:true,
          onCommit:val=>onUpdate(p.id,{negativePrompt:val})})),

      // the prompt: a section of every card, folded (owner 2026-10-28 — it used to hide behind the card's ⋯ menu or
      // the Film menu's "Always show prompts")
      React.createElement(CardFold,{label:"Generation prompt",defaultOpen:false},
        React.createElement(CopyBox,{label:"Prompt (text only) \u2014 the 4-panel object sheet: hero, front, side, detail",text:buildPropRefPrompt(p,project)}),
        React.createElement(CopyBox,{label:(genForFrame.genUrl && genForFrame.genMeta && genForFrame.genMeta.prompt)
            ? "Final prompt \u2014 the one behind the current sheet" : "Final prompt \u2014 sent at generation (with the Leave out list)",
          text:(genForFrame.genUrl && genForFrame.genMeta && genForFrame.genMeta.prompt) || finalPrompt}))));
}

/* REVIEW SCREENPLAY PROPS (owner 2026-10-29 — "only props that matter to the story"). The read sorts every object
   the way a script breakdown does; only the ones the story depends on are proposed as props, each saying why.
   The rest (costume, set dressing, background props, objects named once) sit collapsed under "Not props — left to
   the shot", each with "Make it a prop". When the read can't tell whether two passages are one object, the review
   asks once ("Is the letter in scene 6 the one from scene 2?") instead of making two cards. */
const PROP_ROLE_TEXT = { costume:"Costume — drawn on the character's sheet", dressing:"Set dressing — part of the location",
  background:"Background prop — used once", hero:"Named, but nothing depends on it" };
/* HOW FILM CREWS SORT OBJECTS (owner 2026-10-30, the owner's own words): every object a script names goes to one of
   four places, and only hero props are cards here. Shown on the Props tab and in the review, which files what isn't
   a prop under the other three. */
const CREW_SORT = [
  { id:"costume", name:"Costume", text:"Anything worn (watches, badges, rings, uniforms). The costume department handles it, not props." },
  { id:"dressing", name:"Set dressing", text:"Objects that sit in the room and nobody uses. The set decorator handles them as part of the location." },
  { id:"background", name:"Background props", text:"Ordinary things handled once, like a cup of coffee or a pen. They\u2019re bought, not designed, and nobody tracks them." },
  { id:"hero", name:"Hero props", text:"The few objects the story depends on. These get designed, made carefully, often in copies, and tracked scene by scene." }];
window.PROP_CREW_SORT = CREW_SORT;
// which of the three other places an object that isn't a prop goes to (a failed "hero" is a background prop)
const crewPlaceOf = (p)=>{ const r = window.PropScreenplay && window.PropScreenplay.roleOf ? window.PropScreenplay.roleOf(p) : p.propRole;
  return r==="costume" || r==="dressing" ? r : "background"; };
function CrewSortNote({ open }){
  const h = React.createElement;
  return h("details",{className:"prop-crew-sort","data-testid":"prop-crew-sort",open:open||undefined},
    h("summary",null,"How film crews sort objects"),
    h("p",{className:"prop-crew-lead"},"When a crew breaks down a script, every object it names goes to one of four places:"),
    h("ul",null, CREW_SORT.map(c=>h("li",{key:c.id,className:"prop-crew-"+c.id},
      h("b",null,c.name+": "), c.text, c.id==="hero" && h("span",{className:"prop-crew-here"}," Only these become cards on this tab.")))));
}
window.PropCrewSortNote = CrewSortNote;

function PropExtractionReview({review,onChange,onApply,onClose,props,characters,locations,error,continueNote}){
  const h=React.createElement, PS=window.PropScreenplay;
  const setCands=(cands)=>onChange({...review,candidates:cands});
  const update=(id,patch)=>setCands(review.candidates.map(p=>p.reviewId===id?{...p,...patch}:p));
  const settle=(cands)=>PS.settleCandidates(cands,props);
  const selected=review.candidates.filter(p=>p.target!=="skip");
  // an open "same object?" question stays in the main list (two halves of one prop may each fail the tests alone)
  const asks=(p)=>!!PS.sameQuestion(p,review.candidates,props) || review.candidates.some(x=>x!==p && x.maybeSameAs===p.reviewId && PS.sameQuestion(x,review.candidates,props));
  const propsList=review.candidates.filter(p=>asks(p) || (!p.notProp && p.screenplaySources.some(s=>PS.physical.has(s.presence))));
  const notProps=review.candidates.filter(p=>p.notProp && !asks(p));
  const mentions=review.candidates.filter(p=>!asks(p) && !p.notProp && !p.screenplaySources.some(s=>PS.physical.has(s.presence)));
  const questions=review.candidates.map(p=>({p,q:PS.sameQuestion(p,review.candidates,props)})).filter(x=>x.q);
  const why=(p)=>PS.candidateSignificance(p,props).reasons;
  const evidence=(p)=>h("details",null,h("summary",null,"Screenplay evidence · "+p.screenplaySources.length+" passage(s)"),
    p.screenplaySources.map((s,i)=>h("blockquote",{key:i},h("b",null,"Scene "+s.sceneNo+(s.beat?" · Beat "+s.beat:"")+" · "+s.presence),h("p",null,s.quote))));
  const item=(p)=>{
    const q=PS.sameQuestion(p,review.candidates,props), reasons=why(p);
    return h("article",{key:p.reviewId,className:"prop-review-item"+(p.target==="skip"?" skipped":""),"data-testid":"prop-review-item"},
      q&&h("div",{className:"prop-review-same","data-testid":"prop-review-same"},
        h("span",null,q.text),
        h("button",{type:"button",className:"char-draft-btn",onClick:()=>setCands(PS.answerSame(review.candidates,p.reviewId,true,props))},"Yes, the same"),
        h("button",{type:"button",className:"char-draft-btn ghost",onClick:()=>setCands(PS.answerSame(review.candidates,p.reviewId,false,props))},"No, a different one")),
      h("div",{className:"prop-review-item-head"},h("input",{"aria-label":"Object name",value:p.name,onChange:e=>update(p.reviewId,{name:e.target.value})}),
        h("select",{className:"prop-select","aria-label":"Action for "+p.name,value:p.target,onChange:e=>update(p.reviewId,{target:e.target.value})},
          h("option",{value:"skip"},"Skip this proposal"),h("option",{value:"new"},"Add as new object"),
          h("optgroup",{label:"Link evidence to existing object"},props.map(x=>h("option",{key:x.id,value:x.id},x.name+(x.ownerName?" · "+x.ownerName:"")))))),
      !!reasons.length&&h("p",{className:"prop-why","data-testid":"prop-review-why"},h("b",null,"Why it's a prop: "),reasons.join(" · ")),
      p.keptAsProp&&!reasons.length&&h("p",{className:"prop-why"},h("b",null,"Why it's a prop: "),"your choice"),
      p.identityNote&&h("p",null,p.identityNote),
      !p.screenplaySources.some(s=>PS.physical.has(s.presence))&&h("p",{className:"prop-review-warning"},"Mention only — not established as visible. Skipped by default."),
      p.warnings.map((w,i)=>h("p",{key:i,className:"prop-review-warning"},w)),
      evidence(p),
      h("details",null,h("summary",null,"Classification & content"),
        p.target!=="new"&&p.target!=="skip"?h("p",null,"Linking adds evidence, aliases and optional events. It does not overwrite the existing object's name, owner, design or images."):
        h("div",{className:"sheet-2col"},
          h("label",null,"Default binding",h("select",{className:"prop-select",value:p.kind,onChange:e=>update(p.reviewId,{kind:e.target.value})},["carried","worn","dressing"].map(k=>h("option",{key:k,value:k},k)))),
          h("label",null,"Owner",h("select",{className:"prop-select",value:p.ownerId,onChange:e=>{const c=characters.find(x=>x.id===e.target.value);update(p.reviewId,{ownerId:c?c.id:"",ownerName:c?c.name:""});}},h("option",{value:""},"Unassigned"),characters.map(c=>h("option",{key:c.id,value:c.id},c.name)))),
          h("label",null,"Linked location",h("select",{className:"prop-select",value:p.locationId,onChange:e=>update(p.reviewId,{locationId:e.target.value})},h("option",{value:""},"None"),locations.map(l=>h("option",{key:l.id,value:l.id},l.name))))),
        p.contentNotes&&h("p",null,"Document / screen content: ",p.contentNotes)),
      !!p.continuityEvents.length&&h("details",null,h("summary",null,"Proposed continuity changes · "+p.continuityEvents.length),
        p.continuityEvents.map((e,i)=>h("p",{key:i},"Scene "+(p.screenplaySources.find(s=>s.sceneId===e.sceneId)||{}).sceneNo+" · "+e.type.replace(/_/g," ")+" · "+e.note)),
        h("label",{className:"prop-review-event-toggle"},h("input",{type:"checkbox",checked:p.includeEvents,onChange:e=>update(p.reviewId,{includeEvents:e.target.checked})}),"Also add these reviewed story events")));
  };
  const scenesOf=(p)=>Array.from(new Set(p.screenplaySources.map(s=>s.sceneNo).filter(n=>n!=null)));
  return h("section",{className:"prop-extract-review","aria-label":"Review screenplay props"},
    h("div",{className:"prop-extract-heading"},h("div",null,h("h3",null,"Review screenplay props"),
      h("p",null,"Only objects the story depends on become props: they come back in two or more scenes, or — in one scene — they change hands, are hidden, found, lost or destroyed and the story turns on them. Costume becomes a prop only when something like that happens to it; part of the place never does. Everything else stays in the words of the shot. Existing images and design fields are preserved.")),
      h("button",{className:"char-draft-btn ghost",onClick:onClose},"Discard proposals")),
    window.PropCrewSortNote && h(window.PropCrewSortNote,null),
    continueNote&&h("p",{role:"status"},continueNote),
    !!review.failures.length&&h("div",{className:"prop-review-warning",role:"alert"},"Partial extraction — these sections could not be read. You can apply the successful proposals, then retry extraction. ",review.failures.join(" · ")),
    !!review.rejected&&h("p",{className:"prop-review-warning"},review.rejected+" unverified or incomplete result(s) were excluded. Only exact screenplay passages are accepted as evidence."),
    !review.candidates.length&&h("p",null,"No verifiable objects found. Your inventory has not changed."),
    (!!review.candidates.length&&!propsList.length)&&h("p",null,"Nothing the screenplay names is a story prop yet — no object returns, changes or carries a turn."),
    h("div",{className:"prop-review-actions"},h("span",null,selected.length+" selected · no images will be generated"+(questions.length?" · "+questions.length+" question"+(questions.length!==1?"s":"")+" about the same object":"")),
      h("button",{className:"art-draftall",disabled:!selected.length,onClick:onApply},"Apply "+selected.length+" reviewed proposal"+(selected.length!==1?"s":""))),
    error&&h("p",{role:"alert",className:"prop-review-warning"},error),
    !!propsList.length&&h("div",{className:"prop-review-place","data-testid":"prop-review-hero"},
      // the count is what will be added or linked; an object with an open question waits for its answer
      h("b",null,"Hero props ("+propsList.filter(p=>p.target!=="skip").length+")"),h("span",null," \u2014 "+CREW_SORT[3].text)),
    h("div",{className:"prop-review-list"},propsList.map(item)),
    // (owner 2026-10-30) what isn't a prop, filed where a crew files it: costume, set dressing, background props
    !!notProps.length&&h("details",{className:"prop-review-notprops","data-testid":"prop-review-notprops"},
      h("summary",null,"Not props — left to the shot ("+notProps.length+")"),
      h("p",{className:"prop-review-note"},"The shot describes these in words. Make one a prop if the story needs it designed."),
      CREW_SORT.slice(0,3).map(place=>{ const inPlace=notProps.filter(p=>crewPlaceOf(p)===place.id); if(!inPlace.length) return null;
        return h("div",{key:place.id,className:"prop-review-placegroup","data-testid":"prop-review-place-"+place.id},
          h("div",{className:"prop-review-place"},h("b",null,place.name+" ("+inPlace.length+")"),h("span",null," \u2014 "+place.text)),
          inPlace.map(p=>h("div",{key:p.reviewId,className:"prop-review-notprop"},
            h("span",{className:"prop-review-notprop-name"},p.name),
            h("span",{className:"prop-review-notprop-role"},PS.whyNot ? PS.whyNot(PS.candidateSignificance(p,props)) : ((PROP_ROLE_TEXT[p.propRole]||PROP_ROLE_TEXT.hero)+(scenesOf(p).length?" · scene "+scenesOf(p).join(", "):""))),
            h("button",{type:"button",className:"char-draft-btn ghost","data-testid":"prop-review-make",onClick:()=>setCands(settle(review.candidates.map(x=>x===p?{...x,keptAsProp:true,notProp:false,target:x.priorTarget||"new"}:x)))},
              React.createElement(Icon.plus,{s:12}),"Make it a prop")))); })),
    !!mentions.length&&h("details",{className:"prop-review-notprops"},
      h("summary",null,"Only mentioned, never seen ("+mentions.length+")"),
      h("div",{className:"prop-review-list"},mentions.map(item)))
  );
}

function PropSheets({ project, props, characters, scenes, drafts, onUpdate, onDraft, onDraftAll, onAdd, onImportProps, onDelete, draftingId, draftingIds, draftingAll, castHasProps, onMergeProps, trashItems, onRestore, onPurge, onEnsureOwner, onSourceClick, lookbookStale, onApplyLookbook, onApplyLookbookDraftOnly, noPropsConfirmed, onSetNoProps }){
  const [view, setView] = React.useState(null);   // {url, character/prop}
  if(window.useRenderStyleVersion) window.useRenderStyleVersion();   // re-render dropdowns when a style is locked/unlocked
  const [sceneFilter, setSceneFilter] = React.useState(()=>{ const f = window.turnPeekArtFocus && window.turnPeekArtFocus("props"); return (f && f.sceneId) || ""; });   // "" = all (a Breakdown hand-off opens on its scene)
  React.useEffect(()=>{ if(window.turnClearArtFocus) window.turnClearArtFocus("props"); },[]);
  const [query, setQuery] = React.useState("");               // free-text name/owner search
  const [inventoryGroup,setInventoryGroupRaw]=React.useState("story");
  const groupPicked = React.useRef(false);   // the user (or a batch) chose a view — never switch it for them
  const setInventoryGroup = (g)=>{ groupPicked.current = true; setInventoryGroupRaw(g); };
  const [extraction,setExtraction]=React.useState(null), [review,setReview]=React.useState(null), [extractionError,setExtractionError]=React.useState("");
  const extractionRun=React.useRef(0);
  // (2026-10-30) only another film ends the read: it keeps going while you work elsewhere, scene edits included —
  // Apply checks every passage against the screenplay as it is then
  const scopeKey=JSON.stringify([project&&project.id]);
  React.useEffect(()=>{extractionRun.current++;setReview(null);setExtraction(null);setExtractionError("");return ()=>{extractionRun.current++;};},[scopeKey]);
  // EXTRACT FIRST (owner 2026-10-12): "Draft all specifications" starts by reading the screenplay for its
  // props, so the real carried props exist before anything else. The extraction still only PROPOSES: the
  // draft waits for the review (apply or discard), then runs on the film as it is after it.
  const extractedOnce=React.useRef(false);      // the screenplay was read for props in this session
  const pendingDraft=React.useRef(null);        // a Draft all waiting for the extraction's review
  const [draftQueued,setDraftQueued]=React.useState(null);
  const releaseDraft=()=>{ const q=pendingDraft.current; pendingDraft.current=null; if(q) setDraftQueued({mode:q.mode}); };
  React.useEffect(()=>{ if(!draftQueued) return; const m=draftQueued.mode; setDraftQueued(null); onDraftAll(m); },[draftQueued]);
  React.useEffect(()=>{ pendingDraft.current=null; },[scopeKey]);
  // the read and its waiting review keep this tab alive while you look at another tab or room (turnArtJobs)
  (window.useArtJob||(()=>{}))("props:read", extraction ? { label:"Reading the screenplay", detail:extraction.total ? extraction.done+" / "+extraction.total : "" }
    : review ? { label:"Props ready to review", detail:"" } : null);
  const extractProps=async(opts)=>{
    if(extraction)return;
    const gate=extractionRun.current;
    const ok=(opts&&opts.confirmed)||typeof window.appConfirm!=="function"||await window.appConfirm({title:(((props||[]).some(p=>p&&(p.screenplaySources||[]).length)||extractedOnce.current)?"Read the screenplay again?":"Extract screenplay props?"),body:"The writing model will read every screenplay scene and propose objects with exact source passages. This uses writing-model credits, not image credits. Nothing is added until you review and apply it.",confirmLabel:"Extract props"});
    if(!ok||gate!==extractionRun.current){ pendingDraft.current=null; return; }
    const run=++extractionRun.current;setExtraction({done:0,total:0});setExtractionError("");setReview(null);
    try{
      const result=await window.aiExtractScreenplayProps(scenes,drafts,characters,((window.turnContinuity||{}).locations)||[],props,
        p=>{if(run===extractionRun.current)setExtraction(p);},()=>run!==extractionRun.current);
      if(run===extractionRun.current&&result){
        extractedOnce.current=true; setReview(result);
        if(!(result.candidates||[]).length) releaseDraft();   // nothing to review: the draft goes on
      } else if(run===extractionRun.current) pendingDraft.current=null;
    }catch(e){if(run===extractionRun.current){pendingDraft.current=null;setExtractionError(e.message||"Extraction failed. Nothing was changed.");}}
    finally{if(run===extractionRun.current)setExtraction(null);}
  };
  const applyExtraction=()=>{
    try{onImportProps(review.candidates);setReview(null);setExtractionError("");setInventoryGroup("story");releaseDraft();}
    catch(e){setExtractionError(e.message||"Could not apply proposals.");}
  };
  const discardExtraction=()=>{ setReview(null); releaseDraft(); };
  const draftAllFlow=async(mode)=>{
    if(draftingAll||extraction||pendingDraft.current) return;
    const read=(props||[]).some(p=>p&&(p.screenplaySources||[]).length) || extractedOnce.current;
    if(read || !(scenes||[]).length || typeof window.aiExtractScreenplayProps!=="function"){ onDraftAll(mode); return; }
    const res=typeof window.appConfirm!=="function" ? true : await window.appConfirm({
      title:"Read the screenplay for its props first?",
      body:"Draft all specifications starts with Extract screenplay props: the writing model reads every screenplay scene and proposes the objects it names, with their passages, for your review (writing credits, no images). Carried props come from the screenplay — a carried item from a character brief stays a proposal until you keep it or the screenplay names it. The specifications are drafted after your review.",
      confirmLabel:"Extract, then draft", altLabel:"Draft only", cancelLabel:"Cancel" });
    if(res==="alt"){ onDraftAll(mode); return; }
    if(res!==true) return;
    pendingDraft.current={mode};
    await extractProps({confirmed:true});
  };
  const [searchOpen, setSearchOpen] = React.useState(false);  // collapsible search: icon-only until clicked
  const searchRef = React.useRef(null);
  const batch = useBatchGen("props");
  const batchActiveId = batch.activeId;
  const list = props || [];
  // the tab names for the "No props in this story" copy, as the lock copy names them (the tab bar's
  // label, plus the format's department name in brackets where it differs)
  const noPropsNames = (typeof window.turnArtTabDisplayNames==="function") ? window.turnArtTabDisplayNames(project) : { locations:"Locations" };
  // STYLE · ALL PROPS — apply one render style to every prop at once (mirrors the cast's
  // 'Style · all cast'); each prop can still be overridden on its own card.
  const [allStyling, setAllStyling] = React.useState(null);   // null | {i,total} (surprise progress)
  const PROP_TEXT = window.PROP_RENDER_TEXT || {};
  const defaultStyleKey = window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal";
  const allStyleKey = (list.length && list.every(p=>(p.renderStyleKey||defaultStyleKey)===(list[0].renderStyleKey||defaultStyleKey)))
    ? (list[0].renderStyleKey||defaultStyleKey) : "";
  const propBibleOf = (p)=> [p.name&&("Name: "+p.name), p.ownerName&&("Owner: "+p.ownerName),
    p.form&&("Form: "+p.form), p.material&&("Material: "+p.material), p.detail&&("Significance: "+p.detail),
    p.relation&&("Relationship: "+p.relation), p.scale&&("Scale against owner: "+p.scale),
    (typeof custodyChainLabel==="function" && custodyChainLabel(p, ((window.turnContinuity||{}).scenes)||[])) && ("Custody: "+custodyChainLabel(p, ((window.turnContinuity||{}).scenes)||[])),
    (project&&project.genre)&&("Genre: "+project.genre)].filter(Boolean).join("\n");
  const applyStyleAll = async (key)=>{
    if(!key || allStyling) return;
    if(key!=="surprise"){ const t=(typeof window.renderStyleText==="function" ? window.renderStyleText("prop", key) : (PROP_TEXT[key]||PROP_TEXT.photoreal)); list.forEach(p=> onUpdate(p.id, { renderStyleKey:key, renderStyle:t })); return; }
    list.forEach(p=> onUpdate(p.id, { renderStyleKey:"surprise" }));
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    const need = list.filter(p=>!(p.surpriseRender && p.surpriseRender.style));
    if(!need.length) return;
    let ok = true;
    if(typeof window.appConfirm==="function") ok = await window.appConfirm({
      title:"Invent a surprise style for "+need.length+" prop"+(need.length!==1?"s":"")+"?",
      body:"Each prop gets its OWN bespoke fused style invented from its bible — that's "+need.length+" AI call"+(need.length!==1?"s":"")+".",
      confirmLabel:"Invent styles" });
    if(!ok) return;
    setAllStyling({ i:0, total:need.length });
    for(let i=0;i<need.length;i++){ setAllStyling({ i:i+1, total:need.length });
      try{ const r = await aiSurpriseStyleText({ name:need[i].name, kind:"prop", bible:propBibleOf(need[i]) }, project);
        if(r) onUpdate(need[i].id, { surpriseRender:r, renderStyle:r.style }); }catch(e){} }
    setAllStyling(null);
  };
  const sceneList = scenesInStoryOrder(scenes);
  // EFFECTIVE scene map. A prop seeded from the cast may never have been scene-mapped
  // (p.scenes === undefined) — those used to silently vanish from every scene focus
  // and from the dropdown counts, while still showing under "All scenes" (the
  // filter-vs-character-sheet mismatch). Fallback: an OWNED, unmapped prop derives
  // its scenes from its owner's presence — the same deterministic rule the mapper
  // itself uses for worn items. The automatic screenplay remapper replaces the
  // fallback with a stored (AI-narrowed) map; unowned + unmapped props stay out.
  const effMap = React.useMemo(()=>{
    const m = {};
    if(typeof scenesWhereCharacterAppears!=="function") return m;
    // does THIS scene's script/summary actually name the object? (head noun, or a
    // meaningful word of its name — 4+ letters so "of"/"the" never match)
    // EXACT NAME ONLY (owner 2026-10-12): an object the screenplay hasn't established is pinned
    // to a scene only where its action text names it in full — a loose noun ("phone" for an
    // invented "smartphone") used to put brief-only objects into scenes and then into shots
    const exactScenes = (p)=> new Set(propScreenplayMentions(p, scenes, drafts).filter(m=>m.match==="exact"
      && !/^(dia|dialogue|dialog|parenthetical|transition)$/i.test(String(((((drafts||{})[m.sceneId]||{}).blocks||[])[m.block-1]||{}).type||"")))
      .map(m=>m.sceneId));
    const namesIt = (p, s, hits)=> hits.has(s.id);
    list.forEach(p=>{
      if(Array.isArray(p.scenes)) return;
      if(!(p.ownerId || p.ownerName)) return;
      // WORN: the owner's presence IS the prop's presence (it's on their body).
      // CARRIED: owner presence only OVER-counts (a briefcase isn't in every scene
      // its owner walks through — that once ballooned one scene's count to 36 of 43
      // props); an unmapped carried object is pinned to the scenes that actually
      // NAME it, and stays out of scene focus entirely if none do. The automatic
      // screenplay remapper stores the AI-narrowed map.
      if((p.kind||"carried")==="worn"){
        const ids = window.PropScreenplay.characterScenes(p.ownerId,p.ownerName,scenes,drafts,characters) || [];
        if(ids.length) m[p.id] = ids;
      } else {
        const hits = exactScenes(p);
        const ids = (scenes||[]).filter(s=>namesIt(p,s,hits)).map(s=>s.id);
        if(ids.length) m[p.id] = ids;
      }
    });
    return m;
  },[list, scenes, drafts]);
  const effScenes = (p)=> Array.isArray(p.scenes) ? p.scenes : effMap[p.id];
  const tagged = list.some(p=>p.scenes!==undefined) || Object.keys(effMap).length>0;
  const inScene = (p, sid)=>{ const sc = effScenes(p); return Array.isArray(sc) && sc.indexOf(sid)>=0; };
  // free-text search matches a prop's name or owner — at a WORD BOUNDARY, not anywhere,
  // so typing "h" surfaces words that START with h (Heavy, Handmade…) instead of matching
  // the "h" buried in "throat". Stacks on top of the scene filter.
  const q = query.trim().toLowerCase();
  const matchesQuery = (p)=> searchWordMatch((p.name||"")+" "+(p.ownerName||""), q);
  const kindOf = (p)=> (p && p.kind) || "carried";
  // Search and scene focus are the only grid filters.
  const kindCountBase = (sceneFilter ? list.filter(p=>inScene(p, sceneFilter)) : list).filter(matchesQuery);
  // carried props with no owner — they'd generate WORLD-GENERIC (no character anchor)
  const unassignedCarried = list.filter(p=> kindOf(p)==="carried" && !p.ownerId && window.PropScreenplay.isStoryProp(p));
  // (owner 2026-10-29) two groups that never overlap: Story props, and Not story props (costume from a character's
  // look, guesses from the write-ups, objects named once that nothing happens to)
  const groupOf = (p)=> window.PropScreenplay.group(p);
  const inView = (p)=> inventoryGroup==="all" || groupOf(p)===inventoryGroup;
  const shown = kindCountBase.filter(inView);
  // NEVER AN EMPTY FIRST VIEW (2026-10-03): with no story props but other objects (all wardrobe,
  // say), open on All objects instead of "No objects in this view"
  const storyN = list.filter(p=>groupOf(p)==="story").length;
  const notStory = list.filter(p=>groupOf(p)==="other");
  React.useEffect(()=>{
    if(!groupPicked.current && inventoryGroup==="story" && list.length>0 && storyN===0) setInventoryGroupRaw("all");
  },[list.length, storyN, inventoryGroup]);
  // 9-up pagination; suspended while a batch runs so the queue can reach every card
  const pager = usePager(shown.length, !!batchActiveId);
  // duplicate detection: map each prop id -> the set of ids it duplicates (same owner + object)
  const dupSets = (typeof findDuplicateProps==="function") ? findDuplicateProps(list) : {};
  const dupForId = {}; Object.values(dupSets).forEach(ids=> ids.forEach(id=>{ dupForId[id]=ids; }));
  const byId = {}; list.forEach(p=>{ byId[p.id]=p; });
  // the same object under another owner (2026-10-29) — a suggestion on each card
  const sameFor = (typeof findPossibleSameProps==="function") ? findPossibleSameProps(list) : {};

  // one-time sanity pass: correct props whose NAME unambiguously contradicts their
  // worn/carried kind (e.g. a phone mis-filed as "worn"). Skips any the user has
  // deliberately set (kindSet) so a manual choice is never overridden.
  const kindFixed = React.useRef(false);
  React.useEffect(()=>{
    if(kindFixed.current || typeof classifyPropKind!=="function" || !list.length) return;
    kindFixed.current = true;
    list.forEach(p=>{
      if(p.kindSet) return;
      // ownerless objects may also classify as SET DRESSING (a hollow log, a bench) —
      // heals cards created before the dressing kind existed
      const k = classifyPropKind(p.name, { ownerless: !p.ownerId && !p.ownerName });
      if(k && k!==(p.kind||"carried")) onUpdate(p.id, { kind:k });
    });
  },[list.length]);

  // When a prop is added BY HAND (manual flag), bring it into view: clear any scene
  // filter that would hide a scene-less new prop, then smooth-scroll the Art Room
  // scroller to the new card. Cast-pull / derived props are not manual, so a bulk
  // pull never yanks the viewport around.
  const prevIdsRef = React.useRef(null);
  React.useEffect(()=>{
    const ids = list.map(p=>p.id);
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    if(!prev) return;                                  // first render — nothing to compare
    const added = list.find(p=>prev.indexOf(p.id)<0);
    if(!added || !added.manual) return;                // only react to a hand-added prop
    if(sceneFilter) setSceneFilter("");                // make sure the new (scene-less) card renders
    let tries = 0;
    const tick = ()=>{
      const el = document.querySelector('[data-prop-card="'+added.id+'"]');
      const scroller = el && el.closest('.artroom');
      if(el && scroller){
        const target = Math.max(0, scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - 16);
        // smooth tween — scrollTo({behavior:"smooth"}) is a no-op in this runtime
        const start = scroller.scrollTop, dist = target - start, t0 = performance.now(), dur = 420;
        const ease = x => 1 - Math.pow(1 - x, 3);
        const step = (now)=>{
          const k = Math.min(1, (now - t0) / dur);
          scroller.scrollTop = start + dist * ease(k);
          if(k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        return;
      }
      if(tries++ < 10) requestAnimationFrame(tick);    // wait for the card to mount
    };
    requestAnimationFrame(tick);
  },[list]);

  // ---- batch generation ----
  // eligible = drafted props (so a hand-added, undrafted/gated card never makes a
  // generic image). Cards that already have a sheet are caught by the begin() partition.
  // WORN props are rendered ON their owner's character sheet (their spec is baked into the
  // character prompt), so ONLY CARRIED and DRESSING props are generated as separate sheets
  // (a dressing sheet is optional — it can ride plate edits as a reference image).
  // TEXT-ONLY objects (PropScreenplay.sheetTier) ride as text in shots, so batches skip
  // them too; generating one on its own card is still allowed.
  const ownImage = (p)=> window.PropScreenplay.sheetTier(p, drafts).tier!=="text";
  // BATCHES (2026-10-03, owner — Props review): only drafted objects that need their own image,
  // and — once the screenplay has been extracted — never one it didn't establish ("Not in
  // screenplay", proposed from a character brief); those can still be made on their own card.
  // (2026-10-12, owner) A PROPOSAL — a carried object nobody established — is skipped on EVERY
  // film, extracted or not; worn items from the character design and kept cards can still be made.
  const extracted = list.some(p=> (p.screenplaySources||[]).length);
  const unverifiedSkip = (p)=> window.PropScreenplay.batchSkip(p, extracted);
  const proposalN = notStory.length;
  // one confirm, then every card that isn't a story prop goes to Recently deleted (restorable there)
  const binNotStory = async ()=>{
    const ok = typeof window.appConfirm!=="function" || await window.appConfirm({
      title:"Move "+notStory.length+" card"+(notStory.length!==1?"s":"")+" to Recently deleted?",
      body:"These cards aren't story props. They go to Recently deleted with their images, where you can restore any of them.",
      items:notStory.map(p=>p.name+(p.ownerName?" \u00b7 "+p.ownerName:"")), confirmLabel:"Move to Recently deleted" });
    if(!ok) return;
    notStory.forEach(p=>onDelete(p.id));
    if(inventoryGroup==="other") setInventoryGroup("story");
  };
  const draftedIds = (subset)=> subset.filter(p=>propVisualsDrafted(p) && p.kind!=="worn" && ownImage(p)
    && !window.PropScreenplay.nameIssue(p.name) && !unverifiedSkip(p)).map(p=>p.id);
  // batch never makes a WORLD-GENERIC carried prop: an owned object needs its owner's
  // sheet as the style anchor, so ownerless carried props are skipped (assign first)
  const anchorReady = (p)=> !!(p && !((p.kind||"carried")==="carried" && !p.ownerId));
  // the header counts follow each finished generation
  const [, setSheetTick] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=> setSheetTick(t=>t+1);
    window.addEventListener("nb-gen-done", h);
    return ()=> window.removeEventListener("nb-gen-done", h);
  },[]);
  const hasImg = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const readyIds = (subset)=> draftedIds(subset).filter(id=> anchorReady(byId[id]));
  const missingIds = (subset)=> readyIds(subset).filter(id=> !hasImg(id));
  const sceneAll = sceneFilter ? list.filter(p=>inScene(p, sceneFilter)) : [];
  const missingAll = missingIds(list), missingScene = missingIds(sceneAll);
  // owners of these props with no character sheet yet — asked ONCE before a batch
  const [batchOwnerChoice, setBatchOwnerChoice] = React.useState("skip");
  const ownersWithoutSheet = (ids)=> Array.from(new Set(ids.map(id=>byId[id]).filter(p=>p && p.ownerId && !hasImg(p.ownerId)).map(p=>p.ownerId)));
  const askOwners = async (ids)=>{
    const owners = ownersWithoutSheet(ids);
    if(!owners.length || typeof window.appConfirm!=="function") return "skip";
    const names = owners.map(id=>((characters||[]).find(c=>c.id===id)||{}).name||"A character");
    const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(owners.length) : "";
    const res = await window.appConfirm({
      title:owners.length+" owner"+(owners.length!==1?"s have":" has")+" no character sheet yet",
      body:"Props match their owner best when they're made with the owner's sheet as a reference. Make "+(owners.length!==1?"these sheets":"this sheet")+" first"
        +(price?" (about "+price+" credit"+(price==="1"?"":"s")+" more":"")+(price?", plus":" (plus")+" drafting any look that isn't written yet), or make the props on their own.",
      items:names, confirmLabel:"Make "+owners.length+" owner sheet"+(owners.length!==1?"s":"")+" first", altLabel:"Props only", cancelLabel:"Cancel" });
    return res===true ? "owner" : res==="alt" ? "skip" : null;
  };
  const startSceneBatch = async (onlyMissing)=>{
    if(!sceneFilter || batchActiveId) return;
    if(query) setQuery("");             // ...and every prop in it, not just search matches
    setInventoryGroup("all");
    const draftedScene = draftedIds(sceneAll);
    const eligible = onlyMissing ? missingScene : readyIds(sceneAll);
    if(!eligible.length){
      const nonWorn = sceneAll.filter(p=>p.kind!=="worn");
      batch.setMsg(onlyMissing && readyIds(sceneAll).length
        ? "Every prop in this scene that needs its own image already has one."
        : draftedScene.length
        ? "The drafted carried props in this scene have no owner \u2014 assign one on each card first (batch generation won't make world-generic sheets)."
        : (!nonWorn.length
          ? "Every prop mapped to this scene is WORN \u2014 worn items render on their owner\u2019s character sheet (Characters tab), not here. Nothing separate to generate."
          : (!nonWorn.some(ownImage)
            ? "Every other prop in this scene is TEXT ONLY \u2014 shots describe them from their specifications. Change Object \u2192 Reference image on a card to give it its own image."
            : "Draft these props first (\u201cDraft specification\u201d on each card) \u2014 objects marked Not in screenplay are made from their own card.")));
      return;
    }
    const plan = await askOwners(eligible); if(!plan) return;
    setBatchOwnerChoice(plan);
    batch.begin(eligible, onlyMissing ? 0 : sceneAll.length - eligible.length, { alwaysAsk:true });
  };
  const startAllBatch = async (onlyMissing)=>{
    if(batchActiveId) return;
    const draftedAll = draftedIds(list);
    const eligible = onlyMissing ? missingAll : readyIds(list);
    if(!eligible.length){
      batch.setMsg(onlyMissing && readyIds(list).length
        ? "Every prop that needs its own image already has one."
        : draftedAll.length
        ? "Every drafted carried prop has no owner \u2014 assign one on each card first (batch generation won't make world-generic sheets)."
        : (proposalN && !list.some(p=>groupOf(p)==="story" && p.kind!=="worn"))
        ? "Nothing to generate yet \u2014 none of these objects is a story prop. Read the screenplay for props, or keep a card as a story prop."
        : "Draft the prop specifications first \u2014 nothing is ready to generate yet.");
      return;
    }
    const plan = await askOwners(eligible); if(!plan) return;
    setBatchOwnerChoice(plan);
    // Clear filters before the batch: the queue advances only
    // when the target CARD is mounted, so a batch whose first target was filtered out
    // by a search box never generated anything and hung until Cancel
    if(sceneFilter) setSceneFilter("");
    if(query) setQuery("");
    setInventoryGroup("all");
    batch.begin(eligible, onlyMissing ? 0 : list.length - eligible.length, { alwaysAsk:true });
  };
  const eligibleAll = readyIds(list).length;
  // proposals aren't drafted by Draft all (2026-10-12) — they aren't counted on its button either
  const undraftedN = list.filter(p=>!propVisualsDrafted(p) && !window.PropScreenplay.nameIssue(p.name) && !window.PropScreenplay.isProposal(p)).length;
  const sceneNoOf = (sid)=>{ const s=(scenes||[]).find(x=>x.id===sid); return s?s.no:sid; };
  const draftBtnShown = undraftedN>0;
  const screenplayRead = extracted || extractedOnce.current;

  return React.createElement("div",{className:"art-scroll"},
    view && React.createElement(ImageLightbox,{url:view.url,character:view.character,onClose:()=>setView(null)}),
    React.createElement(NbKeyBar,null),
    React.createElement(NbControls,null),
    window.LookbookStaleNotice && React.createElement(window.LookbookStaleNotice,{stale:lookbookStale,onApply:onApplyLookbook,onDraftOnly:onApplyLookbookDraftOnly,label:"these props",dept:"props"}),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement(window.ArtDeptTitle||"div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},
            ((typeof roomCopy==="function" && roomCopy(project,"props").title) || "Props Master"),
            React.createElement(window.InfoTip,{label:"About Props",
              text:((typeof roomCopy==="function" && roomCopy(project,"props").tip) ||
                "Story props \u2014 the objects the story depends on, read from the screenplay. A film crew sorts every object in the script four ways: costume (worn \u2014 drawn on the character\u2019s sheet), set dressing (part of the location), background props (used once \u2014 the shot describes them) and hero props. Only hero props get a card: an object the screenplay names that comes back in two or more scenes, or \u2014 in one scene \u2014 changes hands, is hidden, found, lost or destroyed and the story turns on it. A worn item is a prop only when something like that happens to it; part of the place never is. Each card says why. Cards that aren\u2019t story props sit under Not story props, where you can keep one or move them to Recently deleted. Draft specifications fills the design fields; Generate missing images renders the drafted props that need their own image.")}))),
        React.createElement("div",{className:"art-intro-actions"},
          window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{items:trashItems,kind:"prop",onRestore,onPurge,compact:true}),
          // READ AGAIN (owner 2026-10-29): before the film's screenplay has been read for props, Draft N specifications
          // offers the read first, so this button waits until then — unless there is no Draft button to offer it
          // (2026-10-29) an empty tab offers the read in its own empty state, so the header doesn't repeat it
          (screenplayRead || !draftBtnShown) && (list.length>0 || !(scenes||[]).length) && React.createElement("button",{className:"art-draftall ghost secondary","data-testid":"prop-read-screenplay",disabled:!!extraction||draftingAll||!scenes.length,onClick:extractProps,
            title:(screenplayRead ? "Read every scene again after script changes" : "Read every scene")+" with the writing model and propose the story's objects for your review (writing credits, no images)"},React.createElement(Icon.layers,{s:14}),
            extraction?"Reading screenplay…":(screenplayRead?"Read the screenplay again":"Extract screenplay props")),
          draftBtnShown && React.createElement("button",{className:"art-draftall ghost secondary",disabled:draftingAll||!!extraction,onClick:()=>draftAllFlow(),
            title:"Read the screenplay for its props first (Extract screenplay props, for your review \u2014 once per film), then draft the specification of every prop that doesn't have one yet (finished and edited cards and proposals are left alone) and map each prop to its scene appearances \u2014 writing credits, no images"},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Drafting\u2026":(list.length ? "Draft "+undraftedN+" specification"+(undraftedN!==1?"s":"") : "Draft all specifications")),
          (storyN>0 && !undraftedN) && React.createElement("button",{className:"art-draftall ghost",disabled:draftingAll||!!extraction,onClick:()=>draftAllFlow("redraft"),
            title:"Write every prop's design again from the script \u2014 asks first; replaces the current specs, including your edits"},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Drafting\u2026":"Redraft all\u2026"),
          missingAll.length>0 && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId,onClick:()=>startAllBatch(true),
            title:"Generate the image of every drafted prop that needs one and doesn't have it yet \u2014 existing images are left as they are; objects marked Not in screenplay are made from their own card"},
            React.createElement(Icon.sparkles,{s:14}),
            batchActiveId?"Generating\u2026":("Generate "+missingAll.length+" missing image"+(missingAll.length!==1?"s":"")),
            typeof window.nbCostChip==="function" && window.nbCostChip(missingAll.length)),
          (!missingAll.length && eligibleAll>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId,onClick:()=>startAllBatch(false),
            title:"Regenerate the images of the drafted props \u2014 you'll be asked before anything is redone, with the price"},
            React.createElement(Icon.sparkles,{s:14}), batchActiveId?"Generating\u2026":"Regenerate images\u2026")))),
    // how a crew sorts objects (owner 2026-10-30): open while the tab is empty, a one-line summary otherwise
    !review && window.PropCrewSortNote && React.createElement(window.PropCrewSortNote,{open:!list.length}),
    extraction&&React.createElement("div",{className:"prop-review-actions",role:"status"},
      React.createElement("span",null,"Reading screenplay "+extraction.done+" / "+extraction.total+(extraction.sceneNo?" · Scene "+extraction.sceneNo:"")),
      React.createElement("button",{className:"char-draft-btn ghost",onClick:()=>{extractionRun.current++;pendingDraft.current=null;setExtraction(null);}},"Cancel")),
    extractionError&&!review&&React.createElement("p",{className:"prop-review-warning",role:"alert"},extractionError),
    review&&React.createElement(PropExtractionReview,{review,onChange:setReview,onApply:applyExtraction,onClose:discardExtraction,props:list,characters:characters||[],locations:((window.turnContinuity||{}).locations)||[],error:extractionError,
      continueNote:pendingDraft.current?"Draft all specifications continues when you apply or discard these proposals.":""}),
    unassignedCarried.length>0 && React.createElement("div",{className:"prompt-drift-note",style:{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}},
      React.createElement("span",{style:{flex:1,minWidth:220}},
        React.createElement("b",null,unassignedCarried.length+" carried prop"+(unassignedCarried.length!==1?"s":"")),
        " ha"+(unassignedCarried.length!==1?"ve":"s")+" no owner \u2014 assign one on each card so its sheet is anchored to a character, not generated world-generic.")),
    // NOT STORY PROPS (owner 2026-10-29): cards made before only the screenplay made props — costume from the
    // character write-ups, guesses, objects named once. Nothing is deleted on its own: one button moves them all to
    // Recently deleted (they can be restored there); a card's own "Keep as a story prop" keeps it.
    (notStory.length>0 && inventoryGroup!=="other") && React.createElement("div",{className:"prop-notstory-note","data-testid":"prop-notstory-note"},
      React.createElement("span",{className:"prop-notstory-text"},
        React.createElement("b",null,notStory.length!==1 ? notStory.length+" cards aren't story props" : "1 card isn't a story prop"),
        " \u2014 costume, set dressing, or objects the story doesn't depend on (used once, nothing that matters happens to them), plus older cards from a character's look or write-up. Shots and character sheets describe them in words."),
      React.createElement("button",{type:"button",className:"char-draft-btn ghost",onClick:()=>setInventoryGroup("other")},"Show them"),
      onDelete && React.createElement("button",{type:"button",className:"char-draft-btn ghost","data-testid":"prop-notstory-bin",onClick:binNotStory},"Move them to Recently deleted")),
    (inventoryGroup==="other" && notStory.length>0) && React.createElement("div",{className:"prop-notstory-note"},
      React.createElement("span",{className:"prop-notstory-text"},"Not story props \u2014 keep one as a story prop on its card, or move them all to Recently deleted."),
      onDelete && React.createElement("button",{type:"button",className:"char-draft-btn ghost",onClick:binNotStory},"Move them to Recently deleted")),
    BatchBar && React.createElement(BatchBar,{batch,noun:"prop"}),
    /* THE SLATE (owner 2026-10-22, as Locations): one bar of labelled cells — Show (which objects), Style · all,
       Scene, search */
    (list.length>0 || (tagged && sceneList.length>0)) && React.createElement("div",{className:"loc-slate art-slate",role:"group","aria-label":"Props: which objects, style, scene and search"},
      React.createElement("label",{className:"loc-slate-cell loc-slate-show"},
        React.createElement("span",{className:"loc-slate-lab"},"Show"),
        React.createElement("select",{className:"prop-select",value:inventoryGroup,"aria-label":"Prop inventory group",onChange:e=>setInventoryGroup(e.target.value)},
        // (owner 2026-10-29) All objects, then the two groups, which never overlap
        React.createElement("option",{value:"all"},"All objects ("+list.length+")"),
        React.createElement("option",{value:"story"},"Story props ("+storyN+")"),
        React.createElement("option",{value:"other"},"Not story props ("+notStory.length+")"))),
      list.length>0 && React.createElement("div",{className:"loc-slate-cell loc-slate-style"},
        React.createElement("span",{className:"loc-slate-lab"}, allStyling ? ("Inventing\u2026 "+allStyling.i+"/"+allStyling.total) : "Style \u00b7 all"),
        React.createElement("div",{className:"char-style-all",
          title:"Apply one render style to ALL props at once. Each prop can still be overridden on its own card."},
        React.createElement(window.RenderStylePicker,{context:"prop",value:allStyleKey,disabled:!!allStyling,
          placeholderLabel:"Mixed — per prop",onPick:applyStyleAll}))),
      tagged && sceneList.length>0 && React.createElement("div",{className:"loc-slate-cell loc-slate-scene prop-scenebar"},
        React.createElement("span",{className:"loc-slate-lab"},"Scene"),
      React.createElement("select",{className:"prop-select prop-scenebar-select",value:sceneFilter,
        onChange:e=>setSceneFilter(e.target.value)},
        React.createElement("option",{value:""},"All scenes \u2014 show every prop"),
        sceneList.map(s=>{
          // Scene counts respect the active search so the dropdown and visible grid agree.
          const n = list.filter(p=>inScene(p,s.id)).filter(matchesQuery).filter(inView).length;
          return React.createElement("option",{key:s.id,value:s.id},
            "Scene "+String(s.no).padStart(2,"0")+" \u00b7 "+(s.title||"")+"  ("+n+" prop"+(n!==1?"s":"")+")");
        }))),
      list.length>0 && React.createElement("div",{className:"loc-slate-cell loc-slate-search"+((searchOpen||q)?" open":"")},
      React.createElement("div",{className:"prop-searchbar collapsible"+((searchOpen||q)?" open":""),
        title:(searchOpen||q)?"":"Search props",
        onClick:()=>{ if(!searchOpen && !q){ setSearchOpen(true); setTimeout(()=>{ if(searchRef.current) searchRef.current.focus(); },0); } }},
      React.createElement(Icon.search,{s:14}),
      React.createElement("input",{className:"prop-search-input",type:"text",value:query,ref:searchRef,
        placeholder:"Search props by name or owner…",tabIndex:(searchOpen||q)?0:-1,
        onChange:e=>setQuery(e.target.value),
        onBlur:()=>{ if(!query) setSearchOpen(false); },
        onKeyDown:e=>{ if(e.key==="Escape"){ setQuery(""); setSearchOpen(false); if(searchRef.current) searchRef.current.blur(); } }}),
      q && React.createElement("span",{className:"prop-search-count"},
        shown.length+" of "+list.length),
      q && React.createElement("button",{className:"prop-search-clear",title:"Clear search",
        onClick:(e)=>{ e.stopPropagation(); setQuery(""); setSearchOpen(false); }},React.createElement(Icon.x,{s:14}))))),
    // a focused scene's own batch: under the slate
    (tagged && sceneFilter) && React.createElement("div",{className:"loc-slate-acts"},
      // ONE SCENE (2026-10-03, owner): make just this scene's props, priced
      (sceneFilter && missingScene.length>0) && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId,onClick:()=>startSceneBatch(true),
        title:"Generate the images this scene's drafted props still need \u2014 if an owner has no character sheet yet you'll be asked first, with the price"},
        React.createElement(Icon.sparkles,{s:14}),
        batchActiveId?"Generating\u2026":("Generate "+missingScene.length+" missing in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")),
        typeof window.nbCostChip==="function" && window.nbCostChip(missingScene.length)),
      (sceneFilter && !missingScene.length && readyIds(sceneAll).length>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId,onClick:()=>startSceneBatch(false),
        title:"Regenerate this scene's prop images \u2014 you'll be asked before anything is redone, with the price"},
        React.createElement(Icon.sparkles,{s:14}),
        batchActiveId?"Generating\u2026":("Regenerate Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+"\u2026"))),
    // B13 (2026-10-09, owner decision B — Breakdown review): the focused scene counted the Breakdown's way — an undrafted
    // prop counts; one with no owner or not in the screenplay is listed as needing that — each a chip naming its card
    (sceneFilter && window.BdSceneNeedsLine) && React.createElement(window.BdSceneNeedsLine,{sceneId:sceneFilter,sceneNo:sceneNoOf(sceneFilter),kind:"props",
      film:{ scenes, characters, props:list, drafts, project }, list, onFind:(n)=>{ setInventoryGroup("all"); setQuery(n||""); setSearchOpen(true); }}),
    list.length
      ? (shown.length
          ? React.createElement(React.Fragment,null,
              React.createElement("div",{className:"sheet-grid"},
                pager.slice(shown).map(p=>React.createElement(PropSheet,{key:p.id,p,project,characters,scenes,drafts,onUpdate,onDelete,onDraft,onEnsureOwner,batchOwnerChoice,
                  drafting:draftingId===p.id||(draftingIds||[]).indexOf(p.id)>=0||draftingAll,onView:(url,pr)=>setView({url,character:pr}),
                   batchActiveId,onBatchDone:batch.advance,onChipClick:(sid)=>setSceneFilter(sid),onSourceClick,
                  derivedScenes:effMap[p.id],heroCount:(props||[]).filter(x=>x&&x.hero).length,
                  dupIds:dupForId[p.id],dupProps:(dupForId[p.id]||[]).filter(id=>id!==p.id).map(id=>byId[id]).filter(Boolean),onMerge:onMergeProps,
                  sameProps:(sameFor[p.id]||[]).map(id=>byId[id]).filter(Boolean)}))),
              React.createElement(PagerBar,{pager,noun:"prop"}))
          : q
            ? React.createElement("div",{className:"prop-empty"},
                React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.search,{s:28})),
                React.createElement("div",{className:"art-soon-t"},"No props match \u201c"+query.trim()+"\u201d"),
                React.createElement("div",{className:"art-soon-d"}, sceneFilter
                  ? "Nothing in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+" matches that search. Clear the search or pick another scene."
                  : "No prop name or owner matches that search."),
                React.createElement("button",{className:"art-draftall",style:{marginTop:16},onClick:()=>setQuery("")},"Clear search"))
            : React.createElement("div",{className:"prop-empty"},
                React.createElement("div",{className:"art-soon-t"},"No objects in this view"),
                React.createElement("div",{className:"art-soon-d"},inventoryGroup==="other"
                  ? "Every object here is a story prop."
                  : "No story props yet \u2014 read the screenplay for props: only objects that come back, that something happens to, or that the story turns on become props."),
                React.createElement("button",{className:"art-draftall",style:{marginTop:16},onClick:()=>{setSceneFilter("");setInventoryGroup("all");}},"Show all objects")))
      : React.createElement("div",{className:"prop-empty"},
          React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.box,{s:30})),
          React.createElement("div",{className:"art-soon-t"},"No props yet"),
          React.createElement("div",{className:"art-soon-d"}, (scenes||[]).length
            ? "Props come from the screenplay: only objects the story depends on \u2014 ones that come back, that something happens to, or that the story turns on. Costume stays on the character sheets, set dressing in the locations, and objects used once in the words of the shot. Read the screenplay for its props (for your review), or add one by hand."
            : "Add a prop to start building its reference sheet \u2014 a weapon, a phone, a talisman, anything that recurs across scenes."),
          React.createElement("div",{className:"prop-empty-actions"},
            (scenes||[]).length>0 && React.createElement("button",{className:"art-draftall",disabled:draftingAll||!!extraction,onClick:extractProps},
              React.createElement(Icon.layers,{s:14}), extraction?"Reading screenplay\u2026":"Read the screenplay for props"),
            React.createElement("button",{className:(scenes||[]).length?"art-draftall ghost":"art-draftall",onClick:onAdd},
              React.createElement(Icon.plus,{s:14}),(scenes||[]).length?"Add by hand":"Add your first prop"),
            // TAB LOCKS (docs/Story Pipeline.md step 9): a story with no props says so explicitly —
            // the mark unlocks Locations (app/art-tab-locks.js). Only an Art Room-writing role gets
            // the button (App passes onSetNoProps=null to everyone else).
            // with the tab locks off (2026-10-03) the mark unlocks nothing, so it only shows when they're on
            (onSetNoProps && !noPropsConfirmed && window.TURN_ART_TAB_LOCKS===true) && React.createElement("button",{type:"button",className:"art-draftall ghost",
                onClick:()=>onSetNoProps(true),
                title:"Confirm this story has no props \u2014 the "+noPropsNames.locations+" tab unlocks without a prop step. You can undo it."},
              React.createElement(Icon.check,{s:14}),"No props in this story")),
          (noPropsConfirmed && window.TURN_ART_TAB_LOCKS===true) && React.createElement("div",{className:"prop-noprops",role:"status"},
            React.createElement(Icon.check,{s:14}),
            React.createElement("span",null,"Marked \u201cNo props in this story\u201d \u2014 "+noPropsNames.locations+" is unlocked."),
            onSetNoProps && React.createElement("button",{type:"button",className:"prop-noprops-undo",onClick:()=>onSetNoProps(false),
              title:"Clear the mark \u2014 "+noPropsNames.locations+" then waits for props again (anything already built there stays reachable)"},"Undo"))));
}
window.PropSheets = PropSheets;

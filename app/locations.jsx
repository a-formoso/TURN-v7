/* locations.jsx — The Art Room ▸ Locations tab (data layer).
   Locations are DERIVED from the screenplay. Continuity-bearing places anchor master
   cards; room-level headings remain slugline units beneath a screenplay-evidenced
   enclosing place. Implied sides/thresholds in the screenplay body become coverage
   sheets with full screenplay-page snapshots as image references. Mirrors the Props
   flow: derive → draft → generate. This file
   owns scene-heading parsing / derivation / defaults + deterministic plate prompts;
   the React tab lives in locations-ui.jsx. */

/* a scene's turning point as text — the beat marked as the turn (scene-order.js) */
function _locTurn(sc){
  return (typeof sceneTurnText==="function") ? sceneTurnText(sc) : String((sc && sc.turningPoint) || "");
}
function locSlug(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48); }

function titleCaseTime(t){ t=String(t||"").trim(); return t ? t.replace(/\b\w/g,c=>c.toUpperCase()) : ""; }

/* canonical time-of-day buckets (Continuous/Later are NOT times — excluded) */
const TIME_OF_DAY = ["Dawn","Morning","Day","Afternoon","Dusk","Evening","Night"];
window.TIME_OF_DAY = TIME_OF_DAY;
/* map a worded time / synonym to a canonical bucket ("" if not a real time of day) */
function normalizeTOD(w){
  w = String(w||"").toLowerCase().trim();
  if(/sunrise|dawn|daybreak/.test(w)) return "Dawn";
  if(/morning/.test(w)) return "Morning";
  if(/noon|midday|daytime|^day$/.test(w)) return "Day";
  if(/afternoon/.test(w)) return "Afternoon";
  if(/dusk|sunset|twilight|golden hour|magic hour/.test(w)) return "Dusk";
  if(/evening/.test(w)) return "Evening";
  if(/night|midnight|nighttime/.test(w)) return "Night";
  return "";   // continuous / later / moments later / unknown → not a time of day
}
/* map a clock time string ("18:06", "6 pm", "07:30 am") to a time-of-day bucket.
   NOTE: clock time alone can't determine dusk/dawn reliably (season + latitude),
   so we only emit broad, defensible buckets here — Dawn/Morning/Day/Evening/Night.
   Dusk/Afternoon are reserved for sluglines that say so in words. */
function clockToTimeOfDay(str){
  const m = String(str).match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if(!m) return "";
  let h = parseInt(m[1],10); const ap = (m[3]||"").toLowerCase();
  if(ap==="pm" && h<12) h+=12; if(ap==="am" && h===12) h=0;
  if(h<0||h>23) return "";
  if(h>=5 && h<7) return "Dawn";
  if(h>=7 && h<11) return "Morning";
  if(h>=11 && h<17) return "Day";
  if(h>=17 && h<21) return "Evening";
  return "Night";
}
window.normalizeTOD = normalizeTOD; window.clockToTimeOfDay = clockToTimeOfDay;
/* Derive ALL real times-of-day for a location, accurately, FROM THE SCRIPT ONLY.
   Source of truth = each scene's slugline trailing tag ("· NIGHT" / "· DAY"),
   read via parseSlugline so we never pick up a time-word buried in a PLACE name.
   Also honours a clock time baked into a slugline or the location name.
   Scene SUMMARIES are deliberately NOT used — they are prose ("by day a programmer,
   by night the hacker…") and produce false times. Returns the distinct buckets in
   canonical day order; [] when no scene states a real time (Continuous / Loading
   Program / Later / unknown), which correctly shows as "time unset". */
function deriveLocationTimes(l, scenes){
  const set = new Set();
  // a clock time embedded in the location name itself (e.g. "… - 18:06")
  const nameClock = String((l&&l.name)||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
  if(nameClock){ const t = clockToTimeOfDay(nameClock[1]); if(t) set.add(t); }
  for(const sid of ((l&&l.scenes)||[])){
    const s = (scenes||[]).find(x=>x.id===sid);
    if(!s) continue;
    const parsed = parseSlugline(s.loc);
    if(!parsed) continue;
    let t = parsed.time ? normalizeTOD(parsed.time) : "";   // worded tag → bucket ("" for Continuous etc.)
    if(!t){                                                  // no worded time → maybe a clock time in the slug tail
      const c = String(s.loc||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
      if(c) t = clockToTimeOfDay(c[1]);
    }
    if(t) set.add(t);
  }
  return TIME_OF_DAY.filter(t=>set.has(t));   // canonical order: never "Night / Day"
}
window.deriveLocationTimes = deriveLocationTimes;


/* normalise a place into a canonical display name: title-case-ish but keep short
   ALL-CAPS acronyms (FBI, CIA); collapse whitespace. Common short words (the, of,
   a, o') are lower/title-cased normally, not treated as acronyms.
   (2026-10-14, owner — "go ahead with all of it") Italian and French particles too: "FONDAMENTA DEI VETRAI" reads
   "Fondamenta dei Vetrai", never "Fondamenta DEI Vetrai". Derived names only (areas, slugline units, a new card); a
   card's saved name stays as it is. */
const LOC_LOWER_WORDS = /^(the|of|a|an|and|to|in|on|at|by|o'|de|la|le|dei|della|di|del|degli|delle|dello|du|des)$/i;
function tidyPlace(p){
  return String(p||"").trim().replace(/\s+/g," ")
    .split(" ").map((w,i)=>{
      if(LOC_LOWER_WORDS.test(w)) return i===0 ? (w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()) : w.toLowerCase();
      // genuine short acronym (all caps, no lowercase, ≤3) -> keep as-is
      if(/^[A-Z0-9'’.\-]+$/.test(w) && w.length<=3 && /[A-Z]/.test(w)) return w;
      return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
    }).join(" ");
}

/* Parse one slugline into { intExt, place, time }.
   "INT. HEART O' THE CITY HOTEL · NIGHT" -> {intExt:"INT", place:"Heart o' the City Hotel", time:"Night"} */
function parseSlugline(raw){
  let s = String(raw||"").trim();
  if(!s) return null;
  s = s.replace(/^\s*\d+[\.\)]?\s+/,"");                 // strip a leading scene number
  let intExt = "";
  const m = s.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s*/i);
  if(m){ intExt = m[1].toUpperCase().replace(/\./g,"").replace(/I\/E/,"INT/EXT"); s = s.slice(m[0].length); }
  // time of day: trailing segment after the LAST separator, if it reads like a time
  // ("NIGHTS" too \u2014 2026-10-14: "INT. FURNACE \u00b7 NIGHTS" no longer makes a place called "Furnace \u00b7 Nights")
  let time = "";
  const tm = s.match(/[\u00b7\u2014,\-]\s*([A-Za-z][A-Za-z'\s]{1,22})\s*$/);
  if(tm && /\b(nights?|day|dawn|dusk|morning|evening|afternoon|continuous|later|moments?\s+later|sunset|sunrise|magic\s+hour|golden\s+hour|loading\s+program)\b/i.test(tm[1])){
    time = tm[1].trim(); s = s.slice(0, tm.index).trim();
  }
  let place = s.replace(/[\u00b7\u2014,\-\s]+$/,"").trim();
  if(!place) return null;
  return { intExt, place, time: titleCaseTime(time) };
}

/* split a compound slugline place into its segments: "APARTMENT / NIGHTCLUB" -> two */
function splitCompoundPlace(place){
  return String(place||"").split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
}

/* A screenplay can move between rooms without opening a formal secondary
   slugline. Filmmakers still need those named, filmable spaces as shot/location
   units. Recognise only two strong forms so ordinary prose such as "he looks
   toward the kitchen" cannot move the camera by accident:
   - a standalone room marker at the start of an action block: "THE KITCHEN."
   - the first establishing action beneath a heading ending in a room identity:
     "A dead man's living room." */
const SCREENPLAY_INLINE_SPACES = [
  "living room","sitting room","dining room","breakfast room","laundry room","utility room",
  "kitchen","bedroom","bathroom","washroom","hallway","corridor","foyer","entryway",
  "pantry","basement","cellar","attic","nursery","den","study","mudroom","sunroom"
];
function screenplayInlineSpaceName(text, allowEstablishing){
  const raw=String(text||"").replace(/\s+/g," ").trim();
  if(!raw) return "";
  const first=((raw.match(/^([^.!?]{1,180})[.!?](?:\s|$)/)||[])[1]||"").trim();
  if(!first) return "";
  const normal=s=>String(s||"").toLowerCase().replace(/^the\s+/,"").replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const exact=normal(first);
  const direct=SCREENPLAY_INLINE_SPACES.find(name=>exact===name);
  if(direct) return tidyPlace(direct);
  if(!allowEstablishing || !/^(?:a|an|the)\b/i.test(first)) return "";
  const low=String(first).toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const ending=SCREENPLAY_INLINE_SPACES.slice().sort((a,b)=>b.length-a.length)
    .find(name=>low===name||low.endsWith(" "+name));
  return ending ? tidyPlace(ending) : "";
}
function screenplayInlineSpaceHeading(text,currentHeading,allowEstablishing){
  const name=screenplayInlineSpaceName(text,allowEstablishing);
  if(!name) return "";
  const parent=parseSlugline(currentHeading)||{};
  return (parent.intExt||"INT")+". "+name+(parent.time?(" - "+parent.time):"");
}
window.screenplayInlineSpaceName=screenplayInlineSpaceName;
window.screenplayInlineSpaceHeading=screenplayInlineSpaceHeading;

/* SAME PLACE, TWO NAMES (owner-approved 2026-10-14, "go ahead with all of it" — fix A of the Fondamenta plan; Story
   Pipeline "Locations"). A place the screenplay names two ways (scene 13's card says "EXT. FONDAMENTA", its own
   screenplay heading "EXT. FONDAMENTA DEI VETRAI") used to become a parent card and a room card of one quay. The app
   now SUGGESTS it on both cards (locationSamePlaceSuggestions — never a merge on its own) and the owner decides:
   - Merge: one card. It takes the name and key the screenplay's headings use; the other names and keys are listed on
     it (aliasKeys, aliases), so the merged-away card is never derived again;
   - Part of: the place and its part stay as derived (partOfKeys on the part — kept even if a name changes later);
   - Keep separate: two places, never folded by name (notAliasOf on both cards).
   The decisions are new optional fields on the cards (absent on every older card — nothing is migrated, an old film
   derives exactly as before until the owner acts). Every derivation reads them (deriveLocations, deriveSubspaceFold,
   deriveSluglineUnits, reconcileSluglineUnits; shots follow the units): the app sets them once per render
   (setLocationPlaceDecisions), a caller may pass its own ({placeDecisions}). Cards in Recently deleted count too (a
   deleted survivor still holds its names). On a Show the cards are shared by every episode, so a decision holds in
   every episode's derivation. */
const _LOC_NO_DECISIONS = Object.freeze({alias:Object.freeze({}), names:Object.freeze({}), aliasNames:Object.freeze({}),
  separate:Object.freeze({}), partOf:Object.freeze({}), heads:Object.freeze({}), sig:""});
let _locPlaceDecisionsNow = _LOC_NO_DECISIONS;
function _locPairKey(a,b){ return [String(a||""),String(b||"")].sort().join("|"); }
function _locKeysOf(v){ return (Array.isArray(v)?v:[]).map(x=>String(x||"").trim()).filter(Boolean); }
function locationPlaceDecisions(locations, binned){
  const alias={}, names={}, aliasNames={}, separate={}, partOf={}, heads={};
  const live=(Array.isArray(locations)?locations:[]).filter(l=>l&&l.key);
  // SHARED-HEAD PARENTS (2026-10-26): a live card marked as the parent of a "PLACE - ROOM" head keeps that head grouping
  live.forEach(l=>{ if(l.sharedHeadParent) heads[String(l.key)]=String(l.name||""); });
  const liveKeys=new Set(live.map(l=>String(l.key)));
  const bin=(Array.isArray(binned)?binned:[]).filter(l=>l&&l.key);
  [live,bin].forEach((list,i)=>list.forEach(l=>{
    const own=String(l.key);
    if(i===1 && liveKeys.has(own)) return;   // a live card with this key owns the decisions about it
    if(!names[own]) names[own]=String(l.name||"");
    // an alias a LIVE card holds as its own key is not read as an alias (that card would freeze, never derived)
    _locKeysOf(l.aliasKeys).forEach(k=>{ if(k!==own && !liveKeys.has(k) && !alias[k]) alias[k]=own; });
    (Array.isArray(l.aliases)?l.aliases:[]).forEach(n=>{ n=String(n||"").trim(); if(!n) return;
      const at=aliasNames[own]||(aliasNames[own]=[]); if(at.indexOf(n)<0) at.push(n); });
    _locKeysOf(l.notAliasOf).forEach(k=>{ if(k!==own) separate[_locPairKey(own,k)]=true; });
    _locKeysOf(l.partOfKeys).forEach(k=>{ if(k!==own && !partOf[own]) partOf[own]=k; });
  }));
  // chains (A merged into B, B later into C) read A as C; a cycle stops where it repeats
  Object.keys(alias).forEach(k=>{
    const seen=new Set([k]); let cur=alias[k];
    while(alias[cur] && !seen.has(cur)){ seen.add(cur); cur=alias[cur]; }
    if(cur===k) delete alias[k]; else alias[k]=cur;
  });
  const empty=!Object.keys(alias).length && !Object.keys(separate).length && !Object.keys(partOf).length && !Object.keys(aliasNames).length
    && !Object.keys(heads).length;
  return {alias,names,aliasNames,separate,partOf,heads,
    sig:empty?"":JSON.stringify(Object.keys(heads).length?[alias,separate,partOf,aliasNames,heads]:[alias,separate,partOf,aliasNames])};
}
function setLocationPlaceDecisions(d){
  _locPlaceDecisionsNow = (d && typeof d==="object" && d.alias) ? d : _LOC_NO_DECISIONS;
  return _locPlaceDecisionsNow;
}
function locationPlaceDecisionsNow(){ return _locPlaceDecisionsNow; }
function _locDecisions(opts){ const d=opts && opts.placeDecisions; return (d && typeof d==="object" && d.alias) ? d : _locPlaceDecisionsNow; }
/* the key a place is read as: a merged-away name's key is its survivor's */
function locationAliasKey(key, decisions){
  const d=(decisions && decisions.alias) ? decisions : _locPlaceDecisionsNow, k=String(key||"");
  return (k && d.alias[k]) || k;
}
window.locationPlaceDecisions=locationPlaceDecisions;
window.setLocationPlaceDecisions=setLocationPlaceDecisions;
window.locationPlaceDecisionsNow=locationPlaceDecisionsNow;
window.locationAliasKey=locationAliasKey;

/* Collect every slugged place record + entry from screenplay headings — shared
   by deriveLocations (master cards) and deriveSubspaceFold (sub-space grouping).
   A scene's own slugline is read PLUS any secondary (mid-scene) sluglines the
   draft carries — a chase that cuts INT. HALL → EXT. ROOF names real places.
   INTERCUT lines are skipped (they reference already-slugged places, they don't
   introduce one). A merged-away name is read as its survivor (aliasNames records the
   other names a record was written as — the fold below reads them too). */
function collectSluggedPlaces(scenes, drafts, decisions, allHeads){
  const dec = (decisions && decisions.alias) ? decisions : _locPlaceDecisionsNow;
  const recOrder = []; const recByKey = {}; const entries = [];
  (scenes||[]).forEach(sc=>{
    if(!sc) return;
    const slugTexts = [sc.loc];
    const dBlocks = drafts && drafts[sc.id] && drafts[sc.id].blocks;
    if(Array.isArray(dBlocks)){
      let activeHeading=String(sc.loc||""), actionSinceHeading=0;
      dBlocks.forEach(b=>{
        if(b && b.type==="scene" && b.text && !/^\s*INTERCUT\b/i.test(b.text)){
          activeHeading=String(b.text); actionSinceHeading=0;
          if(String(b.text).trim().toUpperCase()!==String(sc.loc||"").trim().toUpperCase()) slugTexts.push(b.text);
          return;
        }
        if(!b || b.type!=="action") return;
        const inline=screenplayInlineSpaceHeading(b.text,activeHeading||sc.loc,actionSinceHeading===0);
        actionSinceHeading++;
        if(inline && String(inline).trim().toUpperCase()!==String(activeHeading||"").trim().toUpperCase()){
          slugTexts.push(inline); activeHeading=inline;
        }
      });
    }
    slugTexts.forEach(slugText=>{
      const parsed = parseSlugline(slugText);
      if(!parsed) return;
      const places = splitCompoundPlace(parsed.place);
      const primary = tidyPlace(places[0]);
      // a new scene's old placeholder heading ("INT. NEW LOCATION · DAY") is not a place (owner 2026-10-19)
      if(/^new location$/i.test(String(primary||"").trim())) return;
      const ownKey = locSlug(primary.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-");
      if(!ownKey) return;
      const key = locationAliasKey(ownKey, dec), headName = primary.split(/[\u00b7\u2014]/)[0].trim();
      if(!recByKey[key]){
        recByKey[key] = { key, name:key!==ownKey ? (dec.names[key]||headName) : headName, scenes:[], aliasNames:[] };
        if(key!==ownKey) recByKey[key].nameFromAlias = true;
        recOrder.push(key);
      }
      const R = recByKey[key];
      if(key===ownKey && R.nameFromAlias){ R.name = headName; delete R.nameFromAlias; }
      if(key!==ownKey && R.aliasNames.indexOf(headName)<0) R.aliasNames.push(headName);
      if(sc.id && R.scenes.indexOf(sc.id)<0) R.scenes.push(sc.id);
      entries.push({ key, ownKey, sc, parsed, places, primary });
    });
  });
  recOrder.forEach(k=>{ const R=recByKey[k];
    (dec.aliasNames[k]||[]).forEach(n=>{ if(R.aliasNames.indexOf(n)<0) R.aliasNames.push(n); });
    delete R.nameFromAlias; });
  addSharedHeadParents(recOrder, recByKey, dec, allHeads);
  return { recOrder, recByKey, entries };
}
/* SHARED-HEAD PARENTS (owner-approved 2026-10-26, "go ahead with the locations plan"; Story Pipeline "Locations"). A
   screenplay can name every space of one place as "PLACE - ROOM" without ever heading a scene "INT. PLACE":
   MARMORICA - CAR DECK, MARMORICA - UPPER DECK, MARMORICA - LIFEJACKET LOCKER… Rule B (prefix containment) nests those
   under a card called "Marmorica" — but no slugline made one, so each space became a location of its own, with its own
   layout and its own north. When two or more places share the head before " - " (or " – "), a parent record of that
   name is added; Rule B then folds every "Marmorica - …" and "Marmorica …" place under it, each keeping its own card,
   slugline units and plates, and the parent becomes the continuity root that owns the shared layout and the 2x2 plate.
   Which heads: all of them in a new film's first derivation (opts.sharedHeads "all", app.jsx pullLocationsFromScript
   with no location cards yet); afterwards only heads with a card marked sharedHeadParent (decisions.heads) — so an
   existing film never regroups on its own: the Locations tab suggests it (locationSharedHeadSuggestions) and the owner
   groups (locationSharedHeadApply) or keeps the places apart (notAliasOf, read as "Keep separate"). */
function locationSharedHead(name){
  const m = /^(.+?)\s+[-\u2013]\s+(.+)$/.exec(String(name||"").trim());
  if(!m) return null;
  const head = m[1].trim(), key = locSlug(head).split("-").slice(0,4).join("-");
  if(!key || head.replace(/[^A-Za-z]/g,"").length<3 || /^(int|ext|int\/ext|i\/e)$/i.test(head)) return null;
  return { head, key };
}
function addSharedHeadParents(recOrder, recByKey, dec, allHeads){
  const groups = {};
  recOrder.forEach(k=>{ const R=recByKey[k]; const h=R && locationSharedHead(R.name); if(!h || h.key===k) return;
    (groups[h.key]||(groups[h.key]={ head:h.head, keys:[] })).keys.push(k); });
  Object.keys(groups).forEach(hk=>{
    const g = groups[hk], known = dec && dec.heads && Object.prototype.hasOwnProperty.call(dec.heads, hk);
    if(recByKey[hk] || g.keys.length<2 || !(known || allHeads)) return;
    const scenes = []; g.keys.forEach(k=>(recByKey[k].scenes||[]).forEach(sid=>{ if(scenes.indexOf(sid)<0) scenes.push(sid); }));
    recByKey[hk] = { key:hk, name:(known && dec.heads[hk]) || tidyPlace(g.head), scenes, aliasNames:[], sharedHead:true };
    recOrder.splice(recOrder.indexOf(g.keys[0]), 0, hk);   // the parent's card comes first, where its first room was
  });
}
window.locationSharedHead = locationSharedHead;

/* SUB-SPACE FOLD — "INT. INTAKE BOOTH - NIGHT" inside a scene that also visits
   "EXT. INTAKE YARD - NIGHT": the booth is a sub-structure of the yard complex,
   not a master location of its own. A slugged place folds under a parent place
   when its name carries a sub-structure noun (booth, kiosk, gatehouse, office,
   cabin…), shares its FIRST name token with the parent (same named complex),
   and never appears in a scene the parent doesn't. Generic rooms fold only when the
   screenplay identifies one unique enclosing continuity place; vehicles never fold
   merely by name (a police car is not the police station). The sub-place keeps its
   own slugline unit and stable unit key; only master-card grouping moves. */
const SUBSPACE_TAIL = /\b(?:booth|kiosk|gatehouse|cabin|hut|shed|stall|office|annex|porch|garage|workshop)\b/i;
const CONTAINER_CHILD_TAIL = /\b(?:booth|kiosk|gatehouse|cabin|hut|shed|stall|office|annex|porch|garage|workshop)\s*$/i;
/* Generic rooms are filmable spaces, but they are not automatically continuity-
   bearing places. When the screenplay itself identifies their enclosing site, fold
   them under that site's master while keeping each slugline as its own unit. This is
   deliberately evidence-gated: "Kitchen" only folds when its scenes actually say
   house/home/apartment/etc., and a tie between possible parents stays separate. */
const GENERIC_ROOM_SUBSPACE = /^(?:the\s+)?(?:kitchen|living room|sitting room|dining room|breakfast room|bedroom|bathroom|washroom|hallway|corridor|foyer|entryway|pantry|laundry room|utility room|basement|cellar|attic|nursery|den|study|mudroom|sunroom)(?:\s+\d+)?$/i;
const CONTINUITY_CONTAINER_KINDS = [
  { parent:/\b(?:house|home|residence|cottage|bungalow|farmhouse|mansion|manor|villa|apartment|flat|condo)\b/i,
    evidence:/\b(?:house|home|residence|cottage|bungalow|farmhouse|mansion|manor|villa|apartment|flat|condo)\b/i,
    words:["house","home","residence","cottage","bungalow","farmhouse","mansion","manor","villa","apartment","flat","condo"] },
  { parent:/\b(?:hotel|motel|inn|hostel)\b/i, evidence:/\b(?:hotel|motel|inn|hostel)\b/i,
    words:["hotel","motel","inn","hostel"] },
  { parent:/\b(?:hospital|clinic|medical center)\b/i, evidence:/\b(?:hospital|clinic|medical center)\b/i,
    words:["hospital","clinic","medical center"] },
  { parent:/\b(?:school|college|university|academy|campus)\b/i, evidence:/\b(?:school|college|university|academy|campus)\b/i,
    words:["school","college","university","academy","campus"] },
  { parent:/\b(?:station|precinct|courthouse|government building|office building|headquarters|factory|warehouse)\b/i,
    evidence:/\b(?:station|precinct|courthouse|government building|office building|headquarters|factory|warehouse)\b/i,
    words:["station","precinct","courthouse","government building","office building","headquarters","factory","warehouse"] }
];
function locationFoldEvidence(sub, scenes, drafts){
  const bits=[];
  (sub&&sub.scenes||[]).forEach(sid=>{
    const sc=(scenes||[]).find(s=>s&&s.id===sid); if(!sc) return;
    [sc.title,sc.summary,sc.objective,_locTurn(sc)].forEach(x=>{ if(x) bits.push(x); });
    locationScreenplayBlocks(sc,drafts).forEach(b=>{ if(b&&b.text) bits.push(b.text); });
  });
  return bits.join(" ").toLowerCase().replace(/[’']s\b/g,"").replace(/[^a-z0-9]+/g," ");
}
function semanticRoomParent(sub, recs, scenes, drafts){
  if(!sub || !GENERIC_ROOM_SUBSPACE.test(String(sub.name||"").trim())) return null;
  const evidence=locationFoldEvidence(sub, scenes, drafts);
  if(!evidence) return null;
  const stop=new Set(["the","a","an","of","at","and","house","home","residence","cottage","bungalow","farmhouse","mansion","manor","villa","apartment","flat","condo","hotel","motel","inn","hostel","hospital","clinic","medical","center","school","college","university","academy","campus","station","precinct","courthouse","government","building","office","headquarters","factory","warehouse"]);
  const scored=(recs||[]).filter(p=>p&&p.key!==sub.key
    &&!GENERIC_ROOM_SUBSPACE.test(String(p.name||"").trim())
    // A card such as Funeral Home Office is itself a filmable subspace, not an
    // enclosing site candidate for an unrelated Kitchen or Living Room.
    &&!CONTAINER_CHILD_TAIL.test(String(p.name||"").trim())).map(parent=>{
    const kind=CONTINUITY_CONTAINER_KINDS.find(k=>k.parent.test(String(parent.name||"")));
    if(!kind) return null;
    let score=kind.evidence.test(evidence)?5:0;
    // Prefer the container noun the screenplay actually uses. This keeps a HOUSE
    // from tying with an unrelated Funeral HOME merely because both are residential
    // words in the same broad category.
    const parentLow=String(parent.name||"").toLowerCase();
    const exactKind=(kind.words||[]).find(w=>new RegExp("\\b"+w.replace(/ /g,"\\s+")+"\\b").test(parentLow));
    if(exactKind && new RegExp("\\b"+exactKind.replace(/ /g,"\\s+")+"\\b").test(evidence)) score+=3;
    const tokens=String(parent.name||"").toLowerCase().replace(/[’']s\b/g,"").split(/[^a-z0-9]+/)
      .filter(w=>w.length>=4&&!stop.has(w));
    tokens.forEach(w=>{ if(new RegExp("\\b"+w+"\\b").test(evidence)) score+=3; });
    if((parent.scenes||[]).some(sid=>(sub.scenes||[]).indexOf(sid)>=0)) score+=1;
    return score>=5?{parent,score}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  return scored.length && (!scored[1] || scored[0].score>scored[1].score) ? scored[0].parent : null;
}
/* (see Rule B below; both names lower-cased; also read by the same-place check) */
function locationNameStartsArea(subN, parN){
  if(!parN || subN===parN || subN.indexOf(parN)!==0) return false;
  const rest = subN.slice(parN.length);
  return /^\s*[-\u00b7\u2014,]/.test(rest) || /^\s/.test(rest);
}
function foldSubspaceKeys(recs, scenes, drafts, decisions){
  const dec = (decisions && decisions.alias) ? decisions : _locPlaceDecisionsNow;
  const headTok = (n)=> String(n||"").trim().split(/\s+/)[0].toLowerCase();
  const low = (n)=> String(n||"").trim().toLowerCase();
  // the owner's decisions (2026-10-14): "Keep separate" — never folded into each other; a merged place is also known by
  // its other names (a part of "Fondamenta" stays a part of the merged "Fondamenta dei Vetrai")
  const apart = (a,b)=> !!dec.separate[_locPairKey(a,b)];
  const namesOf = (p)=> [p.name].concat(Array.isArray(p.aliasNames)?p.aliasNames:[]).filter(Boolean);
  /* RULE B — PREFIX CONTAINMENT: "PARENT - AREA" / "PARENT AREA" names an area OF
     the parent by construction ("E-waste Canals - Flooded Junction" ⊂ "E-waste
     Canals"). The name itself declares containment, so no scene-subset or lexicon
     is required; a trailing name boundary is, so "Yardbird" never folds under "Yard". */
  const startsArea = locationNameStartsArea;
  const out = {};
  (recs||[]).forEach(sub=>{
    if(!sub || !sub.key) return;
    // "PART OF" (the owner's decision): this place stays a part of that one whatever the names say
    const told = dec.partOf[sub.key];
    if(told && told!==sub.key && !apart(sub.key,told) && (recs||[]).some(p=>p && p.key===told)){ out[sub.key] = told; return; }
    // RULE A — SUB-STRUCTURE NOUN + shared first token + scene containment
    // ("Intake Booth" only ever plays inside scenes that also visit "Intake Yard").
    if(SUBSPACE_TAIL.test(sub.name)){
      const tok = headTok(sub.name);
      if(tok){
        const parents = (recs||[]).filter(p=> p && p.key!==sub.key
          && !apart(sub.key,p.key)
          && !SUBSPACE_TAIL.test(p.name)
          && namesOf(p).some(n=>headTok(n)===tok)
          && sub.scenes.every(sid=> p.scenes.indexOf(sid)>=0));
        if(parents.length){
          parents.sort((a,b)=> b.scenes.length - a.scenes.length);   // the most-visited sibling is the complex's master
          out[sub.key] = parents[0].key;
          return;
        }
      }
    }
    // RULE B — longest matching prefix parent wins; chains ("A - B - C" under
    // "A - B" under "A") resolve transitively when the fold is applied.
    const matchLen = (p)=> Math.max(0, ...namesOf(p).filter(n=>startsArea(low(sub.name), low(n))).map(n=>String(n).length));
    const prefixes = (recs||[]).filter(p=> p && p.key!==sub.key && !apart(sub.key,p.key) && matchLen(p)>0);
    if(prefixes.length){
      prefixes.sort((a,b)=> matchLen(b) - matchLen(a));
      out[sub.key] = prefixes[0].key;
      return;
    }
    // RULE C — screenplay-evidenced room containment: KITCHEN / LIVING ROOM
    // remain distinct slugline units but share the enclosing HOUSE master.
    const semantic = semanticRoomParent(sub, recs, scenes, drafts);
    if(semantic && !apart(sub.key, semantic.key)) out[sub.key] = semantic.key;
  });
  // a place the owner said is a part of another is never also that one's parent
  Object.keys(dec.partOf).forEach(child=>{ const parent=dec.partOf[child]; if(out[child]===parent && out[parent]===child) delete out[parent]; });
  return out;
}
/* chase a fold chain to its ultimate master, with a cycle guard */
function resolveFoldKey(fold, key){
  const seen = {}; let cur = key;
  while(fold[cur] && !seen[cur]){ seen[cur] = true; cur = fold[cur]; }
  return cur;
}
function deriveSubspaceFold(scenes, drafts, opts){
  const dec = _locDecisions(opts);
  const c = collectSluggedPlaces(scenesInStoryOrder(scenes), drafts, dec, !!(opts && opts.sharedHeads==="all"));
  const fold = foldSubspaceKeys(c.recOrder.map(k=>c.recByKey[k]), scenes, drafts, dec);
  const resolved = {};
  Object.keys(fold).forEach(k=>{ resolved[k] = resolveFoldKey(fold, k); });
  return resolved;
}
window.deriveSubspaceFold = deriveSubspaceFold;

/* Derive canonical master locations from screenplay scene headings.
   Groups scenes by a normalised key on the PRIMARY place so "NEBUCHADNEZZAR · CORE"
   and "NEBUCHADNEZZAR · TRAINING" land under one "Nebuchadnezzar" (areas recorded).
   A room-level secondary heading becomes a slugline unit under a unique enclosing
   place when the screenplay supplies that relationship; ambiguous rooms stay as
   separate masters. Implied sides and threshold spaces inside action prose are
   handled by coverage sheets on the relevant master card. Named sub-structures
   (booth, kiosk…) likewise fold under their complex's master. Returns new objects only
   (deduped against `existing`). The owner's same-place decisions apply (opts.placeDecisions, else the app's —
   see SAME PLACE, TWO NAMES above): a merged-away name is read as its survivor and is never a card of its own. */
function deriveLocations(scenes, existing, drafts, opts){
  scenes = scenesInStoryOrder(scenes);
  const dec = _locDecisions(opts);
  const have = existing || [];
  const seen = new Set(have.map(l=>l.key || locSlug(l.name)));
  const c = collectSluggedPlaces(scenes, drafts, dec, !!(opts && opts.sharedHeads==="all"));
  const fold = foldSubspaceKeys(c.recOrder.map(k=>c.recByKey[k]), scenes, drafts, dec);
  const order = []; const byKey = {};
  const ensure = (key,rootKey)=>{
    if(byKey[key]) return byKey[key];
    const rec = c.recByKey[key] || c.recByKey[rootKey] || {};
    const isChild = key!==rootKey;
    byKey[key] = {
      key, name:rec.name || key.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase()),
      intExt:"", times:new Set(), areas:new Set(), scenes:[],
      scope:"atomic", parentKey:isChild?rootKey:"", continuityRootKey:rootKey,
    };
    order.push(key);
    return byKey[key];
  };
  const addEntry = (L,e,asRoot)=>{
    if(e.parsed.time) L.times.add(e.parsed.time);
    const areaTail=e.primary.split(/\u00b7/).slice(1).join(" \u00b7 ").trim();
    if(areaTail) L.areas.add(areaTail);
    e.places.slice(1).forEach(p=>L.areas.add(tidyPlace(p)));
    if(e.sc.id && L.scenes.indexOf(e.sc.id)<0) L.scenes.push(e.sc.id);
    if(e.parsed.intExt){
      if(!L.intExt) L.intExt=e.parsed.intExt;
      else if(e.parsed.intExt!==L.intExt) L.intExt="INT/EXT";
    }
    if(asRoot && e.key!==L.key)
      L.areas.add((c.recByKey[e.key]&&c.recByKey[e.key].name)||e.primary.split(/[\u00b7\u2014]/)[0].trim());
  };
  c.entries.forEach(e=>{
    const rootKey=resolveFoldKey(fold,e.key);
    const root=ensure(rootKey,rootKey);
    if(e.key!==rootKey) root.scope="compound";
    addEntry(root,e,true);
    if(e.key!==rootKey) addEntry(ensure(e.key,rootKey),e,false);
  });
  const out=[];
  order.forEach((key,orderIndex)=>{
    if(seen.has(key)) return;
    const L=byKey[key];
    out.push({
      id:"loc-"+key+"-"+orderIndex,
      key,name:L.name,intExt:L.intExt||"INT",
      // times in the SAME buckets and order the card keeps (deriveLocationTimes): Continuous / Later are
      // no time at all — the sync and the card used to overwrite each other's lists (2026-10-08)
      times:deriveLocationTimes({ name:L.name, scenes:L.scenes }, scenes),areas:[...L.areas],scenes:L.scenes,
      scope:L.scope,parentKey:L.parentKey,continuityRootKey:L.continuityRootKey,
      ...((c.recByKey[key]||{}).sharedHead ? { sharedHeadParent:true } : {}),
      architecture:"",materials:"",lighting:"",permanentDressing:"",
      topology:"",continuityAnchors:"",anchorsLocked:true,significance:"",
      provenance:{},renderStyle:"",negativePrompt:"",variants:[],fromScript:true,
    });
  });
  return out;
}
window.deriveLocations = deriveLocations;
window.parseSlugline = parseSlugline;
window.locSlug = locSlug;

/* ---- SAME PLACE, TWO NAMES — the suggestion, the merge and the owner's other answers (owner-approved 2026-10-14, "go
   ahead with all of it"; see the decisions above collectSluggedPlaces, and Story Pipeline "Locations").
   SUGGESTED, NEVER APPLIED ON ITS OWN. The strong sign is a scene whose CARD slugline names another place than the first
   heading of its own screenplay (Glass Hours scene 13: card "EXT. FONDAMENTA · NIGHT", screenplay "EXT. FONDAMENTA DEI
   VETRAI — NIGHT"). It counts only together with the name fold (one name is the other plus more words) and shared
   scenes (the card's name plays in no scene the screenplay's name doesn't) — the fold and the scenes alone also fit an
   ordinary "HOUSE" with a "HOUSE - KITCHEN", which is a real place and its part. Both cards say it; "Same place as…"
   on any card merges a pair nothing points at (Glass Hours' Fiorin Furnace and Furnace). ---- */
function _locPlaceOf(slugText, dec){
  const parsed = parseSlugline(slugText); if(!parsed) return null;
  const primary = tidyPlace(splitCompoundPlace(parsed.place)[0]||""); if(!primary) return null;
  const ownKey = locSlug(primary.split(/[·—,]/)[0]).split("-").slice(0,4).join("-"); if(!ownKey) return null;
  return { key:locationAliasKey(ownKey,dec), ownKey, name:primary.split(/[·—]/)[0].trim(),
    side:parsed.intExt||"", time:parsed.time||"", place:parsed.place };
}
/* the first heading of a scene's own screenplay — its restatement of the scene heading ("" when the draft opens on
   anything else, or there is none) */
function locationDraftFirstHeading(sc, drafts){
  const blocks = sc && drafts && drafts[sc.id] && drafts[sc.id].blocks;
  if(!Array.isArray(blocks)) return "";
  const first = blocks.find(b=>b && b.type!=="transition" && String(b.text||"").trim());
  if(!first || first.type!=="scene") return "";
  const t = String(first.text||"").trim();
  return /^\s*(?:\d+[\.\)]?\s+)?INTERCUT\b/i.test(t) ? "" : t;
}
function locationSamePlaceText(s){
  const nos = ((s && s.scenes) || []).map(x=>x && x.no).filter(n=>n!=null && n!=="");
  const list = nos.length<=1 ? String(nos.length ? nos[0] : "") : nos.slice(0,-1).join(", ")+" and "+nos[nos.length-1];
  return "These look like one place: "+(nos.length<=1
    ? "scene "+list+"'s card says "+s.cardPlace+", its screenplay says "
    : "the cards of scenes "+list+" say "+s.cardPlace+", their screenplay says ")+s.headingPlace;
}
/* every pair of cards that look like one place: [{pair, cardId, headingId (the screenplay's name), childId, parentId
   (today's fold), cardPlace, headingPlace, scenes:[{id,no,card,heading}], text}] — a pair the owner answered is left out */
function locationSamePlaceSuggestions(locations, scenes, drafts, opts){
  const dec = _locDecisions(opts);
  const list = (Array.isArray(locations)?locations:[]).filter(l=>l && l.key);
  const cardOf = (key)=> list.find(l=>String(l.key)===String(key)) || null;
  const ordered = scenesInStoryOrder(scenes||[]);
  const c = collectSluggedPlaces(ordered, drafts, dec);
  const low = (s)=> String(s||"").trim().toLowerCase();
  const byPair = {}, out = [];
  ordered.forEach(sc=>{
    if(!sc || !String(sc.loc||"").trim()) return;
    const heading = locationDraftFirstHeading(sc, drafts); if(!heading) return;
    const card = _locPlaceOf(sc.loc, dec), said = _locPlaceOf(heading, dec);
    if(!card || !said || card.key===said.key) return;
    if(card.side && said.side && card.side!==said.side) return;     // INT on the card, EXT in the screenplay: another matter
    const A = c.recByKey[card.key], B = c.recByKey[said.key];
    if(!A || !B) return;
    // one name is the other plus more words (the fold that made a place and its part of them)…
    const bUnderA = locationNameStartsArea(low(B.name), low(A.name)), aUnderB = locationNameStartsArea(low(A.name), low(B.name));
    if(!bUnderA && !aUnderB) return;
    // …and the card's name plays in no scene the screenplay's name doesn't (a "HOUSE" with scenes of its own is a place)
    if(!A.scenes.every(sid=>B.scenes.indexOf(sid)>=0)) return;
    const pair = _locPairKey(A.key, B.key);
    if(dec.separate[pair] || dec.partOf[A.key]===B.key || dec.partOf[B.key]===A.key) return;
    const cardLoc = cardOf(A.key), headLoc = cardOf(B.key);
    if(!cardLoc || !headLoc || cardLoc.id===headLoc.id) return;
    let s = byPair[pair];
    if(!s){
      const child = bUnderA ? headLoc : cardLoc, parent = bUnderA ? cardLoc : headLoc;
      s = byPair[pair] = { pair, cardKey:String(A.key), headingKey:String(B.key), cardId:cardLoc.id, headingId:headLoc.id,
        cardName:cardLoc.name||"", headingName:headLoc.name||"",
        childId:child.id, parentId:parent.id, childName:child.name||"", parentName:parent.name||"",
        cardPlace:card.name.toUpperCase(), headingPlace:said.name.toUpperCase(), scenes:[] };
      out.push(s);
    }
    s.scenes.push({ id:sc.id, no:sc.no, card:String(sc.loc).trim(), heading });
  });
  out.forEach(s=>{ s.text = locationSamePlaceText(s); });
  return out;
}
function _locHasLayout(l){
  const p = normalizeLocationSpatialPlan(l && l.spatialPlan);
  return !!(p.frame.trim() || p.anchors.length || p.coordinates);
}
function _locUniq(list, caseless){
  const seen = new Set(), out = [];
  (list||[]).forEach(x=>{ const v = String(x==null ? "" : x).trim(), k = caseless ? v.toLowerCase() : v;
    if(!v || seen.has(k)) return; seen.add(k); out.push(v); });
  return out;
}
/* a scene card's slugline with its place's NAME in the screenplay heading's words — everything else on the card (its
   side, its time, a state or the weather after the name) stays: "INT. DANFO (STOPPED) · NIGHT · RAIN" with a heading
   "INT. DANFO — NIGHT — STOPPED" reads "INT. DANFO · NIGHT · RAIN", never the heading's own tail */
function locationCorrectedSlugline(cardLoc, heading){
  const cp = parseSlugline(cardLoc), hp = parseSlugline(heading);
  if(!hp || !hp.place) return "";
  const headOf = (place)=> String(splitCompoundPlace(place)[0]||"").split(/[·—]/)[0].trim();
  const newHead = headOf(hp.place).toUpperCase();
  if(!newHead) return "";
  const raw = String(cardLoc||"").replace(/^\s*\d+[\.\)]?\s+/,"").trim();
  const sideM = raw.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)(?=\s|$)\s*/i);
  let side = ((sideM||[])[1]||"").toUpperCase();
  if(!side && hp.intExt) side = hp.intExt==="INT/EXT" ? "INT./EXT." : hp.intExt+".";
  else if(side && !/\.$/.test(side)) side += ".";
  const rest = sideM ? raw.slice(sideM[0].length) : raw;
  const oldHead = cp ? headOf(cp.place) : "";
  if(oldHead && rest.slice(0, oldHead.length).toLowerCase()===oldHead.toLowerCase())
    return [side, newHead+rest.slice(oldHead.length)].filter(Boolean).join(" ");
  const time = (cp && cp.time) || "";
  return [side, newHead].filter(Boolean).join(" ")+(time ? " · "+time.toUpperCase() : "");
}
/* WHAT A MERGE DOES — pure, so the confirm says exactly that. opts.nameFrom: the card whose name the merged card takes
   (default: the one the screenplay's headings use, then the one with more scenes); opts.hasPlate(id). */
function locationMergePlan(locations, scenes, drafts, aId, bId, opts){
  opts = opts || {};
  const dec = _locDecisions(opts);
  const list = (Array.isArray(locations)?locations:[]).filter(Boolean);
  const a = list.find(l=>l.id===aId), b = list.find(l=>l.id===bId);
  if(!a || !b || a.id===b.id || !a.key || !b.key) return null;
  const ordered = scenesInStoryOrder(scenes||[]);
  // how many scenes' screenplay headings use a name (a scene with no screenplay counts its card slugline)
  const headingCount = (key)=> ordered.filter(sc=>{
    if(!sc) return false;
    const blocks = drafts && drafts[sc.id] && drafts[sc.id].blocks;
    const heads = Array.isArray(blocks) && blocks.some(x=>x && x.type==="scene")
      ? blocks.filter(x=>x && x.type==="scene" && String(x.text||"").trim()).map(x=>x.text) : [sc.loc];
    return heads.some(t=>{ const p = _locPlaceOf(t, dec); return !!p && p.ownKey===String(key); });
  }).length;
  const ha = headingCount(a.key), hb = headingCount(b.key);
  let nameCard = opts.nameFrom===a.id ? a : opts.nameFrom===b.id ? b : null;
  if(!nameCard) nameCard = hb>ha ? b : ha>hb ? a : ((b.scenes||[]).length>(a.scenes||[]).length ? b : a);
  const otherName = nameCard===a ? b : a;
  const byHeadings = (nameCard===a ? ha : hb) > (nameCard===a ? hb : ha);
  // the card KEPT: the one that owns a shared layout, then the one with a plate — its plate, layout and view
  // composition stay exactly as they are (a layout is checked against the plate it was made from)
  const hasPlate = typeof opts.hasPlate==="function" ? opts.hasPlate
    : (id)=> typeof nbGetImage==="function" && !!nbGetImage(id);
  // (whichever name is picked: the card kept is the same — then the one with more scenes, then the one with rooms)
  const rooms = (l)=> list.filter(x=>x && x.id!==a.id && x.id!==b.id && String(x.parentKey||"")===String(l.key)).length;
  const weight = (l)=> [(_locHasLayout(l) ? 2 : 0) + (hasPlate(l.id) ? 1 : 0), (l.scenes||[]).length, rooms(l)];
  const wa = weight(a), wb = weight(b);
  const cmp = wa[0]-wb[0] || wa[1]-wb[1] || wa[2]-wb[2];
  const keeper = cmp>0 ? a : cmp<0 ? b : nameCard;
  const gone = keeper===a ? b : a;
  // the screenplay's spelling ("Fondamenta dei Vetrai"), unless the card was renamed to other words by hand
  const recs = collectSluggedPlaces(ordered, drafts, dec).recByKey;
  const nameOf = (l)=>{ const rec = recs[l.key], derived = rec && rec.name ? String(rec.name) : "";
    return (derived && _locNameKey(derived)===_locNameKey(l.name)) ? derived : String(l.name||derived||"").trim(); };
  const name = nameOf(nameCard);
  const key = String(nameCard.key);
  const aliasKeys = _locUniq(_locKeysOf(keeper.aliasKeys).concat(_locKeysOf(gone.aliasKeys), [keeper.key, gone.key])).filter(k=>k!==key);
  const aliases = _locUniq([].concat(keeper.aliases||[], gone.aliases||[], [keeper.name, gone.name]), true)
    .filter(n=>n.toLowerCase()!==name.toLowerCase());
  // the scene cards that disagree with their own screenplay, corrected to the screenplay's words
  const joined = (k)=> k===key || aliasKeys.indexOf(k)>=0;
  const sceneFixes = [];
  ordered.forEach(sc=>{
    const heading = locationDraftFirstHeading(sc, drafts); if(!heading) return;
    const card = _locPlaceOf(sc.loc, dec), said = _locPlaceOf(heading, dec);
    if(!card || !said || card.ownKey===said.ownKey || !joined(card.ownKey) || said.ownKey!==key) return;
    const to = locationCorrectedSlugline(sc.loc, heading);
    if(to && to!==String(sc.loc)) sceneFixes.push({ sceneId:sc.id, no:sc.no, from:String(sc.loc), to });
  });
  return { keeperId:keeper.id, goneId:gone.id, keeperName:keeper.name||"", goneName:gone.name||"",
    oldKey:String(keeper.key), name, key, aliasKeys, aliases, byHeadings,
    nameFromId:nameCard.id, altNameFromId:otherName.id, altName:nameOf(otherName),
    // the merged card takes the other card's key: that card can't come back as a card of its own (Recently deleted keeps it)
    goneKeyTaken:String(gone.key)===key,
    keeperHasLayout:_locHasLayout(keeper), goneHasLayout:_locHasLayout(gone),
    keeperHasPlate:!!hasPlate(keeper.id), goneHasPlate:!!hasPlate(gone.id),
    keeperHasStaging:typeof stagingHasContent==="function" ? stagingHasContent(keeper) : !!keeper.staging,
    goneSheets:(Array.isArray(gone.coverageSheets)?gone.coverageSheets.length:0)+(Array.isArray(gone.variants)?gone.variants.length:0),
    // the other card's own images, copied onto the kept card as earlier versions of its plate (hasImage: one is there)
    carry:locationMergeCarryIds(gone).map(c=>({ ...c, hasImage:!!hasPlate(c.id) })),
    sceneFixes };
}
/* A MERGE KEEPS THE OTHER CARD'S PLATES (2026-10-14, the gap an independent check found in fix A): the images the
   merged-away card takes to Recently deleted under its own id — the ones deleting it for good clears (app.jsx
   purgeLocation): its plate, its extra-space plates and its own environment-state plates (a room & time plate belongs
   to its room & time, which the merged card keeps). Each is COPIED onto the kept card as an earlier version of its
   plate (imagegen.jsx nbCarryVersionsInto) — the kept card's current plate is never replaced; the originals stay with
   the card in Recently deleted. Pure: [{id, cardId, name, what:"plate"|"extra space"|"environment state", label}]. */
function locationMergeCarryIds(gone){
  if(!gone || gone.id==null || gone.id==="") return [];
  const id = String(gone.id), name = String(gone.name||"").trim();
  const out = [{ id, cardId:id, name, what:"plate", label:"" }];
  (Array.isArray(gone.coverageSheets) ? gone.coverageSheets : []).forEach(v=>{
    if(v && v.id!=null && v.id!=="") out.push({ id:id+"-"+v.id, cardId:id, name, what:"extra space", label:String(v.name||"").trim() }); });
  (Array.isArray(gone.variants) ? gone.variants : []).forEach(v=>{
    if(v && v.id!=null && v.id!=="") out.push({ id:id+"-"+v.id, cardId:id, name, what:"environment state",
      label:[v.time, v.state].map(x=>String(x||"").trim()).filter(Boolean).join(" · ") }); });
  const seen = new Set();
  return out.filter(c=>{ if(seen.has(c.id)) return false; seen.add(c.id); return true; });
}
/* the confirm for a merge — ctx: canFixScenes (the role can save scene cards), show (the film is an episode of a Show),
   offerOtherName (the "Same place as…" path: the other name is a second button), altPlan (what that button does) */
function locationMergeConfirmText(plan, ctx){
  ctx = ctx || {};
  const q = (s)=> "“"+String(s||"")+"”";
  const kept = [plan.keeperHasPlate && "its plate", plan.keeperHasLayout && "the shared layout (with its floor plan)",
    plan.keeperHasStaging && "its view composition"].filter(Boolean);
  const list = (xs)=> xs.length<=1 ? (xs[0]||"") : xs.slice(0,-1).join(", ")+" and "+xs[xs.length-1];
  const items = [];
  items.push(q(plan.keeperName)+"’s card stays"+(kept.length ? ", with "+list(kept)+" as they are" : "")
    +(plan.keeperName!==plan.name ? ", and is named "+q(plan.name)+(plan.byHeadings ? " — the name the screenplay’s headings use" : "") : "")+".");
  const goneWith = [plan.goneHasPlate && "its own plate", plan.goneHasLayout && "its own shared layout",
    plan.goneSheets ? plan.goneSheets+" other plate"+(plan.goneSheets!==1?"s":"") : ""].filter(Boolean);
  items.push(q(plan.goneName)+"’s scenes join it (and any description it has that the other card lacks); its card moves to Recently deleted"
    +(goneWith.length ? " with "+list(goneWith) : "")+" — nothing is deleted for good"
    +(plan.goneKeyTaken ? " (it stays there: the merged card now has its name, so it can’t come back as a card of its own)" : "")+".");
  // (2026-10-14) …and copies of them stay on the merged card, as earlier versions of its plate
  const carried = (plan.carry||[]).filter(c=>c && c.hasImage);
  if(carried.length){
    const own = carried.some(c=>c.what==="plate"), others = carried.length-(own ? 1 : 0);
    const otherPlates = (others===1 ? "its other plate" : "its "+others+" other plates");
    const what = carried.length===1 ? "A copy of "+(own ? "its plate" : otherPlates)+" is"
      : "Copies of "+(own ? "its plate and "+otherPlates : otherPlates)+" are";
    items.push(what+" kept on the merged card too, as "+(carried.length===1 ? "an earlier version" : "earlier versions")
      +" in its plate’s version history (⋯ › Details › Earlier versions, where Restore makes "+(carried.length===1 ? "it" : "one")+" the current plate); "
      +(plan.keeperHasPlate ? q(plan.keeperName)+"’s current plate stays as it is." : "the merged card has no current plate, and none is made."));
  }
  /* an Art director can't edit scenes (2026-10-14): the scene card keeps its heading as it is and the merged place still
     reads correctly; the owner's merge corrects it — said plainly */
  const fixText = (fixes)=> (fixes||[]).map(f=> ctx.canFixScenes
    ? "Scene "+f.no+"’s card slugline is corrected to "+f.to+", as its screenplay says."
    : "Scene "+f.no+"’s card keeps its heading as it is, "+f.from+": an Art director can’t edit scenes. The merged place still reads correctly — scene "
      +f.no+", its shots and its room & time plates are read as "+q(plan.name)+". (The owner’s merge corrects the heading to "+f.to
      +"; after yours, the owner can change it on the scene card.)");
  fixText(plan.sceneFixes).forEach(t=>items.push(t));
  // the "Same place as…" path's second button: the same card stays, under the other name — say what else differs
  const alt = ctx.offerOtherName && ctx.altPlan && plan.altName && plan.altName.toLowerCase()!==plan.name.toLowerCase() ? ctx.altPlan : null;
  if(alt){
    const nos = (fixes)=> (fixes||[]).map(f=>f.no+"→"+f.to).join("|");
    const fixesDiffer = nos(alt.sceneFixes)!==nos(plan.sceneFixes);
    items.push("Or merge as "+q(alt.name)+": the same card stays, under that name"
      +(fixesDiffer ? ((alt.sceneFixes||[]).length && ctx.canFixScenes
        ? ", and "+list((alt.sceneFixes||[]).map(f=>"scene "+f.no+"’s card is corrected to "+f.to))
        : ", and the scene cards are left as they are") : "")+".");
  }
  if(ctx.show) items.push("This film is an episode of a Show and its locations are shared: the merge holds in every episode — a scene in another episode that names "
    +list(_locUniq([plan.keeperName, plan.goneName].filter(n=>n.toLowerCase()!==plan.name.toLowerCase()), true).map(q))
    +" is read as "+q(plan.name)+" (scene cards in other episodes, and their shots that picked "+q(plan.goneName)+"’s plate by hand, are not changed).");
  return { title:"Merge "+q(plan.keeperName)+" and "+q(plan.goneName)+" into one place?",
    body:"They become one location card. Nothing is generated and nothing is charged.",
    items, note:"Shots that picked "+q(plan.goneName)+"’s plate by hand, and props linked to it, now use the merged card.",
    confirmLabel:"Merge as "+q(plan.name), cancelLabel:"Cancel",
    ...(ctx.offerOtherName && plan.altName && plan.altName.toLowerCase()!==plan.name.toLowerCase() ? { altLabel:"Merge as "+q(plan.altName) } : {}) };
}
/* APPLY A MERGE — pure: {locations, keeper, gone (for Recently deleted)}. The kept card takes the name and key, lists the
   other names and keys, and every card's parent / continuity root that named either now names the merged one (this
   episode's and, on a Show, every episode's slice). opts.mergeSceneRefs(set, survivor): a Show's per-episode scenes. */
function locationMergeApply(locations, plan, opts){
  opts = opts || {};
  const list = (Array.isArray(locations)?locations:[]).filter(Boolean);
  const keeper = plan && list.find(l=>l.id===plan.keeperId), gone = plan && list.find(l=>l.id===plan.goneId);
  if(!keeper || !gone) return null;
  const at = opts.at || new Date().toISOString();
  const joined = new Set([plan.key, plan.oldKey, String(gone.key)].concat(plan.aliasKeys||[]).map(String));
  const remap = (k)=> joined.has(String(k||"")) ? plan.key : String(k||"");
  const relink = (l, selfKey)=>{
    const out = {};
    ["parentKey","continuityRootKey"].forEach(f=>{
      if(l[f]==null || l[f]==="") return;
      let v = remap(l[f]);
      if(f==="parentKey" && v===selfKey) v = "";
      if(v!==String(l[f])) out[f] = v;
    });
    const meta = l.episodeLocationMeta;
    if(meta && typeof meta==="object" && !Array.isArray(meta)){
      let touched = false; const map = {};
      Object.keys(meta).forEach(ep=>{
        const s = meta[ep];
        if(!s || typeof s!=="object"){ map[ep] = s; return; }
        const n = {...s};
        if(n.parentKey){ const v = remap(n.parentKey); n.parentKey = v===selfKey ? "" : v; }
        if(n.continuityRootKey) n.continuityRootKey = remap(n.continuityRootKey);
        if(n.parentKey!==s.parentKey || n.continuityRootKey!==s.continuityRootKey) touched = true;
        map[ep] = n;
      });
      if(touched) out.episodeLocationMeta = map;
    }
    ["notAliasOf","partOfKeys"].forEach(f=>{
      if(!Array.isArray(l[f])) return;
      const v = _locUniq(_locKeysOf(l[f]).map(remap)).filter(k=>k!==selfKey);
      if(JSON.stringify(v)!==JSON.stringify(l[f])) out[f] = v;
    });
    /* (2026-10-14, final pass) a room's "It opens onto …" answer (openingLeadsTo {openingId: a space's card id}) that
       named the merged-away card names the kept one — on the kept card itself the answer is dropped (it would point at
       itself) and Plate cameras asks again */
    const lead = l.openingLeadsTo;
    if(lead && typeof lead==="object" && !Array.isArray(lead) && Object.keys(lead).some(k=>String(lead[k])===String(gone.id))){
      const m = {};
      Object.keys(lead).forEach(k=>{
        if(String(lead[k])!==String(gone.id)) m[k] = lead[k];
        else if(l.id!==keeper.id) m[k] = keeper.id;
      });
      out.openingLeadsTo = Object.keys(m).length ? m : undefined;
    }
    return out;
  };
  const kept = { ...keeper, ...relink(keeper, plan.key), key:plan.key, name:plan.name,
    aliasKeys:(plan.aliasKeys||[]).slice(), aliases:(plan.aliases||[]).slice(),
    mergedFrom:(Array.isArray(keeper.mergedFrom)?keeper.mergedFrom:[]).concat([{id:gone.id, key:String(gone.key), name:gone.name||"", at}]) };
  ["notAliasOf","partOfKeys"].forEach(f=>{ if(Array.isArray(kept[f]) && !kept[f].length) delete kept[f]; });
  ["architecture","materials","lighting","permanentDressing","topology","continuityAnchors","significance","negativePrompt","lookbookBrief"]
    .forEach(f=>{ if(!String(kept[f]||"").trim() && String(gone[f]||"").trim()) kept[f] = gone[f]; });
  const staged = (l)=> typeof stagingHasContent==="function" ? stagingHasContent(l) : !!(l && l.staging);
  if(!staged(kept) && staged(gone)) kept.staging = gone.staging;
  // the other card's layout corrections belong to ITS layout: they come along only with that layout
  if(!_locHasLayout(kept) && _locHasLayout(gone)){
    kept.spatialPlan = gone.spatialPlan;
    const notes = _locUniq([keeper.spatialNotes, gone.spatialNotes]);
    if(notes.length) kept.spatialNotes = notes.join("\n");
  }
  if(typeof opts.mergeSceneRefs==="function") Object.assign(kept, opts.mergeSceneRefs([keeper, gone], kept) || {});
  else kept.scenes = _locUniq([].concat(keeper.scenes||[], gone.scenes||[]));
  const next = list.filter(l=>l.id!==gone.id).map(l=>{
    if(l.id===keeper.id) return kept;
    const patch = relink(l, String(l.key||""));
    return Object.keys(patch).length ? {...l, ...patch} : l;
  });
  return { locations:next, keeper:kept, gone:{ ...gone, _trashReason:"merge", mergedInto:keeper.id, mergedIntoName:plan.name } };
}
/* shots that picked the merged-away card's plate by hand use the kept card's */
function locationMergeShots(shots, goneId, keeperId){
  const hit = (arr)=> Array.isArray(arr) && arr.some(x=>String(x)===String(goneId));
  const swap = (arr)=> Array.from(new Set(arr.map(x=> String(x)===String(goneId) ? keeperId : x)));
  return (Array.isArray(shots)?shots:[]).map(sh=>{
    const legacy = !!sh && sh.locationId!=null && String(sh.locationId)===String(goneId);   // an older shot's own location
    if(!sh || (!hit(sh.referenceLocationIds) && !hit(sh.refOff) && !legacy)) return sh;
    const n = {...sh};
    if(hit(sh.referenceLocationIds)) n.referenceLocationIds = swap(sh.referenceLocationIds);
    if(hit(sh.refOff)) n.refOff = swap(sh.refOff);
    if(legacy) n.locationId = keeperId;
    return n;
  });
}
/* props linked to the merged-away card — a fixture's location, where it is placed, its association and its story
   events — are linked to the kept card (otherwise they'd point at a card in Recently deleted) */
function locationMergeProps(props, goneId, keeperId){
  const g = String(goneId||""), k = String(keeperId||"");
  if(!g || !k || g===k) return props;
  const is = (v)=> v!=null && String(v)===g;
  return (Array.isArray(props)?props:[]).map(p=>{
    if(!p || typeof p!=="object") return p;
    let n = null; const set = (f,v)=>{ if(!n) n = {...p}; n[f] = v; };
    if(is(p.locationId)) set("locationId", k);
    if(is(p.placementLocationId)) set("placementLocationId", k);
    if(p.associationType==="location" && is(p.associationId)) set("associationId", k);
    if(Array.isArray(p.continuityEvents) && p.continuityEvents.some(e=>e && (is(e.locationId) || is(e.placementLocationId))))
      set("continuityEvents", p.continuityEvents.map(e=> !e || !(is(e.locationId) || is(e.placementLocationId)) ? e
        : { ...e, ...(is(e.locationId) ? {locationId:k} : {}), ...(is(e.placementLocationId) ? {placementLocationId:k} : {}) }));
    return n || p;
  });
}
/* the scene cards a merge corrects — and their screenplay's card snapshot, so the correction never reads as
   "needs redraft" (the screenplay already says it) */
function locationMergeScenes(scenes, drafts, plan){
  const fixes = {};
  ((plan && plan.sceneFixes) || []).forEach(f=>{ fixes[f.sceneId] = f; });
  const nextScenes = (Array.isArray(scenes)?scenes:[]).map(sc=> sc && fixes[sc.id] && String(sc.loc)===fixes[sc.id].from ? {...sc, loc:fixes[sc.id].to} : sc);
  let nextDrafts = drafts;
  Object.keys(fixes).forEach(id=>{
    const d = drafts && drafts[id];
    if(!d || !d.cardSnap || String(d.cardSnap.loc||"")!==fixes[id].from) return;
    if(nextDrafts===drafts) nextDrafts = {...drafts};
    nextDrafts[id] = {...d, cardSnap:{...d.cardSnap, loc:fixes[id].to}};
  });
  return { scenes:nextScenes, drafts:nextDrafts };
}
/* "Part of" (kind "part": a is the part, b the place) and "Keep separate" (kind "separate") — the cards' new fields */
function locationPlaceDecisionApply(locations, aId, bId, kind){
  const list = (Array.isArray(locations)?locations:[]).filter(Boolean);
  const a = list.find(l=>l.id===aId), b = list.find(l=>l.id===bId);
  if(!a || !b || a.id===b.id || !a.key || !b.key || (kind!=="part" && kind!=="separate")) return null;
  const add = (arr,k)=> _locUniq(_locKeysOf(arr).concat([String(k)]));
  const drop = (arr,k)=> _locKeysOf(arr).filter(x=>x!==String(k));
  return list.map(l=>{
    if(l.id!==a.id && l.id!==b.id) return l;
    const other = l.id===a.id ? b : a, n = {...l};
    if(kind==="separate"){
      n.notAliasOf = add(l.notAliasOf, other.key);
      if(Array.isArray(l.partOfKeys)) n.partOfKeys = drop(l.partOfKeys, other.key);
    }else{
      if(l.id===a.id) n.partOfKeys = add(l.partOfKeys, b.key);
      if(Array.isArray(l.notAliasOf)) n.notAliasOf = drop(l.notAliasOf, other.key);
    }
    ["notAliasOf","partOfKeys"].forEach(f=>{ if(Array.isArray(n[f]) && !n[f].length) delete n[f]; });
    return n;
  });
}
/* restoring a merged-away card undoes the merge for its name: the kept card stops reading that key (and that card's
   name) as its own, and its merge record of it goes */
function locationUnmergeRestored(locations, item){
  if(!item || !item.mergedInto || !item.key) return locations;
  const nm = String(item.name||"").trim().toLowerCase();
  return (Array.isArray(locations)?locations:[]).map(l=>{
    if(!l || l.id!==item.mergedInto || _locKeysOf(l.aliasKeys).indexOf(String(item.key))<0) return l;
    const n = {...l}, ks = _locKeysOf(l.aliasKeys).filter(k=>k!==String(item.key));
    if(ks.length) n.aliasKeys = ks; else delete n.aliasKeys;
    if(Array.isArray(l.aliases) && nm){ const as = l.aliases.filter(a=>String(a||"").trim().toLowerCase()!==nm);
      if(as.length) n.aliases = as; else delete n.aliases; }
    if(Array.isArray(l.mergedFrom)){ const mf = l.mergedFrom.filter(m=>!(m && m.id===item.id));
      if(mf.length) n.mergedFrom = mf; else delete n.mergedFrom; }
    return n;
  });
}
window.locationDraftFirstHeading=locationDraftFirstHeading;
window.locationSamePlaceSuggestions=locationSamePlaceSuggestions;
/* SHARED-HEAD PARENTS for an existing film (2026-10-26): the heads its places would group under, read from the
   screenplay, free — [{ headKey, headName, children:[{id,name}] }]. A head that already has a card, a place already
   inside another, and a place kept apart from the head (notAliasOf) are left out; fewer than two places, no suggestion. */
function locationSharedHeadSuggestions(locations, scenes, drafts, opts){
  const dec = _locDecisions(opts);
  const list = (Array.isArray(locations)?locations:[]).filter(l=>l && l.key);
  const keys = new Set(list.map(l=>String(l.key)));
  const ordered = scenesInStoryOrder(scenes||[]);
  const c = collectSluggedPlaces(ordered, drafts, dec, true);
  const fold = foldSubspaceKeys(c.recOrder.map(k=>c.recByKey[k]), ordered, drafts, dec);
  const out = [];
  c.recOrder.forEach(hk=>{
    const R = c.recByKey[hk]; if(!R || !R.sharedHead || keys.has(hk)) return;
    const kids = list.filter(l=>!l.parentKey && String(l.key)!==hk && resolveFoldKey(fold, String(l.key))===hk);
    if(kids.length<2) return;
    out.push({ headKey:hk, headName:R.name, children:kids.map(l=>({ id:l.id, name:String(l.name||"") })) });
  });
  return out;
}
/* group: a new parent card (marked sharedHeadParent, so every derivation keeps the head) placed before its first room;
   the screenplay sync then nests the rooms (parentKey) and fills its scenes. It starts with the render style of its
   first room and, for review, the layout of the room that places the most anchors (as a draft owned by the parent —
   the rooms' own layouts stay saved but the parent's governs). separate: each room keeps apart from the head (notAliasOf),
   so the head never groups them and the suggestion stops. Returns the new list, or null when nothing applies. */
function locationSharedHeadApply(locations, headKey, headName, childIds, kind){
  const list = Array.isArray(locations) ? locations : [];
  const ids = Array.isArray(childIds) ? childIds : [];
  const kids = list.filter(l=>l && ids.indexOf(l.id)>=0);
  if(!headKey || kids.length<2) return null;
  if(kind==="separate") return list.map(l=> kids.indexOf(l)<0 ? l
    : { ...l, notAliasOf:Array.from(new Set(_locKeysOf(l.notAliasOf).concat([String(headKey)]))) });
  if(kind!=="group" || list.some(l=>l && String(l.key)===String(headKey))) return null;
  let id = "loc-"+headKey+"-g", n = 2; while(list.some(l=>l && l.id===id)) id = "loc-"+headKey+"-g"+(n++);
  const sides = Array.from(new Set(kids.map(l=>String(l.intExt||"").toUpperCase()).filter(Boolean)));
  const scenes = []; kids.forEach(l=>(l.scenes||[]).forEach(sid=>{ if(scenes.indexOf(sid)<0) scenes.push(sid); }));
  const placed = (p)=>p.anchors.filter(a=>a.xy).length;
  const best = kids.map(l=>({ l, plan:normalizeLocationSpatialPlan(l.spatialPlan) })).filter(x=>x.plan.anchors.length)
    .sort((a,b)=>placed(b.plan)-placed(a.plan) || b.plan.anchors.length-a.plan.anchors.length)[0];
  const styled = kids.find(l=>l.renderStyleKey||l.renderStyle) || {};
  const parent = { id, key:String(headKey), name:String(headName||headKey),
    intExt:sides.length>1 || sides.some(x=>/\//.test(x)) ? "INT/EXT" : (sides[0]||"INT"),
    times:[], areas:kids.map(l=>String(l.name||"")), scenes, scope:"compound", parentKey:"", continuityRootKey:String(headKey),
    sharedHeadParent:true, architecture:"", materials:"", lighting:"", permanentDressing:"", topology:"", continuityAnchors:"",
    anchorsLocked:true, significance:"", provenance:{}, renderStyle:styled.renderStyle||"",
    ...(styled.renderStyleKey ? { renderStyleKey:styled.renderStyleKey } : {}), negativePrompt:"", variants:[], fromScript:true,
    ...(best ? { spatialPlan:{ ...best.plan, status:"draft", source:{ assetId:id, iso:"" } } } : {}) };
  const at = list.indexOf(kids[0]);
  return list.slice(0, at).concat([parent], list.slice(at));
}
window.locationSharedHeadSuggestions=locationSharedHeadSuggestions;
window.locationSharedHeadApply=locationSharedHeadApply;
window.locationSamePlaceText=locationSamePlaceText;
window.locationCorrectedSlugline=locationCorrectedSlugline;
window.locationMergePlan=locationMergePlan;
window.locationMergeCarryIds=locationMergeCarryIds;
window.locationMergeConfirmText=locationMergeConfirmText;
window.locationMergeApply=locationMergeApply;
window.locationMergeShots=locationMergeShots;
window.locationMergeProps=locationMergeProps;
window.locationMergeScenes=locationMergeScenes;
window.locationPlaceDecisionApply=locationPlaceDecisionApply;
window.locationUnmergeRestored=locationUnmergeRestored;

/* LOCATION IDENTITY GRAPH ---------------------------------------------------
   Root invariants flow into a child workspace by reference. They are never copied
   into the child record, so changing the root cannot leave three stale duplicates.
   Resolution precedence for prompts is: root invariant -> child fact ->
   Slugline Unit / Time-of-Day Variant. */
function locationKeyOf(l){
  return String((l&&l.key)||((typeof locSlug==="function")?locSlug(l&&l.name).split("-").slice(0,4).join("-"):"")||"");
}
function locationParentOf(l,locations){
  if(!l) return null;
  const list=locations||((window.turnContinuity||{}).locations)||[];
  const key=String(l.parentKey||"");
  return (key&&list.find(x=>x&&x.id!==l.id&&locationKeyOf(x)===key))
    || (l.parentLocation&&l.parentLocation.id!==l.id&&
      (list.find(x=>x&&x.id===l.parentLocation.id)||l.parentLocation)) || null;
}
/* Shared style is resolved live, never copied into room records. An explicit
   room-style pick can opt out without deleting the room's saved style text. */
function locationRenderStyleSource(l,locations){
  let current=l||{};
  const seen=new Set();
  while(current&&!current.renderStyleIndependent&&!seen.has(current.id||current)){
    seen.add(current.id||current);
    const parent=locationParentOf(current,locations);
    if(!parent||seen.has(parent.id||parent)) break;
    current=parent;
  }
  return current;
}
function locationRenderEntity(l){
  const source=locationRenderStyleSource(l);
  return {...l,renderStyleKey:source.renderStyleKey,surpriseRender:source.surpriseRender};
}
/* A SUB-SPACE'S SINGLE-FRAME PLATES (room & time, environment state; 2026-10-14, owner — "go ahead with all of it"):
   the parent's part is single cut-out panels (locationSubspaceRootReferences, single) — never its whole 2x2 sheet with
   the old "Read ALL panels together … reproduce that exact room" note, which made a quay stretch copy its quay. The
   parent's plate must exist (a missing one stops the run before anything is sent). */
async function locationParentReferences(l){
  return (await locationSubspaceRootReferences(l,{single:true})).refs;
}
/* what a card shows for the parent's part before its panels are cut: the parent's plate missing → one "needed" slot */
function locationParentMissingReference(l){
  const parent=locationParentOf(l);
  return parent ? {url:"",kind:"location",ready:false,required:true,refId:parent.id,label:parent.name||"Parent location",
    note:(parent.name||"Parent location")+"'s plate — needed first: single panels are cut out of it"} : null;
}
async function locationStateReferences(l){
  let url=typeof nbGetImage==="function"?nbGetImage(l.id):"";
  if(!url&&typeof nbLoadImage==="function")url=await nbLoadImage(l.id);
  if(!url){const e=new Error("Generate or restore "+(l.name||"the location")+"'s plate before its environment states.");e.requiredReference=true;throw e;}
  return [{url,refId:l.id,kind:"location",required:true,ready:true,label:l.name,
    note:(l.name||"Location")+" master plate — preserve this exact room, geometry, materials, openings and fixed fixtures; change only the requested environment state."},
    ...await locationParentReferences(l)];
}
function locationReferenceInstructions(refs){
  return refs.length?" REFERENCE IMAGES (binding): "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+".":"";
}
function locationGenerationOrder(locations){
  const list=(locations||[]).filter(Boolean),out=[],seen=new Set();
  const visit=l=>{if(seen.has(l.id))return;seen.add(l.id);
    const parent=locationParentOf(l,list);
    if(parent&&list.some(x=>x.id===parent.id))visit(parent);
    out.push(l);
  };
  list.forEach(visit);return out;
}
window.locationRenderStyleSource=locationRenderStyleSource;
window.locationRenderEntity=locationRenderEntity;
window.locationParentMissingReference=locationParentMissingReference;
window.locationParentReferences=locationParentReferences;
window.locationStateReferences=locationStateReferences;
window.locationGenerationOrder=locationGenerationOrder;

/* A room-space contract, shared by the entire location family. The depth grid
   remains camera-relative; it must never silently become a second floor plan. */
function locationSpatialOwner(l,locations){
  const list=locations||((window.turnContinuity||{}).locations)||[];
  let current=l||{},seen=new Set();
  while(current&&!seen.has(current.id)){
    seen.add(current.id);
    const parent=locationParentOf(current,list);
    if(!parent||seen.has(parent.id))break;
    current=parent;
  }
  return current;
}
function normalizeLocationSpatialPlan(value){
  const p=value&&typeof value==="object"?value:{};
  const text=(v,n)=>typeof v==="string"?v.slice(0,n):"";
  const ids=new Set();
  const anchors=(Array.isArray(p.anchors)?p.anchors:[]).filter(a=>a&&typeof a==="object").slice(0,24).map((a,i)=>{
    let id=text(a.id,64).trim().replace(/[^a-zA-Z0-9_-]/g,"-")||"anchor-"+(i+1);
    while(ids.has(id))id+="-"+(i+1);
    ids.add(id);
    const out={id,space:text(a.space,80),name:text(a.name,80),placement:text(a.placement,320),
      evidence:text(a.evidence,160),basis:/^(observed|script|design)$/.test(a.basis)?a.basis:"design"};
    /* LOCATION COORDINATES (2026-10-13): an anchor's position / facing, written only when present, so a layout
       without them keeps its exact signature (see the coordinate model below) */
    const xy=_locVec(a.xy,2),z=_locNum(a.z,-500,500),facing=locYaw(a.facing);
    if(xy)out.xy=xy; if(z!=null)out.z=z; if(facing!=null)out.facing=facing;
    if(xy||z!=null||facing!=null)out.posBasis=_locBasis(a.posBasis,"design");
    return out;
  });
  const coordinates=normalizeLocationCoordinates(p.coordinates);
  return {schema:"cm-spatial-layout-v1",frame:text(p.frame,400),anchors,
    sightlines:text(p.sightlines,1000),unresolved:text(p.unresolved,1000),
    status:p.status==="reviewed"?"reviewed":"draft",
    source:{assetId:text(p.source&&p.source.assetId,160),iso:text(p.source&&p.source.iso,160)},
    ...(coordinates?{coordinates}:{})};
}
function locationSpatialSource(owner){
  const meta=typeof nbGetMeta==="function"?nbGetMeta(owner.id):null;
  return {assetId:owner.id,iso:String(meta&&meta.iso||"")};
}
/* known=false: neither the plate nor its details have loaded on this device yet (a cold cache after a
   reload, cloud before prefetch) — "unknown", never "the parent plate changed"; planSig: the reviewed
   layout the current plate was made from (2026-10-08). Kept apart from the source stamp, which is stored
   and compared as {assetId, iso}. */
function locationSpatialSourceInfo(owner){
  const meta=typeof nbGetMeta==="function"?nbGetMeta(owner.id):null;
  const img=typeof nbGetImage==="function"?nbGetImage(owner.id):"";
  return {known:!!(meta||img),planSig:String(meta&&meta.spatialPlanSig||"")};
}
/* WHICH LAYOUT A PLATE WAS MADE FROM (2026-10-08, owner — Locations review): the reviewed layout's content,
   without its source stamp. A plate generated from the reviewed layout records it (meta.spatialPlanSig), so
   making the parent plate no longer sends that same layout back for review — the rooms under it can follow
   in the same run. A plate made any other way (an edit, an upload, an older plate) still asks for review. */
function locationSpatialPlanSig(plan){
  const p={...normalizeLocationSpatialPlan(plan)}; delete p.source; delete p.reviewedAt; delete p.reviewedBy;
  const str=JSON.stringify(p); let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h+str.charCodeAt(i))|0;
  return "sp1:"+(h>>>0).toString(36)+":"+str.length;
}
/* the sig to record on a plate about to be made for l — only when l OWNS the layout and it is ready */
function locationSpatialPlanSigFor(l){
  try{ const st=requireLocationSpatialPlan(l); return st.owner.id===l.id ? locationSpatialPlanSig(st.plan) : ""; }catch(e){ return ""; }
}
function locationSpatialPlanState(l,locations){
  const owner=locationSpatialOwner(l,locations),plan=normalizeLocationSpatialPlan(owner.spatialPlan);
  const source=locationSpatialSource(owner);
  const tooLarge=locationSpatialPlanTooLarge(plan);
  const complete=!tooLarge&&!!plan.frame.trim()&&plan.anchors.length>0&&plan.anchors.every(a=>a.space.trim()&&a.name.trim()&&a.placement.trim());
  const info=locationSpatialSourceInfo(owner);
  const builtFromThis=!!(info.planSig && info.planSig===locationSpatialPlanSig(plan));
  const stale=plan.source.assetId!==source.assetId||(info.known && plan.source.iso!==source.iso && !builtFromThis);
  const ready=complete&&plan.status==="reviewed"&&!stale;
  return {owner,plan,source,complete,stale,ready,
    reason:tooLarge?"Shorten the shared set layout to 12,000 characters (and its floor plan to 9,000) so it reaches image generation and Blender intact."
      :!complete?"Prepare the shared set layout in Spatial Layout & Staging first."
      :plan.status!=="reviewed"?"Review the shared set layout before rendering."
      :stale?"The parent plate changed. Check it against the shared set layout and review the layout again.":""};
}
function requireLocationSpatialPlan(l){
  const owner=locationSpatialOwner(l);
  const live=(((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
  const state=locationSpatialPlanState(live);
  if(!state.ready){const e=new Error(state.reason+" ("+(state.owner.name||"Location")+")");e.requiredReference=true;throw e;}
  return state;
}
/* VIEW COMPOSITION FOLLOWS THE SHARED LAYOUT (2026-10-12, owner — "go ahead with all of it"). A composition is
   drafted from the layout, so "Draft view composition" waits while that layout is being drafted or a drafted one
   waits to be confirmed (registered here by every open layout editor, per owner, per editor instance), and while
   the layout isn't ready (the plate's own reason). Each drafted composition records the layout it was drafted
   from (staging.layoutSig); a later change to that layout is said on the composition — never a block. */
const _locLayoutDraftPending={};
function setLocationLayoutDraftPending(ownerId,token,on){
  const id=String(ownerId||""); if(!id||!token)return;
  const set=_locLayoutDraftPending[id]||(_locLayoutDraftPending[id]=new Set());
  const had=set.has(token);
  if(on)set.add(token);else set.delete(token);
  if(!set.size)delete _locLayoutDraftPending[id];
  if(had!==!!on){try{window.dispatchEvent(new CustomEvent("loc-layout-draft-pending",{detail:id}));}catch(e){}}
}
function locationLayoutDraftPending(ownerId){
  const set=_locLayoutDraftPending[String(ownerId||"")];
  return !!(set&&set.size);
}
const LOCATION_STAGING_LAYOUT_WAIT="Waiting for the shared layout — confirm it first.";
/* "" when "Draft view composition" may run for l; otherwise the reason it waits */
function locationStagingDraftBlock(l){
  if(!l)return "";
  const owner=locationSpatialOwner(l);
  if(locationLayoutDraftPending(owner.id))return LOCATION_STAGING_LAYOUT_WAIT;
  try{requireLocationSpatialPlan(l);return "";}catch(e){return String(e&&e.message||"Review the shared set layout before rendering.");}
}
/* the layout a composition drafted NOW is drafted from (the live owner's layout, as the prompt reads it) */
function locationStagingLayoutSig(l){
  try{
    const owner=locationSpatialOwner(l);
    const live=(((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
    return locationSpatialPlanSig(live.spatialPlan);
  }catch(e){return "";}
}
/* true when l's composition was drafted from a layout that has changed since (an unstamped one says nothing) */
function locationStagingLayoutChanged(l){
  const sig=String((l&&l.staging&&l.staging.layoutSig)||"");
  if(!sig||(typeof stagingHasContent==="function"&&!stagingHasContent(l)))return false;
  const now=locationStagingLayoutSig(l);
  return !!now&&now!==sig;
}
/* what a composition looked like, for "did someone edit it while the draft ran?" (content only) */
function locationStagingBasis(l){
  return JSON.stringify(typeof stagingOf==="function"?stagingOf(l||{}):((l&&l.staging)||{}));
}
function locationSpatialContract(l,locations){
  const owner=locationSpatialOwner(l,locations);
  const live=(locations||((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner;
  const state=locationSpatialPlanState(live,locations);
  return {schema:"cm-spatial-layout-v1",ownerId:state.owner.id,ownerName:state.owner.name,
    targetSpace:l.name,status:state.ready?"reviewed":state.stale&&state.plan.status==="reviewed"?"needs-review":"draft",
    frame:state.plan.frame,anchors:state.plan.anchors,sightlines:state.plan.sightlines,
    unresolved:state.plan.unresolved,source:state.plan.source,
    // the coordinate model (2026-10-13), only when the layout has numbers
    ...(state.plan.coordinates?{coordinates:{...state.plan.coordinates,convention:LOCATION_COORDINATE_CONVENTION}}:{}),
    corrections:String(state.owner.spatialNotes||"").slice(0,2000),
    rules:"One physical set, not one layout per image. Stable anchor IDs identify the SAME objects in every panel and subspace. Placements are relative to the named room frame, NOT screen-left/right. Move only cameras; never mirror rooms, swap walls, move furniture or change doorway/window adjacency to fit a view. Reconcile direct room views with every doorway glimpse of that room. Camera depth grids describe projections of this plan and cannot override it. Unknown or occluded geometry is not measured evidence; retain uncertainty and request dimensions before exact Blender construction."};
}
/* THE LAYOUT AS THE IMAGE MODEL READS IT (owner 2026-10-27: "some of the details we have in there might be only
   applicable when it comes to Blender"): each fixed object's name, its space and its placement in words, the
   sightlines and the corrections — never the metre coordinates, footprints, heights, yaw angles, the Blender axis
   convention, evidence notes, open questions or the layout's housekeeping, which an image model can't use and which
   pushed the place's own description out (~9,000 characters on Marmorica). Blender, the layout tools and the writing
   calls keep the full layout (locationSpatialContract). The frame is the layout's own words, less its axis labels and
   its "no plate exists" note (a layout drafted before the plate keeps saying it). */
function locationSpatialImageContract(l,locations){
  const full=locationSpatialContract(l,locations);
  const frame=String(full.frame||"")
    .replace(/\s*\((?:[+-]?[XYZ])\)/g,"")
    .split(/(?<=[.!?])\s+/)
    .filter(x=>!/\bno (?:reference )?(?:plate|image)\b|\bproposal for review\b|\bdesign proposal\b/i.test(x))
    .join(" ").trim();
  const objects=(Array.isArray(full.anchors)?full.anchors:[]).filter(a=>a&&(a.name||a.placement)).map(a=>({
    id:a.id, name:a.name, ...(a.space?{space:a.space}:{}), where:String(a.placement||"").trim()}));
  return {
    binding:full.status==="reviewed",
    ...(frame?{frame}:{}),
    anchors:objects,
    ...(full.sightlines?{sightlines:full.sightlines}:{}),
    ...(full.corrections?{corrections:full.corrections}:{}),
    rules:"One physical set seen by every camera: each object stays where its 'where' says, in every panel; only the camera moves. Never mirror the set, swap walls, move or duplicate an object to fit a view. Placements are on the set (port/starboard, fore/aft, which wall), not left/right on the screen.",
  };
}
// image prompts read the plain layout; opts.full (a writing call) the whole one, numbers and all (2026-10-27)
function locationSpatialPrompt(l, opts){
  return " SHARED SET LAYOUT (binding physical relationships, all panels): "+JSON.stringify(opts&&opts.full ? locationSpatialContract(l) : locationSpatialImageContract(l))+". ";
}
async function locationSpatialReferences(l){
  const state=requireLocationSpatialPlan(l);
  /* only a plate the layout was READ from (owner 2026-10-27: Marmorica's layout was drafted from text, yet its last
     plate went back in as "the source plate for the reviewed layout", and the next plate copied that plate's invented
     shelter) — a layout with no plate behind it sends none */
  if(!state.plan.source || !state.plan.source.iso)return [];
  /* (2026-10-14, owner — "go ahead with all of it") never the whole sheet to a sub-space: the layout reaches it as
     text (shared_set_layout); the parent goes in as single cut-out panels (locationSubspaceRootReferences) */
  if(state.owner && l && state.owner.id!==l.id)return [];
  let url=typeof nbGetImage==="function"?nbGetImage(state.owner.id):"";
  if(!url&&typeof nbLoadImage==="function"){
    try{url=await nbLoadImage(state.owner.id);}catch(e){e.requiredReference=true;throw e;}
  }
  const current=requireLocationSpatialPlan(l);
  if(!url||JSON.stringify(current.plan)!==JSON.stringify(state.plan)){
    const e=new Error("The reviewed layout reference is unavailable or changed while loading. Review the shared layout and try again.");
    e.requiredReference=true;throw e;
  }
  return [{url,kind:"location",refId:state.owner.id,required:true,ready:true,label:state.owner.name,
    note:(state.owner.name||"Parent set")+" — source plate for the reviewed shared set layout. Cross-read ALL panels and doorway glimpses. Keep the same anchor IDs, furniture placements and sightlines; move only the cameras. Layout corrections override drift in this older image."}];
}
function mergeLocationReferences(...groups){
  const out=[];
  groups.flat().filter(Boolean).forEach(ref=>{
    const prior=out.find(r=>r.refId===ref.refId);
    if(prior)prior.note=[prior.note,ref.note].filter(Boolean).join(" ");
    else out.push({...ref});
  });return out;
}
window.locationSpatialOwner=locationSpatialOwner;
window.locationSpatialImageContract=locationSpatialImageContract;
window.normalizeLocationSpatialPlan=normalizeLocationSpatialPlan;
window.locationSpatialSource=locationSpatialSource;
window.locationSpatialPlanState=locationSpatialPlanState;
window.locationSpatialPlanSig=locationSpatialPlanSig;
window.locationSpatialPlanSigFor=locationSpatialPlanSigFor;
window.requireLocationSpatialPlan=requireLocationSpatialPlan;
window.setLocationLayoutDraftPending=setLocationLayoutDraftPending;
window.locationLayoutDraftPending=locationLayoutDraftPending;
window.LOCATION_STAGING_LAYOUT_WAIT=LOCATION_STAGING_LAYOUT_WAIT;
window.locationStagingDraftBlock=locationStagingDraftBlock;
window.locationStagingLayoutSig=locationStagingLayoutSig;
window.locationStagingLayoutChanged=locationStagingLayoutChanged;
window.locationStagingBasis=locationStagingBasis;
window.locationSpatialContract=locationSpatialContract;
window.locationSpatialPrompt=locationSpatialPrompt;
window.locationSpatialReferences=locationSpatialReferences;
window.mergeLocationReferences=mergeLocationReferences;

/* LOCATION COORDINATES (owner-approved 2026-10-13, "go ahead with both, include the top-down map" — "the more
   realistic we get the easier it will be to turn these main spaces and subspaces into 3D using Blender").
   ONE coordinate model for a location family, Blender-ready:
   - metres; right-handed; +Z up; the origin is a named anchor of the owner space, at its floor (coordinates.origin);
   - +Y = the facing named in the shared layout's frame (the set's "north"); +X = east;
   - yaw: degrees clockwise from +Y seen from above (0 north/+Y, 90 east/+X, 180 south, 270 west);
     pitch: degrees above the horizontal (negative looks down); lens: millimetres on a 36 mm-wide sensor;
   - every group of numbers carries a basis: observed (read from a plate) · script (stated in the screenplay) ·
     design (proposed) · user (set by hand).
   Where it lives: spatialPlan.coordinates (spaces: footprint polygon, floorZ, ceilingH, openings), optional
   xy / z / facing / posBasis on each anchor, and a camera pose per plate panel (TL, TR, BL, BR) on the space's
   coverage views (view.panel + view.pose). Stored data is never migrated: the new fields are written only when
   present, so a layout without them keeps its exact signature, review state and prompts. */
const LOC_PANEL_KEYS = ["TL","TR","BL","BR"];
const LOC_PANEL_INFO = {
  TL:{key:"TL",grid:"TOP-LEFT",label:"Top-left",field:"top_left",crop:{x:0.5,y:0.5,w:49,h:49}},
  TR:{key:"TR",grid:"TOP-RIGHT",label:"Top-right",field:"top_right",crop:{x:50.5,y:0.5,w:49,h:49}},
  BL:{key:"BL",grid:"BOTTOM-LEFT",label:"Bottom-left",field:"bottom_left",crop:{x:0.5,y:50.5,w:49,h:49}},
  BR:{key:"BR",grid:"BOTTOM-RIGHT",label:"Bottom-right",field:"bottom_right",crop:{x:50.5,y:50.5,w:49,h:49}},
};
const LOC_NUMBER_BASES = ["observed","script","design","user"];
const LOC_SENSOR_MM = 36;
const LOCATION_COORDINATE_CONVENTION = {
  units:"metres", axes:"right-handed, +Z up",
  north:"+Y is the facing named in the shared layout's frame; +X is east",
  origin:"the owner space's origin anchor, at floor level",
  yaw:"degrees clockwise from +Y seen from above (0 north, 90 east, 180 south, 270 west)",
  pitch:"degrees above the horizontal (negative looks down)",
  lens:"millimetres on a 36 mm-wide sensor",
  basis:"observed = read from a plate, script = stated in the screenplay, design = proposed, user = set by hand",
  blender:"camera {position, target, focalLength, sensorWidth 36}; rotation_euler XYZ radians = [(90 + pitch), 0, -yaw] in degrees converted"
};
/* (2026-10-13) "glass" alone is a material, not an opening — in a glassworks "Glass crates", "glass rack" or "glass furnace"
   are objects; only an architectural glass surface ("glass wall / partition / door / front…") is an opening */
const LOC_OPENING_RE = /\b(windows?|doors?|doorway|glazing|glazed|arch|archway|opening|hatch|pass-through|porthole|skylight|(?:plate[- ]?)?glass[- ](?:walls?|doors?|partitions?|panels?|screens?|fronts?|frontage|facade|fa\u00e7ade|roof|ceiling|booth|pane|panes))\b/i;
/* (2026-10-14, owner — "go ahead with all of it") THE NAME IS THE OPENING: an object counts as a window / door / arch
   only when its NAME names the opening itself ("Office window", "Furnace side door (origin)", "Archway", "Canal-side
   street door and stone threshold"), never when it merely mentions one ("Graziella's bench, stool and glory hole (seen
   through window)", "Sacks of sand by the door", "Steps by the doorway", "Office partition wall with window"). Read:
   an aside in brackets is dropped, the name is cut at its first comma / dash and at its first relation word (by, near,
   through, with, of, to, at, on, in, under, behind, …), and an opening word (LOC_OPENING_RE — the "glass" rule above is
   unchanged) must END one of its "and"-joined parts; a trailing state ("left ajar", "boarded up") or a number / letter
   that only labels it ("Window 1", "Door B") may follow it. "Row / pair / bank of windows" is an opening; an
   appliance's or a cupboard's door ("Oven door", "Furnace mouth and door") is not. A floor plan's own openings
   (coordinates.spaces[].openings) always count, whatever their name. */
const LOC_OPENING_END_RE = new RegExp(LOC_OPENING_RE.source.replace(/\\b$/,"")+"$","i");
const LOC_GLAZED_END_RE = /\b(glaz(?:ed|ing)[- ](?:screens?|panels?|walls?|partitions?|fronts?|frontage|roof|ceiling|booth|doors?))$/i;
const LOC_OPENING_REL = new Set(("by near beside next behind beneath below under underneath above over through thru past across along against "
  +"around round at on in inside outside into onto from with without for of to toward towards facing overlooking opposite beyond "
  +"between among amid via off seen visible where which that holding holds showing leading looking like as is are used lit").split(" "));
const LOC_OPENING_STATE = new Set(("ajar open opened closed shut locked unlocked boarded bricked propped half wide left right up frame frames "
  +"pane panes surround slightly partly partially fully still always barred shuttered curtained broken cracked smashed sealed blocked "
  +"jammed stuck north south east west northeast northwest southeast southwest upper lower").split(" "));
const LOC_OPENING_GROUP = new Set("row rows bank banks pair pairs set sets line lines run series band strip rank tier wall".split(" "));
const LOC_APPLIANCE_DOOR = new Set("oven ovens fridge refrigerator freezer cupboard cabinet wardrobe locker safe stove microwave dishwasher cage kiln".split(" "));
/* a trailing label that only numbers the opening ("Window 1", "Door B", "Window #2", "Windows x2", "Door II") */
const LOC_OPENING_LABEL_RE = /^(?:#?\d+[a-z]?|[a-z]|x\d+|no\.?\d+|(?:i{1,3}|iv|vi{0,3}|ix|x))$/i;
function _locOpeningPart(words){
  const w = words.slice();
  while(w.length>1 && (LOC_OPENING_STATE.has(w[w.length-1].toLowerCase()) || LOC_OPENING_LABEL_RE.test(w[w.length-1]))) w.pop();
  const m = w.join(" ").match(LOC_OPENING_END_RE) || w.join(" ").match(LOC_GLAZED_END_RE);   // "Glazed screen"
  if(!m) return "";
  const term = m[1].toLowerCase(), before = (w.join(" ").slice(0, m.index).trim().split(/\s+/).pop()||"").toLowerCase();
  if(/^(doors?|hatch)$/.test(term) && LOC_APPLIANCE_DOOR.has(before.replace(/'s$/,""))) return "";
  return term;
}
/* the opening word an object's NAME ends on ("" = the object is not an opening) */
function locationOpeningTerm(name){
  const clause = String(name||"").replace(/\([^)]*\)|\[[^\]]*\]/g," ").split(/[,;:\u2014\u2013]|\s-\s/)[0];
  // each word without the punctuation around it ("Office window." / "\u201cDoor\u201d"); "&" and "/" stay joiners
  const words = clause.trim().split(/\s+/).map(x=>x.replace(/^[^\w#&\/]+|[^\w&\/]+$/g,"")).filter(Boolean);
  let cut = words.length;
  for(let i=1;i<words.length;i++) if(LOC_OPENING_REL.has(words[i].toLowerCase().replace(/[^a-z]/g,""))){ cut = i; break; }
  const head = words.slice(0,cut);
  const parts = []; let cur = [];
  head.forEach(x=>{ if(/^(and|or|&|\/)$/i.test(x)){ if(cur.length) parts.push(cur); cur = []; } else cur.push(x); });
  if(cur.length) parts.push(cur);
  for(let i=0;i<parts.length;i++){
    const t = _locOpeningPart(parts[i]);
    if(!t) continue;
    // "Furnace mouth and door": a bare door / hatch joined to an appliance (or its mouth) is that appliance's own door
    const bare = parts[i].filter(x=>!LOC_OPENING_STATE.has(x.toLowerCase()) && !LOC_OPENING_LABEL_RE.test(x)).length===1;
    if(i>0 && bare && /^(doors?|hatch)$/.test(t) && parts[i-1].some(x=>{ const k = x.toLowerCase().replace(/'s$/,"");
      return k==="mouth" || k==="furnace" || LOC_APPLIANCE_DOOR.has(k); })) continue;
    return t;
  }
  // "Row of windows", "Pair of glass doors": a group named by its openings
  if(cut<words.length && words[cut].toLowerCase()==="of" && head.length && LOC_OPENING_GROUP.has(head[head.length-1].toLowerCase())){
    const rest = words.slice(cut+1); let end = rest.length;
    for(let i=1;i<rest.length;i++) if(LOC_OPENING_REL.has(rest[i].toLowerCase().replace(/[^a-z]/g,""))){ end = i; break; }
    return _locOpeningPart(rest.slice(0,end));
  }
  return "";
}
const LOC_COMPASS = ["north","north-east","east","south-east","south","south-west","west","north-west"];

function _locNum(v, lo, hi){
  const n = (typeof v==="string" && v.trim()!=="") ? Number(v) : v;
  return (typeof n==="number" && Number.isFinite(n) && n>=lo && n<=hi) ? Math.round(n*1000)/1000 : null;
}
function _locVec(v, len){
  if(!Array.isArray(v) || v.length<len) return null;
  const out = v.slice(0,len).map(n=>_locNum(n,-10000,10000));
  return out.every(n=>n!=null) ? out : null;
}
function locYaw(v){
  const n = _locNum(v,-100000,100000);
  return n==null ? null : Math.round((((n%360)+360)%360)*10)/10%360;
}
/* signed smallest difference a − b, in (−180, 180] */
function locYawDiff(a, b){ let d = ((Number(a)-Number(b))%360+360)%360; if(d>180) d -= 360; return d; }
function locCompass(yaw){ return yaw==null ? "" : LOC_COMPASS[Math.round(Number(yaw)/45)%8]; }
function locLensHfov(mm){ const f = Number(mm)>0 ? Number(mm) : 24; return Math.round(2*Math.atan(LOC_SENSOR_MM/(2*f))*1800/Math.PI)/10; }
function _locBasis(v, dflt){ return LOC_NUMBER_BASES.indexOf(v)>=0 ? v : (dflt||"design"); }
function _locBearing(from, to){ return locYaw(Math.atan2(to[0]-from[0], to[1]-from[1])*180/Math.PI); }
function _locDir(yaw){ const r = Number(yaw)*Math.PI/180; return [Math.sin(r), Math.cos(r)]; }
function _locCentroid(poly){
  if(!poly || !poly.length) return null;
  const s = poly.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]);
  return [s[0]/poly.length, s[1]/poly.length];
}
function _locInside(pt, poly){
  if(!pt || !poly || poly.length<3) return false;
  let inside = false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a = poly[i], b = poly[j];
    if(((a[1]>pt[1])!==(b[1]>pt[1])) && (pt[0] < (b[0]-a[0])*(pt[1]-a[1])/((b[1]-a[1])||1e-9)+a[0])) inside = !inside;
  }
  return inside;
}
/* the outward facing (yaw) of a footprint edge — the normal pointing away from the space's centre */
function _locEdgeYaw(poly, edge){
  if(!poly || poly.length<3 || edge==null || edge<0 || edge>=poly.length) return null;
  const a = poly[edge], b = poly[(edge+1)%poly.length], c = _locCentroid(poly);
  const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
  let n = [b[1]-a[1], -(b[0]-a[0])];
  if(n[0]*(mid[0]-c[0]) + n[1]*(mid[1]-c[1]) < 0) n = [-n[0], -n[1]];
  return locYaw(Math.atan2(n[0], n[1])*180/Math.PI);
}
function _locNearestEdge(poly, pt){
  if(!poly || poly.length<3 || !pt) return null;
  let best = null, bestD = Infinity;
  for(let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    const dx = b[0]-a[0], dy = b[1]-a[1], len2 = dx*dx+dy*dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx+(pt[1]-a[1])*dy)/len2));
    const d = Math.hypot(pt[0]-(a[0]+t*dx), pt[1]-(a[1]+t*dy));
    if(d<bestD){ bestD = d; best = i; }
  }
  return best;
}
/* does the 2D segment a→b touch the polygon (either end inside, or crossing an edge)? */
function _locSegCrossesPoly(a, b, poly){
  if(!poly || poly.length<3 || !a || !b) return false;
  if(_locInside(a,poly) || _locInside(b,poly)) return true;
  const orient = (p,q,r)=>{ const v = (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]); return Math.abs(v)<1e-9 ? 0 : (v>0 ? 1 : -1); };
  for(let i=0;i<poly.length;i++){
    const c = poly[i], d = poly[(i+1)%poly.length];
    if(orient(a,b,c)!==orient(a,b,d) && orient(c,d,a)!==orient(c,d,b)) return true;
  }
  return false;
}
/* how far a ray from pt along yaw travels before it leaves the polygon (null when it never crosses an edge) */
function _locRayExit(poly, pt, yaw){
  if(!poly || poly.length<3 || !pt) return null;
  const d = _locDir(yaw); let best = null;
  for(let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    const ex = b[0]-a[0], ey = b[1]-a[1], den = d[0]*ey - d[1]*ex;
    if(Math.abs(den)<1e-9) continue;
    const t = ((a[0]-pt[0])*ey - (a[1]-pt[1])*ex)/den, u = ((a[0]-pt[0])*d[1] - (a[1]-pt[1])*d[0])/den;
    if(t>0.05 && u>=-1e-6 && u<=1+1e-6 && (best==null || t<best)) best = t;
  }
  return best;
}
/* a named wall in prose → its outward facing: a compass word first ("on the south wall"), else words relative to
   the layout's frame (far / back wall = north, left = west, right = east, near / front / behind the camera = south) */
function locWallYawFromText(text){
  const s = String(text||"").toLowerCase();
  const m = s.match(/\b(north|south)[\s-]?(east|west)\b|\b(north|south|east|west)(?:ern)?\b/);
  if(m){
    const word = m[1] ? (m[1]+"-"+m[2]) : m[3];
    const at = LOC_COMPASS.indexOf(word);
    if(at>=0) return {yaw:at*45, word};
  }
  if(/\b(far|back|rear|opposite|end)\s+wall\b/.test(s)) return {yaw:0, word:"far wall"};
  if(/\bleft(?:-hand)?\s+(wall|side)\b/.test(s)) return {yaw:270, word:"left wall"};
  if(/\bright(?:-hand)?\s+(wall|side)\b/.test(s)) return {yaw:90, word:"right wall"};
  if(/\b(near|front)\s+wall\b|\bbehind the camera\b/.test(s)) return {yaw:180, word:"near wall"};
  return null;
}
function locationAnchorIsOpening(a){ return !!locationOpeningTerm(a && a.name); }
function _locOpeningKind(name){
  // the kind of the opening the name ENDS on ("Arched window" is a window, "Door to the arch" a door)
  const t = locationOpeningTerm(name);
  if(t) return /^(arch|archway|opening)$/.test(t) ? "arch" : /\bdoor/.test(t) ? "door"
    : /glass|glazing|glazed|porthole/.test(t) ? "glass" : "window";
  const s = String(name||"").toLowerCase();
  if(/\barch|archway|opening\b/.test(s)) return "arch";
  if(/\bdoor/.test(s)) return "door";
  if(/\bglass|glazing|glazed|porthole/.test(s)) return "glass";
  return "window";
}

function normalizeLocationCameraPose(p){
  if(!p || typeof p!=="object") return null;
  const out = {position:_locVec(p.position,3), yaw:locYaw(p.yaw), pitch:_locNum(p.pitch,-90,90),
    lensMm:_locNum(p.lensMm,8,200), target:typeof p.target==="string" ? p.target.slice(0,64) : "",
    place:typeof p.place==="string" ? p.place.slice(0,160) : "", basis:_locBasis(p.basis,"user")};
  return out;
}
function normalizeLocationCoordinates(value){
  if(!value || typeof value!=="object") return null;
  const t = (v,n)=> typeof v==="string" ? v.slice(0,n) : "";
  const cleanId = (v,fb)=> t(v,64).trim().replace(/[^a-zA-Z0-9_-]/g,"-") || fb;
  const spaces = (Array.isArray(value.spaces) ? value.spaces : []).filter(s=>s && typeof s==="object").slice(0,16).map((s,i)=>{
    const footprint = (Array.isArray(s.footprint) ? s.footprint : []).map(p=>_locVec(p,2)).filter(Boolean).slice(0,32);
    const poly = footprint.length>=3 ? footprint : [];
    const ids = new Set();
    const openings = (Array.isArray(s.openings) ? s.openings : []).filter(o=>o && typeof o==="object").slice(0,16).map((o,j)=>{
      let id = cleanId(o.id,"opening-"+(j+1)); while(ids.has(id)) id += "-"+(j+1); ids.add(id);
      const centre = _locVec(o.centre,2);
      const edge = (Number.isInteger(o.edge) && o.edge>=0 && o.edge<poly.length) ? o.edge : (centre && poly.length ? _locNearestEdge(poly,centre) : null);
      const yaw = locYaw(o.yaw);
      return {id, name:t(o.name,80), kind:/^(window|door|glass|arch)$/.test(o.kind) ? o.kind : "window", edge, centre,
        width:_locNum(o.width,0.05,100), sillZ:_locNum(o.sillZ,-50,500), headZ:_locNum(o.headZ,-50,500),
        yaw:yaw!=null ? yaw : _locEdgeYaw(poly,edge), connectsTo:t(o.connectsTo,160), basis:_locBasis(o.basis,"design")};
    });
    /* openSky (2026-10-14): a space with no roof (a quay, a square, a yard) — written only when true, so a layout
       without it keeps its exact signature */
    return {id:t(s.id,160) || ("space-"+(i+1)), name:t(s.name,80), footprint:poly,
      floorZ:_locNum(s.floorZ,-500,500)==null ? 0 : _locNum(s.floorZ,-500,500),
      ceilingH:_locNum(s.ceilingH,0.5,200), openings, basis:_locBasis(s.basis,"design"), ...(s.openSky===true ? {openSky:true} : {})};
  });
  const origin = value.origin && typeof value.origin==="object"
    ? {anchorId:t(value.origin.anchorId,64), note:t(value.origin.note,200)} : {anchorId:"", note:""};
  /* the panel cameras the drafted floor plan proposes (step B, 2026-10-13): one per space and panel. A camera set by
     hand in Plate cameras (on the space's coverage view) still wins over it. */
  const seen = new Set();
  const cameras = (Array.isArray(value.cameras) ? value.cameras : []).filter(c=>c && typeof c==="object").slice(0,64).map(c=>{
    const spaceId = t(c.spaceId||c.space,160), panel = LOC_PANEL_KEYS.indexOf(c.panel)>=0 ? c.panel : "";
    if(!spaceId || !panel || seen.has(spaceId+":"+panel)) return null;
    seen.add(spaceId+":"+panel);
    const pose = normalizeLocationCameraPose({...c, basis:_locBasis(c.basis,"design")});
    return {spaceId, panel, position:pose.position, yaw:pose.yaw, pitch:pose.pitch, lensMm:pose.lensMm,
      target:pose.target, basis:pose.basis};
  }).filter(Boolean);
  if(!spaces.length && !cameras.length && !origin.anchorId && !origin.note) return null;
  return {schema:"cm-location-coords-v1", origin, spaces, ...(cameras.length ? {cameras} : {})};
}
/* a drafted floor plan names spaces and connections by NAME — turn them into this family's location ids */
function locationResolveDraftCoordinates(value, family){
  if(!value || typeof value!=="object") return value;
  const fam = Array.isArray(family) ? family : [];
  const idOf = (ref)=>{ const hit = _locResolveSpace(String(ref||""), fam); return hit ? hit.id : String(ref||""); };
  const nameOf = (ref)=>{ const hit = _locResolveSpace(String(ref||""), fam); return hit ? (hit.name||"") : ""; };
  return {...value,
    spaces:(Array.isArray(value.spaces) ? value.spaces : []).map(sp=>sp && typeof sp==="object" ? {...sp, id:idOf(sp.id||sp.name),
      name:nameOf(sp.id||sp.name) || String(sp.name||sp.id||""),
      openings:(Array.isArray(sp.openings) ? sp.openings : []).map(o=>o && typeof o==="object" ? {...o, connectsTo:o.connectsTo ? idOf(o.connectsTo) : ""} : o)} : sp),
    cameras:(Array.isArray(value.cameras) ? value.cameras : []).map(c=>c && typeof c==="object" ? {...c, spaceId:idOf(c.spaceId||c.space)} : c)};
}
/* how big a layout may be: its words reach every plate prompt and Blender intact (12,000 characters), its floor
   plan numbers have their own allowance (9,000) */
function locationSpatialPlanTooLarge(plan){
  const p = {...(plan||{})}; const coords = p.coordinates; delete p.coordinates;
  return JSON.stringify(p).length>12000 || (coords ? JSON.stringify(coords).length>9000 : false);
}

function _locList(locations){ return locations || ((window.turnContinuity||{}).locations) || []; }
function _locNameKey(s){ return String(s||"").toLowerCase().replace(/^the\s+/,"").replace(/[^a-z0-9]+/g," ").trim(); }
function _locOwnerPlan(l, locations){
  const list = _locList(locations), owner = locationSpatialOwner(l,list);
  const live = list.find(x=>x && x.id===owner.id) || owner;
  return {owner:live, plan:normalizeLocationSpatialPlan(live.spatialPlan)};
}
function _locFamily(l, locations){
  const list = _locList(locations), owner = locationSpatialOwner(l,list);
  const out = list.filter(x=>x && locationSpatialOwner(x,list).id===owner.id);
  if(!out.some(x=>x.id===owner.id)) out.unshift(owner);
  if(l && !out.some(x=>x.id===l.id)) out.push(l);
  return out;
}
/* the family member an anchor's `space` names — exact name first, then the longest room name it is part of
   ("Office" → "Furnace Office"); otherwise the owner space */
function locationAnchorSpaceOf(anchor, family){
  const owner = family[0];
  const k = _locNameKey(anchor && anchor.space);
  if(!k) return owner;
  const exact = family.find(x=>_locNameKey(x.name)===k) || family.find(x=>_locIsOtherName(x,k));
  if(exact) return exact;
  const part = family.filter(x=>x.id!==owner.id && k.length>=4 && _locNameKey(x.name).length>=4
    && (_locNameKey(x.name).indexOf(k)>=0 || k.indexOf(_locNameKey(x.name))>=0))
    .sort((a,b)=>_locNameKey(b.name).length-_locNameKey(a.name).length)[0];
  return part || owner;
}
function _locCoordSpace(coords, l){
  if(!coords || !l) return null;
  return coords.spaces.find(s=>s.id===l.id) || coords.spaces.find(s=>s.name && _locNameKey(s.name)===_locNameKey(l.name)) || null;
}
/* a merged card is still the space its layout names by one of its other names (2026-10-14, SAME PLACE, TWO NAMES:
   "Fiorin Furnace" merged under the screenplay's "Furnace", or the other way round — the layout says what it said) */
function _locIsOtherName(x, k){
  return !!(x && k && Array.isArray(x.aliases) && x.aliases.some(n=>_locNameKey(n)===k));
}
function _locMentions(text, family, exceptId){
  const s = " "+_locNameKey(text)+" ";
  return family.filter(x=>x.id!==exceptId && _locNameKey(x.name).length>=3)
    .sort((a,b)=>_locNameKey(b.name).length-_locNameKey(a.name).length)
    .find(x=>s.indexOf(" "+_locNameKey(x.name)+" ")>=0) || null;
}
function _locResolveSpace(ref, family){
  if(!ref) return null;
  return family.find(x=>x.id===ref) || family.find(x=>_locNameKey(x.name)===_locNameKey(ref))
    || family.find(x=>_locIsOtherName(x,_locNameKey(ref))) || null;
}
/* the anchors of the shared layout that sit in this space */
function locationSpaceAnchors(l, locations){
  const list = _locList(locations), family = _locFamily(l,list), plan = _locOwnerPlan(l,list).plan;
  return plan.anchors.filter(a=>locationAnchorSpaceOf(a,family).id===l.id);
}
/* (2026-10-14) where an opening leads when it is not a space of this family: another location card its words name
   ("Furnace interior (unlisted)" → the Furnace card). It is pointed to (leadsTo) — never painted with this family's parent */
function _locOtherCard(text, l, list, family){
  const own = new Set(family.map(x=>x && x.id));
  const others = list.filter(x=>x && x.id && !own.has(x.id) && String(x.name||"").trim());
  const hit = others.length && String(text||"").trim() ? (_locResolveSpace(text,others) || _locMentions(text,others,l && l.id)) : null;
  return hit ? {id:hit.id, name:hit.name||""} : null;
}
/* this space's openings — the coordinates' openings first, then the layout's objects whose NAME is a window / door /
   glass / arch (locationOpeningTerm; their facing: the anchor's own, else the wall its placement names).
   connectsTo = the space of this family beyond it, as its own words say ("Opens onto", or a space its name / placement
   names). NEVER THE PARENT BY DEFAULT (2026-10-14, owner — "go ahead with all of it"): an opening whose words name no
   space of the family leads nowhere this plate can show (connectsTo ""), so no view of the parent is ever put in it;
   one whose words name another location card points to that card (leadsTo {id, name}); for one whose words say
   nothing, the room's card may say where it leads (l.openingLeadsTo {openingId: spaceId | "elsewhere"} — Plate
   cameras' "It opens onto …"; an optional field, absent on every older card). destination: "space" (its own
   words) · "chosen" (set on the card) · "card" (another location) · "elsewhere" · "unknown" (nothing says). */
function locationSpaceOpenings(l, locations){
  if(!l) return [];
  const list = _locList(locations), family = _locFamily(l,list), plan = _locOwnerPlan(l,list).plan;
  // the card passed in says where its openings lead (Plate cameras renders with the just-saved card before the shared
  // continuity snapshot catches up); a caller holding a card without the field reads the live one
  const live = Object.prototype.hasOwnProperty.call(l,"openingLeadsTo") ? l : (list.find(x=>x && x.id===l.id) || l);
  const chosenMap = live.openingLeadsTo && typeof live.openingLeadsTo==="object" ? live.openingLeadsTo : {};
  const sp = _locCoordSpace(plan.coordinates,l), out = [];
  const settle = (id, beyond, elsewhere, wordsSaySomething)=>{
    if(beyond) return {connectsTo:beyond.id, leadsTo:null, destination:"space"};
    if(elsewhere) return {connectsTo:"", leadsTo:elsewhere, destination:"card"};
    if(wordsSaySomething) return {connectsTo:"", leadsTo:null, destination:"elsewhere"};
    const pick = Object.prototype.hasOwnProperty.call(chosenMap,id) ? String(chosenMap[id]||"") : "";
    const hit = pick && pick!=="elsewhere" ? _locResolveSpace(pick,family) : null;
    if(hit && hit.id!==l.id) return {connectsTo:hit.id, leadsTo:null, destination:"chosen"};
    return {connectsTo:"", leadsTo:null, destination:pick==="elsewhere" ? "elsewhere" : "unknown"};
  };
  if(sp) sp.openings.forEach(o=>{
    const beyond = _locResolveSpace(o.connectsTo,family);
    const elsewhere = beyond ? null : _locOtherCard(o.connectsTo,l,list,family);
    out.push({...o, name:o.name||o.id, yawFrom:o.yaw!=null ? "coordinates" : "", source:"coordinates",
      ...settle(o.id, beyond, elsewhere, !!String(o.connectsTo||"").trim())});
  });
  plan.anchors.forEach(a=>{
    if(!locationAnchorIsOpening(a) || out.some(o=>o.id===a.id)) return;
    if(locationAnchorSpaceOf(a,family).id!==l.id) return;
    const wall = a.facing!=null ? null : locWallYawFromText(a.placement+" "+a.name);
    const beyond = _locMentions([a.name,a.placement,a.evidence].join(" "),family,l.id);
    const elsewhere = beyond ? null : _locOtherCard([a.name,a.placement].join(" "),l,list,family);
    out.push({id:a.id, name:a.name, kind:_locOpeningKind(a.name), edge:null, centre:a.xy||null, width:null,
      sillZ:null, headZ:null, yaw:a.facing!=null ? a.facing : (wall ? wall.yaw : null),
      yawFrom:a.facing!=null ? "set" : (wall ? "text" : ""), ...settle(a.id, beyond, elsewhere, false),
      basis:a.posBasis || a.basis || "design", source:"anchor"});
  });
  return out;
}

/* ---- camera poses for the four panels of a space's 2x2 plate ---- */
function _locPose(fields){
  return {position:fields.position||null, yaw:fields.yaw==null ? null : locYaw(fields.yaw),
    pitch:fields.pitch==null ? 0 : fields.pitch, lensMm:fields.lensMm||24, target:fields.target||"", place:fields.place||"",
    basis:fields.basis||"design"};
}
function _locStationPose(a, geo){
  const yawOf = ()=>{
    if(a.facing!=null) return locYaw(a.facing+180);
    if(a.xy && geo.centre && Math.hypot(a.xy[0]-geo.centre[0],a.xy[1]-geo.centre[1])>0.2) return _locBearing(geo.centre,a.xy);
    const w = locWallYawFromText(a.placement); return w ? w.yaw : null;
  };
  const yaw = yawOf();
  let position = null;
  if(a.xy && yaw!=null){ const d = _locDir(yaw); position = [a.xy[0]-d[0]*1.8, a.xy[1]-d[1]*1.8, geo.floorZ+1.5]; }
  return _locPose({position, yaw, pitch:-12, lensMm:35, target:a.id, place:position ? "" : "in front of "+(a.name||a.id),
    basis:a.posBasis || "design"});
}
/* ---- OUTDOOR PARTS GET OUTDOOR CAMERAS (2026-10-14, owner — "go ahead with all of it") -----------------------------
   A space is OUTDOOR when its own card is an exterior (EXT, not INT/EXT) or its floor plan says it is open to the sky
   (openSky). An outdoor part of a larger place (Glass Hours: the 16 m furnace stretch "Fondamenta DEI Vetrai" of the
   quay "Fondamenta") is never "inside" anything: its four cameras STAND ON it at eye level, each framed differently
   from the views the parent's own plate asks for, and the rest of the parent around it must match the parent's plate
   (locationSubspaceViews). Outdoors no camera stands higher than about 6 m — the old "ceiling less 0.3 m" corner put
   one 11.7 m up under a nominal open-sky ceiling, the parent's own overview again. Indoor rooms keep their cameras. */
const LOC_EYE_Z = 1.6, LOC_OUTDOOR_MAX_Z = 6;
function locationIsOutdoor(l, locations, space){
  if(!l) return false;
  const side = String(l.intExt||"").toUpperCase();
  if(/EXT/.test(side) && !/INT/.test(side)) return true;
  const sp = space!==undefined ? space : _locCoordSpace(_locOwnerPlan(l,locations).plan.coordinates, l);
  return !!(sp && sp.openSky);
}
/* THE DRAFTED FLOOR PLAN KEEPS THE SAME LIMIT (2026-10-14 — the check's gap B2: the drafter was only told "about 6 m").
   A camera the draft PROPOSES (basis design or script) on an outdoor space — its card an exterior, or the draft marks
   it open to the sky — standing more than LOC_OUTDOOR_MAX_Z above that space's floor is lowered to it in the draft, and
   listed so the review can say so: {plan, lowered:[{spaceId, spaceName, panel, from, to}]}. A camera it READ from a
   plate (observed) is kept as read — it says where that plate's camera stood, and the rooms match its panels by it;
   it is lowered only where it is used for a next plate (locationPanelPoses). Run on a normalized plan whose spaces are
   already this family's ids (locationResolveDraftCoordinates). */
function locationLowerDraftOutdoorCameras(plan, family, locations){
  const coords = plan && plan.coordinates;
  if(!coords || !Array.isArray(coords.cameras) || !coords.cameras.length) return {plan, lowered:[]};
  const list = _locList(locations), fam = Array.isArray(family) ? family : [];
  const lowered = [];
  const cameras = coords.cameras.map(c=>{
    if(!c || !c.position || c.basis==="observed" || c.basis==="user") return c;
    const card = _locResolveSpace(c.spaceId, fam);
    const sp = (coords.spaces||[]).find(s=>s.id===c.spaceId) || (card ? _locCoordSpace(coords, card) : null) || null;
    const outdoor = card ? locationIsOutdoor(card, list, sp) : !!(sp && sp.openSky);
    const floorZ = sp ? sp.floorZ : 0;
    if(!outdoor || !(c.position[2]>floorZ+LOC_OUTDOOR_MAX_Z+0.05)) return c;
    lowered.push({spaceId:c.spaceId, spaceName:(card && card.name) || (sp && sp.name) || c.spaceId, panel:c.panel,
      from:Math.round((c.position[2]-floorZ)*10)/10, to:LOC_OUTDOOR_MAX_Z});
    return {...c, position:[c.position[0], c.position[1], floorZ+LOC_OUTDOOR_MAX_Z]};
  });
  return {plan:lowered.length ? {...plan, coordinates:{...coords, cameras}} : plan, lowered};
}
/* the review's words for what the draft lowered (Shared set layout, while the draft is untouched) */
function locationLoweredCamerasText(lowered){
  const xs = Array.isArray(lowered) ? lowered.filter(x=>x && LOC_PANEL_INFO[x.panel]) : [];
  if(!xs.length) return "";
  return "Lowered to "+xs[0].to+" m: "+xs.map(x=>(x.spaceName ? x.spaceName+" · " : "")+LOC_PANEL_INFO[x.panel].label.toLowerCase()+" camera (the draft put it "+x.from+" m up)").join(", ")
    +" — outdoor cameras stay at eye level or a low high-angle.";
}
/* the object a view's words name — the earliest whole name, its head (before a comma or bracket, two words or more) or
   its id ("Main glory-hole furnace (A-furnace)") in the text */
function _locAnchorNamed(text, anchors){
  const raw = String(text||""), s = " "+_locNameKey(raw)+" ";
  let best = null;
  const consider = (a, at, len)=>{ if(at>=0 && (!best || at<best.at || (at===best.at && len>best.len))) best = {a, at, len}; };
  (anchors||[]).forEach(a=>{
    if(!a) return;
    const head = _locNameKey(String(a.name||"").split(/[,(]/)[0]);
    [_locNameKey(a.name), head.split(" ").length>=2 ? head : ""].forEach(k=>{ if(k.length>=4) consider(a, s.indexOf(" "+k+" "), k.length); });
    if(a.id && String(a.id).length>=3){
      const m = raw.match(new RegExp("(^|[^A-Za-z0-9_-])"+String(a.id).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?![A-Za-z0-9_-])"));
      // an id cited in the words: placed where its name would be (the words before it are about it)
      if(m) consider(a, _locNameKey(raw.slice(0, m.index)).length, 999);
    }
  });
  return best ? best.a : null;
}
/* the way a view's words say it looks ("Stone quay edge running away west", "looking north-east") */
function _locLookYawFromText(text){
  const m = String(text||"").toLowerCase().match(/\b(?:running|stretching|receding|leading|continuing|looking|heading|disappearing)\s+(?:away\s+|off\s+|out\s+)?(?:to(?:wards?)?\s+(?:the\s+)?)?((?:north|south)[\s-]?(?:east|west)|north|south|east|west)\b/);
  if(!m) return null;
  const at = LOC_COMPASS.indexOf(m[1].replace(/\s/,"-"));
  return at>=0 ? at*45 : null;
}
/* THE OWNER'S CLOSE-UPS FOLLOW ITS STAGING (2026-10-14): the two close-ups an owner plate's prompt asks for are of its
   staging's main and second stations (buildLocationRefPrompt bottom_left / bottom_right) — so are its suggested BL / BR
   cameras: aimed at the layout object those words name, looking the way they say. Glass Hours' Fondamenta used to
   suggest its canal lamps and the vaporetto landing for "close-up of Glass-furnace façade" and "close-up of Stone quay
   edge running away west". { main, second } — "" when the staging says nothing (the anchor-based stations stay). */
function locationStagingStations(l){
  const st = stagingOf(l), clean = (x)=>String(x||"").replace(/\.$/,"").trim();
  return {main:clean(st.bg.center), second:clean(st.mid.left) || clean(st.mid.right) || clean(st.fg.left) || clean(st.fg.right)};
}
function _locStagedStationPose(text, anchor, geo){
  const look = _locLookYawFromText(text);
  if(anchor && anchor.xy && look!=null){
    const d = _locDir(look);
    return _locPose({position:[anchor.xy[0]-d[0]*1.8, anchor.xy[1]-d[1]*1.8, geo.floorZ+1.5], yaw:look, pitch:-8, lensMm:35,
      target:anchor.id, basis:anchor.posBasis || "design"});
  }
  if(anchor){ const p = _locStationPose(anchor, geo); return (look!=null && p.yaw==null) ? {...p, yaw:look} : p; }
  return _locPose({yaw:look, pitch:-12, lensMm:35, place:"in front of "+String(text).slice(0,80)});
}
/* does camera c repeat view p — the same way (within 30°), the same height band (within 2 m) and, with positions,
   from nearby (within 8 m)? A view whose spot is unknown but whose height is (p.z — a parent camera known by its facing
   alone, locationParentPlateViews) is compared by its facing and height band only. */
function _locRepeatsView(c, p){
  if(!c || !p || c.yaw==null || p.yaw==null || Math.abs(locYawDiff(c.yaw,p.yaw))>=30) return false;
  if(c.position && p.position){
    if(Math.abs(c.position[2]-p.position[2])>=2) return false;
    if(Math.hypot(c.position[0]-p.position[0], c.position[1]-p.position[1])>=8) return false;
  } else if(c.position && p.z!=null && Math.abs(c.position[2]-p.z)>=2) return false;
  return true;
}
/* HOW CLOSELY camera c repeats view p (2026-10-14 — the check's gap B4): 0 when it doesn't (_locRepeatsView), up to 1
   for the same way from the same spot at the same height; with a position unknown on either side, the facing alone
   (at most 0.75 — it may stand elsewhere) */
function _locRepeatCloseness(c, p){
  if(!_locRepeatsView(c,p)) return 0;
  const way = 1-Math.abs(locYawDiff(c.yaw,p.yaw))/30;
  if(!c.position || !p.position) return way*0.75;
  const height = 1-Math.abs(c.position[2]-p.position[2])/2;
  const spot = 1-Math.hypot(c.position[0]-p.position[0], c.position[1]-p.position[1])/8;
  return way*(height+spot)/2;
}
/* THE PARENT PLATE'S OWN VIEWS, AS FAR AS THEY ARE KNOWN (2026-10-14 — the check's gap B4: "each panel framed
   differently from the main sheet's own views" was checked against the views the parent's NEXT plate asks for, not the
   cameras its current plate really had). Per panel: the camera the CURRENT plate had when known — recorded with it
   (meta.platePanels), noted on its card for that version (l.plateCameras: set by hand or read from it) or read for the
   confirmed floor plan from that very plate (locationKnownPlatePanels) — real:true; else the view its plate asks for
   (a stored, floor-plan or suggested camera — locationRequestedViews), real:false. The words stay the requested view's
   (what that plate's prompt asked for) unless the record has its own; so does the object it aims at. A camera known
   by its facing alone (set by hand: "Top-right faces east") keeps only the HEIGHT its plate asked for (z — a
   "high-angle overview" facing east is still the raised one, not an eye-level camera on the quay); where on the place
   it stood is unknown, so any camera facing that way at that height repeats it (never "9 m from a guessed spot, so
   not a repeat"). */
function locationParentPlateViews(parent, locations){
  if(!parent) return [];
  const list = _locList(locations), asked = locationRequestedViews(parent, list);
  const meta = typeof nbGetMeta==="function" ? nbGetMeta(parent.id) : null;
  const known = meta ? locationKnownPlatePanels(parent, meta, list) : null;
  return asked.map(v=>{
    const p = known && known.panels[v.key];
    if(!p || p.yaw==null) return {...v, real:false};
    const position = Array.isArray(p.position) ? p.position : null;
    return {key:v.key, yaw:p.yaw, position, ...(position || !v.position ? {} : {z:v.position[2]}),
      target:p.target||v.target||"", purpose:String(p.purpose||v.purpose||"").replace(/\.$/,""), real:true};
  });
}
/* AN OWNER WHOSE PLATE PLANS INSIDE AND OUTSIDE VIEWS (locationMasterPanelPlan: the screenplay plays it from both
   sides) asks for that plan's four views, not the two staging close-ups — so its suggested cameras stay the anchor
   stations (as before 2026-10-14) and its requested views are that plan's words. Read cheaply from what is already
   derived (the card's Required Space Plates' sides and the film's slugline units): this runs on every camera read. */
function _locOwnerUsesMixedViews(l){
  if(!l) return false;
  const units = ((window.turnContinuity||{}).sluglineUnits)||[];
  const roles = (Array.isArray(l.coverageSheets) ? l.coverageSheets : []).map(s=>String((s&&s.role)||"").toUpperCase())
    .concat(units.filter(u=>u && String(u.locationKey||"")===String(l.key||"")).map(u=>String(u.intExt||"").toUpperCase()));
  return roles.indexOf("INT")>=0 && roles.indexOf("EXT")>=0;
}
/* the views a location's plate asks for, as cameras and words — its stated cameras, else its suggestions (which follow
   its staging); a sub-space reads its parent's to frame each panel differently */
function locationRequestedViews(l, locations){
  const list = _locList(locations);
  const st = locationParentOf(l,list) ? null : locationStagingStations(l);
  const C = window.turnContinuity || {};
  const mixed = st && _locOwnerUsesMixedViews(l) && typeof locationMasterPanelPlan==="function"
    ? locationMasterPanelPlan(l, C.scenes||[], C.drafts||{}) : null;
  const words = mixed ? {TL:mixed.top_left, TR:mixed.top_right, BL:mixed.bottom_left, BR:mixed.bottom_right}
    : st ? {TL:"wide establishing three-quarter view at eye level from a front corner", TR:"high-angle three-quarter overview",
    BL:"close-up of "+(st.main || "the space's primary, most story-relevant feature"),
    BR:"close-up of "+(st.second || "a signature material detail of the space")} : {};
  return locationPanelPoses(l,list).map(p=>({key:p.key, yaw:p.pose.yaw, position:p.pose.position, target:p.pose.target,
    purpose:String(words[p.key] || p.purpose || "").replace(/\.$/,"")}));
}
/* THE OUTDOOR PART'S FOUR CAMERAS: TL along it (from the end whose view repeats none of the parent's), TR a reverse
   angle from its door (or window) out across it, BL / BR three-quarter views of its own stations — the ones the
   parent's own views don't already show close up — each at eye level; a candidate that would repeat a parent view (or
   one already chosen) gives way to one that doesn't. The parent's views are its CURRENT plate's real cameras where
   known, else the ones its plate asks for (locationParentPlateViews). When every candidate for a panel repeats one, the
   one that repeats LEAST is taken (a real camera of the parent's plate counts double) — and the panel says so
   (locationPanelPoses repeatsParent: on Plate cameras, in its prompt line and in the plate's record). */
const _locOutdoorBusy = new Set();   // a parent chain that loops back never recurses
function _locOutdoorPanels(l, list, parent, geo, anchors, openings){
  const name = l.name || "this space", eye = geo.floorZ+LOC_EYE_Z, poly = geo.poly;
  let theirs = [];
  if(!_locOutdoorBusy.has(l.id)){
    _locOutdoorBusy.add(l.id);
    try{ theirs = locationParentPlateViews(parent, list); } finally { _locOutdoorBusy.delete(l.id); }
  }
  const theirWords = theirs.map(p=>p.purpose).join(" ; ");
  const targeted = new Set(theirs.map(p=>p.target).filter(Boolean));
  const inside = (xy)=> !poly || _locInside(xy,poly);
  const settle = (xy)=>{   // a position on this space: pulled toward its centre when it falls outside
    if(!xy || inside(xy) || !geo.centre) return xy;
    const mid = [(xy[0]+geo.centre[0])/2, (xy[1]+geo.centre[1])/2];
    return inside(mid) ? mid : null;
  };
  const cands = {along:[], reverse:[], station:[]};
  const door = openings.find(o=>/door/.test(o.kind) && o.yaw!=null) || openings.find(o=>/window|glass/.test(o.kind) && o.yaw!=null);
  if(poly){
    let edge = null;
    poly.forEach((a,i)=>{ const b = poly[(i+1)%poly.length], len = Math.hypot(b[0]-a[0], b[1]-a[1]); if(!edge || len>edge.len) edge = {a,b,len}; });
    const ax = _locBearing(edge.a, edge.b), u = _locDir(ax), v = [u[1], -u[0]];
    const proj = (p,d)=> p[0]*d[0]+p[1]*d[1];
    const ts = poly.map(p=>proj(p,u)), ss = poly.map(p=>proj(p,v));
    const tMin = Math.min(...ts), tMax = Math.max(...ts), sMin = Math.min(...ss), sMax = Math.max(...ss);
    // the built side (its windows and doors) and the open side across from it; the camera stands nearer the open side
    const built = openings.filter(o=>o.centre && /door|window|glass/.test(o.kind));
    const sBuilt = built.length ? built.reduce((n,o)=>n+proj(o.centre,v),0)/built.length : (sMin+sMax)/2;
    const sOpen = Math.abs(sBuilt-sMin)<Math.abs(sBuilt-sMax) ? sMax : sMin;
    const sCam = built.length ? sBuilt+(sOpen-sBuilt)*0.6 : (sMin+sMax)/2;
    const inset = Math.min(0.8, (tMax-tMin)/4);
    [[tMin+inset, ax], [tMax-inset, locYaw(ax+180)]].forEach(([t,yaw])=>{
      const xy = settle([u[0]*t+v[0]*sCam, u[1]*t+v[1]*sCam]);
      cands.along.push({yaw, position:xy ? [xy[0], xy[1], eye] : null, pitch:0, lensMm:24,
        purpose:"eye-level view along "+name+", looking "+locCompass(yaw), place:xy ? "" : "at one end of "+name});
    });
  } else if(door){
    // no footprint: along the wall the door is in
    [90,-90].forEach(off=>{ const yaw = locYaw(door.yaw+off);
      cands.along.push({yaw, position:null, pitch:0, lensMm:24, purpose:"eye-level view along "+name+", looking "+locCompass(yaw), place:"at one end of "+name}); });
  }
  if(door){
    const yaw = locYaw(door.yaw+180), d = _locDir(yaw);
    const xy = door.centre ? settle([door.centre[0]+d[0]*0.8, door.centre[1]+d[1]*0.8]) : null;
    cands.reverse.push({yaw, position:xy ? [xy[0], xy[1], eye] : null, pitch:0, lensMm:28,
      purpose:"eye-level reverse angle from "+(door.name||"the door")+", looking "+locCompass(yaw)+" across "+name,
      place:xy ? "" : "just outside "+(door.name||"the door")});
  }
  // its own stations — not one the parent's own views already aim at or name, not one beyond its footprint (seen
  // through a window), each from two three-quarter positions 3 m off its front
  anchors.filter(a=>!locationAnchorIsOpening(a) && !targeted.has(a.id) && !_locAnchorNamed(theirWords,[a])
    && (!poly || !a.xy || _locPolyDist(a.xy,poly)<=1)).forEach((a,order)=>{
    const tries = [];
    if(a.facing!=null) tries.push([a.facing,40],[a.facing,-40]);
    if(a.xy && geo.centre && Math.hypot(a.xy[0]-geo.centre[0], a.xy[1]-geo.centre[1])>0.2) tries.push([_locBearing(a.xy,geo.centre),30],[_locBearing(a.xy,geo.centre),-30]);
    let n = 0;
    tries.forEach(([front,off])=>{
      if(n>=2) return;
      const b = locYaw(front+off), d = _locDir(b);
      const xy = a.xy ? [a.xy[0]+d[0]*3, a.xy[1]+d[1]*3] : null;
      if(xy && !inside(xy)) return;
      n++;
      cands.station.push({order, anchor:a, yaw:xy ? _locBearing(xy,a.xy) : locYaw(b+180), position:xy ? [xy[0], xy[1], eye] : null,
        pitch:-8, lensMm:35, target:a.id, purpose:"three-quarter view of "+(a.name||a.id)+", at eye level",
        place:xy ? "" : "three metres from "+(a.name||a.id)});
    });
  });
  const chosen = [];
  // how much a candidate repeats what is already framed: each view by how close it comes, a real camera of the
  // parent's current plate double, a view its plate only asks for (or another panel of this plate) once
  const score = (c)=> theirs.reduce((n,p)=>n+_locRepeatCloseness(c,p)*(p.real ? 2 : 1),0)
    + chosen.reduce((n,p)=>n+_locRepeatCloseness(c,p),0);
  const least = (rows)=> rows.sort((x,y)=>x.s-y.s || x.i-y.i)[0] || null;
  const rank = (xs, from)=> xs.map((c,i)=>({c, i:i+from, s:score(c)}));
  // the panel's own kind when one of them repeats nothing, else the least-repeating of it and the fallback (which
  // must repeat clearly less — by a tenth — to take the panel from its own kind)
  const pick = (primary, fallback)=>{
    const own = least(rank(primary,0));
    if(own && own.s===0) return own.c;
    const any = least(rank(primary,0).concat(rank(fallback||[],1000).map(x=>({...x, s:x.s+0.1}))));
    return any ? any.c : null;
  };
  const take = (c)=>{ if(c) chosen.push(c); return c; };
  const tl = take(pick(cands.along));
  const tr = take(pick(cands.reverse, cands.along.filter(c=>c!==tl)));
  const bl = take(pick(cands.station));
  const br = take(pick(cands.station.filter(c=>!bl || c.anchor!==bl.anchor), cands.along.filter(c=>c!==tl && c!==tr)));
  const r2 = (n)=> Math.round(n*100)/100 + 0;   // centimetres (and never -0)
  const pose = (c)=> _locPose({position:c.position ? c.position.map(r2) : null, yaw:c.yaw==null ? null : Math.round(c.yaw*10)/10,
    pitch:c.pitch, lensMm:c.lensMm, target:c.target||"", place:c.place||"", basis:"design"});
  // (the camera line already says "standing on <space>" — the place adds only the height)
  const none = (purpose)=>({purpose, pose:_locPose({yaw:null, pitch:0, lensMm:28, place:"at eye level"})});
  return {
    TL: tl ? {purpose:tl.purpose, pose:pose(tl)} : none("eye-level view along "+name),
    TR: tr ? {purpose:tr.purpose, pose:pose(tr)} : none("eye-level reverse angle across "+name),
    BL: bl ? {purpose:bl.purpose, pose:pose(bl)} : none("eye-level view of the main feature of "+name),
    BR: br ? {purpose:br.purpose, pose:pose(br)} : none("eye-level close view of a signature material detail of "+name),
    parentViews:theirs};   // what each panel was kept apart from (locationPanelPoses repeatsParent)
}
/* THREE-QUARTER MAIN VIEWS (owner 2026-10-27: "Generate locations in a three-quarter view rather than straight-on —
   showing more of the room's layout prevents the video model from hallucinating different backgrounds when camera
   angles shift"). The main view (TL) looks diagonally across the space toward its farthest corner, 15-60 degrees off
   straight, so two walls meet, the floor's depth and the ways in all read. The straight-on rule is kept as "legacy"
   (opts.legacyMainView) only so a plate made with it isn't later called "Layout changed" (locationPlateLayoutChanged). */
const LOC_THREE_QUARTER_FRAME = " \u2014 a THREE-QUARTER view at eye level from a corner, looking diagonally across the space so two walls, the floor's depth and the ways in all read, never a flat straight-on front view";
function _locThreeQuarterYaw(poly, at, straight){
  const base = straight==null ? 0 : Number(straight);
  if(!poly || !at){ return locYaw(base+35); }
  let far = null;
  poly.forEach(v=>{ const d = Math.hypot(v[0]-at[0], v[1]-at[1]); if(!far || d>far.d) far = {v,d}; });
  let off = locYawDiff(_locBearing(at, far.v), base);
  if(Math.abs(off)<15) off = off<0 ? -35 : 35;
  else if(Math.abs(off)>60) off = off<0 ? -60 : 60;
  return locYaw(base+off);
}
function locationDefaultPanelPoses(l, locations, opts){
  const legacy = !!(opts && opts.legacyMainView);
  const list = _locList(locations), parent = locationParentOf(l,list);
  const plan = _locOwnerPlan(l,list).plan, sp = _locCoordSpace(plan.coordinates,l);
  const poly = sp && sp.footprint.length>=3 ? sp.footprint : null;
  const geo = {floorZ:sp ? sp.floorZ : 0, ceilingH:sp && sp.ceilingH ? sp.ceilingH : null, centre:_locCentroid(poly), poly};
  const anchors = locationSpaceAnchors(l,list), openings = locationSpaceOpenings(l,list);
  const stations = anchors.filter(a=>!locationAnchorIsOpening(a));   // "Sacks of sand by the door" is a station
  const door = openings.find(o=>/door|arch/.test(o.kind) && o.yaw!=null) || openings.find(o=>/door|arch/.test(o.kind));
  const win = openings.find(o=>/window|glass/.test(o.kind) && o.yaw!=null) || openings.find(o=>/window|glass/.test(o.kind));
  const name = l.name || "this space";
  const outdoor = locationIsOutdoor(l, list, sp);
  // an outdoor part of a larger place: cameras standing on it at eye level (above)
  if(parent && outdoor) return _locOutdoorPanels(l, list, parent, geo, anchors, openings);
  const out = {};
  const corner = (yaw)=>{
    // the footprint corner whose view across the room is closest to the wanted facing
    if(!poly || !geo.centre || yaw==null) return null;
    let best = null;
    poly.forEach(v=>{ const b = _locBearing(v,geo.centre), d = Math.abs(locYawDiff(b,yaw));
      if(!best || d<best.d) best = {v,b,d}; });
    const dist = Math.hypot(best.v[0]-geo.centre[0], best.v[1]-geo.centre[1]) || 1;
    // outdoors (an open-sky "ceiling") a high camera stands at most about 6 m up
    const k = Math.min(0.3, dist/2)/dist;
    const z = geo.floorZ+(outdoor ? Math.min(geo.ceilingH ? geo.ceilingH-0.3 : LOC_OUTDOOR_MAX_Z, LOC_OUTDOOR_MAX_Z) : (geo.ceilingH||2.7)-0.3);
    return {position:[best.v[0]+(geo.centre[0]-best.v[0])*k, best.v[1]+(geo.centre[1]-best.v[1])*k, z], yaw:best.b,
      pitch:-Math.round(Math.atan2(z-geo.floorZ-0.8, dist)*180/Math.PI)};
  };
  if(!parent){
    out.TL = legacy ? {purpose:"wide establishing view from the layout's standpoint, in the direction its frame faces",
      pose:_locPose({yaw:0, pitch:0, lensMm:24, place:"at the shared layout's standpoint",
        position:poly && geo.centre ? (()=>{ const e = _locRayExit(poly,geo.centre,180); return e ? [geo.centre[0], geo.centre[1]-Math.max(0,e-0.8), geo.floorZ+1.6] : null; })() : null})}
      : (()=>{
        // THREE-QUARTER (2026-10-27): from a front corner beside the standpoint, looking diagonally across the space
        const at = poly && geo.centre ? (()=>{ const e = _locRayExit(poly,geo.centre,215); if(!e) return null;
          const d = _locDir(215), k = Math.max(0,e-0.8); return [geo.centre[0]+d[0]*k, geo.centre[1]+d[1]*k, geo.floorZ+1.6]; })() : null;
        return {purpose:"wide establishing three-quarter view at eye level from a front corner, looking diagonally across the space",
          pose:_locPose({yaw:_locThreeQuarterYaw(poly, at, 0), pitch:0, lensMm:24, position:at,
            place:at ? "" : "in a front corner beside the shared layout's standpoint"})};
      })();
    const c = corner(45);
    out.TR = {purpose:outdoor ? "raised three-quarter overview from about 6 m up, looking across the space"
        : "high three-quarter overview from an elevated corner, looking across the space",
      pose:_locPose(c ? {...c, lensMm:18} : {yaw:45, pitch:-30, lensMm:18, place:outdoor ? "raised, about 6 m up, at the near-left corner" : "high in the near-left corner"})};
    // its close-ups follow its staging — the two its prompt asks for (locationStagingStations); an owner whose plate
    // plans inside and outside views asks for no staging close-up, so its stations stay as before (_locOwnerUsesMixedViews)
    const st = _locOwnerUsesMixedViews(l) ? {main:"", second:""} : locationStagingStations(l), used = new Set();
    [["BL",st.main],["BR",st.second]].forEach(([key,text])=>{
      if(!text) return;
      const a = _locAnchorNamed(text, plan.anchors.filter(x=>!used.has(x.id)));
      if(a) used.add(a.id);
      out[key] = {purpose:"close-up of "+text, pose:_locStagedStationPose(text, a, geo)};
    });
    if(out.BL && out.BR) return out;
    const rest = stations.filter(a=>!used.has(a.id)).map(a=>({purpose:"key station: "+(a.name||a.id), pose:_locStationPose(a,geo)}));
    if(!out.BL) out.BL = rest.shift() || {purpose:"close-up of the space's primary, most story-relevant feature", pose:_locPose({yaw:null, pitch:-12, lensMm:35})};
    if(!out.BR) out.BR = rest.shift() || {purpose:"close-up of a signature material detail of "+name, pose:_locPose({yaw:null, pitch:-12, lensMm:35})};
    return out;
  } else {
    let tl, inYaw = null;   // inYaw: straight into the room from its door — the high corner view (TR) turns from it
    if(door && door.yaw!=null){
      const yaw = locYaw(door.yaw+180); inYaw = yaw;
      const position = door.centre ? (()=>{ const d = _locDir(yaw); return [door.centre[0]+d[0]*0.6, door.centre[1]+d[1]*0.6, geo.floorZ+1.6]; })() : null;
      // THREE-QUARTER (2026-10-27): just inside the door, turned diagonally into the room (legacy: straight at the far wall)
      // of the two diagonals, the one turned further from the window's wall (a view through a window needs a plate of its own)
      const diag = legacy ? yaw : (()=>{ const d1 = _locThreeQuarterYaw(poly, position, yaw), d2 = locYaw(yaw-locYawDiff(d1,yaw));
        if(!win || win.yaw==null) return d1;
        return Math.abs(locYawDiff(d2, win.yaw))>Math.abs(locYawDiff(d1, win.yaw)) ? d2 : d1; })();
      tl = _locPose({yaw:diag, pitch:0, lensMm:24, position, target:"",
        place:position ? "" : "just inside "+(door.name||"the door")});
    } else tl = _locPose({yaw:null, pitch:0, lensMm:24, place:"at the entrance"});
    out.TL = {purpose:legacy ? "from the doorway, looking at the far wall of "+name
      : "from the doorway, a three-quarter view diagonally across "+name+" toward its far corner", pose:tl};
    let trYaw = null;
    if(inYaw!=null){
      const a = locYaw(inYaw+45), b = locYaw(inYaw-45);
      trYaw = (win && win.yaw!=null && Math.abs(locYawDiff(b,win.yaw))<Math.abs(locYawDiff(a,win.yaw))) ? b : a;
    } else if(win && win.yaw!=null) trYaw = win.yaw;
    const c = corner(trYaw);
    out.TR = {purpose:"high corner view across "+name+", showing how its walls, openings and stations fit together",
      pose:_locPose(c ? {...c, lensMm:16} : {yaw:trYaw, pitch:-35, lensMm:16, place:"high in a corner"})};
  }
  // the two key stations: the space's own fixed anchors, then the window wall and the door wall
  const fill = stations.slice(0,2).map(a=>({purpose:"key station: "+(a.name||a.id), pose:_locStationPose(a,geo)}));
  [[win,"the window wall and what it overlooks"],[door,"the doorway wall"]].forEach(([o,label])=>{
    if(fill.length>=2 || !o || o.yaw==null || !parent) return;
    fill.push({purpose:label, pose:_locPose({yaw:o.yaw, pitch:-5, lensMm:28, target:o.id,
      position:o.centre && geo.centre ? (()=>{ const d = _locDir(o.yaw); const back = Math.min(2.2, Math.hypot(o.centre[0]-geo.centre[0],o.centre[1]-geo.centre[1])+0.6);
        return [o.centre[0]-d[0]*back, o.centre[1]-d[1]*back, geo.floorZ+1.5]; })() : null,
      place:o.centre ? "" : "across from "+(o.name||"the opening")})});
  });
  while(fill.length<2) fill.push({purpose:fill.length ? "close-up of a signature material detail of "+name
    : "close-up of the space's primary, most story-relevant feature", pose:_locPose({yaw:null, pitch:-12, lensMm:35})});
  out.BL = fill[0]; out.BR = fill[1];
  return out;
}
function _locPlanCamera(coords, l, key){
  if(!coords || !Array.isArray(coords.cameras) || !l) return null;
  return coords.cameras.find(c=>c.panel===key && (c.spaceId===l.id || _locNameKey(c.spaceId)===_locNameKey(l.name))) || null;
}
/* the panel poses the user (or a confirmed draft) stored on this space's coverage views */
function locationStoredPanelViews(l){
  const out = {};
  (Array.isArray(l && l.coverageViews) ? l.coverageViews : []).forEach(v=>{
    if(v && LOC_PANEL_KEYS.indexOf(v.panel)>=0 && v.pose && typeof v.pose==="object" && !out[v.panel]) out[v.panel] = v;
  });
  return out;
}
/* the four panel cameras of l's plate: a stored pose wins field by field over the suggestion. stated = the pose is
   written into the plate prompt and recorded with the plate (a room always; an owner space only once a pose is
   stored — its plate prompt is otherwise unchanged).
   OUTDOORS NO CAMERA ABOVE ABOUT 6 M, WHEREVER IT COMES FROM (2026-10-14 — the check's gap B2: only the suggestions were
   capped). On an outdoor space (locationIsOutdoor) a camera higher than LOC_OUTDOOR_MAX_Z above the space's floor — a
   drafted or reviewed floor plan's camera, or one saved from a suggestion — is LOWERED to it where it is used (the
   plate prompt, the plate's record, the top-down map, Blender) and the panel says so (lowered {from, to, source});
   the floor plan and the card are not changed. A camera whose height was typed by hand (Plate cameras' Edit camera, or
   a floor-plan camera marked "Set by hand" — basis user) is used as typed and only warned about (heightWarning).
   An outdoor part's panel whose camera repeats one of its parent's views (locationParentPlateViews) says which
   (repeatsParent [{panel, real}]) — the planner's least-repeating pick, or a camera set by hand or by the floor plan. */
function locationPanelPoses(l, locations, opts){
  if(!l) return [];
  const list = _locList(locations), parent = locationParentOf(l,list);
  const defaults = locationDefaultPanelPoses(l,list,opts), stored = locationStoredPanelViews(l);
  const coords = _locOwnerPlan(l,list).plan.coordinates;
  const sp = _locCoordSpace(coords,l), outdoor = locationIsOutdoor(l,list,sp);
  const floorZ = sp ? sp.floorZ : 0, topZ = floorZ+LOC_OUTDOOR_MAX_Z;
  const theirs = Array.isArray(defaults.parentViews) ? defaults.parentViews : null;
  // → {lowered} or {heightWarning} (p's position lowered in place — p is always a fresh copy) or {}
  const capHeight = (p, from, source)=>{
    if(!outdoor || !p.position || !(p.position[2]>topZ+0.05)) return {};
    const height = Math.round((p.position[2]-floorZ)*10)/10;
    if(from && from.basis==="user") return {heightWarning:{height, max:LOC_OUTDOOR_MAX_Z, source}};
    p.position = [p.position[0], p.position[1], topZ];
    return {lowered:{from:height, to:LOC_OUTDOOR_MAX_Z, source}};
  };
  return LOC_PANEL_KEYS.map(key=>{
    const d = defaults[key], v = stored[key], s = v ? normalizeLocationCameraPose(v.pose) : null;
    const c = _locPlanCamera(coords,l,key);
    const pose = {...d.pose};
    const over = (x)=>{ Object.keys(x).forEach(k=>{ if(k!=="basis" && k!=="spaceId" && k!=="panel" && x[k]!=null && x[k]!=="") pose[k] = x[k]; }); pose.basis = x.basis; };
    if(c) over(c);                 // the reviewed floor plan's camera (step B)
    if(s) over(s);                 // a camera set by hand wins
    // the layout's camera, before any hand edit (what "Back to the layout" returns to)
    const basePose = c ? (()=>{ const b = {...d.pose}; Object.keys(c).forEach(k=>{ if(k!=="spaceId" && k!=="panel" && c[k]!=null && c[k]!=="") b[k] = c[k]; }); return b; })() : d.pose;
    // its height: where the position came from decides (a hand-typed one is respected)
    const from = s && s.position ? s : (c && c.position ? c : null);
    const height = capHeight(pose, from, from===s ? "saved" : from===c ? "layout" : "suggested");
    if(c) capHeight(basePose, c, "layout");
    const repeats = theirs && parent ? theirs.filter(t=>_locRepeatCloseness(pose,t)>0).map(t=>({panel:t.key, real:!!t.real})) : [];
    return {...LOC_PANEL_INFO[key], purpose:String((v && v.purpose) || d.purpose), suggestedPose:basePose, pose,
      hfov:locLensHfov(pose.lensMm), source:s ? "set" : (c ? "layout" : "suggested"), stated:!!parent || !!s || !!c,
      viewId:v ? String(v.id||"") : "", subspace:!!parent, ...height, ...(repeats.length ? {repeatsParent:repeats} : {})};
  });
}
/* what a plate records about the cameras its prompt stated (meta.platePanels) — null when it stated none */
function locationPlatePanelRecord(l, locations, opts){
  const panels = locationPanelPoses(l,locations,opts).filter(p=>p.stated);
  if(!panels.length) return null;
  const out = {schema:"cm-plate-panels-v1", spaceId:String(l.id||""), spaceName:String(l.name||""), layout:"2x2", panels:{}};
  panels.forEach(p=>{ out.panels[p.key] = {yaw:p.pose.yaw, pitch:p.pose.pitch, lensMm:p.pose.lensMm, hfov:p.hfov,
    position:p.pose.position, target:p.pose.target, place:p.pose.place, basis:p.pose.basis, source:p.source,
    purpose:String(p.purpose||"").slice(0,160)};
    // (2026-10-14) an outdoor part's panel that could not avoid repeating one of its parent's views says which
    if(p.repeatsParent) out.panels[p.key].repeatsParent = p.repeatsParent.map(r=>({...r}));
    // the rooms this panel's camera sees (step B — the reverse direction)
    const kids = locationPanelChildrenVisible(l,p,locations);
    if(kids.length) out.panels[p.key].childrenVisible = kids; });
  return out;
}
/* a plate's recorded panel cameras; an older plate (no record) → null = every panel's facing is unknown */
function locationPlatePanels(meta){
  const r = meta && meta.platePanels;
  if(!r || typeof r!=="object" || !r.panels || typeof r.panels!=="object") return null;
  const panels = {};
  LOC_PANEL_KEYS.forEach(k=>{ const p = r.panels[k]; if(!p || typeof p!=="object") return;
    const pose = normalizeLocationCameraPose(p);
    panels[k] = {...pose, pitch:pose.pitch==null ? 0 : pose.pitch, lensMm:pose.lensMm||24,
      hfov:_locNum(p.hfov,1,179) || locLensHfov(pose.lensMm||24), purpose:String(p.purpose||"")}; });
  return Object.keys(panels).length ? {spaceId:String(r.spaceId||""), panels} : null;
}

/* ---- THE REVERSE DIRECTION (step B): the rooms a panel's camera sees — a room's footprint (or its openings / anchors)
   inside the camera's horizontal field of view, from outside it. Needs positions; without them nothing is claimed. ---- */
function locationPanelChildrenVisible(l, panel, locations){
  const list = _locList(locations), pose = panel && panel.pose;
  if(!pose || !pose.position || pose.yaw==null) return [];
  const half = (panel.hfov || locLensHfov(pose.lensMm))/2, cam = pose.position;
  const plan = _locOwnerPlan(l,list).plan, family = _locFamily(l,list);
  const kids = family.filter(x=>x.id!==l.id && (locationParentOf(x,list)||{}).id===l.id);
  const inView = (pt)=>{ const d = Math.hypot(pt[0]-cam[0], pt[1]-cam[1]); return d>0.3 && Math.abs(locYawDiff(_locBearing(cam,pt),pose.yaw))<=half; };
  return kids.map(k=>{
    const sp = _locCoordSpace(plan.coordinates,k), poly = sp && sp.footprint.length>=3 ? sp.footprint : null;
    if(poly && _locInside(cam,poly)) return null;              // the camera stands inside that room
    const opens = locationSpaceOpenings(k,list).filter(o=>o.centre);
    const pts = poly ? poly.concat([_locCentroid(poly)]) : opens.map(o=>o.centre)
      .concat(plan.anchors.filter(a=>a.xy && locationAnchorSpaceOf(a,family).id===k.id).map(a=>a.xy));
    if(!pts.length || !pts.some(inView)) return null;
    const c = poly ? _locCentroid(poly) : [pts.reduce((a,p)=>a+p[0],0)/pts.length, pts.reduce((a,p)=>a+p[1],0)/pts.length];
    const rel = locYawDiff(_locBearing(cam,c),pose.yaw), dist = Math.hypot(c[0]-cam[0], c[1]-cam[1]);
    const floorZ = sp ? sp.floorZ : null, top = sp && floorZ!=null ? floorZ+(sp.ceilingH||2.5) : null;
    return {spaceId:k.id, name:k.name||"", frame:rel<-half/3 ? "left" : rel>half/3 ? "right" : "centre",
      depth:dist<3 ? "near" : dist>8 ? "far" : "middle", distance:Math.round(dist*10)/10,
      level:floorZ!=null && floorZ>cam[2]-0.3 ? "raised" : top!=null && top<cam[2] ? "below" : "",
      openings:opens.filter(o=>inView(o.centre) && o.yaw!=null).map(o=>{
        const d = Math.abs(locYawDiff(_locBearing(o.centre,cam),o.yaw));
        return {id:o.id, name:o.name||o.id, kind:o.kind, faces:d<50 ? "camera" : d>130 ? "away" : "side"}; })};
  }).filter(Boolean);
}
function locationChildrenVisibleText(kids){
  if(!kids || !kids.length) return "";
  return " In this view: "+kids.map(k=>{
    const where = (k.depth==="middle" ? "" : k.depth+" ")+(k.frame==="centre" ? "centre" : k.frame);
    const lvl = k.level==="raised" ? ", raised above the camera" : k.level==="below" ? ", below the camera" : "";
    const ops = (k.openings||[]).map(o=>"its "+_locKindWord(o.kind)+" \u201c"+o.name+"\u201d "
      +(o.faces==="camera" ? "faces the camera" : o.faces==="away" ? "faces away" : "is side-on")).join(", ");
    return k.name+" sits in the "+where+" of the frame, about "+_locM(k.distance)+" m away"+lvl+(ops ? "; "+ops : "");
  }).join("; ")+" \u2014 keep "+(kids.length>1 ? "them" : "it")+" exactly where the shared layout puts "+(kids.length>1 ? "them" : "it")+".";
}
/* ---- THE TOP-DOWN MAP (step B): everything the floor plan places, ready to draw — footprints, openings (a segment
   along their wall), anchors and each panel's camera frustum (position, facing, field of view). `plan` may be a draft
   under review: it is read as if it were the owner's saved layout.
   READABLE MAP (owner 2026-10-13, "is this intended?" — a canal-side plan squashed into a strip by one stray dot):
   every item carries its space; objects are numbered and openings tagged (W1 / D1 / A1) for the legend; the map fits
   the footprints and what stands within/near them (max(3 m, 25% of the footprint's size)); anything far outside
   every footprint is an OUTLIER — not fitted, drawn at the map's edge pointing its way, listed "check this position". ---- */
function _locSegDist(p, a, b){
  const dx = b[0]-a[0], dy = b[1]-a[1], len = dx*dx+dy*dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)) : 0;
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy));
}
/* how far a point lies outside a footprint (0 inside it) */
function _locPolyDist(pt, poly){
  if(_locInside(pt,poly)) return 0;
  let d = Infinity;
  for(let i=0;i<poly.length;i++) d = Math.min(d, _locSegDist(pt, poly[i], poly[(i+1)%poly.length]));
  return d;
}
function _locBoundsOf(pts){
  return pts.length ? {minX:Math.min(...pts.map(q=>q[0])), maxX:Math.max(...pts.map(q=>q[0])),
    minY:Math.min(...pts.map(q=>q[1])), maxY:Math.max(...pts.map(q=>q[1]))} : null;
}
/* the fitting margin around a footprint: max(3 m, 25% of its larger side) */
function locationFloorPlanMargin(poly){
  const b = _locBoundsOf(poly||[]);
  return b ? Math.max(3, 0.25*Math.max(b.maxX-b.minX, b.maxY-b.minY)) : 3;
}
const LOC_OPENING_TAG = {window:"W", glass:"W", door:"D", arch:"A"};
function locationFloorPlanScene(owner, plan, locations){
  const base = _locList(locations), live = base.find(x=>x && x.id===owner.id) || owner;
  const list = base.some(x=>x && x.id===owner.id)
    ? base.map(x=>x && x.id===owner.id ? {...x, spatialPlan:plan||x.spatialPlan} : x)
    : [{...live, spatialPlan:plan||live.spatialPlan}].concat(base);
  const own = list.find(x=>x.id===owner.id), family = _locFamily(own,list);
  const p = normalizeLocationSpatialPlan(plan || own.spatialPlan), coords = p.coordinates;
  const spaces = [], openings = [], cameras = [], noPosition = [], tagCount = {};
  family.forEach(sp=>{
    const c = _locCoordSpace(coords,sp);
    if(c && c.footprint.length>=3) spaces.push({id:sp.id, name:sp.name||"", footprint:c.footprint, floorZ:c.floorZ, owner:sp.id===own.id,
      centre:_locCentroid(c.footprint)});
    locationSpaceOpenings(sp,list).forEach(o=>{
      if(!o.centre) return;
      const w = (o.width||0.9)/2, t = o.yaw!=null ? [Math.cos(o.yaw*Math.PI/180), -Math.sin(o.yaw*Math.PI/180)] : [1,0];
      const letter = LOC_OPENING_TAG[o.kind] || "W"; tagCount[letter] = (tagCount[letter]||0)+1;
      openings.push({spaceId:sp.id, spaceName:sp.name||"", id:o.id, name:o.name||o.id, kind:o.kind, yaw:o.yaw, centre:o.centre,
        tag:letter+tagCount[letter], a:[o.centre[0]-t[0]*w, o.centre[1]-t[1]*w], b:[o.centre[0]+t[0]*w, o.centre[1]+t[1]*w]});
    });
    locationPanelPoses(sp,list).forEach(pp=>{
      const label = (sp.name||"")+" · "+pp.label.toLowerCase();
      if(!pp.pose.position || pp.pose.yaw==null){ noPosition.push({spaceId:sp.id, spaceName:sp.name||"", panel:pp.key, label}); return; }
      const pos = pp.pose.position, len = Math.max(1.5, Math.min(6, (pp.pose.lensMm||24)/8));
      const edge = (d)=>{ const v = _locDir(pp.pose.yaw+d); return [pos[0]+v[0]*len, pos[1]+v[1]*len]; };
      cameras.push({spaceId:sp.id, spaceName:sp.name||"", panel:pp.key, label, source:pp.source, position:pos,
        yaw:pp.pose.yaw, pitch:pp.pose.pitch||0, lensMm:pp.pose.lensMm||24, hfov:pp.hfov, frustum:[[pos[0],pos[1]], edge(-pp.hfov/2), edge(pp.hfov/2)],
        ...(pp.lowered ? {lowered:pp.lowered} : {}), ...(pp.heightWarning ? {heightWarning:pp.heightWarning} : {})});
    });
  });
  // every space of the family, in order (the owner first) — the map's "one space at a time" chips
  const spaceList = family.map(sp=>({id:sp.id, name:sp.name||"", owner:sp.id===own.id, footprint:spaces.some(s=>s.id===sp.id)}));
  spaces.forEach(s=>{ s.index = Math.max(0, spaceList.findIndex(x=>x.id===s.id)); });
  let num = 0;
  const anchors = p.anchors.filter(a=>a.xy).map(a=>{ const sp = locationAnchorSpaceOf(a,family) || own, opening = locationAnchorIsOpening(a);
    return {id:a.id, name:a.name||a.id, xy:a.xy, facing:a.facing==null ? null : a.facing, opening, num:opening ? 0 : ++num,
      spaceId:sp.id, spaceName:sp.name||"", placement:a.placement||""}; });
  // outliers: far outside every footprint (nothing to test against without a footprint)
  const near = (pt)=>!spaces.length || spaces.some(s=>_locPolyDist(pt,s.footprint)<=locationFloorPlanMargin(s.footprint));
  const outliers = [];
  anchors.forEach(a=>{ a.outlier = !a.opening && !near(a.xy);
    if(a.outlier) outliers.push({kind:"object", key:"#a:"+a.id, id:a.id, name:a.name, spaceId:a.spaceId, xy:a.xy}); });
  openings.forEach(o=>{ o.outlier = !near(o.centre);
    if(o.outlier) outliers.push({kind:"opening", key:"#o:"+o.spaceId+":"+o.id, id:o.id, name:o.name, spaceId:o.spaceId, xy:o.centre}); });
  cameras.forEach(c=>{ c.outlier = !near(c.position);
    if(c.outlier) outliers.push({kind:"camera", key:c.spaceId+":"+c.panel, id:c.panel, name:c.label, spaceId:c.spaceId, xy:[c.position[0],c.position[1]]}); });
  const pts = [].concat(...spaces.map(x=>x.footprint), ...openings.map(o=>[o.a,o.b]), anchors.map(a=>a.xy), ...cameras.map(c=>c.frustum));
  const bounds = _locBoundsOf(pts);
  const scene = {frame:p.frame, origin:coords ? coords.origin : {anchorId:"", note:""}, spaces, spaceList, openings, anchors, cameras,
    noPosition, outliers, bounds, empty:!pts.length};
  scene.fit = locationFloorPlanFit(scene, "");
  return scene;
}
/* what the map fits for one space ("" = every space): its footprint, its cameras and what stands in / near it —
   never an outlier. A space with nothing positioned falls back to the whole plan. */
function locationFloorPlanFit(scene, spaceId){
  if(!scene || scene.empty) return null;
  const collect = (only)=>[].concat(
    ...scene.spaces.filter(s=>!only || s.id===only).map(s=>s.footprint),
    ...scene.openings.filter(o=>!o.outlier && (!only || o.spaceId===only)).map(o=>[o.a,o.b]),
    scene.anchors.filter(a=>!a.outlier && (!only || a.spaceId===only)).map(a=>a.xy),
    scene.cameras.filter(c=>!c.outlier && (!only || c.spaceId===only)).map(c=>[c.position[0],c.position[1]]));
  let pts = spaceId ? collect(spaceId) : [];
  if(!pts.length) pts = collect("");
  if(!pts.length) pts = scene.outliers.map(o=>o.xy);   // only outliers (cannot happen with a footprint) — fit them
  return _locBoundsOf(pts);
}

/* ---- LAYOUT CHANGED (step B): what a plate was made from — the shared layout's content (words and numbers, not its
   review state) and, for a 2x2 plate, the cameras its prompt stated. Recorded as meta.plateLayoutSig; a later change
   says "Layout changed — regenerate" on the plate. Nothing regenerates or spends on its own. ---- */
function locationPlateLayoutSig(l, opts){
  if(!l) return "";
  let body;
  try{
    const plan = {..._locOwnerPlan(l).plan}; delete plan.status; delete plan.source;
    body = {plan};
    if(opts && opts.panels){
      // opts.record: the cameras to sign instead of the current ones (a plate's own saved record — below)
      const r = opts.record!==undefined ? opts.record : locationPlatePanelRecord(l);
      body.panels = r && r.panels ? LOC_PANEL_KEYS.map(k=>{ const p = r.panels[k]; return p ? [k,p.yaw,p.pitch,p.lensMm,p.position,p.target] : null; }) : null;
    }
  }catch(e){ return ""; }
  const str = JSON.stringify(body); let h = 5381;
  for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return "pl1:"+(h>>>0).toString(36)+":"+str.length;
}
/* (2026-10-14, owner — "go ahead with all of it") ONLY CAMERAS THAT ACTUALLY CHANGED: a 2x2 plate that recorded its
   cameras (meta.platePanels) is judged on the layout by its sig signed with ITS OWN recorded cameras, and on the cameras
   by comparing that record number by number with the current ones (within 5 cm and half a degree) — a change in how a
   camera is worked out that leaves this plate's cameras where they were never says "Layout changed". A plate without a
   record is judged by its sig as before. */
function _locSameCameras(a, b){
  const keys = (r)=> LOC_PANEL_KEYS.filter(k=>r && r.panels && r.panels[k]);
  if(keys(a).join()!==keys(b).join()) return false;
  const near = (x,y,eps)=> (x==null && y==null) || (x!=null && y!=null && Math.abs(Number(x)-Number(y))<=eps);
  return keys(a).every(k=>{ const p = a.panels[k], q = b.panels[k];
    const yaw = (p.yaw==null && q.yaw==null) || (p.yaw!=null && q.yaw!=null && Math.abs(locYawDiff(p.yaw,q.yaw))<=0.5);
    const pos = (!p.position && !q.position) || (Array.isArray(p.position) && Array.isArray(q.position)
      && p.position.length===q.position.length && p.position.every((v,i)=>near(v,q.position[i],0.05)));
    return yaw && pos && near(p.pitch||0,q.pitch||0,0.5) && near(p.lensMm||24,q.lensMm||24,0.5) && String(p.target||"")===String(q.target||""); });
}
function locationPlateLayoutChanged(meta, l, opts){
  if(!meta || !meta.plateLayoutSig || !l) return false;
  if(opts && opts.panels && meta.platePanels && typeof meta.platePanels==="object" && meta.platePanels.panels){
    const withOwn = locationPlateLayoutSig(l, {panels:true, record:meta.platePanels});
    if(!withOwn) return false;
    if(withOwn!==meta.plateLayoutSig) return true;                       // the layout itself changed
    let now = null; try{ now = locationPlatePanelRecord(l); }catch(e){ return false; }
    if(_locSameCameras(meta.platePanels, now)) return false;
    // a plate made before the three-quarter main view (2026-10-27) still matches the straight-on one it asked for
    let legacyNow = null; try{ legacyNow = locationPlatePanelRecord(l, undefined, {legacyMainView:true}); }catch(e){}
    return !(legacyNow && _locSameCameras(meta.platePanels, legacyNow));   // …or the cameras really moved
  }
  const now = locationPlateLayoutSig(l, opts);
  return !!now && now!==meta.plateLayoutSig;
}

/* ---- what each panel sees through an opening (plain geometry, no model call) ---- */
function locationPanelSightlines(l, panel, locations){
  const list = _locList(locations), pose = panel && panel.pose;
  if(!pose) return [];
  const half = (panel.hfov || locLensHfov(pose.lensMm))/2;
  return locationSpaceOpenings(l,list).filter(o=>o.connectsTo).map(o=>{
    if(pose.position && o.centre){
      if(pose.yaw==null) return null;
      const dist = Math.hypot(o.centre[0]-pose.position[0], o.centre[1]-pose.position[1]);
      if(dist<0.05) return null;
      const yaw = _locBearing(pose.position,o.centre);
      if(Math.abs(locYawDiff(yaw,pose.yaw))>half) return null;                       // outside the frame
      if(o.yaw!=null && Math.cos(locYawDiff(yaw,o.yaw)*Math.PI/180)<0.15) return null; // seen from outside / edge-on
      const midZ = (o.sillZ!=null && o.headZ!=null) ? (o.sillZ+o.headZ)/2 : pose.position[2];
      const pitch = Math.round(Math.atan2(midZ-pose.position[2], dist)*1800/Math.PI)/10;
      return {opening:o, yaw, pitch, through:o.centre, from:"positions"};
    }
    if(pose.yaw==null || o.yaw==null) return null;
    const d = locYawDiff(pose.yaw,o.yaw);
    if(Math.abs(d)>half+20) return null;                                               // the wall is out of view
    return {opening:o, yaw:locYaw(o.yaw+Math.max(-45,Math.min(45,d))), pitch:pose.pitch||0, through:null, from:"facings"};
  }).filter(Boolean);
}
/* what the plan knows lies beyond an opening, in the direction of the line of sight */
function locationAnchorsBeyond(target, sight, locations){
  const list = _locList(locations), family = _locFamily(target,list), plan = _locOwnerPlan(target,list).plan;
  const own = plan.anchors.filter(a=>locationAnchorSpaceOf(a,family).id===target.id && a.id!==sight.opening.id);
  const word = locCompass(sight.yaw);
  const hits = own.map(a=>{
    if(a.xy && sight.through){
      const b = _locBearing(sight.through,a.xy), dist = Math.hypot(a.xy[0]-sight.through[0], a.xy[1]-sight.through[1]);
      return Math.abs(locYawDiff(b,sight.yaw))<=40 && dist>0.2 ? {a,dist} : null;
    }
    const w = locWallYawFromText(a.placement);
    return (w && Math.abs(locYawDiff(w.yaw,sight.yaw))<=45) || (word && new RegExp("\\b"+word+"\\b","i").test(a.placement)) ? {a,dist:99} : null;
  }).filter(Boolean).sort((x,y)=>x.dist-y.dist).slice(0,4);
  return hits.map(h=>({id:h.a.id, name:h.a.name, placement:h.a.placement}));
}
function locationParentViewAssetId(l, openingId){ return String((l&&l.id)||"location")+"-pview-"+(locSlug(openingId)||"opening"); }
/* the views of the space beyond that a panel could be matched to: the quadrants its plate recorded, plus any view
   made from this room's position ("Make a … view"), when made from the plate as it is now */
/* the cameras behind the panels of target's CURRENT plate (meta), as far as they are known — null when unknown */
function locationKnownPlatePanels(target, meta, locations){
  let rec = locationPlatePanels(meta);
  /* (2026-10-14) a plate made before cameras were recorded, whose cameras were then noted on its card for that very
     version (Plate cameras: set by hand, or "Read the cameras from this plate") */
  if(!rec && meta && meta.iso) rec = locationNotedPlatePanels(_locList(locations).find(x=>x && x.id===target.id) || target, meta);
  /* a plate made before cameras were recorded, but READ for the reviewed floor plan (step B): the cameras the
     confirmed layout says stood behind each of ITS panels (basis observed, reviewed against this exact plate) */
  if(!rec && meta && meta.iso){
    const plan = _locOwnerPlan(target,locations).plan;
    if(plan.status==="reviewed" && plan.source.assetId===target.id && plan.source.iso===meta.iso && plan.coordinates){
      const panels = {};
      (plan.coordinates.cameras||[]).filter(c=>c.basis==="observed" && (c.spaceId===target.id || _locNameKey(c.spaceId)===_locNameKey(target.name)))
        .forEach(c=>{ panels[c.panel] = {...c, pitch:c.pitch||0, lensMm:c.lensMm||24, hfov:locLensHfov(c.lensMm||24)}; });
      if(Object.keys(panels).length) rec = {spaceId:target.id, panels, fromLayout:true};
    }
  }
  return rec || null;
}
function locationViewCandidates(target, l, metaOf, locations){
  const get = typeof metaOf==="function" ? metaOf : (id)=>(typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  const meta = get(target.id), out = [];
  const rec = locationKnownPlatePanels(target, meta, locations);
  if(rec) LOC_PANEL_KEYS.forEach(k=>{ const p = rec.panels[k];
    if(p && p.yaw!=null) out.push({id:"pq-"+target.id+"-"+k.toLowerCase(), kind:"quadrant", key:k, assetId:target.id,
      targetId:target.id, targetName:target.name||"", pose:p, hfov:p.hfov}); });
  locationSpaceOpenings(l,locations).filter(o=>o.connectsTo===target.id).forEach(o=>{
    const id = locationParentViewAssetId(l,o.id), m = get(id), p = m && m.parentViewPose ? normalizeLocationCameraPose(m.parentViewPose) : null;
    if(!p || p.yaw==null) return;
    if(meta && meta.iso && m.locationParentIso && m.locationParentIso!==meta.iso) return;   // made from an older plate
    out.push({id, kind:"view", key:"", assetId:id, targetId:target.id, targetName:target.name||"", openingId:o.id,
      pose:{...p, pitch:p.pitch||0, lensMm:p.lensMm||24}, hfov:_locNum(m.parentViewPose.hfov,1,179) || locLensHfov(p.lensMm||24)});
  });
  return {candidates:out, recorded:!!rec, hasPlate:!!meta};
}
/* the view whose camera faces the line of sight (within its half field of view) and, with positions, covers the
   area beyond the opening from outside this room — the closest facing wins; null when none faces that way */
function locationMatchView(sight, candidates, childPoly){
  let best = null;
  (candidates||[]).forEach(c=>{
    if(c.kind==="view" && c.openingId && c.openingId!==sight.opening.id) return;
    const half = (c.hfov || locLensHfov(c.pose.lensMm))/2, dyaw = Math.abs(locYawDiff(c.pose.yaw,sight.yaw));
    if(dyaw>half) return;
    let approx = true;
    if(c.pose.position && sight.through){
      if(childPoly && _locInside(c.pose.position,childPoly)) return;          // a camera inside this room shows the room
      /* ON THE OPENING'S OUTWARD SIDE (2026-10-13): a camera behind the room (the mezzanine behind the office) would
         show the room's own back in front of the view — never chosen */
      const ow = sight.opening && sight.opening.yaw;
      if(ow!=null){ const n = _locDir(ow);
        if((c.pose.position[0]-sight.through[0])*n[0] + (c.pose.position[1]-sight.through[1])*n[1] <= 0.2) return; }
      const d = _locDir(sight.yaw);
      const pts = [[sight.through[0]+d[0]*1.5, sight.through[1]+d[1]*1.5], [sight.through[0]+d[0]*4, sight.through[1]+d[1]*4]];
      const covers = pts.every(pt=>{ const dist = Math.hypot(pt[0]-c.pose.position[0], pt[1]-c.pose.position[1]);
        return dist>0.3 && Math.abs(locYawDiff(_locBearing(c.pose.position,pt),c.pose.yaw))<=half; });
      if(!covers) return;
      // …and nothing of the room itself between that camera and what it must show
      if(childPoly && pts.some(pt=>_locSegCrossesPoly(c.pose.position,pt,childPoly))) return;
      approx = false;
    }
    const score = dyaw + 0.3*Math.abs((c.pose.pitch||0)-(sight.pitch||0)) + (approx ? 10 : 0) - (c.kind==="view" ? 5 : 0);
    if(!best || score<best.score) best = {...c, score, approx};
  });
  return best;
}
/* THE ROOM'S PANEL PLAN: per panel, its camera and, for every opening it sees, the view of the space beyond that
   faces the same way (a recorded quadrant of that space's plate, or a view made from here) — or, when none does,
   what the layout says lies that way (unresolved). At most `maxSources` distinct views are attached. */
function locationSubspacePanelPlan(l, locations, metaOf, opts){
  const list = _locList(locations), parent = locationParentOf(l,list);
  if(!parent) return null;
  const o = opts || {}, family = _locFamily(l,list), plan = _locOwnerPlan(l,list).plan;
  const sp = _locCoordSpace(plan.coordinates,l), childPoly = sp && sp.footprint.length>=3 ? sp.footprint : null;
  const maxSources = o.maxSources==null ? 4 : o.maxSources;
  const sources = [], unresolved = [], cands = {};
  const candFor = (t)=> cands[t.id] || (cands[t.id] = locationViewCandidates(t,l,metaOf,list));
  const panels = locationPanelPoses(l,list).map(p=>{
    const sights = locationPanelSightlines(l,p,list).map(s=>{
      const target = _locResolveSpace(s.opening.connectsTo,family) || parent;
      const c = candFor(target);
      let m = locationMatchView(s,c.candidates,childPoly);
      let src = m ? sources.find(x=>x.id===m.id) : null;
      if(m && !src){
        if(sources.length>=maxSources) m = null;
        else { src = {...m, uses:[]}; sources.push(src); }
      }
      const row = {openingId:s.opening.id, openingName:s.opening.name||s.opening.id, kind:s.opening.kind, wallYaw:s.opening.yaw,
        yaw:s.yaw, pitch:s.pitch, through:s.through, from:s.from, targetId:target.id, targetName:target.name||"",
        sourceId:m ? m.id : "", approx:m ? !!m.approx : false};
      if(m) src.uses.push({panel:p.key, openingId:row.openingId, openingName:row.openingName, kind:row.kind});
      else {
        row.beyond = locationAnchorsBeyond(target,s,list);
        row.reason = !c.hasPlate ? "no-plate" : !c.recorded ? "no-record" : "no-match";
        unresolved.push({panel:p.key, openingId:row.openingId, openingName:row.openingName, targetId:target.id,
          targetName:target.name||"", yaw:s.yaw, reason:row.reason});
      }
      return row;
    });
    return {...p, sights};
  });
  return {schema:"cm-subspace-panels-v1", spaceId:l.id, spaceName:l.name||"", parentId:parent.id, parentName:parent.name||"",
    panels, sources, unresolved, ...(locationIsOutdoor(l,list,sp) ? {outdoor:true} : {})};
}

/* ---- prompt wording ---- */
function _locM(n){ return (Math.round(Number(n)*100)/100).toString(); }
/* partOf (2026-10-14): an outdoor part of a larger place — "Camera standing on <space>, part of <parent>" */
function locationPoseText(pose, spaceName, anchors, partOf){
  const p = pose || {};
  const where = p.position ? "at x "+_locM(p.position[0])+" m, y "+_locM(p.position[1])+" m, "+_locM(p.position[2])+" m up"
    : (p.place ? p.place : "position not yet measured");
  const facing = p.yaw!=null ? "facing "+locCompass(p.yaw)+" ("+Math.round(p.yaw)+"°)" : "facing not set";
  const tilt = (p.pitch||0)<=-5 ? "looking down "+Math.round(-p.pitch)+"°" : (p.pitch||0)>=5 ? "looking up "+Math.round(p.pitch)+"°" : "level";
  const aim = p.target ? ((anchors||[]).find(a=>a.id===p.target)||{}).name || "" : "";
  const camera = !spaceName ? "Camera " : partOf ? "Camera standing on "+spaceName+", part of "+partOf+", " : "Camera inside "+spaceName+" ";
  return camera+where+", "+facing+", "+tilt+", "+Math.round(p.lensMm||24)+" mm lens"+(aim ? ", aimed at "+aim : "")+".";
}
/* (2026-10-14) what Plate cameras says under a panel's camera: lowered to the outdoor limit, typed above it, or (an
   outdoor part) facing the way one of its parent's views does — [{kind:"lowered"|"high"|"repeats", text}] */
function locationPanelCameraNotes(p, spaceName, parentName){
  const out = [];
  if(!p) return out;
  if(p.lowered) out.push({kind:"lowered", text:"Lowered to "+p.lowered.to+" m — outdoor cameras stay at eye level or a low high-angle. "
    +(p.lowered.source==="layout" ? "The floor plan puts it "+p.lowered.from+" m up" : p.lowered.source==="saved" ? "It was saved "+p.lowered.from+" m up" : "It was planned "+p.lowered.from+" m up")
    +"; to keep it higher, type its position under Edit camera."});
  /* set by hand (basis user): under Edit camera — where changing any one number keeps the rest of the saved camera, so a
     height that came with an older "Use the suggested cameras" is "as set", not claimed as typed — or on the floor plan */
  if(p.heightWarning) out.push({kind:"high", text:"This camera stands "+p.heightWarning.height+" m up, "
    +(p.heightWarning.source==="layout" ? "as set by hand on the floor plan" : "as set under Edit camera")
    +" — outdoor cameras stay at eye level or a low high-angle (at most about "+p.heightWarning.max+" m). It is used as you set it."});
  const reps = Array.isArray(p.repeatsParent) ? p.repeatsParent.filter(r=>r && LOC_PANEL_INFO[r.panel]) : [];
  if(reps.length && parentName){
    const whose = reps.map(r=>r.real ? "the "+LOC_PANEL_INFO[r.panel].label.toLowerCase()+" panel of "+parentName+"'s plate"
      : "the "+LOC_PANEL_INFO[r.panel].label.toLowerCase()+" view "+parentName+"'s plate asks for").join(" and ");
    out.push({kind:"repeats", text:"Looks the same way as "+whose
      +(p.source==="suggested" ? " — every framing planned on "+(spaceName||"this space")+" repeats one of "+parentName+"'s views here, so this is the one that repeats least."
        : ", so this panel may repeat it.")
      +" Its prompt asks for its own foreground, distance and composition"+(p.source==="suggested" ? "; set this camera by hand to frame it differently." : ".")});
  }
  return out;
}
function _locKindWord(kind){ return kind==="arch" ? "archway" : (kind||"opening"); }
/* outdoor (2026-10-14): an open side of an outdoor part ("Quay continues west") is where the parent continues */
function locationSightText(row, refNumber, outdoor){
  const open = !!outdoor && row.kind==="arch";
  const opening = open ? "Its open side “"+row.openingName+"”"+(row.wallYaw!=null ? " ("+locCompass(row.wallYaw)+")" : "")
    : "Opening “"+row.openingName+"” ("+_locKindWord(row.kind)+(row.wallYaw!=null ? ", "+locCompass(row.wallYaw)+" wall" : "")+")";
  const dir = locCompass(row.yaw);
  if(row.sourceId){
    const ref = refNumber ? "match Image "+refNumber : "match the reference image named for it";
    return opening+(open ? " looks "+dir+" along "+row.targetName+": "+ref+" for what lies beyond it." : " shows "+row.targetName+" as seen from here, looking "+dir+": "+ref+" for what shows through it.");
  }
  const beyond = (row.beyond||[]).map(a=>a.name).filter(Boolean);
  if(open) return opening+" looks "+dir+" along "+row.targetName+"; no reference view faces that way yet (unresolved)"
    +(beyond.length ? " — the shared layout puts "+beyond.join(", ")+" in that direction" : "")
    +". Continue "+row.targetName+" there in the same materials and scale as its plate; never fill it with a copied panel of "+row.targetName+".";
  return opening+" looks "+dir+" into "+row.targetName+"; no reference view faces that way yet (unresolved)"
    +(beyond.length ? " — the shared layout puts "+beyond.join(", ")+" in that direction" : "")
    +". Keep what shows through it plausible and secondary; never fill it with a copied panel of "+row.targetName+".";
}
/* the views block of a room's plate prompt: one camera per panel, interior only, each opening named with its view.
   AN OUTDOOR PART (2026-10-14): four cameras standing on it at eye level — never "inside" it — each a new framing (the
   parent's own views are named so they aren't repeated), and the surroundings must match the parent's plate. */
function locationSubspaceViews(l, plan, refNumbers){
  const name = l.name || "this space", anchors = locationSpaceAnchors(l);
  const nums = refNumbers || {}, outdoor = !!plan.outdoor, pname = plan.parentName || "the parent space";
  const views = {layout:outdoor
    ? "exactly 4 views in a 2x2 grid — four cameras standing on "+name+", an open-air part of "+pname+", one per panel, as placed below"
    : "exactly 4 views in a 2x2 grid — four cameras INSIDE "+name+", one per panel, as placed below"};
  plan.panels.forEach(p=>{
    // (2026-10-14) a camera that could not avoid one of the parent's views: the panel still frames its own picture
    const rep = outdoor && Array.isArray(p.repeatsParent) ? p.repeatsParent.map(r=>LOC_PANEL_INFO[r.panel] ? LOC_PANEL_INFO[r.panel].label.toLowerCase() : "").filter(Boolean) : [];
    views[p.field] = String(p.purpose||"").replace(/\.$/,"")+". "+(outdoor ? locationPoseText(p.pose,name,anchors,pname) : locationPoseText(p.pose,name,anchors)+" Interior of "+name+" only.")
      +(rep.length ? " It looks the same way as the "+rep.join(" and ")+" panel"+(rep.length>1 ? "s" : "")+" of "+pname+"'s plate: give it its own foreground, distance and composition, never that panel's." : "")
      +p.sights.map(s=>" "+locationSightText(s,nums[s.sourceId],outdoor)).join("")
      +locationChildrenVisibleText(locationPanelChildrenVisible(l,p));
  });
  views.camera_convention = "Facings are compass directions of the shared layout: north is the facing named in its frame; yaw in degrees clockwise from north; positions in metres from its origin anchor, height above the floor.";
  views.rule = "each view a distinctly different camera angle and composition — the SAME identical space, consistent architecture, scale, materials and light across all views";
  if(outdoor){
    const parent = locationParentOf(l);
    const clip = (t)=>{ t = String(t||"").replace(/\s+/g," ").trim(); if(t.length<=90) return t.replace(/[\s,;.…]+$/,"");
      const cut = t.slice(0,90), sp = cut.lastIndexOf(" "); return (sp>40 ? cut.slice(0,sp) : cut).replace(/[\s,;:.…]+$/,"")+"…"; };
    // its plate's real cameras where known (locationParentPlateViews), else the views it asks for
    const theirs = parent ? locationParentPlateViews(parent).map(v=>clip(v.purpose)+(v.yaw!=null ? ", facing "+locCompass(v.yaw) : "")).filter(Boolean) : [];
    views.subspace_rules = [
      "Every panel stands on "+name+" at eye level; "+name+" is part of "+pname+", so the rest of "+pname+" around it may be in view.",
      "The surroundings must match "+pname+"'s plate: the same ground, façades, water, skyline, lamps, materials, colours and scale, with everything where the shared layout puts it.",
      "Each panel is a NEW camera position, framed differently from every view of "+pname+"'s own plate"+(theirs.length ? " ("+theirs.join("; ")+")" : "")+".",
      "Never reuse a composition from "+pname+"'s plate as a backdrop, as a view beyond an open side or as this space's layout."];
  } else views.subspace_rules = [
    "The inside of every panel is "+name+" only — never "+(plan.parentName||"the parent space")+" itself, never a sibling room.",
    "An opening shows "+(plan.parentName||"the space beyond")+" as seen from THIS panel's camera position, in the direction it looks, and only through the opening.",
    "Never reuse a composition from "+(plan.parentName||"the parent")+"'s plate as a backdrop, as a view through an opening or as this room's layout."];
  return views;
}
/* the reference note for one attached view of the space beyond (opts.single: a single-frame plate — the opening alone) */
function locationViewSourceNote(src, l, opts){
  const where = (u)=> u.map(x=>LOC_PANEL_INFO[x.panel].label.toLowerCase()).filter((v,i,a)=>a.indexOf(v)===i);
  const byOpening = {};
  (src.uses||[]).forEach(u=>{ (byOpening[u.openingId] = byOpening[u.openingId] || {u, list:[]}).list.push(u); });
  const through = Object.keys(byOpening).map(k=>{ const g = byOpening[k], ps = where(g.list);
    const named = ps.length>2 ? ps.slice(0,-1).join(", ")+" and "+ps[ps.length-1] : ps.join(" and ");   // "top-left, top-right and bottom-right"
    return "the "+_locKindWord(g.u.kind)+" “"+g.u.openingName+"”"+(opts && opts.single ? "" : " in the "+named+" panel"+(ps.length>1 ? "s" : "")); }).join("; ");
  const facing = locCompass(src.pose.yaw);
  const what = src.kind==="quadrant"
    ? src.targetName+" seen facing "+facing+" — the "+LOC_PANEL_INFO[src.key].label.toLowerCase()+" panel of its plate"+(src.pose.place ? ", camera "+src.pose.place : "")
    : src.targetName+" seen facing "+facing+" from "+(l.name||"this room")+"'s position";
  return what+": use ONLY for what is visible through "+through+"; never as "+(l.name||"this room")+" itself and never as a backdrop";
}
async function _locLoadPlate(id){
  let url = typeof nbGetImage==="function" ? nbGetImage(id) : "";
  if(!url && typeof nbLoadImage==="function") url = await nbLoadImage(id);
  return url || "";
}
/* ---- SINGLE CUT-OUT PANELS, NEVER THE WHOLE SHEET (2026-10-14, owner — "go ahead with all of it") ------------------
   A sub-space's plates — its own 2x2 plate, its room & time and environment-state plates, and each one's simplified
   retry, on its card and headless alike — never attach the parent's whole 2x2 sheet (Glass Hours: Fondamenta's sheet,
   a required "need" Image 1 at 768 px, sat beside a quay stretch it already showed; two of the four panels came back
   near-copies). The parent goes in as SINGLE PANELS cut out of its plate: the quadrants matched to a view through an
   opening (at their own size, up to 1536 px) — or, when no quadrant is matched (the plate's cameras are unknown, or none
   faces the way an opening looks), ONE panel, which can be unticked: the parent's own view of this room when its plate
   has one (owner 2026-10-27 — locationParentPanelShowing; scaled up to 1536 px), else one small panel for materials and
   colour only, inside for an inside room, outside for an outside one. The
   layout's own plate is not sent to a sub-space either (locationSpatialReferences). Every path finds the parent the
   same way (locationParentOf: the stored card's parentKey, else the card's parentLocation), so the Location Scout and
   "Make what this scene needs", which pass the stored card, send the same panels as the card.
   EXTRA-SPACE PLATES are not a sub-space path: a sub-space has none (deriveLocationCoverageSheets derives none for a
   card with a parent, and the card shows "Extra spaces" only on a main location). An extra space — the other side of a
   main location, or a booth inside it, that the screenplay never slugs — is made from that location's OWN plate, as its
   room & time and environment-state plates are; it has no parent to cut panels from. */
/* ONE LETTERING RULE (owner 2026-10-27): "no text" fought the spec's own stencilled deck and locker numbers, and the
   model drew gibberish ("DECK N1 30", "1112 1153"). Lettering the spec gives in quotes is drawn exactly; nothing else. */
/* (2026-10-27, the first test run) "except lettering the spec gives in quotes" let the model caption its panels
   ("MARMORICA - CAR DECK (VIEWS ANNOTATIONS)", "VIEW A: 3/4 DIAGONAL"): nothing is ever added ON the picture; the only
   lettering is painted or stencilled ON an object in the set, exactly as quoted */
const LOC_TEXT_RULE = "no text added to the picture of any kind: no titles, headings, labels, captions, panel or view names, annotations, numbers or watermarks over the image or in its borders; the ONLY lettering is painted or stencilled ON an object in the set where the spec quotes it (e.g. a stencilled \"1\" on a bulkhead), exactly that text; any other lettering the spec names shows no legible characters";
const LOC_PANEL_CROP_MAX_DIM = 1536, LOC_MATERIAL_CROP_MAX_DIM = 640, LOC_PREVIEW_CROP_MAX_DIM = 320;
/* (2026-10-27) a panel sent as a VIEW (a matched quadrant, or the parent's panel of the room itself) is scaled up to at
   least this long side when the plate is small — a 2K plate's quadrant is ~1000 px */
const LOC_PANEL_CROP_MIN_DIM = 1536;
/* the cameras recorded for a location's CURRENT plate: the plate's own record (the cameras its prompt stated), else the
   ones noted on its card for that very version (Plate cameras: "This plate's cameras" set by hand, or read from the plate
   — l.plateCameras {iso, source, panels}; an optional field, absent on every older card) — null when unknown */
function normalizeLocationPlateCameras(value){
  if(!value || typeof value!=="object" || !value.panels || typeof value.panels!=="object") return null;
  const iso = typeof value.iso==="string" ? value.iso.slice(0,160) : "";
  if(!iso) return null;
  const panels = {};
  LOC_PANEL_KEYS.forEach(k=>{ const p = value.panels[k]; if(!p || typeof p!=="object") return;
    const pose = normalizeLocationCameraPose({...p, basis:_locBasis(p.basis,"user")});
    if(pose.yaw==null) return;
    panels[k] = {yaw:pose.yaw, pitch:pose.pitch==null ? 0 : pose.pitch, lensMm:pose.lensMm||24, position:pose.position, basis:pose.basis}; });
  if(!Object.keys(panels).length) return null;
  return {iso, source:value.source==="read" ? "read" : "set", panels};
}
function locationNotedPlatePanels(l, meta){
  const r = normalizeLocationPlateCameras(l && l.plateCameras);
  if(!r || !meta || !meta.iso || r.iso!==meta.iso) return null;
  const rec = locationPlatePanels({platePanels:{spaceId:l.id, panels:r.panels}});
  return rec ? {...rec, noted:r.source} : null;
}
/* THE PARENT'S PANEL OF THIS ROOM ITSELF (owner 2026-10-27: Marmorica - CAR Deck was sent the Upper Deck's exterior
   as "materials only" while Marmorica's plate has an interior view of the CAR Deck): the panel of the parent's plate
   that shows this room — the plate's recorded cameras when they say so, else the requested view whose words name the
   room and agree with it inside / outside (a THRESHOLD view between two spaces is not a view of the room). "" if none. */
function locationParentPanelShowing(parent, l, rawRecord){
  if(!parent || !l) return "";
  const order = ["TL","TR","BL","BR"];
  const panels = rawRecord && rawRecord.panels && typeof rawRecord.panels==="object" ? rawRecord.panels : {};
  const recorded = order.find(k=>{ const p = panels[k]; return !!(p && Array.isArray(p.childrenVisible) && p.childrenVisible.some(c=>c && c.spaceId===l.id && c.whole!==false && c.inside!==false)); });
  if(recorded) return recorded;
  const nameK = _locNameKey(l.name), shortK = _locNameKey(String(l.name||"").split(/\s[-–—]\s/).slice(1).join(" "));
  if(!nameK) return "";
  const ie = String(l.intExt||l.ie||"").toUpperCase();
  const words = locationRequestedViews(parent);
  return order.find(k=>{
    const w = String((words.find(x=>x.key===k)||{}).purpose||"");
    if(!w || /^\s*THRESHOLD/i.test(w)) return false;
    const wk = " "+_locNameKey(w)+" ";
    if(wk.indexOf(" "+nameK+" ")<0 && !(shortK && shortK.split(" ").length>=2 && wk.indexOf(" "+shortK+" ")>=0)) return false;
    if(ie==="INT" && /^\s*EXTERIOR/i.test(w)) return false;
    if(ie==="EXT" && /^\s*INTERIOR/i.test(w)) return false;
    return true;
  }) || "";
}
/* the one panel of the parent's plate sent for materials and colour only: a close-up that doesn't show this space (from
   the plate's recorded cameras when it has them), else the parent's requested close-up whose words don't name it — its
   "signature material detail" (bottom-right) first */
function locationParentMaterialPanel(parent, l, rawRecord){
  const order = ["BR","BL","TR","TL"];
  const panels = rawRecord && rawRecord.panels && typeof rawRecord.panels==="object" ? rawRecord.panels : {};
  const showsIt = (k)=>{ const p = panels[k]; return !!(p && Array.isArray(p.childrenVisible) && p.childrenVisible.some(c=>c && c.spaceId===l.id)); };
  const close = order.find(k=>panels[k] && !showsIt(k)
    && ((Number(panels[k].lensMm)||24)>=35 || /close|detail|texture|material/i.test(String(panels[k].purpose||""))));
  if(close) return close;
  const words = locationRequestedViews(parent), nameK = _locNameKey(l.name);
  // (2026-10-27) an inside room gets an inside panel, an outside one an outside panel, when the plate has one
  const ie = String(l.intExt||l.ie||"").toUpperCase();
  const said = (k)=> String((words.find(x=>x.key===k)||{}).purpose||"");
  const same = (k)=> (ie==="INT" && /^\s*INTERIOR/i.test(said(k))) || (ie==="EXT" && /^\s*EXTERIOR/i.test(said(k)));
  const fits = (k)=>{ const w = said(k);
    return !(ie==="INT" && /^\s*EXTERIOR/i.test(w)) && !(ie==="EXT" && /^\s*INTERIOR/i.test(w)); };
  const free = (k)=>{ const w = said(k);
    return !showsIt(k) && !(nameK && (" "+_locNameKey(w)+" ").indexOf(" "+nameK+" ")>=0); };
  const all4 = ["BR","BL","TR","TL"];
  // a panel the plate asked for as inside / outside like this room first, then one that isn't the other kind
  return all4.find(k=>free(k) && same(k)) || all4.find(k=>free(k) && fits(k)) || ["BR","BL"].find(free) || "BR";
}
/* THE PARENT'S PART OF A SUB-SPACE'S REFERENCES: {refs, plan, material} — the matched quadrants (required, numbered,
   labelled for their opening), views made from here, or one optional material panel. opts: single (a single-frame
   plate: labels name the opening, not panels; at most 2 views), preview (small thumbnails for the card's strip; a cut
   that fails shows as missing instead of stopping), maxSources. Throws (requiredReference) when the parent's plate is
   missing — a sub-space waits for it. */
async function locationSubspaceRootReferences(l, opts){
  const o = opts || {};
  const parent = locationParentOf(l);
  if(!parent){
    if(l && l.parentKey){ const e = new Error("Restore the parent location before generating this subspace."); e.requiredReference = true; throw e; }
    return {refs:[], plan:null, material:null};
  }
  let parentUrl;
  try{ parentUrl = await _locLoadPlate(parent.id); }catch(e){ e.requiredReference = true; throw e; }
  if(!parentUrl){ const e = new Error("Generate or restore "+(parent.name||"the parent location")+"'s plate first — this subspace needs it as a visual reference."); e.requiredReference = true; throw e; }
  // a view made from this room's position may not have loaded on this device yet
  for(const op of locationSpaceOpenings(l)){
    const id = locationParentViewAssetId(l,op.id);
    if(typeof nbGetMeta==="function" && !nbGetMeta(id) && typeof nbLoadImage==="function"){ try{ await nbLoadImage(id); }catch(e){} }
  }
  let plan = null;
  try{ plan = locationSubspacePanelPlan(l,null,null,{maxSources:o.maxSources!=null ? o.maxSources : (o.single ? 2 : 4)}); }
  catch(e){ if(!o.preview) throw e; }
  const name = l.name || "this space";
  const plates = {[parent.id]:parentUrl}, data = {};
  const cut = async (assetId, key, max, min)=>{
    const plate = plates[assetId] || (plates[assetId] = await _locLoadPlate(assetId));
    // read as data first (the same fetch the image request uses), so the canvas cut never depends on the image host
    let source = data[assetId] || plate;
    if(plate && !data[assetId] && typeof oaiToDataUrl==="function"){ try{ source = data[assetId] = (await oaiToDataUrl(plate)) || plate; }catch(e){} }
    return source && typeof cropRegionAsDataUrl==="function" ? (await cropRegionAsDataUrl(source, LOC_PANEL_INFO[key].crop, max, min)) || "" : "";
  };
  const refs = [];
  for(const src of (plan ? plan.sources : [])){
    let url = "";
    if(src.kind==="quadrant") url = await cut(src.assetId, src.key, o.preview ? LOC_PREVIEW_CROP_MAX_DIM : LOC_PANEL_CROP_MAX_DIM, o.preview ? 0 : LOC_PANEL_CROP_MIN_DIM);
    else url = await _locLoadPlate(src.assetId);
    if(!url && !o.preview){ const e = new Error("Couldn't read "+(src.targetName||"the parent")+"'s plate to take the view through "+(((src.uses||[])[0]||{}).openingName||"the opening")+". Nothing was sent or charged — try again."); e.requiredReference = true; throw e; }
    refs.push({url, kind:"location", refId:src.id, required:true, ready:!!url, numbered:true, maxDim:LOC_PANEL_CROP_MAX_DIM,
      label:src.targetName+" · facing "+locCompass(src.pose.yaw), note:locationViewSourceNote(src,l,{single:!!o.single})});
  }
  let material = null;
  if(!refs.length){
    const meta = typeof nbGetMeta==="function" ? nbGetMeta(parent.id) : null;
    const live = _locList().find(x=>x && x.id===parent.id) || parent;
    const noted = normalizeLocationPlateCameras(live.plateCameras);
    const raw = (meta && meta.platePanels) || (noted && meta && noted.iso===meta.iso ? noted : null);
    // the parent's own view of this room, when its plate has one: sent as the room's look (2026-10-27)
    const shown = locationParentPanelShowing(parent, l, raw);
    if(shown){
      const url = await cut(parent.id, shown, o.preview ? LOC_PREVIEW_CROP_MAX_DIM : LOC_PANEL_CROP_MAX_DIM, o.preview ? 0 : LOC_PANEL_CROP_MIN_DIM);
      material = {key:shown, refId:"pv-"+parent.id+"-"+shown.toLowerCase(), showsRoom:true};
      if(url || o.preview) refs.push({url, kind:"location", refId:material.refId, required:false, ready:!!url, numbered:true,
        maxDim:LOC_PANEL_CROP_MAX_DIM, label:(parent.name||"Parent location")+" \u00b7 its view of "+name,
        note:(parent.name||"Parent location")+" \u2014 the panel of its plate that shows "+name+" itself: the same room. Keep its architecture, "
          +"surfaces, fixtures, colour and light; "+(o.single ? "frame it as the prompt's camera says" : "each panel takes the camera the prompt states")
          +", never this panel's framing."});
      return {refs, plan, material};
    }
    const key = locationParentMaterialPanel(parent, l, raw);
    const url = await cut(parent.id, key, o.preview ? LOC_PREVIEW_CROP_MAX_DIM : LOC_MATERIAL_CROP_MAX_DIM);
    material = {key, refId:"pm-"+parent.id+"-"+key.toLowerCase()};
    // optional: a panel that can't be read is simply left out (nothing names it)
    if(url || o.preview) refs.push({url, kind:"location", refId:material.refId, required:false, ready:!!url, numbered:true,
      maxDim:LOC_MATERIAL_CROP_MAX_DIM, label:(parent.name||"Parent location")+" · materials and colour only",
      note:(parent.name||"Parent location")+" — ONE panel of its plate, small: materials and colour only. It is NOT a view: "
        +"never copy its composition, framing or layout into "+name+(o.single ? "" : " or any of its panels")});
  }
  return {refs, plan, material};
}
/* A SMALL ROOM WITH NO PLATE OF ITS OWN (2026-10-27, owner — "go ahead with 5 and 6"): a one-off room (a dressing room
   used for one shot) can borrow its parent's plate instead of needing its own. Its shots and Stage clips then get ONE
   small panel of the parent's plate for materials, colour and light — never its layout — and the room itself is built
   from its written description. The panel is cut once and kept as the room's own asset ("ps-<room id>"), so every path
   that loads images by id (the Shots frame, the Stage) reads it; it is cut again when the parent's plate changes.
   l.usesParentPlate is set on the room's card; generating the room's own plate turns it off. */
const LOC_PARENT_STYLE_PREFIX = "ps-";
function locationParentStyleId(l){ return LOC_PARENT_STYLE_PREFIX+String((l&&l.id)||""); }
function locationUsesParentPlate(l, locations){
  return !!(l && l.usesParentPlate && locationParentOf(l, locations));
}
/* which panel a borrowing room gets: the parent's own view of it when the plate has one (2026-10-27), else the
   materials panel */
function locationParentStylePick(l, parent){
  parent = parent || locationParentOf(l);
  if(!parent) return null;
  const pMeta = (typeof nbGetMeta==="function" && nbGetMeta(parent.id)) || {};
  const live = _locList().find(x=>x && x.id===parent.id) || parent;
  const noted = normalizeLocationPlateCameras(live.plateCameras);
  const raw = pMeta.platePanels || (noted && noted.iso===pMeta.iso ? noted : null);
  const shown = locationParentPanelShowing(parent, l, raw);
  return shown ? {key:shown, showsRoom:true} : {key:locationParentMaterialPanel(parent, l, raw), showsRoom:false};
}
function locationParentStyleNote(l, parent){
  const name = (l && l.name) || "this room", pName = (parent && parent.name) || "the parent location";
  const pick = parent ? locationParentStylePick(l, parent) : null;
  if(pick && pick.showsRoom) return pName+" \u2014 the panel of its plate that shows "+name+" itself: the same room. Keep its architecture, "
    +"surfaces, fixtures, colour and light; frame it as the shot's camera says, never this panel's framing.";
  return pName+" — ONE small panel of its plate: materials, colour and light only. It is NOT "+name
    +": build "+name+" from its written description, and never copy this panel's layout, framing or furniture.";
}
async function locationEnsureParentStyle(l, opts){
  const o = opts || {};
  const parent = locationParentOf(l);
  if(!parent) return "";
  const id = locationParentStyleId(l);
  const parentUrl = await _locLoadPlate(parent.id);
  if(!parentUrl) return "";
  const pMeta = (typeof nbGetMeta==="function" && nbGetMeta(parent.id)) || {};
  let cur = typeof nbGetMeta==="function" ? nbGetMeta(id) : null;
  if(!cur && typeof nbLoadImage==="function"){ try{ await nbLoadImage(id); }catch(e){} cur = typeof nbGetMeta==="function" ? nbGetMeta(id) : null; }
  const pick = locationParentStylePick(l, parent), key = pick.key;
  // the same parent plate AND the same panel choice (a cut kept from before 2026-10-27 may be the wrong panel)
  if(cur && cur.parentStyleOf===parent.id && String(cur.parentIso||"")===String(pMeta.iso||"") && cur.panelKey===key && !!cur.showsRoom===pick.showsRoom){
    const u = await _locLoadPlate(id); if(u) return u;
  }
  if(o.readOnly) return "";
  let source = parentUrl;
  if(typeof oaiToDataUrl==="function"){ try{ source = (await oaiToDataUrl(parentUrl)) || parentUrl; }catch(e){} }
  const url = typeof cropRegionAsDataUrl==="function" ? ((await (pick.showsRoom
    ? cropRegionAsDataUrl(source, LOC_PANEL_INFO[key].crop, LOC_PANEL_CROP_MAX_DIM, LOC_PANEL_CROP_MIN_DIM)
    : cropRegionAsDataUrl(source, LOC_PANEL_INFO[key].crop, LOC_MATERIAL_CROP_MAX_DIM))) || "") : "";
  if(!url) return "";
  if(typeof nbCommit==="function"){
    const epoch = typeof nbEpoch==="function" ? nbEpoch() : null;
    try{ const r = await nbCommit(id, url, {parentStyleOf:parent.id, parentIso:pMeta.iso||"", panelKey:key, showsRoom:pick.showsRoom, kind:"location-parent-style",
      prompt:"Cut from "+(parent.name||"the parent location")+"'s plate ("+key+" panel) \u2014 "+(pick.showsRoom ? "its view of "+(l.name||"this room") : "materials, colour and light for "+(l.name||"this room"))},
      [], "location", epoch);
      if(r && r.url && r.tier!=="stale" && r.tier!=="cancelled") return r.url;
    }catch(e){}
  }
  return url;
}
/* A ROOM'S PLATE REFERENCES: the parent's part (above) — every quadrant matched to a view through an opening, cut out
   and numbered, or one optional material panel. Numbered: an unreadable one stops the request before anything is
   charged. The parent's whole sheet is never attached (2026-10-14). */
async function locationSubspacePlateReferences(l){
  const parent = locationParentOf(l);
  const root = await locationSubspaceRootReferences(l);
  if(parent) requireLocationSpatialPlan(l);
  return {refs:root.refs, plan:root.plan};
}
/* refId → its image number in the final list (Image 1 = the first) */
function locationReferenceNumbers(refs){
  const out = {};
  (refs||[]).forEach((r,i)=>{ if(r && r.refId && out[r.refId]==null) out[r.refId] = i+1; });
  return out;
}

/* ---- THE COPY CHECK (2026-10-14, owner — "go ahead with all of it") ------------------------------------------------
   Once a sub-space's plate (or its room & time or environment-state plate — a sub-space has no extra-space plates) is
   made, each of its panels — a single-frame plate: the whole frame — is compared IN THE BROWSER with each panel of the
   parent's plate, on its card and from the headless runs alike (the parent found by its parentKey). Free:
   nothing is sent anywhere. A panel that is a near-copy of one of the parent's shows "This panel looks like <parent>'s
   sheet — regenerate?" with Regenerate (its price) and Keep (locations-ui.jsx LocationCopyCheckNotice). It never blocks
   a render, never regenerates and never spends on its own.
   THE MATHS: each panel, 2% inside its grid lines, in grey, area-averaged into 24×24 and 16×16 grids —
     detail = the best correlation of the 24×24 grids' high-pass (each cell less its 7×7 neighbourhood's mean, so the
              sky / ground split every exterior shares counts for nothing) over shifts of up to ±2 cells (±8%), with
              the new panel also read at 93% and 107% (a copy reframed a little);
     layout = the best correlation of the 16×16 grey grids over shifts of up to ±1 cell.
   A NEAR-COPY: detail ≥ 0.60 AND layout ≥ 0.62 — picked on the fixtures of scripts/test-location-copy-check.mjs
   (scripts/fixtures/copy-check-plates.js: procedural plates of a quay seen by four cameras, 8 worlds — 96 near-
   identical re-renders of a parent panel (up to 5% pan, 6% zoom, 3% tilt, brightness, contrast, tint, noise, blur,
   a window gone) against 48 genuinely different views of the same worlds, 32 neighbouring views (15–26% pan, 1.3×
   zoom) and 8 other worlds). Every copy scores detail ≥ 0.66 and layout ≥ 0.68 (and matches the panel it copies);
   no other view scores both — the closest: detail 0.63 with layout 0.56, detail 0.55 with layout 0.90 — so each
   side clears the line by about 0.05. Known limit: a copy re-lit for another time of day (dark sky and water) is
   usually NOT caught (8 of 32 in the fixtures).
   The result is recorded on the plate's meta as it is saved (copyCheck: this plate version against that parent plate
   version), so it isn't recomputed on every render; Keep is recorded there too. */
const LOC_COPY_CHECK = { v:1, detail:0.60, layout:0.62, inset:2, maxW:384, timeoutMs:4000 };
function _locCopyGrey(img, rect, n){
  const out = new Float64Array(n*n), cnt = new Float64Array(n*n), px = img.px, W = img.w;
  const x0 = Math.max(0, Math.round(rect.x*img.w/100)), y0 = Math.max(0, Math.round(rect.y*img.h/100));
  const x1 = Math.min(img.w, Math.round((rect.x+rect.w)*img.w/100)), y1 = Math.min(img.h, Math.round((rect.y+rect.h)*img.h/100));
  const rw = Math.max(1, x1-x0), rh = Math.max(1, y1-y0);
  const col = new Int32Array(Math.max(0, x1-x0));   // each column's cell, worked out once
  for(let x=x0; x<x1; x++) col[x-x0] = Math.min(n-1, Math.floor((x-x0)*n/rw));
  for(let y=y0; y<y1; y++){
    const row = Math.min(n-1, Math.floor((y-y0)*n/rh))*n;
    let i = (y*W+x0)*4;
    for(let x=0; x<col.length; x++, i+=4){
      const c = row+col[x];
      out[c] += 0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]; cnt[c]++;
    }
  }
  for(let i=0;i<out.length;i++) out[i] = cnt[i] ? out[i]/cnt[i] : 0;
  return out;
}
function _locCopyHighPass(g, n, r){
  const out = new Float64Array(n*n);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++){
    let s = 0, c = 0;
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      const yy = y+dy, xx = x+dx;
      if(yy>=0 && yy<n && xx>=0 && xx<n){ s += g[yy*n+xx]; c++; }
    }
    out[y*n+x] = g[y*n+x]-s/c;
  }
  return out;
}
// zero mean, unit variance (a flat window → all zeros: it correlates with nothing)
function _locCopyZ(a){
  let m = 0; for(let i=0;i<a.length;i++) m += a[i]; m /= a.length || 1;
  let s = 0; for(let i=0;i<a.length;i++) s += (a[i]-m)*(a[i]-m); s = Math.sqrt(s/(a.length||1));
  const out = new Float64Array(a.length);
  if(s>1e-6) for(let i=0;i<a.length;i++) out[i] = (a[i]-m)/s;
  return out;
}
function _locCopyWindow(a, n, dx, dy, m){
  const out = new Float64Array(m*m);
  for(let y=0;y<m;y++) for(let x=0;x<m;x++) out[y*m+x] = a[(y+dy)*n+(x+dx)];
  return out;
}
/* every window of a grid shifted by up to ±s cells, normalised — a parent panel's are read once and kept on its features */
function _locCopyWindows(a, n, s){
  const m = n-2*s, out = [];
  for(let dy=0;dy<=2*s;dy++) for(let dx=0;dx<=2*s;dx++) out.push(_locCopyZ(_locCopyWindow(a, n, dx, dy, m)));
  return out;
}
/* the best correlation of a normalised centre window with any of the shifted windows */
function _locCopyBest(centre, windows){
  let best = -1;
  windows.forEach(w=>{ let c = 0; for(let i=0;i<centre.length;i++) c += centre[i]*w[i]; c /= centre.length || 1; if(c>best) best = c; });
  return best;
}
/* a panel's features — rect in % of the image (LOC_PANEL_INFO[key].crop); scales: the read sizes (1 = the panel) */
function locationCopyFeatures(img, rect, scales){
  const k = LOC_COPY_CHECK.inset;
  const r = { x:rect.x+k, y:rect.y+k, w:rect.w-2*k, h:rect.h-2*k };
  const at = (s)=>{ const w = r.w/s, h = r.h/s; return { x:r.x+(r.w-w)/2, y:r.y+(r.h-h)/2, w, h }; };
  return { hp:(scales||[1]).map(s=>_locCopyHighPass(_locCopyGrey(img, at(s), 24), 24, 3)), g16:_locCopyGrey(img, r, 16) };
}
/* mine: the new panel (its centre window at each read size) against theirs: a parent panel (its windows at every
   shift of up to ±2 cells for detail, ±1 for layout) */
function locationCopyCompare(mine, theirs){
  mine.hpC = mine.hpC || mine.hp.map(h=>_locCopyZ(_locCopyWindow(h, 24, 2, 2, 20)));
  mine.gC = mine.gC || _locCopyZ(_locCopyWindow(mine.g16, 16, 1, 1, 14));
  theirs.hpW = theirs.hpW || _locCopyWindows(theirs.hp[0], 24, 2);
  theirs.gW = theirs.gW || _locCopyWindows(theirs.g16, 16, 1);
  let detail = -1;
  mine.hpC.forEach(c=>{ const v = _locCopyBest(c, theirs.hpW); if(v>detail) detail = v; });
  const layout = _locCopyBest(mine.gC, theirs.gW);
  return { detail, layout, near:detail>=LOC_COPY_CHECK.detail && layout>=LOC_COPY_CHECK.layout };
}
/* child / parent: {px (RGBA), w, h}. opts.single: the child is one frame (a room & time, state or extra-space plate)
   → { v, kind, near, panels:[{key, match, detail, layout, near}] } (match: the parent's panel it is closest to) */
function locationCopyCheckPixels(child, parent, opts){
  const single = !!(opts && opts.single);
  const keys = ["TL","TR","BL","BR"];
  const theirs = keys.map(k=>({ key:k, f:locationCopyFeatures(parent, LOC_PANEL_INFO[k].crop) }));
  const mine = single ? [{ key:"plate", rect:{ x:0, y:0, w:100, h:100 } }] : keys.map(k=>({ key:k, rect:LOC_PANEL_INFO[k].crop }));
  const r3 = (x)=>Math.round(x*1000)/1000;
  const panels = mine.map(p=>{
    const f = locationCopyFeatures(child, p.rect, [0.93,1,1.07]);
    let best = null;
    theirs.forEach(q=>{
      const m = locationCopyCompare(f, q.f);
      if(!best || (m.near && !best.near) || (m.near===best.near && m.detail>best.detail)) best = { ...m, match:q.key };
    });
    return { key:p.key, match:best.match, detail:r3(best.detail), layout:r3(best.layout), near:!!best.near };
  });
  return { v:LOC_COPY_CHECK.v, kind:single ? "single" : "2x2", near:panels.some(p=>p.near), panels };
}
/* an image's pixels, small (the whole image at most 384 px wide), read as data first so the canvas is never tainted.
   The last few reads are kept (a parent's plate is read once for all its rooms' and room & time plates' checks); a
   failed read is not kept, so it is tried again next time. */
const _locCopyPixelCache = new Map();
function _locCopyPixels(url){
  if(!url || typeof document==="undefined" || typeof Image==="undefined") return Promise.resolve(null);
  if(_locCopyPixelCache.has(url)) return _locCopyPixelCache.get(url);
  const p = _locCopyReadPixels(url).catch(()=>null);
  _locCopyPixelCache.set(url, p);
  if(_locCopyPixelCache.size>6) _locCopyPixelCache.delete(_locCopyPixelCache.keys().next().value);
  p.then(r=>{ if(!r && _locCopyPixelCache.get(url)===p) _locCopyPixelCache.delete(url); });
  return p;
}
async function _locCopyReadPixels(url){
  let src = url;
  if(!/^data:/.test(src) && typeof oaiToDataUrl==="function"){ try{ src = (await oaiToDataUrl(url)) || url; }catch(e){} }
  const img = await new Promise(ok=>{ const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = ()=>ok(im); im.onerror = ()=>ok(null); im.src = src; });
  if(!img) return null;
  const nw = img.naturalWidth||img.width, nh = img.naturalHeight||img.height;
  if(!nw || !nh) return null;
  const sc = Math.min(1, LOC_COPY_CHECK.maxW/nw), w = Math.max(1, Math.round(nw*sc)), h = Math.max(1, Math.round(nh*sc));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); if(!ctx) return null;
  ctx.imageSmoothingEnabled = true; try{ ctx.imageSmoothingQuality = "high"; }catch(e){}
  ctx.drawImage(img, 0, 0, w, h);
  try{ return { px:ctx.getImageData(0, 0, w, h).data, w, h }; }catch(e){ return null; }
}
/* the check on two plate images (URLs) → the result above, or null when either can't be read (no check, no notice) */
async function locationCopyCheck(childUrl, parentUrl, opts){
  try{
    const [child, parent] = await Promise.all([_locCopyPixels(childUrl), _locCopyPixels(parentUrl)]);
    return child && parent ? locationCopyCheckPixels(child, parent, opts) : null;
  }catch(e){ return null; }
}
/* the check recorded with a plate as it is saved: { copyCheck } for a sub-space's plate, {} for anything else. Never in
   the way — a check that fails, or takes longer than 4 s, is simply not recorded (the card runs it when it is shown).
   The parent is found as every generator finds it (locationParentOf: the stored card's parentKey, else the card's
   parentLocation) — the Location Scout and "Make what this scene needs" pass the STORED card, which has a parentKey
   but no parentLocation, and their plates used to save no check (2026-10-14, headless paths). */
async function locationCopyCheckMeta(l, url, iso, opts){
  const parent = locationParentOf(l);
  if(!parent || !parent.id || !url || !iso) return {};
  let timer = null;
  // the whole of it inside the time limit — loading the parent's plate too (a slow cloud read never holds the save up)
  const run = (async ()=>{
    let parentUrl = typeof nbGetImage==="function" ? nbGetImage(parent.id) : "";
    if(!parentUrl && typeof nbLoadImage==="function") parentUrl = await nbLoadImage(parent.id);
    const pm = typeof nbGetMeta==="function" ? nbGetMeta(parent.id) : null;
    if(!parentUrl || !pm || !pm.iso) return null;
    const res = await locationCopyCheck(url, parentUrl, opts);
    return res ? { copyCheck:{ ...res, iso, parentId:parent.id, parentIso:pm.iso } } : null;
  })().catch(()=>null);
  try{
    const out = await Promise.race([run, new Promise(ok=>{ timer = setTimeout(()=>ok(null), LOC_COPY_CHECK.timeoutMs); })]);
    return out || {};
  }catch(e){ return {}; }
  finally{ if(timer) clearTimeout(timer); }
}
/* the recorded check when it is THIS plate version's against the parent's CURRENT plate, else null */
function locationCopyCheckCurrent(meta, parentMeta){
  const c = meta && meta.copyCheck;
  return c && c.v===LOC_COPY_CHECK.v && meta.iso && c.iso===meta.iso && parentMeta && parentMeta.iso
    && c.parentIso===parentMeta.iso && Array.isArray(c.panels) ? c : null;
}
window.LOC_COPY_CHECK = LOC_COPY_CHECK;
window.locationCopyCheckPixels = locationCopyCheckPixels;
window.locationCopyCheck = locationCopyCheck;
window.locationCopyCheckMeta = locationCopyCheckMeta;
window.locationCopyCheckCurrent = locationCopyCheckCurrent;

/* ---- "Make a … view from this room's position" — one paid image ---- */
function locationParentViewRequest(l, openingId, locations){
  const list = _locList(locations), parent = locationParentOf(l,list);
  if(!parent) return null;
  const family = _locFamily(l,list);
  for(const p of locationPanelPoses(l,list)){
    const s = locationPanelSightlines(l,p,list).find(x=>x.opening.id===openingId);
    if(!s) continue;
    const target = _locResolveSpace(s.opening.connectsTo,family) || parent;
    const position = s.through ? [s.through[0], s.through[1], p.pose.position ? p.pose.position[2] : 1.6] : (p.pose.position||null);
    const outdoor = locationIsOutdoor(l,list);   // an outdoor part stands on itself, at its open side (2026-10-14)
    const pose = {position, yaw:s.yaw, pitch:s.pitch||0, lensMm:p.pose.lensMm||24, hfov:p.hfov, target:"",
      place:(outdoor ? "standing on " : "inside ")+(l.name||"the room")+", at "+(s.opening.name||"the opening"), basis:"design"};
    return {assetId:locationParentViewAssetId(l,s.opening.id), spaceId:l.id, spaceName:l.name||"", panel:p.key,
      opening:s.opening, targetId:target.id, targetName:target.name||"", pose, beyond:locationAnchorsBeyond(target,s,list),
      ...(outdoor ? {outdoor:true} : {})};
  }
  return null;
}
function buildLocationParentViewPrompt(l, req, project){
  const list = _locList(), target = list.find(x=>x.id===req.targetId) || locationParentOf(l) || {};
  const v = locVisualDefaults(target);
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, target).join(" ") : "empty of people and characters.";
  const beyond = (req.beyond||[]).map(a=>a.name+(a.placement ? " ("+a.placement+")" : "")).filter(Boolean);
  const tname = target.name || "the parent space", rname = l.name || "the room";
  let s = "Render ONE single full-frame environment view of "+tname+" — not a grid, not a storyboard panel. ";
  if(req.outdoor && req.opening.kind==="arch"){
    // an outdoor part's open side: the rest of the parent seen along it, from the edge of the part (2026-10-14)
    s += "CAMERA (binding): "+locationPoseText(req.pose, rname, [], tname)+" It looks along "+tname+" past its open side “"+(req.opening.name||req.opening.id)+"”. ";
    s += "Show ONLY the rest of "+tname+" as it is seen from this position in that direction — leave out "+rname+" itself; "+tname+" fills the frame. ";
  } else {
    s += "CAMERA (binding): "+locationPoseText(req.pose, rname, [])+" It looks out through the "+_locKindWord(req.opening.kind)+" “"+(req.opening.name||req.opening.id)+"”. ";
    s += "Show ONLY "+tname+" as it is seen from this position in that direction — leave out "+rname+"'s own frame, walls and interior; "+tname+" fills the frame. ";
  }
  if(beyond.length) s += "From the shared layout, in that direction: "+beyond.join("; ")+". ";
  s += "Image 1 is "+tname+"'s plate: match its architecture, materials, colour, light and construction exactly, but it is NOT a composition to copy — compose this view from the camera above. ";
  s += locationSpatialPrompt(target);
  s += "RENDER STYLE: "+String(v.renderStyle||"").replace(/\.$/,"")+". "+rules+" No text, labels or captions. Sharp focus, faithful to the render style.";
  const extra = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, target) : "";
  const neg = locationAvoidText(target.negativePrompt||v.negativePrompt||"", extra);   // once (2026-10-14)
  return neg ? (s+" AVOID: "+neg+".") : s;
}
/* how many images it attaches (GPT Image prices each): the plate of the space beyond */
function locationParentViewRefCount(l, req){
  // (2026-10-14) the layout's whole sheet no longer goes to a sub-space's requests (locationSpatialReferences)
  return (req ? req.targetId : ((locationParentOf(l)||{}).id)) ? 1 : 0;
}
async function generateLocationParentView(l, req, project, opts){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function" || !l || !req) return false;
  const o = opts || {};
  const id = req.assetId;
  const _stale = (sid, tok, ep)=> _nbLocStale(sid, tok, ep) || !!(typeof o.cancelled==="function" && o.cancelled());
  const target = _locList().find(x=>x.id===req.targetId) || locationParentOf(l);
  if(!target) return false;
  const runSnapshot = _nbLocRunSnapshot(target);
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const _runToken = _nbLocRunStart(id);
  if(!_runToken) return false;
  try{
    requireLocationSpatialPlan(l);
    const plate = await _locLoadPlate(target.id);
    if(!plate){ const e = new Error("Generate "+(target.name||"the parent location")+"'s plate first — this view is made from it."); e.requiredReference = true; throw e; }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const refs = mergeLocationReferences([{url:plate, kind:"location", refId:target.id, required:true, ready:true,
      note:(target.name||"Parent location")+" plate — architecture, materials, colour and light to match; not a composition to copy"}],
      (await locationSpatialReferences(l)).map(r=>r.refId===target.id ? {...r, note:""} : r));
    let prompt = buildLocationParentViewPrompt(l, req, project)+locationReferenceInstructions(refs);
    gopts.extraImages = refs.map(r=>r.url);
    gopts.referencesNumbered = true;
    const lineage = locationAssetDependencySnapshot(target.id, [], "parent-view");
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let url;
    try{ url = await nbGenerate(prompt, { ...gopts, assetId:id }); }
    catch(e){ if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const meta = Object.assign(_nbLocMeta(prompt,target,runSnapshot), lineage, {
      parentViewPose:{...req.pose}, parentViewFor:{spaceId:l.id, spaceName:l.name||"", openingId:req.opening.id, panel:req.panel}});
    const saved = await nbCommit(id, url, meta, refs, "location", _ep, ()=>_stale(id,_runToken,_ep));
    if(_stale(id,_runToken,_ep) || (saved && /^(cancelled|stale)$/.test(saved.tier||""))){ _nbLocCancelEvent(id,_runToken); return false; }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(id,_runToken); }
}

/* ---- storing a panel pose on the space's coverage views (the free-text fields follow it) ---- */
function locationPoseFreeText(pose, anchors){
  const p = pose || {};
  const aim = p.target ? ((anchors||[]).find(a=>a.id===p.target)||{}).name || p.target : "";
  return {
    cameraPosition:(p.position ? "x "+_locM(p.position[0])+" m, y "+_locM(p.position[1])+" m, "+_locM(p.position[2])+" m up" : (p.place||""))
      +(p.yaw!=null ? (p.position||p.place ? " — " : "")+"facing "+locCompass(p.yaw)+" ("+Math.round(p.yaw)+"°)" : ""),
    target:aim || (p.yaw!=null ? "the "+locCompass(p.yaw)+" side" : ""),
    lens:p.lensMm ? Math.round(p.lensMm)+" mm" : ""};
}
function locationCoverageViewsWithPose(l, key, pose){
  if(LOC_PANEL_KEYS.indexOf(key)<0) return Array.isArray(l && l.coverageViews) ? l.coverageViews.slice() : [];
  let list = Array.isArray(l && l.coverageViews) && l.coverageViews.length
    ? l.coverageViews.map(v=>({...v}))
    : locationCoverageViews(l).map(v=>{ const x = {...v}; delete x.legacy; return x; });
  const anchors = locationSpaceAnchors(l);
  const panels = locationPanelPoses(l);
  let at = list.findIndex(v=>v && v.panel===key);
  if(at<0 && key==="TL" && list[0] && !list[0].panel) at = 0;     // the principal view is the top-left camera
  const before = at>=0 && list[at].pose ? panels.find(p=>p.key===key).pose : null;
  if(!pose){
    if(at<0) return list;
    const v = {...list[at]}; delete v.pose;
    if(v.autoPanel){ list.splice(at,1); return list; }
    if(key==="TL") delete v.panel;
    list[at] = v; return list;
  }
  const clean = normalizeLocationCameraPose(pose);
  const stored = {};
  Object.keys(clean).forEach(k=>{ if(clean[k]!=null && clean[k]!=="") stored[k] = clean[k]; });
  const merged = {...panels.find(p=>p.key===key).suggestedPose, ...stored};
  const text = locationPoseFreeText(merged, anchors), prior = before ? locationPoseFreeText(before, anchors) : null;
  const fill = (v,f)=> (!String(v[f]||"").trim() || (prior && v[f]===prior[f])) ? text[f] : v[f];
  if(at<0){
    const info = LOC_PANEL_INFO[key];
    const name = info.label+" panel camera";
    list.push({id:"panel-"+key.toLowerCase(), name, panel:key, autoPanel:true, pose:stored,
      purpose:panels.find(p=>p.key===key).purpose, cameraPosition:text.cameraPosition, target:text.target, visibleAnchors:"",
      lens:text.lens, staging:{...(typeof emptyStaging==="function" ? emptyStaging() : {}), viewLabel:name}});
    return list;
  }
  const v = {...list[at], panel:key, pose:stored};
  v.cameraPosition = fill(v,"cameraPosition"); v.target = fill(v,"target"); v.lens = fill(v,"lens");
  list[at] = v;
  return list;
}

/* ---- the Blender handoff: the coordinate model as the studio contract reads it ---- */
function locationPoseToStudioCamera(pose){
  const p = pose || {};
  if(!p.position || p.yaw==null) return null;
  const r = Number(p.yaw)*Math.PI/180, t = Number(p.pitch||0)*Math.PI/180, d = 5;
  const target = [p.position[0]+Math.sin(r)*Math.cos(t)*d, p.position[1]+Math.cos(r)*Math.cos(t)*d, p.position[2]+Math.sin(t)*d]
    .map(n=>Math.round(n*1000)/1000);
  return {position:p.position.slice(), target, focalLength:Math.max(8,Math.min(200,Number(p.lensMm)||24)), sensorWidth:LOC_SENSOR_MM};
}
function locationPoseBlenderRotation(pose){
  const p = pose || {};
  if(p.yaw==null) return null;
  const rad = (deg)=> Math.round(deg*Math.PI/180*10000)/10000;
  return [rad(90+Number(p.pitch||0)), 0, rad(-Number(p.yaw))];
}
function locationCoordinateExport(l, locations){
  const list = _locList(locations), {owner, plan} = _locOwnerPlan(l,list), family = _locFamily(l,list);
  const anchors = plan.anchors.filter(a=>a.xy || a.z!=null || a.facing!=null).map(a=>({id:a.id, space:a.space, name:a.name,
    xy:a.xy||null, z:a.z==null ? null : a.z, facing:a.facing==null ? null : a.facing, basis:a.posBasis||"design"}));
  // the cameras as used: an outdoor camera above about 6 m lowered (its floor-plan height kept in loweredFrom)
  const cameras = locationPanelPoses(l,list).map(p=>({spaceId:l.id, panel:p.key, grid:p.grid, purpose:p.purpose,
    source:p.source, stated:p.stated, pose:p.pose, hfov:p.hfov, studioCamera:locationPoseToStudioCamera(p.pose),
    blenderRotationEuler:locationPoseBlenderRotation(p.pose), ...(p.lowered ? {loweredFrom:p.lowered.from} : {})}));
  /* (2026-10-14) the cameras behind the CURRENT plate's panels, when known (its own record, or the ones noted on the card
     for that version) — for matching the plate's pixels in Blender; the cameras above are the ones the next plate asks for */
  const meta = typeof nbGetMeta==="function" ? nbGetMeta(l.id) : null;
  const live = list.find(x=>x && x.id===l.id) || l;
  const shown = locationPlatePanels(meta) || locationNotedPlatePanels(live, meta);
  /* only when they differ from the cameras above (a plate made from them says camerasMatchPlate instead): the package
     reaches Blender Studio as text with a size limit, so the same four cameras are never sent twice */
  let current = null; try{ current = locationPlatePanelRecord(l,list); }catch(e){}
  let legacyCurrent = null; try{ legacyCurrent = locationPlatePanelRecord(l,list,{legacyMainView:true}); }catch(e){}
  const same = !!(shown && meta && meta.platePanels && ((current && _locSameCameras(meta.platePanels, current))
    || (legacyCurrent && _locSameCameras(meta.platePanels, legacyCurrent))));
  const plateCameras = shown && !same ? LOC_PANEL_KEYS.filter(k=>shown.panels[k]).map(k=>{ const p = shown.panels[k];
    return {spaceId:l.id, panel:k, plateIso:String((meta && meta.iso)||""), pose:{position:p.position||null, yaw:p.yaw, pitch:p.pitch||0, lensMm:p.lensMm||24},
      basis:p.basis||"design", studioCamera:locationPoseToStudioCamera(p), blenderRotationEuler:locationPoseBlenderRotation(p)}; }) : [];
  return {schema:"cm-location-coords-v1", convention:LOCATION_COORDINATE_CONVENTION, ownerId:owner.id,
    origin:plan.coordinates ? plan.coordinates.origin : {anchorId:"", note:""},
    spaces:plan.coordinates ? plan.coordinates.spaces : [], anchors,
    openings:family.flatMap(x=>locationSpaceOpenings(x,list).map(o=>({...o, spaceId:x.id}))),
    cameras, ...(same ? {camerasMatchPlate:true} : plateCameras.length ? {plateCameras} : {})};
}
window.LOC_PANEL_KEYS = LOC_PANEL_KEYS;
window.LOC_PANEL_INFO = LOC_PANEL_INFO;
window.LOCATION_COORDINATE_CONVENTION = LOCATION_COORDINATE_CONVENTION;
window.locYaw = locYaw; window.locYawDiff = locYawDiff; window.locCompass = locCompass; window.locLensHfov = locLensHfov;
window.locWallYawFromText = locWallYawFromText;
window.locationAnchorIsOpening = locationAnchorIsOpening;
window.normalizeLocationCameraPose = normalizeLocationCameraPose;
window.normalizeLocationCoordinates = normalizeLocationCoordinates;
window.locationAnchorSpaceOf = locationAnchorSpaceOf;
window.locationSpaceAnchors = locationSpaceAnchors;
window.locationSpaceOpenings = locationSpaceOpenings;
window.locationDefaultPanelPoses = locationDefaultPanelPoses;
window.locationStoredPanelViews = locationStoredPanelViews;
window.locationPanelPoses = locationPanelPoses;

/* ======================= VIEW COVERAGE (owner-approved 2026-10-28, "go ahead with A–D") =======================
   Four panels can't show a whole space: Marmorica's CAR Deck saw ~150° of its 360°, and five of its rooms weren't on
   the floor plan, so nobody knew which way their panels faced. A shot looking at a side no panel shows got the same
   plate and the model invented that side.
   A  locationViewCoverage: which directions a space's panels see (its main sheet + its Reverse views sheet), the
      compass sides and the layout's objects no panel sees, and whether its panels' facings are known at all;
   B  a space with no floor-plan footprint says so (its layout is drafted on the place that owns it);
   C  the REVERSE VIEWS sheet ("<id>-rev"): four more cameras standing where the main sheet's do, looking the other
      way (locationReversePanelPoses), made from the main sheet;
   D  locationShotFacing + locationPanelForFacing: the way a shot looks (its written direction, a reverse of the
      shot before, a Blender camera) → the panel of either sheet that faces that way, cut out on its own. */
const LOC_REVERSE_SUFFIX = "-rev";
function locationReverseId(l){ return String((l && l.id) || l || "") + LOC_REVERSE_SUFFIX; }
function locationHasReverse(l){
  const m = (typeof nbGetMeta==="function") ? nbGetMeta(locationReverseId(l)) : null;
  return !!(m && m.iso);
}
/* the Reverse views sheet's four cameras: each main panel's camera, turned round (its facing + 180°) */
function locationReversePanelPoses(l, locations){
  return locationPanelPoses(l, locations).map(p=>({
    ...p, sheet:"reverse",
    pose:{ ...p.pose, yaw:p.pose.yaw==null ? null : locYaw(Number(p.pose.yaw)+180), target:undefined },
    purpose:"the reverse of the main sheet's "+String(LOC_PANEL_INFO[p.key] ? LOC_PANEL_INFO[p.key].label : p.key).toLowerCase()
      +" view: the same camera position, turned round to look the opposite way"+(p.pose.yaw==null ? "" : " (facing "+locCompass(locYaw(Number(p.pose.yaw)+180))+")")
      +" — what stands behind that camera" }));
}
/* every panel whose facing is known, on the main sheet and (when it exists) the Reverse views sheet */
function locationPanelFacings(l, locations, opts){
  const o = opts || {};
  const out = [];
  locationPanelPoses(l, locations).forEach(p=>{ if(p.pose.yaw!=null) out.push({ sheet:"main", assetId:String(l.id), key:p.key,
    yaw:Number(p.pose.yaw), hfov:locLensHfov(p.pose.lensMm), position:p.pose.position||null, stated:!!p.stated }); });
  if(o.withReverse!==false && (o.reverse===true || locationHasReverse(l)))
    locationReversePanelPoses(l, locations).forEach(p=>{ if(p.pose.yaw!=null) out.push({ sheet:"reverse", assetId:locationReverseId(l), key:p.key,
      yaw:Number(p.pose.yaw), hfov:locLensHfov(p.pose.lensMm), position:p.pose.position||null, stated:!!p.stated }); });
  return out;
}
const LOC_SIDES = [["north",0],["east",90],["south",180],["west",270]];
function locationViewCoverage(l, locations, opts){
  const list = _locList(locations);
  let plan = null, space = null;
  try{ plan = _locOwnerPlan(l, list).plan; space = _locCoordSpace(plan.coordinates, l); }catch(e){}
  const panels = locationPanelFacings(l, list, opts);
  const bins = new Array(36).fill(0);
  panels.forEach(p=>{ for(let i=0;i<36;i++) if(Math.abs(locYawDiff(i*10+5, p.yaw))<=p.hfov/2) bins[i] = 1; });
  const sectorSeen = (centre)=>{ let n = 0; for(let i=0;i<36;i++) if(Math.abs(locYawDiff(i*10+5, centre))<=45 && bins[i]) n++; return n/9; };
  const unseenSides = panels.length ? LOC_SIDES.filter(([,c])=>sectorSeen(c)<0.3).map(([n])=>n) : [];
  // the layout's objects in this space that no panel faces (from its camera, or the room's middle when not placed)
  const fp = space && Array.isArray(space.footprint) && space.footprint.length>=3 ? space.footprint : null;
  const mid = fp ? [fp.reduce((a,q)=>a+q[0],0)/fp.length, fp.reduce((a,q)=>a+q[1],0)/fp.length] : null;
  const k = _locNameKey(l && l.name);
  const objects = ((plan && plan.anchors) || []).filter(a=>a && Array.isArray(a.xy) && _locNameKey(a.space)===k);
  const unseenObjects = panels.length && (mid || panels.some(p=>p.position)) ? objects.filter(a=>!panels.some(p=>{
    const from = p.position ? [Number(p.position[0]), Number(p.position[1])] : mid;
    if(!from || Math.hypot(a.xy[0]-from[0], a.xy[1]-from[1])<0.3) return false;
    return Math.abs(locYawDiff(_locBearing(from, a.xy), p.yaw))<=p.hfov/2; })).map(a=>a.name) : [];
  return { known:panels.length>0, onFloorPlan:!!fp, panels, bins, coveredDeg:bins.reduce((a,b)=>a+b,0)*10,
    unseenSides, unseenObjects, hasReverse:locationHasReverse(l), ownerName:(plan && locationSpatialOwner(l,list).name) || "" };
}
/* D: the way a shot looks, in the layout's compass — null when nothing says so.
   (1) a Blender camera (the Stage's helper, when its set is proven to share the layout's north); (2) its written
   direction: a compass word, or a ship's fore/aft/port/starboard when the layout's frame makes forward north, or
   "toward <an object of this space>"; (3) "reverse" of the shot before, turned round. */
function locationShotFacing(l, sh, opts){
  const o = opts || {};
  if(!l || !sh) return null;
  try{ if(typeof window.stageShotCameraYaw==="function"){ const y = window.stageShotCameraYaw(sh, l); if(y!=null) return { yaw:locYaw(y), from:"blender" }; } }catch(e){}
  const text = String([sh.composition, sh.action, sh.directives].filter(Boolean).join(" ")).toLowerCase();
  let plan = null; try{ plan = _locOwnerPlan(l).plan; }catch(e){}
  const frame = String((plan && plan.frame) || "").toLowerCase();
  const nautical = /\b(forward|bow)\b/.test(frame) && /\bnorth\b/.test(frame);
  const dir = /\b(?:look(?:s|ing)?|fac(?:es|ing)|toward|towards|to(?:ward)?s? the|aim(?:ed|s|ing)? (?:at|toward))\s+(?:the\s+)?(north|south|east|west|forward|fore|aft|astern|the bow|the stern|bow|stern|port|starboard)\b/.exec(text);
  const WORD = { north:0, east:90, south:180, west:270 };
  const SHIP = { forward:0, fore:0, bow:0, "the bow":0, aft:180, astern:180, stern:180, "the stern":180, starboard:90, port:270 };
  if(dir){ const w = dir[1]; if(WORD[w]!=null) return { yaw:WORD[w], from:"text" }; if(nautical && SHIP[w]!=null) return { yaw:SHIP[w], from:"text" }; }
  // toward one of this space's objects, from the room's middle
  try{
    const space = _locCoordSpace(plan.coordinates, l), fp = space && space.footprint;
    if(fp && fp.length>=3){
      const mid = [fp.reduce((a,q)=>a+q[0],0)/fp.length, fp.reduce((a,q)=>a+q[1],0)/fp.length], k = _locNameKey(l.name);
      const toward = /\b(?:look(?:s|ing)?|fac(?:es|ing)|toward|towards)\s+(?:the\s+)?([a-z][a-z' -]{2,40})/.exec(text);
      if(toward){ const words = _locNameKey(toward[1]).split(" ").filter(w=>w.length>=4);
        const a = (plan.anchors||[]).filter(x=>x && Array.isArray(x.xy) && _locNameKey(x.space)===k)
          .find(x=>words.some(w=>(" "+_locNameKey(x.name)+" ").indexOf(" "+w+" ")>=0));
        if(a && Math.hypot(a.xy[0]-mid[0], a.xy[1]-mid[1])>=0.5) return { yaw:_locBearing(mid, a.xy), from:"object", object:a.name }; }
    }
  }catch(e){}
  if(/\breverse\b/.test(text) && o.prevShot && o.prevShot!==sh){
    const prev = locationShotFacing(l, o.prevShot, { ...o, prevShot:null });
    if(prev) return { yaw:locYaw(prev.yaw+180), from:"reverse" };
  }
  return null;
}
/* C: the Reverse views sheet's panel plan, in the prompt's views shape */
function locationReverseViews(l, locations){
  const poses = locationReversePanelPoses(l, locations), field = { TL:"top_left", TR:"top_right", BL:"bottom_left", BR:"bottom_right" };
  const out = { layout:"exactly 4 views in a 2x2 grid \u2014 the REVERSE ANGLES of "+(l.name||"this place")+"'s main sheet (the attached main sheet): each panel stands where the same panel of the main sheet stands and looks the opposite way, so together the two sheets show every side of the space" };
  poses.forEach(p=>{ out[field[p.key]] = p.purpose+(p.pose.yaw!=null || p.pose.position ? ". "+locationPoseText(p.pose, l.name||"", locationSpaceAnchors(l, locations)) : ""); });
  out.rule = "the SAME space as the main sheet \u2014 the same architecture, materials, fixtures, scale and light; show what the main sheet's cameras have behind them, and never repeat a main-sheet view; no actors, no action, no lettering beyond what the spec quotes";
  return out;
}
window.locationReverseViews = locationReverseViews;
/* the panel of either sheet that faces a yaw (the closest within its half-width + 10°) — null when none does */
function locationPanelForFacing(l, yaw, locations){
  if(yaw==null) return null;
  let best = null;
  locationPanelFacings(l, locations).forEach(p=>{ const d = Math.abs(locYawDiff(yaw, p.yaw));
    if(d<=p.hfov/2+10 && (!best || d<best.diff)) best = { ...p, diff:d }; });
  return best;
}
/* D: one panel of a sheet, cut out and kept as its own asset ("pc-<sheet id>-<panel>"), so every path that loads images
   by id (the shot frame, its thumbnails, the Stage) reads it; cut again when that sheet changes */
function locationPanelCutId(assetId, key){ return "pc-"+String(assetId||"")+"-"+String(key||"").toLowerCase(); }
async function locationEnsurePanelCut(assetId, key, opts){
  const o = opts || {};
  const id = locationPanelCutId(assetId, key);
  const sheetUrl = await _locLoadPlate(assetId);
  if(!sheetUrl || !LOC_PANEL_INFO[key]) return "";
  const sMeta = (typeof nbGetMeta==="function" && nbGetMeta(assetId)) || {};
  let cur = typeof nbGetMeta==="function" ? nbGetMeta(id) : null;
  if(!cur && typeof nbLoadImage==="function"){ try{ await nbLoadImage(id); }catch(e){} cur = typeof nbGetMeta==="function" ? nbGetMeta(id) : null; }
  if(cur && cur.panelOf===assetId && cur.panelKey===key && String(cur.panelIso||"")===String(sMeta.iso||"")){
    const u = await _locLoadPlate(id); if(u) return u;
  }
  if(o.readOnly) return "";
  let source = sheetUrl;
  if(typeof oaiToDataUrl==="function"){ try{ source = (await oaiToDataUrl(sheetUrl)) || sheetUrl; }catch(e){} }
  const url = typeof cropRegionAsDataUrl==="function" ? ((await cropRegionAsDataUrl(source, LOC_PANEL_INFO[key].crop, LOC_PANEL_CROP_MAX_DIM, LOC_PANEL_CROP_MIN_DIM)) || "") : "";
  if(!url) return "";
  if(typeof nbCommit==="function"){
    const epoch = typeof nbEpoch==="function" ? nbEpoch() : null;
    try{ const r = await nbCommit(id, url, { panelOf:assetId, panelKey:key, panelIso:sMeta.iso||"", kind:"location-panel-cut",
      prompt:"Cut from "+assetId+" ("+key+" panel)" }, [], "location", epoch);
      if(r && r.url && r.tier!=="stale" && r.tier!=="cancelled") return r.url;
    }catch(e){}
  }
  return url;
}
window.locationPanelCutId = locationPanelCutId;
window.locationEnsurePanelCut = locationEnsurePanelCut;
window.locationReverseId = locationReverseId;
window.locationHasReverse = locationHasReverse;
window.locationReversePanelPoses = locationReversePanelPoses;
window.locationPanelFacings = locationPanelFacings;
window.locationViewCoverage = locationViewCoverage;
window.locationShotFacing = locationShotFacing;
window.locationPanelForFacing = locationPanelForFacing;
window.locationPlatePanelRecord = locationPlatePanelRecord;
window.locationPlatePanels = locationPlatePanels;
window.locationPanelSightlines = locationPanelSightlines;
window.locationAnchorsBeyond = locationAnchorsBeyond;
window.locationParentViewAssetId = locationParentViewAssetId;
window.locationViewCandidates = locationViewCandidates;
window.locationMatchView = locationMatchView;
window.locationSegmentCrossesFootprint = _locSegCrossesPoly;
window.locationSubspacePanelPlan = locationSubspacePanelPlan;
window.locationPoseText = locationPoseText;
window.locationSubspaceViews = locationSubspaceViews;
window.locationSubspaceRootReferences = locationSubspaceRootReferences;
window.locationSubspacePlateReferences = locationSubspacePlateReferences;
window.normalizeLocationPlateCameras = normalizeLocationPlateCameras;
window.locationNotedPlatePanels = locationNotedPlatePanels;
window.locationParentMaterialPanel = locationParentMaterialPanel;
window.locationParentPanelShowing = locationParentPanelShowing;
window.locationParentStyleId = locationParentStyleId;
window.locationUsesParentPlate = locationUsesParentPlate;
window.locationParentStyleNote = locationParentStyleNote;
window.locationParentStylePick = locationParentStylePick;
window.locationEnsureParentStyle = locationEnsureParentStyle;
window.locationIsOutdoor = locationIsOutdoor;
window.locationRequestedViews = locationRequestedViews;
window.locationParentPlateViews = locationParentPlateViews;
window.locationKnownPlatePanels = locationKnownPlatePanels;
window.locationLowerDraftOutdoorCameras = locationLowerDraftOutdoorCameras;
window.locationLoweredCamerasText = locationLoweredCamerasText;
window.locationPanelCameraNotes = locationPanelCameraNotes;
window.LOC_OUTDOOR_MAX_Z = LOC_OUTDOOR_MAX_Z;
window.locationStagingStations = locationStagingStations;
window.locationReferenceNumbers = locationReferenceNumbers;
window.locationParentViewRequest = locationParentViewRequest;
window.buildLocationParentViewPrompt = buildLocationParentViewPrompt;
window.locationParentViewRefCount = locationParentViewRefCount;
window.generateLocationParentView = generateLocationParentView;
window.locationPoseFreeText = locationPoseFreeText;
window.locationCoverageViewsWithPose = locationCoverageViewsWithPose;
window.locationPoseToStudioCamera = locationPoseToStudioCamera;
window.locationPoseBlenderRotation = locationPoseBlenderRotation;
window.locationCoordinateExport = locationCoordinateExport;
window.locationResolveDraftCoordinates = locationResolveDraftCoordinates;
window.locationSpatialPlanTooLarge = locationSpatialPlanTooLarge;
window.locationPanelChildrenVisible = locationPanelChildrenVisible;
window.locationChildrenVisibleText = locationChildrenVisibleText;
window.locationPlateLayoutSig = locationPlateLayoutSig;
window.locationFloorPlanScene = locationFloorPlanScene;
window.locationFloorPlanFit = locationFloorPlanFit;
function locationSpatialFamily(l, locations){ return _locFamily(l, locations); }
window.locationSpatialFamily = locationSpatialFamily;
window.locationPlateLayoutChanged = locationPlateLayoutChanged;

function locationChildrenOf(l,locations){
  const key=locationKeyOf(l);
  return key ? (locations||[]).filter(x=>x&&x!==l&&String(x.parentKey||"")===key) : [];
}
function locationScopeOf(l,locations){
  if(l&&l.parentKey) return "atomic";
  if(l&&/^(atomic|compound)$/.test(String(l.scope||""))) return l.scope;
  return locationChildrenOf(l,locations||((window.turnContinuity||{}).locations)||[]).length ? "compound" : "atomic";
}
function locationEffectiveSide(l,units,coverageSheets,children){
  const sides=[];
  const add=(v)=>{ const s=String(v||"").toUpperCase();
    if(/INT/.test(s)) sides.push("INT"); if(/EXT/.test(s)) sides.push("EXT"); };
  add(l&&l.intExt);
  (units||[]).forEach(u=>add(u&&u.intExt));
  (coverageSheets||[]).forEach(v=>add(v&&v.role));
  (children||[]).forEach(c=>add(c&&c.intExt));
  const set=new Set(sides);
  return set.has("INT")&&set.has("EXT") ? "INT/EXT" : (set.has("EXT")?"EXT":"INT");
}
function locationIdentityLayers(l,locations){
  const list=locations||((window.turnContinuity||{}).locations)||[];
  const parent=locationParentOf(l,list);
  const fields=(x)=>x?{
    architecture:String(x.architecture||"").trim()||undefined,
    materials:String(x.materials||"").trim()||undefined,
    permanent_lighting_interfaces:String(x.lighting||"").trim()||undefined,
    permanent_dressing:String(x.permanentDressing||"").trim()||undefined,
    spatial_topology:String(x.topology||"").trim()||undefined,
    continuity_anchors:String(x.continuityAnchors||"").trim()?{
      status:x.anchorsLocked===false?"editable":"LOCKED / binding",
      rules:String(x.continuityAnchors||"").trim(),
    }:undefined,
    provenance:(x.provenance&&Object.keys(x.provenance).length)?x.provenance:undefined,
  }:undefined;
  return {
    scope:locationScopeOf(l,list),
    // the image model's plain view of the layout (2026-10-27): placements in words, no Blender numbers
    shared_set_layout:locationSpatialImageContract(l,list),
    continuity_root:parent?{ id:parent.id,name:parent.name,invariants:fields(parent) }:undefined,
    child_space:parent?{ id:l.id,name:l.name,specific_identity:fields(l) }:undefined,
    visual_continuity:parent?{
      /* (2026-10-13, Location coordinates) "Match the exact subspace already visible in the parent plate" made the
         model copy the parent's most striking panel into a room's window — the parent's panels are not views to copy.
         (2026-10-14) An outdoor part of a larger place: the parent continues around it, matching its plate */
      rule:locationIsOutdoor(l,list)
        ? "This is an open-air part of "+(parent.name||"the parent place")+": the ground, façades, water and skyline around it continue the parent's plate exactly — the same materials, colours, construction details, scale and positions. The parent's panels are never views to copy — each frame is a new camera standing on this space. Child-specific layout does not replace shared anchors; never transplant sibling-room furnishings."
        : "Where the parent plate shows this room itself (its outside, or a glimpse through a doorway), keep what it shows. Shared materials, construction details, architectural era and scale come from the parent; its panels are never views to copy — what shows through an opening follows this room's own panel cameras and the reference named for it. Child-specific layout does not replace shared anchors; never transplant sibling-room furnishings.",
      render_style_source:(locationRenderStyleSource(l,list)||l).name,
      state_rule:"Keep architecture fixed. Lighting, weather and temporary dressing may vary only in the requested unit/state.",
    }:undefined,
    place_identity:parent?undefined:fields(l),
    precedence:parent
      ? "continuity-root invariants -> child-space facts -> Slugline Unit/Time-of-Day Variant"
      : "place invariants -> Slugline Unit/Time-of-Day Variant",
  };
}
window.locationKeyOf=locationKeyOf;
window.locationParentOf=locationParentOf;
window.locationChildrenOf=locationChildrenOf;
window.locationScopeOf=locationScopeOf;
window.locationEffectiveSide=locationEffectiveSide;
window.locationIdentityLayers=locationIdentityLayers;

/* Derive SLUGLINE UNITS — the atomic filmable unit of a location: one
   (place, INT/EXT side, time-of-day bucket) triple, e.g. "Intake Yard · EXT · Night".
   A master location card groups everything at one PLACE (deriveLocations above);
   a slugline unit splits that place by side and light, because coverage for
   EXT·NIGHT is not coverage for INT·DAWN.
   Rules (agreed design):
   - recurring sluglines of the same triple — even twice inside one scene — share
     ONE unit; story progression ("dawn and raining", "racks now stripped") lives
     in a stored appearance-state overlay on the unit, NOT in derivation.
   - every non-INTERCUT scene-heading block opens a unit context; the blocks that
     follow belong to it until the next heading (INTERCUT / O.S. lines reference
     another space but don't move the camera — they keep the previous unit).
   - a heading with no real time of day (CONTINUOUS / SAME / LATER / untagged)
     inherits the bucket of the context it follows (else the scene's own slug time).
   Pure + deterministic: returns skeleton descriptors in first-appearance order.
   User edits / Time-of-Day Variant / generated images reconcile ON TOP by unit key. */
function deriveSluglineUnits(scenes, drafts, opts){
  scenes = scenesInStoryOrder(scenes);
  const dec = _locDecisions(opts);
  const order = []; const byKey = {};
  /* character-name exclusion set for dressing candidates — screenplay convention
     capitalizes cast names in action prose, so every char cue (plus its
     individual words) is vetoed from the ALL-CAPS object extractor. */
  const charNames = {};
  (scenes||[]).forEach(sc=>{
    locationScreenplayBlocks(sc, drafts).forEach(b=>{
      if(b && b.type==="char" && b.text){
        const nm = String(b.text).replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
        if(!nm) return;
        charNames[nm.toLowerCase()] = true;
        nm.split(/ +/).forEach(w=>{ if(w.length>2) charNames[w.toLowerCase()] = true; });
      }
    });
  });
  const clockBucket = (txt)=>{
    const c = String(txt||"").match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
    return c ? clockToTimeOfDay(c[1]) : "";
  };
  const fmtBlocks = (blks)=> blks.map(b=>{
    const t = String(b&&b.text||"").replace(/\s+/g," ").trim(); if(!t) return "";
    if(b.type==="scene") return t.toUpperCase();
    if(b.type==="char") return "\n"+t.toUpperCase();
    if(b.type==="dia") return "  "+t;
    if(b.type==="paren") return "  ("+t.replace(/^\(|\)$/g,"")+")";
    return t;
  }).filter(Boolean).join("\n");
  const stripNum = (t)=> String(t||"").replace(/^\s*\d+[\.\)]?\s+/,"");
  (scenes||[]).forEach(sc=>{
    if(!sc) return;
    const blocks = locationScreenplayBlocks(sc, drafts);
    if(!blocks.length) return;
    // the scene's own slugline is the fallback context for leading non-heading
    // blocks and for headings that omit side/time.
    const prim = parseSlugline(sc.loc) || { intExt:"", place:"", time:"" };
    let lastBucket = (prim.time && normalizeTOD(prim.time)) || clockBucket(sc.loc) || "";
    let lastSide = prim.intExt || "";
    let cur = null, curOcc = null;
    const closeOcc = (idx)=>{ if(curOcc && curOcc.end==null) curOcc.end = idx; };
    /* Open a unit context for a heading. The unit keys on the FULL normalized place
       (area tails included — "Nebuchadnezzar · Core" and "· Training" are distinct
       filmable spaces); locationKey is the head-only master-card key deriveLocations
       uses, so units still group under the same master card. */
    const open = (slugText, idx, sourceKind)=>{
      const parsed = parseSlugline(slugText);
      if(!parsed) return;
      const primary = tidyPlace(splitCompoundPlace(parsed.place)[0]||"");
      if(!primary) return;
      const side = parsed.intExt || lastSide || "INT";
      const bucket = (parsed.time && normalizeTOD(parsed.time)) || clockBucket(slugText) || lastBucket;
      lastSide = side; if(bucket) lastBucket = bucket;
      const head = primary.split(/[\u00b7\u2014,]/)[0].trim();
      const key = locSlug(primary) + "|" + side + "|" + (bucket||"untimed");
      if(!byKey[key]){
        byKey[key] = {
          key, name: primary, place: primary,
          intExt: side, time: bucket || "",
          locationKey: locSlug(head).split("-").slice(0,4).join("-"),
          subspaceKey: locSlug(head).split("-").slice(0,4).join("-"),
          continuityRootKey: locSlug(head).split("-").slice(0,4).join("-"),
          scenes: [], sceneNos: [], sluglines: [], occurrences: [], scriptText: "",
          dressingDerived: [], sourceKinds:[],
        };
        order.push(key);
      }
      cur = byKey[key];
      const occurrenceOrdinal=cur.occurrences.filter(o=>String(o&&o.sceneId||"")===String(sc.id||"")).length+1;
      curOcc = { sceneId: sc.id, sceneNo: sc.no, slug: String(slugText||"").trim(),
        sourceKind:sourceKind||"slugline", occurrenceOrdinal, start: idx, end: null };
      cur.occurrences.push(curOcc);
      if(cur.scenes.indexOf(sc.id)<0) cur.scenes.push(sc.id);
      if(sc.no!=null && cur.sceneNos.indexOf(sc.no)<0) cur.sceneNos.push(sc.no);
      const raw = String(slugText||"").trim();
      if(raw && cur.sluglines.indexOf(raw)<0) cur.sluglines.push(raw);
      if(sourceKind && cur.sourceKinds.indexOf(sourceKind)<0) cur.sourceKinds.push(sourceKind);
    };
    let sawHeading = false, actionSinceHeading=0;
    blocks.forEach((b, idx)=>{
      /* EVERY heading line is a HARD boundary — even one that fails to parse.
         Closing the previous occurrence and opening nothing means its blocks own
         nothing until the next parseable heading, rather than silently bleeding
         into the previous unit. INTERCUT is tested after number-stripping so a
         numbered "12 INTERCUT WITH:" can't slip past the guard. */
      if(b && b.type==="scene" && b.text && !/^\s*INTERCUT\b/i.test(stripNum(b.text))){
        sawHeading = true;
        closeOcc(idx); cur = null; curOcc = null;
        open(b.text, idx,"slugline"); actionSinceHeading=0;
      } else if(!sawHeading && !cur){
        // leading prose before any heading (a draft with no heading blocks):
        // it still belongs SOMEWHERE — anchor it to the scene's own slugline.
        if(sc.loc){ open(sc.loc, 0,"slugline"); sawHeading = true; actionSinceHeading=0; }
      }
      if(b && b.type==="action"){
        const currentHeading=cur&&cur.sluglines&&cur.sluglines.length
          ?cur.sluglines[cur.sluglines.length-1]:sc.loc;
        const firstActionInSpace=actionSinceHeading===0;
        const inline=screenplayInlineSpaceHeading(b.text,currentHeading,firstActionInSpace);
        actionSinceHeading++;
        if(inline){
          const parsedInline=parseSlugline(inline);
          const inlineKey=parsedInline&&locSlug(parsedInline.place);
          const currentKey=cur&&locSlug(cur.place);
          if(inlineKey && inlineKey!==currentKey){
            closeOcc(idx); cur=null; curOcc=null;
            open(inline,idx,firstActionInSpace?"derived-establishing-action":"derived-inline-room-cue");
          }
        }
      }
    });
    closeOcc(blocks.length);
  });
  /* SUB-SPACE FOLD — a unit's own identity (place × side × bucket, and its stable
     overlay key) never changes, but its master-card grouping follows the complex
     it belongs to: the Intake Booth unit renders INSIDE the Intake Yard card
     instead of a booth card of its own. */
  /* A unit written with a merged-away name (2026-10-14, SAME PLACE, TWO NAMES) keeps its own key (and so its plates and
     notes) but belongs to the survivor's card: its subspaceKey is the survivor's key. */
  const placeRecs = {};
  const unitPlaceKey = (u)=> locationAliasKey(locSlug(u.place.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-"), dec);
  order.forEach(k=>{ const u = byKey[k];
    const own = locSlug(u.place.split(/[\u00b7\u2014,]/)[0]).split("-").slice(0,4).join("-"), pk = unitPlaceKey(u);
    const headName = String(u.place).split(/[\u00b7\u2014]/)[0].trim();
    if(!placeRecs[pk]) placeRecs[pk] = { key:pk, name:pk!==own ? (dec.names[pk]||headName) : headName, scenes:[], aliasNames:[], fromAlias:pk!==own };
    else if(pk===own && placeRecs[pk].fromAlias){ placeRecs[pk].name = headName; placeRecs[pk].fromAlias = false; }
    if(pk!==own && placeRecs[pk].aliasNames.indexOf(headName)<0) placeRecs[pk].aliasNames.push(headName);
    u.scenes.forEach(sid=>{ if(placeRecs[pk].scenes.indexOf(sid)<0) placeRecs[pk].scenes.push(sid); }); });
  Object.keys(placeRecs).forEach(pk=>{ (dec.aliasNames[pk]||[]).forEach(n=>{ if(placeRecs[pk].aliasNames.indexOf(n)<0) placeRecs[pk].aliasNames.push(n); }); });
  // a grouped head's parent (SHARED-HEAD PARENTS, 2026-10-26) is every room's continuity root here too; each unit
  // still belongs to its own room's card (subspaceKey)
  const placeOrder = Object.keys(placeRecs); addSharedHeadParents(placeOrder, placeRecs, dec, false);
  const unitFold = foldSubspaceKeys(placeOrder.map(k=>placeRecs[k]), scenes, drafts, dec);
  order.forEach(k=>{ const u = byKey[k];
    const pk = unitPlaceKey(u);
    u.subspaceKey = pk;
    u.continuityRootKey = unitFold[pk] ? resolveFoldKey(unitFold,pk) : pk;
    u.locationKey = u.continuityRootKey; });
  order.forEach(k=>{
    const u = byKey[k];
    let txt = "", act = "";
    u.occurrences.forEach(occ=>{
      const sc = (scenes||[]).find(s=>s.id===occ.sceneId);
      const blocks = locationScreenplayBlocks(sc, drafts);
      const slice = blocks.slice(occ.start, occ.end==null ? blocks.length : occ.end);
      const piece = fmtBlocks(slice);
      occ.scriptText = piece.length>1400 ? piece.slice(0,1400).replace(/\s+\S*$/,"")+" …" : piece;
      if(piece) txt += (txt ? "\n\n" : "") + piece;
      // dressing candidates come from ACTION prose only — never dialogue/cues
      slice.forEach(b=>{ if(b && b.type==="action"){
        const t = String(b.text||"").replace(/\s+/g," ").trim();
        if(t) act += (act?" ":"")+t; } });
    });
    // generous but capped: this text rides image-gen prompts, not the saved doc
    u.scriptText = txt.length>3600 ? txt.slice(0,3600).replace(/\s+\S*$/,"")+" …" : txt;
    u.dressingDerived = deriveUnitDressing(act, charNames);
  });
  return order.map(k=>byKey[k]);
}
window.deriveSluglineUnits = deriveSluglineUnits;

/* RECONCILIATION — derived skeletons (fresh from the script) + persisted OVERLAYS
   (user data: Time-of-Day Variant, notes, generated image refs). The doc only ever
   stores the overlay array (key + user fields) — never skeleton fields — so script
   edits refresh the skeleton without orphaning user data, and the doc stays small.
   Merge rule: derived skeleton fields win; overlay fields ride on top.
   An overlay whose key is no longer derived (its slugline was edited away) comes
   back flagged orphan:true — its assets are PRESERVED until the user explicitly
   deletes the record (deleting a scene must never silently destroy paid images). */
function reconcileSluglineUnits(derived, overlays){
  const ov = {};
  (Array.isArray(overlays)?overlays:[]).forEach(o=>{ if(o && o.key) ov[o.key]=o; });
  const used = {};
  const merged = (Array.isArray(derived)?derived:[]).map(u=>{
    const o = ov[u.key] || null;
    if(o) used[o.key] = true;
    return {
      ...u,
      appearance: (o && o.appearance) || "",
      notes: (o && o.notes) || "",
      dressing: Array.isArray(o && o.dressing) ? o.dressing.slice() : [],
      setups: reconcileSceneSetupRecords(u.key,u.occurrences,o&&o.setups),
      images: Array.isArray(o && o.images) ? o.images : [],
      updatedAt: (o && o.updatedAt) || null,
    };
  });
  // orphans: rebuild a display-minimal skeleton from the key parts ("place|side|bucket").
  // Parse from the RIGHT so a corrupt/legacy key with extra "|" still yields a sane
  // side+bucket and keeps everything before them as the place.
  Object.keys(ov).sort().forEach(k=>{
    if(used[k]) return;
    const o = ov[k];
    const parts = String(k).split("|");
    const placeSlug = parts.length>2 ? parts.slice(0,-2).join("|") : (parts[0]||"");
    const name = placeSlug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
    const side = parts.length>2 ? parts[parts.length-2] : "";
    const bucket = parts.length>2 ? parts[parts.length-1] : "";
    // a merged-away name's orphan belongs to its survivor's card (2026-10-14, SAME PLACE, TWO NAMES)
    const placeKey = locationAliasKey(placeSlug.split("-").slice(0,4).join("-"));
    merged.push({
      key:k, name: name||k, place: name||k,
      intExt: side, time: (bucket && bucket!=="untimed") ? bucket : "",
      locationKey: placeKey,
      subspaceKey: placeKey,
      continuityRootKey: placeKey,
      scenes: [], sceneNos: [], sluglines: [], occurrences: [], scriptText: "",
      appearance: o.appearance||"", notes: o.notes||"",
      dressing: Array.isArray(o.dressing) ? o.dressing.slice() : [],
      setups: reconcileSceneSetupRecords(k,[],o.setups),
      dressingDerived: [],
      images: Array.isArray(o.images) ? o.images : [], updatedAt: o.updatedAt||null,
      orphan: true,
    });
  });
  return merged;
}
window.reconcileSluglineUnits = reconcileSluglineUnits;

/* Upsert one overlay record by unit key. `patch` carries OVERLAY fields only
   (appearance / notes / images …) — never skeleton fields, which stay derived.
   A record emptied of every overlay field is dropped from the array, so a cleared
   appearance note doesn't leave dead weight in the doc. */
function upsertSluglineUnitOverlay(overlays, key, patch){
  const list = (Array.isArray(overlays)?overlays:[]).slice();
  const i = list.findIndex(o=>o && o.key===key);
  const next = { ...(i>=0?list[i]:{ key }), ...(patch||{}), key, updatedAt: Date.now() };
  // write-time normalization: trim, collapse whitespace, dedupe case-insensitively,
  // cap — so rapid clicks or legacy casing/spacing can never persist duplicates
  if(Array.isArray(next.dressing)){
    const seen = {}; const norm = [];
    next.dressing.forEach(x=>{ const v = String(x||"").replace(/\s+/g," ").trim();
      const k = v.toLowerCase(); if(v && !seen[k]){ seen[k]=true; norm.push(v); } });
    next.dressing = norm.slice(0,24);
  }
  if(Array.isArray(next.setups)){
    next.setups = next.setups.map(s=>{
      const seen={}, temporaryDressing=[];
      (Array.isArray(s&&s.temporaryDressing)?s.temporaryDressing:[]).forEach(x=>{
        const v=String(x||"").replace(/\s+/g," ").trim(), k=v.toLowerCase();
        if(v&&!seen[k]){seen[k]=true;temporaryDressing.push(v);}
      });
      return {...(s||{}),temporaryDressing:temporaryDressing.slice(0,24)};
    }).filter(s=>s&&s.id&&(
      s.temporaryDressing.length||String(s.blocking||"").trim()||String(s.handledProps||"").trim()
      ||String(s.objectStates||"").trim()||String(s.notes||"").trim()
    )).slice(0,64);
  }
  const empty = !String(next.appearance||"").trim() && !String(next.notes||"").trim()
    && !(Array.isArray(next.dressing) && next.dressing.length)
    && !(Array.isArray(next.setups) && next.setups.length)
    && !(Array.isArray(next.images) && next.images.length);
  if(empty){ if(i>=0) list.splice(i,1); return list; }
  if(i>=0) list[i]=next; else list.push(next);
  return list;
}
window.upsertSluglineUnitOverlay = upsertSluglineUnitOverlay;

/* stable, collision-safe image id for a slugline unit: readable slug prefix +
   short djb2 hash of the FULL key, so distinct keys that sanitize to the same
   slug (INT/EXT, separators, hyphens) never share an image slot/history. */
function sluglineUnitImageId(key){
  const slug = String(key||"").replace(/[^a-z0-9-]+/gi,"-").slice(0,48);
  let h = 5381; const s = String(key||"");
  for(let i=0;i<s.length;i++){ h = ((h<<5)+h+s.charCodeAt(i))>>>0; }
  return "locunit-"+slug+"-"+h.toString(36);
}
window.sluglineUnitImageId = sluglineUnitImageId;

/* Scene Setup identity follows screenplay occurrence ORDER inside one
   Slugline Unit + scene, never the mutable block offset. Inserting prose
   before an occurrence therefore cannot detach its saved setup. */
function screenplayOccurrenceKey(unitKey,occ,index,occurrences){
  const sceneId=String(occ&&occ.sceneId||"scene");
  let ordinal=Number(occ&&occ.occurrenceOrdinal);
  if(!(ordinal>0)){
    const list=Array.isArray(occurrences)?occurrences:[];
    const stop=Math.max(0,Number(index)||0);
    ordinal=1;
    for(let i=0;i<Math.min(stop,list.length);i++){
      if(String(list[i]&&list[i].sceneId||"scene")===sceneId) ordinal++;
    }
  }
  return String(unitKey||"space")+"@"+sceneId+"#"+ordinal;
}
/* Upgrade block-offset-era setup IDs in memory. Exact durable IDs win; older
   records then pair by sceneId (or their old `unit@scene:start` prefix) in
   occurrence order. Records that no longer have a screenplay occurrence stay
   visible as orphans, so no authored production work is silently discarded. */
function reconcileSceneSetupRecords(unitKey,occurrences,saved){
  const occs=Array.isArray(occurrences)?occurrences:[];
  const rows=(Array.isArray(saved)?saved:[]).filter(Boolean).map(x=>({...x}));
  const used=new Set(), out=[];
  occs.forEach((occ,index)=>{
    const id=screenplayOccurrenceKey(unitKey,occ,index,occs);
    let at=rows.findIndex((x,i)=>!used.has(i)&&String(x.id||"")===id);
    const sceneId=String(occ&&occ.sceneId||"");
    if(at<0){
      const legacyPrefix=String(unitKey||"space")+"@"+sceneId+":";
      at=rows.findIndex((x,i)=>!used.has(i)&&sceneId&&String(x.id||"").startsWith(legacyPrefix));
    }
    if(at<0) at=rows.findIndex((x,i)=>!used.has(i)&&sceneId&&String(x.sceneId||"")===sceneId);
    if(at<0) return;
    used.add(at);
    const storedId=String(rows[at].id||"");
    const originalStorageId=String(rows[at].storageId||storedId);
    const next={...rows[at],id,sceneId:occ.sceneId,sceneNo:occ.sceneNo,
      storageId:originalStorageId&&originalStorageId!==id?originalStorageId:undefined};
    delete next.orphan;
    out.push(next);
  });
  rows.forEach((x,index)=>{
    if(used.has(index)) return;
    out.push({...x,id:String(x.id||(
      String(unitKey||"space")+"@"+String(x.sceneId||"missing")+"#orphan-"+(index+1)
    )),orphan:true});
  });
  return out;
}
window.screenplayOccurrenceKey=screenplayOccurrenceKey;
window.reconcileSceneSetupRecords=reconcileSceneSetupRecords;

/* TIME-OF-DAY-VARIANT ASSET IDENTITY --------------------------------------
   Slugline Units own every addressed place/side/time unit. Time-of-Day
   Variants are narrower: they show only a genuine change from that space's first
   screenplay state (Night -> Dawn, weather, damage, temporary dressing, etc.)
   plus deliberately added manual states. When such a change corresponds to a
   Slugline Unit, both surfaces still share its durable asset id/history. */
function locationVariantSluglineUnit(l, v, units){
  const list = Array.isArray(units) ? units : (((window.turnContinuity||{}).sluglineUnits)||[]);
  const lkey = locationKeyOf(l);
  const candidates = list.filter(u=>u && !u.orphan
    && String(u.subspaceKey||u.locationKey||"")===lkey);
  const explicit = String(v&&v.unitKey||"");
  if(explicit){
    const hit = candidates.find(u=>String(u.key||"")===explicit);
    return hit||null;
  }
  // A deliberately authored Time-of-Day Variant is a distinct environment asset
  // unless the author explicitly binds it to a Slugline Unit. Matching only
  // by time/side would otherwise make two cards overwrite one image history.
  if(v&&v.manualState) return null;
  const time = normalizeTOD(v&&v.time) || titleCaseTime(v&&v.time);
  const side = String(v&&v.intExt||"").toUpperCase();
  const matches = candidates.filter(u=>{
    const ut = normalizeTOD(u.time) || titleCaseTime(u.time);
    return ut===time && (!side || String(u.intExt||"").toUpperCase()===side);
  });
  return matches.length===1 ? matches[0] : null;
}
function locationAppearanceStates(l, units){
  const list = Array.isArray(units) ? units : [];
  const lkey = locationKeyOf(l);
  const stateUnits = list.filter(u=>u && !u.orphan
    && String(u.subspaceKey||u.locationKey||"")===lkey);
  const variants = Array.isArray(l&&l.variants) ? l.variants : [];
  const used = new Set();
  const baseline=stateUnits[0]||null;
  // INT/EXT is geography, not an appearance change. A side change therefore
  // stays in Slugline Units; only time/environment deltas project here.
  const signature=u=>normalizeTOD(u&&u.time)||titleCaseTime(u&&u.time);
  const baselineSignature=signature(baseline);
  const rows = [];
  stateUnits.forEach((u,unitIndex)=>{
    // An explicit unitKey is an intentional binding, even for a manually added
    // state. Manual states without it remain separate assets (see resolver).
    let legacyIndex = variants.findIndex((v,i)=>!used.has(i)
      && String(v&&v.unitKey||"")===String(u.key||""));
    if(legacyIndex<0){
      const ut = normalizeTOD(u.time) || titleCaseTime(u.time);
      const hits=[];
      variants.forEach((v,i)=>{
        if(used.has(i)||v.manualState) return;
        const vt=normalizeTOD(v&&v.time)||titleCaseTime(v&&v.time);
        const side=String(v&&v.intExt||"").toUpperCase();
        if(vt===ut && (!side || side===String(u.intExt||"").toUpperCase())) hits.push(i);
      });
      if(hits.length===1) legacyIndex=hits[0];
    }
    const legacy = legacyIndex>=0 ? variants[legacyIndex] : null;
    if(legacyIndex>=0) used.add(legacyIndex);
    // Legacy unit notes and dressing describe the occurrence, so they migrate
    // to its first Scene Setup. Only an explicit environment description (or a
    // genuine time change below) creates a Time-of-Day Variant.
    const explicitChange=!!(String(u.appearance||"").trim()
      ||String(legacy&&legacy.state||"").trim());
    const changedUnit=unitIndex>0 && signature(u)!==baselineSignature;
    if(!explicitChange&&!changedUnit) return;
    rows.push({
      ...(legacy||{}),
      id:(legacy&&legacy.id)||("unit-state-"+sluglineUnitImageId(u.key).slice(-12)),
      unitKey:u.key,
      intExt:u.intExt,
      time:u.time,
      state:String(u.appearance||"").trim() || String(legacy&&legacy.state||""),
      linkedUnit:u,
      screenplayDerived:true,
    });
  });
  variants.forEach((v,i)=>{ if(!used.has(i)) rows.push({...v,linkedUnit:null,screenplayDerived:false}); });
  return rows;
}
function locationAppearanceStateAssetId(l, v, units){
  const u = (v&&v.linkedUnit) || locationVariantSluglineUnit(l,v,units);
  return u ? sluglineUnitImageId(u.key) : String((l&&l.id)||"location")+"-"+String((v&&v.id)||"state");
}
window.locationVariantSluglineUnit = locationVariantSluglineUnit;
window.locationAppearanceStates = locationAppearanceStates;
window.locationAppearanceStateAssetId = locationAppearanceStateAssetId;

/* LOCATION PRODUCTION LAYERS ----------------------------------------------
   These helpers keep the Art Room and Blender handoff on the same vocabulary.
   They are projections over the existing records, so older films and every
   generated plate keep their stable IDs and history. */
function screenplaySpaceSourceMeta(u){
  const kinds=new Set((u&&u.sourceKinds)||[]);
  const authored=kinds.has("slugline");
  const establishing=kinds.has("derived-establishing-action");
  const inline=kinds.has("derived-inline-room-cue");
  const legacy=kinds.has("inline-space");
  let label="Authored slugline",kind="authored";
  if(authored&&(establishing||inline||legacy)){label="Authored + derived";kind="mixed";}
  else if(establishing){label="Derived from establishing action";kind="derived-establishing";}
  else if(inline){label="Derived from inline room cue";kind="derived-inline";}
  else if(legacy){label="Derived from screenplay action";kind="derived-action";}
  return {kind,label,sourceKinds:Array.from(kinds)};
}
function locationSceneSetups(l,units){
  const lkey=locationKeyOf(l), rows=[];
  (Array.isArray(units)?units:[]).filter(u=>u&&String(u.subspaceKey||u.locationKey||"")===lkey)
    .forEach(u=>{
      const occurrences=Array.isArray(u.occurrences)&&u.occurrences.length?u.occurrences:[];
      const saved=reconcileSceneSetupRecords(u.key,occurrences,u.setups);
      occurrences.forEach((occ,index)=>{
        const id=screenplayOccurrenceKey(u.key,occ,index,occurrences);
        const setup=saved.find(x=>x&&x.id===id)||{};
        const sceneId=String(occ&&occ.sceneId||"");
        const occurrenceOrdinal=occurrences.slice(0,index+1)
          .filter(x=>String(x&&x.sceneId||"")===sceneId).length;
        const occurrenceCount=occurrences
          .filter(x=>String(x&&x.sceneId||"")===sceneId).length;
        // Old unit-level notes/dressing are surfaced on the first occurrence so
        // upgrading never hides a user's work. New edits are occurrence-scoped.
        const legacy=index===0&&!saved.some(x=>x&&!x.orphan);
        rows.push({
          id,unitKey:u.key,sceneId:occ.sceneId,sceneNo:occ.sceneNo,
          occurrenceOrdinal,occurrenceCount,
          spaceName:u.name||l&&l.name||"Location",intExt:u.intExt||"",time:u.time||"",
          sourceSlug:occ.slug||"",sourceKind:occ.sourceKind||"slugline",
          screenplayExcerpt:occ.scriptText||"",storageId:setup.storageId||setup.id||id,
          temporaryDressing:Array.isArray(setup.temporaryDressing)?setup.temporaryDressing.slice()
            :(legacy&&Array.isArray(u.dressing)?u.dressing.slice():[]),
          blocking:String(setup.blocking||""),handledProps:String(setup.handledProps||""),
          objectStates:String(setup.objectStates||""),notes:String(setup.notes||(legacy?u.notes:"")||""),
        });
      });
      saved.filter(x=>x&&x.orphan).forEach((setup,index)=>{
        rows.push({
          ...setup,id:setup.id,unitKey:u.key,sceneId:setup.sceneId||"",sceneNo:setup.sceneNo,
          spaceName:u.name||l&&l.name||"Location",intExt:u.intExt||"",time:u.time||"",
          sourceSlug:String(setup.sourceSlug||""),sourceKind:String(setup.sourceKind||"orphaned-setup"),
          screenplayExcerpt:String(setup.screenplayExcerpt||""),
          temporaryDressing:Array.isArray(setup.temporaryDressing)?setup.temporaryDressing.slice():[],
          blocking:String(setup.blocking||""),handledProps:String(setup.handledProps||""),
          objectStates:String(setup.objectStates||""),notes:String(setup.notes||""),orphan:true,
          orphanOrder:index+1,
        });
      });
    });
  return rows;
}
function locationCoverageViews(l){
  const stored=Array.isArray(l&&l.coverageViews)?l.coverageViews.filter(Boolean):[];
  if(!stored.length){
    const sig=l&&l.staging&&l.staging.layoutSig;
    const staging={...stagingOf(l||{}),...(sig?{layoutSig:String(sig)}:{})};
    return [{id:"principal",name:staging.viewLabel||((l&&l.name)||"Location")+" principal view",
      purpose:"Reusable establishing view",cameraPosition:"",target:"",visibleAnchors:"",
      lens:staging.lens||"",staging,legacy:true}];
  }
  return stored.map((v,index)=>{
    const raw=v.staging||(index===0&&l&&l.staging)||{};
    const staging=stagingOf({name:(l&&l.name)||"Location",staging:raw});
    const name=String(v.name||staging.viewLabel||("Coverage view "+(index+1)));
    return {...v,id:String(v.id||("view-"+(index+1))),name,
      purpose:String(v.purpose||""),cameraPosition:String(v.cameraPosition||""),
      target:String(v.target||""),visibleAnchors:String(v.visibleAnchors||""),
      lens:String(v.lens||staging.lens||""),
      // the layout it was drafted from survives grid edits (2026-10-12)
      staging:{...staging,viewLabel:name,lens:String(v.lens||staging.lens||""),...(raw.layoutSig?{layoutSig:String(raw.layoutSig)}:{})},legacy:false};
  });
}
function locationProductionPlan(l,units){
  const lkey=locationKeyOf(l);
  const spaces=(Array.isArray(units)?units:[]).filter(u=>u&&!u.orphan&&
    String(u.subspaceKey||u.locationKey||"")===lkey);
  const states=locationAppearanceStates(l,spaces);
  const bounded=(value,max)=>String(value||"").slice(0,max||1600);
  const canon=(value)=>({
    architecture:bounded(value&&value.architecture),materials:bounded(value&&value.materials),
    permanentLighting:bounded(value&&value.lighting),permanentDressing:bounded(value&&value.permanentDressing),
    topology:bounded(value&&value.topology),continuityAnchors:bounded(value&&value.continuityAnchors),
  });
  const parent=locationParentOf(l);
  return {
    schema:"cm-location-plan-v1",
    sharedSetLayout:locationSpatialContract(l),
    // the coordinate model and each plate panel's camera, as Blender Studio's contract reads cameras (2026-10-13)
    coordinates:locationCoordinateExport(l),
    canonicalSet:canon(l),
    continuityRoot:parent?{id:parent.id||null,key:parent.key||null,name:bounded(parent.name,240),
      canonicalSet:canon(parent)}:undefined,
    screenplaySpaces:spaces.map(u=>({key:u.key,assetId:sluglineUnitImageId(u.key),name:u.name,intExt:u.intExt,time:u.time,
      source:screenplaySpaceSourceMeta(u),scenes:(u.sceneNos||[]).slice(),occurrences:(u.occurrences||[]).map((o,i)=>({
        id:screenplayOccurrenceKey(u.key,o,i,u.occurrences),sceneId:o.sceneId,sceneNo:o.sceneNo,
        sourceKind:o.sourceKind||"slugline",sourceSlug:String(o.slug||"").slice(0,240),
        screenplayExcerpt:String(o.scriptText||"").slice(0,720)}))})),
    appearanceStates:states.map(v=>({id:v.id,assetId:locationAppearanceStateAssetId(l,v,spaces),
      unitKey:v.unitKey||null,time:v.time||"",state:v.state||"",
      scenes:(v.linkedUnit&&v.linkedUnit.sceneNos||[]).slice()})),
    requiredSpacePlates:(Array.isArray(l&&l.coverageSheets)?l.coverageSheets:[]).map(v=>({
      id:v.id,assetId:String(l&&l.id||"location")+"-"+String(v.id||"plate"),name:v.name,
      role:v.role||"",scenes:(v.sceneNos||[]).slice(),summary:v.summary||""})),
    coverageViews:locationCoverageViews(l).map(v=>({id:v.id,name:v.name,purpose:v.purpose,
      cameraPosition:v.cameraPosition,target:v.target,visibleAnchors:v.visibleAnchors,lens:v.lens,staging:v.staging,
      ...(v.panel?{panel:v.panel}:{}),...(v.pose?{pose:normalizeLocationCameraPose(v.pose)}:{})})),
    sceneSetups:locationSceneSetups(l,spaces).map(s=>({id:s.id,unitKey:s.unitKey,sceneId:s.sceneId,
      sceneNo:s.sceneNo,occurrenceOrdinal:s.occurrenceOrdinal,occurrenceCount:s.occurrenceCount,
      spaceName:s.spaceName,sourceKind:s.sourceKind,
      sourceSlug:String(s.sourceSlug||"").slice(0,240),screenplayExcerpt:String(s.screenplayExcerpt||"").slice(0,720),
      temporaryDressing:s.temporaryDressing,blocking:s.blocking,handledProps:s.handledProps,
      objectStates:s.objectStates,notes:s.notes,orphan:!!s.orphan})),
  };
}
window.screenplaySpaceSourceMeta=screenplaySpaceSourceMeta;
window.locationSceneSetups=locationSceneSetups;
window.locationCoverageViews=locationCoverageViews;
window.locationProductionPlan=locationProductionPlan;

/* LOCATION ASSET LINEAGE — derived plates stay pinned, but remember the exact
   upstream master/coverage versions they used so a later regeneration can mark
   them out of date without deleting approved pixels. ISO changes on every commit. */
function locationAssetDependencySnapshot(parentId, dependencyIds, kind, metaOf){
  const get = typeof metaOf==="function" ? metaOf
    : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  const parent = get(parentId)||{};
  const upstream = (dependencyIds||[]).map(id=>{ const m=get(id)||{}; return m.iso ? {id,iso:m.iso} : null; }).filter(Boolean);
  return {
    locationDependencyKind:kind||"derived",
    locationParentId:parentId,
    locationParentIso:parent.iso||undefined,
    locationUpstream:upstream.length?upstream:undefined
  };
}
window.locationAssetDependencySnapshot = locationAssetDependencySnapshot;
function locationAssetDependencyChanges(meta, parentId, dependencyIds, metaOf){
  if(!meta) return [];
  const get = typeof metaOf==="function" ? metaOf
    : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  const changed=[];
  const parentNow=get(parentId)||{};
  // No current ISO means there is no version evidence to compare. Once the
  // master is newly generated it gains an ISO, and legacy derived assets with
  // no recorded parent immediately become (correctly conservative) stale.
  if(parentNow.iso && meta.locationParentIso!==parentNow.iso)
    changed.push({id:parentId,kind:"parent"});
  const recorded={};
  (Array.isArray(meta.locationUpstream)?meta.locationUpstream:[]).forEach(r=>{ if(r&&r.id) recorded[r.id]=r.iso||""; });
  (dependencyIds||[]).forEach(id=>{ const now=get(id)||{};
    if(now.iso && recorded[id]!==now.iso) changed.push({id,kind:"upstream"}); });
  return changed;
}
window.locationAssetDependencyChanges = locationAssetDependencyChanges;
/* (2026-10-08, owner — Locations review) A PLATE MADE FROM A PARENT SAYS WHEN THE PARENT CHANGED: a room &
   time, state or extra-space plate (and a room's own plate) records the parent plate it was made from;
   "Parent plate changed" shows when that plate was regenerated since. Only a plate that RECORDED its
   parent is judged (older plates never flag at once), and only once the parent's details have loaded. */
function locationRootIds(l){
  try{ const owner = locationSpatialOwner(l); return (owner && owner.id && owner.id!==l.id) ? [owner.id] : []; }catch(e){ return []; }
}
function locationDerivedPlateChanged(meta, metaOf){
  if(!meta) return false;
  const get = typeof metaOf==="function" ? metaOf : (id)=> (typeof nbGetMeta==="function" ? nbGetMeta(id) : null);
  if(meta.locationParentId && meta.locationParentIso){
    const now = get(meta.locationParentId);
    if(now && now.iso && now.iso!==meta.locationParentIso) return true;
  }
  return (Array.isArray(meta.locationUpstream) ? meta.locationUpstream : []).some(r=>{
    if(!r || !r.id || !r.iso) return false;
    const now = get(r.id); return !!(now && now.iso && now.iso!==r.iso); });
}
/* the written spec a master plate is made from — recorded as meta.locSpecSig; "Description changed" shows
   when the card's text has changed since (only plates that recorded it) */
function locationSpecSig(l){
  const f = ["name","intExt","architecture","materials","lighting","permanentDressing","topology","continuityAnchors","significance","renderStyle","renderStyleKey","negativePrompt"];
  const str = f.map(k=>String((l&&l[k])||"").replace(/\s+/g," ").trim()).join("~");
  let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return "ls1:"+(h>>>0).toString(36)+":"+str.length;
}
function locationSpecChanged(meta, l){
  if(!(meta && meta.locSpecSig && l && meta.locSpecSig!==locationSpecSig(l))) return false;
  // A MERGE RENAMES, IT DOESN'T REDESCRIBE (2026-10-14): a plate made under one of the card's other names (aliases)
  // with the same description is not "Description changed" because the merge gave the card the screenplay's name
  return !(Array.isArray(l.aliases) ? l.aliases.slice(0,8) : []).some(n=>meta.locSpecSig===locationSpecSig({...l, name:n}));
}
window.locationRootIds = locationRootIds;
window.locationDerivedPlateChanged = locationDerivedPlateChanged;
window.locationSpecSig = locationSpecSig;
window.locationSpecChanged = locationSpecChanged;

/* Master-plate spec identity is distinct from the exact model request:
   screenplay-reference instructions are appended at runtime and must not make a
   just-generated plate stale. Keep meta.prompt verbatim for provenance while
   storing/comparing this canonical written-spec prompt separately. */
function locationCanonicalSpecPrompt(mode, sentPrompt, currentSpecPrompt, priorMeta){
  const current=String(currentSpecPrompt||"");
  if(mode==="edit"){
    const prior=(priorMeta&&priorMeta.specPrompt)||(priorMeta&&priorMeta.prompt);
    return String(prior||current);
  }
  if(mode==="final"){
    const sent=String(sentPrompt||"");
    const marker=" REFERENCE IMAGES are attached:";
    const at=sent.indexOf(marker);
    return (at>=0?sent.slice(0,at):sent)||current;
  }
  // Photo/base/simple modes use a purpose-specific request prompt but still
  // represent the location spec currently visible on the card.
  return current;
}
window.locationCanonicalSpecPrompt = locationCanonicalSpecPrompt;
function locationSpecPromptStale(meta,currentSpecPrompt){
  if(!meta) return false;
  const stored=String(meta.specPrompt||meta.prompt||"");
  const current=String(currentSpecPrompt||"");
  if(!stored||!current||stored===current) return false;
  // Backward compatibility for plates generated before specPrompt existed:
  // their prompt is the canonical prompt followed by this known runtime suffix.
  return stored.indexOf(current+" REFERENCE IMAGES are attached:")!==0;
}
window.locationSpecPromptStale = locationSpecPromptStale;

/* SET-DRESSING candidates — deterministic extraction from the unit's OWN action
   prose (never dialogue, never sluglines): screenplay-convention ALL-CAPS object
   mentions plus a curated lexicon of physical set-dressing nouns. Pure derivation
   (skeleton-only): suggestions refresh with the script; the user's curated
   `dressing` list reconciles on top and is what prompts bind. */
const DRESS_LEXICON = ["rack","booth","desk","chair","table","bench","stool","lamp","sign","signage","poster","notice","monitor","screen","tv","television","phone","paper","file","folder","clipboard","cot","bunk","locker","shelf","shelves","cabinet","drawer","crate","box","barrel","drum","bin","dumpster","cart","trolley","truck","van","car","bus","forklift","scaffold","ladder","stair","stairs","railing","fence","gate","chain","wire","cable","pipe","vent","fan","speaker","camera","mirror","curtain","blind","blinds","rug","carpet","mattress","pillow","blanket","tarp","puddle","graffiti","rust","moss","vines","ivy","stain","helmet","vest","radio","key","keys","mug","bottle","can","ashtray","cigarette","candle","clock","calendar","flag","banner","whiteboard","chalkboard","bulletin","urn","kettle","fridge","stove","sink","toilet","shower","towel","bucket","mop","broom","hose","extinguisher","generator","cone","cones","barrier","barricade","turnstile","door","window","awning","billboard","neon","chandelier","bookshelf","book","books","magazine","newspaper","envelope","suitcase","backpack","duffel","umbrella","coat","jacket","boots","gloves","rope","toolbox","wrench","hammer","plank","plywood","sandbag","pallet","pallets"];
const DRESS_CAPS_STOP = new Set(["INT","EXT","EST","DAY","NIGHT","MORNING","EVENING","DAWN","DUSK","NOON","MIDNIGHT","LATER","CONTINUOUS","SAME","MOMENTS","AFTERNOON","TWILIGHT","OS","VO","OC","CU","INTERCUT","CUT","ANGLE","POV","CLOSE","WIDE","SUPER","TITLE","TITLES","END","FADE","IN","OUT","ON","OFF","BACK","TO","THE","AND","THEN","NEXT","OK","OKAY","SCENE","FLASHBACK","MONTAGE","SERIES","EVENTS","PRELAP","SMASH","MATCH","DISSOLVE","WIPE","INSERT","BEAT","NOTE","NOTES","OF"]);
function deriveUnitDressing(actionText, exclude){
  // ON-SCREEN WORDS are not set dressing: a readout or insert ("STATUS: REQUEST DENIED.",
  // "OPERATOR: CARROW, N.") is CAPS by convention and used to crowd the 12 slots with
  // "Request Denied", "Operator", a character's surname… (script.jsx strips the label and
  // the words it shows; spoken or direction labels are left alone)
  const text = (typeof window.screenplayStripScreenText==="function")
    ? window.screenplayStripScreenText(String(actionText||"")) : String(actionText||"");
  if(!text.trim()) return [];
  const out = []; const seen = {};
  const push = (raw)=>{
    const v = String(raw||"").replace(/\s+/g," ").trim().replace(/^[,;:.()\[\]"']+|[,;:.()\[\]"']+$/g,"");
    if(v.length<3 || v.length>40) return;
    const k = v.toLowerCase();
    if(seen[k]) return;
    seen[k] = true; out.push(v);
  };
  // 1) screenplay-convention ALL-CAPS object mentions ("the RACKS shudder") —
  //    but never character names: the same convention capitalizes cast names in
  //    action, so `exclude` (char cues from the scene blocks) vetoes them.
  const capsRe = /\b[A-Z][A-Z0-9'&-]{1,}(?: +[A-Z0-9'&-]{2,}){0,2}\b/g;
  let m; while((m = capsRe.exec(text))){
    const words = m[0].trim().split(/ +/);
    const meaningful = words.filter(w=>!DRESS_CAPS_STOP.has(w.replace(/[.,;:]/g,"")));
    if(!meaningful.length) continue;
    if(exclude){
      if(exclude[m[0].trim().toLowerCase()]) continue;
      if(meaningful.every(w=>exclude[w.replace(/[.,;:]/g,"").toLowerCase()])) continue;
    }
    push(m[0].toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()));
  }
  // 2) lexicon nouns in sentence-case prose ("rain pools around the intake racks")
  const lexRe = new RegExp("\\b("+DRESS_LEXICON.join("|")+")s?\\b","gi");
  while((m = lexRe.exec(text))) push(m[0]);
  return out.slice(0,12);
}
window.deriveUnitDressing = deriveUnitDressing;

function locationSceneText(scene, drafts){
  const bits = [scene&&scene.loc, scene&&scene.title, scene&&scene.summary, scene&&scene.objective, (scene&&_locTurn(scene))];
  const d = drafts && scene && drafts[scene.id];
  if(d && Array.isArray(d.blocks)) d.blocks.forEach(b=>{ if(b && b.text) bits.push(b.text); });
  return bits.filter(Boolean).join(" ").replace(/\s+/g," ").trim();
}
function locationSceneScriptText(scene, drafts){
  if(!scene) return "";
  const d = drafts && drafts[scene.id];
  if(d && Array.isArray(d.blocks) && d.blocks.length){
    return d.blocks.map(b=>{
      const t = String(b&&b.text||"").replace(/\s+/g," ").trim(); if(!t) return "";
      if(b.type==="scene") return t.toUpperCase();
      if(b.type==="char") return "\n"+t.toUpperCase();
      if(b.type==="dia") return "  "+t;
      if(b.type==="paren") return "  ("+t.replace(/^\(|\)$/g,"")+")";
      return t;
    }).filter(Boolean).join("\n");
  }
  return [scene.loc, scene.summary, scene.objective, _locTurn(scene)].filter(Boolean).join("\n");
}
function locationScriptExcerpt(scene, drafts, index, radius){
  const txt = locationSceneScriptText(scene, drafts).replace(/\s+/g," ").trim();
  if(!txt) return "";
  const r = radius || 420;
  const at = Math.max(0, Math.min(Number(index)||0, txt.length));
  const start = Math.max(0, at-r);
  const end = Math.min(txt.length, at+r);
  return (start>0?"... ":"") + txt.slice(start,end).trim() + (end<txt.length?" ...":"");
}
function locationScreenplayContext(l, scenes, drafts, limit){
  const locScenes = (Array.isArray(l&&l.scenes) && l.scenes.length)
    ? (scenes||[]).filter(s=>l.scenes.indexOf(s.id)>=0)
    : (scenes||[]);
  const chunks = locScenes.map(s=>locationSceneScriptText(s, drafts)).filter(Boolean);
  const text = chunks.join("\n\n").replace(/\n{3,}/g,"\n\n").trim();
  const max = limit || 2600;
  return text.length>max ? text.slice(0,max).replace(/\s+\S*$/,"").trim()+" ..." : text;
}
window.locationSceneScriptText = locationSceneScriptText;
window.locationScreenplayContext = locationScreenplayContext;
function locationSceneForCoverageSheet(l, sheet, scenes){
  const nos = Array.isArray(sheet&&sheet.sceneNos) ? sheet.sceneNos.map(Number).filter(Number.isFinite) : [];
  const list = scenes||[];
  if(nos.length){
    const byNo = list.find(s=>nos.indexOf(Number(s.no))>=0);
    if(byNo) return byNo;
  }
  const sid = l && Array.isArray(l.scenes) && l.scenes[0];
  return list.find(s=>s.id===sid) || list[0] || null;
}
function locationScreenplayBlocks(scene, drafts){
  if(!scene) return [];
  const d = drafts && drafts[scene.id];
  if(d && Array.isArray(d.blocks) && d.blocks.length) return d.blocks.map(b=>({ ...b }));
  const out = [];
  if(scene.loc) out.push({ type:"scene", text:scene.loc });
  if(scene.summary) out.push({ type:"action", text:scene.summary });
  if(scene.objective) out.push({ type:"action", text:scene.objective });
  if(_locTurn(scene)) out.push({ type:"action", text:_locTurn(scene) });
  return out;
}
/* ONE SCREENPLAY IMAGE PER SCENE WHEN IT FITS (2026-10-14, owner — "go ahead with all of it"). The layouts are tried in
   order and the first that fits the WHOLE scene on one page wins:
     1. 15 px text on 18 px lines, block spacing halved, 1000×1294;
     2. the same on a taller page, 1000×1500 (still under the 1536 px a page reference is sent at — never shrunk);
     3. 14 px on 17 px lines;
     4. 13 px on 16 px lines — the legibility floor (a provider that scales the short side to ~768 px leaves it ~10 px).
   A scene no layout fits on one page takes the fewest pages any layout allows, on the most legible layout that allows
   them, split EVENLY between blocks: a character cue (and a parenthetical) stays with the lines after it, a page never
   starts with block spacing, and the last page is never a near-empty tail. Parentheticals keep their parentheses.
   The Stage's pages (stage-screenplay-images.js) follow the same table. Glass Hours: all 16 scenes fit one page (14 of
   them used to spill 1–12 lines onto a second, and Furnace's six slots reached only 3 of its 10 scenes). */
const LOC_SCREENPLAY_LAYOUTS = [
  { id:"15px-tight", font:15, lineH:18, spacing:0.5, H:1294 },
  { id:"15px-tall", font:15, lineH:18, spacing:0.5, H:1500 },
  { id:"14px", font:14, lineH:17, spacing:0.5, H:1500 },
  { id:"13px-floor", font:13, lineH:16, spacing:0.4, H:1500 },
];
// a text row's top runs from bodyTop; the body ends bodyBottom above the page's foot (the footer sits below it)
const LOC_SCREENPLAY_PAGE = { W:1000, padX:78, bodyTop:66, bodyBottom:64 };
/* the size every location plate sends its screenplay pages at — the card, the room & time / state / extra-space cards
   and the headless runs alike (a shot's pages go at the same 1536): no layout above is ever shrunk on the way */
const LOC_SCREENPLAY_PAGE_MAX_DIM = 1536;
window.LOC_SCREENPLAY_PAGE_MAX_DIM = LOC_SCREENPLAY_PAGE_MAX_DIM;
function locationScreenplayParen(text){
  const core = String(text==null ? "" : text).replace(/^\s*\(+\s*/,"").replace(/\s*\)+\s*$/,"").trim();
  return core ? "("+core+")" : "";
}
/* a scene's blocks laid out for ONE layout → groups [[{type, before, after, rows:[{text,x,bold,target}]}]] */
function locationScreenplayGroups(blocks, scene, L, sample, targetBeat){
  const font = L.font+"px Courier New, monospace", boldFont = "700 "+font;
  const cfgOf = (type)=> type==="char" ? { x:378, w:220, bold:true, upper:true, before:12, after:0 }
    : type==="dia" ? { x:250, w:390, before:0, after:10 }
    : type==="paren" ? { x:305, w:310, before:0, after:0 }
    : type==="trans" ? { x:650, w:230, upper:true, before:10, after:10 }
    : type==="scene" ? { x:LOC_SCREENPLAY_PAGE.padX, w:760, bold:true, upper:true, before:8, after:12 }
    : { x:LOC_SCREENPLAY_PAGE.padX, w:760, before:8, after:12 };
  const unit = (b)=>{
    const type = String(b&&b.type||"action");
    let text = String(b&&b.text||"").replace(/\s+/g," ").trim();
    if(type==="paren") text = locationScreenplayParen(text);
    if(!text) return null;
    const cfg = cfgOf(type);
    sample.font = cfg.bold ? boldFont : font;
    const words = (cfg.upper ? text.toUpperCase() : text).split(/\s+/);
    const lines = []; let line = "";
    words.forEach(w=>{
      const t = line ? line+" "+w : w;
      if(sample.measureText(t).width > cfg.w && line){ lines.push(line); line = w; }
      else line = t;
    });
    if(line) lines.push(line);
    const target = targetBeat != null && Number.isFinite(targetBeat) && Number(b&&b.beat)===targetBeat;
    return { type, before:Math.round(cfg.before*L.spacing), after:Math.round(cfg.after*L.spacing),
      rows:lines.map(s=>({ text:s, x:cfg.x, bold:!!cfg.bold, target })) };
  };
  const units = [];
  const slug = blocks.find(b=>b && b.type==="scene");
  if(slug){
    /* THE SCENE NUMBER ON THE RIGHT ONLY (2026-10-26, owner): a number in front of "INT." reads to an image model as
       part of the place's name, so the heading starts at INT./EXT. and the number sits at the right edge of its line */
    const u = unit({ ...slug, text:String(slug.text||"").replace(/^\s*\d+[A-Z]?\.?\s+(?=(?:INT|EXT|I\/E|EST)\b)/i,"") });
    if(u && scene && scene.no!=null && u.rows.length) u.rows[0].rightNo = String(scene.no);
    if(u) units.push(u);
  }
  blocks.forEach(b=>{ if(slug && b===slug) return; const u = unit(b); if(u) units.push(u); });
  const groups = [];
  units.forEach((u,i)=>{
    const prev = units[i-1];
    if(prev && groups.length && /^(char|paren)$/.test(prev.type) && /^(paren|dia)$/.test(u.type)) groups[groups.length-1].push(u);
    else groups.push([u]);
  });
  return groups;
}
/* page packing — the same in stage-screenplay-images.js. items [{h, before, after}]: a page holds a run of items whose
   heights add up to at most cap, less the first one's spacing before and the last one's after. Filling each page in
   turn gives the fewest pages; the smallest cap that keeps that count gives EVEN pages. null: an item fits no page. */
function locationScreenplayPack(items, cap){
  const pages = []; let cur = null;
  for(let i=0;i<items.length;i++){
    const it = items[i];
    if(it.h-it.before-it.after > cap) return null;
    if(cur && cur.sum+it.h-cur.before-it.after <= cap){ cur.items.push(i); cur.sum += it.h; }
    else{ cur = { items:[i], sum:it.h, before:it.before }; pages.push(cur); }
  }
  return pages.map(p=>p.items);
}
function locationScreenplayBalance(items, usable){
  const first = locationScreenplayPack(items, usable);
  if(!first || first.length<=1) return first;
  let lo = 0, hi = usable;
  while(hi-lo>1){
    const mid = Math.floor((lo+hi)/2), p = locationScreenplayPack(items, mid);
    if(p && p.length<=first.length) hi = mid; else lo = mid;
  }
  return locationScreenplayPack(items, hi);
}
/* the layout a scene's pages use → { layout, pages:[[unit (its first before dropped)…]] } */
function locationScreenplayLayout(blocks, scene, sample, targetBeat){
  const P = LOC_SCREENPLAY_PAGE;
  let best = null;
  for(const L of LOC_SCREENPLAY_LAYOUTS){
    const usable = L.H-P.bodyTop-P.bodyBottom;
    const hOf = (g)=> g.reduce((n,u)=>n+u.before+u.rows.length*L.lineH+u.after, 0);
    // a group taller than a whole page (a very long paragraph) is split between its rows
    const groups = [];
    locationScreenplayGroups(blocks, scene, L, sample, targetBeat).forEach(g=>{
      if(hOf(g)-g[0].before-g[g.length-1].after <= usable){ groups.push(g); return; }
      g.forEach(u=>u.rows.forEach((r,i)=>groups.push([{ type:u.type, before:i ? 0 : u.before,
        after:i===u.rows.length-1 ? u.after : 0, rows:[r] }])));
    });
    const pages = locationScreenplayBalance(groups.map(g=>({ h:hOf(g), before:g[0].before, after:g[g.length-1].after })), usable);
    if(!pages) continue;
    if(!best || pages.length<best.pages.length) best = { L, groups, pages };
    if(pages.length===1) break;
  }
  if(!best) return null;
  return { layout:best.L, pages:best.pages.map(idx=>{
    const units = [];
    idx.forEach(i=>best.groups[i].forEach(u=>units.push(units.length ? u : { ...u, before:0 })));
    return units;
  }) };
}
const _locPageCountLayouts = new Map();   // scene number | target beat | its blocks → the layout (counts only)
function locationScreenplayReferenceImages(l, sheet, scenes, drafts, options){
  const renderOpts = options || {};
  if(typeof document==="undefined") return [];
  const selectedSceneId = renderOpts.sceneId != null ? renderOpts.sceneId : renderOpts.selectedSceneId;
  const scene = renderOpts.scene || ((selectedSceneId != null)
    ? (scenes||[]).find(s=>s && String(s.id)===String(selectedSceneId)) : null)
    || locationSceneForCoverageSheet(l, sheet, scenes);
  const blocks = locationScreenplayBlocks(scene, drafts);
  if(!blocks.length) return [];
  const targetBeatValue = renderOpts.targetBeat == null ? renderOpts.highlightBeat : renderOpts.targetBeat;
  const targetBeat = targetBeatValue == null ? null : Number(targetBeatValue);
  /* a count is read on every render (the Generate prices, 2026-10-14): the same scene text is laid out once */
  const countKey = renderOpts.countOnly ? String(scene&&scene.no)+"|"+targetBeat+"|"+JSON.stringify(blocks) : "";
  let laid = countKey ? _locPageCountLayouts.get(countKey) : undefined;
  if(laid===undefined){
    const measureCanvas = document.createElement("canvas");
    let sample = measureCanvas && typeof measureCanvas.getContext==="function" ? measureCanvas.getContext("2d") : null;
    if(!sample || typeof sample.measureText!=="function") sample = { font:"15px", measureText(t){   // no canvas metrics: Courier's 0.6 em
      const m = String(this.font).match(/(\d+(?:\.\d+)?)px/); return { width:String(t).length*0.6*(m ? Number(m[1]) : 15) }; } };
    laid = locationScreenplayLayout(blocks, scene, sample, targetBeat);
    if(countKey){ if(_locPageCountLayouts.size>=300) _locPageCountLayouts.clear(); _locPageCountLayouts.set(countKey, laid); }
  }
  if(!laid) return renderOpts.returnMeta || renderOpts.countOnly ? { images:[], pageCount:0, renderedPageCount:0, omittedPages:0,
    targetBeat, sceneId:scene&&scene.id||"", pageLimit:0 } : [];
  const L = laid.layout, pages = laid.pages, P = LOC_SCREENPLAY_PAGE;
  const W = P.W, H = L.H, padX = P.padX, lineH = L.lineH;
  const font = L.font+"px Courier New, monospace", boldFont = "700 "+font;
  const sceneNo = scene&&scene.no!=null ? scene.no : "";
  const contextLabel = renderOpts.contextLabel || renderOpts.label;
  const title = (contextLabel ? String(contextLabel)+" — " : "")
    +"SCENE "+sceneNo+" - "+(((scene&&scene.title)||((l&&l.name)||"LOCATION"))).toUpperCase();
  const pageLimit = renderOpts.pageLimit == null ? 6
    : Math.max(0,Number(renderOpts.pageLimit)||0);
  const meta = (imgs)=>({
    images:imgs, pageCount:pages.length, renderedPageCount:imgs.length,
    omittedPages:Math.max(0,pages.length-imgs.length), targetBeat,
    sceneId:scene&&scene.id||"", pageLimit,
    layout:L.id, pageWidth:W, pageHeight:H, fontPx:L.font, lineHeight:lineH
  });
  // (2026-10-14) how many pages the scene takes, without drawing them (the reference counts and whole-scene slots)
  if(renderOpts.countOnly) return meta([]);
  const baseline = Math.round(lineH*0.78);
  const imgs = pages.slice(0,pageLimit).map((items,pi)=>{
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"); if(!ctx) return "";
    ctx.fillStyle = "#f4f0e6"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#151515"; ctx.font = "700 15px Courier New, monospace";
    ctx.fillText(title.slice(0,86), padX, 42);
    ctx.fillText(String(pi+1), W-padX-8, 42);
    if(targetBeat != null && Number.isFinite(targetBeat)){
      ctx.fillStyle = "#76621f"; ctx.font = "700 11px Courier New, monospace";
      ctx.fillText(String(renderOpts.targetLabel||"TARGET BEAT OPENING")+" — BEAT "+targetBeat, padX, 57);
    }
    let y = P.bodyTop;
    items.forEach(u=>{
      y += u.before;
      u.rows.forEach(r=>{
        if(r.target){
          ctx.fillStyle = "#ead58b";
          ctx.fillRect(padX-16, y-1, W-padX*2+16, lineH+2);
        }
        ctx.font = r.bold ? boldFont : font;
        ctx.fillStyle = "#151515";
        ctx.fillText(r.text, r.x, y+baseline);
        if(r.rightNo){ ctx.textAlign = "right"; ctx.fillText(r.rightNo, W-padX, y+baseline); ctx.textAlign = "left"; }
        y += lineH;
      });
      y += u.after;
    });
    ctx.fillStyle = "#8a8177"; ctx.font = "12px Courier New, monospace";
    ctx.fillText((contextLabel ? String(contextLabel)+" — " : "")
      +"FULL SCENE SCREENPLAY SNAPSHOT - WRITERS' ROOM TEXT", padX, H-34);
    ctx.fillText("PAGE "+(pi+1)+" OF "+pages.length, W-padX-92, H-34);
    try{ return canvas.toDataURL("image/png"); }catch(e){ return ""; }
  }).filter(Boolean);
  if(renderOpts.returnMeta) return meta(imgs);
  return imgs;
}
function locationScreenplayReferenceImage(l, sheet, scenes, drafts){
  const imgs = locationScreenplayReferenceImages(l, sheet, scenes, drafts);
  return imgs[0] || "";
}
window.locationSceneForCoverageSheet = locationSceneForCoverageSheet;
window.locationScreenplayReferenceImages = locationScreenplayReferenceImages;
window.locationScreenplayReferenceImage = locationScreenplayReferenceImage;
function locationMasterPanelPlan(l, scenes, drafts){
  const sheets = (typeof deriveLocationCoverageSheets==="function") ? deriveLocationCoverageSheets(l, scenes||[], drafts||{}) : [];
  /* Slugline units supersede legacy side coverage sheets, so sheets alone can no
     longer tell us whether the master location spans INT + EXT. Read the current
     screenplay units too: they are the source of truth for explicitly slugged
     spaces and preserve the scene-specific TOD separately from this neutral master. */
  const units = (typeof deriveSluglineUnits==="function")
    ? deriveSluglineUnits(scenes||[], drafts||{}).filter(u=>u && String(u.locationKey||"")===String(l.key||""))
    : [];
  const roles = sheets.map(s=>String(s.role||"").toUpperCase())
    .concat(units.map(u=>String(u.intExt||"").toUpperCase()));
  const mixed = roles.indexOf("INT")>=0 && roles.indexOf("EXT")>=0;
  if(!mixed) return null;
  const ordered = units.length ? units : sheets;
  const firstRole = String((ordered[0]&&(ordered[0].intExt||ordered[0].role))||"EXT").toUpperCase();
  const extName = (units.find(u=>String(u.intExt).toUpperCase()==="EXT")
    || sheets.find(s=>String(s.role).toUpperCase()==="EXT")||{}).name || ((l&&l.name)||"Location")+" Exterior";
  const intName = (units.find(u=>String(u.intExt).toUpperCase()==="INT")
    || sheets.find(s=>String(s.role).toUpperCase()==="INT")||{}).name || ((l&&l.name)||"Location")+" Interior";
  /* THE PANELS IN THIS PLACE'S OWN WORDS (owner 2026-10-27): the template's "desk/terminal/counter" and "windows,
     glass, booth walls" made a ship's car deck grow a counter and its upper deck a glazed shelter. Each panel now
     names what the shared layout puts there; with no layout, the screenplay's own feature, never a list of guesses. */
  let anchors = [];
  try{ anchors = (locationSpatialImageContract(l).anchors||[]).filter(a=>a && a.name); }catch(e){}
  const inRoom = (name)=>{ const k = _locNameKey(name); return anchors.filter(a=>_locNameKey(a.space)===k); };
  const short = (a)=> String(a.name||"").split(/[,;(]/)[0].trim();
  const list = (xs)=> xs.slice(0,3).map(short).join(", ");
  const WAY = /\b(door|doorway|stair|stairs|hatch|ramp|gate|companionway|ladder|opening|arch|passage|window)\b/i;
  // a way BETWEEN the two: its words name the other space, another way, or a stair (the stern ramp leads to the quay)
  const shortKey = (n)=>{ const parts = String(n||"").split(/\s[-\u2013\u2014]\s/); return _locNameKey(parts.length>1 ? parts.slice(1).join(" ") : n); };
  const allWays = [...inRoom(intName), ...inRoom(extName)].filter(a=>WAY.test(a.name||""));
  const ways = allWays.filter(a=>{ const t = " "+_locNameKey((a.name||"")+" "+(a.where||""))+" ", other = shortKey(_locNameKey(a.space)===_locNameKey(intName) ? extName : intName);
    return (other && t.indexOf(" "+other+" ")>=0) || /\b(stair|stairs|companionway|hatch|ladder)\b/i.test(t)
      || allWays.some(b=>b!==a && b.id && String(a.where||"").indexOf(b.id)>=0); });
  const intStation = inRoom(intName).filter(a=>!WAY.test(a.name||""));
  const extStation = inRoom(extName).filter(a=>!WAY.test(a.name||""));
  const threshold = ways.length
    ? "the way between "+extName+" and "+intName+" as the layout sets it ("+list(ways)+") \u2014 its approach path and eyelines line up with the other panels"
    : "the doorway, opening or approach the screenplay uses between "+extName+" and "+intName+" \u2014 its approach path and eyelines line up with the other panels";
  const rule = "the four panels are one coherent real location with matched scale, materials, light direction and geography; no actors, no action, no lettering beyond what the spec quotes";
  // the rooms the panels show, for the builder only (not enumerable: never in the prompt's views)
  const withRooms = (plan)=>Object.defineProperty(plan, "rooms", { value:[intName, extName], enumerable:false });
  if(firstRole==="INT") return withRooms({
    layout: "exactly 4 views in a 2x2 grid, planned from the screenplay's first playable space",
    top_left: "INTERIOR establishing view of "+intName+" because the action starts inside — show the empty working room, floor, walls, openings and usable blocking space — in three-quarter from a corner, never straight-on",
    top_right: intStation.length
      ? "INTERIOR closer view of "+intName+" where the first business plays: "+list(intStation)+", placed as the layout says"
      : "INTERIOR closer view of "+intName+" where the first business plays: the fixture or working area the screenplay names there",
    bottom_left: "EXTERIOR context of "+extName+(extStation.length ? " ("+list(extStation)+")" : "")+" seen from the connected approach or through the relevant opening, matching the interior's sightlines",
    bottom_right: "THRESHOLD CONNECTION view: "+threshold,
    rule,
  });
  return withRooms({
    layout: "exactly 4 views in a 2x2 grid, planned from the screenplay's first playable space",
    top_left: "EXTERIOR wide establishing view of "+extName+" because the scene opens outside — show the whole playable geography, approach, ground plane and permanent major landmarks in neutral continuity conditions — in three-quarter from a corner, never straight-on",
    top_right: "EXTERIOR-to-INTERIOR relationship view: "+threshold,
    bottom_left: "INTERIOR establishing view of "+intName+" — the empty room/subspace the script later plays inside, with working surfaces and openings",
    bottom_right: (intStation.length || extStation.length)
      ? "closer view of the feature the action uses: "+list(intStation.length ? intStation : extStation)+", placed as the layout says"
      : "closer view of the feature the screenplay's action uses here, as the screenplay names it",
    rule,
  });
}
window.locationMasterPanelPlan = locationMasterPanelPlan;
function _locSheetId(role, name){
  const k = locSlug(name).split("-").slice(0,4).join("-") || role.toLowerCase();
  return "cov-"+role.toLowerCase()+"-"+k;
}
function _locSideCueIndex(text, role){
  const s = String(text||"");
  const re = role==="INT"
    ? /\b(inside|interior|within|booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter|console|lamp)\b/i
    : /\b(outside|exterior|facade|front|street|yard|parking|rain|pavement|road|approach|rack|racks)\b/i;
  const i = s.search(re);
  return i>=0 ? i : 999999;
}
function deriveLocationCoverageSheets(l, scenes, drafts, allLocations, units){
  if(!l) return [];
  /* Child spaces already have a canonical child plate plus one shared plate per
     screenplay/Time-of-Day Variant. They must not derive a second Coverage View —
     especially a misleading "Kitchen Exterior" that is really the enclosing
     house facade. Cross-subspace geography and exterior context belong to the
     continuity root. Implied, unslugged spaces may still become Coverage Views
     on that root below. */
  if(l.parentKey) return [];
  /* A sub-space sheet is a STAND-IN for a space the screenplay never slugged. Once that
     space earns a real slugline it gets its own location card, plate and coverage — and
     deriving a sheet for it too would mean designing the same booth twice, from two
     records that can drift apart. Skip any sub-space that is now a location. */
  const _allLocs = Array.isArray(allLocations) ? allLocations
    : (((window.turnContinuity||{}).locations) || []);
  const _units = units || ((window.turnContinuity||{}).sluglineUnits) || [];
  const _isRealLocation = (nm)=>{
    const n = String(nm||"").trim().toLowerCase();
    if(!n) return false;
    return _allLocs.some(x=> x && x.id!==l.id && String(x.name||"").trim().toLowerCase()===n)
      /* a slugged child space has its own inherited workspace and unit, so a
         stand-in coverage sheet must not be derived for it as well. */
      || _units.some(u=> u && !u.orphan && String(u.place||u.name||"").trim().toLowerCase()===n);
  };
  const clean = (s,n)=>{ const x=String(s||"").replace(/\s+/g," ").trim();
    return (typeof clipWords==="function") ? clipWords(x,n||180) : x.slice(0,n||180); };
  const locScenes = (Array.isArray(l.scenes) && l.scenes.length)
    ? (scenes||[]).filter(s=>l.scenes.indexOf(s.id)>=0)
    : (scenes||[]);
  const sceneTexts = locScenes.map((s,i)=>{
    const script = locationSceneScriptText(s, drafts);
    const bodyScan = locationScreenplayBlocks(s, drafts).filter(b=>b&&b.type!=="scene").map(b=>b.text).join(" ").replace(/\s+/g," ").trim();
    const prose = locationSceneText(s, drafts);
    return { scene:s, i, text:prose, script, bodyScan, scan:script || prose };
  });
  const text = sceneTexts.map(s=>s.scan).join(" ").replace(/\s+/g," ").trim();
  if(!text) return [];
  const baseName = l.name || "Location";
  const out = [];
  const add = (role, name, summary, triggers, order, scene, scriptExcerpt)=>{
    const id = _locSheetId(role, name);
    const sceneNo = scene && scene.no;
    const existing = out.find(v=>v.id===id);
    if(existing){
      if(Number(order)<Number(existing.order||999999)) existing.order = order;
      if(scriptExcerpt && !existing.scriptExcerpt) existing.scriptExcerpt = clean(scriptExcerpt,720);
      if(sceneNo!=null && existing.sceneNos.indexOf(sceneNo)<0) existing.sceneNos.push(sceneNo);
      return;
    }
    out.push({ id, role, name:clean(name,64), summary:clean(summary,260), order:Number(order)||0,
      sceneNos: sceneNo!=null ? [sceneNo] : [],
      scriptExcerpt: clean(scriptExcerpt,720),
      triggerWords:Array.from(new Set((triggers||[]).map(x=>String(x||"").toLowerCase()).filter(Boolean))).slice(0,10),
      fromScript:true });
  };
  const intExt = String(l.intExt||"").toUpperCase();
  const mentionsSubspace = /\b(?:inside|within|in)\s+(?:the\s+|a\s+|an\s+)?[A-Za-z0-9'’ -]{2,44}?\b(?:booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter)\b/i.test(text)
    || (/\bbooth\b/i.test(text) && /\b(?:glass|window|terminal|desk|counter|keyboard|monitor|console|lamp)\b/i.test(text));
  const mixedSides = intExt==="INT/EXT" || (/(^|\/)INT(\/|$)/.test(intExt) && /(^|\/)EXT(\/|$)/.test(intExt)) || mentionsSubspace;
  sceneTexts.forEach(entry=>{
    const s = entry.scene;
    const baseOrder = entry.i * 100000;
    const parsed = parseSlugline(s&&s.loc);
    const sceneRole = String(parsed&&parsed.intExt||intExt).toUpperCase();
    const body = entry.bodyScan || entry.scan || "";
    const firstInt = _locSideCueIndex(body, "INT");
    const firstExt = _locSideCueIndex(body, "EXT");
    const cueOrder = (role)=>{
      const own = role==="INT" ? firstInt : firstExt;
      const other = role==="INT" ? firstExt : firstInt;
      if(own<999999) return baseOrder + own + 1;
      // A slugline side still needs a sheet, but if the first playable action cues
      // the opposite side, let that opposite side lead the list.
      if(other<999999) return baseOrder + other + 2;
      return baseOrder + (role==="EXT" ? 0 : 1);
    };
    /* UNITS TAKE PRECEDENCE: a slugline unit already covers this master+side as a
       real SLUGGED space (with its own time bucket and Time-of-Day Variant) — deriving
       an INT/EXT side sheet for it too would design the same side twice from two
       records that can drift apart. Sheets remain for IMPLIED, unslugged spaces. */
    const _unitCovers = (role)=> _units.some(x=> x && !x.orphan
      && (l.parentKey ? String(x.subspaceKey||"")===String(l.key||"") : String(x.locationKey||"")===String(l.key||""))
      && String(x.intExt||"").toUpperCase()===role);
    if(mixedSides && /EXT/.test(sceneRole) && !_unitCovers("EXT")){
      add("EXT", baseName+" Exterior",
        "Exterior side required by the screenplay: render the empty outside of "+baseName+" with its approach, openings, weather, ground plane and sightline toward any interior side named by the scene.",
        ["outside","exterior","facade","front","street","yard","rain","window","glass"],
        cueOrder("EXT"), s, locationScriptExcerpt(s, drafts, firstExt<999999?firstExt:0));
    }
    if(mixedSides && /INT/.test(sceneRole) && !_unitCovers("INT")){
      add("INT", baseName+" Interior",
        "Interior side required by the screenplay: render the empty inside of "+baseName+" with the working areas, fixtures, openings and sightlines the scene plays through.",
        ["inside","interior","room","booth","window","glass","terminal","desk","counter"],
        cueOrder("INT"), s, locationScriptExcerpt(s, drafts, firstInt<999999?firstInt:0));
    }
    const insideM = entry.scan.match(/\b(?:inside|within|in)\s+(?:the\s+|a\s+|an\s+)?([A-Za-z0-9'’ -]{2,44}?\b(?:booth|room|office|building|kiosk|cab|cabin|car|vehicle|lobby|hall|shop|store|terminal|control room|desk|counter))\b/i);
    const throughGlass = /\b(?:through|behind|inside|beyond)\s+(?:the\s+)?(?:glass|window|windshield|door|booth glass)\b/i.test(entry.scan);
    const boothish = /\bbooth\b/i.test(entry.scan);
    const terminalish = /\bterminal|desk|counter|keyboard|monitor|console|lamp\b/i.test(entry.scan);
    if((/EXT/.test(sceneRole) || /EXT/.test(intExt)) && (insideM || (boothish && (throughGlass || terminalish)))){
      const hitIndex = insideM ? insideM.index : Math.max(0, entry.scan.search(/\bbooth\b/i));
      /* the capture's {2,44} minimum pulls the ARTICLE in with the noun ("inside the
         booth" captures "the booth"), which produced sheets named "Intake The Booth" —
         wrong on the card, and it stopped the real-location check below from matching. */
      const sub = (insideM ? tidyPlace(insideM[1]) : (boothish ? "Booth" : "Interior"))
        .replace(/^(?:The|A|An)\s+/i, "").trim();
      const name = /intake/i.test(baseName) && !/intake/i.test(sub) ? ("Intake "+sub) : sub;
      // it has its own card now — don't design it twice (gate ONLY this add: a `return`
      // here would also skip the exterior-cue sheet later in this same iteration)
      if(!_isRealLocation(name)) add("INT", name+" Interior",
        "Interior coverage required by the screenplay even if the prose only names the space: action plays inside "+name+" while the parent scene is staged from "+baseName+". Infer the empty interior from the screenplay page, the parent exterior, working surfaces, glass/window relationship, controls and sightline to the exterior.",
        ["inside","interior","booth","glass","window","terminal","desk","counter","console"],
        baseOrder + hitIndex + 1, s, locationScriptExcerpt(s, drafts, hitIndex));
    }
    const exteriorCueIdx = entry.scan.search(/\b(?:outside|exterior|facade|front|street|yard|parking|through\s+(?:the\s+)?window|through\s+(?:the\s+)?glass)\b/i);
    /* unit precedence applies here too: a slugged EXT unit already covers this
       master's exterior — the cue (often just the place name echoed inside the
       scene's own slugline) must not duplicate it as a stand-in sheet. */
    if(/INT/.test(sceneRole) && exteriorCueIdx>=0 && !_unitCovers("EXT")){
      add("EXT", baseName+" Exterior",
        "Exterior coverage required by the screenplay: the scene looks out from the interior or cuts to the outside of this place. Render the empty exterior/facade, approach, openings and sightline back toward the interior.",
        ["outside","exterior","facade","front","street","yard","window","glass"],
        baseOrder + exteriorCueIdx + 1, s, locationScriptExcerpt(s, drafts, exteriorCueIdx));
    }
  });
  return out.sort((a,b)=>(Number(a.order||0)-Number(b.order||0)) || String(a.name).localeCompare(String(b.name)));
}
window.locationSceneText = locationSceneText;
window.deriveLocationCoverageSheets = deriveLocationCoverageSheets;

/* IMPLIED ENCLOSED SPACES — the shared detector.
   A scene often plays partly inside a space the page never slugs ("Behind the booth
   glass, ODESSA…", "Inside the booth, Odessa kills the lamp"). That space is a real set
   — its own walls, light and geography — but because locations DERIVE FROM SLUGLINES it
   gets no card, no plate and no coverage. The fix belongs in the screenplay: slug it.
   Deterministic on purpose — the Script Supervisor that consumes this is the FREE tier
   and makes no model calls — and shared so the Writers' Room and the Art Room can never
   disagree about what counts as an implied space.
   Returns [{ name, role, time, evidence, atIndex, noun }], atIndex = the FIRST block that
   plays inside, i.e. where the slugline belongs. Spaces already slugged are excluded. */
const IMPLIED_SPACE_NOUNS = ("booth|cab|cabin|car|van|truck|trailer|container|cockpit|control room|kiosk|cell|closet|"+
  "vault|elevator|lift|wheelhouse|confessional|airlock|hayloft|shed|tent|garage|basement|attic|kitchen|bathroom|"+
  "stairwell|corridor|tunnel|cage|pen|stall|pod|capsule|carriage|compartment|galley|berth|office|room|hall|lobby|"+
  "shop|store|booth window|ticket window|guard house|guardhouse|cupboard|pantry|cellar");
function findImpliedSpaces(scene, blocks){
  const out = [];
  if(!scene || !Array.isArray(blocks) || !blocks.length) return out;
  const parent = (typeof parseSlugline==="function") ? parseSlugline(scene.loc) : { place:String(scene.loc||""), time:"", intExt:"INT" };
  const parentPlace = String((parent&&parent.place)||"").toUpperCase();
  const time = (parent && parent.time) || "";
  // every place ALREADY slugged in this scene (parent + any secondary slugline)
  const slugged = new Set([parentPlace]);
  blocks.forEach(b=>{ if(b && b.type==="scene" && b.text){
    const p = (typeof parseSlugline==="function") ? parseSlugline(b.text) : null;
    if(p && p.place) slugged.add(String(p.place).toUpperCase());
  }});
  const NOUN = IMPLIED_SPACE_NOUNS;
  const reInside = new RegExp("\\b(?:inside|within)\\s+(?:the\\s+|a\\s+|an\\s+)?([a-z0-9'\u2019 -]{0,26}?\\b(?:"+NOUN+"))\\b","i");
  const reBehind = new RegExp("\\bbehind\\s+the\\s+([a-z0-9'\u2019 -]{0,26}?\\b(?:"+NOUN+"))\\s+(?:glass|window|screen|door|counter)\\b","i");
  const seen = new Set();
  blocks.forEach((b, i)=>{
    if(!b || b.type!=="action" || !b.text) return;
    const t = String(b.text);
    const m = reInside.exec(t) || reBehind.exec(t);
    if(!m) return;
    let noun = String(m[1]||"").replace(/\s+/g," ").trim();
    if(!noun) return;
    // a BARE generic noun ("booth") reads better qualified by its parent place
    // ("INTAKE BOOTH") — but never double it up when the modifier is already there
    let name = noun.toUpperCase();
    const bare = noun.split(/\s+/).length===1;
    const parentHead = parentPlace.split(/\s+/)[0] || "";
    if(bare && parentHead && name.indexOf(parentHead)<0 && parentHead.length>2) name = parentHead+" "+name;
    if(slugged.has(name) || seen.has(name)) return;
    seen.add(name);
    out.push({ name, role:"INT", time, noun,
      evidence: t.replace(/\s+/g," ").trim().slice(0,180), atIndex:i });
  });
  return out;
}
function impliedSpaceSlugline(sp){
  return "INT. "+String((sp&&sp.name)||"INTERIOR").toUpperCase()+((sp&&sp.time)?(" - "+String(sp.time).toUpperCase()):"");
}
window.IMPLIED_SPACE_NOUNS = IMPLIED_SPACE_NOUNS;
window.findImpliedSpaces = findImpliedSpaces;
window.impliedSpaceSlugline = impliedSpaceSlugline;

/* true when the screenplay has any parseable scene-heading anchor we can pull into
   the tab. Implied side spaces still hang off those anchors as coverage sheets. */
function scriptHasLocations(scenes){ return (scenes||[]).some(s=> !!parseSlugline(s.loc)); }
window.scriptHasLocations = scriptHasLocations;

/* ---- THE PROMPT BUDGET OF A LOCATION PLATE (2026-10-14, owner — "go ahead with all of it") ----
   A GPT Image 2.5 plate of 33,577 characters was refused by its engine (fal stops at 32,000). Each engine now has its
   own limit (pricing.jsx TURN_IMAGE_PROMPT_LIMITS = the server's IMAGE_PROMPT_LIMITS) and the builders fit under it by
   themselves. FREE, ALWAYS: the JSON spec without indentation; the AVOID list once (locationAvoidText — the default
   negative prompt already carries the character negative that used to be added a second time); the screenplay as
   page images OR as text, never both (locationScreenplayPointer: with its pages attached, the text becomes a short
   pointer to them). THEN, only while the prompt is still longer than its engine takes, the fixed order of
   locationFitPromptSpec. NEVER CUT: the task line, each panel's camera line and what it sees through its openings
   (views), the binding fixed landmarks (fixtures, LOCKED continuity anchors, the shared layout's objects, frame and
   floor plan), the render style and empty-set rules, the AVOID list, and the "REFERENCE IMAGES are attached:" list
   that follows the prompt. proxyGenerate repeats the same order on the finished prompt (imagegen.jsx
   nbFitImagePrompt) and, past it, cuts the middle rather than failing — nobody is asked to shorten a prompt. */
const LOC_PROMPT_DEFAULT_MAX = 30000;    // the smallest engine's limit, when the engine isn't known
const LOC_PROMPT_TAIL_RESERVE = 2500;    // room for the reference list that follows the prompt, before it is known
const LOC_CONVENTION_SHORT = "metres, +Z up, +Y = the frame's facing (north), +X east; yaw in degrees clockwise from north; pitch above the horizontal; lens in mm on a 36 mm sensor";
/* how long a location prompt may be: its engine's limit (opts.maxChars, else the engine opts.model or the picked one),
   less the room kept for what follows it (opts.reserve — the reference list, the AVOID list) */
function locationPromptBudget(opts){
  const o = opts || {};
  const max = Number(o.maxChars)>0 ? Number(o.maxChars)
    : (typeof window.nbPromptMaxChars==="function" ? window.nbPromptMaxChars(o.model||"") : LOC_PROMPT_DEFAULT_MAX);
  const reserve = o.reserve!=null && Number(o.reserve)>=0 ? Number(o.reserve) : LOC_PROMPT_TAIL_RESERVE;
  return Math.max(4000, max - reserve);
}
/* one AVOID list from several comma lists: each term once (case-insensitive), in first-seen order */
function locationAvoidText(...lists){
  const seen = new Set(), out = [];
  // (2026-10-27) never captioned panels
  lists = lists.concat(["panel titles, view labels, captions, annotations, text overlays"]);
  lists.forEach(x=>String(x||"").split(/\s*,\s*/).forEach(t=>{
    const term = t.replace(/\s+/g," ").trim().replace(/\.$/,"").trim(), k = term.toLowerCase();
    if(term && !seen.has(k)){ seen.add(k); out.push(term); } }));
  return out.join(", ");
}
/* the screenplay as page images OR as text, never both: with its pages attached (pages = their numbers in the
   reference list, or a count), the screenplay text becomes this pointer */
function locationScreenplayPointer(pages){
  const nums = Array.isArray(pages) ? pages.map(Number).filter(n=>n>0) : [];
  const n = nums.length || (Number(pages)>0 ? Math.floor(Number(pages)) : 0);
  if(!n) return "";
  const run = nums.length>1 && nums.every((x,i)=>!i || x===nums[i-1]+1);
  const which = !nums.length ? n+" screenplay page image"+(n===1 ? "" : "s")
    : nums.length===1 ? "Image "+nums[0] : run ? "Images "+nums[0]+"–"+nums[nums.length-1] : "Images "+nums.join(", ");
  return "the screenplay of these scenes is attached as page images ("+which+") — read it there; it is not repeated here";
}
/* PAGES OR TEXT, PER SCENE (2026-10-14, final consistency pass): a plate attaches whole scenes only, in the reference
   slots its other references leave (locationScriptPageRefs), so a location with more scenes than slots (Glass Hours'
   Furnace: 10 scenes, 5 attached) used to send the rest in no form at all — the pointer above stood for the whole
   screenplay. The scenes whose pages are NOT attached (attachedSceneIds: the scene ids of the attached pages) go as
   text, never both and never neither: one entry per scene, in story order, each given a fair share of the limit
   (its heading and the opening of its action), so every left-out scene is there. [] when every scene rides as pages,
   or the attached scenes aren't known.
   HOW MUCH TEXT EACH LEFT-OUT SCENE GETS (2026-10-14, headless paths — it was ~520 characters each for Furnace's five,
   ~120 once trimmed):
     · a FAIR share, not an equal one (_locShareCut): a scene shorter than its share keeps all of itself and the room it
       doesn't use goes to the longer ones;
     · 2,600 characters in all to start with (LOC_UNATTACHED_TEXT_BASE). When the whole prompt fits its engine with
       nothing trimmed, the scenes get the room it has left, up to 6,000 characters in all (LOC_UNATTACHED_TEXT_MAX —
       Furnace's five: about 1,200 each, most of each scene) — never more than the prompt's budget, and never at the
       cost of anything else in it;
     · when the prompt is too long, the fixed trimming order is unchanged (locationFitPromptSpec): step 6 cuts them only
       as far as the prompt needs, never below ~600 characters in all, before step 7; step 8 may shorten them further.
   The builders hand the uncut texts to locationFitPromptSpec (extra.notAttachedFull) for that. */
const LOC_UNATTACHED_TEXT_BASE = 2600, LOC_UNATTACHED_TEXT_MAX = 6000;
/* onlyRooms (2026-10-27): the rooms the plate's four panels show — a scene set in another room of the place (the
   ship's Stern Deck or Bow, when the panels show the CAR Deck and the Upper Deck) is left out: its text only invited
   things no panel shows */
function locationUnattachedScreenplayTexts(l, scenes, drafts, attachedSceneIds, onlyRooms){
  if(!Array.isArray(attachedSceneIds) || !attachedSceneIds.length) return [];
  const got = new Set(attachedSceneIds.map(String));
  const own = new Set(((Array.isArray(l && l.scenes) && l.scenes.length) ? l.scenes : []).map(String));
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder : (x=>x||[]);
  const rest = order((scenes||[]).filter(s=>s && own.has(String(s.id)) && !got.has(String(s.id))));
  const texts = rest.map(s=>String(locationSceneScriptText(s, drafts)||"").replace(/\n{3,}/g,"\n\n").trim()).filter(Boolean);
  const keys = (Array.isArray(onlyRooms) ? onlyRooms : []).map(n=>{ const parts = String(n||"").split(/\s[-\u2013\u2014]\s/);
    return _locNameKey(parts.length>1 ? parts.slice(1).join(" ") : n); }).filter(k=>k && k.length>=3);
  if(!keys.length) return texts;
  return texts.filter(t=>t.split("\n").some(line=>/^\s*(INT|EXT|I\/E)[.\s]/i.test(line)
    && keys.some(k=>(" "+_locNameKey(line)+" ").indexOf(" "+k+" ")>=0)));
}
function locationUnattachedScreenplay(l, scenes, drafts, attachedSceneIds, limit){
  return _locShareCut(locationUnattachedScreenplayTexts(l, scenes, drafts, attachedSceneIds), limit||LOC_UNATTACHED_TEXT_BASE);
}
/* texts cut to a FAIR share of max characters (at a word, "…" marking a cut): the largest cap c with every text cut to
   c (a shorter one kept whole) adding up to max — so a short scene's spare room goes to the long ones; at least 120 each */
function _locShareCut(texts, max){
  const list = (texts||[]).filter(t=>typeof t==="string" && t);
  if(!list.length) return [];
  let left = Math.max(0, Math.floor(Number(max)||0)), k = list.length;
  for(const n of list.map(t=>t.length).sort((a,b)=>a-b)){ if(n<=left/k){ left -= n; k--; } else break; }
  const each = k ? Math.max(120, Math.floor(left/k)) : Infinity;
  return list.map(t=>t.length>each ? t.slice(0,each).replace(/\s+\S*$/,"").trim()+" …" : t);
}
/* the scenes of a reference list's screenplay pages (kind "script", each carrying its sceneId) — null when it has no
   page, or a page doesn't say its scene (then the pointer stands alone, as before) */
function _locPageScenes(refs){
  const pages = (refs||[]).filter(r=>r && r.kind==="script");
  if(!pages.length || pages.some(r=>r.sceneId==null || r.sceneId==="")) return null;
  return Array.from(new Set(pages.map(r=>String(r.sceneId))));
}
/* THE FIXED TRIMMING ORDER — only while the spec is longer than budget, each step whole before the next:
     1. layout notes: each layout object's evidence and basis, the layout's open questions and source, the long
        coordinate convention (a one-line one stays), provenance, the script-requirements note, the fixture rule;
     2. this space's own description said a second time (its identity layer repeating the location's own fields);
     3. the screenplay-reading rules (the reference list after the prompt says them again);
     4. a room's layout objects in other spaces that none of its panels looks at;
     5. "reads as" (narrative significance), dramatic use and tone;
     6. the screenplay text, when no pages carry it, cut to an excerpt (~600 characters) — and the scenes whose pages
        didn't fit the slots (screenplay_of_scenes_not_attached) only as far as the prompt needs, never below ~600 in
        all, a fair share each (2026-10-14: they were always cut to ~600);
     7. the parent's description cut to its binding continuity anchors;
     8. long descriptive prose cut to 240, then 120 characters.
   Never: task, views, fixtures, render, world scale, species canon, continuity anchors, the shared layout's objects,
   frame and floor plan, a unit's time / state / dressing. → {spec, steps} (steps: what went, in order)
   extra.notAttachedFull (2026-10-14): the uncut texts of those left-out scenes — with nothing to trim they get the room
   the prompt has left, up to LOC_UNATTACHED_TEXT_MAX in all (see LOC_UNATTACHED_TEXT_BASE); step 6 cuts from them. */
function locationFitPromptSpec(specIn, budget, extra){
  let spec;
  try{ spec = JSON.parse(JSON.stringify(specIn||{})); }catch(e){ return {spec:specIn, steps:[]}; }
  const steps = [], size = ()=>JSON.stringify(spec).length, fits = ()=>size()<=budget;
  // the left-out scenes' text: on the location (or environment spec), or on a room & time plate's coverage
  const naHost = ()=>[spec.location, spec.environment_spec, spec.coverage]
    .find(h=>h && typeof h==="object" && Array.isArray(h.screenplay_of_scenes_not_attached)) || null;
  const naFull = (extra && Array.isArray(extra.notAttachedFull)) ? extra.notAttachedFull.filter(t=>typeof t==="string" && t) : null;
  /* the largest share, from lo to hi characters in all, at which the whole spec fits — false (left at lo) when even lo
     doesn't; the spec only grows with the share, so a binary search finds it */
  const naShare = (host, base, lo, hi)=>{
    const at = (m)=>{ host.screenplay_of_scenes_not_attached = _locShareCut(base, m); return fits(); };
    if(!at(lo)) return false;
    while(hi>lo){ const mid = Math.ceil((lo+hi)/2); if(at(mid)) lo = mid; else hi = mid-1; }
    at(lo); return true;
  };
  if(fits()){
    // nothing to trim: the left-out scenes get the room left, up to LOC_UNATTACHED_TEXT_MAX in all (each its fair share)
    const host = naHost(), was = host && host.screenplay_of_scenes_not_attached;
    if(host && naFull && naFull.length===was.length){
      const hi = Math.min(LOC_UNATTACHED_TEXT_MAX, naFull.reduce((n,t)=>n+t.length, 0));
      if(hi>LOC_UNATTACHED_TEXT_BASE && !naShare(host, naFull, LOC_UNATTACHED_TEXT_BASE, hi)) host.screenplay_of_scenes_not_attached = was;
    }
    return {spec, steps};
  }
  const own = (spec.location && typeof spec.location==="object") ? spec.location
    : ((spec.environment_spec && typeof spec.environment_spec==="object") ? spec.environment_spec : {});
  const il = own.identity_layers && typeof own.identity_layers==="object" ? own.identity_layers : null;
  const ssl = il && il.shared_set_layout && typeof il.shared_set_layout==="object" ? il.shared_set_layout : null;
  const each = (arr, fn)=>(Array.isArray(arr) ? arr : []).forEach(x=>{ if(x && typeof x==="object") fn(x); });
  const norm = (v)=>JSON.stringify(v, (k,x)=>typeof x==="string" ? x.trim().replace(/\.$/,"").trim() : x);
  const cutAt = (v, n)=>v.slice(0,n).replace(/\s+\S*$/,"")+" …";
  const PROTECT = /^(task|views|fixtures|render|world_scale|ambient_species_canon)(\.|$)|(^|\.)continuity_anchors(\.|$)|(^|\.)shared_set_layout\.(schema|ownerId|ownerName|targetSpace|status|frame|anchors|coordinates)(\.|$)|^location\.(name|scope|type|time_of_day)$|^coverage\.(role|name|parent_location|time_of_day|appearance_state|state_dressing|sluglines|scenes)(\.|$)/;
  const shorten = (n)=>{
    const walk = (node, path)=>{
      if(Array.isArray(node)) node.forEach((v,i)=>{ if(typeof v==="string"){ if(v.length>n && !PROTECT.test(path)) node[i] = cutAt(v,n); } else walk(v,path); });
      else if(node && typeof node==="object") Object.keys(node).forEach(k=>{ const p = path ? path+"."+k : k, v = node[k];
        if(typeof v==="string"){ if(v.length>n && !PROTECT.test(p)) node[k] = cutAt(v,n); } else walk(v,p); });
    };
    walk(spec,"");
  };
  const order = [
    ["layout notes", ()=>{
      if(ssl){
        each(ssl.anchors, a=>{ delete a.evidence; delete a.basis; delete a.posBasis; });
        delete ssl.unresolved; delete ssl.source;
        if(ssl.coordinates && typeof ssl.coordinates==="object"){
          if(ssl.coordinates.convention) ssl.coordinates.convention = LOC_CONVENTION_SHORT;
          each(ssl.coordinates.spaces, s=>{ delete s.basis; each(s.openings, o=>{ delete o.basis; }); });
          each(ssl.coordinates.cameras, c=>{ delete c.basis; });
        }
      }
      if(il) [il.place_identity, il.child_space && il.child_space.specific_identity, il.continuity_root && il.continuity_root.invariants]
        .forEach(x=>{ if(x && typeof x==="object") delete x.provenance; });
      if(own.script_requirements && typeof own.script_requirements==="object") delete own.script_requirements.note;
      delete spec.fixture_projection_rule;
    }],
    ["own description once", ()=>{
      const mine = il && (il.place_identity || (il.child_space && il.child_space.specific_identity));
      if(!mine || typeof mine!=="object") return;
      const said = new Set(Object.keys(own).filter(k=>k!=="identity_layers").map(k=>norm(own[k])));
      Object.keys(mine).forEach(k=>{ if(said.has(norm(mine[k]))) delete mine[k]; });
      if(il.place_identity && typeof il.place_identity==="object" && !Object.keys(il.place_identity).length) delete il.place_identity;
    }],
    ["screenplay rules once", ()=>{ delete own.screenplay_reference_contract; }],
    ["other spaces' objects", ()=>{
      if(!ssl || !il || !il.child_space || !spec.views || !Array.isArray(ssl.anchors)) return;
      const room = _locNameKey(il.child_space.name || ssl.targetSpace), seen = JSON.stringify(spec.views);
      const parentKey = _locNameKey((il.continuity_root && il.continuity_root.name) || ssl.ownerName);
      // the room's own objects ("Office" names the "Furnace Office" room — never the parent "Fondamenta" in "Fondamenta
      // DEI Vetrai"), and any object a panel's view names
      ssl.anchors = ssl.anchors.filter(a=>{ const sk = _locNameKey(a && a.space);
        return (sk && (sk===room || (sk!==parentKey && sk.length>=4 && room.indexOf(sk)>=0)))
          || (a && a.name && seen.indexOf(a.name)>=0) || (a && a.id && seen.indexOf(a.id)>=0); });
    }],
    ["reads as and tone", ()=>{ delete own.reads_as; delete own.tone; delete own.dramatic_use; }],
    ["screenplay excerpt", ()=>{
      if(typeof own.screenplay_context==="string" && own.screenplay_context.length>600
        && !/^the screenplay of these scenes is attached/.test(own.screenplay_context)) own.screenplay_context = cutAt(own.screenplay_context,600);
      if(spec.coverage && typeof spec.coverage==="object") ["screenplay_excerpt","screenplay_basis"].forEach(k=>{
        const v = spec.coverage[k];
        if(typeof v==="string" && v.length>600 && !/^the screenplay of these scenes is attached/.test(v)) spec.coverage[k] = cutAt(v,600); });
      // the scenes whose pages didn't fit the reference slots (locationUnattachedScreenplay): cut only as far as the
      // prompt needs, never below ~600 characters in all — a fair share each, so each keeps its heading and opening
      const host = naHost(), cur = host ? host.screenplay_of_scenes_not_attached : null;
      if(cur && cur.join("").length>600)
        naShare(host, (naFull && naFull.length===cur.length) ? naFull : cur.slice(), 600, cur.join("").length);
    }],
    ["parent description to its anchors", ()=>{
      const inv = il && il.continuity_root && il.continuity_root.invariants;
      if(inv && typeof inv==="object") il.continuity_root.invariants = inv.continuity_anchors ? {continuity_anchors:inv.continuity_anchors} : {};
    }],
    ["long prose shortened", ()=>{ shorten(240); if(!fits()) shorten(120); }],
  ];
  for(const [name, step] of order){
    if(fits()) break;
    const was = size(); step();
    if(size()<was) steps.push(name);
  }
  return {spec, steps};
}
window.locationPromptBudget = locationPromptBudget;
window.locationAvoidText = locationAvoidText;
window.locationScreenplayPointer = locationScreenplayPointer;
window.locationUnattachedScreenplay = locationUnattachedScreenplay;
window.locationUnattachedScreenplayTexts = locationUnattachedScreenplayTexts;
window._locShareCut = _locShareCut;
window._locPageScenes = _locPageScenes;
window.locationFitPromptSpec = locationFitPromptSpec;

function locVisualDefaults(l){
  const livingNeg = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(null, l) : "people, characters, animals, creatures, wildlife, insects";
  const styleSource=locationRenderStyleSource(l);
  return {
    renderStyle: styleSource.renderStyle
      || ((typeof window.renderStyleText==="function") ? window.renderStyleText("loc", styleSource.renderStyleKey) : "")
      || "photoreal cinematic establishing photography, wide lens, natural depth, sharp focus",
    negativePrompt: (l && l.negativePrompt) || (livingNeg+", watermark, logo, distorted perspective, warped architecture, low resolution, blurry, cgi look, fisheye"),
  };
}
window.locVisualDefaults = locVisualDefaults;

const LOCATION_AMBIENT_SPECIES = [
  { key:"moth", label:"moths", aliases:["moth","moths"], charRe:/\b(moth|lepidopteran)\b/i },
  { key:"firefly", label:"fireflies", aliases:["firefly","fireflies","glowworm","glowworms"], charRe:/\b(firefly|lampyrid|glowworm)\b/i },
  { key:"frog", label:"frogs", aliases:["frog","frogs","toad","toads"], charRe:/\b(frog|toad|anuran)\b/i },
  { key:"spider", label:"spiders", aliases:["spider","spiders","arachnid","arachnids"], charRe:/\b(spider|arachnid)\b/i },
  { key:"beetle", label:"beetles", aliases:["beetle","beetles"], charRe:/\b(beetle|coleopteran)\b/i },
  { key:"bird", label:"birds", aliases:["bird","birds"], charRe:/\b(bird|avian)\b/i },
];
function locationAmbientSpecies(l){
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim();
  const text = [l&&l.name, l&&l.architecture, l&&l.materials, l&&l.lighting, l&&l.significance].map(clean).join(" ").toLowerCase();
  if(!text) return [];
  const groupish = /\b(swarm|colony|hive|nest|roost|flock|school|shoal|cloud|cluster|congregation|migration|mass|horde|rookery)\b/i.test(text);
  return LOCATION_AMBIENT_SPECIES.filter(sp=>{
    const hit = sp.aliases.some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(text));
    const inName = sp.aliases.some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(String(l&&l.name||"")));
    return hit && (groupish || inName);
  });
}
function ambientSpeciesCharacterGuidance(species){
  const C = window.turnContinuity || {};
  const chars = (C.characters||[]).filter(c=>{
    const blob = [c&&c.name,c&&c.role,c&&c.ethnicity,c&&c.build,c&&c.hair,c&&c.skin,c&&c.eyes,c&&c.texture,c&&c.materialTexture,c&&c.look].filter(Boolean).join(" ");
    return species.charRe.test(blob);
  }).slice(0,3);
  if(!chars.length) return "";
  return chars.map(c=>{
    const scale = (typeof canonicalScaleLabel==="function") ? canonicalScaleLabel(c) : (c.name||"related character");
    const cues0 = [c.skin,c.hair,c.eyes,c.materialTexture,c.texture,c.build].filter(Boolean).join("; ").replace(/\s+/g," ");
    const cues = (typeof clipWords==="function") ? clipWords(cues0, 220) : cues0.slice(0,220);
    return "Broad species canon may echo "+(c.name||"the related character")+" ("+scale+(cues?("; "+cues):"")+
      "), but anonymous background "+species.label+" must NOT copy that named character's exact face, costume, pendant, unique markings, pose or hero silhouette.";
  }).join(" ");
}
function ambientSpeciesSourceCharacters(species){
  const C = window.turnContinuity || {};
  return (C.characters||[]).filter(c=>{
    const blob = [
      c&&c.name, c&&c.role, c&&c.ethnicity, c&&c.build, c&&c.hair,
      c&&c.skin, c&&c.eyes, c&&c.texture, c&&c.materialTexture,
      c&&c.look, c&&c.rationale, c&&c.scaleClass
    ].filter(Boolean).join(" ");
    return species.charRe.test(blob);
  }).slice(0,3);
}
function speciesCanonCue(c){
  const clean = (x,n)=>{ const s=String(x||"").replace(/\s+/g," ").trim();
    return (typeof clipWords==="function") ? clipWords(s, n||160) : s.slice(0,n||160); };
  const scale = (typeof canonicalScaleLabel==="function") ? canonicalScaleLabel(c) : clean(c&&c.scaleClass,80);
  const height = (typeof scaleMeasurementOf==="function") ? scaleMeasurementOf(c) : clean(c&&c.height,40);
  const traits = [
    c&&c.ethnicity ? ("taxonomy/world read: "+clean(c.ethnicity,120)) : "",
    c&&c.build ? ("body language: "+clean(c.build,160)) : "",
    c&&c.skin ? ("surface/palette: "+clean(c.skin,160)) : "",
    c&&c.hair ? ("antennae/hair/crest: "+clean(c.hair,140)) : "",
    c&&c.eyes ? ("eye/glow family: "+clean(c.eyes,120)) : "",
    c&&c.materialTexture ? ("material texture: "+clean(c.materialTexture,160)) : "",
    c&&c.texture ? ("texture: "+clean(c.texture,160)) : "",
  ].filter(Boolean);
  return {
    source_character: clean(c&&c.name,80) || "related character",
    source_scale: [scale, height].filter(Boolean).join(" · ") || undefined,
    broad_species_traits: traits.length ? traits.join("; ") : undefined,
  };
}
function locationSpeciesCanon(l){
  return locationAmbientSpecies(l).map(species=>{
    const sources = ambientSpeciesSourceCharacters(species).map(speciesCanonCue);
    return {
      species: species.label,
      source: sources.length ? sources : "no matching named character found; use only the location's own species wording",
      allowed_use: "anonymous background population / environmental extras only",
      may_echo: "broad taxonomy, scale class, size logic, palette family, wing/skin/fur/chitin/material language, and non-unique glow behaviour",
      must_vary: "individuals should differ in pose, markings, proportions and grouping so they read as a population, not copies",
      never_copy: "no named-character face, no unique costume/accessory/pendant, no exact markings, no hero silhouette, no foreground performance, no character portrait",
      staging: "keep the species as set dressing at environmental scale unless a later shot explicitly introduces the named character from its own character sheet",
    };
  }).filter(Boolean);
}
function locationSpeciesCanonText(l){
  const canon = locationSpeciesCanon(l);
  if(!canon.length) return "";
  return "AMBIENT SPECIES CANON: "+canon.map(c=>{
    const src = Array.isArray(c.source)
      ? c.source.map(s=>[s.source_character, s.source_scale, s.broad_species_traits].filter(Boolean).join(" — ")).join(" | ")
      : c.source;
    return c.species+": "+src+". "+c.allowed_use+". May echo "+c.may_echo+". Must vary: "+c.must_vary+". Never copy: "+c.never_copy+".";
  }).join(" ");
}
function locationNoCharactersRules(project, l){
  const C = window.turnContinuity || {};
  const names = (C.characters||[]).map(c=>String(c&&c.name||"").trim()).filter(Boolean).slice(0,12);
  const named = names.length ? (" Do not depict any cast member by name: "+names.join(", ")+".") : "";
  const ambient = locationAmbientSpecies(l);
  const ambientRule = ambient.length
    ? "Anonymous ambient "+ambient.map(s=>s.label).join(" / ")+" may appear ONLY because this location explicitly calls for them: treat them as environmental extras/set dressing at the location's scale, repeated small background forms or silhouettes, never hero figures. Follow the ambient_species_canon / AMBIENT SPECIES CANON block when present. "+ambient.map(ambientSpeciesCharacterGuidance).filter(Boolean).join(" ")
    : "No animals, no creatures, no wildlife, no insects, no frogs, no fireflies, no moths, no visible living bodies.";
  return [
    "EMPTY SET ONLY: this is a location reference plate, not a story shot.",
    "No people, no named characters, no actors, no cast members, no readable character faces, no expressive eyes, no hero bodies, no foreground character silhouettes.",
    ambientRule,
    "Bioluminescence is allowed as environmental glow, reflections, haze or light traces; if ambient species are allowed, their glow must stay anonymous and environmental, not character-identifying.",
    "Show traces of habitation only as empty environmental set dressing, tracks, scale cues, surfaces, props or light; the actual characters will be added later from character sheets during shot generation."+named
  ];
}
function locationCharacterNegative(project, l){
  const C = window.turnContinuity || {};
  const names = (C.characters||[]).map(c=>String(c&&c.name||"").trim()).filter(Boolean);
  const ambient = locationAmbientSpecies(l);
  const allowed = new Set(ambient.flatMap(s=>s.aliases.map(a=>a.toLowerCase())));
  const genericLiving = ambient.length ? [] : ["animals","creatures","wildlife","insects"];
  const speciesTerms = ["moths","moth","fireflies","firefly","flies","bugs","frogs","frog","toads","toad","birds","bird","spiders","spider","beetles","beetle"].filter(x=>!allowed.has(x));
  const base = ["people","characters","actors","cast","crowds","faces","eyes","bodies","foreground silhouettes","hero creature","character portrait"].concat(genericLiving, speciesTerms);
  return Array.from(new Set(base.concat(names))).join(", ");
}
window.locationNoCharactersRules = locationNoCharactersRules;
window.locationCharacterNegative = locationCharacterNegative;
window.locationAmbientSpecies = locationAmbientSpecies;
window.locationSpeciesCanon = locationSpeciesCanon;
window.locationSpeciesCanonText = locationSpeciesCanonText;

/* Render-style text per key — location cards use the SAME dropdown options as the cast
   (window.CHAR_RENDER_STYLE_OPTIONS, incl. "Surprise me ✨"); picking a concrete key
   writes this place-tuned recipe into l.renderStyle, which the plate builder feeds into
   render.style. "surprise" is AI-invented per location (aiSurpriseStyleText). */
const LOC_RENDER_TEXT = {
  photoreal: "photoreal cinematic establishing photography, wide lens, natural depth, sharp focus, realistic light",
  graphicNovelNoir: "high-contrast black-and-white graphic-novel environment, bold ink shadows and screentone midtones, hard single-source noir light, deep pooled blacks, strictly monochrome",
  ukiyoe: "ukiyo-e woodblock landscape print, flat mineral-pigment colour planes, calligraphic keyblock outlines, bokashi sky gradation, washi paper texture, Edo-period palette, no Western light-and-shadow modelling",
  paperCutout: "layered paper cut-out environment, flat scissor-cut paper shapes stacked in shallow physical depth layers, real drop shadows between layers, visible paper grain, handmade collage charm",
  photorealNatural: "natural-history macro habitat photography, real biological scale cues, believable tiny-world anatomy context, skin/fur/scales/chitin-compatible environment detail, moisture, realistic light, minimal stylization",
  photorealCreature: "cinematic photoreal creature-film environment, practical/VFX set realism, believable creature-shop material world, realistic depth, controlled live-action lighting",
  photorealOrnamental: "photoreal ornamental creature-world environment, couture/ceremonial/jewelry-like production design, iridescent and armor-like materials, premium cinematic studio realism",
  render3d:  "stylized 3D environment render, cinematic lighting, physically-based materials, atmospheric depth",
  anime:     "anime background art, painterly cel-shaded environment, clean linework, soft gradient skies, no photoreal texture",
  flat:      "flat vector landscape, bold geometric shapes, minimal flat shading, limited palette, no photoreal texture",
  horror:    "low-key cinematic horror cinematography of the place, hard cold side light, deep atmospheric blacks, fog and haze, colour left neutral (the scene's look grades it)",
  ghibli:    "soft hand-painted Studio Ghibli-style 2D background, fine warm linework, gentle painterly cel shading, warm earthy naturalistic palette, nostalgic light",
  animated3d:"polished animated-feature 3D environment render, soft warm global illumination, appealing clean PBR materials, idealized finish, no noise",
  pixar:     "Pixar-style animated-feature 3D environment, soft warm global illumination, appealing rounded stylized forms, clean tactile PBR materials, 'every frame a painting' warmth, idealized charming finish, no noise",
  storyboardconcept:"clean storyboard / production concept environment, expressive linework, clear cinematic staging, restrained color wash, readable layout and mood",
  texturedcomic:"textured contemporary comic-art environment, bold ink contours, etched hatching, limited palette, dramatic graphic light, visible grain",
  gtaLoadingScreen:"open-world crime-game loading-screen poster environment, semi-realistic architecture with bold black ink outlines, hard cel-shaded light and shadow, saturated high-contrast colour that follows this plate's own time of day, glossy poster finish, no text or logos",
  whimsicalwatercolor:"whimsical watercolor and fine-ink environment, transparent washes, paper grain, delicate hand-drawn line, soft storybook charm",
  stopmotion:"photograph of a real handmade miniature stop-motion set, felt/wood/clay at tiny scale, soft practical studio light, faint tilt-shift miniature depth",
  claymation:"photograph of a real plasticine claymation miniature set, rounded clay forms with tool marks, soft practical light, faint tilt-shift miniature depth",
  adv1960s:  "1960s painted commercial illustration of the place, airbrushed gouache, vintage halftone print texture, mid-century mustard/avocado/teal palette",
  gaganime:  "1990s gag-anime 2D cartoon background, thick bold black outlines, flat high-saturation colors, simple graphic shapes, sticker-like finish",
  pixelart:  "retro 16/32-bit pixel-art environment, hard square pixels, no anti-aliasing, limited indexed palette, dithered skies and shadows, crisp pixel grid",
};
Object.assign(LOC_RENDER_TEXT, {
  modernAnime:"modern cinematic anime background art, clean sharp linework, polished cel shadows, vibrant contemporary colour and dramatic sky/light",
  digitalAnime:"polished digital anime environment illustration, smooth refined rendering, luminous colour, clean linework, atmospheric finish",
  roughSketchAnime:"rough sketch anime environment concept, visible pencil/ink strokes, flat colour, light hatching, immediate layout energy",
  painterlyAnime:"painterly anime environment, delicate line, soft blended brushwork, dreamy atmospheric colour wash",
  cartoon3d:"stylized 3D cartoon environment render, bold readable forms, clean animated-feature lighting, rounded appeal",
  textured3dCartoon:"textured 3D cartoon environment, felt/clay/fabric/fuzzy tactile surfaces, soft studio/miniature lighting",
  stylizedCartoon:"stylized cartoon environment illustration, bold outlines, flat colour areas, theatrical graphic shape design",
  grittyDigital:"gritty digital illustration environment, expressive linework, harsh light, textured shadows, moody high contrast",
  softPainterly:"soft painterly environment illustration, visible brushstrokes, blended colour, warm handmade atmosphere",
  realisticDigitalDrawing:"realistic digital drawing environment, believable light, detailed surface texture, illustrated not photographic",
  flatDesign:"flat design environment illustration, simplified geometric shapes, bold colour, minimal shading",
  minimalistLine:"minimalist line-art environment, sparse elegant contour, warm paper, abundant negative space, one small accent colour",
  vintageChildrensBook:"vintage children’s book environment illustration, loose ink outline, limited spot colour, aged paper print texture",
  tactileMixedMedia:"tactile mixed-media environment, handmade fabric/felt/paper/paint/sculpted miniature set, photographed craft",
  texturedPaperSculpture:"textured paper sculpture environment, folded layered paper, visible fibres, photographed tabletop diorama",
  texturedPaperIllustration:"textured paper illustration environment, collage layers, stippled print grain, cut-paper edges",
  tropicalArtNouveau:"tropical Art Nouveau environment, flowing organic lines, lush botanical motifs, flat ornamental colour",
});
window.LOC_RENDER_TEXT = LOC_RENDER_TEXT;

function locVisualsDrafted(l){ return !!((l.architecture||"").trim() && (l.lighting||"").trim()); }
window.locVisualsDrafted = locVisualsDrafted;

/* ---- DEPTH-GRID STAGING ----------------------------------------------------
   A location's canonical staging: a 3×3 depth grid (rows BG/MID/FG × cols L/C/R)
   plus Floor, Scale Class and Camera/Lens. Each cell is OPTIONAL — an empty cell
   means "open space" (so linear/open locations aren't forced into a box). Named
   landmark roles, per your spec:
     bg.center = Wall A (primary backdrop landmark)
     mid.left  = Wall B (primary framing element)
     mid.right = Wall C (secondary framing element)
     mid.center= the SUBJECT position (where a character stands) — usually left blank
     fg.left/fg.right = L1 / R1 foreground veils; fg.center = camera (implicit)
   Shots will later inherit this and vary it. */
function emptyStaging(){
  return { viewLabel:"", scaleClass:"", lens:"",
    bg:{ left:"", center:"", right:"" },
    mid:{ left:"", center:"", right:"" },
    fg:{ left:"", right:"" },
    floor:"" };
}
window.emptyStaging = emptyStaging;
function stagingOf(l){
  const s = (l && l.staging) || {};
  const e = emptyStaging();
  return { viewLabel:s.viewLabel||((l&&l.name)?((l.name||"")+" principal view"):""), scaleClass:s.scaleClass||"", lens:s.lens||"",
    bg:{...e.bg, ...(s.bg||{})}, mid:{...e.mid, ...(s.mid||{})}, fg:{...e.fg, ...(s.fg||{})},
    floor:s.floor||"" };
}
window.stagingOf = stagingOf;
/* true when the staging has at least one filled cell (worth showing / prompting) */
function stagingHasContent(l){
  const s = stagingOf(l);
  return !!(s.scaleClass||s.lens||s.floor||s.bg.left||s.bg.center||s.bg.right
    ||s.mid.left||s.mid.center||s.mid.right||s.fg.left||s.fg.right);
}
window.stagingHasContent = stagingHasContent;



/* every DISTINCT Style Bible preset the location's scenes use, in scene order.
   Informational only: a location can span scenes with different grades, so we show
   them all rather than collapsing to one. The reference plate itself stays
   grade-neutral — the grade is applied downstream at the shot. */
function locScenePresets(l, project){
  if(typeof scenePreset!=="function") return [];
  const out = []; const seen = new Set();
  for(const sid of (l.scenes||[])){ const p = scenePreset(project, sid); if(p && !seen.has(p.id)){ seen.add(p.id); out.push(p); } }
  return out;
}
window.locScenePresets = locScenePresets;

/* The effective SCALE CLASS of a location's WORLD is derived from the characters who
   DRIVE the scenes set here (a critter film's drivers are all Class B, so the place
   renders at critter scale). This is intentionally automatic: a stale project-wide
   override from an older save must not silently change newly generated locations. */
function locationScaleClass(l, project){
  if(typeof scaleClassOf!=="function") return "A";
  const C = window.turnContinuity || {};
  const chars = C.characters || [], scenes = C.scenes || [];
  if(!chars.length || !scenes.length) return "A";
  const byId = {}; chars.forEach(c=>{ if(c&&c.id) byId[c.id]=c; });
  const sids = Array.isArray(l && l.scenes) ? l.scenes : [];
  const counts = { A:0, B:0, C:0, D:0 };
  sids.forEach(sid=>{ const sc=scenes.find(s=>s.id===sid); const drv=sc&&sc.driver&&byId[sc.driver]; if(drv) counts[scaleClassOf(drv)]++; });
  const nonA = [["B",counts.B],["C",counts.C],["D",counts.D]].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  return nonA.length ? nonA[0][0] : "A";
}
window.locationScaleClass = locationScaleClass;

/* deterministic LOCATION coverage plate — full view of the place from several
   angles on one grid, so any shot set here matches geometry, materials & light.
   The plate stays grade-neutral (each shot applies its scene's look); `opts.time` specialises a variant. */
function buildLocationRefPrompt(l, project, opts){
  opts = opts || {};
  const P = project || (window.TURN_DATA||{}).PROJECT || {};
  const _C0 = window.turnContinuity || {};
  const v = locVisualDefaults(l);
  const arch = (l.architecture||"").replace(/\.$/,"").trim();
  const materials = (l.materials||"").replace(/\.$/,"").trim();
  const lighting = (l.lighting||"").replace(/\.$/,"").trim();
  const significance = (l.significance||"").replace(/\.$/,"").trim();
  const period = P.setting && P.setting.period ? P.setting.period.split(/[\u2014,]/)[0].trim() : "";
  const tone = [P.genre, period].filter(Boolean).join(", ");
  const locKey=locationKeyOf(l);
  const relevantUnits=(_C0.sluglineUnits||[]).filter(u=>u&&!u.orphan&&
    (String(u.subspaceKey||u.locationKey||"")===locKey || (!l.parentKey&&String(u.locationKey||"")===locKey)));
  const intExt=locationEffectiveSide(l,relevantUnits,l.coverageSheets||[],locationChildrenOf(l,_C0.locations||[]));
  const identityLayers=locationIdentityLayers(l,_C0.locations||[]);
  /* The parent plate is canonical geography across the whole film. Never inherit
     the first scene's TOD: NIGHT/rain and DAWN are Time-of-Day Variants on their
     respective Slugline Unit plates, not properties of the master space. */
  const time = opts.time || "";

  /* JSON environment spec (the director's template as a key:value spec, 2026-06):
     EXACTLY 4 views in a 2\u00d72 grid \u2014 wide establishing three-quarter (2026-10-27; it was a front view), high-angle three-quarter
     overview, two close-ups of the key stations \u2014 no text baked in. The depth grid's
     landmarks fill `fixtures`; ownerless set dressing LINKED to this location (the
     fixture-of relationship: explicit locationId, or every mapped scene resolves here)
     renders as `environment_props`, so abandoned objects & furniture live in the plate.
     Owned or multi-location objects are NEVER baked in \u2014 they travel with people.
     Stays GRADE-NEUTRAL: the scene's Style Bible grade applies downstream at the shot. */
  const st = stagingOf(l);
  const clean = (x)=>String(x||"").replace(/\.$/,"").trim();
  const fixtures = [];
  // (2026-10-27) not "dead-centre": the main view is a three-quarter from a corner, and "center" made it a straight-on shot
  if(clean(st.bg.center)) fixtures.push({ what: clean(st.bg.center), position: "background \u2014 the primary landmark, seen at an angle from the main camera's corner, not centred" });
    if(clean(st.mid.left))  fixtures.push({ what: clean(st.mid.left),  position: "screen-left in the principal camera view only; not a room-space coordinate" });
    if(clean(st.mid.right)) fixtures.push({ what: clean(st.mid.right), position: "screen-right in the principal camera view only; not a room-space coordinate" });
  if(clean(st.fg.left))   fixtures.push({ what: clean(st.fg.left),   position: "near foreground left" });
  if(clean(st.fg.right))  fixtures.push({ what: clean(st.fg.right),  position: "near foreground right" });
  const mainStation = clean(st.bg.center) || "the space's primary, most story-relevant feature";
  const secondStation = clean(st.mid.left) || clean(st.mid.right) || clean(st.fg.left) || clean(st.fg.right) || "a signature material detail of the space";
  // the screenplay as page images OR as text (2026-10-14): with its pages attached (opts.screenplayPages), a pointer
  const pagesPointer = locationScreenplayPointer(opts.screenplayPages);
  const screenplayContext = pagesPointer
    || ((typeof locationScreenplayContext==="function") ? locationScreenplayContext(l, _C0.scenes||[], _C0.drafts||{}, 2600) : "");
  // …and the scenes whose pages didn't fit the slots, as text (opts.screenplaySceneIds: the attached pages' scenes) —
  // a fair share of LOC_UNATTACHED_TEXT_BASE, more when the prompt has room (the uncut texts go to the fitter below)
  const panelPlan = (typeof locationMasterPanelPlan==="function") ? locationMasterPanelPlan(l, _C0.scenes||[], _C0.drafts||{}) : null;
  const screenplayNotAttachedFull = (pagesPointer && typeof locationUnattachedScreenplayTexts==="function")
    ? locationUnattachedScreenplayTexts(l, _C0.scenes||[], _C0.drafts||{}, opts.screenplaySceneIds, panelPlan && panelPlan.rooms) : [];
  const screenplayNotAttached = _locShareCut(screenplayNotAttachedFull, LOC_UNATTACHED_TEXT_BASE);
  const subspacePlan = locationParentOf(l, _C0.locations) ? (opts.panelPlan || locationSubspacePanelPlan(l, _C0.locations)) : null;
  const ownerCameraViews = (views)=>{
    const stated = subspacePlan ? [] : locationPanelPoses(l, _C0.locations).filter(p=>p.stated);
    if(!stated.length) return views;
    const anchors = locationSpaceAnchors(l, _C0.locations), out = { ...views };
    // a main view whose camera was set by hand or by the layout is framed by that camera, not told "three-quarter" (2026-10-27)
    stated.forEach(p=>{ const words = p.key==="TL" && p.source!=="suggested" ? "wide establishing view at eye level from this camera" : String(out[p.field]||p.purpose);
      out[p.field] = words.replace(/\.$/,"")+". "+locationPoseText(p.pose, "", anchors)
      +locationChildrenVisibleText(locationPanelChildrenVisible(l, p, _C0.locations)); });
    out.camera_convention = "Facings are compass directions of the shared layout: north is the facing named in its frame; yaw in degrees clockwise from north; positions in metres from its origin anchor, height above the floor.";
    return out;
  };
  const envProps = locationEnvironmentProps(l).map(p=>({
    name: p.name,
    description: [clean(p.form), clean(p.material)].filter(Boolean).join("; ") || undefined,
    // real-world measurement — the plate must render the object at its true physical
    // size relative to the space (the shot scale system reuses the same number)
    physical_size: clean(p.size) || undefined,
  }));
  /* THE SCRIPT USES THIS SPACE FOR — functional AFFORDANCES aggregated across every
     scene the script sets here (user ruling 2026-07-18): the plate must provide the
     working positions and clearances the beats rely on (a till position on the
     counter, queue room to the door, an operable shutter) WITHOUT staging any
     action, people, or ephemeral state — the plate stays canonical for the whole
     film. Deterministic: a lexicon scan over this location's scenes' summaries and
     script text, plus a capacity ceiling from cast presence. */
  const _AFFORD = [
    [/\btill\b|cash register/i, "a working service counter with a clear till position"],
    [/\bqueue|queuing|queueing\b/i, "open queueing room between the service point and the entrance"],
    [/\bshutter/i, "the entrance's roller shutter readable from inside the space"],
    [/\bdoor(way)?\b|entrance/i, "an unobstructed entrance / doorway sightline"],
    [/\bwindow/i, "windows that read from inside the space"],
    [/\bshel(f|ves)/i, "stocked shelving runs with aisle clearance"],
    [/\bstairs?\b/i, "a stair connection"],
    [/\bphone box|telephone|payphone\b/i, "a phone position"],
    [/\bcounter\b/i, "a service counter with working room behind it"],
  ];
  const _C = window.turnContinuity || {};
  const _locScenes = (Array.isArray(l.scenes) && l.scenes.length && Array.isArray(_C.scenes))
    ? _C.scenes.filter(sc=> l.scenes.indexOf(sc.id)>=0) : [];
  let _affordances = [], _capacity = 0;
  if(_locScenes.length){
    /* the screenplay's ACTION lines and headings only (2026-10-27): a word in dialogue ("My nonna had the bed by the
       window") is not the place's architecture — it asked a ferry deck for "windows that read from inside" */
    const _action = (id)=>{ const d = (_C.drafts||{})[id];
      return (d && Array.isArray(d.blocks)) ? d.blocks.filter(b=>b && (b.type==="action" || b.type==="scene" || b.type==="heading" || b.type==="slug")).map(b=>b.text||"").join(" ") : ""; };
    const _txt = _locScenes.map(sc=> [sc.summary, sc.objective, _locTurn(sc), _action(sc.id)].filter(Boolean).join(" ")).join(" ");
    _AFFORD.forEach(af=>{ if(af[0].test(_txt) && _affordances.indexOf(af[1])<0) _affordances.push(af[1]); });
    _affordances = _affordances.slice(0,5);
    if(_C.drafts && Array.isArray(_C.characters) && typeof scenesWhereCharacterAppears==="function"){
      _locScenes.forEach(sc=>{ let n=0;
        _C.characters.forEach(ch=>{ try{ if(scenesWhereCharacterAppears(ch.id, ch.name, [sc], _C.drafts).length) n++; }catch(e){} });
        if(n>_capacity) _capacity=n; });
    }
  }
  const speciesCanon = (typeof locationSpeciesCanon==="function") ? locationSpeciesCanon(l) : [];
  const emptySetRules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l) : ["no people","no characters","no animals"];
  const spec = {
    task: "professional environment reference sheet \u2014 ONE single real space rendered from 4 angles",
    location: {
      name: l.name||"Location",
      scope: identityLayers.scope,
      type: intExt==="INT/EXT" ? "interior + exterior continuity" : (intExt==="EXT" ? "exterior" : "interior"),
      identity_layers: identityLayers,
      space: arch || undefined,
      walls_surfaces_palette: materials || undefined,
      floor_ground_plane: clean(st.floor) || undefined,
      permanent_lighting_interfaces: lighting || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors) ? {
        status:l.anchorsLocked===false?"editable":"LOCKED / binding",
        rules:clean(l.continuityAnchors),
      }:undefined,
      time_of_day: time ? time.toLowerCase() : undefined,
      scale: clean(st.scaleClass) || undefined,
      reads_as: significance || undefined,
      script_requirements: (_affordances.length || _capacity>1) ? {
        note: "aggregated from every scene the script sets here — the space must AFFORD these working positions and clearances (present or clearly implied) while staging NO action, NO people and NO temporary state",
        affordances: _affordances.length ? _affordances : undefined,
        capacity: _capacity>1 ? ("the space must comfortably hold up to "+_capacity+" people at once when scenes play") : undefined,
      } : undefined,
      // (2026-10-27) the screenplay's story moments left out of this neutral plate
      leave_out_story_moments: (()=>{ const t = locationStoryTraces(l); return t.items.length ? {
        rule:"these are moments in the story, not part of the place: this neutral plate shows none of them (no "+t.words.join(", ")+")",
        from_the_screenplay:t.items } : undefined; })(),
      screenplay_context: screenplayContext || undefined,
      screenplay_of_scenes_not_attached: screenplayNotAttached.length ? screenplayNotAttached : undefined,
      screenplay_reference_contract: {
        purpose: "all attached screenplay pages jointly describe permanent geography, architecture, fixtures, sightlines and action affordances for this ONE location",
        not_a_panel_map: "do NOT assign one screenplay page or one scene to each quadrant; the four quadrants are four camera views chosen by the views plan below",
        continuity_rule: "aggregate only features that must persist across scenes; do NOT bake scene-specific time of day, active practical-light state, weather, temporary dressing, damage or story progression into this neutral master plate",
        unit_examples: "NIGHT/rain and DAWN belong in Slugline Units or Time-of-Day Variants when the screenplay calls for them",
      },
      tone: tone || undefined,
    },
    // the main view's composition is the MAIN sheet's (a Reverse views sheet looks the other way: none)
    fixtures: (fixtures.length && !opts.reverse) ? fixtures : undefined,
    // (2026-10-27) the composition is the plate's MAIN view: the top-left panel
    fixture_projection_rule: opts.reverse ? undefined :"These fixtures describe ONLY the main (top-left) view"+(clean(st.viewLabel) ? " \u2014 "+clean(st.viewLabel) : "")+". The shared set layout takes precedence over this composition. Other panels show the same fixed objects from their own cameras; do not restage or duplicate them.",
    environment_props: envProps.length ? envProps : undefined,
    ambient_species_canon: speciesCanon.length ? speciesCanon : undefined,
    /* PLATE CAMERAS (2026-10-13, Location coordinates): a room's four panels are its own cameras, each opening named
       with the view of the space beyond it (locationSubspaceViews); an owner space states the cameras that are SET —
       with none set its views are exactly as before */
    // C (2026-10-28): the Reverse views sheet — the main sheet's four cameras turned round
    views: opts.reverse ? locationReverseViews(l, _C0.locations) : subspacePlan ? locationSubspaceViews(l, subspacePlan, opts.panelRefs) : ownerCameraViews({
      ...(panelPlan || {
        layout: "exactly 4 views in a 2x2 grid",
        top_left: "wide establishing THREE-QUARTER view at eye level from a front corner, looking diagonally across the space so two walls meet and the floor's depth and the ways in read \u2014 not a flat, straight-on symmetrical front view",
        top_right: "high-angle three-quarter overview shot from an elevated corner perspective looking down into the space showing depth and spatial layout",
        bottom_left: "close-up of "+mainStation,
        bottom_right: "close-up of "+secondStation,
        rule: "each view a distinctly different camera angle and composition \u2014 the SAME identical space, consistent architecture, scale, materials and light across all views",
      }),
    }),
    render: {
      style: v.renderStyle.replace(/\.$/,""),
      /* quality rules must AGREE with the picked style: pushing "photorealistic /
         hyper realistic" under a stylized style (cartoon, anime, Pixar…) contradicts
         the style line and the model resolves toward photoreal — the plate then drags
         every downstream shot off-style. Photoreal wording only for photoreal-family
         picks; style-faithful quality rules otherwise. */
      rules: emptySetRules.concat(
        [LOC_TEXT_RULE],
        /^(photoreal|horror)/.test(String(locationRenderStyleSource(l).renderStyleKey||"photoreal"))
          // (2026-10-27) photographic realism in the film's own style — not "8k, hyper realistic, commercial photography",
          // which pulled a 35mm night drama toward a bright advert
          ? ["photographic realism in the render style named above","fine natural detail","consistent lighting across all views","clean layout"]
          : ["render every view strictly in the ONE render style named above — do not drift into any other style",
             "high-resolution, clean crisp detail in that style","consistent lighting and style across all views","clean layout"]),
    },
  };
  // (2026-10-27) the place's own description is said once: its identity layer repeated every field word for word
  if(spec.location.identity_layers && spec.location.identity_layers.place_identity) delete spec.location.identity_layers.place_identity;
  // WORLD SCALE — when this place is inhabited by a non-human-scale cast (critter / giant),
  // render the SPACE ITSELF at that scale (gigantism / miniaturization), so a bug's-world
  // location doesn't default to a human-scale room. Inert (Class A) for ordinary films.
  const _wcls = (typeof locationScaleClass==="function") ? locationScaleClass(l, P) : "A";
  const _wclause = (typeof worldScaleClause==="function") ? worldScaleClause(_wcls) : "";
  if(_wclause) spec.world_scale = _wclause;
  // THE PROMPT BUDGET (2026-10-14): compact JSON, then the fixed trimming order only while it is still too long for
  // its engine (opts.avoidChars: the AVOID list combinedLocationPrompt adds after it)
  const header = "Render this environment reference sheet EXACTLY as specified by this JSON spec (continuity fields are binding):\n";
  const fit = locationFitPromptSpec(spec, locationPromptBudget(opts)-header.length-(Number(opts.avoidChars)||0),
    { notAttachedFull:screenplayNotAttachedFull });
  return header+JSON.stringify(fit.spec);
}
window.buildLocationRefPrompt = buildLocationRefPrompt;

/* the set dressing a location OWNS (the fixture-of relationship): ownerless, not worn,
   and either explicitly linked (p.locationId) or every mapped scene resolves to this
   location. Objects whose scenes span locations are mobile (someone moves them) and
   are excluded \u2014 they belong at the shot, not baked into the set. */
function locationEnvironmentProps(l){
  const C = window.turnContinuity || {};
  const props = C.props||[], locations = C.locations||[];
  const charNames = (C.characters||[]).map(c=>String(c&&c.name||"").trim().toLowerCase()).filter(Boolean);
  const allowedSpecies = new Set((typeof locationAmbientSpecies==="function" ? locationAmbientSpecies(l) : []).flatMap(s=>s.aliases.map(a=>a.toLowerCase())));
  const livingRe = /\b(character|cast|person|people|animal|creature|wildlife|insect|bug|fly|firefly|frog|toad|bird|moth|beetle|spider|mouse|rat|face|eye|body|silhouette)\b/i;
  const locIdOf = (sid)=>{ const m=(typeof locationForScene==="function")?locationForScene(locations, sid):null; return m?m.id:""; };
  return props.filter(p=>{
    const locationScenes=(C.scenes||[]).filter(s=>{ const loc=(typeof locationForScene==="function")?locationForScene(locations,s.id):null; return loc&&loc.id===l.id; });
    if(typeof propStateAt==="function" && Array.isArray(p.continuityEvents) && p.continuityEvents.length){
      const placed=locationScenes.some(s=>{ const st=propStateAt(p,s.id,null,null,null,C); return st&&st.active&&st.placement&&st.placement.locationId===l.id; });
      if(placed) return true;
    }
    if(p.ownerId || p.ownerName) return false;
    if((p.kind||"carried")==="worn") return false;
    const blob = [p.name,p.form,p.material,p.detail].filter(Boolean).join(" ");
    if(livingRe.test(blob)){
      const lowBlob = blob.toLowerCase();
      const allowedHit = Array.from(allowedSpecies).some(a=>new RegExp("\\b"+a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(lowBlob));
      if(!allowedHit) return false;
    }
    const low = String(p.name||"").toLowerCase();
    if(low && charNames.some(n=>n && (low===n || low.includes(n)))) return false;
    if(p.locationId) return p.locationId===l.id;
    const sc = Array.isArray(p.scenes) ? p.scenes : [];
    if(!sc.length) return false;
    const ids = Array.from(new Set(sc.map(locIdOf).filter(Boolean)));
    return ids.length===1 && ids[0]===l.id;
  }).slice(0,6);
}
window.locationEnvironmentProps = locationEnvironmentProps;

/* opts (2026-10-14): panelPlan / panelRefs (a room's views), screenplayPages (the attached pages' image numbers — the
   screenplay text becomes a pointer to them), model / maxChars / reserve (the prompt budget: its engine's limit less
   the reference list that follows) */
/* STORY MOMENTS ARE NOT THE PLACE (owner 2026-10-27, from the Marmorica test run: the Lounge's master plate drew "small,
   wet, bare footprints tracking in from the deck" — a moment of its scene): the traces the screenplay's ACTION leaves
   in a place (footprints, spills, blood, broken glass, debris, smoke…) are found in its scenes' action lines and listed
   for its neutral plates as things to leave out; a room & time or environment-state plate shows them when its state
   says so. → { items:[the action sentence, short], words:[the trace nouns] } */
const LOC_STORY_TRACES = [
  [/\b(foot ?prints?|footmarks?|prints? of|tracks? of|wet (?:bare )?(?:prints?|feet))\b/i, "footprints"],
  [/\b(puddles?|spill(?:s|ed)?|spilt)\b/i, "spills"],
  [/\bblood\b/i, "blood"],
  [/\b(broken glass|shattered|smashed|shards?)\b/i, "broken glass"],
  [/\b(debris|scattered|strewn|litter(?:ed)?)\b/i, "debris"],
  [/\b(smoke|smoulder(?:s|ing)?|smolder(?:s|ing)?|burning)\b/i, "smoke"],
  [/\b(stain(?:s|ed)?|smear(?:s|ed)?)\b/i, "stains"],
  [/\b(overturned|toppled|knocked over)\b/i, "overturned furniture"],
];
function locationStoryTraces(l){
  const C = window.turnContinuity || {};
  const own = new Set((Array.isArray(l && l.scenes) ? l.scenes : []).map(String));
  const items = [], words = [];
  (C.scenes||[]).filter(sc=>sc && own.has(String(sc.id))).forEach(sc=>{
    const blocks = ((C.drafts||{})[sc.id]||{}).blocks || [];
    blocks.filter(b=>b && b.type==="action").forEach(b=>{
      String(b.text||"").split(/(?<=[.!?])\s+/).forEach(sent=>{
        LOC_STORY_TRACES.forEach(([re, word])=>{
          if(!re.test(sent)) return;
          const t = sent.replace(/\s+/g," ").trim().slice(0,140);
          if(items.length<6 && items.indexOf(t)<0) items.push(t);
          if(words.indexOf(word)<0) words.push(word);
        });
      });
    });
  });
  return { items, words };
}
window.locationStoryTraces = locationStoryTraces;
function combinedLocationPrompt(l, project, opts){
  const extra = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "";
  // ONE AVOID list (2026-10-14): the default negative prompt already ends with the character negative — said once;
  // (2026-10-27) the screenplay's story traces too (footprints, spills…), never on a neutral plate
  const traces = locationStoryTraces(l);
  const neg = locationAvoidText(l.negativePrompt || locVisualDefaults(l).negativePrompt || "", extra, traces.words.join(", "));
  const avoid = neg ? (" AVOID: " + neg + ".") : "";
  return buildLocationRefPrompt(l, project, {...(opts||{}), avoidChars:avoid.length}) + avoid;
}
window.combinedLocationPrompt = combinedLocationPrompt;

/* single establishing variant (used for time-of-day / style variant plates) */
function buildLocationVariantPrompt(l, project, opts){
  opts = opts || {};
  const v = locVisualDefaults(l);
  const lighting = (l.lighting||"").replace(/\.$/,"").trim();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  let s = "Establishing shot \u2014 "+(l.name||"Location")+" ("+(l.intExt||"INT")+")";
  s += opts.time ? (", "+opts.time) : "";
  s += ". ";
  s += (l.architecture ? (l.architecture.replace(/\.$/,"")+". ") : "");
  s += lighting ? ("Permanent lighting interfaces: "+lighting+". ") : "";
  s += opts.state ? ("TIME-OF-DAY VARIANT (binding): "+String(opts.state).replace(/\.$/,"")+". ") : "";
  const layers=locationIdentityLayers(l);
  s += locationSpatialPrompt(l);
  if(layers.continuity_root) s += "This child space inherits the continuity-root identity: "+JSON.stringify(layers.continuity_root)+". ";
  // grade-neutral, like the master plate — the scene grade is applied at the shot.
  s += "RENDER STYLE: "+v.renderStyle.replace(/\.$/,"")+". ";
  if(speciesCanon) s += speciesCanon+" ";
  s += "Single wide cinematic frame, the same space and architecture. "+rules+" Sharp focus, faithful to the specified render style.";
  const extra = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "";
  const neg = locationAvoidText(l.negativePrompt||v.negativePrompt||"", extra);   // once (2026-10-14)
  return neg ? (s+" AVOID: "+neg+".") : s;
}
window.buildLocationVariantPrompt = buildLocationVariantPrompt;

/* opts (2026-10-14): screenplayPages (the attached pages' numbers — the excerpt becomes a pointer to them), model /
   maxChars / reserve (the prompt budget) */
function buildLocationCoveragePrompt(l, sheet, project, opts){
  sheet = sheet || {};
  opts = opts || {};
  const pagesPointer = locationScreenplayPointer(opts.screenplayPages);
  const v = locVisualDefaults(l);
  const role = String(sheet.role||"INT").toUpperCase();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const parent = clean(l&&l.name) || "the parent location";
  const name = clean(sheet.name) || (parent+" "+role);
  const summary = clean(sheet.summary);
  const spec = {
    task: "single full-frame location coverage sheet derived from the screenplay",
    coverage: {
      role: role==="EXT" ? "exterior side" : "interior side",
      name,
      parent_location: parent+" ("+(l.intExt||"INT")+")",
      screenplay_basis: summary || undefined,
      screenplay_excerpt: pagesPointer || clean(sheet.scriptExcerpt) || undefined,
      screenplay_order: sheet.order!=null ? Number(sheet.order) : undefined,
      scenes: Array.isArray(sheet.sceneNos) && sheet.sceneNos.length ? sheet.sceneNos : undefined,
      rule: "render ONLY the space the screenplay needs for shots; no actors, no story action, no temporary performance moment",
    },
    relationship_to_parent: role==="INT"
      ? "This is the inside/subspace of the parent location; preserve any glass, doorway, booth, window or threshold relationship back to the exterior when the script states it."
      : "This is the outside/facade/context of the parent location; preserve entrances, windows, thresholds and approach geometry that connect to the interior when the script states it.",
    environment_spec: {
      identity_layers: locationIdentityLayers(l),
      architecture: clean(l.architecture) || undefined,
      materials: clean(l.materials) || undefined,
      permanent_lighting_interfaces: clean(l.lighting) || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors)?{status:l.anchorsLocked===false?"editable":"LOCKED / binding",rules:clean(l.continuityAnchors)}:undefined,
      dramatic_use: clean(l.significance) || undefined,
    },
    ambient_species_canon: speciesCanon || undefined,
    render: {
      style: clean(v.renderStyle),
      format: "ONE "+((typeof nbGetAspect==="function" && nbGetAspect()) || "16:9")+" cinematic environment reference image, not a grid, not a storyboard panel"+LOC_THREE_QUARTER_FRAME,
      rules: [rules, "empty set only", "if the screenplay names a subspace without fully describing it, infer the missing architecture from the attached screenplay-page reference plus the parent location reference while staying conservative", LOC_TEXT_RULE, "consistent with the parent location's materials, scale and light"],
    },
  };
  const neg = locationAvoidText(l.negativePrompt || v.negativePrompt || "", (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "");
  const header = "Render this screenplay-derived location coverage sheet EXACTLY as specified by this JSON spec:\n";
  const avoid = neg ? ("\nAVOID: "+neg+".") : "";
  // compact, then the fixed trimming order only while too long for its engine (2026-10-14)
  return header + JSON.stringify(locationFitPromptSpec(spec, locationPromptBudget(opts)-header.length-avoid.length).spec) + avoid;
}
window.buildLocationCoveragePrompt = buildLocationCoveragePrompt;

/* SLUGLINE UNIT plate prompt — one (place, side, time-of-day) coverage plate.
   Mirrors buildLocationCoveragePrompt but keys the spec to the unit: the time
   bucket and the user's TIME-OF-DAY VARIANT ("dawn and raining") are first-class,
   binding spec fields, and the screenplay basis is ONLY this unit's owned blocks
   (yard-at-night coverage never reads booth prose). */
/* opts (2026-10-14): as buildLocationCoveragePrompt's, and screenplaySceneIds (the attached pages' scenes — the
   unit's other scenes go as text) */
function buildSluglineUnitPrompt(l, u, project, opts){
  u = u || {};
  opts = opts || {};
  const pagesPointer = locationScreenplayPointer(opts.screenplayPages);
  /* (2026-10-14, headless paths) its unit's scenes whose pages aren't attached (opts.screenplaySceneIds: the attached
     pages' scenes) go as text — the unit's own part of each, a fair share; the uncut texts go to the fitter below */
  const _C = window.turnContinuity || {};
  const notAttachedFull = (pagesPointer && typeof sluglineUnitUnattachedTexts==="function")
    ? sluglineUnitUnattachedTexts(u, _C.scenes||[], _C.drafts||{}, opts.screenplaySceneIds) : [];
  const notAttached = _locShareCut(notAttachedFull, LOC_UNATTACHED_TEXT_BASE);
  const v = locVisualDefaults(l);
  const role = String(u.intExt||"INT").toUpperCase();
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const parent = clean(l&&l.name) || "the parent location";
  const name = clean(u.name) || (parent+" "+role);
  const spec = {
    task: "single full-frame location coverage plate for one slugline unit (place + side + time of day)",
    coverage: {
      role: role==="EXT" ? "exterior side" : "interior side",
      name,
      parent_location: parent+" ("+(l.intExt||"INT")+")",
      time_of_day: clean(u.time) || undefined,
      appearance_state: clean(u.appearance) || undefined,
      // the user's curated list wins; derived script candidates are the fallback
      state_dressing: (Array.isArray(u.dressing) && u.dressing.length ? u.dressing
        : (Array.isArray(u.dressingDerived) && u.dressingDerived.length ? u.dressingDerived : undefined)),
      sluglines: Array.isArray(u.sluglines) && u.sluglines.length ? u.sluglines : undefined,
      screenplay_excerpt: pagesPointer || clean(String(u.scriptText||"").slice(0,720)) || undefined,
      screenplay_of_scenes_not_attached: notAttached.length ? notAttached : undefined,
      scenes: Array.isArray(u.sceneNos) && u.sceneNos.length ? u.sceneNos : undefined,
      rule: "render ONLY the space the screenplay needs for shots; no actors, no story action, no temporary performance moment",
    },
    relationship_to_parent: role==="INT"
      ? "This is the inside/subspace of the parent location; preserve any glass, doorway, booth, window or threshold relationship back to the exterior when the script states it."
      : "This is the outside/facade/context of the parent location; preserve entrances, windows, thresholds and approach geometry that connect to the interior when the script states it.",
    environment_spec: {
      identity_layers: locationIdentityLayers(l),
      architecture: clean(l.architecture) || undefined,
      materials: clean(l.materials) || undefined,
      permanent_lighting_interfaces: clean(l.lighting) || undefined,
      permanent_dressing: clean(l.permanentDressing) || undefined,
      spatial_topology: clean(l.topology) || undefined,
      continuity_anchors: clean(l.continuityAnchors)?{status:l.anchorsLocked===false?"editable":"LOCKED / binding",rules:clean(l.continuityAnchors)}:undefined,
      dramatic_use: clean(l.significance) || undefined,
    },
    ambient_species_canon: speciesCanon || undefined,
    render: {
      style: clean(v.renderStyle),
      format: "ONE "+((typeof nbGetAspect==="function" && nbGetAspect()) || "16:9")+" cinematic environment reference image, not a grid, not a storyboard panel"+LOC_THREE_QUARTER_FRAME,
      rules: [rules, "empty set only", "the TIME OF DAY, TIME-OF-DAY VARIANT and STATE DRESSING list are binding — light, sky and weather must match the first two, and every listed temporary dressing item must be present in the space", "LOCKED continuity anchors and spatial topology are binding; Narrative Significance is soft interpretive guidance only", LOC_TEXT_RULE, "consistent with the continuity root's invariants and this child space's specific identity"],
    },
  };
  const neg = locationAvoidText(l.negativePrompt || v.negativePrompt || "", (typeof locationCharacterNegative==="function") ? locationCharacterNegative(project, l) : "");
  const header = "Render this slugline-unit location coverage plate EXACTLY as specified by this JSON spec:\n";
  const avoid = neg ? ("\nAVOID: "+neg+".") : "";
  // compact, then the fixed trimming order only while too long for its engine (2026-10-14)
  return header + JSON.stringify(locationFitPromptSpec(spec, locationPromptBudget(opts)-header.length-avoid.length,
    { notAttachedFull }).spec) + avoid;
}
window.buildSluglineUnitPrompt = buildSluglineUnitPrompt;

/* simplified fallback — fewer words, less likely to trip a content filter */
/* the simplified retry (after a "no image" answer). frame (2026-10-08): a single-frame plate — a room & time,
   an environment state, an extra space — keeps ITS framing, time and state (it used to fall back to a
   multi-angle sheet and drop the time: a night/rain room could save as a neutral sheet) */
function buildSimpleLocationPrompt(l, frame){
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(null, l).join(" ") : "empty of people and characters";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  // retry keeps the location's PICKED render style — never silently photoreal
  const styleLine = String(locVisualDefaults(l).renderStyle||"").split(/[;,]/)[0].trim();
  /* A SUB-SPACE'S RETRY (2026-10-14, owner — "go ahead with all of it") keeps what makes it a sub-space: its own four
     cameras (standing on an outdoor part, inside a room), and that the parent's cut-out panels it re-sends are never
     views to copy */
  const parent = locationParentOf(l);
  let subspace = "";
  if(parent){
    const pname = parent.name || "the parent place", outdoor = locationIsOutdoor(l);
    if(!frame){
      const cams = locationPanelPoses(l).map(p=>p.label.toLowerCase()+": "+String(p.purpose||"").replace(/\.$/,"")
        +(p.pose.yaw!=null && !/looking (north|south|east|west)/.test(p.purpose||"") ? ", facing "+locCompass(p.pose.yaw) : ""));
      subspace = (outdoor ? "Four cameras standing on "+(l.name||"this space")+" at eye level (an open-air part of "+pname+"; the rest of "+pname+" around it matches "+pname+"'s plate)"
        : "Four cameras inside "+(l.name||"this room"))+" — "+cams.join("; ");
    }
    // (2026-10-27) when the parent's plate has a view of this room itself, that panel is sent as the room's look
    const shows = !!(locationParentStylePick(l, parent)||{}).showsRoom;
    subspace += (subspace ? ". " : "")+(shows
      ? "The reference panel of "+pname+"'s plate shows "+(l.name||"this space")+" itself: keep its architecture, surfaces, fixtures, colour and light, and frame each view as stated here, never as that panel is framed"
      : "Any reference image of "+pname+" is a single cut-out panel of its plate — never copy one as a view of "+(l.name||"this space"));
  }
  const parts = [
    "Location reference \u2014 "+(l.name||"place")+" ("+(l.intExt||"INT")+")",
    (l.architecture||"").replace(/\.$/,"").trim(),
    (l.lighting?"permanent lighting interfaces: "+String(l.lighting).replace(/\.$/,"").trim():""),
    (l.continuityAnchors?"binding continuity anchors: "+String(l.continuityAnchors).replace(/\.$/,"").trim():""),
    (l.topology?"spatial topology: "+String(l.topology).replace(/\.$/,"").trim():""),
    locationSpatialPrompt(l),
    speciesCanon,
    frame
      ? ("ONE wide three-quarter establishing frame"+(frame.name?(" of "+String(frame.name).trim()):"")+(frame.side?(" ("+frame.side+")"):"")
          +(frame.time?(", at "+String(frame.time).trim()):"")+(frame.state?(", "+String(frame.state).replace(/\.$/,"").trim()):"")
          +" \u2014 from a corner, looking diagonally across the space, never straight-on; a single image, not a grid, no text, labels or captions")
      : "exactly 4 views of the same space in a 2x2 grid \u2014 establishing wide, reverse angle, a side view and a detail \u2014 no text, labels or captions",
    subspace,
    rules+", "+(styleLine||"photoreal")+", sharp focus"
  ].filter(Boolean);
  const neg = (typeof locationCharacterNegative==="function") ? locationCharacterNegative(null, l) : "";
  return parts.join(". ")+"."+(neg?(" AVOID: "+neg+"."):"");
}
window.buildSimpleLocationPrompt = buildSimpleLocationPrompt;

/* image-to-image from a dropped reference photo of a real place */
function buildLocationFromPhotoPrompt(l, project){
  const v = locVisualDefaults(l);
  const rules = (typeof locationNoCharactersRules==="function") ? locationNoCharactersRules(project, l).join(" ") : "empty of people and characters.";
  const speciesCanon = (typeof locationSpeciesCanonText==="function") ? locationSpeciesCanonText(l) : "";
  let s = "Master location reference plate \u2014 "+(l.name||"Location")+". ";
  s += "BASE SPACE: reproduce EXACTLY the place shown in the dropped reference photo of the real place \u2014 its architecture, ";
  s += "proportions, materials, colour and light. Do not redesign or restyle it. ";
  s += locationSpatialPrompt(l);
  s += (l.significance ? ("NARRATIVE SIGNIFICANCE (interpretive): "+l.significance.replace(/\.$/,"")+". ") : "");
  s += "RENDER STYLE: "+v.renderStyle.replace(/\.$/,"")+". ";
  if(speciesCanon) s += speciesCanon+" ";
  // (2026-10-08) the same 2x2 four-view plate as every other master plate — it used to ask for a 3x2 grid
  // with printed captions, so photo-made plates broke Edit a panel and the panel crops
  s += "Compose it as exactly 4 views of that same space in a 2x2 grid divided by thin clean lines: "
     + "top-left a wide establishing view; top-right a high overview; bottom-left and bottom-right two closer views of its key features and materials. "
     + "No text, no labels, no captions, no numbers. Any other attached images are parent, layout or screenplay references, not the place to copy. "
     + "Consistent architecture and light across all panels. "+rules+" Sharp focus, faithful to the specified render style.";
  return s;
}
window.buildLocationFromPhotoPrompt = buildLocationFromPhotoPrompt;

/* ---- Headless location generation (for the Location Scout agent) ----
   Mirrors generatePropSheet: build the prompt, generate (retry a simplified prompt on a
   "no image" safety refusal), commit to the location's slot, and dispatch nb-gen-done so
   the live card adopts it. The base plate commits to l.id ("locref-"+l.id); a time-of-day
   variant commits to l.id+"-"+v.id ("locvar-"+l.id+"-"+v.id). ---- */
function _nbLocRunSnapshot(entity){
  /* Read settings once, before the provider call.  Location generation is
     headless, so there is no component closure to freeze the user's intent for
     us; a late metadata getter would otherwise report a later picker change. */
  const model = (typeof nbGetModel==="function") ? nbGetModel() : "";
  const isGpt = typeof window.isGptImageModel==="function"
    ? window.isGptImageModel(model) : /^gpt-image/i.test(String(model||""));
  const quality = isGpt && typeof window.nbGetOaiQuality==="function"
    ? window.nbGetOaiQuality(model) : undefined;
  const styleEntity=typeof locationRenderEntity==="function"?locationRenderEntity(entity):entity;
  return { model, quality, renderStyleKey:styleEntity&&styleEntity.renderStyleKey,
    renderStyleLabel:typeof renderStyleLabelForEntity==="function"?renderStyleLabelForEntity(styleEntity):undefined };
}
function _nbLocMeta(prompt, entity, runSnapshot){
  const snap = runSnapshot || {};
  const model = snap.model || "";
  const aspect = (typeof nbGetAspect==="function") ? nbGetAspect() : "16:9";
  // the size really rendered (Seedream 5 Pro renders a 4K pick at 2K — 2026-10-11)
  const _res = (typeof nbGetRes==="function") ? nbGetRes() : "2K";
  const size = (typeof window.nbModelRes==="function") ? window.nbModelRes(model, _res) : _res;
  const now = new Date();
  const mEntry = (window.NB_MODELS||[]).find(m=>m.id===model) || {};
  return { modelLabel:mEntry.label||"Image model", modelId:model, aspect, size,
     renderStyleKey:snap.renderStyleKey,renderStyleLabel:snap.renderStyleLabel,
     // Keep the exact requested intent, including 2.5 "default"; never infer
     // provider-high from an omitted request after the render finishes.
     quality: snap.quality,
     qualityModel: model,
     requestedModel: model,
    date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
    time: now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    iso: now.toISOString(), prompt, mode:"final", version:1,
    writingSources:(typeof window.nbWritingSourcesFor==="function")?window.nbWritingSourcesFor(entity):[],
    promptCompiler:"Kinolot prompt compiler" };
}
/* SET DRESSING — painted INTO the plate by an EDIT, never attached as reference
   sheets at generation. (Reference sheets at generation time had no anchor image
   yet, so their studio look bled into the plate's lighting and palette; an edit
   pass keeps the finished plate as the style anchor and only installs the object.)
   Dressing props are spec-only cards: locDressingProps lists a location's fixtures,
   locDressingEditText turns one prop's spec into a ready plate-edit instruction. */
function locDressingProps(l){
  if(!l) return [];
  const props = ((window.turnContinuity||{}).props)||[];
  const homeId = (p)=>{
    if(p.locationId) return p.locationId;
    const home = (typeof propHomeLocation==="function") ? propHomeLocation(p) : null;
    return (home && home.id) || "";
  };
  return props.filter(p=>{
    if(!p) return false;
    if(typeof propStateAt==="function" && Array.isArray(p.continuityEvents) && p.continuityEvents.length){
      const C=window.turnContinuity||{};
      const here=(C.scenes||[]).some(s=>{ const loc=(typeof locationForScene==="function")?locationForScene(C.locations||[],s.id):null;
        if(!loc||loc.id!==l.id) return false;
        const st=propStateAt(p,s.id,null,null,null,C); return st&&st.active&&st.placement&&st.placement.locationId===l.id; });
      if(here) return true;
    }
    return p.kind==="dressing" && homeId(p)===l.id;
  });
}
window.locDressingProps = locDressingProps;
function locDressingEditText(p){
  const spec = [p.form, p.material, p.detail].map(x=>String(x||"").trim().replace(/\.$/,"")).filter(Boolean).join("; ");
  const size = String(p.size||"").trim();
  return "Add the set-dressing fixture \""+(p.name||"object")+"\" into the space: "
    +(spec||"as specified on its prop card")
    +(size?(" — physical size about "+size.replace(/\.$/,"")):"")
    +". Place it ONCE, where the staging spec positions it, at true physical scale — never repeat or tile it."
    +" Match the plate's EXISTING lighting, palette and render style exactly; change nothing else in the space.";
}
window.locDressingEditText = locDressingEditText;
function _nbLocRunStart(id){
  if(!window.__nbGenInflight) window.__nbGenInflight = {};
  if(!window.__nbGenCancel) window.__nbGenCancel = {};
  /* Refuse an active owner at entry.  A stopped run leaves a false marker
     briefly, so a replacement may claim it; a truthy token belongs to a
     live run and must never be clobbered. */
  if(window.__nbGenInflight[id]) return null;
  window.__nbGenRunSeq = (window.__nbGenRunSeq||0)+1;
  const token = window.__nbGenRunSeq;
  window.__nbGenInflight[id] = token;
  window.__nbGenCancel[id] = false;
  return token;
}
function _nbLocOwns(id, token){
  return !!(window.__nbGenInflight && window.__nbGenInflight[id]===token);
}
function _nbLocStale(id, token, epoch){
  return !_nbLocOwns(id,token)
    || !!(window.__nbGenCancel && window.__nbGenCancel[id])
    || (typeof nbEpoch==="function" && nbEpoch()!==epoch);
}
function _nbLocCancelEvent(id, token){
  if(!_nbLocOwns(id,token)) return;
  try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){}
}
function _nbLocCleanup(id, token){
  if(!_nbLocOwns(id,token)) return;
  delete window.__nbGenInflight[id];
  if(window.__nbGenCancel) delete window.__nbGenCancel[id];
}
/* the screenplay pages a location plate reads for its geography — the card and the headless runs attach
   the SAME pages (2026-10-08: the one-scene run used to attach none) — [{url, kind:"script", refId, label, note}] */
function locationScriptPageRefs(l, scenes, drafts, max){
  const C = window.turnContinuity || {};
  const all = scenes || C.scenes || [];
  const out = [], cap = (max==null ? 6 : Math.max(0, max));
  if(!cap) return out;
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder : (x=>x||[]);
  const list = (Array.isArray(l.scenes) && l.scenes.length)
    ? order(all.filter(s=>l.scenes.indexOf(s.id)>=0)) : order(all);
  const dr = drafts||C.drafts||{};
  /* WHOLE SCENES ONLY (2026-10-14): a scene's pages ride together or not at all \u2014 a scene whose pages no longer fit the
     slots left is skipped (a later one-page scene may still fit), never cut after its first page */
  for(const sc of list){
    if(out.length>=cap) break;
    const sheet = { name:l.name, sceneNos:[sc.no] };
    if(typeof locationScreenplayReferenceImages!=="function") break;
    const count = locationScreenplayReferenceImages(l, sheet, all, dr, { countOnly:true });
    const n = count && !Array.isArray(count) ? Number(count.pageCount)||0 : null;
    if(n!=null && (!n || n>cap-out.length)) continue;
    const imgs = locationScreenplayReferenceImages(l, sheet, all, dr, { pageLimit:Math.max(n||0, cap-out.length) });
    if(!imgs.length || imgs.length>cap-out.length || (n!=null && imgs.length!==n)) continue;
    // maxDim 1536: a page is sent at its own size, never shrunk (the layouts are chosen for that — 2026-10-14)
    imgs.forEach((url,i)=>out.push({ url, kind:"script", ready:true, required:false, maxDim:LOC_SCREENPLAY_PAGE_MAX_DIM,
      refId:"script-main-"+l.id+"-"+(sc.no||sc.id)+"-"+i, sceneId:sc.id, scenePage:i+1, scenePages:imgs.length,
      label:"Scene "+String(sc.no||"?").padStart(2,"0")+" p"+(i+1),
      note:"full-scene screenplay page "+(i+1)+" for Scene "+(sc.no||"?")+" \u2014 use this to design the location's 2x2 geography from what is actually filmed; do not render page text or borders" }));
  }
  return out;
}
window.locationScriptPageRefs = locationScriptPageRefs;
/* how many pages locationScriptPageRefs attaches — the same whole-scene choice, counted without drawing a page (a price
   is read on every render of a card; drawing a PNG per page there is far too slow) */
function locationScriptPageCount(l, scenes, drafts, max){
  const C = window.turnContinuity || {};
  const all = scenes || C.scenes || [];
  const cap = (max==null ? 6 : Math.max(0, max));
  if(!cap || typeof locationScreenplayReferenceImages!=="function") return 0;
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder : (x=>x||[]);
  const list = (Array.isArray(l.scenes) && l.scenes.length)
    ? order(all.filter(s=>l.scenes.indexOf(s.id)>=0)) : order(all);
  const dr = drafts||C.drafts||{};
  let total = 0;
  for(const sc of list){
    if(total>=cap) break;
    const count = locationScreenplayReferenceImages(l, { name:l.name, sceneNos:[sc.no] }, all, dr, { countOnly:true });
    const n = count && !Array.isArray(count) ? Number(count.pageCount)||0 : 0;
    if(n && n<=cap-total) total += n;
  }
  return total;
}
window.locationScriptPageCount = locationScriptPageCount;
/* the pages a card attaches once its other references are known: whole scenes (pages that share a sceneId) that fit the
   slots left, in order \u2014 a scene that doesn't fit is left out whole (2026-10-14) */
function locationWholeScenePages(pages, slots){
  const cap = Math.max(0, Math.floor(Number(slots)||0)), runs = [];
  (pages||[]).forEach(r=>{
    const last = runs[runs.length-1];
    if(last && r && r.sceneId!=null && last.sceneId===r.sceneId) last.list.push(r);
    else runs.push({ sceneId:r&&r.sceneId!=null ? r.sceneId : null, list:[r] });
  });
  const out = [];
  runs.forEach(run=>{ if(run.list.length<=cap-out.length) out.push(...run.list); });
  return out;
}
window.locationWholeScenePages = locationWholeScenePages;
/* ---- A ROOM & TIME PLATE'S SCREENPLAY: EVERY SCENE OF ITS UNIT (2026-10-14, headless paths) ------------------------
   A room & time plate (a Slugline Unit's — the room at one time) used to attach the pages of its unit's FIRST scene
   only (locationSceneForCoverageSheet) — Glass Hours' Furnace · Night sent scene 4's page for scenes 4, 6, 7, 9, 10,
   12 and 15 — while its prompt said "the screenplay of these scenes is attached". Now it reads like a location plate:
   EVERY scene of the unit, in story order, as whole scenes' pages in the reference slots its plates leave (its room's
   own plate and the parent's cut-out panels take theirs first; LOC_PLATE_MAX_REFS images in all), and the scenes whose
   pages don't fit go in its prompt as text (coverage.screenplay_of_scenes_not_attached: the unit's own part of each
   scene, a fair share each — see LOC_UNATTACHED_TEXT_BASE) — never both, never neither. The same choice everywhere:
   the room & time card and an environment state's card (locations-ui.jsx buildSluglineUnitReferences), the headless
   run (generateSluglineUnitPlate — "Make what this scene needs", "Generate N missing in Scene NN"), a state the
   Location Scout makes from a unit (generateLocationVariant) and the price (sluglineUnitPlateRefCount). The pages keep
   their list order: the screenplay first, then the plates (as before). */
const LOC_PLATE_MAX_REFS = 6;
/* the unit's scenes, in story order (its scene ids; else its scene numbers) */
function sluglineUnitScenes(u, scenes){
  const all = scenes || ((window.turnContinuity||{}).scenes) || [];
  const ids = Array.isArray(u && u.scenes) ? u.scenes.filter(x=>x!=null).map(String) : [];
  const nos = Array.isArray(u && u.sceneNos) ? u.sceneNos.map(Number).filter(Number.isFinite) : [];
  const list = all.filter(s=>s && (ids.length ? ids.indexOf(String(s.id))>=0 : nos.indexOf(Number(s.no))>=0));
  return (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(list) : list;
}
/* the unit read as a place with only its scenes — so its pages are chosen exactly as a location plate's are
   (locationScriptPageRefs: whole scenes, story order, the slots given) — null when none of its scenes is known */
function _locUnitPlace(l, u, scenes){
  const ids = sluglineUnitScenes(u, scenes).map(s=>s.id);
  return ids.length ? { ...l, scenes:ids } : null;
}
/* the pages a room & time plate attaches in max slots → [{url, kind:"script", refId, sceneId, label, note, maxDim, …}] */
function sluglineUnitPageRefs(l, u, id, scenes, drafts, max){
  const C = window.turnContinuity || {};
  const all = scenes || C.scenes || [];
  const place = _locUnitPlace(l, u, all);
  if(!place || typeof locationScriptPageRefs!=="function") return [];
  const name = (u && u.name) || "this Slugline Unit";
  return locationScriptPageRefs(place, all, drafts || C.drafts || {}, max).map((r,k)=>{
    const no = ((all.find(s=>s && s.id===r.sceneId)||{}).no);
    return { ...r, refId:"script-"+id+"-"+k,
      note:"screenplay page "+(k+1)+" for "+name+" (Scene "+(no!=null ? no : "?")+(r.scenePages>1 ? ", page "+r.scenePage+" of "+r.scenePages : "")+")"
        +" — use it to infer what the script implies, but do not render any text from it" };
  });
}
/* how many — counted, not drawn (a price is read on every render) */
function sluglineUnitPageCount(l, u, scenes, drafts, max){
  const C = window.turnContinuity || {};
  const all = scenes || C.scenes || [];
  const place = _locUnitPlace(l, u, all);
  return place && typeof locationScriptPageCount==="function" ? locationScriptPageCount(place, all, drafts || C.drafts || {}, max) : 0;
}
/* the unit's scenes NOT among the attached pages' scenes, as text: each scene's part under this unit's slugline (its
   occurrences), else the whole scene — uncut, in story order; [] when the attached scenes aren't known */
function sluglineUnitUnattachedTexts(u, scenes, drafts, attachedSceneIds){
  if(!Array.isArray(attachedSceneIds) || !attachedSceneIds.length) return [];
  const got = new Set(attachedSceneIds.map(String)), dr = drafts || {};
  return sluglineUnitScenes(u, scenes).filter(s=>!got.has(String(s.id))).map(sc=>{
    const blocks = locationScreenplayBlocks(sc, dr);
    const occ = ((u && u.occurrences) || []).filter(o=>o && String(o.sceneId)===String(sc.id));
    const part = occ.length && blocks.length ? occ.map(o=>locationSceneScriptText(sc, { [sc.id]:{ blocks:blocks.slice(Number(o.start)||0,
      o.end==null ? blocks.length : Number(o.end)) } })).filter(Boolean).join("\n\n") : "";
    return String(part || locationSceneScriptText(sc, dr) || "").replace(/\n{3,}/g,"\n\n").trim();
  }).filter(Boolean);
}
window.LOC_PLATE_MAX_REFS = LOC_PLATE_MAX_REFS;
window.sluglineUnitScenes = sluglineUnitScenes;
window.sluglineUnitPageRefs = sluglineUnitPageRefs;
window.sluglineUnitPageCount = sluglineUnitPageCount;
window.sluglineUnitUnattachedTexts = sluglineUnitUnattachedTexts;
/* opts (2026-10-08, owner — Locations review): the one-scene run and "Make what this scene needs" now make
   the SAME plate the card does — draftStaging writes the view composition first when the place has none
   (onStaged saves it), and the screenplay pages ride along as references. */
async function generateLocationPlate(l, project, opts){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // asset scope at generation start
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function") return false;
  const o = opts || {};
  /* A CALLER'S STOP (2026-10-09, owner — Breakdown review): "Make what this scene needs" passes its own check
     (a film switch, a role that lost the Art Room) — nothing is sent or written once it says stop; a retry
     with the simpler prompt is a second paid image, so the caller is told (onRetry) */
  const _stale = (id, tok, ep)=> _nbLocStale(id, tok, ep) || !!(typeof o.cancelled==="function" && o.cancelled());
  // THE LAYOUT FIRST (2026-10-12): a plate its layout would refuse is refused before any composition is written —
  // nobody pays for a view composition whose plate never comes (the same reason the plate itself gives)
  if(o.draftStaging && typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l);
  if(o.draftStaging && typeof stagingHasContent==="function" && !stagingHasContent(l)
    && typeof aiDraftStaging==="function" && typeof aiAvailable==="function" && aiAvailable()){
    try{ const st = await aiDraftStaging(l, (window.turnContinuity||{}).scenes||[], project);
      // (2026-10-09) a switch while the composition was written: nothing is saved, nothing is sent
      if((typeof nbEpoch==="function" && nbEpoch()!==_ep) || (typeof o.cancelled==="function" && o.cancelled())) return false;
      if(st){ l = { ...l, staging:st }; if(typeof o.onStaged==="function") o.onStaged(l.id, st); } }catch(e){}   // fail-open: prose only
    if(typeof nbEpoch==="function" && nbEpoch()!==_ep) return false;
    if(typeof o.cancelled==="function" && o.cancelled()) return false;
  }
  const runSnapshot = _nbLocRunSnapshot(l);
  // no set-dressing refs here — the clean plate anchors the look; fixtures are
  // painted in afterwards via the Edit panel's Set-dressing buttons
  let prompt = (typeof combinedLocationPrompt==="function") ? combinedLocationPrompt(l, project, {}) : (l.name||"location reference");
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const _runToken = _nbLocRunStart(l.id);
  if(!_runToken) return false;
  try{
    const parent=locationParentOf(l);
    /* A ROOM (2026-10-13, Location coordinates): its parent's plate small (materials and colour), then the view of
       the space beyond each opening its panels see (locationSubspacePlateReferences); a main location as before */
    let refs, subPlan=null;
    if(parent && typeof locationSubspacePlateReferences==="function"){
      const sub=await locationSubspacePlateReferences(l);
      if(_stale(l.id,_runToken,_ep)){_nbLocCancelEvent(l.id,_runToken);return false;}
      refs=sub.refs; subPlan=sub.plan;
    } else {
      const parentRefs=await locationParentReferences(l);
      if(_stale(l.id,_runToken,_ep)){_nbLocCancelEvent(l.id,_runToken);return false;}
      refs=mergeLocationReferences(parentRefs,await locationSpatialReferences(l));
    }
    if(o.scriptRefs!==false){
      // the parent's plate, the cut-out panels and the layout's plate first; whole scenes' pages in the slots left (2026-10-14)
      const pages=locationScriptPageRefs(l, null, null, Math.max(0, 6-refs.length)).filter(r=>r.url);
      refs=[...refs, ...pages.map(r=>({url:r.url,kind:"script",refId:r.refId,note:r.note,maxDim:r.maxDim,sceneId:r.sceneId}))].slice(0,6);
    }
    const lineage=parent?locationAssetDependencySnapshot(parent.id,[],"subspace"):{};
    // the cameras this plate's prompt states, recorded with it (rooms inside use them to pick the right panel)
    const panelRecord=(typeof locationPlatePanelRecord==="function")?locationPlatePanelRecord(l):null;
    if(panelRecord) lineage.platePanels=panelRecord;
    // what it was made from, for "Layout changed — regenerate" (step B)
    if(typeof locationPlateLayoutSig==="function"){ const ls=locationPlateLayoutSig(l,{panels:true}); if(ls) lineage.plateLayoutSig=ls; }
    const planSig=(typeof locationSpatialPlanSigFor==="function")?locationSpatialPlanSigFor(l):"";   // the reviewed layout this plate is made from
    if(planSig) lineage.spatialPlanSig=planSig;
    if(typeof locationSpecSig==="function") lineage.locSpecSig=locationSpecSig(l);
    let referenceText=locationReferenceInstructions(refs);
    if(refs.some(r=>r.kind==="script")) referenceText+=" Read screenplay pages together as evidence for permanent geography \u2014 NOT a quadrant map: "
      +"do not make one panel per page or per scene, and never copy screenplay typography, page borders, text or captions.";
    /* THE PROMPT, ONCE ITS REFERENCES ARE KNOWN (2026-10-14): the same plate the card makes — a room's views name their
       images, the screenplay goes as its attached pages OR as text (a pointer when the pages ride along), and the
       prompt fits the engine this run uses, less the reference list that follows it */
    if(typeof combinedLocationPrompt==="function") prompt=combinedLocationPrompt(l, project, {
      ...(subPlan ? {panelPlan:subPlan, panelRefs:locationReferenceNumbers(refs)} : {}),
      screenplayPages:refs.map((r,i)=>r.kind==="script" ? i+1 : 0).filter(Boolean),
      ...((typeof _locPageScenes==="function" && _locPageScenes(refs)) ? {screenplaySceneIds:_locPageScenes(refs)} : {}),   // the scenes left out go as text
      model:runSnapshot.model, reserve:referenceText.length+1});
    prompt+=referenceText;
    if(refs.length){
      gopts.extraImages=refs.map(r=>r.url);
      if(refs.some(r=>r.maxDim)) gopts.extraImageMaxDims=refs.map(r=>r.maxDim||1024);
      if(refs.some(r=>r.numbered)) gopts.referencesNumbered=true;   // an unreadable one would shift every number after it
    }
    if(_stale(l.id,_runToken,_ep)){_nbLocCancelEvent(l.id,_runToken);return false;}
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; } throw e; }
    }
    /* Capability validation may await an OPTIONS response while the director
       switches films or stops this headless run.  Never spend after that await
       against a stale asset scope/ownership marker. */
    if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
    let url;
    try{
      url = await nbGenerate(prompt, { ...gopts, assetId:l.id });
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
    }catch(e){
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      // (2026-10-14) a refusal for the prompt's length takes the same simplified retry as "no image"
      if((/no image/i.test((e&&e.message)||"") || (typeof window.nbIsPromptLengthError==="function" && window.nbIsPromptLengthError(e))) && typeof buildSimpleLocationPrompt==="function"){
        if(typeof o.onRetry==="function"){ try{ o.onRetry(); }catch(_e){} }   // a second paid image — the caller says so
        delete lineage.platePanels;   // the simplified prompt states no cameras
        try{ prompt=buildSimpleLocationPrompt(l)+referenceText;url = await nbGenerate(prompt, { ...gopts, assetId:l.id }); }
        catch(fallbackError){
          if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
          throw fallbackError;
        }
        if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      }else throw e;
    }
    // a sub-space's panels against its parent's plate, in the browser — free, never in the way (2026-10-14, the copy check)
    const meta = {..._nbLocMeta(prompt,l,runSnapshot),...lineage};
    if(parent) Object.assign(meta, await locationCopyCheckMeta(l, url, meta.iso));
    if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
    let saved;
    try{
      saved = await nbCommit(l.id, url, meta, refs, "location", _ep,
        ()=>_stale(l.id,_runToken,_ep));
    }catch(e){
      if(_stale(l.id,_runToken,_ep)){ _nbLocCancelEvent(l.id,_runToken); return false; }
      throw e;
    }
    if(_stale(l.id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){
      _nbLocCancelEvent(l.id,_runToken); return false;
    }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:l.id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(l.id,_runToken); }
}
window.generateLocationPlate = generateLocationPlate;

async function generateLocationVariant(l, v, project){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // asset scope at generation start
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function") return false;
  const runSnapshot = _nbLocRunSnapshot(l);
  const units = ((window.turnContinuity||{}).sluglineUnits)||[];
  const unit = (typeof locationVariantSluglineUnit==="function") ? locationVariantSluglineUnit(l,v,units) : null;
  const id = (typeof locationAppearanceStateAssetId==="function")
    ? locationAppearanceStateAssetId(l,{...v,linkedUnit:unit},units)
    : l.id+"-"+v.id;
  let prompt = unit && typeof buildSluglineUnitPrompt==="function"
    ? buildSluglineUnitPrompt(l,{...unit,appearance:v.state||unit.appearance||""},project,{model:runSnapshot.model})
    : ((typeof buildLocationVariantPrompt==="function") ? buildLocationVariantPrompt(l, project, { time:v.time, state:v.state }) : (l.name||"location reference"));
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const _runToken = _nbLocRunStart(id);
  if(!_runToken) return false;
  try{
    const stateRefs=await locationStateReferences(l);
    if(_nbLocStale(id,_runToken,_ep)){_nbLocCancelEvent(id,_runToken,_ep);return false;}
    const fixed=mergeLocationReferences(stateRefs,await locationSpatialReferences(l));
    // the parent's plate stays an upstream dependency though only panels cut out of it are attached (2026-10-14)
    const _parentId=(locationParentOf(l)||{}).id;
    const lineage=locationAssetDependencySnapshot(l.id,Array.from(new Set(fixed.slice(1).map(r=>r.refId).concat(_parentId?[_parentId]:[],(typeof locationRootIds==="function")?locationRootIds(l):[]))),unit?"slugline-unit":"continuity-state");
    if(typeof locationPlateLayoutSig==="function"){ const ls=locationPlateLayoutSig(l); if(ls) lineage.plateLayoutSig=ls; }
    /* A STATE OF A ROOM & TIME (2026-10-14, headless paths): the Location Scout makes a room & time plate here — its
       unit's scenes' pages ride first in the slots the plates leave, as on the state's card (buildSluglineUnitReferences),
       and the prompt says which scenes they carry; the rest go as text */
    const pages=(unit && typeof sluglineUnitPageRefs==="function")
      ? sluglineUnitPageRefs(l, unit, id, null, null, Math.max(0, LOC_PLATE_MAX_REFS-fixed.length)) : [];
    const refs=[...pages.map(r=>({url:r.url,kind:"script",refId:r.refId,note:r.note,maxDim:r.maxDim,sceneId:r.sceneId})), ...fixed];
    const referenceText=locationReferenceInstructions(refs)
      +(pages.length ? " The screenplay page snapshots are context only: never copy their typography, page border, text, captions or layout." : "");
    if(pages.length && typeof buildSluglineUnitPrompt==="function") prompt=buildSluglineUnitPrompt(l,{...unit,appearance:v.state||unit.appearance||""},project,{
      screenplayPages:refs.map((r,i)=>r.kind==="script" ? i+1 : 0).filter(Boolean),
      ...((typeof _locPageScenes==="function" && _locPageScenes(refs)) ? {screenplaySceneIds:_locPageScenes(refs)} : {}),
      model:runSnapshot.model, reserve:referenceText.length+1});
    prompt+=referenceText;
    gopts.extraImages=refs.map(r=>r.url);
    if(refs.some(r=>r.maxDim)) gopts.extraImageMaxDims=refs.map(r=>r.maxDim||1024);
    if(refs.some(r=>r.numbered)) gopts.referencesNumbered=true;   // an unreadable one would shift every number after it
    if(_nbLocStale(id,_runToken,_ep)){_nbLocCancelEvent(id,_runToken);return false;}
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    }
    if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let url;
    try{
      url = await nbGenerate(prompt, { ...gopts, assetId:id });
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    }catch(e){
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      if((/no image/i.test((e&&e.message)||"") || (typeof window.nbIsPromptLengthError==="function" && window.nbIsPromptLengthError(e))) && typeof buildSimpleLocationPrompt==="function"){
        try{ prompt=buildSimpleLocationPrompt(l,{ name:(unit&&unit.name)||l.name, side:unit&&unit.intExt, time:v&&v.time, state:v&&v.state })+referenceText;url = await nbGenerate(prompt, { ...gopts, assetId:id }); }
        catch(fallbackError){
          if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
          throw fallbackError;
        }
        if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      }else throw e;
    }
    const meta = Object.assign(_nbLocMeta(prompt,unit?{...l,appearanceState:unit}:l,runSnapshot),lineage);
    // the copy check (2026-10-14) — a room found by its parentKey too (the Location Scout passes the stored card)
    if(_parentId) Object.assign(meta, await locationCopyCheckMeta(l, url, meta.iso, {single:true}));
    if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let saved;
    try{
      saved = await nbCommit(id, url, meta, refs, "location", _ep,
        ()=>_nbLocStale(id,_runToken,_ep));
    }catch(e){
      if(_nbLocStale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      throw e;
    }
    if(_nbLocStale(id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){
      _nbLocCancelEvent(id,_runToken); return false;
    }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(id,_runToken); }
}
window.generateLocationVariant = generateLocationVariant;

/* A ROOM / TIME PLATE (Slugline Unit) made without its card being on screen — for "Generate N
   missing in Scene NN" (2026-10-03, owner — Locations review). The same references and prompt as
   the card's own Generate: the owning location's plate (required), single panels cut out of its
   parent's plate when it is a room (the parent found by its parentKey — 2026-10-14), the reviewed
   spatial references, and the pages of every scene of the unit in the slots left (the rest as text). */
async function generateSluglineUnitPlate(l, u, project, opts){
  const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
  if(typeof nbGenerate!=="function" || typeof nbCommit!=="function" || typeof sluglineUnitImageId!=="function") return false;
  if(!l || !u || !u.key || u.orphan) return false;
  // a caller's stop and its retry notice, as generateLocationPlate (2026-10-09, owner — Breakdown review)
  const o = opts || {};
  const _stale = (sid, tok, ep)=> _nbLocStale(sid, tok, ep) || !!(typeof o.cancelled==="function" && o.cancelled());
  const id = sluglineUnitImageId(u.key);
  const runSnapshot = _nbLocRunSnapshot(l);
  const C = window.turnContinuity || {};
  let prompt = (typeof buildSluglineUnitPrompt==="function") ? buildSluglineUnitPrompt(l, u, project) : (u.name||l.name||"location");
  const gopts = {};
  if(runSnapshot.model) gopts.model = runSnapshot.model;
  if(runSnapshot.quality!=null) gopts.quality = runSnapshot.quality;
  const grab = async (rid)=>{ let x=(typeof nbGetImage==="function")?nbGetImage(rid):"";
    if(!x && typeof nbLoadImage==="function"){ try{ x=await nbLoadImage(rid); }catch(e){} } return x||""; };
  const _runToken = _nbLocRunStart(id);
  if(!_runToken) return false;
  try{
    requireLocationSpatialPlan(l);
    const own = await grab(l.id);
    if(!own) throw new Error("Generate "+(l.name||"the location")+"'s plate first — this room needs it as a reference.");
    const plates = [{ url:own, kind:"location", refId:l.id,
      note:(l.name||"parent location")+" child/master plate — preserve this exact subspace geometry, materials and scale" }];
    /* the root's part: single cut-out panels, never its whole sheet (2026-10-14) — left out when the root has no plate.
       The root is found by the stored card's parentKey too (locationParentOf): "Make what this scene needs" passes the
       STORED card, which has no parentLocation, and its room & time plates used to go without any panel of the root */
    const root = locationParentOf(l);
    if(root && root.id && await grab(root.id)) plates.push(...(await locationSubspaceRootReferences(l,{single:true})).refs);
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const fixed = mergeLocationReferences(plates, await locationSpatialReferences(l));
    // EVERY scene of the unit (2026-10-14): whole scenes' pages in the slots the plates leave; the rest go as text
    const pages = (typeof sluglineUnitPageRefs==="function")
      ? sluglineUnitPageRefs(l, u, id, C.scenes||[], C.drafts||{}, Math.max(0, LOC_PLATE_MAX_REFS-fixed.length)) : [];
    const refs = [...pages.map(r=>({ url:r.url, kind:"script", refId:r.refId, note:r.note, maxDim:r.maxDim, sceneId:r.sceneId })), ...fixed];
    const lineage = locationAssetDependencySnapshot(l.id,(typeof locationRootIds==="function")?locationRootIds(l):[],"slugline-unit");
    if(typeof locationPlateLayoutSig==="function"){ const ls = locationPlateLayoutSig(l); if(ls) lineage.plateLayoutSig = ls; }
    const referenceText = locationReferenceInstructions(refs)
      +" The screenplay page snapshots are context only: never copy their typography, page border, text, captions or layout.";
    // (2026-10-14) its screenplay as the attached pages OR as text, and a prompt that fits this run's engine
    if(typeof buildSluglineUnitPrompt==="function") prompt = buildSluglineUnitPrompt(l, u, project, {
      screenplayPages:refs.map((r,i)=>r.kind==="script" ? i+1 : 0).filter(Boolean),
      ...((typeof _locPageScenes==="function" && _locPageScenes(refs)) ? {screenplaySceneIds:_locPageScenes(refs)} : {}),   // the scenes left out go as text
      model:runSnapshot.model, reserve:referenceText.length+1});
    prompt += referenceText;
    gopts.extraImages = refs.map(r=>r.url);
    // the screenplay pages at their own size (2026-10-14), every other reference as before
    if(refs.some(r=>r.maxDim)) gopts.extraImageMaxDims = refs.map(r=>r.maxDim||1024);
    if(refs.some(r=>r.numbered)) gopts.referencesNumbered = true;   // the parent's cut-out panels are numbered
    if(runSnapshot.quality && typeof window.nbRequireImageQuality==="function"){
      try{ await window.nbRequireImageQuality(runSnapshot.model, runSnapshot.quality); }
      catch(e){ if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; } throw e; }
    }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    let url;
    try{ url = await nbGenerate(prompt, { ...gopts, assetId:id }); }
    catch(e){
      if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      // the same simplified retry the card uses, keeping this plate's room, side, time and state (2026-10-08)
      if(!((/no image/i.test((e&&e.message)||"") || (typeof window.nbIsPromptLengthError==="function" && window.nbIsPromptLengthError(e))) && typeof buildSimpleLocationPrompt==="function")) throw e;
      if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
      if(typeof o.onRetry==="function"){ try{ o.onRetry(); }catch(_e){} }   // a second paid image — the caller says so
      prompt = buildSimpleLocationPrompt(l,{ name:u.name||l.name, side:u.intExt, time:u.time, state:u.appearance||u.environment||"" })+referenceText;
      url = await nbGenerate(prompt, { ...gopts, assetId:id });
    }
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const meta = Object.assign(_nbLocMeta(prompt,{...l,appearanceState:u},runSnapshot),lineage);
    if(root) Object.assign(meta, await locationCopyCheckMeta(l, url, meta.iso, {single:true}));   // the copy check (2026-10-14)
    if(_stale(id,_runToken,_ep)){ _nbLocCancelEvent(id,_runToken); return false; }
    const saved = await nbCommit(id, url, meta, refs, "location", _ep,
      ()=>_stale(id,_runToken,_ep));
    if(_stale(id,_runToken,_ep) || (saved&&/^(cancelled|stale)$/.test(saved.tier||""))){ _nbLocCancelEvent(id,_runToken); return false; }
    if(!saved || saved.tier==="error") return false;
    try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
    return true;
  } finally { _nbLocCleanup(id,_runToken); }
}
window.generateSluglineUnitPlate = generateSluglineUnitPlate;
/* the screenplay "sheet" a room & time plate reads its pages from — one definition for the plate and its count */
function sluglineUnitPseudoSheet(id, u, role){
  return { id, name:u.name, role:role||String(u.intExt||"INT").toUpperCase(), sceneNos:(u.sceneNos||[]).filter(n=>n!=null),
    scriptExcerpt:String(u.scriptText||"").slice(0,720), summary:"Slugline Unit: "+(u.sluglines||[]).join(" · ") };
}
/* HOW MANY REFERENCE IMAGES A PLATE ATTACHES (2026-10-09, owner — Breakdown review): GPT Image charges about one
   credit a reference (billing-pricing.mjs GPT_IMAGE_REFERENCE_USD), so "Make what this scene needs" prices each
   plate with the references the generator above will attach — the parent's plate, the reviewed layout's plate
   (one image when it is the same plate) and the screenplay pages, at most 6. { n, exact }: exact false = n is
   the most it can be. */
/* the references a plate attaches BEFORE its screenplay pages — the parent's plate, the cut-out panels / views of the
   space beyond (a room), the reviewed layout's plate — { n } (n null: the layout isn't ready, the plate can't be made) */
function locationPlateFixedRefCount(l){
  let parent = null, st = null;
  try{ parent = locationParentOf(l); }catch(e){}
  try{ st = requireLocationSpatialPlan(l); }catch(e){ return { n:null }; }
  // a main location: the layout's plate (its own) when the layout was read from one (2026-10-27: read FROM it)
  if(!parent) return { n:(st.plan.source && st.plan.source.iso) ? 1 : 0 };
  /* a sub-space (2026-10-14): the parent's quadrants matched to a view through an opening — or its one material panel
     (an upper bound: it can be unticked); never the parent's or the layout's whole sheet */
  let views = 0;
  try{ views = locationSubspacePanelPlan(l, null, null, { maxSources:4 }).sources.length; }catch(e){ return { n:null }; }
  return { n:views || 1 };
}
/* (2026-10-14) the pages: whole scenes in the slots the other references leave — the count follows the real pages */
function locationPlateRefCount(l){
  const fixed = locationPlateFixedRefCount(l);
  if(fixed.n==null) return { n:6, exact:false };
  let pages = 0;
  // counted, not drawn: the same whole scenes locationScriptPageRefs attaches (a price is read on every render)
  try{ pages = locationScriptPageCount(l, null, null, Math.max(0, 6-fixed.n)); }catch(e){ return { n:6, exact:false }; }
  return { n:Math.min(6, fixed.n+pages), exact:true };
}
window.locationPlateFixedRefCount = locationPlateFixedRefCount;
/* a room & time plate: its location's plate, the root's part when it has one (opts.rootPlate: false = the root has no
   plate, so nothing of it is attached), the reviewed layout's plate, then the pages of its unit's whole scenes in the
   slots they leave (2026-10-14: every scene of the unit, LOC_PLATE_MAX_REFS images in all — counted, not drawn) */
function sluglineUnitPlateRefCount(l, u, opts){
  const o = opts || {};
  const C = window.turnContinuity || {};
  let exact = true;
  const ids = new Set([l.id]);
  /* the root's part (2026-10-14): its panels matched to a view (at most 2), else one small material panel — never its
     sheet. The root found by the stored card's parentKey too (locationParentOf): "Make what this scene needs" prices
     the stored card, which has no parentLocation */
  let root = 0;
  const parent = locationParentOf(l);
  if(parent && parent.id && o.rootPlate!==false){
    try{ root = Math.max(1, locationSubspacePanelPlan(l, null, null, { maxSources:2 }).sources.length); }catch(e){ root = 1; }
    if(o.rootPlate!==true) exact = false;
  }
  // the layout's own plate reaches only the location that owns it (a sub-space gets the layout as text)
  // …and only when the layout was read from it (2026-10-27, the same rule as locationSpatialReferences)
  try{ const st = requireLocationSpatialPlan(l); if(st.plan.source && st.plan.source.iso && st.owner.id===l.id) ids.add(st.owner.id); }catch(e){}
  // the pages the generator attaches: whole scenes of the unit in the slots left (sluglineUnitPageRefs)
  let pages = 0;
  try{ pages = sluglineUnitPageCount(l, u, C.scenes||[], C.drafts||{}, Math.max(0, LOC_PLATE_MAX_REFS-ids.size-root)); }
  catch(e){ exact = false; }
  return { n:pages+ids.size+root, exact };
}
window.locationPlateRefCount = locationPlateRefCount;
window.sluglineUnitPlateRefCount = sluglineUnitPlateRefCount;

/* coverage audit — scenes whose heading names a place that isn't linked to any Location
   card yet (e.g. an unparseable or brand-new heading). After a pull every parseable scene
   heading is covered, so this surfaces the genuine gaps. */
function locationCoverage(scenes, locations){
  const covered = new Set();
  (locations||[]).forEach(l=> (l.scenes||[]).forEach(id=> covered.add(id)));
  const out = [];
  (scenes||[]).forEach(s=>{
    if(!s || !(s.loc||"").trim()) return;     // no scene heading → not a master location-bearing scene
    if(covered.has(s.id)) return;
    const p = (typeof parseSlugline==="function") ? parseSlugline(s.loc) : null;
    out.push({ id:s.id, no:s.no, title:s.title||"", slug:(s.loc||"").trim(), place:(p&&p.place)||"" });
  });
  return out;
}
window.locationCoverage = locationCoverage;
